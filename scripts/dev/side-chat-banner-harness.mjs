// 헤드리스 검증 — **사이드 채팅 알림 = AI 타일 알림 배너** (2026-11-13 사용자 결정 · 목업 A안 — `app/side-chat-notify` →
// `app/agent-banners` · `AgentNotifyBanners` · 항목의 대상 `sideChatId`).
//
// 스텁은 `side-chat-path-links-harness.mjs` 의 사이드 채팅 명령(채팅 셋 · 통로 · 스냅숏)에서 파일 명령을 걷고, 통로(`side_chat_subscribe` 의
// Channel)로 사건을 먹이는 `__scFeed(chat, ev)` 와 창 포커스 스텁(`document.hasFocus` → `window.__focus` + `focus`/`blur` 사건) ·
// OS 알림 스텁(`window.Notification` → `__os`)을 더했다.
//
// 보는 것:
// ① 끝남 · 권한 · 실패 배너 모양 — 로고(`AiGlyph`) · 제목 "Claude Code · <채팅 제목>" · 채팅 칩 · 상태 점(끝남 `--ok` · 권한 `--accent` ·
//    실패 `--err`) · 둘째 줄 · 단추 문구 · 권한은 강조 테두리 · **토스트 없음** · 배지(수 3 · 강조색)
// ② 사건 길(진짜 `side-chat-live` 의 사건 적용) — 권한 사건 → 배너 · 다른 창이 답함(`permissionResolved`) → 저절로 해결 · 오류 턴 끝 → 실패 배너 ·
//    새 턴(`turnStarted`) → 저절로 해결
// ③ `` Alt+` `` 차례 — 권한 먼저 → 그다음 최근 것 · 갈 때마다 그 채팅이 골라지고 채팅 독이 열리며 해결("확인함")
// ④ [보기] → 그 채팅 열림 + 해결 ⑤ 채팅 독에서 그 채팅을 고르면 해결(방문) · 이미 보고 있는 채팅은 알리지 않음
// ⑥ 창이 뒤 → OS 알림 + 배너(그 채팅을 보는 중이어도) → 창이 앞에 서면 곧바로 해결
// ⑦ 10초 뒤 알약("<제목> · 끝남") → 누르면 펼침
// ⑧ 독 "확인할 것" 줄 → 그 채팅 · 지난 알림 = 배너 기록 줄(`data-notify-side-chat` · 누르면 그 채팅) · 일반 기록에는 안 적힘(두 번 없음)
// ⑨ 지워진 채팅 → 그 배너 저절로 해결
// ⑩ 원격 폰(400x844) — 배너가 서고 [확인하러 가기] → 그 채팅의 폰 덮개 · 해결
// ⑪ 콘솔 오류 0(`stub:` 거절 제외)
// ⑫ 두 창(집 PC 데스크톱 + 원격 폰 — 같은 Edge 의 둘째 탭) 완료 확인 공유 — 집 PC 에서 보면(턴 끝 뒤 입력) 폰의 끝남 배너가 풀림 · 폰에서 보면 집 PC 의
//    실패 배너가 풀림 · op `side_chat_seen` 몸 = chat · epoch · seq · 앞 턴 번호 · 다른 세대 확인은 버림 · 권한 물음은 안 풀림(서버 방송은 하네스가 흉내)
//
//   node scripts/dev/run-harness.mjs side-chat-banner-harness.mjs <outdir> --size 1280x860
//     → <outdir>/scb-three.png · scb-pill.png · scb-alerts.png · scb-phone.png · scb-phone-open.png · scb-two-remote-cleared.png · scb-two-home-cleared.png
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
/** 그 요소를 실제 마우스로 누른다(가운데) — 없으면 false */
const clickSel = async (sel) => {
  const r = await evj(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
  if (!r) return false;
  await mouse("mouseMoved", r.x, r.y, { buttons: 0 });
  await mouse("mousePressed", r.x, r.y);
  await mouse("mouseReleased", r.x, r.y);
  return true;
};
/** 마우스를 배너 밖(왼쪽 아래)으로 — 호버 멈춤이 접힘 시계를 잡지 않게 */
const mouseAway = () => mouse("mouseMoved", 40, 700, { buttons: 0 });
const altBackquote = async () => {
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, code: "Backquote", key: "`", windowsVirtualKeyCode: 192, nativeVirtualKeyCode: 192, modifiers: 1 });
  await sleep(400);
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
const CHAT = importApp("app/chat-dock.svelte.ts");
const CHATS = importApp("app/side-chats.svelte.ts");
const NOTIFY = importApp("app/side-chat-notify.ts");
const BANNERS = importApp("app/agent-banners.svelte.ts");
const NOTES = importApp("app/notifications.svelte.ts");
const LIVE = importApp("app/side-chat-live.svelte.ts");

const stub = (remote) => `
  performance.setResourceTimingBufferSize(10000);
  ${remote ? "window.__AYNX_REMOTE__ = true;" : ""}
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__calls = []; window.__os = [];
  window.__focus = true; document.hasFocus = () => window.__focus;
  // ⑫ 두 창을 한 Edge 에 띄우면 뒤의 탭은 숨김이 된다 — 두 창 모두 화면이 켜진 채라고 본다
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, opts) { window.__os.push({ title, body: opts?.body ?? null }); } };
  const evts = new Map();
  const NOW = Date.now();
  const chat = (id, title, ago) => ({ id, cli: 'claude', model: '', effort: '', title, createdAt: NOW - ago - 1000, usedAt: NOW - ago, used: [], links: {} });
  const FILE = { v: 2, current: 'chat-a', last: { cli: 'claude', model: '', effort: '' },
    chats: [chat('chat-a', 'alpha', 60000), chat('chat-b', 'beta', 120000), chat('chat-c', 'gamma', 180000)] };
  const seqs = { 'chat-a': 4, 'chat-b': 4, 'chat-c': 4 };
  const snap = (id = 'chat-a') => ({
    link: null, chat: id, cli: 'claude', model: '', effort: null, epoch: 1, leaseEpoch: 1, seq: seqs[id] ?? 4, status: 'ready',
    conversationId: null, cwd: null, mcpServers: [],
    liveTurn: [{ t: 'turnStarted', turn: 't1' }, { t: 'userAccepted', clientId: null, text: 'hi' }, { t: 'text', item: 'i1', text: 'hello from ' + id }, { t: 'turnEnded', turn: 't1', outcome: 'ok', message: null }],
    pending: [],
  });
  /** 통로로 사건 하나 — 채팅마다 seq 를 잇는다 */
  let chanIdx = 0;
  window.__scFeed = (id, ev) => { const ch = window.__scChan; if (!ch) return 'no channel'; const cb = cbs.get(ch.id); if (!cb) return 'no cb';
    seqs[id] = (seqs[id] ?? 4) + 1; cb({ message: { chat: id, epoch: 1, seq: seqs[id], ev }, index: chanIdx++ }); return 'ok'; };
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }],
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, send_input: null, reap_window_sessions: null, session_log_path: null,
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chat_list: ['chat-a', 'chat-b', 'chat-c'].map((chat) => ({ chat, cli: 'claude', model: '', effort: null, epoch: 1, status: 'ready', conversationId: null, viewers: 1, detached: false })),
    side_chat_close: null, side_chat_remove: null, side_chat_dir: 'C:/Users/me/side-chats/x',
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
    'plugin:notification|is_permission_granted': true,
  };
  const label = ${remote ? "'remote-h-1'" : "'main'"};
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'side_chats_load') return Promise.resolve({ json: JSON.stringify(FILE), rev: 1 });
      if (cmd === 'side_chats_save') return Promise.resolve({ rev: 2 });
      if (cmd === 'side_chat_subscribe') { window.__scChan = args?.channel ?? null; return Promise.resolve(null); }
      if (cmd === 'side_chat_attach') return Promise.resolve(snap(args?.chat));
      if (cmd === 'mirror_request') return Promise.resolve(null);
      // ⑫ 완료 확인 공유 — 하네스가 서버 흉내로 모아 두 창에 방송한다(\`__seenOut\`)
      if (cmd === 'side_chat_seen') { (window.__seenOut ??= []).push(args); return Promise.resolve({ sent: true }); }
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__emit = (name, payload) => { for (const id of evts.get(name) ?? []) cbs.get(id)?.({ event: name, id, payload }); };
`;

await send("Page.enable");
await send("Runtime.enable");
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
    if ((await ev(`(async () => { try { await ${W}; await ${CHATS}; await ${NOTIFY}; await ${BANNERS}; await ${LIVE}; return true; } catch { return false; } })()`)) === true) break;
    await sleep(300);
  }
  await sleep(800);
};

const BANNER = (id) => `[data-agent-banners] [data-side-chat="${id}"]`;
/** 배너 한 장의 모양 */
const bannerShape = (id) =>
  evj(`(() => { const s = document.querySelector('${BANNER(id)}'); if (!s) return 'null'; const card = s.querySelector('.card');
    const dot = s.querySelector('.status'); const chip = s.querySelector('[data-banner-chat-chip]');
    return JSON.stringify({ kind: s.dataset.kind, collapsed: s.dataset.collapsed, logo: !!s.querySelector('.logo svg, .logo img'),
      title: s.querySelector('.title')?.textContent.trim() ?? null, chip: chip?.textContent.trim() ?? null, chipIcon: !!chip?.querySelector('svg'),
      line2: s.querySelector('.line2')?.textContent.trim() ?? null, act: s.querySelector('[data-banner-open]')?.textContent.trim() ?? null,
      permissionBorder: card?.classList.contains('permission') ?? null, dot: dot ? getComputedStyle(dot).backgroundColor : null }); })()`);
/** 칩 글자가 보이는지 · 칩 이름(title · aria-label) · 제목이 말줄임 없이 다 보이는지 · `<prefix>…` 이 제목 칸에 들어가는지.
 *  글 폭은 같은 클래스의 복제본을 줄 밖에 띄워 잰다(말줄임 상자의 scrollWidth · Range 는 말줄임된 줄을 재서 "다 보임" 으로 속는다 ·
 *  캔버스는 계산된 font 줄이 비어 기본 글꼴로 잰다). 여유를 두지 않는다 — 폰에서 0.2px 모자라 말줄임된 것을 놓친 적이 있다. 글꼴이 선 뒤에 잰다 */
const chipFit = (id, prefix) =>
  evj(`(async () => { await document.fonts.ready; const s = document.querySelector('${BANNER(id)}'); const chip = s?.querySelector('[data-banner-chat-chip]');
    const txt = chip?.querySelector('.where-txt'); const title = s?.querySelector('.title'); if (!title) return 'null';
    const boxW = title.getBoundingClientRect().width;
    const natural = (text) => { const k = title.cloneNode(false); k.textContent = text;
      Object.assign(k.style, { position: 'absolute', visibility: 'hidden', width: 'auto', maxWidth: 'none', overflow: 'visible', flex: 'none' });
      title.parentElement.append(k); const w = k.getBoundingClientRect().width; k.remove(); return w; };
    return JSON.stringify({ chipText: !!txt && txt.getBoundingClientRect().width > 0, chipTitle: chip?.getAttribute('title') ?? null,
      chipLabel: chip?.getAttribute('aria-label') ?? null, titleWhole: natural(title.textContent.trim()) <= boxW,
      prefixFits: natural(${JSON.stringify(prefix)} + '…') <= boxW }); })()`);
const cssVar = (name) =>
  ev(`(() => { const d = document.createElement('span'); d.style.background = 'var(${name})'; document.body.append(d); const c = getComputedStyle(d).backgroundColor; d.remove(); return c; })()`);
const activeOf = () => evj(`(async () => JSON.stringify((await ${BANNERS}).agentBannerItems().map((b) => [b.sideChatId ?? b.paneId, b.kind])))()`);
const resolvedOf = () => evj(`(async () => JSON.stringify((await ${BANNERS}).resolvedAgentBanners().map((b) => [b.sideChatId ?? b.paneId, b.kind, b.resolution])))()`);
const currentChat = () => ev(`(async () => (await ${CHATS}).currentSideChat()?.id ?? null)()`);
const dockOpen = () => ev(`(async () => (await ${CHAT}).chatDockOpen())()`);
const notify = (id, kind, shown = false) => ev(`(async () => (await ${NOTIFY}).notifySideChat('${id}', '${kind}', ${shown}))()`);
const closeChatDock = async () => {
  await ev(`(async () => (await ${CHAT}).closeChatDock(false))()`);
  await sleep(300);
};
const clearBanners = async () => {
  await ev(`(async () => { const b = await ${BANNERS}; b.resolveFinishedBanners(); for (const x of b.agentBannerItems()) b.dropSideChatBanner(x.sideChatId); b.clearResolvedBanners(); })()`);
  await sleep(200);
};

// ════════════════════════════════════════════════════════════════════════════════
// 데스크톱 주 창
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
await mouseAway();
await closeChatDock();
check("(준비) 지금 채팅 = chat-a · 채팅 독 닫힘 · 배너 없음", [await currentChat(), await dockOpen(), await activeOf()], ["chat-a", false, []]);
const OK = await cssVar("--ok");
const ACCENT = await cssVar("--accent");
const ERR = await cssVar("--err");

// ① 모양 — 끝남(chat-b) · 권한(chat-a — 지금 채팅이어도 독이 닫혀 안 보인다) · 실패(chat-c)
await notify("chat-b", "finished");
await notify("chat-a", "permission");
await notify("chat-c", "failed");
check("① 배너 셋이 선다", await waitFor(`document.querySelectorAll('[data-agent-banners] [data-side-chat]').length === 3`, 4000), true);
await sleep(500);
check("① 끝남 모양", await bannerShape("chat-b"), {
  kind: "stop", collapsed: "false", logo: true, title: "Claude Code · beta", chip: "채팅", chipIcon: true,
  line2: "답변이 끝났습니다", act: "보기", permissionBorder: false, dot: OK,
});
check("① 권한 모양(강조 테두리 · [확인하러 가기])", await bannerShape("chat-a"), {
  kind: "permission", collapsed: "false", logo: true, title: "Claude Code · alpha", chip: "채팅", chipIcon: true,
  line2: "권한을 묻고 있습니다", act: "확인하러 가기", permissionBorder: true, dot: ACCENT,
});
check("① 실패 모양(끝남과 같고 점만 오류색)", await bannerShape("chat-c"), {
  kind: "failed", collapsed: "false", logo: true, title: "Claude Code · gamma", chip: "채팅", chipIcon: true,
  line2: "답변이 실패했습니다", act: "보기", permissionBorder: false, dot: ERR,
});
check("① 데스크톱 칩 = 아이콘 + 글자 · 제목 다 보임", await chipFit("chat-b", "Claude Code · b"), {
  chipText: true, chipTitle: "채팅", chipLabel: "채팅", titleWhole: true, prefixFits: true,
});
check("① 상태 점 색이 셋 다 다르다", new Set([OK, ACCENT, ERR]).size, 3);
check("① 사이드 채팅 토스트 없음", await ev(`[...document.querySelectorAll('.toast')].filter((e) => /alpha|beta|gamma/.test(e.textContent)).length`), 0);
check("① 배지 — 수 3 · 강조색(권한)", await evj(`(async () => JSON.stringify((await ${BANNERS}).agentBannerBadge()))()`), { count: 3, urgent: true });
check("① 일반 기록에 사이드 채팅 줄 없음", await evj(`(async () => JSON.stringify((await ${NOTES}).notificationList().filter((e) => e.kind === 'side-chat').length))()`), 0);
check("① OS 알림 없음(창이 앞)", await evj(`JSON.stringify(window.__os.length)`), 0);
await shot("scb-three.png");

// ③ Alt+` — 권한(chat-a) 먼저 → 그다음 최근(chat-c 실패) → chat-b
await altBackquote();
check("③ Alt+` ① → chat-a · 채팅 독 열림", [await currentChat(), await dockOpen()], ["chat-a", true]);
check("③ chat-a 해결(확인함)", (await resolvedOf())[0], ["chat-a", "permission", "checked"]);
await closeChatDock();
await altBackquote();
check("③ Alt+` ② → chat-c(실패 — 최근)", [await currentChat(), await dockOpen()], ["chat-c", true]);
await closeChatDock();
check("③ 남은 것 = chat-b 끝남", await activeOf(), [["chat-b", "stop"]]);

// ④ [보기] → 그 채팅 열림 + 해결
await mouseAway();
check("④ [보기] 누름", await clickSel(`${BANNER("chat-b")} [data-banner-open]`), true);
check("④ chat-b 열림", await waitFor(`(async () => (await ${CHATS}).currentSideChat()?.id === 'chat-b' && (await ${CHAT}).chatDockOpen())()`, 4000), true);
check("④ 배너 없음 · 해결(확인함)", [await activeOf(), (await resolvedOf())[0]], [[], ["chat-b", "stop", "checked"]]);

// ⑤ 채팅 독에서 그 채팅을 보면 해결 · 이미 보고 있는 채팅은 알리지 않음
check("⑤ (준비) 보이는 채팅 = chat-b", await ev(`(async () => (await ${LIVE}).shownSideChat())()`), "chat-b");
await notify("chat-b", "finished", true);
await sleep(300);
check("⑤ 보고 있는 채팅 → 알리지 않음", await activeOf(), []);
await notify("chat-a", "finished");
check("⑤ 다른 채팅 → 배너", await waitFor(`!!document.querySelector('${BANNER("chat-a")}')`, 3000), true);
await ev(`(async () => (await ${CHATS}).selectSideChat('chat-a'))()`);
check("⑤ 독에서 chat-a 를 고름 → 해결", await waitFor(`(async () => (await ${BANNERS}).agentBannerItems().length === 0)()`, 3000), true);
check("⑤ 해결 = 확인함", (await resolvedOf())[0], ["chat-a", "stop", "checked"]);

// ② 사건 길 — 진짜 side-chat-live 의 사건 적용(독은 닫고 chat-b 로)
await closeChatDock();
check("② (준비) 통로가 섰다", await ev(`!!window.__scChan`), true);
const perm = { t: "permission", requestId: "r1", kind: "command", title: "Run", detail: "ls", toolName: "Bash" };
check("② 권한 사건", await ev(`window.__scFeed('chat-b', ${JSON.stringify(perm)})`), "ok");
check("② → 권한 배너", await waitFor(`document.querySelector('${BANNER("chat-b")}')?.dataset.kind === 'permission'`, 3000), true);
await ev(`window.__scFeed('chat-b', ${JSON.stringify({ t: "permissionResolved", requestId: "r1", decision: "allow", by: "human" })})`);
check("② 다른 창이 답함 → 저절로 해결", await waitFor(`!document.querySelector('${BANNER("chat-b")}')`, 3000), true);
check("② 해결 = 저절로", (await resolvedOf())[0], ["chat-b", "permission", "auto"]);
await ev(`window.__scFeed('chat-b', ${JSON.stringify({ t: "turnEnded", turn: "t1", outcome: "error", message: "boom" })})`);
check("② 오류 턴 끝 → 실패 배너", await waitFor(`document.querySelector('${BANNER("chat-b")}')?.dataset.kind === 'failed'`, 3000), true);
await ev(`window.__scFeed('chat-b', ${JSON.stringify({ t: "turnStarted", turn: "t2" })})`);
check("② 새 턴 → 저절로 해결", await waitFor(`!document.querySelector('${BANNER("chat-b")}')`, 3000), true);
check("② 해결 = 실패 · 저절로", (await resolvedOf())[0], ["chat-b", "failed", "auto"]);
await ev(`window.__scFeed('chat-b', ${JSON.stringify({ t: "turnEnded", turn: "t2", outcome: "ok", message: null })})`);
check("② 잘 끝남 → 끝남 배너", await waitFor(`document.querySelector('${BANNER("chat-b")}')?.dataset.kind === 'stop'`, 3000), true);
await clearBanners();

// ⑥ 창이 뒤 — 그 채팅을 보는 중이어도 OS 알림 + 배너 → 창이 앞에 서면 곧바로 해결
await ev(`(async () => { (await ${CHATS}).selectSideChat('chat-c'); (await ${CHAT}).openChatDockAt('chat'); })()`);
await sleep(400);
check("⑥ (준비) 보이는 채팅 = chat-c", await ev(`(async () => (await ${LIVE}).shownSideChat())()`), "chat-c");
await ev(`window.__focus = false; window.dispatchEvent(new Event('blur'))`);
await notify("chat-c", "finished", true);
await sleep(500);
check("⑥ 창이 뒤 → OS 알림 하나", await evj(`JSON.stringify(window.__os.map((o) => o.body))`), ["‘gamma’ 답변이 끝났습니다"]);
check("⑥ 창이 뒤 → 배너도 남음", await activeOf(), [["chat-c", "stop"]]);
await ev(`window.__focus = true; window.dispatchEvent(new Event('focus'))`);
check("⑥ 창이 앞 + 그 채팅이 보임 → 해결", await waitFor(`(async () => (await ${BANNERS}).agentBannerItems().length === 0)()`, 3000), true);
await closeChatDock();

// ⑦ 접힘 — 10초 뒤 알약 · 누르면 펼침
await mouseAway();
await notify("chat-b", "finished");
check("⑦ 펼친 카드", await waitFor(`document.querySelector('${BANNER("chat-b")}')?.dataset.collapsed === 'false'`, 3000), true);
check("⑦ 10초 뒤 알약", await waitFor(`!!document.querySelector('${BANNER("chat-b")} [data-banner-pill]')`, 14000), true);
check("⑦ 알약 글", await ev(`document.querySelector('${BANNER("chat-b")} .pill-text')?.textContent.trim()`), "beta · 끝남");
await shot("scb-pill.png");
await clickSel(`${BANNER("chat-b")} [data-banner-pill]`);
check("⑦ 알약 누름 → 펼침", await waitFor(`document.querySelector('${BANNER("chat-b")}')?.dataset.collapsed === 'false'`, 3000), true);
await mouseAway();

// ⑧ 독 알림 칸 — "확인할 것" 줄 → 그 채팅 · 지난 알림 = 배너 기록 줄
const LAUNCH = importApp("app/dock.svelte.ts");
await ev(`(async () => (await ${LAUNCH}).openDock('alerts'))()`);
const TODO = `.dock [data-dock-alerts] [data-notify-todo-list] .row[data-kind="stop"] [data-alert-row]`;
check("⑧ 확인할 것 줄", await waitFor(`!!document.querySelector('${TODO}')`, 4000), true);
check("⑧ 지난 알림 = 배너 기록 줄", await waitFor(`document.querySelectorAll('.dock [data-dock-alerts] [data-notify-side-chat]').length > 0`, 3000), true);
await sleep(400);
await shot("scb-alerts.png");
await clickSel(TODO);
check("⑧ 확인할 것 → chat-b · 런처 독 닫힘", await waitFor(`(async () => (await ${CHATS}).currentSideChat()?.id === 'chat-b' && (await ${CHAT}).chatDockOpen() && (await ${LAUNCH}).dockKind() === null)()`, 4000), true);
check("⑧ 해결(확인함)", [await activeOf(), (await resolvedOf())[0]], [[], ["chat-b", "stop", "checked"]]);
await closeChatDock();
await ev(`(async () => (await ${CHATS}).selectSideChat('chat-a'))()`);
await ev(`(async () => (await ${LAUNCH}).openDock('alerts'))()`);
const HIST_C = `.dock [data-dock-alerts] [data-notify-side-chat="chat-c"]`;
check("⑧ 지난 알림 chat-c 줄(⑥ 에서 해결) = 단추", await waitFor(`document.querySelector('${HIST_C}')?.tagName === 'BUTTON'`, 4000), true);
await sleep(300);
await clickSel(HIST_C);
check("⑧ 지난 알림 줄 → chat-c 열림", await waitFor(`(async () => (await ${CHATS}).currentSideChat()?.id === 'chat-c' && (await ${CHAT}).chatDockOpen())()`, 4000), true);
check("⑧ 일반 기록에 사이드 채팅 줄 없음(두 번 안 적힘)", await evj(`(async () => JSON.stringify((await ${NOTES}).notificationList().length))()`), 0);
await closeChatDock();

// ⑨ 지워진 채팅 → 그 배너 저절로 해결
await notify("chat-c", "failed");
check("⑨ (준비) chat-c 배너", await waitFor(`!!document.querySelector('${BANNER("chat-c")}')`, 3000), true);
await ev(`(async () => { try { await (await ${CHATS}).deleteSideChat('chat-c'); } catch (e) { return String(e); } })()`);
check("⑨ 지움 → 배너 없음", await waitFor(`!document.querySelector('${BANNER("chat-c")}')`, 3000), true);
check("⑨ 해결 = 저절로", (await resolvedOf())[0], ["chat-c", "failed", "auto"]);

// ════════════════════════════════════════════════════════════════════════════════
// ⑩ 원격 폰 — 배너 상자는 폰에도 선다
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 400, height: 844, mobile: true });
// 원격 창의 안내 토스트를 숨긴다(remote-chat-dock-harness 와 같다) — 사이드 채팅 토스트가 없음은 데스크톱 ①에서 봤다
await ev(`(() => { const s = document.createElement('style'); s.textContent = '.toast { display: none !important; }'; document.head.append(s); })()`);
check("⑩ (준비) 지금 채팅 = chat-a · 덮개 없음", [await currentChat(), await ev(`!!document.querySelector('[data-mobile-chat]')`)], ["chat-a", false]);
await notify("chat-b", "permission");
check("⑩ 폰 배너", await waitFor(`!!document.querySelector('${BANNER("chat-b")} [data-banner-open]')`, 4000), true);
check("⑩ 폰 배너 모양", await bannerShape("chat-b"), {
  kind: "permission", collapsed: "false", logo: true, title: "Claude Code · beta", chip: "채팅", chipIcon: true,
  line2: "권한을 묻고 있습니다", act: "확인하러 가기", permissionBorder: true, dot: await cssVar("--accent"),
});
await sleep(400);
// 폰 기둥은 [확인하러 가기]·닫기까지 한 줄이라 제목 전체는 장담하지 않는다 — 칩이 글자를 접어 `· <채팅 제목>` 의 머리는 보여야 한다
const phoneFit = await chipFit("chat-b", "Claude Code · b");
check("⑩ 폰 칩 = 아이콘만(이름은 title · aria-label) · 제목에 채팅 이름 머리가 보임", { ...phoneFit, titleWhole: undefined }, {
  chipText: false, chipTitle: "채팅", chipLabel: "채팅", prefixFits: true,
});
console.log(`  (참고) 폰 제목 전체가 보임: ${phoneFit?.titleWhole}`);
await shot("scb-phone.png");
await clickSel(`${BANNER("chat-b")} [data-banner-open]`);
check("⑩ [확인하러 가기] → 폰 채팅 덮개 · chat-b", await waitFor(`(async () => !!document.querySelector('[data-mobile-chat]') && (await ${CHATS}).currentSideChat()?.id === 'chat-b')()`, 4000), true);
check("⑩ 해결(확인함)", [await activeOf(), (await resolvedOf())[0]], [[], ["chat-b", "permission", "checked"]]);
await sleep(500);
await shot("scb-phone-open.png");

// ════════════════════════════════════════════════════════════════════════════════
// ⑫ 두 창 — 집 PC 창(이 페이지 · 데스크톱) + 원격 폰 창(둘째 페이지): 한 창에서 사람이 턴 끝을 보면 다른 창의 끝남 · 실패 배너가 풀린다
// (2026-11-13 — `app/agent-seen` 의 사이드 채팅 갈래 · op `side_chat_seen` → 방송 `side-chat-seen`). 서버는 하네스가 흉내 낸다: 두 창의
// `__seenOut` 을 모아 세대 · 번호를 보고 두 창에 `side-chat-seen{chat, epoch, seq}` 를 쏜다. 채팅 사건은 두 창에 같은 것을 먹인다(서버가 보는 창 모두에 낸다).
// ════════════════════════════════════════════════════════════════════════════════
/** 둘째 페이지(같은 Edge) — CDP 클라이언트 하나 */
const pageClient = async (wsUrl) => {
  const s = new WebSocket(wsUrl);
  await new Promise((r) => (s.onopen = r));
  let k = 0;
  const waits = new Map();
  s.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && waits.has(d.id)) {
      waits.get(d.id)(d);
      waits.delete(d.id);
      return;
    }
    if (d.method === "Runtime.exceptionThrown") {
      const x = d.params.exceptionDetails;
      const t = (x.exception?.description ?? x.text ?? "").split("\n")[0];
      if (!/stub:/.test(t)) errors.push("B EXC " + t);
    }
    if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
      const t = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0];
      if (!/stub:/.test(t)) errors.push("B console.error " + t);
    }
  };
  const call = (method, params = {}) =>
    new Promise((r) => {
      const id = ++k;
      waits.set(id, r);
      s.send(JSON.stringify({ id, method, params }));
    });
  const e = async (x) => {
    const r = await call("Runtime.evaluate", { expression: x, awaitPromise: true, returnByValue: true });
    return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value;
  };
  return { send: call, ev: e, close: () => s.close() };
};
const A = { send, ev };
// 집 PC 창을 다시 띄운다(앞 판의 폰 배치를 걷고)
await bootPage({ remote: false, width: 1280, height: 860 });
await closeChatDock();
await clearBanners();
// 둘째 탭(같은 Edge · 같은 임시 프로필 — 러너가 Edge 트리째 끈다)
const bTarget = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" })).json();
const B = await pageClient(bTarget.webSocketDebuggerUrl);
await B.send("Page.enable");
await B.send("Runtime.enable");
await B.send("Page.addScriptToEvaluateOnNewDocument", { source: stub(true) });
await B.send("Emulation.setDeviceMetricsOverride", { width: 400, height: 844, deviceScaleFactor: 2, mobile: true });
await B.send("Page.navigate", { url: `http://localhost:${PAGE_PORT}/` });
const waitOn = async (P, expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await P.ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
check("⑫ (준비) 원격 폰 창이 섰다", await waitOn(B, `!!document.querySelector('.mobile-bar')`, 20000), true);
for (let i = 0; i < 50; i++) {
  if ((await B.ev(`(async () => { try { await ${CHATS}; await ${BANNERS}; await ${LIVE}; await ${importApp("app/mobile-sheets.svelte.ts")}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
await B.ev(`(() => { const s = document.createElement('style'); s.textContent = '.toast { display: none !important; }'; document.head.append(s); })()`);
await sleep(800);
const SHEETS = importApp("app/mobile-sheets.svelte.ts");
// 두 창 모두 채팅들에 붙고 통로를 건다 — 집 PC 는 독을 한 번 열고 닫고, 폰은 덮개를 한 번 열고 닫는다
await ev(`(async () => (await ${CHAT}).toggleChatDock())()`);
await sleep(600);
await closeChatDock();
await B.ev(`(async () => (await ${SHEETS}).openMobileChat())()`);
await sleep(800);
await B.ev(`(async () => (await ${SHEETS}).closeMobileOverlay())()`);
await sleep(600);
check("⑫ (준비) 두 창 통로 · 두 창 모두 채팅을 안 봄", [await ev(`!!window.__scChan`), await B.ev(`!!window.__scChan`),
  await ev(`(async () => (await ${LIVE}).shownSideChat())()`), await B.ev(`(async () => (await ${LIVE}).shownSideChat())()`)], [true, true, null, null]);
/** 두 창에 같은 사건(서버는 보는 창 모두에 낸다) */
const feedBoth = async (chat, e) => [await ev(`window.__scFeed('${chat}', ${JSON.stringify(e)})`), await B.ev(`window.__scFeed('${chat}', ${JSON.stringify(e)})`)];
const bannersOf = (P) => P.ev(`(async () => JSON.stringify((await ${BANNERS}).agentBannerItems().map((b) => [b.sideChatId ?? b.paneId, b.kind])))()`).then((v) => JSON.parse(v));
const resolvedFirst = (P) => P.ev(`(async () => JSON.stringify((await ${BANNERS}).resolvedAgentBanners().map((b) => [b.sideChatId ?? b.paneId, b.kind, b.resolution])[0] ?? null))()`).then((v) => JSON.parse(v));
/** 서버 흉내 — 두 창이 보낸 확인을 모아 방송한다(세대 1 · 그 창의 번호보다 앞서지 않은 것만 — 서버의 `seen_payload`). 보낸 것들을 돌려준다 */
const relaySeen = async () => {
  const out = [];
  for (const P of [A, B]) out.push(...JSON.parse(await P.ev(`JSON.stringify((window.__seenOut ?? []).splice(0))`)));
  for (const s of out) {
    if (s.epoch !== 1) continue;
    const body = JSON.stringify({ chat: s.chat, epoch: s.epoch, seq: s.seq });
    for (const P of [A, B]) await P.ev(`window.__emit('side-chat-seen', ${body})`);
  }
  return out.map((s) => [s.chat, s.epoch, s.seq]);
};
const relayUntil = async (ms = 4000) => {
  const all = [];
  for (let i = 0; i < ms / 200; i++) {
    all.push(...(await relaySeen()));
    if (all.length) break;
    await sleep(200);
  }
  await sleep(300);
  return all;
};

// 방향 1 — 집 PC 에서 보면 원격 폰의 끝남 배너가 풀린다
await mouseAway();
check("⑫ chat-b 턴(시작 · 잘 끝남) 두 창에", [...(await feedBoth("chat-b", { t: "turnStarted", turn: "t9" })), ...(await feedBoth("chat-b", { t: "turnEnded", turn: "t9", outcome: "ok", message: null }))], ["ok", "ok", "ok", "ok"]);
await sleep(500);
check("⑫ 두 창 모두 chat-b 끝남 배너", [await bannersOf(A), await bannersOf(B)], [[["chat-b", "stop"]], [["chat-b", "stop"]]]);
const endB = JSON.parse(await ev(`(async () => JSON.stringify((await ${LIVE}).sideChatTurnEnd('chat-b')))()`));
check("⑫ 두 창의 턴 끝 번호가 같다(세대 1)", [endB, JSON.parse(await B.ev(`(async () => JSON.stringify((await ${LIVE}).sideChatTurnEnd('chat-b')))()`))], [endB, endB]);
// 집 PC — 독을 열어 chat-b 를 본다. 넓은 창은 턴 끝 뒤 입력이 있어야 보낸다: 먼저 입력 없이 열기만
await ev(`(async () => { (await ${CHATS}).selectSideChat('chat-b'); (await ${CHAT}).openChatDockAt('chat'); })()`);
await sleep(600);
check("⑫ 집 PC 가 보는 채팅 = chat-b → 제 배너는 방문으로 풀림", [await ev(`(async () => (await ${LIVE}).shownSideChat())()`), await bannersOf(A)], ["chat-b", []]);
const early = await relaySeen();
console.log("  (참고) 입력 전에 보낸 확인:", JSON.stringify(early));
await mouse("mouseMoved", 300, 500, { buttons: 0 });
await mouse("mouseMoved", 310, 505, { buttons: 0 });
const sent1 = [...early, ...(await relayUntil())];
check("⑫ 집 PC → side_chat_seen{chat-b, 1, 턴 끝 번호} 하나", sent1, [["chat-b", 1, endB?.seq]]);
check("⑫ 원격 폰의 chat-b 배너가 풀림(확인함)", [await bannersOf(B), await resolvedFirst(B)], [[], ["chat-b", "stop", "checked"]]);
await B.send("Page.captureScreenshot", { format: "png" }).then((r) => r.result?.data && fs.writeFileSync(path.join(outdir, "scb-two-remote-cleared.png"), Buffer.from(r.result.data, "base64")));
await closeChatDock();
await mouseAway();

// 방향 2 — 원격 폰에서 보면 집 PC 의 실패 배너가 풀린다(폰은 화면이 켜져 있으면 입력을 묻지 않는다)
check("⑫ chat-c 턴(시작 · 오류 끝) 두 창에", [...(await feedBoth("chat-c", { t: "turnStarted", turn: "t9" })), ...(await feedBoth("chat-c", { t: "turnEnded", turn: "t9", outcome: "error", message: "boom" }))], ["ok", "ok", "ok", "ok"]);
await sleep(500);
check("⑫ 두 창 모두 chat-c 실패 배너", [await bannersOf(A), await bannersOf(B)], [[["chat-c", "failed"]], [["chat-c", "failed"]]]);
await B.ev(`(async () => { (await ${CHATS}).selectSideChat('chat-c'); (await ${SHEETS}).openMobileChat(); })()`);
check("⑫ 폰이 chat-c 덮개를 연다", await waitOn(B, `(async () => !!document.querySelector('[data-mobile-chat]') && (await ${LIVE}).shownSideChat() === 'chat-c')()`, 4000), true);
const endC = JSON.parse(await B.ev(`(async () => JSON.stringify((await ${LIVE}).sideChatTurnEnd('chat-c')))()`));
check("⑫ 폰 → side_chat_seen{chat-c, 1, 턴 끝 번호}", await relayUntil(), [["chat-c", 1, endC?.seq]]);
check("⑫ 집 PC 의 chat-c 실패 배너가 풀림(확인함)", [await bannersOf(A), await resolvedFirst(A)], [[], ["chat-c", "failed", "checked"]]);
await shot("scb-two-home-cleared.png");
await B.ev(`(async () => (await ${SHEETS}).closeMobileOverlay())()`);
await sleep(500);

// 낡은 확인 — 다음 턴이 이미 끝난 창은 앞 턴의 확인을 버린다 · 권한 물음은 확인으로 풀리지 않는다
await feedBoth("chat-a", { t: "turnStarted", turn: "t9" });
await feedBoth("chat-a", { t: "turnEnded", turn: "t9", outcome: "ok", message: null });
const old = JSON.parse(await ev(`(async () => JSON.stringify((await ${LIVE}).sideChatTurnEnd('chat-a')))()`));
await feedBoth("chat-a", { t: "turnStarted", turn: "t10" });
await feedBoth("chat-a", { t: "turnEnded", turn: "t10", outcome: "ok", message: null });
await sleep(400);
check("⑫ (준비) 두 창 모두 chat-a 끝남 배너(둘째 턴)", [await bannersOf(A), await bannersOf(B)], [[["chat-a", "stop"]], [["chat-a", "stop"]]]);
await ev(`window.__emit('side-chat-seen', ${JSON.stringify({ chat: "chat-a", epoch: 1, seq: old?.seq })})`);
await ev(`window.__emit('side-chat-seen', ${JSON.stringify({ chat: "chat-a", epoch: 2, seq: (old?.seq ?? 0) + 2 })})`);
await sleep(300);
check("⑫ 앞 턴 번호 · 다른 세대의 확인 → 집 PC 배너 남음", await bannersOf(A), [["chat-a", "stop"]]);
await feedBoth("chat-b", { t: "turnStarted", turn: "t11" });
await feedBoth("chat-b", { t: "permission", requestId: "r9", kind: "command", title: "Run", detail: "ls", toolName: "Bash" });
await sleep(400);
check("⑫ (준비) 폰에 chat-b 권한 배너", (await bannersOf(B)).filter(([c]) => c === "chat-b"), [["chat-b", "permission"]]);
await B.ev(`window.__emit('side-chat-seen', ${JSON.stringify({ chat: "chat-b", epoch: 1, seq: endB?.seq })})`);
await sleep(300);
check("⑫ 권한 물음은 확인으로 풀리지 않는다", (await bannersOf(B)).filter(([c]) => c === "chat-b"), [["chat-b", "permission"]]);
check("⑫ 확인 op 몸은 id · 세대 · 번호뿐", JSON.parse(await ev(`JSON.stringify([...new Set(window.__calls.filter(([c]) => c === 'side_chat_seen').flatMap(([, a]) => Object.keys(a)))].sort())`)), ["chat", "epoch", "seq"]);
B.close();
await fetch(`http://127.0.0.1:${port}/json/close/${bTarget.id}`).catch(() => {});

// ⑪ 콘솔 오류
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑪ 콘솔 오류 · 예외 0", errors, []);
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
