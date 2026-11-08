import { describe, expect, it } from "vitest";
import { OSC52_MAX_BYTES, osc52Note, parseOsc52 } from "$lib/osc52";

/**
 * OSC 52 파서 (docs/log/2026-09-23-osc52-osc8.md).
 *
 * 순수 모듈이라 그대로 돈다 — 클립보드도 설정도 토스트도 여기 없다.
 * 붙잡아 두는 것 셋: **읽기 요청을 값과 갈라 알아본다** · **잘린 payload 를 만들지 않는다**
 * (상한 초과는 `null`) · **UTF-8 왕복**.
 */

/** 테스트에서 payload 를 만드는 쪽 — 앱 코드에는 이 방향의 인코딩이 없다 */
function b64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

describe("parseOsc52 — 쓰기", () => {
  it("`c;<base64>` 는 클립보드 쓰기다", () => {
    expect(parseOsc52(`c;${b64("hello")}`)).toEqual({ selection: "c", text: "hello" });
  });

  it("빈 선택 목록은 규약의 기본값 `s0` 으로 채운다", () => {
    expect(parseOsc52(`;${b64("hello")}`)).toEqual({ selection: "s0", text: "hello" });
  });

  it("`p`(primary)·여러 글자·컷 버퍼 숫자도 같은 답이다 — 우리 클립보드는 하나다", () => {
    expect(parseOsc52(`p;${b64("x")}`)).toEqual({ selection: "p", text: "x" });
    expect(parseOsc52(`cp;${b64("x")}`)).toEqual({ selection: "cp", text: "x" });
    expect(parseOsc52(`s0;${b64("x")}`)).toEqual({ selection: "s0", text: "x" });
  });

  it("한글도 그대로 돌아온다 (UTF-8 왕복)", () => {
    const text = "원격에서 복사한 한 줄 · 탭\t끝";
    expect(parseOsc52(`c;${b64(text)}`)).toEqual({ selection: "c", text });
  });

  it("빈 payload 는 빈 문자열이다 — 클립보드를 비우라는 뜻이고 유효하다", () => {
    expect(parseOsc52("c;")).toEqual({ selection: "c", text: "" });
  });

  it("줄바꿈으로 접어 보낸 base64 도 받는다", () => {
    const folded = `${b64("hello")}\r\n`;
    expect(parseOsc52(`c;${folded}`)).toEqual({ selection: "c", text: "hello" });
  });

  it("패딩(`=`)을 뗀 채 보내도 받는다 — 그렇게 보내는 도구가 흔하다", () => {
    expect(parseOsc52(`c;${b64("hello").replace(/=+$/, "")}`)).toEqual({
      selection: "c",
      text: "hello",
    });
  });
});

describe("parseOsc52 — 읽기 요청", () => {
  it("`?` 는 값이 아니라 **질의**로 갈라 온다 (답하는 쪽이 따로 막을 수 있게)", () => {
    expect(parseOsc52("c;?")).toEqual({ query: true });
    expect(parseOsc52(";?")).toEqual({ query: true });
    expect(parseOsc52("p;?")).toEqual({ query: true });
  });
});

describe("parseOsc52 — 버리는 것", () => {
  it("세미콜론이 없으면 우리가 읽을 모양이 아니다", () => {
    expect(parseOsc52("c")).toBeNull();
    expect(parseOsc52("")).toBeNull();
  });

  it("선택 목록에 모르는 글자가 있으면 버린다", () => {
    expect(parseOsc52(`z;${b64("x")}`)).toBeNull();
    expect(parseOsc52(`c8;${b64("x")}`)).toBeNull();
  });

  it("base64 가 아니면 버린다 — 반쯤 풀어 넘기지 않는다", () => {
    expect(parseOsc52("c;!!!!")).toBeNull();
    expect(parseOsc52("c;aGVsb")).toBeNull(); // 풀 수 없는 길이 (4로 나눈 나머지가 1)
    expect(parseOsc52("c;한글그대로")).toBeNull();
  });

  it("상한을 넘으면 `null` 이다 — **자르지 않는다**", () => {
    const over = b64("a".repeat(OSC52_MAX_BYTES + 1));
    expect(parseOsc52(`c;${over}`)).toBeNull();
  });

  it("딱 상한만큼은 통과한다 (경계를 한 칸 안쪽으로 밀지 않는다)", () => {
    const exact = parseOsc52(`c;${b64("a".repeat(OSC52_MAX_BYTES))}`);
    expect(exact).not.toBeNull();
    expect(exact && "text" in exact ? exact.text.length : 0).toBe(OSC52_MAX_BYTES);
  });
});

describe("osc52Note — 원격 복사 토스트 (docs/log/2026-10-05-ai-tile-copy-note.md)", () => {
  it("평범한 타일의 성공은 말한다", () => {
    expect(osc52Note(true, false)).toBe("copied");
  });
  it("AI 타일의 성공은 말하지 않는다 — CLI 가 제 화면에 이미 띄웠다", () => {
    expect(osc52Note(true, true)).toBeNull();
  });
  it("실패는 어느 타일에서도 예전 그대로 조용하다", () => {
    expect(osc52Note(false, false)).toBeNull();
    expect(osc52Note(false, true)).toBeNull();
  });
});
