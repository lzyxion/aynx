// **키 띠 단추의 얼굴**(원격 웹 R5 · 10-20) — 순수 표. 띠(`MobileKeys`)와 폰 설정의 키 띠 하위 화면(`MobileSettings`)이 같은 글자를 쓴다.
// `band` 가 있는 단추는 셸에 그 키를 보낸다(`$lib/mobile/keys`), 없는 하나(`ctrl`)는 띠의 몫이다(끈적 Ctrl). 맨 왼쪽의 입력 방식 단추는
// 고정이라 이 표에 없다(`MobileKeys`).

import type { Key } from "$lib/i18n/keys";
import type { BandKey } from "./keys";
import type { StripId } from "./prefs";

export interface StripKey {
  /** 단추에 쓰는 글자 */
  label: string;
  /** 접근성 이름 · 설정 줄 이름 */
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
