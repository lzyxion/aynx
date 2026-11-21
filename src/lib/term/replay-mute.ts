// 재생 중에는 이미 한 번 일어난 OSC 52 · 9/777 알림 · 7717(설정 끝)을 다시 일으키지 않는다.
// `term/osc-handlers.ts` 보다 **나중에** 건다(xterm 은 나중에 건 것부터 부르고 `true` 면 멈춘다). `9;9` · `9;4` 는 화면 상태라 재생이어도 흘린다.
// DSR/DA 응답과 벨은 `Terminal.svelte` 의 `sendInput` · `onBell` 이 같은 플래그로 막는다.

import type { IDisposable, Terminal } from "@xterm/xterm";
import { parseOsc9Notify } from "$lib/osc-notify";
import { SETUP_OSC } from "$lib/setup-script";

export function attachReplayMute(t: Terminal, replaying: () => boolean): IDisposable {
  const subs = [
    t.parser.registerOscHandler(52, () => replaying()),
    t.parser.registerOscHandler(9, (data) => replaying() && parseOsc9Notify(data) !== null),
    t.parser.registerOscHandler(777, () => replaying()),
    t.parser.registerOscHandler(SETUP_OSC, () => replaying()),
  ];
  return {
    dispose() {
      for (const sub of subs) sub.dispose();
    },
  };
}
