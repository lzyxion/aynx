// Headless harness: **파일 목록·호스트 트리의 이중톤 글리프** (docs/log/2026-09-25-duotone-glyphs.md).
// `dock-segments-harness.mjs` 의 사본 — 스텁에 로컬 파일 목록(`local_*`)과 폴더 셋(하나는 사용자가
// 고른 이모지)을 더했다.
//
//   npx vite --port 1434 --strictPort        (다른 작업이 파일을 고치는 중이면 README ui-scale 절의 no-HMR 설정)
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-glyphs \
//     --window-size=1100,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/file-glyphs-harness.mjs outdir 9250
//
// 보는 것: ① 로컬 파일 타일의 줄 — 폴더 = `folder` 꽉 찬 그림(`--folder`) ·
// 파일 = `file` 선 하나(`--fg-3`) · 파일 링크 = `file-symlink` · 폴더 링크 = `folder-symlink` ·
// 굵기 1.75 · 14px · 손으로 딴 채움 글리프(`.glyph-svg`) 없음 · 내보내기 손잡이 = `export` ② 골라진
// 파일 줄은 `--fg-2`, 골라진 폴더 줄은 폴더 색 그대로 ③ 끌기 그림(`nativeDragIcon`) — 폴더·파일 둘 다
// PNG 로 나오고 도형이 찍힌다 ④ 호스트 트리 — 아이콘을 안 고른 폴더는 같은 이중톤, 사용자가 고른 이모지
// 폴더는 그대로 이모지 ⑤ 라이트. 콘솔 예외 0.
// PNG: `files-after.png` · `files-after-light.png` · `hosts-folders-after.png` · `drag-dir.png` · `drag-file.png`
// (셋째 인자 뒤에 `before` 를 주면 `files-before.png` 한 장만 찍고 검사는 건너뛴다 — 옛 코드에서 찍는 용도).
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9224";
const BEFORE = process.argv[4] === "before";
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
    localStorage.removeItem('aynx:dock'); localStorage.removeItem('aynx:status-order');
    localStorage.setItem('aynx:hosts:expanded', JSON.stringify(['운영', '운영/db']));
  } catch {}
  const host = (name, ip, group) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null, group } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const HOME = 'C:\\\\Users\\\\me\\\\proj';
  const T = 1758700000;
  const e = (name, kind, size, extra = {}) => ({ name, path: HOME + '\\\\' + name, kind, size, mtime: T - size, mode: null, symlinkTarget: null, linkIsDir: false, hidden: false, ...extra });
  const ENTRIES = [
    e('src', 'dir', 0), e('docs', 'dir', 0), e('node_modules', 'dir', 0), e('scripts', 'dir', 0),
    e('shared', 'symlink', 0, { symlinkTarget: 'D:\\\\shared', linkIsDir: true }),
    e('README.md', 'file', 4210), e('package.json', 'file', 1893), e('vite.config.ts', 'file', 1204),
    e('Cargo.lock', 'file', 88213), e('logo.png', 'file', 23911),
    e('latest.log', 'symlink', 0, { symlinkTarget: 'logs\\\\2026-09-25.log' }),
  ];
  const answers = {
    list_hosts: { hosts: [host('web-01', '10.0.0.1', '운영'), host('web-02', '10.0.0.2', '운영'), host('db-01', '10.0.1.1', '운영/db'), host('dev-01', '10.1.0.1', '개발'), host('lab-01', '192.168.0.9', null)], warnings: [] },
    // 개발 폴더만 사람이 이모지를 골라 뒀다 — 기본 이중톤 폴더를 덮어야 한다
    get_host_meta: META, list_group_meta: { '개발': { icon: '🚀' } }, list_host_meta: {},
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
    local_home: HOME, local_roots: ['C:\\\\', 'D:\\\\'], local_list: ENTRIES,
    local_stat: e('proj', 'dir', 0, { path: HOME }),
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
const cssVal = (v, prop = "color") => ev(`(() => { const d = document.createElement('div'); d.style.setProperty('${prop}', 'var(${v})'); document.body.appendChild(d); const c = getComputedStyle(d).getPropertyValue('${prop}'); d.remove(); return c; })()`);
const clickRow = async (i, modifiers = 0) => { const r = JSON.parse(await ev(`JSON.stringify(document.querySelectorAll('.list .row')[${i}].getBoundingClientRect())`)); const x = r.x + 80, y = r.y + r.height / 2; await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers }); await sleep(250); };
/** 목록 위쪽을 잘라 찍는다 — 줄 11개와 머리줄이 들어갈 만큼 */
const listClip = async () => { const r = JSON.parse(await ev(`JSON.stringify(document.querySelector('.list .row').closest('.list').getBoundingClientRect())`)); return { x: Math.max(0, r.x - 8), y: Math.max(0, r.y - 36), width: Math.min(r.width + 16, 520), height: Math.min(r.height + 44, 300) }; };

await send("Page.reload", { ignoreCache: true }); await sleep(4500);
await ev(`${importApp("app/panes.svelte")}.then(m => m.openLocalFsPaneHere())`); await sleep(1500);
const rows = await ev(`document.querySelectorAll('.list .row').length`);
check(rows === 11, `로컬 파일 타일에 줄 11개 (${rows})`);

if (BEFORE) {
  console.log("capture:", await shot("files-before.png", await listClip()));
  ws.close(); process.exit(0);
}

// ── ① 줄 앞자리 ──────────────────────────────────────────────────────────────
const rowInfo = () => ev(`JSON.stringify([...document.querySelectorAll('.list .row')].map(r => {
  const g = r.querySelector('.glyph'); const svg = g?.querySelector('svg'); const p = svg?.querySelector('path');
  const cs = p ? getComputedStyle(p) : null;
  return { name: r.querySelector('.name').textContent.trim(), cls: svg?.getAttribute('class') ?? '', w: svg?.getAttribute('width'),
    color: getComputedStyle(g).color, fill: cs?.fill, fillOp: cs?.fillOpacity, sw: cs?.strokeWidth, paths: svg?.querySelectorAll('path').length ?? 0,
    body: svg ? [...svg.querySelectorAll('path')].map(p => p.getAttribute('d')).join('|') : '' };
}))`).then(JSON.parse);
const folderC = await cssVal("--folder"), fg3 = await cssVal("--fg-3"), fg2 = await cssVal("--fg-2");
let info = await rowInfo();
const by = (n) => info.find((r) => r.name === n) ?? {};
/** 생성 파일의 `body` 에서 `d` 만 — DOM 직렬화는 원문과 글자가 달라(`/>` → `></path>`) path 데이터로 견준다 */
const iconD = (name, filled = false) => ev(`${importApp("ui-icons.generated")}.then(m => [...m.UI_ICONS['${name}'].${filled ? "filledBody" : "body"}.matchAll(/ d="([^"]+)"/g)].map(x => x[1]).join('|'))`);
check(String(by("src").cls).includes("ui-icon"), `폴더 = UiIcon (${by("src").cls})`);
check(by("src").color === folderC && by("src").fillOp === "1", `폴더 색 --folder · 칠 100% (${by("src").color} · ${by("src").fillOp})`);
check(by("src").w === "14", `14px (${by("src").w})`);
check(by("README.md").paths === 1, `파일 = 윤곽 그림 하나(path 1) (${by("README.md").paths})`);
check(by("README.md").color === fg3, `파일 색 --fg-3 (${by("README.md").color} / ${fg3})`);
check(by("src").body === (await iconD("folder", true)), "폴더 = folder 꽉 찬 그림");
check(by("README.md").body === (await iconD("file")), "파일 = file");
check(by("latest.log").body === (await iconD("file-symlink")), "파일 링크 = file-symlink");
check(by("shared").body === (await iconD("folder-symlink")), "폴더 링크 = folder-symlink");
check(by("shared").color === folderC, `폴더 링크는 폴더 색 --folder (${by("shared").color})`);
check(by("latest.log").color === fg3, `파일 링크는 --fg-3 (${by("latest.log").color})`);
check((await ev(`document.querySelectorAll('.list .glyph-svg').length`)) === 0, "손으로 딴 채움 글리프 없음");
const grip = await ev(`(() => { const s = document.querySelector('.list .row .grip svg'); return s ? s.getAttribute('class') + '#' + [...s.querySelectorAll('path')].map(p => p.getAttribute('d')).join('|') : 'none'; })()`);
check(grip.startsWith("ui-icon") && grip.endsWith("#" + (await iconD("export"))), `내보내기 손잡이 = export (${grip.slice(0, 24)})`);

// ── ② 골라진 줄 ───────────────────────────────────────────────────────────────
await clickRow(5); // README.md
await clickRow(0, 2); // src (Ctrl)
info = await rowInfo();
check(by("README.md").color === fg2, `골라진 파일 = --fg-2 (${by("README.md").color} / ${fg2})`);
check(by("src").color === folderC, `골라진 폴더 = --folder 그대로 (${by("src").color})`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1090, y: 790 }); await sleep(200);
console.log("capture:", await shot("files-after.png", await listClip()));

// ── ③ 끌기 그림 ───────────────────────────────────────────────────────────────
for (const [isDir, file] of [[true, "drag-dir.png"], [false, "drag-file.png"]]) {
  const url = await ev(`${importApp("native-drag")}.then(m => m.nativeDragIcon(${isDir ? 3 : 1}, ${isDir}, '3'))`);
  const ok = typeof url === "string" && url.startsWith("data:image/png;base64,") && url.length > 2000;
  check(ok, `끌기 그림 ${isDir ? "폴더" : "파일"} PNG (${typeof url === "string" ? url.length : url})`);
  if (!ok) continue;
  fs.writeFileSync(path.join(outDir, file), Buffer.from(url.split(",")[1], "base64"));
  // 가운데 40px 안에 **잉크 색**이 찍혔는가 — 바탕만 있으면 도형이 빠진 것
  const ink = await ev(`new Promise(res => { const i = new Image(); i.onload = () => { const c = document.createElement('canvas'); c.width = i.width; c.height = i.height; const x = c.getContext('2d'); x.drawImage(i, 0, 0); const s = i.width / 64; const d = x.getImageData(Math.round(12 * s), Math.round(12 * s), Math.round(40 * s), Math.round(40 * s)).data; const set = new Set(); for (let k = 0; k < d.length; k += 4) set.add(d[k] + ',' + d[k+1] + ',' + d[k+2]); res(set.size); }; i.src = ${JSON.stringify(url)}; })`);
  check(ink > 8, `끌기 그림에 도형이 찍혔다 (가운데 색 ${ink}가지)`);
}

// ── ④ 호스트 트리 ─────────────────────────────────────────────────────────────
await ev(`${importApp("app/dock.svelte")}.then(m => m.openDock('hosts'))`); await sleep(800);
const folders = await ev(`JSON.stringify([...document.querySelectorAll('.dock .sidebar .item.folder')].map(f => { const s = f.querySelector('.lead svg'); return { name: f.querySelector('.name').textContent.trim(), cls: s?.getAttribute('class') ?? '', emoji: f.querySelector('.lead .emoji')?.textContent.trim() ?? null, color: s ? getComputedStyle(s).color : null }; }))`).then(JSON.parse);
const fo = (n) => (Array.isArray(folders) ? folders.find((x) => x.name === n) : null) ?? {};
check(Array.isArray(folders) && folders.length >= 3, `호스트 독에 폴더 줄 (${Array.isArray(folders) ? folders.map((x) => x.name).join(",") : folders})`);
check(String(fo("운영").cls).includes("ui-icon") && fo("운영").color === folderC, `운영 폴더 = --folder (${fo("운영").cls} · ${fo("운영").color})`);
check(String(fo("db").cls).includes("ui-icon"), `중첩 db 폴더도 같은 그림 (${fo("db").cls})`);
check(fo("개발").emoji === "🚀" && !fo("개발").cls, `사용자가 고른 이모지가 기본 폴더를 덮는다 (${fo("개발").emoji})`);
const dock = JSON.parse(await ev(`JSON.stringify(document.querySelector('.dock').getBoundingClientRect())`));
console.log("capture:", await shot("hosts-folders-after.png", { x: dock.x, y: dock.y, width: dock.width, height: Math.min(dock.height, 320) }));

// ── ⑤ 라이트 ─────────────────────────────────────────────────────────────────
await ev(`${importApp("app/dock.svelte")}.then(m => m.closeDock())`); await sleep(400);
await ev(`(async () => { const m = await ${importApp("mode.svelte.ts")}; m.setAppMode('light'); })()`); await sleep(500);
const folderL = await cssVal("--folder"), fg3L = await cssVal("--fg-3");
info = await rowInfo();
check(by("src").color === folderL && folderL !== folderC, `라이트 폴더 = --folder (${folderL})`);
check(by("package.json").color === fg3L, `라이트 파일 = --fg-3 (${fg3L})`);
console.log("capture:", await shot("files-after-light.png", await listClip()));

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" / ")})`);
console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
ws.close();
process.exit(failed ? 1 : 0);
