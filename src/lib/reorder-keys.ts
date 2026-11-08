/**
 * **한 칸 옮기려면 어디에 놓아야 하는가** — 순서 바꾸기의 *키보드* 길이 쓰는 순수 규칙
 * (docs/log/2026-09-17-keyboard-reorder.md).
 *
 * 이 저장소에는 "끌어서 순서 바꾸기" 가 셋 있고(하단 독의 즐겨찾기 칸 · 상태바 선두단 ·
 * 탭 스트립) 셋이 **같은 계약**을 쓴다 — `reorder(list, from, to)` 의 `to` 는 **"이 키 앞"**
 * 이고 `null` 이면 맨 뒤다 (`favorites.ts` 의 [`reorderFavorites`] · `status-items.ts` 의
 * [`reorder`] · `Tabs.svelte` 의 `dropBefore`/`dropEnd`).
 *
 * 드래그는 커서가 그 `to` 를 **직접** 가리킨다. 키보드에는 커서가 없고 "한 칸 왼쪽" 이라는
 * 말뿐이라, 그 말을 위 계약의 `to` 로 옮기는 산수가 필요하다. 그 산수가 여기 하나에 있다 —
 * 즐겨찾기(칸)와 상태바(글리프)는 목록의 **종류**가 다르므로, 이 모듈은 어느 쪽도 모르는
 * **키 문자열 배열**만 받는다 (`favoriteKey` 이거나 `StatusItem.id` 이거나).
 *
 * ## 왜 순수 모듈인가
 *
 * 이 저장소의 vitest 는 `environment: "node"` 라 `.svelte`·`.svelte.ts` 를 들여올 수 없다
 * (docs/log/2026-09-05-vitest.md). 화면 둘이 나눠 쓰는 규칙이 회귀 테스트를 받을 수 있는
 * 자리는 순수 모듈뿐이다.
 */

/**
 * `key` 를 `delta` 칸 옮기려면 **어느 키 앞**에 놓아야 하는가.
 *
 * · `{ to }` — 그 키 **앞**에 놓는다 (`to === null` 이면 맨 뒤).
 * · `null` — 옮길 자리가 없다 (모르는 키 · 이미 그 끝 · `delta` 가 0).
 *
 * **둘러 가지 않는다**(no wrap). 맨 앞에서 한 칸 더 왼쪽은 아무 일도 아니다 — 자리를 외워
 * 둔 칸이 반대쪽 끝으로 튀면 사람이 자기가 무엇을 눌렀는지 잃는다. 같은 이유로 `null` 은
 * 곧 **메뉴 항목의 비활성**(양 끝에서 "왼쪽으로 이동" 이 회색이 된다) 판정이기도 하다 —
 * 판정과 실행이 한 함수라 둘이 갈릴 수 없다.
 *
 * 맨 앞·맨 뒤로 보내는 것(`Home`/`End`)도 **같은 함수**다: `delta` 를 목록 길이만큼 주면
 * 아래 `clamp` 에 잘려 양 끝에 선다. 별도의 함수를 두지 않는 이유는 "끝에서 더 가면 제자리"
 * 라는 규칙이 두 벌로 갈리지 않게 하기 위해서다.
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
  // 자기 자신을 뺀 목록에서 `at` 번째 — 그 키 **앞**이 새 자리다. `at` 이 그 목록의 끝을
  // 넘으면(맨 뒤로 가는 경우) `undefined` 라 `null`(= 맨 뒤)이 된다.
  const rest = keys.filter((_, i) => i !== from);
  return { to: rest[at] ?? null };
}
