import { describe, expect, it } from "vitest";
import {
  buildBlockMatcher,
  buildMatcher,
  matchesInLine,
  parseSearchQuery,
} from "$lib/search-query";
import type { SearchQuery } from "$lib/search-query";

// 문법의 뼈대는 `search-query.ts` 머리말에 있다 — 앞 토큰만 특별하고, 나머지 전부가 검색어다.

const NONE = { regex: false, caseSensitive: false, wholeWord: false };

describe("parseSearchQuery · 범위", () => {
  it("`@이름` 은 그 터미널만 — 이름은 공백 전까지", () => {
    expect(parseSearchQuery("@web1 error")).toEqual({
      scope: { kind: "terminal", name: "web1" },
      block: null,
      options: NONE,
      text: "error",
    });
  });

  it("`@` 하나(빈 이름)도 유효하다 — 자동완성 드롭다운이 보는 상태", () => {
    expect(parseSearchQuery("@")).toEqual({
      scope: { kind: "terminal", name: "" },
      block: null,
      options: NONE,
      text: "",
    });
  });

  it("이름에 공백이 있으면 따옴표로 감싼다", () => {
    expect(parseSearchQuery('@"my term" error')).toEqual({
      scope: { kind: "terminal", name: "my term" },
      block: null,
      options: NONE,
      text: "error",
    });
  });

  it("이름의 `/2` 충돌 구분 번호는 그냥 문자열로 둔다 (맞추는 일은 레지스트리 몫)", () => {
    expect(parseSearchQuery("@bash/2 err").scope).toEqual({ kind: "terminal", name: "bash/2" });
  });

  it("같은 축이 둘 이상이면 **나중 것이 이긴다** (고쳐 치는 몸짓)", () => {
    expect(parseSearchQuery("@a @b x").scope).toEqual({ kind: "terminal", name: "b" });
    expect(parseSearchQuery("#a #b x").block).toBe("b");
  });
});

/**
 * `#` 는 **`@` 와 직교하는 축**이다 (docs/log/2026-09-08-block-search.md).
 *
 * 옛 규칙에서는 둘이 한 자리를 다퉈 `@web1 #build` 가 `web1` 을 조용히 버렸다 — 사용자가 적은
 * 말의 절반을 소리 없이 무시하는 것이라 바꿨다. 지금은 칸이 둘이고 **순서도 가리지 않는다**.
 */
describe("parseSearchQuery · `#` 블록 축", () => {
  it("`#명령` 은 블록 검색어다 — 뒤에 남은 것은 그대로 검색어", () => {
    expect(parseSearchQuery("#build 실패")).toEqual({
      scope: null,
      block: "build",
      options: NONE,
      text: "실패",
    });
  });

  it("`@` 와 `#` 는 **서로를 덮지 않고 순서도 가리지 않는다**", () => {
    const a = parseSearchQuery("@web1 #build");
    const b = parseSearchQuery("#build @web1");
    expect(a).toEqual({
      scope: { kind: "terminal", name: "web1" },
      block: "build",
      options: NONE,
      text: "",
    });
    expect(b).toEqual(a);
  });

  it("`#` 하나(빈 항)도 유효하다 — '그 범위의 블록 전부' 라 `null` 과 다른 값이다", () => {
    expect(parseSearchQuery("#").block).toBe("");
    expect(parseSearchQuery("# ").block).toBe("");
    expect(parseSearchQuery("error").block).toBeNull();
  });

  it("항에 공백이 있으면 따옴표로 감싼다", () => {
    expect(parseSearchQuery('#"make all" 오류')).toEqual({
      scope: null,
      block: "make all",
      options: NONE,
      text: "오류",
    });
  });

  it("옵션은 `#` 의 항에도 걸리고, 순서를 가리지 않는다", () => {
    expect(parseSearchQuery("/case @web1 #Build x")).toEqual({
      scope: { kind: "terminal", name: "web1" },
      block: "Build",
      options: { regex: false, caseSensitive: true, wholeWord: false },
      text: "x",
    });
  });

  it("이스케이프는 그대로다 — 앞 공백·따옴표면 `#` 도 그냥 글자다", () => {
    expect(parseSearchQuery(" #build")).toEqual({
      scope: null,
      block: null,
      options: NONE,
      text: "#build",
    });
    expect(parseSearchQuery('"#build"')).toEqual({
      scope: null,
      block: null,
      options: NONE,
      text: "#build",
    });
    // 맨 앞이 아니면 토큰이 아니다
    expect(parseSearchQuery("foo #build").block).toBeNull();
  });
});

describe("parseSearchQuery · 옵션", () => {
  it("`/re` · `/case` · `/word` 셋만 옵션이다", () => {
    expect(parseSearchQuery("/re ^a.*z$")).toEqual({
      scope: null,
      block: null,
      options: { regex: true, caseSensitive: false, wholeWord: false },
      text: "^a.*z$",
    });
    expect(parseSearchQuery("/case Err").options.caseSensitive).toBe(true);
    expect(parseSearchQuery("/word cat").options.wholeWord).toBe(true);
  });

  it("범위 + 옵션 여러 개를 섞어도 순서를 가리지 않는다", () => {
    expect(parseSearchQuery("@web1 /re /word /case foo bar")).toEqual({
      scope: { kind: "terminal", name: "web1" },
      block: null,
      options: { regex: true, caseSensitive: true, wholeWord: true },
      text: "foo bar",
    });
    expect(parseSearchQuery('/case @"my term" /re x')).toEqual({
      scope: { kind: "terminal", name: "my term" },
      block: null,
      options: { regex: true, caseSensitive: true, wholeWord: false },
      text: "x",
    });
  });

  it("**알려지지 않은 `/…` 는 옵션이 아니라 검색어의 시작**이다 (경로와 충돌하므로)", () => {
    expect(parseSearchQuery("/usr/bin")).toEqual({
      scope: null,
      block: null,
      options: NONE,
      text: "/usr/bin",
    });
    // 범위 뒤에 와도 마찬가지고, 구분자였던 공백은 검색어에 남지 않는다
    expect(parseSearchQuery("@web1 /var/log/nginx")).toEqual({
      scope: { kind: "terminal", name: "web1" },
      block: null,
      options: NONE,
      text: "/var/log/nginx",
    });
  });
});

describe("parseSearchQuery · 검색어와 이스케이프", () => {
  it("빈 질의는 아무것도 아니다", () => {
    expect(parseSearchQuery("")).toEqual({ scope: null, block: null, options: NONE, text: "" });
  });

  it("토큰은 **맨 앞에서만** 알아본다 — `foo @bar` 는 검색어 전체다", () => {
    expect(parseSearchQuery("foo @bar")).toEqual({
      scope: null,
      block: null,
      options: NONE,
      text: "foo @bar",
    });
    expect(parseSearchQuery("grep /re x")).toEqual({
      scope: null,
      block: null,
      options: NONE,
      text: "grep /re x",
    });
  });

  it("앞 공백으로 이스케이프 — 나머지 전부가 문자 그대로다 (따옴표도 글자로 남는다)", () => {
    expect(parseSearchQuery("  @web1 /re")).toEqual({
      scope: null,
      block: null,
      options: NONE,
      text: "@web1 /re",
    });
    expect(parseSearchQuery(' "foo"')).toEqual({
      scope: null,
      block: null,
      options: NONE,
      text: '"foo"',
    });
  });

  it("따옴표로 이스케이프 — 바깥 한 겹만 벗긴다", () => {
    expect(parseSearchQuery('"@foo"')).toEqual({
      scope: null,
      block: null,
      options: NONE,
      text: "@foo",
    });
    // 토큰들을 먹고 남은 나머지에도 그대로 적용된다
    expect(parseSearchQuery('@web1 "/re"')).toEqual({
      scope: { kind: "terminal", name: "web1" },
      block: null,
      options: NONE,
      text: "/re",
    });
  });

  it("검색어 안쪽의 공백은 그대로 산다 (앞 구분자만 버린다)", () => {
    expect(parseSearchQuery("@a   foo  bar").text).toBe("foo  bar");
  });
});

/** 파서를 거치지 않고 질의 값을 바로 만든다 (`buildMatcher` 규칙만 보려고) */
function q(text: string, options: Partial<SearchQuery["options"]> = {}): SearchQuery {
  return { scope: null, block: null, options: { ...NONE, ...options }, text };
}

describe("buildMatcher", () => {
  it("검색어가 비었으면 `null` — 오류가 아니라 '아직 찾을 것이 없다'", () => {
    expect(buildMatcher(q(""))).toBeNull();
  });

  it("`/re` 가 아니면 정규식 메타문자를 **문자 그대로** 만든다", () => {
    const re = buildMatcher(q("a.c"));
    expect(re).not.toBeNull();
    expect(re!.test("a.c")).toBe(true);
    re!.lastIndex = 0;
    expect(re!.test("abc")).toBe(false); // 이스케이프가 안 됐다면 맞았을 자리
  });

  it("기본은 대소문자 무시, `/case` 면 구분한다", () => {
    expect(matchesInLine("Error error", buildMatcher(q("error"))!)).toHaveLength(2);
    expect(matchesInLine("Error error", buildMatcher(q("error", { caseSensitive: true }))!)).toEqual([
      { col: 6, len: 5 },
    ]);
  });

  it("`/word` 는 `\\b…\\b` 로 감싼다", () => {
    const re = buildMatcher(q("cat", { wholeWord: true }))!;
    expect(matchesInLine("cat concat cat.", re)).toEqual([
      { col: 0, len: 3 },
      { col: 11, len: 3 },
    ]);
  });

  it("`/re` + `/word` 는 non-capturing group 으로 감싼다 — `foo|bar` 가 갈리지 않게", () => {
    const re = buildMatcher(q("foo|bar", { regex: true, wholeWord: true }))!;
    expect(matchesInLine("foo bartender bar", re)).toEqual([
      { col: 0, len: 3 },
      { col: 14, len: 3 },
    ]);
  });

  it("잘못된 정규식은 예외를 삼키고 `null` (반쯤 친 질의가 매 키마다 터지지 않게)", () => {
    expect(buildMatcher(q("(foo", { regex: true }))).toBeNull();
    // `/re` 가 아니면 같은 글자도 그냥 찾는 글자다
    expect(buildMatcher(q("(foo"))).not.toBeNull();
  });

  it("플래그는 언제나 `g` 다", () => {
    expect(buildMatcher(q("x"))!.flags).toBe("gi");
    expect(buildMatcher(q("x", { caseSensitive: true }))!.flags).toBe("g");
  });
});

describe("buildBlockMatcher", () => {
  /** `#` 의 항만 있는 질의 (블록 축) */
  function b(block: string | null, options: Partial<SearchQuery["options"]> = {}): SearchQuery {
    return { scope: null, block, options: { ...NONE, ...options }, text: "" };
  }

  it("`#` 가 없으면 `null`", () => {
    expect(buildBlockMatcher(b(null))).toBeNull();
  });

  it("`#` 하나(빈 항)도 `null` — '거르지 않는다' 는 뜻이다 (부르는 쪽이 `block` 값으로 가른다)", () => {
    expect(buildBlockMatcher(b(""))).toBeNull();
  });

  it("옵션은 검색어와 **같은 규칙**으로 걸린다", () => {
    expect(matchesInLine("Build build", buildBlockMatcher(b("build"))!)).toHaveLength(2);
    expect(matchesInLine("Build build", buildBlockMatcher(b("build", { caseSensitive: true }))!)).toEqual([
      { col: 6, len: 5 },
    ]);
    // `/re` 가 아니면 메타문자는 글자다
    expect(matchesInLine("npm run build", buildBlockMatcher(b("run.build"))!)).toEqual([]);
    expect(matchesInLine("npm run build", buildBlockMatcher(b("run.build", { regex: true }))!)).toEqual([
      { col: 4, len: 9 },
    ]);
  });

  it("깨진 정규식도 `null` (반쯤 친 `#` 항이 매 키마다 터지지 않게)", () => {
    expect(buildBlockMatcher(b("(foo", { regex: true }))).toBeNull();
  });
});

describe("matchesInLine", () => {
  it("한 줄의 매치 위치들 (col 은 0-기반)", () => {
    expect(matchesInLine("abcabc", /abc/g)).toEqual([
      { col: 0, len: 3 },
      { col: 3, len: 3 },
    ]);
    expect(matchesInLine("nope", /abc/g)).toEqual([]);
  });

  it("**빈 매치**에도 무한루프에 빠지지 않는다 (lastIndex 가 안 나가면 +1)", () => {
    const re = /x*/g;
    expect(matchesInLine("ab", re)).toEqual([
      { col: 0, len: 0 },
      { col: 1, len: 0 },
      { col: 2, len: 0 },
    ]);
  });

  it("`g` 없는 정규식은 첫 매치 하나로 끝낸다 (lastIndex 가 움직이지 않는다)", () => {
    expect(matchesInLine("abcabc", /abc/)).toEqual([{ col: 0, len: 3 }]);
  });

  it("`lastIndex` 를 되돌려 재사용해도 결과가 같다 — 수천 줄에 같은 RegExp 를 쓴다", () => {
    const re = buildMatcher(q("a"))!;
    re.lastIndex = 4; // 앞선 호출이 남긴 찌꺼기
    expect(matchesInLine("aa", re)).toEqual([
      { col: 0, len: 1 },
      { col: 1, len: 1 },
    ]);
    expect(re.lastIndex).toBe(0);
    expect(matchesInLine("aa", re)).toHaveLength(2);
  });
});
