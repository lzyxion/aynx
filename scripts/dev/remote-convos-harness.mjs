// Headless harness: **원격 지난 대화** (docs/log/2026-09-27-remote-conversations.md).
// 스텁은 `folder-convos-harness.mjs` 의 줄임판 + `agent_sessions_remote_list`(덜 읽은 답 → 다 읽은 답 · 실패 · 늦음) ·
// `agent_session_remote_launch_spec`.
//
//   npx vite --port 1567 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9377 --user-data-dir=%TEMP%/edge-aynx-rconv \
//     --window-size=1200,900 http://localhost:1567/
//   PAGE_PORT=1567 node scripts/dev/remote-convos-harness.mjs outdir 9377
//
// 심어 두는 것: 원격 프로젝트 aynx-lab(dev-01 · `~/work/aynx-lab` · 시작 명령 claude · tmux 켬) + 로컬 프로젝트 하나. 서버의 대화 일곱
// (aynx-lab 셋 — 하나는 1분 전에 고쳐졌다 · api 셋 · 그 밖 하나). 목록 스텁은 처음 부르면 넷만(complete=false · 4/7), 다시 부르면 일곱.
//
// 보는 것: ① 붙은 세션이 없으면 읽지 않는다 — 시작 화면(호스트 칩 · "새로 시작 — dev-01에서" · 조용한 한 줄 · 단추) ② 그 호스트에
// 세션이 서면 시작 화면이 스스로 읽는다(이어 부름 · 칩 둘 · 줄 · 토큰) ③ 읽기 실패 → 한 줄, 새로 시작은 그대로 ④ 시작 화면 Enter =
// 그 자리에 SSH 재개 타일(별칭 · 폴더 · 명령 · 프로젝트의 tmux) ⑤ SSH 타일에서 Ctrl+Shift+Y — 그 서버 · 셸이 알려 준 폴더(칩 · 호스트 칩 ·
// 바닥 "방금 읽음 · F5") · 1분 캐시(다시 부르지 않음) ⑥ F5 = force ⑦ Enter = 옆에 SSH 타일(같은 탭 · 빛남 · 공유 별칭) ⑧ 열림 → 그 타일
// ⑨ Codex 줄 Shift+Enter = codex fork ⑩ Ctrl+Enter = 원격 기록 보기(2단계 — 붙은 세션으로 쪽 넘기기 · 이전 쪽 · 세션이 사라지면 한 줄)
// ⑪ 로컬 타일은 예전 그대로(원격 호출 없음) ⑫ 저장 짐 — 주소에 host · 대화 제목 없음 ⑬ 대시보드 "어디서" 칩(2단계 — 이 PC · dev-01 ·
// 흐린 lab-02(읽은 뒤 끊김 — 다시 부르지 않음) · 모두 · 한 목록 · 호스트 칩 · 서버 폴더) ⑭ 사용량 칸(출처가 Rust 요약 인자로 · 덮개 한 줄 ·
// [전체 사용량 읽기] 이어 부름 · 멈춤 없이 끝 · 원격 Codex 한도 · 이 PC 로 돌아가면 예전 그대로) ⑮ 예외 0.
// PNG: rconv-start-offline.png · rconv-start.png · rconv-picker.png · rconv-split.png · rconv-viewer.png · rconv-dash.png · rconv-usage.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9377";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1567";
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
  window.__listeners = {};
  performance.setResourceTimingBufferSize(5000);
  const HOSTS = [
    { name: 'dev-01', host_name: '10.0.0.2', user: 'deploy', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } },
    { name: 'lab-02', host_name: '10.0.0.3', user: 'deploy', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } },
  ];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const PROJECTS = [
    { id: 'P1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: '', tmux: false, worktreeDir: null },
    { id: 'P2', name: 'aynx-lab', host: 'dev-01', path: '~/work/aynx-lab', shell: null, command: 'claude', tmux: true, worktreeDir: null },
  ];
  const H = 3600_000, NOW = Date.now();
  const id = (i) => '11111111-2222-4333-8444-' + String(i).padStart(12, '0');
  const xid = (i) => '01a07989-25f8-7e72-99aa-' + String(i).padStart(12, '0');
  const LAB = '/home/deploy/work/aynx-lab', API = '/home/deploy/work/api';
  const R = (agent, i, cwd, title, ago, extra = {}) => ({ agent, id: agent === 'codex' ? xid(i) : id(i), cwd, branch: 'main', title, titleSource: 'ai', startedAt: NOW - ago - H, updatedAt: NOW - ago, model: null, forkedFrom: null, cwdExists: true, host: 'dev-01', tokens: null, ...extra });
  window.__rows = [
    R('claude', 2, LAB, 'Log rotation cron check', 60_000),
    R('claude', 1, LAB, 'Tidy the nginx reload script', 40 * 60_000),
    R('claude', 5, API, 'Add the API version header', 10 * 60_000),
    R('claude', 4, API, 'Trace the health check timeout', 2 * H),
    R('codex', 3, LAB, 'Deploy script dry-run', 26 * H, { tokens: 96_000 }),
    R('codex', 6, API, 'Rollback plan', 72 * H, { tokens: 88_000 }),
    R('claude', 7, '/srv/other', 'Something else', 120 * H),
  ];
  window.__remote = { fail: null, delay: 0, rounds: 0 };
  window.__launch = [];
  // 2단계 — 세션 번호 → 별칭(원격 목록 스텁이 호스트마다 다른 줄을 준다) · 기록 보기 · 사용량
  window.__sessAlias = {};
  window.__labRows = [
    { ...R('claude', 11, '/home/deploy/lab', 'Lab kernel tuning', 5 * H), host: 'lab-02' },
    { ...R('codex', 12, '/home/deploy/lab', 'Lab benchmark', 30 * H, { tokens: 12_000 }), host: 'lab-02' },
  ];
  window.__viewGone = false;
  window.__cov = {
    'dev-01': { counted: 5, pendingClaude: 2, pendingCodex: 0, pendingBytes: 34 * 1024 * 1024 },
    'lab-02': { counted: 1, pendingClaude: 1, pendingCodex: 0, pendingBytes: 2 * 1024 * 1024 },
  };
  window.__readRounds = 0;
  const day = (d) => { const x = new Date(NOW - d * 86400_000); return x.getFullYear() + '-' + String(x.getMonth() + 1).padStart(2, '0') + '-' + String(x.getDate()).padStart(2, '0'); };
  const T = (n) => ({ input: n, cacheRead: 0, cacheWrite: 0, output: 0 });
  const summary = (a) => {
    const hosts = a?.hosts ?? [];
    const local = a?.local ?? true;
    const today = (local ? 100 : 0) + hosts.length * 1000;
    const days = (n) => Array.from({ length: n }, (_, i) => ({ date: day(n - 1 - i), tokens: T(i === n - 1 ? today : 0), total: i === n - 1 ? today : 0 }));
    return { today: day(0), start: day(29), firstDay: day(0), agents: ['claude'], daily: days(30), recent: days(35),
      buckets: [{ date: day(0), agent: 'claude', model: 'claude-opus', tokens: T(today), total: today }],
      models: [{ agent: 'claude', model: 'claude-opus', tokens: T(today), total: today, conversations: 3 }],
      streak: 1, priorAvg: null, priorDays: 0, elapsedMs: 1,
      remote: hosts.map((h) => ({ host: h, readAt: NOW, ...window.__cov[h] })) };
  };
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: false }],
     load_snippets: null, 
     save_snippets: null, 
    save_settings: null, host_history_list: {}, projects_list: PROJECTS,
    ssh_remote_home: '/home/deploy', git_worktree_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12, close_ssh: null, close_session: null,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_lock: null,
    mcp_status: { clis: [] }, mcp_activity: null, list_forwards: [], session_log_path: null,
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    list_operations: { pending: [], recent: [] },
    agent_sessions_list: { groups: [], others: [], othersMore: false },
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    'plugin:notification|is_permission_granted': true,
    'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };
  const later = (v, ms) => new Promise((r) => setTimeout(() => r(v), ms));
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'open_ssh_session') { const sid = nextSession++; window.__sessAlias[sid] = args.alias; return Promise.resolve({ id: sid }); }
      if (cmd === 'agent_conversation_transcript_remote') {
        if (window.__viewGone) return Promise.reject('[session-gone] 세션을 찾을 수 없습니다');
        const it = (role, text) => ({ role, text, truncated: false, images: 0, tool: null, at: NOW });
        return Promise.resolve(args.before == null
          ? { items: [it('user', 'Recent question'), it('assistant', 'Recent **answer**')], cursor: 4096 }
          : { items: [it('user', 'First question')], cursor: null });
      }
      if (cmd === 'agent_usage_summary') return Promise.resolve(summary(args));
      if (cmd === 'agent_usage_remote_limits') return Promise.resolve([{ agent: 'codex', windows: [{ windowMinutes: 300, kind: 'primary', usedPercent: 42, resetsAt: Math.floor(NOW / 1000) + 3600 }], measuredAt: NOW, seen: true }]);
      if (cmd === 'agent_usage_remote_read') {
        window.__readRounds++;
        const done = window.__readRounds >= 2;
        if (done) window.__cov['dev-01'] = { counted: 7, pendingClaude: 0, pendingCodex: 0, pendingBytes: 0 };
        return later({ host: 'dev-01', doneBytes: done ? 34 * 1024 * 1024 : 10 * 1024 * 1024, totalBytes: 34 * 1024 * 1024, pending: done ? 0 : 2, complete: done }, 300);
      }
      if (cmd === 'load_settings') return Promise.resolve(window.__settings ?? {});
      if (cmd === 'agent_autorun_command') return Promise.resolve(args.command);
      if (cmd === 'agent_sessions_remote_list') {
        const r = window.__remote;
        if (r.fail) return Promise.reject(r.fail); // Tauri 는 글자로 거절한다
        if (window.__sessAlias[args.id] === 'lab-02') {
          return Promise.resolve({ host: 'lab-02', sessions: window.__labRows, total: 2, done: 2, complete: true, readAt: Date.now(), home: '/home/deploy' });
        }
        r.rounds++;
        // 처음 부르면(또는 force) 넷만 — 이어 부르면 전부. Rust 가 몇 초씩 끊어 읽는 모양
        const partial = args.force || r.rounds === 1;
        const rows = partial ? window.__rows.slice(0, 4) : window.__rows;
        const reply = { host: 'dev-01', sessions: rows, total: 7, done: rows.length, complete: !partial, readAt: Date.now(), home: '/home/deploy' };
        return later(reply, r.delay);
      }
      if (cmd === 'agent_session_remote_launch_spec') {
        window.__launch.push(args);
        const s = window.__rows.find((x) => x.id === args.id);
        const line = s.agent === 'codex' ? 'codex ' + args.mode + ' ' + args.id : 'claude --resume ' + args.id + (args.mode === 'fork' ? ' --fork-session' : '');
        return Promise.resolve({ cwd: s.cwd, command: line });
      }
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

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9, F5: 116 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && k === "Enter" ? { text: String.fromCharCode(13) } : {}) }); await sleep(300); };
const CTRL = 2, SHIFT = 8;
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const projMod = importApp("app/projects.svelte.ts");
const plMod = importApp("app/project-list.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const cwdMod = importApp("app/pane-cwd.svelte.ts");
const rcMod = importApp("app/remote-conversations.svelte.ts");
const PICK = `document.querySelector('[data-folder-convos]')`;
const PS = `[...document.querySelectorAll('[data-project-start]')].find(e => e.getClientRects().length > 0)`;
const WALK = `const walk = (n, o) => (n.type === 'leaf' ? o.push(n.pane) : (walk(n.a, o), walk(n.b, o)), o);`;
const state = async () => JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; ${WALK} const t = w.activeTab(); return JSON.stringify({ n: w.currentWorkspaceTabs().length, tab: t?.id ?? null, focus: t ? w.paneOf(t) : null, panes: t ? walk(t.root, []).map(p => ({ id: p.id, kind: p.kind, alias: p.alias ?? null, start: p.startProject ?? null, autorun: p.autorun ?? null, cwd: p.cwd ?? null, forceTmux: p.forceTmux ?? null, noTmux: p.noTmux ?? null, inject: p.injectMcpToken ?? null })) : [] }); })()`));
const remoteCalls = () => ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'agent_sessions_remote_list').map(c => c[1]))`).then(JSON.parse);
const API = "/home/deploy/work/api";
const id = (i) => "11111111-2222-4333-8444-" + String(i).padStart(12, "0");
const xid = (i) => "01a07989-25f8-7e72-99aa-" + String(i).padStart(12, "0");
const startView = async () => JSON.parse(await ev(`(() => { const p = ${PS}; if (!p) return JSON.stringify(null); return JSON.stringify({ remote: p.dataset.remote ?? null, host: p.querySelector('[data-start-host]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, newHead: p.querySelector('h3')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, acts: [...p.querySelectorAll('[data-start-action]')].map(b => b.dataset.startAction), quiet: p.querySelector('[data-start-loading]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, qstate: p.querySelector('[data-start-loading]')?.dataset.startRemoteState ?? null, chips: [...p.querySelectorAll('[data-scope-chip]')].map(c => c.textContent.trim() + (c.classList.contains('on') ? '*' : '')), rows: [...p.querySelectorAll('[data-start-row]')].map(r => r.dataset.startRow + ':' + r.dataset.state), sel: p.querySelector('[data-start-row].selected')?.dataset.startRow ?? null, progress: p.querySelector('[data-start-progress]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, err: p.querySelector('[data-start-error]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, keys: p.querySelector('[data-start-keys]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null }); })()`));
const picker = async () => JSON.parse(await ev(`(() => { const p = ${PICK}; if (!p) return JSON.stringify(null); return JSON.stringify({ remote: p.dataset.remote ?? null, source: p.dataset.source, scope: p.dataset.scope, chips: [...p.querySelectorAll('[data-scope-chip]')].map(c => c.textContent.trim() + (c.classList.contains('on') ? '*' : '')), where: p.querySelector('[data-fc-where]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, host: p.querySelector('[data-fc-host]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, rows: [...p.querySelectorAll('[data-fc-row]')].map(r => r.dataset.fcRow + ':' + r.dataset.state), metas: [...p.querySelectorAll('[data-fc-row] .cmeta')].map(m => m.textContent.replace(/\\s+/g, ' ').trim()), keys: p.querySelector('[data-fc-keys]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, quiet: p.querySelector('[data-fc-loading]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null }); })()`));
const focusPaneBody = async (paneId) => { await ev(`(async () => { const w = await ${tabsMod}; const t = w.tabOfPane('${paneId}'); w.focusTile(t.id, '${paneId}'); document.querySelector('[data-pane="${paneId}"] .xterm-helper-textarea')?.focus(); })()`); await sleep(300); };

// ── ① 붙은 세션이 없으면 읽지 않는다 — 원격 프로젝트의 시작 화면 ─────────────────
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectInNewTab(l.projects().find(p => p.id === 'P2')); })()`); await sleep(1200);
const labTab = (await state()).tab;
let st = await state();
check(st.panes.length === 1 && st.panes[0].kind === "start" && st.panes[0].start?.host === "dev-01" && st.panes[0].start?.folder === "~/work/aynx-lab", `원격 프로젝트 → 시작 화면(주소에 host) (${JSON.stringify(st.panes[0])})`);
let sv = await startView();
console.log("start offline:", JSON.stringify(sv));
check(sv.remote === "dev-01" && sv.host === "⇄ dev-01" && sv.newHead === "새로 시작 — dev-01에서", `호스트 칩 · "새로 시작 — dev-01에서" (${sv.host} · ${sv.newHead})`);
check(JSON.stringify(sv.acts) === JSON.stringify(["shell", "claude", "codex", "command"]), `새로 시작 — 셸 · 알려진 AI 전부(서버에 무엇이 깔렸는지 모른다) · 시작 명령 (${sv.acts})`);
check(sv.qstate === "offline" && sv.quiet?.startsWith("dev-01 연결이 없어"), `붙은 세션 없음 — 조용한 한 줄 (${sv.quiet})`);
check((await remoteCalls()).length === 0, "붙은 세션이 없으면 원격 목록을 부르지 않는다(새 접속 없음)");
console.log("capture:", await shot("rconv-start-offline.png"));

// ── ② 그 호스트에 세션이 서면 시작 화면이 스스로 읽는다 ───────────────────────────
await ev(`window.__remote.delay = 1500`);
const sshA = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newSshPane('dev-01'); w.openInNewTab(p, 'dev-01'); return p.id; })()`);
await sleep(300);
await ev(`(async () => { const w = await ${tabsMod}; const t = w.residentWindowTabs().find(t => t.id === '${labTab}'); w.focusTile(t.id, w.paneOf(t)); })()`);
await sleep(500);
sv = await startView();
console.log("start loading:", JSON.stringify(sv));
check(sv.qstate === "loading" && sv.quiet === "dev-01에서 읽는 중…", `읽는 중 — 조용한 한 줄 (${sv.quiet})`);
await sleep(1500);
sv = await startView();
check(sv.progress === "dev-01에서 더 읽는 중… (4 / 7)" && sv.rows.length > 0, `덜 읽은 답 — 읽은 줄 + 이어 읽는 중 (4 / 7) (${sv.progress})`);
await sleep(2000);
sv = await startView();
console.log("start:", JSON.stringify(sv));
const calls = await remoteCalls();
check(calls.length === 2 && calls[0].force === false && calls[1].force === false && calls[0].id === calls[1].id, `세션이 서자 읽는다 — 덜 읽은 답 뒤 이어 부름 (${JSON.stringify(calls)})`);
check(JSON.stringify(sv.chips) === JSON.stringify(["이 폴더 · 3*", "dev-01 전체 · 7"]), `칩 — 이 폴더 · 3 / dev-01 전체 · 7 (${sv.chips})`);
check(JSON.stringify(sv.rows) === JSON.stringify([`${id(2)}:elsewhere`, `${id(1)}:ok`, `${xid(3)}:ok`]) && sv.sel === id(1), `이 폴더(~ 를 서버 홈으로 편다) 최신순 · 1분 전 줄은 밖에서 열림 · 첫 선택은 그다음 (${sv.rows} · ${sv.sel})`);
check(sv.progress === null && sv.quiet === null, "다 읽으면 진행 줄이 걷힌다");
const codexMeta = await ev(`${PS}.querySelector('[data-start-row="${xid(3)}"] [data-meta="tokens"]')?.textContent.trim() ?? null`);
check(codexMeta === "96k 토큰", `Codex 줄의 토큰 (${codexMeta})`);
check(/\bV\b/.test(sv.keys ?? ""), `원격 시작 화면의 바닥 줄에도 V(기록 보기) — 2단계 (${sv.keys})`);
console.log("capture:", await shot("rconv-start.png"));

// ── ③ 읽기 실패 → 한 줄, 새로 시작은 그대로 ─────────────────────────────────────
await ev(`window.__remote.fail = 'exec 채널을 열지 못했습니다: closed'; window.__remote.delay = 0;`);
await ev(`(async () => { const r = await ${rcMod}; await r.loadRemoteConversations('dev-01', true); })()`); await sleep(300);
sv = await startView();
check(sv.err === "dev-01 에서 대화를 읽지 못했습니다 — exec 채널을 열지 못했습니다: closed" && sv.rows.length === 3 && sv.acts.length === 4, `실패 — 한 줄 · 읽은 줄과 새로 시작은 그대로 (${sv.err})`);
await ev(`window.__remote.fail = null`);
await ev(`(async () => { const r = await ${rcMod}; await r.loadRemoteConversations('dev-01'); })()`); await sleep(300);
check((await startView()).err === null, "다시 읽으면 실패 줄이 걷힌다");

// ── ④ 시작 화면 Enter = 그 자리에 SSH 재개 타일 ────────────────────────────────────
await ev(`${PS}.querySelector('[data-start-row="${id(1)}"]').focus()`); await sleep(200);
await key("Enter"); await sleep(900);
st = await state();
const resumed = st.panes[0];
check(st.tab === labTab && st.panes.length === 1 && resumed.kind === "ssh" && resumed.alias === "dev-01" && resumed.cwd === "/home/deploy/work/aynx-lab" && resumed.autorun === `claude --resume ${id(1)}` && resumed.forceTmux === true && resumed.inject === null, `Enter → 그 자리에 dev-01 SSH 타일 · 대화의 폴더 · claude --resume · 프로젝트의 tmux · MCP 토큰 없음 (${JSON.stringify(resumed)})`);
check((await ev(`JSON.stringify(window.__launch.at(-1))`)) === JSON.stringify({ alias: "dev-01", agent: "claude", id: id(1), mode: "resume" }), "명세 = 원격 resume(별칭 · 에이전트 · id)");

// ── ⑤ SSH 타일에서 Ctrl+Shift+Y — 그 서버 · 셸이 알려 준 폴더 ─────────────────────
const before5 = (await remoteCalls()).length;
await ev(`(async () => { const c = await ${cwdMod}; c.noteReportedCwd('${sshA}', '/home/deploy/work/api'); })()`);
await focusPaneBody(sshA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(600);
let pk = await picker();
console.log("picker:", JSON.stringify(pk));
check(pk?.remote === "dev-01" && pk.source === "tile", `SSH 타일 → 원격 목록 · 기준 = 셸이 알려 준 폴더 (${pk?.remote} · ${pk?.source})`);
check(JSON.stringify(pk.chips) === JSON.stringify(["이 폴더 · 3*", "dev-01 전체 · 7"]), `칩 — 이 폴더 · 3 / dev-01 전체 · 7 (${pk.chips})`);
check(pk.host === "⇄ dev-01" && pk.where?.includes("~/work/api"), `범위 줄 오른쪽 — 호스트 칩 · 서버 홈을 ~ 로 (${pk.where})`);
check(JSON.stringify(pk.rows.map((r) => r.split(":")[0])) === JSON.stringify([id(5), id(4), xid(6)]), `이 폴더의 줄 최신순 (${pk.rows})`);
check(pk.metas[2] === "Codex·88k 토큰" && pk.metas[0] === "Claude Code", `줄 모양 — Claude 는 토큰 없음 · Codex 는 누적 (${pk.metas})`);
check(/방금 읽음·F5다시 읽기$/.test(pk.keys ?? "") && /Ctrl\+Enter/.test(pk.keys ?? ""), `바닥 — "방금 읽음 · F5 다시 읽기" · 기록 보기 안내(2단계) (${pk.keys})`);
check((await remoteCalls()).length === before5, "1분 안에 다 읽었으면 다시 부르지 않는다(캐시)");
console.log("capture:", await shot("rconv-picker.png"));
await key("Tab"); await sleep(200);
pk = await picker();
check(pk.scope === "host" && pk.rows.length === 7, `Tab → dev-01 전체(7) (${pk.scope} · ${pk.rows.length})`);
await key("Tab"); await sleep(200);

// ── ⑥ F5 = 1분 캐시를 건너뛰고 새로 ─────────────────────────────────────────────
await key("F5"); await sleep(600);
const after6 = await remoteCalls();
check(after6.length >= before5 + 2 && after6[before5].force === true && after6[before5 + 1].force === false, `F5 → force 로 다시 뽑고 이어 부름 (${JSON.stringify(after6.slice(before5))})`);
check((await ev(`!!${PICK}`)) === true, "F5 는 페이지를 새로 고치지 않는다(목록이 그대로 떠 있다)");

// ── ⑦ Enter = 옆에 SSH 타일(같은 탭) ──────────────────────────────────────────────
const s0 = await state();
await key("Enter"); await sleep(900);
const s1 = await state();
const beside = s1.panes.find((p) => p.id !== sshA);
check(s1.tab === s0.tab && s1.panes.length === 2 && beside?.kind === "ssh" && beside.alias === "dev-01" && beside.cwd === API && beside.autorun === `claude --resume ${id(5)}` && beside.forceTmux === null && beside.noTmux === null, `Enter → 같은 탭 옆에 dev-01 SSH 타일 · 그 폴더 · resume · 프로젝트 밖이라 tmux 는 호스트 설정 (${JSON.stringify(beside)})`);
check(s1.focus === beside?.id, "포커스가 새 타일로");
check((await ev(`document.querySelector('.pane-box[data-pane="${beside?.id}"]')?.classList.contains('glow-ok') ?? null`)) === true, "새 타일이 한 번 빛난다");
console.log("capture:", await shot("rconv-split.png"));

// ── ⑧ 열림 → 그 타일로 ──────────────────────────────────────────────────────────
await focusPaneBody(sshA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
pk = await picker();
check(pk.rows[0] === `${id(5)}:open`, `방금 연 대화 = 열림 (${pk.rows[0]})`);
const l0 = await ev(`window.__launch.length`);
await key("Enter"); await sleep(600);
const s2 = await state();
check(s2.panes.length === 2 && s2.focus === beside?.id && (await ev(`window.__launch.length`)) === l0, "열린 타일 Enter → 새로 열지 않고 그 타일로");

// ── ⑨ Codex 줄 Shift+Enter = codex fork ────────────────────────────────────────
await focusPaneBody(sshA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
await key("ArrowDown"); await key("ArrowDown"); await sleep(150);
await key("Enter", SHIFT); await sleep(900);
const s3 = await state();
check(s3.panes.some((p) => p.kind === "ssh" && p.autorun === `codex fork ${xid(6)}` && p.cwd === API), `Shift+Enter → codex fork 가 옆에 (${s3.panes.map((p) => p.autorun)})`);

// ── ⑩ Ctrl+Enter = 원격 기록 보기(2단계) ──────────────────────────────────────────
const rhMod = importApp("app/remote-home.svelte.ts");
const sidA = await ev(`(async () => (await ${rhMod}).liveSessionFor('dev-01'))()`);
await focusPaneBody(sshA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
await key("Enter", CTRL); await sleep(900);
const viewerSnap = async () => JSON.parse(await ev(`(() => { const v = document.querySelector('[data-convo-viewer]'); if (!v) return JSON.stringify(null); return JSON.stringify({ id: v.dataset.convoViewer, host: v.querySelector('[data-viewer-host]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, path: v.querySelector('[data-viewer-path]')?.textContent.trim() ?? null, items: [...v.querySelectorAll('[data-item]')].map(i => i.textContent.replace(/\\s+/g, ' ').trim()), older: !!v.querySelector('[data-viewer-older]'), start: !!v.querySelector('[data-viewer-start]'), err: v.querySelector('[data-viewer-error]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null }); })()`));
let vw = await viewerSnap();
console.log("viewer:", JSON.stringify(vw));
const tcalls = () => ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'agent_conversation_transcript_remote').map(c => c[1]))`).then(JSON.parse);
let tc = await tcalls();
check(vw !== null && vw.host === "⇄ dev-01" && JSON.stringify(vw.items) === JSON.stringify(["Recent question", "Recent answer"]) && vw.older, `Ctrl+Enter → 기록 시트 · 호스트 칩 · 최신 쪽 · 이전 더 보기 (${JSON.stringify(vw)})`);
check(tc.length === 1 && tc[0].id === sidA && tc[0].conversation === vw?.id && tc[0].before === null, `붙은 세션(${sidA})으로 서버의 파일을 읽는다 — 새 접속 없음 (${JSON.stringify(tc)})`);
check((await ev(`window.__calls.some(c => c[0] === 'agent_conversation_transcript')`)) === false, "원격 대화를 이 PC 의 기록 경로로 읽지 않는다");
await ev(`document.querySelector('[data-viewer-older]').click()`); await sleep(500);
vw = await viewerSnap();
tc = await tcalls();
check(tc.length === 2 && tc[1].before === 4096 && vw.items[0] === "First question" && vw.start, `이전 쪽 = 커서 앞(4096) — 앞에 붙고 대화의 처음 (${JSON.stringify(vw.items)})`);
console.log("capture:", await shot("rconv-viewer.png"));
await key("Escape"); await sleep(300);
await ev(`window.__viewGone = true`);
await focusPaneBody(sshA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
await key("Enter", CTRL); await sleep(700);
vw = await viewerSnap();
check(vw?.err === "dev-01 연결이 끊겨 더 읽을 수 없습니다", `세션이 사라졌으면 한 줄 (${vw?.err})`);
await ev(`window.__viewGone = false`);
await key("Escape"); await sleep(300);

// ── ⑪ 로컬 타일은 예전 그대로 ───────────────────────────────────────────────────
const before11 = (await remoteCalls()).length;
const local = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newLocalPane('pwsh'); p.cwd = 'C:\\\\src\\\\proj'; w.openInNewTab(p, 'shell'); return p.id; })()`);
await sleep(700);
await focusPaneBody(local);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(600);
pk = await picker();
check(pk.remote === null && pk.host === null && (await remoteCalls()).length === before11 && (await ev(`window.__calls.some(c => c[0] === 'agent_sessions_list')`)) === true, `로컬 타일 → 로컬 목록 · 원격 호출 없음 (${pk.remote})`);
await key("Escape"); await sleep(300);

// ── ⑫ 저장 짐 — 주소에 host · 대화 제목 없음 ────────────────────────────────────
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectInNewTab(l.projects().find(p => p.id === 'P2')); })()`); await sleep(2800);
const saved = await ev(`(() => { const c = window.__calls.filter(c => c[0] === 'workspaces_apply' && c[1]?.mutation?.op === 'putTabs').at(-1); return c ? JSON.stringify(c[1].mutation.tabs) : null; })()`);
check(typeof saved === "string" && saved.includes('"host":"dev-01"') && !/nginx|Log rotation|health check|version header|Rollback|dry-run|Something else/.test(saved), `workspaces.json — 시작 화면 주소에 host · 대화 제목 없음 (${saved ? saved.length + " B" : "저장 없음"})`);

// ── ⑬ 대시보드 "어디서" 칩 (2단계) ──────────────────────────────────────────────
const conMod = importApp("app/console.svelte.ts");
// lab-02 — 붙어서 한 번 읽은 뒤 끊겼다(마지막 값이 흐리게 남는다)
const labPane = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newSshPane('lab-02'); w.openInNewTab(p, 'lab-02'); return p.id; })()`);
await sleep(600);
await ev(`(async () => { const r = await ${rcMod}; await r.loadRemoteConversations('lab-02'); })()`); await sleep(200);
await ev(`(async () => { const w = await ${tabsMod}; const t = w.tabOfPane('${labPane}'); w.closePaneIn(t.id, '${labPane}'); })()`); await sleep(500);
const listCalls0 = (await remoteCalls()).length;
await ev(`(async () => (await ${conMod}).openConsoleAt('agents'))()`); await sleep(1200);
const dash = async () => JSON.parse(await ev(`(() => { const b = document.querySelector('[data-convo]'); if (!b) return JSON.stringify(null); return JSON.stringify({ chips: [...b.querySelectorAll('[data-source-chip]')].map(c => c.textContent.replace(/\\s+/g, ' ').trim() + (c.classList.contains('on') ? '*' : '') + (c.classList.contains('dim') ? '~' : '')), rows: [...b.querySelectorAll('[data-convo-row]')].map(r => (r.dataset.host ?? 'pc') + ':' + r.dataset.convoRow.slice(-2) + (r.classList.contains('dim') ? '~' : '')), hostchips: [...b.querySelectorAll('[data-row-host]')].map(h => h.textContent.replace(/\\s+/g, ' ').trim()), folders: [...b.querySelectorAll('[data-meta="folder"]')].map(f => f.textContent.trim()), offline: [...b.querySelectorAll('[data-convo-offline]')].map(p => p.textContent.replace(/\\s+/g, ' ').trim()), scopes: !!b.querySelector('.scopes') }); })()`));
let d = await dash();
console.log("dash:", JSON.stringify(d));
check(JSON.stringify(d?.chips) === JSON.stringify(["이 PC · 0*", "⇄dev-01 · 7", "⇄lab-02 · 2방금 읽음 · 연결 없음~", "모두"]), `칩 — 이 PC(기본) · dev-01 · 흐린 lab-02(방금 읽음 · 연결 없음) · 모두 (${d?.chips})`);
await ev(`document.querySelector('[data-source-chip="host:dev-01"]').click()`); await sleep(500);
d = await dash();
check(d.rows.length === 7 && d.rows.every((r) => r.startsWith("dev-01:") && !r.endsWith("~")) && d.hostchips.every((h) => h === "⇄ dev-01") && !d.scopes, `dev-01 — 한 목록(범위 칸 없음) · 줄마다 호스트 칩 (${d.rows})`);
check(d.folders.includes("~/work/api") && d.folders.includes("~/work/aynx-lab"), `둘째 줄에 서버의 폴더(~) (${[...new Set(d.folders)]})`);
const listCalls1 = (await remoteCalls()).length;
await ev(`document.querySelector('[data-source-chip="host:lab-02"]').click()`); await sleep(500);
d = await dash();
check(d.rows.length === 2 && d.rows.every((r) => r.startsWith("lab-02:") && r.endsWith("~")) && d.offline[0]?.startsWith("lab-02 — 연결 없음 · 방금 읽음"), `lab-02 — 마지막 값이 흐리게 · 한 줄 안내 (${d.rows} · ${d.offline})`);
check((await remoteCalls()).length === listCalls1 && listCalls1 >= listCalls0, "끊긴 호스트를 골라도 서버를 부르지 않는다(자동으로 접속하지 않음)");
await ev(`document.querySelector('[data-source-chip="all"]').click()`); await sleep(500);
d = await dash();
await ev(`document.querySelector('[data-convo-more]')?.click()`); await sleep(300);
d = await dash();
check(d.rows.length === 9 && d.rows.filter((r) => r.startsWith("lab-02")).length === 2, `모두 — 이 PC + 두 호스트가 한 목록 (${d.rows.length})`);
console.log("capture:", await shot("rconv-dash.png"));

// ── ⑭ 사용량 칸 (2단계) ──────────────────────────────────────────────────────────
const sumCalls = () => ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'agent_usage_summary').map(c => ({ local: c[1].local, hosts: c[1].hosts })))`).then(JSON.parse);
await ev(`(async () => (await ${importApp("app/usage-view.svelte")}).openUsageView())()`); await sleep(1200); // 사용량 화면(2026-10-04 — 대시보드 칸에서 나갔다 · 대시보드는 걷힌다)
const usage = async () => JSON.parse(await ev(`(() => { const b = document.querySelector('[data-usage-board]'); if (!b) return JSON.stringify(null); return JSON.stringify({ chips: [...b.querySelectorAll('[data-source-chip]')].map(c => c.textContent.replace(/\\s+/g, ' ').trim() + (c.classList.contains('on') ? '*' : '')), lines: [...b.querySelectorAll('[data-usage-remote]')].map(p => p.dataset.usageRemote + ':' + p.dataset.state + (p.querySelector('[data-usage-remote-read]') ? '[read]' : '') + (p.querySelector('[data-usage-remote-stop]') ? '[stop]' : '')), texts: [...b.querySelectorAll('[data-usage-remote] span')].map(s => s.textContent.trim()), limitsHost: b.querySelector('[data-usage-limits]')?.dataset.limitsHost ?? null, limitsNote: b.querySelector('[data-limits-note]')?.textContent.trim() ?? null, cards: [...b.querySelectorAll('[data-usage-card]')].map(c => c.dataset.usageCard), today: b.querySelector('[data-cell="today"] .v')?.textContent.trim() ?? null }); })()`));
let u = await usage();
let sc = await sumCalls();
console.log("usage:", JSON.stringify(u));
check(u?.chips.at(-1) === "모두*" && JSON.stringify(sc.at(-1)) === JSON.stringify({ local: true, hosts: ["dev-01", "lab-02"] }), `같은 선택(모두) — Rust 요약에 이 PC + 두 호스트 (${JSON.stringify(sc.at(-1))})`);
check(JSON.stringify(u.lines) === JSON.stringify(["dev-01:pendingClaude[read]", "lab-02:offline"]), `호스트마다 한 줄 — 붙은 dev-01 은 [전체 사용량 읽기] · 끊긴 lab-02 는 단추 없음 (${u.lines})`);
check(u.texts[0] === "dev-01: Claude 토큰은 [전체 사용량 읽기] 뒤에 더해집니다(큰 대화 2개 · 34 MB)", `남은 몫의 글자 (${u.texts[0]})`);
check(u.limitsNote === null || u.limitsNote === "한도는 이 PC 의 것입니다", `모두 — 한도는 이 PC 의 것 (${u.limitsNote})`);
await ev(`document.querySelector('[data-usage-board] [data-source-chip="host:dev-01"]').click()`); await sleep(800);
u = await usage();
sc = await sumCalls();
check(JSON.stringify(sc.at(-1)) === JSON.stringify({ local: false, hosts: ["dev-01"] }) && u.today === "1k", `dev-01 — 그 서버의 몫만 (${JSON.stringify(sc.at(-1))} · ${u.today})`);
check(u.limitsHost === "dev-01" && JSON.stringify(u.cards) === JSON.stringify(["codex"]) && u.limitsNote?.startsWith("dev-01 의 Codex 한도"), `한도 — 그 서버의 Codex 만 · Claude 는 이 PC 상태줄 한 줄 (${u.cards} · ${u.limitsNote})`);
const sc0 = sc.length;
await ev(`document.querySelector('[data-usage-remote-read]').click()`); await sleep(150);
u = await usage();
check(u.lines[0] === "dev-01:running[stop]", `누르면 읽는 중 · [멈춤] (${u.lines[0]})`);
await sleep(1200);
u = await usage();
const readCalls = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'agent_usage_remote_read').map(c => c[1]))`).then(JSON.parse);
check(readCalls.length === 2 && readCalls.every((c) => c.id === sidA), `이어 부름 — 붙은 세션(${sidA})으로만 (${JSON.stringify(readCalls)})`);
check(u.lines[0] === "dev-01:done" && u.texts[0] === "dev-01: 대화 7개의 토큰을 모두 셌습니다", `다 셌다 (${u.lines} · ${u.texts[0]})`);
check((await sumCalls()).length >= sc0 + 2, "읽는 동안 요약을 다시 읽는다(센 몫이 바로 선다)");
console.log("capture:", await shot("rconv-usage.png"));
await ev(`document.querySelector('[data-usage-board] [data-source-chip="local"]').click()`); await sleep(600);
u = await usage();
sc = await sumCalls();
check(JSON.stringify(sc.at(-1)) === JSON.stringify({ local: true, hosts: null }) && u.lines.length === 0 && u.limitsHost === null, `이 PC — 예전 그대로(원격 인자 없음 · 덮개 줄 없음) (${JSON.stringify(sc.at(-1))})`);
await ev(`(async () => (await ${importApp("app/usage-view.svelte")}).closeCoverView())()`); await sleep(300);

console.log(errors.length ? "exceptions:\n  " + errors.join("\n  ") : "no exceptions");
check(errors.length === 0, `예외 0 (${errors.length})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
