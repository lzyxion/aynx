import { describe, expect, it } from "vitest";
import {
  autoRefreshOn,
  readAgo,
  DOC_POLL_LOCAL_MS,
  DOC_POLL_REMOTE_MS,
  pollIntervalOf,
  replacePlan,
  shouldPoll,
  stampChanged,
  stuckToBottom,
  type PollGate,
  type Readout,
} from "$lib/doc-refresh";
import { LOCAL_KEY } from "$lib/fs-backend";

const gate = (over: Partial<PollGate> = {}): PollGate => ({
  visible: true,
  online: true,
  sourceGone: false,
  hasFile: true,
  error: false,
  busy: false,
  ...over,
});

const file = (over: Partial<Readout> = {}): Readout => ({
  text: "a\nb\n",
  size: 4,
  truncated: false,
  binary: false,
  lossy: false,
  version: "v1:4",
  ...over,
});

describe("pollIntervalOf", () => {
  it("로컬 1.5 s · 원격 4 s", () => {
    expect(pollIntervalOf(LOCAL_KEY)).toBe(DOC_POLL_LOCAL_MS);
    expect(DOC_POLL_LOCAL_MS).toBe(1500);
    expect(pollIntervalOf("ssh:3")).toBe(DOC_POLL_REMOTE_MS);
    expect(pollIntervalOf("ssh:none")).toBe(4000);
  });
});

describe("shouldPoll", () => {
  it("다 맞으면 묻는다", () => {
    expect(shouldPoll(gate())).toBe(true);
  });

  it("하나라도 어긋나면 건너뛴다 — 안 보임 · 끊김 · 원본 없음 · 읽은 적 없음 · 오류 · 날아가 있음", () => {
    for (const over of [{ visible: false }, { online: false }, { sourceGone: true }, { hasFile: false }, { error: true }, { busy: true }]) {
      expect(shouldPoll(gate(over)), JSON.stringify(over)).toBe(false);
    }
  });

  it("서 있는가(정보 줄)는 박자 사정(보임 · 날아가 있음)을 보지 않는다", () => {
    expect(autoRefreshOn(gate({ visible: false, busy: true }))).toBe(true);
    expect(autoRefreshOn(gate({ error: true }))).toBe(false);
    expect(autoRefreshOn(gate({ online: false }))).toBe(false);
  });
});

describe("stampChanged", () => {
  it("처음은 달라진 것으로 본다", () => {
    expect(stampChanged(null, { size: 1, mtime: 1 })).toBe(true);
  });

  it("크기나 시각 중 하나만 달라도", () => {
    expect(stampChanged({ size: 1, mtime: 10 }, { size: 1, mtime: 10 })).toBe(false);
    expect(stampChanged({ size: 1, mtime: 10 }, { size: 2, mtime: 10 })).toBe(true);
    expect(stampChanged({ size: 1, mtime: 10 }, { size: 1, mtime: 11 })).toBe(true);
  });

  it("시각을 모르면 크기만", () => {
    expect(stampChanged({ size: 1, mtime: null }, { size: 1, mtime: null })).toBe(false);
    expect(stampChanged({ size: 1, mtime: null }, { size: 5, mtime: null })).toBe(true);
  });
});

describe("replacePlan", () => {
  it("처음은 통째로", () => {
    expect(replacePlan(null, file())).toBe("all");
  });

  it("version 이 같으면 아무것도 바꾸지 않는다", () => {
    expect(replacePlan(file(), file({ size: 999 }))).toBe("none");
  });

  it("잘린 파일이 뒤에서 자라면 — 앞 2 MiB 가 같으니 곁 값만", () => {
    const prev = file({ truncated: true, size: 3_000_000, version: "h:3000000" });
    const next = file({ truncated: true, size: 3_100_000, version: "h:3100000" });
    expect(replacePlan(prev, next)).toBe("meta");
  });

  it("이진 파일끼리는 글이 늘 비어 있어 곁 값만", () => {
    expect(replacePlan(file({ binary: true, text: "" }), file({ binary: true, text: "", size: 9, version: "v2" }))).toBe("meta");
  });

  it("글이나 모양이 다르면 통째로", () => {
    expect(replacePlan(file(), file({ text: "a\nb\nc\n", version: "v2" }))).toBe("all");
    expect(replacePlan(file(), file({ lossy: true, version: "v2" }))).toBe("all");
    expect(replacePlan(file({ binary: true, text: "" }), file({ text: "", version: "v2" }))).toBe("all");
  });
});

describe("stuckToBottom", () => {
  it("끝에 닿아 있으면 붙어 있다 (반올림 여유 포함)", () => {
    expect(stuckToBottom(900, 100, 1000)).toBe(true);
    expect(stuckToBottom(897.5, 100, 1000)).toBe(true);
  });

  it("위를 보고 있으면 아니다", () => {
    expect(stuckToBottom(0, 100, 1000)).toBe(false);
    expect(stuckToBottom(800, 100, 1000)).toBe(false);
  });

  it("한 화면에 다 들어가는 글은 붙어 있지 않다 — 자라도 맨 위를 지킨다", () => {
    expect(stuckToBottom(0, 500, 300)).toBe(false);
    expect(stuckToBottom(0, 500, 502)).toBe(false);
  });
});

describe("readAgo — 새로고침 단추 툴팁의 상대 시각", () => {
  it("5초 안은 방금, 그다음 초 · 분 · 시간", () => {
    expect(readAgo(0)).toEqual({ unit: "now", n: 0 });
    expect(readAgo(4999)).toEqual({ unit: "now", n: 0 });
    expect(readAgo(-3000)).toEqual({ unit: "now", n: 0 });
    expect(readAgo(5000)).toEqual({ unit: "secs", n: 5 });
    expect(readAgo(59_999)).toEqual({ unit: "secs", n: 59 });
    expect(readAgo(60_000)).toEqual({ unit: "mins", n: 1 });
    expect(readAgo(3_599_999)).toEqual({ unit: "mins", n: 59 });
    expect(readAgo(7_200_000)).toEqual({ unit: "hours", n: 2 });
  });
});
