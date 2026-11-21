// 배럴 — `$lib/settings.svelte.js` 의 공개 표면. 하니스가 이 경로를 직접 부르므로 이름을 지킨다.
// 자식(`settings/model/`)은 이 파일을 부르지 않는다. `internal.ts` · `payload.ts` 는 내부 전용이라 내보내지 않는다.

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
