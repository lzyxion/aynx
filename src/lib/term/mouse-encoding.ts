// **마우스 보고 인코딩 지켜보기** (10-26 — 폰에서 Codex 터미널이 끌기 스크롤을 잃었다). 직렬화(`SerializeAddon` — 체크포인트 · 창 이관)는
// 마우스 **추적** 모드(`?1000h` …)는 싣지만 **인코딩**(SGR `?1006h` · SGR 픽셀 `?1016h`)은 싣지 않는다. 그 화면으로 시작한 터미널(시청자로
// 붙은 원격 창 · F5 뒤 다시 붙은 타일)은 기본(X10) 인코딩으로 보고를 만들고, xterm 은 그 보고를 `onData` 가 아니라 `onBinary` 로 낸다 —
// 앱은 `onData` 만 들으니 휠 · 누르기 보고가 통째로 사라진다. 프로그램(Codex)은 시작할 때 한 번만 SGR 을 켜므로 다시 오지 않는다.
//
// 그래서 파서에 **엿보기만** 하는 처리기를 걸어(언제나 `false` — xterm 이 그대로 처리한다) 지금 인코딩을 기억하고, 직렬화 끝에
// [`encodingSuffix`] 를 덧붙인다. 기본으로 되돌리는 것은 DECRST 와 전체 초기화(RIS — xterm 의 `coreMouseService.reset`)뿐이다
// (soft reset 은 인코딩을 건드리지 않는다).

import type { IDisposable, Terminal } from "@xterm/xterm";

export type MouseEncoding = "default" | "sgr" | "sgr-pixels";

/** DECSET/DECRST 매개변수들 → 바뀐 인코딩(관계없으면 `null`) — 순수. 한 줄에 여럿이면 마지막 것이 이긴다(xterm 과 같다). */
export function encodingAfter(cur: MouseEncoding, params: readonly (number | number[])[], set: boolean): MouseEncoding | null {
  let next: MouseEncoding | null = null;
  for (const p of params) {
    const n = typeof p === "number" ? p : p[0];
    if (n === 1006) next = set ? "sgr" : "default";
    else if (n === 1016) next = set ? "sgr-pixels" : "default";
  }
  return next === null || next === cur ? null : next;
}

/** 직렬화 끝에 덧붙일 시퀀스 — 기본이면 빈 글 */
export function encodingSuffix(enc: MouseEncoding): string {
  if (enc === "sgr") return "\x1b[?1006h";
  if (enc === "sgr-pixels") return "\x1b[?1016h";
  return "";
}

/** 터미널에 건다 — 지금 인코딩을 읽는 함수와 떼는 손잡이 */
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
