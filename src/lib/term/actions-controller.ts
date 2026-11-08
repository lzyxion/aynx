// **터미널 조작 창구의 몸통** — `Terminal.svelte` `mount()` 의 `registerTermActions(pane.id, { … })` 객체를 그대로 옮긴 것(2026-10-27 분할 8차).
// `Terminal` 이 `mount()` 의 옛 자리에서 하나 만들어(`createTermActions` — 타일의 값은 게터) 곧바로 `registerTermActions` 에 올린다.
// 등록 · 해제(`untermactions`)의 자리와 순서는 `Terminal` 의 원래 자리 그대로다.
//
// 쥐는 것: 우클릭 · ⋯ 메뉴 · 단축키 · 대시보드 · AI 넘기기 · 모바일 키 띠 · 대화 면 입력 칸이 두드리는 조작(`$lib/term-actions` 의 `TermActions`) —
// 선택 복사 · 붙여넣기(클립보드 컨트롤러로) · 전체 선택 · 화면 지우기 · 링크 열기/복사 · 스크롤백 · 화면 축소판 · 로그 · 괄호 붙여넣기 넣기 ·
// 포커스 · 블록 앵커 · 띠 키 · 입력 칸 보내기(`submitText` · `sendKeys` · `sendText`). 상태 · `$effect` · 리스너 없음.
//
// **여기 없는 것 — 입력 출처(`$lib/term/input-source`)의 동기 구간.** 키 이벤트 문맥(`inputKeyEvent`)을 세우고 내리는 try/finally 는
// `Terminal` 의 `sendAsKey`(= `inputKeyEvent = true; try { sendInput(d) } finally { inputKeyEvent = false }`)에, 붙여넣기 문맥(`inputPasting`)은
// `Terminal` 의 `pasteToTerm` 에 남는다 — 여기서는 그 둘을 옛 자리와 같은 순서로 부르기만 한다. `writeInput` · `sendInput` 도 `Terminal` 의 것이다.
import type { Terminal } from "@xterm/xterm";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeClipboard } from "$lib/clipboard";
import { t as tr } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import { setStickyCtrl, stickyCtrl } from "$lib/app/mobile.svelte.js";
import { bandKeyBytes, type BandKey } from "$lib/mobile/keys";
import { pasteBytes } from "$lib/ask-ai";
import type { AskAnchor } from "$lib/ask-ai";
import { snapshotScreen } from "$lib/screen-thumb";
import { scrollbackLines } from "$lib/scrollback";
import type { SessionHandle } from "$lib/session";
import type { TermActions } from "$lib/term-actions";
import type { InputSource } from "$lib/term/input-source";
import { SUBMIT_ATTACH_GAP_MS, SUBMIT_ENTER_DELAY_MS, submitPlan } from "$lib/term/submit-text";
import type { ClipboardController } from "$lib/term/clipboard-controller.svelte.js";

/** `Terminal` 이 넘기는 값 — `session` · `reconnecting` · `disposed` · `menuLink` · `logPath` 는 **게터**라 부르는 그때의 값이다. */
export interface TermActionsHost {
  /** `mount()` 의 xterm 인스턴스(마운트 동안 바뀌지 않는다) */
  readonly t: Terminal;
  readonly session: SessionHandle | null;
  /** 재연결 중인가(`reconnect !== null`) */
  readonly reconnecting: boolean;
  readonly disposed: boolean;
  /** 우클릭한 그 순간의 링크(`Terminal` 의 `menuLink`) */
  readonly menuLink: string | null;
  readonly logPath: string | null;
  readonly clip: ClipboardController;
  /** 타일 토스트 한 줄 */
  showNote(text: string, ok: boolean): void;
  /** `term.paste()` — 그 동안 나온 글은 붙여넣기(사람)로 친다(입력 출처 `paste` 의 동기 구간은 `Terminal`) */
  pasteToTerm(text: string): void;
  /** 이 타일의 세션으로 곧장(동시 입력 없음) — `Terminal` 의 `writeInput` */
  writeInput(data: string, source?: InputSource): void;
  /** 사람 키 문(`sendInput`)을 키 이벤트 문맥 안에서 — `Terminal` 의 `sendAsKey`(try/finally 는 거기) */
  sendAsKey(data: string): void;
  saveScrollback(): Promise<void>;
  openThisLog(): Promise<void>;
  blockAnchorOf(t: Terminal, blockId: number): AskAnchor | null;
}

/** 터미널 조작 창구 하나 — `registerTermActions` 에 그대로 올린다 */
export function createTermActions(h: TermActionsHost): TermActions {
  const t = h.t;
  return {
    copySelection: () => void h.clip.copySelection(),
    paste: () => void h.clip.pasteFromClipboard(),
    selectAll: () => t.selectAll(),
    // 셸에 `clear` 를 보내지 않는다 — 그러면 치고 있던 명령줄이 함께 실행되고,
    // 끊긴 타일에서는 아무 일도 일어나지 않는다.
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
    // ── 스크롤백 내보내기 · 세션 로그 (2026-09-17) ────────────────────────
    hasScrollback: () => scrollbackLines(t.buffer.active).length > 0,
    // 대시보드 세션 카드의 화면 축소판 — 보이는 화면 그대로(칸의 색째). 팔레트는 투명도를 입히기 **전**의 테마다
    // (`termTheme` — 축소판의 바탕은 불투명해야 한다).
    screenSnapshot: () => snapshotScreen(t.buffer.active, { cols: t.cols, rows: t.rows }, settings.termTheme),
    screenLines: () => {
      const b = t.buffer.active;
      const out: string[] = [];
      for (let i = 0; i < t.rows; i++) out.push(b.getLine(b.baseY + i)?.translateToString(true) ?? "");
      return out;
    },
    saveScrollback: () => void h.saveScrollback(),
    logPath: () => h.logPath,
    openLog: () => void h.openThisLog(),
    // ── 블록을 AI 타일에 넘기기 (docs/log/2026-09-28-ask-ai-block.md) ──────
    bracketedPaste: () => t.modes.bracketedPasteMode,
    // `term.paste()` 가 아니라 같은 변환을 거친 바이트를 **이 타일에만** 쓴다 — `paste()` 는 `onData` →
    // `sendInput` 을 지나 동시 입력이 켜진 탭이면 형제 타일에도 실린다. 괄호 붙여넣기가 꺼져 있으면 넣지
    // 않는다(`pasteBytes` 가 `null`) — 여러 줄이 줄마다 Enter 로 들어가면 "보내지 않는다" 가 깨진다.
    insertText: (text: string) => {
      if (!h.session || h.reconnecting) return "closed";
      const bytes = pasteBytes(text, t.modes.bracketedPasteMode);
      if (bytes === null) return "no-bracketed";
      h.writeInput(bytes, "paste");
      t.scrollToBottom();
      return "ok";
    },
    focus: () => t.focus(),
    blockAnchor: (id: number) => h.blockAnchorOf(t, id),
    // ── 모바일 키 띠 · 입력 칸(원격 웹 R5 — `mobile/MobileKeys.svelte`) — 사람 입력(키 · 붙여넣기)과 같은 문 ──
    bandKey: (key: BandKey) => {
      const ctrl = stickyCtrl();
      if (ctrl) setStickyCtrl(false);
      const bytes = bandKeyBytes(key, { ctrl, appCursor: t.modes.applicationCursorKeysMode });
      h.sendAsKey(bytes);
    },
    // 대화 면 입력 칸(`pane/FlipComposer`) — 한 줄은 친 글자, 여러 줄은 붙여넣기, 그 뒤 Enter 키. 둘 다 사람 입력의 문(`sendInput` —
    // 출처 문맥 `inputKeyEvent` · `inputPasting`)이다 — 모바일 입력 칸 `sendText` 와 같은 결.
    submitText: (text: string, attach: readonly string[] = []) => {
      if (!h.session || h.reconnecting) return "closed";
      const plan = submitPlan(text);
      if (plan === null && attach.length === 0) return "empty";
      // 첨부 칩 — 터미널 면 끌어 놓기와 같은 바이트(`insertText` — 괄호 붙여넣기 · 이 타일에만)를 경로 하나씩, 글보다 먼저
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
      // 한 걸음씩 틈을 두고: 첨부마다 `SUBMIT_ATTACH_GAP_MS`(Codex 가 붙여넣기 묶음을 경로로 알아보게) → 글 → `SUBMIT_ENTER_DELAY_MS`
      // (Codex 가 글 바로 뒤의 Enter 를 줄바꿈으로 받는다) → Enter. 그 사이 세션이 바뀌었거나 끝났으면 남은 걸음을 버린다(다른 세션에 새지 않게).
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
    // 입력 칸이 셸에 곧장 보내는 키(빈 칸의 Backspace = DEL · 끈적 Ctrl 이 걸린 글자 하나) — 사람 키 문이라 끈적 Ctrl 은 `sendInput` 이 붙인다.
    sendKeys: (data: string) => {
      h.sendAsKey(data);
      t.scrollToBottom();
    },
    // 대화 면의 [중지] — 고정 키 Esc 하나를 이 타일에만(사람 키 · 동시 입력 형제 없음 · 끈적 Ctrl 없음 — `writeInput` 직행)
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
