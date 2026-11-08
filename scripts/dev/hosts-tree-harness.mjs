// Headless harness: **호스트 트리** (docs/log/2026-09-25-hosts-tree.md).
// `dock-segments-harness.mjs` 의 사본 — 스텁의 호스트 표(그룹 둘 · 중첩 하나)와 시나리오만 다르다.
//
//   npx vite --port 1434 --strictPort        (다른 작업이 파일을 고치는 중이면 README ui-scale 절의 no-HMR 설정)
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-tree \
//     --window-size=1100,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/hosts-tree-harness.mjs outdir 9250
//
// 심어 두는 것: 운영(web-01 · web-02 · 운영/db(db-01 · db-02)) · 개발(dev-01) · 그룹 없는 lab-01.
// 첫 판에 `aynx:hosts:expanded = ["운영"]` 과 옛 보기 모드 키(`aynx:hosts:view = grid`)를 심는다
// (`sessionStorage['tree-seeded']` 표식 — 같은 탭으로 다시 돌리면 심지 않는다: 새 탭에서 돌린다).
//
// 보는 것: ① 저장된 펼침대로 선다(운영만 펼침 · 중첩 db 는 접힘) · 들여쓰기 16px · 옛 툴바·빵부스러기·
// 격자 없음 · 뒷글자 = 마지막 접속(2분 전 · 없으면 없음) · 말풍선 첫 줄 user@host:port · IP 검색 ② 줄(꺾쇠) 클릭 = 펼치기/접기 + 저장 · Ctrl 클릭 = 고르기만 · 폴더 더블클릭은 뜻 없음 · 다시 띄워도 산다 ③ 검색 =
// 걸린 호스트의 폴더를 저절로 펼치되 저장하지 않는다 · 첫 호스트가 골라진다 · Enter 접속 ④ ↑↓ → ← Home
// End Enter(폴더 = 펼치기, 호스트 = 접속) ⑤ Ctrl+Enter 새 탭 ⑥ F2 = 편집 폼 ⑦ 폴더 우클릭 "호스트 추가…"
// = 그 폴더가 채워진 폼 · 호스트 우클릭 "새 탭에서 접속" · 빈 곳 메뉴 = 최상위 · + = 고른 폴더 ⑧ 호스트를
// 폴더 줄에 놓기 = 그 폴더로 · 빈 바닥 = 최상위 · 호스트 줄 = 그 호스트의 폴더 · 폴더 중첩 ⑨ 라이트.
// 콘솔 예외 0. PNG: `hosts-tree.png` · `hosts-tree-time.png` · `hosts-tree-search.png` · `hosts-tree-light.png`.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9224";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1420";
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name, clip) => { const r = await send("Page.captureScreenshot", { format: "png", ...(clip ? { clip: { ...clip, scale: 2 } } : {}) }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
await send("Page.enable"); await send("Runtime.enable");
const errors = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"); });

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  performance.setResourceTimingBufferSize(5000);
  try {
    localStorage.removeItem('aynx:dock');
    localStorage.removeItem('aynx:status-order');
    // 첫 판만 심는다 — 펼침(운영) + 옛 탐색기의 보기 모드 키(남아 있어도 해가 없어야 한다)
    if (sessionStorage.getItem('tree-seeded') !== '1') {
      sessionStorage.setItem('tree-seeded', '1');
      localStorage.setItem('aynx:hosts:expanded', JSON.stringify(['운영']));
      localStorage.setItem('aynx:hosts:view', 'grid');
    }
  } catch {}
  const host = (name, ip, group, tags = []) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags, forwards: [], icon: null, group } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const tree3 = { dir: 'row', ratio: 0.5, a: { kind: 'local' }, b: { dir: 'col', ratio: 0.5, a: { kind: 'local' }, b: { kind: 'local' } } };
  const tree2 = { dir: 'row', ratio: 0.5, a: { kind: 'local' }, b: { kind: 'local' } };
  const answers = {
    list_hosts: { hosts: [
      host('web-01', '10.0.0.1', '운영', ['prod']), host('web-02', '10.0.0.2', '운영'),
      host('db-01', '10.0.1.1', '운영/db'), host('db-02', '10.0.1.2', '운영/db'),
      host('dev-01', '10.1.0.1', '개발'), host('lab-01', '192.168.0.9', null),
    ], warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {}, set_host_meta: null, rename_group: null, set_group_meta: null,
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
    
    load_snippets: null, 
     save_snippets: null, 
    load_settings: {}, save_settings: null,
    // 접속 이력 — web-01 은 2분 전 성공(3회) · lab-01 은 **실패만**(붙어 본 적 없음) · 나머지는 없음
    host_history_list: {
      'web-01': { last_ok_at: Date.now() - 2 * 60000, last_fail_at: null, last_fail_cause: null, last_fail_message: null, count: 3 },
      'lab-01': { last_ok_at: null, last_fail_at: Date.now() - 5 * 60000, last_fail_cause: 'tcp_refused', last_fail_message: 'Connection refused', count: 0 },
    },
    projects_list: [
      { id: 'L1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: null, tmux: false },
      { id: 'R1', name: 'api', host: 'dev-01', path: '~/api', shell: null, command: null, tmux: false },
    ],
    git_worktree_list: [], ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++, tmux: null });
      // 그룹 옮기기(assignGroup)는 지금 그룹을 읽고 같으면 쓰지 않는다 — 호스트마다 제 그룹을 돌려준다
      if (cmd === 'get_host_meta') return Promise.resolve({ ...META, group: answers.list_hosts.hosts.find((h) => h.name === args?.name)?.meta.group ?? null });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

const VK = { Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Comma: 188 };
const key = async (code, modifiers = 0, k = code, wait = 250) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(wait); };
const typeText = async (text) => { await send("Input.insertText", { text }); await sleep(300); };
/** 폴더 줄을 **하나만 고른다** — 수식 없는 클릭은 펼침도 뒤집으므로(2026-10-19) 두 번 눌러(뒤집고 되돌리기) 펼침은 제자리 */
const pickFolder = async (sel) => {
  for (let i = 0; i < 2; i++) { await ev(`document.querySelector(${JSON.stringify(sel)}).dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(150); }
};
const click = async (sel) => { const r = JSON.parse(await ev(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`)); const x = r.x + r.width / 2, y = r.y + r.height / 2; await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await sleep(300); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const cssVal = (v, prop = "background-color") => ev(`(() => { const d = document.createElement('div'); d.style.setProperty('${prop}', 'var(${v})'); document.body.appendChild(d); const c = getComputedStyle(d).getPropertyValue('${prop}'); d.remove(); return c; })()`);
const reload = async () => { await send("Page.reload", { ignoreCache: true }); await sleep(4500); };


const rows = () => ev(`[...document.querySelectorAll('.dock .sidebar [data-id]')].map(e => (e.getAttribute('aria-expanded') === 'true' ? '▾' : e.getAttribute('aria-expanded') === 'false' ? '▸' : '') + e.getAttribute('data-id') + '@' + e.getAttribute('data-depth')).join(' ')`);
const selected = () => ev(`[...document.querySelectorAll('.dock .sidebar .item.selected')].map(e => e.getAttribute('data-id')).join('|')`);
const stored = () => ev(`localStorage.getItem('aynx:hosts:expanded')`);
const row = (id) => `.dock .sidebar [data-id="${id}"]`;
const setQuery = async (q) => { await ev(`(() => { const i = document.querySelector('.dock .sidebar input.search'); i.focus(); i.value = ${JSON.stringify(q)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`); await sleep(250); };
const focusTree = () => ev(`document.querySelector('.dock .sidebar').focus()`);
const calls = (cmd) => ev(`JSON.stringify(window.__calls.filter(c => c[0] === '${cmd}').map(c => c[1]))`).then(JSON.parse);
const tabCount = () => ev(`(async () => (await ${importApp("app/tabs.svelte.ts")}).currentWorkspaceTabs().length)()`);
const hostsApp = importApp("app/hosts.svelte.ts");
const formMode = () => ev(`${hostsApp}.then(m => m.hostFormMode())`);
const closeForm = async () => { await ev(`${hostsApp}.then(m => m.closeForm())`); await sleep(300); };
const dockHidden = () => ev(`document.querySelector('.dock').hidden`);
const ensureDock = async () => { if ((await dockHidden()) === true) await key("KeyH", 10, "H", 500); };
/** 합성 드래그 — 한 DataTransfer 로 dragstart → dragover → drop (HTML5 DnD 를 CDP 로 몰기보다 확실하다) */
const drag = (fromSel, toSel) => ev(`(() => {
  const from = document.querySelector(${JSON.stringify(fromSel)}), to = document.querySelector(${JSON.stringify(toSel)});
  if (!from || !to) return 'missing';
  const dt = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const over = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt });
  to.dispatchEvent(over);
  const accepted = over.defaultPrevented;
  if (accepted) to.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  return accepted ? 'dropped' : 'refused';
})()`);

// 앱이 그려질 때까지 다시 띄운다 — 첫 판은 모듈을 처음 옮기느라 느리다(심은 값은 첫 판에만 들어간다)
for (let i = 0; i < 15; i++) { await reload(); if ((await ev(`!!document.querySelector('.statusbar')`)) === true) break; }

// ── ① 저장된 펼침대로 선다 ────────────────────────────────────────────────────
await key("KeyH", 10, "H", 600);
check((await ev(`localStorage.getItem('aynx:hosts:view')`)) === "grid", "옛 보기 모드 키가 남아 있어도 뜬다 (읽지 않는다)");
let r = await rows();
check(r === "▾g:운영@0 ▸g:운영/db@1 h:web-01@1 h:web-02@1 ▸g:개발@0 h:lab-01@0", `저장된 펼침(운영) — 중첩 db 는 접힘 · 폴더 먼저 (${r})`);
const pad = await ev(`[parseFloat(getComputedStyle(document.querySelector('${row("g:운영")}')).paddingLeft), parseFloat(getComputedStyle(document.querySelector('${row("h:web-01")}')).paddingLeft)].join('|')`);
const [p0, p1] = String(pad).split("|").map(Number);
check(p1 - p0 === 14, `한 단 = 14px 들여쓰기 (${pad})`);
// 펼침 판(2026-10-19) — 펼친 폴더와 아이들이 한 묶음 판 · 꺾쇠는 줄 오른쪽 끝 · 판 면은 독 판보다 한 단 밝다
check((await ev(`!!document.querySelector('.dock .sidebar li.dtree-node.open > ${row("g:운영").replace(".dock .sidebar ", "")}') && !!document.querySelector('.dock .sidebar li.dtree-node.open ${row("h:web-01").replace(".dock .sidebar ", "")}')`)) === true, "펼친 운영 = 아이들과 한 묶음 판");
check((await ev(`document.querySelector('${row("g:운영")} .line').lastElementChild.hasAttribute('data-host-twisty')`)) === true, "꺾쇠는 폴더 줄 오른쪽 끝");
const blockBg = await ev(`getComputedStyle(document.querySelector('.dock .sidebar li.dtree-node.open')).backgroundColor`);
check(blockBg === (await cssVal("--m3-surface-container-high")), `판 면 = surfaceContainerHigh (${blockBg})`);
const gone = await ev(`['.bar', '.crumbs', '.bar-btn', '.item.tile', '.list.grid'].filter(s => document.querySelector('.dock .sidebar ' + s)).join(',')`);
check(gone === "", `옛 툴바 · 빵부스러기 · 격자 없음 (${gone || "—"})`);
check((await ev(`document.querySelectorAll('.dock .sidebar .dock-search .icon-btn').length`)) === 3, "검색 줄 오른쪽 단추 셋 (정렬 · 추가 · 설정 파일)");
const metaF = await ev(`(() => { const m = document.querySelector('${row("h:web-01")} .meta'); const cs = getComputedStyle(m); return [m.textContent.trim(), cs.fontSize, cs.color].join('|'); })()`);
const fg3 = await cssVal("--fg-3", "color");
check(metaF === `2분 전|12px|${fg3}`, `호스트 뒷글자 = 마지막 접속(2분 전) · 12px · fg-3 (${metaF})`);
const noMeta = await ev(`['h:web-02', 'h:lab-01'].filter(id => document.querySelector('.dock .sidebar [data-id="' + id + '"] .meta')).join(',')`);
check(noMeta === "", `붙어 본 적 없는 호스트는 뒷글자가 없다 (web-02 · 실패만 있는 lab-01) (${noMeta || "—"})`);
const addrInRow = await ev(`[...document.querySelectorAll('.dock .sidebar .item:not(.folder)')].some(e => e.textContent.includes('10.0.') || e.textContent.includes('192.168.'))`);
check(addrInRow === false, "줄 글자에 주소가 없다 (말풍선으로 갔다)");
const tipWeb = await ev(`document.querySelector('${row("h:web-01")}').getAttribute('title')`);
check(typeof tipWeb === "string" && tipWeb.split("\n")[0] === "root@10.0.0.1:22" && tipWeb.includes("마지막 접속 2분 전 · 3회"), `말풍선 = 첫 줄 user@host:port + 접속 이력 (${JSON.stringify(tipWeb)})`);
const tipWeb2 = await ev(`document.querySelector('${row("h:web-02")}').getAttribute('title')`);
check(tipWeb2 === "root@10.0.0.2:22", `이력 없는 호스트의 말풍선 = 주소 한 줄 (${JSON.stringify(tipWeb2)})`);
const tipLab = await ev(`document.querySelector('${row("h:lab-01")}').getAttribute('title')`);
check(typeof tipLab === "string" && tipLab.startsWith("root@192.168.0.9:22\n") && tipLab.includes("마지막 실패 5분 전 · Connection refused"), `실패는 말풍선에만 (${JSON.stringify(tipLab)})`);
console.log("capture:", await shot("hosts-tree-time.png"));
check((await ev(`document.querySelector('${row("g:운영")} .count').textContent.trim()`)) === "4", "폴더 개수 = 하위까지 합친 수 (운영 4)");
// 검색 칸에서 ↓ 한 번 = 첫 줄
await key("ArrowDown", 0, "ArrowDown");
check((await selected()) === "g:운영", `검색 칸에서 ↓ → 첫 줄 (${await selected()})`);
console.log("capture:", await shot("hosts-tree.png"));

// ── ② 줄 클릭 = 고르기 + 펼치기/접기 + 저장 (2026-10-19 — 꺾쇠도 줄의 일부) ────────────
await click(`${row("g:개발")} [data-host-twisty]`);
r = await rows();
check(r.includes("▾g:개발@0 h:dev-01@1") && JSON.parse(await stored()).includes("개발"), `개발 꺾쇠 → 펼침 + 저장 (${r} · ${await stored()})`);
check((await selected()) === "g:개발", "누른 줄이 골라진다");
await click(row("g:개발"));
check(!(await rows()).includes("h:dev-01") && !JSON.parse(await stored()).includes("개발"), "줄을 다시 누르면 접힘 + 저장에서 빠진다");
// Ctrl 누르기 = 고르기만(펼치지 않는다)
await ev(`document.querySelector('${row("g:개발")}').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`); await sleep(200);
check((await rows()).includes("▸g:개발"), "Ctrl 누르기는 펼치지 않는다");
await click(`${row("g:운영/db")} [data-host-twisty]`);
await reload();
await key("KeyH", 10, "H", 600);
r = await rows();
check(r === "▾g:운영@0 ▾g:운영/db@1 h:db-01@2 h:db-02@2 h:web-01@1 h:web-02@1 ▸g:개발@0 h:lab-01@0", `다시 띄워도 펼침이 산다 (중첩 db 까지) (${r})`);
// 폴더 더블클릭은 뜻이 없다(앞의 두 클릭이 이미 펼쳤다 접었다 — 세 번 뒤집히지 않는다)
await ev(`document.querySelector('${row("g:개발")}').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))`); await sleep(200);
check((await rows()).includes("▸g:개발"), "폴더 더블클릭 → 그대로");
for (const [type, detail] of [["click", 1], ["click", 2], ["dblclick", 2]]) {
  await ev(`document.querySelector('${row("g:개발")}').dispatchEvent(new MouseEvent('${type}', { bubbles: true, detail: ${detail} }))`); await sleep(60);
}
await sleep(200);
check((await rows()).includes("▸g:개발"), "진짜 더블클릭(클릭 · 클릭 · dblclick) → 두 번 뒤집혀 제자리");

// ── ③ 검색 = 저절로 펼침 (저장하지 않음) ─────────────────────────────────────
const before = await stored();
await setQuery("dev");
r = await rows();
check(r === "▾g:개발@0 h:dev-01@1", `'dev' → 개발 저절로 펼침 · 걸린 줄만 (${r})`);
check((await selected()) === "h:dev-01", `치면 첫 호스트가 골라진다 (${await selected()})`);
check((await stored()) === before, "검색의 펼침은 저장하지 않는다");
check((await ev(`document.querySelector('${row("g:개발")} .count').textContent.trim()`)) === "1", "검색 중 개수 = 걸린 수");
await setQuery("10.0.0.1");
r = await rows();
check(r.startsWith("▾g:운영@0") && r.includes("h:web-01@1"), `IP 로 찾아도 걸린다 — 주소는 검색 글자에 남는다 (${r})`);
await setQuery("db-0");
check((await rows()) === "▾g:운영@0 ▾g:운영/db@1 h:db-01@2 h:db-02@2", `'db-0' → 조상까지 펼침 (${await rows()})`);
console.log("capture:", await shot("hosts-tree-search.png"));
// 검색 중 Enter = 고른 호스트 접속
const ssh0 = (await calls("open_ssh_session")).length;
await key("Enter", 0, "Enter", 900);
const sshA = (await calls("open_ssh_session")).slice(ssh0).map((a) => a?.alias);
check(JSON.stringify(sshA) === '["db-01"]', `검색 칸에서 Enter → 첫 호스트 접속 (${JSON.stringify(sshA)})`);
await ensureDock();
await setQuery("");
check((await rows()) === "▾g:운영@0 ▾g:운영/db@1 h:db-01@2 h:db-02@2 h:web-01@1 h:web-02@1 ▸g:개발@0 h:lab-01@0", "검색어를 지우면 저장된 펼침으로 돌아온다");
check((await selected()) === "", "검색어를 다 지우면 선택도 빈다");

// ── ④ 키보드 ─────────────────────────────────────────────────────────────────
await pickFolder(row("g:운영"));
await focusTree();
const trail = [];
const step = async (k, want) => { await key(k, 0, k, 200); const s = await selected(); trail.push(`${k}→${s}`); check(s === want, `${k} → ${want} (${s})`); };
await step("ArrowDown", "g:운영/db");
await key("ArrowLeft", 0, "ArrowLeft", 200);
check((await rows()).includes("▸g:운영/db") && (await selected()) === "g:운영/db", "← (펼친 폴더) → 접는다 · 커서는 그 자리");
await key("ArrowRight", 0, "ArrowRight", 200);
check((await rows()).includes("▾g:운영/db") && (await selected()) === "g:운영/db", "→ (접힌 폴더) → 펼친다 · 커서는 그 자리");
await step("ArrowRight", "h:db-01");
await step("ArrowRight", "h:db-01"); // 호스트의 → 는 아무 일도 없다
await step("ArrowLeft", "g:운영/db");
await step("ArrowLeft", "g:운영/db"); // 펼친 db 를 접는다 (커서 그대로)
check((await rows()).includes("▸g:운영/db"), "← 가 db 를 접었다");
await step("ArrowLeft", "g:운영"); // 접힌 폴더의 ← = 부모로
await step("End", "h:lab-01");
await step("Home", "g:운영");
await step("ArrowUp", "g:운영"); // 끝에서 멈춘다 (감싸지 않는다)
await key("Enter", 0, "Enter", 250);
check((await rows()) === "▸g:운영@0 ▸g:개발@0 h:lab-01@0", `폴더에서 Enter → 접는다 (${await rows()})`);
await key("Enter", 0, "Enter", 250);
check((await rows()).startsWith("▾g:운영@0"), "한 번 더 Enter → 펼친다");
await step("End", "h:lab-01");
await key("ArrowLeft", 0, "ArrowLeft", 200);
check((await selected()) === "h:lab-01", "최상위 호스트의 ← 는 갈 곳이 없다");
console.log("keys:", trail.join(" "));
// Enter = 접속
const ssh1 = (await calls("open_ssh_session")).length;
await key("Enter", 0, "Enter", 900);
const sshB = (await calls("open_ssh_session")).slice(ssh1).map((a) => a?.alias);
check(JSON.stringify(sshB) === '["lab-01"]', `호스트에서 Enter → 접속 (${JSON.stringify(sshB)})`);

// ── ⑤ Ctrl+Enter 새 탭 · ⑥ F2 편집 ─────────────────────────────────────────────
await ensureDock();
await click(row("h:web-02"));
await focusTree();
const tabs0 = await tabCount();
const ssh2 = (await calls("open_ssh_session")).length;
await key("Enter", 2, "Enter", 1200);
const sshC = (await calls("open_ssh_session")).slice(ssh2).map((a) => a?.alias);
const tabs1 = await tabCount();
check(JSON.stringify(sshC) === '["web-02"]' && tabs1 === tabs0 + 1, `Ctrl+Enter → web-02 새 탭 (${JSON.stringify(sshC)} · 탭 ${tabs0}→${tabs1})`);
await ensureDock();
await click(row("h:web-01"));
await focusTree();
await key("F2", 0, "F2", 600);
check((await formMode()) === "edit" && (await ev(`!!document.querySelector('.host-modal')`)), `F2 → 편집 폼 (${await formMode()})`);
await closeForm();
await ensureDock();
await pickFolder(row("g:운영"));
await focusTree();
await key("F2", 0, "F2", 400);
// 2026-09-29 — 폴더의 F2 = 폴더 편집 모달 (docs/log/2026-09-29-folder-project-icons.md)
check((await formMode()) === null && (await ev(`document.getElementById('folder-edit-name')?.value ?? null`)) === "운영", "폴더의 F2 = 폴더 편집 (호스트 폼은 아님)");
await key("Escape", 0, "Escape", 400);

// ── ⑦ 우클릭 메뉴 (메뉴 통로) ──────────────────────────────────────────────────
const ctx = async (sel) => { await ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 8 })); })()`); await sleep(250); };
const menuItems = () => ev(`[...document.querySelectorAll('.ctx-menu [role="menuitem"]')].map(b => b.textContent.trim()).join('|')`);
await ctx(row("g:개발"));
const gItems = await menuItems();
check(/호스트 추가/.test(gItems) && /하위 폴더 추가/.test(gItems) && /편집…/.test(gItems), `폴더 메뉴에 호스트 추가 · 하위 폴더 · 편집 (${gItems})`);
await click(".ctx-menu [data-group-addhost]");
await sleep(300);
const grp = await ev(`${hostsApp}.then(m => m.hostForm.group)`);
check((await formMode()) === "add" && grp === "개발" && (await ev(`!!document.querySelector('.ctx-menu')`)) === false, `"호스트 추가…" → 개발이 채워진 추가 폼 · 메뉴 닫힘 (${await formMode()} · ${grp})`);
await closeForm();
await ensureDock();
await ctx(row("h:web-01"));
const hItems = await menuItems();
check(/새 탭/.test(hItems) && /편집…/.test(hItems), `호스트 메뉴 (${hItems})`);
const tabs2 = await tabCount();
await ev(`[...document.querySelectorAll('.ctx-menu [role="menuitem"]')].find(b => /새 탭/.test(b.textContent)).click()`); await sleep(1200);
check((await tabCount()) === tabs2 + 1 && (await calls("open_ssh_session")).slice(-1)[0]?.alias === "web-01", "호스트 메뉴 '새 탭에서 접속' → 새 탭 web-01");
await ensureDock();
// 빈 곳 메뉴 = 최상위
await ctx(".dock .sidebar .body");
check((await ev(`document.querySelector('.ctx-menu .ctx-title')?.textContent.trim()`)) === "최상위", "빈 곳 메뉴의 제목 = 최상위");
await ev(`document.querySelector('.menu-backdrop')?.click()`); await sleep(200);
// + 단추 = 고른 줄의 폴더
await pickFolder(row("g:운영"));
await click(".dock .sidebar [data-host-add]");
await sleep(300);
check((await formMode()) === "add" && (await ev(`${hostsApp}.then(m => m.hostForm.group)`)) === "운영", "고른 폴더(운영)에서 + → 운영이 채워진 추가 폼");
await closeForm();
await ensureDock();

// ── ⑧ 끌어 놓기 = 그룹 옮기기 ────────────────────────────────────────────────
const metaWrites = async (n0) => (await calls("set_host_meta")).slice(n0).map((a) => `${a.name}→${a.patch?.group ?? "∅"}`).join(",");
// 끌다 머물면 펼침(2026-10-19) — 접힌 폴더 위에 600ms 머물면 연다 · 짧게 지나가면 그대로 · 놓지 않아도 펼침은 저장된다
const hover = (fromSel, toSel, ms) => ev(`(async () => {
  const from = document.querySelector(${JSON.stringify(fromSel)}), to = document.querySelector(${JSON.stringify(toSel)});
  const dt = new DataTransfer();
  from.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
  const t0 = performance.now();
  while (performance.now() - t0 < ${ms}) { to.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt })); await new Promise((r) => setTimeout(r, 50)); }
  from.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
  return 'ok';
})()`);
check((await rows()).includes("▸g:개발"), "끌기 전 개발은 접혀 있다");
await hover(row("h:lab-01"), row("g:개발"), 300); await sleep(500);
check((await rows()).includes("▸g:개발"), "300ms 머물고 떠나면 그대로(끌기 끝 = 시계 거둠)");
await hover(row("h:lab-01"), row("g:개발"), 750); await sleep(200);
check((await rows()).includes("▾g:개발@0 h:dev-01@1") && JSON.parse(await stored()).includes("개발"), `600ms 넘게 머물면 펼침 + 저장 (${await rows()})`);
await click(row("g:개발"));
check((await rows()).includes("▸g:개발"), "다시 접는다 (뒤 시나리오는 그대로)");
let m0 = (await calls("set_host_meta")).length;
check((await drag(row("h:lab-01"), row("g:개발"))) === "dropped", "lab-01 을 개발 줄에 놓는다 (받는다)");
await sleep(500);
check((await metaWrites(m0)) === "lab-01→개발", `→ lab-01 의 그룹 = 개발 (${await metaWrites(m0)})`);
m0 = (await calls("set_host_meta")).length;
check((await drag(row("h:web-01"), ".dock .sidebar .body")) === "dropped", "web-01 을 빈 바닥에 놓는다");
await sleep(500);
check((await metaWrites(m0)) === "web-01→∅", `→ web-01 은 그룹에서 빠진다 (최상위) (${await metaWrites(m0)})`);
m0 = (await calls("set_host_meta")).length;
check((await drag(row("h:lab-01"), row("h:web-02"))) === "dropped", "lab-01 을 web-02 줄에 놓는다");
await sleep(500);
check((await metaWrites(m0)) === "lab-01→운영", `→ 그 호스트의 폴더(운영)로 (${await metaWrites(m0)})`);
const rn0 = (await calls("rename_group")).length;
check((await drag(row("g:개발"), row("g:운영"))) === "dropped", "개발 폴더를 운영 줄에 놓는다");
await sleep(500);
const rn = (await calls("rename_group")).slice(rn0);
check(JSON.stringify(rn) === JSON.stringify([{ from: "개발", to: "운영/개발" }]), `→ rename_group 개발 → 운영/개발 (${JSON.stringify(rn)})`);
check((await drag(row("g:운영/db"), row("h:web-02"))) === "refused", "폴더를 이미 제 부모 안의 호스트 줄에 놓으면 받지 않는다 (제자리)");

// ── ⑨ 라이트 ─────────────────────────────────────────────────────────────────
await ensureDock();
await ev(`(async () => { const m = await ${importApp("mode.svelte.ts")}; m.setAppMode('light'); })()`); await sleep(500);
await click(row("h:web-02"));
const softL = await cssVal("--accent-soft");
check((await ev(`getComputedStyle(document.querySelector('.dock .sidebar .item.selected')).backgroundColor`)) === softL, `라이트 고른 줄 = --accent-soft (${softL})`);
console.log("capture:", await shot("hosts-tree-light.png"));
await ev(`(async () => { const m = await ${importApp("mode.svelte.ts")}; m.setAppMode('dark'); })()`); await sleep(300);

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" / ")})`);
console.log(failed ? `${failed} FAILED` : "ALL PASS"); process.exit(failed ? 1 : 0);
