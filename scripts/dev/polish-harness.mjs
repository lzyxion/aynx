// Headless harness: 스니펫 자리표시자의 **기본값·설명**과 tmux 팝오버의 **새로고침**을 본다
// (docs/log/2026-09-17-polish-snippets-tmux-errors.md). `blocks-harness.mjs` 의 사본 —
// 스텁 표와 시나리오만 다르다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx \
//     --window-size=1100,800 http://localhost:1420/
//   node scripts/dev/polish-harness.mjs out-prefix [port]
//
// 만드는 것: <prefix>-snippet-default.png · <prefix>-tmux-refresh.png
//
// 포트를 인자로 받는 이유: 9224 한 자리를 여럿이 쓰면 서로의 스텁 위로 `Page.reload` 를
// 걸어 둘 다 엉뚱한 화면을 본다. 혼자 돌 때는 인자를 생략하면 된다.
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const prefix = process.argv[2] ?? "polish";
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
let bad = 0;
const want = (label, got, expected) => { const ok = JSON.stringify(got) === JSON.stringify(expected); if (!ok) bad++; console.log(`${ok ? "OK  " : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(expected)})`}`); };
await send("Page.enable"); await send("Runtime.enable");

// 스니펫 하나 — **기본값과 설명이 둘 다 달린** 자리표시자다 (이 판의 문법).
const SNIPPET = { id: "S1", name: "디스크 보기", command: "df -h {{경로=/var|어느 경로를 볼지}}", scope: { kind: "all" }, enter: true };

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;
  // tmux 목록은 **부를 때마다 다른 답**을 준다 — 새로고침이 실제로 다시 물었는지 보려면
  // 두 번째 답이 첫 번째와 달라야 한다 (호출 횟수만 세면 화면이 바뀌었는지는 모른다).
  let tmuxCalls = 0;
  const TMUX = [
    [{ name: 'aynx-1', windows: 2, attached: 1, created: Math.floor(Date.now()/1000) - 3600 }],
    [{ name: 'aynx-1', windows: 2, attached: 1, created: Math.floor(Date.now()/1000) - 3600 },
     { name: '배포', windows: 1, attached: 0, created: Math.floor(Date.now()/1000) - 120 }],
  ];
  const answers = {
    list_hosts: { hosts: [{ name: 'web-01', host_name: '10.0.0.1', user: 'deploy', port: 22, meta: { tags: [], forwards: [], tmux: true } }], warnings: [] },
    list_shells: [{ id: 'pwsh', label: 'PowerShell 7' }],
    list_group_meta: {}, list_host_meta: {},
    
    load_snippets: JSON.stringify({ version: 1, snippets: [${JSON.stringify(SNIPPET)}] }),
    save_snippets: null,
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_input: null, send_keepalive: 12,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      // 모양이 중요하다 — 숫자 하나를 돌려주면 세션 표에 id 가 undefined 로 박혀
      // 타일은 살아 있는데 "세션이 아직 연결되지 않았습니다" 가 뜬다 (docs/internal/next.md 의 스텁 규칙).
      // 세션 코어 임대(2026-10-08 — session/open.ts 의 LocalOpened.lease)도 싣는다. 없으면 손잡이 밖의 쓰기(스니펫 보내기 ·
      // writeSessionById)가 "no such session" 으로 던진다 — 진짜 백엔드는 늘 싣는다.
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh', lease: { stream: args?.streamId ?? ('s' + id), sessionEpoch: 1, leaseEpoch: 1 } }); }
      // tmux 호스트라 백엔드가 세션 이름을 실어 준다 — 타일이 그것을 PaneSpec.tmux 에 적는다.
      if (cmd === 'open_ssh_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, tmux: 'aynx-1' }); }
      if (cmd === 'ssh_tmux_list') { const at = Math.min(tmuxCalls++, TMUX.length - 1); return Promise.resolve(TMUX[at]); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  // 칩이 설 때도 한 번 묻는다(tmux-sessions.svelte.ts) — 팝오버 쪽 단언은 __tmuxReset 뒤부터 센다.
  window.__tmuxBase = 0;
  window.__tmuxCalls = () => window.__calls.filter(c => c[0] === 'ssh_tmux_list').length - window.__tmuxBase;
  window.__tmuxReset = () => { tmuxCalls = 0; window.__tmuxBase += window.__tmuxCalls(); };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);

// 앱이 이미 올린 것과 **같은 모듈 인스턴스**를 다시 import 한다 (`?t=` 질의까지 그대로 —
// 손으로 URL 을 적으면 `$state` 를 공유하지 않는 사본이 생긴다. keygen-harness 와 같은 처방).
const importer = (path, into) => `(async () => {
  const url = performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('${path}'));
  if (!url) return 'not loaded: ${path}';
  window.${into} = await import(url);
  return Object.keys(window.${into}).length + ' exports';
})()`;
console.log("import overlays:", await ev(importer("/src/lib/app/overlays.svelte.ts", "__O")));
console.log("import hosts:", await ev(importer("/src/lib/app/hosts.svelte.ts", "__H")));

// ── ① 스니펫: `;` 팔레트 → 기본값이 채워진 칸 + 설명 한 줄 ────────────────────
const key = async (code, modifiers, k) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : code === "Escape" ? 27 : code === "Enter" ? 13 : 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(200); };
await key("KeyN", 10, "N"); await sleep(1200); // Ctrl+Shift+N — 로컬 터미널 타일 하나
console.log("local sessions:", await ev(`JSON.stringify(Object.keys(window.__chan))`), "xterm:", await ev(`document.querySelectorAll('.xterm').length`));

console.log("openSnippetPalette:", await ev(`(() => { window.__O.openSnippetPalette(); return 'ok'; })()`));
await sleep(600);
want("팔레트 씨앗이 `;`", await ev(`document.querySelector('.palette input')?.value ?? null`), ";");
const rows = await ev(`document.querySelectorAll('.palette [data-row]').length`);
console.log("palette rows:", rows);
console.log("click snippet row:", await ev(`(() => { const r = document.querySelector('.palette [data-row]'); if (!r) return 'no row'; r.click(); return 'clicked'; })()`));
await sleep(600);

// 묻는 모달 — 칸이 **기본값으로 채워진 채** 열리고 설명이 그 아래 붙는다.
want("칸 라벨", await ev(`document.querySelector('label[for="snippet-ph-0"]')?.textContent?.trim() ?? null`), "경로");
want("기본값이 미리 채워졌다", await ev(`document.querySelector('#snippet-ph-0')?.value ?? null`), "/var");
want("설명이 칸 아래에 뜬다", await ev(`document.querySelector('#snippet-ph-help-0')?.textContent?.trim() ?? null`), "어느 경로를 볼지");
want("설명이 입력과 묶여 있다 (aria-describedby)", await ev(`document.querySelector('#snippet-ph-0')?.getAttribute('aria-describedby') ?? null`), "snippet-ph-help-0");
console.log("capture:", await shot(`${prefix}-snippet-default.png`));

// 그대로 [넣기] — 사람이 아무것도 고치지 않아도 기본값이 나간다.
console.log("submit:", await ev(`(() => { document.querySelector('#snippet-ph-0').form.requestSubmit(); return 'submitted'; })()`));
await sleep(600);
console.log("notice:", await ev(`document.querySelector('.notice, .toast, [class*=notice]')?.textContent?.trim() ?? null`));
console.log("calls tail:", await ev(`JSON.stringify(window.__calls.slice(-6).map(c => c[0]))`));
const wrote = await ev(`(() => { const c = window.__calls.filter(x => x[0] === 'write_session' || x[0] === 'write_ssh'); return c.length ? JSON.stringify([c[c.length-1][0], c[c.length-1][1].data]) : null; })()`);
console.log("write call:", wrote);
want("터미널로 나간 명령", JSON.parse(wrote ?? "null")?.[1]?.replace(/\r$/, "") ?? null, "df -h /var");
want("나간 통로", JSON.parse(wrote ?? "null")?.[0] ?? null, "write_session");

// ── ② tmux 팝오버: 새로고침이 다시 묻고 목록이 자란다 ──────────────────────────
// 모듈을 **다시** 집어 든다. 사용자의 `tauri dev` 가 살아 있는 서버라 다른 편집이 HMR 로
// 페이지를 갈아 끼울 수 있고, 그러면 앞서 담아 둔 `window.__H` 가 사라진다.
console.log("re-import hosts:", await ev(importer("/src/lib/app/hosts.svelte.ts", "__H")));
console.log("connect web-01:", await ev(`(() => { window.__H.connect({ name: 'web-01', meta: { tags: [], forwards: [], tmux: true } }); return 'ok'; })()`));
await sleep(2500);
console.log("ssh calls:", await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'open_ssh_session').map(c => c[1]?.alias))`));
console.log("panes:", await ev(`document.querySelectorAll('.xterm').length`), "headers:", await ev(`document.querySelectorAll('[data-tile-menu-btn], .tile-head, header').length`));
console.log("banners:", await ev(`[...document.querySelectorAll('.banner, .err, .bad')].map(e => e.textContent.trim()).slice(0,3).join(' | ')`));
want("tmux 칩이 머리줄에 있다", await ev(`document.querySelectorAll('[data-tmux-menu-btn]').length > 0`), true);
want("칩에 세션 이름이 있다", await ev(`document.querySelector('[data-tmux-menu-btn]')?.textContent.includes('aynx-1') ?? false`), true);
want("칩이 설 때 ssh_tmux_list 를 한 번 물었다", await ev(`window.__tmuxCalls()`), 1);
await ev(`window.__tmuxReset()`);
console.log("open popover:", await ev(`(() => { const b = document.querySelector('[data-tmux-menu-btn]'); if (!b) return 'no chip'; b.click(); return 'clicked'; })()`));
await sleep(900);
want("팝오버가 떴다", await ev(`!!document.querySelector('.tmuxmenu')`), true);
want("처음 목록은 한 줄", await ev(`document.querySelectorAll('.tmuxmenu .row').length`), 1);
want("ssh_tmux_list 를 한 번 물었다", await ev(`window.__tmuxCalls()`), 1);
want("새로고침 버튼이 있다", await ev(`!!document.querySelector('[data-tmux-refresh]')`), true);

console.log("click refresh:", await ev(`(() => { const b = document.querySelector('[data-tmux-refresh]'); if (!b) return 'no button'; b.click(); return 'clicked'; })()`));
await sleep(900);
want("ssh_tmux_list 를 두 번 물었다", await ev(`window.__tmuxCalls()`), 2);
want("목록이 두 줄로 자랐다", await ev(`document.querySelectorAll('.tmuxmenu .row').length`), 2);
want("새 세션 이름이 목록에 있다", await ev(`[...document.querySelectorAll('.tmuxmenu .name')].some(e => e.textContent.trim() === '배포')`), true);
console.log("capture:", await shot(`${prefix}-tmux-refresh.png`));

// 다시 열면 다시 읽는다 — 상자가 열 때마다 새로 붙기 때문이다(새로고침 버튼과 같은 몸통).
console.log("close popover:", await ev(`(() => { document.querySelector('[data-tmux-menu-btn]').click(); return 'toggled'; })()`));
await sleep(400);
want("닫혔다", await ev(`!!document.querySelector('.tmuxmenu')`), false);
console.log("reopen popover:", await ev(`(() => { document.querySelector('[data-tmux-menu-btn]').click(); return 'toggled'; })()`));
await sleep(800);
want("다시 열면 한 번 더 묻는다", await ev(`window.__tmuxCalls()`), 3);

const exc = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0]).filter((s) => !/stub:/.test(s)).slice(0, 6);
if (exc.length) console.log("EXC", exc);
console.log(bad === 0 ? "\nALL OK" : `\n${bad} FAILED`);
ws.close();

process.exit(bad === 0 ? 0 : 1);
