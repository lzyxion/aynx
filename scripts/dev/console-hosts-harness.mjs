// 헤드리스 검증 — 대시보드 세션 칸의 **목록 모드 = 호스트로 묶은 한 벌**
// (docs/log/2026-09-21-console-host-groups.md).
//
// `connect-diag-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다. 독에서 `web-01` 을 열어
// 이 창의 SSH 타일 하나를 만들고(그 타일의 거울 키 = `report_session` 의 `key`), 그 키를
// `list_console_sessions` 스텁에 **같은 streamId 로** 실어 중복 제거를 재현한다. 나머지는
// 지어낸다: 다른 창의 공유 세션 · 살아 있는 헤드리스(작업안 실행 중) · 아직 안 붙은 위임 ·
// 고아 위임. **뒤의 둘은 어디에도 그려지지 않아야 한다** — 위임 목록은 설정 › 보안으로
// 옮겨 갔고 대시보드은 돌고 있는 것만 보인다 (docs/log/2026-09-21-fleet-delegation-ui.md).
//
// usage:
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx --window-size=1100,800 \
//     http://localhost:1420/
//   node scripts/dev/console-hosts-harness.mjs out-prefix
//     → <prefix>-console-hosts.png (전체) · <prefix>-pending-badge.png (검토 대기 만료)
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
  // Tauri 이벤트 통로 — listen 이 등록한 핸들러 id 를 이름별로 쥐고, __emit 이 백엔드 대신
  // 쏜다(대시보드의 operation-state 처리를 실제 경로로 때린다). 이 블록은 템플릿 문자열이라
  // 백틱을 쓸 수 없다.
  const evts = new Map();
  window.__emit = (name, payload) => {
    const ids = evts.get(name) ?? [];
    for (const id of ids) cbs.get(id)?.({ event: name, id, payload });
    return ids.length;
  };
  let nextSession = 100;
  // 테스트가 갈아 끼우는 두 표 — 대시보드 폴링이 매번 이것을 읽는다.
  window.__sessions = [];     // list_console_sessions
  window.__delegation = [];        // delegation_list_targets
  window.__ops = { pending: [], recent: [] };
  const host = (name, over) => ({ name, host_name: name + '.internal', user: 'deploy', port: 22, ...over });
  const answers = {
    list_hosts: { hosts: [
      host('web-01', { meta: { color: '#4a90d9', tags: [], forwards: [] } }),
      host('bastion', { user: 'ops', meta: { icon: 'svg:ubuntu', tags: [], forwards: [] } }),
      host('db-01', { user: 'ops' }),
    ], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {},
    // 볼트는 꺼진 상태로 둔다 — null 을 주면 접속 경로가 hasMaster 를 읽다 죽는다(실제로 겪었다).
    vault_status: { state: 'absent', hasMaster: false, entryCount: 0 }, vault_list: [],
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'open_ssh_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, tmux: null }); }
      if (cmd === 'list_console_sessions') return Promise.resolve(window.__sessions);
      if (cmd === 'delegation_list_targets') return Promise.resolve(window.__delegation);
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
  // blocks-harness.mjs 와 같은 통로 — 셸 출력(OSC 133)을 타일에 직접 밀어 넣는다.
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(4500);

const key = async (code, modifiers, keyName) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : code === "Escape" ? 27 : code === "Enter" ? 13 : 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};

// ── 1. 독에서 web-01 을 열어 이 창의 SSH 타일을 만든다 ─────────────────────────
await key("KeyH", 10, "H"); // Ctrl+Shift+H
await sleep(900);
console.log("open web-01:", await ev(`(() => {
  const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
  if (!el) return 'no row';
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return 'clicked';
})()`));
await sleep(1600);
await key("KeyH", 10, "H"); // 독을 닫는다 (캡처에서 대시보드을 가린다)
await sleep(400);

// 거울 키 = report_session 의 `key`. 이 창 타일과 전역 목록을 잇는 **유일한 열쇠**다.
const streamId = await ev(`(() => {
  const c = window.__calls.filter((c) => c[0] === 'report_session');
  return c.length ? c[c.length - 1][1].key : null;
})()`);
console.log("streamId:", streamId);
if (!streamId) { console.log("FAIL: report_session 을 못 봤다 — 타일이 안 열렸다"); ws.close(); process.exit(1); }

// 그 타일에 **끝난 명령 한 건**을 흘린다(OSC 133 A·B·C·D) — 이 창 줄의 `현재 작업`·종료 코드·
// `마지막 활동` 경과가 전부 이 블록에서 온다(전역 거울이 아니라 프런트 블록 이력이 출처다).
const ESC = "\x1b", BEL = "\x07";
const sshSid = await ev(`Object.keys(window.__chan)[0]`);
const feed =
  `${ESC}]7;file://host/srv/app${BEL}${ESC}]133;A${BEL}deploy@web-01:~$ ${ESC}]133;B${BEL}` +
  `systemctl restart nginx\r\n${ESC}]133;C${BEL}Job for nginx.service failed.\r\n${ESC}]133;D;1${BEL}` +
  `${ESC}]133;A${BEL}deploy@web-01:~$ ${ESC}]133;B${BEL}`;
console.log("feed:", await ev(`window.__feed(${sshSid}, ${JSON.stringify(feed)})`));
await sleep(700);

// ── 2. 전역 세션 뷰·위임·작업안을 심는다 ───────────────────────────────────────
const NOW = Date.now();
const g = (over) => ({
  code: over.id, label: over.id, kind: "ssh", status: null, running: false, lastExit: null,
  commands: 0, connected: true, dropped: false, lastCommand: null, aliasKnown: true,
  user: null, connectedAt: null, lastActivityAt: null, windowLabel: null, ...over,
});
await ev(`window.__sessions = ${JSON.stringify([
  // ① 이 창의 web-01 타일 — 같은 streamId 라 **한 줄로 합쳐져야** 한다(이 창이 이긴다).
  g({ id: streamId, code: "p1", label: "web-01", user: "deploy", windowLabel: "main",
      connectedAt: NOW - 18 * 60_000, lastActivityAt: NOW - 3 * 60_000, lastCommand: "git pull", lastExit: 0 }),
  // ② 다른 창의 공유 세션 — 같은 호스트, 점프 없음.
  g({ id: "other-1", code: "t2·p1", label: "web-01", user: "minsu", windowLabel: "win-2",
      connectedAt: NOW - 42 * 60_000, lastActivityAt: NOW - 42 * 60_000, status: "fail", lastExit: 1,
      lastCommand: "systemctl status nginx" }),
  // ③ 살아 있는 헤드리스 — 아래 작업안이 지금 이 세션에서 돈다.
  g({ id: "delegated:bastion", code: "bastion", label: "bastion", user: "ops",
      connectedAt: NOW - 4 * 60_000, lastActivityAt: NOW - 4 * 60_000 }),
  // ④ 아직 안 붙은 위임 — 줄이 아니라 **대기 머리줄**.
  g({ id: "delegated:db-01", code: "db-01", label: "db-01", user: "ops", connected: false }),
  // ⑤ 고아 위임 — `~/.ssh/config` 에 없는 별칭.
  g({ id: "delegated:old-host", code: "old-host", label: "old-host", connected: false, aliasKnown: false }),
])}`);
await ev(`window.__delegation = ${JSON.stringify([
  { alias: "bastion", client: "any", connect: true, read: true, propose: true, auto_execute: false },
  { alias: "db-01", client: "any", connect: true, read: true, propose: false, auto_execute: false },
  { alias: "old-host", client: "any", connect: true, read: true, propose: false, auto_execute: false },
])}`);
// 검토 대기 하나 — **만료 12분 뒤**(docs/log/2026-09-21-approval-ttl.md). 이 하나가 상태바
// 대시보드 칸의 배지와 작업안 카드의 "만료까지 12분" 두 자리를 동시에 먹인다.
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
// 상태바 배지는 대시보드 밖 모듈(`app/pending-plans.svelte.ts`)이 센다 — 부팅 때 한 번 읽고 그
// 뒤로는 이벤트·창 포커스·30초 그물로만 다시 읽는다. 표를 방금 갈아 끼웠으니 포커스로 깨운다
// (디바운스 300ms).
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(700);
// 위임 표는 앱 사본이라 부팅 때 한 번 읽었다 — 호스트 목록을 다시 읽는 길로 갱신한다.
await ev(`(async () => {
  const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => /app\\/delegation\\.svelte/.test(u));
  if (!url) return 'no module';
  (await import(url)).refreshDelegationTargets();
  return 'refreshed';
})()`);
await sleep(400);

// ── 3. 대시보드을 연다 (Ctrl+Shift+M) ────────────────────────────────────────────
await key("KeyM", 10, "M");
// 새 창의 토글은 에이전트 칸으로 연다(2단계 — docs/log/2026-09-25-agent-board.md) — 세션 칸으로 옮긴다
await ev(`document.querySelector('.console [data-section-btn="sessions"]')?.click()`);
await sleep(2600); // 첫 폴링 한 바퀴

const read = async () => await ev(`JSON.stringify([...document.querySelectorAll('.console .host')].map((h) => ({
  name: (h.querySelector('.host-name')?.textContent || '').trim(),
  chip: (h.querySelector('.chip')?.textContent || '').trim(),
  // svelte 가 붙이는 스코프 클래스(s-xxxx)는 뜻이 없다 — 아는 상태 이름만 남긴다.
  dot: [...(h.querySelector('.host-head .dot')?.classList || [])]
    .filter((c) => ['working','idle','fail','disconnected','waiting','orphan'].includes(c)).join(','),
  ai: !!h.querySelector('.host-head .mark'),
  rows: [...h.querySelectorAll('.row')].map((r) => ({
    actor: r.querySelector('.actor')?.classList.contains('ai') ? 'ai' : 'human',
    account: (r.querySelector('.label')?.textContent || '').trim(),
    kind: (r.querySelector('.kind')?.textContent || '').trim(),
    state: (r.querySelector('.badge')?.textContent || '').trim(),
    since: (r.querySelector('.since')?.textContent || '').trim(),
    cmd: (r.querySelector('.cmd')?.textContent || '').trim(),
    tags: [...r.querySelectorAll('.tag')].map((x) => x.textContent.trim()),
  })),
})))`);

const all = JSON.parse(await read());
console.log("GROUPS", JSON.stringify(all, null, 1));

// 이 창에는 로컬 셸 타일이 없다(호스트만 열었다) — 로컬 묶음은 나타나지 않는다.
// `전체` 는 **살아 있는 세션만** 보인다: db-01(대기)·old-host(고아)는 `위임` 칸에만 있다.
check("[전체] 묶음 순서 (실패 → 작업중) · 대기·고아는 없다", all.map((g2) => g2.name),
  ["web-01", "bastion"]);
check("web-01 줄 둘 (이 창 + 다른 창) — 같은 streamId 는 하나로", all[0].rows.length, 2);
check("web-01 머리줄 = 최악(실패)", all[0].dot, "fail");
check("web-01 칩 = 세션 수", all[0].chip, "세션 2");
// 줄은 **상태 → 주체 → 코드** 순이라 자리로 짚지 않는다 — 꼬리표로 찾는다.
const mineRow = all[0].rows.find((r) => !r.tags.includes("다른 창"));
const otherRow = all[0].rows.find((r) => r.tags.includes("다른 창"));
check("이 창 줄: 사람·계정·종류·AI 꼬리표", [mineRow.actor, mineRow.account, mineRow.kind, mineRow.tags],
  ["human", "deploy", "SSH", ["AI"]]);
check("다른 창 줄: 실패 + '다른 창' 꼬리표 (계정은 백엔드가 준 값)",
  [otherRow.state, otherRow.account, otherRow.tags], ["실패", "minsu", ["AI", "다른 창"]]);
// 방금 흘린 블록이 이 창 줄의 출처다 — 명령·종료 코드·상태가 전역 거울이 아니라 블록에서 온다.
check("이 창 줄은 **자기 블록**을 보여 준다", [mineRow.cmd, mineRow.state],
  ["systemctl restart nginx", "실패"]);
check("경과는 마지막 활동(방금 끝난 블록) 기준", /^\d+s$/.test(mineRow.since), true);
check("경과 말풍선이 '마지막 활동 이후' 를 말한다", await ev(`(() => {
  const rows = [...document.querySelectorAll('.console .host')][0].querySelectorAll('.row');
  const mine = [...rows].find((r) => ![...r.querySelectorAll('.tag')].some((x) => x.textContent.trim() === '다른 창'));
  return !!mine?.querySelector('.since')?.title.startsWith('마지막 활동 이후');
})()`), true);
check("bastion = 헤드리스·AI 주체·도는 명령", [all[1].rows[0].actor, all[1].rows[0].kind, all[1].rows[0].state, all[1].rows[0].cmd],
  ["ai", "헤드리스", "작업중", "npm test"]);
check("bastion 머리줄에 AI 위임 표식", all[1].ai, true);

// 칩 셋의 글자와 숫자 — 전부 **살아 있는 세션**을 센다(위임 칸은 설정으로 갔다).
check("거르개 칩 셋",
  await ev(`JSON.stringify([...document.querySelectorAll('.console .strip .seg-btn')].map((b) => b.textContent.trim()))`),
  JSON.stringify(["전체3", "타일1", "헤드리스1"]));
// 총계는 **줄**을 센다 — 줄 없는 대기·고아 머리줄은 세지 않는다(세션이 아니다).
check("총계 줄", await ev(`document.querySelector('.console .total')?.textContent.trim()`), "세션 3");

const clickFilter = async (i) => {
  await ev(`document.querySelectorAll('.console .strip .seg-btn')[${i}].click()`);
  await sleep(350);
  return JSON.parse(await read());
};

const win = await clickFilter(1);
check("[타일] — 줄 하나(내 타일)", [win.length, win[0].rows.length, win[0].rows[0].account], [1, 1, "deploy"]);

const headless = await clickFilter(2);
check("[헤드리스] — 살아 있는 위임 세션만",
  headless.map((g2) => [g2.name, g2.rows.length]), [["bastion", 1]]);

// 아직 안 붙은 위임(db-01)과 고아(old-host)는 **어느 칸에도** 없다 — 그 목록은 설정 › 보안이다.
check("안 붙은 위임·고아는 대시보드에 없다",
  [all, win, headless].every((v) => !v.some((g2) => ["db-01", "old-host"].includes(g2.name))), true);

await clickFilter(0); // 전체로 되돌려 캡처
await shot(`${outdir}-console-hosts.png`);

// ── 4. 검토 대기 만료 — 상태바 배지 + 작업안 카드의 남은 시간 ─────────────────
// 대기 배지는 대시보드 칸에서 **알림 종**으로 옮겼다 (docs/log/2026-09-25-notification-center.md) —
// 종의 배지 = 승인 대기 + 읽지 않은 알림, 말풍선이 그 둘을 나눠 말한다.
// 대시보드 칸의 배지는 2026-10-05 에 **지금 돌아가는 것**으로 돌아왔다(docs/log/2026-10-05-dashboard-badge.md) —
// 승인 대기는 세지 않고, 열린 헤드리스(bastion) 1 + 도는 작업안(op-1) 1 = 2.
check("대시보드 칸 배지 = 헤드리스 1 + 도는 작업안 1 (승인 대기는 종 몫)",
  await ev(`document.querySelector('.statusbar [data-status-id="open-console"] [data-running-badge]')?.textContent?.trim() ?? null`), "2");
check("알림 종 말풍선이 승인 대기 1 을 말한다",
  await ev(`/승인 대기 1 /.test(document.querySelector('.statusbar [data-signal="notify"]')?.title || '')`),
  true);
check("알림 종에 배지가 선다",
  await ev(`Number(document.querySelector('.statusbar [data-signal="notify"] .notify-pill')?.textContent.trim() ?? 0) >= 1`),
  true);

// 작업안 칸(머리줄의 칸 단추) — 거르개 칩(`.strip`)이 아니라 `.head` 쪽이다 (2026-09-25 대시보드).
await ev(`[...document.querySelectorAll('.console .head .seg .seg-btn')].find((b) => b.textContent.trim().startsWith('작업안')).click()`);
await sleep(400);
check("작업안 카드가 만료까지 남은 시간을 말한다",
  await ev(`document.querySelector('.console .ops .op .oexpiry')?.textContent.trim() ?? null`),
  "만료까지 12분");
await shot(`${outdir}-pending-badge.png`);

// ── 5. 만료는 **실행 뷰를 만들지 않는다** ─────────────────────────────────────
// 실제로 본 버그: 대기 작업안이 TTL 로 만료되면 `operation-state{state:"expired"}` 가 오는데,
// 이벤트 처리가 "뷰가 없으면 만든다" 였으므로 작업안 탭에 "(다른 창에서 시작한 실행)" 카드가
// 생겼다. 돌지 않은 것의 결과 행렬을 보여 준 셈이다.
const execCount = async () => await ev(`document.querySelectorAll('.console .op.exec').length`);
const external = async () =>
  await ev(`[...document.querySelectorAll('.console .op.exec')].some((e) => (e.textContent || '').includes('(다른 창에서 시작한 실행)'))`);
const before = await execCount(); // recent 의 op-1(running) 하나 — 이 값이 변하면 안 된다
check("만료 이벤트 전: 실행 카드는 recent 의 하나뿐이고 '다른 창' 카드는 없다",
  [before, await external()], [1, false]);

// 구독자는 둘이다 — 대시보드과 상태바 배지 모듈(`app/pending-plans.svelte.ts`). 수가 아니라
// **닿았는가**만 본다.
check("만료 이벤트가 대시보드 구독에 닿는다",
  await ev(`window.__emit('operation-state', { operationId: 'op-2', state: 'expired' }) >= 1`), true);
await sleep(400);
check("만료 이벤트는 실행 뷰를 만들지 않는다 (카드 수 그대로 · '다른 창' 없음)",
  [await execCount(), await external()], [before, false]);

// 복구 루프도 같다 — 목록이 op-2 를 `expired` 로 돌려줘도 실행 뷰로 되살리지 않는다
// (`EXEC_STATES` 가 expired·rejected 를 일부러 빼 둔다). 대기 카드는 사라진다.
await ev(`window.__ops = { pending: [], recent: [{ ...window.__ops.pending[0], state: 'expired' }, window.__ops.recent[0]] }`);
await sleep(2600); // 작업안 폴링 한 바퀴(2초)
check("복구 루프도 만료를 실행 뷰로 되살리지 않는다",
  [await execCount(), await external()], [before, false]);
check("만료된 대기 카드는 사라진다",
  await ev(`document.querySelectorAll('.console .ops .op:not(.exec)').length`), 0);

// 가로 넘침 — 줄이 판 밖으로 새지 않는가.
console.log("overflow:", await ev(`(() => {
  const p = document.querySelector('.console');
  const rows = [...p.querySelectorAll('.row, .host-head')];
  const pr = p.getBoundingClientRect();
  const over = rows.filter((r) => r.getBoundingClientRect().right > pr.right + 1).length;
  return JSON.stringify({ panelWidth: Math.round(pr.width), scrollX: p.scrollWidth - p.clientWidth, over });
})()`));

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
if (exc.length) console.log("EXC", exc);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
