// 파일 타일 보기 설정 유지 검증(2026-11-04 · docs/log/2026-11-04-file-ui-keep.md).
//   node scripts/dev/run-harness.mjs file-ui-keep-harness.mjs <outdir> --size 1100x800
//
// 헤드리스 스텁 — 배치 파일은 workspace-stub 이 sessionStorage 로 F5 를 넘긴다(실제 Rust `workspaces_apply` 왕복은 아니다 — `root` 는 Value 라 칸을 보존한다).
// 보는 것: ① 숨김 · 보기 · 장소 · 미리 보기 · 크기가 F5 뒤에 그대로 ② 바꾸고 곧바로 F5 ③ 타일을 닫고 새로 열면 마지막 값 ④ 저장된 다른 타일은 안 바뀜 · 사람이 끈 타일이 복원에서
// 켜지지 않음 ⑤ 설정 기본 보기를 고르면 새 타일이 설정을 따름 ⑥ 원격 파일 타일(sftp)도 같음 ⑦ 복제가 물려줌 ⑧ 망가진 마지막 값은 버림 ⑨ 콘솔 예외 0.
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";

const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.env.CDP_PORT ?? process.argv[3] ?? "9224";
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
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
  }
  if (d.method === "Runtime.exceptionThrown") errors.push(String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text).slice(0, 240));
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(path.join(outDir, name), Buffer.from(r.result.data, "base64")); };

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = [];
  performance.setResourceTimingBufferSize(5000);
  try { if (!sessionStorage.getItem('h.reload')) localStorage.clear(); } catch {}
  window.__persistWorkspace = true;
  if (sessionStorage.getItem('h.reload') && sessionStorage.getItem('h.ws')) window.__workspaceSeed = JSON.parse(sessionStorage.getItem('h.ws'));
  const T = 1758700000;
  const H = 'C:\\\\Users\\\\me\\\\proj';
  const mk = (name, kind) => ({ name, path: H + '\\\\' + name, kind, size: kind === 'file' ? 1234 : 0, mtime: T, mode: 0o644, symlinkTarget: null, linkIsDir: false });
  const R = (name, kind) => ({ name, path: '/srv/' + name, kind, size: kind === 'file' ? 99 : 0, mtime: T, mode: 0o755, symlinkTarget: null, linkIsDir: false });
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
    load_snippets: null, save_snippets: null,
    load_settings: {}, save_settings: null, host_history_list: {}, projects_list: [],
    git_worktree_list: [], ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    local_home: H, local_roots: ['C:\\\\'], local_conflicts: [], sftp_home: '/srv',
    local_places: [], local_free_space: null,
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'local_list') return Promise.resolve([mk('src', 'dir'), mk('README.md', 'file'), mk('.env', 'file')]);
      if (cmd === 'local_stat') return Promise.resolve(mk('x', 'dir'));
      if (cmd === 'sftp_list') return Promise.resolve([R('app', 'dir'), R('notes.txt', 'file'), R('.secret', 'file')]);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);

const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const q = (s) => JSON.stringify(s);
const specs = (kind) => ev(`${importApp("app/tabs.svelte")}.then(async (m) => { const s = await ${importApp("lib/session.ts")}; const out = []; for (const tab of m.residentWindowTabs()) out.push(...s.listPanes(tab.root)); return JSON.stringify(out.filter(p => p.kind === ${q(kind)})); })`).then(JSON.parse);
const openLocal = async () => { await ev(`${importApp("app/panes.svelte")}.then(m => m.openLocalFsPaneHere())`); await sleep(900); };
/** 타일 상자 하나 — pane id 로 */
const BOX = (id) => `document.querySelector('.pane-box[data-pane="' + CSS.escape(${q(id)}) + '"]')`;
const focus = async (id) => { await ev(`${importApp("app/tabs.svelte")}.then(m => { const t = m.residentWindowTabs().find(t => JSON.stringify(t.root).includes(${q(`"id":"${id}"`)})); m.focusPane(t.id, ${q(id)}); })`); await sleep(250); };
const mouse = async (expr) => {
  const r = JSON.parse(await ev(`(() => { const el = ${expr}; if (!el) return 'null'; const b = el.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`));
  if (!r) return false;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button: "left", clickCount: 1 });
  await sleep(200);
  return true;
};
/** 타일 ⋯ 맨 위의 줄 — 사람이 누르는 길 그대로 (`toPaneMenuItems`) */
const TOOL_LABEL = { hidden: "숨김", places: "장소", preview: "미리 보기" };
const pressTool = async (id, tool) => {
  await focus(id);
  await ev(`document.querySelector('.pane-box[data-pane="${id}"] [data-tile-menu-btn]').click()`);
  await sleep(250);
  const done = await ev(`(() => { const el = [...document.querySelectorAll('[role="menuitemcheckbox"]')].find(el => el.textContent.includes(${q(TOOL_LABEL[tool])})); el?.click(); return !!el; })()`);
  await sleep(250);
  if (!done) console.log(`누르지 못함: ${tool}`);
  return done;
};
const pickView = async (id, view) => {
  await focus(id);
  await mouse(`(${BOX(id)}).querySelector('[data-file-view-pick]')`);
  await sleep(200);
  await mouse(`document.querySelector('[data-toolbar-menu] [data-menu-key="${view}"]')`);
  await sleep(250);
};
const setZoom = async (id, level) => {
  await ev(`(() => { const i = (${BOX(id)}).querySelector('.zoom input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${level}); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(200);
};
const hiddenShown = (id, name) => ev(`[...(${BOX(id)}).querySelectorAll('.list .name')].some(n => n.textContent.trim() === ${q(name)})`);
const listMode = (id) => ev(`(() => { const l = (${BOX(id)}).querySelector('.list'); return l.classList.contains('icons') ? 'icons' : l.classList.contains('compact') ? 'compact' : 'details'; })()`);
const reload = async () => {
  await ev(`(sessionStorage.setItem('h.reload', '1'), 1)`);
  await send("Page.reload", { ignoreCache: false });
  await waitBoot(ev);
  await sleep(1200);
};
const closeAllFiles = async () => {
  for (const kind of ["localfs", "sftp"]) {
    for (const p of await specs(kind)) await ev(`${importApp("app/tabs.svelte")}.then(m => { const t = m.residentWindowTabs().find(t => JSON.stringify(t.root).includes(${q(`"id":"${p.id}"`)})); return m.closePaneIn(t.id, ${q(p.id)}); })`);
  }
  await sleep(400);
};
const fieldsOf = (p) => JSON.stringify({ v: p.fileView, h: p.fileHidden, pr: p.filePreview, pl: p.filePlaces, z: p.fileZoom });

// ── ① 네 값 + 숨김이 F5 뒤에 ─────────────────────────────────────────────────
await openLocal();
let [a] = await specs("localfs");
check(!!a, "로컬 파일 타일이 선다");
check((await hiddenShown(a.id, ".env")) === false, "처음엔 숨김 파일이 안 보인다");
await pickView(a.id, "icons");
await pressTool(a.id, "places");
await pressTool(a.id, "preview");
await setZoom(a.id, 3);
await pressTool(a.id, "hidden");
[a] = await specs("localfs");
console.log("바꾼 뒤 명세:", fieldsOf(a));
check(a.fileView === "icons" && a.filePlaces === false && a.filePreview === true && a.fileZoom === 3, "넷이 명세에 적힌다");
check(a.fileHidden === true, "숨김도 명세에 적힌다");
check((await hiddenShown(a.id, ".env")) === true, "숨김 파일이 보인다");
await sleep(800); // 저장 지연(500ms) 뒤
await reload();
[a] = await specs("localfs");
console.log("F5 뒤 명세:", a ? fieldsOf(a) : "(없음)");
check(a?.fileView === "icons", "F5 — 보기 유지");
check(a?.filePlaces === false, "F5 — 장소 패널 끔 유지");
check(a?.filePreview === true, "F5 — 미리 보기 유지");
check(a?.fileZoom === 3, "F5 — 아이콘 크기 유지");
check(a?.fileHidden === true, "F5 — 숨김 유지");
check(a ? await listMode(a.id) === "icons" : false, "F5 — 그림도 아이콘 보기");
check(a ? await hiddenShown(a.id, ".env") === true : false, "F5 — 숨김 파일이 그대로 보인다");
await shot("file-ui-after-f5.png");

// ── ② 바꾸고 곧바로 F5(저장 지연 전 — pagehide 의 flush) ─────────────────────
await pressTool(a.id, "preview");
await reload();
[a] = await specs("localfs");
check(a?.filePreview === undefined, "곧바로 F5 — 미리 보기 끔이 살아남는다");
await pressTool(a.id, "preview"); // 다시 켜 둔다 — 아래 마지막 값

// ── ③ 닫고 새로 열면 마지막 값 ───────────────────────────────────────────────
await closeAllFiles();
await openLocal();
let [b] = await specs("localfs");
console.log("새 타일 명세:", b ? fieldsOf(b) : "(없음)");
check(b?.fileView === "icons" && b?.fileHidden === true && b?.filePreview === true && b?.filePlaces === false && b?.fileZoom === 3, "새 타일 = 마지막 값 다섯");
check(b ? await hiddenShown(b.id, ".env") === true : false, "새 타일 — 숨김 파일이 보인다");

// ── ④ 다른 타일은 안 바뀜 · 사람이 끈 타일은 복원에서 안 켜짐 ─────────────────
await pressTool(b.id, "preview"); // b = 미리 보기 끔
await pressTool(b.id, "hidden"); // b = 숨김 끔
await openLocal();
let all = await specs("localfs");
let c = all.find((p) => p.id !== b.id);
check(c?.filePreview === undefined && c?.fileHidden === undefined, "새 타일은 방금 끈 값을 받는다");
await pressTool(c.id, "preview");
await pressTool(c.id, "hidden"); // 마지막 값 = 켬 · b 는 끈 채
all = await specs("localfs");
b = all.find((p) => p.id === b.id);
check(b?.filePreview === undefined && b?.fileHidden === undefined, "다른 타일을 바꿔도 이 타일은 그대로");
await sleep(800);
const keptB = b.tileKey;
await reload();
all = await specs("localfs");
b = all.find((p) => p.tileKey === keptB);
c = all.find((p) => p.tileKey !== keptB);
check(b?.filePreview === undefined && b?.fileHidden === undefined, "복원 — 사람이 끈 타일이 마지막 값(켬)으로 켜지지 않는다");
check(c?.filePreview === true && c?.fileHidden === true, "복원 — 켠 타일은 켠 그대로");

// ── ⑤ 설정 기본 보기를 고르면 새 타일이 설정을 따른다 ────────────────────────
await ev(`${importApp("settings.svelte")}.then(m => m.setFileDefaultView('compact'))`);
await sleep(200);
const before = new Set((await specs("localfs")).map((p) => p.id));
await openLocal();
let d = (await specs("localfs")).find((p) => !before.has(p.id));
check(d?.fileView === undefined && (d ? await listMode(d.id) === "compact" : false), "설정을 고른 뒤 새 타일 = 설정의 보기(칸 없음)");
check(d?.fileHidden === true, "설정은 보기만 지운다 — 숨김 마지막 값은 그대로");
await ev(`${importApp("settings.svelte")}.then(m => m.setFileDefaultView('details'))`);
await pickView(d.id, "icons");
const beforeE = new Set((await specs("localfs")).map((p) => p.id));
await openLocal();
const e = (await specs("localfs")).find((p) => !beforeE.has(p.id));
check(e?.fileView === "icons", "툴바에서 다시 고르면 다음 새 타일은 그 값");

// ── ⑥ 원격 파일 타일(sftp) ───────────────────────────────────────────────────
// 복원은 같은 별칭의 SSH 타일에 다시 묶는다(`rebindSftp` — 짝이 없으면 뺀다) — 원본 SSH 타일을 함께 세운다
await ev(`(async () => { const s = await ${importApp("lib/session.ts")}; const w = await ${importApp("app/tabs.svelte")}; w.openPaneHere(s.newSshPane('web-01')); })()`);
await sleep(500);
const srcId = (await specs("ssh"))[0].id;
await ev(`${importApp("app/sessions.svelte")}.then(m => m.noteSession(${q(srcId)}, 7))`);
await ev(`${importApp("app/file-ui-last")}.then(async (p) => { const s = await ${importApp("lib/session.ts")}; const w = await ${importApp("app/tabs.svelte")}; w.openPaneHere(p.withLastFileUi(s.newSftpPane(${q(srcId)}, 'web-01', '/srv'))); })`).catch((x) => console.log("sftp 열기 실패:", String(x).slice(0, 160)));
await sleep(900);
let [s1] = await specs("sftp");
console.log("sftp 명세:", s1 ? fieldsOf(s1) : "(없음)");
check(s1?.fileHidden === true && s1?.fileView === "icons", "원격 파일 타일 — 새로 열면 마지막 값");
check(s1 ? await hiddenShown(s1.id, ".secret") === true : false, "원격 파일 타일 — 숨김 파일이 보인다");
if (s1) await pressTool(s1.id, "hidden");
[s1] = await specs("sftp");
check(s1?.fileHidden === undefined, "원격 파일 타일 — 끄면 칸이 지워진다");
await sleep(800);
const sftpKey = s1?.tileKey;
await reload();
s1 = (await specs("sftp")).find((p) => p.tileKey === sftpKey);
check(s1?.fileHidden === undefined && s1?.fileView === "icons", "원격 파일 타일 — F5 유지");

// ── ⑦ 복제 ──────────────────────────────────────────────────────────────────
const pool = await specs("localfs");
const one = pool.find((p) => p.fileHidden === true) ?? pool[0];
const clone = await ev(`${importApp("lib/session.ts")}.then(s => JSON.stringify(s.clonePane(${JSON.stringify(one ?? {})})))`).then(JSON.parse);
check(clone.fileHidden === true && clone.id !== one?.id, "복제가 숨김을 물려준다");

// ── ⑧ 망가진 마지막 값 ───────────────────────────────────────────────────────
await ev(`localStorage.setItem('aynx.files.lastUi', '{나쁜 값')`);
await reload();
const countBefore = new Set((await specs("localfs")).map((p) => p.id));
await openLocal();
const f = (await specs("localfs")).find((p) => !countBefore.has(p.id));
check(f && fieldsOf(f) === JSON.stringify({}), "망가진 마지막 값은 버린다 — 기본으로 선다");

// ── ⑨ 원격 요청을 집 PC 주 창이 적용 — 명세만 바꾸고 마지막 값은 그대로(기기별) ──
const R = importApp("app/mirror-requests.svelte");
const beforeLast = await ev(`localStorage.getItem('aynx.files.lastUi')`);
const home = (await specs("localfs"))[0];
const applied = await ev(`${R}.then(m => m.applyLayoutRequest({ op: 'fileUi', tile: 'k:' + ${q(home.tileKey)}, hidden: true, view: 'compact', zoom: 2 }, 'phone'))`);
const homeAfter = (await specs("localfs")).find((p) => p.id === home.id);
check(applied === null && homeAfter?.fileHidden === true && homeAfter?.fileView === "compact" && homeAfter?.fileZoom === 2, "원격 요청 — 주 창 명세에 적힌다");
check((await ev(`localStorage.getItem('aynx.files.lastUi')`)) === beforeLast, "원격 요청 — 주 창의 마지막 값은 그대로");
check(String(await ev(`${R}.then(m => m.applyLayoutRequest({ op: 'fileUi', tile: 'k:없는 타일', hidden: true }, 'phone'))`)).startsWith("[mirror-missing]"), "원격 요청 — 없는 타일은 거절");
const sshKey = (await specs("ssh"))[0]?.tileKey;
check(String(await ev(`${R}.then(m => m.applyLayoutRequest({ op: 'fileUi', tile: 'k:' + ${q(sshKey)}, hidden: true }, 'phone'))`)).startsWith("[mirror-missing]"), "원격 요청 — 파일 타일이 아니면 거절");

// ── ⑩ 정리 ──────────────────────────────────────────────────────────────────
await shot("file-ui-end.png");
check(errors.length === 0, `콘솔 예외 0 (${errors.join(" | ").slice(0, 300)})`);
console.log(`${failed === 0 ? "ALL PASS" : `${failed} FAIL`}`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
