// 헤드리스 검증 — **개인키 암호구 모달**(docs/log/2026-09-19-identity-file-auth.md).
// `blocks-harness.mjs` 의 사본에 SSH 스텁(`open_ssh_session`)만 얹었다 — 스텁 표와
// 시나리오만 다르다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx \
//     --window-size=1100,800 http://localhost:1420/
//   node scripts/dev/passphrase-harness.mjs <outdir> [port]
//
// 만드는 것: <outdir>/passphrase-prompt.png
//
// **암호구의 값은 절대 찍지 않는다** — 단언은 `typeof`·`length` 로 "보냈는가" 만 본다.
// 이 파일이 지키는 규칙이 곧 앱이 지키는 규칙이다 (`keygen-harness.mjs` 의 같은 줄).
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";

const [outdir = ".", port = "9224"] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
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
const shot = async (path) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(path, Buffer.from(r.result.data, "base64"));
      return "ok";
    }
    await sleep(500);
  }
  return "capture failed";
};
await send("Page.enable");
await send("Runtime.enable");

const KEY_PATH = "C:\\\\Users\\\\wl\\\\.ssh\\\\id_ed25519_x";
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;
  window.__ppCalls = [];
  // 하네스가 갈아 끼우는 모드: 'ask' = 암호구를 받으면 붙는다, 'wrong' = 늘 틀렸다고 답한다.
  window.__ppMode = 'ask';
  const LOCKED = (wrong) => ({
    kind: 'passphrase_required',
    path: '${KEY_PATH}',
    fingerprint: 'SHA256:PPPPaaaabbbbccccddddeeeeffff000011112222333',
    wrong,
  });
  const answers = {
    list_hosts: {hosts:[{name:'web-01', host_name:'10.0.0.9', user:'deploy', port:22}],warnings:[]},
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
    agent_status: { pipe_alive: true, key_count: 0 }, agent_has_key: false,
    session_info: {
      server_version: 'OpenSSH_9.6p1', auth_method: 'key_file', identity: '~/.ssh/id_ed25519_x',
      jump: null, connected_at_ms: Date.now(), keepalive_secs: 30, rtt_ms: 12,
    },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'open_ssh_session') {
        const supplied = typeof args?.passphrase === 'string' && args.passphrase.length > 0;
        const declined = [...(args?.declinedKeys ?? [])];
        // **모양만** 적어 둔다 — 값은 길이로만 남는다(이 파일의 규칙).
        // 인자 객체를 그대로 들고 있으면 declinedKeys 배열이 **나중에 변해** 지난 호출의
        // 기록까지 바뀐다 (프런트가 같은 배열을 계속 쓴다) — 그래서 여기서 복사한다.
        window.__ppCalls.push({
          passphrase: typeof args?.passphrase,
          passphraseLen: supplied ? args.passphrase.length : null,
          passphraseFor: args?.passphraseFor ?? null,
          declinedKeys: declined,
          password: typeof args?.password === 'string' ? '<sent>' : null,
        });
        // 취소한 키는 백엔드가 다시 묻지 않고 지나간다 → 결국 비밀번호 차례다.
        if (declined.includes('${KEY_PATH}')) {
          return Promise.reject({
            kind: 'password_required',
            message: '키 인증이 거부되어 비밀번호가 필요합니다',
            diag: { cause: 'auth_key_rejected' },
          });
        }
        if (window.__ppMode === 'wrong') return Promise.reject(LOCKED(supplied));
        if (!supplied) return Promise.reject(LOCKED(false));
        const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 };
        return Promise.resolve({ id, tmux: null });
      }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(4500);

const key = async (code, modifiers, keyName) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : code === "Escape" ? 27 : code === "Enter" ? 13 : 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

const openHost = async () =>
  await ev(`(() => {
    const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
    if (!el) return 'no row';
    el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    return 'clicked';
  })()`);

// `open_ssh_session` 이 실제로 실어 보낸 인자 — **값은 담지 않는다**(있는가·몇 글자인가만).
const shapeOf = `window.__ppCalls`;

// ── ① 호스트 독 → SSH 타일 → 암호구 모달 ────────────────────────────────────
await key("KeyH", 10, "H"); // Ctrl+Shift+H
await sleep(900);
console.log("open host:", await openHost());
await sleep(1500);
await key("KeyH", 10, "H"); // 독을 닫는다 (캡처에서 모달만 보이게)
await sleep(600);

console.log("modal open:", await ev(`!!document.querySelector('#pp-input')`));
console.log("title:", JSON.stringify(await ev(`document.querySelector('#pp-title')?.textContent ?? null`)));
console.log("facts:", JSON.stringify(await ev(`[...document.querySelectorAll('.modal .fact dd')].map(e=>e.textContent.trim())`)));
console.log("wrong line shown (want false):", await ev(`!!document.querySelector('.modal .wrong')`));
console.log("attempt:", JSON.stringify(await ev(`document.querySelector('.modal .attempt')?.textContent.trim() ?? null`)));
console.log("capture:", await shot(`${outdir}/passphrase-prompt.png`));

// ── ② 암호구를 넣는다 — 두 번째 호출이 `passphrase` + `passphraseFor` 를 실어야 한다 ──
const SECRET = "harness-passphrase-1234";
console.log("submit:", await ev(`(() => {
  const el = document.querySelector('#pp-input');
  el.value = ${JSON.stringify(SECRET)};
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.form.requestSubmit();
  return 'submitted';
})()`));
await sleep(1500);

console.log("open_ssh_session calls:", JSON.stringify(await ev(shapeOf)));
console.log("modal closed:", await ev(`!document.querySelector('#pp-input')`));
console.log("xterm tiles:", await ev(`document.querySelectorAll('.xterm').length`));
// **값이 어디에도 안 남는다** — DOM 에도, 우리가 찍는 로그에도.
console.log("passphrase gone from DOM:", await ev(`!document.body.innerHTML.includes(${JSON.stringify(SECRET)})`));
console.log(
  "passphrase not in any printed call log:",
  await ev(`!JSON.stringify(${shapeOf}).includes(${JSON.stringify(SECRET)})`),
);

// ── ③ 틀린 암호구 — `wrong: true` 면 모달이 그 줄을 덧붙인다 ─────────────────
await ev(`window.__ppMode = 'wrong'`);
console.log("retry (reco button):", await ev(`(() => {
  const b = [...document.querySelectorAll('.reco .act')][0];
  if (b) { b.click(); return 'reco'; }
  const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
  if (!el) return 'no way to retry';
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return 'dock';
})()`));
await sleep(1500);
console.log("modal open again:", await ev(`!!document.querySelector('#pp-input')`));
console.log("first ask has no wrong line:", await ev(`!document.querySelector('.modal .wrong')`));

console.log("submit wrong:", await ev(`(() => {
  const el = document.querySelector('#pp-input');
  if (!el) return 'no field';
  el.value = 'nope';
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.form.requestSubmit();
  return 'submitted';
})()`));
await sleep(1500);
console.log("wrong line now:", JSON.stringify(await ev(`document.querySelector('.modal .wrong')?.textContent.trim() ?? null`)));
console.log("attempt now:", JSON.stringify(await ev(`document.querySelector('.modal .attempt')?.textContent.trim() ?? null`)));

// ── ④ 취소 = "이 키는 빼고 계속" — 다음 호출이 `declinedKeys` 를 싣는다 ───────
await ev(`window.__ppMode = 'ask'`);
console.log("cancel (Escape):", await (async () => { await key("Escape", 0, "Escape"); return "sent"; })());
await sleep(1500);
console.log("open_ssh_session calls after cancel:", JSON.stringify(await ev(shapeOf)));
console.log("passphrase modal closed after cancel:", await ev(`!document.querySelector('#pp-input')`));
// 취소의 뜻은 "이 키는 빼고 계속" — 백엔드가 그 키를 건너뛰면 **비밀번호 차례**다.
console.log("password modal now open:", await ev(`!!document.querySelector('#pw-input')`));

// (예전 ⑤ — 모달의 [에이전트에 넣기] 체크박스(`.agentopt`) → `ssh-add` 타일 — 는 볼트 ② 에서 빠졌다:
// 75cc26a "에이전트 안내 제거", docs/log/2026-09-19-vault.md. 그 자리의 "이 앱에 저장 (볼트)" 는 vault-harness.mjs 가 본다.)

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
ws.close();
