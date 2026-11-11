import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { AskAnchor } from "$lib/ask-ai";
import {
  planTermTarget,
  shellReadyForInsert,
  TERM_READY_TIMEOUT_MS,
  type TermRow,
  type TermTile,
} from "$lib/code-to-term";
import { termActionsOf } from "$lib/term-actions";
import { hasSession, listPanes, type PaneSpec } from "$lib/session";
import { currentWindowLabel, tileCode } from "$lib/context";
import { activeTabId, findPaneAnywhere, focusedPane, focusTile, residentWindowTabs, tabOfPane } from "$lib/app/tabs.svelte.js";
import { isAgentPane } from "$lib/app/agent-status.svelte.js";
import { displayName, displayTabTitle, runningCommandOf } from "$lib/app/titles.svelte.js";
import { openShellPaneBeside } from "$lib/app/panes.svelte.js";
import { glowTile } from "$lib/app/tile-glow.svelte.js";

/**
 * **문서 코드 블록을 셸 타일에 넣기** — 문서 타일 코드 블록 머리 띠의 [터미널에 넣기]가 부르는 코디네이터.
 *
 * 명령 블록 → AI 타일(`app/ask-ai.svelte.ts` · docs/log/2026-09-28-ask-ai-block.md)과 같은 결의 **형제**다 — 그쪽을 일반화하지 않고
 * 같은 모양을 따로 둔다(받는 쪽 · 줄 · 넣는 바이트 규칙이 다르다). 규칙(셸 언어 · 넣는 바이트 · 받을 타일 · 새 셸의 준비)은 순수 모듈
 * `$lib/code-to-term` 에 있고, 여기는 그 규칙에 **지금 창의 사실**(셸 타일들 · 도는 명령 · 마지막 포커스)을 먹여 결과를 실행한다:
 *
 * - 받을 타일이 곧장 정해지면 그 타일 터미널의 창구(`termActionsOf(id).insertCode`)로 넣고 그 타일로 포커스를 옮겨 테두리를 한 번
 *   빛낸다(`glowTile(…, "accent")` — [AI에게 묻기] 와 같은 빛).
 * - 고를 것이 있으면 고르기 상자(`CodeTermPicker.svelte`)의 상태를 세운다. 상자는 `+page` 에 늘 마운트돼 있고 이 상태가 있을 때만 그린다.
 * - "새 터미널 열기" 는 문서 타일 오른쪽에 이 창의 기본 셸을 열고(`openShellPaneBeside`), 셸이 입력을 받을 준비가 되면 넣는다
 *   (`shellReadyForInsert` — 시한을 넘기면 넣지 않고 알린다).
 *
 * 받는 `code` 는 단추(`DocCodeBlock`)가 이미 `codeForTerm` 으로 주석 줄 · 빈 줄을 뺀 글이다 — 여기(고르기 상자 · 넣기 · 새 터미널)는
 * 그 글을 그대로 다루고 다시 거르지 않는다.
 *
 * 받는 쪽은 **셸 타일만**이다 — 세션 타일(로컬 · SSH — `hasSession`) 가운데 AI 타일(`isAgentPane` — Claude · Codex 를 띄운 타일과 지금
 * AI CLI 가 도는 셸 타일)을 뺀 것. 판정은 새로 짓지 않는다.
 *
 * ## 보안 원칙과의 관계
 *
 * 방향이 **사람 → 셸 타일**이고 사람이 누른 동작이다. 입력 줄에 넣기만 하고 Enter 는 보내지 않는다(여러 줄은 괄호 붙여넣기가 켜진
 * 타일에만 — 꺼져 있으면 줄마다 실행되므로 넣지 않는다 · 끝 줄바꿈은 뗀다). 문서를 AI 가 썼더라도 사람이 골라 눌러 입력 줄에만 놓이는
 * 것이라 "AI 문자열→PTY 길은 없다" 와 부딪히지 않는다 — 실행은 사람이 입력 줄을 보고 Enter 를 칠 때다. 자동으로 넣는 길 · 단축키는
 * 두지 않고, MCP · Rust 는 건드리지 않는다(`ask-ai.svelte.ts` 머리말과 같은 논리).
 */

/** 고르기 상자의 상태 — 있으면 상자가 뜬다 */
export interface CodeTermPicker {
  /** 누른 코드 블록이 사는 문서 타일 — 새 터미널이 이 옆에 선다 */
  sourcePaneId: string;
  /** 넣을 글 — 주석 줄 · 빈 줄을 뺀 블록 글 (열 때 한 번 받는다) */
  code: string;
  rows: TermRow[];
  selected: number;
  /** 열린 셸 타일이 하나라도 있는가 — 없으면 새 터미널 줄만 있다 */
  hasTiles: boolean;
  anchor: AskAnchor;
}

let picker = $state<CodeTermPicker | null>(null);

/** Esc 로 닫을 때 포커스를 돌려줄 자리 — 누른 단추(문서 타일 안). 화면에 그릴 값이 아니라 반응형이 아니다 */
let returnEl: HTMLElement | null = null;

/** 떠 있는 고르기 상자 (없으면 `null`) — `CodeTermPicker.svelte` 가 읽는다 */
export function codeTermPicker(): CodeTermPicker | null {
  return picker;
}

/** 상자가 떠 있는가 — 전역 키 가드(`anyModalOpen`)가 본다 */
export function codeTermPickerOpen(): boolean {
  return picker !== null;
}

/**
 * 상자를 닫는다. `"source"` 면 포커스를 원래 문서 타일(누른 단추)로 돌려준다(Esc) — 고른 줄은 `"none"` 으로 닫고 받는 타일이
 * 포커스를 가져간다.
 */
export function closeCodeTermPicker(back: "source" | "none"): void {
  const source = picker?.sourcePaneId ?? null;
  const el = returnEl;
  picker = null;
  returnEl = null;
  if (back !== "source" || source === null) return;
  if (el?.isConnected) el.focus({ preventScroll: true });
  else {
    const tab = tabOfPane(source);
    if (tab) focusTile(tab.id, source);
  }
}

// ---------------------------------------------------------------------------
// 마지막에 쓴 셸 타일 — "마지막에 씀"
// ---------------------------------------------------------------------------

/** 타일 id → 사람이 마지막으로 그 셸 타일에 포커스를 둔 시각 (화면에 그릴 값이 아니라 반응형이 아니다) */
const lastFocused = new Map<string, number>();

/** 받을 수 있는 셸 타일인가 — 세션 타일이고 AI 타일이 아니다(판정은 탭 점 · [AI에게 묻기] 와 같은 `isAgentPane`) */
const isShellPane = (pane: PaneSpec): boolean => hasSession(pane.kind) && !isAgentPane(pane);

/**
 * 포커스된 타일을 지켜보다 셸 타일이면 시각을 적는다 — 창마다 `mountAppListeners` 가 한 번 건다(`watchAiFocus` 와 같은 자리).
 * 돌려주는 함수가 구독을 푼다.
 */
export function watchShellFocus(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const pane = focusedPane();
      if (pane && isShellPane(pane)) lastFocused.set(pane.id, Date.now());
    });
  });
}

// ---------------------------------------------------------------------------
// 입구
// ---------------------------------------------------------------------------

/**
 * 코드 블록 하나를 셸 타일에 넣는다 — 문서 타일의 [터미널에 넣기]. 받을 타일이 곧장 정해지면 넣고, 아니면 상자를 연다.
 * `anchor` 는 상자가 설 자리(단추 아래 · 오른쪽 맞춤), `from` 은 Esc 로 포커스를 돌려줄 단추다.
 */
export function codeToTerminal(sourcePaneId: string, code: string, anchor: AskAnchor, from: HTMLElement | null): void {
  const plan = planTermTarget({ tiles: shellTiles(), currentTabId: activeTabId() });
  if (plan.mode === "direct") {
    deliver(plan.tile.tabId, plan.tile.paneId, plan.tile.name, code);
    return;
  }
  returnEl = from;
  picker = { sourcePaneId, code, rows: plan.rows, selected: plan.selected, hasTiles: plan.hasTiles, anchor };
}

/**
 * 상자에서 고른 줄을 실행한다 — 상자가 `runOnMenu` 로 **값을 스냅샷해 닫은 뒤** 부른다(docs/conventions.md 의 메뉴 통로).
 */
export function runCodeTermRow(pick: { row: TermRow; sourcePaneId: string; code: string }): void {
  const { row } = pick;
  if (row.kind === "tile") {
    deliver(row.tile.tabId, row.tile.paneId, row.tile.name, pick.code);
    return;
  }
  void openAndInsert(pick.sourcePaneId, pick.code);
}

// ---------------------------------------------------------------------------
// 재료
// ---------------------------------------------------------------------------

/** 이 창의 셸 타일들 — 탭 순서 · 화면 순서 그대로. 터미널 창구가 없는(아직 마운트 전 · 닫히는 중) 타일은 넣을 수 없어 뺀다 */
function shellTiles(): TermTile[] {
  const out: TermTile[] = [];
  const label = currentWindowLabel();
  residentWindowTabs().forEach((tab, i) => {
    for (const pane of listPanes(tab.root)) {
      if (!isShellPane(pane) || termActionsOf(pane.id) === null) continue;
      out.push({
        paneId: pane.id,
        tabId: tab.id,
        name: displayName(pane),
        host: pane.kind === "ssh" ? pane.alias?.trim() || null : null,
        code: tileCode(label, pane.id),
        tabTitle: displayTabTitle(tab),
        tabIndex: i + 1,
        busy: runningCommandOf(pane.id) != null,
        lastFocusedAt: lastFocused.get(pane.id) ?? null,
      });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// 넣기
// ---------------------------------------------------------------------------

/**
 * 그 셸 타일 입력 줄에 넣고(실행하지 않는다) 그리로 간다 — 포커스 · 탭 전환 · 테두리 한 번 빛나기. 넣지 못하면 까닭을 말하고 그 자리에
 * 머문다(여러 줄인데 괄호 붙여넣기가 꺼짐 · 끊긴 세션 · 사라진 타일).
 */
function deliver(tabId: string, paneId: string, name: string, code: string): boolean {
  const api = termActionsOf(paneId);
  if (!api || !findPaneAnywhere(paneId)) {
    showNotice(t("files.doc.codeterm.gone"));
    return false;
  }
  const result = api.insertCode(code);
  if (result !== "ok") {
    showNotice(
      result === "multiline"
        ? t("files.doc.codeterm.multiline", { name })
        : result === "empty"
          ? t("files.doc.codeterm.empty")
          : t("files.doc.codeterm.closed", { name }),
    );
    return false;
  }
  focusTile(tabOfPane(paneId)?.id ?? tabId, paneId);
  glowTile(paneId, "accent");
  // 탭이 바뀌었으면 그 타일의 터미널은 다음 프레임에야 보인다 — 숨은 textarea 는 포커스를 받지 않는다.
  requestAnimationFrame(() => requestAnimationFrame(() => termActionsOf(paneId)?.focus()));
  return true;
}

/** 준비를 다시 보는 간격 (ms) — `ask-ai` 의 새 타일 대기와 같다 */
const READY_POLL_MS = 200;

/**
 * 문서 타일 **오른쪽에** 기본 셸 타일을 열고, 입력을 받을 준비가 되면 넣는다([`shellReadyForInsert`] — 화면에 프롬프트가 서고 조용해짐).
 * [`TERM_READY_TIMEOUT_MS`] 안에 안 되면 넣지 않고 알린다 — 프롬프트가 서기 전에 넣으면 글이 시작 출력 · 프로필 스크립트에 먹힌다.
 * 기다리는 동안 그 타일이 닫히면 조용히 그만둔다.
 */
async function openAndInsert(sourcePaneId: string, code: string): Promise<void> {
  const tab = tabOfPane(sourcePaneId);
  if (!tab) {
    showNotice(t("files.doc.codeterm.gone"));
    return;
  }
  const id = await openShellPaneBeside(tab.id, sourcePaneId);
  if (id === null) {
    showNotice(t("files.doc.codeterm.gone"));
    return;
  }
  const started = Date.now();
  let screen = "";
  let changedAt: number | null = null;
  const tick = (): void => {
    const pane = findPaneAnywhere(id);
    if (!pane) return; // 닫혔다 — 넣을 곳이 없다
    const api = termActionsOf(id);
    const now = Date.now();
    const next = api ? api.screenLines().join("\n").trimEnd() : "";
    if (next !== screen) {
      screen = next;
      changedAt = now;
    }
    const ready = shellReadyForInsert({
      now,
      attached: api !== null,
      drawn: screen.trim() !== "",
      changedAt,
      busy: runningCommandOf(id) != null,
    });
    if (ready) {
      deliver(tabOfPane(id)?.id ?? tab.id, id, displayName(pane), code);
      return;
    }
    if (now - started >= TERM_READY_TIMEOUT_MS) {
      showNotice(t("files.doc.codeterm.not_ready"));
      return;
    }
    setTimeout(tick, READY_POLL_MS);
  };
  setTimeout(tick, READY_POLL_MS);
}
