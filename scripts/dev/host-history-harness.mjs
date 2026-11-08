// Headless harness: **접속 이력** (docs/log/2026-09-23-host-history.md).
// `host-remove-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx \
//     --window-size=1100,800 http://localhost:1420/
//   (PAGE_PORT · CDP_PORT 로 격리 서버를 가리킬 수 있다 — 기본 1420 · 9224)
//   node scripts/dev/host-history-harness.mjs outdir
//
// 포트는 `CDP_PORT` 로 바꾼다 (기본 9224).
//
// 심어 두는 것: 호스트 셋(`web-01`·`db-01`·`app-01`, 설정 파일 순서 그대로) · 즐겨찾기 한 칸
// (`web-01`) · `host_history_list` 에 이력 **둘** — `db-01`(2분 전 성공 5회) ·
// `app-01`(1시간 전 성공, 5분 전 `tcp_refused` 실패). 탭은 없다(시작 화면이 본문이다).
//
// 보는 것: ① 명령 팔레트(`Ctrl+Shift+P`)를 빈 질의로 열면 맨 위 "최근" 묶음이
// `db-01 → app-01` 순서로 서고(첫 줄이 선택), 한 글자를 치면 묶음이 사라진다 ② 독의 정렬 버튼을 누르면 줄 순서가 이름(설정 순서)에서 최근순으로 바뀌고, `save_settings`
// 로 `[hosts] sort = "recent"` 가 나간다 ③ `app-01` 줄 말풍선에 마지막 접속·실패가 적힌다.
// PNG 둘: `<outdir>/host-history-palette.png` · `<outdir>/host-history-dock.png`.
// (시작 화면에는 "최근" 이 없다 — 로고 + 즐겨찾기뿐, 사용자 결정 2026-09-23.)
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.env.CDP_PORT ?? "9224";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
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
  const cbs = new Map(); let n = 0; window.__calls = [];
  try { localStorage.setItem('aynx:favorites', JSON.stringify([{kind:'host',alias:'web-01'}])); } catch {}
  const host = (name, ip, icon) => ({ name, host_name: ip, user: 'deploy', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon } });
  const HOSTS = [host('web-01', '10.0.0.1', null), host('db-01', '10.0.0.2', null), host('app-01', '10.0.0.3', null)];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const now = Date.now();
  const HISTORY = {
    'db-01': { last_ok_at: now - 2 * 60000, last_fail_at: null, last_fail_cause: null, last_fail_message: null, count: 5 },
    'app-01': { last_ok_at: now - 60 * 60000, last_fail_at: now - 5 * 60000, last_fail_cause: 'tcp_refused', last_fail_message: 'Connection refused', count: 1 },
  };
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META,
    list_group_meta: {}, list_host_meta: {},
    list_shells: [{ id: 'pwsh', label: 'PowerShell 7' }],
     load_snippets: null, 
     save_snippets: null, 
    load_settings: {},
    save_settings: null,
    host_history_list: HISTORY,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB} window.__calls.push([cmd, args]); return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd)); },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);

const key = async (code, modifiers, k) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(250); };

// ── ① 팔레트 "최근" 묶음 ───────────────────────────────────────────────────
// 머리글은 종류가 바뀌는 자리에 서므로, 첫 머리글의 글자와 `r:` 줄들을 본다.
await key("KeyP", 10, "P"); await sleep(600);
const paletteRecent = () => ev(`(() => { const d = document.querySelector('.palette'); if (!d) return 'no palette'; return [...d.querySelectorAll('[data-row]')].filter(b => b.dataset.recent !== undefined).map(b => b.querySelector('.label')?.textContent).join('|'); })()`);
const firstSection = await ev(`document.querySelector('.palette .section')?.textContent ?? null`);
const recentRows = await paletteRecent();
const firstSel = await ev(`document.querySelector('.palette [data-row].sel')?.dataset.recent !== undefined ? document.querySelector('.palette [data-row].sel .label')?.textContent : null`);
console.log("palette first section:", JSON.stringify(firstSection), "recent:", JSON.stringify(recentRows), "selected:", JSON.stringify(firstSel));
check(firstSection === "최근", "팔레트 첫 머리글 = 최근");
check(recentRows === "db-01|app-01", "최근 묶음 = db-01 → app-01 (즐겨찾기 web-01 은 이력이 없어 안 선다)");
check(firstSel === "db-01", "첫 줄(db-01)이 선택되어 있다");
console.log("capture:", await shot("host-history-palette.png"));
await send("Input.insertText", { text: "d" }); await sleep(400);
const afterType = await paletteRecent();
const sectionsAfter = await ev(`[...document.querySelectorAll('.palette .section')].map(e => e.textContent).join('|')`);
console.log("after typing 'd': recent:", JSON.stringify(afterType), "sections:", JSON.stringify(sectionsAfter));
check(afterType === "" && !sectionsAfter.split("|").includes("최근"), "한 글자를 치면 최근 묶음이 사라진다");
await key("Escape", 0, "Escape"); await sleep(300);
check((await ev(`!!document.querySelector('.palette')`)) === false, "Escape 로 팔레트가 닫힌다");

// ── ② 독을 열고 정렬을 바꾼다 ─────────────────────────────────────────────
await key("KeyH", 10, "H"); await sleep(1200);
const rowsNow = () => ev(`[...document.querySelectorAll('[data-id^="h:"]')].map(e => e.getAttribute('data-id').slice(2)).join('|')`);
const before = await rowsNow();
console.log("rows (name):", before);
check(before === "web-01|db-01|app-01", "이름 정렬 = 설정 파일 순서 그대로");
console.log("sort button:", await ev(`(() => { const b = document.querySelector('[data-host-sort]'); if (!b) return 'no button'; const was = b.getAttribute('data-host-sort'); b.click(); return was; })()`));
await sleep(600);
const after = await rowsNow();
console.log("rows (recent):", after);
check(after === "db-01|app-01|web-01", "최근 정렬 = 마지막 성공 늦은 순, 한 번도 안 붙은 것은 뒤");
const saved = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'save_settings').pop()?.[1]?.settings?.hosts ?? null)`);
console.log("save_settings.hosts:", saved);
check(saved === JSON.stringify({ sort: "recent" }), "save_settings 로 [hosts] sort = recent");
check((await ev(`document.querySelector('[data-host-sort]')?.getAttribute('data-host-sort')`)) === "recent", "버튼이 지금 순서(recent)를 말한다");

// ── ③ 말풍선 ───────────────────────────────────────────────────────────────
const tipApp = await ev(`document.querySelector('[data-id="h:app-01"]')?.getAttribute('title') ?? null`);
const tipWeb = await ev(`document.querySelector('[data-id="h:web-01"]')?.getAttribute('title') ?? null`);
console.log("tip app-01:", JSON.stringify(tipApp));
check(typeof tipApp === "string" && tipApp.includes("마지막 접속 1시간 전 · 1회") && tipApp.includes("마지막 실패 5분 전 · Connection refused"), "app-01 말풍선에 마지막 접속·실패");
check(tipWeb === "deploy@10.0.0.1:22", `이력 없는 web-01 의 말풍선 = 주소 한 줄뿐 (${JSON.stringify(tipWeb)})`);
check(typeof tipApp === "string" && tipApp.split("\n")[0] === "deploy@10.0.0.3:22", "말풍선 첫 줄 = user@host:port (2026-09-25 — 줄 뒷글자가 시각으로 바뀌며 옮겨 왔다)");

// 말풍선을 띄워 캡처 — 앱 툴팁 층이 pointerover 를 듣는다
await ev(`(() => { const el = document.querySelector('[data-id="h:app-01"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, clientX: r.left + 20, clientY: r.top + 8 })); el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true, clientX: r.left + 20, clientY: r.top + 8 })); })()`);
const r = await ev(`(() => { const r = document.querySelector('[data-id="h:app-01"]').getBoundingClientRect(); return [r.left + 20, r.top + 8]; })()`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r[0], y: r[1] });
await sleep(900);
console.log("capture:", await shot("host-history-dock.png"));

console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
