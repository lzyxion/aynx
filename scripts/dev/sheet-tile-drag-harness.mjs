// 세션 판 칸 끌기 검증(2026-11-04 · `SessionSheet.svelte` · docs/log/2026-11-04-session-sheet-tile-drag.md).
//
// 두 모드:
//   헤드리스 스텁 — node scripts/dev/run-harness.mjs sheet-tile-drag-harness.mjs <outdir> --size 1280x860
//   개발 앱 실기 — HARNESS_REAL=1 CDP_PORT=9222 PAGE_PORT=1420 node scripts/dev/sheet-tile-drag-harness.mjs <outdir>
//     (개발 앱의 주인이 이 워크트리인지 먼저 확인할 것 · 만든 탭과 워크스페이스는 끝에 닫는다 · 릴리스 앱에 붙이지 말 것)
//
// 끌기는 두 길이다:
//   합성 — 앱의 손잡이에 `DragEvent`(+ 생성한 `DataTransfer`)를 보낸다. 판정표 전부를 이 길로 돈다.
//   진짜 입력 — `Input.dispatchMouseEvent` + `Input.setInterceptDrags` 로 브라우저가 칸에서 끌기를 시작하는지(그때 실린 종류까지) 보고
//     `Input.dispatchDragEvent` 로 놓는다. OS 끌기 창 · 창 밖 커서 · Esc 취소는 어느 길로도 재현되지 않는다 — 사람이 본다.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { waitBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";

const REAL = process.env.HARNESS_REAL === "1";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.env.CDP_PORT ?? process.argv[3] ?? "9222";
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
if (!target) throw new Error(`localhost:${pagePort} 페이지가 없다`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let seq = 0;
const pending = new Map();
let consoleBad = [];
let lastIntercept = null;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (d.method === "Input.dragIntercepted") lastIntercept = d.params.data;
  if (d.method === "Runtime.exceptionThrown") consoleBad.push(String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text).slice(0, 240));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") consoleBad.push(d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 240));
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error("page: " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text));
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const check = (ok, label) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, "base64"));
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const sheetMod = importApp("app/session-sheet.svelte.ts");
const wsMod = importApp("app/workspaces.svelte.ts");
const dragMod = importApp("session/drag.ts");
const tearMod = importApp("lib/tear.ts");

await send("Page.enable");
await send("Runtime.enable");
if (!REAL) {
  await send("Page.addScriptToEvaluateOnNewDocument", {
    source: `
    performance.setResourceTimingBufferSize(10000);
    const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
    window.__listeners = {};
    const answers = {
      list_hosts: { hosts: [], warnings: [] }, get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
      list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
      list_ai_clis: [], load_snippets: null, save_snippets: null,
      load_settings: { projects: { start_screen: 'off' } }, save_settings: null,
      host_history_list: {}, projects_list: [], session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
      report_session: null, update_session_context: null, push_session_block: null,
      drop_session: null, drop_ssh: null, close_session: null, close_ssh: null, resize_session: null, resize_ssh: null,
      write_session: null, write_ssh: null, send_keepalive: 12, reap_window_sessions: null,
      vault_status: 'none', vault_list: [], mcp_status: { clis: [] }, list_forwards: [], list_console_sessions: [],
      delegation_list_targets: [], mcp_activity: null, audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' }, audit_runs: [],
      stash_handoff: null, open_tear_window: null, take_handoff: null,
      list_operations: { pending: [], recent: [] },
      'plugin:notification|is_permission_granted': true,
    };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
      invoke: (cmd, args) => {
        ${WORKSPACE_STUB}
        window.__calls.push([cmd, cmd === 'stash_handoff' ? null : args]);
        if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
        if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
        if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
        return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
      },
      transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
      unregisterCallback: (id) => cbs.delete(id),
      convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  `,
  });
  await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload", { ignoreCache: true });
  await sleep(500);
  await waitBoot(ev).catch(async (e) => {
    console.log("부팅 실패:", JSON.stringify(consoleBad.slice(0, 8)), await ev(`document.body.innerText.slice(0, 300)`));
    throw e;
  });
  await sleep(800);
}

if (REAL) {
  // 모듈이 많아 리소스 타이밍 버퍼(기본 250)를 넘는다 — 넘으면 `importApp` 이 모듈을 못 찾는다. F5 는 세션을 끊지 않는다(재부착).
  await send("Page.addScriptToEvaluateOnNewDocument", { source: "performance.setResourceTimingBufferSize(10000);" });
  await send("Page.reload", { ignoreCache: false });
  await sleep(1000);
  await waitBoot(ev);
  await sleep(1500);
}

// ── 상태 읽기 ─────────────────────────────────────────────────────────────────
const state = async () =>
  JSON.parse(
    await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const d = await ${dragMod}; const m = await ${sheetMod}; const wm = await ${wsMod}; const tr = await ${tearMod};
      return JSON.stringify({ active: w.activeTabId(), ws: wm.currentWorkspaceId(), open: m.sessionSheetOpen(), dragging: d.draggingPane(), tear: tr.pendingTear() !== null,
        tabs: w.residentWindowTabs().map(t => ({ id: t.id, ws: t.workspaceId, panes: s.listPanes(t.root).map(p => p.id), kinds: s.listPanes(t.root).map(p => p.kind) })) }); })()`),
  );
const tabHolding = (st, pane) => st.tabs.find((t) => t.panes.includes(pane));
const openSheet = async () => {
  await ev(`(async () => (await ${sheetMod}).openSessionSheet())()`);
  await sleep(350);
};
const closeSheet = async () => {
  await ev(`(async () => (await ${sheetMod}).closeSessionSheet(false))()`);
  await sleep(300);
};
const cellSel = (pane) => `[data-sheet-cell="${pane}"]`;

/** 합성 끌기 — tgt 는 놓을 원소를 내는 식(`${x}` · `${y}` 자리에 쓸 비율은 fx · fy). 시작 · 머무름 · 놓기 · 끝을 차례로 보낸다 */
const drag = (src, tgt, { fx = 0.1, fy = 0.5, drop = true, end = true, screen = null } = {}) =>
  ev(`(async () => {
    const raf = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const src = document.querySelector(${JSON.stringify(src)});
    if (!src) throw new Error('no source ' + ${JSON.stringify(src)});
    src.scrollIntoView({ block: 'nearest' });
    const dt = new DataTransfer();
    const mk = (type, x, y) => new DragEvent(type, { bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y,
      screenX: ${screen ? screen.x : "window.screenX + x + 5"}, screenY: ${screen ? screen.y : "window.screenY + y + 5"} });
    const r0 = src.getBoundingClientRect();
    const started = src.dispatchEvent(mk('dragstart', r0.left + 2, r0.top + 2));
    await raf();
    const out = { started, types: [...dt.types], dimmed: src.classList.contains('source') };
    const tgt = ${tgt};
    if (tgt) {
      if (tgt.closest('[data-session-sheet]')) tgt.scrollIntoView({ block: 'nearest' });
      const r = tgt.getBoundingClientRect();
      const x = r.left + r.width * ${fx}, y = r.top + r.height * ${fy};
      const over = mk('dragover', x, y);
      tgt.dispatchEvent(over);
      await raf();
      out.accepted = over.defaultPrevented;
      out.overlay = !!tgt.querySelector?.('.drop');
      out.overlayAll = !!tgt.querySelector?.('.drop.all');
      if (${drop} && over.defaultPrevented) tgt.dispatchEvent(mk('drop', x, y));
      await new Promise(r => setTimeout(r, 40));
      await raf();
    }
    out.justMoved = !!document.querySelector('.cell.just');
    if (${end} && src.isConnected) src.dispatchEvent(mk('dragend', 1, 1));
    await raf();
    return JSON.stringify(out);
  })()`).then(JSON.parse);
const cellT = (pane) => `document.querySelector(${JSON.stringify(cellSel(pane))})`;

const openTile = async () =>
  JSON.parse(
    await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newLocalPane(); w.openInNewTab(p); return JSON.stringify({ id: p.id, tab: w.activeTabId() }); })()`),
  );
const addTile = () => ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newLocalPane(); w.openPaneHere(p); return p.id; })()`);

// ── 무대 ──────────────────────────────────────────────────────────────────────
const before = await state();
const homeWs = before.ws;
const createdWsName = `끌기 시험 ${Date.now() % 10000}`;
// 다른 워크스페이스 — 탭 하나 · 타일 하나(그 탭이 그 워크스페이스의 마지막 탭)
await ev(`(async () => { const wm = await ${wsMod}; const s = await ${sessMod}; const tab = s.newTab(); tab.root = s.leafOf(s.newLocalPane()); await wm.createWorkspace(${JSON.stringify(createdWsName)}, tab); })()`);
await sleep(800);
const afterCreate = await state();
const bWs = afterCreate.tabs.find((t) => !before.tabs.some((b) => b.id === t.id))?.ws;
const bTab = afterCreate.tabs.find((t) => t.ws === bWs && !before.tabs.some((b) => b.id === t.id));
const F = bTab.panes[0];
await ev(`(async () => { (await ${wsMod}).switchWorkspace(${JSON.stringify(homeWs)}); })()`);
await sleep(800);
const T = await openTile();
await sleep(500);
const D = await addTile();
await sleep(500);
const L = await openTile();
await sleep(500);
const V = await openTile();
await sleep(500);
const B = await addTile();
await sleep(500);
const V2 = await addTile();
await sleep(1500);
const C = T;
console.log("무대:", JSON.stringify({ V: V.tab, a: V.id, b: B, c: C.id, d: D, lone: L.id, f: F, bWs, homeWs }));

const sessionsOf = (ids) => ev(`(async () => { const m = await ${importApp("app/sessions.svelte.ts")}; return JSON.stringify(${JSON.stringify(ids)}.map(id => m.sessionOf(id))); })()`);
const allIds = [V.id, B, V2, C.id, D, L.id, F];
const sessionsAtStart = await sessionsOf(allIds);
const openCallsAtStart = REAL ? 0 : await ev(`window.__calls.filter(c => c[0] === 'open_local_session').length`);

// ── 1. 끌 수 있는 칸 ──────────────────────────────────────────────────────────
consoleBad = [];
await openSheet();
await shot("sheet-open.png");
check((await ev(`${cellT(V.id)}.getAttribute('draggable')`)) === "true", "이 창의 타일 칸은 draggable");
check((await ev(`getComputedStyle(${cellT(V.id)}).cursor`)) === "grab", "끌 수 있는 칸 cursor = grab");
check((await ev(`getComputedStyle(${cellT(V.id)}.querySelector('.ico')).pointerEvents`)) === "none", "칸 안 아이콘은 끌기를 시작하지 않는다(pointer-events: none)");

// ── 2. 판 안 — 다른 탭의 칸 옆으로(보던 탭 그대로 · 판 열린 채) ───────────────────
let s0 = await state();
let r = await drag(cellSel(V.id), cellT(C.id), { fx: 0.05 });
let s1 = await state();
check(r.started && r.types.includes("application/x-aynx-pane"), `dragstart 가 타일 종류를 싣는다 (${r.types.join(",")})`);
check(r.types.includes("application/x-aynx-tear") === true, "창 넘김 표식도 싣는다");
check(r.dimmed === true, "원본 칸이 흐려진다");
check(r.accepted === true && r.overlay === true, "받는 칸에 왼쪽 절반 미리보기");
check(tabHolding(s1, V.id).id === C.tab, "다른 탭으로 옮겨졌다");
check(s1.active === s0.active, "보던 탭 그대로");
check(s1.open === true, "판은 열린 채");
check(r.justMoved === true, "옮긴 칸에 강조 테두리");
check(s1.dragging === null && s1.tear === false, "끌기 표시 · 창 넘김 예약 정리");
await sleep(1300);
check((await ev(`!!document.querySelector('.cell.just')`)) === false, "강조는 1초 남짓 뒤 걷힌다");

// ── 3. 받지 않는 자리 ─────────────────────────────────────────────────────────
r = await drag(cellSel(B), cellT(B));
check(r.accepted === false && (await state()).dragging === null, "자기 칸은 받지 않는다");
r = await drag(cellSel(B), `document.querySelector('.stitle')`);
check(r.accepted === false, "판의 머리줄은 받지 않는다");
s1 = await state();
check(tabHolding(s1, B).id === V.tab && s1.open === true, "받지 않으면 그대로 · 판 열린 채");

// ── 4. 놓지 않고 끝(Esc 취소의 뒷모습) ─────────────────────────────────────────
r = await drag(cellSel(B), null, { drop: false });
s1 = await state();
check(s1.dragging === null && s1.tear === false && s1.open === true, "놓지 않고 끝나면 표시 · 예약만 걷히고 판은 열린 채");
check((await ev(`document.querySelectorAll('.cell.source').length`)) === 0, "원본 칸 흐림도 걷힌다");

// ── 5. 끄는 동안 blur · blocked 로 접지 않는다 ─────────────────────────────────
r = await drag(cellSel(B), null, { end: false });
await ev(`window.dispatchEvent(new Event('blur'))`);
await sleep(100);
check((await state()).open === true, "끄는 중 창 비활성화는 판을 접지 않는다");
await ev(`document.querySelector(${JSON.stringify(cellSel(B))}).dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: new DataTransfer(), clientX: 1, clientY: 1, screenX: window.screenX + 9, screenY: window.screenY + 9 }))`);
await sleep(100);
await ev(`window.dispatchEvent(new Event('blur'))`);
await sleep(350);
check((await state()).open === false, "끌기가 끝난 뒤의 비활성화는 예전처럼 접는다");
await openSheet();

// ── 6. 다른 워크스페이스의 마지막 탭에서 빼 오기 — 시작 타일이 남는다 ───────────────
s0 = await state();
r = await drag(cellSel(F), cellT(B), { fx: 0.95 });
s1 = await state();
check(tabHolding(s1, F).id === V.tab, "다른 워크스페이스의 타일을 보던 탭으로");
const bAfter = s1.tabs.find((t) => t.id === bTab.id);
check(bAfter && bAfter.kinds.join() === "start", `마지막 탭은 시작 타일로 남는다 (${bAfter?.kinds})`);
check(s1.ws === homeWs && s1.active === s0.active && s1.open === true, "워크스페이스 · 보던 탭 그대로");
await sleep(300);
check((await ev(`${cellT(bAfter.panes[0])}.getAttribute('draggable')`)) === null, "시작 타일 칸은 끌 수 없다");

// ── 7. 시작 타일 위 = 교체(상자 전체 미리보기) · 다른 워크스페이스로 보내기 ─────────
r = await drag(cellSel(F), cellT(bAfter.panes[0]), { fx: 0.05 });
s1 = await state();
check(r.overlayAll === true, "시작 타일 위 미리보기 = 상자 전체");
check(tabHolding(s1, F).id === bTab.id && s1.tabs.find((t) => t.id === bTab.id).kinds.join() === "local", "시작 타일 자리를 대신해 돌아간다");
check(s1.ws === homeWs && s1.active === s0.active, "보내도 워크스페이스 · 보던 탭 그대로");

// ── 8. 보던 탭의 마지막 타일을 내보내면 그때만 받는 탭으로 ─────────────────────────
await ev(`(async () => (await ${tabsMod}).selectTab(${JSON.stringify(L.tab)}))()`);
await sleep(400);
r = await drag(cellSel(L.id), cellT(D), { fx: 0.5, fy: 0.95 });
s1 = await state();
check(!s1.tabs.some((t) => t.id === L.tab), "보던 탭의 마지막 타일 — 탭이 사라진다");
check(s1.active === C.tab && s1.open === true, "그때만 받는 탭으로 간다 · 판 열린 채");
await ev(`(async () => (await ${tabsMod}).selectTab(${JSON.stringify(V.tab)}))()`);
await sleep(500);

// ── 9. 판 밖 — 아래로 보이는 타일 ─────────────────────────────────────────────
s0 = await state();
const below = `(() => { const box = document.querySelector('[data-session-sheet]').getBoundingClientRect(); const host = document.querySelector('[data-tile-canvas]').getBoundingClientRect();
  const x = (host.left + host.right) / 2, y = (Math.max(box.bottom, host.top) + host.bottom) / 2; const el = document.elementFromPoint(x, y); window.__belowXY = { x, y }; return el; })()`;
r = await drag(cellSel(D), below, { fx: 0.5, fy: 0.5 });
await sleep(300);
s1 = await state();
check(r.accepted === true, "판 아래 타일이 받는다");
check(tabHolding(s1, D).id === V.tab, "지금 탭으로 옮겨졌다");
check(s1.open === false, "판 밖에 놓으면 판이 접힌다");
check(s1.active === V.tab, "지금 탭 그대로");
check((await ev(`[...document.querySelectorAll('[data-pane="${D}"]')].some(e => e.getBoundingClientRect().width > 0)`)) === true, "옮긴 타일이 화면에 선다");
check(s1.dragging === null && s1.tear === false, "표시 · 예약 정리");

// ── 10. 탭 줄 = 새 탭 ─────────────────────────────────────────────────────────
await openSheet();
s0 = await state();
const tabEnd = `document.querySelector('.tab[data-tab="${V.tab}"]')`;
r = await drag(cellSel(D), tabEnd, { fx: 0.1, fy: 0.5 });
await sleep(300);
s1 = await state();
const promoted = tabHolding(s1, D);
check(r.accepted === true, "탭 줄이 받는다");
check(!s0.tabs.some((t) => t.id === promoted.id) && promoted.panes.length === 1, "새 탭으로 만들어졌다");
check(promoted.ws === homeWs && s1.active === promoted.id, "지금 워크스페이스의 새 탭 · 그 탭을 본다");
check(s1.open === false && s1.dragging === null && s1.tear === false, "판이 접히고 표시 · 예약 정리");

// ── 11. 누르기는 그대로 ───────────────────────────────────────────────────────
await openSheet();
await ev(`${cellT(B)}.click()`);
await sleep(400);
s1 = await state();
check(s1.active === V.tab && s1.open === false, "누르면 그 타일로 가고 판이 접힌다");

// ── 12. 왕복 뒤 세션이 산다 ───────────────────────────────────────────────────
await openSheet();
await drag(cellSel(B), cellT(C.id), { fx: 0.95 });
await sleep(200);
await drag(cellSel(B), cellT(V2), { fx: 0.05 });
await sleep(400);
const sessionsAtEnd = await sessionsOf(allIds);
check(sessionsAtEnd === sessionsAtStart, `옮겨 다녀도 세션 id 그대로 (${sessionsAtEnd})`);
if (REAL) {
  const marker = `SHEETDRAG${Date.now() % 100000}`;
  await ev(`(async () => { const m = await ${importApp("sync.svelte.ts")}; m.broadcastInput(['${B}'], 'echo ${marker}\\r'); })()`);
  let seen = false;
  for (let i = 0; i < 20 && !seen; i++) {
    await sleep(300);
    seen = (await ev(`(async () => { const t = await ${tearMod}; return (t.snapshotPane('${B}')?.buffer ?? '').split('${marker}').length >= 3; })()`)) === true;
  }
  check(seen, "왕복한 셸에 입력 · 출력이 돈다(echo 왕복)");
} else {
  const n = await ev(`window.__calls.filter(c => c[0] === 'open_local_session').length`);
  check(n === openCallsAtStart, `세션을 새로 열지 않았다 (${n})`);
  const closes = await ev(`window.__calls.filter(c => ['close_session', 'close_ssh'].includes(c[0])).length`);
  check(closes === 0, `세션을 닫지 않았다 (${closes})`);
}

// ── 13. 오케스트레이션 탭(앱이 쥔 고정 배치) — 끌 수도 놓을 수도 없다 ─────────────────
{
  await closeSheet();
  await ev(`(async () => (await ${importApp("app/orchestration.svelte.ts")}).openOrchHome())()`);
  await sleep(700);
  const orchPane = JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const t = w.residentWindowTabs().find(x => !!x.orch); return JSON.stringify(t ? s.listPanes(t.root)[0].id : null); })()`));
  check(orchPane !== null, "오케스트레이션 탭이 섰다");
  await ev(`(async () => (await ${tabsMod}).selectTab(${JSON.stringify(V.tab)}))()`);
  await sleep(300);
  await openSheet();
  check((await ev(`${cellT(orchPane)}.getAttribute('draggable')`)) === null, "오케스트레이션 탭 칸은 끌 수 없다");
  r = await drag(cellSel(B), cellT(orchPane), { fx: 0.05 });
  check(r.accepted === false, "오케스트레이션 탭 칸은 받지 않는다");
  check(tabHolding(await state(), B).id !== undefined && (await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const t = w.residentWindowTabs().find(x => !!x.orch); return s.listPanes(t.root).some(p => p.id === '${B}'); })()`)) === false, "오케스트레이션 탭 배치 그대로");
}

// ── 14. 진짜 마우스 입력 — 브라우저가 칸에서 끌기를 시작하는가 ─────────────────────
await send("Input.setInterceptDrags", { enabled: true });
const center = (sel) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); e.scrollIntoView({ block: 'nearest' }); const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2, l: b.left, w: b.width, h: b.height, t: b.top }); })()`).then(JSON.parse);
{
  s0 = await state();
  lastIntercept = null;
  const a = await center(cellSel(B));
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x, y: a.y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: a.x, y: a.y, button: "left", buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: a.x + i * 3, y: a.y + i * 2, button: "left", buttons: 1 });
    await sleep(30);
  }
  await sleep(150);
  const items = lastIntercept?.items?.map((x) => x.mimeType) ?? [];
  check(items.includes("application/x-aynx-pane"), `진짜 마우스로 칸에서 끌기가 시작된다 (${items.join(",")})`);
  check((await state()).dragging === B, "진짜 dragstart 가 손잡이를 태웠다");
  if (lastIntercept) {
    const b = await center(cellSel(C.id));
    const x = b.l + b.w * 0.05;
    await send("Input.dispatchDragEvent", { type: "dragEnter", x, y: b.y, data: lastIntercept });
    await send("Input.dispatchDragEvent", { type: "dragOver", x, y: b.y, data: lastIntercept });
    await sleep(150);
    check((await ev(`!!document.querySelector(${JSON.stringify(cellSel(C.id))} + ' .drop')`)) === true, "진짜 dragOver 에 미리보기");
    await shot("sheet-drag-over.png");
    await send("Input.dispatchDragEvent", { type: "drop", x, y: b.y, data: lastIntercept });
    await sleep(300);
    s1 = await state();
    check(tabHolding(s1, B).id === C.tab, "진짜 drop 으로 옮겨졌다");
    check(s1.active === s0.active && s1.open === true && s1.dragging === null, "보던 탭 그대로 · 판 열린 채 · 표시 정리");
  }
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: a.x, y: a.y, button: "left", buttons: 0, clickCount: 1 });
  await sleep(200);
}
await send("Input.setInterceptDrags", { enabled: false });

// ── 15. 창 밖에 놓기 — 판정(합성 좌표) ─────────────────────────────────────────
if (!REAL) {
  await openSheet();
  await drag(cellSel(V2), null, { screen: { x: -5000, y: -5000 } });
  await sleep(300);
  s1 = await state();
  check((await ev(`window.__calls.some(c => c[0] === 'open_tear_window')`)) === true, "창 밖에 놓으면 새 창을 연다(스텁까지)");
  check(s1.open === false && s1.dragging === null, "창 밖에 놓으면 판이 접힌다");
}

const bad = consoleBad.filter((m) => !m.includes("stub: "));
check(bad.length === 0, `콘솔 오류 · 예외 없음 (${bad.length}) ${JSON.stringify([...new Set(bad)].slice(0, 5))}`);

// ── 정리 — 실기는 만든 탭 · 워크스페이스를 닫는다 ───────────────────────────────
if (REAL) {
  await closeSheet();
  const now = await state();
  const created = now.tabs.filter((t) => !before.tabs.some((b) => b.id === t.id) && t.ws !== bWs);
  await ev(`(async () => { const w = await ${tabsMod}; for (const id of ${JSON.stringify(created.map((t) => t.id))}) w.closeTab(id); })()`);
  await sleep(500);
  // 시험 워크스페이스 — 앱의 삭제 길(확인 대화까지) 그대로
  await ev(`(async () => { const a = await ${importApp("app/workspace-actions.svelte.ts")}; void a.deleteWorkspaceAsked(${JSON.stringify(bWs)}); await new Promise(r => setTimeout(r, 600)); a.submitWorkspaceDeletePrompt(); await new Promise(r => setTimeout(r, 1200)); })()`);
  const left = await state();
  const gone = !left.tabs.some((t) => t.ws === bWs) && (await ev(`(async () => (await ${wsMod}).workspaceList().some(w => w.id === ${JSON.stringify(bWs)}))()`)) === false;
  console.log("정리:", created.length, "탭 닫음 · 시험 워크스페이스", gone ? "지움" : "남음(손으로 지울 것)", "· 남은 탭", left.tabs.length, "(처음", before.tabs.length + ")");
  await ev(`(async () => { const w = await ${tabsMod}; if (${JSON.stringify(before.active)} && w.residentWindowTabs().some(t => t.id === ${JSON.stringify(before.active)})) w.selectTab(${JSON.stringify(before.active)}); })()`);
}

console.log(`${passed} PASS · ${failed} FAIL`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
