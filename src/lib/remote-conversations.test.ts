import { describe, expect, it } from "vitest";
import type { Project } from "$lib/projects";
import { listForScope, pickerActionForKey, type PickerKeyEvent } from "$lib/folder-conversations";
import {
  applyReply,
  dedupeRemote,
  emptyRemoteHost,
  isRemoteConversation,
  minutesSince,
  REMOTE_FRESH_MS,
  remoteConversationPane,
  remoteFresh,
  remoteHere,
  remoteProjectFor,
  remoteScopeChips,
  sshScopeFolder,
  type RemoteConversation,
  type RemoteConversationReply,
} from "$lib/remote-conversations";

/**
 * 원격 지난 대화 — 순수 규칙 (docs/log/2026-09-27-remote-conversations.md).
 */

const U = (n: number) => `11111111-2222-4333-8444-${String(n).padStart(12, "0")}`;

function row(n: number, cwd: string, updatedAt: number, extra: Partial<RemoteConversation> = {}): RemoteConversation {
  return {
    agent: "claude",
    id: U(n),
    cwd,
    branch: null,
    title: `대화 ${n}`,
    titleSource: "ai",
    startedAt: null,
    updatedAt,
    model: null,
    forkedFrom: null,
    cwdExists: true,
    host: "dev-01",
    tokens: null,
    ...extra,
  };
}

function reply(sessions: RemoteConversation[], extra: Partial<RemoteConversationReply> = {}): RemoteConversationReply {
  return { host: "dev-01", sessions, total: sessions.length, done: sessions.length, complete: true, readAt: 1000, home: "/home/deploy", ...extra };
}

function project(id: string, host: string | null, path: string, tmux = true): Project {
  return { id, name: id, host, path, shell: null, agent: null, setupScript: "", migration: null, tmux, worktreeDir: null };
}

describe("SSH 타일의 기준 폴더", () => {
  it("셸이 알려 준 폴더 → 시작 폴더 → 없음(그 서버 전체)", () => {
    expect(sshScopeFolder("/home/deploy/work/api", "~/work")).toEqual({ folder: "/home/deploy/work/api", source: "tile" });
    expect(sshScopeFolder(null, "~/work/aynx-lab")).toEqual({ folder: "~/work/aynx-lab", source: "start" });
    expect(sshScopeFolder("  ", "")).toEqual({ folder: null, source: "none" });
    expect(sshScopeFolder(undefined, undefined)).toEqual({ folder: null, source: "none" });
  });

  it("이 폴더 = 기록된 시작 폴더가 그 폴더와 같은 대화 — `~` 는 서버의 홈으로 펴서 맞댄다", () => {
    const rows = [row(1, "/home/deploy/work/api", 3), row(2, "/home/deploy/work/api/sub", 2), row(3, "/srv/x", 1)];
    expect(remoteHere(rows, "~/work/api", "/home/deploy").map((s) => s.id)).toEqual([U(1)]);
    expect(remoteHere(rows, "/home/deploy/work/api/", "/home/deploy").map((s) => s.id)).toEqual([U(1)]);
    expect(remoteHere(rows, "~/work/api", null), "홈을 모르면 `~` 를 펴지 못한다 — 억지로 맞대지 않는다").toEqual([]);
    expect(remoteHere(rows, null, "/home/deploy")).toEqual([]);
    expect(remoteHere(null, "/srv/x", null)).toEqual([]);
  });

  it("칩 — 폴더가 있으면 이 폴더 · 호스트 전체, 없으면 호스트 전체 하나. `host` 범위는 목록 전부다", () => {
    expect(remoteScopeChips(true, 2, 9)).toEqual([
      { scope: "here", count: 2 },
      { scope: "host", count: 9 },
    ]);
    expect(remoteScopeChips(false, 0, 9)).toEqual([{ scope: "host", count: 9 }]);
    const all = [row(1, "/a", 1)];
    expect(listForScope({ here: [], project: null, all }, "host")).toBe(all);
  });
});

describe("캐시 — 1분 안에 다 읽었으면 다시 읽지 않는다", () => {
  it("끝까지 · 실패 없이 · 1분 안", () => {
    const h = applyReply(emptyRemoteHost(), reply([row(1, "/a", 1)], { readAt: 10_000 }));
    expect(remoteFresh(h, 10_000 + REMOTE_FRESH_MS - 1)).toBe(true);
    expect(remoteFresh(h, 10_000 + REMOTE_FRESH_MS)).toBe(false);
    expect(remoteFresh({ ...h, error: "x" }, 10_001)).toBe(false);
    expect(remoteFresh(applyReply(emptyRemoteHost(), reply([], { complete: false, done: 3, total: 9 })), 1001)).toBe(false);
    expect(remoteFresh(emptyRemoteHost(), 0)).toBe(false);
  });

  it("덜 읽은 답은 진행을 세우고, 다 읽은 답은 진행을 걷는다 · 실패와 붙은 세션 없음을 지운다", () => {
    const prev = { ...emptyRemoteHost(), error: "옛 실패", offline: true };
    const partial = applyReply(prev, reply([row(1, "/a", 1)], { complete: false, done: 12, total: 31 }));
    expect(partial.progress).toEqual({ done: 12, total: 31 });
    expect(partial.error).toBeNull();
    expect(partial.offline).toBe(false);
    const done = applyReply(partial, reply([row(1, "/a", 1), row(2, "/a", 2)]));
    expect(done.progress).toBeNull();
    expect(done.complete).toBe(true);
    expect(done.home).toBe("/home/deploy");
    expect(applyReply(done, reply([], { home: null })).home, "홈을 못 받은 답이 아는 홈을 지우지 않는다").toBe("/home/deploy");
  });

  it("줄 합치기 — 같은 대화는 가장 최근 것 하나 · 최신순", () => {
    const rows = dedupeRemote([row(1, "/a", 5), row(2, "/a", 9), row(1, "/b", 7)]);
    expect(rows.map((s) => [s.id, s.updatedAt])).toEqual([
      [U(2), 9],
      [U(1), 7],
    ]);
    const codex = dedupeRemote([row(1, "/a", 5), row(1, "/a", 4, { agent: "codex" })]);
    expect(codex, "에이전트가 다르면 다른 대화다").toHaveLength(2);
  });

  it("읽은 때 — 분 단위", () => {
    expect(minutesSince(null, 0)).toBeNull();
    expect(minutesSince(0, 59_999)).toBe(0);
    expect(minutesSince(0, 125_000)).toBe(2);
  });
});

describe("재개 타일", () => {
  it("원격 줄인가 — 호스트 칸", () => {
    expect(isRemoteConversation(row(1, "/a", 1))).toBe(true);
    const { host: _h, tokens: _t, ...local } = row(1, "/a", 1);
    expect(isRemoteConversation(local)).toBe(false);
  });

  it("그 별칭 · 대화의 폴더 · Rust 가 지은 명령 · 폴더를 품은 원격 프로젝트의 tmux 토글", () => {
    const projects = [
      project("lab", "dev-01", "~/work", true),
      project("api", "DEV-01", "~/work/api", false),
      project("other", "dev-02", "~/work/api", true),
      project("local", null, "/home/deploy/work/api", true),
    ];
    const p = remoteProjectFor(projects, "dev-01", "/home/deploy/work/api/sub", "/home/deploy");
    expect(p?.id, "가장 깊은 프로젝트 · 별칭은 대소문자 무시 · 다른 호스트와 로컬은 아니다").toBe("api");
    expect(remoteProjectFor(projects, "dev-01", "/srv/x", "/home/deploy")).toBeNull();

    const pane = remoteConversationPane("dev-01", { cwd: "/home/deploy/work/api", command: `claude --resume ${U(1)}` }, p, 5000);
    expect(pane.kind).toBe("ssh");
    expect(pane.alias).toBe("dev-01");
    expect(pane.cwd).toBe("/home/deploy/work/api");
    expect(pane.autorun).toBe(`claude --resume ${U(1)}`);
    expect(pane.noTmux).toBe(true);
    expect(pane.forceTmux).toBeUndefined();
    expect(pane.injectMcpToken).toBeUndefined();

    const bare = remoteConversationPane("dev-01", { cwd: "/srv/x", command: `codex resume ${U(2)}` }, null);
    expect(bare.noTmux).toBeUndefined();
    expect(bare.forceTmux).toBeUndefined();
  });
});

describe("고르는 목록의 키 — F5", () => {
  const key = (code: string, mods: Partial<PickerKeyEvent> = {}): PickerKeyEvent => ({
    code,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });
  it("F5 = 다시 읽기 · Ctrl/Shift+F5 는 아니다", () => {
    expect(pickerActionForKey(key("F5"))).toBe("refresh");
    expect(pickerActionForKey(key("F5", { ctrlKey: true }))).toBeNull();
    expect(pickerActionForKey(key("F5", { shiftKey: true }))).toBeNull();
  });
});
