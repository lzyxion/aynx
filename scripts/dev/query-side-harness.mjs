// 헤드리스 검증 — **쿼리(DB) 타일의 스키마 사이드바 여닫는 움직임**(2026-11-19 — `QueryView` 의 감싸개 `.tree-side` + `transition:sidePanelGrow` ·
// 문지기 `treeMotionGate` · `browser/tree-accordion.ts` · 200ms). 사이드바 자체는 `query/SchemaPane.svelte`(`.side` + 경계 `.vsplit`).
//
// 스텁: 문서 하네스(`doc-side-panels-harness`)의 바탕에 DB 명령 몇을 더했다 — `db_conn_list`(가짜 SQLite 연결 하나) · `db_open`(늘 열림 ·
// 진짜 DB 없음) · `db_schema`(`main`) · `db_objects`(표 셋 · 뷰 하나). 그래서 연결이 열린 상태(`data-query-state="open"`)와 트리 몇 줄까지 선다.
// 쿼리 타일 둘을 `app/query` 의 `openQueryTile` 로 세우고(첫 것이 시작 화면을 대신 · 둘째가 곁에) 첫 타일 폭을 **분할 비율**(`tab.root.ratio`)로
// 바꾼다(진짜 배치 — 상자 폭을 덮어쓰지 않는다).
//
// 보는 것:
// (c) 처음 설 때 — `.tree-side` 의 보이는 모든 프레임이 제 폭(221 = `.side` 220 + 경계 1) · 상자에 도는 애니메이션 0
// (a) 머리줄 토글(`.tree-toggle`)로 닫기 · 열기 — 프레임마다 폭이 0 과 제 폭 사이를 지난다 · 끝나면 `style` 속성이 비었다 ·
//     열린 뒤 `.tree-side` 폭 = `.side` 폭 + 1 · `.vsplit` 이 보인다(폭 1) · `.side` · `.vsplit` 높이 = `.main` 높이
// (b) 닫힌 뒤 `.tree-side` 가 DOM 에 없고 `.work` 가 `.main` 폭을 다 쓴다
// (d) 경계 `.vsplit` 끌기 → 사이드바 폭이 따라감(감싸개가 막지 않음) · 끄는 동안 감싸개 폭 = `.side` + 1 · 화살표 ←/→ = ∓10 · Shift = ∓50
// (e) 타일을 문턱(560) 아래로 줄이면 사이드바가 저절로 숨음(중간 폭 프레임 없음) · 넓혀 돌아올 때도 전환 없음 ·
//     좁은 타일의 토글은 드롭다운 단추(`.drop`)이고 떠 있는 패널(`[data-query-tree-drop]`)을 연다 · Esc 로 닫힘
// (f) 켠 토글(`aria-pressed="true"`)의 계산된 바탕색 = `--accent-soft`(문서 타일 곁 패널 단추의 켬과 같은 토큰) · 끈 토글은 투명 ·
//     열린 드롭다운 단추(`aria-expanded="true"`)도 같은 색
// (g) 콘솔 오류 · 예외 · Svelte 경고 0(`stub:` 거절 제외)
//
//   node scripts/dev/run-harness.mjs query-side-harness.mjs <outdir> --size 1400x900
//     → <outdir>/q1-open.png · q2-mid-close.png · q3-closed.png · q4-mid-open.png · q5-dragged.png · q6-narrow.png · q6-narrow-drop.png · q7-wide-back.png
//   중간 프레임 스크린샷은 CDP `Animation.setPlaybackRate`(0.1)로 움직임을 늦춰 찍는다 — 폭 판정은 제 속도(1)의 판에서 잰다.
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9279"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1446";
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${PAGE_PORT}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
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
    if (!/stub:/.test(s)) errors.push("EXC " + s);
  }
  if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) {
    const s = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0];
    if (d.params.type === "warning" && !/svelte|effect_|state_/i.test(s)) return;
    if (!/stub:/.test(s)) errors.push(`console.${d.params.type} ${s}`);
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
const evj = async (e) => {
  const v = await ev(e);
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const p = path.join(outdir, name);
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
      console.log("PNG " + path.resolve(p));
      return;
    }
    await sleep(400);
  }
};
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
const mouse = (type, x, y) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const hover = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
/** 누른 채 옮기기 — `button: "left"` 가 없으면 Chromium 이 pointermove 를 누른 끌기로 보내지 않는다 */
const dragTo = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
const key = async (code, k, vk, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(250);
};

let bad = 0;
const rows = [];
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  rows.push([okj ? "PASS" : "FAIL", name, JSON.stringify(got), okj ? "" : JSON.stringify(want)]);
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
  return okj;
};
const unmeasured = [];
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const Q = importApp("app/query.svelte.ts");

const CONN = { id: "qconn00000001", name: "shop.db", engine: "sqlite", path: "C:\\data\\shop.db" };
const CONN2 = { id: "qconn00000002", name: "side.db", engine: "sqlite", path: "C:\\data\\side.db" };

const stub = () => `
  performance.setResourceTimingBufferSize(10000);
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextHandle = 1;
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    mcp_status: { clis: [{ id: 'claude', name: 'Claude Code', installed: true, registered: true }] },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, send_input: null, reap_window_sessions: null, session_log_path: null,
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
    local_roots: ['C:\\\\'],
    side_chats_load: { json: JSON.stringify({ v: 2, current: null, last: { cli: 'claude', model: '', effort: '' }, chats: [] }), rev: 1 },
    db_conn_list: { conns: ${JSON.stringify([CONN, CONN2])}, warnings: [] },
    db_folders_load: null,
    db_schema: { schemas: [{ name: 'main' }] },
    db_objects: { objects: [
      { kind: 'table', name: 'customers' }, { kind: 'table', name: 'orders' }, { kind: 'table', name: 'products' }, { kind: 'view', name: 'order_totals' },
    ], truncated: [] },
    db_close: true,
  };
  const label = 'main';
  window.__label = label;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'db_open') return Promise.resolve({ handle: nextHandle++, lease: 1, dialect: 'sqlite', serverVersion: '3.45.0', writable: false, reattached: !!args?.reattachOnly, scripts: true });
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`;

const VW = 1400;
const VH = 900;
await send("Page.enable");
await send("Runtime.enable");
await send("Animation.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: stub() });
await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${S}; await ${Q}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
await sleep(800);
errors.length = 0;

// ── 도우미 ────────────────────────────────────────────────────────────────────────
let cur = null; // 잴 쿼리 타일 id
const Qel = () => `document.querySelector('[data-query-pane="${cur}"]')`;
const HEAD = () => `document.querySelector('[data-pane-head="${cur}"]')`;
const TOGGLE = () => `(${HEAD()}?.querySelector('.tree-toggle') ?? ${Qel()}?.querySelector('.tree-toggle'))`;
const TS = () => `${Qel()}?.querySelector('.main > .tree-side')`;
const SIDE = () => `${Qel()}?.querySelector('.main .side')`;
const VSPLIT = () => `${Qel()}?.querySelector('.main .vsplit')`;
const MAIN = () => `${Qel()}?.querySelector('.main')`;
const WORK = () => `${Qel()}?.querySelector('.main > .work')`;
const DROP = `document.querySelector('[data-query-tree-drop]')`;
const rectOf = (expr) =>
  evj(`(() => { const e = ${expr}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width * 10) / 10, h: Math.round(b.height * 10) / 10, x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
/** 지금 사이드바 기하(배치 폭 `offsetWidth` — 타일 등장의 크기 변환에 흔들리지 않게) */
const geo = () =>
  evj(`(() => { const q = ${Qel()}; if (!q) return 'null'; const ts = ${TS()}; const s = ${SIDE()}; const v = ${VSPLIT()}; const m = ${MAIN()}; const w = ${WORK()};
    return JSON.stringify({ q: q.offsetWidth, ts: ts ? ts.offsetWidth : null, side: s ? s.offsetWidth : null, v: v ? v.offsetWidth : null, vVis: v ? getComputedStyle(v).visibility !== 'hidden' && v.offsetWidth > 0 && v.offsetHeight > 0 : null,
      mainW: m ? m.offsetWidth : null, mainH: m ? m.offsetHeight : null, sideH: s ? s.offsetHeight : null, vH: v ? v.offsetHeight : null, workW: w ? w.offsetWidth : null,
      style: ts ? ts.getAttribute('style') : null, anims: ts ? ts.getAnimations().length : null,
      pressed: ${TOGGLE()}?.getAttribute('aria-pressed') ?? null, drop: ${TOGGLE()}?.classList.contains('drop') ?? null }); })()`);
/**
 * 프레임마다 감싸개 폭 · 상자 애니메이션 수 · style 속성을 적는다(없으면 null). `samples()` 로 거둔다
 */
const startSampling = (ms = 900) =>
  ev(`(() => { window.__samp = []; const t0 = performance.now(); const sel = '[data-query-pane="${cur}"] .main > .tree-side';
    const f = () => { const e = document.querySelector(sel);
      window.__samp.push(e ? { w: e.offsetWidth, a: e.getAnimations().length, st: e.getAttribute('style') } : null);
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); };
    requestAnimationFrame(f); return true; })()`);
const samples = async (ms = 1000) => {
  await sleep(ms);
  return evj(`JSON.stringify(window.__samp)`);
};
const widths = (s) => (s ?? []).map((x) => (x === null ? null : x.w));
/** 폭이 0 과 `full` 사이를 지났는가 */
const passesBetween = (s, full) => widths(s).some((x) => x !== null && x > 2 && x < full - 2);
/** 움직임이 끝날 때까지(감싸개에 도는 애니메이션이 없을 때까지) */
const settle = async () => {
  await waitFor(`document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.matches?.('.tree-side')).length === 0`, 4000);
  await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
};
const clickXY = async (x, y) => {
  await hover(x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
  await sleep(50);
};
const clickToggle = async () => {
  const r = await rectOf(TOGGLE());
  if (!r) return false;
  await clickXY(r.x, r.y);
  return true;
};
const hoverAway = async () => {
  const r = await rectOf(WORK());
  if (r) await hover(r.x, r.y);
  await sleep(150);
};
const bgOf = (expr) => ev(`(() => { const e = ${expr}; return e ? getComputedStyle(e).backgroundColor : null; })()`);
/** `--accent-soft` 를 그 타일 안에서 푼 색(같은 테마 · 같은 뿌리) — 문서 타일 곁 패널 단추의 켬(`DocView` `.btn.on`)이 쓰는 토큰 */
const accentSoft = () =>
  ev(`(() => { const p = document.createElement('div'); p.style.background = 'var(--accent-soft)'; (${Qel()}).appendChild(p); const c = getComputedStyle(p).backgroundColor; p.remove(); return c; })()`);
const TRANSPARENT = "rgba(0, 0, 0, 0)";
/** 인라인 스타일이 없다 — 속성이 없거나 빈 글자(Svelte 전환이 끝나며 잠깐 건 선언을 걷으면 빈 `style=""` 이 남는다 — 선언은 없다) */
const noStyle = (s) => s === null || s === undefined || s === "";
/** 첫 타일 폭을 분할 비율로 맞춘다 — `.query` 폭이 `w` 근처가 되게 */
const setW = async (w) => {
  for (let i = 0; i < 3; i++) {
    const got = await evj(`(async () => { const ws = await ${W};
      const tab = ws.residentWindowTabs().find((t) => t.id === ws.activeTabId());
      const root = tab.root; if (root.type !== 'split') return 'null';
      const el = ${Qel()}; if (!el) return 'null';
      const cw = el.getBoundingClientRect().width;
      const inA = root.a.type === 'leaf' && root.a.pane.id === ${JSON.stringify(cur)};
      const share = inA ? root.ratio : 1 - root.ratio;
      const total = cw / share;
      const want = Math.min(0.92, Math.max(0.08, ${w} / total));
      root.ratio = inA ? want : 1 - want;
      return JSON.stringify({ cw, total });
    })()`);
    await sleep(600);
    const now = await ev(`${Qel()}?.offsetWidth ?? 0`);
    if (got === "null" || Math.abs(now - w) < 6) return now;
  }
  return await ev(`${Qel()}?.offsetWidth ?? 0`);
};
const panes = () =>
  evj(`(async () => { const w = await ${W}; const s = await ${S};
    const tab = w.residentWindowTabs().find((t) => t.id === w.activeTabId());
    return JSON.stringify(s.listPanes(tab.root).map((p) => ({ id: p.id, kind: p.kind, conn: p.query?.connId ?? null }))); })()`);

// ── (c) 처음 설 때 — 첫 쿼리 타일을 세우며 프레임을 적는다 ──────────────────────────────
await ev(`(() => { window.__first = []; const t0 = performance.now();
  const f = () => { const e = document.querySelector('.query .main > .tree-side');
    window.__first.push(e ? { w: e.offsetWidth, a: e.getAnimations().length, side: e.querySelector('.side')?.offsetWidth ?? null } : null);
    if (performance.now() - t0 < 1500) requestAnimationFrame(f); };
  requestAnimationFrame(f); return true; })()`);
await ev(`(async () => { const q = await ${Q}; q.openQueryTile(${JSON.stringify(CONN.id)}, ${JSON.stringify(CONN.name)}); return true; })()`);
await sleep(1700);
const first = await evj(`JSON.stringify(window.__first)`);
const p1 = await panes();
cur = p1.find((p) => p.kind === "query")?.id ?? null;
check("0 쿼리 타일이 섰다", typeof cur === "string", true);
const firstVis = (first ?? []).filter((x) => x !== null);
console.log("first frames", first?.length, "visible", firstVis.length, JSON.stringify(firstVis.slice(0, 6)));
check(
  "(c) 처음 설 때 — 보이는 모든 프레임의 감싸개 폭 = .side + 1 · 상자 애니메이션 0",
  [firstVis.length > 0, firstVis.every((x) => x.side !== null && x.w === x.side + 1 && x.a === 0)],
  [true, true],
);
// 곁 타일 하나(분할 비율로 폭을 바꾸려고)
await ev(`(async () => { const q = await ${Q}; q.openQueryTile(${JSON.stringify(CONN2.id)}, ${JSON.stringify(CONN2.name)}); return true; })()`);
await sleep(1200);
await ev(`(async () => { const w = await ${W}; w.focusPane(w.activeTabId(), ${JSON.stringify(cur)}); return true; })()`);
check("0 타일 둘(쿼리 · 쿼리)", (await panes()).map((p) => p.kind), ["query", "query"]);
check("0 연결이 열림(스텁 db_open)", await waitFor(`${Qel()}?.getAttribute('data-query-state') === 'open'`, 8000), true);
// 트리는 SQLite 의 `main` 하나를 곧바로 펼쳐 종류 폴더(테이블 3 · 뷰 1)를 보인다 — 폴더는 접힌 채
const TREE_RX = `/테이블\\s*3/.test((EL?.textContent ?? '').replace(/\\s+/g, ' '))`;
const treeText = await waitFor(TREE_RX.replace("EL", SIDE()), 6000);
check("0 트리 줄이 섰다(스키마 · 테이블 3 · 뷰 1 — 스텁 db_schema · db_objects)", treeText, true);
console.log("tree text", JSON.stringify(await ev(`(${SIDE()}?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 160)`)));
const wWide = await setW(900);
console.log("wide width", wWide);
await sleep(500);

// ── (a) 열린 상태의 기하 ─────────────────────────────────────────────────────────────
const g0 = await geo();
console.log("open geo", JSON.stringify(g0));
check(
  "(a) 열림 — 감싸개 폭 = .side + 1 · 경계 보임(폭 1) · .side · .vsplit 높이 = .main 높이 · style 없음",
  [g0?.ts === g0?.side + 1, g0?.v, g0?.vVis, g0?.sideH === g0?.mainH, g0?.vH === g0?.mainH, noStyle(g0?.style)],
  [true, 1, true, true, true, true],
);
check("(a) 토글 aria-pressed=true · 드롭다운 단추 아님", [g0?.pressed, g0?.drop], ["true", false]);
// (f) 켬 색
await hoverAway();
const soft = await accentSoft();
const bgOn = await bgOf(TOGGLE());
console.log("toggle on bg", bgOn, "accent-soft", soft);
check("(f) 켠 토글의 바탕색 = --accent-soft(문서 곁 패널 단추의 켬과 같은 토큰) · 투명 아님", [bgOn === soft, bgOn !== TRANSPARENT && bgOn !== null], [true, true]);
await shot("q1-open.png");

// ── (a) 닫기 — 움직임 ───────────────────────────────────────────────────────────────
const full = g0?.ts ?? 221;
await startSampling(900);
await clickToggle();
const sClose = await samples(1000);
await settle();
console.log("close frames", JSON.stringify(widths(sClose)));
const vClose = (sClose ?? []).filter((x) => x !== null);
check(
  "(a) 닫기 — 폭이 제 폭과 0 사이를 지나 사라짐(마지막 프레임 = 없음) · 도는 동안 상자 애니메이션 1",
  [passesBetween(sClose, full), (sClose ?? [])[sClose.length - 1] === null, vClose.some((x) => x.a > 0)],
  [true, true, true],
);
// (b) 닫힌 뒤
const g1 = await geo();
console.log("closed geo", JSON.stringify(g1));
check("(b) 닫힘 — .tree-side 없음 · .side · .vsplit 없음 · .work 폭 = .main 폭", [g1?.ts, g1?.side, g1?.v, g1?.workW === g1?.mainW && g1?.mainW > 0], [null, null, null, true]);
check("(b) 토글 aria-pressed=false", g1?.pressed, "false");
await hoverAway();
const bgOff = await bgOf(TOGGLE());
check("(f) 끈 토글의 바탕색은 투명(강조 면 없음)", bgOff, TRANSPARENT);
await shot("q3-closed.png");

// ── (a) 열기 — 움직임 ───────────────────────────────────────────────────────────────
await startSampling(900);
await clickToggle();
const sOpen = await samples(1000);
await settle();
console.log("open frames", JSON.stringify(widths(sOpen)));
const vOpen = (sOpen ?? []).filter((x) => x !== null);
const lastOpen = vOpen[vOpen.length - 1];
check(
  "(a) 열기 — 폭이 0 과 제 폭 사이를 지나 제 폭에 닿음 · 도는 동안 상자 애니메이션 1",
  [passesBetween(sOpen, full), lastOpen?.w === full, vOpen.some((x) => x.a > 0)],
  [true, true, true],
);
check("(a) 열기 — 첫 보이는 프레임이 제 폭보다 작다(뚝 서지 않음)", (vOpen[0]?.w ?? full) < full, true);
const g2 = await geo();
console.log("reopened geo", JSON.stringify(g2));
check(
  "(a) 다시 열린 뒤 — 인라인 스타일 없음(style 속성이 없거나 빈 글자 — 전환이 잠깐 건 overflow 를 걷은 자리) · 애니메이션 0 · 감싸개 = .side + 1 · 높이 = .main",
  [noStyle(g2?.style), g2?.anims, g2?.ts === g2?.side + 1, g2?.sideH === g2?.mainH, g2?.vH === g2?.mainH],
  [true, 0, true, true, true],
);
check("(a) 열기 끝 프레임에 인라인 스타일 없음", noStyle(lastOpen?.st ?? null), true);
console.log("style attr: open-end", JSON.stringify(lastOpen?.st), "close mid", JSON.stringify(vClose.find((x) => x.a > 0)?.st ?? null));

// ── 중간 프레임 스크린샷 — 움직임을 늦춰(0.1배) 찍는다 ─────────────────────────────────
await send("Animation.setPlaybackRate", { playbackRate: 0.1 });
await clickToggle();
await sleep(700);
const midC = await geo();
await shot("q2-mid-close.png");
console.log("mid close geo", JSON.stringify(midC));
check("(g) 닫는 중간 프레임 — 감싸개 폭이 0 과 제 폭 사이(스크린샷 순간)", midC?.ts !== null && midC.ts > 2 && midC.ts < full - 2, true);
await waitFor(`!${TS()}`, 5000);
await clickToggle();
await sleep(700);
const midO = await geo();
await shot("q4-mid-open.png");
console.log("mid open geo", JSON.stringify(midO));
check("(g) 여는 중간 프레임 — 감싸개 폭이 0 과 제 폭 사이(스크린샷 순간)", midO?.ts !== null && midO.ts > 2 && midO.ts < full - 2, true);
await send("Animation.setPlaybackRate", { playbackRate: 1 });
await waitFor(`${TS()}?.getAnimations().length === 0`, 5000);
await settle();
check("늦춘 판 뒤 제 폭으로 돌아옴", (await geo())?.ts, full);

// ── (d) 경계 끌기 · 화살표 ───────────────────────────────────────────────────────────
const vs = await rectOf(VSPLIT());
const gd0 = await geo();
// 누르는 자리의 맨 위 요소가 경계(또는 그 ::after — 요소는 .vsplit)인가 · 경계가 받은 포인터 사건 수
const hitTop = await ev(`(() => { const e = document.elementFromPoint(${vs.x}, ${vs.y}); return e ? (e.className?.baseVal ?? e.className) : null; })()`);
await ev(`(() => { window.__pe = { down: 0, move: 0, up: 0 }; const v = ${VSPLIT()};
  v.addEventListener('pointerdown', () => window.__pe.down++); v.addEventListener('pointermove', () => window.__pe.move++); v.addEventListener('pointerup', () => window.__pe.up++); return true; })()`);
await hover(vs.x, vs.y);
await mouse("mousePressed", vs.x, vs.y);
const dragFrames = [];
for (let dx = 10; dx <= 60; dx += 10) {
  await dragTo(vs.x + dx, vs.y);
  await sleep(60);
  const g = await geo();
  dragFrames.push([g?.side, g?.ts]);
}
await mouse("mouseReleased", vs.x + 60, vs.y);
await sleep(300);
const gd1 = await geo();
console.log("drag frames [side, ts]", JSON.stringify(dragFrames), "after", JSON.stringify(gd1), "hit", hitTop, "pointer events", await ev(`JSON.stringify(window.__pe)`));
check("(d) 누르는 자리의 맨 위 요소 = 경계(.vsplit)", typeof hitTop === "string" && hitTop.includes("vsplit"), true);
check(
  "(d) 경계를 60px 끌면 .side 폭 +60 · 감싸개 = .side + 1(끄는 내내) · 경계 x 도 따라감",
  [gd1?.side - gd0?.side, dragFrames.every(([s, t]) => t === s + 1), Math.round((await rectOf(VSPLIT()))?.x - vs.x)],
  [60, true, 60],
);
check("(d) 끈 뒤 감싸개에 움직임 · 인라인 스타일 없음", [gd1?.anims, noStyle(gd1?.style)], [0, true]);
await shot("q5-dragged.png");
await ev(`${VSPLIT()}.focus()`);
await key("ArrowLeft", "ArrowLeft", 37);
const k1 = (await geo())?.side;
await key("ArrowRight", "ArrowRight", 39);
await key("ArrowRight", "ArrowRight", 39);
const k2 = (await geo())?.side;
await key("ArrowLeft", "ArrowLeft", 37, 8);
const k3 = (await geo())?.side;
console.log("keys side", gd1?.side, k1, k2, k3);
check("(d) 경계 포커스 ← = −10 · →→ = +20 · Shift+← = −50", [k1 - gd1.side, k2 - k1, k3 - k2], [-10, 20, -50]);
check("(d) 화살표 뒤에도 감싸개 = .side + 1", (await geo())?.ts === k3 + 1, true);
// 폭을 처음(220)으로 돌려 둔다
await ev(`${VSPLIT()}.focus()`);
for (let i = 0; i < 20 && (await geo())?.side !== 220; i++) {
  const s = (await geo())?.side;
  if (s > 220) await key("ArrowLeft", "ArrowLeft", 37);
  else await key("ArrowRight", "ArrowRight", 39);
}
check("(d) 폭 220 으로 되돌림", (await geo())?.side, 220);

// ── (e) 좁은 타일 — 저절로 숨고 돌아올 때 전환 없음 ─────────────────────────────────────
await sleep(600); // 문지기 창(400ms)이 지난 뒤
await startSampling(1400);
const wNarrow = await setW(480);
const sNarrow = await samples(300);
console.log("narrow width", wNarrow, "frames", JSON.stringify(widths(sNarrow)));
const gN = await geo();
check("(e) 480px — 사이드바가 저절로 숨음(.tree-side 없음) · .work = .main 폭", [gN?.q < 560, gN?.ts, gN?.workW === gN?.mainW], [true, null, true]);
check("(e) 숨는 동안 중간 폭 프레임 없음 · 애니메이션 0", [passesBetween(sNarrow, full), (sNarrow ?? []).filter((x) => x !== null).every((x) => x.a === 0)], [false, true]);
check("(e) 좁은 타일의 토글 = 드롭다운 단추(.drop) · aria-pressed 없음", [gN?.drop, gN?.pressed], [true, null]);
await shot("q6-narrow.png");
await clickToggle();
await sleep(500);
const dropR = await rectOf(DROP);
console.log("tree drop", JSON.stringify(dropR));
check("(e) 좁은 타일의 토글 → 떠 있는 패널([data-query-tree-drop]) · 화면 안 · aria-expanded=true", [!!dropR, dropR && dropR.l >= 0 && dropR.r <= VW && dropR.b <= VH, await ev(`${TOGGLE()}?.getAttribute('aria-expanded')`)], [true, true, "true"]);
check("(e) 떠 있는 패널에도 트리 줄(테이블 3)", await waitFor(TREE_RX.replace("EL", DROP), 4000), true);
check("(e) 떠 있는 패널이 열려도 사이드바(.tree-side)는 서지 않음", await ev(`!!${TS()}`), false);
await hoverAway();
const bgDrop = await bgOf(TOGGLE());
check("(f) 열린 드롭다운 단추의 바탕색 = 켠 토글과 같은 --accent-soft", bgDrop === soft, true);
await shot("q6-narrow-drop.png");
await ev(`${DROP}?.focus()`);
await key("Escape", "Escape", 27);
check("(e) Esc → 떠 있는 패널 닫힘 · 토글로 포커스", [await ev(`!!${DROP}`), await ev(`document.activeElement === ${TOGGLE()}`)], [false, true]);
// 넓혀 돌아오기
await startSampling(1400);
const wBack = await setW(900);
const sBack = await samples(300);
console.log("wide back", wBack, "frames", JSON.stringify(widths(sBack)));
const vBack = (sBack ?? []).filter((x) => x !== null);
check(
  "(e) 넓혀 돌아올 때 — 사이드바가 다시 섬 · 보이는 모든 프레임이 제 폭 · 애니메이션 0",
  [vBack.length > 0, vBack.every((x) => x.w === full && x.a === 0), (await geo())?.ts],
  [true, true, full],
);
check("(e) 돌아온 뒤 토글 aria-pressed=true · 떠 있는 패널 없음", [(await geo())?.pressed, await ev(`!!${DROP}`)], ["true", false]);
await shot("q7-wide-back.png");

// (g) 콘솔 오류
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("(g) 콘솔 오류 · 예외 · Svelte 경고 0", errors, []);
const stubbed = await evj(`JSON.stringify([...new Set(window.__calls.map((c) => c[0]).filter((c) => c.startsWith('db_')))])`);
console.log("db calls", JSON.stringify(stubbed));
if (unmeasured.length) console.log("못 잰 것:\n  " + unmeasured.join("\n  "));
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
