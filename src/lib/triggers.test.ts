import { describe, expect, it } from "vitest";
import {
  compileTriggers,
  dropLines,
  eraseEffect,
  expandTemplate,
  matchLine,
  safeUrl,
  translucent,
} from "$lib/triggers";
import type { CompiledTrigger, DecoratedLine, Trigger } from "$lib/triggers";

/**
 * 표시 트리거의 **순수 층**만 — 컴파일·매칭·템플릿 치환·URL 검사
 * (docs/log/2026-09-02-triggers-webgl-logging.md · docs/log/2026-09-04-trigger-links-tooltips.md).
 *
 * xterm 에 붙는 쪽(`attachTriggers`)은 여기 없다. 마커·데코레이션·링크 프로바이더는
 * 살아 있는 터미널이 있어야 하고, 이 파일이 붙드는 것은 그 위에서 도는 **판정 규칙**이다 —
 * 특히 링크의 안전선 두 겹(인코딩 · 스킴 화이트리스트)은 전부 순수 함수 안에 있다.
 */

/** 테스트용 트리거 한 줄 — 안 적은 칸은 "안 정함" 이다 */
function trigger(t: Partial<Trigger> & { pattern: string }): Trigger {
  return { enabled: true, ...t };
}

/** 패턴 하나만 컴파일해 꺼내 온다 (매칭 테스트의 준비 코드) */
function compileOne(t: Partial<Trigger> & { pattern: string }): CompiledTrigger {
  const { compiled, errors } = compileTriggers([trigger(t)]);
  expect(errors).toEqual([]);
  expect(compiled).toHaveLength(1);
  return compiled[0];
}

// ---------------------------------------------------------------------------
// 1. expandTemplate — `$0` · `$1` … 과 인코딩
// ---------------------------------------------------------------------------

describe("expandTemplate — 자리표시자 치환", () => {
  const groups = ["ERR-1234 났다", "ERR-1234", "1234"];

  it("$0 은 매치 전체다", () => {
    expect(expandTemplate("[$0]", groups, false)).toBe("[ERR-1234 났다]");
  });

  it("$1·$2 는 괄호 캡처다 (JS RegExp 결과 배열과 같은 번호)", () => {
    expect(expandTemplate("$1 / $2", groups, false)).toBe("ERR-1234 / 1234");
  });

  it("두 자리까지 읽는다 ($12)", () => {
    const many = Array.from({ length: 13 }, (_, i) => `g${i}`);
    expect(expandTemplate("$12", many, false)).toBe("g12");
    // 12번 캡처가 없으면 두 자리를 통째로 지운다 (`$1` 뒤에 `2` 가 남지 않는다).
    expect(expandTemplate("$12", groups, false)).toBe("");
  });

  it("없는 번호는 빈 문자열로 지운다 — `$9` 오타가 URL 에 실려 나가지 않는다", () => {
    expect(expandTemplate("a$9b", groups, false)).toBe("ab");
    expect(expandTemplate("https://x/$5", groups, true)).toBe("https://x/");
  });

  it("매치되지 않은 선택 캡처(undefined)도 빈 문자열이다", () => {
    const m = /(a)(b)?/.exec("a");
    expect(m).not.toBeNull();
    expect(expandTemplate("[$2]", [...(m ?? [])], false)).toBe("[]");
  });

  it("$$ 는 리터럴 달러 한 글자다", () => {
    expect(expandTemplate("$$1", groups, false)).toBe("$1");
    expect(expandTemplate("값 $$$1", groups, false)).toBe("값 $ERR-1234");
  });

  it("자리표시자가 없는 템플릿은 그대로 나온다", () => {
    expect(expandTemplate("https://example.com/", groups, true)).toBe("https://example.com/");
  });

  it("혼자 남은 `$` 나 글자가 붙은 `$a` 는 건드리지 않는다", () => {
    expect(expandTemplate("100$ $a $", groups, false)).toBe("100$ $a $");
  });

  it("빈 템플릿은 빈 문자열이다", () => {
    expect(expandTemplate("", groups, true)).toBe("");
  });
});

describe("expandTemplate — 인코딩이 곧 링크의 안전선", () => {
  it("URL 쪽(encode=true)은 캡처를 encodeURIComponent 로 감싼다", () => {
    const groups = ["x", "a b&c=d"];
    expect(expandTemplate("https://x/?q=$1", groups, true)).toBe("https://x/?q=a%20b%26c%3Dd");
  });

  it("스킴·호스트를 갈아치우려는 캡처가 리터럴로 죽는다", () => {
    // 원격이 보낸 바이트가 `://` 를 품어도 `:`·`/` 가 전부 퍼센트로 바뀐다.
    const groups = ["x", "evil.example.com/path?a=1#f"];
    const url = expandTemplate("https://jira.example.com/browse/$1", groups, true);
    expect(url).toBe("https://jira.example.com/browse/evil.example.com%2Fpath%3Fa%3D1%23f");
    expect(new URL(url).host).toBe("jira.example.com");
  });

  it("경로 탈출(`../`)도 인코딩되어 한 칸으로 남는다", () => {
    const url = expandTemplate("https://x/a/$1", ["", "../../etc"], true);
    expect(url).toBe("https://x/a/..%2F..%2Fetc");
    expect(new URL(url).pathname).toBe("/a/..%2F..%2Fetc");
  });

  it("툴팁 쪽(encode=false)은 사람이 읽는 글이라 인코딩하지 않는다", () => {
    const groups = ["x", "경로 a/b?c"];
    expect(expandTemplate("이슈 $1", groups, false)).toBe("이슈 경로 a/b?c");
  });

  it("같은 템플릿이라도 encode 여부로 결과가 갈린다", () => {
    const groups = ["x", "a/b"];
    expect(expandTemplate("$1", groups, true)).not.toBe(expandTemplate("$1", groups, false));
  });
});

// ---------------------------------------------------------------------------
// 2. safeUrl — 허용 스킴만 통과
// ---------------------------------------------------------------------------

describe("safeUrl", () => {
  it("http·https·mailto 는 통과한다", () => {
    expect(safeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(safeUrl("http://example.com/")).toBe("http://example.com/");
    expect(safeUrl("mailto:me@example.com")).toBe("mailto:me@example.com");
  });

  it("javascript: · data: · file: 는 막는다 — 클릭 한 번이 코드 실행이 되면 안 된다", () => {
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeUrl("file:///C:/Windows/System32/cmd.exe")).toBeNull();
  });

  it("그 밖의 스킴(ftp·앱 커스텀)도 막는다", () => {
    expect(safeUrl("ftp://x/y")).toBeNull();
    expect(safeUrl("vscode://file/C:/a")).toBeNull();
    expect(safeUrl("aynx://open")).toBeNull();
  });

  it("스킴 대소문자는 URL 이 정규화한 뒤에 판정한다", () => {
    expect(safeUrl("HTTPS://Example.COM/A")).toBe("https://example.com/A");
    // 막는 쪽도 마찬가지다 — 대문자로 적어도 빠져나가지 못한다.
    expect(safeUrl("JavaScript:alert(1)")).toBeNull();
  });

  it("파싱에 실패하는 값은 null (상대 경로·`$1` 만 적은 템플릿)", () => {
    expect(safeUrl("")).toBeNull();
    expect(safeUrl("/browse/ERR-1")).toBeNull();
    expect(safeUrl("example.com")).toBeNull();
    expect(safeUrl("치환되지 않은 값")).toBeNull();
  });

  it("치환 → 검사 순서를 그대로 이어 붙여도 안전선이 남는다", () => {
    // 템플릿이 `$1` 하나뿐이면 원격이 스킴을 통째로 고를 수 있는 것처럼 보이지만,
    // 인코딩 때문에 `:` 가 살아남지 못해 URL 파싱부터 실패한다.
    const raw = expandTemplate("$1", ["", "javascript:alert(1)"], true);
    expect(raw).toBe("javascript%3Aalert(1)");
    expect(safeUrl(raw)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. compileTriggers
// ---------------------------------------------------------------------------

describe("compileTriggers", () => {
  it("목록이 없거나 배열이 아니면 빈 결과다", () => {
    expect(compileTriggers(null)).toEqual({ compiled: [], errors: [] });
    expect(compileTriggers(undefined)).toEqual({ compiled: [], errors: [] });
    expect(compileTriggers([])).toEqual({ compiled: [], errors: [] });
  });

  it("g 플래그를 붙여 컴파일한다 (exec 루프가 lastIndex 로 훑는다)", () => {
    const c = compileOne({ pattern: "ERR-\\d+", fg: "#ff0000" });
    expect(c.source).toBe("ERR-\\d+");
    expect(c.re.flags).toContain("g");
    expect(c.re.source).toBe("ERR-\\d+");
  });

  it("패턴이 비었거나 공백뿐이면 조용히 건너뛴다 (오류도 아니다)", () => {
    const { compiled, errors } = compileTriggers([
      trigger({ pattern: "" }),
      trigger({ pattern: "   " }),
    ]);
    expect(compiled).toEqual([]);
    expect(errors).toEqual([]);
  });

  it("패턴 앞뒤 공백은 떼고 컴파일한다", () => {
    expect(compileOne({ pattern: "  ERR  " }).source).toBe("ERR");
  });

  it("문법이 잘못된 정규식 하나가 나머지를 죽이지 않는다", () => {
    const { compiled, errors } = compileTriggers([
      trigger({ pattern: "[" }),
      trigger({ pattern: "ok", fg: "#0f0" }),
    ]);
    expect(compiled).toHaveLength(1);
    expect(compiled[0].source).toBe("ok");
    expect(errors).toHaveLength(1);
    expect(errors[0].index).toBe(0);
    expect(errors[0].pattern).toBe("[");
    expect(errors[0].message).not.toBe("");
  });

  it("오류의 index 는 **원본 목록**에서의 행 번호다", () => {
    const { errors } = compileTriggers([
      trigger({ pattern: "a" }),
      trigger({ pattern: "" }),
      trigger({ pattern: "(" }),
    ]);
    expect(errors.map((e) => e.index)).toEqual([2]);
  });

  it("꺼진 항목은 컴파일 목록에서 빠진다", () => {
    const { compiled } = compileTriggers([
      trigger({ pattern: "on", fg: "#fff" }),
      trigger({ pattern: "off", fg: "#fff", enabled: false }),
    ]);
    expect(compiled.map((c) => c.source)).toEqual(["on"]);
  });

  it("꺼져 있어도 문법 오류는 알려준다 (고치기 전에는 켜도 안 먹는다)", () => {
    const { compiled, errors } = compileTriggers([
      trigger({ pattern: "[", enabled: false }),
    ]);
    expect(compiled).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0].index).toBe(0);
  });

  it("빈 색·빈 템플릿은 null 로 접는다 (백엔드 fold_empty 와 같은 규칙)", () => {
    const c = compileOne({ pattern: "a", fg: "  ", bg: "", url: "   ", tooltip: null });
    expect(c.fg).toBeNull();
    expect(c.bg).toBeNull();
    expect(c.url).toBeNull();
    expect(c.tooltip).toBeNull();
  });

  it("값의 공백은 떼고 담는다", () => {
    const c = compileOne({ pattern: "a", fg: " #ff0000 ", url: " https://x/$1 " });
    expect(c.fg).toBe("#ff0000");
    expect(c.url).toBe("https://x/$1");
  });

  it("한 트리거에 색·링크·툴팁을 함께 걸 수 있다", () => {
    const c = compileOne({
      pattern: "([A-Z]+-\\d+)",
      fg: "#ffcc00",
      bg: "#331100",
      url: "https://jira.example.com/browse/$1",
      tooltip: "이슈 $1",
    });
    expect(c.fg).toBe("#ffcc00");
    expect(c.bg).toBe("#331100");
    expect(c.url).toBe("https://jira.example.com/browse/$1");
    expect(c.tooltip).toBe("이슈 $1");
  });
});

// ---------------------------------------------------------------------------
// 4. matchLine
// ---------------------------------------------------------------------------

describe("matchLine", () => {
  it("빈 줄이나 빈 목록이면 아무것도 없다", () => {
    expect(matchLine("", [compileOne({ pattern: "a" })])).toEqual([]);
    expect(matchLine("abc", [])).toEqual([]);
  });

  it("한 줄에서 같은 패턴을 여러 번 잡는다", () => {
    const c = compileOne({ pattern: "ERR", fg: "#f00" });
    const out = matchLine("ERR ok ERR", [c]);
    expect(out.map((m) => [m.start, m.end])).toEqual([
      [0, 3],
      [7, 10],
    ]);
    expect(out[0].fg).toBe("#f00");
  });

  it("결과는 start 오름차순이다 (트리거 순서와 무관하게)", () => {
    const { compiled } = compileTriggers([
      trigger({ pattern: "zzz", fg: "#1" }),
      trigger({ pattern: "aaa", fg: "#2" }),
    ]);
    const out = matchLine("aaa---zzz", compiled);
    expect(out.map((m) => m.start)).toEqual([0, 6]);
  });

  it("구간이 겹치면 **목록에서 먼저 나온 트리거**가 이긴다", () => {
    const { compiled } = compileTriggers([
      trigger({ pattern: "ERR", fg: "#first" }),
      trigger({ pattern: "ERROR", fg: "#second" }),
    ]);
    const out = matchLine("ERROR", compiled);
    expect(out).toHaveLength(1);
    expect(out[0].fg).toBe("#first");
    expect(out[0].end).toBe(3);
  });

  it("겹치지 않으면 두 트리거가 나란히 산다", () => {
    const { compiled } = compileTriggers([
      trigger({ pattern: "ERR", fg: "#a" }),
      trigger({ pattern: "OK", fg: "#b" }),
    ]);
    expect(matchLine("ERR OK", compiled).map((m) => m.fg)).toEqual(["#a", "#b"]);
  });

  it("길이 0 매치는 건너뛴다 — 무한 루프가 되지 않는다", () => {
    const c = compileOne({ pattern: "b*", fg: "#f00" });
    const out = matchLine("abc", [c]);
    expect(out.map((m) => [m.start, m.end])).toEqual([[1, 2]]);
  });

  it("길이 0 만 나오는 패턴이면 결과가 비고, 그래도 끝난다", () => {
    const c = compileOne({ pattern: "\\b", fg: "#f00" });
    expect(matchLine("abc def", [c])).toEqual([]);
  });

  it("줄당 상한을 넘으면 조용히 자른다", () => {
    const c = compileOne({ pattern: ".", fg: "#f00" });
    expect(matchLine("x".repeat(100), [c], 5)).toHaveLength(5);
    // 기본 상한은 32 다.
    expect(matchLine("x".repeat(100), [c])).toHaveLength(32);
  });

  it("잘라도 start 오름차순은 지킨다", () => {
    const c = compileOne({ pattern: "\\d", fg: "#f00" });
    const out = matchLine("0123456789", [c], 3);
    expect(out.map((m) => m.start)).toEqual([0, 1, 2]);
  });

  it("색만 있는 트리거는 캡처 배열을 만들지 않는다 (줄마다 도는 자리다)", () => {
    const c = compileOne({ pattern: "(ERR)-(\\d+)", fg: "#f00" });
    expect(matchLine("ERR-12", [c])[0].groups).toBeUndefined();
  });

  it("URL·툴팁이 있으면 캡처 배열이 붙는다", () => {
    const c = compileOne({ pattern: "(ERR)-(\\d+)", url: "https://x/$2" });
    const m = matchLine("보라 ERR-12 끝", [c])[0];
    expect(m.groups).toEqual(["ERR-12", "ERR", "12"]);
    expect(m.url).toBe("https://x/$2");
    expect(m.tooltip).toBeNull();
  });

  it("툴팁만 있어도 캡처가 붙는다", () => {
    const c = compileOne({ pattern: "(ERR)", tooltip: "이슈 $1" });
    expect(matchLine("ERR", [c])[0].groups).toEqual(["ERR", "ERR"]);
  });

  it("링크 경로를 끝까지 이어 붙인다 (매치 → 치환 → 검사)", () => {
    const c = compileOne({
      pattern: "\\b([A-Z]+-\\d+)\\b",
      url: "https://jira.example.com/browse/$1",
      tooltip: "이슈 $1",
    });
    const m = matchLine("빌드 실패 PROJ-42 확인", [c])[0];
    const groups = m.groups ?? [];
    expect(safeUrl(expandTemplate(m.url ?? "", groups, true))).toBe(
      "https://jira.example.com/browse/PROJ-42",
    );
    expect(expandTemplate(m.tooltip ?? "", groups, false)).toBe("이슈 PROJ-42");
  });

  it("여러 번 불러도 결과가 같다 (lastIndex 를 매번 되돌린다)", () => {
    const c = compileOne({ pattern: "ERR", fg: "#f00" });
    const first = matchLine("ERR ERR", [c]);
    const second = matchLine("ERR ERR", [c]);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// 5. translucent
// ---------------------------------------------------------------------------

describe("translucent — hex 만 반투명으로 바꾼다", () => {
  it("색이 없으면 빈 문자열이다", () => {
    expect(translucent(null)).toBe("");
  });

  it("6자리 hex 는 rgba() 가 된다", () => {
    expect(translucent("#ff8800")).toBe("rgba(255, 136, 0, 0.45)");
  });

  it("3자리 hex 는 두 배로 펴서 읽는다", () => {
    expect(translucent("#f80")).toBe("rgba(255, 136, 0, 0.45)");
  });

  it("대문자·앞뒤 공백도 받는다", () => {
    expect(translucent("  #FF8800 ")).toBe("rgba(255, 136, 0, 0.45)");
  });

  it("알파를 직접 줄 수 있다", () => {
    expect(translucent("#000000", 1)).toBe("rgba(0, 0, 0, 1)");
  });

  it("사람이 적은 rgba()·이름 색·8자리 hex 는 그대로 둔다 (남의 알파를 덮지 않는다)", () => {
    expect(translucent("rgba(1, 2, 3, 0.1)")).toBe("rgba(1, 2, 3, 0.1)");
    expect(translucent("tomato")).toBe("tomato");
    expect(translucent("#ff880080")).toBe("#ff880080");
    expect(translucent("hsl(30 100% 50%)")).toBe("hsl(30 100% 50%)");
  });

  it("반투명이 기본값이다 — 불투명하면 WebGL 렌더러에서 글자가 사라진다", () => {
    const alpha = Number(/, ([\d.]+)\)$/.exec(translucent("#123456"))?.[1]);
    expect(alpha).toBeGreaterThan(0);
    expect(alpha).toBeLessThan(1);
  });
});

// ---------------------------------------------------------------------------
// 화면 지우기(`clear`) 뒤 빈 줄에 남던 하이라이트
// (docs/log/2026-10-05-trigger-highlight-clear.md)
// ---------------------------------------------------------------------------

/** 줄 `line` 에 걸린 가짜 마커·데코 하나 — dispose 를 셌다가 확인한다 */
function fakeLine(line: number, isDisposed = false) {
  const counts = { deco: 0, marker: 0 };
  const item: DecoratedLine = {
    marker: { line, isDisposed, dispose: () => void counts.marker++ },
    decorations: [{ dispose: () => void counts.deco++ }, { dispose: () => void counts.deco++ }],
  };
  return { item, counts };
}

describe("eraseEffect — 어느 ED 가 어느 줄을 걷나", () => {
  // 스크롤백 100줄 + 화면 24줄: 뷰포트는 100..123.
  it("ED 2 는 뷰포트 줄만 걷는다", () => {
    const fx = eraseEffect(2, 100, 24, false);
    expect(fx.checkBlank).toBe(false);
    expect([99, 100, 123, 124].map((l) => fx.hit?.(l))).toEqual([false, true, true, false]);
  });

  it("ED 2 라도 scrollOnEraseInDisplay 면 글자가 살아 있으니 걷지 않는다", () => {
    expect(eraseEffect(2, 100, 24, true)).toEqual({ hit: null, checkBlank: false });
  });

  it("ED 3 은 스크롤백 줄을 걷고, ConPTY 를 위해 빈 줄 검사를 건다", () => {
    const fx = eraseEffect(3, 100, 24, false);
    expect(fx.checkBlank).toBe(true);
    expect([0, 99, 100].map((l) => fx.hit?.(l))).toEqual([true, true, false]);
  });

  it("ED 0 · ED 1 · 매개변수 없음은 손대지 않는다 (진행 막대·TUI)", () => {
    for (const mode of [0, 1, undefined]) {
      expect(eraseEffect(mode, 100, 24, false)).toEqual({ hit: null, checkBlank: false });
    }
  });
});

describe("dropLines — 걷은 줄은 데코·마커를 버리고 배열에서도 뺀다", () => {
  it("맞는 줄과 이미 죽은 마커만 빼고 나머지는 순서대로 남긴다", () => {
    const a = fakeLine(5);
    const b = fakeLine(10);
    const c = fakeLine(20, true);
    const d = fakeLine(30);
    const live = [a.item, b.item, c.item, d.item];
    expect(dropLines(live, (l) => l === 10)).toBe(2);
    expect(live).toEqual([a.item, d.item]);
    expect(b.counts).toEqual({ deco: 2, marker: 1 });
    expect(c.counts).toEqual({ deco: 2, marker: 1 });
    expect(a.counts).toEqual({ deco: 0, marker: 0 });
  });

  it("ED 2 의 뷰포트 판정과 이으면 화면 줄의 하이라이트만 사라진다", () => {
    const old = fakeLine(50); // 스크롤백 — 글자가 살아 있다
    const shown = fakeLine(110); // 화면 — `clear` 로 지워진다
    const live = [old.item, shown.item];
    const hit = eraseEffect(2, 100, 24, false).hit;
    expect(hit).not.toBeNull();
    dropLines(live, hit!);
    expect(live).toEqual([old.item]);
  });
});
