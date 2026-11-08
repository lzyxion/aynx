import { describe, expect, it } from "vitest";
import {
  applyAutocomplete,
  backspaceAtStart,
  composeQuery,
  dropChip,
  tokenizeOnSpace,
  type ChipState,
} from "$lib/search-chips";
import { parseSearchQuery } from "$lib/search-query";

// 칩은 **표현 계층**이다 — 문법의 진실은 `search-query.ts` 하나뿐이고, 여기서 하는 일은
// "칩들 + 글자" 를 그 파서가 먹는 한 줄로 되돌리는 것뿐이다 (마지막 describe 가 그것을 잰다).

/** 세 칸짜리 상태를 짧게 적는다 (안 준 칸은 비어 있다) */
function st(p: Partial<ChipState> = {}): ChipState {
  return { scopeChip: null, blockChip: null, text: "", ...p };
}

describe("tokenizeOnSpace", () => {
  it("`@이름 ` 은 공백을 치는 순간 칩이 된다 — 뒤에 남은 것이 검색어다", () => {
    expect(tokenizeOnSpace("@web1 ")).toEqual({ kind: "scope", chip: "web1", rest: "" });
    expect(tokenizeOnSpace("@web1 error")).toEqual({ kind: "scope", chip: "web1", rest: "error" });
    // 구분자 공백은 전부 걷는다 — 파서도 토큰 뒤 공백을 먹으므로 그래야 파스가 같다
    expect(tokenizeOnSpace("@web1   foo  bar")).toEqual({
      kind: "scope",
      chip: "web1",
      rest: "foo  bar",
    });
  });

  it("`#명령 ` 도 칩이 된다 — **다른 종류**로 (블록 축)", () => {
    expect(tokenizeOnSpace("#build ")).toEqual({ kind: "block", chip: "build", rest: "" });
    expect(tokenizeOnSpace("#build 실패")).toEqual({ kind: "block", chip: "build", rest: "실패" });
    expect(tokenizeOnSpace('#"make all" x')).toEqual({
      kind: "block",
      chip: "make all",
      rest: "x",
    });
  });

  it("따옴표 이름은 닫는 따옴표까지 — 안쪽 공백이 이름에 남는다", () => {
    expect(tokenizeOnSpace('@"my term" err')).toEqual({
      kind: "scope",
      chip: "my term",
      rest: "err",
    });
    // 아직 닫히지 않았으면 치는 중이다 (자동완성이 그 조각으로 후보를 좁힌다)
    expect(tokenizeOnSpace('@"my te')).toBeNull();
  });

  it("이름 뒤에 **공백이 실제로 있어야** 칩이다 — 없으면 아직 치는 중", () => {
    expect(tokenizeOnSpace("@web1")).toBeNull();
    expect(tokenizeOnSpace("@")).toBeNull();
    expect(tokenizeOnSpace("#build")).toBeNull();
  });

  it("빈 이름은 칩이 아니다 — `@ ` 는 드롭다운의 상태이고 `# ` 은 '블록 전부' 라는 질의다", () => {
    expect(tokenizeOnSpace("@ ")).toBeNull();
    expect(tokenizeOnSpace("# ")).toBeNull();
    expect(parseSearchQuery("# ").block).toBe(""); // 글자로 남아도 파서에는 유효하다
  });

  it("맨 앞이 아니면 칩이 아니다 — `foo @bar ` 는 파서에게도 그냥 검색어다", () => {
    expect(tokenizeOnSpace("foo @bar ")).toBeNull();
    expect(tokenizeOnSpace(" @bar ")).toBeNull(); // 앞 공백 = 문자 그대로 이스케이프
    expect(tokenizeOnSpace("/re @bar ")).toBeNull();
  });
});

describe("composeQuery", () => {
  it("칩이 없으면 글자 그대로 — 맨 앞 공백 이스케이프가 살아 있어야 한다", () => {
    expect(composeQuery(st({ text: " @foo" }))).toBe(" @foo");
    expect(composeQuery(st())).toBe("");
  });

  it("이름에 공백이 있으면 따옴표로 감싼다 (파서의 따옴표 규칙)", () => {
    expect(composeQuery(st({ scopeChip: "web1", text: "err" }))).toBe("@web1 err");
    expect(composeQuery(st({ scopeChip: "my term", text: "err" }))).toBe('@"my term" err');
    expect(composeQuery(st({ scopeChip: "bash/2" }))).toBe("@bash/2 ");
  });

  it("`#` 칩은 `@` **다음**에 온다 — 화면 순서와 합성 순서가 늘 같다", () => {
    expect(composeQuery(st({ blockChip: "build", text: "실패" }))).toBe("#build 실패");
    expect(composeQuery(st({ scopeChip: "web1", blockChip: "build" }))).toBe("@web1 #build ");
    expect(composeQuery(st({ blockChip: "make all" }))).toBe('#"make all" ');
  });
});

describe("backspaceAtStart · dropChip", () => {
  it("칩만 떨어뜨리고 글자는 그대로 둔다 (검색이 넓어진다)", () => {
    expect(backspaceAtStart(st({ scopeChip: "web1", text: "err" }))).toEqual(st({ text: "err" }));
  });

  it("둘 다 서 있으면 **캐럿에 가까운 `#`** 부터 지운다", () => {
    const both = st({ scopeChip: "web1", blockChip: "build", text: "err" });
    const once = backspaceAtStart(both);
    expect(once).toEqual(st({ scopeChip: "web1", text: "err" }));
    expect(backspaceAtStart(once)).toEqual(st({ text: "err" }));
  });

  it("칩이 없으면 아무 일도 아니다", () => {
    expect(backspaceAtStart(st({ text: "err" }))).toEqual(st({ text: "err" }));
  });

  it("`dropChip` 은 **고른 칩**만 뗀다 (× 버튼)", () => {
    const both = st({ scopeChip: "web1", blockChip: "build" });
    expect(dropChip(both, "scope")).toEqual(st({ blockChip: "build" }));
    expect(dropChip(both, "block")).toEqual(st({ scopeChip: "web1" }));
  });
});

describe("applyAutocomplete", () => {
  it("치던 `@조각` 을 걷고 칩을 세운다", () => {
    expect(applyAutocomplete(st({ text: "@we" }), "web1")).toEqual(st({ scopeChip: "web1" }));
    expect(applyAutocomplete(st({ text: '@"my te' }), "my term")).toEqual(
      st({ scopeChip: "my term" }),
    );
  });

  it("앞에 친 옵션 토큰은 남긴다 (뒤 공백까지 — 검색어를 이어 칠 자리다)", () => {
    expect(applyAutocomplete(st({ text: "/re @we" }), "web1")).toEqual(
      st({ scopeChip: "web1", text: "/re " }),
    );
  });

  it("**`#` 칩은 건드리지 않는다** — 다른 축이다", () => {
    expect(applyAutocomplete(st({ blockChip: "build", text: "@we" }), "web1")).toEqual(
      st({ scopeChip: "web1", blockChip: "build" }),
    );
  });

  it("걷을 조각이 없으면 칩만 갈아 끼운다 (칩을 눌러 연 드롭다운)", () => {
    expect(applyAutocomplete(st({ scopeChip: "web1", text: "error" }), "db")).toEqual(
      st({ scopeChip: "db", text: "error" }),
    );
    // 검색어 한복판의 `@` 는 조각이 아니다 — 파서도 그것을 범위로 보지 않는다
    expect(applyAutocomplete(st({ text: "foo @bar" }), "web1")).toEqual(
      st({ scopeChip: "web1", text: "foo @bar" }),
    );
  });
});

describe("칩 + 글자 = 원래 한 줄 (파서가 같은 값을 낸다)", () => {
  /** 한 줄을 칩으로 (여러 번) 떼었다가 다시 합치면 **파스가 같아야** 한다 */
  function roundTrip(raw: string): void {
    let state = st({ text: raw });
    for (;;) {
      const tok = tokenizeOnSpace(state.text);
      if (!tok) break;
      state =
        tok.kind === "scope"
          ? { ...state, scopeChip: tok.chip, text: tok.rest }
          : { ...state, blockChip: tok.chip, text: tok.rest };
    }
    expect(parseSearchQuery(composeQuery(state))).toEqual(parseSearchQuery(raw));
  }

  it("범위 + 검색어", () => {
    roundTrip("@web1 error");
    roundTrip("@bash/2 npm run build");
    roundTrip("@a   foo  bar"); // 구분자 공백을 걷어도 검색어 안쪽 공백은 남는다
  });

  it("`#` 축도 같다 — `@` 와 섞이고 순서가 뒤집혀도", () => {
    roundTrip("#build 실패");
    roundTrip("@web1 #build");
    roundTrip('#"make all" @web1 오류');
  });

  it("따옴표 이름 · 옵션이 섞여도 같다", () => {
    roundTrip('@"my term" /case /re Err');
    roundTrip('@web1 "/re"'); // 따옴표 이스케이프가 검색어 쪽에 남는 경우
  });

  it("칩이 없는 상태도 글자 그대로 지나간다 (이스케이프가 안 깨진다)", () => {
    for (const raw of [" @web1 /re", '"@foo"', "/usr/bin", "foo @bar", "#", " #build"]) {
      expect(parseSearchQuery(composeQuery(st({ text: raw })))).toEqual(parseSearchQuery(raw));
    }
  });

  it("자동완성으로 세운 칩도 같은 한 줄이 된다", () => {
    const next = applyAutocomplete(st({ text: "/re @we" }), "my term");
    expect(composeQuery(next)).toBe('@"my term" /re ');
    expect(parseSearchQuery('@"my term" /re ')).toEqual({
      scope: { kind: "terminal", name: "my term" },
      block: null,
      options: { regex: true, caseSensitive: false, wholeWord: false },
      text: "",
    });
  });
});
