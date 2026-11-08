// 헤드리스 검증 — **작업안 실행 결과 알림** (토스트 · 알림 센터 · OS 알림 · 가림막 아래 개수)
// (docs/log/2026-09-28-run-result-notify.md).
//
// `review-card-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다. 먹이는 칸은 넷이다:
// `window.__ops`(= `list_operations`) · `window.__results[id]`(= `operation_results`, 없으면 빈 맵) ·
// `window.__resultsFail`(id 배열 — 그 작업안의 결과 읽기를 거부한다) · `window.__focused`(창이 앞에
// 있나 — `document.hasFocus` 를 갈아 끼운다). `operation-state` 는 `window.__emit` 으로 쏘고,
// OS 알림은 `window.Notification` 을 갈아 끼워 `window.__osNotes` 에 모은다(플러그인의 발사가 곧
// `new Notification(title, {body})` 다).
//
// 시나리오: ① 성공(3초 · 단추 없음) · ② 일부 실패(이름 둘 + 외 N · [결과 보기]) · ③ canary 멈춤 ·
// ③′ canary 검증에서 멈춤 ·
// ④ 취소(무채 · [결과 보기]) · ⑤ 자동 칩 · ⑤′ 제목 없는 25ms(`0.1초 미만`) · ⑥ 결과 읽기 실패 → 상태만 · ⑦ 작업안마다 한 번 ·
// ⑧ 부팅 때 이미 끝나 있던 것은 씨(알리지 않는다) · ⑨ 거절·만료는 알리지 않는다 · ⑩ 대시보드
// 작업안 칸이 떠 있으면 토스트 없이 센터만 · ⑪ 알림 센터 줄 → 대시보드 작업안 칸의 그 실행 ·
// 토스트 [결과 보기]도 같은 곳 · ⑫ 가림막 — 개수만(합쳐 센다) · ⑬ OS 알림 — 창이 뒤일 때만 ·
// 설정을 끄면 없음 · 가림막 아래는 개수만 · ⑭ 잡히지 않은 예외·콘솔 오류 0.
//
// usage (격리 서버 — 1420/9222 는 개발 앱의 것이라 건드리지 않는다):
//   npx vite --port 1440 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9272 --user-data-dir=%TEMP%/edge-aynx-runnotify \
//     --window-size=1200,800 http://localhost:1440/
//   PAGE_PORT=1440 node scripts/dev/run-notify-harness.mjs <outdir> 9272
//     → <outdir>/run-notify-success.png · -partial.png · -canary.png · -validate.png · -cancelled.png · -auto.png ·
//       -unavailable.png · -stack.png · -center.png · -veiled.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9272"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1440";
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${PAGE_PORT}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
/** ⑭ — 잡히지 않은 예외와 콘솔 오류를 모은다 */
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
    errors.push("EXC " + (x.exception?.description ?? x.text ?? "").split("\n")[0]);
  }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    errors.push("console.error " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0]);
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
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
      console.log("PNG " + path.resolve(p));
      return;
    }
    await sleep(500);
  }
  console.log("capture failed: " + p);
};

let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(
    `${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`,
  );
};

/** 앱이 실제로 쓰는 모듈 인스턴스 — URL 을 손으로 적으면 `$state` 를 공유하지 않는 사본이 생긴다 */
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

const T0 = 1_700_000_000_000;
const plan = (over) => ({
  operationId: "op-x", command: "uptime", targets: ["s1"], cwd: null, validate: null,
  mode: "exec", strategy: "sequential", concurrency: 1, timeoutSeconds: 60,
  state: "succeeded", createdAt: T0, requestedAt: T0, expiresAt: null,
  title: null, reason: null, idempotencyKey: null, approvalMethod: "manual", ...over,
});
const res = (state, over = {}) => ({
  state, exitCode: state === "succeeded" ? 0 : state === "failed" ? 1 : null, stdout: "", stderr: "",
  startedAt: state === "cancelled" ? null : T0, endedAt: T0 + 1000, errorClass: null, ...over,
});

// 부팅 때 **이미 끝나 있던** 작업안 하나 — ⑧ 이 이것으로 씨를 본다.
const OLD = plan({ operationId: "op-old", state: "failed", title: "지난 실행", targets: ["s1"] });

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => {
    const ids = evts.get(name) ?? [];
    for (const id of ids) cbs.get(id)?.({ event: name, id, payload });
    return ids.length;
  };
  let nextSession = 100;
  window.__ops = { pending: [], recent: [${JSON.stringify(OLD)}] };
  window.__results = {};
  window.__resultsFail = [];
  // 창이 앞에 있나 — 알림 판정(\`windowFocused\`)이 읽는 \`document.hasFocus\` 를 갈아 끼운다.
  window.__focused = true;
  Document.prototype.hasFocus = function () { return window.__focused; };
  // OS 알림 — 플러그인의 발사는 \`new window.Notification(title, {body})\` 다.
  window.__osNotes = [];
  window.Notification = class { constructor(title, opts) { window.__osNotes.push({ title, body: opts?.body ?? null }); } static get permission() { return 'granted'; } static requestPermission() { return Promise.resolve('granted'); } };
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false } };
  window.__vault = { state: 'unlocked', hasMaster: false, entryCount: 0 };
  const host = (name, over) => ({ name, host_name: name + '.internal', user: 'deploy', port: 22, ...over });
  // 대상 이름 — 이 창의 타일이 모르는 대상은 앱 전역 세션 목록에서 찾는다(목업의 호스트 이름).
  const NAMES = { s1: 'web-01', s2: 'web-02', s3: 'web-03', s4: 'db-01', s5: 'db-02', s6: 'cache-01', s7: 'cache-02', s8: 'lb-01' };
  const answers = {
    list_hosts: { hosts: [host('web-01', { meta: { color: '#4a90d9', tags: [], forwards: [] } })], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    list_console_sessions: Object.entries(NAMES).map(([id, label]) => ({ id, label })),
    delegation_list_targets: [], vault_list: [], vault_lock: null, mcp_activity: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
      if (cmd === 'operation_results') {
        if (window.__resultsFail.includes(args.operationId)) return Promise.reject('stub: results unavailable');
        return Promise.resolve(window.__results[args.operationId] ?? {});
      }
      if (cmd === 'plugin:notification|is_permission_granted') return Promise.resolve(true);
      if (cmd === 'load_settings') return Promise.resolve(window.__settings);
      if (cmd === 'vault_status') return Promise.resolve(window.__vault);
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
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(2400);
errors.length = 0;

const toastMod = importApp("lib/toast.svelte.ts");
const consoleMod = importApp("app/console.svelte.ts");
const notesMod = importApp("app/notifications.svelte.ts");

/** 작업안 하나를 목록에 올리고 결과를 먹인 뒤 종료 상태 이벤트를 쏜다 */
const finish = async (op, results, { fail = false, wait = 700 } = {}) => {
  await ev(`(() => {
    const op = ${JSON.stringify(op)};
    window.__ops = { pending: [], recent: [op, ...window.__ops.recent.filter((o) => o.operationId !== op.operationId)] };
    ${results ? `window.__results[op.operationId] = ${JSON.stringify(results)};` : ""}
    if (${fail}) window.__resultsFail.push(op.operationId);
    return window.__emit('operation-state', { operationId: op.operationId, state: op.state });
  })()`);
  await sleep(wait);
};
/** 떠 있는 토스트 전부 — 두 줄 몸이면 머리·칩·앞 토막(색)·꼬리, 단추 */
const readToasts = async () =>
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.toasts .toast')].map((t) => {
    const q = (s) => t.querySelector(s);
    const d = q('[data-toast-detail]');
    const lead = q('.lead');
    const sub = q('.t-sub');
    return {
      kind: ['success', 'error', 'info'].find((k) => t.classList.contains(k)),
      head: d ? q('.t-head-text').textContent.trim() : null,
      chip: q('.chip')?.textContent.trim() ?? null,
      lead: lead?.textContent.trim() ?? null,
      tone: lead ? ['good', 'bad', 'plain'].find((k) => lead.classList.contains(k)) : null,
      tail: sub ? sub.textContent.replace(lead.textContent, '').replace(/^\\s*·\\s*/, '').replace(/\\s+/g, ' ').trim() : null,
      text: d ? null : q('.text')?.textContent.trim(),
      buttons: [...t.querySelectorAll('button.act')].map((b) => b.textContent.trim()),
    };
  }))`));
const clearToasts = () =>
  ev(`(async () => { const m = await ${toastMod}; for (const x of [...m.toasts]) m.dismiss(x.id); })()`);
const osNotes = async () => JSON.parse(await ev(`JSON.stringify(window.__osNotes)`));
const center = async () => JSON.parse(await ev(`(async () => JSON.stringify((await ${notesMod}).notificationList().map((e) => ({ kind: e.kind, operationId: e.operationId ?? null, level: e.level ?? null, text: e.text }))))()`));

// ── ⑧ 부팅 씨 — 이미 끝나 있던 작업안은 알리지 않는다 (먼저 본다: 다른 판이 목록을 바꾸기 전에) ──
await finish(OLD, { s1: res("failed") });
check("⑧ 부팅 때 이미 끝나 있던 op-old → 토스트 없음", (await readToasts()).length, 0);
check("⑧ 알림 센터에도 없음", (await center()).length, 0);

// ── ① 성공 ────────────────────────────────────────────────────────────────
const S3 = ["s1", "s2", "s3"];
await finish(plan({ operationId: "op-s", title: "디스크 사용량 확인", targets: S3 }), {
  s1: res("succeeded", { startedAt: T0, endedAt: T0 + 4000 }),
  s2: res("succeeded", { startedAt: T0 + 4100, endedAt: T0 + 9000 }),
  s3: res("succeeded", { startedAt: T0 + 4100, endedAt: T0 + 12_400 }),
});
check("① 성공 토스트", await readToasts(), [
  { kind: "success", head: "디스크 사용량 확인", chip: null, lead: "성공 3/3", tone: "good", tail: "12.4초", text: null, buttons: [] },
]);
check("① 성공은 3초", await ev(`(async () => (await ${toastMod}).toasts[0].ms)()`), 3000);
await shot("run-notify-success.png");
await clearToasts();

// ── ② 일부 실패 ────────────────────────────────────────────────────────────
const S8 = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
const r8 = Object.fromEntries(S8.map((id) => [id, res("succeeded", { startedAt: T0, endedAt: T0 + 20_000 })]));
r8.s2 = res("failed", { startedAt: T0, endedAt: T0 + 41_000 });
r8.s4 = res("timedOut");
r8.s7 = res("failed");
await finish(plan({ operationId: "op-p", state: "partial", title: "패키지 목록 갱신", targets: S8 }), r8);
check("② 일부 실패 토스트", await readToasts(), [
  { kind: "error", head: "패키지 목록 갱신", chip: null, lead: "일부 실패 5/8", tone: "bad", tail: "실패: web-02, db-01 외 1 · 41.0초", text: null, buttons: ["결과 보기"] },
]);
check("② 실패는 6초", await ev(`(async () => (await ${toastMod}).toasts[0].ms)()`), 6000);
await shot("run-notify-partial.png");
await clearToasts();

// ── ③ canary 멈춤 ──────────────────────────────────────────────────────────
await finish(plan({ operationId: "op-c", state: "failed", title: "임시 파일 정리", targets: S3 }), {
  s1: res("failed", { exitCode: 1 }), s2: res("cancelled"), s3: res("cancelled"),
});
check("③ canary 멈춤 토스트", await readToasts(), [
  { kind: "error", head: "임시 파일 정리", chip: null, lead: "canary 실패로 멈춤", tone: "bad", tail: "web-01 exit 1 · 나머지 2곳은 실행 안 함", text: null, buttons: ["결과 보기"] },
]);
await shot("run-notify-canary.png");
await clearToasts();

// ── ③′ canary 검증에서 멈춤 — canary 명령은 성공, 검증이 막아 나머지는 시작 전 취소(집계 partial) ──
const WHY = "canary 검증 실패로 취소됨 (검증 종료 코드 1)";
await finish(plan({ operationId: "op-val", state: "partial", title: "nginx 설정 재적용", targets: S3, validate: "systemctl is-active nginx" }), {
  s1: res("succeeded"), s2: res("cancelled", { errorClass: WHY }), s3: res("cancelled", { errorClass: WHY }),
});
check("③′ 검증 멈춤 토스트", await readToasts(), [
  { kind: "error", head: "nginx 설정 재적용", chip: null, lead: "canary 검증 실패로 멈춤", tone: "bad", tail: "web-01 · 나머지 2곳은 실행 안 함", text: null, buttons: ["결과 보기"] },
]);
await shot("run-notify-validate.png");
await clearToasts();

// ── ④ 취소 — 실제 백엔드 모양: 일부 성공 뒤 사람이 멈추면 집계는 `partial` + `cancelledByUser` ──────
// (docs/log/2026-09-28-run-history.md "사람의 취소" — 앞선 판은 도달할 수 없는 `cancelled` 모양을 먹였다)
await finish(plan({ operationId: "op-x1", state: "partial", cancelledByUser: true, title: "배포 롤백", targets: ["s1", "s2", "s3", "s4"] }), {
  s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled"), s4: res("cancelled"),
});
check("④ 취소 토스트 — 무채 · [결과 보기] (partial 이어도 `일부 실패` 가 아니다)", await readToasts(), [
  { kind: "info", head: "배포 롤백", chip: null, lead: "취소됨", tone: "plain", tail: "성공 1/4 뒤 멈춤", text: null, buttons: ["결과 보기"] },
]);
check("④ 취소는 3초", await ev(`(async () => (await ${toastMod}).toasts[0].ms)()`), 3000);
await shot("run-notify-cancelled.png");
await clearToasts();
// 검증 통과 직후에 누른 취소 — 모양은 검증 멈춤과 같지만 사람이 멈춘 것이다
await finish(plan({ operationId: "op-x2", state: "partial", cancelledByUser: true, title: "nginx 설정 재적용", validate: "systemctl is-active nginx", targets: S3 }), {
  s1: res("succeeded"), s2: res("cancelled"), s3: res("cancelled"),
});
check("④ 검증 뒤 취소는 `canary 검증 실패로 멈춤` 이 아니다", (await readToasts()).map((t) => [t.kind, t.lead, t.tail]), [["info", "취소됨", "성공 1/3 뒤 멈춤"]]);
await clearToasts();

// ── ⑤ 자동 칩 ─────────────────────────────────────────────────────────────
const S5 = ["s1", "s2", "s3", "s4", "s5"];
await finish(plan({ operationId: "op-a", title: "로그 정리", targets: S5, approvalMethod: "auto" }),
  Object.fromEntries(S5.map((id) => [id, res("succeeded", { startedAt: T0, endedAt: T0 + 3100 })])));
check("⑤ 자동 칩", await readToasts(), [
  { kind: "success", head: "로그 정리", chip: "자동", lead: "성공 5/5", tone: "good", tail: "3.1초", text: null, buttons: [] },
]);
await shot("run-notify-auto.png");
await clearToasts();

// ── ⑤′ 제목 없는 25ms 실행 — 머리는 `headlineOf`(명령 첫 줄) 그대로, 시간은 `0.1초 미만` (2026-09-28) ──
await finish(plan({ operationId: "op-fast", command: "hostname && uptime\nwho", targets: ["s5"], approvalMethod: "auto" }),
  { s5: res("succeeded", { startedAt: T0, endedAt: T0 + 25 }) });
check("⑤′ 25ms 는 0.1초 미만 · 제목 없으면 명령 첫 줄", await readToasts(), [
  { kind: "success", head: "hostname && uptime…", chip: "자동", lead: "성공 1/1", tone: "good", tail: "0.1초 미만", text: null, buttons: [] },
]);
await clearToasts();

// ── ⑥ 결과 읽기 실패 → 상태만 ─────────────────────────────────────────────
await finish(plan({ operationId: "op-u", state: "failed", title: "nginx 설정 재적용", targets: S3 }), null, { fail: true });
check("⑥ 물러선 문구", await readToasts(), [
  { kind: "error", head: "nginx 설정 재적용", chip: null, lead: "실패", tone: "bad", tail: "대상별 결과는 대시보드에서", text: null, buttons: ["결과 보기"] },
]);
await shot("run-notify-unavailable.png");
await clearToasts();

// ── ⑦ 작업안마다 한 번 ────────────────────────────────────────────────────
await finish(plan({ operationId: "op-s", title: "디스크 사용량 확인", targets: S3 }), null);
check("⑦ 이미 알린 op-s 가 다시 와도 토스트 없음", (await readToasts()).length, 0);
// 결과를 읽는 사이 같은 이벤트가 겹쳐 와도 한 번
await ev(`(() => {
  const op = ${JSON.stringify(plan({ operationId: "op-dup", title: "겹친 이벤트", targets: ["s1"] }))};
  window.__ops = { pending: [], recent: [op, ...window.__ops.recent] };
  window.__results['op-dup'] = { s1: ${JSON.stringify(res("succeeded"))} };
  window.__emit('operation-state', { operationId: 'op-dup', state: 'succeeded' });
  window.__emit('operation-state', { operationId: 'op-dup', state: 'succeeded' });
  window.__emit('operation-state', { operationId: 'op-dup', state: 'succeeded' });
})()`);
await sleep(700);
check("⑦ 세 번 겹친 이벤트 → 토스트 한 장", (await readToasts()).length, 1);
check("⑦ 센터에도 op-dup 한 줄", (await center()).filter((e) => e.operationId === "op-dup").length, 1);
// 대기 카드의 포커스 그물(목록 재조회)이 끝난 작업안을 다시 봐도 알림은 늘지 않는다
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(900);
check("⑦ 포커스 그물 뒤에도 토스트 한 장", (await readToasts()).length, 1);
await clearToasts();

// ── ⑨ 거절·만료는 알리지 않는다 ───────────────────────────────────────────
await finish(plan({ operationId: "op-r", state: "rejected", title: "거절됨" }), null);
await finish(plan({ operationId: "op-e", state: "expired", title: "만료됨" }), null);
check("⑨ 거절·만료 → 토스트 없음", (await readToasts()).length, 0);
check("⑨ 센터에도 없음", (await center()).filter((e) => ["op-r", "op-e"].includes(e.operationId)).length, 0);

// ── ⑩ 대시보드 작업안 칸이 떠 있으면 토스트 없이 센터만 ─────────────────────
await ev(`(async () => (await ${consoleMod}).openConsoleAt('operations'))()`);
await sleep(600);
await finish(plan({ operationId: "op-dash", state: "failed", title: "대시보드에서 본 실행", targets: ["s1"] }), { s1: res("failed") });
check("⑩ 작업안 칸 → 토스트 없음", (await readToasts()).length, 0);
check("⑩ 센터에는 기록", (await center()).find((e) => e.operationId === "op-dash")?.level ?? null, "error");
// 에이전트 칸(작업안 칸이 아니다)에서는 토스트가 뜬다
await ev(`(async () => (await ${consoleMod}).openConsoleAt('agents'))()`);
await sleep(400);
await finish(plan({ operationId: "op-agents", title: "에이전트 칸에서", targets: ["s1"] }), { s1: res("succeeded") });
check("⑩ 에이전트 칸 → 토스트가 뜬다", (await readToasts()).length, 1);
await ev(`(async () => (await ${consoleMod}).closeConsole(false))()`);
await sleep(400);
await clearToasts();

// ── 여럿이 쌓인 모습 한 장 ────────────────────────────────────────────────
await finish(plan({ operationId: "op-st1", title: "디스크 사용량 확인", targets: S3 }),
  Object.fromEntries(S3.map((id) => [id, res("succeeded", { startedAt: T0, endedAt: T0 + 12_400 })])), { wait: 250 });
await finish(plan({ operationId: "op-st2", state: "partial", title: "nginx 설정 재적용", targets: S3 }), {
  s1: res("succeeded", { startedAt: T0, endedAt: T0 + 8200 }), s2: res("failed"), s3: res("succeeded"),
}, { wait: 250 });
await finish(plan({ operationId: "op-st3", title: "로그 정리", targets: S5, approvalMethod: "auto" }),
  Object.fromEntries(S5.map((id) => [id, res("succeeded", { startedAt: T0, endedAt: T0 + 3100 })])));
await ev(`(async () => (await ${toastMod}).holdToasts())()`);
await shot("run-notify-stack.png");

// ── ⑪ 토스트 [결과 보기] · 알림 센터 줄 → 대시보드 작업안 칸의 그 실행 ──────
await ev(`[...document.querySelectorAll('.toasts button.act')].find((b) => b.textContent.trim() === '결과 보기')?.click()`);
await sleep(500);
check("⑪ [결과 보기] → 대시보드 작업안 칸",
  JSON.parse(await ev(`(async () => { const c = await ${consoleMod}; return JSON.stringify([c.consoleOpen(), c.consoleMode()]); })()`)), [true, "operations"]);
await ev(`(async () => { const c = await ${consoleMod}; c.closeConsole(false); (await ${toastMod}).releaseToasts(); })()`);
await clearToasts();
await sleep(400);
// 2026-10-18 통합 독 — 알림 상자는 독의 알림 칸이다(상태바 독 입구는 걷혔다 — 모듈로 알림 칸을 연다 · 줄의 표식은 그대로)
await ev(`(async()=>{const e=performance.getEntriesByType('resource').map(r=>r.name).find(u=>u.includes('app/dock.svelte'));(await import(e)).openDock('alerts');})()`);
await sleep(700);
const rows = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-notify-run]')].map((b) => ({
  id: b.getAttribute('data-notify-run'),
  name: b.querySelector('.name').textContent.replace(/\\s+/g, ' ').trim(),
  detail: b.querySelector('.detail').textContent.replace(/\\s+/g, ' ').replace(/ · (방금|\\d+분 전).*?(?= · |$)/, ' · <when>').trim(),
  // Svelte 의 범위 클래스(\`svelte-…\` · \`s-…\`)는 떼고 본다
  result: b.querySelector('.result').className.replace(/\\b(?:svelte|s)-[A-Za-z0-9_-]{6,}/g, '').trim(),
  mark: b.querySelector('.mark').className.replace(/\\b(?:svelte|s)-[A-Za-z0-9_-]{6,}/g, '').trim(),
})))`));
console.log("CENTER", JSON.stringify(rows, null, 1));
const byId = (id) => rows.find((r) => r.id === id) ?? null;
check("⑪ 일부 실패 줄 — 머리 — 결과 / 작업안 실행 · 실패 이름 · 결과 보기 →", byId("op-st2") && [byId("op-st2").name, byId("op-st2").detail, byId("op-st2").result, byId("op-st2").mark],
  ["nginx 설정 재적용 — 일부 실패 2/3", "작업안 실행 · 실패: web-02 · <when> · 결과 보기 →", "result bad", "mark run error"]);
check("⑪ 자동 성공 줄 — 칩 · 결과 보기 없음", byId("op-st3") && [byId("op-st3").name, byId("op-st3").detail, byId("op-st3").mark],
  ["로그 정리자동 — 성공 5/5", "작업안 실행 · <when>", "mark run success"]);
check("⑪ 검증 멈춤 줄 — 같은 문구", byId("op-val") && [byId("op-val").name, byId("op-val").detail],
  ["nginx 설정 재적용 — canary 검증 실패로 멈춤", "작업안 실행 · web-01 · 나머지 2곳은 실행 안 함 · <when> · 결과 보기 →"]);
check("⑪ 성공까지 전부 기록 (op-s · op-p · op-c · op-x1 · op-a · op-u · op-dup · op-dash · op-agents · op-st1..3)",
  ["op-s", "op-p", "op-c", "op-x1", "op-a", "op-u", "op-dup", "op-dash", "op-agents", "op-st1", "op-st2", "op-st3"].every((id) => byId(id)), true);
await shot("run-notify-center.png");
await ev(`document.querySelector('[data-notify-run="op-c"]').click()`);
await sleep(600);
check("⑪ 줄을 누르면 센터가 닫히고 대시보드 작업안 칸",
  JSON.parse(await ev(`(async () => { const c = await ${consoleMod}; return JSON.stringify([!!document.querySelector('.notifycenter'), c.consoleOpen(), c.consoleMode()]); })()`)),
  [false, true, "operations"]);
await ev(`(async () => (await ${consoleMod}).closeConsole(false))()`);
await sleep(400);

// ── ⑬ OS 알림 — 창이 앞이면 없음 · 뒤면 한 장 · 설정 끄면 없음 ───────────────
check("⑬ 지금까지는 창이 앞 — OS 알림 0", (await osNotes()).length, 0);
await ev(`window.__focused = false`);
await finish(plan({ operationId: "op-os", state: "partial", title: "nginx 설정 재적용", targets: S3 }), {
  s1: res("succeeded"), s2: res("failed"), s3: res("succeeded"),
});
check("⑬ 창이 뒤 → OS 알림 한 장 (제목 · 한 줄 요약 — 결과, 호스트 이름 없음)", await osNotes(), [
  { title: "작업안 실행이 끝났습니다", body: "nginx 설정 재적용 — 일부 실패 2/3" },
]);
await ev(`(async () => (await ${importApp("lib/settings.svelte.ts")}).setNotifyOperationResults(false))()`);
await finish(plan({ operationId: "op-os-off", title: "설정 꺼짐", targets: ["s1"] }), { s1: res("succeeded") });
check("⑬ 설정을 끄면 OS 알림 없음 (토스트는 그대로)", [(await osNotes()).length, (await readToasts()).some((t) => t.head === "설정 꺼짐")], [1, true]);
await ev(`(async () => (await ${importApp("lib/settings.svelte.ts")}).setNotifyOperationResults(true))()`);
await clearToasts();

// ── ⑫ 가림막 — 개수만, 합쳐 센다 ──────────────────────────────────────────
await ev(`(async () => (await ${importApp("app/veil.svelte.ts")}).openVeil())()`);
await sleep(700);
await finish(plan({ operationId: "op-v1", state: "failed", title: "비밀스러운 제목", targets: S3 }), {
  s1: res("failed"), s2: res("failed"), s3: res("failed"),
});
check("⑫ 가림막 아래 — 제목·호스트·단추 없이 개수만", await readToasts(), [
  { kind: "error", head: "작업안 실행이 끝났습니다", chip: null, lead: "실패 1건", tone: "plain", tail: "", text: null, buttons: [] },
]);
check("⑫ 토스트 글자에 제목·호스트 이름이 없다",
  await ev(`document.querySelector('.toasts').textContent.includes('비밀스러운') || document.querySelector('.toasts').textContent.includes('web-0')`), false);
check("⑬ 가림막 아래 OS 알림도 개수만", (await osNotes()).at(-1), { title: "작업안 실행이 끝났습니다", body: "실패 1건" });
await finish(plan({ operationId: "op-v2", title: "또 다른 제목", targets: ["s1"] }), { s1: res("succeeded") });
check("⑫ 둘째 건은 합쳐 센다 — 한 장, `실패 1건 · 성공 1건`",
  (await readToasts()).map((t) => [t.kind, t.lead]), [["error", "실패 1건 · 성공 1건"]]);
check("⑫ 가림막 위에 실제로 보인다 (토스트 120 > 가림막 115)",
  await ev(`(() => { const c = document.querySelector('.toasts .toast').getBoundingClientRect(); const e = document.elementFromPoint((c.left + c.right) / 2, (c.top + c.bottom) / 2); return !!e?.closest('.toast'); })()`), true);
check("⑫ 센터에는 전문으로 기록",
  (await center()).find((e) => e.operationId === "op-v1")?.text ?? null, "비밀스러운 제목 — 실패 0/3 · 실패: web-01, web-02 외 1 · 1.0초");
await shot("run-notify-veiled.png");
await ev(`(async () => (await ${importApp("app/veil.svelte.ts")}).closeVeil())()`);
await ev(`window.__focused = true`);
await clearToasts();

// ── 기존 토스트는 그대로 한 줄 ────────────────────────────────────────────
await ev(`(async () => (await ${toastMod}).toast.info('평범한 한 줄'))()`);
await sleep(300);
check("기존 토스트는 한 줄 몸 그대로", (await readToasts()).map((t) => [t.text, t.head]), [["평범한 한 줄", null]]);
await clearToasts();

// ── ⑭ 오류 0 ─────────────────────────────────────────────────────────────
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑭ 잡히지 않은 예외·콘솔 오류 0", errors.length, 0);

console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
