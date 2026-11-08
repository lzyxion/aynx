// 헤드리스 검증 — **탭 슬라이드 중 포커스가 앱 틀을 밀지 않는다** (2026-11-06).
//
// 증상: 프로젝트 시작 화면 탭 둘 — 한쪽에서 타일을 열고 곧바로 다른 시작 화면 탭으로 옮기면, 숨은 채팅 독이 고정된 듯 드러나고 타일이 그 폭만큼 잘린다.
// 재현 절차를 키로 그대로 밟고, 그동안 앱 틀(`.app` · `.body`)의 스크롤과 채팅 독이 창 안으로 들어왔는지를 프레임마다 적는다.
//
//   node scripts/dev/run-harness.mjs tab-focus-scroll-harness.mjs <outdir> --size 1200x900
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9252"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1436";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
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
let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (!r.result?.data) return;
  const p = path.join(outdir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log("PNG " + path.resolve(p));
};
await send("Page.enable");
await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; let nextSession = 100;
  window.__listeners = {};
  performance.setResourceTimingBufferSize(5000);
  const A = 'C:\\\\src\\\\alpha', B = 'C:\\\\src\\\\beta';
  const PROJECTS = [
    { id: 'P1', name: 'alpha', host: null, path: A, shell: null, command: '', tmux: false },
    { id: 'P2', name: 'beta', host: null, path: B, shell: null, command: '', tmux: false },
  ];
  const NOW = Date.now();
  const id = (i) => '11111111-2222-4333-8444-' + String(i).padStart(12, '0');
  const S = (i, cwd) => ({ agent: 'claude', id: id(i), cwd, branch: 'main', title: 'Conversation ' + i, titleSource: 'ai', startedAt: NOW - 7200000 - i * 1000, updatedAt: NOW - 3600000 - i * 1000, model: 'claude-opus-5', forkedFrom: null, cwdExists: true });
  const CONVOS = { 'c:/src/alpha': [1, 2, 3].map((i) => S(i, A)), 'c:/src/beta': [4, 5, 6].map((i) => S(i, B)) };
  const key = (p) => p.replaceAll('\\\\', '/').replace(/\\/+$/, '').toLowerCase();
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }],
    load_snippets: null, save_snippets: null, save_settings: null, host_history_list: {},
    projects_list: PROJECTS, session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, close_ssh: null, close_session: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_lock: null,
    mcp_status: { clis: [] }, mcp_activity: null, list_forwards: [], session_log_path: null,
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    list_operations: { pending: [], recent: [] },
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    'plugin:notification|is_permission_granted': true,
    'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'git_worktree_list') return Promise.resolve([]);
      if (cmd === 'load_settings') return Promise.resolve({});
      if (cmd === 'agent_sessions_list') return Promise.resolve({ groups: args.cwds.map((c) => ({ cwd: c, exists: true, sessions: CONVOS[key(c)] ?? [], more: false })), others: [], othersMore: false });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);

const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const projMod = importApp("app/projects.svelte.ts");
const plMod = importApp("app/project-list.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");

const openNewTab = async (pid) => {
  await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectInNewTab(l.projects().find(p => p.id === '${pid}')); })()`);
  await sleep(900);
};
/** 지금 탭의 몸 — 프로젝트 이름 · 잎 종류 */
const tabs = async () =>
  JSON.parse(
    await ev(`(async () => { const w = await ${tabsMod}; return JSON.stringify({ ids: w.currentWorkspaceTabs().map(t => t.id), titles: w.currentWorkspaceTabs().map(t => t.title), active: w.activeTab()?.id, kind: w.activeTab()?.root?.pane?.kind ?? null }); })()`),
  );
const keyTap = async (code, k, modifiers = 0, vk = 0) => {
  for (const type of ["keyDown", "keyUp"]) {
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && !modifiers && k.length === 1 ? { text: k } : {}) });
  }
};
const CTRL = 2;

/** 프레임마다 앱 틀의 스크롤 · 독의 왼쪽 끝을 적는다 */
const WATCH = `(() => {
  const body = document.querySelector('.body'), app = document.querySelector('.app'), dock = document.querySelector('[data-chat-dock]');
  window.__watch = { body: 0, app: 0, html: 0, dockLeft: Infinity, stop: false };
  const tick = () => {
    const w = window.__watch;
    w.body = Math.max(w.body, Math.abs(body.scrollLeft), Math.abs(body.scrollTop));
    w.app = Math.max(w.app, Math.abs(app.scrollLeft), Math.abs(app.scrollTop));
    w.html = Math.max(w.html, Math.abs(document.documentElement.scrollLeft), Math.abs(document.body.scrollLeft));
    w.dockLeft = Math.min(w.dockLeft, dock.getBoundingClientRect().left);
    if (!w.stop) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  return true;
})()`;
const READ = `JSON.stringify((() => { const w = window.__watch; w.stop = true; const body = document.querySelector('.body'); const dock = document.querySelector('[data-chat-dock]'); return { peak: { body: w.body, app: w.app, html: w.html, dockLeft: w.dockLeft }, now: { body: body.scrollLeft, dockLeft: dock.getBoundingClientRect().left, open: dock.classList.contains('open') }, winW: innerWidth, overflow: getComputedStyle(body).overflowX }; })())`;

await openNewTab("P1");
await openNewTab("P2");
const before = await tabs();
console.log("tabs:", JSON.stringify(before));
check(before.ids.length >= 2, `시작 화면 탭 둘 (${before.titles.join(" · ")})`);

// 첫 탭(alpha)으로 돌아와 슬라이드가 끝나기를 기다린다
await keyTap("Tab", "Tab", CTRL, 9);
await sleep(900);
const atFirst = await tabs();
console.log("first:", JSON.stringify(atFirst));

// ① 절차 그대로 — 셸 타일을 열고(S) **곧바로** 다른 시작 화면 탭으로(Ctrl+Tab)
const focusRow = `(() => { const ps = [...document.querySelectorAll('[data-project-start]')].find(e => e.getClientRects().length > 0); ps?.querySelector('[data-sel="true"]')?.focus(); return !!ps; })()`;
check((await ev(focusRow)) === true, "시작 화면에 포커스");
await ev(WATCH);
await keyTap("KeyS", "s", 0, 83);
await keyTap("Tab", "Tab", CTRL, 9);
await sleep(1000);
const r1 = JSON.parse(await ev(READ));
console.log("after:", JSON.stringify(r1));
await shot("after-switch.png");
check(r1.overflow === "clip", `.body 는 스크립트 · 포커스로도 스크롤되지 않는다 (overflow-x ${r1.overflow})`);
check(r1.peak.body === 0 && r1.peak.app === 0 && r1.peak.html === 0, `전환 내내 앱 틀 스크롤 0 (body ${r1.peak.body} · app ${r1.peak.app} · html ${r1.peak.html})`);
check(r1.now.dockLeft >= r1.winW && !r1.now.open, `닫힌 채팅 독은 창 밖 (left ${r1.now.dockLeft} / ${r1.winW})`);
check(r1.peak.dockLeft >= r1.winW, `전환 중에도 독이 창 안으로 들어오지 않음 (최소 left ${r1.peak.dockLeft})`);

// ② 포커스 스크롤 자체가 틀을 못 민다 — 창 밖 독 안을 직접 스크롤 동반으로 포커스해 봐도 그대로(원인 격리)
const forced = JSON.parse(
  await ev(`JSON.stringify((() => { const body = document.querySelector('.body'); const t = document.createElement('button'); t.style.cssText = 'position:absolute;left:' + (innerWidth + 300) + 'px;top:10px'; body.appendChild(t); t.focus({ preventScroll: false }); const v = body.scrollLeft; t.remove(); return { v }; })())`),
);
check(forced.v === 0, `창 밖 요소에 스크롤 동반 포커스 → .body 안 밀림 (${forced.v})`);

// ③ 시작 화면 안의 스크롤은 살아 있다 — 낮은 창에서 ↓ 로 고른 줄이 보이게
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 420, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await ev(focusRow);
await keyTap("ArrowDown", "ArrowDown", 0, 40);
await keyTap("ArrowDown", "ArrowDown", 0, 40);
await sleep(300);
const inner = JSON.parse(
  await ev(`JSON.stringify((() => { const ps = [...document.querySelectorAll('[data-project-start]')].find(e => e.getClientRects().length > 0); const row = ps.querySelector('[data-sel="true"]'); const a = ps.getBoundingClientRect(), b = row.getBoundingClientRect(); return { top: ps.scrollTop, visible: b.top >= a.top - 1 && b.bottom <= a.bottom + 1 }; })())`),
);
check(inner.visible, `시작 화면 안 스크롤 유지 — 고른 줄이 보임 (scrollTop ${inner.top})`);

ws.close();
console.log(failed ? `FAILED ${failed}` : "ALL PASS");
process.exit(failed ? 1 : 0);
