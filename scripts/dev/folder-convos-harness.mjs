// Headless harness: **이 폴더의 지난 대화** (docs/log/2026-09-27-folder-conversations.md).
// 스텁은 `project-start-harness.mjs` 의 사본 — 프로젝트 · 워크트리 · `agent_sessions_list` · `agent_session_launch_spec` ·
// `agent_conversation_transcript` · `git_worktree_add`.
//
//   npx vite --port 1487 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9297 --user-data-dir=%TEMP%/edge-aynx-fconv \
//     --window-size=1200,900 http://localhost:1487/
//   PAGE_PORT=1487 node scripts/dev/folder-convos-harness.mjs outdir 9297
//
// 심어 두는 것: 로컬 프로젝트 셋(aynx — 주 폴더 대화 7 · 워크트리 feat-y 대화 2 · 빈 워크트리 empty / quiet — 대화 0) +
// 원격 하나(api).
//
// 보는 것: ① 부팅에 읽지 않는다 · 상태바 칸(말풍선 둘 아이콘 · 배지/흐림 없음 · 말풍선 글자) ② Ctrl+Shift+Y →
// 팔레트 자리의 목록(칩 셋 — 끝은 모든 대화 · ⎇ 브랜치 · 폴더 · 첫 줄 선택 · 줄 모양 · 바닥 줄) ③ Tab 범위 ④ 거르기 ⑤ Enter = 지금 타일
// 옆에 분할(같은 탭 · 포커스 · 한 번 빛남) ⑥ 열린 타일 → 그 타일로만 ⑦ Shift+Enter = 새 대화로 계속(옆에) ⑧ Ctrl+Enter =
// 기록 보기 ⑨ 밖에서 열림 → 한 번 묻는다 ⑩ 독 지난 대화 칸 클릭 · ⋯ 메뉴(단축키 글자) · 팔레트 줄 — 같은 목록 ⑪ 빈 상태(quiet: 단추
// 없음 · 빈 워크트리: 이 프로젝트 전체 보기) · 0 이어도 흐리지 않음 ⑫ 폴더 없는 타일 → 탭의 프로젝트 폴더 · 빈 탭 → 모든 대화
// ⑬ 시작 화면(대화 0 인 프로젝트 · 새 워크트리도 선다 · 칩 · Tab · 빈 상태 단추 · Enter = 셸) ⑭ 예외 0.
// PNG: fconv.png · fconv-split.png · fconv-empty.png · fconv-menu.png · pstart-empty.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { waitBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9297";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1487";
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
  const HOSTS = [{ name: 'dev-01', host_name: '10.0.0.2', user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } }];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const AYNX = 'C:\\\\src\\\\proj', FEAT = 'C:/src/proj-wt/feat-y', EMPTY = 'C:/src/proj-wt/empty', QUIET = 'C:\\\\src\\\\quiet';
  const PROJECTS = [
    // 옛 \`command\` 는 설정 스크립트로 옮겨진다(2026-09-28) — 스크립트가 있으면 새 워크트리가 시작 화면을 건너뛰므로 비워 둔다
    { id: 'P1', name: 'aynx', host: null, path: AYNX, shell: null, command: '', tmux: false, worktreeDir: null },
    { id: 'P2', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: 'claude', tmux: false, worktreeDir: null },
    { id: 'P3', name: 'quiet', host: null, path: QUIET, shell: null, command: '', tmux: false, worktreeDir: null },
  ];
  window.__wt = { [AYNX]: [{ path: 'C:/src/proj', branch: 'main', head: 'a1' }, { path: FEAT, branch: 'feat-y', head: 'b2' }, { path: EMPTY, branch: 'empty', head: 'c3' }] };
  const H = 3600_000, NOW = Date.now();
  const id = (i) => '11111111-2222-4333-8444-' + String(i).padStart(12, '0');
  const S = (i, cwd, ago, extra = {}) => ({ agent: 'claude', id: id(i), cwd, branch: 'main', title: 'Conversation ' + i, titleSource: 'ai', startedAt: NOW - ago - H, updatedAt: NOW - ago, model: 'claude-opus-5', forkedFrom: null, cwdExists: true, ...extra });
  window.__convo = {
    [AYNX.toLowerCase()]: [
      S(1, AYNX, 5 * 60_000, { title: 'Fix the flaky build script' }),
      S(2, AYNX, 2 * H, { titleSource: 'fallback', title: 'Claude Code · main' }),
      S(3, AYNX, 3 * H, { agent: 'codex', id: '01a07989-25f8-7e72-99aa-000000000003', title: 'Retry loop for uploads', titleSource: 'custom', model: 'gpt-6-codex' }),
      ...[4, 5, 6, 7].map((i) => S(i, AYNX, (26 + i) * H)),
    ],
    [FEAT.toLowerCase()]: [
      S(20, FEAT, 30 * 60_000, { branch: 'feat-y', title: 'Feature Y wiring' }),
      S(21, FEAT, 40 * 60_000, { branch: 'feat-y', title: 'Feature Y tests' }),
      // aynx 밖(다른 터미널)에서 지금 도는 대화 — 파일이 20초 전에 고쳐졌다(밖에서 열림)
      S(22, FEAT, 50 * H, { branch: 'feat-y', title: 'Busy elsewhere' }),
    ],
  };
  const OTHERS = [S(30, 'C:\\\\Users\\\\me\\\\scratch', 90 * 60_000, { title: 'Scratch question' })];
  window.__launch = [];
  window.__tr = [];
  const TR = [];
  for (let i = 0; i < 12; i++) TR.push({ role: i % 2 ? 'assistant' : 'user', text: 'Line ' + i, truncated: false, images: 0, tool: null, at: NOW - (12 - i) * 60_000 });
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
    agent_usage_scan: { files: 1, elapsedMs: 1, conversations: [{ agent: 'claude', id: id(20), total: 1900000, forked: false, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, days: {} }] },
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
      if (cmd === 'git_worktree_list') return Promise.resolve(window.__wt[args.repo] ?? []);
      if (cmd === 'git_worktree_add') return Promise.resolve({ path: 'C:/src/proj-wt/' + args.name, branch: args.name, branch_created: true });
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
        return Promise.resolve({ items: TR, cursor: null });
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
await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);
counting = true;

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Tab: 9 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && k === "Enter" ? { text: String.fromCharCode(13) } : {}) }); await sleep(300); };
const CTRL = 2, SHIFT = 8;
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const projMod = importApp("app/projects.svelte.ts");
const plMod = importApp("app/project-list.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const cwdMod = importApp("app/pane-cwd.svelte.ts");
const fcMod = importApp("app/folder-conversations.svelte.ts");
const PICK = `document.querySelector('[data-folder-convos]')`;
const PS = `[...document.querySelectorAll('[data-project-start]')].find(e => e.getClientRects().length > 0)`;
// 2026-10-18 통합 독 — 상태바 칸은 걷히고 독 실행 단추가 같은 일을 한다(배지 · 흐림 없음은 그대로). 2026-10-24 독 AI ▾ 는 걷히고
// 지난 대화는 독 실행 줄의 제 아이콘 칸(`DockLaunch.svelte` `data-launch="folder-conversations"` — 이름 + 조합은 툴팁)이다
const GLYPH = `document.querySelector('[data-dock-launch] [data-launch="folder-conversations"]')`;
const dockMod = importApp("app/dock.svelte.ts");
/** 독을 열어 실행 줄(지난 대화 칸)을 세운다 */
const openConvoItem = async () => {
  await ev(`(async () => (await ${dockMod}).openDock('alerts'))()`); await sleep(300);
};
const closeDockNow = async () => { await ev(`(async () => (await ${dockMod}).closeDock())()`); await sleep(250); };
const WALK = `const walk = (n, o) => (n.type === 'leaf' ? o.push(n.pane) : (walk(n.a, o), walk(n.b, o)), o);`;
const state = async () => JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; ${WALK} const t = w.activeTab(); return JSON.stringify({ n: w.currentWorkspaceTabs().length, tab: t?.id ?? null, title: t?.title ?? null, focus: t ? w.paneOf(t) : null, dir: t?.root.type === 'split' ? t.root.dir : null, panes: t ? walk(t.root, []).map(p => ({ id: p.id, kind: p.kind, start: p.startProject ?? null, autorun: p.autorun ?? null, cwd: p.cwd ?? null })) : [] }); })()`));
const id = (i) => "11111111-2222-4333-8444-" + String(i).padStart(12, "0");
const FEAT = "C:/src/proj-wt/feat-y";
/** 새 탭에 로컬 셸 하나(시작 폴더 = cwd) — 셸이 알려 준 폴더는 `report` 로 따로 심는다 */
const openShellTab = async (cwd, report) => {
  const pid = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newLocalPane('pwsh'); ${cwd ? `p.cwd = ${JSON.stringify(cwd)};` : ""} w.openInNewTab(p, 'shell'); return p.id; })()`);
  await sleep(700);
  // 탭이 안 섰으면(EXC · 부팅 복원이 덮음) 뒤 판정이 줄줄이 무너진다 — 여기서 크게 멈춘다
  const ok = await ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return !!t && w.paneOf(t) === ${JSON.stringify(pid)}; })()`);
  if (typeof pid !== "string" || pid.startsWith("EXC") || ok !== true) throw new Error(`openShellTab: 셸 탭이 서지 않았다 (${pid} · ${ok})`);
  if (report) await ev(`(async () => { const c = await ${cwdMod}; c.noteReportedCwd(${JSON.stringify(pid)}, ${JSON.stringify(report)}); })()`);
  await sleep(200);
  return pid;
};
const focusPaneBody = async (paneId) => { await ev(`(async () => { const w = await ${tabsMod}; const t = w.tabOfPane('${paneId}'); w.focusTile(t.id, '${paneId}'); document.querySelector('[data-pane="${paneId}"] .xterm-helper-textarea')?.focus(); })()`); await sleep(250); };
const picker = async () => JSON.parse(await ev(`(() => { const p = ${PICK}; if (!p) return JSON.stringify(null); return JSON.stringify({ scope: p.dataset.scope, source: p.dataset.source, chips: [...p.querySelectorAll('[data-scope-chip]')].map(c => c.textContent.trim() + (c.classList.contains('on') ? '*' : '')), where: p.querySelector('[data-fc-where]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, rows: [...p.querySelectorAll('[data-fc-row]')].map(r => r.dataset.fcRow), sel: [...p.querySelectorAll('[data-fc-row]')].findIndex(r => r.dataset.sel === 'true'), empty: p.querySelector('[data-fc-empty]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, keys: p.querySelector('[data-fc-keys]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, focusIn: document.activeElement === p.querySelector('[data-fc-filter]') }); })()`));
const glyph = async () => { await openConvoItem(); const out = JSON.parse(await ev(`(() => { const g = ${GLYPH}; return JSON.stringify(g ? { badge: g.querySelector('.seg-badge')?.textContent.trim() ?? null, opacity: getComputedStyle(g).opacity, title: g.title } : null); })()`)); await closeDockNow(); return out; };
/** Lucide `messages-square` 의 첫 획 — 이 기능의 아이콘(말풍선 둘)이 그려졌나 */
const CONVO_ICON = `svg path[d^="M16 10a2 2 0 0 1-2 2H6.828"]`;

// ── ① 부팅에 읽지 않는다 · 상태바 칸(배지 없음) ─────────────────────────────────
await sleep(1200);
const listCalls = await ev(`window.__calls.filter(c => c[0] === 'agent_sessions_list').length`);
check(listCalls === 0, `부팅은 지난 대화 목록을 읽지 않는다 — 목록이 뜰 때 읽는다 (${listCalls})`);
const shellA = await openShellTab(null, "C:\\src\\proj-wt\\feat-y\\src\\lib");
let g = await glyph();
check(g && g.badge === null && g.opacity === "1", `상태바 칸 — 배지 · 흐림 없음 (${JSON.stringify(g)})`);
check(g?.title === "이 폴더의 지난 대화 (Ctrl+Shift+Y)", `말풍선 (${g?.title})`);
await openConvoItem();
check((await ev(`!!${GLYPH}?.querySelector('${CONVO_ICON}')`)) === true, "독 지난 대화 칸 아이콘 = messages-square(말풍선 둘)");
await closeDockNow();
const callsAfterFocus = await ev(`window.__calls.filter(c => c[0] === 'agent_sessions_list').length`);
check(callsAfterFocus === 0, "포커스·폴더가 바뀌어도 디스크를 읽지 않는다");

// ── ② Ctrl+Shift+Y → 목록 ────────────────────────────────────────────────────
await focusPaneBody(shellA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
let pk = await picker();
console.log("picker:", JSON.stringify(pk));
check(pk !== null && pk.focusIn, "Ctrl+Shift+Y → 목록이 뜨고 거르는 칸에 포커스");
check((await ev(`!!${PICK}.querySelector('${CONVO_ICON}')`)) === true, "목록 머리 아이콘 = messages-square");
// 끝의 "모든 대화" 칩 — 지난 대화 목록은 늘 `scopeChips(…, withAll)` (folder-conversations.ts)
check(JSON.stringify(pk?.chips) === JSON.stringify(["이 워크트리 · 3*", "이 프로젝트 전체 · 10", "모든 대화 · 11"]), `칩 — 이 워크트리 · 3 / 이 프로젝트 전체 · 10 / 모든 대화 · 11 (${pk?.chips})`);
check(pk?.where === "⎇ feat-y · C:/src/proj-wt/feat-y", `오른쪽 ⎇ 브랜치 · 폴더 (${pk?.where})`);
check(pk?.rows.length === 3 && pk.rows[0] === id(20) && pk.sel === 0, `최신순 3줄 · 첫 줄이 골라져 있다 (${pk?.rows.length} · sel ${pk?.sel})`);
check(pk?.keys === "Enter옆에서 이어서 Shift+Enter새 대화로 계속 Ctrl+Enter기록 보기 Tab범위", `바닥 줄 (${pk?.keys})`);
const row0 = JSON.parse(await ev(`(() => { const r = ${PICK}.querySelector('[data-fc-row="${id(20)}"]'); return JSON.stringify({ title: r.querySelector('.title').textContent.trim(), meta: r.querySelector('.cmeta').textContent.replace(/\\s+/g, ' ').trim(), time: r.querySelector('.time')?.textContent.trim() ?? null, acts: [...r.querySelectorAll('[data-convo-acts] [data-act]')].map(b => b.dataset.act), logo: !!r.querySelector('.logo svg, .logo img, .logo span'), agent: r.querySelector('.logo')?.title ?? null }); })()`));
check(row0.title === "Feature Y wiring" && row0.agent === "Claude Code" && row0.meta.includes("1.9M") && (row0.time === "30분 전" || row0.acts.includes("resume")), `줄 — 로고(툴팁 = 에이전트) · 제목 · 토큰 · 상대 시각(고른 줄이면 그 자리에 [⋯][재개]) (${JSON.stringify(row0)})`);
const place = JSON.parse(await ev(`(() => { const p = ${PICK}.getBoundingClientRect(); const c = document.querySelector('[data-tile-canvas]').getBoundingClientRect(); return JSON.stringify({ mid: Math.round(p.left + p.width / 2), cmid: Math.round(c.left + c.width / 2), top: Math.round(p.top - c.top) }); })()`));
check(Math.abs(place.mid - place.cmid) <= 2 && place.top > 0, `팔레트 자리 — 캔버스 가운데 위쪽 (${JSON.stringify(place)})`);
console.log("capture:", await shot("fconv.png"));

// ── ③ Tab 범위 ─────────────────────────────────────────────────────────────
await key("Tab"); await sleep(200);
pk = await picker();
check(pk.scope === "project" && pk.chips[1].endsWith("*") && pk.rows.length === 10 && pk.sel === 0, `Tab → 이 프로젝트 전체(10줄 · 첫 줄) (${pk.scope} · ${pk.rows.length})`);
// Shift+Tab 도 앞으로 돈다(`pickerActionForKey` — Tab 은 Shift 와 무관하게 "scope" · 끝이면 처음으로)
await key("Tab", SHIFT); await sleep(200);
pk = await picker();
check(pk.scope === "all" && pk.chips[2].endsWith("*") && pk.rows.length === 11, `Shift+Tab → 모든 대화(11줄) (${pk.scope} · ${pk.rows.length})`);
await key("Tab"); await sleep(200);
pk = await picker();
check(pk.scope === "here" && pk.rows.length === 3, `Tab 한 번 더 → 끝에서 처음(이 워크트리) (${pk.scope})`);

// ── ④ 거르기 ──────────────────────────────────────────────────────────────
await send("Input.insertText", { text: "tests" }); await sleep(300);
pk = await picker();
check(pk.rows.length === 1 && pk.rows[0] === id(21), `제목 거르기 — "tests" (${pk.rows.length})`);
await send("Input.insertText", { text: " zzz" }); await sleep(300);
pk = await picker();
check(pk.rows.length === 0 && pk.empty === "거른 글자와 맞는 대화가 없습니다", `맞는 줄이 없으면 한 줄 (${pk.empty})`);
await ev(`(() => { const i = ${PICK}.querySelector('[data-fc-filter]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(250);
check((await picker()).rows.length === 3, "비우면 다시 3줄");

// ── ⑤ Enter = 지금 타일 옆에 분할 ───────────────────────────────────────────
const s0 = await state();
await key("Enter"); await sleep(900);
const s1 = await state();
const fresh = s1.panes.find((p) => p.id !== shellA);
check(!(await ev(`!!${PICK}`)), "Enter → 목록이 닫힌다");
check(s1.tab === s0.tab && s1.n === s0.n && s1.panes.length === 2 && s1.panes[0].id === shellA && fresh?.autorun === `claude --resume ${id(20)}` && fresh?.cwd === FEAT, `같은 탭 · 지금 타일 옆에 재개 타일 (${JSON.stringify(s1.panes)})`);
check(s1.dir === "row", `넓은 타일이면 옆으로(자동 방향 — 긴 변) (${s1.dir})`);
check(s1.focus === fresh?.id, "포커스가 새 타일로");
const glow = await ev(`document.querySelector('.pane-box[data-pane="${fresh?.id}"]')?.classList.contains('glow-ok') ?? null`);
check(glow === true, `새 타일이 한 번 빛난다 (${glow})`);
check((await ev(`JSON.stringify(window.__launch.at(-1))`)) === JSON.stringify({ agent: "claude", id: id(20), mode: "resume" }), "명세 = resume");
console.log("capture:", await shot("fconv-split.png"));

// ── ⑥ 열린 타일 → 그 타일로만 ───────────────────────────────────────────────
await focusPaneBody(shellA);
await openConvoItem(); await ev(`${GLYPH}.click()`); await sleep(500);
pk = await picker();
const openState = await ev(`${PICK}.querySelector('[data-fc-row="${id(20)}"]')?.dataset.state + '/' + (${PICK}.querySelector('[data-fc-row="${id(20)}"] [data-pill="open"]')?.textContent.trim() ?? '')`);
// 알약 글자는 시작 화면 · 대시보드 · 팔레트와 같은 "열림"(board.convo.open) — 한 사물에 한 단어
check(pk !== null && openState === "open/열림", `상태바 칸 클릭 → 같은 목록 · 방금 연 대화 = 열림 (${openState})`);
const l0 = await ev(`window.__launch.length`);
await key("Enter"); await sleep(600);
const s2 = await state();
check(s2.panes.length === 2 && s2.focus === fresh?.id && (await ev(`window.__launch.length`)) === l0, `열린 타일 Enter → 새로 열지 않고 그 타일로 (${s2.focus})`);

// ── ⑦ Shift+Enter = 새 대화로 계속(옆에) ────────────────────────────────────
await focusPaneBody(shellA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
await key("ArrowDown"); await sleep(150);
check((await picker()).sel === 1, "↓ → 둘째 줄");
await key("Enter", SHIFT); await sleep(900);
const s3 = await state();
const forked = s3.panes.find((p) => p.autorun === `claude --resume ${id(21)} --fork-session`);
check(s3.panes.length === 3 && !!forked && s3.focus === forked.id && s3.tab === s0.tab, `Shift+Enter → 새 대화로 계속이 같은 탭 옆에 (${s3.panes.length})`);
const splitOfShell = await ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); const find = (n) => n.type === 'leaf' ? null : ((n.a.type === 'leaf' && n.a.pane.id === '${shellA}' && n.b.type === 'leaf' && n.b.pane.id === '${forked?.id}') ? true : (find(n.a) || find(n.b))); return !!find(t.root); })()`);
check(splitOfShell === true, "새 대화로 계속 타일은 **부른 셸 타일**과 짝을 이룬다(그 옆)");

// ── ⑧ Ctrl+Enter = 기록 보기 ───────────────────────────────────────────────
await focusPaneBody(shellA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
await key("ArrowDown"); await sleep(150);
const l1 = await ev(`window.__launch.length`);
await key("Enter", CTRL); await sleep(700);
const vw = JSON.parse(await ev(`JSON.stringify({ picker: !!${PICK}, id: document.querySelector('[data-convo-viewer]')?.dataset.convoViewer ?? null })`));
check(vw.picker === false && vw.id === id(21) && (await ev(`window.__launch.length`)) === l1, `Ctrl+Enter → 목록이 닫히고 기록 시트 · 재개하지 않는다 (${JSON.stringify(vw)})`);
await key("Escape"); await sleep(300);
check((await ev(`!!document.querySelector('[data-convo-viewer]')`)) === false, "Escape → 시트 닫힘");

// ── ⑨ 밖에서 열림 → 한 번 묻는다 ───────────────────────────────────────────
await ev(`Object.values(window.__convo).flat().find(x => x.title === 'Busy elsewhere').updatedAt = Date.now() - 20000`);
await focusPaneBody(shellA);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(900); // 여는 순간 다시 읽는다
pk = await picker();
check(pk.rows[0] === id(22), `다시 읽어 방금 고쳐진 대화가 맨 위 (${pk.rows[0]})`);
const pill = await ev(`${PICK}.querySelector('[data-fc-row="${id(22)}"] [data-pill="elsewhere"]')?.textContent.trim() ?? null`);
check(pill === "밖에서 열림", `밖에서 열림 알약 (${pill})`);
const l2 = await ev(`window.__launch.length`);
await key("Enter"); await sleep(300);
const conf = await ev(`${PICK}?.querySelector('[data-fc-confirm]')?.textContent.trim() ?? null`);
check(conf === "Aynx 밖에서 열려 있는 대화입니다 — 여기서도 재개하면 두 곳에서 이어 쓰게 됩니다" && (await ev(`window.__launch.length`)) === l2, `Enter → 한 번 묻는다 (${conf})`);
await key("Escape"); await sleep(200);
check((await ev(`!!${PICK} && !${PICK}.querySelector('[data-fc-confirm]')`)) === true, "Escape → 묻기만 거두고 목록은 남는다");
await key("Escape"); await sleep(300);
check((await ev(`!!${PICK}`)) === false, "Escape 한 번 더 → 닫힘");
const backFocus = await ev(`document.activeElement?.closest('[data-pane]')?.dataset.pane ?? null`);
check(backFocus === shellA, `닫으면 키보드는 연 타일로 (${backFocus})`);

// ── ⑩ ⋯ 메뉴 · 팔레트 줄 ──────────────────────────────────────────────────
await ev(`document.querySelector('.pane-box[data-pane="${shellA}"] [data-tile-menu-btn]').click()`); await sleep(400);
const menuRow = await ev(`(() => { const b = document.querySelector('.tilemenu [data-action="folder-conversations"]'); return b ? b.textContent.replace(/\\s+/g, ' ').trim() + '|' + (b.querySelector('[data-menu-hint]')?.textContent.trim() ?? '') : null; })()`);
check(menuRow === "이 폴더의 지난 대화Ctrl+Shift+Y|Ctrl+Shift+Y", `⋯ 메뉴에 "이 폴더의 지난 대화" + 단축키 글자 (${menuRow})`);
const menuFits = await ev(`(() => { const b = document.querySelector('.tilemenu [data-action="folder-conversations"]'); return b.scrollWidth <= b.clientWidth + 1; })()`);
check(menuFits === true, "메뉴 줄이 잘리지 않는다");
check((await ev(`!!document.querySelector('.tilemenu [data-action="folder-conversations"] ${CONVO_ICON}')`)) === true, "⋯ 메뉴 아이콘 = messages-square");
console.log("capture:", await shot("fconv-menu.png"));
await ev(`document.querySelector('.tilemenu [data-action="folder-conversations"]').click()`); await sleep(500);
const anchor = await ev(`(async () => { const f = await ${fcMod}; return f.folderConversationsAnchor()?.paneId ?? null; })()`);
check((await ev(`!!${PICK}`)) && anchor === shellA && (await picker()).focusIn, `⋯ 메뉴 → 같은 목록 · 그 타일 기준 · 입력칸 포커스 (${anchor})`);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(300);
check((await ev(`!!${PICK}`)) === false, "같은 단축키로 닫힌다(토글)");
// 팔레트 줄
await focusPaneBody(shellA);
await key("KeyP", CTRL | SHIFT, "P"); await sleep(500);
await send("Input.insertText", { text: "이 폴더의 지난" }); await sleep(500);
const palRow = await ev(`document.querySelector('.palette [data-row].sel .label')?.textContent.trim() ?? null`);
check(palRow === "이 폴더의 지난 대화", `팔레트 명령 줄 (${palRow})`);
await key("Enter"); await sleep(700);
pk = await picker();
check(pk !== null && pk.focusIn && !(await ev(`!!document.querySelector('.palette')`)), `팔레트 Enter → 팔레트가 닫히고 목록 · 입력칸 포커스 (${JSON.stringify(pk?.focusIn)})`);
await key("Escape"); await sleep(300);

// ── ⑪ 빈 상태 ─────────────────────────────────────────────────────────────
const quietShell = await openShellTab("C:\\src\\quiet", null);
g = await glyph();
check(g.badge === null && g.opacity === "1" && g.title === "이 폴더의 지난 대화 (Ctrl+Shift+Y)", `대화 0 인 폴더도 칸은 그대로 — 배지 · 흐림 없음 (${JSON.stringify(g)})`);
await focusPaneBody(quietShell);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(600);
pk = await picker();
check(JSON.stringify(pk.chips) === JSON.stringify(["이 워크트리 · 0*", "모든 대화 · 11"]) && pk.empty === "이 워크트리에서 나눈 대화가 아직 없습니다 C:\\src\\quiet" && !(await ev(`!!${PICK}.querySelector('[data-fc-show-project]')`)), `폴더 하나뿐인 프로젝트의 빈 상태 — 칩 둘(이 워크트리 · 모든 대화) · 경로 · 단추 없음 (${pk.chips} · ${pk.empty})`);
await key("Escape"); await sleep(300);
const emptyShell = await openShellTab(null, "C:/src/proj-wt/empty");
await focusPaneBody(emptyShell);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(600);
pk = await picker();
const showBtn = await ev(`${PICK}.querySelector('[data-fc-show-project]')?.textContent.trim() ?? null`);
check(pk.empty?.startsWith("이 워크트리에서 나눈 대화가 아직 없습니다") && showBtn === "이 프로젝트 전체 보기 · 10", `빈 워크트리 — 한 줄 + 이 프로젝트 전체 보기 · 10 (${showBtn})`);
console.log("capture:", await shot("fconv-empty.png"));
await ev(`${PICK}.querySelector('[data-fc-show-project]').click()`); await sleep(300);
pk = await picker();
check(pk.scope === "project" && pk.rows.length === 10 && pk.focusIn, `단추 → 이 프로젝트 전체 · 입력칸 포커스 그대로 (${pk.rows.length})`);
await key("Escape"); await sleep(300);

// ── ⑫ 폴더 없는 타일 → 탭의 프로젝트 폴더 · 빈 탭 → 모든 대화 ──────────────────────
await focusPaneBody(shellA);
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const t = w.activeTab(); const lf = s.newLocalFsPane ? s.newLocalFsPane() : null; if (lf) { w.openPaneInTab(t.id, lf); } })()`); await sleep(700);
const sLf = await state();
const lfPane = sLf.panes.find((p) => p.kind === "localfs");
check(!!lfPane && sLf.focus === lfPane.id, `준비: 같은 탭의 파일 타일에 포커스 (${sLf.focus})`);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
pk = await picker();
check(pk.source === "tab" && pk.chips[0] === "이 워크트리 · 3*" && pk.where?.includes("feat-y"), `폴더 없는 타일 → 그 탭의 프로젝트 폴더(feat-y) (${pk.source} · ${pk.chips})`);
await key("Escape"); await sleep(300);
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; w.openTab(s.newTab()); })()`); await sleep(500);
await key("KeyY", CTRL | SHIFT, "Y"); await sleep(500);
pk = await picker();
check(pk.source === "none" && JSON.stringify(pk.chips) === JSON.stringify(["모든 대화 · 11*"]) && pk.where === null, `빈 탭 → 모든 대화 하나 (${pk.chips})`);
await key("Escape"); await sleep(300);

// ── ⑬ 시작 화면 — 대화 0 · 새 워크트리도 선다 ────────────────────────────────
// 프로젝트 · 워크트리 열기는 이 워크스페이스에 그 폴더의 타일이 이미 있으면 그 타일로 간다(`projectOpenPlan` — 새로 열지 않는다).
// 위에서 연 셸 탭(feat-y · quiet · empty)을 걷어 시작 화면이 서는 길을 본다
const closeAllTabs = async () => { await ev(`(async () => { const w = await ${tabsMod}; for (const t of [...w.currentWorkspaceTabs()]) w.closeTab(t.id); })()`); await sleep(500); };
await closeAllTabs();
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectInNewTab(l.projects().find(p => p.id === 'P3')); })()`); await sleep(1000);
let st = await state();
check(st.panes.length === 1 && st.panes[0].kind === "start" && st.panes[0].start?.projectId === "P3", `대화 0 인 프로젝트도 시작 화면 (${st.panes[0]?.kind})`);
const pe = JSON.parse(await ev(`JSON.stringify({ empty: ${PS}.querySelector('[data-start-empty]')?.textContent.trim() ?? null, btn: !!${PS}.querySelector('[data-start-show-project]'), chips: ${PS}.querySelectorAll('[data-scope-chip]').length, focus: document.activeElement?.dataset?.startAction ?? null })`));
check(pe.empty === "이 워크트리에서 나눈 대화가 아직 없습니다" && !pe.btn && pe.chips === 2 && pe.focus === "shell", `빈 상태 · 칩 둘(이 워크트리 · 모든 대화) · 단추 없음 · 키보드는 기본 셸 단추 (${JSON.stringify(pe)})`);
await key("Enter"); await sleep(700);
st = await state();
check(st.panes[0].kind === "local" && st.panes[0].cwd === "C:\\src\\quiet" && st.panes[0].autorun === null, `Enter → 곧장 셸 (${JSON.stringify(st.panes[0])})`);
// 빈 워크트리(aynx/empty) — 칩 둘 · 이 프로젝트 전체 보기
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; const p = l.projects().find(p => p.id === 'P1'); await m.openProjectWorktree(p, { path: 'C:/src/proj-wt/empty', branch: 'empty', head: 'c3', bare: false, detached: false }); })()`); await sleep(1000);
st = await state();
check(st.panes[0].kind === "start" && st.title === "aynx · empty", `워크트리 열기 → 시작 화면 (${st.title})`);
const pe2 = JSON.parse(await ev(`JSON.stringify({ empty: ${PS}.querySelector('[data-start-empty]')?.textContent.trim() ?? null, btn: ${PS}.querySelector('[data-start-show-project]')?.textContent.trim() ?? null, chips: [...${PS}.querySelectorAll('[data-scope-chip]')].map(c => c.textContent.trim() + (c.classList.contains('on') ? '*' : '')), keys: ${PS}.querySelector('[data-start-keys]').textContent.replace(/\\s+/g, ' ').trim(), focus: document.activeElement?.dataset?.startAction ?? null })`));
console.log("pstart empty:", JSON.stringify(pe2));
check(pe2.btn === "이 프로젝트 전체 보기 · 10" && JSON.stringify(pe2.chips) === JSON.stringify(["이 워크트리 · 0*", "이 프로젝트 전체 · 10", "모든 대화 · 11"]) && pe2.focus === "shell", `빈 워크트리 — 칩 셋 · 단추 · 키보드는 셸 (${pe2.btn})`);
// R(시작 명령 단추)은 2026-09-28 에 걷혔다(project-start.ts — 시작 명령이 에이전트 선택으로)
check(pe2.keys === "Tab 범위 S C X 새로 시작", `바닥 줄에 Tab 범위 (${pe2.keys})`);
console.log("capture:", await shot("pstart-empty.png"));
await key("Tab"); await sleep(300);
const pe3 = JSON.parse(await ev(`JSON.stringify({ rows: ${PS}.querySelectorAll('[data-start-row]').length, on: ${PS}.querySelector('[data-scope-chip].on')?.dataset.scopeChip ?? null, more: ${PS}.querySelector('[data-start-more]')?.textContent.trim() ?? null })`));
check(pe3.on === "project" && pe3.rows === 5 && pe3.more === "5개 더 보기", `Tab → 이 프로젝트 전체(5줄 + 더 보기) (${JSON.stringify(pe3)})`);
await key("Tab"); await sleep(300);
check((await ev(`${PS}.querySelector('[data-scope-chip].on')?.dataset.scopeChip`)) === "all", "Tab 한 번 더 → 모든 대화");
await key("Tab"); await sleep(300);
check((await ev(`${PS}.querySelector('[data-scope-chip].on')?.dataset.scopeChip`)) === "here", "Tab 한 번 더 → 끝에서 처음(이 워크트리)");
await ev(`${PS}.querySelector('[data-start-show-project]').click()`); await sleep(300);
check((await ev(`${PS}.querySelectorAll('[data-start-row]').length`)) === 5, "단추 → 이 프로젝트 전체");
// 대화가 있는 워크트리 — 칩이 서도 예전처럼 첫 줄이 골라져 있다
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; const p = l.projects().find(p => p.id === 'P1'); await m.openProjectWorktree(p, { path: '${FEAT}', branch: 'feat-y', head: 'b2', bare: false, detached: false }); })()`); await sleep(1000);
const pf = JSON.parse(await ev(`JSON.stringify({ chips: [...${PS}.querySelectorAll('[data-scope-chip]')].map(c => c.textContent.trim() + (c.classList.contains('on') ? '*' : '')), sel: ${PS}.querySelector('[data-start-row].selected')?.dataset.startRow ?? null })`));
check(JSON.stringify(pf.chips) === JSON.stringify(["이 워크트리 · 3*", "이 프로젝트 전체 · 10", "모든 대화 · 11"]) && pf.sel === id(20), `대화가 있는 워크트리 — 칩 셋 · 사용 중 아닌 첫 줄 (${JSON.stringify(pf)})`);
// 새 워크트리 — 만들자마자 시작 화면
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectInNewWorktree(l.projects().find(p => p.id === 'P1'), 'brand-new'); })()`); await sleep(1200);
st = await state();
check(st.panes[0].kind === "start" && st.panes[0].start?.folder === "C:/src/proj-wt/brand-new" && st.title === "aynx · brand-new", `새 워크트리 → 시작 화면 (${JSON.stringify(st.panes[0])})`);
// 설정 off → 곧장 셸(예전 그대로) — quiet 셸 탭(위 Enter)이 남아 있으면 그 탭으로 갈 뿐이라 먼저 걷는다
await closeAllTabs();
const setMod = importApp("lib/settings.svelte.ts");
await ev(`(async () => { const s = await ${setMod}; s.setProjectStartScreen('off'); })()`); await sleep(200);
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectInNewTab(l.projects().find(p => p.id === 'P3')); })()`); await sleep(900);
check((await state()).panes[0].kind === "local", "설정 off → 곧장 셸");
await ev(`(async () => { const s = await ${setMod}; s.setProjectStartScreen('auto'); })()`);

// ── ⑭ 저장 짐 — 대화 제목 없음 ───────────────────────────────────────────────
await sleep(2500);
const saved = await ev(`(() => { const c = window.__calls.filter(c => c[0] === 'workspaces_apply' && c[1]?.mutation?.op === 'putTabs').at(-1); return c ? JSON.stringify(c[1]) : null; })()`);
check(typeof saved === "string" && !/Feature Y|Busy elsewhere|Fix the flaky|Conversation \d|Scratch question/.test(saved), `workspaces.json 에 대화 제목 없음 (${saved ? saved.length + " B" : "저장 없음"})`);

console.log(errors.length ? "exceptions:\n  " + errors.join("\n  ") : "no exceptions");
check(errors.length === 0, `예외 0 (${errors.length})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
