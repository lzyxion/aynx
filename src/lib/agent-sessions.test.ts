import { describe, expect, it } from "vitest";
import {
  conversationMatches,
  conversationPaletteEntries,
  OPEN_ELSEWHERE_WINDOW_MS,
  openElsewhere,
  otherWindowStream,
  parseConversationLinks,
  conversationLinkKey,
  RELEASE_GRACE_MS,
  conversationQuery,
  buildScopes,
  deleteBlock,
  forkCountOf,
  flatConversations,
  linkSurvivesCliStart,
  pathKey,
  RENAME_MAX_CHARS,
  registeredCwds,
  renameBlock,
  renameDraft,
  resumedConversationOf,
  sanitizeAgentLink,
  scopeLabelForPath,
  scopeLabelOf,
  shortenHome,
  switchesConversation,
  OTHER_DIRS_MAX,
  type AgentConversation,
  type ConversationList,
} from "$lib/agent-sessions";
import type { Project, WorktreeInfo } from "$lib/projects";

const P = (id: string, name: string, path: string, host: string | null = null): Project => ({
  id,
  name,
  host,
  path,
  shell: null,
  agent: "claude", setupScript: "", migration: null,
  tmux: false,
  worktreeDir: null,
});

const W = (path: string, branch: string | null): WorktreeInfo => ({ path, branch, head: null, bare: false, detached: false });

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


describe("pathKey — Rust worktree::comparable 과 같은 규칙", () => {
  it("Windows 꼴은 구분자·대소문자·끝 구분자를 편다", () => {
    expect(pathKey("C:\\Work\\Proj\\")).toBe("c:/work/proj");
    expect(pathKey("c:/work/proj")).toBe("c:/work/proj");
  });
  it("POSIX 꼴은 대소문자를 가린다", () => {
    expect(pathKey("/srv/App/")).toBe("/srv/App");
    expect(pathKey("/")).toBe("/");
  });
});

describe("registeredCwds", () => {
  it("로컬 프로젝트와 워크트리만, 겹침 없이", () => {
    const ps = [P("a", "aynx", "C:\\src\\aynx"), P("r", "api", "~/api", "dev-01")];
    const wt = (id: string) => (id === "a" ? [W("C:/src/aynx", "main"), W("C:/src/aynx-wt/x", "x")] : null);
    expect(registeredCwds(ps, wt)).toEqual(["C:\\src\\aynx", "C:/src/aynx-wt/x"]);
  });
});

describe("buildScopes", () => {
  const ps = [P("a", "aynx", "C:\\src\\aynx"), P("b", "infra", "C:\\src\\infra")];
  const wt = (id: string) => (id === "a" ? [W("C:/src/aynx", "main"), W("C:/src/aynx-wt/x", "feat-x")] : null);
  const main1 = C("C:\\src\\aynx", 300);
  const wt1 = C("C:\\src\\aynx-wt\\x", 500);
  const other1 = C("C:\\Users\\me\\scratch", 400);
  const other2 = C("C:\\Users\\me\\scratch", 100);
  const gone = C("C:\\Users\\me\\old", 50, { cwdExists: false });
  const list: ConversationList = {
    groups: [
      { cwd: "C:\\src\\aynx", exists: true, sessions: [main1], more: false },
      { cwd: "C:/src/aynx-wt/x", exists: false, sessions: [wt1], more: false },
      { cwd: "C:\\src\\infra", exists: true, sessions: [], more: false },
    ],
    others: [other2, gone, other1],
    othersMore: false,
  };

  it("프로젝트 줄 = 워크트리를 합친 것 · 워크트리 줄 · 기타와 폴더 줄", () => {
    const s = buildScopes(ps, wt, list, "C:\\Users\\me");
    expect(s.rows.map((r) => [r.kind, r.label, r.count, r.depth])).toEqual([
      ["project", "aynx", 2, 0],
      ["worktree", "main", 1, 1],
      ["worktree", "feat-x", 1, 1],
      ["project", "infra", 0, 0],
      ["others", "", 3, 0],
      ["otherDir", "~/scratch", 2, 1],
      ["otherDir", "~/old", 1, 1],
    ]);
    expect(s.conversations.get("p:a")?.map((c) => c.id)).toEqual([wt1.id, main1.id]);
    expect(s.conversations.get("o")?.map((c) => c.id)).toEqual([other1.id, other2.id, gone.id]);
    const missing = s.rows.filter((r) => r.missing).map((r) => r.label);
    expect(missing).toEqual(["feat-x", "~/old"]);
  });

  it("워크트리가 주 폴더 하나뿐이면 워크트리 줄이 없다", () => {
    const s = buildScopes([P("b", "infra", "C:\\src\\infra")], () => [W("C:/src/infra", "main")], list, null);
    expect(s.rows.filter((r) => r.kind === "worktree")).toEqual([]);
  });

  it("기타 폴더 줄은 최신 폴더부터 상한까지", () => {
    const many: AgentConversation[] = [];
    for (let i = 0; i < OTHER_DIRS_MAX + 5; i++) many.push(C(`/tmp/d${i}`, 1000 - i));
    const s = buildScopes([], () => null, { groups: [], others: many, othersMore: false }, null);
    const dirs = s.rows.filter((r) => r.kind === "otherDir");
    expect(dirs.length).toBe(OTHER_DIRS_MAX);
    expect(dirs[0].label).toBe("/tmp/d0");
    expect(s.rows.find((r) => r.kind === "others")?.count).toBe(OTHER_DIRS_MAX + 5);
  });

  it("아직 안 읽었으면 프로젝트 줄만(0)", () => {
    const s = buildScopes(ps, () => null, null, null);
    expect(s.rows.map((r) => r.count)).toEqual([0, 0]);
  });

  it("범위 이름 — 워크트리는 '프로젝트 · 워크트리', 기타는 줄인 경로", () => {
    const s = buildScopes(ps, wt, list, "C:\\Users\\me");
    expect(scopeLabelOf(wt1, s.rows)).toBe("aynx · feat-x");
    expect(scopeLabelOf(main1, s.rows)).toBe("aynx");
    expect(scopeLabelOf(other1, s.rows)).toBe("~/scratch");
  });

  it("폴더의 범위 이름(메신저 알림) — 등록 범위 안만, 밖이면 null · 목록을 안 읽어도 된다", () => {
    const s = buildScopes(ps, wt, null, null);
    expect(scopeLabelForPath("C:\\src\\aynx-wt\\x\\src\\lib", s.rows)).toBe("aynx · feat-x");
    expect(scopeLabelForPath("c:/src/aynx", s.rows)).toBe("aynx");
    expect(scopeLabelForPath("D:\\elsewhere", s.rows)).toBe(null);
  });
});

describe("펴기", () => {
  it("펴기 — 묶음과 기타를 합쳐 최신순, 겹침 없이", () => {
    const a = C("/a", 1);
    const b = C("/b", 3);
    const list: ConversationList = {
      groups: [
        { cwd: "/a", exists: true, sessions: [a], more: false },
        { cwd: "/a/x", exists: true, sessions: [a], more: false },
      ],
      others: [b],
      othersMore: false,
    };
    expect(flatConversations(list).map((c) => c.id)).toEqual([b.id, a.id]);
    expect(flatConversations(null)).toEqual([]);
  });

  it("집 폴더 줄이기 — 경계에서만", () => {
    expect(shortenHome("C:\\Users\\me\\x\\y", "C:\\Users\\me")).toBe("~/x/y");
    expect(shortenHome("C:\\Users\\meow", "C:\\Users\\me")).toBe("C:\\Users\\meow");
    expect(shortenHome("/home/me", "/home/me")).toBe("~");
    expect(shortenHome("/x", null)).toBe("/x");
  });
});

describe("팔레트 — 대화 접두사", () => {
  it("낱말 + 빈칸, 또는 낱말뿐", () => {
    expect(conversationQuery("대화 build")).toBe("build");
    expect(conversationQuery("  대화")).toBe("");
    expect(conversationQuery("conv  fix it ")).toBe("fix it");
    expect(conversationQuery("CONV x")).toBe("x");
    expect(conversationQuery("대화방")).toBe(null);
    expect(conversationQuery("convert")).toBe(null);
    expect(conversationQuery("web-01")).toBe(null);
  });

  it("줄 = 최신순 · 범위 이름 · 열림/경로 없음", () => {
    const ps = [P("a", "aynx", "/src/aynx")];
    const a = C("/src/aynx", 10);
    const b = C("/gone", 20, { cwdExists: false, titleSource: "fallback" });
    const list: ConversationList = {
      groups: [{ cwd: "/src/aynx", exists: true, sessions: [a], more: false }],
      others: [b],
      othersMore: false,
    };
    const rows = buildScopes(ps, () => null, list, null).rows;
    const e = conversationPaletteEntries(list, rows, (_agent, id) => id === a.id);
    expect(e.map((x) => [x.id, x.scope, x.state, x.fallback])).toEqual([
      [b.id, "/gone", "missing", true],
      [a.id, "aynx", "open", false],
    ]);
  });

  it("밖에서 열림 — 연결된 타일이 없고 파일이 방금(창 안) 고쳐졌다", () => {
    const now = 1_000_000_000;
    expect(OPEN_ELSEWHERE_WINDOW_MS).toBe(120_000);
    expect(openElsewhere({ updatedAt: now - 30_000 }, now, false)).toBe(true);
    expect(openElsewhere({ updatedAt: now - 30_000 }, now, true)).toBe(false); // aynx 타일에 열려 있다 — "열림"
    expect(openElsewhere({ updatedAt: now - OPEN_ELSEWHERE_WINDOW_MS }, now, false)).toBe(false);
    const ps = [P("a", "aynx", "/src/aynx")];
    const hot = C("/src/aynx", now - 10_000);
    const old = C("/src/aynx", now - 3 * OPEN_ELSEWHERE_WINDOW_MS);
    const linked = C("/src/aynx", now - 5_000);
    const list: ConversationList = {
      groups: [{ cwd: "/src/aynx", exists: true, sessions: [hot, old, linked], more: false }],
      others: [],
      othersMore: false,
    };
    const rows = buildScopes(ps, () => null, list, null).rows;
    const e = conversationPaletteEntries(list, rows, (_agent, id) => id === linked.id, now);
    expect(Object.fromEntries(e.map((x) => [x.id, x.state]))).toEqual({
      [hot.id]: "elsewhere",
      [old.id]: "ok",
      [linked.id]: "open",
    });
  });

  it("밖에서 열림 — 세션 서버 장부의 놓인 시각(Rust agent_state::convo::busy 와 같은 규칙)", () => {
    const now = 1_000_000_000;
    expect(RELEASE_GRACE_MS).toBe(5_000);
    const s = { updatedAt: now - 30_000 };
    // 기록 없음 — 예전 규칙
    expect(openElsewhere(s, now, false, null)).toBe(true);
    // 타일을 닫은 뒤 쓰기가 없다(닫기 전 쓰기) — 밖에서 열림이 아니다
    expect(openElsewhere(s, now, false, now - 20_000)).toBe(false);
    // 놓인 뒤 한참 늦게 쓰였다 — 밖에서 열렸다
    expect(openElsewhere(s, now, false, now - 60_000)).toBe(true);
    // 유예 끝
    const r = now - 60_000;
    expect(openElsewhere({ updatedAt: r + RELEASE_GRACE_MS }, now, false, r)).toBe(false);
    expect(openElsewhere({ updatedAt: r + RELEASE_GRACE_MS + 1 }, now, false, r)).toBe(true);
    // 연결돼 있으면 놓인 시각과 무관 · 창 밖이면 무관
    expect(openElsewhere(s, now, true, null)).toBe(false);
    expect(openElsewhere({ updatedAt: now - OPEN_ELSEWHERE_WINDOW_MS }, now, false, null)).toBe(false);
    // 팔레트도 같은 판정을 쓴다
    const ps = [P("a", "aynx", "/src/aynx")];
    const closed = C("/src/aynx", now - 10_000);
    const list: ConversationList = { groups: [{ cwd: "/src/aynx", exists: true, sessions: [closed], more: false }], others: [], othersMore: false };
    const rows = buildScopes(ps, () => null, list, null).rows;
    expect(conversationPaletteEntries(list, rows, () => false, now, () => now - 8_000)[0].state).toBe("ok");
    expect(conversationPaletteEntries(list, rows, () => false, now)[0].state).toBe("elsewhere");
  });

  it("장부 — 답 읽기 · 다른 창의 스트림", () => {
    const m = parseConversationLinks([
      { agent: "claude", id: "AAAA-1", streams: ["s1", "s2"], releasedAt: null },
      { agent: "codex", id: "bbbb-2", streams: [], releasedAt: 123 },
      { agent: "codex", id: 5, streams: [] },
      "junk",
    ]);
    expect([...m.keys()]).toEqual([conversationLinkKey("claude", "aaaa-1"), "codex:bbbb-2"]);
    expect(m.get("claude:aaaa-1")?.id).toBe("aaaa-1");
    expect(m.get("codex:bbbb-2")?.releasedAt).toBe(123);
    expect(parseConversationLinks(null).size).toBe(0);
    const row = m.get("claude:aaaa-1");
    expect(otherWindowStream(row, (st) => st === "s1")).toBe("s2");
    expect(otherWindowStream(row, () => true)).toBeNull(); // 모두 이 창 것 — 이 창의 연결 표가 정한다
    expect(otherWindowStream(undefined, () => false)).toBeNull();
    expect(otherWindowStream(m.get("codex:bbbb-2"), () => false)).toBeNull(); // 놓였다
  });
});

describe("실기 발견 (2026-09-26)", () => {
  it("같은 대화가 한 묶음에 두 번 와도 프로젝트 수 ≥ 워크트리 수, 오른쪽 줄 수 = 범위 수", () => {
    // 프로젝트 경로는 역슬래시, git 이 적은 주 워크트리는 슬래시 — 같은 폴더로 읽혀야 한다
    const ps = [P("a", "Aynx", "C:\\src\\aynx")];
    const wt = () => [W("C:/src/aynx", "main"), W("C:/src/aynx-wt/x", "x")];
    const dup = C("C:\\src\\aynx", 900, { agent: "codex" });
    const older = { ...dup, updatedAt: 100 };
    const other = C("C:\\src\\aynx", 500);
    const list: ConversationList = {
      groups: [
        { cwd: "C:\\src\\aynx", exists: true, sessions: [dup, other, older], more: false },
        { cwd: "C:/src/aynx-wt/x", exists: true, sessions: [C("C:/src/aynx-wt/x", 50)], more: false },
      ],
      others: [],
      othersMore: false,
    };
    const s = buildScopes(ps, wt, list, null);
    const count = (label: string) => s.rows.find((r) => r.label === label)?.count;
    expect(count("Aynx")).toBe(3);
    expect(count("main")).toBe(2);
    for (const r of s.rows) expect(s.conversations.get(r.key)?.length ?? 0).toBe(r.count);
    expect(s.conversations.get(s.rows.find((r) => r.label === "main")!.key)?.[0].updatedAt).toBe(900);
  });

  it("팔레트 찾기는 부분 글자 — 흩어진 글자는 걸리지 않는다", () => {
    const e = (title: string, scope = "aynx") => ({ title, scope });
    expect(conversationMatches("resume", e("Aynx resume test"))).toBe(true);
    expect(conversationMatches("resume", e("WindTerm에서는 아래 Terminal 설정을 쓰세요"))).toBe(false);
    expect(conversationMatches("RESUME test", e("Aynx resume test"))).toBe(true);
    expect(conversationMatches("resume other", e("Aynx resume test"))).toBe(false);
    expect(conversationMatches("feat", e("x", "aynx · feat-y"))).toBe(true);
    expect(conversationMatches("  ", e("anything"))).toBe(true);
  });
});

describe("타일 ↔ 대화 연결의 재료 (연결의 수명 = 세션)", () => {
  const U = "11111111-2222-4333-8444-000000000001";
  it("resumedConversationOf — Claude 재개 한 줄만 (소문자로)", () => {
    expect(resumedConversationOf(`claude --resume ${U}`)).toEqual({ agent: "claude", id: U });
    expect(resumedConversationOf(`  claude  --resume ${U.toUpperCase()} `)).toEqual({ agent: "claude", id: U });
  });
  it("resumedConversationOf — Codex 재개(UUIDv7 · --no-daemon 자리 둘)", () => {
    const V7 = "01a0dc8b-6ce8-77f1-9b8d-82e8a23c8840";
    for (const cmd of [`codex resume ${V7}`, `codex resume --no-daemon ${V7}`, `codex --no-daemon resume ${V7.toUpperCase()}`]) {
      expect(resumedConversationOf(cmd)).toEqual({ agent: "codex", id: V7 });
    }
  });
  it("resumedConversationOf — 포크 · 다른 명령 · 모양이 틀린 id 는 잇지 않는다", () => {
    for (const cmd of [
      `claude --resume ${U} --fork-session`,
      `codex fork ${U}`,
      `codex fork --no-daemon ${U}`,
      `codex resume`,
      `codex resume not-a-uuid`,
      `codex --no-daemon resume --no-daemon ${U}`,
      `codex resume ${U} --last`,
      `codex --remote ws://x resume ${U}`,
      `npx codex resume ${U}`,
      `codex resume ${U}; rm -rf /`,
      "claude",
      "claude --resume",
      "claude --resume not-a-uuid",
      `claude --continue ${U}`,
      `claude --resume ${U}; rm -rf /`,
      "",
      null,
      undefined,
    ]) {
      expect(resumedConversationOf(cmd)).toBeNull();
    }
  });
  it("resumedConversationOf — 설정의 추가 인자가 놓인 줄도 (id 는 여전히 엄격)", () => {
    const V7 = "01a0dc8b-6ce8-77f1-9b8d-82e8a23c8840";
    for (const cmd of [
      `claude --resume ${U} --model opus`,
      `claude --resume ${U} --model opus --settings C:/x/claude-settings-default.json`,
      `claude --resume ${U} --append-system-prompt 'be brief'`,
    ]) {
      expect(resumedConversationOf(cmd)).toEqual({ agent: "claude", id: U });
    }
    for (const cmd of [
      `codex resume --model o3 ${V7}`,
      `codex resume --no-daemon --model o3 -c 'x=1' ${V7}`,
      `codex --no-daemon resume --model o3 ${V7}`,
    ]) {
      expect(resumedConversationOf(cmd)).toEqual({ agent: "codex", id: V7 });
    }
    for (const cmd of [
      `claude --resume ${U} --model opus --fork-session`,
      `claude --resume ${U} --session-id=${U}`,
      `claude --resume ${U} --model opus; calc`,
      `claude --resume ${U} $(calc)`,
      `claude --resume ${U} -r ${U}`,
      `codex resume --last ${V7}`,
      `codex resume --remote ws://x ${V7}`,
      `codex resume --model o3 ${V7} extra`,
      `codex resume other ${V7}`,
      `codex resume --model o3|calc ${V7}`,
      `codex fork --no-daemon --model o3 ${V7}`,
      `codex resume --model o3 not-a-uuid`,
    ]) {
      expect(resumedConversationOf(cmd)).toBeNull();
    }
  });
  it("sanitizeAgentLink — 이관 짐의 연결은 모양이 맞을 때만", () => {
    expect(sanitizeAgentLink({ agent: "claude", id: U.toUpperCase() })).toEqual({ agent: "claude", id: U });
    for (const raw of [null, undefined, 3, "x", {}, { agent: "claude" }, { agent: "claude", id: "nope" }, { agent: "Claude Code", id: U }, { agent: 1, id: U }]) {
      expect(sanitizeAgentLink(raw)).toBeNull();
    }
  });
});

describe("새 CLI · 대화 바꾸기 — Codex 는 첫 질문 전에 대화 신호가 없다 (2026-10-20)", () => {
  it("linkSurvivesCliStart — 띄우며 적은 연결(재개)만 남고, 훅 · 명세 사본으로 선 연결은 새 CLI 에서 버린다", () => {
    expect(linkSurvivesCliStart(null)).toBe(true);
    expect(linkSurvivesCliStart(undefined)).toBe(true);
    expect(linkSurvivesCliStart({ launch: true })).toBe(true);
    expect(linkSurvivesCliStart({ launch: false })).toBe(false);
  });

  it("switchesConversation — Codex 의 /new · /clear · /resume · /fork 한 줄만", () => {
    for (const c of ["/new", "/clear", "/resume", "/fork", "  /new  ", "/resume 0199a1b2-0000-7000-8000-000000000000", "/NEW"]) {
      expect(switchesConversation("codex", c)).toBe(true);
    }
    for (const c of ["/status", "/newx", "new", "다음 /new", "/new\n두 줄", "/compact", ""]) {
      expect(switchesConversation("codex", c)).toBe(false);
    }
  });

  it("switchesConversation — Claude 는 건드리지 않는다(SessionStart 가 곧바로 고쳐 적는다)", () => {
    expect(switchesConversation("claude", "/clear")).toBe(false);
    expect(switchesConversation("claude", "/resume")).toBe(false);
  });
});

describe("이름 바꾸기", () => {
  it("renameDraft — 공백을 접고, 그대로 · 빈 이름 · 너무 긴 이름을 가른다", () => {
    expect(renameDraft("  새\n  이름\t ", "옛 이름")).toEqual({ kind: "ok", name: "새 이름" });
    expect(renameDraft(" 옛  이름 ", "옛 이름")).toEqual({ kind: "same" });
    expect(renameDraft(" \n ", "옛 이름")).toEqual({ kind: "empty" });
    const max = "가".repeat(RENAME_MAX_CHARS);
    expect(renameDraft(max, "x")).toEqual({ kind: "ok", name: max });
    expect(renameDraft(`${max}x`, "x")).toEqual({ kind: "tooLong" });
    // BMP 밖 글자는 한 글자로 센다(Rust 의 chars 와 같다)
    expect(renameDraft("😀".repeat(RENAME_MAX_CHARS), "x").kind).toBe("ok");
  });

  it("renameBlock — 원격 → 열림 → 밖에서 열림 순서", () => {
    expect(renameBlock({ remote: true, open: true, elsewhere: true })).toBe("remote");
    expect(renameBlock({ remote: false, open: true, elsewhere: true })).toBe("open");
    expect(renameBlock({ remote: false, open: false, elsewhere: true })).toBe("elsewhere");
    expect(renameBlock({ remote: false, open: false, elsewhere: false })).toBeNull();
  });
});

describe("삭제", () => {
  it("forkCountOf — 같은 에이전트 · forkedFrom 이 이 id(대소문자 무관)인 것만 센다", () => {
    const parent = C("/w", 1, { agent: "codex", id: "AAAAAAAA-0000-4000-8000-000000000001" });
    const all = [
      parent,
      C("/w", 2, { agent: "codex", forkedFrom: "aaaaaaaa-0000-4000-8000-000000000001" }),
      C("/w", 3, { agent: "codex", forkedFrom: "AAAAAAAA-0000-4000-8000-000000000001" }),
      // 다른 에이전트의 같은 글자 · 다른 부모 · 포크 아님은 세지 않는다
      C("/w", 4, { agent: "claude", forkedFrom: "aaaaaaaa-0000-4000-8000-000000000001" }),
      C("/w", 5, { agent: "codex", forkedFrom: "bbbbbbbb-0000-4000-8000-000000000001" }),
      C("/w", 6, { agent: "codex" }),
    ];
    expect(forkCountOf(all, parent)).toBe(2);
    expect(forkCountOf(all, all[1]!)).toBe(0);
    expect(forkCountOf([], parent)).toBe(0);
  });

  it("deleteBlock — 열림 → 사이드 채팅 → 밖에서 열림 → 갈라 나간 대화 순서", () => {
    expect(deleteBlock({ open: true, sideChat: true, elsewhere: true, forks: 3 })).toBe("open");
    expect(deleteBlock({ open: false, sideChat: true, elsewhere: true, forks: 3 })).toBe("side-chat");
    expect(deleteBlock({ open: false, sideChat: false, elsewhere: true, forks: 3 })).toBe("elsewhere");
    expect(deleteBlock({ open: false, sideChat: false, elsewhere: false, forks: 1 })).toBe("forks");
    expect(deleteBlock({ open: false, sideChat: false, elsewhere: false, forks: 0 })).toBeNull();
  });
});
