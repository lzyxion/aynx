// Headless harness: **폴더 편집 · 프로젝트 폼 세 면 · 기본 아이콘** (docs/log/2026-09-29-folder-project-icons.md).
// 스텁은 `logos-icons-harness.mjs` · `project-start-harness.mjs` 의 사본을 줄인 것.
//
//   npx vite --port 1430 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9231 --user-data-dir=%TEMP%/edge-aynx-fp \
//     --window-size=1200,900 http://localhost:1430/
//   PAGE_PORT=1430 node scripts/dev/folder-project-icons-harness.mjs outdir 9231
//
// 심어 두는 것: 폴더 `prod`(호스트 web-01) · 빈 폴더 `lab`(그룹 메타 `📁` 뿐) · 최상위 호스트 dev-01(아이콘·색 없음) ·
// 로컬 프로젝트 `aynx` · 원격 프로젝트 `api`(둘 다 아이콘 없음). `set_group_meta` · `rename_group` · `project_upsert` 스텁은
// 표를 실제로 바꾼다(다시 읽으면 새 값이 선다).
//
// 보는 것:
// ① 기본 아이콘 — 호스트 독의 폴더(기본 폴더) · 색 없는 호스트(기본 서버 랙)가 **같은 테마 색**(`--folder`) ·
//   프로젝트 독의 아이콘 없는 두 줄도 같은 폴더 · 같은 색
// ② 폴더 메뉴 — "편집…" 하나(옛 "이름 변경" · "아이콘과 색" 없음) → 모달 "폴더 편집" · 차례 이름 → 아이콘 → 색 ·
//   이름 칸 포커스 · 고르개 차례 기본 → 로고 · 이름 prod → prod2 + folder-git-2 + #e5484d 저장 =
//   `rename_group { prod → prod2 }` 다음 `set_group_meta { prod2, … }` · 독 줄이 새 이름 · 그 색
// ③ 빈 폴더 lab — 색만(색 칸 Enter = 저장) → `{ lab, 📁, color }` · rename 없음 · 같은 이름(prod2)은 막힌다 · Escape 로 닫힘
// ④ F2 — 폴더 줄이면 폴더 편집, 호스트 줄이면 호스트 설정
// ⑤ 프로젝트 폼 — 내비 일반 · 워크트리 · 표시, 면을 바꿔도 상자 크기가 같다, 표시 면 = 아이콘 → 색 · 기본 → 로고 ·
//   rocket + #8e4ec6 저장 → `project_upsert` · 독 · 팔레트 · 시작 화면 머리 · 시작 페이지 · 막힌 칸의 면으로 이동 + 점
// ⑥ 팔레트의 색 없는 호스트 = 기본 서버 랙(같은 색) · 호스트 폼 표시 탭 고르개 차례 기본 → 로고 ⑦ 콘솔 예외 0.
// PNG (다크 기준, 라이트 하나): fp-host-dock.png · fp-folder-menu.png · fp-folder-edit.png · fp-folder-dock-after.png ·
// fp-project-dock.png · fp-project-general.png · fp-project-worktree.png · fp-project-display.png ·
// fp-project-dock-after.png · fp-project-start.png · fp-palette.png · fp-hostform-display.png · fp-light-host-dock.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9231";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const pagePort = process.env.PAGE_PORT ?? "1430";
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
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
  try { localStorage.removeItem('aynx:dock'); localStorage.removeItem('aynx:status-order'); localStorage.removeItem('aynx:hosts:expanded'); } catch {}
  const host = (name, ip, group) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null, color: null, group } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const hosts = [host('web-01', '10.0.0.1', 'prod'), host('dev-01', '10.0.0.2', null)];
  const GROUPS = { lab: { icon: '📁', color: null } };
  const PROJECTS = [
    { id: 'L1', name: 'aynx', host: null, path: 'C:\\\\src\\\\aynx', shell: null, agent: null, tmux: false },
    { id: 'R1', name: 'api', host: 'dev-01', path: '~/api', shell: null, agent: 'codex', tmux: true },
  ];
  window.__fake = { hosts, GROUPS, PROJECTS };
  const answers = {
    list_host_meta: {}, edit_host: [], set_host_meta: null,
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }],
    agent_args_targets: [{ id: 'claude', display: 'Claude Code' }, { id: 'codex', display: 'Codex' }],
    
    load_snippets: null,   save_snippets: null, 
    load_settings: {}, save_settings: null, host_history_list: {},
    git_worktree_list: [], git_repo_status: { kind: 'ok', branch: 'main', worktrees: 1 },
    ssh_remote_home: '/root', session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null, write_session: null, write_ssh: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_has_password: false, vault_has_passphrase: false,
    mcp_status: { clis: [] }, delegation_list_targets: [], session_logs_dir: 'C:\\\\logs', home_dir: 'C:\\\\Users\\\\wl',
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    'plugin:notification|is_permission_granted': true,
    'plugin:path|resolve_directory': 'C:\\\\Users\\\\wl',
  };
  const moved = (v, from, to) => v === from ? to : (v && v.startsWith(from + '/') ? to + v.slice(from.length) : v);
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      if (cmd === 'list_hosts') return Promise.resolve({ hosts, warnings: [] });
      if (cmd === 'get_host_meta') { const h = hosts.find((x) => x.name === args?.name); return Promise.resolve({ ...META, group: h?.meta.group ?? null }); }
      if (cmd === 'list_group_meta') return Promise.resolve(JSON.parse(JSON.stringify(GROUPS)));
      if (cmd === 'set_group_meta') {
        if (!args.icon && !args.color) delete GROUPS[args.path];
        else GROUPS[args.path] = { icon: args.icon ?? null, color: args.color ?? null };
        return Promise.resolve(null);
      }
      if (cmd === 'rename_group') {
        // 백엔드와 같은 규칙 — 호스트의 group 값과 [groups] 키를 함께 옮긴다
        for (const h of hosts) h.meta.group = moved(h.meta.group, args.from, args.to);
        for (const k of Object.keys(GROUPS)) { const nk = moved(k, args.from, args.to); if (nk !== k) { GROUPS[nk] = GROUPS[k]; delete GROUPS[k]; } }
        return Promise.resolve(null);
      }
      if (cmd === 'projects_list') return Promise.resolve(JSON.parse(JSON.stringify(PROJECTS)));
      if (cmd === 'project_upsert') {
        const i = PROJECTS.findIndex((p) => p.id === args.project.id);
        if (i >= 0) PROJECTS[i] = { ...args.project }; else PROJECTS.push({ ...args.project, id: 'N1' });
        return Promise.resolve({ ...args.project, id: args.project.id || 'N1' });
      }
      if (cmd === 'agent_sessions_list') return Promise.resolve({ groups: (args.cwds ?? []).map((c) => ({ cwd: c, exists: true, sessions: [], more: false })), others: [], othersMore: false });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });

const VK = { Enter: 13, Escape: 27, F2: 113 };
// Enter 는 글자(`\r`)까지 실어야 폼의 암묵 제출이 일어난다 (keyDown 만으로는 keydown 이벤트뿐이다)
const key = async (code, modifiers = 0, k = code, wait = 250) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && code === "Enter" ? { text: "\r" } : {}) }); await sleep(wait); };
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const calls = (name) => ev(`JSON.stringify(window.__calls.filter(c => c[0] === '${name}').map(c => c[1]))`).then((s) => JSON.parse(s));
const typeInto = (sel, v) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
/** 앞자리 아이콘의 **글자색**(= 획·칠이 입는 currentColor) — `kind:색` (kind = logo / ui / glyph) */
const faceOf = (sel) => ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return 'no el'; const s = el.querySelector('svg'); if (!s) return 'none'; const kind = s.classList.contains('logo') ? 'logo' : s.querySelector('path[fill-rule], path') && s.getAttribute('fill') === 'currentColor' ? 'glyph' : 'ui'; return kind + ':' + getComputedStyle(s).color; })()`);
const colorOnly = (f) => (typeof f === "string" && f.includes(":") ? f.slice(f.indexOf(":") + 1) : f);
/** 이 테마의 `--folder` 를 rgb 로 */
const folderToken = () => ev(`(() => { const d = document.createElement('span'); d.style.color = 'var(--folder)'; document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; })()`);
const segOrder = (root) => ev(`[...document.querySelectorAll('${root} [data-icon-seg]')].map(b => b.dataset.iconSeg + ':' + b.textContent.trim()).join('|')`);

// ── ① 기본 아이콘 — 호스트 독 ──────────────────────────────────────────────
if ((await ev(`document.querySelector('.dock')?.hidden ?? true`)) === true) await key("KeyH", 10, "H", 800);
await sleep(1200);
const FOLDER = (p) => `.dock .sidebar [data-id="g:${p}"]`;
const HOSTROW = (h) => `.dock .sidebar [data-id="h:${h}"]`;
const FOLDERTOK = await folderToken();
console.log("--folder (dark):", FOLDERTOK);
check((await ev(`!!document.querySelector('${FOLDER("prod")}')`)) === true, "독에 prod 폴더 줄");
const prodFace = await faceOf(`${FOLDER("prod")} .lead`);
const devFace = await faceOf(`${HOSTROW("dev-01")} .lead`);
console.log("folder / host face:", prodFace, devFace);
check(colorOnly(prodFace) === FOLDERTOK, `기본 폴더 = --folder (${prodFace})`);
check(devFace.startsWith("glyph:") && colorOnly(devFace) === FOLDERTOK, `색 없는 호스트 = 기본 서버 랙 · 폴더와 같은 --folder (${devFace})`);
console.log("capture:", await shot("fp-host-dock.png"));

// ── ② 폴더 메뉴 → 폴더 편집 ─────────────────────────────────────────────────
const openFolderMenu = async (p) => {
  await ev(`(() => { const el = document.querySelector('${FOLDER(p)}'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 30, clientY: r.top + 8 })); })()`);
  await sleep(300);
};
await openFolderMenu("prod");
const items = await ev(`[...document.querySelectorAll('.ctx-menu [role="menuitem"]')].map(b => b.textContent.trim()).join('|')`);
console.log("folder menu:", items);
check(items.includes("편집…") && !items.includes("이름 변경") && !items.includes("아이콘과 색"), `폴더 메뉴 = 편집… 하나 (${items})`);
console.log("capture:", await shot("fp-folder-menu.png"));
await ev(`document.querySelector('.ctx-menu [data-group-edit]').click()`); await sleep(500);
check((await ev(`!!document.querySelector('.ctx-menu')`)) === false, "메뉴는 닫히고(runOnMenu) 모달이 뜬다");
const fe = JSON.parse(await ev(`JSON.stringify((() => {
  const m = document.querySelector('[data-folder-edit]');
  if (!m) return null;
  const all = [m.textContent, ...[...m.querySelectorAll('[placeholder],[title],[aria-label],input')].flatMap(e => [e.getAttribute('placeholder'), e.getAttribute('title'), e.getAttribute('aria-label'), e.value])].filter(Boolean).join(' | ');
  return {
    title: m.querySelector('h2')?.textContent.trim(),
    labels: [...m.querySelectorAll('.fields > label')].map(l => l.textContent.trim()),
    name: document.getElementById('folder-edit-name')?.value,
    focus: document.activeElement === document.getElementById('folder-edit-name'),
    iconPh: document.getElementById('folder-edit-icon')?.placeholder, colorPh: m.querySelector('.color-text')?.placeholder,
    leaksSvg: all.includes('svg:'), nav: !!m.querySelector('.settings-nav'),
  };
})())`));
console.log("folder edit:", JSON.stringify(fe));
check(fe !== null && fe.title === "폴더 편집", `제목 "폴더 편집" (${fe?.title})`);
check(fe?.labels.join("|") === "이름|아이콘|색", `한 면 · 차례 이름 → 아이콘 → 색 (${fe?.labels.join("|")})`);
check(fe?.nav === false, "사이드 메뉴 없음");
check(fe?.name === "prod" && fe?.focus === true, `이름 칸 = prod · 포커스 (${fe?.name}, ${fe?.focus})`);
check(fe?.iconPh === "이름으로 검색하거나 이모지 입력" && fe?.colorPh === "없음 — 기본 색", "곁말 둘");
check(fe?.leaksSvg === false, "svg: 누출 없음");
const fseg = await segOrder("[data-folder-edit]");
check(fseg.startsWith("basic:기본|logos:로고"), `고르개 차례 = 기본 → 로고 (${fseg})`);
const previewFace = await faceOf("[data-folder-edit] .icon-field .preview");
check(colorOnly(previewFace) === FOLDERTOK, `미리보기 = 기본 폴더 · --folder (${previewFace})`);
console.log("capture:", await shot("fp-folder-edit.png"));
await typeInto("#folder-edit-name", "prod2"); await sleep(100);
await ev(`document.querySelector('[data-folder-edit] [data-icon-seg="basic"]').click()`); await sleep(200);
await typeInto("#folder-edit-icon", "folder-git-2"); await sleep(300);
await ev(`document.querySelector('[data-folder-edit] .icon-field .pick.hint')?.click()`); await sleep(200);
await typeInto("[data-folder-edit] .color-text", "#e5484d"); await sleep(200);
const c0 = await ev(`window.__calls.length`);
await ev(`document.querySelector('[data-folder-edit-submit]').click()`); await sleep(1000);
const seqCalls = JSON.parse(await ev(`JSON.stringify(window.__calls.slice(${c0}).filter(c => c[0] === 'rename_group' || c[0] === 'set_group_meta'))`));
console.log("save calls:", JSON.stringify(seqCalls));
check(JSON.stringify(seqCalls) === JSON.stringify([["rename_group", { from: "prod", to: "prod2" }], ["set_group_meta", { path: "prod2", icon: "svg:lucide:folder-git-2", color: "#e5484d" }]]), "이름 먼저(rename_group) → 새 경로에 아이콘·색(set_group_meta)");
check((await ev(`!!document.querySelector('[data-folder-edit]')`)) === false, "저장하면 모달이 닫힌다");
const prod2Face = await faceOf(`${FOLDER("prod2")} .lead`);
check(prod2Face === "logo:rgb(229, 72, 77)", `독 줄 = prod2 · 고른 선 아이콘 · 그 색 (${prod2Face})`);
check((await ev(`!!document.querySelector('${FOLDER("prod")}')`)) === false, "옛 prod 줄은 없다");
console.log("capture:", await shot("fp-folder-dock-after.png"));

// ── ③ 빈 폴더 lab — 색만 · 같은 이름 막기 · Escape ─────────────────────────
await openFolderMenu("lab");
await ev(`document.querySelector('.ctx-menu [data-group-edit]').click()`); await sleep(400);
check((await ev(`document.getElementById('folder-edit-icon').value`)) === "", "기본값 📁 는 아이콘 칸에 채우지 않는다");
await typeInto("#folder-edit-name", "prod2"); await sleep(100);
const d0 = await ev(`window.__calls.length`);
await ev(`document.querySelector('[data-folder-edit-submit]').click()`); await sleep(400);
const dupErr = await ev(`document.querySelector('[data-folder-edit] .err')?.textContent.trim() ?? null`);
const dupCalls = await ev(`window.__calls.slice(${d0}).filter(c => c[0] === 'rename_group' || c[0] === 'set_group_meta').length`);
check(dupErr === "같은 이름의 폴더가 이미 있습니다" && dupCalls === 0, `같은 층의 같은 이름은 막힌다 (${dupErr}, calls ${dupCalls})`);
await typeInto("#folder-edit-name", "lab"); await sleep(100);
await typeInto("[data-folder-edit] .color-text", "#30a46c"); await sleep(150);
const l0 = await ev(`window.__calls.length`);
await key("Enter", 0, "Enter", 900); // 색 칸의 Enter = 폼 제출
const labCalls = JSON.parse(await ev(`JSON.stringify(window.__calls.slice(${l0}).filter(c => c[0] === 'rename_group' || c[0] === 'set_group_meta'))`));
console.log("lab calls:", JSON.stringify(labCalls));
check(JSON.stringify(labCalls) === JSON.stringify([["set_group_meta", { path: "lab", icon: "📁", color: "#30a46c" }]]), "빈 폴더는 📁 를 지키고 색을 더한다 · 이름 그대로면 rename 없음");
const labFace = await faceOf(`${FOLDER("lab")} .lead`);
check(colorOnly(labFace) === "rgb(48, 164, 108)", `lab 기본 폴더가 그 색 (${labFace})`);
await openFolderMenu("lab");
await ev(`document.querySelector('.ctx-menu [data-group-edit]').click()`); await sleep(400);
await key("Escape", 0, "Escape", 400);
check((await ev(`!!document.querySelector('[data-folder-edit]')`)) === false, "Escape 로 닫힌다");
check((await ev(`document.querySelector('.dock')?.hidden ?? true`)) === false, "Escape 가 독까지 닫지 않는다");
const back = await ev(`document.activeElement?.dataset?.id ?? document.activeElement?.tagName`);
check(back === "g:lab", `닫히면 키보드가 그 폴더 줄로 돌아온다 (${back})`);

// ── ④ F2 ───────────────────────────────────────────────────────────────────
// (위에서 돌아온 포커스 그대로 — 폴더 줄 lab 이 골라져 있다)
await key("F2", 0, "F2", 500);
const f2Folder = await ev(`document.getElementById('folder-edit-name')?.value ?? null`);
check(f2Folder === "lab", `폴더 줄 F2 = 폴더 편집 (${f2Folder})`);
await key("Escape", 0, "Escape", 300);
await ev(`(() => { const el = document.querySelector('${HOSTROW("dev-01")}'); el.focus(); el.click(); })()`); await sleep(200);
await key("F2", 0, "F2", 800);
const f2Host = await ev(`!!document.querySelector('.host-modal') && !document.querySelector('[data-folder-edit]')`);
check(f2Host === true, "호스트 줄 F2 = 호스트 설정");
const hostsApp = importApp("app/hosts.svelte.ts");
await ev(`(async () => { const m = await ${hostsApp}; m.closeForm(); })()`); await sleep(300);

// ── ⑤ 프로젝트 ─────────────────────────────────────────────────────────────
await key("KeyJ", 10, "J", 900);
const PROW = (id) => `[data-project-dock] [data-project-id="${id}"]`;
const l1Before = await faceOf(`${PROW("L1")} .lead`);
const r1Before = await faceOf(`${PROW("R1")} .lead`);
console.log("project face before:", l1Before, r1Before);
const hostFolderShape = await ev(`document.querySelector('${FOLDER("lab")}')?.querySelector('.lead svg')?.innerHTML ?? null`);
const projFolderShape = await ev(`document.querySelector('${PROW("L1")} .lead svg')?.innerHTML ?? null`);
check(colorOnly(l1Before) === FOLDERTOK && colorOnly(r1Before) === FOLDERTOK, `아이콘 없는 프로젝트 = --folder (${l1Before} / ${r1Before})`);
check(hostFolderShape !== null && hostFolderShape === projFolderShape, "프로젝트 기본 그림 = 호스트 독 폴더와 같은 모양");
console.log("capture:", await shot("fp-project-dock.png"));

const projMod = importApp("app/projects.svelte.ts");
const plMod = importApp("app/project-list.svelte.ts");
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; m.openProjectForm(l.projects().find(p => p.id === 'L1')); })()`); await sleep(800);
const PF = "[data-project-form]";
const navOf = () => ev(`[...document.querySelectorAll('${PF} .nav-item')].map(b => b.querySelector('.nav-label').textContent.trim() + (b.classList.contains('active') ? '*' : '')).join('|')`);
const nav0 = await navOf();
check(nav0 === "일반*|워크트리|표시", `내비 일반 · 워크트리 · 표시, 일반부터 (${nav0})`);
check((await ev(`document.activeElement?.id`)) === "project-name", "이름 칸에 포커스");
const rectOf = () => ev(`(() => { const r = document.querySelector('${PF}').getBoundingClientRect(); return Math.round(r.width) + 'x' + Math.round(r.height); })()`);
const visLabels = () => ev(`(() => { const s = [...document.querySelectorAll('${PF} .pf-panel > section')].find(x => !x.hidden); return [...s.querySelectorAll('.fields > label, .fields > .label-like')].map(l => l.textContent.trim()).join('|'); })()`);
const sizes = [await rectOf()];
const g = await visLabels();
console.log("general:", g);
check(g.startsWith("이름|위치|경로|에이전트|셸") && !g.includes("워크트리") && !g.includes("아이콘"), `일반 면 칸 (${g})`);
console.log("capture:", await shot("fp-project-general.png"));
const tabTo = async (label) => { await ev(`[...document.querySelectorAll('${PF} .nav-item')].find(b => b.textContent.trim().startsWith('${label}')).click()`); await sleep(300); };
await tabTo("워크트리");
sizes.push(await rectOf());
const w = await visLabels();
check(w === "워크트리 폴더|설정 스크립트", `워크트리 면 칸 (${w})`);
console.log("capture:", await shot("fp-project-worktree.png"));
await tabTo("표시");
sizes.push(await rectOf());
const d = await visLabels();
check(d === "아이콘|색", `표시 면 = 아이콘 → 색 (${d})`);
console.log("modal sizes:", sizes.join(", "));
check(new Set(sizes).size === 1, `면을 바꿔도 상자 크기가 같다 (${sizes.join(", ")})`);
const pseg = await segOrder(PF);
check(pseg.startsWith("basic:기본|logos:로고"), `프로젝트 고르개 차례 = 기본 → 로고 (${pseg})`);
const pPrev = await faceOf(`${PF} .icon-field .preview`);
check(colorOnly(pPrev) === FOLDERTOK, `표시 면 미리보기 = 기본 폴더 (${pPrev})`);
console.log("capture:", await shot("fp-project-display.png"));
await ev(`document.querySelector('${PF} [data-icon-seg="basic"]').click()`); await sleep(200);
await typeInto("#project-icon", "rocket"); await sleep(300);
await ev(`document.querySelector('${PF} .icon-field .pick.hint')?.click()`); await sleep(200);
await typeInto(`${PF} .color-text`, "#8e4ec6"); await sleep(200);
const u0 = (await calls("project_upsert")).length;
await ev(`document.querySelector('[data-project-submit]').click()`); await sleep(900);
const ups = (await calls("project_upsert")).slice(u0).map((a) => ({ id: a.project.id, icon: a.project.icon, color: a.project.color }));
console.log("project_upsert:", JSON.stringify(ups));
check(JSON.stringify(ups) === JSON.stringify([{ id: "L1", icon: "svg:lucide:rocket", color: "#8e4ec6" }]), "표시 면에서 저장 → project_upsert { icon, color }");
check((await ev(`!!document.querySelector('${PF}')`)) === false, "저장하면 폼이 닫힌다");
const l1After = await faceOf(`${PROW("L1")} .lead`);
check(l1After === "logo:rgb(142, 78, 198)", `독의 aynx 줄 = 고른 선 아이콘 · 그 색 (${l1After})`);
check((await faceOf(`${PROW("R1")} .lead`)) === r1Before, "아이콘 없는 api 줄은 기본 폴더 그대로");
console.log("capture:", await shot("fp-project-dock-after.png"));

// 막힌 칸의 면으로 — 이름(일반) · 워크트리 폴더(워크트리)
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; m.openProjectForm(l.projects().find(p => p.id === 'L1')); })()`); await sleep(700);
await tabTo("워크트리");
await typeInto("#project-worktree-dir", "relative-dir"); await sleep(100);
await tabTo("표시");
await ev(`document.querySelector('[data-project-submit]').click()`); await sleep(500);
const navW = await navOf();
const markedW = await ev(`[...document.querySelectorAll('${PF} [data-nav-marked]')].map(b => b.dataset.navTab).join(',')`);
check(navW === "일반|워크트리*|표시" && markedW === "worktree", `막힌 워크트리 폴더 → 워크트리 면 · 점 (${navW}, ${markedW})`);
check((await ev(`document.activeElement?.id`)) === "project-worktree-dir", "그 칸에 포커스");
await typeInto("#project-worktree-dir", ""); await sleep(100);
await typeInto("#project-name", ""); await sleep(100);
await tabTo("표시");
await ev(`document.querySelector('[data-project-submit]').click()`); await sleep(500);
const navN = await navOf();
const markedN = await ev(`[...document.querySelectorAll('${PF} [data-nav-marked]')].map(b => b.dataset.navTab).join(',')`);
check(navN === "일반*|워크트리|표시" && markedN === "general", `빈 이름 → 일반 면 · 점 (${navN}, ${markedN})`);
await key("Escape", 0, "Escape", 400);
check((await ev(`!!document.querySelector('${PF}')`)) === false, "Escape 로 프로젝트 폼 닫힘");

// 시작 페이지 프로젝트 칸 — 모든 줄에 얼굴(고른 줄은 그 아이콘, 나머지는 기본 폴더) · 이름 세로 맞춤
const sp = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-start-widget="projects"] .row')].map(r => ({ name: r.querySelector('.name')?.textContent.trim(), icon: !!r.querySelector('.picon svg'), x: Math.round(r.querySelector('.name').getBoundingClientRect().left) })))`));
console.log("start page project rows:", JSON.stringify(sp));
check(sp.length > 0 && sp.every((r) => r.icon), "시작 페이지 — 모든 프로젝트 줄에 얼굴");
check(new Set(sp.map((r) => r.x)).size === 1, "시작 페이지 — 이름이 세로로 맞는다");

// ── ⑥ 팔레트 · 시작 화면 · 호스트 폼 ───────────────────────────────────────
await key("KeyJ", 10, "J", 500);
await key("KeyP", 10, "P", 700);
await typeInto(".palette input", "aynx"); await sleep(400);
const palRow = (label) => `(() => { const r = [...document.querySelectorAll('.palette .row')].find(e => e.querySelector('.label')?.textContent.trim() === '${label}'); return r ? r.querySelector('.lead') : null; })()`;
const palFace = (label) => ev(`(() => { const l = ${palRow(label)}; if (!l) return 'no row'; const s = l.querySelector('svg'); if (!s) return 'none'; return (s.classList.contains('logo') ? 'logo' : s.getAttribute('fill') === 'currentColor' ? 'glyph' : 'ui') + ':' + getComputedStyle(s).color; })()`);
const palAynx = await palFace("aynx");
check(palAynx === "logo:rgb(142, 78, 198)", `팔레트 프로젝트 줄 = 그 아이콘 · 그 색 (${palAynx})`);
await typeInto(".palette input", "api"); await sleep(400);
const palApi = await palFace("api");
check(colorOnly(palApi) === FOLDERTOK && palApi.startsWith("ui:"), `팔레트 아이콘 없는 프로젝트 = 기본 폴더 (${palApi})`);
await typeInto(".palette input", "dev-01"); await sleep(400);
const palHost = await palFace("dev-01");
check(palHost.startsWith("glyph:") && colorOnly(palHost) === FOLDERTOK, `팔레트 색 없는 호스트 = 기본 서버 랙 · --folder (${palHost})`);
console.log("capture:", await shot("fp-palette.png"));
await key("Escape", 0, "Escape", 400);
await ev(`(async () => { const m = await ${projMod}; const l = await ${plMod}; await m.openProjectInNewTab(l.projects().find(p => p.id === 'L1')); })()`); await sleep(1500);
const PS = `[...document.querySelectorAll('[data-project-start]')].find(e => e.getClientRects().length > 0)`;
const startIcon = await ev(`(() => { const ps = ${PS}; if (!ps) return 'no start'; const s = ps.querySelector('[data-start-icon] svg'); return s ? getComputedStyle(s).color : 'no icon'; })()`);
check(startIcon === "rgb(142, 78, 198)", `시작 화면 머리에 그 아이콘 · 그 색 (${startIcon})`);
console.log("capture:", await shot("fp-project-start.png"));

await ev(`(async () => { const m = await ${hostsApp}; await m.openEdit(window.__fake.hosts[1], 'display'); })()`); await sleep(800);
const hf = await ev(`(() => { const sec = [...document.querySelectorAll('.host-modal .host-panel > section')].find(s => !s.hidden); return sec ? [...sec.querySelectorAll('.fields > label')].map(l => l.textContent.trim()).join('|') : 'no form'; })()`);
check(typeof hf === "string" && hf.startsWith("아이콘|색|"), `호스트 폼 표시 탭 차례 그대로 (${hf})`);
const hseg = await segOrder(".host-modal");
check(hseg.startsWith("basic:기본|logos:로고"), `호스트 폼 고르개 차례 = 기본 → 로고 (${hseg})`);
const hPrev = await faceOf(".host-modal .icon-field .preview");
check(hPrev.startsWith("glyph:") && colorOnly(hPrev) === FOLDERTOK, `호스트 폼 미리보기 = 기본 서버 랙 · --folder (${hPrev})`);
console.log("capture:", await shot("fp-hostform-display.png"));
await ev(`(async () => { const m = await ${hostsApp}; m.closeForm(); })()`); await sleep(300);

// ── 라이트 한 장 — 호스트 독(폴더 + 색 없는 호스트) ────────────────────────
await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(200);
await key("KeyH", 10, "H", 800);
const lightTok = await folderToken();
const lightDev = await faceOf(`${HOSTROW("dev-01")} .lead`);
const lightLab = await faceOf(`${FOLDER("lab")} .lead`);
console.log("--folder (light):", lightTok, lightDev, lightLab);
check(lightTok !== FOLDERTOK && colorOnly(lightDev) === lightTok, `라이트 — 색 없는 호스트도 라이트의 --folder (${lightDev})`);
console.log("capture:", await shot("fp-light-host-dock.png"));

console.log("errors:", JSON.stringify(errors));
check(errors.length === 0, "콘솔 예외 0");
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
