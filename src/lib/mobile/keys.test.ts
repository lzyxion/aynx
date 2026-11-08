import { describe, expect, it } from "vitest";
import { BAND_KEYS, bandKeyBytes, ctrlOf } from "./keys";

describe("bandKeyBytes — 모바일 키 띠(R5)", () => {
  const plain = { ctrl: false, appCursor: false };

  it("Esc · Tab · Enter · Ctrl+C", () => {
    expect(bandKeyBytes("esc", plain)).toBe("\x1b");
    expect(bandKeyBytes("tab", plain)).toBe("\t");
    expect(bandKeyBytes("enter", plain)).toBe("\r");
    expect(bandKeyBytes("ctrlC", plain)).toBe("\x03");
  });

  it("화살표는 커서 키 모드를 따른다(vim · less 의 DECCKM)", () => {
    expect(bandKeyBytes("up", plain)).toBe("\x1b[A");
    expect(bandKeyBytes("left", plain)).toBe("\x1b[D");
    expect(bandKeyBytes("up", { ctrl: false, appCursor: true })).toBe("\x1bOA");
    expect(bandKeyBytes("right", { ctrl: false, appCursor: true })).toBe("\x1bOC");
  });

  it("끈적 Ctrl 이 걸린 화살표는 CSI 1;5", () => {
    expect(bandKeyBytes("left", { ctrl: true, appCursor: true })).toBe("\x1b[1;5D");
    expect(bandKeyBytes("down", { ctrl: true, appCursor: false })).toBe("\x1b[1;5B");
  });

  it("모든 띠 키가 빈 글이 아니다", () => {
    for (const k of BAND_KEYS) expect(bandKeyBytes(k, plain).length).toBeGreaterThan(0);
  });
});

describe("ctrlOf — 끈적 Ctrl 을 글자 하나에", () => {
  it("글자 · 대문자 · 기호", () => {
    expect(ctrlOf("c")).toBe("\x03");
    expect(ctrlOf("C")).toBe("\x03");
    expect(ctrlOf("a")).toBe("\x01");
    expect(ctrlOf("z")).toBe("\x1a");
    expect(ctrlOf("[")).toBe("\x1b");
    expect(ctrlOf("\\")).toBe("\x1c");
    expect(ctrlOf(" ")).toBe("\x00");
    expect(ctrlOf("?")).toBe("\x7f");
    expect(ctrlOf("/")).toBe("\x1f");
  });

  it("붙일 수 없으면 null(여러 글자 · 한글 · 숫자 · 제어 문자)", () => {
    expect(ctrlOf("ab")).toBeNull();
    expect(ctrlOf("가")).toBeNull();
    expect(ctrlOf("5")).toBeNull();
    expect(ctrlOf("\r")).toBeNull();
    expect(ctrlOf("")).toBeNull();
  });
});
