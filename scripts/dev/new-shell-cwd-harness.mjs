// Headless harness: **새로 여는 터미널이 뜰 폴더** (docs/log/2026-09-27-new-terminal-cwd.md).
// 스텁은 `folder-convos-harness.mjs` 의 줄임판 — 셸 둘(pwsh · cmd) · AI CLI 하나 · 로컬 프로젝트 하나(aynx) · 원격 하나(api).
//
//   npx vite --port 1517 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9327 --user-data-dir=%TEMP%/edge-aynx-newcwd \
//     --window-size=1200,900 http://localhost:1517/
//   PAGE_PORT=1517 node scripts/dev/new-shell-cwd-harness.mjs outdir 9327
//
// 보는 것은 **백엔드로 나가는 값** 하나 — `open_local_session` 의 `cwd`(없으면 `null` = 홈):
// ① 빈 탭 → 홈 ② 셸이 알려 준 폴더 ③ 알려 주지 않는 셸(cmd) → 홈 ④ 파일 타일의 폴더 ⑤ AI — 설정 폴더 폴백
// ⑥ 프로젝트 탭(새 탭에서 열기) — 안이면 그 폴더 · 밖으로 cd 했으면 프로젝트 폴더 · SSH 포커스면 프로젝트 폴더 · AI 도
// ⑦ `Ctrl+Shift+N` · `>_` 메뉴(addLocal) 경로 ⑧ 원격 프로젝트 탭은 프로젝트 탭이 아니다 ⑨ 저장 짐에 `projectFolder` ⑩ 예외 0.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
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

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__chan = {};
  // 셸의 출력 한 조각을 그 세션의 채널로 민다 (blocks 판과 같은 모양) — OSC 9;9 로 폴더를 알린다
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  window.__listeners = {};
  performance.setResourceTimingBufferSize(5000);
  const HOSTS = [{ name: 'dev-01', host_name: '10.0.0.2', user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } }];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const PROJECTS = [
    { id: 'P1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: '', tmux: false, worktreeDir: null },
    { id: 'P2', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: '', tmux: false, worktreeDir: null },
  ];
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }, { id: 'cmd', label: 'Command Prompt' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }],
     load_snippets: null, 
     save_snippets: null, 
    save_settings: null,
    load_settings: { projects: { start_screen: 'off' }, ai: { start_dir: 'D:\\\\ai-home' } },
    host_history_list: {},
    projects_list: PROJECTS,
    ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12, close_ssh: null, close_session: null,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_lock: null,
    mcp_status: { clis: [{ id: 'claude', name: 'Claude Code', installed: true, registered: true, portMismatch: false }] },
    mcp_activity: null, list_forwards: [], session_log_path: null,
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
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++ });
      if (cmd === 'agent_autorun_command') return Promise.resolve(args.command);
      if (cmd === 'git_worktree_list') return Promise.resolve([]);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
counting = true;

const CTRL = 2, SHIFT = 8;
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(300); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const panesMod = importApp("app/panes.svelte.ts");
const projMod = importApp("app/projects.svelte.ts");
const plMod = importApp("app/project-list.svelte.ts");
const sessionsMod = importApp("app/sessions.svelte.ts");
const PROJECT = "C:\\src\\proj";

/** 지금 탭의 포커스 타일 id */
const focusId = async () => ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return t ? w.paneOf(t) : null; })()`);
/** `run` 을 부르고 새로 나간 `open_local_session` 들의 cwd 를 돌려준다 */
const opened = async (run, wait = 900) => {
  const before = await ev(`window.__calls.length`);
  const r = await ev(run);
  if (typeof r === "string" && r.startsWith("EXC")) console.log("  !", r);
  await sleep(wait);
  return JSON.parse(await ev(`JSON.stringify(window.__calls.slice(${before}).filter(c => c[0] === 'open_local_session').map(c => c[1].cwd))`));
};
/** 셸이 폴더를 알린다 — **진짜 바이트**(OSC 9;9)를 그 세션의 출력으로 민다: 읽는 쪽(`paneCwd`)이 터미널의 파서 값이다 */
const report = async (pid, cwd) => {
  const r = await ev(`(async () => { const ss = await ${sessionsMod}; const sid = ss.sessionOf('${pid}'); return window.__feed(sid, '\x1b]9;9;' + ${JSON.stringify(cwd)} + '\x07'); })()`);
  if (r !== "ok") console.log("  ! feed", r);
  await sleep(250);
};
/** 새 탭(평범한 탭)에 타일 하나 — 셸이 알려 줄 폴더는 `cwd` */
const plainTab = async (make, cwd) => {
  const pid = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = ${make}; w.openInNewTab(p); return p.id; })()`);
  await sleep(900);
  if (cwd) await report(pid, cwd);
  return pid;
};
const focus = async (pid) => { await ev(`(async () => { const w = await ${tabsMod}; const t = w.tabOfPane('${pid}'); w.focusTile(t.id, '${pid}'); })()`); await sleep(200); };
const openShell = `(async () => { const p = await ${panesMod}; await p.openDefaultShell(); })()`;
const openAi = `(async () => { const p = await ${panesMod}; await p.openAiPaneHere({ command: 'claude', id: 'claude' }); })()`;
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

await sleep(800);
// ── ① 빈 탭 → 홈 ─────────────────────────────────────────────────────────────
let got = await opened(openShell);
check(eq(got, [null]), `빈 탭(launcher)의 새 셸 → 홈 (${JSON.stringify(got)})`);

// ── ② 셸이 알려 준 폴더 ─────────────────────────────────────────────────────
const pw = await plainTab(`s.newLocalPane('pwsh')`, "C:\\work\\x");
got = await opened(openShell);
check(eq(got, ["C:\\work\\x"]), `포커스된 셸이 알려 준 폴더 (${JSON.stringify(got)})`);
await focus(pw);
got = await opened(openAi);
check(eq(got, ["C:\\work\\x"]), `AI 타일도 같은 폴더 (${JSON.stringify(got)})`);

// ── ③ 알려 주지 않는 셸(cmd — local_cwd 도 모름) → 홈 · AI 는 설정 폴더 ─────────────────
const cmd = await plainTab(`s.newLocalPane('cmd')`, null);
got = await opened(openShell);
check(eq(got, [null]), `폴더를 모르는 셸 → 홈 (${JSON.stringify(got)})`);
await focus(cmd);
got = await opened(openAi);
check(eq(got, ["D:\\ai-home"]), `AI 는 설정 [ai] start_dir 로 (${JSON.stringify(got)})`);

// ── ④ 파일 타일 ─────────────────────────────────────────────────────────────
await plainTab(`s.newLocalFsPane('C:\\\\docs')`, null);
got = await opened(openShell);
check(eq(got, ["C:\\docs"]), `파일 타일의 폴더 (${JSON.stringify(got)})`);

// ── ⑥ 프로젝트 탭 ───────────────────────────────────────────────────────────
await ev(`(async () => { const pl = await ${plMod}; await pl.refreshProjects?.(); })()`);
await sleep(300);
got = await opened(`(async () => { const pr = await ${projMod}; const p = pr.projectById('P1'); await pr.openProjectInNewTab(p); })()`);
check(eq(got, [PROJECT]), `프로젝트 새 탭 — 첫 셸은 그 폴더 (그대로) (${JSON.stringify(got)})`);
const tabInfo = JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return JSON.stringify({ pinned: t.pinnedTitle ?? null, folder: t.projectFolder ?? null }); })()`));
check(tabInfo.folder === PROJECT && tabInfo.pinned === "aynx", `탭에 프로젝트 폴더가 적힌다 (${JSON.stringify(tabInfo)})`);
const pShell = await focusId();
got = await opened(openShell);
check(eq(got, [PROJECT]), `프로젝트 탭 · 셸이 폴더를 아직 모름 → 프로젝트 폴더 (${JSON.stringify(got)})`);
await focus(pShell);
await report(pShell, "c:/SRC/proj/src/lib");
got = await opened(openShell);
check(eq(got, ["c:/SRC/proj/src/lib"]), `프로젝트 탭 · 안의 폴더(대소문자·구분자 무시) → 그 폴더 (${JSON.stringify(got)})`);
await focus(pShell);
await report(pShell, "C:\\Users\\me");
got = await opened(openShell);
check(eq(got, [PROJECT]), `프로젝트 탭 · 밖으로 cd → 프로젝트 폴더 (${JSON.stringify(got)})`);
await focus(pShell);
got = await opened(openAi);
check(eq(got, [PROJECT]), `프로젝트 탭 · AI 도 설정 폴더보다 프로젝트 폴더 (${JSON.stringify(got)})`);
// SSH 타일에 포커스
const sshId = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newSshPane('dev-01'); w.openPaneHere(p); return p.id; })()`);
await sleep(900);
await focus(sshId);
got = await opened(openShell);
check(eq(got, [PROJECT]), `프로젝트 탭 · SSH 포커스 → 프로젝트 폴더 (${JSON.stringify(got)})`);

// ── ⑦ 실제 입구 — Ctrl+Shift+N · >_ 메뉴(addLocal) ──────────────────────────
await focus(pShell);
await report(pShell, "C:\\src\\proj\\docs");
await ev(`document.querySelector('.xterm-helper-textarea')?.blur()`);
let before = await ev(`window.__calls.length`);
await key("KeyN", CTRL | SHIFT, "N"); await sleep(900);
got = JSON.parse(await ev(`JSON.stringify(window.__calls.slice(${before}).filter(c => c[0] === 'open_local_session').map(c => c[1].cwd))`));
check(eq(got, ["C:\\src\\proj\\docs"]), `Ctrl+Shift+N — 같은 규칙 (${JSON.stringify(got)})`);
await focus(pShell);
got = await opened(`(async () => { const p = await ${panesMod}; await p.addLocal({ id: 'cmd', label: 'Command Prompt' }); })()`);
check(eq(got, ["C:\\src\\proj\\docs"]), `>_ 메뉴의 셸 줄(addLocal) — 같은 규칙 (${JSON.stringify(got)})`);
console.log("capture:", await shot("new-shell-cwd.png"));

// ── ⑧ 원격 프로젝트 탭은 프로젝트 탭이 아니다 ─────────────────────────────────
await ev(`(async () => { const pr = await ${projMod}; await pr.openProjectInNewTab(pr.projectById('P2')); })()`);
await sleep(900);
const remoteTab = JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return JSON.stringify({ pinned: t.pinnedTitle ?? null, folder: t.projectFolder ?? null }); })()`));
check(remoteTab.pinned === "api" && remoteTab.folder === null, `원격 프로젝트 탭 — 제목만 고정, 폴더는 적지 않는다 (${JSON.stringify(remoteTab)})`);
got = await opened(openShell);
check(eq(got, [null]), `원격 프로젝트 탭의 새 셸 → 홈 (${JSON.stringify(got)})`);

// ── ⑨ 저장 짐 ──────────────────────────────────────────────────────────────
await sleep(1500);
const saved = await ev(`(() => { const c = window.__calls.filter(c => c[0] === 'workspaces_apply' && c[1]?.mutation?.op === 'putTabs').at(-1); if (!c) return null; return JSON.stringify(c[1].mutation.tabs.map(t => t.projectFolder ?? null)); })()`);
check(saved !== null && JSON.parse(saved).filter((x) => x === PROJECT).length === 1, `저장 짐에 프로젝트 탭 하나만 projectFolder (${saved})`);

// ── ⑩ 예외 ─────────────────────────────────────────────────────────────────
check(errors.length === 0, `예외 0 (${errors.length}${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
