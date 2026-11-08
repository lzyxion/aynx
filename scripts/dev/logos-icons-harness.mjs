// Headless harness: **logos 전체 아이콘** (docs/log/2026-09-29-logos-full-icons.md).
// `hosts-tree-harness.mjs` 의 사본 — 스텁의 호스트 표와 시나리오만 다르다.
//
//   npx vite --port 1430 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9231 --user-data-dir=%TEMP%/edge-aynx-logos \
//     --window-size=1100,800 http://localhost:1430/
//   PAGE_PORT=1430 node scripts/dev/logos-icons-harness.mjs outdir 9231
//
// 심어 두는 것: web-01(`svg:ubuntu` — 큐레이션) · db-01(`svg:logos:mariadb-icon` — 이미 logos 전체를
// 쓰는 호스트) · lab-01(아이콘 없음) · nas-01(아이콘 없음, 색 `#e5484d` — lucide 가 입을 호스트 색). `set_host_meta` 스텁은 호스트 표의 아이콘을 실제로 바꾼다.
//
// 보는 것: ① 독의 db-01 줄이 표를 늦게 받아 로고로 선다(받은 파일 = 별도 JSON 한 벌, 한 번) ② lab-01 편집 폼
// 표시 탭 — 빈 칸 격자 = 큐레이션 34 ③ `mongodb` → logos 결과 · Enter = `svg:logos:mongodb-icon` (정사각 표장이 글씨 로고보다 먼저) · 칸에 이름
// ④ `a` 한 글자 = 200칸 + "N개 더" 한 줄 ⑤ 저장 → `set_host_meta` 의 icon · 독의 lab-01 줄이 그 로고.
// ⑥ lucide("기본" 칸, 같은 로그의 Lucide 절): nas-01 폼 — 로고 칸에서 `hard-drive` = 이모지로 안 떨어지고
// "기본에서 N개" · 기본 칸 빈 격자 = 고른 24 · `database` → Enter = `svg:lucide:database` · 미리보기가 호스트 색 ·
// 저장 → 독의 nas-01 줄이 **호스트 색 획**의 선 아이콘(굵기 1.75) · lab-01 폼을 다시 열면 기본 칸이 기억된다.
// 콘솔 예외 0. PNG: `logos-dock.png` · `logos-search.png` · `logos-more.png` · `logos-saved.png` ·
// `lucide-featured.png` · `lucide-dock.png`.
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
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
await send("Page.enable"); await send("Runtime.enable");
const errors = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"); });

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  performance.setResourceTimingBufferSize(5000);
  try { localStorage.removeItem('aynx:dock'); localStorage.removeItem('aynx:status-order'); } catch {}
  const host = (name, ip, icon, color = null) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon, color, group: null } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const hosts = [host('web-01', '10.0.0.1', 'svg:ubuntu'), host('db-01', '10.0.1.1', 'svg:logos:mariadb-icon'), host('lab-01', '192.168.0.9', null), host('nas-01', '192.168.0.20', null, '#e5484d')];
  window.__fake = { hosts };
  const answers = {
    list_hosts: { hosts, warnings: [] },
    list_group_meta: {}, list_host_meta: {}, edit_host: [], rename_group: null, set_group_meta: null,
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
    
    load_snippets: null,   save_snippets: null, 
    load_settings: {}, save_settings: null, host_history_list: {}, projects_list: [],
    git_worktree_list: [], ssh_remote_home: '/root', session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null, write_session: null, write_ssh: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_has_password: false, vault_has_passphrase: false,
    mcp_status: { clis: [] }, delegation_list_targets: [], session_logs_dir: 'C:\\\\logs', home_dir: 'C:\\\\Users\\\\wl',
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      if (cmd === 'get_host_meta') { const h = hosts.find((x) => x.name === args?.name); return Promise.resolve({ ...META, icon: h?.meta.icon ?? null, color: h?.meta.color ?? null }); }
      // 저장이 실제로 호스트 표를 바꾼다 — 다시 읽은 목록에 새 아이콘이 서야 한다
      if (cmd === 'set_host_meta') { const h = hosts.find((x) => x.name === args?.name); if (h && args.patch && 'icon' in args.patch) h.meta.icon = args.patch.icon; return Promise.resolve(null); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });

const key = async (code, modifiers = 0, k = code, wait = 250) => { const VK = { Enter: 13 }; const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(wait); };
await send("Page.reload", { ignoreCache: true }); await sleep(4500);

// 표 파일 자체의 요청만 센다 — 개발 서버에서는 `?url` 가져오기(주소 한 줄짜리 모듈)도 같은 이름으로 뜬다
const logosFetched = `performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes('host-icons-logos') && !n.includes('?')).length`;

// ── ① 독 — db-01 줄이 logos 로고로 선다 ─────────────────────────────────────
if ((await ev(`document.querySelector('.dock')?.hidden ?? true`)) === true) await key("KeyH", 10, "H", 800);
await sleep(1500);
const rowSvg = (id) => ev(`(() => { const r = document.querySelector('.dock .sidebar [data-id="h:${id}"]'); if (!r) return 'no row'; const s = r.querySelector('svg.logo'); return s ? s.getAttribute('viewBox') + ' ' + s.innerHTML.length : (r.querySelector('.waiting') ? 'waiting' : 'none'); })()`);
const db = await rowSvg("db-01");
console.log("db-01 row:", db);
check(typeof db === "string" && db.startsWith("0 0 ") && Number(db.split(" ").at(-1)) > 100, "db-01 줄에 mariadb-icon 로고가 그려진다");
check((await ev(logosFetched)) === 1, "logos 표를 한 번 받는다 (별도 JSON 파일)");
console.log("web-01 row:", await rowSvg("web-01"));
console.log("capture:", await shot("logos-dock.png"));

// ── ② lab-01 편집 폼 — 표시 탭 ───────────────────────────────────────────────
const H = `window.__H`;
await ev(`(async () => { const u = performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('/src/lib/app/hosts.svelte.ts')); window.__H = await import(u); return 'ok'; })()`);
console.log("openEdit:", await ev(`(async () => { await ${H}.openEdit(window.__fake.hosts[2]); return 'ok'; })()`)); await sleep(700);
console.log("tab:", await ev(`(() => { const b = [...document.querySelectorAll('.host-modal .nav-item')][1]; b?.click(); return b?.textContent.trim(); })()`)); await sleep(300);
const typeIcon = (s) => ev(`(() => { const i = document.getElementById('f-icon'); i.focus(); i.value = ${JSON.stringify(s)}; i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`);
const gridState = `(() => {
  const g = document.querySelector('.icon-field .grid');
  const picks = [...g.querySelectorAll('.pick')];
  return { picks: picks.length, drawn: g.querySelectorAll('svg.logo').length,
    hintTitle: picks.find(b => b.classList.contains('hint'))?.title ?? null,
    firstTitles: picks.slice(0, 4).map(b => b.title),
    notes: [...document.querySelectorAll('.icon-field .nomatch')].map(p => p.textContent.trim()) };
})()`;
const g0 = await ev(gridState);
console.log("grid (empty):", JSON.stringify(g0));
check(g0.picks === 34 && g0.notes.length === 0, "빈 칸 = 큐레이션 34칸, 안내 없음");

// ── ③ mongodb ────────────────────────────────────────────────────────────────
await typeIcon("mongodb"); await sleep(400);
const g1 = await ev(gridState);
console.log("grid (mongodb):", JSON.stringify(g1));
check(g1.picks === 2 && g1.hintTitle === "mongodb-icon" && g1.drawn === 2, "mongodb → logos 두 칸, 정사각 표장(mongodb-icon)이 첫 칸 = 힌트");
console.log("capture:", await shot("logos-search.png"));
await key("Enter", 0, "Enter", 400);
const picked = await ev(`${H}.hostForm.icon`);
console.log("picked:", JSON.stringify(picked));
check(picked === "svg:logos:mongodb-icon", "Enter = svg:logos:mongodb-icon");
check((await ev(`document.getElementById('f-icon').value`)) === "mongodb-icon", "칸에는 logos 이름");
check((await ev(`!!document.querySelector('.icon-field .preview svg.logo')`)) === true, "미리보기가 그 로고");

// ── ④ 한 글자 = 상한 ────────────────────────────────────────────────────────
await typeIcon("a"); await sleep(600);
const g2 = await ev(gridState);
console.log("grid (a):", JSON.stringify({ ...g2, firstTitles: g2.firstTitles }));
check(g2.picks === 200 && g2.notes.length === 1 && /\d/.test(g2.notes[0]), "a → 200칸 + 'N개 더' 한 줄");
console.log("capture:", await shot("logos-more.png"));
// 검색 중에는 값이 그대로다 (칸 = 검색 — 값은 Enter·클릭만 바꾼다)
check((await ev(`${H}.hostForm.icon`)) === "svg:logos:mongodb-icon", "검색 중에는 값이 안 바뀐다");

// ── ⑤ 저장 → 독 줄 ──────────────────────────────────────────────────────────
await ev(`(document.querySelector('.host-modal form').requestSubmit(), 'submitted')`); await sleep(1200);
const saved = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'set_host_meta').map(c => c[1]))`);
console.log("set_host_meta:", saved);
check(saved.includes('svg:logos:mongodb-icon'), "set_host_meta 가 svg:logos:mongodb-icon 을 싣는다");
await sleep(800);
const lab = await rowSvg("lab-01");
console.log("lab-01 row:", lab);
check(typeof lab === "string" && lab.startsWith("0 0 "), "lab-01 줄에 mongodb 로고가 선다");
console.log("capture:", await shot("logos-saved.png"));

// ── ⑥ lucide — "기본" 칸 ─────────────────────────────────────────────────────
const lucideFetched = `performance.getEntriesByType('resource').map(r => r.name).filter(n => n.includes('host-icons-lucide') && !n.includes('?')).length`;
console.log("openEdit nas-01:", await ev(`(async () => { await ${H}.openEdit(window.__fake.hosts[3]); return 'ok'; })()`)); await sleep(700);
console.log("tab:", await ev(`(() => { const b = [...document.querySelectorAll('.host-modal .nav-item')][1]; b?.click(); return b?.textContent.trim(); })()`)); await sleep(300);
const segState = `(() => [...document.querySelectorAll('.icon-field [data-icon-seg]')].map(b => b.dataset.iconSeg + (b.classList.contains('on') ? '*' : '') + ':' + b.textContent.trim()).join(' '))()`;
const s0 = await ev(segState);
console.log("segments:", s0);
check(s0 === "basic:기본 logos*:로고", "두 칸 스위치 — 기본/로고 차례(2026-09-29), 처음엔 로고가 켜져 있다");
check((await ev(lucideFetched)) === 1, "고르개가 열리면 lucide 표를 한 번 받는다 (별도 JSON)");
// 로고 칸에서 lucide 에만 있는 이름 — 값이 이모지(글자)로 떨어지지 않고 "기본에서 N개" 가 뜬다
await typeIcon("hard-drive"); await sleep(400);
const other = await ev(`(() => { const o = document.querySelector('.icon-field [data-icon-other]'); return o ? o.dataset.iconOther + ' ' + o.textContent.trim() : null; })()`);
console.log("other:", other);
check(typeof other === "string" && other.startsWith("basic 기본에서 "), "로고 칸에서 hard-drive → '기본에서 N개'");
check((await ev(`${H}.hostForm.icon`)) === "" && (await ev(gridState)).notes.length === 0, "다른 칸에 걸리면 이모지로 떨어지지 않는다 (값 그대로 · 안내 없음)");
// 링크를 누르면 기본 칸 + 같은 검색어
await ev(`(document.querySelector('.icon-field [data-icon-other]').click(), 'ok')`); await sleep(300);
const g3 = await ev(gridState);
console.log("grid (basic, hard-drive):", JSON.stringify(g3));
check((await ev(segState)).includes("basic*") && g3.hintTitle === "hard-drive", "링크 → 기본 칸, hard-drive 가 첫 칸");
// 빈 칸 = 고른 24
await typeIcon(""); await sleep(300);
const g4 = await ev(gridState);
console.log("grid (basic, empty):", JSON.stringify(g4));
check(g4.picks === 24 && g4.drawn === 24 && g4.firstTitles[0] === "server" && g4.firstTitles[1] === "database", "기본 칸 빈 격자 = 고른 24칸 (server · database …)");
check((await ev(`document.querySelectorAll('.icon-field .grid svg.logo.line').length`)) === 24, "격자의 24칸이 전부 선 아이콘(.line)");
console.log("capture:", await shot("lucide-featured.png"));
await typeIcon("database"); await sleep(400);
const g5 = await ev(gridState);
console.log("grid (basic, database):", JSON.stringify(g5));
check(g5.hintTitle === "database" && g5.picks > 1, "database → 첫 칸 database");
await key("Enter", 0, "Enter", 400);
check((await ev(`${H}.hostForm.icon`)) === "svg:lucide:database", "Enter = svg:lucide:database");
check((await ev(`document.getElementById('f-icon').value`)) === "database", "칸에는 lucide 이름");
const pv = await ev(`(() => { const s = document.querySelector('.icon-field .preview svg.logo.line'); return s ? getComputedStyle(s).color : null; })()`);
console.log("preview color:", pv);
check(pv === "rgb(229, 72, 77)", "미리보기가 호스트 색(#e5484d)");
await ev(`(document.querySelector('.host-modal form').requestSubmit(), 'submitted')`); await sleep(1200);
const saved2 = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'set_host_meta' && c[1]?.name === 'nas-01').map(c => c[1]))`);
console.log("set_host_meta nas-01:", saved2);
check(saved2.includes("svg:lucide:database"), "set_host_meta 가 svg:lucide:database 를 싣는다");
await sleep(800);
const nas = await ev(`(() => { const r = document.querySelector('.dock .sidebar [data-id="h:nas-01"]'); if (!r) return 'no row'; const s = r.querySelector('svg.logo.line'); if (!s) return r.querySelector('.waiting') ? 'waiting' : 'none'; const p = s.querySelector('path, rect, ellipse, circle'); const cs = getComputedStyle(p); return { color: getComputedStyle(s).color, stroke: cs.stroke, width: cs.strokeWidth }; })()`);
console.log("nas-01 row:", JSON.stringify(nas));
check(nas && nas.stroke === "rgb(229, 72, 77)" && nas.width === "1.75px", "독의 nas-01 줄 = 호스트 색 획 · 굵기 1.75");
const lab2 = await rowSvg("lab-01");
check(typeof lab2 === "string" && lab2.startsWith("0 0 "), "logos 쪽(lab-01 mongodb)도 그대로 선다");
// 캡처용 — 모달이 닫히면 독이 접혀 있을 수 있다(줄은 DOM 에 있어 위 검사는 선다). 호스트 독을 펼쳐 찍는다.
await ev(`(async () => { const u = performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('/src/lib/app/dock.svelte.ts')); const m = await import(u); m.openDock('hosts'); return 'ok'; })()`); await sleep(700);
console.log("capture:", await shot("lucide-dock.png"));
// 칸 기억 — 아이콘 없는 호스트 폼을 다시 열면 기본 칸
await ev(`(async () => { ${H}.hostForm.icon = ''; await ${H}.openEdit({ ...window.__fake.hosts[2], name: 'tmp-01', meta: { ...window.__fake.hosts[2].meta, icon: null } }); return 'ok'; })()`); await sleep(700);
await ev(`(() => { const b = [...document.querySelectorAll('.host-modal .nav-item')][1]; b?.click(); return 'ok'; })()`); await sleep(300);
const s1 = await ev(segState);
console.log("segments (reopen, no icon):", s1);
check(s1.includes("basic*"), "아이콘 없는 폼을 다시 열면 마지막 칸(기본)");

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" | ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
