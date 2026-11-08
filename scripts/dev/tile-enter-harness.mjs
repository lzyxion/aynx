// Headless harness: **첫 타일의 등장 효과** (docs/log/2026-09-04-start-page.md §3 의 2026-09-25 뒤집음).
// `projects-harness.mjs` 의 스텁 모양을 줄인 사본 — 시나리오만 다르다.
//
//   npx vite --port 1431 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9231 --user-data-dir=%TEMP%/edge-aynx-enter \
//     --window-size=1100,800 http://localhost:1431/
//   PAGE_PORT=1431 node scripts/dev/tile-enter-harness.mjs outdir 9231
//
// 보는 것: ① 앱 시작의 시작 타일은 **등장 효과 없이** 선다(게이트가 꺼져 있다) ② 시작 타일 하나짜리
// 탭에서 `Ctrl+Shift+N`(`openPaneHere` → `placePane` 의 교체)으로 연 첫 타일에 등장
// 애니메이션이 돌고, 끝나면 opacity 1 · 붙는 순간부터 제자리(같은 중심에서 커질 뿐 미끄러지지 않는다) ③ 분할
// (`Ctrl+Shift+D`)의 새 타일도 여전히 등장한다.
// 새 `.pane-box` 는 MutationObserver 가 붙는 순간과 다음 프레임에 `getAnimations()`·opacity·
// 사각형을 적어 둔다 (`window.__enter`).
import { waitBoot } from "./boot-wait.mjs";
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
  // 새 타일 관찰 — 붙는 순간(마이크로태스크)과 다음 프레임의 애니메이션 수·opacity·사각형.
  window.__enter = [];
  const snap = (el) => { const r = el.getBoundingClientRect(); return { anims: el.getAnimations().length, opacity: +getComputedStyle(el).opacity, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
  new MutationObserver((muts) => {
    for (const m of muts) for (const node of m.addedNodes) {
      if (!(node instanceof HTMLElement) || !node.classList.contains('pane-box')) continue;
      const rec = { pane: node.dataset.pane, at: performance.now(), now: snap(node) };
      window.__enter.push(rec);
      requestAnimationFrame(() => { rec.frame = snap(node); });
    }
  }).observe(document, { childList: true, subtree: true });
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    get_host_meta: null, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
     load_snippets: null, 
     save_snippets: null, 
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
      window.__calls.push([cmd, args]);
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
await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);

const key = async (code, modifiers, k) => { const vk = code.charCodeAt(3); for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
const boxes = () => ev(`[...document.querySelectorAll('.pane-box:not(.hidden)')].map(b => b.dataset.pane)`);
const entered = (since) => ev(`JSON.parse(JSON.stringify(window.__enter.slice(${since})))`);
const animated = (r) => !!r && ((r.now.anims > 0 || r.now.opacity < 1) || (r.frame && (r.frame.anims > 0 || r.frame.opacity < 1)));
const settled = (id) => ev(`(() => { const el = document.querySelector('.pane-box[data-pane="${id}"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { anims: el.getAnimations().length, opacity: +getComputedStyle(el).opacity, left: Math.round(r.left), top: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; })()`);

// ── ① 앱 시작 — 시작 타일은 효과 없이 ────────────────────────────────────────
const boot = await entered(0);
console.log("boot boxes:", JSON.stringify(boot));
check(boot.length === 1, `시작 타일 하나로 부팅 (${boot.length})`);
check(boot.length === 1 && !animated(boot[0]), "앱 시작의 시작 타일에는 등장 효과가 없다 (게이트 꺼짐)");
const startId = boot[0]?.pane;
const startRect = await settled(startId);

// ── ② 시작 타일 하나짜리 탭에서 첫 타일 열기 (교체) ───────────────────
let mark = (await ev(`window.__enter.length`));
await key("KeyN", 10, "N"); // Ctrl+Shift+N = new-shell → openPaneHere → placePane(교체)
await sleep(60);
const midOpacity = await ev(`(() => { const el = [...document.querySelectorAll('.pane-box')].at(-1); return el ? +getComputedStyle(el).opacity : null; })()`);
await sleep(400);
const first = await entered(mark);
console.log("first tile:", JSON.stringify(first), "opacity@60ms:", midOpacity);
check(first.length === 1, `새 타일 하나가 섰다 (${first.length})`);
const firstId = first[0]?.pane;
check(JSON.stringify(await boxes()) === JSON.stringify([firstId]), "시작 타일은 교체되어 사라졌다 (분할 아님)");
check(animated(first[0]), `첫 타일에 등장 애니메이션이 돈다 (now=${JSON.stringify(first[0]?.now)} frame=${JSON.stringify(first[0]?.frame)})`);
check(typeof midOpacity === "number" && midOpacity < 1, `60ms 뒤 opacity < 1 (${midOpacity})`);
const firstEnd = await settled(firstId);
console.log("first settled:", JSON.stringify(firstEnd), "start rect:", JSON.stringify(startRect));
check(firstEnd?.anims === 0 && firstEnd?.opacity === 1, "끝나면 opacity 1 · 애니메이션 없음");
// 새 요소라 left/top 트랜지션의 출발점이 없다 — 붙는 순간의 배치 사각형이 이미 최종 자리이고,
// 첫 프레임의 사각형은 `scale(.98)` 만큼 **같은 중심**으로 작을 뿐이다(미끄러짐이 아니다).
const n0 = first[0]?.now, f = first[0]?.frame;
const center = (r) => [r.left + r.w / 2, r.top + r.h / 2];
const near = (a, b) => Math.abs(a[0] - b[0]) <= 1 && Math.abs(a[1] - b[1]) <= 1;
check(!!n0 && n0.left === firstEnd.left && n0.top === firstEnd.top && n0.w === firstEnd.w && n0.h === firstEnd.h,
  `붙는 순간부터 최종 자리 (now=${JSON.stringify(n0)})`);
check(!!f && near(center(f), center(firstEnd)) && f.w <= firstEnd.w,
  `첫 프레임은 같은 중심의 살짝 작은 상자 — 이상한 원점에서 미끄러져 오지 않는다 (frame=${JSON.stringify(f)})`);
check(!!startRect && startRect.left === firstEnd.left && startRect.top === firstEnd.top && startRect.w === firstEnd.w && startRect.h === firstEnd.h,
  "시작 타일이 있던 사각형 그대로");
console.log("capture:", await shot("tile-enter-first.png"));

// ── ③ 분할은 여전히 등장한다 ─────────────────────────────────────────────────
mark = await ev(`window.__enter.length`);
await key("KeyD", 10, "D"); // Ctrl+Shift+D = split
await sleep(400);
const split = await entered(mark);
console.log("split tile:", JSON.stringify(split));
check(split.length === 1 && animated(split[0]), "분할의 새 타일에도 등장 애니메이션");
const splitEnd = await settled(split[0]?.pane);
check(splitEnd?.anims === 0 && splitEnd?.opacity === 1, "분할 타일도 끝나면 opacity 1");
check((await ev(`document.querySelector('.host')?.classList.contains('anim')`)) === false, "게이트는 시간으로 꺼졌다 (.host.anim 없음)");

console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
ws.close();
process.exit(failed ? 1 : 0);
