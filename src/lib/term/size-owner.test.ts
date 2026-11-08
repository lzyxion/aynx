import { describe, expect, it } from "vitest";
import { claimsOwnership, ownerFromEvent, ownerFromReply, shouldSendInput, viewSize } from "./size-owner";
import { classifyInput } from "./input-source";

// 원격 웹 R2-B — 크기 주인만 터미널 질의에 답하고, 주인이 아니면 주인의 크기로 그린다. 사람의 입력은 결코 삼키지 않는다.

const lease = { stream: "s1", sessionEpoch: 3, leaseEpoch: 7 };

describe("ownerFromEvent", () => {
  it("reads only events of this session", () => {
    expect(ownerFromEvent(lease, { stream: "s2", sessionEpoch: 3, leaseEpoch: 7 })).toBeNull();
    expect(ownerFromEvent(lease, { stream: "s1", sessionEpoch: 2, leaseEpoch: 7 })).toBeNull();
    expect(ownerFromEvent(null, { stream: "s1", sessionEpoch: 3, leaseEpoch: 7 })).toBeNull();
    expect(ownerFromEvent(lease, null)).toBeNull();
  });

  it("knows whether this lease owns the size and the owner's size", () => {
    expect(ownerFromEvent(lease, { stream: "s1", sessionEpoch: 3, leaseEpoch: 7, cols: 80, rows: 24 })).toEqual({
      owner: true,
      size: { cols: 80, rows: 24 },
    });
    expect(ownerFromEvent(lease, { stream: "s1", sessionEpoch: 3, leaseEpoch: 9, primary: false, cols: 120, rows: 40 })).toEqual({
      owner: false,
      size: { cols: 120, rows: 40 },
      primary: false,
    });
    // 주인 없음(서버가 답한다) — 이 쪽은 주인이 아니다 · 크기를 모르면 null(옛 서버 포함).
    expect(ownerFromEvent(lease, { stream: "s1", sessionEpoch: 3, leaseEpoch: null })).toEqual({ owner: false, size: null });
    expect(ownerFromEvent(lease, { stream: "s1", sessionEpoch: 3, leaseEpoch: 9, cols: 0, rows: 5 })?.size).toBeNull();
  });
});

describe("ownerFromReply", () => {
  it("treats an old reply without the field as owner", () => {
    expect(ownerFromReply({})).toEqual({ owner: true, size: null });
    expect(ownerFromReply({ sizeOwner: false, ownerCols: 100, ownerRows: 30 })).toEqual({ owner: false, size: { cols: 100, rows: 30 } });
    expect(ownerFromReply({ sizeOwner: true })).toEqual({ owner: true, size: null });
    expect(ownerFromReply({ sizeOwner: false, ownerCols: 80, ownerRows: 24, ownerPrimary: true })).toEqual({
      owner: false,
      size: { cols: 80, rows: 24 },
      primary: true,
    });
  });
});

describe("shouldSendInput", () => {
  it("drops terminal replies when not the owner, never human input", () => {
    const dsr = "\x1b[12;40R";
    const da = "\x1b[?62;22c";
    const osc = "\x1b]11;rgb:0000/0000/0000\x1b\\";
    for (const reply of [dsr, da, osc]) {
      const src = classifyInput(reply, { pasting: false, keyEvent: false });
      expect(src).toBe("protocol");
      expect(shouldSendInput(src, false)).toBe(false);
      expect(shouldSendInput(src, true)).toBe(true);
    }
    // 같은 바이트라도 키 이벤트 중이면 사람 것 — Ctrl+F3 = ESC[1;5R.
    expect(shouldSendInput(classifyInput("\x1b[1;5R", { pasting: false, keyEvent: true }), false)).toBe(true);
    for (const typed of ["ls\r", "가", "\x03", "\x1b[A"]) {
      expect(shouldSendInput(classifyInput(typed, { pasting: false, keyEvent: false }), false)).toBe(true);
    }
    expect(shouldSendInput(classifyInput("\x1b[12;40R", { pasting: true, keyEvent: false }), false)).toBe(true);
  });

  it("human input claims ownership when eligible", () => {
    expect(claimsOwnership("keyboard", true)).toBe(true);
    expect(claimsOwnership("paste", true)).toBe(true);
    expect(claimsOwnership("protocol", true)).toBe(false);
    expect(claimsOwnership("keyboard", false)).toBe(false);
  });
});

describe("viewSize", () => {
  const fitted = { cols: 90, rows: 25 };
  it("draws at the owner's size when not the owner", () => {
    expect(viewSize({ owner: false, size: { cols: 120, rows: 40 } }, fitted)).toEqual({ cols: 120, rows: 40 });
    expect(viewSize({ owner: true, size: null }, fitted)).toEqual(fitted);
    expect(viewSize({ owner: false, size: null }, fitted)).toEqual(fitted);
    expect(viewSize({ owner: true, size: null }, null)).toBeNull();
  });
});
