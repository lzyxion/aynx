// 오케스트레이션 2단계 단계 5 — [오케스트레이션으로 이어 가기] = 갈라 오기 · 여러 창 · 원격(aynx-notes
// docs/log/2026-10-30-orchestration-structured-producer.md 5-3 · 7절).
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { listPanes, newProducerPane, newRunPane, adoptTab, type PaneSpec, type TabSpec } from "$lib/session";
import { deserialize, serialize } from "$lib/tabs";
import { buildSnapshot, parseSnapshot } from "$lib/mirror/snapshot";
import { sideChatForkSource } from "$lib/side-chat";
import { newProducerChatId, orchRoot, orchShape, parseProducerSpec, producerLeafOf, saveProducerSpec } from "./orch-tab";
import { leafGoneAction, producerOpenMode, producerPhase } from "./model/producer";

const SRC = "0f0f0f0f-1111-4222-8333-444444444444";

function forkLeaf(extra: Partial<NonNullable<PaneSpec["producer"]>> = {}): PaneSpec {
  return newProducerPane({
    chatId: newProducerChatId(),
    cli: "codex",
    model: "",
    effort: "",
    studio: "C:/repo",
    opened: true,
    forkFrom: { agent: "codex", conv: SRC },
    ...extra,
  });
}

describe("갈라 오기 — 원본 · 여는 뜻", () => {
  it("원본은 로컬 타일의 대화 연결(claude · codex)만 — 주 창이 아니어도 된다(보조 창)", () => {
    expect(sideChatForkSource("local", true, { agent: "codex", id: SRC.toUpperCase() })).toEqual({ agent: "codex", conv: SRC });
    expect(sideChatForkSource("local", true, { agent: "gemini", id: SRC })).toBeNull();
    expect(sideChatForkSource("ssh", true, { agent: "claude", id: SRC })).toBeNull();
    expect(sideChatForkSource("local", true, { agent: "claude", id: "../x" })).toBeNull();
    expect(sideChatForkSource("local", true, null)).toBeNull();
  });

  it("여는 뜻 — 앨범 대화 재개와 사람이 연 이어받기만 허용", () => {
    expect(producerOpenMode({ conv: "c-1" })).toEqual({ kind: "resume", conv: "c-1" });
    expect(producerOpenMode({ conv: null, adoptRun: "run-1" })).toEqual({ kind: "adopt", run: "run-1" });
    expect(() => producerOpenMode({ conv: null })).toThrow();
  });

  it("갈라 온 잎은 연 채팅(준비 중) — 홈 모양의 탭 왼쪽 · 원본은 주소에만(토큰 · 경로 없음)", () => {
    const p = forkLeaf();
    const tab: TabSpec = { id: "t1", title: "새 앨범", root: orchRoot(p, newRunPane()), orch: { view: "new" } };
    expect(producerPhase(p.producer)).toBe("chat");
    expect(orchShape(tab)).toBe("preparing");
    expect(producerLeafOf(tab)?.producer?.forkFrom).toEqual({ agent: "codex", conv: SRC });
  });
});

describe("주소의 forkFrom — 저장 · 이관 · 거울", () => {
  it("파싱 — agent 는 claude · codex 만 · 대화 id 모양 · 틀리면 칸을 버린다(잎은 남는다)", () => {
    const id = newProducerChatId();
    const base = { chatId: id, cli: "codex", model: "", effort: "", studio: "C:/r", opened: true };
    expect(parseProducerSpec({ ...base, forkFrom: { agent: "codex", conv: SRC } })?.forkFrom).toEqual({ agent: "codex", conv: SRC });
    expect(parseProducerSpec({ ...base, forkFrom: { agent: "gemini", conv: SRC } })?.forkFrom).toBeUndefined();
    expect(parseProducerSpec({ ...base, forkFrom: { agent: "codex", conv: "../../x" } })?.forkFrom).toBeUndefined();
    expect(parseProducerSpec({ ...base, forkFrom: [SRC] })?.forkFrom).toBeUndefined();
    expect(parseProducerSpec({ ...base, forkFrom: { agent: "codex", conv: SRC, path: "C:/x" } })?.forkFrom).toEqual({ agent: "codex", conv: SRC });
    expect(Object.keys(saveProducerSpec({ ...base, conv: "c-12345678", forkFrom: { agent: "codex", conv: SRC } }))).toEqual([
      "chatId",
      "cli",
      "model",
      "effort",
      "studio",
      "opened",
      "conv",
      "forkFrom",
    ]);
  });

  it("저장 왕복 · 다른 창으로 이관 · 원격 거울 — 주소가 따라간다(새 창이 같은 채팅을 다시 구독 · 다시 열 때 fork)", () => {
    const p = forkLeaf();
    const a: TabSpec = { id: "t2", title: "새 앨범", root: orchRoot(p, newRunPane()), orch: { view: "new" } };
    const back = deserialize(JSON.parse(JSON.stringify(serialize([a], a.id))));
    expect(producerLeafOf(back.tabs[0])?.producer).toEqual(p.producer);
    const moved = adoptTab(JSON.parse(JSON.stringify(a)) as TabSpec, () => undefined);
    expect(producerLeafOf(moved)?.producer?.forkFrom).toEqual(p.producer?.forkFrom);
    expect(producerLeafOf(moved)?.producer?.chatId).toBe(p.producer?.chatId);
    const snap = buildSnapshot({ source: "home", workspace: { id: "w1", name: "W" }, tabs: [{ ...a, workspaceId: "w1" }], activeTabId: a.id, focusOf: () => null });
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
    const mp = parsed ? listPanes(parsed.tabs[0].root).find((x) => x.kind === "producer") : null;
    expect(mp?.producer?.chatId).toBe(p.producer?.chatId);
    expect(JSON.stringify(snap)).not.toMatch(/token/i);
  });
});

describe("잎이 창을 떠날 때 — 구독 갈래(여러 창 · 원격)", () => {
  it("이 창에 아직 있으면 그대로 · 이관 · 원격 · 집 PC 탭 닫기는 구독만 푼다", () => {
    expect(leafGoneAction({ remote: false, handoff: false, stillHere: true })).toBe("keep");
    expect(leafGoneAction({ remote: true, handoff: false, stillHere: true })).toBe("keep");
    expect(leafGoneAction({ remote: false, handoff: true, stillHere: false })).toBe("leave");
    expect(leafGoneAction({ remote: true, handoff: false, stillHere: false })).toBe("leave");
    expect(leafGoneAction({ remote: true, handoff: true, stillHere: false })).toBe("leave");
    expect(leafGoneAction({ remote: false, handoff: false, stillHere: false })).toBe("leave");
  });
  it("잎의 정리는 구독 관찰만 해제하고 서버 close를 부르지 않는다", () => {
    const leaf = readFileSync(fileURLToPath(new URL("./player/ProducerLeaf.svelte", import.meta.url)), "utf8");
    expect(leaf).toContain("return untrack(() => observeProducer(tg))");
    expect(leaf).not.toContain("closeProducerLive");
    expect(leaf).not.toContain("isHandoff");
  });
});
