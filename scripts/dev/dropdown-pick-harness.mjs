// 고르개(Dropdown) 열기·고르기 — 진짜 마우스로 손잡이를 눌러 펴고 줄을 누른다(층 · 바로 닫힘까지 잡는다, 10-18).
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
const settingsMod = importApp('settings/model/store.svelte.ts');

const CSS_ESC = (id) => id.replace(/([^a-zA-Z0-9_-])/g, "\$1");
/** 진짜 마우스(층 판정까지 거친다) — 요소 가운데를 누르고 뗀다 */
const clickAt = async (selector) => {
  const r = await ev(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'center' }); const b = el.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2, w: b.width, h: b.height }); })()`);
  if (!r) return null;
  const { x, y, w, h } = JSON.parse(r);
  await sleep(60);
  const hit = await ev(`(() => { const t = document.elementFromPoint(${x}, ${y}); const el = document.querySelector(${JSON.stringify(selector)}); return t ? (el.contains(t) ? 'self' : (t.className?.baseVal ?? t.className ?? t.tagName)) : 'none'; })()`);
  for (const type of ["mousePressed", "mouseReleased"]) await send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  await sleep(150);
  return { hit, w: Math.round(w), h: Math.round(h) };
};

/** 고르개 하나 — 손잡이를 눌러 펴고, 지금 값이 아닌 첫 줄을 눌러 고른다. 손잡이 글자가 그 줄로 바뀌었나를 본다 */
const tryPick = async (label, triggerSel) => {
  const t1 = await clickAt(triggerSel);
  if (!t1) { check(false, `${label}: 손잡이 없음 (${triggerSel})`); return; }
  const list = await ev(`(() => { const tr = document.querySelector(${JSON.stringify(triggerSel)}); const id = tr.getAttribute('aria-controls'); const l = id && document.getElementById(id); if (!l) return null; const b = l.getBoundingClientRect(); return JSON.stringify({ expanded: tr.getAttribute('aria-expanded'), rows: l.querySelectorAll('[role=option]').length, w: Math.round(b.width), h: Math.round(b.height), id }); })()`);
  if (!list) { check(false, `${label}: 눌러도 목록이 안 열린다 (hit=${t1.hit}, 손잡이 ${t1.w}×${t1.h})`); return; }
  const L = JSON.parse(list);
  const target = await ev(`(() => { const l = document.getElementById(${JSON.stringify(L.id)}); const o = [...l.querySelectorAll('[role=option]')].find((x) => x.getAttribute('aria-selected') !== 'true'); if (!o) return null; o.setAttribute('data-harness-pick', ''); return o.textContent.trim(); })()`);
  if (!target) { check(false, `${label}: 고를 다른 줄이 없다 (${list})`); return; }
  const t2 = await clickAt(`#${L.id} [data-harness-pick]`);
  await sleep(200);
  const now = await ev(`(() => { const tr = document.querySelector(${JSON.stringify(triggerSel)}); return (tr.querySelector('.cur-text')?.textContent ?? '').trim() + '|' + tr.getAttribute('aria-expanded'); })()`);
  const [text, exp] = String(now).split("|");
  check(text === target && exp === "false", `${label}: 열림(${L.rows}줄 ${L.w}×${L.h}) · 고른 줄 hit=${t2?.hit} · 손잡이 "${text}" = "${target}" · 닫힘 ${exp}`);
};

// ── 설정 › 일반(언어) · 터미널(테마 프리셋) ──
for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('.settings-modal:not([hidden]) #app-language')`)); i++) {
  await ev(`(async () => { (await ${dockMod}).openDock('settings'); })()`); await sleep(400);
  await ev(`document.querySelector('.settings-modal [data-nav-tab="general"]')?.click()`); await sleep(200);
}
await ev(`document.querySelector('.settings-modal [data-nav-tab="general"]')?.click()`); await sleep(300);
await tryPick("설정 › 일반 › 언어", "#app-language");
await ev(`(async () => { (await ${settingsMod}).settings.current.app.language = undefined; })()`);
await ev(`document.querySelector('.settings-modal [data-nav-tab="terminal"]').click()`); await sleep(400);
const before = await ev(`(async () => (await ${settingsMod}).settings.presetKey)()`);
await tryPick("설정 › 터미널 › 테마", "#term-preset");
const after = await ev(`(async () => (await ${settingsMod}).settings.presetKey)()`);
check(before !== after, `터미널 테마 값이 실제로 바뀐다 (${before} → ${after})`);
await shot("dd-term-preset.png");

// 월페이퍼 전체(full) — 터미널이 `dynamic` 팔레트일 때(사용자 설정과 같은 모양) 프리셋으로 바꾼다
console.log("full setup:", await ev(`(async () => { const m = await ${settingsMod}; const th = (await import(performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('/lib/theme.ts')))).TERM_PRESETS['graphite-light'].theme; m.settings.current.terminal.dynamic = { ...th, 'before-theme': 'aynx-dark', 'source-color': '#cae87a' }; m.settings.current.terminal.theme = 'dynamic'; m.settings.current.app.dynamic = 'full'; m.applySettings(); return 'ok'; })()`));
await sleep(400);
const fullBefore = await ev(`(async () => (await ${settingsMod}).settings.presetKey)()`);
// 긴 목록을 휠로 끝까지 굴린다 — 열린 채 남고, 굴러가는 것은 안쪽 상자뿐(바깥 판 · 흐림 층은 제자리, 10-18)
{
  await clickAt("#term-preset");
  const box = JSON.parse(await ev(`(() => { const s = document.querySelector('#term-preset-listbox .md3-scroll'); const b = s.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`));
  for (let i = 0; i < 8; i++) { await send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: 200 }); await sleep(60); }
  await sleep(200);
  const st = JSON.parse(await ev(`(() => { const l = document.getElementById('term-preset-listbox'); const s = l?.querySelector('.md3-scroll'); return JSON.stringify({ open: !!l && document.querySelector('#term-preset').getAttribute('aria-expanded'), outer: l?.scrollTop ?? -1, inner: s ? Math.round(s.scrollTop) : -1, max: s ? s.scrollHeight - s.clientHeight : -1, bg: l ? getComputedStyle(l).backgroundColor : '' }); })()`));
  check(st.open === "true" && st.outer === 0 && st.inner > 0 && st.inner >= st.max - 1, `휠로 끝까지 굴려도 열린 채 · 바깥 0 · 안쪽 ${st.inner}/${st.max} (${JSON.stringify(st)})`);
  await shot("dd-term-preset-scrolled.png");
  await ev(`document.querySelector('#term-preset').closest('.dd').querySelector('.menu-backdrop')?.click()`); await sleep(200);
}
await tryPick("설정 › 터미널 › 테마(월페이퍼 full · dynamic)", "#term-preset");
const fullAfter = await ev(`(async () => { const m = await ${settingsMod}; return m.settings.presetKey + '|' + m.settings.current.app.dynamic; })()`);
check(fullBefore === "dynamic" && !String(fullAfter).startsWith("dynamic"), `full 에서 프리셋으로 바꾸면 값이 바뀐다 (${fullBefore} → ${fullAfter})`);
await sleep(1500);
const later = await ev(`(async () => { const m = await ${settingsMod}; return m.settings.presetKey + '|' + m.settings.current.app.dynamic; })()`);
check(later === fullAfter, `1.5초 뒤에도 그대로 (${later})`);

// ── 설정 › MCP 서버 추가 — 범위 · 스니펫 추가 — 범위 ──
await ev(`document.querySelector('.settings-modal [data-nav-tab="mcp"]').click()`); await sleep(300);
await ev(`document.querySelector('#ai-mcp-add')?.click()`); await sleep(400);
await tryPick("설정 › MCP 서버 › 범위", "#ai-mcp-form-scope");
await ev(`document.querySelector('.settings-modal [data-nav-tab="snippets"]').click()`); await sleep(300);
await ev(`document.querySelector('#snip-add')?.click()`); await sleep(500);
const snipId = await ev(`document.querySelector('.settings-panel > section:not([hidden]) .ff[data-field="scope"] [role="combobox"]')?.id ?? null`);
await tryPick("설정 › 스니펫 › 범위", snipId ? "#" + CSS_ESC(snipId) : "#missing-snippet-scope");

// ── 스니펫 저장 대화상자 — 범위(SSH 타일이면 둘) ──
await ev(`(async () => { (await ${dockMod}).closeDock(); })()`); await sleep(300);
await ev(`(async () => { (await ${importApp('app/snippets.svelte.ts')}).openSnippetSave('ls -la', 'dev-01'); })()`); await sleep(500);
await tryPick("스니펫 저장 › 범위", "#snippet-save-scope");

console.log(errors.length ? "errors: " + errors.join(" / ") : "no page errors");
console.log(failed ? `FAILED ${failed}` : "ALL PASS");
ws.close();
process.exit(failed ? 1 : 0);
