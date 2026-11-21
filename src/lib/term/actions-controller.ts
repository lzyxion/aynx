// 터미널 조작 창구(`TermActions`)의 몸통 — `Terminal` 이 만들어 `registerTermActions` 에 올린다.
// 입력 출처의 동기 구간(`inputKeyEvent` · `inputPasting` 의 try/finally)은 `Terminal` 의 `sendAsKey` · `pasteToTerm` 에 남는다 — 여기서는 부르기만 한다.
import { screenRowsText, type ScreenRow } from "$lib/term/screen-rows";
import type { Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeClipboard } from "$lib/clipboard";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import { setStickyCtrl, stickyCtrl } from "$lib/app/mobile.svelte.js";
import { bandKeyBytes, type BandKey } from "$lib/mobile/keys";
import { pasteBytes } from "$lib/ask-ai";
import { codeInsertBytes } from "$lib/code-to-term";
import type { AskAnchor } from "$lib/ask-ai";
import { snapshotScreen } from "$lib/screen-thumb";
import { scrollbackLines } from "$lib/scrollback";
import type { SessionHandle } from "$lib/session";
import type { TermActions } from "$lib/term-actions";
import type { InputSource } from "$lib/term/input-source";
import { SUBMIT_ATTACH_GAP_MS, SUBMIT_ENTER_DELAY_MS, submitPlan } from "$lib/term/submit-text";
import type { ClipboardController } from "$lib/term/clipboard-controller.svelte.js";

/** `session` · `reconnecting` · `disposed` · `menuLink` · `logPath` 는 게터라 부르는 그때의 값이다 */
export interface TermActionsHost {
  readonly t: Terminal;
  readonly session: SessionHandle | null;
  readonly reconnecting: boolean;
  readonly disposed: boolean;
  readonly menuLink: string | null;
  readonly logPath: string | null;
  readonly clip: ClipboardController;
  showNote(text: string, ok: boolean): void;
  pasteToTerm(text: string): void;
  /** 이 타일의 세션으로 곧장(동시 입력 없음) */
  writeInput(data: string, source?: InputSource): void;
  sendAsKey(data: string): void;
  saveScrollback(): Promise<void>;
  openThisLog(): Promise<void>;
  blockAnchorOf(t: Terminal, blockId: number): AskAnchor | null;
}

export function createTermActions(h: TermActionsHost): TermActions {
  const t = h.t;
  return {
    copySelection: () => void h.clip.copySelection(),
    paste: () => void h.clip.pasteFromClipboard(),
    selectAll: () => t.selectAll(),
    // 셸에 `clear` 를 보내지 않는다 — 치고 있던 명령줄이 함께 실행된다.
    clear: () => t.clear(),
    openLink: () => {
      const url = h.menuLink;
      if (url === null) return;
      void openUrl(url).catch((e: unknown) => {
        console.error(`[aynx] 링크를 열지 못했습니다: ${url}`, e);
        h.showNote(tr("pane.term.link.open_failed"), false);
      });
    },
    copyLink: () => {
      const url = h.menuLink;
      if (url === null) return;
      void writeClipboard(url).then((ok) =>
        h.showNote(ok ? tr("pane.term.link.copied") : tr("pane.term.clipboard.write_failed"), ok),
      );
    },
    // ── 스크롤백 내보내기 · 세션 로그 ────────────────────────
    hasScrollback: () => scrollbackLines(t.buffer.active).length > 0,
    // 팔레트는 투명도를 입히기 전의 테마(`termTheme`)다 — 축소판의 바탕은 불투명해야 한다.
    screenSnapshot: () => snapshotScreen(t.buffer.active, { cols: t.cols, rows: t.rows }, settings.termTheme),
    // 스크롤해 둔 자리가 아니라 화면 바닥(`baseY`)에서 센다
    screenBottom: (rows: number) => {
      const b = t.buffer.active;
      const n = Math.max(0, Math.min(rows, t.rows));
      const bottom = { viewportY: b.baseY + t.rows - n, length: b.length, getLine: (y: number) => b.getLine(y), getNullCell: () => b.getNullCell() };
      return snapshotScreen(bottom, { cols: t.cols, rows: n }, settings.termTheme);
    },
    // `isWrapped` 로 잇지 않는다 — Claude 는 칸 끝까지 채운 행 다음에 `isWrapped` 가 선다(`term/screen-rows.ts`)
    screenLines: () => {
      const b = t.buffer.active;
      const rows: ScreenRow[] = [];
      for (let i = 0; i < t.rows; i++) {
        const line = b.getLine(b.baseY + i);
        rows.push({ text: line?.translateToString(true) ?? "", wrapped: line?.isWrapped ?? false });
      }
      return screenRowsText(rows);
    },
    saveScrollback: () => void h.saveScrollback(),
    logPath: () => h.logPath,
    openLog: () => void h.openThisLog(),
    // ── 블록을 AI 타일에 넘기기 ──────
    bracketedPaste: () => t.modes.bracketedPasteMode,
    // `term.paste()` 는 쓰지 않는다 — `sendInput` 을 지나 동시 입력이 켜진 탭이면 형제 타일에도 실린다.
    // 괄호 붙여넣기가 꺼져 있으면 넣지 않는다 — 여러 줄이 줄마다 Enter 로 들어가면 "보내지 않는다" 가 깨진다.
    insertText: (text: string) => {
      if (!h.session || h.reconnecting) return "closed";
      const bytes = pasteBytes(text, t.modes.bracketedPasteMode);
      if (bytes === null) return "no-bracketed";
      h.writeInput(bytes, "paste");
      t.scrollToBottom();
      return "ok";
    },
    // 위와 같은 길(이 타일에만)이다
    insertCode: (code: string) => {
      if (!h.session || h.reconnecting) return "closed";
      const plan = codeInsertBytes(code, t.modes.bracketedPasteMode);
      if (!plan.ok) return plan.why;
      h.writeInput(plan.bytes, "paste");
      t.scrollToBottom();
      return "ok";
    },
    focus: () => t.focus(),
    blockAnchor: (id: number) => h.blockAnchorOf(t, id),
    // ── 모바일 키 띠 · 입력 칸 — 사람 입력(키 · 붙여넣기)과 같은 문 ──
    bandKey: (key: BandKey) => {
      const ctrl = stickyCtrl();
      if (ctrl) setStickyCtrl(false);
      const bytes = bandKeyBytes(key, { ctrl, appCursor: t.modes.applicationCursorKeysMode });
      h.sendAsKey(bytes);
    },
    submitText: (text: string, attach: readonly string[] = []) => {
      if (!h.session || h.reconnecting) return "closed";
      const plan = submitPlan(text);
      if (plan === null && attach.length === 0) return "empty";
      const pastes: string[] = [];
      for (const a of attach) {
        const bytes = pasteBytes(a, t.modes.bracketedPasteMode);
        if (bytes === null) return "no-bracketed";
        pastes.push(bytes);
      }
      const typeText = () => {
        if (plan === null) return; // 그림만 — 아래 Enter 하나
        if (plan.mode === "paste") h.pasteToTerm(plan.text);
        else h.sendAsKey(plan.text);
      };
      // 틈을 둔다 — 첨부 뒤(Codex 가 붙여넣기 묶음을 경로로 알아보게) · 글 뒤(Codex 가 바로 뒤의 Enter 를 줄바꿈으로 받는다).
      // 그 사이 세션이 바뀌었거나 끝났으면 남은 걸음을 버린다(다른 세션에 새지 않게).
      const steps: [() => void, number][] = [
        ...pastes.map((bytes): [() => void, number] => [() => h.writeInput(bytes, "paste"), SUBMIT_ATTACH_GAP_MS]),
        [typeText, SUBMIT_ENTER_DELAY_MS],
        [() => h.sendAsKey("\r"), 0],
      ];
      const sent = h.session;
      const run = (i: number) => {
        if (i >= steps.length) return;
        if (i > 0 && (h.session !== sent || h.reconnecting || h.disposed)) return;
        const [step, gap] = steps[i];
        step();
        if (i + 1 < steps.length) setTimeout(() => run(i + 1), gap);
      };
      run(0);
      t.scrollToBottom();
      return "ok";
    },
    // 사람 키 문이라 끈적 Ctrl 은 `sendInput` 이 붙인다.
    sendKeys: (data: string) => {
      h.sendAsKey(data);
      t.scrollToBottom();
    },
    // `writeInput` 직행 — 동시 입력 형제 · 끈적 Ctrl 을 타지 않는다
    sendEscape: () => {
      if (!h.session || h.reconnecting) return "closed";
      h.writeInput("\x1b", "keyboard");
      return "ok";
    },
    sendText: (text: string, enter: boolean) => {
      if (text) h.pasteToTerm(text);
      if (enter) h.sendAsKey("\r");
      t.scrollToBottom();
    },
  };
}
