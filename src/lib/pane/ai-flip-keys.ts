/**
 * **AI 타일 넘기기의 키 판정** — 대화 면이 보이는 동안 그 타일에 들어온 keydown 하나를 어떻게 다룰지, 그리고 대화 면 입력 칸
 * (composer)의 Enter 판정(순수 — DOM · 룬 없음). 그림과 배선은 `pane/AiFlip.svelte` · `pane/FlipComposer.svelte`, 넘김 상태는
 * `pane/ai-flip.svelte.ts`.
 *
 * 대화 면의 키보드 집은 **입력 칸**이다(편집 요소라 한글 IME 가 첫 글자부터 켜져 있다 — 넘길 때 포커스를 거기 준다). 이 판정은
 * 타일 뿌리의 **캡처 단계**에서 돌고, 포커스가 입력 칸이면 거의 모든 키를 칸에 맡긴다(Escape · PageUp/PageDown 만 가로챈다).
 * 포커스가 입력 칸 **밖**(사람이 기록을 눌러 글을 고른 뒤 · 어쩌다 xterm 에 남은 채)일 때:
 *
 * - `pass` — 손대지 않는다: 전역 단축키(창 keydown 이 실행한다 — 넘기기 키도) · 수식 키 홀로 · 기록 안 단추의 Enter/Space · 기록
 *   안 Tab · 고른 글이 있을 때의 복사(브라우저 기본 복사).
 * - `type` — 글자 · IME · 붙여넣기: 키는 **그대로 흘려보내고** 부르는 쪽이 포커스를 입력 칸으로 옮긴다(이 keydown 의 글자는 새
 *   포커스로 간다). 입력 칸이 없으면(권한 대기 — 답은 터미널에서) 터미널로 넘긴다.
 * - `back` — Escape: 터미널로 돌아간다(그 Escape 는 CLI 에 보내지 않는다 — Claude 의 Escape 는 "중단" 이다).
 * - `scroll-*` — 기록을 민다(↑↓ · PageUp/PageDown · Home/End).
 * - `swallow` — 삼킨다: 그 밖의 키가 보이지 않는 터미널로 새지 않게(Enter · Backspace · Ctrl+C(고른 글 없음) · Ctrl+D …).
 *
 * 대화 기록 안 **찾기 띠**(2026-10-19 — `find` 키가 대화 면에서는 이 띠를 연다):
 *
 * - 띠 안(`inFind`)의 키는 **전부** 띠가 받는다(`pass`) — Enter · F3 · Esc · 글자 · 칸 안의 `Ctrl+F` 까지. 띠의 Esc 는 터미널로 돌아가지
 *   않고 띠를 닫는다(포커스는 입력 칸으로).
 * - 띠 밖에서 `find` 조합(`findCombo` — 사용자가 다시 묶었을 수 있다)이면 `find`: 부르는 쪽이 띠를 연다. 입력 칸 안이어도 그렇다 —
 *   전역 처리기는 편집 칸에서 `find` 를 실행하지 않으므로(입력 칸 가드) 여기서 먼저 잡는다.
 */
import { unwrapPasted } from "$lib/transcript";

export type FlipKeyAction =
  | "pass"
  | "type"
  | "back"
  | "scroll-up"
  | "scroll-down"
  | "page-up"
  | "page-down"
  | "top"
  | "bottom"
  | "find"
  | "swallow";

export interface FlipKeyEvent {
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
  keyCode?: number;
}

export interface FlipKeyContext {
  /** 이 조합이 전역 단축키에 걸려 있다(`resolveBindings(...).global`) */
  globalCombo: boolean;
  /** 키의 대상이 입력 칸이다 */
  inComposer: boolean;
  /** 키의 대상이 대화 면(기록) 안이다 — 입력 칸 · xterm 이 아니다 */
  inConvo: boolean;
  /** 대상이 대화 면 안의 단추 · 링크다 */
  onControl: boolean;
  /** 대화 면에 고른 글이 있다 */
  hasSelection: boolean;
  /** 키의 대상이 대화 기록 안 찾기 띠 안이다 */
  inFind?: boolean;
  /** 이 조합이 `find` 키다(`effectiveCombo("find", …)`) */
  findCombo?: boolean;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "OS"]);

/** IME 가 이 키를 쥐고 있다(조합 중 · 처리 키 229) */
export function isImeKey(ev: FlipKeyEvent): boolean {
  return !!ev.isComposing || ev.key === "Process" || ev.keyCode === 229;
}

/** 글자를 넣는 키인가 — 인쇄 가능한 한 글자 · IME 처리 중 · 죽은 키(악센트). AltGr(= Ctrl+Alt) 글자도 */
export function isTypingKey(ev: FlipKeyEvent): boolean {
  if (isImeKey(ev) || ev.key === "Dead") return true;
  if (ev.metaKey) return false;
  if (ev.key.length !== 1) return false;
  // AltGr 는 Ctrl+Alt 로 온다(유럽 자판의 @ · € …) — 둘 다면 글자, 하나만이면 조합이다
  return ev.ctrlKey === ev.altKey;
}

/** 붙여넣기 조합 — 받는 칸(입력 칸 · 터미널)이 받아야 뜻이 있다 */
function isPasteKey(ev: FlipKeyEvent): boolean {
  if (ev.metaKey || ev.altKey) return false;
  if (ev.code === "KeyV" && ev.ctrlKey) return true; // Ctrl+V · Ctrl+Shift+V
  return ev.code === "Insert" && ev.shiftKey && !ev.ctrlKey;
}

export function flipKeyAction(ev: FlipKeyEvent, ctx: FlipKeyContext): FlipKeyAction {
  if (MODIFIER_KEYS.has(ev.key)) return "pass";
  if (ctx.inFind) return "pass";
  if (ctx.findCombo && !isImeKey(ev)) return "find";
  if (ctx.globalCombo) return "pass";
  const bare = !ev.ctrlKey && !ev.altKey && !ev.metaKey;
  if (bare && !ev.shiftKey && ev.key === "Escape" && !isImeKey(ev)) return "back";
  if (ctx.inComposer) {
    // 입력 칸은 제 키를 다 쓴다(글자 · Enter · 화살표 · 복사 · 붙여넣기) — 쪽 넘기기만 기록으로
    if (bare && !ev.shiftKey && !isImeKey(ev) && ev.key === "PageUp") return "page-up";
    if (bare && !ev.shiftKey && !isImeKey(ev) && ev.key === "PageDown") return "page-down";
    return "pass";
  }
  // 대화 면 안의 단추(도구 줄 펼치기 · 이전 메시지 · 복사)는 제 키로 산다
  if (ctx.inConvo && ctx.onControl && bare && (ev.key === "Enter" || ev.key === " ")) return "pass";
  if (ctx.inConvo && ev.key === "Tab" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return "pass";
  // 복사 — 고른 글이 대화 면에 있을 때만(브라우저 기본 복사). 없으면 삼킨다: 보이지 않는 CLI 에 ^C(중단)가 가지 않게
  const copy = (ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey && ev.code === "KeyC") || (ev.ctrlKey && ev.code === "Insert");
  if (copy) return ctx.inConvo && ctx.hasSelection ? "pass" : "swallow";
  if (bare && !ev.shiftKey) {
    switch (ev.key) {
      case "ArrowUp":
        return "scroll-up";
      case "ArrowDown":
        return "scroll-down";
      case "PageUp":
        return "page-up";
      case "PageDown":
        return "page-down";
      case "Home":
        return "top";
      case "End":
        return "bottom";
    }
  }
  if (ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey && ev.key === "Home") return "top";
  if (ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey && ev.key === "End") return "bottom";
  if (isTypingKey(ev) || isPasteKey(ev)) return "type";
  return "swallow";
}

/**
 * 입력 칸의 Enter — `send`(보내기) · `newline`(Shift+Enter — 칸의 기본 동작) · `none`(그 밖 · **IME 조합 중의 Enter** — 조합을
 * 끝내는 Enter 는 보내지 않는다).
 */
export function composerEnter(ev: FlipKeyEvent): "send" | "newline" | "none" {
  if (ev.key !== "Enter" || isImeKey(ev)) return "none";
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return "none";
  return ev.shiftKey ? "newline" : "send";
}

/** 보낸 글과 기록의 사용자 말을 맞대는 꼴 — 줄바꿈 · 공백 묶음을 하나로, 앞뒤 공백 없이 */
export function normalizeSent(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * 기록의 사용자 말이 보낸 글인가 — CLI 가 앞뒤를 다듬거나 긴 붙여넣기를 줄여 적을 수 있어 앞 200자로 맞댄다(어느 쪽이 다른 쪽의
 * 앞부분이어도 같다고 본다).
 */
export function sentMatches(sent: string, recorded: string | null): boolean {
  const a = normalizeSent(sent).slice(0, 200);
  // 여러 줄 보내기는 Claude 기록에 붙여넣기 꼬리표로 감싸여 온다(`unwrapPasted`) — 걷고 맞댄다. 첨부 칩과 함께 보낸 글은 앞에 그림
  // 자리표(`[Image #1] `)가 붙어 올 수 있다 — 그것도 걷는다(2026-10-24)
  const b = recorded === null ? "" : normalizeSent(unwrapPasted(recorded).replace(/^\s*(\[Image #\d+\]\s*)+/, "")).slice(0, 200);
  // 그림만 보낸 말(글 없음)은 글 없는 사람 말과 같다고 본다
  if (a === "" || b === "") return a === "" && b === "";
  return a.startsWith(b) || b.startsWith(a);
}
