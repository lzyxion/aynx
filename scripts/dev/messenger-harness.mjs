// 헤드리스 검증 — **메신저(Discord) 에이전트 알림의 몸통** (docs/log/2026-09-27-discord-notify.md "둘째 줄").
//
// `agent-banner-harness.mjs` 의 스텁 사본. `messenger_send` 를 스텁으로 받아 **프런트가 넘기는 것**을 본다 —
// 진짜 전송(Discord)과 대화 파일 읽기(Rust)는 여기 없다(그쪽은 `cargo test` 의 `messenger::tests`).
// AI 타일 하나를 등록 프로젝트의 워크트리 폴더에 두고 `agent-signal` 을 흉내 낸다:
// ① start · tool-done ×3 · stop → `message` = 평문 구조 `{app, label:"Aynx · feat-message",
//   event:"Claude Code 작업이 끝났습니다", second:"<시간> · 도구 3회 · 파일 2개 변경"}`(마크다운 없음 — 서식은 Rust,
//   docs/log/2026-09-28-messenger-channels.md) · `channels:["discord","slack"]`(stub 의 [messenger] 에 slack 칸이 없어 기본 켬 — 5a09c08) · 대화 가리킴 `{agent, id, event:"stop"}` ·
//   도장은 시작·끝 두 번 · 대화 제목·발췌는 **없다**(그것은 Rust 가 붙인다) ·
// ② 권한 물음 → 둘째 줄에 도구 수 · 가리킴 event "permission" · 도장은 찍지 않는다 ·
// ③ 대화 싣기 끔 → 가리킴 `null` · ④ 메신저 끔 → 보내지 않고 턴 시작 도장도 없다 ·
// ⑤ start 를 못 본 stop → 도구·파일 없음 · ⑥ 프로젝트 밖 폴더 → 탭 이름으로 떨어진다 · 마지막에 콘솔 예외 0.
//
// usage:
//   npx vite --port 1557 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9367 --user-data-dir=%TEMP%/edge-aynx-messenger \
//     --window-size=1200,800 http://localhost:1557/
//   PAGE_PORT=1557 node scripts/dev/messenger-harness.mjs 9367
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
const [port = process.env.CDP_PORT ?? "9367"] = process.argv.slice(2);
const pagePort = process.env.PAGE_PORT ?? "1557";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target0 = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target0.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
let collecting = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (!collecting) return;
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description ?? "exception");
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error")
    errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
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
let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

const REPO = "C:\\w\\aynx";
const WT = "C:\\w\\aynx-wt\\feat-message";
const CONVO = "11111111-2222-4333-8444-5555555555aa";

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  window.__focus = true; document.hasFocus = () => window.__focus;
  window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, opts) { window.__calls.push(['Notification', { title, body: opts?.body ?? null }]); } };
  window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, id: h, payload }));
  window.__ops = { pending: [], recent: [] };
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false }, ai: { notify_turn_end: true },
    messenger: { when: 'always', include_conversation: true } };
  // 변경 도장 — 부를 때마다 다음 것을 준다(시작 → 끝). 끝 도장은 a.ts 를 다시 고치고 b.ts 를 새로 더럽혔다.
  window.__snaps = [[' M\\t1\\ta.ts'], [' M\\t2\\ta.ts', ' M\\t3\\tb.ts']];
  let snapN = 0;
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {},  load_snippets: null, 
     save_snippets: null,  save_settings: null,
    host_history_list: {},
    projects_list: [{ id: 'p1', name: 'Aynx', host: null, path: ${JSON.stringify(REPO)}, shell: null, command: '', tmux: false, worktree_dir: null }],
    git_worktree_list: [
      { path: 'C:/w/aynx', branch: 'main', head: 'a', bare: false, detached: false, created_by_app: false },
      { path: 'C:/w/aynx-wt/feat-message', branch: 'feat-message', head: 'b', bare: false, detached: false, created_by_app: true },
    ],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null, close_session: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    list_ai_clis: [], operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    audit_status: { state: 'off', written: 0, failed: 0 }, mcp_activity: null, list_forwards: [],
    messenger_send: null, messenger_status: { configured: true },
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
      if (cmd === 'load_settings') return Promise.resolve(window.__settings);
      if (cmd === 'git_change_snapshot') return Promise.resolve(window.__snaps[snapN++ % 2]);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
collecting = true;
await send("Page.reload", { ignoreCache: true });
await sleep(4000);

const tabsMod = importApp("app/tabs.svelte.ts");
const panesMod = importApp("app/panes.svelte.ts");
const cwdMod = importApp("app/pane-cwd.svelte.ts");
const setMod = importApp("lib/settings.svelte.ts");

// ── 준비: AI 타일 하나 · 워크트리 목록을 읽어 둔다 · 셸이 워크트리 폴더를 알려 왔다 ─────────────
await ev(`(async () => { const p = await ${panesMod}; await p.openAiPaneHere({ command: 'claude', id: 'claude' }); })()`);
await sleep(900);
const tile = JSON.parse(
  await ev(`(async () => { const w = await ${tabsMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); for (const tab of w.residentWindowTabs()) for (const p of walk(tab.root, [])) if (p.autorun === 'claude') return JSON.stringify({ pane: p.id, stream: p.historyStreamId ?? null }); return 'null'; })()`),
);
check(!!tile?.stream, "AI 타일 · 스트림 id 있음");
const wtLoaded = await ev(
  `(async () => { const l = await ${importApp("app/project-list.svelte.ts")}; await l.refreshProjects(); const w = await ${importApp("app/worktrees.svelte.ts")}; const p = l.projects()[0]; if (!p) return 'no project'; await w.loadWorktrees(p); return w.worktreesOf(p.id)?.state; })()`,
);
check(wtLoaded === "ok", `워크트리 목록 읽음 (${wtLoaded})`);
await ev(`(async () => { const c = await ${cwdMod}; c.noteReportedCwd('${tile.pane}', ${JSON.stringify(WT + "\\src")}); })()`);

const calls = async (cmd) => JSON.parse(await ev(`JSON.stringify(window.__calls.filter(c => c[0] === '${cmd}').map(c => c[1]))`));
const resetCalls = () => ev(`window.__calls.length = 0`);
/** 보냄이 설 때까지 본다(상한 3초) — 보내기 앞의 비동기 일(이름표 · 도장)이 느린 판에 고정 대기가 모자랐다 */
const waitSent = async (n = 1) => { for (let i = 0; i < 30; i++) { if ((await calls("messenger_send")).length >= n) break; await sleep(100); } await sleep(150); };
const emit = async (event, extra = {}) => {
  await ev(fakeAgentSignal({ stream: tile.stream, ...extra, event }));
  await sleep(120);
};

// ── ① 턴 하나 ────────────────────────────────────────────────────────────────
await resetCalls();
await emit("start", { session: CONVO });
check((await calls("git_change_snapshot")).length === 1, "턴 시작 → 도장 한 번");
for (let i = 0; i < 3; i++) await emit("tool-done");
await sleep(1100); // 둘째 줄의 시간이 1초를 넘게
await emit("stop", { session: CONVO });
await waitSent();
{
  const sent = await calls("messenger_send");
  const snaps = await calls("git_change_snapshot");
  check(sent.length === 1, `턴 끝 → 한 번 보냄 (${sent.length})`);
  const m = sent[0]?.message ?? {};
  console.log("message:", JSON.stringify(m), "channels:", JSON.stringify(sent[0]?.channels));
  check(/^Aynx/.test(m.app ?? "") && m.label === "Aynx · feat-message", `이름표 = 프로젝트 · 워크트리 (${m.app} / ${m.label})`);
  check(m.event === "Claude Code 작업이 끝났습니다", `사건 = 평문 (${m.event})`);
  check(/^\d+\.\d초 · 도구 3회 · 파일 2개 변경$/.test(m.second ?? ""), `둘째 줄 = 시간 · 도구 3회 · 파일 2개 변경 (${m.second})`);
  check(!/\*\*/.test(JSON.stringify(m)), "서식 없음 — 마크다운은 Rust 가 입힌다");
  check(JSON.stringify(sent[0]?.channels) === JSON.stringify(["discord", "slack"]), `켜진 채널 (${JSON.stringify(sent[0]?.channels)})`);
  check(
    JSON.stringify(sent[0]?.conversation) === JSON.stringify({ agent: "claude", id: CONVO, event: "stop" }),
    `대화 가리킴 (${JSON.stringify(sent[0]?.conversation)})`,
  );
  check(snaps.length === 2 && snaps.every((s) => s.dir === WT + "\\src"), `도장은 시작·끝 두 번, 그 타일의 폴더 (${JSON.stringify(snaps)})`);
}

// ── ② 권한 물음 ─────────────────────────────────────────────────────────────
await resetCalls();
await emit("start", { session: CONVO });
await emit("tool-done");
await emit("waiting", { detail: "permission" });
await waitSent();
{
  const sent = await calls("messenger_send");
  const line1 = sent[0]?.message?.event;
  const line2 = sent[0]?.message?.second;
  check(sent.length === 1 && /권한/.test(line1 ?? ""), `권한 물음 → 보냄 (${line1})`);
  check(/도구 1회$/.test(line2 ?? "") && !/파일/.test(line2 ?? ""), `둘째 줄 = 도구 수만, 파일은 세지 않는다 (${line2})`);
  check(sent[0]?.conversation?.event === "permission", "가리킴 event = permission");
  check((await calls("git_change_snapshot")).length === 1, "권한 물음은 도장을 찍지 않는다(시작 도장 하나뿐)");
}
await emit("stop", { session: CONVO });
await sleep(300);

// ── ③ 대화 싣기 끔 → 가리킴 없음 ────────────────────────────────────────────
await ev(`(async () => { const s = await ${setMod}; s.setMessengerIncludeConversation(false); })()`);
await resetCalls();
await emit("start", { session: CONVO });
await emit("stop", { session: CONVO });
await waitSent();
{
  const sent = await calls("messenger_send");
  check(sent.length === 1 && sent[0].conversation === null, `대화 싣기 끔 → conversation null (${JSON.stringify(sent[0]?.conversation)})`);
}

// ── ④ 메신저 끔 → 보내지 않고 도장도 없다 ───────────────────────────────────
await ev(`(async () => { const s = await ${setMod}; s.setMessengerChannel('discord', false); s.setMessengerChannel('slack', false); })()`);
await resetCalls();
await emit("start", { session: CONVO });
await emit("stop", { session: CONVO });
await sleep(400);
check((await calls("messenger_send")).length === 0, "메신저 끔 → 보내지 않는다");
check((await calls("git_change_snapshot")).length === 0, "메신저 끔 → 턴마다 git 을 돌리지 않는다");
await ev(`(async () => { const s = await ${setMod}; s.setMessengerChannel('discord', true); s.setMessengerChannel('slack', true); })()`);

// ── ⑤ start 를 못 본 stop → 도구·파일 없음 ──────────────────────────────────
await resetCalls();
await emit("stop", { session: CONVO });
await waitSent();
{
  const sent = await calls("messenger_send");
  // 시간은 지난 `start` 에서 잰다(배너와 같은 `turnStarted`) — 도구·파일은 그 턴의 셈이 없어 뺀다
  check(sent.length === 1 && !/도구|파일/.test(sent[0].message?.second ?? ""), `시작을 못 본 턴 → 도구·파일 없음 (${JSON.stringify(sent[0]?.message)})`);
}

// ── ⑥ 프로젝트 밖 폴더 → 탭·타일 이름 ────────────────────────────────────────
await ev(`(async () => { const c = await ${cwdMod}; c.noteReportedCwd('${tile.pane}', 'D:\\\\elsewhere'); })()`);
await resetCalls();
await emit("stop", { session: CONVO });
await waitSent();
{
  const sent = await calls("messenger_send");
  const label = sent[0]?.message?.label ?? "";
  check(sent.length === 1 && !label.includes("Aynx"), `프로젝트 밖 → 탭 이름으로 (${label})`);
}

check(errors.length === 0, `콘솔 예외 0 (${errors.length}) ${errors.slice(0, 3).join(" | ")}`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAIL`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
