// 헤드리스 검증 — **원격 웹 창 · 폰의 AI 타일 대화 면 입력 칸**(2026-11-13 — `flip-composer-harness.mjs` 의 원격 판 · `pane/AiFlip.svelte`).
// 원격 창 흉내(`window.__AYNX_REMOTE__` · 창 이름 `remote-h-1`)로 뜨고 탭은 `applyMirrorTabs` 로 세운다(`phone-convo-harness` 와 같은 길) — AI 타일의
// 명세에 대화 연결(`agentLink`)을 실어 터미널이 마운트되며 표에 심는다(`seedAgentLink`). 쪽 스텁은 최신 쪽에 `last` 를 싣는다.
//
// 데스크톱 폭(1280) · 폰(400 · 모바일)마다 보는 것: ① [+] · 키워드 `Opus 5.5` · 막대 2/5 ② [+] 진짜 마우스 → 파일 고르기 창 → `stage_agent_attachment`
// → 칩 ③ 키워드 → 메뉴(body · 화면 안 · 폰은 줄 44px) → Sonnet = `write_session` 으로 정확히 `/model sonnet` + `\r` ④ Effort Max = `/effort max` + `\r`
// ⑤ 일하는 중(실행 신호) 잠김 ⑦ (2026-11-14) 집 PC Codex 타일 — 모델 목록(`codex_models`) → 정확히 `/model gpt-6-luna --reasoning=medium` +
// `\r` ⑧ SSH Codex 타일(그 서버의 목록을 모른다) — 모델 줄 없이 게이지(대체 넷)만 → `/model --reasoning=high` + `\r` ⑨ (2026-11-14) 보낸 뒤
// 화면에 확인 문구가 뜨면 키워드가 곧바로 · 거절이면 그대로 ⑩ Claude 모델 전환 확인 카드 · 잠금 · [취소] = 정확히 `2` · 사라지면 걷힘 ⑩b Effort 확인도
// 같은 카드 ⑦b Codex 가 첫 Enter 를 삼켜 입력 줄에 남으면 Enter 하나 더 ⑥ 콘솔 오류 0.
//
//   node scripts/dev/run-harness.mjs flip-composer-remote-harness.mjs <outdir> --size 1280x860
//     → <outdir>/remote-desktop-menu.png · remote-phone.png · remote-phone-menu.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
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
const choosers = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
    return;
  }
  if (d.method === "Page.fileChooserOpened") choosers.push(d.params);
  if (d.method === "Runtime.exceptionThrown") {
    const x = d.params.exceptionDetails;
    const s = (x.exception?.description ?? x.text ?? "").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("EXC " + s);
  }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    const s = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("console.error " + s);
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
/** 진짜 누르기 — 폰이면 터치, 아니면 마우스(파일 고르기 창은 사용자 활성화가 있어야 열린다) */
const tap = async (sel, touch) => {
  const r = JSON.parse(await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`));
  if (!r) return false;
  if (touch) {
    await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: r.x, y: r.y }] });
    await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  } else {
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
    }
  }
  await sleep(400);
  return true;
};
let bad = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${ok ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

const CONV = "11111111-2222-4333-8444-0000000000d1";
const CONVX = "01a07989-25f8-7e72-99aa-0000000000d2";
const CONVS = "01a07989-25f8-7e72-99aa-0000000000d3";
await send("Page.enable");
await send("Runtime.enable");
await send("Page.setInterceptFileChooserDialog", { enabled: true });
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  window.__AYNX_REMOTE__ = true;
  window.__chanV = {};
  /** 원격 뷰어 스트림에 화면 글을 흘린다 */
  window.__feedV = (stream, text) => { const c = window.__chanV[stream]; if (!c) return 'no viewer'; const cb = window.__cbsRef?.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  const cbs = new Map(); window.__cbsRef = cbs; let n = 0; window.__calls = []; window.__writes = []; window.__staged = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  const T0 = Date.now() - 3600_000;
  window.__tx = [
    { role: 'user', text: '탭 전환 슬라이드 끝을 천천히 멈추게 해줘', truncated: false, images: 0, tool: null, at: T0 },
    { role: 'assistant', text: 'tab-slide.svelte.ts 의 곡선을 바꿨습니다.', truncated: false, images: 0, tool: null, at: T0 + 1000 },
  ];
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
    tile_permission_face: null, tile_permission_subscribe: null, tile_permission_snapshot: { cards: [] },
    resize_session: null, claim_session_size: true, ack_session: null, detach_session_viewer: null,
    codex_models: { configured: null, models: ['gpt-6-astra', 'gpt-6-luna'],
      levels: { 'gpt-6-astra': { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], default: 'low' }, 'gpt-6-luna': { levels: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' } } },
  };
  const LASTS = { [${JSON.stringify(CONV)}]: { model: 'claude-opus-5-5', effort: 'medium' }, [${JSON.stringify(CONVX)}]: { model: 'gpt-6-astra', effort: 'ultra' }, [${JSON.stringify(CONVS)}]: { model: 'gpt-6-sol', effort: 'medium' } };
  let nextViewer = 7;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'remote-h-1' }, currentWebview: { label: 'remote-h-1', windowLabel: 'remote-h-1' }, windows: [{ label: 'remote-h-1' }], webviews: [{ label: 'remote-h-1', windowLabel: 'remote-h-1' }] },
    invoke: (cmd, args, opts) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      // SSH 타일(스트림 s-s)은 kind 'ssh' 로 답한다 — 아니면 붙지 않는다
      if (cmd === 'probe_session') return Promise.resolve({ state: 'attached', kind: args.kind ?? 'local', sessionEpoch: 1, checkpoint: null });
      if (cmd === 'attach_session_viewer') { const id = nextViewer++; window.__chanV[args.stream] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, kind: args.stream === 's-s' ? 'ssh' : 'local', viewer: true, lease: { stream: args.stream, sessionEpoch: 1, leaseEpoch: 1 }, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh', sizeOwner: true }); }
      if (cmd === 'write_session') { window.__writes.push([args.id, args.data]); return Promise.resolve(null); }
      if (cmd === 'stage_agent_attachment') {
        const name = decodeURIComponent(opts?.headers?.['x-file-name'] ?? 'x');
        window.__staged.push(name);
        return Promise.resolve('C:/Users/u/AppData/Roaming/aynx/attachments/abc/' + name);
      }
      if (cmd === 'agent_conversation_transcript' || cmd === 'agent_conversation_transcript_remote') {
        const all = window.__tx; const lim = args.limit ?? 40;
        const end = args.before ?? all.length; const start = Math.max(0, end - lim);
        const last = LASTS[cmd === 'agent_conversation_transcript_remote' ? args.conversation : args.id];
        return Promise.resolve({ items: all.slice(start, end), cursor: start > 0 ? start : null, ...(args.before == null && last ? { last } : {}) });
      }
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
  try { localStorage.clear(); } catch {}
`,
});

const T = importApp("app/tabs.svelte.ts");
const WS = importApp("app/workspaces.svelte.ts");
const FV = importApp("pane/ai-flip.svelte.ts");
const seedTabs = `(async () => {
  const [t, w] = await Promise.all([${T}, ${WS}]);
  const ws = w.currentWorkspaceId();
  const tab = (id, pane) => ({ id, title: id, tabKey: 'k-' + id, workspaceId: ws, root: { type: 'leaf', pane: { tileKey: 'tk-' + pane.id, ...pane } } });
  t.applyMirrorTabs([
    tab('tab-a', { id: 'ai-a', kind: 'local', historyStreamId: 's-a', autorun: 'claude', agentLink: { agent: 'claude', id: ${JSON.stringify(CONV)} } }),
    tab('tab-c', { id: 'cx-l', kind: 'local', historyStreamId: 's-c', autorun: 'codex', agentLink: { agent: 'codex', id: ${JSON.stringify(CONVX)} } }),
    tab('tab-s', { id: 'cx-s', kind: 'ssh', alias: 'dev', historyStreamId: 's-s', autorun: 'codex', agentLink: { agent: 'codex', id: ${JSON.stringify(CONVS)} } }),
  ], 'tab-a', {});
})()`;
const P = `[data-pane="ai-a"] [data-flip-convo]`;
const kwInfo = async () =>
  JSON.parse(await ev(`(() => { const k = document.querySelector('${P} [data-chat-model-chip]'); if (!k) return 'null';
    return JSON.stringify({ name: k.querySelector('[data-chat-model-name]')?.textContent.trim() ?? null, bars: k.querySelector('[data-chat-effort-bars]')?.dataset.chatEffortBars ?? null, locked: k.hasAttribute('data-locked') }); })()`));
const writes = async () => JSON.parse(await ev(`JSON.stringify(window.__writes.map((w) => w[1]))`));
const sample = path.resolve(outdir, "remote-sample.log");
fs.writeFileSync(sample, "remote attachment\n");

for (const mode of [{ name: "desktop", width: 1280, height: 860, mobile: false }, { name: "phone", width: 400, height: 844, mobile: true }]) {
  const touch = mode.mobile;
  console.log(`── ${mode.name} ──`);
  await send("Emulation.setDeviceMetricsOverride", { width: mode.width, height: mode.height, deviceScaleFactor: mode.mobile ? 2 : 1, mobile: mode.mobile });
  await send("Emulation.setTouchEmulationEnabled", { enabled: mode.mobile, maxTouchPoints: mode.mobile ? 5 : 1 });
  await send("Page.reload", { ignoreCache: true });
  await waitFor(`performance.getEntriesByType('resource').some(r => r.name.includes('app/tabs.svelte.ts')) && !!document.querySelector('.app')`, 20000);
  await sleep(1200);
  errors.length = 0;
  await ev(seedTabs);
  await waitFor(`!!document.querySelector('[data-pane="ai-a"] [data-flip]')`);
  await sleep(600);
  if (!mode.mobile) await ev(`(async () => (await ${FV}).setFlipView('ai-a', 'convo'))()`);
  await waitFor(`!!document.querySelector('${P} [data-chat-model-name]')`, 8000);
  await sleep(500);

  // ①
  check(`① ${mode.name}: 대화 면 · [+] · Opus 5.5 · 막대 2/5`, [await ev(`document.querySelector('[data-pane="ai-a"] [data-flip]')?.dataset.flip ?? null`), await ev(`!!document.querySelector('${P} [data-flip-plus]')`), await kwInfo()], ["convo", true, { name: "Opus 5.5", bars: "2", locked: false }]);
  if (mode.mobile) await shot("remote-phone.png");

  // ② [+]
  choosers.length = 0;
  await tap(`${P} [data-flip-plus]`, touch);
  await sleep(300);
  check(`② ${mode.name}: [+] → 파일 고르기 창`, choosers.length, 1);
  if (choosers[0]) await send("DOM.setFileInputFiles", { files: [sample], backendNodeId: choosers[0].backendNodeId });
  await sleep(1200);
  check(`② ${mode.name}: stage_agent_attachment → 칩`, [await ev(`window.__staged.at(-1) ?? null`), await ev(`document.querySelectorAll('${P} [data-flip-attachment]').length`)], ["remote-sample.log", 1]);
  await ev(`document.querySelector('${P} [data-flip-attachment-remove]')?.click()`);
  await sleep(200);

  // ③ 메뉴 → Sonnet
  await tap(`${P} [data-chat-model-chip]`, touch);
  await sleep(400);
  const m = JSON.parse(await ev(`(() => { const m = document.querySelector('[data-flip-model-menu]'); if (!m) return 'null'; const b = m.getBoundingClientRect();
    return JSON.stringify({ inBody: m.parentElement === document.body, inView: b.left >= 0 && b.top >= 0 && b.right <= innerWidth && b.bottom <= innerHeight, rowH: Math.round(m.querySelector('[data-flip-model]').getBoundingClientRect().height), models: m.querySelectorAll('[data-flip-model]').length }); })()`));
  check(`③ ${mode.name}: 메뉴 — body · 화면 안 · 줄 높이 · Default + 모델 넷`, m, { inBody: true, inView: true, rowH: mode.mobile ? 44 : 32, models: 5 });
  await shot(`remote-${mode.name}-menu.png`);
  const w0 = (await writes()).length;
  await tap(`[data-flip-model="sonnet"]`, touch);
  await sleep(700);
  check(`③ ${mode.name}: Sonnet → write_session 으로 /model sonnet + Enter · 메뉴 닫힘`, [(await writes()).slice(w0).join(""), await ev(`!!document.querySelector('[data-flip-model-menu]')`)], ["/model sonnet\r", false]);

  // ④ Effort Max
  await tap(`${P} [data-chat-model-chip]`, touch);
  await sleep(400);
  const w1 = (await writes()).length;
  await tap(`[data-flip-model-menu] [data-chat-effort="max"]`, touch);
  await sleep(700);
  check(`④ ${mode.name}: Max → /effort max + Enter`, (await writes()).slice(w1).join(""), "/effort max\r");

  // ⑤ 일하는 중 — 잠김
  await ev(fakeAgentSignal({ stream: "s-a", event: "start", session: CONV, cli: "claude" }));
  await sleep(600);
  check(`⑤ ${mode.name}: 일하는 중 잠김`, (await kwInfo())?.locked ?? null, true);
  await ev(fakeAgentSignal({ stream: "s-a", event: "stop", session: CONV, cli: "claude" }));
  await sleep(400);

  // ⑨ (2026-11-14) 보낸 뒤 화면에 CLI 의 확인 문구 → 키워드가 곧바로 · 거절이면 그대로
  {
    const before = (await kwInfo())?.name ?? null;
    await tap(`${P} [data-chat-model-chip]`, touch);
    await sleep(400);
    const w9 = (await writes()).length;
    await tap(`[data-flip-model="haiku"]`, touch);
    await sleep(500);
    const fed = await ev(`window.__feedV('s-a', ${JSON.stringify("\r\n❯ /model haiku\r\n  ⎿  Set model to Haiku 5.5 and saved as your default for new sessions\r\n" + "\r\n────────\r\n❯\u00a0\x1b[2mTry\x1b[22m\r\n────────\r\n")})`);
    await sleep(800);
    check(`⑨ ${mode.name}: 확인 문구 → 곧바로 Haiku 5.5`, [before, (await writes()).slice(w9).join(""), fed, (await kwInfo())?.name ?? null], ["Opus 5.5", "/model haiku\r", "ok", "Haiku 5.5"]);
    await tap(`${P} [data-chat-model-chip]`, touch);
    await sleep(400);
    await tap(`[data-flip-model="sonnet"]`, touch);
    await sleep(500);
    await ev(`window.__feedV('s-a', ${JSON.stringify("\r\n❯ /model sonnet\r\n  ⎿  Model 'sonnet' not found\r\n")})`);
    await sleep(3200);
    check(`⑨ ${mode.name}: 거절 문구 → 그대로`, (await kwInfo())?.name ?? null, "Haiku 5.5");
    // ⑩ 전환 확인 카드 — 카드 · 잠금 · [취소] = 정확히 2 · 화면에서 사라지면 걷힘
    const SWITCH = "\x1b[2J\x1b[H   Switch model?\r\n   Your next response will be slower and use more tokens\r\n\r\n   \u276f 1. Yes, switch to Opus 5.5\r\n     2. No, go back\r\n";
    await ev(`window.__feedV('s-a', ${JSON.stringify(SWITCH)})`);
    await sleep(1400);
    const card = JSON.parse(await ev(`(() => { const c = document.querySelector('${P} [data-flip-model-switch]'); const f = document.querySelector('${P} [data-flip-input]');
      return JSON.stringify({ title: c?.querySelector('[data-flip-model-switch-title]')?.textContent.trim() ?? null, readonly: f?.readOnly ?? null, locked: !!document.querySelector('${P} [data-chat-model-chip][data-locked]'),
        btnH: Math.round(c?.querySelector('[data-flip-model-switch-yes]')?.getBoundingClientRect().height ?? 0) }); })()`));
    check(`⑩ ${mode.name}: 확인 화면 → 카드 · 칸 · 키워드 잠김`, [card.title, card.readonly, card.locked, card.btnH >= (mode.mobile ? 40 : 24)], ["Opus 5.5로 모델 전환", true, true, true]);
    await shot(`remote-${mode.name}-switch.png`);
    const w10 = (await writes()).length;
    await tap(`${P} [data-flip-model-switch-no]`, touch);
    await sleep(200);
    check(`⑩ ${mode.name}: [취소] → write_session 으로 정확히 2`, (await writes()).slice(w10).join(""), "2");
    await ev(`window.__feedV('s-a', ${JSON.stringify("\x1b[2J\x1b[H❯ /model opus\r\n  ⎿  Kept model as Haiku 5.5\r\n")})`);
    await sleep(1400);
    check(`⑩ ${mode.name}: 화면에서 사라지면 카드 없음 · 칸 풀림`, [await ev(`!!document.querySelector('${P} [data-flip-model-switch]')`), await ev(`document.querySelector('${P} [data-flip-input]')?.readOnly ?? null`)], [false, false]);
    // ⑩b /effort 의 확인("Change effort level?")도 같은 카드
    await ev(`window.__feedV('s-a', ${JSON.stringify("\x1b[2J\x1b[H   Change effort level?\r\n   Your next response will be slower and use more tokens\r\n\r\n   \u276f 1. Yes, switch to high\r\n     2. No, go back\r\n")})`);
    await sleep(1400);
    check(`⑩b ${mode.name}: Effort 확인 → 카드 제목`, await ev(`document.querySelector('${P} [data-flip-model-switch-title]')?.textContent.trim() ?? null`), "Effort High로 변경");
    await ev(`window.__feedV('s-a', ${JSON.stringify("\x1b[2J\x1b[H")})`);
    await sleep(1400);
  }

  // ⑪ (2026-11-14 실기) Claude 화면이 확인 줄로 넘친 뒤 — 같은 값 두 번 · 연속 변경도 첫 번에(줄 수 비교는 놓쳤다)
  {
    const pair = (l) => `\r\n❯ /effort ${l}\r\n  ⎿  Set effort level to ${l} (saved as your default for new sessions): Comprehensive implementation\r\n`;
    const box = "\r\n────────\r\n❯\u00a0\x1b[2mTry\x1b[22m\r\n────────\r\n";
    let fill = "";
    for (let i = 0; i < 30; i++) fill += pair("high");
    // 맨 아래 짝은 이미 /effort low(앞서 보낸 것의 확인을 키워드가 놓쳤던 상황 — 사용자 화면)
    await ev(`window.__feedV('s-a', ${JSON.stringify(fill + pair("low") + box)})`);
    await sleep(500);
    const bars = [];
    for (const l of ["low", "medium", "max"]) {
      await tap(`${P} [data-chat-model-chip]`, touch);
      await sleep(300);
      await tap(`[data-flip-model-menu] [data-chat-effort="${l}"]`, touch);
      await ev(`window.__feedV('s-a', ${JSON.stringify("")} + ${JSON.stringify(pair("LVL") + box)}.replace(/LVL/g, ${JSON.stringify(l)}))`);
      await sleep(900);
      bars.push((await kwInfo())?.bars ?? null);
    }
    check(`⑪ ${mode.name}: 넘친 화면 — 같은 값(이미 low) · medium · max 모두 첫 번에`, bars, ["1", "2", "5"]);
  }

  // ⑫ 실제 Claude 의 그리기(되울림 행을 칸 끝까지 채우고 줄바꿈 없이 다음 행 — xterm 이 isWrapped)에서도 첫 번에 · 확인 카드도
  {
    const cols = await ev(`(async () => (await ${importApp("lib/term-actions.ts")}).termActionsOf('ai-a').screenSnapshot().cols)()`);
    await tap(`${P} [data-chat-model-chip]`, touch);
    await sleep(300);
    await tap(`[data-flip-model-menu] [data-chat-effort="high"]`, touch);
    await ev(`window.__feedV('s-a', ${JSON.stringify("\r\n" + "FULLECHO" + "  ⎿  Set effort level to high (saved as your default for new sessions)\r\n\r\n❯\u00a0\r\n")}.replace("FULLECHO", ${JSON.stringify("❯ /effort high")} + " ".repeat(Math.max(0, ${cols} - 14))))`);
    await sleep(900);
    check(`⑫ ${mode.name}: 칸 끝까지 채운 되울림 다음 행의 확인 — 첫 번에 3/5`, (await kwInfo())?.bars ?? null, "3");
    await ev(`window.__feedV('s-a', ${JSON.stringify("\r\n")} + "▔".repeat(${cols}) + ${JSON.stringify("   Switch model?\r\n   Your next response will be slower and use more tokens\r\n\r\n   \u276f 1. Yes, switch to Haiku 5.5\r\n     2. No, go back\r\n")})`);
    await sleep(1400);
    check(`⑫ ${mode.name}: 칸 끝까지 찬 구분선 다음 행의 Switch model? — 카드`, await ev(`document.querySelector('${P} [data-flip-model-switch-title]')?.textContent.trim() ?? null`), "Haiku 5.5로 모델 전환");
    await tap(`${P} [data-flip-model-switch-no]`, touch);
    await ev(`window.__feedV('s-a', ${JSON.stringify("\x1b[2J\x1b[H❯ /model haiku\r\n  ⎿  Kept model as Opus 5.5\r\n")})`);
    await sleep(1400);
  }

  // ⑦ 집 PC Codex 타일 — 모델 목록 · 모델 줄
  const openTab = async (tabId, paneId) => {
    await ev(`(async () => (await ${T}).selectTab(${JSON.stringify(tabId)}))()`);
    await sleep(600);
    if (!mode.mobile) await ev(`(async () => (await ${FV}).setFlipView(${JSON.stringify(paneId)}, 'convo'))()`);
    await waitFor(`!!document.querySelector('[data-pane="${paneId}"] [data-flip-convo] [data-chat-model-name]')`, 8000);
    await sleep(500);
  };
  const menuOf = async () => JSON.parse(await ev(`(() => { const m = document.querySelector('[data-flip-model-menu]'); if (!m) return 'null';
    return JSON.stringify({ models: [...m.querySelectorAll('[data-flip-model]')].map((b) => b.dataset.flipModel), efforts: [...m.querySelectorAll('[data-chat-effort]')].map((b) => b.dataset.chatEffort), note: m.querySelector('[data-flip-model-note]')?.textContent.trim() }); })()`));
  await openTab("tab-c", "cx-l");
  await tap(`[data-pane="cx-l"] [data-flip-convo] [data-chat-model-chip]`, touch);
  await sleep(400);
  check(`⑦ ${mode.name}: 집 PC Codex 메뉴 — 목록 · astra 단계 여섯 · 이 세션에만`, await menuOf(), { models: ["gpt-6-astra", "gpt-6-luna"], efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], note: "이 세션에만 적용됩니다" });
  await shot(`remote-${mode.name}-codex-menu.png`);
  const w7 = (await writes()).length;
  await tap(`[data-flip-model="gpt-6-luna"]`, touch);
  await sleep(800);
  check(`⑦ ${mode.name}: luna(지금 ultra 를 못 받음 → 그 모델 기본) → /model gpt-6-luna --reasoning=medium + Enter`, (await writes()).slice(w7).join(""), "/model gpt-6-luna --reasoning=medium\r");
  // ⑦b Codex 가 첫 Enter 를 삼켜 입력 줄에 보낸 글이 남으면 Enter 하나 더(고정 키)
  await tap(`[data-pane="cx-l"] [data-flip-convo] [data-chat-model-chip]`, touch);
  await sleep(400);
  const w7b = (await writes()).length;
  await tap(`[data-flip-model-menu] [data-chat-effort="high"]`, touch);
  await ev(`window.__feedV('s-c', ${JSON.stringify("\r\n› /model --reasoning=high\r\n")})`);
  await sleep(1200);
  check(`⑦b ${mode.name}: 입력 줄에 남음 → Enter 하나 더`, (await writes()).slice(w7b).join(""), "/model --reasoning=high\r\r");
  // ⑦c Codex 화면이 확인 줄로 넘친 뒤 — 첫 번에 · 같은 값 두 번. 데스크톱만 — 폰 흉내의 숨은 터미널은 10열 남짓 · 몇 행뿐이라 55자 확인 줄이
  // 접혀 한 번 흘린 사이에 화면 밖으로 나간다(실기 폰의 타일 크기가 아니다 — 접힌 줄 잇기는 ⑪ · 단위 시험이 본다)
  if (!mode.mobile) {
    const ack = (l) => `\r\n• Model changed to gpt-6-luna ${l} for this session only\r\n`;
    const box = "\r\n› \x1b[2mAsk Codex to do anything\x1b[22m\r\n";
    let fill = "";
    for (let i = 0; i < 40; i++) fill += ack("medium");
    await ev(`window.__feedV('s-c', ${JSON.stringify(fill + ack("low") + box)})`);
    await sleep(500);
    const bars = [];
    for (const l of ["low", "high"]) {
      await tap(`[data-pane="cx-l"] [data-flip-convo] [data-chat-model-chip]`, touch);
      await sleep(300);
      await tap(`[data-flip-model-menu] [data-chat-effort="${l}"]`, touch);
      await ev(`window.__feedV('s-c', ${JSON.stringify("")} + ${JSON.stringify(ack("LVL") + box)}.replace(/LVL/g, ${JSON.stringify(l)}))`);
      await sleep(900);
      bars.push(await ev(`document.querySelector('[data-pane="cx-l"] [data-flip-convo] [data-chat-effort-bars]')?.dataset.chatEffortBars ?? null`));
    }
    check(`⑦c ${mode.name}: Codex 넘친 화면 — 같은 값(이미 low) · high 모두 첫 번에`, bars, ["1", "3"]);
  }

  // ⑧ SSH Codex 타일 — 그 서버 목록을 모른다: 게이지만
  await openTab("tab-s", "cx-s");
  check(`⑧ ${mode.name}: SSH Codex 키워드`, await ev(`document.querySelector('[data-pane="cx-s"] [data-flip-convo] [data-chat-model-name]')?.textContent.trim() ?? null`), "GPT-6-sol");
  await tap(`[data-pane="cx-s"] [data-flip-convo] [data-chat-model-chip]`, touch);
  await sleep(400);
  check(`⑧ ${mode.name}: SSH Codex 메뉴 — 모델 줄 없음 · 대체 단계 넷 · 이 세션에만`, await menuOf(), { models: [], efforts: ["low", "medium", "high", "xhigh"], note: "이 세션에만 적용됩니다" });
  await shot(`remote-${mode.name}-ssh-codex-menu.png`);
  const w8 = (await writes()).length;
  await tap(`[data-flip-model-menu] [data-chat-effort="high"]`, touch);
  await sleep(800);
  check(`⑧ ${mode.name}: 칸 → /model --reasoning=high + Enter`, (await writes()).slice(w8).join(""), "/model --reasoning=high\r");

  check(`⑥ ${mode.name}: console errors`, errors, []);
}
fs.rmSync(sample, { force: true });
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
