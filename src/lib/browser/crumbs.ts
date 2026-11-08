import type { Key } from "$lib/i18n/keys";

/**
 * 빵부스러기 조각 하나 — [`LocationBar.svelte`] 가 그리는 값.
 *
 * `$lib/fs-backend` 의 `Crumb`(`{label, path}`)를 **구조적으로 포함**한다: 파일 타일은
 * `backend.crumbsOf(cwd)` 결과를 변환 없이 그대로 넘길 수 있고, 세션 타일은 폴더 아이콘을
 * 얹어 넘긴다.
 */
export interface NavCrumb {
  /** 이 조각이 가리키는 경로 (`""` 는 홈 · 합성 루트) */
  path: string;
  label: string;
  /**
   * 합성 루트의 문구 키 (`홈` · `내 PC`) — 있으면 `label` 대신 이것을 그린다.
   *
   * 조각 대부분은 **경로 조각 그대로**라 번역할 것이 없다. 뿌리 하나만 앱이 지어낸 말이고,
   * 그 말을 만드는 곳(`fs-backend`)은 룬을 들일 수 없는 순수 모듈이라
   * 키를 실어 보내고 푸는 것은 `LocationBar.svelte` 의 몫이다.
   */
  labelKey?: Key;
  /** 사람이 고른 아이콘 (세션 타일의 폴더). 없으면 글자만 그린다 */
  icon?: string | null;
  /** 툴팁 — 없으면 `path` 를 쓴다 */
  title?: string;
  /** 툴팁의 문구 키 — 있으면 `title` 보다 앞선다 (`labelKey` 와 같은 이유) */
  titleKey?: Key;
}
