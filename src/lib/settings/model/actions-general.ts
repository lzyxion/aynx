// 설정 화면 **일반·AI** 손잡이 — 자동 재접속 · 호스트 정렬 · 파일 보기 · 프로젝트 시작 화면 · 언어 ·
// 자동 잠금 · AI 시작 폴더 · codex/claude 도우미 · 추가 인자 (`GeneralSection` · `McpSection`).
import { resolveLocale, setLocale } from "$lib/i18n/i18n.svelte.js";
import type { FileView } from "$lib/session";
import type { StartScreenMode } from "$lib/project-start";
import { text } from "$lib/settings-codec";
import { toggleDisabled } from "$lib/agent-enabled";
import { forgetLastFileView } from "$lib/app/file-ui-last.svelte.js";
import {
  AI_ICON_STYLES,
  DEFAULT_AI_ICON_STYLE,
  DEFAULT_AI_AVATARS,
  isAppIconId,
  type AiIconStyle,
  DEFAULT_FILE_VIEW,
  DEFAULT_EXEC_SORT,
  DEFAULT_HOST_SORT,
  DEFAULT_PROJECT_START_SCREEN,
  EXEC_SORTS,
  FILE_VIEWS,
  HOST_SORTS,
  IDLE_LOCK_MAX,
  IDLE_LOCK_MIN,
  LANGUAGES,
  PROJECT_START_SCREENS,
  type Language,
} from "./options";
import type { AiMcpServer } from "./schema";
import { normalizeMcpSessionsAgents } from "./normalize";
import { saveSettings, settings } from "./store.svelte.js";

/**
 * 시작 시 SSH 자동 재접속 켬/끔. 끄는 것이 기본이므로 끌 때는 값을 지운다 (webgl 과 대칭).
 *
 * **다음 실행부터** 의미가 있다 — 이 값을 읽는 곳은 부팅 직후의 복원 경로 하나뿐이다.
 */
export function setAutoReconnect(on: boolean) {
  settings.current.app.auto_reconnect = on ? true : undefined;
}

/**
 * 창을 모두 닫으면 트레이에 남기 켬/끔(③-4). 켜는 것이 기본이므로 켤 때는 값을 지운다. 다음 창 닫기부터 먹는다
 * (Rust `workspace_exit_app` 이 그때 `settings.toml` 을 읽는다).
 */
export function setTrayOnClose(on: boolean) {
  settings.current.app.tray_on_close = on ? undefined : false;
}

/**
 * 호스트 목록의 정렬을 바꾸고 **곧바로 파일에 남긴다** (docs/log/2026-09-23-host-history.md).
 *
 * 설정 화면 밖(호스트 독의 툴바 버튼)에서 누르는 손잡이라 [저장] 을 기다리지 않는다 —
 * `mode.svelte.ts` 의 모드 전환과 같은 규칙이다: 설정 화면에 **다른 미저장 변경이 있으면**
 * 저장하지 않고 평범한 미저장 변경으로 남긴다(사람이 아직 정하지 않은 값을 대신 확정하지
 * 않는다). 기본값(이름)이면 칸을 비운다.
 */
export function setHostSort(key: string) {
  if (!(key in HOST_SORTS)) return;
  const wasDirty = settings.dirty;
  settings.current.hosts.sort = key === DEFAULT_HOST_SORT ? undefined : key;
  if (wasDirty) return;
  void saveSettings().catch((e) => {
    console.warn("[aynx] 호스트 정렬을 저장하지 못했습니다 (무시):", e);
  });
}

/**
 * 작업안 실행 목록의 정렬을 바꾸고 **곧바로 파일에 남긴다** — `setHostSort` 와 같은 규칙(설정 화면 밖의 손잡이라 [저장] 을
 * 기다리지 않고, 설정 화면에 다른 미저장 변경이 있으면 평범한 미저장 변경으로 남긴다). 기본값(최근 먼저)이면 칸을 비운다.
 */
export function setExecSort(key: string) {
  if (!(key in EXEC_SORTS)) return;
  const wasDirty = settings.dirty;
  settings.current.plans.exec_sort = key === DEFAULT_EXEC_SORT ? undefined : key;
  if (wasDirty) return;
  void saveSettings().catch((e) => {
    console.warn("[aynx] 실행 목록 정렬을 저장하지 못했습니다 (무시):", e);
  });
}

/**
 * 파일 타일의 기본 보기를 고른다 — 설정 화면의 미리보기 계약 그대로(고르는 즉시 걸리고 [저장] 이
 * 쓴다). 기본(자세히)을 고르면 칸을 비운다. 따로 보기를 고른 적 없는 타일은 곧바로 따라 바뀐다.
 */
export function setFileDefaultView(key: string) {
  const valid: FileView = key in FILE_VIEWS ? (key as FileView) : DEFAULT_FILE_VIEW;
  settings.current.files.default_view = valid === DEFAULT_FILE_VIEW ? undefined : valid;
  forgetLastFileView(); // 툴바에서 마지막으로 고른 보기보다 이 값이 앞선다 — 다음 새 타일부터
}

/**
 * 파일 타일 자동 새로고침 켬/끔 — 켜는 것이 기본이라 켤 때는 칸을 지운다(`setTrayOnClose` 와 같은 결). 고르는 즉시 걸린다
 * (끄면 로컬 타일의 감시 구독이 걷힌다 — 원격은 처음부터 ⟳ 뿐) · [저장] 이 쓴다.
 */
export function setFileAutoRefresh(on: boolean) {
  settings.current.files.auto_refresh = on ? undefined : false;
}

/** 업데이트 자동 확인 켬/끔 — 켜는 것이 기본이라 켤 때는 칸을 지운다(`setFileAutoRefresh` 와 같은 결) · [저장] 이 쓴다 */
export function setAutoCheckUpdates(on: boolean) {
  settings.current.updates.auto_check = on ? undefined : false;
}

/**
 * 프로젝트 시작 화면을 언제 세울지 고른다 — 미리보기 계약 그대로(고르는 즉시 걸리고 [저장] 이 쓴다).
 * 기본(`auto`)을 고르면 칸을 비운다. 이미 열려 있는 시작 화면은 그대로 둔다 — 다음에 여는 것부터다.
 */
export function setProjectStartScreen(key: string) {
  const valid: StartScreenMode = key in PROJECT_START_SCREENS ? (key as StartScreenMode) : DEFAULT_PROJECT_START_SCREEN;
  settings.current.projects.start_screen = valid === DEFAULT_PROJECT_START_SCREEN ? undefined : valid;
}

/**
 * **화면 언어를 고른다** — `"auto"`(또는 모르는 값)면 "안 정함" 으로 접어 OS 를 따른다.
 *
 * **고르는 즉시 화면에 걸린다** ([`applyStoredLanguage`]) — 다른 손잡이와 같은 미리보기
 * 계약이다(값은 [저장] 때 파일로 가고 [취소] 면 되돌아온다). 모드와 달리 그 자리에서
 * 저장하지는 않는다: 언어는 터미널 프리셋 같은 딸린 변경을 만들지 않으므로, 미저장으로
 * 남아도 다음 실행에 어긋나는 것이 없다.
 */
export function setLanguage(key: string) {
  settings.current.app.language = key in LANGUAGES ? (key as Language) : undefined;
  applyStoredLanguage();
}

/**
 * 설정에 적힌 언어를 **화면에 건다** — `mode.svelte.ts` 의 `applyStoredMode` 와 같은 자리다.
 *
 * 부르는 곳은 넷이다: 부팅(`boot.svelte.ts`, `adoptStoredMode()` 바로 뒤) · [`setLanguage`] ·
 * 설정 화면의 [취소](`revertSettings` 뒤) · 다른 창의 저장을 따라갈 때
 * (`settings-sync.svelte.ts`). 모두 "설정 값이 방금 갈렸다" 는 같은 사건이다.
 *
 * `navigator` 가 없는 환경(SSR·테스트)에서는 영어 판정을 피해 빈 문자열을 넘긴다 —
 * `resolveLocale` 이 그때 영어를 고르지만, 그 창에는 화면이 없다.
 */
export function applyStoredLanguage(): void {
  const nav = typeof navigator === "undefined" ? "" : navigator.language;
  setLocale(resolveLocale(settings.current.app.language, nav));
}

/**
 * 무입력 자동 잠금까지의 분(分)을 정한다 — `0`(또는 유효하지 않은 값)이면 값을 지운다
 * (=끔, 백엔드 sanitize 의 `Some(0) → None` 접기와 대칭). 켠 값은 [`IDLE_LOCK_MIN`]~
 * [`IDLE_LOCK_MAX`] 로 자른다. **바로 적용된다**: idle 감시가 매 틱 `settings.idleLockMin`
 * 을 반응형으로 읽으므로 재배선 없이 다음 판정부터 새 시간이 먹는다.
 */
export function setIdleLockMin(min: number) {
  if (!Number.isFinite(min)) return;
  const v = Math.round(min);
  settings.current.app.idle_lock_min =
    v > 0 ? Math.min(IDLE_LOCK_MAX, Math.max(IDLE_LOCK_MIN, v)) : undefined;
}

/**
 * AI 타일의 시작 폴더 폴백을 정한다. `undefined`(또는 공백뿐인 값) = "안 정함"(홈)이라
 * 값을 지운다 (`setDefaultShell` 과 같은 규칙).
 *
 * 경로가 실제로 있는지는 **보지 않는다** — 그 판정은 셸을 세우는 자리 하나뿐이다
 * (`src-tauri/src/pty.rs` 의 `spawn_cwd`). 여기서 걸러 내면 잠깐 안 붙은 드라이브의
 * 경로를 사용자가 저장할 수 없게 된다.
 */
export function setAiStartDir(dir: string | undefined) {
  settings.current.ai.start_dir = text(dir);
}

/** codex `--no-daemon` 켬/끔 — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setCodexNoDaemon(on: boolean) {
  settings.current.ai.codex_no_daemon = on ? undefined : false;
}

/**
 * **AI 아이콘 모양**(로고 / 아바타)을 고른다 — 기본(`logo`)이면 값을 지운다. 미저장 변경이지만 화면은 곧바로 따른다(미리보기) ·
 * 로딩 덮개는 다음에 여는 AI 타일부터.
 */
export function setAiIconStyle(key: string) {
  const valid = Object.hasOwn(AI_ICON_STYLES, key) ? (key as AiIconStyle) : DEFAULT_AI_ICON_STYLE;
  settings.current.ai.icon_style = valid === DEFAULT_AI_ICON_STYLE ? undefined : valid;
}

/** AI CLI 의 아바타를 고른다 — 앱 아이콘 id(내장 키 · `user-<12hex>`)만 받고 기본과 같거나 틀린 값이면 칸을 비운다(= 기본) */
export function setAiAvatar(cli: keyof typeof DEFAULT_AI_AVATARS, id: string) {
  const value = isAppIconId(id) && id !== DEFAULT_AI_AVATARS[cli] ? id : undefined;
  if (cli === "claude") settings.current.ai.avatar_claude = value;
  else settings.current.ai.avatar_codex = value;
}

/** claude 상태줄 도우미 켬/끔 — 켬이 기본이라 **끌 때만** 값을 남긴다 */
export function setClaudeStatusline(on: boolean) {
  settings.current.ai.claude_statusline = on ? undefined : false;
}

/**
 * 그 에이전트의 추가 인자 한 줄을 적는다 — 공백뿐이면 지운다(= 없음). **검사하지 않는다**: 설정 화면이
 * Rust 미리보기(`agent_launch_preview`)가 통과시킨 값만 넘긴다(판정은 `agent_args.rs` 한 곳).
 * 적는 중의 값을 **다듬지 않는다** — 끝 공백을 떼면 낱말 사이 빈칸을 칠 수 없다(파일에 쓸 때 `normalizeStringMap` 이 뗀다).
 */
export function setAgentExtraArgs(agent: string, value: string) {
  const next = { ...(settings.current.ai.args ?? {}) };
  if (value.trim() === "") delete next[agent];
  else next[agent] = value;
  settings.current.ai.args = Object.keys(next).length === 0 ? undefined : next;
}

/**
 * 에이전트 사용/끔 — 끈 에이전트는 새로 띄우거나 고르는 자리에서만 빠진다(`$lib/agent-enabled`). 모두 쓰면 칸을 비운다.
 * 훅 · 추가 인자 · 외부 MCP 값은 건드리지 않는다 — 다시 켜면 원래대로다.
 */
export function setAgentEnabled(agent: string, on: boolean) {
  const next = toggleDisabled(settings.current.ai.disabled_agents, agent, on);
  settings.current.ai.disabled_agents = next.length > 0 ? next : undefined;
}

/** 외부 MCP 목록 — 파일 쓰기는 다른 설정처럼 [저장] 때 한다. */
export function setAiMcpServers(servers: AiMcpServer[]) {
  settings.current.ai.mcp_servers = servers.length > 0 ? servers : undefined;
}

/** 세션 서버 고정 줄도 초안만 바꾼다 — [저장] 뒤 다음 실행부터 적용한다. */
export function setMcpSessionsEnabled(enabled: boolean) {
  settings.current.ai.mcp_sessions_enabled = enabled ? undefined : false;
}

export function setMcpSessionsAgent(agent: string, on: boolean) {
  const agents = new Set(settings.current.ai.mcp_sessions_agents ?? ["claude", "codex"]);
  if (on) agents.add(agent);
  else agents.delete(agent);
  settings.current.ai.mcp_sessions_agents = normalizeMcpSessionsAgents([...agents]);
}
