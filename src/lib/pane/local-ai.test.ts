import { afterEach, describe, expect, it, vi } from "vitest";

// 원격 창 여부 · 마스터 재확인을 시험이 정한다(`$lib/ipc` 는 모듈을 읽는 순간 `isRemote` 를 정하므로 게터로 바꿔 끼운다)
const ipc = vi.hoisted(() => ({ remote: false, answer: true, asked: [] as string[] }));
vi.mock("$lib/ipc", () => ({
  get isRemote() {
    return ipc.remote;
  },
  confirmRemoteMaster: async (what: string) => {
    ipc.asked.push(what);
    return ipc.answer;
  },
}));

import { setLocalAiRead, toggleLocalAiRead } from "./local-ai";
import { isShared, setShared } from "$lib/ai.svelte.js";

describe("로컬 타일의 'AI 읽기 허용'(11-18 — 체크 줄 · 눈 칩이 함께 부르는 몸통)", () => {
  afterEach(() => {
    setShared("lp1", false);
    ipc.remote = false;
    ipc.answer = true;
    ipc.asked = [];
  });

  it("메인 PC 창 — 묻지 않고 켜고 끈다 · 뒤집기는 체크 줄의 몸짓", () => {
    setLocalAiRead("lp1", true);
    expect(isShared("lp1")).toBe(true);
    setLocalAiRead("lp1", false);
    expect(isShared("lp1")).toBe(false);
    toggleLocalAiRead("lp1");
    expect(isShared("lp1")).toBe(true);
    toggleLocalAiRead("lp1");
    expect(isShared("lp1")).toBe(false);
    expect(ipc.asked).toEqual([]);
  });

  it("원격 창에서 켤 때는 마스터를 다시 확인한다(R1a-4) — 통과해야 켜지고 · 끄기는 묻지 않는다", async () => {
    ipc.remote = true;
    ipc.answer = false;
    toggleLocalAiRead("lp1");
    await vi.waitFor(() => expect(ipc.asked).toEqual(["set_session_ai_read"]));
    await Promise.resolve();
    expect(isShared("lp1")).toBe(false);

    ipc.answer = true;
    setLocalAiRead("lp1", true);
    await vi.waitFor(() => expect(isShared("lp1")).toBe(true));
    expect(ipc.asked).toEqual(["set_session_ai_read", "set_session_ai_read"]);

    // 끄기(눈 칩 · 체크 줄) — 묻지 않고 곧바로
    setLocalAiRead("lp1", false);
    expect(isShared("lp1")).toBe(false);
    expect(ipc.asked.length).toBe(2);
  });

  it("이미 그 값이면 아무 일도 없다(원격 창에서도 묻지 않는다)", () => {
    ipc.remote = true;
    setLocalAiRead("lp1", false);
    expect(ipc.asked).toEqual([]);
  });
});
