import { describe, expect, it } from "vitest";
import {
  CMD_PREVIEW_MAX_CHARS,
  CMD_PREVIEW_MAX_LINES,
  commandPreview,
} from "$lib/command-preview";

/**
 * 긴 명령문 발췌 — 줄·글자 두 상한 중 **먼저 걸리는 쪽**이 이긴다
 * (docs/log/2026-09-20-console-fixes.md ①).
 */
describe("commandPreview", () => {
  it("상한 안이면 그대로 두고 truncated 는 꺼져 있다", () => {
    const p = commandPreview("docker ps -a");
    expect(p.text).toBe("docker ps -a");
    expect(p.truncated).toBe(false);
    expect(p.lines).toBe(1);
    expect(p.chars).toBe("docker ps -a".length);
  });

  it("앞뒤 공백을 턴다 (글자 수도 턴 뒤로 센다)", () => {
    const p = commandPreview("\n  free -m \n\n");
    expect(p.text).toBe("free -m");
    expect(p.chars).toBe(7);
    expect(p.truncated).toBe(false);
  });

  it("빈 명령은 빈 발췌 · 0줄 · 0자", () => {
    expect(commandPreview("")).toEqual({ text: "", truncated: false, lines: 0, chars: 0 });
    expect(commandPreview("   \n  ")).toEqual({ text: "", truncated: false, lines: 0, chars: 0 });
  });

  it("줄 상한을 넘으면 앞 줄만 남기고 … 를 붙인다", () => {
    const p = commandPreview("a\nb\nc\nd\ne", { maxLines: 3, maxChars: 100 });
    expect(p.text).toBe("a\nb\nc…");
    expect(p.truncated).toBe(true);
    expect(p.lines).toBe(5);
    expect(p.chars).toBe(9);
  });

  it("글자 상한을 넘으면 한 줄짜리도 잘린다 (13 KB base64 한 덩어리)", () => {
    const blob = "echo " + "A".repeat(13_000);
    const p = commandPreview(blob);
    expect(p.truncated).toBe(true);
    expect(p.lines).toBe(1);
    expect(p.chars).toBe(blob.length);
    // `…` 한 글자를 뺀 나머지가 상한과 같다
    expect(p.text.length).toBe(CMD_PREVIEW_MAX_CHARS + 1);
    expect(p.text.endsWith("…")).toBe(true);
  });

  it("줄 상한을 지나도 글자 상한이 또 걸린다 (둘 중 먼저 걸리는 쪽)", () => {
    const p = commandPreview("x".repeat(50) + "\n" + "y".repeat(50), { maxLines: 3, maxChars: 20 });
    expect(p.text).toBe("x".repeat(20) + "…");
    expect(p.truncated).toBe(true);
    expect(p.lines).toBe(2);
    expect(p.chars).toBe(101);
  });

  it("자른 자리의 꼬리 공백은 … 앞에 남지 않는다", () => {
    const p = commandPreview("abc     def", { maxLines: 1, maxChars: 6 });
    expect(p.text).toBe("abc…");
  });

  it("maxLines: 1 이면 첫 줄만 (비교 뷰의 `.gcmd` 가 쓰는 모양)", () => {
    const p = commandPreview("uptime\nfree -m\ndf -h", { maxLines: 1 });
    expect(p.text).toBe("uptime…");
    expect(p.lines).toBe(3);
  });

  it("0 이하 상한은 1 로 본다 (호출부 실수로 빈 화면이 되지 않게)", () => {
    const p = commandPreview("abcdef", { maxLines: 0, maxChars: 0 });
    expect(p.text).toBe("a…");
    expect(p.truncated).toBe(true);
  });

  it("기본 상한은 세 줄 · 240자", () => {
    expect(CMD_PREVIEW_MAX_LINES).toBe(3);
    expect(CMD_PREVIEW_MAX_CHARS).toBe(240);
    const p = commandPreview("1\n2\n3\n4");
    expect(p.text).toBe("1\n2\n3…");
  });
});
