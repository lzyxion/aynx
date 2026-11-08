import type { Terminal } from "@xterm/xterm";
import { describe, expect, it } from "vitest";
import { attachReplayMute } from "./replay-mute";

// 재생 구간 가리개 (세션 코어 ②) — 떨어진 세션에 다시 붙어 링을 재생하는 동안만 알림·클립보드·설정 끝 신호를 삼킨다.

function fakeTerm() {
  const handlers = new Map<number, (data: string) => boolean>();
  let disposed = 0;
  const t = {
    parser: {
      registerOscHandler(code: number, h: (data: string) => boolean) {
        handlers.set(code, h);
        return { dispose: () => void disposed++ };
      },
    },
  } as unknown as Terminal;
  return { t, handlers, disposedCount: () => disposed };
}

describe("attachReplayMute", () => {
  it("재생 중에만 52·9(알림 모양)·777·7717 을 삼킨다", () => {
    const { t, handlers, disposedCount } = fakeTerm();
    let replaying = true;
    const mute = attachReplayMute(t, () => replaying);
    expect(handlers.get(52)?.("c;aGk=")).toBe(true);
    expect(handlers.get(9)?.("빌드가 끝났습니다")).toBe(true);
    expect(handlers.get(777)?.("notify;제목;본문")).toBe(true);
    expect(handlers.get(7717)?.("done;n;0")).toBe(true);
    // 9;9(작업 폴더)·9;4(진행률)는 화면 상태라 재생이어도 흘린다.
    expect(handlers.get(9)?.("9;C:\\work")).toBe(false);
    expect(handlers.get(9)?.("4;1;50")).toBe(false);

    replaying = false;
    for (const code of [52, 9, 777, 7717]) expect(handlers.get(code)?.("x")).toBe(false);

    mute.dispose();
    expect(disposedCount()).toBe(4);
  });
});
