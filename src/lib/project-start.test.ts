import { describe, expect, it } from "vitest";
import type { AgentConversation, ConversationList } from "$lib/agent-sessions";
import {
  leafOf,
  newAiPane,
  newLocalFsPane,
  newLocalPane,
  newProjectStartPane,
  newStartPane,
  type PaneNode,
  type PaneSpec,
  type TabSpec,
} from "$lib/session";
import {
  conversationTarget,
  conversationsInFolder,
  defaultStartIndex,
  isWorktreeTab,
  keyLetter,
  moveStartSelection,
  shouldShowStartScreen,
  startActionForKey,
  startKeyOf,
  START_KEYS,
  defaultStartAction,
  type StartAction,
} from "$lib/project-start";

let n = 0;
const C = (cwd: string, updatedAt: number, extra: Partial<AgentConversation> = {}): AgentConversation => ({
  agent: "claude",
  id: `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`,
  cwd,
  branch: "main",
  title: `t${n}`,
  titleSource: "ai",
  startedAt: null,
  updatedAt,
  model: null,
  forkedFrom: null,
  cwdExists: true,
  ...extra,
});

const MAIN = "C:\\src\\aynx";
const FEAT = "C:/src/aynx-wt/feat";

describe("conversationsInFolder — 기록된 시작 폴더가 그 폴더와 같은 대화", () => {
  const a = C(MAIN, 10);
  const b = C("c:/SRC/aynx/", 30); // 같은 폴더(구분자 · 대소문자 · 끝 구분자)
  const sub = C("C:\\src\\aynx\\sub", 40); // 하위 폴더는 아니다
  const other = C("C:\\elsewhere", 50);
  const list: ConversationList = {
    groups: [{ cwd: MAIN, exists: true, sessions: [a, sub], more: false }],
    others: [b, other],
    othersMore: false,
  };

  it("묶음·기타를 가리지 않고 같은 폴더만 · 최신순", () => {
    expect(conversationsInFolder(list, MAIN).map((s) => s.id)).toEqual([b.id, a.id]);
  });

  it("같은 대화는 한 번", () => {
    const dup: ConversationList = { ...list, others: [...list.others, a] };
    expect(conversationsInFolder(dup, MAIN)).toHaveLength(2);
  });

  it("목록이 없거나 폴더가 비면 빈 목록", () => {
    expect(conversationsInFolder(null, MAIN)).toEqual([]);
    expect(conversationsInFolder(list, "  ")).toEqual([]);
  });

  it("시작 화면은 auto 면 늘 — 대화가 없는 폴더도(2026-09-27), off 면 아니다", () => {
    expect(shouldShowStartScreen("auto")).toBe(true);
    expect(shouldShowStartScreen("off")).toBe(false);
  });
});

describe("새로 시작 — 글자 키", () => {
  const actions: StartAction[] = [
    { kind: "shell" },
    { kind: "ai", id: "claude", command: "claude", name: "Claude Code" },
    { kind: "ai", id: "codex", command: "codex", name: "Codex" },
    { kind: "ai", id: "gemini", command: "gemini", name: "Gemini" },
  ];
  type Mods = Partial<{
    ctrlKey: boolean;
    altKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    isComposing: boolean;
    key: string;
  }>;
  const ev = (code: string, mods: Mods = {}) => ({
    code,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    shiftKey: false,
    ...mods,
  });

  it("S · C · X 는 서로 겹치지 않고 표에 없는 CLI 는 글자가 없다 (시작 명령 R 은 2026-09-28 에 없어졌다)", () => {
    expect(actions.map(startKeyOf)).toEqual(["KeyS", "KeyC", "KeyX", null]);
    expect(Object.keys(START_KEYS)).toEqual(["shell", "claude", "codex"]);
    const codes = Object.values(START_KEYS);
    expect(new Set(codes).size).toBe(codes.length);
    expect(keyLetter("KeyS")).toBe("S");
  });

  it("수식 없는 글자만 — Shift · Ctrl · Alt · Meta 는 흘려보낸다", () => {
    expect(startActionForKey(ev("KeyC"), actions)).toEqual(actions[1]);
    expect(startActionForKey(ev("KeyX"), actions)).toEqual(actions[2]);
    expect(startActionForKey(ev("KeyR"), actions)).toBeNull();
    expect(startActionForKey(ev("KeyS", { shiftKey: true }), actions)).toBeNull();
    expect(startActionForKey(ev("KeyX", { ctrlKey: true, shiftKey: true }), actions)).toBeNull();
    expect(startActionForKey(ev("KeyS", { altKey: true }), actions)).toBeNull();
    expect(startActionForKey(ev("KeyQ"), actions)).toBeNull();
  });

  it("물리 키로 가른다 — 한글 자판의 ㄴ(KeyS)도 셸 · IME 조합 중은 아니다", () => {
    expect(startActionForKey(ev("KeyS", { key: "ㄴ" }), actions)).toEqual({ kind: "shell" });
    expect(startActionForKey(ev("KeyS", { isComposing: true }), actions)).toBeNull();
    expect(startActionForKey(ev("KeyS", { key: "Process" }), actions)).toBeNull();
  });

  it("그 단추가 없으면 글자도 없다 (Codex 가 깔리지 않았으면 X)", () => {
    expect(startActionForKey(ev("KeyX"), actions.slice(0, 2))).toBeNull();
  });

  it("기본 단추 = 프로젝트의 에이전트 — 없으면(셸) · 깔리지 않았으면 셸 (docs/log/2026-09-28-project-agent-setup-script.md)", () => {
    expect(defaultStartAction(actions, "codex")).toEqual(actions[2]);
    expect(defaultStartAction(actions, "claude")).toEqual(actions[1]);
    expect(defaultStartAction(actions, null)).toEqual({ kind: "shell" });
    expect(defaultStartAction(actions.slice(0, 2), "codex")).toEqual({ kind: "shell" });
    expect(defaultStartAction([], "claude")).toBeNull();
  });

  it("↑↓ 는 감싸지 않는다", () => {
    expect(moveStartSelection(3, 0, "up")).toBe(0);
    expect(moveStartSelection(3, 0, "down")).toBe(1);
    expect(moveStartSelection(3, 2, "down")).toBe(2);
    expect(moveStartSelection(3, 9, "up")).toBe(1);
    expect(moveStartSelection(0, 0, "down")).toBe(-1);
    expect(moveStartSelection(3, -1, "down")).toBe(0);
  });

  it("처음 고르는 줄 — 밖에서 열린 대화는 건너뛴다 · 전부 그렇다면 아무것도", () => {
    expect(defaultStartIndex([false, false])).toBe(0);
    expect(defaultStartIndex([true, false, false])).toBe(1);
    expect(defaultStartIndex([true, true])).toBe(-1);
    expect(defaultStartIndex([])).toBe(-1);
  });
});

describe("conversationTarget — 재개가 갈 자리", () => {
  const split = (a: PaneNode, b: PaneNode): PaneNode => ({ type: "split", dir: "row", ratio: 0.5, a, b });
  const tab = (id: string, root: PaneNode): TabSpec => ({ id, title: id, root });
  const local = (cwd?: string): PaneSpec => {
    const p = newLocalPane("pwsh");
    if (cwd) p.cwd = cwd;
    return p;
  };

  it("1. 같은 폴더의 시작 화면 — 분할 안에 있어도 그 자리 · 지금 탭이 먼저", () => {
    const s1 = newProjectStartPane("P1", MAIN);
    const s2 = newProjectStartPane("P1", "c:/src/aynx/");
    const tabs = [tab("t1", split(leafOf(local("C:/x")), leafOf(s1))), tab("t2", leafOf(s2))];
    expect(conversationTarget(tabs, "t1", MAIN)).toEqual({
      kind: "replace",
      reason: "startScreen",
      tabId: "t1",
      paneId: s1.id,
    });
    expect(conversationTarget(tabs, "t2", MAIN)).toEqual({
      kind: "replace",
      reason: "startScreen",
      tabId: "t2",
      paneId: s2.id,
    });
  });

  it("1 이 2 보다 먼저 — 워크트리 탭이 있어도 시작 화면이 이긴다", () => {
    const s = newProjectStartPane("P1", MAIN);
    const tabs = [tab("wt", leafOf(newAiPane("claude", MAIN))), tab("st", leafOf(s))];
    expect(conversationTarget(tabs, "wt", MAIN).kind).toBe("replace");
  });

  it("다른 폴더의 시작 화면은 아니다", () => {
    const tabs = [tab("t1", leafOf(newProjectStartPane("P1", FEAT)))];
    expect(conversationTarget(tabs, "t1", MAIN)).toEqual({ kind: "newTab" });
  });

  it("2. 워크트리 탭 — 모든 타일이 그 폴더에서 시작한 로컬 셸", () => {
    const home = tab("wt", split(leafOf(newAiPane("claude", MAIN)), leafOf(local("c:/src/aynx"))));
    const mixed = tab("mix", split(leafOf(newAiPane("claude", MAIN)), leafOf(newLocalFsPane(MAIN))));
    const other = tab("other", leafOf(local("C:/else")));
    expect(conversationTarget([other, mixed, home], "other", MAIN)).toEqual({ kind: "tab", tabId: "wt" });
  });

  it("2 의 판정 — 폴더 없는 로컬 셸 · 파일 타일 · 다른 폴더가 섞이면 아니다", () => {
    const k = "c:/src/aynx";
    expect(isWorktreeTab(tab("a", leafOf(local(MAIN))), k)).toBe(true);
    expect(isWorktreeTab(tab("b", leafOf(local())), k)).toBe(false);
    expect(isWorktreeTab(tab("c", split(leafOf(local(MAIN)), leafOf(local(FEAT)))), k)).toBe(false);
    expect(isWorktreeTab(tab("d", split(leafOf(local(MAIN)), leafOf(newLocalFsPane(MAIN)))), k)).toBe(false);
    expect(isWorktreeTab(tab("e", split(leafOf(local(MAIN)), leafOf(newProjectStartPane("P", MAIN)))), k)).toBe(
      true,
    );
  });

  it("2 는 지금 탭을 먼저", () => {
    const tabs = [tab("w1", leafOf(local(MAIN))), tab("w2", leafOf(local(MAIN)))];
    expect(conversationTarget(tabs, "w2", MAIN)).toEqual({ kind: "tab", tabId: "w2" });
    expect(conversationTarget(tabs, "zz", MAIN)).toEqual({ kind: "tab", tabId: "w1" });
  });

  it("3. 지금 탭이 빈 launcher 하나면 그 자리", () => {
    const l = newStartPane();
    const tabs = [tab("busy", leafOf(local("C:/else"))), tab("empty", leafOf(l))];
    expect(conversationTarget(tabs, "empty", MAIN)).toEqual({
      kind: "replace",
      reason: "launcher",
      tabId: "empty",
      paneId: l.id,
    });
    // 지금 탭이 아니면 아니다
    expect(conversationTarget(tabs, "busy", MAIN)).toEqual({ kind: "newTab" });
  });

  it("3 의 launcher 는 빈 탭뿐 — 다른 폴더의 시작 화면 · 분할 안의 launcher 는 아니다", () => {
    const startOther = tab("s", leafOf(newProjectStartPane("P2", FEAT)));
    expect(conversationTarget([startOther], "s", MAIN)).toEqual({ kind: "newTab" });
    const splitLauncher = tab("x", split(leafOf(newStartPane()), leafOf(local("C:/else"))));
    expect(conversationTarget([splitLauncher], "x", MAIN)).toEqual({ kind: "newTab" });
  });

  it("4. 아니면 새 탭 (탭이 하나도 없어도)", () => {
    expect(conversationTarget([], null, MAIN)).toEqual({ kind: "newTab" });
    expect(conversationTarget([tab("t", leafOf(local("C:/else")))], "t", MAIN)).toEqual({ kind: "newTab" });
  });
});
