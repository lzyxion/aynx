/**
 * **호스트를 지우면 그 별칭을 적어 둔 자리도 함께 치운다** — 규칙만 담은 순수 모듈
 * (docs/log/2026-09-17-host-remove-fanout.md).
 *
 * 이름 변경 팬아웃(`app/host-rename.ts`)의 짝이다. 그쪽은 **가리키는 말이 갈린 것**이라
 * 글자를 따라 고쳤고, 이쪽은 **가리키던 것이 사라진 것**이라 줄을 뺀다.
 *
 * 여기 있는 것은 목록 규칙 둘뿐이다 — **몇 줄이 걸리는가**([`countAliased`])와 **그 줄을 뺀
 * 목록**([`withoutAliased`]). 즐겨찾기·스니펫은 담는 모양이 서로 다르므로(`Favorite` 의
 * `alias` · `Snippet` 의 `scope.alias`) 목록 종류를 알지 않고 **별칭을 꺼내는 함수**를 받는다.
 * 워크스페이스 저장 트리 규칙은 `workspaces/hosts.ts`, 전체 창 팬아웃은 `app/workspace-hosts.ts`에 있다.
 *
 * ## 왜 순수 모듈인가
 *
 * 이 저장소의 vitest 는 `environment: "node"` 라 `.svelte.ts` 를 들여올 수 없다
 * (docs/log/2026-09-05-vitest.md). 그래서 **규칙**(이 파일)과 **상태·저장**(각 스토어)과
 * **배선**(`app/host-remove.ts`)을 나눈다 — `favorites.ts` ↔ `favorites.svelte.ts` 와 같은 모양.
 */

/**
 * 별칭 비교 열쇠 — **대소문자·앞뒤 공백을 무시한다.**
 *
 * 별칭 비교의 기준이 저장소 전체에서 그렇다 (`usesHostAlias` · `nextCopyAlias` ·
 * 이름 변경 판정). 빈 글자는 아무것도 가리키지 않으므로 열쇠가 되지 않는다.
 */
export function aliasKey(alias: string): string {
  return alias.trim().toLowerCase();
}

/** 지울 별칭들 → 비교 열쇠 집합 (빈 글자는 빠진다) */
export function aliasKeySet(aliases: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const alias of aliases) {
    const key = aliasKey(alias);
    if (key !== "") keys.add(key);
  }
  return keys;
}

/**
 * 항목에서 **가리키는 별칭**을 꺼내는 함수. 그 항목이 호스트를 가리키지 않으면 `null`
 * (즐겨찾기의 `kind:"layout"` 칸 · 스니펫의 `{kind:"all"}` 범위).
 */
export type AliasOf<T> = (item: T) => string | null | undefined;

/** 이 별칭들을 가리키는 항목의 수 — 확인 문구가 "몇 줄이 걸리는가" 를 말하는 데 쓴다 */
export function countAliased<T>(
  list: readonly T[],
  aliasOf: AliasOf<T>,
  keys: ReadonlySet<string>,
): number {
  if (keys.size === 0) return 0;
  let n = 0;
  for (const item of list) {
    const alias = aliasOf(item);
    if (typeof alias === "string" && keys.has(aliasKey(alias))) n += 1;
  }
  return n;
}

/**
 * 이 별칭들을 가리키는 항목을 **뺀** 새 목록. 뺄 것이 없으면 **같은 배열을 그대로** 돌려준다
 * — 호출부가 `===` 로 "바뀐 게 없다" 를 알아 파일 쓰기를 통째로 건너뛴다
 * (`withoutFavorite`·`withRenamedHostScope` 와 같은 계약).
 */
export function withoutAliased<T>(
  list: readonly T[],
  aliasOf: AliasOf<T>,
  keys: ReadonlySet<string>,
): readonly T[] {
  if (keys.size === 0) return list;
  const next = list.filter((item) => {
    const alias = aliasOf(item);
    return !(typeof alias === "string" && keys.has(aliasKey(alias)));
  });
  return next.length === list.length ? list : next;
}

/**
 * 열쇠들 중 **이 표에 있는** 것의 수 — 목록이 아니라 **별칭이 곧 키인 표**로 사는 자리용
 * (AI 위임: `app/delegation.svelte.ts` 의 `별칭 → 권한` 맵).
 *
 * [`countAliased`] 와 짝이지만 반대 방향이다: 저쪽은 항목마다 별칭을 꺼내 비교하고, 이쪽은
 * 열쇠로 곧장 찾는다. 표의 키가 **이미 정규화된 별칭**(소문자)이라는 것이 전제이고, 그
 * 규칙은 표를 만드는 자리가 [`aliasKey`] 와 같은 글자로 지킨다.
 */
export function countInMap(
  keys: ReadonlySet<string>,
  map: ReadonlyMap<string, unknown>,
): number {
  let n = 0;
  for (const key of keys) if (map.has(key)) n += 1;
  return n;
}
