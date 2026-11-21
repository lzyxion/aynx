/** 호스트를 지우면 그 별칭을 적어 둔 자리도 함께 치우는 목록 규칙 (docs/log/2026-09-17-host-remove-fanout.md) */

/** 대소문자 · 앞뒤 공백을 무시한다 — 저장소 전체의 별칭 비교 기준이다 */
export function aliasKey(alias: string): string {
  return alias.trim().toLowerCase();
}

export function aliasKeySet(aliases: readonly string[]): Set<string> {
  const keys = new Set<string>();
  for (const alias of aliases) {
    const key = aliasKey(alias);
    if (key !== "") keys.add(key);
  }
  return keys;
}

/** 호스트를 가리키지 않는 항목이면 `null` */
export type AliasOf<T> = (item: T) => string | null | undefined;

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

/** 뺄 것이 없으면 같은 배열을 돌려준다 — 호출부가 `===` 로 파일 쓰기를 건너뛴다 */
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

/** 표의 키가 이미 `aliasKey` 로 정규화돼 있어야 한다 */
export function countInMap(
  keys: ReadonlySet<string>,
  map: ReadonlyMap<string, unknown>,
): number {
  let n = 0;
  for (const key of keys) if (map.has(key)) n += 1;
  return n;
}
