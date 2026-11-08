import { beforeEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { ATTACHMENT_MAX_AGE_MS, pruneRemoteAttachments, stageAgentFiles, stageFsPaths } from "$lib/agent-attachments";
import { uploadFile, UPLOAD_MAX_BYTES } from "$lib/sftp";
import type { Tr } from "$lib/session/spec";

const remote = vi.hoisted(() => ({
  home: vi.fn(async () => "/home/user"),
  mkdir: vi.fn(async (path: string) => path),
  list: vi.fn(async () => [] as unknown[]),
  remove: vi.fn(async () => {}),
  joinPath: (dir: string, name: string) => `${dir}/${name}`,
  stat: vi.fn(async (path: string) => entry(path)),
  uploadPaths: vi.fn(async (paths: string[], dir: string) => paths.map((p) => `${dir}/${baseName(p)}`)),
  downloadPaths: vi.fn(async (paths: string[], dir: string) => paths.map((p) => `${dir}\\${baseName(p)}`)),
}));
const local = vi.hoisted(() => ({ stat: vi.fn(async (path: string) => entry(path)) }));
const baseName = vi.hoisted(() => (path: string) => path.split(/[\\/]/).pop() ?? path);
const entry = vi.hoisted(() => (path: string, kind = "file", size = 1) => ({
  name: baseName(path), path, kind, size, mtime: null, mode: null, symlinkTarget: null, linkIsDir: false,
}));
vi.mock("$lib/fs-backend", () => ({ remoteBackend: vi.fn(() => remote), localBackend: vi.fn(() => local) }));
vi.mock("$lib/sftp", async (original) => ({ ...await original<typeof import("$lib/sftp")>(), uploadFile: vi.fn() }));
const tr: Tr = (key) => key;

describe("stageAgentFiles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("로컬 파일의 바이너리와 한글 이름을 보내고, 반환된 사본 경로를 순서대로 쓴다", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("C:\\copies\\1\\한글.png").mockResolvedValueOnce("C:\\copies\\2\\empty.txt");
    const paths = await stageAgentFiles("local", 7, [
      new File([new Uint8Array([0, 255, 42])], "한글.png"), new File([], "empty.txt"),
    ], tr);
    expect(paths).toEqual(["C:\\copies\\1\\한글.png", "C:\\copies\\2\\empty.txt"]);
    expect(invoke).toHaveBeenNthCalledWith(1, "stage_agent_attachment", new Uint8Array([0, 255, 42]), {
      headers: { "x-file-name": encodeURIComponent("한글.png") },
    });
    expect(remote.home).not.toHaveBeenCalled();
  });

  it("원격 AI에는 그 세션 서버로 업로드한 절대 경로를 반환한다", async () => {
    const file = new File(["text"], "note.txt");
    vi.mocked(uploadFile).mockResolvedValue({ remote_path: "/home/user/copy/note.txt", bytes: 4 });
    expect(await stageAgentFiles("ssh", 42, [file], tr)).toEqual(["/home/user/copy/note.txt"]);
    expect(remote.mkdir).toHaveBeenLastCalledWith(expect.stringMatching(/^\/home\/user\/\.aynx\/attachments\/[0-9a-f-]{36}$/));
    expect(uploadFile).toHaveBeenCalledWith(42, expect.any(String), file, false, tr);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("큰 파일이 섞여 있으면 어느 파일도 읽거나 저장하지 않는다", async () => {
    const arrayBuffer = vi.fn();
    const files = [{ name: "small.txt", size: 1, arrayBuffer }, { name: "big.png", size: UPLOAD_MAX_BYTES + 1, arrayBuffer }] as unknown as File[];
    await expect(stageAgentFiles("local", 7, files, tr)).rejects.toThrow("pane.drop.attach.toobig");
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });

  it("저장 실패를 호출자에게 전달한다", async () => {
    vi.mocked(invoke).mockRejectedValueOnce(new Error("disk full"));
    await expect(stageAgentFiles("local", 7, [new File(["x"], "x.txt")], tr)).rejects.toThrow("disk full");
  });
});

describe("pruneRemoteAttachments", () => {
  const now = Date.UTC(2026, 9, 7);
  const ROOT = "/home/user/.aynx/attachments";
  const dir = (parent: string, name: string, ageMs: number | null, kind = "dir") => ({
    name, path: `${parent}/${name}`, kind, mtime: ageMs === null ? null : (now - ageMs) / 1000,
  });
  const joinPath = (a: string, b: string) => `${a}/${b}`;

  it("30일 지난 첨부 폴더만 지운다 — 새 자리 전부 · 옛 자리는 접두어 단 것만", async () => {
    const OLD = ATTACHMENT_MAX_AGE_MS + 1000;
    const listing: Record<string, unknown[]> = {
      [ROOT]: [dir(ROOT, "uuid-old", OLD), dir(ROOT, "uuid-new", 1000), dir(ROOT, "uuid-unknown", null), dir(ROOT, "x.txt", OLD, "file")],
      "/home/user": [
        dir("/home/user", ".aynx-attachment-old", OLD),
        dir("/home/user", ".aynx-attachment-new", 1000),
        dir("/home/user", "projects", ATTACHMENT_MAX_AGE_MS * 10),
        dir("/home/user", ".aynx", OLD),
      ],
    };
    const backend = { joinPath, list: vi.fn(async (path: string) => listing[path] ?? []), remove: vi.fn(async () => {}) };
    expect(await pruneRemoteAttachments(backend as never, "/home/user", now)).toBe(2);
    expect(backend.remove.mock.calls).toEqual([[`${ROOT}/uuid-old`, true], ["/home/user/.aynx-attachment-old", true]]);
  });

  it("목록·삭제 실패는 첨부를 막지 않는다", async () => {
    const failing = { joinPath, list: vi.fn(async () => { throw new Error("gone"); }), remove: vi.fn() };
    expect(await pruneRemoteAttachments(failing as never, "/home/user", now)).toBe(0);
  });

  it("원격 첨부 뒤 세션마다 한 번만 걷는다", async () => {
    vi.clearAllMocks();
    vi.mocked(uploadFile).mockResolvedValue({ remote_path: "/home/user/copy/a.txt", bytes: 1 });
    await stageAgentFiles("ssh", 99, [new File(["a"], "a.txt")], tr);
    await stageAgentFiles("ssh", 99, [new File(["b"], "b.txt")], tr);
    expect(remote.list.mock.calls).toEqual([["/home/user/.aynx/attachments"], ["/home/user"]]);
  });
});

describe("stageFsPaths — 파일 타일 짐을 다른 곳의 AI 타일로", () => {
  beforeEach(() => vi.clearAllMocks());

  it("로컬 → 원격: 원격 홈에 첨부 폴더를 만들어 올리고 원격 경로를 돌려준다", async () => {
    const paths = await stageFsPaths("upload", 42, ["C:\\pics\\a.png"], tr);
    expect(local.stat).toHaveBeenCalledWith("C:\\pics\\a.png");
    expect(remote.mkdir).toHaveBeenLastCalledWith(expect.stringMatching(/^\/home\/user\/\.aynx\/attachments\/[0-9a-f-]{36}$/));
    const dir = vi.mocked(remote.mkdir).mock.calls.at(-1)![0];
    expect(remote.uploadPaths).toHaveBeenCalledWith(["C:\\pics\\a.png"], dir, "rename", expect.any(Number), null);
    expect(paths).toEqual([`${dir}/a.png`]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it("원격 → 로컬: 새 Rust 명령이 만든 폴더로 내려받는다", async () => {
    vi.mocked(invoke).mockResolvedValueOnce("C:\\data\\attachments\\abc");
    const paths = await stageFsPaths("download", 7, ["/srv/shot.png"], tr);
    expect(invoke).toHaveBeenCalledExactlyOnceWith("create_agent_attachment_dir");
    expect(remote.stat).toHaveBeenCalledWith("/srv/shot.png");
    expect(remote.downloadPaths).toHaveBeenCalledWith(["/srv/shot.png"], "C:\\data\\attachments\\abc", "rename", expect.any(Number), null);
    expect(paths).toEqual(["C:\\data\\attachments\\abc\\shot.png"]);
    expect(remote.mkdir).not.toHaveBeenCalled();
  });

  it("폴더나 100MB 넘는 파일이 섞이면 아무것도 만들거나 옮기지 않는다", async () => {
    vi.mocked(remote.stat).mockResolvedValueOnce(entry("/srv/dir", "dir", 4096));
    await expect(stageFsPaths("download", 7, ["/srv/dir"], tr)).rejects.toThrow("pane.drop.fs.folder");
    vi.mocked(local.stat).mockResolvedValueOnce(entry("C:\\big.iso", "file", UPLOAD_MAX_BYTES + 1));
    await expect(stageFsPaths("upload", 42, ["C:\\big.iso"], tr)).rejects.toThrow("pane.drop.attach.toobig");
    expect(remote.mkdir).not.toHaveBeenCalled();
    expect(remote.uploadPaths).not.toHaveBeenCalled();
    expect(remote.downloadPaths).not.toHaveBeenCalled();
    expect(invoke).not.toHaveBeenCalled();
  });
});
