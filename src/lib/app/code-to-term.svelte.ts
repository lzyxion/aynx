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
import { openDefaultShellInNewTab, openShellPaneBeside } from "$lib/app/panes.svelte.js";
import { isRemote } from "$lib/app/window.svelte.js";
import { glowTile } from "$lib/app/tile-glow.svelte.js";

/**
 * 코드 블록을 셸 타일에 넣기 — `app/ask-ai.svelte.ts` 의 형제(받는 쪽 · 넣는 바이트 규칙이 달라 일반화하지 않는다).
 * 사람 → 셸 타일 방향이고 입력 줄에 넣기만 한다(Enter 없음 · 여러 줄은 괄호 붙여넣기가 켜진 타일에만) — 그래서 "AI 문자열→PTY 길은 없다" 와
 * 부딪히지 않는다. 에이전트 말에서 넣는 것도 사람이 단추를 눌러야만이다 — 자동 · 단축키 · 턴이 끝날 때 넣기는 두지 않는다.
 */

export interface CodeTermPicker {
  /** `null` = 타일이 아닌 곳(사이드 채팅) — 새 터미널은 새 탭에 */
  sourcePaneId: string | null;
  /** 단추가 이미 주석 줄 · 빈 줄을 뺀 글 — 다시 거르지 않는다 */
  code: string;
  rows: TermRow[];
  selected: number;
  hasTiles: boolean;
  anchor: AskAnchor;
  ondone?: () => void;
}

let picker = $state<CodeTermPicker | null>(null);

let returnEl: HTMLElement | null = null;

export function codeTermPicker(): CodeTermPicker | null {
  return picker;
}

export function codeTermPickerOpen(): boolean {
  return picker !== null;
}

/** 고른 줄은 `"none"` 으로 닫는다 — 받는 타일이 포커스를 가져간다 */
export function closeCodeTermPicker(back: "source" | "none"): void {
  const source = picker?.sourcePaneId ?? null;
  const el = returnEl;
  picker = null;
  returnEl = null;
  if (back !== "source") return;
  if (el?.isConnected) el.focus({ preventScroll: true });
  else if (source !== null) {
    const tab = tabOfPane(source);
    if (tab) focusTile(tab.id, source);
  }
}

// ── 마지막에 쓴 셸 타일 ──

const lastFocused = new Map<string, number>();

/** AI 타일은 받지 않는다 — AI 타일 대화 면에서 눌러도 그 타일 자신에게 넣는 일은 없다 */
const isShellPane = (pane: PaneSpec): boolean => hasSession(pane.kind) && !isAgentPane(pane);

export function watchShellFocus(): () => void {
  return $effect.root(() => {
    $effect(() => {
      const pane = focusedPane();
      if (pane && isShellPane(pane)) lastFocused.set(pane.id, Date.now());
    });
  });
}

// ── 입구 ──

/** `from` = Esc 로 포커스를 돌려줄 단추 */
export function codeToTerminal(
  sourcePaneId: string | null,
  code: string,
  anchor: AskAnchor,
  from: HTMLElement | null,
  ondone?: () => void,
): void {
  const plan = planTermTarget({ tiles: shellTiles(), currentTabId: activeTabId() });
  if (plan.mode === "direct") {
    deliver(plan.tile.tabId, plan.tile.paneId, plan.tile.name, code, ondone);
    return;
  }
  returnEl = from;
  picker = { sourcePaneId, code, rows: plan.rows, selected: plan.selected, hasTiles: plan.hasTiles, anchor, ondone };
}

/** 상자가 `runOnMenu` 로 값을 스냅샷해 닫은 뒤 부른다 */
export function runCodeTermRow(pick: { row: TermRow; sourcePaneId: string | null; code: string; ondone?: () => void }): void {
  const { row } = pick;
  if (row.kind === "tile") {
    deliver(row.tile.tabId, row.tile.paneId, row.tile.name, pick.code, pick.ondone);
    return;
  }
  void openAndInsert(pick.sourcePaneId, pick.code, pick.ondone);
}

// ── 재료 ──

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

// ── 넣기 ──

const VIEWER_RESUME_TIMEOUT_MS = 6000;

/**
 * 원격 창의 `"closed"` 는 대개 폰 배치가 떼어 둔 시청자다(`mobile/policy` 의 `parkDelayMs`) — 그 타일로 먼저 가서 다시 붙을 때까지 다시 넣어 본다.
 * 메인 PC 창은 시청자를 떼지 않으므로 곧바로 알린다.
 */
function deliver(tabId: string, paneId: string, name: string, code: string, ondone?: () => void): void {
  const api = termActionsOf(paneId);
  if (!api || !findPaneAnywhere(paneId)) {
    showNotice(t("files.doc.codeterm.gone"));
    return;
  }
  const result = api.insertCode(code);
  if (result === "closed" && isRemote) {
    void waitViewerAndDeliver(tabId, paneId, name, code, ondone);
    return;
  }
  if (result !== "ok") {
    failNotice(result, name);
    return;
  }
  arrive(tabId, paneId);
  ondone?.();
}

function failNotice(result: "multiline" | "empty" | "closed", name: string): void {
  showNotice(
    result === "multiline"
      ? t("files.doc.codeterm.multiline", { name })
      : result === "empty"
        ? t("files.doc.codeterm.empty")
        : t("files.doc.codeterm.closed", { name }),
  );
}

function arrive(tabId: string, paneId: string): void {
  focusTile(tabOfPane(paneId)?.id ?? tabId, paneId);
  glowTile(paneId, "accent");
  // 탭이 바뀌었으면 그 타일의 터미널은 다음 프레임에야 보인다 — 숨은 textarea 는 포커스를 받지 않는다
  requestAnimationFrame(() => requestAnimationFrame(() => termActionsOf(paneId)?.focus()));
}

async function waitViewerAndDeliver(tabId: string, paneId: string, name: string, code: string, ondone?: () => void): Promise<void> {
  focusTile(tabOfPane(paneId)?.id ?? tabId, paneId);
  const started = Date.now();
  for (;;) {
    await new Promise((r) => setTimeout(r, READY_POLL_MS));
    const api = termActionsOf(paneId);
    if (!api || !findPaneAnywhere(paneId)) {
      showNotice(t("files.doc.codeterm.gone"));
      return;
    }
    const result = api.insertCode(code);
    if (result === "ok") {
      arrive(tabId, paneId);
      ondone?.();
      return;
    }
    if (result !== "closed" || Date.now() - started >= VIEWER_RESUME_TIMEOUT_MS) {
      failNotice(result, name);
      return;
    }
  }
}

const READY_POLL_MS = 200;

/**
 * 준비가 안 되면 넣지 않는다 — 프롬프트가 서기 전에 넣으면 글이 시작 출력 · 프로필 스크립트에 먹힌다.
 * 원격 창은 메인 PC 가 새 id 로 세우므로 요청 뒤 새로 나타난 셸 타일을 받을 타일로 본다(그사이 다른 셸이 서면 그쪽을 집을 수 있다 — 알고 받은 한계).
 */
async function openAndInsert(sourcePaneId: string | null, code: string, ondone?: () => void): Promise<void> {
  const tab = sourcePaneId === null ? null : tabOfPane(sourcePaneId);
  if (sourcePaneId !== null && !tab) {
    showNotice(t("files.doc.codeterm.gone"));
    return;
  }
  const before = new Set(residentWindowTabs().flatMap((x) => listPanes(x.root).map((p) => p.id)));
  const opened = tab && sourcePaneId !== null ? await openShellPaneBeside(tab.id, sourcePaneId) : await openDefaultShellInNewTab();
  if (opened === null) {
    showNotice(t("files.doc.codeterm.gone"));
    return;
  }
  let id: string | null = isRemote ? null : opened;
  const resolve = (): string | null => {
    if (id !== null) return id;
    for (const x of residentWindowTabs())
      for (const p of listPanes(x.root)) if (!before.has(p.id) && isShellPane(p)) return (id = p.id);
    return null;
  };
  const started = Date.now();
  let screen = "";
  let changedAt: number | null = null;
  const tick = (): void => {
    const now = Date.now();
    const target = resolve();
    const pane = target === null ? null : findPaneAnywhere(target);
    if (target !== null && !pane) return;
    if (target !== null && pane) {
      const api = termActionsOf(target);
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
        busy: runningCommandOf(target) != null,
      });
      if (ready) {
        deliver(tabOfPane(target)?.id ?? tab?.id ?? "", target, displayName(pane), code, ondone);
        return;
      }
    }
    if (now - started >= TERM_READY_TIMEOUT_MS) {
      showNotice(t("files.doc.codeterm.not_ready"));
      return;
    }
    setTimeout(tick, READY_POLL_MS);
  };
  setTimeout(tick, READY_POLL_MS);
}
