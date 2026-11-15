// 헤드리스 검증 — **좁은 문서 타일 머리줄의 [저장]** (2026-11-15 — `PaneTools.keepBar` · `pane/PaneHeader` 의 `keep-tools`) · 문서 타일 **[새 문서…]**.
//
// 스텁은 `msg-actions-harness.mjs` 의 것(가짜 로컬 세션 · 파일은 `window.__files` 표 — 디스크에 쓰지 않는다)을 줄였다.
// 로컬 문서 하나(긴 이름)를 시작 화면 곁에 열고 한 번짜리 "편집으로"(`app/doc-anchors` 의 `setDocEdit`)로 편집 상태에 둔다.
//
// 보는 것:
// ① 머리줄(지금 폭) — 도구 칸의 단추([저장] 포함)가 모두 머리줄 안
// ② 머리줄(310px · 270px) — [저장] 이 머리줄 · 도구 칸 안에 다 들고 이름이 말줄임(이름이 먼저 준다)
// ③ [새 문서…] → 이름 상자("새 문서 · 폴더" · untitled.md · [만들기] · [바꾸기] 없음) → [만들기] → 같은 폴더에 빈 파일 하나(쓰기 없음) ·
//    상자 닫힘 · 새 문서 타일이 그 파일로 편집 상태
// ④ 같은 이름 → 만들기 거절뿐(덮어쓰지 않음 · 상자에 까닭) · Esc 로 닫힘
// ⑤ 콘솔 오류 0(`stub:` 거절 제외)
//
//   node scripts/dev/run-harness.mjs doc-head-narrow-harness.mjs <outdir> --size 1280x860
//     → <outdir>/h1-wide.png · h2-310.png · h2-270.png · h3-new-box.png · h3-new-opened.png · h4-exists.png
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9279"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1446";
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
const evj = async (e) => {
  const v = await ev(e);
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
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
    await sleep(400);
  }
};
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
const mouse = (type, x, y) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const hover = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
const clickXY = async (x, y) => {
  await hover(x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
  await sleep(250);
};
const key = async (code, k, vk, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(250);
};
const esc = () => key("Escape", "Escape", 27);

let bad = 0;
const rows = [];
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  rows.push([okj ? "PASS" : "FAIL", name, JSON.stringify(got), okj ? "" : JSON.stringify(want)]);
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
  return okj;
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const PANES = importApp("app/panes.svelte.ts");
const ANCH = importApp("app/doc-anchors.svelte.ts");
const NEWDOC = importApp("app/new-doc.svelte.ts");

// ── 문서 ──────────────────────────────────────────────────────────────────────────
const DIR = "C:\\Users\\h\\proj";
const DOC = DIR + "\\release-checklist-for-the-next-version.md";
const BODY = ["# 릴리스 점검", "", "- 태그 전에 CHANGELOG 를 씁니다."].join("\n");

const stub = () => `
  performance.setResourceTimingBufferSize(10000);
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextSession = 100;
  // 파일 — 디스크에 쓰지 않는다(이 표에만). 만들기는 같은 이름이면 [exists] 로 거절(백엔드와 같은 꼴)
  window.__files = { ${JSON.stringify(DOC)}: ${JSON.stringify(BODY)} }; window.__fileOps = [];
  const fileEntry = (p) => ({ name: p.split(/[\\\\/]/).pop(), path: p, kind: 'file', size: (window.__files[p] ?? '').length, mtime: 1700000000, mode: null, symlinkTarget: null, linkIsDir: false, hidden: false });
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    mcp_status: { clis: [{ id: 'claude', name: 'Claude Code', installed: true, registered: true }] },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, send_input: null, reap_window_sessions: null, session_log_path: null,
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
    side_chats_load: { json: JSON.stringify({ v: 2, current: null, last: { cli: 'claude', model: '', effort: '' }, chats: [] }), rev: 1 },
  };
  const label = 'main';
  window.__label = label;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'local_create_file') {
        window.__fileOps.push(['create', args.path]);
        if (args.path in window.__files) return Promise.reject('[exists] already exists: ' + args.path);
        window.__files[args.path] = ''; return Promise.resolve(args.path);
      }
      if (cmd === 'local_write_text') { window.__fileOps.push(['write', args.path]); window.__files[args.path] = args.text; return Promise.resolve({ version: 'v-' + args.text.length, size: args.text.length }); }
      if (cmd === 'local_stat') return (args.path in window.__files) ? Promise.resolve(fileEntry(args.path)) : Promise.reject('[not-found] ' + args.path);
      if (cmd === 'local_read_text') {
        const text = window.__files[args.path];
        return text === undefined ? Promise.reject('[not-found] ' + args.path) : Promise.resolve({ text, size: text.length, truncated: false, binary: false, lossy: false, version: 'v-' + text.length });
      }
      if (cmd === 'resize_session' || cmd === 'claim_session_size' || cmd === 'write_session') return Promise.resolve(true);
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: stub() });
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${SESS}; await ${PANES}; await ${ANCH}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
await sleep(800);
errors.length = 0;

const rectOf = (expr) => evj(`(() => { const e = ${expr}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ l: b.left, r: b.right, t: b.top, b: b.bottom, x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
const docs = () =>
  evj(`(async () => { const w = await ${W}; const s = await ${S};
    return JSON.stringify(w.residentWindowTabs().flatMap((t) => s.listPanes(t.root)).filter((p) => p.kind === 'doc').map((p) => ({ id: p.id, path: p.path ?? null }))); })()`);
const BOX = `document.querySelector('[data-new-doc-box]')`;
const boxInfo = () =>
  evj(`(() => { const b = ${BOX}; if (!b) return 'null'; return JSON.stringify({ name: b.querySelector('input').value, title: b.querySelector('.menu-title')?.textContent.trim() ?? null,
    submit: b.querySelector('.btn-primary')?.textContent.trim() ?? null, buttons: b.querySelectorAll('button').length, error: b.querySelector('.error')?.textContent.trim() ?? null }); })()`);

// 문서 하나를 시작 화면 곁에 열고 편집으로
const opened = await ev(`(async () => {
  const w = await ${W}; const s = await ${S}; const p = await ${PANES}; const a = await ${ANCH};
  const tab = w.residentWindowTabs().find((t) => t.id === w.activeTabId());
  const near = s.listPanes(tab.root)[0];
  const id = p.openDoc({ tabId: tab.id, nearPaneId: near.id, path: ${JSON.stringify(DOC)} });
  if (id) a.setDocEdit(id);
  return id;
})()`);
check("0 문서 타일이 섰다", typeof opened === "string", true);
check("0 편집 상태(편집기)", await waitFor(`!!document.querySelector('[data-pane="${opened}"] .cm-content')`, 8000), true);
await sleep(600);
// 편집 중에 [저장] 이 강조되게 — 글 한 줄 친다(dirty)
await ev(`document.querySelector('[data-pane="${opened}"] .cm-content').focus()`);
await send("Input.insertText", { text: "x" });
await sleep(500);

/** 머리줄 재기 — `w` > 0 이면 타일 상자를 그 폭으로 좁힌 뒤 잰다(재고 나면 되돌린다 · `keep` 이면 둔다) */
const headFit = (w, keep = false) =>
  evj(`(async () => {
  const head = document.querySelector('[data-pane-head="${opened}"]');
  const box = head?.parentElement;
  if (!head || !box) return JSON.stringify(null);
  if (box.dataset.oldW === undefined) box.dataset.oldW = box.style.width;
  if (${w} > 0) box.style.width = '${w}px';
  await new Promise((r) => setTimeout(r, 400));
  const h = head.getBoundingClientRect();
  const toolsEl = head.querySelector('.pane-tools');
  const tools = toolsEl.getBoundingClientRect();
  const btns = [...toolsEl.querySelectorAll('button')].filter((b) => b.getClientRects().length > 0 && getComputedStyle(b).visibility !== 'hidden' && b.getBoundingClientRect().width > 0);
  const saveEl = btns.find((b) => b.getAttribute('aria-label') === '저장');
  const save = saveEl?.getBoundingClientRect();
  const name = head.querySelector('.pane-name');
  const inside = (r, o) => r.left >= o.left - 0.5 && r.right <= o.right + 0.5;
  const out = {
    head: Math.round(h.width),
    save: !!saveEl,
    saveW: save ? Math.round(save.width) : null,
    saveInHead: save ? inside(save, h) : null,
    saveInTools: save ? inside(save, tools) : null,
    allInHead: btns.every((b) => inside(b.getBoundingClientRect(), h) && inside(b.getBoundingClientRect(), tools)),
    nameCut: name ? name.scrollWidth > name.clientWidth : null,
    over: save ? Math.round((save.right - Math.min(tools.right, h.right)) * 10) / 10 : null,
  };
  if (!${keep}) { box.style.width = box.dataset.oldW; delete box.dataset.oldW; }
  return JSON.stringify(out);
})()`);
const restoreWidth = () =>
  ev(`(() => { const b = document.querySelector('[data-pane-head="${opened}"]').parentElement; if (b.dataset.oldW !== undefined) { b.style.width = b.dataset.oldW; delete b.dataset.oldW; } return true; })()`);

// ① 지금 폭
const fitWide = await headFit(0);
console.log("fitWide", JSON.stringify(fitWide));
check("① 머리줄(지금 폭) — [저장] 이 있고 도구 단추가 모두 머리줄 · 도구 칸 안", [fitWide?.save, fitWide?.saveInHead, fitWide?.allInHead], [true, true, true]);
await shot("h1-wide.png");

// ② 310px · 270px
for (const w of [310, 270]) {
  const fit = await headFit(w, true);
  console.log(`fit${w}`, JSON.stringify(fit));
  check(`② 머리줄(${w}px) — [저장] 이 머리줄 · 도구 칸 안에 다 듦 · 이름 말줄임`, [fit?.save, fit?.saveInHead, fit?.saveInTools, fit?.nameCut], [true, true, true, true]);
  await shot(`h2-${w}.png`);
  await restoreWidth();
  await sleep(300);
}

// ③ [새 문서…] — file-first: 이름 상자 → 같은 폴더에 빈 파일 → 그 파일을 편집으로
const before = await docs();
await ev(`(async () => (await ${NEWDOC}).openNewDoc(${JSON.stringify(opened)}, null))()`);
await waitFor(`!!${BOX}`, 3000);
await sleep(400);
const bi = await boxInfo();
check("③ [새 문서…] 상자 — \"새 문서 · proj\" · untitled.md · [만들기] · 단추 하나([바꾸기] 없음)", [bi?.title, bi?.name, bi?.submit, bi?.buttons], ["새 문서 · proj", "untitled.md", "만들기", 1]);
await shot("h3-new-box.png");
const ops0 = await ev(`window.__fileOps.length`);
const sb = await rectOf(`${BOX}.querySelector('.btn-primary')`);
await clickXY(sb.x, sb.y);
await waitFor(`!${BOX}`, 4000);
await sleep(1200);
const ops = await evj(`JSON.stringify(window.__fileOps.slice(${ops0}))`);
const NEW_PATH = DIR + "\\untitled.md";
check("③ [만들기] → 같은 폴더에 빈 파일 하나(쓰기 없음) · 상자 닫힘", [ops, await ev(`window.__files[${JSON.stringify(NEW_PATH)}] ?? null`), await ev(`!!${BOX}`)], [[["create", NEW_PATH]], "", false]);
const after = await docs();
const fresh = after.find((d) => !before.some((b) => b.id === d.id)) ?? null;
check("③ 새 문서 타일 = 그 파일", fresh?.path ?? null, NEW_PATH);
check("③ 새 문서 타일이 편집 상태", await waitFor(`!!document.querySelector('[data-pane="${fresh?.id}"] .cm-content')`, 6000), true);
await shot("h3-new-opened.png");

// ④ 같은 이름 → 거절(덮어쓰지 않음) · Esc
await ev(`(async () => (await ${NEWDOC}).openNewDoc(${JSON.stringify(opened)}, null))()`);
await waitFor(`!!${BOX}`, 3000);
await sleep(400);
const ops1 = await ev(`window.__fileOps.length`);
const sb2 = await rectOf(`${BOX}.querySelector('.btn-primary')`);
await clickXY(sb2.x, sb2.y);
await sleep(700);
const bi2 = await boxInfo();
check("④ 같은 이름 → 만들기 거절뿐(쓰기 없음) · 상자에 까닭 · 상자 남음",
  [await evj(`JSON.stringify(window.__fileOps.slice(${ops1}).map((o) => o[0]))`), bi2?.error ?? null, await ev(`!!${BOX}`)], [["create"], "같은 이름의 파일이 있습니다", true]);
await shot("h4-exists.png");
await ev(`${BOX}.querySelector('input').focus()`);
await esc();
await sleep(300);
check("④ Esc → 상자 닫힘", await ev(`!!${BOX}`), false);

// ⑤ 콘솔 오류
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑤ 콘솔 오류 · 예외 0", errors, []);
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
