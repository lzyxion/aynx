// Headless harness: **프로젝트 시작 화면** + 재개가 갈 자리 (docs/log/2026-09-26-project-start-screen.md).
// 스텁은 `convo-harness.mjs` 의 사본을 줄인 것 — 프로젝트 · 워크트리 · `agent_sessions_list` · `agent_session_launch_spec`.
//
//   npx vite --port 1436 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9252 --user-data-dir=%TEMP%/edge-aynx-pstart \
//     --window-size=1200,900 http://localhost:1436/
//   PAGE_PORT=1436 node scripts/dev/project-start-harness.mjs outdir 9252
//
// 심어 두는 것: 로컬 프로젝트 셋(aynx — 주 폴더 대화 7 · 워크트리 feat-y 대화 2 / quiet — 대화 0 / infra) + 원격 하나(api).
//
// 보는 것: ① 대화가 있는 프로젝트를 열면 새 탭의 첫 타일 = 시작 화면(머리 · 새로 시작 S C X + 기본 단추 · 5줄 + 더 보기 · 첫 줄 선택 ·
// 바닥 줄) ② 대화 0 → 그래도 시작 화면(2026-09-27 — Enter = 기본 셸) · 원격 → 시작 화면(2026-09-27) ③ 키 — ↑↓ · Enter = 재개 · Shift+Enter = 새 대화로 계속 ·
// S C X R — 전부 **그 자리에서** 갈아 끼움(탭 수 · 탭 제목 그대로) ④ 분할 안의 시작 화면도 그 칸만 바뀐다 ⑤ 열림 줄 →
// 그 타일(화면은 남는다) ⑥ 더 보기 · 0 이 되어도 화면 유지 ⑦ 재개가 갈 자리 1–4 ⑧ 설정 off ⑨ 저장 — 주소만,
// 제목 없음 ⑩ 예외 0 ⑪ 기록 보기 — 시작 화면 V · 줄 단추 · 머리의 재개 · 이전 더 보기 · Escape/포커스 · 팔레트 Ctrl+Enter.
// 팔레트의 밖에서 열린 대화 Enter = 기록 시트(시트의 [재개]가 한 번 묻는다). 대시보드 "지난 대화" 줄은 4dda594 에 빠져
// 그 판(대시보드 V · 대시보드 줄 확인)은 없다. PNG: pstart.png · pstart-light.png · pstart-split.png · viewer.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9252";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1436";
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
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (counting && d.method === "Runtime.exceptionThrown") { const s = d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"; if (!/stub:/.test(s)) errors.push(s); } });

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  performance.setResourceTimingBufferSize(5000);
  const HOSTS = [{ name: 'dev-01', host_name: '10.0.0.2', user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } }];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const AYNX = 'C:\\\\src\\\\proj', FEAT = 'C:/src/proj-wt/feat-y', QUIET = 'C:\\\\src\\\\quiet', INFRA = 'C:\\\\src\\\\infra';
  const PROJECTS = [
    { id: 'P1', name: 'aynx', host: null, path: AYNX, shell: null, command: 'npm run dev', tmux: false },
    { id: 'P2', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: 'claude', tmux: false },
    { id: 'P3', name: 'quiet', host: null, path: QUIET, shell: null, command: 'claude', tmux: false },
    { id: 'P4', name: 'infra', host: null, path: INFRA, shell: null, command: '', tmux: false },
  ];
  const WT = { [AYNX]: [{ path: 'C:/src/proj', branch: 'main', head: 'a1' }, { path: FEAT, branch: 'feat-y', head: 'b2' }] };
  const H = 3600_000, NOW = Date.now();
  const id = (i) => '11111111-2222-4333-8444-' + String(i).padStart(12, '0');
  const S = (i, cwd, ago, extra = {}) => ({ agent: 'claude', id: id(i), cwd, branch: 'main', title: 'Conversation ' + i, titleSource: 'ai', startedAt: NOW - ago - H, updatedAt: NOW - ago, model: 'claude-opus-5', forkedFrom: null, cwdExists: true, ...extra });
  window.__convo = {
    [AYNX.toLowerCase()]: [
      // aynx 밖(다른 터미널)에서 지금 도는 대화 — 파일이 20초 전에 고쳐졌고 어느 타일에도 연결되지 않았다(실기 ②)
      S(8, AYNX, 20_000, { title: 'Busy elsewhere' }),
      S(1, AYNX, 5 * 60_000, { title: 'Fix the flaky build script' }),
      S(2, AYNX, 2 * H, { titleSource: 'fallback', title: 'Claude Code · main' }),
      S(3, AYNX, 3 * H, { agent: 'codex', id: '01a07989-25f8-7e72-99aa-000000000003', title: 'Retry loop for uploads', titleSource: 'custom', model: 'gpt-6-codex', forkedFrom: '01a07989-25f8-7e72-99aa-000000000009' }),
      ...[4, 5, 6, 7].map((i) => S(i, AYNX, (26 + i) * H)),
    ],
    [FEAT.toLowerCase()]: [S(20, FEAT, 30 * 60_000, { branch: 'feat-y', title: 'Feature Y wiring' }), S(21, FEAT, 40 * 60_000, { branch: 'feat-y', title: 'Feature Y tests' })],
    [INFRA.toLowerCase()]: [S(40, INFRA, 50 * H, { title: 'Infra plan' })],
  };
  const OTHERS = [S(30, 'C:\\\\Users\\\\me\\\\scratch', 90 * 60_000, { title: 'Scratch question' })];
  window.__launch = [];
  // 기록 보기 — 지어낸 기록 96개(사용자 · 생각 · 도구 · 에이전트 차례). 커서 = 항목 번호(진짜는 바이트 위치)
  window.__tr = [];
  const BT = String.fromCharCode(96);
  const TR = [];
  for (let i = 0; i < 96; i++) {
    const base = { text: null, truncated: false, images: 0, tool: null, at: NOW - (96 - i) * 60_000 };
    if (i % 4 === 0) TR.push({ ...base, role: 'user', text: 'Question ' + i, images: i === 0 ? 1 : 0 });
    else if (i % 4 === 1) TR.push({ ...base, role: 'assistant', text: 'Note ' + i });
    else if (i % 4 === 2) TR.push({ ...base, role: 'tool', tool: { name: 'Bash', summary: 'git status ' + i, input: 'git status', inputTruncated: false, output: 'On branch main', outputTruncated: i === 94, error: i === 90 } });
    else TR.push({ ...base, role: 'assistant', truncated: i === 95, text: 'Answer ' + i + '\\n\\n- item ' + BT + 'code' + BT + '\\n\\n' + BT + BT + BT + '\\n<script>window.__pwned = 1<' + '/script>\\n' + BT + BT + BT });
  }
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }, { id: 'cmd', label: 'Command Prompt' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: true }],
     load_snippets: null, 
     save_snippets: null, 
    save_settings: null,
    host_history_list: {},
    projects_list: PROJECTS,
    ssh_remote_home: '/root',
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
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] },
    agent_usage_limits: [],
    'plugin:notification|is_permission_granted': true,
    'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };
  const key = (p) => p.replaceAll('\\\\', '/').replace(/\\/+$/, '').toLowerCase();
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++ });
      if (cmd === 'git_worktree_list') return Promise.resolve(WT[args.repo] ?? []);
      if (cmd === 'load_settings') return Promise.resolve(window.__settings ?? {});
      if (cmd === 'agent_autorun_command') return Promise.resolve(args.command);
      if (cmd === 'agent_sessions_list') {
        const byKey = {}; for (const [k, v] of Object.entries(window.__convo)) byKey[key(k)] = v;
        return Promise.resolve({
          groups: args.cwds.map((c) => ({ cwd: c, exists: true, sessions: byKey[key(c)] ?? [], more: false })),
          others: OTHERS, othersMore: false,
        });
      }
      if (cmd === 'agent_conversation_transcript') {
        window.__tr.push(args);
        const end = args.before ?? TR.length;
        const start = Math.max(0, end - (args.limit ?? 40));
        return Promise.resolve({ items: TR.slice(start, end), cursor: start > 0 ? start : null });
      }
      if (cmd === 'agent_session_launch_spec') {
        window.__launch.push(args);
        const all = [...Object.values(window.__convo).flat(), ...OTHERS];
        const s = all.find((x) => x.id === args.id);
        const cmdLine = s.agent === 'codex' ? 'codex ' + args.mode + ' ' + args.id : 'claude --resume ' + args.id + (args.mode === 'fork' ? ' --fork-session' : '');
        return Promise.resolve({ cwd: s.cwd, command: cmdLine });
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

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && k === "Enter" ? { text: String.fromCharCode(13) } : {}) }); await sleep(300); };
const SHIFT = 8;
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const projMod = importApp("app/projects.svelte.ts");
const plMod = importApp("app/project-list.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");
const convMod = importApp("app/agent-sessions.svelte.ts");
const setMod = importApp("lib/settings.svelte.ts");
const sessMod = importApp("lib/session.ts");
/** 보이는 시작 화면 — 숨은 탭의 것도 DOM 에 있다 */
const PS = `[...document.querySelectorAll('[data-project-start]')].find(e => e.getClientRects().length > 0)`;
const WALK = `const walk = (n, o) => (n.type === 'leaf' ? o.push(n.pane) : (walk(n.a, o), walk(n.b, o)), o);`;
/** 지금 탭 한 벌 — 탭 수 · id · 제목 · 잎들 · 포커스 타일 */
const state = async () => JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; ${WALK} const t = w.activeTab(); return JSON.stringify({ n: w.currentWorkspaceTabs().length, tab: t?.id ?? null, title: t?.title ?? null, focus: t ? w.paneOf(t) : null, panes: t ? walk(t.root, []).map(p => ({ id: p.id, kind: p.kind, start: p.startProject ?? null, autorun: p.autorun ?? null, cwd: p.cwd ?? null, shell: p.shell ?? null, inject: !!p.injectMcpToken, alias: p.alias ?? null })) : [] }); })()`));
const openNewTab = async (pid) => { await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectInNewTab(l.projects().find(p => p.id === '${pid}')); })()`); await sleep(900); };
const openHere = async (pid) => { await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectHere(l.projects().find(p => p.id === '${pid}')); })()`); await sleep(900); };
const focusStart = async () => { await ev(`(() => { const r = ${PS}?.querySelector('[data-sel="true"]') ?? ${PS}?.querySelector('[data-start-action]'); r?.focus(); return !!r; })()`); await sleep(150); };
const newEmptyTab = async () => { await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; w.openTab(s.newTab()); })()`); await sleep(400); };
const id = (i) => "11111111-2222-4333-8444-" + String(i).padStart(12, "0");

// 키·시트 검사용 독립 시작 화면: 열린 프로젝트 재선택과 구분해 빈 탭에 지금 탭 열기를 쓴다.
const freshStart = async (pid) => { await newEmptyTab(); await openHere(pid); };

// ── ① 대화가 있는 프로젝트 → 시작 화면 ────────────────────────────────────────
const s0 = await state();
await openNewTab("P1");
let s1 = await state();
check(s1.title === "aynx", `탭 제목 = 프로젝트 이름(주 폴더) — 시작 화면이 떠 있는 동안에도 (${s1.title})`);
check(s1.n === s0.n && s1.tab === s0.tab && s1.panes.length === 1 && s1.panes[0].kind === "start" && s1.panes[0].start?.projectId === "P1" && s1.panes[0].start?.folder === "C:\\src\\proj", `빈 시작 탭 재사용 = 프로젝트 시작 화면 (${JSON.stringify(s1.panes)})`);
await sleep(500);
const head = JSON.parse(await ev(`JSON.stringify({ name: ${PS}.querySelector('[data-start-name]').textContent.trim(), path: ${PS}.querySelector('[data-start-path]').textContent.trim(), branch: ${PS}.querySelector('[data-start-branch]')?.textContent.trim() ?? null, acts: [...${PS}.querySelectorAll('[data-start-action]')].map(b => b.dataset.startAction + ':' + b.querySelector('.label').textContent.trim() + ':' + (b.querySelector('.letter')?.textContent.trim() ?? '') + (b.querySelector('.cmd') ? ':' + b.querySelector('.cmd').textContent.trim() : '')), rows: [...${PS}.querySelectorAll('[data-start-row]')].map(r => r.dataset.startRow), sel: [...${PS}.querySelectorAll('[data-start-row]')].findIndex(r => r.classList.contains('selected')), more: ${PS}.querySelector('[data-start-more]')?.textContent.trim() ?? null, all: ${PS}.querySelector('[data-start-all]')?.textContent.trim() ?? null, keys: ${PS}.querySelector('[data-start-keys]').textContent.replace(/\\s+/g, ' ').trim(), header: !!document.querySelector('.pane-box.headed [data-project-start]') })`));
console.log("head:", JSON.stringify(head));
check(head.name === "aynx" && head.path === "C:\\src\\proj", `머리 — 프로젝트 이름 · 폴더(집 밖이라 그대로) (${head.name} · ${head.path})`);
check(head.branch === "⎇ main", `브랜치 (${head.branch})`);
// 2026-09-28 — "시작 명령"(R) 단추는 없어졌다. 옛 `command: 'npm run dev'` 는 이관 표로 agent null + 설정 스크립트가 된다.
check(JSON.stringify(head.acts) === JSON.stringify(["shell:PowerShell 7:S", "claude:Claude Code:C", "codex:Codex:X"]), `새로 시작 = 기본 셸 S · Claude C · Codex X (${head.acts.join(" | ")})`);
check(head.rows.length === 5 && head.rows[0] === id(8) && head.rows[1] === id(1) && head.sel === 1, `최신순 5줄 · 처음 고른 줄 = 밖에서 열리지 않은 가장 최근 줄 (${head.rows.length} · sel ${head.sel})`);
const busyPill = await ev(`${PS}.querySelector('[data-start-row="${id(8)}"]')?.dataset.state + '/' + (${PS}.querySelector('[data-start-row="${id(8)}"] [data-pill="elsewhere"]')?.textContent.trim() ?? '')`);
check(busyPill === "elsewhere/밖에서 열림", `aynx 밖에서 방금 고쳐진 대화 = "밖에서 열림" 알약 (${busyPill})`);
const pillTip = await ev(`${PS}.querySelector('[data-pill="elsewhere"]')?.getAttribute('title') ?? null`);
check(pillTip === "aynx 밖에서 열림 · 방금 바뀜", `알약 말풍선 = 연결 없음 · 상대 시각 (${pillTip})`);
const warnPill = await ev(`(() => { const p = document.createElement('span'); p.style.color = 'var(--warn)'; document.body.appendChild(p); const v = getComputedStyle(p).color; p.remove(); return getComputedStyle(${PS}.querySelector('[data-pill="elsewhere"]')).color === v; })()`);
check(warnPill === true, "알약 = 경고색");
const surface = await ev(`(() => { const box = ${PS}.closest('.pane-box'); const p = document.createElement('span'); p.style.background = 'var(--surface-field)'; document.body.appendChild(p); const v = getComputedStyle(p).backgroundColor; p.remove(); return JSON.stringify({ chrome: box.classList.contains('chrome'), same: getComputedStyle(box).backgroundColor === v, bg: getComputedStyle(box).backgroundColor }); })()`);
check(JSON.parse(surface).chrome === false && JSON.parse(surface).same === true, `타일 면 = 크롬의 우물(--surface-field — 2026-10-01) (${surface})`);
const launcherSurface = await ev(`(() => { const box = document.querySelector('[data-launcher]')?.closest('.pane-box'); return box ? box.classList.contains('chrome') : 'none'; })()`);
check(launcherSurface === true || launcherSurface === "none", `빈 탭 launcher 는 그대로 비친다 (${launcherSurface})`);
// 기본 단추(`defaultStartAction`) — 프로젝트의 에이전트, 없으면 셸. aynx(P1)은 이관으로 에이전트가 없어 셸이 기본이다.
const defBox = JSON.parse(await ev(`(() => { const d = [...${PS}.querySelectorAll('[data-start-default]')]; const b = d[0]; const l = b?.querySelector('.label'); return JSON.stringify({ n: d.length, act: b?.dataset.startAction ?? null, title: b?.getAttribute('title') ?? null, cls: !!b?.classList.contains('default'), labelFull: l ? l.scrollWidth <= l.clientWidth + 1 : false }); })()`));
check(defBox.n === 1 && defBox.act === "shell" && defBox.cls && defBox.labelFull && (defBox.title ?? "").includes("프로젝트의 기본 (Enter)"), `기본 단추 하나 = 셸(에이전트 없는 프로젝트) · 말풍선 "프로젝트의 기본 (Enter)" (${JSON.stringify(defBox)})`);
check(head.more === "3개 더 보기" && head.all === null, `더 보기 · 옛 "대시보드 › 에이전트" 안내는 없다 (${head.more} · ${head.all})`);
// aynx 은 워크트리가 둘이라 범위 칩이 서고 Tab 이 바닥 줄에 든다 (docs/log/2026-09-27-folder-conversations.md)
check(head.keys === "↑↓ 고르기 Enter 재개 Shift+Enter 새 대화로 계속 V 기록 보기 Tab 범위 S C X 새로 시작", `바닥 줄 (${head.keys})`);
check(head.header === false, "시작 화면에는 타일 헤더가 없다(launcher 와 같다)");
const selBg = await ev(`(() => { const p = document.createElement('span'); p.style.background = 'var(--accent-soft)'; document.body.appendChild(p); const v = getComputedStyle(p).backgroundColor; p.remove(); return getComputedStyle(${PS}.querySelector('[data-start-row].selected')).backgroundColor === v; })()`);
check(selBg === true, "고른 줄 = --accent-soft");
const acts0 = await ev(`[...${PS}.querySelectorAll('[data-start-acts] button')].map(b => b.textContent.trim() + (b.classList.contains('btn-primary') ? '*' : '')).join('|')`);
check(acts0 === "기록 보기|새 대화로 계속|재개*", `고른 줄에 [기록 보기][새 대화로 계속][재개*] (${acts0})`);
const fb = await ev(`${PS}.querySelector('[data-start-row="${id(2)}"] [data-meta="untitled"]')?.textContent.trim() ?? null`);
const fk = await ev(`${PS}.querySelector('[data-agent="codex"] [data-meta="forked"]')?.textContent.trim() ?? null`);
check(fb === "제목 없음" && fk === "↳ 갈라짐", `줄 모양 = 대시보드와 같다 (합성 제목 · 갈라짐) (${fb} · ${fk})`);
console.log("capture:", await shot("pstart.png"));
const focused = await ev(`!!document.activeElement?.closest('[data-project-start]')`);
check(focused === true, `키보드가 시작 화면 안에 있다 (${await ev(`document.activeElement?.tagName + '.' + document.activeElement?.className`)})`);
// 호버는 단추만 옮긴다(선택은 그대로)
{
  const r = await ev(`(() => { const b = ${PS}.querySelector('[data-start-row="${id(4)}"]').getBoundingClientRect(); return [b.left + 60, b.top + b.height / 2]; })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] }); await sleep(200);
  const hov = await ev(`JSON.stringify({ acts: [...${PS}.querySelectorAll('[data-start-acts]')].map(a => a.closest('[data-start-row]').dataset.startRow), sel: ${PS}.querySelector('[data-start-row].selected').dataset.startRow, primaries: ${PS}.querySelectorAll('.btn-primary').length })`);
  const h = JSON.parse(hov);
  check(h.acts.length === 1 && h.acts[0] === id(4) && h.sel === id(1) && h.primaries === 1, `호버 줄에 단추 · 선택은 그대로 · 주 동작 하나 (${hov})`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 }); await sleep(200);
}

// ── ⑥ 더 보기 ──────────────────────────────────────────────────────────────
// 밖에서 열린 줄의 재개는 한 번 묻는다 — 취소
await focusStart();
await key("ArrowUp");
check((await ev(`document.activeElement?.dataset?.startRow`)) === id(8), "↑ → 밖에서 열린 줄");
const launches0 = await ev(`window.__launch.length`);
await key("Enter");
const conf = await ev(`${PS}.querySelector('[data-start-row="${id(8)}"] [data-start-confirm]')?.textContent.trim() ?? null`);
const confBtns = await ev(`[...${PS}.querySelectorAll('[data-start-row="${id(8)}"] [data-start-acts] button')].map(b => b.textContent.trim()).join('|')`);
check(conf === "aynx 밖에서 열려 있는 대화입니다 — 여기서도 재개하면 두 곳에서 이어 쓰게 됩니다" && confBtns === "취소|그래도 재개" && (await ev(`window.__launch.length`)) === launches0, `Enter → 그 줄에서 확인(곧장 띄우지 않는다) (${conf} ${confBtns})`);
await key("Escape");
check((await ev(`!!${PS}.querySelector('[data-start-confirm]')`)) === false && (await state()).panes[0].kind === "start", "Escape → 확인만 거둔다");
await key("ArrowDown"); // 첫 줄(밖에서 열리지 않은 것)로 되돌린다

await ev(`${PS}.querySelector('[data-start-more]').click()`); await sleep(250);
check((await ev(`${PS}.querySelectorAll('[data-start-row]').length`)) === 8, "더 보기 → 그 자리에서 8줄");

// ── ③ 키: ↓ Enter = 재개(그 자리) ───────────────────────────────────────────
await focusStart();
await key("ArrowDown");
check((await ev(`document.activeElement?.dataset?.startRow`)) === id(2), "↓ → 둘째 줄(포커스도)");
await key("Enter"); await sleep(700);
let s2 = await state();
check(s2.n === s1.n && s2.tab === s1.tab && s2.panes.length === 1 && s2.panes[0].kind === "local" && s2.panes[0].autorun === `claude --resume ${id(2)}` && s2.panes[0].cwd === "C:\\src\\proj" && s2.panes[0].inject, `Enter = 재개 → 같은 탭 · 같은 자리 · 그 명령과 폴더 (${JSON.stringify(s2.panes)})`);
check(s2.title === s1.title && s2.focus === s2.panes[0].id, `탭 제목 그대로 · 새 타일에 포커스 (${s2.title})`);
check(JSON.stringify(await ev(`JSON.stringify(window.__launch.at(-1))`)) === JSON.stringify(JSON.stringify({ agent: "claude", id: id(2), mode: "resume" })), "명세 = resume");

// 열린 프로젝트를 다시 열면 새 탭 없이 재개한 타일로 간다.
await openNewTab("P1");
const reopened = await state();
check(reopened.n === s2.n && reopened.tab === s2.tab && reopened.focus === s2.focus, "열린 프로젝트 → 기존 탭·타일 포커스, 새 탭 없음");

// ── ⑤ 열림 줄 → 그 타일, 화면은 남는다 ────────────────────────────────────────
await freshStart("P1");
const sOpen = await state();
const openPill = await ev(`${PS}.querySelector('[data-start-row="${id(2)}"]')?.dataset.state`);
check(openPill === "open", `방금 재개한 대화 = 열림 (${openPill})`);
await focusStart(); await key("ArrowDown"); await key("Enter"); await sleep(500);
const sAfterOpen = await state();
check(sAfterOpen.tab === s2.tab && sAfterOpen.focus === s2.panes[0].id, `열림 줄 Enter → 그 타일로 (${sAfterOpen.tab})`);
const stillThere = await ev(`(async () => { const w = await ${tabsMod}; ${WALK} const t = w.residentWindowTabs().find(t => t.id === '${sOpen.tab}'); return t ? walk(t.root, []).map(p => p.kind).join(',') : null; })()`);
check(stillThere === "start", `시작 화면은 남는다 (${stillThere})`);
await ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${sOpen.tab}'); })()`); await sleep(400);

// ── ③ Shift+Enter = 새 대화로 계속 ────────────────────────────────────────────
await focusStart();
await key("ArrowUp"); // 앞 단계에서 둘째 줄(열림)을 골라 두었다 — 첫 줄로
await key("Enter", SHIFT); await sleep(700);
let s3 = await state();
check(s3.tab === sOpen.tab && s3.panes.length === 1 && s3.panes[0].autorun === `claude --resume ${id(1)} --fork-session`, `Shift+Enter = 새 대화로 계속 → 그 자리 (${s3.panes[0]?.autorun})`);

// ── ③ 글자 키 S · C · X · R ─────────────────────────────────────────────────
const letterCase = async (code, letterKey, expect, label) => {
  await freshStart("P1");
  const before = await state();
  await focusStart();
  await key(code, 0, letterKey); await sleep(500);
  const after = await state();
  const p = after.panes[0];
  const ok = after.tab === before.tab && after.n === before.n && after.panes.length === 1 && p.kind === "local" && p.cwd === "C:\\src\\proj" && p.autorun === expect.autorun && p.inject === expect.inject && p.shell === "pwsh";
  check(ok, `${label} → 그 자리 (${JSON.stringify(p)})`);
};
await letterCase("KeyS", "ㄴ", { autorun: null, inject: false }, "S(한글 자판 ㄴ) = 기본 셸");
await letterCase("KeyC", "c", { autorun: "claude", inject: true }, "C = Claude Code");
await letterCase("KeyX", "x", { autorun: "codex", inject: true }, "X = Codex");
// R(옛 "시작 명령")은 없어졌다 — 아무것도 열지 않는다(2026-09-28)
await freshStart("P1");
await focusStart();
await key("KeyR", 0, "r"); await sleep(300);
check((await state()).panes[0].kind === "start", "R 은 아무것도 열지 않는다 (시작 명령 단추 없음)");
// 남은 시작 화면을 걷는다 — 두면 아래 "재개가 갈 자리" 규칙 1 이 이 탭(같은 폴더의 시작 화면)으로 간다.
await key("KeyS", 0, "s"); await sleep(500);
// 수식이 붙은 글자는 흘려보낸다
await freshStart("P1");
await focusStart();
await key("KeyS", SHIFT, "S"); await sleep(300);
check((await state()).panes[0].kind === "start", "Shift+S 는 아무것도 열지 않는다");
// 단추 클릭도 같은 길
await ev(`${PS}.querySelector('[data-start-action="codex"]').click()`); await sleep(500);
check((await state()).panes[0].autorun === "codex", "단추 클릭 = 같은 길");

// ── ④ 분할 안의 시작 화면 — 그 칸만 ─────────────────────────────────────────
await openHere("P1"); // 지금 탭(codex 타일 하나)의 옆에 시작 화면
let sp = await state();
const other = sp.panes.find((p) => p.kind === "local");
check(sp.panes.length === 2 && sp.panes.some((p) => p.kind === "start"), `열기(지금 탭) = 분할 안에 시작 화면 (${sp.panes.map((p) => p.kind).join(",")})`);
console.log("capture:", await shot("pstart-split.png"));
const shapeBefore = await ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return JSON.stringify({ dir: t.root.dir, ratio: t.root.ratio }); })()`);
await focusStart(); await key("KeyS", 0, "s"); await sleep(500);
const spa = await state();
const shapeAfter = await ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return JSON.stringify({ dir: t.root.dir, ratio: t.root.ratio }); })()`);
check(spa.panes.length === 2 && spa.panes[0].id === other.id && spa.panes[1].kind === "local" && spa.panes[1].autorun === null && shapeAfter === shapeBefore, `S → 그 칸만 셸로 · 옆 타일과 분할 그대로 (${JSON.stringify(spa.panes.map((p) => p.kind))} ${shapeAfter})`);

// ── ② 대화 0 → 그래도 시작 화면(2026-09-27) · Enter = 프로젝트의 기본 단추(2026-09-28) · 원격 → 시작 화면 ─────────
const beforeQuiet = await state();
await openNewTab("P3");
const sq = await state();
check(sq.n === beforeQuiet.n + 1 && sq.tab !== beforeQuiet.tab, "바쁜 탭에서 아직 열리지 않은 프로젝트 → 새 탭");
const qEmpty = await ev(`${PS}?.querySelector('[data-start-empty]')?.textContent.trim() ?? null`);
const qFocus = await ev(`document.activeElement?.dataset?.startAction ?? null`);
check(sq.panes.length === 1 && sq.panes[0].kind === "start" && sq.panes[0].start?.folder === "C:\\src\\quiet" && qEmpty === "이 워크트리에서 나눈 대화가 아직 없습니다" && qFocus === "claude", `대화 0 → 그래도 시작 화면 · 키보드는 프로젝트의 기본 단추(quiet = 옛 command 'claude' → 에이전트 Claude Code) (${sq.panes[0].kind} · ${qEmpty} · ${qFocus})`);
await key("Enter"); await sleep(600);
const sq2 = await state();
check(sq2.tab === sq.tab && sq2.panes[0].kind === "local" && sq2.panes[0].autorun === "claude" && sq2.panes[0].inject && sq2.panes[0].cwd === "C:\\src\\quiet", `Enter → 그 자리에 프로젝트의 에이전트 (${JSON.stringify(sq2.panes[0])})`);
await openNewTab("P2");
const sr = await state();
// 2026-09-27 부터 원격 프로젝트도 시작 화면이 선다(docs/log/2026-09-27-remote-conversations.md) — 목록은 remote-convos 판이 본다
check(sr.panes[0].kind === "start" && sr.panes[0].start?.host === "dev-01", `원격 → 시작 화면(그 서버) (${sr.panes[0].kind})`);

// ── ⑦ 재개가 갈 자리 ────────────────────────────────────────────────────────
// 1. 같은 폴더의 시작 화면 — 다른 탭을 보고 있어도 그 자리로
await freshStart("P1");
const r1Start = await state();
await freshStart("P3"); // 다른 탭을 본다
await ev(`(async () => { const c = await ${convMod}; c.openConversationById('claude', '${id(5)}', false); })()`); await sleep(700);
const r1 = await state();
check(r1.tab === r1Start.tab && r1.n === r1Start.n + 1 && r1.panes.length === 1 && r1.panes[0].autorun === `claude --resume ${id(5)}`, `규칙 1 — 같은 폴더의 시작 화면을 그 자리에서 (${r1Start.tab}→${r1.tab} · n ${r1Start.n}→${r1.n} · ${r1.panes.length} · ${r1.panes[0]?.autorun})`);
// 4. 그 폴더와 무관한 탭에서 feat-y 대화 → 새 탭(워크트리 탭이 아직 없다)
await ev(`(async () => { const c = await ${convMod}; c.openConversationById('claude', '${id(20)}', false); })()`); await sleep(700);
const r4 = await state();
check(r4.n === r1.n + 1 && r4.panes.length === 1 && r4.panes[0].cwd === "C:/src/proj-wt/feat-y" && r4.title === "aynx · feat-y", `규칙 4 — 새 탭 · 범위 이름 제목 (${r4.n} · ${r4.title})`);
// 2. 그 워크트리의 탭 — 다른 탭을 보다가 같은 워크트리의 다른 대화를 새 대화로 계속
await ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${r1.tab}'); })()`); await sleep(300);
await ev(`(async () => { const c = await ${convMod}; c.openConversationById('claude', '${id(21)}', true); })()`); await sleep(700);
const r2 = await state();
check(r2.tab === r4.tab && r2.n === r4.n && r2.panes.length === 2 && r2.panes.some((p) => p.autorun === `claude --resume ${id(21)} --fork-session`) && r2.focus === r2.panes.find((p) => p.autorun?.includes(id(21)))?.id, `규칙 2 — 그 워크트리의 탭에 타일 하나 더 · 그 타일로 (${r2.panes.length})`);
// 3. 지금 탭이 빈 launcher → 그 자리 (기타 폴더의 대화)
await newEmptyTab();
const r3Before = await state();
check(r3Before.panes.length === 1 && r3Before.panes[0].kind === "start" && !r3Before.panes[0].start, "준비: 빈 탭(launcher)");
await ev(`(async () => { const c = await ${convMod}; c.openConversationById('claude', '${id(30)}', false); })()`); await sleep(700);
const r3 = await state();
check(r3.tab === r3Before.tab && r3.n === r3Before.n && r3.panes.length === 1 && r3.panes[0].autorun === `claude --resume ${id(30)}` && r3.title === "~/scratch", `규칙 3 — launcher 자리 · 탭 제목 = 범위 이름 (${r3.title})`);
// 4'. 지금 탭이 바쁜 탭이면 새 탭 (infra 대화 — 워크트리 탭도 시작 화면도 없다)
await ev(`(async () => { const c = await ${convMod}; c.openConversationById('claude', '${id(40)}', false); })()`); await sleep(700);
const r5 = await state();
check(r5.n === r3.n + 1 && r5.title === "infra", `규칙 4 — 바쁜 탭에서는 새 탭 (${r5.title})`);

// ── ② 팔레트 — 밖에서 열린 대화는 Enter 가 그 대화의 기록 시트로 ─────────────────
// 앞선 판은 대시보드 "지난 대화" 의 그 줄로 데려갔다 — 그 덩어리는 4dda594(2026-09-28)에 빠졌고, 지금은 시트가
// 펼쳐지고 시트의 [재개]가 한 번 묻는다(`openConversationById` · docs/log/2026-09-28-dashboard-session-cards.md).
await ev(`Object.values(window.__convo).flat().find(x => x.title === 'Busy elsewhere').updatedAt = Date.now() - 20000`);
{
  const CTRL = 2;
  const VW = `document.querySelector('[data-convo-viewer]')`;
  await key("KeyP", CTRL | SHIFT, "P"); await sleep(500);
  await send("Input.insertText", { text: "대화 Busy" }); await sleep(600);
  const palRow = await ev(`(() => { const r = document.querySelector('.palette [data-row]'); return r ? r.querySelector('.label').textContent.trim() + '|' + (r.querySelector('[data-conversation-elsewhere]')?.textContent.trim() ?? '') : null; })()`);
  check(palRow === "Busy elsewhere|밖에서 열림", `팔레트 줄에 알약 (${palRow})`);
  const before = await ev(`window.__launch.length`);
  await key("Enter"); await sleep(1200);
  const sheet = JSON.parse(await ev(`JSON.stringify({ palette: !!document.querySelector('.palette'), id: ${VW}?.dataset.convoViewer ?? null, pill: ${VW}?.querySelector('[data-pill="elsewhere"]')?.textContent.trim() ?? null })`));
  check(sheet.palette === false && sheet.id === id(8) && (await ev(`window.__launch.length`)) === before, `Enter → 재개 대신 그 대화의 기록 시트 (${JSON.stringify(sheet)})`);
  check(sheet.pill === "밖에서 열림", `시트 머리에도 알약 (${sheet.pill})`);
  await ev(`${VW}.querySelector('[data-act="resume"]').click()`); await sleep(300);
  const sconf = await ev(`${VW}?.querySelector('[data-viewer-confirm]')?.textContent.trim() ?? null`);
  check(sconf === "aynx 밖에서 열려 있는 대화입니다 — 여기서도 재개하면 두 곳에서 이어 쓰게 됩니다" && (await ev(`window.__launch.length`)) === before, `시트 [재개] → 그 자리에서 확인 (${sconf})`);
  await ev(`${VW}.querySelector('[data-viewer-body]')?.focus()`);
  await key("Escape"); await sleep(300);
  check((await ev(`!!${VW}`)) === true && (await ev(`!!document.querySelector('[data-viewer-confirm]')`)) === false, "Escape → 확인만 거두고 시트는 남는다");
  // 포크는 묻지 않는다
  await ev(`${VW}.querySelector('[data-act="fork"]').click()`); await sleep(800);
  check((await ev(`JSON.stringify(window.__launch.at(-1))`)) === JSON.stringify({ agent: "claude", id: id(8), mode: "fork" }) && (await ev(`!!${VW}`)) === false, "[새 대화로 계속]은 묻지 않는다 · 시트가 닫힌다");
}
// 시작 화면 — 확인 뒤 한 번 더 Enter = 그래도 재개(그 자리)
await freshStart("P1");
{
  const b0 = await state();
  await focusStart(); await key("ArrowUp"); await key("Enter"); await key("Enter"); await sleep(700);
  const b1 = await state();
  check(b1.tab === b0.tab && b1.panes.length === 1 && b1.panes[0].autorun === `claude --resume ${id(8)}`, `확인 뒤 Enter = 그래도 재개 → 그 자리 (${b1.panes[0]?.autorun})`);
}

// ── ⑪ 기록 보기 (docs/log/2026-09-27-conversation-viewer.md) ─────────────────
{
  const VW = `document.querySelector('[data-convo-viewer]')`;
  await freshStart("P1");
  const v0 = await state();
  // 앞 단계들이 id(8) 을 열어 두었다(열림 줄이 처음 골라진다) — 열리지 않은 id(1) 을 고른다
  await ev(`${PS}.querySelector('[data-start-row="${id(1)}"]').focus()`); await sleep(200);
  const selRow = await ev(`document.activeElement?.dataset?.startRow ?? null`);
  await key("KeyV", 0, "ㅍ"); await sleep(600);
  const head = JSON.parse(await ev(`JSON.stringify({ id: ${VW}?.dataset.convoViewer ?? null, title: ${VW}?.querySelector('[data-viewer-title]')?.textContent.trim() ?? null, path: ${VW}?.querySelector('[data-viewer-path]')?.textContent.trim() ?? null, branch: ${VW}?.querySelector('[data-viewer-branch]')?.textContent.trim() ?? null, model: ${VW}?.querySelector('[data-viewer-model]')?.textContent.trim() ?? null, acts: [...(${VW}?.querySelectorAll('[data-viewer-acts] button') ?? [])].map(b => b.textContent.trim() + (b.classList.contains('btn-primary') ? '*' : '')).join('|'), call: window.__tr.at(-1) ?? null })`));
  console.log("viewer:", JSON.stringify(head));
  check(head.id === selRow && head.id === id(1) && head.title === "Fix the flaky build script", `V(한글 자판 ㅍ) → 고른 줄의 기록 시트 (${head.id} · ${head.title})`);
  check(head.path === "C:\\src\\proj" && head.branch === "⎇ main" && head.model === "claude-opus-5", `머리 — 폴더 · 브랜치 · 모델 (${head.path} · ${head.branch} · ${head.model})`);
  check(head.acts === "새 대화로 계속|재개*", `머리의 두 동작 — 재개가 주 동작 (${head.acts})`);
  check(JSON.stringify(head.call) === JSON.stringify({ agent: "claude", id: id(1), before: null, limit: 40 }), `최신 쪽을 id 로만 부른다(경로 없음) (${JSON.stringify(head.call)})`);
  const body = JSON.parse(await ev(`(() => { const b = ${VW}.querySelector('[data-viewer-body]'); const it = [...b.querySelectorAll('[data-item]')]; return JSON.stringify({ n: it.length, kinds: [...new Set(it.map(x => x.dataset.item))].sort().join(','), last: it.at(-1)?.textContent.replace(/\\s+/g, ' ').trim().slice(0, 9), bottom: Math.abs(b.scrollHeight - b.clientHeight - b.scrollTop) < 4, scripts: document.querySelectorAll('[data-convo-viewer] script').length, pwned: window.__pwned ?? 0, shown: b.textContent.includes('<script>'), older: !!b.querySelector('[data-viewer-older]'), cut: it.at(-1)?.querySelector('.cut')?.textContent.trim() ?? null, focusIn: !!document.activeElement?.closest('[data-convo-viewer]') }); })()`));
  console.log("body:", JSON.stringify(body));
  check(body.n === 40 && body.kinds === "assistant,tool,user" && body.last === "Answer 95", `한 쪽 40개 · 세 모양(생각 없음) · 최신이 맨 아래 (${body.n} · ${body.last})`);
  check(body.bottom === true, "열면 맨 아래에서 시작");
  check(body.scripts === 0 && body.pwned === 0 && body.shown === true, `본문의 <script> 는 글자로만 (${body.scripts} · ${body.pwned})`);
  check(body.cut === "…잘림" && body.older === true && body.focusIn === true, `잘림 표시 · 이전 더 보기 · 키보드가 시트 안 (${body.cut})`);
  // 도구 줄 — 펼치기
  const tline = await ev(`(() => { const t = [...${VW}.querySelectorAll('[data-item="tool"]')].at(-1); const line = t.querySelector('.tline').textContent.replace(/\\s+/g, ' ').trim(); t.querySelector('.tline').click(); return line; })()`);
  await sleep(200);
  const tb = await ev(`[...${VW}.querySelectorAll('[data-item="tool"]')].at(-1).querySelector('[data-tool-body]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
  check(tline === "Bash — git status 94" && tb === "입력 git status 출력 On branch main …잘림", `도구 한 줄 → 펼치면 입력 · 출력 발췌 (${tline} | ${tb})`);
  check((await ev(`!!${VW}.querySelector('[data-item="thinking"]')`)) === false, "생각 줄은 없다");
  console.log("capture:", await shot("viewer.png"));
  // 이전 더 보기 — 두 번이면 처음까지
  await ev(`${VW}.querySelector('[data-viewer-older]').click()`); await sleep(400);
  const o1 = JSON.parse(await ev(`JSON.stringify({ n: ${VW}.querySelectorAll('[data-item]').length, call: window.__tr.at(-1) })`));
  check(o1.n === 80 && o1.call.before === 56, `이전 더 보기 → 커서 앞의 쪽을 앞에 (${o1.n} · before ${o1.call.before})`);
  await ev(`${VW}.querySelector('[data-viewer-older]').click()`); await sleep(400);
  const o2 = await ev(`JSON.stringify({ n: ${VW}.querySelectorAll('[data-item]').length, first: ${VW}.querySelector('[data-item]').textContent.replace(/\\s+/g, ' ').trim(), start: ${VW}.querySelector('[data-viewer-start]')?.textContent.trim() ?? null, older: !!${VW}.querySelector('[data-viewer-older]') })`);
  check(o2 === JSON.stringify({ n: 96, first: "Question 0 이미지 1개", start: "대화의 처음입니다", older: false }), `끝까지 → 처음 표시 (${o2})`);
  // Escape → 닫히고 키보드는 그 줄로
  await ev(`${VW}.querySelector('[data-viewer-body]').focus()`);
  await key("Escape"); await sleep(300);
  const back = JSON.parse(await ev(`JSON.stringify({ open: !!${VW}, row: document.activeElement?.dataset?.startRow ?? null, at: document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 40) : null })`));
  check(back.open === false && back.row === id(1), `Escape → 닫히고 키보드는 연 줄로 (${JSON.stringify(back)})`);
  check((await state()).panes[0].kind === "start", "시작 화면은 그대로");
  // 줄의 ⋯ 메뉴 [기록 보기] → 머리의 [재개] = 그 자리에서 재개(시트는 닫힌다)
  await ev(`${PS}.querySelector('[data-start-row="${id(1)}"]').dispatchEvent(new MouseEvent('mouseenter'))`); await sleep(200);
  await ev(`${PS}.querySelector('[data-start-row="${id(1)}"] [data-act="more"]').click()`); await sleep(200);
  await ev(`document.querySelector('[data-toolbar-menu] [data-menu-key="view"]').click()`); await sleep(500);
  check((await ev(`!!${VW}`)) === true, "줄의 [기록 보기] 단추도 같은 시트");
  await ev(`${VW}.querySelector('[data-act="resume"]').click()`); await sleep(700);
  const v1 = await state();
  check((await ev(`!!${VW}`)) === false && v1.tab === v0.tab && v1.panes.length === 1 && v1.panes[0].autorun === `claude --resume ${id(1)}`, `머리의 [재개] → 시트가 닫히고 그 자리에서 재개 (${v1.panes[0]?.autorun})`);
  // 팔레트 — Ctrl+Enter = 기록 보기
  const CTRL = 2;
  await key("KeyP", CTRL | SHIFT, "P"); await sleep(500);
  await send("Input.insertText", { text: "대화 Feature Y tests" }); await sleep(600);
  const hint = await ev(`document.querySelector('.palette [data-row].sel [data-keys]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
  check(typeof hint === "string" && hint.startsWith("Ctrl+↵기록 보기"), `팔레트 대화 줄에 Ctrl ↵ 기록 보기 (${hint})`);
  const l0 = await ev(`window.__launch.length`);
  await key("Enter", CTRL); await sleep(700);
  const pv = JSON.parse(await ev(`JSON.stringify({ palette: !!document.querySelector('.palette'), id: ${VW}?.dataset.convoViewer ?? null, focusIn: !!document.activeElement?.closest('[data-convo-viewer]'), at: document.activeElement ? document.activeElement.tagName + '.' + String(document.activeElement.className).slice(0, 40) : null })`));
  check(pv.palette === false && pv.id === id(21) && pv.focusIn && (await ev(`window.__launch.length`)) === l0, `Ctrl+Enter → 팔레트가 닫히고 기록 시트 · 재개하지 않는다 (${JSON.stringify(pv)})`);
  await key("Escape"); await sleep(300);
  check((await ev(`!!${VW}`)) === false, "Escape → 닫힘");
  // (대시보드 "지난 대화" 줄의 V · Escape 는 4dda594 에 그 줄과 함께 빠졌다.)
}

// ── ⑥ 0 이 되어도 화면 유지 ────────────────────────────────────────────────
await freshStart("P1");
const z0 = await state();
await ev(`window.__convo['c:\\\\src\\\\proj'] = []`);
await ev(`(async () => { const c = await ${convMod}; await c.loadConversations(); })()`); await sleep(400);
const z1 = await state();
const emptyLine = await ev(`${PS}?.querySelector('[data-start-empty]')?.textContent.trim() ?? null`);
const keysNow = await ev(`${PS}?.querySelector('[data-start-keys]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const showAll = await ev(`${PS}?.querySelector('[data-start-show-project]')?.textContent.trim() ?? null`);
check(z1.tab === z0.tab && z1.panes[0].kind === "start" && emptyLine === "이 워크트리에서 나눈 대화가 아직 없습니다" && keysNow === "Tab 범위 S C X 새로 시작" && showAll === "이 프로젝트 전체 보기 · 2", `다시 읽어 0 이어도 화면은 그대로 · 다른 워크트리의 대화로 가는 단추 (${emptyLine} · ${keysNow} · ${showAll})`);

// ── ⑨ 저장 — 주소만, 제목 없음 ──────────────────────────────────────────────
await sleep(2500);
const saved = await ev(`(() => { const c = window.__calls.filter(c => c[0] === 'workspaces_apply' && c[1]?.mutation?.op === 'putTabs').at(-1); return c ? JSON.stringify(c[1]) : null; })()`);
check(typeof saved === "string" && saved.includes("startProject") && saved.includes("projectId") && !/Fix the flaky|Busy elsewhere|Conversation \d|Feature Y|Scratch question/.test(saved), `workspaces.json 에는 주소만 · 대화 제목 없음 (${saved ? saved.length + " B" : "저장 없음"})`);

// ── 라이트 캡처 ──────────────────────────────────────────────────────────────
await ev(`window.__convo['c:\\\\src\\\\proj'] = window.__convo['c:\\\\src\\\\proj'] ?? []`);
await freshStart("P4");
const modeMod = importApp("mode.svelte.ts");
await ev(`(async () => { const m = await ${modeMod}; m.setAppMode('light'); })()`); await sleep(500);
check((await state()).panes[0].kind === "start", "infra(대화 1) → 시작 화면 · 시작 명령이 없으면 R 도 없다");
check((await ev(`[...${PS}.querySelectorAll('[data-start-action]')].map(b => b.dataset.startAction).join(',')`)) === "shell,claude,codex", "시작 명령 단추 없음");
console.log("capture:", await shot("pstart-light.png"));
await ev(`(async () => { const m = await ${modeMod}; m.setAppMode('dark'); })()`); await sleep(300);

// ── ⑧ 설정 off → 곧장 ──────────────────────────────────────────────────────
await ev(`(async () => { const s = await ${setMod}; s.setProjectStartScreen('off'); })()`); await sleep(200);
await freshStart("P4");
const so = await state();
check(so.panes[0].kind === "local" && so.panes[0].cwd === "C:\\src\\infra" && so.panes[0].autorun === null, `설정 off → 대화가 있어도 곧장 셸 (${JSON.stringify(so.panes[0])})`);
await ev(`(async () => { const s = await ${setMod}; s.setProjectStartScreen('auto'); })()`);

console.log(errors.length ? "exceptions:\n  " + errors.join("\n  ") : "no exceptions");
check(errors.length === 0, `예외 0 (${errors.length})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
