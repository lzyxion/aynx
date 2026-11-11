import { describe, expect, it } from "vitest";
import {
  DRAFT_HISTORY_MAX_CHARS,
  DRAFT_TEXT_MAX_BYTES,
  fitDocDraft,
  sanitizeDocDraft,
  sanitizeSelection,
  utf8Bytes,
  type DocDraft,
} from "$lib/doc-draft";

/**
 * 창을 넘는 저장 안 한 문서의 초안 — 한도(글은 거절 · 기록만 버리기)와 받는 쪽 정화가 맞는가.
 * 이 값이 틀리면 글이 말없이 사라지거나(정화가 지나침), 망가진 짐이 편집기를 깨뜨린다(정화가 모자람).
 */

const base = (over: Partial<DocDraft> = {}): DocDraft => ({
  text: "hello\nworld\n",
  baseVersion: "v1",
  eol: "\n",
  selection: { ranges: [{ anchor: 2, head: 4 }], main: 0 },
  scrollPos: 6,
  history: { done: [], undone: [] },
  ...over,
});

describe("utf8Bytes", () => {
  it("한글 · 서로게이트 쌍 · ASCII 를 UTF-8 로 센다", () => {
    expect(utf8Bytes("abc")).toBe(3);
    expect(utf8Bytes("가")).toBe(3);
    expect(utf8Bytes("é")).toBe(2);
    expect(utf8Bytes("😀")).toBe(4);
    expect(utf8Bytes("a가😀")).toBe(new TextEncoder().encode("a가😀").length);
  });
});

describe("fitDocDraft — 보내는 쪽의 한도", () => {
  it("한도 안이면 글 · 커서 · 스크롤 · 기록을 그대로 싣는다", () => {
    expect(fitDocDraft(base())).toEqual(base());
  });

  it("글이 상한(2 MiB)을 넘으면 싣지 않는다 — 부르는 쪽은 예전처럼 창 넘기기를 거절한다", () => {
    const at = "a".repeat(DRAFT_TEXT_MAX_BYTES);
    expect(fitDocDraft(base({ text: at, selection: undefined, scrollPos: undefined }))?.text.length).toBe(at.length);
    expect(fitDocDraft(base({ text: at + "a" }))).toBeNull();
    // 바이트로 센다 — 한글은 글자당 3
    expect(fitDocDraft(base({ text: "가".repeat(Math.floor(DRAFT_TEXT_MAX_BYTES / 3) + 1) }))).toBeNull();
  });

  it("실행 취소 기록이 상한을 넘으면 **기록만** 버리고 글 · 커서는 싣는다", () => {
    const big = { done: ["x".repeat(DRAFT_HISTORY_MAX_CHARS)], undone: [] };
    const got = fitDocDraft(base({ history: big }));
    expect(got).not.toBeNull();
    expect(got!.history).toBeUndefined();
    expect(got!.text).toBe(base().text);
    expect(got!.selection).toEqual(base().selection);
  });

  it("JSON 으로 적을 수 없는 기록(순환)도 기록만 버린다", () => {
    const cyc: Record<string, unknown> = {};
    cyc.self = cyc;
    const got = fitDocDraft(base({ history: cyc }));
    expect(got?.history).toBeUndefined();
    expect(got?.text).toBe(base().text);
  });

  it("글 밖의 선택 · 스크롤은 버린다(글은 그대로)", () => {
    const got = fitDocDraft(base({ selection: { ranges: [{ anchor: 0, head: 999 }], main: 0 }, scrollPos: 999 }));
    expect(got?.selection).toBeUndefined();
    expect(got?.scrollPos).toBeUndefined();
    expect(got?.text).toBe(base().text);
  });
});

describe("sanitizeDocDraft — 받는 쪽의 정화", () => {
  it("JSON 왕복을 거친 초안이 그대로 살아난다(CRLF 포함)", () => {
    const d = base({ text: "a\r\nb\r\n", eol: "\r\n", selection: { ranges: [{ anchor: 1, head: 1 }], main: 0 } });
    expect(sanitizeDocDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
  });

  it("글 · 기준 version · 줄 끝이 맞지 않으면 초안이 아니다", () => {
    expect(sanitizeDocDraft(null)).toBeNull();
    expect(sanitizeDocDraft("text")).toBeNull();
    expect(sanitizeDocDraft([])).toBeNull();
    expect(sanitizeDocDraft({ ...base(), text: 3 })).toBeNull();
    expect(sanitizeDocDraft({ ...base(), baseVersion: null })).toBeNull();
    expect(sanitizeDocDraft({ ...base(), baseVersion: "v".repeat(300) })).toBeNull();
    expect(sanitizeDocDraft({ ...base(), eol: "\r" })).toBeNull();
    expect(sanitizeDocDraft({ ...base(), text: "a".repeat(DRAFT_TEXT_MAX_BYTES + 1) })).toBeNull();
  });

  it("모르는 모양의 선택 · 스크롤 · 기록은 하나씩 버리고 글은 남긴다", () => {
    const got = sanitizeDocDraft({
      ...base(),
      selection: { ranges: [{ anchor: -1, head: 0 }], main: 0 },
      scrollPos: "top",
      history: ["not", "an", "object"],
      extra: "무시",
    });
    expect(got).toEqual({ text: base().text, baseVersion: "v1", eol: "\n" });
  });
});

describe("sanitizeSelection", () => {
  it("주 선택 번호가 범위 밖 · 빈 범위 · 숫자가 아닌 자리면 버린다", () => {
    expect(sanitizeSelection({ ranges: [{ anchor: 0, head: 0 }], main: 1 }, 5)).toBeUndefined();
    expect(sanitizeSelection({ ranges: [], main: 0 }, 5)).toBeUndefined();
    expect(sanitizeSelection({ ranges: [{ anchor: 0.5, head: 0 }], main: 0 }, 5)).toBeUndefined();
    expect(sanitizeSelection({ ranges: [{ anchor: 0, head: 5 }, { anchor: 1, head: 2 }], main: 1 }, 5)).toEqual({
      ranges: [
        { anchor: 0, head: 5 },
        { anchor: 1, head: 2 },
      ],
      main: 1,
    });
  });
});
