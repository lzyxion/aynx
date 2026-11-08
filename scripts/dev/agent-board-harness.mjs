// Headless harness: **대시보드 에이전트 칸** (docs/log/2026-09-25-agent-board.md).
// 스텁은 `launcher-harness.mjs`(프로젝트 · 셸 · 이벤트 버스) + `dashboard-harness.mjs`(`list_operations` ·
// 대시보드 폴링 칸)의 합본이다.
//
//   npx vite --port 1434 --strictPort        (다른 작업이 파일을 고치는 중이면 README ui-scale 절의 no-HMR 설정)
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-agents \
//     --window-size=1200,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/agent-board-harness.mjs outdir 9250
//
// 심어 두는 것: 프로젝트 셋(로컬 aynx · 원격 api@dev-01 · 로컬 infra — 셋 다 claude) · 작업안 하나
// (대상 = api 타일의 스트림 · 12분 뒤 만료).
// 타일 넷: aynx(주 폴더 — 신호 없음 = 미상) · aynx · feat-y(워크트리 탭 — 훅 start → stop = 입력 대기) ·
// api@dev-01(훅 start = 실행 중, 턴 시작) · infra(출력 → 세션 종료 = 끝남).
//
// 보는 것: ① 빈 창 — Ctrl+Shift+M 이 **에이전트 칸**으로 연다 · 칸 넷(에이전트 · 세션 · 작업안 · 사용량) ·
// "기다리는 것이 없습니다" 한 줄 · 빈 상태의 [프로젝트 열기] → 통합 독의 프로젝트 칸 ② 타일을 채운 뒤
// 나를 기다리는 것 = 입력 대기 에이전트 → 승인 대기(대상 이름 · 만료) ③ 카드 = 대기 · 실행 · 미상 · 끝남
// 순서와 알약 · 시각 ④ 승인·거절 단추가 **없다** · 강조색은 입력 대기 점·알약과 주 동작 하나뿐 ·
// 검토 카드는 이 칸에서 물러난다 ⑤ 키보드 — 카드 ←→↑↓ · Enter = 그 타일로(대시보드가 걷힌다) ·
// 줄 ↑↓ ⑥ [검토] → 작업안 칸의 그 작업안 ⑦ [타일로 가기] · 카드 클릭 → focusTile + 걷힘 · 예외 0.
// PNG: agents-board.png · agents-board-empty.png · agents-board-light.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
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
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
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
  window.__ops = { pending: [], recent: [] };
  const HOSTS = [{ name: 'dev-01', host_name: '10.0.0.2', user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } }];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const PROJECTS = [
    { id: 'P1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: 'claude', tmux: false },
    { id: 'P2', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: 'claude', tmux: false },
    { id: 'P3', name: 'infra', host: null, path: 'C:\\\\src\\\\infra', shell: null, command: 'claude', tmux: false },
  ];
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
     load_snippets: null, 
     save_snippets: null, 
    // 로컬 프로젝트를 열면 이제 늘 시작 화면이 선다(2026-09-27 — docs/log/2026-09-27-folder-conversations.md). 이 판은 열린
    // 에이전트 타일을 보므로 예전처럼 곧장 열게 끈다.
    load_settings: { projects: { start_screen: 'off' } }, save_settings: null,
    host_history_list: {},
    projects_list: PROJECTS,
    git_worktree_list: [], ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12, close_ssh: null,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_lock: null,
    mcp_status: { clis: [] }, mcp_activity: null, list_forwards: [], session_log_path: null,
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    // 지난 대화는 비워 둔다 — 그 덩어리는 convo-harness.mjs 가 본다 (이 글자는 템플릿 문자열 안이라 역따옴표 금지)
    agent_sessions_list: { groups: [], others: [], othersMore: false },
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++, tmux: null });
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
counting = true;

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && k === "Enter" ? { text: String.fromCharCode(13) } : {}) }); await sleep(250); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const projMod = importApp("app/projects.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");
const agentMod = importApp("app/agent-status.svelte.ts");
const dockMod = importApp("app/dock.svelte.ts");
const B = `document.querySelector('[data-agent-board]')`;
const dashOpen = () => ev(`document.querySelector('.console')?.hidden === false`);
const section = () => ev(`document.querySelector('.console')?.dataset.section ?? null`);
const toggle = async () => { await key("KeyM", 10, "M"); await sleep(500); };

// ── ① 빈 창 ─────────────────────────────────────────────────────────────────
await toggle();
check((await dashOpen()) === true, "Ctrl+Shift+M → 대시보드");
check((await section()) === "agents", `새 창의 기본 칸 = 에이전트 (${await section()})`);
const segs = await ev(`[...document.querySelectorAll('.console .section-seg .seg-btn')].map(b => b.textContent.trim().replace(/\\d+$/, '')).join('|')`);
check(segs === "에이전트|세션|작업안|사용량", `칸 넷(사용량 — fc703bd), 에이전트가 첫 칸 (${segs})`);
check((await ev(`!!${B}?.querySelector('[data-waiting-none]')`)) === true, "기다리는 것이 없으면 조용한 한 줄");
check((await ev(`!!${B}?.querySelector('[data-agents-empty]')`)) === true, "에이전트 타일이 없으면 빈 상태 안내");
const titleFont = await ev(`(() => { const s = getComputedStyle(document.querySelector('.console .head .title')); return s.fontSize + '/' + s.fontWeight; })()`);
check(titleFont === "15px/600", `머리줄 제목 15/600 (${titleFont})`);
console.log("capture:", await shot("agents-board-empty.png"));
await ev(`${B}.querySelector('[data-open-projects]').click()`); await sleep(500);
check((await ev(`(async () => (await ${dockMod}).dockKind())()`)) === "projects", "빈 상태의 [프로젝트 열기] → 통합 독의 프로젝트 칸");
await key("Escape"); await sleep(300);
if (await ev(`(async () => (await ${dockMod}).dockKind())()`)) { await key("Escape"); await sleep(300); }
if (await dashOpen()) { await toggle(); }

// ── ② 타일 넷 + 작업안 하나 ────────────────────────────────────────────────
await ev(`(async () => { const m = await ${projMod}; const ps = m.projects(); const p = (id) => ps.find(x => x.id === id);
  await m.openProjectInNewTab(p('P1'));
  await m.openProjectWorktree(p('P1'), { path: 'C:\\\\src\\\\proj-wt\\\\feat-y', branch: 'feat-y', head: 'b2', bare: false, detached: false });
  await m.openProjectInNewTab(p('P2'));
  await m.openProjectInNewTab(p('P3'));
})()`);
await sleep(2500);
const panes = JSON.parse(await ev(`(async () => { const m = await ${tabsMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); const o = {};
  for (const tab of m.residentWindowTabs()) for (const p of walk(tab.root, [])) { const k = p.cwd === 'C:\\\\src\\\\proj' ? 'main' : p.cwd === 'C:\\\\src\\\\proj-wt\\\\feat-y' ? 'feat' : p.cwd === '~/api' ? 'api' : p.cwd === 'C:\\\\src\\\\infra' ? 'infra' : null; if (k) o[k] = { tab: tab.id, pane: p.id, stream: p.historyStreamId ?? p.id }; }
  return JSON.stringify(o); })()`));
console.log("tiles:", JSON.stringify(panes));
check(["main", "feat", "api", "infra"].every((k) => panes[k]), "준비: 타일 넷");
const isAgent = (k) => ev(`(async () => { const a = await ${agentMod}; const w = await ${tabsMod}; return a.isAgentPane(w.findPaneAnywhere('${panes[k]?.pane}')); })()`);
for (let i = 0; i < 20; i++) {
  const all = await Promise.all(["main", "feat", "api", "infra"].map(isAgent));
  if (all.every((x) => x === true)) break;
  await sleep(500);
}
check((await Promise.all(["main", "feat", "api", "infra"].map(isAgent))).every((x) => x === true), "네 타일 모두 AI 타일로 읽힌다");
const signal = (k, event) => ev(fakeAgentSignal(`{ stream: '${panes[k].stream}', event: '${event}', detail: null, at: Date.now() }`));
const report = (k, fn) => ev(`(async () => { const a = await ${agentMod}; const w = await ${tabsMod}; a.${fn}(w.findPaneAnywhere('${panes[k].pane}')); })()`);
await signal("feat", "start"); await sleep(100); await signal("feat", "stop");
await signal("api", "start");
await report("infra", "agentOutput"); await report("infra", "agentExit");
const NOW = Date.now();
await ev(`window.__ops = { pending: [${JSON.stringify({
  operationId: "op-1", command: "systemctl reload nginx", targets: [panes.api.stream, "zz-unknown"], cwd: null, validate: null,
  mode: "exec", strategy: "sequential", concurrency: 1, timeoutSeconds: 60, state: "awaitingApproval",
  createdAt: NOW, requestedAt: NOW, expiresAt: NOW + 12 * 60_000, title: null, reason: null, idempotencyKey: null,
})}], recent: [] }`);
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(1200);

await toggle();
check((await section()) === "agents", `토글은 마지막 칸(에이전트)으로 다시 연다 (${await section()})`);
await sleep(600);
const rows = JSON.parse(await ev(`JSON.stringify([...${B}.querySelectorAll('.rows > li')].map(li => ({ kind: li.dataset.waitingKind, l1: li.querySelector('.line1')?.textContent.replace(/\\s+/g, ' ').trim(), l2: li.querySelector('.line2')?.textContent.trim() ?? null, btn: li.querySelector('button')?.textContent.trim(), primary: li.querySelector('button')?.classList.contains('btn-primary') })))`));
console.log("waiting:", JSON.stringify(rows));
check(rows.map((r) => r.kind).join("|") === "agent|approval", "나를 기다리는 것 = 입력 대기 에이전트 → 승인 대기");
check(rows[0]?.l1 === "aynx · feat-y — 입력을 기다립니다", `에이전트 줄 (${rows[0]?.l1})`);
check(rows[0]?.btn === "타일로 가기" && rows[0]?.primary === false, "에이전트 줄의 단추 = [타일로 가기] 보조");
check(rows[1]?.l1 === "승인 대기 — systemctl reload nginx", `승인 줄 (${rows[1]?.l1})`);
check(rows[1]?.l2 === "대상 2 · dev-01 · 만료까지 12분", `승인 줄 둘째 줄 — 모르는 대상은 수로만 (${rows[1]?.l2})`);
check(rows[1]?.btn === "검토" && rows[1]?.primary === true, "승인 줄의 단추 = [검토] 주 동작");
const heading = await ev(`${B}.querySelector('#agents-waiting-h')?.textContent.replace(/\\s+/g, '')`);
check(heading === "나를기다리는것2", `제목 + 수 (${heading})`);

// ── ③ 카드 ──────────────────────────────────────────────────────────────────
const cards = JSON.parse(await ev(`JSON.stringify([...${B}.querySelectorAll('[data-agent-card]')].map(c => ({ st: c.dataset.status, pane: c.dataset.pane, title: c.querySelector('.c-title').textContent.trim(), sub: c.querySelector('.c-sub')?.textContent.trim() ?? null, where: c.querySelector('.c-where').textContent.trim(), pill: c.querySelector('.pill').textContent.trim(), time: c.querySelector('.c-time').textContent.trim(), mono: getComputedStyle(c.querySelector('.c-sub') ?? c).fontFamily })))`));
console.log("cards:", JSON.stringify(cards.map(({ mono, ...c }) => c)));
check(cards.map((c) => c.st).join("|") === "waiting|running|unknown|done", `카드 순서 = 대기 · 실행 · 미상 · 끝남 (${cards.map((c) => c.st).join("|")})`);
check(JSON.stringify(cards.map((c) => [c.title, c.sub, c.where])) === JSON.stringify([["aynx", "feat-y", "로컬"], ["api", null, "dev-01"], ["aynx", null, "로컬"], ["infra", null, "로컬"]]), "카드 글자 = 프로젝트 · 워크트리 · 위치");
check(cards.map((c) => c.pill).join("|") === "입력 대기|실행 중|미상|끝남", "알약 글자");
check(cards[0].time === "마지막 턴 방금" && cards[1].time === "방금 시작" && cards[2].time === "" && cards[3].time === "방금", `시각 (${cards.map((c) => c.time).join("|")})`);
check(/mono|Consolas|Cascadia|monospace/i.test(cards[0].mono), `워크트리 줄은 고정폭 (${cards[0].mono})`);
const cols = await ev(`getComputedStyle(${B}.querySelector('.grid')).gridTemplateColumns.split(' ').length`);
check(cols === 3, `1200px 창에서 카드 세 열 (${cols})`);

// ── ④ 승인 없음 · 강조색 · 검토 카드 ─────────────────────────────────────────
const btnTexts = await ev(`[...${B}.querySelectorAll('button')].filter(b => !b.hasAttribute('data-agent-card') && !b.closest('[data-convo]')).map(b => b.textContent.trim()).join('|')`);
check(btnTexts === "타일로 가기|검토", `에이전트 칸의 단추는 [타일로 가기] · [검토] 뿐 — 승인·거절이 없다 (${btnTexts})`);
check((await ev(`!!${B}.querySelector('.approve, [data-approve], .reject')`)) === false, "승인/거절 컨트롤 없음");
const accentUse = await ev(`(() => {
  const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; document.querySelector('.console').appendChild(probe);
  const acc = getComputedStyle(probe).color; probe.remove();
  const out = [];
  for (const el of document.querySelectorAll('.console .head *, [data-agent-board] *')) {
    const s = getComputedStyle(el);
    if (s.color === acc || s.backgroundColor === acc || s.borderTopColor === acc && s.borderTopWidth !== '0px' && s.borderTopStyle !== 'none') out.push(el.className.replace(/\\b(svelte|s)-[\\w-]+/g, '').trim()); // 스코프 해시 — 판마다 svelte-… 또는 s-…
  }
  return out.join(',');
})()`);
console.log("accent:", accentUse);
check(String(accentUse).split(",").every((c) => /^dot waiting$|^pill waiting$|btn-primary/.test(c)) && /btn-primary/.test(accentUse) && /pill waiting/.test(accentUse), `강조색은 입력 대기 점·알약 + 주 동작 하나뿐 (${accentUse})`);
check((await ev(`[...${B}.querySelectorAll('.btn-primary')].length`)) === 1, "주 동작 버튼은 하나");
check((await ev(`document.querySelectorAll('.rcard').length`)) === 0, "에이전트 칸에서는 검토 카드가 물러난다");
console.log("capture:", await shot("agents-board.png"));
const modeMod = importApp("mode.svelte.ts");
await ev(`(async () => { const m = await ${modeMod}; m.setAppMode('light'); })()`); await sleep(500);
console.log("capture:", await shot("agents-board-light.png"));
await ev(`(async () => { const m = await ${modeMod}; m.setAppMode('dark'); })()`); await sleep(300);

// ── ⑤ 키보드 ────────────────────────────────────────────────────────────────
const activeCard = () => ev(`document.activeElement?.dataset?.pane ?? ('<' + document.activeElement?.tagName + '>')`);
await ev(`${B}.querySelector('[data-agent-card]').focus()`);
await key("ArrowRight"); check((await activeCard()) === cards[1].pane, "→ 다음 카드");
await key("ArrowLeft"); check((await activeCard()) === cards[0].pane, "← 앞 카드");
await key("ArrowDown"); check((await activeCard()) === cards[3].pane, "↓ 한 열 아래 (세 열 — 넷째 카드)");
await key("ArrowUp"); check((await activeCard()) === cards[0].pane, "↑ 한 열 위");
await key("ArrowLeft"); check((await activeCard()) === cards[0].pane, "첫 카드에서 ← 는 멈춘다");
await ev(`${B}.querySelector('[data-row-act]').focus()`);
await key("ArrowDown"); check((await ev(`document.activeElement?.dataset?.review ?? null`)) === "op-1", "줄 ↓ → 다음 줄의 단추");
await key("ArrowUp"); check((await ev(`document.activeElement?.textContent?.trim()`)) === "타일로 가기", "줄 ↑ → 앞 줄의 단추");
// Enter on the running card → that tile, dashboard closes
await ev(`[...${B}.querySelectorAll('[data-agent-card]')][1].focus()`);
await key("Enter"); await sleep(400);
const where = () => ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return t ? t.id + '/' + w.paneOf(t) : null; })()`);
check((await dashOpen()) === false && (await where()) === `${panes.api.tab}/${panes.api.pane}`, `Enter → 그 타일로 · 대시보드가 걷힌다 (${await where()})`);

// ── ⑥ [검토] → 작업안 칸의 그 작업안 ────────────────────────────────────────
await toggle();
check((await section()) === "agents", "다시 열면 에이전트 칸");
await ev(`${B}.querySelector('[data-review="op-1"]').click()`); await sleep(2600);
check((await dashOpen()) === true && (await section()) === "operations", `[검토] → 작업안 칸 (${await section()})`);
check((await ev(`document.querySelectorAll('.console [data-operation-id="op-1"]').length`)) === 1, "그 작업안이 작업안 칸에 있다");
await ev(`document.querySelector('.console [data-section-btn="agents"]').click()`); await sleep(400);
check((await section()) === "agents", "칸 단추로 에이전트 칸에 돌아온다");

// ── ⑦ 줄의 [타일로 가기] · 카드 클릭 ────────────────────────────────────────
await ev(`${B}.querySelector('.rows [data-row-act]').click()`); await sleep(400);
check((await dashOpen()) === false && (await where()) === `${panes.feat.tab}/${panes.feat.pane}`, `[타일로 가기] → 입력 대기 타일 · 걷힘 (${await where()})`);
await toggle();
await ev(`[...${B}.querySelectorAll('[data-agent-card]')].find(c => c.dataset.pane === '${panes.infra.pane}').click()`); await sleep(400);
check((await dashOpen()) === false && (await where()) === `${panes.infra.tab}/${panes.infra.pane}`, `카드 클릭 → 그 타일 · 걷힘 (${await where()})`);

await sleep(300);
check(errors.length === 0, `콘솔 예외 0 (${errors.join(" / ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
