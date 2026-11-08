// 헤드리스 검증 — **탭 상태 글리프**(2026-11-03 · `src/lib/tabbar/TabStatusGlyph.svelte` · `$lib/tab-dot` ·
// docs/log/2026-11-03-tab-status-glyphs.md). `agent-banner-harness.mjs` 의 스텁 사본 — 시나리오만 다르다.
//
// 탭 열하나를 세우고 탭마다 상태 하나를 만든다:
//   T0 (a) AI 실행 중 + 서브 에이전트 2 — 끝에 이 탭을 본다(활성 탭에도 에이전트 상태는 선다)
//   T1 (b) AI 권한 대기 · T2 (c) AI 완료(안 봄) · T3 (d) 명령 실패 · T4 (e) 벨(타일이 안 보일 때 — `bell(pane, false)`) ·
//   T5 (f) 명령 실행 중 · T6 (g) 명령 성공 · T7 (h) 활동 · T8 명령 실패 + 벨 → 실패가 이긴다 ·
//   T9 (i) 첫 타일 = 셸 · 둘째 타일 = AI(권한 대기) → 앞자리 아이콘이 그 AI 로고 → 상태가 걷히면 셸로 돌아온다 ·
//   T10 아무것도 없음.
// 보는 것: 탭마다 글리프 클래스 · `.belldot` 없음 · 벨 탭 말풍선 = 벨 문구 · 실패+벨 = 실패 · 아이콘 바꿔 끼우기.
//
// usage: node scripts/dev/run-harness.mjs tab-glyph-harness.mjs <outdir> --size 1400x500
//   → <outdir>/tab-glyph-dark.png · tab-glyph-light.png · tab-glyph-narrow.png · tab-glyph-overflow.png ·
//     tab-glyph-icon-swap-before.png · tab-glyph-icon-swap-after.png (탭 줄만 잘라 2배로 찍는다 · 넘침 목록은 창 위쪽 전체)
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
import { waitBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";
const [outDir = ".", port = process.env.CDP_PORT ?? "9247"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target0 = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target0.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
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
let failed = 0;
let passed = 0;
const check = (ok, label) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

/** 탭 줄(`.tabs`)만 잘라 찍는다 — `full` 이면 창 위쪽(넘침 목록이 탭 줄 아래로 내려온다) */
const shot = async (name, { full = false } = {}) => {
  const rect = JSON.parse(
    await ev(`JSON.stringify((() => { const b = document.querySelector('.tabs').getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })())`),
  );
  const clip = full
    ? { x: 0, y: 0, width: Math.ceil(rect.x + rect.w), height: Math.min(420, Math.ceil(rect.y + rect.h + 360)), scale: 2 }
    : { x: Math.max(0, rect.x - 4), y: Math.max(0, rect.y - 4), width: rect.w + 8, height: rect.h + 8, scale: 2 };
  const r = await send("Page.captureScreenshot", { format: "png", clip, captureBeyondViewport: false });
  const p = path.join(outDir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log("capture:", p);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  window.__focus = true; document.hasFocus = () => window.__focus;
  window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); }
    constructor() {} };
  window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, id: h, payload }));
  // 배너 · OS 알림은 이 판이 보는 것이 아니다 — 턴 끝 알림을 꺼 탭 줄만 남긴다
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false }, ai: { notify_turn_end: false, notify_permission: false } };
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {}, load_snippets: null, save_snippets: null, save_settings: null,
    host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null, close_session: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    list_ai_clis: [], operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    audit_status: { state: 'off', written: 0, failed: 0 }, mcp_activity: null, list_forwards: [],
    list_operations: { pending: [], recent: [] },
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
      if (cmd === 'load_settings') return Promise.resolve(window.__settings);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
const W = 1400;
const H = 500;
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);

const tabsMod = importApp("app/tabs.svelte.ts");
const sessionMod = importApp("lib/session.ts");
const bellMod = importApp("app/bell.svelte.ts");

// ── 준비: 탭 열하나 ────────────────────────────────────────────────────────
// 첫 탭은 부팅이 세운 빈 탭이다. 탭마다 첫 타일을 연다 — AI 는 `newAiPane('claude')`, 셸은 `newLocalPane()`.
const KINDS = ["ai", "ai", "ai", "sh", "sh", "sh", "sh", "sh", "sh", "sh+ai", "sh"];
const tabs = [];
for (let i = 0; i < KINDS.length; i++) {
  if (i > 0) await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessionMod}; w.openTab(s.newTab()); })()`);
  await sleep(150);
  const first = KINDS[i] === "ai" ? "s.newAiPane('claude')" : "s.newLocalPane()";
  await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessionMod}; w.openPaneHere(${first}); })()`);
  await sleep(250);
  if (KINDS[i] === "sh+ai") {
    await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessionMod}; w.openPaneHere(s.newAiPane('claude')); })()`);
    await sleep(250);
  }
  const info = JSON.parse(
    await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessionMod}; const t = w.activeTab(); const ps = s.listPanes(t.root); return JSON.stringify({ tab: t.id, panes: ps.map(p => ({ id: p.id, stream: p.historyStreamId ?? null, autorun: p.autorun ?? null })) }); })()`),
  );
  tabs.push(info);
}
await sleep(800);
check(tabs.length === 11 && tabs[9].panes.length === 2, `탭 열하나 · T9 는 타일 둘 (${tabs.map((t) => t.panes.length).join(",")})`);

const select = (i) => ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${tabs[i].tab}'); })()`);
const signal = async (i, event, { pane = 0, agent = null } = {}) => {
  const p = tabs[i].panes[pane];
  await ev(fakeAgentSignal(`{ stream: '${p.stream}', event: '${event}', detail: ${event === "waiting" ? "'permission'" : "null"}, agent: ${JSON.stringify(agent)}, at: Date.now() }`));
  await sleep(200);
};
const noteStatus = (i, status) => ev(`(async () => { const w = await ${tabsMod}; w.noteStatus('${tabs[i].tab}', '${tabs[i].panes[0].id}', '${status}'); })()`);

// 상태는 T0 를 보는 채로 만든다 — 안 본 결과(명령 · 벨 · 활동 · 완료)는 안 보는 탭에만 남는다
await select(0);
await sleep(300);
// (a) T0 실행 중 + 서브 에이전트 2 (stop 이 와도 서브가 돌면 실행 중)
await signal(0, "start");
await signal(0, "subagent-start", { agent: "agent_a1" });
await signal(0, "subagent-start", { agent: "agent_b2" });
await signal(0, "stop");
// (b) T1 권한 대기
await signal(1, "start");
await signal(1, "waiting");
// (c) T2 완료(안 봄)
await signal(2, "start");
await signal(2, "stop");
// (d) 실패 · (f) 실행 중 · (g) 성공
await noteStatus(3, "fail");
await noteStatus(5, "running");
await noteStatus(6, "ok");
// (e) 벨 — 앱의 `Terminal.svelte` 가 `t.onBell` 에서 부르는 그대로(타일이 안 보임)
await ev(`(async () => { const b = await ${bellMod}; b.bell('${tabs[4].panes[0].id}', false); })()`);
// (h) 활동
await ev(`(async () => { const w = await ${tabsMod}; w.markActivity('${tabs[7].tab}'); })()`);
// T8 실패 + 벨
await noteStatus(8, "fail");
await ev(`(async () => { const b = await ${bellMod}; b.bell('${tabs[8].panes[0].id}', false); })()`);
// (i) T9 둘째 타일(AI) 권한 대기
await signal(9, "start", { pane: 1 });
await signal(9, "waiting", { pane: 1 });
await sleep(600);

const glyphOf = (i) =>
  ev(`JSON.stringify((() => { const t = document.querySelector('.tab[data-tab="${tabs[i].tab}"]'); const g = t?.querySelector('.tab-glyph'); const n = t?.querySelector('[data-subagents]'); return { cls: g ? [...g.classList].filter(c => !c.startsWith('s-') && !c.startsWith('svelte-')).join(' ') : null, title: g?.getAttribute('title') ?? null, agentDot: g?.dataset.agentDot ?? null, n: n ? Number(n.dataset.subagents) : 0 }; })())`).then(JSON.parse);

const EXPECT = [
  "tab-glyph agent running",
  "tab-glyph agent permission",
  "tab-glyph agent finished",
  "tab-glyph command fail",
  "tab-glyph bell",
  "tab-glyph dot running",
  "tab-glyph dot ok",
  "tab-glyph dot activity",
  "tab-glyph command fail",
  "tab-glyph agent permission",
  null,
];
const glyphs = [];
for (let i = 0; i < tabs.length; i++) {
  const g = await glyphOf(i);
  glyphs.push(g);
  check(g.cls === EXPECT[i], `T${i} 글리프 = ${EXPECT[i]} (${g.cls} · ${g.title})`);
}
check(glyphs[0].n === 2 && glyphs[0].agentDot === "running", `T0 서브 에이전트 수 2 · data-agent-dot (${JSON.stringify(glyphs[0])})`);
check(glyphs[1].agentDot === "permission", "T1 data-agent-dot = permission (누르면 그 타일로)");
check((await ev(`document.querySelectorAll('.belldot').length`)) === 0, "옛 벨 고리(.belldot)가 없다");
check(glyphs[4].title === "벨이 울렸습니다", `벨 탭 말풍선 = 벨 문구 (${glyphs[4].title})`);
check(glyphs[8].cls === "tab-glyph command fail" && /벨이 울렸습니다/.test(glyphs[8].title ?? ""), `실패 + 벨 → 실패가 이기고 말풍선은 둘 다 (${glyphs[8].title})`);
check((await ev(`document.querySelectorAll('.tabs [data-sig]').length`)) === 0, "탭 줄에는 data-sig(후광 · 물결 · 숨 쉬기)가 없다");
check(
  // 칸(span)을 잰다 — 도는 진행 표시의 svg 는 회전한 상자라 12 보다 크게 잰다
  (await ev(`[...document.querySelectorAll('.tabs .tab-glyph:not(.dot)')].every(g => Math.round(g.getBoundingClientRect().width) === 12)`)) === true,
  "글리프 칸은 12px",
);

// 앞자리 아이콘 — T9 는 둘째 타일(Claude)의 로고, T3(셸만)은 셸 아이콘
const iconOf = (i) =>
  // 그림 지문 = viewBox + 경로들 — 그라디언트 id 는 인스턴스마다 달라 innerHTML 로는 같은 로고도 다르게 읽힌다
  ev(`(() => { const k = document.querySelector('.tab[data-tab="${tabs[i].tab}"] .kind svg'); return k ? (k.getAttribute('viewBox') ?? '') + '|' + [...k.querySelectorAll('path, circle, rect')].map(e => e.getAttribute('d') ?? e.outerHTML.replace(/\s(id|class|fill|stroke)="[^"]*"/g, '')).join('|') : null; })()`);
const iconT0 = await iconOf(0); // AI 타일 하나 = Claude 로고
const iconT3 = await iconOf(3); // 셸 하나
const iconT9 = await iconOf(9);
check(iconT0 !== iconT3, "AI 탭과 셸 탭의 아이콘이 다르다(비교 기준)");
check(iconT9 === iconT0, "T9 권한 대기 = 둘째 타일(Claude)의 로고");
await shot("tab-glyph-icon-swap-before.png");
await shot("tab-glyph-dark.png");

// 다크 → 라이트
await ev(`document.documentElement.dataset.theme = 'light'`);
await sleep(400);
await shot("tab-glyph-light.png");
await ev(`delete document.documentElement.dataset.theme`);
await sleep(300);

// (i) 상태가 걷히면 첫 타일로 — T9 를 보는 채로 stop(보고 있으니 완료가 남지 않는다) → T0 로 돌아온다
await select(9);
await sleep(300);
await signal(9, "stop", { pane: 1 });
await sleep(300);
await select(0);
await sleep(400);
const after = await glyphOf(9);
const iconT9b = await iconOf(9);
check(after.cls === null, `T9 에이전트 사실이 걷혔다 (${after.cls})`);
check(iconT9b === iconT3, "T9 아이콘이 첫 타일(셸)로 돌아왔다");
await shot("tab-glyph-icon-swap-after.png");

// 좁은 탭 — 창을 줄이면 탭이 아이콘 한 칸까지 준다(`@container (max-width: 63px)`) · 넘치면 `⌄N`
await send("Emulation.setDeviceMetricsOverride", { width: 640, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(900);
const narrow = JSON.parse(
  await ev(`JSON.stringify((() => { const tabs = [...document.querySelectorAll('.tab:not(.elided)')]; const w = tabs.map(t => Math.round(t.getBoundingClientRect().width)); const g = document.querySelector('.tab:not(.elided) .tab-glyph'); return { w, glyphPos: g ? getComputedStyle(g).position : null, titleShown: tabs.some(t => getComputedStyle(t.querySelector('.title') ?? t).display !== 'none' && t.querySelector('.title')), more: !!document.querySelector('[data-tabs-more]') }; })())`),
);
check(narrow.w.length > 0 && narrow.w.every((x) => x < 64), `좁은 탭 폭 < 64 (${narrow.w.join(",")})`);
check(narrow.glyphPos === "absolute", `좁은 탭의 글리프는 모서리로 (${narrow.glyphPos})`);
await shot("tab-glyph-narrow.png");

// 넘침 목록 — 더 줄여 아이콘 칸(36px)으로도 모자라게 한다
await send("Emulation.setDeviceMetricsOverride", { width: 460, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(900);
narrow.more = (await ev(`!!document.querySelector('[data-tabs-more]')`)) === true;
check(narrow.more, "넘친 탭이 있어 ⌄N 단추가 선다");
await ev(`document.querySelector('[data-tabs-more]')?.click()`);
await sleep(500);
const menu = JSON.parse(
  await ev(`JSON.stringify([...document.querySelectorAll('[data-tabs-more-option]')].map(r => { const g = r.querySelector('.tab-glyph'); return g ? [...g.classList].filter(c => !c.startsWith('s-') && !c.startsWith('svelte-')).join(' ') : null; }))`),
);
check(menu.length > 0 && menu.some((c) => c !== null), `넘침 목록 줄에도 같은 글리프 (${menu.join(" | ")})`);
check((await ev(`document.querySelectorAll('[data-tabs-more-menu] .belldot').length`)) === 0, "넘침 목록에도 벨 고리가 없다");
await shot("tab-glyph-overflow.png", { full: true });
await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);

console.log(`${passed} PASS · ${failed} FAIL`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
