import { describe, expect, it } from "vitest";
import { Terminal } from "@xterm/xterm";
import { parseOsc9Cwd } from "$lib/shell-integration";
import {
  NOTIFY_BODY_MAX,
  NOTIFY_TITLE_MAX,
  PROGRAM_NOTIFY_GAP_MS,
  createRateGate,
  parseOsc777Notify,
  parseOsc9Notify,
  programNotifyText,
  sanitizeNotifyText,
} from "$lib/osc-notify";

/**
 * 프로그램 알림 파서 (docs/log/2026-09-26-osc-notify-inline-images.md).
 *
 * 붙잡아 두는 것 넷: **ConEmu 하위 명령(`9;4` · `9;9`)은 알림이 아니다** · 777 은 `notify`
 * 만 · 원격 글자는 **다듬고 자른다** · 속도 제한은 **버린다**(쌓지 않는다).
 */

describe("parseOsc9Notify", () => {
  it("본문 하나를 알림으로 받는다", () => {
    expect(parseOsc9Notify("build done")).toEqual({ title: "", body: "build done" });
  });

  it("ConEmu·Windows Terminal 의 숫자 하위 명령은 알림이 아니다", () => {
    expect(parseOsc9Notify("4;1;50")).toBeNull(); // 진행률
    expect(parseOsc9Notify("9;C:\\Users\\me")).toBeNull(); // 현재 폴더 — shell-integration 몫
    expect(parseOsc9Notify("4")).toBeNull();
    expect(parseOsc9Notify("12;")).toBeNull();
  });

  it("숫자로 시작해도 하위 명령 모양이 아니면 알림이다", () => {
    expect(parseOsc9Notify("3 tests failed")).toEqual({ title: "", body: "3 tests failed" });
    expect(parseOsc9Notify("4x;y")).toEqual({ title: "", body: "4x;y" });
  });

  it("빈 본문 · 공백·제어 문자뿐인 본문은 null", () => {
    expect(parseOsc9Notify("")).toBeNull();
    expect(parseOsc9Notify("   ")).toBeNull();
    expect(parseOsc9Notify("\x07\x1b\n")).toBeNull();
  });
});

describe("parseOsc777Notify", () => {
  it("notify;제목;본문", () => {
    expect(parseOsc777Notify("notify;Build;done")).toEqual({ title: "Build", body: "done" });
  });

  it("본문 안의 ; 는 그대로 둔다", () => {
    expect(parseOsc777Notify("notify;make;done; 3 warnings;x")).toEqual({
      title: "make",
      body: "done; 3 warnings;x",
    });
  });

  it("제목만 · 본문만도 받는다", () => {
    expect(parseOsc777Notify("notify;Only title")).toEqual({ title: "Only title", body: "" });
    expect(parseOsc777Notify("notify;;only body")).toEqual({ title: "", body: "only body" });
  });

  it("다른 하위 명령 · 빈 알림은 null", () => {
    expect(parseOsc777Notify("preexec")).toBeNull();
    expect(parseOsc777Notify("precmd;x")).toBeNull();
    expect(parseOsc777Notify("notifyx;a;b")).toBeNull();
    expect(parseOsc777Notify("notify")).toBeNull();
    expect(parseOsc777Notify("notify;;")).toBeNull();
    expect(parseOsc777Notify("notify; ; ")).toBeNull();
  });
});

describe("sanitizeNotifyText", () => {
  it("C0 · DEL · C1 제어 문자를 공백으로 바꾸고 접는다", () => {
    expect(sanitizeNotifyText("a\nb\tc\x00d\x7fe\x85f\x9bg", 100)).toBe("a b c d e f g");
  });

  it("양방향 재배치 문자를 걷는다 (글자 순서를 속이지 못하게)", () => {
    expect(sanitizeNotifyText("safe\u202etxt.exe\u2066x\u2069", 100)).toBe("safe txt.exe x");
  });

  it("앞뒤 공백을 자르고 공백 뭉치를 한 칸으로", () => {
    expect(sanitizeNotifyText("   a    b   ", 100)).toBe("a b");
  });

  it("상한을 넘으면 끝을 … 로 바꾼다 — 결과는 상한을 넘지 않는다", () => {
    const long = "x".repeat(NOTIFY_BODY_MAX + 50);
    const out = sanitizeNotifyText(long, NOTIFY_BODY_MAX);
    expect(Array.from(out)).toHaveLength(NOTIFY_BODY_MAX);
    expect(out.endsWith("…")).toBe(true);
    expect(sanitizeNotifyText("x".repeat(NOTIFY_BODY_MAX), NOTIFY_BODY_MAX)).toBe(
      "x".repeat(NOTIFY_BODY_MAX),
    );
  });

  it("서로게이트 쌍을 가르지 않는다", () => {
    const out = sanitizeNotifyText("😀".repeat(10), 5);
    expect(out).toBe("😀😀😀😀…");
  });

  it("파서가 제목·본문에 각각 상한을 건다", () => {
    const n = parseOsc777Notify(`notify;${"t".repeat(200)};${"b".repeat(500)}`);
    expect(n).not.toBeNull();
    expect(Array.from(n!.title)).toHaveLength(NOTIFY_TITLE_MAX);
    expect(Array.from(n!.body)).toHaveLength(NOTIFY_BODY_MAX);
    const nine = parseOsc9Notify("b".repeat(500));
    expect(Array.from(nine!.body)).toHaveLength(NOTIFY_BODY_MAX);
  });
});

describe("programNotifyText — 프로그램의 제목은 본문 앞머리로 내려간다", () => {
  it("제목과 본문", () => {
    expect(programNotifyText({ title: "Build", body: "done" })).toBe("Build — done");
  });
  it("한쪽만", () => {
    expect(programNotifyText({ title: "", body: "done" })).toBe("done");
    expect(programNotifyText({ title: "Build", body: "" })).toBe("Build");
  });
});

describe("createRateGate", () => {
  it("간격 안의 것은 버리고, 간격이 지나면 다시 연다", () => {
    const gate = createRateGate();
    expect(gate(1000)).toBe(true);
    expect(gate(1000 + PROGRAM_NOTIFY_GAP_MS - 1)).toBe(false);
    // 막힌 호출은 시계를 옮기지 않는다 — 쌓아 두지도, 창을 늘리지도 않는다
    expect(gate(1000 + PROGRAM_NOTIFY_GAP_MS)).toBe(true);
    expect(gate(1000 + PROGRAM_NOTIFY_GAP_MS + 1)).toBe(false);
  });

  it("벌마다 따로 — 타일 하나의 폭주가 다른 타일을 막지 않는다", () => {
    const a = createRateGate();
    const b = createRateGate();
    expect(a(0)).toBe(true);
    expect(b(0)).toBe(true);
    expect(a(10)).toBe(false);
  });
});

/**
 * **OSC 9 의 두 소비자가 서로의 길을 막지 않는다** — 진짜 xterm 파서로 붙든다.
 *
 * xterm 은 같은 번호의 핸들러를 **나중에 건 것부터** 부르고, `false` 면 그 앞의 것으로
 * 넘긴다. `Terminal.svelte` 는 셸 통합(9;9 현재 폴더)을 먼저, 알림을 나중에 건다 — 그래서
 * 알림 핸들러가 먼저 보고, 하위 명령이면 `false` 로 넘긴다. 두 핸들러는 서로의 몫에 `false`
 * 를 주므로 **거는 순서가 뒤집혀도** 결과가 같아야 한다 — 둘 다 잰다.
 */
describe("OSC 9 — 현재 폴더(9;9)와 알림이 함께 산다 (xterm 파서)", () => {
  async function run(notifyFirst: boolean): Promise<{ cwd: string[]; notes: string[] }> {
    const t = new Terminal({ allowProposedApi: true });
    const cwd: string[] = [];
    const notes: string[] = [];
    const cwdHandler = (data: string) => {
      const next = parseOsc9Cwd(data);
      if (next === null) return false;
      cwd.push(next);
      return true;
    };
    const notifyHandler = (data: string) => {
      const n = parseOsc9Notify(data);
      if (n === null) return false;
      notes.push(n.body);
      return true;
    };
    if (notifyFirst) {
      t.parser.registerOscHandler(9, notifyHandler);
      t.parser.registerOscHandler(9, cwdHandler);
    } else {
      t.parser.registerOscHandler(9, cwdHandler);
      t.parser.registerOscHandler(9, notifyHandler);
    }
    // 쓰기는 비동기다 — 파서가 다 먹은 뒤 부르는 콜백을 기다린다
    await new Promise<void>((r) =>
      t.write("]9;9;C:\work]9;build done]9;4;1;50", r),
    );
    t.dispose();
    return { cwd, notes };
  }

  for (const notifyFirst of [false, true]) {
    it(notifyFirst ? "알림을 먼저 걸어도" : "Terminal.svelte 의 순서(셸 통합 먼저)", async () => {
      const { cwd, notes } = await run(notifyFirst);
      expect(cwd).toEqual(["C:\work"]);
      expect(notes).toEqual(["build done"]);
    });
  }
});
