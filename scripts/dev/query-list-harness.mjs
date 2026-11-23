// 헤드리스 검증 — **쿼리(DB) 타일의 객체 목록 탭**(2026-11-23 — `query/ObjectList.svelte` · `object-list.ts` · `SchemaTree` 의 `onlist` ·
// `ev.detail > 1` 가드 · `script-controller` 의 `openList` · `setList` · `showScriptTab` · `QueryView` 의 `catalog` · `listRefs`).
//
// 스텁: `query-side-harness` 의 바탕 + 연결 둘(PG `shop` · SQLite `side.db`). `db_open` 이 연결마다 핸들을 주고 핸들 → dialect 를 적어 두어
// `db_schema` · `db_objects` 가 그 dialect 로 답한다(PG = `public` · `audit`, SQLite = `main`). `db_objects` 는 설명(`comment`) · 행 수(`rows`)를 싣고
// `window.__objDelay`(ms) 만큼 늦게 답한다. `window.__trunc = { 스키마: [종류] }` 면 그 종류가 잘렸다고 답한다. `db_table_detail` · `db_definition` ·
// `db_query`(데이터 탭) · `db_tx` 도 스텁이다. 모든 호출은 `window.__calls` 에 남는다. 배치 저장은 `workspace-stub` 의 `workspaces_apply` →
// sessionStorage(`h.ws`)로 다시 읽기를 넘긴다(`file-ui-keep-harness` 와 같은 길 — 실제 Rust 왕복은 아니다).
//
// 보는 것: ① 스키마 두 번 누르기 = 목록 탭 하나 · 펼친 채 · `db_objects` 1번 ② 다시 = 탭 그대로(펼침은 관찰) · 다른 스키마 = 둘째 탭 ③ 폴더 두 번 누르기 =
// 종류 바뀜 · 폴더 한 번만 토글 · 종류 단추 개수 ④ 종류별 칸 · 행 글자 ⑤ 찾기 · 강조 · `일치/전체` · nomatch · Esc 두 번 · Ctrl+F · Ctrl+I
// ⑥ 정렬 ⑦ 키보드 · 스크롤 · Enter · F4 ⑧ 마우스 두 번 누르기 · 우클릭 메뉴 항목 누르기 ⑨ 트리 두 번 누르기 = 이름 한 번 ⑩ 데이터 탭 중 트리 F4
// ⑪ ⟳ · F5 · aria-busy ⑫ 트리 없이 목록 탭이 직접 읽음 ⑬ 영속 · 다시 읽기 ⑭ 탭 조작 ⑮ SQLite ⑯ 좁은 타일 · 떠 있는 트리 ⑰ 5,000 상한
// ⑲ 데이터 탭 › 구조의 설명(`db_table_detail` 은 customers 에만 `comment` 를 싣는다) ⑱ 라이트 · 콘솔 0
//
//   node scripts/dev/run-harness.mjs query-list-harness.mjs <outdir> --size 1400x900
import { reloadBoot, waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9279"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1446";
fs.mkdirSync(outdir, { recursive: true });
const tlist = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = tlist.find((x) => x.type === "page" && x.url.includes(`localhost:${PAGE_PORT}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
const bootNoise = [];
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
    if (!/stub:/.test(s)) {
      errors.push("EXC " + s);
      console.log("  !! EXC " + s);
    }
  }
  if (d.method === "Page.frameNavigated" && !d.params.frame.parentId) console.log("  .. navigated " + d.params.frame.url);
  if (d.method === "Inspector.targetCrashed") console.log("  !! target crashed");
  if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) {
    const s = d.params.args
      .map((a) => String(a.value ?? a.description ?? "").replace(/%c/g, "").replace(/\s*\n\s*/g, " "))
      .filter((x) => !/^(color|font-weight):/.test(x))
      .join(" ")
      .slice(0, 260);
    if (d.params.type === "warning" && !/svelte|effect_|state_/i.test(s)) return;
    if (!/stub:/.test(s)) {
      errors.push(`console.${d.params.type} ${s}`);
      console.log(`  !! console.${d.params.type} ${s}`);
    }
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
const q = (s) => JSON.stringify(s);
const shots = [];
const shot = async (name) => {
  const p = path.join(outdir, name);
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
      shots.push(path.resolve(p));
      console.log("PNG " + path.resolve(p));
      return;
    }
    await sleep(400);
  }
};
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 100; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(100);
  }
  return false;
};
const btn = (type, x, y, clickCount = 1, button = "left") =>
  send("Input.dispatchMouseEvent", { type, x, y, button, buttons: type === "mouseReleased" ? 0 : 1, clickCount });
const hover = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
const KEYS = {
  Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, F2: 113, F4: 115, F5: 116, Backspace: 8,
  KeyF: 70, KeyI: 73, KeyW: 87, KeyS: 83, KeyA: 65,
};
/** `mod`: 2 = Ctrl */
const key = async (code, mod = 0, wait = 200) => {
  const vk = KEYS[code];
  const k = code.startsWith("Key") ? (mod & 2 ? code.slice(3).toLowerCase() : code.slice(3).toLowerCase()) : code;
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mod });
  await sleep(wait);
};
const typeText = async (text) => {
  await send("Input.insertText", { text });
  await sleep(200);
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
const observe = (name, got) => {
  rows.push(["관찰", name, JSON.stringify(got), ""]);
  console.log(`obs  ${name}: ${JSON.stringify(got)}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const Q = importApp("app/query.svelte.ts");

const CONN_PG = { id: "qconn00000001", name: "shop", engine: "postgres", host: "127.0.0.1", port: 5432, database: "shop", user: "app" };
const CONN_LITE = { id: "qconn00000002", name: "side.db", engine: "sqlite", path: "C:\\data\\side.db" };
const LONG = "주문 메모를 고객별로 모아 두는 테이블 — 배송 요청 · 반품 사유 · 상담 기록을 한 줄씩 쌓고, 매일 밤 보관 작업이 90일 지난 줄을 audit 스키마로 옮긴다. 이 설명은 일부러 길게 써서 칸이 말줄임되는지 본다.";
const PUBLIC = [
  { kind: "table", name: "customers", comment: "고객 마스터", rows: 12345 },
  { kind: "table", name: "orders", sub: "partitioned", comment: "주문 (월별 분할)", rows: 1500000 },
  { kind: "table", name: "products" },
  { kind: "table", name: "notes_long", comment: LONG, rows: 42 },
  { kind: "view", name: "order_totals", comment: "주문 합계" },
  { kind: "matview", name: "daily_sales", comment: "일별 매출", rows: 365 },
  { kind: "function", name: "calc_tax", args: "amount numeric", returns: "numeric", comment: "세금 계산" },
  { kind: "function", name: "calc_tax", args: "amount numeric, rate numeric", returns: "numeric" },
  { kind: "function", name: "sum_orders", sub: "aggregate", args: "numeric", returns: "numeric", comment: "주문 합 집계" },
  { kind: "procedure", name: "archive_orders", args: "before date", comment: "옛 주문 보관" },
  { kind: "sequence", name: "orders_id_seq" },
  { kind: "type", name: "order_status", sub: "enum", comment: "주문 상태" },
];
const AUDIT = [
  { kind: "table", name: "log", comment: "감사 기록", rows: 99 },
  ...Array.from({ length: 80 }, (_, i) => ({ kind: "table", name: `evt_${String(i).padStart(3, "0")}`, rows: i * 10 })),
  { kind: "view", name: "recent_log" },
];
/** 구조 화면의 설명(⑲) — `db_table_detail` 은 customers 에만 싣는다 */
const T_COMMENT = "고객 마스터 — 가입한 고객 한 명이 한 줄이고, 탈퇴하면 지우지 않고 상태만 바꾼다.";
const C_COMMENT = "가입할 때 적은 이름 그대로 — 성과 이름 사이 띄어쓰기도 적은 대로 둔다. 규칙: https://example.com/docs/customers/full_name_policy_v2";
const LITE = [
  { kind: "table", name: "items" },
  { kind: "table", name: "tags" },
  { kind: "view", name: "item_tags" },
];

const stub = () => `
  performance.setResourceTimingBufferSize(10000);
  try { if (!sessionStorage.getItem('h.reload')) localStorage.clear(); } catch {}
  window.__persistWorkspace = true;
  try { if (sessionStorage.getItem('h.reload') && sessionStorage.getItem('h.ws')) window.__workspaceSeed = JSON.parse(sessionStorage.getItem('h.ws')); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextHandle = 1;
  const dialects = {};
  window.__dialects = dialects;
  window.__objDelay = 60;
  window.__trunc = {};
  const PUBLIC = ${JSON.stringify(PUBLIC)}, AUDIT = ${JSON.stringify(AUDIT)}, LITE = ${JSON.stringify(LITE)};
  const later = (v, ms) => new Promise((r) => setTimeout(() => r(v), ms));
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
    db_conn_list: { conns: ${JSON.stringify([CONN_PG, CONN_LITE])}, warnings: [] },
    db_folders_load: null,
    db_close: true,
    db_tx: { tx: { id: 0, state: 'none', statements: 0, idleLimitMs: 600000, warnMs: 60000, warn: false } },
    db_table_detail: { columns: [
      { name: 'customer_id', type: 'int8', notNull: true, default: null, pk: 1 },
      { name: 'full_name', type: 'text', notNull: false, default: null, pk: 0 },
    ], indexes: [], constraints: [], foreignKeys: [], referencedBy: [], triggers: [], partitions: [], truncated: [] },
    db_query: { columns: [{ name: 'customer_id', type: 'int8' }, { name: 'full_name', type: 'text' }], rows: [[1, 'Kim'], [2, 'Lee']], truncated: false, cellTruncated: false, elapsedMs: 1 },
  };
  const label = 'main';
  window.__label = label;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'db_objects') (window.__objWho ??= []).push([args.schema, Math.round(performance.now()), (new Error().stack ?? '').split('\\n').map((l) => (l.match(/\\/([A-Za-z-]+\\.svelte(?:\\.ts)?)/) ?? [])[1]).filter(Boolean).join('<')]);
      if (cmd === 'db_open') {
        const h = nextHandle++;
        const d = args?.conn?.id === ${q(CONN_LITE.id)} ? 'sqlite' : 'postgres';
        dialects[h] = d;
        return Promise.resolve({ handle: h, lease: 1, dialect: d, serverVersion: d === 'sqlite' ? '3.45.0' : '16.2', writable: false, reattached: !!args?.reattachOnly, scripts: true });
      }
      if (cmd === 'db_schema') return Promise.resolve(dialects[args.handle] === 'sqlite' ? { schemas: [{ name: 'main' }] } : { schemas: [{ name: 'public' }, { name: 'audit' }] });
      if (cmd === 'db_objects') {
        const d = dialects[args.handle];
        const s = args.schema ?? (d === 'sqlite' ? 'main' : 'public');
        const objs = d === 'sqlite' ? LITE : s === 'audit' ? AUDIT : PUBLIC;
        return later({ objects: structuredClone(objs), truncated: (window.__trunc[s] ?? []).slice() }, window.__objDelay);
      }
      if (cmd === 'db_table_detail' && args.table === 'customers') {
        const d = structuredClone(answers.db_table_detail);
        d.comment = ${q(T_COMMENT)};
        d.columns[1].comment = ${q(C_COMMENT)};
        return Promise.resolve(d);
      }
      if (cmd === 'db_definition') return later({ sql: '-- ' + args.kind + ' ' + args.name + (args.args ? '(' + args.args + ')' : '') + '\\nCREATE OR REPLACE ' + args.kind.toUpperCase() + ' ' + (args.schema ?? '') + '.' + args.name + ' ...;', reconstructed: false, truncated: false }, 30);
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(structuredClone(answers[cmd])) : Promise.reject(new Error('stub: ' + cmd));
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
await send("Page.addScriptToEvaluateOnNewDocument", { source: stub() });
await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
await ev(`(sessionStorage.removeItem('h.reload'), sessionStorage.removeItem('h.ws'), 1)`);
await reloadBoot(send, ev);
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
const waitModules = async () => {
  for (let i = 0; i < 50; i++) {
    if ((await ev(`(async () => { try { await ${W}; await ${S}; await ${Q}; return true; } catch { return false; } })()`)) === true) return true;
    await sleep(300);
  }
  return false;
};
await waitModules();
await sleep(800);
errors.length = 0;

// ── 도우미 ────────────────────────────────────────────────────────────────────────
let cur = null; // PG 쿼리 타일 id
const Qel = (id = cur) => `document.querySelector('[data-query-pane="${id}"]')`;
const HEAD = (id = cur) => `document.querySelector('[data-pane-head="${id}"]')`;
/** 탭 줄은 머리줄이 서 있으면 머리줄에, 아니면 타일 몸에 */
const TABS = (id = cur) => `(${HEAD(id)}?.querySelector('[data-query-tabs]') ?? ${Qel(id)}?.querySelector('[data-query-tabs]'))`;
const SIDE = (id = cur) => `${Qel(id)}?.querySelector('.main .side')`;
const DROP = `document.querySelector('[data-query-tree-drop]')`;
const TOGGLE = (id = cur) => `(${HEAD(id)}?.querySelector('.tree-toggle') ?? ${Qel(id)}?.querySelector('.tree-toggle'))`;
const handleOf = async (id = cur) => Number(await ev(`${Qel(id)}?.dataset.queryHandle ?? 0`));
const rectOf = (expr) =>
  evj(`(() => { const e = ${expr}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height, x: Math.round(b.left + Math.min(b.width / 2, 60)), y: Math.round(b.top + b.height / 2) }); })()`);
const clickEl = async (expr, count = 1) => {
  const r = await rectOf(expr);
  if (!r) return false;
  await hover(r.x, r.y);
  for (let c = 1; c <= count; c++) {
    await btn("mousePressed", r.x, r.y, c);
    await btn("mouseReleased", r.x, r.y, c);
  }
  await sleep(250);
  return true;
};
const dblEl = (expr) => clickEl(expr, 2);
/** 우클릭 — CDP 의 오른쪽 버튼은 `contextmenu` DOM 이벤트를 만들지 않는다(blocks-harness 절) — 합성 이벤트로 */
const ctxEl = async (expr) => {
  const ok = await ev(`(() => { const e = ${expr}; if (!e) return false; const b = e.getBoundingClientRect(); e.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, button: 2, clientX: b.left + 30, clientY: b.top + b.height / 2 })); return true; })()`);
  await sleep(250);
  return ok === true;
};
/** 트리 줄 — `schema` 아래의 `type` 줄 중 `.nm` 이 `name` 인 것(함수는 `이름(인자)`). `root` = 트리 뿌리 식 */
const TROW = (type, name, schema = null, root = SIDE()) =>
  `(() => { const side = ${root}; if (!side) return null; let inS = ${schema === null ? "true" : "false"};
    for (const r of side.querySelectorAll('[data-query-tree-row]')) { const t = r.dataset.queryTreeRow; const nm = (r.querySelector('.nm')?.textContent ?? '').trim();
      if (t === 'schema') inS = ${schema === null ? "true" : `nm === ${q(schema)}`};
      if (t === ${q(type)} && inS && (nm === ${q(name)} || nm.startsWith(${q(name + "(")}))) return r; } return null; })()`;
const expandedOf = (expr) => ev(`${expr}?.getAttribute('aria-expanded') ?? null`);
const callsOf = (cmd, pred = "true") =>
  ev(`window.__calls.filter(([c, a]) => c === ${q(cmd)} && (${pred})).length`);
const objCalls = (schema, h) => callsOf("db_objects", `a.handle === ${h} && (a.schema ?? 'public') === ${q(schema)}`);
const LTAB = (schema, id = cur) => `${TABS(id)}?.querySelector('[data-query-tab-list="${schema}"]')`;
const listTabCount = (id = cur) => ev(`${TABS(id)}?.querySelectorAll('[data-query-tab-list]').length ?? -1`);
const tabCount = (id = cur) => ev(`${TABS(id)}?.querySelectorAll('[data-query-tab-n]').length ?? -1`);
const activeTab = (id = cur) =>
  evj(`(() => { const t = ${TABS(id)}?.querySelector('[data-query-tab-n][aria-selected="true"]'); return JSON.stringify(t ? { n: Number(t.dataset.queryTabN), list: t.dataset.queryTabList ?? null, data: t.dataset.queryTabData ?? null, name: t.querySelector('.stab-name')?.textContent.trim() ?? null } : null); })()`);
/** 보이는 목록 몸(켜진 데이터 탭 칸 안) */
const LIST = (id = cur) => `${Qel(id)}?.querySelector('.data-tab.on [data-query-list]')`;
const GRID = (id = cur) => `${LIST(id)}?.querySelector('[data-query-list-grid]')`;
const listState = (id = cur) =>
  evj(`(() => { const l = ${LIST(id)}; if (!l) return 'null'; const g = l.querySelector('[data-query-list-grid]');
    return JSON.stringify({ schema: l.dataset.queryListSchema, grid: g?.dataset.queryListGrid ?? null,
      kinds: [...l.querySelectorAll('[data-query-list-kind]')].map((b) => [b.dataset.queryListKind, b.querySelector('.cnt')?.textContent.trim(), b.getAttribute('aria-selected')]),
      sel: l.querySelector('[data-query-list-kind][aria-selected="true"]')?.dataset.queryListKind ?? null,
      head: g ? [...g.querySelectorAll('.head .cell')].filter((c) => getComputedStyle(c).display !== 'none').map((c) => [...c.classList].find((k) => k.startsWith('c-')).slice(2)) : null,
      names: [...l.querySelectorAll('[data-query-list-row]')].sort((a, b) => parseFloat(a.style.top) - parseFloat(b.style.top)).map((r) => r.dataset.queryListRow),
      empty: !!l.querySelector('[data-query-list-empty]'), nomatch: !!l.querySelector('[data-query-list-nomatch]'),
      truncated: !!l.querySelector('[data-query-list-truncated]'), error: l.querySelector('[data-query-list-error]')?.textContent ?? null }); })()`);
const rowCells = (name, id = cur) =>
  evj(`(() => { const r = ${LIST(id)}?.querySelector('[data-query-list-row="${name}"]'); if (!r) return 'null';
    return JSON.stringify([...r.querySelectorAll('.cell')].filter((c) => getComputedStyle(c).display !== 'none').map((c) => c.textContent.trim())); })()`);
const pickKindBtn = (kind, id = cur) => clickEl(`${LIST(id)}?.querySelector('[data-query-list-kind="${kind}"]')`);
const editorText = (id = cur) => ev(`[...(${Qel(id)}?.querySelectorAll('.ed .cm-line') ?? [])].map((l) => l.textContent).join('\\n')`);
const defShown = (id = cur) =>
  evj(`(() => { const d = ${Qel(id)}?.querySelector('[data-query-tab="definition"]'); const ed = ${Qel(id)}?.querySelector('.ed');
    return JSON.stringify({ def: !!d && d.offsetWidth > 0, selected: d?.getAttribute('aria-selected') ?? null, edGone: ed?.classList.contains('gone') ?? null }); })()`);
const focusTile = (id = cur) => ev(`(async () => { const w = await ${W}; w.focusPane(w.activeTabId(), ${q(id)}); return true; })()`);
const panes = () =>
  evj(`(async () => { const w = await ${W}; const s = await ${S};
    const tab = w.residentWindowTabs().find((t) => t.id === w.activeTabId());
    return JSON.stringify(s.listPanes(tab.root).map((p) => ({ id: p.id, kind: p.kind, conn: p.query?.connId ?? null }))); })()`);
/** 쿼리 탭(스크립트)을 고른다 — 없으면 null */
const pickScriptTab = async (id = cur) => {
  const ok = await clickEl(`[...(${TABS(id)}?.querySelectorAll('[data-query-tab-n]') ?? [])].find((t) => !t.dataset.queryTabList && !t.dataset.queryTabData)`);
  await sleep(200);
  return ok;
};
const clearEditor = async (id = cur) => {
  await ev(`(${Qel(id)}?.querySelector('.ed .cm-content'))?.focus()`);
  await key("KeyA", 2);
  await key("Backspace");
};
const count = (hay, needle) => (typeof hay === "string" ? hay.split(needle).length - 1 : -1);
/** 첫 타일 폭을 분할 비율로 맞춘다(query-side-harness 와 같은 길) */
const setW = async (w, id = cur) => {
  for (let i = 0; i < 4; i++) {
    const got = await evj(`(async () => { const ws = await ${W};
      const tab = ws.residentWindowTabs().find((t) => t.id === ws.activeTabId());
      const root = tab.root; if (root.type !== 'split') return 'null';
      const el = ${Qel(id)}; if (!el) return 'null';
      const cw = el.getBoundingClientRect().width;
      const inA = root.a.type === 'leaf' && root.a.pane.id === ${q(id)};
      const share = inA ? root.ratio : 1 - root.ratio;
      const total = cw / share;
      const want = Math.min(0.95, Math.max(0.05, ${w} / total));
      root.ratio = inA ? want : 1 - want;
      return JSON.stringify({ cw, total });
    })()`);
    await sleep(600);
    const now = await ev(`${Qel(id)}?.offsetWidth ?? 0`);
    if (got === "null" || Math.abs(now - w) < 8) return now;
  }
  return await ev(`${Qel(id)}?.offsetWidth ?? 0`);
};

// ── 0 PG 타일 ────────────────────────────────────────────────────────────────────
await ev(`(async () => { const m = await ${Q}; m.openQueryTile(${q(CONN_PG.id)}, ${q(CONN_PG.name)}); return true; })()`);
await sleep(1200);
cur = (await panes()).find((p) => p.kind === "query")?.id ?? null;
check("0 PG 쿼리 타일이 섰다 · 연결 열림", [typeof cur === "string", await waitFor(`${Qel()}?.getAttribute('data-query-state') === 'open'`, 8000)], [true, true]);
check("0 트리에 스키마 둘(public · audit) — 접힌 채", await waitFor(`!!(${TROW("schema", "public")}) && !!(${TROW("schema", "audit")})`, 6000), true);
const H1 = await handleOf();
console.log("PG handle", H1, "tabs", await tabCount());
check("0 처음 public 은 접힘 · db_objects 0", [await expandedOf(TROW("schema", "public")), await objCalls("public", H1)], ["false", 0]);

// ── 1 스키마 두 번 누르기 ───────────────────────────────────────────────────────────
await ev(`window.__objDelay = 300`);
await dblEl(TROW("schema", "public"));
await waitFor(`!!${LIST()}?.querySelector('[data-query-list-grid]')`, 6000);
await sleep(800);
const at1 = await activeTab();
check("1 목록 탭 하나 · 활성 · 스키마 public", [await listTabCount(), at1?.list], [1, "public"]);
check("1 스키마는 펼쳐진 채(도로 접히지 않음)", await expandedOf(TROW("schema", "public")), "true");
check("1 db_objects(public) 1번(트리와 목록이 두 번 읽지 않음)", await objCalls("public", H1), 1);
console.log("db_objects callers", await ev(`JSON.stringify(window.__objWho)`));
const ls1 = await listState();
console.log("list state", JSON.stringify(ls1));
check("1 첫 종류 = 테이블 · 표 grid", [ls1?.sel, ls1?.grid], ["table", "table"]);
await ev(`window.__objDelay = 60`);

// ── 4 칸(테이블) ────────────────────────────────────────────────────────────────
check("4 테이블 칸 = 이름 · 종류 · 행 · 설명", ls1?.head, ["name", "kind", "rows", "comment"]);
check("4 customers 줄 — 행 천 단위 구분", await rowCells("customers"), ["customers", "—", "12,345", "고객 마스터"]);
check("4 orders 줄 — 분할 · 1,500,000", await rowCells("orders"), ["orders", "분할", "1,500,000", "주문 (월별 분할)"]);
check("4 products 줄 — 행 · 설명 없음 = —", await rowCells("products"), ["products", "—", "—", "—"]);
const longCell = await evj(`(() => { const c = ${LIST()}?.querySelector('[data-query-list-row="notes_long"] .c-comment'); return JSON.stringify(c ? { title: c.title === ${q(LONG)}, clipped: c.scrollWidth > c.clientWidth, ws: getComputedStyle(c).whiteSpace, to: getComputedStyle(c).textOverflow } : null); })()`);
check("4 긴 설명 — 한 줄 말줄임 + 말풍선(title = 전문)", longCell, { title: true, clipped: true, ws: "nowrap", to: "ellipsis" });
await focusTile();
await shot("l1-table-dark.png");

// ── 2 다시 · 다른 스키마 ────────────────────────────────────────────────────────────
await dblEl(TROW("schema", "public"));
await sleep(500);
check("2 같은 스키마 다시 두 번 누르기 — 목록 탭 그대로 1 · 활성 public", [await listTabCount(), (await activeTab())?.list], [1, "public"]);
const exp2 = await expandedOf(TROW("schema", "public"));
observe("2 같은 스키마 다시 두 번 누른 뒤 public 펼침(aria-expanded — 첫 누름이 한 번 토글)", exp2);
check("2 db_objects(public) 여전히 1번", await objCalls("public", H1), 1);
await dblEl(TROW("schema", "audit"));
await waitFor(`${LIST()}?.dataset.queryListSchema === 'audit' && !!${GRID()}`, 6000);
await sleep(300);
check("2 다른 스키마(audit) — 둘째 목록 탭 · 활성", [await listTabCount(), (await activeTab())?.list], [2, "audit"]);
check("2 audit 펼친 채 · db_objects(audit) 1번", [await expandedOf(TROW("schema", "audit")), await objCalls("audit", H1)], ["true", 1]);

// ── 3 폴더 두 번 누르기 ──────────────────────────────────────────────────────────
if ((await expandedOf(TROW("schema", "public"))) !== "true") await clickEl(TROW("schema", "public"));
await waitFor(`!!(${TROW("folder", "함수", "public")})`, 4000);
const fBefore = await expandedOf(TROW("folder", "함수", "public"));
await dblEl(TROW("folder", "함수", "public"));
await waitFor(`${LIST()}?.dataset.queryListSchema === 'public'`, 4000);
await sleep(300);
const ls3 = await listState();
check("3 폴더(함수) 두 번 누르기 — public 탭 · 종류 = 함수 · 탭 수 그대로 2", [(await activeTab())?.list, ls3?.sel, ls3?.grid, await listTabCount()], ["public", "function", "function", 2]);
check("3 폴더는 한 번만 토글(접힘 → 펼침)", [fBefore, await expandedOf(TROW("folder", "함수", "public"))], ["false", "true"]);
check(
  "3 종류 단추 개수 = 스텁",
  (ls3?.kinds ?? []).map(([k, c]) => [k, c]),
  [["table", "4"], ["view", "1"], ["matview", "1"], ["function", "3"], ["procedure", "1"], ["sequence", "1"], ["type", "1"]],
);

// ── 4 칸(그 밖 종류) ────────────────────────────────────────────────────────────
check("4 함수 칸 = 이름 · 인자 · 반환 · 설명", ls3?.head, ["name", "args", "returns", "comment"]);
check("4 함수 줄 — 겹지정 둘 · 집계", ls3?.names, ["calc_tax", "calc_tax", "sum_orders"]);
check("4 sum_orders 줄", await rowCells("sum_orders"), ["sum_orders", "(numeric)", "numeric", "주문 합 집계"]);
await shot("l2-function.png");
const heads = {};
for (const k of ["view", "matview", "procedure", "sequence", "type"]) {
  await pickKindBtn(k);
  heads[k] = (await listState())?.head;
}
check("4 뷰 = 행 칸 없음", heads.view, ["name", "kind", "comment"]);
check("4 구체화 뷰 = 관계류(행 칸 있음)", heads.matview, ["name", "kind", "rows", "comment"]);
check("4 프로시저 = 반환 칸 없음", heads.procedure, ["name", "args", "comment"]);
check("4 시퀀스 · 형 = 이름 · 종류 · 설명", [heads.sequence, heads.type], [["name", "kind", "comment"], ["name", "kind", "comment"]]);
const os4 = await rowCells("order_status");
observe("4 형 order_status 줄 글자", os4);
check("4 형 줄 — 종류 칸에 sub 글자(— 아님) · 설명", [os4?.[0], typeof os4?.[1] === "string" && os4[1] !== "—" && os4[1] !== "", os4?.[2]], ["order_status", true, "주문 상태"]);
check("4 종류 단추를 눌러 바꾼 종류가 저장 모양에 실림(setList)", (await listState())?.sel, "type");

// ── 5 찾기 ──────────────────────────────────────────────────────────────────────
await pickKindBtn("table");
await clickEl(`${LIST()}?.querySelector('[data-query-list-filter]')`);
await typeText("er");
const ls5 = await listState();
const marks = await ev(`[...(${LIST()}?.querySelectorAll('mark.hit') ?? [])].map((m) => m.textContent).join(',')`);
check("5 'er' — 줄 걸러짐 · 강조 mark", [ls5?.names, marks], [["customers", "orders"], "er,er"]);
check("5 종류 단추 숫자 = 일치/전체(테이블만)", (ls5?.kinds ?? []).filter(([k]) => k === "table" || k === "view").map(([k, c]) => [k, c]), [["table", "2/4"], ["view", "1"]]);
await shot("l3-filter.png");
await typeText("zzz");
check("5 일치 없음 → nomatch 줄", (await listState())?.nomatch, true);
await key("Escape");
const afterEsc1 = await evj(`JSON.stringify({ v: ${LIST()}?.querySelector('[data-query-list-filter]').value, focus: document.activeElement?.matches?.('[data-query-list-filter]') ?? false })`);
await key("Escape");
const afterEsc2 = await ev(`document.activeElement === ${GRID()}`);
check("5 Esc 한 번 = 지움(칸에 남음) · 다시 Esc = 표로 포커스", [afterEsc1?.v, afterEsc1?.focus, afterEsc2], ["", true, true]);
await key("KeyF", 2);
check("5 표에서 Ctrl+F → 찾기 칸", await ev(`document.activeElement?.matches?.('[data-query-list-filter]') ?? false`), true);
await ev(`${GRID()}?.focus()`);
await key("KeyI", 2);
check("5 표에서 Ctrl+I → 찾기 칸", await ev(`document.activeElement?.matches?.('[data-query-list-filter]') ?? false`), true);
// 표 밖(탭 줄의 탭 머리)에서 앱 find 키 — 전역 처리기 → `openFind` 의 목록 탭 갈래
await ev(`${LTAB("public")}?.focus()`);
await key("KeyF", 2);
check("5 탭 머리에서 Ctrl+F(앱 find) → 목록 찾기 칸", await ev(`document.activeElement?.matches?.('[data-query-list-filter]') ?? false`), true);
await key("Escape");

// ── 6 정렬 ──────────────────────────────────────────────────────────────────────
const SORT = (c) => `${LIST()}?.querySelector('[data-query-list-sort="${c}"]')`;
const ariaSort = (c) => ev(`${SORT(c)}?.closest('[role="columnheader"]')?.getAttribute('aria-sort') ?? null`);
const base = (await listState())?.names;
await clickEl(SORT("name"));
const sA = [(await listState())?.names, await ariaSort("name")];
await clickEl(SORT("name"));
const sD = [(await listState())?.names, await ariaSort("name")];
await clickEl(SORT("name"));
const sN = [(await listState())?.names, await ariaSort("name")];
check("6 이름 머리 — 오름", sA, [["customers", "notes_long", "orders", "products"], "ascending"]);
check("6 이름 머리 — 내림", sD, [["products", "orders", "notes_long", "customers"], "descending"]);
check("6 이름 머리 — 없음(서버 순서)", sN, [base, "none"]);
await clickEl(SORT("rows"));
const rA = [(await listState())?.names, await ariaSort("rows"), await ariaSort("name")];
await clickEl(SORT("rows"));
const rD = [(await listState())?.names, await ariaSort("rows")];
await clickEl(SORT("rows"));
const rN = [(await listState())?.names, await ariaSort("rows")];
check("6 행 머리 — 오름(행 없는 products 는 아래) · 이름 머리는 none", rA, [["notes_long", "customers", "orders", "products"], "ascending", "none"]);
check("6 행 머리 — 내림(products 는 그래도 아래)", rD, [["orders", "customers", "notes_long", "products"], "descending"]);
check("6 행 머리 — 없음", rN, [base, "none"]);

// ── 7 키보드 ────────────────────────────────────────────────────────────────────
await clickEl(LTAB("audit"));
await waitFor(`${LIST()}?.dataset.queryListSchema === 'audit' && !!${GRID()}`, 4000);
await ev(`${GRID()}?.focus()`);
const ad = () => ev(`(() => { const g = ${GRID()}; const id = g?.getAttribute('aria-activedescendant'); const r = id ? document.getElementById(id) : null; return r ? r.dataset.queryListRow : null; })()`);
const adVisible = () =>
  ev(`(() => { const g = ${GRID()}; const id = g?.getAttribute('aria-activedescendant'); const r = id ? document.getElementById(id) : null; const s = g?.querySelector('.scroller'); if (!r || !s) return false; const a = r.getBoundingClientRect(), b = s.getBoundingClientRect(); return a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5; })()`);
const k0 = await ad();
await key("ArrowDown");
const k1 = await ad();
await key("ArrowDown");
await key("ArrowUp");
const k2 = await ad();
await key("End");
const kEnd = [await ad(), await ev(`${GRID()}?.querySelector('.scroller')?.scrollTop ?? -1`), await adVisible()];
await key("Home");
const kHome = [await ad(), await ev(`${GRID()}?.querySelector('.scroller')?.scrollTop ?? -1`), await adVisible()];
check("7 ↓ ↑ — aria-activedescendant 가 움직임(log → evt_000 → ↓↑ evt_000)", [k0, k1, k2], ["log", "evt_000", "evt_000"]);
check("7 End — 마지막 줄 · 스크롤 내려감 · 보임", [kEnd[0], kEnd[1] > 0, kEnd[2]], ["evt_079", true, true]);
check("7 Home — 첫 줄 · 맨 위 · 보임", kHome, ["log", 0, true]);
// 테이블 줄에서 Enter = 데이터 탭
await key("Enter", 0, 500);
const at7 = await activeTab();
check("7 테이블 줄 Enter → 데이터 탭(audit.log)", [at7?.data, at7?.name], ["table", "log"]);
check("7 데이터 탭 열림 — db_table_detail 부름", (await callsOf("db_table_detail", `a.handle === ${H1} && a.table === 'log'`)) >= 1, true);
// 함수 줄에서 Enter · F4 = DDL
await clickEl(LTAB("public"));
await waitFor(`${LIST()}?.dataset.queryListSchema === 'public'`, 4000);
await pickKindBtn("function");
await ev(`${GRID()}?.focus()`);
await key("ArrowDown"); // calc_tax(겹지정 둘째)
await key("Enter", 0, 600);
const d7 = await defShown();
const at7b = await activeTab();
check("7 함수 줄 Enter → 쿼리 탭 · DDL 칸 보임 · 편집기 보임", [at7b?.list, at7b?.data, d7], [null, null, { def: true, selected: "true", edGone: false }]);
const lastDef = await evj(`JSON.stringify(window.__calls.filter(([c]) => c === 'db_definition').at(-1)?.[1] ?? null)`);
check("7 겹지정 함수의 DDL 은 args 로 가름", [lastDef?.name, lastDef?.args, lastDef?.kind, lastDef?.schema], ["calc_tax", "amount numeric, rate numeric", "function", "public"]);
await clickEl(LTAB("public"));
await sleep(200);
await ev(`${GRID()}?.focus()`);
await key("End");
await key("F4", 0, 600);
const lastDef2 = await evj(`JSON.stringify(window.__calls.filter(([c]) => c === 'db_definition').at(-1)?.[1] ?? null)`);
check("7 함수 줄 F4 → DDL 칸 · sum_orders", [(await defShown()).def, (await activeTab())?.list, lastDef2?.name], [true, null, "sum_orders"]);
// 테이블 줄 F4 도 DDL(관계류도 정의가 있다)
await clickEl(LTAB("public"));
await pickKindBtn("table");
await ev(`${GRID()}?.focus()`);
await key("F4", 0, 600);
const lastDef3 = await evj(`JSON.stringify(window.__calls.filter(([c]) => c === 'db_definition').at(-1)?.[1] ?? null)`);
check("7 테이블 줄 F4 → DDL(customers · table)", [(await defShown()).def, lastDef3?.name, lastDef3?.kind], [true, "customers", "table"]);

// ── 8 마우스 ────────────────────────────────────────────────────────────────────
await clickEl(LTAB("public"));
await waitFor(`!!${GRID()}`, 3000);
await dblEl(`${LIST()}?.querySelector('[data-query-list-row="orders"]')`);
await sleep(400);
const at8 = await activeTab();
check("8 테이블 줄 두 번 누르기 → 데이터 탭(orders)", [at8?.data, at8?.name], ["table", "orders"]);
await waitFor(`!!${Qel()}?.querySelector('.data-tab.on .subs')`, 3000);
const dataSubs = await rectOf(`${Qel()}?.querySelector('.data-tab.on .subs')`);
const dataSub = await rectOf(`${Qel()}?.querySelector('.data-tab.on .subs .sub')`);
await shot("l7-data-tab.png");
await clickEl(LTAB("public"));
const listSubs = await rectOf(`${LIST()}?.querySelector('.subs')`);
const listSub = await rectOf(`${LIST()}?.querySelector('.subs .sub')`);
observe("8 위 줄 높이 · 단추 높이 — 데이터 탭 / 목록 탭", [[dataSubs?.h, dataSub?.h], [listSubs?.h, listSub?.h]]);
check("8 목록 탭 위 줄 · 종류 단추 높이 = 데이터 탭 하위 탭 줄 · 단추 높이", [listSubs?.h === dataSubs?.h, listSub?.h === dataSub?.h, listSubs?.t === dataSubs?.t], [true, true, true]);await clickEl(LTAB("public"));
await pickKindBtn("function");
await dblEl(`${LIST()}?.querySelector('[data-query-list-row="sum_orders"]')`);
await sleep(500);
check("8 함수 줄 두 번 누르기 → DDL", [(await defShown()).def, (await activeTab())?.list], [true, null]);
// 우클릭 — 테이블 줄 → 트리 메뉴 → [SELECT 넣기] 실제로 누름
await clickEl(LTAB("public"));
await pickKindBtn("table");
const tabsBefore8 = await tabCount();
await ctxEl(`${LIST()}?.querySelector('[data-query-list-row="customers"]')`);
const menu8 = await evj(`JSON.stringify([...document.querySelectorAll('[data-query-tree-menu] [data-query-tree-action]')].map((b) => b.dataset.queryTreeAction))`);
check("8 테이블 줄 우클릭 → 트리 메뉴(데이터 · SELECT)", menu8, ["data", "select"]);
await clickEl(`document.querySelector('[data-query-tree-menu] [data-query-tree-action="select"]')`);
await sleep(500);
const ed8 = await editorText();
check("8 [SELECT] 누름 → 메뉴 닫힘 · 새 쿼리 탭 · 편집기에 SELECT", [await ev(`!!document.querySelector('[data-query-tree-menu]')`), (await tabCount()) - tabsBefore8, /select/i.test(ed8 ?? "") && (ed8 ?? "").includes("customers")], [false, 1, true]);
console.log("editor after select", JSON.stringify(ed8));
// 함수 줄 우클릭 → [DDL 보기]
await clickEl(LTAB("public"));
await pickKindBtn("function");
await ctxEl(`${LIST()}?.querySelector('[data-query-list-row="sum_orders"]')`);
const menu8b = await evj(`JSON.stringify([...document.querySelectorAll('[data-query-tree-menu] [data-query-tree-action]')].map((b) => b.dataset.queryTreeAction))`);
await clickEl(`document.querySelector('[data-query-tree-menu] [data-query-tree-action="definition"]')`);
await sleep(500);
check("8 함수 줄 우클릭 → [DDL 보기] 누름 → DDL 칸", [menu8b, (await defShown()).def, await ev(`!!document.querySelector('[data-query-tree-menu]')`)], [["definition"], true, false]);

// ── 9 트리 손질 ─────────────────────────────────────────────────────────────────
await pickScriptTab();
await clearEditor();
check("9 준비 — 쿼리 탭 · 편집기 빔", [(await activeTab())?.list, (await activeTab())?.data, await editorText()], [null, null, ""]);
await waitFor(`!!(${TROW("object", "sum_orders", "public")})`, 3000);
await clickEl(TROW("object", "sum_orders", "public"));
const e9a = await editorText();
await clearEditor();
await dblEl(TROW("object", "sum_orders", "public"));
const e9b = await editorText();
console.log("editor 9", JSON.stringify(e9a), JSON.stringify(e9b));
check("9 함수 줄 한 번 누르기 → 이름 한 번", count(e9a, "sum_orders"), 1);
check("9 함수 줄 두 번 누르기 → 이름 한 번(두 번 들어가지 않음)", count(e9b, "sum_orders"), 1);
// 컬럼 — customers 펼치기(› 화살표)
await clearEditor();
if ((await expandedOf(TROW("folder", "테이블", "public"))) !== "true") await clickEl(TROW("folder", "테이블", "public"));
await clickEl(`${TROW("object", "customers", "public")}?.querySelector('.twisty')`);
await sleep(500);
if (!(await ev(`!!(${TROW("column", "full_name", "public")})`))) {
  const part = `[...(${SIDE()}?.querySelectorAll('[data-query-tree-row="part"][data-query-part="columns"]') ?? [])][0]`;
  if ((await expandedOf(part)) === "false") await clickEl(part);
  await sleep(300);
}
const hasCol = await waitFor(`!!(${TROW("column", "full_name", "public")})`, 3000);
await clickEl(TROW("column", "full_name", "public"));
const e9c = await editorText();
await clearEditor();
await dblEl(TROW("column", "full_name", "public"));
const e9d = await editorText();
console.log("editor 9 col", JSON.stringify(e9c), JSON.stringify(e9d));
check("9 컬럼 줄 — 한 번 = 한 번 · 두 번 누르기 = 한 번", [hasCol, count(e9c, "full_name"), count(e9d, "full_name")], [true, 1, 1]);
await clearEditor();
await dblEl(TROW("object", "products", "public"));
await sleep(400);
const at9 = await activeTab();
check("9 테이블 줄 두 번 누르기 = 데이터 탭(products — 예전 그대로)", [at9?.data, at9?.name], ["table", "products"]);

// ── 10 데이터 탭을 보는 중 트리 F4 ───────────────────────────────────────────────
check("10 준비 — 데이터 탭이 활성 · 편집기 숨음", [(await activeTab())?.data, (await defShown()).edGone], ["table", true]);
await ev(`${TROW("object", "sum_orders", "public")}?.focus()`);
await key("F4", 0, 700);
const at10 = await activeTab();
check("10 데이터 탭 중 트리 F4 → 쿼리 탭으로 · DDL 칸 보임", [at10?.data, at10?.list, await defShown()], [null, null, { def: true, selected: "true", edGone: false }]);

// ── 11 ⟳ · F5 ───────────────────────────────────────────────────────────────────
await clickEl(LTAB("public"));
await waitFor(`!!${GRID()}`, 3000);
const REF = () => `${LIST()}?.querySelector('[data-query-list-refresh]')`;
await ev(`window.__objDelay = 900`);
const before11 = await objCalls("public", H1);
await clickEl(REF());
await sleep(150);
const mid11 = await evj(`JSON.stringify({ spin: ${REF()}?.classList.contains('spinning'), busy: ${REF()}?.getAttribute('aria-busy'), grid: ${GRID()}?.getAttribute('aria-busy') })`);
await waitFor(`${REF()}?.getAttribute('aria-busy') === 'false'`, 5000);
await waitFor(`!${REF()}?.classList.contains('spinning')`, 3000);
const end11 = await evj(`JSON.stringify({ spin: ${REF()}?.classList.contains('spinning'), busy: ${REF()}?.getAttribute('aria-busy') })`);
check("11 ⟳ — 읽는 동안 .spinning · aria-busy(단추 · 표) → 끝나면 풀림", [mid11, end11], [{ spin: true, busy: "true", grid: "true" }, { spin: false, busy: "false" }]);
check("11 ⟳ — db_objects(public) +1", (await objCalls("public", H1)) - before11, 1);
const spinAnim = await ev(`(() => { const s = ${REF()}?.querySelector('svg'); return s ? getComputedStyle(s).animationName : null; })()`);
observe("11 끝난 뒤 svg animation-name(none 이어야 멈춤)", spinAnim);
await focusTile();
await ev(`${GRID()}?.focus()`);
const before11b = await objCalls("public", H1);
await key("F5", 0, 150);
const mid11b = await evj(`JSON.stringify({ spin: ${REF()}?.classList.contains('spinning'), busy: ${REF()}?.getAttribute('aria-busy') })`);
await waitFor(`${REF()}?.getAttribute('aria-busy') === 'false'`, 5000);
check("11 F5(목록 탭 활성) — 목록만 다시 읽음 · aria-busy · db_objects +1 · db_schema 안 부름",
  [mid11b, (await objCalls("public", H1)) - before11b], [{ spin: true, busy: "true" }, 1]);
const schemaCalls11 = await callsOf("db_schema", `a.handle === ${H1}`);
observe("11 F5 뒤 db_schema 호출 수(트리 새로 고침이 아님 — 1 이어야)", schemaCalls11);
await ev(`window.__objDelay = 60`);

// ── 14 탭 조작 ──────────────────────────────────────────────────────────────────
// (13 영속보다 먼저 — 다시 읽은 뒤에도 탭이 같은지 13 이 본다)
await dblEl(LTAB("audit"));
await sleep(300);
check("14 목록 탭 머리 두 번 누르기 → 이름 바꾸기 안 함", await ev(`!!${TABS()}?.querySelector('.stab-rename')`), false);
await ev(`${LTAB("audit")}?.focus()`);
await key("F2");
check("14 F2 → 이름 바꾸기 안 함", await ev(`!!${TABS()}?.querySelector('.stab-rename')`), false);
await ctxEl(LTAB("audit"));
const tmenu = await evj(`JSON.stringify([...document.querySelectorAll('[data-query-tab-menu] [data-query-tab-action]')].map((b) => b.dataset.queryTabAction))`);
check("14 탭 우클릭 메뉴 = 닫기류만", tmenu, ["close", "close-others", "close-right"]);
await key("Escape");
await sleep(200);
if (await ev(`!!document.querySelector('[data-query-tab-menu]')`)) await clickEl(`document.querySelector('.menu-backdrop')`);
const callsBeforeS = await ev(`window.__calls.length`);
await clickEl(LTAB("audit"));
await ev(`${GRID()}?.focus()`);
await key("KeyS", 2, 600);
const newCallsS = await evj(`JSON.stringify(window.__calls.slice(${callsBeforeS}).map(([c]) => c).filter((c) => /dialog|save|write_text|fs/i.test(c)))`);
check("14 목록 탭 활성 Ctrl+S → 저장 대화 없음", [newCallsS, await ev(`!!document.querySelector('[role="dialog"], [role="alertdialog"]')`)], [[], false]);

// ── 13 영속 ─────────────────────────────────────────────────────────────────────
await clickEl(LTAB("public"));
await pickKindBtn("function");
await sleep(1200);
const saved = await evj(`(() => { const f = window.__workspaceFile; let out = null;
  const walk = (o) => { if (!o || typeof o !== 'object' || out) return; if (o.query && Array.isArray(o.query.scripts) && o.query.connId === ${q(CONN_PG.id)}) { out = o.query; return; } for (const v of Object.values(o)) walk(v); };
  walk(f); return JSON.stringify(out ? { scripts: out.scripts.map((s) => ({ n: s.n, ...(s.list ? { list: s.list } : {}), ...(s.data ? { data: s.data.name } : {}), ...(s.sql !== undefined ? { sql: s.sql.length } : {}), ...(s.title ? { title: s.title } : {}) })), active: out.active } : null); })()`);
console.log("saved query spec", JSON.stringify(saved));
observe("13 저장된 타일 상태(scripts · active — sql 은 글자 수)", saved);
const savedLists = (saved?.scripts ?? []).filter((s) => s.list).map((s) => s.list);
const pubSaved = (saved?.scripts ?? []).find((s) => s.list?.schema === "public");
check("13 저장 모양 — { n, list: { schema, kind } } · public = function · audit 있음", [savedLists.find((l) => l.schema === "public"), savedLists.some((l) => l.schema === "audit"), saved?.active === pubSaved?.n], [{ schema: "public", kind: "function" }, true, true]);
check("13 목록 탭 저장 칸에 sql · title · data 없음", (saved?.scripts ?? []).filter((s) => s.list).every((s) => s.sql === undefined && !s.title && !s.data), true);
// 다시 읽기
await ev(`(sessionStorage.setItem('h.reload', '1'), 1)`);
const callsBeforeReload = await ev(`window.__calls.length`);
void callsBeforeReload;
await reloadBoot(send, ev);
await waitModules();
await sleep(600);
// 부팅 경고(설정 화면의 것 — 이 판과 무관)는 처음 적재 때처럼 걷는다. 그 뒤(타일 복원부터)는 센다
bootNoise.push(...errors.filter((e) => /MessengerSettings/.test(e)));
for (let i = errors.length - 1; i >= 0; i--) if (/MessengerSettings/.test(errors[i])) errors.splice(i, 1);
const p13 = await panes();
cur = p13.find((p) => p.kind === "query" && p.conn === CONN_PG.id)?.id ?? cur;
check("13 다시 읽은 뒤 PG 타일 · 연결 열림", await waitFor(`${Qel()}?.getAttribute('data-query-state') === 'open'`, 8000), true);
await waitFor(`!!${GRID()}`, 6000);
const H2 = await handleOf();
const at13 = await activeTab();
const ls13 = await listState();
check("13 다시 읽은 뒤 목록 탭 둘 · 활성 = public · 종류 = 함수", [await listTabCount(), at13?.list, ls13?.sel, ls13?.grid], [2, "public", "function", "function"]);

// ── 12 트리 없이 목록 탭이 직접 읽음 ─────────────────────────────────────────────
check("12 다시 읽은 뒤 트리의 public 은 접힘(트리는 public 을 읽지 않음)", await expandedOf(TROW("schema", "public")), "false");
check("12 목록 탭이 db_objects(public) 를 직접 1번 읽어 표를 채움", [await objCalls("public", H2), (ls13?.names ?? []).length], [1, 3]);
// 트리를 닫고(사이드 접기) 아직 안 본 audit 탭으로 — 그 탭이 마운트되며 직접 읽는다
await clickEl(TOGGLE());
await waitFor(`!${Qel()}?.querySelector('.main > .tree-side')`, 3000);
check("12 사이드 접힘(.tree-side 없음)", await ev(`!${Qel()}?.querySelector('.main > .tree-side')`), true);
const a12before = await objCalls("audit", H2);
await clickEl(LTAB("audit"));
await waitFor(`${LIST()}?.dataset.queryListSchema === 'audit' && (${LIST()}?.querySelectorAll('[data-query-list-row]').length ?? 0) > 0`, 5000);
check("12 트리 숨긴 채 audit 목록 탭 — 직접 db_objects(audit) 1번 · 표 채움", [(await objCalls("audit", H2)) - a12before, ((await listState())?.names ?? []).length > 0], [1, true]);
await clickEl(TOGGLE());
await waitFor(`!!${Qel()}?.querySelector('.main > .tree-side')`, 3000);
await sleep(400);

// ── 14 닫기(확인 없음) ───────────────────────────────────────────────────────────
const lt14 = await listTabCount();
await clickEl(`${LTAB("audit")}?.querySelector('.stab-x')`);
await sleep(400);
check("14 목록 탭 × → 확인 없이 닫힘", [lt14 - (await listTabCount()), await ev(`!!document.querySelector('[role="alertdialog"], [role="dialog"]')`)], [1, false]);
await clickEl(LTAB("public"));
await ev(`${GRID()}?.focus()`);
// Ctrl+W 는 Chromium 의 예약 단축키라 CDP 로 보내면 페이지가 막아도 헤드리스 탭 자체가 닫힌다(WebView2 앱에서는 페이지가 받는다) —
// 표에서 합성 keydown 을 올려 타일 처리기(`QueryView` 의 `onTileKey`)가 받게 한다
await ev(`(${GRID()})?.dispatchEvent(new KeyboardEvent('keydown', { key: 'w', code: 'KeyW', ctrlKey: true, bubbles: true, cancelable: true, composed: true }))`);
await sleep(400);
check("14 목록 탭 Ctrl+W → 확인 없이 닫힘", [await listTabCount(), await ev(`!!document.querySelector('[role="alertdialog"], [role="dialog"]')`)], [0, false]);

// ── 15 SQLite ───────────────────────────────────────────────────────────────────
await ev(`(async () => { const m = await ${Q}; m.openQueryTile(${q(CONN_LITE.id)}, ${q(CONN_LITE.name)}); return true; })()`);
await sleep(1200);
const lite = (await panes()).find((p) => p.kind === "query" && p.conn === CONN_LITE.id)?.id ?? null;
check("15 SQLite 타일이 곁에 섬 · 연결 열림", [typeof lite === "string", await waitFor(`${Qel(lite)}?.getAttribute('data-query-state') === 'open'`, 8000)], [true, true]);
await waitFor(`!!(${TROW("folder", "테이블", null, SIDE(lite))})`, 5000);
await dblEl(TROW("folder", "테이블", null, SIDE(lite)));
await waitFor(`!!${GRID(lite)}`, 4000);
const ls15 = await listState(lite);
check("15 SQLite 폴더 두 번 누르기 → 목록 탭(main · 테이블)", [(await activeTab(lite))?.list, ls15?.sel], ["main", "table"]);
check("15 SQLite 테이블 칸 = 이름 · 종류(행 · 설명 없음)", ls15?.head, ["name", "kind"]);
await pickKindBtn("view", lite);
check("15 SQLite 뷰 칸 = 이름 · 종류", (await listState(lite))?.head, ["name", "kind"]);
await pickKindBtn("table", lite);
await shot("l6-sqlite.png");

// ── 16 좁은 타일 ────────────────────────────────────────────────────────────────
await focusTile();
// PG 타일에 public 목록 탭을 다시(14 에서 닫음) — 트리의 스키마 두 번 누르기
if ((await expandedOf(TROW("schema", "public"))) === "true") await clickEl(TROW("schema", "public"));
await dblEl(TROW("schema", "public"));
await waitFor(`!!${GRID()}`, 4000);
await pickKindBtn("table");
const w400 = await setW(400);
await sleep(400);
const olW400 = await ev(`${LIST()}?.offsetWidth ?? 0`);
const h400 = (await listState())?.head;
await shot("l5-narrow-400.png");
await pickKindBtn("function");
const h400f = (await listState())?.head;
const w300 = await setW(300);
await sleep(400);
const olW300 = await ev(`${LIST()}?.offsetWidth ?? 0`);
const h300f = (await listState())?.head;
await pickKindBtn("table");
const h300 = (await listState())?.head;
await shot("l5-narrow-300.png");
console.log("narrow", w400, olW400, w300, olW300);
check("16 420 아래(목록 폭 < 420) — 설명 칸 숨음", [olW400 < 420 && olW400 >= 320, h400, h400f], [true, ["name", "kind", "rows"], ["name", "args", "returns"]]);
check("16 320 아래 — 종류 · 반환 칸도 숨음", [olW300 < 320, h300, h300f], [true, ["name", "rows"], ["name", "args"]]);
const overflow16 = await ev(`(() => { const l = ${LIST()}; const s = l?.querySelector('.subs'); return s ? s.scrollWidth <= s.clientWidth + 1 : null; })()`);
observe("16 300px 위 줄(.subs)이 넘치지 않음(종류 단추 줄은 가로 스크롤)", overflow16);
// 떠 있는 트리에서 스키마 두 번 누르기 — audit(목록 탭 없음)
await clickEl(TOGGLE());
await waitFor(`!!${DROP}`, 3000);
await waitFor(`!!(${TROW("schema", "audit", null, DROP)})`, 3000);
await dblEl(TROW("schema", "audit", null, DROP));
await sleep(600);
check("16 떠 있는 트리에서 스키마 두 번 누르기 → 트리 닫힘 · audit 목록 탭이 섬 · 활성", [await ev(`!!${DROP}`), (await activeTab())?.list, await waitFor(`!!${GRID()}`, 3000)], [false, "audit", true]);
await setW(900);
await sleep(400);

// ── 17 5,000 상한 ───────────────────────────────────────────────────────────────
await ev(`window.__trunc = { public: ['table'] }`);
await clickEl(LTAB("public"));
await pickKindBtn("table");
await clickEl(`${LIST()}?.querySelector('[data-query-list-refresh]')`);
await waitFor(`!!${LIST()}?.querySelector('[data-query-list-truncated]')`, 4000);
const ls17 = await listState();
check("17 잘린 종류 — 단추 숫자 4+ · 표 아래 truncated 줄", [(ls17?.kinds ?? []).find(([k]) => k === "table")?.[1], ls17?.truncated], ["4+", true]);
await ev(`window.__trunc = {}`);

// ── 19 구조 화면의 설명 ─────────────────────────────────────────────────────────
const STRUCT = () => `${Qel()}?.querySelector('.data-tab.on [data-query-data-structure]')`;
const openStruct = async (name) => {
  await clickEl(LTAB("public"));
  await pickKindBtn("table");
  await dblEl(`${LIST()}?.querySelector('[data-query-list-row="${name}"]')`);
  await waitFor(`(${Qel()}?.querySelector('.data-tab.on .subs .obj')?.textContent ?? '').endsWith(${q(name)})`, 3000);
  await clickEl(`${Qel()}?.querySelector('.data-tab.on [data-query-data-sub="structure"]')`);
  await waitFor(`!!${STRUCT()}?.querySelector('section table')`, 4000);
  await sleep(300);
};
const structState = () =>
  evj(`(() => { const s = ${STRUCT()}; if (!s) return 'null'; const p = s.querySelector('[data-query-struct-comment]'); const sec = [...s.querySelectorAll('section')].find((x) => x.querySelector('thead')); const tb = sec?.querySelector('table');
    const lbl = p?.querySelector('h4'); const txt = p?.querySelector('.tcomment'); const colHead = sec?.querySelector('h4');
    const headCss = (e) => (e ? [getComputedStyle(e).fontSize, getComputedStyle(e).fontWeight, getComputedStyle(e).color].join('|') : null);
    const cm = [...(tb?.querySelectorAll('td.cm') ?? [])].find((c) => c.textContent.trim());
    const lh = cm ? parseFloat(getComputedStyle(cm).lineHeight) || 16 : 0;
    return JSON.stringify({
      line: p ? { label: lbl?.textContent.trim() ?? null, labelFirst: p.firstElementChild === lbl, text: txt?.textContent ?? null,
        headAbove: !!lbl && !!txt && lbl.getBoundingClientRect().bottom <= txt.getBoundingClientRect().top + 1, aboveColumns: !!(p.compareDocumentPosition(sec) & 4),
        sameHead: !!lbl && headCss(lbl) === headCss(colHead), lines: txt ? Math.round((txt.getBoundingClientRect().height - 7) / (parseFloat(getComputedStyle(txt).lineHeight) || 16)) : 0 } : null,
      heads: [...(tb?.querySelectorAll('thead th') ?? [])].map((th) => th.textContent.trim()),
      rows: [...(tb?.querySelectorAll('tbody tr') ?? [])].map((tr) => [...tr.children].map((td) => td.textContent.trim())),
      cell: cm ? { ws: getComputedStyle(cm).whiteSpace, ow: getComputedStyle(cm).overflowWrap, lines: Math.round((cm.getBoundingClientRect().height - 6) / lh) } : null,
      typeLines: (() => { const c = tb?.querySelector('tbody tr td.mono'); return c ? Math.round((c.getBoundingClientRect().height - 6) / (parseFloat(getComputedStyle(c).lineHeight) || 16)) : null; })(),
      overflow: s.scrollWidth > s.clientWidth + 1 }); })()`);
await focusTile();
await openStruct("customers");
const s19 = await structState();
console.log("struct customers", JSON.stringify(s19));
check("19 설명 있는 테이블 — 컬럼 절 위의 '설명' 절(머리 아래 글)", [s19?.line?.label, s19?.line?.labelFirst, s19?.line?.headAbove, s19?.line?.aboveColumns, s19?.line?.text], ["설명", true, true, true, T_COMMENT]);
check("19 설명 절 머리가 컬럼 절 머리와 같은 꼴(크기 · 굵기 · 색)", s19?.line?.sameHead, true);
check("19 컬럼 표 머리 — 맨 오른쪽 '설명'", s19?.heads, ["이름", "형", "NULL", "기본값", "PK", "설명"]);
check("19 설명 칸 값 — 있는 컬럼은 글 · 없는 컬럼은 빈칸", (s19?.rows ?? []).map((r) => r.at(-1)), ["", C_COMMENT]);
check("19 설명 칸 줄바꿈 꼴(normal · anywhere)", [s19?.cell?.ws, s19?.cell?.ow], ["normal", "anywhere"]);
check("19 긴 설명이 다른 칸을 누르지 않음 — 형 칸(int8) 한 줄", s19?.typeLines, 1);
await shot("s1-struct-comment.png");
await openStruct("products");
const s19b = await structState();
check("19 설명 없는 테이블 — 설명 절 없음 · 칸 없음(PK 가 맨 끝)", [s19b?.line, s19b?.heads], [null, ["이름", "형", "NULL", "기본값", "PK"]]);
await shot("s2-struct-plain.png");
await openStruct("customers");
const w19 = await setW(420);
await sleep(400);
const s19c = await structState();
console.log("struct narrow", w19, JSON.stringify(s19c));
observe("19 420px 의 형 칸(int8) 줄 수", s19c?.typeLines);
check("19 좁은 타일(약 420px) — 칸 유지 · 긴 컬럼 설명은 여러 줄 · 설명 절 유지 · 가로 넘침 없음", [Math.abs(w19 - 420) < 12, s19c?.heads?.at(-1), (s19c?.cell?.lines ?? 0) > 1, s19c?.line?.text === T_COMMENT, s19c?.overflow], [true, "설명", true, true, false]);
await shot("s3-struct-narrow-420.png");
await setW(900);
await sleep(400);
await clickEl(LTAB("public"));

// ── 18 라이트 · 콘솔 ────────────────────────────────────────────────────────────
await focusTile();
await shot("l1b-table-dark-final.png");
await ev(`document.documentElement.dataset.theme = 'light'`);
await sleep(400);
await shot("l4-table-light.png");
const lightBg = await ev(`getComputedStyle(${LIST()}?.querySelector('[data-query-list-kind][aria-selected="true"]')).backgroundColor`);
observe("18 라이트 — 고른 종류 단추 바탕색", lightBg);
await ev(`delete document.documentElement.dataset.theme`);

// 데이터 탭의 `bind:this={dataRefs[x.n]}` 경고는 이 기능 전부터 있던 것 — 따로 적고 판정에서 뺀다
const preexisting = errors.filter((e) => /dataRefs\[/.test(e));
const fresh = errors.filter((e) => !/dataRefs\[/.test(e));
if (fresh.length) console.log("ERRORS\n  " + fresh.join("\n  "));
observe("18 기존 경고(데이터 탭 dataRefs — 이 기능 밖) 수", preexisting.length);
observe("18 다시 읽기 부팅 경고(MessengerSettings — 이 기능 밖) 수", bootNoise.length);
check("18 콘솔 오류 · 예외 · Svelte 경고 0(위 기존 경고 제외)", fresh, []);
const stubbed = await evj(`JSON.stringify([...new Set(window.__calls.map((c) => c[0]).filter((c) => c.startsWith('db_')))])`);
console.log("db calls", JSON.stringify(stubbed));
console.log("\nscreenshots:\n  " + shots.join("\n  "));
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
