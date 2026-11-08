// 헤드리스 검증 — **대화 면 신뢰 안내 말풍선**(2026-11-04 — `pane/AiFlip.svelte` · 판정 `pane/claude-trust.ts`).
//
// 스텁은 `ai-flip-harness.mjs` 의 사본(가짜 로컬 세션 + Channel 로 출력 먹이기 · `write_session` 기록). Claude 질문은 2.1.318 실측 글자를 터미널에 넣는다.
// 보는 것: 터미널 면 변화 없음 · 대화 면 말풍선 · 옅은 면(어둡게 · 밝게) · 꼬리 · 칸 막힘 · Enter/글자/보내기가 안 샘 · ✕ 는 말풍선만 · 질문이 사라지면 복귀 · 다시 물으면 다시 뜸 ·
// 단추 → 터미널 면 · 시계 사이의 질문(보내기 직전 재확인) · 문장 인용 오탐 없음 · 사람이 말한 뒤 · 훅을 받은 뒤 오탐 없음 · Codex 모양과 영구 닫기. 폰 400 은 `phone-convo-harness.mjs`.
//
//   node scripts/dev/run-harness.mjs trust-bubble-harness.mjs <outdir> --size 1280x860
import { waitBoot } from "./boot-wait.mjs";
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
    if (!/stub:/.test(s)) errors.push("console.error " + s);
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
const VK = { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38, Backslash: 220, Space: 32 };
const key = async (code, keyName, modifiers = 0, text) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text, unmodifiedText: text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

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
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = []; window.__writes = []; window.__resizes = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextSession = 100;
  // 대화 하나 — 오래된 것부터. 쪽은 끝에서 거꾸로 PAGE 개, 커서 = 남은 앞 항목 수(0 이면 없음)
  const T0 = Date.now() - 3600_000;
  const U = (i, text) => ({ role: 'user', text, truncated: false, images: 0, tool: null, at: T0 + i * 1000 });
  const A = (i, text) => ({ role: 'assistant', text, truncated: false, images: 0, tool: null, at: T0 + i * 1000 });
  const B = (i, cmd, out) => ({ role: 'tool', text: null, truncated: false, images: 0, at: T0 + i * 1000, tool: { name: 'Bash', summary: cmd, input: cmd, inputTruncated: false, output: out, outputTruncated: false, error: false } });
  window.__tx = [];
  for (let i = 0; i < 30; i++) window.__tx.push(i % 3 === 0 ? U(i, 'question ' + i) : i % 3 === 1 ? B(i, 'npm test #' + i, 'ok ' + i) : A(i, 'answer ' + i + ' — fine.'));
  window.__tx.push(U(40, '탭 전환 슬라이드 끝을 천천히 멈추게 해줘'));
  window.__tx.push(A(41, 'tab-slide.svelte.ts 의 곡선을 바꿨습니다. 쓰는 법:\\n\\n\\u0060\\u0060\\u0060ts\\nconst opts = { duration: TAB_SLIDE.ms, easing: TAB_SLIDE.easing };\\nel.animate(frames, opts);\\n\\u0060\\u0060\\u0060\\n'));
  window.__txCalls = [];
  window.__txMake = (i, text) => A(i, text);
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_ai_clis: [{id:'claude',name:'Claude Code',command:'claude',installed:true},{id:'codex',name:'Codex',command:'codex',installed:true}],
    mcp_status: { clis: [{id:'claude',name:'Claude Code',installed:true,registered:true},{id:'codex',name:'Codex',installed:true,registered:true}] },
    list_group_meta: {}, list_host_meta: {},
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, send_input: null,
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
      // F5 재부착 흉내 — 리로드 전에 적어 둔 스트림만 "떨어진 세션" 으로 답하고 붙여 준다
      if (cmd === 'probe_session') {
        const want = sessionStorage.getItem('h.attach');
        return Promise.resolve(want && args.stream === want ? { state: 'detached', kind: 'local', sessionEpoch: 1, checkpoint: null } : { state: 'none', sessionEpoch: null, checkpoint: null });
      }
      if (cmd === 'attach_session') {
        const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, args }; window.__attached = (window.__attached ?? 0) + 1;
        return Promise.resolve({ id, kind: 'local', lease: { stream: args.stream, sessionEpoch: 1, leaseEpoch: 2 }, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh' });
      }
      if (cmd === 'write_session') { window.__writes.push([args.id, args.data]); return Promise.resolve(null); }
      if (cmd === 'resize_session') { window.__resizes.push([args.id, args.cols, args.rows]); return Promise.resolve(null); }
      if (cmd === 'agent_conversation_transcript') {
        window.__txCalls.push(args);
        const all = window.__tx; const lim = args.limit ?? 40;
        const end = args.before ?? all.length; const start = Math.max(0, end - lim);
        return Promise.resolve({ items: all.slice(start, end), cursor: start > 0 ? start : null });
      }
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' } });
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
  try { if (!sessionStorage.getItem('h.reload')) localStorage.clear(); } catch {}
  // 배치를 리로드 너머로(F5 시험) — workspace-stub 이 apply 마다 sessionStorage 에 적는다
  window.__persistWorkspace = true;
  if (sessionStorage.getItem('h.reload') && sessionStorage.getItem('h.ws')) window.__workspaceSeed = JSON.parse(sessionStorage.getItem('h.ws'));
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
// 헤드리스 창은 포커스를 못 받는 판이 있다 — 키 이벤트가 페이지에 닿게
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
errors.length = 0;

const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const TA = importApp("lib/term-actions.ts");

const ESC = "\x1b", BEL = "\x07";
const prompt = `${ESC}]133;A${BEL}PS C:\\> ${ESC}]133;B${BEL}`;
const panesNow = async () =>
  JSON.parse(await ev(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().map((t) => ({ tab: t.id, panes: s.listPanes(t.root).map((p) => ({ id: p.id, autorun: p.autorun ?? null, stream: p.historyStreamId ?? null, sid: ss.sessionOf(p.id) })) }))); })()`));
const writesTo = async (sid) => JSON.parse(await ev(`JSON.stringify(window.__writes.filter((w) => w[0] === ${sid}).map((w) => w[1]))`));
const toasts = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.toast')].map((e) => e.textContent.trim()))`));
const focusTerm = async (paneId) => {
  await ev(`(async () => { const w = await ${W}; const t = w.tabOfPane(${JSON.stringify(paneId)}); w.focusTile(t.id, ${JSON.stringify(paneId)}); })()`);
  await sleep(300);
  await ev(`(async () => (await ${TA}).termActionsOf(${JSON.stringify(paneId)})?.focus())()`);
  await sleep(200);
};
const bufferText = async (paneId) =>
  ev(`(async () => { const a = (await ${TA}).termActionsOf(${JSON.stringify(paneId)}); if (!a) return null; return a.screenSnapshot().lines.map((l) => l.map((r) => r.text).join('')).join('\\n'); })()`);
const flipState = async (paneId) =>
  JSON.parse(await ev(`(() => { const box = document.querySelector('[data-pane="${paneId}"]'); const f = box?.querySelector('.flip'); if (!f) return 'null';
    const term = f.querySelector('[data-flip-term]'); const talk = f.querySelector('[data-flip-convo]');
    const m = (el) => el ? Math.round(new DOMMatrixReadOnly(getComputedStyle(el).transform).m41) : null;
    return JSON.stringify({ view: f.dataset.flip ?? null, w: f.clientWidth, termX: m(term), talkX: m(talk), termDisplay: getComputedStyle(term).display, xtermDisplay: getComputedStyle(term.querySelector('.xterm')).display,
      xtermW: term.querySelector('.xterm-screen')?.getBoundingClientRect().width ?? null, talkInert: talk ? talk.inert : null, termPE: getComputedStyle(term).pointerEvents,
      items: talk ? talk.querySelectorAll('[data-viewer-items] > li').length : null, copy: talk ? talk.querySelectorAll('[data-code-copy]').length : null,
      focusInTerm: term.contains(document.activeElement), boxScroll: box.scrollLeft + box.scrollTop,
      btn: (() => { const b = box.querySelector('[data-flip-toggle]'); return b ? { to: b.dataset.flipTo, label: b.getAttribute('aria-label'), title: b.getAttribute('title'), n: box.querySelectorAll('[data-flip-toggle]').length } : null; })() }); })()`));

// ── 셸 타일 하나 + AI 타일 하나 ──────────────────────────────────────────────
for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${SESS}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
// 셸 타일 — 기본 셸 열기(`new-shell` 과 같은 몸통). 헤드리스 판에서 시작 화면 위의 Ctrl+Shift+N 이 안 먹는 일이 있어
// (ask-ai-harness 도 같은 자리에서 멈춘다 — 이 판과 무관) 몸통을 곧장 부른다.
await ev(`(async () => (await ${importApp("app/panes.svelte.ts")}).openDefaultShell())()`);
let shell = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  let tabs;
  try { tabs = await panesNow(); } catch { continue; }
  shell = tabs[0]?.panes.find((p) => !p.autorun && p.sid != null) ?? null;
  if (shell) break;
}
console.log("shell tile:", JSON.stringify(shell));
await ev(`window.__feed(${shell.sid}, ${JSON.stringify(prompt)})`);
await ev(`(async () => { const w = await ${W}; const s = await ${S}; w.openPaneHere(s.newAiPane('claude')); })()`);
let ai = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  const tabs = await panesNow();
  ai = tabs.flatMap((t) => t.panes).find((p) => p.autorun === "claude" && p.sid != null) ?? null;
  if (ai) break;
  if (i === 49) console.log("panes:", JSON.stringify(tabs), await ev(`JSON.stringify(window.__calls.map((c) => c[0]).filter((c) => !c.startsWith('plugin:') && !c.startsWith('resource') && !c.startsWith('session_server')).slice(-20))`));
}
console.log("ai tile:", JSON.stringify(ai));

// ── 신뢰 안내 판정 ─────────────────────────────────────────
const CLEAR = `${ESC}[2J${ESC}[H`;
// 2.1.318 실측 화면(`pane/claude-trust.ts` 머리말)
const TRUST_SCREEN = CLEAR + [
  " Accessing workspace:",
  "",
  " C:\\tmp\\empty",
  "",
  " Quick safety check: Is this a project you created or one you trust? (Like your own code, a",
  " well-known open source project, or work from your team).",
  "",
  " Security guide",
  "",
  " \u276f No, exit",
  "   Yes, I trust this folder",
  "",
  " Enter to confirm \u00b7 Esc to cancel",
].join("\r\n");
const PLAIN_SCREEN = `${CLEAR}\u256d\u2500 Claude Code \u2500\u256e\r\n\u2502 > \u2502\r\n\u2570\u2500\u2500\u2500\u256f\r\n`;
const feed = (s) => ev(`window.__feed(${ai.sid}, ${JSON.stringify(s)})`);
const q = (sel) => `document.querySelector('[data-pane="${ai.id}"] ${sel}')`;
const bubble = () => ev(`!!${q("[data-claude-trust-hint]")}`);
const inputState = () =>
  ev(`(() => { const i = ${q("[data-flip-input]")}; return JSON.stringify(i ? { readOnly: i.readOnly, ph: i.placeholder, dashed: getComputedStyle(i.closest('.wrap')).borderTopStyle } : null); })()`).then(JSON.parse);
const writes = () => ev(`window.__writes.length`);
const THEME_BG = { dark: "rgb(58, 53, 36)", light: "rgb(251, 243, 211)" };

await feed(`${prompt}claude\r\n${ESC}]133;C${BEL}`);
await sleep(650);
await feed(TRUST_SCREEN);
await sleep(300);

// ① 터미널 면 — 말풍선 없음
check("① 터미널 면에는 말풍선 없음", await bubble(), false);

// ② 대화 면 — 말풍선 · 칸 막힘
await ev(`${q('[data-flip-to="convo"]')}.click()`);
await sleep(1400);
check("② Claude 질문 → 말풍선", await bubble(), true);
check("② Claude 타일에 Codex 안내 없음", await ev(`!!${q("[data-codex-trust-hint]")}`), false);
check("② 입력 칸 막힘 · 점선 · 안내 글", await inputState(), { readOnly: true, ph: "터미널에서 답한 뒤 보낼 수 있습니다", dashed: "dashed" });
const look = () => ev(`(() => { const h = ${q("[data-claude-trust-hint]")}; const c = getComputedStyle(h); const a = getComputedStyle(h, '::after'); const i = ${q("[data-flip-input]")}.closest('.wrap').getBoundingClientRect(); const r = h.getBoundingClientRect(); return JSON.stringify({ bg: c.backgroundColor, tail: a.content !== 'none', tailRot: a.transform !== 'none', tailBottom: Math.round(r.bottom + 6), composerTop: Math.round(i.top) }); })()`).then(JSON.parse);
const L1 = await look();
check("② 옅은 면(어둡게) · 꼬리 있음", [L1.bg, L1.tail, L1.tailRot], [THEME_BG.dark, true, true]);
check("② 꼬리가 입력 칸에 닿지 않음", L1.tailBottom <= L1.composerTop, true);
await shot("trust-claude-dark.png");
await ev(`document.documentElement.dataset.theme = 'light'`);
await sleep(200);
check("② 옅은 면(밝게)", (await look()).bg, THEME_BG.light);
await shot("trust-claude-light.png");
await ev(`document.documentElement.dataset.theme = 'dark'`);
await sleep(100);

// ③ 어느 길로도 입력이 새지 않는다
const w0 = await writes();
await ev(`${q("[data-flip-input]")}.focus()`);
await key("Enter", "Enter");
await send("Input.insertText", { text: "abc" });
await key("Enter", "Enter");
await ev(`${q("[data-flip-input]")}.closest('.wrap').querySelector('button:not([disabled])')?.click()`);
await ev(`${q("[data-flip-input]")}.blur()`);
await key("Enter", "Enter");
await sleep(300);
check("③ Enter · 글자 · 보내기 → write_session 없음", (await writes()) - w0, 0);
check("③ 칸에 글자가 들어가지 않음(읽기 전용)", await ev(`${q("[data-flip-input]")}.value`), "");
check("③ 대화 면 그대로", await ev(`${q("[data-flip]")}?.dataset.flip ?? document.querySelector('[data-pane="${ai.id}"] .flip').dataset.flip`), "convo");

// ④ ✕ — 말풍선만 숨고 칸은 막힘
await ev(`${q("[data-claude-trust-hint-close]")}.click()`);
await sleep(1300);
check("④ ✕ 뒤 말풍선 숨음(시계가 돌아도)", await bubble(), false);
check("④ ✕ 뒤에도 칸은 막힘", (await inputState()).readOnly, true);

// ⑤ 질문이 사라지면 칸이 돌아온다
await feed(PLAIN_SCREEN);
await sleep(1300);
check("⑤ 질문 사라짐 → 말풍선 없음 · 칸 복귀", [await bubble(), (await inputState()).readOnly], [false, false]);

// ⑥ 다시 물으면 다시 뜬다
await feed(TRUST_SCREEN);
await sleep(1300);
check("⑥ 다시 물으면 다시 뜸", await bubble(), true);

// ⑦ [터미널에서 답하기] → 터미널 면
await ev(`${q("[data-claude-trust-terminal]")}.click()`);
await sleep(900);
check("⑦ 단추 → 터미널 면", await ev(`document.querySelector('[data-pane="${ai.id}"] .flip').dataset.flip`), "term");
await ev(`${q('[data-flip-to="convo"]')}.click()`);
await sleep(1000);

// ⑧ 시계 사이에 뜬 질문 — 보내기 직전에 다시 본다
await feed(PLAIN_SCREEN);
await sleep(1300);
await ev(`${q("[data-flip-input]")}.focus()`);
await send("Input.insertText", { text: "hello" });
const w1 = await writes();
await feed(TRUST_SCREEN);
await sleep(60);
await key("Enter", "Enter");
check("⑧ 보내기 직전 질문 → 안 나감", (await writes()) - w1, 0);
check("⑧ 친 글은 그대로", await ev(`${q("[data-flip-input]")}.value`), "hello");

// ⑨ 문장 안의 인용은 오탐이 아니다
await feed(`${CLEAR}터미널에 No, exit 와 Yes, I trust this folder 가 뜹니다.\r\nEnter to confirm \u00b7 Esc to cancel 도 보입니다.\r\n`);
await sleep(1300);
check("⑨ 문장 인용 → 말풍선 없음 · 칸 열림", [await bubble(), (await inputState()).readOnly], [false, false]);

// ⑩ 질문이 없으면 보낸다 — 그 뒤로는 화면을 읽지 않는다
const w2 = await writes();
await ev(`${q("[data-flip-input]")}.focus()`);
await key("Enter", "Enter");
await sleep(400);
check("⑩ 질문 없음 → 보냄", (await writes()) - w2 > 0, true);
await feed(TRUST_SCREEN);
await sleep(1300);
check("⑩ 사람이 말한 뒤에는 같은 화면이어도 말풍선 없음", await bubble(), false);

// ⑪ 훅을 받은 CLI — 같은 화면이어도 질문이 아니다
await ev(`(async () => (await ${W}).openPaneHere((await ${S}).newAiPane('claude')))()`);
let ai2 = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  const tabs = await panesNow();
  ai2 = tabs.flatMap((t) => t.panes).find((p) => p.autorun === "claude" && p.sid != null && p.id !== ai.id) ?? null;
  if (ai2) break;
}
await ev(`window.__feed(${ai2.sid}, ${JSON.stringify(`${prompt}claude\r\n${ESC}]133;C${BEL}`)})`);
await sleep(650);
await ev(fakeAgentSignal({ stream: ai2.stream, event: "session", session: "11111111-2222-4333-8444-000000000009", cli: "claude" }));
await ev(`window.__feed(${ai2.sid}, ${JSON.stringify(TRUST_SCREEN)})`);
await ev(`document.querySelector('[data-pane="${ai2.id}"] [data-flip-to="convo"]').click()`);
await sleep(1400);
check("⑪ 훅을 받은 CLI → 말풍선 없음", await ev(`!!document.querySelector('[data-pane="${ai2.id}"] [data-claude-trust-hint]')`), false);

// ⑫ Codex — 말풍선 모양 · 닫기는 영구
await ev(`localStorage.removeItem('aynx:codex-hook-trust-hint')`);
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(1500);
await ev(`(async () => (await ${W}).openPaneHere((await ${S}).newAiPane('codex')))()`);
let cx = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  const tabs = await panesNow();
  cx = tabs.flatMap((t) => t.panes).find((p) => p.autorun === "codex" && p.sid != null) ?? null;
  if (cx) break;
}
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(`${prompt}codex\r\n${ESC}]133;C${BEL}`)})`);
await sleep(650);
await ev(`document.querySelector('[data-pane="${cx.id}"] [data-flip-to="convo"]').click()`);
await sleep(1000);
const cxq = (sel) => `document.querySelector('[data-pane="${cx.id}"] ${sel}')`;
check("⑫ Codex 안내 말풍선 · 옅은 면 · 꼬리", await ev(`(() => { const h = ${cxq("[data-codex-trust-hint]")}; return h ? [getComputedStyle(h).backgroundColor, getComputedStyle(h, '::after').content !== 'none', !!h.querySelector('svg.shield')] : null; })()`), [THEME_BG.dark, true, false]);
check("⑫ Codex 입력 칸은 그대로", await ev(`${cxq("[data-flip-input]")}.readOnly`), false);
await shot("trust-codex-dark.png");
await ev(`${cxq("[data-codex-trust-hint-close]")}.click()`);
await sleep(200);
check("⑫ 닫기 → 저장 · 숨음", [await ev(`localStorage.getItem('aynx:codex-hook-trust-hint')`), await ev(`!!${cxq("[data-codex-trust-hint]")}`)], ["closed", false]);
// 스텁은 첫 적재에 localStorage 를 비운다 — 이어지는 새로고침이라고 표시한다
await ev(`sessionStorage.setItem('h.reload', '1')`);
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(1500);
check("⑫ 다시 떠도 저장돼 있음", await ev(`localStorage.getItem('aynx:codex-hook-trust-hint')`), "closed");
await ev(`localStorage.removeItem('aynx:codex-hook-trust-hint')`);
await ev(`sessionStorage.clear()`);

check("⑬ 콘솔 오류", errors, []);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
