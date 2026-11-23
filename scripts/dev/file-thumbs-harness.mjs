// Headless harness: **파일 타일 아이콘 보기의 그림 썸네일 · 경로 칸 ⟳ 회전** (2026-11-23 — `browser/thumbs.ts` · `thumbs.svelte.ts` ·
// `FileList.svelte` 의 `use:thumbs.watch` · `LocationBar.svelte` 의 `spin()`).
//   node scripts/dev/run-harness.mjs file-thumbs-harness.mjs <outdir> --size 1100x800
//
// 스텁은 `file-glyphs-harness` 의 것 + 그림 파일 여럿(가로 · 세로 · 투명 PNG · 크기 있는 SVG · viewBox 만 SVG · GIF · JPG · WebP · 깨진
// `broken.png` · 목록 크기 25 MB 인 `huge.png` · 그림 220장) · 그림 아닌 파일 · 폴더. `local_read_preview` 는 OffscreenCanvas 로 만든 진짜
// 바이트를 `window.__readDelay` ms 뒤에 돌려주고 진행 중 수(`__inflight` · `__maxInflight`)와 읽은 경로(`__reads`)를 적는다. 목록의 mtime 은
// `window.__mt[이름]` 으로 바꾼다. `URL.createObjectURL` · `revokeObjectURL` 은 페이지에서 감싸 `window.__blobs` 에 센다.
// 보는 것: ① 보이는 그림 칸의 `img.thumb`(blob: · naturalWidth > 0 · 상자 = 글리프 · contain · 비율) ② 배지 · 이름 그대로 · 그림 아닌 것 = 글리프
// ③ huge = 글리프 · 읽기 없음 ④ broken = 글리프 · 한 번만 ⑤ 보이는 칸만 · 동시 ≤ 3 ⑥ 읽는 중 dim ⑦ ⟳ = 다시 읽지 않음 · mtime 바뀐 것만
// ⑧ 보기 왕복 = 캐시 ⑨ 확대 = 상자만 ⑩ 클릭 · 더블클릭 · 우클릭 · draggable ⑪ 타일 닫기 = Blob URL 거둠 ⑫ ⟳ 회전(⟳ · 메뉴 · 머리줄 · 몸 · 폴더 이동은 안 돎)
// ⑬ 라이트 · 콘솔 예외 0.
// PNG: thumbs-loading.png · thumbs-dark.png · thumbs-zoom-max.png · thumbs-light.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { reloadBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.env.CDP_PORT ?? process.argv[3] ?? "9224";
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map();
const errors = []; const consoleErrors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  if (d.method === "Runtime.exceptionThrown") errors.push(String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text).split("\n")[0]);
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") consoleErrors.push(d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const evj = async (e) => { const v = await ev(e); if (typeof v === "string" && v.startsWith("EXC ")) { console.log("  (식 예외)", v); return null; } return typeof v === "string" ? JSON.parse(v) : v; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); console.log("capture:", path.resolve(p)); };
let failed = 0;
/** `"EXC …"` 문자열 · null 은 참으로 받지 않는다 — 참은 진짜 `true` 만 */
const check = (ok, label) => { const pass = ok === true; if (!pass) failed++; console.log(`${pass ? "PASS" : "FAIL"} ${label}`); };
await send("Page.enable"); await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  performance.setResourceTimingBufferSize(5000);
  try { localStorage.clear(); } catch {}
  // Blob URL 세기 — 만든 것 · 거둔 것
  window.__blobs = new Map();
  const mk0 = URL.createObjectURL.bind(URL), rv0 = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = (o) => { const u = mk0(o); window.__blobs.set(u, { type: o?.type ?? '', revoked: false }); return u; };
  URL.revokeObjectURL = (u) => { const b = window.__blobs.get(u); if (b) b.revoked = true; return rv0(u); };
  const HOME = 'C:\\\\Users\\\\me\\\\pics';
  const T = 1758700000;
  window.__mt = {}; window.__reads = []; window.__inflight = 0; window.__maxInflight = 0; window.__readDelay = 0;
  const canvasImg = async (w, h, hue, kind, type = 'image/png') => {
    const c = new OffscreenCanvas(w, h); const x = c.getContext('2d');
    if (kind === 'alpha') {
      x.clearRect(0, 0, w, h); x.fillStyle = 'hsla(' + hue + ',85%,55%,0.95)';
      x.beginPath(); x.arc(w / 2, h / 2, Math.min(w, h) / 2.4, 0, Math.PI * 2); x.fill();
    } else {
      const g = x.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, 'hsl(' + hue + ',75%,58%)'); g.addColorStop(1, 'hsl(' + ((hue + 140) % 360) + ',70%,32%)');
      x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.fillStyle = 'rgba(255,255,255,0.85)'; x.fillRect(w * 0.12, h * 0.12, w * 0.3, h * 0.3);
    }
    return await (await c.convertToBlob({ type, quality: 0.9 })).arrayBuffer();
  };
  const svg = (s) => new TextEncoder().encode(s).buffer;
  // 1×1 빨간 GIF89a
  const GIF = new Uint8Array([0x47,0x49,0x46,0x38,0x39,0x61,1,0,1,0,0x80,0,0,0xff,0,0,0xff,0xff,0xff,0x2c,0,0,0,0,1,0,1,0,0,2,2,0x44,1,0,0x3b]).buffer;
  const GEN = {
    'a-wide.png': () => canvasImg(240, 80, 10),
    'b-tall.png': () => canvasImg(60, 180, 200),
    'c-alpha.png': () => canvasImg(120, 120, 120, 'alpha'),
    'd-sized.svg': () => svg('<svg xmlns="http://www.w3.org/2000/svg" width="80" height="40"><rect width="80" height="40" fill="#e91e63"/><circle cx="20" cy="20" r="14" fill="#fff"/></svg>'),
    'e-viewbox.svg': () => svg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 60"><rect width="30" height="60" fill="#3f51b5"/><rect x="5" y="5" width="20" height="20" fill="#ffeb3b"/></svg>'),
    'f-dot.gif': () => GIF,
    'g-photo.jpg': () => canvasImg(160, 120, 40, null, 'image/jpeg'),
    'h-pic.webp': () => canvasImg(100, 100, 280, null, 'image/webp'),
    'broken.png': () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7]).buffer,
  };
  const PICS = Array.from({ length: 220 }, (_, i) => 'pic-' + String(i + 1).padStart(3, '0') + '.png');
  PICS.forEach((p, i) => { GEN[p] = () => canvasImg(96 + (i % 3) * 32, 72 + (i % 4) * 16, (i * 37) % 360); });
  const e = (name, kind, size) => ({ name, path: HOME + '\\\\' + name, kind, size, mtime: (window.__mt[name] ?? T), mode: null, symlinkTarget: null, linkIsDir: false, hidden: false });
  const entries = () => [
    e('assets', 'dir', 0), e('old', 'dir', 0),
    ...Object.keys(GEN).filter(k => !k.startsWith('pic-')).map((k, i) => e(k, 'file', 3000 + i)),
    e('huge.png', 'file', 25 * 1024 * 1024),
    e('notes.txt', 'file', 1200), e('data.json', 'file', 800),
    ...PICS.map((p, i) => e(p, 'file', 5000 + i)),
  ];
  window.__entryNames = () => entries().map(x => x.name);
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [], load_snippets: null, save_snippets: null,
    load_settings: {}, save_settings: null, host_history_list: {}, projects_list: [],
    git_worktree_list: [], ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    local_home: HOME, local_roots: ['C:\\\\'], local_conflicts: [], local_places: [], local_free_space: null,
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
      if (cmd === 'local_list') return Promise.resolve(args?.path === HOME ? entries() : [e('inner.txt', 'file', 10)].map(x => ({ ...x, path: args.path + '\\\\' + x.name })));
      if (cmd === 'local_stat') {
        const p = String(args?.path ?? HOME); const nm = p.split('\\\\').pop();
        const hit = entries().find(x => x.path === p);
        return Promise.resolve(hit ?? { ...e(nm, 'dir', 0), path: p });
      }
      if (cmd === 'local_read_preview') {
        const p = String(args?.path); const nm = p.split('\\\\').pop();
        window.__reads.push(p);
        window.__inflight++; window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
        return (async () => {
          try {
            await new Promise(r => setTimeout(r, window.__readDelay));
            const g = GEN[nm]; if (!g) throw new Error('stub: no bytes for ' + nm);
            return await g();
          } finally { window.__inflight--; }
        })();
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
const q = (s) => JSON.stringify(s);
const HOME = "C:\\Users\\me\\pics";
const P = (name) => HOME + "\\" + name;
const specs = (kind) => evj(`${importApp("app/tabs.svelte")}.then(async (m) => { const s = await ${importApp("lib/session.ts")}; const out = []; for (const tab of m.residentWindowTabs()) out.push(...s.listPanes(tab.root)); return JSON.stringify(out.filter(p => !${q(kind)} || p.kind === ${q(kind)})); })`);
const BOX = (id) => `document.querySelector('.pane-box[data-pane="' + CSS.escape(${q(id)}) + '"]')`;
const ROW = (name) => `document.querySelector('.pane-box .list .row[data-path="' + CSS.escape(${q(P(name))}) + '"]')`;
const center = async (expr) => evj(`(() => { const el = ${expr}; if (!el) return 'null'; const b = el.getBoundingClientRect(); return JSON.stringify({ x: b.x + b.width / 2, y: b.y + b.height / 2 }); })()`);
const mouse = async (expr, { button = "left", clickCount = 1 } = {}) => {
  let r = await center(expr);
  if (!r) return false;
  // 머리줄 도구는 포인터가 오르면 자리가 바뀔 수 있다 — 올린 뒤 다시 잰다
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  await sleep(120);
  r = (await center(expr)) ?? r;
  if (DEBUG_HIT) console.log("  hit:", await ev(`(() => { const e = document.elementFromPoint(${r.x}, ${r.y}); return e ? e.tagName + '.' + [...e.classList].join('.') + ' in ' + (e.closest('button')?.className ?? '-') : 'none'; })()`));
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
  for (let c = 1; c <= clickCount; c++) {
    await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r.x, y: r.y, button, clickCount: c });
    await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x, y: r.y, button, clickCount: c });
  }
  await sleep(200);
  return true;
};
let DEBUG_HIT = false;
/** 포인터를 목록 안 오른쪽 아래 빈자리로 — 창 오른쪽 끝(채팅 독이 호버로 열리는 띠)에는 두지 않는다 */
const away = async () => {
  const r = await evj(`(() => { const l = document.querySelector('.pane-box .list'); if (!l) return JSON.stringify({ x: 550, y: 400 }); const b = l.getBoundingClientRect(); return JSON.stringify({ x: b.right - 40, y: b.bottom - 6 }); })()`);
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x, y: r.y });
};
const reads = () => evj(`JSON.stringify(window.__reads)`);
/** 읽기가 다 끝나고 `ms` 동안 새 읽기가 없을 때까지 */
const idle = async (ms = 700, timeout = 20000) => {
  const end = Date.now() + timeout; let last = -1, since = Date.now();
  while (Date.now() < end) {
    const s = await evj(`JSON.stringify({ n: window.__reads.length, f: window.__inflight })`);
    if (s.n !== last || s.f > 0) { last = s.n; since = Date.now(); }
    else if (Date.now() - since >= ms) return true;
    await sleep(100);
  }
  return false;
};
let paneId = null;
const pickView = async (view) => {
  await mouse(`(${BOX(paneId)}).querySelector('[data-file-view-pick]')`);
  await sleep(150);
  const ok = await mouse(`document.querySelector('[data-toolbar-menu] [data-menu-key="${view}"]')`);
  await sleep(250);
  return ok;
};
const setZoom = async (level) => {
  await ev(`(() => { const i = (${BOX(paneId)}).querySelector('.zoom input'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(i, ${level}); i.dispatchEvent(new Event('input', { bubbles: true })); i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await sleep(300);
};
/** 그림 칸 표 — 이름 · 썸네일 · 글리프 · 배지 · dim */
const cells = () => evj(`JSON.stringify([...document.querySelectorAll('.pane-box .list .row')].map(r => {
  const img = r.querySelector('img.thumb'); const g = r.querySelector('.glyph.big'); const svg = g?.querySelector('svg');
  const ib = img?.getBoundingClientRect(); const sb = svg?.getBoundingClientRect();
  return { name: r.querySelector('.name')?.textContent.trim(), img: !!img, src: img?.getAttribute('src') ?? null, nw: img?.naturalWidth ?? 0, nh: img?.naturalHeight ?? 0,
    complete: img?.complete ?? null, iw: ib ? Math.round(ib.width * 10) / 10 : null, ih: ib ? Math.round(ib.height * 10) / 10 : null, fit: img ? getComputedStyle(img).objectFit : null,
    drag: img ? img.draggable : null, svg: !!svg, sw: sb ? Math.round(sb.width * 10) / 10 : null, badge: r.querySelector('.badge')?.textContent.trim() ?? null,
    dim: !!g?.classList.contains('dim'), op: g ? Number(getComputedStyle(g).opacity) : null, rowDrag: r.getAttribute('draggable') };
}))`);
const by = (list, n) => list.find((c) => c.name === n) ?? {};

// ── 시작 ─────────────────────────────────────────────────────────────────────
await reloadBoot(send, ev);
await ev(`${importApp("app/panes.svelte")}.then(m => m.openLocalFsPaneHere())`); await sleep(1500);
paneId = (await specs("localfs"))?.[0]?.id ?? null;
check(!!paneId, `로컬 파일 타일이 선다 (${paneId})`);
const total = await ev(`document.querySelectorAll('.pane-box .list .row').length`);
console.log(`  줄 ${total}개`);
check((await reads()).length === 0, "자세히 보기에서는 읽지 않는다");

// ── ⑤ · ⑥ 아이콘 보기로 — 보이는 칸만 · 동시 ≤ 3 · 읽는 중 dim ─────────────
await ev(`window.__readDelay = 250`);
check(await pickView("icons"), "보기 고르개 → 아이콘");
await sleep(480);
const loading = await cells();
const dimmed = loading.filter((c) => c.dim);
console.log(`  읽는 중 dim 칸 ${dimmed.length} · 예: ${dimmed.slice(0, 3).map((c) => `${c.name}=${c.op}`).join(", ")}`);
check(dimmed.length > 0 && dimmed.every((c) => !c.img && c.op < 0.9), `⑥ 읽는 중 칸의 글리프에 dim (칸 ${dimmed.length} · 불투명도 ${dimmed[0]?.op})`);
check(by(loading, "notes.txt").dim === false && by(loading, "assets").dim === false && by(loading, "huge.png").dim === false, "⑥ 그림 아닌 칸 · huge 에는 dim 없음");
await away();
await shot("thumbs-loading.png");
check(await idle(), "읽기가 가라앉는다");
const firstReads = await reads();
// 처음 화면 — 목록 상자 ± 64px 안의 그림 칸만 읽었어야 한다
const geo = await evj(`(() => { const l = document.querySelector('.pane-box .list'); const lb = l.getBoundingClientRect();
  return JSON.stringify({ top: lb.top, bottom: lb.bottom, scrollH: l.scrollHeight, clientH: l.clientHeight,
    rows: [...l.querySelectorAll('.row')].map(r => { const b = r.getBoundingClientRect(); return { path: r.dataset.path, top: b.top, bottom: b.bottom }; }) }); })()`);
const near = new Set(geo.rows.filter((r) => r.bottom >= geo.top - 64 && r.top <= geo.bottom + 64).map((r) => r.path));
const imgNames = (await evj(`JSON.stringify(window.__entryNames())`)).filter((n) => /\.(png|jpe?g|gif|webp|bmp|svg|ico)$/i.test(n) && n !== "huge.png");
const farImgs = imgNames.map(P).filter((p) => !near.has(p));
console.log(`  목록 높이 ${geo.clientH} / 스크롤 ${geo.scrollH} · 처음 읽음 ${firstReads.length} · 화면 밖 그림 ${farImgs.length}`);
check(geo.scrollH > geo.clientH + 100 && farImgs.length > 0, "스크롤이 생기고 화면 밖 그림 칸이 있다");
check(firstReads.every((p) => near.has(p)), `⑤ 처음에는 보이는 칸(±64px)만 읽었다 (밖: ${firstReads.filter((p) => !near.has(p)).map((p) => p.split("\\").pop()).join(",") || "없음"})`);
check(farImgs.every((p) => !firstReads.includes(p)), "⑤ 화면 밖 칸의 경로를 읽지 않았다");
check(new Set(firstReads).size === firstReads.length, `⑤ 같은 경로를 두 번 읽지 않았다`);

// ── ① · ② · ③ · ④ ─────────────────────────────────────────────────────────
let c = await cells();
const visImgs = c.filter((x) => imgNames.includes(x.name) && near.has(P(x.name)) && x.name !== "broken.png");
const glyphW = by(c, "notes.txt").sw;
const cssBox = await evj(`(() => { const l = document.querySelector('.pane-box .list'); const cs = getComputedStyle(l); const s = parseFloat(cs.getPropertyValue('--icon-scale')); const d = document.createElement('div'); d.style.width = 'var(--tile-icon-size)'; l.appendChild(d); const w = d.getBoundingClientRect().width; d.remove(); return JSON.stringify({ s, w, box: w * s }); })()`);
console.log(`  글리프 상자 ${glyphW} · CSS ${cssBox.w} × ${cssBox.s} = ${cssBox.box} · 보이는 그림 칸 ${visImgs.length}`);
check(visImgs.length > 0 && visImgs.every((x) => x.img && x.nw > 0 && String(x.src).startsWith("blob:")), `① 보이는 그림 칸마다 img.thumb · blob: · naturalWidth > 0 (빠진 것: ${visImgs.filter((x) => !(x.img && x.nw > 0)).map((x) => x.name).join(",") || "없음"})`);
check(visImgs.every((x) => Math.abs(x.iw - cssBox.box) < 0.6 && Math.abs(x.ih - cssBox.box) < 0.6) && Math.abs(glyphW - cssBox.box) < 0.6, `① 상자 = 글리프 크기 (${visImgs[0]?.iw}×${visImgs[0]?.ih} · 글리프 ${glyphW})`);
check(visImgs.every((x) => x.fit === "contain"), "① object-fit: contain");
const wide = by(c, "a-wide.png"), tall = by(c, "b-tall.png");
check(wide.nw > 0 && Math.abs(wide.nw / wide.nh - 3) < 0.1 && tall.nh > 0 && Math.abs(tall.nw / tall.nh - 1 / 3) < 0.05, `① 비율 유지 (가로 ${wide.nw}×${wide.nh} · 세로 ${tall.nw}×${tall.nh})`);
for (const n of ["c-alpha.png", "d-sized.svg", "e-viewbox.svg", "f-dot.gif", "g-photo.jpg", "h-pic.webp"]) {
  const x = by(c, n);
  check(x.img === true && x.nw > 0, `① ${n} 썸네일 (${x.nw}×${x.nh})`);
}
check(visImgs.every((x) => x.name === by(c, x.name).name) && by(c, "a-wide.png").badge === "PNG" && by(c, "d-sized.svg").badge === "SVG", `② 확장자 배지 그대로 (${by(c, "a-wide.png").badge} · ${by(c, "d-sized.svg").badge} · ${by(c, "g-photo.jpg").badge})`);
check(by(c, "a-wide.png").name === "a-wide.png", "② 이름 그대로");
check(!by(c, "notes.txt").img && by(c, "notes.txt").svg && !by(c, "assets").img && by(c, "assets").svg && !by(c, "data.json").img, "② 그림 아닌 파일 · 폴더 = 글리프");
check(!by(c, "huge.png").img && by(c, "huge.png").svg && !firstReads.includes(P("huge.png")), "③ huge.png = 글리프 · 읽기 없음");
check(!by(c, "broken.png").img && by(c, "broken.png").svg && by(c, "broken.png").dim === false, "④ broken.png = 글리프 · dim 풀림");
await away(); await sleep(200);
await shot("thumbs-dark.png");

// ── ⑤ 스크롤 → 그때 읽기 · ④ 다시 들어와도 다시 안 읽음 · 동시 수 ────────────
await ev(`(() => { const l = document.querySelector('.pane-box .list'); l.scrollTop = l.scrollHeight; })()`);
await sleep(300);
check(await idle(), "스크롤 뒤 읽기가 가라앉는다");
const afterScroll = await reads();
const lateRead = afterScroll.slice(firstReads.length);
check(lateRead.length > 0 && lateRead.every((p) => farImgs.includes(p)), `⑤ 스크롤하면 그때 읽는다 (새로 ${lateRead.length}개 — 모두 처음 화면 밖)`);
await ev(`(() => { const l = document.querySelector('.pane-box .list'); l.scrollTop = 0; })()`);
await sleep(300); await idle();
const afterBack = await reads();
const brokenN = afterBack.filter((p) => p === P("broken.png")).length;
check(brokenN === 1, `④ broken.png 는 한 번만 읽는다 (${brokenN})`);
check(afterBack.length === afterScroll.length, `④ · ⑤ 다시 스크롤해 들어와도 다시 읽지 않는다 (추가 ${afterBack.length - afterScroll.length})`);
check(!afterBack.includes(P("huge.png")), "③ 스크롤 뒤에도 huge.png 읽기 없음");
const maxIn = await ev(`window.__maxInflight`);
check(maxIn >= 1 && maxIn <= 3, `⑤ 동시에 읽는 수 ≤ 3 (최대 ${maxIn})`);
await ev(`window.__readDelay = 0`);

// ── ⑦ 새로고침 · ⑫ ⟳ 회전 ──────────────────────────────────────────────────
const locBtn = `(${BOX(paneId)}).querySelector('.loc-btn')`;
const spinState = () => evj(`(() => { const b = ${locBtn}; const s = b?.querySelector('svg'); return JSON.stringify({ spinning: !!b?.classList.contains('spinning'), anim: s ? getComputedStyle(s).animationName : null, inHead: !!b?.closest('.pane-head') }); })()`);
let r0 = (await reads()).length;
let st0 = await spinState();
check(st0?.spinning === false, `⑫ 처음엔 돌지 않는다 (${JSON.stringify(st0)})`);
await mouse(locBtn);
const stOn = await spinState();
check(stOn?.spinning === true && stOn?.anim?.endsWith("loc-spin") === true, `⑫ ⟳ 누르면 .spinning · animation-name loc-spin (${JSON.stringify(stOn)}) — 머리줄 안: ${stOn?.inHead}`);
check(stOn?.inHead === true, "⑫ 기본 배치 = 도구줄이 머리줄로 접힘(.pane-head 안의 ⟳)");
await sleep(1200);
const stOff = await spinState();
check(stOff?.spinning === false, `⑫ 1.2초쯤 뒤 풀린다 (${JSON.stringify(stOff)})`);
await idle(500);
const d7a = (await reads()).length - r0;
check(d7a === 0, `⑦ 같은 폴더 새로고침 — 다시 읽지 않는다 (추가 ${d7a})`);
await ev(`window.__mt['a-wide.png'] = 1758700100`);
r0 = (await reads()).length;
await mouse(locBtn); await sleep(400); await idle(500);
const d7b = (await reads()).slice(r0);
check(d7b.length === 1 && d7b[0] === P("a-wide.png"), `⑦ mtime 바꾼 파일만 다시 읽는다 (${d7b.map((p) => p.split("\\").pop()).join(",") || "없음"})`);
await sleep(1000);
check(by(await cells(), "a-wide.png").img === true, "⑦ 다시 읽은 칸에 썸네일");

// ── ⑧ 보기 왕복 ────────────────────────────────────────────────────────────
r0 = (await reads()).length;
const before8 = (await cells()).filter((x) => x.img).length;
await pickView("details");
const det = await ev(`(${BOX(paneId)}).querySelectorAll('img.thumb').length`);
await pickView("compact");
const cmp = await ev(`(${BOX(paneId)}).querySelectorAll('img.thumb').length`);
check(det === 0 && cmp === 0, `⑧ 자세히 · 간단히 보기 = img.thumb 없음 (${det} · ${cmp})`);
await pickView("icons");
await sleep(100);
const back8 = (await cells()).filter((x) => x.img).length;
await idle(500);
const d8 = (await reads()).length - r0;
check(back8 > 0 && back8 >= before8 - 1 && d8 === 0, `⑧ 아이콘 보기로 돌아오면 캐시에서 곧바로 (썸네일 ${back8}/${before8} · 추가 읽기 ${d8})`);

// ── ⑨ 확대 단계 ────────────────────────────────────────────────────────────
const zoom0 = await ev(`(${BOX(paneId)}).querySelector('.zoom input')?.value ?? null`);
const zmax = await ev(`(${BOX(paneId)}).querySelector('.zoom input')?.max ?? null`);
console.log(`  확대 단계 ${zoom0} / 최대 ${zmax}`);
r0 = (await reads()).length;
const w0 = by(await cells(), "c-alpha.png").iw;
await setZoom(zmax);
await idle(500);
c = await cells();
const w1 = by(c, "c-alpha.png").iw;
const box1 = await evj(`(() => { const l = document.querySelector('.pane-box .list'); const s = parseFloat(getComputedStyle(l).getPropertyValue('--icon-scale')); return s; })()`);
const d9 = (await reads()).length - r0;
check(w1 > w0 && Math.abs(w1 - by(c, "notes.txt").sw) < 0.6, `⑨ 확대 최대 — 그림 상자가 글리프와 함께 커진다 (${w0} → ${w1} · 글리프 ${by(c, "notes.txt").sw} · 배율 ${box1})`);
check(d9 === 0, `⑨ 확대 — 추가 읽기 없음 (${d9})`);
await away(); await sleep(200);
await shot("thumbs-zoom-max.png");
await setZoom(zoom0);

// ── ⑫ 폴더 이동은 돌지 않음 · 메뉴 새로고침 · 몸 배치 ────────────────────
const sampleSpin = async (ms) => { const seen = []; const end = Date.now() + ms; while (Date.now() < end) { seen.push((await spinState())?.spinning); await sleep(40); } return seen; };
await mouse(ROW("assets"), { clickCount: 2 });
const navSeen = await sampleSpin(600);
const cwdNow = await ev(`(${BOX(paneId)}).querySelector('.crumb.current')?.textContent.trim()`);
check(cwdNow === "assets" && navSeen.every((x) => x === false), `⑫ 폴더로 들어갈 때는 돌지 않는다 (지금 ${cwdNow} · 표본 ${navSeen.length})`);
await mouse(`[...(${BOX(paneId)}).querySelectorAll('.crumb')].find(b => b.textContent.trim() === 'pics')`);
const upSeen = await sampleSpin(500);
check(upSeen.every((x) => x === false), "⑫ 조각으로 위 폴더로 돌아갈 때도 돌지 않는다");
await sleep(600); await idle(500);
await ev(`(() => { const l = (${BOX(paneId)}).querySelector('.list'); const b = l.getBoundingClientRect(); l.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.right - 20, clientY: b.bottom - 10 })); })()`);
await sleep(250);
const menuRefresh = await ev(`(() => { const b = [...document.querySelectorAll('.ctx-menu .ctx-item')].find(b => b.textContent.trim() === '새로고침'); if (!b) return false; b.click(); return true; })()`);
await sleep(60);
const stMenu = await spinState();
check(menuRefresh === true && stMenu?.spinning === true && stMenu?.anim?.endsWith("loc-spin") === true, `⑫ 우클릭 메뉴의 새로고침으로도 돈다 (${menuRefresh} · ${JSON.stringify(stMenu)})`);
await sleep(1300);
check((await spinState())?.spinning === false, "⑫ 메뉴 새로고침 뒤에도 바퀴 끝에서 멈춘다");
await ev(`${importApp("settings.svelte")}.then(m => m.setTileHeader('never'))`); await sleep(500);
const stBody0 = await spinState();
await mouse(locBtn);
const stBody = await spinState();
check(stBody0?.inHead === false && stBody?.spinning === true && stBody?.anim?.endsWith("loc-spin") === true, `⑫ 머리줄 없는 배치(몸 맨 위 도구줄)에서도 돈다 (${JSON.stringify(stBody)})`);
await sleep(1300);
check((await spinState())?.spinning === false, "⑫ 몸 배치에서도 멈춘다");
await ev(`${importApp("settings.svelte")}.then(m => m.setTileHeader('always'))`); await sleep(500);
check((await spinState())?.inHead === true, "⑫ 머리줄 배치로 되돌림");
await idle(500);

// ── ⑩ 클릭 · 더블클릭 · 우클릭 · draggable ─────────────────────────────────
c = await cells();
const pick = by(c, "c-alpha.png");
check(pick.img === true && pick.drag === false && pick.rowDrag === "true", `⑩ img draggable=false · .row draggable 그대로 (${pick.drag} · ${pick.rowDrag})`);
await mouse(`(${ROW("c-alpha.png")}).querySelector('img.thumb')`);
check((await ev(`!!(${ROW("c-alpha.png")})?.classList.contains('selected')`)) === true, "⑩ 그림 칸 클릭 = .row.selected");
const before10 = (await specs(""))?.length ?? 0;
await mouse(`(${ROW("c-alpha.png")}).querySelector('img.thumb')`, { clickCount: 2 });
await sleep(900);
const all10 = (await specs("")) ?? [];
const opened = all10.filter((p) => p.kind === "image");
console.log(`  더블클릭 뒤 타일 ${before10} → ${all10.length} · ${all10.map((p) => p.kind).join(",")}`);
check(opened.length === 1, `⑩ 더블클릭 = 이미지 타일 열기 (${opened.map((p) => JSON.stringify(p.path ?? p.file ?? "")).join(",")})`);
await ev(`(() => { const r = ${ROW("c-alpha.png")}; const b = r.getBoundingClientRect(); r.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: b.x + b.width / 2, clientY: b.y + b.height / 2 })); })()`);
await sleep(250);
const menuTitle = await ev(`document.querySelector('.ctx-menu .ctx-title')?.textContent.trim() ?? null`);
const menuN = await ev(`document.querySelectorAll('.ctx-menu .ctx-item').length`);
check(menuN > 0, `⑩ 우클릭 메뉴가 열린다 (제목 ${menuTitle} · 항목 ${menuN})`);
await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
await sleep(200);
await ev(`document.querySelector('.menu-backdrop')?.click()`);
await sleep(200);
for (const p of opened) await ev(`${importApp("app/tabs.svelte")}.then(m => { const t = m.residentWindowTabs().find(t => JSON.stringify(t.root).includes(${q(`"id":"${p.id}"`)})); return m.closePaneIn(t.id, ${q(p.id)}); })`);
await sleep(500);

// ── ⑬ 라이트 ─────────────────────────────────────────────────────────────────
await ev(`(async () => { const m = await ${importApp("mode.svelte.ts")}; m.setAppMode('light'); })()`); await sleep(600);
c = await cells();
check(by(c, "a-wide.png").img === true && by(c, "c-alpha.png").img === true, "⑬ 라이트 — 썸네일 그대로");
await away(); await sleep(200);
await shot("thumbs-light.png");

// ── ⑪ 타일 닫기 → Blob URL 거둠 ─────────────────────────────────────────────
const blobsOpen = await evj(`JSON.stringify((() => { const o = {}; for (const [u, b] of window.__blobs) { const k = b.type || '(none)'; o[k] ??= { made: 0, revoked: 0 }; o[k].made++; if (b.revoked) o[k].revoked++; } return o; })())`);
console.log(`  닫기 전 Blob: ${JSON.stringify(blobsOpen)}`);
const imgsLive = await ev(`(${BOX(paneId)}).querySelectorAll('img.thumb').length`);
await ev(`${importApp("app/tabs.svelte")}.then(m => { const t = m.residentWindowTabs().find(t => JSON.stringify(t.root).includes(${q(`"id":"${paneId}"`)})); return m.closePaneIn(t.id, ${q(paneId)}); })`);
await sleep(800);
const blobs = await evj(`JSON.stringify((() => { const o = { made: 0, revoked: 0, live: [] , byType: {} }; for (const [u, b] of window.__blobs) { o.made++; if (b.revoked) o.revoked++; else o.live.push(b.type); const k = b.type || '(none)'; o.byType[k] ??= { made: 0, revoked: 0 }; o.byType[k].made++; if (b.revoked) o.byType[k].revoked++; } return o; })())`);
console.log(`  닫은 뒤 Blob: 만든 ${blobs.made} · 거둔 ${blobs.revoked} · 남음 ${JSON.stringify(blobs.live)} · ${JSON.stringify(blobs.byType)}`);
check((await specs("localfs"))?.length === 0, "⑪ 파일 타일이 닫혔다");
check(imgsLive > 0 && blobs.made > 0 && blobs.made === blobs.revoked, `⑪ 만든 Blob URL 수 = 거둔 수 (${blobs.made} / ${blobs.revoked})`);

check(errors.length === 0, `⑬ 콘솔 예외 0 (${errors.join(" / ").slice(0, 300)})`);
console.log(`  console.error ${consoleErrors.length}${consoleErrors.length ? ": " + consoleErrors.slice(0, 5).join(" / ") : ""}`);
console.log(failed ? `\n${failed} FAIL` : "\nALL PASS");
ws.close();
process.exit(failed ? 1 : 0);
