// 헤드리스 검증 — **탭 전환 슬라이드** (docs/log/2026-09-29-tab-slide.md).
//
// ① 다음 탭(Ctrl+Tab) → 떠나는 탭과 들어오는 탭의 층이 함께 움직인다(방향: 오른쪽 탭으로 가면 내용이 왼쪽으로) ·
//    떠나는 층은 `inert` · 키보드는 곧바로 새 탭의 터미널이고 친 글자는 새 탭의 `write_session` 으로 간다 ·
//    이전 탭(Ctrl+Shift+Tab)은 반대 방향 · 멈추면 애니메이션이 남지 않고 활성 탭의 층만 그려져 있다 ·
// ② 연타 5회 → 걸린 움직임이 쌓이지 않고(그려진 탭 ≤ 2) 도중 전환은 짧게(rapidMs) · 끝나면 마지막 탭만 ·
// ③ 탭을 닫아 선택이 바뀌면 슬라이드 없음 · ④ 사용량 화면(덮개 — `coverViewOpen`)이 떠 있을 때 탭을 누르면 슬라이드 없음 ·
// ⑤ 움직임 줄이기면 없음 · 처음부터 끝까지 `resize_session` 호출 수 그대로 · 콘솔 예외 0.
//
// 한 번의 전환을 멈춰 0 · 100 · 200 · 400ms 장면을 `<outdir>/tab-slide-XXX.png` 로 남긴다.
//
// 스텁은 `dashboard-harness.mjs` 의 사본을 줄인 것이다(로컬 셸 — 세션 id 는 100 부터 순서대로).
//
// usage:
//   npx vite --port 1430 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9231 --user-data-dir=%TEMP%/edge-aynx-slide \
//     --window-size=1200,800 http://localhost:1430/
//   PAGE_PORT=1430 node scripts/dev/tab-slide-harness.mjs <outdir> 9231
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9231"] = process.argv.slice(2);
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
const shot = async (name) => {
  const p = path.join(outdir, name);
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
      console.log("PNG " + path.resolve(p));
      return;
    }
    await sleep(500);
  }
  console.log("capture failed: " + p);
};
const VK = { Tab: 9, Escape: 27 };
const key = async (code, modifiers, keyName, wait = 300) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : (VK[code] ?? 0);
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  if (wait > 0) await sleep(wait);
};
const typeChar = async (ch) => {
  const vk = ch.toUpperCase().charCodeAt(0);
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: `Key${ch.toUpperCase()}`, key: ch, text: ch, unmodifiedText: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: `Key${ch.toUpperCase()}`, key: ch, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
};

let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; window.__calls = []; window.__chan = {};
  const evts = new Map();
  let nextSession = 100;
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    load_settings: { app: { status_bar: 'bottom' } },
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
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [] });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
counting = true;

// ── 준비 — 탭 셋, 탭마다 로컬 셸 하나 ────────────────────────────────────────
// 닫히는 탭은 180ms 동안 폭 0 까지 접히며 DOM 에 남는다(`Tabs.svelte` 의 `tabLeave` — `data-leaving`). 그 칸은 탭이 아니다.
const tabCount = () => ev(`[...document.querySelectorAll('.titlebar [role="tab"]')].filter((e) => !e.closest('[data-leaving]')).length`);
const xtermCount = () => ev(`document.querySelectorAll('.xterm').length`);
if ((await xtermCount()) === 0) await key("KeyN", 10, "N", 900);
for (let i = 0; i < 2; i += 1) {
  await key("KeyT", 10, "T", 500);
  await key("KeyN", 10, "N", 1000);
}
console.log("setup:", JSON.stringify({ tabs: await tabCount(), xterms: await xtermCount() }));
check("준비: 탭 셋 · 터미널 셋", [await tabCount(), await xtermCount()], [3, 3]);

const activeIdx = () =>
  ev(`[...document.querySelectorAll('.titlebar [role="tab"]')].findIndex((b) => b.getAttribute('aria-selected') === 'true')`);
const resizeCalls = () => ev(`window.__calls.filter(([c]) => c === 'resize_session').length`);
/** 탭 id 들 — 캔버스의 상자가 가진 `data-tab` 을 탭 바 순서로 */
const tabIds = JSON.parse(await ev(`JSON.stringify((() => {
  // 탭 바 순서 = 상자 생성 순서(탭마다 셸 하나를 차례로 열었다)
  return [...new Set([...document.querySelectorAll(".host > .pane-box")].map((b) => b.dataset.tab))];
})())`));
console.log("tabIds:", JSON.stringify(tabIds));
/** 캔버스의 상태 — 탭마다 그려졌는가 · 애니메이션 수 · 지금 가로 위치 · inert */
const layers = () => ev(`JSON.stringify((() => {
  const out = {};
  for (const b of document.querySelectorAll('.host > .pane-box, .host > .lines')) {
    const id = b.dataset.tab; if (!id) continue;
    const o = out[id] ??= { shown: false, anims: 0, x: 0, inert: false, dur: [] };
    if (b.classList.contains('pane-box')) {
      o.shown = getComputedStyle(b).display !== 'none';
      o.x = Math.round(new DOMMatrixReadOnly(getComputedStyle(b).transform).m41);
      o.inert = b.inert;
    }
    for (const a of b.getAnimations()) { o.anims += 1; o.dur.push(a.effect.getTiming().duration); }
  }
  return out;
})())`).then(JSON.parse);
const shownTabs = (L) => Object.keys(L).filter((k) => L[k].shown);
const focusTab = () => ev(`document.activeElement?.closest('.pane-box')?.dataset.tab ?? null`);
const writesTo = () => ev(`JSON.stringify(window.__calls.filter(([c]) => c === 'write_session').map(([, a]) => a.id))`).then(JSON.parse);

// 첫 탭으로 가서 멎기를 기다린다
await ev(`document.querySelectorAll('.titlebar [role="tab"]')[0].click()`);
await sleep(900);
await ev(`document.querySelector('.pane-box[data-tab="${tabIds[0]}"] .xterm textarea')?.focus()`);
await sleep(100);
check("출발: 첫 탭 · 그려진 탭은 그것 하나", [await activeIdx(), shownTabs(await layers())], [0, [tabIds[0]]]);
const resize0 = await resizeCalls();

// ── ① 다음 탭 ────────────────────────────────────────────────────────────
await key("Tab", 2, "Tab", 0); // Ctrl+Tab
await sleep(60);
let L = await layers();
console.log("next+60ms:", JSON.stringify(L));
check("다음 탭 → 활성 탭은 둘째", await activeIdx(), 1);
check("두 탭 층이 함께 움직인다 (상자 + 분할선 층)", [L[tabIds[0]].anims >= 1, L[tabIds[1]].anims >= 1, L[tabIds[2]].anims], [true, true, 0]);
check("방향: 떠나는 층은 왼쪽(음수) · 들어오는 층은 오른쪽(양수)에서", [L[tabIds[0]].x < 0, L[tabIds[1]].x > 0], [true, true]);
// 길이는 `TAB_SLIDE.ms` — 400 → 550(10-17 사용자) → 460ms(10-23 사용자 "좀만 빠르게", `pane/tab-slide.svelte.ts`)
check("길이 460ms", L[tabIds[1]].dur.length > 0 && L[tabIds[1]].dur.every((d) => d === 460), true);
check("떠나는 층은 inert · 들어오는 층은 아님", [L[tabIds[0]].inert, L[tabIds[1]].inert], [true, false]);
check("셋째 탭은 그려지지 않는다", L[tabIds[2]].shown, false);
check("키보드는 곧바로 새 탭의 터미널", await focusTab(), tabIds[1]);
const w0 = (await writesTo()).length;
await typeChar("a");
await sleep(60);
check("친 글자는 새 탭의 세션(101)으로 간다", (await writesTo()).slice(w0), [101]);
await sleep(600);
L = await layers();
check("멎은 뒤 — 애니메이션 없음 · 그려진 탭은 활성 탭 하나 · inert 없음",
  [Object.values(L).reduce((n, o) => n + o.anims, 0), shownTabs(L), L[tabIds[1]].x, L[tabIds[0]].inert], [0, [tabIds[1]], 0, false]);

// 이전 탭 — 반대 방향
await key("Tab", 10, "Tab", 0); // Ctrl+Shift+Tab
await sleep(60);
L = await layers();
check("이전 탭 → 떠나는 층은 오른쪽(양수)으로 · 들어오는 층은 왼쪽(음수)에서", [await activeIdx(), L[tabIds[1]].x > 0, L[tabIds[0]].x < 0], [0, true, true]);
await sleep(700);

// ── 장면 — 한 번의 전환을 멈춰 찍는다 ─────────────────────────────────────
// 탭마다 알아볼 글을 흘린다 (세션 100 · 101 · 102 = 탭 1 · 2 · 3)
const COLORS = [36, 33, 35];
for (let i = 0; i < 3; i += 1) {
  const lines = Array.from({ length: 14 }, (_, k) => `\x1b[${COLORS[i]}m탭 ${i + 1}\x1b[0m  line ${k + 1} — ${"#".repeat(8 + ((k * 7 + i * 5) % 40))}`).join("\r\n");
  console.log("feed", i, await ev(`window.__feed(${100 + i}, ${JSON.stringify(lines + "\r\n")})`));

}
await sleep(300);
await key("Tab", 2, "Tab", 0);
await ev(`(() => { window.__slide = [...document.querySelectorAll('.host > .pane-box, .host > .lines')].flatMap((e) => e.getAnimations()); window.__slide.forEach((a) => a.pause()); return window.__slide.length; })()`);
for (const ms of [0, 100, 200, 400]) {
  await ev(`window.__slide.forEach((a) => (a.currentTime = ${ms}))`);
  await sleep(120);
  await shot(`tab-slide-${String(ms).padStart(3, "0")}.png`);
}
await ev(`window.__slide.forEach((a) => a.finish())`);
await sleep(300);
L = await layers();
check("장면 뒤 — 둘째 탭만 · 애니메이션 없음", [await activeIdx(), shownTabs(L), Object.values(L).reduce((n, o) => n + o.anims, 0)], [1, [tabIds[1]], 0]);

// ── ② 연타 ───────────────────────────────────────────────────────────────
let maxShown = 0;
const rapidDur = [];
for (let i = 0; i < 5; i += 1) {
  await key("Tab", 2, "Tab", 0);
  await sleep(40);
  L = await layers();
  maxShown = Math.max(maxShown, shownTabs(L).length);
  if (i > 0) rapidDur.push(...Object.values(L).flatMap((o) => o.dur));
}
check("연타 도중 그려진 탭은 둘을 넘지 않는다", maxShown <= 2, true);
// `TAB_SLIDE.rapidMs` — 200 → 120ms(10-22 이전, 연타 · 누르고 있기)
check("도중에 바뀐 전환은 짧게(120ms)", rapidDur.length > 0 && rapidDur.every((d) => d === 120), true);
await sleep(700);
L = await layers();
const want = (1 + 5) % 3;
check("연타 5회 뒤 — 마지막 탭만 · 제자리 · 애니메이션 · inert 없음",
  [await activeIdx(), shownTabs(L), L[tabIds[want]].x, Object.values(L).reduce((n, o) => n + o.anims, 0), Object.values(L).some((o) => o.inert)],
  [want, [tabIds[want]], 0, 0, false]);
check("키보드는 마지막 탭의 터미널", await focusTab(), tabIds[want]);

// 되돌아가기 — 도는 도중 반대로 가면 지금 자리에서 되돌아온다(튀지 않는다)
// 도는 움직임을 멈춰 그 자리를 고정한 뒤 반대로 누르고, 새 움직임의 첫 키프레임이 그 자리인지 본다.
await key("Tab", 2, "Tab", 0);
await sleep(150);
// (멈춤은 다음 프레임에 확정된다 — `ready` 를 기다린 뒤 읽는다)
await ev(`(async () => { const as = [...document.querySelectorAll('.host > .pane-box, .host > .lines')].flatMap((e) => e.getAnimations()); as.forEach((a) => a.pause()); await Promise.all(as.map((a) => a.ready)); await new Promise(requestAnimationFrame); })()`);
const before = (await layers())[tabIds[want]].x;
await key("Tab", 10, "Tab", 0);
const startAt = await ev(`(() => {
  const a = document.querySelector('.host > .pane-box[data-tab="${tabIds[want]}"]').getAnimations()[0];
  return a ? Math.round(new DOMMatrixReadOnly(a.effect.getKeyframes()[0].transform).m41) : null;
})()`);
console.log("reverse:", JSON.stringify({ before, startAt }));
check("되돌아가기 — 떠나던 층이 멈춘 그 자리에서 돌아온다(±1px)", before < 0 && startAt !== null && Math.abs(startAt - before) <= 1, true);
await sleep(600);
check("되돌아간 뒤 — 그 탭만", [await activeIdx(), shownTabs(await layers())], [want, [tabIds[want]]]);

check("여기까지 resize_session 호출 수 그대로", await resizeCalls(), resize0);

// ── ③ 탭 닫기 → 슬라이드 없음 ────────────────────────────────────────────
await ev(`document.querySelectorAll('.titlebar [role="tab"]')[${want}].closest('.tab').querySelector('.close').click()`);
await sleep(40);
L = await layers();
check("활성 탭을 닫아 선택이 바뀌어도 애니메이션 없음 · 그려진 탭 하나",
  [await tabCount(), Object.values(L).reduce((n, o) => n + o.anims, 0), shownTabs(L).length], [2, 0, 1]);
await sleep(400);

// ── ④ 덮개 화면(사용량)이 떠 있을 때 탭을 누르면 → 슬라이드 없음 ─────────────
// 캔버스를 덮던 전체 화면 대시보드는 2026-10-07 에 없어졌고(Ctrl+Shift+M 은 이제 세션 시트 — 덮개라 슬라이드를 막지 않는다),
// 같은 규칙은 사용량 · 자원 화면(`app/usage-view` 의 `coverViewOpen`)에 남았다 — `app/tabs.svelte.ts` 의 `pickTab` 머리말.
const usageMod = `(async () => { const e = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('app/usage-view.svelte.ts')); if (!e) throw new Error('module not loaded yet'); return await import(e); })()`;
await ev(`(async () => (await ${usageMod}).openUsageView())()`);
await sleep(300);
check("사용량 화면이 덮개로 섰다", await ev(`(async () => (await ${usageMod}).coverViewOpen())()`), true);
const cur = await activeIdx();
await ev(`document.querySelectorAll('.titlebar [role="tab"]')[${cur === 0 ? 1 : 0}].click()`);
await sleep(40);
L = await layers();
check("사용량 화면에서 탭 → 탭은 바뀌고 슬라이드 없음",
  [await activeIdx(), Object.values(L).reduce((n, o) => n + o.anims, 0), shownTabs(L).length], [cur === 0 ? 1 : 0, 0, 1]);
check("탭을 고르면 덮개가 걷힌다", await ev(`(async () => (await ${usageMod}).coverViewOpen())()`), false);
await sleep(500);

// ── ⑤ 움직임 줄이기 ──────────────────────────────────────────────────────
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
const r0 = await activeIdx();
await key("Tab", 2, "Tab", 0);
await sleep(40);
L = await layers();
check("움직임 줄이기 — 탭은 바뀌고 애니메이션 0 · 그려진 탭 하나",
  [(await activeIdx()) !== r0, Object.values(L).reduce((n, o) => n + o.anims, 0), shownTabs(L).length], [true, 0, 1]);
await send("Emulation.setEmulatedMedia", { features: [] });
await sleep(300);

check("끝까지 resize_session 호출 수 그대로", await resizeCalls(), resize0);
check("콘솔 예외 없음", errors, []);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
