// Headless harness: **UI 크기·앱 글꼴** (docs/log/2026-09-25-ui-scale-font.md).
// `dock-slide-harness.mjs` 의 사본 — 스텁 표를 줄이고 시나리오만 다르다.
//
//   npx vite --port 1436 --strictPort   (다른 작업이 파일을 고치는 중이면 HMR 새로고침이 시나리오를
//   끊는다 — 그때는 server.hmr:false · watch:null 을 얹은 설정 파일로 띄운다)
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9260 --user-data-dir=%TEMP%/edge-uiscale \
//     --window-size=1100,800 http://localhost:1436/
//   PAGE_PORT=1436 node scripts/dev/ui-scale-harness.mjs outdir 9260
//
// 보는 것: ① 부팅 때 `[app] ui_scale = 125` 가 `plugin:webview|set_webview_zoom`(value 1.25)로
// 한 번 걸리고, 앱 글꼴이 `--font-ui` 인라인으로 걸려 body 의 계산된 글꼴이 바뀐다 ② 터미널
// xterm 의 글꼴 크기가 14 / 1.25 = 11.2 로 되돌려져 있다 ③ 설정 › 일반의 UI 크기 슬라이더(후보
// 인덱스)를 90 자리로 끄는 동안(`input`)은 걸리지 않고, 놓으면(`change`) 0.9 가 걸려 터미널이 15.56 이 된다 ④ 글꼴 칸을 비우면 인라인이 걷힌다 ⑤ [저장] 짐에
// ui_scale 이 실린다 ⑥ 다른 창의 `settings-saved` 를 받으면 다시 읽어 새 배율을 건다.
// 스텁 환경이라 웹뷰가 실제로 확대되지는 않는다 — 걸린 **호출**을 본다(실제 그림은 실기 몫).
// PNG: `ui-scale-settings.png`(설정 › 일반).
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9260";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1436";
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

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; window.__cbs = cbs; window.__listeners = {};
  let nextSession = 100;
  window.__settingsFile = { app: { ui_scale: 125, ui_font_family: "Georgia, serif" }, terminal: { font_size: 14 } };
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    get_host_meta: { tags: [], forwards: [] }, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
     load_snippets: null, 
     save_snippets: null, 
    host_history_list: {}, projects_list: [], git_worktree_list: [],
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    'plugin:notification|is_permission_granted': true,
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    resize_session: null, write_session: null, drop_session: null, session_log_path: null,
    list_snippets: [], session_logs_dir: 'C:\\\\logs', 'plugin:webview|set_webview_zoom': null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { window.__listeners[args.event] = args.handler; return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'plugin:event|emit') return Promise.resolve(null);
      if (cmd === 'load_settings') return Promise.resolve(JSON.parse(JSON.stringify(window.__settingsFile)));
      if (cmd === 'save_settings') { window.__saved = args.settings; return Promise.resolve(null); }
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(5000);

// 터미널 하나 — Ctrl+Shift+N (new-shell)
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers: 10, code: "KeyN", key: "N", windowsVirtualKeyCode: 78, nativeVirtualKeyCode: 78 });
await sleep(2000);

const zooms = () => ev(`window.__calls.filter(([c]) => c === 'plugin:webview|set_webview_zoom').map(([, a]) => a.value)`);
/**
 * 터미널 쪽 — ① 설정 모듈의 `termFontSize`(dev 서버는 같은 URL 을 같은 모듈 인스턴스로 준다)
 * ② xterm 이 **실제로** 그 크기를 받았는가: WebGL 렌더러는 DOM 측정 요소가 없으므로, 마지막
 * `resize_session` 의 cols 와 `.xterm-screen` 폭으로 셀 폭(CSS px)을 잰다. 셀 폭은 글꼴 크기에
 * 비례하므로 두 상태의 비가 글꼴 크기의 비와 같아야 한다.
 */
const termState = () => ev(`(async () => {
  const m = await import('/src/lib/settings.svelte.ts');
  const r = window.__calls.filter((c) => c[0] === 'resize_session').at(-1)?.[1];
  const w = parseFloat(document.querySelector('.xterm-screen')?.style.width ?? 'NaN');
  return { tfs: m.settings.termFontSize, cols: r?.cols ?? null, cellW: r ? w / r.cols : null };
})()`);
// 헤드리스는 dpr 1 이라 셀 폭이 정수 px 로 내림된다(6 · 9 · 4) — 비는 글꼴 비에 "가깝게" 만 맞는다.
const near = (a, b, tol = 0.15) => Math.abs(a / b - 1) < tol;

// ① 부팅
const z0 = await zooms();
console.log("boot zoom calls:", JSON.stringify(z0));
check(Array.isArray(z0) && z0.length === 1 && z0[0] === 1.25, "boot: set_webview_zoom(1.25) 한 번");
check((await ev(`document.documentElement.style.getPropertyValue('--font-ui')`)) === "Georgia, serif", "boot: --font-ui 인라인");
const bodyFont = await ev(`getComputedStyle(document.body).fontFamily`);
console.log("body font:", bodyFont);
check(/Georgia/.test(bodyFont), "boot: body 계산 글꼴 = Georgia");

// ② 터미널 글자 되돌려 맞추기
const s0 = await termState();
console.log("terminal:", JSON.stringify(s0));
check(s0.tfs === 11.2, "terminal: termFontSize = 14 / 1.25 = 11.2");
check(typeof s0.cellW === "number" && s0.cellW > 0, "terminal: xterm 이 떴다 (셀 폭을 잴 수 있다)");

// ③ 설정 › 일반 — 슬라이더로 90. UI 크기는 후보 슬라이더다(ValueSlider 의 steps — 값은 UI_SCALES 의
// 인덱스, 90 = 1). 놓을 때(change)만 건다 — 끄는 동안 배율이 바뀌면 손잡이가 포인터 밑에서 흔들린다.
// Ctrl+, — CDP 키로 한 번만 누른다 (합성 이벤트를 window·document 에 둘 다 쏘면 두 번 토글돼
// 독이 열렸다 닫힌다 — 닫히는 동안 본문이 DOM 에 남아 있어 요소 검사만으로는 안 보인다).
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers: 2, code: "Comma", key: ",", windowsVirtualKeyCode: 188, nativeVirtualKeyCode: 188 });
await sleep(1200);
const opened = await ev(`(() => { const e = document.querySelector('#app-ui-scale'); if (!e) return 'no row'; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? true : 'hidden'; })()`);
check(opened === true, "settings: 일반 섹션에 UI 크기 줄");
const sliderNow = await ev(`(() => { const s = document.querySelector('#app-ui-scale'); return { type: s.type, min: s.min, max: s.max, step: s.step, value: s.value, text: s.getAttribute('aria-valuetext') }; })()`);
console.log("slider:", JSON.stringify(sliderNow));
check(sliderNow?.type === "range" && sliderNow.min === "0" && sliderNow.max === "5" && sliderNow.step === "1", "settings: UI 크기 = 후보 인덱스 슬라이더 (0~5, step 1)");
check(sliderNow?.value === "4" && sliderNow.text === "125%", "settings: 125 → 인덱스 4 · aria-valuetext 125%");
check((await ev(`document.querySelector(".settings-view .range-now")`)) === null, "슬라이더 곁에 늘 보이는 값 글자는 없다 (말풍선만)");
check((await ev(`document.querySelector('#app-ui-font')?.value`)) === "Georgia, serif", "settings: 글꼴 칸 = 저장값");
console.log("capture:", await shot("ui-scale-settings.png"));

const slide = (idx, type) => ev(`(() => { const s = document.querySelector('#app-ui-scale'); s.value = '${idx}'; s.dispatchEvent(new Event('${type}', { bubbles: true })); return s.getAttribute('aria-valuetext'); })()`);
const zBefore = (await zooms()).length;
const dragText = await slide(1, "input");
await sleep(300);
console.log("dragging text:", dragText);
check((await zooms()).length === zBefore, "끄는 동안(input)에는 배율을 걸지 않는다");
const bubble = await ev(`document.querySelector('#app-ui-scale')?.closest('.range-tip')?.querySelector('.range-val')?.textContent`);
check(bubble === "90%", `끄는 동안 말풍선이 따라간다 (${bubble})`);
await slide(1, "change");
await sleep(500);
const z1 = await zooms();
console.log("zoom calls after 90:", JSON.stringify(z1));
check(z1.at(-1) === 0.9, "슬라이더 90 놓기(change) → set_webview_zoom(0.9)");
const s1 = await termState();
console.log("terminal after 90:", JSON.stringify(s1));
check(s1.tfs === 15.56, "terminal: termFontSize = 14 / 0.9 = 15.56");
check(near(s1.cellW / s0.cellW, 15.56 / 11.2), `xterm 셀 폭 비 ${(s1.cellW / s0.cellW).toFixed(3)} ≈ 글꼴 비 ${(15.56 / 11.2).toFixed(3)}`);

// 같은 값 재적용(색 슬라이더 등)은 IPC 를 다시 내지 않는다
const before = (await zooms()).length;
await slide(1, "input");
await slide(1, "change");
await sleep(300);
check((await zooms()).length === before, "같은 배율은 다시 부르지 않는다");

// ④ 글꼴 칸 비우기
await ev(`(() => { const i = document.querySelector('#app-ui-font'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(300);
check((await ev(`document.documentElement.style.getPropertyValue('--font-ui')`)) === "", "글꼴 비움 → 인라인 걷힘");
const bodyFont2 = await ev(`getComputedStyle(document.body).fontFamily`);
console.log("body font after clear:", bodyFont2);
check(/Segoe UI/.test(bodyFont2), "글꼴 비움 → theme.css 기본 스택");

// ⑤ [저장] 짐
const saveClick = await ev(`(() => { const b = [...document.querySelectorAll('.settings-view button')].find((e) => /^(저장|Save)$/.test((e.textContent || '').trim())); if (!b) return 'no save'; b.click(); return 'clicked'; })()`);
await sleep(600);
console.log("save:", saveClick, JSON.stringify(await ev(`window.__saved?.app ?? null`)));
check((await ev(`window.__saved?.app?.ui_scale`)) === 90, "저장 짐: ui_scale = 90");
check((await ev(`'ui_font_family' in (window.__saved?.app ?? {})`)) === false, "저장 짐: 빈 글꼴은 적지 않는다");

// ⑥ 다른 창의 저장 → 다시 읽고 새 배율
await ev(`(() => { window.__settingsFile = { app: { ui_scale: 150, ui_font_family: "'Courier New', monospace" }, terminal: { font_size: 12 } }; return 1; })()`);
const fired = await ev(`(() => { const id = window.__listeners['settings-saved']; const cb = window.__cbs.get(id); if (!cb) return 'no listener'; cb({ event: 'settings-saved', id: 1, payload: { from: 'tear-1' } }); return 'fired'; })()`);
await sleep(800);
console.log("external save:", fired, "zooms:", JSON.stringify(await zooms()));
check((await zooms()).at(-1) === 1.5, "다른 창 저장 → set_webview_zoom(1.5)");
check(/Courier New/.test(await ev(`getComputedStyle(document.body).fontFamily`)), "다른 창 저장 → 글꼴 따라옴");
const s2 = await termState();
console.log("terminal after external:", JSON.stringify(s2));
check(s2.tfs === 8, "terminal: termFontSize = 12 / 1.5 = 8");
check((await ev(`document.querySelector('#app-ui-scale')?.value`)) === "5", "다른 창 저장 → 슬라이더가 150 자리(인덱스 5)로");
check(near(s2.cellW / s0.cellW, 8 / 11.2), `xterm 셀 폭 비 ${(s2.cellW / s0.cellW).toFixed(3)} ≈ 글꼴 비 ${(8 / 11.2).toFixed(3)}`);

console.log(failed ? `\n${failed} FAILED` : "\nALL PASS");
ws.close();
process.exit(failed ? 1 : 0);
