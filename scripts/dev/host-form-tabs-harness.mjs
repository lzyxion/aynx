// Headless harness: stub Tauri, open the host form (add · edit) and walk the three tabs
// (접속 · 표시 · 세션), then submit an invalid scrollback from the 접속 tab to see the error
// jump. `keygen-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다
// (docs/log/2026-09-20-host-form-tabs.md).
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx-hostform \
//     --window-size=1100,800 http://localhost:1420/
//   (PAGE_PORT · CDP_PORT 로 격리 서버를 가리킬 수 있다 — 기본 1420 · 9224)
//   node scripts/dev/host-form-tabs-harness.mjs out-prefix [port]
//
// 만드는 것: <prefix>-add.png · <prefix>-edit-connect.png · <prefix>-edit-display.png ·
// <prefix>-edit-session.png · <prefix>-error-jump.png · <prefix>-short.png (창 높이 520) ·
// <prefix>-dropdown.png · <prefix>-combobox.png (앱이 그리는 고르개·자동완성 목록 —
// 네이티브 `<select>`·`<datalist>` 를 대신한 `Dropdown.svelte`·`Combobox.svelte`) ·
// <prefix>-icon-search.png (아이콘 칸에 `deb` 를 쳐서 격자가 데비안 하나로 좁은 판) ·
// <prefix>-tags.png (태그 칸 아래에 칩이 쌓인 판 — `TagInput.svelte`).
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const prefix = process.argv[2] ?? "hostform";
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9224";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(name, Buffer.from(r.result.data, "base64")); return name; };
// 진짜 키를 보낸다 — 고르개의 Escape·Enter 는 `dispatchEvent` 로는 잴 수 없는 것(기본 동작
// 취소 · 포커스 되돌리기)까지 걸린 판단이라 브라우저 입력 통로로 넣는다.
const key = async (k, code) => { for (const type of ["rawKeyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: k, code: k, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code }); };
await send("Page.enable"); await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = [];
  const KEY = 'C:\\\\Users\\\\wl\\\\.ssh\\\\id_ed25519_web01';
  const FW = [{ local_port: 15432, remote_host: 'localhost', remote_port: 5432 }];
  const HOST = { name: 'web-01', host_name: '10.0.0.1', user: 'deploy', port: 22, identity_file: KEY, proxy_jump: null, meta: { tags: ['prod', 'web'], forwards: FW, group: 'prod/web' } };
  // 목록에 **다른 호스트**가 하나 있어야 경유 호스트 고르개에 줄이 선다 (자기 자신은 빠진다).
  // meta.group 은 그룹 칸 자동완성의 후보가 나오는 자리다 (groupPaths — 조상 경로까지).
  // 이 스텁 글자는 템플릿 리터럴 안이라 역따옴표를 쓸 수 없다.
  const JUMP = { name: 'bastion', host_name: '10.0.0.9', user: 'ops', port: 22, identity_file: null, proxy_jump: null, meta: {} };
  const META = { tags: ['prod', 'web'], forwards: FW, color: '#d95a9e', icon: null, group: 'prod/web', scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  window.__fake = { HOST };
  const answers = {
    list_hosts: { hosts: [HOST, JUMP], warnings: [] },
    get_host_meta: META,
    list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    
    session_logs_dir: 'C:\\\\Users\\\\wl\\\\AppData\\\\Local\\\\aynx\\\\logs',
    home_dir: 'C:\\\\Users\\\\wl',
    vault_has_password: true,
    vault_has_passphrase: true,
    vault_list: [{ kind: 'host_password', target: 'web-01' }, { kind: 'key_passphrase', target: KEY }],
    // 2026-09-22: 세션 탭의 다섯째 위임 스위치(볼트의 키 암호구 사용)가 "볼트가 있는가"
    // 하나로 갈린다 — 열린 볼트를 스텁해 재우지 않은 판을 본다
    // (docs/log/2026-09-22-delegation-vault-passphrase.md). 이 스텁 글자에는 역따옴표 금지.
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 2 },
    // 부팅이 묻는 것들 — 없으면 첫 화면이 서지 않는다 (tab-width-harness.mjs 와 같은 묶음)
    load_settings: { app: { status_bar: 'bottom' } },
    list_forwards: [], reap_window_sessions: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    list_operations: { pending: [], recent: [] }, mcp_activity: null,
    list_console_sessions: [],
    delegation_list_targets: [{ alias: 'web-01', client: 'any', connect: true, read: true, propose: false, auto_execute: false, vault_passphrase: false, alias_known: true }],
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB} window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(); return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd)); },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4000);
for (let i = 0; i < 40 && !(await ev(`!!document.querySelector('.col h3')`)); i++) await sleep(500);

// 앱이 올린 것과 **같은 모듈 인스턴스**를 import 한다 (keygen-harness.mjs 의 설명). 폼 상태는
// `app/hosts/form.svelte.ts` 에 산다 — 배럴(`hosts.svelte.ts`)은 앱이 안 불러 리소스 목록에 없을 수 있다.
const load = `(async () => {
  // \`hostForm\`(칸 값)은 옆 파일 \`form-model.svelte.ts\` 에 있어 둘을 한 객체로 합친다
  window.__H = { ...(await import('/src/lib/app/hosts/form-model.svelte.ts')), ...(await import('/src/lib/app/hosts/form.svelte.ts')) };
  return Object.keys(window.__H).length + ' exports';
})()`;
console.log("import hosts module:", await ev(load));

const navState = `(() => {
  const nav = document.querySelector('.host-modal .settings-nav');
  if (!nav) return { nav: false };
  const items = [...nav.querySelectorAll('.nav-item')].map(b => b.textContent.trim() + (b.classList.contains('active') ? '*' : ''));
  const visible = [...document.querySelectorAll('.host-modal section')].map(s => !s.hidden);
  const m = document.querySelector('.host-modal').getBoundingClientRect();
  return { nav: true, items, visible, modal: [Math.round(m.width), Math.round(m.height)] };
})()`;
const clickTab = (label) => ev(`(() => { const b = [...document.querySelectorAll('.host-modal .nav-item')].find(x => x.textContent.trim() === '${label}'); if (!b) return 'no tab'; b.click(); return 'clicked'; })()`);
const idsIn = (n) => ev(`(() => { const s = [...document.querySelectorAll('.host-modal section')][${n}]; return s ? [...s.querySelectorAll('[id]')].map(e => e.id).join(',') : 'none'; })()`);

// ── ① 추가 모드 ─────────────────────────────────────────────────────────────
console.log("openAdd:", await ev(`(window.__H.openAdd(), 'ok')`)); await sleep(500);
console.log("add nav:", JSON.stringify(await ev(navState)));
console.log("add: vault block absent:", await ev(`!document.querySelector('#f-vault-label')`));
console.log("add: focus:", await ev(`document.activeElement?.id ?? null`));
console.log("capture:", await shot(`${prefix}-add.png`));
console.log("closeForm:", await ev(`(window.__H.closeForm(), 'ok')`)); await sleep(300);

// ── ② 수정 모드 — 세 탭 ──────────────────────────────────────────────────────
console.log("openEdit:", await ev(`(async () => { await window.__H.openEdit(window.__fake.HOST); return 'ok'; })()`)); await sleep(600);
console.log("edit nav:", JSON.stringify(await ev(navState)));
console.log("connect ids:", await idsIn(0));
// 에이전트 포워딩 스위치는 접속 탭에 있다 (docs/log/2026-09-23-agent-forwarding.md).
console.log("connect: forward-agent toggle:", await ev(`!![...document.querySelectorAll('.host-modal section')][0]?.querySelector('#f-forward-agent')`));
console.log("display ids:", await idsIn(1));
console.log("session ids:", await idsIn(2));
console.log("edit: vault block present:", await ev(`!!document.querySelector('#f-vault-label')`));
console.log("edit: vault lines:", JSON.stringify(await ev(`[...document.querySelectorAll('.host-modal .vault-line .vault-what')].map(e => e.textContent.trim())`)));
console.log("capture:", await shot(`${prefix}-edit-connect.png`));
console.log("click 표시:", await clickTab("표시")); await sleep(300);
console.log("nav:", JSON.stringify(await ev(navState)));
console.log("capture:", await shot(`${prefix}-edit-display.png`));
console.log("click 세션:", await clickTab("세션")); await sleep(300);
console.log("nav:", JSON.stringify(await ev(navState)));
console.log("forward rows:", await ev(`document.querySelectorAll('.host-modal .fw-preset-row').length`));
// 줄마다 종류 고르개(로컬 -L · 원격 -R · 동적 -D)가 하나씩 — 손잡이 글자를 읽는다 (2026-09-23).
console.log("forward kinds:", await ev(`JSON.stringify([...document.querySelectorAll('.host-modal .fw-preset-row .fw-kind button')].map((b) => b.textContent.trim()))`));
// AI 위임 스위치는 **다섯**이다 (읽기 · 접속 · 볼트의 키 암호구 사용 · 작업안 · 무인 실행).
console.log("delegation toggles:", await ev(`JSON.stringify([...document.querySelectorAll('.host-modal input[id^="f-delegation-"]')].map((e) => e.id))`));
console.log("vault grant:", JSON.stringify(await ev(`(() => {
  const el = document.querySelector('#f-delegation-vault');
  if (!el) return null;
  const row = el.closest('.log-row');
  return { disabled: !!el.disabled, note: row?.querySelector('.note-head')?.textContent.trim() ?? null };
})()`)));
console.log("capture:", await shot(`${prefix}-edit-session.png`));

// ── ③ 오류 → 탭 이동 (접속 탭에서 제출, 스크롤백이 틀림) ────────────────────────
console.log("click 접속:", await clickTab("접속")); await sleep(200);
console.log("set bad scrollback:", await ev(`(window.__H.hostForm.scrollback = 1, 'set')`));
console.log("submit:", await ev(`(document.querySelector('.host-modal form').requestSubmit(), 'submitted')`)); await sleep(400);
console.log("error:", JSON.stringify(await ev(`document.querySelector('.host-modal .error')?.textContent.trim() ?? null`)));
console.log("errorField:", JSON.stringify(await ev(`window.__H.hostFormErrorField()`)));
console.log("nav after error:", JSON.stringify(await ev(navState)));
console.log("focus after error:", await ev(`document.activeElement?.id ?? null`));
console.log("error+actions outside panel:", await ev(`(() => { const e = document.querySelector('.host-modal .error'); const p = document.querySelector('.host-modal .host-panel'); return !!e && !!p && !p.contains(e); })()`));
console.log("capture:", await shot(`${prefix}-error-jump.png`));
// 같은 실수를 두 번 — 다시 접속 탭으로 갔다가 제출하면 또 세션 탭으로 와야 한다.
console.log("click 접속 again:", await clickTab("접속")); await sleep(200);
console.log("submit again:", await ev(`(document.querySelector('.host-modal form').requestSubmit(), 'submitted')`)); await sleep(400);
console.log("nav after 2nd error:", JSON.stringify(await ev(navState)));

// ── ④ 낮은 창 ────────────────────────────────────────────────────────────────
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 520, deviceScaleFactor: 1, mobile: false }); await sleep(300);
console.log("short nav:", JSON.stringify(await ev(navState)));
console.log("short: actions within viewport:", await ev(`(() => { const a = document.querySelector('.host-modal .actions').getBoundingClientRect(); return a.bottom <= window.innerHeight; })()`));
console.log("capture:", await shot(`${prefix}-short.png`));

// ── ⑤ 고르개·자동완성 — 앱이 그리는 목록 (네이티브 select · datalist 를 대신한다) ────
// 폼을 다시 연다: ③ 이 남긴 오류 한 줄과 나쁜 스크롤백을 지워야 "제출되지 않았다" 를 잴 수 있다.
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false }); await sleep(300);
console.log("reopen:", await ev(`(async () => { window.__H.closeForm(); await new Promise(r => setTimeout(r, 100)); await window.__H.openEdit(window.__fake.HOST); return 'ok'; })()`)); await sleep(600);
console.log("no error line:", await ev(`!document.querySelector('.host-modal .error')`));

console.log("open dropdown:", await ev(`(document.getElementById('f-proxy-jump').click(), 'clicked')`)); await sleep(300);
console.log("listbox:", JSON.stringify(await ev(`(() => {
  const l = document.querySelector('[role=listbox]');
  if (!l) return null;
  const r = l.getBoundingClientRect();
  const t = document.getElementById('f-proxy-jump').getBoundingClientRect();
  return { rows: l.querySelectorAll('[role=option]').length, focused: document.activeElement === l,
    inViewport: r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth,
    sameWidth: Math.abs(r.width - t.width) < 1, below: r.top >= t.bottom };
})()`)));
console.log("capture:", await shot(`${prefix}-dropdown.png`));
await key("Escape", 27); await sleep(250);
console.log("dropdown closed:", await ev(`!document.querySelector('[role=listbox]')`));
console.log("form still open:", await ev(`!!document.querySelector('.host-modal')`));
console.log("focus back:", await ev(`document.activeElement?.id ?? null`));

console.log("click 표시:", await clickTab("표시")); await sleep(250);
console.log("type pr:", await ev(`(() => { const i = document.getElementById('f-group'); i.focus(); i.value = 'pr'; i.dispatchEvent(new Event('input', { bubbles: true })); return document.activeElement?.id ?? null; })()`)); await sleep(300);
console.log("suggestions:", JSON.stringify(await ev(`[...document.querySelectorAll('[role=listbox] [role=option]')].map(e => e.textContent.trim())`)));
// `prod/web` 은 **둘째 줄**이다 — 조상 경로(`prod`)도 후보라(`groupPaths`) 첫 줄이 그것이다.
// `↓` 한 번이 하이라이트를 옮긴다 (그림에도 그 줄이 눌린 채로 찍힌다).
await key("ArrowDown", 40); await sleep(200);
console.log("highlighted:", JSON.stringify(await ev(`document.querySelector('[role=listbox] [data-sel]')?.textContent.trim() ?? null`)));
console.log("capture:", await shot(`${prefix}-combobox.png`));
const saveCalls = `window.__calls.filter(c => /^(add_host|edit_host|set_host_meta)$/.test(c[0])).length`;
const before = await ev(saveCalls);
await key("Enter", 13); await sleep(300);
console.log("group value:", JSON.stringify(await ev(`document.getElementById('f-group').value`)));
console.log("combobox closed:", await ev(`!document.querySelector('[role=listbox]')`));
console.log("no submit (calls before/after):", before, await ev(saveCalls));
console.log("no error:", await ev(`!document.querySelector('.host-modal .error')`));

// ── ⑥ 아이콘 칸 = 검색 (표시 탭, ⑤ 의 화면 그대로) ───────────────────────────
// 칸에 값(`svg:debian`)이 아니라 **라벨**(`Debian`)이 보이고, 치는 글자가 격자를 좁힌다.
const typeIcon = (s) =>
  ev(`(() => { const i = document.getElementById('f-icon'); i.focus(); i.value = ${JSON.stringify(s)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`);
const gridState = `(() => {
  const g = document.querySelector('.icon-field .grid');
  const picks = [...g.querySelectorAll('.pick')];
  return { picks: picks.length, hint: picks.filter(b => b.classList.contains('hint')).length,
    on: picks.filter(b => b.classList.contains('on')).length,
    hintTitle: picks.find(b => b.classList.contains('hint'))?.title ?? null,
    nomatch: !!document.querySelector('.icon-field .nomatch') };
})()`;
console.log("type deb:", await typeIcon("deb")); await sleep(300);
console.log("grid:", JSON.stringify(await ev(gridState)));
console.log("icon value (아직 안 바뀐다):", JSON.stringify(await ev(`window.__H.hostForm.icon`)));
console.log("capture:", await shot(`${prefix}-icon-search.png`));
const before6 = await ev(saveCalls);
await key("Enter", 13); await sleep(300);
console.log("picked icon:", JSON.stringify(await ev(`window.__H.hostForm.icon`)));
console.log("input shows label:", JSON.stringify(await ev(`document.getElementById('f-icon').value`)));
console.log("grid after pick:", JSON.stringify(await ev(gridState)));
console.log("no submit (calls before/after):", before6, await ev(saveCalls));
console.log("no error:", await ev(`!document.querySelector('.host-modal .error')`));
// 걸리는 것이 없는 글자 = 이모지 길 — 값이 곧바로 그 글자가 되고 안내 한 줄이 선다.
console.log("type 🐧:", await typeIcon("🐧")); await sleep(300);
console.log("emoji value:", JSON.stringify(await ev(`window.__H.hostForm.icon`)));
console.log("grid (no match):", JSON.stringify(await ev(gridState)));
console.log("type empty:", await typeIcon("")); await sleep(300);
console.log("cleared value:", JSON.stringify(await ev(`window.__H.hostForm.icon`)));
console.log("grid (empty):", JSON.stringify(await ev(gridState)));

// ── ⑦ 태그 = 칩 입력 (같은 표시 탭) ──────────────────────────────────────────
const chips = `[...document.querySelectorAll('.tag-field .chip .label')].map(e => e.textContent.trim())`;
// `$state` 배열은 프록시라 CDP 가 객체로 직렬화한다 — 펼쳐서 진짜 배열로 본다
const tagsOf = `[...window.__H.hostForm.tags]`;
const typeTag = (s) =>
  ev(`(() => { const i = document.getElementById('f-tags'); i.focus(); i.value = ${JSON.stringify(s)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`);
console.log("chips (처음):", JSON.stringify(await ev(chips)));
console.log("type db:", await typeTag("db")); await sleep(200);
const before7 = await ev(saveCalls);
await key("Enter", 13); await sleep(300);
console.log("chips (Enter):", JSON.stringify(await ev(chips)));
console.log("input empty:", await ev(`document.getElementById('f-tags').value === ''`));
console.log("no submit (calls before/after):", before7, await ev(saveCalls));
console.log("no error:", await ev(`!document.querySelector('.host-modal .error')`));
// 쉼표는 그 자리에서 확정한다 — 마지막 쉼표 뒤의 글자는 칸에 남는다 (붙여넣기와 같은 길)
console.log("type 'x, y':", await typeTag("x, y")); await sleep(300);
console.log("chips (쉼표):", JSON.stringify(await ev(chips)));
console.log("input holds:", JSON.stringify(await ev(`document.getElementById('f-tags').value`)));
console.log("capture:", await shot(`${prefix}-tags.png`));
// 칸을 떠나면 확정 — [저장] 을 누르러 간 손이 방금 친 태그를 잃지 않는다
console.log("blur → f-group:", await ev(`(document.getElementById('f-group').focus(), 'moved')`)); await sleep(300);
console.log("chips (blur):", JSON.stringify(await ev(chips)));
console.log("remove web:", await ev(`(() => {
  const chip = [...document.querySelectorAll('.tag-field .chip')].find(c => c.querySelector('.label').textContent.trim() === 'web');
  if (!chip) return 'no chip';
  chip.querySelector('button').click();
  return 'clicked';
})()`)); await sleep(300);
console.log("chips (× web):", JSON.stringify(await ev(chips)));
console.log("hostForm.tags:", JSON.stringify(await ev(tagsOf)));
console.log("focus after ×:", await ev(`document.activeElement?.id ?? null`));
await key("Backspace", 8); await sleep(300);
console.log("chips (Backspace):", JSON.stringify(await ev(chips)));
// **치던 글자를 잃지 않는가** — [저장] 을 진짜 마우스로 누른다. 브라우저는 `mousedown` 에서
// 포커스를 옮기므로 `focusout` 의 확정이 `click` 의 제출보다 **먼저** 온다: 그 한 프레임을
// 벌려서 본다 (누른 채로 한 번, 떼고 한 번).
console.log("type pending:", await typeTag("pending")); await sleep(200);
const saveBox = await ev(`(() => { const b = document.querySelector('.host-modal .actions .primary'); const r = b.getBoundingClientRect(); return [Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2)]; })()`);
const before8 = await ev(saveCalls);
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: saveBox[0], y: saveBox[1], button: "left", clickCount: 1 });
console.log("mousedown → chips:", JSON.stringify(await ev(chips)), "| tags:", JSON.stringify(await ev(tagsOf)), "| input:", JSON.stringify(await ev(`document.getElementById('f-tags').value`)));
console.log("mousedown → 아직 제출 전:", before8, await ev(saveCalls));
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: saveBox[0], y: saveBox[1], button: "left", clickCount: 1 }); await sleep(400);
console.log("click → 제출됨:", await ev(saveCalls), "| 보낸 host:", JSON.stringify(await ev(`(() => { const c = window.__calls.filter(c => c[0] === 'edit_host').pop(); return c ? c[1].host.name : null; })()`)));

const exc = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0]).filter((s) => !/stub:/.test(s)).slice(0, 5);
if (exc.length) console.log("EXC", exc);
ws.close();
