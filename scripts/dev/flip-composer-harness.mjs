// 헤드리스 검증 — **AI 타일 대화 면 입력 칸의 [+] · 모델 키워드**(2026-11-13 — `pane/AiFlip.svelte` · `pane/FlipModelMenu.svelte` ·
// `pane/flip-model.ts` · 목업 E2 · E3 · E4). 스텁은 `ai-flip-harness.mjs` 의 사본(가짜 로컬 세션 · `write_session` 기록 · 훅 신호 ·
// `agent_conversation_transcript`)에 쪽의 `last`(마지막 답의 모델 · 강도 — 대화 id 마다 `window.__txLast`)와 `stage_agent_attachment` 를 더했다.
//
// 보는 것: ① 첫 답 전(대화 모름) — [+] · 로고만(이름 · 막대 없음) · 760 단 여백(좁은 독 여백 아님) ② 기록의 모델 · 강도 — `Opus 5.5` · 막대 2/5 ·
// title 에 단계 이름 · 알약 안 자리([+] 왼쪽 · 키워드는 보내기 왼쪽 · 글이 둘 밑으로 안 감) ③ [+] = 진짜 마우스 → 파일 고르기 창(메뉴 없음) →
// 고른 파일이 `stage_agent_attachment` → 칩 → 보내면 그 경로 괄호 붙여넣기 + 글 ④ 키워드 → 메뉴(body 로 portal · Default + 모델 넷 fable · opus · sonnet · haiku ·
// ✓ opus · Default 고리 + Effort 칸 다섯 · Medium 고름 · 안내 한 줄) — Sonnet 을 누르면 입력 문으로 정확히 `/model sonnet\r` · 메뉴 닫힘 · 키워드는 그대로(화면에
// 확인 문구가 없으면) ⑤ Effort High → `/effort high\r` ⑥ 메뉴 안 Esc = 메뉴만 닫힘(대화 면 그대로 · 아무것도 안 나감) ⑦ 다음 답이 기록에 남으면 키워드가
// `Sonnet 5.5` · 막대 3/5 ⑧ 일하는 중 — 흐리게 잠김 · ⌄ 없음 · 눌러도 안 열림 · 끝나면 풀림 ⑨ 권한 대기 — 칸 대신 "터미널에서 답하기"(키워드 없음)
// ⑩ Codex 타일 — `GPT-6-astra` · 막대(그 모델의 단계 수) · 메뉴 = 모델 목록(`codex_models` 스텁 · 고정 순서 · ✓) + 그 모델의 단계(고리 없음) ·
// "이 세션에만" — 모델 = 정확히 `/model gpt-6-luna --reasoning=high\r` · 칸 = `/model --reasoning=xhigh\r` ⑪ 콘솔 오류 0.
// (2026-11-14) ④b Claude Default 줄 = `/model default\r` · Default 고리 = `/effort auto\r` · 안내 "새 Claude 세션의 기본값도" ④c TUI 입력 줄에
// 치다 만 글(흐리지 않은 글)이 있으면 보내지 않고 알림 · 흐린 안내 글이면 보냄. ⑫ 보낸 뒤 화면에 CLI 의 확인 문구가 뜨면 키워드가 곧바로 그 값 ·
// 거절 문구 · 전환 확인 화면이면 그대로 · 덮은 뒤 새 턴의 사람 말 · 도구 항목으로는 그대로(⑫b2) · 그 뒤 새 답(값을 실은 줄)이 기록에
// 남으면 다시 기록 ⑬ Codex — 기록 · 확인 문구 · 거절 ⑭ Claude 모델 전환 확인 카드(목업 E5) —
// 카드 · 입력 칸 · 키워드 잠금 · [취소] = 정확히 `2` · [전환] = 정확히 `1` → "Set model to" 로 키워드 곧바로 · 화면에서 사라지면 걷힘 · 터미널에서 친 `/model` 도 ·
// 누르기 직전 화면에 없으면 안 나감 ⑭b `/effort` 의 확인("Change effort level?")도 같은 카드 ⑬b Codex 가 첫 입력의 Enter 를 삼켜 입력 줄에 보낸 글이
// 남으면 Enter 하나 더(고정 키) · 먹었으면 더 없음.
//
//   node scripts/dev/run-harness.mjs flip-composer-harness.mjs <outdir> --size 1280x860
//     → <outdir>/composer-unknown.png · composer-known.png · composer-menu.png · composer-locked.png · composer-codex-menu.png · composer-attach.png
import { waitBoot } from "./boot-wait.mjs";
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
const shot = async (name) => {
  const p = path.join(outdir, name);
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) {
    fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
    console.log("PNG " + path.resolve(p));
  }
};
const VK = { Escape: 27, Enter: 13 };
const key = async (code, keyName, modifiers = 0, text) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text, unmodifiedText: text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};
/** 진짜 마우스 누르기(사용자 활성화가 있어야 파일 고르기 창이 열린다) */
const clickSel = async (sel) => {
  const r = JSON.parse(await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`));
  if (!r) return false;
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await send("Input.dispatchMouseEvent", { type, x: r.x, y: r.y, button: type === "mouseMoved" ? "none" : "left", clickCount: 1 });
  }
  await sleep(300);
  return true;
};

let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.setInterceptFileChooserDialog", { enabled: true });
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = []; window.__writes = []; window.__staged = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextSession = 100;
  const T0 = Date.now() - 3600_000;
  const U = (i, text) => ({ role: 'user', text, truncated: false, images: 0, tool: null, at: T0 + i * 1000 });
  const A = (i, text) => ({ role: 'assistant', text, truncated: false, images: 0, tool: null, at: T0 + i * 1000 });
  window.__tx = [U(1, '탭 전환 슬라이드 끝을 천천히 멈추게 해줘'), A(2, 'tab-slide.svelte.ts 의 곡선을 바꿨습니다.')];
  /** 대화 id → 최신 쪽의 last(마지막 답의 모델 · 강도) */
  window.__txLast = {};
  window.__txCalls = [];
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_ai_clis: [{id:'claude',name:'Claude Code',command:'claude',installed:true},{id:'codex',name:'Codex',command:'codex',installed:true}],
    mcp_status: { clis: [{id:'claude',name:'Claude Code',installed:true,registered:true},{id:'codex',name:'Codex',installed:true,registered:true}] },
    list_group_meta: {}, list_host_meta: {},
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, send_input: null,
    reap_window_sessions: null, session_log_path: null, list_snippets: [], list_forwards: [],
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    tile_permission_face: null, tile_permission_subscribe: null, tile_permission_snapshot: { cards: [] },
    codex_models: { configured: 'gpt-6-astra', models: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6-luna', 'Bad Slug'],
      levels: { 'gpt-6.1-sol': { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], default: 'low' },
        'gpt-6-astra': { levels: ['low', 'medium', 'high', 'xhigh', 'max', 'ultra'], default: 'low' },
        'gpt-6-luna': { levels: ['low', 'medium', 'high', 'xhigh', 'max'], default: 'medium' } } },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args, opts) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, args }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'write_session') { window.__writes.push([args.id, args.data]); return Promise.resolve(null); }
      if (cmd === 'resize_session') return Promise.resolve(null);
      if (cmd === 'stage_agent_attachment') {
        const name = decodeURIComponent(opts?.headers?.['x-file-name'] ?? 'x');
        window.__staged.push({ name, bytes: args?.byteLength ?? null });
        return Promise.resolve('C:/Users/u/AppData/Roaming/aynx-dev/attachments/abc/' + name);
      }
      if (cmd === 'agent_conversation_transcript') {
        window.__txCalls.push(args);
        const all = window.__tx; const lim = args.limit ?? 40;
        const end = args.before ?? all.length; const start = Math.max(0, end - lim);
        const last = args.before == null ? window.__txLast[args.id] : undefined;
        return Promise.resolve({ items: all.slice(start, end), cursor: start > 0 ? start : null, ...(last ? { last } : {}) });
      }
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; const buf = new TextEncoder().encode(text).buffer; cb({ message: buf, index: c.idx++ }); return 'ok'; };
  try { localStorage.clear(); } catch {}
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
errors.length = 0;

const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const FV = importApp("pane/ai-flip.svelte.ts");
const ESC = "\x1b", BEL = "\x07";
const prompt = `${ESC}]133;A${BEL}PS C:\\> ${ESC}]133;B${BEL}`;
for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${SESS}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
const panesNow = async () =>
  JSON.parse(await ev(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().flatMap((t) => s.listPanes(t.root).map((p) => ({ id: p.id, autorun: p.autorun ?? null, stream: p.historyStreamId ?? null, sid: ss.sessionOf(p.id) })))); })()`));
const writesTo = async (sid) => JSON.parse(await ev(`JSON.stringify(window.__writes.filter((w) => w[0] === ${sid}).map((w) => w[1]))`));

/** AI 타일 하나를 연다 — autorun · 프롬프트 · TUI 그림 */
async function openAi(cli) {
  const known = new Set((await panesNow()).map((p) => p.id));
  await ev(`(async () => { const w = await ${W}; const s = await ${S}; w.openPaneHere(s.newAiPane(${JSON.stringify(cli)})); })()`);
  let ai = null;
  for (let i = 0; i < 50 && !ai; i++) {
    await sleep(300);
    ai = (await panesNow()).find((p) => !known.has(p.id) && p.autorun === cli && p.sid != null) ?? null;
  }
  await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${prompt}${cli}\r\n${ESC}]133;C${BEL}`)})`);
  await sleep(500);
  await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${ESC}[?2004h╭─ ${cli} ─╮\r\n│ > │\r\n╰───────╯\r\n`)})`);
  await sleep(300);
  return ai;
}
const setView = async (id, v) => {
  await ev(`(async () => (await ${FV}).setFlipView(${JSON.stringify(id)}, ${JSON.stringify(v)}))()`);
  await sleep(800);
};
const P = (id) => `[data-pane="${id}"] [data-flip-convo]`;
const kwInfo = async (id) =>
  JSON.parse(await ev(`(() => { const k = document.querySelector('${P(id)} [data-chat-model-chip]'); if (!k) return 'null';
    return JSON.stringify({ name: k.querySelector('[data-chat-model-name]')?.textContent.trim() ?? null, bars: k.querySelector('[data-chat-effort-bars]')?.dataset.chatEffortBars ?? null,
      n: k.querySelectorAll('.kw-bar').length, chev: !!k.querySelector('.kw-chev'), logo: !!k.querySelector('.kw-logo svg, .kw-logo img, .kw-logo span'),
      locked: k.hasAttribute('data-locked'), title: k.getAttribute('title') ?? k.dataset.tip ?? null }); })()`));
const menuInfo = async () =>
  JSON.parse(await ev(`(() => { const m = document.querySelector('[data-flip-model-menu]'); if (!m) return 'null';
    return JSON.stringify({ cli: m.dataset.flipModelMenu, inBody: m.parentElement === document.body, models: [...m.querySelectorAll('[data-flip-model]')].map((b) => b.dataset.flipModel),
      checked: [...m.querySelectorAll('[data-flip-model][aria-checked="true"]')].map((b) => b.dataset.flipModel), efforts: [...m.querySelectorAll('[data-chat-effort]')].map((b) => b.dataset.chatEffort),
      effortOn: [...m.querySelectorAll('[data-chat-effort][aria-checked="true"]')].map((b) => b.dataset.chatEffort), ring: !!m.querySelector('.ring'),
      note: m.querySelector('[data-flip-model-note]')?.textContent.trim() ?? null, cliSwitch: !!m.querySelector('[data-chat-cli]'), custom: !!m.querySelector('[data-chat-model-custom]') }); })()`));

// ── Claude 타일 ─────────────────────────────────────────────────────────────
const ai = await openAi("claude");
console.log("ai tile:", JSON.stringify(ai));
await setView(ai.id, "convo");

// ① 첫 답 전 — [+] · 로고만
const k1 = await kwInfo(ai.id);
check("① 대화 모름 — 키워드 = 로고만(이름 · 막대 없음) · ⌄ 있음", [k1.name, k1.n, k1.chev, k1.logo, k1.locked], [null, 0, true, true, false]);
check("① [+] 가 알약 안 · 타일은 좁은 독 여백 아님", await ev(`(() => { const c = document.querySelector('${P(ai.id)} [data-flip-composer]'); return JSON.stringify([!!c.querySelector('.wrap [data-flip-plus]'), c.classList.contains('compact')]); })()`), JSON.stringify([true, false]));
await shot("composer-unknown.png");

// ② 연결 + 기록의 마지막 답 — Opus 5.5 · Medium
const CONV = "11111111-2222-4333-8444-0000000000c1";
await ev(`window.__txLast[${JSON.stringify(CONV)}] = { model: 'claude-opus-5-5', effort: 'medium', at: 100 }`);
await ev(fakeAgentSignal({ stream: ai.stream, event: "session", session: CONV, cli: "claude" }));
await sleep(2200);
const k2 = await kwInfo(ai.id);
check("② 기록의 값 — Opus 5.5 · 막대 2/5", [k2.name, k2.bars, k2.n], ["Opus 5.5", "2", 5]);
check("② title 에 CLI · 모델 · 단계 이름", k2.title, "Claude Code · Opus 5.5 · Effort · Medium");
const lay = JSON.parse(await ev(`(() => { const c = document.querySelector('${P(ai.id)} [data-flip-composer]'); const r = (s) => c.querySelector(s).getBoundingClientRect();
  const wrap = r('.wrap'), plus = r('[data-flip-plus]'), kw = r('[data-chat-model-chip]'), snd = r('[data-flip-send]'); const f = c.querySelector('[data-flip-input]'); const cs = getComputedStyle(f);
  return JSON.stringify({ plusLeft: plus.left - wrap.left < 12, kwBeforeSend: kw.right <= snd.left + 1, inPill: kw.top >= wrap.top && kw.bottom <= wrap.bottom,
    padL: parseFloat(cs.paddingLeft) >= plus.width, padR: parseFloat(cs.paddingRight) >= kw.width + snd.width }); })()`));
check("② 알약 안 자리 — [+] 왼쪽 · 키워드는 보내기 왼쪽 · 글이 둘 밑으로 안 감", lay, { plusLeft: true, kwBeforeSend: true, inPill: true, padL: true, padR: true });
await shot("composer-known.png");

// ③ [+] — 진짜 마우스 → 파일 고르기 창(메뉴 없음) → 고른 파일이 첨부 길로
const sample = path.resolve(outdir, "notes-sample.txt");
fs.writeFileSync(sample, "harness attachment\n");
choosers.length = 0;
await clickSel(`${P(ai.id)} [data-flip-plus]`);
await sleep(400);
check("③ [+] → 파일 고르기 창 · 메뉴 없음 · 아무 파일(accept 없음) · 여럿", [choosers.length, choosers[0]?.mode ?? null, await ev(`!!document.querySelector('[role="menu"]')`), await ev(`document.querySelector('${P(ai.id)} [data-flip-pick]')?.getAttribute('accept') ?? null`)], [1, "selectMultiple", false, null]);
if (choosers[0]) await send("DOM.setFileInputFiles", { files: [sample], backendNodeId: choosers[0].backendNodeId });
await sleep(1200);
check("③ 고른 파일 → stage_agent_attachment → 칩", [await ev(`JSON.stringify(window.__staged.map((s) => s.name))`), await ev(`[...document.querySelectorAll('${P(ai.id)} [data-flip-attachment]')].map((e) => e.getAttribute('title')).join('|')`)], [JSON.stringify(["notes-sample.txt"]), "notes-sample.txt"]);
await shot("composer-attach.png");
const wA = (await writesTo(ai.sid)).length;
await ev(`document.querySelector('${P(ai.id)} [data-flip-input]').focus()`);
await key("KeyX", "x", 0, "x");
await key("Enter", "Enter", 0, "\r");
await sleep(1200);
check("③ 보내기 = 그 경로 괄호 붙여넣기 → 글 → Enter · 칩 비움", [(await writesTo(ai.sid)).slice(wA).join(""), await ev(`document.querySelectorAll('${P(ai.id)} [data-flip-attachment]').length`)], ["\x1b[200~C:/Users/u/AppData/Roaming/aynx-dev/attachments/abc/notes-sample.txt \x1b[201~x\r", 0]);

// ④ 키워드 → 메뉴 — Sonnet
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(400);
const m1 = await menuInfo();
check("④ 메뉴 — body · Default + 모델 넷 · ✓ opus · Default 고리 + Effort 다섯 · Medium · 안내 · CLI 스위치/직접 입력 없음", m1, {
  cli: "claude", inBody: true, models: ["default", "fable", "opus", "sonnet", "haiku"], checked: ["opus"], efforts: ["", "low", "medium", "high", "xhigh", "max"], effortOn: ["medium"], ring: true,
  note: "새 Claude 세션의 기본값도 함께 바뀝니다", cliSwitch: false, custom: false,
});
check("④ 메뉴는 키워드 위(입력 칸을 가리지 않음) · 포커스 = 고른 줄", [await ev(`document.querySelector('[data-flip-model-menu]').getBoundingClientRect().bottom <= document.querySelector('${P(ai.id)} [data-chat-model-chip]').getBoundingClientRect().top`), await ev(`document.activeElement?.dataset?.flipModel ?? null`)], [true, "opus"]);
await shot("composer-menu.png");
const w1 = (await writesTo(ai.sid)).length;
const pend1 = await ev(`document.querySelectorAll('${P(ai.id)} [data-item="pending"]').length`);
await clickSel(`[data-flip-model="sonnet"]`);
await sleep(600);
check("④ Sonnet → 입력 문으로 정확히 /model sonnet + Enter · 메뉴 닫힘 · 대화 면 그대로", [(await writesTo(ai.sid)).slice(w1).join(""), await menuInfo(), await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip]').dataset.flip`)], ["/model sonnet\r", null, "convo"]);
check("④ 확인 문구가 없으면 그대로 — 키워드는 아직 Opus 5.5", (await kwInfo(ai.id)).name, "Opus 5.5");
check("④ 보낸 뒤 키보드는 입력 칸 · 보내는 중 말풍선 없음", [await ev(`document.activeElement?.hasAttribute('data-flip-input') ?? false`), (await ev(`document.querySelectorAll('${P(ai.id)} [data-item="pending"]').length`)) - pend1], [true, 0]);

// ⑤ Effort High
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(400);
const w2 = (await writesTo(ai.sid)).length;
await clickSel(`[data-flip-model-menu] [data-chat-effort="high"]`);
await sleep(600);
check("⑤ Effort High → /effort high + Enter · 메뉴 닫힘", [(await writesTo(ai.sid)).slice(w2).join(""), await menuInfo()], ["/effort high\r", null]);

// ④b Claude Default — 모델 줄 · 강도 고리
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(400);
const wd = (await writesTo(ai.sid)).length;
await clickSel(`[data-flip-model="default"]`);
await sleep(600);
check("④b Default 줄 → /model default + Enter", (await writesTo(ai.sid)).slice(wd).join(""), "/model default\r");
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(400);
const wa = (await writesTo(ai.sid)).length;
await clickSel(`[data-flip-model-menu] [data-chat-effort=""]`);
await sleep(600);
check("④b Default 고리 → /effort auto + Enter · 메뉴 닫힘", [(await writesTo(ai.sid)).slice(wa).join(""), await menuInfo()], ["/effort auto\r", null]);

// ④c TUI 입력 줄에 치다 만 글 — 보내지 않고 알림. 흐린 안내 글뿐이면 보낸다(실측: 두 CLI 모두 안내 글 = SGR 2)
await ev(`window.__feed(${ai.sid}, ${JSON.stringify("\r\n────────\r\n❯ half typed\r\n────────\r\n")})`);
await sleep(300);
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(400);
const wl = (await writesTo(ai.sid)).length;
await clickSel(`[data-flip-model="haiku"]`);
await sleep(600);
check("④c 남은 글 → 안 나감 · 알림", [(await writesTo(ai.sid)).length - wl, (await ev(`JSON.stringify([...document.querySelectorAll('.toast')].map((e) => e.textContent))`)).includes("치다 만 글")], [0, true]);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify("\r\n────────\r\n❯\u00a0\x1b[2mTry \"refactor\"\x1b[22m\r\n────────\r\n")})`);
await sleep(300);
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(400);
const wl2 = (await writesTo(ai.sid)).length;
await clickSel(`[data-flip-model="haiku"]`);
await sleep(600);
check("④c 흐린 안내 글뿐 → 보냄", (await writesTo(ai.sid)).slice(wl2).join(""), "/model haiku\r");

// ⑥ 메뉴 안 Esc — 메뉴만 닫힘(대화 면 그대로 · 아무것도 안 나감)
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(400);
const w3 = (await writesTo(ai.sid)).length;
await key("Escape", "Escape");
await sleep(500);
check("⑥ Esc = 메뉴만 닫힘 · 대화 면 · 안 나감 · 포커스 = 키워드", [await menuInfo(), await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip]').dataset.flip`), (await writesTo(ai.sid)).length - w3, await ev(`document.activeElement?.hasAttribute('data-chat-model-chip') ?? false`)], [null, "convo", 0, true]);

// ⑦ 다음 답이 기록에 남으면 반영
await ev(`window.__txLast[${JSON.stringify(CONV)}] = { model: 'claude-sonnet-5-5', effort: 'high', at: 200 }; window.__tx.push({ role: 'assistant', text: 'ok', truncated: false, images: 0, tool: null, at: Date.now() })`);
await sleep(2200);
const k7 = await kwInfo(ai.id);
check("⑦ 다음 답 뒤 — Sonnet 5.5 · 막대 3/5", [k7.name, k7.bars], ["Sonnet 5.5", "3"]);

// ⑧ 일하는 중 — 잠김
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await sleep(600);
const k8 = await kwInfo(ai.id);
check("⑧ 일하는 중 — 잠김 · ⌄ 없음 · title 에 안내 · aria-disabled", [k8.locked, k8.chev, k8.title.includes("일하는 동안"), await ev(`document.querySelector('${P(ai.id)} [data-chat-model-chip]').getAttribute('aria-disabled')`)], [true, false, true, "true"]);
check("⑧ 흐림", await ev(`getComputedStyle(document.querySelector('${P(ai.id)} [data-chat-model-chip]')).opacity`), "0.5");
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(400);
check("⑧ 눌러도 메뉴 안 열림 · 보내기 자리 = [중지]", [await menuInfo(), await ev(`!!document.querySelector('${P(ai.id)} [data-flip-interrupt]')`)], [null, true]);
await shot("composer-locked.png");
await ev(fakeAgentSignal({ stream: ai.stream, event: "stop", session: CONV, cli: "claude" }));
await sleep(600);
check("⑧ 끝나면 풀림", [(await kwInfo(ai.id)).locked, (await kwInfo(ai.id)).chev], [false, true]);

// ⑨ 권한 대기 — 칸 대신 "터미널에서 답하기"(키워드 없음)
await ev(fakeAgentSignal({ stream: ai.stream, event: "waiting", detail: "permission", session: CONV, cli: "claude" }));
await sleep(500);
check("⑨ 권한 대기 — 답하기 단추 · 키워드 없음", [await ev(`!!document.querySelector('${P(ai.id)} [data-flip-answer]')`), await kwInfo(ai.id)], [true, null]);
await ev(fakeAgentSignal({ stream: ai.stream, event: "stop", session: CONV, cli: "claude" }));
await sleep(500);

// ⑫ (2026-11-14) 보낸 뒤 CLI 가 화면에 받았다고 알리면 키워드가 곧바로 그 값 — 거절 · 전환 확인 화면이면 그대로 · 다음 답이면 다시 기록
const BOX = "\r\n────────\r\n❯\u00a0\x1b[2mTry \"refactor\"\x1b[22m\r\n────────\r\n";
const pickAndFeed = async (id, sid, sel, screen) => {
  await clickSel(`${P(id)} [data-chat-model-chip]`);
  await sleep(400);
  const w = (await writesTo(sid)).length;
  await clickSel(sel);
  await sleep(500);
  const sent = (await writesTo(sid)).slice(w).join("");
  await ev(`window.__feed(${sid}, ${JSON.stringify(screen)})`);
  await sleep(700);
  return sent;
};
const before12 = (await kwInfo(ai.id)).name;
const s12a = await pickAndFeed(ai.id, ai.sid, `[data-flip-model="haiku"]`, "\r\n❯ /model haiku\r\n  ⎿  Set model to Haiku 5.5 and saved as your default for new sessions\r\n" + BOX);
const k12a = await kwInfo(ai.id);
check("⑫a 확인 문구 → 다음 답 전에 곧바로 Haiku 5.5", [before12, s12a, k12a.name, k12a.bars], ["Sonnet 5.5", "/model haiku\r", "Haiku 5.5", "3"]);
await shot("composer-ack.png");
const s12b = await pickAndFeed(ai.id, ai.sid, `[data-flip-model-menu] [data-chat-effort="low"]`, "\r\n❯ /effort low\r\n  ⎿  Set effort level to low (saved as your default for new sessions): Quick, straightforward\r\n" + BOX);
const k12b = await kwInfo(ai.id);
check("⑫b 강도 확인 → 모델은 덮은 값 그대로 · 막대 1/5", [s12b, k12b.name, k12b.bars], ["/effort low\r", "Haiku 5.5", "1"]);
// ⑫b2 (2026-11-14 실기 버그) 덮은 뒤 새 턴 — 사람 말 · 도구 항목이 기록에 붙고 일하는 중이어도(기록의 last 는 아직 옛 답) 덮은 값 그대로
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await ev(`window.__tx.push({ role: 'user', text: '다음 질문', truncated: false, images: 0, tool: null, at: Date.now() })`);
await sleep(2200);
const k12b2 = await kwInfo(ai.id);
await ev(`window.__tx.push({ role: 'tool', text: null, truncated: false, images: 0, tool: { name: 'Read', summary: 'a.ts' }, at: Date.now() })`);
await sleep(2200);
const k12b3 = await kwInfo(ai.id);
check("⑫b2 새 턴의 사람 말 · 도구 항목 — 덮은 값 그대로(잠김 · Haiku 5.5 · 1/5)", [k12b2.locked, k12b2.name, k12b2.bars, k12b3.name, k12b3.bars], [true, "Haiku 5.5", "1", "Haiku 5.5", "1"]);
// 새 답(effort 칸 있음)이 기록에 남으면 그 값
await ev(`window.__txLast[${JSON.stringify(CONV)}] = { model: 'claude-haiku-5-5', effort: 'max', at: 300 }; window.__tx.push({ role: 'assistant', text: 'done', truncated: false, images: 0, tool: null, at: Date.now() })`);
await ev(fakeAgentSignal({ stream: ai.stream, event: "stop", session: CONV, cli: "claude" }));
await sleep(2200);
const k12b4 = await kwInfo(ai.id);
check("⑫b2 새 답 → 그 기록 값(Haiku 5.5 · 5/5)", [k12b4.name, k12b4.bars, k12b4.locked], ["Haiku 5.5", "5", false]);
const s12c = await pickAndFeed(ai.id, ai.sid, `[data-flip-model="sonnet"]`, "\r\n❯ /model sonnet\r\n  ⎿  Model 'sonnet' not found\r\n" + BOX);
await sleep(2600);
check("⑫c 거절 문구 → 그대로", [s12c, (await kwInfo(ai.id)).name], ["/model sonnet\r", "Haiku 5.5"]);
const SWITCH = "\r\n▔▔▔▔▔▔▔▔▔▔▔▔\r\n   Switch model?\r\n   Your next response will be slower and use more tokens\r\n\r\n   This conversation is cached for the current model. Switching to Opus 5.5 means the full history gets re-read.\r\n\r\n   \u276f 1. Yes, switch to Opus 5.5\r\n     2. No, go back\r\n";
const s12d = await pickAndFeed(ai.id, ai.sid, `[data-flip-model="opus"]`, SWITCH);
await sleep(2600);
check("⑫d 전환 확인 화면 → 그대로(확인 대기)", [s12d, (await kwInfo(ai.id)).name], ["/model opus\r", "Haiku 5.5"]);

// ⑭ 전환 확인 카드(목업 E5) — 카드 · 잠금 · [취소] = "2" · 화면에서 사라지면 걷힘 · 터미널에서 친 /model 도 · [전환] = "1" → 키워드 곧바로
const sw = async () => JSON.parse(await ev(`(() => { const c = document.querySelector('${P(ai.id)} [data-flip-model-switch]'); const f = document.querySelector('${P(ai.id)} [data-flip-input]');
  return JSON.stringify({ card: !!c, title: c?.querySelector('[data-flip-model-switch-title]')?.textContent.trim() ?? null, yes: c?.querySelector('[data-flip-model-switch-yes]')?.textContent.trim() ?? null,
    no: c?.querySelector('[data-flip-model-switch-no]')?.textContent.trim() ?? null, readonly: f?.readOnly ?? null, ph: f?.getAttribute('placeholder') ?? null }); })()`));
const CLEAR = "\x1b[2J\x1b[H";
const sw1 = await sw();
check("⑭ 확인 화면 → 대화 끝에 카드 · 제목 · 단추 · 입력 칸 잠김 · 안내", sw1, { card: true, title: "Opus 5.5로 모델 전환", yes: "전환", no: "취소", readonly: true, ph: "위 확인에 먼저 답하세요" });
check("⑭ 키워드 잠김 · 카드는 입력 칸 위", [(await kwInfo(ai.id)).locked, await ev(`document.querySelector('${P(ai.id)} [data-flip-model-switch]').getBoundingClientRect().bottom <= document.querySelector('${P(ai.id)} [data-flip-composer]').getBoundingClientRect().top + 1`)], [true, true]);
await shot("composer-switch.png");
let w14 = (await writesTo(ai.sid)).length;
await clickSel(`${P(ai.id)} [data-flip-model-switch-no]`);
await sleep(200);
check("⑭ [취소] → 정확히 2 · 카드 걷힘", [(await writesTo(ai.sid)).slice(w14).join(""), (await sw()).card], ["2", false]);
// CLI 가 다시 그리기 전(남은 확인 화면 · 답한 뒤 1.5초 틈 안)에도 카드가 다시 서지 않는다
await sleep(600);
check("⑭ 답한 직후 남은 확인 화면에 카드가 다시 서지 않음", (await sw()).card, false);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(CLEAR + "❯ /model opus\r\n  ⎿  Kept model as Haiku 5.5\r\n" + BOX)})`);
await sleep(1400);
check("⑭ 물러난 뒤 — 카드 없음 · 칸 풀림 · 키워드 그대로", [(await sw()).card, (await sw()).readonly, (await kwInfo(ai.id)).name, (await kwInfo(ai.id)).locked], [false, false, "Haiku 5.5", false]);
// 사람이 터미널에서 /model 을 쳐 뜬 확인도(1초 시계)
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(CLEAR + SWITCH)})`);
await sleep(1400);
check("⑭ 터미널에서 친 /model 의 확인도 카드", (await sw()).title, "Opus 5.5로 모델 전환");
// 화면에서 사라지면(터미널에서 답함) 걷힘 · 아무것도 안 나감
w14 = (await writesTo(ai.sid)).length;
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(CLEAR + BOX)})`);
await sleep(1400);
check("⑭ 화면에서 사라지면 카드 걷힘 · 안 나감", [(await sw()).card, (await writesTo(ai.sid)).length - w14], [false, 0]);
// 카드가 선 뒤 화면이 바뀌었으면 누름은 보내지 않는다(보내기 직전 다시 봄)
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(CLEAR + SWITCH)})`);
await sleep(1400);
w14 = (await writesTo(ai.sid)).length;
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(CLEAR + BOX)})`);
await sleep(80);
await ev(`document.querySelector('${P(ai.id)} [data-flip-model-switch-yes]')?.click()`);
await sleep(300);
check("⑭ 누르기 직전 확인이 사라졌으면 안 나감", (await writesTo(ai.sid)).length - w14, 0);
// [전환] = "1" → "Set model to" 로 키워드 곧바로
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(CLEAR + SWITCH)})`);
await sleep(1400);
w14 = (await writesTo(ai.sid)).length;
await clickSel(`${P(ai.id)} [data-flip-model-switch-yes]`);
await sleep(500);
const sent14 = (await writesTo(ai.sid)).slice(w14).join("");
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(CLEAR + "❯ /model opus\r\n  ⎿  Set model to Opus 5.5 and saved as your default for new sessions\r\n" + BOX)})`);
await sleep(700);
check("⑭ [전환] → 정확히 1 · 카드 걷힘 · 키워드 곧바로 Opus 5.5", [sent14, (await sw()).card, (await kwInfo(ai.id)).name], ["1", false, "Opus 5.5"]);
// ⑭b (2026-11-14 실기 — "Effort 를 두 번 눌러야") 캐시된 대화에서 /effort 도 같은 확인("Change effort level?" — Claude 2.1.325 바이너리의 같은 부품)을 띄운다
const EFFORT_ASK = "\r\n▔▔▔▔▔▔▔▔▔▔▔▔\r\n   Change effort level?\r\n   Your next response will be slower and use more tokens\r\n\r\n   This conversation is cached for the current effort level. Switching to low means the full history gets re-read.\r\n\r\n   \u276f 1. Yes, switch to low\r\n     2. No, go back\r\n";
const s14b = await pickAndFeed(ai.id, ai.sid, `[data-flip-model-menu] [data-chat-effort="low"]`, CLEAR + EFFORT_ASK);
const sw14b = await sw();
check("⑭b /effort 의 확인 화면 → 카드(Effort 제목) · 칸 잠김 · 키워드 그대로", [s14b, sw14b.card, sw14b.title, sw14b.readonly, (await kwInfo(ai.id)).bars], ["/effort low\r", true, "Effort Low로 변경", true, "5"]);
await shot("composer-switch-effort.png");
w14 = (await writesTo(ai.sid)).length;
await clickSel(`${P(ai.id)} [data-flip-model-switch-yes]`);
await sleep(500);
const sent14b = (await writesTo(ai.sid)).slice(w14).join("");
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(CLEAR + "❯ /effort low\r\n  ⎿  Set effort level to low (saved as your default for new sessions): Quick\r\n" + BOX)})`);
await sleep(700);
check("⑭b [전환] → 정확히 1 · 키워드 곧바로 Effort 1/5", [sent14b, (await sw()).card, (await kwInfo(ai.id)).bars], ["1", false, "1"]);
await ev(`window.__txLast[${JSON.stringify(CONV)}] = { model: 'claude-opus-5-5', effort: 'high', at: 900 }; window.__tx.push({ role: 'assistant', text: 'next', truncated: false, images: 0, tool: null, at: Date.now() })`);
await sleep(2200);
const k12e = await kwInfo(ai.id);
check("⑫e 그 뒤 새 답이 기록에 남으면 다시 기록 — Opus 5.5 · 3/5", [k12e.name, k12e.bars], ["Opus 5.5", "3"]);

// ⑮ (2026-11-14 실기 — CLI 는 첫 번에 적용, 키워드만 놓침) 연속 변경 — 실제 TUI 모양 그대로: `❯ /effort high` 다음 줄 `⎿ Set effort level …`
// · 같은 값 두 번 · 서로 다른 값 연속(빠르게 — 마지막 값) · 화면이 넘칠 만큼 쌓인 상태(위 줄이 밀려 나가 확인 줄 수가 그대로)
const cPair = (cmd, ack) => `\r\n❯ ${cmd}\r\n  ⎿  ${ack}\r\n`;
const cEff = (l) => cPair(`/effort ${l}`, `Set effort level to ${l} (saved as your default for new sessions): Comprehensive implementation with extensive testing and documentation`);
const cMod = (a, n) => cPair(`/model ${a}`, `Set model to ${n} and saved as your default for new sessions`);
const closeMenu = async () => {
  if (await ev(`!!document.querySelector('[data-flip-model-menu]')`)) await key("Escape", "Escape");
};
const pick15 = async (sel) => {
  await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
  await sleep(350);
  await clickSel(sel);
  await closeMenu();
};
// 화면을 확인 줄로 가득 채운다(뷰포트가 넘친다)
let fill = "";
for (let i = 0; i < 20; i++) fill += cMod("opus", "Opus 5.5") + cEff("high");
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(fill + BOX)})`);
await sleep(600);
const k15a = await kwInfo(ai.id);
// 같은 값 두 번 — 확인 줄은 이미 화면 가득
await pick15(`[data-flip-model-menu] [data-chat-effort="low"]`);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(cEff("low") + BOX)})`);
await sleep(900);
const k15b = await kwInfo(ai.id);
await pick15(`[data-flip-model-menu] [data-chat-effort="low"]`);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(cEff("low") + BOX)})`);
await sleep(900);
const k15c = await kwInfo(ai.id);
check("⑮ Claude 화면이 넘친 뒤 첫 변경 · 같은 값 두 번 — 첫 번에 Low(1/5) · 그대로", [k15a.bars, k15b.bars, k15c.bars], ["3", "1", "1"]);
// 서로 다른 값 연속(빠르게) — 마지막 값
await pick15(`[data-flip-model-menu] [data-chat-effort="medium"]`);
await pick15(`[data-flip-model-menu] [data-chat-effort="max"]`);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(cEff("medium") + BOX)})`);
await sleep(300);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(cEff("max") + BOX)})`);
await sleep(900);
const k15d = await kwInfo(ai.id);
// 모델도 — 화면이 넘친 채로
await pick15(`[data-flip-model="sonnet"]`);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(cMod("sonnet", "Sonnet 5.5") + BOX)})`);
await sleep(900);
const k15e = await kwInfo(ai.id);
check("⑮ 연속 변경 medium → max 는 마지막 값(5/5) · 모델 Sonnet 5.5 첫 번에", [k15d.bars, k15e.name], ["5", "Sonnet 5.5"]);
// 4eaf4361 의 몫 — 메시지를 보내 일하는 동안(사람 말이 붙어도) 덮은 값 그대로
await ev(fakeAgentSignal({ stream: ai.stream, event: "start", session: CONV, cli: "claude" }));
await ev(`window.__tx.push({ role: 'user', text: '또 질문', truncated: false, images: 0, tool: null, at: Date.now() })`);
await sleep(2200);
const k15f = await kwInfo(ai.id);
await ev(fakeAgentSignal({ stream: ai.stream, event: "stop", session: CONV, cli: "claude" }));
await sleep(500);
check("⑮ 메시지를 보내 일하는 동안도 덮은 값 그대로", [k15f.name, k15f.bars], ["Sonnet 5.5", "5"]);

// ⑰ (2026-11-14 실기 — Claude 를 전혀 못 잡고 확인 카드도 안 뜸) 실제 Claude 의 그리기 그대로: 되울림 행을 **칸 끝까지 빈칸으로 채우고 줄바꿈 없이**
// 다음 행을 쓴다(ConPTY) — xterm 이 다음 행에 isWrapped 를 세운다. 행을 잇는 화면 줄(0f17d616)은 되울림 · 확인 · "Switch model?" 을 한 줄로 붙였다.
const cols17 = await ev(`(async () => (await ${importApp("lib/term-actions.ts")}).termActionsOf(${JSON.stringify(ai.id)}).screenSnapshot().cols)()`);
const full = (s) => s + " ".repeat(Math.max(0, cols17 - [...s].length));
await clickSel(`${P(ai.id)} [data-chat-model-chip]`);
await sleep(350);
await clickSel(`[data-flip-model-menu] [data-chat-effort="low"]`);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify("\r\n" + full("❯ /effort low") + "  ⎿  Set effort level to low (saved as your default for new sessions): Quick\r\n\r\n" + full("─".repeat(8)) + "❯\u00a0\r\n")})`);
await sleep(900);
check("⑰ 칸 끝까지 채운 되울림 다음 행(isWrapped)의 확인 — 첫 번에 Effort 1/5", (await kwInfo(ai.id)).bars, "1");
await ev(`window.__feed(${ai.sid}, ${JSON.stringify("\r\n" + full("▔".repeat(cols17)).slice(0, cols17) + "   Switch model?\r\n   Your next response will be slower and use more tokens\r\n\r\n   \u276f 1. Yes, switch to Haiku 5.5\r\n     2. No, go back\r\n")})`);
await sleep(1400);
check("⑰ 칸 끝까지 찬 구분선 다음 행의 \"Switch model?\" — 카드가 선다", await ev(`document.querySelector('${P(ai.id)} [data-flip-model-switch-title]')?.textContent.trim() ?? null`), "Haiku 5.5로 모델 전환");
await clickSel(`${P(ai.id)} [data-flip-model-switch-no]`);
await ev(`window.__feed(${ai.sid}, ${JSON.stringify("\x1b[2J\x1b[H" + full("❯ /model haiku") + "  ⎿  Kept model as Opus 5.5\r\n" + BOX)})`);
await sleep(1400);

// ── Codex 타일 ──────────────────────────────────────────────────────────────
const cx = await openAi("codex");
console.log("codex tile:", JSON.stringify(cx));
const CONVX = "01a07989-25f8-7e72-99aa-0000000000c2";
await ev(`window.__txLast[${JSON.stringify(CONVX)}] = { model: 'gpt-6-astra', effort: 'high' }`);
await ev(fakeAgentSignal({ stream: cx.stream, event: "start", session: CONVX, cli: "codex" }));
await sleep(300);
await ev(fakeAgentSignal({ stream: cx.stream, event: "stop", session: CONVX, cli: "codex" }));
await setView(cx.id, "convo");
await sleep(1500);
const kx = await kwInfo(cx.id);
check("⑩ Codex — GPT-6-astra · 막대(그 모델 단계 여섯 중 셋)", [kx.name, kx.bars, kx.n, kx.title], ["GPT-6-astra", "3", 6, "Codex · GPT-6-astra · Effort · High"]);
await clickSel(`${P(cx.id)} [data-chat-model-chip]`);
await sleep(400);
const mx = await menuInfo();
check("⑩ Codex 메뉴 — 목록(고정 순서 · 모양 밖 빠짐) · ✓ astra · 그 모델 단계 · 고리 없음 · High · 이 세션에만", mx, {
  cli: "codex", inBody: true, models: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-luna"], checked: ["gpt-6-astra"], efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], effortOn: ["high"], ring: false,
  note: "이 세션에만 적용됩니다", cliSwitch: false, custom: false,
});
await shot("composer-codex-menu.png");
const wx = (await writesTo(cx.sid)).length;
await clickSel(`[data-flip-model="gpt-6-luna"]`);
await sleep(900);
check("⑩ 모델 → 정확히 /model gpt-6-luna --reasoning=high + Enter · 대화 면 그대로 · 메뉴 닫힘", [(await writesTo(cx.sid)).slice(wx).join(""), await ev(`document.querySelector('[data-pane="${cx.id}"] [data-flip]').dataset.flip`), await menuInfo()], ["/model gpt-6-luna --reasoning=high\r", "convo", null]);
await clickSel(`${P(cx.id)} [data-chat-model-chip]`);
await sleep(400);
const wx2 = (await writesTo(cx.sid)).length;
await clickSel(`[data-flip-model-menu] [data-chat-effort="xhigh"]`);
await sleep(900);
check("⑩ Effort 칸 → /model --reasoning=xhigh + Enter", (await writesTo(cx.sid)).slice(wx2).join(""), "/model --reasoning=xhigh\r");

// ⑬ Codex 기록이 대화 면에 · 확인 문구 → 곧바로 · 거절 → 그대로
check("⑬ Codex 대화 면에 기록이 나온다", (await ev(`document.querySelectorAll('${P(cx.id)} [data-item]:not([data-item="pending"])').length`)) > 0, true);
await ev(`window.__feed(${cx.sid}, ${JSON.stringify("\r\n• Model changed to gpt-6-luna xhigh for this session only\r\n\r\n› \x1b[2mAsk Codex to do anything\x1b[22m\r\n")})`);
await sleep(900);
const kx13 = await kwInfo(cx.id);
check("⑬ 확인 문구 → GPT-6-luna · 막대 4/5(그 모델 단계)", [kx13.name, kx13.bars, kx13.n], ["GPT-6-luna", "4", 5]);
const s13 = await pickAndFeed(cx.id, cx.sid, `[data-flip-model="gpt-6.1-sol"]`, "\r\n■ Model 'gpt-6.1-sol' is unavailable. Use /model to see available models.\r\n\r\n› \x1b[2mAsk Codex to do anything\x1b[22m\r\n");
await sleep(2600);
check("⑬ 거절 문구 → 그대로", [s13, (await kwInfo(cx.id)).name], ["/model gpt-6.1-sol --reasoning=xhigh\r", "GPT-6-luna"]);
// ⑬b (2026-11-14 실기 — "치다 만 글" 이 계속) 새로 뜬 Codex 는 첫 입력 묶음 뒤의 Enter 를 삼킨다(실측 — 200 · 400ms 모두, 다음 Enter 는 먹는다).
// 보낸 뒤 입력 줄에 보낸 글이 그대로 남아 있으면 Enter 하나를 더 보낸다(고정 키) — 남지 않았으면 더 보내지 않는다
const STUCK = "\r\n› /model --reasoning=high\r\n\r\n  ~\\w\r\n";
const DONE = "\r\n• Model changed to gpt-6-luna high for this session only\r\n\r\n› \x1b[2mAsk Codex to do anything\x1b[22m\r\n\r\n  ~\\w\r\n  \x1b[2m← for agents · ? for shortcuts\x1b[22m\r\n";
await clickSel(`${P(cx.id)} [data-chat-model-chip]`);
await sleep(400);
let w13 = (await writesTo(cx.sid)).length;
await clickSel(`[data-flip-model-menu] [data-chat-effort="high"]`);
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(STUCK)})`);
await sleep(1200);
const sent13b = (await writesTo(cx.sid)).slice(w13).join("");
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(DONE)})`);
await sleep(900);
check("⑬b 입력 줄에 보낸 글이 남음 → Enter 하나 더 · 그 뒤 확인 문구로 키워드", [sent13b, (await kwInfo(cx.id)).bars], ["/model --reasoning=high\r\r", "3"]);
// 먹었으면(입력 줄 = 흐린 안내 글) 더 보내지 않는다 · 그 뒤 메뉴에 "치다 만 글" 이 뜨지 않는다
await clickSel(`${P(cx.id)} [data-chat-model-chip]`);
await sleep(400);
w13 = (await writesTo(cx.sid)).length;
const toasts0 = await ev(`document.querySelectorAll('.toast').length`);
await clickSel(`[data-flip-model-menu] [data-chat-effort="medium"]`);
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(DONE.replace("high", "medium"))})`);
await sleep(1200);
check("⑬b 먹었으면 Enter 더 없음 · 알림 없음", [(await writesTo(cx.sid)).slice(w13).join(""), (await ev(`[...document.querySelectorAll('.toast')].some((e) => e.textContent.includes('치다 만 글'))`)) && (await ev(`document.querySelectorAll('.toast').length`)) > toasts0], ["/model --reasoning=medium\r", false]);
// ⑯ Codex 연속 변경 — 실제 모양("• Model changed to <slug> <단계> for this session only" · 입력 줄 흐린 안내) · 화면 가득 · 같은 값 두 번 · 빠른 연속
const xAck = (slug, l) => `\r\n• Model changed to ${slug} ${l} for this session only\r\n`;
const xBox = "\r\n› \x1b[2mAsk Codex to do anything\x1b[22m\r\n";
const pick16 = async (sel) => {
  await clickSel(`${P(cx.id)} [data-chat-model-chip]`);
  await sleep(350);
  await clickSel(sel);
  if (await ev(`!!document.querySelector('[data-flip-model-menu]')`)) await key("Escape", "Escape");
};
let fillx = "";
for (let i = 0; i < 40; i++) fillx += xAck("gpt-6-luna", "medium");
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(fillx + xBox)})`);
await sleep(600);
await pick16(`[data-flip-model-menu] [data-chat-effort="low"]`);
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(xAck("gpt-6-luna", "low") + xBox)})`);
await sleep(900);
const kx16a = await kwInfo(cx.id);
await pick16(`[data-flip-model-menu] [data-chat-effort="low"]`);
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(xAck("gpt-6-luna", "low") + xBox)})`);
await sleep(900);
const kx16b = await kwInfo(cx.id);
await pick16(`[data-flip-model-menu] [data-chat-effort="high"]`);
await pick16(`[data-flip-model-menu] [data-chat-effort="max"]`);
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(xAck("gpt-6-luna", "high") + xBox)})`);
await sleep(300);
await ev(`window.__feed(${cx.sid}, ${JSON.stringify(xAck("gpt-6-luna", "max") + xBox)})`);
await sleep(900);
const kx16c = await kwInfo(cx.id);
check("⑯ Codex 화면이 넘친 뒤 첫 변경 Low(1/5) · 같은 값 두 번 그대로 · high → max 빠르게면 마지막(5/5)", [kx16a.bars, kx16b.bars, kx16c.bars], ["1", "1", "5"]);

check("⑪ console errors", errors, []);
fs.rmSync(sample, { force: true });
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
