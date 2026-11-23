// 헤드리스 검증 — **폰 배치의 타일 셋**(2026-11-15): ① 다시 읽으면 마지막으로 보던 타일 ② 같은 탭에 타일 열기 ③ 고르기 화면의 타일 ✕.
//
// 원격 창 흉내(`__AYNX_REMOTE__` · 390x844 · 터치) — 배치는 스텁 `mirror_get`(sessionStorage 에 둔 스냅숏 — 다시 읽어도 남는다) ·
// 이벤트 `mirror-layout` 으로 진짜 받기 길을 지난다. `mirror_request` 는 스텁이 받아 적고, 메인 PC 처럼 적용한 거울을 하네스가 다시 민다.
// 실제 GUI · 주 창 왕복은 아니다(메인 PC 쪽 적용은 `mirror-requests` 의 기존 길 그대로).
//
//   node scripts/dev/run-harness.mjs phone-tiles-harness.mjs <outdir> --size 390x844
//     → <outdir>/1-before.png · 1-reload-keeps.png · 1-gone-follows.png · …
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";

const [outdir = "out", port = process.env.CDP_PORT ?? "9277"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1444";
const ONLY = process.env.ONLY ?? ""; // 예: "1" · "12" — 비우면 전부
const want = (n) => ONLY === "" || ONLY.includes(String(n));
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${PAGE_PORT}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let seq = 0;
const pending = new Map();
const errors = [];
let booted = false;
const IGNORE = /stub:|mirror-|\[aynx\]/;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
    return;
  }
  if (d.method === "Runtime.exceptionThrown") {
    const x = d.params.exceptionDetails;
    const s = (x.exception?.description ?? x.text ?? "").split("\n")[0];
    if (!IGNORE.test(s)) errors.push("EXC " + s);
  }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    const s = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0];
    if (!IGNORE.test(s)) errors.push("ERR " + s);
  }
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  return r.result?.exceptionDetails
    ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0]
    : r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) {
    const p = path.join(outdir, name);
    fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
    console.log("PNG " + path.resolve(p));
  }
};
let bad = 0;
const check = (name, got, wantV) => {
  const ok = JSON.stringify(got) === JSON.stringify(wantV);
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(wantV)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded: ${file}'); return await import(e); })()`;
const T = importApp("app/tabs.svelte");

// ── 메인 PC 배치 흉내 ───────────────────────────────────────────────────────
const fsPane = (id, key) => ({ id, kind: "localfs", tileKey: key, path: "C:\\h" });
const shPane = (id, key) => ({ id, kind: "local", tileKey: key, historyStreamId: `s-${key}` });
const leaf = (pane) => ({ type: "leaf", pane });
const split = (a, b) => ({ type: "split", dir: "row", ratio: 0.5, a: leaf(a), b: leaf(b) });
/**
 * `tabs`: [{ id, key, ws, root, focus }] · `home` = 메인 PC 가 보는 워크스페이스 · `active` = 워크스페이스 → 활성 탭 · `cold` = cold 워크스페이스 id 들
 */
const snapshot = ({ tabs, home = "w1", active, cold = [] }) => ({
  v: 2,
  source: "home",
  workspace: { id: home, name: home },
  workspaces: [
    { id: "w1", name: "기본", activeTabId: active.w1 ?? null },
    { id: "w2", name: "회사", activeTabId: active.w2 ?? null },
    ...cold.map((id) => ({ id, name: "개인", cold: true, tabCount: 2, activeTabId: null })),
  ],
  activeTabId: active[home] ?? null,
  tabs: tabs.map((t) => ({ id: t.id, workspaceId: t.ws ?? "w1", tabKey: t.key, title: t.id, root: t.root, focus: t.focus ?? null })),
});

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  window.__AYNX_REMOTE__ = true;
  if (!sessionStorage.getItem('h.booted')) { try { localStorage.clear(); } catch {} sessionStorage.setItem('h.booted', '1'); }
  const label = 'remote-h-1';
  const cbs = new Map(); let n = 0; window.__calls = []; window.__requests = [];
  const evts = new Map();
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    list_ai_clis: [], list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [],
    agent_states_snapshot: [], mirror_publish: null, mirror_request_inbox: null, theme_profiles_edit: '{}',
    local_home: 'C:\\\\h', local_roots: ['C:\\\\'], local_places: [], local_free_space: null, local_list: [], local_conflicts: [],
    projects_list: [], host_history_list: {}, local_cwd: null,
  };
  window.__emit = (name, payload) => { for (const h of evts.get(name) ?? []) cbs.get(h)?.({ event: name, id: 0, payload }); };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'load_settings') return Promise.resolve({ app: { status_bar: 'bottom' }, automation: { auto_approve: false } });
      if (cmd === 'mirror_get') return Promise.resolve(JSON.parse(sessionStorage.getItem('h.mirror') ?? 'null'));
      if (cmd === 'mirror_request') { window.__requests.push(args.request); return window.__reject ? Promise.reject(window.__reject) : Promise.resolve(null); }
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});

const setMirror = (v) => ev(`sessionStorage.setItem('h.mirror', ${JSON.stringify(JSON.stringify(v))})`);
/** 메인 PC 가 바꾼 것처럼 — 저장(다시 읽기용)하고 방송 */
const push = async (v) => {
  await setMirror(v);
  await ev(`window.__emit('mirror-layout', ${JSON.stringify(v)})`);
  await sleep(350);
};
const boot = async () => {
  await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  const before = await ev(`performance.timeOrigin`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`performance.timeOrigin !== ${before}`, 15000);
  // 러너가 스텁 없이 띄운 첫 적재의 콘솔 오류(`Runtime.enable` 이 되돌려 준다)는 세지 않는다 — 스텁을 건 첫 새로고침부터 센다.
  if (!booted) errors.length = 0;
  booted = true;
  const ok = await waitFor(`!!document.querySelector('.mobile-bar') && !document.querySelector('.splash') && performance.getEntriesByType('resource').some(r => r.name.includes('app/tabs.svelte'))`, 25000);
  await sleep(900);
  return ok;
};
/** 원격 창의 지금 고름 — [활성 탭 id, 포커스 타일 id] */
const view = () => ev(`(async () => { const t = await ${T}; return JSON.stringify([t.activeTabId(), t.focusedPane()?.id ?? null]); })()`).then(JSON.parse);
const lastView = () => ev(`localStorage.getItem('aynx.remote.lastView')`).then((s) => (s ? JSON.parse(s) : null));

// ═════════════════════════════════════════════════════════════════════════
// ① 다시 읽으면 마지막으로 보던 타일
// ═════════════════════════════════════════════════════════════════════════
if (want(1)) {
  const TABS = [
    { id: "tA", key: "A", root: leaf(fsPane("a1", "ka1")), focus: "a1" },
    { id: "tB", key: "B", root: split(fsPane("b1", "kb1"), fsPane("b2", "kb2")), focus: "b1" },
    { id: "tC", key: "C", root: leaf(fsPane("c1", "kc1")), focus: "c1" },
  ];
  await setMirror(snapshot({ tabs: TABS, active: { w1: "tA" } }));
  check("① 폰이 선다", await boot(), true);
  check("① 처음은 메인 PC 를 따른다", await view(), ["htA", "ha1"]);
  // 폰에서 B 탭의 둘째 타일을 고른다(원격 로컬 — 메인 PC 는 그대로 A)
  await ev(`(async () => { const t = await ${T}; t.pickTab('htB'); t.focusPane('htB', 'hb2'); })()`);
  await sleep(300);
  check("① 폰이 B · b2 를 본다", await view(), ["htB", "hb2"]);
  check("① 이 기기에 남는다", await lastView(), { tab: "k:B", tile: "k:kb2" });
  await shot("1-before.png");
  // 폰을 내린 사이 메인 PC 가 C 로 옮겨 갔다 — 방송은 못 받고(페이지가 숨었다) 다시 읽는다
  await setMirror(snapshot({ tabs: TABS, active: { w1: "tC" } }));
  check("① 다시 읽기", await boot(), true);
  check("① 다시 읽은 첫 화면 = 폰의 마지막 타일(메인 PC 는 C)", await view(), ["htB", "hb2"]);
  await shot("1-reload-keeps.png");
  // 같은 배치가 다시 와도 끌려가지 않는다(기억 = 메인 PC 값)
  await push(snapshot({ tabs: TABS, active: { w1: "tC" } }));
  check("① 같은 거울 갱신에 끌려가지 않는다", await view(), ["htB", "hb2"]);
  // 메인 PC 가 탭을 바꾸면 따라간다(지금 규칙 그대로)
  await push(snapshot({ tabs: TABS, active: { w1: "tA" } }));
  check("① 다시 읽은 뒤 메인 PC 가 탭을 바꾸면 따라간다", await view(), ["htA", "ha1"]);
  check("① 따라간 것도 남는다", await lastView(), { tab: "k:A", tile: "k:ka1" });
  // 다른 워크스페이스의 타일 — 다시 읽어도 그 워크스페이스로
  const TABS2 = [...TABS, { id: "tD", key: "D", ws: "w2", root: leaf(fsPane("d1", "kd1")), focus: "d1" }];
  await push(snapshot({ tabs: TABS2, active: { w1: "tA", w2: "tD" } }));
  await ev(`(async () => { const t = await ${T}; t.pickTab('htD'); })()`);
  await sleep(300);
  check("① 폰이 다른 워크스페이스의 D 를 본다", await view(), ["htD", "hd1"]);
  check("① 다시 읽기(워크스페이스)", await boot(), true);
  check("① 다른 워크스페이스의 마지막 타일로", await view(), ["htD", "hd1"]);
  // 마지막 타일(B 탭째)이 닫혔다 — 다시 읽으면 메인 PC 를 따른다
  await ev(`(async () => { const t = await ${T}; t.pickTab('htB'); t.focusPane('htB', 'hb2'); })()`);
  await sleep(300);
  check("① 다시 B · b2", await view(), ["htB", "hb2"]);
  await setMirror(snapshot({ tabs: TABS2.filter((t) => t.id !== "tB"), active: { w1: "tC", w2: "tD" } }));
  check("① 다시 읽기(닫힘)", await boot(), true);
  check("① 마지막 타일이 사라졌으면 메인 PC 를 따른다", await view(), ["htC", "hc1"]);
  await shot("1-gone-follows.png");
  check("① 저장소가 막혀도 뜬다(첫 화면 = 메인 PC)", await ev(`(() => { try { localStorage.setItem('aynx.remote.lastView', '{bad'); return true; } catch { return false; } })()`), true);
  check("① 다시 읽기(망가진 값)", await boot(), true);
  check("① 망가진 값 = 메인 PC", await view(), ["htC", "hc1"]);
}

// ═════════════════════════════════════════════════════════════════════════
// ② 같은 탭에 타일 열기
// ═════════════════════════════════════════════════════════════════════════
const M = importApp("app/mobile-sheets");
const requests = () => ev(`JSON.stringify(window.__requests)`).then(JSON.parse);
const clearRequests = () => ev(`(window.__requests = [], 1)`);
const click = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.click(); return true; })()`);
const closeOverlay = async () => {
  await ev(`(async () => (await ${M}).closeMobileOverlay())()`);
  await sleep(400);
};
const sheetState = () =>
  ev(`JSON.stringify({
    place: document.querySelector('[data-sheet-place]')?.dataset.sheetPlace ?? null,
    hereDisabled: document.querySelector('[data-place="here"]')?.disabled ?? null,
    note: !!document.querySelector('[data-sheet-note]'),
  })`).then(JSON.parse);
const leavesOf = (tabId) =>
  ev(`(async () => { const t = await ${T}; const tab = t.residentWindowTabs().find((x) => x.id === ${JSON.stringify(tabId)}); if (!tab) return -1; const n = (x) => x.type === 'leaf' ? 1 : n(x.a) + n(x.b); return n(tab.root); })()`);

if (want(2)) {
  const base = [
    { id: "tA", key: "A", root: leaf(fsPane("a1", "ka1")), focus: "a1" },
    { id: "tB", key: "B", root: leaf(fsPane("b1", "kb1")), focus: "b1" },
    { id: "tD", key: "D", ws: "w2", root: leaf(fsPane("d1", "kd1")), focus: "d1" },
  ];
  await setMirror(snapshot({ tabs: base, active: { w1: "tB", w2: "tD" }, cold: ["w3"] }));
  await ev(`localStorage.removeItem('aynx.remote.lastView')`);
  check("② 폰이 선다", await boot(), true);
  check("② 폰이 B 를 본다", await view(), ["htB", "hb1"]);
  await clearRequests();
  // 위 띠 + → "지금 탭에"
  check("② 위 띠 + 를 누른다", await click(".mobile-bar .plus"), true);
  check("② 시트가 선다", await waitFor(`!!document.querySelector('[data-sheet-place]')`), true);
  check("② 위 띠 + = 지금 탭에(켜짐)", await sheetState(), { place: "here", hereDisabled: false, note: false });
  await sleep(300);
  await shot("2-sheet-here.png");
  check("② 셸을 고른다", await click('[data-launch="shell"]'), true);
  check("② 요청이 나간다", await waitFor(`window.__requests.length > 0`), true);
  const [req] = await requests();
  check("② openPane 요청(새 탭 요청이 아님) · 지금 탭 열쇠", [req?.op, req?.tab, req?.pane?.kind], ["openPane", "k:B", "local"]);
  check("② 요청은 하나", (await requests()).length, 1);
  check("② 시트가 닫힌다", await waitFor(`!document.querySelector('[data-sheet-place]')`, 3000), true);
  // 메인 PC 가 적용한 것처럼 — 그 탭에 자동 배치 · 포커스는 새 타일
  const opened = [
    base[0],
    { id: "tB", key: "B", root: split(fsPane("b1", "kb1"), shPane("n1", "kn1")), focus: "n1" },
    base[2],
  ];
  await push(snapshot({ tabs: opened, active: { w1: "tB", w2: "tD" }, cold: ["w3"] }));
  check("② 그 탭의 타일이 하나 는다", await leavesOf("htB"), 2);
  check("② 새 타일이 화면에 뜬다", await view(), ["htB", "hn1"]);
  check("② 위 띠 위치 칩 = 2/2", await ev(`document.querySelector('.mobile-bar .chip')?.textContent?.trim() ?? ''`), "2 · 2/2");
  await sleep(300);
  await shot("2-after-open.png");

  // 고르기 화면 [+ 새 탭] → "새 탭에"
  await clearRequests();
  check("② 알약 → 고르기 화면", await click(".mobile-bar .pill"), true);
  check("② 고르기 화면이 선다", await waitFor(`!!document.querySelector('.picker .add')`), true);
  check("② [+ 새 탭]", await click(".picker .add"), true);
  check("② 시트가 선다(새 탭)", await waitFor(`!!document.querySelector('[data-sheet-place]')`), true);
  check("② 고르기 화면의 새 탭 = 새 탭에(지금 탭에도 고를 수 있음)", await sheetState(), { place: "new", hereDisabled: false, note: false });
  await sleep(300);
  await shot("2-sheet-new.png");
  check("② 파일을 고른다", await click('[data-launch="localfs"]'), true);
  check("② 요청이 나간다(새 탭)", await waitFor(`window.__requests.length > 0`), true);
  check("② 새 탭 요청", (await requests()).map((r) => r.op), ["newTab"]);

  // 다른 워크스페이스 칩 · cold 칩 → 지금 탭에 꺼짐
  await click(".mobile-bar .pill");
  await waitFor(`!!document.querySelector('.picker .add')`);
  check("② cold 칩", await click('[data-ws-chip="w3"]'), true);
  await sleep(200);
  check("② cold 워크스페이스는 [+ 새 탭] 이 꺼진다", await ev(`document.querySelector('.picker .add').disabled`), true);
  check("② 다른 워크스페이스 칩", await click('[data-ws-chip="w2"]'), true);
  await sleep(200);
  await click(".picker .add");
  check("② 시트(다른 워크스페이스)", await waitFor(`!!document.querySelector('[data-sheet-place]')`), true);
  check("② 다른 워크스페이스로 여는 시트 = 지금 탭에 꺼짐", await sheetState(), { place: "new", hereDisabled: true, note: false });
  check("② 꺼진 칸을 눌러도 그대로", (await click('[data-place="here"]'), await sheetState()).place, "new");
  await closeOverlay();

  // 메인 PC 가 다른 워크스페이스를 보는 중 → 지금 탭에 꺼짐 + 한 줄
  await push(snapshot({ tabs: opened, home: "w2", active: { w1: "tB", w2: "tD" }, cold: ["w3"] }));
  check("② 메인 PC 를 따라 w2 로", await view(), ["htD", "hd1"]);
  await ev(`(async () => { const t = await ${T}; t.pickTab('htB'); })()`);
  await sleep(300);
  check("② 폰은 w1 의 B 로 돌아온다(메인 PC 는 w2)", (await view())[0], "htB");
  await click(".mobile-bar .plus");
  check("② 시트(메인 PC 가 다른 워크스페이스)", await waitFor(`!!document.querySelector('[data-sheet-place]')`), true);
  check("② 메인 PC 가 다른 워크스페이스 = 새 탭에 고정 + 한 줄", await sheetState(), { place: "new", hereDisabled: true, note: true });
  await sleep(300);
  await shot("2-sheet-elsewhere.png");
  await closeOverlay();
}

// ═════════════════════════════════════════════════════════════════════════
// ③ 고르기 화면의 타일 ✕
// ═════════════════════════════════════════════════════════════════════════
const D = importApp("app/doc-dirty");
const dialog = () => ev(`(() => { const d = document.querySelector('[data-confirm-dialog]'); return d ? d.querySelector('.body')?.textContent ?? '' : null; })()`);
const answer = async (result) => {
  await click(`[data-confirm-choice="${result}"]`);
  await sleep(400);
};
const openPicker = async () => {
  await click(".mobile-bar .pill");
  return waitFor(`!!document.querySelector('.picker [data-tile-row]')`);
};
if (want(3)) {
  const TABS = [
    { id: "tA", key: "A", root: split(fsPane("a1", "ka1"), shPane("s1", "ks1")), focus: "a1" },
    { id: "tB", key: "B", root: leaf(fsPane("b1", "kb1")), focus: "b1" },
  ];
  await setMirror(snapshot({ tabs: TABS, active: { w1: "tA" } }));
  await ev(`localStorage.removeItem('aynx.remote.lastView')`); // 앞 장면의 마지막 타일(B)이 씨앗이 되지 않게
  check("③ 폰이 선다", await boot(), true);
  await closeOverlay();
  check("③ 고르기 화면", await openPicker(), true);
  check(
    "③ 타일 줄마다 ✕(줄 단추와 형제)",
    await ev(`JSON.stringify([...document.querySelectorAll('.picker [data-tile-row]')].map((r) => [r.dataset.tileRow, !!r.querySelector(':scope > button.row'), r.querySelector(':scope > button.x')?.dataset.tileClose ?? null]))`).then(JSON.parse),
    [["ha1", true, "ha1"], ["hs1", true, "hs1"], ["hb1", true, "hb1"]],
  );
  const size = await ev(`(() => { const b = document.querySelector('[data-tile-close="ha1"]').getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })()`);
  check("③ ✕ 누르는 자리 ≥ 44px", size[0] >= 44 && size[1] >= 44, true);
  // 고른 줄의 ✕ 대비(선택 면 위)
  await sleep(500); // 밀어 넣는 움직임(280ms)이 끝난 뒤
  const contrastOf = (sel) => ev(`(() => {
    const row = document.querySelector('${sel}');
    const x = row.querySelector('.x');
    const rgb = (s) => { const n = (s.match(/[\\d.]+/g) ?? []).slice(0, 3).map(Number); return s.startsWith('color(') ? n.map((c) => c * 255) : n; };
    const lum = ([r, g, b]) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const fg = rgb(getComputedStyle(x).color), bg = rgb(getComputedStyle(row.classList.contains('picked') ? row : row.closest('.group')).backgroundColor);
    const op = Number(getComputedStyle(x).opacity);
    const mix = fg.map((c, i) => c * op + bg[i] * (1 - op));
    const [a, b] = [lum(mix), lum(bg)].sort((p, q) => q - p);
    return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
  })()`);
  const contrast = await contrastOf(".picker .tile-row.picked");
  console.log(`info 고른 줄 ✕ 대비 ${contrast}:1 · 고르지 않은 줄 ✕ 대비 ${await contrastOf(".picker .tile-row:not(.picked)")}:1(묶음 면 기준)`);
  check("③ 고른 줄 ✕ 대비 ≥ 3:1", contrast >= 3, true);
  await shot("3-picker-x.png");

  // 줄을 누르면 고르기만(✕ 와 겹치지 않음)
  await clearRequests();
  check("③ 세션 타일 줄을 누른다", await click('[data-tile-row="hs1"] > button.row'), true);
  check("③ 고르기 화면이 닫힌다", await waitFor(`!document.querySelector('.picker')`, 3000), true);
  check("③ 줄 = 고르기만(요청 없음 · 확인 없음)", [await view(), (await requests()).length, await dialog()], [["htA", "hs1"], 0, null]);

  // 세션 없는 타일 ✕ — 묻지 않고 closeTile
  await openPicker();
  await clearRequests();
  await click('[data-tile-close="ha1"]');
  check("③ 파일 타일 ✕ = closeTile 요청", await waitFor(`window.__requests.length > 0`, 3000), true);
  check("③ 요청 = closeTile · 메인 PC 열쇠 · 확인 없음", [(await requests()).map((r) => [r.op, r.tile]), await dialog()], [[["closeTile", "k:ka1"]], null]);
  check("③ ✕ 뒤에도 고르기 화면은 그대로", await ev(`!!document.querySelector('.picker')`), true);

  // 세션 타일 ✕ — 확인 상자
  await clearRequests();
  await click('[data-tile-close="hs1"]');
  check("③ 세션 타일 ✕ = 확인 상자", await waitFor(`!!document.querySelector('[data-confirm-dialog]')`, 3000), true);
  check("③ 세션 확인 문구", await dialog(), await ev(`${importApp("i18n/i18n.svelte")}.then((m) => m.t('app.mirror.confirmCloseTile'))`));
  await sleep(300);
  await shot("3-confirm-session.png");
  await answer("Cancel");
  check("③ 취소 = 요청 없음", (await requests()).length, 0);
  await click('[data-tile-close="hs1"]');
  await waitFor(`!!document.querySelector('[data-confirm-dialog]')`, 3000);
  await answer("Ok");
  check("③ 확인 = closeTile", await waitFor(`window.__requests.some((r) => r.op === 'closeTile' && r.tile === 'k:ks1')`, 3000), true);

  // 원격 창 자신의 저장 안 한 문서 — 데스크톱 닫기와 같은 물음
  await clearRequests();
  await ev(`(async () => (await ${D}).setDocDirty('hb1', true))()`);
  await click('[data-tile-close="hb1"]');
  check("③ 저장 안 한 문서 ✕ = 확인 상자", await waitFor(`!!document.querySelector('[data-confirm-dialog]')`, 3000), true);
  check("③ 저장 안 한 문서 문구", (await dialog()).startsWith(await ev(`${importApp("i18n/i18n.svelte")}.then((m) => m.t('app.unsaved.confirm', { count: 1 }))`)), true);
  await sleep(300);
  await shot("3-confirm-unsaved.png");
  await answer("Cancel");
  check("③ 취소 = 요청 없음", (await requests()).length, 0);
  await click('[data-tile-close="hb1"]');
  await waitFor(`!!document.querySelector('[data-confirm-dialog]')`, 3000);
  await answer("No"); // 버리고 닫기
  check("③ 버리고 닫기 = closeTile", await waitFor(`window.__requests.some((r) => r.op === 'closeTile' && r.tile === 'k:kb1')`, 3000), true);
  check("③ 세션 확인은 묻지 않는다(파일 타일)", await dialog(), null);
  // 탭 ✕(closeTabs)도 같은 물음
  await clearRequests();
  await click(`.picker .group-head .round.small`);
  await sleep(200);
  check("③ 탭 ✕ — 그 탭에 세션이 있으면 묻는다", await waitFor(`!!document.querySelector('[data-confirm-dialog]')`, 3000), true);
  await answer("Cancel");
  await ev(`(async () => (await ${D}).setDocDirty('hb1', false))()`);
  await closeOverlay();
}

check("콘솔 오류 · 예외 0", errors, []);
console.log(`${bad === 0 ? "ok" : "FAIL"} — 실패 ${bad}`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
