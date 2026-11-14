// 헤드리스 검증 — **코드 블록 [터미널에 넣기] — 사이드 채팅 · AI 타일 대화 면** (2026-11-12 — `DocCodeBlock` · `app/code-to-term`
// · `SideChatFace` 의 `codeActions` · `pane/AiFlip` 의 `codeActions`).
//
// 스텁은 `convo-path-links-harness.mjs`(가짜 로컬 세션 + Channel 로 출력 먹이기 · 훅 신호로 AI 타일 · 대화 면 `window.__tx`)와
// `remote-chat-dock-harness.mjs`(사이드 채팅 명령 · 통로)를 합쳤다. 셸 세션은 열리면 곧 프롬프트(OSC 133 A/B) + 괄호 붙여넣기 켬
// (`ESC[?2004h`)을 스스로 먹인다 — `shellReadyForInsert`(그려짐 · 조용함 1초)가 선다. 원격 창은 거울(`mirror-layout`)로 탭을 세우고,
// `mirror_request` 의 새 탭 요청을 받으면 **집 PC 처럼 새 id** 의 셸 타일을 거울에 더한다(시청자 붙기 = `attach_session_viewer`).
//
// 보는 것(판 넷 — 로컬 사이드 채팅 · 로컬 AI 타일 · 원격 데스크톱 사이드 채팅 · 원격 폰 사이드 채팅):
// ① 셸 블록(bash · powershell · 언어 없음)에만 [터미널에 넣기], ts 는 [복사]만 · 자라는 꼬리의 닫히지 않은 울타리엔 단추 없음
// ② 셸 타일 하나 → 바로 넣기: `write_session` 바이트 = `codeForTerm`(주석 · 빈 줄 빠짐) + 괄호 붙여넣기 · Enter(\r) 없음 · 받는 타일로 포커스
// ③ 셸 타일 둘 → 고르기 상자(사이드 채팅 = "새 탭에 터미널 열기" · AI 타일 = "새 터미널 열기") · 줄 고르기 → 그 타일 · Esc → 닫힘 · 포커스 = 누른 단추
// ④ 셸 타일 없음 → 사이드 채팅: 새 탭 + 셸 준비 뒤 넣기 · AI 타일: 그 타일 오른쪽 분할에 새 셸 + 넣기
// ⑤ AI 타일 자신은 후보에 없음
// ⑥ 원격 데스크톱 · 폰(400x844): 있는 셸에 넣기 · 새 탭 요청 뒤 새로 나타난 셸에 넣기 · 폰은 넣은 뒤 덮개 닫힘
// ⑦ 콘솔 오류 0(`stub:` 거절 제외)
// ⑧ 두 번 넣기(2026-11-13 폰 실기) — 셸 없음 → 새 탭 → 다시(같은 셸) → 다른 탭을 보다가 그 셸 고르기(폰은 떼어 둔 시청자가 다시 붙은 뒤) ·
//    "세션이 끊겨 있습니다" 없음 — 집 PC 창 · 원격 데스크톱 · 원격 폰
//
//   node scripts/dev/run-harness.mjs code-to-term-chat-harness.mjs <outdir> --size 1280x860
//     → <outdir>/ctt-chat-blocks.png · ctt-chat-newtab.png · ctt-chat-picker.png · ctt-ai-blocks.png · ctt-ai-picker.png ·
//       ctt-ai-beside.png · ctt-remote.png · ctt-phone-before.png · ctt-phone-after.png
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
const VK = { Escape: 27, Enter: 13 };
const key = async (code) => {
  const vk = VK[code] ?? 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(200);
};
const mouse = (type, x, y, extra = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
/** 진짜 마우스로 누른다 — 화면에 들여 놓고(블록 위에 먼저 얹어 단추가 보이게) 가운데를 누른다 */
const clickAt = async (expr, hoverFirst = null) => {
  await ev(`(${expr})?.scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(250);
  if (hoverFirst) {
    const h = await evj(`(() => { const e = ${hoverFirst}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`);
    if (h) await mouse("mouseMoved", h.x, h.y, { buttons: 0 });
    await sleep(150);
  }
  // 자리가 가라앉을 때까지(폰 덮개가 미끄러져 드는 동안 재면 다른 곳을 누른다)
  const at = () => evj(`(() => { const e = ${expr}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
  let r = await at();
  for (let i = 0; i < 20 && r; i++) {
    await sleep(120);
    const r2 = await at();
    if (r2 && r2.x === r.x && r2.y === r.y) break;
    r = r2;
  }
  if (!r) return false;
  await mouse("mouseMoved", r.x, r.y, { buttons: 0 });
  await mouse("mousePressed", r.x, r.y);
  await mouse("mouseReleased", r.x, r.y);
  await sleep(200);
  return true;
};

let bad = 0;
const rows = [];
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  rows.push([okj ? "PASS" : "FAIL", name, JSON.stringify(got), okj ? "" : JSON.stringify(want)]);
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const PANES = importApp("app/panes.svelte.ts");

// ── 대화 글 — 셸 블록 셋 · ts 블록 하나 · 자라는 꼬리(닫힌 블록 하나 + 닫히지 않은 울타리) ───────────────────
const F = "\u0060".repeat(3);
const MSG = [
  "Install:",
  F + "bash",
  "# install deps",
  "npm ci",
  "",
  "echo done  # trailing",
  F,
  "PowerShell:",
  F + "powershell",
  "Get-Process | Select -First 3",
  F,
  "No language:",
  F,
  "ls -la",
  F,
  "TypeScript:",
  F + "ts",
  "const x = 1;",
  F,
  "",
].join("\n");
const TAIL = ["Closed in tail:", F + "bash", "echo closed", F, "Open:", F + "bash", "echo half"].join("\n");
const BR = (s) => `\x1b[200~${s.replace(/\n/g, "\r")}\x1b[201~`;
const WANT = { bash: BR("npm ci\necho done  # trailing"), powershell: BR("Get-Process | Select -First 3"), none: BR("ls -la") };

const ESC = "\x1b", BEL = "\x07";
const PROMPT = `${ESC}]133;A${BEL}PS C:\\> ${ESC}]133;B${BEL}${ESC}[?2004h`;

const stub = (remote) => `
  performance.setResourceTimingBufferSize(10000);
  ${remote ? "window.__AYNX_REMOTE__ = true;" : ""}
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = []; window.__writes = []; window.__requests = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  window.__sideChan = null; window.__sideIdx = 0;
  let nextSession = 100;
  const T0 = Date.now() - 3600_000;
  window.__tx = [
    { role: 'user', text: 'how do I install?', truncated: false, images: 0, tool: null, at: T0 + 1000 },
    { role: 'assistant', text: ${JSON.stringify(MSG)}, truncated: false, images: 0, tool: null, at: T0 + 2000 },
  ];
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  /** 새 셸 — 곧 프롬프트 + 괄호 붙여넣기 켬(셸이 준비된 모양) */
  const boot = (id) => setTimeout(() => window.__feed(id, ${JSON.stringify(PROMPT)}), 300);
  const NOW = Date.now();
  const FILE = { v: 2, current: 'chat-a', last: { cli: 'claude', model: '', effort: '' },
    chats: [{ id: 'chat-a', cli: 'claude', model: '', effort: '', title: 'install', createdAt: NOW - 600000, usedAt: NOW - 60000, used: [], links: {} }] };
  const snap = () => ({
    link: null, chat: 'chat-a', cli: 'claude', model: '', effort: null, epoch: 1, leaseEpoch: 1, seq: 5, status: 'running',
    conversationId: null, cwd: null, mcpServers: [],
    liveTurn: [
      { t: 'turnStarted', turn: 't1' },
      { t: 'userAccepted', clientId: null, text: 'how do I install?' },
      { t: 'text', item: 'i1', text: ${JSON.stringify(MSG)} },
      { t: 'textDelta', item: 'i2', text: ${JSON.stringify(TAIL)} },
    ],
    pending: [],
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
    side_chat_list: [{ chat: 'chat-a', cli: 'claude', model: '', effort: null, epoch: 1, status: 'running', conversationId: null, viewers: 1, detached: false }],
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
  };
  const label = ${remote ? "'remote-h-1'" : "'main'"};
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; boot(id); return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'attach_session_viewer') {
        const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, stream: args.stream }; boot(id);
        return Promise.resolve({ id, kind: 'local', lease: { stream: args.stream, sessionEpoch: 1, leaseEpoch: 1 }, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh', viewer: true, sizeOwner: true });
      }
      // 원격 창의 시청자는 집 PC 에 이미 붙은 세션만 본다(probe = attached) · 로컬 창은 새로 연다(none)
      if (cmd === 'probe_session') return Promise.resolve(${remote} ? { state: 'attached', kind: 'local', sessionEpoch: 1, checkpoint: null } : { state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'write_session') { window.__writes.push({ id: args.id ?? null, stream: args.stream ?? null, data: args.data, source: args.source ?? null }); return Promise.resolve(null); }
      if (cmd === 'resize_session' || cmd === 'claim_session_size') return Promise.resolve(true);
      if (cmd === 'agent_conversation_transcript') {
        const all = window.__tx; const lim = args.limit ?? 40; const end = args.before ?? all.length; const start = Math.max(0, end - lim);
        return Promise.resolve({ items: all.slice(start, end), cursor: start > 0 ? start : null });
      }
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'side_chats_load') return Promise.resolve({ json: JSON.stringify(FILE), rev: 1 });
      if (cmd === 'side_chats_save') return Promise.resolve({ rev: 2 });
      if (cmd === 'side_chat_subscribe') { window.__sideChan = args.channel.id; return Promise.resolve(null); }
      if (cmd === 'side_chat_attach') return Promise.resolve(snap());
      if (cmd === 'mirror_request') { window.__requests.push(args.request); window.__onMirror?.(args.request); return Promise.resolve(null); }
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
/** 판 하나를 새로 띄운다 — 주입 스크립트를 갈고 크기를 맞춘 뒤 리로드 */
const bootPage = async ({ remote, width, height, mobile = false }) => {
  if (scriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
  scriptId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: stub(remote) })).result.identifier;
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send("Page.reload", { ignoreCache: true });
  if (mobile) await waitFor(`!!document.querySelector('.mobile-bar')`, 15000);
  else await waitBoot(ev);
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (let i = 0; i < 50; i++) {
    if ((await ev(`(async () => { try { await ${W}; await ${SESS}; await ${PANES}; return true; } catch { return false; } })()`)) === true) break;
    await sleep(300);
  }
  await sleep(800);
};

const panesNow = async () =>
  evj(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().map((t) => ({ tab: t.id, panes: s.listPanes(t.root).map((p) => ({ id: p.id, kind: p.kind, autorun: p.autorun ?? null, stream: p.historyStreamId ?? null, sid: ss.sessionOf(p.id) })) }))); })()`);
const activeTabId = () => ev(`(async () => (await ${W}).activeTabId())()`);
const focusedId = () => ev(`(async () => (await ${W}).focusedPane()?.id ?? null)()`);
/** 키보드 포커스가 그 타일의 xterm 입력 칸에 있는가 */
const termFocused = (paneId) => ev(`!!document.activeElement?.closest('[data-pane="${paneId}"]') && document.activeElement.classList.contains('xterm-helper-textarea')`);
const STR = {
  ko: { "files.doc.codeterm.picker.new": "새 터미널 열기", "files.doc.codeterm.picker.newTab": "새 탭에 터미널 열기" },
  en: { "files.doc.codeterm.picker.new": "Open a new terminal", "files.doc.codeterm.picker.newTab": "Open a terminal in a new tab" },
};
/** 상자 줄 글 — 화면 언어(ko · en) 기준 */
const tr = async (k) => STR[(await ev(`document.documentElement.lang`)) === "en" ? "en" : "ko"][k];
const writesSince = async (n) => evj(`JSON.stringify(window.__writes.slice(${n}).filter((w) => w.source === 'paste'))`);
const writeCount = () => ev(`window.__writes.length`);
const waitWrite = async (n0, ms = 9000) => {
  for (let i = 0; i < ms / 200; i++) {
    const w = await writesSince(n0);
    if (w.length) return w;
    await sleep(200);
  }
  return [];
};
const shellReady = async (paneId) =>
  waitFor(`(async () => { const ta = (await ${importApp("lib/term-actions.ts")}).termActionsOf(${JSON.stringify(paneId)}); return !!ta && ta.screenLines().join('').includes('PS C:'); })()`, 10000);
const newShellHere = async () => {
  const before = new Set((await panesNow()).flatMap((t) => t.panes.map((p) => p.id)));
  await ev(`(async () => (await ${PANES}).openDefaultShell())()`);
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    const p = (await panesNow()).flatMap((t) => t.panes).find((x) => !before.has(x.id) && x.kind === "local" && x.sid != null);
    if (p) {
      await shellReady(p.id);
      return p;
    }
  }
  return null;
};

// 사이드 채팅 면의 블록
const DOCK_BODY = (root) => `document.querySelector('${root}')`;
const blockInfo = (root) =>
  evj(`(() => { const r = ${DOCK_BODY(root)}; if (!r) return 'null';
    return JSON.stringify([...r.querySelectorAll('pre')].map((pre) => { const b = pre.closest('[data-code-block]');
      return { text: pre.textContent.trim().split('\\n')[0], lang: b?.querySelector('.head .lang')?.textContent ?? null, dcb: !!b, term: !!b?.querySelector('[data-code-term]'), copy: !!b?.querySelector('[data-code-copy]') }; })); })()`);
const termBtn = (root, firstLine) =>
  `[...${DOCK_BODY(root)}.querySelectorAll('[data-code-block]')].find((b) => b.querySelector('pre')?.textContent.trim().startsWith(${JSON.stringify(firstLine)}))?.querySelector('[data-code-term]')`;
const blockOf = (root, firstLine) =>
  `[...${DOCK_BODY(root)}.querySelectorAll('[data-code-block]')].find((b) => b.querySelector('pre')?.textContent.trim().startsWith(${JSON.stringify(firstLine)}))`;
const pressTerm = (root, firstLine) => clickAt(termBtn(root, firstLine), blockOf(root, firstLine));
const pickerInfo = () =>
  evj(`(() => { const p = document.querySelector('[data-code-term-picker]'); if (!p) return 'null';
    return JSON.stringify({ rows: [...p.querySelectorAll('[data-code-term-row]')].map((r) => r.getAttribute('data-code-term-row')), newText: p.querySelector('[data-code-term-new] .name')?.textContent.trim() ?? null }); })()`);
const pickerOpen = () => ev(`!!document.querySelector('[data-code-term-picker]')`);

/** ①: 블록 모양 판정(사이드 채팅 · 대화 면 공용) */
const checkBlocks = async (label, root, withTail) => {
  const info = await blockInfo(root);
  console.log(label, "blocks:", JSON.stringify(info));
  const by = (t) => info?.find((b) => b.text === t) ?? null;
  check(`① ${label} bash → [복사] · [터미널에 넣기]`, [by("# install deps")?.lang, by("# install deps")?.copy, by("# install deps")?.term], ["bash", true, true]);
  check(`① ${label} powershell → [터미널에 넣기]`, [by("Get-Process | Select -First 3")?.lang, by("Get-Process | Select -First 3")?.term], ["powershell", true]);
  check(`① ${label} 언어 없음 → 띠 없이 떠 있는 단추 · [터미널에 넣기]`, [by("ls -la")?.dcb, by("ls -la")?.lang, by("ls -la")?.term], [true, null, true]);
  check(`① ${label} ts → [복사]만`, [by("const x = 1;")?.lang, by("const x = 1;")?.copy, by("const x = 1;")?.term], ["ts", true, false]);
  if (withTail) {
    check(`① ${label} 자라는 꼬리의 닫힌 블록 → 단추 있음`, by("echo closed")?.term ?? null, true);
    check(`① ${label} 자라는 꼬리의 닫히지 않은 울타리 → 머리 띠 · 단추 없음`, [by("echo half")?.dcb, by("echo half")?.term], [false, false]);
  }
};

// ════════════════════════════════════════════════════════════════════════════════
// 판 1 — 로컬 창 사이드 채팅
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;
const CHAT = importApp("app/chat-dock.svelte.ts");
const DOCK = "[data-chat-dock-body]";
const openDock = async () => {
  if (await ev(`document.querySelector('[data-chat-dock]')?.classList.contains('open') ?? false`)) return true;
  await ev(`(async () => (await ${CHAT}).toggleChatDock())()`);
  return waitFor(`!!document.querySelector('${DOCK} [data-code-block]')`, 8000);
};
check("0 로컬 — 채팅 독이 열리고 에이전트 말이 선다", await openDock(), true);
await sleep(500);
await checkBlocks("사이드 채팅", DOCK, true);
await shot("ctt-chat-blocks.png");

// ④ 셸 타일 없음 → 상자(새 탭 줄만) → Esc 는 단추로 → 다시 → 새 탭 + 준비 뒤 넣기
const tabs0 = await panesNow();
console.log("tabs at boot:", JSON.stringify(tabs0));
check("④ (준비) 부팅 뒤 셸 타일 없음", tabs0.flatMap((t) => t.panes).filter((p) => p.kind === "local").length, 0);
await pressTerm(DOCK, "# install deps");
await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
const newTabText = await tr("files.doc.codeterm.picker.newTab");
check("④ 사이드 채팅 · 셸 없음 → 상자 = 새 탭 줄만", await pickerInfo(), { rows: [], newText: newTabText });
await sleep(300);
await key("Escape");
check("③ Esc → 상자 닫힘 · 포커스 = 누른 단추", [await pickerOpen(), await ev(`document.activeElement === (${termBtn(DOCK, "# install deps")})`)], [false, true]);
await pressTerm(DOCK, "# install deps");
await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
let w0 = await writeCount();
const tabsBeforeNew = (await panesNow()).map((t) => t.tab);
await clickAt(`document.querySelector('[data-code-term-picker] [data-code-term-new]')`);
let got = await waitWrite(w0, 10000);
let tabsNow = await panesNow();
const newTab = tabsNow.find((t) => !tabsBeforeNew.includes(t.tab));
const sh1 = newTab?.panes.find((p) => p.kind === "local") ?? null;
check("④ 새 탭이 생기고 셸 타일 하나", [!!newTab, newTab?.panes.length ?? 0, !!sh1], [true, 1, true]);
check("④ 셸 준비 뒤 넣기 — 바이트 = 주석 · 빈 줄 뺀 글 · 괄호 붙여넣기 · Enter 없음", got.map((w) => [w.id, w.data]), [[sh1?.sid, WANT.bash]]);
check("④ 지금 탭 = 새 탭 · 포커스 = 그 셸", [await activeTabId(), await focusedId()], [newTab?.tab, sh1?.id]);
await sleep(400);
check("④ 키보드 포커스가 받은 셸의 입력 칸", await termFocused(sh1?.id), true);
await shot("ctt-chat-newtab.png");

// ② 셸 타일 하나(이 탭) → 바로 넣기
check("② (준비) 독이 다시 열림", await openDock(), true);
w0 = await writeCount();
await pressTerm(DOCK, "Get-Process");
got = await waitWrite(w0, 3000);
check("② 셸 하나 → 상자 없이 바로 넣기 · Enter 없음", [await pickerOpen(), got.map((w) => [w.id, w.data])], [false, [[sh1.sid, WANT.powershell]]]);
check("② 바이트 끝에 \\r 없음(실행 안 함)", got.every((w) => !w.data.endsWith("\r") && !w.data.replace(/\x1b\[200~[\s\S]*?\x1b\[201~/g, "").includes("\r")), true);
await sleep(400);
check("② 포커스 = 받은 셸 · 입력 칸", [await focusedId(), await termFocused(sh1.id)], [sh1.id, true]);

// ③ 셸 타일 둘 → 상자 → 줄 고르기
const sh2 = await newShellHere();
check("③ (준비) 같은 탭에 셸 둘째", !!sh2, true);
await openDock();
await pressTerm(DOCK, "ls -la");
await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
const pk = await pickerInfo();
check("③ 사이드 채팅 · 셸 둘 → 상자 = 두 셸 + 새 탭 줄", [pk?.rows?.slice().sort(), pk?.newText], [[sh1.id, sh2.id].sort(), newTabText]);
await shot("ctt-chat-picker.png");
w0 = await writeCount();
await clickAt(`document.querySelector('[data-code-term-picker] [data-code-term-row="${sh1.id}"]')`);
got = await waitWrite(w0, 3000);
check("③ 줄 고르기 → 그 타일에 넣기 · 상자 닫힘", [got.map((w) => [w.id, w.data]), await pickerOpen()], [[[sh1.sid, WANT.none]], false]);
await sleep(400);
check("③ 포커스 = 고른 셸", [await focusedId(), await termFocused(sh1.id)], [sh1.id, true]);
await openDock();
await pressTerm(DOCK, "ls -la");
await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
await sleep(300);
await key("Escape");
check("③ 셸 둘 · Esc → 닫힘 · 포커스 = 누른 단추", [await pickerOpen(), await ev(`document.activeElement === (${termBtn(DOCK, "ls -la")})`)], [false, true]);

// ════════════════════════════════════════════════════════════════════════════════
// 판 2 — 로컬 AI 타일 대화 면
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
await ev(`(async () => (await ${PANES}).openAiInNewTab({ command: 'claude', id: 'claude' }))()`);
let ai = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  ai = (await panesNow()).flatMap((t) => t.panes).find((p) => p.autorun === "claude" && p.sid != null) ?? null;
  if (ai) break;
}
check("0 AI 타일이 섰다", !!ai, true);
await sleep(500);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`claude\r\n${ESC}]133;C${BEL}`)})`);
await sleep(500);
await ev(fakeAgentSignal({ stream: ai.stream, event: "session", session: "11111111-2222-4333-8444-0000000000ab", cli: "claude" }));
await sleep(300);
await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-to="convo"]')?.click()`);
const CONVO = `[data-pane="${ai.id}"] [data-flip-convo]`;
check("0 대화 면에 에이전트 말", await waitFor(`!!document.querySelector('${CONVO} [data-code-block]')`, 8000), true);
await sleep(400);
await checkBlocks("AI 대화 면", CONVO, false);
await shot("ctt-ai-blocks.png");

// ④ 셸 없음 → 상자(새 터미널 줄만 · AI 타일 자신 없음) → 새 셸이 AI 타일 오른쪽 · 준비 뒤 넣기
await pressTerm(CONVO, "# install deps");
await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
const newText = await tr("files.doc.codeterm.picker.new");
check("④⑤ AI 대화 면 · 셸 없음 → 상자 = 새 터미널 줄만(AI 타일 줄 없음)", await pickerInfo(), { rows: [], newText });
await sleep(300);
await key("Escape");
check("③ AI · Esc → 닫힘 · 포커스 = 누른 단추", [await pickerOpen(), await ev(`document.activeElement === (${termBtn(CONVO, "# install deps")})`)], [false, true]);
await pressTerm(CONVO, "# install deps");
await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
w0 = await writeCount();
const aiTab = (await panesNow()).find((t) => t.panes.some((p) => p.id === ai.id)).tab;
await clickAt(`document.querySelector('[data-code-term-picker] [data-code-term-new]')`);
got = await waitWrite(w0, 10000);
const split = await evj(`(async () => { const w = await ${W}; const t = w.residentWindowTabs().find((x) => x.id === ${JSON.stringify(aiTab)});
  const find = (n) => { if (n.type !== 'split') return null; if (n.a.type === 'leaf' && n.a.pane.id === ${JSON.stringify(ai.id)} && n.b.type === 'leaf') return { dir: n.dir, b: n.b.pane.id, bKind: n.b.pane.kind }; return find(n.a) ?? find(n.b); };
  return JSON.stringify(t ? find(t.root) : null); })()`);
const aiTabPanes = (await panesNow()).find((t) => t.tab === aiTab)?.panes ?? [];
const sh3 = aiTabPanes.find((p) => p.id === split?.b) ?? null;
check("④ AI · 새 셸 = 같은 탭 · AI 타일 오른쪽 분할(row, a = AI · b = 새 셸)", [split?.dir, split?.bKind, aiTabPanes.length], ["row", "local", 2]);
check("④ AI · 준비 뒤 그 셸에 넣기 · Enter 없음", got.map((w) => [w.id, w.data]), [[sh3?.sid, WANT.bash]]);
check("④ AI · 포커스 = 새 셸 · 입력 칸", [await focusedId(), await termFocused(sh3?.id)], [sh3?.id, true]);
await shot("ctt-ai-beside.png");

// ② AI · 셸 하나 → 바로 넣기(AI 타일에는 안 감)
await ev(`(async () => { const w = await ${W}; w.focusTile(${JSON.stringify(aiTab)}, ${JSON.stringify(ai.id)}); })()`);
await sleep(400);
w0 = await writeCount();
await pressTerm(CONVO, "Get-Process");
got = await waitWrite(w0, 3000);
check("②⑤ AI · 셸 하나 → 바로 그 셸(AI 세션엔 안 씀)", [await pickerOpen(), got.map((w) => [w.id, w.data])], [false, [[sh3.sid, WANT.powershell]]]);

// ③ AI · 셸 둘 → 상자(AI 타일 없음 · 새 터미널 줄) → 줄 고르기
await ev(`(async () => { const w = await ${W}; w.focusTile(${JSON.stringify(aiTab)}, ${JSON.stringify(sh3.id)}); })()`);
await sleep(300);
const sh4 = await newShellHere();
check("③ (준비) AI 탭에 셸 둘째", !!sh4, true);
await pressTerm(CONVO, "ls -la");
await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
const pk2 = await pickerInfo();
check("③⑤ AI · 셸 둘 → 상자 = 두 셸(AI 타일 없음) + 새 터미널 줄", [pk2?.rows?.slice().sort(), pk2?.rows?.includes(ai.id), pk2?.newText], [[sh3.id, sh4.id].sort(), false, newText]);
await shot("ctt-ai-picker.png");
w0 = await writeCount();
await clickAt(`document.querySelector('[data-code-term-picker] [data-code-term-row="${sh4.id}"]')`);
got = await waitWrite(w0, 3000);
check("③ AI · 줄 고르기 → 그 셸", got.map((w) => [w.id, w.data]), [[sh4.sid, WANT.none]]);
check("⑤ AI 세션에는 붙여넣기가 한 번도 없음", await ev(`window.__writes.filter((w) => w.id === ${ai.sid} && w.source === 'paste').length`), 0);

// ════════════════════════════════════════════════════════════════════════════════
// 판 3 · 4 — 원격 창(데스크톱 · 폰): 거울로 셸 하나 · 새 탭 요청 → 집 PC 가 새 id 로 세운 셸
// ════════════════════════════════════════════════════════════════════════════════
const SNAP = importApp("mirror/snapshot");
/** 거울 상태(집 PC 의 탭들)를 이 페이지에 두고 민다 · 새 탭 요청을 받으면 새 id 의 셸 탭을 더해 다시 민다 */
const installMirror = async (withShell = true) =>
  ev(`(async () => {
    const s = await ${SNAP};
    let k = 0;
    const shellTab = (n) => ({ id: 'home-tab-' + n, title: 'PowerShell', tabKey: 'tk' + n, workspaceId: 'w1',
      root: { type: 'leaf', pane: { id: 'home-p' + n, kind: 'local', shell: 'pwsh', tileKey: 'fk' + n, historyStreamId: 'hs-' + n } } });
    const startTab = { id: 'home-empty', title: 'Start', tabKey: 'tke', workspaceId: 'w1', root: { type: 'leaf', pane: { id: 'home-start', kind: 'start', tileKey: 'fks' } } };
    window.__home = ${withShell} ?{ tabs: [shellTab(++k)], active: 'home-tab-1' } : { tabs: [startTab], active: 'home-empty' };
    window.__push = () => window.__emit('mirror-layout', s.buildSnapshot({ source: 'home', workspace: { id: 'w1', name: 'W' },
      tabs: window.__home.tabs, activeTabId: window.__home.active, focusOf: (t) => t.root.pane.id }));
    window.__onMirror = (req) => { if (req.op !== 'newTab' || !req.pane) return; const t = shellTab(++k); window.__home.tabs.push(t); window.__home.active = t.id;
      setTimeout(window.__push, 400); };
    window.__push();
    return 'ok';
  })()`);
const remoteRound = async (label, phone) => {
  check(`⑥ ${label} 거울 설치`, await installMirror(), "ok");
  // 원격 창의 안내 토스트("메인 PC 창이 닫혀 있어…")가 폰 덮개의 단추 위를 덮는다 — remote-chat-dock-harness 와 같이 이 판만 토스트를 숨긴다
  await ev(`(() => { const s = document.createElement('style'); s.textContent = '.toast { display: none !important; }'; document.head.append(s); })()`);
  let tabs = [];
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    tabs = await panesNow();
    if (tabs.some((t) => t.panes.some((p) => p.stream === "hs-1"))) break;
  }
  const r1 = tabs.flatMap((t) => t.panes).find((p) => p.stream === "hs-1") ?? null;
  check(`⑥ ${label} 거울의 셸 타일 · 시청자로 붙음`, [!!r1, await waitFor(`window.__calls.some(([c, a]) => c === 'attach_session_viewer' && a.stream === 'hs-1')`, 8000)], [true, true]);
  await shellReady(r1.id);
  // 사이드 채팅 열기 — 데스크톱은 독, 폰은 상태줄 말풍선 → 덮개
  const root = phone ? "[data-mobile-chat]" : DOCK;
  const openChat = async () => {
    if (phone) {
      if (!(await ev(`!!document.querySelector('[data-mobile-chat]')`))) await ev(`document.querySelector('[data-signal="side-chat"]')?.click()`);
      return waitFor(`!!document.querySelector('[data-mobile-chat] [data-code-block]')`, 8000);
    }
    return openDock();
  };
  check(`⑥ ${label} 사이드 채팅이 열림`, await openChat(), true);
  await sleep(500);
  if (phone) await shot("ctt-phone-before.png");
  // 있는 셸 하나 → 바로 넣기(원격도 write_session — 시청 임대의 stream)
  let n0 = await writeCount();
  await pressTerm(root, "Get-Process");
  let g = await waitWrite(n0, 4000);
  check(`⑥ ${label} 셸 하나 → 바로 넣기(stream hs-1) · Enter 없음`, g.map((w) => [w.stream, w.data]), [["hs-1", WANT.powershell]]);
  if (phone) {
    await sleep(500);
    check(`⑥ ${label} 넣은 뒤 채팅 덮개 닫힘`, await ev(`!!document.querySelector('[data-mobile-chat]')`), false);
    await shot("ctt-phone-after.png");
  } else {
    await sleep(400);
    check(`⑥ ${label} 포커스 = 받은 셸`, await focusedId(), r1.id);
  }
  // 새 탭 경로 — 셸이 다른 탭에만 있게 빈 탭을 하나 지금 탭으로(원격은 요청 — 집 PC 가 빈 탭을 세운다는 흉내는 거울에서)
  await ev(`(() => { window.__home.tabs.push({ id: 'home-empty', title: 'Start', tabKey: 'tke', workspaceId: 'w1', root: { type: 'leaf', pane: { id: 'home-start', kind: 'start', tileKey: 'fks' } } }); window.__home.active = 'home-empty'; window.__push(); })()`);
  await sleep(600);
  const emptyTab = (await panesNow()).find((t) => t.panes.some((p) => p.kind === "start"))?.tab ?? null;
  if (emptyTab) await ev(`(async () => (await ${W}).selectTab(${JSON.stringify(emptyTab)}))()`);
  await sleep(400);
  check(`⑥ ${label} (준비) 지금 탭에는 셸이 없다`, (await panesNow()).find((t) => t.tab === (emptyTab ?? ""))?.panes.some((p) => p.kind === "local") ?? null, false);
  check(`⑥ ${label} 사이드 채팅 다시 열림`, await openChat(), true);
  await sleep(400);
  await pressTerm(root, "# install deps");
  await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
  const pr = await pickerInfo();
  check(`⑥ ${label} 다른 탭에만 셸 → 상자 = 그 셸 + 새 탭 줄`, [pr?.rows, pr?.newText], [[r1.id], newTabText]);
  if (!phone) await shot("ctt-remote.png");
  n0 = await writeCount();
  const req0 = await ev(`window.__requests.length`);
  await clickAt(`document.querySelector('[data-code-term-picker] [data-code-term-new]')`);
  g = await waitWrite(n0, 12000);
  const reqs = await evj(`JSON.stringify(window.__requests.slice(${req0}).map((r) => [r.op, r.pane?.kind ?? null]))`);
  check(`⑥ ${label} 새 탭 요청 한 번(집 PC 에 newTab · 셸)`, reqs, [["newTab", "local"]]);
  check(`⑥ ${label} 요청 뒤 새로 나타난 셸(hs-2)에 준비 뒤 넣기`, g.map((w) => [w.stream, w.data]), [["hs-2", WANT.bash]]);
  const r2 = (await panesNow()).flatMap((t) => t.panes).find((p) => p.stream === "hs-2") ?? null;
  if (phone) {
    await sleep(500);
    check(`⑥ ${label} 새 탭 경로도 넣은 뒤 덮개 닫힘`, await ev(`!!document.querySelector('[data-mobile-chat]')`), false);
  } else {
    await sleep(400);
    check(`⑥ ${label} 포커스 = 새 셸`, await focusedId(), r2?.id ?? "?");
  }
};
/**
 * ⑧ (2026-11-13 실기 — 폰) 셸 없음 → [터미널에 넣기] → 새 탭(집 PC 가 새 id 로 세운 셸)에 넣기 → 사이드 채팅으로 돌아와 **다시** 넣기.
 * 둘째는 셸이 하나라 상자 없이 그 셸로 바로 간다 — "세션이 끊겨 있습니다" 없이 같은 셸(hs-1)에 넣어야 한다.
 */
/**
 * 이 판에서 한 번이라도 뜬 토스트 글(토스트 저장소를 100ms 마다 훑어 모은다 — 원격 판은 토스트를 CSS 로 숨기고, 넣기를 기다리는 동안
 * 6초짜리 안내가 걷힐 수 있어 지금 떠 있는 것만 보면 놓친다)
 */
const toastTexts = () => evj(`(async () => { const m = await ${importApp("lib/toast.svelte.ts")};
  if (!window.__toastLog) { window.__toastLog = new Set(); setInterval(() => { for (const t of m.toasts) window.__toastLog.add(t.text); }, 100); }
  for (const t of m.toasts) window.__toastLog.add(t.text);
  return JSON.stringify([...window.__toastLog]); })()`);
const remoteTwiceRound = async (label, phone) => {
  check(`⑧ ${label} 거울 설치(셸 없음 · 시작 탭 하나)`, await installMirror(false), "ok");
  await ev(`(() => { const s = document.createElement('style'); s.textContent = '.toast { display: none !important; }'; document.head.append(s); })()`);
  await waitFor(`(async () => (await ${W}).residentWindowTabs().length === 1)()`, 8000);
  const root = phone ? "[data-mobile-chat]" : DOCK;
  const openChat = async () => {
    if (phone) {
      if (!(await ev(`!!document.querySelector('[data-mobile-chat]')`))) await ev(`document.querySelector('[data-signal="side-chat"]')?.click()`);
      return waitFor(`!!document.querySelector('[data-mobile-chat] [data-code-block]')`, 8000);
    }
    return openDock();
  };
  check(`⑧ ${label} 사이드 채팅이 열림`, await openChat(), true);
  await sleep(500);
  await pressTerm(root, "# install deps");
  await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
  check(`⑧ ${label} 셸 없음 → 상자 = 새 탭 줄만`, (await pickerInfo())?.rows ?? null, []);
  let n0 = await writeCount();
  await clickAt(`document.querySelector('[data-code-term-picker] [data-code-term-new]')`);
  let g = await waitWrite(n0, 12000);
  check(`⑧ ${label} 첫째 — 새 탭의 셸(hs-1)에 넣기`, g.map((w) => [w.stream, w.data]), [["hs-1", WANT.bash]]);
  const r1 = (await panesNow()).flatMap((t) => t.panes).find((p) => p.stream === "hs-1") ?? null;
  await sleep(800);
  if (phone) check(`⑧ ${label} 첫째 뒤 덮개 닫힘`, await ev(`!!document.querySelector('[data-mobile-chat]')`), false);
  if (phone) await shot("ctt-phone-twice-1.png");
  const toasts0 = new Set(await toastTexts());
  console.log(`${label} panes after first:`, JSON.stringify(await panesNow()));
  // 사이드 채팅으로 돌아와 다시
  check(`⑧ ${label} 사이드 채팅으로 돌아옴`, await openChat(), true);
  // 사람은 채팅을 몇 초 읽고 누른다 — 폰 배치는 화면에 없는 타일의 시청자를 3초 뒤 뗀다(`mobile/policy` 의 `parkDelayMs`)
  await sleep(4500);
  n0 = await writeCount();
  await pressTerm(root, "Get-Process");
  g = await waitWrite(n0, 4000);
  const toasts = (await toastTexts()).filter((x) => !toasts0.has(x));
  console.log(`${label} panes at second:`, JSON.stringify(await panesNow()), "toasts:", JSON.stringify(toasts));
  check(`⑧ ${label} 둘째 — 상자 없이 같은 셸(hs-1)에 넣기 · 알림 없음`, [await pickerOpen(), g.map((w) => [w.stream, w.data]), toasts], [false, [["hs-1", WANT.powershell]], []]);
  if (phone) {
    await sleep(500);
    check(`⑧ ${label} 둘째 뒤 덮개 닫힘`, await ev(`!!document.querySelector('[data-mobile-chat]')`), false);
    await shot("ctt-phone-twice-2.png");
  } else {
    await sleep(400);
    check(`⑧ ${label} 둘째 — 포커스 = 그 셸`, await focusedId(), r1?.id ?? "?");
    await shot("ctt-remote-twice.png");
  }
  // 셋째 — 다른 탭(시작 탭)을 보다가 채팅으로 와서 넣기. 폰 배치는 화면에 없는 타일의 시청자를 3초 뒤 뗀다(세션 손잡이가 빈다) —
  // 그 셸을 상자에서 골라도 "세션이 끊겨 있습니다" 없이 그 셸이 다시 붙은 뒤 넣어야 한다.
  const startTab = (await panesNow()).find((t) => t.panes.some((p) => p.kind === "start"))?.tab ?? null;
  await ev(`(async () => (await ${W}).selectTab(${JSON.stringify(startTab)}))()`);
  await sleep(400);
  check(`⑧ ${label} 셋째 (준비) 지금 탭 = 시작 탭`, await activeTabId(), startTab);
  check(`⑧ ${label} 셋째 사이드 채팅으로 돌아옴`, await openChat(), true);
  await sleep(4500);
  const parked = await ev(`(async () => { const ta = (await ${importApp("lib/term-actions.ts")}).termActionsOf(${JSON.stringify(r1?.id ?? "")}); return ta ? ta.insertCode('') : null; })()`);
  console.log(`${label} 셋째 — 누르기 전 그 셸 창구의 상태(빈 글 넣기 시험):`, parked);
  const toasts1 = new Set(await toastTexts());
  await pressTerm(root, "ls -la");
  await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
  check(`⑧ ${label} 셋째 — 상자 = 다른 탭의 그 셸 + 새 탭 줄`, (await pickerInfo())?.rows ?? null, [r1?.id ?? "?"]);
  n0 = await writeCount();
  await clickAt(`document.querySelector('[data-code-term-picker] [data-code-term-row="${r1?.id ?? ""}"]')`);
  g = await waitWrite(n0, 8000);
  const toasts3 = (await toastTexts()).filter((x) => !toasts1.has(x));
  check(`⑧ ${label} 셋째 — 그 셸(hs-1)에 넣기 · 알림 없음`, [g.map((w) => [w.stream, w.data]), toasts3], [[["hs-1", WANT.none]], []]);
  await sleep(500);
  check(`⑧ ${label} 셋째 — 지금 탭 = 그 셸의 탭 · 포커스 = 그 셸`, [await activeTabId(), await focusedId()], [(await panesNow()).find((t) => t.panes.some((p) => p.id === r1?.id))?.tab ?? "?", r1?.id ?? "?"]);
  if (phone) await shot("ctt-phone-twice-3.png");
};

/** ⑧ 집 PC(로컬) 창 — 셸 없음 → 새 탭 → 다시 넣기 */
const localTwiceRound = async () => {
  check("⑧ 로컬 (준비) 셸 없음", (await panesNow()).flatMap((t) => t.panes).filter((p) => p.kind === "local").length, 0);
  check("⑧ 로컬 사이드 채팅이 열림", await openDock(), true);
  await sleep(400);
  await pressTerm(DOCK, "# install deps");
  await waitFor(`!!document.querySelector('[data-code-term-picker]')`, 3000);
  let n0 = await writeCount();
  await clickAt(`document.querySelector('[data-code-term-picker] [data-code-term-new]')`);
  let g = await waitWrite(n0, 10000);
  const sh = (await panesNow()).flatMap((t) => t.panes).find((p) => p.kind === "local") ?? null;
  check("⑧ 로컬 첫째 — 새 탭의 셸에 넣기", g.map((w) => [w.id, w.data]), [[sh?.sid, WANT.bash]]);
  await sleep(600);
  const toasts0 = new Set(await toastTexts());
  check("⑧ 로컬 사이드 채팅으로 돌아옴", await openDock(), true);
  await sleep(400);
  n0 = await writeCount();
  await pressTerm(DOCK, "Get-Process");
  g = await waitWrite(n0, 4000);
  check("⑧ 로컬 둘째 — 상자 없이 같은 셸 · 알림 없음", [await pickerOpen(), g.map((w) => [w.id, w.data]), (await toastTexts()).filter((x) => !toasts0.has(x))], [false, [[sh?.sid, WANT.powershell]], []]);
};

await bootPage({ remote: false, width: 1280, height: 860 });
await localTwiceRound();
await bootPage({ remote: true, width: 1280, height: 860 });
await remoteTwiceRound("원격 데스크톱", false);
await bootPage({ remote: true, width: 400, height: 844, mobile: true });
await remoteTwiceRound("원격 폰", true);
await bootPage({ remote: true, width: 1280, height: 860 });
await remoteRound("원격 데스크톱", false);
await bootPage({ remote: true, width: 400, height: 844, mobile: true });
await remoteRound("원격 폰", true);

// ⑦ 콘솔 오류
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑦ 콘솔 오류 · 예외 0", errors, []);
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
