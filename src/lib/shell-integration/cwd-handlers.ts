// **내부 전용** — OSC 7 · OSC 9;9 핸들러: 셸이 알려 준 폴더를 `s.cwd` 에 기억하고, 바뀔 때만 `sink.oncwd` 를 부른다.

import type { IDisposable } from "@xterm/xterm";
import { parseOsc7Cwd, parseOsc9Cwd } from "./cwd";
import type { SiState } from "./state";

/**
 * OSC 7 — 현재 폴더 보고. 값을 **기억만** 하고 화면은 건드리지 않는다 (프롬프트마다
 * 오므로 여기서 렌더를 부르면 명령마다 재렌더가 돈다). 읽는 쪽은 눌린 순간에만 본다.
 *
 * `true` 를 돌려주는 것은 OSC 7 이 오로지 이 뜻뿐이어서다 — 파싱에 실패해도(우리가 모르는
 * 모양) 화면에 이스케이프 조각을 새게 두느니 삼킨다.
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

/**
 * OSC 9;9 — Windows Terminal 의 같은 뜻. 이쪽은 **우리 것일 때만** 삼킨다:
 * OSC 9 는 iTerm2 계열에서 알림(`9;<문구>`)으로도 쓰여, 전부 먹으면 다른 소비자의
 * 길을 막는다.
 */
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
