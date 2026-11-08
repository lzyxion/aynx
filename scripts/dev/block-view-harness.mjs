// 헤드리스 검증 — **명령 블록 리치 보기 카드** (2026-10-18 — `src/lib/term/BlockView.svelte` · 목업 ②').
//
// 스텁은 `ask-ai-harness.mjs` 의 사본(가짜 로컬 세션 + Channel 콜백으로 OSC 133 바이트 먹이기)이다. 셸 타일은 기본 셸 열기
// (`openDefaultShell`)로 연다(헤드리스 시작 화면 위의 Ctrl+Shift+N 이 안 먹는 판이 있다 — ask-ai 도 같은 자리).
//
// 보는 것: ① 출력이 있는 끝난 블록 줄에만 [리치하게 보기](출력 없는 블록 · 셸 통합 없는 타일엔 없다) ② 손을 올린 줄에 단추가 보인다
// ③ 단추 → 카드가 블록 줄 자리에서 커진다(중간 프레임 scale 표본 · transform-origin = 줄 가운데) · 끝: 상자 안쪽 16px · 막 · 터미널
// display 그대로 · 포커스는 카드 ④ JSON 트리(기본) → 표(열 합집합 · 머리 정렬) → 원문 ⑤ Esc 로 닫힘(줄어드는 중간 표본) · 닫힌 뒤
// DOM 정리 · 터미널로 포커스 ⑥ 막 누르기 · × 로 닫힘 ⑦ 짧은 출력은 블록 줄 바로 아래 작은 카드(투명 막) ⑧ CSV → 표
// ⑧' 줄 맞춘 표(xterm 버퍼를 지난 글) — `docker ps` · 첫 열 한글 PowerShell 표 → 표, 탭 바이트로 보낸 TSV → 원문 ⑨ 콘솔 오류 0.
//
//   node scripts/dev/run-harness.mjs block-view-harness.mjs <outdir> --size 1280x860
//     → <outdir>/bv-hover.png · bv-mid.png · bv-tree.png · bv-table.png · bv-raw.png · bv-short.png · bv-csv.png · bv-columns.png ·
//       bv-tsv-raw.png
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
const key = async (code, keyName, modifiers = 0) => {
  const vk = { Escape: 27 }[code] ?? 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(150);
};
const mouse = (type, x, y, extra = {}) => send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1, ...extra });

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
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextSession = 100;
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_ai_clis: [], mcp_status: { clis: [] },
    list_group_meta: {}, list_host_meta: {},
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, send_input: null, write_session: null,
    reap_window_sessions: null, session_log_path: null, list_snippets: [], list_forwards: [],
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0, args }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 0 }, app: { status_bar: 'bottom', tile_header: 'always' } });
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
await sleep(3000);
errors.length = 0;

const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const BH = importApp("lib/block-history.ts");
const PANES = importApp("app/panes.svelte.ts");

const ESC = "\x1b", BEL = "\x07";
const PROMPT = (cwd = "/home/u/api") => `${ESC}]7;file://dev${cwd}${BEL}${ESC}]133;A${BEL}u@dev:~/api$ ${ESC}]133;B${BEL}`;
const block = (cmd, out, exit) => `${PROMPT()}${cmd}\r\n${ESC}]133;C${BEL}${out}${ESC}]133;D;${exit}${BEL}`;
const panesNow = async () =>
  JSON.parse(await ev(`(async () => { const w = await ${W}; const s = await ${S}; const ss = await ${SESS};
    return JSON.stringify(w.residentWindowTabs().map((t) => ({ tab: t.id, panes: s.listPanes(t.root).map((p) => ({ id: p.id, sid: ss.sessionOf(p.id) })) }))); })()`));

for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${SESS}; await ${PANES}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
await ev(`(async () => (await ${PANES}).openDefaultShell())()`);
let shell = null;
for (let i = 0; i < 50; i++) {
  await sleep(300);
  try { shell = (await panesNow()).flatMap((t) => t.panes).find((p) => p.sid != null) ?? null; } catch { continue; }
  if (shell) break;
}
console.log("shell tile:", JSON.stringify(shell));
// 기본 셸이 시작 화면 옆 탭에 설 수 있다 — 그 타일로 가서 보이게(숨은 탭의 상자는 0 크기다)
await ev(`(async () => { const w = await ${W}; const t = w.tabOfPane(${JSON.stringify(shell.id)}); w.focusTile(t.id, ${JSON.stringify(shell.id)}); })()`);
await sleep(600);

// 블록 넷 — 출력 없는 `true` · 긴 JSON · 짧은 출력 · CSV
const health = JSON.stringify(
  { status: "degraded", version: "2.14.3", uptime_s: 86412, checks: [
    { name: "postgres", ok: true, latency_ms: 4 },
    { name: "redis", ok: true, latency_ms: 1 },
    { name: "s3", ok: false, latency_ms: 2130, error: "timeout after 2000ms" },
    { name: "queue", ok: true, latency_ms: 12 },
  ] }, null, 2).split("\n").map((l) => l + "\r\n").join("");
const csv = "name,ms,ok\r\npg,4,true\r\nredis,1,true\r\ns3,2130,false\r\nqueue,12,true\r\nkafka,7,true\r\n";
await ev(`window.__feed(${shell.sid}, ${JSON.stringify(block("true", "", 0) + block("curl -s localhost:8080/health | jq .", health, 0) + block("echo hi", "hi\r\n", 0) + block("cat services.csv", csv, 1) + PROMPT())})`);
await sleep(800);
const blocks = JSON.parse(await ev(`(async () => JSON.stringify((await ${BH}).blocksOf(${JSON.stringify(shell.id)}).map((b) => ({ id: b.id, cmd: b.commandLine }))))()`));
console.log("blocks:", JSON.stringify(blocks));
const id = (needle) => blocks.find((b) => b.cmd.includes(needle))?.id;
const [bTrue, bJson, bShort, bCsv] = [id("true"), id("jq"), id("echo hi"), id("services.csv")];

// ① 단추 — 출력 있는 블록에만(실패 블록은 AI에게 묻기와 한 묶음)
check("① rich buttons only on blocks with output", await ev(`[...document.querySelectorAll('.aynx-rich-view')].map((b) => +b.dataset.blockId).sort((a, b) => a - b)`), [bJson, bShort, bCsv].sort((a, b) => a - b));
check("① no button on the output-less block", await ev(`!!document.querySelector('.aynx-rich-view[data-block-id="${bTrue}"]')`), false);
check("① fail row: rich + ask in one group", await ev(`[...document.querySelector('.aynx-rich-view[data-block-id="${bCsv}"]').parentElement.children].map((c) => c.className)`), ["aynx-rich-view", "aynx-ask-ai"]);

// ② 손을 올린 줄에 보인다
const rowOf = async (bid) =>
  JSON.parse(await ev(`(() => { const r = document.querySelector('.aynx-rich-view[data-block-id="${bid}"]').closest('.aynx-block-row, .aynx-fail-row').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 3), y: Math.round(r.top + r.height / 2), top: r.top, bottom: r.bottom }); })()`));
const jr = await rowOf(bJson);
check("② hidden until hovered", await ev(`getComputedStyle(document.querySelector('.aynx-rich-view[data-block-id="${bJson}"]').parentElement).display`), "none");
await mouse("mouseMoved", jr.x, jr.y, { button: "none", clickCount: 0 });
await sleep(250);
check("② hover shows the button", await ev(`getComputedStyle(document.querySelector('.aynx-rich-view[data-block-id="${bJson}"]').parentElement).display`), "flex");
await shot("bv-hover.png");

const CARD = `document.querySelector('[data-block-view]')`;
const scaleNow = `(() => { const c = ${CARD}; if (!c) return null; const m = new DOMMatrixReadOnly(getComputedStyle(c).transform); return Math.round(m.a * 100) / 100; })()`;
const termDisplay = `getComputedStyle(document.querySelector('[data-pane="${shell.id}"] .xterm')).display`;

// ③ 열기 — 블록 자리에서 커진다
await ev(`document.querySelector('.aynx-rich-view[data-block-id="${bJson}"]').click()`);
await sleep(90);
const midScale = await ev(scaleNow);
const origin = await ev(`${CARD}.style.transformOrigin`);
await shot("bv-mid.png");
check("③ mid-frame scale between 0.42 and 1", typeof midScale === "number" && midScale > 0.42 && midScale < 1, true);
const oy = parseFloat(String(origin).split(" ")[1]);
const cardTop = await ev(`${CARD}.getBoundingClientRect().top`);
check("③ transform-origin = block row centre", Math.abs(cardTop + oy - (jr.top + jr.bottom) / 2) < 3, true);
await sleep(400);
const end = JSON.parse(await ev(`(() => { const c = ${CARD}.getBoundingClientRect(); const h = ${CARD}.parentElement.getBoundingClientRect(); return JSON.stringify({ l: Math.round(c.left - h.left), t: Math.round(c.top - h.top), r: Math.round(h.right - c.right), b: Math.round(h.bottom - c.bottom) }); })()`));
check("③ full card: inset 16px", end, { l: 16, t: 16, r: 16, b: 16 });
check("③ end scale 1 · scrim · terminal display kept · focus in card", [await ev(scaleNow), await ev(`!!document.querySelector('[data-block-view-scrim]:not(.clear)')`), await ev(termDisplay), await ev(`${CARD}.contains(document.activeElement)`)], [1, true, "block", true]);

// ④ JSON 트리 → 표 → 원문
check("④ json · tabs", [await ev(`${CARD}.dataset.format`), await ev(`[...${CARD}.querySelectorAll('[data-block-view-tab]')].map((b) => b.dataset.blockViewTab)`)], ["json", ["tree", "table", "raw"]]);
check("④ tree default · counts", [await ev(`${CARD}.querySelector('[data-block-view-body]').dataset.blockViewBody`), await ev(`${CARD}.querySelector('[data-json-node="$"]').textContent.replace(/\\s+/g, ' ').trim()`)], ["tree", "▾ { } 4개"]);
await shot("bv-tree.png");
await ev(`${CARD}.querySelector('[data-block-view-tab="table"]').click()`);
await sleep(150);
check("④ table: union columns · rows", [await ev(`[...${CARD}.querySelectorAll('th')].map((t) => t.textContent.trim())`), await ev(`${CARD}.querySelectorAll('tbody tr').length`)], [["name", "ok", "latency_ms", "error"], 4]);
await ev(`${CARD}.querySelector('th [data-col="2"]').click()`);
await ev(`${CARD}.querySelector('th [data-col="2"]').click()`);
await sleep(100);
check("④ sort by latency desc", await ev(`[...${CARD}.querySelectorAll('tbody tr')].map((r) => r.children[0].textContent)`), ["s3", "queue", "postgres", "redis"]);
await shot("bv-table.png");
await ev(`${CARD}.querySelector('[data-block-view-tab="raw"]').click()`);
await sleep(100);
check("④ raw has the text", await ev(`${CARD}.querySelector('pre').textContent.includes('"status": "degraded"')`), true);
await shot("bv-raw.png");

// ⑤ Esc → 줄어들며 닫힘 · DOM 정리 · 터미널로 포커스
await key("Escape", "Escape");
const closingScale = await ev(scaleNow);
await sleep(400);
check("⑤ Esc shrinks then removes", [typeof closingScale === "number" && closingScale < 1, await ev(`!!${CARD}`), await ev(`!!document.querySelector('[data-block-view-scrim]')`)], [true, false, false]);
check("⑤ focus back to terminal · display kept", [await ev(`document.activeElement?.closest('[data-pane]')?.dataset.pane ?? null`), await ev(termDisplay)], [shell.id, "block"]);

// ⑥ 막 누르기 · × 로 닫힘
await ev(`document.querySelector('.aynx-rich-view[data-block-id="${bJson}"]').click()`);
await sleep(450);
await mouse("mousePressed", 30, 820);
await mouse("mouseReleased", 30, 820);
await sleep(400);
check("⑥ scrim click closes", await ev(`!!${CARD}`), false);
await ev(`document.querySelector('.aynx-rich-view[data-block-id="${bJson}"]').click()`);
await sleep(450);
await ev(`${CARD}.querySelector('[data-block-view-close]').click()`);
await sleep(400);
check("⑥ × closes", await ev(`!!${CARD}`), false);

// ⑦ 짧은 출력 — 블록 줄 바로 아래 작은 카드 · 투명 막
const sr = await rowOf(bShort);
await ev(`document.querySelector('.aynx-rich-view[data-block-id="${bShort}"]').click()`);
await sleep(450);
const sc = JSON.parse(await ev(`JSON.stringify({ short: ${CARD}.classList.contains('short'), top: Math.round(${CARD}.getBoundingClientRect().top), h: Math.round(${CARD}.getBoundingClientRect().height), clear: document.querySelector('[data-block-view-scrim]').classList.contains('clear') })`));
check("⑦ short card under the row · clear scrim", [sc.short, Math.abs(sc.top - (sr.bottom + 4)) < 2, sc.h < 300, sc.clear], [true, true, true, true]);
await shot("bv-short.png");
await key("Escape", "Escape");
await sleep(350);

// ⑧ CSV → 표
await ev(`document.querySelector('.aynx-rich-view[data-block-id="${bCsv}"]').click()`);
await sleep(450);
check("⑧ csv → table first", [await ev(`${CARD}.dataset.format`), await ev(`${CARD}.querySelector('[data-block-view-body]').dataset.blockViewBody`), await ev(`${CARD}.querySelectorAll('tbody tr').length`)], ["csv", "table", 5]);
await shot("bv-csv.png");
await key("Escape", "Escape");
await sleep(350);

// ⑧' 줄 맞춘 표 — xterm 버퍼를 지난 글로 판정한다: docker ps(값 안 공백 · CONTAINER ID 한 열) · 첫 열 한글(2칸) PowerShell 표 → 표,
// 진짜 탭 바이트로 보낸 ConvertTo-Csv -Delimiter "`t" 출력(버퍼에서 탭은 공백) → 원문
const crlf = (ls) => ls.map((l) => l + "\r\n").join("");
const dockerPs = crlf([
  "CONTAINER ID   IMAGE                        COMMAND                  CREATED          STATUS                     PORTS           NAMES",
  '4c01db0b339c   ubuntu:22.04                 "bash"                   17 seconds ago   Up 16 seconds              3300-3310/tcp   webapp',
  'd7886598dbe2   crosbymichael/redis:latest   "/redis-server --dir…"   33 minutes ago   Up 33 minutes              6379/tcp        redis,webapp/db',
  'f2c1a3b6e7d9   postgres:16                  "docker-entrypoint.s…"   2 hours ago      Exited (0) 5 minutes ago                   pg-old',
]);
const svcKo = crlf([
  "",
  "DisplayName                                     Status Name",
  "-----------                                     ------ ----",
  "통합 데이터 플랫폼 서비스                      Stopped ADPSvc",
  "Windows 가상 오디오 장치 프록시 서비스         Stopped ApxSvc",
  "셀룰러 시간                                    Stopped autotimesvc",
  "",
]);
const tsvTabs = crlf(['"Name"\t"Id"\t"WS"', '"AggregatorHost"\t"7920"\t"13324288"', '"aihost"\t"26472"\t"34365440"', '"cargo"\t"18888"\t"31383552"', '"claude"\t"17556"\t"405299200"']);
await ev(`window.__feed(${shell.sid}, ${JSON.stringify(block("docker ps", dockerPs, 0) + block("Get-Service | Select DisplayName,Status,Name", svcKo, 0) + block('ConvertTo-Csv -Delimiter "`t"', tsvTabs, 0) + PROMPT())})`);
await sleep(800);
const blocks2 = JSON.parse(await ev(`(async () => JSON.stringify((await ${BH}).blocksOf(${JSON.stringify(shell.id)}).map((b) => ({ id: b.id, cmd: b.commandLine }))))()`));
const id2 = (needle) => blocks2.find((b) => b.cmd.includes(needle))?.id;
const openBlock = async (bid) => {
  await ev(`document.querySelector('.aynx-rich-view[data-block-id="${bid}"]').click()`);
  await sleep(450);
};
const ths = `[...${CARD}.querySelectorAll('th')].map((t) => t.textContent.trim())`;
const row = (i) => `[...${CARD}.querySelectorAll('tbody tr')[${i}].children].map((td) => td.textContent)`;
await openBlock(id2("docker ps"));
check("⑧' docker ps → columns · table first", [await ev(`${CARD}.dataset.format`), await ev(`[...${CARD}.querySelectorAll('[data-block-view-tab]')].map((b) => b.dataset.blockViewTab)`), await ev(`${CARD}.querySelector('[data-block-view-body]').dataset.blockViewBody`)], ["columns", ["table", "raw"], "table"]);
check("⑧' docker ps columns", await ev(ths), ["CONTAINER ID", "IMAGE", "COMMAND", "CREATED", "STATUS", "PORTS", "NAMES"]);
check("⑧' docker ps row with spaces · empty PORTS", await ev(row(2)), ["f2c1a3b6e7d9", "postgres:16", '"docker-entrypoint.s…"', "2 hours ago", "Exited (0) 5 minutes ago", "", "pg-old"]);
await shot("bv-columns.png");
await key("Escape", "Escape");
await sleep(350);
await openBlock(id2("Get-Service"));
check("⑧' Korean first column (2 cells) → columns", [await ev(`${CARD}.dataset.format`), await ev(ths), await ev(row(0))], ["columns", ["DisplayName", "Status", "Name"], ["통합 데이터 플랫폼 서비스", "Stopped", "ADPSvc"]]);
await key("Escape", "Escape");
await sleep(350);
await openBlock(id2("ConvertTo-Csv"));
check("⑧' tab-separated output → raw", [await ev(`${CARD}.dataset.format`), await ev(`${CARD}.querySelectorAll('[data-block-view-tab]').length`), await ev(`${CARD}.querySelector('pre')?.textContent.includes('\\t') ?? null`)], ["raw", 0, false]);
await shot("bv-tsv-raw.png");
await key("Escape", "Escape");
await sleep(350);

// ① 셸 통합 없는 타일 — 블록이 없으니 단추도 없다
await ev(`(async () => (await ${PANES}).openDefaultShell())()`);
await sleep(1200);
const plain = (await panesNow()).flatMap((t) => t.panes).find((p) => p.sid != null && p.id !== shell.id);
await ev(`window.__feed(${plain.sid}, ${JSON.stringify("PS C:\\> echo plain\r\nplain\r\nPS C:\\> ")})`);
await sleep(400);
check("① tile without shell integration has no rich buttons", await ev(`document.querySelectorAll('[data-pane="${plain.id}"] .aynx-rich-view').length`), 0);

check("⑨ console errors", errors, []);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
