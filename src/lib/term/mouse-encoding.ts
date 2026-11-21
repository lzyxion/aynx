// `SerializeAddon` 은 마우스 추적 모드는 싣지만 인코딩(SGR `?1006h` · `?1016h`)은 싣지 않는다. 그 화면으로 시작한 터미널은 X10 보고를
// `onBinary` 로 내고, 앱은 `onData` 만 들으니 휠 · 누르기가 사라진다(프로그램은 SGR 을 한 번만 켠다) — 그래서 엿보고 직렬화 끝에 덧붙인다.
// 기본으로 되돌리는 것은 DECRST 와 RIS 뿐이다(soft reset 은 인코딩을 건드리지 않는다).

import type { IDisposable, Terminal } from "@xterm/xterm";

export type MouseEncoding = "default" | "sgr" | "sgr-pixels";

/** 바뀐 인코딩(관계없으면 `null`). 한 줄에 여럿이면 마지막 것이 이긴다(xterm 과 같다). */
export function encodingAfter(cur: MouseEncoding, params: readonly (number | number[])[], set: boolean): MouseEncoding | null {
  let next: MouseEncoding | null = null;
  for (const p of params) {
    const n = typeof p === "number" ? p : p[0];
    if (n === 1006) next = set ? "sgr" : "default";
    else if (n === 1016) next = set ? "sgr-pixels" : "default";
  }
  return next === null || next === cur ? null : next;
}

export function encodingSuffix(enc: MouseEncoding): string {
  if (enc === "sgr") return "\x1b[?1006h";
  if (enc === "sgr-pixels") return "\x1b[?1016h";
  return "";
}

/** 처리기는 언제나 `false` — 엿보기만 하고 xterm 이 그대로 처리한다 */
export function watchMouseEncoding(t: Terminal): { current(): MouseEncoding } & IDisposable {
  let enc: MouseEncoding = "default";
  const on = (set: boolean) => (params: (number | number[])[]) => {
    enc = encodingAfter(enc, params, set) ?? enc;
    return false;
  };
  const subs = [
    t.parser.registerCsiHandler({ prefix: "?", final: "h" }, on(true)),
    t.parser.registerCsiHandler({ prefix: "?", final: "l" }, on(false)),
    t.parser.registerEscHandler({ final: "c" }, () => {
      enc = "default";
      return false;
    }),
  ];
  return {
    current: () => enc,
    dispose() {
      for (const s of subs) s.dispose();
    },
  };
}
