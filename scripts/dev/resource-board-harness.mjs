// Headless harness: **자원 화면**(`console/ResourceBoard.svelte` · 차트 `console/ResourceChart.svelte` — 2026-10-27 A안).
// `branch-graph-harness.mjs` 스텁의 사본 — 표와 시나리오만 다르다.
//
//   node scripts/dev/run-harness.mjs resource-board-harness.mjs <outdir> --size 1400x900
//
// 심어 두는 것: `resource_snapshot` 이 지난 10분 표본(2초 간격 · 이 PC 전체 32GB 중 18GB 안팎 · 타일 넷 — 하나는 메모리가 늘어남).
// 보는 것: ① 차트 둘 다 선 셋(이 PC 전체 · 타일 합계 · 앱) ② 맨 위 칸 셋의 색 표시 · 범례 줄 없음 · 띠에 설명 글 없음
// ③ 표 — 머리 줄 · 타일 묶음이 앱 묶음보다 위 · 줄마다 추이 선 ⑤ 예외 0. 축 글자는 uPlot 이 캔버스에 그려 DOM 으로 못 읽는다 — PNG 로 본다.
// 표본은 **부팅이 끝난 뒤에만** 준다(`__resOn`) — 부팅 중에 표본이 하나라도 오면 이 스텁에서는 페이지가 멈춘다(10-27 · 이번 변경
// 전 코드도 같음 · 원인 미확인 — 실제 앱에서 재현된 적은 없다).
// PNG: `resources-dark.png` · `resources-light.png`.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9401";
const pagePort = process.env.PAGE_PORT ?? "1591";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"); if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + (d.params.args?.[0]?.value ?? d.params.args?.[0]?.description ?? "?")); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await Promise.race([send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }), sleep(15000).then(() => ({ result: { exceptionDetails: { exception: { description: "TIMEOUT " + e.slice(0, 60) } } } }))]); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
await send("Page.enable"); await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = [];
  window.__listeners = {};
  const MB = 1024 * 1024, GB = 1024 * MB;
  const now = Date.now();
  const samples = [];
  for (let i = 0; i < 300; i++) {
    const at = now - (299 - i) * 2000;
    const w = Math.sin(i / 9);
    samples.push({
      at,
      gui: { cpu: 2 + w, mem: 1.1 * GB },
      server: { cpu: 0.5, mem: 190 * MB },
      tiles: {
        s1: { cpu: 12 + 6 * w, mem: (1.0 + 0.6 * i / 299) * GB },
        s2: { cpu: 7 + 2 * Math.cos(i / 5), mem: 980 * MB },
        s3: { cpu: 3, mem: (160 + 10 * w) * MB },
        ...(i > 150 ? { s4: { cpu: 1, mem: 120 * MB } } : {}),
      },
      system: { cpu: 35 + 10 * w, memUsed: (17.5 + 0.8 * w) * GB, memTotal: 31.8 * GB },
    });
  }
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [], load_snippets: null, save_snippets: null,
    load_settings: { projects: { start_screen: 'off' } }, save_settings: null,
    host_history_list: {}, projects_list: [],
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    resource_snapshot: () => !window.__resOn ? { intervalMs: 2000, keepMs: 30 * 60 * 1000, samples: [], top: { gui: [], server: [], tiles: {} } } : ({
      intervalMs: 2000, keepMs: 30 * 60 * 1000, samples,
      top: { gui: [{ name: 'msedgewebview2.exe', cpu: 2.1, mem: 760 * MB }], server: [{ name: 'aynx.exe', cpu: 0, mem: 190 * MB }],
        tiles: { s1: [{ name: 'node.exe', cpu: 13, mem: 1.4 * GB }], s2: [{ name: 'claude.exe', cpu: 7.9, mem: 900 * MB }] } },
    }),
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (!(cmd in answers)) return Promise.reject(new Error('stub: ' + cmd));
      const a = answers[cmd];
      return Promise.resolve(typeof a === 'function' ? a(args ?? {}) : a);
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
for (let i = 0; i < 60 && !(await ev(`performance.getEntriesByType('resource').some((r) => r.name.includes('app/tabs.svelte.ts')) && !!document.querySelector('[data-tile-canvas]')`)); i++) await sleep(250);
await sleep(800);
errors.length = 0; // 스텁을 심기 전 첫 적재의 잡음은 세지 않는다

await ev(`window.__resOn = true`);
await ev(`import('/src/lib/app/usage-view.svelte.ts').then((m) => { m.openResourceView(); return 'ok'; })`);
await sleep(120);
// 열 때 덩어리(띠 · 차트 카드 둘 · 지금 표)가 시차를 두고 떠오른다 — CoverPanel 의 playOpen
const rising = await ev(`[...document.querySelectorAll('[data-resource-board] > :not(.charts), [data-resource-board] > .charts > *')].map((el) => el.getAnimations().length > 0)`);
check(rising.length >= 4 && rising.every(Boolean), `여는 움직임 — 덩어리마다 (${JSON.stringify(rising)})`);
for (let i = 0; i < 40 && !(await ev(`document.querySelectorAll('[data-resource-board] .u-wrap').length === 2`)); i++) await sleep(250);
await sleep(1500);

// ── ① 차트 선 셋 · 말풍선 ────────────────────────────────────────────────────
const NAMES = ["이 PC 전체", "앱 (화면 · 세션 서버)", "로컬 타일 4개"];
// 말풍선 — 차트 가운데에 마우스를 올리면 이름 넷이 같은 차례로
const tip = await ev(`(() => {
  const over = document.querySelector('[data-resource-board] .u-over');
  const r = over.getBoundingClientRect();
  over.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, bubbles: true }));
  return [...document.querySelectorAll('[data-resource-board] .r-chart-tip-name')].map((n) => n.textContent.trim());
})()`);
check(JSON.stringify(tip) === JSON.stringify(NAMES), `말풍선 이름 차례 (${JSON.stringify(tip)})`);
// 커서 점은 커서가 선 위에 있을 때만 보인다 — 말풍선을 띄운 첫 차트에서 센다
const shown = await ev(`[...document.querySelector('[data-resource-board] .u-wrap').querySelectorAll('.u-cursor-pt')].filter((p) => getComputedStyle(p).display !== 'none').length`);
check(shown === 3, `보이는 선 셋 (${shown})`);
check((await ev(`document.querySelectorAll('[data-resource-board] .u-wrap').length`)) === 2, "차트 둘");
// ── ② 맨 위 칸 · 범례 · 설명 ────────────────────────────────────────────────
const cells = await ev(`[...document.querySelectorAll('[data-resource-board] .strip .cell .k')].map((k) => k.textContent.trim())`);
check(JSON.stringify(cells) === JSON.stringify(NAMES), `칸 차례 = 차트 차례 (${JSON.stringify(cells)})`);
check((await ev(`document.querySelectorAll('[data-resource-board] .strip .mark').length`)) === 3, "칸마다 색 표시");
check((await ev(`document.querySelectorAll('[data-resource-board] .legend').length`)) === 0, "차트 아래 범례 줄 없음");
check((await ev(`document.querySelectorAll('[data-resource-board] .strip > :not(.cell)').length`)) === 0, "띠에는 칸뿐(설명 글 · ⓘ 없음)");
// ── ③ 표 ─────────────────────────────────────────────────────────────────
const groups = await ev(`[...document.querySelectorAll('[data-resource-board] .group')].map((g) => g.textContent.trim())`);
check(JSON.stringify(groups) === JSON.stringify([NAMES[1], NAMES[2]]), `앱 묶음이 위 · 타일 묶음이 아래 (${JSON.stringify(groups)})`);
check((await ev(`!!document.querySelector('[data-resource-board] .row.head')`)) === true, "머리 줄");
const sparks = await ev(`[...document.querySelectorAll('[data-resource-board] .row:not(.head) .spark path')].map((p) => (p.getAttribute('d') ?? '').length > 0)`);
check(sparks.length === 6 && sparks.every(Boolean), `줄 여섯 모두 추이 선 (${JSON.stringify(sparks)})`);
console.log("capture:", await shot("resources-dark.png"));
await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(600);
console.log("capture:", await shot("resources-light.png"));
await ev(`delete document.documentElement.dataset.theme`); await sleep(200);

// ── ⑤ 예외 ─────────────────────────────────────────────────────────────────
check(errors.length === 0, `예외 0 (${errors.slice(0, 3).join(" / ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAIL`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
