import type { Key } from "$lib/i18n/keys";

/** `$lib/fs-backend` 의 `Crumb`(`{label, path}`)를 구조적으로 포함한다 — `crumbsOf` 결과를 변환 없이 넘긴다 */
export interface NavCrumb {
  /** `""` 는 홈 · 합성 루트 */
  path: string;
  label: string;
  /** 합성 루트의 문구 키 — 있으면 `label` 대신 그린다(`fs-backend` 는 룬을 들일 수 없는 순수 모듈이라 키로 보낸다) */
  labelKey?: Key;
  icon?: string | null;
  /** 없으면 `path` 를 쓴다 */
  title?: string;
  /** 있으면 `title` 보다 앞선다 */
  titleKey?: Key;
}
