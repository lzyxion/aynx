import { resolveLocale, setLocale } from "$lib/i18n/i18n.svelte.js";
import type { FileView } from "$lib/session";
import type { StartScreenMode } from "$lib/project-start";
import { text } from "$lib/settings-codec";
import { toggleDisabled } from "$lib/agent-enabled";
import { parseLaunchForm } from "$lib/ai-launch-pick";
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

export function setAutoReconnect(on: boolean) {
  settings.current.app.auto_reconnect = on ? true : undefined;
}

/** 다음 창 닫기부터 먹는다 — Rust `workspace_exit_app` 이 그때 `settings.toml` 을 읽는다 */
export function setTrayOnClose(on: boolean) {
  settings.current.app.tray_on_close = on ? undefined : false;
}

/**
 * 설정 화면 밖의 손잡이라 곧바로 파일에 남긴다 — 다만 다른 미저장 변경이 있으면 저장하지 않는다
 * (사람이 아직 정하지 않은 값을 대신 확정하지 않는다). `setExecSort` 도 같다.
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

export function setExecSort(key: string) {
  if (!(key in EXEC_SORTS)) return;
  const wasDirty = settings.dirty;
  settings.current.plans.exec_sort = key === DEFAULT_EXEC_SORT ? undefined : key;
  if (wasDirty) return;
  void saveSettings().catch((e) => {
    console.warn("[aynx] 실행 목록 정렬을 저장하지 못했습니다 (무시):", e);
  });
}

export function setFileDefaultView(key: string) {
  const valid: FileView = key in FILE_VIEWS ? (key as FileView) : DEFAULT_FILE_VIEW;
  settings.current.files.default_view = valid === DEFAULT_FILE_VIEW ? undefined : valid;
  forgetLastFileView(); // 툴바에서 마지막으로 고른 보기보다 이 값이 앞선다 — 다음 새 타일부터
}

export function setFileAutoRefresh(on: boolean) {
  settings.current.files.auto_refresh = on ? undefined : false;
}

export function setAutoCheckUpdates(on: boolean) {
  settings.current.updates.auto_check = on ? undefined : false;
}

export function setProjectStartScreen(key: string) {
  const valid: StartScreenMode = key in PROJECT_START_SCREENS ? (key as StartScreenMode) : DEFAULT_PROJECT_START_SCREEN;
  settings.current.projects.start_screen = valid === DEFAULT_PROJECT_START_SCREEN ? undefined : valid;
}

export function setLanguage(key: string) {
  settings.current.app.language = key in LANGUAGES ? (key as Language) : undefined;
  applyStoredLanguage();
}

export function applyStoredLanguage(): void {
  const nav = typeof navigator === "undefined" ? "" : navigator.language;
  setLocale(resolveLocale(settings.current.app.language, nav));
}

/** `0` 이면 값을 지운다(= 끔) — 백엔드 sanitize 의 `Some(0) → None` 접기와 대칭 */
export function setIdleLockMin(min: number) {
  if (!Number.isFinite(min)) return;
  const v = Math.round(min);
  settings.current.app.idle_lock_min =
    v > 0 ? Math.min(IDLE_LOCK_MAX, Math.max(IDLE_LOCK_MIN, v)) : undefined;
}

/**
 * 경로가 실제로 있는지는 보지 않는다 — 판정은 `pty.rs` 의 `spawn_cwd` 하나다. 여기서 걸러 내면 잠깐 안 붙은
 * 드라이브의 경로를 저장할 수 없게 된다.
 */
export function setAiStartDir(dir: string | undefined) {
  settings.current.ai.start_dir = text(dir);
}

export function setCodexNoDaemon(on: boolean) {
  settings.current.ai.codex_no_daemon = on ? undefined : false;
}

export function setAiIconStyle(key: string) {
  const valid = Object.hasOwn(AI_ICON_STYLES, key) ? (key as AiIconStyle) : DEFAULT_AI_ICON_STYLE;
  settings.current.ai.icon_style = valid === DEFAULT_AI_ICON_STYLE ? undefined : valid;
}

export function setAiAvatar(cli: keyof typeof DEFAULT_AI_AVATARS, id: string) {
  const value = isAppIconId(id) && id !== DEFAULT_AI_AVATARS[cli] ? id : undefined;
  if (cli === "claude") settings.current.ai.avatar_claude = value;
  else settings.current.ai.avatar_codex = value;
}

export function setClaudeStatusline(on: boolean) {
  settings.current.ai.claude_statusline = on ? undefined : false;
}

export function setChatTile(on: boolean) {
  settings.current.ai.chat_tile = on ? true : undefined;
}

export function setAiLaunchForm(form: string) {
  settings.current.ai.launch_form = parseLaunchForm(form) === "chat" ? "chat" : undefined;
}

/**
 * 검사하지 않는다 — 설정 화면이 Rust 미리보기(`agent_launch_preview`)를 통과한 값만 넘긴다.
 * 적는 중의 값을 다듬지 않는다 — 끝 공백을 떼면 낱말 사이 빈칸을 칠 수 없다(파일에 쓸 때 `normalizeStringMap` 이 뗀다).
 */
export function setAgentExtraArgs(agent: string, value: string) {
  const next = { ...(settings.current.ai.args ?? {}) };
  if (value.trim() === "") delete next[agent];
  else next[agent] = value;
  settings.current.ai.args = Object.keys(next).length === 0 ? undefined : next;
}

/** 훅 · 추가 인자 · 외부 MCP 값은 건드리지 않는다 — 다시 켜면 원래대로다 */
export function setAgentEnabled(agent: string, on: boolean) {
  const next = toggleDisabled(settings.current.ai.disabled_agents, agent, on);
  settings.current.ai.disabled_agents = next.length > 0 ? next : undefined;
}

export function setAiMcpServers(servers: AiMcpServer[]) {
  settings.current.ai.mcp_servers = servers.length > 0 ? servers : undefined;
}

export function setMcpSessionsEnabled(enabled: boolean) {
  settings.current.ai.mcp_sessions_enabled = enabled ? undefined : false;
}

export function setMcpSessionsAgent(agent: string, on: boolean) {
  const agents = new Set(settings.current.ai.mcp_sessions_agents ?? ["claude", "codex"]);
  if (on) agents.add(agent);
  else agents.delete(agent);
  settings.current.ai.mcp_sessions_agents = normalizeMcpSessionsAgents([...agents]);
}
