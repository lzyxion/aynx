import { describe, expect, it } from "vitest";
import { classifyInput, isTerminalReply, mergeSource } from "$lib/term/input-source";

const idle = { pasting: false, keyEvent: false };

describe("터미널 입력의 출처 — 키 vs 터미널 응답", () => {
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
      expect(classifyInput(reply, idle)).toBe("protocol");
    }
  });

  it("사람의 키 · 마우스는 keyboard", () => {
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
      "\x1b[<0;10;5M", // SGR 마우스 누름
      "\x1b[M !!", // X10 마우스
      "!echo pwned",
      "\x1b[12;40Rx", // 응답 뒤에 글이 붙으면 응답이 아니다
      "",
    ]) {
      expect(classifyInput(key, idle), JSON.stringify(key)).toBe("keyboard");
    }
  });

  it("키 이벤트 · 붙여넣기 중에 나온 글은 내용과 상관없이 사람 것(Ctrl+F3 = ESC[1;5R 은 커서 위치 답과 같은 모양)", () => {
    expect(classifyInput("\x1b[1;5R", idle)).toBe("protocol");
    expect(classifyInput("\x1b[1;5R", { pasting: false, keyEvent: true })).toBe("keyboard");
    expect(classifyInput("\x1b[200~hi\x1b[201~", { pasting: true, keyEvent: false })).toBe("paste");
    expect(classifyInput("\x1b[I", { pasting: true, keyEvent: true })).toBe("paste");
  });

  it("포커스 보고(?1004)는 사람 입력이 아니다 — 검색 점프가 남긴 강조를 지우지 않는다(Terminal 의 keptEvent(\"input\") 판정)", () => {
    // 점프가 타일에 포커스를 줄 때 xterm 이 내는 것 — 키 이벤트 밖이라 protocol
    expect(classifyInput("\x1b[I", idle)).toBe("protocol");
    expect(classifyInput("\x1b[O", idle)).toBe("protocol");
    // 사람이 친 첫 키는 지운다
    expect(classifyInput("a", idle)).not.toBe("protocol");
    expect(classifyInput("\x1b[I", { pasting: false, keyEvent: true })).not.toBe("protocol");
  });

  it("묶어 보낼 때 — 하나라도 사람 것이면 사람", () => {
    expect(mergeSource(null, "protocol")).toBe("protocol");
    expect(mergeSource("protocol", "protocol")).toBe("protocol");
    expect(mergeSource("protocol", "keyboard")).toBe("keyboard");
    expect(mergeSource("keyboard", "protocol")).toBe("keyboard");
    expect(mergeSource("paste", "keyboard")).toBe("paste");
    expect(mergeSource(null, "paste")).toBe("paste");
  });
});
