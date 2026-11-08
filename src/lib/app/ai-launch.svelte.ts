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
  type FocusSnapshot,
} from "$lib/app/panes.svelte.js";
import { forgetFocusOrigin, rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";

/**
 * **AI CLI 고르기 상자** — `Ctrl+Shift+A`(키바인딩 `ai-panel`)와 팔레트의 같은 줄이 여는 상자의 상태(그림은
 * `AiLaunchPicker.svelte` — `+page` 에 늘 마운트돼 이 상태가 있을 때만 그린다).
 *
 * - 후보는 `offeredAiClis`(켜 둔 · 설치된 CLI — 감지가 비면 claude 한 줄)이고 줄 짓기는 순수 `$lib/ai-launch-pick`.
 * - 후보가 하나면 상자 없이 곧바로 연다 · 없으면 `app.ai.noneEnabled` 한 줄.
 * - 처음 골라진 줄 = 마지막으로 연 AI CLI(`lastShellMenuAi` — 독 실행 단추 · 블록 넘기기의 "새로 열기" 와 같은 기억).
 * - **포커스 스냅샷(`focusHere`)은 상자를 여는 순간 찍는다** — 상자가 포커스를 가져간 뒤에 읽으면 시작 폴더의 대상이
 *   틀어질 수 있다. 고른 뒤 `openAiPaneHere(cli, here)` 가 그 스냅샷을 쓴다.
 * - 다른 길(독 실행 단추 · 셸 메뉴 등)은 이 상자를 거치지 않는다 — 이미 CLI 를 고른 길이다.
 */

const FOCUS_KEY = "ai-launch-picker";

export interface AiLaunchPicker {
  rows: AiLaunchRow[];
  selected: number;
  here: FocusSnapshot;
}

let picker = $state<AiLaunchPicker | null>(null);
/** 감지를 기다리는 중 — 키를 연달아 눌러도 상자가 두 번 서지 않게 */
let opening = false;

export function aiLaunchPicker(): AiLaunchPicker | null {
  return picker;
}

/** 상자가 떠 있는가 — 전역 키 가드(`anyModalOpen`) · Escape 사슬이 본다 */
export function aiLaunchPickerOpen(): boolean {
  return picker !== null;
}

/**
 * `ai-panel` 의 몸통 — 고를 것이 있으면 상자를 세우고, 하나면 곧바로 연다. 상자가 이미 떠 있으면 아무것도 하지 않는다
 * (그때의 같은 키는 상자가 받아 골라진 줄을 연다).
 */
export async function openAiLaunchPicker(): Promise<void> {
  if (picker || opening) return;
  const here = focusHere();
  opening = true;
  let detected: Awaited<ReturnType<typeof knownAiClis>>;
  try {
    detected = await knownAiClis();
    // 앱이 켜질 때의 감지가 "하나도 없음" 이면 한 번 다시 본다 — 켜 둔 채 깐 사람(2026-11-03)
    if (noneInstalled(detected)) detected = await refreshKnownAiClis();
  } finally {
    opening = false;
  }
  // 깔린 CLI 가 하나도 없으면 타일을 열지 않는다 — 열어 봐야 셸이 `claude` 를 못 찾는다(2026-11-03 · 독의 "AI CLI 설치" 칸과 같은 뜻)
  const plan = planAiLaunch(offeredAiClis(detected, settings.disabledAgents), detected, lastShellMenuAi());
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

/**
 * 상자를 닫는다. `back` 이면 포커스를 열기 전 자리로 돌려준다(Esc · 바깥 누르기 — 누른 자리가 포커스를 가져갔으면
 * 그쪽이 이긴다). 고른 줄은 `back: false` — 새 타일이 포커스를 가져간다.
 */
export function closeAiLaunchPicker(back: boolean): void {
  if (!picker) return;
  picker = null;
  if (back) returnFocus(FOCUS_KEY);
  else forgetFocusOrigin(FOCUS_KEY);
}

/** 고른 CLI 를 연다 — 상자가 `runOnMenu` 로 값을 스냅샷해 닫은 뒤 부른다(docs/conventions.md 의 메뉴 통로) */
export function runAiLaunch(pick: { cli: AiLaunchCli; here: FocusSnapshot }): void {
  noteShellMenuAi(pick.cli.id);
  void openAiPaneHere({ command: pick.cli.command, id: pick.cli.id }, pick.here);
}
