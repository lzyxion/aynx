import { invoke, isRemote, listen } from "../ipc";
import { SvelteMap, SvelteSet } from "svelte/reactivity";
import { applyMirrorTabs, mirrorLocalChoice } from "$lib/app/tabs.svelte.js";
import { setMirrorRepaint, setMirrorWorkspaces } from "$lib/app/workspaces.svelte.js";
import { setMirroredAgents } from "$lib/app/titles.svelte.js";
import { mirrorAgentLink } from "$lib/app/agent-sessions.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { deserialize } from "$lib/tabs";
import { listPanes, newStartPane, type PaneSpec } from "$lib/session";
import { newTileKey, type WorkspaceLoad } from "$lib/workspaces/schema";
import {
  FALLBACK_WS, buildSnapshot, parseSnapshot, type MirrorNode, type MirrorSnapshot, type MirrorWorkspace, type PaneView,
} from "$lib/mirror/snapshot";
import { liveKeys, paneKeyOf, reduceMirror, type MirrorMemory } from "$lib/mirror/reduce";
import { followHomeStartBoard } from "$lib/start-widgets.svelte.js";

/**
 * **원격 창의 집 PC 화면 거울**(원격 웹 R2-B — 설계 5절 · `src-tauri/src/remote/mirror.rs`).
 *
 * 원격 창은 제 탭을 만들거나 저장하지 않는다 — 집 PC **주 창의 워크스페이스들**(탭 줄 · 타일 트리 · 포커스 — 10-20 부터 지금 것만이
 * 아니라 이번 실행에서 열린 것 전부 · cold 는 이름과 탭 수만)을 받아 같은 컴포넌트(`Tabs` · `PaneHost`)로 그린다. **어느 워크스페이스를
 * 볼지는 원격 창 몫**이다 — 탭 고르기와 같은 규칙(집 PC 가 워크스페이스를 바꾸면 따라가고, 아니면 원격이 고른 것을 둔다 ·
 * `$lib/mirror/reduce` 의 `pickMirrorWorkspace`)이고 집 PC 화면은 움직이지 않는다(원격의 전환은 `workspaces` 의 거울 갈래 ·
 * 폰의 고르기 화면 칩 줄 — `mobile/MobilePicker`). 출처는 둘:
 *
 * 1. **집 PC 주 창** — 바뀔 때마다 올린 스냅숏(`mirror_publish` → 이벤트 `mirror-layout`). 붙을 때는 `mirror_get`.
 * 2. **저장된 배치** — 주 창이 없으면(트레이 — `mirror_get` 이 `null` · 이벤트 몸 `null`) `workspaces.json` 의 활성 워크스페이스 · 주 창 범위를
 *    읽어 같은 모양으로 만든다(읽기만 — 쓰기 범위를 잡지 않는다 · 워크스페이스는 그 하나뿐). 주 창이 다시 서면 1 로 돌아간다.
 *
 * 받은 스냅숏은 `$lib/mirror/reduce` 가 원격 창의 탭으로 환원한다(같은 타일은 같은 id — 터미널 시청자가 다시 붙지 않는다 · 원격에서 고른
 * 탭 · 포커스는 집 PC 가 바꿀 때까지 둔다). 탭에 쓰는 길은 `applyMirrorTabs` 하나이고, 배치를 바꾸는 조작은 탭 모듈이
 * 요청으로 바꿔 집 PC 주 창에 보낸다(R3 — `app/mirror-requests`).
 *
 * 타일 종류마다 그리는 법은 `$lib/mirror/tile-policy` 의 표 — 쿼리 타일은 자리 표시([`mirrorPlaceholder`])이고 [원격에서 따로 열기]
 * ([`openOwnInstance`])가 이 창에만 새 id · 새 `tileKey` 의 제 타일을 세운다(집 PC 의 DB 연결 · 트랜잭션과 열쇠를 나누지 않게).
 *
 * 집 PC 창(주 · 보조)에서는 아무것도 하지 않는다(`isRemote` 가 아니면 [`bootMirror`] 가 바로 돌아간다).
 */

/** 지난 환원의 기억 · 마지막으로 그린 스냅숏 */
let memory: MirrorMemory | null = null;
let last: MirrorSnapshot | null = null;
/** 타일 열쇠 → 원격에서 따로 연 제 타일(쿼리 등) */
const overrides = new Map<string, PaneSpec>();
/** 자리 표시로 그릴 타일(원격 pane id) — `PaneHost` 가 읽는다 */
const placeholders = new SvelteSet<string>();
let placeholderKeys: Record<string, string> = {};
/** 받기 세대 — 늦게 돌아온 `mirror_get` · 파일 읽기가 그사이 온 이벤트를 덮지 않게 */
let generation = 0;
let started = false;
/** 저장된 배치 안내를 이미 보였나(주 창이 다시 서면 다시 보인다) */
let fileNoticeShown = false;

/** 받은 워크스페이스 목록(이름 · cold · 저장된 탭 수 — 폰 고르기 화면의 칩 줄이 읽는다) */
let workspaceRows = $state<MirrorWorkspace[]>([]);

/** 거울의 워크스페이스 목록(집 PC 순서) — 반응형 */
export function mirrorWorkspaces(): MirrorWorkspace[] {
  return workspaceRows;
}

/** 원격 pane id → 집 PC 가 알려 준 보이는 모습(AI · 에이전트 상태 · 폴더 한 토막) — 모바일 라벨이 읽는다 */
const views = new SvelteMap<string, PaneView>();

/** 이 타일의 보이는 모습(집 PC 가 알려 준 것 — 없으면 `null`) — 반응형 */
export function mirrorViewOf(paneId: string): PaneView | null {
  return views.get(paneId) ?? null;
}

/** 받은 `views`(집 PC id 열쇠)를 원격 pane id 로 옮겨 담는다 — 같은 타일 열쇠(`paneKeyOf`)로 짝짓는다 */
function applyViews(snap: MirrorSnapshot, mem: MirrorMemory): void {
  const next = new Map<string, PaneView>();
  const walk = (n: MirrorNode): void => {
    if (n.type === "split") {
      walk(n.a);
      walk(n.b);
      return;
    }
    const view = snap.views?.[n.pane.id];
    const id = mem.paneIds.get(paneKeyOf(n.pane));
    if (view && id) next.set(id, view);
  };
  for (const tab of snap.tabs) walk(tab.root);
  for (const id of [...views.keys()]) if (!next.has(id)) views.delete(id);
  for (const [id, v] of next) if (JSON.stringify(views.get(id)) !== JSON.stringify(v)) views.set(id, v);
  const ais = new Map<string, string>();
  for (const [id, v] of next) if (v.ai) ais.set(id, v.ai);
  setMirroredAgents(ais);
}

/** 이 타일을 자리 표시로 그리나(원격 창 · 쿼리 타일처럼 서버 상태를 열쇠로 쥔 것 · 아직 따로 열지 않음) */
export function mirrorPlaceholder(paneId: string): boolean {
  return placeholders.has(paneId);
}

function apply(snap: MirrorSnapshot): void {
  last = snap;
  // 시작 화면은 집 PC 한 벌을 따른다 — 칸이 없으면(저장된 배치) 마지막으로 받은 값을 둔다
  if (snap.startBoard) followHomeStartBoard(snap.startBoard);
  // 집 PC 에서 사라진 타일을 따로 연 것은 거둔다(그 타일의 언마운트가 제 연결을 닫는다).
  const live = liveKeys(snap);
  for (const key of [...overrides.keys()]) if (!live.has(key)) overrides.delete(key);
  const r = reduceMirror(snap, memory, memory ? mirrorLocalChoice() : null, overrides);
  memory = r.memory;
  // 워크스페이스(원격이 볼 것 = 환원이 정한 것)를 탭보다 먼저 — 탭 모듈이 활성 탭을 고를 때 그 소속으로 거른다
  setMirrorWorkspaces(snap.workspaces, r.workspaceId);
  if (JSON.stringify(workspaceRows) !== JSON.stringify(snap.workspaces)) workspaceRows = snap.workspaces;
  applyViews(snap, r.memory);
  placeholderKeys = r.placeholderKeys;
  placeholders.clear();
  for (const id of r.placeholders) placeholders.add(id);
  applyMirrorTabs(r.tabs, r.activeId, r.focus);
  // 타일 ↔ 대화 연결은 집 PC 의 것으로(대화 면 — 붙기 전 · 떼어 둔 동안의 신호를 원격은 못 받는다)
  for (const tab of r.tabs)
    for (const p of listPanes(tab.root)) if (p.kind === "local" || p.kind === "ssh") mirrorAgentLink(p.id, p.agentLink);
}

/** 저장된 배치(주 창 범위 · 활성 워크스페이스) → 스냅숏. 못 읽으면 `null`. */
async function fromFile(): Promise<MirrorSnapshot | null> {
  const loaded = await invoke<WorkspaceLoad>("workspaces_load");
  if (loaded.state !== "v2") return null;
  const file = loaded.file;
  const ws = file.workspaces.find((w) => w.id === file.activeWorkspaceId) ?? file.workspaces[0];
  if (!ws) return null;
  const saved = ws.tabs.filter((tab) => tab.placement.kind === "main");
  const restored = deserialize({ version: 1, activeIndex: 0, workspaces: saved });
  const active = restored.tabs.find((tab) => tab.tabKey !== undefined && tab.tabKey === ws.lastActive.tabKey) ?? restored.tabs[0];
  return buildSnapshot({
    source: "file",
    workspace: { id: ws.id, name: ws.name },
    tabs: restored.tabs,
    activeTabId: active?.id ?? null,
    focusOf: (tab) => listPanes(tab.root).find((p) => p.tileKey !== undefined && p.tileKey === ws.lastActive.tileKey)?.id ?? null,
  });
}

/** 지금 배치를 받아 그린다 — 집 PC 주 창의 것, 없으면 저장된 배치. */
async function load(): Promise<void> {
  const gen = ++generation;
  let snap: MirrorSnapshot | null = null;
  try {
    snap = parseSnapshot(await invoke<unknown>("mirror_get"));
  } catch {
    snap = null;
  }
  let fromSaved = false;
  if (!snap) {
    try {
      snap = await fromFile();
      fromSaved = snap !== null;
    } catch {
      snap = null;
    }
  }
  if (gen !== generation || !snap) return;
  if (fromSaved && !fileNoticeShown) {
    fileNoticeShown = true;
    showNotice(t("app.mirror.fromFile"));
  }
  if (!fromSaved) fileNoticeShown = false;
  apply(snap);
}

/**
 * **원격 창의 부팅** — 탭을 만드는 대신 거울을 세운다(`app/boot` 이 `bootTabs` 자리에서 부른다). 이벤트를 먼저 걸고 지금 배치를 받는다.
 */
export async function bootMirror(): Promise<void> {
  if (!isRemote || started) return;
  started = true;
  setMirrorWorkspaces([{ id: FALLBACK_WS, name: "" }], FALLBACK_WS);
  // 원격이 워크스페이스를 바꾸면(칩 · 목록) 같은 스냅숏을 다시 환원한다 — 그 워크스페이스의 활성 탭(원격이 마지막으로 고른 것)이 선다
  setMirrorRepaint(() => {
    if (last) apply(last);
  });
  await listen<unknown>("mirror-layout", (ev) => {
    if (ev.payload === null) {
      // 집 PC 주 창이 사라졌다(트레이로) — 저장된 배치로.
      void load();
      return;
    }
    const snap = parseSnapshot(ev.payload);
    if (!snap) return;
    generation++;
    fileNoticeShown = false;
    apply(snap);
  }).catch(() => {});
  await load();
}

function findLeaf(snap: MirrorSnapshot, key: string): PaneSpec | null {
  const walk = (n: MirrorNode): PaneSpec | null =>
    n.type === "leaf" ? (paneKeyOf(n.pane) === key ? n.pane : null) : (walk(n.a) ?? walk(n.b));
  for (const tab of snap.tabs) {
    const hit = walk(tab.root);
    if (hit) return hit;
  }
  return null;
}

/**
 * **[원격에서 따로 열기]** — 자리 표시 타일(쿼리 등)을 이 창에만 제 타일로 세운다: 같은 주소(연결 · 초안)에 **새 id · 새 `tileKey`** —
 * 서버의 DB 연결 · 트랜잭션은 `tileKey` 가 열쇠라 집 PC 의 것과 섞이지 않는다. 집 PC 에서 그 타일이 사라지면 함께 사라진다.
 */
export function openOwnInstance(paneId: string): void {
  const key = placeholderKeys[paneId];
  if (!key || !last) return;
  const src = findLeaf(last, key);
  if (!src) return;
  const fresh = newStartPane(); // 이 창의 카운터에서 번호 하나(겹치지 않는 id)
  const own: PaneSpec = JSON.parse(JSON.stringify(src)) as PaneSpec;
  own.id = `r${fresh.id}`;
  own.tileKey = newTileKey();
  delete own.sourcePaneId;
  overrides.set(key, own);
  apply(last);
}

/** 원격에서 따로 연 제 타일인가(R3 — 닫기는 원격 혼자 · 집 PC 에 요청하지 않는다) */
export function isOwnInstance(paneId: string): boolean {
  for (const own of overrides.values()) if (own.id === paneId) return true;
  return false;
}

/** 따로 연 제 타일을 닫는다 — 자리 표시로 돌아간다(그 타일의 언마운트가 제 연결을 닫는다). */
export function closeOwnInstance(paneId: string): void {
  for (const [key, own] of overrides) if (own.id === paneId) overrides.delete(key);
  if (last) apply(last);
}

/** 원격 타일 id → 집 PC 타일 열쇠(거울 환원의 열쇠 — R3 요청의 대상). 거울에 없으면 `null`. */
export function homeTileKey(paneId: string): string | null {
  if (!memory) return null;
  for (const [key, id] of memory.paneIds) if (id === paneId) return key;
  return null;
}

/** 원격 탭 id → 집 PC 탭 열쇠. 거울에 없으면 `null`. */
export function homeTabKey(tabId: string): string | null {
  if (!memory) return null;
  for (const [key, id] of memory.tabIds) if (id === tabId) return key;
  return null;
}

/** 지금 그리는 거울의 출처 — 집 PC 주 창(`home`) · 저장된 배치(`file` — 주 창 없음) · 아직 없음(`null`) */
export function mirrorSource(): "home" | "file" | null {
  return last?.source ?? null;
}
