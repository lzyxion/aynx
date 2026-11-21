// 키 띠 단추의 얼굴 — 띠(`MobileKeys`)와 폰 설정의 키 띠 화면(`MobileSettings`)이 함께 쓴다. `band` 없는 `ctrl` 은 띠의 끈적 Ctrl 이다.

import type { Key } from "$lib/i18n/keys";
import type { BandKey } from "./keys";
import type { StripId } from "./prefs";

export interface StripKey {
  label: string;
  name: Key;
  band?: BandKey;
}

export const STRIP_KEYS: Readonly<Record<StripId, StripKey>> = {
  ctrl: { label: "Ctrl", name: "app.mobile.key.ctrl" },
  esc: { label: "Esc", name: "app.mobile.key.esc", band: "esc" },
  tab: { label: "Tab", name: "app.mobile.key.tab", band: "tab" },
  left: { label: "←", name: "app.mobile.key.left", band: "left" },
  down: { label: "↓", name: "app.mobile.key.down", band: "down" },
  up: { label: "↑", name: "app.mobile.key.up", band: "up" },
  right: { label: "→", name: "app.mobile.key.right", band: "right" },
  ctrlC: { label: "^C", name: "app.mobile.key.ctrlC", band: "ctrlC" },
  enter: { label: "⏎", name: "app.mobile.key.enter", band: "enter" },
};
