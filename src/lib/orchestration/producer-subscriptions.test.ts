import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { Channel, invoke } from "$lib/ipc";
import type { ProducerEvent, ProducerSnapshot } from "./producer-api";

// 실제 상태 모듈/API를 부른다. 반응성 렌더링 대신 구독 수명과 사건 접기를 검사한다.
vi.hoisted(() => { vi.stubGlobal("$state", <T>(value: T) => value); });
vi.mock("$lib/i18n/i18n.svelte.js", () => ({ t: (key: string) => key }));
import { joinProducer, leaveProducer, observeProducer, producerLiveOf, type ProducerTarget } from "$lib/app/producer-chat.svelte.js";

const target: ProducerTarget = { chat: "pc-resub", cli: "claude", model: "opus", effort: "high", studio: "C:/repo", conv: null };
const snapshot = (seq = 0): ProducerSnapshot => ({
  ...target, repo: target.studio, epoch: 3, seq, status: "running", life: "live", ended: null, conversationId: "conv-1", forkFrom: null,
  readOnly: false, queue: { items: [], held: false }, liveTurn: [], pending: [], album: null, wake: null,
});
type Subscription = { subGen: number; snapshot: ProducerSnapshot };
type Sub = { channel: Channel<unknown>; gen: number };
let subs: Sub[] = [];
let current: Sub | null = null;
let seq = 0;

function server(delay?: (sub: Sub) => Promise<Subscription>) {
  subs = []; current = null; seq = 0;
  vi.mocked(invoke).mockImplementation(async (cmd, args) => {
    const a = args as { channel: Channel<unknown>; subGen: number };
    if (cmd === "producer_chat_subscribe") {
      const sub = { channel: a.channel, gen: subs.length + 1 };
      subs.push(sub); current = sub;
      return delay ? delay(sub) : { subGen: sub.gen, snapshot: snapshot(seq) };
    }
    if (cmd === "producer_chat_unsubscribe") {
      if (current?.gen !== a.subGen) return false;
      current = null; return true;
    }
    if (cmd === "producer_chat_attach") return snapshot(seq);
    throw new Error(`unexpected invoke: ${cmd}`);
  });
}
function emit(sub: Sub, ev: ProducerEvent["ev"], n = ++seq) {
  sub.channel.onmessage({ chat: target.chat, epoch: 3, seq: n, ev });
}
afterEach(() => { leaveProducer(target.chat); vi.mocked(invoke).mockReset(); });
afterAll(() => vi.unstubAllGlobals());

describe("프로듀서 재부착 — 새 Channel과 subGen", () => {
  it("떠나도 close/open 없이 같은 채팅을 다시 구독하고 도구·권한·깨움·턴 끝·exited를 받는다", async () => {
    server();
    const release = observeProducer(target);
    await joinProducer(target);
    emit(subs[0], { t: "textDelta", item: "before", text: "이전 창" });
    release();
    const releaseAgain = observeProducer({ ...target, conv: "conv-1" });
    await joinProducer(target);
    expect(subs[1].channel).not.toBe(subs[0].channel);
    expect(producerLiveOf(target.chat)?.subGen).toBe(2);
    expect(current).toBe(subs[1]);
    emit(subs[1], { t: "toolStarted", item: "tool", name: "Read", summary: "", input: {} });
    emit(subs[1], { t: "permission", requestId: "r1", kind: "tool", title: "Read", detail: "outside", toolName: "Read" });
    expect(producerLiveOf(target.chat)?.state.entries.some(e => e.kind === "tool")).toBe(true);
    expect(producerLiveOf(target.chat)?.state.entries.some(e => e.kind === "permission")).toBe(true);
    emit(subs[1], { t: "woken", wake: { wakeId: "w1", runId: "run-1", gen: 1, fromSeq: 1, toSeq: 2, items: [], more: 0, resync: false, retry: false } }, seq);
    expect(producerLiveOf(target.chat)?.wakes.w1?.wakeId).toBe("w1");
    emit(subs[1], { t: "turnEnded", turn: "t1", outcome: "ok", message: null });
    expect(producerLiveOf(target.chat)?.state.status).toBe("ready");
    emit(subs[1], { t: "exited", code: 1, reason: "crashed", why: "crashed" });
    expect(producerLiveOf(target.chat)?.ended).toBe("crashed");
    releaseAgain();
    expect(vi.mocked(invoke).mock.calls.some(([c]) => c === "producer_chat_open" || c === "producer_chat_close")).toBe(false);
  });

  it("새 구독과 seq가 같아도 옛 Channel의 늦은 사건은 새 사본에 섞이지 않는다", async () => {
    server();
    await joinProducer(target);
    const old = subs[0];
    leaveProducer(target.chat);
    await joinProducer(target);
    emit(old, { t: "textDelta", item: "stale", text: "옛 통로" }, 1);
    emit(old, { t: "woken", wake: { wakeId: "stale", runId: "run-1", gen: 1, fromSeq: 1, toSeq: 2, items: [], more: 0, resync: false, retry: false } }, 0);
    expect(producerLiveOf(target.chat)?.seq).toBe(0);
    expect(producerLiveOf(target.chat)?.wakes).toEqual({});
    emit(subs[1], { t: "textDelta", item: "fresh", text: "새 통로" }, 1);
    expect(producerLiveOf(target.chat)?.state.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "text", text: "새 통로" })]));
  });

  it("이전 subscribe의 늦은 응답은 그 subGen만 풀며 새 구독 대기 중 사건을 보존한다", async () => {
    const replies: ((r: Subscription) => void)[] = [];
    server(() => new Promise(resolve => replies.push(resolve)));
    const first = joinProducer(target);
    leaveProducer(target.chat);
    const second = joinProducer(target);
    emit(subs[0], { t: "textDelta", item: "stale", text: "버림" }, 1);
    emit(subs[1], { t: "textDelta", item: "fresh", text: "보존" }, 1);
    replies[0]({ subGen: 1, snapshot: snapshot() }); await first;
    expect(current).toBe(subs[1]);
    replies[1]({ subGen: 2, snapshot: snapshot() }); await second;
    expect(producerLiveOf(target.chat)?.subGen).toBe(2);
    expect(producerLiveOf(target.chat)?.state.entries).toEqual(expect.arrayContaining([expect.objectContaining({ kind: "text", text: "보존" })]));
    expect(producerLiveOf(target.chat)?.state.entries).not.toEqual(expect.arrayContaining([expect.objectContaining({ text: "버림" })]));
  });
});
