// 헤드리스 검증 — **사이드 채팅 입력 칸 한 줄**(2026-11-13 — 목업 D안: `[+]  입력 … [로고 모델 게이지 ⌄] [보내기]` · `chat/side-chat-controls` ·
// `ChatModelPopover` · `ChatEffortGauge` · `ChatLinkChip` · `FlipComposer` 의 `leading` · `inField` · `above`).
//
// 스텁은 `code-to-term-chat-harness.mjs`(가짜 로컬 셸 세션 — 연결할 타일 · 사이드 채팅 명령 · 통로)와 같은 꼴이다. 채팅 하나(`chat-a` —
// Claude · 기본 모델 · 기본 강도 · 서버 표에서 멈춤 · 외부 MCP 둘 `filesystem` · `github`).
// 보는 것(판 셋 — 집 PC 창 · 원격 데스크톱 · 원격 폰):
// ① 칸 아래 칩 줄 · 머리줄 MCP 칩이 없다 · `[+]` · 모델 키워드가 알약 칸 **안** · 한 줄 알약 높이 · 연결이 없으면 연결 칩도 없다
// ② `[+]` 뿌리 = 파일 업로드 · 타일 연결(오른쪽 = 지금 연결 이름 ›) · MCP(`2 ›` — 실린 서버가 있을 때만)
// ③ 파일 업로드 → 파일 상자가 열린다(`Page.fileChooserOpened`) · 메뉴 닫힘
// ③' 파일 · 그림 고르기(숨은 칸에 `DOM.setFileInputFiles`) → 칩 둘(그림 = 미리보기 · 파일 = 아이콘 + 이름) · 10 MB 넘는 것은 알림 + 칩 없음 ·
//    보내기 = `side_chat_send{images: [그림], files: [파일]}` · 칩이 걷힌다(집 PC · 원격 데스크톱 · 폰 셋 다 — 2026-11-14)
// ④ 타일 연결 → 하위 갈래(‹ 머리 · 타일 줄 · 끊기) → 타일 고르기 = `side_chat_link{stream}` · 칸 안 위쪽 연결 칩 `🔗 이름 ×` · 뿌리 줄 오른쪽에 그 이름
// ⑤ MCP → 하위 갈래(‹ MCP · 서버 이름 줄(앞에 MCP 그림) · MCP 설정 열기) · ← 로 뿌리 · [MCP 설정 열기] → 설정 › MCP 서버 목록
// ⑥ 연결 칩 × → `side_chat_link{null}` · 칩이 걷힌다
// ⑦ 모델 메뉴 — CLI 스위치(radiogroup) · 모델 목록 · Effort 게이지 · 첫 포커스 = 고른 모델 줄 · 모델 고르기 = `side_chat_set_model` 뒤에도
//    **열려 있음** · Effort 칸 누르기 = `side_chat_set_effort` · ← → · Default 고리 · 키워드 막대가 따라 찬다 · [직접 입력…] 칸 · Tab 은 상자 안에서 돈다 ·
//    CLI 스위치 → Codex(`side_chat_open{cli:codex}` · 모델 목록 = Codex 캐시 · 강도 칸 넷) → 다시 Claude · Esc = 닫힘 + 키워드로 포커스
// ⑧ 좁은 폭 — 독 최소 폭(320)에서 이름 말줄임 · 알약이 깨지지 않음(손잡이 · 글 칸이 겹치지 않음) · 아주 좁은 창에서 `로고 ⌄` 만
// ⑨ 원격 데스크톱(1400x900) — 같은 모양 · 메뉴 둘
// ⑩ 원격 폰(390x844) — 덮개의 입력 칸도 같은 모양(옛 칸 안 그림 단추 없음) · 메뉴 줄 44px · 모델 메뉴가 화면 안 · 폰에서 Effort 고르기 · 연결 고르기
// ⑪ 잡히지 않은 예외 · 콘솔 오류 0(`stub:` 거절 제외)
//
//   node scripts/dev/run-harness.mjs side-chat-composer-harness.mjs <outdir> --size 1280x860
//     → home-dock.png · home-plus.png · home-plus-link.png · home-plus-mcp.png · home-linked.png · home-model.png · home-model-codex.png ·
//       home-narrow.png · home-narrowest.png · remote-desktop.png · remote-plus.png · remote-model.png · phone-chat.png · phone-plus.png ·
//       phone-model.png
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
  window.__sideChan = null;
  let nextSession = 100;
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  const boot = (id) => setTimeout(() => window.__feed(id, ${JSON.stringify(PROMPT)}), 300);
  const NOW = Date.now();
  const FILE = { v: 2, current: 'chat-a', last: { cli: 'claude', model: '', effort: '' },
    chats: [{ id: 'chat-a', cli: 'claude', model: '', effort: '', title: '디스크 점검', createdAt: NOW - 600000, usedAt: NOW - 60000, used: [], links: {} }] };
  const snap = (cli, model, effort) => ({
    link: null, chat: 'chat-a', cli, model, effort, epoch: 1, leaseEpoch: 1, seq: 2, status: 'stopped',
    conversationId: null, cwd: null, mcpServers: ['filesystem', 'github'],
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
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; boot(id); return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'attach_session_viewer') {
        const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, stream: args.stream }; boot(id);
        return Promise.resolve({ id, kind: 'local', lease: { stream: args.stream, sessionEpoch: 1, leaseEpoch: 1 }, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh', viewer: true, sizeOwner: true });
      }
      if (cmd === 'probe_session') return Promise.resolve(${remote} ? { state: 'attached', kind: 'local', sessionEpoch: 1, checkpoint: null } : { state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'write_session') return Promise.resolve(null);
      if (cmd === 'resize_session' || cmd === 'claim_session_size') return Promise.resolve(true);
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'side_chats_load') return Promise.resolve({ json: JSON.stringify(FILE), rev: 1 });
      if (cmd === 'side_chats_save') return Promise.resolve({ rev: 2 });
      if (cmd === 'side_chat_subscribe') { window.__sideChan = args.channel.id; return Promise.resolve(null); }
      if (cmd === 'side_chat_attach') return Promise.resolve(snap('claude', '', null));
      if (cmd === 'side_chat_open') return Promise.resolve({ ...snap(args.cli, args.model, args.effort), epoch: 2, leaseEpoch: 2 });
      if (cmd === 'side_chat_close' || cmd === 'side_chat_set_model' || cmd === 'side_chat_set_effort') return Promise.resolve(true);
      if (cmd === 'side_chat_link') return Promise.resolve({ link: args.stream ? { stream: args.stream, code: 'p1', label: 'PowerShell 7', kind: 'local', readable: true, closed: false } : null, changed: true });
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

// ── 입력 칸 조각 읽기(뿌리 = 대화 면을 담은 상자) ─────────────────────────────────────
const shape = (root) =>
  evj(`(() => {
    const r = document.querySelector('${root}'); if (!r) return 'null';
    const wrap = r.querySelector('[data-flip-composer] .wrap'); const ta = r.querySelector('textarea[data-flip-input]');
    const plus = r.querySelector('[data-chat-plus]'); const kw = r.querySelector('[data-chat-model-chip]'); const snd = r.querySelector('[data-flip-send], [data-flip-interrupt]');
    const b = (e) => e?.getBoundingClientRect();
    const W = b(wrap), P = b(plus), K = b(kw), SN = b(snd);
    const padL = parseFloat(getComputedStyle(ta).paddingLeft), padR = parseFloat(getComputedStyle(ta).paddingRight);
    const nameEl = kw?.querySelector('[data-chat-model-name]');
    return JSON.stringify({
      tools: !!r.querySelector('[data-flip-tools]'), mcpChip: !!document.querySelector('[data-chat-dock-mcp]'),
      plusIn: !!wrap?.contains(plus), kwIn: !!wrap?.querySelector('[data-flip-in-field]')?.contains(kw),
      oldPick: !!r.querySelector('[data-flip-in-field] [data-side-chat-pick], .pick'),
      oneLine: Math.round(W.height) <= 46,
      noOverlap: !!P && !!K && !!SN && P.right <= W.left + padL && K.right <= SN.left && K.left >= W.right - padR - 1,
      name: nameEl && getComputedStyle(nameEl).display !== 'none' ? nameEl.textContent.trim() : null,
      bars: kw?.querySelectorAll('.kw-bar').length ?? 0, filled: kw?.querySelectorAll('.kw-bar.filled').length ?? 0,
      link: r.querySelector('[data-chat-link-chip]')?.textContent.trim() ?? null,
    });
  })()`);
const menuRows = () =>
  evj(`JSON.stringify([...document.querySelectorAll('[data-toolbar-menu] [data-menu-key]')].map((b) => [b.dataset.menuKey, b.querySelector('.tb-label')?.textContent.trim() ?? '', b.querySelector('.tb-more')?.textContent.trim() ?? (b.getAttribute('aria-haspopup') ? '' : null), !!b.querySelector('.menu-mark'), b.disabled]))`);
const menuKeys = async () => (await menuRows()).map((r) => r[0]);
const menuBtn = (k) => `document.querySelector('[data-toolbar-menu] [data-menu-key="${k}"]')`;
const pop = (sel = "") => `document.querySelector('[data-chat-model-menu] ${sel}')`;
const popInfo = () =>
  evj(`(() => { const m = document.querySelector('[data-chat-model-menu]'); if (!m) return 'null';
    return JSON.stringify({
      cli: [...m.querySelectorAll('[data-chat-cli]')].map((b) => [b.dataset.chatCli, b.getAttribute('aria-checked') === 'true']),
      cliGroup: m.querySelector('[data-chat-cli]')?.parentElement?.getAttribute('role') ?? null,
      models: [...m.querySelectorAll('[data-chat-model]')].map((b) => [b.dataset.chatModel, b.textContent.trim(), b.getAttribute('aria-checked') === 'true']),
      custom: !!m.querySelector('[data-chat-model-custom]'),
      effort: [...m.querySelectorAll('[data-chat-effort]')].map((b) => b.dataset.chatEffort),
      effortOn: m.querySelector('[data-chat-effort][aria-checked="true"]')?.dataset.chatEffort ?? null,
      now: m.querySelector('[data-chat-effort-now]')?.textContent.trim() ?? null,
      focusIn: m.contains(document.activeElement),
      focus: document.activeElement?.dataset?.chatModel ?? document.activeElement?.dataset?.chatEffort ?? document.activeElement?.dataset?.chatCli ?? null,
    }); })()`);

// ── ③' 파일 · 그림 첨부 → 보내기 ──────────────────────────────────────────────────────
const FIX = path.resolve(outdir, "fixtures");
fs.mkdirSync(FIX, { recursive: true });
const FIX_TS = path.join(FIX, "main.ts");
const FIX_PNG = path.join(FIX, "shot.png");
const FIX_BIG = path.join(FIX, "big.pdf");
fs.writeFileSync(FIX_TS, "export const a = 1;\n");
fs.writeFileSync(FIX_PNG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64"));
fs.writeFileSync(FIX_BIG, "");
fs.truncateSync(FIX_BIG, 10 * 1024 * 1024 + 1);
const setFiles = async (root, files) => {
  const r = await send("Runtime.evaluate", { expression: `document.querySelector('${root} input[type=file][data-side-chat-pick]')` });
  await send("DOM.setFileInputFiles", { objectId: r.result.result.objectId, files });
};
const chips = (root) =>
  evj(`JSON.stringify([...document.querySelectorAll('${root} [data-flip-attachment]')].map((c) => [c.querySelector('.att-name')?.textContent.trim() ?? null, !!c.querySelector('img.thumb'), !!c.querySelector('.thumb.icon')]))`);
/** 집 PC = A · 원격 데스크톱 = R · 폰 = P */
async function attachAndSend(root, tag) {
  const c0 = await callCount();
  await setFiles(root, [FIX_BIG]);
  await sleep(500);
  check(`${tag} ③' 10 MB 넘는 파일 = 알림 · 칩 없음 · 사본 안 함`, [await ev(`document.body.innerText.includes('파일은 10 MB까지 붙일 수 있습니다: big.pdf')`), (await chips(root)).length, (await callsOf("stage_agent_attachment", c0)).length], [true, 0, 0]);
  await setFiles(root, [FIX_TS, FIX_PNG]);
  await waitFor(`[...document.querySelectorAll('${root} [data-flip-attachment]')].length === 2 && !document.querySelector('${root} [data-flip-attachment].staging')`, 4000);
  check(`${tag} ③' 칩 둘 — 파일 = 아이콘 + 이름 · 그림 = 미리보기`, await chips(root), [["main.ts", false, true], ["shot.png", true, false]]);
  await shot(`${tag}-attach-chips.png`);
  await ev(`(() => { const ta = document.querySelector('${root} textarea[data-flip-input]'); ta.value = '이 파일 봐 줘'; ta.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(200);
  const c1 = await callCount();
  await clickAt(`document.querySelector('${root} [data-flip-send]')`);
  await sleep(600);
  const sent = (await callsOf("side_chat_send", c1)).map((a) => ({ text: a.text, images: a.images.map((p) => p.split("/").pop()), files: a.files.map((p) => p.split("/").pop()) }));
  check(`${tag} ③' 보내기 = images [그림] · files [파일] · 칩 걷힘`, [sent, (await chips(root)).length], [[{ text: "이 파일 봐 줘", images: ["shot.png"], files: ["main.ts"] }], 0]);
}

// ═══ A. 집 PC 창 ═══════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;
await ev(`(async () => (await ${DOCK}).openChatDock())()`);
check("A 독이 열리고 대화 면이 선다", await waitFor(`!!document.querySelector('[data-chat-dock].open [data-side-chat-face] [data-chat-model-chip]')`), true);
await sleep(600);
const D = "[data-chat-dock]";
check("① 칩 줄 · MCP 칩 없음 · [+] · 키워드가 알약 안 · 한 줄 · 겹침 없음 · Default · 막대 5칸(빈) · 연결 칩 없음", await shape(D), {
  tools: false, mcpChip: false, plusIn: true, kwIn: true, oldPick: false, oneLine: true, noOverlap: true, name: "Default", bars: 5, filled: 0, link: null,
});
await shot("home-dock.png");

// 연결할 셸 타일 하나
await ev(`(async () => (await ${PANES}).openDefaultShell())()`);
const shellOk = await waitFor(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS}; return w.residentWindowTabs().some((t) => s.listPanes(t.root).some((p) => p.kind === 'local' && ss.sessionOf(p.id) != null)); })()`, 10000);
check("A 셸 타일이 섰다(연결 후보)", shellOk, true);
await ev(`(async () => (await ${DOCK}).openChatDock())()`);
await sleep(500);

// ② [+] 뿌리
await clickAt(`document.querySelector('${D} [data-chat-plus]')`);
await waitFor(`!!document.querySelector('[data-toolbar-menu]')`, 3000);
check("② [+] 뿌리 = 파일 업로드 · 타일 연결(›) · MCP(2 ›) · [+] 열림 표시", [await menuRows(), await ev(`document.querySelector('${D} [data-chat-plus]').getAttribute('aria-expanded')`)], [[
  ["attach", "파일 업로드", null, true, false], ["link", "타일 연결", "", true, false], ["mcp", "MCP", "2", true, false],
], "true"]);
await shot("home-plus.png");

// ③ 파일 업로드 → 파일 상자
const ch0 = chooser;
await clickAt(menuBtn("attach"));
await sleep(600);
check("③ 파일 업로드 → 파일 상자 열림 · 메뉴 닫힘", [chooser > ch0, await ev(`!!document.querySelector('[data-toolbar-menu]')`)], [true, false]);
await attachAndSend(D, "A");

// ④ 타일 연결 → 하위 갈래 → 고르기
await clickAt(`document.querySelector('${D} [data-chat-plus]')`);
await waitFor(`!!${menuBtn("link")}`, 3000);
await clickAt(menuBtn("link"));
await sleep(300);
const linkKeys = await menuKeys();
check("④ 타일 연결 갈래 = ‹ 머리 · 타일 줄 · 끊기(흐림) · 포커스는 메뉴 안",
  [linkKeys[0], linkKeys.some((k) => k.startsWith("tile:")), linkKeys.at(-1), await ev(`${menuBtn("unlink")}.disabled`), await ev(`!!document.activeElement?.closest('[data-toolbar-menu]')`)],
  ["back", true, "unlink", true, true]);
await shot("home-plus-link.png");
const tileKey = linkKeys.find((k) => k.startsWith("tile:"));
const c0 = await callCount();
await clickAt(menuBtn(tileKey));
await sleep(700);
const linkCalls = await callsOf("side_chat_link", c0);
const linkedShape = await shape(D);
check("④ 타일 고르기 = side_chat_link{stream} · 메뉴 닫힘 · 칸 안 연결 칩", [linkCalls.length === 1 && typeof linkCalls[0].stream === "string", await ev(`!!document.querySelector('[data-toolbar-menu]')`), !!linkedShape.link, await ev(`!!document.querySelector('${D} [data-flip-above] [data-chat-link-chip="linked"] [data-chat-link-unlink]')`)], [true, false, true, true]);
await shot("home-linked.png");
await clickAt(`document.querySelector('${D} [data-chat-plus]')`);
await waitFor(`!!${menuBtn("link")}`, 3000);
check("④ 뿌리 타일 연결 줄 오른쪽 = 연결 이름", (await menuRows())[1][2], linkedShape.link);

// ⑤ MCP 갈래
await clickAt(menuBtn("mcp"));
await sleep(300);
check("⑤ MCP 갈래 = ‹ MCP · 서버 이름 줄(앞에 MCP 그림) · MCP 설정 열기", (await menuRows()).map((r) => [r[0], r[1], r[3]]), [
  ["back", "MCP", true], ["server:filesystem", "filesystem", true], ["server:github", "github", true], ["settings", "MCP 설정 열기", true],
]);
await shot("home-plus-mcp.png");
await ev(`${menuBtn("server:filesystem")}.focus()`);
await key("ArrowLeft");
check("⑤ ← = 뿌리로", await menuKeys(), ["attach", "link", "mcp"]);
await ev(`${menuBtn("mcp")}.focus()`);
await key("ArrowRight");
check("⑤ → = MCP 갈래로", (await menuKeys())[0], "back");
await clickAt(menuBtn("settings"));
check("⑤ [MCP 설정 열기] → 설정 › MCP 서버 목록", await waitFor(`!!document.getElementById('ai-mcp-servers')`, 5000), true);
await key("Escape");
await sleep(500);
await ev(`(async () => (await ${DOCK}).openChatDock())()`);
await sleep(500);

// ⑥ 연결 칩 ×
const c1 = await callCount();
await clickAt(`document.querySelector('${D} [data-chat-link-unlink]')`);
await sleep(600);
const unl = await callsOf("side_chat_link", c1);
check("⑥ 연결 칩 × = side_chat_link{null} · 칩 걷힘", [unl.length, unl[0]?.stream ?? null, (await shape(D)).link], [1, null, null]);

// ⑦ 모델 메뉴
await clickAt(`document.querySelector('${D} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-model-menu]')`, 3000);
await sleep(300);
const p0 = await popInfo();
check("⑦ 모델 메뉴 — CLI 스위치(radiogroup · Claude) · 모델(Default ✓ 맨 앞) · [직접 입력…] · Effort 6자리 · 첫 포커스 = 고른 모델",
  [p0.cliGroup, p0.cli, p0.models[0], p0.models.length >= 4, p0.custom, p0.effort, p0.effortOn, p0.focus],
  ["radiogroup", [["claude", true], ["codex", false]], ["", "Default", true], true, true, ["", "low", "medium", "high", "xhigh", "max"], "", ""]);
await shot("home-model.png");
const c2 = await callCount();
await clickAt(pop('[data-chat-model="opus"]'));
await sleep(500);
const p1 = await popInfo();
check("⑦ 모델 opus = side_chat_set_model{opus} · 메뉴는 열린 채 · ✓ 옮김 · 키워드 Opus",
  [(await callsOf("side_chat_set_model", c2)).map((a) => a.model), p1 !== null, p1?.models.find((m) => m[2])?.[0], (await shape(D)).name],
  [["opus"], true, "opus", "Opus"]);
const c3 = await callCount();
await clickAt(pop('[data-chat-effort="high"]'));
await sleep(500);
const p2 = await popInfo();
const s2 = await shape(D);
check("⑦ Effort high 칸 = side_chat_set_effort{high} · 열린 채 · 위 이름 High · 키워드 막대 3칸",
  [(await callsOf("side_chat_set_effort", c3)).map((a) => a.effort), p2 !== null, p2?.effortOn, p2?.now, s2.filled], [["high"], true, "high", "High", 3]);
await ev(`${pop('[data-chat-effort="high"]')}.focus()`);
const c4 = await callCount();
await key("ArrowRight");
await sleep(400);
check("⑦ → = 다음 단계 xhigh(곧바로) · 포커스가 따라감", [(await callsOf("side_chat_set_effort", c4)).map((a) => a.effort), (await popInfo()).focus], [["xhigh"], "xhigh"]);
await clickAt(pop('[data-chat-effort=""]'));
await sleep(400);
check("⑦ Default 고리 = 강도 비움 · 막대 빈 칸", [(await popInfo()).effortOn, (await shape(D)).filled], ["", 0]);
// Tab 은 상자 안에서 돈다
let inside = true;
for (let i = 0; i < 6; i++) {
  await key("Tab", i % 2 === 1);
  if ((await ev(`!!document.activeElement?.closest('[data-chat-model-menu]')`)) !== true) inside = false;
}
check("⑦ Tab · Shift+Tab 이 상자 밖으로 새지 않는다", inside, true);
// [직접 입력…]
await clickAt(pop("[data-chat-model-custom]"));
await sleep(300);
const inputFocused = await ev(`document.activeElement?.hasAttribute('data-chat-model-input') ?? false`);
await send("Input.insertText", { text: "claude-x" });
await ev(`(() => { const i = document.querySelector('[data-chat-model-input]'); i.value = 'claude-x'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
const c5 = await callCount();
await key("Enter");
await sleep(500);
check("⑦ [직접 입력…] = 그 줄이 칸(포커스) → Enter = set_model{claude-x} · 메뉴 그대로 · 키워드 Claude-x",
  [inputFocused, (await callsOf("side_chat_set_model", c5)).map((a) => a.model), (await popInfo()) !== null, (await shape(D)).name], [true, ["claude-x"], true, "Claude-x"]);
// CLI 스위치 → Codex
const c6 = await callCount();
await clickAt(pop('[data-chat-cli="codex"]'));
await sleep(900);
const pc = await popInfo();
const opens = await callsOf("side_chat_open", c6);
// 다시 열기는 한 번 이상일 수 있다 — 바꾸는 동안 독의 붙기 효과(지금 채팅이 바뀜)가 `attached = false` 사이에 한 번 더 연다(옛 칩 길과 같은 순서 · 마지막 뜻이 이긴다)
console.log(`   (side_chat_open ${opens.length}번)`);
check("⑦ CLI → Codex = side_chat_open{codex}(마지막) · 열린 채 · Codex ✓ · 모델 = Codex 캐시 · 강도 5자리(Default + 넷)",
  [opens.at(-1)?.cli, pc?.cli, pc?.models.map((m) => m[0]), pc?.effort.length],
  ["codex", [["claude", false], ["codex", true]], ["", "gpt-6.1-sol", "gpt-6-sol"], 5]);
await shot("home-model-codex.png");
await clickAt(pop('[data-chat-cli="claude"]'));
await sleep(900);
check("⑦ 다시 Claude — 기억한 claude-x 로", [(await popInfo())?.cli[0], (await shape(D)).name], [["claude", true], "Claude-x"]);
await key("Escape");
await sleep(300);
check("⑦ Esc = 닫힘 · 포커스 = 키워드 · 독은 열린 채",
  [await ev(`!!document.querySelector('[data-chat-model-menu]')`), await ev(`document.activeElement?.hasAttribute('data-chat-model-chip') ?? false`), await ev(`document.querySelector('${D}').classList.contains('open')`)],
  [false, true, true]);
// 바깥 누르기 — 기록 칸을 누르면 닫힌다(독은 그대로)
await clickAt(`document.querySelector('${D} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-model-menu]')`, 3000);
await clickAt(`document.querySelector('${D} [data-chat-dock-list]')`);
await sleep(300);
check("⑦ 바깥 누르기 = 닫힘", await ev(`!!document.querySelector('[data-chat-model-menu]')`), false);
await ev(`document.querySelector('${D} [data-chat-dock-list]').click()`);
await sleep(300);

// ⑧ 좁은 폭 — 긴 모델 이름으로
await ev(`(async () => { const m = await ${importApp("app/side-chats.svelte.ts")}; m.setSideChatPick('chat-a', 'claude', 'claude-opus-5-5-20261101-preview'); })()`);
await ev(`(async () => (await ${DOCK}).setChatDockWidth(320))()`);
await sleep(600);
const n1 = await evj(`(() => { const n = document.querySelector('${D} [data-chat-model-name]'); return JSON.stringify({ shown: getComputedStyle(n).display !== 'none', clipped: n.scrollWidth > n.clientWidth }); })()`);
const s8 = await shape(D);
check("⑧ 독 320 — 긴 이름은 말줄임 · 알약 한 줄 · 손잡이와 글 칸이 겹치지 않음", [n1, s8.oneLine, s8.noOverlap], [{ shown: true, clipped: true }, true, true]);
await shot("home-narrow.png");
await send("Emulation.setDeviceMetricsOverride", { width: 250, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(800);
const s9 = await shape(D);
check("⑧ 아주 좁은 창 — 로고 ⌄ 만(이름 · 막대 숨김) · 겹침 없음", [s9.name, await ev(`getComputedStyle(document.querySelector('${D} .kw-gauge')).display`), s9.noOverlap], [null, "none", true]);
await shot("home-narrowest.png");

// ═══ B. 원격 데스크톱 ═════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 1400, height: 900 });
errors.length = 0;
await ev(`(async () => (await ${DOCK}).openChatDock())()`);
check("⑨ 원격 데스크톱 — 독 · 대화 면", await waitFor(`!!document.querySelector('[data-chat-dock].open [data-chat-model-chip]')`), true);
await sleep(600);
const r0 = await shape(D);
check("⑨ 같은 모양(칩 줄 · MCP 칩 없음 · 손잡이 알약 안 · 한 줄)", [r0.tools, r0.mcpChip, r0.plusIn, r0.kwIn, r0.oneLine, r0.noOverlap], [false, false, true, true, true, true]);
await shot("remote-desktop.png");
await clickAt(`document.querySelector('${D} [data-chat-plus]')`);
await waitFor(`!!document.querySelector('[data-toolbar-menu]')`, 3000);
check("⑨ [+] 뿌리", await menuKeys(), ["attach", "link", "mcp"]);
await shot("remote-plus.png");
await key("Escape");
await attachAndSend(D, "R");
await clickAt(`document.querySelector('${D} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-model-menu]')`, 3000);
const c7 = await callCount();
await clickAt(pop('[data-chat-effort="medium"]'));
await sleep(500);
check("⑨ 모델 메뉴 · Effort medium = set_effort", (await callsOf("side_chat_set_effort", c7)).map((a) => a.effort), ["medium"]);
await shot("remote-model.png");
await key("Escape");

// ═══ C. 원격 폰 ═══════════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 390, height: 844, mobile: true });
errors.length = 0;
await waitFor(`!!document.querySelector('[data-signal="side-chat"]')`, 8000);
await ev(`document.querySelector('[data-signal="side-chat"]').click()`);
check("⑩ 폰 덮개 · 대화 면", await waitFor(`!!document.querySelector('[data-mobile-chat] [data-chat-model-chip]')`), true);
await sleep(700);
const M = "[data-mobile-chat]";
const f0 = await shape(M);
check("⑩ 폰도 같은 모양 · 옛 칸 안 그림 단추 없음 · 그림 입력은 숨은 칸 하나", [f0.tools, f0.plusIn, f0.kwIn, f0.oldPick, f0.oneLine, f0.noOverlap, await ev(`document.querySelectorAll('${M} input[type=file][data-side-chat-pick]').length`)], [false, true, true, false, true, true, 1]);
// 누르는 자리 — [+] 의 ::after 가 44px
check("⑩ [+] 누르는 자리 44px", await ev(`(() => { const s = getComputedStyle(document.querySelector('${M} [data-chat-plus]'), '::after'); return s.content !== 'none' && s.inset === '-6px'; })()`), true);
await shot("phone-chat.png");
await clickAt(`document.querySelector('${M} [data-chat-plus]')`);
await waitFor(`!!document.querySelector('[data-toolbar-menu]')`, 3000);
const ph = await evj(`(() => { const m = document.querySelector('[data-toolbar-menu]'); const r = m.getBoundingClientRect();
  return JSON.stringify({ rows: [...m.querySelectorAll('[data-menu-key]')].map((b) => Math.round(b.getBoundingClientRect().height)), inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight }); })()`);
check("⑩ [+] 메뉴 — 줄 44px · 화면 안", ph, { rows: [44, 44, 44], inView: true });
await shot("phone-plus.png");
// 폰에서 연결 고르기(원격 창의 타일 — 거울의 셸이 없으면 '없음' 줄)
await clickAt(menuBtn("link"));
await sleep(300);
check("⑩ 폰 타일 연결 갈래가 선다(‹ 머리 · 끊기)", [(await menuKeys())[0], (await menuKeys()).at(-1)], ["back", "unlink"]);
await key("Escape");
await sleep(200);
await clickAt(`document.querySelector('${M} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-chat-model-menu]')`, 3000);
await sleep(300);
const pp = await evj(`(() => { const m = document.querySelector('[data-chat-model-menu]'); const r = m.getBoundingClientRect();
  return JSON.stringify({ inView: r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight, row: Math.round(m.querySelector('[data-chat-model]').getBoundingClientRect().height),
    seg: Math.round(m.querySelector('[data-chat-cli]').getBoundingClientRect().height), effort: Math.round(m.querySelector('[data-chat-effort]').getBoundingClientRect().height) }); })()`);
check("⑩ 모델 메뉴 — 화면 안 · 줄 · 세그먼트 · 게이지 칸 44px", pp, { inView: true, row: 44, seg: 44, effort: 44 });
const c8 = await callCount();
await clickAt(pop('[data-chat-effort="low"]'));
await sleep(500);
check("⑩ 폰 Effort low = set_effort · 메뉴 열린 채", [(await callsOf("side_chat_set_effort", c8)).map((a) => a.effort), await ev(`!!document.querySelector('[data-chat-model-menu]')`)], [["low"], true]);
await shot("phone-model.png");
await key("Escape");
await sleep(200);
await attachAndSend(M, "P");

if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑪ 잡히지 않은 예외 · 콘솔 오류 0", errors.length, 0);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
