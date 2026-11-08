// 재생 구간 가리개 (세션 코어 ② — docs/internal/session-server-design-2026-10-08.md 4.3). 순수 모듈 — 상태 저장소를 모른다.
//
// 떨어진 세션에 다시 붙어 Rust 꼬리 링을 재생하는 동안은 **이미 한 번 일어난 출력**이다 — 그 안의 OSC 52(클립보드
// 쓰기)·OSC 9/777 알림·OSC 7717(설정 끝 신호)을 다시 일으키지 않는다. `term/osc-handlers.ts` 의 핸들러들보다
// **나중에** 건다(xterm 은 나중에 건 것부터 부르고 `true` 면 멈춘다). OSC 9 는 알림 모양일 때만 삼킨다 — `9;9`(작업
// 폴더)·`9;4`(진행률)는 재생이어도 화면 상태라 그대로 흘린다. 재생이 아니면 언제나 `false`(다음 소비자에게).
// DSR/DA 응답과 벨은 OSC 가 아니라 `Terminal.svelte` 의 입력 문(`sendInput`)·`onBell` 이 같은 플래그로 막는다.

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
