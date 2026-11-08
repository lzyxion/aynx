// 헤드리스 검증 — **테마 프로필 빠른 전환** (docs/log/2026-09-28-profile-switcher.md).
//
// `toast-harness.mjs` 의 스텁 사본 — `load_theme_profiles` 가 프로필 넷(사진 둘 · 사진 없음 · 라이트)을 주고,
// `wallpaper_resolve` 는 SVG 그라디언트 data URL 을 준다. 시나리오: 셸 타일(스텁 세션)에 포커스 → 진짜 키
// (`Input.dispatchKeyEvent`)로 Ctrl+Shift+U → 카드 줄이 뜨고 **지금 쓰는 프로필이 골라져** 있으며 키보드가 줄에
// 있다 · → + Enter = 다음 프로필 적용(설정 저장의 월페이퍼 이름 · 프로필 파일의 active) 후 닫히고 포커스는 터미널로 ·
// 다시 열면 방금 고른 것이 골라져 있다 · End · 숫자 · Tab 돌아 나오기 · Esc 는 저장 없이 닫기 · 같은 단축키로 닫기 ·
// 바깥 클릭 닫기 · 가림막이 내려오면 닫힘 · 라이트 프로필 적용 뒤 라이트 캡처 · 빈 목록 한 줄 · reduce 면 애니메이션
// 없음 · 콘솔 예외 0.
//
// usage:
//   npx vite --port 1430 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9231 --user-data-dir=%TEMP%/edge-aynx-ps \
//     --window-size=1200,800 http://localhost:1430/
//   PAGE_PORT=1430 node scripts/dev/profile-switcher-harness.mjs <outdir> 9231
//     → <outdir>/switcher-dark.png · switcher-light.png · settings-cards.png · switcher-empty.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outDir = ".", port = process.env.CDP_PORT ?? "9231"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1430";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const tgt = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(tgt.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
let collecting = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (!collecting) return;
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description ?? "exception");
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error")
    errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  return r.result?.exceptionDetails
    ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0]
    : r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = path.join(outDir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log("PNG " + path.resolve(p));
};
let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
/** 앱이 이미 올린 것과 **같은 모듈 인스턴스** (README 의 keygen 절) */
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

/** 진짜 키 한 번 (포커스된 요소로 간다) — `code` 이름 + 수식 키 */
const VK = { ArrowLeft: 37, ArrowRight: 39, Enter: 13, Escape: 27, Tab: 9, Home: 36, End: 35, KeyU: 85, KeyN: 78, Digit1: 49, Digit2: 50, Digit3: 51, Digit4: 52 };
const KEYNAME = { KeyU: "U", Digit1: "1", Digit2: "2", Digit3: "3", Digit4: "4" };
async function press(code, { ctrl = false, shift = false } = {}) {
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const key = KEYNAME[code] ?? code;
  const base = { code, key, modifiers, windowsVirtualKeyCode: VK[code] ?? 0, nativeVirtualKeyCode: VK[code] ?? 0 };
  const text = !ctrl && key.length === 1 ? key : undefined;
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  await sleep(120);
}
const SWITCH = () => press("KeyU", { ctrl: true, shift: true });

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  // SVG 그라디언트 = "사진" (wallpaper_resolve 가 돌려주는 경로 — convertFileSrc 가 그대로 둔다)
  const grad = (a, b) => 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="' + a + '"/><stop offset="1" stop-color="' + b + '"/></linearGradient></defs><rect width="320" height="200" fill="url(#g)"/><circle cx="240" cy="60" r="36" fill="' + b + '" opacity=".6"/></svg>');
  const files = { 'wp-aaaaaaaaaaaa.png': grad('#1b2a4a', '#d95a9e'), 'wp-bbbbbbbbbbbb.png': grad('#0f3d2e', '#9fd6a8') };
  const empty = sessionStorage.getItem('ps-empty') === '1';
  const profiles = empty ? null : JSON.stringify({ version: 1, active: 'T2', profiles: [
    { id: 'T1', name: '밤 — 노을', savedAt: 4, appearance: { app: { accent: '#d95a9e', mode: 'dark', bg: '#121218', fg: '#ececef' }, terminal: { theme: 'aynx-dark' }, wallpaper: { file: 'wp-aaaaaaaaaaaa.png', dim: 30, blur: 0, fit: 'cover' } } },
    { id: 'T2', name: '숲', savedAt: 3, appearance: { app: { accent: '#6fbf73', mode: 'dark', bg: '#0e1512', fg: '#e3efe6' }, terminal: { theme: 'aynx-dark' }, wallpaper: { file: 'wp-bbbbbbbbbbbb.png', dim: 20, blur: 10, fit: 'cover' } } },
    { id: 'T3', name: '사진 없는 기본', savedAt: 2, appearance: { app: { mode: 'dark' }, terminal: { theme: 'aynx-dark' }, wallpaper: {} } },
    { id: 'T4', name: '발표용 밝은 벌', savedAt: 1, appearance: { app: { accent: '#b03a7c', mode: 'light' }, terminal: { theme: 'aynx-light' }, wallpaper: {} } },
  ] });
  window.__settings = { app: { status_bar: 'bottom', accent: '#6fbf73', mode: 'dark', bg: '#0e1512', fg: '#e3efe6' }, terminal: { theme: 'aynx-dark' }, wallpaper: { file: 'wp-bbbbbbbbbbbb.png', dim: 20, blur: 10, fit: 'cover' } };
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {},  load_snippets: null, 
     save_snippets: null,  save_settings: null, save_theme_profiles: null,
    wallpaper_gc: null,
    host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_lock: null, mcp_status: { clis: [] },
    list_ai_clis: [], operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    audit_status: { state: 'off', written: 0, failed: 0 }, mcp_activity: null, list_forwards: [],
    list_operations: { pending: [], recent: [] },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, JSON.parse(JSON.stringify(args ?? null))]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'load_settings') return Promise.resolve(window.__settings);
      if (cmd === 'load_theme_profiles') return Promise.resolve(profiles);
      if (cmd === 'wallpaper_resolve') return Promise.resolve(files[args?.file] ?? null);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await ev(`sessionStorage.removeItem('ps-empty')`);
collecting = true;
await send("Page.reload", { ignoreCache: true });
await sleep(4000);

const STATE = `(() => {
  // 나가는 전이(180ms) 동안 남아 있는 그림은 Svelte 가 \`inert\` 를 건다 — 닫힌 것으로 본다
  const panel = document.querySelector('[data-profile-switcher]:not([inert])');
  const lb = panel?.querySelector('[role=listbox]');
  const sel = panel?.querySelector('[data-ps-card][data-sel=true]');
  const ae = document.activeElement;
  return JSON.stringify({
    open: !!panel,
    cards: panel ? [...panel.querySelectorAll('[data-ps-card]')].map((c) => c.dataset.psCard) : [],
    sel: sel?.dataset.psCard ?? null,
    ariaSel: panel?.querySelector('[role=option][aria-selected=true]')?.dataset.psCard ?? null,
    activeDesc: lb?.getAttribute('aria-activedescendant') ?? null,
    focusInList: !!lb && ae === lb,
    focusInTerm: !!ae?.closest?.('.xterm'),
    theme: document.documentElement.dataset.theme ?? null,
    panelTop: panel ? Math.round(panel.getBoundingClientRect().top) : null,
    canvasTop: Math.round(document.querySelector('[data-tile-canvas]')?.getBoundingClientRect().top ?? -1),
  });
})()`;
const state = async () => JSON.parse(await ev(STATE));
const saves = async () =>
  JSON.parse(
    await ev(`JSON.stringify(window.__calls.filter(([c]) => c === 'save_settings' || c === 'save_theme_profiles').map(([c, a]) => c === 'save_settings' ? ['s', a.settings?.wallpaper?.file ?? null, a.settings?.app?.mode ?? null] : ['p', JSON.parse(a.json).active]))`),
  );

// ── 셸 타일 하나 · 포커스는 터미널 ─────────────────────────────────────────
await ev(`(async () => { const m = await ${importApp("/lib/app/panes.svelte.ts")}; await m.openDefaultShell(); })()`);
await sleep(1200);
await ev(`document.querySelector('.xterm textarea')?.focus()`);
let s = await state();
check(s.focusInTerm, `시작 포커스는 터미널 (${s.focusInTerm})`);

// ── ① Ctrl+Shift+U — 열림 · 지금 쓰는 프로필(T2) 골라짐 · 키보드는 줄에 ─────────────
await SWITCH();
const anim = await ev(`document.querySelector('[data-profile-switcher]').getAnimations().length`);
check(anim > 0, `내려오는 전이 (${anim})`);
await sleep(250);
s = await state();
check(s.open, "Ctrl+Shift+U 로 카드 줄이 열린다");
check(JSON.stringify(s.cards) === JSON.stringify(["T1", "T2", "T3", "T4"]), `카드 넷 (${s.cards})`);
check(s.sel === "T2" && s.ariaSel === "T2" && s.activeDesc === "ps-card-T2", `지금 쓰는 프로필이 골라져 있다 (${s.sel} · ${s.activeDesc})`);
check(s.focusInList, "키보드는 카드 줄(listbox)에 있다");
check(s.panelTop !== null && s.panelTop >= s.canvasTop && s.panelTop - s.canvasTop <= 24, `캔버스 위 가장자리 바로 아래 (panel ${s.panelTop} · canvas ${s.canvasTop})`);
const badge = await ev(`document.querySelector('[data-ps-card=T2] .badge')?.textContent.trim()`);
// 스텁 설정은 T2 와 칸 하나하나 같지 않아 "수정됨" 이다(그것도 맞는 답) — 방금 적용한 벌은 ④에서 "사용 중" 을 본다
check(badge === "수정됨" || badge === "사용 중", `쓰는 카드에 배지 (${badge})`);
const imgs = await ev(`[...document.querySelectorAll('[data-profile-switcher] img.wp')].length`);
check(imgs === 2, `사진 있는 카드 둘에 사진 (${imgs})`);
await sleep(300);
await shot("switcher-dark.png");

// ── ② 키 — 글자는 터미널로 새지 않는다 ────────────────────────────────────────
const writesBefore = await ev(`window.__calls.filter(([c]) => c === 'write_session').length`);
await press("KeyU"); // 맨 글자
const writesAfter = await ev(`window.__calls.filter(([c]) => c === 'write_session').length`);
check(writesAfter === writesBefore, `떠 있는 동안 글자가 셸로 가지 않는다 (${writesBefore} → ${writesAfter})`);

// ── ③ → + Enter = T3 적용 · 닫힘 · 포커스는 터미널 ───────────────────────────
const before = (await saves()).length;
await press("ArrowRight");
s = await state();
check(s.sel === "T3", `→ 로 다음 카드 (${s.sel})`);
await press("Enter");
await sleep(700);
s = await state();
check(!s.open, "Enter 뒤 닫힌다");
check(s.focusInTerm, "포커스가 터미널로 돌아간다");
const after1 = (await saves()).slice(before);
check(after1.some(([k, f]) => k === "s" && f === null), `설정 저장 — T3 는 사진 없음 (${JSON.stringify(after1)})`);
await sleep(400);
const after1b = (await saves()).slice(before);
check(after1b.some(([k, a]) => k === "p" && a === "T3"), `프로필 파일의 active = T3 (${JSON.stringify(after1b)})`);
const bgLayer = await ev(`(async () => { const m = await ${importApp("/lib/settings.svelte.ts")}; return m.settings.current.wallpaper.file ?? null; })()`);
check(bgLayer === null, `설정의 월페이퍼 이름이 비었다 (${bgLayer})`);

// ── ④ 다시 열면 T3 · End · 숫자 · Tab 돌아 나오기 · Shift+Tab · Esc 는 저장 없이 ───────
await SWITCH();
s = await state();
check(s.open && s.sel === "T3", `다시 열면 방금 고른 T3 (${s.sel})`);
const badge3 = await ev(`document.querySelector('[data-ps-card=T3] .badge')?.textContent.trim()`);
check(badge3 === "사용 중", `방금 적용한 카드에 배지 "사용 중" (${badge3})`);
await press("End");
check((await state()).sel === "T4", "End = 마지막");
await press("Tab");
check((await state()).sel === "T1", "Tab 은 끝에서 돌아 나온다");
await press("Tab", { shift: true });
check((await state()).sel === "T4", "Shift+Tab 은 거꾸로");
await press("Home");
check((await state()).sel === "T1", "Home = 처음");
await press("Digit2");
check((await state()).sel === "T2", "숫자 2 = 둘째 카드 (고르기만)");
check((await state()).open, "숫자는 닫지 않는다");
const beforeEsc = (await saves()).length;
await press("Escape");
await sleep(500);
s = await state();
check(!s.open, "Esc 로 닫힌다");
check(s.focusInTerm, "Esc 뒤 포커스가 터미널로");
check((await saves()).length === beforeEsc, "Esc 는 아무것도 저장하지 않는다");
check((await ev(`document.querySelectorAll('[data-profile-switcher]').length`)) === 0, "나가는 전이 뒤 DOM 에서 빠진다");

// ── ④' 나가는 몸짓 — 닫자마자는 그림이 남아(Svelte 의 inert) 올라가고, 도중에 다시 열면 그 자리에서 돌아온다 ──
await SWITCH();
await sleep(400);
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
const mid = JSON.parse(
  await ev(`JSON.stringify((() => { const p = document.querySelector('[data-profile-switcher]'); return { there: !!p, inert: p?.hasAttribute('inert') ?? false, overlayPE: p ? getComputedStyle(p.closest('.overlay')).pointerEvents : null, anims: p?.getAnimations().length ?? 0, term: !!document.activeElement?.closest?.('.xterm') }; })())`),
);
check(mid.there && mid.inert && mid.overlayPE === "none" && mid.anims > 0, `닫는 순간은 그림이 남아 나가는 전이 중 (${JSON.stringify(mid)})`);
check(mid.term, "나가는 동안 포커스는 이미 터미널에 (키를 잃지 않는다)");
await SWITCH(); // 나가는 도중 다시 열기
await sleep(60);
s = await state();
check(s.open && s.focusInList && s.sel === "T3", `나가는 도중 다시 열면 열리고 키보드는 줄에 (${JSON.stringify({ open: s.open, f: s.focusInList, sel: s.sel })})`);
check((await ev(`document.querySelectorAll('[data-profile-switcher]').length`)) === 1, "패널은 하나");
await press("Escape");
await sleep(300);
check(!(await state()).open && (await ev(`document.querySelectorAll('[data-profile-switcher]').length`)) === 0, "다시 닫힘");

// ── ⑤ 같은 단축키로 닫기 · 바깥 클릭 · 가림막 ─────────────────────────────────
await SWITCH();
check((await state()).open, "다시 열림");
await SWITCH();
await sleep(200);
s = await state();
check(!s.open, "같은 단축키로 닫힌다");
check(s.focusInTerm, "단축키로 닫아도 포커스는 터미널로");
await SWITCH();
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: 600, y: 700, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: 600, y: 700, button: "left", clickCount: 1 });
await sleep(200);
check(!(await state()).open, "바깥을 누르면 닫힌다");
await SWITCH();
await ev(`(async () => { const m = await ${importApp("/lib/app/veil.svelte.ts")}; m.openVeil(); })()`);
await sleep(300);
check(!(await state()).open, "가림막이 내려오면 닫힌다");
// 가림막 걷기 — 모듈로 (관문은 이 판의 대상이 아니다)
await ev(`(async () => { const m = await ${importApp("/lib/app/veil.svelte.ts")}; m.closeVeil(); })()`);
await sleep(300);
await ev(`document.querySelector('.xterm textarea')?.focus()`);

// ── ⑥ 카드 클릭 = 적용 — 라이트 벌(T4) · 라이트 캡처 ─────────────────────────
await SWITCH();
await sleep(350); // 들어오는 전이(300ms)가 끝난 자리를 잰다
const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('[data-ps-card=T4]').getBoundingClientRect())`));
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x + r.width / 2, y: r.y + 30, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x + r.width / 2, y: r.y + 30, button: "left", clickCount: 1 });
await sleep(800);
s = await state();
check(!s.open && s.theme === "light", `카드 클릭으로 라이트 벌 적용 (${s.theme})`);
// 캡처 전에 마우스를 치우고(말풍선) 적용 토스트가 걷히기를 기다린다 — 카드 줄만 보이게
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 600, y: 760 });
await sleep(6000);
await SWITCH();
await sleep(400);
s = await state();
check(s.sel === "T4", `라이트에서 다시 열면 T4 (${s.sel})`);
await shot("switcher-light.png");
await press("Escape");
await sleep(300); // 나가는 전이가 끝나고 나서 reduce 로 바꾼다

// ── ⑦ reduce — 애니메이션 없음 ───────────────────────────────────────────────
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await SWITCH();
const animR = await ev(`JSON.stringify([document.querySelector('[data-profile-switcher]').getAnimations().length, [...document.querySelectorAll('[data-ps-card]')].reduce((n, c) => n + c.getAnimations().length, 0)])`);
check(animR === "[0,0]", `reduce 면 애니메이션 없음 (${animR})`);
await press("Escape");
const leftR = await ev(`JSON.stringify([...document.querySelectorAll('[data-profile-switcher]')].map((p) => [p.hasAttribute('inert'), p.getAnimations().length, getComputedStyle(p).opacity]))`);
check(leftR === "[]", `reduce 면 닫을 때도 즉시 사라진다 (${leftR})`);
await send("Emulation.setEmulatedMedia", { features: [] });

// ── 설정 › 앱 테마의 카드 — 같은 얼굴(`ProfileCardFace`)을 나눠 쓴 뒤에도 그대로인가 ────────────
await ev(`(async () => { const m = await ${importApp("/lib/app/overlays.svelte.ts")}; m.openSettingsAt('theme', 'theme-profile'); })()`);
await sleep(1200);
const sc = JSON.parse(
  await ev(`JSON.stringify({ n: document.querySelectorAll('[data-profile-card]').length, thumbs: document.querySelectorAll('[data-profile-card] .pick > .thumb').length, metas: document.querySelectorAll('[data-profile-card] .pick > .meta').length, imgs: document.querySelectorAll('[data-profile-card] img.wp').length, badge: document.querySelector('[data-profile-card].active .badge')?.textContent.trim() ?? null, more: document.querySelectorAll('[data-profile-more]').length })`),
);
check(sc.n === 4 && sc.thumbs === 4 && sc.metas === 4 && sc.imgs === 2 && sc.more === 4, `설정 카드 넷 — 얼굴 · 사진 둘 · ⋯ (${JSON.stringify(sc)})`);
check(sc.badge === "사용 중", `설정 카드의 배지 (${sc.badge})`);
await shot("settings-cards.png");
await ev(`(async () => { const m = await ${importApp("/lib/app/dock.svelte.ts")}; m.toggleDock('settings'); })()`);
await sleep(400);

const errs1 = errors.filter((e) => !/stub: /.test(e));

// ── ⑧ 빈 목록 — 한 줄 · Esc ────────────────────────────────────────────────
await ev(`sessionStorage.setItem('ps-empty', '1')`);
await send("Page.reload", { ignoreCache: true });
await sleep(4000);
await ev(`document.body.focus()`);
await SWITCH();
await sleep(300);
const emptyText = await ev(`document.querySelector('[data-ps-empty]')?.textContent.trim() ?? null`);
check(emptyText === "저장된 프로필이 없습니다 — 설정 › 테마에서 만듭니다", `빈 목록 한 줄 (${emptyText})`);
await shot("switcher-empty.png");
await press("Escape");
check(!(await state()).open, "빈 목록도 Esc 로 닫힌다");
await ev(`sessionStorage.removeItem('ps-empty')`);

const errs = errors.filter((e) => !/stub: /.test(e));
check(errs.length === 0, `콘솔 예외 0 (${errs.length} · 스텁 거절 제외 · 앞 판 ${errs1.length})`);
for (const e of errs) console.log("  ERR", e.split("\n")[0]);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
