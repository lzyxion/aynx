import { describe, expect, it } from "vitest";
import type { AgentStatus } from "$lib/agent-status";
import type { Project, WorktreeListing } from "$lib/projects";
import type { Tr } from "$lib/session";
import { FALLBACK_LOCALE, translate } from "$lib/i18n/dict";
import {
  dockDot,
  dockWaiting,
  groupDot,
  hostDots,
  placeOf,
  projectDots,
  projectFolders,
  worktreeDotKey,
  type DockAgentPane,
} from "$lib/dock-dots";

const koTr: Tr = (key, params) => translate(FALLBACK_LOCALE, key, params);

let seq = 0;
function pane(p: Partial<DockAgentPane> & { state?: AgentStatus | null }): DockAgentPane {
  return { id: `p${++seq}`, name: "Claude Code", state: "running", host: null, start: null, current: null, ...p };
}

const LOCAL: Project = { id: "L", name: "aynx", host: null, path: "C:\\src\\proj", shell: null, agent: null, setupScript: "", migration: null, tmux: false, worktreeDir: null };
const REMOTE: Project = { id: "R", name: "api", host: "dev-01", path: "~/api", shell: null, agent: null, setupScript: "", migration: null, tmux: false, worktreeDir: null };

const wt = (path: string, branch: string | null) => ({ path, branch, head: null, bare: false, detached: false });
const LISTINGS: Record<string, WorktreeListing> = {
  L: {
    state: "ok",
    list: [
      wt("C:/src/proj", "main"),
      wt("C:/src/proj-wt/feat-x", "feat-x"),
      // 주 저장소 **안**의 워크트리 — 가장 깊은 것이 이긴다
      wt("C:/src/proj/.claude/worktrees/agent-1", "agent-1"),
    ],
  },
  R: { state: "ok", list: [wt("/root/api", "main"), wt("/root/api-wt/fix", "fix")] },
};
const FOLDERS = projectFolders([LOCAL, REMOTE], (id) => LISTINGS[id]);
const HOME = (alias: string) => (alias.toLowerCase() === "dev-01" ? "/root" : null);
const NO_HOME = () => null;

describe("dockDot — 접기 (docs/log/2026-10-01-agent-status-three.md)", () => {
  it("권한 대기 > 완료 > 실행 중, 점이 없는 것(null)은 그리지 않는다", () => {
    expect(dockDot([{ name: "A", state: null }], koTr)).toBeNull();
    expect(dockDot([], koTr)).toBeNull();
    const d = dockDot(
      [
        { name: "Codex", state: "running" },
        { name: "Claude Code", state: "finished" },
        { name: "Claude Code", state: "permission" },
        { name: "X", state: null },
      ],
      koTr,
    );
    expect(d?.state).toBe("permission");
    expect(d?.label).toBe("Claude Code 권한 대기 · Claude Code 완료 · Codex 실행 중");
  });

  it("같은 이름·같은 상태는 ×N 으로, 자리가 있으면 '<자리> — <사실>'", () => {
    const d = dockDot(
      [
        { name: "Claude Code", state: "running", place: "main" },
        { name: "Claude Code", state: "running", place: "main" },
        { name: "Codex", state: "finished", place: "feat-x" },
      ],
      koTr,
    );
    expect(d).toEqual({ state: "finished", label: "feat-x — Codex 완료 · main — Claude Code ×2 실행 중" });
  });

  it("워크트리 줄·접힌 프로젝트 줄·호스트 줄도 같은 점을 받는다", () => {
    const panes = [pane({ state: "finished", host: "dev-01", start: "~/api-wt/fix" })];
    const dots = projectDots(panes, FOLDERS, HOME, koTr);
    expect(dots.worktree[worktreeDotKey("R", "/root/api-wt/fix")]?.state).toBe("finished");
    expect(dots.project.R?.state).toBe("finished");
    expect(hostDots(panes, koTr)["dev-01"]?.state).toBe("finished");
  });
});

describe("placeOf — 타일의 자리", () => {
  it("시작 폴더가 워크트리 폴더면 그 줄 (구분자·대소문자 무시)", () => {
    const f = placeOf(pane({ start: "c:\\SRC\\proj-wt\\feat-x" }), FOLDERS, NO_HOME);
    expect(f?.worktree).toBe("C:/src/proj-wt/feat-x");
  });

  it("지금 폴더(셸이 알려 준)가 시작 폴더를 이긴다 — cd 로 옮겨 간 타일", () => {
    const f = placeOf(pane({ start: "C:\\src\\proj", current: "C:\\src\\proj-wt\\feat-x\\src" }), FOLDERS, NO_HOME);
    expect(f?.worktree).toBe("C:/src/proj-wt/feat-x");
  });

  it("지금 폴더가 등록 폴더 밖이면 시작 폴더로", () => {
    const f = placeOf(pane({ start: "C:\\src\\proj-wt\\feat-x", current: "C:\\temp" }), FOLDERS, NO_HOME);
    expect(f?.worktree).toBe("C:/src/proj-wt/feat-x");
  });

  it("겹친 폴더는 가장 깊은 것 — 주 저장소 안의 워크트리", () => {
    const f = placeOf(pane({ current: "C:\\src\\proj\\.claude\\worktrees\\agent-1" }), FOLDERS, NO_HOME);
    expect(f?.worktree).toBe("C:/src/proj/.claude/worktrees/agent-1");
    const g = placeOf(pane({ current: "C:\\src\\proj\\src\\lib" }), FOLDERS, NO_HOME);
    expect(g?.worktree).toBe("C:/src/proj"); // 주 폴더 ≡ 주 워크트리 — 워크트리 줄이 이긴다
  });

  it("폴더 이름의 접두어만 같은 것은 안이 아니다", () => {
    expect(placeOf(pane({ start: "C:\\src\\proj-other" }), FOLDERS, NO_HOME)).toBeNull();
  });

  it("로컬 타일은 원격 폴더에, SSH 타일은 로컬 폴더에 서지 않는다", () => {
    expect(placeOf(pane({ start: "/root/api" }), FOLDERS, HOME)).toBeNull();
    expect(placeOf(pane({ host: "dev-01", start: "C:\\src\\proj" }), FOLDERS, HOME)).toBeNull();
    expect(placeOf(pane({ host: "other", start: "~/api" }), FOLDERS, HOME)).toBeNull();
  });

  it("원격은 홈으로 `~` 를 편다 — ~/api 타일 ≡ git 의 /root/api 줄 (별칭 대소문자 무시)", () => {
    const f = placeOf(pane({ host: "DEV-01", start: "~/api" }), FOLDERS, HOME);
    expect(f?.worktree).toBe("/root/api");
    const g = placeOf(pane({ host: "dev-01", start: "~/api", current: "/root/api-wt/fix/pkg" }), FOLDERS, HOME);
    expect(g?.worktree).toBe("/root/api-wt/fix");
  });

  it("홈을 모르면 글자 비교 — ~/api 는 주 폴더 자리(워크트리 줄 없음)", () => {
    const f = placeOf(pane({ host: "dev-01", start: "~/api" }), FOLDERS, NO_HOME);
    expect(f).toMatchObject({ projectId: "R", worktree: null });
  });

  it("목록을 안 읽은 프로젝트는 주 폴더 안의 타일을 잡는다", () => {
    const folders = projectFolders([LOCAL], () => undefined);
    const f = placeOf(pane({ current: "C:\\src\\proj\\src" }), folders, NO_HOME);
    expect(f).toMatchObject({ projectId: "L", worktree: null, label: "proj" });
  });
});

describe("projectDots — 워크트리 줄과 접힌 프로젝트 줄", () => {
  it("한 타일은 한 줄에만 — 두 번 세지 않는다", () => {
    const panes = [
      pane({ start: "C:\\src\\proj", current: "C:\\src\\proj\\.claude\\worktrees\\agent-1", state: "permission" }),
      pane({ start: "C:\\src\\proj", state: "running", name: "Codex" }),
    ];
    const dots = projectDots(panes, FOLDERS, NO_HOME, koTr);
    expect(dots.worktree[worktreeDotKey("L", "C:/src/proj/.claude/worktrees/agent-1")]).toEqual({
      state: "permission",
      label: "Claude Code 권한 대기",
    });
    expect(dots.worktree[worktreeDotKey("L", "C:/src/proj")]).toEqual({ state: "running", label: "Codex 실행 중" });
    expect(dots.project.L).toEqual({ state: "permission", label: "agent-1 — Claude Code 권한 대기 · main — Codex 실행 중" });
    expect(dots.project.R).toBeUndefined();
  });

  it("점이 없는 타일은 어느 줄에도 서지 않는다", () => {
    const dots = projectDots([pane({ start: "C:\\src\\proj", state: null })], FOLDERS, NO_HOME, koTr);
    expect(dots).toEqual({ project: {}, worktree: {}, main: {} });
  });

  it("원격 워크트리 줄 — 홈으로 편 뒤", () => {
    const dots = projectDots([pane({ host: "dev-01", start: "~/api-wt/fix", state: "finished" })], FOLDERS, HOME, koTr);
    expect(dots.worktree[worktreeDotKey("R", "/root/api-wt/fix")]?.state).toBe("finished");
    expect(dots.project.R?.label).toBe("fix — Claude Code 완료");
  });
});

describe("hostDots · groupDot — 호스트 독", () => {
  const panes = [
    pane({ host: "dev-01", state: "running" }),
    pane({ host: "DEV-01", state: "permission", name: "Codex" }),
    pane({ host: "lab-02", state: "finished" }),
    pane({ host: "lab-02", state: null, name: "Codex" }), // 점 없음 — 그리지 않는다
    pane({ host: null, state: "permission" }), // 로컬 — 호스트 독에 서지 않는다
  ];
  it("별칭(소문자)마다 접는다 · 로컬 타일은 없다", () => {
    const dots = hostDots(panes, koTr);
    expect(Object.keys(dots).sort()).toEqual(["dev-01", "lab-02"]);
    expect(dots["dev-01"]).toEqual({ state: "permission", label: "Codex 권한 대기 · Claude Code 실행 중" });
    expect(dots["lab-02"]).toEqual({ state: "finished", label: "Claude Code 완료" });
  });

  it("폴더는 하위 폴더까지 — 말풍선의 자리는 호스트 별칭", () => {
    const hosts = [
      { name: "dev-01", group: "lab" },
      { name: "lab-02", group: "lab/inner" },
      { name: "nas", group: "" },
    ];
    expect(groupDot("lab", hosts, panes, koTr)).toEqual({
      state: "permission",
      label: "dev-01 — Codex 권한 대기 · lab-02 — Claude Code 완료 · dev-01 — Claude Code 실행 중",
    });
    expect(groupDot("lab/inner", hosts, panes, koTr)?.state).toBe("finished");
    expect(groupDot("la", hosts, panes, koTr)).toBeNull(); // 이름 접두어는 안이 아니다
    expect(groupDot("", hosts, panes, koTr)).toBeNull();
  });
});

describe("dockWaiting — 독 입구는 권한 대기 · 완료만", () => {
  it("실행 중 · 점 없음은 부르지 않는다", () => {
    const panes = [
      pane({ host: "dev-01", state: "running" }),
      pane({ start: "C:\\src\\proj", state: null }),
    ];
    expect(dockWaiting(panes, FOLDERS, HOME)).toEqual({ hosts: false, projects: false });
  });

  it("원격 권한 대기는 호스트 쪽 — 프로젝트 폴더 안이면 프로젝트 쪽도", () => {
    expect(dockWaiting([pane({ host: "dev-01", start: "/tmp", state: "permission" })], FOLDERS, HOME)).toEqual({
      hosts: true,
      projects: false,
    });
    expect(dockWaiting([pane({ host: "dev-01", start: "~/api", state: "finished" })], FOLDERS, HOME)).toEqual({
      hosts: true,
      projects: true,
    });
  });

  it("로컬은 등록 폴더 안일 때만 프로젝트 쪽", () => {
    expect(dockWaiting([pane({ start: "C:\\Users\\me", state: "permission" })], FOLDERS, HOME)).toEqual({
      hosts: false,
      projects: false,
    });
    expect(dockWaiting([pane({ current: "C:\\src\\proj-wt\\feat-x", state: "finished" })], FOLDERS, HOME)).toEqual({
      hosts: false,
      projects: true,
    });
  });
});
