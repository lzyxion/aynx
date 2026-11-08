// 통합 독(2026-10-18) — 상태바는 독 입구 · 알림 배지만, 독의 아이콘 줄 · 실행 단추 · 칸 카드 · 알림 칸 · 가장자리 호버.
// 실행: node scripts/dev/run-harness.mjs dock-unified-harness.mjs <outdir>
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { checkBrowserShortcuts } from "./browser-shortcuts-checks.mjs";
import { checkTooltips } from "./tooltip-checks.mjs";
import { checkColorThemes } from "./color-theme-checks.mjs";
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
let failed = 0, checked = 0;
const check = (ok, label) => { checked++; if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
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
  window.__workspaceSeed = {
    kind:'aynx.workspaces',version:2,revision:1,activeWorkspaceId:'default',
    workspaces:['default','build','review'].map((id,i)=>({id,name:['기본','빌드','검토'][i],tabs:[],lastActive:{}}))
  };
  performance.setResourceTimingBufferSize(5000);
  // 통합 독(2026-10-18) 전에 순서를 바꿔 둔 사람의 저장값 — 걷힌 칸 id 가 조용히 버려지는지 본다
  try { localStorage.setItem('aynx:status-order', JSON.stringify(['new-shell','open-dock','open-localfs','command-palette','folder-conversations','open-sessions','open-plans','orchestration-start'])); } catch {}
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
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: true }],
     load_snippets: null,
     save_snippets: null,
    save_settings: null,
    load_settings: { app: { status_bar: 'right', status_bar_style: 'flat' }, projects: { start_screen: 'off' }, ai: { start_dir: 'D:\\\\ai-home' } },
    host_history_list: {},
    projects_list: PROJECTS,
    ssh_remote_home: '/root', local_home: 'C:/Users/me', local_list: [], local_roots: [],
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
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] },
    agent_usage_limits: ['claude','codex'].map((agent,i)=>({agent,seen:true,measuredAt:Date.now(),windows:[{windowMinutes:300,kind:null,usedPercent:30+i*55,resetsAt:Math.floor(Date.now()/1000)+3600}]})),
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
      // 잠자기 방지(10-23) — 상태를 스텁 안에 쥔다(앱 시작 때 꺼짐)
      if (cmd === 'keep_awake_status') return Promise.resolve({ supported: true, on: !!window.__awake });
      if (cmd === 'keep_awake_set') { window.__awake = !!args.on; return Promise.resolve({ supported: true, on: window.__awake }); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });


await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);
counting = true;
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded: ${file}'); return await import(e); })()`;
const rect = (sel) => ev(`(() => { const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`);
const move = async (x,y,buttons=0) => { await send('Input.dispatchMouseEvent',{type:'mouseMoved',x,y,buttons,button:buttons?'left':'none'}); await sleep(50); };
const point = async (sel) => { const r=await rect(sel); await move(r.x+r.w/2,r.y+r.h/2); return r; };
const click = async (sel) => { const r=await point(sel); for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x:r.x+r.w/2,y:r.y+r.h/2,button:'left',clickCount:1}); await sleep(150); };
const key = async (code,k=code,modifiers=0) => {
  const vk=code==='Tab'?9:code==='Escape'?27:code==='Enter'?13:code==='ArrowRight'?39:code==='ArrowLeft'?37:/^Key[A-Z]$/.test(code)?code.charCodeAt(3):0;
  for(const type of ['keyDown','keyUp']) await send('Input.dispatchKeyEvent',{type,code,key:k,modifiers,windowsVirtualKeyCode:vk,nativeVirtualKeyCode:vk});
  await sleep(100);
};
/** 독의 지금 — 열렸으면 종류, 닫혔으면 null */
const dockKind = () => ev(`(() => { const d=document.querySelector('.dock'); return d && !d.hidden ? d.dataset.dockKind : null; })()`);
/** 사이드 독의 띠 — 창 끝 16px 고정 사각형(`$lib/dock` 의 `sideEdgeStrip` 과 같은 계산 · 측정용 상자는 10-18 재수정 때 걷었다) */
const strip = () => ev(`(() => { const top=document.querySelector('.titlebar')?.getBoundingClientRect().bottom ?? 0; const right=document.querySelector('.dock').dataset.dockSide==='right'; return {x: right ? innerWidth-16 : 0, y: top, w: 16, h: innerHeight-top}; })()`);
/** 띠 한가운데로 옮긴다 — 머무는 시간은 부르는 쪽이 정한다 */
const intoStrip = async (buttons=0) => { const s=await strip(); await move(s.x+s.w/2, s.y+s.h/2, buttons); return s; };
const away = () => move(400, 300);
/** 독을 알림 칸으로 연다 — 상태바 독 입구는 2026-10-18 실기 뒤 걷혔다(가장자리 호버 · 단축키 · 팔레트 · 알림 배지만) */
const openDockNow = () => ev(`(async()=> (await ${importApp('app/dock.svelte.ts')}).openDock('alerts'))()`);

// 부팅이 끝날 때까지 기다린다 — 상태바 사용량 고리 · 하단 독 뿌리가 서면 화면이 다 선 것이다(첫 판은 vite 변환이 느리다)
for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('[data-status-middle] [data-usage-ring]') && !!document.querySelector('[data-floating-status-dock]')`)); i++) await sleep(250);

// ── 상태바 — 칸 없음 · 옛 저장 순서의 걷힌 id 는 조용히 버린다 ──────────────────────────
await away();
check(await ev(`JSON.parse(localStorage.getItem('aynx:status-order')).includes('new-shell')`), 'stub keeps an old saved order with retired ids');
check(await ev(`document.querySelectorAll('.statusbar [data-status-id]').length===0`), 'status bar has no menu items (dock entrance removed too)');
check(await ev(`!document.querySelector('[data-shell-menu]') && !document.querySelector('[data-notify-center]') && !document.querySelector('[data-signal="settings"]') && !document.querySelector('[data-filesystem-button]')`), 'shell menu · notify popover · settings glyph · file button are gone');
// 2026-10-18(End-4 식)부터 하단 독은 런처 단추가 늘 서서 즐겨찾기가 비어도 뜬다 — 숨는 것은 모달 · 가림막 동안뿐(`FloatingStatusDock.svelte` 머리말)
check(await ev(`(() => { const d=document.querySelector('[data-floating-status-dock]'); return !!d && d.hidden === false && !!d.querySelector('[data-floating-launcher]') && !d.querySelector('[data-dock-favorites]'); })()`), 'bottom dock stands with the launcher even while favorites are empty (no favorites row)');
check(await ev(`!!document.querySelector('[data-status-middle] [data-usage-ring]')`), 'usage rings stay');
check(await ev(`(() => { const b=document.querySelector('[data-signal="notify"]'); return !!b && !!b.querySelector('svg') && !b.querySelector('.notify-pill') && !b.querySelector('[data-notify-dot]'); })()`), 'bell always stands · no badge or dot while nothing is pending (10-24 A)');
check(await dockKind() === null, 'dock starts closed');

await key('KeyP','P',10); check(await ev(`!!document.querySelector('.palette')`),'command palette shortcut remains available'); await key('Escape');
await checkBrowserShortcuts({send,ev,check,key,sleep});
await checkTooltips({ev,check,move,click,sleep,key});

// ── 가장자리 호버 (상태바 오른쪽 → 띠도 오른쪽, 기둥의 캔버스 쪽 끝) ─────────────────────────────
{
  check(await ev(`!document.querySelector('.edge-probe')`), 'no measuring element — strip is a fixed window-coordinate rectangle');
  // 창 끝 바깥 4px(OS 띠가 가리는 자리) 너머 x=W-10 에서도 열린다 · 띠 밖(W-20)은 아니다 — 아래 호버 검사가 실제로 본다
}
await intoStrip(); await sleep(120);
check(await dockKind() === null, 'passing cursor (<250ms) does not open');
await sleep(250);
check(await dockKind() === 'alerts', 'dwelling 250ms opens the dock on the alerts section');
await away(); await sleep(400);
check(await dockKind() === 'alerts', 'leaving with the cursor does not close');
await intoStrip(); await key('Escape'); await sleep(400);
check(await dockKind() === null, 'Escape closes · staying in the strip does not reopen');
await away(); await intoStrip(); await sleep(400);
check(await dockKind() === 'alerts', 'leaving and re-entering reopens');
await click('.pane-body'); await sleep(150);
check(await dockKind() === null, 'outside click closes');
await away(); await sleep(60);
// 단추를 누른 채(글자 고르기 · 끌기) 띠로 — 열지 않는다. 놓고 머물면 연다
{
  const s=await strip();
  await send('Input.dispatchMouseEvent',{type:'mousePressed',x:400,y:300,button:'left',buttons:1,clickCount:1}); await sleep(30);
  await move(s.x+s.w/2, s.y+s.h/2, 1); await sleep(400);
  check(await dockKind() === null, 'held mouse button (selection drag) does not open');
  await send('Input.dispatchMouseEvent',{type:'mouseReleased',x:s.x+s.w/2,y:s.y+s.h/2,button:'left',buttons:0,clickCount:1}); await sleep(400);
  check(await dockKind() === 'alerts', 'after release, dwelling opens');
}

// ── 독의 생김새 — 아이콘 줄 · 실행 단추 · 칸 카드 · 바닥 줄 ────────────────────────────────────
check(await ev(`[...document.querySelectorAll('.dock .tools [data-dock-tool]')].map(b=>b.dataset.dockTool).join(',')`) === 'lock,reload,settings,quit', 'tool row: lock · reload · settings · quit (palette button gone — shortcut only)');
check(await ev(`(() => { const b=document.querySelector('.dock [data-dock-tool="lock"]'); return /화면 잠금|Lock screen/.test(b.title) && b.title.includes('Ctrl+Shift+B'); })()`), 'lock tool = lock screen + toggle-veil combo');
check(await ev(`(() => { const t=document.querySelector('.dock .tools').getBoundingClientRect(), b=document.querySelector('.dock .tools [data-dock-tool="quit"]').getBoundingClientRect(), d=document.querySelector('.dock').getBoundingClientRect(); return d.right-b.right < 12 && !document.querySelector('.dock .tools').textContent.trim(); })()`), 'tool row sits top-right with no text');
check(await ev(`(() => { const b=document.querySelector('.dock [data-dock-tool="quit"]'); return b.classList.contains('danger') && /모든 세션 종료|End all sessions/.test(b.title); })()`), 'quit = end all sessions (danger tint · tray wording)');
// 10-28 판 E — 네 열 격자: 글자 칸(알약 · 배지 + 이름만) = 셸 · AI, 아이콘 칸(52px 원 · 글자 없음) = 로컬 파일 · ☕ · 지난 대화 · 오케스트레이션
check(await ev(`[...document.querySelectorAll('.dock [data-dock-launch] .tile.text')].map(b=>b.dataset.launch+(b.dataset.aiId?':'+b.dataset.aiId:'')).join(',')`) === 'shell,ai:claude,ai:codex', 'text tiles: default shell · Claude Code · Codex');
check(await ev(`[...document.querySelectorAll('.dock [data-dock-launch] .tile.icon')].map(b=>b.dataset.launch).join(',')`) === 'localfs,keep-awake,folder-conversations,orchestration-start', 'icon tiles: local files · keep awake · conversations · orchestration');
check(await ev(`(() => { const s=document.querySelector('.dock [data-launch="localfs"]').getBoundingClientRect(), b=document.querySelector('.dock [data-launch="shell"]').getBoundingClientRect(); return Math.abs(s.height-b.height)<1 && Math.abs(s.height-52)<2 && Math.abs(s.width-52)<2; })()`), 'all launch tiles 52px tall · icon tiles 52×52');
check(await ev(`[...document.querySelectorAll('.dock [data-dock-launch] .tile.icon')].every(b=>!b.textContent.trim() && !!b.getAttribute('aria-label') && !!b.title)`), 'icon tiles show no text (name in title · aria-label)');
check(await ev(`[...document.querySelectorAll('.dock [data-dock-launch] .tile.text')].every(b=>b.querySelectorAll('.badge').length===1 && b.textContent.trim()===b.querySelector('.lbl').textContent.trim())`), 'text tiles = badge + name only (no subtitle)');
check(await ev(`(() => { const sh=getComputedStyle(document.querySelector('.dock [data-launch="shell"]')).backgroundColor, ai=getComputedStyle(document.querySelector('.dock [data-launch="ai"]')).backgroundColor; return sh===ai; })()`), 'default shell tile looks like the AI tiles (no primary fill)');
check(await ev(`document.querySelector('.dock [data-launch="keep-awake"]').getAttribute('aria-pressed')`) === 'false' && await ev(`!document.querySelector('.statusbar [data-signal="keep-awake"]')`), 'keep awake starts off (no status-bar ☕)');
await click('.dock [data-launch="keep-awake"]'); await sleep(200);
check(await ev(`document.querySelector('.dock [data-launch="keep-awake"]').getAttribute('aria-pressed')`) === 'true' && await dockKind() !== null, 'keep awake tile toggles on and the dock stays open');
// 10-24 End-4 알약 — 상태바 ☕ 는 알림 알약 안의 표시(span)뿐이다. 끄는 자리는 독 ☕ 칸(토글) 하나.
check(await ev(`(() => { const s=document.querySelector('.statusbar [data-signal="keep-awake"]'); return !!s && s.tagName==='SPAN' && s.parentElement?.closest('button')?.dataset.signal==='notify' && !!s.title; })()`), 'status bar shows ☕ while on — a display span inside the notify pill (10-24 End-4)');
// 알약 두께 24px — 이 판의 상태바는 오른쪽 세로 기둥이라 알약도 세로로 선다(표시가 늘면 높이가 자란다 — `StatusBar.svelte` 의 알약 머리말)
check(await ev(`(() => { const p=document.querySelector('.statusbar [data-signal="notify"]'), r=p.getBoundingClientRect(), ids=[...p.querySelectorAll('[data-signal],[data-notify-bell]')].map(e=>e.dataset.signal||'bell'); return getComputedStyle(p).borderTopLeftRadius!=='0px' && Math.abs(Math.min(r.width, r.height)-24)<1 && ids[ids.length-1]==='bell' && ids.includes('keep-awake') && /잠자기 방지 켜짐|Keep awake on/.test(p.getAttribute('aria-label')); })()`), 'pill = 24px thick rounded · bell last · aria-label names ☕');
await click('.dock [data-launch="keep-awake"]'); await sleep(300);
check(await ev(`document.querySelector('.dock [data-launch="keep-awake"]').getAttribute('aria-pressed')`) === 'false' && await ev(`!document.querySelector('.statusbar [data-signal="keep-awake"]')`), 'dock ☕ tile toggles it off too (status-bar ☕ is display only)');
check(await ev(`!document.querySelector('.statusbar [data-signal="lock"], .statusbar [data-signal="vault-open"], .statusbar [data-signal="vault-locked"]')`), 'status bar no longer carries the lock');
check(await ev(`!document.querySelector('.dock [data-launch-more]')`), 'no ▾ on launch tiles (shell list = right-click)');
check(await ev(`(() => { const t=getComputedStyle(document.querySelector('.dock [data-launch="shell"]')).borderTopLeftRadius, b=getComputedStyle(document.querySelector('.dock [data-dock-tool="reload"]')).borderTopLeftRadius; return t==='26px' && b==='50%'; })()`), 'rounder: launch tile = 알약 26px(10-28 판 E) · 아이콘 단추 동그라미');
check(await ev(`document.querySelector('.dock [data-launch="shell"] .lbl').textContent.trim()`) === 'PowerShell 7', 'default shell tile follows effective default');
// 자리(10-28 판 E — `launchLayout`): 1줄 = 셸(글자 두 열) + 로컬 파일 · ☕, 2줄 = Claude · Codex + 지난 대화 · 오케스트레이션
check(await ev(`(() => { const r=k=>document.querySelector('.dock [data-launch="'+k+'"]').getBoundingClientRect(); const ai=[...document.querySelectorAll('.dock [data-launch="ai"]')].map(b=>b.getBoundingClientRect()); const sh=r('shell'), fs=r('localfs'), aw=r('keep-awake'), cv=r('folder-conversations'), or=r('orchestration-start'); const same=(a,b)=>Math.abs(a.top-b.top)<1; return same(sh,fs) && same(sh,aw) && ai.every(a=>same(a,cv) && same(a,or)) && ai[0].top>sh.bottom && Math.abs(sh.left-ai[0].left)<1 && Math.abs(sh.right-ai[1].right)<1 && Math.abs(ai[0].width-ai[1].width)<1 && fs.left>sh.right && Math.abs(fs.left-cv.left)<1 && Math.abs(aw.left-or.left)<1; })()`), 'grid E: shell spans both text columns on row 1 with localfs · keep-awake; AIs + conversations · orchestration on row 2');
check(await ev(`[...document.querySelectorAll('.dock .segs [data-segment]')].map(b=>b.dataset.segment).join(',')`) === 'alerts,hosts,projects,db', 'segments: alerts · hosts · projects · db');
check(await ev(`(() => { const a=document.querySelector('.dock .seg.active'); const pill=a.querySelector('.seg-ico'); const probe=document.createElement('div'); probe.style.background='var(--control-sel-bg)'; document.body.appendChild(probe); const sel=getComputedStyle(probe).backgroundColor; probe.remove(); return a.dataset.segment==='alerts' && getComputedStyle(a).backgroundColor==='rgba(0, 0, 0, 0)' && getComputedStyle(pill).backgroundColor===sel; })()`), 'active segment = MD3 pill indicator (secondaryContainer), button itself unpainted (10-18)');
check(await ev(`(() => { const r=document.querySelector('.dock .seg').getBoundingClientRect(); return r.height>=56 && r.height<=64; })()`), 'segment button is ~60px tall');
check(await ev(`!!document.querySelector('.dock [data-dock-alerts] [data-dock-sessions]') && !!document.querySelector('.dock [data-dock-foot="alerts"] [data-dock-read-all]') && !!document.querySelector('.dock [data-dock-plans]')`), 'alerts body: sessions line · foot buttons');
// 10-24 — [알림 지우기] 는 바닥 줄 [모두 읽음] 오른쪽 하나뿐(목록 맨 아래 단추는 걷었다) · 둘 다 아이콘 + 글자 · 좁아도 한 줄
check(await ev(`(() => { const f=document.querySelector('.dock [data-dock-foot="alerts"]'), r=f.querySelector('[data-dock-read-all]'), c=f.querySelector('[data-dock-clear]'); return !!c && r.nextElementSibling===c && !!r.querySelector('svg') && !!c.querySelector('svg') && !!c.getAttribute('aria-label') && !!c.title && !document.querySelector('.dock [data-dock-alerts] .pick.clear, .dock [data-dock-alerts] [data-notify-clear]'); })()`), 'clear-alerts lives in the foot right of read-all (icon + aria-label), not at list bottom');
check(await ev(`(() => { const row=document.querySelector('.dock [data-dock-foot="alerts"] .foot-row'); return [...row.children].every(e => getComputedStyle(e).display==='none' || e.getBoundingClientRect().right <= row.getBoundingClientRect().right + 0.5); })()`), 'alerts foot fits on one line at this dock width');
await shot('dock-alerts.png');

// ── 알림 배지 — 에이전트 알림 하나 ───────────────────────────────────────────────────────────
await ev(`(async()=>{ const m=await ${importApp('app/agent-banners.svelte.ts')}; window.__banners=m; m.pushAgentBanner({paneId:'nope',kind:'stop',agent:'Claude Code',logo:'claude',label:'tab',text:'tab — 끝났습니다'}); })()`); await sleep(150);
check(await ev(`document.querySelector('.dock [data-dock-alert-badge]')?.textContent.trim()`) === '1', 'alerts segment badge shows 1');
check(await ev(`document.querySelector('[data-signal="notify"] .notify-pill')?.textContent.trim()`) === '1', 'status bar shows the count badge on the bell');
check(await ev(`(() => { const b=document.querySelector('[data-signal="notify"] [data-notify-bell]'), p=b.querySelector('.notify-pill'), r=b.getBoundingClientRect(), q=p.getBoundingClientRect(); return !!b.querySelector('svg') && getComputedStyle(p).position==='absolute' && q.left > r.left + r.width/2 - 1 && q.top < r.top + r.height/2; })()`), 'badge sits on the bell top-right corner');
check(await ev(`document.querySelector('[data-dock-read-all]').disabled`) === false, 'read-all enabled with a finished alert');
await click('[data-dock-read-all]'); await sleep(150);
check(await ev(`!!document.querySelector('[data-signal="notify"]') && !document.querySelector('[data-signal="notify"] .notify-pill') && !document.querySelector('.dock [data-dock-alert-badge]')`), 'read-all resolves finished alerts (badges gone, bell stays)');
await ev(`window.__banners.pushAgentBanner({paneId:'nope2',kind:'permission',agent:'Claude Code',logo:'claude',label:'tab',text:'권한'})`); await sleep(150);
await click('[data-dock-read-all]'); await sleep(150);
check(await ev(`document.querySelector('[data-signal="notify"] .notify-pill.urgent')?.textContent.trim()`) === '1', 'permission prompt survives read-all (urgent badge)');
check(await ev(`document.querySelector('[data-dock-clear]').disabled`) === false, 'clear-alerts enabled with a resolved alert in history');
// 10-24 — 지운 줄은 밀려 나간 뒤 접힌다(차례 지연 상한 220 + 180 + 150ms) — 다 나갈 때까지 기다린다
await click('[data-dock-clear]'); await sleep(700);
check(await ev(`!document.querySelector('.dock [data-notify-entry]') && !!document.querySelector('.dock [data-notify-todo]') && document.querySelector('[data-dock-clear]').disabled`), 'clear-alerts empties history, keeps the permission prompt, then greys out');
await key('Escape'); await sleep(200);
check(await dockKind() === null, 'Escape closes before badge test');
await click('[data-signal="notify"]'); await sleep(150);
check(await dockKind() === 'alerts', 'badge click opens alerts');
check(await ev(`(() => { const p=document.querySelector('[data-signal="notify"]'), col=(v)=>{ const probe=document.createElement('div'); probe.style.background=v; document.body.appendChild(probe); const c=getComputedStyle(probe).backgroundColor; probe.remove(); return c; }; const bg=getComputedStyle(p).backgroundColor; return p.getAttribute('aria-pressed')==='true' && (bg===col('var(--control-sel-bg)') || bg===col('var(--control-sel-bg-hover)')); })()`), 'open pill = secondaryContainer (10-24 End-4 · pointer may still hover)');
await click('[data-signal="notify"]'); await sleep(150);
check(await dockKind() === null, 'badge click again closes');

// ── 읽지 않은 일반 알림의 점 — 숫자가 서 있으면 숨고, 0 이면 선다 · 알림 칸을 열면 읽음이 되어 사라진다(10-24 A) ──────
await ev(`(async()=>{ const m=await ${importApp('app/notifications.svelte.ts')}; m.recordNotification({kind:'transfer',text:'harness transfer'}); })()`); await sleep(150);
check(await ev(`!!document.querySelector('[data-signal="notify"] .notify-pill') && !document.querySelector('[data-signal="notify"] [data-notify-dot]')`), 'dot hidden while the count badge stands');
await ev(`window.__banners.dropAgentBanner('nope2')`); await sleep(150);
check(await ev(`!document.querySelector('[data-signal="notify"] .notify-pill')`), 'count badge gone once the permission prompt is dropped');
check(await ev(`!!document.querySelector('[data-signal="notify"] [data-notify-dot]')`), 'unread plain notification shows a dot when count is 0');
// 포인터가 종 위에 있으면 앱 툴팁 층이 네이티브 말풍선을 막으려 `title` 을 `data-tip` 으로 옮겨 둔다(2026-10-03 — `tooltip.svelte.ts`) — 둘 중 있는 쪽
check(await ev(`(() => { const b=document.querySelector('[data-signal="notify"]'); return /새 알림 있음|New notifications/.test(b.getAttribute('title') || b.getAttribute('data-tip') || ''); })()`), 'dot tooltip = new notifications');
await click('[data-signal="notify"]'); await sleep(200);
check(await ev(`!document.querySelector('[data-signal="notify"] [data-notify-dot]')`), 'opening the alerts section marks read (dot gone)');
await click('[data-signal="notify"]'); await sleep(150);

// ── 기본 셸 칸 우클릭 — 셸 전부(한 번만) · 포인터 자리 · Escape 는 메뉴 먼저 ───────────────────────
const rightClickShell = async () => {
  const r=await point('.dock [data-launch="shell"]');
  for (const type of ['mousePressed','mouseReleased']) await send('Input.dispatchMouseEvent',{type,x:r.x+r.w/2,y:r.y+r.h/2,button:'right',clickCount:1});
  await sleep(150);
  return r;
};
await openDockNow(); await sleep(200);
check(await dockKind() === 'alerts', 'opening without a section shows alerts');
{
  const r=await rightClickShell();
  check(await ev(`[...document.querySelectorAll('[data-launch-menu="shell"] [role=menuitem]')].map(b=>b.dataset.shellId).join(',')`) === 'pwsh,cmd', 'right-click menu lists all shells, default first');
  check(await ev(`(() => { const m=document.querySelector('[data-launch-menu="shell"]').getBoundingClientRect(); return Math.abs(m.left-(${r.x+r.w/2}))<8 || m.right<=${r.x+r.w/2}+8; })()`), 'menu opens at the pointer');
  check(await ev(`(() => { const r1=document.querySelector('.dock [data-launch="shell"]').getBoundingClientRect(), r2=document.querySelector('.dock [data-launch="ai"]').getBoundingClientRect(); return r2.top-r1.bottom < 16; })()`), 'menu does not push row 2');
}
await key('Escape'); await sleep(120);
check(await ev(`!document.querySelector('[data-launch-menu]') && document.activeElement?.dataset.launch === 'shell'`) && await dockKind() === 'alerts', 'first Escape closes the menu only (focus back on the shell tile)');
await rightClickShell();
{
  const before=await ev(`window.__calls.filter(([c])=>c==='open_local_session').length`);
  await click('[data-launch-menu="shell"] [data-shell-id="cmd"]'); await sleep(500);
  check(await ev(`window.__calls.filter(([c])=>c==='open_local_session').slice(${before}).some(([,a])=>a.shell==='cmd')`) === true, 'shell row opens that shell once');
  check(await dockKind() === null, 'opening closes the dock');
  check(await ev(`(async()=> (await ${importApp('lib/settings.svelte.ts')}).settings.defaultShell ?? null)()`) !== 'cmd', 'default shell unchanged');
}
await openDockNow(); await sleep(200);
{
  const before=await ev(`window.__calls.filter(([c])=>c==='open_local_session').length`);
  await click('.dock [data-launch="shell"]'); await sleep(500);
  check(await ev(`window.__calls.filter(([c])=>c==='open_local_session').slice(${before}).some(([,a])=>a.shell==='pwsh')`) === true, 'default shell tile opens default shell');
}

// ── 칸 · 세션 요약 줄 · 설정 단추 ─────────────────────────────────────────────────────────────
await openDockNow(); await sleep(200);
await click('.dock [data-segment="hosts"]'); await sleep(150);
check(await dockKind() === 'hosts', 'segment click switches section');
await ev(`document.querySelector('.dock [data-segment="hosts"]').focus()`); await key('ArrowRight'); await sleep(150);
check(await dockKind() === 'projects', 'ArrowRight on the segment row moves to the next section');
await key('KeyH','H',10); await sleep(150);
check(await dockKind() === 'hosts', 'Ctrl+Shift+H still opens the hosts section');
await click('.dock [data-segment="alerts"]'); await sleep(150);
await click('.dock [data-dock-sessions]'); await sleep(300);
check(await dockKind() === null && await ev(`(async()=> (await ${importApp('app/session-sheet.svelte.ts')}).sessionSheetOpen())()`) === true, 'sessions line closes the dock and opens the session list');
await key('Escape'); await sleep(200);
await openDockNow(); await sleep(200);
await click('.dock [data-launch="folder-conversations"]'); await sleep(400);
check(await dockKind() === null && await ev(`!!document.querySelector('[data-folder-convos]')`), 'conversations tile closes the dock and opens the folder conversations list');
await key('Escape'); await sleep(300);
await openDockNow(); await sleep(200);
// 툴팁은 포인터가 그 칸 위에 있으면 앱 툴팁 층이 `data-tip` 으로 옮겨 둔다(`tooltip.svelte.ts`) — 둘 중 있는 쪽을 읽는다
check(await ev(`(() => { const b=document.querySelector('.dock [data-launch="orchestration-start"]'); const l=b.getAttribute('aria-label')||''; return !b.querySelector('.lbl') && l.startsWith('오케스트레이션'); })()`), 'orchestration tile = icon only, name in aria-label (10-28 판 E · 10-30 오케스트레이션 탭 — 홈을 연다)');
{ const tip = (await ev(`(() => { const b=document.querySelector('.dock [data-launch="orchestration-start"]'); return b.getAttribute('title') || b.getAttribute('data-tip'); })()`)) || ''; check(tip.startsWith('오케스트레이션'), 'orchestration tile tooltip = 오케스트레이션 (+ 산 앨범 꼬리 — 10-30 ⑤)'); }
check(await ev(`(() => { const b=document.querySelector('.dock [data-launch="folder-conversations"]'); return !b.querySelector('.lbl') && (b.getAttribute('aria-label') || '').startsWith('이 폴더의 지난 대화') && (b.getAttribute('title') || b.getAttribute('data-tip') || '').startsWith('이 폴더의 지난 대화'); })()`), 'conversations tile: icon only · long tooltip');
await click('.dock [data-dock-tool="settings"]'); await sleep(300);
check(await dockKind() === 'settings' && await ev(`document.querySelector('.settings-modal')?.getAttribute('aria-modal')==='true'`), 'settings tool opens the settings modal');
check(await ev(`!!document.querySelector('#status-bar') && !!document.querySelector('#status-bar-style')`), 'status bar position and style controls remain');
await key('Escape'); await sleep(200);

// ── 상태바 자리마다 — 독 쪽 · 띠 자리 · 호버로 열기 ──────────────────────────────────────────
for (const [position, style] of [['left','panel'],['left','flat'],['left','hug'],['top','flat'],['top','hug'],['bottom','panel'],['bottom','hug'],['right','panel'],['right','hug']]) {
  await ev(`(async()=>{const m=await ${importApp('/src/lib/settings.svelte.ts')};m.settings.statusBar='${position}';m.settings.statusBarStyle='${style}';})()`);
  await sleep(350); await away(); await sleep(60);
  // 띠는 늘 창 끝 16px — 창 끝에서 10px 안쪽(OS 크기 조절 띠 너머)에 머물면 연다, 20px 안쪽은 띠 밖.
  // 런처 독의 쪽은 `[dock] layout`(기본 launcher-left)이 정하고 **상태바 자리와 무관**하다(2026-10-23 채팅 독 —
  // `settings/model/options.ts` "예전에는 상태바가 오른쪽이면 런처가 오른쪽이었다"). 오른쪽 끝 띠는 채팅 독의 것이다(아래).
  const vw=await ev('innerWidth'), vh=await ev('innerHeight');
  const xIn = 10, xOut = 20;
  await move(xOut, vh/2); await sleep(400);
  check(await dockKind() === null, `${position}/${style}: 20px in from the window edge is outside the strip`);
  await away(); await move(xIn, vh/2); await sleep(400);
  check(await dockKind() === 'alerts', `${position}/${style}: 10px in from the window edge opens (fixed 16px strip, over the pillar too)`);
  await key('Escape'); await sleep(200); await away(); await sleep(60);
  await intoStrip(); await sleep(400);
  check(await dockKind() === 'alerts', `${position}/${style}: edge hover opens`);
  check(await ev(`document.querySelector('.dock').dataset.dockSide`) === 'left', `${position}/${style}: launcher dock stays on the left (layout launcher-left)`);
  if (position === 'right') {
    await key('Escape'); await sleep(200); await away(); await move(vw-10, vh/2); await sleep(400);
    check(await ev(`!!document.querySelector('[data-chat-dock].open')`) && await dockKind() === null, `${position}/${style}: the right edge strip (over the pillar) opens the chat dock, not the launcher`);
  }
  check(await ev(`document.querySelectorAll('.statusbar [data-status-id]').length`) === 0, `${position}/${style}: status bar has no menu items`);
  if (position === 'left' && style === 'flat') await shot('dock-left.png');
  await key('Escape'); await sleep(200);
}
await ev(`(async()=>{const m=await ${importApp('/src/lib/settings.svelte.ts')};m.settings.statusBar='right';m.settings.statusBarStyle='flat';})()`); await sleep(300);

// ── 하단 가운데 즐겨찾기 독 — 즐겨찾기가 있으면 아래 가운데 호버로 올라온다(즐겨찾기 칸만) ─────────────
// 더하기는 `addFavorites(items, beforeKey)` 하나(옛 `addFavorite` 는 없다 — 하단 독 끌어 놓기가 부르는 길)
await ev(`(async()=>{ const m=await ${importApp('lib/favorites.svelte.ts')}; m.addFavorites([{kind:'host',alias:'dev-01'}]); })()`); await sleep(400);
check(await ev(`!!document.querySelector('[data-floating-status-dock] [data-dock-favorites]')`), 'favorite added — the favorites row stands');
if (await ev(`document.querySelector('[data-floating-status-dock]')?.hidden === false`)) {
  const vw=await ev('innerWidth'), vh=await ev('innerHeight');
  await move(vw/2, vh-5); await sleep(400);
  check(await ev(`document.querySelector('[data-floating-status-dock]').dataset.expanded === 'true'`), 'bottom-center hover reveals the favorites dock');
  check(await ev(`(() => { const m=document.querySelector('.floating-menu'); return !!m.querySelector('[data-dock-favorites]') && !m.querySelector('[data-filesystem-button]') && !m.querySelector('[data-signal="settings"]'); })()`), 'favorites dock holds favorites only (no file · settings)');
  await shot('favorites-dock.png');
  await away(); await sleep(500);
} else check(false, 'favorites dock appears once a favorite exists (addFavorite missing?)');

// ── 라이트 / 다크 한 장씩 ──────────────────────────────────────────────────────────────────────
await openDockNow(); await sleep(250);
await ev(`document.documentElement.dataset.theme='light'`); await sleep(150); await shot('dock-light.png');
await ev(`document.documentElement.dataset.theme='dark'`); await sleep(150); await shot('dock-dark.png');
await key('Escape'); await sleep(200);

await checkColorThemes({ ev, check, click, sleep, send, importApp, shot });
check(errors.length===0,`runtime errors: ${JSON.stringify(errors)}`);
console.log(`Checks: ${checked}, failed: ${failed}`);
ws.close(); process.exit(failed?1:0);
