// Headless harness: **닫히는 타일의 유령**(`pane/tile-ghost.ts` — 등장 `tileIn` 의 거울). `tile-enter-harness.mjs` 의 스텁 사본.
//
//   node scripts/dev/run-harness.mjs tile-close-harness.mjs <outdir>
//
// 보는 것: ① 타일 닫기(`Ctrl+Shift+Q`) — 진짜 상자는 곧바로 DOM 에서 빠지고(세션 닫기도 곧바로) `.tile-ghosts` 에 유령
// 하나가 서서 ~150ms 에 줄며 사라진다 · 옆 타일은 ~100ms 까지 제자리, ~350ms 에 목적지(차례 닫기) · 유령에는 id · data-* 가
// 없고 inert ①-b 연타의 둘째 닫기는 유령 없이 곧바로 미끄러진다 ①-c 분할도 차례로(옆 타일 곧바로 · 새 타일 ~120ms 뒤 · 포커스 곧바로) ①-d 연타 분할은 지연 없음 ② 탭 닫기 · 마지막 타일 닫기(= 탭 닫기)에는
// 유령이 없다 ③ 닫은 직후 탭을 바꾸면 유령은 곧바로 걷힌다 · 슬라이드 도중의 닫기에는 유령이 없다.
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

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  // 유령 층의 들고 남 · 진짜 상자가 빠지는 시각
  window.__log = [];
  new MutationObserver((muts) => {
    for (const m of muts) {
      const ghostLayer = m.target instanceof HTMLElement && m.target.classList.contains('tile-ghosts');
      for (const node of m.addedNodes) if (ghostLayer) window.__log.push({ k: 'ghost+', at: performance.now() });
      for (const node of m.removedNodes) {
        if (ghostLayer) window.__log.push({ k: 'ghost-', at: performance.now() });
        else if (node instanceof HTMLElement && node.classList.contains('pane-box')) window.__log.push({ k: 'box-', pane: node.dataset.pane, at: performance.now() });
      }
    }
  }).observe(document, { childList: true, subtree: true });
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    get_host_meta: null, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    load_snippets: null, save_snippets: null,
    load_settings: {}, save_settings: null,
    host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    reap_window_sessions: null, vault_status: 'none', vault_list: [],
    mcp_status: { clis: [] },
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args, performance.now()]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);

const KEYS = { KeyN: 78, KeyD: 68, KeyQ: 81, KeyT: 84, KeyW: 87, Tab: 9 };
const key = async (code, modifiers, k) => { const vk = KEYS[code]; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
const CS = 10; // Ctrl+Shift
const boxes = () => ev(`[...document.querySelectorAll('.host > .pane-box:not(.hidden)')].map(b => b.dataset.pane)`);
const ghosts = () => ev(`document.querySelector('.tile-ghosts')?.children.length ?? -1`);
const logSince = (i) => ev(`JSON.parse(JSON.stringify(window.__log.slice(${i})))`);
const mark = () => ev(`window.__log.length`);

// 준비: 시작 타일이 설 때까지 기다린 뒤(차가운 vite) 터미널 타일 둘
for (let i = 0; i < 40 && (await boxes()).length !== 1; i++) await sleep(500);
await sleep(2000);
await key("KeyN", CS, "N"); await sleep(800);
await key("KeyD", CS, "D"); await sleep(600);
check((await boxes()).length === 2, `타일 둘 (${JSON.stringify(await boxes())})`);

// 페이지 안 표본기 — 다음 Ctrl 키다운을 0 으로 잡고 정한 시각마다 보이는 상자 사각형 · 유령 수를 적는다(CDP 왕복 지연 없이)
const arm = (times) => ev(`(() => { const out = window.__samples = []; addEventListener('keydown', (e) => { if (!e.ctrlKey) return; const t0 = performance.now(); for (const t of ${JSON.stringify(times)}) setTimeout(() => out.push({ t: Math.round(performance.now() - t0), boxes: Object.fromEntries([...document.querySelectorAll('.host > .pane-box:not(.hidden)')].map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.pane, [Math.round(r.left), Math.round(r.width), Math.round(r.top), Math.round(r.height)]]; })), ghosts: document.querySelector('.tile-ghosts')?.children.length ?? -1 }), t); }, { capture: true, once: true }); return true; })()`);
const samples = () => ev(`JSON.parse(JSON.stringify(window.__samples))`);
const rects = () => ev(`Object.fromEntries([...document.querySelectorAll('.host > .pane-box:not(.hidden)')].map((b) => { const r = b.getBoundingClientRect(); return [b.dataset.pane, [Math.round(r.left), Math.round(r.width), Math.round(r.top), Math.round(r.height)]]; }))`);
const same = (a, b) => !!a && !!b && a.every((v, i) => Math.abs(v - b[i]) <= 1);

// ── ① 타일 닫기 — 차례로: 유령 먼저(~150ms), 옆 타일은 ~120ms 뒤에 200ms ─────────────
const [keep, gone] = await boxes();
const pre = await rects();
let m0 = await mark();
const callMark = await ev(`window.__calls.length`);
const t0 = await ev(`performance.now()`);
await arm([40, 100, 350, 600]);
await key("KeyQ", CS, "Q");
await sleep(30);
const mid = await ev(`(() => {
  const g = document.querySelector('.tile-ghosts')?.firstElementChild;
  if (!g) return null;
  const all = [g, ...g.querySelectorAll('*')];
  const bad = all.filter((e) => e.id || e.getAttributeNames().some((a) => a.startsWith('data-'))).length;
  const cs = getComputedStyle(g);
  return { opacity: +cs.opacity, inert: g.inert, hidden: g.getAttribute('aria-hidden'), bad, pe: cs.pointerEvents };
})()`);
console.log("capture:", await shot("tile-close-mid.png"));
check(!!mid, "닫은 직후 유령이 하나 섰다");
check(!!mid && mid.bad === 0, `유령에 id · data-* 가 없다 (${mid?.bad})`);
check(!!mid && mid.inert === true && mid.hidden === "true" && mid.pe === "none", "유령은 inert · aria-hidden · pointer-events:none");
check((await ev(`document.querySelectorAll('[data-pane]').length`)) === (await ev(`document.querySelectorAll('.host > .pane-box').length`)), "data-pane 을 가진 것은 진짜 상자뿐");
await sleep(700);
const s1 = await samples();
console.log("samples:", JSON.stringify(s1.map((x) => ({ t: x.t, g: x.ghosts, keep: x.boxes[keep] }))), "pre:", JSON.stringify(pre[keep]));
const at = (arr, i) => arr[i]?.boxes?.[keep];
check(same(at(s1, 0), pre[keep]) && same(at(s1, 1), pre[keep]), `옆 타일은 ~100ms 까지 제자리 (${JSON.stringify(at(s1, 1))} = ${JSON.stringify(pre[keep])})`);
check(s1[1]?.ghosts === 1, "~100ms 에는 유령이 아직 있다");
check(same(at(s1, 2), at(s1, 3)) && !same(at(s1, 3), pre[keep]), `~350ms 에 옆 타일은 목적지 (${JSON.stringify(at(s1, 2))} = ${JSON.stringify(at(s1, 3))})`);
const log1 = await logSince(m0);
console.log("log:", JSON.stringify(log1.map((e) => ({ ...e, at: Math.round(e.at - t0) }))));
const boxGone = log1.find((e) => e.k === "box-");
const gAdd = log1.find((e) => e.k === "ghost+");
const gDel = log1.find((e) => e.k === "ghost-");
check(!!boxGone && boxGone.pane === gone && boxGone.at - t0 < 80, `진짜 상자는 곧바로 빠졌다 (${boxGone ? Math.round(boxGone.at - t0) : "?"}ms)`);
const drop = await ev(`window.__calls.slice(${callMark}).filter(c => c[0] === 'drop_session' || c[0].includes('close')).map(c => [c[0], Math.round(c[2] - ${t0})])`);
console.log("session calls:", JSON.stringify(drop));
check(Array.isArray(drop) && drop.length > 0 && drop[0][1] < 80, `세션 닫기도 곧바로 (${JSON.stringify(drop)})`);
check(!!gAdd && !!gDel && gDel.at - gAdd.at >= 130 && gDel.at - gAdd.at < 260, `유령은 ~150ms 뒤 사라졌다 (${gAdd && gDel ? Math.round(gDel.at - gAdd.at) : "?"}ms)`);
check((await ghosts()) === 0, "끝나면 유령 층이 비었다");
check((await boxes()).length === 1, "타일 하나가 남았다");
check((await ev(`getComputedStyle(document.querySelector('.host')).getPropertyValue('--close-delay').trim()`)) === "0ms", "끝나면 지연이 걷혔다 (--close-delay 0ms)");

// ── ①-b 연타 — 차례 도중의 둘째 닫기는 유령 없이 곧바로 미끄러진다 ───────────────────
await key("KeyD", CS, "D"); await sleep(600);
await key("KeyD", CS, "D"); await sleep(700);
check((await boxes()).length === 3, `타일 셋 (${JSON.stringify(await boxes())})`);
m0 = await mark();
await key("KeyQ", CS, "Q");
await sleep(40);
const preSecond = await rects();
await arm([70, 500]);
await key("KeyQ", CS, "Q");
await sleep(650);
const s2 = await samples();
const survivor = (await boxes())[0];
console.log("rapid:", JSON.stringify({ preSecond: preSecond[survivor], s: s2.map((x) => ({ t: x.t, g: x.ghosts, b: x.boxes[survivor] })) }));
const ghosts2 = (await logSince(m0)).filter((e) => e.k === "ghost+").length;
check(ghosts2 === 1, `연타의 둘째 닫기는 새 유령을 만들지 않는다 (유령 ${ghosts2})`);
check(!same(s2[0]?.boxes?.[survivor], preSecond[survivor]), `둘째 닫기 ~70ms 에 남은 타일이 이미 움직인다 — 지연 없음 (${JSON.stringify(s2[0]?.boxes?.[survivor])} ≠ ${JSON.stringify(preSecond[survivor])})`);
check((await boxes()).length === 1 && (await ghosts()) === 0, "연타 뒤 타일 하나 · 유령 없음");

// ── ①-c 분할도 차례로 — 옆 타일은 곧바로 미끄러지고 새 타일은 ~120ms 뒤에 커진다 · 포커스는 곧바로 새 타일 ─────────
// 표본: 보이는 상자마다 [left, width, opacity, scale] + 포커스가 든 상자
const armOpen = (times) => ev(`(() => { const out = window.__samples = []; addEventListener('keydown', (e) => { if (!e.ctrlKey) return; const t0 = performance.now(); for (const t of ${JSON.stringify(times)}) setTimeout(() => out.push({ t: Math.round(performance.now() - t0), boxes: Object.fromEntries([...document.querySelectorAll('.host > .pane-box:not(.hidden)')].map((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); const m = cs.transform.match(/matrix\\(([^,]+)/); return [b.dataset.pane, [Math.round(r.left), Math.round(b.offsetWidth), +(+cs.opacity).toFixed(3), m ? +(+m[1]).toFixed(3) : 1]]; })), focus: document.activeElement?.closest('.pane-box')?.dataset.pane ?? null }), t); }, { capture: true, once: true }); return true; })()`);
const preSplit = await rects();
const only = Object.keys(preSplit)[0];
await armOpen([60, 350, 600]);
await key("KeyD", CS, "D");
await sleep(700);
const s3 = await samples();
const fresh = Object.keys(s3.at(-1)?.boxes ?? {}).find((id) => id !== only);
console.log("split:", JSON.stringify({ pre: preSplit[only], fresh, s: s3.map((x) => ({ t: x.t, old: x.boxes[only], fresh: x.boxes[fresh], focus: x.focus })) }));
check(s3[0]?.boxes?.[only]?.[1] !== preSplit[only][1], `분할 ~60ms 에 기존 타일이 이미 움직인다 (${s3[0]?.boxes?.[only]?.[1]} ≠ ${preSplit[only][1]})`);
check((s3[0]?.boxes?.[fresh]?.[2] ?? 1) < 0.05, `~60ms 에 새 타일은 아직 투명 (opacity=${s3[0]?.boxes?.[fresh]?.[2]})`);
check(s3[0]?.focus === fresh, `포커스는 곧바로 새 타일 (${s3[0]?.focus})`);
// 120 + 220 = 340ms 에 끝난다 — 표본 시각은 프레임 경계라 ~350ms 는 거의 끝(≥ 0.98), ~600ms 는 정확히 1
check((s3[1]?.boxes?.[fresh]?.[2] ?? 0) >= 0.98 && (s3[1]?.boxes?.[fresh]?.[3] ?? 0) >= 0.99, `~350ms 에 새 타일이 거의 다 섰다 (${JSON.stringify(s3[1]?.boxes?.[fresh])})`);
check(s3[2]?.boxes?.[fresh]?.[2] === 1 && s3[2]?.boxes?.[fresh]?.[3] === 1, `~600ms 에 새 타일 opacity 1 · scale 1 (${JSON.stringify(s3[2]?.boxes?.[fresh])})`);

// ── ①-d 연타 분할 — 앞 등장이 도는 사이의 둘째 새 타일은 지연 없이 곧바로 ─────────────
await key("KeyD", CS, "D");
await sleep(40);
const known = Object.keys(await rects());
await armOpen([60, 600]);
await key("KeyD", CS, "D");
await sleep(700);
const s4 = await samples();
const fresh2 = Object.keys(s4.at(-1)?.boxes ?? {}).find((id) => !known.includes(id));
console.log("rapid split:", JSON.stringify({ fresh2, s: s4.map((x) => ({ t: x.t, fresh: x.boxes[fresh2], focus: x.focus })) }));
check((s4[0]?.boxes?.[fresh2]?.[2] ?? 0) > 0.2, `연타의 새 타일은 ~60ms 에 이미 보인다 — 지연 없음 (opacity=${s4[0]?.boxes?.[fresh2]?.[2]})`);
check(s4[0]?.focus === fresh2, "연타에도 포커스는 곧바로 새 타일");

// ── ② 마지막 타일 닫기(= 탭 닫기) · 탭 닫기에는 유령이 없다 ───────────────────
await key("KeyT", CS, "T"); await sleep(500); // 새 탭(시작 타일)
await key("KeyN", CS, "N"); await sleep(500);
m0 = await mark();
await key("KeyQ", CS, "Q"); await sleep(400);
check(!(await logSince(m0)).some((e) => e.k === "ghost+"), "마지막 타일 닫기(탭 닫기)에는 유령이 없다");
await key("KeyT", CS, "T"); await sleep(500);
await key("KeyN", CS, "N"); await sleep(300);
await key("KeyD", CS, "D"); await sleep(600);
m0 = await mark();
await key("KeyW", CS, "W"); await sleep(400);
check(!(await logSince(m0)).some((e) => e.k === "ghost+"), "탭 닫기에는 유령이 없다");

// ── ③ 닫은 직후 탭 전환 → 곧바로 걷힘 · 슬라이드 중 닫기 → 없음 ─────────────────
await key("KeyT", CS, "T"); await sleep(500);
await key("KeyN", CS, "N"); await sleep(300);
await key("KeyD", CS, "D"); await sleep(600);
await key("KeyQ", CS, "Q"); await sleep(30);
const before = await ghosts();
await key("Tab", 2, "Tab"); await sleep(20); // Ctrl+Tab — 슬라이드
const after = await ghosts();
check(before === 1 && after === 0, `탭 전환이 유령을 곧바로 걷는다 (${before} → ${after})`);
await sleep(700);
await key("KeyD", CS, "D"); await sleep(600); // 이 탭도 둘로
await key("Tab", 2, "Tab"); await sleep(700); // 돌아온다
await key("KeyD", CS, "D"); await sleep(600);
await key("Tab", 2, "Tab"); await sleep(30); // 슬라이드 도중(들어오는 탭도 둘)
m0 = await mark();
await key("KeyQ", CS, "Q"); await sleep(400);
check(!(await logSince(m0)).some((e) => e.k === "ghost+"), "슬라이드 도중의 닫기에는 유령이 없다");
check((await ghosts()) === 0, "유령 층이 비었다");

console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
ws.close();
process.exit(failed ? 1 : 0);
