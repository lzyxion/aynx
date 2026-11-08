// 헤드리스 계측 — **숨은 탭의 글자 폭 재기**(탭 전환 멈춤, 2026-10-17).
//
// 릴리스 앱 프로필: 탭을 오갈 때마다 메인 스레드가 2~8초 멈췄고, 그 시간은 `WidthCache._measure` 의 `offsetWidth`
// (글자마다 강제 스타일 재계산)였다. 숨은(`display:none`) 터미널은 폭이 0 으로 재지고, xterm 은 0 을 캐시하지 않아
// 같은 글자를 매번 다시 잰다. 이 판은 탭 둘(타일 셋씩, 한글 · 기호 · 굵게 · 기울임이 섞인 스크롤백)을 만들고
//   ① 탭을 오갈 때마다 ② 숨은 탭에 출력이 올 때
// 다음을 잰다:
//   - measure  : `.xterm-char-measure-element` 의 `offsetWidth` 읽기 수(= 글자 폭 재기)
//   - zero     : 그중 0 을 받은 수(= 숨은 터미널에서 잰 것 — 캐시에 안 남는다)
//   - longMax  : 최장 작업(ms, PerformanceObserver longtask)
//   - origins  : 재기가 일어난 자리(동기 · rAF · 유휴 작업 — 예약한 쪽 스택의 함수 이름 몇 개)
//
// 스텁은 `tab-slide-harness.mjs` 의 사본을 줄인 것이다(로컬 셸 — 세션 id 는 100 부터 순서대로).
// 판정: 숨은 터미널의 재기(zero)가 0 이어야 한다. 수정 전 숫자를 보려면 `--report` (실패로 치지 않는다).
//
// usage:
//   node scripts/dev/run-harness.mjs hidden-tab-measure-harness.mjs <outdir> [-- --report]
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const [outdir = "out", port = process.env.CDP_PORT ?? "9231", ...rest] = process.argv.slice(2);
const reportOnly = rest.includes("--report");
// `--dom`: WebGL 을 끈 설정(모든 타일이 늘 DOM 렌더러) — 다시 보인 탭의 행이 실제로 그려졌는지 · 글자 간격이 맞는지도 본다
const domMode = rest.includes("--dom");
fs.mkdirSync(outdir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1430";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
let counting = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (counting && d.method === "Runtime.exceptionThrown") {
    const s = (d.params.exceptionDetails.exception?.description ?? "").split("\n")[0];
    if (!/stub:/.test(s)) errors.push(s);
  }
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
const VK = { Tab: 9 };
const key = async (code, modifiers, keyName, wait = 300) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : (VK[code] ?? 0);
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  if (wait > 0) await sleep(wait);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  // ── 계측 ──
  window.__depth = 16;
  const m = window.__m = { measure: 0, zero: 0, origins: {}, long: [] };
  window.__mReset = () => { m.measure = 0; m.zero = 0; m.origins = {}; m.long = []; };
  const tag = () => {
    // 함수 이름이 없는 줄(익명)은 파일:줄로 — 압축되지 않은 vite 개발 번들이라 그 자리를 찾아갈 수 있다
    const names = (new Error().stack || '').split('\\n').slice(3, 3 + (window.__depth || 8)).map((l) => {
      const f = /at (?:new )?([\\w$.<>]+) \\(/.exec(l);
      if (f) return f[1];
      const u = /\\/([\\w.@-]+?)(?:\\?[^:]*)?:(\\d+):\\d+\\)?$/.exec(l);
      return u ? u[1] + ':' + u[2] : null;
    }).filter(Boolean);
    return names.join('<');
  };
  const od = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get() {
    const v = od.get.call(this);
    if (this.classList && this.classList.contains('xterm-char-measure-element')) {
      m.measure++;
      if (v === 0) {
        m.zero++;
        // 예약한 쪽(유휴 · rAF) + 재는 자리의 스택 — 재는 자리는 같은 길이 수천 번이라 첫 몇 프레임만 본다
        const o = (window.__origin ? window.__origin + ' ⇒ ' : 'sync:') + tag();
        m.origins[o] = (m.origins[o] || 0) + 1;
      }
    }
    return v;
  } });
  const wrap = (name, kind) => {
    const orig = window[name].bind(window);
    window[name] = (cb, ...a) => {
      const t = kind + ':' + tag();
      return orig((...x) => { const p = window.__origin; window.__origin = t; try { return cb(...x); } finally { window.__origin = p; } }, ...a);
    };
  };
  wrap('requestIdleCallback', 'idle');
  wrap('requestAnimationFrame', 'raf');
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) m.long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch {}

  // ── 스텁 ──
  const cbs = new Map(); let n = 0; window.__calls = []; window.__chan = {};
  const evts = new Map();
  let nextSession = 100;
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {},
    load_settings: ${domMode ? "{ app: { status_bar: 'bottom' }, terminal: { webgl: false } }" : "{ app: { status_bar: 'bottom' } }"},
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    close_session: null, list_forwards: [], reap_window_sessions: null, session_log_path: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 }, list_operations: { pending: [], recent: [] },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    vault_status: { state: 'off', hasMaster: false, entryCount: 0 }, vault_list: [], mcp_activity: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1600, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('.titlebar [role="tab"]')`)); i += 1) await sleep(500);
await sleep(800);
counting = true;

// ── 준비 — 탭 둘, 탭마다 타일 셋 ────────────────────────────────────────────
const xtermCount = () => ev(`document.querySelectorAll('.xterm').length`);
if ((await xtermCount()) === 0) await key("KeyN", 10, "N", 900);
await key("KeyD", 10, "D", 900);
await key("KeyD", 10, "D", 900);
await key("KeyT", 10, "T", 500);
await key("KeyN", 10, "N", 900);
await key("KeyD", 10, "D", 900);
await key("KeyD", 10, "D", 900);
const sessions = JSON.parse(await ev(`JSON.stringify(Object.keys(window.__chan).map(Number))`));
const setup = {
  tabs: await ev(`document.querySelectorAll('.titlebar [role="tab"]').length`),
  xterms: await xtermCount(),
  sessions,
  webglCanvases: await ev(`document.querySelectorAll('.xterm-screen > canvas:not(.xterm-image-layer)').length`),
};
console.log("setup:", JSON.stringify(setup));

// 글자 많은 스크롤백 — 한글 · 기호 · 굵게 · 기울임 · 색 (평평한 캐시 밖의 글자가 많아야 재기가 많다)
const WORDS = ["한글", "터미널", "세션", "─│┼", "→★◆", "가나다라", "ÄÖÜß", "αβγδ", "日本語", "abc", "123", "∑∫√", "▓▒░"];
const SGR = ["", "\x1b[1m", "\x1b[3m", "\x1b[1;3m", "\x1b[32m", "\x1b[1;35m"];
const body = (sid) =>
  Array.from({ length: 400 }, (_, k) => {
    let s = "";
    for (let j = 0; s.length < 110; j += 1) s += `${SGR[(k + j + sid) % SGR.length]}${WORDS[(k * 3 + j * 7 + sid) % WORDS.length]}${(k * 13 + j) % 97}\x1b[0m `;
    return s;
  }).join("\r\n") + "\r\n";
for (const sid of sessions) await ev(`window.__feed(${sid}, ${JSON.stringify(body(sid))})`);
await sleep(1500);

const tabIdx = () =>
  ev(`[...document.querySelectorAll('.titlebar [role="tab"]')].findIndex((b) => b.getAttribute('aria-selected') === 'true')`);
const snap = async () => JSON.parse(await ev(`JSON.stringify(window.__m)`));
const reset = () => ev(`window.__mReset()`);

const rows = [];
// ① 탭 오가기 — 여섯 번, 매번 2.5초 기다린다(유휴 작업까지 다 돌게)
for (let i = 0; i < 6; i += 1) {
  await reset();
  await key("Tab", 2, "Tab", 0); // Ctrl+Tab
  await sleep(2500);
  const s = await snap();
  rows.push({ phase: `switch#${i + 1}→tab${await tabIdx()}`, measure: s.measure, zero: s.zero, longMax: Math.max(0, ...s.long), longCount: s.long.length, origins: s.origins });
}
// ② 숨은 탭에 출력 — 지금 숨은 탭의 세션에 줄을 흘린다
const active = await tabIdx();
const hiddenSessions = active === 0 ? sessions.slice(3) : sessions.slice(0, 3);
await reset();
for (let k = 0; k < 20; k += 1) {
  for (const sid of hiddenSessions) await ev(`window.__feed(${sid}, ${JSON.stringify(body(sid + k).slice(0, 4000))})`);
  await sleep(100);
}
// 끝 표식 — 돌아갔을 때 화면(DOM 행)이 숨은 동안 온 출력까지 그렸는지 본다.
// 앞의 ESC 는 위 4000자 자르기가 남긴 반쪽 CSI 를 끊는다(없으면 표식의 첫 글자가 CSI 의 끝 바이트로 먹힌다).
for (const sid of hiddenSessions) await ev(`window.__feed(${sid}, ${JSON.stringify(`\x1b[0m\r\nMARK-${sid}\r\n`)})`);
await sleep(2500);
{
  const s = await snap();
  rows.push({ phase: "hidden-output", measure: s.measure, zero: s.zero, longMax: Math.max(0, ...s.long), longCount: s.long.length, origins: s.origins });
}
// ③ 돌아가 보기 — 출력을 받은 탭으로
await reset();
await key("Tab", 2, "Tab", 0);
await sleep(2500);
{
  const s = await snap();
  rows.push({ phase: "back-to-fed", measure: s.measure, zero: s.zero, longMax: Math.max(0, ...s.long), longCount: s.long.length, origins: s.origins });
}

// 보이는 탭의 DOM 행 — 글자가 있는 행 수 · 행 상자의 기본 글자 간격(px). WebGL 이면 행이 비어 있다.
const domRows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.pane-box')].filter((b) => getComputedStyle(b).display !== 'none').map((b) => {
  const rowsEl = b.querySelector('.xterm-rows');
  if (!rowsEl) return null;
  return { filled: [...rowsEl.children].filter((r) => r.textContent.trim().length > 0).length, total: rowsEl.children.length, spacing: rowsEl.style.letterSpacing, mark: (/MARK-\\d+/.exec(rowsEl.textContent) || [null])[0], tail: [...rowsEl.children].map((r) => r.textContent.trim()).filter(Boolean).slice(-2) };
}).filter(Boolean))`));

for (const r of rows) console.log(JSON.stringify(r));
console.log("domRows(visible tab):", JSON.stringify(domRows));
// 생성자의 기본 간격 재기('W' 한 번 — 숨길 때 새 DOM 렌더러가 선다)는 칸 수와 무관한 한 번이라 따로 센다
const ctorOnly = (r) => Object.entries(r.origins).filter(([k]) => k.includes("_setDefaultSpacing")).reduce((n, [, v]) => n + v, 0);
const totalZero = rows.reduce((n, r) => n + r.zero - ctorOnly(r), 0);
const worst = Math.max(...rows.map((r) => r.longMax));
console.log("SUMMARY", JSON.stringify({ totalZero, worstLongTaskMs: worst, errors }));
fs.writeFileSync(`${outdir}/hidden-tab-measure.json`, JSON.stringify({ setup, rows, errors }, null, 2));

let bad = 0;
const check = (name, ok, got) => {
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}`);
};
check("준비: 탭 둘 · 터미널 여섯", setup.tabs === 2 && setup.xterms === 6, [setup.tabs, setup.xterms]);
check("콘솔 예외 없음", errors.length === 0, errors);
if (!reportOnly) check("숨은 터미널의 행 그리기 재기(0 폭) 없음", totalZero === 0, totalZero);
if (!reportOnly) check("숨길 때 0 폭 재기는 타일당 한 번(새 DOM 렌더러의 기본 간격)뿐", rows.every((r) => r.zero <= 3), rows.map((r) => r.zero));
if (domMode && !reportOnly)
  check("DOM: 다시 보인 탭의 행이 그려졌고 기본 간격이 칸 폭이 아니다(|간격| < 2px)",
    domRows.length === 3 && domRows.every((d) => d.filled > 10 && Math.abs(parseFloat(d.spacing || "0")) < 2), domRows);
if (domMode && !reportOnly)
  check("DOM: 숨은 동안 온 마지막 출력(표식)까지 그려졌다",
    JSON.stringify(domRows.map((d) => d.mark).sort()) === JSON.stringify(hiddenSessions.map((s) => `MARK-${s}`).sort()), domRows.map((d) => d.mark));
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
