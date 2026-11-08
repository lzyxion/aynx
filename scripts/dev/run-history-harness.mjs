// 헤드리스 검증 — **작업안 실행 기록** (채팅 독의 작업안 갈래 › 기록 — 한 줄 목록 + 그 자리 펼침)
// (docs/log/2026-09-28-run-history.md).
//
// `run-notify-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다. 먹이는 칸:
// `window.__auditRuns`(= `audit_runs` — 스텁이 `sinceMs`·`limit` 으로 자른다) · `window.__auditFail`
// (참이면 `audit_runs` 가 거부된다) · `window.__ops`(= `list_operations`) · `window.__results[id]`.
// 데이터는 목업 안 A 와 같은 줄들(오늘 셋 · 어제 넷 · 그저께 다섯 · 20일 전 하나)이고 시각은 **지금**
// 기준으로 만든다(화면이 로컬 날짜로 묶으므로).
//
// 시나리오: ① 보기 단추 둘(진행 · 기록 — 비교 · 행렬은 2026-10-25 에 걷었다) · 감사 알약(머리 줄 오른쪽 · 바닥 띠 없음) ·
// ② 하루 묶음(오늘 · 어제 · 접힌 그저께) · 아코디언(펼친 줄 바로 아래 상세 하나 · 다시 누르면 접힘) · ③ 요약(상자 없이 —
// 실행 · 실패 포함 · 대상 실행 · 수동/자동 비율) · ④ 거르기 다섯(기간 30일 · 호스트 · 결과 · 승인 · 검색 — 걸린 칩은 채움) ·
// ⑤ 상세 — 발췌 있음(대상 표 실패 먼저 · canary · exit · 시간 · stderr 덩어리) · ⑥ 상세 — 발췌 없음
// (끔 → "출력은 저장하지 않았습니다 · 설정에서…" + 설정 줄로 · 켬 → "저장된 출력이 없습니다") ·
// ⑦ canary 멈춤 · canary 검증 멈춤 문구(목록 줄 = 결과 알림 문구) · ⑧ 키보드 ↑↓ · End ·
// ⑫ [결과 보기](메모리에 없는 실행) → 기록의 그 실행, 메모리에 있으면 그대로 진행 보기 · ⑬ 빈 상태 · 읽기 실패 ·
// ⑭ 콘솔 오류 0 · ⑮ 좁은 독(기본 380px)에서 목록이 가로로 넘치지 않고 제목 칸이 넉넉하다 · ⑯ 제목 없는 긴
// 한 줄 명령(명령 한 번 · 같은 줄 높이) · 25ms = `0.1초 미만`.
//
// usage (격리 서버 — 1420/9222 는 개발 앱의 것이라 건드리지 않는다):
//   npx vite --port 1441 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9273 --user-data-dir=%TEMP%/edge-aynx-runhistory \
//     --window-size=1280,860 http://localhost:1441/
//   PAGE_PORT=1441 node scripts/dev/run-history-harness.mjs <outdir> 9273
//     → <outdir>/run-history-list.png · -filtered.png · -optin.png · -canary.png · -collapsed.png ·
//       -empty.png · -narrow.png · polish-untitled.png
//   (또는 러너: node scripts/dev/run-harness.mjs run-history-harness.mjs <outdir> --size 1400x900)
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

const clean = (s) => (s ?? "").replace(/\s+/g, " ").trim();
const view = async () => JSON.parse(await ev(`(async () => { const c = await ${consoleMod}; return JSON.stringify([c.plansShown(), "operations", c.plansView()]); })()`));
/** 목록 — 날짜 머리와 줄들 */
const readList = async () =>
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-run-history] .daygroup')].map((g) => ({
    day: g.querySelector('.day').textContent.replace(/\\s+/g, ' ').trim(),
    open: g.querySelector('.day').getAttribute('aria-expanded') === 'true',
    rows: [...g.querySelectorAll('[data-run-id]')].map((b) => ({
      id: b.dataset.runId,
      time: b.querySelector('.time').textContent.trim(),
      mark: b.querySelector('.mark').textContent.trim(),
      head: b.querySelector('.what .h')?.textContent.trim() ?? null,
      cmd: b.querySelector('.what .c')?.textContent.trim() ?? null,
      cmds: b.querySelectorAll('.what .c').length,
      height: b.getBoundingClientRect().height - parseFloat(getComputedStyle(b).borderTopWidth),
      hosts: b.querySelector('.hosts').textContent.trim(),
      result: b.querySelector('.res .lead').textContent.trim(),
      tone: ['good', 'bad', 'plain'].find((k) => b.querySelector('.res .lead').classList.contains(k)),
      sub: b.querySelector('.res .sub')?.textContent.trim() ?? null,
      how: b.querySelector('.how').textContent.trim(),
      sel: b.classList.contains('sel'),
      expanded: b.getAttribute('aria-expanded') === 'true',
    })),
  })))`));
const readSummary = async () =>
  JSON.parse(await ev(`JSON.stringify(Object.fromEntries([...document.querySelectorAll('[data-history-summary] [data-stat]')].map((e) => [e.dataset.stat, e.textContent.replace(/\\s+/g, ' ').trim()])))`));
const barWidths = async () =>
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-history-summary] .bar span')].map((s) => s.style.flexBasis))`));
const readDetail = async () =>
  JSON.parse(await ev(`(() => { const d = document.querySelector('[data-history-detail]'); if (!d) return 'null'; return JSON.stringify({
    id: d.dataset.historyDetail,
    after: d.previousElementSibling?.dataset.runId ?? null,
    meta: [...d.querySelectorAll('.dhead .meta span')].map((s) => s.textContent.trim()),
    result: d.querySelector('[data-detail-result]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null,
    cmd: d.querySelector('pre.cmd').textContent,
    extra: [...d.querySelectorAll(':scope > .meta span')].map((s) => s.textContent.trim()),
    targets: [...d.querySelectorAll('.tgt tr')].map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.replace(/\\s+/g, ' ').trim())),
    excerpt: d.querySelector('[data-excerpt]') ? [...d.querySelectorAll('[data-excerpt] .ohead')].map((h) => h.textContent.trim()) : null,
    excerptText: d.querySelector('[data-excerpt] .otext')?.textContent ?? null,
    optin: d.querySelector('[data-optin]') ? [d.querySelector('[data-optin]').dataset.optin, d.querySelector('[data-optin]').textContent.replace(/\\s+/g, ' ').trim()] : null,
  }); })()`));
/** 그 줄을 **편다** — 이미 펼친 줄을 누르면 접히므로(아코디언) 접혀 있을 때만 누른다 */
const clickRow = async (id) => {
  await ev(`(() => { const b = document.querySelector('[data-run-id="${id}"]'); if (b.getAttribute('aria-expanded') !== 'true') b.click(); })()`);
  await sleep(250);
};
// 거르기 고르개는 앱의 `Dropdown`(2026-10-18 — 네이티브 select 대신): 손잡이를 눌러 펴고 그 값의 줄(`data-value`)을 누른다
const setSelect = async (name, value) => {
  await ev(`document.querySelector('[data-filter="${name}"] [role="combobox"]').click()`);
  await sleep(80);
  await ev(`document.querySelector('[data-filter="${name}"] [role="option"][data-value=${JSON.stringify(JSON.stringify(value)).slice(1, -1)}]').click()`);
  await sleep(450);
};
const setQuery = async (q) => {
  await ev(`(() => { const s = document.querySelector('[data-filter="query"]'); s.value = ${JSON.stringify(q)}; s.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(300);
};
const listIds = async () => (await readList()).flatMap((g) => g.rows.map((x) => x.id));
const within = (days) => RUNS.filter((x) => x.approvedAt >= new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1)).getTime());

// ── ① 보기 단추 · 기록 보기로 ───────────────────────────────────────────────
await ev(`(async () => (await ${consoleMod}).openPlans())()`);
await sleep(600);
check("① 작업안 칸의 보기 단추 둘 — 진행 · 기록 (비교 · 행렬 없음)",
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-ops-view]')].map((b) => [b.dataset.opsView, b.textContent.trim()]))`)),
  [["list", "진행"], ["history", "기록"]]);
check("① 보기 단추는 알약 묶음 — 고른 것 = secondaryContainer(`--accent-soft`) 판 · 알약 반지름",
  JSON.parse(await ev(`(() => { const on = document.querySelector('[data-ops-view="list"]'); const toRgb = (v) => { const d = document.createElement('i'); d.style.color = getComputedStyle(document.documentElement).getPropertyValue(v).trim(); document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; }; return JSON.stringify([getComputedStyle(on).backgroundColor === toRgb('--accent-soft'), parseFloat(getComputedStyle(on).borderTopLeftRadius) >= 14, parseFloat(getComputedStyle(on.parentElement).borderTopLeftRadius) >= 14]); })()`)),
  [true, true, true]);
check("① 감사 알약 — 머리 줄 오른쪽 · 점 + '감사 13' · title 에 폴더 · 바닥 띠 없음",
  JSON.parse(await ev(`(() => { const a = document.querySelector('[data-audit-pill]'); const head = document.querySelector('[data-plans-view] .ops-head'); const seg = head?.querySelector('.seg'); return JSON.stringify(a ? [head.contains(a), a.getBoundingClientRect().left > seg.getBoundingClientRect().right, a.textContent.trim(), a.title.includes('aynx-dev/audit'), !!a.querySelector('.audit-dot.ok'), document.querySelectorAll('[data-plans-view] > .audit').length] : null); })()`)),
  [true, true, "감사 13", true, true, 0]);
await ev(`document.querySelector('[data-ops-view="history"]').click()`);
await sleep(900);
check("① 기록 보기가 선다", await view(), [true, "operations", "history"]);
check("① 기간 7일로 읽는다(sinceMs = 엿새 전 자정 · limit 5000)",
  JSON.parse(await ev(`JSON.stringify(window.__calls.filter(([c]) => c === 'audit_runs').at(-1)[1])`)),
  { sinceMs: new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6).getTime(), limit: 5000 });

// ── ② 하루 묶음 ──────────────────────────────────────────────────────────────
const L = await readList();
const dateOf = (daysAgo) => new Intl.DateTimeFormat("ko", { month: "long", day: "numeric", weekday: "short" }).format(new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo));
check("② 날짜 머리 — 오늘 · 어제 · (접힌) 그저께",
  L.map((g) => [g.day, g.open]),
  [[`오늘 · ${dateOf(0)}`, true], [`어제 · ${dateOf(1)}`, true], [`${dateOf(2)} · 5건 더 ▾`, false]]);
check("② 오늘 줄 — 시각 · 표식 · 제목(명령은 펼친 상세에) · 대상 · 결과 · 승인",
  L[0].rows.map((x) => [x.time, x.mark, x.head, x.cmd, x.hosts, x.result, x.tone, x.sub, x.how]),
  [
    ["14:32", "!", "nginx 설정 재적용", null, "web-01 · web-02 · web-03", "일부 실패 2/3", "bad", "실패: web-02", "수동"],
    ["14:05", "✓", "로그 정리", null, "web-01 외 4", "성공 5/5", "good", null, "자동"],
    ["09:12", "✓", "디스크 사용량 확인", null, "web-01 · web-02 · db-01", "성공 3/3", "good", null, "자동"],
  ]);
check("② 어제 줄 — canary 멈춤 · 취소 · 끝난 기록 없음",
  L[1].rows.map((x) => [x.id, x.mark, x.result, x.sub]),
  [
    ["op-tmp", "!", "canary 실패로 멈춤", "web-01 exit 1"],
    ["op-apt", "✓", "성공 5/5", null],
    ["op-rollback", "■", "취소됨", "성공 1/4 뒤 멈춤"],
    ["op-open", "·", "끝난 기록 없음", null],
  ]);
check("② 처음엔 가장 최근 실행이 펼쳐진다 — 그 줄 바로 아래 상세 하나",
  [L[0].rows[0].sel, L[0].rows[0].expanded, (await readDetail())?.id, (await readDetail())?.after, await ev(`document.querySelectorAll('[data-history-detail]').length`)],
  [true, true, "op-nginx", "op-nginx", 1]);

// ── ③ 요약 띠 ────────────────────────────────────────────────────────────────
const w7 = within(7);
const auto7 = w7.filter((x) => x.approvalMethod === "auto").length;
check("③ 요약 — 실행 · 실패 포함 · 대상 실행 · 수동/자동", await readSummary(), {
  runs: `${w7.length}건`, failed: "4건", targets: "35회", ratio: `수동 ${w7.length - auto7} · 자동 ${auto7}`,
});
const manPct = Math.round(((w7.length - auto7) / w7.length) * 100);
check("③ 비율 막대 폭", await barWidths(), [`${manPct}%`, `${100 - manPct}%`]);
check("③ 막대는 무채(강조색 아님)",
  await ev(`(() => { const s = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(); const toRgb = (c) => { const d = document.createElement('i'); d.style.color = c; document.body.appendChild(d); const v = getComputedStyle(d).color; d.remove(); return v; }; const acc = toRgb(s); return [...document.querySelectorAll('[data-history-summary] .bar span')].every((b) => getComputedStyle(b).backgroundColor !== acc); })()`),
  true);
await shot("run-history-list.png");

// ── ⑤ 상세 — 발췌 있음 ──────────────────────────────────────────────────────
const D = await readDetail();
check("⑤ 상세 메타 칩 — 수동 승인 · 걸린 시간 · id", D.meta.slice(1), ["수동 승인", "4.5초", "op-nginx"]);
check("⑤ 결과 한 줄 = 알림 문구", D.result, "일부 실패 2/3 · 실패: web-02");
check("⑤ 명령 전문 · 경로 · 검증", [D.cmd, D.extra], ["nginx -t && systemctl reload nginx", ["경로 /etc/nginx", "검증: curl -fsS 127.0.0.1/healthz"]]);
check("⑤ 대상 표 — 실패 줄 먼저 · canary 표시 · 상태 · exit · 시간", D.targets, [
  ["web-02", "실패", "exit 1 · 1.4초"],
  ["web-01canary", "성공", "exit 0 · 2.1초"],
  ["web-03", "성공", "exit 0 · 2.3초"],
]);
// 펼친 줄을 다시 누르면 접히고(상세 없음 · 가장 최근 것을 저절로 다시 펴지 않는다), 또 누르면 다시 편다
await ev(`document.querySelector('[data-run-id="op-nginx"]').click()`);
await sleep(300);
check("⑤ 펼친 줄을 다시 누르면 접힌다(저절로 다시 펴지 않음)",
  [await ev(`document.querySelectorAll('[data-history-detail]').length`), await ev(`document.querySelector('[data-run-id="op-nginx"]').getAttribute('aria-expanded')`)], [0, "false"]);
await shot("run-history-collapsed.png");
await clickRow("op-nginx");
check("⑤ 다시 누르면 다시 편다", (await readDetail())?.id, "op-nginx");
check("⑤ 출력 발췌 — web-02 stderr", [D.excerpt, D.excerptText?.split("\n")[0]], [["web-02 stderr"], 'nginx: [emerg] unknown directive "gzip_statik"']);
check("⑤ 발췌가 있으면 옵트인 줄은 없다", D.optin, null);

// ── ⑦ canary 검증 멈춤 (그저께 묶음을 펴서) · canary 멈춤 상세 ─────────────────────
await ev(`document.querySelector('[data-day] + *') ; [...document.querySelectorAll('[data-run-history] .day')].at(-1).click()`);
await sleep(300);
const L2 = await readList();
check("⑦ 접힌 날을 펴면 다섯 줄", [L2[2].open, L2[2].rows.length], [true, 5]);
check("⑦ canary 검증 실패로 멈춤 — 목록 줄", L2[2].rows.find((x) => x.id === "op-validate") && [L2[2].rows.find((x) => x.id === "op-validate").result, L2[2].rows.find((x) => x.id === "op-validate").sub],
  ["canary 검증 실패로 멈춤", "web-01"]);
check("⑦ 제목 없는 실행은 제목 자리 없이 명령 첫 줄 한 번(2026-09-28)",
  (({ head, cmd, cmds } = {}) => [head, cmd, cmds])(L2[2].rows.find((x) => x.id === "op-kernel")), [null, "uname -a", 1]);
await clickRow("op-tmp");
const C = await readDetail();
check("⑦ canary 멈춤 상세 — 결과 줄 · 대상 표", [C.result, C.targets], [
  "canary 실패로 멈춤 · web-01 exit 1 · 나머지 2곳은 실행 안 함",
  [["web-01canary", "실패", "exit 1 · 2.0초"], ["web-02", "취소", ""], ["web-03", "취소", ""]],
]);
await shot("run-history-canary.png");

// ── ⑥ 상세 — 발췌 없음 (설정 끔 → 켬) ─────────────────────────────────────────
await clickRow("op-disk");
check("⑥ 발췌 없음 · 설정 끔 — 한 줄 + 설정 링크", (await readDetail()).optin, ["off", "출력은 저장하지 않았습니다 · 설정에서 켤 수 있습니다"]);
await shot("run-history-optin.png");
await ev(`[...document.querySelectorAll('[data-optin="off"] button')][0].click()`);
await sleep(900);
check("⑥ 링크 → 설정 독의 그 줄(출력 발췌 토글)이 선다",
  await ev(`(() => { const el = document.getElementById('audit-output-excerpt'); if (!el) return 'missing'; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; })()`), true);
// 설명은 ⓘ 팝오버가 아니라 이름에 얹는 툴팁이다(`TipName` — 이름의 title · aria-describedby 로 잇는 설명 칸).
// 긴 사실(40줄 · 4 KB · 경로)은 docs/user/settings.md 로 갔고, 툴팁은 사전의 짧은 설명을 그대로 든다.
check("⑥ 설정 줄 이름의 툴팁이 사전의 짧은 발췌 설명을 든다 (ⓘ 없음)",
  await ev(`(async () => {
    const want = (await import('/src/lib/i18n/ko/settings.ts')).settings['automation.excerpt.note'];
    const name = document.getElementById('audit-output-excerpt-label');
    if (!name) return 'no-name';
    const desc = document.getElementById(name.getAttribute('aria-describedby') ?? '');
    return [name.getAttribute('for'), (name.getAttribute('title') ?? name.getAttribute('data-tip') ?? '').includes(want), !!desc && desc.textContent.includes(want),
      !document.querySelector('button[aria-controls="audit-output-excerpt-note"]')];
  })()`),
  ["audit-output-excerpt", true, true, true]);
await ev(`(async () => (await ${importApp("app/dock.svelte.ts")}).closeDock(false))()`);
await sleep(400);
await ev(`(async () => (await ${settingsMod}).setAuditOutputExcerpt(true))()`);
await sleep(300);
check("⑥ 설정 켬 — 발췌가 없는 실행은 그 사유 한 줄", (await readDetail()).optin?.[0], "none");
await ev(`(async () => (await ${settingsMod}).setAuditOutputExcerpt(false))()`);

// ── ⑧ 키보드 ↑↓ ─────────────────────────────────────────────────────────────
await clickRow("op-nginx");
await ev(`document.querySelector('[data-run-id="op-nginx"]').focus()`);
await key("ArrowDown", "ArrowDown", 40);
await key("ArrowDown", "ArrowDown", 40);
check("⑧ ↓↓ — 고름과 포커스가 함께 내려간다", [(await readDetail()).id, await ev(`document.activeElement?.dataset?.runId ?? null`)], ["op-disk", "op-disk"]);
await key("ArrowUp", "ArrowUp", 38);
check("⑧ ↑ — 한 줄 위", (await readDetail()).id, "op-logs");
await key("End", "End", 35);
check("⑧ End — 펼쳐진 마지막 줄", (await readDetail()).id, "op-restart");

// ── ④ 거르기 ─────────────────────────────────────────────────────────────────
await setSelect("result", "bad");
check("④ 결과 = 실패 포함", await listIds(), ["op-nginx", "op-tmp", "op-validate", "op-restart"]);
check("④ 걸린 칩만 채움 — 기간(늘) · 결과",
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-run-history] .filters .f')].map((f) => f.classList.contains('set')))`)),
  [true, false, true, false]);
check("④ 요약도 거른 것의 수", (await readSummary()).runs, "4건");
await setSelect("result", "cancelled");
check("④ 결과 = 취소", await listIds(), ["op-rollback"]);
await setSelect("result", "ok");
check("④ 결과 = 성공 (같은 날 안에서 최신순)", await listIds(), ["op-logs", "op-disk", "op-apt", "op-cert", "op-kernel", "op-disk2"]);
await setSelect("result", "all");
await setSelect("approval", "auto");
check("④ 승인 = 자동", (await listIds()).length, auto7);
await setSelect("approval", "manual");
check("④ 승인 = 수동", await listIds(), ["op-nginx", "op-tmp", "op-rollback", "op-open", "op-validate", "op-restart"]);
await setSelect("approval", "all");
check("④ 호스트 후보 — 스냅샷 이름(가나다순)",
  JSON.parse(await ev(`(async () => { document.querySelector('[data-filter="host"] [role="combobox"]').click(); await new Promise((r) => setTimeout(r, 80)); const out = [...document.querySelectorAll('[data-filter="host"] [role="option"]')].map((o) => o.textContent.trim()); document.querySelector('[data-filter="host"] .menu-backdrop')?.click(); await new Promise((r) => setTimeout(r, 80)); return JSON.stringify(out); })()`)),
  ["전체", "db-01", "dev-01", "web-01", "web-02", "web-03"]);
await setSelect("host", "db-01");
check("④ 호스트 = db-01", await listIds(), ["op-logs", "op-disk", "op-apt", "op-rollback", "op-cert", "op-kernel", "op-disk2", "op-restart"]);
await setSelect("host", "");
await setQuery("NGINX");
check("④ 검색 — 제목·명령, 대소문자 무시", await listIds(), ["op-nginx"]);
await setQuery("zzz-없음");
check("④ 맞는 실행이 없으면 그 한 줄", await ev(`document.querySelector('[data-history-state]')?.dataset.historyState ?? null`), "filtered");
await setQuery("");
await setSelect("period", "30");
check("④ 기간 30일 — 20일 전 실행까지 읽는다(그 날은 접혀 선다)",
  [(await readSummary()).runs, (await readList()).at(-1).day.endsWith("1건 더 ▾")], [`${RUNS.length}건`, true]);
await setQuery("인증서");
await shot("run-history-filtered.png");
await setQuery("");

// ── ⑫ [결과 보기] — 메모리에 없는 실행은 기록으로, 있으면 진행 보기 그대로 ─────────
await ev(closePlans);
await sleep(300);
await ev(`(async () => (await ${consoleMod}).openPlansAt('op-rollback'))()`);
await sleep(600);
await sleep(3200); // 폴링 한 바퀴(2초) + 여유
check("⑫ 메모리에 없다 → 기록 보기의 그 실행", [(await view())[2], (await readDetail())?.id], ["history", "op-rollback"]);
// 메모리에 있는 실행 — 진행 보기에 남고 그 카드에 맥박
await ev(`(() => {
  const op = { operationId: 'op-live', command: 'uptime', targets: ['s1'], cwd: null, validate: null, mode: 'exec', strategy: 'sequential', concurrency: 1, timeoutSeconds: 60, state: 'succeeded', createdAt: Date.now(), requestedAt: Date.now(), expiresAt: null, title: '지금 돈 실행', reason: null, idempotencyKey: null, approvalMethod: 'manual' };
  window.__ops = { pending: [], recent: [op] };
  window.__results['op-live'] = { s1: { state: 'succeeded', exitCode: 0, stdout: '', stderr: '', startedAt: 1, endedAt: 2, errorClass: null } };
})()`);
await ev(closePlans);
await sleep(300);
await ev(`(async () => (await ${consoleMod}).openPlansAt('op-live'))()`);
await sleep(3200);
check("⑫ 메모리에 있다 → 진행 보기에 머물고 그 실행 카드가 맥박",
  [(await view())[2], await ev(`!!document.querySelector('[data-operation-id="op-live"]')`)], ["list", true]);
// 완료된 실행은 한 줄로 접힌다(2026-10-27 A안) — 제목 · 상태 · 결과 줄 없음 → 줄을 누르면 결과 줄이 펼쳐진다
const liveRow = `(() => { const li = document.querySelector('li[data-exec-row][data-operation-id="op-live"]'); return JSON.stringify(li ? [li.querySelector('.rtitle')?.textContent.trim(), li.querySelector('[data-exec-state]')?.textContent.replace(/\\s+/g, ' ').trim(), li.querySelectorAll('.mrow').length, li.querySelector('.rtoggle')?.getAttribute('aria-expanded')] : null); })()`;
check("⑫ 완료된 실행 — 한 줄(제목 · 상태) · 접힘", JSON.parse(await ev(liveRow)), ["지금 돈 실행", "전체 성공", 0, "false"]);
await ev(`document.querySelector('li[data-exec-row][data-operation-id="op-live"] .rtoggle').click()`);
await sleep(200);
check("⑫ 줄을 누르면 결과 줄이 펼쳐진다", JSON.parse(await ev(liveRow)), ["지금 돈 실행", "전체 성공", 1, "true"]);
await shot("plans-exec.png");
// ── ⑮ 좁은 독(채팅 독 기본 380px — 작업안 갈래)에서 기록 목록이 가로로 넘치지 않고 제목 칸이 넉넉하다
// (2026-10-25 — 예전 두 칸(목록 | 상세)은 이 폭에서 목록이 "we…" 로 잘렸다) ─────────────
{
  await ev(`window.__auditRuns = ${JSON.stringify(RUNS)}`);
  await ev(`document.querySelector('[data-ops-view="history"]').click()`);
  await sleep(900);
  const geo = JSON.parse(await ev(`(() => { const b = document.querySelector('[data-plans-view] > .body'); const w = document.querySelector('[data-plans-view]').getBoundingClientRect().width; const what = document.querySelector('[data-run-history] .item .what'); return JSON.stringify({ tileW: Math.round(w), viewW: window.innerWidth, bodyOver: b.scrollWidth > b.clientWidth, whatW: Math.round(what.getBoundingClientRect().width) }); })()`));
  console.log(`     narrow: ${JSON.stringify(geo)}`);
  check("⑮ 작업안(독)은 창의 절반이 안 된다", geo.tileW < geo.viewW / 2, true);
  check("⑮ 본문은 가로로 넘치지 않는다", geo.bodyOver, false);
  check("⑮ 줄의 제목 칸이 넉넉하다(≥ 150px)", geo.whatW >= 150, true);
  await shot("run-history-narrow.png");
}

// ── ⑬ 빈 상태 · 읽기 실패 ───────────────────────────────────────────────────
await ev(`(async () => { const h = await ${historyMod}; h.setHistoryPeriod(7); })()`);
await ev(`window.__auditRuns = []`);
// 기록 보기가 이미 서 있으면(⑮) 다시 읽지 않는다 — 진행에 다녀와 새로 마운트한다
await ev(`document.querySelector('[data-ops-view="list"]').click()`);
await sleep(200);
await ev(`document.querySelector('[data-ops-view="history"]').click()`);
await sleep(700);
check("⑬ 빈 상태", [await ev(`document.querySelector('[data-history-state]')?.dataset.historyState ?? null`), clean(await ev(`document.querySelector('[data-history-state]')?.textContent`))],
  ["empty", "최근 7일 동안 실행된 작업안이 없습니다"]);
check("⑬ 빈 상태에도 요약 띠는 0", (await readSummary()).runs, "0건");
await shot("run-history-empty.png");
await ev(`window.__auditFail = true`);
await ev(`document.querySelector('[data-ops-view="list"]').click()`);
await sleep(200);
await ev(`document.querySelector('[data-ops-view="history"]').click()`);
await sleep(600);
check("⑬ 읽기 실패 — 문구 + [다시 읽기]", clean(await ev(`document.querySelector('[data-history-state="error"]')?.textContent`)), "감사 로그를 읽지 못했습니다. 다시 읽기");
await ev(`window.__auditFail = false; window.__auditRuns = ${JSON.stringify(RUNS.slice(0, 2))}`);
await ev(`document.querySelector('[data-history-state="error"] button').click()`);
await sleep(600);
check("⑬ [다시 읽기] → 목록", await listIds(), ["op-nginx", "op-logs"]);

// ── ⑯ 제목 없는 긴 한 줄 명령 · 25ms 실행 (2026-09-28 실기 다듬기) ──────────────────
// 실기의 AI 작업안 대부분은 제목이 없고 명령이 긴 한 줄이다 — 목록 줄은 명령을 **한 번만**(mono 한 줄),
// 상세 머리는 **한 줄**(말줄임, mono), 줄 높이는 제목 있는 줄과 같다. 25ms 는 `0.1초 미만`.
const LONG = "head -1 ~/.aynx/integration.sh; tmux new-session -d -s aynxchk -x 120 -y 20 'bash --rcfile ~/.aynx/integration.sh -i' && sleep 1 && tmux send-keys -t aynxchk 'echo MARK; printf \"%s\\n\" \"$PS1\" | od -c | head -20' Enter && sleep 1 && tmux capture-pane -p -t aynxchk | tail -20; tmux kill-session -t aynxchk";
const UNTITLED = [
  run({
    operationId: "op-untitled", title: null, command: LONG, targets: ["s5"], targetLabels: labels(["s5"]),
    approvalMethod: "auto", approvedAt: at(0, 15, 10), results: [r("s5", "succeeded", { startedAt: 5_000, endedAt: 5_025 })],
  }),
  RUNS[0],
];
await ev(`window.__auditRuns = ${JSON.stringify(UNTITLED)}`);
await ev(`document.querySelector('[data-ops-view="list"]').click()`);
await sleep(200);
await ev(`document.querySelector('[data-ops-view="history"]').click()`);
await sleep(700);
const U = (await readList())[0].rows;
check("⑯ 제목 없는 줄 — 명령 한 번(제목 자리 없음) · 제목 있는 줄은 제목만(명령은 펼친 상세에)",
  U.map((x) => [x.id, x.head, x.cmds, x.cmd?.slice(0, 22) ?? null]),
  [["op-untitled", null, 1, LONG.slice(0, 22)], ["op-nginx", "nginx 설정 재적용", 0, null]]);
check("⑯ 줄 높이 — 제목 있는 줄과 같다", [U[0].height, U[0].height === U[1].height], [U[1].height, true]);
check("⑯ 명령 한 줄은 말줄임(넘친다 · 한 줄 높이)",
  JSON.parse(await ev(`(() => { const c = document.querySelector('[data-run-id="op-untitled"] .what .c'); const cs = getComputedStyle(c); return JSON.stringify([c.scrollWidth > c.clientWidth, cs.textOverflow, cs.whiteSpace, cs.fontFamily.toLowerCase().includes('mono')]); })()`)),
  [true, "ellipsis", "nowrap", true]);
await clickRow("op-untitled");
const UD = await readDetail();
check("⑯ 명령 전문 판은 그대로", UD.cmd, LONG);
check("⑯ 25ms — `0.1초 미만` (머리 meta · 대상 표)",
  [UD.meta.includes("0.1초 미만"), UD.targets.some((row) => row.some((cell) => cell.endsWith("0.1초 미만")))], [true, true]);
await shot("polish-untitled.png");
// ── ⑭ 오류 0 ─────────────────────────────────────────────────────────────────
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑭ 잡히지 않은 예외·콘솔 오류 0", errors.length, 0);

console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
