// Headless harness: **런처 독 — 두 칸의 한 면** (docs/log/2026-09-25-unified-dock.md).
// `dock-slide-harness.mjs` 의 사본 — 스텁 표를 늘리고 시나리오만 다르다.
//
//   npx vite --port 1434 --strictPort        (다른 작업이 파일을 고치는 중이면 README ui-scale 절의 no-HMR 설정)
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-dock \
//     --window-size=1100,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/dock-segments-harness.mjs outdir 9250
//
// 심어 두는 것: 호스트 셋(web-01[prod] · dev-01 · db-02) · 프로젝트 둘(로컬 aynx · 원격 api@dev-01) ·
// 워크스페이스 v2로 부팅한다.
//
// 보는 것: ⓪ 옛 상태바 순서(일곱 칸 시절 저장값)가 독 칸 하나로 접힌다 — 셋 중 첫째 자리에 ①
// Ctrl+Shift+H/J 가 그 칸으로 열고 · 같은 키는 닫고 · 다른 키는 여닫이를 다시 돌리지 않고 칸만
// 바꾼다 ② 칸 막대 클릭 = 칸 전환 + 그 칸의 검색 칸 포커스 ③ 칸마다 상태가 산다(검색어) ④ 칸 막대의
// ←/→/Home/End(감싸기 · 포커스는 막대에 머문다) ⑤ 바닥 줄 = 그 칸에 있는 키만 ⑥ 검색 알약 48px · 13px ·
// 타일 면, 줄 13px ⑦ 고른 줄 = `--accent-soft` · 그 밖에 강조색 없음 ⑧ 상태바 독 칸 하나 — 두 칸 어디서나
// 불 · 누르면 마지막 칸 · 설정 독이면 불 없음 · 말풍선에 두 조합 ⑨ 호스트 Ctrl+Enter = 새 탭 접속 ·
// 폐기 조합은 무해하다 ⑩ 설정 독은 칸 막대·바닥 줄이 없다 ⑪ 라이트. 콘솔 예외 0.
// PNG: `dock-hosts.png` · `dock-projects.png` · `dock-light.png` · `statusbar-merged.png`.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9224";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1420";
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, clip) => { const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
await send("Page.enable"); await send("Runtime.enable");
const errors = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"); });

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  performance.setResourceTimingBufferSize(5000);
  try {
    localStorage.removeItem('aynx:dock');
    // ⓪ 일곱 칸 시절의 저장값 — 셋 중 첫째(open-layouts)가 둘째 자리에 있다
    if (sessionStorage.getItem('seg-old-order') === '1')
      localStorage.setItem('aynx:status-order', JSON.stringify(['open-console', 'open-layouts', 'command-palette', 'open-localfs', 'open-projects', 'open-hosts', 'new-shell']));
    else localStorage.removeItem('aynx:status-order');
  } catch {}
  const host = (name, ip, tags) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags, forwards: [], icon: null } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const tree3 = { dir: 'row', ratio: 0.5, a: { kind: 'local' }, b: { dir: 'col', ratio: 0.5, a: { kind: 'local' }, b: { kind: 'local' } } };
  const tree2 = { dir: 'row', ratio: 0.5, a: { kind: 'local' }, b: { kind: 'local' } };
  const answers = {
    list_hosts: { hosts: [host('web-01', '10.0.0.1', ['prod']), host('dev-01', '10.0.0.2', []), host('db-02', '10.0.0.3', [])], warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
    
    load_snippets: null, 
     save_snippets: null, 
    load_settings: {}, save_settings: null, host_history_list: {},
    projects_list: [
      { id: 'L1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: null, tmux: false },
      { id: 'R1', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: null, tmux: false },
    ],
    git_worktree_list: [], ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
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
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Comma: 188 };
const key = async (code, modifiers = 0, k = code, wait = 250) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(wait); };
const typeText = async (text) => { await send("Input.insertText", { text }); await sleep(300); };
const click = async (sel) => { const r = JSON.parse(await ev(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`)); const x = r.x + r.width / 2, y = r.y + r.height / 2; await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await sleep(300); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const cssVal = (v, prop = "background-color") => ev(`(() => { const d = document.createElement('div'); d.style.setProperty('${prop}', 'var(${v})'); document.body.appendChild(d); const c = getComputedStyle(d).getPropertyValue('${prop}'); d.remove(); return c; })()`);
const reload = async () => { await send("Page.reload", { ignoreCache: true }); await sleep(4500); };

/** 독의 지금 — 열림 · 그리는 칸 · 고른 칸 단추 · 여닫이 수 · 포커스가 어느 본문의 검색 칸인가 */
const state = () => ev(`(() => {
  const d = document.querySelector('.dock');
  const a = document.activeElement;
  const body = a?.closest('.sidebar') ? 'hosts' : a?.closest('[data-project-dock]') ? 'projects' : a?.closest('.settings-view') ? 'settings' : '-';
  return JSON.stringify({
    hidden: d.hidden,
    kind: d.getAttribute('data-dock-kind'),
    seg: d.querySelector('.seg[aria-selected="true"]')?.getAttribute('data-segment') ?? null,
    anims: d.getAnimations().length,
    w: Math.round(d.getBoundingClientRect().width),
    focus: a?.classList.contains('search') ? body + ':search' : a?.hasAttribute('data-segment') ? 'seg:' + a.getAttribute('data-segment') : body + ':' + (a?.tagName ?? '?'),
  });
})()`).then(JSON.parse);
/** 바닥 줄 — 안내마다 `키 뜻` 을 ` · ` 로 잇는다 (마크업은 `<span class="hint"><Keys>(.keycaps)뜻</span>`) */
const foot = () => ev(`(() => { const f = document.querySelector('.dock .foot'); return f ? [...f.querySelectorAll('.hint')].map(h => { const k = h.querySelector('.keycaps').textContent.trim(); return k + ' ' + h.textContent.trim().slice(k.length).trim(); }).join(' · ') : null; })()`);
const leadIds = () => ev(`[...document.querySelectorAll('.statusbar .lead [data-status-id]')].map(e => e.getAttribute('data-status-id')).join('|')`);
// 상태바 독 입구 칸은 2026-10-18 실기 뒤 걷혔다 — 칸 없이 여는 길은 가장자리 호버(여기서는 같은 몸통 `revealLauncherDock`)다
const openEntry = async () => { await ev(`${importApp("app/dock.svelte")}.then(m => m.revealLauncherDock())`); };
const closeDock = async () => { await ev(`${importApp("app/dock.svelte")}.then(m => m.closeDock())`); await sleep(350); };

// ── ⓪ 옛 상태바 순서가 독 칸 하나로 접힌다 ─────────────────────────────────────
await ev(`sessionStorage.setItem('seg-old-order', '1')`);
await reload();
// 2026-10-18 통합 독 — 메뉴 칸은 전부 독 안이라 옛 저장값에서도 독 칸 하나만 선다(걷힌 id 는 조용히 버린다)
check((await leadIds()) === "", `옛 일곱 칸 순서 → 상태바에 칸이 없다 (${await leadIds()})`);
await ev(`sessionStorage.removeItem('seg-old-order')`);
await reload();
check((await leadIds()) === "", `기본 = 칸 없음 (${await leadIds()})`);
for (const old of ["open-hosts", "open-projects", "open-layouts"])
  check((await ev(`!!document.querySelector('.statusbar [data-status-id="${old}"]')`)) === false, `옛 칸 ${old} 은 없다`);
// (독 칸 말풍선 · 그림 검사는 칸과 함께 걷었다 — 2026-10-18)

// ── ① 키 셋(H · J · K) — 여는 칸 · 같은 키 닫기 · 다른 키는 칸만 ─────────────────────────
await key("KeyH", 10, "H", 500);
let s = await state();
check(!s.hidden && s.kind === "hosts" && s.seg === "hosts", `Ctrl+Shift+H → 호스트 칸 (${JSON.stringify(s)})`);
check(s.focus === "hosts:search", `열리는 순간 호스트 검색 칸에 커서 (${s.focus})`);
check((await ev(`document.querySelectorAll('.dock .segs .seg').length`)) === 4, "칸 줄 = 네 칸 (알림 · 호스트 · 프로젝트 · DB)");
const segW = await ev(`[...document.querySelectorAll('.dock .seg')].map(e => Math.round(e.getBoundingClientRect().width)).join('|')`);
check(new Set(String(segW).split("|")).size === 1, `두 칸이 같은 폭 (${segW})`);
const segStyle = await ev(`(() => { const a = document.querySelector('.dock .seg.active'), b = document.querySelector('.dock .seg:not(.active)'); const ca = getComputedStyle(a), cb = getComputedStyle(b); return [ca.fontSize, ca.fontWeight, ca.color, ca.backgroundColor, cb.color, cb.backgroundColor].join('|'); })()`);
const fg1 = await cssVal("--fg-1", "color"), ctrlFg = await cssVal("--control-fg", "color"), selBg = await cssVal("--control-sel-bg");
// 2026-10-18 MD3 내비게이션 바 — 칸 자신은 판이 없고 아이콘 뒤 알약 지시자(60×32)가 secondaryContainer 로 찬다
check(segStyle === `12px|600|${fg1}|rgba(0, 0, 0, 0)|${ctrlFg}|rgba(0, 0, 0, 0)`, `칸 = 12px · 고른 칸 fg-1 600 · 나머지 onSurfaceVariant · 칸 판 없음 (${segStyle})`);
const pill = await ev(`(() => { const a = document.querySelector('.dock .seg.active .seg-ico'), b = document.querySelector('.dock .seg:not(.active) .seg-ico'); const r = a.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height), getComputedStyle(a).backgroundColor, getComputedStyle(b).backgroundColor].join('|'); })()`);
check(pill === `60|32|${selBg}|rgba(0, 0, 0, 0)`, `알약 지시자 60×32 · 고른 칸만 secondaryContainer (${pill})`);
check((await foot()) === "↵ 접속 · Ctrl+↵ 새 탭 · F2 편집 · Esc 닫기", `호스트 바닥 줄 (${await foot()})`);
check((await ev(`document.querySelector('.dock .head .title')`)) === null, "런처 독에는 머리줄 제목이 없다 (칸 막대가 대신한다)");
const sBox = await ev(`(() => { const b = document.querySelector('.dock .sidebar .dock-search-box'); const i = b.querySelector('input'); const cs = getComputedStyle(b); return [Math.round(b.getBoundingClientRect().height), getComputedStyle(i).fontSize, cs.backgroundColor, cs.borderTopLeftRadius, cs.outlineStyle].join('|'); })()`);
// 2026-10-18 MD3 검색 알약 — 48px · surfaceContainerHigh · 알약(2026-10-25 — 24px → 999px, 모양은 같다). 커서가 든 채라 중성 포커스 링(강조색 아님)
const tileBg = await cssVal("--control-tile-bg");
check(sBox === `48|13px|${tileBg}|999px|solid`, `검색 알약 48px · 13px · surfaceContainerHigh · 포커스 링 (${sBox} vs ${tileBg})`);
await key("ArrowDown", 0, "ArrowDown");
const rowF = await ev(`(() => { const r = document.querySelector('.dock .sidebar .item'); return [getComputedStyle(r.querySelector('.name')).fontSize, Math.round(r.getBoundingClientRect().height), getComputedStyle(r.querySelector('.tag')).fontSize].join('|'); })()`);
check(String(rowF).startsWith("13px|") && String(rowF).endsWith("|12px"), `호스트 줄 13px · 태그 12px (${rowF})`);
const soft = await cssVal("--accent-soft"), accent = await cssVal("--accent");
check((await ev(`getComputedStyle(document.querySelector('.dock .sidebar .item.selected')).backgroundColor`)) === soft, `고른 호스트 줄 = --accent-soft (${soft})`);
console.log("capture:", await shot("dock-hosts.png"));

await key("KeyJ", 10, "J", 40);
s = await state();
check(!s.hidden && s.kind === "projects" && s.anims === 0, `호스트 → Ctrl+Shift+J: 여닫이 없이 프로젝트 칸 (${JSON.stringify(s)})`);
await sleep(300);
s = await state();
check(s.focus === "projects:search", `프로젝트 검색 칸에 커서 (${s.focus})`);
check((await foot()) === "↵ 열기 · Ctrl+↵ 지금 탭에 · Ins 워크트리 · Esc 닫기", `프로젝트 바닥 줄 (${await foot()})`);
await key("ArrowDown", 0, "ArrowDown");
check((await ev(`getComputedStyle(document.querySelector('[data-project-dock] .item.selected')).backgroundColor`)) === soft, "고른 프로젝트 줄 = --accent-soft");
const meta = await ev(`(() => { const w = document.querySelector('[data-project-dock] .where'); const cs = getComputedStyle(w); return [cs.fontSize, cs.backgroundColor, cs.borderTopWidth].join('|'); })()`);
check(meta === "12px|rgba(0, 0, 0, 0)|1px", `위치 = 12px 테두리 보조 칩(outlineVariant · 판 없음) (${meta})`);
// ⑦ 강조색(primary) — 실행 타일(아이콘 · 기본 셸 타일)과 고른 줄 · 칸 지시자의 secondaryContainer 판 말고는 없다
const accentUse = await ev(`(() => { const d = document.querySelector('.dock'); const out = []; for (const el of [d, ...d.querySelectorAll('*')]) { if (!el.getClientRects().length || el.closest('[data-dock-launch]') || el.closest('.seg.active')) continue; const cs = getComputedStyle(el); for (const p of ['color', 'backgroundColor', 'borderTopColor', 'borderBottomColor', 'outlineColor', 'stroke', 'fill']) { const v = cs[p]; if (v === '${accent}') out.push((el.className?.baseVal ?? el.className) + ':' + p); if (v === '${soft}' && !(p === 'backgroundColor' && el.matches('.item.selected'))) out.push((el.className?.baseVal ?? el.className) + ':' + p + '(soft)'); } } return out.join(', '); })()`);
check(accentUse === "", `프로젝트 칸: 실행 타일 · 고른 줄 · 칸 지시자 말고 강조색 없음 (${accentUse || "—"})`);
console.log("capture:", await shot("dock-projects.png"));

await key("KeyJ", 10, "J", 400);
s = await state();
check(s.hidden, `같은 키(Ctrl+Shift+J) → 닫힌다 (${JSON.stringify(s)})`);

// K 는 2026-10-21 부터 DB 칸(`open-db-dock`) — 옛 레이아웃 독 조합을 다시 쓴다
await key("KeyK", 10, "K", 500);
s = await state();
check(!s.hidden && s.kind === "db" && s.seg === "db", `Ctrl+Shift+K → DB 칸 (${JSON.stringify(s)})`);
await key("KeyK", 10, "K", 400);
check((await state()).hidden, "같은 키(Ctrl+Shift+K) → 닫힌다");
await key("KeyS", 10, "S", 200);
check((await state()).hidden, "폐기 조합 Ctrl+Shift+S 는 독을 열지 않는다");

// ── ② 칸 막대 클릭 · ③ 칸마다 상태가 산다 ──────────────────────────────────────
if ((await state()).hidden) { await key("KeyH", 10, "H", 500); }
await click('.dock [data-segment="hosts"]');
s = await state();
check(s.kind === "hosts" && s.anims === 0 && s.focus === "hosts:search", `칸 클릭 → 호스트 칸 · 여닫이 없음 · 검색 칸 포커스 (${JSON.stringify(s)})`);
await typeText("web");
await click('.dock [data-segment="projects"]');
await typeText("api");
await key("KeyH", 10, "H", 400);
const hq = await ev(`document.querySelector('.dock .sidebar input.search').value`);
const hRows = await ev(`[...document.querySelectorAll('.dock .sidebar [data-id]')].map(e => e.getAttribute('data-id')).join('|')`);
check(hq === "web" && hRows === "h:web-01", `호스트 칸으로 돌아오면 검색어 'web' · 거른 줄 그대로 (${hq} · ${hRows})`);
check((await ev(`document.querySelector('[data-project-dock] input.search').value`)) === "api", "프로젝트 칸의 검색어 'api' 도 산다");
// 이미 고른 칸을 다시 누르면 검색 칸으로만 간다
await ev(`document.querySelector('.dock .sidebar .body').focus?.()`);
await click('.dock [data-segment="hosts"]');
s = await state();
check(s.kind === "hosts" && s.focus === "hosts:search", `고른 칸을 다시 누르면 그 검색 칸으로 (${s.focus})`);

// ⑨ 호스트 Ctrl+Enter = 새 탭 접속
await ev(`(() => { const i = document.querySelector('.dock .sidebar input.search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(200);
await typeText("dev");
await key("ArrowDown", 0, "ArrowDown");
const tabCount = () => ev(`(async () => (await ${importApp("app/tabs.svelte.ts")}).currentWorkspaceTabs().length)()`);
const tabs0 = await tabCount();
const ssh0 = await ev(`window.__calls.filter(c => c[0] === 'open_ssh_session').length`);
await key("Enter", 2, "Enter", 1200);
const sshCalls = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'open_ssh_session').slice(${ssh0}).map(c => c[1]?.alias ?? '?'))`);
const tabs1 = await tabCount();
check(sshCalls === '["dev-01"]' && tabs1 === tabs0 + 1, `Ctrl+Enter → dev-01 새 탭 접속 (${sshCalls} · 탭 ${tabs0}→${tabs1})`);

// ── ④ 칸 막대의 화살표 ────────────────────────────────────────────────────────
if ((await state()).hidden) { await key("KeyH", 10, "H", 500); }
if ((await state()).kind !== "hosts") { await key("KeyH", 10, "H", 500); }
await ev(`document.querySelector('.dock [data-segment="hosts"]').focus()`);
const seqOut = [];
for (const [k, want] of [["ArrowRight", "projects"], ["ArrowRight", "db"], ["ArrowRight", "alerts"], ["ArrowLeft", "db"], ["Home", "alerts"], ["End", "db"], ["ArrowLeft", "projects"]]) {
  await key(k, 0, k, 300);
  const st = await state();
  seqOut.push(`${k}→${st.kind}/${st.focus}`);
  check(st.kind === want && st.focus === `seg:${want}` && !st.hidden, `칸 막대 ${k} → ${want} · 포커스는 막대에 (${st.kind} · ${st.focus})`);
}
console.log("arrows:", seqOut.join(" "));

// ── ⑧ 칸 없이 열기(가장자리 호버의 몸통) — 2026-10-18 실기 뒤 상태바 독 칸은 걷혔다 ─────────────────────────
await closeDock();
await openEntry(); await sleep(300);
s = await state();
check(!s.hidden && s.kind === "alerts", `칸 없이 열면 알림 칸 (${s.kind})`);
await key("Comma", 2, ",", 500);
s = await state();
check(!s.hidden && s.kind === "settings", `설정 모달 (${s.kind})`);
// ⑩ 설정 모달은 제 머리줄 — 칸 줄 · 바닥 줄 없음
check((await ev(`[!!document.querySelector('.dock .card:not([hidden]) .segs'), !!document.querySelector('.dock .foot'), document.querySelector('.dock .head .title')?.textContent.trim()].join('|')`)) === "false|false|설정", "설정 독: 칸 줄 · 바닥 줄 없음 · 제목 '설정'");
await openEntry(); await sleep(300);
check((await state()).kind === "settings", "설정 모달이 떠 있으면 칸 없이 열기는 건드리지 않는다");
await closeDock();
await key("KeyH", 10, "H", 300);
await closeDock();
await openEntry(); await sleep(300);
check((await state()).kind === "alerts", `키로 호스트 칸을 썼어도 칸 없이 열면 알림 칸 (2026-10-18 — "마지막 칸" 기억 걷음)`);
// 한 폭 — 두 칸이 같은 상자 폭
const widths = [];
for (const segment of ["hosts", "projects", "db"]) { await click(`.dock [data-segment="${segment}"]`); widths.push((await state()).w); }
check(widths.every(w => w > 0) && new Set(widths).size === 1, `세 칸이 한 폭 (${widths.join("|")})`);

// ── ⑪ 라이트 ─────────────────────────────────────────────────────────────────
await key("KeyH", 10, "H", 400);
await ev(`(async () => { const m = await ${importApp("mode.svelte.ts")}; m.setAppMode('light'); })()`); await sleep(500);
await ev(`(() => { const i = document.querySelector('.dock .sidebar input.search'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); })()`);
await sleep(200);
await key("ArrowDown", 0, "ArrowDown");
const softL = await cssVal("--accent-soft");
check((await ev(`getComputedStyle(document.querySelector('.dock .sidebar .item.selected')).backgroundColor`)) === softL, `라이트 고른 줄 = --accent-soft (${softL})`);
console.log("capture:", await shot("dock-light.png"));
await ev(`(async () => { const m = await ${importApp("mode.svelte.ts")}; m.setAppMode('dark'); })()`); await sleep(300);

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" / ")})`);
console.log(failed ? `${failed} FAILED` : "ALL PASS"); process.exit(failed ? 1 : 0);
