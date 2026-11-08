// 헤드리스 검증 — **AI 타일 안에서 [터미널 | 대화] 넘기기** (2026-10-17 — `src/lib/pane/AiFlip.svelte`).
//
// 스텁은 `ask-ai-harness.mjs` 의 사본(가짜 로컬 세션 + Channel 콜백으로 출력 먹이기 · `write_session` 기록 · 훅 신호)에
// `agent_conversation_transcript`(창 안의 `window.__tx` 를 끝에서 거꾸로 쪽으로)를 더했다. AI 타일은 `newAiPane('claude')`(autorun)
// 로 열고, 훅 신호 `start` 에 대화 id 를 실어 타일 ↔ 대화를 잇는다(진짜 Claude 훅과 같은 길 — `agentLinkOf`).
//
// 보는 것: ① 셸 타일엔 단추가 없다 · 단축키는 안내만 ② AI 타일 머리줄 [터미널 | 대화] ③ 단추로 넘김 — 대화 면 · 항목 · 코드 블록
// [복사] · 터미널 층이 display:none 아님 · 크기 그대로(resize 0) · 움직임 도중 캡처 ④ 넘긴 동안 출력이 터미널 버퍼에 쌓인다
// ⑤ 따라가기 — 맨 아래면 따라 내려가고, 올려 읽는 중이면 자리를 지킨다 ⑥ 기록에서 글자를 치면 입력 칸으로
// ⑦ 단축키(Ctrl+Shift+\)로 넘기고 Escape 로 돌아온다(Escape 는 CLI 로 안 간다) · 삼키는 키(Enter)는 안 나간다 ⑧ 한글 IME 가 입력 칸에서
// 첫 글자부터 · 조합 중 Enter 는 안 보냄 ⑪ 입력 칸 한 줄 = 글자 + \r · 보내는 중 말풍선 · 기록에 나타나면 걷힘 ⑫ 여러 줄 = 괄호 붙여넣기
// + \r ⑬ 권한 대기 — "터미널에서 답하기 →" ⑭ 입력 칸 알약(placeholder · 44px · 칸 안 보내기 단추) · 내 말 오른쪽 말풍선 ⑮ 실행 중 신호면
// 점 셋 · 끝의 결과 없는 도구에 스피너 · 머리줄에 로딩 없음 · 끝나면 둘 다 없음 ⑨ 대화를 모르는 AI 타일 — 빈 면 + 입력 칸(문구 없음)
// ⑯ 훅 10판 `session`(SessionStart) 신호로 연결 · 상태는 그대로 ⑰ 새 id 의 session → 대화 면이 그 대화로 ⑱ F5(재부착 스텁) 뒤에도 연결 유지
// (타일 명세 사본 → 표) · 대화 면이 그 대화를 읽음 ⑩ 콘솔 오류 0.
//
//   node scripts/dev/run-harness.mjs ai-flip-harness.mjs <outdir> --size 1280x860
//     → <outdir>/flip-term.png · flip-mid.png · flip-convo.png · flip-follow.png · flip-unknown.png
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
// CLI 가 떴다 — 프롬프트 · 명령 시작 · TUI 그림
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${prompt}claude\r\n${ESC}]133;C${BEL}`)})`);
await sleep(650);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${ESC}[?2004h╭─ Claude Code ─╮\r\n│ > │\r\n╰───────────────╯\r\n`)})`);
await sleep(300);

// ① 셸 타일 — 단추 없음 · 단축키는 안내만
check("① shell tile has no toggle", await ev(`!!document.querySelector('[data-pane="${shell.id}"] [data-flip-toggle]')`), false);
await focusTerm(shell.id);
await key("Backslash", "|", 10);
await sleep(300);
check("① shortcut on shell → notice", (await toasts()).some((s) => s.includes("AI 타일")), true);
check("① shell stays term", (await flipState(shell.id)).view, null);

// ② AI 타일 — 단추 · 대화 모름 안내(⑨)
check("② ai tile: one icon button → convo", (await flipState(ai.id)).btn, { to: "convo", label: "대화로 전환", title: "대화로 전환 (Ctrl+Shift+\\)", n: 1 });
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-to="convo"]').click()`);
await sleep(800);
check("⑨ unknown conversation → blank + composer, no wording", await ev(`(() => { const c = document.querySelector('[data-pane="${ai.id}"] [data-flip-convo]'); return JSON.stringify([!!c.querySelector('[data-flip-blank]'), !!c.querySelector('[data-flip-input]'), c.querySelector('[data-flip-blank]')?.textContent.trim() ?? null]); })()`), JSON.stringify([true, true, ""]));
await shot("flip-unknown.png");
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-to="term"]').click()`);
await sleep(800);

// 훅 신호 — 이 타일 = 이 대화
const CONV = "11111111-2222-4333-8444-000000000001";
// 훅 10판 `session`(Claude SessionStart) — 이 타일 = 이 대화. 상태 점은 그대로(실행 중이 아니다)
await ev(fakeAgentSignal({ stream: ai.stream, event: "session", session: CONV, cli: "claude" }));
await sleep(300);
const AS = importApp("app/agent-sessions.svelte.ts");
const ST = importApp("app/agent-status.svelte.ts");
check("⑯ session signal links the tile · state stays idle", await ev(`(async () => { const a = await ${AS}; const st = await ${ST}; const w = await ${W}; const p = w.findPaneAnywhere(${JSON.stringify(ai.id)}); return JSON.stringify([a.agentLinkOf(${JSON.stringify(ai.id)})?.id ?? null, st.agentStatusOf(p), p.agentLink?.id ?? null]); })()`), JSON.stringify([CONV, null, CONV]));
await focusTerm(ai.id);
await shot("flip-term.png");
const before = await flipState(ai.id);
const resizesBefore = await ev(`window.__resizes.length`);

// ③ 단추로 넘김 — 도중 캡처 · 끝 상태
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-to="convo"]').click()`);
await sleep(220);
const mid = await flipState(ai.id);
await shot("flip-mid.png");
// 2026-10-20 가로 밀기 → **3D 카드 뒤집기**(사용자 선택 — `pane/flip-motion.ts`): 도는 것은 타일 한 장(`.pane-box`)이고 두 층은
// 미끄러지지 않는다 — 가장자리 프레임에 쉬는 자리(0 · ±100%)가 계단으로 바뀔 뿐이다.
const midCard = JSON.parse(await ev(`(() => { const b = document.querySelector('.pane-box[data-pane="${ai.id}"]'); const tf = getComputedStyle(b).transform;
  return JSON.stringify({ anims: b.getAnimations().filter((a) => a.playState === 'running').length, tf3d: tf.startsWith('matrix3d') }); })()`));
check("③ mid: the tile card turns (pane-box 3D 회전 중)", midCard.anims > 0 && midCard.tf3d, true);
check("③ mid: layers only swap at rest positions (no slide)", [0, -mid.w].includes(mid.termX) && [0, mid.w].includes(mid.talkX), true);
await sleep(700);
const after = await flipState(ai.id);
console.log("after:", JSON.stringify(after));
check("③ view convo", after.view, "convo");
check("③ button now → terminal", [after.btn.to, after.btn.label], ["term", "터미널로 전환"]);
check("③ term layer pushed left (not hidden)", [after.termX, after.termDisplay, after.xtermDisplay], [-after.w, "block", "block"]);
check("③ convo layer in place", [after.talkX, after.talkInert], [0, false]);
check("③ term layer no pointer", after.termPE, "none");
check("③ xterm same width", after.xtermW, before.xtermW);
check("③ no refit (resize calls)", await ev(`window.__resizes.length`), resizesBefore);
check("③ items rendered (last page 32 → 32)", after.items, 32);
check("③ code block has copy button", after.copy >= 1, true);
check("③ keyboard in composer", await ev(`document.activeElement?.matches('[data-pane="${ai.id}"] [data-flip-input]') ?? false`), true);
check("③ at bottom", await ev(`(() => { const b = document.querySelector('[data-pane="${ai.id}"] [data-flip-convo] [data-viewer-body]'); return b.scrollHeight - b.scrollTop - b.clientHeight < 4; })()`), true);
await shot("flip-convo.png");

// ④ 넘긴 동안 출력 — 버퍼에 쌓인다
await ev(`window.__feed(${ai.sid}, ${JSON.stringify("\r\nOUTPUT-WHILE-FLIPPED-42\r\n")})`);
await sleep(300);
check("④ output buffered while flipped", ((await bufferText(ai.id)) ?? "").includes("OUTPUT-WHILE-FLIPPED-42"), true);

// ⑤ 따라가기 — 맨 아래: 새 말이 붙고 따라 내려간다
await ev(`window.__tx.push(window.__txMake(50, 'FOLLOW-ONE ' + 'line '.repeat(80)))`);
await sleep(2200);
const f1 = await ev(`(() => { const t = document.querySelector('[data-pane="${ai.id}"] [data-flip-convo]'); const b = t.querySelector('[data-viewer-body]'); return JSON.stringify({ n: t.querySelectorAll('[data-viewer-items] > li').length, has: t.textContent.includes('FOLLOW-ONE'), bottom: b.scrollHeight - b.scrollTop - b.clientHeight < 4 }); })()`);
check("⑤ follow at bottom", JSON.parse(f1), { n: 33, has: true, bottom: true });
// 올려 읽는 중 — 자리를 지킨다
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-convo] [data-viewer-body]').scrollTop = 40`);
await ev(`window.__tx.push(window.__txMake(51, 'FOLLOW-TWO'))`);
await sleep(2200);
const f2 = await ev(`(() => { const t = document.querySelector('[data-pane="${ai.id}"] [data-flip-convo]'); const b = t.querySelector('[data-viewer-body]'); return JSON.stringify({ n: t.querySelectorAll('[data-viewer-items] > li').length, top: b.scrollTop }); })()`);
check("⑤ reading up keeps position", JSON.parse(f2), { n: 34, top: 40 });
await shot("flip-follow.png");
const polls = await ev(`window.__txCalls.length`);

const BODY = `document.querySelector('[data-pane="${ai.id}"] [data-flip-convo] [data-viewer-body]')`;
const INPUT = `document.querySelector('[data-pane="${ai.id}"] [data-flip-input]')`;
const inputValue = async () => ev(`${INPUT}?.value ?? null`);
const pendingN = async () => ev(`document.querySelectorAll('[data-pane="${ai.id}"] [data-item="pending"]').length`);

// ⑦ 기록에 포커스가 있을 때 — 스크롤 키 · 삼키는 키(Enter)는 터미널로 안 나간다
await ev(`${BODY}.focus()`);
const w0 = (await writesTo(ai.sid)).length;
await key("ArrowDown", "ArrowDown");
check("⑦ ArrowDown scrolls convo", await ev(`${BODY}.scrollTop`), 80);
await key("Enter", "Enter", 0, "\r");
check("⑦ Enter swallowed (no write · still convo)", [(await writesTo(ai.sid)).length - w0, (await flipState(ai.id)).view], [0, "convo"]);

// ⑥ 기록에서 글자를 치면 입력 칸으로 — 그 글자가 칸에 들어간다(터미널로 넘어가지 않는다)
await key("KeyH", "h", 0, "h");
await sleep(300);
check("⑥ typed char lands in composer", [await inputValue(), (await flipState(ai.id)).view, (await writesTo(ai.sid)).length - w0], ["h", "convo", 0]);

// ⑪ 입력 칸 — 한 줄 Enter = 친 글자 + \r (괄호 없음)
await ev(`(() => { const i = ${INPUT}; i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); i.focus(); })()`);
for (const ch of "hello") await key(`Key${ch.toUpperCase()}`, ch, 0, ch);
const w3 = (await writesTo(ai.sid)).length;
await key("Enter", "Enter", 0, "\r");
await sleep(300);
check("⑪ one line → keyboard + CR", (await writesTo(ai.sid)).slice(w3).join(""), "hello\r");
check("⑪ composer cleared · still convo", [await inputValue(), (await flipState(ai.id)).view], ["", "convo"]);
check("⑪ sending bubble", await pendingN(), 1);
await shot("flip-sending.png");
// 기록에 그 말이 나타나면 말풍선이 걷힌다
await ev(`window.__tx.push({ role: 'user', text: 'hello', truncated: false, images: 0, tool: null, at: Date.now() })`);
await sleep(2200);
check("⑪ bubble settled when the message shows up", [await pendingN(), await ev(`[...document.querySelectorAll('[data-pane="${ai.id}"] [data-item="user"]')].some((e) => e.textContent.trim() === 'hello')`)], [0, true]);

// ⑫ 여러 줄(Shift+Enter) — 괄호 붙여넣기(\n → \r) + \r
for (const ch of "ab") await key(`Key${ch.toUpperCase()}`, ch, 0, ch);
await key("Enter", "Enter", 8, "\r"); // Shift+Enter = 줄바꿈
for (const ch of "cd") await key(`Key${ch.toUpperCase()}`, ch, 0, ch);
check("⑫ Shift+Enter keeps newline in composer", await inputValue(), "ab\ncd");
const w4 = (await writesTo(ai.sid)).length;
await key("Enter", "Enter", 0, "\r");
await sleep(300);
check("⑫ multi line → bracketed paste + CR", (await writesTo(ai.sid)).slice(w4).join(""), "\x1b[200~ab\rcd\x1b[201~\r");

// ⑧ 한글 IME — 입력 칸에서 첫 글자부터 조합 · 조합 중 Enter 는 보내지 않는다
const w2 = (await writesTo(ai.sid)).length;
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "KeyG", key: "Process", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
await send("Input.imeSetComposition", { text: "ㅎ", selectionStart: 1, selectionEnd: 1 });
await send("Input.dispatchKeyEvent", { type: "keyUp", code: "KeyG", key: "Process", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
await send("Input.imeSetComposition", { text: "한", selectionStart: 1, selectionEnd: 1 });
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code: "Enter", key: "Process", windowsVirtualKeyCode: 229, nativeVirtualKeyCode: 229 });
await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Enter", key: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
await send("Input.insertText", { text: "한" });
await sleep(400);
check("⑧ IME composes in composer · Enter during composition not sent", [await inputValue(), (await writesTo(ai.sid)).length - w2, (await flipState(ai.id)).view], ["한", 0, "convo"]);
check("⑧ box not scrolled", (await flipState(ai.id)).boxScroll, 0);

// ⑦ Escape(입력 칸에서) → 터미널 · CLI 로 안 감 · 읽기 멈춤
const w1 = (await writesTo(ai.sid)).length;
await key("Escape", "Escape");
await sleep(700);
check("⑦ Escape → term", (await flipState(ai.id)).view, "term");
check("⑦ Escape not written", (await writesTo(ai.sid)).length - w1, 0);
check("⑦ keyboard back in terminal", (await flipState(ai.id)).focusInTerm, true);
check("⑦ polling stopped while term", (await ev(`(async () => { const n = window.__txCalls.length; await new Promise((r) => setTimeout(r, 2500)); return window.__txCalls.length - n; })()`)), 0);
check("⑦ polls happened while convo", polls >= 3, true);
// 돌아온 터미널이 넘긴 동안의 출력을 그린다(멈춘 그림 없이) — DOM 렌더러(webgl 끔)의 줄 글자
check("⑥ terminal repaints output after return", await ev(`[...document.querySelectorAll('[data-pane="${ai.id}"] .xterm-rows > div')].some((d) => d.textContent.includes('OUTPUT-WHILE-FLIPPED-42'))`), true);
await shot("flip-back.png");

// ⑦ 단축키로 넘김 — 포커스는 입력 칸
await key("Backslash", "|", 10);
await sleep(700);
check("⑦ shortcut → convo · focus in composer", [(await flipState(ai.id)).view, await ev(`document.activeElement === ${INPUT}`)], ["convo", true]);
check("⑦ button flips label", [(await flipState(ai.id)).btn.to, (await flipState(ai.id)).btn.label], ["term", "터미널로 전환"]);

// ⑭ 입력 칸 알약 모양(칸 안 둥근 보내기 단추 · 2026-10-24) · 내 말 오른쪽 말풍선
const shape = JSON.parse(await ev(`(() => { const i = ${INPUT}; const send = document.querySelector('[data-pane="${ai.id}"] [data-flip-convo] [data-flip-send]');
  const col = document.querySelector('[data-pane="${ai.id}"] [data-flip-convo] [data-viewer-items]').getBoundingClientRect();
  const u = [...document.querySelectorAll('[data-pane="${ai.id}"] [data-flip-convo] [data-item="user"]')].pop().getBoundingClientRect();
  // 알약 = 칸을 감싼 '.wrap'(1px 테두리 · 반지름 22) — 2026-10-25 테두리를 칸에서 감싸개로 옮겼다(칸 42 + 테두리 2 = 44, FlipComposer 머리말)
  const pill = i.closest('.wrap');
  return JSON.stringify({ ph: i.placeholder, h: Math.round(pill.getBoundingClientRect().height), pill: parseFloat(getComputedStyle(pill).borderTopLeftRadius) >= 22,
    send: !!send, padR: !!send && parseFloat(getComputedStyle(i).paddingRight) >= send.getBoundingClientRect().width,
    rightAligned: Math.abs(u.right - col.right) < 2 && u.left - col.left > col.width * 0.15 }); })()`));
check("⑭ composer pill: placeholder · 44px · round field · send button · text clears the button", shape, { ph: "메시지 보내기", h: 44, pill: true, send: true, padR: true, rightAligned: true });

// ⑮ 작업 중 표시 — 실행 중 신호면 점 셋 · 끝의 결과 없는 도구에 스피너 · 머리줄엔 아무 로딩도 없다
const typingN = async () => ev(`document.querySelectorAll('[data-pane="${ai.id}"] [data-flip-convo] [data-item="typing"]').length`);
const spinN = async () => ev(`document.querySelectorAll('[data-pane="${ai.id}"] [data-flip-convo] [data-tool-running]').length`);
check("⑮ idle → no dots", await typingN(), 0);
await ev(`window.__tx.push({ role: 'tool', text: null, truncated: false, images: 0, at: Date.now(), tool: { name: 'Bash', summary: 'npm test', input: 'npm test', inputTruncated: false, output: null, outputTruncated: false, error: false } })`);
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await sleep(2200);
check("⑮ running → dots · spinner on running tool", [await typingN(), await spinN(), await ev(`document.querySelector('[data-pane="${ai.id}"] [data-item="typing"]')?.getAttribute('aria-label') ?? null`)], [1, 1, "에이전트가 응답을 쓰는 중"]);
check("⑮ no loading in tile header", await ev(`[...document.querySelectorAll('[data-pane="${ai.id}"] [data-pane-head] *')].filter((e) => getComputedStyle(e).animationName !== 'none').length`), 0);
await shot("flip-working.png");
await ev(fakeAgentSignal({ stream: ai.stream, event: "stop", session: CONV, cli: "claude" }));
await sleep(400);
check("⑮ finished → no dots · no spinner", [await typingN(), await spinN()], [0, 0]);

// ⑬ 권한 대기 — 입력 칸 대신 "터미널에서 답하기 →", 누르면 터미널
await ev(fakeAgentSignal({ stream: ai.stream, event: "waiting", detail: "permission", session: CONV, cli: "claude" }));
await sleep(400);
check("⑬ permission → answer button instead of composer", [await ev(`!!document.querySelector('[data-pane="${ai.id}"] [data-flip-answer]')`), await ev(`!!${INPUT}`)], [true, false]);
await shot("flip-permission.png");
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-answer]').click()`);
await sleep(700);
check("⑬ answer → terminal", (await flipState(ai.id)).view, "term");

// ⑰ 대화가 바뀐다(`/clear` · `/resume` — 새 id 의 session 신호) → 대화 면이 그 대화를 읽는다
const CONV2 = "11111111-2222-4333-8444-000000000002";
await key("Backslash", "|", 10);
await sleep(700);
await ev(fakeAgentSignal({ stream: ai.stream, event: "session", session: CONV2, cli: "claude" }));
await sleep(1200);
check("⑰ new session id → convo reads that conversation", await ev(`window.__txCalls[window.__txCalls.length - 1]?.id ?? null`), CONV2);
await key("Escape", "Escape");
await sleep(400);

// ⑱ F5 — 산 세션에 다시 붙은 타일은 연결을 그대로 안다(타일 명세의 사본 → 표)
await sleep(800); // 배치 자동 저장
check("⑱ link persisted in workspace file", await ev(`JSON.stringify(window.__workspaceFile).includes(${JSON.stringify(CONV2)})`), true);
await ev(`(sessionStorage.setItem('h.reload', '1'), sessionStorage.setItem('h.attach', ${JSON.stringify(ai.stream)}), 1)`);
errors.length = 0;
await send("Page.reload", { ignoreCache: false });
await sleep(4000);
let back = null;
for (let i = 0; i < 40; i++) {
  try {
    back = (await panesNow()).flatMap((t) => t.panes).find((p) => p.stream === ai.stream && p.sid != null) ?? null;
  } catch { back = null; }
  if (back) break;
  await sleep(300);
}
check("⑱ reattached (no new shell)", [!!back, await ev(`window.__attached ?? 0`)], [true, 1]);
check("⑱ link survives F5", await ev(`(async () => (await ${importApp("app/agent-sessions.svelte.ts")}).agentLinkOf(${JSON.stringify(back?.id ?? "")})?.id ?? null)()`), CONV2);
await ev(`document.querySelector('[data-pane="${back?.id}"] [data-flip-to="convo"]')?.click()`);
await sleep(1500);
check("⑱ convo after F5 reads the linked conversation", [await ev(`window.__txCalls[window.__txCalls.length - 1]?.id ?? null`), await ev(`!!document.querySelector('[data-pane="${back?.id}"] [data-viewer-items]')`)], [CONV2, true]);
await shot("flip-after-f5.png");
await ev(`(sessionStorage.clear(), 1)`);

// ⑩ 콘솔 오류
check("⑩ console errors", errors, []);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
