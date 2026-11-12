// ---------------------------------------------------------------------------
// **배럴** — `$lib/session` 의 공개 표면. 몸은 `session/` 자식들에 있다(docs/modules-frontend.md).
//
// 규칙: 자식은 이 파일(`../session` · `$lib/session`)을 **절대 부르지 않고** 형제를 직접 부른다.
// 여기에는 재수출만 둔다 — 코드를 쓰지 않는다. `session/ko-tr.ts` 는 내부 전용이라 내보내지 않는다.
// ---------------------------------------------------------------------------
// `session/` 은 **순수 트리·스펙**이다 — 화면 기하(layout.ts)를 값으로도 타입으로도 모른다.
// 기하가 필요한 배치 조작(`movePaneDwindle`·`resizePaneStep`)은 `tree-ops.ts` 가 갖고 있고, 그
// 파일이 여기와 layout.ts 를 둘 다 import 한다 (docs/log/2026-09-05-refactor-structure.md).

export * from "./session/spec";
export * from "./session/shells";
export * from "./session/contract";
export * from "./session/factory";
export * from "./session/tree";
export * from "./session/names";
export * from "./session/tree-edit";
export * from "./session/drag";
export * from "./session/errors";
export * from "./session/open";
export * from "./session/ssh-gates";
export * from "./session/last-cwd";
