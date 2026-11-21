/** 호스트 · 프로젝트 · DB 칸이 정렬 단추 하나(`[hosts] sort`)를 나눠 쓴다 — 칸마다 "이름순" 의 뜻이 다르면 안 되어 비교를 여기 한 곳에 둔다 */

/** 대소문자만 다른 두 이름은 글자 코드로 한 번 더 갈라 늘 같은 차례로 선다 */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
}

/** 늦은 것 먼저 · `null` 은 뒤. 같으면 `0` — 부르는 쪽이 [`compareNames`] 로 가른다 */
export function compareRecent(ta: number | null, tb: number | null): number {
  if (ta === tb) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
}
