import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";

// 실제 주입 스텁을 실행한다. Tauri처럼 Channel마다 index 0부터 순서대로만 전달한다.
function harness() {
  const source = readFileSync(new URL("../../../scripts/dev/orch-tab-harness.mjs", import.meta.url), "utf8");
  const stub = source.slice(source.indexOf("  window.__pcState ="), source.indexOf("  window.__feed ="));
  const window = {} as {
    __pc: (cmd: string, args: Record<string, unknown>) => Promise<unknown>;
    __pcEmit: (chat: string, ev: { t: string; [key: string]: unknown }) => string;
    __pcState: { seq: Record<string, number> };
    __details: Record<string, { repo: string }>;
  };
  const cbs = new Map<number, (raw: { index: number; message: unknown }) => void>();
  runInNewContext(stub, { window, cbs, answers: {}, sessionStorage: { getItem: () => null } });
  const received: unknown[][] = [];
  function channel() {
    const id = received.length;
    const items: unknown[] = []; received.push(items);
    let next = 0;
    const pending = new Map<number, unknown>();
    cbs.set(id, raw => {
      pending.set(raw.index, raw.message);
      while (pending.has(next)) { items.push(pending.get(next)); pending.delete(next++); }
    });
    return { id, items };
  }
  return { window, channel };
}

it("하네스 재구독: 새 Channel은 index 0, 사건 seq는 연속, 늦은 unsubscribe는 새 subGen 보존", async () => {
  const { window: w, channel } = harness();
  const chat = "pc-harness";
  w.__details = { "run-harness": { repo: "C:/repo" } };
  await w.__pc("producer_chat_open", { chat, cli: "claude", model: "opus", mode: { kind: "adopt", run: "run-harness" } });
  const old = channel();
  const first = await w.__pc("producer_chat_subscribe", { chat, channel: old }) as { subGen: number };
  w.__pcEmit(chat, { t: "turnStarted", turn: "t1" });
  w.__pcEmit(chat, { t: "textDelta", item: "a", text: "before" });
  expect(old.items).toHaveLength(2);
  await w.__pc("producer_chat_set_model", { chat, model: "sonnet" });
  await w.__pc("producer_chat_set_effort", { chat, effort: "low" });
  const fresh = channel();
  const second = await w.__pc("producer_chat_subscribe", { chat, channel: fresh }) as { subGen: number };
  expect(second.subGen).toBeGreaterThan(first.subGen);
  expect(second).toEqual(expect.objectContaining({ snapshot: expect.objectContaining({ model: "sonnet", effort: "low" }) }));
  expect(await w.__pc("producer_chat_unsubscribe", { chat, subGen: first.subGen })).toBe(false);
  w.__pcEmit(chat, { t: "textDelta", item: "b", text: "after" });
  expect(fresh.items).toEqual([expect.objectContaining({ seq: 3, ev: expect.objectContaining({ text: "after" }) })]);
  expect(old.items).toHaveLength(2);
  expect(await w.__pc("producer_chat_unsubscribe", { chat, subGen: second.subGen })).toBe(true);
  expect(w.__pcEmit(chat, { t: "turnEnded" })).toBe("no channel");
});
