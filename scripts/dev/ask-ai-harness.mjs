// 헤드리스 검증 — **명령 블록을 AI 타일에 넘기기** (docs/log/2026-09-28-ask-ai-block.md).
//
// `blocks-harness.mjs` 의 스텁(가짜 로컬 세션 + Channel 콜백으로 OSC 133 바이트 먹이기)에 `write_session` 기록 ·
// `agent-signal` 방송(`window.__emit`) · AI CLI 감지 스텁을 더했다. AI 타일은 `newAiPane`(autorun) 으로 연다 —
// 그러면 타일 신원이 곧 AI 다. "CLI 가 떴다" 는 그 타일 세션에 A·B·C 를 먹여(에이전트 명령 시작) 흉내 내고,
// 괄호 붙여넣기는 `ESC[?2004h`, 입력 대기는 훅 신호 `stop`, 답 쓰는 중은 훅 신호 `start` 로 세운다.
//
// 시나리오: ① 블록 없는 타일(단축키 → 안내 · 메뉴 줄 없음) · ② 실패 줄 호버 → 단추 · 같은 줄 시간 표식 가림 ·
// ③ AI 타일 없음 → 상자(새로 열기 둘 · 기본 · 공유 꺼짐 한 줄) · Esc → 포커스가 원본으로 · ④ 새 타일 20초 시한
// (넣지 않고 알림) · ⑤ 새 타일 준비(괄호 붙여넣기 + 3초 조용함) 뒤 붙여 넣기(그 전엔 쓰기 없음 · 괄호 붙여넣기 · Enter 없음 · 포커스 · 빛)
// · ⑥ AI 타일 하나 → 단축키로 곧장(마지막 끝난 블록 · 40줄 상한 · "(앞 N줄 생략)") · ⑦ 괄호 붙여넣기 꺼진 타일 →
// 넣지 않음 · ⑧ 여럿 → 상자 순서 · 골라진 줄(마지막에 씀) · 답 쓰는 중 · ↑↓ · ⑨ 다른 탭 줄 → 탭 전환 ·
// ⑩ 우클릭 메뉴(성공 블록 · 중립 문장 · menu-runner) · ⑪ 콘솔 오류 0.
//
// usage (격리 서버 — 1420/9222 는 개발 앱의 것이라 건드리지 않는다):
//   npx vite --port 1444 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9277 --user-data-dir=%TEMP%/edge-aynx-askai \
//     --window-size=1280,860 http://localhost:1444/
//   PAGE_PORT=1444 node scripts/dev/ask-ai-harness.mjs <outdir> 9277
//     → <outdir>/ask-ai-hover.png · -picker-empty · -new-tile · -direct · -picker-many · -menu
import { waitBoot, waitToastsGone } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9277"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1444";
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${PAGE_PORT}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
const errorDetails = []; // 콘솔 오류의 전체 글(스택 포함) — 실패할 때만 찍는다
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
    return;
  }
  if (d.method === "Runtime.exceptionThrown") {
    const x = d.params.exceptionDetails;
    const s = (x.exception?.description ?? x.text ?? "").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("EXC " + s);
  }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    const s = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0];
    if (!/stub:/.test(s)) { errors.push("console.error " + s); errorDetails.push(d.params.args.map((a) => a.value ?? a.description ?? "").join(" ")); }
  }
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
const shot = async (name) => {
  const p = path.join(outdir, name);
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) {
    fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
    console.log("PNG " + path.resolve(p));
  }
};
const key = async (code, keyName, modifiers = 0) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38 }[code] ?? 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });

let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};

/** 앱이 실제로 쓰는 모듈 인스턴스 */
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = []; window.__writes = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextSession = 100;
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_ai_clis: [{id:'claude',name:'Claude Code',command:'claude',installed:true},{id:'codex',name:'Codex',command:'codex',installed:true}],
    mcp_status: { clis: [{id:'claude',name:'Claude Code',installed:true,registered:true},{id:'codex',name:'Codex',installed:true,registered:true}] },
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, send_input: null,
    reap_window_sessions: null, session_log_path: null, list_snippets: [], list_forwards: [],
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, args }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'write_session') { window.__writes.push([args.id, args.data]); return Promise.resolve(null); }
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom' } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; const buf = new TextEncoder().encode(text).buffer; cb({ message: buf, index: c.idx++ }); return 'ok'; };
  try { localStorage.clear(); } catch {}
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
// `Runtime.enable` 은 스텁 없이 먼저 뜬 페이지(러너의 첫 적재)의 콘솔 기록까지 되풀이해 준다 —
// 그 판의 `getCurrentWindow` 오류(`__TAURI_INTERNALS__` 없음)는 이 판의 것이 아니다.
errors.length = 0;
errorDetails.length = 0;

const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const TA = importApp("lib/term-actions.ts");
const BH = importApp("lib/block-history.ts");
const ASK = importApp("app/ask-ai.svelte.ts");

const ESC = "\x1b", BEL = "\x07";
const block = (cmd, out, exit, cwd = "/home/u/app") =>
  `${ESC}]7;file://dev${cwd}${BEL}${ESC}]133;A${BEL}u@dev:~/app$ ${ESC}]133;B${BEL}${cmd}\r\n${ESC}]133;C${BEL}${out}${ESC}]133;D;${exit}${BEL}`;
const prompt = `${ESC}]133;A${BEL}u@dev:~/app$ ${ESC}]133;B${BEL}`;

const panesNow = async () =>
  JSON.parse(await ev(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().map((t) => ({ tab: t.id, panes: s.listPanes(t.root).map((p) => ({ id: p.id, autorun: p.autorun ?? null, stream: p.historyStreamId ?? null, sid: ss.sessionOf(p.id) })) }))); })()`));
const activeTab = async () => ev(`(async () => (await ${W}).activeTabId())()`);
const focusedPaneId = async () => ev(`(async () => (await ${W}).focusedPane()?.id ?? null)()`);
const domFocusPane = async () => ev(`document.activeElement?.closest('[data-pane]')?.dataset.pane ?? null`);
const writesTo = async (sid) => JSON.parse(await ev(`JSON.stringify(window.__writes.filter((w) => w[0] === ${sid}).map((w) => w[1]))`));
const toasts = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.toast')].map((e) => e.textContent.trim()))`));
const focusTerm = async (paneId) => {
  await ev(`(async () => { const w = await ${W}; const t = w.tabOfPane(${JSON.stringify(paneId)}); w.focusTile(t.id, ${JSON.stringify(paneId)}); })()`);
  await sleep(300);
  await ev(`(async () => (await ${TA}).termActionsOf(${JSON.stringify(paneId)})?.focus())()`);
  await sleep(200);
};
const readPicker = async () =>
  JSON.parse(await ev(`(() => { const p = document.querySelector('[data-ask-picker]'); if (!p) return 'null'; return JSON.stringify({
    head: p.querySelector('.head b').textContent.trim(),
    sum: p.querySelector('.head .sum').textContent.trim(),
    note: !!p.querySelector('[data-ask-private]'),
    groups: [...p.querySelectorAll('.grp')].map((g) => g.textContent.trim()),
    // 'side' = 사이드 채팅 줄(2026-10-24 v2 5단계 — 열린 AI 타일 줄 뒤 · 새로 열기 줄 앞, ask-ai.ts 의 withSideChatRow)
    rows: [...p.querySelectorAll('.opt')].map((o) => (o.dataset.askRow ? 'tile:' + o.dataset.group + ':' + o.dataset.askRow : o.hasAttribute('data-ask-side-chat') ? 'side' : 'new:' + o.dataset.askNew)
      + (o.querySelector('[data-busy]') ? ':busy' : '') + (o.querySelector('[data-last]') ? ':last' : '') + (o.querySelector('.meta:not([data-last])') ? ':' + o.querySelector('.meta:not([data-last])').textContent.trim() : '')),
    sel: [...p.querySelectorAll('.opt')].findIndex((o) => o.classList.contains('sel')),
    focused: p.contains(document.activeElement),
  }); })()`));
/** AI 타일 세션을 "CLI 가 떴다" 로 — 셸 프롬프트 · 명령 시작(C) · 괄호 붙여넣기 · TUI 그림 */
// 준비 판정(`readyForPaste`)은 "CLI 출력이 `C` **뒤에** 있다"(lastOutputAt > commandStartedAt)를 본다 — 같은 덩어리로
// 먹이면 두 시각이 같은 ms 라 영영 준비가 안 된다. 게다가 `Terminal` 은 출력 시각을 **500ms 에 한 번**만 올린다
// (`reportActivity` 스로틀) — 진짜 CLI 처럼 `C` 와 그림을 그보다 길게 떨어진 두 덩어리로 먹인다.
const bootAi = async (sid, name, bracket = true) => {
  await ev(`window.__feed(${sid}, ${JSON.stringify(`${prompt}${name}\r\n${ESC}]133;C${BEL}`)})`);
  await sleep(650);
  await ev(`window.__feed(${sid}, ${JSON.stringify(`${bracket ? `${ESC}[?2004h` : ""}╭─ ${name} ─╮\r\n│ > │\r\n╰───╯\r\n`)})`);
  await sleep(150);
};
const hook = async (stream, event) => ev(fakeAgentSignal({ stream, event }));

// ── 셸 타일 하나 ───────────────────────────────────────────────────────────
// 다시 뜬 페이지의 모듈이 늦게 붙는 판이 있다(첫 판 vite 변환 — "module not loaded yet" 이면 panesNow 의
// JSON.parse 가 죽었다). 고정 대기 대신 앱 모듈이 잡히고 셸 타일의 세션이 설 때까지 본다(상한 15초).
for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${SESS}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
await key("KeyN", "N", 10);
let tabs = null;
let shell = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  try { tabs = await panesNow(); } catch { continue; }
  shell = tabs[0]?.panes.find((p) => !p.autorun && p.sid != null) ?? null;
  if (shell) break;
}
console.log("shell tile:", JSON.stringify(shell));
await ev(`window.__feed(${shell.sid}, ${JSON.stringify("PS C:\\\\> ")})`);
await focusTerm(shell.id);

// ① 블록 없는 타일 — 단축키는 짧은 안내, 우클릭 메뉴에 줄이 없다
await key("KeyX", "X", 10);
await sleep(300);
check("① no block → note", (await toasts()).some((s) => s.includes("넘길 블록이 없습니다")), true);
check("① no block → picker none", await ev(`!!document.querySelector('[data-ask-picker]')`), false);
/** 셸 타일을 스크롤백 맨 위로 — 진짜 휠(가상 스크롤은 scrollTop 대입을 되돌린다) */
const scrollTop = async () => {
  // 명령 점프(`CommandApi.jump`)로 첫 프롬프트까지 — 앱이 스스로 `scrollToLine` 한다
  await ev(`(async () => { const si = await ${importApp("lib/shell-integration.ts")}; const c = si.commandsOf(${JSON.stringify(shell.id)}); for (let i = 0; i < 10; i++) if (!c.jump(-1)) break; })()`);
  await sleep(400);
};
const rowY = async (text) =>
  ev(`(() => { const r = [...document.querySelectorAll('[data-pane="${shell.id}"] .xterm-rows > div')].find((d) => d.textContent.includes(${JSON.stringify(text)})); if (!r) return null; const b = r.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + 60), y: Math.round(b.top + b.height / 2) }); })()`);
{
  const at = JSON.parse(await rowY("PS C:"));
  await ev(`document.elementFromPoint(${at.x}, ${at.y}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: ${at.x}, clientY: ${at.y} }))`);
  await sleep(300);
  check("① no block → menu row absent", await ev(`[...document.querySelectorAll('.tilemenu *')].some((e) => e.textContent.includes('AI 에게 묻기'))`), false);
  await key("Escape", "Escape");
}

// ── 블록 넷: 성공 · 실패(출력 11줄) · 출력 없는 실패(1.2초 — 시간 표식이 프롬프트 줄에 선다) · 긴 실패(100줄) ──
const build = [
  "> app@1.8.3 build", "> tsc -p . && vite build", "", "src/routes/api.ts:41:18 - error TS2339:",
  "  Property 'userId' does not exist on type 'Session'.", "", "41   const id = session.userId;", "                    ~~~~~~",
  "Found 1 error in src/routes/api.ts:41",
].map((l) => l + "\r\n").join("");
await ev(`window.__feed(${shell.sid}, ${JSON.stringify("\r\n" + block("git pull", "Already up to date.\r\n", 0) + block("npm run build", build, 2))})`);
await ev(`window.__feed(${shell.sid}, ${JSON.stringify(`${ESC}]133;A${BEL}u@dev:~/app$ ${ESC}]133;B${BEL}false\r\n${ESC}]133;C${BEL}`)})`);
await sleep(1300);
await ev(`window.__feed(${shell.sid}, ${JSON.stringify(`${ESC}]133;D;1${BEL}`)})`);
const long = Array.from({ length: 100 }, (_, i) => `make: step ${i + 1}\r\n`).join("");
await ev(`window.__feed(${shell.sid}, ${JSON.stringify(block("make all", long, 2) + prompt)})`);
await sleep(500);
// 긴 출력이 화면을 밀어 올렸다 — 위의 블록들이 보이게 맨 위로
await scrollTop();
await sleep(400);

// 부팅 토스트(오른쪽 위)가 실패 줄 단추를 가리지 않게 — 포인터가 오르면 줄지 않는다(`boot-wait.mjs`)
await waitToastsGone(ev);

// ② 실패 줄 호버 → 단추, 같은 줄의 시간 표식은 가린다
const blocks = JSON.parse(await ev(`(async () => JSON.stringify((await ${BH}).blocksOf(${JSON.stringify(shell.id)}).map((b) => ({ id: b.id, cmd: b.commandLine, exit: b.exit }))))()`));
console.log("blocks:", JSON.stringify(blocks));
const bBuild = blocks.find((b) => b.cmd.includes("npm run build"));
const bFalse = blocks.find((b) => b.cmd.endsWith("false"));
const bGit = blocks.find((b) => b.cmd.includes("git pull"));
const rowOf = async (id) =>
  ev(`(() => { const btn = document.querySelector('.aynx-ask-ai[data-block-id="${id}"]'); if (!btn) return null; const b = btn.closest('.aynx-fail-row').getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
const bMake = blocks.find((b) => b.cmd.includes("make all"));
check("② button only on failed rows (not git pull)", await ev(`[...document.querySelectorAll('.aynx-ask-ai')].map((b) => +b.dataset.blockId).sort()`), [bBuild.id, bFalse.id, bMake.id].sort());
{
  const at = JSON.parse(await rowOf(bFalse.id));
  const markBefore = await ev(`(() => { const r = document.querySelector('.aynx-ask-ai[data-block-id="${bFalse.id}"]').closest('.aynx-fail-row'); return [...document.querySelectorAll('.aynx-block-mark')].filter((m) => m.style.top === r.style.top).length; })()`);
  await mouse("mouseMoved", at.x, at.y, { button: "none", clickCount: 0 });
  await sleep(300);
  check("② mark on same row hidden while hovering", await ev(`(() => { const r = document.querySelector('.aynx-ask-ai[data-block-id="${bFalse.id}"]').closest('.aynx-fail-row'); const m = [...document.querySelectorAll('.aynx-block-mark')].filter((m) => m.style.top === r.style.top); return [m.length, m.every((x) => getComputedStyle(x).visibility === 'hidden')]; })()`), [markBefore, true]);
}
{
  const at = JSON.parse(await rowOf(bBuild.id));
  await mouse("mouseMoved", at.x, at.y, { button: "none", clickCount: 0 });
  await sleep(300);
  // 절대 배치된 inline-flex 는 계산값이 flex 로 바뀐다(블록화) — "none" 이 아니면 보인다
  check("② hover → button shown", await ev(`getComputedStyle(document.querySelector('.aynx-ask-ai[data-block-id="${bBuild.id}"]').closest('.aynx-row-acts')).display`), "flex");
  check("② other fail row's button hidden", await ev(`getComputedStyle(document.querySelector('.aynx-ask-ai[data-block-id="${bFalse.id}"]').closest('.aynx-row-acts')).display`), "none");
  check("② button text", await ev(`document.querySelector('.aynx-ask-ai[data-block-id="${bBuild.id}"]').textContent`), "AI에게 묻기Ctrl+Shift+X");
  await shot("ask-ai-hover.png");

  // ③ AI 타일이 없다 → 상자(새로 열기 둘 · 기본 · 공유 꺼짐 한 줄). 누르는 동안 터미널 포커스를 뺏지 않는다
  const b = JSON.parse(await ev(`JSON.stringify(document.querySelector('.aynx-ask-ai[data-block-id="${bBuild.id}"]').getBoundingClientRect())`));
  const bx = Math.round(b.left + b.width / 2), by = Math.round(b.top + b.height / 2);
  await mouse("mouseMoved", bx, by, { button: "none", clickCount: 0 });
  await mouse("mousePressed", bx, by);
  check("③ mousedown keeps terminal focus", await domFocusPane(), shell.id);
  await mouse("mouseReleased", bx, by);
  await sleep(500);
}
let pk = await readPicker();
check("③ picker (no tiles)", pk && { head: pk.head, sum: pk.sum, note: pk.note, groups: pk.groups, rows: pk.rows, sel: pk.sel, focused: pk.focused }, {
  head: "어느 AI 에게 넘길까", sum: "npm run build · 종료 2", note: true, groups: ["열려 있는 AI 타일이 없습니다"],
  // 사이드 채팅 줄이 새로 열기 앞에 끼어도 골라진 줄은 그대로 기본 CLI(withSideChatRow 가 selected 를 한 칸 민다)
  rows: ["side", "new:claude:기본", "new:codex"], sel: 1, focused: true,
});
check("③ picker under the button", await ev(`(() => { const p = document.querySelector('[data-ask-picker]').getBoundingClientRect(); const b = document.querySelector('.aynx-ask-ai[data-block-id="${bBuild.id}"]').getBoundingClientRect(); return p.top >= b.bottom && Math.abs(p.right - b.right) < 2; })()`), true);
await shot("ask-ai-picker-empty.png");
await key("Escape", "Escape");
check("③ Esc closes", await ev(`!!document.querySelector('[data-ask-picker]')`), false);
check("③ Esc → focus back to source", await domFocusPane(), shell.id);
check("③ Esc did not leak (source tile still there, no toast)", (await panesNow())[0].panes.length, 1);

// ④ 새 타일 — 준비가 안 되면 20초 뒤 넣지 않고 알린다 (Codex 줄: ↓ Enter)
await ev(`(async () => (await ${ASK}).askAiAboutBlock(${JSON.stringify(shell.id)}, ${bBuild.id}, { x: 400, y: 300, align: 'left' }))()`);
await sleep(400);
check("④ note only once per session", (await readPicker()).note, false);
await key("ArrowDown", "ArrowDown");
await key("Enter", "Enter");
await sleep(1200);
tabs = await panesNow();
const codexNew = tabs[0].panes.find((p) => p.autorun === "codex");
check("④ codex tile opened beside", !!codexNew && tabs[0].panes.length === 2, true);
console.log("… waiting 20 s for the readiness timeout");
await sleep(20_000);
check("④ timeout notice", (await toasts()).some((s) => s.includes("AI 타일이 아직 준비되지 않았습니다")), true);
check("④ nothing pasted", (await writesTo(codexNew.sid)).filter((d) => d.includes("200~")).length, 0);
await ev(`(async () => { const w = await ${W}; w.closePaneIn(w.tabOfPane(${JSON.stringify(codexNew.id)}).id, ${JSON.stringify(codexNew.id)}); })()`);
await sleep(500);

// ⑤ 새 타일 — 준비되면 붙여 넣는다 (Claude 줄: Enter)
await focusTerm(shell.id);
await ev(`(async () => (await ${ASK}).askAiAboutBlock(${JSON.stringify(shell.id)}, ${bBuild.id}, { x: 400, y: 300, align: 'left' }))()`);
await sleep(400);
await key("Enter", "Enter");
await sleep(1000);
tabs = await panesNow();
const claude = tabs[0].panes.find((p) => p.autorun === "claude");
check("⑤ claude tile opened, right of the shell", await ev(`(() => { const a = document.querySelector('[data-pane="${shell.id}"]').getBoundingClientRect(); const b = document.querySelector('[data-pane="${claude.id}"]').getBoundingClientRect(); return b.left > a.left && Math.abs(a.top - b.top) < 4; })()`), true);
await bootAi(claude.sid, "claude");
await sleep(700);
check("⑤ not pasted before ready", (await writesTo(claude.sid)).filter((d) => d.includes("200~")).length, 0);
// 준비 = 괄호 붙여넣기 + CLI 가 그린 뒤 `ASK_QUIET_MS`(3초) 조용함 — 훅 `stop` 은 더 이상 보지 않는다
// (90fb2e1 · docs/log/2026-10-01-agent-status-three.md). 고정 대기 대신 붙을 때까지 본다(상한 6초).
await hook(claude.stream, "stop");
let w = [];
for (let i = 0; i < 30; i++) {
  w = (await writesTo(claude.sid)).filter((d) => d.includes("200~"));
  if (w.length > 0) break;
  await sleep(200);
}
await sleep(300); // 두 번 붙지 않는지 — 한 박자 더 본다
w = (await writesTo(claude.sid)).filter((d) => d.includes("200~"));
if (w.length === 0) console.log("⑤ ready signals:", await ev(`(async () => { const a = await ${importApp("app/agent-status.svelte.ts")}; const ta = await ${TA}; const id = ${JSON.stringify(claude.id)}; return JSON.stringify({ now: Date.now(), started: a.agentCommandStartedAt(id), last: a.agentLastOutputAt(id), bracketed: ta.termActionsOf(id)?.bracketedPaste() ?? null }); })()`));
check("⑤ pasted once after ready", w.length, 1);
check("⑤ bracketed, no Enter after", w[0]?.startsWith("\x1b[200~") && w[0]?.endsWith("\x1b[201~"), true);
check("⑤ lead + facts", w[0]?.split("\r").slice(0, 4), ["\x1b[200~이 명령이 실패했어. 원인을 봐 줘.", "호스트 이 PC · 폴더 /home/u/app", w[0]?.split("\r")[2], "출력 끝 9줄:"]);
check("⑤ command line", /^\$ npm run build {2}→ 종료 코드 2 · /.test(w[0]?.split("\r")[2] ?? ""), true);
check("⑤ focus + glow on claude", [await focusedPaneId(), await ev(`document.querySelector('[data-pane="${claude.id}"]').classList.contains('glow-accent')`)], [claude.id, true]);
await sleep(300);
check("⑤ DOM focus in claude tile", await domFocusPane(), claude.id);
await shot("ask-ai-new-tile.png");

// ⑥ AI 타일 하나(이 탭) → 단축키로 곧장 · 마지막 끝난 블록(make all 100줄) · 40줄 상한
await focusTerm(shell.id);
await key("KeyX", "X", 10);
await sleep(600);
check("⑥ no picker (direct)", await ev(`!!document.querySelector('[data-ask-picker]')`), false);
w = (await writesTo(claude.sid)).filter((d) => d.includes("200~"));
const lines6 = (w.at(-1) ?? "").split("\r");
check("⑥ direct paste of last block", [w.length, lines6[3], lines6[4], lines6[5], lines6.at(-2)], [2, "출력 끝 40줄:", "(앞 60줄 생략)", "make: step 61", "make: step 100"]);
check("⑥ focus moved to claude", await focusedPaneId(), claude.id);
check("⑥ pasted toast", (await toasts()).some((s) => s.includes("붙여 넣기만 됐습니다")), true);
await shot("ask-ai-direct.png");

// ⑦ 괄호 붙여넣기가 꺼진 AI 타일 → 넣지 않고 까닭을 말한다
await ev(`window.__feed(${claude.sid}, ${JSON.stringify(`${ESC}[?2004l`)})`);
await focusTerm(shell.id);
await key("KeyX", "X", 10);
await sleep(500);
check("⑦ no-bracketed → not pasted", (await writesTo(claude.sid)).filter((d) => d.includes("200~")).length, 2);
check("⑦ no-bracketed notice", (await toasts()).some((s) => s.includes("붙여 넣기를 받을 상태가 아닙니다")), true);
check("⑦ focus stays on source", await focusedPaneId(), shell.id);
await ev(`window.__feed(${claude.sid}, ${JSON.stringify(`${ESC}[?2004h`)})`);

// ⑧ 여럿 — 이 탭에 codex 하나 더(답 쓰는 중), 다른 탭에 claude 하나. 마지막에 쓴 것은 이 탭의 claude
await ev(`(async () => { const w = await ${W}; const s = await ${S}; w.openPaneHere(s.newAiPane('codex')); })()`);
await sleep(1200);
tabs = await panesNow();
const codex = tabs[0].panes.find((p) => p.autorun === "codex");
await bootAi(codex.sid, "codex");
await hook(codex.stream, "start");
await ev(`(async () => { const w = await ${W}; const s = await ${S}; w.openTab(s.newTab()); })()`);
await sleep(800);
await ev(`(async () => { const w = await ${W}; const s = await ${S}; w.openPaneHere(s.newAiPane('claude')); })()`);
await sleep(1200);
tabs = await panesNow();
const tab2 = tabs[1];
const claude2 = tab2.panes.find((p) => p.autorun === "claude");
await bootAi(claude2.sid, "claude");
await hook(claude2.stream, "stop");
await focusTerm(codex.id);
await focusTerm(claude.id);
await focusTerm(shell.id);
const at8 = JSON.parse(await rowOf(bBuild.id) ?? "null");
if (at8) {
  await mouse("mouseMoved", at8.x, at8.y, { button: "none", clickCount: 0 });
  await sleep(250);
  await ev(`document.querySelector('.aynx-ask-ai[data-block-id="${bBuild.id}"]').click()`);
} else {
  await ev(`(async () => (await ${ASK}).askAiAboutBlock(${JSON.stringify(shell.id)}, ${bBuild.id}, { x: 900, y: 200, align: 'right' }))()`);
}
await sleep(500);
pk = await readPicker();
check("⑧ picker rows", pk?.rows, [`tile:here:${claude.id}:last`, `tile:here:${codex.id}:busy`, `tile:other:${claude2.id}:탭 2`, "side", "new:claude", "new:codex"]);
check("⑧ groups · preselected last used", [pk?.groups, pk?.sel], [["이 탭", "다른 탭"], 0]);
await shot("ask-ai-picker-many.png");
await key("ArrowDown", "ArrowDown");
check("⑧ ↓ moves", (await readPicker()).sel, 1);
await key("ArrowUp", "ArrowUp");
await key("ArrowUp", "ArrowUp");
check("⑧ ↑ wraps", (await readPicker()).sel, 5);

// ⑨ 다른 탭 줄 → 그 탭으로 가서 붙여 넣는다(맨 끝에서 셋 위 — 새로 열기 둘 · 사이드 채팅 줄을 지나)
await key("ArrowUp", "ArrowUp");
await key("ArrowUp", "ArrowUp");
await key("ArrowUp", "ArrowUp");
check("⑨ the other-tab row is selected", (await readPicker()).rows[(await readPicker()).sel], `tile:other:${claude2.id}:탭 2`);
await key("Enter", "Enter");
await sleep(700);
check("⑨ switched to tab 2", await activeTab(), tab2.tab);
check("⑨ pasted into tab-2 claude", (await writesTo(claude2.sid)).filter((d) => d.includes("200~")).length, 1);
check("⑨ focus in tab-2 claude", await focusedPaneId(), claude2.id);

// ⑩ 우클릭 메뉴 — 성공한 블록(git pull) · 중립 문장 · 메뉴 통로
await ev(`(async () => { const w = await ${W}; w.selectTab(${JSON.stringify(tabs[0].tab)}); })()`);
await sleep(500);
await focusTerm(shell.id);
await scrollTop();
await sleep(300);
{
  const at = JSON.parse(await rowY("git pull"));
  await ev(`document.elementFromPoint(${at.x}, ${at.y}).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: ${at.x}, clientY: ${at.y} }))`);
  await sleep(300);
  const item = await ev(`(() => { const b = [...document.querySelectorAll('.tilemenu button')].find((e) => e.textContent.includes('AI 에게 묻기')); return b ? b.textContent.replace(/\\s+/g, ' ').trim() : null; })()`);
  check("⑩ menu row (this block · hint)", item, "이 블록을 AI 에게 묻기…Ctrl+Shift+X");
  await shot("ask-ai-menu.png");
  await ev(`[...document.querySelectorAll('.tilemenu button')].find((e) => e.textContent.includes('AI 에게 묻기')).click()`);
  await sleep(500);
  check("⑩ menu closed · picker open", [await ev(`!!document.querySelector('.tilemenu')`), !!(await readPicker())], [false, true]);
  // 골라진 줄은 마지막에 쓴 AI 타일(⑨ 의 다른 탭 claude)이다 — 어디로 갔든 새 쓰기 하나를 본다
  check("⑩ preselected = last used (tab-2 claude)", (await readPicker()).rows[(await readPicker()).sel], `tile:other:${claude2.id}:last`);
  const before = await ev(`window.__writes.length`);
  await key("Enter", "Enter");
  await sleep(500);
  const last = JSON.parse(await ev(`JSON.stringify(window.__writes.slice(${before}).map((w) => w[1]))`)).find((d) => d.includes("200~")) ?? "";
  check("⑩ success block → neutral lead", last.split("\r").slice(0, 3), ["\x1b[200~이 명령의 결과를 봐 줘.", "호스트 이 PC · 폴더 /home/u/app", last.split("\r")[2]]);
  check("⑩ git pull output", last.includes("\r$ git pull  → 종료 코드 0") && last.includes("\rAlready up to date.\r"), true);
}

check("⑪ console errors", errors, []);
for (const d of errorDetails) console.log(`console.error detail:\n${d}`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1); // 러너는 하네스의 종료 코드를 그대로 낸다 — FAIL 이 있으면 1
