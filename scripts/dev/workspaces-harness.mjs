// 메인 창 전환/전역 프로젝트 위치/워크스페이스 편집·끌기 하네스. 외부 오케스트레이터가 준비한 CDP 페이지에만 붙는다.
// PAGE_PORT=1434 node scripts/dev/workspaces-harness.mjs outdir 9250
import { reloadBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9224";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1420";
const tgt = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(tgt.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
let failed = 0;
// `ev` 는 페이지 예외를 "EXC …" 글자로 돌려준다 — 참으로 읽혀 PASS 로 셌다(없어진 요소를 찾는 단언이 조용히 통과했다, 2026-10-27).
const check = (ok, label) => { if (typeof ok === "string" && ok.startsWith("EXC ")) { console.log(`  (${ok})`); ok = false; } if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
await send("Page.enable"); await send("Runtime.enable");
const errors = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"); });

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  // 앱 모듈을 URL 로 다시 찾는다(importApp) — 기본 버퍼(250)는 모듈 수보다 작아 뒤에 올린 모듈이 빠진다.
  performance.setResourceTimingBufferSize(5000);
  try { localStorage.removeItem('aynx:favorites'); } catch {}
  const host = (name, ip) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } });
  const HOSTS = [host('web-01', '10.0.0.1'), host('web-02', '10.0.0.2'), host('dev-01', '10.0.0.3'), host('db-02', '10.0.0.4')];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const NOW = Date.now();
  const ok = (ago, count) => ({ last_ok_at: NOW - ago, last_fail_at: null, last_fail_cause: null, last_fail_message: null, count });
  const HISTORY = { 'web-01': ok(2 * 60e3, 12), 'dev-01': ok(60 * 60e3, 4) };
  const PROJECTS = [
    { id: 'P1', name: 'web-frontend', host: null, path: 'C:\\\\src\\\\web-frontend', shell: null, command: '', tmux: false },
    { id: 'P2', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: '', tmux: false },
  ];
  let generation = 0;
  const savedTab = (key, tile) => ({ projectId: key === 'TA' ? 'P1' : 'P2', tabKey: key, placement: { kind: 'main' }, title: key, root: key === 'TB' ? { kind: 'ssh', alias: 'dev-01', cwd: '~/api', tileKey: tile } : { kind: 'local', shell: 'pwsh', tileKey: tile } });
  const WS_FILE = { kind: 'aynx.workspaces', version: 2, revision: 1, activeWorkspaceId: 'A', workspaces: [
    { id: 'A', name: 'Alpha', color: '#8888ee', tabs: [savedTab('TA', 'PA')], lastActive: { tabKey: 'TA', tileKey: 'PA' } },
    { id: 'B', name: 'Beta', tabs: [{ ...savedTab('TB', 'PB'), placement: { kind: 'aux', groupId: 'stale-crash-group' } }], lastActive: { tabKey: 'TB', tileKey: 'PB' } },
  ] };
  if (sessionStorage.getItem('ws-fresh')) { WS_FILE.activeWorkspaceId = 'A'; WS_FILE.workspaces = [{ id: 'A', name: '기본', tabs: [], lastActive: {} }]; }
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
     load_snippets: null, 
     save_snippets: null, 
    // 로컬 프로젝트를 열면 이제 늘 시작 화면이 선다(2026-09-27 — docs/log/2026-09-27-folder-conversations.md). 이 판은 여는
    // 길(셸 · 명세 · 점)을 보므로 예전처럼 곧장 열게 끈다 — 시작 화면은 project-start · folder-convos 판이 본다.
    load_settings: { projects: { start_screen: 'off' }, app: { status_bar: 'left' } }, save_settings: null,
    host_history_list: HISTORY,
    projects_list: PROJECTS,
    git_worktree_list: [{ path: PROJECTS[0].path, branch: 'main', head: 'abc', bare: false, detached: false }, { path: PROJECTS[0].path + '-wt/feature', branch: 'feature', head: 'def', bare: false, detached: false }], ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [],
    mcp_status: { clis: [] }, session_logs_dir: 'C:\\\\logs',
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      if (cmd === 'workspaces_load') {
        window.__calls.push([cmd, args]);
        return Promise.resolve(sessionStorage.getItem('ws-failure') ? { state: 'needsMigration' } : { state: 'v2', file: structuredClone(WS_FILE) });
      }
      if (cmd === 'workspaces_migrate') { window.__calls.push([cmd, args]); return Promise.reject({ code: 'invalid', problems: [{ file: 'layouts.json', index: 2, path: 'private.cwd', code: 'invalidField' }] }); }
      if (cmd === 'workspaces_start_fresh') {
        sessionStorage.setItem('ws-backed-up', '1'); sessionStorage.removeItem('ws-failure'); sessionStorage.setItem('ws-fresh', '1');
        return Promise.resolve(null);
      }
      if (cmd === 'workspace_windows') return Promise.resolve(['main']);
      if (cmd === 'workspace_bind_window' || cmd === 'focus_window') { window.__calls.push([cmd, args]); return Promise.resolve(null); }
      if (cmd === 'workspace_window_binding') return Promise.resolve(null);
      if (cmd === 'workspaces_claim_writer') return Promise.resolve(++generation);
      if (cmd === 'workspaces_apply') {
        window.__calls.push([cmd, args]);
        // 실제 IPC처럼 JSON 사본으로 받아 반응형 프록시가 파일에 남지 않게 한다.
        const m = JSON.parse(JSON.stringify(args.mutation));
        const w = WS_FILE.workspaces.find(w => w.id === (m.workspaceId ?? m.id));
        if (m.op === 'returnAuxTabsToMain') { for (const w of WS_FILE.workspaces) for (const tab of w.tabs) tab.placement = { kind: 'main' }; }
        else if (m.op === 'putTabs') { w.tabs = w.tabs.filter(t => JSON.stringify(t.placement) !== JSON.stringify(m.scope)).concat(m.tabs); w.lastActive = m.lastActive ?? {}; }
        else if (m.op === 'createWorkspace') WS_FILE.workspaces.push({ id: m.id, name: m.name, lastActive: {}, tabs: [] });
        else if (m.op === 'renameWorkspace') w.name = m.name;
        else if (m.op === 'setWorkspaceStyle') { w.icon = m.icon; w.color = m.color; }
        else if (m.op === 'reorderWorkspaces') WS_FILE.workspaces = m.ids.map(id => WS_FILE.workspaces.find(w => w.id === id));
        else if (m.op === 'setActiveWorkspace') WS_FILE.activeWorkspaceId = m.id;
        else if (m.op === 'deleteWorkspace') {
          if (WS_FILE.workspaces.length === 1) return Promise.reject({ code: 'invalid' });
          WS_FILE.workspaces = WS_FILE.workspaces.filter(w => w.id !== m.id);
        }
        return Promise.resolve(++WS_FILE.revision);
      }
      if (cmd === 'plugin:dialog|message') return Promise.resolve('Yes');
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') { window.__listeners[args.event] = (window.__listeners[args.event] ?? []).filter(id => id !== args.eventId); return Promise.resolve(null); }
      if (cmd === 'plugin:event|emit' || cmd === 'plugin:event|emit_to') {
        if (!args.target || args.target.label === 'main') window.__emitWorkspaceTest(args.event, args.payload);
        return Promise.resolve(null);
      }
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++, tmux: null });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__emitWorkspaceTest = (event, payload) => { for (const id of window.__listeners[event] ?? []) cbs.get(id)?.({ event, id, payload }); };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await reloadBoot(send, ev);


const key = async (code, modifiers = 0, k = code) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : ({ Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, F2: 113 }[code] ?? 0);
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};
const importApp = (file) => "(async () => { const u = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('" + file + "')); if (!u) throw new Error('module missing'); return import(u); })()";
const tabsMod = importApp("app/tabs.svelte.ts");
const wsMod = importApp("app/workspaces.svelte.ts");
const actionsMod = importApp("app/workspace-actions.svelte.ts");
const choose = async (id) => { await ev("(async () => (await " + wsMod + ").switchWorkspace('" + id + "'))()"); await sleep(200); };
const count = () => ev("(async () => (await " + wsMod + ").workspaceList().length)()");

// 부팅(워크스페이스 읽기 · materialize)이 4.5초 안에 다 끝나지 않는 판이 있다(캐시 무시 새로고침 뒤 vite 변환) —
// 목록이 설 때까지 최대 15초 기다린다. 끝내 안 서면 아래 부팅 단언이 그대로 FAIL 한다.
for (let i = 0; i < 30; i += 1) {
  if (await ev("(async () => { try { return (await " + wsMod + ").workspaceList().length > 0 && (await " + tabsMod + ").residentWindowTabs().length > 0 && !!document.querySelector('.statusbar'); } catch { return false; } })()") === true) break;
  await sleep(500);
}
await sleep(300);

// 상태바 위치는 settings 모델 setter로도 고정한다(파일 codec과 모델의 키 표기가 다를 수 있다).
await ev("(async () => { const m = await " + importApp("settings/model/store.svelte.ts") + "; m.settings.current.app.status_bar = 'left'; })()");
await sleep(200);
// 2026-11-21: 워크스페이스 목록은 상태바 띠에서 **탭 줄 맨 앞의 단추 + 목록**으로 옮겨 갔다(2026-10-07 자리마다 할 일 나누기 ·
// 2026-10-13 줄 우클릭 메뉴 · 끌기도 이 목록으로 — `Tabs.svelte` · `tabbar/WorkspacePicker.svelte`). 옛 상태바 띠(`.workspace-strip` ·
// `[data-workspace-dot]` · 채움 판 `.workspace-indicator` · `[data-workspace-current]`)를 보던 판정은 이 목록으로 옮겼다.
const pickerOpen = () => ev("!!document.querySelector('[data-workspace-menu]')");
const openPicker = async () => { if ((await pickerOpen()) !== true) { await ev("document.querySelector('[data-workspace-button]').click()"); await sleep(200); } };
const closePicker = async () => { if ((await pickerOpen()) === true) { await ev("document.querySelector('[data-workspace-button]').click()"); await sleep(150); } };
const rowSel = (id) => "[data-workspace-menu] [data-workspace-option=\"" + id + "\"]";
await openPicker();
check(await ev("(() => { const b = document.querySelector('[data-workspace-button]'), m = document.querySelector('[data-workspace-menu]'); return !!b && b.parentElement.matches('.tabs') && b.parentElement.firstElementChild === b && m.querySelectorAll('.ws-scroll [data-workspace-option]').length === 2 && !!m.querySelector('[data-workspace-new]'); })()") === true, "탭 줄 맨 앞 워크스페이스 단추 → 목록(스크롤 안의 줄 · 새 워크스페이스)");
await closePicker();
check(await count() === 2, "v2 workspace 두 개를 읽는다");
check(await ev("window.__calls.findIndex(([c,a]) => c === 'workspaces_apply' && a.mutation.op === 'returnAuxTabsToMain') >= 0") === true, "부팅 materialize 전에 stale aux를 main으로 돌린다");
check(await ev("(async () => (await " + tabsMod + ").residentWindowTabs().length)()") === 1, "활성 workspace만 materialize");
await ev("window.__paneA = document.querySelector('.pane-box');");
await choose("B");
await ev("window.__paneB = [...document.querySelectorAll('.pane-box')].find(p => p !== window.__paneA);");
for (let i = 0; i < 4; i++) { await choose("A"); await choose("B"); }
check(await ev("document.querySelector('[data-pane=\"' + window.__paneA.dataset.pane + '\"]') === window.__paneA && document.querySelector('[data-pane=\"' + window.__paneB.dataset.pane + '\"]') === window.__paneB") === true, "반복 전환 후 pane DOM 객체 동일");
check(await ev("window.__paneA.classList.contains('hidden') && !window.__paneB.classList.contains('hidden')") === true, "resident A는 숨기고 B를 표시");

// 현재 소속만 독에서 표시/사전 로드한다. 다른 소속 projectById는 계속 살아 있다.
const projectsMod = importApp("app/project-list.svelte.ts");
await ev("(async () => (await " + importApp("app/dock.svelte.ts") + ").openDock('projects'))()");
await sleep(150);
check(await ev("!!document.querySelector('[data-row-key=\"P2\"]') && !!document.querySelector('[data-row-key=\"P1\"]')") === true, "다른 workspace 프로젝트도 B 독에 표시");
check(await ev("(async () => (await " + projectsMod + ").projectById('P1')?.id)()") === "P1", "프로젝트는 전역 조회");
await ev("const input = document.querySelector('[data-project-dock] input.search'); input.value = 'api'; input.dispatchEvent(new Event('input', { bubbles: true }));");
await sleep(150);
check(await ev("window.__calls.some(([c,a]) => c === 'git_worktree_list' && a.repo.includes('web-frontend'))") === true, "B 검색에서도 전역 프로젝트 워크트리 사전 로드");
await ev("document.querySelector('[data-project-dock] input.search').value = ''; document.querySelector('[data-project-dock] input.search').dispatchEvent(new Event('input', { bubbles: true }));");
await choose("A");
check(await ev("!!document.querySelector('[data-row-key=\"P1\"]') && !!document.querySelector('[data-row-key=\"P2\"]')") === true, "모든 프로젝트를 A 독에 표시");
await ev("(async () => { const p = (await " + projectsMod + ").projectById('P1'); await (await " + importApp("app/projects.svelte.ts") + ").openProjectInNewTab(p); })()");
await sleep(700);
check(await ev("(async () => (await " + tabsMod + ").activeTab().projectId === 'P1')()") === true, "새 프로젝트 탭에 명시적 projectId 기록");
check(await ev("window.__calls.some(([c,a]) => c === 'workspaces_apply' && a.mutation.op === 'putTabs' && a.mutation.tabs.some(t => t.projectId === 'P1' && t.pinnedTitle === 'web-frontend'))") === true, "SavedWorkspaceTab에도 새 프로젝트 ID 저장");
// 다른 workspace의 실제 위치 표식과 메뉴 reveal. 열린 탭을 소속으로 추정하지 않는다.
check(await ev("document.querySelector('[data-row-key=\"P2\"] [data-project-open-elsewhere]')?.textContent.includes('Beta')") === true, "다른 workspace 배지 Beta ↗");
await ev("document.querySelector('[data-row-key=\"P2\"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 80, clientY: 200 }));");
await sleep(100);
check(await ev("document.querySelector('[data-project-action=revealOpen]')?.textContent.includes('열린 곳으로 이동') || document.querySelector('[data-project-action=revealOpen]')?.textContent.includes('Go to open location')") === true, "열린 곳으로 이동 메뉴");
await ev("document.querySelector('[data-project-action=revealOpen]').click();");
await sleep(150);
check(await ev("(async () => (await " + wsMod + ").currentWorkspaceId() === 'B' && (await " + tabsMod + ").focusedPane()?.tileKey === 'PB')()") === true, "메뉴 reveal은 workspace와 기존 타일 선택");
await choose("A");
// 워크트리를 연 뒤 Enter로 같은 위치를 다시 열어도 탭이 늘지 않는다.
await ev("(async () => { const p = (await " + projectsMod + ").projectById('P1'); const m = await " + importApp("app/projects.svelte.ts") + "; const w = { path: p.path + '-wt/feature', branch: 'feature', head: null, bare: false, detached: false }; await m.openProjectWorktree(p, w); window.__existingWorktreeTab = (await " + tabsMod + ").activeTabId(); window.__existingWorktreeCount = (await " + tabsMod + ").currentWorkspaceTabs().length; await m.loadWorktrees(p); m.setProjectExpanded(p, true); })()");
await sleep(150);
await ev("(() => { const row = [...document.querySelectorAll('[data-worktree-row]')].find(row => row.dataset.worktreeRow.endsWith('-wt/feature')); row.click(); row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); })()");
await sleep(150);
check(await ev("(async () => { const m = await " + tabsMod + "; return m.activeTabId() === window.__existingWorktreeTab && m.currentWorkspaceTabs().length === window.__existingWorktreeCount; })()") === true, "Enter on already-open worktree focuses existing tab");
await choose("B");
await ev("(async () => (await " + importApp("app/dock.svelte.ts") + ").closeDock())()");

// 목록 줄의 배지(2026-10-07 — 옛 상태바 점 `[data-workspace-dot]` 의 자리): 그 워크스페이스 세션 카드의 가장 급한 상태(`sheetBadge` —
// 기다림 `input` > 실패 `fail` > 도는 중 `running`). 카드는 **세션이 있는** 타일만 센다 — B 의 SSH 타일은 스텁에서 붙지 않아(세션 없음 = 끊김)
// 실패를 못 싣는다. 그래서 A(지금 숨긴 워크스페이스)의 로컬 셸 탭에 실패를 적는다 — 숨긴 워크스페이스의 탭도 상주라 센다.
const badgeOf = async (id) => { await openPicker(); return ev("document.querySelector(" + JSON.stringify(rowSel(id)) + ")?.dataset.workspaceBadge ?? null"); };
await ev("(async () => { const m = await " + tabsMod + "; const tab = m.residentWindowTabs().find(t => t.workspaceId === 'A'); m.noteStatus(tab.id, m.paneOf(tab), 'fail'); })()");
check(await badgeOf("A") === "fail", "숨긴 workspace 탭의 실패도 목록 줄 배지에(fail)");
await closePicker();

// 진짜 창은 만들지 않고 aux 최소 상태/위치 이벤트만 주입한다. 배지는 보고의 타일(`tiles` — 에이전트 점 포함)에서 온다.
await ev("window.__emitWorkspaceTest('workspace-status', { label: 'tear-test', dots: { A: { source: 'agent', state: 'permission' } }, tiles: [{ workspaceId: 'A', streamId: 'aux-stream', tabId: 'tab-1', paneId: 'pane-1', status: 'running', connected: true, kind: 'local', agent: { kind: 'claude', status: 'permission' } }] });");
await sleep(100);
check(await badgeOf("A") === "input", "aux 권한 대기가 메인 실패보다 우선(input)");
await closePicker();
await ev("(async () => (await " + tabsMod + ").focusTile('tear-test:tab-1', 'tear-test:pane-1'))()");
await sleep(100);
check(await ev("window.__calls.some(([c,a]) => c === 'focus_window' && a.label === 'tear-test')") === true, "aux 타일 점프는 그 창을 focus");
check(await ev("(async () => (await " + wsMod + ").currentWorkspaceId())()") === "B", "aux 타일 점프는 메인 workspace를 바꾸지 않음");
await ev("window.__emitWorkspaceTest('workspace-window-gone', 'tear-test');");
await sleep(100);
check(await badgeOf("A") === "fail", "닫힌 aux 상태를 집계에서 제거");
await closePicker();

// 부팅 뒤 생긴 aux 배치도 최신 파일 guard가 원본 탭을 닫기 전에 거절한다.
await ev("window.__TAURI_INTERNALS__.invoke('workspaces_apply', { mutation: { op: 'putTabs', workspaceId: 'B', scope: { kind: 'aux', groupId: 'live-group' }, generation: 1, tabs: [{ tabKey: 'aux-tab', placement: { kind: 'aux', groupId: 'live-group' }, title: 'aux', root: { kind: 'start', tileKey: 'aux-tile' } }] } });");
await ev("(async () => { window.__beforeAuxDelete = JSON.stringify((await " + tabsMod + ").residentWindowTabs()); await (await " + actionsMod + ").deleteWorkspaceAsked('B'); })()");
check(await count() === 2 && await ev("(async () => JSON.stringify((await " + tabsMod + ").residentWindowTabs()) === window.__beforeAuxDelete)()") === true, "최신 aux 배치가 있으면 원본 탭 종료 전 삭제 거절");
await ev("window.__TAURI_INTERNALS__.invoke('workspaces_apply', { mutation: { op: 'putTabs', workspaceId: 'B', scope: { kind: 'aux', groupId: 'live-group' }, generation: 1, tabs: [] } });");

// 메뉴 snapshot → close → run을 실제 클릭한다. 이름·아이콘·색은 폴더와 같은 한 모달이다.
// 줄 우클릭 메뉴는 탭 줄 목록의 줄에서 연다(2026-10-13 — `[data-workspace-row-menu]`).
const openWorkspaceMenu = async (id) => {
  await openPicker();
  await ev("document.querySelector(" + JSON.stringify(rowSel(id)) + ").dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 50, clientY: 80 }));");
  await sleep(150);
};
/** 목록 줄의 아이콘 색 — 공용 SVG 렌더러(`svg.line`)를 지나고 `svg:` 글자가 새지 않는가 */
const rowIconColor = async (id) => { await openPicker(); return ev("(() => { const r = document.querySelector(" + JSON.stringify(rowSel(id)) + "); const svg = r?.querySelector('.ws-row-icon svg.line'); return svg && !r.textContent.includes('svg:') ? getComputedStyle(svg).color : null; })()"); };
const typeInto = async (selector, value) => {
  await ev("(() => { const input = document.querySelector(" + JSON.stringify(selector) + "); input.value = " + JSON.stringify(value) + "; input.dispatchEvent(new Event('input', { bubbles: true })); })()");
  await sleep(100);
};
await openWorkspaceMenu("B");
check(await ev("(() => { const m = document.querySelector('[data-workspace-row-menu]'); return m.querySelectorAll('[role=menuitem]').length === 2 && !/위로 이동|아래로 이동|Move up|Move down|이름 바꾸기|Rename/.test(m.textContent); })()") === true, "메뉴에는 편집·삭제만 있고 위로/아래로 이동은 없음");
check(await ev("!document.querySelector('[data-workspace-delete-menu]').disabled") === true, "두 workspace의 삭제는 활성");
await ev("document.querySelector('[data-workspace-edit-menu]').click();");
await sleep(200);
check(await ev("!!document.querySelector('[data-workspace-edit]') && !document.querySelector('[data-workspace-row-menu]') && !document.querySelector('[data-workspace-menu]') && !document.querySelector('[data-workspace-name]')") === true, "메뉴(줄 메뉴 · 목록)를 닫고 편집 모달 하나");
check(await ev("(() => { const m = document.querySelector('[data-workspace-edit]'); return [...m.querySelectorAll('label')].map(x => x.htmlFor).join(',') === 'workspace-edit-name,workspace-edit-icon,workspace-edit-color' && !m.querySelector('[data-section-nav]') && document.activeElement.id === 'workspace-edit-name'; })()") === true, "이름 → 공용 아이콘 → 색, 이름 칸 포커스");
await typeInto("#workspace-edit-name", "Renamed");
await ev("document.querySelector('[data-workspace-edit] [data-icon-seg=basic]').click();");
await typeInto("#workspace-edit-icon", "rocket");
await sleep(200);
await ev("document.querySelector('[data-workspace-edit] .icon-field .pick.hint')?.click();");
await typeInto("[data-workspace-edit] .color-text", "#8e4ec6");
await ev("document.querySelector('[data-workspace-edit-submit]').click();");
await sleep(300);
check(await ev("!document.querySelector('[data-workspace-edit]') && document.querySelector('[data-workspace-button]')?.title.startsWith('Renamed — ')") === true, "편집 저장 후 새 이름(탭 줄 단추)");
check(await ev("(() => { const c = window.__calls.filter(([c,a]) => c === 'workspaces_apply' && ['renameWorkspace','setWorkspaceStyle'].includes(a.mutation.op)); return c.length === 2 && c[0][1].mutation.name === 'Renamed' && c[1][1].mutation.icon === 'svg:lucide:rocket' && c[1][1].mutation.color === '#8e4ec6'; })()") === true, "ACK 큐에서 rename → setWorkspaceStyle 순서");
check(await rowIconColor("B") === "rgb(142, 78, 198)", "목록 줄은 공용 SVG 렌더러와 고른 색");
check(await ev("window.__calls.some(([c,a]) => c === 'plugin:event|emit' && a.event === 'workspace-style-changed' && a.payload.id === 'B' && a.payload.icon === 'svg:lucide:rocket' && a.payload.color === '#8e4ec6')") === true, "보조 창 스타일 알림 broadcast");
await openPicker();
await ev("document.querySelector(" + JSON.stringify(rowSel("B")) + ").focus();");
await key("F2");
check(await ev("!!document.querySelector('[data-workspace-edit]') && document.getElementById('workspace-edit-name').value === 'Renamed' && document.querySelector('[data-workspace-edit] .color-text').value === '#8e4ec6'") === true, "포커스된 workspace 줄의 F2는 편집과 기존 값");
await typeInto("#workspace-edit-name", "");
check(await ev("document.querySelector('[data-workspace-edit-submit]').disabled") === true, "빈 이름 저장 비활성");
await key("Escape");
await sleep(100);
// 닫은 뒤 포커스는 타일로(2026-10-13 — 편집을 여는 목록 · 팔레트는 이미 닫혀 있다 · `workspace-actions` 의 `focusAfterEdit`)
check(await ev("(async () => { const m = await " + tabsMod + "; const id = m.focusedPane()?.id; return !document.querySelector('[data-workspace-edit]') && !!id && !!document.activeElement?.closest('[data-pane=\"' + id + '\"]'); })()") === true, "Esc 취소 후 포커스는 타일로");
// 이름을 그대로 둔 색 변경은 rename을 다시 쓰지 않는다.
await openPicker();
await ev("document.querySelector(" + JSON.stringify(rowSel("B")) + ").focus();");
await key("F2");
await typeInto("[data-workspace-edit] .color-text", "#e5484d");
await ev("document.querySelector('[data-workspace-edit-submit]').click();"); await sleep(200);
check(await ev("window.__calls.filter(([c,a]) => c === 'workspaces_apply' && a.mutation.op === 'renameWorkspace').length === 1") === true && await rowIconColor("B") === "rgb(229, 72, 77)", "이름 불변 편집은 style만 저장");

const sessionsBeforeCreate = await ev("window.__calls.filter(([c]) => c === 'open_local_session' || c === 'open_ssh_session').length");
await openPicker();
await ev("document.querySelector('[data-workspace-menu] [data-workspace-new]').click();");
await sleep(100);
await ev("(async () => { const m = await " + actionsMod + "; m.workspaceNamePrompt.name = 'Created'; await m.submitWorkspaceName(); })()");
check(await count() === 3, "시작 화면 탭 하나로 생성하고 전환");
check(await ev("(async () => { const m = await " + tabsMod + "; return m.currentWorkspaceTabs().length === 1 && m.activeTab().root.type === 'leaf' && m.activeTab().root.pane.kind === 'start'; })()") === true, "생성된 workspace는 시작 화면 한 타일");
check(await ev("window.__calls.filter(([c]) => c === 'open_local_session' || c === 'open_ssh_session').length") === sessionsBeforeCreate, "새 workspace 생성은 세션을 열지 않음");
check(await ev("document.activeElement?.matches('[data-launcher] input[data-tile-focus]')") === true, "생성 후 시작 화면 검색 입력 포커스");

await key("KeyG", 2 | 8, "G");
check(await ev("!!document.querySelector('[data-workspace-switcher]')") === true, "Ctrl+Shift+G 선택기");
check(await ev("getComputedStyle(document.querySelector('#ws-option-B svg.line')).color === 'rgb(229, 72, 77)' && !document.querySelector('#ws-option-B').textContent.includes('svg:')") === true, "선택기도 저장된 SVG와 색");
await send("Input.insertText", { text: "Alpha" });
await key("ArrowDown");
await key("Enter");
check(await ev("(async () => (await " + wsMod + ").currentWorkspaceId())()") === "A", "검색·방향키·Enter 전환");
await key("KeyG", 2 | 8, "G");
await key("Escape");
check(await ev("!document.querySelector('[data-workspace-switcher]')") === true, "Esc 닫기");

// 상태바가 가로여도 워크스페이스는 탭 줄 단추 하나가 말한다(2026-10-07 — 옛 가로 띠 목록 · 채움 판 `.workspace-indicator`(2026-10-04)는
// 상태바 띠와 함께 걷혔다. 판 판정 셋은 뜻을 잃어 지웠다 — 2026-11-21). 단추의 지금 이름 · 목록의 현재 줄 · 고른 아이콘 색을 본다.
await choose("B");
await ev("(async () => { const m = await " + importApp("settings/model/store.svelte.ts") + "; m.settings.current.app.status_bar = 'bottom'; })()");
await sleep(100);
check(await ev("(() => { const b = document.querySelector('[data-workspace-button]'); return !document.querySelector('.statusbar [data-workspace-option], .statusbar [data-workspace]') && b?.querySelector('.ws-name')?.textContent.trim() === 'Renamed'; })()") === true
  && await rowIconColor("B") === "rgb(229, 72, 77)"
  && await ev("document.querySelector(" + JSON.stringify(rowSel("B")) + ").getAttribute('aria-checked') === 'true'") === true, "가로 상태바에서도 탭 줄 단추 = 지금 이름 · 목록의 현재 줄 · 고른 색");
await closePicker();
await shot("ws-plate-horizontal.png");
// 전환 움직임 — 탭 줄·캔버스가 옆(가로 띠 = X)에서 미끄러져 들어온다
const canvasMotion = () => ev("(() => { const c = document.querySelector('[data-tile-canvas]'); const t = document.querySelector('.titlebar > .tabs'); return JSON.stringify({ c: getComputedStyle(c).transform, co: +(+getComputedStyle(c).opacity).toFixed(2), t: getComputedStyle(t).transform, anim: c.getAnimations().filter(a => a.id === 'workspace-slide').length }); })()").then(JSON.parse);
await ev("(async () => (await " + wsMod + ").switchWorkspace('A'))()"); await sleep(70);
let cm = await canvasMotion();
console.log("ws switch +70ms (horizontal):", JSON.stringify(cm));
check(cm.anim === 1 && /^matrix\(1, 0, 0, 1, -[\d.]+, 0\)$/.test(cm.c) && cm.co === 1 && cm.t !== "none", "가로 — B→A(앞으로)는 왼쪽(-X)에서 미끄러진다 · 투명도는 1 그대로(빈 프레임 깜빡임 없음)");
await sleep(350);
cm = await canvasMotion();
check(cm.anim === 0 && cm.c === "none" && cm.t === "none" && cm.co === 1, `가로 — 끝 프레임에 transform 없음 (${JSON.stringify(cm)})`);
await ev("(async () => { const m = await " + importApp("settings/model/store.svelte.ts") + "; m.settings.current.app.status_bar = 'left'; })()");
await sleep(300);
await ev("(async () => (await " + wsMod + ").switchWorkspace('B'))()"); await sleep(70);
cm = await canvasMotion();
console.log("ws switch +70ms (vertical):", JSON.stringify(cm));
check(cm.anim === 1 && /^matrix\(1, 0, 0, 1, 0, [\d.]+\)$/.test(cm.c), "세로 — A→B(뒤로)는 아래(+Y)에서 미끄러져 들어온다");
await sleep(350);
cm = await canvasMotion();
check(cm.anim === 0 && cm.c === "none", "세로 — 끝 프레임에 transform 없음");
await shot("ws-plate-vertical.png");
await ev("document.documentElement.dataset.theme = 'light'"); await sleep(300);
await shot("ws-plate-vertical-light.png");
await ev("(async () => { const m = await " + importApp("settings/model/store.svelte.ts") + "; m.settings.current.app.status_bar = 'bottom'; })()"); await sleep(300);
await shot("ws-plate-horizontal-light.png");
await ev("(async () => { const m = await " + importApp("settings/model/store.svelte.ts") + "; m.settings.current.app.status_bar = 'left'; })()"); await sleep(200);
await ev("delete document.documentElement.dataset.theme"); await sleep(300);
// 캔버스를 덮은 판이 떠 있으면 걸지 않는다 — 전체 화면 대시보드는 2026-10-07 에 없어졌고 그 자리는 사용량 · 자원 화면(`coverViewOpen`)이다(2026-11-21)
await ev("(async () => (await " + importApp("app/usage-view.svelte.ts") + ").openUsageView())()"); await sleep(200);
await ev("(async () => (await " + wsMod + ").switchWorkspace('A'))()"); await sleep(60);
check((await canvasMotion()).anim === 0, "사용량 화면이 떠 있으면 전환 움직임 없음");
await ev("(async () => (await " + importApp("app/usage-view.svelte.ts") + ").closeCoverView())()"); await sleep(300);
await choose("A");

// HTML5 DnD 대신 synthesized pointerdown/move/up. 저장에 전체 id 순열을 보낸다. 끌기는 탭 줄 목록의 줄에서 한다(2026-10-13 —
// 삽입선 `.ws-row.drop-before` · `.ws-row.drop-end` · 끄는 줄 `.ws-row.dragging`). 목록을 열어 두고 시작한다.
const idsInSidebar = async () => { await openPicker(); return ev("[...document.querySelectorAll('[data-workspace-menu] [data-workspace-option]')].map(x => x.dataset.workspaceOption).join(',')"); };
const reorderCount = () => ev("window.__calls.filter(([c,a]) => c === 'workspaces_apply' && a.mutation.op === 'reorderWorkspaces').length");
const armWorkspaceDrag = async (from, before) => {
  await openPicker();
  await ev("(() => { const from = " + JSON.stringify(from) + ", before = " + JSON.stringify(before) + "; const q = (id) => document.querySelector('[data-workspace-menu] [data-workspace-option=\"' + id + '\"]'); const row = q(from); const r = row.getBoundingClientRect(); const end = (before ? q(before) : [...document.querySelectorAll('[data-workspace-menu] [data-workspace-option]')].at(-1)).getBoundingClientRect(); window.__wsPointer = { from, x: r.left + r.width / 2, y: r.top + r.height / 2, to: before ? end.top + 1 : end.bottom - 1 }; row.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 714, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1, clientX: window.__wsPointer.x, clientY: window.__wsPointer.y })); })()");
};
const moveWorkspaceDrag = async (outside = false) => {
  await ev("(() => { const p = window.__wsPointer; window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 714, pointerType: 'mouse', buttons: 1, clientX: " + (outside ? "p.x + 200" : "p.x") + ", clientY: p.to })); })()");
  await sleep(50);
};
const dropWorkspaceDrag = async (outside = false) => {
  await ev("(() => { const p = window.__wsPointer; window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 714, pointerType: 'mouse', button: 0, clientX: " + (outside ? "p.x + 200" : "p.x") + ", clientY: p.to })); document.querySelector('[data-workspace-menu] [data-workspace-option=\"' + p.from + '\"]')?.click(); })()");
  await sleep(300);
};
const dragCreatedId = await ev("(async () => (await " + wsMod + ").workspaceList().find(x => x.name === 'Created').id)()");
await armWorkspaceDrag("B", null); await moveWorkspaceDrag();
check(await ev("!!document.querySelector('[data-workspace-menu] .ws-row.drop-end')") === true, "맨 뒤 삽입선");
await dropWorkspaceDrag();
check(await idsInSidebar() === "A," + dragCreatedId + ",B", "포인터 드롭으로 맨 뒤에 재정렬");
check(await ev("(async () => (await " + wsMod + ").currentWorkspaceId())()") === "A", "드롭 뒤 따라온 클릭은 workspace를 바꾸지 않음");
check(await ev("window.__calls.filter(([c,a]) => c === 'workspaces_apply' && a.mutation.op === 'reorderWorkspaces').at(-1)[1].mutation.ids.join(',')") === "A," + dragCreatedId + ",B", "ReorderWorkspaces는 전체 id 순열");
await armWorkspaceDrag("B", "A"); await moveWorkspaceDrag();
check(await ev("document.querySelector(" + JSON.stringify(rowSel("A")) + ").classList.contains('drop-before')") === true, "앞쪽 삽입선");
await dropWorkspaceDrag();
check(await idsInSidebar() === "B,A," + dragCreatedId, "뒤에서 앞으로도 재정렬");
const beforeCancelReorder = await reorderCount();
await armWorkspaceDrag("A", null); await moveWorkspaceDrag(); await key("Escape"); await dropWorkspaceDrag();
check(await idsInSidebar() === "B,A," + dragCreatedId && await reorderCount() === beforeCancelReorder && await ev("!document.querySelector('.ws-row.drop-before,.ws-row.drop-end,.ws-row.dragging')") === true, "Esc는 선·드래그를 지우고 저장 취소");
await armWorkspaceDrag("A", null); await moveWorkspaceDrag(true); await dropWorkspaceDrag(true);
check(await reorderCount() === beforeCancelReorder, "목록 밖 드롭은 저장하지 않음");
await armWorkspaceDrag("B", dragCreatedId); await moveWorkspaceDrag(); await dropWorkspaceDrag();
check(await idsInSidebar() === "A,B," + dragCreatedId, "중간 위치도 전체 순열로 저장");
const beforeClickReorder = await reorderCount();
await armWorkspaceDrag("B", null);
await ev("(() => { const p = window.__wsPointer; window.dispatchEvent(new PointerEvent('pointermove', { pointerId: 714, clientX: p.x + 2, clientY: p.y + 2 })); window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 714, clientX: p.x + 2, clientY: p.y + 2 })); document.querySelector(" + JSON.stringify(rowSel("B")) + ").click(); })()");
await sleep(300);
check(await ev("(async () => (await " + wsMod + ").currentWorkspaceId())()") === "B" && await reorderCount() === beforeClickReorder, "문턱 전 클릭은 전환만 한다");
await choose("A");

const requestDelete = async (id) => {
  // 확인 대기 Promise를 await하지 않는다. CDP는 picker가 뜬 뒤 직접 조작한다.
  await ev("(async () => { const a = await " + actionsMod + "; window.__deleteDone = false; a.deleteWorkspaceAsked('" + id + "').then(() => window.__deleteDone = true); })()");
  await sleep(150);
};
const submitDelete = async () => {
  await ev("document.querySelector('[data-workspace-delete-submit]').click();");
  await sleep(250);
  check(await ev("window.__deleteDone") === true, "삭제 명령 ACK까지 완료");
};
const createdId = await ev("(async () => (await " + wsMod + ").workspaceList().find(x => x.name === 'Created').id)()");
await ev("(async () => { window.__beforeDeleteCancel = JSON.stringify((await " + tabsMod + ").residentWindowTabs()); window.__projectsBeforeCancel = JSON.stringify((await " + projectsMod + ").projects()); })()");
await requestDelete("B");
check(await ev("!!document.querySelector('[data-workspace-delete]') && !document.querySelector('[data-workspace-project-target]')") === true, "삭제는 탭/세션 수만 표시");
await ev("(async () => (await " + actionsMod + ").closeWorkspaceDeletePrompt())()");
check(await count() === 3 && await ev("(async () => JSON.stringify((await " + tabsMod + ").residentWindowTabs()) === window.__beforeDeleteCancel && JSON.stringify((await " + projectsMod + ").projects()) === window.__projectsBeforeCancel)()") === true, "삭제 취소는 탭/프로젝트/workspace 유지");
await requestDelete("B");
await submitDelete();
await requestDelete(createdId);
await submitDelete();
check(await count() === 1 && await ev("(async () => JSON.stringify((await " + projectsMod + ").projects()) === window.__projectsBeforeCancel)()") === true, "삭제는 탭 종료만, 전역 프로젝트 유지");
check(await ev("window.__calls.filter(([c,a]) => c === 'workspaces_apply' && a.mutation.op === 'deleteWorkspace').every(([,a]) => !Object.hasOwn(a.mutation, 'moveProjectsTo'))") === true, "삭제 명령에는 project 대상이 없음");
await openWorkspaceMenu("A");
check(await ev("(() => { const b = document.querySelector('[data-workspace-delete-menu]'); return b.disabled && [\"워크스페이스가 하나뿐이라 지울 수 없습니다\",\"Can't delete the only workspace\"].includes(b.title); })()") === true, "마지막 workspace 메뉴 삭제 비활성과 이유 툴팁");
await ev("document.querySelector('[data-workspace-delete-menu]').click();");
check(await ev("!!document.querySelector('[data-workspace-row-menu]') && !document.querySelector('[data-workspace-delete]')") === true, "비활성 삭제 클릭은 확인창을 열지 않음");
await key("Escape"); await key("Escape"); // 줄 메뉴 → 목록 순으로 닫는다
check(await pickerOpen() === false, "Escape 두 번에 줄 메뉴 · 목록이 닫힌다");
await key("KeyP", 2 | 8, "P");
await typeInto("input.q", ">delete-workspace");
check(await ev("(() => { const b = document.querySelector('[data-action=delete-workspace]'); return b.disabled && [\"워크스페이스가 하나뿐이라 지울 수 없습니다\",\"Can't delete the only workspace\"].includes(b.title) && !b.querySelector('[data-keys]'); })()") === true, "팔레트 마지막 삭제도 비활성과 이유 툴팁");
await ev("document.querySelector('[data-action=delete-workspace]').click();");
await key("Enter");
check(await ev("!!document.querySelector('.palette') && !document.querySelector('[data-workspace-delete]')") === true, "비활성 팔레트 클릭·Enter는 실행하거나 닫지 않음");
await key("Escape");
const before = await ev("window.__calls.filter(([c,a]) => c === 'workspaces_apply' && a.mutation.op === 'deleteWorkspace').length");
await ev("(async () => (await " + actionsMod + ").deleteWorkspaceAsked('A'))()");
check(await count() === 1, "마지막 workspace 삭제 거절");
check(await ev("window.__calls.filter(([c,a]) => c === 'workspaces_apply' && a.mutation.op === 'deleteWorkspace').length") === before, "마지막 삭제는 backend에 보내지 않는다");
check(errors.length === 0, "콘솔 예외 0: " + errors.join(" | "));
await shot("workspaces.png");
await ev("(async () => { const m = await " + importApp("settings/model/store.svelte.ts") + "; m.settings.current.app.status_bar = 'bottom'; })()");
await sleep(200);
// 옛 가로 상태바의 현재 칩(`[data-workspace-current]`)은 탭 줄 단추가 물려받았다(2026-10-07) — 단추는 탭 줄 맨 앞, 아이콘 없는 줄은 머리글자에 고른 색.
check(await ev("(() => { const b = document.querySelector('[data-workspace-button]'); return !!b && b.parentElement.firstElementChild === b && b.querySelector('.ws-name')?.textContent.trim() === 'Alpha'; })()") === true, "가로에서도 지금 워크스페이스 단추는 탭 줄 맨 앞");
await openPicker();
check(await ev("getComputedStyle(document.querySelector(" + JSON.stringify(rowSel("A") + " .ws-row-icon [aria-hidden=true]") + ")).color === 'rgb(136, 136, 238)'") === true, "아이콘 없는 줄은 머리글자에 고른 색");
await closePicker();
// 실패 화면: 쓰기/lease 없이 기본 빈 탭, 문제만 표시하고 우연히 닫히지 않는다.
await ev("sessionStorage.setItem('ws-failure', '1');");
await reloadBoot(send, ev);
check(await ev("!!document.querySelector('[data-workspace-migration]')") === true, "이관 실패 복구 화면");
check(await ev("document.querySelector('[data-workspace-migration]').textContent.includes('layouts.json · 2 · invalidField') && !document.querySelector('[data-workspace-migration]').textContent.includes('private.cwd')") === true, "파일명/index/code만 표시");
check(await ev("!window.__calls.some(([cmd]) => cmd === 'workspaces_apply' || cmd === 'workspaces_claim_writer')") === true, "실패 부팅은 파일 쓰기와 writer 생성 없음");
check(await ev("(async () => { const m = await " + tabsMod + "; return m.currentWorkspaceTabs().length === 1 && m.activeTab().root.pane.kind === 'start'; })()") === true, "메모리 기본 워크스페이스의 빈 탭 하나");
await key("Escape");
await ev("document.querySelector('[data-workspace-migration]').parentElement.click();");
check(await ev("!!document.querySelector('[data-workspace-migration]')") === true, "Escape/배경 클릭은 복구 화면을 지우지 않음");
await ev("document.querySelector('[data-workspace-migration] button').click();"); await sleep(300);
check(await ev("window.__calls.filter(([cmd]) => cmd === 'workspaces_migrate').length === 2") === true, "다시 시도도 안전한 이관 경로");
await ev("document.querySelector('[data-workspace-migration] button:last-child').click();"); await sleep(4500);
check(await ev("sessionStorage.getItem('ws-backed-up') === '1' && !document.querySelector('[data-workspace-migration]')") === true, "명시적 새 시작은 원본 보관 후 정상 부팅");
await ev("sessionStorage.removeItem('ws-fresh'); sessionStorage.removeItem('ws-backed-up');");
console.log("failed=" + failed);
ws.close();
if (failed > 0) process.exitCode = 1;
