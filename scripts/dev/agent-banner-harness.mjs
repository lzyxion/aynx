// 헤드리스 검증 — **에이전트 알림 배너** (docs/log/2026-09-27-agent-banners.md).
//
// `notify-center-harness.mjs` 의 스텁 사본 — 시나리오만 다르다. AI 타일 다섯(탭마다 하나)을 세우고 빈 탭을
// 본 채 `agent-signal` 을 흉내 낸다:
// ① 턴 끝 → 위 가운데 배너(탭 바 아래) · 토스트 없음 · 배지 1 중성 · ② 권한 물음 → 맨 위 · 배지 강조색 ·
// ③ 같은 타일 다시 → 합쳐져 맨 위로 · ④ × → 배너에서만 빠지고 배지는 그대로 · 센터의 "확인할 것" 에 "나중에" ·
// ⑤ 저절로 해결(tool-done → 권한 · start → 끝남) · ⑥ [보기] → 그 타일로 + 빛 + 지난 알림 "확인함" ·
// ⑦ 다른 길로 그 타일에 가도 해결(탭 고르기) · ⑧ 넘침 칩 "+N개 더"/"접기"/"모두 지우기" · ⑨ Escape = × ·
// ⑩ 10초 뒤 알약 → 누르면 펼침 · 호버 중엔 안 접힘 · ⑪ 창이 뒤에 있으면 OS 알림 + 배너, 돌아오면 해결 ·
// ⑫ 타일이 닫히면 저절로 해결 · ⑬ 보고 있는 타일도 긴 턴이면(`[ai] notify_focused_after_secs` — 여기선 1초):
// 긴 턴 → 배너(OS 알림 없음) · 방문으로 안 풀림 · 사람이 돌아올 때까지 안 접힘 · 그 타일에 키 → 해결 · 짧은 턴 → 없음 ·
// 0 = 끔 · 다른 타일로 갔다 오면 방문으로 해결 · 그 타일 누름 → 해결 ·
// ⑭ 서브 에이전트(docs/log/2026-10-04-subagent-signals.md): Stop → 서브 2개 진행 중 → 배너 없음 · 탭 점 실행 중 + 수 2 ·
// 하나 끝 → 수 1 · 같은 끝 한 번 더 → 그대로 · 마지막 끝 → 배너 없음 · 탭 점 완료(서브의 끝은 알리지 않는다 — 2026-10-21) ·
// 메인이 깨어나 보고 → stop → 완료 배너 한 번 · 새 턴(start)의 stop 은 다시 알린다 · 마지막에 콘솔 예외 0.
//
// usage:
//   npx vite --port 1437 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9247 --user-data-dir=%TEMP%/edge-aynx-banner \
//     --window-size=1200,800 http://localhost:1437/
//   PAGE_PORT=1437 node scripts/dev/agent-banner-harness.mjs <outdir> 9247
//     → <outdir>/agent-banners.png · agent-banners-pill.png · agent-banners-light.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
import { reloadBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";
const [outDir = ".", port = process.env.CDP_PORT ?? "9247"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1437";
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
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = path.join(outDir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log("PNG " + path.resolve(p));
};
let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const key = async (code, k) => {
  const vk = { Escape: 27, Enter: 13 }[code] ?? 0;
  for (const type of ["keyDown", "keyUp"])
    // Enter 는 `text` 가 있어야 단추가 눌린다(keypress) — Escape 는 글자가 없다
    await send("Input.dispatchKeyEvent", {
      type,
      code,
      key: k,
      windowsVirtualKeyCode: vk,
      nativeVirtualKeyCode: vk,
      ...(type === "keyDown" && code === "Enter" ? { text: String.fromCharCode(13) } : {}),
    });
  await sleep(250);
};
const centerOf = async (sel) =>
  JSON.parse(
    await ev(`(() => { const r = document.querySelector(${JSON.stringify(sel)})?.getBoundingClientRect(); return JSON.stringify(r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null); })()`),
  );
const clickAt = async (sel) => {
  const box = await centerOf(sel);
  if (!box) return false;
  for (const type of ["mousePressed", "mouseReleased"])
    await send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  await sleep(400);
  return true;
};
const hover = async (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  // 모듈이 많아 기본 버퍼(250)를 넘으면 뒤에 올린 모듈이 importApp 에서 안 보인다 — 넉넉히
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  window.__focus = true; document.hasFocus = () => window.__focus;
  window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, opts) { window.__calls.push(['Notification', { title, body: opts?.body ?? null }]); } };
  window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, id: h, payload }));
  window.__ops = { pending: [], recent: [] };
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false }, ai: { notify_turn_end: true } };
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {},  load_snippets: null, 
     save_snippets: null,  save_settings: null,
    host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null, close_session: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    list_ai_clis: [], operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    term_theme_list: [], restore_done_sessions: { closed: 0, unclaimed: 0 },
    audit_status: { state: 'off', written: 0, failed: 0 }, mcp_activity: null, list_forwards: [],
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
// 고정 4초는 찬 vite(러너가 새로 띄운 dev 서버)에서 모자랐다 — 새 문서의 부팅 끝을 기다린다(`boot-wait.mjs` · 2026-11-13)
await reloadBoot(send, ev);
await sleep(1000);

const tabsMod = importApp("app/tabs.svelte.ts");
const panesMod = importApp("app/panes.svelte.ts");
const sessionMod = importApp("lib/session.ts");
const BELL = '[data-signal="notify"]';
const badge = () => ev(`document.querySelector('${BELL} .notify-pill')?.textContent.trim() ?? null`);
const badgeUrgent = () => ev(`document.querySelector('${BELL} .notify-pill')?.classList.contains('urgent') ?? null`);
const shownPanes = () => ev(`JSON.stringify([...document.querySelectorAll('[data-agent-banner]')].map(e => e.dataset.pane))`).then(JSON.parse);
const activeFocus = () => ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return t ? t.id + '/' + w.paneOf(t) : null; })()`);

// ── 준비: AI 타일 다섯 — 탭마다 하나 ─────────────────────────────────────────
const tiles = [];
for (let i = 0; i < 5; i++) {
  if (i > 0) await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessionMod}; w.openTab(s.newTab()); })()`);
  await sleep(300);
  await ev(`(async () => { const p = await ${panesMod}; await p.openAiPaneHere({ command: 'claude', id: 'claude' }); })()`);
  await sleep(900);
}
{
  const all = JSON.parse(
    await ev(`(async () => { const w = await ${tabsMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); const out = []; for (const tab of w.residentWindowTabs()) for (const p of walk(tab.root, [])) if (p.autorun === 'claude') out.push({ tab: tab.id, pane: p.id, stream: p.historyStreamId ?? null }); return JSON.stringify(out); })()`),
  );
  tiles.push(...all);
}
console.log("tiles:", tiles.length);
check(tiles.length === 5 && tiles.every((x) => x.stream), "AI 타일 다섯 · 스트림 id 있음");
// 빈 탭을 본다 — 어느 AI 타일도 포커스된 타일이 아니다
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessionMod}; w.openTab(s.newTab()); })()`);
await sleep(600);
const blankTab = await ev(`(async () => { const w = await ${tabsMod}; return w.activeTabId(); })()`);
const emit = async (i, event, detail = null) => {
  await ev(fakeAgentSignal(`{ stream: '${tiles[i].stream}', event: '${event}', detail: ${JSON.stringify(detail)}, at: Date.now() }`));
  await sleep(450);
};
const backToBlank = async () => {
  await ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${blankTab}'); })()`);
  await sleep(300);
};

// ── ① 턴 끝 → 위 가운데 배너 ────────────────────────────────────────────────
check((await badge()) === null, "처음 — 배지 없음");
await emit(0, "stop");
check(JSON.stringify(await shownPanes()) === JSON.stringify([tiles[0].pane]), "턴 끝 → 배너 하나");
check(
  (await ev(`[...document.querySelectorAll('.toast')].some(e => e.textContent.includes('작업이 끝났습니다'))`)) === false,
  "에이전트 알림은 토스트로 뜨지 않는다",
);
const geo = JSON.parse(
  await ev(`(() => { const b = document.querySelector('[data-agent-banners]').getBoundingClientRect(); const c = document.querySelector('[data-agent-banner] .card').getBoundingClientRect(); const body = document.querySelector('.body').getBoundingClientRect(); const bar = document.querySelector('.titlebar').getBoundingClientRect(); const ctlEl = document.querySelector('.winctl'); const ctl = ctlEl ? ctlEl.getBoundingClientRect() : null; return JSON.stringify({ cx: c.left + c.width / 2, bodyCx: body.left + body.width / 2, top: c.top, barBottom: bar.bottom, w: c.width, overlapCtl: ctl ? !(c.right < ctl.left || c.top > ctl.bottom) : false }); })()`),
);
check(Math.abs(geo.cx - geo.bodyCx) < 1.5, `가운데 (${geo.cx} vs ${geo.bodyCx})`);
check(geo.top >= geo.barBottom && geo.top - geo.barBottom < 20, `탭 바 바로 아래 (top ${geo.top} · 탭 바 ${geo.barBottom})`);
check(Math.abs(geo.w - 430) < 1.5, `폭 430 (${geo.w})`);
check(geo.overlapCtl === false, "창 제어 단추와 겹치지 않는다");
const card0 = JSON.parse(
  await ev(`(() => { const c = document.querySelector('[data-agent-banner] .card'); return JSON.stringify({ title: c.querySelector('.title')?.textContent.trim(), when: c.querySelector('.when')?.textContent.trim(), line2: c.querySelector('.line2')?.textContent.trim(), act: c.querySelector('[data-banner-open]')?.textContent.trim(), logo: !!c.querySelector('.logo svg, .logo img'), status: c.querySelector('.status')?.className, radius: getComputedStyle(c).borderRadius }); })()`),
);
console.log("card:", JSON.stringify(card0));
check(card0.title?.startsWith("Claude Code · "), "머리줄 = Claude Code · 탭 이름");
check(card0.when === "방금" && card0.line2 === "작업이 끝났습니다" && card0.act === "보기", "방금 · 작업이 끝났습니다 · [보기]");
check(card0.logo && /stop/.test(card0.status ?? ""), "로고 + 끝남 표식");
check(card0.radius === "16px", "모서리 16px");
check((await badge()) === "1" && (await badgeUrgent()) === false, "배지 1 · 중성");

// ── ② 권한 물음 → 맨 위 · 강조색 ─────────────────────────────────────────────
await emit(1, "waiting", "permission");
check(JSON.stringify(await shownPanes()) === JSON.stringify([tiles[1].pane, tiles[0].pane]), "권한 물음이 맨 위로");
check(
  (await ev(`document.querySelector('[data-agent-banner] [data-banner-open]').textContent.trim()`)) === "확인하러 가기",
  "권한 카드의 단추 = 확인하러 가기",
);
check((await ev(`document.querySelector('[data-agent-banner] .card').classList.contains('permission')`)) === true, "권한 카드 테두리(permission)");
check((await badge()) === "2" && (await badgeUrgent()) === true, "배지 2 · 강조색");
await emit(2, "waiting", "idle");
check((await shownPanes()).length === 2, "idle 대기는 알리지 않는다");
await shot("agent-banners.png");

// ── ③ 같은 타일 다시 → 합쳐져 맨 위로 ────────────────────────────────────────
await emit(0, "stop");
check(JSON.stringify(await shownPanes()) === JSON.stringify([tiles[0].pane, tiles[1].pane]), "같은 타일 → 하나로 · 맨 위");

// ── ④ × → 배너에서만 ─────────────────────────────────────────────────────────
await ev(`document.querySelector('[data-agent-banner][data-pane="${tiles[0].pane}"] [data-banner-hide]').click()`);
await sleep(500);
check(JSON.stringify(await shownPanes()) === JSON.stringify([tiles[1].pane]), "× → 배너에서 빠진다");
check((await badge()) === "2", "× 뒤에도 배지 2");
await clickAt(BELL);
const todo = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-notify-todo]')].map(r => ({ kind: r.dataset.kind, hidden: r.dataset.hidden, later: !!r.querySelector('.later') })))`));
check(todo.length === 2 && todo.some((r) => r.hidden === "true" && r.later), `센터 "확인할 것" 둘 · 숨긴 것에 "나중에" (${JSON.stringify(todo)})`);
// 옛 알림 센터 팝오버(`.notifycenter`)는 독 알림 칸(`[data-dock-alerts]` — 2026-10-18 통합 독)으로 옮겼고 칸 제목은 "새 알림" 이다
check((await ev(`document.querySelector('[data-dock-alerts] .group')?.textContent.trim()`)) === "새 알림", "첫 칸 제목 = 새 알림(확인할 것)");
await key("Escape", "Escape");

// ── ⑤ 저절로 해결 ────────────────────────────────────────────────────────────
await emit(1, "tool");
check((await badge()) === "2", "도구 시작은 권한 물음을 풀지 않는다");
await emit(1, "tool-done");
check((await shownPanes()).length === 0 && (await badge()) === "1" && (await badgeUrgent()) === false, "tool-done → 권한 해결 · 배지 1 중성");
await emit(0, "stop");
check(JSON.stringify(await shownPanes()) === JSON.stringify([tiles[0].pane]), "숨긴 타일의 새 알림 → 다시 보인다");
await emit(0, "start");
check((await shownPanes()).length === 0 && (await badge()) === null, "start → 끝남 해결 · 배지 없음");
await emit(3, "waiting", "permission");
await emit(3, "stop");
check(
  JSON.stringify(await shownPanes()) === JSON.stringify([tiles[3].pane]) &&
    (await ev(`document.querySelector('[data-agent-banner]').dataset.kind`)) === "stop",
  "권한 뒤 stop → 권한은 풀리고 끝남이 선다",
);
await emit(3, "start");

// ── ⑥ [보기] → 그 타일로 + 빛 + 지난 알림 "확인함" ─────────────────────────────
await emit(2, "stop");
await clickAt(`[data-agent-banner][data-pane="${tiles[2].pane}"] [data-banner-open]`);
await sleep(100);
check((await activeFocus()) === `${tiles[2].tab}/${tiles[2].pane}`, "[보기] → 그 탭의 그 타일");
check((await shownPanes()).length === 0 && (await badge()) === null, "[보기] → 해결");
check((await ev(`document.querySelector('.pane-box[data-pane="${tiles[2].pane}"]')?.classList.contains('glow-ok')`)) === true, "타일 테두리가 빛난다 (ok)");
await sleep(1700);
check((await ev(`document.querySelector('.pane-box[data-pane="${tiles[2].pane}"]')?.classList.contains('glow-ok')`)) === false, "1.4초 뒤 빛이 걷힌다");
await clickAt(BELL);
const hist = await ev(`[...document.querySelectorAll('[data-notify-resolved]')].map(r => r.dataset.notifyResolved + ':' + r.querySelector('.detail').textContent.trim()).join('|')`);
console.log("history:", hist);
check(hist.startsWith("checked:방금 · 확인함"), "지난 알림 맨 위 = 확인함");
check(hist.includes("auto:방금 · 저절로 해결"), "지난 알림에 저절로 해결도 있다");
check((await ev(`!!document.querySelector('[data-notify-todo]')`)) === false, "확인할 것 칸은 없다 (다 풀림)");
await key("Escape", "Escape");

// ── ⑦ 다른 길로 그 타일에 가도 해결 (탭 고르기) ─────────────────────────────
await backToBlank();
await emit(4, "waiting", "permission");
check((await badge()) === "1", "권한 물음 하나");
await ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${tiles[4].tab}'); })()`);
await sleep(700);
check((await shownPanes()).length === 0 && (await badge()) === null, "그 탭을 고르면(포커스된 타일) 해결");
check((await ev(`document.querySelector('.pane-box[data-pane="${tiles[4].pane}"]')?.classList.contains('glow-accent')`)) === true, "빛은 권한의 강조색");
await backToBlank();

// ── ⑧ 넘침 ───────────────────────────────────────────────────────────────────
for (const i of [0, 1, 2, 3]) await emit(i, "stop");
check((await shownPanes()).length === 3, "넷 → 셋만 선다");
check((await ev(`document.querySelector('[data-banner-more]')?.textContent.trim()`)) === "+1개 더", "칩 +1개 더");
check((await ev(`!!document.querySelector('[data-banner-clear]')`)) === true, "칩 모두 지우기");
await ev(`document.querySelector('[data-banner-more]').click()`);
await sleep(500);
check((await shownPanes()).length === 4 && (await ev(`document.querySelector('[data-banner-more]')?.textContent.trim()`)) === "접기", "전부 보기 → 넷 · 접기");
await ev(`document.querySelector('[data-banner-more]').click()`);
await sleep(500);
check((await shownPanes()).length === 3, "접기 → 다시 셋");
await ev(`document.querySelector('[data-banner-clear]').click()`);
await sleep(500);
check((await shownPanes()).length === 0 && (await badge()) === "4", "모두 지우기 → 배너 없음 · 배지 4 그대로");

// ── ⑨ Escape = × ─────────────────────────────────────────────────────────────
await emit(0, "stop");
await ev(`document.querySelector('[data-agent-banner] [data-banner-open]').focus()`);
await key("Escape", "Escape");
check((await shownPanes()).length === 0 && (await badge()) === "4", "배너에 포커스 두고 Escape → 숨김 (배지 그대로)");
for (const i of [0, 1, 2, 3]) await emit(i, "start");
check((await badge()) === null, "모두 새 턴 → 배지 없음");

// ── ⑩ 10초 뒤 알약 · 펼치기 · 호버 멈춤 ────────────────────────────────────────
await hover(5, 790);
await emit(0, "stop");
await sleep(10_600);
check((await ev(`document.querySelector('[data-agent-banner]')?.dataset.collapsed`)) === "true", "10초 뒤 알약");
const pill = await ev(`document.querySelector('[data-banner-pill]')?.textContent.trim()`);
check(/ · 끝남$/.test(pill ?? ""), `알약 글자 = "… · 끝남" (${pill})`);
check((await ev(`getComputedStyle(document.querySelector('[data-banner-pill]')).borderRadius`)) === "999px", "알약은 끝까지 둥글다");
await shot("agent-banners-pill.png");
await ev(`document.querySelector('[data-banner-pill]').focus()`);
await key("Enter", "Enter");
check((await ev(`document.querySelector('[data-agent-banner]')?.dataset.collapsed`)) === "false", "알약에서 Enter → 펼침");
await ev(`document.activeElement?.blur()`);
const c = await centerOf("[data-agent-banner] .card .body");
await hover(c.x, c.y);
await sleep(10_800);
check((await ev(`document.querySelector('[data-agent-banner]')?.dataset.collapsed`)) === "false", "호버 중에는 접히지 않는다");
await hover(5, 790);
await sleep(300);
check((await ev(`document.querySelector('[data-agent-banner]')?.dataset.collapsed`)) === "false", "손을 떼면 시계를 다시 센다 (곧바로 접히지 않는다)");
await emit(0, "start");

// ── ⑪ 창이 뒤에 있다 → OS 알림 + 배너 · 돌아오면 해결 ────────────────────────
await ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${tiles[1].tab}'); })()`);
await sleep(200);
await ev(`window.__focus = false; window.dispatchEvent(new Event('blur'))`);
await sleep(100);
const before = await ev(`window.__calls.filter(c => c[0] === 'Notification').length`);
await emit(1, "stop");
await sleep(400);
check((await ev(`window.__calls.filter(c => c[0] === 'Notification').length`)) === before + 1, "창이 뒤 → OS 알림 한 번");
check(JSON.stringify(await shownPanes()) === JSON.stringify([tiles[1].pane]), "그리고 배너도 선다 (보고 있던 타일이어도)");
await ev(`window.__focus = true; window.dispatchEvent(new Event('focus'))`);
await sleep(400);
check((await shownPanes()).length === 0 && (await badge()) === null, "창이 돌아오고 그 타일이 포커스돼 있으면 해결");
await backToBlank();

// ── ⑫ 타일이 닫히면 저절로 해결 ──────────────────────────────────────────────
await emit(3, "stop");
check((await badge()) === "1", "하나");
await ev(`(async () => { const w = await ${tabsMod}; w.closePaneIn('${tiles[3].tab}', '${tiles[3].pane}'); })()`);
await sleep(600);
const closedByApi = (await ev(`!!document.querySelector('.pane-box[data-pane="${tiles[3].pane}"]')`)) === false;
if (!closedByApi) {
  await ev(`(async () => { const m = await ${importApp("app/agent-status.svelte.ts")}; m.dropAgent('${tiles[3].pane}'); })()`);
  await sleep(300);
}
check((await badge()) === null && (await shownPanes()).length === 0, `타일이 사라지면 해결 (${closedByApi ? "closePaneIn" : "dropAgent"})`);

// ── ⑬ 보고 있는 타일도 — 턴이 길었으면 (docs/log/2026-09-27-agent-banners.md "보고 있는 타일도") ──
const setMod = importApp("lib/settings.svelte.ts");
const notifCount = () => ev(`window.__calls.filter(c => c[0] === 'Notification').length`);
const setFocusedAfter = (secs) => ev(`(async () => (await ${setMod}).setNotifyFocusedAfterSecs(${secs}))()`);
/** start → (ms) → stop — 턴 길이를 실제 시계로 만든다 */
const turn = async (i, ms) => {
  await emit(i, "start");
  await sleep(ms);
  await emit(i, "stop");
};
check((await ev(`(async () => (await ${setMod}).settings.notifyFocusedAfterSecs)()`)) === 60, "기본 임계 60초");
await setFocusedAfter(1);
await ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${tiles[0].tab}'); })()`);
await sleep(500);
check((await activeFocus()) === `${tiles[0].tab}/${tiles[0].pane}`, "그 타일을 보고 있다");
const osBefore = await notifCount();

// (a) 짧은 턴 → 아무것도 없다
await emit(0, "start");
await emit(0, "stop");
check((await shownPanes()).length === 0 && (await badge()) === null, "보고 있는 타일 · 짧은 턴 → 알리지 않는다");

// (b) 긴 턴 → 배너, 방문으로 안 풀림, OS 알림 없음
await turn(0, 900);
check(JSON.stringify(await shownPanes()) === JSON.stringify([tiles[0].pane]), "보고 있는 타일 · 긴 턴 → 배너가 선다");
check((await notifCount()) === osBefore, "창이 앞이라 OS 알림은 없다");
await sleep(1200);
check(JSON.stringify(await shownPanes()) === JSON.stringify([tiles[0].pane]), "그 타일에 있어도 저절로 풀리지 않는다");

// (c) 자리를 비운 동안은 접히지 않는다 → 돌아온 뒤 10초에 접힌다
await sleep(9_600);
check((await ev(`document.querySelector('[data-agent-banner]')?.dataset.collapsed`)) === "false", "사람이 돌아오기 전엔 10초가 지나도 펼친 채");
await hover(5, 790);
await hover(8, 788);
await sleep(10_600);
check((await ev(`document.querySelector('[data-agent-banner]')?.dataset.collapsed`)) === "true", "마우스가 움직인 뒤 10초 → 알약");

// (d) 그 타일에 키 하나 → 해결 (확인함)
await ev(`document.querySelector('.pane-box[data-pane="${tiles[0].pane}"] textarea')?.focus()`);
for (const type of ["keyDown", "keyUp"])
  await send("Input.dispatchKeyEvent", { type, code: "KeyA", key: "a", windowsVirtualKeyCode: 65, ...(type === "keyDown" ? { text: "a" } : {}) });
await sleep(400);
check((await shownPanes()).length === 0 && (await badge()) === null, "그 타일에 키를 치면 해결");
await clickAt(BELL);
const hist13 = await ev(`[...document.querySelectorAll('[data-notify-resolved]')].map(r => r.dataset.notifyResolved).join('|')`);
check(hist13.startsWith("checked"), `지난 알림 맨 위 = 확인함 (${hist13.slice(0, 40)})`);
await key("Escape", "Escape");

// (e) 0 = 끔 → 긴 턴이어도 옛 동작
await setFocusedAfter(0);
await turn(0, 1200);
check((await shownPanes()).length === 0 && (await badge()) === null, "임계 0 → 보고 있는 타일은 알리지 않는다");
await setFocusedAfter(1);

// (f) 다른 타일로 갔다가 돌아오면 방문으로 풀린다
await turn(0, 1200);
check((await shownPanes()).length === 1, "긴 턴 → 배너");
await backToBlank();
check((await shownPanes()).length === 1, "다른 탭으로 옮겨도 남는다");
await ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${tiles[0].tab}'); })()`);
await sleep(600);
check((await shownPanes()).length === 0 && (await badge()) === null, "돌아오면(방문) 해결");

// (g) 그 타일을 누르면 풀린다
await turn(0, 1200);
check((await shownPanes()).length === 1, "긴 턴 → 배너");
await clickAt(`.pane-box[data-pane="${tiles[0].pane}"] .pane-body`);
check((await shownPanes()).length === 0 && (await badge()) === null, "그 타일을 누르면 해결");

// (h) 권한 물음도 같은 길이 규칙 (턴 시작부터 물음까지)
await emit(0, "start");
await sleep(1200);
await emit(0, "waiting", "permission");
check(
  JSON.stringify(await shownPanes()) === JSON.stringify([tiles[0].pane]) &&
    (await ev(`document.querySelector('[data-agent-banner]').dataset.kind`)) === "permission",
  "보고 있는 타일 · 긴 턴 중 권한 물음 → 배너",
);
await emit(0, "tool-done");
check((await shownPanes()).length === 0, "답하면(tool-done) 저절로 해결");
await emit(0, "start"); // 새 턴 — 정리
await setFocusedAfter(60);
await backToBlank();

// ── ⑭ 서브 에이전트 — "메인이 멈췄고 + 진행 중 0개" 가 완료 (docs/log/2026-10-04-subagent-signals.md) ──
{
  const T = tiles[4];
  const emitSub = async (event, agent) => {
    await ev(fakeAgentSignal(`{ stream: '${T.stream}', event: '${event}', detail: null, agent: ${JSON.stringify(agent)}, at: Date.now() }`));
    await sleep(450);
  };
  const tabDotOf = () =>
    ev(`(() => { const t = document.querySelector('[data-tab="${T.tab}"]'); const d = t?.querySelector('[data-agent-dot]'); const n = t?.querySelector('[data-subagents]'); return JSON.stringify({ dot: d?.dataset.agentDot ?? null, n: n ? Number(n.dataset.subagents) : 0, text: n?.textContent.trim() ?? null, label: d?.getAttribute('title') ?? '' }); })()`).then(JSON.parse);
  const bannersOf = async () => (await shownPanes()).filter((p) => p === T.pane).length;
  await backToBlank();
  await emit(4, "start"); // 위 ② 의 권한 물음을 정리하고 새 턴
  check((await bannersOf()) === 0, "⑭ 새 턴 — 그 타일의 배너 없음");
  await emitSub("subagent-start", "agent_a1");
  await emitSub("subagent-start", "agent_b2");
  await emit(4, "stop");
  let d = await tabDotOf();
  check((await bannersOf()) === 0, "⑭ 서브 둘이 도는 중의 stop → 완료 배너 없음");
  check(d.dot === "running" && d.n === 2 && d.text === "2", `⑭ 탭 점 실행 중 + 수 2 (${JSON.stringify(d)})`);
  check(d.label.includes("서브 에이전트 2개 진행 중"), `⑭ 말풍선에 서브 에이전트 수 (${d.label})`);
  await shot("agent-banners-subagents.png"); // 탭 점 옆 수 2
  await emit(4, "tool"); // 서브 에이전트의 도구
  await emitSub("subagent-stop", "agent_a1");
  d = await tabDotOf();
  check((await bannersOf()) === 0 && d.dot === "running" && d.n === 1, `⑭ 하나 끝 → 배너 없음 · 수 1 (${JSON.stringify(d)})`);
  await emitSub("subagent-stop", "agent_a1"); // 중복
  await emitSub("subagent-stop", "agent_ghost"); // 시작을 못 본 끝
  await emitSub("subagent-start", null); // id 없는 신호(옛 스크립트) — 세지 않는다
  d = await tabDotOf();
  check((await bannersOf()) === 0 && d.n === 1, `⑭ 중복 끝 · 모르는 id · id 없음 → 그대로 수 1 (${JSON.stringify(d)})`);
  await emitSub("subagent-stop", "agent_b2");
  d = await tabDotOf();
  // 서브 에이전트의 끝은 알리지 않는다 — 메인이 결과를 받아 다시 돌고 그 `stop` 이 알린다(2026-10-21 · `agent-status` 머리말)
  check((await bannersOf()) === 0, "⑭ 마지막 서브 에이전트가 끝남 → 배너 없음(점만 완료)");
  check(d.dot === "finished" && d.n === 0, `⑭ 탭 점 완료 · 수 없음 (${JSON.stringify(d)})`);
  // 메인이 결과를 보고하러 깨어난다(UserPromptSubmit 없이) — 그 stop 이 완료 배너를 한 번 세운다
  await emit(4, "tool");
  await emit(4, "stop");
  check((await bannersOf()) === 1, "⑭ 메인이 다시 돌고 stop → 완료 배너 한 번");
  check(
    (await ev(`document.querySelector('[data-agent-banner][data-pane="${T.pane}"]')?.dataset.kind ?? null`)) === "stop",
    "⑭ 배너는 턴 끝 종류",
  );
  await emit(4, "start");
  await emit(4, "stop");
  check((await bannersOf()) === 1, "⑭ 새 사용자 턴의 stop 은 다시 알린다");
  await emit(4, "start"); // 정리
}

// ── 라이트 테마 한 장 ────────────────────────────────────────────────────────
await emit(0, "stop");
await emit(1, "waiting", "permission");
await ev(`document.documentElement.dataset.theme = 'light'`);
await sleep(300);
await shot("agent-banners-light.png");
await ev(`delete document.documentElement.dataset.theme`);

check(errors.length === 0, `콘솔 예외·오류 0 (${errors.length}${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
