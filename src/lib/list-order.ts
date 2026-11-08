/**
 * **독 목록의 순서 비교** — 호스트 · 프로젝트 · DB 칸이 같이 쓰는 비교 둘 (2026-10-20).
 *
 * 세 칸은 정렬 단추 하나(`[hosts] sort` — 이름순 ↔ 최근순)를 나눠 쓴다. 단추가 하나인데 칸마다 "이름순" 의 뜻이
 * 다르면(대소문자 · 숫자를 다르게 보면) 같은 이름들이 칸마다 다른 차례로 선다 — 그래서 비교를 여기 한 곳에 둔다.
 * 순수 — 무엇이든 들이지 않는다(어느 층에서 불러도 고리가 생기지 않게).
 */

/**
 * **이름순** — 대소문자 무시(`sensitivity: "base"` — `Gamma` 는 `beta` 와 `zeta` 사이) · 숫자 자연순(`web-2` < `web-10`) ·
 * 로캘은 실행 환경 기본(한글은 가나다). 대소문자만 다른 두 이름은 글자 코드로 한 번 더 갈라 늘 같은 차례로 선다
 * (파일 순서가 바뀌어도 목록이 흔들리지 않게).
 */
export function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }) || (a < b ? -1 : a > b ? 1 : 0);
}

/**
 * **최근순** — 시각(Unix ms)이 늦은 것 먼저, 시각이 없는 것(`null` — 한 번도 안 붙었다)은 뒤. 같으면 `0` 이라
 * 부르는 쪽이 [`compareNames`] 로 가른다(또는 이미 이름순인 목록을 안정 정렬로 다시 세운다).
 */
export function compareRecent(ta: number | null, tb: number | null): number {
  if (ta === tb) return 0;
  if (ta === null) return 1;
  if (tb === null) return -1;
  return tb - ta;
}
