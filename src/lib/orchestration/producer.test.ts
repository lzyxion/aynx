// 오케스트레이션 2단계 단계 3 — 프로듀서 채팅(aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md 4-2 · 5-1 · 5-2 · 2-4).
import { describe, expect, it } from "vitest";
import { listPanes, newProducerPane, newRunPane, adoptTab, type PaneSpec, type TabSpec } from "$lib/session";
import { deserialize, serialize } from "$lib/tabs";
import { buildSnapshot, parseSnapshot } from "$lib/mirror/snapshot";
import { mirrorTileMode } from "$lib/mirror/tile-policy";
import {
  findHomeTab,
  newProducerChatId,
  orchRoot,
  orchShape,
  parseProducerSpec,
  producerChatIdOk,
  producerLeafOf,
  saveProducerSpec,
  tabOfProducerChat,
} from "./orch-tab";
import {
  adoptKeepsPause,
  codeModeTools,
  goneReadOnly,
  groupToolPills,
  producerActivity,
  producerPhase,
  queueRows,
  queueSummary,
  restartableWhy,
  toolBaseName,
  toolPillLabel,
} from "./model/producer";
import { continueKind } from "./model/library";
import { isProducerEvent } from "./producer-api";

let seq = 0;
function tab(root: TabSpec["root"], orch?: TabSpec["orch"]): TabSpec {
  seq += 1;
  return { id: `t${seq}`, title: `탭 ${seq}`, root, ...(orch ? { orch } : {}) };
}
function leaf(opened = false, extra: Partial<NonNullable<PaneSpec["producer"]>> = {}): PaneSpec {
  return newProducerPane({ chatId: newProducerChatId(), cli: "claude", model: "opus", effort: "high", studio: "C:/repo", ...(opened ? { opened } : {}), ...extra });
}

describe("프로듀서 잎 — 탭 모양 · 홈 → 채팅 → 앨범", () => {
  it("홈부터 두 잎 — 안 연 잎은 홈 · 연 잎은 준비 중 · runId 가 서면 앨범(같은 탭)", () => {
    const p = leaf();
    const h = tab(orchRoot(p, newRunPane()), { view: "new" });
    expect(orchShape(h)).toBe("preparing");
    expect(listPanes(h.root).map((x) => x.kind)).toEqual(["producer", "run"]);
    expect(findHomeTab([h])).toBeNull();
    // 첫 보내기 — 잎의 주소에 opened
    p.producer = { ...p.producer!, opened: true };
    expect(orchShape(h)).toBe("preparing");
    expect(findHomeTab([h])).toBeNull();
    // start_run → 보드 배치 {runId, chat} 이 이 탭을 고른다(mark)
    expect(tabOfProducerChat([h], p.producer.chatId)).toBe(h);
    h.orch = { view: "album", runId: "run-1" };
    expect(orchShape(h)).toBe("album");
    expect(producerLeafOf(h)?.producer?.chatId).toBe(p.producer.chatId);
  });

  it("잎의 갈래 — opened 이면 채팅, 아니면 새 앨범 칸", () => {
    expect(producerPhase(null)).toBe("draft");
    expect(producerPhase({})).toBe("draft");
    expect(producerPhase({ opened: true })).toBe("chat");
  });


  it("주소 모양 — 채팅 id 가 틀리면 버린다 · 낱말 칸은 비운다 · 키 순서 고정", () => {
    const id = newProducerChatId();
    expect(producerChatIdOk(id)).toBe(true);
    expect(producerChatIdOk("sc-1")).toBe(false);
    expect(parseProducerSpec({ chatId: "pc-../x" })).toBeNull();
    expect(parseProducerSpec({ chatId: id, cli: "claude", model: "a b", effort: "high", studio: "C:/r", opened: true, conv: "x" })).toEqual({
      chatId: id,
      cli: "claude",
      model: "",
      effort: "high",
      studio: "C:/r",
      opened: true,
    });
    expect(Object.keys(saveProducerSpec({ studio: "s", chatId: id, effort: "", model: "", cli: "codex", conv: "0199aabb-ccdd" }))).toEqual([
      "chatId",
      "cli",
      "model",
      "effort",
      "studio",
      "conv",
    ]);
  });

  it("저장 왕복 · 창 이관 · 원격 거울에 잎의 주소가 따라간다(토큰 없음)", () => {
    const p = leaf(true, { conv: "0199aabb-ccdd-eeff" });
    const a = tab(orchRoot(p, newRunPane("run-3")), { view: "album", runId: "run-3" });
    const back = deserialize(JSON.parse(JSON.stringify(serialize([a], a.id))));
    const got = producerLeafOf(back.tabs[0]);
    expect(got?.producer).toEqual(p.producer);
    expect(orchShape(back.tabs[0])).toBe("album");
    const moved = adoptTab(JSON.parse(JSON.stringify(a)) as TabSpec, () => undefined);
    expect(producerLeafOf(moved)?.producer?.chatId).toBe(p.producer?.chatId);
    const snap = buildSnapshot({ source: "home", workspace: { id: "w1", name: "W" }, tabs: [{ ...a, workspaceId: "w1" }], activeTabId: a.id, focusOf: () => null });
    const parsed = parseSnapshot(JSON.parse(JSON.stringify(snap)));
    const mp = parsed ? listPanes(parsed.tabs[0].root).find((x) => x.kind === "producer") : null;
    expect(mp?.producer?.chatId).toBe(p.producer?.chatId);
    expect(JSON.stringify(snap)).not.toMatch(/token/i);
    expect(mirrorTileMode("producer")).toBe("render");
  });
});

describe("도구 알약", () => {
  it("서버 접두를 뗀다 — Claude mcp__서버__도구 · Codex 서버.도구 · 그 밖은 그대로", () => {
    expect(toolBaseName("mcp__aynx-sessions__start_run")).toBe("start_run");
    expect(toolBaseName("mcp__aynx-sessions-dev__create_task")).toBe("create_task");
    expect(toolBaseName("aynx-sessions.wait_run")).toBe("wait_run");
    expect(toolBaseName("Read")).toBe("Read");
    expect(toolBaseName(null)).toBe("");
  });

  it("spawn_worker 는 입력의 role 칸만 붙인다(다른 칸 · 모양이 틀린 role 은 싣지 않는다)", () => {
    expect(toolPillLabel({ name: "mcp__a__spawn_worker", input: JSON.stringify({ role: "impl", prompt: "비밀 지시" }) })).toBe(
      "spawn_worker role=impl",
    );
    expect(toolPillLabel({ name: "mcp__a__spawn_worker", input: JSON.stringify({ role: "a b; rm" }) })).toBe("spawn_worker");
    expect(toolPillLabel({ name: "mcp__a__spawn_worker", input: "not json" })).toBe("spawn_worker");
    expect(toolPillLabel({ name: "mcp__a__get_run", input: JSON.stringify({ role: "impl" }) })).toBe("get_run");
  });

  it("역할 id 는 스튜디오 역할 표의 이름으로(없으면 id 그대로)", () => {
    const names: Record<string, string> = { "r-1c374dcd": "구현" };
    const look = (id: string) => names[id] ?? null;
    expect(toolPillLabel({ name: "mcp__a__spawn_worker", input: JSON.stringify({ role: "r-1c374dcd" }) }, look)).toBe("spawn_worker role=구현");
    expect(toolPillLabel({ name: "mcp__a__spawn_worker", input: JSON.stringify({ role: "r-ffff" }) }, look)).toBe("spawn_worker role=r-ffff");
  });

  it("Codex code mode 의 exec — 안에서 부른 도구 이름(접두를 떼고 · 같은 이름은 한 번 · 없으면 exec · 넷부터 …)", () => {
    const exec = (input: string) => toolPillLabel({ name: "exec", input });
    expect(exec("text(await tools.mcp__aynx_sessions_dev__list_db_connections({}));\n")).toBe("list_db_connections");
    expect(
      exec('const r = await tools.mcp__aynx_sessions_dev__get_run({runId:"x"}); await tools.mcp__aynx_sessions_dev__wait_run({}); await tools.mcp__aynx_sessions_dev__get_run({})'),
    ).toBe("get_run · wait_run");
    // 기록은 입력을 JSON 문자열로 들고 올 수도 있다 — 같은 결과
    expect(exec(JSON.stringify("text(await tools.mcp__s__db_query({connId:\"a\", sql:\"SELECT 1\"}))"))).toBe("db_query");
    expect(exec("const ts = ALL_TOOLS.filter(x=>/db_query/.test(x.name)); text(ts);")).toBe("exec");
    expect(exec("await tools.a(); await tools.b(); await tools.c(); await tools.d();")).toBe("a · b · c …");
    expect(codeModeTools(null)).toEqual([]);
    // exec 가 아닌 도구의 입력은 읽지 않는다
    expect(toolPillLabel({ name: "mcp__a__get_run", input: "tools.mcp__a__start_run()" })).toBe("get_run");
  });

  it("이어진 같은 글자 · 같은 결과는 ×n 으로 묶고, 도는 것 · 실패는 따로", () => {
    const pills = groupToolPills([
      { label: "start_run", state: "ok" },
      { label: "create_task", state: "ok" },
      { label: "create_task", state: "ok" },
      { label: "create_task", state: "err" },
      { label: "spawn_worker role=impl", state: "ok" },
      { label: "spawn_worker role=impl", state: "running" },
      { label: "spawn_worker role=impl", state: "running" },
    ]);
    expect(pills.map((p) => [p.label, p.state, p.count])).toEqual([
      ["start_run", "ok", 1],
      ["create_task", "ok", 2],
      ["create_task", "err", 1],
      ["spawn_worker role=impl", "ok", 1],
      ["spawn_worker role=impl", "running", 1],
      ["spawn_worker role=impl", "running", 1],
    ]);
    expect(pills[1].indexes).toEqual([1, 2]);
    expect(pills[3].base).toBe("spawn_worker");
  });
});

describe("대기열 줄", () => {
  it("서버 보기(글 없음) + 이 창이 보낸 글 — 보낸 것 · 취소한 것은 빼고, 아직 보내지 않은 것만 [취소]", () => {
    const rows = queueRows(
      {
        items: [
          { clientId: "a", state: "queued" },
          { clientId: "b", state: "failed" },
          { clientId: "c", state: "sent" },
          { clientId: "d", state: "queued" },
        ],
        held: true,
      },
      { a: "첫째", b: "둘째" },
    );
    expect(rows).toEqual([
      { clientId: "a", state: "queued", text: "첫째", cancellable: true },
      { clientId: "b", state: "failed", text: "둘째", cancellable: false },
      { clientId: "d", state: "queued", text: null, cancellable: true },
    ]);
    expect(queueSummary(rows, true)).toEqual({ count: 3, held: true, failed: 1 });
    expect(queueSummary([], true)).toEqual({ count: 0, held: false, failed: 0 });
    expect(queueRows(null, {})).toEqual([]);
  });
});

describe("머리 상태 낱말 · 끝 · 이어받기", () => {
  const base = { readOnly: false, life: "live" as const, gone: false, status: "ready", sending: false, pending: 0, album: null };
  it("기록만 > 끝남 > 권한 > 응답 중 > 시작 중 > 작업자 기다림 > 쉼", () => {
    expect(producerActivity({ ...base, readOnly: true, status: "running" })).toBe("readOnly");
    expect(producerActivity({ ...base, gone: true })).toBe("ended");
    expect(producerActivity({ ...base, life: "ended" })).toBe("ended");
    expect(producerActivity({ ...base, status: "running", pending: 1 })).toBe("permission");
    expect(producerActivity({ ...base, status: "running" })).toBe("responding");
    expect(producerActivity({ ...base, sending: true })).toBe("starting");
    expect(producerActivity({ ...base, album: { state: "running" } })).toBe("waiting");
    expect(producerActivity({ ...base, album: { state: "paused" } })).toBe("idle");
    expect(producerActivity(base)).toBe("idle");
  });

  it("다시 말하면 이어 가는 끝 — 닫기 · 모두 닫기만 아니다", () => {
    for (const w of ["exited", "crashed", "ttl", "album-ended", "server-restarted", "start-failed"]) expect(restartableWhy(w)).toBe(true);
    expect(restartableWhy("closed")).toBe(false);
    expect(restartableWhy("close-all")).toBe(false);
  });

  it("이어받기 판정 표(서버 adoptable) → 라이브러리 갈래 · 채우는 글의 '멈춤 그대로'", () => {
    const p = { state: "paused" as const };
    expect(continueKind({ ...p, adoptable: { restore: true, autoResume: true } })).toBe("orphan");
    expect(continueKind({ ...p, adoptable: { restore: true, autoResume: false } })).toBe("reattach");
    expect(continueKind({ ...p, adoptable: { restore: false, autoResume: false, why: "on-hold" } })).toBe("paused");
    expect(continueKind({ ...p, adoptable: { restore: false, autoResume: false, why: "coordination-limit" } })).toBe("paused");
    expect(continueKind({ ...p, state: "running", adoptable: { restore: false, autoResume: false, why: "running" } })).toBe("playing");
    expect(adoptKeepsPause({ adoptable: { restore: true, autoResume: false } })).toBe(true);
    expect(adoptKeepsPause({ adoptable: { restore: true, autoResume: true } })).toBe(false);
    expect(adoptKeepsPause(null)).toBe(false);
  });

  it("서버 표에 없는 채팅 — 귀속 앨범이 orphaned 이고 되찾을 수 없으면 처음부터 기록만", () => {
    expect(goneReadOnly({ state: "orphaned", adoptable: { restore: false, autoResume: false, why: "orphaned" } })).toBe(true);
    expect(goneReadOnly({ state: "orphaned", adoptable: { restore: true, autoResume: false } })).toBe(false);
    expect(goneReadOnly({ state: "paused", adoptable: { restore: false, autoResume: false } })).toBe(false);
    expect(goneReadOnly(null)).toBe(false);
  });
});

describe("구독 통로", () => {
  it("그 채팅의 봉투만 믿는다(다른 채팅 · 모르는 꼬리표 · 모양이 틀린 값은 버린다)", () => {
    const ok = { chat: "pc-a", epoch: 2, seq: 5, ev: { t: "text", item: null, text: "답" }, subs: [] };
    expect(isProducerEvent(ok, "pc-a")).toBe(true);
    expect(isProducerEvent(ok, "pc-b")).toBe(false);
    expect(isProducerEvent({ ...ok, ev: { t: "wake" } }, "pc-a")).toBe(false);
    expect(isProducerEvent({ ...ok, seq: "5" }, "pc-a")).toBe(false);
    expect(isProducerEvent(null, "pc-a")).toBe(false);
  });
});
