// OS 드롭에는 원본 경로가 없어 사본을 AI CLI 가 읽을 자리에 둔다 — 대화에서 다시 읽게 30일(Claude Code 가 지난 대화를 지우는
// 기본 기간) 남긴다. 로컬은 앱 시작 때 Rust 가, 원격은 첨부를 올린 뒤 여기서 세션마다 한 번 걷는다.
import { invoke, rawBodyLimit } from "./ipc";
import { localBackend, remoteBackend, type FsBackend } from "$lib/fs-backend";
import { nextOp } from "$lib/fs-ops";
import { uploadFile, UPLOAD_MAX_BYTES } from "$lib/sftp";
import type { SessionKind, Tr } from "$lib/session/spec";

/** Rust `agent_attachments::MAX_AGE` 와 같은 값 */
export const ATTACHMENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** 서버의 `~/.aynx` — 원격 셸 통합과 같은 앱 폴더(개발 · 릴리스가 같이 쓴다 — `instance.rs` 머리말). */
const REMOTE_APP_DIR = ".aynx";
const REMOTE_ATTACH_DIR = "attachments";
/** 옛 자리(홈 바로 밑 `.aynx-attachment-<uuid>`) — 정리는 이것도 함께 본다 */
const LEGACY_REMOTE_PREFIX = ".aynx-attachment-";
const prunedSessions = new Set<number>();

type RemoteDirs = Pick<FsBackend, "joinPath" | "mkdir" | "stat">;

async function ensureDir(backend: RemoteDirs, path: string): Promise<string> {
  try {
    const entry = await backend.stat(path);
    if (entry.kind === "dir" || (entry.kind === "symlink" && entry.linkIsDir)) return path;
  } catch {
    // 없다 — 아래에서 만든다
  }
  return backend.mkdir(path);
}

export async function newRemoteAttachmentDir(backend: RemoteDirs, home: string): Promise<string> {
  const app = await ensureDir(backend, backend.joinPath(home, REMOTE_APP_DIR));
  const root = await ensureDir(backend, backend.joinPath(app, REMOTE_ATTACH_DIR));
  return backend.mkdir(backend.joinPath(root, crypto.randomUUID()));
}

/** 실패는 삼킨다 — 첨부 자체와 무관하고 다음 실행에서 다시 해 보면 된다. */
export async function pruneRemoteAttachments(
  backend: Pick<FsBackend, "list" | "remove" | "joinPath">,
  home: string,
  now = Date.now(),
): Promise<number> {
  const root = backend.joinPath(backend.joinPath(home, REMOTE_APP_DIR), REMOTE_ATTACH_DIR);
  return (await pruneIn(backend, root, () => true, now)) +
    (await pruneIn(backend, home, (name) => name.startsWith(LEGACY_REMOTE_PREFIX), now));
}

async function pruneIn(
  backend: Pick<FsBackend, "list" | "remove">,
  dir: string,
  ours: (name: string) => boolean,
  now: number,
): Promise<number> {
  let removed = 0;
  try {
    for (const entry of await backend.list(dir)) {
      if (entry.kind !== "dir" || !ours(entry.name) || entry.mtime === null) continue;
      if (now - entry.mtime * 1000 < ATTACHMENT_MAX_AGE_MS) continue;
      try {
        await backend.remove(entry.path, true);
        removed++;
      } catch {
        // 권한·경합 — 다음 기회에
      }
    }
  } catch {
    // 목록을 못 읽었다(아직 없음 등) — 다음 기회에
  }
  return removed;
}

function attachMax(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} MB`;
}

export async function stageAgentFiles(
  kind: SessionKind,
  session: number,
  files: readonly File[],
  tr: Tr,
): Promise<string[]> {
  // 두 갈래 다 바이트를 원시 본문으로 보낸다 — 원격 창에서는 ws 상한 안쪽으로.
  const max = rawBodyLimit(UPLOAD_MAX_BYTES);
  // 읽기 전에 전부 검사한다 — 큰 파일을 메모리에 먼저 싣지 않는다.
  for (const file of files) {
    if (file.size > max) throw new Error(tr("pane.drop.attach.toobig", { name: file.name, max: attachMax(max) }));
  }
  const paths: string[] = [];
  const backend = kind === "ssh" ? remoteBackend(session) : null;
  const home = backend ? await backend.home() : null;
  for (const file of files) {
    if (backend && home !== null) {
      const dir = await newRemoteAttachmentDir(backend, home);
      paths.push((await uploadFile(session, dir, file, false, tr)).remote_path);
      pruneOnce(session, backend, home);
    } else {
      paths.push(await invoke<string>("stage_agent_attachment", new Uint8Array(await file.arrayBuffer()), {
        headers: { "x-file-name": encodeURIComponent(file.name) },
      }));
    }
  }
  return paths;
}

/**
 * 자리 · 이름은 OS 드롭 첨부와 같다 — 같은 30일 정리를 받는다.
 * 폴더는 받지 않는다 — 안의 크기를 미리 알려면 통째로 훑어야 하고, 실수로 끈 큰 폴더가 첨부 사본으로 복제되는 편이 더 나쁘다.
 */
export async function stageFsPaths(
  direction: "upload" | "download",
  session: number,
  paths: readonly string[],
  tr: Tr,
): Promise<string[]> {
  const remote = remoteBackend(session);
  const source = direction === "upload" ? localBackend() : remote;
  for (const path of paths) {
    const entry = await source.stat(path);
    if (entry.kind === "dir" || (entry.kind === "symlink" && entry.linkIsDir)) {
      throw new Error(tr("pane.drop.fs.folder", { name: entry.name }));
    }
    // 경로만 넘기는 길(본문이 ws 를 지나지 않는다)이라 원격 창이어도 100MB 그대로다.
    if (entry.size > UPLOAD_MAX_BYTES) {
      throw new Error(tr("pane.drop.attach.toobig", { name: entry.name, max: attachMax(UPLOAD_MAX_BYTES) }));
    }
  }
  if (direction === "upload") {
    if (!remote.uploadPaths) throw new Error(tr("pane.drop.attach.notready"));
    const home = await remote.home();
    const dir = await newRemoteAttachmentDir(remote, home);
    const made = await remote.uploadPaths(paths, dir, "rename", nextOp(), null);
    pruneOnce(session, remote, home);
    return made;
  }
  if (!remote.downloadPaths) throw new Error(tr("pane.drop.attach.notready"));
  const dir = await invoke<string>("create_agent_attachment_dir");
  return remote.downloadPaths(paths, dir, "rename", nextOp(), null);
}

/** 사이드 채팅용 — 서버가 로컬 첨부 자리 안의 그림만 받는다. 폴더 · 100MB 규칙은 [`stageFsPaths`] 와 같다. */
export async function stageLocalPaths(paths: readonly string[], tr: Tr): Promise<string[]> {
  const local = localBackend();
  for (const path of paths) {
    const entry = await local.stat(path);
    if (entry.kind === "dir" || (entry.kind === "symlink" && entry.linkIsDir)) {
      throw new Error(tr("pane.drop.fs.folder", { name: entry.name }));
    }
    // 경로 복사(메인 PC 안)라 원격 창이어도 100MB 그대로다.
    if (entry.size > UPLOAD_MAX_BYTES) {
      throw new Error(tr("pane.drop.attach.toobig", { name: entry.name, max: attachMax(UPLOAD_MAX_BYTES) }));
    }
  }
  const dir = await invoke<string>("create_agent_attachment_dir");
  return local.copy(paths, dir, "rename", nextOp(), null);
}

function pruneOnce(session: number, backend: Pick<FsBackend, "list" | "remove" | "joinPath">, home: string): void {
  if (prunedSessions.has(session)) return;
  prunedSessions.add(session);
  void pruneRemoteAttachments(backend, home);
}
