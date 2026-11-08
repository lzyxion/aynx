// 설정 모달: 가운데 배치 · 배경 닫기 · 포커스 순회 · 단축키 · 설정 섹션 상태.
// 실행: node scripts/dev/run-harness.mjs settings-modal-harness.mjs <outdir>
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
    // cmd 의 라벨은 **한국어로 구운 글자**다 — 영어로 바꿔도 화면은 이 글자에 기대지 않아야 한다(기본 셸 판).
    // nushell 은 프런트가 모르는 셸 — 백엔드 글자 + 일반 터미널 아이콘으로 떨어진다.
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }, { id: 'powershell', label: 'Windows PowerShell' }, { id: 'cmd', label: '명령 프롬프트' }, { id: 'gitbash', label: 'Git Bash' }, { id: 'wsl:Ubuntu', label: 'WSL: Ubuntu' }, { id: 'nushell', label: 'Nushell' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: false }],
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
    mcp_status: { name: 'aynx-sessions-dev', running: true, url: 'http://127.0.0.1:43210/mcp' },
    agent_args_targets: [{ id: 'claude', display: 'Claude Code' }, { id: 'codex', display: 'Codex' }],
    agent_launch_preview: { line: 'claude', error: null, dangerous: [] },
    agent_mcp_validate: null,
    mcp_activity: null, list_forwards: [], session_log_path: null,
    mcp_tools: [
      { name: 'list_sessions', group: 'read', description: 'The AI-readable open sessions.' },
      { name: 'create_execution_plan', group: 'plan', description: 'Saves a task plan (draft).' },
      { name: 'start_run', group: 'tile', description: 'Opens a run in a delegated repository.' },
    ],
    mcp_calls: [],
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
      if (cmd === 'vault_status') return Promise.resolve(window.__vaultStatus ?? { state: 'absent', hasMaster: false, entryCount: 0 });
      if (cmd === 'vault_create') { window.__vaultStatus = { state: 'unlocked', hasMaster: false, entryCount: 0 }; return Promise.resolve(null); }
      if (cmd === 'vault_store_mcp_env') return Promise.resolve(args.label + ':reference-' + window.__calls.filter(c=>c[0]==='vault_store_mcp_env').length);
      if (cmd === 'agent_mcp_validate' && args.existingNames.includes(args.server.name)) return Promise.resolve('같은 범위에 이미 등록된 이름입니다');
      if (cmd === 'save_settings' && window.__failSave) return Promise.reject(new Error('save failed'));
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: args?.shell ?? 'pwsh' }); }
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++ });
      if (cmd === 'stage_agent_attachment') { window.__staged ??= []; window.__staged.push({ bytes: [...args], name: decodeURIComponent(options.headers['x-file-name']) }); return Promise.resolve('C:/copies/' + window.__staged.length + '/' + decodeURIComponent(options.headers['x-file-name'])); }
      if (cmd === 'agent_autorun_command') return Promise.resolve(args.command);
      // 자동 승인 시험 칸 — Rust 판정을 흉내 낸 작은 표(초안의 bundle_off 를 본다)
      if (cmd === 'test_auto_approval') {
        const c = args.command; const a = args.automation; const off = (a.bundle_off ?? {}).files ?? [];
        const r = (verdict, code, extra) => Promise.resolve({ enabled: a.auto_approve, verdict, reasons: [{ code, args: { segment: c, ...extra } }] });
        if (c.includes('|')) return Promise.resolve({ enabled: a.auto_approve, verdict: 'excluded', reasons: [{ code: 'split_pipe', args: {} }] });
        if (/^tail .*-f/.test(c)) return r('manual', 'constraint', { bundle: 'files', key: 'tail', kind: 'deny', item: '-f' });
        if (/^cat /.test(c)) return off.includes('cat') ? r('manual', 'bundle_off', { bundle: 'files', key: 'cat' }) : r('auto', 'match_bundle', { bundle: 'files', key: 'cat' });
        // 사용자 규칙(허용 패턴 편집) — 초안의 allow 를 본다: 같은 exec 규칙이 있고 금지 플래그에 안 걸리면 자동
        { const exec = c.split(' ')[0]; const rule = (a.allow ?? []).find(x => x.exec === exec);
          if (rule) { const hit = (rule.deny_flags ?? []).find(f => c.split(' ').includes(f)); return hit ? r('manual', 'constraint', { exec, kind: 'deny', item: hit }) : r('auto', 'match_rule', { exec }); } }
        return r('manual', 'no_rule', {});
      }
      if (cmd === 'git_worktree_list') return Promise.resolve([]);
      // 에이전트 훅 — Claude 는 설치됨, Codex 는 업데이트 필요(접기 머리의 훅 배지 두 모양)
      if (cmd === 'agent_hooks_targets') return Promise.resolve([{ id: 'claude', display: 'Claude Code', needsTrustNote: false }, { id: 'codex', display: 'Codex', needsTrustNote: true }]);
      if (cmd === 'agent_hooks_status') return Promise.resolve({ installed: args.agent === 'claude', partial: args.agent === 'codex', settingsPath: '~/.' + args.agent + '/settings.json', scriptPath: '~/.aynx/hook', preview: '{}', error: null });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });


await send("Page.reload", { ignoreCache: true }); await sleep(4500);
await send("Page.bringToFront");
counting = true;
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded: ${file}'); return await import(e); })()`;
const dockMod = importApp('app/dock.svelte.ts');
const keysMod = importApp('app/keys.svelte.ts');
const overlaysMod = importApp('app/overlays.svelte.ts');
const key = async (code, modifiers = 0, k = code) => {
  const vk = code === 'Tab' ? 9 : code === 'Escape' ? 27 : code === 'Comma' ? 188 : code.startsWith('Key') ? code.charCodeAt(3) : 0;
  for (const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent', { type, code, key:k, modifiers, windowsVirtualKeyCode:vk, nativeVirtualKeyCode:vk });
  await sleep(100);
};
const opened = async () => {
  await ev(`(async () => { (await ${dockMod}).openDock('settings'); })()`); await sleep(250);
};
// 등장 움직임(2026-10-04) — 상자는 살짝 커지며 떠오르고 배경막은 0→1. 끝 프레임에 transform 이 남지 않는다.
const modalAnim = () => ev(`(() => { const el = document.querySelector('.settings-modal'); const b = document.querySelector('.settings-backdrop'); const cs = getComputedStyle(el); return JSON.stringify({ t: cs.transform, o: +(+cs.opacity).toFixed(2), anim: el.getAnimations().length, bo: b ? +(+getComputedStyle(b).opacity).toFixed(2) : null }); })()`).then(JSON.parse);
await ev(`(async () => { (await ${dockMod}).openDock('settings'); })()`); await sleep(50);
let ma = await modalAnim();
console.log('modal open+50ms', JSON.stringify(ma));
check(ma.anim === 1 && ma.t !== 'none' && ma.o < 1 && ma.bo !== null && ma.bo < 1, `modal entrance: box mid transform/opacity, backdrop fading in (${JSON.stringify(ma)})`);
await sleep(350);
ma = await modalAnim();
check(ma.anim === 0 && ma.t === 'none' && ma.o === 1 && ma.bo === 1, `modal entrance ends at transform none · opacity 1 (${JSON.stringify(ma)})`);
await ev(`(async () => { (await ${dockMod}).closeDock(); })()`); await sleep(100);
check(await ev(`document.querySelector('.settings-modal')?.hidden !== false || !document.querySelector('.settings-modal')`) && !await ev(`!!document.querySelector('.settings-backdrop')`), 'modal close stays immediate');
await opened();
let info = await ev(`(() => { const el = document.querySelector('.settings-modal'); const r = el.getBoundingClientRect(); return { x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight,role:el.getAttribute('role'),modal:el.getAttribute('aria-modal'),focus:document.activeElement===el,backdrop:!!document.querySelector('.settings-backdrop'),grip:!!el.querySelector('.grip') }; })()`);
console.log('geometry', JSON.stringify(info));
check(Math.abs(info.x + info.w/2 - info.vw/2) < 1 && Math.abs(info.y + info.h/2 - info.vh/2) < 1, 'settings centered in viewport');
check(info.role === 'dialog' && info.modal === 'true' && info.backdrop && !info.grip, 'modal semantics, backdrop and no dock resize grip');
check(info.focus, 'opening focuses modal container');
check(await ev(`document.querySelectorAll('.settings-modal .head button').length === 1`) && !await ev(`(async () => 'openSettingsPaneHere' in (await ${importApp('app/panes.svelte.ts')}))()`), 'settings tile button and creation entry point removed');
check(await ev(`(async () => (await ${keysMod}).anyModalOpen())()`), 'global tile shortcuts blocked');
await shot('settings-modal.png');
await key('Tab', 8, 'Tab');
check(await ev(`document.activeElement === Array.from(document.querySelector('.settings-modal').querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')).filter(e=>e.tabIndex>=0 && e.getClientRects().length>0).at(-1)`), 'Shift+Tab from container goes to last control');
await key('Tab', 0, 'Tab');
check(await ev(`document.activeElement === document.querySelector('.settings-modal .head button')`), 'Tab from last wraps to first');
await key('Escape', 0, 'Escape');
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === null, 'Escape closes settings');
await opened();
await key('Comma', 2, ',');
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === null, 'Ctrl+, toggles settings closed');
await ev(`(async () => (await ${overlaysMod}).openSettingsAt('keys'))()`); await sleep(300);
check(await ev(`document.querySelector('.settings-modal .key-combo')?.getClientRects().length > 0 && document.querySelector('.settings-modal .settings-nav .active')?.textContent.trim() === '단축키'`), 'settings section request preserved');
// 카테고리 전환 — 새 섹션이 살짝 떠오르며 나타난다(SettingsModal 의 settings-section-in), 끝나면 transform 이 남지 않는다
{
  const secAnim = () => ev(`(() => { const s = document.querySelector('.settings-panel > section:not([hidden])'); const cs = getComputedStyle(s); return JSON.stringify({ n: s.getAnimations().map(a => a.animationName), d: cs.animationDuration, o: +(+cs.opacity).toFixed(2), t: cs.transform }); })()`).then(JSON.parse);
  await ev(`(async () => (await ${overlaysMod}).openSettingsAt('terminal'))()`); await sleep(40);
  const mid = await secAnim();
  await sleep(700);
  const end = await secAnim();
  console.log('section switch', JSON.stringify({ mid, end }));
  check(mid.n.some((n) => n.includes('settings-section-in')) && mid.o < 1, 'section switch: new section fades/rises in');
  check(end.n.length === 0 && end.o === 1 && end.t === 'none', 'section switch: ends at opacity 1 · transform none');
}
// 왼쪽 내비의 선택 표시 — 판 하나(.nav-indicator)가 선택된 칸 위에 앉고, 메뉴를 바꾸면 translateY 전이로 미끄러진다.
const navIndicator = async () => ev(`(() => { const nav=document.querySelector('.settings-modal .settings-nav'); const ind=nav.querySelector('.nav-indicator'); const act=nav.querySelector('.nav-item[aria-current="page"]'); const ir=ind.getBoundingClientRect(), ar=act.getBoundingClientRect(); const cs=getComputedStyle(ind), acs=getComputedStyle(act); const probe=document.createElement('div'); probe.style.color='var(--accent-soft)'; document.body.appendChild(probe); const soft=getComputedStyle(probe).color; probe.remove(); return { count: nav.querySelectorAll('.nav-indicator').length, hidden: ind.getAttribute('aria-hidden'), dy: Math.abs(ir.top-ar.top), dh: Math.abs(ir.height-ar.height), op: cs.opacity, bg: cs.backgroundColor, soft, actBg: acs.backgroundColor, actColor: acs.color, fg: getComputedStyle(nav.querySelector('.nav-item:not(.active)')).color, overflowX: nav.scrollWidth - nav.clientWidth }; })()`);
let ni = await navIndicator();
console.log('nav indicator', JSON.stringify(ni));
check(ni.count === 1 && ni.hidden === 'true' && ni.op === '1' && ni.dy < 1 && ni.dh < 1, 'nav indicator: one aria-hidden plate sits on the selected item');
check(ni.bg === ni.soft && ni.actBg === 'rgba(0, 0, 0, 0)' && ni.actColor !== ni.fg, 'nav indicator: --accent-soft plate (secondaryContainer), onSecondaryContainer label, item itself unpainted');
const slide = await ev(`(async () => {
  const nav = document.querySelector('.settings-modal .settings-nav'); const ind = nav.querySelector('.nav-indicator');
  const items = [...nav.querySelectorAll('.nav-item')]; const target = items.at(-1);
  const ty = () => new DOMMatrixReadOnly(getComputedStyle(ind).transform).m42;
  const from = ty(); target.click();
  const samples = []; const t0 = performance.now();
  while (performance.now() - t0 < 450) { await new Promise((r) => requestAnimationFrame(r)); samples.push(Math.round(ty() * 10) / 10); }
  const anims = ind.getAnimations().length;
  return { from, to: target.offsetTop, samples, end: ty(), mid: samples.filter((v) => Math.abs(v - from) > 1 && Math.abs(v - target.offsetTop) > 1).length, anims, current: target.getAttribute('aria-current') };
})()`);
console.log('nav slide', JSON.stringify({ ...slide, samples: slide.samples.slice(0, 12) }));
check(slide.mid >= 2 && Math.abs(slide.end - slide.to) < 0.5 && slide.current === 'page', 'nav indicator slides through intermediate positions to the new item');
await shot('settings-nav-dark.png');
const prevTheme = await ev(`document.documentElement.dataset.theme ?? ''`);
await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(150);
await shot('settings-nav-light.png');
await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 700, deviceScaleFactor: 1, mobile: false }); await sleep(300);
ni = await navIndicator();
check(ni.dy < 1 && ni.dh < 1 && ni.overflowX <= 0 && await ev(`(() => { const d=document.querySelector('.settings-modal'); const r=d.getBoundingClientRect(); return r.right <= innerWidth && document.documentElement.scrollWidth <= innerWidth; })()`), 'nav indicator stays on the item at 680px without overflow');
await shot('settings-nav-light-680.png');
await ev(`document.documentElement.dataset.theme = ${JSON.stringify(prevTheme || 'dark')}`); await sleep(150);
await shot('settings-nav-dark-680.png');
await send('Emulation.clearDeviceMetricsOverride'); await sleep(200);
await ev(`document.querySelector('.settings-modal [data-nav-tab="keys"]').click()`); await sleep(300);
await ev(`document.querySelector('.settings-modal .key-combo').click()`);
await key('Escape', 0, 'Escape');
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === 'settings' && await ev(`!document.querySelector('.settings-modal .key-combo.recording')`), 'Escape cancels key recording without closing settings');
await ev(`(async () => (await ${importApp('app/vault.svelte.ts')}).openMasterPrompt('set'))()`); await sleep(250);
await key('Escape', 0, 'Escape');
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === 'settings' && !await ev(`(async () => (await ${importApp('app/vault.svelte.ts')}).masterPromptVisible())()`), 'Escape closes nested master prompt and leaves settings open');
await ev(`document.querySelector('.settings-backdrop').click()`); await sleep(200);
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === null, 'backdrop closes settings');
await ev(`(async () => (await ${dockMod}).openDock('hosts'))()`); await sleep(250);
check(await ev(`document.querySelector('.dock').getAttribute('role') === 'presentation' && !document.querySelector('.settings-backdrop') && !!document.querySelector('.dock .grip')`), 'launcher remains a dock');
await opened();
await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 600, deviceScaleFactor:1,mobile:false }); await sleep(250);
info = await ev(`(() => { const r=document.querySelector('.settings-modal').getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height,vw:innerWidth,vh:innerHeight}; })()`);
check(info.x >= 0 && info.y >= 0 && info.x+info.w <= info.vw && info.y+info.h <= info.vh, 'modal fits smaller window');
await shot('settings-modal-small.png');
// 설정 MCP 메뉴: 독 아이콘 제거 · AI 설치 상태 · 중첩 폼 · 공용 저장·취소.
await ev(`(async () => (await ${overlaysMod}).openSettingsAt('ai'))()`); await sleep(250);
check(await ev(`document.querySelector('.settings-view [data-agent-install="claude"]')?.textContent.includes('설치됨') && document.querySelector('.settings-view [data-agent-install="codex"]')?.textContent.includes('찾을 수 없음')`), 'agent installation status stays in AI options');
await send('Emulation.clearDeviceMetricsOverride'); await sleep(250); // 넓은 화면에서 접기 모양을 먼저 본다
// AI 에이전트 — 에이전트마다 접기 한 칸. 머리(설치·훅 상태 · 사용 토글)는 늘 보이고 몸통은 기본 접힘.
const agentState = () => ev(`[...document.querySelectorAll('.settings-view [data-agent]')].map((sec) => { const b = sec.querySelector('[data-agent-expand]'); const body = document.getElementById(b.getAttribute('aria-controls')); return { id: sec.dataset.agent, exp: b.getAttribute('aria-expanded'), h: Math.round(body.getBoundingClientRect().height), inert: body.inert, hooks: sec.querySelector('[data-agent-hooks-badge]')?.dataset.hooksState ?? null, hooksText: sec.querySelector('[data-agent-hooks-badge]')?.textContent.trim() ?? null, install: sec.querySelector('[data-agent-install]')?.textContent.trim(), toggle: !!sec.querySelector('.agent-head [role="switch"], .agent-head input') }; })`);
let ag = await agentState();
console.log('agents', JSON.stringify(ag));
check(ag.length === 2 && ag.every((a) => a.exp === 'false' && a.h === 0 && a.inert && a.toggle), 'agent accordion: collapsed by default, inert body, toggle in head');
check(ag.find((a) => a.id === 'claude')?.hooks === 'installed' && ag.find((a) => a.id === 'codex')?.hooks === 'partial' && /훅/.test(ag[0].hooksText), 'agent accordion: hook status badge readable while collapsed');
await shot('ai-accordion-collapsed.png');
await ev(`document.getElementById('ai-enabled-claude').click()`); await sleep(250);
ag = await agentState();
check(ag.find((a) => a.id === 'claude').exp === 'false' && await ev(`!document.querySelector('[data-agent="claude"]').hasAttribute('data-agent-enabled')`), 'agent accordion: use toggle does not change expansion');
const expandAnim = await ev(`(async () => {
  const b = document.querySelector('[data-agent-expand="claude"]'); const body = document.getElementById(b.getAttribute('aria-controls'));
  b.focus(); b.click(); const hs = []; const t0 = performance.now();
  while (performance.now() - t0 < 400) { await new Promise((r) => requestAnimationFrame(r)); hs.push(Math.round(body.getBoundingClientRect().height)); }
  return { hs, exp: b.getAttribute('aria-expanded'), off: !!body.querySelector('[data-agent-off="claude"]'), inert: body.inert };
})()`);
console.log('expand off', JSON.stringify({ ...expandAnim, hs: expandAnim.hs.slice(0, 10) }));
const endH = expandAnim.hs.at(-1);
check(expandAnim.exp === 'true' && !expandAnim.inert && expandAnim.off && endH > 0 && expandAnim.hs.some((h) => h > 0 && h < endH), 'agent accordion: off agent expands smoothly to its off note');
await shot('ai-accordion-off.png');
await ev(`document.getElementById('ai-enabled-claude').click()`); await sleep(300);
check(await ev(`!!document.querySelector('#ai-claude-statusline') && document.querySelector('[data-agent-expand="claude"]').getAttribute('aria-expanded') === 'true' && document.getElementById('ai-agent-claude-body').getBoundingClientRect().height > 60`), 'agent accordion: re-enabled agent shows its body rows');
await shot('ai-accordion-open.png');
for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code: 'Enter', key: 'Enter', windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === 'keyDown' ? { text: String.fromCharCode(13) } : {}) });
await sleep(350);
check(await ev(`document.activeElement === document.querySelector('[data-agent-expand="claude"]') && document.querySelector('[data-agent-expand="claude"]').getAttribute('aria-expanded') === 'false' && document.getElementById('ai-agent-claude-body').getBoundingClientRect().height === 0`), 'agent accordion: Enter on the head collapses');
await ev(`(async () => (await ${overlaysMod}).openSettingsAt('ai', 'ai-args-codex'))()`); await sleep(500);
check(await ev(`document.querySelector('[data-agent-expand="codex"]').getAttribute('aria-expanded') === 'true' && document.activeElement?.id === 'ai-args-codex'`), 'agent accordion: settings anchor expands the agent and focuses the row');
// 하나만 열림 — 다른 에이전트를 펴면 codex 는 접히고, 닫힘과 열림이 같은 프레임들에서 함께 움직인다
const swap = await ev(`(async () => {
  const h = (id) => Math.round(document.getElementById('ai-agent-' + id + '-body').getBoundingClientRect().height);
  document.querySelector('[data-agent-expand="claude"]').click(); const fr = []; const t0 = performance.now();
  while (performance.now() - t0 < 400) { await new Promise((r) => requestAnimationFrame(r)); fr.push([h('claude'), h('codex')]); }
  const st = (id) => { const b = document.querySelector('[data-agent-expand="' + id + '"]'); return { exp: b.getAttribute('aria-expanded'), inert: document.getElementById(b.getAttribute('aria-controls')).inert, h: h(id) }; };
  return { fr, claude: st('claude'), codex: st('codex'), face: getComputedStyle(document.querySelector('[data-agent="claude"]')).backgroundColor, closedFace: getComputedStyle(document.querySelector('[data-agent="codex"]')).backgroundColor };
})()`);
console.log('swap', JSON.stringify({ ...swap, fr: swap.fr.slice(0, 8) }));
check(swap.claude.exp === 'true' && !swap.claude.inert && swap.claude.h > 0 && swap.codex.exp === 'false' && swap.codex.inert && swap.codex.h === 0, 'agent accordion: opening one collapses the other');
check(swap.fr.some(([a, b]) => a > 0 && b > 0 && a < swap.claude.h), 'agent accordion: close and open animate together');
// 펼친 칸은 테두리 대신 한 단 위의 면(`--slist-face-open`)으로 갈린다(10-19 설정 목록 통일 — 테두리는 MD3 개편 때 걷혔다)
check(swap.face !== swap.closedFace, 'agent accordion: open card sits on a raised face');
await shot('ai-accordion-swap.png');
await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(250);
await shot('ai-accordion-swap-light.png');
await ev(`document.documentElement.dataset.theme = ${JSON.stringify(prevTheme || 'dark')}`); await sleep(150);
await ev(`document.querySelector('[data-agent-expand="codex"]').click()`); await sleep(350);
check(await ev(`document.querySelector('[data-agent-expand="claude"]').getAttribute('aria-expanded') === 'false' && document.querySelector('[data-agent-expand="codex"]').getAttribute('aria-expanded') === 'true'`), 'agent accordion: only one open after switching back');
// 호버 바탕은 머리 줄 전체 — 포인터가 사용 토글 위에 있어도 머리가 hover 색, 펼침 버튼은 따로 칠하지 않는다
const hoverAt = await ev(`(() => { const r = document.getElementById('ai-enabled-claude-wrap').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: hoverAt.x, y: hoverAt.y }); await sleep(350);
const hov = await ev(`(() => { const head = document.querySelector('[data-agent="claude"] .agent-head'); return { head: getComputedStyle(head).backgroundImage, btn: getComputedStyle(document.querySelector('[data-agent-expand="claude"]')).backgroundColor, hovered: head.matches(':hover') }; })()`);
console.log('head hover', JSON.stringify(hov));
check(hov.hovered && hov.head !== 'none' && hov.btn === 'rgba(0, 0, 0, 0)', 'agent accordion: head hover state layer spans the row even over the use toggle');
await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 1, y: 1 }); await sleep(250);
await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 700, deviceScaleFactor: 1, mobile: false }); await sleep(300);
check(await ev(`(() => { const p = document.querySelector('.settings-panel'); return p.scrollWidth <= p.clientWidth && [...document.querySelectorAll('.settings-view [data-agent] .agent-head')].every((h) => h.scrollWidth <= h.clientWidth + 1); })()`), 'agent accordion: no horizontal overflow at 680px');
await shot('ai-accordion-680-open.png');
await ev(`document.querySelector('[data-agent-expand="codex"]').click()`); await sleep(350);
await shot('ai-accordion-680-collapsed.png');
await send('Emulation.setDeviceMetricsOverride', { width: 600, height: 600, deviceScaleFactor: 1, mobile: false }); await sleep(200); // 뒤 판은 작은 창 그대로 이어 간다
check(await ev(`!Array.from(document.querySelectorAll('#ai-mcp-sessions .name')).some(e=>e.textContent.trim()==='설치 상태')`), 'MCP manager has no separate installation rows');
await ev(`(async () => (await ${dockMod}).closeDock())()`);
await send('Emulation.clearDeviceMetricsOverride'); await sleep(200);
// 2026-10-18 통합 독 — 하단 호버 독은 걷혔다. 설정 단추는 독 머리 아이콘 줄에 있다(독을 알림 칸으로 열고 → 아이콘 줄의 설정 · 상태바 독 입구는 걷혔다)
await ev(`(async()=>{const e=performance.getEntriesByType('resource').map(r=>r.name).find(u=>u.includes('app/dock.svelte'));(await import(e)).openDock('alerts');})()`); await sleep(300);
// 하단 즐겨찾기 독(`data-floating-status-dock`)은 c5d1013a 에 되살아났다 — 설정 단추는 그 독이 아니라 사이드 독 머리 아이콘 줄에 있다
check(await ev(`!document.querySelector('[data-floating-status-dock] [data-dock-tool]') && !!document.querySelector('.dock .tools [data-dock-tool="settings"]')`), 'settings button lives in the dock tool row');
await shot('settings-dock.png');
check(await ev(`!document.querySelector('[data-signal="mcp"]') && !document.querySelector('.mcp-modal')`), 'separate MCP modal and bottom icon removed');
const settingsButton = await ev(`(() => { const r=document.querySelector('.dock [data-dock-tool="settings"]').getBoundingClientRect(); return {x:r.x+r.width/2,y:r.y+r.height/2}; })()`);
await send('Input.dispatchMouseEvent', { type:'mouseMoved', ...settingsButton });
await send('Input.dispatchMouseEvent', { type:'mousePressed', ...settingsButton, button:'left', clickCount:1 });
await send('Input.dispatchMouseEvent', { type:'mouseReleased', ...settingsButton, button:'left', clickCount:1 }); await sleep(350);
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === 'settings' && await ev(`document.querySelector('.settings-modal').getAttribute('aria-modal') === 'true'`), 'dock tool row opens settings');
await ev(`(async () => (await ${overlaysMod}).openSettingsAt('mcp','ai-mcp-sessions-info'))()`); await sleep(350);
check(await ev(`document.querySelector('[data-nav-tab="mcp"]').getAttribute('aria-current') === 'page' && document.querySelector('.settings-panel [data-view="pinned"] #ai-mcp-sessions-info')?.getClientRects().length > 0`), 'cold palette navigation opens the session server sub-view');
await ev(`document.querySelector('[data-nav-tab="ai"]').click()`); await sleep(100);
check(await ev(`document.querySelector('#ai-mcp-servers').getClientRects().length === 0`), 'MCP controls hidden in AI category');
await ev(`document.querySelector('[data-nav-tab="mcp"]').click()`); await sleep(100);
check(await ev(`document.querySelector('.settings-panel #ai-mcp-sessions').getClientRects().length > 0`), 'MCP menu shows server list');
await ev(`document.querySelector('.settings-modal').focus()`);
check(await ev(`(async () => (await ${keysMod}).anyModalOpen())()`), 'MCP settings blocks tile shortcuts');
await key('Tab', 8, 'Tab');
check(await ev(`document.activeElement === document.querySelector('.settings-view > .actions button:last-child')`), 'MCP Shift+Tab from container wraps to last control');
await key('Tab');
check(await ev(`document.activeElement === document.querySelector('.settings-modal .head button')`), 'MCP Tab wraps to first control');
check(await ev(`document.querySelector('#ai-mcp-sessions .scope')?.textContent.trim() === '앱 전체' && !!document.querySelector('#ai-mcp-sessions .slist-chev')`), 'pinned session server has app-wide scope and a sub-view chevron');
await ev(`document.querySelector('#ai-mcp-sessions-toggle').click()`);
await sleep(300);
const pinnedView = `document.querySelector('.settings-panel [data-view="pinned"]')`;
check(await ev(`!!${pinnedView} && ${pinnedView}.textContent.includes('http://127.0.0.1:43210/mcp') && ${pinnedView}.textContent.includes('aynx-sessions-dev') && !!document.activeElement?.closest('.sub-head')`), 'session server row opens a sub-view with status, URL and server name');
check(await ev(`!!${pinnedView}.querySelector('[data-tool-group="read"]') && !!${pinnedView}.querySelector('[data-tool-group="tile"]') && ${pinnedView}.textContent.includes('create_execution_plan') && !!${pinnedView}.querySelector('.calls-empty') && window.__calls.some(c=>c[0]==='mcp_tools') && window.__calls.some(c=>c[0]==='mcp_calls')`), 'sub-view lists tools by group and an empty recent-calls list');
check(await ev(`!document.querySelector('[id^="ai-mcp-allow-"]') && !${pinnedView}.textContent.includes('permissions.allow') && !window.__calls.some(c=>['mcp_allow_status','set_mcp_allow'].includes(c[0]))`), 'MCP permission management UI and IPC removed');
await key('Escape');
check(await ev(`!document.querySelector('[data-view="pinned"]') && document.activeElement?.id === 'ai-mcp-sessions-toggle'`), 'Escape returns from the session server sub-view to its row');
const settingsMod = importApp('settings/model/store.svelte.ts');
await ev(`document.querySelector('#ai-mcp-sessions [role="switch"]').click(); document.querySelector('#ai-mcp-sessions .mcp-agents button').click()`); await sleep(100);
check(await ev(`(async () => { const s=(await ${settingsMod}).settings; return s.current.ai.mcp_sessions_enabled===false && s.current.ai.mcp_sessions_agents.length===1 && s.current.ai.mcp_sessions_agents[0]==='codex' && s.saved.ai.mcp_sessions_enabled===undefined && !window.__calls.some(c=>['register_mcp','mcp_setup_command'].includes(c[0])); })()`), 'pinned switch and targets edit draft without registering globally');
await ev(`document.querySelector('#ai-mcp-add').click()`); await sleep(100);
check(await ev(`!!document.querySelector('.settings-panel [data-view="add"] #ai-mcp-name') && !!document.activeElement?.closest('.sub-head')`), 'add opens a sub-view (not a modal) and focuses back');
await key('Escape');
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === 'settings' && !await ev(`!!document.querySelector('#ai-mcp-name')`) && await ev(`document.activeElement?.id === 'ai-mcp-add'`), 'Escape returns to the MCP summary first and focuses add');
await ev(`document.querySelector('#ai-mcp-add').click()`); await sleep(100);
await ev(`(() => { for (const [id,value] of [['ai-mcp-name','playwright'],['ai-mcp-command','npx']]) { const input=document.getElementById(id); input.value=value; input.dispatchEvent(new Event('input',{bubbles:true})); } })()`);
await sleep(100); await ev(`document.querySelector('#ai-mcp-submit').click()`); await sleep(150);
check(await ev(`document.querySelector('.settings-panel .mcp-name:nth-child(1)') && Array.from(document.querySelectorAll('.settings-panel .mcp-open .mcp-name')).some(e=>e.textContent==='playwright')`), 'validated server added to list');
check(await ev(`document.activeElement?.matches('.mcp-open[data-index]') && document.activeElement.textContent.includes('playwright') && !!document.activeElement.closest('.mcp-row').querySelector('.mcp-edit-btn')`), 'after add the summary focuses the new row, which has an edit chevron');
const externalRow = `Array.from(document.querySelectorAll('.settings-panel .mcp-row')).find(e=>e.querySelector('.mcp-open .mcp-name')?.textContent==='playwright')`;
check(await ev(`(() => { const r=${externalRow}; return r.querySelector('[role="switch"]').checked && Array.from(r.querySelectorAll('.mcp-agents button')).every(b=>b.getAttribute('aria-pressed')==='true'); })()`), 'new server starts enabled with both targets');
await ev(`${externalRow}.querySelector('[role="switch"]').click()`); await sleep(100);
check(await ev(`(() => { const r=${externalRow}; return r.classList.contains('off') && !r.querySelector('[role="switch"]').checked && Array.from(r.querySelectorAll('.mcp-agents button')).every(b=>b.getAttribute('aria-pressed')==='true' && !b.disabled); })()`), 'disabled server keeps both targets editable');
await ev(`${externalRow}.querySelector('.mcp-agents button').click()`); await sleep(100);
check(await ev(`(async () => { const s=(await ${settingsMod}).settings.current.ai.mcp_servers[0]; return s.enabled===false && s.agents.length===1; })()`), 'target chip changes agents without enabling server');
await ev(`${externalRow}.querySelector('.mcp-open .mcp-name').click()`); await sleep(100);
check(await ev(`!document.querySelector('#ai-mcp-enabled').checked && Array.from(document.querySelectorAll('.settings-panel .agent-chips button')).filter(b=>b.getAttribute('aria-pressed')==='true').length===1`), 'dialog keeps server switch and target selection independent');
await ev(`document.querySelector('.settings-panel .agent-chips button[aria-pressed="false"]').click()`); await sleep(100);
await ev(`document.querySelector('#ai-mcp-submit').click()`); await sleep(150);
check(await ev(`(async () => { const s=(await ${settingsMod}).settings.current.ai.mcp_servers[0]; return s.enabled===false && s.agents.length===2; })()`), 'dialog target edits keep the server disabled');
await ev(`(async () => { const s=(await ${settingsMod}).settings; s.current.ai.mcp_servers[0]={...s.current.ai.mcp_servers[0],agents:undefined}; })()`); await sleep(100);
check(await ev(`(() => { const r=${externalRow}; return !r.querySelector('[role="switch"]').checked && Array.from(r.querySelectorAll('.mcp-agents button')).every(b=>b.getAttribute('aria-pressed')==='true'); })()`), 'legacy disabled server without agents displays both targets selected');
await ev(`${externalRow}.querySelector('.mcp-open .mcp-name').click()`); await sleep(100);
check(await ev(`!document.querySelector('#ai-mcp-enabled').checked && Array.from(document.querySelectorAll('.settings-panel .agent-chips button')).every(b=>b.getAttribute('aria-pressed')==='true')`), 'legacy dialog displays both targets while switch stays off');
await ev(`document.querySelector('#ai-mcp-submit').click()`); await sleep(150);
check(await ev(`(async () => { const s=(await ${settingsMod}).settings.current.ai.mcp_servers[0]; return s.enabled===false && s.agents===undefined; })()`), 'unchanged legacy form preserves omitted agents');
await ev(`${externalRow}.querySelector('[role="switch"]').click()`); await sleep(100);

await ev(`(async () => { const s=(await ${settingsMod}).settings; s.current.ai.start_dir='C:/unsaved-option'; window.__failSave=true; })()`);
await ev(`document.querySelector('.settings-view > .actions button:last-child').click()`); await sleep(150);
check(await ev(`document.querySelector('.settings-view > .error')?.textContent.includes('save failed')`), 'save failure shown and draft retained');
await ev(`window.__failSave=false; document.querySelector('.settings-view > .actions button:last-child').click()`); await sleep(150);
check(await ev(`(() => { const s=window.__calls.filter(c=>c[0]==='save_settings').at(-1)[1].settings; return s.ai.mcp_servers[0].name==='playwright' && s.ai.start_dir==='C:/unsaved-option' && s.ai.mcp_sessions_enabled===false && s.ai.mcp_sessions_agents[0]==='codex'; })()`), 'settings save includes MCP and other option drafts');
check(await ev(`(async () => { const s=(await ${settingsMod}).settings; return s.current.ai.start_dir==='C:/unsaved-option' && s.saved.ai.start_dir==='C:/unsaved-option'; })()`), 'MCP and AI drafts share saved baseline');
await shot('settings-mcp.png');
await ev(`document.querySelector('.settings-panel .mcp-open .mcp-name').click()`); await sleep(100);
await ev(`document.querySelector('.settings-panel button.del').click()`); await sleep(100);
check(await ev(`!document.querySelector('.settings-panel .mcp-open .mcp-name')`), 'server deletion edits list');
await ev(`(async () => { (await ${settingsMod}).settings.current.ai.start_dir='C:/another-draft'; (await ${settingsMod}).settings.current.ai.mcp_sessions_enabled=undefined; (await ${settingsMod}).settings.current.ai.mcp_sessions_agents=[]; })()`);
await ev(`document.querySelector('.settings-view > .actions button:first-child').click()`); await sleep(100);
check(await ev(`(async () => { const s=(await ${settingsMod}).settings; return s.current.ai.mcp_servers[0].name==='playwright' && s.current.ai.start_dir==='C:/unsaved-option' && s.current.ai.mcp_sessions_enabled===false && s.current.ai.mcp_sessions_agents[0]==='codex'; })()`), 'settings cancel restores MCP and AI drafts');
await opened();
// 범위별 PostgreSQL 등록과 비밀 값 편집. IPC 스텁의 테스트 값만 사용한다.
const inputValue = async (id, value) => { await ev(`(() => { const e=document.getElementById(${JSON.stringify(id)}); e.value=${JSON.stringify(value)}; e.dispatchEvent(new Event(e.tagName==='SELECT'?'change':'input',{bubbles:true})); })()`); await sleep(60); };
const addServer = async () => { await ev(`document.querySelector('#ai-mcp-add').click()`); await sleep(100); };
const submitServer = async () => { await ev(`document.querySelector('#ai-mcp-submit').click()`); await sleep(150); };
const editPostgres = async () => { await ev(`Array.from(document.querySelectorAll('.settings-panel .mcp-row')).find(e=>e.querySelector('.mcp-open .mcp-name')?.textContent==='postgres' && e.querySelector('.scope.project')?.textContent.trim()==='aynx').querySelector('.mcp-open .mcp-name').click()`); await sleep(100); };
await addServer();
// 범위 고르개는 앱의 `Dropdown`(10-18 — 네이티브 select 대신): 펴서 줄(`data-value`)을 본다 · 고른다
const scopeOptions = async () => ev(`(async () => { document.querySelector('#ai-mcp-form-scope').click(); await new Promise((r) => setTimeout(r, 60)); const v = [...document.querySelectorAll('#ai-mcp-form-scope-listbox [role="option"]')].map(o => o.dataset.value); document.querySelector('#ai-mcp-form-scope').closest('.dd').querySelector('.menu-backdrop')?.click(); return v.join(','); })()`);
const pickScope = async (v) => { await ev(`document.querySelector('#ai-mcp-form-scope').click()`); await sleep(60); await ev(`document.querySelector('#ai-mcp-form-scope-listbox [data-value="${v}"]').click()`); await sleep(60); };
const scopeValue = async () => ev(`document.querySelector('#ai-mcp-form-scope .cur-text').textContent.trim()`);
check(await (async () => { const v = (await scopeOptions()).split(','); return v.includes('P1') && !v.includes('P2'); })(), 'MCP dialog scope lists local registered projects');
await inputValue('ai-mcp-name','postgres'); await inputValue('ai-mcp-command','npx');
await ev(`document.querySelector('.env-add').click()`); await sleep(100);
await inputValue('ai-mcp-env-name-0','DATABASE_URL'); await inputValue('ai-mcp-env-value-0','postgres://test:global-fixture@localhost/db');
check(await ev(`document.querySelector('#ai-mcp-env-value-0').type==='password' && document.querySelector('#ai-mcp-submit').disabled`), 'environment input masked and vault storage requires consent');
await ev(`document.querySelector('.env-consent input').click()`); await sleep(60);
await submitServer();
check(await ev(`window.__calls.some(c=>c[0]==='vault_create') && window.__calls.some(c=>c[0]==='vault_store_mcp_env' && c[1].value.includes('global-fixture'))`), 'opted-in environment encrypted via vault API');
check(await ev(`(async () => { const s=(await ${settingsMod}).settings.current.ai.mcp_servers.find(s=>s.name==='postgres'); return !s.project_id && !!s.env[0].secret_ref && !JSON.stringify(s).includes('global-fixture'); })()`), 'global MCP settings contain only vault references');
await addServer();
check((await scopeValue()) !== 'aynx', 'new registration defaults to app-wide scope');
await pickScope('P1');
check((await scopeValue()) === 'aynx', 'new registration uses project scope selected in dialog');
await inputValue('ai-mcp-name','postgres'); await inputValue('ai-mcp-command','npx');
await ev(`document.querySelector('.env-add').click()`); await sleep(100);
await inputValue('ai-mcp-env-name-0','DATABASE_URL'); await inputValue('ai-mcp-env-value-0','postgres://test:project-fixture@localhost/db');
await ev(`document.querySelector('.env-consent input').click()`); await submitServer();
check(await ev(`(async () => { const all=(await ${settingsMod}).settings.current.ai.mcp_servers.filter(s=>s.name==='postgres'); return all.length===2 && all.some(s=>s.project_id==='P1') && new Set(all.map(s=>s.env[0].secret_ref)).size===2; })()`), 'same server name has independent project and global environments');
check(await ev(`(() => { const rows=Array.from(document.querySelectorAll('.settings-panel .mcp-row')).filter(e=>e.querySelector('.mcp-open .mcp-name')?.textContent==='postgres'); return rows.length===2 && rows.every(e=>e.getClientRects().length>0) && rows[0].querySelector('.scope')?.textContent.trim()==='앱 전체' && !rows[0].querySelector('.scope.project') && rows[1].querySelector('.scope.project')?.textContent.trim()==='aynx'; })()`), 'MCP list shows app-wide and project servers together with scope chips');
await ev(`document.querySelector('.settings-view > .actions button:last-child').click()`); await sleep(150);
check(await ev(`!JSON.stringify(window.__calls.filter(c=>c[0]==='save_settings').at(-1)).includes('fixture')`), 'saved settings payload never contains environment values');
await editPostgres();
check(await ev(`document.querySelector('#ai-mcp-env-value-0').value==='' && document.querySelector('#ai-mcp-env-value-0').placeholder.includes('유지')`), 'editing never returns stored environment value');
const storedBefore = await ev(`window.__calls.filter(c=>c[0]==='vault_store_mcp_env').length`);
await submitServer();
check(await ev(`window.__calls.filter(c=>c[0]==='vault_store_mcp_env').length`)===storedBefore, 'unchanged environment retains its immutable vault reference');
await editPostgres(); await inputValue('ai-mcp-env-value-0','postgres://test:replacement-fixture@localhost/db');
check(await ev(`document.querySelector('#ai-mcp-name').getClientRects().length>0 && document.querySelector('.env-consent input').getBoundingClientRect().width===14`), 'environment form and consent checkbox visibly fit the dialog');
await send('Emulation.setDeviceMetricsOverride', {width:480,height:600,deviceScaleFactor:1,mobile:false}); await sleep(100);
check(await ev(`(() => { const d=document.querySelector('.settings-panel .mcp-box'); const p=document.querySelector('.settings-panel'); const r=d.getBoundingClientRect(); return r.x>=0 && r.right<=innerWidth && d.scrollWidth<=d.clientWidth && p.scrollWidth<=p.clientWidth; })()`), 'environment form fits a small window without horizontal overflow');
await shot('settings-mcp-env-small.png');
await send('Emulation.clearDeviceMetricsOverride'); await sleep(100);
await shot('settings-mcp-env.png'); await submitServer();
check(await ev(`(async () => { const s=(await ${settingsMod}).settings; return s.current.ai.mcp_servers.find(x=>x.project_id==='P1').env[0].secret_ref!==s.saved.ai.mcp_servers.find(x=>x.project_id==='P1').env[0].secret_ref; })()`), 'replacement creates a fresh reference without overwriting saved value');
await ev(`document.querySelector('.settings-view > .actions button:first-child').click()`); await sleep(100);
check(await ev(`(async () => { const s=(await ${settingsMod}).settings; return s.current.ai.mcp_servers.find(x=>x.project_id==='P1').env[0].secret_ref===s.saved.ai.mcp_servers.find(x=>x.project_id==='P1').env[0].secret_ref; })()`), 'settings cancel restores previous environment reference');
await opened();
await editPostgres(); await inputValue('ai-mcp-env-value-0','postgres://test:locked-fixture@localhost/db');
await ev(`window.__vaultStatus={state:'locked',hasMaster:true,entryCount:2}; document.querySelector('#ai-mcp-submit').click()`); await sleep(200);
check(await ev(`(async () => (await ${importApp('app/prompts.svelte.ts')}).vaultUnlockVisible())()`), 'locked vault opens the existing unlock prompt');
await key('Escape'); await sleep(100);
check(await ev(`document.querySelector('#ai-mcp-name')?.getClientRects().length>0 && document.querySelector('.form-error')?.textContent.includes('잠금') && !window.__calls.some(c=>c[0]==='vault_store_mcp_env' && c[1].value.includes('locked-fixture'))`), 'skipping unlock keeps the draft and does not store environment values');
await key('Escape'); await ev(`window.__vaultStatus={state:'unlocked',hasMaster:false,entryCount:2}`);
await addServer(); await pickScope('P1'); await inputValue('ai-mcp-name','postgres'); await inputValue('ai-mcp-command','npx'); await submitServer();
check(await ev(`document.querySelector('#ai-mcp-name') && document.querySelector('.settings-panel .form-error')?.textContent.includes('이미')`), 'duplicate names rejected within the same scope');
await key('Escape');
await editPostgres(); await ev(`document.querySelector('.env-row button').click()`); await submitServer();
check(await ev(`(async () => !(await ${settingsMod}).settings.current.ai.mcp_servers.find(x=>x.project_id==='P1').env.length)()`), 'environment row can be removed');
await ev(`document.querySelector('.settings-view > .actions button:first-child').click()`); await sleep(100);
await opened();
// HTTP 헤더도 같은 저장 동의·새 참조 흐름을 쓴다. 하네스 전용 값만 사용한다.
await addServer(); await inputValue('ai-mcp-name','remote-headers');
await ev(`Array.from(document.querySelectorAll('.settings-panel .seg-btn')).find(b=>b.textContent==='HTTP').click()`); await sleep(100);
await inputValue('ai-mcp-url','https://example.invalid/mcp');
await ev(`document.querySelector('.env-add').click()`); await sleep(100);
await inputValue('ai-mcp-header-name-0','Authorization'); await inputValue('ai-mcp-header-value-0','Bearer header-fixture');
check(await ev(`document.querySelector('#ai-mcp-header-value-0').type==='password' && document.querySelector('#ai-mcp-submit').disabled`), 'HTTP 헤더 값은 가려지고 볼트 저장 동의가 필요하다');
await ev(`document.querySelector('.env-consent input').click()`); await submitServer();
check(await ev(`(async () => { const s=(await ${settingsMod}).settings.current.ai.mcp_servers.find(s=>s.name==='remote-headers'); return s.headers[0].name==='Authorization' && !!s.headers[0].secret_ref && !s.env && !JSON.stringify(s).includes('header-fixture'); })()`), 'HTTP 설정에는 헤더 참조만 있고 평문 값은 없다');
check(await ev(`window.__calls.some(c=>c[0]==='vault_store_mcp_env' && c[1].label==='global/remote-headers/header:Authorization' && c[1].value==='Bearer header-fixture') && Array.from(document.querySelectorAll('.mcp-row')).some(r=>r.textContent.includes('remote-headers') && r.textContent.includes('헤더 1개'))`), 'HTTP 헤더는 기존 볼트 종류에 저장하고 목록에 개수를 표시한다');
await ev(`Array.from(document.querySelectorAll('.settings-panel .mcp-open .mcp-name')).find(b=>b.textContent==='remote-headers').click()`); await sleep(100);
check(await ev(`document.querySelector('#ai-mcp-header-value-0').value==='' && document.querySelector('#ai-mcp-header-value-0').placeholder.includes('유지')`), 'HTTP 편집은 저장된 비밀 값을 돌려받지 않는다');
await submitServer();
await ev(`document.querySelector('.settings-view > .actions button:last-child').click()`); await sleep(150);
check(await ev(`!JSON.stringify(window.__calls.filter(c=>c[0]==='save_settings').at(-1)).includes('header-fixture')`), '저장 payload에 HTTP 헤더 평문 값은 없다');

await shot('settings-mcp-project.png');
await ev(`(async () => (await ${overlaysMod}).openSettingsAt('mcp','ai-mcp-sessions-calls'))()`); await sleep(300);
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === 'settings' && await ev(`document.querySelector('.settings-modal [data-view="pinned"] #ai-mcp-sessions-calls')?.getClientRects().length > 0`), 'palette MCP entry routes to the session server sub-view');
await ev(`document.querySelector('.settings-panel .sub-head .back').click()`); await sleep(150);
check(await ev(`!document.querySelector('[data-view="pinned"]') && document.activeElement?.id === 'ai-mcp-sessions-toggle'`), 'sub-view back button returns to the pinned row');
await ev(`document.querySelector('.settings-panel #ai-mcp-sessions .mcp-agents button').click()`); await sleep(150);
check(await ev(`(async () => { const s=(await ${settingsMod}).settings; return (s.current.ai.mcp_sessions_agents ?? ['claude','codex']).includes('claude') && !s.saved.ai.mcp_sessions_agents.includes('claude') && !window.__calls.some(c=>c[0]==='register_mcp'); })()`), 'pinned server chip edits only the target draft');
await key('Escape');
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === null, 'Escape closes MCP settings');
await ev(`(async () => (await ${dockMod}).openDock('settings'))()`); await sleep(100);
await ev(`document.querySelector('.settings-backdrop').click()`); await sleep(100);
check(await ev(`(async () => (await ${dockMod}).dockKind())()`) === null, 'MCP settings backdrop closes modal');
// 자동 승인 — 요약(자동 승인 줄 · 묶음 요약 + [편집 ›] · 허용 패턴 · 상한) → [편집 ›] 이 여는 '묶음 편집' 하위 화면 (2026-10-05 세분화)
await opened();
await ev(`document.querySelector('.settings-modal [data-nav-tab="automation"]').click()`); await sleep(300);
{
  const SEC = `document.querySelector('.settings-panel > section:not([hidden])')`;
  const dockOpen = async () => (await ev(`(async () => (await ${dockMod}).dockKind())()`)) === 'settings';
  const autoState = () => ev(`(async () => JSON.stringify((await ${settingsMod}).settings.current.automation))()`).then(JSON.parse);
  const sum = () => ev(`(() => { const sec = ${SEC}; const w = sec.querySelector('.warn-line'); const row = sec.querySelector('#auto-approve')?.closest('.srow'); const btn = sec.querySelector('#auto-bundles'); return JSON.stringify({ aboveRow: !!w && !!row && !w.closest('.srow') && !!(w.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING), visible: w?.getClientRects().length > 0, view: sec.querySelector('.view')?.dataset.view, summary: btn?.closest('.srow')?.querySelector('.hint')?.textContent.trim() ?? null, btn: btn?.textContent.trim() ?? null, label: document.querySelector('label[for="auto-bundles"]')?.textContent.trim() ?? null, cards: sec.querySelectorAll('.bundle-list, .bundle-pop, .bundle-card').length, allow: sec.querySelector('#auto-allow')?.tagName === 'BUTTON', allowSummary: sec.querySelector('#auto-allow')?.closest('.srow')?.querySelector('.hint')?.textContent.trim() ?? null, allowEmpty: sec.querySelector('.allow-empty')?.textContent.trim() ?? null, caps: !!sec.querySelector('#auto-max-targets'), focusAdjust: document.activeElement === btn }); })()`).then(JSON.parse);
  const sub = () => ev(`(() => { const sec = ${SEC}; const v = sec.querySelector('.view'); const rows = [...sec.querySelectorAll('.bundle-row')]; const p = document.querySelector('.settings-panel'); return JSON.stringify({ view: v?.dataset.view, focusBack: document.activeElement?.classList.contains('back') ?? false, title: sec.querySelector('.sub-title')?.textContent.trim() ?? null, back: sec.querySelector('.back')?.textContent.trim() ?? null, groups: [...sec.querySelectorAll('.group-head')].map(h => h.textContent.trim()), caution: sec.querySelector('.caution')?.textContent.trim() ?? null, cautionAfter: sec.querySelector('.caution')?.previousElementSibling?.textContent.trim() ?? null, rows: rows.map(r => r.dataset.bundle), counts: rows.map(r => r.querySelector('.row-count')?.textContent.trim()), expanded: rows.map(r => r.querySelector('.exp')?.getAttribute('aria-expanded')), switches: rows.map(r => r.querySelector('.row-main input[role="switch"]')?.getAttribute('aria-label')), anim: v ? getComputedStyle(v).animationName : null, running: v ? v.getAnimations().length : -1, overflow: p.scrollWidth > p.clientWidth + 1, result: sec.querySelector('.tester-result')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, verdict: sec.querySelector('.tester-result')?.dataset.verdict ?? null, off: !!sec.querySelector('.tester-off') }); })()`).then(JSON.parse);
  const row = (id) => `${SEC}.querySelector('.bundle-row[data-bundle="${id}"]')`;
  const typeTest = async (text) => { await ev(`(() => { const i = ${SEC}.querySelector('.tester-input'); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(500); };
  const lastTest = () => ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'test_auto_approval').at(-1)?.[1] ?? null)`).then(JSON.parse);

  // ── 요약 ──
  const s0 = await sum();
  console.log('automation summary', JSON.stringify(s0));
  // 경고 각주는 섹션 머리(한 줄 설명 밑)에 서고 켜기 스위치 줄은 그 아래 따로 선다(83024e5a 설정 섹션 머리 정리)
  check(s0.aboveRow && s0.visible, `danger note sits in the section head above the auto-approve row (${JSON.stringify(s0)})`);
  check(s0.view === 'summary' && s0.summary === '10개 중 0개 켜짐 · 규칙 0줄' && /편집/.test(s0.btn ?? '') && s0.label === '묶음', `summary row: "10개 중 N개 켜짐 · 규칙 M줄" + [편집 ›] (${s0.summary} | ${s0.btn} | ${s0.label})`);
  check(s0.cards === 0 && s0.allow && s0.caps, 'summary has no bundle cards or popup; allow-pattern [편집] button and caps stay');
  check(s0.allowSummary === '규칙 0개 · 간단 패턴 0개' && /아무 명령도 자동 승인되지 않습니다/.test(s0.allowEmpty ?? ''), `allow summary row with empty-state note (${s0.allowSummary} | ${s0.allowEmpty})`);
  await shot('settings-automation.png');

  // ── [편집 ›] → 하위 화면이 오른쪽에서 미끄러져 들어온다 ──
  await ev(`document.querySelector('#auto-bundles').click()`); await sleep(40);
  let g = await sub();
  check(g.view === 'bundles' && /sub-view-in-fwd/.test(g.anim ?? '') && g.running === 1, `adjust slides the sub-view in (fwd) (${g.view} ${g.anim} running=${g.running})`);
  await sleep(300);
  g = await sub();
  console.log('automation sub', JSON.stringify(g));
  check(g.running === 0 && g.focusBack && g.back === '자동 승인' && g.title === '묶음 편집', `sub-view settled: ‹ 자동 승인 has focus, title 묶음 편집 (${g.focusBack} ${g.back} ${g.title})`);
  check(JSON.stringify(g.groups) === JSON.stringify(['서버 상태', '데이터 읽기', '네트워크·인프라', '개발']), `four subheads (${g.groups})`);
  check(g.caution === '비밀 파일·로그 내용이 보일 수 있습니다' && g.cautionAfter === '데이터 읽기', `data-reads subhead carries the caution (${g.caution} after ${g.cautionAfter})`);
  check(JSON.stringify(g.rows) === JSON.stringify(['system', 'services', 'pkg', 'files', 'logs', 'network', 'docker', 'k8s', 'git', 'gitfetch']), `ten bundle rows in table order (${g.rows})`);
  check(g.counts.every(c => /^켜진 명령 (\d+)\/\1$/.test(c ?? '')) && g.expanded.every(e => e === 'false') && g.switches.every(l => / 사용$/.test(l ?? '')), `rows: count n/n · collapsed · labelled switch (${g.counts.slice(0, 3)} ${g.switches.slice(0, 2)})`);
  check(!g.overflow, 'no horizontal scroll in the settings body');

  // ── 묶음 스위치 · 펼침 · 명령 스위치 ──
  await ev(`${row('files')}.querySelector('.row-main input[role="switch"]').click()`); await sleep(120);
  let a = await autoState();
  check(a.bundles.includes('files') && await ev(`${row('files')}.classList.contains('on')`), 'bundle switch turns the bundle on (draft)');
  await ev(`${row('files')}.querySelector('.exp').click()`); await sleep(150);
  const cmds = await ev(`(() => { const r = ${row('files')}; const id = r.querySelector('.exp').getAttribute('aria-controls'); const list = document.getElementById(id); return JSON.stringify({ expanded: r.querySelector('.exp').getAttribute('aria-expanded'), list: !!list && r.contains(list), keys: [...r.querySelectorAll('.cmd-row')].map(c => c.dataset.key), tail: r.querySelector('.cmd-row[data-key="tail"] .cmd-cons')?.textContent.trim() ?? null, mono: getComputedStyle(r.querySelector('.cmd-name')).fontFamily, switches: r.querySelectorAll('.cmd-row input[role="switch"]').length }); })()`).then(JSON.parse);
  console.log('files commands', JSON.stringify(cmds));
  check(cmds.expanded === 'true' && cmds.list && cmds.keys.length === 14 && cmds.keys[0] === 'ls' && cmds.keys.includes('cat') && cmds.switches === 14, `expanding lists each command with its own switch (${cmds.keys.join(',')})`);
  check(/^-f · -F · --follow\* 제외$/.test(cmds.tail ?? '') && /mono|Consol|Cascadia|Mono/i.test(cmds.mono), `command rows show the constraint in dim text, name in mono (${cmds.tail} | ${cmds.mono})`);
  await shot('settings-automation-bundles.png');
  await ev(`${row('files')}.querySelector('.cmd-row[data-key="cat"] input[role="switch"]').click()`); await sleep(120);
  a = await autoState();
  check(JSON.stringify(a.bundle_off) === JSON.stringify({ files: ['cat'] }) && await ev(`${row('files')}.querySelector('.row-count').textContent.trim()`) === '켜진 명령 13/14', `command switch writes bundle_off and the count follows (${JSON.stringify(a.bundle_off)})`);

  // ── 시험 칸 — 초안을 Rust 에 묻는다(스텁). 스위치를 바꾸면 결과도 바뀐다. ──
  await typeTest('cat /etc/hosts');
  g = await sub();
  let call = await lastTest();
  check(call?.command === 'cat /etc/hosts' && JSON.stringify(call?.automation?.bundle_off) === JSON.stringify({ files: ['cat'] }) && call?.automation?.bundles?.includes('files'), `test box sends the command with the unsaved draft (${JSON.stringify(call?.automation?.bundle_off)})`);
  check(g.verdict === 'manual' && /사람 승인/.test(g.result ?? '') && /묶음 ‘파일 읽기’에서 cat 를 꺼 둠/.test(g.result ?? '') && g.off, `result: needs approval because cat is off; switch-off note shown (${g.result})`);
  await ev(`${row('files')}.querySelector('.cmd-row[data-key="cat"] input[role="switch"]').click()`); await sleep(500);
  g = await sub();
  check(g.verdict === 'auto' && /자동 승인/.test(g.result ?? '') && /묶음 ‘파일 읽기’ · cat/.test(g.result ?? ''), `turning cat back on re-asks and flips the result (${g.result})`);
  await typeTest('tail -f /var/log/syslog');
  g = await sub();
  check(g.verdict === 'manual' && /묶음 ‘파일 읽기’ · tail: -f 금지/.test(g.result ?? ''), `constraint reason names the bundle and the flag (${g.result})`);
  await ev(`[...${SEC}.querySelectorAll('.example')].find(b => b.textContent.includes('|')).click()`); await sleep(500);
  g = await sub();
  check(g.verdict === 'excluded' && /항상 제외/.test(g.result ?? '') && /파이프/.test(g.result ?? '') && await ev(`${SEC}.querySelector('.tester-input').value`) === 'ls | grep conf', `example chip fills the box; pipe → always excluded (${g.result})`);
  await ev(`${row('files')}.querySelector('.cmd-row[data-key="cat"] input[role="switch"]').click()`); await sleep(120); // 다시 끔 — 저장 페이로드 확인용
  await typeTest('cat /etc/hosts');
  await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  await ev(`${SEC}.querySelector('.tester').scrollIntoView({ block: 'start' })`); await sleep(100);
  check(!(await sub()).overflow, 'no horizontal scroll at 680px');
  await shot('settings-automation-test-680.png');
  await ev(`${row('files')}.scrollIntoView({ block: 'start' })`); await sleep(100);
  await shot('settings-automation-bundles-680.png');

  // ── Escape: 하위 화면 → 요약(모달 그대로, [편집 ›] 에 포커스, 반대 방향) → 한 번 더면 모달 닫힘 ──
  await key('Escape'); await sleep(40);
  const back = await ev(`(() => { const v = ${SEC}.querySelector('.view'); return JSON.stringify({ view: v.dataset.view, anim: getComputedStyle(v).animationName, back: v.classList.contains('enter-back') }); })()`).then(JSON.parse);
  await sleep(300);
  let s1 = await sum();
  check(back.view === 'summary' && back.back && /sub-view-in-back/.test(back.anim) && await dockOpen() && s1.focusAdjust, `Escape returns to the summary (slides back), modal stays, focus on [편집] (${JSON.stringify(back)} focus=${s1.focusAdjust})`);
  check(s1.summary === '10개 중 1개 켜짐 · 규칙 13줄', `summary counts follow the draft (${s1.summary})`);
  await shot('settings-automation-680-summary.png');
  await send('Emulation.clearDeviceMetricsOverride'); await sleep(300);
  await key('Escape'); await sleep(150);
  check(!(await dockOpen()), 'a second Escape closes the settings modal as before');

  // ── 다시 열기 · 뒤로 가기 단추 · 섹션 떠나면 요약으로 ──
  await opened();
  await ev(`document.querySelector('.settings-modal [data-nav-tab="automation"]').click()`); await sleep(300);
  check((await sum()).view === 'summary', 'reopening starts at the summary');
  await ev(`document.querySelector('#auto-bundles').click()`); await sleep(300);
  await ev(`${SEC}.querySelector('.back').click()`); await sleep(300);
  s1 = await sum();
  check(s1.view === 'summary' && s1.focusAdjust, `‹ 자동 승인 returns to the summary with focus on [편집] (${s1.view} ${s1.focusAdjust})`);
  await ev(`document.querySelector('#auto-bundles').click()`); await sleep(300);
  await ev(`document.querySelector('.settings-modal [data-nav-tab="general"]').click()`); await sleep(150);
  await ev(`document.querySelector('.settings-modal [data-nav-tab="automation"]').click()`); await sleep(200);
  check((await sum()).view === 'summary', 'leaving the section returns to the summary');

  // ── reduced motion — 즉시 바뀐다 ──
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await sleep(100);
  await ev(`document.querySelector('#auto-bundles').click()`); await sleep(30);
  g = await sub();
  check(g.view === 'bundles' && g.anim === 'none' && g.running === 0, `reduced motion: no slide (${g.anim} running=${g.running})`);
  await send('Emulation.setEmulatedMedia', { features: [] }); await sleep(100);
  await key('Escape'); await sleep(300);

  // ── 저장 페이로드 — 끈 명령이 실린다 ──
  await ev(`document.querySelector('.settings-view > .actions .btn-primary').click()`); await sleep(300);
  const saved = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'save_settings').at(-1)?.[1]?.settings?.automation ?? null)`).then(JSON.parse);
  check(saved?.bundles?.includes('files') && JSON.stringify(saved?.bundle_off) === JSON.stringify({ files: ['cat'] }), `save payload carries bundles and bundle_off (${JSON.stringify(saved?.bundle_off)})`);
  // 펼친 하위 화면 · 다크/라이트 캡처(넓은 창)
  await ev(`document.querySelector('#auto-bundles').click()`); await sleep(300);
  await ev(`${row('files')}.querySelector('.exp').click()`); await sleep(150);
  await typeTest('tail -f /var/log/syslog');
  const prevTheme2 = await ev(`document.documentElement.dataset.theme ?? ''`);
  await ev(`document.documentElement.dataset.theme = 'dark'`); await sleep(150);
  await shot('settings-automation-sub-dark.png');
  await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(150);
  await shot('settings-automation-sub-light.png');
  await ev(`document.documentElement.dataset.theme = ${JSON.stringify(prevTheme2 || 'dark')}`); await sleep(150);
  await key('Escape'); await sleep(300);
}
await ev(`document.querySelector('.settings-view > .actions button:first-child').click()`); await sleep(100);
await key('Escape');

// ── 자동 승인 › 허용 패턴 편집 (2단계 — 요약 [편집 ›] → 하위 화면: 시험 칸 · 규칙 목록 · 폼) ──
await opened();
await ev(`document.querySelector('.settings-modal [data-nav-tab="automation"]').click()`); await sleep(300);
{
  const SEC = `document.querySelector('.settings-panel > section:not([hidden])')`;
  const dockOpen = async () => (await ev(`(async () => (await ${dockMod}).dockKind())()`)) === 'settings';
  const autoState = () => ev(`(async () => JSON.stringify((await ${settingsMod}).settings.current.automation))()`).then(JSON.parse);
  // 옛 모양 규칙 둘(손으로 적은 파일 · 배우기가 더한 것) + 간단 패턴 하나를 초안에 깐다
  const OLD_GIT = { exec: 'git', subcommands: ['branch', 'status'] };
  await ev(`(async () => { const a = (await ${settingsMod}).settings.current.automation; a.allow = [${JSON.stringify(OLD_GIT)}, { exec: 'journalctl', subcommands: [], deny_flags: ['--vacuum-*'] }]; a.allow_patterns = ['df']; })()`); await sleep(150);
  const sumA = () => ev(`(() => { const sec = ${SEC}; const b = sec.querySelector('#auto-allow'); return JSON.stringify({ view: sec.querySelector('.view')?.dataset.view, summary: b?.closest('.srow')?.querySelector('.hint')?.textContent.trim() ?? null, btn: b?.textContent.trim() ?? null, label: document.querySelector('label[for="auto-allow"]')?.textContent.trim() ?? null, empty: !!sec.querySelector('.allow-empty'), focus: document.activeElement === b }); })()`).then(JSON.parse);
  const subA = () => ev(`(() => { const sec = ${SEC}; const v = sec.querySelector('.view'); const f = sec.querySelector('.rule-form'); const val = (k) => f?.querySelector('[data-field="' + k + '"] input.value')?.value ?? null; const p = document.querySelector('.settings-panel'); return JSON.stringify({ view: v?.dataset.view, anim: v ? getComputedStyle(v).animationName : null, running: v ? v.getAnimations().length : -1, title: sec.querySelector('.sub-title')?.textContent.trim() ?? null, focusBack: document.activeElement?.classList.contains('back') ?? false, tester: !!sec.querySelector('.tester-input'), rows: [...sec.querySelectorAll('.allow-row')].map(r => ({ kind: r.dataset.kind, cmd: r.querySelector('.row-cmd')?.textContent.trim() ?? null, sum: r.querySelector('.row-sum')?.textContent.trim() ?? null, cur: r.getAttribute('aria-current') === 'true' || r.classList.contains('sel') })), form: f?.dataset.form ?? null, formTitle: f?.querySelector('.form-title')?.textContent.trim() ?? null, exec: val('exec'), subs: val('subcommands'), deny: val('deny_flags'), subFirst: f?.querySelector('[data-field="sub_first"] input[role="switch"]')?.checked ?? null, subFirstDisabled: f?.querySelector('[data-field="sub_first"] input[role="switch"]')?.disabled ?? null, errs: [...(f?.querySelectorAll('.field-err') ?? [])].map(e => e.textContent.trim()), notes: [...(f?.querySelectorAll('.note') ?? [])].map(n => n.dataset.note), preview: f?.querySelector('.preview')?.textContent.replace(/\s+/g, ' ').trim() ?? null, commitDisabled: f?.querySelector('.commit')?.disabled ?? null, tips: [...(f?.querySelectorAll('.ff > .name.has-tip') ?? [])].map(n => !!n.getAttribute('title')), result: sec.querySelector('.tester-result')?.textContent.replace(/\s+/g, ' ').trim() ?? null, verdict: sec.querySelector('.tester-result')?.dataset.verdict ?? null, overflow: p.scrollWidth > p.clientWidth + 1 }); })()`).then(JSON.parse);
  const field = async (k, v) => { await ev(`(() => { const i = ${SEC}.querySelector('.rule-form [data-field="${k}"] input.value'); i.focus(); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(120); };
  const typeTest = async (text) => { await ev(`(() => { const i = ${SEC}.querySelector('.tester-input'); i.focus(); i.value = ${JSON.stringify(text)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(500); };
  const clickRow = async (kind, i) => { await ev(`${SEC}.querySelector('.allow-row[data-kind="${kind}"][data-index="${i}"]').click()`); await sleep(150); };

  // ── 요약 ──
  let s = await sumA();
  console.log('allow summary', JSON.stringify(s));
  check(s.view === 'summary' && s.summary === '규칙 2개 · 간단 패턴 1개' && /편집/.test(s.btn ?? '') && s.label === '허용 패턴' && !s.empty, `allow summary: "규칙 N개 · 간단 패턴 M개" + [편집 ›], no empty note (${JSON.stringify(s)})`);
  await shot('settings-allow-summary.png');

  // ── [편집 ›] → 미끄러져 들어온다 ──
  await ev(`document.querySelector('#auto-allow').click()`); await sleep(40);
  let g = await subA();
  check(g.view === 'allow' && /sub-view-in-fwd/.test(g.anim ?? '') && g.running === 1, `[편집] slides the allow editor in (${g.view} ${g.anim} ${g.running})`);
  await sleep(300);
  g = await subA();
  console.log('allow sub', JSON.stringify(g));
  check(g.running === 0 && g.focusBack && g.title === '허용 패턴 편집' && g.tester, `editor settled: back focused, title, shared tester (${g.focusBack} ${g.title} ${g.tester})`);
  check(JSON.stringify(g.rows.map(r => r.kind)) === JSON.stringify(['rule', 'rule', 'pattern']) && g.rows[0].cmd === 'git' && /branch · status 만/.test(g.rows[0].sum) && /하위 명령 앞 플래그 허용/.test(g.rows[0].sum) && g.rows[1].cmd === 'journalctl' && /--vacuum-\* 제외/.test(g.rows[1].sum) && g.rows[2].cmd === 'df' && g.form === null, `list: rules then simple patterns with dim summaries, nothing selected (${JSON.stringify(g.rows)})`);
  check(!g.overflow, 'allow editor: no horizontal scroll');

  // ── 옛 규칙 고르기 — sub_first 꺼진 채로 보인다 ──
  await clickRow('rule', 0);
  g = await subA();
  check(g.form === 'rule' && g.formTitle === '규칙 편집' && g.exec === 'git' && g.subs === 'branch, status' && g.subFirst === false && g.rows[0].cur && g.tips.length === 8 && g.tips.every(Boolean), `old rule loads with sub_first off; every field has a tooltip name (${g.exec} | ${g.subs} | sf=${g.subFirst} | tips=${g.tips.length})`);

  // ── 다른 규칙을 고쳐도 옛 규칙은 글자 그대로 ──
  await clickRow('rule', 1);
  await typeTest('journalctl -f');
  g = await subA();
  check(g.verdict === 'auto' && /사용자 규칙 ‘journalctl’/.test(g.result ?? ''), `tester before edit: journalctl -f auto by the user rule (${g.result})`);
  await field('deny_flags', '-f, --vacuum-*');
  await sleep(500);
  let a = await autoState();
  g = await subA();
  check(JSON.stringify(a.allow[1]) === JSON.stringify({ exec: 'journalctl', subcommands: [], deny_flags: ['-f', '--vacuum-*'] }) && JSON.stringify(a.allow[0]) === JSON.stringify(OLD_GIT), `editing writes only that rule; the old rule keeps its exact shape (${JSON.stringify(a.allow)})`);
  check(g.verdict === 'manual' && /규칙 ‘journalctl’: -f 금지/.test(g.result ?? ''), `form edit changes the tester verdict (${g.result})`);
  check(/journalctl/.test(g.preview ?? '') && /-f · --vacuum-\* 제외/.test(g.preview ?? '') && /-f · --vacuum-\* 제외/.test(g.rows[1].sum), `preview and list row show the new constraint (${g.preview} | ${g.rows[1].sum})`);

  // ── 검증 — 틀린 금지 항목은 칸 아래 한 줄, 초안에 안 쓴다 ──
  await field('deny_flags', '-f, follow');
  g = await subA();
  a = await autoState();
  check(g.errs.length === 1 && /‘follow’ — 금지 플래그는 - 로 시작하고/.test(g.errs[0]) && g.notes.includes('invalid') && JSON.stringify(a.allow[1].deny_flags) === JSON.stringify(['-f', '--vacuum-*']), `bad deny item: error line + not applied (${g.errs} | ${JSON.stringify(a.allow[1].deny_flags)})`);
  await field('exec', 'journal ctl');
  g = await subA();
  check(g.errs.some(e => /공백/.test(e)), `exec with a space is rejected (${g.errs})`);
  await field('exec', 'journalctl');
  await field('deny_flags', '-f, --vacuum-*');
  g = await subA();
  check(g.errs.length === 0 && !g.notes.includes('invalid'), 'fixing the fields clears the errors');
  await shot('settings-allow-form.png');

  // ── 새 규칙 — [추가] 를 눌러야 들어간다 · exec 만이면 넓다는 경고 ──
  await ev(`${SEC}.querySelector('.add-rule').click()`); await sleep(150);
  g = await subA();
  a = await autoState();
  check(g.form === 'new-rule' && g.formTitle === '새 규칙' && g.rows.some(r => r.kind === 'new-rule') && g.commitDisabled === true && g.subFirst === true && g.subFirstDisabled === true && a.allow.length === 2, `[+ 규칙]: empty form (sub_first on, disabled until subcommands), ghost row, Add disabled (${JSON.stringify({ f: g.form, c: g.commitDisabled, sf: g.subFirst })})`);
  check(await ev(`document.activeElement === ${SEC}.querySelector('.rule-form [data-field="exec"] input')`), 'new rule focuses the command field');
  await field('exec', 'uptime');
  g = await subA();
  a = await autoState();
  check(g.notes.includes('wide') && g.commitDisabled === false && a.allow.length === 2, `exec-only rule warns "전부 자동 승인" and is not in the draft until Add (${g.notes} | ${a.allow.length})`);
  await shot('settings-allow-wide.png');
  await ev(`${SEC}.querySelector('.rule-form .commit').click()`); await sleep(200);
  g = await subA();
  a = await autoState();
  check(JSON.stringify(a.allow[2]) === JSON.stringify({ exec: 'uptime', subcommands: [] }) && g.form === 'rule' && g.rows.find(r => r.kind === 'rule' && r.cmd === 'uptime')?.cur, `Add appends the rule and selects it (${JSON.stringify(a.allow[2])})`);

  // ── 위험 명령 안내 · 삭제 ──
  await field('exec', 'rm');
  g = await subA();
  check(g.notes.includes('danger') && !g.notes.includes('wide'), `dangerous exec shows "always excluded" note (${g.notes})`);
  await ev(`${SEC}.querySelector('.rule-form .del').click()`); await sleep(200);
  g = await subA();
  a = await autoState();
  check(a.allow.length === 2 && !a.allow.some(r => r.exec === 'rm') && g.form === null && await ev(`document.activeElement === ${SEC}.querySelector('.add-rule')`), `Delete removes the rule, clears the form, focus to [+ 규칙] (${a.allow.length})`);

  // ── 하위 명령 있는 새 규칙 — sub_first 가 실린다 ──
  await ev(`${SEC}.querySelector('.add-rule').click()`); await sleep(150);
  await field('exec', 'kubectl');
  await field('subcommands', 'get');
  await field('deny_flags', '-w, --watch*');
  g = await subA();
  check(g.subFirst === true && g.subFirstDisabled === false && /kubectl get/.test(g.preview ?? '') && !g.notes.includes('wide'), `subcommand rule: sub_first enabled+on, preview "kubectl get" (${g.preview})`);
  await ev(`(() => { const f = ${SEC}.querySelector('.rule-form'); f.querySelector('[data-field="exec"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`); await sleep(200);
  a = await autoState();
  check(JSON.stringify(a.allow[2]) === JSON.stringify({ exec: 'kubectl', subcommands: ['get'], deny_flags: ['-w', '--watch*'], sub_first: true }), `Enter adds the new rule with sub_first (${JSON.stringify(a.allow[2])})`);

  // ── 간단 패턴 — 중복은 막고, [추가] · 그 자리 편집 ──
  await ev(`${SEC}.querySelector('.add-pattern').click()`); await sleep(150);
  await ev(`(() => { const i = ${SEC}.querySelector('.rule-form [data-field="pattern"] input'); i.value = 'df'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(120);
  g = await subA();
  check(g.form === 'new-pattern' && g.errs.some(e => /이미 있는 패턴/.test(e)) && g.commitDisabled === true, `duplicate simple pattern is refused (${g.errs})`);
  await ev(`(() => { const i = ${SEC}.querySelector('.rule-form [data-field="pattern"] input'); i.value = 'uptime -p'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(120);
  await ev(`${SEC}.querySelector('.rule-form .commit').click()`); await sleep(200);
  a = await autoState();
  check(JSON.stringify(a.allow_patterns) === JSON.stringify(['df', 'uptime -p']), `new simple pattern added (${a.allow_patterns})`);
  await clickRow('pattern', 0);
  await ev(`(() => { const i = ${SEC}.querySelector('.rule-form [data-field="pattern"] input'); i.value = 'df -h'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150);
  a = await autoState();
  g = await subA();
  check(JSON.stringify(a.allow_patterns) === JSON.stringify(['df -h', 'uptime -p']) && g.rows.filter(r => r.kind === 'pattern').map(r => r.cmd).join(',') === 'df -h,uptime -p', `editing a simple pattern writes in place (${a.allow_patterns})`);

  // ── "승인하면서 배우기" 가 더한 규칙도 목록에 선다 ──
  await ev(`(async () => (await ${importApp('settings/model/actions-automation.ts')}).addAllowRules([{ exec: 'free', subcommands: [] }]))()`); await sleep(150);
  g = await subA();
  check(g.rows.some(r => r.kind === 'rule' && r.cmd === 'free' && /인자 제한 없음/.test(r.sum)), `rules added by learn-while-approving show up in the list (${g.rows.map(r => r.cmd)})`);

  // ── 680px · 다크/라이트 ──
  await clickRow('rule', 1);
  await typeTest('journalctl -f');
  await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  await ev(`${SEC}.querySelector('.rule-form').scrollIntoView({ block: 'start' })`); await sleep(100);
  check(!(await subA()).overflow, 'allow editor: no horizontal scroll at 680px');
  await shot('settings-allow-form-680.png');
  await ev(`${SEC}.querySelector('.allow-rows').scrollIntoView({ block: 'start' })`); await sleep(100);
  await shot('settings-allow-list-680.png');
  await send('Emulation.clearDeviceMetricsOverride'); await sleep(300);
  const prevTheme = await ev(`document.documentElement.dataset.theme ?? ''`);
  await ev(`${SEC}.querySelector('.tester').scrollIntoView({ block: 'start' })`); await sleep(100);
  await ev(`document.documentElement.dataset.theme = 'dark'`); await sleep(150);
  await shot('settings-allow-dark.png');
  await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(150);
  await shot('settings-allow-light.png');
  await ev(`${SEC}.querySelector('.add-rule').click()`); await sleep(150);
  await field('exec', 'uptime');
  await ev(`${SEC}.querySelector('.rule-form').scrollIntoView({ block: 'start' })`); await sleep(100);
  await shot('settings-allow-wide-light.png');
  await ev(`document.documentElement.dataset.theme = ${JSON.stringify(prevTheme || 'dark')}`); await sleep(150);
  await ev(`${SEC}.querySelector('.rule-form .discard').click()`); await sleep(150);

  // ── Escape 두 단계 — 첫 번째는 요약으로([편집 ›] 에 포커스), 두 번째는 모달 ──
  await ev(`${SEC}.querySelector('.rule-form, .allow-rows')?.querySelector('input, button')?.focus()`);
  await key('Escape'); await sleep(350);
  s = await sumA();
  check(s.view === 'summary' && await dockOpen() && s.focus && s.summary === '규칙 4개 · 간단 패턴 2개', `Escape returns to the summary, focus on [편집], counts follow the draft (${JSON.stringify(s)})`);
  await shot('settings-allow-summary-after.png');

  // ── 저장 페이로드 — allow 칸 ──
  await ev(`document.querySelector('.settings-view > .actions .btn-primary').click()`); await sleep(300);
  const saved = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'save_settings').at(-1)?.[1]?.settings?.automation ?? null)`).then(JSON.parse);
  check(JSON.stringify(saved?.allow) === JSON.stringify([OLD_GIT, { exec: 'journalctl', subcommands: [], deny_flags: ['-f', '--vacuum-*'] }, { exec: 'kubectl', subcommands: ['get'], deny_flags: ['-w', '--watch*'], sub_first: true }, { exec: 'free', subcommands: [] }]) && JSON.stringify(saved?.allow_patterns) === JSON.stringify(['df -h', 'uptime -p']), `save payload carries the allow rules (old shape intact) and patterns (${JSON.stringify(saved?.allow)} | ${JSON.stringify(saved?.allow_patterns)})`);
  await key('Escape'); await sleep(150);
  check(!(await dockOpen()), 'second Escape closes the settings modal');
}

// ── 트리거 — 요약(목록 + [트리거 추가 ›]) ↔ 추가 · 편집 하위 화면(예시 카드 · 규칙 칸 · 시험 칸) (2026-10-05) ──
await opened();
await ev(`document.querySelector('.settings-modal [data-nav-tab="triggers"]').click()`); await sleep(300);
{
  const SEC = `document.querySelector('.settings-panel > section:not([hidden])')`;
  const dockOpen = async () => (await ev(`(async () => (await ${dockMod}).dockKind())()`)) === 'settings';
  const trg = () => ev(`(async () => JSON.stringify((await ${settingsMod}).settings.current.triggers))()`).then(JSON.parse);
  const view = () => ev(`(() => { const sec = ${SEC}; const v = sec.querySelector('.view'); const p = document.querySelector('.settings-panel'); return JSON.stringify({ view: v?.dataset.view, anim: v ? getComputedStyle(v).animationName : null, running: v?.getAnimations().filter(a => a.playState === 'running').length ?? 0, back: sec.querySelector('.sub-head .back')?.textContent.trim() ?? null, focusBack: document.activeElement === sec.querySelector('.sub-head .back'), title: sec.querySelector('.sub-title')?.textContent.trim() ?? null, cards: sec.querySelectorAll('.ex-card').length, added: [...sec.querySelectorAll('.ex-card [data-added]')].map(x => x.closest('.ex-card').dataset.example), rows: sec.querySelectorAll('.trg-open').length, focusAdd: document.activeElement?.id === 'trg-add', focusRow: document.activeElement?.classList.contains('trg-open') ? document.activeElement.dataset.index : null, del: !!sec.querySelector('.form-actions .del'), commit: sec.querySelector('.form-actions .commit')?.textContent.trim() ?? null, commitDisabled: sec.querySelector('.form-actions .commit')?.disabled ?? null, overflow: p.scrollWidth > p.clientWidth }); })()`).then(JSON.parse);
  const setField = async (field, value) => { await ev(`(() => { const i = ${SEC}.querySelector('.ff[data-field="${field}"] input.value'); i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150); };
  const tester = () => ev(`(() => { const sec = ${SEC}; return JSON.stringify({ text: sec.querySelector('[data-trigger-tester] textarea')?.value ?? null, sum: sec.querySelector('.tester-sum')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, hits: [...sec.querySelectorAll('[data-trigger-test-out] .hit')].map(h => ({ t: h.textContent, bg: getComputedStyle(h).backgroundColor, tip: h.getAttribute('title') })), url: sec.querySelector('.details .d-url')?.textContent ?? null, tip: sec.querySelector('.details .d-tip')?.textContent ?? null, err: sec.querySelector('.field-err')?.textContent.trim() ?? null }); })()`).then(JSON.parse);
  const RUST = String.raw`\b(E\d{4})\b`;
  const CVE = String.raw`\bCVE-\d{4}-\d{4,}\b`;

  // ── 요약 ──
  const before = await trg();
  let v = await view();
  console.log('triggers summary', JSON.stringify(v));
  check(v.view === 'summary' && v.rows === before.length && (before.length > 0 || await ev(`!!${SEC}.querySelector('.trg-empty')`)) && await ev(`!!document.querySelector('#trg-add')`), `summary: one row per trigger (or the empty note) + [트리거 추가 ›] (${v.rows}/${before.length})`);
  check(await ev(`!${SEC}.querySelector('input.value') && !${SEC}.querySelector('.ex-pop') && ${SEC}.querySelectorAll('.trg-li input[role="switch"]').length === ${before.length}`), 'summary rows keep only the switch (no inline fields, no picker popup)');
  check(await ev(`[...${SEC}.querySelectorAll('.trg-li')].every(li => !!li.querySelector('.slist-trail .slist-chev'))`), 'each row ends with a chevron ›');
  await shot('settings-triggers.png');

  // ── [트리거 추가 ›] → 추가 화면이 미끄러져 들어온다 ──
  await ev(`document.querySelector('#trg-add').click()`); await sleep(40);
  v = await view();
  check(v.view === 'add' && /sub-view-in-fwd/.test(v.anim ?? '') && v.running === 1, `add slides in (fwd) (${v.view} ${v.anim} ${v.running})`);
  await sleep(300);
  v = await view();
  check(v.focusBack && v.back === '트리거' && v.title === '트리거 추가' && v.cards === 15 && !v.del && v.commit === '추가', `add view: ‹ 트리거 focused, title, blank + 14 cards, no delete (${JSON.stringify(v)})`);
  check(v.commitDisabled === true, 'blank form: [추가] disabled until a pattern is written');
  check(!v.overflow, 'no horizontal scroll in the add view');

  // ── 예시 카드 → 규칙 칸 · 시험 칸이 채워진다 ──
  await ev(`${SEC}.querySelector('.ex-card[data-example="rust"]').click()`); await sleep(200);
  let tt = await tester();
  console.log('rust tester', JSON.stringify(tt));
  check(await ev(`${SEC}.querySelector('.ff[data-field="pattern"] input').value`) === RUST && await ev(`${SEC}.querySelector('.ff[data-field="url"] input').value`) === 'https://doc.rust-lang.org/error_codes/$1.html', 'picking the Rust card fills pattern and link');
  check(tt.text === 'error[E0308]: mismatched types' && tt.hits.length === 1 && tt.hits[0].t === 'E0308' && tt.url === 'https://doc.rust-lang.org/error_codes/E0308.html' && tt.tip === 'Rust error E0308 — Ctrl+click to open the explanation', `tester: sample line, one hit, expanded link + English tooltip (${JSON.stringify(tt)})`);
  await shot('settings-triggers-add-rust.png');
  await ev(`${SEC}.querySelector('.ex-card[data-example="http5xx"]').click()`); await sleep(200);
  tt = await tester();
  check(tt.hits.length === 1 && tt.hits[0].t === 'HTTP/1.1 503' && /rgba\(122, 38, 55, 0\.45\)/.test(tt.hits[0].bg) && tt.tip === 'Server error 503', `5xx card: translucent background like the terminal + tooltip (${JSON.stringify(tt.hits)} ${tt.tip})`);
  // 시험 칸에 여러 줄
  await ev(`(() => { const a = ${SEC}.querySelector('[data-trigger-tester] textarea'); a.value = ['HTTP/1.1 500 x', 'ok', 'HTTP/2 502'].join(String.fromCharCode(10)); a.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150);
  tt = await tester();
  check(tt.hits.length === 2 && /2/.test(tt.sum ?? ''), `multi-line test: two hits (${tt.sum})`);
  // 정규식 오류 — 기존 문구로 칸 아래, [추가] 흐림
  await setField('pattern', '(bad');
  tt = await tester(); v = await view();
  check(/^정규식이 잘못되었습니다 — /.test(tt.err ?? '') && v.commitDisabled === true && /패턴을 고치면/.test(tt.sum ?? ''), `bad regex: message under the field, [추가] disabled (${tt.err} | ${tt.sum})`);
  // 다시 Rust 로 — [추가]
  await ev(`${SEC}.querySelector('.ex-card[data-example="rust"]').click()`); await sleep(150);
  await ev(`${SEC}.querySelector('.form-actions .commit').click()`); await sleep(350);
  let after = await trg();
  v = await view();
  check(after.length === before.length + 1 && after.at(-1).pattern === RUST && after.at(-1).enabled === true && after.at(-1).tooltip === 'Rust error $1 — Ctrl+click to open the explanation', `[추가] appends the trigger turned on (${JSON.stringify(after.at(-1))})`);
  check(v.view === 'summary' && v.focusRow === String(before.length), `back to the summary, focus on the new row (${v.view} ${v.focusRow})`);

  // ── 줄 누르기 → 편집 화면: 예시 없음 · [삭제][취소][저장] ──
  await ev(`${SEC}.querySelector('.trg-open[data-index="${before.length}"]').click()`); await sleep(350);
  v = await view();
  check(v.view === 'edit-' + before.length && v.title === '트리거 편집' && v.cards === 0 && v.del && v.commit === '저장', `edit view: title, no cards, delete + save (${JSON.stringify(v)})`);
  await setField('tooltip', 'Rust $1');
  await setField('url', 'file:///$1');
  check(/열지 않습니다/.test(await ev(`${SEC}.querySelector('.field-warn')?.textContent ?? ''`)), 'link that will not open shows the scheme warning');
  await setField('url', 'https://doc.rust-lang.org/error_codes/$1.html');
  check((await trg()).at(-1).tooltip === 'Rust error $1 — Ctrl+click to open the explanation', 'typing in the edit view does not write the draft yet');
  await ev(`${SEC}.querySelector('.form-actions .commit').click()`); await sleep(350);
  after = await trg();
  check(after.at(-1).tooltip === 'Rust $1' && after.at(-1).enabled === true && (await view()).view === 'summary', `[저장] writes the draft and returns (${after.at(-1).tooltip})`);
  // [취소] 는 쓰지 않는다
  await ev(`${SEC}.querySelector('.trg-open[data-index="${before.length}"]').click()`); await sleep(350);
  await setField('tooltip', 'nope');
  await ev(`${SEC}.querySelector('.form-actions .cancel').click()`); await sleep(350);
  check((await trg()).at(-1).tooltip === 'Rust $1', '[취소] leaves the trigger as it was');

  // ── 다시 추가 화면 — 이미 있는 예시에 ✓, 그래도 고를 수 있다 ──
  await ev(`document.querySelector('#trg-add').click()`); await sleep(350);
  v = await view();
  check(v.added.includes('rust'), `card of an existing pattern carries ✓ (${v.added})`);
  await ev(`${SEC}.querySelector('.ex-card[data-example="rust"]').click()`); await sleep(150);
  check(await ev(`${SEC}.querySelector('.ex-card[data-example="rust"]').getAttribute('aria-pressed')`) === 'true' && (await view()).commitDisabled === false, 'an already-added example can still be picked');
  await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  check(!(await view()).overflow, 'no horizontal scroll at 680px (add view)');
  await shot('settings-triggers-add-680.png');
  await send('Emulation.clearDeviceMetricsOverride'); await sleep(200);

  // ── Escape 두 단계 — 요약([트리거 추가 ›] 에 포커스) → 모달 ──
  await ev(`${SEC}.querySelector('.ff[data-field="pattern"] input').focus()`);
  await key('Escape'); await sleep(40);
  v = await view();
  check(v.view === 'summary' && /sub-view-in-back/.test(v.anim ?? '') && await dockOpen(), `Escape → summary (slides back), modal stays (${v.view} ${v.anim})`);
  await sleep(300);
  check((await view()).focusAdd && (await trg()).length === before.length + 1, 'focus on [트리거 추가 ›]; Escape added nothing');
  await key('Escape'); await sleep(150);
  check(!(await dockOpen()), 'second Escape closes the settings modal');

  // ── 섹션을 떠나면 요약으로 · 편집 화면 [삭제] ──
  await opened();
  await ev(`document.querySelector('.settings-modal [data-nav-tab="triggers"]').click()`); await sleep(300);
  await ev(`${SEC}.querySelector('.trg-open[data-index="${before.length}"]').click()`); await sleep(300);
  await ev(`document.querySelector('.settings-modal [data-nav-tab="general"]').click()`); await sleep(150);
  await ev(`document.querySelector('.settings-modal [data-nav-tab="triggers"]').click()`); await sleep(200);
  check((await view()).view === 'summary', 'leaving the section returns to the summary');
  await ev(`${SEC}.querySelector('.trg-open[data-index="${before.length}"]').click()`); await sleep(300);
  await shot('settings-triggers-edit.png');
  await ev(`${SEC}.querySelector('.form-actions .del').click()`); await sleep(350);
  v = await view();
  check((await trg()).length === before.length && v.view === 'summary' && v.focusAdd, `[삭제] removes it and returns, focus on [트리거 추가 ›] (${v.view} ${v.focusAdd})`);

  // ── reduced motion ──
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }); await sleep(100);
  await ev(`document.querySelector('#trg-add').click()`); await sleep(30);
  v = await view();
  check(v.view === 'add' && v.anim === 'none' && v.running === 0, `reduced motion: no slide (${v.anim})`);
  await send('Emulation.setEmulatedMedia', { features: [] }); await sleep(100);
  // 추가 → 저장 페이로드
  await ev(`${SEC}.querySelector('.ex-card[data-example="cve"]').click()`); await sleep(150);
  await ev(`${SEC}.querySelector('.form-actions .commit').click()`); await sleep(350);
  await ev(`document.querySelector('.settings-view > .actions .btn-primary').click()`); await sleep(300);
  const saved = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'save_settings').at(-1)?.[1]?.settings?.triggers ?? null)`).then(JSON.parse);
  check(saved?.at(-1)?.pattern === CVE && saved.at(-1).tooltip === '$0 — Ctrl+click to open on NVD' && saved.at(-1).enabled !== false, `save payload carries the added trigger (${JSON.stringify(saved?.at(-1))})`);
  await key('Escape'); await sleep(150);
}

// ── 스니펫 — 요약(목록 + [스니펫 추가 ›] + 줄마다 [삽입]) ↔ 추가 · 편집 하위 화면(칸 · 미리보기) (2026-10-05) ──
await opened();
await ev(`document.querySelector('.settings-modal [data-nav-tab="snippets"]').click()`); await sleep(300);
{
  const SEC = `document.querySelector('.settings-panel > section:not([hidden])')`;
  const snipMod = importApp('lib/snippets.svelte.ts');
  const list = () => ev(`(async () => JSON.stringify((await ${snipMod}).snippets()))()`).then(JSON.parse);
  const view = () => ev(`(() => { const sec = ${SEC}; const v = sec.querySelector('.view'); const p = document.querySelector('.settings-panel'); return JSON.stringify({ view: v?.dataset.view, back: sec.querySelector('.sub-head .back')?.textContent.trim() ?? null, focusBack: document.activeElement === sec.querySelector('.sub-head .back'), title: sec.querySelector('.sub-title')?.textContent.trim() ?? null, rows: sec.querySelectorAll('.snip-open').length, inserts: sec.querySelectorAll('.snip-insert button').length, focusAdd: document.activeElement?.id === 'snip-add', focusRow: document.activeElement?.classList.contains('snip-open') ? document.activeElement.dataset.id : null, del: !!sec.querySelector('.form-actions .del'), commit: sec.querySelector('.form-actions .commit')?.textContent.trim() ?? null, commitDisabled: sec.querySelector('.form-actions .commit')?.disabled ?? null, errs: [...sec.querySelectorAll('.field-err')].map(e => e.textContent.trim()), out: sec.querySelector('[data-snippet-preview-out]')?.textContent ?? null, phs: [...sec.querySelectorAll('[data-placeholder] input')].map(i => i.value), overflow: p.scrollWidth > p.clientWidth }); })()`).then(JSON.parse);
  const setField = async (field, value) => { await ev(`(() => { const i = ${SEC}.querySelector('.ff[data-field="${field}"] .value'); i.focus(); i.value = ${JSON.stringify(value)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150); };

  let v = await view();
  check(v.view === 'summary' && v.rows === 0 && await ev(`!!${SEC}.querySelector('.snip-empty') && !!document.querySelector('#snip-add') && !${SEC}.querySelector('.snip-form')`), `snippets summary: empty note + [스니펫 추가 ›], no form below (${JSON.stringify(v)})`);

  // 추가 화면 — ‹ 스니펫 에 포커스, 빈 칸이면 [추가] 흐림, 누르려 하면(Enter) 빨간 줄
  await ev(`document.querySelector('#snip-add').click()`); await sleep(350);
  v = await view();
  check(v.view === 'add' && v.focusBack && v.back === '스니펫' && v.title === '스니펫 추가' && !v.del && v.commit === '추가' && v.commitDisabled && v.errs.length === 0, `add view: ‹ 스니펫 focused, title, [추가] disabled, no errors yet (${JSON.stringify(v)})`);
  await setField('name', 'tail log');
  await ev(`${SEC}.querySelector('.ff[data-field="name"] input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await sleep(150);
  v = await view();
  check(v.view === 'add' && v.errs.length === 1 && /명령/.test(v.errs[0]), `Enter with empty command shows the command error, stays (${v.errs})`);
  await setField('command', 'tail -n {{n=100|몇 줄}} {{file}}');
  v = await view();
  check(!v.commitDisabled && v.errs.length === 0 && JSON.stringify(v.phs) === '["100",""]' && v.out === 'tail -n 100 ⏎', `preview: fields prefilled with defaults, output line (${JSON.stringify(v.phs)} ${JSON.stringify(v.out)})`);
  await ev(`(() => { const i = ${SEC}.querySelector('[data-placeholder="file"] input'); i.value = '/var/log/syslog'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(150);
  v = await view();
  check(v.out === 'tail -n 100 /var/log/syslog⏎', `typing a test value updates the output (${JSON.stringify(v.out)})`);
  check((await list()).length === 0, 'nothing written before [추가]');
  await shot('settings-snippets-add.png');
  await ev(`${SEC}.querySelector('.form-actions .commit').click()`); await sleep(400);
  const l = await list();
  v = await view();
  check(l.length === 1 && l[0].name === 'tail log' && l[0].command === 'tail -n {{n=100|몇 줄}} {{file}}' && l[0].scope.kind === 'all' && l[0].enter === true, `[추가] writes the snippet (${JSON.stringify(l)})`);
  check(v.view === 'summary' && v.rows === 1 && v.inserts === 1 && v.focusRow === l[0].id, `back on summary, focus on the new row (${JSON.stringify(v)})`);
  await sleep(700);
  check(await ev(`window.__calls.some(c => c[0] === 'save_snippets')`), 'snippets.json save went out (debounced)');
  await shot('settings-snippets.png');

  // 편집 — 고쳐도 [저장] 전에는 그대로, Escape 는 요약으로(모달은 그대로)
  await ev(`${SEC}.querySelector('.snip-open').click()`); await sleep(350);
  v = await view();
  check(v.view === 'edit-' + l[0].id && v.title === '스니펫 편집' && v.del && v.commit === '저장', `edit view: title, delete + save (${JSON.stringify(v)})`);
  await setField('name', 'tail renamed');
  check((await list())[0].name === 'tail log', 'editing a field does not write until [저장]');
  await key('Escape'); await sleep(350);
  v = await view();
  check(v.view === 'summary' && v.focusRow === l[0].id && (await list())[0].name === 'tail log' && await ev(`(async () => (await ${dockMod}).dockKind())()`) === 'settings', `Escape → summary, focus back on the row, nothing written, modal stays (${JSON.stringify(v)})`);
  await ev(`${SEC}.querySelector('.snip-open').click()`); await sleep(350);
  await setField('name', 'tail renamed');
  await ev(`${SEC}.querySelector('.form-actions .commit').click()`); await sleep(350);
  check((await list())[0].name === 'tail renamed' && (await view()).view === 'summary', '[저장] writes and returns');

  // 섹션을 떠나면 요약으로
  await ev(`${SEC}.querySelector('.snip-open').click()`); await sleep(300);
  await ev(`document.querySelector('.settings-modal [data-nav-tab="triggers"]').click()`); await sleep(200);
  await ev(`document.querySelector('.settings-modal [data-nav-tab="snippets"]').click()`); await sleep(200);
  check((await view()).view === 'summary', 'leaving the section drops back to the summary');

  // 680px — 가로 넘침 없음
  await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 700, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  await ev(`${SEC}.querySelector('.snip-open').click()`); await sleep(350);
  check(!(await view()).overflow, 'edit view at 680px has no horizontal overflow');
  await shot('settings-snippets-edit-680.png');
  await send('Emulation.clearDeviceMetricsOverride'); await sleep(150);

  // [삭제] — 확인(예) 뒤 지우고 요약으로, 포커스는 [스니펫 추가 ›]
  // 확인은 앱 안 확인 대화(`dialogs/ConfirmDialog.svelte`)다 — 마지막 단추가 [삭제]
  await ev(`${SEC}.querySelector('.form-actions .del').click()`); await sleep(250);
  await ev(`document.querySelector('[data-confirm-dialog] .actions button:last-child').click()`); await sleep(400);
  v = await view();
  check((await list()).length === 0 && v.view === 'summary' && v.focusAdd, `[삭제] removes it and returns, focus on [스니펫 추가 ›] (${JSON.stringify(v)})`);
  await key('Escape'); await sleep(150);
}

// ── 기본 셸 고르개 (설정 › 터미널) — 앱이 그리는 목록 · 셸 로고 · 키보드 · 지금 언어의 이름 ──
{
  const i18nMod = importApp('i18n/i18n.svelte.ts');
  const VK = { ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35, Enter: 13, Space: 32, Escape: 27, Tab: 9 };
  const press = async (k, code = k) => {
    const vk = VK[code] ?? (code.startsWith('Key') ? code.charCodeAt(3) : 0);
    const keyName = k === 'Space' ? ' ' : k;
    for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
    await sleep(120);
  };
  const ddState = () => ev(`(() => {
    const b = document.querySelector('.settings-modal #default-shell');
    const lb = document.getElementById('default-shell-listbox');
    const act = lb?.getAttribute('aria-activedescendant');
    const opts = lb ? [...lb.querySelectorAll('[role="option"]')] : [];
    return JSON.stringify({
      tag: b?.tagName, haspopup: b?.getAttribute('aria-haspopup'), expanded: b?.getAttribute('aria-expanded'),
      text: b?.querySelector('.cur-text')?.textContent.trim(), btnIcon: !!b?.querySelector('.ico svg'),
      focusBtn: document.activeElement === b, focusList: !!lb && document.activeElement === lb,
      open: !!lb, role: lb?.getAttribute('role'), labelledby: lb?.getAttribute('aria-labelledby'),
      active: act ? document.getElementById(act)?.querySelector('.opt-text')?.textContent.trim() : null,
      opts: opts.map((o) => ({ t: o.querySelector('.opt-text')?.textContent.trim(), sel: o.getAttribute('aria-selected'), icon: !!o.querySelector('.ico svg') })),
      inView: (() => { if (!lb) return null; const r = lb.getBoundingClientRect(); const last = opts.at(-1)?.getBoundingClientRect(); const hit = last ? document.elementFromPoint(last.x + last.width / 2, last.y + last.height / 2) : null; return r.top >= 0 && r.bottom <= innerHeight && r.left >= 0 && r.right <= innerWidth && !!hit && opts.at(-1).contains(hit); })(),
    });
  })()`).then(JSON.parse);
  const stored = () => ev(`(async () => (await ${settingsMod}).settings.current.shell?.default ?? null)()`);
  const dockNow = () => ev(`(async () => (await ${dockMod}).dockKind())()`);

  await ev(`(async () => (await ${i18nMod}).setLocale('ko'))()`);
  await ev(`(async () => (await ${overlaysMod}).openSettingsAt('terminal'))()`); await sleep(700);
  let d = await ddState();
  console.log('shell dropdown closed', JSON.stringify(d));
  check(d.tag === 'BUTTON' && d.haspopup === 'listbox' && d.expanded === 'false' && !d.open, `default shell is a listbox button, closed (${d.tag} ${d.haspopup} ${d.expanded})`);
  check(d.text === 'PowerShell 7' && d.btnIcon, `closed button shows current shell icon + name (${d.text}, icon ${d.btnIcon})`);
  check(await ev(`document.querySelector('.settings-modal label[for="default-shell"]')?.id === 'default-shell-label'`), 'TipName <label for> still points at the default-shell control');
  const geo = await ev(`(() => { const b = document.querySelector('.settings-modal #default-shell').getBoundingClientRect(); const s = document.querySelector('.settings-modal #term-preset').getBoundingClientRect(); return JSON.stringify({ bh: Math.round(b.height), sh: Math.round(s.height) }); })()`).then(JSON.parse);
  check(geo.bh === geo.sh, `button height matches the terminal preset dropdown below it (${geo.bh} vs ${geo.sh})`);
  await shot('settings-shell-ko-closed.png');

  // 클릭으로 연다 — 목록은 화면 안에, 줄마다 아이콘, 고른 줄이 aria-selected, 모르는 셸도 아이콘이 있다
  await ev(`document.querySelector('.settings-modal #default-shell').click()`); await sleep(250);
  d = await ddState();
  console.log('shell dropdown open', JSON.stringify(d));
  check(d.open && d.expanded === 'true' && d.role === 'listbox' && d.focusList && d.labelledby === 'default-shell-label', `click opens a focused listbox (labelledby ${d.labelledby})`);
  check(d.opts.length === 6 && d.opts.every((o) => o.icon), `every option has an icon, unknown shell included (${JSON.stringify(d.opts)})`);
  check(d.opts[2]?.t === '명령 프롬프트' && d.opts[5]?.t === 'Nushell' && d.opts[0]?.sel === 'true' && d.active === 'PowerShell 7', 'ko names; current shell selected and active');
  check(d.inView, 'open list is fully on screen and its last row is hittable (not clipped by the modal)');
  await shot('settings-shell-ko-open.png');

  // 키보드: ↓ ↓ → cmd, End → 마지막, Home → 처음, ↑ 는 처음에서 멈춤, 글자 g → Git Bash, Enter 로 고른다
  await press('ArrowDown'); await press('ArrowDown');
  d = await ddState(); check(d.active === '명령 프롬프트', `ArrowDown moves active row (${d.active})`);
  await press('End'); d = await ddState(); check(d.active === 'Nushell', `End -> last (${d.active})`);
  await press('Home'); d = await ddState(); check(d.active === 'PowerShell 7', `Home -> first (${d.active})`);
  await press('ArrowUp'); d = await ddState(); check(d.active === 'PowerShell 7', `ArrowUp stops at the top (${d.active})`);
  await press('g', 'KeyG'); d = await ddState(); check(d.active === 'Git Bash', `typing g jumps to Git Bash (${d.active})`);
  await press('Enter');
  d = await ddState();
  const s1 = await stored();
  check(!d.open && d.focusBtn && d.text === 'Git Bash' && s1 === 'gitbash', `Enter picks, closes, refocuses the button and saves (${d.text}, ${s1})`);
  check(await dockNow() === 'settings', 'settings modal stays open after picking');

  // 버튼에서 Enter·Space·↓ 로 연다 — 고른 줄이 하이라이트된 채. Escape 는 값을 안 바꾸고 목록만 닫는다
  for (const k of ['Enter', 'Space', 'ArrowDown']) {
    await press(k);
    d = await ddState();
    check(d.open && d.active === 'Git Bash', `${k} on the button opens with the current row active (${d.active})`);
    await press('ArrowDown'); await press('Escape');
    d = await ddState();
    check(!d.open && d.focusBtn && d.text === 'Git Bash' && await dockNow() === 'settings', `Escape closes the list only, focus back on the button (${k})`);
  }

  // 바깥 클릭 — 목록만 닫히고 값·모달은 그대로
  await ev(`document.querySelector('.settings-modal #default-shell').click()`); await sleep(200);
  for (const type of ['mousePressed', 'mouseReleased']) await send('Input.dispatchMouseEvent', { type, x: 6, y: 6, button: 'left', clickCount: 1 });
  await sleep(200);
  d = await ddState();
  check(!d.open && d.text === 'Git Bash' && await dockNow() === 'settings', 'outside click closes the list without changing value or closing settings');

  // 클릭으로 cmd 를 고른다 → 영어로 바꾸면 이름이 "Command Prompt" (목록은 한국어로 구운 글자를 들고 있다)
  await ev(`document.querySelector('.settings-modal #default-shell').click()`); await sleep(200);
  await ev(`[...document.querySelectorAll('#default-shell-listbox [role="option"]')][2].click()`); await sleep(200);
  check(await stored() === 'cmd', 'clicking an option saves it');
  await ev(`(async () => (await ${i18nMod}).setLocale('en'))()`); await sleep(300);
  d = await ddState();
  check(d.text === 'Command Prompt', `English UI shows "Command Prompt" on the button (${d.text})`);
  await shot('settings-shell-en-closed.png');
  await ev(`document.querySelector('.settings-modal #default-shell').click()`); await sleep(250);
  d = await ddState();
  check(d.opts[2]?.t === 'Command Prompt' && d.opts[0]?.t === 'PowerShell 7' && d.opts[4]?.t === 'WSL: Ubuntu', `English option names (${d.opts.map((o) => o.t)})`);
  await shot('settings-shell-en-open.png');
  await press('Escape');
  await send('Emulation.setDeviceMetricsOverride', { width: 680, height: 700, deviceScaleFactor: 1, mobile: false }); await sleep(300);
  await ev(`document.querySelector('.settings-modal #default-shell').scrollIntoView({ block: 'center' })`); await sleep(150);
  await ev(`document.querySelector('.settings-modal #default-shell').click()`); await sleep(250);
  d = await ddState();
  check(d.open && d.inView && await ev(`document.documentElement.scrollWidth <= innerWidth`), 'at 680px the open list stays on screen without page overflow');
  await shot('settings-shell-en-open-680.png');
  await press('Escape');
  await send('Emulation.clearDeviceMetricsOverride'); await sleep(150);
  await ev(`(async () => (await ${i18nMod}).setLocale('ko'))()`); await sleep(150);
}

check(errors.length===0, `runtime errors: ${JSON.stringify(errors)}`);
ws.close(); process.exit(failed ? 1 : 0);
