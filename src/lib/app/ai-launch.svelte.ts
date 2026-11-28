import { noneInstalled, noticeNoAiCli } from "$lib/app/ai-none-notice";
import { settings } from "$lib/settings.svelte.js";
import { offeredAiClis } from "$lib/session";
import { planAiLaunch, type AiLaunchCli, type AiLaunchRow } from "$lib/ai-launch-pick";
import {
  focusHere,
  knownAiClis,
  lastShellMenuAi,
  refreshKnownAiClis,
  noteShellMenuAi,
  openAiPaneHere,
  openChatTileHere,
  type FocusSnapshot,
} from "$lib/app/panes.svelte.js";
import { forgetFocusOrigin, rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";

/**
 * AI CLI 고르기 상자의 상태. 포커스 스냅샷(`focusHere`)은 상자를 여는 순간 찍는다 — 상자가 포커스를 가져간 뒤에 읽으면
 * 시작 폴더의 대상이 틀어진다.
 */

const FOCUS_KEY = "ai-launch-picker";

export interface AiLaunchPicker {
  rows: AiLaunchRow[];
  selected: number;
  here: FocusSnapshot;
}

let picker = $state<AiLaunchPicker | null>(null);
/** 키를 연달아 눌러도 상자가 두 번 서지 않게 */
let opening = false;

export function aiLaunchPicker(): AiLaunchPicker | null {
  return picker;
}

/** 전역 키 가드(`anyModalOpen`) · Escape 사슬이 본다 */
export function aiLaunchPickerOpen(): boolean {
  return picker !== null;
}

export async function openAiLaunchPicker(): Promise<void> {
  if (picker || opening) return;
  const here = focusHere();
  opening = true;
  let detected: Awaited<ReturnType<typeof knownAiClis>>;
  try {
    detected = await knownAiClis();
    // 앱을 켜 둔 채 CLI 를 깐 사람 — 한 번 다시 본다
    if (noneInstalled(detected)) detected = await refreshKnownAiClis();
  } finally {
    opening = false;
  }
  // 깔린 CLI 가 없으면 타일을 열지 않는다 — 셸이 `claude` 를 못 찾는다
  const plan = planAiLaunch(offeredAiClis(detected, settings.disabledAgents), detected, lastShellMenuAi(), settings.chatTile);
  if (plan.mode === "none") {
    noticeNoAiCli(detected);
    return;
  }
  if (plan.mode === "direct") {
    runAiLaunch({ cli: plan.cli, here });
    return;
  }
  rememberFocusOrigin(FOCUS_KEY);
  picker = { rows: plan.rows, selected: plan.selected, here };
}

/** 고른 줄은 `back: false` — 새 타일이 포커스를 가져간다 */
export function closeAiLaunchPicker(back: boolean): void {
  if (!picker) return;
  picker = null;
  if (back) returnFocus(FOCUS_KEY);
  else forgetFocusOrigin(FOCUS_KEY);
}

/** 상자가 `runOnMenu` 로 값을 스냅샷해 닫은 뒤 부른다(docs/conventions.md 의 메뉴 통로) · `chat` = 채팅 모양으로 */
export function runAiLaunch(pick: { cli: AiLaunchCli; here: FocusSnapshot; chat?: boolean }): void {
  noteShellMenuAi(pick.cli.id);
  const cli = { command: pick.cli.command, id: pick.cli.id };
  void (pick.chat ? openChatTileHere(cli, pick.here) : openAiPaneHere(cli, pick.here));
}
