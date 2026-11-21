// **내부 전용** — OSC 7 · OSC 9;9 핸들러.

import type { IDisposable } from "@xterm/xterm";
import { parseOsc7Cwd, parseOsc9Cwd } from "./cwd";
import type { SiState } from "./state";

/**
 * 값을 기억만 하고 화면은 건드리지 않는다 — 프롬프트마다 와서 렌더를 부르면 명령마다 재렌더가 돈다.
 * 파싱에 실패해도 `true`(삼킴) — OSC 7 은 이 뜻뿐이라 이스케이프 조각을 화면에 새게 두지 않는다.
 */
export function registerOsc7(s: SiState): IDisposable {
  return s.term.parser.registerOscHandler(7, (data) => {
    const next = parseOsc7Cwd(data);
    if (next !== null && next !== s.cwd) {
      s.cwd = next;
      s.sink?.oncwd?.(next);
    }
    return true;
  });
}

/** 우리 것(`9;9;`)일 때만 삼킨다 — OSC 9 는 iTerm2 계열 알림으로도 쓰여 전부 먹으면 다른 소비자의 길을 막는다. */
export function registerOsc9(s: SiState): IDisposable {
  return s.term.parser.registerOscHandler(9, (data) => {
    const next = parseOsc9Cwd(data);
    if (next === null) return false;
    if (next !== s.cwd) {
      s.cwd = next;
      s.sink?.oncwd?.(next);
    }
    return true;
  });
}
