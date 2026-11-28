/** AI CLI 고르기 상자(`AiLaunchPicker.svelte`)의 줄 짓기 — 후보가 하나면 상자 없이 곧바로 연다 */

export interface AiLaunchCli {
  command: string;
  id: string;
  name: string;
}

export interface AiLaunchRow {
  cli: AiLaunchCli;
  /** 아니면 흐리게 — 골라도 열고 설치 안내 */
  installed: boolean;
  digit: string | null;
  /** 채팅 모양으로도 열 수 있다 — 실험 설정이 켜졌고 채팅 모양이 있는 CLI(Claude Code · Codex)만 */
  chat: boolean;
}

/** 채팅 모양 AI 타일을 여는 CLI — 서버 채팅 어댑터가 아는 둘 */
export function chatTileCli(id: string): id is "claude" | "codex" {
  return id === "claude" || id === "codex";
}

/** `[ai] launch_form` — 생략 · 모르는 값은 터미널 */
export type AiLaunchForm = "terminal" | "chat";

export function parseLaunchForm(v: unknown): AiLaunchForm {
  return v === "chat" ? "chat" : "terminal";
}

/** 누르기 · Enter 가 여는 모양 — 채팅을 못 받는 줄(`chat` 거짓)은 설정과 상관없이 터미널 */
export function launchFormFor(chat: boolean, pref: AiLaunchForm): AiLaunchForm {
  return chat && pref === "chat" ? "chat" : "terminal";
}

export function otherLaunchForm(form: AiLaunchForm): AiLaunchForm {
  return form === "chat" ? "terminal" : "chat";
}

export type AiLaunchPlan =
  | { mode: "none" }
  | { mode: "direct"; cli: AiLaunchCli; chat: boolean }
  | { mode: "pick"; rows: AiLaunchRow[]; selected: number };

export function planAiLaunch(
  offered: readonly AiLaunchCli[],
  detected: readonly { id: string; installed: boolean }[],
  last: string | null,
  chatOn = false,
): AiLaunchPlan {
  if (offered.length === 0) return { mode: "none" };
  if (offered.length === 1) return { mode: "direct", cli: offered[0], chat: chatOn && chatTileCli(offered[0].id) };
  const rows = offered.map((cli, i) => ({
    cli,
    installed: detected.some((d) => d.id === cli.id && d.installed),
    digit: i < 9 ? String(i + 1) : null,
    chat: chatOn && chatTileCli(cli.id),
  }));
  const at = last === null ? -1 : rows.findIndex((r) => r.cli.id === last);
  return { mode: "pick", rows, selected: at === -1 ? 0 : at };
}

/** `ev.code`(물리 키 · IME 안전)로 본다 */
export function digitRowIndex(code: string, rowCount: number): number | null {
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  if (!m) return null;
  const i = Number(m[1]) - 1;
  return i < rowCount && i < 9 ? i : null;
}

/** 끝과 처음이 이어진 돌림판에서 가까운 쪽으로 센 거리 — 반 바퀴 딱 맞는 줄은 왼쪽(음수) */
export function carouselOffset(i: number, sel: number, n: number): number {
  if (n <= 0) return 0;
  let d = (((i - sel) % n) + n) % n;
  if (d >= n / 2) d -= n;
  return d;
}
