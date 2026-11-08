// 헤드리스 검증 — 접속 실패 힌트 배너 + SSH 이름 카드(연결 상태).
// blocks-harness.mjs 의 복사본에 SSH 스텁(open_ssh_session / session_info)을 얹었다.
// usage: node scripts/dev/connect-diag-harness.mjs <outdir>
//   → connect-error-hint.png · session-info-card-dark.png · session-info-card-light.png
// 2026-09-28: 이름 칸의 `title` 말풍선이 카드(`[data-session-info-card]`)로 바뀌었다 — 카드 줄과
// 접근성 설명(`aria-describedby` 가 가리키는 숨은 한 줄)을 읽고, `title` 이 **없음**을 확인한다.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const [outdir = "."] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? "9224"}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (d.method) events.push(d);
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
// 캡처는 가끔 빈 답이 온다 — 한 번 더 물어본다.
const shot = async (path) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) { fs.writeFileSync(path, Buffer.from(r.result.data, "base64")); return "ok"; }
    await sleep(500);
  }
  return "capture failed";
};
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;
  // 이 두 값을 테스트가 갈아 끼운다.
  window.__openErr = null;            // open_ssh_session 이 거부할 페이로드 (null = 성공)
  window.__sessionInfo = null;        // session_info 가 답할 한 벌
  const answers = {
    list_hosts: {hosts:[{name:'web-01', host_name:'web-01.internal', user:'deploy', port:22, meta:{color:'#5b9cf6', tags:[], forwards:[]}}],warnings:[]},
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'open_ssh_session') {
        if (window.__openErr) return Promise.reject(window.__openErr);
        const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 };
        return Promise.resolve({ id, tmux: null });
      }
      if (cmd === 'session_info') return window.__sessionInfo ? Promise.resolve(window.__sessionInfo) : Promise.reject('no info');
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(4500);

const key = async (code, modifiers, keyName) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : code === "Escape" ? 27 : code === "Enter" ? 13 : 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

// ── 1. 호스트 독을 열고 web-01 을 더블클릭해 SSH 타일을 만든다 ────────────────
await key("KeyH", 10, "H"); // Ctrl+Shift+H
await sleep(900);
console.log("dock rows:", await ev(`JSON.stringify([...document.querySelectorAll('[data-id]')].map(e=>e.dataset.id).slice(0,8))`));

const openHost = async () => {
  return await ev(`(() => {
    const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
    if (!el) return 'no row';
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'clicked';
  })()`);
};

const CASES = [
  ["dns", { kind: "other", message: "호스트 이름 web-01.internal 을(를) 찾을 수 없습니다", diag: { cause: "dns" } }],
  ["tcp_refused", { kind: "other", message: "10.0.0.9:22 이(가) 연결을 거부했습니다", diag: { cause: "tcp_refused" } }],
  ["tcp_timeout", { kind: "other", message: "10.0.0.9:22 이(가) 응답하지 않습니다 (시간 초과)", diag: { cause: "tcp_timeout" } }],
  ["tcp_unreachable", { kind: "other", message: "10.0.0.9:22 에 닿을 수 없습니다", diag: { cause: "tcp_unreachable" } }],
  ["auth_key_rejected", { kind: "auth", message: "ssh-agent 의 키 2개가 모두 거부되었습니다", diag: { cause: "auth_key_rejected" } }],
  ["auth_no_method", { kind: "auth", message: "ssh-agent 서비스가 꺼져 있습니다", diag: { cause: "auth_no_method" } }],
  ["banner_or_protocol", { kind: "other", message: "10.0.0.9:80 이(가) SSH 로 응답하지 않습니다: Key exchange failed", diag: { cause: "banner_or_protocol" } }],
  ["jump→tcp_refused", { kind: "other", message: "경유 호스트 bastion 에서 실패: 10.0.0.9:22 이(가) 연결을 거부했습니다", diag: { cause: "jump", jump: "bastion", inner: "tcp_refused" } }],
  ["other(힌트 없음)", { kind: "other", message: "셸 채널을 열지 못했습니다: nope", diag: { cause: "other" } }],
];

const read = async () =>
  await ev(`JSON.stringify([...document.querySelectorAll('.reco')].map(b => ({
    head: (b.querySelector('.head')?.textContent || '').trim().replace(/\\s+/g,' '),
    why:  (b.querySelector('.why')?.textContent  || '').trim(),
    hint: (b.querySelector('.hint')?.textContent || '').trim(),
  })))`);

const results = [];
// 첫 판: 독에서 한 번 연다. 그 뒤로는 배너의 [다시 시도] 를 눌러 같은 타일에서 갈래를 바꾼다.
await ev(`window.__openErr = ${JSON.stringify(CASES[0][1])}`);
console.log("open:", await openHost());
await sleep(1500);
await key("KeyH", 10, "H"); // 독을 닫는다 — 캡처에서 배너를 가린다
await sleep(500);
results.push([CASES[0][0], await read()]);

for (const [name, payload] of CASES.slice(1)) {
  await ev(`window.__openErr = ${JSON.stringify(payload)}`);
  const pressed = await ev(`(() => {
    const b = [...document.querySelectorAll('.reco .act')][0];
    if (!b) return 'no button';
    b.click();
    return 'ok';
  })()`);
  await sleep(1200);
  results.push([name, pressed === "ok" ? await read() : pressed]);
}

for (const [name, r] of results) console.log("CASE", name, r);

// 힌트가 잘 보이는 판(키 거부)으로 되돌려 캡처한다.
await ev(`window.__openErr = ${JSON.stringify(CASES[4][1])}`);
await ev(`document.querySelector('.reco .act')?.click()`);
await sleep(1200);
await shot(`${outdir}/connect-error-hint.png`);

// ── 2. 붙은 타일의 SSH 이름 카드 ────────────────────────────────────────────
const NOW = Date.now();
await ev(`window.__openErr = null; window.__sessionInfo = ${JSON.stringify({
  server_version: "OpenSSH_9.6",
  auth_method: "key_file",
  identity: "~/.ssh/id_ed25519",
  identity_stored: true,
  jump: "bastion",
  connected_at_ms: NOW - 12 * 60_000,
  keepalive_secs: null,
  rtt_ms: 23,
  shared_with: 2,
  joined: false,
  agent_forward: true,
})}`);
await ev(`document.querySelector('.reco .act')?.click()`);
await sleep(1500);
console.log("session_info calls:", await ev(`window.__calls.filter(c=>c[0]==='session_info').length`));
console.log("name title (null 이어야):", await ev(`JSON.stringify(document.querySelector('.pane-name')?.getAttribute('title'))`));
console.log("aria description:", await ev(`(() => {
  const el = document.querySelector('.pane-name');
  const id = el?.getAttribute('aria-describedby');
  return JSON.stringify(id ? document.getElementById(id)?.textContent : null);
})()`));

// 진짜 호버 — 머리줄 pointerover(값 갱신) + 이름 칸 pointerenter(카드 시계). 500ms 뒤에 뜬다.
const hover = async () =>
  await ev(`(() => {
    const el = document.querySelector('.pane-name');
    const r = el.getBoundingClientRect();
    const at = { clientX: r.left + 4, clientY: r.top + 4 };
    el.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, ...at }));
    el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, ...at }));
    return 'over';
  })()`);
const readCard = async () =>
  await ev(`(() => {
    const c = document.querySelector('[data-session-info-card]');
    if (!c) return 'no card';
    const txt = (sel) => [...c.querySelectorAll(sel)].map((e) => e.textContent.trim());
    const labels = txt('.s-label'), values = txt('.s-value');
    return JSON.stringify({
      name: txt('.s-name')[0], addr: txt('.s-addr')[0] ?? null, dot: !!c.querySelector('.s-dot'),
      rows: labels.map((l, i) => l + ' | ' + values[i]),
      warn: txt('.s-warn'),
      warnValues: [...c.querySelectorAll('.s-value.warn')].map((e) => e.dataset.row),
      opacity: getComputedStyle(c).opacity,
      tip: document.querySelector('.tip')?.textContent ?? null,
    });
  })()`);

await hover();
await sleep(800);
console.log("card (dark):", await readCard());
console.log("capture dark:", await shot(`${outdir}/session-info-card-dark.png`));

// 닫힘 — Escape
await key("Escape", 0, "Escape");
console.log("after Escape:", await ev(`document.querySelector('[data-session-info-card]') ? 'still open' : 'closed'`));

// 느린 연결 — 지연 경고색 + 공유 연결(얹힘)
await ev(`window.__sessionInfo = { ...window.__sessionInfo, rtt_ms: 420, joined: true, keepalive_secs: 30 }`);
// 호버 갱신은 30초(INFO_STALE_MS)로 묶여 있다 — 페이지 시계를 31초 앞당겨 이번 호버가 새로 묻게 한다.
await ev(`(() => { const real = Date.now.bind(Date); Date.now = () => real() + 31_000; return 'shifted'; })()`);
await ev(`document.documentElement.dataset.theme = 'light'`);
await sleep(300);
const callsBefore = await ev(`window.__calls.filter(c=>c[0]==='session_info').length`);
await hover();
await sleep(800);
console.log("hover re-query:", callsBefore, "→", await ev(`window.__calls.filter(c=>c[0]==='session_info').length`));
console.log("card (light, 새 값 — 지연 경고 · 공유 연결 · keepalive 켬):", await readCard());
console.log("capture light:", await shot(`${outdir}/session-info-card-light.png`));
// 포인터가 떠나면 닫힌다
await ev(`document.querySelector('.pane-name').dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))`);
await sleep(100);
console.log("after leave:", await ev(`document.querySelector('[data-session-info-card]') ? 'still open' : 'closed'`));

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
ws.close();
