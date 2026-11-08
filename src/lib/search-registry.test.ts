import { describe, expect, it, vi } from "vitest";
import {
  HITS_PER_TERMINAL,
  HITS_TOTAL,
  disambiguateNames,
  headerTabTitle,
  registerSearch,
  scanBlockTargets,
  scanTargets,
  searchAll,
  searchTarget,
  searchTargets,
  stepKept,
} from "$lib/search-registry";
import type { BlockLike, SearchHit, SearchTarget } from "$lib/search-registry";

/**
 * 검색 창구 레지스트리. 집계([`scanTargets`])는 xterm 을 모르는 순수 함수라 **가짜 대상**으로
 * 전부 확인한다 — 이 파일이 `Terminal.svelte` 를 임포트하지 않는 것이 그 값어치의 전부다.
 */

/**
 * `n` 개의 가짜 매치를 내놓는 대상. `scan` 은 진짜와 똑같이 `limit` 까지만 준다.
 *
 * 탭 id 는 **일부러 없다** — 창구는 패널만 알고, 그 패널이 어느 탭에
 * 있는지는 소비자가 그때그때 푼다 (`search-registry.ts` 의 `SearchTarget` 머리말).
 */
function fake(paneId: string, name: string, n: number): SearchTarget {
  return {
    paneId,
    name: () => name,
    scan: (_re, limit) =>
      Array.from({ length: Math.min(n, limit) }, (_, i): SearchHit => ({
        line: i,
        text: `${paneId}:${i}`,
        col: 0,
        len: 1,
      })),
    highlight: () => n,
    position: () => ({ index: n === 0 ? 0 : 1, count: n }),
    next: () => {},
    prev: () => {},
    clear: () => {},
    reveal: () => {},
    keep: () => {},
  };
}

const RE = /x/g;

describe("registerSearch · searchTargets · searchTarget", () => {
  it("등록하면 찾아지고, 해제하면 사라진다", () => {
    const t = fake("pane-1", "pwsh", 0);
    const off = registerSearch(t);
    expect(searchTarget("pane-1")).toBe(t);
    expect(searchTargets()).toContain(t);
    off();
    expect(searchTarget("pane-1")).toBeUndefined();
    expect(searchTargets()).not.toContain(t);
  });

  it("등록이 없으면 `undefined` (이미 닫힌 타일)", () => {
    expect(searchTarget("없는패널")).toBeUndefined();
  });

  it("해제는 **내가 넣은 그 대상일 때만** 지운다 — 늦게 도는 정리가 새 등록을 죽이지 않게", () => {
    const oldT = fake("pane-2", "old", 0);
    const newT = fake("pane-2", "new", 0);
    const offOld = registerSearch(oldT);
    const offNew = registerSearch(newT); // 새 인스턴스가 먼저 등록했다
    offOld(); // 옛 인스턴스의 정리가 늦게 돈다
    expect(searchTarget("pane-2")).toBe(newT);
    offNew();
    expect(searchTarget("pane-2")).toBeUndefined();
  });

  it("`searchAll` 은 등록된 전부를 훑는다 (= scanTargets(searchTargets(), re))", () => {
    const offs = [registerSearch(fake("p1", "a", 2)), registerSearch(fake("p2", "b", 0))];
    const r = searchAll(RE);
    expect(r.groups.map((g) => g.paneId)).toEqual(["p1"]); // 0 매치는 빠진다
    expect(r.total).toBe(2);
    for (const off of offs) off();
    expect(searchAll(RE).groups).toEqual([]);
  });
});

describe("disambiguateNames", () => {
  it("빈 배열은 빈 배열", () => {
    expect(disambiguateNames([])).toEqual([]);
  });

  it("중복이 없으면 이름 그대로 (군더더기 번호를 붙이지 않는다)", () => {
    expect(disambiguateNames(["web1", "db", "pwsh"])).toEqual(["web1", "db", "pwsh"]);
  });

  it("셋 이상 겹치면 등록 순서로 `/2`·`/3` — 먼저 있던 것의 이름은 안 바뀐다", () => {
    expect(disambiguateNames(["pwsh", "web1", "pwsh", "pwsh", "web1"])).toEqual([
      "pwsh",
      "web1",
      "pwsh/2",
      "pwsh/3",
      "web1/2",
    ]);
  });
});

describe("scanTargets", () => {
  it("터미널별로 묶고, 라벨은 충돌 구분을 거친 이름이다", () => {
    const r = scanTargets([fake("p1", "pwsh", 2), fake("p2", "pwsh", 1)], RE);
    expect(r.groups.map((g) => [g.paneId, g.label])).toEqual([
      ["p1", "pwsh"],
      ["p2", "pwsh/2"],
    ]);
    expect(r.total).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it("**매치가 0 인 터미널은 빠진다** — 그래도 라벨 번호는 그 자리를 지킨다", () => {
    // 가운데 `pwsh` 가 0 매치라 목록에서는 빠지지만, 세 번째는 여전히 `pwsh/3` 이다
    const r = scanTargets([fake("p1", "pwsh", 1), fake("p2", "pwsh", 0), fake("p3", "pwsh", 1)], RE);
    expect(r.groups.map((g) => [g.paneId, g.label])).toEqual([
      ["p1", "pwsh"],
      ["p3", "pwsh/3"],
    ]);
  });

  it("상한 상수는 200 · 2000 이다", () => {
    expect(HITS_PER_TERMINAL).toBe(200);
    expect(HITS_TOTAL).toBe(2000);
  });

  it("터미널당 상한을 **넘으면** 그 그룹이 truncated (딱 채운 것과는 가른다)", () => {
    const over = scanTargets([fake("p1", "a", HITS_PER_TERMINAL + 5)], RE);
    expect(over.groups[0].hits).toHaveLength(HITS_PER_TERMINAL);
    expect(over.groups[0].truncated).toBe(true);
    expect(over.total).toBe(HITS_PER_TERMINAL);
    expect(over.truncated).toBe(false); // 전체 상한에는 아직 멀었다

    const exact = scanTargets([fake("p2", "b", HITS_PER_TERMINAL)], RE);
    expect(exact.groups[0].hits).toHaveLength(HITS_PER_TERMINAL);
    expect(exact.groups[0].truncated).toBe(false);
  });

  it("전체 상한에 닿으면 멈추고, **남은 대상은 훑지도 않는다**", () => {
    const many = Array.from({ length: 12 }, (_, i) => fake(`p${i}`, `t${i}`, HITS_PER_TERMINAL));
    // 뒤쪽 대상이 실제로 안 불리는지 보려고 마지막 하나만 감시한다
    const spied = fake("last", "last", 5);
    const scan = vi.spyOn(spied, "scan");
    const r = scanTargets([...many, spied], RE);

    expect(r.total).toBe(HITS_TOTAL); // 200 × 10
    expect(r.truncated).toBe(true);
    expect(r.groups).toHaveLength(HITS_TOTAL / HITS_PER_TERMINAL);
    expect(scan).not.toHaveBeenCalled();
  });

  it("마지막 그룹이 전체 상한에 걸리면 그 그룹만 잘라 담는다", () => {
    const nine = Array.from({ length: 9 }, (_, i) => fake(`p${i}`, `t${i}`, HITS_PER_TERMINAL));
    const r = scanTargets([...nine, fake("tail", "tail", HITS_PER_TERMINAL)], RE);
    // 9 × 200 = 1800 → 마지막은 200 중 200 이 들어가 딱 2000 이다 (자리가 남아 안 잘린다)
    expect(r.total).toBe(HITS_TOTAL);
    expect(r.groups.at(-1)!.truncated).toBe(false);

    const r2 = scanTargets(
      [...Array.from({ length: 9 }, (_, i) => fake(`q${i}`, `u${i}`, HITS_PER_TERMINAL)), fake("tail", "tail", 150)],
      RE,
    );
    expect(r2.total).toBe(1950);
    expect(r2.truncated).toBe(false);

    const nineHalf = Array.from({ length: 9 }, (_, i) => fake(`r${i}`, `v${i}`, HITS_PER_TERMINAL));
    const r3 = scanTargets([...nineHalf, fake("cut", "cut", 150), fake("cut2", "cut2", 150)], RE);
    expect(r3.total).toBe(HITS_TOTAL); // 1800 + 150 + 50
    expect(r3.truncated).toBe(true);
    expect(r3.groups.at(-1)!.hits).toHaveLength(50);
    expect(r3.groups.at(-1)!.truncated).toBe(true);
  });

  it("대상이 없으면 빈 결과", () => {
    expect(scanTargets([], RE)).toEqual({ groups: [], total: 0, truncated: false });
  });
});

/**
 * `#` 블록 검색 (docs/log/2026-09-08-block-search.md).
 *
 * 저장소도 인자라 가짜 블록으로 전부 확인한다 — 이 파일은 `block-history.ts` 조차 임포트하지
 * 않는다(머리말의 "임포트가 하나도 없다"). 규칙 셋을 잰다: 무엇에 맞추는가(명령줄 + cwd) ·
 * 검색어가 더 있으면 무엇을 거르는가(출력 발췌) · 순서와 상한.
 */
describe("scanBlockTargets", () => {
  let seq = 0;

  /** 블록 하나 — 시작 시각은 부른 순서대로 올라간다(최신이 큰 값) */
  function block(commandLine: string, p: Partial<BlockLike> = {}): BlockLike {
    seq += 1;
    return {
      id: seq,
      commandLine,
      cwd: null,
      startedAt: seq * 1000,
      exit: 0,
      running: false,
      excerpt: { head: [], tail: [] },
      ...p,
    };
  }

  /** 타일 → 블록들 (오래된 것부터) */
  function store(map: Record<string, BlockLike[]>) {
    return (paneId: string): readonly BlockLike[] => map[paneId] ?? [];
  }

  const re = (src: string) => new RegExp(src, "gi");

  it("`#` 의 항이 **명령줄**에 맞는 블록만 — 최신이 위다", () => {
    const t = fake("p1", "web1", 0);
    const blocks = { p1: [block("npm run build"), block("ls"), block("npm run build -- --watch")] };
    const r = scanBlockTargets([t], store(blocks), re("build"), null);
    expect(r.hits.map((h) => h.commandLine)).toEqual(["npm run build -- --watch", "npm run build"]);
    expect(r.hits[0].label).toBe("web1");
    expect(r.total).toBe(2);
    expect(r.truncated).toBe(false);
  });

  it("**cwd 도 부차적으로** 맞춰 본다 (그 폴더에서 돌린 명령을 찾는 몸짓)", () => {
    const t = fake("p1", "web1", 0);
    const blocks = { p1: [block("ls", { cwd: "/srv/app" }), block("ls", { cwd: "/tmp" })] };
    const r = scanBlockTargets([t], store(blocks), re("srv"), null);
    expect(r.hits.map((h) => h.cwd)).toEqual(["/srv/app"]);
  });

  it("항이 비면(= `#` 하나) **전부**다 — 여러 타일을 가로질러 시각 내림차순으로 섞인다", () => {
    const a = fake("p1", "a", 0);
    const b = fake("p2", "b", 0);
    const first = block("a1");
    const second = block("b1");
    const third = block("a2");
    const r = scanBlockTargets([a, b], store({ p1: [first, third], p2: [second] }), null, null);
    expect(r.hits.map((h) => h.commandLine)).toEqual(["a2", "b1", "a1"]);
    expect(r.hits.map((h) => h.label)).toEqual(["a", "b", "a"]);
  });

  it("검색어가 더 있으면 고른 블록의 **출력 발췌**로 다시 거른다 (`#build 실패`)", () => {
    const t = fake("p1", "web1", 0);
    const ok = block("npm run build", { excerpt: { head: ["시작"], tail: ["done"] } });
    const bad = block("npm run build", { excerpt: { head: ["시작"], tail: ["실패했습니다"] } });
    const r = scanBlockTargets([t], store({ p1: [ok, bad] }), re("build"), re("실패"));
    expect(r.hits.map((h) => h.blockId)).toEqual([bad.id]);
    // 발췌는 머리도 본다 (머리 + 꼬리 한 덩어리)
    expect(scanBlockTargets([t], store({ p1: [ok, bad] }), re("build"), re("시작")).total).toBe(2);
  });

  it("실행 중인 블록도 그대로 나온다 (`running` 이 줄에 실린다)", () => {
    const t = fake("p1", "web1", 0);
    const live = block("tail -f log", { running: true, exit: null });
    const r = scanBlockTargets([t], store({ p1: [live] }), null, null);
    expect(r.hits[0]).toMatchObject({ running: true, exit: null, paneId: "p1" });
  });

  it("타일당 상한을 넘으면 **오래된 쪽이 잘리고** 결과가 truncated 다", () => {
    const t = fake("p1", "a", 0);
    const many = Array.from({ length: HITS_PER_TERMINAL + 3 }, (_, i) => block(`cmd${i}`));
    const r = scanBlockTargets([t], store({ p1: many }), null, null);
    expect(r.total).toBe(HITS_PER_TERMINAL);
    expect(r.truncated).toBe(true);
    expect(r.hits.at(-1)!.commandLine).toBe(`cmd${many.length - HITS_PER_TERMINAL}`);
  });

  it("전체 상한에서도 자른다", () => {
    const targets = Array.from({ length: 12 }, (_, i) => fake(`p${i}`, `t${i}`, 0));
    const map: Record<string, BlockLike[]> = {};
    for (let i = 0; i < 12; i++) {
      map[`p${i}`] = Array.from({ length: HITS_PER_TERMINAL }, () => block("x"));
    }
    const r = scanBlockTargets(targets, store(map), null, null);
    expect(r.total).toBe(HITS_TOTAL);
    expect(r.truncated).toBe(true);
  });

  it("대상이 없거나 이력이 비면 빈 결과", () => {
    expect(scanBlockTargets([], store({}), null, null)).toEqual({
      hits: [],
      total: 0,
      truncated: false,
    });
    expect(scanBlockTargets([fake("p1", "a", 0)], store({}), re("x"), null).total).toBe(0);
  });
});

/**
 * 점프가 남긴 강조의 수명. 규칙이 순수 함수라 **타이머도 xterm 도 없이** 전이표를 그대로 왕복한다
 * — 실제 버그는 "Esc 를 눌러도 타이핑을 해도 강조가 안 지워진다" 였고, 그것을 재현하는 자리가
 * 여기다 (`clear` 는 돌려주는 값이지 부수효과가 아니므로 호출자 없이 확인된다).
 */
describe("stepKept", () => {
  it("남긴 강조는 **키 입력**에 사라진다 (호출자에게 지우라고 말한다)", () => {
    expect(stepKept("kept", "input")).toEqual({ state: "idle", clear: true });
  });

  it("남긴 강조는 **포커스 이탈**에도 사라진다 (다른 타일 · 탭 전환)", () => {
    expect(stepKept("kept", "blur")).toEqual({ state: "idle", clear: true });
  });

  it("`clear` 는 **통보라 다시 지우지 않는다** — 방금 새로 칠한 강조를 스스로 걷지 않게", () => {
    expect(stepKept("kept", "clear")).toEqual({ state: "idle", clear: false });
  });

  it("`idle` 에서는 무엇이 와도 아무 일도 없다 (마운트 때 도는 `blur` 가 무해한 이유)", () => {
    for (const ev of ["input", "blur", "clear"] as const) {
      expect(stepKept("idle", ev)).toEqual({ state: "idle", clear: false });
    }
  });

  it("`keep` 만이 `kept` 로 들어가는 문이다 — 다시 와도 그대로 `kept`", () => {
    expect(stepKept("idle", "keep")).toEqual({ state: "kept", clear: false });
    expect(stepKept("kept", "keep")).toEqual({ state: "kept", clear: false });
  });

  it("점프 → 타이핑 한 왕복 (실제로 났던 버그의 순서 그대로)", () => {
    const afterJump = stepKept("idle", "keep");
    expect(afterJump.state).toBe("kept");
    const afterTyping = stepKept(afterJump.state, "input");
    expect(afterTyping).toEqual({ state: "idle", clear: true }); // 여기서 강조가 걷힌다
    // 그 뒤로는 아무리 쳐도 지울 것이 없다 (오버레이가 새로 칠한 강조를 건드리지 않는다)
    expect(stepKept(afterTyping.state, "input")).toEqual({ state: "idle", clear: false });
  });
});

/**
 * 그룹 머리글의 탭 제목. 탭 **자동 제목이 타일 이름들을 이어 붙인 것**이라
 * 그대로 붙이면 `로컬 · 로컬 · 4개` 로 같은 낱말이 두 번 나왔다 — 그 중복을 거르는 규칙이다.
 */
describe("headerTabTitle", () => {
  it("탭이 **하나뿐이면** 붙이지 않는다 — 갈 곳이 하나인데 어디로 가는지 말할 이유가 없다", () => {
    expect(headerTabTitle("로컬", "작업", 1)).toBe("");
    expect(headerTabTitle("로컬", "작업", 0)).toBe("");
  });

  it("둘 이상이고 제목이 다르면 그 제목을 붙인다", () => {
    expect(headerTabTitle("web1", "배포", 2)).toBe("배포");
  });

  it("둘 이상이어도 제목이 **타일 이름과 같으면** 생략한다 (원래 버그가 바로 이 경우다)", () => {
    expect(headerTabTitle("로컬", "로컬", 3)).toBe("");
  });

  it("제목이 비어 있으면 생략 (훑은 뒤 어느 탭에도 없는 패널)", () => {
    expect(headerTabTitle("web1", "", 3)).toBe("");
  });
});
