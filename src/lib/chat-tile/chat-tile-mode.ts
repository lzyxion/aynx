// 채팅 모양 AI 타일의 권한 모드 칩 · 계획의 순수 층 — CLI 자신의 모드(TUI 의 Shift+Tab)다. 사이드 채팅의 앱 Manual/Auto 가 아니다.
// 값 import 를 두지 않는다(`check:cycles`). 칩이 내는 값에 bypass · 묻지 않기 · Codex 전체 접근은 없다 — CLI 가 알리면 읽기 전용 표지일 뿐.

import type { ChatTileCliMode } from "./chat-tile-api";

/** 명세 · open 에 실을 수 있는 값 — Claude `auto` 는 서버가 open 에서 버린다(띄우기 전에는 쓸 수 있는지 모른다) */
export const CLAUDE_MODES: readonly string[] = ["default", "acceptEdits", "plan", "auto"];
export const CODEX_MODES: readonly string[] = ["readOnly", "auto", "plan"];

/** CLI 가 아직 알리지 않았을 때의 메뉴 — Claude `auto` 는 서버가 알린 `choices` 에 있을 때만 */
const CLAUDE_FALLBACK: readonly string[] = ["default", "acceptEdits", "plan"];

function modesOf(cli: string): readonly string[] {
  return cli === "claude" ? CLAUDE_MODES : cli === "codex" ? CODEX_MODES : [];
}

export function permModeOk(cli: string, v: unknown): v is string {
  return typeof v === "string" && modesOf(cli).includes(v);
}

/** 칩 낱말 — 번역하지 않는다(CLI 자신의 이름). 모르는 낱말은 그대로 */
export const CLI_MODE_WORD: Readonly<Record<string, string>> = {
  default: "Manual",
  acceptEdits: "Accept edits",
  plan: "Plan",
  auto: "Auto",
  bypassPermissions: "Bypass",
  dontAsk: "Don't ask",
  readOnly: "Read only",
  custom: "Custom",
};

export function cliModeWord(mode: string): string {
  return Object.hasOwn(CLI_MODE_WORD, mode) ? CLI_MODE_WORD[mode] : mode;
}

export interface ChatModeView {
  /** 칩이 보일 값 — CLI 가 알린 것 ?? 사람이 고른 것 ?? null(아직 모름) */
  current: string | null;
  /** current 가 choices 밖(사용자 설정의 bypass · 묻지 않기 · Codex custom) */
  foreign: boolean;
  /** 메뉴 줄 — cliMode.choices, 없으면 CLI 별 기본(Claude 앞 셋 · Codex 셋) */
  choices: string[];
}

export function chatModeView(cli: "claude" | "codex", cliMode: ChatTileCliMode | null, permMode: string | null): ChatModeView {
  const allowed = modesOf(cli);
  // 서버가 알린 목록이어도 칩이 내는 값 밖은 메뉴에 두지 않는다
  const choices = cliMode
    ? cliMode.choices.filter((m) => allowed.includes(m))
    : [...(cli === "claude" ? CLAUDE_FALLBACK : CODEX_MODES)];
  const current = cliMode?.mode ?? permMode ?? null;
  return { current, foreign: current !== null && !choices.includes(current), choices };
}

/** Codex 계획 글 덩어리 — 항목 id 끝이 `#plan` */
export function isPlanItem(item: string | null): boolean {
  return typeof item === "string" && item.endsWith("#plan");
}

/** 계획 카드 본문 — `input.plan` ?? `detail` · 파일 경로 `input.planFilePath` */
export function planOf(input: unknown, detail: string): { plan: string; path: string | null } {
  const o = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : null;
  const plan = typeof o?.plan === "string" ? o.plan : detail;
  const path = typeof o?.planFilePath === "string" && o.planFilePath.trim() !== "" ? o.planFilePath : null;
  return { plan, path };
}
