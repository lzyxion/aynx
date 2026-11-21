/**
 * 끌어서 순서 바꾸기 셋(하단 독의 즐겨찾기 칸 · 상태바 선두단 · 탭 스트립)이 같은 계약을 쓴다 — `reorder(list, from, to)` 의 `to` 는
 * "이 키 앞" 이고 `null` 이면 맨 뒤다. 여기는 키보드의 "한 칸" 을 그 `to` 로 옮긴다.
 */

/**
 * 둘러 가지 않는다(no wrap) — 끝에서 반대쪽으로 튀면 사람이 무엇을 눌렀는지 잃는다. `null` 이 곧 메뉴 항목의 비활성 판정이다(판정과
 * 실행이 한 함수라 갈리지 않는다). `Home`/`End` 도 이 함수에 큰 `delta` 를 준다.
 */
export function moveTarget(
  keys: readonly string[],
  key: string,
  delta: number,
): { to: string | null } | null {
  if (!Number.isFinite(delta) || delta === 0) return null;
  const from = keys.indexOf(key);
  if (from < 0) return null;
  const at = Math.min(Math.max(from + delta, 0), keys.length - 1);
  if (at === from) return null;
  const rest = keys.filter((_, i) => i !== from);
  return { to: rest[at] ?? null };
}
