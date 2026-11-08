// ---------------------------------------------------------------------------
// **배럴** — `$lib/app/hosts.svelte.js` 의 공개 표면. 몸은 `app/hosts/` 자식들에 있다(docs/modules-frontend.md).
//
// 규칙: 자식은 이 파일을 **절대 부르지 않고** 형제를 직접 부른다. 여기에는 재수출만 둔다 — 코드를 쓰지 않는다.
// 자식의 내부 전용 이름(`resetForm` · `hostFormProblemText` · `savedCreds` · `refreshSavedCreds` · `ensureLogsFolder` ·
// `newKey` · `runInstall` · `InstallTarget`)은 내보내지 않는다. 하니스는 경로 `app/hosts.svelte.ts` 로 이 파일을 부른다.
// ---------------------------------------------------------------------------

/**
 * **호스트 층** — 세션 타일이 보여 주는 목록의 주인.
 *
 * 타일 안의 트리(`Sidebar`)는 뜻만 올리고 `PaneHost` 는 그 콜백 묶음(`hostActions`)을 해석
 * 없이 전달만 한다. 실제 조작 — 접속·추가·수정·복제·제거·그룹 이동·공개키 설치 — 은 전부
 * 여기 있다 (docs/log/2026-09-02-host-row-menu.md · 2026-09-03-hosts-tile.md).
 *
 * 크게 세 덩이다:
 *
 * 1. **목록 캐시와 재로드** — 사이드바가 읽은 스냅숏 하나([`hostCache`])를 앱이 나눠 본다.
 * 2. **여는 길들** — 지금 탭에, 새 탭에, 격자로 여럿을. 진입점이 여섯
 *    가까이 되지만 자리 잡기는 [`placeHosts`] 하나를 지난다.
 * 3. **추가·수정 폼** — `~/.ssh/config` 와 `~/.ssh/sessions.toml` **두 파일**을 한 폼에서
 *    다룬다. 그 둘이 한 번에 커밋되지 않는다는 사실이 [`submitForm`] 의 절반을 차지한다.
 */

export * from "./hosts/list.svelte.js";
export * from "./hosts/open";
export * from "./hosts/quick-connect";
export { formUi, hostForm, inheritedHint, type HostForm } from "./hosts/form-model.svelte.js";
export * from "./hosts/form.svelte.js";
export * from "./hosts/form-fields";
export { savedPassphrasePath, savedPassword } from "./hosts/saved-creds.svelte.js";
export * from "./hosts/saved-creds-clear";
export { openSessionLogsFolder, sessionLogsFolder } from "./hosts/session-logs.svelte.js";
export * from "./hosts/row-actions";
export { installKeyFor } from "./hosts/install-key";
