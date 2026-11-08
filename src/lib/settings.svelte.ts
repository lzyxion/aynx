// ---------------------------------------------------------------------------
// **배럴** — `$lib/settings.svelte.js` 의 공개 표면. 몸은 `settings/model/` 자식들에 있다
// (docs/modules-frontend.md). 하니스가 이 경로(`lib/settings.svelte.ts`)를 직접 부르므로 이름을 지킨다.
//
// 규칙: 자식은 이 파일을 **절대 부르지 않고** 형제를 직접 부른다. 여기에는 재수출만 둔다.
// `settings/model/internal.ts` · `payload.ts` 는 내부 전용이라 내보내지 않는다.
// ---------------------------------------------------------------------------

/**
 * 앱 설정 — 전역 상태 + 적용/저장.
 *
 * 룬(`$state`·`$derived`)을 쓰므로 파일 이름이 **`.svelte.ts`** 여야 한다 (평범한 `.ts` 에서는
 * 룬이 컴파일되지 않는다). import 는 `$lib/settings.svelte` 가 아니라
 * `$lib/settings.svelte.js` 로 적는다 — Svelte 5 의 관례다.
 *
 * ## 설계안 "디자인 커스텀" 3층에서 이 모듈이 맡는 범위
 *
 * | 층 | 무엇 | 여기서 다루나 |
 * | --- | --- | --- |
 * | ① 앱 크롬 | `theme.css` 토큰 교체 | **예** — 색 테마 버튼·월페이퍼 추출 |
 * | ② 터미널 내부 | xterm `ITheme` + 글꼴 | **예** — 내장 프리셋·글꼴·크기 |
 * | ③ 사용자 CSS 오버라이드 | 임의 CSS 파일 | 아니오 (후속 작업) |
 *
 * GUI 로 자주 만지는 것만 다루고, 그 이상은 ③으로 넘긴다는 것이 이 분담의 요점이다.
 *
 * ## 적용 방식
 *
 * - **앱 토큰**: `document.documentElement.style` 에 인라인으로 얹는다. 값이 없으면
 *   `removeProperty` 로 지워 `theme.css` 의 기본값이 다시 이긴다 — 즉 "안 정함"과
 *   "기본값으로 되돌림"이 같은 동작이다.
 * - **터미널**: 여기서는 상태만 노출하고 DOM 은 건드리지 않는다. `Terminal.svelte` 가
 *   `$effect` 로 구독해 **이미 열려 있는 터미널까지** 실시간으로 바꾼다.
 */

export * from "./settings/model/schema";
export * from "./settings/model/options";
export * from "./settings/model/normalize";
export * from "./settings/model/store.svelte.js";
export * from "./settings/model/actions-appearance";
export * from "./settings/model/actions-terminal";
export * from "./settings/model/actions-general";
export * from "./settings/model/actions-notify";
export * from "./settings/model/actions-triggers-keys";
export * from "./settings/model/actions-automation";
export * from "./settings/model/actions-remote";
