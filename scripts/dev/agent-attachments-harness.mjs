// Claude·Codex OS 파일 드롭: 첨부 미리보기 → 바이너리 저장 → 이 타일에 괄호 붙여넣기.
// 백엔드는 스텁이고 실제 Svelte 화면/터미널을 사용한다. AI CLI 자체를 실행하지 않는다.
// 실행: node scripts/dev/run-harness.mjs agent-attachments-harness.mjs <outdir>
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
    invoke: (cmd, args, options) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: args?.shell ?? 'pwsh' }); }
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++ });
      if (cmd === 'stage_agent_attachment') { window.__staged ??= []; window.__staged.push({ bytes: [...args], name: decodeURIComponent(options.headers['x-file-name']) }); return Promise.resolve('C:/copies/' + window.__staged.length + '/' + decodeURIComponent(options.headers['x-file-name'])); }
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

await send("Page.reload", { ignoreCache: true }); await sleep(4500);
counting = true;
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded: ${file}'); return await import(e); })()`;
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const sessionsMod = importApp("app/sessions.svelte.ts");
const open = async (cli) => {
  const pid = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newAiPane('${cli}'); w.openInNewTab(p); return p.id; })()`);
  await sleep(1200);
  await ev(`(async () => { const ss = await ${sessionsMod}; window.__feed(ss.sessionOf('${pid}'), '\x1b[?2004h'); })()`);
  await sleep(250); return pid;
};
const drop = async (pid) => ev(`(async () => {
  const el = document.querySelector('[data-pane="${pid}"] .xterm') ?? document.querySelector('[data-pane="${pid}"]');
  const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array([0,255,42])], '한글 image.png'));
  const rect = el.getBoundingClientRect();
  el.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: rect.x + 30, clientY: rect.y + 30 }));
  await new Promise(r => setTimeout(r, 50));
  const overlay = el.closest('[data-pane]').textContent;
  el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  await new Promise(r => setTimeout(r, 300));
  return { overlay, staged: window.__staged, writes: window.__calls.filter(c => c[0] === 'write_session').map(c => c[1]) };
})()`);
for (const cli of ['claude', 'codex']) {
  const pid = await open(cli);
  await ev('window.__calls = []; window.__staged = []');
  const got = await drop(pid);
  console.log(cli, JSON.stringify(got));
  check(got?.overlay?.includes('AI 입력창에 파일 첨부'), `${cli} OS dragover shows attachment preview`);
  check(JSON.stringify(got?.staged?.[0]?.bytes) === '[0,255,42]', `${cli} binary file reaches staging`);
  const input = got?.writes?.filter(w => w.data?.includes('C:/copies/')) ?? [];
  check(input.length === 1 && input[0].data === "\x1b[200~'C:/copies/1/한글 image.png' \x1b[201~", `${cli} inserts bracketed path without Enter`);
  check(!got?.overlay?.includes('SSH 타일에만 업로드'), `${cli} does not show SSH-only notice`);
}
check(errors.length === 0, `runtime errors: ${JSON.stringify(errors)}`);
await shot('attachment.png');
ws.close(); process.exit(failed ? 1 : 0);
