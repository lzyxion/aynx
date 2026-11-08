import { describe, expect, it } from "vitest";
import {
  LEGACY_SIDE_CHAT_PREFIX,
  legacySideChatStream,
  mergeSideChats,
  newSideChatId,
  parseSideChats,
  pickSideChatCli,
  serializeSideChats,
  sideChatCliOk,
  sideChatConvBadge,
  sideChatConvMark,
  sideChatConversation,
  sideChatCwdLabel,
  sideChatEffortChoices,
  sideChatForkFrom,
  sideChatForkSource,
  sideChatForkTitle,
  sideChatOpenMode,
  sideChatIdOk,
  sideChatModelChoices,
  sideChatModelOk,
  sideChatNewDefault,
  sideChatPickFor,
  sideChatSwitchPick,
  rememberSideChatPick,
  sideChatTitleFrom,
  sortSideChats,
  type SideChat,
  type SideChatLast,
} from "$lib/side-chat";

const ID = "0123456789abcdef";
const UUID = "0198a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b";

function chat(over: Partial<SideChat> = {}): SideChat {
  return {
    id: ID,
    cli: "claude",
    model: "",
    effort: "",
    title: "",
    createdAt: 1,
    usedAt: 0,
    used: [],
    links: {},
    tile: null,
    forkedFrom: null,
    cwd: "",
    ...over,
  };
}

describe("타일 대화 이어 가기(v2 6단계)", () => {
  const LINK = { agent: "claude", id: UUID.toUpperCase() };

  it("메뉴 줄 — 주 창의 로컬 타일 · 대화 연결을 알고 사이드 채팅 CLI 일 때만", () => {
    expect(sideChatForkSource("local", true, LINK)).toEqual({ agent: "claude", conv: UUID });
    expect(sideChatForkSource("local", true, { agent: "codex", id: UUID })).toEqual({ agent: "codex", conv: UUID });
    expect(sideChatForkSource("local", false, LINK), "보조 창").toBeNull();
    expect(sideChatForkSource("ssh", true, LINK), "원격 대화는 이 PC 의 CLI 가 갈라 올 수 없다").toBeNull();
    expect(sideChatForkSource("local", true, null), "대화를 모른다").toBeNull();
    expect(sideChatForkSource("local", true, { agent: "gemini", id: UUID })).toBeNull();
    expect(sideChatForkSource("local", true, { agent: "claude", id: "../x" })).toBeNull();
  });

  it("여는 모양 — 원본을 그냥 이어 가는 모양은 없다", () => {
    expect(sideChatOpenMode(null, null)).toEqual({ kind: "fresh" });
    expect(sideChatOpenMode(null, UUID)).toEqual({ kind: "fork", from: UUID });
    expect(sideChatOpenMode(UUID, null)).toEqual({ kind: "resume", conv: UUID });
    const own = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
    expect(sideChatOpenMode(own, UUID), "턴이 선 뒤 = 자기 새 대화를 그 폴더에서").toEqual({ kind: "resume", conv: own, project: true });
  });

  it("갈라 올 원본은 그 CLI 일 때만 · 저장 왕복 · 틀린 칸은 버린다", () => {
    const c = chat({ forkedFrom: { agent: "codex", conv: UUID }, cwd: "C:/w/proj" });
    expect(sideChatForkFrom(c, "codex")).toBe(UUID);
    expect(sideChatForkFrom(c, "claude"), "CLI 를 바꾸면 새 대화").toBeNull();
    const f = parseSideChats(serializeSideChats({ current: ID, last: { cli: null, byCli: {} }, chats: [c] }));
    expect(f.chats[0].forkedFrom).toEqual({ agent: "codex", conv: UUID });
    expect(f.chats[0].cwd).toBe("C:/w/proj");
    const bad = parseSideChats(
      JSON.stringify({ chats: [{ id: ID, cli: "claude", forkedFrom: { agent: "claude", conv: "nope" }, cwd: 3 }] }),
    );
    expect(bad.chats[0].forkedFrom).toBeNull();
    expect(bad.chats[0].cwd).toBe("");
    expect(parseSideChats(JSON.stringify({ chats: [{ id: ID }] })).chats[0].forkedFrom, "옛 파일").toBeNull();
  });

  it("제목 · 폴더 이름표", () => {
    expect(sideChatForkTitle("p2 claude")).toBe("↪ p2 claude");
    expect(sideChatForkTitle("  ")).toBe("↪");
    expect(sideChatCwdLabel("C:/Users/me/proj/")).toBe("proj");
    expect(sideChatCwdLabel("C:\\w\\app")).toBe("app");
  });
});

describe("지난 대화 목록의 사이드 채팅 표지(10-24 실기 3차)", () => {
  const ORIG = "11111111-2222-4333-8444-555555555555";
  const FORK = "66666666-7777-4888-9999-aaaaaaaaaaaa";
  const CODEX = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

  it("채팅이 쥔 대화(links[agent])만 — 갈라 온 것은 forked, 원본 · 남의 대화 · 다른 CLI 는 아님", () => {
    const chats = [
      chat({ links: { claude: FORK, codex: CODEX }, forkedFrom: { agent: "claude", conv: ORIG } }),
      chat({ id: "fresh", links: { claude: UUID } }),
    ];
    expect(sideChatConvMark(chats, "claude", FORK)).toEqual({ forked: true });
    expect(sideChatConvMark(chats, "claude", FORK.toUpperCase())).toEqual({ forked: true });
    // 같은 채팅이 CLI 를 바꿔 새로 연 Codex 대화는 갈라 온 것이 아니다
    expect(sideChatConvMark(chats, "codex", CODEX)).toEqual({ forked: false });
    expect(sideChatConvMark(chats, "claude", UUID)).toEqual({ forked: false });
    expect(sideChatConvMark(chats, "claude", ORIG)).toBeNull();
    expect(sideChatConvMark(chats, "codex", FORK)).toBeNull();
    expect(sideChatConvMark(chats, "claude", "not-a-uuid")).toBeNull();
    expect(sideChatConvMark([], "claude", FORK)).toBeNull();
    // 첫 턴 전에 원본 id 가 적혀 있어도 원본은 표지하지 않는다
    expect(sideChatConvMark([chat({ links: { claude: ORIG }, forkedFrom: { agent: "claude", conv: ORIG } })], "claude", ORIG)).toBeNull();
  });

  it("글자 — 모두 '사이드 채팅', 갈라 온 것만 ↪", () => {
    expect(sideChatConvBadge(null)).toBeNull();
    expect(sideChatConvBadge({ forked: false })).toEqual({ label: "app.chatDock.convBadge", title: "app.chatDock.convBadge.title" });
    expect(sideChatConvBadge({ forked: true })?.label).toBe("app.chatDock.convBadge.fork");
  });
});

describe("sideChatConversation — CLI 별 대화 id", () => {
  it("그 CLI 의 기록된 대화 id · 없거나 모양이 틀리면 null(새 대화)", () => {
    const c = chat({ links: { claude: UUID } });
    expect(sideChatConversation(c, "claude")).toBe(UUID);
    expect(sideChatConversation(c, "codex")).toBeNull();
    expect(sideChatConversation(chat({ links: { claude: "../x" } }), "claude")).toBeNull();
  });

  it("세션 서버가 아는 CLI 는 둘", () => {
    expect(sideChatCliOk("claude")).toBe(true);
    expect(sideChatCliOk("codex")).toBe(true);
    expect(sideChatCliOk("gemini")).toBe(false);
  });

  it("빈 모델 = CLI 기본 · 셸 글자는 아니다", () => {
    expect(sideChatModelOk("")).toBe(true);
    expect(sideChatModelOk("claude-opus-5-5[1m]")).toBe(true);
    expect(sideChatModelOk("a b")).toBe(false);
  });
});

describe("parseSideChats · serializeSideChats", () => {
  it("왕복 — v3 판은 stream 칸을 쓰지 않는다", () => {
    const f = { current: ID, last: { cli: "codex", byCli: { codex: { model: "o3", effort: "high" }, claude: { model: "opus", effort: "max" } } }, chats: [chat({ title: "안녕", effort: "max", used: ["claude"], links: { claude: UUID } })] };
    const raw = serializeSideChats(f);
    expect(raw).not.toContain("stream");
    expect(JSON.parse(raw).v).toBe(3);
    expect(parseSideChats(raw)).toEqual({ ...f, legacyStreams: [] });
  });

  it("없음 · 깨짐 · 모양이 틀린 줄은 버리고, 없는 current 는 첫 채팅으로", () => {
    expect(parseSideChats(null).chats).toEqual([]);
    expect(parseSideChats("{").chats).toEqual([]);
    const raw = JSON.stringify({
      current: "nope",
      chats: [
        { ...chat(), id: "../x" },
        { ...chat(), model: "a b", effort: "x;y", links: { claude: "not-a-uuid" } },
        { ...chat() }, // 같은 id 두 번
      ],
    });
    const f = parseSideChats(raw);
    expect(f.chats).toHaveLength(1);
    expect(f.chats[0].model).toBe("");
    expect(f.chats[0].effort).toBe("");
    expect(f.chats[0].links).toEqual({});
    expect(f.current).toBe(ID);
    expect(f.last).toEqual({ cli: null, byCli: {} });
    // 강도 칸이 없던 옛 줄 = CLI 기본
    expect(parseSideChats(JSON.stringify({ chats: [{ id: ID, cli: "claude", model: "opus" }] })).chats[0].effort).toBe("");
  });

  it("v1 의 stream 칸은 legacyStreams 로만 — 채팅 줄은 그대로 살고 · 머리가 틀린 것은 버린다(설계 6절 옮기기)", () => {
    const v1 = JSON.stringify({
      v: 1,
      current: ID,
      chats: [
        { ...chat(), stream: `${LEGACY_SIDE_CHAT_PREFIX}aaaa` },
        { ...chat({ id: "fedcba9876543210" }), stream: "plain-stream" },
        { ...chat({ id: "1111222233334444" }), stream: `${LEGACY_SIDE_CHAT_PREFIX}aaaa` },
        { ...chat({ id: "5555666677778888" }), stream: `${LEGACY_SIDE_CHAT_PREFIX}b;rm` },
      ],
    });
    const f = parseSideChats(v1);
    expect(f.chats.map((c) => c.id)).toEqual([ID, "fedcba9876543210", "1111222233334444", "5555666677778888"]);
    expect(f.chats.every((c) => !("stream" in c))).toBe(true);
    expect(f.legacyStreams).toEqual([`${LEGACY_SIDE_CHAT_PREFIX}aaaa`]);
    // 다시 쓰면 칸이 빠진다 → 다음 부팅은 옮길 것이 없다(멱등)
    expect(parseSideChats(serializeSideChats(f)).legacyStreams).toEqual([]);
  });

  it("v1 스트림 판정", () => {
    expect(legacySideChatStream(`${LEGACY_SIDE_CHAT_PREFIX}0123abcd`)).toBe(true);
    expect(legacySideChatStream("tile-0123")).toBe(false);
    expect(legacySideChatStream(42)).toBe(false);
  });
});

describe("id · 제목 · 고르기 · 순서", () => {
  it("새 id 는 폴더 이름 모양", () => {
    expect(sideChatIdOk(newSideChatId())).toBe(true);
    expect(newSideChatId()).toHaveLength(16);
    expect(sideChatIdOk("a/b")).toBe(false);
  });

  it("제목 = 첫 줄 · 공백 접기 · 40자", () => {
    expect(sideChatTitleFrom("\n  안녕   하세요 \n둘째")).toBe("안녕 하세요");
    expect(sideChatTitleFrom("가".repeat(50))).toBe(`${"가".repeat(40)}…`);
  });

  it("바라는 CLI 가 꺼졌으면 첫 항목", () => {
    const offered = [{ id: "claude" }, { id: "codex" }];
    expect(pickSideChatCli(offered, "codex")?.id).toBe("codex");
    expect(pickSideChatCli(offered, "gone")?.id).toBe("claude");
    expect(pickSideChatCli([], "claude")).toBeNull();
  });

  it("최근에 쓴 것이 위", () => {
    const a = { id: "a", createdAt: 10, usedAt: 0 };
    const b = { id: "b", createdAt: 1, usedAt: 50 };
    expect(sortSideChats([a, b]).map((x) => x.id)).toEqual(["b", "a"]);
  });
});

describe("sideChatModelChoices", () => {
  it("지금 값 → 설정 기본 → 제안 순서 · 중복과 빈 값은 걷는다", () => {
    expect(sideChatModelChoices("x-2", "x-1", ["x-1", "x-3"])).toEqual(["x-2", "x-1", "x-3"]);
    expect(sideChatModelChoices("", null, [])).toEqual([]);
    expect(sideChatModelChoices("", undefined, ["opus", "opus"])).toEqual(["opus"]);
  });

  it("모양이 틀린 값(셸 글자 · 64자 넘음)은 싣지 않는다", () => {
    expect(sideChatModelChoices("a b", "x;rm", ["ok-1", "y".repeat(65)])).toEqual(["ok-1"]);
  });
});

describe("sideChatEffortChoices", () => {
  const FALLBACK = ["", "low", "medium", "high"];

  it("악수가 그 모델의 목록을 알렸으면 그것 · 빈 모델은 열쇠 \"\"(지금 뜬 CLI 기본 모델)", () => {
    const efforts = { "": ["low", "max"], sonnet: ["low", "high", "xhigh"], "claude-haiku-4-5-20251001": [] };
    expect(sideChatEffortChoices(efforts, "sonnet", FALLBACK)).toEqual(["low", "high", "xhigh"]);
    expect(sideChatEffortChoices(efforts, "", FALLBACK)).toEqual(["low", "max"]);
  });

  it("빈 목록 = 강도를 받지 않는 모델(칩을 숨긴다)", () => {
    expect(sideChatEffortChoices({ old: [] }, "old", FALLBACK)).toEqual([]);
  });

  it("악수 전이거나 모르는 모델은 앱의 CLI 별 목록(빈 값 줄은 빼고) · 모양이 틀린 값은 걷는다", () => {
    expect(sideChatEffortChoices(null, "opus", FALLBACK)).toEqual(["low", "medium", "high"]);
    expect(sideChatEffortChoices({ sonnet: ["low"] }, "custom-1", FALLBACK)).toEqual(["low", "medium", "high"]);
    expect(sideChatEffortChoices({ m: ["a b", "low", "low"] }, "m", FALLBACK)).toEqual(["low"]);
    // `__proto__` 같은 이름이 목록을 지어내지 않는다
    expect(sideChatEffortChoices({}, "constructor", FALLBACK)).toEqual(["low", "medium", "high"]);
  });
});

describe("연결 칩 저장(tile — v2 5단계)", () => {
  it("모양이 맞으면 되살리고 틀리면 버린다(줄은 남는다) · 저장 왕복", () => {
    const raw = JSON.stringify({
      chats: [
        { id: ID, cli: "claude", tile: { stream: "s-pane-2", name: "p2 pwsh" } },
        { id: "fedcba9876543210", cli: "codex", tile: { stream: "bad stream", name: "x" } },
      ],
    });
    const f = parseSideChats(raw);
    expect(f.chats[0].tile).toEqual({ stream: "s-pane-2", name: "p2 pwsh" });
    expect(f.chats[1].tile).toBeNull();
    const again = parseSideChats(serializeSideChats(f));
    expect(again.chats.map((c) => c.tile)).toEqual([{ stream: "s-pane-2", name: "p2 pwsh" }, null]);
  });
});

describe("mergeSideChats — 여러 창이 함께 고친 목록(2026-11-01)", () => {
  const chat = (id: string, title = ""): SideChat => ({
    id,
    cli: "claude",
    model: "",
    effort: "",
    title,
    createdAt: 1,
    usedAt: 0,
    used: [],
    links: {},
    tile: null,
    forkedFrom: null,
    cwd: "",
  });
  const last: SideChatLast = { cli: "claude", byCli: {} };
  const list = (current: string | null, chats: SideChat[], l = last) => ({ current, last: l, chats });

  it("이 창의 바뀜만 파일 위에 다시 얹는다 — 새로 만든 것 · 지운 것 · 고친 것", () => {
    const base = list("a", [chat("a"), chat("b"), chat("c")]);
    // 이 창: c 를 지우고 b 이름을 바꾸고 d 를 만들었다
    const mine = list("a", [chat("a"), chat("b", "내 이름"), chat("d")]);
    // 다른 창: a 이름을 바꾸고 e 를 만들었다
    const theirs = list("a", [chat("a", "남 이름"), chat("b"), chat("c"), chat("e")]);
    const m = mergeSideChats(base, mine, theirs);
    expect(m.chats.map((c) => [c.id, c.title])).toEqual([
      ["a", "남 이름"],
      ["b", "내 이름"],
      ["e", ""],
      ["d", ""],
    ]);
  });

  it("다른 창이 지운 채팅은 빠진다 — 이 창이 고쳤으면 살린다", () => {
    const base = list("a", [chat("a"), chat("b")]);
    expect(mergeSideChats(base, base, list("a", [chat("a")])).chats.map((c) => c.id)).toEqual(["a"]);
    const mine = list("a", [chat("a"), chat("b", "고침")]);
    expect(mergeSideChats(base, mine, list("a", [chat("a")])).chats.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("current · last — 이 창이 바꿨으면 이 창 것, 아니면 파일 것 · 없는 current 는 첫 채팅", () => {
    const base = list("a", [chat("a"), chat("b")]);
    expect(mergeSideChats(base, list("b", base.chats), list("a", base.chats)).current).toBe("b");
    expect(mergeSideChats(base, base, list("b", base.chats)).current).toBe("b");
    expect(mergeSideChats(base, base, list("z", base.chats)).current).toBe("a");
    const mineLast: SideChatLast = { cli: "codex", byCli: { codex: { model: "o", effort: "" } } };
    const theirsLast: SideChatLast = { cli: "claude", byCli: { claude: { model: "opus", effort: "" } } };
    // 이 창은 codex 를 · 다른 창은 claude 를 바꿨다 — CLI 하나씩 합친다 · 마지막 CLI 는 이 창 것
    expect(mergeSideChats(base, list("a", base.chats, mineLast), list("a", base.chats, theirsLast)).last).toEqual({
      cli: "codex",
      byCli: { claude: { model: "opus", effort: "" }, codex: { model: "o", effort: "" } },
    });
    expect(mergeSideChats(base, base, list("a", base.chats, theirsLast)).last).toEqual(theirsLast);
  });

  it("last.byCli — 같은 CLI 를 둘 다 바꿨으면 이 창 것 · 이 창이 안 바꾼 CLI 는 파일 것", () => {
    const b: SideChatLast = { cli: "claude", byCli: { claude: { model: "opus", effort: "high" }, codex: { model: "o3", effort: "" } } };
    const base = list("a", [chat("a")], b);
    const mine = list("a", base.chats, { cli: "claude", byCli: { ...b.byCli, claude: { model: "sonnet", effort: "high" } } });
    const theirs = list("a", base.chats, {
      cli: "codex",
      byCli: { claude: { model: "haiku", effort: "" }, codex: { model: "gpt-5", effort: "low" } },
    });
    expect(mergeSideChats(base, mine, theirs).last).toEqual({
      cli: "codex",
      byCli: { claude: { model: "sonnet", effort: "high" }, codex: { model: "gpt-5", effort: "low" } },
    });
  });
});

describe("마지막 선택 — CLI 마다(2026-11-01)", () => {
  it("옛 판(v2 last {cli, model, effort})은 byCli[cli] 로 옮긴다 · 빈 쌍은 적지 않는다 · 틀린 칸은 버린다", () => {
    const old = JSON.stringify({ v: 2, last: { cli: "claude", model: "opus", effort: "high" }, chats: [] });
    expect(parseSideChats(old).last).toEqual({ cli: "claude", byCli: { claude: { model: "opus", effort: "high" } } });
    expect(parseSideChats(JSON.stringify({ last: { cli: "codex", model: "", effort: "" } })).last).toEqual({ cli: "codex", byCli: {} });
    expect(parseSideChats(JSON.stringify({ last: { cli: "codex", model: "a b", effort: "x;y" } })).last).toEqual({ cli: "codex", byCli: {} });
    const bad = JSON.stringify({ last: { cli: "../x", byCli: { "Bad Key": { model: "m" }, claude: { model: "a b", effort: "max" }, codex: 3 } } });
    expect(parseSideChats(bad).last).toEqual({
      cli: null,
      byCli: { claude: { model: "", effort: "max" }, codex: { model: "", effort: "" } },
    });
    // 옛 판을 읽고 쓰면 새 모양
    const again = JSON.parse(serializeSideChats(parseSideChats(old)));
    expect(again.v).toBe(3);
    expect(again.last).toEqual({ cli: "claude", byCli: { claude: { model: "opus", effort: "high" } } });
  });

  it("Claude 모델 · 강도 → Codex 로 → Claude 로 돌아오면 그대로", () => {
    let last: SideChatLast = { cli: null, byCli: {} };
    let c = { cli: "claude", model: "opus", effort: "high" };
    last = rememberSideChatPick(last, c.cli, c.model, c.effort);
    // CLI 칩으로 Codex — 모델 없이(“그 CLI 의 기본”) 바꿨다: 기억이 없으니 빈 값
    let p = sideChatSwitchPick(c, last, "codex", "");
    expect(p).toEqual({ model: "", effort: "" });
    c = { cli: "codex", ...p };
    last = rememberSideChatPick(last, c.cli, c.model, c.effort);
    // Codex 에서 강도를 고른다
    c = { ...c, effort: "low" };
    last = rememberSideChatPick(last, c.cli, c.model, c.effort);
    // Claude 로 돌아온다 — opus · high
    p = sideChatSwitchPick(c, last, "claude", "");
    expect(p).toEqual({ model: "opus", effort: "high" });
    c = { cli: "claude", ...p };
    last = rememberSideChatPick(last, c.cli, c.model, c.effort);
    // 다시 Codex — low 가 남았다
    expect(sideChatSwitchPick(c, last, "codex", "")).toEqual({ model: "", effort: "low" });
    // 같은 동작에서 고른 모델이 이긴다 · 강도는 그 CLI 의 기억
    expect(sideChatSwitchPick(c, last, "codex", "gpt-5")).toEqual({ model: "gpt-5", effort: "low" });
    // 같은 CLI — 받은 모델(빈 값 = CLI 기본 포함) · 지금 강도
    expect(sideChatSwitchPick(c, last, "claude", "")).toEqual({ model: "", effort: "high" });
    // 새 채팅 — 마지막 CLI(claude)의 기억
    const offered = [{ id: "claude" }, { id: "codex" }];
    expect(sideChatNewDefault(offered, last)).toEqual({ cli: { id: "claude" }, model: "opus", effort: "high" });
  });

  it("새 채팅 — 마지막 CLI 가 꺼졌으면 켠 첫 항목 · 그 CLI 의 기억 · 켠 것 없으면 null", () => {
    const last: SideChatLast = { cli: "codex", byCli: { claude: { model: "sonnet", effort: "low" }, codex: { model: "o3", effort: "high" } } };
    expect(sideChatNewDefault([{ id: "claude" }], last)).toEqual({ cli: { id: "claude" }, model: "sonnet", effort: "low" });
    expect(sideChatNewDefault([{ id: "claude" }, { id: "codex" }], last)).toEqual({ cli: { id: "codex" }, model: "o3", effort: "high" });
    expect(sideChatNewDefault([], last)).toBeNull();
    expect(sideChatPickFor(last, null)).toEqual({ model: "", effort: "" });
    expect(sideChatPickFor({ cli: null, byCli: { claude: { model: "a b", effort: "max" } } }, "claude")).toEqual({ model: "", effort: "max" });
  });

  it("기억하기는 그 CLI 만 바꾸고 원본을 건드리지 않는다", () => {
    const last: SideChatLast = { cli: "claude", byCli: { claude: { model: "opus", effort: "" } } };
    const next = rememberSideChatPick(last, "codex", "o3", "x;y");
    expect(next).toEqual({ cli: "codex", byCli: { claude: { model: "opus", effort: "" }, codex: { model: "o3", effort: "" } } });
    expect(last.byCli.codex).toBeUndefined();
    expect(rememberSideChatPick(last, "Bad", "m", "")).toBe(last);
  });
});
