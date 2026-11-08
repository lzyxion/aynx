import { describe, expect, it } from "vitest";
import {
  LINK_NAME_MAX,
  linkChipState,
  linkStreamOk,
  linkSendName,
  linkTileName,
  linkTilePickLabel,
  orderLinkTiles,
  parseTileLink,
  sideChatAskOffered,
  type LinkTile,
} from "$lib/side-chat-link";

function tile(over: Partial<LinkTile> = {}): LinkTile {
  return {
    paneId: "pane-2",
    tabId: "t1",
    stream: "s-pane-2",
    code: "p2",
    name: "pwsh",
    kind: "local",
    readable: true,
    focused: false,
    ...over,
  };
}

describe("parseTileLink — 저장 칸", () => {
  it("스트림 모양(Rust stream_ok)만 · 이름은 한 줄 · 상한", () => {
    expect(parseTileLink({ stream: "s-1:a.b_c", name: " p2   pwsh\n" })).toEqual({ stream: "s-1:a.b_c", name: "p2 pwsh" });
    expect(parseTileLink({ stream: "s 1", name: "x" })).toBeNull();
    expect(parseTileLink({ stream: "", name: "x" })).toBeNull();
    expect(parseTileLink({ stream: "a".repeat(129) })).toBeNull();
    expect(parseTileLink(null)).toBeNull();
    expect(parseTileLink("s-1")).toBeNull();
    expect(parseTileLink({ stream: "s-1", name: 3 })).toEqual({ stream: "s-1", name: "" });
    expect(parseTileLink({ stream: "s", name: "가".repeat(200) })?.name.length).toBe(LINK_NAME_MAX);
    expect(linkStreamOk("tile-a")).toBe(true);
  });
});

describe("orderLinkTiles — 지금 포커스된 타일이 맨 위(기본 제안)", () => {
  it("나머지는 순서 그대로", () => {
    const list = [tile({ paneId: "a" }), tile({ paneId: "b", focused: true }), tile({ paneId: "c" })];
    expect(orderLinkTiles(list).map((t) => t.paneId)).toEqual(["b", "a", "c"]);
    expect(orderLinkTiles([]).length).toBe(0);
  });
});

describe("linkChipState — 칩", () => {
  const link = { stream: "s-pane-2", name: "p2 옛 이름" };

  it("연결 없음", () => {
    expect(linkChipState(null, [tile()], null)).toEqual({ kind: "none" });
  });

  it("이 창의 타일이 먼저 — 지금 이름 · 지금 읽기 권한(토글하면 곧바로)", () => {
    const off = tile({ readable: false, name: "bash" });
    expect(linkChipState(link, [off], { stream: "s-pane-2", readable: true, closed: false })).toEqual({
      kind: "linked",
      name: linkTileName(off),
      closed: false,
      readable: false,
      tile: off,
    });
  });

  it("이 창에 없으면 서버가 아는 것(다른 창으로 옮긴 타일) — 저장된 이름", () => {
    expect(linkChipState(link, [], { stream: "s-pane-2", readable: true, closed: false })).toEqual({
      kind: "linked",
      name: "p2 옛 이름",
      closed: false,
      readable: true,
      tile: null,
    });
  });

  it("서버도 닫혔다고 하거나 아무도 모르면 닫힘", () => {
    const closed = linkChipState(link, [], { stream: "s-pane-2", readable: false, closed: true });
    expect(closed).toMatchObject({ kind: "linked", closed: true, readable: false });
    expect(linkChipState(link, [], null)).toMatchObject({ kind: "linked", closed: true, readable: null });
    // 다른 스트림의 서버 답은 보지 않는다
    expect(linkChipState(link, [], { stream: "other", readable: true, closed: false })).toMatchObject({ closed: true });
  });
});

describe("칩 이름 — 타일 표시 이름 하나(코드 없음 · 10-24 실기 3차)", () => {
  it("칩 · 저장 · 머리글 이름은 표시 이름, 고르기 메뉴만 코드를 붙인다", () => {
    const ai = tile({ code: "p6", name: " Claude   Code " });
    expect(linkTileName(ai)).toBe("Claude Code");
    expect(linkTilePickLabel(ai)).toBe("p6 Claude Code");
    // 번호가 바뀌어도(F5 · 옮기기) 칩 이름은 그대로
    expect(linkTileName(tile({ code: "p5", name: ai.name }))).toBe(linkTileName(ai));
    expect(linkTileName(tile({ name: "가".repeat(200) })).length).toBe(LINK_NAME_MAX);
  });

  it("보낼 때 싣는 이름 = 지금 칩의 이름(연결 없음 · 빈 이름이면 null — 서버가 거울 이름으로)", () => {
    const ai = tile({ name: "Claude Code" });
    expect(linkSendName(linkChipState({ stream: "s-pane-2", name: "옛" }, [ai], null))).toBe("Claude Code");
    // 다른 창 · 닫힌 타일 — 저장된 이름(옛 `p6 로컬` 꼴도 그대로)
    expect(linkSendName(linkChipState({ stream: "s-pane-2", name: "p6 로컬" }, [], null))).toBe("p6 로컬");
    expect(linkSendName(linkChipState(null, [ai], null))).toBeNull();
    expect(linkSendName(linkChipState({ stream: "s-pane-2", name: "" }, [], null))).toBeNull();
  });
});

describe("sideChatAskOffered — [AI에게 묻기] 의 사이드 채팅 줄", () => {
  it("주 창이고 채팅이 있거나 CLI 가 켜져 있을 때만", () => {
    expect(sideChatAskOffered({ mainWindow: true, hasChat: true, hasCli: false })).toBe(true);
    expect(sideChatAskOffered({ mainWindow: true, hasChat: false, hasCli: true })).toBe(true);
    expect(sideChatAskOffered({ mainWindow: true, hasChat: false, hasCli: false })).toBe(false);
    expect(sideChatAskOffered({ mainWindow: false, hasChat: true, hasCli: true })).toBe(false);
  });
});
