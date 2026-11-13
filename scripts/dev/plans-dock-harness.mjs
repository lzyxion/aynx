// 헤드리스 검증 — **작업안 = 채팅 독의 갈래** (2026-10-25 · docs/log/2026-10-25-plans-tile-refresh.md).
//
// `run-history-harness.mjs` 의 스텁 그대로(부팅 · 감사 · 작업안 목록). 보는 것:
// ① `openPlans` → 채팅 독이 열리고 작업안 갈래(탭 트리에 작업안 타일 없음) · 갈래 칸(독 폭 절반 큰 알약 안 알약 두 칸 · 32px · 고른 칸 아래 알약(.sec-thumb) = --accent-soft) ·
//    작업안 칸 배지 = 승인 대기 수 · 머리줄은 '작업안' · 📌 · ✕ 만 · 검토 카드는 물러난다
// ② 채팅 갈래 — 머리줄(제목 ▾ · +)이 돌아오고 작업안 배지는 남는다 · plansShown 거짓 · 갈래는 `aynx:dock` 의 `chatSection`
// ③ `togglePlans`(open-plans) — 채팅 갈래면 작업안으로, 작업안이 보이면 닫기 · `toggleChatDock`(open-chat-dock) = 채팅 갈래로
// ④ `openPlansAt` — 작업안 갈래 · 그 카드
// ⑤ 원격 폰(390x844 · `__AYNX_REMOTE__`) — 전체 화면 덮개 · 넓은 두 칸 보기 탭 · 거절/승인 44 · 휴대폰 '뒤로' = 닫기 · 시트의 작업안 줄
// ⑥ 원격 데스크톱 폭 — 주 창과 같이 채팅 독의 작업안 갈래(덮는 판 없음 · 2026-11-13) · ⑦ 예외 0
//
// usage: node scripts/dev/run-harness.mjs plans-dock-harness.mjs <outdir> --size 1400x900
//   → <outdir>/dock-plans.png · dock-chat.png · phone-plans.png · remote-plans-dock.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9273"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1441";
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
    const s = (x.exception?.description ?? x.text ?? "").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("EXC " + s);
  }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    // 원격 흉내로 다시 읽을 때 스텁에 없는 명령의 거절(`stub:`)은 앱 오류가 아니다
    if (d.params.args.some((a) => /stub:/.test(String(a.value ?? a.description ?? "")))) return;
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
const key = async (code, keyName, vk) => {
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};

/** 앱이 실제로 쓰는 모듈 인스턴스 — URL 을 손으로 적으면 `$state` 를 공유하지 않는 사본이 생긴다 */
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

// ── 데이터 — 목업 안 A 의 줄들. 시각은 지금 기준 로컬 날짜 ─────────────────────
const now = new Date();
const at = (daysAgo, h, m) => new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m).getTime();
const LABELS = { s1: "web-01", s2: "web-02", s3: "web-03", s4: "db-01", s5: "dev-01" };
const labels = (ids) => ids.map((id) => ({ id, label: LABELS[id], code: `p${id.slice(1)}` }));
const r = (streamId, state, over = {}) => ({
  streamId,
  state,
  exitCode: state === "succeeded" ? 0 : state === "failed" ? 1 : null,
  startedAt: state === "cancelled" ? null : 1_000,
  endedAt: state === "cancelled" ? 1_000 : 3_000,
  ...over,
});
const run = (over) => ({
  operationId: "op-x", command: "uptime", title: null, cwd: null, validate: null,
  targets: ["s1"], targetLabels: labels(["s1"]), approvalMethod: "manual",
  approvedAt: at(0, 9, 0), finishedAt: at(0, 9, 1), state: "succeeded",
  results: [r("s1", "succeeded")], ...over,
});
const S3 = ["s1", "s2", "s3"];
const S5 = ["s1", "s2", "s3", "s4", "s5"];
const allOk = (ids) => ids.map((id) => r(id, "succeeded"));
const RUNS = [
  run({
    operationId: "op-nginx", title: "nginx 설정 재적용", command: "nginx -t && systemctl reload nginx",
    cwd: "/etc/nginx", validate: "curl -fsS 127.0.0.1/healthz", targets: S3, targetLabels: labels(S3),
    approvedAt: at(0, 14, 32), state: "partial",
    results: [
      r("s1", "succeeded", { startedAt: 10_000, endedAt: 12_100 }),
      r("s2", "failed", { startedAt: 12_200, endedAt: 13_600, stderrTail: 'nginx: [emerg] unknown directive "gzip_statik"\n  in /etc/nginx/conf.d/site.conf:14\nnginx: configuration file test failed' }),
      r("s3", "succeeded", { startedAt: 12_200, endedAt: 14_500 }),
    ],
  }),
  run({ operationId: "op-logs", title: "로그 정리", command: "journalctl --vacuum-time=7d", targets: S5, targetLabels: labels(S5), approvalMethod: "auto", approvedAt: at(0, 14, 5), results: allOk(S5) }),
  run({ operationId: "op-disk", title: "디스크 사용량 확인", command: "df -h /", targets: ["s1", "s2", "s4"], targetLabels: labels(["s1", "s2", "s4"]), approvalMethod: "auto", approvedAt: at(0, 9, 12), results: allOk(["s1", "s2", "s4"]) }),
  run({
    operationId: "op-tmp", title: "임시 파일 정리", command: "rm -rf /tmp/build-*", targets: S3, targetLabels: labels(S3),
    approvedAt: at(1, 22, 40), state: "failed", results: [r("s1", "failed"), r("s2", "cancelled"), r("s3", "cancelled")],
  }),
  run({ operationId: "op-apt", title: "패키지 목록 갱신", command: "apt-get update", targets: S5, targetLabels: labels(S5), approvalMethod: "auto", approvedAt: at(1, 18, 3), results: allOk(S5) }),
  run({
    operationId: "op-rollback", title: "배포 롤백", command: "./deploy.sh rollback v1.8.2", targets: ["s1", "s2", "s3", "s4"], targetLabels: labels(["s1", "s2", "s3", "s4"]),
    // 실제 백엔드 모양 — 일부 성공 뒤 사람이 멈추면 집계는 `partial`, 사람의 취소는 `cancelledByUser`
    approvedAt: at(1, 11, 26), state: "partial", cancelledByUser: true, cancelledAt: at(1, 11, 27),
    results: [r("s1", "succeeded"), r("s2", "cancelled"), r("s3", "cancelled"), r("s4", "cancelled")],
  }),
  // 끝난 줄이 없는 실행(앱이 끝나기 전에 닫혔다)
  run({ operationId: "op-open", title: "커널 버전", command: "uname -r", targets: ["s5"], targetLabels: labels(["s5"]), approvedAt: at(1, 8, 0), finishedAt: null, state: null, results: [] }),
  run({
    operationId: "op-validate", title: "서비스 재시작", command: "systemctl restart app", validate: "systemctl is-active app", targets: S3, targetLabels: labels(S3),
    approvedAt: at(2, 17, 0), state: "partial", results: [r("s1", "succeeded"), r("s2", "cancelled"), r("s3", "cancelled")],
  }),
  run({ operationId: "op-cert", title: "인증서 확인", command: "openssl x509 -enddate -noout -in /etc/ssl/site.pem", targets: S5, targetLabels: labels(S5), approvalMethod: "auto", approvedAt: at(2, 15, 0), results: allOk(S5) }),
  run({ operationId: "op-kernel", title: null, command: "uname -a\n# 두 번째 줄", targets: S5, targetLabels: labels(S5), approvalMethod: "auto", approvedAt: at(2, 12, 0), results: allOk(S5) }),
  run({ operationId: "op-disk2", title: "디스크 사용량 확인", command: "df -h /", targets: ["s1", "s2", "s4"], targetLabels: labels(["s1", "s2", "s4"]), approvalMethod: "auto", approvedAt: at(2, 9, 0), results: allOk(["s1", "s2", "s4"]) }),
  run({
    operationId: "op-restart", title: "워커 재시작", command: "systemctl restart worker", targets: ["s1", "s2", "s4"], targetLabels: labels(["s1", "s2", "s4"]),
    approvedAt: at(2, 8, 30), state: "partial", results: [r("s1", "succeeded"), r("s2", "failed"), r("s4", "succeeded")],
  }),
  // 20일 전 — 30일 기간에서만 보인다(그리고 최근 8건 밖이다)
  run({ operationId: "op-old", title: "인증서 만료 확인", command: "certbot certificates", targets: ["s1", "s4"], targetLabels: labels(["s1", "s4"]), approvalMethod: "auto", approvedAt: at(20, 10, 0), results: allOk(["s1", "s4"]) }),
];

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  // ⑤ ⑥ — 원격 창 흉내(관문 폴리필이 세우는 표식 하나). sessionStorage 라 다시 읽어도 남는다
  if (sessionStorage.getItem('aynx-h-remote') === '1') window.__AYNX_REMOTE__ = true;
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => {
    const ids = evts.get(name) ?? [];
    for (const id of ids) cbs.get(id)?.({ event: name, id, payload });
    return ids.length;
  };
  let nextSession = 100;
  window.__auditRuns = ${JSON.stringify(RUNS)};
  window.__auditFail = false;
  window.__ops = { pending: [], recent: [] };
  window.__results = {};
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false } };
  window.__vault = { state: 'unlocked', hasMaster: false, entryCount: 0 };
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [],
    audit_status: { running: true, written: 13, failed: 0, lastOkAt: 0, dir: 'C:/Users/me/AppData/Roaming/aynx-dev/audit' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], vault_lock: null, mcp_activity: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'audit_runs') {
        if (window.__auditFail) return Promise.reject('stub: audit unavailable');
        return Promise.resolve(window.__auditRuns.filter((x) => x.approvedAt >= args.sinceMs).sort((a, b) => b.approvedAt - a.approvedAt).slice(0, args.limit));
      }
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
      if (cmd === 'operation_results') return Promise.resolve(window.__results[args.operationId] ?? {});
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
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(2600);
// 탭 복원이 끝난 뒤에 작업안을 연다(채팅 독 · 주 창에서만 마운트 — 부팅이 끝나야 선다)
for (let i = 0; i < 40 && !(await ev(`window.__calls.some(([c]) => c === 'restore_done_sessions')`)); i++) await sleep(250);
await sleep(500);
errors.length = 0;

// 2026-10-07 작업안 칸이 타일(`kind:"plans"`)로 옮겨 갔다 — 콘솔 API 대신 `app/plans.svelte.ts` 로 열고 닫는다.
const consoleMod = importApp("app/plans.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
// 2026-10-25 작업안은 채팅 독의 갈래다 — 닫기 = 독 닫기(몸통은 독 안에 마운트된 채 남는다)
const chatDockMod = importApp("app/chat-dock.svelte.ts");
const closePlans = `(async () => (await ${chatDockMod}).closeChatDock(false))()`;
const historyMod = importApp("app/run-history.svelte.ts");
const settingsMod = importApp("lib/settings.svelte.ts");


const plansMod = importApp("app/plans.svelte.ts");
const NOW = Date.now();
const plan = (over) => ({
  operationId: "op-x", command: "uptime", targets: ["s1"], cwd: null, validate: null,
  mode: "exec", strategy: "sequential", concurrency: 1, timeoutSeconds: 60,
  state: "awaitingApproval", createdAt: NOW, requestedAt: NOW, expiresAt: null,
  title: null, reason: null, idempotencyKey: null, ...over,
});
const PENDING = [
  plan({ operationId: "op-a", title: "디스크 사용량 확인", command: "df -h / /var", summary: "루트와 /var 의 남은 공간을 읽기만 합니다.", effect: "read" }),
  plan({ operationId: "op-b", title: "nginx 설정 검사", command: "nginx -t", targets: ["s1", "s2"] }),
];
await ev(`window.__ops = { pending: ${JSON.stringify(PENDING)}, recent: [] }; window.dispatchEvent(new Event('focus'))`);
await sleep(1200);

const dock = async () => JSON.parse(await ev(`(() => {
  const d = document.querySelector('[data-chat-dock]');
  const secs = [...document.querySelectorAll('[data-dock-section]')].map((b) => [b.dataset.dockSection, b.getAttribute('aria-pressed'), b.querySelector('.sec-badge')?.textContent.trim() ?? null, b.getAttribute('aria-label')]);
  const head = document.querySelector('[data-chat-dock] .head');
  const top = document.querySelector('[data-chat-dock-top]');
  return JSON.stringify({
    open: !!d?.classList.contains('open'),
    secs,
    head: !!head,
    chatHead: !!head?.querySelector('[data-chat-dock-list]'),
    newBtn: !!head?.querySelector('[data-chat-dock-new]'),
    pin: !!top?.querySelector('[data-chat-dock-pin]'),
    close: !!top?.querySelector('[data-chat-dock-close]'),
    plansBody: !document.querySelector('[data-chat-dock-plans]')?.hidden,
    chatBody: !document.querySelector('[data-chat-dock-body]')?.hidden,
  });
})()`));
const shown = async () => ev(`(async () => (await ${plansMod}).plansShown())()`);
const plansPanes = async () => ev(`(async () => { const w = await ${importApp("app/tabs.svelte.ts")}; const s = await ${importApp("lib/session.ts")}; return w.residentWindowTabs().flatMap((t) => s.listPanes(t.root)).filter((p) => p.kind === 'plans').length; })()`);

// ── ① 여는 길 = 채팅 독의 작업안 갈래(타일이 아니다) ──────────────────────────────
await ev(`(async () => (await ${plansMod}).openPlans())()`);
await sleep(900);
let D = await dock();
check("① openPlans → 채팅 독이 열리고 작업안 갈래", [D.open, D.secs.map((s) => [s[0], s[1]]), D.plansBody, D.chatBody], [true, [["chat", "false"], ["plans", "true"]], true, false]);
check("① 작업안 칸 배지 = 승인 대기 수 · aria-label 에 수", [D.secs[1][2], D.secs[1][3]], ["2", "작업안 · 승인 대기 2"]);
check("① 작업안 갈래 — 머리줄 없음 · 📌 ✕ 는 윗줄(갈래 옆)", [D.head, D.chatHead, D.newBtn, D.pin, D.close], [false, false, false, true, true]);
check("① plansShown · 탭 트리에 작업안 타일 없음", [await shown(), await plansPanes()], [true, 0]);
check("① 갈래 칸 — 독 폭 절반 · 알약 · 고른 칸 아래 알약(.sec-thumb) = --accent-soft",
  JSON.parse(await ev(`(() => { const g = document.querySelector('[data-chat-dock-sections]'); const d = document.querySelector('[data-chat-dock]'); const on = g.querySelector('.sec.on'); const toRgb = (v) => { const i = document.createElement('i'); i.style.color = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); document.body.appendChild(i); const c = getComputedStyle(i).color; i.remove(); return c; }; return JSON.stringify([Math.abs(g.getBoundingClientRect().width - d.getBoundingClientRect().width / 2) < 4, parseFloat(getComputedStyle(g).borderTopLeftRadius) >= 20, Math.round(on.getBoundingClientRect().height), (() => { const th = g.querySelector('.sec-thumb'); const a = th.getBoundingClientRect(), b = on.getBoundingClientRect(); return getComputedStyle(th).backgroundColor === toRgb('--accent-soft') && Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) < 3; })()]); })()`)),
  [true, true, 32, true]);
check("① 검토 카드는 물러난다", await ev(`document.querySelectorAll('.rcard').length`), 0);
await shot("dock-plans.png");

// ── ② 채팅 갈래 — 머리줄이 돌아오고 배지는 남는다 · 갈래가 저장된다 ─────────────────
await ev(`document.querySelector('[data-dock-section="chat"]').click()`);
// 누른 직후 — 알약이 아직 미끄러지는 중이고 채팅 몸통에 들어오는 움직임이 돈다
check("② 전환 움직임 — 알약 transform 전환 · 몸통 애니메이션",
  JSON.parse(await ev(`(() => { const th = document.querySelector('.sec-thumb'); const b = document.querySelector('[data-chat-dock-body]'); return JSON.stringify([getComputedStyle(th).transitionProperty.includes('transform'), b.getAnimations().length > 0]); })()`)),
  [true, true]);
await sleep(600);
check("② 알약이 채팅 칸 아래로 옮겨 갔다",
  await ev(`(() => { const a = document.querySelector('.sec-thumb').getBoundingClientRect(), b = document.querySelector('[data-dock-section="chat"]').getBoundingClientRect(); return Math.abs((a.left + a.right) / 2 - (b.left + b.right) / 2) < 3; })()`), true);
D = await dock();
check("② 채팅 갈래 — 고른 칸 · 몸통 · 제목 ▾ · + · 작업안 배지는 그대로", [D.secs.map((s) => s[1]), D.chatBody, D.plansBody, D.chatHead, D.newBtn, D.secs[1][2]], [["true", "false"], true, false, true, true, "2"]);
check("② 채팅 갈래면 plansShown 거짓", await shown(), false);
check("② 갈래는 독 저장소(`aynx:dock` 의 chatSection)에", await ev(`JSON.parse(localStorage.getItem('aynx:dock') ?? '{}').chatSection ?? null`), "chat");
await shot("dock-chat.png");

// ── ③ 토글 — open-plans 는 작업안이 보이면 닫고, 아니면 작업안 갈래로 · open-chat-dock 은 채팅 갈래로 ───────────
await ev(`(async () => (await ${plansMod}).togglePlans())()`);
await sleep(400);
D = await dock();
check("③ 채팅 갈래에서 togglePlans → 작업안 갈래(닫지 않음)", [D.open, D.secs[1][1]], [true, "true"]);
await ev(`(async () => (await ${plansMod}).togglePlans())()`);
await sleep(400);
check("③ 작업안이 보이면 togglePlans → 닫힘", (await dock()).open, false);
await ev(`(async () => (await ${chatDockMod}).toggleChatDock())()`);
await sleep(400);
D = await dock();
check("③ open-chat-dock → 채팅 갈래로 열림", [D.open, D.secs[0][1]], [true, "true"]);
await ev(`(async () => (await ${chatDockMod}).closeChatDock(false))()`);
await sleep(300);

// ── ④ 딥링크 — openPlansAt 은 작업안 갈래의 진행 보기로 · 그 카드 맥박 ──────────────────
await ev(`(async () => (await ${plansMod}).openPlansAt('op-b'))()`);
await sleep(3000);
D = await dock();
check("④ openPlansAt → 작업안 갈래 · 그 카드가 있다", [D.open, D.secs[1][1], await ev(`!!document.querySelector('[data-chat-dock-plans] [data-operation-id="op-b"]')`)], [true, "true", true]);
await ev(`(async () => (await ${chatDockMod}).closeChatDock(false))()`);
await sleep(300);

// ── ⑤ 폰(원격 · 390x844) — 전체 화면 덮개 · 넓은 두 칸 · 44 단추 · 휴대폰 '뒤로' = 닫기 ──────────────
await ev(`sessionStorage.setItem('aynx-h-remote', '1')`);
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.reload", { ignoreCache: true });
await sleep(4000);
const phoneReady = await ev(`!!document.querySelector('.mobile-bar')`);
check("⑤ 원격 폰 배치로 떴다(위 띠)", phoneReady, true);
if (phoneReady) {
  await ev(`window.__ops = { pending: ${JSON.stringify(PENDING)}, recent: [] }; window.dispatchEvent(new Event('focus'))`);
  await sleep(1200);
  await ev(`(async () => (await ${plansMod}).openPlans())()`);
  await sleep(900);
  const P = JSON.parse(await ev(`(() => { const m = document.querySelector('[data-mobile-plans]'); if (!m) return 'null'; const seg = m.querySelector('.seg'); const btns = [...seg.querySelectorAll('.seg-btn')].map((b) => Math.round(b.getBoundingClientRect().width)); const ap = [...m.querySelectorAll('li.op .obtns .btn')].map((b) => Math.round(b.getBoundingClientRect().height)); return JSON.stringify({ seg: Math.round(seg.getBoundingClientRect().width), btns, ap, title: m.querySelector('h2')?.textContent.trim(), dock: !!document.querySelector('[data-chat-dock]') }); })()`));
  console.log("PHONE", JSON.stringify(P));
  check("⑤ 폰 작업안 덮개 · 제목 · 독 없음", [P?.title, P?.dock], ["작업안", false]);
  check("⑤ 보기 탭 = 화면 폭 두 칸(반반)", P && P.seg > 330 && Math.abs(P.btns[0] - P.btns[1]) <= 2, true);
  check("⑤ 거절 · 승인 = 높이 44", P?.ap.length > 0 && P.ap.every((h) => h === 44), true);
  check("⑤ plansShown(폰 덮개)", await shown(), true);
  await shot("phone-plans.png");
  await ev(`history.back()`);
  await sleep(700);
  check("⑤ 휴대폰 '뒤로' → 덮개가 닫힌다", await ev(`!!document.querySelector('[data-mobile-plans]')`), false);
  // 시트의 작업안 줄 → 덮개(새 탭 아님)
  await ev(`(async () => (await ${importApp("app/mobile-sheets.svelte.ts")}).openMobileSheet())()`);
  await sleep(600);
  await ev(`document.querySelector('[data-sheet="plans"]').click()`);
  await sleep(800);
  check("⑤ 시트의 작업안 줄 → 폰 작업안 덮개", await ev(`!!document.querySelector('[data-mobile-plans]')`), true);
  await ev(`history.back()`);
  await sleep(500);
}

// ── ⑥ 원격 데스크톱 폭 — 채팅 독의 작업안 갈래(주 창과 같다 · 2026-11-13) ─────────────
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(4000);
await ev(`(async () => (await ${plansMod}).openPlans())()`);
await sleep(900);
// 2026-11-13 — 원격 데스크톱 폭도 채팅 독의 작업안 갈래로 연다(예전엔 타일을 가리는 판 `PlansCover` — 걷음)
check("⑥ 원격 데스크톱 — 독의 작업안 갈래가 선다 · 덮는 판 없음",
  JSON.parse(await ev(`JSON.stringify([!!document.querySelector('[data-chat-dock-plans]:not([hidden]) [data-plans-view]'), !!document.querySelector('[data-plans-cover]')])`)),
  [true, false]);
await shot("remote-plans-dock.png");
await ev(`sessionStorage.removeItem('aynx-h-remote')`);

if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑦ 잡히지 않은 예외·콘솔 오류 0", errors.length, 0);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
