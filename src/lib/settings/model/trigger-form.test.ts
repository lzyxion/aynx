import { describe, expect, it } from "vitest";
import { findExample } from "./example-triggers";
import { DEFAULT_TRIGGER_BG } from "./options";
import {
  TEST_MAX_LINES,
  canSaveForm,
  emptyTriggerForm,
  exampleToForm,
  formToTrigger,
  isInert,
  patternError,
  testTrigger,
  triggerToForm,
  urlWarning,
  type TriggerForm,
} from "./trigger-form";

/**
 * 설정 › 트리거 **추가 · 편집 하위 화면**의 순수 부분 (docs/log/2026-10-05-trigger-examples.md "하위 화면으로") —
 * 폼 ↔ 트리거 · 검증 · 예시로 채우기 · 시험 칸 결과.
 */

const form = (over: Partial<TriggerForm> = {}): TriggerForm => ({ ...emptyTriggerForm(), ...over });

describe("폼 ↔ 트리거", () => {
  it("빈 트리거는 배경 하나로 시작한다", () => {
    expect(emptyTriggerForm()).toEqual({ pattern: "", fg: null, bg: DEFAULT_TRIGGER_BG, url: "", tooltip: "" });
  });

  it("빈 칸은 키째 빠지고, 패턴 · 링크는 앞뒤 공백을 뗀다", () => {
    expect(formToTrigger(form({ pattern: "  ERR  ", bg: null, url: "  ", tooltip: " " }), true)).toEqual({
      pattern: "ERR",
      enabled: true,
    });
    expect(
      formToTrigger(form({ pattern: "x", fg: "#fff", bg: "", url: " https://a/$1 ", tooltip: " hi $1 " }), false),
    ).toEqual({ pattern: "x", fg: "#fff", url: "https://a/$1", tooltip: " hi $1 ", enabled: false });
  });

  it("트리거 → 폼 → 트리거 는 제자리다", () => {
    const tr = { pattern: String.raw`\b(E\d{4})\b`, fg: "#abc", url: "https://x/$1", tooltip: "Code $1", enabled: true };
    expect(formToTrigger(triggerToForm(tr), true)).toEqual(tr);
    expect(triggerToForm({ pattern: "a", fg: "  ", bg: null, enabled: true })).toEqual({
      pattern: "a",
      fg: null,
      bg: null,
      url: "",
      tooltip: "",
    });
  });

  it("예시로 채우면 그 예시의 값 그대로(켜진 채로 저장)", () => {
    const rust = findExample("rust")!;
    const f = exampleToForm(rust);
    expect(f.pattern).toBe(rust.trigger.pattern);
    expect(f.url).toBe(rust.trigger.url);
    expect(f.bg).toBeNull();
    expect(formToTrigger(f, true)).toEqual({ ...rust.trigger, enabled: true });
  });
});

describe("검증", () => {
  it("패턴 — 빈칸 · 엔진이 못 읽는 정규식", () => {
    expect(patternError("")).toEqual({ code: "empty" });
    expect(patternError("   ")).toEqual({ code: "empty" });
    expect(patternError("ERR")).toBeNull();
    const bad = patternError("(unclosed");
    expect(bad?.code).toBe("regex");
    expect(canSaveForm(form({ pattern: "(unclosed" }))).toBe(false);
    expect(canSaveForm(form({ pattern: "ok" }))).toBe(true);
  });

  it("링크 경고 — 빈칸은 경고 아님 · 상대 주소 · 열지 않는 스킴", () => {
    expect(urlWarning("")).toBeNull();
    expect(urlWarning("https://jira.example.com/browse/$1")).toBeNull();
    expect(urlWarning("mailto:$1")).toBeNull();
    expect(urlWarning("$1")).toEqual({ code: "invalid" });
    expect(urlWarning("file:///etc/$1")).toEqual({ code: "scheme", scheme: "file:" });
  });

  it("종류가 하나도 없으면 '하는 일 없음'", () => {
    expect(isInert(form({ pattern: "x", bg: null }))).toBe(true);
    expect(isInert(form({ pattern: "x" }))).toBe(false);
    expect(isInert(form({ pattern: "x", bg: null, tooltip: "t" }))).toBe(false);
  });
});

describe("시험 칸", () => {
  it("맞은 구간을 조각으로 — 배경은 터미널처럼 반투명", () => {
    const r = testTrigger(form({ pattern: "ERR", bg: "#7a2637" }), "a ERR b ERR");
    expect(r.hits).toBe(2);
    expect(r.lines).toHaveLength(1);
    expect(r.lines[0].map((p) => p.text)).toEqual(["a ", "ERR", " b ", "ERR"]);
    expect(r.lines[0][1].hit?.bg).toBe("rgba(122, 38, 55, 0.45)");
    expect(r.lines[0][0].hit).toBeUndefined();
  });

  it("여러 줄 — 줄마다 따로, CRLF 도 한 줄로", () => {
    const r = testTrigger(form({ pattern: "x" }), "x\r\nno\nxx");
    expect(r.lines.map((l) => l.map((p) => p.text).join(""))).toEqual(["x", "no", "xx"]);
    expect(r.hits).toBe(3);
  });

  it("링크는 치환 + 인코딩 + 안전 검사를 거친 주소, 툴팁은 치환한 글", () => {
    const rust = exampleToForm(findExample("rust")!);
    const [piece] = testTrigger(rust, "error[E0308]: x").lines[0].filter((p) => p.hit);
    expect(piece.text).toBe("E0308");
    expect(piece.hit?.url).toBe("https://doc.rust-lang.org/error_codes/E0308.html");
    expect(piece.hit?.urlBlocked).toBe(false);
    expect(piece.hit?.tooltip).toBe("Rust error E0308 — Ctrl+click to open the explanation");
  });

  it("캡처가 주소를 바꿔치기하지 못한다 — 인코딩된 채로", () => {
    const f = form({ pattern: String.raw`id=(\S+)`, url: "https://x.test/q/$1" });
    const [p] = testTrigger(f, "id=a/b?c").lines[0].filter((x) => x.hit);
    expect(p.hit?.url).toBe("https://x.test/q/a%2Fb%3Fc");
  });

  it("열지 않는 스킴이면 url 없음 + 막힘 표시", () => {
    const f = form({ pattern: "E1", url: "file:///$0" });
    const [p] = testTrigger(f, "E1").lines[0];
    expect(p.hit?.url).toBeNull();
    expect(p.hit?.urlBlocked).toBe(true);
  });

  it("패턴이 틀리면 맞은 곳 없이 글자만", () => {
    const r = testTrigger(form({ pattern: "(bad" }), "(bad line");
    expect(r.hits).toBe(0);
    expect(r.lines).toEqual([[{ text: "(bad line" }]]);
  });

  it("줄이 많으면 앞에서 자른다", () => {
    const text = Array.from({ length: TEST_MAX_LINES + 5 }, () => "x").join("\n");
    const r = testTrigger(form({ pattern: "x" }), text);
    expect(r.truncated).toBe(true);
    expect(r.lines).toHaveLength(TEST_MAX_LINES);
  });

  it("빈 줄은 빈 조각 목록", () => {
    expect(testTrigger(form({ pattern: "x" }), "").lines).toEqual([[]]);
  });
});
