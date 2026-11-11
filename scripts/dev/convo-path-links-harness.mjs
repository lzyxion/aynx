// 헤드리스 검증 — **AI 타일 대화 면의 파일 경로 링크** (2026-11-11 — `MarkdownBlocks` 의 `paths` · `pane/AiFlip` 의 `pathLinks`).
//
// 스텁은 `ai-flip-harness.mjs` 의 사본(가짜 로컬 세션 + Channel 콜백으로 출력 먹이기 · 훅 신호로 타일 ↔ 대화 · `window.__tx`)에
// 파일 명령 셋(`local_stat` · `local_read_text` · `local_home`)을 더했다. 지금 폴더는 터미널 출력에 OSC 7 을 먹여 알린다.
//
// 보는 것: ① 걸릴 것 / 안 걸릴 것(`[data-path-link]` 유무 · title = 풀린 경로 + `:줄`) — 인라인 코드 · 마크다운 링크 · 평문 ·
// 줄 꼬리 다섯 모양 · 웹 링크 · 코드 블록 · 굵게/기울임 ② OSC 7 전에는 상대 경로 링크 없음(절대는 있음) → OSC 7 뒤 생김
// ③ 클릭 → `local_stat` 이 푼 절대 경로로 · 문서 타일 · 그 줄 강조(.md = `.line-flash` · .ts = `[data-line-flash]`)
// ④ 끌어 고르다 링크 위에서 놓으면 안 열림 · Tab → Enter 로 열림 ⑤ 콘솔 오류 0.
//
//   node scripts/dev/run-harness.mjs convo-path-links-harness.mjs <outdir> --vite-port 1420 --size 1280x860
//     → <outdir>/links-before-cwd.png · links-convo.png · links-md-open.png · links-ts-open.png · links-enter.png
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
const VK = { Escape: 27, Enter: 13, Tab: 9 };
const key = async (code, keyName, modifiers = 0, text) => {
  const vk = VK[code] ?? 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(text ? { text, unmodifiedText: text } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(150);
};
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });

let bad = 0;
const rows = [];
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  rows.push([okj ? "PASS" : "FAIL", name, JSON.stringify(got), okj ? "" : JSON.stringify(want)]);
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};

const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

// ── 가짜 대화 — 걸릴 것 · 안 걸릴 것 ────────────────────────────────────────────────
const BT = "\u0060";
const c = (s) => BT + s + BT;
const MSG1 = [
  `Changed ${c("src/lib/foo.ts:12")} and ${c("src/foo.ts")} and ${c("C:/abs/dir/x.ts:5")}.`,
  ``,
  `Bare names stay plain: ${c("foo.ts")} ${c("Node.js")} ${c("package.json")} ${c("npm run build")} ${c("a/b c.ts")}.`,
  ``,
  `Tails: ${c("src/t1.ts:12:3")} ${c("src/t2.ts:12-20")} ${c("src/t3.ts#L12")} ${c("src/t4.ts#L12-L20")} ${c("t5.ts:7")}.`,
  ``,
  `Links: [readme](README.md) and [range](src/a.ts#L12) and [web](https://example.com/docs/a.md) and [sect](docs/x.md#setup).`,
  ``,
  `Prose: see docs/guide.md:30 then ./notes/n.txt and C:\\abs\\p.md:4 but not README.md alone.`,
  ``,
  `**bold docs/b.md:3** and *em docs/e.md:4* here.`,
  ``,
  BT.repeat(3) + "ts",
  `const p = "src/in-fence.ts:3"; // docs/fence.md:2`,
  BT.repeat(3),
  ``,
].join("\n");

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = []; window.__writes = []; window.__stats = []; window.__reads = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextSession = 100;
  const T0 = Date.now() - 3600_000;
  const U = (i, text) => ({ role: 'user', text, truncated: false, images: 0, tool: null, at: T0 + i * 1000 });
  const A = (i, text) => ({ role: 'assistant', text, truncated: false, images: 0, tool: null, at: T0 + i * 1000 });
  window.__tx = [U(1, 'where are the files?'), A(2, ${JSON.stringify(MSG1)})];
  // 문서 글 — .md 는 줄마다 제목(블록 하나 = 줄 하나), 그 밖은 코드 줄
  const mdText = Array.from({ length: 60 }, (_, i) => '## Line ' + (i + 1)).join('\\n') + '\\n';
  const codeText = Array.from({ length: 60 }, (_, i) => 'const v' + (i + 1) + ' = ' + (i + 1) + ';').join('\\n') + '\\n';
  const fileEntry = (p) => ({ name: p.split(/[\\\\/]/).pop(), path: p, kind: 'file', size: 100, mtime: 1700000000, mode: null, symlinkTarget: null, linkIsDir: false, hidden: false });
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
    local_home: 'C:\\\\Users\\\\h',
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, args }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'write_session') { window.__writes.push([args.id, args.data]); return Promise.resolve(null); }
      if (cmd === 'resize_session') return Promise.resolve(null);
      if (cmd === 'agent_conversation_transcript') {
        const all = window.__tx; const lim = args.limit ?? 40;
        const end = args.before ?? all.length; const start = Math.max(0, end - lim);
        return Promise.resolve({ items: all.slice(start, end), cursor: start > 0 ? start : null });
      }
      if (cmd === 'local_stat') { window.__stats.push(args.path); return Promise.resolve(fileEntry(args.path)); }
      if (cmd === 'local_read_text') {
        window.__reads.push(args.path);
        const text = /\\.md$/i.test(args.path) ? mdText : codeText;
        return Promise.resolve({ text, size: text.length, truncated: false, binary: false, lossy: false, version: 'v1' });
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
const CWD = importApp("app/pane-cwd.svelte.ts");

const ESC = "\x1b", BEL = "\x07";
const prompt = `${ESC}]133;A${BEL}PS C:\\> ${ESC}]133;B${BEL}`;
const panesNow = async () =>
  JSON.parse(await ev(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().map((t) => ({ tab: t.id, panes: s.listPanes(t.root).map((p) => ({ id: p.id, kind: p.kind, path: p.path ?? null, autorun: p.autorun ?? null, stream: p.historyStreamId ?? null, sid: ss.sessionOf(p.id) })) }))); })()`));

for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${SESS}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
// AI 타일 하나(본보기와 같이 기본 셸을 먼저 열어 탭을 세운다)
await ev(`(async () => (await ${importApp("app/panes.svelte.ts")}).openDefaultShell())()`);
let shell = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  let tabs;
  try { tabs = await panesNow(); } catch { continue; }
  shell = tabs[0]?.panes.find((p) => !p.autorun && p.sid != null) ?? null;
  if (shell) break;
}
await ev(`window.__feed(${shell.sid}, ${JSON.stringify(prompt)})`);
await ev(`(async () => { const w = await ${W}; const s = await ${S}; w.openPaneHere(s.newAiPane('claude')); })()`);
let ai = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  const tabs = await panesNow();
  ai = tabs.flatMap((t) => t.panes).find((p) => p.autorun === "claude" && p.sid != null) ?? null;
  if (ai) break;
}
console.log("ai tile:", JSON.stringify(ai));
// OSC 7 은 아직 없다 — 프롬프트 · CLI 시작만
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${prompt}claude\r\n${ESC}]133;C${BEL}`)})`);
await sleep(500);
const CONV = "11111111-2222-4333-8444-0000000000aa";
await ev(fakeAgentSignal({ stream: ai.stream, event: "session", session: CONV, cli: "claude" }));
await sleep(300);

const CONVO = `document.querySelector('[data-pane="${ai.id}"] [data-flip-convo]')`;
const linkInfo = async () =>
  JSON.parse(await ev(`(() => { const c = ${CONVO}; if (!c) return 'null'; return JSON.stringify([...c.querySelectorAll('[data-path-link]')].map((e) => ({ t: e.textContent, title: e.getAttribute('title'), role: e.getAttribute('role'), tab: e.getAttribute('tabindex'), inCode: !!e.closest('pre'), inStrong: !!e.closest('strong,em') }))); })()`));
const titleOf = (links, text) => links.find((l) => l.t === text)?.title ?? null;

await ev(`document.querySelector('[data-pane="${ai.id}"] [data-flip-to="convo"]').click()`);
await sleep(1500);
check("0 convo face shows the message", await ev(`${CONVO}?.textContent.includes('Bare names stay plain') ?? false`), true);
check("0 reportedCwd before OSC 7", await ev(`(async () => (await ${CWD}).reportedCwd(${JSON.stringify(ai.id)}))()`), null);

// ② OSC 7 전 — 절대 경로만 걸린다
const before = await linkInfo();
console.log("links before cwd:", JSON.stringify(before.map((l) => [l.t, l.title])));
check("② before cwd: only absolute links", before.map((l) => l.t).sort(), ["C:/abs/dir/x.ts:5", "C:\\abs\\p.md:4"].sort());
check("② before cwd: relative src/lib/foo.ts:12 not linked", titleOf(before, "src/lib/foo.ts:12"), null);
await shot("links-before-cwd.png");

// OSC 7 — 셸이 지금 폴더를 알린다 (CLI 가 도는 중에도 같은 길: 셸 통합의 OSC 7 핸들러 → BlockSink.oncwd → noteReportedCwd)
await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${ESC}]7;file://pc/C:/proj${BEL}`)})`);
await sleep(600);
check("② reportedCwd after OSC 7", await ev(`(async () => (await ${CWD}).reportedCwd(${JSON.stringify(ai.id)}))()`), "C:/proj");
const links = await linkInfo();
console.log("links after cwd:", JSON.stringify(links.map((l) => [l.t, l.title])));

// ① 걸릴 것
const want = {
  "src/lib/foo.ts:12": "C:\\proj\\src\\lib\\foo.ts:12",
  "src/foo.ts": "C:\\proj\\src\\foo.ts",
  "C:/abs/dir/x.ts:5": "C:/abs/dir/x.ts:5",
  "src/t1.ts:12:3": "C:\\proj\\src\\t1.ts:12",
  "src/t2.ts:12-20": "C:\\proj\\src\\t2.ts:12",
  "src/t3.ts#L12": "C:\\proj\\src\\t3.ts:12",
  "src/t4.ts#L12-L20": "C:\\proj\\src\\t4.ts:12",
  "t5.ts:7": "C:\\proj\\t5.ts:7",
  readme: "C:\\proj\\README.md",
  range: "C:\\proj\\src\\a.ts:12",
  sect: "C:\\proj\\docs\\x.md",
  "docs/guide.md:30": "C:\\proj\\docs\\guide.md:30",
  "./notes/n.txt": "C:\\proj\\notes\\n.txt",
  "C:\\abs\\p.md:4": "C:\\abs\\p.md:4",
};
for (const [t, title] of Object.entries(want)) check(`① linked ${t} → title`, titleOf(links, t), title);
// ① 안 걸릴 것
for (const t of ["foo.ts", "Node.js", "package.json", "npm run build", "a/b c.ts", "web", "README.md", "src/in-fence.ts:3", "docs/fence.md:2"])
  check(`① not linked: ${t}`, links.some((l) => l.t === t), false);
check("① nothing linked inside code fence", links.filter((l) => l.inCode).length, 0);
check("① bold/italic prose not linked (docs/b.md:3 · docs/e.md:4)", links.filter((l) => l.inStrong).map((l) => l.t), []);
check("① web link stays a web link", await ev(`(() => { const e = [...${CONVO}.querySelectorAll('[data-href]')].find((x) => x.getAttribute('data-href') === 'https://example.com/docs/a.md'); return e ? [e.hasAttribute('data-path-link'), true] : [null, false]; })()`), [false, true]);
check("① link elements are role=link tabindex=0", links.every((l) => l.role === "link" && l.tab === "0"), true);
check("① total link count", links.length, Object.keys(want).length);
await shot("links-convo.png");

// ③ 클릭 → stat · 문서 타일 · 그 줄 강조
const clickLink = async (text) => {
  const find = `[...${CONVO}.querySelectorAll('[data-path-link]')].find((x) => x.textContent === ${JSON.stringify(text)})`;
  await ev(`${find}?.scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(500);
  const r = JSON.parse(await ev(`(() => { const e = ${find}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: b.left + b.width / 2, y: b.top + b.height / 2 }); })()`));
  if (!r) return false;
  await mouse("mouseMoved", r.x, r.y, { buttons: 0 });
  await mouse("mousePressed", r.x, r.y);
  await mouse("mouseReleased", r.x, r.y);
  return true;
};
const flashWatch = async (sel) => {
  for (let i = 0; i < 16; i++) {
    const got = await ev(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); if (!e) return null; return e.textContent.trim() || e.style.getPropertyValue('--line') || 'band'; })()`);
    if (got) return got;
    await sleep(100);
  }
  return null;
};
/** 이 클릭 뒤 stat 된 경로들(중복 제거) — 문서 타일 자신도 같은 파일을 stat 한다(document-controller 의 stamp · 자동 새로고침 박자) */
const statsSince = async (n) => JSON.stringify([...new Set(JSON.parse(await ev(`JSON.stringify(window.__stats.slice(${n}))`)))]);
const statCountOf = async (p) => ev(`window.__stats.filter((x) => x === ${JSON.stringify(p)}).length`);
const docPanes = async () => (await panesNow()).flatMap((t) => t.panes).filter((p) => p.kind === "doc").map((p) => p.path);

let s0 = await ev(`window.__stats.length`);
check("③ click .md (docs/guide.md:30) issued", await clickLink("docs/guide.md:30"), true);
const mdFlash = await flashWatch(".line-flash");
check("③ .md stat path", await statsSince(s0), JSON.stringify(["C:\\proj\\docs\\guide.md"]));
check("③ .md doc tile open", (await docPanes()).includes("C:\\proj\\docs\\guide.md"), true);
check("③ .md line 30 flashed (.line-flash block)", mdFlash, "Line 30");
await shot("links-md-open.png");

s0 = await ev(`window.__stats.length`);
check("③ click .ts (src/lib/foo.ts:12) issued", await clickLink("src/lib/foo.ts:12"), true);
const tsFlash = await flashWatch("[data-line-flash]");
check("③ .ts stat path", await statsSince(s0), JSON.stringify(["C:\\proj\\src\\lib\\foo.ts"]));
check("③ .ts doc tile open", (await docPanes()).includes("C:\\proj\\src\\lib\\foo.ts"), true);
check("③ .ts line 12 flashed (CodeView band --line = 11)", tsFlash, "11");
await shot("links-ts-open.png");

// 마크다운 링크 주소의 #L 줄 · 맨 이름 링크
s0 = await ev(`window.__stats.length`);
await clickLink("range");
const rangeFlash = await flashWatch("[data-line-flash]");
check("③ [range](src/a.ts#L12) → stat · line 12", [await statsSince(s0), rangeFlash], [JSON.stringify(["C:\\proj\\src\\a.ts"]), "11"]);
s0 = await ev(`window.__stats.length`);
await clickLink("readme");
await sleep(600);
check("③ [readme](README.md) → stat", await statsSince(s0), JSON.stringify(["C:\\proj\\README.md"]));

// ④ 끌어 고르기 — 링크 안에서 누르고 끌어 링크 위에서 놓기 → 안 열림
const dragLog = [];
const dragOn = async (text, fromOutside) => {
  const find = `[...${CONVO}.querySelectorAll('[data-path-link]')].find((x) => x.textContent === ${JSON.stringify(text)})`;
  await ev(`${find}?.scrollIntoView({ block: 'center', behavior: 'instant' })`);
  await sleep(500);
  const r = JSON.parse(await ev(`(() => { const e = ${find}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ l: b.left, r: b.right, y: b.top + b.height / 2 }); })()`));
  const x0 = fromOutside ? r.l - 40 : r.l + 2;
  await ev(`window.getSelection().removeAllRanges()`);
  await mouse("mouseMoved", x0, r.y, { buttons: 0 });
  await mouse("mousePressed", x0, r.y);
  dragLog.push(await ev(`(() => { const e = document.elementFromPoint(${x0}, ${r.y}); return 'down@' + (e?.tagName ?? '') + ' sel=' + JSON.stringify(window.getSelection().toString()) + ' active=' + document.activeElement?.tagName; })()`));
  for (let k = 1; k <= 8; k++) {
    await mouse("mouseMoved", x0 + ((r.r - 3 - x0) * k) / 8, r.y);
    if (k === 4 || k === 8) dragLog.push(await ev(`'move' + ${k} + ' sel=' + JSON.stringify(window.getSelection().toString()) + ' active=' + document.activeElement?.tagName + ' ' + (document.activeElement?.getAttribute('data-path') ?? '')`));
  }
  await mouse("mouseReleased", r.r - 3, r.y);
  await sleep(500);
  return ev(`window.getSelection().toString()`);
};
const T2 = "C:\\proj\\src\\t2.ts", T3 = "C:\\proj\\src\\t3.ts", N1 = "C:\\proj\\notes\\n.txt", T4 = "C:\\proj\\src\\t4.ts";
// 대조 — 링크 없는 평문 위의 같은 합성 끌기가 고르기를 만드는가(못 만들면 끌기 판정은 하네스 한계)
const ctl = JSON.parse(await ev(`(() => { const p = [...${CONVO}.querySelectorAll('p')].find((x) => x.textContent.startsWith('Bare names')); p.scrollIntoView({ block: 'center', behavior: 'instant' }); return '1'; })()`) && "1");
await sleep(500);
const pr = JSON.parse(await ev(`(() => { const p = [...${CONVO}.querySelectorAll('p')].find((x) => x.textContent.startsWith('Bare names')); const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); let t = tw.nextNode(); while (t && t.data.length < 10) t = tw.nextNode(); const r = document.createRange(); r.setStart(t, 0); r.setEnd(t, 10); const b = r.getBoundingClientRect(); return JSON.stringify({ l: b.left, r: b.right, y: b.top + b.height / 2 }); })()`));
await ev(`window.getSelection().removeAllRanges()`);
await mouse("mouseMoved", pr.l + 1, pr.y, { buttons: 0 });
await mouse("mousePressed", pr.l + 1, pr.y);
for (let k = 1; k <= 8; k++) await mouse("mouseMoved", pr.l + 1 + ((pr.r - pr.l) * k) / 8, pr.y);
await mouse("mouseReleased", pr.r, pr.y);
await sleep(400);
const ctlSel = await ev(`window.getSelection().toString()`);
console.log("control drag on plain text:", JSON.stringify(ctlSel));
const realDragWorks = ctlSel.length > 3;

// 합성 끌기가 평문에서도 고르기를 못 만드는 환경(헤드리스)에서는 끌기 판정을 건너뛴다 — 누르고 놓기만 남아 그냥 클릭과 같아진다.
// 그때는 아래 '대신 길'(스크립트로 건 고르기 + click)이 `selecting` 판정을 본다.
if (realDragWorks) {
  const sel1 = await dragOn("src/t2.ts:12-20", false);
  console.log("drag1 (code link, inside):", JSON.stringify(sel1), JSON.stringify(dragLog.splice(0)));
  check("④ real drag inside code link → not opened", await statCountOf(T2), 0);
  check("④ real drag inside code link → selection made", sel1.length > 3, true);
  const sel3 = await dragOn("./notes/n.txt", false);
  console.log("drag3 (prose link, inside):", JSON.stringify(sel3), JSON.stringify(dragLog.splice(0)));
  check("④ real drag inside prose link → selection made", sel3.length > 3, true);
  check("④ real drag inside prose link → not opened", await statCountOf(N1), 0);
  const sel2 = await dragOn("src/t3.ts#L12", true);
  console.log("drag2 (from text before, release on link):", JSON.stringify(sel2), JSON.stringify(dragLog.splice(0)));
  check("④ real drag from text, release on link → not opened", await statCountOf(T3), 0);
} else {
  console.log("skip ④ real drag — synthetic drag makes no selection here");
}

// 대신 길 — 고르기를 스크립트로 링크에 걸고, 그 링크에 click 을 쏜다(MarkdownBlocks.onclick 의 `selecting` 판정만 본다)
const synth = async (text, selectIt) => ev(`(() => { const e = [...${CONVO}.querySelectorAll('[data-path-link]')].find((x) => x.textContent === ${JSON.stringify(text)}); const s = window.getSelection(); s.removeAllRanges();
  if (${selectIt}) { const r = document.createRange(); r.selectNodeContents(e); s.addRange(r); }
  e.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })); return s.toString(); })()`);
const sx = await synth("src/t4.ts#L12-L20", true);
await sleep(500);
check("④ selection over link + click → not opened", [sx, await statCountOf(T4)], ["src/t4.ts#L12-L20", 0]);
await synth("src/t4.ts#L12-L20", false);
await sleep(500);
check("④ no selection + click → opened", await statCountOf(T4) >= 1, true);
console.log("debug after synth click:", await ev(`JSON.stringify({ toasts: [...document.querySelectorAll('.toast')].map((e) => e.textContent.trim()), calls: window.__calls.slice(-8).map((c) => c[0]), view: document.querySelector('[data-pane="${ai.id}"] .flip')?.dataset.flip ?? null, linkN: ${CONVO}.querySelectorAll('[data-path-link]').length })`));
// 고르기가 전사 갱신(2초 폴링) 너머로 남는가 — 스크립트로 고른 뒤 3초
await ev(`(() => { const p = [...${CONVO}.querySelectorAll('p')].find((x) => x.textContent.startsWith('Bare names')); const r = document.createRange(); r.selectNodeContents(p); const s = window.getSelection(); s.removeAllRanges(); s.addRange(r); })()`);
await sleep(3000);
console.log("selection after 3s:", JSON.stringify(await ev(`window.getSelection().toString().slice(0, 30)`)));
await ev(`window.getSelection().removeAllRanges()`);
await ev(`window.getSelection().removeAllRanges()`);

// 클릭 하나는 여전히 연다(고르기가 걷힌 뒤 — 진짜 마우스)
s0 = await ev(`window.__stats.length`);
const t3Before = await statCountOf(T3);
await clickLink("src/t3.ts#L12");
await sleep(500);
check("④ plain real click opens", (await statCountOf(T3)) > t3Before, true);

// ④ Tab → Enter
await sleep(600); // 앞 클릭의 pointerup rAF(입력 칸으로 초점 돌림)가 지나가게
await ev(`(async () => { const w = await ${W}; const t = w.tabOfPane(${JSON.stringify(ai.id)}); w.focusTile(t.id, ${JSON.stringify(ai.id)}); })()`);
await sleep(500);
await ev(`(() => { const b = ${CONVO}.querySelector('[data-viewer-body]'); b.scrollTop = 0; b.focus(); })()`);
await sleep(300);
check("④ (setup) focus on transcript body before Tab", await ev(`document.activeElement?.hasAttribute('data-viewer-body') ?? false`), true);
let focused = null;
for (let i = 0; i < 40; i++) {
  await key("Tab", "Tab");
  console.log("tab", i, await ev(`(() => { const a = document.activeElement; return a ? a.tagName + ' ' + [...a.attributes].map((x) => x.name + '=' + x.value.slice(0, 30)).join(' ') : null; })()`));
  focused = await ev(`document.activeElement?.hasAttribute('data-path-link') && ${CONVO}.contains(document.activeElement) ? document.activeElement.textContent : null`);
  if (focused) break;
}
check("④ Tab reaches a path link", focused, "src/lib/foo.ts:12");
s0 = await ev(`window.__stats.length`);
const w0 = await ev(`window.__writes.filter((w) => w[0] === ${ai.sid}).length`);
await key("Enter", "Enter", 0, "\r");
const enterFlash = await flashWatch("[data-line-flash]");
check("④ Enter opens it (stat · line 12)", [await statsSince(s0), enterFlash], [JSON.stringify(["C:\\proj\\src\\lib\\foo.ts"]), "11"]);
check("④ Enter not written to CLI", (await ev(`window.__writes.filter((w) => w[0] === ${ai.sid}).length`)) - w0, 0);
await shot("links-enter.png");

// ⑤ 콘솔 오류
check("⑤ console errors", errors, []);
const stubs = await ev(`JSON.stringify([...new Set(window.__calls.map((c) => c[0]))].filter((c) => /local_|doc|file|watch/.test(c)))`);
console.log("file-ish commands called:", stubs);
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
