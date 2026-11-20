// 헤드리스 검증 — **사이드 채팅 권한 모드**(2026-11-20 — 권한 모드 목업 · `chat/ChatPermChip` ·
// `chat/ChatPermMenu` · `SideChatFace` 의 카드 단추 셋 · 대신 답한 줄 · 설정 › MCP 의 '묻지 않기' 걷음). 스텁은 `side-chat-composer-harness.mjs` 그대로 +
// 사건 통로 쏘기(`__sideEmit`) · 새 명령 `side_chat_set_perm_mode` · `side_chat_forget_allow` · 스냅숏 `permMode` · `permAllow` · 옛 설정 칸
// `side_chat_no_ask: true` 가 남은 외부 서버 하나.
// 보는 것: ① Manual 칩 모양 · 자리(모델 키워드 바로 왼쪽) ② 카드 [허용 한 번] [이 채팅에서 허용] [거절] · remember ③ 칩 메뉴(라디오 둘 · 허용한 것 · ×)
// ④ Auto(강조색) ⑤ 대신 답한 끝난 한 줄 ⑥ 독 320 ⑦ 설정 › MCP 에 묻지 않기 없음 · B 원격 데스크톱 · C 폰(44px · 화면 안).
//
//   node scripts/dev/run-harness.mjs side-chat-perm-mode-harness.mjs <outdir> --size 1280x860
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
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
let chooser = 0;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
    return;
  }
  if (d.method === "Page.fileChooserOpened") chooser += 1;
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
const VK = { Escape: 27, Enter: 13, Tab: 9, ArrowRight: 39, ArrowLeft: 37, ArrowDown: 40, ArrowUp: 38 };
const key = async (code, shift = false) => {
  const vk = VK[code] ?? 0;
  const mods = shift ? 8 : 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers: mods });
  await sleep(200);
};
const mouse = (type, x, y, extra = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
/** 진짜 마우스로 누른다(포인터 → 바깥 누르기 판정까지 실제와 같게) — 자리가 가라앉은 뒤 가운데 */
const clickAt = async (expr) => {
  const at = () => evj(`(() => { const e = ${expr}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
  let r = await at();
  for (let i = 0; i < 20 && r; i++) {
    await sleep(100);
    const r2 = await at();
    if (r2 && r2.x === r.x && r2.y === r.y) break;
    r = r2;
  }
  if (!r) return false;
  await mouse("mouseMoved", r.x, r.y, { buttons: 0 });
  await mouse("mousePressed", r.x, r.y);
  await mouse("mouseReleased", r.x, r.y);
  await sleep(250);
  return true;
};

let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const PANES = importApp("app/panes.svelte.ts");
const DOCK = importApp("app/chat-dock.svelte.ts");

const ESC = "\x1b", BEL = "\x07";
const PROMPT = `${ESC}]133;A${BEL}PS C:\\> ${ESC}]133;B${BEL}${ESC}[?2004h`;

const stub = (remote) => `
  performance.setResourceTimingBufferSize(10000);
  ${remote ? "window.__AYNX_REMOTE__ = true;" : ""}
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__sideChan = null; window.__sideIdx = 0;
  window.__sideEmit = (msg) => { const cb = cbs.get(window.__sideChan); if (!cb) return false; cb({ index: window.__sideIdx++, message: msg }); return true; };
  window.__allow = [];
  let nextSession = 100;
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  const boot = (id) => setTimeout(() => window.__feed(id, ${JSON.stringify(PROMPT)}), 300);
  const NOW = Date.now();
  const FILE = { v: 2, current: 'chat-a', last: { cli: 'claude', model: '', effort: '' },
    chats: [{ id: 'chat-a', cli: 'claude', model: '', effort: '', title: '디스크 점검', createdAt: NOW - 600000, usedAt: NOW - 60000, used: [], links: {} }] };
  const snap = (cli, model, effort) => ({
    link: null, chat: 'chat-a', cli, model, effort, epoch: 1, leaseEpoch: 1, seq: 2, status: 'stopped',
    conversationId: null, cwd: null, mcpServers: ['filesystem', 'github'], permMode: 'manual', permAllow: [],
    liveTurn: [], pending: [],
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
    codex_models: { configured: 'gpt-6-sol', models: ['gpt-6.1-sol', 'gpt-6-sol'] },
    side_chat_list: [{ chat: 'chat-a', cli: 'claude', model: '', effort: null, epoch: 1, status: 'stopped', conversationId: null, viewers: 1, detached: false }],
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
    agent_conversation_transcript: { items: [], cursor: null },
  };
  const label = ${remote ? "'remote-h-1'" : "'main'"};
  let stageN = 0;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args, opts) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'stage_agent_attachment') {
        const name = decodeURIComponent(opts?.headers?.['x-file-name'] ?? 'x');
        return Promise.resolve('C:/Users/me/AppData/Roaming/aynx-dev/attachments/' + String(++stageN).padStart(64, '0') + '/' + name);
      }
      if (cmd === 'side_chat_send') return Promise.resolve({ epoch: 1, link: null });
      if (cmd === 'side_chat_decide') return Promise.resolve(true);
      if (cmd === 'side_chat_set_perm_mode') return Promise.resolve({ mode: args.mode, allow: window.__allow });
      if (cmd === 'side_chat_forget_allow') { window.__allow = ['fileChange', 'mcp:github'].filter((k) => k !== args.kind); return Promise.resolve({ mode: 'manual', allow: window.__allow }); }
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; boot(id); return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'attach_session_viewer') {
        const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, stream: args.stream }; boot(id);
        return Promise.resolve({ id, kind: 'local', lease: { stream: args.stream, sessionEpoch: 1, leaseEpoch: 1 }, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh', viewer: true, sizeOwner: true });
      }
      if (cmd === 'probe_session') return Promise.resolve(${remote} ? { state: 'attached', kind: 'local', sessionEpoch: 1, checkpoint: null } : { state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'write_session') return Promise.resolve(null);
      if (cmd === 'resize_session' || cmd === 'claim_session_size') return Promise.resolve(true);
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false },
        ai: { mcp_servers: [{ name: 'github', enabled: true, transport: 'stdio', command: 'npx', args: ['-y', 'gh-mcp'], side_chat: true, side_chat_no_ask: true }] } });
      if (cmd === 'side_chats_load') return Promise.resolve({ json: JSON.stringify(FILE), rev: 1 });
      if (cmd === 'side_chats_save') return Promise.resolve({ rev: 2 });
      if (cmd === 'side_chat_subscribe') { window.__sideChan = args.channel.id; return Promise.resolve(null); }
      if (cmd === 'side_chat_attach') return Promise.resolve(snap('claude', '', null));
      if (cmd === 'side_chat_open') return Promise.resolve({ ...snap(args.cli, args.model, args.effort), epoch: 2, leaseEpoch: 2 });
      if (cmd === 'side_chat_close' || cmd === 'side_chat_set_model' || cmd === 'side_chat_set_effort') return Promise.resolve(true);
      if (cmd === 'side_chat_link') return Promise.resolve({ links: (args.streams ?? []).map((stream) => ({ stream, code: 'p1', label: 'PowerShell 7', kind: 'local', readable: true, closed: false })), changed: true });
      if (cmd === 'mirror_request') return Promise.resolve(null);
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
await send("Page.setInterceptFileChooserDialog", { enabled: true });
let scriptId = null;
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
const callsOf = (cmd, from = 0) => evj(`JSON.stringify(window.__calls.slice(${from}).filter(([c]) => c === '${cmd}').map(([, a]) => a))`);
const callCount = () => ev(`window.__calls.length`);


// ── 권한 모드 조각 읽기 ─────────────────────────────────────────────────────────────
const D = "[data-chat-dock]";
const M = "[data-mobile-chat]";
let evSeq = 2;
let LABEL = "main";
const emit = (e) => ev(`window.__sideEmit(${JSON.stringify({ windows: [LABEL], chat: "chat-a", epoch: 1, seq: ++evSeq, ev: e })})`);
const chipInfo = (root) =>
  evj(`(() => {
    const r = document.querySelector('${root}'); const c = r?.querySelector('[data-chat-perm-chip]'); if (!c) return 'null';
    const kw = r.querySelector('[data-chat-model-chip]'); const plus = r.querySelector('[data-chat-plus]'); const snd = r.querySelector('[data-flip-send], [data-flip-interrupt]');
    const b = (e) => e.getBoundingClientRect(); const C = b(c), K = b(kw), P = b(plus), S = b(snd);
    const cs = getComputedStyle(c); const probe = document.createElement('span'); probe.style.color = 'var(--accent)'; document.body.appendChild(probe);
    const accent = getComputedStyle(probe).color; probe.remove();
    const cy = (x) => (x.top + x.bottom) / 2;
    return JSON.stringify({ mode: c.dataset.chatPermChip, word: c.textContent.trim(), h: Math.round(C.height), w: Math.round(C.width),
      accentBg: cs.backgroundColor === accent, inField: !!c.closest('[data-flip-in-field]'), beforeKw: C.right <= K.left + 0.5, afterPlus: C.left >= P.right - 0.5,
      sameRow: Math.abs(cy(C) - cy(S)) <= 1.5, noOverlap: P.right <= C.left && C.right <= K.left && K.right <= S.left,
      title: c.getAttribute('title'), label: c.getAttribute('aria-label'), icon: !!c.querySelector('svg') });
  })()`);
const menuInfo = () =>
  evj(`(() => { const m = document.querySelector('[data-chat-perm-menu]'); if (!m) return 'null'; const r = m.getBoundingClientRect();
    return JSON.stringify({ modes: [...m.querySelectorAll('[data-perm-mode]')].map((b) => [b.dataset.permMode, b.getAttribute('role'), b.getAttribute('aria-checked') === 'true', b.querySelector('.pmm-desc')?.textContent.trim() ?? '']),
      head: m.querySelector('[data-perm-allowed-head]')?.textContent.trim() ?? null,
      allow: [...m.querySelectorAll('[data-perm-allow]')].map((c) => [c.dataset.permAllow, c.querySelector('.pmm-chip-name').textContent.trim()]),
      rowH: [...m.querySelectorAll('[data-perm-mode]')].map((b) => Math.round(b.getBoundingClientRect().height)),
      inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, focusIn: m.contains(document.activeElement) }); })()`);
const cardInfo = (root, id) =>
  evj(`(() => { const c = document.querySelector('${root} [data-side-chat-perm="${id}"]'); if (!c) return 'null'; const R = c.getBoundingClientRect();
    const btns = [...c.querySelectorAll('.perm-actions button')]; const auto = c.matches('[data-side-chat-perm-auto]');
    return JSON.stringify({ auto: auto ? c.dataset.sideChatPermAuto : null, buttons: btns.map((b) => [Object.keys(b.dataset).find((k) => k.startsWith('sideChat')), b.textContent.trim()]),
      inside: btns.every((b) => { const x = b.getBoundingClientRect(); return x.left >= R.left - 0.5 && x.right <= R.right + 0.5; }),
      result: c.querySelector('[data-side-chat-perm-result]')?.textContent.trim() ?? null, h: Math.round(R.height) }); })()`);
/** 메뉴 자리(2026-11-20 실기 — 칩 끝 정렬이면 독 왼쪽 밖으로 나갔다): 뿌리(독 · 폰 덮개) 안 · 오른쪽 끝 = 입력 칸 상자 오른쪽 끝(±2) · 폭 ≤ min(320, 상자) */
const menuFit = (root) =>
  evj(`(() => { const m = document.querySelector('[data-chat-perm-menu]'); const r = document.querySelector('${root}'); const w = r?.querySelector('[data-flip-composer] .wrap');
    if (!m || !r || !w) return 'null'; const M = m.getBoundingClientRect(), R = r.getBoundingClientRect(), W = w.getBoundingClientRect();
    return JSON.stringify({ inLeft: M.left >= R.left - 0.5, inRight: M.right <= R.right + 0.5, rightAlign: Math.abs(M.right - W.right) <= 2, width: M.width <= Math.min(320, W.width) + 0.5,
      m: [Math.round(M.left), Math.round(M.right)], root: [Math.round(R.left), Math.round(R.right)], box: [Math.round(W.left), Math.round(W.right)] }); })()`);
const fitWant = { inLeft: true, inRight: true, rightAlign: true, width: true };
const fitOf = (f) => (f && typeof f === "object" ? { inLeft: f.inLeft, inRight: f.inRight, rightAlign: f.rightAlign, width: f.width } : f);
const pendingDot = () => ev(`(async () => (await ${importApp("app/side-chat-live.svelte.ts")}).sideChatDot('chat-a'))()`);

// ═══ A. 메인 PC 창 ═══════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;
await ev(`(async () => (await ${DOCK}).openChatDock())()`);
check("A 독 · 대화 면 · 모드 칩", await waitFor(`!!document.querySelector('${D}.open [data-chat-perm-chip]')`), true);
await sleep(600);
const a0 = await chipInfo(D);
console.log("info 칩(Manual):", JSON.stringify(a0));
check("① Manual 칩 — 24px · 글자 Manual · 중성 면(강조색 아님) · 그림 · 아래 줄 안 · [+] 뒤 모델 키워드 앞 · 같은 줄 · 겹침 없음",
  [a0.mode, a0.word, a0.h, a0.accentBg, a0.icon, a0.inField, a0.afterPlus, a0.beforeKw, a0.sameRow, a0.noOverlap], ["manual", "Manual", 24, false, true, true, true, true, true, true]);
check("① title = aria-label · 지금 모드를 풀어 적음", [a0.title === a0.label, a0.title?.includes("Manual") && a0.title?.includes("카드로 묻습니다")], [true, true]);
await shot("perm-chip-manual.png");

// ② 권한 카드 — 단추 셋 · [이 채팅에서 허용] = remember
await emit({ t: "turnStarted", turn: null });
await emit({ t: "permission", requestId: "r1", kind: "fileChange", title: "src/main.ts", detail: "--- a\n+++ b", toolName: "fileChange" });
await waitFor(`!!document.querySelector('${D} [data-side-chat-perm="r1"]')`, 3000);
const k1 = await cardInfo(D, "r1");
check("② 카드 단추 셋 = [허용 한 번] [이 채팅에서 허용] [거절] · 카드 안", [k1.buttons, k1.inside],
  [[["sideChatAllow", "허용 한 번"], ["sideChatAllowChat", "이 채팅에서 허용"], ["sideChatDeny", "거절"]], true]);
check("② 기다리는 카드 = 점 permission", await pendingDot(), "permission");
await shot("perm-card.png");
let c0 = await callCount();
await clickAt(`document.querySelector('${D} [data-side-chat-allow-chat]')`);
await sleep(400);
check("② [이 채팅에서 허용] = side_chat_decide{allow, remember: true}(종류 글자는 싣지 않는다)",
  (await callsOf("side_chat_decide", c0)).map((a) => [a.requestId, a.decision, a.remember, "kind" in a]), [["r1", "allow", true, false]]);
await emit({ t: "permissionResolved", requestId: "r1", decision: "allow", by: "human" });
await emit({ t: "permPolicy", mode: "manual", allow: ["fileChange", "mcp:github"] });
await sleep(300);
check("② 사람이 답한 카드 = 허용했습니다 · 점 없음", [(await cardInfo(D, "r1")).result, await pendingDot()], ["허용했습니다", "running"]);

// ③ 칩 메뉴 — 라디오 둘 + 허용한 것
await clickAt(`document.querySelector('${D} [data-chat-perm-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-perm-menu]')`, 3000);
await sleep(300);
const m1 = await menuInfo();
check("③ 메뉴 — 라디오 둘(Manual ✓) · 설명 · \"이 채팅에서 허용한 것\" · 항목 칩 둘 · 포커스 안 · 화면 안", [m1.modes, m1.head, m1.allow, m1.focusIn, m1.inView], [
  [["manual", "menuitemradio", true, "권한이 필요한 일은 카드로 묻습니다"], ["auto", "menuitemradio", false, "파일 바꾸기 · 명령 · MCP 도구까지 묻지 않습니다"]],
  "이 채팅에서 허용한 것", [["fileChange", "파일 바꾸기"], ["mcp:github", "MCP · github"]], true, true]);
const fit1 = await menuFit(D);
console.log("info 메뉴 자리(독 380):", JSON.stringify(fit1));
check("③ 메뉴 자리(독 380) — 독 안(왼 · 오) · 오른쪽 끝 = 입력 칸 상자 오른쪽 끝 · 폭 ≤ min(320, 상자)", fitOf(fit1), fitWant);
await shot("perm-menu-allowed.png");
c0 = await callCount();
await clickAt(`document.querySelector('[data-perm-forget="fileChange"]')`);
await sleep(500);
const m2 = await menuInfo();
check("③ × = side_chat_forget_allow{fileChange} · 메뉴는 열린 채 · 칩 하나", [(await callsOf("side_chat_forget_allow", c0)).map((a) => a.kind), m2 !== null, m2?.allow.map((x) => x[0])], [["fileChange"], true, ["mcp:github"]]);
await key("ArrowDown");
await key("ArrowUp");
check("③ ↑↓ 는 메뉴 안에서 돈다", await ev(`!!document.activeElement?.closest('[data-chat-perm-menu]')`), true);
await key("Escape");
check("③ Esc = 닫힘 · 포커스 = 칩", [await ev(`!!document.querySelector('[data-chat-perm-menu]')`), await ev(`document.activeElement?.hasAttribute('data-chat-perm-chip') ?? false`)], [false, true]);

// ④ Auto 로
await clickAt(`document.querySelector('${D} [data-chat-perm-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-perm-menu]')`, 3000);
c0 = await callCount();
await clickAt(`document.querySelector('[data-perm-mode="auto"]')`);
await sleep(500);
const a1 = await chipInfo(D);
check("④ Auto 고르기 = side_chat_set_perm_mode{auto} · 메뉴 닫힘 · 칩 Auto · 강조색 면 · 그림",
  [(await callsOf("side_chat_set_perm_mode", c0)).map((a) => [a.chat, a.mode]), await ev(`!!document.querySelector('[data-chat-perm-menu]')`), a1.mode, a1.word, a1.accentBg, a1.icon, a1.noOverlap],
  [[["chat-a", "auto"]], false, "auto", "Auto", true, true, true]);
check("④ Auto 칩의 title", a1.title?.includes("Auto") && a1.title?.includes("묻지 않습니다"), true);
await shot("perm-chip-auto.png");

// ⑤ 서버가 대신 답한 줄
await emit({ t: "permissionAuto", requestId: "r2", kind: "command", title: "npm test", toolName: "commandExecution", by: "auto" });
await emit({ t: "permissionResolved", requestId: "r2", decision: "allow", by: "auto" });
await emit({ t: "permissionAuto", requestId: "r3", kind: "mcpTool", title: "github · search", toolName: "mcp__github__search", by: "remembered" });
await emit({ t: "permissionResolved", requestId: "r3", decision: "allow", by: "remembered" });
await sleep(400);
const l2 = await cardInfo(D, "r2");
const l3 = await cardInfo(D, "r3");
console.log("info 대신 답한 줄:", JSON.stringify([l2, l3]));
check("⑤ 대신 답한 요청 = 끝난 한 줄(단추 없음 · 낮은 높이) · 글자 · 점 없음",
  [l2.auto, l2.buttons.length, l2.result, l2.h <= 24, l3.auto, l3.result, await pendingDot()],
  ["auto", 0, "Auto 로 허용했습니다", true, "remembered", "이 채팅에서 허용한 종류라 허용했습니다", "running"]);
await shot("perm-auto-line.png");

// ⑥ 좁은 독 320 — 칩은 줄지 않고 모델 이름이 줄임표 · 카드 단추는 카드 안
const wide = (await chipInfo(D)).w;
await ev(`(async () => { const m = await ${importApp("app/side-chats.svelte.ts")}; m.setSideChatPick('chat-a', 'claude', 'my-custom-research-model-preview-20261101'); })()`);
await ev(`(async () => (await ${DOCK}).setChatDockWidth(320))()`);
await sleep(600);
const a2 = await chipInfo(D);
const nm = await evj(`(() => { const n = document.querySelector('${D} [data-chat-model-name]'); return JSON.stringify({ clipped: n.scrollWidth > n.clientWidth }); })()`);
await emit({ t: "permission", requestId: "r4", kind: "command", title: "Remove-Item build -Recurse", detail: "", toolName: "commandExecution" });
await sleep(400);
const k4 = await cardInfo(D, "r4");
console.log("info 320:", JSON.stringify([a2, nm, k4]));
check("⑥ 독 320 — 칩 폭 그대로 · 이름 줄임표 · 아래 줄 겹침 없음 · 카드 단추 셋이 카드 안", [a2.w === wide, nm.clipped, a2.noOverlap, a2.sameRow, k4.buttons.length, k4.inside], [true, true, true, true, 3, true]);
await shot("perm-320.png");
await clickAt(`document.querySelector('${D} [data-chat-perm-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-perm-menu]')`, 3000);
await sleep(300);
const fit2 = await menuFit(D);
console.log("info 메뉴 자리(독 320):", JSON.stringify(fit2));
check("⑥ 메뉴 자리(독 320) — 독 안(왼 · 오) · 오른쪽 끝 = 입력 칸 상자 오른쪽 끝 · 폭 ≤ min(320, 상자)", fitOf(fit2), fitWant);
await shot("perm-menu-320.png");
await key("Escape");
await ev(`(async () => (await ${DOCK}).setChatDockWidth(380))()`);
await sleep(300);

// ⑦ 설정 › MCP — '사이드 채팅에서 묻지 않기' 가 없다(옛 설정 칸이 남아 있어도)
await ev(`(async () => (await ${importApp("app/overlays.svelte.ts")}).openSettingsAt('mcp', 'ai-mcp-servers'))()`);
check("⑦ 설정 › MCP 서버 목록", await waitFor(`!!document.querySelector('[data-mcp-row]')`, 6000), true);
await sleep(400);
check("⑦ 목록 줄 — 사이드 채팅 칩 켜짐 · 묻지 않기 초록 점 없음 · 문구 없음",
  [await ev(`!!document.querySelector('[data-mcp-row] .agent-dot')`), await ev(`document.body.innerText.includes('묻지 않기')`)], [false, false]);
await shot("settings-mcp-list.png");
await clickAt(`document.querySelector('[data-mcp-row] .mcp-open')`);
check("⑦ 편집 화면", await waitFor(`!!document.getElementById('ai-mcp-enabled')`, 4000), true);
await sleep(300);
check("⑦ 편집 화면 — 묻지 않기 토글 · 이름 없음", [await ev(`!!document.getElementById('ai-mcp-no-ask')`), await ev(`document.body.innerText.includes('사이드 채팅에서 묻지 않기')`)], [false, false]);
await shot("settings-mcp-editor.png");
await key("Escape");
await key("Escape");

// ═══ B. 원격 데스크톱 ═════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 1400, height: 900 });
LABEL = "remote-h-1";
errors.length = 0;
evSeq = 2;
await ev(`(async () => (await ${DOCK}).openChatDock())()`);
check("B 원격 데스크톱 — 모드 칩", await waitFor(`!!document.querySelector('${D}.open [data-chat-perm-chip]')`), true);
await sleep(500);
const b0 = await chipInfo(D);
check("B 칩 모양 같음(Manual · 24 · 겹침 없음)", [b0.mode, b0.h, b0.noOverlap, b0.sameRow], ["manual", 24, true, true]);
await clickAt(`document.querySelector('${D} [data-chat-perm-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-perm-menu]')`, 3000);
await shot("remote-perm-menu.png");
c0 = await callCount();
await clickAt(`document.querySelector('[data-perm-mode="auto"]')`);
await sleep(500);
check("B 원격 창에서도 모드 바꾸기 = side_chat_set_perm_mode", (await callsOf("side_chat_set_perm_mode", c0)).map((a) => a.mode), ["auto"]);
await emit({ t: "permission", requestId: "q1", kind: "tool", title: "Read", detail: "C:/elsewhere/a.txt", toolName: "Read" });
await waitFor(`!!document.querySelector('${D} [data-side-chat-perm="q1"]')`, 3000);
c0 = await callCount();
await clickAt(`document.querySelector('${D} [data-side-chat-allow-chat]')`);
await sleep(400);
check("B 원격 창 [이 채팅에서 허용] = decide{remember}", (await callsOf("side_chat_decide", c0)).map((a) => a.remember), [true]);
await shot("remote-perm-card.png");

// ═══ C. 원격 폰 ═══════════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 390, height: 844, mobile: true });
errors.length = 0;
evSeq = 2;
await waitFor(`!!document.querySelector('[data-signal="side-chat"]')`, 8000);
await ev(`document.querySelector('[data-signal="side-chat"]').click()`);
check("C 폰 덮개 — 모드 칩", await waitFor(`!!document.querySelector('${M} [data-chat-perm-chip]')`), true);
await sleep(600);
const p0 = await chipInfo(M);
check("C 폰 칩 — 24px · 아래 줄 겹침 없음 · 누르는 자리 넓힘", [p0.h, p0.noOverlap, p0.sameRow, await ev(`getComputedStyle(document.querySelector('${M} [data-chat-perm-chip]'), '::after').content !== 'none'`)], [24, true, true, true]);
await shot("phone-perm-chip.png");
await clickAt(`document.querySelector('${M} [data-chat-perm-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-perm-menu]')`, 3000);
await sleep(300);
const pm = await menuInfo();
check("C 폰 메뉴 — 화면 안 · 라디오 줄 ≥ 44px", [pm.inView, pm.rowH.every((h) => h >= 44)], [true, true]);
const fit3 = await menuFit(M);
console.log("info 메뉴 자리(폰):", JSON.stringify(fit3));
check("C 폰 메뉴 자리 — 덮개 안(왼 · 오) · 오른쪽 끝 = 입력 칸 상자 오른쪽 끝 · 폭 ≤ min(320, 상자)", fitOf(fit3), fitWant);
await shot("phone-perm-menu.png");
await key("Escape");
await emit({ t: "permission", requestId: "f1", kind: "fileChange", title: "README.md", detail: "", toolName: "fileChange" });
await waitFor(`!!document.querySelector('${M} [data-side-chat-perm="f1"]')`, 3000);
await sleep(300);
const pk = await cardInfo(M, "f1");
check("C 폰 카드 — 단추 셋 · 카드 안", [pk.buttons.length, pk.inside], [3, true]);
await shot("phone-perm-card.png");

if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("잡히지 않은 예외 · 콘솔 오류 0", errors.length, 0);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
