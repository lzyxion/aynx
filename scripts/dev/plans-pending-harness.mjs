// 헤드리스 검증 — **검토 대기 만료** (docs/log/2026-09-21-approval-ttl.md) — 알림 알약의 승인 대기 · 작업안 카드의 남은 시간 ·
// 만료가 실행 뷰를 만들지 않는다.
//
// 2026-11-21 옮김 · 이름 바꿈(옛 `console-hosts-harness.mjs`): 이 판은 원래 대시보드 세션 칸의 **목록 모드 = 호스트로 묶은 한 벌**(docs/log/2026-09-21-console-host-groups.md)을
// 보던 판이었다. 그 화면은 없어졌다 — 목록 모드 · 거르개 칩(전체 · 타일 · 헤드리스)은 2026-09-28 에 세션 카드로 합쳐지며 걷혔고
// (`console/host-groups.ts` 머리말), 전체 화면 대시보드(`.console`)와 상태바의 대시보드 칸(`open-console`) · 그 배지는 2026-10-07 에
// 세션 판 · 작업안으로 나뉘며 없어졌다.세션 판은 호스트로 묶지 않고 헤드리스를 빼므로 옮길 자리가
// 없어 그 판정(①~③ · 대시보드 칸 배지)은 걷었다 — 호스트 묶음 · 중복 제거 규칙은 `console/host-groups.test.ts` 가 본다.
// 살아 있는 몫(옛 ④ · ⑤)만 지금 자리로 옮겼다: 작업안은 **채팅 독의 작업안 갈래**(2026-10-25 · `app/plans.svelte.ts`)이고
// 몸통은 그대로 `PlanList` · `ExecList`(`console/ops-controller.svelte.ts` 의 복구 루프)다.
//
// 보는 것: ① 알림 알약의 말풍선이 승인 대기 1 을 말하고 배지가 선다 ② 작업안 카드가 "만료까지 12분" ③ 만료 이벤트
// (`operation-state{state:"expired"}`)가 실행 뷰를 만들지 않는다(실행 카드 수 그대로 · "(다른 창에서 시작한 실행)" 없음)
// ④ 복구 루프도 목록의 `expired` 를 실행 뷰로 되살리지 않고, 대기 카드는 사라진다. 예외 0.
//
//   node scripts/dev/run-harness.mjs plans-pending-harness.mjs <outdir>
//     → <outdir>-pending-badge.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { reloadBoot } from "./boot-wait.mjs";
import fs from "node:fs";
const [outdir = "out"] = process.argv.slice(2);
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? "9224"}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (d.method) events.push(d);
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
const shot = async (path) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) { fs.writeFileSync(path, Buffer.from(r.result.data, "base64")); return "ok"; }
    await sleep(500);
  }
  return "capture failed";
};

// 단언 — 실패해도 계속 돌려서 한 번에 전부 본다(마지막에 개수를 센다).
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
  performance.setResourceTimingBufferSize(5000);
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  // Tauri 이벤트 통로 — listen 이 등록한 핸들러 id 를 이름별로 쥐고, __emit 이 백엔드 대신 쏜다(작업안의
  // operation-state 처리를 실제 경로로 때린다). 이 블록은 템플릿 문자열이라 백틱을 쓸 수 없다.
  const evts = new Map();
  window.__emit = (name, payload) => {
    const ids = evts.get(name) ?? [];
    for (const id of ids) cbs.get(id)?.({ event: name, id, payload });
    return ids.length;
  };
  let nextSession = 100;
  window.__ops = { pending: [], recent: [] };
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {},
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    term_theme_list: [], restore_done_sessions: { closed: 0, unclaimed: 0 }, mcp_activity: null,
    // 볼트는 꺼진 상태로 둔다 — null 을 주면 접속 경로가 hasMaster 를 읽다 죽는다(실제로 겪었다).
    vault_status: { state: 'absent', hasMaster: false, entryCount: 0 }, vault_list: [],
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') { evts.set(args.event, (evts.get(args.event) ?? []).filter((x) => x !== args.eventId)); return Promise.resolve(); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await reloadBoot(send, ev);

// ── 작업안을 심는다 ──────────────────────────────────────────────────────────
// 검토 대기 하나 — **만료 12분 뒤**. 이 하나가 알림 알약의 승인 대기와 작업안 카드의 "만료까지 12분" 두 자리를 먹인다.
// 도는 실행 하나(op-1) — 만료 이벤트 뒤에도 실행 카드 수가 그대로인지 재는 기준이다.
const NOW = Date.now();
await ev(`window.__ops = ${JSON.stringify({
  pending: [{ operationId: "op-2", state: "awaitingApproval", command: "df -h",
              targets: ["delegated:bastion"], cwd: null, validate: null, mode: "adhoc",
              strategy: "rolling", concurrency: 1, timeoutSeconds: 60, createdAt: NOW,
              requestedAt: NOW, expiresAt: NOW + 12 * 60_000, title: null, reason: null,
              idempotencyKey: null }],
  recent: [{ operationId: "op-1", state: "running", command: "npm test", targets: ["delegated:bastion"],
             mode: "exec", strategy: "sequential", timeoutSecs: 60, cwd: null, createdAt: NOW,
             requestedAt: null, expiresAt: null }],
})}`);
// 알약의 대기 수는 `app/pending-plans.svelte.ts` 가 센다 — 부팅 때 한 번 읽고 그 뒤로는 이벤트 · 창 포커스 · 30초 그물로만
// 다시 읽는다. 표를 방금 갈아 끼웠으니 포커스로 깨운다(디바운스 300ms).
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(900);

// ── ① 알림 알약 — 승인 대기는 종 몫 (docs/log/2026-09-25-notification-center.md · 2026-10-24 알약) ─────────
check("알림 알약 말풍선이 승인 대기 1 을 말한다",
  await ev(`/승인 대기 1 /.test(document.querySelector('.statusbar [data-signal="notify"]')?.title || '')`),
  true);
check("알림 알약에 배지가 선다",
  await ev(`Number(document.querySelector('.statusbar [data-signal="notify"] .notify-pill')?.textContent.trim() ?? 0) >= 1`),
  true);

// ── ② 작업안 카드의 남은 시간 — 채팅 독의 작업안 갈래로 연다 ──────────────────────
await ev(`(async () => (await ${importApp("app/plans.svelte.ts")}).openPlans())()`);
await sleep(1500); // 작업안 폴링(2초) 한 바퀴 안쪽 — 첫 읽기는 열 때 곧바로 돈다
check("작업안 갈래가 열렸다", await ev(`(async () => (await ${importApp("app/plans.svelte.ts")}).plansShown())()`), true);
const plans = `document.querySelector('[data-chat-dock-plans]')`;
check("작업안 카드가 만료까지 남은 시간을 말한다",
  await ev(`${plans}?.querySelector('[data-plan-pending] .oexpiry')?.textContent.trim() ?? null`),
  "만료까지 12분");
await shot(`${outdir}-pending-badge.png`);

// ── ③ 만료는 **실행 뷰를 만들지 않는다** ─────────────────────────────────────
// 실제로 본 버그: 대기 작업안이 TTL 로 만료되면 `operation-state{state:"expired"}` 가 오는데, 이벤트 처리가 "뷰가 없으면
// 만든다" 였으므로 "(다른 창에서 시작한 실행)" 카드가 생겼다. 돌지 않은 것의 결과 행렬을 보여 준 셈이다.
const execCount = async () => await ev(`${plans}?.querySelectorAll('.op.exec, [data-exec-row]').length ?? -1`);
const external = async () =>
  await ev(`[...(${plans}?.querySelectorAll('.op.exec, [data-exec-row]') ?? [])].some((e) => (e.textContent || '').includes('(다른 창에서 시작한 실행)'))`);
const before = await execCount(); // recent 의 op-1(running) 하나 — 이 값이 변하면 안 된다
check("만료 이벤트 전: 실행 카드는 recent 의 하나뿐이고 '다른 창' 카드는 없다",
  [before, await external()], [1, false]);

// 구독자는 여럿이다(작업안 · 알림 알약의 대기 수 · 결과 알림) — 수가 아니라 **닿았는가**만 본다.
check("만료 이벤트가 구독에 닿는다",
  await ev(`window.__emit('operation-state', { operationId: 'op-2', state: 'expired' }) >= 1`), true);
await sleep(400);
check("만료 이벤트는 실행 뷰를 만들지 않는다 (카드 수 그대로 · '다른 창' 없음)",
  [await execCount(), await external()], [before, false]);

// ── ④ 복구 루프도 같다 — 목록이 op-2 를 `expired` 로 돌려줘도 실행 뷰로 되살리지 않는다 ────────────
// (`console/ops-controller.svelte.ts` 의 `EXEC_STATES` 가 expired · rejected 를 일부러 빼 둔다). 대기 카드는 사라진다.
await ev(`window.__ops = { pending: [], recent: [{ ...window.__ops.pending[0], state: 'expired' }, window.__ops.recent[0]] }`);
await sleep(2600); // 작업안 폴링 한 바퀴(2초)
check("복구 루프도 만료를 실행 뷰로 되살리지 않는다",
  [await execCount(), await external()], [before, false]);
check("만료된 대기 카드는 사라진다",
  await ev(`${plans}?.querySelectorAll('[data-plan-pending]').length ?? -1`), 0);

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
check("잡히지 않은 예외 0 (stub: 제외)", exc.length, 0);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
