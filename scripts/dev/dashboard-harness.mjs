// 헤드리스 검증 — **대시보드** (docs/log/2026-09-25-dashboard.md).
//
// 관리뷰(오른쪽 패널)를 흡수한 전체 화면 대시보드가 약속한 것만 본다:
// ① 토글(`Ctrl+Shift+M`)로 열리고 **타일 캔버스(`.pane`)를 정확히 덮는다** — 탭 바·상태바는
//    그대로 보이고 판은 불투명하다 · ② 타일은 **그 밑에서 마운트된 채** 남고 크기를 다시 재지
//    않는다(`resize_session` 호출 수가 그대로다) · ③ 열리면 키보드가 대시보드로 온다 ·
// ④ Escape 로 닫히고 키보드는 터미널로 돌아간다 · ⑤ 탭 바의 탭을 누르면 그 탭이 서고 대시보드가
//    걷힌다(지금 탭을 눌러도 걷힌다) · ⑥ 세션 칸의 카드를 누르면(= `focusTile`) 걷힌다 ·
// ⑦ `openConsoleAt('operations')` 는 작업안 칸으로 연다(보기 둘: 진행 · 기록 — 비교 · 행렬은 2026-10-25 에 걷었다) · ⑧ 검토 카드는
//    **작업안 칸에서만** 물러난다(세션 칸에서는 선다) · ⑨ 같은 키로 닫힌다 ·
// ⑩ 여닫기 움직임(docs/log/2026-09-29-dashboard-motion.md) — 열 때 판·덩어리 애니메이션이 돌고, 닫으면
//    상태·포커스는 즉시이고 판은 `inert` 로 흐려지다 숨는다 · 흐려지는 도중에 다시 열린다 · 칸 전환은
//    본문만 짧게 · 움직임 줄이기면 애니메이션 0 · 그동안 크기 재조정 없음 ·
// ⑪ 세션 카드의 화면 축소판(docs/log/2026-09-29-dashboard-thumbs.md) — 세션 여덟 · 카드마다 축소판(색 토막 · 132px ·
//    300px 이상 · 상태 줄과 아랫줄 사이) · 떠 있을 때만 1초 갱신(스냅샷 호출 수) · 비용 · 간단히 전환(축소판 없음 ·
//    다시 열어도 · 새로 고쳐도 기억) — 캡처 dashboard-{thumbs,compact}-{dark,light}.png · 마지막에 콘솔 예외 0.
// **닫는 중인 판은 닫힌 것으로 센다** — `hidden` 이 아니어도 `inert` 면 닫혔다(`dashOpen`).
//
// 여는 움직임의 세 장면(0 · 150 · 400ms — 멈춘 뒤 시각을 옮겨 찍는다)은 `FRAMES_DIR`(없으면
// outdir)에 남긴다: dash-open-000.png · dash-open-150.png · dash-open-400.png.
// (2026-09-28 — 칸이 세션 · 작업안 · 사용량 셋이 됐다: docs/log/2026-09-28-dashboard-session-cards.md)
//
// 스텁은 `review-card-harness.mjs` 의 사본이다(로컬 셸 + `list_operations` 한 칸).
//
// usage:
//   npx vite --port 1437 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9265 --user-data-dir=%TEMP%/edge-aynx-dash \
//     --window-size=1200,800 http://localhost:1437/
//   PAGE_PORT=1437 node scripts/dev/dashboard-harness.mjs <outdir> 9265
//     → <outdir>/dashboard-sessions.png · dashboard-operations.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9265"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1437";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
let counting = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (counting && d.method === "Runtime.exceptionThrown") {
    const s = (d.params.exceptionDetails.exception?.description ?? "").split("\n")[0];
    if (!/stub:/.test(s)) errors.push(s);
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
const key = async (code, modifiers, keyName, wait = 300) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : code === "Escape" ? 27 : 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(wait);
};
/** 앱이 실제로 적재한 모듈 인스턴스 — URL 을 손으로 적으면 `$state` 를 공유하지 않는 사본이 생긴다 */
const importApp = (frag) =>
  `import(performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('${frag}')))`;

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
  let nextSession = 100;
  window.__ops = { pending: [], recent: [] };
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false } };
  window.__vault = { state: 'unlocked', hasMaster: false, entryCount: 0 };
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null, list_forwards: [],
    reap_window_sessions: null, session_log_path: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    vault_list: [], vault_lock: null, mcp_activity: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
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
  // blocks-harness 와 같은 주입 통로 — 그 세션의 채널로 글을 흘린다(⑪ 축소판)
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; const buf = new TextEncoder().encode(text).buffer; cb({ message: buf, index: c.idx++ }); return 'ok'; };
`,
});
// 세션 칸 보기의 저장값을 비운다 — 새로 읽힌 앱이 기본(축소판)으로 서게(⑪)
await ev(`try { localStorage.removeItem('aynx:dashboard:session-view'); } catch {}`);
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await sleep(2200);
counting = true;

// ── 준비 — 탭 둘, 탭마다 로컬 셸 타일 하나 ───────────────────────────────────
const tabCount = () => ev(`document.querySelectorAll('.titlebar [role="tab"]').length`);
const xtermCount = () => ev(`document.querySelectorAll('.xterm').length`);
if ((await xtermCount()) === 0) {
  await key("KeyN", 10, "N"); // new-shell — 지금 탭에 셸
  await sleep(900);
}
await key("KeyT", 10, "T"); // new-tab — 새 탭
await sleep(500);
await key("KeyN", 10, "N");
await sleep(1200);
console.log("setup:", JSON.stringify({ tabs: await tabCount(), xterms: await xtermCount() }));
check("준비: 탭 둘 · 터미널 둘", [await tabCount() >= 2, await xtermCount() >= 2], [true, true]);

/** 떠 있는가 — 닫힌 뒤 흐려지는 판(`inert`)은 닫힌 것이다 */
const dashOpen = () => ev(`(() => { const c = document.querySelector('.console'); return !!c && !c.hidden && !c.inert; })()`);
const activeTab = () =>
  ev(`[...document.querySelectorAll('.titlebar [role="tab"]')].findIndex((b) => b.getAttribute('aria-selected') === 'true')`);
const resizeCalls = () => ev(`window.__calls.filter(([c]) => c === 'resize_session').length`);
const focusInTerminal = () => ev(`!!document.activeElement?.closest('.xterm')`);

// 터미널에 키보드를 준다 — 닫힌 뒤 "돌아가는 자리" 를 확인하려면 열기 전 자리가 터미널이어야 한다.
await ev(`document.querySelectorAll('.xterm textarea')[document.querySelectorAll('.xterm textarea').length - 1]?.focus()`);
await sleep(200);
check("열기 전 키보드는 터미널에 있다", await focusInTerminal(), true);

// ── ① 토글로 연다 · 캔버스를 정확히 덮는다 ───────────────────────────────────
const xtermsBefore = await xtermCount();
const resizeBefore = await resizeCalls();
await key("KeyM", 10, "M"); // Ctrl+Shift+M
await sleep(700);
check("Ctrl+Shift+M → 대시보드가 선다", await dashOpen(), true);
const geo = JSON.parse(await ev(`(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return [b.left, b.top, b.right, b.bottom].map(Math.round); };
  return JSON.stringify({ dash: r('.console'), pane: r('.pane'), title: r('.titlebar'), bar: r('.statusbar'),
    bg: getComputedStyle(document.querySelector('.console')).backgroundColor });
})()`));
console.log("geometry:", JSON.stringify(geo));
check("판의 상자 = 타일 캔버스(`.pane`)의 상자", geo.dash, geo.pane);
check("탭 바는 판 위에 그대로 보인다", geo.dash[1] >= geo.title[3], true);
check("상태바(아래)는 판 밖이다", geo.dash[3] <= geo.bar[1], true);
check("판은 불투명하다 (알파 없음)", /^rgb\(/.test(geo.bg), true);
check("판 한가운데의 요소는 대시보드다 (타일이 비치거나 뚫고 나오지 않는다)", await ev(`(() => {
  const d = document.querySelector('.console').getBoundingClientRect();
  return !!document.elementFromPoint(d.left + d.width / 2, d.top + d.height / 2)?.closest('[data-dashboard]');
})()`), true);

// ── ② 타일은 마운트된 채 · 크기를 다시 재지 않는다 ─────────────────────────────
check("터미널은 DOM 에 그대로 있다", await xtermCount(), xtermsBefore);
check("캔버스는 접히지 않았다 (`.pane main` 높이 > 0)", await ev(`document.querySelector('.pane main').getBoundingClientRect().height > 0`), true);
check("xterm 크기 재조정 없음 (resize_session 호출 수 그대로)", await resizeCalls(), resizeBefore);

// ── ③ 키보드가 대시보드로 온다 ───────────────────────────────────────────────
check("열리면 키보드가 대시보드 안에 있다", await ev(`!!document.activeElement?.closest('[data-dashboard]')`), true);
check("칸 단추 둘 — 세션 · 작업안 (사용량은 제 화면으로 · 2026-10-04)", await ev(`[...document.querySelectorAll('.console .section-seg .seg-btn')].map((b) => b.textContent.trim().replace(/\\d+$/, ''))`), ["세션", "작업안"]);
check("새 창의 토글은 세션 칸으로 연다", await ev(`document.querySelector('.console')?.dataset.section`), "sessions");
check("세션 칸에는 하위 모드가 없다 (머리줄의 단추 줄은 칸 막대 하나)", await ev(`document.querySelectorAll('.console .head .seg').length`), 1);
await shot("dashboard-sessions.png");

// ── ④ Escape 로 닫힌다 · 키보드는 터미널로 ────────────────────────────────────
await key("Escape", 0, "Escape");
check("Escape → 닫힌다", await dashOpen(), false);
check("닫히면 키보드는 열기 전의 터미널로 돌아간다", await focusInTerminal(), true);
check("여닫는 동안 크기 재조정 없음", await resizeCalls(), resizeBefore);

// ── ⑤ 탭 바의 탭을 누르면 걷힌다 ─────────────────────────────────────────────
const tabBefore = await activeTab();
await key("KeyM", 10, "M");
await sleep(400);
const otherIdx = tabBefore === 0 ? 1 : 0;
await ev(`document.querySelectorAll('.titlebar [role="tab"]')[${otherIdx}].click()`);
await sleep(500);
check("다른 탭을 누르면 → 대시보드가 걷히고", await dashOpen(), false);
check("그 탭이 선다", await activeTab(), otherIdx);
await sleep(300);
check("그 탭의 터미널이 키보드를 받는다", await focusInTerminal(), true);

await key("KeyM", 10, "M");
await sleep(400);
await ev(`document.querySelectorAll('.titlebar [role="tab"]')[${otherIdx}].click()`);
await sleep(500);
check("지금 탭을 눌러도 걷힌다", [await dashOpen(), await activeTab()], [false, otherIdx]);
await sleep(300);
check("지금 탭을 눌렀을 때도 키보드는 터미널로 (대시보드 안에서 잃은 포커스를 되찾는다)", await focusInTerminal(), true);

// ── ⑥ 세션 칸의 카드 = focusTile → 걷힌다 ────────────────────────────────────
await key("KeyM", 10, "M");
await sleep(900);
console.log("cards:", await ev(`document.querySelectorAll('.console [data-session-card]').length`));
const clicked = await ev(`(() => {
  const c = document.querySelector('.console [data-session-card]');
  if (!c) return 'no card';
  c.click();
  return 'clicked';
})()`);
await sleep(500);
check("세션 카드를 누르면(focusTile) 대시보드가 걷힌다", [clicked, await dashOpen()], ["clicked", false]);

// ── ⑦ openConsoleAt('operations') → 작업안 칸 · ⑧ 검토 카드 ──────────────────
const NOW = Date.now();
await ev(`window.__ops = { pending: [${JSON.stringify({
  operationId: "op-1", command: "systemctl reload nginx", targets: ["s1", "s2"], cwd: null, validate: null,
  mode: "exec", strategy: "sequential", concurrency: 1, timeoutSeconds: 60, state: "awaitingApproval",
  createdAt: NOW, requestedAt: NOW, expiresAt: NOW + 12 * 60_000, title: "nginx 설정 재적용", reason: null,
  idempotencyKey: null,
})}], recent: [] }`);
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(900);
const cards = () => ev(`document.querySelectorAll('.rcard').length`);
check("대시보드가 닫혀 있으면 검토 카드가 선다", await cards(), 1);
await key("KeyM", 10, "M");
await sleep(400);
check("세션 칸의 대시보드 위에서도 카드가 선다", [await ev(`document.querySelector('.console')?.dataset.section`), await cards()], ["sessions", 1]);
await key("KeyM", 10, "M"); // 닫는다 (같은 키)
await sleep(300);
check("같은 키로 닫힌다", await dashOpen(), false);
await ev(`(async () => { (await ${importApp("app/console.svelte")}).openConsoleAt('operations'); })()`);
await sleep(2600); // 작업안 폴링 한 바퀴
check("openConsoleAt('operations') → 작업안 칸", [await dashOpen(), await ev(`document.querySelector('.console')?.dataset.section`)], [true, "operations"]);
check("작업안 카드가 목록에 있다", await ev(`document.querySelectorAll('.console [data-operation-id="op-1"]').length`), 1);
check("작업안 칸이 보이면 검토 카드는 물러난다", await cards(), 0);
check("작업안 칸의 보기 둘 — 진행 · 기록 (진행이 눌려 있다 · 2026-10-25 비교 · 행렬 걷음)",
  await ev(`JSON.stringify([...document.querySelectorAll('.console [data-ops-view]')].map((b) => [b.textContent.replace(/\\d+$/, '').trim(), b.getAttribute('aria-pressed')]))`),
  JSON.stringify([["진행", "true"], ["기록", "false"]]));
await shot("dashboard-operations.png");
await ev(`document.querySelector('.console [data-ops-view="history"]').click()`);
await sleep(300);
check("기록 보기 — 작업안 칸 안에서 · 검토 카드는 여전히 물러나 있다", [await ev(`document.querySelector('.console .body')?.dataset.view`), await cards()], ["history", 0]);
await ev(`document.querySelector('.console [data-ops-view="list"]').click()`);
await ev(`document.querySelector('.console [data-section-btn="sessions"]').click()`);
await sleep(400);
check("세션 칸으로 돌아가면 카드가 돌아온다", await cards(), 1);
await key("Escape", 0, "Escape");
check("Escape 로 닫힌다 (칸과 무관)", await dashOpen(), false);

// ── ⑩ 여닫기 움직임 ──────────────────────────────────────────────────────────
await sleep(400);
const resizeMotion = await resizeCalls();
/** 판 · 판 안의 요소 · 본문의 애니메이션 수와 판의 상태 */
const motion = () => ev(`JSON.stringify((() => {
  const c = document.querySelector('.console');
  const inner = [...c.querySelectorAll('*')].reduce((n, e) => n + e.getAnimations().length, 0);
  return { hidden: c.hidden, inert: c.inert, closing: c.hasAttribute('data-closing'), pe: getComputedStyle(c).pointerEvents,
    panel: c.getAnimations().length, inner, body: c.querySelector('.body').getAnimations().length,
    opacity: +(+getComputedStyle(c).opacity).toFixed(2) };
})())`).then(JSON.parse);
await ev(`document.querySelectorAll('.xterm textarea')[document.querySelectorAll('.xterm textarea').length - 1]?.focus()`);
await key("KeyM", 10, "M", 60);
let mo = await motion();
console.log("open+60ms:", JSON.stringify(mo));
check("열 때 — 판의 애니메이션 하나 · 덩어리 셋 이상이 돈다", [mo.panel, mo.inner >= 3, mo.hidden, mo.inert], [1, true, false, false]);
await sleep(1100);
mo = await motion();
check("다 열린 뒤 — 애니메이션이 남지 않고 불투명도 1", [mo.panel, mo.inner, mo.opacity], [0, 0, 1]);
check("열린 뒤 키보드는 대시보드 안", await ev(`!!document.activeElement?.closest('[data-dashboard]')`), true);

// 칸 전환 — 본문만 짧게
await ev(`document.querySelector('.console [data-section-btn="operations"]').click()`);
await sleep(40);
check("칸 전환 → 본문의 애니메이션 하나 (판은 그대로)", [(await motion()).body, (await motion()).panel], [1, 0]);
await ev(`document.querySelector('.console [data-section-btn="sessions"]').click()`);
await sleep(400);

// 닫기 — 상태·포커스는 즉시, 판은 inert 로 흐려지다 숨는다
await key("Escape", 0, "Escape", 40);
mo = await motion();
console.log("close+40ms:", JSON.stringify(mo));
check("닫는 순간 — 닫힌 것으로 센다 (inert · data-closing · pointer-events none · 아직 hidden 아님)",
  [await dashOpen(), mo.inert, mo.closing, mo.pe, mo.hidden, mo.panel], [false, true, true, "none", false, 1]);
check("닫는 순간 — 키보드는 이미 터미널로", await focusInTerminal(), true);
await sleep(350);
mo = await motion();
check("흐려진 뒤 — hidden · 애니메이션 없음", [mo.hidden, mo.closing, mo.panel], [true, false, 0]);

// 흐려지는 도중에 다시 연다
await key("KeyM", 10, "M", 900);
await key("Escape", 0, "Escape", 60);
await key("KeyM", 10, "M", 30);
mo = await motion();
console.log("reopen mid-close:", JSON.stringify(mo));
check("닫히던 판을 다시 열면 — 곧바로 떠 있다 (inert·data-closing 없음)", [await dashOpen(), mo.closing, mo.hidden], [true, false, false]);
await sleep(1100);
mo = await motion();
check("다시 연 뒤 — 끝까지 열리고 키보드는 대시보드 안",
  [mo.hidden, mo.opacity, mo.panel, await ev(`!!document.activeElement?.closest('[data-dashboard]')`)], [false, 1, 0, true]);
await key("Escape", 0, "Escape", 400);
check("그리고 다시 닫힌다", [(await motion()).hidden, await focusInTerminal()], [true, true]);

// 여는 움직임의 세 장면 — 판 안의 애니메이션을 멈추고 시각을 옮겨 찍는다
const framesDir = process.env.FRAMES_DIR ?? outdir;
fs.mkdirSync(framesDir, { recursive: true });
await key("KeyM", 10, "M", 0);
await ev(`(() => { const c = document.querySelector('.console'); window.__dmAnims = [c, ...c.querySelectorAll('*')].flatMap((e) => e.getAnimations()); window.__dmAnims.forEach((a) => a.pause()); return window.__dmAnims.length; })()`);
for (const ms of [0, 150, 400]) {
  await ev(`window.__dmAnims.forEach((a) => (a.currentTime = ${ms}))`);
  await sleep(120);
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = path.join(framesDir, `dash-open-${String(ms).padStart(3, "0")}.png`);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log("PNG " + path.resolve(p), "opacity", await ev(`getComputedStyle(document.querySelector('.console')).opacity`));
}
await ev(`window.__dmAnims.forEach((a) => a.finish()); delete window.__dmAnims`);
await sleep(200);
await key("Escape", 0, "Escape", 400);

// 움직임 줄이기 — 애니메이션 0, 여닫기가 즉시
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await key("KeyM", 10, "M", 40);
mo = await motion();
check("움직임 줄이기 — 열 때 애니메이션 0 · 곧바로 불투명도 1", [await dashOpen(), mo.panel, mo.inner, mo.opacity], [true, 0, 0, 1]);
await key("Escape", 0, "Escape", 40);
mo = await motion();
check("움직임 줄이기 — 닫으면 곧바로 hidden", [mo.hidden, mo.panel], [true, 0]);
await send("Emulation.setEmulatedMedia", { features: [] });

check("움직이는 동안에도 크기 재조정 없음 (resize_session 호출 수 그대로)", await resizeCalls(), resizeMotion);

// ── ⑪ 세션 카드의 화면 축소판 (docs/log/2026-09-29-dashboard-thumbs.md) ──────────────────────
//
// 세션 여덟(탭 셋)을 세우고 넷에 색 출력(글자색 · 바탕색 · 반전 · 256색 · RGB · 대체 화면)을 먹인다. 축소판 보기(기본)에서
// 카드마다 축소판 · 색 토막 · 폭(300px 이상) · 높이 132px 을 보고, 간단히로 바꾸면 사라지고(다시 열어도 · 새로 고쳐도
// 기억한다), 축소판은 대시보드가 떠 있고 축소판 보기일 때만 1초마다 다시 읽힌다(스냅샷 호출 수로 센다). 비용도 잰다.
{
  const ESC = "\x1b";
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  // ⑦ 의 검토 대기를 걷는다 — 화면 아래 검토 카드가 캡처를 가리지 않게
  await ev(`window.__ops = { pending: [], recent: [] }; window.dispatchEvent(new Event('focus'))`);
  await sleep(1500);
  // 탭 둘에 셸 하나씩 있다 — 지금 탭에 셋, 새 탭에 셋을 더해 여덟
  for (let i = 0; i < 3; i += 1) { await key("KeyN", 10, "N", 900); }
  await key("KeyT", 10, "T", 500);
  for (let i = 0; i < 3; i += 1) { await key("KeyN", 10, "N", 900); }
  await sleep(800);
  const sids = JSON.parse(await ev(`JSON.stringify(Object.keys(window.__chan))`));
  console.log("sessions:", sids.length, "xterms:", await xtermCount());
  check("⑪ 준비: 세션 여덟", sids.length, 8);

  const vimish =
    `${ESC}[?1049h${ESC}[2J${ESC}[H` +
    `${ESC}[38;5;33mimport${ESC}[0m { tick } ${ESC}[38;5;33mfrom${ESC}[0m ${ESC}[32m"svelte"${ESC}[0m;\r\n\r\n` +
    `${ESC}[38;5;33mexport function${ESC}[0m ${ESC}[38;2;255;170;0mpreviewLines${ESC}[0m(text) {\r\n  ${ESC}[31mreturn${ESC}[0m text.split(${ESC}[32m"\\n"${ESC}[0m);\r\n}\r\n` +
    `${ESC}[34m~${ESC}[0m\r\n${ESC}[34m~${ESC}[0m\r\n${ESC}[7m NORMAL ${ESC}[0m screen-thumb.ts  3,12  All`;
  const htopish =
    `${ESC}[2J${ESC}[H  1[${ESC}[42m||||||||||||${ESC}[0m${ESC}[41m||||${ESC}[0m      48.2%]\r\n  Mem[${ESC}[44m||||||||||||||||${ESC}[0m 3.1G/8G]\r\n` +
    `${ESC}[7m  PID USER      CPU%  COMMAND        ${ESC}[0m\r\n  812 deploy    12.0  ${ESC}[32mnode app.js${ESC}[0m\r\n  977 postgres   3.2  postgres: writer\r\n`;
  const logish = Array.from({ length: 30 }, (_, i) =>
    `Sep 29 10:${String(i).padStart(2, "0")} app[812]: ${i % 7 === 3 ? `${ESC}[31mERROR${ESC}[0m` : `${ESC}[32mINFO${ESC}[0m`} GET /api/v1/items ${i}\r\n`).join("");
  // 실패 — OSC 133 한 벌(A/B/C/D;1)로 먹여 카드가 실패가 되게(blocks-harness 의 관용구)
  const BEL = "\x07";
  const failish =
    `${ESC}]133;A${BEL}PS C:\\src\\aynx> ${ESC}]133;B${BEL}npm run check:cycles\r\n${ESC}]133;C${BEL}\r\n> aynx@0.1.0 check:cycles\r\n> node scripts/check-cycles.mjs\r\n\r\n` +
    `${ESC}[31m✕ 1 cycle found:${ESC}[0m\r\n${ESC}[31m  src/lib/a.ts → src/lib/b.ts → src/lib/a.ts${ESC}[0m\r\n` +
    `${ESC}]133;D;1${BEL}${ESC}]133;A${BEL}PS C:\\src\\aynx> ${ESC}]133;B${BEL}`;
  const texts = [vimish, htopish, logish, failish];
  for (let i = 0; i < texts.length; i += 1) console.log("feed", sids[i], await ev(`window.__feed(${sids[i]}, ${JSON.stringify(texts[i])})`));
  for (let i = texts.length; i < sids.length; i += 1) await ev(`window.__feed(${sids[i]}, ${JSON.stringify(`PS C:\\Users\\me> git status\r\nOn branch main\r\nnothing to commit, working tree clean\r\nPS C:\\Users\\me> `)})`);
  await sleep(800);

  // 스냅샷 호출을 센다 — 타일마다 창구의 screenSnapshot 을 감싼다
  const termMod = `(async () => { const url = performance.getEntriesByType('resource').map((r) => r.name).find((u) => /lib\\/term-actions\\.ts/.test(u)); return url ? await import(url) : null; })()`;
  // 1초 시계 한 번(판 다시 짓기 + DOM 갱신 + 강제 배치)을 잰다 — 대시보드가 시계를 세우기 전에 setInterval 을 감싼다
  await ev(`(() => {
    if (window.__tickWrapped) return 'already';
    window.__tickWrapped = true; window.__ticks = [];
    const orig = window.setInterval;
    window.setInterval = function (cb, ms, ...rest) {
      // SessionBoard 의 축소판 시계만 — 앱의 다른 1초 시계(경과 등)는 재지 않는다
      if (ms !== 1000 || typeof cb !== 'function' || !String(cb).includes('thumbTick')) return orig.call(this, cb, ms, ...rest);
      return orig.call(this, function (...a) {
        const t0 = performance.now();
        cb.apply(this, a);
        // Svelte 는 상태를 바꾼 자리에서 마이크로태스크로 반영한다 — 그 뒤에 줄 선 마이크로태스크(두 겹)에서 배치를
        // 강제하고 잰다. 다음 태스크(setTimeout)까지 기다리면 끼어든 다른 일(xterm 파싱 등)까지 함께 잰다.
        queueMicrotask(() => queueMicrotask(() => { void document.body.offsetHeight; window.__ticks.push(performance.now() - t0); }));
      }, ms, ...rest);
    };
    return 'wrapped';
  })()`);
  await key("KeyM", 10, "M", 1500);
  check("⑪ 대시보드 · 세션 칸", [await dashOpen(), await ev(`document.querySelector('.console')?.dataset.section`)], [true, "sessions"]);
  const wrapped = await ev(`(async () => {
    const m = await ${termMod};
    window.__snaps = 0;
    let n = 0;
    for (const c of document.querySelectorAll('.console [data-card-pane]')) {
      const a = m.termActionsOf(c.dataset.cardPane);
      if (!a || a.__counted) continue;
      const orig = a.screenSnapshot;
      a.screenSnapshot = () => { window.__snaps += 1; return orig(); };
      a.__counted = true;
      n += 1;
    }
    return n;
  })()`);
  check("⑪ 카드 여덟 · 창구 여덟", [await ev(`document.querySelectorAll('.console [data-session-card]').length`), wrapped], [8, 8]);

  const readThumbs = () => ev(`JSON.stringify([...document.querySelectorAll('.console [data-session-card]')].map((c) => {
    const th = c.querySelector('[data-screen-thumb]');
    const r = c.getBoundingClientRect();
    const tr = th?.getBoundingClientRect();
    return { pane: c.dataset.cardPane, state: c.dataset.state, w: Math.round(r.width),
      thumb: th ? { kind: th.dataset.screenThumb || 'screen', h: Math.round(tr.height), w: Math.round(tr.width),
        rows: th.querySelectorAll('.t-row').length,
        text: [...th.querySelectorAll('.t-row')].map((x) => x.textContent),
        colored: [...th.querySelectorAll('.t-run')].filter((x) => x.style.color || x.style.backgroundColor).map((x) => [x.textContent, x.style.color, x.style.backgroundColor]),
        clipped: th.scrollWidth > th.clientWidth || getComputedStyle(th).overflow === 'hidden',
        bg: th.style.background || th.style.backgroundColor } : null,
      order: [...c.children].map((e) => e.className.split(' ')[0]) };
  }))`).then(JSON.parse);

  let th = await readThumbs();
  console.log("THUMBS", JSON.stringify(th.map((c) => ({ pane: c.pane, state: c.state, w: c.w, thumb: c.thumb && { kind: c.thumb.kind, h: c.thumb.h, rows: c.thumb.rows, colored: c.thumb.colored.length } }))));
  check("⑪ 축소판 보기가 기본 — '축소판' 이 눌려 있다", await ev(`JSON.stringify([...document.querySelectorAll('.console [data-session-view]')].map((b) => [b.textContent.trim(), b.getAttribute('aria-pressed')]))`),
    JSON.stringify([["축소판", "true"], ["간단히", "false"]]));
  check("⑪ 카드 여덟 모두 축소판 · 높이 132 · 폭 300 이상 · 잘린다", [
    th.every((c) => c.thumb !== null && c.thumb.kind === "screen"),
    th.every((c) => c.thumb?.h === 132),
    th.every((c) => c.w >= 300),
    th.every((c) => c.thumb?.clipped),
  ], [true, true, true, true]);
  check("⑪ 축소판은 상태 줄과 아랫줄 사이", th.every((c) => {
    const i = c.order.indexOf("sthumb");
    return i > 0 && c.order[i - 1] === "state" && c.order[i + 1] === "line";
  }), true);
  const find = (needle) => th.find((c) => c.thumb?.text.some((l) => l.includes(needle)));
  const vimC = find("NORMAL"), htopC = find("PID USER"), logC = find("items 29"), failC = find("cycle found");
  check("⑪ 먹인 넷이 저마다의 카드에 보인다 (vim · htop · 로그 꼬리 · 실패)", [!!vimC, !!htopC, !!logC, !!failC], [true, true, true, true]);
  check("⑪ 색 토막 — 256색 · RGB · 반전 상태줄 바탕", [
    vimC?.thumb.colored.some(([t, c]) => t === "import" && c === "rgb(0, 135, 255)"),
    vimC?.thumb.colored.some(([t, c]) => t === "previewLines" && c === "rgb(255, 170, 0)"),
    vimC?.thumb.colored.some(([t, , b]) => t.includes("NORMAL") && b !== ""),
  ], [true, true, true]);
  check("⑪ 막대(42m/41m/44m) = 바탕색 토막 세 가지", new Set(htopC?.thumb.colored.filter(([t, , b]) => b !== "" && t.includes("|")).map(([, , b]) => b)).size, 3);
  check("⑪ 긴 화면은 최근(아래) 쪽 — 로그의 마지막 줄 · 넘친 위는 버린다", [logC?.thumb.text.at(-1)?.includes("items 29"), logC?.thumb.rows <= 13], [true, true]);
  check("⑪ 실패 카드 — 테두리가 오류색 쪽으로", await ev(`(() => {
    const c = document.querySelector('.console [data-session-card][data-state="fail"]');
    if (!c) return 'no fail card';
    const d = document.createElement('i'); d.style.color = 'color-mix(in srgb, var(--err) 50%, transparent)'; document.body.append(d);
    const want = getComputedStyle(d).color; d.remove();
    return getComputedStyle(c).borderTopColor === want;
  })()`), true);
  await shot("dashboard-thumbs-dark.png");
  await ev(`document.documentElement.dataset.theme = 'light'`);
  await sleep(400);
  await shot("dashboard-thumbs-light.png");
  await ev(`delete document.documentElement.dataset.theme`);
  await sleep(300);

  // 1초 갱신 — 떠 있는 동안만
  const s0 = await ev(`window.__snaps`);
  await ev(`window.__ticks = []`);
  await sleep(3200);
  const s1 = await ev(`window.__snaps`);
  check("⑪ 떠 있는 동안 1초마다 다시 읽는다 (3초에 여덟 × 3 안팎)", s1 - s0 >= 16 && s1 - s0 <= 40, true);
  // 새 출력이 축소판에 따라온다
  await ev(`window.__feed(${sids[4]}, ${JSON.stringify(`echo fresh-line-42\r\nfresh-line-42\r\nPS C:\\Users\\me> `)})`);
  await sleep(1300);
  check("⑪ 새 출력이 1초 안에 축소판으로", (await readThumbs()).some((c) => c.thumb?.text.some((l) => l.includes("fresh-line-42"))), true);

  // 비용 ① 조용한 5초 — 화면이 그대로인 타일은 옛 판을 다시 쓴다(DOM 을 다시 쓰지 않는다)
  await ev(`window.__ticks = []`);
  await sleep(5200);
  const quietTicks = JSON.parse(await ev(`JSON.stringify(window.__ticks.map((x) => +x.toFixed(1)))`));
  // 비용 ② 여덟 모두 흐르는 5초 — 0.25초마다 타일마다 한 줄(1초 칸마다 여덟 판 전부가 바뀐다)
  await ev(`(() => {
    const ids = Object.keys(window.__chan); let n = 0;
    window.__churn = setTimeout(function tick() {
      n += 1;
      for (const id of ids) window.__feed(id, '\\x1b[3' + (n % 7 + 1) + 'mchurn ' + n + ' ' + id + '\\x1b[0m\\r\\n');
      window.__churn = setTimeout(tick, 250);
    }, 250);
    return ids.length;
  })()`);
  await sleep(600);
  await ev(`window.__ticks = []`);
  await sleep(5200);
  await ev(`clearTimeout(window.__churn)`);
  const busyTicks = JSON.parse(await ev(`JSON.stringify(window.__ticks.map((x) => +x.toFixed(1)))`));
  await sleep(600);
  const cost = JSON.parse(await ev(`(async () => {
    const m = await ${termMod};
    const panes = [...document.querySelectorAll('.console [data-card-pane]')].map((c) => c.dataset.cardPane);
    const t0 = performance.now();
    let cells = 0;
    for (let i = 0; i < 20; i += 1) for (const p of panes) { const s = m.termActionsOf(p).screenSnapshot(); cells += s.cols * s.rows; }
    const snap = (performance.now() - t0) / 20;
    // 한 칸의 판 다시 짓기(스냅샷 + 빈 판 판정 + 지문) — SessionBoard 의 screens 와 같은 일
    const st = await import('/src/lib/screen-thumb.ts'); // 순수 함수라 사본이어도 같다
    const t1 = performance.now();
    for (let i = 0; i < 20; i += 1) for (const p of panes) { const s = m.termActionsOf(p).screenSnapshot(); if (!st.isBlankSnapshot(s)) JSON.stringify(s); }
    const rebuild = (performance.now() - t1) / 20;
    return JSON.stringify({ panes: panes.length, cellsPerRound: cells / 20, snapshotMs: +snap.toFixed(2), rebuildMs: +rebuild.toFixed(2),
      ticksMs: window.__ticks.map((x) => +x.toFixed(1)), runs: document.querySelectorAll('.console .t-run').length,
      rows: document.querySelectorAll('.console .t-row').length });
  })()`));
  const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log("COST", JSON.stringify({ ...cost, ticksMs: undefined, quietTicks, busyTicks, quietMedian: median(quietTicks), busyMedian: median(busyTicks) }));
  check("⑪ 비용 — 조용할 때 1초 갱신(중앙값) 16ms 안쪽", [quietTicks.length >= 4, median(quietTicks) < 16], [true, true]);
  // 흐를 때는 여덟 판을 전부 다시 그린다 — 헤드리스에서 중앙값 9–14ms 였다(한 프레임을 넘기지 않는 선을 둔다)
  check("⑪ 비용 — 여덟 모두 흐를 때 1초 갱신(중앙값) 20ms 안쪽", [busyTicks.length >= 4, median(busyTicks) < 20], [true, true]);

  // 닫으면 멈춘다
  await key("Escape", 0, "Escape", 600);
  const c0 = await ev(`window.__snaps`);
  await sleep(2500);
  check("⑪ 닫혀 있으면 다시 읽지 않는다", (await ev(`window.__snaps`)) - c0, 0);

  // 간단히 — 축소판이 빠지고, 다시 열어도 · 새로 고쳐도 기억한다
  await key("KeyM", 10, "M", 1200);
  await ev(`document.querySelector('.console [data-session-view="compact"]').click()`);
  await sleep(500);
  th = await readThumbs();
  check("⑪ 간단히 — 축소판이 없고 카드 폭은 예전 그대로(236 이상 · 격자 minmax 236)", [
    th.every((c) => c.thumb === null),
    await ev(`getComputedStyle(document.querySelector('.console .grid')).gridTemplateColumns.split(' ').length`) >= 4,
    await ev(`localStorage.getItem('aynx:dashboard:session-view')`),
  ], [true, true, "compact"]);
  const k0 = await ev(`window.__snaps`);
  await sleep(2300);
  check("⑪ 간단히 보기에서는 다시 읽지 않는다", (await ev(`window.__snaps`)) - k0, 0);
  await shot("dashboard-compact-dark.png");
  await ev(`document.documentElement.dataset.theme = 'light'`);
  await sleep(400);
  await shot("dashboard-compact-light.png");
  await ev(`delete document.documentElement.dataset.theme`);
  await key("Escape", 0, "Escape", 500);
  await key("KeyM", 10, "M", 1000);
  check("⑪ 닫고 다시 열어도 간단히", [await ev(`document.querySelector('.console [data-session-view="compact"]')?.getAttribute('aria-pressed')`), await ev(`document.querySelectorAll('.console [data-screen-thumb]').length`)], ["true", 0]);
  await key("Escape", 0, "Escape", 500);
  // 새로 고침 뒤에도 (저장값) — 세션은 사라지지만 보기 전환은 요약 줄에 늘 선다
  counting = false;
  await send("Page.reload", { ignoreCache: false });
  await sleep(3000);
  counting = true;
  await ev(`(async () => { (await ${importApp("app/console.svelte")}).openConsoleAt('sessions'); })()`);
  await sleep(900);
  check("⑪ 새로 고친 뒤에도 간단히 (localStorage)", await ev(`document.querySelector('.console [data-session-view="compact"]')?.getAttribute('aria-pressed')`), "true");
  await ev(`document.querySelector('.console [data-session-view="thumbs"]').click()`);
  await sleep(300);
  check("⑪ 되돌리면 저장값도 축소판", await ev(`localStorage.getItem('aynx:dashboard:session-view')`), "thumbs");
  await key("Escape", 0, "Escape", 400);
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
}

await sleep(300);
check("콘솔 예외 0", errors, []);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
