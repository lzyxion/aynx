import { describe, expect, it } from "vitest";
import { keepsOnFailure, keepsPicture, keepsWhileReading, pictureVisible } from "./picture-state";

const A = "C:\\pics\\a.png";
const B = "C:\\pics\\b.png";

describe("keepsPicture — 같은 그림을 다시 읽는 중인가", () => {
  it("같은 경로(자동 다시 읽기 · [다시 읽기] · 재연결)", () => {
    expect(keepsPicture(A, A)).toBe(true);
  });
  it("다른 경로 · 그린 그림 없음", () => {
    expect(keepsPicture(A, B)).toBe(false);
    expect(keepsPicture("", "")).toBe(false);
    expect(keepsPicture("", A)).toBe(false);
  });
});

describe("keepsWhileReading — 받는 동안 이전 그림을 남기는가", () => {
  it("다른 그림의 direct 길은 남긴다(다 풀리면 한 번에 바꾼다 — 깜빡이지 않게)", () => {
    expect(keepsWhileReading(A, B, "direct")).toBe(true);
  });
  it("다른 그림의 진행 길은 그 순간 버린다(진행 화면 밑에 옛 그림이 비치지 않게)", () => {
    expect(keepsWhileReading(A, B, "progress")).toBe(false);
  });
  it("같은 그림은 어느 길이든 남긴다", () => {
    expect(keepsWhileReading(A, A, "direct")).toBe(true);
    expect(keepsWhileReading(A, A, "progress")).toBe(true);
  });
  it("그린 그림이 없으면 남길 것도 없다", () => {
    expect(keepsWhileReading("", A, "direct")).toBe(false);
  });
});

describe("keepsOnFailure — 실패 · 취소 · 끊김에 남기는가", () => {
  it("다른 그림이면 버린다(direct 길에서 남겨 둔 옛 그림도)", () => {
    expect(keepsOnFailure(A, B)).toBe(false);
  });
  it("같은 그림이면 남긴다(끊긴 동안 흐리게)", () => {
    expect(keepsOnFailure(A, A)).toBe(true);
  });
});

describe("pictureVisible", () => {
  it("바이트가 없으면 어느 화면에서도 그리지 않는다", () => {
    for (const p of ["loading", "progress", "ready", "cancelled", "error"] as const) expect(pictureVisible(p, false)).toBe(false);
  });
  it("파일 없음 · 그리지 못함에는 그리지 않는다", () => {
    expect(pictureVisible("missing", true)).toBe(false);
    expect(pictureVisible("broken", true)).toBe(false);
  });
  it("읽는 중(direct 길의 다른 그림 · 같은 그림 다시 읽기)에는 그림이 남는다", () => {
    expect(pictureVisible("loading", true)).toBe(true);
    expect(pictureVisible("progress", true)).toBe(true);
    expect(pictureVisible("cancelled", true)).toBe(true);
    expect(pictureVisible("ready", true)).toBe(true);
  });
});
