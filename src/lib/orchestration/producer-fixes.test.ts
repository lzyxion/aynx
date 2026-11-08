// 실기(진짜 Claude 로 앨범 하나 끝까지)에서 나온 프로듀서 채팅 버그 — 18 · 33 · 34.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followFinale, historyNotYet, producerSendClosed } from "./model/producer";
import { pillToolOpen } from "$lib/transcript";

const tool = (error: boolean) => ({
  name: "mcp__aynx-sessions__spawn_worker",
  summary: "",
  input: "{}",
  inputTruncated: false,
  output: "role-read-only: …",
  outputTruncated: false,
  error,
});

describe("끝난 앨범 · 끝낸 프로듀서는 입력 칸을 끈다(실기 34)", () => {
  it("앨범 끝은 서버 판정 · 끝 사건 · 표에 없는 이유 어느 쪽이든", () => {
    expect(producerSendClosed({ albumEnded: true, exitWhy: null, gone: null })).toBe("albumEnded");
    expect(producerSendClosed({ albumEnded: false, exitWhy: "album-ended", gone: null })).toBe("albumEnded");
    expect(producerSendClosed({ albumEnded: false, exitWhy: null, gone: "album-ended" })).toBe("albumEnded");
  });
  it("사람이 끝낸 채팅은 닫힘 · 다시 띄우는 끝(충돌 · 서버 재시작)과 산 채팅은 칸을 둔다", () => {
    expect(producerSendClosed({ albumEnded: false, exitWhy: null, gone: "closed" })).toBe("closed");
    expect(producerSendClosed({ albumEnded: false, exitWhy: null, gone: "close-all" })).toBe("closed");
    expect(producerSendClosed({ albumEnded: false, exitWhy: "crashed", gone: null })).toBeNull();
    expect(producerSendClosed({ albumEnded: false, exitWhy: null, gone: "server-restarted" })).toBeNull();
    expect(producerSendClosed({ albumEnded: false, exitWhy: null, gone: null })).toBeNull();
  });
});

describe("앨범 시작 직후 기록이 아직 없다(실기 18)", () => {
  it("첫 턴이 끝나기 전의 산 채팅만 실패를 '아직 기록 없음' 으로 본다 — 대화 id 는 첫 턴 전에도 있다", () => {
    expect(historyNotYet({ status: "starting", ended: 0 })).toBe(true);
    expect(historyNotYet({ status: "ready", ended: 0 })).toBe(true);
    expect(historyNotYet({ status: "running", ended: 0 })).toBe(true);
    expect(historyNotYet({ status: "running", ended: 1 })).toBe(false);
    expect(historyNotYet({ status: "ready", ended: 1 })).toBe(false);
    expect(historyNotYet({ status: "stopped", ended: 0 })).toBe(false);
    expect(historyNotYet(null)).toBe(false);
  });
  it("잎은 대화 id 가 서도(target 이 새로 지어져도) 떠났다 다시 붙지 않는다 — 채팅 id 에만 건다", () => {
    const leaf = readFileSync(fileURLToPath(new URL("./player/ProducerLeaf.svelte", import.meta.url)), "utf8");
    expect(leaf).toMatch(/const chatId = \$derived\(target\?\.chat \?\? null\)/);
    expect(leaf).toMatch(/if \(!visible \|\| !chatId\) return;\s*const tg = untrack\(\(\) => target\);/);
  });
});

describe("마무리 카드는 앨범이 끝난 뒤의 최종 요약까지 따라간다", () => {
  beforeEach(() => void vi.useFakeTimers());
  afterEach(() => void vi.useRealTimers());

  /** 차례대로 답하는 가짜 — 마지막 답을 되풀이한다 */
  const seq = <T,>(xs: T[]) => {
    let i = 0;
    return vi.fn(async () => xs[Math.min(i++, xs.length - 1)]);
  };

  it("열려 있는 동안 다시 읽고, 닫힌 뒤 한 번 더 읽고 멈춘다", async () => {
    const isOpen = seq([true, true, false]);
    const read = seq(["중간 말", "중간 말", "최종 요약"]);
    const shown: string[] = [];
    followFinale({ isOpen, read, show: (v) => shown.push(v), everyMs: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(3);
    expect(shown.at(-1)).toBe("최종 요약");
  });

  it("이미 닫힌 채팅은 한 번만 읽는다 · 상태를 못 읽어도 닫힘으로 본다", async () => {
    const closed = seq(["끝"]);
    followFinale({ isOpen: async () => false, read: closed, show: () => {}, everyMs: 100 });
    const broken = seq(["끝"]);
    followFinale({ isOpen: () => Promise.reject(new Error("x")), read: broken, show: () => {}, everyMs: 100 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(broken).toHaveBeenCalledTimes(1);
  });

  it("읽기 실패 · 글 없음은 보이던 글을 지우지 않는다 · 멈춘 뒤에는 읽지 않는다", async () => {
    const read = vi.fn<() => Promise<string | null>>().mockResolvedValueOnce("앞 말").mockRejectedValueOnce(new Error("x")).mockResolvedValue(null);
    const shown: string[] = [];
    const stop = followFinale({ isOpen: async () => true, read, show: (v) => shown.push(v), everyMs: 100 });
    await vi.advanceTimersByTimeAsync(250);
    expect(shown).toEqual(["앞 말"]);
    stop();
    const n = read.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(read).toHaveBeenCalledTimes(n);
  });
});

describe("실패한 도구 알약은 까닭이 보이게 펼친다(실기 33)", () => {
  it("알약 안 실패 줄은 기본으로 열리고 누르면 접힌다", () => {
    expect(pillToolOpen(tool(true), true, false)).toBe(true);
    expect(pillToolOpen(tool(true), true, true)).toBe(false);
  });
  it("성공한 줄 · 알약 밖(사이드 채팅 · 기록 보기)은 누른 대로", () => {
    expect(pillToolOpen(tool(false), true, false)).toBe(false);
    expect(pillToolOpen(tool(true), false, false)).toBe(false);
    expect(pillToolOpen(tool(true), false, true)).toBe(true);
    expect(pillToolOpen(null, true, false)).toBe(false);
  });
});
