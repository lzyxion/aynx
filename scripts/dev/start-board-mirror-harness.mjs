// 헤드리스 검증 — **원격 창의 시작 화면이 집 PC 한 벌을 따른다**(2026-11-04 · docs/log/2026-11-04-start-board-mirror.md).
//
// 원격 창 흉내(`__AYNX_REMOTE__`) — 탭 · 배치는 스텁 `mirror_get` · 이벤트 `mirror-layout` 으로 진짜 받기 길을 지난다. 끝에 집 PC 창 흉내로 올리기(`mirror_publish`)를 본다.
//
//   node scripts/dev/run-harness.mjs start-board-mirror-harness.mjs <outdir> --size 1280x860
//     → <outdir>/board-phone.png · board-wide.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";

const [outdir = "out", port = process.env.CDP_PORT ?? "9277"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1444";
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${PAGE_PORT}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
    return;
  }
  if (d.method === "Runtime.exceptionThrown") {
    const x = d.params.exceptionDetails;
    const s = (x.exception?.description ?? x.text ?? "").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("EXC " + s);
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
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) {
    const p = path.join(outdir, name);
    fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
    console.log("PNG " + path.resolve(p));
  }
};
let bad = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded: ${file}'); return await import(e); })()`;

const CLOCK = { hour12: true, seconds: false, date: false, size: 72 };
/** 집 PC 배치 — 시계 없음 + 프로젝트가 호스트 왼쪽(기본 배치와 다르다). 폭이 넓어 폰에서는 좁은 판(쌓기)이 된다 */
const BOARD_A = {
  widgets: [
    { kind: "projects", x: -520, y: -200, w: 320, h: 160 },
    { kind: "hosts", x: 200, y: -200, w: 320, h: 160 },
    { kind: "shells", x: -160, y: 152, w: 320, h: 120 },
  ],
  clock: CLOCK,
};
const BOARD_B = {
  widgets: [
    { kind: "shells", x: -160, y: -60, w: 320, h: 120 },
    { kind: "hosts", x: -160, y: 76, w: 320, h: 120 },
  ],
  clock: CLOCK,
};
const snapshot = (startBoard) => ({
  v: 2,
  source: "home",
  workspace: { id: "default", name: "기본" },
  workspaces: [{ id: "default", name: "기본", activeTabId: "h-tab" }],
  activeTabId: "h-tab",
  tabs: [
    {
      id: "h-tab",
      workspaceId: "default",
      tabKey: "k-tab",
      title: "새 탭",
      root: { type: "leaf", pane: { id: "h-start", kind: "start", tileKey: "k-start" } },
      focus: "h-start",
    },
  ],
  ...(startBoard === undefined ? {} : { startBoard }),
});

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const home = sessionStorage.getItem('h.home') === '1';
  if (!home) window.__AYNX_REMOTE__ = true;
  const label = home ? 'main' : 'remote-h-1';
  const cbs = new Map(); let n = 0; window.__calls = [];
  const evts = new Map();
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    list_ai_clis: [], list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [],
    agent_states_snapshot: [], mirror_publish: null, mirror_request: null, mirror_request_inbox: null, theme_profiles_edit: '{}',
  };
  window.__emit = (name, payload) => { for (const h of evts.get(name) ?? []) cbs.get(h)?.({ event: name, id: 0, payload }); };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'load_settings') return Promise.resolve({ app: { status_bar: 'bottom' }, automation: { auto_approve: false } });
      if (cmd === 'mirror_get') return Promise.resolve(JSON.parse(sessionStorage.getItem('h.mirror') ?? 'null'));
      if (cmd === 'load_theme_profiles') return Promise.resolve(sessionStorage.getItem('h.profiles'));
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') { evts.set(args.event, (evts.get(args.event) ?? []).filter((x) => x !== args.eventId)); return Promise.resolve(); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});

const W = importApp("start-widgets.svelte.ts");
const P = importApp("theme-profiles.svelte.ts");

const boot = async (width, height, mobile) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile });
  await send("Page.reload", { ignoreCache: true });
  const ok = await waitFor(`!!document.querySelector('[data-launcher]')`, 25000);
  await sleep(800);
  return ok;
};
const setMirror = (v) => ev(`sessionStorage.setItem('h.mirror', ${JSON.stringify(JSON.stringify(v))})`);
const emitLayout = async (v) => {
  await ev(`window.__emit('mirror-layout', ${JSON.stringify(v)})`);
  await sleep(350);
};
/** 그려진 위젯 — 위에서 아래 순서 */
const order = () =>
  ev(
    `JSON.stringify([...document.querySelectorAll('[data-start-widget]')].map((e) => [e.dataset.startWidget, e.getBoundingClientRect().top]).sort((a, b) => a[1] - b[1]).map((x) => x[0]))`,
  ).then(JSON.parse);
const shown = () => ev(`JSON.stringify([...document.querySelectorAll('[data-start-widget]')].map((e) => e.dataset.startWidget).sort())`).then(JSON.parse);
const stored = () => ev(`localStorage.getItem('aynx:start-widgets')`);
const rightClick = (selector) =>
  ev(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    const r = el.getBoundingClientRect();
    const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: r.left + 4, clientY: r.top + 4 });
    el.dispatchEvent(e);
    return e.defaultPrevented;
  })()`);
const noEditUi = () =>
  ev(
    `JSON.stringify({ menu: document.querySelectorAll('[role="menu"]').length, editing: !!document.querySelector('[data-start-editing]'), bar: !!document.querySelector('[data-start-edit-bar]'), remove: document.querySelectorAll('[data-widget-remove]').length, resize: document.querySelectorAll('[data-widget-resize]').length, grip: document.querySelectorAll('[data-widget-grip]').length })`,
  ).then(JSON.parse);
const NO_EDIT = { menu: 0, editing: false, bar: false, remove: 0, resize: 0, grip: 0 };

// ── ① 폰 — 거울로 온 한 벌 ──────────────────────────────────────────────
await ev(`(() => { sessionStorage.removeItem('h.home'); sessionStorage.removeItem('h.profiles'); localStorage.removeItem('aynx:start-widgets'); localStorage.removeItem('aynx:start-clock'); })()`);
await setMirror(snapshot(BOARD_A));
check("① 폰 시작 화면이 선다", await boot(400, 844, true), true);
check("① 쌓기 순서 = 집 PC 읽는 순서", await order(), ["projects", "hosts", "shells"]);
check("① 시계 없음 = 집 PC 와 같음", (await shown()).includes("clock"), false);
check("① 좁은 판", await ev(`!!document.querySelector('[data-start-narrow]')`), true);
check("① 이 브라우저에도 남음", JSON.parse(await stored()).widgets.map((w) => w.kind), ["projects", "hosts", "shells"]);
await shot("board-phone.png");

// ── ② 편집 없음 ─────────────────────────────────────────────────────────
check("② 평소 편집 요소 없음", await noEditUi(), NO_EDIT);
check("② 위젯 우클릭 = 메뉴 없음", await rightClick('[data-start-widget="hosts"]'), true);
await sleep(200);
check("② 위젯 우클릭 뒤", await noEditUi(), NO_EDIT);
check("② 빈 자리 우클릭 = 메뉴 없음", await rightClick("[data-launcher]"), true);
await sleep(200);
check("② 빈 자리 우클릭 뒤", await noEditUi(), NO_EDIT);
check("② 편집 판정", await ev(`(async () => (await ${W}).startBoardEditable())()`), false);

// ── ③ 집 PC 변경 · 망가진 값 · 칸 없음 ─────────────────────────────────────
await emitLayout(snapshot(BOARD_B));
check("③ 집 PC 변경이 곧바로 반영", await order(), ["shells", "hosts"]);
await emitLayout(snapshot({ widgets: [{ kind: "nope", x: 0, y: 0, w: 1, h: 1 }], clock: CLOCK }));
check("③ 망가진 값은 무시", await order(), ["shells", "hosts"]);
await emitLayout(snapshot(undefined));
check("③ 칸이 없으면 마지막 값 그대로", await order(), ["shells", "hosts"]);

// ── ④ 프로필 — 원격은 스스로 입히지 않는다 ───────────────────────────────
const profileFile = JSON.stringify({
  version: 1,
  active: "p1",
  profiles: [{ id: "p1", name: "한 벌", savedAt: 1, appearance: {}, startBoard: { widgets: [{ kind: "clock", x: -100, y: -60, w: 200, h: 120 }], clock: CLOCK } }],
});
await ev(`sessionStorage.setItem('h.profiles', ${JSON.stringify(profileFile)})`);
await ev(`(async () => { const p = await ${P}; await p.loadThemeProfiles(); })()`);
await ev(`window.__emit('theme-profiles-changed', null)`);
await sleep(500);
check("④ 원격이 프로필 배치를 스스로 입히지 않음", await order(), ["shells", "hosts"]);
await ev(`sessionStorage.removeItem('h.profiles')`);

// ── ⑤ 다시 읽어도 — 집 PC 창이 없으면 마지막 값 ─────────────────────────────
await setMirror(null);
await send("Page.reload", { ignoreCache: true });
await waitFor(`performance.getEntriesByType('resource').some(r => r.name.includes('start-widgets.svelte.ts'))`, 25000);
await sleep(1500);
check("⑤ 집 PC 창 없음 = 마지막으로 받은 값", await ev(`(async () => JSON.stringify((await ${W}).startWidgets().map((w) => w.kind)))()`), JSON.stringify(["shells", "hosts"]));

// ── ⑥ 넓은 원격 창 — 집 PC 좌표 ────────────────────────────────────────────
await setMirror(snapshot(BOARD_A));
check("⑥ 넓은 창이 선다", await boot(1280, 860, false), true);
check("⑥ 좁은 판 아님", await ev(`!!document.querySelector('[data-start-narrow]')`), false);
check("⑥ 위젯 셋", await shown(), ["hosts", "projects", "shells"]);
const stage = JSON.parse(
  await ev(
    `(() => { const r = document.querySelector('[data-launcher]').getBoundingClientRect(); const o = {}; for (const e of document.querySelectorAll('[data-start-widget]')) { const b = e.getBoundingClientRect(); o[e.dataset.startWidget] = [Math.round(b.left - (r.left + r.width / 2)), Math.round(b.top - (r.top + r.height / 2))]; } return JSON.stringify({ o, scale: document.querySelector('.stage').dataset.startScale }); })()`,
  ),
);
check("⑥ 집 PC 좌표(판 가운데 기준 · 배율 1)", [stage.scale, stage.o.projects[0], stage.o.projects[1]], ["1", -520, -200]);
check("⑥ 편집 요소 없음", await noEditUi(), NO_EDIT);
await rightClick('[data-start-widget="hosts"]');
await sleep(200);
check("⑥ 우클릭 뒤", await noEditUi(), NO_EDIT);
await shot("board-wide.png");

// ── ⑦ 줄 고르기 — 셸 줄을 누르면 연다 ─────────────────────────────────────
await ev(`window.__calls.length = 0`);
const row = '[data-start-widget="shells"] [data-launch-key]';
check("⑦ 셸 줄이 있다", await waitFor(`!!document.querySelector(${JSON.stringify(row)})`), true);
await ev(`document.querySelector(${JSON.stringify(row)}).click()`);
await sleep(600);
check("⑦ 줄을 누르면 여는 길로 간다", await ev(`window.__calls.some(([c]) => c === 'mirror_request')`), true);

// ── ⑧ 집 PC 주 창 — 올리기 · 같은 값은 안 보냄 · 편집은 그대로 ──────────────
await ev(`(() => { sessionStorage.setItem('h.home', '1'); localStorage.removeItem('aynx:start-widgets'); localStorage.removeItem('aynx:start-clock'); })()`);
check("⑧ 집 PC 창이 선다", await boot(1280, 860, false), true);
const publishes = () => ev(`JSON.stringify(window.__calls.filter(([c]) => c === 'mirror_publish').map(([, a]) => a.snapshot.startBoard ?? null))`).then(JSON.parse);
check("⑧ 올리기에 한 벌이 실림", await waitFor(`window.__calls.some(([c, a]) => c === 'mirror_publish' && !!a.snapshot.startBoard)`), true);
await sleep(500);
const before = (await publishes()).length;
await sleep(700);
check("⑧ 안 바뀌면 다시 안 보냄", (await publishes()).length, before);
await ev(`(async () => { const w = await ${W}; w.setClockOptions({ ...w.clockOptions(), hour12: !w.clockOptions().hour12 }); })()`);
check("⑧ 시계 표시 변경이 재발행", await waitFor(`window.__calls.filter(([c]) => c === 'mirror_publish').length > ${before}`), true);
await sleep(600);
const n2 = (await publishes()).length;
await ev(`(async () => { const w = await ${W}; w.setStartWidgets(w.startWidgets().filter((x) => x.kind !== 'shells')); })()`);
check("⑧ 배치 변경이 재발행", await waitFor(`window.__calls.filter(([c]) => c === 'mirror_publish').length > ${n2}`), true);
const lastBoard = (await publishes()).at(-1);
check("⑧ 실린 칸 = 배치 · 시계만", Object.keys(lastBoard).sort(), ["clock", "widgets"]);
check("⑧ 빼낸 위젯이 반영", lastBoard.widgets.some((w) => w.kind === "shells"), false);
check("⑧ 집 PC 는 편집 가능", await ev(`(async () => (await ${W}).startBoardEditable())()`), true);
await rightClick('[data-start-widget="hosts"]');
await sleep(200);
check("⑧ 집 PC 위젯 우클릭 = 메뉴", await ev(`document.querySelectorAll('[role="menu"]').length > 0`), true);
await ev(`(() => { sessionStorage.removeItem('h.home'); localStorage.removeItem('aynx:start-widgets'); localStorage.removeItem('aynx:start-clock'); })()`);

check("⑨ 예외 0", errors, []);
console.log(`${bad === 0 ? "ok" : "FAIL"} — 실패 ${bad}`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
