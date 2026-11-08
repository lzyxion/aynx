// 헤드리스 검증 — 상태바 **후미 전역 신호**(알림 알약 — ⚡ 자동 승인 · 🔔 알림 · 2026-10-24 End-4 알약)
// (docs/log/2026-09-21-statusbar-signals.md · docs/log/2026-10-05-statusbar-trim.md — ✦ AI 연결 ·
// ▶ 실행 중은 2026-10-05 에 상태바에서 뺐다. 이 하네스는 둘이 **없음**도 본다).
//
// `console-hosts-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다. 대시보드는 한 번만
// 연다(옆 기둥을 덮지 않는가 — 2026-09-25). 나머지는 **띠만** 본다: 신호가 전부 켜진 상태를 한 번 찍고(툴팁까지),
// 그 다음 스텁을 뒤집어 **전부 사라지는지**를 본다. 조건부 규칙("꺼져 있으면 글리프가 아예 없다")이 이
// 기능의 전부이므로, 켜진 모습 하나만으로는 검증이 절반이다.
//
// 뒤집은 뒤의 재조회는 **창 포커스** 한 길로 깨운다(`boot` 의 볼트 재조회).
// 자동 승인만은 `settings.automationPrefs` 를 그대로 읽으므로 설정을 다시 읽혀야 한다.
//
// usage:
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 \
//     http://localhost:1420/
//   node scripts/dev/status-signals-harness.mjs out-prefix
//     → <prefix>-status-signals.png (아래 가로 띠) · <prefix>-status-signals-vertical.png (왼쪽 기둥)
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
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

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => {
    const ids = evts.get(name) ?? [];
    for (const id of ids) cbs.get(id)?.({ event: name, id, payload });
    return ids.length;
  };
  let nextSession = 100;
  // 테스트가 갈아 끼우는 칸 — 신호가 각각 하나씩 읽는다. 도는 작업안·MCP 활동은 신호가 없음을 보려고 켜 둔다.
  window.__activity = { client: 'claude', atMs: Date.now() - 5000 };   // mcp_activity (옛 ✦ — 이제 아무도 안 읽는다)
  window.__ops = { pending: [], recent: [] };                          // list_operations (옛 ▶)
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: true } }; // (⚡)
  window.__vault = { state: 'unlocked', hasMaster: false, entryCount: 2 };  // vault_status (🔒)
  const host = (name, over) => ({ name, host_name: name + '.internal', user: 'deploy', port: 22, ...over });
  const answers = {
    list_hosts: { hosts: [host('web-01', { meta: { color: '#4a90d9', tags: [], forwards: [] } })], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    vault_list: [], vault_lock: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'open_ssh_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, tmux: null }); }
      if (cmd === 'mcp_activity') return Promise.resolve(window.__activity);
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
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
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });

// 도는 작업안 하나 — 옛 `▶` 가 세던 것. 이제 상태바에 아무것도 서지 않아야 한다. 검토 대기는 **두지 않는다**:
// 대시보드 칸의 대기 배지(`console-hosts-harness.mjs` 가 보는 것)와 이 신호를 갈라 두려는 것이다.
const NOW = Date.now();
const OPS_ON = {
  pending: [],
  recent: [{ operationId: "op-1", state: "running", command: "npm test", targets: ["delegated:bastion"],
             cwd: null, validate: null, mode: "exec", strategy: "sequential", concurrency: 1,
             timeoutSeconds: 60, createdAt: NOW, requestedAt: null, expiresAt: null,
             title: null, reason: null, idempotencyKey: null }],
};
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__opsOn = ${JSON.stringify(OPS_ON)};`,
});
await send("Page.reload", { ignoreCache: true });
await sleep(1200);
await ev(`window.__ops = window.__opsOn`);
await sleep(3800);

// 도장은 **깨우기 직전에** 다시 찍는다 — "연결됨" 판정(60초 창)이 읽은 시각 기준이라, 주입
// 시점에 박아 두면 부팅을 기다리는 동안 저 혼자 늙는다.
await ev(`window.__activity = { client: 'claude', atMs: Date.now() - 5000 }`);
// 표를 리로드 **뒤에** 심었으니 한 번 깨운다 (포커스 = 셋의 공통 재조회 길).
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(900);

// ── 1. 넷이 전부 켜진 모습 ────────────────────────────────────────────────────
//
// 신호는 선두단과 달리 `data-status-id` 가 없다(끌어 옮기는 순서에 들지 않는다 —
// `status-order.svelte.ts` 는 손대지 않았다). 대신 뜻 하나에 `data-signal` 한 값이 붙는다.
const readSignals = async () =>
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.statusbar .signals [data-signal]')].map((g) => ({
    id: g.dataset.signal,
    tip: g.getAttribute('title') || '',
    badge: (g.querySelector('.seg-badge')?.textContent || '').trim() || null,
    tag: g.tagName.toLowerCase(),
  })))`));

const on = await readSignals();
console.log("SIGNALS", JSON.stringify(on, null, 1));

// 2026-10-18 통합 독 — 알림 종은 **알림 수 배지**가 됐다(수가 0 이면 서지 않는다 — 이 판의 스텁에는 알림이 없다).
// 설정 톱니는 독 머리 아이콘 줄로 옮겨 갔다 — 이 질의에 들지 않는다.
// MCP 활동·도는 작업안이 있어도 ✦ · ▶ 는 서지 않는다 (2026-10-05).
// 2026-10-23 — 자물쇠(🔒 화면 잠금)는 독 실행 판으로 옮겼다(dock-unified-harness 가 본다) — 후미에는 ⚡ 만 남는다.
// 2026-10-24 End-4 알약 — 종은 늘 서고(A안), ⚡ 는 알림 알약 단추(`notify`) 안의 **표시**(span — 따로 누르지 않는다)다.
// 질의는 문서 순서라 바깥 알약이 먼저 나온다.
check("후미 신호 = 알림 알약 + 그 안의 ⚡ — 🔒 ✦ ▶ 없음", on.map((g) => g.id),
  ["notify", "auto-approve"]);
check("⚡ 툴팁", on[1].tip, "자동 승인 켜짐");
check("알약만 누를 수 있고 ⚡ 는 표시", on.map((g) => g.tag), ["button", "span"]);
check("⚡ 는 알약 안에 있다",
  await ev(`!!document.querySelector('.statusbar [data-signal="notify"] [data-signal="auto-approve"]')`), true);
// 선두단 다섯 칸은 그대로다 — 신호는 **더하는 것**이지 자리를 뺏지 않는다 (설정은 후미로 나갔다 ·
// 호스트 · 프로젝트은 2026-09-25 에 독 칸 하나로 합쳤다 — docs/log/2026-09-25-unified-dock.md).
// (2026-09-27 에 "이 폴더의 지난 대화" 칸이 더해져 여섯 — docs/log/2026-09-27-folder-conversations.md)
check("선두단 여섯 칸은 그대로",
  await ev(`document.querySelectorAll('.statusbar .lead [data-status-id]').length`), 6);
check("신호는 끌어 옮기는 순서에 들지 않는다",
  await ev(`document.querySelectorAll('.statusbar .signals [data-status-id]').length`), 0);
// 묶음을 가르는 선은 **양옆이 다 있을 때만** 그려진다 — 이 하네스에는 칩이 없으므로 하나도
// 없다(띠 끝에 매달린 선은 아무것도 가르지 않는다).
check("칩이 없으면 가르는 선도 없다",
  await ev(`document.querySelectorAll('.statusbar .sep').length`), 0);

await shot(`${outdir}-status-signals.png`);

// ── 2. 세로 기둥 — 글리프가 맨 아래에 쌓인다 ─────────────────────────────────
await ev(`(async () => {
  window.__settings = { app: { status_bar: 'left' }, automation: { auto_approve: true } };
  const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => /lib\\/settings\\.svelte/.test(u));
  if (!url) return 'no module';
  await (await import(url)).loadSettings();
  return 'reloaded';
})()`);
await sleep(700);
check("세로 기둥에서도 그대로", (await readSignals()).map((g) => g.id),
  ["notify", "auto-approve"]);
check("세로 기둥의 알약은 세로로 선다 (폭 24px · 높이 > 폭)", await ev(`(() => {
  const r = document.querySelector('.statusbar.vertical [data-signal="notify"]')?.getBoundingClientRect();
  return !!r && Math.abs(r.width - 24) < 1 && r.height > r.width;
})()`), true);
check("기둥에서 신호 묶음은 호스트 칩 **아래**에 선다", await ev(`(() => {
  const bar = document.querySelector('.statusbar.vertical');
  if (!bar) return 'not vertical';
  const chips = bar.querySelector('.chips'), sig = bar.querySelector('.signals');
  if (!sig) return 'no signals';
  // 칩이 없을 수도 있다(세션 타일 0개) — 그때는 묶음이 띠의 아래쪽 절반에 있는지만 본다.
  const br = bar.getBoundingClientRect(), sr = sig.getBoundingClientRect();
  if (!chips) return sr.top > br.top + br.height / 2;
  return sr.top >= chips.getBoundingClientRect().bottom - 1;
})()`), true);
await shot(`${outdir}-status-signals-vertical.png`);

// ── 2b. 대시보드는 옆 기둥을 덮지 않는다 (docs/log/2026-09-25-dashboard.md) ──
// (예전엔 ▶ 로 열었다 — 2026-10-05 에 ▶ 가 빠져 대시보드 칸으로 연다)
await ev(`document.querySelector('.statusbar [data-status-id="open-console"]').click()`);
await sleep(600);
check("대시보드 칸이 대시보드를 연다", await ev(`document.querySelector('.console')?.hidden === false`), true);
check("대시보드는 왼쪽 기둥을 덮지 않는다 (판의 왼쪽 끝 ≥ 기둥의 오른쪽 끝)", await ev(`(() => {
  const d = document.querySelector('.console').getBoundingClientRect();
  const b = document.querySelector('.statusbar.vertical').getBoundingClientRect();
  return d.left >= b.right - 0.5;
})()`), true);
await ev(`document.querySelector('.console .head-close').click()`); // × 로 닫는다 (2단계부터 고스트 버튼 `.head-close`)
await sleep(300);
check("× 로 닫힌다", await ev(`document.querySelector('.console')?.hidden`), true);

// ── 2c. 세로 기둥 + 둥근 패널 — 창 안에 들어온다 (docs/log/2026-09-29-statusbar-panel-vertical.md) ──
// 예전엔 `height:100%` 에 panel 의 위·아래 여백이 더해져 기둥 아래 모서리·설정 톱니가 창 밖으로 잘렸다.
for (const pos of ["left", "right"]) {
  await ev(`(async () => {
    window.__settings = { app: { status_bar: '${pos}', status_bar_style: 'panel' }, automation: { auto_approve: true } };
    const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => /lib\\/settings\\.svelte/.test(u));
    await (await import(url)).loadSettings();
    return 'reloaded';
  })()`);
  await sleep(500);
  check(`${pos} 기둥 panel 은 창 안 · 위아래 여백이 같다 · 마지막 버튼이 보인다`, await ev(`(() => {
    const bar = document.querySelector('.statusbar.vertical[data-style="panel"]');
    if (!bar) return 'no panel column';
    const r = bar.getBoundingClientRect(), body = document.querySelector('.body').getBoundingClientRect();
    const btns = bar.querySelectorAll('button'), last = btns[btns.length - 1]?.getBoundingClientRect();
    return r.bottom <= innerHeight && r.right <= innerWidth && r.left >= 0
      && Math.abs((r.top - body.top) - (body.bottom - r.bottom)) < 1
      && !!last && last.bottom <= r.bottom;
  })()`), true);
}

// 가로로 되돌린다 (아래 단언은 자리와 무관하지만 캡처와 같은 모습에서 본다).
await ev(`(async () => {
  window.__settings = { app: { status_bar: 'bottom', status_bar_style: 'flat' }, automation: { auto_approve: false } };
  const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => /lib\\/settings\\.svelte/.test(u));
  await (await import(url)).loadSettings();
  return 'reloaded';
})()`);
await sleep(500);

// ── 3. 스텁을 뒤집으면 **신호가 전부 사라진다** ────────────────────────────────
//
// 조건부가 이 기능의 요점이다: 아무것도 켜져 있지 않으면 띠는 예전과 똑같이 보여야 한다.
await ev(`window.__activity = { client: 'claude', atMs: Date.now() - 2 * 60_000 }`); // 2분 전 = 낡았다
await ev(`window.__ops = { pending: [], recent: [] }`);
await ev(`window.__vault = { state: 'absent', hasMaster: false, entryCount: 0 }`);
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(1200);

// 신호는 DOM 에서 빠지고 **종만** 남는다 — 종이 늘 있으므로 묶음도 늘 있다.
check("볼트 없음·자동 승인 꺼짐 → 종만 남는다",
  (await readSignals()).map((g) => g.id), ["notify"]);
check("묶음은 종을 품고 남는다",
  await ev(`document.querySelectorAll('.statusbar .signals').length`), 1);
// 이 하네스는 세션 타일을 하나도 열지 않으므로 중앙 호스트 칩도 없다 — 남는 것은 선두단뿐이다
// (2026-09-21 ② 에서 후미 readout `.trail` 은 칩이 흡수하며 사라졌다).
check("띠는 예전 그대로다 — 선두단 여섯 · 중앙 칩 없음",
  await ev(`JSON.stringify([
    document.querySelectorAll('.statusbar .lead [data-status-id]').length,
    document.querySelectorAll('.statusbar .chips').length,
  ])`), JSON.stringify([6, 0]));

// ── 4. 잠긴 볼트도 상태바에는 그림이 없다 (2026-10-23 — 자물쇠는 독 실행 판의 화면 잠금 칸으로 옮겼다) ──────
await ev(`window.__vault = { state: 'locked', hasMaster: true, entryCount: 2 }`);
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(900);
check("잠긴 볼트도 후미에 볼트 신호가 없다 (알약만)", (await readSignals()).map((g) => g.id), ["notify"]);

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
