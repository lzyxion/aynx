// 헤드리스 검증 — **폰 배치의 AI 타일 첫 화면**(2026-11-04 · `pane/AiFlip.svelte` · `flip-convo.ts` 의 `phoneOpensConvo` · 이 기기 값 `aiFacePref`).
//
// 원격 창 흉내(`window.__AYNX_REMOTE__`)로 뜨고, 탭은 거울 대신 `applyMirrorTabs` 로 직접 세운다(AI 타일 = autorun 'claude').
// 보는 것: ① 폭 400 첫 표시 = 대화 면 · 움직임 없음 · 포커스가 입력 칸에 없음 · 숨은 탭은 안 넘어감 ② xterm 이 받은 포커스가 입력 칸으로 가지 않음
// ③ 터미널로 돌리면 유지(다른 탭을 보고 와도) · 다음 탭은 처음 볼 때 넘어감 ④ 사람이 넘기면 예전대로 움직임 ⑤ CLI 가 끝나면 터미널 · 새 CLI = 다시 대화
// ⑥ 설정 화면의 '첫 화면' 줄 · 터미널로 고르면 새 타일이 안 넘어감 · 다시 떠도 그 값 ⑦ 넓은 폭은 변화 없음 ⑧ 예외 0
//
//   node scripts/dev/run-harness.mjs phone-convo-harness.mjs <outdir> --size 400x844
//     → <outdir>/phone-convo.png · phone-convo-term.png · phone-convo-settings.png · phone-convo-direct.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";

const [outdir = "out", port = process.env.CDP_PORT ?? "9277"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1444";
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
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) {
    const p = path.join(outdir, name);
    fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
    console.log("PNG " + path.resolve(p));
  }
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
    // 시청자로 붙는 세션(크기 주인) — 띠 숨김이 PTY 크기를 흔드는지 센다(resize_session · claim_session_size)
    probe_session: { state: 'attached', kind: 'local', sessionEpoch: 1, checkpoint: null },
    attach_session_viewer: { id: 7, kind: 'local', viewer: true, lease: { stream: 's', sessionEpoch: 1, leaseEpoch: 1 }, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh', sizeOwner: true },
    resize_session: null, claim_session_size: true, ack_session: null, write_session: null, detach_session_viewer: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'remote-h-1' }, currentWebview: { label: 'remote-h-1', windowLabel: 'remote-h-1' }, windows: [{ label: 'remote-h-1' }], webviews: [{ label: 'remote-h-1', windowLabel: 'remote-h-1' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
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
`,
});

const T = importApp("app/tabs.svelte.ts");
const WS = importApp("app/workspaces.svelte.ts");
const M = importApp("app/mobile.svelte.ts");
const F = importApp("pane/flip-view.svelte.ts");
const TITLES = importApp("app/titles.svelte.ts");
const SHEETS = importApp("app/mobile-sheets.svelte.ts");

/** 탭 셋 + 고른 탭 — 거울 환원 대신 곧바로. ai-a · ai-b = AI 타일 · sh = 셸 */
const seedTabs = (active = "tab-a", extra = "") => `(async () => {
  const [t, w] = await Promise.all([${T}, ${WS}]);
  const ws = w.currentWorkspaceId();
  const tab = (id, pane) => ({ id, title: id, tabKey: 'k-' + id, workspaceId: ws, root: { type: 'leaf', pane: { tileKey: 'tk-' + pane.id, ...pane } } });
  t.applyMirrorTabs([
    tab('tab-a', { id: 'ai-a', kind: 'local', historyStreamId: 's-a', autorun: 'claude' }),
    tab('tab-b', { id: 'ai-b', kind: 'local', historyStreamId: 's-b', autorun: 'claude' }),
    tab('tab-s', { id: 'sh', kind: 'local', historyStreamId: 's-s' }),
    ${extra}
  ], ${JSON.stringify(active)}, {});
})()`;
const face = (id) => ev(`document.querySelector('[data-pane="${id}"] [data-flip]')?.dataset.flip ?? null`);
/** 키 띠가 보이는가 */
const strip = () => ev(`(() => { const k = document.querySelector('.mobile-keys'); return !!k && getComputedStyle(k).display !== 'none'; })()`);
/** 지금까지 나간 크기 보내기 */
const resizes = async () => JSON.parse(await ev(`JSON.stringify(window.__calls.filter(([c]) => c === 'resize_session' || c === 'claim_session_size').map(([c, a]) => [c, a.cols, a.rows]))`));
const pick = async (id) => {
  await ev(`(async () => (await ${T}).selectTab(${JSON.stringify(id)}))()`);
  await sleep(500);
};
const boot = async (width, mobile, storage = null) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height: 844, deviceScaleFactor: 2, mobile });
  await send("Page.reload", { ignoreCache: true });
  await sleep(300);
  await ev(`(() => { try { ${storage === null ? "localStorage.removeItem('aynx.remote.aiFace')" : `localStorage.setItem('aynx.remote.aiFace', ${JSON.stringify(storage)})`} } catch {} })()`);
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`performance.getEntriesByType('resource').some(r => r.name.includes('app/tabs.svelte.ts')) && !!document.querySelector('.app')`, 20000);
  await sleep(1200);
};
const focusInfo = `(() => {
  const a = document.activeElement;
  return JSON.stringify({ tag: a?.tagName ?? null, composer: !!a?.closest?.('[data-flip-convo]') && a?.tagName === 'TEXTAREA', strip: a?.tagName === 'INPUT' && !!a?.closest?.('form.line') });
})()`;

// ── ① 폭 400 ─────────────────────────────────────────────────────────────────
await boot(400, true);
check("① 폰 배치", await ev(`(async () => (await ${M}).mobileLayout())()`), true);
check("① 기본값 = 대화", await ev(`(async () => (await ${M}).aiFacePref())()`), "convo");
await ev(`window.__faceCalls = () => window.__calls.filter(([c]) => c === 'tile_permission_face').map(([, a]) => a)`);
await ev(seedTabs("tab-a"));
await waitFor(`!!document.querySelector('[data-pane="ai-a"] [data-flip]')`);
await sleep(700);
check("① 처음 보는 AI 타일 = 대화 면", await face("ai-a"), "convo");
check("① 숨은 탭의 AI 타일은 안 넘어감", await face("ai-b"), "term");
check("① 셸 타일은 대상 아님", await face("sh"), null);
check("① 뒤집는 움직임 없음", await ev(`document.querySelector('[data-pane="ai-a"] [data-flip]')?.closest('.pane-box')?.getAnimations().length ?? -1`), 0);
const F1 = JSON.parse(await ev(focusInfo));
check("① 포커스 = 입력 칸 아님 · 띠의 칸 아님", [F1.composer, F1.strip], [false, false]);
check("① 숨은 타일의 면 보고 = 대화 아님", await ev(`window.__faceCalls().filter((a) => a.stream === 's-b' && a.convo === true).length`), 0);
check("① 대화 면 = 키 띠 숨음", await strip(), false);
await shot("phone-convo.png");

// ── ①b 키 띠 — 면 · 타일에 따라 · 넘겨도 PTY 크기가 흔들리지 않는다(B안 — 목업 YLJE1mCKsE1NJXQzMiDM5c) ────────────
await ev(`document.querySelector('form.line input').value = ''`);
await ev(`(async () => (await ${F}).setFlipView('ai-a', 'term'))()`);
await sleep(700);
check("①b 터미널 면 = 띠 있음", await strip(), true);
await shot("phone-convo-term.png");
await ev(`(() => { const i = document.querySelector('form.line input'); i.value = '치던 글'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(100);
await ev(`(async () => (await ${M}).setStickyCtrl(true))()`);
await sleep(100);
await ev(`(async () => (await ${F}).setFlipView('ai-a', 'convo'))()`);
await sleep(700);
check("①b 띠가 숨으면 끈적 Ctrl 이 풀린다", await ev(`(async () => (await ${M}).stickyCtrl())()`), false);
check("①b 시청자 세션이 붙었다(아래 크기 판정의 전제)", (await ev(`window.__calls.filter(([c]) => c === 'attach_session_viewer').length`)) > 0, true);
const rows0 = await resizes();
const box0 = await ev(`document.querySelector('[data-pane="ai-a"] .term-screen')?.clientHeight ?? -1`);
for (let i = 0; i < 2; i++) {
  await ev(`(async () => (await ${F}).setFlipView('ai-a', 'term'))()`);
  await sleep(700);
  await ev(`(async () => (await ${F}).setFlipView('ai-a', 'convo'))()`);
  await sleep(700);
}
check("①b 왕복해도 크기 보내기 없음 · 대화 면인 동안 refit 없음", (await resizes()).slice(rows0.length), []);
const box1 = await ev(`document.querySelector('[data-pane="ai-a"] .term-screen')?.clientHeight ?? -1`);
console.log(`INFO 대화 면 상자 높이 ${box0} → ${box1}`);
await ev(`(async () => (await ${F}).setFlipView('ai-a', 'term'))()`);
await sleep(700);
check("①b 돌아오면 치던 글 그대로", await ev(`document.querySelector('form.line input').value`), "치던 글");
check("①b 왕복 뒤 크기 보내기 전체", (await resizes()).slice(rows0.length).length <= 1, true);
await ev(`(() => { const i = document.querySelector('form.line input'); i.value = ''; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await pick("tab-s");
await sleep(300);
check("①b 셸 타일 = 띠 있음", await strip(), true);
await pick("tab-a");
await ev(`(async () => (await ${F}).setFlipView('ai-a', 'convo'))()`);
await sleep(700);
await ev(`(async () => (await ${F}).setFlipView('ai-a', 'term'))()`);
await sleep(700);
await ev(`(async () => (await ${F}).setFlipView('ai-a', 'convo'))()`);
await sleep(700);

// 첫 프레임 — 새 AI 타일이 대화 면으로 열릴 때 띠가 한 프레임이라도 보이는가(타일이 선 프레임부터 재서 숨을 때까지)
await ev(`(() => {
  window.__frames = [];
  const tick = () => {
    const f = document.querySelector('[data-pane="ai-f"] [data-flip]');
    if (f) window.__frames.push({ face: f.dataset.flip, strip: !!document.querySelector('.mobile-keys') && getComputedStyle(document.querySelector('.mobile-keys')).display !== 'none' });
    if (window.__frames.length < 30) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
})()`);
await ev(seedTabs("tab-f", `tab('tab-f', { id: 'ai-f', kind: 'local', historyStreamId: 's-f', autorun: 'claude' }),`));
await sleep(1200);
const frames = JSON.parse(await ev(`JSON.stringify(window.__frames)`));
console.log(`INFO 첫 프레임들: ${JSON.stringify(frames.slice(0, 4))}`);
check("①b 첫 프레임부터 띠 없음(깜빡임 없음)", frames.filter((f) => f.strip).length, 0);
await ev(seedTabs("tab-a"));
await sleep(500);

// ── ② xterm 이 포커스를 받아도 키보드를 올리지 않는다 ─────────────────────────────
const hasTextarea = await ev(`!!document.querySelector('[data-pane="ai-a"] [data-flip-term] textarea')`);
if (hasTextarea) {
  await ev(`document.querySelector('[data-pane="ai-a"] [data-flip-term] textarea').focus()`);
  await sleep(200);
  const F2 = JSON.parse(await ev(focusInfo));
  check("② xterm 포커스 → 입력 칸으로 안 감 · 띠의 칸으로도 안 감", [F2.composer, F2.strip], [false, false]);
} else {
  console.log("INFO ② xterm textarea 없음(스텁에서 Terminal 이 아직 서지 않았다) — 판정 건너뜀");
}

// ── ③ 터미널로 돌리면 그대로 · 다음 탭은 처음 볼 때 ─────────────────────────────────
await ev(`(async () => (await ${F}).setFlipView('ai-a', 'term'))()`);
await sleep(600);
check("③ 사람이 터미널로 → 터미널", await face("ai-a"), "term");
await pick("tab-b");
check("③ 다음 탭은 처음 볼 때 대화", await face("ai-b"), "convo");
await pick("tab-a");
check("③ 돌아와도 터미널 그대로", await face("ai-a"), "term");

// ── ④ 사람이 넘기면 예전대로 뒤집는다 ───────────────────────────────────────────
await ev(`(async () => (await ${F}).setFlipView('ai-a', 'convo'))()`);
await sleep(80);
check("④ 사람의 넘기기는 움직임이 있다", (await ev(`document.querySelector('[data-pane="ai-a"] [data-flip]')?.closest('.pane-box')?.getAnimations().length ?? 0`)) > 0, true);
await sleep(700);

// ── ⑤ CLI 가 끝나면 터미널 · 새 CLI 는 다시 대화 ───────────────────────────────────
await ev(seedTabs("tab-n", `tab('tab-n', { id: 'ai-n', kind: 'local', historyStreamId: 's-n' }),`));
await sleep(500);
check("⑤ 평범한 셸 = 대상 아님", await face("ai-n"), null);
await ev(`(async () => (await ${TITLES}).reportRunningCommand('ai-n', 'claude'))()`);
await sleep(500);
check("⑤ 셸에서 친 claude = 처음이면 대화", await face("ai-n"), "convo");
await ev(`(async () => (await ${TITLES}).reportRunningCommand('ai-n', null))()`);
await sleep(500);
check("⑤ CLI 끝 = 대상 아님", await face("ai-n"), null);
await ev(`(async () => (await ${TITLES}).reportRunningCommand('ai-n', 'claude'))()`);
await sleep(500);
check("⑤ 새 CLI = 다시 대화", await face("ai-n"), "convo");

// ── ⑥ 설정 화면의 첫 화면 줄 ────────────────────────────────────────────────────
await ev(`(async () => (await ${SHEETS}).openMobileSettings())()`);
await waitFor(`!!document.querySelector('[data-mobile-ai-face]')`);
await sleep(400);
check("⑥ 설정 줄 · 고른 것 = 대화", JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-mobile-ai-face] button')].map((b) => [b.textContent.trim(), b.getAttribute('aria-checked')]))`)), [["대화", "true"], ["터미널", "false"]]);
await ev(`document.querySelector('[data-mobile-ai-face] button:last-child').scrollIntoView()`);
await sleep(200);
await shot("phone-convo-settings.png");
await ev(`document.querySelector('[data-mobile-ai-face] button:last-child').click()`);
await sleep(200);
check("⑥ 터미널로 고르면 저장", await ev(`localStorage.getItem('aynx.remote.aiFace')`), "term");
await ev(`(async () => (await ${SHEETS}).closeMobileOverlay())()`);
await sleep(300);
await ev(seedTabs("tab-x", `tab('tab-x', { id: 'ai-x', kind: 'local', historyStreamId: 's-x', autorun: 'claude' }),`));
await sleep(700);
check("⑥ 옵션 터미널 = 새 타일 안 넘어감", await face("ai-x"), "term");

await boot(400, true, "term");
await ev(seedTabs("tab-a"));
await waitFor(`!!document.querySelector('[data-pane="ai-a"] [data-flip]')`);
await sleep(700);
check("⑥ 다시 떠도 터미널", [await ev(`(async () => (await ${M}).aiFacePref())()`), await face("ai-a")], ["term", "term"]);

// ── 입력 방식 '바로 입력' 일 때의 그림(겹침 비교용) ─────────────────────────────────
await boot(400, true);
await ev(`(async () => (await ${M}).setInputMode('direct'))()`);
await ev(seedTabs("tab-a"));
await waitFor(`!!document.querySelector('[data-pane="ai-a"] [data-flip]')`);
await sleep(700);
await shot("phone-convo-direct.png");
await ev(`(async () => (await ${M}).setInputMode('field'))()`);

// ── 폰의 Claude 폴더 신뢰 질문(2026-11-04 — 실측 글자 · 시청자 터미널 대신 화면 읽기를 갈아 끼운다) ──────
await boot(400, true);
await ev(seedTabs("tab-a"));
await waitFor(`!!document.querySelector('[data-pane="ai-a"] [data-flip]')`);
const TA = importApp("lib/term-actions.ts");
await waitFor(`(async () => !!(await ${TA}).termActionsOf('ai-a'))()`);
await ev(`(async () => { (await ${TA}).termActionsOf('ai-a').screenLines = () => [' \u276f No, exit', '   Yes, I trust this folder', '', ' Enter to confirm \u00b7 Esc to cancel']; })()`);
await sleep(1400);
const tq = (sel) => `document.querySelector('[data-pane="ai-a"] ${sel}')`;
check("폰 신뢰 ① 대화 면 말풍선", [await face("ai-a"), await ev(`!!${tq("[data-claude-trust-hint]")}`)], ["convo", true]);
check("폰 신뢰 ② 칸 막힘 · 키 띠 없음", [await ev(`${tq("[data-flip-input]")}.readOnly`), await ev(`getComputedStyle(document.querySelector('.mobile-keys')).display`)], [true, "none"]);
const fit = JSON.parse(await ev(`(() => { const h = ${tq("[data-claude-trust-hint]")}.getBoundingClientRect(); const w = ${tq("[data-flip-input]")}.closest('.wrap').getBoundingClientRect(); return JSON.stringify({ left: h.left >= 0, right: h.right <= innerWidth, tail: h.bottom + 6 <= w.top, bottom: w.bottom <= innerHeight }); })()`));
check("폰 신뢰 ③ 말풍선 · 꼬리 · 칸이 화면 안", fit, { left: true, right: true, tail: true, bottom: true });
check("폰 신뢰 ④ 포커스 안 줌", JSON.parse(await ev(focusInfo)).composer, false);
await shot("trust-phone.png");
await ev(`${tq("[data-claude-trust-terminal]")}.click()`);
await sleep(900);
check("폰 신뢰 ⑤ 단추 → 터미널 면 · 키 띠 복귀", [await face("ai-a"), await ev(`getComputedStyle(document.querySelector('.mobile-keys')).display !== 'none'`)], ["term", true]);

// ── ⑦ 넓은 폭 ───────────────────────────────────────────────────────────────
await boot(1280, false);
check("⑦ 넓은 원격 창 = 폰 배치 아님", await ev(`(async () => (await ${M}).mobileLayout())()`), false);
await ev(seedTabs("tab-a"));
await waitFor(`!!document.querySelector('[data-pane="ai-a"] [data-flip]')`);
await sleep(700);
check("⑦ 넓은 폭은 터미널 그대로", await face("ai-a"), "term");

check("⑧ 예외 0", errors, []);
console.log(`${bad === 0 ? "ok" : "FAIL"} — 실패 ${bad}`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
