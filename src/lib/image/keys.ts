// **이미지 타일 안의 키** — 타일의 키보드 몸(`data-tile-focus`)에 포커스가 있을 때만 듣는다(순수 판정 · 잎 모듈).
//
// | 키 | 할 일 |
// | --- | --- |
// | ← · → | 같은 폴더의 이전 · 다음 그림 |
// | `0` · 숫자판 0 | 맞춤 |
// | `1` · 숫자판 1 | 1:1 |
// | `+`(`=` · Shift+`=`) · 숫자판 + | 확대 |
// | `-` · 숫자판 - | 축소 |
// | `M` | 작은 지도 켜기 · 끄기 |
//
// 판정은 **`ev.code`(물리 키)** 로만 한다 — 한글 자판 · IME 조합 중에도 같은 키다(`keybindings.ts` 와 같은 규칙). **Ctrl · Alt · Meta 가
// 눌린 조합은 모두 흘려보낸다**(전역 단축키 — `Alt+화살표` 타일 포커스 · `Ctrl+Shift+…` 등 — 와 겹치지 않게). Shift 는 `+`(US 자판의
// Shift+`=`)에만 받고 나머지에서는 흘려보낸다. 조합 중(`isComposing`)인 키도 흘려보낸다.

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

/** 이 키가 이미지 타일의 일인가 — 아니면 `null`(흘려보낸다) */
export function imageKeyAction(ev: KeyLike): ImageKeyAction | null {
  if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return null;
  const action = PLAIN[ev.code] ?? null;
  if (action === null) return null;
  if (ev.shiftKey && ev.code !== "Equal") return null;
  return action;
}
