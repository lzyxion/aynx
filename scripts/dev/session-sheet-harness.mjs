// 헤드리스 검증 — **세션 판 여닫기 · 키보드 · 덮개** (`Ctrl+Shift+M` · `SessionSheet.svelte` · `app/session-sheet.svelte.ts`).
//
// 지운 대시보드 판들이 보던 것 가운데 세션 판에 지금도 살아 있는데 다른 판이 보지 않는 넷(2026-11-21). 끌기는
// `sheet-tile-drag-harness.mjs`, 칸의 표식 · 말풍선은 `glyph-screens-harness.mjs` 가 본다.
//
// 무대: 로컬 셸 스텁 — 탭 A(타일 A1 | A2) · 탭 B(타일 B1). 키는 전부 진짜 키(`Input.dispatchKeyEvent`)다.
// 보는 것:
//   ① 열기 = A1 의 터미널에서 Ctrl+Shift+M → 판이 서고 키보드는 판(`[data-session-sheet]`)으로. Escape → 접히고 키보드가 열기 전
//      자리(A1 의 터미널 입력 칸)로 돌아온다(닫은 직후 · 나가는 전이가 끝난 뒤 둘 다). 같은 단축키(판에 포커스)로도 접히고 돌아온다.
//   ② 키보드 — 판 몸에서 Tab 으로 칸에 들어간다(로빙 탭 하나 = 지금 탭의 첫 칸 A1) · → 다음 칸(A2) · ↓ 다음 탭 카드의 첫 칸(B1) ·
//      ↑ 앞 탭 카드 · End/Home · Enter → 판이 접히고 그 탭 · 그 타일로 가며 키보드는 그 타일(B1)의 터미널에.
//   ③ 판은 덮개 — 떠 있는 동안 · 여닫는 사이 `resize_session` 이 늘지 않고 타일 상자도 그대로.
//   ④ 몸짓 — 열리는 중간에 transform 애니메이션이 돌고(위에서 내려옴), 닫는 순간 판은 `inert` 로 남아 나가는 전이 중이며
//      전이가 끝나면 DOM 에서 빠진다. `prefers-reduced-motion: reduce` 면 여닫기 모두 즉시. 콘솔 예외 0.
//
//   node scripts/dev/run-harness.mjs session-sheet-harness.mjs <outdir> --size 1280x860
//     → <outdir>/sheet-open.png · sheet-keyboard.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { reloadBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.env.CDP_PORT ?? process.argv[3] ?? "9222";
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
if (!target) throw new Error(`localhost:${pagePort} 페이지가 없다`);
const ws = new WebSocket(target.webSocketDebuggerUrl);
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
  if (d.method === "Runtime.exceptionThrown") errors.push(String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text ?? "exception"));
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push(d.params.args.map((a) => a.value ?? a.description ?? "").join(" "));
};
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
/** 예외는 "EXC …" 문자열로 돌려준다 — 그래서 참 · 거짓 판정은 늘 `=== true` 로 받는다 */
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  return r.result?.exceptionDetails
    ? "EXC " + (r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text ?? "").split("\n")[0]
    : r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let passed = 0;
let failed = 0;
const check = (ok, label) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = path.join(outDir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log("PNG " + path.resolve(p));
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const sheetMod = importApp("app/session-sheet.svelte.ts");

/** 진짜 키 — 포커스된 요소로 간다. `wait` 이 0 이면 곧바로 돌아온다(몸짓 중간을 잴 때) */
const VK = { Escape: 27, Tab: 9, Enter: 13, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, KeyM: 77 };
async function press(code, { ctrl = false, shift = false, wait = 150 } = {}) {
  const key = code === "KeyM" ? "M" : code;
  const modifiers = (ctrl ? 2 : 0) | (shift ? 8 : 0);
  const base = { code, key, modifiers, windowsVirtualKeyCode: VK[code], nativeVirtualKeyCode: VK[code] };
  const text = code === "Enter" ? "\r" : undefined;
  await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, ...(text ? { text, unmodifiedText: text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
  if (wait) await sleep(wait);
}
const TOGGLE = (o = {}) => press("KeyM", { ctrl: true, shift: true, ...o });

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(5000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  const answers = {
    list_hosts: { hosts: [], warnings: [] }, get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [], load_snippets: null, save_snippets: null,
    load_settings: { projects: { start_screen: 'off' } }, save_settings: null,
    host_history_list: {}, projects_list: [], session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, close_session: null, close_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12, reap_window_sessions: null,
    vault_status: 'none', vault_list: [], mcp_status: { clis: [] }, list_forwards: [], list_console_sessions: [],
    delegation_list_targets: [], mcp_activity: null, audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' }, audit_runs: [],
    list_operations: { pending: [], recent: [] },
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args ?? null]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
collecting = true;
await reloadBoot(send, ev);

// ── 무대 — 탭 A(A1 | A2) · 탭 B(B1) ─────────────────────────────────────────────
const openTile = async () =>
  JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newLocalPane(); w.openInNewTab(p); return JSON.stringify({ id: p.id, tab: w.activeTabId() }); })()`));
const addTile = () => ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newLocalPane(); w.openPaneHere(p); return p.id; })()`);
const A = await openTile();
await sleep(400);
const A2 = await addTile();
await sleep(400);
const B = await openTile();
await sleep(400);
const term = (pane) => `document.querySelector('[data-pane="${pane}"] .xterm textarea')`;
// 찬 vite 에서는 xterm 이 늦게 선다 — 세 타일의 입력 칸이 설 때까지
for (let i = 0; i < 75; i++) {
  if ((await ev(`[${JSON.stringify(A.id)}, ${JSON.stringify(A2)}, ${JSON.stringify(B.id)}].every((p) => !!document.querySelector('[data-pane="' + p + '"] .xterm textarea'))`)) === true) break;
  await sleep(200);
}
await ev(`(async () => (await ${tabsMod}).selectTab(${JSON.stringify(A.tab)}))()`);
await sleep(300);
await ev(`(async () => (await ${tabsMod}).focusTile(${JSON.stringify(A.tab)}, ${JSON.stringify(A.id)}))()`);
await sleep(400);
await ev(`${term(A.id)}?.focus()`);
await sleep(200);
console.log("무대:", JSON.stringify({ A: A.tab, a1: A.id, a2: A2, B: B.tab, b1: B.id }));

/** 지금 상태 — 판 열림(모델 · DOM) · 키보드 자리 · 보던 탭 · 포커스 타일 */
const STATE = `(async () => {
  const m = await ${sheetMod}; const w = await ${tabsMod};
  const ae = document.activeElement;
  const sheets = [...document.querySelectorAll('[data-session-sheet]')];
  return JSON.stringify({
    open: m.sessionSheetOpen(),
    dom: sheets.length,
    inert: sheets.map((s) => s.hasAttribute('inert') || !!s.closest('[inert]')),
    focus: ae === document.body ? 'body' : ae?.matches?.('[data-session-sheet]') ? 'sheet' : ae?.dataset?.sheetCell ? 'cell:' + ae.dataset.sheetCell : ae?.closest?.('.xterm') ? 'term:' + (ae.closest('[data-pane]')?.dataset.pane ?? '?') : (ae?.tagName ?? 'null') + (ae?.className ? '.' + String(ae.className).split(' ')[0] : ''),
    tab: w.activeTabId(),
    pane: w.focusedPane()?.id ?? null,
  });
})()`;
const state = async () => {
  const raw = await ev(STATE);
  return typeof raw === "string" && raw.startsWith("{") ? JSON.parse(raw) : { error: raw };
};
const resizes = async () => ev(`window.__calls.filter(([c]) => c === 'resize_session' || c === 'resize_ssh').length`);
const paneBoxes = async () =>
  ev(`JSON.stringify([...document.querySelectorAll('[data-pane]')].filter((e) => e.getBoundingClientRect().width > 0).map((e) => { const r = e.getBoundingClientRect(); return [e.dataset.pane, Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)]; }))`);

let s = await state();
check(s.focus === `term:${A.id}` && s.tab === A.tab, `시작 — 키보드는 A1 의 터미널 (${s.focus} · ${s.tab === A.tab ? "탭 A" : s.tab})`);

// ── ③ 앞 — 가라앉은 resize 수 · 타일 상자 ─────────────────────────────────────
await sleep(800);
const r0 = await resizes();
const boxes0 = await paneBoxes();

// ── ① 열기 · ④ 열리는 중간 ───────────────────────────────────────────────────
await TOGGLE({ wait: 0 });
const midOpen = JSON.parse(
  await ev(`JSON.stringify((() => { const sh = document.querySelector('[data-session-sheet]'); if (!sh) return { there: false }; const a = sh.getAnimations(); const tf = getComputedStyle(sh).transform; return { there: true, running: a.filter((x) => x.playState === 'running').length, ty: tf === 'none' ? 0 : Math.round(new DOMMatrix(tf).m42) }; })())`),
);
check(midOpen.there === true && midOpen.running > 0 && midOpen.ty < 0, `④ 열리는 중간 — 애니메이션이 돌고 판은 아직 위에 있다 (${JSON.stringify(midOpen)})`);
await sleep(400);
s = await state();
check(s.open === true && s.dom === 1, `① Ctrl+Shift+M 로 판이 선다 (${s.open} · DOM ${s.dom})`);
check(s.focus === "sheet", `① 열리면 키보드는 판으로 (${s.focus})`);
const settled = await ev(`(() => { const sh = document.querySelector('[data-session-sheet]'); const tf = getComputedStyle(sh).transform; return sh.getAnimations().filter((x) => x.playState === 'running').length === 0 && (tf === 'none' || new DOMMatrix(tf).m42 === 0); })()`);
check(settled === true, `④ 다 내려온 뒤 — 움직임 끝 · 제자리 (${settled})`);
const cellsN = await ev(`document.querySelectorAll('[data-session-sheet] [data-sheet-cell]').length`);
check(cellsN >= 3, `칸 셋 이상(A1 · A2 · B1 — 시작 탭이 있으면 더) (${cellsN})`);
await shot("sheet-open.png");

// ── ③ 떠 있는 동안 ───────────────────────────────────────────────────────────
await sleep(600);
const r1 = await resizes();
const boxes1 = await paneBoxes();
check(r1 === r0, `③ 판이 떠 있는 동안 resize_session 이 늘지 않는다 (${r0} → ${r1})`);
check(boxes1 === boxes0, `③ 타일 상자 그대로 (덮개) ${boxes1 === boxes0 ? "" : boxes0 + " → " + boxes1}`);

// ── ① Escape · ④ 닫는 순간 ───────────────────────────────────────────────────
await press("Escape", { wait: 0 });
const midClose = JSON.parse(
  await ev(`JSON.stringify((() => { const sh = document.querySelector('[data-session-sheet]'); return sh ? { there: true, inert: sh.hasAttribute('inert') || !!sh.closest('[inert]'), running: sh.getAnimations().filter((x) => x.playState === 'running').length } : { there: false }; })())`),
);
check(midClose.there === true && midClose.inert === true && midClose.running > 0, `④ 닫는 순간 — 판은 inert 로 남아 나가는 전이 중 (${JSON.stringify(midClose)})`);
await sleep(120);
s = await state();
check(s.open === false, "① Escape 로 접힌다");
check(s.focus === `term:${A.id}`, `① 닫은 직후 키보드가 A1 의 터미널로 (${s.focus})`);
await sleep(600);
s = await state();
check(s.dom === 0, `④ 나가는 전이 뒤 DOM 에서 빠진다 (${s.dom})`);
check(s.focus === `term:${A.id}`, `① 전이가 끝난 뒤에도 키보드는 A1 의 터미널 (${s.focus})`);

// ── ① 같은 단축키로 닫기(판에 포커스) ────────────────────────────────────────
await TOGGLE({ wait: 400 });
s = await state();
check(s.open === true && s.focus === "sheet", `① 다시 열림 · 키보드는 판 (${s.open} · ${s.focus})`);
await TOGGLE({ wait: 120 });
s = await state();
check(s.open === false, "① 같은 단축키로 접힌다");
await sleep(600);
s = await state();
check(s.dom === 0 && s.focus === `term:${A.id}`, `① 단축키로 닫아도 키보드는 A1 의 터미널 (${s.focus} · DOM ${s.dom})`);

// ── ③ 여닫은 뒤 ─────────────────────────────────────────────────────────────
const r2 = await resizes();
const boxes2 = await paneBoxes();
check(r2 === r0, `③ 두 번 여닫은 뒤에도 resize_session 그대로 (${r0} → ${r2})`);
check(boxes2 === boxes0, "③ 여닫은 뒤 타일 상자 그대로");

// ── ② 키보드 이동 ────────────────────────────────────────────────────────────
await TOGGLE({ wait: 400 });
const order = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-session-sheet] [data-sheet-cell]')].map((c) => c.dataset.sheetCell))`));
const cardFirst = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-session-sheet] [data-sheet-tab]')].map((t) => t.querySelector('[data-sheet-cell]')?.dataset.sheetCell ?? null))`));
const roving = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-session-sheet] [data-sheet-cell][tabindex="0"]')].map((c) => c.dataset.sheetCell))`));
console.log("칸 순서:", JSON.stringify(order), "탭 카드 첫 칸:", JSON.stringify(cardFirst));
check(JSON.stringify(roving) === JSON.stringify([A.id]), `② Tab 순회에 끼는 칸은 하나 — 지금 탭의 첫 칸 A1 (${roving})`);
// 판 몸 → (머리의 [닫기]) → 로빙 칸. 몇 번 만에 닿는지는 머리 단추 수에 달려 세지 않는다
let tabs = 0;
for (; tabs < 5; tabs++) {
  if ((await state()).focus.startsWith("cell:")) break;
  await press("Tab");
}
s = await state();
check(s.focus === `cell:${A.id}`, `② Tab 으로 칸에 들어간다 — A1 (${s.focus} · Tab ${tabs}번)`);
await press("ArrowRight");
s = await state();
check(s.focus === `cell:${A2}`, `② → 다음 칸 A2 (${s.focus})`);
check((await ev(`document.querySelector('[data-sheet-cell="${A2}"]').tabIndex`)) === 0, "② 옮긴 칸이 로빙 칸이 된다(tabindex 0)");
await press("ArrowLeft");
s = await state();
check(s.focus === `cell:${A.id}`, `② ← 앞 칸 A1 (${s.focus})`);
await press("ArrowDown");
s = await state();
const nextCard = cardFirst[cardFirst.indexOf(A.id) + 1] ?? null;
check(nextCard === B.id && s.focus === `cell:${B.id}`, `② ↓ 다음 탭 카드의 첫 칸 B1 (${s.focus} · 다음 카드 첫 칸 ${nextCard})`);
await press("ArrowUp");
s = await state();
check(s.focus === `cell:${A.id}`, `② ↑ 앞 탭 카드의 첫 칸 A1 (${s.focus})`);
await press("End");
s = await state();
check(s.focus === `cell:${order.at(-1)}`, `② End — 마지막 칸 (${s.focus})`);
await press("Home");
s = await state();
check(s.focus === `cell:${order[0]}`, `② Home — 첫 칸 (${s.focus})`);
check(s.open === true, "② 칸 사이를 옮겨도 판은 열린 채");
// B1 으로 가서 Enter — 첫 칸(Home)에서 ↓ 로 탭 카드를 넘어간다
for (let i = 0; i < cardFirst.length && (await state()).focus !== `cell:${B.id}`; i++) await press("ArrowDown");
s = await state();
check(s.focus === `cell:${B.id}`, `② B1 칸에 키보드 (${s.focus})`);
await shot("sheet-keyboard.png");
await press("Enter", { wait: 120 });
s = await state();
check(s.open === false, "② Enter → 판이 접힌다");
check(s.tab === B.tab && s.pane === B.id, `② Enter → 그 탭 · 그 타일로 (${s.tab === B.tab ? "탭 B" : s.tab} · ${s.pane})`);
await sleep(600);
s = await state();
check(s.focus === `term:${B.id}`, `② Enter 뒤 키보드는 B1 의 터미널 (${s.focus})`);
check(s.dom === 0, "② 판은 DOM 에서도 빠진다");

// ── ④ reduce — 여닫기 즉시 ───────────────────────────────────────────────────
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await TOGGLE({ wait: 0 });
const rOpen = JSON.parse(
  await ev(`JSON.stringify((() => { const sh = document.querySelector('[data-session-sheet]'); if (!sh) return { there: false }; const tf = getComputedStyle(sh).transform; return { there: true, running: sh.getAnimations().filter((x) => x.playState === 'running').length, ty: tf === 'none' ? 0 : Math.round(new DOMMatrix(tf).m42) }; })())`),
);
check(rOpen.there === true && rOpen.running === 0 && rOpen.ty === 0, `④ reduce — 열자마자 제자리 · 움직임 없음 (${JSON.stringify(rOpen)})`);
await sleep(300);
await press("Escape", { wait: 0 });
await sleep(40);
const rClose = await ev(`document.querySelectorAll('[data-session-sheet]').length`);
check(rClose === 0, `④ reduce — 닫자마자 DOM 에서 빠진다 (${rClose})`);
await sleep(300);
s = await state();
check(s.open === false && s.focus === `term:${B.id}`, `④ reduce 로 닫아도 키보드는 B1 의 터미널 (${s.focus})`);
await send("Emulation.setEmulatedMedia", { features: [] });

const errs = errors.filter((e) => !/stub: /.test(e));
check(errs.length === 0, `콘솔 예외 0 (${errs.length} · 스텁 거절 제외)`);
for (const e of errs) console.log("  ERR", e.split("\n")[0]);
console.log(`${passed} PASS · ${failed} FAIL`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
