// DOM 이 움직여도 첫 client rect 로 판정한다 — 순수 함수에는 현재 DOM 이 들어오지 않는다.
import { describe, expect, it } from "vitest";
import { zoneOf } from "$lib/layout";
import { paneAtSnapshot, type DropSnapshotItem } from "./drop-snapshot";

const rect = (left: number, top: number, width: number, height: number): DOMRect => ({
  x: left, y: top, left, top, width, height, right: left + width, bottom: top + height,
  toJSON() { return { left, top, width, height }; },
});
const snapshot: DropSnapshotItem[] = [
  { id: "a", tabId: "tab-1", rect: rect(100, 60, 300, 400) },
  { id: "b", tabId: "tab-1", rect: rect(408, 60, 500, 196) },
  { id: "c", tabId: "tab-1", rect: rect(408, 264, 500, 196) },
];

describe("paneAtSnapshot", () => {
  it("client 좌표로 타일·탭·원래 상자를 돌려준다", () => {
    expect(paneAtSnapshot(snapshot, 110, 70)).toBe(snapshot[0]);
    expect(paneAtSnapshot(snapshot, 700, 200)).toBe(snapshot[1]);
    expect(paneAtSnapshot(snapshot, 700, 300)).toBe(snapshot[2]);
  });

  it("빈 목록·거터·캔버스 밖은 null", () => {
    expect(paneAtSnapshot([], 110, 70)).toBeNull();
    for (const [x, y] of [[404, 100], [500, 260], [99, 70], [920, 70], [110, 59], [110, 470]]) {
      expect(paneAtSnapshot(snapshot, x, y)).toBeNull();
    }
  });

  it("경계는 왼쪽·위 포함, 오른쪽·아래 제외", () => {
    expect(paneAtSnapshot(snapshot, 100, 60)).toBe(snapshot[0]);
    expect(paneAtSnapshot(snapshot, 400, 60)).toBeNull();
    expect(paneAtSnapshot(snapshot, 100, 460)).toBeNull();
    expect(paneAtSnapshot(snapshot, 408, 264)).toBe(snapshot[2]);
  });

  it("숨은 크기 0 상자는 후보가 아니다", () => {
    const hidden = { id: "hidden", tabId: "tab-hidden", rect: rect(100, 60, 0, 400) };
    expect(paneAtSnapshot([hidden, ...snapshot], 100, 60)).toBe(snapshot[0]);
  });

  it("고스트·접힌 상자·다른 타일의 현재 DOM 위에서도 시작 상자와 4분면이 유지된다", () => {
    const at = paneAtSnapshot(snapshot, 380, 250)!;
    expect(at.id).toBe("a");
    expect(zoneOf(at.rect, 380, 250)).toBe("right");
    // A 를 접어 폭 146으로 줄이고, 고스트 자리에 다른 DOM 이 들어온 상황이다.
    const moved = [
      { ...snapshot[0], rect: rect(100, 60, 146, 400) },
      { id: "ghost", tabId: "tab-1", rect: rect(254, 60, 146, 400) },
    ];
    expect(paneAtSnapshot(moved, 380, 250)?.id).toBe("ghost");
    expect(paneAtSnapshot(snapshot, 380, 250)).toBe(at);
    expect(zoneOf(at.rect, 380, 250)).toBe("right");
  });

  it("스냅숏 항목·좌표는 바꾸지 않는다", () => {
    const before = JSON.stringify(snapshot);
    snapshot.forEach((item) => { Object.freeze(item.rect); Object.freeze(item); });
    Object.freeze(snapshot);
    paneAtSnapshot(snapshot, 700, 300);
    expect(JSON.stringify(snapshot)).toBe(before);
  });
});
