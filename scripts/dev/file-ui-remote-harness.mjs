// 원격 창의 파일 타일 보기 요청 검증(2026-11-04 · docs/log/2026-11-04-file-ui-keep.md).
//   node scripts/dev/run-harness.mjs file-ui-remote-harness.mjs <outdir> --size 1100x800
//
// 헤드리스 스텁 — `window.__AYNX_REMOTE__` 로 뜨고 탭은 `mirror-layout` 방송(집 PC 출처)으로 세운다. `mirror_request` 는 스텁이 받아 적고, 실제 GUI · 주 창 왕복은 아니다
// (GUI 검사는 Rust `remote/mirror.rs` 시험, 주 창 적용은 `file-ui-keep-harness` 가 본다).
// 보는 것: ① 토글 → 바로 보임 + 요청 한 번(집 PC 열쇠) ② 그 값이 실린 거울 갱신에도 유지 ③ 슬라이더 연타 = 요청 하나 ④ 거절돼도 안내 없음 · 그 페이지 동안 값 유지 ⑤ 저장된 배치(집 PC 없음)면 보내지 않음.
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";

const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.env.CDP_PORT ?? process.argv[3] ?? "9224";
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
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
  }
  if (d.method === "Runtime.exceptionThrown") errors.push(String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text).slice(0, 240));
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  performance.setResourceTimingBufferSize(10000);
  window.__AYNX_REMOTE__ = true;
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__requests = []; window.__reject = null;
  const evts = new Map();
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] }, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [], list_snippets: [], list_forwards: [],
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [],
    agent_states_snapshot: [], local_home: 'C:\\\\h', local_roots: ['C:\\\\'], local_places: [], local_free_space: null,
    local_list: [], local_conflicts: [], projects_list: [], host_history_list: {},
  };
  window.__emit = (name, payload) => { for (const h of evts.get(name) ?? []) cbs.get(h)?.({ event: name, id: 0, payload }); };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'remote-h-1' }, currentWebview: { label: 'remote-h-1', windowLabel: 'remote-h-1' }, windows: [{ label: 'remote-h-1' }], webviews: [{ label: 'remote-h-1', windowLabel: 'remote-h-1' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      if (cmd === 'mirror_request') { window.__requests.push(args.request); return window.__reject ? Promise.reject(window.__reject) : Promise.resolve(null); }
      if (cmd === 'load_settings') return Promise.resolve({ app: { status_bar: 'bottom' }, automation: { auto_approve: false } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(600);

const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const T = importApp("app/tabs.svelte");
const P = importApp("app/panes.svelte");
const S = importApp("mirror/snapshot");

/** 집 PC 가 보낸 것처럼 거울을 민다 — `fields` 가 그 타일의 칸 */
const pushMirror = async (fields, source = "home") => {
  await ev(`(async () => {
    const s = await ${S};
    const pane = { id: 'home-1', kind: 'localfs', tileKey: 'fk', path: 'C:\\\\h', ...${JSON.stringify(fields)} };
    const tab = { id: 'home-tab', title: 'f', tabKey: 'tk', workspaceId: 'w1', root: { type: 'leaf', pane } };
    window.__emit('mirror-layout', s.buildSnapshot({
      source: ${JSON.stringify(source)}, workspace: { id: 'w1', name: 'W' }, tabs: [tab], activeTabId: 'home-tab', focusOf: () => 'home-1',
    }));
  })()`);
  await sleep(250);
};
const spec = () => ev(`(async () => { const t = await ${T}; for (const tab of t.residentWindowTabs()) { const stack = [tab.root]; while (stack.length) { const n = stack.pop(); if (n.type === 'leaf') { if (n.pane.kind === 'localfs') return JSON.stringify(n.pane); } else stack.push(n.a, n.b); } } return 'null'; })()`).then(JSON.parse);
const requests = () => ev(`JSON.stringify(window.__requests)`).then(JSON.parse);
const clearRequests = () => ev(`(window.__requests = [], 1)`);

await pushMirror({});
let p = await spec();
check(p?.tileKey === "fk", "거울로 파일 타일이 선다");
const id = p.id;

// ── ① 토글 — 바로 보이고 요청 한 번 ──────────────────────────────────────────
await ev(`${P}.then(m => m.noteFileUi(${JSON.stringify(id)}, { hidden: true }))`);
p = await spec();
check(p.fileHidden === true, "토글이 곧바로 이 창에 적힌다");
check((await requests()).length === 0, "묶는 동안은 아직 보내지 않는다");
await sleep(400);
let rs = await requests();
check(JSON.stringify(rs) === JSON.stringify([{ op: "fileUi", tile: "k:fk", hidden: true }]), `요청 한 번 · 집 PC 열쇠 (${JSON.stringify(rs)})`);
const last = await ev(`localStorage.getItem('aynx.files.lastUi')`);
check(String(last).includes("hidden"), "이 기기의 마지막 값에 적힌다");

// ── ② 집 PC 가 적은 값이 거울로 돌아와도 유지 ─────────────────────────────────
await pushMirror({ fileHidden: true });
p = await spec();
check(p.fileHidden === true, "그 값이 실린 거울 갱신 뒤에도 유지된다");

// ── ③ 슬라이더 연타 ─────────────────────────────────────────────────────────
await clearRequests();
for (const zoom of [0, 2, 3, 4, 3]) await ev(`${P}.then(m => m.noteFileUi(${JSON.stringify(id)}, { zoom: ${zoom} }))`);
await ev(`${P}.then(m => m.noteFileView(${JSON.stringify(id)}, 'icons'))`);
await sleep(400);
rs = await requests();
check(JSON.stringify(rs) === JSON.stringify([{ op: "fileUi", tile: "k:fk", zoom: 3, view: "icons" }]), `연타 = 끝값 요청 하나 (${JSON.stringify(rs)})`);

// ── ④ 거절 — 안내 없음 · 값 유지 ─────────────────────────────────────────────
await clearRequests();
await ev(`(window.__reject = '[mirror-missing] gone', 1)`);
const before = await ev(`document.body.innerText`);
await ev(`${P}.then(m => m.noteFileUi(${JSON.stringify(id)}, { preview: true }))`);
await sleep(600);
rs = await requests();
check(rs.length === 1, "거절될 요청도 한 번 보낸다");
const after = await ev(`document.body.innerText`);
const refuse = await ev(`${importApp("i18n/i18n.svelte")}.then(m => m.t('app.mirror.refuse.missing'))`);
check(!after.includes(refuse) && after.length <= before.length + 200, "거절돼도 안내가 뜨지 않는다");
p = await spec();
check(p.filePreview === true, "거절돼도 그 페이지 동안 값이 남는다");
await ev(`(window.__reject = null, 1)`);

// ── ⑤ 저장된 배치(집 PC 주 창 없음) — 보내지 않는다 ──────────────────────────
await pushMirror({}, "file");
await clearRequests();
const fileId = (await spec()).id;
await ev(`${P}.then(m => m.noteFileUi(${JSON.stringify(fileId)}, { hidden: false }))`);
await sleep(400);
check((await requests()).length === 0, "집 PC 가 없으면 보내지 않는다");

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" | ").slice(0, 300)})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAIL`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
