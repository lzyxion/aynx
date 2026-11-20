import { beforeEach, expect, it } from "vitest";
import type { DocFilesSeed } from "$lib/doc-files";
import { noteDocSwap, takeDocSwap } from "$lib/doc-swap";

const seed = (dir: string): DocFilesSeed => ({
  key: "local",
  dir,
  query: "",
  active: 0,
  browse: { rows: [], more: 0 },
  browseFor: dir,
  ready: true,
  scan: { state: "idle" },
  scanFor: "",
  scrollTop: 0,
});

beforeEach(() => {
  // 한 칸을 비운다 — 남은 표시는 그 id 로만 꺼낼 수 있다
  noteDocSwap("__reset__");
  takeDocSwap("__reset__");
});

it("표시한 id 로만 한 번 꺼낸다", () => {
  noteDocSwap("a");
  expect(takeDocSwap("b")).toBeNull();
  expect(takeDocSwap("a")).toEqual({ paneId: "a" });
  expect(takeDocSwap("a")).toBeNull();
});

it("같은 id 를 인계 없이 다시 표시하면 실린 파일 칸 인계를 남긴다(switchDocHere → replaceTile)", () => {
  const files = seed("/d");
  noteDocSwap("a", files);
  noteDocSwap("a");
  expect(takeDocSwap("a")).toEqual({ paneId: "a", files });
});

it("한 칸이라 다음 표시가 덮는다 — 꺼낼 사람이 없던 표시(원격 창 요청)가 쌓이지 않는다", () => {
  noteDocSwap("a", seed("/d"));
  noteDocSwap("b");
  expect(takeDocSwap("a")).toBeNull();
  expect(takeDocSwap("b")).toEqual({ paneId: "b" });
});

it("다른 id 의 꺼내기는 표시를 건드리지 않는다", () => {
  noteDocSwap("a");
  takeDocSwap("x");
  expect(takeDocSwap("a")).toEqual({ paneId: "a" });
});
