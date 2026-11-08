// Headless harness: stub Tauri, open the host form for `web-01`, drive "새 키 만들기…" and the
// install key picker. `blocks-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx \
//     --window-size=1100,800 http://localhost:1420/
//   node scripts/dev/keygen-harness.mjs out-prefix
//
// 만드는 것: <prefix>-modal.png (새 키 만들기 모달) · <prefix>-groups.png (설치 고르개).
//
// **암호구는 로그에 찍지 않는다** — 단언은 "보냈는가"(typeof/length)만 보고 값은 보지 않는다.
// 이 파일이 지키는 규칙이 곧 앱이 지키는 규칙이다 (docs/log/2026-09-17-keygen.md).
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const prefix = process.argv[2] ?? "keygen";
const list = await (await fetch(`http://127.0.0.1:${process.argv[3] ?? process.env.CDP_PORT ?? "9224"}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(name, Buffer.from(r.result.data, "base64")); return name; };
await send("Page.enable"); await send("Runtime.enable");

const FAKE_PRIVATE = "C:\\\\Users\\\\wl\\\\.ssh\\\\id_ed25519_web01";
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = [];
  const HOST = { name: 'web-01', host_name: '10.0.0.1', user: 'deploy', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [] } };
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const AGENT_KEY = { fingerprint: 'SHA256:AGENTaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', keyType: 'ssh-ed25519', comment: 'wl@box', publicLine: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIAGENTkeybody wl@box' };
  const FILE_KEY = { privatePath: 'C:\\\\Users\\\\wl\\\\.ssh\\\\id_rsa_legacy', publicPath: 'C:\\\\Users\\\\wl\\\\.ssh\\\\id_rsa_legacy.pub', fingerprint: 'SHA256:FILEbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', comment: 'old@laptop', kind: 'ssh-rsa', publicLine: 'ssh-rsa AAAAB3NzaC1yc2EFILEkeybody old@laptop' };
  const MADE = { privatePath: '${FAKE_PRIVATE}', publicPath: '${FAKE_PRIVATE}.pub', fingerprint: 'SHA256:NEWccccccccccccccccccccccccccccccccc', publicKeyLine: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAANEWkeybody wl@box' };
  const REPORT = { added: true, alreadyPresent: false, keyAuthOk: false, message: 'web-01 의 ~/.ssh/authorized_keys 에 키를 등록했습니다 — 이 키는 ssh-agent 에 없어 접속 확인은 건너뛰었습니다.' };
  window.__fake = { HOST, MADE, FILE_KEY, AGENT_KEY };
  const answers = {
    list_hosts: { hosts: [HOST], warnings: [] },
    get_host_meta: META,
    list_group_meta: {}, list_host_meta: {},
    list_shells: [{ id: 'pwsh', label: 'PowerShell 7' }],
    
    session_logs_dir: 'C:\\\\Users\\\\wl\\\\AppData\\\\Local\\\\aynx\\\\logs',
    list_agent_public_keys: [AGENT_KEY],
    list_ssh_key_files: [FILE_KEY],
    generate_ssh_key: MADE,
    install_public_key: REPORT,
    install_public_key_line: REPORT,
    home_dir: 'C:\\\\Users\\\\wl',
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
await send("Page.reload", { ignoreCache: true }); await sleep(4000);

// Vite dev 는 모듈을 URL 로 서빙한다 — 앱이 이미 올린 것과 **같은 인스턴스**를 다시 import 해
// 모듈의 export 를 직접 부른다 (독을 열고 우클릭 메뉴를 더듬는 것보다 짧고 덜 부서진다).
//
// **URL 을 손으로 적으면 안 된다.** Vite 의 HMR 은 갱신된 모듈에 `?t=<시각>` 을 붙이는데,
// 질의가 다르면 브라우저에게는 **다른 모듈**이라 `$state` 를 공유하지 않는 사본이 하나 더
// 생긴다 (화면은 그대로인데 함수만 먹는 것처럼 보인다). 그래서 실제로 받아 간 URL 을
// performance 항목에서 찾아 그대로 쓴다.
const load = `(async () => {
  const url = performance.getEntriesByType('resource').map(r => r.name)
    .find(n => n.includes('/src/lib/app/hosts.svelte.ts'));
  if (!url) return 'module not loaded yet';
  window.__H = await import(url);
  return Object.keys(window.__H).length + ' exports';
})()`;
console.log("import hosts module:", await ev(load));

// ── ① 호스트 폼 (web-01 수정) ───────────────────────────────────────────────
console.log("openEdit:", await ev(`(async () => { await window.__H.openEdit(window.__fake.HOST); return 'ok'; })()`));
await sleep(500);
console.log("form mode:", await ev(`window.__H.hostFormMode()`), "visible:", await ev(`window.__H.hostFormVisible()`));
console.log("overlays:", await ev(`[...document.querySelectorAll('.overlay .modal')].map(e => e.className || 'modal').join('|')`));
console.log("form open:", await ev(`!!document.querySelector('#f-identity')`));
console.log("identity before:", JSON.stringify(await ev(`document.querySelector('#f-identity')?.value ?? null`)));

// ── ② "새 키 만들기…" ───────────────────────────────────────────────────────
const clickNew = `(() => { const b = [...document.querySelectorAll('button.browse')].find(x => x.textContent.includes('새 키 만들기')); if (!b) return 'no button'; b.click(); return 'clicked'; })()`;
console.log("click 새 키 만들기…:", await ev(clickNew));
await sleep(400);
console.log("keygen modal:", await ev(`!!document.querySelector('#kg-name')`));
console.log("suggested name:", JSON.stringify(await ev(`document.querySelector('#kg-name')?.value ?? null`)));
console.log("suggested comment:", JSON.stringify(await ev(`document.querySelector('#kg-comment')?.value ?? null`)));

// 칸을 채운다 (svelte 의 bind: 가 듣도록 input 이벤트를 함께 쏜다).
// 종류 고르개는 앱의 Dropdown(10-18) — 펴서 rsa 를 골랐다가 ed25519 로 되돌린다(열기 · 고르기 · 닫힘 확인)
console.log("kind dropdown:", await ev(`(async () => { const w = (ms) => new Promise((r) => setTimeout(r, ms)); const out = []; for (const v of ['rsa', 'ed25519']) { document.querySelector('#kg-kind').click(); await w(80); const row = document.querySelector('#kg-kind-listbox [data-value="' + v + '"]'); if (!row) { out.push(v + ':no-list'); continue; } row.click(); await w(80); out.push(v + ':' + document.querySelector('#kg-kind').getAttribute('aria-expanded') + ':' + document.querySelector('#kg-kind .cur-text').textContent.trim()); } return out.join(' / '); })()`));
const fill = `(() => {
  const set = (sel, v) => { const el = document.querySelector(sel); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('#kg-name', 'id_ed25519_web01');
  set('#kg-pass', 'harness-passphrase');
  set('#kg-pass2', 'harness-passphrase');
  set('#kg-comment', 'web-01');
  return 'filled';
})()`;
console.log("fill:", await ev(fill));
await sleep(200);
console.log("capture:", await shot(`${prefix}-modal.png`));

// 확인 칸이 어긋나면 프런트가 먼저 막는다 (백엔드로 가지 않는 유일한 규칙).
const mismatch = `(() => { const el = document.querySelector('#kg-pass2'); el.value = 'different'; el.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#kg-name').form.requestSubmit(); return 'submitted'; })()`;
console.log("mismatch submit:", await ev(mismatch)); await sleep(300);
console.log("mismatch error shown:", await ev(`!!document.querySelector('.modal .error')`));
console.log("generate_ssh_key calls after mismatch (want 0):", await ev(`window.__calls.filter(c => c[0] === 'generate_ssh_key').length`));

// 제대로 채우고 제출.
console.log("fix + submit:", await ev(`(() => { const el = document.querySelector('#kg-pass2'); el.value = 'harness-passphrase'; el.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#kg-name').form.requestSubmit(); return 'submitted'; })()`));
await sleep(700);

// 단언 — **암호구의 값은 찍지 않는다**. 실렸는지(타입·길이)만 본다.
const argCheck = `(() => {
  const c = window.__calls.filter(x => x[0] === 'generate_ssh_key').pop();
  if (!c) return { called: false };
  const a = c[1] ?? {};
  return { called: true, name: a.name, kind: a.kind, comment: a.comment,
           passphraseSent: typeof a.passphrase === 'string' && a.passphrase.length > 0,
           argKeys: Object.keys(a).sort() };
})()`;
console.log("generate_ssh_key args:", JSON.stringify(await ev(argCheck)));
console.log("keygen modal closed:", await ev(`!document.querySelector('#kg-name')`));
console.log("identity after:", JSON.stringify(await ev(`document.querySelector('#f-identity')?.value ?? null`)));
console.log("toast text:", JSON.stringify(await ev(`[...document.querySelectorAll('[class*=toast] *')].map(e => e.textContent).find(s => s && s.includes('키를 만들었습니다')) ?? null`)));
console.log("toast action label:", JSON.stringify(await ev(`[...document.querySelectorAll('button')].map(b => b.textContent.trim()).find(s => s.includes('이 호스트에 공개키 설치')) ?? null`)));
// 암호구가 화면 어디에도 남지 않았다 (칸은 지워졌고 DOM 어디에도 없다).
console.log("passphrase gone from DOM:", await ev(`!document.body.innerHTML.includes('harness-passphrase')`));

// ── ③ 설치 고르개 — 두 무리 + "새 키 만들기…" ──────────────────────────────
console.log("closeForm:", await ev(`(window.__H.closeForm(), 'ok')`)); await sleep(300);
console.log("installKeyFor:", await ev(`(window.__H.installKeyFor(window.__fake.HOST), 'started')`));
await sleep(800);
const groups = `(() => {
  const heads = [...document.querySelectorAll('.keygroup')].map(e => e.textContent.trim());
  const rows = [...document.querySelectorAll('.keyitem')].map(e => e.textContent.replace(/\\s+/g, ' ').trim());
  return { heads, rows, hasNewRow: !!document.querySelector('.keyitem.makenew') };
})()`;
console.log("picker:", JSON.stringify(await ev(groups)));
console.log("capture:", await shot(`${prefix}-groups.png`));

const exc = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0]).filter((s) => !/stub:/.test(s)).slice(0, 5);
if (exc.length) console.log("EXC", exc);
ws.close();
