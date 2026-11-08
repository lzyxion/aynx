// 헤드리스 검증 — **완료 확인 공유**(2026-11-04 · `app/agent-seen.svelte.ts` · 판정 `$lib/agent-seen` · 서버 op `agent_state_seen` · 방송 `agent-seen`).
//
// 원격 창 흉내(`window.__AYNX_REMOTE__`)로 뜨고 탭은 `applyMirrorTabs` 로 세운다. 다른 창의 몫은 이벤트 주입(`window.__emit('agent-seen', …)`)으로 흉내 낸다 —
// 서버 왕복 자체는 Rust 시험(`server::tests` · `agent_state`)이 본다.
// 보는 것: ⓪ 폰 자체 — 다른 탭 완료 표시가 그 타일을 고르면 지워진다(`REPRO=1` 이면 여기까지만 — 고치기 전 코드로 재현할 때)
// ① 다른 탭 stop → 표식 ② 보기 → 맞는 seq 로 op 한 번(중복 없음) ③ `agent-seen` 수신 → 표식 · 완료 배너 사라짐 · 권한 배너 유지 ④ 옛 seq 수신 → 새 표식 유지
// ⑤ 페이지 숨김 · 가림막 · 창 비포커스 · 사람 입력 없음이면 안 보냄, 돌아오면 보냄 ⑥ 폰 solo: 같은 탭의 안 보이는 타일은 안 보냄 ⑦ 표식 없이(스냅숏으로) 깨어나 보는 경우도 보냄 ⑧ 예외 0
//
//   node scripts/dev/run-harness.mjs agent-seen-harness.mjs <outdir> --size 400x844
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { FAKE_AGENT_SIGNAL_FN, fakeAgentSignal } from "./agent-signal-fake.mjs";
import fs from "node:fs";
import path from "node:path";

const [outdir = "out", port = process.env.CDP_PORT ?? "9277"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1444";
const REPRO = process.env.REPRO === "1";
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
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
let bad = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  window.__AYNX_REMOTE__ = true;
  const cbs = new Map(); let n = 0; window.__calls = [];
  const evts = new Map();
  window.__snapshot = [];
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }],
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [],
    tile_permission_face: null, tile_permission_subscribe: null,
    tile_permission_snapshot: { cards: [] },
    probe_session: { state: 'attached', kind: 'local', sessionEpoch: 1, checkpoint: null },
    attach_session_viewer: { id: 7, kind: 'local', viewer: true, lease: { stream: 's', sessionEpoch: 1, leaseEpoch: 1 }, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh', sizeOwner: false },
    resize_session: null, claim_session_size: true, ack_session: null, write_session: null, detach_session_viewer: null,
    agent_state_seen: null,
  };
  window.__emit = (name, payload) => { for (const h of evts.get(name) ?? []) cbs.get(h)?.({ event: name, id: 0, payload }); };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'remote-h-1' }, currentWebview: { label: 'remote-h-1', windowLabel: 'remote-h-1' }, windows: [{ label: 'remote-h-1' }], webviews: [{ label: 'remote-h-1', windowLabel: 'remote-h-1' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'agent_states_snapshot') return Promise.resolve(window.__snapshot);
      if (cmd === 'load_settings') return Promise.resolve({ app: { status_bar: 'bottom' }, automation: { auto_approve: false } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') { evts.set(args.event, (evts.get(args.event) ?? []).filter((x) => x !== args.eventId)); return Promise.resolve(); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  // 창 포커스 · 페이지 보임은 헤드리스가 정하지 못한다 — 하네스가 쥔다
  window.__focused = true;
  document.hasFocus = () => window.__focused;
  window.__hidden = false;
  Object.defineProperty(document, 'visibilityState', { get: () => (window.__hidden ? 'hidden' : 'visible') });
`,
});

const T = importApp("app/tabs.svelte.ts");
const WSM = importApp("app/workspaces.svelte.ts");
const S = importApp("app/agent-status.svelte.ts");
const B = importApp("app/agent-banners.svelte.ts");
const V = importApp("app/veil.svelte.ts");

/** 탭 둘 + 고른 탭 — tab-a(ai-a) · tab-b(ai-b · ai-c 두 칸) */
const seedTabs = (active = "tab-a") => `(async () => {
  const [t, w] = await Promise.all([${T}, ${WSM}]);
  const wsId = w.currentWorkspaceId();
  const leaf = (pane) => ({ type: 'leaf', pane: { tileKey: 'tk-' + pane.id, kind: 'local', autorun: 'claude', ...pane } });
  t.applyMirrorTabs([
    { id: 'tab-a', title: 'a', tabKey: 'k-a', workspaceId: wsId, root: leaf({ id: 'ai-a', historyStreamId: 's-a' }) },
    { id: 'tab-b', title: 'b', tabKey: 'k-b', workspaceId: wsId, root: { type: 'split', dir: 'row', ratio: 0.5, a: leaf({ id: 'ai-b', historyStreamId: 's-b' }), b: leaf({ id: 'ai-c', historyStreamId: 's-c' }) } },
  ], ${JSON.stringify(active)}, {});
})()`;
const boot = async (width, mobile) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 1, mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mobile });
  await send("Page.reload", { ignoreCache: true });
  await sleep(1000); // 옛 페이지에 묻지 않게
  await waitFor(`performance.getEntriesByType('resource').some(r => r.name.includes('app/agent-status.svelte.ts')) && !!document.querySelector('.app')`, 20000);
  await sleep(1200);
  await ev(FAKE_AGENT_SIGNAL_FN);
  await ev(seedTabs("tab-a"));
  await waitFor(`!!document.querySelector('[data-pane="ai-a"]')`);
  await sleep(400);
};
const signal = async (stream, event, extra = {}) => {
  await ev(fakeAgentSignal({ stream, event, cli: "claude", ...extra }));
  await sleep(250);
};
/** 그 타일의 지금 점 */
const status = (paneId) => ev(`(async () => {
  const [t, s] = await Promise.all([${T}, ${S}]);
  const tab = t.tabOfPane(${JSON.stringify(paneId)});
  const pane = tab && (function find(n) { return n.type === 'leaf' ? (n.pane.id === ${JSON.stringify(paneId)} ? n.pane : null) : (find(n.a) ?? find(n.b)); })(tab.root);
  return pane ? s.agentStatusOf(pane) : 'gone';
})()`);
/** MobilePicker 의 타일 줄과 같은 길 */
const pickTile = async (tabId, paneId) => {
  await ev(`(async () => { const t = await ${T}; if (t.activeTabId() !== ${JSON.stringify(tabId)}) t.pickTab(${JSON.stringify(tabId)}); t.focusPane(${JSON.stringify(tabId)}, ${JSON.stringify(paneId)}); })()`);
  await sleep(400);
};
const seenCalls = async () => JSON.parse(await ev(`JSON.stringify(window.__calls.filter(([c]) => c === 'agent_state_seen').map(([, a]) => a))`));
const lastSeq = (paneId) => ev(`(async () => (await ${S}).agentSeqOf(${JSON.stringify(paneId)}))()`);
const bannerKinds = () => ev(`(async () => JSON.stringify((await ${B}).agentBannerItems().map((b) => [b.paneId, b.kind])))()`);
const emitSeen = async (stream, s) => {
  await ev(`window.__emit('agent-seen', ${JSON.stringify({ stream, seq: s })})`);
  await sleep(250);
};
const setFocus = async (on) => {
  await ev(`(() => { window.__focused = ${on}; window.dispatchEvent(new Event(${on ? "'focus'" : "'blur'"})); })()`);
  await sleep(200);
};
const setHidden = async (on) => {
  await ev(`(() => { window.__hidden = ${on}; document.dispatchEvent(new Event('visibilitychange')); })()`);
  await sleep(200);
};
const humanInput = async () => {
  await ev(`window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true }))`);
  await sleep(300);
};

// ── ⓪ 폰 자체 ───────────────────────────────────────────────────────────────
await boot(400, true);
await signal("s-b", "start");
await signal("s-b", "stop");
check("⓪ 다른 탭 stop → 완료", await status("ai-b"), "finished");
await pickTile("tab-b", "ai-b");
check("⓪ 그 타일을 고르면 이 창의 완료가 지워진다", await status("ai-b"), null);
if (REPRO) {
  console.log(`INFO REPRO 끝 · errors=${JSON.stringify(errors)}`);
  process.exit(bad === 0 ? 0 : 1);
}

// ── ① · ② 표식 → 보기 → op 한 번 (폰) ───────────────────────────────────────
await boot(400, true);
check("① 처음엔 op 없음", await seenCalls(), []);
await signal("s-b", "start");
await signal("s-b", "stop");
check("① 다른 탭 stop → 표식", await status("ai-b"), "finished");
check("① 안 보는 타일은 안 보냄", await seenCalls(), []);
await pickTile("tab-b", "ai-b");
const seqB = await lastSeq("ai-b");
await sleep(300);
check("② 보기 → 맞는 seq 로 op 한 번", await seenCalls(), [{ stream: "s-b", seq: seqB }]);
check("② 표식도 사라짐", await status("ai-b"), null);
await humanInput();
await pickTile("tab-a", "ai-a");
await pickTile("tab-b", "ai-b");
check("② 다시 봐도 중복 없음", (await seenCalls()).length, 1);

// ── ⑥ 폰 solo — 같은 탭의 안 보이는 타일 ─────────────────────────────────────
await signal("s-c", "start");
await signal("s-c", "stop");
check("⑥ 같은 탭의 안 보이는 타일은 안 보냄", (await seenCalls()).filter((a) => a.stream === "s-c"), []);
await pickTile("tab-b", "ai-c");
await sleep(300);
check("⑥ 그 타일로 가면 보냄", (await seenCalls()).filter((a) => a.stream === "s-c").length, 1);

// ── ⑦ 표식 없이(스냅숏으로) 깨어나 보기 ──────────────────────────────────────
await boot(400, true);
await ev(`window.__snapshot = [['s-a', { cli: 'claude', state: 'finished', agentRunId: null, seq: 500, at: Date.now(), subagents: [], lastEvent: 'stop', signalRunningAt: Date.now() - 5000, signalPermissionAt: null, signalStopAt: Date.now() - 1000, signalSubagentAt: null, mainStopped: true }]]`);
await ev(`(async () => (await ${S}).syncAgentStates())()`);
await sleep(400);
check("⑦ 스냅숏으로 깨어난 타일(표식 없음)도 보냄", await seenCalls(), [{ stream: "s-a", seq: 500 }]);

// ── ⑤ 폰 — 페이지 숨김 · 가림막 ─────────────────────────────────────────────
await boot(400, true);
await setHidden(true);
await signal("s-a", "start");
await signal("s-a", "stop");
check("⑤ 페이지가 숨은 동안 안 보냄", await seenCalls(), []);
await setHidden(false);
await sleep(200);
check("⑤ 돌아오면 보냄", (await seenCalls()).length, 1);
await ev(`(async () => (await ${V}).openVeil())()`);
await sleep(200);
await signal("s-a", "start");
await signal("s-a", "stop");
check("⑤ 가림막 동안 안 보냄", (await seenCalls()).length, 1);
await ev(`(async () => (await ${V}).closeVeil())()`);
await sleep(300);
check("⑤ 가림막을 걷으면 보냄", (await seenCalls()).length, 2);

// ── ⑤ 넓은 창(집 PC 와 같은 갈래) — 비포커스 · 사람 입력 ──────────────────────
await boot(1280, false);
await signal("s-a", "start");
await signal("s-a", "stop");
check("⑤ 넓은 창 — 포커스뿐이고 입력이 없으면 안 보냄(자리를 비운 채 앞에 떠 있는 창)", await seenCalls(), []);
await humanInput();
const seqA = await lastSeq("ai-a");
check("⑤ 넓은 창 — 끝난 뒤 사람이 움직이면 보냄", await seenCalls(), [{ stream: "s-a", seq: seqA }]);
await setFocus(false);
await signal("s-a", "start");
await signal("s-a", "stop");
await humanInput();
check("⑤ 넓은 창 — 비포커스면 안 보냄", (await seenCalls()).length, 1);
await setFocus(true);
check("⑤ 넓은 창 — 창으로 돌아오면 보냄", (await seenCalls()).at(-1), { stream: "s-a", seq: await lastSeq("ai-a") });
check("⑤ 넓은 창 — 두 번째 턴도 한 번씩", (await seenCalls()).length, 2);

// ── ③ · ④ 수신 ───────────────────────────────────────────────────────────────
await boot(400, true);
await signal("s-b", "start");
await signal("s-b", "stop");
check("③ 표식", await status("ai-b"), "finished");
await ev(`(async () => (await ${B}).pushAgentBanner({ paneId: 'ai-b', kind: 'stop', agent: 'Claude Code', logo: null, label: 'b', text: 'b' }))()`);
await ev(`(async () => (await ${B}).pushAgentBanner({ paneId: 'ai-c', kind: 'permission', agent: 'Claude Code', logo: null, label: 'c', text: 'c' }))()`);
await sleep(100);
console.log(`INFO 배너 ${await bannerKinds()}`);
const seqB2 = await lastSeq("ai-b");
await emitSeen("s-b", seqB2 - 1);
check("④ 옛 seq 수신 → 표식 유지", await status("ai-b"), "finished");
await emitSeen("s-b", seqB2);
check("③ 수신 → 표식 사라짐", await status("ai-b"), null);
await emitSeen("s-c", 99999);
check("③ 완료 배너 사라짐 · 같은 확인이 와도 권한 배너 유지", await bannerKinds(), JSON.stringify([["ai-c", "permission"]]));
await signal("s-b", "start");
await signal("s-b", "stop");
check("④ 새 턴의 표식", await status("ai-b"), "finished");
await emitSeen("s-b", seqB2);
check("④ 지난 턴의 seq 수신 → 새 표식 유지", await status("ai-b"), "finished");
await emitSeen("s-nope", 99999);
check("③ 이 창에 없는 스트림 → 아무 일 없음", await status("ai-b"), "finished");

check("⑧ 예외 0", errors, []);
console.log(`\n${bad === 0 ? "ALL PASS" : `${bad} FAIL`}`);
process.exit(bad === 0 ? 0 : 1);
