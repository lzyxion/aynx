// 이미지 타일 안의 키 — 타일의 키보드 몸(`data-tile-focus`)에 포커스가 있을 때만 듣는다(순수).
// 판정은 `ev.code`(물리 키)로만 한다(IME 안전 — `keybindings.ts` 와 같은 규칙) · Ctrl · Alt · Meta 조합은 흘려보낸다(전역 단축키와 겹치지 않게).

export type ImageKeyAction = "prev" | "next" | "fit" | "actual" | "zoomIn" | "zoomOut" | "minimap";

export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  isComposing?: boolean;
}

const PLAIN: Readonly<Record<string, ImageKeyAction>> = {
  ArrowLeft: "prev",
  ArrowRight: "next",
  Digit0: "fit",
  Numpad0: "fit",
  Digit1: "actual",
  Numpad1: "actual",
  Equal: "zoomIn",
  NumpadAdd: "zoomIn",
  Minus: "zoomOut",
  NumpadSubtract: "zoomOut",
  KeyM: "minimap",
};

export function imageKeyAction(ev: KeyLike): ImageKeyAction | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return null;
  const action = PLAIN[ev.code] ?? null;
  if (action === null) return null;
  if (ev.shiftKey && ev.code !== "Equal") return null;
  return action;
}
