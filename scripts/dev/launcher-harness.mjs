// Headless harness: **빈 탭 = launcher** (docs/log/2026-09-25-launcher.md).
// `projects-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다.
//
//   npx vite --port 1434 --strictPort        (다른 작업이 파일을 고치는 중이면 README ui-scale 절의 no-HMR 설정)
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-launcher \
//     --window-size=1100,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/launcher-harness.mjs outdir 9250
//
// 심어 두는 것: 호스트 넷(web-01 · dev-01 · db-02 · stage) · 접속 이력 셋(2분 전 · 1시간 전 · 어제 —
// stage 는 이력 없음) · 프로젝트 셋(로컬 aynx · 원격 api@dev-01 · 로컬 infra) · 셸 셋(PowerShell 7 기본 ·
// Ubuntu · 명령 프롬프트) · 즐겨찾기 하나(web-01).
// aynx 은 첫 탭에 AI 타일로 열어 두고 **입력 대기**로 만든다(탭 점과 같은 신호 — `agentTitle`).
//
// 보는 것 (2026-10-28 위젯 판 — docs/log/2026-10-28-start-widgets.md): ① 처음 배치 = 위 줄 시계(글자를 감싼 264×136 — 크기 모서리 = 글자 크기) + 아래 줄 위젯 셋
// (240×208 · 가로 가운데 · 세로 가운데보다 위 — 2026-11-03) · 검색 칸 없음 · 줄의 뒷글자 · 입력 대기 프로젝트가 맨 위 · 포커스가 기본 셸 줄에 · 격자 점 없음
// ② 화살표(←→ 위젯 사이 · ↓ 위젯 안) + Enter 가 호스트 접속(`open_ssh_session { alias }`) ③ 프로젝트 줄 Enter = 열기
// (`open_local_session { cwd }`) · 최근 워크트리 줄 ④ 셸 줄 클릭 = 로컬 세션(`shell`) · 시작 타일이 교체된다 ⑤ 글자를 치면
// 팔레트(입력칸에 그 글자) — **기본 자리**(캔버스 가운데 · 위 12%)
// ⑤-4 포커스 주인 = 숨은 입력칸(`data-ime-proxy` · `data-tile-focus`, 고른 줄은 `aria-activedescendant`) ·
// IME 모의(`Process`/229 → `Input.imeSetComposition` ㅎ…한글) = 팔레트가 거울 모드로 열리고 포커스는 주인에 남는다 ·
// 조합이 아닌 첫 키(↓)에서 팔레트 입력칸이 `한글` 을 넘겨받고 ↓ 도 팔레트에 닿는다 · 확정 뒤 라틴 글자·Backspace ·
// 주인에서 전역 단축키(`Ctrl+Shift+T`)가 먹는다 (docs/log/2026-09-25-launcher.md 3절 — 진짜 IME 는 사용자 실기).
// ⑤-3 팔레트는 어디서 열든 기본 자리(상태바 넷 · 독 · 대시보드 · 터미널 탭 · 분할 안 시작 타일 · 125% 좌표계).
// ⑦ 위젯 판: 끄는 동안 점선 윤곽 · 안내선 · 제자리면 저장 없음 · 다른 위젯 위에 놓으면 빈자리 · 8px 눈금 · 우클릭 메뉴
// (배치 편집 · 편집 중에만 위젯 추가 ▸ · 되돌리기 · 리셋 — 메뉴 통로) · 크기(말풍선 · 이웃 앞에서 멈춤) · × 빼기 · 더하기(놓임 흐림) · ↑↓ 가 아래
// 위젯으로 이어짐 · 빈 판(안내 · [위젯 추가] · 팔레트 키) · 작은 창 = 통째로 축소(굴림 · 다시 흘림 없음) · 축소 중 끌기 배율 ·
// 0.5 아래면 좁은 판(한 줄로 쌓고 세로로 굴림 · 저장 배치 그대로 — 2026-11-03 0.75 에서 내림)
// ⑧ 빈 사용자(이력·프로젝트 없음) → 안내 줄. ⑨ 탭 없음 ↔ 시작 타일의 호스트 위젯 top/left ±0.5px — 가로/세로 상태바 · flat/panel.
// PNG: `launcher-dark.png` · `launcher-light.png` · `launcher-moved.png` · `launcher-empty-board.png` · `launcher-small.png` · `launcher-narrow.png` ·
// `launcher-empty.png` · `launcher-key-left.png` · `palette-default-left.png`.
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
  // 빈 사용자 판(⑧)은 sessionStorage 표식으로 고른다 — 이력·프로젝트·즐겨찾기가 없다.
  const EMPTY = sessionStorage.getItem('launcher-empty') === '1';
  try {
    // 위젯 배치는 늘 처음 배치에서 시작한다(문서마다)
    localStorage.removeItem('aynx:start-widgets');
    localStorage.removeItem('aynx:start-clock');
    if (EMPTY) localStorage.removeItem('aynx:favorites');
    else localStorage.setItem('aynx:favorites', JSON.stringify([{ kind: 'host', alias: 'web-01' }]));
    // 최근 연 워크트리 둘 — feat-x(2시간 전, 살아 있다) · gone(폴더가 없다 → local_stat 이 실패해 조용히 빠진다)
    // (docs/log/2026-09-27-launcher-worktrees.md)
    if (EMPTY) localStorage.removeItem('aynx:projects:recentOpens');
    else localStorage.setItem('aynx:projects:recentOpens', JSON.stringify([
      { projectId: 'P1', worktree: 'C:\\\\src\\\\proj-wt\\\\feat-x', label: 'feat-x', at: Date.now() - 2 * 3600e3 },
      { projectId: 'P1', worktree: 'C:\\\\src\\\\proj-wt\\\\gone', label: 'gone', at: Date.now() - 3 * 3600e3 },
    ]));
  } catch {}
  const host = (name, ip) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } });
  const HOSTS = [host('web-01', '10.0.0.1'), host('dev-01', '10.0.0.2'), host('db-02', '10.0.0.3'), host('stage', '10.0.0.4')];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const NOW = Date.now();
  const ok = (ago, count) => ({ last_ok_at: NOW - ago, last_fail_at: null, last_fail_cause: null, last_fail_message: null, count });
  const HISTORY = EMPTY ? {} : { 'web-01': ok(2 * 60e3, 12), 'dev-01': ok(60 * 60e3, 4), 'db-02': ok(26 * 3600e3, 2) };
  const PROJECTS = EMPTY ? [] : [
    { id: 'P1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: 'claude', tmux: false },
    { id: 'P2', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: 'claude', tmux: false },
    { id: 'P3', name: 'infra', host: null, path: 'C:\\\\src\\\\infra', shell: null, command: '', tmux: false },
  ];
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    // 백엔드 라벨은 일부러 화면 이름과 다르다 — 셸 단은 id 로 지금 언어의 이름을 고른다(shellInfoLabel)
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }, { id: 'wsl:Ubuntu', label: 'Ubuntu (WSL)' }, { id: 'cmd', label: 'Command Prompt' }], default_id: 'pwsh' },
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
    mcp_status: { clis: [] },
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
      if (cmd === 'local_stat') return String(args?.path).includes('gone') ? Promise.reject(new Error('not found')) : Promise.resolve({ name: 'x', kind: 'dir' });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await ev(`sessionStorage.removeItem('launcher-empty')`);
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);

const VK = { Enter: 13, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, F10: 121 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && k.length === 1 ? { text: k } : {}) }); await sleep(200); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
/** 보이는 launcher (여러 탭이면 활성 탭의 것) */
const L = `[...document.querySelectorAll('[data-launcher]')].find(el => el.getClientRects().length > 0)`;
/** 키보드가 가리키는 줄 — 포커스 주인(숨은 입력칸)이면 `aria-activedescendant` 가 가리키는 줄 */
const activeKey = () => ev(`(() => { const a = document.activeElement; const id = a?.getAttribute('aria-activedescendant'); const el = id ? document.getElementById(id) : a; return el?.getAttribute('data-launch-key') ?? ('<' + (a?.className || a?.tagName) + '>'); })()`);
const selectedKeys = () => ev(`[...${L}.querySelectorAll('.selected [data-launch-key], [data-launch-key].selected')].map(e => e.getAttribute('data-launch-key')).join('|')`);
const newStartTab = async () => { await key("KeyT", 10, "T"); await sleep(900); };
/** 위젯 하나의 줄 이름 · 뒷글자 */
const colNames = (kind) => ev(`[...${L}.querySelectorAll('[data-start-widget="${kind}"] .row .name')].map(e => e.textContent.trim()).join('|')`);
const colMeta = (kind) => ev(`[...${L}.querySelectorAll('[data-start-widget="${kind}"] .row')].map(e => e.querySelector('.meta')?.textContent.trim() ?? '').join('|')`);
/** 저장된 배치 — 없으면 null(처음 배치) */
const stored = async () => JSON.parse((await ev(`localStorage.getItem('aynx:start-widgets')`)) ?? "null");
/** 화면의 위젯 사각형 */
const rectOf = (kind) => ev(`(() => { const r = ${L}?.querySelector('[data-start-widget="${kind}"]')?.getBoundingClientRect(); return r ? { left: r.left, top: r.top, w: r.width, h: r.height } : null; })()`);
const centerOf = (sel) => ev(`(() => { const e = ${L}.querySelector('${sel}'); if (!e) return null; const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
const mouse = (type, x, y, button = "left", buttons = 1) => send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" && buttons === 0 ? "none" : button, buttons, clickCount: type === "mouseMoved" ? 0 : 1 });
/** 손잡이를 (dx, dy) 만큼 끈다 — 놓기 직전에 `during()` 으로 화면을 본다 */
const dragBy = async (sel, dx, dy, during) => {
  const c = await centerOf(sel);
  if (!c) return { missing: true };
  const [x, y] = c;
  await mouse("mouseMoved", x, y, "none", 0);
  await mouse("mousePressed", x, y);
  for (let i = 1; i <= 6; i++) { await mouse("mouseMoved", x + (dx * i) / 6, y + (dy * i) / 6); await sleep(16); }
  await sleep(120);
  const mid = during ? await during() : null;
  await mouse("mouseReleased", x + dx, y + dy, "left", 0);
  await sleep(250);
  return mid;
};
/** 판의 빈 자리 우클릭 — 판 왼쪽 위 모서리 근처(처음 배치 · 정리 배치의 위젯은 가운데에 선다) */
const rightClickEmpty = async () => {
  const r = await ev(`(() => { const r = ${L}.getBoundingClientRect(); return [r.left + 60, r.top + 40]; })()`);
  await mouse("mouseMoved", r[0], r[1], "none", 0);
  await mouse("mousePressed", r[0], r[1], "right", 2);
  await mouse("mouseReleased", r[0], r[1], "right", 0);
  await sleep(300);
  return r;
};
const overlapFree = (rs) => rs.every((a, i) => rs.every((b, j) => i === j || a.left + a.w <= b.left || b.left + b.w <= a.left || a.top + a.h <= b.top || b.top + b.h <= a.top));
/** 칸 없이 연 자리 = 타일 캔버스 기준 — [판 가운데 − 캔버스 가운데, 판 위 − (캔버스 위 + 캔버스 높이 12%)] (1px 안) */
const canvasDiff = () => ev(`(() => { const p = document.querySelector('.palette')?.getBoundingClientRect(); const c = document.querySelector('[data-tile-canvas]')?.getBoundingClientRect(); if (!p || !c) return null; return [p.left + p.width / 2 - (c.left + c.width / 2), p.top - (c.top + c.height * 0.12)].map(v => Math.round(v * 10) / 10); })()`);
const within1 = (d) => Array.isArray(d) && d.every((v) => Math.abs(v) <= 1);

// ── 준비: aynx 을 첫 탭에 AI 타일로 열고 입력 대기로 ─────────────────────────────
const projMod = importApp("app/projects.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");
const agentMod = importApp("app/agent-status.svelte.ts");
await ev(`(async () => { const m = await ${projMod}; const p = m.projects().find(p => p.id === 'P1'); await m.openProject(p); })()`);
await sleep(1200);
const agentPane = await ev(`(async () => { const m = await ${tabsMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); for (const tab of m.residentWindowTabs()) for (const p of walk(tab.root, [])) if (p.cwd === 'C:\\\\src\\\\proj') return p.id; return null; })()`);
check(typeof agentPane === "string", `준비: aynx AI 타일이 열렸다 (${agentPane})`);
await newStartTab();
// 입력 대기 = "출력이 조용해진 뒤 제목이 바뀌었다" (projects-harness ⑦ 과 같은 신호 순서 · AGENT_QUIET_MS = 3000)
const report = (fn) => ev(`(async () => { const a = await ${agentMod}; const w = await ${tabsMod}; a.${fn}(w.findPaneAnywhere('${agentPane}')); })()`);
// 첫 입력(claude)이 실려야 AI 타일로 읽힌다 — 차가운 dev 서버에서는 늦게 온다(최대 8초 기다린다)
for (let i = 0; i < 16; i++) {
  if ((await ev(`(async () => { const a = await ${agentMod}; const w = await ${tabsMod}; return a.isAgentPane(w.findPaneAnywhere('${agentPane}')); })()`)) === true) break;
  await sleep(500);
}
await report("agentOutput"); await sleep(3600);
await report("agentTitle"); await sleep(600);

// ── ① 화면 ─────────────────────────────────────────────────────────────────
check((await ev(`!!${L}`)) === true, "새 탭 = launcher");
check((await ev(`!!${L}.querySelector('img.logo, .brand')`)) === false, "큰 로고·브랜드 글자가 없다");
check((await ev(`!!document.querySelector('[data-launcher-search]')`)) === false, "검색 칸 모양 단추가 없다(2026-10-28)");
const kinds = await ev(`[...${L}.querySelectorAll('[data-start-widget]')].map(e => e.getAttribute('data-start-widget')).join('|')`);
check(kinds === "clock|hosts|projects|shells", `처음 배치 = 시계 + 위젯 셋 (${kinds})`);
check((await stored()) === null, "저장된 배치 없음 = 처음 배치");
const heads = await ev(`[...${L}.querySelectorAll('[data-start-widget] h3')].map(e => e.textContent.trim()).join('|')`);
check(heads === "최근 호스트|프로젝트|셸", `위젯 제목 셋 — 시계는 머리 줄이 없다 (${heads})`);
// 시계는 카드가 아니다 — 칠 · 그림자 없이 글자만, 따로 있는 끌 손잡이도 없다(목록 위젯은 머리 줄 · 시계는 몸이 끄는 자리)
const bare = await ev(`(() => { const c = ${L}.querySelector('[data-start-widget="clock"]'); const cs = getComputedStyle(c); return [cs.backgroundImage === 'none' && cs.backgroundColor === 'rgba(0, 0, 0, 0)', cs.boxShadow === 'none', ${L}.querySelectorAll('[data-widget-grip], [data-widget-remove], [data-widget-resize]').length === 0, getComputedStyle(${L}.querySelector('[data-start-widget="hosts"]')).cursor !== 'grab', !${L}.hasAttribute('data-start-editing')].join('|'); })()`);
check(bare === "true|true|true|true|true", `시계 = 맨몸 · 평소(잠김) = 끄는 자리 · × · 모서리 없음 (${bare})`);
// 시계 — 큰 숫자 HH:MM(처음 값 24시간 · 초 없음) + 날짜 · 요일 한 줄, 숫자는 tabular-nums
const clk = await ev(`(() => { const t = ${L}.querySelector('[data-start-clock-time]'); const d = ${L}.querySelector('[data-start-clock-date]'); return t && d ? { time: t.textContent.trim(), date: d.textContent.trim(), num: getComputedStyle(t).fontVariantNumeric, big: parseFloat(getComputedStyle(t).fontSize) } : null; })()`);
check(!!clk && /^\d{2}:\d{2}$/.test(clk.time) && /요일$/.test(clk.date) && clk.num.includes("tabular-nums") && clk.big >= 40, `시계 = HH:MM · 날짜 요일 · tabular-nums · 큰 숫자 (${JSON.stringify(clk)})`);
check((await colNames("hosts")) === "web-01|dev-01|db-02", `최근 호스트 = 이력 있는 셋, 늦은 순 (${await colNames("hosts")})`);
check((await colMeta("hosts")) === "2분 전|1시간 전|1일 전", `뒷글자 = 상대 시각 (${await colMeta("hosts")})`);
// 최근 워크트리 줄(feat-x, 2시간 전)이 시각 순으로 끼고 · 폴더가 없는 gone 은 빠진다
check((await colNames("projects")) === "aynx|api|aynx · feat-x|infra", `프로젝트 = 입력 대기 aynx 이 맨 위 · 최근 워크트리가 시각 순으로 (${await colNames("projects")})`);
check((await colMeta("projects")) === "로컬|dev-01|로컬|로컬", `위치 = 로컬 / 호스트 (${await colMeta("projects")})`);
const dots = await ev(`[...${L}.querySelectorAll('[data-start-widget="projects"] [data-agent-dot]')].map(e => e.getAttribute('data-agent-dot')).join('|')`);
check(dots === "waiting|none|none|none", `에이전트 점 = 주 폴더의 입력 대기 하나 — 워크트리 줄에 번지지 않는다 (${dots})`);
const wtKind = await ev(`[...${L}.querySelectorAll('[data-start-widget="projects"] .row')].map(e => e.getAttribute('data-launch-kind')).join('|')`);
check(wtKind === "project|project|worktree|project", `줄 종류 (${wtKind})`);
check((await colNames("shells")) === "PowerShell 7|WSL: Ubuntu|명령 프롬프트", `셸 = 기본 셸 먼저 (${await colNames("shells")})`);
check((await colMeta("shells")) === "↵||", `기본 셸에만 ↵ (${await colMeta("shells")})`);
check((await activeKey()) === "shell:pwsh", `포커스가 기본 셸 줄에 (${await activeKey()})`);
check((await selectedKeys()) === "shell:pwsh", `고른 줄 하나 (${await selectedKeys()})`);
const selBg = await ev(`(() => { const el = ${L}.querySelector('.row.selected'); const probe = document.createElement('div'); probe.style.background = 'var(--accent-soft)'; document.body.appendChild(probe); const want = getComputedStyle(probe).backgroundColor; probe.remove(); return getComputedStyle(el).backgroundColor === want; })()`);
check(selBg === true, "고른 줄 = --accent-soft 판");
const sizes = await ev(`(() => { const r = ${L}.querySelector('.row'); const m = ${L}.querySelector('.row .meta'); const h = ${L}.querySelector('[data-start-widget] h3'); return [getComputedStyle(r).fontSize, getComputedStyle(r).height, getComputedStyle(m).fontSize, getComputedStyle(h).fontSize, getComputedStyle(h).fontWeight].join('|'); })()`);
check(sizes === "13px|32px|12px|12px|600", `줄 13 · 32 · 뒷글자 12 · 머리 12 semibold (${sizes})`);
// 처음 배치 — 위 줄 가운데 시계(글자를 감싼 박스 264×136), 아래 줄 240×208 셋이 나란히, 판 가로 가운데 · 세로 가운데보다 위
const geo = await ev(`(() => { const b = ${L}.getBoundingClientRect(); const all = [...${L}.querySelectorAll('[data-start-widget]')].map(e => e.getBoundingClientRect()); const [c, ...rs] = all; const left = rs[0].left, right = rs[2].right; return { sizes: all.map(r => Math.round(r.width) + 'x' + Math.round(r.height)).join(','), centre: Math.round((left + right) / 2 - (b.left + b.width / 2)), clockSpan: Math.abs((c.left + c.right) / 2 - (b.left + b.width / 2)) <= 4.5 && Math.round(rs[0].top - c.bottom) === 16, above: c.top + (rs[0].bottom - c.top) / 2 < b.top + b.height / 2, sameTop: new Set(rs.map(r => Math.round(r.top))).size === 1 }; })()`);
check(geo.sizes === "264x136,240x208,240x208,240x208" && Math.abs(geo.centre) <= 1 && geo.clockSpan && geo.above && geo.sameTop, `처음 배치 = 시계 264×136 위 가운데 · 240×208 셋 · 가로 가운데 · 세로 가운데보다 위 (${JSON.stringify(geo)})`);
const hid = await ev(`(() => { const h = ${L}.querySelector('[data-ime-proxy]'); const cs = getComputedStyle(h); const r = h.getBoundingClientRect(); const c = document.querySelector('[data-tile-canvas]').getBoundingClientRect(); return [cs.opacity, cs.pointerEvents, cs.display, Math.abs(r.left + r.width / 2 - (c.left + c.width / 2)) <= 1].join('|'); })()`);
check(hid === "0|none|block|true", `포커스 주인은 안 보이고 손이 안 닿으며 판 위쪽 가운데(팔레트 자리)에 (${hid})`);
check((await ev(`[...${L}.querySelectorAll('*')].some(e => /grid-dot|dots/.test(e.className?.baseVal ?? e.className ?? ''))`)) === false, "격자 점을 그리지 않는다");
console.log("capture:", await shot("launcher-dark.png"));

// ── ② 화살표 + Enter = 호스트 접속 ─────────────────────────────────────────
await key("ArrowLeft"); check((await activeKey()) === "project:P1", `← = 프로젝트 위젯 같은 줄 (${await activeKey()})`);
await key("ArrowLeft"); check((await activeKey()) === "host:web-01", `← = 호스트 위젯 (${await activeKey()})`);
await key("ArrowLeft"); check((await activeKey()) === "host:web-01", `← 끝 = 제자리 (${await activeKey()})`);
await key("ArrowUp"); check((await activeKey()) === "host:web-01", `맨 윗줄 ↑ (위에 위젯 없음) = 제자리 (${await activeKey()})`);
await key("ArrowDown"); check((await activeKey()) === "host:dev-01", `↓ = 위젯 안 다음 줄 (${await activeKey()})`);
check((await selectedKeys()) === "host:dev-01", "고른 줄이 포커스를 따른다");
let b = await ev(`window.__calls.length`);
await key("Enter"); await sleep(1200);
const ssh = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => c[0] === 'open_ssh_session').map(c => c[1].alias))`);
check(ssh === JSON.stringify(["dev-01"]), `Enter = 호스트 독의 접속과 같은 길 (${ssh})`);
check((await ev(`!!${L}`)) === false, "시작 타일이 접속 타일로 교체됐다");

// ── ③ 프로젝트 줄 Enter ─────────────────────────────────────────────────────
await newStartTab();
check((await activeKey()) === "shell:pwsh", `새 탭도 기본 셸에서 시작 (${await activeKey()})`);
await key("ArrowLeft"); await key("ArrowDown"); await key("ArrowDown"); await key("ArrowDown");
check((await activeKey()) === "project:P3", `프로젝트 위젯 넷째 = infra (${await activeKey()})`);
b = await ev(`window.__calls.length`);
await key("Enter"); await sleep(1200);
const loc = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => c[0] === 'open_local_session').map(c => c[1].cwd))`);
check(loc === JSON.stringify(["C:\\src\\infra"]), `Enter = 프로젝트 열기 (open_local_session cwd) (${loc})`);

// ── ③-2 최근 워크트리 줄 Enter = 독 워크트리 줄의 Enter (새 탭 · 탭 제목 · 프로젝트 폴더) ─────────────
await newStartTab();
await key("ArrowLeft");
for (let i = 0; i < 4 && !String(await activeKey()).startsWith("worktree:"); i++) await key("ArrowDown");
check((await activeKey()) === "worktree:P1:c:/src/proj-wt/feat-x", `워크트리 줄에 닿는다 (${await activeKey()})`);
const tabsBefore = await ev(`(async () => (await ${tabsMod}).currentWorkspaceTabs().length)()`);
b = await ev(`window.__calls.length`);
await key("Enter"); await sleep(1200);
const wtOpen = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => c[0] === 'open_local_session').map(c => c[1].cwd))`);
check(wtOpen === JSON.stringify(["C:\\src\\proj-wt\\feat-x"]), `Enter = 그 워크트리에서 열기 (${wtOpen})`);
const wtTab = await ev(`(async () => { const w = await ${tabsMod}; const tabs = w.currentWorkspaceTabs(); const t = tabs.find(t => t.id === w.activeTabId()); return JSON.stringify({ n: tabs.length, title: t?.title ?? null, folder: t?.projectFolder ?? null }); })()`);
check(wtTab === JSON.stringify({ n: tabsBefore, title: "aynx · feat-x", folder: "C:\\src\\proj-wt\\feat-x" }), `빈 시작 탭 재사용 · 제목 · 프로젝트 폴더 (${wtTab})`);
await newStartTab();
check((await colNames("projects")).startsWith("aynx|aynx · feat-x|"), `연 워크트리가 위로 (${await colNames("projects")})`);
check(!(await colNames("projects")).includes("gone"), "없는 폴더의 워크트리는 끝까지 서지 않는다");

// ── ④ 셸 줄 클릭 ─────────────────────────────────────────────────────────────
await newStartTab();
b = await ev(`window.__calls.length`);
await ev(`[...${L}.querySelectorAll('[data-launch-key]')].find(e => e.getAttribute('data-launch-key') === 'shell:wsl:Ubuntu').click()`); await sleep(1200);
const sh = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => c[0] === 'open_local_session').map(c => c[1].shell))`);
check(sh === JSON.stringify(["wsl:Ubuntu"]), `셸 줄 = 그 셸로 로컬 세션 (${sh})`);
check((await ev(`!!${L}`)) === false, "시작 타일이 셸 타일로 교체됐다");

// ── ⑤ 글자를 치면 팔레트 — 기본 자리에 ───────────────────────────────────────
await newStartTab();
await key("KeyW", 0, "w"); await sleep(500);
const pal = await ev(`(() => { const i = document.activeElement; return i && i.tagName === 'INPUT' ? i.value : null; })()`);
check(pal === "w", `'w' → 팔레트가 'w' 를 실은 채 열린다 (${pal})`);
let dp = await canvasDiff();
check(within1(dp), `시작 화면에서 연 팔레트 = 기본 자리(캔버스 가운데 · 위 12%) (차 ${JSON.stringify(dp)})`);
await key("KeyE", 0, "e"); await sleep(200);
check((await ev(`document.activeElement?.value`)) === "we", "이어 친 글자가 뒤에 붙는다(커서가 끝에)");
await key("Escape"); await sleep(400);
check((await ev(`!!document.activeElement?.closest('[data-launcher]')`)) === true, `팔레트를 닫으면 포커스가 launcher 로 (${await activeKey()})`);

// ── ⑤-4 포커스 주인 · 한글 IME 모의 ───────────────────────────────────────────
const act = () => ev(`(() => { const a = document.activeElement; return { holder: !!a?.hasAttribute('data-ime-proxy'), q: !!a?.matches('.palette input.q'), value: a?.value ?? null, tile: a?.hasAttribute('data-tile-focus') ?? false }; })()`);
await ev(`${L}.querySelector('[data-ime-proxy]').focus()`);
let a = await act();
check(a.holder && a.tile && a.value === "", `포커스 = 숨은 입력칸(편집 요소 · 타일의 키보드 몸) (${JSON.stringify(a)})`);
check((await ev(`document.querySelectorAll('[data-launcher] [tabindex="0"][data-launch-key]').length`)) === 0, "줄은 Tab 정거장이 아니다(주인 하나)");
const sel0 = await activeKey();
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Process", code: "KeyG", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
for (const c of ["ㅎ", "하", "한", "한ㄱ", "한그", "한글"]) {
  await send("Input.imeSetComposition", { text: c, selectionStart: c.length, selectionEnd: c.length });
  await sleep(60);
}
const mirrored = await ev(`JSON.stringify({ pal: !!document.querySelector('.palette'), q: document.querySelector('.palette input.q')?.value, holder: !!document.activeElement?.hasAttribute('data-ime-proxy') })`);
check(mirrored === JSON.stringify({ pal: true, q: "한글", holder: true }), `조합 중 = 팔레트가 비춘다 · 포커스는 주인에 (${mirrored})`);
check((await activeKey()) === sel0, "조합 중의 키가 launcher 줄 선택을 움직이지 않는다");
await send("Input.insertText", { text: "한글" }); await sleep(150);
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Process", code: "KeyG", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
await key("ArrowDown");
a = await act();
check(a.q && a.value === "한글", `조합 아닌 첫 키(↓) → 팔레트 입력칸이 '한글' 을 넘겨받는다 (${JSON.stringify(a)})`);
await key("Escape"); await sleep(400);
a = await act();
check(a.holder && a.value === "" && (await ev(`!!document.querySelector('.palette')`)) === false, `Escape = 팔레트 닫고 주인으로 · 칸은 비어 있다 (${JSON.stringify(a)})`);
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Process", code: "KeyG", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
await send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 }); await sleep(60);
await send("Input.insertText", { text: "한" }); await sleep(100);
await key("KeyA", 0, "a"); a = await act();
check(a.q && a.value === "한a", `확정 뒤 라틴 글자 → '한a' (${a.value})`);
await key("Backspace"); a = await act();
check(a.q && a.value === "한", `Backspace 는 팔레트 입력칸에서 (${a.value})`);
await key("Escape"); await sleep(400);
await key("KeyG", 0, "g"); await key("KeyI", 0, "i"); await sleep(200);
a = await act();
check(a.q && a.value === "gi", `라틴 'gi' = 예전 그대로 'gi' (${a.value})`);
await key("Escape"); await sleep(400);
const nLaunchers = await ev(`document.querySelectorAll('[data-launcher]').length`);
await key("KeyT", 10, "T"); await sleep(900);
check((await ev(`document.querySelectorAll('[data-launcher]').length`)) === nLaunchers + 1 && (await act()).holder, "주인 위에서도 전역 단축키(Ctrl+Shift+T = 새 탭)가 먹는다");

// ── ⑤-3 팔레트는 어디서 열든 기본 자리 — 상태바 넷 · 독 · 대시보드 · 터미널 탭 · 분할 · 125% ─────────────
const setMod = importApp("src/lib/settings.svelte.ts");
const setBar = async (pos) => { await ev(`(async () => (await ${setMod}).setStatusBar('${pos}'))()`); await sleep(600); };
// 2026-10-18 통합 독 — 상태바 팔레트 칸은 걷히고 독 머리 아이콘 줄의 팔레트 단추가 같은 일을 한다
const barItem = `document.querySelector('.dock [data-dock-tool="palette"]')`;
for (const pos of ["left", "bottom"]) {
  await setBar(pos);
  await key("KeyP", 10, "P"); await sleep(500);
  dp = await canvasDiff();
  check(within1(dp), `시작 화면 · 상태바 ${pos} · Ctrl+Shift+P → 기본 자리 (차 ${JSON.stringify(dp)})`);
  if (pos === "left") console.log("capture:", await shot("launcher-key-left.png"));
  await key("Escape"); await sleep(400);
  await ev(`(async()=>{const e=performance.getEntriesByType('resource').map(r=>r.name).find(u=>u.includes('app/dock.svelte'));(await import(e)).openDock('alerts');})()`); await sleep(300);
  // 독 머리 줄의 팔레트 단추는 2026-10-24 화면 잠금 단추가 그 자리를 받으며 걷혔다 — 있으면 보고, 없으면 건너뛴다
  const hasItem = await ev(`!!${barItem}`);
  if (!hasItem) console.log(`SKIP 상태바 ${pos} · 독 머리 줄에 팔레트 단추가 없다(2026-10-24 걷힘)`);
  if (hasItem) {
    await ev(`${barItem}.click()`); await sleep(500);
    dp = await canvasDiff();
    check(within1(dp), `상태바 ${pos} · 독 팔레트 단추 → 기본 자리 (차 ${JSON.stringify(dp)})`);
    await key("Escape"); await sleep(400);
  }
}
await setBar("top");
const conMod = importApp("app/console.svelte.ts");
await ev(`(async () => (await ${conMod}).openConsole())()`); await sleep(600);
await ev(`(async () => (await ${importApp("app/overlays.svelte.ts")}).openPalette(''))()`); await sleep(500);
dp = await canvasDiff();
check(within1(dp), `대시보드 위 → 기본 자리 (차 ${JSON.stringify(dp)})`);
await key("Escape"); await sleep(400);
await ev(`(async () => (await ${conMod}).closeConsole())()`); await sleep(600);
await ev(`[...${L}.querySelectorAll('[data-launch-key]')].find(e => e.getAttribute('data-launch-key') === 'shell:pwsh').click()`); await sleep(1200);
check((await ev(`!!${L}`)) === false, "터미널 탭이 활성 — 보이는 launcher 없음");
const dockMod = importApp("app/dock.svelte.ts");
for (const pos of ["left", "right", "top", "bottom"]) {
  await setBar(pos);
  for (const dock of [false, true]) {
    if (dock) { await ev(`(async () => (await ${dockMod}).openDock('hosts'))()`); await sleep(500); }
    // 독이 떠 있으면 포커스가 독의 입력칸이라 조합이 창 핸들러에 안 온다(편집 필드 가드) — 액션을 직접 부른다
    if (dock) await ev(`(async () => (await ${importApp("app/overlays.svelte.ts")}).togglePalette())()`);
    else await key("KeyP", 10, "P");
    await sleep(500);
    dp = await canvasDiff();
    const w = await ev(`Math.round(document.querySelector('.palette').getBoundingClientRect().width)`);
    check(within1(dp) && w === 560, `터미널 탭 · 상태바 ${pos}${dock ? " · 독 열림" : ""} · Ctrl+Shift+P → 캔버스 가운데 · 위 12% · 560 (차 ${JSON.stringify(dp)}, 폭 ${w})`);
    if (pos === "left" && !dock) console.log("capture:", await shot("palette-default-left.png"));
    await key("Escape"); await sleep(400);
    if (dock) { await ev(`(async () => (await ${dockMod}).closeDock(false))()`); await sleep(400); }
  }
}
await setBar("top");
// 분할 안의 시작 타일에서 타자 → 그래도 기본 자리(타일 자리가 아니다)
await newStartTab();
await ev(`[...${L}.querySelectorAll('[data-launch-key]')].find(e => e.getAttribute('data-launch-key') === 'shell:pwsh').click()`); await sleep(1200);
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${importApp("src/lib/session.ts")}; w.openPaneHere(s.newStartPane()); })()`); await sleep(1200);
const splitW = await ev(`Math.round(${L}.getBoundingClientRect().width)`);
const splitScale = await ev(`Number(${L}.querySelector('[data-start-scale]')?.getAttribute('data-start-scale'))`);
// 처음 배치(반폭 376)를 폭 536 에 넣으려면 약 0.67 로 줄이면 된다 — 바닥 0.5 위라 좁은 판이 아니라 통째로 줄인다(2026-11-03 —
// 예전 바닥 0.75 에서는 좁은 판이었다)
const splitNarrow = await ev(`${L}.hasAttribute('data-start-narrow')`);
check(splitW < 1000 && splitNarrow === false && splitScale >= 0.5 && splitScale < 1, `분할 안 시작 타일(폭 ${splitW}) — 좁은 판이 아니라 통째로 줄인다 (배율 ${splitScale})`);
const splitRects = await Promise.all(["hosts", "projects", "shells"].map(rectOf));
const splitBox = await ev(`(() => { const r = ${L}.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; })()`);
check(splitRects.every((r) => r && r.left >= splitBox.left - 0.5 && r.left + r.w <= splitBox.left + splitBox.w + 0.5) && overlapFree(splitRects), `줄어든 위젯이 타일 안 · 겹치지 않는다 (${JSON.stringify(splitRects.map((r) => Math.round(r?.w ?? 0)))})`);
check(Math.abs(splitRects[0].top - splitRects[1].top) < 1, "줄여도 다시 흘리지(쌓지) 않는다 — 같은 줄 그대로");
check((await ev(`${L}.scrollWidth <= ${L}.clientWidth`)) === true, "가로로는 굴리지 않는다(넘침 없음)");
await ev(`${L}.querySelector('[data-ime-proxy]').focus()`);
await key("KeyW", 0, "w"); await sleep(500);
dp = await canvasDiff();
check(within1(dp), `분할 안에서 연 팔레트도 기본 자리 (차 ${JSON.stringify(dp)})`);
await key("Escape"); await sleep(400);
// UI 크기 125% — 웹뷰 확대와 같은 좌표계: 1100×800 창이 CSS 880×640 · dpr 1.25
await send("Emulation.setDeviceMetricsOverride", { width: 880, height: 640, deviceScaleFactor: 1.25, mobile: false }); await sleep(700);
await key("KeyP", 10, "P"); await sleep(500);
const inView = await ev(`(() => { const p = document.querySelector('.palette').getBoundingClientRect(); return p.bottom <= innerHeight && p.right <= innerWidth && p.left >= 0; })()`);
check(inView === true, "125% 에서 판이 화면 안");
await key("Escape"); await sleep(400);
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(500);

// ── ⑦ 위젯 판 — 옮기기 · 크기 · 빼기 · 우클릭 메뉴 · 빈 판 · 작은 창 ──────────────────────
await newStartTab();
check((await ev(`Number(${L}.querySelector('[data-start-scale]').getAttribute('data-start-scale'))`)) === 1, "넓은 창 = 배율 1(키우지 않는다)");
// 평소(잠김) — 호버해도 × · 모서리가 없고, 머리 줄 · 몸을 끌어도 움직이지 않는다
const lockedShells = await rectOf("shells");
const hc = await centerOf('[data-start-widget="shells"] header');
await mouse("mouseMoved", hc[0], hc[1], "none", 0); await sleep(200);
check((await ev(`${L}.querySelectorAll('[data-widget-remove], [data-widget-resize]').length`)) === 0, "잠김 — 호버해도 × · 모서리가 없다");
await mouse("mousePressed", hc[0], hc[1]);
for (let i = 1; i <= 6; i++) { await mouse("mouseMoved", hc[0] + i * 20, hc[1] + i * 10); await sleep(16); }
check((await ev(`!!${L}.querySelector('[data-widget-landing]')`)) === false, "잠김 — 끌어도 끌기가 서지 않는다");
await mouse("mouseReleased", hc[0] + 120, hc[1] + 60, "left", 0); await sleep(250);
const lockedAfter = await rectOf("shells");
check(Math.round(lockedAfter.left) === Math.round(lockedShells.left) && Math.round(lockedAfter.top) === Math.round(lockedShells.top) && (await stored()) === null, "잠김 — 자리 그대로 · 저장 없음");
// 편집 모드 들어가기 — 판 우클릭 [배치 편집]
const enterEdit = async () => { await rightClickEmpty(); await ev(`document.querySelector('[data-board-menu="edit"]').click()`); await sleep(300); };
await enterEdit();
const editState = await ev(`({ on: ${L}.hasAttribute('data-start-editing'), done: !!${L}.querySelector('[data-start-edit-done]'), removes: ${L}.querySelectorAll('[data-widget-remove]').length, corners: ${L}.querySelectorAll('[data-widget-resize]').length })`);
check(editState.on && editState.done && editState.removes === 4 && editState.corners === 4, `편집 모드 = 모든 위젯에 × · 모서리 한꺼번에 · [완료] (${JSON.stringify(editState)})`);
const editBar = await ev(`[...${L}.querySelectorAll('[data-start-edit-bar] button')].map(e => e.getAttribute('aria-label') + (e.disabled ? ':off' : '')).join('|')`);
check(editBar === "되돌리기:off|완료|레이아웃 리셋", `편집 단추 줄 = 아이콘 되돌리기(기록 없으면 흐림) · 완료 · 레이아웃 리셋(이름은 aria-label · 툴팁) (${editBar})`);
// 편집 중 줄 클릭은 실행하지 않는다(셸 열기가 일어나지 않는다)
const callsBeforeRow = await ev(`window.__calls.length`);
const rowC = await centerOf('[data-launch-key="shell:pwsh"]');
await mouse("mouseMoved", rowC[0], rowC[1], "none", 0); await mouse("mousePressed", rowC[0], rowC[1]); await mouse("mouseReleased", rowC[0], rowC[1], "left", 0); await sleep(600);
check((await ev(`window.__calls.slice(${callsBeforeRow}).filter(c => c[0] === 'open_local_session').length`)) === 0 && (await ev(`!!${L}`)) === true, "편집 중 줄 클릭 = 실행 안 함");
// 옮기기 — 셸 위젯을 아래로 조금(같은 높이 맞춤을 깨지 않을 만큼 가로로) — 끄는 동안: 점선 윤곽 · 위치는 transform 만
const shells0 = await rectOf("shells");
// 문턱(4px)을 넘되 격자 · 이웃 맞춤이 제자리로 삼키는 만큼(−3, 3) — 문턱 아래(2, 1)는 끌기가 서지 않는다
const tiny = await dragBy('[data-start-widget="shells"][data-widget-grip]', 2, 1, () => ev(`!!${L}.querySelector('[data-widget-landing]')`));
check(tiny === false, "문턱 아래로 움직이면 끌기가 아니다(클릭)");
let mid = await dragBy('[data-start-widget="shells"][data-widget-grip]', -3, 3, () => ev(`({ landing: !!${L}.querySelector('[data-widget-landing]'), guides: ${L}.querySelectorAll('[data-widget-guide]').length, dragging: ${L}.querySelector('[data-start-widget="shells"]').classList.contains('dragging') })`));
check(mid?.landing === true && mid.guides > 0 && mid.dragging, `끄는 동안 = 놓일 자리 점선 · 맞춤 안내선 · 들린 위젯 (${JSON.stringify(mid)})`);
check((await ev(`!!${L}.querySelector('[data-widget-landing]')`)) === false, "놓으면 윤곽이 걷힌다");
// 그대로 놓였다(격자 · 이웃 맞춤이 3·2px 를 삼킨다) — 바뀐 것이 없으면 저장도 없다
check((await stored()) === null, `제자리에 놓으면 저장하지 않는다 (${JSON.stringify(await stored())})`);
// 다른 위젯(호스트) 위로 끌어 놓기 → 가장 가까운 빈자리에, 겹치지 않게 · 저장
const hostsR = await rectOf("hosts");
await dragBy('[data-start-widget="shells"][data-widget-grip]', hostsR.left - shells0.left + 30, 40);
let rs = await Promise.all(["hosts", "projects", "shells"].map(rectOf));
let st = await stored();
check(overlapFree(rs) && st?.v === 1 && st.widgets.length === 4, `다른 위젯 위에 놓으면 빈자리로 · 겹침 없음 · 저장 (${JSON.stringify(st?.widgets?.find((w) => w.kind === "shells"))})`);
check(st.widgets.every((w) => w.x % 8 === 0 && w.y % 8 === 0), "놓인 자리는 8px 눈금");
// 리셋(처음 배치) — 우클릭 메뉴(편집 중)
await rightClickEmpty();
check((await ev(`document.querySelector('[data-start-board-menu]')?.getAttribute('data-start-board-menu')`)) === "board", "빈 자리 우클릭 = 판 메뉴");
check((await ev(`[...document.querySelectorAll('[data-start-board-menu] .menu-row')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()).join('|')`)) === "위젯 추가 ▸|편집 완료|되돌리기|레이아웃 리셋", "메뉴 = 위젯 추가 ▸ · (구분선) 편집 완료(편집 중) · 되돌리기 · 레이아웃 리셋 — 되돌리기 · 리셋은 편집 중에만");
check((await ev(`document.activeElement?.getAttribute('role')`)) === "menuitem", "메뉴 첫 항목에 포커스");
const errBefore = errors.length;
await ev(`document.querySelector('[data-board-menu="reset"]').click()`); await sleep(400);
check((await stored()) === null && !(await ev(`!!document.querySelector('[data-start-board-menu]')`)) && errors.length === errBefore, "리셋 = 저장을 지우고 메뉴가 닫힌다(콘솔 예외 없음)");
check((await ev(`!!document.activeElement?.hasAttribute('data-ime-proxy')`)) === true, "메뉴를 닫으면 포커스가 주인으로");
// 크기 — 호스트 위젯 모서리를 아래로 64 → 높이 272 · 말풍선 "7줄" · 옆으로는 이웃(프로젝트) 앞에서 멈춘다
mid = await dragBy('[data-start-widget="hosts"] [data-widget-resize]', 200, 64, () => ev(`${L}.querySelector('[data-widget-size-tip]')?.textContent.trim() ?? null`));
check(mid === "7줄", `크기를 바꾸는 동안 = 보이는 줄 수 말풍선 (${mid})`);
const hostsR2 = await rectOf("hosts");
check(Math.round(hostsR2.h) === 272 && Math.round(hostsR2.w) === 240, `높이 272 · 폭은 이웃 앞(16px)에서 멈춘다 (${Math.round(hostsR2.w)}×${Math.round(hostsR2.h)})`);
check((await stored())?.widgets.find((w) => w.kind === "hosts")?.h === 272, "크기는 놓을 때 저장");
// 빼기 — 프로젝트 × (토스트 없음) → 빈 자리 우클릭 [되돌리기] = 같은 자리 · 크기로 → 다시 ×
const projBefore = await rectOf("projects");
await ev(`${L}.querySelector('[data-start-widget="projects"] [data-widget-remove]').click()`); await sleep(300);
check((await ev(`[...${L}.querySelectorAll('[data-start-widget]')].map(e => e.dataset.startWidget).join('|')`)) === "clock|hosts|shells", "× = 위젯 빼기");
check((await ev(`!document.querySelector('[data-toast-action="start-widget-undo"]')`)) === true, "빼도 토스트는 뜨지 않는다");
await rightClickEmpty();
check((await ev(`document.querySelector('[data-board-menu="undo"]')?.disabled`)) === false, "되돌릴 것이 있으면 [되돌리기]가 살아 있다");
await ev(`document.querySelector('[data-board-menu="undo"]').click()`); await sleep(400);
const projBack = await rectOf("projects");
check(!!projBack && Math.round(projBack.left) === Math.round(projBefore.left) && Math.round(projBack.top) === Math.round(projBefore.top) && Math.round(projBack.w) === Math.round(projBefore.w) && errors.length === errBefore, `[되돌리기] = 지우기 전 자리 · 크기로 (${JSON.stringify(projBack)})`);
// 옮기기도 되돌린다 — 셸을 아래로 끌었다가 판 위 단추 줄의 [되돌리기]
const shBefore = await rectOf("shells");
await dragBy('[data-start-widget="shells"][data-widget-grip]', 0, 120);
const shMoved = await rectOf("shells");
await ev(`${L}.querySelector('[data-start-edit-undo]').click()`); await sleep(400);
const shBack = await rectOf("shells");
check(Math.round(shMoved.top) !== Math.round(shBefore.top) && Math.round(shBack.top) === Math.round(shBefore.top) && Math.round(shBack.left) === Math.round(shBefore.left), `[되돌리기] = 옮기기 전 자리로 (${Math.round(shBefore.top)} → ${Math.round(shMoved.top)} → ${Math.round(shBack.top)})`);
await ev(`${L}.querySelector('[data-start-widget="projects"] [data-widget-remove]').click()`); await sleep(300);
// 더하기 — 빈 자리 우클릭 → 위젯 추가 ▸ → 놓인 것은 흐리게 "놓임"
const clickAt = await rightClickEmpty();
await ev(`document.querySelector('[data-board-menu="add"]').click()`); await sleep(300);
const fly = await ev(`[...document.querySelectorAll('[data-start-board-flyout] [data-board-add]')].map(e => e.dataset.boardAdd + ':' + e.getAttribute('aria-disabled') + ':' + e.textContent.replace(/\\s+/g, ' ').trim()).join('|')`);
check(fly === "clock:true:시계 놓임|hosts:true:최근 호스트 놓임|projects:false:프로젝트|shells:true:셸 놓임", `옆목록 = 네 종류 · 놓인 것은 흐리게 (${fly})`);
await ev(`document.querySelector('[data-start-board-flyout] [data-board-add="projects"]').click()`); await sleep(400);
rs = await Promise.all(["hosts", "projects", "shells"].map(rectOf));
const pr = rs[1];
check(pr && overlapFree(rs) && Math.abs(pr.top + pr.h / 2 - clickAt[1]) < 260 && errors.length === errBefore, `추가 = 누른 자리 가까운 빈자리 · 겹침 없음 (${JSON.stringify(pr)})`);
// 키보드 — 아래로 놓인 위젯으로 ↓ 가 이어진다: 셸을 호스트 바로 아래로 옮겨 본다
await rightClickEmpty(); await ev(`document.querySelector('[data-board-menu="reset"]').click()`); await sleep(400);
const h0 = await rectOf("hosts"); const s0 = await rectOf("shells");
await dragBy('[data-start-widget="shells"][data-widget-grip]', h0.left - s0.left, h0.h + 24);
await ev(`${L}.querySelector('[data-ime-proxy]').focus()`); await sleep(100);
await ev(`[...${L}.querySelectorAll('[data-launch-key]')].find(e => e.dataset.launchKey === 'host:db-02').dispatchEvent(new FocusEvent('focus'))`); await sleep(100);
await key("ArrowDown");
check((await activeKey()) === "shell:pwsh", `호스트 맨 아랫줄 ↓ = 바로 아래 셸 위젯 첫 줄 (${await activeKey()})`);
await key("ArrowUp");
check((await activeKey()) === "host:db-02", `셸 첫 줄 ↑ = 위 호스트 위젯 끝 줄 (${await activeKey()})`);
await key("ArrowRight");
const rightKey = await activeKey();
check((await ev(`!!${L}.querySelector('[data-start-widget="projects"] [data-launch-key="${rightKey}"]')`)) === true, `→ = 오른쪽의 가장 가까운 위젯(프로젝트) (${rightKey})`);
console.log("capture:", await shot("launcher-moved.png"));
// 편집 중 시계 아닌 위젯 위 우클릭 = 메뉴 없음(줄이 하나도 없다 — 판을 고치는 줄은 위젯 메뉴에 없다)
await ev(`(() => { const el = ${L}.querySelector('[data-start-widget="projects"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20, button: 2 })); })()`); await sleep(300);
check((await ev(`!document.querySelector('[data-start-board-menu], [data-start-widget-menu]')`)) === true, "편집 중 프로젝트 위젯 우클릭 = 메뉴 없음");
// 시계 위 우클릭 = 시계 메뉴(판 메뉴가 아니다) — 24시간 ✓ · 12시간 · 초 표시 · 날짜, 편집 중이라 [배치 편집] 없음 · 고르면 닫히고 저장 · 숫자가 바뀐다
await ev(`(() => { const r = ${L}.querySelector('[data-start-widget="clock"] [data-start-clock]').getBoundingClientRect(); ${L}.querySelector('[data-start-clock]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20, button: 2 })); })()`); await sleep(300);
const cm = await ev(`[...document.querySelectorAll('[data-start-widget-menu="clock"] [data-clock-menu]')].map(e => e.dataset.clockMenu + ':' + e.getAttribute('aria-checked')).join('|')`);
check(cm === "h24:true|h12:false|seconds:false|date:true" && !(await ev(`!!document.querySelector('[data-start-board-menu], [data-widget-menu-edit]')`)), `시계 우클릭 = 시계 메뉴(판 메뉴 아님 · 편집 중 [배치 편집] 없음) (${cm})`);
await ev(`document.querySelector('[data-clock-menu="seconds"]').click()`); await sleep(300);
const secs = await ev(`${L}.querySelector('[data-start-clock-time]').textContent.trim()`);
check(/^\d{2}:\d{2}:\d{2}$/.test(secs) && !(await ev(`!!document.querySelector('[data-start-widget-menu]')`)) && (await ev(`localStorage.getItem('aynx:start-clock')`)) === '{"hour12":false,"seconds":true,"date":true,"size":88}' && errors.length === errBefore, `초 표시 = HH:MM:SS · 메뉴 닫힘 · 저장 (${secs})`);
const clockW = await ev(`Math.round(${L}.querySelector('[data-start-widget="clock"]').getBoundingClientRect().width)`);
check(clockW > 264, `초를 켜면 시계 박스가 넓어진다 (${clockW})`);
// 크기 모서리 = 글자 크기 — 끌면 숫자가 커지고 박스가 따라간다 · 저장(size)
const font0 = await ev(`parseFloat(getComputedStyle(${L}.querySelector('[data-start-clock-time]')).fontSize)`);
await dragBy('[data-start-widget="clock"] [data-widget-resize]', 40, 20);
const font1 = await ev(`parseFloat(getComputedStyle(${L}.querySelector('[data-start-clock-time]')).fontSize)`);
const savedSize = JSON.parse((await ev(`localStorage.getItem('aynx:start-clock')`)) ?? "{}").size;
check(font1 > font0 && savedSize === font1, `시계 모서리 = 글자 크기 (${font0} → ${font1} · 저장 ${savedSize})`);
await ev(`localStorage.removeItem('aynx:start-clock'); (async () => (await ${importApp("start-widgets.svelte.ts")}).setClockOptions({ hour12: false, seconds: false, date: true, size: 88 }))()`); await sleep(200);
await ev(`localStorage.removeItem('aynx:start-clock')`);
// 빈 판 — 넷 다 빼면 안내 · 단추 없이 빈 판 그대로(위젯은 우클릭으로만 더한다)
for (const k of ["clock", "hosts", "projects", "shells"]) { await ev(`${L}.querySelector('[data-start-widget="${k}"] [data-widget-remove]').click()`); await sleep(150); }
check((await ev(`!${L}.querySelector('[data-start-empty]') && !${L}.querySelector('[data-start-add]')`)) === true, "빈 판 = 안내 · [위젯 추가] 없음");
check(JSON.stringify((await stored())?.widgets) === "[]", "빈 배치도 저장된다(다시 열어도 빈 판)");
console.log("capture:", await shot("launcher-empty-board.png"));
await rightClickEmpty(); await ev(`document.querySelector('[data-board-menu="add"]').click()`); await sleep(300);
await ev(`document.querySelector('[data-start-board-menu] [data-board-add="shells"]').click()`); await sleep(300);
check((await ev(`[...${L}.querySelectorAll('[data-start-widget]')].map(e => e.dataset.startWidget).join('|')`)) === "shells", "빈 판에서 셸 위젯을 더했다");
await rightClickEmpty(); await ev(`document.querySelector('[data-board-menu="reset"]').click()`); await sleep(400);
// 작은 창 — 최소 창(720×480)에서 처음 배치(반폭 376 · 위로 232)는 통째로 줄인다(배율 0.5 ~ 1) · 줄어든 판에서 끌기는 배율로 나눈다
// (처음 배치로는 저장 글자가 지워진다 — 끌기 전후를 저장 글자로 비교하려고 같은 배치를 한 번 저장해 둔다)
await ev(`(async () => { const m = await ${importApp("start-widgets.svelte.ts")}; const s = await ${importApp("src/lib/start-widgets.ts")}; m.setStartWidgets(s.defaultStartWidgets()); })()`); await sleep(300);
await send("Emulation.setDeviceMetricsOverride", { width: 720, height: 480, deviceScaleFactor: 1, mobile: false }); await sleep(700);
const smallScale = await ev(`Number(${L}.querySelector('[data-start-scale]').getAttribute('data-start-scale'))`);
rs = await Promise.all(["hosts", "projects", "shells"].map(rectOf));
const bx = await ev(`(() => { const r = ${L}.getBoundingClientRect(); return { left: r.left, top: r.top, w: r.width, h: r.height }; })()`);
check(smallScale >= 0.5 && smallScale < 1 && rs.every((r) => r.left >= bx.left && r.left + r.w <= bx.left + bx.w && r.top >= bx.top && r.top + r.h <= bx.top + bx.h), `작은 창 = 통째로 줄인다(배율 ${smallScale}) · 모두 판 안`);
check((await ev(`${L}.scrollWidth <= ${L}.clientWidth && ${L}.scrollHeight <= ${L}.clientHeight`)) === true, "작은 창에서도 굴리지 않는다");
check(Math.abs(rs[0].top - rs[1].top) < 1, "다시 흘리지(쌓지) 않는다 — 같은 줄 그대로");
const before = (await stored()).widgets.find((w) => w.kind === "hosts");
await dragBy('[data-start-widget="hosts"][data-widget-grip]', 0, 80 * smallScale);
const after = (await stored()).widgets.find((w) => w.kind === "hosts");
check(Math.abs(after.y - before.y - 80) <= 8 && after.x === before.x, `줄어든 판에서 화면 ${Math.round(80 * smallScale)}px 끌기 = 판 좌표 80px (${before.y} → ${after.y})`);
console.log("capture:", await shot("launcher-small.png"));
// 더 넓은 배치(반폭 776)는 폭 720 에 넣으려면 약 0.44 — 0.5 아래로 줄여야 들어간다 → 좁은 판: 한 줄로 쌓고 세로로만 굴린다 · 손잡이 없음 · 저장된 배치는 그대로
await ev(`(async () => { const m = await ${importApp("start-widgets.svelte.ts")}; const s = await ${importApp("src/lib/start-widgets.ts")}; m.setStartWidgets(s.withWidgetBox(s.defaultStartWidgets(), 'projects', { x: -120, y: -72, w: 640, h: 208 }).map(w => w.kind === 'shells' ? { ...w, x: 536 } : w)); })()`); await sleep(500);
const wideSaved = JSON.stringify(await stored());
rs = await Promise.all(["hosts", "projects", "shells"].map(rectOf));
const narrowOk = await ev(`${L}.hasAttribute('data-start-narrow') && ${L}.querySelector('[data-start-scale]').getAttribute('data-start-scale') === '1' && !${L}.querySelector('[data-widget-grip], [data-widget-resize]')`);
check(narrowOk === true && rs[1].top > rs[0].top + rs[0].h && rs[2].top > rs[1].top + rs[1].h, `작은 창 · 넓은 배치 = 좁은 판(위아래로 쌓임 · 줄이지 않음 · 손잡이 없음)`);
check((await ev(`${L}.scrollWidth <= ${L}.clientWidth && ${L}.scrollHeight > ${L}.clientHeight`)) === true, "좁은 판은 세로로만 굴린다");
console.log("capture:", await shot("launcher-narrow.png"));
// 반폭 776 이 0.5 이상으로 들어가는 넓은 창 — 좁은 판이 풀리고 저장된 배치 그대로
await send("Emulation.setDeviceMetricsOverride", { width: 1800, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(700);
check((await ev(`${L}.hasAttribute('data-start-narrow')`)) === false && JSON.stringify(await stored()) === wideSaved, "넓어지면 저장된 배치 그대로");
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(500);
await ev(`(async () => (await ${importApp("start-widgets.svelte.ts")}).resetStartWidgets())()`); await sleep(300);

// 편집 모드 나오기 — Esc · [완료] (각각 다시 들어가서) · 빈 자리 누르기로는 나오지 않는다
const editingNow = () => ev(`${L}.hasAttribute('data-start-editing')`);
if (!(await editingNow())) await enterEdit();
await ev(`${L}.querySelector('[data-ime-proxy]').focus()`); await key("Escape"); await sleep(200);
check((await editingNow()) === false, "Esc = 편집 모드 나오기");
await enterEdit();
const emptyAt = await ev(`(() => { const r = ${L}.getBoundingClientRect(); return [r.left + 60, r.bottom - 40]; })()`);
await mouse("mouseMoved", emptyAt[0], emptyAt[1], "none", 0); await mouse("mousePressed", emptyAt[0], emptyAt[1]); await mouse("mouseReleased", emptyAt[0], emptyAt[1], "left", 0); await sleep(200);
check((await editingNow()) === true, "위젯 밖 빈 자리 누르기 = 편집 모드 그대로");
await ev(`${L}.querySelector('[data-start-edit-done]').click()`); await sleep(200);
check((await editingNow()) === false && (await ev(`${L}.querySelectorAll('[data-widget-remove]').length`)) === 0, "[완료] = 편집 모드 나오기(× 가 걷힌다)");
// 잠긴 평소 메뉴 = 배치 편집 한 줄(위젯 추가 · 되돌리기 · 리셋은 편집 중에만)
await rightClickEmpty();
check((await ev(`[...document.querySelectorAll('[data-start-board-menu] .menu-row')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()).join('|')`)) === "배치 편집", "잠긴 메뉴 = 배치 편집 한 줄");
await key("Escape"); await sleep(200);
// 잠긴 평소 위젯 위 우클릭 = 위젯 메뉴 [배치 편집] 한 줄(판을 고치는 줄 · 위젯 추가 없음) → 누르면 편집 모드
await ev(`(() => { const el = ${L}.querySelector('[data-start-widget="hosts"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 20, clientY: r.top + 20, button: 2 })); })()`); await sleep(300);
check((await ev(`[...document.querySelectorAll('[data-start-widget-menu="widget"] .menu-row')].map(e => e.textContent.trim()).join('|')`)) === "배치 편집", "잠긴 호스트 위젯 우클릭 = [배치 편집] 한 줄");
await ev(`document.querySelector('[data-widget-menu-edit]').click()`); await sleep(300);
check((await editingNow()) === true, "위젯 메뉴 [배치 편집] = 편집 모드");
await key("Escape"); await sleep(200);

// ── 라이트 ─────────────────────────────────────────────────────────────────
const modeMod = importApp("mode.svelte.ts");
await ev(`(async () => { const m = await ${modeMod}; m.setAppMode('light'); })()`); await sleep(500);
console.log("capture:", await shot("launcher-light.png"));
await ev(`(async () => { const m = await ${modeMod}; m.setAppMode('dark'); })()`); await sleep(300);

// ── ⑧ 빈 사용자 ─────────────────────────────────────────────────────────────
await ev(`sessionStorage.setItem('launcher-empty', '1')`);
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
const empties = await ev(`[...${L}.querySelectorAll('.empty')].map(e => e.textContent.trim()).join('|')`);
check(empties === "접속한 호스트가 여기에 쌓입니다|독의 프로젝트 칸에서 추가합니다", `빈 위젯 = 안내 줄 (${empties})`);
check((await colNames("shells")) === "PowerShell 7|WSL: Ubuntu|명령 프롬프트", "셸 위젯은 그대로");
check((await activeKey()) === "shell:pwsh", `탭이 없는 본문에서도 포커스가 기본 셸 줄에 (${await activeKey()})`);
console.log("capture:", await shot("launcher-empty.png"));
await ev(`sessionStorage.removeItem('launcher-empty')`);

// ── ⑨ 탭 없음 ↔ 시작 타일: 위젯의 좌표가 그대로다 ───────────────────────────
const fieldRect = () => ev(`(() => { const el = ${L}; const r = el?.querySelector('[data-start-widget="hosts"]')?.getBoundingClientRect(); return r ? { top: r.top, left: r.left, tile: !!el.closest('.pane-box') } : null; })()`);
for (const width of [1100, 720]) {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(700);
  for (const style of ["flat", "panel"]) {
    await ev(`(async () => (await ${setMod}).setStatusBarStyle('${style}'))()`); await sleep(300);
    for (const pos of ["top", "bottom", "left", "right"]) {
      await setBar(pos);
      await ev(`(async () => { const w = await ${tabsMod}; for (const id of w.currentWorkspaceTabs().map(t => t.id)) w.closeTab(id); })()`); await sleep(400);
      const noTabs = await fieldRect();
      await newStartTab();
      const startTile = await fieldRect();
      check(noTabs && startTile && !noTabs.tile && startTile.tile
        && Math.abs(startTile.top - noTabs.top) <= 0.5 && Math.abs(startTile.left - noTabs.left) <= 0.5,
      `탭 없음 ↔ 시작 타일 · ${width}px · 상태바 ${pos}/${style} · 호스트 위젯 top/left ±0.5px (${JSON.stringify(noTabs)} → ${JSON.stringify(startTile)})`);
    }
  }
}
await ev(`(async () => (await ${setMod}).setStatusBarStyle('flat'))()`);
await setBar("top");
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" / ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
