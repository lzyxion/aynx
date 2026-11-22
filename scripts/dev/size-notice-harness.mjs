// Headless harness: **다른 기기 크기 안내의 카드**(`src/lib/term/size-notice.ts` 의 `placeCard` · `term/SizeNotice.svelte`) — 가짜 로컬 세션에
// 임대를 실어 열고, 스텁의 리스너로 `session-size-owner` 를 쏴 이 타일을 주인 아님으로 만든다.
//
//   node scripts/dev/run-harness.mjs size-notice-harness.mjs <outdir>
//
// ① 작은 주인 크기 → 옆/아래 빈자리 카드(✕ · 설명 줄 없음) ② 큰 주인 크기 → 상자 안 오른쪽 아래 구석에 겹친 카드(✕ 있음 · 꼬리표는 표시뿐)
// ③ ✕ → 카드 사라짐 · 꼬리표 단추 → 팝 ④ 다시 주인 → 주인 아님이면 카드가 다시 뜬다 ⑤ [이 창 크기로] → `claim_session_size` ⑥ 예외 0.
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

// 스텁은 `input-source-harness.mjs` 의 것에 임대 · `window.__emit`(Tauri 이벤트 콜백 모양 `{ event, id, payload }`) · `claim_session_size` 를 더했다.
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100; let evId = 0;
  window.__chan = {};
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  window.__listeners = {};
  window.__emit = (event, payload) => { const hs = window.__listeners[event] ?? []; for (const h of hs) cbs.get(h)?.({ event, id: ++evId, payload }); return hs.length; };
  window.LEASE = { stream: 'h-size', sessionEpoch: 1, leaseEpoch: 1 };
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
    claim_session_size: true,
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
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: args?.shell ?? 'pwsh', lease: window.LEASE }); }
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
await ev(`window.__feed(${sid}, ${JSON.stringify("PS C:\\> ")})`);
await sleep(300);

// 포커스(활성 타일) — 카드는 활성 타일에만 뜬다
const at = JSON.parse((await ev(`(() => { const el = [...document.querySelectorAll('.xterm-screen')].find((e) => e.getBoundingClientRect().width > 0); if (!el) return 'null'; const b = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + 20), y: Math.round(b.top + 10) }); })()`)) ?? "null");
check(sid !== null && at !== null, `셸 타일이 떴다 (session ${sid})`);
if (!at) { ws.close(); process.exit(1); }
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: at.x, y: at.y, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: at.x, y: at.y, button: "left", clickCount: 1 });
await sleep(300);

const owner = async (leaseEpoch, cols, rows) => {
  const n = await ev(`window.__emit('session-size-owner', { stream: 'h-size', sessionEpoch: 1, leaseEpoch: ${leaseEpoch}, cols: ${cols}, rows: ${rows}, primary: false })`);
  await sleep(700);
  return n;
};
// 보이는 `.term` 과 그 안 안내 요소의 rect · 글자
const state = async () => JSON.parse(await ev(`(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: Math.round(b.left), t: Math.round(b.top), r: Math.round(b.right), b: Math.round(b.bottom) }; };
  const term = [...document.querySelectorAll('.term')].find((e) => e.querySelector('.xterm-screen') && e.getBoundingClientRect().width > 0);
  const card = term?.querySelector('.size-card') ?? null;
  const tag = term?.querySelector('.size-tag') ?? null;
  const shot = term?.querySelector('.xterm-screen') ?? null;
  return JSON.stringify({
    term: r(term?.querySelector('.term-screen')), screen: r(shot), card: r(card),
    x: !!card?.querySelector('.size-card-x'),
    xLabel: card?.querySelector('.size-card-x')?.getAttribute('aria-label') ?? null,
    body: !!card?.querySelector('.size-card-body'),
    title: card?.querySelector('.size-card-title')?.textContent?.trim() ?? null,
    btns: [...(card?.querySelectorAll('.size-card-actions button') ?? [])].map((b) => b.textContent.trim()),
    text: card?.textContent?.replace(/\\s+/g, ' ').trim() ?? null,
    tag: tag ? (tag.tagName + (tag.classList.contains('interactive') ? '.interactive' : '')) : null,
    pop: !!term?.querySelector('.size-pop'),
  });
})()`));
const show = (s) => JSON.stringify({ card: s.card, screen: s.screen, term: s.term, x: s.x, tag: s.tag, text: s.text });

// ── ① 작은 주인 크기 → 옆/아래 빈자리 ─────────────────────────────────────────
const listeners = await owner(2, 40, 10);
let s = await state();
const textOnly = s.text === [s.title, ...s.btns].join(" ").trim();
const beside = s.card && s.screen && (s.card.l >= s.screen.r || s.card.t >= s.screen.b);
check(listeners > 0 && !!s.card && beside && !s.x && !s.body && textOnly && s.tag === "DIV", `① 40×10 → 옆/아래 빈자리 카드 · ✕ 없음 · 설명 줄 없음 ${show(s)}`);
await shot("side.png");

// ── ② 큰 주인 크기 → 상자 안 오른쪽 아래 구석 ───────────────────────────────
await owner(2, 400, 120);
s = await state();
const GAP = 12;
const inside = s.card && s.term && s.card.l >= s.term.l && s.card.t >= s.term.t && s.card.r <= s.term.r && s.card.b <= s.term.b;
const corner = s.card && s.term && Math.abs(s.term.r - s.card.r - GAP) <= 24 && Math.abs(s.term.b - s.card.b - GAP) <= 24;
check(!!s.card && inside && corner && s.x && !s.body && s.tag === "DIV", `② 400×120 → 상자 안 오른쪽 아래 구석 · ✕ 있음(${s.xLabel}) · 꼬리표는 표시뿐 ${show(s)}`);
await shot("over.png");

// ── ③ ✕ → 꼬리표 단추 → 팝 ───────────────────────────────────────────────────
const clickSel = async (sel) => {
  const p = JSON.parse((await ev(`(() => { const t = [...document.querySelectorAll('.term')].find((e) => e.querySelector('.xterm-screen') && e.getBoundingClientRect().width > 0); const el = t?.querySelector(${JSON.stringify(sel)}); if (!el) return 'null'; const b = el.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`)) ?? "null");
  if (!p) return false;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y, button: "none" });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await sleep(400);
  return true;
};
await clickSel(".size-card-x");
s = await state();
const afterX = !s.card && s.tag === "BUTTON.interactive";
await clickSel(".size-tag.interactive");
const s3 = await state();
check(afterX && s3.pop, `③ ✕ → 카드 사라짐 · 꼬리표 단추(${s.tag}) → 팝 열림(${s3.pop})`);

// ── ④ 다시 주인 → 다시 주인 아님 → 카드가 다시 뜬다 ─────────────────────────
await owner(1, 400, 120);
const mine = await state();
await owner(2, 400, 120);
s = await state();
check(!mine.tag && !!s.card && s.x, `④ 주인(꼬리표 ${mine.tag}) → 다시 주인 아님 → 겹친 카드가 다시 뜬다 ${show(s)}`);
const primaryLabel = s.btns?.[0] ?? "?";

// ── ⑤ [이 창 크기로] → claim_session_size ───────────────────────────────────
const from = await ev(`window.__calls.length`);
await clickSel(".size-card-actions button.primary");
await sleep(300);
const claims = JSON.parse(await ev(`JSON.stringify(window.__calls.slice(${from}).filter((c) => c[0] === 'claim_session_size').map((c) => c[1]))`));
s = await state();
check(claims.length === 1 && claims[0].leaseEpoch === 1 && !s.card && !s.tag, `⑤ 겹친 카드 [${primaryLabel}] → claim_session_size ${JSON.stringify(claims)} · 안내 사라짐`);

// ── ⑥ 예외 ─────────────────────────────────────────────────────────────────
check(errors.length === 0, `⑥ 예외 · console.error 0 (${errors.length}${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
