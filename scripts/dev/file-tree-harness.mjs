// Headless harness: **파일 타일의 트리 보기** (docs/log/2026-09-25-file-tree-view.md).
// `file-glyphs-harness.mjs` 의 사본 — 스텁에 **바뀌는 가짜 디스크**(중첩 폴더 · 3000 개짜리 폴더 · 링크)와
// 늦게 답하는 가짜 SFTP 서버(느린 폴더 · 권한 없는 폴더)를 얹었다.
//
//   npx vite --port 1434 --strictPort        (다른 작업이 파일을 고치는 중이면 README ui-scale 절의 no-HMR 설정)
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-filetree \
//     --window-size=1100,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/file-tree-harness.mjs outdir 9250
//
// 보는 것: ① 기본 보기 = 트리(화살표 · 들여쓰기 16px · 뿌리만 읽음) ② 화살표로 펼치기/접기 · 게으른 읽기
// (펼칠 때 한 번 · 다시 펼치면 캐시) ③ 키 → ← Home End ↑↓ · 글자 쳐서 고르기 ④ 더블클릭 = 뿌리 옮기기 ·
// 빵부스러기 · Backspace 뒤로 · 펼침이 남는다 ⑤ 대상 폴더(툴바 새 폴더 · Ctrl+V · 메뉴 붙여넣기 · 폴더 메뉴
// "새 폴더…") ⑥ 끌어 놓기 — 폴더 줄 하이라이트 · 파일 줄 = 든 폴더 · 600ms 머물면 펼침 · 줄 위 OS 파일 =
// 그 폴더로 업로드(타일 전체 하이라이트 없음) ⑦ 큰 폴더 — 500 줄 + "N개 더 보기" · 그리는 시간 ⑧ 링크 폴더
// 펼치기 ⑨ 보기 전환(Dolphin 세 보기 — 2026-10-07) — 아이콘(화살표 없음 · 평평) · 패널 명세에 기억 · 설정 기본값이 새 타일에 ⑩ SFTP —
// 읽는 중 줄(늦은 답) · 권한 없는 폴더의 줄 안 오류 ⑪ 라이트 ⑫ 콘솔 예외 0.
// PNG: `files-tree.png` · `files-tree-sftp-loading.png` · `files-tree-light.png` · `files-navigate-toggle.png`
import { waitBoot } from "./boot-wait.mjs";
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
  const cbs = new Map(); let n = 0; window.__calls = []; window.__lists = []; window.__sftpLists = [];
  performance.setResourceTimingBufferSize(5000);
  try { localStorage.removeItem('aynx:dock'); localStorage.removeItem('aynx:status-order'); } catch {}
  const T = 1758700000;
  const H = 'C:\\\\Users\\\\me\\\\proj';
  const J = (d, name) => d + '\\\\' + name;
  const mk = (dir, name, kind, extra = {}) => ({ name, path: J(dir, name), kind, size: kind === 'file' ? 1234 : 0, mtime: T, mode: null, symlinkTarget: null, linkIsDir: false, hidden: false, ...extra });
  const sortList = (l) => l.sort((a, b) => { const da = a.kind === 'dir' || a.linkIsDir, db = b.kind === 'dir' || b.linkIsDir; return da !== db ? (da ? -1 : 1) : a.name.toLowerCase().localeCompare(b.name.toLowerCase()); });
  // ── 가짜 디스크 — 폴더 경로 → 항목 목록 (만들기·복사가 여기에 적힌다) ──
  const FS = new Map();
  FS.set(H, [mk(H, 'src', 'dir'), mk(H, 'docs', 'dir'), mk(H, 'big', 'dir'),
    mk(H, 'shared', 'symlink', { symlinkTarget: 'D:\\\\shared', linkIsDir: true }),
    mk(H, 'README.md', 'file'), mk(H, 'latest.log', 'symlink', { symlinkTarget: 'logs\\\\x.log' }), mk(H, '.env', 'file')]);
  FS.set(J(H, 'src'), [mk(J(H, 'src'), 'lib', 'dir'), mk(J(H, 'src'), 'main.ts', 'file')]);
  FS.set(J(J(H, 'src'), 'lib'), [mk(J(J(H, 'src'), 'lib'), 'a.ts', 'file')]);
  FS.set(J(H, 'docs'), [mk(J(H, 'docs'), 'guide.md', 'file')]);
  FS.set(J(H, 'big'), Array.from({ length: 3000 }, (_, i) => mk(J(H, 'big'), 'pkg' + String(i).padStart(4, '0'), 'dir')));
  FS.set(J(H, 'shared'), [mk(J(H, 'shared'), 'x.txt', 'file')]);
  window.__FS = FS;
  const add = (dir, entry) => { const l = FS.get(dir) ?? []; if (!l.some((e) => e.path === entry.path)) l.push(entry); sortList(l); FS.set(dir, l); if (entry.kind === 'dir' && !FS.has(entry.path)) FS.set(entry.path, []); };
  const base = (p) => p.slice(p.lastIndexOf('\\\\') + 1);
  // ── 가짜 SFTP — /srv/app 은 늦게, /srv/secret 은 거절 ──
  const R = (dir, name, kind) => ({ name, path: (dir === '/' ? '' : dir) + '/' + name, kind, size: kind === 'file' ? 99 : 0, mtime: T, mode: 0o755, symlinkTarget: null, linkIsDir: false, hidden: null });
  const RFS = new Map();
  RFS.set('/srv', [R('/srv', 'app', 'dir'), R('/srv', 'logs', 'dir'), R('/srv', 'secret', 'dir'), R('/srv', 'notes.txt', 'file')]);
  RFS.set('/srv/app', [R('/srv/app', 'lib', 'dir'), R('/srv/app', 'main.py', 'file')]);
  RFS.set('/srv/logs', [R('/srv/logs', 'a.log', 'file')]);
  window.__sftpDelay = 1500;
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [], 
    load_snippets: null,   save_snippets: null, 
    load_settings: {}, save_settings: null, host_history_list: {}, projects_list: [],
    git_worktree_list: [], ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    local_home: H, local_roots: ['C:\\\\', 'D:\\\\'],
    local_conflicts: [], sftp_home: '/srv',
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'local_list') {
        window.__lists.push(args.path);
        const l = FS.get(args.path);
        return l ? Promise.resolve(l.map((e) => ({ ...e }))) : Promise.reject('폴더를 읽지 못했습니다: ' + args.path);
      }
      if (cmd === 'local_stat') return Promise.resolve(mk(H, 'x', 'dir', { path: args.path }));
      if (cmd === 'local_mkdir') { const d = args.path.slice(0, args.path.lastIndexOf('\\\\')); add(d, mk(d, base(args.path), 'dir')); return Promise.resolve(args.path); }
      if (cmd === 'local_copy') {
        const made = args.paths.map((p) => { const e = mk(args.destDir, base(p), 'file'); add(args.destDir, e); return e.path; });
        return Promise.resolve(made);
      }
      if (cmd === 'sftp_list') {
        window.__sftpLists.push(args.path);
        if (args.path === '/srv/secret') return new Promise((_, rej) => setTimeout(() => rej('권한이 없습니다: /srv/secret'), 200));
        const l = RFS.get(args.path);
        const delay = args.path === '/srv/app' ? window.__sftpDelay : 0;
        return new Promise((res, rej) => setTimeout(() => (l ? res(l.map((e) => ({ ...e }))) : rej('없음: ' + args.path)), delay));
      }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const H = "C:\\Users\\me\\proj";
const J = (d, n) => `${d}\\${n}`;
const q = (s) => JSON.stringify(s);

/**
 * 이 타일(지금 폴더의 머리로 가른다)의 상자를 찾는 식 — 타일 상자(`.pane-box`) 하나를 돌려준다(줄 · 화살표는 그 안의 `.sftp`).
 * 경로 칸(`input.path`)은 빵부스러기(`browser/LocationBar.svelte` — 지금 조각 `aria-current="page"` · `title` = 전체 경로)로 바뀌었고,
 * 파일 타일 B안(2026-10-20)부터 그 줄이 머리줄에 서서 `.sftp` 밖이다. 고치는 중이면 입력 칸(`.loc-input`)의 값.
 */
const TILE = (prefix) => `[...document.querySelectorAll('.pane-box')].filter(b => b.querySelector('.sftp')).find(b => (b.querySelector('input.loc-input')?.value ?? b.querySelector('.crumb[aria-current="page"]')?.title ?? '').startsWith(${q(prefix)}))`;
/** 줄 요소 — `data-path` 로 */
const ROW = (p) => `document.querySelector('.row[data-path="' + CSS.escape(${q(p)}) + '"]')`;
const rectOf = async (expr) => JSON.parse(await ev(`(() => { const el = ${expr}; if (!el) return 'null'; el.scrollIntoView({ block: 'nearest' }); return JSON.stringify(el.getBoundingClientRect()); })()`));
const mouse = async (expr, { dx = null, button = "left", clickCount = 1, modifiers = 0 } = {}) => {
  const r = await rectOf(expr);
  if (!r) return false;
  const x = r.x + (dx ?? r.width / 2), y = r.y + r.height / 2;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
  for (let c = 1; c <= clickCount; c++) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: c, modifiers });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: c, modifiers });
  }
  await sleep(200);
  return true;
};
const clickRow = (p, opts = {}) => mouse(ROW(p), { dx: 150, ...opts });
const KEYS = { ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Home: 36, End: 35, Enter: 13, Backspace: 8, Escape: 27, F2: 113, Delete: 46 };
const key = async (k, modifiers = 0) => {
  const vk = KEYS[k] ?? k.toUpperCase().charCodeAt(0);
  const isChar = k.length === 1;
  await send("Input.dispatchKeyEvent", { type: isChar && !modifiers ? "keyDown" : "rawKeyDown", key: k, code: isChar ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: vk, modifiers, ...(isChar && !modifiers ? { text: k } : {}) });
  await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code: isChar ? `Key${k.toUpperCase()}` : k, windowsVirtualKeyCode: vk, modifiers });
  await sleep(150);
};
/** 한 타일의 줄 모양 — 깊이·종류·펼침·이름 */
const shape = (prefix) => ev(`JSON.stringify([...(${TILE(prefix)})?.querySelectorAll('.list .row') ?? []].map(r => {
  if (r.dataset.aux) return '  '.repeat(0) + '(' + r.dataset.aux + ')';
  if (r.dataset.navId) return '(more) ' + r.textContent.trim();
  const tw = r.querySelector('.twisty'); const mark = tw ? (r.getAttribute('aria-expanded') === 'true' ? '▾ ' : '▸ ') : '';
  return '  '.repeat(Number(r.dataset.depth)) + mark + r.querySelector('.name').textContent.trim();
}))`).then(JSON.parse);
const selected = (prefix) => ev(`JSON.stringify([...(${TILE(prefix)}).querySelectorAll('.row.selected')].map(r => r.querySelector('.name')?.textContent.trim() ?? r.textContent.trim()))`).then(JSON.parse);
const listCalls = (p) => ev(`window.__lists.filter(x => x === ${q(p)}).length`);
const paneSpec = (kind) => ev(`${importApp("app/tabs.svelte")}.then(async (m) => { const s = await ${importApp("lib/session.ts")}; const out = []; for (const tab of m.residentWindowTabs()) out.push(...s.listPanes(tab.root)); return JSON.stringify(out.filter(p => p.kind === ${q(kind)})); })`).then(JSON.parse);
const tileClip = async (prefix, h = 360) => { const r = JSON.parse(await ev(`JSON.stringify((${TILE(prefix)}).getBoundingClientRect())`)); return { x: r.x, y: r.y, width: r.width, height: Math.min(r.height, h) }; };
const toolbarTitle = (sel) => ev(`(${TILE(H)}).querySelector(${q(sel)})?.getAttribute('title') ?? 'none'`);

await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);

// ── ① 기본 보기 = 트리 ───────────────────────────────────────────────────────
await ev(`${importApp("app/panes.svelte")}.then(m => m.openLocalFsPaneHere())`); await sleep(1500);
let s = await shape(H);
check(JSON.stringify(s) === JSON.stringify(["▸ src", "▸ docs", "▸ big", "▸ shared", "README.md", "latest.log"]), `기본 = 트리 · 뿌리 한 층 · 숨김 빠짐 (${s.join(" | ")})`);
// 보기는 Dolphin 의 셋(아이콘 · 간단히 · 자세히 — 2026-10-07 docs/log/2026-10-07-file-tile-dolphin.md). 옛 트리는 자세히가 흡수했다.
check((await ev(`(${TILE(H)}).querySelector('[data-file-view-pick]')?.getAttribute('aria-label') ?? ''`)).includes("자세히") && (await ev(`(${TILE(H)}).querySelector('.sftp .list:not(.icons):not(.compact)') !== null`)), "보기 고르개 = 자세히(트리)");
check((await ev(`window.__lists.join('|')`)) === H, `뿌리만 읽었다 (${await ev(`window.__lists.join('|')`)})`);
check((await ev(`(${TILE(H)}).querySelectorAll('.row .twisty-pad').length`)) === 2, "파일 줄은 화살표 칸을 비운다(2)");

// ── ② 화살표로 펼치기 · 게으른 읽기 · 캐시 ──────────────────────────────────
await mouse(`${ROW(J(H, "src"))}.querySelector('.twisty')`);
await sleep(300);
s = await shape(H);
check(s.slice(0, 3).join("|") === "▾ src|  ▸ lib|  main.ts", `src 펼침 (${s.slice(0, 3).join(" | ")})`);
check((await listCalls(J(H, "src"))) === 1, "src 는 펼칠 때 한 번 읽었다");
const indent = JSON.parse(await ev(`JSON.stringify([${ROW(J(H, "src"))}, ${ROW(J(J(H, "src"), "lib"))}].map(r => r.querySelector('.glyph').getBoundingClientRect().x))`));
check(Math.round(indent[1] - indent[0]) === 16, `한 단 = 16px (${indent[1] - indent[0]})`);
check((await selected(H)).join() === "src", "화살표 클릭 = 그 줄을 고른다");
await mouse(`${ROW(J(H, "src"))}.querySelector('.twisty')`);
s = await shape(H);
check(s[0] === "▸ src" && !s.includes("  main.ts"), "다시 누르면 접힘");
await mouse(`${ROW(J(H, "src"))}.querySelector('.twisty')`);
check((await listCalls(J(H, "src"))) === 1 && (await shape(H))[2] === "  main.ts", "다시 펼치면 캐시 — 읽지 않는다");

// ── ③ 키 ─────────────────────────────────────────────────────────────────────
await clickRow(J(H, "src"));
await key("ArrowRight"); // 펼친 폴더 → 첫 아이(lib)
check((await selected(H)).join() === "lib", `→ = 첫 아이로 (${await selected(H)})`);
await key("ArrowRight"); // lib 펼치기
await sleep(200);
check((await shape(H)).includes("    a.ts") && (await listCalls(J(J(H, "src"), "lib"))) === 1, "→ = 접힌 폴더 펼치기 (게으른 읽기 1회)");
await key("ArrowRight"); await key("ArrowRight"); // a.ts 로, 파일에서 → 는 할 일 없음
check((await selected(H)).join() === "a.ts", `→ → = a.ts (${await selected(H)})`);
await key("ArrowLeft");
check((await selected(H)).join() === "lib", "파일에서 ← = 든 폴더 줄");
await key("ArrowLeft");
check(!(await shape(H)).includes("    a.ts") && (await selected(H)).join() === "lib", "펼친 폴더에서 ← = 접기");
await key("ArrowLeft");
check((await selected(H)).join() === "src", "접힌 폴더에서 ← = 부모 줄");
await key("End");
check((await selected(H)).join() === "latest.log", `End = 맨 아래 (${await selected(H)})`);
await key("Home");
check((await selected(H)).join() === "src", "Home = 맨 위");
await key("ArrowDown"); await key("ArrowDown");
check((await selected(H)).join() === "main.ts", `↓↓ = 트리 순서로 (${await selected(H)})`);
await key("r");
check((await selected(H)).join() === "README.md", `글자 r = README.md (${await selected(H)})`);
await sleep(900);
await key("s"); await key("h");
check((await selected(H)).join() === "shared", `글자 sh = shared (${await selected(H)})`);
await sleep(900);

// ── ④ 더블클릭 = 뿌리 옮기기 · 빵부스러기 · 뒤로 ─────────────────────────────
await clickRow(J(H, "docs"), { clickCount: 2 });
await sleep(500);
s = await shape(J(H, "docs"));
check(s.join("|") === "guide.md", `docs 로 뿌리를 옮겼다 (${s.join(" | ")})`);
const crumb = await ev(`[...(${TILE(J(H, "docs"))}).querySelectorAll('.crumb, [data-crumb]')].map(c => c.textContent.trim()).filter(Boolean).pop() ?? ''`);
check(String(crumb).includes("docs"), `빵부스러기 끝 = docs (${crumb})`);
check((await paneSpec("localfs"))[0]?.path === J(H, "docs"), "패널 명세의 path = docs (배치 저장)");
await key("Backspace");
await sleep(500);
s = await shape(H);
check(s[0] === "▾ src" && s.includes("  main.ts"), `뒤로 = 옛 뿌리 · 펼침이 남았다 (${s.slice(0, 3).join(" | ")})`);

// ── ⑤ 대상 폴더 ─────────────────────────────────────────────────────────────
await clickRow(J(H, "src"));
check(String(await toolbarTitle("[data-file-newfolder]")).includes(`대상: ${J(H, "src")}`), "폴더를 고르면 툴바 말풍선에 대상 = 그 폴더");
await clickRow(J(J(H, "src"), "main.ts"));
check(String(await toolbarTitle("[data-file-newfolder]")).includes(`대상: ${J(H, "src")}`), "파일을 고르면 대상 = 든 폴더");
await key("Escape");
check(!String(await toolbarTitle("[data-file-newfolder]")).includes("대상:"), "아무것도 안 고르면 대상 = 뿌리 (둘째 줄 없음)");
// 툴바 [폴더] → src 안에 만든다
await clickRow(J(H, "src"));
await mouse(`(${TILE(H)}).querySelector('[data-file-newfolder]')`);
await sleep(300);
const nfTitle = await ev(`document.querySelector('.ctx-menu .ctx-title')?.textContent ?? ''`);
check(String(nfTitle).includes(J(H, "src")), `새 폴더 폼 제목 = src (${nfTitle})`);
await ev(`(() => { const i = document.querySelector('.ctx-menu input'); i.value = 'made'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await ev(`document.querySelector('.ctx-menu input').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
await sleep(600);
const mk = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'local_mkdir').map(c => c[1].path))`);
check(mk === q([J(J(H, "src"), "made")]), `mkdir = src\\made (${mk})`);
check((await selected(H)).join() === "made" && (await shape(H)).includes("  ▸ made"), "만든 폴더가 src 아래에 서고 골라져 있다");
// Ctrl+V → 고른 폴더(docs)로
await ev(`${importApp("fs-clipboard.svelte")}.then(m => m.setFsClip('copy', 'local', [${q(J(H, "README.md"))}]))`);
await clickRow(J(H, "docs"));
await key("v", 2);
await sleep(700);
let copies = JSON.parse(await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'local_copy').map(c => c[1].destDir))`));
check(copies.at(-1) === J(H, "docs"), `Ctrl+V = 고른 폴더 docs (${copies.at(-1)})`);
s = await shape(H);
check(s.includes("▾ docs") && s.includes("  README.md") && (await selected(H)).join() === "README.md", `붙여넣은 폴더가 펼쳐지고 놓인 것이 골라진다 (${await selected(H)})`);
// 파일 줄 메뉴의 붙여넣기 → 그 파일이 든 폴더(src)
await mouse(ROW(J(J(H, "src"), "main.ts")), { dx: 150, button: "right" });
await ev(`${ROW(J(J(H, "src"), "main.ts"))}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }))`);
await sleep(250);
const pasteBtn = await ev(`[...document.querySelectorAll('.ctx-menu .ctx-item')].findIndex(b => b.textContent.trim() === '붙여넣기')`);
check(pasteBtn >= 0, "파일 메뉴에 붙여넣기");
await ev(`[...document.querySelectorAll('.ctx-menu .ctx-item')][${pasteBtn}].click()`);
await sleep(700);
copies = JSON.parse(await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'local_copy').map(c => c[1].destDir))`));
check(copies.at(-1) === J(H, "src"), `파일 메뉴 붙여넣기 = 든 폴더 src (${copies.at(-1)})`);
check((await ev(`document.querySelectorAll('.ctx-menu').length`)) === 0, "메뉴가 닫혔다");
// 폴더 메뉴 "새 폴더…" → 그 폴더
await ev(`${ROW(J(H, "docs"))}.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 200 }))`);
await sleep(250);
check((await ev(`!!document.querySelector('.ctx-menu [data-menu-newfolder]')`)) === true, "폴더 메뉴에 새 폴더…");
await ev(`document.querySelector('.ctx-menu [data-menu-newfolder]').click()`);
await sleep(250);
const nf2 = await ev(`document.querySelector('.ctx-menu .ctx-title')?.textContent ?? ''`);
check(String(nf2).includes(J(H, "docs")), `폴더 메뉴 새 폴더 = docs (${nf2})`);
await key("Escape");
await ev(`document.querySelector('.menu-backdrop')?.click()`);
await sleep(200);
// 빈 곳 메뉴 = 뿌리
await ev(`(${TILE(H)}).querySelector('.list').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 300, clientY: 600 }))`);
await sleep(250);
const bgTitle = await ev(`document.querySelector('.ctx-menu .ctx-title')?.textContent ?? ''`);
check(bgTitle === H, `빈 곳 메뉴 = 뿌리 (${bgTitle})`);
const bgPaste = await ev(`[...document.querySelectorAll('.ctx-menu .ctx-item')].findIndex(b => b.textContent.trim() === '붙여넣기')`);
await ev(`[...document.querySelectorAll('.ctx-menu .ctx-item')][${bgPaste}].click()`);
await sleep(700);
copies = JSON.parse(await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'local_copy').map(c => c[1].destDir))`));
check(copies.at(-1) === H, `빈 곳 붙여넣기 = 뿌리 (${copies.at(-1)})`);

// ── ⑥ 끌어 놓기 ─────────────────────────────────────────────────────────────
const dragOn = (p, type, extra = "") => ev(`(() => { const dt = new DataTransfer(); ${type === "files" ? "dt.items.add(new File(['x'], 'up.txt'));" : "dt.setData('application/x-aynx-files', JSON.stringify({ backendKey: 'local', paths: [" + q(J(H, "latest.log")) + "] }));"} ${extra}
  const el = ${ROW(p)}; const r = el.getBoundingClientRect();
  const e = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.x + 150, clientY: r.y + r.height / 2 });
  el.dispatchEvent(e); window.__lastDt = dt; return e.defaultPrevented; })()`);
const dropOver = (tile = H) => ev(`JSON.stringify([...(${TILE(tile)}).querySelectorAll('.row.drop-over')].map(r => r.querySelector('.name').textContent.trim()).concat((${TILE(tile)}).querySelector('.list.drop-over') ? ['(list)'] : []))`).then(JSON.parse);
// 앱 안 짐(fs) — 폴더 줄은 그 폴더, 파일 줄은 든 폴더
await dragOn(J(H, "docs"), "fs");
check((await dropOver()).join() === "docs", `폴더 줄 위 = 그 폴더 하이라이트 (${await dropOver()})`);
await dragOn(J(J(H, "src"), "main.ts"), "fs");
check((await dropOver()).join() === "src", `파일 줄 위 = 든 폴더(src) 하이라이트 (${await dropOver()})`);
await dragOn(J(H, "README.md"), "fs");
check((await dropOver()).join() === "(list)", `뿌리 파일 줄 위 = 목록(뿌리) 하이라이트 (${await dropOver()})`);
// 접힌 폴더 위에 머물면 펼친다
await clickRow(J(H, "docs")); await key("ArrowLeft");
check((await shape(H)).includes("▸ docs"), "docs 접음");
await dragOn(J(H, "docs"), "fs");
await sleep(750);
check((await shape(H)).includes("▾ docs"), "끌면서 600ms 머물면 펼친다");
await ev(`(${TILE(H)}).querySelector('.list').dispatchEvent(new DragEvent('dragend', { bubbles: true }))`);
await ev(`${ROW(J(H, "docs"))}.dispatchEvent(new DragEvent('dragleave', { bubbles: true }))`);
// OS 파일 — 줄 위에 놓으면 그 폴더로 업로드(가져오기) 모달, 타일 전체 하이라이트는 없다
const accepted = await dragOn(J(H, "shared"), "files");
await sleep(100);
check(accepted === true && (await dropOver()).join() === "shared", `OS 파일 → 링크 폴더 줄 하이라이트 (${await dropOver()})`);
check((await ev(`document.querySelectorAll('.drop.all').length`)) === 0, "타일 전체 '여기로 업로드' 하이라이트 없음 (줄에 양보)");
await ev(`(() => { const el = ${ROW(J(H, "shared"))}; el.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: window.__lastDt })); })()`);
await sleep(500);
const upDir = await ev(`document.querySelector('#up-dir')?.value ?? 'none'`);
check(upDir === J(H, "shared"), `줄 위 드롭 = 그 폴더로 업로드 모달 (${upDir})`);
await ev(`document.querySelector('#up-dir')?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await key("Escape");
await sleep(300);

// ── ⑦ 큰 폴더 ───────────────────────────────────────────────────────────────
const t0 = Date.now();
await ev(`(${ROW(J(H, "big"))}).querySelector('.twisty').click()`);
const drawn = await ev(`new Promise(res => { const t0 = performance.now(); const pre = ${q(J(H, "big") + "\\")}; const tick = () => { const n = [...document.querySelectorAll('.row[data-depth="1"]')].filter(r => (r.dataset.path ?? '').startsWith(pre)).length; if (n > 0) res(performance.now() - t0); else requestAnimationFrame(tick); }; tick(); })`);
const wall = Date.now() - t0;
const bigRows = await ev(`[...document.querySelectorAll('.row[data-depth="1"]')].filter(r => (r.dataset.path ?? '').startsWith(${q(J(H, "big") + "\\")})).length`);
const more = await ev(`(${TILE(H)}).querySelector('.row.more')?.textContent.trim() ?? 'none'`);
check(bigRows === 500 && String(more).includes("2500"), `3000 개 폴더 = 500 줄 + '2500개 더 보기' (${bigRows} · ${more})`);
check(typeof drawn === "number" && wall < 1500, `펼쳐 그리기가 빠르다 (첫 줄 ${Math.round(drawn)}ms · 왕복 ${wall}ms)`);
await mouse(`(${TILE(H)}).querySelector('.row.more')`);
await sleep(300);
const bigRows2 = await ev(`[...document.querySelectorAll('.row[data-depth="1"]')].filter(r => (r.dataset.path ?? '').startsWith(${q(J(H, "big") + "\\")})).length`);
check(bigRows2 === 1000, `더 보기 = 500 줄 더 (${bigRows2})`);
await ev(`(${ROW(J(H, "big"))}).querySelector('.twisty').click()`); await sleep(200);

// ── ⑧ 링크 폴더 펼치기 ──────────────────────────────────────────────────────
s = await shape(H);
check(s.includes("▾ shared") ? true : (await ev(`(${ROW(J(H, "shared"))}).querySelector('.twisty').click()`), await sleep(300), (await shape(H)).includes("  x.txt")), "디렉터리 링크도 펼친다");
await ev(`${importApp("mode.svelte.ts")}.then(m => m.setAppMode('dark'))`).catch(() => {});
await clickRow(J(H, "src"));
await sleep(200);
console.log("capture:", await shot("files-tree.png", await tileClip(H, 420)));

// ── ⑨ 보기 전환 · 기억 · 설정 기본값 ─────────────────────────────────────────
// 옛 두 보기(트리 · 들어가기 — 단추 하나로 갈마들기)는 2026-10-07 Dolphin 의 세 보기(`[data-file-view-pick]` 고르개 → 메뉴 줄
// `data-menu-key`)로 바뀌었다 — 자세히 = 옛 트리(펼침 화살표), 아이콘 · 간단히 = 펼치지 않는 평평한 보기(옛 들어가기 자리).
const pickView = async (tile, view) => {
  await mouse(`(${TILE(tile)}).querySelector('[data-file-view-pick]')`);
  await sleep(250);
  await mouse(`document.querySelector('[data-toolbar-menu] [data-menu-key="${view}"]')`);
  await sleep(400);
};
const listMode = (tile) => ev(`(() => { const l = (${TILE(tile)}).querySelector('.sftp .list'); return l.classList.contains('icons') ? 'icons' : l.classList.contains('compact') ? 'compact' : 'details'; })()`);
await pickView(H, "icons");
check((await ev(`(${TILE(H)}).querySelectorAll('.twisty, .twisty-pad').length`)) === 0 && (await listMode(H)) === "icons", `아이콘 보기 = 화살표 없음 · 평평 (${await listMode(H)})`);
check((await ev(`(${TILE(H)}).querySelector('[data-file-view-pick]').getAttribute('aria-label')`)).includes("아이콘"), "고르개 = 아이콘");
check((await paneSpec("localfs"))[0]?.fileView === "icons", "패널 명세에 fileView=icons (배치·이관에 실린다)");
console.log("capture:", await shot("files-navigate-toggle.png", await tileClip(H, 300)));
await clickRow(J(H, "docs"));
await key("v", 2); await sleep(600);
copies = JSON.parse(await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'local_copy').map(c => c[1].destDir))`));
check(copies.at(-1) === H, `아이콘 보기의 Ctrl+V = 지금 폴더 그대로 (${copies.at(-1)})`);
await pickView(H, "details");
s = await shape(H);
check((await paneSpec("localfs"))[0]?.fileView === "details" && s.includes("▾ src") && s.includes("▾ docs"), `다시 자세히 — 펼침이 그대로 남았다 (${s.filter((x) => x.startsWith("▾")).join(" | ")})`);
// 설정 기본값 = 아이콘 → 새 타일은 아이콘, 따로 고른 타일은 그대로
await ev(`${importApp("settings.svelte")}.then(m => m.setFileDefaultView('icons'))`);
await ev(`${importApp("app/panes.svelte")}.then(m => m.openLocalFsPaneHere())`); await sleep(1200);
const viewsNow = () => ev(`JSON.stringify([...document.querySelectorAll('.pane-box .sftp .list')].map(l => l.classList.contains('icons') ? 'icons' : l.classList.contains('compact') ? 'compact' : 'details'))`).then(JSON.parse);
const views = await viewsNow();
check(views.slice().sort().join() === "details,icons", `설정 기본 = 새 타일만 아이콘 (${views})`);
check((await paneSpec("localfs")).filter((p) => p.fileView === undefined).length === 1, "새 타일은 명세에 보기를 적지 않는다(기본을 따른다)");
await ev(`${importApp("settings.svelte")}.then(m => m.setFileDefaultView('details'))`);
await sleep(300);
check((await viewsNow()).every((v) => v === "details"), "기본을 자세히로 되돌리면 따라 바뀐다");
// 두 번째 타일 닫기 대신 SFTP 로 쓸 원본 id 로 첫 타일을 쓴다

// ── ⑩ SFTP — 읽는 중 줄 · 줄 안 오류 ────────────────────────────────────────
const srcId = (await paneSpec("localfs"))[0].id;
await ev(`(async () => { const s = await ${importApp("lib/session.ts")}; const w = await ${importApp("app/tabs.svelte")}; const ss = await ${importApp("app/sessions.svelte")}; ss.noteSession(${q(srcId)}, 7); w.openPaneHere(s.newSftpPane(${q(srcId)}, 'web-01', '/srv')); })()`);
await sleep(1500);
s = await shape("/srv");
check(s.join("|") === "▸ app|▸ logs|▸ secret|notes.txt", `SFTP 트리 뿌리 (${s.join(" | ")})`);
await mouse(`${ROW("/srv/app")}.querySelector('.twisty')`, {});
await sleep(450);
s = await shape("/srv");
const loadingOpacity = await ev(`getComputedStyle((${TILE("/srv")}).querySelector('.row.aux.loading')).opacity`);
check(s[1] === "(loading)" && loadingOpacity === "1", `늦은 폴더 = 읽는 중 줄 (${s[1]} · opacity ${loadingOpacity})`);
console.log("capture:", await shot("files-tree-sftp-loading.png", await tileClip("/srv", 260)));
await sleep(1500);
s = await shape("/srv");
check(s.slice(0, 3).join("|") === "▾ app|  ▸ lib|  main.py", `답이 오면 아이 줄 (${s.slice(0, 3).join(" | ")})`);
await mouse(`${ROW("/srv/secret")}.querySelector('.twisty')`, {});
await sleep(600);
const err = await ev(`(${ROW("/srv/secret")}).querySelector('.row-err')?.textContent ?? 'none'`);
check(String(err).includes("권한이 없습니다"), `권한 없는 폴더 = 줄 안 오류 (${err})`);
check((await ev(`${ROW("/srv/secret")}.getAttribute('aria-expanded')`)) === "false", "오류 폴더는 접힌 채");
check((await ev(`(${TILE("/srv")}).querySelectorAll('.banner.err').length`)) === 0, "타일 위 오류 띠는 없다 (뿌리 실패만 띠)");
const sftpCalls = await ev(`window.__sftpLists.join('|')`);
check(sftpCalls === "/srv|/srv/app|/srv/secret", `SFTP 도 펼칠 때만 읽는다 (${sftpCalls})`);

// ── ⑪ 라이트 ─────────────────────────────────────────────────────────────────
await ev(`${importApp("mode.svelte.ts")}.then(m => m.setAppMode('light'))`); await sleep(500);
await clickRow(J(H, "src"));
await sleep(200);
console.log("capture:", await shot("files-tree-light.png", await tileClip(H, 420)));

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" / ")})`);
console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
ws.close();
process.exit(failed ? 1 : 0);
