// Headless harness: stub Tauri, open a local tile, feed OSC 133/7 blocks through the Channel callback.
// usage: node blocks-harness.mjs <out.png> [extra-script.js]   (extra script is evaluated after feeding)
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const [out, extra] = process.argv.slice(2);
const port = process.env.CDP_PORT ?? "9224";   // 9224 를 다른 판이 쓰고 있으면 자기 포트를 준다
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await send("Page.enable"); await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;
  // WebGL 을 끈다 — 가속 렌더러에서는 화면 글자가 canvas 라 DOM 에 한 글자도 없다
  // (xterm-rows 가 비어 있다). DOM 렌더러라야 하네스가 줄을 찾아 좌표를 잴 수 있다.
  // (주입 스크립트 안에서는 백틱을 쓰지 않는다 — 템플릿 리터럴이 거기서 끝난다.)
  const answers = { load_settings: { terminal: { webgl: false } }, list_hosts: {hosts:[{name:'web-01'}],warnings:[]}, list_shells: [{id:'pwsh',label:'PowerShell 7'}], list_group_meta: {}, list_host_meta: {},  session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null, push_session_block: null, drop_session: null, resize_session: null, write_session: null, send_input: null };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB} window.__calls.push([cmd, args]); if (cmd === 'plugin:clipboard-manager|read_text') { window.__clipReads++; return Promise.resolve(''); } if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve(id); } return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd)); },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; const buf = new TextEncoder().encode(text).buffer; cb({ message: buf, index: c.idx++ }); return 'ok'; };
  // OSC 52 검증용 클립보드 스텁 — 합성 클릭에는 사용자 활성화가 없어 진짜 API 는 거부한다
  // (README 의 cdp.mjs 주의사항). 쓰기는 웹 API 그대로다. 읽기는 빈 값을 주되, 앱이 부르는지
  // 자체를 세어 둔다 — 지금 읽기 길은 플러그인 invoke(plugin:clipboard-manager|read_text, 위
  // invoke 스텁)이고, 웹 API 읽기도 함께 센다(어느 길로든 읽으면 reads 가 오른다,
  // docs/log/2026-09-28-clipboard-plugin.md).
  window.__clip = []; window.__clipReads = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: (s) => { window.__clip.push(s); return Promise.resolve(); },
    readText: () => { window.__clipReads++; return Promise.resolve(''); },
  } });
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4000);
const key = async (code, modifiers, key) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : code === "Escape" ? 27 : code === "Enter" ? 13 : 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(200); };
await key("KeyN", 10, "N"); await sleep(1500);
console.log("sessions:", await ev(`JSON.stringify(Object.keys(window.__chan))`), "xterm:", await ev(`document.querySelectorAll('.xterm').length`));
const ESC = "\x1b", BEL = "\x07";
const block = (cmd, out, exit, cwd = "/home/u") => `${ESC}]7;file://host${cwd}${BEL}${ESC}]133;A${BEL}u@host:~$ ${ESC}]133;B${BEL}${cmd}\r\n${ESC}]133;C${BEL}${out}${ESC}]133;D;${exit}${BEL}`;
const sid = await ev(`Object.keys(window.__chan)[0]`);
const script = [block("git pull", "Already up to date.\r\n", 0), block("make all", "gcc -c main.c\r\nmain.c:3: error: undefined reference to foo\r\nmake: *** [all] Error 2\r\n", 2), block("ls -la", "total 0\r\n", 0)].join("") + `${ESC}]7;file://host/home/u${BEL}${ESC}]133;A${BEL}u@host:~$ ${ESC}]133;B${BEL}`;
console.log("feed:", await ev(`window.__feed(${sid}, ${JSON.stringify(script)})`)); await sleep(800);
console.log("decorations(fail marks):", await ev(`document.querySelectorAll('.xterm-decoration').length`), "pushes:", await ev(`window.__calls.filter(c=>c[0]==='push_session_block').length`));

// ── OSC 8 하이퍼링크 · OSC 52 원격 클립보드 (docs/log/2026-09-23-osc52-osc8.md) ──
// OSC 8 은 주소가 **화면 글자에 없다** — 보이는 것은 라벨뿐이라, 링크가 실제로 섰는지는
// 포인터를 올려 봐야만 안다. 그래서 진짜 마우스 이벤트(Input.dispatchMouseEvent)로 몬다.
const ST = `${ESC}\\`;
await ev(`window.__feed(${sid}, ${JSON.stringify(`\r\n${ESC}]8;;https://example.com${ST}aynx-osc8-link${ESC}]8;;${ST}\r\n`)})`);
await sleep(500);
// 라벨만 담긴 **가장 안쪽** 요소를 짚는다 — 줄 전체를 쓰면 프롬프트 글자 위를 가리킨다.
const at = await ev(`(() => { const hit = [...document.querySelectorAll('.xterm-rows *')].filter((e) => e.textContent === 'aynx-osc8-link').pop(); if (!hit) return null; const b = hit.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
console.log("osc8 row:", at);
if (at) {
  const { x, y } = JSON.parse(at);
  const mouse = (type, opts = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...opts });
  await mouse("mouseMoved", { button: "none", clickCount: 0 }); await sleep(300);
  // ① 호버 — 우클릭 메뉴가 그 순간의 `hoveredLink` 를 붙든다 (Terminal.svelte 의 onContextMenu).
  // 우클릭만은 **합성 이벤트**다 — CDP 의 오른쪽 버튼은 `contextmenu` 를 만들지 않는다.
  // 호버는 위의 진짜 mouseMoved 가 이미 세워 뒀고, 이 이벤트는 그 값을 읽기만 한다.
  await ev(`document.elementFromPoint(${x}, ${y}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: ${x}, clientY: ${y} }))`); await sleep(300);
  console.log("osc8 hover → menu:", await ev(`document.querySelectorAll(".tilemenu").length`), "link:", await ev(`JSON.stringify([...document.querySelectorAll('.tilemenu [title]')].map((e) => e.getAttribute('title')).filter((s) => s && s.includes('example.com')))`));
  await key("Escape", 0, "Escape");
  // ② 활성화 — **Ctrl+클릭에서만** 연다 (WebLinks 와 같은 조작). 그냥 클릭은 0건이어야 한다.
  // 먼저 포인터를 비켰다가 되돌린다 — 위의 `contextmenu` 에 xterm 이 제 textarea 를 포인터 밑으로
  // 끌어올려(20px · z-index 1000, `moveTextAreaUnderMouseCursor`) 제자리 클릭이 링크 대신 그 textarea 에
  // 떨어진다(두 클릭 모두 0 이 나온다).
  await mouse("mouseMoved", { x: x + 40, button: "none", clickCount: 0 }); await sleep(200);
  await mouse("mouseMoved", { button: "none", clickCount: 0 }); await sleep(300);
  await mouse("mousePressed"); await mouse("mouseReleased"); await sleep(250);
  const plain = await ev(`window.__calls.filter((c) => String(c[0]).includes('open_url')).length`);
  await mouse("mousePressed", { modifiers: 2 }); await mouse("mouseReleased", { modifiers: 2 }); await sleep(250);
  console.log("osc8 open_url (plain / ctrl):", plain, await ev(`window.__calls.filter((c) => String(c[0]).includes('open_url')).length`));
}
// OSC 52 — 쓰기는 클립보드에 닿고, 읽기 요청(`?`)은 **아무 답도 내지 않는다**.
const payload = Buffer.from("aynx-osc52", "utf8").toString("base64");
await ev(`window.__feed(${sid}, ${JSON.stringify(`${ESC}]52;c;${payload}${BEL}`)})`); await sleep(400);
console.log("osc52 write → clipboard:", await ev(`JSON.stringify(window.__clip)`), "toast:", await ev(`document.querySelectorAll('.toast').length`));
const before = await ev(`window.__calls.length`);
await ev(`window.__feed(${sid}, ${JSON.stringify(`${ESC}]52;c;?${BEL}`)})`); await sleep(400);
console.log("osc52 query → writes:", await ev(`window.__clip.length`), "reads:", await ev(`window.__clipReads`), "new invokes:", (await ev(`window.__calls.length`)) - before);

if (extra) console.log("extra:", await ev(fs.readFileSync(extra, "utf8")));
if (out) { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(out, Buffer.from(r.result.data, "base64")); }
const exc = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0]).filter((s) => !/stub:/.test(s)).slice(0, 4); if (exc.length) console.log("EXC", exc);
ws.close();
