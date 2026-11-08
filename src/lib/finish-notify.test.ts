import { describe, expect, it } from "vitest";
import {
  blockMarkTitle,
  blockOutcomeLabel,
  finishMessage,
  formatDuration,
  shortCommand,
  shouldNotifyFinish,
  type Tr,
} from "$lib/finish-notify";
import { translate } from "$lib/i18n/dict";

/**
 * 끝난 명령을 말하는 규칙 (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
 *
 * 순수 모듈이라 그대로 돈다 — 토스트도 OS 알림도 데코레이션도 여기 없다.
 *
 * 문구를 내는 함수는 **인자로 들어온다** — 화면에서는 `t` 가 들어오고 여기서는 사전의
 * 순수한 속(`dict.ts` 의 `translate`)으로 만든 한 줄을 넘긴다. 기준은 한국어고, 영어는
 * "배선이 정말 사전을 거치는가" 를 한 묶음으로 확인한다.
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

describe("formatDuration — 자릿수는 언제나 셋 이하", () => {
  it("1분 미만은 0.1초 단위", () => {
    expect(formatDuration(800, ko)).toBe("0.8초");
    expect(formatDuration(12_400, ko)).toBe("12.4초");
    expect(formatDuration(50, ko)).toBe("0.1초");
  });

  it("0.05초 미만은 `0.0초` 가 아니라 `0.1초 미만`", () => {
    expect(formatDuration(25, ko)).toBe("0.1초 미만");
    expect(formatDuration(49, ko)).toBe("0.1초 미만");
    expect(formatDuration(0, ko)).toBe("0.1초 미만");
    expect(formatDuration(25, en)).toBe("< 0.1s");
  });

  it("경계는 한 번만 판정한다 — 59.96초는 이미 분이다", () => {
    expect(formatDuration(59_940, ko)).toBe("59.9초");
    expect(formatDuration(59_960, ko)).toBe("1분 00초");
    expect(formatDuration(60_000, ko)).toBe("1분 00초");
  });

  it("1시간 미만은 초 단위 — 초는 두 자리로 맞춘다", () => {
    expect(formatDuration(185_000, ko)).toBe("3분 05초");
    expect(formatDuration(3_599_000, ko)).toBe("59분 59초");
  });

  it("1시간 이상은 분 단위 (초는 잡음이다)", () => {
    expect(formatDuration(3_600_000, ko)).toBe("1시간 00분");
    expect(formatDuration(3_720_000, ko)).toBe("1시간 02분");
    expect(formatDuration(2 * 3_600_000 + 30 * 60_000, ko)).toBe("2시간 30분");
  });

  it("음수·비수는 0 으로 읽는다 (화면이 깨지지 않게)", () => {
    expect(formatDuration(-5000, ko)).toBe("0.1초 미만");
    expect(formatDuration(Number.NaN, ko)).toBe("0.1초 미만");
  });
});

describe("shouldNotifyFinish — 포커스·가시성 표", () => {
  const base = { durationMs: 30_000, thresholdSecs: 10 };

  it("보고 있는 탭에서 끝난 것은 알리지 않는다 — 화면이 이미 말했다", () => {
    expect(shouldNotifyFinish({ ...base, windowFocused: true, tileVisible: true })).toBe("none");
  });

  it("같은 창의 다른 탭이면 토스트", () => {
    expect(shouldNotifyFinish({ ...base, windowFocused: true, tileVisible: false })).toBe("toast");
  });

  it("창이 포커스를 잃었으면 타일이 보이든 말든 OS 알림", () => {
    expect(shouldNotifyFinish({ ...base, windowFocused: false, tileVisible: true })).toBe("os");
    expect(shouldNotifyFinish({ ...base, windowFocused: false, tileVisible: false })).toBe("os");
  });

  it("임계 미만이면 아무것도 안 한다", () => {
    expect(
      shouldNotifyFinish({ durationMs: 9_999, thresholdSecs: 10, windowFocused: false, tileVisible: false }),
    ).toBe("none");
  });

  it("임계와 정확히 같으면 친다", () => {
    expect(
      shouldNotifyFinish({ durationMs: 10_000, thresholdSecs: 10, windowFocused: false, tileVisible: false }),
    ).toBe("os");
  });

  it("0 (또는 음수·비수)은 끔이다", () => {
    for (const thresholdSecs of [0, -1, Number.NaN]) {
      expect(
        shouldNotifyFinish({ durationMs: 10 * 60_000, thresholdSecs, windowFocused: false, tileVisible: false }),
      ).toBe("none");
    }
  });
});

describe("shortCommand — 알림 한 줄에 들어가게", () => {
  it("줄바꿈·연속 공백은 한 칸으로 편다", () => {
    expect(shortCommand("echo a\n  echo b")).toBe("echo a echo b");
  });

  it("넘치면 뒤를 접는다", () => {
    expect(shortCommand("x".repeat(50))).toBe(`${"x".repeat(40)}…`);
    expect(shortCommand("x".repeat(40))).toBe("x".repeat(40));
  });
});

describe("finishMessage — 실패는 낱말로 먼저 말한다", () => {
  it("성공은 종료 코드를 말하지 않는다", () => {
    expect(finishMessage({ commandLine: "npm run build", durationMs: 12_400, exit: 0 }, ko)).toBe(
      '"npm run build" 끝남 · 12.4초',
    );
  });

  it("실패는 낱말이 먼저고 코드는 괄호로 따라온다", () => {
    expect(finishMessage({ commandLine: "make", durationMs: 185_000, exit: 1 }, ko)).toBe(
      '"make" 실패 · 3분 05초 (코드 1)',
    );
  });

  it("종료 코드를 못 읽었으면 성공처럼 말한다", () => {
    expect(finishMessage({ commandLine: "make", durationMs: 12_400, exit: null }, ko)).toBe(
      '"make" 끝남 · 12.4초',
    );
  });
});

describe("blockOutcomeLabel — 표식은 시간뿐, 낱말은 알림에만", () => {
  /** 기본 임계(3초)로 물어본다 — 설정의 기본값과 같은 값이다 */
  const at3 = (durationMs: number | null, exit: number | null) =>
    blockOutcomeLabel({ durationMs, exit, markAfterSecs: 3 }, ko);

  it("임계 미만이면 성공도 실패도 표식이 없다 (붉은 띠가 이미 말한다)", () => {
    expect(at3(1500, 0).mark).toBeNull();
    expect(at3(500, 2).mark).toBeNull();
  });

  it("임계를 넘으면 성패와 무관하게 **시간만** 적는다", () => {
    expect(at3(3500, 0).mark).toBe("3.5초");
    expect(at3(3500, 2).mark).toBe("3.5초"); // 실패도 같은 글 — 성패는 색이 말한다
  });

  it("알림 문구는 그대로다 — 낱말로 성패를 말하고 코드를 괄호로 싣는다", () => {
    const ok = at3(1500, 0);
    expect(ok.toast).toBe("끝남 · 1.5초");
    expect(ok.tooltipHead).toBe("종료 코드 0 — 성공");

    const bad = at3(2100, 3);
    expect(bad.toast).toBe("실패 · 2.1초 (코드 3)");
    expect(bad.tooltipHead).toBe("종료 코드 3 — 0 이면 성공, 아니면 실패");
  });

  it("하한은 포함이다 (정확히 임계면 붙는다)", () => {
    expect(at3(3000, 0).mark).toBe("3.0초");
    expect(at3(2999, 0).mark).toBeNull();
  });

  it("임계가 `0`(끔)이거나 안 주면 아무리 오래 걸려도 표식이 없다", () => {
    expect(blockOutcomeLabel({ durationMs: 10 * 60_000, exit: 0, markAfterSecs: 0 }, ko).mark).toBeNull();
    expect(blockOutcomeLabel({ durationMs: 10 * 60_000, exit: 0 }, ko).mark).toBeNull();
  });

  it("아직 안 끝난 블록에는 표식이 없다", () => {
    expect(at3(null, null).mark).toBeNull();
  });

  it("종료 코드를 못 읽었으면 성공으로 읽고 코드 줄을 안 만든다", () => {
    const { mark, toast, tooltipHead } = at3(12_400, null);
    expect(mark).toBe("12.4초");
    expect(toast).toBe("끝남 · 12.4초");
    expect(tooltipHead).toBe("");
  });
});

describe("blockMarkTitle — 종료 코드 · 시각 · 명령문", () => {
  it("끝난 블록은 코드 줄 · 시각 줄 · 명령 줄 셋을 준다", () => {
    const started = new Date(2026, 8, 16, 14, 3, 21).getTime();
    const ended = new Date(2026, 8, 16, 14, 3, 33).getTime();
    const title = blockMarkTitle({
      commandLine: "npm run build",
      startedAt: started,
      endedAt: ended,
      exit: 0,
    }, ko);
    const lines = title.split("\n");
    expect(lines[0]).toBe("종료 코드 0 — 성공");
    expect(lines[1]).toContain("→");
    expect(lines[2]).toBe("npm run build");
  });

  it("실패는 코드 줄이 성패를 풀어 적는다", () => {
    const title = blockMarkTitle({ commandLine: "make", startedAt: 0, endedAt: 2100, exit: 3 }, ko);
    expect(title.split("\n")[0]).toBe("종료 코드 3 — 0 이면 성공, 아니면 실패");
  });

  it("코드를 못 읽었고 명령문이 비면 시각 줄만 남는다", () => {
    const title = blockMarkTitle({ commandLine: "   ", startedAt: 0, endedAt: 1000, exit: null }, ko);
    expect(title).not.toContain("\n");
  });
});

describe("문구는 사전을 거친다 — 같은 값, 다른 언어", () => {
  it("걸린 시간의 세 단이 영어로도 나온다", () => {
    expect(formatDuration(800, en)).toBe("0.8s");
    expect(formatDuration(185_000, en)).toBe("3m 05s");
    expect(formatDuration(3_720_000, en)).toBe("1h 02m");
  });

  it("알림 한 줄과 말풍선 첫 줄도 함께 넘어간다", () => {
    expect(finishMessage({ commandLine: "make", durationMs: 185_000, exit: 1 }, en)).toBe(
      '"make" failed · 3m 05s (code 1)',
    );
    expect(blockOutcomeLabel({ durationMs: 2100, exit: 3 }, en).tooltipHead).toBe(
      "Exit code 3 — 0 means success, anything else is a failure",
    );
  });
});
