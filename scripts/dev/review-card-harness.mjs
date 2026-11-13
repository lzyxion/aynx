// 헤드리스 검증 — **화면 아래 가운데 검토 대기 카드** (그 자리에서 승인·거절)
// (docs/log/2026-09-27-review-popup-card.md · 앞선 판 docs/log/2026-09-22-review-card.md).
//
// `status-signals-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다. 먹이는 칸은 하나다
// (`window.__ops` = `list_operations` 의 답). 재조회는 **창 포커스** 한 길로 깨운다
// (`app/pending-plans` 의 세 갈래 중 하나).
//
// 시나리오 열둘: ① 대기 0 → 카드도 토스트 기둥도 없다 · ② 안전 작업안 하나 — 전문·제목·사유·
// 경로·검증·canary, 아래 상태바 **바로 위** 가운데 · ③ 셋 + 13 KB·대상 8 — `1 / 3`·‹ ›·안쪽
// 스크롤·"대상 8 ▾" 펼침·고른 것이 사라지면 맨 앞 · ④ **포커스** — 터미널에 포커스를 둔 채
// [거절]을 **진짜 마우스로** 눌러도 포커스가 터미널에 남고, 이어 친 Enter 가 아무것도 부르지
// 않는다 · ⑤ 안전 승인 한 번 = `approve_operation{manual}` · ⑥ 위험 = 두 걸음(첫 클릭은
// 확인 상태만 · ›·Escape 가 푼다) · ⑦ 승인 거부 → 오른쪽 위 토스트, 카드는 남는다 · ⑧ 접기 ·
// 새 머리가 다시 편다 · ⑨ 작업안(채팅 독의 작업안 갈래)이 보이면 물러나고 채팅 갈래 · 독 닫힘에서 선다 ·
// ⑩ 왼쪽 상태바 — 카드가 본문 기둥 안에 선다 · ⑪ 가림막 — 개수 한 줄만, 가림막 위 ·
// ⑫ 잡히지 않은 예외·콘솔 오류 0 · ⑬ (10-24) 판결 띠 · 명령 나눠 보기 — 어긋남(9줄 중 1줄) · 원문 보기 · 모두 읽기(초록) ·
// 짧은 안전 · 짧은 위험(find -delete) — 카드만 잘라 배율 2 로 찍는다 · ⑭ (10-24 실기 피드백 — 분석 JSON 은 Rust 실제 출력) sudo 읽기
// 한 줄(낱말만 경고색 · 행 판 없음) · heredoc(초록 · 본문은 연 행 안 · 표시 없음) · DB WHERE 없는 DELETE(나눠 보기 · 실패색 낱말 ·
// "… · WHERE 없음" 표지 · 상한 칩만) · DB WHERE 있는 UPDATE(경고색 · 한 번 승인).
//
// usage (격리 서버 — 1420/9222 는 개발 앱의 것이라 건드리지 않는다):
//   npx vite --port 1438 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9270 --user-data-dir=%TEMP%/edge-aynx-review \
//     --window-size=1200,800 http://localhost:1438/
//   PAGE_PORT=1438 node scripts/dev/review-card-harness.mjs <outdir> 9270
//     → <outdir>/review-card-one.png · -many.png · -danger.png · -left.png · -veiled.png
//       · -mismatch(-armed).png · -raw.png · -ok.png · -short.png · -find(-armed).png
//       · -sudo.png · -heredoc.png · -db-delete.png · -db-update.png
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9270"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1438"}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
/** ⑫ — 잡히지 않은 예외와 콘솔 오류를 모은다 */
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

// 단언 — 실패해도 계속 돌려서 한 번에 전부 본다(마지막에 개수를 센다).
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

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  // 모듈이 많아 기본 버퍼(250)를 넘으면 뒤에 올린 모듈이 importApp 에서 안 보인다 — 넉넉히
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => {
    const ids = evts.get(name) ?? [];
    for (const id of ids) cbs.get(id)?.({ event: name, id, payload });
    return ids.length;
  };
  let nextSession = 100;
  // 테스트가 갈아 끼우는 칸 — 대기 카드가 읽는 것은 이 하나뿐이다.
  window.__ops = { pending: [], recent: [] };
  // 승인을 백엔드가 거부할지 — 문자열이면 그 사유로 거부한다(⑦).
  window.__approveFails = null;
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false } };
  window.__vault = { state: 'unlocked', hasMaster: false, entryCount: 0 };
  const host = (name, over) => ({ name, host_name: name + '.internal', user: 'deploy', port: 22, ...over });
  const drop = (id) => { window.__ops = { pending: window.__ops.pending.filter((o) => o.operationId !== id), recent: window.__ops.recent }; };
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
    vault_list: [], vault_lock: null, mcp_activity: null, restore_done_sessions: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'open_ssh_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, tmux: null }); }
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
      if (cmd === 'reject_operation') {
        const op = window.__ops.pending.find((o) => o.operationId === args.operationId) ?? null;
        drop(args.operationId);
        return Promise.resolve(op && { ...op, state: 'rejected' });
      }
      if (cmd === 'approve_operation') {
        if (window.__approveFails) return Promise.reject(window.__approveFails);
        const op = window.__ops.pending.find((o) => o.operationId === args.operationId) ?? null;
        drop(args.operationId);
        return Promise.resolve(op && { ...op, state: 'approved' });
      }
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
await waitBoot(ev);
// 부팅 중의 스텁 거절(모르는 명령)은 이 판의 관심사가 아니다 — 여기서부터 센다.
errors.length = 0;

// 작업안 한 벌 — 단언이 읽는 것만 채우고 나머지는 계약의 기본값이다.
const NOW = Date.now();
const plan = (over) => ({
  operationId: "op-x", command: "uptime", targets: ["s1"], cwd: null, validate: null,
  mode: "exec", strategy: "sequential", concurrency: 1, timeoutSeconds: 60,
  state: "awaitingApproval", createdAt: NOW, requestedAt: NOW, expiresAt: null,
  title: null, reason: null, idempotencyKey: null, ...over,
});
const feed = async (ops) => {
  await ev(`window.__ops = { pending: ${JSON.stringify(ops)}, recent: [] }`);
  await ev(`window.dispatchEvent(new Event('focus'))`);
  await sleep(900);
};
const calls = async (cmd) => JSON.parse(await ev(`JSON.stringify(window.__calls.filter(([c]) => c === '${cmd}').map(([, a]) => a))`));
const resetCalls = () => ev(`window.__calls.length = 0`);

/** 카드가 실제로 그린 것 — 없으면 `null` */
const readCard = async () =>
  JSON.parse(await ev(`(() => {
    const c = document.querySelector('.rcard');
    if (!c) return 'null';
    const txt = (sel) => { const e = c.querySelector(sel); return e ? e.textContent.trim() : null; };
    return JSON.stringify({
      veiled: c.classList.contains('veiled'),
      danger: c.classList.contains('danger'),
      band: txt('.vband .vtext'), tone: c.querySelector('.vband')?.dataset.verdict ?? null,
      pos: txt('.pos'), expiry: txt('.expiry'), count: txt('.count'),
      title: txt('.title'), note: txt('[data-ai-note]'), summary: txt('.summary'),
      cmd: (() => { const e = c.querySelector('.cmd'); return e ? e.textContent : null; })(),
      clamped: c.querySelector('.cmd')?.dataset.cmdClamped ?? null,
      meta: Object.fromEntries([...c.querySelectorAll('[data-meta]')].map((e) => [e.dataset.meta, e.textContent.replace(/ /g, ' ').trim()])),
      tcount: txt('.tcount'),
      chips: [...c.querySelectorAll('.tgt')].map((e) => e.textContent.trim()),
      canary: c.querySelectorAll('.tgt .first').length,
      achips: [...c.querySelectorAll('[data-chip]')].map((e) => e.dataset.chip),
      lines: c.querySelectorAll('[data-cmd-lines] > li').length,
      quiet: c.querySelectorAll('[data-cmd-lines] > li.quiet').length,
      words: [...c.querySelectorAll('[data-cmd-lines] [data-line-word]')].map((e) => e.textContent + ':' + e.dataset.lineWord),
      over: [...c.querySelectorAll('[data-cmd-lines] [data-line-tag]')].map((e) => e.textContent.replace(/ /g, ' ').trim()),
      raw: (() => { const e = c.querySelector('[data-cmd-raw]'); return e ? e.textContent : null; })(),
      hint: txt('[data-reveal-hint]'), warn: txt('.warn:not([data-reveal-hint])'),
      approve: (() => { const b = c.querySelector('.approve'); return b ? { text: b.textContent.trim(), cls: b.className.replace(/svelte-\\S+/g, '').trim() } : null; })(),
      buttons: [...c.querySelectorAll('button')].map((b) => b.textContent.trim() || b.getAttribute('aria-label')),
      live: c.getAttribute('aria-live'), role: c.getAttribute('role'),
      z: getComputedStyle(c).zIndex,
    });
  })()`));

/** 단추 하나의 가운데 좌표 — 진짜 마우스로 누르려고(`element.click()` 은 포커스를 옮기지 않아 ④가 무의미해진다) */
const center = async (sel) =>
  JSON.parse(await ev(`(() => { const e = ${sel}; if (!e) return 'null'; const r = e.getBoundingClientRect(); return JSON.stringify({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); })()`));
const btn = (text) => `[...document.querySelectorAll('.rcard button')].find((b) => b.textContent.trim() === ${JSON.stringify(text)})`;
const mouseClick = async (sel) => {
  const p = await center(sel);
  if (!p) return false;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: p.x, y: p.y, button: "left", clickCount: type === "mouseMoved" ? 0 : 1 });
  }
  await sleep(500);
  return true;
};
const key = async (code, keyName, keyCode, text) => {
  await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: keyName, windowsVirtualKeyCode: keyCode, text });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: keyName, windowsVirtualKeyCode: keyCode });
  await sleep(300);
};

// ── ① 대기가 없으면 카드도 기둥도 없다 ────────────────────────────────────────
check("① 대기 0 → 카드가 DOM 에 없다", await ev(`document.querySelectorAll('.rcard').length`), 0);
// 하네스의 `Page.reload` 가 첫 탭을 "복원" 하며 띄우는 토스트는 이 판의 관심사가 아니다 — 검토 · 승인 토스트만 없으면 된다.
check("① 검토 · 승인 토스트는 없다 (카드가 토스트 기둥을 쓰지 않는다)",
  await ev(`[...document.querySelectorAll('.toasts .toast')].filter((e) => /검토|승인/.test(e.textContent)).length`), 0);
console.log("TOASTS(boot)", await ev(`JSON.stringify([...document.querySelectorAll('.toasts .toast')].map((e) => e.textContent.trim()))`));

// ── ② 안전 작업안 하나 — 전문 · 제목 · 사유 · 경로 · 검증 · 대상 둘 ────────────
const CMD2 = "set -e\nnginx -t\nsystemctl reload nginx\ncurl -fsS http://127.0.0.1/healthz";
await feed([plan({
  operationId: "op-1", title: "nginx 설정 재적용", reason: "설정 파일을 고쳤으니 다시 읽힌다",
  command: CMD2, cwd: "/etc/nginx", validate: "systemctl is-active nginx", targets: ["s1", "s2"],
})]);
const one = await readCard();
console.log("CARD(one)", JSON.stringify(one, null, 1));
check("② 제목", one.title, "nginx 설정 재적용");
check("② 이유는 작은 카드에 없다 (펼쳐야)", one.note, null);
check("② 분석 없는 옛 작업안 — 띠는 중성 '검토 대기'", [one.tone, one.band], ["neutral", "검토 대기"]);
check("② 명령 **전문** (줄바꿈 그대로)", one.cmd, CMD2);
check("② 메타 줄 — 대상 · 경로 · 검증", one.meta, { targets: "대상 2s1 (먼저)s2", cwd: "경로 /etc/nginx", validate: "검증: systemctl is-active nginx" });
check("② 한 건이면 ‹ › 가 없다", one.pos, null);
check("② 안전 명령 — 실패색 띠 · 테두리가 없다", [one.tone, one.danger], ["neutral", false]);
check("② 대상 둘 · 첫 대상에 (먼저)", [one.tcount, one.chips.length, one.canary], ["대상 2", 2, 1]);
check("② 단추 — 접기 · 전체 보기(이유가 있다) · 작업안에서 보기 · 나중에 · 거절 · 실행 승인",
  one.buttons, ["접기", "전체 보기", "작업안에서 보기", "나중에", "거절", "실행 승인"]);
check("② 승인은 채운 강조", one.approve.cls.includes("btn-primary"), true);
check("② aria-live 는 끈다", [one.role, one.live], ["group", "off"]);
check("② z-index 95", one.z, "95");
const geo = JSON.parse(await ev(`(() => {
  const c = document.querySelector('.rcard').getBoundingClientRect();
  const bar = document.querySelector('.statusbar').getBoundingClientRect();
  const body = document.querySelector('.body').getBoundingClientRect();
  const cmd = document.querySelector('.rcard .cmd');
  return JSON.stringify({
    aboveBar: c.bottom <= bar.top + 0.5, gapToBar: Math.round(bar.top - c.bottom),
    centred: Math.abs((c.left + c.right) / 2 - (body.left + body.right) / 2) < 1.5,
    inViewport: c.left >= 0 && c.top >= 0 && c.right <= innerWidth && c.bottom <= innerHeight,
    width: Math.round(c.width), cmdScrolls: cmd.scrollHeight > cmd.clientHeight + 1,
    hOverflow: document.documentElement.scrollWidth - innerWidth,
  });
})()`));
console.log("GEO(one)", JSON.stringify(geo));
check("② 아래 상태바 **위**에 서고 겹치지 않는다 (틈 ≤ 24px)", [geo.aboveBar, geo.gapToBar >= 0 && geo.gapToBar <= 24], [true, true]);
check("② 본문 가운데", geo.centred, true);
check("② 뷰포트 안 · 폭 560", [geo.inViewport, geo.width], [true, 560]);
check("② 네 줄 명령은 두 줄로 접힌다 (첫 [승인]은 펼치기)", one.clamped, "true");
check("② 가로 스크롤 0", geo.hOverflow, 0);
await shot("review-card-one.png");

// ── ③ 셋 · 머리는 13 KB · 대상 8 ──────────────────────────────────────────────
const BIG = Array.from({ length: 260 }, (_, i) => `echo line-${String(i).padStart(3, "0")} ${"x".repeat(40)}`).join("\n");
const EIGHT = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
await feed([
  plan({ operationId: "op-big", command: BIG, expiresAt: NOW + 7 * 60000, targets: EIGHT }),
  plan({ operationId: "op-2", title: "디스크 확인", command: "df -h" }),
  plan({ operationId: "op-3", title: "로그 수집", command: "journalctl -n 100" }),
]);
const many = await readCard();
check("③ 13 KB 에 가깝다", BIG.length > 12 * 1024, true);
check("③ 1 / 3 · 만료 7분", [many.pos, many.expiry], ["1 / 3", "7분 뒤 만료"]);
check("③ 전문 그대로 싣는다", many.cmd === BIG, true);
check("③ 대상 여덟은 칩 없이 한 단추로 접힌다", [many.tcount, many.chips.length], ["대상 8", 0]);
const geo3 = JSON.parse(await ev(`(() => {
  const card = document.querySelector('.rcard'); const c = card.getBoundingClientRect();
  const cmd = card.querySelector('.cmd');
  const bar = document.querySelector('.statusbar').getBoundingClientRect();
  const cs = getComputedStyle(cmd);
  return JSON.stringify({ h: Math.round(c.height), cmdH: cmd.clientHeight,
    tenLines: Math.round(parseFloat(cs.lineHeight) * 10 + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom)), cmdScrolls: cmd.scrollHeight > cmd.clientHeight + 1,
    top: Math.round(c.top), aboveBar: c.bottom <= bar.top + 0.5, hOverflow: card.scrollWidth - card.clientWidth });
})()`));
console.log("GEO(many)", JSON.stringify(geo3));
check("③ 명령 상자가 안에서 스크롤한다 (높이 상한)", geo3.cmdScrolls, true);
check("③ 명령 상자 ≤ 열 줄 (+ 안쪽 여백)", geo3.cmdH <= geo3.tenLines + 1, true);
check("③ 카드 높이가 묶인다 (≤ 420px · 창 안)", [geo3.h <= 420, geo3.top >= 0, geo3.aboveBar], [true, true, true]);
check("③ 카드 가로 넘침 0", geo3.hOverflow, 0);
await ev(`document.querySelector('.rcard .ttoggle').click()`);
await sleep(300);
const opened = await readCard();
check("③ 펼치면 여덟 칩 · canary 하나", [opened.chips.length, opened.canary], [8, 1]);
check("③ 펼침이 aria-expanded 로 보인다", await ev(`document.querySelector('.rcard .ttoggle').getAttribute('aria-expanded')`), "true");
await shot("review-card-many.png");
await ev(`document.querySelector('.rcard .navbtn[aria-label="다음 작업안"]').click()`);
await sleep(300);
const second = await readCard();
check("③ › → 2 / 3 · 둘째 작업안", [second.pos, second.title, second.cmd], ["2 / 3", "디스크 확인", "df -h"]);
await ev(`document.querySelector('.rcard .navbtn[aria-label="다음 작업안"]').click()`);
await sleep(300);
check("③ › → 3 / 3 · 끝에서 › 는 꺼진다",
  [(await readCard()).pos, await ev(`document.querySelector('.rcard .navbtn[aria-label="다음 작업안"]').disabled`)], ["3 / 3", true]);
await ev(`document.querySelector('.rcard .navbtn[aria-label="이전 작업안"]').click()`);
await sleep(300);
check("③ ‹ → 2 / 3", (await readCard()).pos, "2 / 3");
// 보고 있던 것(op-2)이 목록을 떠나면 맨 앞으로 떨어진다 — 다른 작업안이 그 자리에 조용히 들어앉지 않는다.
await feed([
  plan({ operationId: "op-big", command: BIG, expiresAt: NOW + 7 * 60000, targets: EIGHT }),
  plan({ operationId: "op-3", title: "로그 수집", command: "journalctl -n 100" }),
]);
const fell = await readCard();
check("③ 고른 것이 사라지면 1 / 2 (자리 2 의 op-3 이 아니다)", [fell.pos, fell.cmd === BIG], ["1 / 2", true]);

// ── ④ 포커스 — 터미널에 둔 채 [거절]을 진짜 마우스로 ──────────────────────────
await feed([
  plan({ operationId: "op-f1", title: "첫째", command: "uptime" }),
  plan({ operationId: "op-f2", title: "둘째", command: "hostname" }),
]);
const hasXterm = await ev(`!!document.querySelector('.xterm-helper-textarea')`);
if (!hasXterm) {
  // 부팅은 시작 화면이라 터미널이 없다 — 로컬 셸 탭 하나를 연다(스텁이 세션을 준다).
  await ev(`(async () => { const w = await ${importApp("app/tabs.svelte.ts")}; const s = await ${importApp("lib/session.ts")}; w.openInNewTab(s.newLocalPane()); })()`);
  await sleep(1500);
}
const focused = await ev(`(() => { const ta = [...document.querySelectorAll('.xterm-helper-textarea')].find((e) => e.closest('.xterm')?.getBoundingClientRect().width > 0); if (!ta) return false; ta.focus(); window.__ta = ta; return document.activeElement === ta; })()`);
check("④ 터미널(xterm 숨은 textarea)에 포커스", focused, true);
await resetCalls();
check("④ [거절]을 마우스로 눌렀다", await mouseClick(btn("거절")), true);
await sleep(500);
check("④ 거절을 보냈다 (op-f1)", (await calls("reject_operation")).map((a) => a.operationId), ["op-f1"]);
check("④ **포커스는 터미널에 그대로**", await ev(`document.activeElement === window.__ta`), true);
check("④ 카드는 다음 건으로 넘어갔다", (await readCard()).title, "둘째");
await resetCalls();
await key("Enter", "Enter", 13, "\r");
check("④ 이어 친 Enter 는 승인도 거절도 부르지 않는다",
  [(await calls("approve_operation")).length, (await calls("reject_operation")).length], [0, 0]);
check("④ 카드는 그대로 둘째", (await readCard()).title, "둘째");

// ── ⑤ 안전 승인 — 한 번에 나간다 ──────────────────────────────────────────────
await resetCalls();
await mouseClick(btn("실행 승인"));
await sleep(500);
check("⑤ approve_operation{op-f2, manual} 한 번", await calls("approve_operation"), [{ operationId: "op-f2", approvalMethod: "manual" }]);
check("⑤ 마지막 건이 빠지면 카드가 사라진다", await ev(`document.querySelectorAll('.rcard').length`), 0);
check("⑤ 승인 뒤에도 포커스는 터미널", await ev(`document.activeElement === window.__ta`), true);

// ── ⑥ 위험 — 두 걸음 ──────────────────────────────────────────────────────────
await feed([
  plan({ operationId: "op-d", title: "임시 파일 정리", command: "rm -rf /tmp/x", targets: ["s1"] }),
  plan({ operationId: "op-s", title: "안전", command: "uptime" }),
]);
const d0 = await readCard();
check("⑥ 실패색 띠 · 테두리", [d0.tone, d0.danger], ["err", true]);
check("⑥ 무장 전 — 실패색 테두리의 [실행 승인]", [d0.approve.text, d0.approve.cls.includes("danger-outline"), d0.warn], ["실행 승인", true, null]);
await resetCalls();
await mouseClick(btn("실행 승인"));
const d1 = await readCard();
check("⑥ 첫 클릭은 승인을 부르지 않는다", (await calls("approve_operation")).length, 0);
check("⑥ 무장 — [확인했습니다 — 실행] · 경고 한 줄", [d1.approve.text, d1.approve.cls.includes("danger-solid"), d1.warn !== null], ["확인했습니다 — 실행", true, true]);
await shot("review-card-danger.png");
// › 로 넘겼다 돌아오면 풀린다
await ev(`document.querySelector('.rcard .navbtn[aria-label="다음 작업안"]').click()`);
await sleep(200);
await ev(`document.querySelector('.rcard .navbtn[aria-label="이전 작업안"]').click()`);
await sleep(300);
check("⑥ ›·‹ 가 무장을 푼다", (await readCard()).approve.text, "실행 승인");
// Escape — 사람이 스스로 탭으로 들어온 판(단추에 포커스)을 흉내 낸다
await mouseClick(btn("실행 승인"));
check("⑥ 다시 무장", (await readCard()).approve.text, "확인했습니다 — 실행");
await ev(`document.querySelector('.rcard .approve').focus()`);
await key("Escape", "Escape", 27);
check("⑥ Escape 가 무장을 풀고 포커스를 놓는다",
  [(await readCard()).approve.text, await ev(`document.querySelector('.rcard').contains(document.activeElement)`)], ["실행 승인", false]);
check("⑥ 그동안 승인은 한 번도 안 나갔다", (await calls("approve_operation")).length, 0);
await mouseClick(btn("실행 승인"));
await mouseClick(btn("확인했습니다 — 실행"));
check("⑥ 두 번째 클릭에서 **한 번** 나간다", await calls("approve_operation"), [{ operationId: "op-d", approvalMethod: "manual" }]);
check("⑥ 다음 건(안전)으로 넘어가며 무장은 없다", [(await readCard()).title, (await readCard()).approve.text], ["안전", "실행 승인"]);

// ── ⑦ 승인 거부 — 오른쪽 위 토스트, 카드는 남는다 ─────────────────────────────
await ev(`window.__approveFails = '동시 실행 상한(2)을 넘었습니다'`);
await resetCalls();
await mouseClick(btn("실행 승인"));
await sleep(400);
check("⑦ 보냈다", (await calls("approve_operation")).length, 1);
check("⑦ 토스트가 사유를 그대로 싣는다",
  await ev(`document.querySelector('.toasts .toast .text')?.textContent.trim() ?? null`), "승인 거부: 동시 실행 상한(2)을 넘었습니다");
check("⑦ 카드는 그대로", (await readCard()).title, "안전");
check("⑦ 단추가 다시 풀렸다 (진행 중 잠금이 남지 않는다)", await ev(`document.querySelector('.rcard .approve').disabled`), false);
await ev(`window.__approveFails = null`);

// ── ⑧ 접기 · 새 머리가 다시 편다 ──────────────────────────────────────────────
await ev(`document.querySelector('.rcard .chev').click()`);
await sleep(300);
const folded = await readCard();
check("⑧ 접으면 한 줄 — 개수 · [펼치기]", [folded.count, folded.buttons, folded.cmd], ["검토 대기 1건", ["펼치기"], null]);
await feed([plan({ operationId: "op-new", title: "새 요청", command: "uptime" }), plan({ operationId: "op-s", title: "안전", command: "uptime" })]);
check("⑧ 새 머리가 서면 다시 펴진다", [(await readCard()).title, (await readCard()).pos], ["새 요청", "1 / 2"]);

// ── ⑧-b [나중에] — 지금 대기를 모두 카드에서 치운다 · 새 작업안만 다시 세운다 (2026-11-13) ──────────────
await resetCalls();
await mouseClick(btn("나중에"));
check("⑧-b [나중에] → 카드 없음 · 승인 · 거절은 나가지 않았다",
  [await ev(`document.querySelectorAll('.rcard').length`), (await calls("approve_operation")).length, (await calls("reject_operation")).length], [0, 0, 0]);
await feed([plan({ operationId: "op-new", title: "새 요청", command: "uptime" }), plan({ operationId: "op-s", title: "안전", command: "uptime" }), plan({ operationId: "op-late", title: "그다음 요청", command: "uptime" })]);
const late = await readCard();
check("⑧-b 새 작업안이 오면 그것만 카드로 선다(치운 둘은 빠짐)", [late?.title, late?.pos], ["그다음 요청", null]);
// 되돌림 — 대기가 비면 치운 표도 비고, 같은 둘이 다시 오면 카드가 선다(⑨ 의 앞 상태)
await feed([]);
await feed([plan({ operationId: "op-new", title: "새 요청", command: "uptime" }), plan({ operationId: "op-s", title: "안전", command: "uptime" })]);
check("⑧-b 대기가 비었다 다시 오면 치운 표가 남지 않는다", (await readCard())?.title, "새 요청");

// ── ⑨ 작업안 — 채팅 독의 작업안 갈래가 보이면 물러난다 (2026-10-25 — 작업안 타일이 독의 갈래가 됐다 · `plansShown`) ──
const plansMod = importApp("app/plans.svelte.ts");
const chatDockMod = importApp("app/chat-dock.svelte.ts");
const cards = () => ev(`document.querySelectorAll('.rcard').length`);
await ev(`(async () => (await ${plansMod}).openPlans())()`);
await sleep(900);
check("⑨ 작업안 갈래가 보인다 → 카드 없음 · 탭 트리는 그대로(작업안 타일 없음)",
  [await cards(), await ev(`document.querySelector('[data-chat-dock].open [data-chat-dock-plans]:not([hidden]) [data-plans-view]') ? 'dock' : 'none'`)], [0, "dock"]);
check("⑨ 작업안 카드 — 판결 띠가 맨 위", await ev(`document.querySelector('li.op > .vband') ? 'band' : 'none'`), "band");
// 2026-10-25 End-4 겉 — 테두리 없는 16px 카드 · 묶음 제목의 숫자 알약 · 메타 줄은 이 타일에서만 칩(검토 카드는 흐린 한 줄 그대로)
check("⑨ 작업안 카드 겉 — 테두리 없음 · 독 안 카드 12px(--radius-surface-inner) · 숫자 알약 · 메타 칩",
  JSON.parse(await ev(`(() => { const li = document.querySelector('[data-plans-view] li.op'); const cs = getComputedStyle(li); const cnt = document.querySelector('[data-plans-view] .heading .count'); const mi = li.querySelector('[data-review-meta] > .mi'); return JSON.stringify([cs.borderTopStyle === 'none' || parseFloat(cs.borderTopWidth) === 0, cs.borderTopLeftRadius, parseFloat(getComputedStyle(cnt).borderTopLeftRadius) >= 9, parseFloat(getComputedStyle(mi).borderTopLeftRadius) >= 9, getComputedStyle(mi, '::before').content]); })()`)),
  [true, "12px", true, true, "none"]);
await shot("plans-progress.png");
// 라이트 테마 한 장 — `<html data-theme>` 만 바꿔 찍고 되돌린다(색은 theme.css 의 라이트 블록 토큰)
await ev(`document.documentElement.dataset.theme = 'light'`);
await sleep(400);
await shot("plans-progress-light.png");
await ev(`document.documentElement.dataset.theme = 'dark'`);
await sleep(200);
// 채팅 갈래로 바꾸면(독은 열린 채) 카드가 다시 서고, 다시 작업안이면 물러나고, 독을 닫으면 선다
await ev(`(async () => (await ${chatDockMod}).setChatDockSection("chat"))()`);
await sleep(900);
check("⑨ 채팅 갈래로 바꾸면 카드가 선다", await cards(), 1);
await ev(`(async () => (await ${chatDockMod}).setChatDockSection("plans"))()`);
await sleep(900);
check("⑨ 다시 작업안 갈래 → 카드 없음", await cards(), 0);
await ev(`(async () => (await ${chatDockMod}).closeChatDock(false))()`);
await sleep(1200);
check("⑨ 독을 닫으면 카드가 선다", await cards(), 1);

// ── ⑩ 왼쪽 상태바 — 본문 기둥 안 ─────────────────────────────────────────────
const settingsMod = importApp("lib/settings.svelte.ts");
await ev(`(async () => { window.__settings = { app: { status_bar: 'left' }, automation: { auto_approve: false } }; await (await ${settingsMod}).loadSettings(); })()`);
await sleep(800);
const left = JSON.parse(await ev(`(() => {
  const c = document.querySelector('.rcard').getBoundingClientRect();
  const bar = document.querySelector('.statusbar').getBoundingClientRect();
  const body = document.querySelector('.body').getBoundingClientRect();
  return JSON.stringify({ vertical: document.querySelector('.statusbar').classList.contains('vertical'),
    rightOfBar: c.left >= bar.right, inBody: c.left >= body.left && c.right <= body.right && c.bottom <= body.bottom,
    bottomGap: Math.round(body.bottom - c.bottom), inViewport: c.bottom <= innerHeight && c.right <= innerWidth });
})()`));
console.log("GEO(left)", JSON.stringify(left));
check("⑩ 세로 띠가 왼쪽에 섰다", left.vertical, true);
check("⑩ 카드는 띠 오른쪽 · 본문 안 · 창 아래에서 한 칸 위",
  [left.rightOfBar, left.inBody, left.inViewport, left.bottomGap > 0 && left.bottomGap <= 24], [true, true, true, true]);
await shot("review-card-left.png");
await ev(`(async () => { window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false } }; await (await ${settingsMod}).loadSettings(); })()`);
await sleep(600);

// ── ⑬ 판결 띠 · 명령 나눠 보기 (10-24 "A + 명령 나눠 보기") ────────────────────
// 실기 스크린샷의 긴 명령(9줄 · 2 4 6 8 은 echo 머리 줄) — 줄은 Rust `analysis.lines` 가 싣는 꼴 그대로 손으로 적는다.
const LONG_LINES = [
  String.raw`date -u`,
  String.raw`echo "-- curl verbose"`,
  String.raw`curl -sv -m 10 -o /dev/null https://vpn.example.com/ 2>&1 | grep -E "^\*|^< HTTP" | grep -vE "CAfile|CApath|^\*   Trying" | head -20`,
  String.raw`echo "-- no-verify"`,
  String.raw`curl -sk -m 10 -o /dev/null -w "insecure=%{http_code} ssl_verify=%{ssl_verify_result}\n" https://vpn.example.com/`,
  String.raw`echo "-- SNI 테스트: vpn IP 에 monitor SNI"`,
  String.raw`curl -sk -m 10 -o /dev/null -w "monitorSNI@vpnIP=%{http_code}\n" --resolve monitor.example.com:443:203.0.113.10 https://monitor.example.com/`,
  String.raw`echo "-- openssl"`,
  String.raw`echo | timeout 10 openssl s_client -connect 203.0.113.10:443 -servername vpn.example.com 2>&1 | grep -E "subject|issuer|Verify return"`,
];
const LONG_CMD = LONG_LINES.join("; ");
const lineObjs = (overLast) =>
  LONG_LINES.map((text, i) => ({
    text,
    ...(i < LONG_LINES.length - 1 ? { sep: ";" } : {}),
    effect: overLast && i === 8 ? "unknown" : "read",
    // 줄 안 표시 — Rust `line_marks` 가 싣는 꼴(코드 포인트 [start, end) — "echo | timeout 10 " 뒤의 openssl)
    ...(overLast && i === 8 ? { cause: "openssl", over: true, marks: [{ start: 18, end: 25, effect: "unknown" }] } : {}),
    ...(i % 2 === 1 ? { quiet: true } : {}),
  }));
const LONG_SUMMARY =
  "web-01에서 vpn.example.com 은 TCP 443 연결은 되지만 HTTPS 응답이 즉시 실패해, 시계·TLS 핸드셰이크·인증서·SNI 기반 차단 여부를 curl/openssl로 읽기 전용 확인합니다.";
const longPlan = (over) =>
  plan({
    operationId: "op-long", title: "web-01 TLS 실패 원인 확인", summary: LONG_SUMMARY, command: LONG_CMD,
    targets: ["s1"], expiresAt: NOW + 9 * 60000, effect: "read", ...over,
  });

/** 카드만 잘라 찍는다(배율 2) — 띠 · 줄 · 메타 줄의 모양을 눈으로 본다 */
const shotCard = async (name) => {
  const r = JSON.parse(await ev(`(() => { const b = document.querySelector('.rcard').getBoundingClientRect(); return JSON.stringify({ x: b.left, y: b.top, w: b.width, h: b.height }); })()`));
  const pad = 10;
  const p = path.join(outdir, name);
  const res = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: Math.max(0, r.x - pad), y: Math.max(0, r.y - pad), width: r.w + 2 * pad, height: r.h + 2 * pad, scale: 1 },
  });
  if (res.result?.data) {
    fs.writeFileSync(p, Buffer.from(res.result.data, "base64"));
    console.log("PNG " + path.resolve(p));
  } else console.log("capture failed: " + p);
};
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 2, mobile: false });
await sleep(400);

// ⑬-a 어긋남 — AI 는 '읽기' 라 했지만 9번째 줄(openssl)은 앱이 판단 못 함
await feed([longPlan({ mismatch: true, analysis: { effect: "unknown", cause: "openssl", programs: ["date", "echo", "curl", "grep", "head", "openssl"], lines: lineObjs(true) } })]);
const mm = await readCard();
console.log("CARD(mismatch)", JSON.stringify({ ...mm, buttons: mm.buttons }, null, 1));
check("⑬a 띠 — 실패색 · 9줄 중 1줄", [mm.tone, mm.band], ["err", "AI는 ‘읽기’라고 했지만 9줄 중 1줄은 앱이 판단 못 한 명령(openssl)"]);
check("⑬a 띠 오른쪽 — 만료 · 접기(이동은 한 건이라 없다)", [mm.expiry, mm.pos, mm.buttons[0]], ["9분 뒤 만료", null, "접기"]);
check("⑬a 줄로 나눠 본다 — 아홉 줄 · 흐린 줄 넷 · 두 줄 접기 상자는 없다", [mm.lines, mm.quiet, mm.cmd], [9, 4, null]);
check("⑬a AI 설명보다 센 줄 하나 — 끝 표지", mm.over, ["판단 못 함 · openssl — AI 설명보다 강함"]);
check("⑬a 줄 안 표시 낱말 — 9번째 줄의 openssl 하나", mm.words, ["openssl:unknown"]);
check("⑬a 효과 · 어긋남 · 프로그램 칩이 없다", mm.achips, []);
check("⑬a 메타 줄 — 대상 하나(먼저 없음)", [mm.meta.targets, mm.canary], ["대상 1s1", 0]);
check("⑬a 위험 테두리 · 실패색 테두리의 [실행 승인]", [mm.danger, mm.approve.cls.includes("danger-outline")], [true, true]);
const geoL = JSON.parse(await ev(`(() => {
  const card = document.querySelector('.rcard'); const c = card.getBoundingClientRect();
  const box = card.querySelector('[data-cmd-lines]'); const band = card.querySelector('.vband').getBoundingClientRect();
  return JSON.stringify({ inViewport: c.top >= 0 && c.bottom <= innerHeight, bandFlush: Math.abs(band.left - c.left) <= 1.5 && Math.abs(band.top - c.top) <= 1.5 && Math.abs(band.right - c.right) <= 1.5,
    boxScrolls: box.scrollHeight > box.clientHeight + 1, hOverflow: card.scrollWidth - card.clientWidth, h: Math.round(c.height) });
})()`));
console.log("GEO(mismatch)", JSON.stringify(geoL));
check("⑬a 카드가 창 안 · 띠가 가장자리까지 · 가로 넘침 0", [geoL.inViewport, geoL.bandFlush, geoL.hOverflow], [true, true, 0]);
await shotCard("review-card-mismatch.png");
// 나눠 보기에는 숨는 것이 없다 — 첫 [승인]은 펼치기가 아니라 확인 상태(위험)이고 안내 줄도 없다
await resetCalls();
await mouseClick(btn("실행 승인"));
const mmArmed = await readCard();
check("⑬a 첫 [승인] = 확인 상태 · 펼치기 안내 없음 · 승인 안 나감",
  [mmArmed.approve.text, mmArmed.hint, (await calls("approve_operation")).length], ["확인했습니다 — 실행", null, 0]);
await shotCard("review-card-mismatch-armed.png");
await ev(`document.querySelector('.rcard .approve').focus()`);
await key("Escape", "Escape", 27);
// 원문 보기 ⇄ 줄로 보기
await mouseClick(btn("원문 보기"));
const rawV = await readCard();
check("⑬a 원문 보기 — 명령 전문 그대로 · 줄 목록은 없다", [rawV.raw === LONG_CMD, rawV.lines], [true, 0]);
check("⑬a 원문 보기 단추가 '줄로 보기' 로", rawV.buttons.includes("줄로 보기"), true);
await shotCard("review-card-raw.png");
await mouseClick(btn("줄로 보기"));
check("⑬a 다시 줄로", (await readCard()).lines, 9);

// 작업안 갈래의 같은 카드(같은 조각 — 띠 · 나눠 보기 · 메타 줄) — 독을 열어 찍고 닫는다
await ev(`(async () => (await ${plansMod}).openPlans())()`);
await sleep(900);
const planCard = JSON.parse(await ev(`(() => { const li = document.querySelector('li.op[data-operation-id="op-long"]'); if (!li) return 'null';
  return JSON.stringify({ band: li.querySelector('.vband .vtext')?.textContent.trim() ?? null, lines: li.querySelectorAll('[data-cmd-lines] > li').length,
    chips: li.querySelectorAll('[data-chip]').length, meta: li.querySelector('[data-review-meta]')?.textContent.replace(/ /g, ' ').trim() ?? null }); })()`));
console.log("PLANCARD", JSON.stringify(planCard));
check("⑬a 작업안 카드 — 같은 띠 · 아홉 줄 · 칩 없음",
  [planCard?.band, planCard?.lines, planCard?.chips], ["AI는 ‘읽기’라고 했지만 9줄 중 1줄은 앱이 판단 못 한 명령(openssl)", 9, 0]);
{
  const r = JSON.parse(await ev(`(() => { const b = document.querySelector('li.op[data-operation-id="op-long"]').getBoundingClientRect(); return JSON.stringify({ x: b.left, y: b.top, w: b.width, h: b.height }); })()`));
  const res = await send("Page.captureScreenshot", { format: "png", clip: { x: r.x - 8, y: Math.max(0, r.y - 8), width: r.w + 16, height: Math.min(r.h + 16, 800), scale: 1 } });
  if (res.result?.data) { const p = path.join(outdir, "plans-card-mismatch.png"); fs.writeFileSync(p, Buffer.from(res.result.data, "base64")); console.log("PNG " + path.resolve(p)); }
}
await ev(`(async () => (await ${chatDockMod}).closeChatDock(false))()`);
await sleep(1200);

// ⑬-b 모두 읽기 · 일치 — 초록 띠 · 이유 단추
// classifyRisk(자문 정규식)는 `2>&1` 의 `>` 도 리다이렉트로 보고 위험이라 한다 — 초록 띠를 보려면 그것을 뺀 명령으로.
const OK_CMD = LONG_CMD.replaceAll(" 2>&1", "");
const okLines = lineObjs(false).map((l) => ({ ...l, text: l.text.replaceAll(" 2>&1", "") }));
await feed([longPlan({ operationId: "op-long-ok", command: OK_CMD, mismatch: false, reason: "어제부터 VPN 접속이 끊긴다는 보고가 있어서", analysis: { effect: "read", lines: okLines } })]);
const okc = await readCard();
check("⑬b 띠 — 초록 · 읽기만 · 일치", [okc.tone, okc.band], ["ok", "읽기만 하는 명령 · AI 설명과 일치"]);
check("⑬b 센 줄 없음 · 안전 승인 단추", [okc.over, okc.danger, okc.approve.cls.includes("btn-primary")], [[], false, true]);
check("⑬b 이유는 접혀 있다", okc.note, null);
await mouseClick(btn("요청 배경"));
check("⑬b [요청 배경] 이 연다", (await readCard()).note?.includes("어제부터 VPN") ?? false, true);
await shotCard("review-card-ok.png");
await mouseClick(btn("요청 배경"));

// ⑬-c 짧은 안전 명령 — 두 줄 접기 상자 그대로
await feed([plan({ operationId: "op-df", title: "디스크 여유 확인", summary: "web-01 의 디스크 사용량을 읽기만 합니다.", command: "df -h /var", effect: "read", mismatch: false, analysis: { effect: "read", programs: ["df"] }, cwd: "/var/log" })]);
const sc = await readCard();
check("⑬c 짧은 안전 — 초록 띠 · 접기 상자 · 줄 목록 없음", [sc.tone, sc.cmd, sc.lines, sc.clamped], ["ok", "df -h /var", 0, "false"]);
await shotCard("review-card-short.png");

// ⑬-d 짧은 위험 — 읽기라 했지만 find -delete · sudo
await feed([plan({ operationId: "op-find", title: "오래된 로그 정리", summary: "7일 지난 압축 로그를 찾습니다.", command: 'sudo find /var/log -name "*.gz" -mtime +7 -delete', effect: "read", mismatch: true, analysis: { effect: "delete", cause: "find -delete", programs: ["find"], sudo: true,
  // Rust 가 읽기 아닌 한 줄 명령에도 줄 하나를 싣는다 — 줄 안 표시(find · -delete)까지
  lines: [{ text: 'sudo find /var/log -name "*.gz" -mtime +7 -delete', effect: "delete", cause: "find -delete", over: true,
    marks: [{ start: 0, end: 4, effect: "delete", kind: "sudo" }, { start: 5, end: 9, effect: "delete" }, { start: 42, end: 49, effect: "delete" }] }] }, targets: ["s1", "s2"] })]);
const fd = await readCard();
check("⑬d 띠 — 원문에 삭제(find -delete)", [fd.tone, fd.band], ["err", "AI는 ‘읽기’라고 했지만 원문에 삭제(find -delete)"]);
check("⑬d 메타 줄 — sudo · 대상 둘(먼저)", [fd.meta.sudo, fd.canary], ["sudo", 1]);
check("⑬d 한 행 · 줄 안 표시 — sudo(경고색) · find · -delete (실패색)", [fd.lines, fd.words], [1, ["sudo:sudo", "find:delete", "-delete:delete"]]);
check("⑬d 표시 낱말은 굵게 · 실패색", await ev(`(() => { const e = document.querySelector('.rcard [data-line-word="delete"]'); const cs = getComputedStyle(e);
  const probe = document.createElement('span'); probe.style.color = 'var(--err)'; document.body.append(probe); const err = getComputedStyle(probe).color; probe.remove();
  return [cs.fontWeight, cs.color === err]; })()`), ["700", true]);
await shotCard("review-card-find.png");
await mouseClick(btn("실행 승인"));
await shotCard("review-card-find-armed.png");
await ev(`document.querySelector('.rcard .approve').focus()`);
await key("Escape", "Escape", 27);

// ── ⑭ (10-24 실기 피드백) sudo 낱말 · heredoc · DB 문장 나눠 보기 — 분석 JSON 은 Rust 가 실제로 낸 것(`print_sample_lines_json`) ──
const J_SUDO = {"effect":"read","programs":["journalctl"],"tokens":[{"text":"journalctl","effect":"read"}],"sudo":true,"lines":[{"text":"sudo journalctl -n 50 --no-pager","effect":"read","marks":[{"start":0,"end":4,"effect":"read","kind":"sudo"}]}]};
const HEREDOC_CMD = "cat <<'EOF' > /dev/null\n점검 메모 — 2026-10-24\nline; two && three\nEOF\nwc -l /var/log/syslog";
const J_HEREDOC = {"effect":"read","programs":["cat","wc"],"tokens":[{"text":"cat","effect":"read"},{"text":"wc","effect":"read"}],"sudo":false,"lines":[{"text":"cat <<'EOF' > /dev/null\n점검 메모 — 2026-10-24\nline; two && three\nEOF","sep":"\n","effect":"read"},{"text":"wc -l /var/log/syslog","effect":"read"}]};
const J_DB_DEL = {"effect":"delete","cause":"DELETE sessions","sudo":false,"statements":[{"keyword":"DELETE","table":"sessions","whereClause":false,"effect":"delete"}],"lines":[{"text":"DELETE FROM sessions","sep":";","effect":"delete","cause":"DELETE sessions · WHERE 없음","marks":[{"start":0,"end":6,"effect":"delete"},{"start":12,"end":20,"effect":"delete"}],"danger":true}]};
const J_DB_UPD = {"effect":"write","cause":"UPDATE accounts","sudo":false,"statements":[{"keyword":"UPDATE","table":"accounts","whereClause":true,"effect":"write"}],"lines":[{"text":"UPDATE accounts SET plan = 'pro' WHERE id = 42","sep":";","effect":"write","cause":"UPDATE accounts","marks":[{"start":0,"end":6,"effect":"write"},{"start":7,"end":15,"effect":"write"}]}]};
/** 줄 판 · 띠 · 표지 — 행마다 (data-line-mark · 판 배경이 투명한가 · 표지 글자) */
const rowLooks = async () =>
  JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('.rcard [data-cmd-lines] > li')].map((li) => ({
    mark: li.dataset.lineMark, clear: getComputedStyle(li).backgroundColor === 'rgba(0, 0, 0, 0)' && getComputedStyle(li).boxShadow === 'none',
    tag: li.querySelector('[data-line-tag]')?.textContent.replace(/\u00a0/g, ' ').trim() ?? null })))`));
/** 표시 낱말의 색이 그 토큰 색인가 — [굵기, 같은 색] */
const wordColor = (sel, token) => ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; const cs = getComputedStyle(e);
  const probe = document.createElement('span'); probe.style.color = 'var(${token})'; document.body.append(probe); const want = getComputedStyle(probe).color; probe.remove();
  return [cs.fontWeight, cs.color === want]; })()`);

// ⑭-a sudo 읽기 한 줄 — 낱말 sudo 만 경고색, 줄 판 · 띠 · 표지는 없다
await feed([plan({ operationId: "op-sudo", title: "최근 시스템 로그", summary: "journalctl 최근 50줄을 읽기만 합니다.", command: "sudo journalctl -n 50 --no-pager", effect: "read", mismatch: false,
  analysis: J_SUDO })]);
const su = await readCard();
// 띠는 초록 — 앱 분석이 읽기로 확정하면 카드 자문 판정이 sudo 를 걷는다(10-24 사용자 결정 · 자동 승인 목록은 그대로)
check("⑭a 초록 띠 · 한 행 · 낱말 sudo 하나", [su.tone, su.band, su.lines, su.words], ["ok", "읽기만 하는 명령 · AI 설명과 일치", 1, ["sudo:sudo"]]);
check("⑭a 읽기 행 — 판 · 띠 · 표지 없음", await rowLooks(), [{ mark: "none", clear: true, tag: null }]);
check("⑭a sudo 낱말 — 굵게 · 경고색", await wordColor(".rcard [data-line-word='sudo']", "--warn"), ["700", true]);
check("⑭a 보통 승인 단추(위험 테두리 없음)", su.approve.cls.includes("danger-outline"), false);
await shotCard("review-card-sudo.png");

// ⑭-b heredoc — cat 은 읽기(초록) · 본문은 연 줄의 한 행(나누지 않음) · 아무것도 칠하지 않는다
await feed([plan({ operationId: "op-heredoc", title: "메모 확인", summary: "메모를 표준 입력으로 넘기고 syslog 줄 수를 셉니다.", command: HEREDOC_CMD, effect: "read", mismatch: false,
  analysis: J_HEREDOC })]);
const hd = await readCard();
check("⑭b 초록 띠 · 두 행(본문은 첫 행 안) · 표시 낱말 없음", [hd.tone, hd.lines, hd.words], ["ok", 2, []]);
check("⑭b 첫 행이 본문 · 구분 줄까지 품는다", await ev(`document.querySelector('.rcard [data-cmd-lines] > li .text').textContent.endsWith('EOF')`), true);
check("⑭b 행 모두 판 없음", (await rowLooks()).map((r) => r.mark), ["none", "none"]);
await shotCard("review-card-heredoc.png");

// ⑭-c DB — WHERE 없는 DELETE: 나눠 보기 · DELETE · 테이블 실패색 · 행 err · "… · WHERE 없음" 표지 · 상한 칩만
const dbPlan = (sql, over) => plan({
  operationId: "op-db", title: null, command: `${sql};`, targets: ["db:pg1"], mode: "db", strategy: "transaction",
  db: { connId: "pg1", connName: "운영 PG", engine: "postgres", throughSsh: false, database: "app",
    statements: [{ sql, keyword: sql.split(" ")[0], counted: true, uncounted: false }], maxAffected: 500, timeoutSeconds: 30 },
  ...over,
});
await feed([dbPlan("DELETE FROM sessions", { summary: "만료된 세션을 지웁니다.", effect: "delete", mismatch: false, analysis: J_DB_DEL })]);
const dd = await readCard();
check("⑭c 띠 — WHERE 없음(실패색)", dd.tone, "err");
check("⑭c 나눠 보기 한 행 · 접기 상자 없음 · DELETE · sessions 표시", [dd.lines, dd.cmd, dd.words], [1, null, ["DELETE:delete", "sessions:delete"]]);
check("⑭c 행 err · 표지 '… · WHERE 없음'", await rowLooks(), [{ mark: "err", clear: false, tag: "삭제 · DELETE sessions · WHERE 없음" }]);
check("⑭c 표시 낱말 — 굵게 · 실패색", await wordColor(".rcard [data-line-word]", "--err"), ["700", true]);
check("⑭c 칩은 상한 하나 · DB 머리줄", [dd.achips, await ev(`!!document.querySelector('.rcard [data-review-db]')`)], [["limit"], true]);
check("⑭c 위험 — 첫 [승인] 은 확인 상태(펼치기 아님)", dd.danger, true);
await shotCard("review-card-db-delete.png");
await resetCalls();
await mouseClick(btn("실행 승인"));
const ddArmed = await readCard();
check("⑭c 첫 [승인] = 확인 상태 · 펼치기 안내 없음", [ddArmed.approve.text, ddArmed.hint, (await calls("approve_operation")).length], ["확인했습니다 — 실행", null, 0]);
await ev(`document.querySelector('.rcard .approve').focus()`);
await key("Escape", "Escape", 27);

// ⑭-d DB — WHERE 있는 UPDATE: 경고색 행 · UPDATE · 테이블 경고색 · 안전 승인(한 번)
await feed([dbPlan("UPDATE accounts SET plan = 'pro' WHERE id = 42", { operationId: "op-db2", summary: "42번 계정의 요금제를 pro 로 바꿉니다.", effect: "write", mismatch: false, analysis: J_DB_UPD })]);
const du = await readCard();
check("⑭d 띠 중성 · 한 행 · UPDATE · accounts 경고색", [du.tone, du.lines, du.words], ["neutral", 1, ["UPDATE:write", "accounts:write"]]);
check("⑭d 행 warn · 표지", (await rowLooks()).map((r) => [r.mark, r.tag]), [["warn", "쓰기 · UPDATE accounts"]]);
check("⑭d 안전 승인 단추", [du.danger, du.approve.cls.includes("btn-primary")], [false, true]);
await shotCard("review-card-db-update.png");
await resetCalls();
await mouseClick(btn("실행 승인"));
check("⑭d 한 번에 승인", (await calls("approve_operation")).length, 1);

await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await sleep(300);
// ⑪ 이 앞 상태(대기 둘)로 되돌린다
await feed([plan({ operationId: "op-new", title: "새 요청", command: "uptime" }), plan({ operationId: "op-s", title: "안전", command: "uptime" })]);

// ── ⑪ 가림막 — 개수만, 가림막 위 ──────────────────────────────────────────────
await ev(`(async () => (await ${importApp("app/veil.svelte.ts")}).openVeil())()`);
await sleep(900);
const v = await readCard();
console.log("CARD(veiled)", JSON.stringify(v, null, 1));
check("⑪ 가림막이 섰다", await ev(`document.querySelectorAll('.veil').length`), 1);
check("⑪ 개수 한 줄만", [v.veiled, v.count], [true, "검토 대기 2건"]);
check("⑪ 명령·제목·대상·단추가 없다", [v.cmd, v.title, v.tcount, v.buttons], [null, null, null, []]);
check("⑪ z: 가림막 115 < 한 줄 118 < 토스트 120",
  [await ev(`getComputedStyle(document.querySelector('.veil')).zIndex`), v.z], ["115", "118"]);
check("⑪ 가림막 위에 실제로 보인다",
  await ev(`(() => { const c = document.querySelector('.rcard').getBoundingClientRect(); const e = document.elementFromPoint((c.left + c.right) / 2, (c.top + c.bottom) / 2); return !!e?.closest('.rcard'); })()`), true);
await shot("review-card-veiled.png");

// ── ⑫ 오류 0 ───────────────────────────────────────────────────────────────
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑫ 잡히지 않은 예외·콘솔 오류 0", errors.length, 0);

console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
