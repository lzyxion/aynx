/**
 * AI 타일 대화 면의 키 판정(타일 뿌리 캡처 단계) · 입력 칸 Enter 판정.
 * `back` 의 Escape 는 CLI 에 보내지 않는다 — Claude 의 Escape 는 "중단" 이다. `swallow` 는 보이지 않는 터미널로 키가 새지 않게 한다.
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
  /** `resolveBindings(...).global` 에 걸린 조합 */
  globalCombo: boolean;
  inComposer: boolean;
  /** 대화 면(기록) 안 — 입력 칸 · xterm 이 아니다 */
  inConvo: boolean;
  onControl: boolean;
  hasSelection: boolean;
  inFind?: boolean;
  /** 사용자가 다시 묶었을 수 있다(`effectiveCombo("find", …)`) */
  findCombo?: boolean;
}

const MODIFIER_KEYS = new Set(["Shift", "Control", "Alt", "Meta", "AltGraph", "CapsLock", "NumLock", "ScrollLock", "OS"]);

export function isImeKey(ev: FlipKeyEvent): boolean {
  return !!ev.isComposing || ev.key === "Process" || ev.keyCode === 229;
}

export function isTypingKey(ev: FlipKeyEvent): boolean {
  if (isImeKey(ev) || ev.key === "Dead") return true;
  if (ev.metaKey) return false;
  if (ev.key.length !== 1) return false;
  // AltGr 는 Ctrl+Alt 로 온다(유럽 자판의 @ · € …) — 둘 다면 글자, 하나만이면 조합이다
  return ev.ctrlKey === ev.altKey;
}

function isPasteKey(ev: FlipKeyEvent): boolean {
  if (ev.metaKey || ev.altKey) return false;
  if (ev.code === "KeyV" && ev.ctrlKey) return true;
  return ev.code === "Insert" && ev.shiftKey && !ev.ctrlKey;
}

export function flipKeyAction(ev: FlipKeyEvent, ctx: FlipKeyContext): FlipKeyAction {
  if (MODIFIER_KEYS.has(ev.key)) return "pass";
  if (ctx.inFind) return "pass";
  // 입력 칸 안이어도 여기서 잡는다 — 전역 처리기는 편집 칸에서 `find` 를 실행하지 않는다
  if (ctx.findCombo && !isImeKey(ev)) return "find";
  if (ctx.globalCombo) return "pass";
  const bare = !ev.ctrlKey && !ev.altKey && !ev.metaKey;
  if (bare && !ev.shiftKey && ev.key === "Escape" && !isImeKey(ev)) return "back";
  if (ctx.inComposer) {
    if (bare && !ev.shiftKey && !isImeKey(ev) && ev.key === "PageUp") return "page-up";
    if (bare && !ev.shiftKey && !isImeKey(ev) && ev.key === "PageDown") return "page-down";
    return "pass";
  }
  if (ctx.inConvo && ctx.onControl && bare && (ev.key === "Enter" || ev.key === " ")) return "pass";
  if (ctx.inConvo && ev.key === "Tab" && !ev.ctrlKey && !ev.altKey && !ev.metaKey) return "pass";
  // 고른 글이 없으면 삼킨다 — 보이지 않는 CLI 에 ^C(중단)가 가지 않게
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

/** IME 조합을 끝내는 Enter 는 보내지 않는다 */
export function composerEnter(ev: FlipKeyEvent): "send" | "newline" | "none" {
  if (ev.key !== "Enter" || isImeKey(ev)) return "none";
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return "none";
  return ev.shiftKey ? "newline" : "send";
}

export function normalizeSent(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** CLI 가 앞뒤를 다듬거나 긴 붙여넣기를 줄여 적을 수 있어 앞 200자로, 어느 쪽이 앞부분이어도 같다고 본다 */
export function sentMatches(sent: string, recorded: string | null): boolean {
  const a = normalizeSent(sent).slice(0, 200);
  // Claude 기록의 붙여넣기 꼬리표 · 그림 자리표(`[Image #1] `)는 걷고 맞댄다
  const b = recorded === null ? "" : normalizeSent(unwrapPasted(recorded).replace(/^\s*(\[Image #\d+\]\s*)+/, "")).slice(0, 200);
  if (a === "" || b === "") return a === "" && b === "";
  return a.startsWith(b) || b.startsWith(a);
}
