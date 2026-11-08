// Headless harness: **지난 대화 · 사용량의 남은 문** — 사용량 화면 · 상태바 고리 · 팔레트 `대화 ` / "사용량" ·
// 다시 뜬 뒤의 재개 타일 (docs/log/2026-09-26-agent-sessions.md · docs/log/2026-09-26-agent-usage.md).
// 스텁은 `agent-board-harness.mjs` 의 사본 — 프로젝트 · 워크트리 · `agent_sessions_list` · `agent_session_launch_spec` 을 더했다.
//
// 대시보드 에이전트 칸의 "지난 대화" 덩어리(범위 목록 · 오른쪽 줄 · 호버 단추 · 경로 없음 · 열림 · 거르개 · 키보드 · 줄의 토큰 ·
// 풀이 · 머리줄 합)는 4dda594(2026-09-28 — docs/log/2026-09-28-dashboard-session-cards.md)에 빠졌다. 지난 대화는 이제
// 팔레트 `대화 ` · 프로젝트 시작 화면 · 기록 시트가 맡는다(시작 화면 · 시트는 `project-start-harness.mjs`). 대시보드 칸은
// 세션 · 작업안 · 사용량 셋이다.
//
//   npx vite --port 1434 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-convo \
//     --window-size=1200,900 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/convo-harness.mjs outdir 9250
//
// 심어 두는 것: 로컬 프로젝트 둘(aynx — 워크트리 feat-y · 사라진 old-wt / infra) + 원격 하나(api).
// 대화: aynx 주 폴더 10개(Claude 9 · Codex 1 — 하나는 합성 제목, 하나는 포크) · feat-y 1 · old-wt 1(폴더 없음) ·
// 기타 2(~/scratch 하나 · 사라진 폴더 하나).
//
// 보는 것: Ⓐ 사용량 화면 맨 위 "사용 한도" — 카드 둘(Claude 값 · Codex 빈 안내) · 창 라벨은 분에서 · 80% 경고색 · 잰 시각 ·
// 초기화 글자 · 대시보드에 지난 대화 덩어리가 없다 ⑧ 팔레트 `대화 ` — 줄 · Enter = 재개(AI 타일 · autorun 이
// `agent_autorun_command` 를 지나 `--settings` 가 붙어 쓰인다) · 부분 글자 · 빈 찾기 = 최신순 · 접두사 없으면 대화 없음
// Ⓕ 상태바 고리 — 늘 선다 · 값 없는 에이전트는 "–" · 단 · 묵음 · 네 자리(위·아래·왼쪽·오른쪽 — 세로는 % 없는 숫자) ·
// 누르면 사용량 화면 토글(열림 · 다시 누르면 닫힘 · 움직임 · 배타 · Escape · 탭으로 걷힘) Ⓖ 팔레트 "사용량" 줄 → 사용량 화면 Ⓗ 사용량 화면 — 머리줄 · 한도 카드 자리 ·
// 거르개(기본 30일 · 기억) · 요약 띠 · 잔디 · 고른 날 · 7일 막대 · 토큰 구성 · 모델 표 ⑩ 페이지가 다시 떠도 재개 타일은
// autorun 을 다시 돌리고 그 대화는 "열림"(팔레트 줄) ⑪ 예외 0.
// PNG: convo-palette.png · usage-section.png · usage-rings-left.png · usage-rings-bottom.png · usage-section-1920.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9250";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1434";
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
  window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, id: h, payload }));
  const HOSTS = [{ name: 'dev-01', host_name: '10.0.0.2', user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } }];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const AYNX = 'C:\\\\src\\\\proj', FEAT = 'C:/src/proj-wt/feat-y', OLD = 'C:/src/proj-wt/old-wt', INFRA = 'C:\\\\src\\\\infra';
  const PROJECTS = [
    { id: 'P1', name: 'aynx', host: null, path: AYNX, shell: null, command: 'claude', tmux: false },
    { id: 'P2', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: 'claude', tmux: false },
    { id: 'P3', name: 'infra', host: null, path: INFRA, shell: null, command: 'claude', tmux: false },
  ];
  const WT = { [AYNX]: [{ path: 'C:/src/proj', branch: 'main', head: 'a1' }, { path: FEAT, branch: 'feat-y', head: 'b2' }, { path: OLD, branch: 'old-wt', head: 'c3' }] };
  const H = 3600_000, NOW = Date.now();
  const id = (i) => '11111111-2222-4333-8444-' + String(i).padStart(12, '0');
  const S = (i, cwd, ago, extra = {}) => ({ agent: 'claude', id: id(i), cwd, branch: 'main', title: 'Conversation ' + i, titleSource: 'ai', startedAt: NOW - ago - H, updatedAt: NOW - ago, model: 'claude-opus-5', forkedFrom: null, cwdExists: true, ...extra });
  const MAIN = [
    S(1, AYNX, 5 * 60_000, { title: 'Fix the flaky build script' }),
    S(2, AYNX, 2 * H, { titleSource: 'fallback', title: 'Claude Code · main' }),
    S(3, AYNX, 3 * H, { agent: 'codex', id: '01a07989-25f8-7e72-99aa-000000000003', title: 'Retry loop for uploads', titleSource: 'custom', model: 'gpt-6-codex', forkedFrom: '01a07989-25f8-7e72-99aa-000000000009' }),
    ...[4, 5, 6, 7, 8, 9, 10].map((i) => S(i, AYNX, (26 + i) * H)),
  ];
  window.__convo = {
    [AYNX.toLowerCase()]: MAIN,
    [FEAT.toLowerCase()]: [S(20, FEAT, 30 * 60_000, { branch: 'feat-y', title: 'Feature Y wiring' })],
    [OLD.toLowerCase()]: [S(21, OLD, 400 * H, { branch: 'old-wt', title: 'Old experiment', cwdExists: false })],
    // 팔레트 찾기 — 부분 글자만 걸려야 한다('Reset some unrelated memo' 는 r·e·s·u·m·e 가 흩어져 든 제목)
    [INFRA.toLowerCase()]: [S(40, INFRA, 50 * H, { title: 'Aynx resume test' }), S(41, INFRA, 51 * H, { title: 'Reset some unrelated memo' })],
  };
  const OTHERS = [S(30, 'C:\\\\Users\\\\me\\\\scratch', 90 * 60_000, { title: 'Scratch question' }), S(31, 'C:\\\\Users\\\\me\\\\gone', 900 * H, { title: 'Gone folder', cwdExists: false })];
  window.__launch = [];
  // ── 사용량 (2단계) ──
  window.__autorun = [];
  const TK = (total, today, week, extra = {}) => ({ tokens: { input: Math.round(total * 0.1), cacheRead: Math.round(total * 0.7), cacheWrite: Math.round(total * 0.1), output: total - 3 * Math.round(total * 0.1) - Math.round(total * 0.7) + Math.round(total * 0.1) }, total, today, week, subagents: false, forked: false, ...extra });
  window.__usage = { files: 20, elapsedMs: 3, conversations: [
    { agent: 'claude', id: id(1), ...TK(612345, 612345, 612345, { subagents: true }) },
    { agent: 'claude', id: id(2), ...TK(606255, 606255, 606255) },
    { agent: 'codex', id: '01a07989-25f8-7e72-99aa-000000000003', ...TK(21400, 21400, 21400, { forked: true }) },
    ...[4, 5, 6, 7, 8, 9, 10].map((i) => ({ agent: 'claude', id: id(i), ...TK(1094000, 0, 1094000) })),
  ] };
  const T0 = Date.now();
  window.__limits = [
    { agent: 'claude', measuredAt: T0 - 12 * 60_000, windows: [
      { windowMinutes: 10080, kind: 'seven_day', usedPercent: 83, resetsAt: Math.floor((T0 + 6 * 24 * H) / 1000) },
      { windowMinutes: 300, kind: 'five_hour', usedPercent: 23.5, resetsAt: Math.floor((T0 + 2 * H + 10 * 60_000) / 1000) },
    ] },
    { agent: 'codex', measuredAt: null, windows: [], seen: true },
  ];
  window.__limits[0].seen = true;
  // 기간 요약 — 오늘로 끝나는 N일, 기록은 20일 전부터(그 앞은 "기록 전"), 모델 셋
  const pad2 = (n) => String(n).padStart(2, '0');
  const isoOf = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  window.__summaryCalls = [];
  window.__summary = (days, agent) => {
    const n = days ?? 30;
    const span = Math.max(n, 35);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daily = [], buckets = [];
    const models = { 'claude:claude-opus-5-20260101': { agent: 'claude', model: 'claude-opus-5-20260101', t: [0, 0, 0, 0], conv: 3 }, 'claude:claude-haiku-5': { agent: 'claude', model: 'claude-haiku-5', t: [0, 0, 0, 0], conv: 2 }, 'codex:gpt-6-codex': { agent: 'codex', model: 'gpt-6-codex', t: [0, 0, 0, 0], conv: 1 } };
    let first = null;
    const all = [];
    for (let i = span - 1; i >= 0; i--) {
      const d = new Date(today); d.setDate(d.getDate() - i);
      const date = isoOf(d);
      let tok = [0, 0, 0, 0];
      if (i <= 20 && i % 4 !== 3) {
        first ??= date;
        for (const [k, m] of Object.entries(models)) {
          if (agent && m.agent !== agent) continue;
          const base = (k.startsWith('claude:claude-opus') ? 400000 : k.startsWith('claude') ? 60000 : 90000) * (1 + (i % 5));
          const t = [Math.round(base * 0.05), Math.round(base * 0.8), Math.round(base * 0.1), Math.round(base * 0.05)];
          buckets.push({ date, agent: m.agent, model: m.model, tokens: { input: t[0], cacheRead: t[1], cacheWrite: t[2], output: t[3] }, total: t[0] + t[1] + t[2] + t[3] });
          tok = tok.map((x, j) => x + t[j]); if (i < n) m.t = m.t.map((x, j) => x + t[j]);
        }
      }
      all.push({ date, tokens: { input: tok[0], cacheRead: tok[1], cacheWrite: tok[2], output: tok[3] }, total: tok.reduce((a, b) => a + b, 0) });
    }
    daily.push(...all.slice(-n));
    const recent = all.slice(-35);
    const ms = Object.values(models).filter((m) => !agent || m.agent === agent).map((m) => ({ agent: m.agent, model: m.model, tokens: { input: m.t[0], cacheRead: m.t[1], cacheWrite: m.t[2], output: m.t[3] }, total: m.t.reduce((a, b) => a + b, 0), conversations: m.conv })).sort((a, b) => b.total - a.total);
    return { today: isoOf(today), start: daily[0].date, firstDay: first, agents: ['claude', 'codex'], daily, recent, buckets, models: ms, streak: 3, priorAvg: 500000, priorDays: 7, elapsedMs: 2 };
  };
  window.__persistWorkspace = true;
  if (sessionStorage.getItem('h.reload') && sessionStorage.getItem('h.ws')) window.__workspaceSeed = JSON.parse(sessionStorage.getItem('h.ws'));
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
     load_snippets: null, 
     save_snippets: null, 
    load_settings: {}, save_settings: null,
    host_history_list: {},
    projects_list: PROJECTS,
    ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12, close_ssh: null,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_lock: null,
    mcp_status: { clis: [] }, mcp_activity: null, list_forwards: [], session_log_path: null,
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    list_operations: { pending: [], recent: [] },
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
      if (cmd === 'git_worktree_list') return Promise.resolve(WT[args.repo] ?? []);
      if (cmd === 'agent_sessions_list') {
        const byKey = {}; for (const [k, v] of Object.entries(window.__convo)) byKey[key(k)] = v;
        return Promise.resolve({
          groups: args.cwds.map((c) => ({ cwd: c, exists: key(c) !== key(OLD), sessions: byKey[key(c)] ?? [], more: false })),
          others: OTHERS, othersMore: false,
        });
      }
      if (cmd === 'agent_usage_scan') return Promise.resolve(window.__usage);
      if (cmd === 'agent_usage_limits') return Promise.resolve(window.__limits);
      if (cmd === 'agent_usage_summary') { window.__summaryCalls.push(args); return Promise.resolve(window.__summary(args.days, args.agent)); }
      if (cmd === 'load_settings') return Promise.resolve(window.__settings ?? {});
      if (cmd === 'agent_autorun_command') {
        window.__autorun.push(args);
        return Promise.resolve(args.command.startsWith('claude') ? args.command + ' --settings C:/cfg/aynx/usage/claude-settings-default.json' : args.command);
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
await ev(`sessionStorage.clear()`); // 지난 실행의 배치(⑩)가 첫 부팅에 되살아나지 않게
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
counting = true;

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && k === "Enter" ? { text: String.fromCharCode(13) } : {}) }); await sleep(250); };
const SHIFT = 8, CTRL = 2;
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const projMod = importApp("app/projects.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");
const C = `document.querySelector('[data-convo]')`;
const dashOpen = () => ev(`(() => { const c = document.querySelector('.console'); return !!c && !c.hidden && !c.inert; })()`);
// 사용량 화면(2026-10-04 — 대시보드의 칸에서 제 판으로) — 닫히는 중(inert)은 닫힌 것으로 센다
const usageOpen = () => ev(`(() => { const c = document.querySelector('[data-usage-view]'); return !!c && !c.hidden && !c.inert; })()`);
const ringPressed = () => ev(`[...document.querySelectorAll('[data-usage-ring]')].map(b => b.getAttribute('aria-pressed') + (b.classList.contains('active') ? '*' : '')).join('|')`);
const toggle = async () => { await key("KeyM", 10, "M"); await sleep(900); };
const hover = async (sel) => { const r = await ev(`(() => { const b = document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return [b.left + 40, b.top + b.height / 2]; })()`); await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] }); await sleep(250); };
const unhover = async () => { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5 }); await sleep(200); };
const where = () => ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return t ? t.id + '/' + w.paneOf(t) : null; })()`);
const lastPane = () => ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); const walk = (n, o) => (n.type === 'leaf' ? o.push(n.pane) : (walk(n.a, o), walk(n.b, o)), o); const p = walk(t.root, []).find(p => p.id === w.paneOf(t)); return p ? JSON.stringify({ autorun: p.autorun ?? null, cwd: p.cwd ?? null, inject: !!p.injectMcpToken }) : null; })()`);

// ── Ⓐ 사용 한도 ────────────────────────────────────────────────────────────
// (대시보드 "지난 대화" 덩어리 ①~⑦ · Ⓑ~Ⓓ 는 4dda594 에 빠졌다 — 머리말)
await toggle();
check((await dashOpen()) === true, "Ctrl+Shift+M → 대시보드");
await sleep(600);
check((await ev(`!document.querySelector('[data-convo]') && !document.querySelector('[data-agent-board]')`)) === true, "대시보드에 지난 대화 · 에이전트 칸 덩어리는 없다 (4dda594)");
const U = `document.querySelector('[data-usage-limits]')`;
check((await ev(`!document.querySelector('[data-section-btn="usage"]') && [...document.querySelectorAll('.console [data-section-btn]')].map(b => b.dataset.sectionBtn).join('|')`)) === "sessions|operations", "대시보드 칸은 둘 — 사용량 칸 없음 (2026-10-04)");
// 대시보드가 떠 있는 채 고리를 누른다 → 사용량 화면이 서고 대시보드는 걷힌다(배타)
await ev(`document.querySelector('[data-usage-ring="claude"]').click()`); await sleep(700);
check([await usageOpen(), await dashOpen()].join() === "true,false", "대시보드 위에서 고리 → 사용량 화면 · 대시보드 걷힘(배타)");
check((await ev(`document.querySelector('[data-usage-view] [data-usage-board]')?.firstElementChild?.hasAttribute('data-usage-limits')`)) === true, "사용 한도 = 사용량 화면의 맨 위");
const lim = JSON.parse(await ev(`JSON.stringify({ heading: ${U}.querySelector('#agents-usage-h').textContent.trim(), refresh: ${U}.querySelector('[data-usage-refresh]').getAttribute('aria-label'), cards: [...${U}.querySelectorAll('[data-usage-card]')].map(c => ({ agent: c.dataset.usageCard, empty: c.hasAttribute('data-empty'), measured: c.querySelector('[data-measured]')?.textContent.trim() ?? null, hint: c.querySelector('[data-usage-empty]')?.textContent.trim() ?? null, rows: [...c.querySelectorAll('[data-usage-row]')].map(r => [r.dataset.usageRow, r.querySelector('.pct').textContent.trim(), r.dataset.level, r.querySelector('[data-reset]').textContent.trim()]) })) })`));
console.log("limits:", JSON.stringify(lim));
check(lim.heading === "사용 한도" && lim.refresh === "새로고침", `머리 + 새로고침 (${lim.heading} · ${lim.refresh})`);
const cl = lim.cards.find((c) => c.agent === "claude");
const cx = lim.cards.find((c) => c.agent === "codex");
check(cl && !cl.empty && cl.measured === "12분 전 기준", `Claude 카드 — 잰 시각 (${cl?.measured})`);
check(JSON.stringify(cl?.rows.map((r) => [r[0], r[1], r[2]])) === JSON.stringify([["5시간", "24%", "normal"], ["7일", "83%", "warn"]]), `창은 분에서 라벨 · 짧은 것부터 · 83% = 경고 단 (${JSON.stringify(cl?.rows)})`);
check(/^2시간 (9|10)분 뒤 초기화$/.test(cl?.rows[0][3] ?? "") && /10월|\d+월/.test(cl?.rows[1][3] ?? ""), `초기화 글자 — 하루 안은 남은 시간, 멀면 날짜 (${cl?.rows.map((r) => r[3]).join(" / ")})`);
check(cx?.empty === true && (cx?.hint ?? "").startsWith("Codex 를 쓰면"), `값이 없는 Codex = 안내 한 줄(숫자 없음) (${cx?.hint})`);
const warnFill = await ev(`(() => { const p = document.createElement('span'); p.style.background = 'var(--warn)'; document.body.appendChild(p); const v = getComputedStyle(p).backgroundColor; p.remove(); const f = ${U}.querySelector('[data-level="warn"] .fill'); return getComputedStyle(f).backgroundColor === v && parseFloat(f.style.width) === 83; })()`);
check(warnFill === true, "83% 막대 = 경고색 · 폭 83%");
const noAccent = await ev(`(() => { const p = document.createElement('span'); p.style.background = 'var(--accent)'; document.body.appendChild(p); const v = getComputedStyle(p).backgroundColor; p.remove(); return [...${U}.querySelectorAll('[data-level="normal"] .fill')].every(f => getComputedStyle(f).backgroundColor === v); })()`);
check(noAccent === true, "보통 단 막대 = primary(MD3 게이지 채움 — 10-18)");
// 사용량 화면 위에서 대시보드 키 → 대시보드가 서고 사용량 화면은 걷힌다(배타의 반대쪽)
await toggle();
check([await dashOpen(), await usageOpen()].join() === "true,false", "사용량 화면 위에서 Ctrl+Shift+M → 대시보드 · 사용량 화면 걷힘(배타)");
await toggle(); // 닫기

// ── ⑧ 팔레트 `대화 ` ─────────────────────────────────────────────────────────
const P = `document.querySelector('.palette')`;
const SCRATCH = "11111111-2222-4333-8444-000000000030"; // 기타 폴더(~/scratch)의 대화 — 밖에서 열리지 않았다(90분 전)
await key("KeyP", CTRL | SHIFT, "P"); await sleep(500);
await send("Input.insertText", { text: "대화 scratch" }); await sleep(400);
const pal = JSON.parse(await ev(`JSON.stringify({ sections: [...${P}.querySelectorAll('.section')].map(s => s.textContent.trim()), rows: [...${P}.querySelectorAll('[data-row]')].map(r => r.querySelector('.label').textContent.trim() + ' | ' + (r.querySelector('.tail')?.textContent.trim() ?? '')), hint: ${P}.querySelector('[data-keys]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null })`));
console.log("palette:", JSON.stringify(pal));
check(pal.sections.join("|") === "지난 대화" && pal.rows.length === 1 && pal.rows[0].startsWith("Scratch question | ~/scratch"), `대화 접두사 → 지난 대화 줄 (${pal.rows.join(" / ")})`);
check(/Shift.*새 대화로 계속/.test(pal.hint ?? ""), `고른 줄의 변형 힌트 = Shift ↵ 새 대화로 계속 (${pal.hint})`);
const footFits = await ev(`(() => { const f = ${P}.querySelector('[data-palette-foot]'); const last = [...f.querySelectorAll('.grp')].pop(); return last.getBoundingClientRect().right <= f.getBoundingClientRect().right - 12; })()`);
check(footFits === true, "바닥 줄의 접두사가 넘치지 않는다");
console.log("capture:", await shot("convo-palette.png"));
const before = await ev(`window.__launch.length`);
await key("Enter"); await sleep(700);
const l3 = JSON.parse(await ev(`JSON.stringify(window.__launch.at(-1))`));
check((await ev(`window.__launch.length`)) === before + 1 && l3?.mode === "resume" && l3?.id === SCRATCH, `팔레트 Enter = 재개 (${JSON.stringify(l3)})`);
// 재개 = 그 명령으로 AI 타일 — autorun 이 `agent_autorun_command` 를 지나 `--settings` 가 붙어 셸에 쓰인다(명세의 autorun 은 그대로)
await sleep(600);
const resumed = JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const walk = (n, o) => (n.type === 'leaf' ? o.push(n.pane) : (walk(n.a, o), walk(n.b, o)), o); for (const t of w.residentWindowTabs()) for (const p of walk(t.root, [])) if (p.autorun === 'claude --resume ${SCRATCH}') return JSON.stringify({ autorun: p.autorun, inject: !!p.injectMcpToken }); return 'null'; })()`));
check(resumed?.inject === true, `재개 = 그 명령의 AI 타일 (${JSON.stringify(resumed)})`);
const ar = JSON.parse(await ev(`JSON.stringify(window.__autorun.at(-1) ?? null)`));
check(ar?.command === `claude --resume ${SCRATCH}` && ar?.shell === "pwsh", `autorun 이 agent_autorun_command 를 지난다 (${JSON.stringify(ar)})`);
const wrote = await ev(`window.__calls.filter(c => c[0] === 'write_session').map(c => JSON.stringify(c[1])).find(s => s.includes('--resume ${SCRATCH}')) ?? null`);
check(typeof wrote === "string" && wrote.includes("--settings C:/cfg/aynx/usage/claude-settings-default.json"), `셸에 쓰인 줄에 --settings 가 붙었다 (${wrote})`);
await key("KeyP", CTRL | SHIFT, "P"); await sleep(400);
await send("Input.insertText", { text: "대화 resume" }); await sleep(400);
const resumeRows = await ev(`[...${P}.querySelectorAll('[data-row] .label')].map(l => l.textContent.trim()).join('|')`);
check(resumeRows === "Aynx resume test", `대화 찾기는 부분 글자 — 흩어진 글자는 걸리지 않는다 (${resumeRows})`);
await key("Escape");
await key("KeyP", CTRL | SHIFT, "P"); await sleep(400);
await send("Input.insertText", { text: "대화 " }); await sleep(400);
const allRows = await ev(`[...${P}.querySelectorAll('[data-row] .label')].map(l => l.textContent.trim())`);
check(Array.isArray(allRows) && allRows[0] === "Fix the flaky build script" && allRows.length >= 10, `빈 찾기 = 최신순 전부 (${allRows?.[0]} · ${allRows?.length})`);
await key("Escape");
await key("KeyP", CTRL | SHIFT, "P"); await sleep(400);
await send("Input.insertText", { text: "web" }); await sleep(300);
const plain = await ev(`[...${P}.querySelectorAll('.section')].map(s => s.textContent.trim()).join('|')`);
check(!String(plain).includes("지난 대화"), `접두사 없는 질의에는 대화가 서지 않는다 (${plain})`);
await key("Escape");

// ── Ⓕ 상태바 고리 ────────────────────────────────────────────────────────────
if (await dashOpen()) await toggle();
const ringsOf = () => ev(`JSON.stringify([...document.querySelectorAll('[data-usage-ring]')].map(b => ({ agent: b.dataset.usageRing, level: b.dataset.level, stale: b.hasAttribute('data-stale'), pct: b.querySelector('[data-ring-pct]').textContent.trim(), fill: !!b.querySelector('.r-fill'), tip: b.getAttribute('aria-label') ?? '' })))`);
// 고리의 숫자 — 가로 띠는 "83%", 세로 기둥은 "83"(칸 폭이 좁다). 상태바 기본 자리는 왼쪽 기둥이다(f8416d7).
const pctOf = async (n) => ((await ev(`document.querySelector('.statusbar')?.classList.contains('vertical') ?? false`)) ? String(n) : `${n}%`);
let rings = JSON.parse(await ringsOf());
console.log("rings:", JSON.stringify(rings.map((r) => [r.agent, r.level, r.pct, r.stale])));
check(rings.length === 2 && rings[0].agent === "claude" && rings[0].pct === (await pctOf(83)) && rings[0].level === "warn" && rings[0].fill, `Claude 고리 = 가장 긴 창(7일) 83% · 경고 단 (${JSON.stringify(rings[0])})`);
check(rings[1]?.agent === "codex" && rings[1].pct === "–" && !rings[1].fill, "값이 없는 Codex(본 적은 있다) = 빈 고리 + –");
// 말풍선은 호버 막대 카드가 맡고(910ed63) 같은 글은 고리의 이름(aria-label)에 남는다
check(/5시간 24%.*7일 83%.*Claude Code · 12분 전 기준$/.test(rings[0].tip), `고리 이름 = 창마다 + 에이전트 · 기준 (${rings[0].tip})`);
// 고리 = 사용량 화면의 **토글** — 누르면 열리고(아래에서 떠오른다) 다시 누르면 닫힌다(아래로 내려간다).
// 클릭은 실제 포인터로(pointerdown → click — 독의 바깥 클릭 판정과의 경합까지 지난다).
const clickRing = async () => { const r = await ev(`(() => { const b = document.querySelector('[data-usage-ring="claude"]').getBoundingClientRect(); return [b.left + b.width / 2, b.top + b.height / 2]; })()`); for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x: r[0], y: r[1], button: "left", clickCount: 1 }); };
const uvMotion = () => ev(`(() => { const c = document.querySelector('[data-usage-view]'); const cs = getComputedStyle(c); return JSON.stringify({ t: cs.transform, o: +(+cs.opacity).toFixed(2), anim: c.getAnimations().length, hidden: c.hidden, closing: c.hasAttribute('data-closing') }); })()`).then(JSON.parse);
check((await ringPressed()) === "false|false", "닫혀 있으면 고리 aria-pressed=false");
await ev(`document.querySelectorAll('.xterm textarea')[0]?.focus()`); await sleep(100);
// 포인터로 누르면 고리 단추가 먼저 포커스를 받는다 — "열기 전 포커스" 는 그 고리다(대시보드 상태바 칸과 같다)
await clickRing(); await sleep(120);
let uvm = await uvMotion();
console.log("usage open+120ms:", JSON.stringify(uvm));
check((await usageOpen()) === true && uvm.anim === 1 && /matrix\(1, 0, 0, 1, 0, [\d.]+\)/.test(uvm.t) && +uvm.t.match(/([\d.]+)\)$/)[1] > 0 && uvm.o < 1, `고리 → 열림 · 판이 아래(translateY>0)에서 떠오르는 중 (${JSON.stringify(uvm)})`);
await sleep(700);
uvm = await uvMotion();
check(uvm.t === "none" && uvm.o === 1 && uvm.anim === 0, `다 열린 뒤 transform none · 불투명도 1 (${JSON.stringify(uvm)})`);
check((await ringPressed()) === "true*|true*", "열려 있으면 고리 aria-pressed=true · .active");
check((await ev(`!!document.activeElement?.closest('[data-usage-view]')`)) === true, "열리면 키보드는 사용량 화면 안");
await clickRing(); await sleep(70);
uvm = await uvMotion();
console.log("usage close+70ms:", JSON.stringify(uvm));
check((await usageOpen()) === false && uvm.closing && !uvm.hidden && /matrix\(1, 0, 0, 1, 0, [\d.]+\)/.test(uvm.t) && +uvm.t.match(/([\d.]+)\)$/)[1] > 0, `다시 누르면 닫힘 — 아래로 내려가는 중(translateY>0 · data-closing) (${JSON.stringify(uvm)})`);
check((await ev(`document.activeElement?.closest('[data-usage-ring]')?.dataset.usageRing ?? document.activeElement?.className`)) === "claude", `닫히면 열기 전 포커스(누른 고리)로 (${await ev(`document.activeElement?.className`)})`);
await sleep(400);
uvm = await uvMotion();
check(uvm.hidden && !uvm.closing && uvm.anim === 0, `내려간 뒤 hidden (${JSON.stringify(uvm)})`);
// Escape 로도 닫힌다
await clickRing(); await sleep(600);
await key("Escape"); await sleep(400);
check((await usageOpen()) === false, "Escape → 사용량 화면 닫힘");
// 탭을 고르면 걷힌다(타일로 가는 길)
await clickRing(); await sleep(600);
await ev(`document.querySelector('.tabs [role="tab"]')?.click()`); await sleep(500);
check((await usageOpen()) === false, "탭 바의 탭을 고르면 사용량 화면이 걷힌다");
const usageMod = importApp("app/agent-usage.svelte.ts");
const reloadLimits = () => ev(`(async () => { const m = await ${usageMod}; await m.loadLimits(); })()`);
await ev(`window.__limits[0].windows[0].usedPercent = 40`); await reloadLimits(); await sleep(300);
rings = JSON.parse(await ringsOf());
check(rings[0]?.level === "normal" && rings[0].pct === (await pctOf(40)), `80% 아래에도 고리는 선다 — 회색 (${JSON.stringify(rings[0])})`);
await ev(`window.__limits[0].windows[0].usedPercent = 97`); await reloadLimits(); await sleep(300);
check(JSON.parse(await ringsOf())[0]?.level === "err", "95% 부터 오류 단");
await ev(`window.__limits[0].measuredAt = Date.now() - 5 * 3600_000`); await reloadLimits(); await sleep(300);
check(JSON.parse(await ringsOf())[0]?.stale === true, "5시간 묵은 값 = data-stale 표식 (흐림은 없음 — 10-11)");
await ev(`window.__limits[0].measuredAt = Date.now() - 12 * 60_000`); await reloadLimits(); await sleep(300);
await ev(`window.__limits[1].seen = false`); await reloadLimits(); await sleep(300);
check(JSON.parse(await ringsOf()).length === 1, "본 적 없는 에이전트는 고리를 세우지 않는다");
await ev(`window.__limits[1].seen = true`); await reloadLimits(); await sleep(300);
// 네 자리 — 고리가 띠 안에 서고, 세로 기둥은 % 없는 숫자. 고리 묶음은 후미(신호) 옆이 아니라 **가운데 묶음**의 맨 앞이다 —
// 사용량 → 구분선 → 워크스페이스, 시작점은 상태바 길이의 28% (8b2b110 · docs/log/2026-10-02-floating-status-dock.md)
const settingsMod = importApp("lib/settings.svelte.ts");
for (const pos of ["bottom", "left", "right", "top"]) {
  await ev(`(async () => { window.__settings = { app: { status_bar: '${pos}' } }; await (await ${settingsMod}).loadSettings(); })()`);
  await sleep(700);
  const geo = JSON.parse(await ev(`(() => { const bar = document.querySelector('.statusbar'); const b = bar.getBoundingClientRect(); const rs = [...bar.querySelectorAll('[data-usage-ring]')].map(r => r.getBoundingClientRect()); const cl = bar.querySelector('[data-usage-rings]'); const sig = bar.querySelector('.signals'); const mid = bar.querySelector('[data-status-middle]'); const m = mid.getBoundingClientRect(); const vertical = bar.classList.contains('vertical'); return JSON.stringify({ vertical, inside: rs.length === 2 && rs.every(r => r.left >= b.left - 0.5 && r.right <= b.right + 0.5 && r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5), pct: [...bar.querySelectorAll('[data-ring-pct]')].map(e => e.textContent.trim()), inMiddle: mid.contains(cl) && !sig.contains(cl), first: mid.firstElementChild === cl, sepAfter: cl.nextElementSibling?.hasAttribute('data-usage-workspaces-separator') === true, start: Math.round(1000 * (vertical ? (m.top - b.top) / b.height : (m.left - b.left) / b.width)) / 1000 }); })()`));
  const vert = pos === "left" || pos === "right";
  check(geo.vertical === vert && geo.inside && geo.pct[0] === (vert ? "97" : "97%"), `상태바 ${pos} — 고리 둘이 띠 안 · ${vert ? "숫자만" : "%"} (${JSON.stringify(geo)})`);
  check(geo.inMiddle && geo.first && geo.sepAfter && Math.abs(geo.start - 0.28) < 0.04, `상태바 ${pos} — 고리는 가운데 묶음의 맨 앞(28%) · 뒤에 워크스페이스와 가르는 선 (${JSON.stringify({ mid: geo.inMiddle, first: geo.first, sep: geo.sepAfter, start: geo.start })})`);
  if (pos === "left") console.log("capture:", await shot("usage-rings-left.png"));
  if (pos === "bottom") console.log("capture:", await shot("usage-rings-bottom.png"));
}

// ── Ⓖ 팔레트 "사용량" ────────────────────────────────────────────────────────
await key("KeyP", CTRL | SHIFT, "P"); await sleep(400);
await send("Input.insertText", { text: "사용량" }); await sleep(400);
const up = await ev(`[...${P}.querySelectorAll('[data-usage-entry]')].map(e => e.dataset.usageEntry + '|' + e.textContent.trim()).join(' / ')`);
check(/^claude\|Claude Code 사용량 — 5시간 24% · 7일 97% · \d+분 전 기준$/.test(up), `팔레트 "사용량" = 값이 있는 에이전트만 (${up})`);
// 빠른 접속 줄이 맨 위에 설 수 있다 — 사용량 줄까지 ↓ 로 내려가 Enter
for (let i = 0; i < 6; i++) {
  if ((await ev(`!!${P}.querySelector('.row.sel [data-usage-entry]')`)) === true) break;
  await key("ArrowDown");
}
await key("Enter"); await sleep(700);
check((await usageOpen()) === true && (await dashOpen()) === false && (await ev(`!!document.querySelector('[data-usage-view] [data-usage-board]')?.offsetParent`)) === true, "사용량 줄 Enter → 사용량 화면");

// ── Ⓗ 사용량 칸 ──────────────────────────────────────────────────────────────
const UB = `document.querySelector('[data-usage-board]')`;
await sleep(500);
const uvHead = await ev(`document.querySelector('[data-usage-view] .head')?.textContent.replace(/\\s+/g, ' ').trim()`);
check(/^사용량 토큰 · 요금제 한도/.test(uvHead ?? ""), `사용량 화면 머리줄 (${uvHead})`);
console.log("capture:", await shot("usage-view-dark.png"));
await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(300);
console.log("capture:", await shot("usage-view-light.png"));
await send("Emulation.setDeviceMetricsOverride", { width: 680, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(500);
check((await ev(`(() => { const v = document.querySelector('[data-usage-view]'); const b = v.querySelector('.body'); return b.scrollWidth <= b.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth; })()`)) === true, "680px — 사용량 화면에 가로 넘침 없음");
console.log("capture:", await shot("usage-view-680-light.png"));
await ev(`delete document.documentElement.dataset.theme`); await sleep(300);
console.log("capture:", await shot("usage-view-680-dark.png"));
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(500);
check((await ev(`${UB}.firstElementChild?.hasAttribute('data-usage-limits')`)) === true, "맨 위 = 사용 한도 카드");
const lay = JSON.parse(await ev(`(() => { const c = ${UB}.querySelector('[data-usage-card="claude"]'); const bars = [...c.querySelectorAll('.bar')].map(b => Math.round(b.getBoundingClientRect().width)); const resets = [...c.querySelectorAll('[data-reset]')].map(r => r.scrollWidth <= r.clientWidth + 1); const cards = [...${UB}.querySelectorAll('[data-usage-card]')].map(x => Math.round(x.getBoundingClientRect().width)); const row = Math.round(${UB}.querySelector('.cards').getBoundingClientRect().width); return JSON.stringify({ bars, resets, cards, row }); })()`));
check(lay.bars.length === 2 && lay.bars[0] === lay.bars[1] && lay.bars[0] > 120, `두 줄의 막대가 같은 길이 (${lay.bars})`);
check(lay.resets.every(Boolean), "초기화 글자가 잘리지 않는다");
check(lay.cards.length === 2 && lay.cards[0] + lay.cards[1] >= lay.row - 20, `카드 둘이 한 줄을 반씩 (${lay.cards} / ${lay.row})`);
const firstCall = JSON.parse(await ev(`JSON.stringify(window.__summaryCalls[0] ?? null)`));
check(firstCall?.days === 30 && firstCall?.agent === null, `기본 = 30일 · 전체 (${JSON.stringify(firstCall)})`);
const filt = await ev(`[...${UB}.querySelectorAll('[data-usage-agent], [data-usage-period]')].map(b => (b.dataset.usageAgent ?? b.dataset.usagePeriod) + (b.classList.contains('on') ? '*' : '')).join('|')`);
check(filt === "all*|claude|codex|7|30*", `거르개 — 있는 에이전트만 · 기간은 7일/30일 (${filt})`);
const stripCells = JSON.parse(await ev(`JSON.stringify([...${UB}.querySelectorAll('[data-usage-strip] li')].map(li => [li.dataset.cell, li.querySelector('.v').textContent.trim(), li.querySelector('.sub').textContent.trim()]))`));
console.log("strip:", JSON.stringify(stripCells));
check(stripCells.length === 5 && stripCells[0][0] === "today" && /최근 7일 평균 대비 [+-]\d+%/.test(stripCells[0][2]), `요약 띠 다섯 칸 · 오늘은 평균 대비 (${stripCells[0]})`);
check(/^하루 평균 /.test(stripCells[1][2]) && /^기록 \d+일 중$/.test(stripCells[2][2]) && stripCells[3][1] === "3일" && stripCells[3][2] === "최근 30일 안에서", `기간 합계 · 활동일 · 연속(기간 안에서) (${JSON.stringify(stripCells.slice(1, 4))})`);
const heat = JSON.parse(await ev(`(() => { const h = ${UB}.querySelector('[data-usage-heat]'); const cells = [...h.querySelectorAll('[data-heat-date]')]; const card = h.closest('section').getBoundingClientRect(); const all = [...h.querySelectorAll('[data-heat-date], [data-heat-pre]')]; const grid = h.querySelector('.grid').getBoundingClientRect(); return JSON.stringify({ cellW: Math.round(cells[0].getBoundingClientRect().width), cellH: Math.round(cells[0].getBoundingClientRect().height), fill: Math.round(grid.width) >= Math.round(card.width) - 40, gridH: Math.round(grid.height), cardW: Math.round(card.width), cols: new Set(all.map(c => Math.round(c.getBoundingClientRect().left))).size, rows: new Set(all.map(c => Math.round(c.getBoundingClientRect().top))).size, wdays: [...h.querySelectorAll('.wday')].map(w => w.textContent.trim()).join(''), dom: cells.at(-1).querySelector('.dom')?.textContent.trim(), domLv4: (() => { const c = cells.find(x => x.dataset.level === '4'); if (!c) return null; return getComputedStyle(c.querySelector('.dom')).color !== getComputedStyle(c).backgroundColor; })(), slots: h.querySelectorAll('.cell.slot').length, slotButtons: h.querySelectorAll('button.cell.slot').length, months: document.querySelector('[data-heat-months]')?.textContent.trim() ?? null, real: cells.length, pre: h.querySelectorAll('[data-heat-pre]').length, levels: [...new Set(cells.map(c => c.dataset.level))].sort(), preStyle: getComputedStyle(h.querySelector('[data-heat-pre]')).outlineStyle, last: cells.at(-1).dataset.heatDate, tab: cells.filter(c => c.tabIndex === 0).map(c => c.dataset.heatDate), legend: h.querySelector('[data-heat-recorded]').textContent.trim() }); })()`));
console.log("heat:", JSON.stringify(heat));
const heatN = 29 + new Date().getDay(); // 4주 + 이번 주의 날
check(heat.real + heat.pre === heatN && heat.real === 21 && heat.cols === 7 && heat.rows === 5, `잔디 = 달력 — 다섯 줄 × 일곱 칸(${heatN}칸) · 기록 전 칸 (${heat.real}+${heat.pre} · 칸 ${heat.cols} · 줄 ${heat.rows})`);
check(heat.wdays === "일월화수목금토" && heat.slots === 35 - heatN && heat.slotButtons === 0, `요일 이름 위 · 이번 주 뒤는 빈 자리(누를 수 없음) (${heat.wdays} · 빈 자리 ${heat.slots})`);
check(heat.fill && heat.cellH === 28 && heat.gridH <= 160, `칸이 카드 폭을 채우고 다섯 줄은 낮다 (칸 ${heat.cellW}×${heat.cellH} · 격자 높이 ${heat.gridH} · 카드 ${heat.cardW})`);
check(heat.dom === String(new Date().getDate()) && heat.domLv4 !== false, `칸 안에 며칠 · 밝은 단계에서도 읽힌다 (${heat.dom} · ${heat.domLv4})`);
check(/^\d+월( · \d+월){0,2}$/.test(heat.months ?? ""), `카드 머리에 보이는 달 — 다섯 주라 날짜에 따라 셋까지 (${heat.months})`);
check(heat.preStyle === "dashed", "기록 전 칸 = 점선");
check(heat.levels.includes("0") && heat.levels.includes("4") && heat.levels.length >= 4, `단계가 갈린다 (${heat.levels})`);
check(heat.legend === `기록 21일 / ${heatN}일`, `범례 = 기록 X일 / Y일 (${heat.legend})`);
const today = heat.last;
check(heat.tab.length === 1 && heat.tab[0] === today, "Tab 에 서는 칸은 하나 — 오늘(고른 날)");
check((await ev(`${UB}.querySelector('[data-usage-day]').dataset.usageDay`)) === today, "고른 날 기본 = 오늘");
const pick = await ev(`(() => { const c = [...${UB}.querySelectorAll('[data-heat-date]')].find(c => c.dataset.level !== '0' && c.dataset.heatDate !== '${today}'); c.click(); return c.dataset.heatDate; })()`);
await sleep(300);
const dayAfter = JSON.parse(await ev(`JSON.stringify({ day: ${UB}.querySelector('[data-usage-day]').dataset.usageDay, on: ${UB}.querySelector('[data-heat-date="${pick}"]').classList.contains('on'), agents: [...${UB}.querySelectorAll('[data-day-agent]')].map(a => a.dataset.dayAgent), mix: ${UB}.querySelectorAll('[data-day-mix] span').length, legend: [...${UB}.querySelectorAll('[data-day-model] .m-name')].map(m => m.textContent.trim()) })`));
check(dayAfter.day === pick && dayAfter.on, `칸을 누르면 그날을 고른다(테두리) (${pick})`);
check(dayAfter.agents.join(",") === "claude,codex" && dayAfter.mix === 3 && dayAfter.legend[0] === "opus-5", `고른 날 — 에이전트 몫 · 모델 구성 (${JSON.stringify(dayAfter)})`);
await ev(`${UB}.querySelector('[data-heat-date="${pick}"]').focus()`);
await key("ArrowRight"); await sleep(300);
const moved = await ev(`document.activeElement?.dataset?.heatDate ?? null`);
check(moved !== pick && moved !== null && (await ev(`${UB}.querySelector('[data-usage-day]').dataset.usageDay`)) === moved, `키보드 → = 다음 날을 고르고 포커스가 따라간다 (${moved})`);
await key("ArrowDown"); await sleep(300);
const down7 = await ev(`document.activeElement?.dataset?.heatDate ?? null`);
check(down7 !== null && new Date(down7) - new Date(moved) === 7 * 86400_000, `키보드 ↓ = 한 주 뒤 (${moved} → ${down7})`);
await key("ArrowUp"); await sleep(300);
check((await ev(`document.activeElement?.dataset?.heatDate ?? null`)) === moved, "키보드 ↑ = 한 주 앞(되돌아온다)");
const wk = JSON.parse(await ev(`JSON.stringify({ cols: ${UB}.querySelectorAll('[data-week-day]').length, today: ${UB}.querySelector('[data-week-day].today')?.dataset.weekDay ?? null, legend: [...${UB}.querySelectorAll('[data-usage-week] .legend li')].map(l => l.textContent.trim()) })`));
check(wk.cols === 7 && wk.today === today && wk.legend.join("|") === "opus-5|gpt-6-codex|haiku-5", `7일 막대 · 오늘 표시 · 범례 (${JSON.stringify(wk)})`);
await ev(`document.querySelector('[data-week-day="${today}"]').scrollIntoView({ block: 'center' })`); await sleep(200);
await hover(`[data-week-day="${today}"]`);
const wtip = await ev(`document.querySelector('[data-week-tip]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
check(typeof wtip === "string" && wtip.includes("opus-5") && wtip.includes("gpt-6-codex"), `막대 말풍선 = 모델별 줄 (${wtip})`);
await unhover();
const comp = JSON.parse(await ev(`JSON.stringify({ rows: [...${UB}.querySelectorAll('[data-comp-row]')].map(r => r.dataset.compRow), hit: ${UB}.querySelector('[data-comp-hit]').textContent.trim(), reuse: ${UB}.querySelector('[data-comp-reuse]').textContent.trim() })`));
check(comp.rows.join(",") === "cacheRead,cacheWrite,output,input" && comp.hit === "84%" && comp.reuse === "8회", `토큰 구성 · 히트율 · 재사용 (${JSON.stringify(comp)})`);
const tbl = JSON.parse(await ev(`JSON.stringify([...${UB}.querySelectorAll('[data-model-row]')].map(r => [...r.querySelectorAll('td')].map(td => td.textContent.trim())))`));
console.log("table:", JSON.stringify(tbl));
check(tbl.length === 3 && tbl[0][0] === "opus-5" && tbl[0][4] === "3" && /%$/.test(tbl[0][2]), `모델 표 — 짧은 이름 · 몫 · 대화 (${JSON.stringify(tbl[0])})`);
check((await ev(`/\\$|USD|₩|비용|cost/i.test(${UB}.textContent)`)) === false, "요금은 어디에도 없다");
check(/^Claude Code 는 대화 기록을 기본 30일 뒤 지웁니다/.test(await ev(`${UB}.querySelector('[data-usage-retention]')?.textContent.trim() ?? ''`)), "보존 기간 각주(Claude 기록이 있을 때 — 문구는 8b02136)");
const sw = JSON.parse(await ev(`JSON.stringify([...${UB}.querySelectorAll('[data-model-row] .sw')].map(e => getComputedStyle(e).backgroundColor))`));
check(new Set(sw).size === sw.length, `모델 빛깔이 서로 다르다 — 같은 에이전트의 opus-5 · haiku-5 도 (${sw.join(" / ")})`);
const legendSw = await ev(`[...${UB}.querySelectorAll('[data-usage-week] .legend .sw')].map(e => getComputedStyle(e).backgroundColor).join('|')`);
const tableSw = await ev(`[...${UB}.querySelectorAll('[data-model-row] .sw')].map(e => getComputedStyle(e).backgroundColor).join('|')`);
check(legendSw === tableSw, "같은 모델은 7일 막대와 표에서 같은 빛깔");
const accentHere = await ev(`(() => { const p = document.createElement('span'); p.style.color = 'var(--accent)'; document.body.appendChild(p); const v = getComputedStyle(p).color; p.remove(); return [...${UB}.querySelectorAll('*')].some(e => !e.matches('.fill') && (getComputedStyle(e).backgroundColor === v || getComputedStyle(e).color === v)); })()`);
check(accentHere === false, "사용량 칸에 강조색이 없다(게이지 채움 primary 말고 — 10-18 MD3)");
console.log("capture:", await shot("usage-section.png"));
// 실제 창 폭(≈1900px)에서 두 칸 줄의 키가 비슷한가
await ev(`${UB}.querySelector('[data-heat-date="${today}"]').click()`); await sleep(200); // 고른 날 = 오늘(기록이 있는 날)
await send("Emulation.setDeviceMetricsOverride", { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }); await sleep(600);
const pairs = JSON.parse(await ev(`JSON.stringify([...${UB}.querySelectorAll('.pair')].map(p => [...p.children].map(c => Math.round(c.getBoundingClientRect().height))))`));
const naturals = JSON.parse(await ev(`JSON.stringify([...${UB}.querySelectorAll('.pair')].map(p => [...p.children].map(c => { const s = c.style.alignSelf; c.style.alignSelf = 'start'; const h = Math.round(c.getBoundingClientRect().height); c.style.alignSelf = s; return h; })))`));
console.log("pairs@1920:", JSON.stringify(pairs), "natural:", JSON.stringify(naturals));
check(pairs.every(([a, b]) => a === b) && naturals.every(([a, b]) => Math.max(a, b) / Math.min(a, b) < 1.5), `1920px — 두 칸 줄의 제 키가 비슷하다 (${JSON.stringify(naturals)})`);
await ev(`${UB}.scrollIntoView({ block: 'start' })`); await sleep(200);
console.log("capture:", await shot("usage-section-1920.png"));
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(500);

// 기간 7일 — 잔디는 그대로 다섯 주 · 연속 글자 · 기억
await ev(`${UB}.querySelector('[data-usage-period="7"]').click()`); await sleep(500);
const heat7 = await ev(`${UB}.querySelectorAll('[data-usage-heat] [data-heat-date], [data-usage-heat] [data-heat-pre]').length`);
check(JSON.parse(await ev(`JSON.stringify(window.__summaryCalls.at(-1))`)).days === 7 && heat7 === heatN, `7일이어도 잔디는 다섯 주 그대로 (${heat7})`);
check((await ev(`${UB}.querySelector('[data-cell="streak"] .sub').textContent.trim()`)) === "최근 7일 안에서", "연속 글자가 기간을 따른다");
check((await ev(`localStorage.getItem('aynx.usage.filter')`)) === JSON.stringify({ agent: null, period: 7 }), "거르개를 기억한다");
await ev(`${UB}.querySelector('[data-usage-agent="codex"]').click()`); await sleep(500);
const cxf = JSON.parse(await ev(`JSON.stringify({ call: window.__summaryCalls.at(-1), rows: [...${UB}.querySelectorAll('[data-model-row]')].map(r => r.dataset.agent) })`));
check(cxf.call.agent === "codex" && cxf.rows.join(",") === "codex", `에이전트 거르개 → 아래 전부 (${JSON.stringify(cxf)})`);
await ev(`${UB}.querySelector('[data-usage-agent="all"]').click()`); await sleep(200);
await ev(`${UB}.querySelector('[data-usage-period="30"]').click()`); await sleep(300);
await key("Escape"); await sleep(400); // 사용량 화면 닫기
check((await usageOpen()) === false && (await ev(`document.activeElement?.classList.contains('xterm-helper-textarea') ?? false`)) === true, "팔레트로 연 사용량 화면을 Escape 로 닫으면 키보드는 타일(열기 전 포커스)로");

// ── ⑩ 페이지가 다시 떠도 — 연결의 수명 = 세션 (docs/log/2026-09-26-agent-sessions.md) ─────────────
// 다시 뜬 페이지는 이 창의 세션을 모두 거두고(`reap_window_sessions`) 타일마다 새 셸을 연다. ⑧ 에서 재개로 연 타일은
// autorun(`claude --resume <id>`)을 다시 돌려 같은 대화를 다시 열므로 **첫 훅 신호 전에도** "열림" 이어야 한다
// (팔레트 줄의 꼬리 — 대시보드의 줄은 4dda594 에 빠졌다).
await sleep(1200); // 배치 저장(500ms 모음)
const savedWs = await ev(`sessionStorage.getItem('h.ws') ?? ''`);
check(savedWs.includes(`claude --resume ${SCRATCH}`), "준비: 재개 타일이 배치에 저장됐다");
await ev(`sessionStorage.setItem('h.reload', '1')`);
counting = false;
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
counting = true;
const calls = JSON.parse(await ev(`JSON.stringify(window.__calls.map(c => c[0]).filter(c => c === 'reap_window_sessions' || c === 'open_local_session'))`));
check(calls[0] === "reap_window_sessions" && calls.includes("open_local_session"), `다시 뜬 페이지 = 먼저 거두고 새 셸을 연다 (${calls.slice(0, 3).join(",")}…)`);
const reWrote = await ev(`window.__calls.filter(c => c[0] === 'write_session').some(c => JSON.stringify(c[1]).includes('--resume ${SCRATCH}'))`);
check(reWrote === true, "복원된 재개 타일이 autorun 을 다시 돌린다");
await key("KeyP", CTRL | SHIFT, "P"); await sleep(500);
await send("Input.insertText", { text: "대화 scratch" }); await sleep(600);
const afterReload = await ev(`${P}?.querySelector('[data-row] .tail')?.textContent.trim() ?? null`);
check(typeof afterReload === "string" && afterReload.endsWith("열림"), `다시 뜬 뒤 — 재개 타일의 대화는 첫 신호 전에도 "열림" (${afterReload})`);
await key("Escape");
await ev(`sessionStorage.clear()`);

await sleep(300);
check(errors.length === 0, `콘솔 예외 0 (${errors.join(" / ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
