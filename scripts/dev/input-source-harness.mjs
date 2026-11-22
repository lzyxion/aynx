// Headless harness: **터미널 입력의 출처**(`src/lib/term/input-source.ts` · `Terminal.svelte` 의 `inputContext`) — 진짜 xterm 타일에
// 신뢰된 입력(CDP `Input.dispatchMouseEvent` · `Input.dispatchKeyEvent`)을 쏘고 스텁이 받은 `write_session` 의 `source` 를 본다.
// 합성 `dispatchEvent` 로는 안 된다 — 신뢰된 이벤트는 리스너 사이에 마이크로태스크가 돌아, 마이크로태스크로 내리는 구간 깃발이
// xterm 처리기 전에 꺼지는 결함을 합성 이벤트는 재현하지 못한다.
//
//   node scripts/dev/run-harness.mjs input-source-harness.mjs <outdir>
//
// ① 일반 화면의 키 `a` = keyboard ② 대체 화면(마우스 추적 없음)의 휠 → 방향키 = mouse ③ 그 직후 키 = keyboard
// ④ 마우스 추적(?1000 · ?1006)의 클릭 → SGR 보고 = mouse ⑤ Ctrl+F3(`ESC[1;5R` — 커서 위치 답과 같은 모양) = keyboard ⑥ 예외 0.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { reloadBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9327";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1517";
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
await send("Page.enable"); await send("Runtime.enable");
const errors = [];
let counting = false;
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (counting && d.method === "Runtime.exceptionThrown") { const s = d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"; if (!/stub:/.test(s)) errors.push(s); } if (counting && d.method === "Runtime.consoleAPICalled" && d.params.type === "error") { const s = (d.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0]; if (!/stub:/.test(s)) errors.push("console.error " + s); } });

// 스텁은 `new-shell-cwd-harness.mjs` 의 줄임판 — 셸 하나 · 가짜 로컬 세션(`window.__feed` 로 셸 출력을 흉내 낸다).
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__chan = {};
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  window.__listeners = {};
  performance.setResourceTimingBufferSize(5000);
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
    load_snippets: null, save_snippets: null, save_settings: null,
    load_settings: { projects: { start_screen: 'off' }, terminal: { webgl: false } },
    host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, resize_session: null, write_session: null, close_session: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_lock: null,
    mcp_status: { clis: [] }, mcp_activity: null, list_forwards: [], session_log_path: null,
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    list_operations: { pending: [], recent: [] },
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    agent_sessions_list: { groups: [], others: [], othersMore: false },
    'plugin:notification|is_permission_granted': true,
    'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: args?.shell ?? 'pwsh' }); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await reloadBoot(send, ev);
counting = true;

const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const panesMod = importApp("app/panes.svelte.ts");
for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${panesMod}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
await ev(`(async () => { const p = await ${panesMod}; await p.openDefaultShell(); })()`);
await sleep(1500);
const sid = await ev(`Object.keys(window.__chan).at(-1) ?? null`);
const feed = async (text) => { const r = await ev(`window.__feed(${sid}, ${JSON.stringify(text)})`); if (r !== "ok") console.log("  ! feed", r); await sleep(300); };
await feed("PS C:\\> ");

// 보이는 터미널 화면의 가운데
const at = JSON.parse((await ev(`(() => { const el = [...document.querySelectorAll('.xterm-screen')].find((e) => e.getBoundingClientRect().width > 0); if (!el) return 'null'; const b = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`)) ?? "null");
check(sid !== null && at !== null, `셸 타일이 떴다 (session ${sid} · ${JSON.stringify(at)})`);
if (!at) { ws.close(); process.exit(1); }
const mouse = (type, opts = {}) => send("Input.dispatchMouseEvent", { type, x: at.x, y: at.y, button: "left", clickCount: 1, ...opts });
const click = async () => { await mouse("mousePressed"); await mouse("mouseReleased"); await sleep(300); };
const wheel = async (deltaY) => { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: at.x, y: at.y, deltaX: 0, deltaY }); await sleep(300); };
const typeChar = async (ch) => {
  const vk = ch.toUpperCase().charCodeAt(0);
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: ch, code: `Key${ch.toUpperCase()}`, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: ch, code: `Key${ch.toUpperCase()}`, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(300);
};
const mark = () => ev(`window.__calls.length`);
const writesSince = async (from) => JSON.parse(await ev(`JSON.stringify(window.__calls.slice(${from}).filter((c) => c[0] === 'write_session').map((c) => [c[1].data, c[1].source ?? null]))`));
const show = (ws) => JSON.stringify(ws);

// 포커스 — 마우스 추적 없는 일반 화면의 클릭은 셸에 아무것도 내지 않는다
await mouse("mouseMoved", { button: "none", clickCount: 0 });
await click();

// ── ① 일반 화면의 키 ────────────────────────────────────────────────────────
let from = await mark();
await typeChar("a");
let got = await writesSince(from);
check(got.length > 0 && got.every(([d, s]) => d === "a" && s === "keyboard"), `① 일반 화면의 키 a → keyboard ${show(got)}`);

// ── ② 대체 화면 · 마우스 추적 없음의 휠 → 방향키 ─────────────────────────────
await feed("\x1b[?1049h\x1b[H\x1b[2Jalt screen");
from = await mark();
await wheel(-120);
got = await writesSince(from);
const arrows = got.filter(([d]) => /^(?:\x1b[[O]A)+$/.test(d));
check(arrows.length > 0 && got.every(([, s]) => s === "mouse"), `② 대체 화면의 휠 → 방향키가 쓰이고 source = mouse ${show(got)}`);

// ── ③ 그 직후의 키 — 포인터 구간이 남지 않는다 ───────────────────────────────
from = await mark();
await typeChar("b");
got = await writesSince(from);
check(got.length > 0 && got.every(([d, s]) => d === "b" && s === "keyboard"), `③ 휠 직후의 키 b → keyboard ${show(got)}`);

// ── ④ 마우스 추적 + SGR 의 클릭 ───────────────────────────────────────────────
await feed("\x1b[?1000h\x1b[?1006h");
from = await mark();
await click();
got = await writesSince(from);
const sgr = got.map(([d]) => d).join("");
check(/^\x1b\[<0;\d+;\d+M\x1b\[<0;\d+;\d+m$/.test(sgr) && got.every(([, s]) => s === "mouse"), `④ 마우스 추적의 클릭 → SGR 누름 · 뗌, source = mouse ${show(got)}`);
await feed("\x1b[?1006l\x1b[?1000l");
await shot("input-source.png");

// ── ⑤ Ctrl+F3 = ESC[1;5R — 키 구간이 응답 모양을 이긴다 ──────────────────────
from = await mark();
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers: 2, key: "F3", code: "F3", windowsVirtualKeyCode: 114, nativeVirtualKeyCode: 114 });
await sleep(300);
got = await writesSince(from);
check(got.length > 0 && got.every(([d, s]) => d === "\x1b[1;5R" && s === "keyboard"), `⑤ Ctrl+F3 (ESC[1;5R) → keyboard ${show(got)}`);

// ── ⑥ 예외 ─────────────────────────────────────────────────────────────────
check(errors.length === 0, `⑥ 예외 0 (${errors.length}${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
