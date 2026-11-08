// Headless harness: **타일 머리줄 버튼의 드러냄** (docs/log/2026-09-25-leftovers-surface-header.md).
// `tile-enter-harness.mjs` 의 스텁을 그대로 쓴 사본 — 시나리오만 다르다.
//
//   npx vite --port 1436 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new //     --remote-debugging-port=9260 --user-data-dir=%TEMP%/edge-aynx-reveal //     --window-size=1100,800 http://localhost:1436/
//   PAGE_PORT=1436 node scripts/dev/tile-header-reveal-harness.mjs outdir 9260
//
// 보는 것: 타일 둘(새 셸 + 분할)에서 ① 포커스 아닌 타일의 `.head-btn` 은 opacity 0 · pointer-events
// none, 포커스 타일은 1 ② 이름은 늘 보이고, 타일 코드(`p3`)는 머리줄에 그리지 않는다(2026-10-18 사용자 — 예전 각인 칩
// `.tile-code` 를 걷었다, `PaneHeader.svelte` 의 "타일 코드" 주석). 로컬 터미널의 코드는 이름 카드가 쥔다 — 이름의
// `aria-describedby` 설명 줄이 `로컬 · p3 …` 로 시작한다(2026-10-11) ③ **진짜 포인터**(`Input.dispatchMouseEvent`)
// 가 그 타일 본문 위에 오면 드러나고, 떠나면 다시 숨는다 ④ 드러나도 이름 폭이 그대로다(자리는 늘 남는다)
// ⑤ 키보드 포커스가 머리줄 버튼에 닿으면 드러난다(`:focus-within`) ⑥ `hover: none` 장치에서는 늘 보인다.
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
const move = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });

// 타일 둘 — 새 셸(시작 타일 교체) + 분할. 포커스는 분할로 선 새 타일에 있다.
await key("KeyN", 10, "N"); await sleep(600);
await key("KeyD", 10, "D"); await sleep(800);

/** 머리줄마다: 포커스 여부 · 버튼 불투명도/pointer-events · 이름·코드 불투명도 · 이름 폭 · 타일 본문 가운데 */
const heads = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.pane-box:not(.hidden) > .pane-head')].map((h) => {
  const box = h.parentElement.getBoundingClientRect();
  const cs = (el) => getComputedStyle(el);
  return {
    active: h.classList.contains('active'),
    btns: [...h.querySelectorAll('.head-btn')].map((b) => [+cs(b).opacity, cs(b).pointerEvents]),
    name: +cs(h.querySelector('.pane-name')).opacity, code: !!h.querySelector('.tile-code'),
    // 로컬 터미널의 이름 카드 설명 줄(이름 · p3 + 카드 줄들) — 코드는 여기서만 읽힌다
    desc: (() => { const id = h.querySelector('.pane-name').getAttribute('aria-describedby'); return id ? document.getElementById(id)?.textContent ?? null : null; })(),
    nameText: h.querySelector('.pane-name').textContent.trim(),
    nameW: Math.round(h.querySelector('.pane-name').getBoundingClientRect().width),
    body: { x: Math.round(box.left + box.width / 2), y: Math.round(box.top + box.height / 2) },
  };
}))`));
const hidden = (h) => h.btns.length > 0 && h.btns.every(([o, pe]) => o === 0 && pe === "none");
const shown = (h) => h.btns.length > 0 && h.btns.every(([o, pe]) => o === 1 && pe === "auto");

// 포인터를 화면 구석(탭 줄 오른쪽 빈 곳)에 먼저 둔다 — 어느 타일에도 얹히지 않게
await move(600, 12); await sleep(300);
let hs = await heads();
console.log("rest:", JSON.stringify(hs));
check(hs.length === 2, `타일 둘 (${hs.length})`);
const idle = hs.findIndex((h) => !h.active);
const act = hs.findIndex((h) => h.active);
check(idle >= 0 && act >= 0, "포커스 타일 하나 + 아닌 타일 하나");
check(shown(hs[act]), "포커스 타일의 버튼은 보인다");
check(hidden(hs[idle]), "포커스 아닌 타일의 버튼은 숨는다 (opacity 0 · pointer-events none)");
check(hs.every((h) => h.name === 1), "이름은 늘 보인다");
check(hs.every((h) => !h.code), "타일 코드 칩은 머리줄에 없다 (2026-10-18 걷음)");
check(hs.every((h) => typeof h.desc === "string" && h.desc.startsWith(`${h.nameText} · p`) && /^p\d+$/.test(h.desc.slice(h.nameText.length + 3).split(/\s/)[0])), `이름 카드 설명이 '이름 · pN' 으로 시작 (${hs.map((h) => h.desc?.slice(0, 40)).join(" / ")})`);
const restW = hs[idle].nameW;
console.log("capture:", await shot("reveal-rest.png"));

// 진짜 포인터로 포커스 아닌 타일의 **본문** 위에
await move(hs[idle].body.x, hs[idle].body.y); await sleep(300);
hs = await heads();
check(shown(hs[idle]), "포인터가 타일 위에 오면 드러난다");
check(!hs[idle].code, "포인터가 타일 위에 와도 타일 코드 칩은 서지 않는다");
check(hs[idle].nameW === restW, `드러나도 이름 폭이 그대로 (${restW} → ${hs[idle].nameW})`);
console.log("capture:", await shot("reveal-hover.png"));

// 떠나면 다시 숨는다
await move(hs[act].body.x, hs[act].body.y); await sleep(300);
hs = await heads();
check(hidden(hs[idle]), "포인터가 떠나면 다시 숨는다");

// 키보드 포커스 — 숨은 ⋯ 에 포커스가 닿으면 드러난다 (visibility 로 숨겼다면 Tab 이 닿지도 못한다)
const focused = await ev(`(() => { const h = [...document.querySelectorAll('.pane-box:not(.hidden) > .pane-head')][${idle}]; const b = h.querySelector('.head-btn.more'); b.focus(); return document.activeElement === b; })()`);
await sleep(300);
hs = await heads();
check(focused === true, "숨은 버튼도 포커스를 받는다");
check(shown(hs[idle]), "머리줄 버튼에 키보드 포커스가 있으면 드러난다 (:focus-within)");
await ev(`document.activeElement?.blur()`); await sleep(300);

// 호버가 없는 장치
await send("Emulation.setEmulatedMedia", { features: [{ name: "hover", value: "none" }] }); await sleep(300);
hs = await heads();
check(shown(hs[idle]), "hover: none 에서는 늘 보인다");
check(hs.every((h) => !h.code), "hover: none 에서도 타일 코드 칩은 없다");
await send("Emulation.setEmulatedMedia", { features: [] });

console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
ws.close();
process.exit(failed ? 1 : 0);
