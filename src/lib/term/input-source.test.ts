import { describe, expect, it } from "vitest";
import { classifyInput, isMouseReport, isTerminalReply, mergeSource, type InputSource } from "$lib/term/input-source";

const idle = { pasting: false, keyEvent: false, pointer: false };
const pointer = { ...idle, pointer: true };

const MOUSE_REPORTS = [
  "\x1b[<0;10;5M", // SGR 누름
  "\x1b[<0;10;5m", // SGR 뗌
  "\x1b[<64;3;7M", // SGR 휠 위
  "\x1b[<35;120;40M", // SGR 움직임
  "\x1b[<0;812;333M", // SGR 픽셀(?1016)
  "\x1b[32;10;5M", // urxvt
  "\x1b[M !!", // X10
  "\x1b[M`\xff\xff", // X10 — 큰 좌표
  "\x1b[<64;3;7M\x1b[<64;3;7M", // 이어 붙음
  "\x1b[<0;1;1M\x1b[M !!\x1b[32;1;1M",
];

describe("터미널 입력의 출처 — 키 vs 마우스 vs 터미널 응답", () => {
  it("xterm 이 스스로 내보내는 응답은 protocol", () => {
    for (const reply of [
      "\x1b[12;40R", // 커서 위치(DSR 6 의 답)
      "\x1b[?12;40R", // DECXCPR
      "\x1b[0n", // 장치 상태
      "\x1b[?1;2c", // DA1
      "\x1b[>0;276;0c", // DA2
      "\x1b[?2004;1$y", // DECRQM(괄호 붙여넣기)
      "\x1b[2026;2$y",
      "\x1b[?0u", // kitty 키보드 플래그
      "\x1b[8;32;120t", // 창 크기 보고
      "\x1b[I", // 포커스 들어옴
      "\x1b[O", // 포커스 나감
      "\x1bP>|xterm.js(6.0.0)\x1b\\", // XTVERSION
      "\x1bP1$r0m\x1b\\", // DECRQSS
      "\x1b]11;rgb:1e1e/1e1e/2e2e\x1b\\", // OSC 11 배경색 답
      "\x1b]10;rgb:ffff/ffff/ffff\x07",
      "\x1b[I\x1b[12;1R", // 응답 둘이 이어 붙음
    ]) {
      expect(isTerminalReply(reply), JSON.stringify(reply)).toBe(true);
      expect(isMouseReport(reply), JSON.stringify(reply)).toBe(false);
      expect(classifyInput(reply, idle)).toBe("protocol");
      // 클릭이 준 포커스의 `ESC[I` 는 포인터 구간 안에서 나온다 — 그래도 응답이다.
      expect(classifyInput(reply, pointer)).toBe("protocol");
    }
  });

  it("마우스 보고는 mouse — 응답 모양과 겹치지 않는다", () => {
    for (const report of MOUSE_REPORTS) {
      expect(isMouseReport(report), JSON.stringify(report)).toBe(true);
      expect(isTerminalReply(report), JSON.stringify(report)).toBe(false);
      expect(classifyInput(report, idle), JSON.stringify(report)).toBe("mouse");
      expect(classifyInput(report, pointer), JSON.stringify(report)).toBe("mouse");
    }
  });

  it("마우스 보고 모양은 통째로 맞아야 한다", () => {
    for (const notMouse of ["\x1b[<0;10;5Mx", "\x1b[<0;10M", "\x1b[M !", "\x1b[1;5M", "\x1b[<0;10;5R", ""]) {
      expect(isMouseReport(notMouse), JSON.stringify(notMouse)).toBe(false);
      expect(classifyInput(notMouse, idle), JSON.stringify(notMouse)).toBe("keyboard");
    }
  });

  it("사람의 키는 keyboard", () => {
    for (const key of [
      "a",
      "한",
      "\r",
      "\x03", // Ctrl+C
      "\x1b", // Esc
      "\x1b[A", // ↑
      "\x1b[1;5D", // Ctrl+←
      "\x1bOP", // F1
      "\x1b[15~", // F5
      "!echo pwned",
      "\x1b[12;40Rx", // 응답 뒤에 글이 붙으면 응답이 아니다
      "",
    ]) {
      expect(classifyInput(key, idle), JSON.stringify(key)).toBe("keyboard");
    }
  });

  it("포인터 구간의 글은 mouse — 마우스 추적 없는 대체 화면에서 xterm 이 휠을 방향키로 바꾼다", () => {
    for (const arrow of ["\x1b[A", "\x1b[B", "\x1bOA", "\x1bOB"]) {
      expect(classifyInput(arrow, idle)).toBe("keyboard");
      expect(classifyInput(arrow, pointer)).toBe("mouse");
    }
  });

  it("키 · 붙여넣기 구간이 포인터 구간을 이긴다", () => {
    expect(classifyInput("\x1b[A", { pasting: false, keyEvent: true, pointer: true })).toBe("keyboard");
    expect(classifyInput("\x1b[<0;10;5M", { pasting: false, keyEvent: true, pointer: true })).toBe("keyboard");
    // 우클릭 · 가운데 클릭 붙여넣기
    expect(classifyInput("hi", { pasting: true, keyEvent: false, pointer: true })).toBe("paste");
    expect(classifyInput("\x1b[<0;10;5M", { pasting: true, keyEvent: false, pointer: false })).toBe("paste");
  });

  it("키 이벤트 · 붙여넣기 중에 나온 글은 내용과 상관없이 사람 것(Ctrl+F3 = ESC[1;5R 은 커서 위치 답과 같은 모양)", () => {
    expect(classifyInput("\x1b[1;5R", idle)).toBe("protocol");
    expect(classifyInput("\x1b[1;5R", { ...idle, keyEvent: true })).toBe("keyboard");
    expect(classifyInput("\x1b[200~hi\x1b[201~", { ...idle, pasting: true })).toBe("paste");
    expect(classifyInput("\x1b[I", { pasting: true, keyEvent: true, pointer: false })).toBe("paste");
  });

  it("포커스 보고(?1004)는 사람 입력이 아니다 — 검색 점프가 남긴 강조를 지우지 않는다(Terminal 의 keptEvent(\"input\") 판정)", () => {
    // 점프가 타일에 포커스를 줄 때 xterm 이 내는 것 — 키 이벤트 밖이라 protocol
    expect(classifyInput("\x1b[I", idle)).toBe("protocol");
    expect(classifyInput("\x1b[O", idle)).toBe("protocol");
    // 사람이 친 첫 키 · 마우스는 지운다
    expect(classifyInput("a", idle)).not.toBe("protocol");
    expect(classifyInput("\x1b[<64;3;7M", idle)).not.toBe("protocol");
    expect(classifyInput("\x1b[I", { ...idle, keyEvent: true })).not.toBe("protocol");
  });

  it("묶어 보낼 때 — 키 · 붙여넣기 > 마우스 > 응답, 같은 단이면 먼저 온 것", () => {
    const all: InputSource[] = ["keyboard", "paste", "mouse", "protocol"];
    const want: Record<string, InputSource> = {
      "null>keyboard": "keyboard",
      "null>paste": "paste",
      "null>mouse": "mouse",
      "null>protocol": "protocol",
      "keyboard>keyboard": "keyboard",
      "keyboard>paste": "keyboard",
      "keyboard>mouse": "keyboard",
      "keyboard>protocol": "keyboard",
      "paste>keyboard": "paste",
      "paste>paste": "paste",
      "paste>mouse": "paste",
      "paste>protocol": "paste",
      "mouse>keyboard": "keyboard",
      "mouse>paste": "paste",
      "mouse>mouse": "mouse",
      "mouse>protocol": "mouse",
      "protocol>keyboard": "keyboard",
      "protocol>paste": "paste",
      "protocol>mouse": "mouse",
      "protocol>protocol": "protocol",
    };
    for (const prev of [null, ...all]) {
      for (const next of all) {
        const k = `${prev}>${next}`;
        expect(mergeSource(prev, next), k).toBe(want[k]);
      }
    }
    // 셋이 섞인 묶음
    expect(["protocol", "mouse", "keyboard", "protocol"].reduce<InputSource | null>((p, n) => mergeSource(p, n as InputSource), null)).toBe(
      "keyboard",
    );
    expect(["protocol", "mouse", "protocol"].reduce<InputSource | null>((p, n) => mergeSource(p, n as InputSource), null)).toBe("mouse");
  });
});
