// 헤드리스 검증 — **대화의 말 복사** (2026-11-14 — `TranscriptBody` 의 `copyable` · 목업 F1 · `transcript.ts` 의 `agentTurnCopies`).
//
// 스텁은 `code-to-term-chat-harness.mjs` 의 것(가짜 로컬 세션 · 훅 신호로 AI 타일 · 대화 면 `window.__tx` · 사이드 채팅 명령 · 통로)을 줄였다.
// 사이드 채팅은 기록이 있는 채팅(`conversation` = conv-c · 턴이 돌지 않음)으로 뜨고, 지금 턴은 통로로 손으로 흘린다.
// 대화 글: 턴 1 = 글 · 도구 · 글(제목 + 코드 울타리), 턴 2 = 글 하나.
//
// 보는 것(판 넷 — 로컬 사이드 채팅 · 로컬 AI 타일 대화 면 · 원격 데스크톱 사이드 채팅 · 원격 폰 사이드 채팅):
// ① 사람 말풍선마다 [복사] 하나 — 호버 전 숨김(자리는 있음) · 호버에 보임 · 말풍선 바로 아래 · 오른쪽 끝 맞춤
// ② 누르면 클립보드 = 말풍선 글 그대로 · 토스트 "복사했습니다"
// ③ 에이전트 답 [복사]는 턴마다 하나 — 그 턴의 마지막 에이전트 줄 안 · 다음 줄은 사람 말(또는 끝) · 왼쪽 끝 맞춤
// ④ 에이전트 [복사] = 그 턴의 글 조각만 빈 줄로(도구 기록 없음 · 코드 울타리 그대로)
// ⑤ 키보드 — 말풍선에 포커스 → Tab = 그 [복사] · 보임
// ⑥ 진행 중 턴 — 그 턴엔 에이전트 [복사] 없음(사이드 채팅 = 통로의 지금 턴 · AI 타일 = 훅 start) · 첨부 칩이 있는 지금 턴 사람 말의 [복사]에 첨부 이름이 없다
// ⑦ 폰 — 말풍선을 한 번 누르면 보이고 다른 곳을 누르면 숨는다 · 단추를 누르면 복사
// ⑧ 콘솔 오류 0(`stub:` 거절 제외)
// ⑨ 에이전트 답 [문서로 내보내기](C안) — [복사] 바로 오른쪽 · 누르면 상자(이름 = 첫 제목 · 폴더 = 채팅 폴더 / 타일 폴더 · [바꾸기]는 집 PC 창만) ·
//    [만들기] → 그 폴더에 만들고 답 글(도구 기록 없음)을 씀 · 문서 타일(AI 타일 오른쪽 · 사이드 채팅 = 지금 탭 곁 · 원격 = 집 PC 요청)
// ⑩ 같은 이름 → 덮어쓰지 않음 · 상자에 까닭 · Esc 로 닫힘. 파일은 디스크에 쓰지 않는다(스텁의 `window.__files` 표).
// ⑪ 기록의 파일 첨부(2026-11-14 · 판 32) — 사람 말 U2 에 `files`(Rust `parse_file_refs` 가 꼬리를 떼고 남긴 칸 — 스텁은 그 결과 모양을 준다):
//    칩 = 이름만(보낼 때와 같은 `data-sent-file`) · 말풍선 글에 `Attached file:` 없음 · [복사] = 꼬리 없는 본문(사이드 채팅 · 원격 데스크톱 · 폰)
//    · AI 타일 대화 면(앱 첨부 자리 경로를 Rust `strip_attach_paths` 가 걷은 `files` — 같은 칩 · flip-files.png)
// ⑫ 막 보낸 그림(2026-11-14) — 입력 칸에 그림 + 파일을 붙여 보내면 꼬리 말풍선에 그림 하나(`data-sent-pic` — 입력 칸 미리보기) + 파일 이름 칩 ·
//    턴이 끝나 기록이 그 말을 받으면(`pictures`) 꼬리의 그림은 걷히고 기록 그림 하나만(둘이 함께 서지 않는다) · 기록 글 맨 앞 `[Image #1]` 은 숨김 ·
//    사이드 채팅 · 원격 · 폰
//
//   node scripts/dev/run-harness.mjs msg-actions-harness.mjs <outdir> --size 1280x860
//     → <outdir>/sent-chat.png · sent-chat-after.png · sent-remote*.png · sent-phone*.png · files-chat.png · files-remote.png · files-phone.png · copy-chat-hover.png · copy-chat-agent.png · copy-ai-hover.png · copy-ai-agent.png · copy-remote.png · copy-phone-tap.png
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
import fs from "node:fs";
import zlib from "node:zlib";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9279"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1446";
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
const evj = async (e) => {
  const v = await ev(e);
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const p = path.join(outdir, name);
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
      console.log("PNG " + path.resolve(p));
      return;
    }
    await sleep(400);
  }
};
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
const mouse = (type, x, y, extra = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
const hover = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
const clickXY = async (x, y) => {
  await hover(x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
  await sleep(250);
};
const tap = async (x, y) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await sleep(350);
};
const TAB = async () => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "Tab", key: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Tab", key: "Tab", windowsVirtualKeyCode: 9, nativeVirtualKeyCode: 9 });
  await sleep(250);
};

let bad = 0;
const rows = [];
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  rows.push([okj ? "PASS" : "FAIL", name, JSON.stringify(got), okj ? "" : JSON.stringify(want)]);
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
  return okj;
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const PANES = importApp("app/panes.svelte.ts");

// ── 대화 글 ───────────────────────────────────────────────────────────────────────
const F = "\u0060".repeat(3);
const U1 = "how do I install?";
const A1 = "먼저 확인합니다.";
const A2 = ["# 설치 안내", "", "의존성을 받습니다:", "", F + "bash", "npm ci", F, "", "끝."].join("\n");
const U2 = "고마워";
const A3 = "천만에요.";
const TURN1 = `${A1}\n\n${A2}`;
const LIVE_USER = "이 그림도 봐 줘";

const stub = (remote) => `
  performance.setResourceTimingBufferSize(10000);
  ${remote ? "window.__AYNX_REMOTE__ = true;" : ""}
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = []; window.__writes = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  window.__sideChan = null; window.__sideIdx = 0;
  window.__sideEmit = (msg) => { const cb = cbs.get(window.__sideChan); if (!cb) return false; cb({ index: window.__sideIdx++, message: msg }); return true; };
  // 클립보드 — 진짜 쓰기를 그대로 부르고 쓴 글만 적는다
  window.__clip = [];
  try {
    const orig = navigator.clipboard.writeText.bind(navigator.clipboard);
    navigator.clipboard.writeText = (t) => { window.__clip.push(t); return orig(t); };
  } catch {}
  let nextSession = 100;
  // 파일 — 디스크에 쓰지 않는다(이 표에만). 만들기는 같은 이름이면 [exists] 로 거절(백엔드와 같은 꼴)
  window.__files = {}; window.__fileOps = []; window.__requests = [];
  const fileEntry = (p) => ({ name: p.split(/[\\\\/]/).pop(), path: p, kind: 'file', size: (window.__files[p] ?? '').length, mtime: 1700000000, mode: null, symlinkTarget: null, linkIsDir: false, hidden: false });
  const T0 = Date.now() - 3600_000;
  const it = (i, role, text, tool = null) => ({ role, text, truncated: false, images: 0, tool, at: T0 + i * 1000 });
  window.__tx = [
    it(1, 'user', ${JSON.stringify(U1)}),
    it(2, 'assistant', ${JSON.stringify(A1)}),
    it(3, 'tool', null, { name: 'Bash', summary: 'npm view aynx', input: 'npm view aynx', inputTruncated: false, output: 'TOOL-OUTPUT-SHOULD-NOT-COPY', outputTruncated: false, error: false }),
    it(4, 'assistant', ${JSON.stringify(A2)}),
    { ...it(5, 'user', ${JSON.stringify(U2)}), files: ['main.ts', 'spec (2).pdf'] },
    it(6, 'assistant', ${JSON.stringify(A3)}),
  ];
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  const NOW = Date.now();
  const FILE = { v: 2, current: 'chat-a', last: { cli: 'claude', model: '', effort: '' },
    chats: [{ id: 'chat-a', cli: 'claude', model: '', effort: '', title: 'install', createdAt: NOW - 600000, usedAt: NOW - 60000, used: [], links: { claude: 'aaaaaaaa-bbbb-4ccc-8ddd-0000000000c1' } }] };
  const snap = () => ({
    link: null, chat: 'chat-a', cli: 'claude', model: '', effort: null, epoch: 1, leaseEpoch: 1, seq: 5, status: 'ready',
    conversationId: 'aaaaaaaa-bbbb-4ccc-8ddd-0000000000c1', cwd: null, mcpServers: [], liveTurn: [], pending: [],
  });
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: true }],
    mcp_status: { clis: [{ id: 'claude', name: 'Claude Code', installed: true, registered: true }, { id: 'codex', name: 'Codex', installed: true, registered: true }] },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, send_input: null, reap_window_sessions: null, session_log_path: null,
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chat_dir: 'C:/Users/me/side-chats/chat-a',
    side_chat_list: [{ chat: 'chat-a', cli: 'claude', model: '', effort: null, epoch: 1, status: 'ready', conversationId: 'aaaaaaaa-bbbb-4ccc-8ddd-0000000000c1', viewers: 1, detached: false }],
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
  };
  const label = ${remote ? "'remote-h-1'" : "'main'"};
  window.__label = label;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args, opts) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'local_create_file') {
        window.__fileOps.push(['create', args.path]);
        if (args.path in window.__files) return Promise.reject('[exists] already exists: ' + args.path);
        window.__files[args.path] = ''; return Promise.resolve(args.path);
      }
      if (cmd === 'local_write_text') { window.__fileOps.push(['write', args.path]); window.__files[args.path] = args.text; return Promise.resolve({ version: 'v' + window.__fileOps.length, size: args.text.length }); }
      if (cmd === 'local_stat') return (args.path in window.__files) ? Promise.resolve(fileEntry(args.path)) : Promise.reject('[not-found] ' + args.path);
      if (cmd === 'local_read_text') {
        const text = window.__files[args.path];
        return text === undefined ? Promise.reject('[not-found] ' + args.path) : Promise.resolve({ text, size: text.length, truncated: false, binary: false, lossy: false, version: 'v1' });
      }
      if (cmd === 'mirror_request') { window.__requests.push(args.request); return Promise.resolve(null); }
      if (cmd === 'write_session') { window.__writes.push(args); return Promise.resolve(null); }
      if (cmd === 'resize_session' || cmd === 'claim_session_size') return Promise.resolve(true);
      // ⑫ 보내기 — 사본 자리 경로(이름은 머리의 x-file-name) · 보내기 답 · 기록 그림(1x1 PNG)
      if (cmd === 'stage_agent_attachment') return Promise.resolve('C:/Users/h/AppData/Roaming/aynx-dev/attachments/' + 'a'.repeat(64) + '/' + decodeURIComponent(opts?.headers?.['x-file-name'] ?? 'x'));
      if (cmd === 'side_chat_send') return Promise.resolve({ epoch: 1, link: null });
      if (cmd === 'agent_conversation_image') return Promise.resolve(Uint8Array.from(atob(window.__histPng ?? ''), (c) => c.charCodeAt(0)).buffer);
      if (cmd === 'agent_conversation_transcript') {
        const all = window.__tx; const lim = args.limit ?? 40; const end = args.before ?? all.length; const start = Math.max(0, end - lim);
        return Promise.resolve({ items: all.slice(start, end), cursor: start > 0 ? start : null });
      }
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'side_chats_load') return Promise.resolve({ json: JSON.stringify(FILE), rev: 1 });
      if (cmd === 'side_chats_save') return Promise.resolve({ rev: 2 });
      if (cmd === 'side_chat_subscribe') { window.__sideChan = args.channel.id; return Promise.resolve(null); }
      if (cmd === 'side_chat_attach') return Promise.resolve(snap());
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`;

await send("Page.enable");
await send("Runtime.enable");
let scriptId = null;
const bootPage = async ({ remote, width, height, mobile = false }) => {
  if (scriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
  scriptId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: stub(remote) })).result.identifier;
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile, maxTouchPoints: mobile ? 5 : 1 });
  await send("Page.reload", { ignoreCache: true });
  if (mobile) await waitFor(`!!document.querySelector('.mobile-bar')`, 15000);
  else await waitBoot(ev);
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  const origin = await ev(`location.origin`);
  await send("Browser.grantPermissions", { origin, permissions: ["clipboardReadWrite", "clipboardSanitizedWrite"] });
  for (let i = 0; i < 50; i++) {
    if ((await ev(`(async () => { try { await ${W}; await ${SESS}; await ${PANES}; return true; } catch { return false; } })()`)) === true) break;
    await sleep(300);
  }
  await sleep(800);
};
const toastTexts = () => evj(`(async () => { const m = await ${importApp("lib/toast.svelte.ts")};
  if (!window.__toastLog) { window.__toastLog = []; setInterval(() => { for (const t of m.toasts) if (!window.__toastLog.includes(t.text)) window.__toastLog.push(t.text); }, 50); }
  for (const t of m.toasts) if (!window.__toastLog.includes(t.text)) window.__toastLog.push(t.text);
  return JSON.stringify(window.__toastLog); })()`);
const clearToastLog = () => ev(`(window.__toastLog = [], 1)`);
const lastClip = () => ev(`window.__clip[window.__clip.length - 1] ?? null`);
/** 그 상자의 사람 말풍선(글이 정확히 같은 것) */
const userLi = (root, text) => `[...document.querySelectorAll('${root} [data-item="user"]')].find((li) => li.querySelector('.utext')?.textContent === ${JSON.stringify(text)})`;
const rectOf = (expr) => evj(`(() => { const e = ${expr}; if (!e) return 'null'; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = e.getBoundingClientRect(); return JSON.stringify({ l: b.left, r: b.right, t: b.top, b: b.bottom, x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
const opacityOf = (expr) => ev(`(() => { const e = ${expr}; return e ? getComputedStyle(e).opacity : null; })()`);
const agentInfo = (root) =>
  evj(`JSON.stringify([...document.querySelectorAll('${root} [data-msg-copy="agent"]')].map((s) => { const li = s.closest('li'); const nx = li.nextElementSibling;
    const b = s.querySelector('button').getBoundingClientRect(); const lb = li.getBoundingClientRect();
    return { item: li.dataset.item, next: nx ? nx.dataset.item : null, leftOff: Math.round(b.left - lb.left), below: b.top >= lb.top + 4 }; }))`);

/** 데스크톱 — 호버 · 클릭 · 에이전트 · 키보드 */
const desktopRound = async (label, root, prefix) => {
  // ① 사람 말 [복사] — 호버 전 숨김 · 호버에 보임 · 자리
  const uli = userLi(root, U1);
  const ubtn = `(${uli})?.querySelector('[data-msg-copy="user"] button')`;
  check(`① ${label} 사람 말풍선마다 [복사] 하나`, await ev(`document.querySelectorAll('${root} [data-item="user"] [data-msg-copy="user"]').length`), 2);
  const lr = await rectOf(uli);
  await hover(1, 1);
  await sleep(300);
  const before = await opacityOf(ubtn);
  await hover(lr.x, lr.y);
  await sleep(350);
  const after = await opacityOf(ubtn);
  const br = await evj(`(() => { const b = ${ubtn}.getBoundingClientRect(); return JSON.stringify({ l: b.left, r: b.right, t: b.top, h: b.height }); })()`);
  check(`① ${label} 호버 전 숨김 · 호버에 보임 · 말풍선 바로 아래 · 오른쪽 끝`, [before, after, br.t >= lr.b - 0.5 && br.t - lr.b <= 4, Math.abs(br.r - lr.r) <= 1, Math.round(br.h)], ["0", "1", true, true, 22]);
  await shot(`${prefix}-hover.png`);
  // ② 누르면 그 글 · 토스트
  await clearToastLog();
  await toastTexts();
  await clickXY(Math.round((br.l + br.r) / 2), Math.round(br.t + br.h / 2));
  await sleep(300);
  check(`② ${label} 클립보드 = 말풍선 글 · 토스트`, [await lastClip(), (await toastTexts()).includes("복사했습니다")], [U1, true]);
  // ③ 에이전트 [복사] — 턴마다 하나 · 마지막 에이전트 줄 · 왼쪽 끝
  const ai = await agentInfo(root);
  check(`③ ${label} 에이전트 [복사] = 턴마다 하나(마지막 줄 안 · 다음 = 사람 말 · 끝) · 왼쪽 끝`, ai, [
    { item: "assistant", next: "user", leftOff: 0, below: true },
    { item: "assistant", next: null, leftOff: 0, below: true },
  ]);
  // ④ 턴 1 의 [복사] — 글 조각만(도구 기록 없음 · 울타리 그대로)
  const a1 = `document.querySelectorAll('${root} [data-msg-copy="agent"] button')[0]`;
  const ar = await rectOf(`(${a1}).closest('li')`);
  await hover(ar.x, ar.y);
  await sleep(350);
  const ab = await rectOf(a1);
  check(`③ ${label} 에이전트 [복사] 호버에 보임`, await opacityOf(a1), "1");
  await shot(`${prefix}-agent.png`);
  await clickXY(ab.x, ab.y);
  await sleep(300);
  const c1 = await lastClip();
  check(`④ ${label} 턴 1 = 글 조각만 빈 줄로 · 도구 기록 없음 · 울타리 그대로`, [c1, String(c1).includes("TOOL-OUTPUT"), String(c1).includes(F + "bash")], [TURN1, false, true]);
  // ⑤ 키보드 — 말풍선 포커스 → Tab = 그 [복사]
  await hover(1, 1);
  await ev(`(${userLi(root, U2)}).focus()`);
  await TAB();
  check(`⑤ ${label} Tab → 그 말풍선의 [복사] · 보임`, [await ev(`document.activeElement === (${userLi(root, U2)}).querySelector('[data-msg-copy="user"] button')`), await opacityOf(`document.activeElement`)], [true, "1"]);
};

// ── 에이전트 답 [문서로 내보내기](2026-11-14 C안 — `app/new-doc.svelte.ts` 의 `openExportDoc` · `doc/NewDocBox`) ──────────────────
const EXPORT_NAME = "설치 안내.md";
const allPanes = async () =>
  evj(`(async () => { const w = await ${W}; const s = await ${S};
    return JSON.stringify(w.residentWindowTabs().map((t) => ({ tab: t.id, root: t.root, panes: s.listPanes(t.root).map((p) => ({ id: p.id, kind: p.kind, path: p.path ?? null })) }))); })()`);
const BOX = `document.querySelector('[data-new-doc-box]')`;
const boxInfo = () =>
  evj(`(() => { const b = ${BOX}; if (!b) return 'null'; return JSON.stringify({ name: b.querySelector('input').value, dir: b.querySelector('[data-new-doc-dir]')?.dataset.newDocDir ?? null,
    title: b.querySelector('.menu-title')?.textContent.trim() ?? null, pick: !!b.querySelector('[data-new-doc-pick]'), error: b.querySelector('.error')?.textContent.trim() ?? null }); })()`);
/** 누르기 — 데스크톱은 마우스(먼저 그 줄 위에 올려 단추가 보이게), 폰은 손가락 */
const press = async (expr, phone, revealExpr = null) => {
  if (revealExpr) {
    const rr = await rectOf(revealExpr);
    if (phone) await tap(rr.l + 4, rr.t + 8);
    else await hover(rr.x, rr.y);
    await sleep(300);
  }
  const r = await rectOf(expr);
  if (!r) return false;
  if (phone) await tap(r.x, r.y);
  else await clickXY(r.x, r.y);
  return true;
};
/**
 * 판 하나의 내보내기 — `open`: "tile"(그 AI 타일 오른쪽) · "chat"(지금 탭 곁 · 사이드 채팅 규칙) · "remote"(집 PC 에 요청).
 * `dirHas` = 미리 채운 폴더에 들어 있어야 할 조각 · `pick` = [바꾸기] 가 있어야 하나.
 */
/** 원격 창의 거울 — 집 PC 의 탭 하나(시작 화면)를 민다. 문서 타일은 그 곁에 요청으로 선다(`mirror_request`) */
const installMirror = async () =>
  ev(`(async () => {
    const s = await ${importApp("mirror/snapshot")};
    const startTab = { id: 'home-empty', title: 'Start', tabKey: 'tke', workspaceId: 'w1', root: { type: 'leaf', pane: { id: 'home-start', kind: 'start', tileKey: 'fks' } } };
    window.__home = { tabs: [startTab], active: 'home-empty' };
    window.__emit('mirror-layout', s.buildSnapshot({ source: 'home', workspace: { id: 'w1', name: 'W' }, tabs: window.__home.tabs, activeTabId: window.__home.active, focusOf: (t) => t.root.pane.id }));
    return 'ok';
  })()`);
const exportRound = async (label, root, { open, dirHas, pick, phone = false, prefix, aiPaneId = null }) => {
  check(`⑨ ${label} [문서로 내보내기] = 에이전트 [복사] 마다 하나 · [복사] 바로 오른쪽 · 이름표`,
    await evj(`JSON.stringify([...document.querySelectorAll('${root} [data-msg-copy="agent"]')].map((s) => { const b = s.querySelectorAll('button');
      return b.length === 2 && b[1].hasAttribute('data-msg-export') && b[1].getBoundingClientRect().left >= b[0].getBoundingClientRect().right - 0.5 && b[1].getAttribute('aria-label') === '문서로 내보내기'; }))`),
    [true, true]);
  const exp0 = `document.querySelectorAll('${root} [data-msg-export]')[0]`;
  await press(exp0, phone, `(${exp0}).closest('li')`);
  await waitFor(`!!${BOX}`, 3000);
  await sleep(300);
  const bi = await boxInfo();
  check(`⑨ ${label} 상자 — 이름 = 첫 제목 · 폴더 미리 채움 · [바꾸기] ${pick ? "있음" : "없음"}`,
    [bi?.name, String(bi?.dir ?? "").includes(dirHas), bi?.pick, String(bi?.title ?? "").startsWith("문서로 내보내기")], [EXPORT_NAME, true, pick, true]);
  await shot(`${prefix}-export-box.png`);
  const ops0 = await ev(`window.__fileOps.length`);
  const req0 = await ev(`window.__requests.length`);
  await press(`${BOX}.querySelector('.btn-primary')`, phone);
  await waitFor(`!${BOX}`, 4000);
  await sleep(800);
  const ops = await evj(`JSON.stringify(window.__fileOps.slice(${ops0}))`);
  const made = ops.find((o) => o[0] === "write")?.[1] ?? null;
  check(`⑨ ${label} [만들기] → 그 폴더에 만들고 답 글을 씀(도구 기록 없음) · 상자 닫힘`,
    [ops.map((o) => o[0]), String(made).endsWith(EXPORT_NAME), String(made).includes(dirHas), await ev(`window.__files[${JSON.stringify(made)}] ?? null`), await ev(`!!${BOX}`)],
    [["create", "write"], true, true, TURN1, false]);
  if (open === "remote") {
    const reqs = await evj(`JSON.stringify(window.__requests.slice(${req0}).map((r) => ({ op: r.op, kind: r.pane?.kind ?? null, path: r.pane?.path ?? null })))`);
    if (!reqs.some((r) => r.kind === "doc" && r.path === made)) console.log("requests:", JSON.stringify(reqs));
    check(`⑨ ${label} 집 PC 에 문서 타일 요청(그 파일)`, reqs.some((r) => r.kind === "doc" && r.path === made), true);
  } else {
    const tabs = await allPanes();
    const doc = tabs.flatMap((t) => t.panes).find((p) => p.kind === "doc" && p.path === made) ?? null;
    if (open === "tile") {
      const find = (n) => (n.type !== "split" ? null : n.a.type === "leaf" && n.a.pane.id === aiPaneId && n.b.type === "leaf" ? { dir: n.dir, b: n.b.pane.id } : find(n.a) ?? find(n.b));
      const sp = tabs.map((t) => find(t.root)).find((x) => x) ?? null;
      check(`⑨ ${label} 문서 타일 = 그 AI 타일 오른쪽(row 분할 b)`, [sp?.dir, sp?.b === doc?.id && !!doc], ["row", true]);
    } else {
      const active = await ev(`(async () => (await ${W}).activeTabId())()`);
      check(`⑨ ${label} 문서 타일이 섰다(지금 탭)`, !!doc && tabs.some((t) => t.tab === active && t.panes.some((p) => p.id === doc.id)), true);
    }
    check(`⑨ ${label} 문서 타일이 그 글을 보인다`, await waitFor(`(document.querySelector('[data-pane="${doc?.id}"]')?.innerText ?? '').includes('npm ci')`, 6000), true);
    await shot(`${prefix}-export-opened.png`);
  }
  // 같은 이름 — 덮어쓰지 않는다(상자에 까닭 · 닫히지 않음 · 쓰기 없음) · Esc 로 닫힘
  await press(exp0, phone, `(${exp0}).closest('li')`);
  await waitFor(`!!${BOX}`, 3000);
  await sleep(300);
  const ops1 = await ev(`window.__fileOps.length`);
  await press(`${BOX}.querySelector('.btn-primary')`, phone);
  await sleep(600);
  const bi2 = await boxInfo();
  const ops2 = await evj(`JSON.stringify(window.__fileOps.slice(${ops1}))`);
  check(`⑩ ${label} 같은 이름 → 덮어쓰지 않음(쓰기 없음 · 글 그대로) · 상자에 까닭`,
    [ops2.map((o) => o[0]), await ev(`window.__files[${JSON.stringify(made)}] ?? null`), bi2?.error ?? null], [["create"], TURN1, "같은 이름의 파일이 있습니다"]);
  await shot(`${prefix}-export-exists.png`);
  await ev(`${BOX}.querySelector('input').focus()`);
  await send("Input.dispatchKeyEvent", { type: "keyDown", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code: "Escape", key: "Escape", windowsVirtualKeyCode: 27, nativeVirtualKeyCode: 27 });
  await sleep(300);
  check(`⑩ ${label} Esc → 상자 닫힘`, await ev(`!!${BOX}`), false);
};

// ⑪ 기록의 파일 칩 — 이름만 · 글에 꼬리 없음 · [복사] = 본문만
async function filesRound(name, root, png, phone = false) {
  const li = userLi(root, U2);
  const got = await evj(`(() => { const li = ${li}; if (!li) return 'null'; return JSON.stringify({ chips: [...li.querySelectorAll('[data-sent-file]')].map((c) => c.textContent.trim()), icons: [...li.querySelectorAll('[data-sent-file]')].map((c) => !!c.querySelector('svg')), tail: li.innerText.includes('Attached file') }); })()`);
  check(`⑪ ${name} — 기록 사람 말의 파일 칩(파일 그림 + 이름) · 글에 꼬리 없음`, got, { chips: ["main.ts", "spec (2).pdf"], icons: [true, true], tail: false });
  const r = await rectOf(li);
  if (phone) await tap(r.x, r.y);
  else {
    await hover(r.x, r.y);
    await sleep(350);
  }
  await shot(png);
  const b = await rectOf(`(${li}).querySelector('[data-msg-copy="user"] button')`);
  if (phone) await tap(b.x, b.y);
  else await clickXY(b.x, b.y);
  await sleep(300);
  check(`⑪ ${name} — [복사] = 꼬리 없는 본문`, await lastClip(), U2);
}

// ⑫ 막 보낸 그림 → 기록 교체
const FIX = path.resolve(outdir, "fixtures");
fs.mkdirSync(FIX, { recursive: true });
const FIX_PNG = path.join(FIX, "shot.png");
const FIX_TS = path.join(FIX, "main.ts");
/** 눈에 보이는 단색 PNG(160x100 · 캡처용) — 1x1 이면 그림이 있어도 화면에 안 보인다 */
function solidPng(w, h, [r, g, b]) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const PNG_B64 = solidPng(160, 100, [70, 110, 200]).toString("base64");
const HIST_B64 = solidPng(160, 100, [60, 160, 110]).toString("base64");
fs.writeFileSync(FIX_PNG, Buffer.from(PNG_B64, "base64"));
fs.writeFileSync(FIX_TS, "export {};\n");
const SENT = "이 그림 봐 줘";
async function sentRound(name, root, prefix) {
  const r = await send("Runtime.evaluate", { expression: `document.querySelector('${root} input[type=file][data-side-chat-pick]')` });
  await send("DOM.setFileInputFiles", { objectId: r.result.result.objectId, files: [FIX_PNG, FIX_TS] });
  await waitFor(`document.querySelectorAll('${root} [data-flip-attachment]').length === 2 && !document.querySelector('${root} [data-flip-attachment].staging')`, 4000);
  await ev(`(() => { const ta = document.querySelector('${root} textarea[data-flip-input]'); ta.value = ${JSON.stringify(SENT)}; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  const c0 = await ev(`window.__calls.length`);
  const sb = await rectOf(`document.querySelector('${root} [data-flip-send]')`);
  await clickXY(sb.x, sb.y);
  await sleep(500);
  const li = userLi(root, SENT);
  const bubble = () => evj(`(() => { const li = ${li}; if (!li) return 'null'; return JSON.stringify({ sent: li.querySelectorAll('img[data-sent-pic]').length, hist: li.querySelectorAll('img.upic:not([data-sent-pic])').length, chips: [...li.querySelectorAll('[data-sent-file]')].map((c) => c.textContent.trim()), all: document.querySelectorAll('${root} img.upic').length }); })()`);
  check(`⑫ ${name} — 보낸 직후 꼬리 = 그림 하나(미리보기) + 파일 칩`, await bubble(), { sent: 1, hist: 0, chips: ["main.ts"], all: 1 });
  await shot(`${prefix}.png`);
  // 기록이 그 말을 받는다 — 사람 말(그림 자리 하나) + 답 → 턴 끝 → 꼬리가 걷히고 기록이 그린다
  const cid = await ev(`window.__calls.slice(${c0}).filter(([c]) => c === 'side_chat_send').map(([, a]) => a.clientId).pop() ?? null`);
  await ev(`window.__histPng = ${JSON.stringify(HIST_B64)}`);
  await ev(`(() => { const n = window.__tx.length; window.__tx.push({ role: 'user', text: ${JSON.stringify("[Image #1] " + SENT)}, truncated: false, images: 1, pictures: [{ at: 1, len: 10, n: 0, mime: 'image/png' }], tool: null, at: Date.now(), files: [] }, { role: 'assistant', text: '봤어요.', truncated: false, images: 0, tool: null, at: Date.now() }); })()`);
  await sideEv(6, { t: "turnStarted", turn: "t9" });
  await sideEv(7, { t: "userAccepted", clientId: cid, text: SENT, files: ["shot.png", "main.ts"] });
  await sideEv(8, { t: "turnEnded", outcome: "completed" });
  await waitFor(`(() => { const li = ${li}; return !!li && li.querySelectorAll('img.upic').length === 1 && li.querySelectorAll('img[data-sent-pic]').length === 0; })()`, 8000);
  await sleep(400);
  check(`⑫ ${name} — 기록 교체 뒤 그림 하나(기록 \`pictures\`) · 꼬리 그림 없음 · 같은 말풍선 하나`, [await bubble(), await ev(`[...document.querySelectorAll('${root} [data-item="user"] .utext')].filter((p) => p.textContent === ${JSON.stringify(SENT)}).length`)], [{ sent: 0, hist: 1, chips: [], all: 1 }, 1]);
  // 그림이 모두 그려졌다 — 기록 글 맨 앞의 `[Image #1]` 자리표는 화면 · [복사]에서 뗀다(`withoutImagePlaceholders`)
  check(`⑫ ${name} — 기록 글 맨 앞 [Image #1] 자리표 숨김`, await ev(`[...document.querySelectorAll('${root} [data-item="user"] .utext')].some((p) => p.textContent.includes('[Image #'))`), false);
  await shot(`${prefix}-after.png`);
}

// ════════════════════════════════════════════════════════════════════════════════
// 판 1 — 로컬 사이드 채팅
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;
const CHAT = importApp("app/chat-dock.svelte.ts");
const DOCK = "[data-chat-dock-body]";
await ev(`(async () => (await ${CHAT}).toggleChatDock())()`);
if (!check("0 사이드 채팅 기록이 섰다", await waitFor(`!!document.querySelector('${DOCK} [data-msg-copy]')`, 10000), true))
  console.log("dock:", await ev(`document.querySelector('${DOCK}')?.innerText.slice(0, 400) ?? 'no dock'`), await ev(`JSON.stringify(window.__calls.filter(([c]) => c.startsWith('side_chat') || c.startsWith('agent_conv')).map(([c, a]) => [c, a]))`));
await sleep(500);
await filesRound("사이드 채팅", DOCK, "files-chat.png");
await desktopRound("사이드 채팅", DOCK, "copy-chat");
await exportRound("사이드 채팅", DOCK, { open: "chat", dirHas: "Users\\h", pick: true, prefix: "copy-chat" });

// ⑥ 지금 턴(통로) — 그 턴엔 에이전트 [복사] 없음 · 첨부 칩 있는 사람 말의 [복사] = 글만
const sideEv = (s, e) => ev(`window.__sideEmit({ windows: [window.__label], chat: 'chat-a', epoch: 1, seq: ${s}, ev: ${JSON.stringify(e)} })`);
await sideEv(6, { t: "turnStarted", turn: "t2" });
await sideEv(7, { t: "userAccepted", clientId: null, text: LIVE_USER, files: ["shot.png"] });
await sideEv(8, { t: "textDelta", item: "m1", text: "보는 중" });
await sleep(700);
const liveUser = userLi(DOCK, LIVE_USER);
check("⑥ 사이드 채팅 지금 턴 — 에이전트 [복사] · [내보내기]는 기록의 두 턴뿐 · 첨부 칩이 선다",
  [await ev(`document.querySelectorAll('${DOCK} [data-msg-copy="agent"]').length`), await ev(`document.querySelectorAll('${DOCK} [data-msg-export]').length`), await ev(`(${liveUser})?.querySelector('[data-sent-file]')?.textContent ?? null`)], [2, 2, "shot.png"]);
const lur = await rectOf(liveUser);
await hover(lur.x, lur.y);
await sleep(350);
const lub = await rectOf(`(${liveUser}).querySelector('[data-msg-copy="user"] button')`);
await clickXY(lub.x, lub.y);
await sleep(300);
check("⑥ 지금 턴 사람 말 [복사] = 글만(첨부 이름 없음)", await lastClip(), LIVE_USER);

// ════════════════════════════════════════════════════════════════════════════════
// 판 2 — 로컬 AI 타일 대화 면
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
const panesNow = async () =>
  evj(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().map((t) => ({ tab: t.id, panes: s.listPanes(t.root).map((p) => ({ id: p.id, kind: p.kind, autorun: p.autorun ?? null, stream: p.historyStreamId ?? null, sid: ss.sessionOf(p.id) })) }))); })()`);
await ev(`(async () => (await ${PANES}).openAiInNewTab({ command: 'claude', id: 'claude' }))()`);
let ai = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  ai = (await panesNow()).flatMap((t) => t.panes).find((p) => p.autorun === "claude" && p.sid != null) ?? null;
  if (ai) break;
}
check("0 AI 타일이 섰다", !!ai, true);
const ESC = "\x1b", BEL = "\x07";
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${ESC}]7;file://pc/C:/proj${BEL}claude\r\n${ESC}]133;C${BEL}`)})`);
await sleep(500);
const CONV = "11111111-2222-4333-8444-0000000000cc";
await ev(fakeAgentSignal({ stream: ai.stream, event: "session", session: CONV, cli: "claude" }));
await sleep(300);
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-to="convo"]')?.click()`);
const CONVO = `[data-pane="${ai.id}"] [data-flip-convo]`;
check("0 대화 면 기록", await waitFor(`!!document.querySelector('${CONVO} [data-msg-copy]')`, 8000), true);
await sleep(600);
await filesRound("AI 대화 면", CONVO, "flip-files.png");
await desktopRound("AI 대화 면", CONVO, "copy-ai");
await exportRound("AI 대화 면", CONVO, { open: "tile", dirHas: "proj", pick: true, prefix: "copy-ai", aiPaneId: ai.id });
// ⑥ 실행 중(훅 start) — 끝 턴은 아직 쓰는 중 → 그 턴의 [복사] 없음 · 끝나면 다시
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await sleep(600);
const runningN = await ev(`document.querySelectorAll('${CONVO} [data-msg-copy="agent"]').length`);
const runningX = await ev(`document.querySelectorAll('${CONVO} [data-msg-export]').length`);
await ev(fakeAgentSignal({ stream: ai.stream, event: "stop", session: CONV, cli: "claude" }));
await sleep(600);
check("⑥ AI 대화 면 실행 중 = 끝 턴 [복사] · [내보내기] 없음 · 끝나면 다시", [runningN, runningX, await ev(`document.querySelectorAll('${CONVO} [data-msg-copy="agent"]').length`)], [1, 1, 2]);

// ════════════════════════════════════════════════════════════════════════════════
// 판 3 — 원격 데스크톱 사이드 채팅
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 1280, height: 860 });
await ev(`(() => { const s = document.createElement('style'); s.id = 'h-no-toast-pe'; s.textContent = '.toast { pointer-events: none !important; }'; document.head.append(s); })()`);
await ev(`(async () => (await ${CHAT}).toggleChatDock())()`);
check("0 원격 데스크톱 사이드 채팅 기록", await waitFor(`!!document.querySelector('${DOCK} [data-msg-copy]')`, 10000), true);
await sleep(500);
await filesRound("원격 데스크톱", DOCK, "files-remote.png");
await desktopRound("원격 데스크톱", DOCK, "copy-remote");
check("0 원격 데스크톱 거울", await installMirror(), "ok");
await sleep(800);
await exportRound("원격 데스크톱", DOCK, { open: "remote", dirHas: "Users\\h", pick: false, prefix: "copy-remote" });

// ════════════════════════════════════════════════════════════════════════════════
// 판 4 — 원격 폰 사이드 채팅(터치)
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 400, height: 844, mobile: true });
await ev(`(() => { const s = document.createElement('style'); s.textContent = '.toast { pointer-events: none !important; }'; document.head.append(s); })()`);
const PH = "[data-mobile-chat]";
await ev(`document.querySelector('[data-signal="side-chat"]')?.click()`);
check("0 폰 덮개 기록", await waitFor(`!!document.querySelector('${PH} [data-msg-copy]')`, 10000), true);
await sleep(800);
await filesRound("폰", PH, "files-phone.png", true);
const pli = userLi(PH, U1);
const pbtn = `(${pli})?.querySelector('[data-msg-copy="user"] button')`;
const pr = await rectOf(pli);
const op0 = await opacityOf(pbtn);
await tap(pr.x, pr.y);
const op1 = await opacityOf(pbtn);
await shot("copy-phone-tap.png");
// 다른 곳(에이전트 마지막 말의 글 — 링크 · 단추가 아닌 자리)을 누르면 숨는다
const other = await rectOf(`[...document.querySelectorAll('${PH} [data-item="assistant"] p')].pop()`);
await tap(other.l + 4, other.y);
const op2 = await opacityOf(pbtn);
check("⑦ 폰 — 누르기 전 숨김 · 말풍선 누르면 보임 · 다른 곳 누르면 숨음", [op0, op1, op2], ["0", "1", "0"]);
await tap(pr.x, pr.y);
const pb = await rectOf(pbtn);
await clearToastLog();
await toastTexts();
await tap(pb.x, pb.y);
await sleep(300);
check("⑦ 폰 — [복사]를 누르면 그 글 · 토스트", [await lastClip(), (await toastTexts()).includes("복사했습니다")], [U1, true]);
const pa = `document.querySelectorAll('${PH} [data-msg-copy="agent"] button')[0]`;
const par = await rectOf(`(${pa}).closest('li')`);
await tap(par.l + 4, par.t + 8);
const pab = await rectOf(pa);
check("⑦ 폰 — 에이전트 답을 누르면 [복사]가 보임", await opacityOf(pa), "1");
await tap(pab.x, pab.y);
await sleep(300);
check("⑦ 폰 — 에이전트 [복사] = 턴 1 글", await lastClip(), TURN1);
await shot("copy-phone-agent.png");
check("0 원격 폰 거울", await installMirror(), "ok");
await sleep(800);
await exportRound("원격 폰", PH, { open: "remote", dirHas: "Users\\h", pick: false, phone: true, prefix: "copy-phone" });

// ════════════════════════════════════════════════════════════════════════════════
// 판 5 — 막 보낸 그림(⑫): 로컬 사이드 채팅 · 원격 데스크톱 · 폰
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
await ev(`(async () => (await ${CHAT}).toggleChatDock())()`);
await waitFor(`!!document.querySelector('${DOCK} [data-msg-copy]')`, 10000);
await sleep(500);
await sentRound("사이드 채팅", DOCK, "sent-chat");
await bootPage({ remote: true, width: 1280, height: 860 });
await ev(`(async () => (await ${CHAT}).toggleChatDock())()`);
await waitFor(`!!document.querySelector('${DOCK} [data-msg-copy]')`, 10000);
await sleep(500);
await sentRound("원격 데스크톱", DOCK, "sent-remote");
await bootPage({ remote: true, width: 400, height: 844, mobile: true });
await ev(`document.querySelector('[data-signal="side-chat"]')?.click()`);
await waitFor(`!!document.querySelector('${PH} [data-msg-copy]')`, 10000);
await sleep(800);
await sentRound("폰", PH, "sent-phone");

// ⑧ 콘솔 오류
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑧ 콘솔 오류 · 예외 0", errors, []);
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
