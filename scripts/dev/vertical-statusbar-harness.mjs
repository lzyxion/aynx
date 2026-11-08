// 헤드리스 검증 — 세로(왼쪽) 상태줄: 낮은 창에서 메뉴가 스크롤하지 않고 사용량 고리가 아래로 밀린다.
// 메뉴 줄은 `minmax(28%, max-content)` — 넉넉하면 28% 지점, 메뉴가 더 길면 메뉴 끝에서 사용량이 시작한다.
//
// usage: node scripts/dev/run-harness.mjs vertical-statusbar-harness.mjs <prefix>
//   → <prefix>-vstatus-800.png · -vstatus-480.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const [outdir = "out"] = process.argv.slice(2);
const STYLE = "pill";
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? "9224"}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
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
const shot = async (path) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) { fs.writeFileSync(path, Buffer.from(r.result.data, "base64")); return "ok"; }
    await sleep(500);
  }
  return "capture failed";
};
const mouse = (type, x, y) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });

let bad = 0;
const check = (name, ok, got) => {
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0;
  const evts = new Map();
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    load_settings: { app: { status_bar: 'left' }, terminal: { tab_style: ${JSON.stringify(STYLE)} } },
    list_forwards: [], reap_window_sessions: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    list_operations: { pending: [], recent: [] }, mcp_activity: null,
    vault_status: { state: 'off', hasMaster: false, entryCount: 0 },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [],
    agent_usage_limits: [
      { agent: 'claude', measuredAt: Date.now(), seen: true, windows: [{ windowMinutes: 300, kind: 'five_hour', usedPercent: 40, resetsAt: Math.floor(Date.now() / 1000) + 3600 }] },
      { agent: 'codex', measuredAt: Date.now(), seen: true, windows: [{ windowMinutes: 300, kind: 'five_hour', usedPercent: 10, resetsAt: Math.floor(Date.now() / 1000) + 3600 }] },
    ],
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
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

/** 세로 상태줄의 세 칸 — 메뉴 · 사용량 · 후미 */
const read = async () => JSON.parse(await ev(`JSON.stringify((() => {
  const s = document.querySelector('.statusbar.vertical');
  if (!s) return null;
  const c = getComputedStyle(s), r = s.getBoundingClientRect();
  const tools = s.querySelector('[data-status-tools]'), lead = s.querySelector('.lead'), mid = s.querySelector('[data-status-middle]');
  const tail = s.querySelector('[data-status-tail]'), rings = s.querySelector('[data-usage-rings]');
  const inner = r.height - parseFloat(c.paddingTop) - parseFloat(c.paddingBottom) - parseFloat(c.borderTopWidth) - parseFloat(c.borderBottomWidth);
  const top = r.top + parseFloat(c.paddingTop) + parseFloat(c.borderTopWidth);
  return {
    h: Math.round(r.height),
    leadScrolls: lead.scrollHeight > lead.clientHeight + 1 || ['auto', 'scroll'].includes(getComputedStyle(lead).overflowY),
    midScrolls: ['auto', 'scroll'].includes(getComputedStyle(mid).overflowY),
    toolsBottom: Math.round(tools.getBoundingClientRect().bottom), leadBottom: Math.round(lead.getBoundingClientRect().bottom),
    midTop: Math.round(mid.getBoundingClientRect().top),
    ringsTop: rings ? Math.round(rings.getBoundingClientRect().top) : null,
    ringsN: s.querySelectorAll('[data-usage-ring]').length,
    midBottom: Math.round(mid.getBoundingClientRect().bottom), tailTop: Math.round(tail.getBoundingClientRect().top),
    ratio: Math.round(((mid.getBoundingClientRect().top - top) / inner) * 1000) / 1000,
  };
})())`));

const boot = async (w, h) => {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await send("Page.reload", { ignoreCache: true });
  for (let i = 0; i < 60 && !(await ev(`document.querySelectorAll('.statusbar.vertical [data-usage-ring]').length === 2`)); i += 1) await sleep(500);
  await sleep(400);
};

// ── 1. 넉넉한 높이(800) — 예전 그대로: 사용량은 28% 지점에서 시작한다 ──────────────
await boot(1100, 800);
let s = await read();
if (!s || s.ringsN !== 2) { console.log("BOOT FAIL", s, await ev(`document.body.innerText.slice(0, 400)`)); process.exit(1); }
check("800: 사용량은 28% 지점에서 시작", Math.abs(s.ratio - 0.28) < 0.01, s.ratio);
check("800: 메뉴 · 사용량 스크롤 없음", !s.leadScrolls && !s.midScrolls, s);
await shot(`${outdir}-vstatus-800.png`);

// ── 2. 창 최소 높이(480) — 메뉴가 28% 보다 길다: 스크롤 없이 제 키를 다 쓰고 사용량이 밀린다 ──
await boot(1100, 480);
s = await read();
check("480: 메뉴가 스크롤하지 않는다", !s.leadScrolls, s);
check("480: 사용량 칸은 메뉴 끝 아래에서 시작(겹치지 않음)", s.midTop >= s.leadBottom && s.ringsTop >= s.leadBottom, s);
check("480: 사용량 칸도 스크롤 없음", !s.midScrolls, s);
check("480: 사용량이 28% 보다 아래로 밀렸다", s.ratio > 0.28, s.ratio);
check("480: 후미와 겹치지 않는다", s.midBottom <= s.tailTop + 1, s);
await shot(`${outdir}-vstatus-480.png`);

console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
