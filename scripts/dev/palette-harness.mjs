// Headless harness: **명령 팔레트** (docs/log/2026-09-25-palette.md — 디자인 4단계).
// `launcher-harness.mjs` 의 사본 — 스텁 표는 같고 시나리오만 다르다.
//
//   npx vite --port 1434 --strictPort        (다른 작업이 파일을 고치는 중이면 README ui-scale 절의 no-HMR 설정)
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-palette \
//     --window-size=1100,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/palette-harness.mjs outdir 9250
//
// 심어 두는 것: 호스트 넷(web-01 · web-02 · dev-01 · db-02) · 접속 이력 둘 · 프로젝트 둘(로컬 web-frontend ·
// 원격 api@dev-01) · 셸 하나.
//
// 보는 것: ① `Ctrl+Shift+P` 로 열린다 · 검색 줄 48px/15px · 불투명 뜬 면 · 폭 560 · 바닥 줄(↑↓ 이동 · ↵ 실행 ·
// Esc 닫기 · 접두사, Tab 없음) ② `web` → 호스트 묶음 · 첫 줄 web-01 이 골라져 있고 `Ctrl ↵ 새 탭` + `↵` ·
// 고른 줄만 힌트 · 줄 13 / 뒷글자 12 / 묶음 제목 12 · 고른 판 = `--accent-soft` · 그 밖에 강조색 없음
// ③ Enter = 지금 탭에 접속(탭 수 그대로) · Ctrl+Enter = 새 탭에 접속(같은 `open_ssh_session`, 탭 +1) ·
// 프로젝트 Ctrl+Enter = 지금 탭에 타일로 열기(`open_local_session { cwd }`, 탭 +1) ④ `합자` → "설정 › 터미널 › 합자"
// 줄, Enter = 설정 독 · 터미널 섹션 · 그 스위치에 포커스 · `webgl`(영문)도 걸린다 · 빈 질의에는 설정 줄이
// 없다 · 스위치 위 Space = 켬/끔 · **설정 모달이 떠 있으면 스위치 위에서도 `Ctrl+Shift+P` 가 쉰다**(설정이 모달 —
// 1df6879 · docs/log/2026-10-02-settings-modal.md, 팔레트는 모듈로 연다) · 글자 칸(number)에서도 쉰다 · 터미널에서는 열린다 (docs/log/2026-09-25-editable-target.md) ⑤ 라이트 캡처 ⑥ 콘솔 예외 0.
// PNG: `palette-dark.png` · `palette-settings.png` · `palette-light.png`.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
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
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
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
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
     load_snippets: null, 
     save_snippets: null, 
    // 로컬 프로젝트를 열면 이제 늘 시작 화면이 선다(2026-09-27 — docs/log/2026-09-27-folder-conversations.md). 이 판은 여는
    // 길(셸 · 명세 · 점)을 보므로 예전처럼 곧장 열게 끈다 — 시작 화면은 project-start · folder-convos 판이 본다.
    load_settings: { projects: { start_screen: 'off' } }, save_settings: null,
    host_history_list: HISTORY,
    projects_list: PROJECTS,
    git_worktree_list: [], ssh_remote_home: '/root',
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
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++, tmux: null });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
// 앱 모듈이 다 뜰 때까지 기다린다 — 찬 vite 에서는 4.5초 안에 tabs 모듈이 안 떠 첫 Ctrl+Shift+P 가 허공에 갔다
for (let i = 0; i < 60 && !(await ev(`performance.getEntriesByType('resource').some((r) => r.name.includes('app/tabs.svelte.ts')) && !!document.querySelector('[data-tile-canvas]')`)); i++) await sleep(250);
await sleep(800);

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, Space: 32 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && k.length === 1 ? { text: k } : {}) }); await sleep(200); };
const CTRL = 2, SHIFT = 8;
const type = async (text) => { await send("Input.insertText", { text }); await sleep(300); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const tabsMod = importApp("app/tabs.svelte.ts");
const tabCount = () => ev(`(async () => (await ${tabsMod}).currentWorkspaceTabs().length)()`);
const P = `document.querySelector('.palette')`;
const openPalette = async () => { await key("KeyP", CTRL | SHIFT, "P"); await sleep(400); };
/** 목록 요약 — "묶음:줄라벨" 들 */
const rows = () => ev(`[...${P}.querySelectorAll('[data-row]')].map(b => b.querySelector('.label')?.textContent.trim()).join('|')`);
const sections = () => ev(`[...${P}.querySelectorAll('.section')].map(e => e.textContent.trim()).join('|')`);
const selLabel = () => ev(`${P}.querySelector('[data-row].sel .label')?.textContent.trim() ?? null`);
/** var(--x) 가 풀린 계산값 — 탐침 요소 하나로 */
const cssVal = (v, prop = "background-color") => ev(`(() => { const d = document.createElement('div'); d.style.setProperty('${prop}', 'var(${v})'); document.body.appendChild(d); const c = getComputedStyle(d).getPropertyValue('${prop}'); d.remove(); return c; })()`);

// ── ① 열기 · 모양 ─────────────────────────────────────────────────────────────
await openPalette();
check((await ev(`!!${P}`)) === true, "Ctrl+Shift+P 로 팔레트가 열린다");
check((await ev(`document.activeElement?.classList.contains('q')`)) === true, "입력칸에 포커스");
const geo = await ev(`(() => { const p = ${P}; const s = p.querySelector('.search'); const q = p.querySelector('.q'); return [Math.round(p.getBoundingClientRect().width), Math.round(s.getBoundingClientRect().height), getComputedStyle(q).fontSize].join('|'); })()`);
check(geo === "560|48|15px", `폭 560 · 검색 줄 48 · 입력 15px (${geo})`);
// 키로 연 자리 — 어디서 열든 타일 캔버스 가로 가운데 · 캔버스 위 + 높이 12% (시작 화면 검색 칸에 겹쳐 펼치던 자리는
// 2026-10-28 위젯 판에서 칸과 함께 걷었다 — docs/log/2026-10-28-start-widgets.md)
const keyPos = await ev(`(() => { const p = ${P}.getBoundingClientRect(); const c = document.querySelector('[data-tile-canvas]').getBoundingClientRect(); const d = [p.left + p.width / 2 - (c.left + c.width / 2), p.top - (c.top + c.height * 0.12)]; return { ok: d.every(v => Math.abs(v) <= 1), d: d.map(v => Math.round(v * 10) / 10) }; })()`);
check(keyPos?.ok === true, `키로 연 자리 — 기본 자리(캔버스 가운데 · 위 12%) (차 ${JSON.stringify(keyPos?.d)})`);
const solid = await cssVal("--surface-raised-solid");
check((await ev(`getComputedStyle(${P}).backgroundColor`)) === solid, `판 = --surface-raised-solid (${solid})`);
const foot = await ev(`${P}.querySelector('[data-palette-foot]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
check(typeof foot === "string" && foot.startsWith("↑↓이동 ↵실행 Esc닫기"), `바닥 줄 = ↑↓ 이동 · ↵ 실행 · Esc 닫기 (${foot})`);
check(typeof foot === "string" && /> ?명령/.test(foot) && foot.includes("@탭") && foot.includes("!이력"), "바닥 줄 오른쪽 = 접두사");
const footFits = await ev(`(() => { const f = ${P}.querySelector('[data-palette-foot]'); const last = [...f.querySelectorAll('.grp')].pop(); return last.getBoundingClientRect().right <= f.getBoundingClientRect().right - 12; })()`);
check(footFits === true, "바닥 줄이 넘치지 않는다(마지막 접두사까지 보인다)");
check(typeof foot === "string" && !foot.includes("Tab"), "Tab 범위 좁히기는 없다(그런 길이 없다)");
check((await sections()) .startsWith("최근|호스트"), `빈 질의 = 최근 → 호스트 … (${await sections()})`);
check(!String(await sections()).includes("설정"), "빈 질의에는 설정 묶음이 없다");

// ── ② web ───────────────────────────────────────────────────────────────────
await type("web");
check(String(await sections()).startsWith("호스트|프로젝트"), `web → 호스트 · 프로젝트 … (${await sections()})`);
check(String(await rows()).startsWith("web-01|web-02|web-frontend"), `줄 = web-01 · web-02 · web-frontend … (${await rows()})`);
check((await selLabel()) === "web-01", "첫 줄 web-01 이 골라져 있다");
const selKeys = await ev(`${P}.querySelector('[data-row].sel [data-keys]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
check(selKeys === "Ctrl+↵새 탭 ↵", `고른 호스트 줄 = Ctrl ↵ 새 탭 · ↵ (${selKeys})`);
check((await ev(`${P}.querySelectorAll('[data-keys]').length`)) === 1, "힌트는 고른 줄에만");
const sizes = await ev(`(() => { const r = ${P}.querySelector('[data-row]'); const tl = r.querySelector('.tail'); const h = ${P}.querySelector('.section'); return [getComputedStyle(r).fontSize, getComputedStyle(tl).fontSize, getComputedStyle(h).fontSize, Math.round(r.getBoundingClientRect().height), getComputedStyle(h).textTransform].join('|'); })()`);
check(sizes === "13px|12px|12px|32|none", `줄 13 · 뒷글자 12 · 묶음 제목 12 · 줄 32 · 대문자 변환 없음 (${sizes})`);
const soft = await cssVal("--accent-soft");
const accent = await cssVal("--accent");
check((await ev(`getComputedStyle(${P}.querySelector('[data-row].sel')).backgroundColor`)) === soft, `고른 판 = --accent-soft (${soft})`);
// 강조색이 팔레트 안 **어디에도** 없다 — 글자·바탕·테두리·아이콘 선 모두. 고른 판 하나만 옅은 판이다.
const accentUse = await ev(`(() => { const out = []; for (const el of [${P}, ...${P}.querySelectorAll('*')]) { const cs = getComputedStyle(el); for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'stroke', 'fill']) { const v = cs[p]; if (v === '${accent}') out.push((el.className?.baseVal ?? el.className) + ':' + p); if (v === '${soft}' && !(p === 'backgroundColor' && el.matches('[data-row].sel'))) out.push((el.className?.baseVal ?? el.className) + ':' + p + '(soft)'); } } return out.join(', '); })()`);
check(accentUse === "", `그 밖에 강조색 없음 (${accentUse || "—"})`);
console.log("capture:", await shot("palette-dark.png"));
// ↓ 로 옮기면 힌트도 따라간다
await key("ArrowDown");
check((await selLabel()) === "web-02" && (await ev(`${P}.querySelectorAll('[data-keys]').length`)) === 1, "↓ → web-02 에 힌트가 옮는다");
await key("ArrowUp");

// ── ③ Enter · Ctrl+Enter ────────────────────────────────────────────────────
let t0 = await tabCount();
let b = await ev(`window.__calls.length`);
await key("Enter"); await sleep(1200);
let ssh = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => c[0] === 'open_ssh_session').map(c => c[1].alias))`);
check(ssh === JSON.stringify(["web-01"]) && (await tabCount()) === t0, `Enter = 지금 탭에 접속 (${ssh}, 탭 ${t0} → ${await tabCount()})`);
check((await ev(`!!${P}`)) === false, "실행 뒤 팔레트가 닫힌다");

await openPalette(); await type("web-02");
t0 = await tabCount(); b = await ev(`window.__calls.length`);
await key("Enter", CTRL); await sleep(1200);
ssh = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => c[0] === 'open_ssh_session').map(c => c[1].alias))`);
check(ssh === JSON.stringify(["web-02"]) && (await tabCount()) === t0 + 1, `Ctrl+Enter = 새 탭에 접속, 같은 invoke (${ssh}, 탭 ${t0} → ${await tabCount()})`);

await openPalette(); await type("web-front");
check((await selLabel()) === "web-frontend", `web-front → 프로젝트 줄 (${await selLabel()})`);
const projKeys = await ev(`${P}.querySelector('[data-row].sel [data-keys]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
check(projKeys === "Ctrl+↵지금 탭에 ↵", `고른 프로젝트 줄 = Ctrl ↵ 지금 탭에 · ↵ (${projKeys})`);
t0 = await tabCount(); b = await ev(`window.__calls.length`);
await key("Enter", CTRL); await sleep(1200);
const loc = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => c[0] === 'open_local_session').map(c => c[1].cwd))`);
check(loc === JSON.stringify(["C:\\src\\web-frontend"]) && (await tabCount()) === t0, `프로젝트 Ctrl+Enter = 새 탭에서 열기 (${loc}, 탭 ${t0} → ${await tabCount()})`);

// ── ④ 설정 색인 ─────────────────────────────────────────────────────────────
await openPalette(); await type("합자");
check(String(await sections()).includes("설정"), `합자 → 설정 묶음 (${await sections()})`);
const setRow = await ev(`[...${P}.querySelectorAll('[data-row] .label')].map(e => e.textContent.trim()).find(s => s.startsWith('설정 ›')) ?? null`);
check(setRow === "설정 › 터미널 › 합자", `줄 = 설정 › 터미널 › 합자 (${setRow})`);
check((await selLabel()) === "설정 › 터미널 › 합자", "첫 줄로 골라져 있다");
console.log("capture:", await shot("palette-settings.png"));
await key("Enter"); await sleep(900);
const dockMod = importApp("app/dock.svelte.ts");
check((await ev(`(async () => (await ${dockMod}).dockKind())()`)) === "settings", "Enter = 설정 독이 열린다");
const navActive = await ev(`document.querySelector('.dock .nav-item.active')?.textContent.trim() ?? null`);
check(navActive === "터미널", `터미널 섹션이 펴졌다 (${navActive})`);
check((await ev(`document.activeElement?.id ?? null`)) === "term-ligatures", `합자 스위치에 포커스 (${await ev(`document.activeElement?.id ?? null`)})`);
const inView = await ev(`(() => { const el = document.querySelector('.dock #term-ligatures'); const panel = el.closest('.settings-panel'); const a = el.getBoundingClientRect(), p = panel.getBoundingClientRect(); return a.top >= p.top && a.bottom <= p.bottom; })()`);
check(inView === true, "그 줄이 패널 안에 보인다");

// 스위치 위의 맨 Space 는 여전히 스위치의 것이다(`isControlOwnedKey`) — 켬/끔이 바뀌고 팔레트는 안 뜬다.
const lig0 = await ev(`document.querySelector('#term-ligatures').checked`);
await key("Space", 0, " "); await sleep(300);
check((await ev(`document.querySelector('#term-ligatures').checked`)) === !lig0 && (await ev(`!!${P}`)) === false, "스위치 위 Space = 켬/끔 (전역 키가 가로채지 않는다)");
await key("Space", 0, " "); await sleep(300); // 되돌린다
// 합자를 켜고 끄면 터미널이 애드온을 다시 걸며 포커스를 가져간다(이 판과 무관) — 스위치로 되돌려 놓는다.
await ev(`document.querySelector('#term-ligatures').focus()`);

// 독이 떠 있는 채로 다른 섹션의 줄 — 독 교체 없이 섹션과 스크롤만 옮는다.
// 설정은 이제 **모달**이다(1df6879 · docs/log/2026-10-02-settings-modal.md) — 떠 있는 동안 `anyModalOpen()` 이라
// 전역 키가 통째로 쉰다(스위치 위든 글자 칸이든). 인쇄 대화상자는 캡처 단계의 `isBrowserChromeCombo` 가 막는다.
// 그래서 이 판은 팔레트를 모듈로 연다.
const ovMod = importApp("app/overlays.svelte.ts");
const afterSpace = await ev(`(() => { const a = document.activeElement; return a ? a.tagName + '#' + a.id + ':' + (a.type ?? '') : null; })()`);
check(afterSpace === "INPUT#term-ligatures:checkbox", `포커스가 스위치에 있다 (${afterSpace})`);
await openPalette();
check((await ev(`!!${P}`)) === false && (await ev(`document.activeElement?.id ?? null`)) === "term-ligatures", "설정 모달에서는 스위치 위에서도 Ctrl+Shift+P 가 쉰다 (모달 우선)");
await ev(`(async () => (await ${ovMod}).openPalette(''))()`); await sleep(400);
check((await ev(`!!${P}`)) === true, "설정 모달 위에 팔레트를 (모듈로) 연다");
await type("검토 대기 만료");
check((await selLabel()) === "설정 › 자동 승인 › 검토 대기 만료", `자동 승인 줄 (${await selLabel()})`);
await key("Enter"); await sleep(900);
check((await ev(`document.querySelector('.dock .nav-item.active')?.textContent.trim()`)) === "자동 승인", "독이 떠 있어도 섹션이 옮는다");
check((await ev(`document.activeElement?.id ?? null`)) === "approval-ttl", `검토 대기 만료 칸에 포커스 (${await ev(`document.activeElement?.id ?? null`)})`);
// 글자를 치는 칸(`type=number`)에서는 (모달이 아니어도) 전역 키가 비켜 준다 → 팔레트는 모듈로 연다.
await openPalette();
check((await ev(`!!${P}`)) === false && (await ev(`document.activeElement?.id ?? null`)) === "approval-ttl", "글자 칸(number)에서는 Ctrl+Shift+P 가 쉰다 (예전 그대로)");

// 영문 anchor 로도 걸린다
await ev(`(async () => (await ${ovMod}).openPalette(''))()`); await sleep(400); await type("webgl");
const webgl = await ev(`[...${P}.querySelectorAll('[data-row] .label')].map(e => e.textContent.trim()).find(s => s.startsWith('설정 ›')) ?? null`);
check(webgl === "설정 › 터미널 › WebGL 가속", `webgl(영문) → WebGL 가속 (${webgl})`);
// 섹션 줄
await key("Escape"); await sleep(200);
await ev(`(async () => (await ${ovMod}).openPalette(''))()`); await sleep(400); await type("단축키");
const keysRow = await ev(`[...${P}.querySelectorAll('[data-row] .label')].map(e => e.textContent.trim()).find(s => s.startsWith('설정 ›')) ?? null`);
check(keysRow === "설정 › 단축키", `섹션 줄 = 설정 › 단축키 (${keysRow})`);
await key("Escape"); await sleep(300);
await ev(`(async () => (await ${dockMod}).closeDock())()`); await sleep(300);

// 터미널 포커스 규칙은 그대로다 — xterm 의 숨은 textarea 위에서도 Ctrl+Shift+P 가 팔레트를 연다.
const xtaFocused = await ev(`(() => { const ta = [...document.querySelectorAll('.xterm-helper-textarea')].find(e => e.offsetParent !== null || e.closest('.xterm')?.getBoundingClientRect().width > 0); if (!ta) return false; ta.focus(); return document.activeElement === ta; })()`);
check(xtaFocused === true, "터미널(xterm 숨은 textarea)에 포커스");
await openPalette();
check((await ev(`!!${P}`)) === true, "터미널에서도 Ctrl+Shift+P 로 팔레트가 열린다 (규칙 불변)");
await key("Escape"); await sleep(300);

// ── ⑤ 라이트 ─────────────────────────────────────────────────────────────────
const modeMod = importApp("mode.svelte.ts");
await ev(`(async () => { const m = await ${modeMod}; m.setAppMode('light'); })()`); await sleep(500);
await openPalette(); await type("web");
const softL = await cssVal("--accent-soft");
check((await ev(`getComputedStyle(${P}.querySelector('[data-row].sel')).backgroundColor`)) === softL, `라이트 고른 판 = --accent-soft (${softL})`);
console.log("capture:", await shot("palette-light.png"));
await key("Escape"); await sleep(300);
await ev(`(async () => { const m = await ${modeMod}; m.setAppMode('dark'); })()`); await sleep(300);

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" / ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
