import { describe, expect, it } from "vitest";
import { isSafeTmuxName, relativeCreated, shQuote, tmuxKillPrompt, tmuxSummary, tmuxSwitchCommand } from "$lib/tmux";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/session";

describe("shQuote — 셸에 넣는 이름은 언제나 한 낱말이다", () => {
  it("평범한 이름은 그냥 감싼다", () => {
    expect(shQuote("aynx-1")).toBe("'aynx-1'");
    expect(shQuote("my work")).toBe("'my work'");
    expect(shQuote("")).toBe("''");
  });

  it("작은따옴표는 `'\\''` 로 — 닫고, 이스케이프하고, 다시 연다", () => {
    expect(shQuote("it's")).toBe(String.raw`'it'\''s'`);
    expect(shQuote("a'b'c")).toBe(String.raw`'a'\''b'\''c'`);
  });

  it("나머지 셸 메타문자는 손대지 않는다 — `'…'` 안에서는 전부 글자다", () => {
    expect(shQuote("$(id)")).toBe("'$(id)'");
    expect(shQuote("a;rm -rf /")).toBe("'a;rm -rf /'");
    expect(shQuote("back\\slash")).toBe("'back\\slash'");
    expect(shQuote("`whoami`")).toBe("'`whoami`'");
  });
});

describe("isSafeTmuxName — 모양이 아니라 위험을 본다", () => {
  it("서버가 만든 어떤 모양이든 통과한다", () => {
    expect(isSafeTmuxName("aynx-1")).toBe(true);
    expect(isSafeTmuxName("my work")).toBe(true);
    expect(isSafeTmuxName("내 작업")).toBe(true);
    expect(isSafeTmuxName("it's")).toBe(true);
    // 인용이 감싸므로 셸 메타문자는 위험이 아니다.
    expect(isSafeTmuxName("$(id)")).toBe(true);
  });

  it("비어 있거나 제어문자가 있으면 거부한다 — 개행이 유일한 탈출구다", () => {
    expect(isSafeTmuxName("")).toBe(false);
    expect(isSafeTmuxName("   ")).toBe(false);
    expect(isSafeTmuxName("a\nrm -rf /")).toBe(false);
    expect(isSafeTmuxName("a\rb")).toBe(false);
    expect(isSafeTmuxName("a[2J")).toBe(false);
    expect(isSafeTmuxName("a")).toBe(false);
    expect(isSafeTmuxName("m".repeat(129))).toBe(false);
  });
});

describe("tmuxSwitchCommand", () => {
  it("한 줄 + 엔터(`\\r`) 하나다", () => {
    expect(tmuxSwitchCommand("aynx-2")).toBe("tmux switch-client -t 'aynx-2'\r");
    expect(tmuxSwitchCommand("aynx-2").match(/\r/g)).toHaveLength(1);
    expect(tmuxSwitchCommand("aynx-2")).not.toContain("\n");
  });

  it("이름의 따옴표·공백이 명령을 가르지 않는다", () => {
    expect(tmuxSwitchCommand("my work")).toBe("tmux switch-client -t 'my work'\r");
    expect(tmuxSwitchCommand("it's")).toBe(String.raw`tmux switch-client -t 'it'\''s'` + "\r");
  });
});

describe("relativeCreated", () => {
  const now = Date.UTC(2026, 8, 16, 12, 0, 0); // ms
  // 문구는 **인자로** 들어간다 (기본값이 없다 — tmux 메뉴가 `t` 를 넘긴다).
  const ko: Tr = (key, params) => translate("ko", key, params);
  const at = (secondsAgo: number) =>
    relativeCreated(Math.floor(now / 1000) - secondsAgo, now, ko);

  it("분·시간·일로 짧게 접는다 (`전` 없이)", () => {
    expect(at(5)).toBe("방금");
    expect(at(59)).toBe("방금");
    expect(at(60)).toBe("1분");
    expect(at(59 * 60)).toBe("59분");
    expect(at(60 * 60)).toBe("1시간");
    expect(at(25 * 60 * 60)).toBe("1일");
    expect(at(6 * 24 * 60 * 60)).toBe("6일");
  });

  it("일주일이 넘어도 날 수로 센다 — 꼬리 칸 폭이 일정하다", () => {
    expect(at(30 * 24 * 60 * 60)).toBe("30일");
  });

  it("서버 시계가 앞서 있어도 미래를 말하지 않는다", () => {
    expect(at(-3600)).toBe("방금");
  });
});

describe("tmuxSummary", () => {
  const s = (name: string, attached: number) => ({ name, windows: 1, attached, created: 0 });

  it("붙어 있는 것과 비어 있는 것을 센다 — 클라이언트 수가 아니라 세션 수다", () => {
    expect(tmuxSummary([s("a", 2), s("b", 1), s("c", 0)])).toEqual({ attached: 2, empty: 1 });
    expect(tmuxSummary([])).toEqual({ attached: 0, empty: 0 });
  });
});

describe("tmuxKillPrompt — 끄기 확인 글", () => {
  const ko: Tr = (key, params) => translate("ko", key, params);
  const en: Tr = (key, params) => translate("en", key, params);

  it("남의 빈 세션 — 이름 · 창 수 · 되돌릴 수 없음만", () => {
    const p = tmuxKillPrompt({ name: "work", attached: 0, windows: 2 }, false, ko);
    expect(p.title).toBe("tmux 세션 끄기");
    expect(p.okLabel).toBe("끄기");
    expect(p.body).toContain("'work'");
    expect(p.points).toEqual(["창 2개 · 되돌릴 수 없습니다."]);
  });

  it("다른 클라이언트가 붙은 세션 — 그 수를 말한다", () => {
    const p = tmuxKillPrompt({ name: "work", attached: 2, windows: 1 }, false, ko);
    expect(p.points[0]).toContain("다른 클라이언트 2개");
    expect(p.points).toHaveLength(2);
  });

  it("이 타일이 붙어 있는 세션 — 제목 · 단추 · 첫 점이 그 사실을 말하고 자기 몫 1 은 세지 않는다", () => {
    const alone = tmuxKillPrompt({ name: "aynx-1", attached: 1, windows: 3 }, true, ko);
    expect(alone.title).toBe("이 타일의 tmux 세션 끄기");
    expect(alone.okLabel).toBe("끄고 이 타일도 끝내기");
    expect(alone.points[0]).toContain("이 타일의 연결도 끝납니다");
    expect(alone.points.some((x) => x.includes("다른 클라이언트"))).toBe(false);
    const shared = tmuxKillPrompt({ name: "aynx-1", attached: 3, windows: 3 }, true, ko);
    expect(shared.points[1]).toContain("다른 클라이언트 2개");
    // 목록이 낡아 attached 가 0 으로 와도 음수를 말하지 않는다.
    expect(tmuxKillPrompt({ name: "x", attached: 0, windows: 1 }, true, ko).points).toHaveLength(2);
  });

  it("영어 글도 같은 갈래", () => {
    const p = tmuxKillPrompt({ name: "work", attached: 1, windows: 1 }, true, en);
    expect(p.okLabel).toBe("Kill and end this tile");
    expect(p.points[0]).toContain("ends this tile's connection");
  });
});
