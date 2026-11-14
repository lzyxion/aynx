// 헤드리스 검증 — **사이드 채팅의 파일 경로 링크** (2026-11-12 — `SideChatFace` 의 `pathLinks` · `app/panes` 의 `openPathFromChat`).
//
// `convo-path-links-harness.mjs` 의 사이드 채팅 판. 스텁은 `remote-chat-dock-harness.mjs` 의 사이드 채팅 명령(채팅 하나 · 통로 ·
// 스냅숏의 `liveTurn` 에 에이전트 말)에 파일 명령(`local_stat` · `local_read_text` · `local_home`)과 가짜 로컬 세션을 더했다.
// 채팅 폴더(`side_chat_dir`)의 답은 하네스가 풀어 줄 때까지 붙잡아 둔다 — 그 전에는 상대 경로가 걸리지 않아야 한다.
//
// 보는 것: ① 걸릴 것 / 안 걸릴 것(`[data-path-link]` · title = 풀린 경로 + `:줄`) ② 채팅 폴더를 알기 전엔 절대 · `~/` 만 → 안 뒤엔 상대도
// ③ 탭이 없을 때 클릭 → 새 탭에 문서 타일 · 줄 강조 ④ 지금 탭의 포커스 타일(셸) 곁에 문서 타일 · 줄 강조 · `~/` 는 홈에 이어 stat
// ⑤ 원격 폰(400x844) — 클릭 → 집 PC 에 요청 · 덮개 닫힘 · 집 PC 가 새 id 로 세운 문서 타일이 그 줄로 ⑥ 콘솔 오류 0(`stub:` 거절 제외)
// ⑦ 원격 데스크톱 — 거울 흉내(`mirror_request` 를 받으면 집 PC 처럼 **새 id** 의 문서 타일을 거울에 더한다)로 옆에 열기 · 미리 보기
// 갈아 끼우기 · 이미 열린 같은 파일(요청 없음 · 실제 id) · 터미널 · AI 타일 대화 면의 길(`openPathFromTerminal` 직접)이 모두 그 줄로 가는지
// (`app/panes` 의 `setLineOnOpened`).
// ⑧ (2026-11-13) 사이드 채팅 알림 줄 → 그 채팅 — 런처 독 알림 칸의 줄이 단추이고 누르면 런처 독이 닫히고 그 채팅(chat-b)이 골라져 채팅 독이
// 열린다 · 지워진 채팅의 줄은 독만 닫힌다 · 폰은 알림 덮개의 같은 줄 → 그 채팅의 폰 덮개. 사이드 채팅 알림은 같은 날부터 배너 저장소에 살아
// (`side-chat-banner-harness`) 지난 알림 줄은 **해결된 배너 기록**이다 — 여기서는 [모두 읽음](`resolveFinishedBanners`)으로 풀어 줄을 세운다.
//
//   node scripts/dev/run-harness.mjs side-chat-path-links-harness.mjs <outdir> --size 1280x860
//     → <outdir>/scpl-before-dir.png · scpl-links.png · scpl-newtab.png · scpl-beside.png · scpl-remote-beside.png · scpl-remote-replace.png ·
//       scpl-remote-term.png · scpl-phone-before.png · scpl-phone-after.png · scpl-notify-row.png · scpl-notify-open.png ·
//       scpl-phone-notify-row.png · scpl-phone-notify-open.png
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
const CHAT = importApp("app/chat-dock.svelte.ts");

// ── 에이전트 말 — 걸릴 것 · 안 걸릴 것 ─────────────────────────────────────────────
const BT = "\u0060";
const c = (s) => BT + s + BT;
const MSG = [
  `Changed ${c("src/lib/foo.ts:12")} and ${c("C:/abs/dir/x.ts:5")} and ${c("~/notes/a.md:3")}.`,
  ``,
  `Bare names stay plain: ${c("foo.ts")} ${c("package.json")} ${c("npm run build")}.`,
  ``,
  `Tails: ${c("src/t2.ts:12-20")} ${c("src/t3.ts#L12")}.`,
  ``,
  `Links: [range](src/a.ts#L12) and [web](https://example.com/docs/a.md).`,
  ``,
  `Prose: see docs/guide.md:30 then C:\\abs\\p.md:4 but not README.md alone.`,
  ``,
  BT.repeat(3) + "ts",
  `const p = "src/in-fence.ts:3";`,
  BT.repeat(3),
  ``,
].join("\n");
const DIR = "C:/Users/me/side-chats/chat-a";
const RD = "C:\\Users\\me\\side-chats\\chat-a";

const stub = (remote) => `
  performance.setResourceTimingBufferSize(10000);
  ${remote ? "window.__AYNX_REMOTE__ = true;" : ""}
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = []; window.__stats = []; window.__requests = [];
  const evts = new Map();
  let nextSession = 100;
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  /** 채팅 폴더의 답 — 하네스가 \`__releaseDir()\` 를 부를 때까지 붙잡는다 */
  let releaseDir; const dirGate = new Promise((r) => (releaseDir = r)); window.__releaseDir = () => releaseDir(${JSON.stringify(DIR)});
  ${remote ? "window.__releaseDir();" : ""}
  const NOW = Date.now();
  const FILE = { v: 2, current: 'chat-a', last: { cli: 'claude', model: '', effort: '' },
    chats: [{ id: 'chat-a', cli: 'claude', model: '', effort: '', title: 'paths', createdAt: NOW - 600000, usedAt: NOW - 60000, used: [], links: {} },
      { id: 'chat-b', cli: 'claude', model: '', effort: '', title: 'other', createdAt: NOW - 900000, usedAt: NOW - 120000, used: [], links: {} }] };
  const snap = (chat = 'chat-a') => ({
    link: null, chat, cli: 'claude', model: '', effort: null, epoch: 1, leaseEpoch: 1, seq: 4, status: 'ready',
    conversationId: null, cwd: null, mcpServers: [],
    liveTurn: [{ t: 'turnStarted', turn: 't1' }, { t: 'userAccepted', clientId: null, text: 'where?' }, { t: 'text', item: 'i1', text: ${JSON.stringify(MSG)} }, { t: 'turnEnded', outcome: 'ok', message: null }],
    pending: [],
  });
  const mdText = Array.from({ length: 60 }, (_, i) => '## Line ' + (i + 1)).join('\\n') + '\\n';
  const codeText = Array.from({ length: 60 }, (_, i) => 'const v' + (i + 1) + ' = ' + (i + 1) + ';').join('\\n') + '\\n';
  const fileEntry = (p) => ({ name: p.split(/[\\\\/]/).pop(), path: p, kind: 'file', size: 100, mtime: 1700000000, mode: null, symlinkTarget: null, linkIsDir: false, hidden: false });
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
    side_chat_list: [{ chat: 'chat-a', cli: 'claude', model: '', effort: null, epoch: 1, status: 'ready', conversationId: null, viewers: 1, detached: false }],
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
  };
  const label = ${remote ? "'remote-h-1'" : "'main'"};
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      // 원격 창의 셸 타일은 집 PC 에 이미 붙은 세션의 시청자다(code-to-term-chat-harness 와 같은 흉내)
      if (cmd === 'attach_session_viewer') {
        const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, stream: args.stream };
        return Promise.resolve({ id, kind: 'local', lease: { stream: args.stream, sessionEpoch: 1, leaseEpoch: 1 }, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh', viewer: true, sizeOwner: true });
      }
      if (cmd === 'probe_session') return Promise.resolve(${remote} ? { state: 'attached', kind: 'local', sessionEpoch: 1, checkpoint: null } : { state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'write_session' || cmd === 'resize_session') return Promise.resolve(null);
      if (cmd === 'claim_session_size') return Promise.resolve(true);
      if (cmd === 'side_chat_dir') return dirGate;
      if (cmd === 'local_stat') { window.__stats.push(args.path); return Promise.resolve(fileEntry(args.path)); }
      if (cmd === 'local_read_text') {
        const text = /\\.md$/i.test(args.path) ? mdText : codeText;
        return Promise.resolve({ text, size: text.length, truncated: false, binary: false, lossy: false, version: 'v1' });
      }
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'side_chats_load') return Promise.resolve({ json: JSON.stringify(FILE), rev: 1 });
      if (cmd === 'side_chats_save') return Promise.resolve({ rev: 2 });
      if (cmd === 'side_chat_subscribe') return Promise.resolve(null);
      if (cmd === 'side_chat_attach') return Promise.resolve(snap(args?.chat));
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
    if ((await ev(`(async () => { try { await ${W}; await ${SESS}; await ${PANES}; return true; } catch { return false; } })()`)) === true) break;
    await sleep(300);
  }
  await sleep(800);
};
const panesNow = async () =>
  evj(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().map((t) => ({ tab: t.id, panes: s.listPanes(t.root).map((p) => ({ id: p.id, kind: p.kind, path: p.path ?? null, sid: ss.sessionOf(p.id) })) }))); })()`);

const BODY = (root) => `document.querySelector('${root}')`;
const linkInfo = async (root) =>
  evj(`(() => { const c = ${BODY(root)}; if (!c) return 'null'; return JSON.stringify([...c.querySelectorAll('[data-path-link]')].map((e) => ({ t: e.textContent, title: e.getAttribute('title'), inCode: !!e.closest('pre') }))); })()`);
const titleOf = (links, text) => links.find((l) => l.t === text)?.title ?? null;
const clickLink = async (root, text) => {
  const find = `[...${BODY(root)}.querySelectorAll('[data-path-link]')].find((x) => x.textContent === ${JSON.stringify(text)})`;
  await ev(`${find}?.scrollIntoView({ block: 'center', behavior: 'instant' })`);
  const at = () => evj(`(() => { const e = ${find}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
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
  return true;
};
/** 그 경로의 문서 타일 안에서만 줄 강조를 찾는다(다른 탭에 남은 앞 문서의 강조를 집지 않게) */
const flashWatch = async (sel, docPath, tries = 20) => {
  for (let i = 0; i < tries; i++) {
    const got = await ev(`(async () => { const w = await ${W}; const s = await ${S}; let id = null;
      for (const t of w.residentWindowTabs()) for (const p of s.listPanes(t.root)) if (p.kind === 'doc' && p.path === ${JSON.stringify(docPath)}) id = p.id;
      const e = id ? document.querySelector('[data-pane="' + id + '"] ' + ${JSON.stringify(sel)}) : null; if (!e) return null; return e.textContent.trim() || e.style.getPropertyValue('--line') || 'band'; })()`);
    if (got) return got;
    await sleep(100);
  }
  return null;
};
const statsSince = async (n) => [...new Set(await evj(`JSON.stringify(window.__stats.slice(${n}))`))];

// ── ⑧ 사이드 채팅 알림 줄 → 그 채팅(2026-11-13 — `DockAlerts` 의 `goToSideChat` · `app/side-chat-open` 의 `openSideChatFromAlert`) ──
const NOTIFY = importApp("app/side-chat-notify.ts");
const BANNERS = importApp("app/agent-banners.svelte.ts");
/** 남은 끝남 · 실패 배너를 [모두 읽음] 으로 풀어 지난 알림 줄로 */
const readAll = () => ev(`(async () => (await ${BANNERS}).resolveFinishedBanners())()`);
const CHATS = importApp("app/side-chats.svelte.ts");
const currentChat = () => ev(`(async () => (await ${CHATS}).currentSideChat()?.id ?? null)()`);
/** 그 요소를 실제 마우스로 누른다(가운데) — 없으면 false */
const clickSel = async (sel) => {
  const r = await evj(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; e.scrollIntoView({ block: 'center', behavior: 'instant' }); const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
  if (!r) return false;
  await mouse("mouseMoved", r.x, r.y, { buttons: 0 });
  await mouse("mousePressed", r.x, r.y);
  await mouse("mouseReleased", r.x, r.y);
  return true;
};

// ════════════════════════════════════════════════════════════════════════════════
// 판 1 — 로컬 창 채팅 독
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;
const DOCK = "[data-chat-dock-body]";
const openDock = async () => {
  if (await ev(`document.querySelector('[data-chat-dock]')?.classList.contains('open') ?? false`)) return true;
  await ev(`(async () => (await ${CHAT}).toggleChatDock())()`);
  return waitFor(`${BODY(DOCK)}?.textContent.includes('Bare names stay plain') ?? false`, 8000);
};
check("0 채팅 독이 열리고 에이전트 말이 선다", await openDock(), true);
await sleep(600);

// ② 채팅 폴더를 알기 전 — 절대 · ~/ 만
const before = await linkInfo(DOCK);
console.log("links before dir:", JSON.stringify(before.map((l) => [l.t, l.title])));
check("② 폴더 전: 절대 · ~/ 경로만 걸림", before.map((l) => l.t).sort(), ["C:/abs/dir/x.ts:5", "C:\\abs\\p.md:4", "~/notes/a.md:3"].sort());
check("② 폴더 전: ~/ title = ~/경로:줄", titleOf(before, "~/notes/a.md:3"), "~/notes/a.md:3");
check("② 폴더 전: 상대 src/lib/foo.ts:12 안 걸림", titleOf(before, "src/lib/foo.ts:12"), null);
await shot("scpl-before-dir.png");

await ev(`window.__releaseDir()`);
check("② 폴더를 알게 되면 상대 경로도 걸림", await waitFor(`!![...${BODY(DOCK)}.querySelectorAll('[data-path-link]')].find((x) => x.textContent === 'src/lib/foo.ts:12')`, 5000), true);
const links = await linkInfo(DOCK);
console.log("links after dir:", JSON.stringify(links.map((l) => [l.t, l.title])));
// ① 걸릴 것
const want = {
  "src/lib/foo.ts:12": `${RD}\\src\\lib\\foo.ts:12`,
  "C:/abs/dir/x.ts:5": "C:/abs/dir/x.ts:5",
  "~/notes/a.md:3": "~/notes/a.md:3",
  "src/t2.ts:12-20": `${RD}\\src\\t2.ts:12`,
  "src/t3.ts#L12": `${RD}\\src\\t3.ts:12`,
  range: `${RD}\\src\\a.ts:12`,
  "docs/guide.md:30": `${RD}\\docs\\guide.md:30`,
  "C:\\abs\\p.md:4": "C:\\abs\\p.md:4",
};
for (const [t, title] of Object.entries(want)) check(`① 걸림 ${t} → title`, titleOf(links, t), title);
for (const t of ["foo.ts", "package.json", "npm run build", "web", "README.md", "src/in-fence.ts:3"])
  check(`① 안 걸림: ${t}`, links.some((l) => l.t === t), false);
check("① 코드 블록 안엔 링크 없음", links.filter((l) => l.inCode).length, 0);
check("① 웹 링크는 웹 링크 그대로", await ev(`(() => { const e = [...${BODY(DOCK)}.querySelectorAll('[data-href]')].find((x) => x.getAttribute('data-href') === 'https://example.com/docs/a.md'); return e ? !e.hasAttribute('data-path-link') : null; })()`), true);
check("① 링크 수", links.length, Object.keys(want).length);
await shot("scpl-links.png");

// ③ 탭이 없을 때 → 새 탭에 문서 타일
for (const t of await panesNow()) await ev(`(async () => (await ${W}).closeTab(${JSON.stringify(t.tab)}))()`);
await sleep(500);
check("③ (준비) 탭 없음", (await panesNow()).length, 0);
await openDock();
let s0 = await ev(`window.__stats.length`);
check("③ 클릭 docs/guide.md:30", await clickLink(DOCK, "docs/guide.md:30"), true);
const mdFlash = await flashWatch(".line-flash", `${RD}\\docs\\guide.md`);
let tabs = await panesNow();
check("③ stat 경로 = 채팅 폴더 기준", await statsSince(s0), [`${RD}\\docs\\guide.md`]);
check("③ 새 탭 하나 · 문서 타일 하나", tabs.map((t) => t.panes.map((p) => [p.kind, p.path])), [[["doc", `${RD}\\docs\\guide.md`]]]);
check("③ 30줄 강조", mdFlash, "Line 30");
await shot("scpl-newtab.png");

// ④ 지금 탭의 포커스 타일(셸) 곁 — 새 탭에 셸 하나를 열고 그 셸에 포커스
await ev(`(async () => (await ${PANES}).openShellInNewTab())()`);
let shell = null;
for (let i = 0; i < 40; i++) {
  await sleep(250);
  shell = (await panesNow()).flatMap((t) => t.panes.map((p) => ({ ...p, tab: t.tab }))).find((p) => p.kind === "local" && p.sid != null) ?? null;
  if (shell) break;
}
check("④ (준비) 셸 탭", !!shell, true);
await ev(`(async () => { const w = await ${W}; w.focusTile(${JSON.stringify(shell.tab)}, ${JSON.stringify(shell.id)}); })()`);
await sleep(400);
await openDock();
s0 = await ev(`window.__stats.length`);
check("④ 클릭 src/lib/foo.ts:12", await clickLink(DOCK, "src/lib/foo.ts:12"), true);
const tsFlash = await flashWatch("[data-line-flash]", `${RD}\\src\\lib\\foo.ts`);
tabs = await panesNow();
const shellTab = tabs.find((t) => t.tab === shell.tab);
check("④ stat 경로", await statsSince(s0), [`${RD}\\src\\lib\\foo.ts`]);
check("④ 문서 타일 = 셸 곁(같은 탭 · 셸 + 문서)", shellTab?.panes.map((p) => [p.kind, p.path]), [["local", null], ["doc", `${RD}\\src\\lib\\foo.ts`]]);
check("④ 탭 수 그대로(새 탭 아님)", tabs.length, 2);
check("④ 12줄 강조(CodeView 띠 --line = 11)", tsFlash, "11");
await shot("scpl-beside.png");
await openDock();
s0 = await ev(`window.__stats.length`);
await clickLink(DOCK, "~/notes/a.md:3");
const homeFlash = await flashWatch(".line-flash", "C:\\Users\\h\\notes\\a.md");
check("④ ~/ 경로 → 홈에 이어 stat · 3줄", [await statsSince(s0), homeFlash], [["C:\\Users\\h\\notes\\a.md"], "Line 3"]);
await openDock();
s0 = await ev(`window.__stats.length`);
await clickLink(DOCK, "range");
const rangeFlash = await flashWatch("[data-line-flash]", `${RD}\\src\\a.ts`);
check("④ [range](src/a.ts#L12) → stat · 12줄", [await statsSince(s0), rangeFlash], [[`${RD}\\src\\a.ts`], "11"]);

// ⑧ 런처 독 알림 칸의 사이드 채팅 줄 — 누르면 런처 독이 닫히고 그 채팅이 골라져 채팅 독(채팅 갈래)이 열린다
const LAUNCH = importApp("app/dock.svelte.ts");
await ev(`(async () => (await ${CHAT}).closeChatDock(false))()`);
await sleep(300);
check("⑧ (준비) 지금 채팅 = chat-a · 채팅 독 닫힘", [await currentChat(), await ev(`(async () => (await ${CHAT}).chatDockOpen())()`)], ["chat-a", false]);
await ev(`(async () => (await ${NOTIFY}).notifySideChat('chat-b', 'finished', false))()`);
await readAll();
await ev(`(async () => (await ${LAUNCH}).openDock('alerts'))()`);
const ROW_B = '.dock [data-dock-alerts] [data-notify-side-chat="chat-b"]';
check("⑧ 알림 줄 = 누르는 단추(static 아님)", await waitFor(`document.querySelector('${ROW_B}')?.tagName === 'BUTTON'`, 4000), true);
await sleep(400);
await shot("scpl-notify-row.png");
check("⑧ 줄 클릭", await clickSel(ROW_B), true);
check("⑧ 채팅 독이 열림", await waitFor(`(async () => (await ${CHAT}).chatDockOpen())()`, 4000), true);
check("⑧ 런처 독 닫힘 · 지금 채팅 = chat-b · 갈래 = 채팅", [
  await ev(`(async () => (await ${LAUNCH}).dockKind())()`),
  await currentChat(),
  await ev(`(async () => (await ${CHAT}).chatDockSection())()`),
], [null, "chat-b", "chat"]);
await sleep(500);
await shot("scpl-notify-open.png");
// ⑧ 지워진 채팅의 줄 — 눌러도 런처 독만 닫히고 아무 일도 없다(지금 채팅 그대로 · 채팅 독 열지 않음)
await ev(`(async () => (await ${CHAT}).closeChatDock(false))()`);
// 목록에 없는 채팅의 배너 — 배너가 곧바로 저절로 해결로 접어(지워진 채팅) 지난 알림 줄이 된다
await ev(`(async () => (await ${BANNERS}).pushAgentBanner({ sideChatId: 'chat-gone', kind: 'stop', agent: 'Claude Code', logo: 'claude', label: 'gone', text: 'gone chat' }))()`);
await ev(`(async () => (await ${LAUNCH}).openDock('alerts'))()`);
const ROW_GONE = '.dock [data-dock-alerts] [data-notify-side-chat="chat-gone"]';
check("⑧ 지워진 채팅 줄도 단추", await waitFor(`!!document.querySelector('${ROW_GONE}')`, 4000), true);
await sleep(300);
await clickSel(ROW_GONE);
await sleep(600);
check("⑧ 지워진 채팅 → 런처 독 닫힘 · 채팅 그대로 · 채팅 독 닫힌 채", [
  await ev(`(async () => (await ${LAUNCH}).dockKind())()`),
  await currentChat(),
  await ev(`(async () => (await ${CHAT}).chatDockOpen())()`),
], [null, "chat-b", false]);

// ════════════════════════════════════════════════════════════════════════════════
// 거울 흉내 — 집 PC 의 탭들을 이 페이지에 두고 민다. 문서 요청(옆에 열기 · 갈아 끼우기 · 새 탭)을 받으면 **집 PC 처럼 새 id**
// (`home-d<n>`)로 문서 타일을 세워 다시 민다(`app/mirror-requests` 의 `fresh` — 원격이 보낸 명세의 id 는 버려진다).
// ════════════════════════════════════════════════════════════════════════════════
const installMirror = async (homePane) =>
  ev(`(async () => {
    const s = await ${importApp("mirror/snapshot")};
    let k = 0;
    window.__home = { tabs: [{ id: 'home-tab', title: 'h', tabKey: 'tk', workspaceId: 'w1', root: { type: 'leaf', pane: ${JSON.stringify(homePane)} } }], active: 'home-tab', focus: { 'home-tab': ${JSON.stringify(homePane.id)} } };
    window.__push = () => window.__emit('mirror-layout', s.buildSnapshot({ source: 'home', workspace: { id: 'w1', name: 'W' },
      tabs: window.__home.tabs, activeTabId: window.__home.active, focusOf: (t) => window.__home.focus[t.id] ?? null }));
    const leaves = (n) => n.type === 'leaf' ? [n.pane] : [...leaves(n.a), ...leaves(n.b)];
    const map = (n, f) => n.type === 'leaf' ? f(n) : { ...n, a: map(n.a, f), b: map(n.b, f) };
    window.__onMirror = (req) => {
      if (!req.pane || req.pane.kind !== 'doc') return;
      k += 1;
      const pane = { id: 'home-d' + k, kind: 'doc', path: req.pane.path, tileKey: 'dk' + k, ...(req.pane.docPreview ? { docPreview: true } : {}) };
      // 대상 열쇠는 \`k:<tileKey>\`(\`mirror/request\` 의 \`toWire\`)
      const key = typeof req.tile === 'string' ? req.tile.replace(/^k:/, '') : null;
      const hit = window.__home.tabs.find((t) => leaves(t.root).some((p) => p.tileKey === key));
      if (req.op === 'openBeside' && hit) hit.root = map(hit.root, (n) => n.pane.tileKey === key ? { type: 'split', dir: 'row', ratio: 0.5, a: n, b: { type: 'leaf', pane } } : n);
      else if (req.op === 'replaceTile' && hit) hit.root = map(hit.root, (n) => n.pane.tileKey === key ? { type: 'leaf', pane } : n);
      else if (req.op === 'newTab') { const t = { id: 'home-tab-' + k, title: 'd', tabKey: 'tkd' + k, workspaceId: 'w1', root: { type: 'leaf', pane } }; window.__home.tabs.push(t); window.__home.active = t.id; }
      else return;
      const tab = hit ?? window.__home.tabs.at(-1);
      window.__home.focus[tab.id] = pane.id;
      window.__home.active = tab.id;
      setTimeout(window.__push, 400);
    };
    window.__push();
    return 'ok';
  })()`);
const reqsSince = async (n) => evj(`JSON.stringify(window.__requests.slice(${n}).map((r) => [r.op, r.pane?.kind ?? null, r.pane?.path ?? null]))`);
const hideToasts = () => ev(`(() => { const s = document.createElement('style'); s.textContent = '.toast { display: none !important; }'; document.head.append(s); })()`);
/** 지금 거울의 그 경로 문서 타일 id 들(원격 창 id) */
const docIdsOf = async (docPath) =>
  (await panesNow()).flatMap((t) => t.panes).filter((p) => p.kind === "doc" && p.path === docPath).map((p) => p.id);

// ════════════════════════════════════════════════════════════════════════════════
// 판 2 — 원격 데스크톱: 클릭 → 거울 요청 → 집 PC 가 새 id 로 세운 문서 타일이 그 줄로
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 1280, height: 860 });
check("⑦ (준비) 거울 설치", await installMirror({ id: "home-p1", kind: "local", shell: "pwsh", tileKey: "fk1", historyStreamId: "hs-1" }), "ok");
await hideToasts();
check("⑦ (준비) 거울의 셸 타일 하나", await waitFor(`(async () => { const w = await ${W}; const s = await ${S}; return w.residentWindowTabs().some((t) => s.listPanes(t.root).some((p) => p.kind === 'local')); })()`, 8000), true);
await sleep(600);
check("⑦ 원격 채팅 독이 열림", await openDock(), true);
await sleep(400);
// ⑦a 옆에 열기(openBeside) — 원격이 단 명세 id 는 거울에 서지 않는다
let q0 = await ev(`window.__requests.length`);
check("⑦a 클릭 docs/guide.md:30", await clickLink(DOCK, "docs/guide.md:30"), true);
const guide = `${RD}\\docs\\guide.md`;
const remoteMd = await flashWatch(".line-flash", guide, 60);
check("⑦a 요청 = openBeside 문서 하나", await reqsSince(q0), [["openBeside", "doc", guide]]);
check("⑦a 집 PC 가 새 id 로 세운 문서 타일 하나", (await docIdsOf(guide)).length, 1);
check("⑦a 그 타일이 30줄로(강조)", remoteMd, "Line 30");
await shot("scpl-remote-beside.png");
// ⑦b 미리 보기 갈아 끼우기(replaceTile) — 이것도 새 id
await openDock();
q0 = await ev(`window.__requests.length`);
const foo = `${RD}\\src\\lib\\foo.ts`;
check("⑦b 클릭 src/lib/foo.ts:12", await clickLink(DOCK, "src/lib/foo.ts:12"), true);
const remoteTs = await flashWatch("[data-line-flash]", foo, 60);
check("⑦b 요청 = replaceTile 문서 하나", await reqsSince(q0), [["replaceTile", "doc", foo]]);
check("⑦b 갈아 끼운 문서 타일 = 그 파일 · 앞 파일은 없음", [(await docIdsOf(foo)).length, (await docIdsOf(guide)).length], [1, 0]);
check("⑦b 그 타일이 12줄로(CodeView 띠 --line = 11)", remoteTs, "11");
await shot("scpl-remote-replace.png");
// ⑦c 이미 열린 같은 파일 — 요청 없이 포커스만 · 돌려받은 id(거울의 실제 id)에 바로 건다
const fooId = (await docIdsOf(foo))[0];
check("⑦c (준비) 앞 강조가 걷힘", await waitFor(`!document.querySelector('[data-pane="${fooId}"] [data-line-flash]')`, 5000), true);
await openDock();
q0 = await ev(`window.__requests.length`);
check("⑦c 같은 파일 다시 클릭", await clickLink(DOCK, "src/lib/foo.ts:12"), true);
const againTs = await flashWatch("[data-line-flash]", foo, 40);
check("⑦c 요청 없음 · 같은 타일", [await reqsSince(q0), await docIdsOf(foo)], [[], [fooId]]);
check("⑦c 다시 12줄로", againTs, "11");
// ⑦d 터미널 · AI 타일 대화 면의 길(`openPathFromTerminal` — 대화 면의 경로 클릭이 부르는 함수를 직접) — 미리 보기 갈아 끼우기
const shellTile = (await panesNow()).flatMap((t) => t.panes.map((p) => ({ ...p, tab: t.tab }))).find((p) => p.kind === "local") ?? null;
q0 = await ev(`window.__requests.length`);
await ev(`(async () => (await ${PANES}).openPathFromTerminal(${JSON.stringify(shellTile?.tab ?? "")}, ${JSON.stringify(shellTile?.id ?? "")}, { path: 'C:/abs/dir/x.ts' }, 5))()`);
const termTs = await flashWatch("[data-line-flash]", "C:/abs/dir/x.ts", 60);
check("⑦d 터미널 길 → replaceTile 문서 요청", await reqsSince(q0), [["replaceTile", "doc", "C:/abs/dir/x.ts"]]);
check("⑦d 그 타일이 5줄로(--line = 4)", termTs, "4");
await shot("scpl-remote-term.png");

// ════════════════════════════════════════════════════════════════════════════════
// 판 3 — 원격 폰: 클릭 → 집 PC 에 문서 요청 · 덮개 닫힘 · 새 id 의 문서 타일이 그 줄로
// ════════════════════════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 400, height: 844, mobile: true });
// 집 PC 의 탭 하나(파일 타일 — 세션 없음)를 거울로 세운다 — 문서는 그 탭의 포커스 타일 곁에 열리고, 그 일은 집 PC 에 요청이다
await installMirror({ id: "home-1", kind: "localfs", tileKey: "fk", path: "C:\\h" });
await sleep(600);
check("⑤ (준비) 거울의 탭 하나", (await panesNow()).map((t) => t.panes.map((p) => p.kind)), [["localfs"]]);
// 원격 창의 안내 토스트가 덮개 위를 덮는다 — remote-chat-dock-harness 와 같이 숨긴다
await ev(`(() => { const s = document.createElement('style'); s.textContent = '.toast { display: none !important; }'; document.head.append(s); })()`);
await ev(`document.querySelector('[data-signal="side-chat"]')?.click()`);
const PH = "[data-mobile-chat]";
check("⑤ 폰 덮개 · 에이전트 말", await waitFor(`${BODY(PH)}?.textContent.includes('Bare names stay plain') ?? false`, 8000), true);
check("⑤ 폰도 상대 경로 링크(채팅 폴더 기준)", await waitFor(`!![...${BODY(PH)}.querySelectorAll('[data-path-link]')].find((x) => x.textContent === 'src/lib/foo.ts:12')`, 5000), true);
await sleep(500);
await shot("scpl-phone-before.png");
s0 = await ev(`window.__stats.length`);
const r0 = await ev(`window.__requests.length`);
await clickLink(PH, "docs/guide.md:30");
await waitFor(`!document.querySelector('[data-mobile-chat]')`, 4000);
const phoneMd = await flashWatch(".line-flash", `${RD}\\docs\\guide.md`, 60);
const reqs = await evj(`JSON.stringify(window.__requests.slice(${r0}).map((r) => [r.op, r.pane?.kind ?? null, r.pane?.path ?? null]))`);
console.log("phone requests:", JSON.stringify(reqs), JSON.stringify(await evj(`JSON.stringify([...document.querySelectorAll('.toast')].map((e) => e.textContent.trim()))`)));
check("⑤ 폰 클릭 → stat(집 PC 경로)", await statsSince(s0), [`${RD}\\docs\\guide.md`]);
check("⑤ 폰 클릭 → 문서 타일 요청 하나(집 PC)", reqs.filter((r) => r[1] === "doc").map((r) => r[2]), [`${RD}\\docs\\guide.md`]);
check("⑤ 폰 클릭 → 덮개 닫힘", await ev(`!!document.querySelector('[data-mobile-chat]')`), false);
check("⑤ 폰 — 집 PC 가 새 id 로 세운 문서 타일이 30줄로(강조)", phoneMd, "Line 30");
await shot("scpl-phone-after.png");

// ⑧ 폰 — 알림 덮개(`MobileAlerts` = 같은 `DockAlerts`)의 사이드 채팅 줄 → 알림 덮개가 닫히고 그 채팅의 폰 덮개가 선다
const MSHEETS = importApp("app/mobile-sheets.svelte.ts");
check("⑧ 폰 (준비) 지금 채팅 = chat-a", await currentChat(), "chat-a");
await ev(`(async () => (await ${NOTIFY}).notifySideChat('chat-b', 'failed', false))()`);
await readAll();
await ev(`(async () => (await ${MSHEETS}).openMobileAlerts())()`);
const PROW = '[data-mobile-alerts] [data-notify-side-chat="chat-b"]';
check("⑧ 폰 알림 줄 = 단추", await waitFor(`document.querySelector('${PROW}')?.tagName === 'BUTTON'`, 4000), true);
await sleep(500);
await shot("scpl-phone-notify-row.png");
await clickSel(PROW);
check("⑧ 폰 클릭 → 사이드 채팅 덮개", await waitFor(`!!document.querySelector('[data-mobile-chat]')`, 4000), true);
check("⑧ 폰 — 알림 덮개 닫힘 · 지금 채팅 = chat-b", [
  await ev(`(async () => (await ${MSHEETS}).mobileOverlay())()`),
  await currentChat(),
], ["chat", "chat-b"]);
await sleep(600);
await shot("scpl-phone-notify-open.png");

// ⑥ 콘솔 오류
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑥ 콘솔 오류 · 예외 0", errors, []);
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
