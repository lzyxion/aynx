import { describe, expect, it } from "vitest";
import { LOST_NOTICE_MS, dismissesLostNotice, lostNoticeOf, lostNoticeText } from "./lost-notice";

// 재부착 유실 안내 — 타일 위 막대로 뜨는 순수 부분.

describe("lostNoticeOf", () => {
  it("유실이 없으면 안내도 없다", () => {
    expect(lostNoticeOf(undefined)).toBeNull();
    expect(lostNoticeOf(null)).toBeNull();
    expect(lostNoticeOf(0)).toBeNull();
    expect(lostNoticeOf(-5)).toBeNull();
    expect(lostNoticeOf(Number.NaN)).toBeNull();
  });

  it("KiB 는 반올림, 1 KiB 미만은 1", () => {
    expect(lostNoticeOf(1)).toEqual({ bytes: 1, kib: 1 });
    expect(lostNoticeOf(1536)).toEqual({ bytes: 1536, kib: 2 });
    // 설치본 실기 10-10 의 server.log 수치
    expect(lostNoticeOf(2960956)?.kib).toBe(2892);
  });
});

describe("lostNoticeText", () => {
  it("i18n 키에 KiB 를 넘긴다", () => {
    const seen: unknown[] = [];
    const text = lostNoticeText({ bytes: 4096, kib: 4 }, (key, vars) => {
      seen.push(key, vars);
      return `${key}:${vars.kib}`;
    });
    expect(text).toBe("pane.notice.reattached_lost:4");
    expect(seen).toEqual(["pane.notice.reattached_lost", { kib: 4 }]);
  });
});

describe("자동 닫힘 · 키", () => {
  it("8초 뒤 걷힌다", () => {
    expect(LOST_NOTICE_MS).toBe(8000);
  });

  it("수식 키 단독은 걷지 않고 나머지는 걷는다", () => {
    for (const k of ["Control", "Shift", "Alt", "Meta", "AltGraph"]) expect(dismissesLostNotice(k)).toBe(false);
    for (const k of ["a", "Enter", "Escape", "ArrowUp", "Process", " "]) expect(dismissesLostNotice(k)).toBe(true);
  });
});
