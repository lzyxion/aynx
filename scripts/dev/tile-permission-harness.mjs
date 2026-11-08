// 헤드리스 검증 — **AI 타일 대화 면의 권한 카드** 화면 단계 (2026-11-01 · docs/log/2026-11-01-tile-permission-hook.md 10절).
//
// 스텁은 `ai-flip-harness.mjs` 의 사본(가짜 로컬 세션 + Channel 콜백)에 타일 권한 명령 넷을 더했다:
// `tile_permission_subscribe`(Channel id 를 쥔다 — `window.__perm(body)` 로 사건을 흘린다) · `_snapshot`(`window.__permSnap[stream]`) ·
// `_decide`(인자를 적고 `window.__permApplied` 로 답 — 둘째 결정 흉내) · `_analyze`(`rm` 이면 삭제 · 그 밖 읽기).
// 보는 것:
// ① Claude AI 타일 대화 면 — kind 별 카드(command · edit · write · notebook · patch · fetch · search · read · mcp · other) · 명령 카드의 판결 띠 ·
//    Edit diff 줄 · write 접기 · 잘림 표시 · 카드가 있으면 입력 칸은 숨김 · 1분 안쪽 남은 시간
// ② 단추 → decide 인자(허용 한 번 · 이 세션 동안 허용 · 사유와 함께 거절 · 터미널에서 답하기 = release + 터미널 면)
// ③ gone 사건이면 카드가 사라진다(조용히) · terminal 이면 흔적 한 줄 · auto 사건 = 흔적 한 줄
// ④ 둘째 결정(applied:false)은 조용히 걷힌다(토스트 없음)
// ⑤ 스냅숏으로 다시 그림(`watchTilePermissions`) (알림으로 와도 면은 그대로 — 2026-11-03 `revealPermissionCards` 걷음)
// ⑥ Codex AI 타일 — 신뢰 안내 = 입력 칸 바로 위 말풍선(11-02 — 폰 폭에서도 칸 안) · 닫으면 다시 안 뜸 · 터미널 면이면 띠 → 누르면 대화 면
// ⑦ 폰 폭(390x844 · 터치) — 카드 단추 32px 넘음 · 캡처
// ⑧ 잡히지 않은 예외 · 콘솔 오류 0(`stub:` 거절 제외)
// ⑨ (11-02) 새 Claude 타일 — `session` 신호가 잇고 대화 파일이 아직 없음(`agent_conversation_transcript` 거절) → 오류 문구 없는 빈 면 ·
//    파일이 생기면(`window.__tx`) 따라가기가 그린다
// ⑪ (11-02) 질문 카드(Claude AskUserQuestion) — 질문 · 선택지(하나 · 여럿) · 직접 입력(실제 키 · Backspace) · [답하기]는 모두 답했을 때만 ·
//    decide{decision:"answer", answers}
// ⑭ (11-02) 대화 면 입력 칸은 단축키에서 터미널처럼 — 팔레트 · Ctrl+Shift+← 낱말 고르기 · 카드 글 칸은 가드
// ⑬ (11-02 면 규칙) 이 창의 타일 면을 서버에 알린다(tile_permission_face — 대화 면 · 보이는 탭이면 참) · 사건 tui(TUI 가 묻는 중)면 대화 면
//    입력 칸 대신 "터미널에서 답하기" · 거짓이면 입력 칸
// ⑫ (11-02 A안) Codex 질문(request_user_input) — 하나 고르기 · 직접 입력 · [답하기] → decide{answer, answers} · 터미널 면이면 띠 · [터미널에서 답하기] = release
// ⑩ (11-02) [중지] — 일하는 중(`start`)이고 칸이 비면 보내기 자리가 [중지](글이 있으면 보내기) · 누르면 `write_session{data:"\x1b",
//    source:"keyboard"}` 하나 + `agent_state_interrupt` 하나 · 1초 안 다시 누름은 버림 · 서버 interrupt 방송이면 실행이 풀림 ·
//    권한 대기(`waiting permission`) · 턴 끝(`stop`)이면 숨김
//
//   node scripts/dev/run-harness.mjs tile-permission-harness.mjs <outdir> --size 1280x900
//     → <outdir>/perm-command.png · perm-edit.png · perm-kinds.png · perm-codex-band.png · perm-codex-hint.png · perm-codex-hint-phone.png ·
//       perm-phone.png · convo-not-yet.png · convo-stop.png
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9278"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1445";
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

let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = []; window.__writes = [];
  const evts = new Map();
  let nextSession = 100;
  window.__decides = []; window.__permApplied = true; window.__permSnap = {}; window.__permChan = null; let permIdx = 0;
  window.__tx = null; window.__txCalls = []; window.__faces = []; window.__interrupts = [];
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  window.__perm = (body) => { const cb = cbs.get(window.__permChan); if (!cb) return 'no channel'; cb({ message: body, index: permIdx++ }); return 'ok'; };
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
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'write_session') { window.__writes.push([args.id, args.data, args.source ?? null]); return Promise.resolve(null); }
      if (cmd === 'resize_session') return Promise.resolve(null);
      if (cmd === 'agent_conversation_transcript') {
        window.__txCalls.push(args);
        // 대화 파일이 아직 없다(Claude 첫 말 전) — Rust 와 같은 실패(이유 코드 없음)
        if (window.__tx === null) return Promise.reject(new Error('그 대화를 찾지 못했습니다'));
        const all = window.__tx; const lim = args.limit ?? 40;
        const end = args.before ?? all.length; const start = Math.max(0, end - lim);
        return Promise.resolve({ items: all.slice(start, end), cursor: start > 0 ? start : null });
      }
      // 대화 면 [중지] — 서버가 실행 중이면 interrupt 를 적어 방송한다(흉내: 가짜 신호 하나)
      if (cmd === 'agent_state_interrupt') { window.__interrupts.push(args); setTimeout(() => window.__fakeAgentSignal?.({ stream: args.stream, event: 'interrupt', cli: 'claude' }), 50); return Promise.resolve(true); }
      if (cmd === 'tile_permission_subscribe') { window.__permChan = args.channel.id; return Promise.resolve(null); }
      if (cmd === 'tile_permission_face') { window.__faces.push(args); return Promise.resolve(null); }
      if (cmd === 'tile_permission_snapshot') return Promise.resolve(window.__permSnap[args.stream] ?? { sessionEpoch: null, cards: [] });
      if (cmd === 'tile_permission_decide') { window.__decides.push(args); return Promise.resolve({ applied: window.__permApplied }); }
      if (cmd === 'tile_permission_analyze') {
        const del = /\\brm\\b/.test(args.command);
        return Promise.resolve({ effect: del ? 'delete' : 'read', cause: del ? 'rm' : undefined, programs: [], tokens: [], sudo: false });
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
  try { localStorage.clear(); } catch {}
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
errors.length = 0;

const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const FLIP = importApp("pane/ai-flip.svelte.ts");
for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${SESS}; await ${FLIP}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
const PERM = importApp("app/tile-permission.svelte.ts");

const panesNow = async () =>
  JSON.parse(await ev(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().flatMap((t) => s.listPanes(t.root).map((p) => ({ id: p.id, autorun: p.autorun ?? null, stream: p.historyStreamId ?? null, sid: ss.sessionOf(p.id) })))); })()`));
const openAi = async (cli) => {
  await ev(`(async () => { const w = await ${W}; const s = await ${S}; w.openPaneHere(s.newAiPane('${cli}')); })()`);
  for (let i = 0; i < 50; i++) {
    await sleep(300);
    const p = (await panesNow()).find((x) => x.autorun === cli && x.sid != null);
    if (p) {
      // CLI 가 떴다 — 프롬프트 · 명령 시작 · TUI 그림(로딩 덮개가 걷힌다 — ai-flip-harness 와 같은 몸)
      const ESC = "\x1b", BEL = "\x07";
      const prompt = `${ESC}]133;A${BEL}PS C:\\> ${ESC}]133;B${BEL}`;
      await ev(`window.__feed(${p.sid}, ${JSON.stringify(`${prompt}${cli}\r\n${ESC}]133;C${BEL}`)})`);
      await sleep(650);
      await ev(`window.__feed(${p.sid}, ${JSON.stringify(`${ESC}[?2004h╭─ ${cli} ─╮\r\n│ > │\r\n╰──────────╯\r\n`)})`);
      await sleep(400);
      return p;
    }
  }
  return null;
};
const setView = (paneId, v) => ev(`(async () => (await ${FLIP}).setFlipView(${JSON.stringify(paneId)}, '${v}'))()`);
const viewOf = (paneId) => ev(`document.querySelector('[data-pane="${paneId}"] .flip')?.dataset.flip ?? null`);
const toasts = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.toast')].map((e) => e.textContent.trim()))`));
const cardsIn = async (paneId) =>
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-pane="${paneId}"] [data-tile-perm]')].map((c) => c.dataset.tilePermKind))`));

// 띠가 **보이는가** — 있는가가 아니라 그 한가운데 맨 위 원소가 띠인가(2026-11-02 실기: 있었지만 터미널 안 겹에 가려 안 보였다). 무엇이 덮었는지도 돌려준다
const bandVisible = (paneId) => ev(`(() => { const b = document.querySelector('[data-pane="${paneId}"] [data-tile-perm-band]'); if (!b) return 'none';
  const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return top && top.closest('[data-tile-perm-band]') === b ? 'visible' : 'covered by ' + (top ? top.tagName + '.' + [...top.classList].join('.') : 'null'); })()`);
let req = 0;
const T = Date.now();
const mkCard = (stream, over) => ({
  requestId: `req-${++req}`, stream, sessionEpoch: 1, cli: "claude", tool: "Bash", kind: "command", toolUseId: null, conversation: "conv-1",
  input: {}, truncated: false, suggestions: [], mcpServer: null, cwd: "C:/work", permissionMode: "default", canAllowSession: true,
  createdAt: T, deadlineAt: T + 600_000, auto: false, ...over,
});
const sendReq = (card) => ev(`window.__perm(${JSON.stringify({ windows: ["main"], stream: card.stream, sessionEpoch: card.sessionEpoch, ev: { t: "request", card } })})`);
const sendEv = (stream, e) => ev(`window.__perm(${JSON.stringify({ windows: ["main"], stream, sessionEpoch: 1, ev: e })})`);

// ── Claude AI 타일 ─────────────────────────────────────────────────────────────
const ai = await openAi("claude");
console.log("claude tile:", JSON.stringify(ai));
await setView(ai.id, "convo");
await sleep(900);
check("① subscribe + snapshot on convo face", await ev(`JSON.stringify([window.__permChan !== null, window.__calls.some((c) => c[0] === 'tile_permission_snapshot' && c[1].stream === ${JSON.stringify(ai.stream)})])`), JSON.stringify([true, true]));
check("① composer visible before cards", await ev(`!!document.querySelector('[data-pane="${ai.id}"] [data-flip-input]')?.offsetParent`), true);

const cmd = mkCard(ai.stream, { input: { command: "rm -rf build && npm run build", description: "빌드 폴더를 지우고 다시 빌드" }, deadlineAt: Date.now() + 45_000 });
await sendReq(cmd);
await sleep(700);
const cmdCard = JSON.parse(await ev(`(() => { const c = document.querySelector('[data-tile-perm="${cmd.requestId}"]'); if (!c) return 'null';
  return JSON.stringify({ kind: c.dataset.tilePermKind, verdict: c.querySelector('[data-verdict]')?.dataset.verdict ?? null, desc: c.querySelector('[data-tile-perm-desc]')?.textContent ?? null,
    cmd: c.querySelector('[data-tile-perm-command]')?.textContent ?? null, left: !!c.querySelector('[data-tile-perm-left]'), session: !!c.querySelector('[data-tile-perm-session]') }); })()`));
check("① command card: verdict band err · desc · command · left · session button", cmdCard, {
  kind: "command", verdict: "err", desc: "빌드 폴더를 지우고 다시 빌드", cmd: "rm -rf build && npm run build", left: true, session: true,
});
check("① composer hidden while a card waits", await ev(`!!document.querySelector('[data-pane="${ai.id}"] [data-flip-input]')?.offsetParent`), false);
await shot("perm-command.png");

// ② [허용 한 번]
await ev(`document.querySelector('[data-tile-perm="${cmd.requestId}"] [data-tile-perm-allow]').click()`);
await sleep(400);
check("② allow → decide args", await ev(`JSON.stringify(window.__decides.at(-1))`), JSON.stringify({ stream: ai.stream, sessionEpoch: 1, requestId: cmd.requestId, decision: "allow", message: null }));
check("② card gone after allow · composer back", JSON.stringify([await cardsIn(ai.id), await ev(`!!document.querySelector('[data-pane="${ai.id}"] [data-flip-input]')?.offsetParent`)]), JSON.stringify([[], true]));

// edit — diff
const edit = mkCard(ai.stream, { tool: "Edit", kind: "edit", input: { file_path: "C:/work/src/app.ts", old_string: "const a = 1;\nconst b = 2;\nreturn a + b;", new_string: "const a = 1;\nconst b = 3;\nreturn a + b;", replace_all: false } });
await sendReq(edit);
await sleep(500);
check("① edit diff rows", await ev(`JSON.stringify([...document.querySelectorAll('[data-tile-perm="${edit.requestId}"] [data-tile-perm-diff] [data-op]')].map((r) => r.dataset.op + r.textContent.slice(r.dataset.op === ' ' ? 1 : 1)))`),
  JSON.stringify([" const a = 1;", "-const b = 2;", "+const b = 3;", " return a + b;"]));
check("① edit path", await ev(`document.querySelector('[data-tile-perm="${edit.requestId}"] [data-tile-perm-path]')?.textContent`), "C:/work/src/app.ts");
await shot("perm-edit.png");
await ev(`document.querySelector('[data-tile-perm="${edit.requestId}"] [data-tile-perm-session]').click()`);
await sleep(400);
check("② allowSession → decide", await ev(`JSON.stringify([window.__decides.at(-1).decision, window.__decides.at(-1).requestId])`), JSON.stringify(["allowSession", edit.requestId]));

// 나머지 kind 를 한꺼번에
const longText = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n");
const kinds = [
  mkCard(ai.stream, { tool: "Write", kind: "write", input: { file_path: "C:/work/notes.md", content: longText } }),
  mkCard(ai.stream, { tool: "NotebookEdit", kind: "notebook", input: { notebook_path: "C:/work/a.ipynb", cell_id: "c2", new_source: "print(1)", edit_mode: "replace" } }),
  mkCard(ai.stream, { cli: "claude", tool: "apply_patch", kind: "patch", input: { command: "*** Begin Patch\n*** Update File: b.txt\n@@\n-old\n+new\n*** End Patch" } }),
  mkCard(ai.stream, { tool: "WebFetch", kind: "fetch", input: { url: "https://example.com/doc", prompt: "요약해 줘" } }),
  mkCard(ai.stream, { tool: "WebSearch", kind: "search", input: { query: "tauri channel ordering" } }),
  mkCard(ai.stream, { tool: "Read", kind: "read", input: { file_path: "D:/outside/secret.txt" } }),
  mkCard(ai.stream, { tool: "mcp__probe__echo", kind: "mcp", input: { text: "p1" }, mcpServer: { name: "probe", source: "user" } }),
  mkCard(ai.stream, { tool: "Task", kind: "other", input: { description: "sub", prompt: "x".repeat(50) }, truncated: true, canAllowSession: false }),
];
for (const c of kinds) await sendReq(c);
await sleep(700);
check("① kinds in order", await cardsIn(ai.id), ["write", "notebook", "patch", "fetch", "search", "read", "mcp", "other"]);
const k = (id, sel) => `document.querySelector('[data-tile-perm="${id}"] ${sel}')`;
check("① write folded at 12 lines · unfold button", await ev(`JSON.stringify([${k(kinds[0].requestId, "[data-tile-perm-text]")}.textContent.split('\\n').length, !!${k(kinds[0].requestId, "[data-tile-perm-fold]")}])`), JSON.stringify([12, true]));
await ev(`${k(kinds[0].requestId, "[data-tile-perm-fold]")}.click()`);
await sleep(200);
check("① write unfolded", await ev(`${k(kinds[0].requestId, "[data-tile-perm-text]")}.textContent.split('\\n').length`), 20);
check("① patch rows", await ev(`JSON.stringify([...document.querySelectorAll('[data-tile-perm="${kinds[2].requestId}"] [data-op]')].map((r) => r.dataset.op))`), JSON.stringify(["hunk", "hunk", "-", "+"]));
check("① fetch url · search query · read path · mcp names", await ev(`JSON.stringify([${k(kinds[3].requestId, "[data-tile-perm-url]")}.textContent, ${k(kinds[4].requestId, "[data-tile-perm-query]")}.textContent, ${k(kinds[5].requestId, "[data-tile-perm-path]")}.textContent, ${k(kinds[6].requestId, "[data-tile-perm-mcp]")}.textContent])`),
  JSON.stringify(["https://example.com/doc", "tauri channel ordering", "D:/outside/secret.txt", "probe · echo"]));
check("① other: truncated mark · no session button", await ev(`JSON.stringify([!!${k(kinds[7].requestId, "[data-tile-perm-truncated]")}, !!${k(kinds[7].requestId, "[data-tile-perm-session]")}])`), JSON.stringify([true, false]));
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-tile-perms]').scrollTop = 0`);
await shot("perm-kinds.png");

// ② 사유와 함께 거절
await ev(`${k(kinds[1].requestId, "[data-tile-perm-reason-open]")}.click()`);
await sleep(200);
await ev(`(() => { const i = ${k(kinds[1].requestId, "[data-tile-perm-reason]")}; i.value = '노트북은 건드리지 마'; i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); })()`);
await sleep(400);
check("② deny with reason", await ev(`JSON.stringify([window.__decides.at(-1).decision, window.__decides.at(-1).message, window.__decides.at(-1).requestId])`), JSON.stringify(["deny", "노트북은 건드리지 마", kinds[1].requestId]));

// ③ gone 사건 — 조용히 사라짐 · terminal 은 흔적
await sendEv(ai.stream, { t: "gone", requestId: kinds[3].requestId, reason: "hook-gone" });
await sleep(300);
check("③ gone hook-gone → card removed, no trace", JSON.stringify([(await cardsIn(ai.id)).includes("fetch"), await ev(`document.querySelectorAll('[data-pane="${ai.id}"] [data-tile-perm-trace]').length`)]), JSON.stringify([false, 0]));
await sendEv(ai.stream, { t: "gone", requestId: kinds[4].requestId, reason: "terminal" });
await sleep(300);
check("③ gone terminal → trace line", await ev(`JSON.stringify([...document.querySelectorAll('[data-pane="${ai.id}"] [data-tile-perm-trace]')].map((e) => [e.dataset.tilePermTrace, e.textContent.trim()]))`),
  JSON.stringify([["terminal", "터미널에서 답함 · WebSearch tauri channel ordering"]]));
await sendEv(ai.stream, { t: "auto", card: mkCard(ai.stream, { auto: true, input: { command: "npm test" } }) });
await sleep(300);
check("③ auto → trace line", await ev(`[...document.querySelectorAll('[data-pane="${ai.id}"] [data-tile-perm-trace="auto"]')].map((e) => e.textContent.trim()).join('|')`), "세션 허용으로 자동 허용 · Bash npm test");
await shot("perm-traces.png");

// ④ 둘째 결정(다른 창이 먼저) — 조용히
const toastsBefore = (await toasts()).length;
await ev(`window.__permApplied = false`);
await ev(`${k(kinds[5].requestId, "[data-tile-perm-allow]")}.click()`);
await sleep(400);
check("④ applied:false → card removed quietly", JSON.stringify([(await cardsIn(ai.id)).includes("read"), (await toasts()).length]), JSON.stringify([false, toastsBefore]));
await ev(`window.__permApplied = true`);

// ② 터미널에서 답하기 = release + 터미널 면
await ev(`${k(kinds[6].requestId, "[data-tile-perm-release]")}.click()`);
await sleep(700);
check("② release → decide release · terminal face", JSON.stringify([await ev(`window.__decides.at(-1).decision`), await viewOf(ai.id)]), JSON.stringify(["release", "term"]));

// ⑤ 스냅숏 다시 그림(대화 면에서)
await ev(`(async () => (await ${FLIP}).setFlipView(${JSON.stringify(ai.id)}, 'convo'))()`);
await sleep(700);
check("⑤ convo face", await viewOf(ai.id), "convo");
const snapCard = mkCard(ai.stream, { input: { command: "git push" } });
await ev(`window.__permSnap[${JSON.stringify(ai.stream)}] = ${JSON.stringify({ sessionEpoch: 1, cards: [snapCard] })}`);
await ev(`(async () => (await ${PERM}).watchTilePermissions(${JSON.stringify(ai.stream)}))()`);
await sleep(400);
check("⑤ snapshot redraws the stream", await ev(`JSON.stringify([...document.querySelectorAll('[data-pane="${ai.id}"] [data-tile-perm]')].map((c) => c.dataset.tilePerm))`), JSON.stringify([snapCard.requestId]));
await ev(`window.__permSnap[${JSON.stringify(ai.stream)}] = { sessionEpoch: null, cards: [] }`);
await ev(`(async () => (await ${PERM}).watchTilePermissions(${JSON.stringify(ai.stream)}))()`);
await sleep(300);
check("⑤ empty snapshot clears", (await cardsIn(ai.id)).length, 0);
check("① Claude: no terminal band", await ev(`(async () => { (await ${FLIP}).setFlipView(${JSON.stringify(ai.id)}, 'term'); await new Promise(r => setTimeout(r, 300)); return !!document.querySelector('[data-pane="${ai.id}"] [data-tile-perm-band]'); })()`), false);
check("⑥ Claude: no Codex trust hint", await ev(`!!document.querySelector('[data-pane="${ai.id}"] [data-codex-trust-hint]')`), false);

// ⑨ 새 Claude 타일 — SessionStart 가 대화 id 를 잇지만 파일은 아직 없다 → 오류 문구 없이 빈 면 · 파일이 생기면 따라간다(2026-11-02)
const CONV = "11111111-2222-4333-8444-000000000009";
await ev(fakeAgentSignal({ stream: ai.stream, event: "session", session: CONV, cli: "claude" }));
await setView(ai.id, "convo");
await sleep(2200);
const convoText = () => ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-convo]')?.innerText ?? ''`);
check("⑨ not-yet: transcript asked · no error line · no '찾지 못' wording", JSON.stringify([
  await ev(`window.__txCalls.some((c) => c.id === ${JSON.stringify(CONV)})`),
  await ev(`!!document.querySelector('[data-pane="${ai.id}"] [data-viewer-error]')`),
  (await convoText()).includes("찾지 못"),
  (await convoText()).includes("보여 줄 메시지가 없습니다"),
]), JSON.stringify([true, false, false, false]));
check("⑨ not-yet: composer stays", await ev(`!!document.querySelector('[data-pane="${ai.id}"] [data-flip-input]')?.offsetParent`), true);
await shot("convo-not-yet.png");
await ev(`window.__tx = [{ role: 'user', text: 'FIRST-PROMPT', truncated: false, images: 0, tool: null, at: Date.now() }]`);
await sleep(2200);
check("⑨ file appears → follow shows it", (await convoText()).includes("FIRST-PROMPT"), true);

// ⑩ [중지] — 일하는 중 · 칸이 비면 보내기 자리가 [중지] · 글이 있으면 보내기 · Esc 하나 · 사람 키 · 연타 방지 · 서버 표 interrupt → 풀림
const stopBtn = `document.querySelector('[data-pane="${ai.id}"] [data-flip-interrupt]')`;
const sendBtn = `document.querySelector('[data-pane="${ai.id}"] [data-flip-send]')`;
const typeIn = (v) => ev(`(() => { const i = document.querySelector('[data-pane="${ai.id}"] [data-flip-input]'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
check("⑩ idle → send (no stop)", await ev(`JSON.stringify([!!${stopBtn}, !!${sendBtn}])`), JSON.stringify([false, true]));
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await sleep(400);
check("⑩ running + empty field → the send button becomes stop", await ev(`JSON.stringify([!!${stopBtn}, !!${sendBtn}])`), JSON.stringify([true, false]));
await shot("convo-stop.png");
await typeIn("queued question");
await sleep(200);
check("⑩ running + text → send is back (queue a message)", await ev(`JSON.stringify([!!${stopBtn}, !!${sendBtn}, ${sendBtn}?.disabled ?? null])`), JSON.stringify([false, true, false]));
await typeIn("");
await sleep(200);
check("⑩ text cleared → stop again", await ev(`!!${stopBtn}`), true);
const escWrites = () => ev(`JSON.stringify(window.__writes.filter((w) => w[1] === '\x1b'))`);
const before10 = JSON.parse(await escWrites()).length;
await ev(`${stopBtn}.click(); ${stopBtn}?.click()`);
await sleep(500);
const esc1 = JSON.parse(await escWrites());
check("⑩ click → one Esc (source keyboard) · double click ignored", JSON.stringify([esc1.length - before10, esc1.at(-1)?.[2] ?? null, esc1.at(-1)?.[0] === ai.sid]), JSON.stringify([1, "keyboard", true]));
check("⑩ click → agent_state_interrupt once (this stream)", await ev(`JSON.stringify(window.__interrupts)`), JSON.stringify([{ stream: ai.stream }]));
const AST = importApp("app/agent-status.svelte.ts");
check("⑩ server interrupt → running released · stop gone · send back", JSON.parse(await ev(`(async () => { const st = await ${AST}; const w = await ${W}; return JSON.stringify([st.agentStatusOf(w.findPaneAnywhere(${JSON.stringify(ai.id)})), !!${stopBtn}, !!${sendBtn}]); })()`)), [null, false, true]);
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await sleep(1200);
check("⑩ next prompt → running again · stop back", await ev(`!!${stopBtn}`), true);
await ev(`${stopBtn}.click()`);
await sleep(300);
check("⑩ after the gap → second Esc", JSON.parse(await escWrites()).length - before10, 2);
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await ev(fakeAgentSignal({ stream: ai.stream, event: "waiting", detail: "permission", session: CONV, cli: "claude" }));
await sleep(400);
check("⑩ permission wait → stop hidden", await ev(`!!${stopBtn}`), false);
await ev(fakeAgentSignal({ stream: ai.stream, event: "stop", session: CONV, cli: "claude" }));
await sleep(400);
check("⑩ turn ended → stop hidden", await ev(`!!${stopBtn}`), false);
// ⑪ 질문 카드(Claude AskUserQuestion) — 질문이 여럿이면 한 장씩(2026-11-02 목업): n / N · 단계 막대 · 고르기는 넘기지 않음 · [이전] · [다음] ·
//    마지막 [답하기] · 빠진 질문 안내 · 답 = decide{answer, answers} · 대화 면에 "답을 보냈습니다" 요약
await setView(ai.id, "convo");
await sleep(600);
const QIN = { questions: [
  { question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Green", description: "calm" }] },
  { question: "Which sizes?", header: "Size", multiSelect: true, options: [{ label: "S" }, { label: "M" }, { label: "L" }] },
] };
const qc = mkCard(ai.stream, { tool: "AskUserQuestion", kind: "question", input: QIN, canAllowSession: false, conversation: CONV });
await sendReq(qc);
await sleep(600);
const qsel = (sel) => `document.querySelector('[data-tile-perm="${qc.requestId}"] ${sel}')`;
const qstate = () => ev(`(() => { const c = document.querySelector('[data-tile-perm="${qc.requestId}"]'); if (!c) return 'null';
  return JSON.stringify({ count: c.querySelector('[data-tile-perm-qcount]')?.textContent.trim() ?? null,
    steps: [...c.querySelectorAll('[data-tile-perm-step]')].map((b) => (b.classList.contains('cur') ? 'cur' : b.classList.contains('done') ? 'done' : '-')),
    opts: [...c.querySelectorAll('[data-tile-perm-option]')].map((b) => b.dataset.tilePermOption + (b.getAttribute('aria-checked') === 'true' ? '*' : '')),
    prev: c.querySelector('[data-tile-perm-prev]') ? (c.querySelector('[data-tile-perm-prev]').disabled ? 'off' : 'on') : null,
    next: c.querySelector('[data-tile-perm-next]') ? (c.querySelector('[data-tile-perm-next]').disabled ? 'off' : 'on') : null,
    answer: c.querySelector('[data-tile-perm-answer]') ? (c.querySelector('[data-tile-perm-answer]').disabled ? 'off' : 'on') : null,
    missing: c.querySelector('[data-tile-perm-missing]')?.textContent.trim() ?? null,
    allow: !!c.querySelector('[data-tile-perm-allow]'), release: !!c.querySelector('[data-tile-perm-release]') }); })()`);
check("⑪ page 1/2: one question · bar · prev off · next off · no answer", JSON.parse(await qstate()),
  { count: "1 / 2", steps: ["cur", "-"], opts: ["Red", "Green"], prev: "off", next: "off", answer: null, missing: null, allow: false, release: true });
await ev(`${qsel('[data-tile-perm-option="Red"]')}.click()`);
await sleep(600);
check("⑪ pick does not advance · next on", JSON.parse(await qstate()),
  { count: "1 / 2", steps: ["cur", "-"], opts: ["Red*", "Green"], prev: "off", next: "on", answer: null, missing: null, allow: false, release: true });
// 막대 칸으로 이동 — 마지막 질문: [답하기] 꺼짐 · 빠진 질문 안내
await ev(`${qsel('[data-tile-perm-step="1"]')}.click()`);
await sleep(200);
check("⑪ bar → page 2/2 · answer off · missing hint", JSON.parse(await qstate()),
  { count: "2 / 2", steps: ["done", "cur"], opts: ["S", "M", "L"], prev: "on", next: null, answer: "off", missing: "아직 답하지 않은 질문: 2번", allow: false, release: true });
// [이전] → 다른 선택지 → [다음]
await ev(`${qsel("[data-tile-perm-prev]")}.click()`);
await sleep(200);
await ev(`${qsel('[data-tile-perm-option="Green"]')}.click()`);
await sleep(200);
check("⑪ back · single pick replaced", JSON.parse(await qstate()).opts, ["Red", "Green*"]);
await ev(`${qsel("[data-tile-perm-next]")}.click()`);
await sleep(200);
await ev(`${qsel('[data-tile-perm-option="L"]')}.click()`);
await ev(`${qsel('[data-tile-perm-option="S"]')}.click()`);
await sleep(200);
// 직접 입력 칸 — 실제 키(글자 · Backspace)가 칸에 닿는다(기록 스크롤로 삼키지 않는다)
await ev(`${qsel("[data-tile-perm-other]")}.focus()`);
await send("Input.insertText", { text: "XLx" });
await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 });
await sleep(200);
check("⑪ typing + Backspace stay in the card field", await ev(`${qsel("[data-tile-perm-other]")}.value`), "XL");
check("⑪ page 2 all answered · answer on · no hint", JSON.parse(await qstate()),
  { count: "2 / 2", steps: ["done", "cur"], opts: ["S*", "M", "L*"], prev: "on", next: null, answer: "on", missing: null, allow: false, release: true });
check("⑪ bar labels carry n · header · answered", await ev(`JSON.stringify([...document.querySelectorAll('[data-tile-perm="${qc.requestId}"] [data-tile-perm-step]')].map((b) => b.getAttribute('aria-label')))`),
  JSON.stringify(["1번 질문 — Color (답함)", "2번 질문 — Size (답함)"]));
await shot("perm-question.png");
await ev(`${qsel("[data-tile-perm-answer]")}.click()`);
await sleep(500);
check("⑪ answer → decide{answer, answers} · card gone", JSON.stringify([await ev(`JSON.stringify(window.__decides.at(-1))`), await cardsIn(ai.id)]),
  JSON.stringify([JSON.stringify({ stream: ai.stream, sessionEpoch: 1, requestId: qc.requestId, decision: "answer", message: null, answers: { "Which color?": "Green", "Which sizes?": "S, L, XL" } }), []]));
check("⑪ answered summary = my bubble · title · header | answer grid", await ev(`JSON.stringify([...document.querySelectorAll('[data-pane="${ai.id}"] [data-tile-qa-summary]')].map((e) => {
  const li = e.closest('li'); const lr = li.getBoundingClientRect(); const body = e.closest('[data-viewer-body]').getBoundingClientRect();
  return { user: li.classList.contains('user'), right: lr.right > body.left + body.width / 2 && lr.left > body.left + body.width * 0.15,
    title: e.querySelector('.qa-title').textContent.trim(), cells: [...e.querySelectorAll('.qa-grid > span')].map((x) => x.textContent.trim()) }; }))`),
  JSON.stringify([{ user: true, right: true, title: "질문 2개에 답함", cells: ["Color", "Green", "Size", "S, L, XL"] }]));
await shot("perm-question-sent.png");
// 질문이 하나면 예전 그대로 — 숫자 · 막대 · 이전/다음 없음
const q1 = mkCard(ai.stream, { tool: "AskUserQuestion", kind: "question", input: { questions: [QIN.questions[0]] }, canAllowSession: false });
await sendReq(q1);
await sleep(500);
check("⑪ single question: no count · no bar · no prev/next · answer", await ev(`(() => { const c = document.querySelector('[data-tile-perm="${q1.requestId}"]');
  return JSON.stringify([!!c.querySelector('[data-tile-perm-qcount]'), c.querySelectorAll('[data-tile-perm-step]').length, !!c.querySelector('[data-tile-perm-prev]'), !!c.querySelector('[data-tile-perm-next]'), !!c.querySelector('[data-tile-perm-answer]')]); })()`),
  JSON.stringify([false, 0, false, false, true]));
await sendEv(ai.stream, { t: "gone", requestId: q1.requestId, reason: "hook-gone" });
await sleep(300);
// ⑫ Codex 질문(request_user_input — A안): 훅이 카드의 답을 기다린다 · 하나 고르기(라디오) · 직접 입력 · 답 = decide{answer, answers}(서버가 deny 이유 글로)
const QX = { questions: [
  { header: "Color", id: "color", question: "Which color do you prefer?", options: [{ label: "Red", description: "Choose Red." }, { label: "Green", description: "Choose Green." }] },
  { header: "Size", id: "size", question: "Which size?", options: [{ label: "Small" }, { label: "Large" }] },
] };
await setView(ai.id, "term");
await sleep(500);
const qx = mkCard(ai.stream, { cli: "codex", tool: "request_user_input", kind: "question", input: QX, canAllowSession: false, deadlineAt: Date.now() + 600_000 });
await sendReq(qx);
await sleep(500);
check("⑫ codex question waiting → terminal face shows the band (on top)", await bandVisible(ai.id), "visible");
check("⑫ question band text", await ev(`document.querySelector('[data-pane="${ai.id}"] [data-tile-perm-band]').textContent.trim()`), "질문 — 대화 면에서 답하기");
await setView(ai.id, "convo");
await sleep(700);
const qxs = (sel) => `document.querySelector('[data-tile-perm="${qx.requestId}"] ${sel}')`;
check("⑫ codex question: one page · radios · other field · next off · release", await ev(`JSON.stringify([[...document.querySelectorAll('[data-tile-perm="${qx.requestId}"] [data-tile-perm-option]')].map((b) => b.getAttribute('role')),
  document.querySelectorAll('[data-tile-perm="${qx.requestId}"] [data-tile-perm-other]').length, ${qxs("[data-tile-perm-next]")}.disabled, !!${qxs("[data-tile-perm-release]")}, !!${qxs("[data-tile-perm-allow]")}, ${qxs("[data-tile-perm-qcount]")}.textContent.trim()])`),
  JSON.stringify([["radio", "radio"], 1, true, true, false, "1 / 2"]));
await ev(`${qxs('[data-tile-perm-option="Green"]')}.click()`);
await sleep(200);
await ev(`${qxs("[data-tile-perm-next]")}.click()`);
await sleep(200);
await ev(`${qxs("[data-tile-perm-other]")}.focus()`);
await send("Input.insertText", { text: "Medium, please" });
await sleep(300);
await shot("perm-codex-question.png");
await ev(`${qxs("[data-tile-perm-answer]")}.click()`);
await sleep(500);
check("⑫ answer → decide{answer} · direct input replaces the pick", await ev(`JSON.stringify([window.__decides.at(-1).decision, window.__decides.at(-1).answers])`),
  JSON.stringify(["answer", { "Which color do you prefer?": "Green", "Which size?": "Medium, please" }]));
check("⑫ card gone after answer", (await cardsIn(ai.id)).length, 0);
// [터미널에서 답하기] = release(빈 출력 → TUI 의 평소 질문) + 터미널 면
const qy = mkCard(ai.stream, { cli: "codex", tool: "request_user_input", kind: "question", input: QX, canAllowSession: false, deadlineAt: Date.now() + 600_000 });
await sendReq(qy);
await sleep(500);
await ev(`document.querySelector('[data-tile-perm="${qy.requestId}"] [data-tile-perm-release]').click()`);
await sleep(700);
check("⑫ release → decide release + terminal face", JSON.stringify([await ev(`window.__decides.at(-1).decision`), await viewOf(ai.id)]), JSON.stringify(["release", "term"]));
await sleep(300);

// ⑬ 면 규칙 — 면 알림 · TUI 물음 안내
const lastFace = () => ev(`JSON.stringify(window.__faces.filter((f) => f.stream === ${JSON.stringify(ai.stream)}).at(-1) ?? null)`);
await setView(ai.id, "convo");
await sleep(500);
check("⑬ convo face → face convo:true", JSON.parse(await lastFace()), { stream: ai.stream, convo: true });
await setView(ai.id, "term");
await sleep(500);
check("⑬ terminal face → face convo:false", JSON.parse(await lastFace()), { stream: ai.stream, convo: false });
await setView(ai.id, "convo");
await sleep(500);
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await ev(`window.__perm(${JSON.stringify({ windows: ["main"], stream: ai.stream, sessionEpoch: 1, ev: { t: "tui", asking: true } })})`);
await sleep(400);
check("⑬ tui asking → answer-in-terminal instead of the input", await ev(`JSON.stringify([!!document.querySelector('[data-pane="${ai.id}"] [data-flip-answer]'), !!document.querySelector('[data-pane="${ai.id}"] [data-flip-input]')])`), JSON.stringify([true, false]));
await shot("convo-tui-asking.png");
await ev(`window.__perm(${JSON.stringify({ windows: ["main"], stream: ai.stream, sessionEpoch: 1, ev: { t: "tui", asking: false } })})`);
await sleep(400);
check("⑬ tui done → input back", await ev(`JSON.stringify([!!document.querySelector('[data-pane="${ai.id}"] [data-flip-answer]'), !!document.querySelector('[data-pane="${ai.id}"] [data-flip-input]')])`), JSON.stringify([false, true]));
await ev(fakeAgentSignal({ stream: ai.stream, event: "stop", session: CONV, cli: "claude" }));
await setView(ai.id, "term");
await sleep(500);

// ⑭ 대화 면 입력 칸은 단축키에서 터미널처럼(2026-11-02): 전역 단축키(팔레트)가 먹고 · Ctrl+Shift+← 는 칸의 낱말 고르기로 남고 · 카드 글 칸은 여전히 가드
const key = async (code, k, vk, mods) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk, modifiers: mods });
};
const paletteOpen = () => ev(`!!document.querySelector('.palette')`);
await setView(ai.id, "convo");
await sleep(500);
check("⑭ composer carries the terminal-keys mark", await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-input]').hasAttribute('data-terminal-keys')`), true);
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-input]').focus()`);
await key("KeyP", "P", 80, 2 | 8);
await sleep(500);
check("⑭ Ctrl+Shift+P in the composer opens the palette", await paletteOpen(), true);
await key("Escape", "Escape", 27, 0);
await sleep(400);
check("⑭ palette closed", await paletteOpen(), false);
await ev(`(() => { const i = document.querySelector('[data-pane="${ai.id}"] [data-flip-input]'); i.focus(); i.value = 'hello world'; i.dispatchEvent(new Event('input', { bubbles: true })); i.setSelectionRange(11, 11); })()`);
await key("ArrowLeft", "ArrowLeft", 37, 2 | 8);
await sleep(200);
check("⑭ Ctrl+Shift+← stays word selection in the composer", await ev(`(() => { const i = document.querySelector('[data-pane="${ai.id}"] [data-flip-input]'); return JSON.stringify([i.selectionStart, i.selectionEnd, document.activeElement === i]); })()`), JSON.stringify([6, 11, true]));
await ev(`(() => { const i = document.querySelector('[data-pane="${ai.id}"] [data-flip-input]'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
// 카드의 거절 사유 칸 — 여전히 가드(팔레트 안 열림)
const gc = mkCard(ai.stream, { input: { command: "echo guard" } });
await sendReq(gc);
await sleep(500);
await ev(`document.querySelector('[data-tile-perm="${gc.requestId}"] [data-tile-perm-reason-open]').click()`);
await sleep(200);
await ev(`document.querySelector('[data-tile-perm="${gc.requestId}"] [data-tile-perm-reason]').focus()`);
await key("KeyP", "P", 80, 2 | 8);
await sleep(400);
check("⑭ card text field is still guarded (no palette)", await paletteOpen(), false);
await sendEv(ai.stream, { t: "gone", requestId: gc.requestId, reason: "hook-gone" });
await sleep(300);
await setView(ai.id, "term");
await sleep(500);

// ── Codex AI 타일 ──────────────────────────────────────────────────────────────
const cx = await openAi("codex");
console.log("codex tile:", JSON.stringify(cx));
await setView(cx.id, "convo");
await sleep(900);
check("⑥ codex trust hint shown", await ev(`!!document.querySelector('[data-pane="${cx.id}"] [data-codex-trust-hint]')`), true);
// 2026-11-02 — 위쪽 한 줄이 아니라 입력 칸 바로 위 말풍선
const hintPlace = () => ev(`(() => { const h = document.querySelector('[data-pane="${cx.id}"] [data-codex-trust-hint]'); const c = document.querySelector('[data-pane="${cx.id}"] [data-flip-input]').parentElement;
  const talk = document.querySelector('[data-pane="${cx.id}"] [data-flip-convo]').getBoundingClientRect(); const hr = h.getBoundingClientRect(); const cr = c.getBoundingClientRect();
  return JSON.stringify({ next: h.parentElement.nextElementSibling?.classList.contains('composer-slot') ?? false, gap: Math.round(cr.top - hr.bottom), lowerHalf: hr.top > talk.top + talk.height / 2,
    inside: hr.left >= talk.left - 0.5 && hr.right <= talk.right + 0.5, noOverflow: h.scrollWidth <= h.clientWidth + 1 }); })()`);
check("⑥ hint sits right above the composer", JSON.parse(await hintPlace()), { next: true, gap: 8, lowerHalf: true, inside: true, noOverflow: true });
await shot("perm-codex-hint.png");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await sleep(900);
const hintPhone = JSON.parse(await hintPlace());
check("⑥ phone: hint above composer · fits width", [hintPhone.next, hintPhone.gap >= 0 && hintPhone.gap <= 12, hintPhone.inside, hintPhone.noOverflow], [true, true, true, true]);
await shot("perm-codex-hint-phone.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(600);
await ev(`document.querySelector('[data-pane="${cx.id}"] [data-codex-trust-hint-close]').click()`);
await sleep(300);
check("⑥ hint closed · remembered", await ev(`JSON.stringify([!!document.querySelector('[data-pane="${cx.id}"] [data-codex-trust-hint]'), localStorage.getItem('aynx:codex-hook-trust-hint')])`), JSON.stringify([false, "closed"]));
await setView(cx.id, "term");
await sleep(700);
const cxCard = mkCard(cx.stream, { cli: "codex", input: { command: "New-Item -Path a.txt -ItemType File", description: "Create a.txt" }, deadlineAt: Date.now() + 120_000 });
await sendReq(cxCard);
await sleep(500);
check("⑥ codex terminal face → band (on top)", await bandVisible(cx.id), "visible");
await shot("perm-codex-band.png");
await ev(`document.querySelector('[data-pane="${cx.id}"] [data-tile-perm-band]').click()`);
await sleep(800);
check("⑥ band → convo face · card there · band gone", JSON.stringify([await viewOf(cx.id), await cardsIn(cx.id), await ev(`!!document.querySelector('[data-pane="${cx.id}"] [data-tile-perm-band]')`)]), JSON.stringify(["convo", ["command"], false]));

// ⑦ 폰 폭 — 터치 · 390x844
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Emulation.setEmitTouchEventsForMouse", { enabled: true, configuration: "mobile" });
await sleep(1200);
const sizes = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-tile-perm="${cxCard.requestId}"] .perm-actions .btn, [data-tile-perm="${cxCard.requestId}"] [data-tile-perm-release]')].map((b) => Math.round(b.getBoundingClientRect().height)))`));
check("⑦ phone: touch buttons ≥ 32px", sizes.length >= 3 && sizes.every((h) => h >= 32), true);
console.log("phone button heights:", JSON.stringify(sizes));
await shot("perm-phone.png");
await send("Emulation.setTouchEmulationEnabled", { enabled: false });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });

check("⑧ console errors", errors, []);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
