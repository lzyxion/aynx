/** 키 판정은 `ev.code` 로 한다 — `ev.key` 는 한국어 IME 가 켜지면 `"Process"` 로 뭉개진다 */

export type SwitcherKey =
  | { kind: "prev" }
  | { kind: "next" }
  | { kind: "home" }
  | { kind: "end" }
  | { kind: "nth"; index: number }
  | { kind: "apply" }
  | { kind: "close" };

export interface SwitcherKeyEvent {
  code: string;
  key?: string;
  shiftKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  metaKey?: boolean;
}

/** `Ctrl`·`Alt`·`Meta` 가 섞인 키는 `null` — 같은 단축키로 닫는 판정은 부르는 쪽이 먼저 한다 */
export function switcherKeyOf(ev: SwitcherKeyEvent): SwitcherKey | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return null;
  const code = ev.code || ev.key || "";
  switch (code) {
    case "ArrowLeft":
      return { kind: "prev" };
    case "ArrowRight":
      return { kind: "next" };
    case "Tab":
      return { kind: ev.shiftKey ? "prev" : "next" };
    case "Home":
      return { kind: "home" };
    case "End":
      return { kind: "end" };
    case "Enter":
    case "NumpadEnter":
      return { kind: "apply" };
    case "Escape":
      return { kind: "close" };
  }
  if (ev.shiftKey) return null; // Shift+숫자는 기호다
  const m = /^(?:Digit|Numpad)([1-9])$/.exec(code);
  return m ? { kind: "nth", index: Number(m[1]) - 1 } : null;
}

export function initialSelection(ids: readonly string[], activeId: string | null): number {
  if (ids.length === 0) return -1;
  const at = activeId === null ? -1 : ids.indexOf(activeId);
  return at >= 0 ? at : 0;
}

export function moveSelection(len: number, index: number, key: SwitcherKey): number {
  if (len <= 0) return -1;
  const cur = Math.min(Math.max(0, index), len - 1);
  switch (key.kind) {
    case "prev":
      return (cur - 1 + len) % len;
    case "next":
      return (cur + 1) % len;
    case "home":
      return 0;
    case "end":
      return len - 1;
    case "nth":
      return key.index >= 0 && key.index < len ? key.index : cur;
    default:
      return cur;
  }
}
