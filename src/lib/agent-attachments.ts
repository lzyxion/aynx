// OS 드롭에는 원본 경로가 없으므로 사본을 저장해 AI CLI가 읽을 수 있는 경로로 바꾼다.
// 사본은 대화에서 다시 읽을 수 있도록 남긴다. 원본 이름은 유지하고 매번 별도 폴더를 쓴다.
// 남기는 기간은 30일(Claude Code 가 지난 대화를 지우는 기본 기간) — 로컬은 앱 시작 때 Rust 가,
// 원격은 그 서버에 첨부를 올린 뒤 여기서 한 번(세션마다) 걷는다.
import { invoke } from "./ipc";
import { localBackend, remoteBackend, type FsBackend } from "$lib/fs-backend";
import { nextOp } from "$lib/fs-ops";
import { uploadFile, UPLOAD_MAX_BYTES } from "$lib/sftp";
import type { SessionKind, Tr } from "$lib/session/spec";

/** Rust `agent_attachments::MAX_AGE` 와 같은 값 */
export const ATTACHMENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/**
 * 원격 첨부 자리 — 서버의 `~/.aynx/attachments/<uuid>/`. `~/.aynx` 은 원격 셸 통합도 쓰는 앱의 서버 쪽 폴더라
 * 홈에 앱 폴더가 하나만 생긴다(개발·릴리스가 같은 서버 폴더를 쓰는 것도 셸 통합과 같다 — `instance.rs` 머리말).
 * 예전(2026-10-07 이전)에는 홈 바로 밑 `.aynx-attachment-<uuid>` 였다 — 정리는 그 옛 자리도 함께 본다.
 */
const REMOTE_APP_DIR = ".aynx";
const REMOTE_ATTACH_DIR = "attachments";
const LEGACY_REMOTE_PREFIX = ".aynx-attachment-";
/** 이번 실행에서 이미 걷은 원격 세션 — 첨부마다 홈 목록을 다시 읽지 않는다 */
const prunedSessions = new Set<number>();

type RemoteDirs = Pick<FsBackend, "joinPath" | "mkdir" | "stat">;

/** 없으면 만든다 — 이미 있으면(폴더) 그대로 쓴다 */
async function ensureDir(backend: RemoteDirs, path: string): Promise<string> {
  try {
    const entry = await backend.stat(path);
    if (entry.kind === "dir" || (entry.kind === "symlink" && entry.linkIsDir)) return path;
  } catch {
    // 없다 — 아래에서 만든다
  }
  return backend.mkdir(path);
}

/** 이번 첨부를 담을 새 원격 폴더 `~/.aynx/attachments/<uuid>` 를 만들어 그 경로를 돌려준다 */
export async function newRemoteAttachmentDir(backend: RemoteDirs, home: string): Promise<string> {
  const app = await ensureDir(backend, backend.joinPath(home, REMOTE_APP_DIR));
  const root = await ensureDir(backend, backend.joinPath(app, REMOTE_ATTACH_DIR));
  return backend.mkdir(backend.joinPath(root, crypto.randomUUID()));
}

/**
 * 원격의 오래된 첨부 폴더를 걷는다 — `~/.aynx/attachments/` 아래 폴더와 옛 자리(홈의 `.aynx-attachment-*`).
 * 실패는 삼킨다(첨부 자체와 무관하고, 다음 실행에서 다시 해 보면 된다). 돌려주는 값은 지운 수(테스트용).
 */
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

export async function stageAgentFiles(
  kind: SessionKind,
  session: number,
  files: readonly File[],
  tr: Tr,
): Promise<string[]> {
  // 파일을 읽기 전에 전부 검사한다 — 큰 파일을 메모리에 먼저 싣지 않는다.
  for (const file of files) {
    if (file.size > UPLOAD_MAX_BYTES) throw new Error(tr("pane.drop.attach.toobig", { name: file.name }));
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
 * 파일 타일에서 끈 **다른 곳의 파일**을 AI 타일이 읽을 수 있는 자리로 복사하고 그 경로들을 돌려준다
 * (`fs-drop-route.ts` 의 `upload`·`download` 칸).
 *
 * - `upload` — 로컬 경로들을 `session`(놓는 타일의 서버)의 `~/.aynx/attachments/<uuid>` 로. [`stageAgentFiles`]
 *   의 원격 갈래와 같은 자리·이름이라 30일 정리([`pruneRemoteAttachments`])를 그대로 받는다.
 * - `download` — `session`(파일의 서버) 경로들을 로컬 `<data_root>/attachments/<64자 hex>/` 로. 폴더는 Rust
 *   `create_agent_attachment_dir` 가 만들고(앱 시작 때 30일 정리 대상), 내용은 경로 전송이 채운다.
 *
 * 전송 명령은 폴더도 재귀로 옮기지만 **폴더는 받지 않는다** — 안의 파일 크기를 미리 알려면 통째로 훑어야 하고,
 * 실수로 끈 큰 폴더가 첨부 사본으로 복제되는 편이 더 나쁘다. 파일마다 OS 드롭 첨부와 같은 100MB 상한을 지킨다
 * (`stat` 한 번씩 — 항목 수만큼 왕복이지만 끄는 항목은 대개 몇 개다).
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
    if (entry.size > UPLOAD_MAX_BYTES) throw new Error(tr("pane.drop.attach.toobig", { name: entry.name }));
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

/**
 * **로컬 파일 타일**에서 끈 경로들을 로컬 첨부 자리 `<data_root>/attachments/<64자 hex>/` 로 복사하고 그 경로들을 돌려준다(2026-10-24 —
 * 사이드 채팅: 서버가 그 자리 안의 그림만 받는다). 폴더 · 100MB 규칙은 [`stageFsPaths`] 와 같다.
 */
export async function stageLocalPaths(paths: readonly string[], tr: Tr): Promise<string[]> {
  const local = localBackend();
  for (const path of paths) {
    const entry = await local.stat(path);
    if (entry.kind === "dir" || (entry.kind === "symlink" && entry.linkIsDir)) {
      throw new Error(tr("pane.drop.fs.folder", { name: entry.name }));
    }
    if (entry.size > UPLOAD_MAX_BYTES) throw new Error(tr("pane.drop.attach.toobig", { name: entry.name }));
  }
  const dir = await invoke<string>("create_agent_attachment_dir");
  return local.copy(paths, dir, "rename", nextOp(), null);
}

/** 첨부를 올린 서버의 오래된 첨부 폴더를 세션마다 한 번 걷는다 */
function pruneOnce(session: number, backend: Pick<FsBackend, "list" | "remove" | "joinPath">, home: string): void {
  if (prunedSessions.has(session)) return;
  prunedSessions.add(session);
  void pruneRemoteAttachments(backend, home);
}
