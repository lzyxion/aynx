import { describe, expect, it } from "vitest";
import { aliasKey, aliasKeySet, countAliased, countInMap, withoutAliased } from "$lib/host-remove";
import type { Favorite } from "$lib/favorites";
import type { Snippet } from "$lib/snippets";

/**
 * 호스트 제거 팬아웃의 **목록 규칙** (docs/log/2026-09-17-host-remove-fanout.md).
 *
 * 즐겨찾기와 스니펫은 담는 모양이 다르지만(`alias` 한 칸 · `scope.alias`) 규칙은 하나여야
 * 한다 — 그래서 여기 두 모양을 다 태운다.
 */

const favHost = (alias: string): Favorite => ({ kind: "host", alias });
const favProject = (id: string): Favorite => ({ kind: "project", id });
const favAlias = (f: Favorite) => (f.kind === "host" ? f.alias : null);

const snippet = (id: string, alias?: string): Snippet => ({
  id,
  name: id,
  command: "echo 1",
  scope: alias === undefined ? { kind: "all" } : { kind: "host", alias },
  enter: true,
});
const snippetAlias = (s: Snippet) => (s.scope.kind === "host" ? s.scope.alias : null);

describe("aliasKey · aliasKeySet — 별칭 비교는 대소문자·공백을 무시한다", () => {
  it("앞뒤 공백을 떼고 소문자로 접는다", () => {
    expect(aliasKey("  Web-01 ")).toBe("web-01");
  });

  it("빈 별칭은 아무것도 가리키지 않으므로 집합에 들어가지 않는다", () => {
    const keys = aliasKeySet(["web-01", "  ", "", " WEB-01 "]);
    expect([...keys]).toEqual(["web-01"]);
  });
});

describe("countAliased — 확인 문구가 말하는 숫자", () => {
  it("그 별칭을 가리키는 칸만 센다 (대소문자 무시)", () => {
    const list = [favHost("web-01"), favHost("DB-01"), favProject("L1"), favHost(" WEB-01 ")];
    expect(countAliased(list, favAlias, aliasKeySet(["web-01"]))).toBe(2);
    expect(countAliased(list, favAlias, aliasKeySet(["web-01", "db-01"]))).toBe(3);
  });

  it("빈 집합이면 0 — 한 줄도 훑지 않는다", () => {
    expect(countAliased([favHost("web-01")], favAlias, aliasKeySet(["  "]))).toBe(0);
  });

  it("호스트를 가리키지 않는 항목은 세지 않는다 (`{kind:\"all\"}` 스니펫)", () => {
    const list = [snippet("s1", "web-01"), snippet("s2"), snippet("s3", "db-01")];
    expect(countAliased(list, snippetAlias, aliasKeySet(["web-01"]))).toBe(1);
  });
});

describe("withoutAliased — 그 별칭을 가리키는 줄만 뺀다", () => {
  it("나머지는 순서 그대로 남는다", () => {
    const list = [snippet("s1", "web-01"), snippet("s2"), snippet("s3", "WEB-01"), snippet("s4", "db-01")];
    const next = withoutAliased(list, snippetAlias, aliasKeySet(["web-01"]));
    expect(next.map((s) => s.id)).toEqual(["s2", "s4"]);
  });

  it("여러 별칭을 한 번에 뺀다 (다중 선택 제거)", () => {
    const list = [favHost("web-01"), favProject("L1"), favHost("db-01")];
    const next = withoutAliased(list, favAlias, aliasKeySet(["web-01", "db-01"]));
    expect(next).toEqual([favProject("L1")]);
  });

  it("뺄 것이 없으면 **같은 배열**을 그대로 돌려준다 (파일 쓰기를 건너뛰는 열쇠)", () => {
    const list = [favHost("web-01"), favProject("L1")];
    expect(withoutAliased(list, favAlias, aliasKeySet(["other"]))).toBe(list);
    expect(withoutAliased(list, favAlias, aliasKeySet([]))).toBe(list);
  });
});

describe("countInMap — 별칭이 곧 키인 표(AI 위임)", () => {
  /** `app/delegation.svelte.ts` 가 만드는 표와 **같은 규칙**: 키는 소문자 별칭이다 */
  const table = new Map<string, { connect: boolean }>([
    ["web-01", { connect: true }],
    ["db-01", { connect: false }],
  ]);

  it("열쇠 집합 중 표에 있는 것만 센다", () => {
    expect(countInMap(aliasKeySet(["web-01"]), table)).toBe(1);
    expect(countInMap(aliasKeySet(["web-01", "db-01"]), table)).toBe(2);
    // 권한이 꺼져 있어도 **줄은 있다** — 세는 것은 "치울 줄" 이지 "켜진 권한" 이 아니다.
    expect(countInMap(aliasKeySet(["db-01"]), table)).toBe(1);
  });

  it("대소문자·앞뒤 공백을 무시한다 (`aliasKeySet` 이 이미 접어 준다)", () => {
    expect(countInMap(aliasKeySet(["  WEB-01 "]), table)).toBe(1);
  });

  it("없는 별칭·빈 집합·빈 표는 0", () => {
    expect(countInMap(aliasKeySet(["ghost"]), table)).toBe(0);
    expect(countInMap(aliasKeySet([]), table)).toBe(0);
    expect(countInMap(aliasKeySet(["web-01"]), new Map())).toBe(0);
  });
});
