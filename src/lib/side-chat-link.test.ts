import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  LINK_NAME_MAX,
  SIDE_CHAT_LINK_MAX,
  linkChipIcon,
  linkChipStates,
  linkStreamOk,
  linkSendNames,
  linkTileName,
  orderLinkTiles,
  parseTileLink,
  parseTileLinks,
  pushKnownLinks,
  sameLinkStreams,
  sideChatAskOffered,
  withTileLink,
  withoutTileLink,
  type LinkTile,
} from "$lib/side-chat-link";
import type { PaneSpec } from "$lib/session";

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

describe("parseTileLinks · 묶음 고치기 — 최대 8 · 연결 순서", () => {
  it("배열만 · 틀린 칸 버림 · 같은 스트림은 처음 것 · 상한에서 자른다", () => {
    expect(parseTileLinks(null)).toEqual([]);
    expect(parseTileLinks({ stream: "s-1" })).toEqual([]);
    expect(parseTileLinks([{ stream: "s-1", name: "a" }, { stream: "s 2" }, { stream: "s-1", name: "b" }])).toEqual([{ stream: "s-1", name: "a" }]);
    const many = Array.from({ length: 12 }, (_, i) => ({ stream: `s-${i}`, name: "" }));
    expect(parseTileLinks(many).length).toBe(SIDE_CHAT_LINK_MAX);
    expect(SIDE_CHAT_LINK_MAX).toBe(8);
  });

  it("더하기 — 끝에 · 이미 있으면 그대로(자리 · 이름) · 찼으면 full · 빼기 · 견주기는 스트림 · 순서만", () => {
    const a = { stream: "s-a", name: "A" };
    const b = { stream: "s-b", name: "B" };
    expect(withTileLink([a], b)).toEqual({ links: [a, b], full: false });
    expect(withTileLink([a, b], { stream: "s-a", name: "새 이름" })).toEqual({ links: [a, b], full: false });
    const full = Array.from({ length: SIDE_CHAT_LINK_MAX }, (_, i) => ({ stream: `s-${i}`, name: "" }));
    expect(withTileLink(full, a)).toEqual({ links: full, full: true });
    expect(withTileLink(full, full[3]).full).toBe(false);
    expect(withoutTileLink([a, b], "s-a")).toEqual([b]);
    expect(withoutTileLink([a], "zz")).toEqual([a]);
    expect(sameLinkStreams([a, b], [{ stream: "s-a" }, { stream: "s-b" }])).toBe(true);
    expect(sameLinkStreams([a, b], [{ stream: "s-b" }, { stream: "s-a" }])).toBe(false);
    expect(sameLinkStreams([], [])).toBe(true);
  });
});

describe("pushKnownLinks — [bad-link] 면 아는 것만(서버는 묶음을 통째로 받거나 아무것도 안 바꾼다)", () => {
  /** 서버 흉내 — `known` 밖이 섞이면 거절 · 받으면 표를 통째로 바꾼다 */
  function server(known: string[]) {
    const s = { table: ["old"] as string[], calls: [] as string[][] };
    const push = async (streams: string[]) => {
      s.calls.push(streams);
      if (streams.some((x) => !known.includes(x))) throw new Error("[bad-link] unknown tile");
      s.table = streams;
      return streams.map((stream) => ({ stream }));
    };
    return { s, push };
  }
  const bad = (e: unknown) => String(e).includes("[bad-link]");

  it("모두 알면 한 번에", async () => {
    const { s, push } = server(["a", "b"]);
    expect(await pushKnownLinks(["a", "b"], push, bad)).toEqual([{ stream: "a" }, { stream: "b" }]);
    expect(s.calls).toEqual([["a", "b"]]);
  });

  it("모르는 것이 섞이면 하나씩 더해 보며 아는 것만 — 순서 그대로 · 서버 표 = 아는 것", async () => {
    const { s, push } = server(["a", "c"]);
    expect(await pushKnownLinks(["a", "x", "c"], push, bad)).toEqual([{ stream: "a" }, { stream: "c" }]);
    expect(s.table).toEqual(["a", "c"]);
  });

  it("하나도 모르면 빈 묶음을 건다(옛 표를 남기지 않는다) · 빈 묶음 자체의 거절은 그대로 던진다", async () => {
    const { s, push } = server([]);
    expect(await pushKnownLinks(["x", "y"], push, bad)).toEqual([]);
    expect(s.table).toEqual([]);
    await expect(pushKnownLinks([], async () => Promise.reject(new Error("[bad-link]")), bad)).rejects.toThrow("[bad-link]");
  });

  it("그 밖의 실패는 그대로 던진다(처음 · 하나씩 더하는 중)", async () => {
    await expect(pushKnownLinks(["a"], async () => Promise.reject(new Error("[session-gone]")), bad)).rejects.toThrow("[session-gone]");
    let n = 0;
    const flaky = async (streams: string[]) => {
      n++;
      if (n === 1) throw new Error("[bad-link]");
      throw new Error("[server-outdated]");
    };
    await expect(pushKnownLinks(["a", "b"], flaky, bad)).rejects.toThrow("[server-outdated]");
  });
});

describe("linkChipStates — 타일마다 칩 하나(연결 순서)", () => {
  const link = { stream: "s-pane-2", name: "p2 옛 이름" };

  it("연결 없음 = 칩 없음", () => {
    expect(linkChipStates([], [tile()], [])).toEqual([]);
  });

  it("이 창의 타일이 먼저 — 지금 이름 · 지금 읽기 권한(토글하면 곧바로)", () => {
    const off = tile({ readable: false, name: "bash" });
    expect(linkChipStates([link], [off], [{ stream: "s-pane-2", readable: true, closed: false }])).toEqual([
      { stream: "s-pane-2", name: linkTileName(off), closed: false, readable: false, tile: off },
    ]);
  });

  it("이 창에 없으면 서버가 아는 것(다른 창으로 옮긴 타일) — 저장된 이름", () => {
    expect(linkChipStates([link], [], [{ stream: "s-pane-2", readable: true, closed: false }])).toEqual([
      { stream: "s-pane-2", name: "p2 옛 이름", closed: false, readable: true, tile: null },
    ]);
  });

  it("서버도 닫혔다고 하거나 아무도 모르면 닫힘 · 다른 스트림의 서버 답은 보지 않는다", () => {
    expect(linkChipStates([link], [], [{ stream: "s-pane-2", readable: false, closed: true }])[0]).toMatchObject({ closed: true, readable: false });
    expect(linkChipStates([link], [], [])[0]).toMatchObject({ closed: true, readable: null });
    expect(linkChipStates([link], [], [{ stream: "other", readable: true, closed: false }])[0]).toMatchObject({ closed: true });
  });

  it("여럿 — 연결 순서 그대로 · 칩마다 따로 판정", () => {
    const here = tile({ stream: "s-b", name: "Claude Code" });
    const chips = linkChipStates(
      [
        { stream: "s-a", name: "A" },
        { stream: "s-b", name: "옛" },
        { stream: "s-c", name: "C" },
      ],
      [here],
      [
        { stream: "s-c", readable: true, closed: false },
        { stream: "s-a", readable: false, closed: true },
      ],
    );
    expect(chips.map((c) => [c.stream, c.name, c.closed, c.readable])).toEqual([
      ["s-a", "A", true, false],
      ["s-b", "Claude Code", false, true],
      ["s-c", "C", false, true],
    ]);
  });

  it("칩 앞 그림 — 이 창 · 열림 · 읽기 가능이면 그 타일 로고, 닫힘 · 못 읽음은 ai-off, 이 창에 없으면 link", () => {
    const pane = { id: "pane-2", kind: "local" } as unknown as PaneSpec;
    const [logo] = linkChipStates([link], [tile({ pane })], []);
    expect(linkChipIcon(logo)).toBe("pane");
    const [off] = linkChipStates([link], [tile({ pane, readable: false })], []);
    expect(linkChipIcon(off)).toBe("ai-off");
    const [closed] = linkChipStates([link], [], []);
    expect(linkChipIcon(closed)).toBe("ai-off");
    const [elsewhere] = linkChipStates([link], [], [{ stream: "s-pane-2", readable: true, closed: false }]);
    expect(linkChipIcon(elsewhere)).toBe("link");
    // 그림 없는 타일(옛 호출)은 link
    expect(linkChipIcon(linkChipStates([link], [tile()], [])[0])).toBe("link");
  });
});

describe("칩 이름 — 타일 표시 이름 하나(코드 없음 · 10-24 실기 3차)", () => {
  it("칩 · 저장 · 머리글 이름은 표시 이름(코드는 고르기 메뉴 줄의 따로 칸 `code` 에만)", () => {
    const ai = tile({ code: "p6", name: " Claude   Code " });
    expect(linkTileName(ai)).toBe("Claude Code");
    // 번호가 바뀌어도(F5 · 옮기기) 칩 이름은 그대로
    expect(linkTileName(tile({ code: "p5", name: ai.name }))).toBe(linkTileName(ai));
    expect(linkTileName(tile({ name: "가".repeat(200) })).length).toBe(LINK_NAME_MAX);
  });

  it("보낼 때 싣는 이름 = 스트림 → 지금 칩의 이름(빈 이름은 빼고 · 하나도 없으면 null — 서버가 거울 이름으로)", () => {
    const ai = tile({ name: "Claude Code" });
    expect(linkSendNames(linkChipStates([{ stream: "s-pane-2", name: "옛" }], [ai], []))).toEqual({ "s-pane-2": "Claude Code" });
    // 다른 창 · 닫힌 타일 — 저장된 이름(옛 `p6 로컬` 꼴도 그대로)
    expect(
      linkSendNames(
        linkChipStates(
          [
            { stream: "s-pane-2", name: "p6 로컬" },
            { stream: "s-x", name: "" },
            { stream: "s-y", name: "bash" },
          ],
          [],
          [],
        ),
      ),
    ).toEqual({ "s-pane-2": "p6 로컬", "s-y": "bash" });
    expect(linkSendNames([])).toBeNull();
    expect(linkSendNames(linkChipStates([{ stream: "s-pane-2", name: "" }], [], []))).toBeNull();
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

describe("화면 — 여러 타일 연결(2026-11-18 · 소스 고정)", () => {
  const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8").replace(/\r\n/g, "\n");
  const controls = src("./chat/side-chat-controls.svelte.ts");
  const chip = src("./chat/ChatLinkChip.svelte");
  const face = src("./SideChatFace.svelte");
  const dock = src("./ChatDock.svelte");

  it("[+] › 타일 연결 = 체크 줄(라디오 아님) · 찼으면 체크 안 된 줄은 흐림 + 까닭 · 맨 아래 모두 끊기(연결이 없으면 흐림)", () => {
    const rows = controls.slice(controls.indexOf("readonly #linkRows"), controls.indexOf("readonly plusRows"));
    expect(rows).toContain("checked,");
    expect(rows).not.toContain("radio: true");
    expect(rows).toContain("const blocked = full && !checked;");
    expect(rows).toContain('title: blocked ? t("app.chatDock.link.full"');
    expect(rows).toContain("disabled: blocked,");
    expect(rows).toContain('label: t("app.chatDock.link.unlinkAll"), disabled: c.tiles.length === 0');
  });

  it("타일 줄을 눌러도 메뉴는 열린 채(닫기 자리가 빈 같은 통로) · 모두 끊기는 닫는다", () => {
    const pick = controls.slice(controls.indexOf("  pickPlus(key: string)"), controls.indexOf("  /** 입력 칸 위 연결 칩의 ×"));
    const toggle = pick.slice(pick.indexOf("// 타일 체크 줄"));
    expect(toggle).toContain("      () => {},\n");
    expect(toggle).toContain("on ? removeSideChatLink(chat, tile.stream) : addSideChatLink(chat, tile)");
    const all = pick.slice(pick.indexOf('if (key === "unlink")'), pick.indexOf("// 타일 체크 줄"));
    expect(all).toContain("() => this.closePlus(false),");
    expect(all).toContain("setSideChatLinks(chat, [])");
  });

  it("뿌리의 타일 연결 줄 — 하나면 이름 · 둘 이상이면 개수", () => {
    expect(controls).toContain('links.length === 1 ? links[0].name : links.length > 1 ? String(links.length) : ""');
  });

  it("입력 칸 위 칩 = 타일마다 하나 · × 는 그 타일만 · 앞 그림은 linkChipIcon(로고 = PaneIcon)", () => {
    expect(face).toContain("{#each chipLinks as chip (chip.stream)}");
    expect(face).toContain("unlink={() => ctl.unlink(chip.stream)}");
    expect(chip).toContain("linkChipIcon(chip)");
    expect(chip).toContain('{#if icon === "pane" && chip.tile?.pane}');
    expect(chip).toContain("<PaneIcon pane={chip.tile.pane} size={13} />");
  });

  it("칸 위 안내 = 문제 있는 연결마다 한 줄 · 닫힘의 [연결 끊기] 는 그 타일만", () => {
    expect(dock).toContain("{#each chipLinks.filter((x) => x.closed || x.readable === false) as chip (chip.stream)}");
    expect(dock).toContain("removeSideChatLink(c.id, chip.stream)");
    expect(dock).toContain('t("app.chatDock.link.readOffNote", { name: chip.name })');
  });

  it("칸 위 안내 = 신뢰 말풍선과 같은 면(--hint-bubble-*) · 꼬리는 맨 아래 하나 · 단추는 알약(.link-go)", () => {
    const css = dock.slice(dock.indexOf("  .link-notes {"), dock.indexOf("  .link-go:focus-visible"));
    expect(css).toContain("background: var(--hint-bubble-bg);");
    expect(css).toContain("border: 1px solid var(--hint-bubble-line);");
    expect(css).not.toContain("--warn");
    expect(css).toContain(".link-note:last-child::after {");
    expect(css).not.toMatch(/\.link-note::after/);
    const notes = dock.slice(dock.indexOf("{#snippet linkNote()}"), dock.indexOf("{/snippet}", dock.indexOf("{#snippet linkNote()}")));
    expect(notes).toContain('<div class="link-notes">');
    expect(notes).not.toContain("btn btn-secondary");
    expect(notes.match(/class="link-go"/g)).toHaveLength(3);
  });
});
