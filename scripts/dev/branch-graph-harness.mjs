// Headless harness: **브랜치 타일 — 두 줄기 커밋 그래프** (docs/log/2026-10-04-commit-graph.md · 처음 모양은
// docs/log/2026-09-29-branch-graph.md). `dock-dots-harness.mjs` 스텁의 사본 — 표와 시나리오만 다르다.
//
//   node scripts/dev/run-harness.mjs branch-graph-harness.mjs <outdir> --size 1400x900
//
// 심어 두는 것: 로컬 프로젝트 api-server(C:\src\api — 워크트리 main · api-login(fix-token, 커밋 안 한 것 있음) ·
// docs(docs-typo)) 와 원격 프로젝트 web(dev-01:~/web). 그래프 답은 목업의 모양 — main 줄 m6 · m5(feat-design-k 병합) · m4 ·
// m3, fix-token(3, m4 에서) · docs-typo(1, m6 에서) · spike-cache(2, m3 에서 · 워크트리 없음), m5 아래 접힘(dk2 · dk1).
// api-login 폴더에서 연 로컬 claude 타일 하나(권한 대기).
//
// 보는 것: ① 독 워크트리 줄 배지를 누르면 그 브랜치 첫 커밋을 고른 채 지금 탭에 분할로 선다 ② 줄 차례 — 덩어리는 base 의
// main 줄 바로 위 · 접힘은 병합 커밋 바로 아래 · ✎ 줄은 덩어리 맨 위 · 줄 높이 32 · 줄기 칸 46 · 이름 칸(main · 주 폴더 ·
// 갈라진 곳 · 에이전트 점) ③ 오른쪽 칸 — 커밋 파일(git_commit_files) · [그 타일로] ④ 접힘 펴기 → 덩어리 · 다시 접기
// ⑤ ↑↓ 로 초점만 옮기고 Enter 로 고르기 → 명세에 브랜치(배치 저장 모양) · 워크트리 없는 브랜치의 파일은 흐림 ⑥ ✎ 줄 →
// git_worktree_wip_files ⑦ 파일을 누르면 문서 타일(경로 = 워크트리 + 파일) ⑧ 워크트리 줄 우클릭 "브랜치 그래프" → 새 타일
// 없이 그 브랜치 ⑨ 팔레트 "브랜치 그래프"(AI 타일에서) → fix-token ⑩ 에이전트 턴 끝 신호 → "새 변경 있음" ⑪ 이전 커밋 더
// 보기 → mainLimit 62 ⑫ 원격 프로젝트 · 붙은 세션 없음 → "접속 후 표시됩니다" ⑬ 예외 0.
// PNG: `branches-dark.png` · `branches-light.png` · `branches-folds.png` · `branches-narrow.png`.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9401";
const pagePort = process.env.PAGE_PORT ?? "1591";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"); if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error: " + (d.params.args?.[0]?.value ?? d.params.args?.[0]?.description ?? "?")); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); const p = path.join(outDir, name); fs.writeFileSync(p, Buffer.from(r.result.data, "base64")); return p; };
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };
await send("Page.enable"); await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, id: h, payload }));
  try {
    localStorage.removeItem('aynx:dock');
    localStorage.removeItem('aynx:projects:expanded');
  } catch {}
  const N = Math.floor(Date.now() / 1000);
  const H = (c) => c.repeat(40);
  const host = (name, ip) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null, group: null } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const WT = [
    { path: 'C:/src/api', branch: 'main', head: H('a'), bare: false, detached: false },
    { path: 'C:/src/api-wt/api-login', branch: 'fix-token', head: H('b'), bare: false, detached: false },
    { path: 'C:/src/api-wt/docs', branch: 'docs-typo', head: H('c'), bare: false, detached: false },
  ];
  const C = (hash, ago, subject, parents, added, deleted) => ({ hash, parents, subject, time: N - ago, added: parents.length >= 2 ? null : (added ?? 1), deleted: parents.length >= 2 ? null : (deleted ?? 0) });
  const COMMITS = [
    C('m6', 3600, '릴리스 노트 정리', ['m5'], 12, 2),
    C('m5', 8 * 3600, "Merge branch 'feat-design-k'", ['m4', 'dk2']),
    C('m4', 2 * 86400, '자동 승인 카드 높이 맞춤', ['m3'], 6, 6),
    C('m3', 3 * 86400, '워크스페이스 전환 깜빡임 제거', ['m2'], 3, 11),
    C('fx3', 2 * 3600, '토큰 갱신 경합 수정', ['fx2'], 40, 12),
    C('fx2', 5 * 3600, '재시도 한도 추가', ['fx1'], 30, 5),
    C('fx1', 20 * 3600, '갱신 경합 테스트', ['m4'], 14, 2),
    C('dt1', 600, 'README 오타', ['m6'], 1, 1),
    C('sc2', 6 * 3600, '캐시 키 실험', ['sc1'], 51, 0),
    C('sc1', 22 * 3600, '캐시 계층 초안', ['m3'], 88, 4),
    C('dk2', 26 * 3600, '설정 툴팁', ['dk1'], 26, 9),
    C('dk1', 2 * 86400, '칩 슬라이더', ['m3'], 31, 7),
    C('sq2', 30 * 3600, '세션 만료 처리', ['sq1'], 18, 3),
    C('sq1', 40 * 3600, '세션 만료 초안', ['m4'], 22, 0),
  ];
  const br = (name, commits, base) => ({ name, head: commits[0], base, ahead: commits.length, behind: 0, commits, commits_truncated: false, merged: false, merged_kind: null, created_from: null, created_at: null });
  const GRAPH = {
    main: 'main', main_head: 'm6', main_more: true, truncated: false,
    main_line: ['m6', 'm5', 'm4', 'm3'].map((hash) => ({ hash, skipped_before: 0 })),
    commits: COMMITS,
    branches: [br('docs-typo', ['dt1'], 'm6'), br('fix-token', ['fx3', 'fx2', 'fx1'], 'm4'), br('spike-cache', ['sc2', 'sc1'], 'm3')],
    // m6 = squash 커밋(2026-10-05) — auth-squash 가 squash 로 들어갔다: 덩어리 없이 m6 바로 아래 접힘.
    folds: [{ merge: 'm5', name: 'feat-design-k', commits: ['dk2', 'dk1'], commits_truncated: false, base: 'm3', kind: 'merge' },
      { merge: 'm6', name: 'auth-squash', commits: ['sq2', 'sq1'], commits_truncated: false, base: 'm4', kind: 'squash' }],
    worktrees: [
      { path: 'C:/src/api', branch: 'main', head: 'm6', primary: true, dirty: null },
      { path: 'C:/src/api-wt/api-login', branch: 'fix-token', head: 'fx3', primary: false, dirty: { files: 2, added: 39, deleted: 9 } },
      { path: 'C:/src/api-wt/docs', branch: 'docs-typo', head: 'dt1', primary: false, dirty: null },
    ],
  };
  const f = (path, status, added, deleted, old_path) => ({ path, old_path: old_path ?? null, status, added, deleted });
  const FILES = {
    fx3: [f('src/auth/session.ts', 'M', 22, 6), f('src/auth/timeout.ts', 'A', 14, 0), f('src/lib/old.ts', 'D', 0, 30)],
    sc2: [f('src-tauri/src/cache/key.rs', 'A', 51, 0)],
    dk2: [f('src/lib/settings/Tip.svelte', 'M', 26, 9)],
  };
  const WIP = { 'C:/src/api-wt/api-login': [f('src/routes/login.svelte', 'M', 31, 9), f('tests/session.test.ts', 'A', 8, 0)] };
  window.__graphReads = 0;
  const answers = {
    list_hosts: { hosts: [host('dev-01', '10.0.0.9')], warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
     load_snippets: null, 
     save_snippets: null, 
    load_settings: { projects: { start_screen: 'off' } }, save_settings: null,
    host_history_list: {},
    projects_list: [
      { id: 'L1', name: 'api-server', host: null, path: 'C:\\\\src\\\\api', shell: null, command: 'claude', tmux: false },
      { id: 'R1', name: 'web', host: 'dev-01', path: '~/web', shell: null, command: 'claude', tmux: false },
    ],
    git_worktree_list: WT,
    git_worktree_changes: (a) => (a.paths ?? []).filter((p) => p !== 'C:/src/api').map((p) => ({ path: p, ahead: p.endsWith('api-login') ? 7 : 1, added_lines: p.endsWith('api-login') ? 84 : 1, deleted_lines: p.endsWith('api-login') ? 19 : 1, merged: false })),
    git_commit_graph: () => { window.__graphReads++; return GRAPH; },
    git_commit_files: (a) => ({ hash: a.hash, merge: a.hash === 'm5', files: FILES[a.hash] ?? [], truncated: false }),
    git_worktree_wip_files: (a) => ({ path: a.path, head: 'fx3', files: WIP[a.path] ?? [], truncated: false }),
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (!(cmd in answers)) return Promise.reject(new Error('stub: ' + cmd));
      const a = answers[cmd];
      return Promise.resolve(typeof a === 'function' ? a(args ?? {}) : a);
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
// 앱 모듈이 다 뜰 때까지 기다린다 — 찬 vite 에서는 4.5초 안에 tabs 모듈이 안 떠 첫 import 가 실패했다
for (let i = 0; i < 60 && !(await ev(`performance.getEntriesByType('resource').some((r) => r.name.includes('app/tabs.svelte.ts')) && !!document.querySelector('[data-tile-canvas]')`)); i++) await sleep(250);
await sleep(800);
errors.length = 0; // 스텁을 심기 전 첫 적재의 잡음(창 메타데이터 없음)은 세지 않는다

const VK = { Enter: 13, Escape: 27, Tab: 9, ArrowUp: 38, ArrowDown: 40, Home: 36, End: 35 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && code === "Enter" ? { text: "\r" } : {}) }); await sleep(250); };
// (Enter 에 `text` 를 실어야 단추의 기본 동작 — 누름 — 이 난다: 목록 줄은 진짜 <button> 이다)
const rectOf = async (sel) => JSON.parse(await ev(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`));
const clickAt = async (x, y, button = "left", modifiers = 0) => { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button, clickCount: 1, modifiers }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button, clickCount: 1, modifiers }); await sleep(350); };
const click = async (sel, modifiers = 0) => { const r = await rectOf(sel); await clickAt(r.x + r.width / 2, r.y + r.height / 2, "left", modifiers); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const cwdMod = importApp("app/pane-cwd.svelte.ts");
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const attr = (sel, name) => ev(`document.querySelector(${JSON.stringify(sel)})?.getAttribute('${name}') ?? null`);
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const texts = (sel) => ev(`JSON.stringify([...document.querySelectorAll(${JSON.stringify(sel)})].map(e => e.textContent.trim()))`).then(JSON.parse);
const branchPanes = () => ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return JSON.stringify(w.residentWindowTabs().flatMap(t => s.listPanes(t.root)).filter(p => p.kind === 'branches').map(p => p.branchGraph)); })()`).then(JSON.parse);

// AI 타일 하나 — api-login 워크트리에서(에이전트 고리 · 팔레트의 "지금 타일").
const ai = JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod};
  const p = s.newLocalPane(); Object.assign(p, { cwd: 'C:\\\\src\\\\api-wt\\\\api-login', autorun: 'claude' }); w.openInNewTab(p);
  return JSON.stringify({ id: p.id, stream: p.historyStreamId ?? p.id }); })()`));
await sleep(1200);
await ev(`(async () => { (await ${cwdMod}).noteReportedCwd('${ai.id}', 'C:\\\\src\\\\api-wt\\\\api-login'); })()`);
await ev(fakeAgentSignal(`{ stream: '${ai.stream}', event: 'waiting', detail: 'permission', at: Date.now() }`));

// ── ① 독 배지 → 그 브랜치 첫 커밋을 고른 채 분할 ───────────────────────────
await key("KeyJ", 10, "J"); await sleep(900);
await click(`[data-project-id="L1"] [data-project-twisty]`); await sleep(900);
const badge = `[data-worktree-row="C:/src/api-wt/api-login"] [data-worktree-changes]`;
check((await attr(badge, "data-worktree-changes")) === "+84 −19 ↑7", `배지 (${await attr(badge, "data-worktree-changes")})`);
const tilesBefore = Number(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return s.listPanes(w.activeTab().root).length; })()`));
await click(badge); await sleep(1400);
const tilesAfter = Number(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return s.listPanes(w.activeTab().root).length; })()`));
check(tilesAfter === tilesBefore + 1, `지금 탭에 분할로 하나 더 (${tilesBefore} → ${tilesAfter})`);
const selKey = () => attr("[data-branch-selected]", "data-branch-key");
check((await selKey()) === "c:b:fix-token:fx3", `배지의 브랜치(fix-token) 첫 커밋을 고른 채 (${await selKey()})`);
await key("KeyJ", 10, "J"); await sleep(600); // 독 닫기

// ── ② 줄 차례 · 모양 ─────────────────────────────────────────────────────────
const rowsNow = () => ev(`JSON.stringify([...document.querySelectorAll('[data-branch-key]')].map(e => e.getAttribute('data-branch-key')))`).then(JSON.parse);
const rows = await rowsNow();
const want = ["c:b:docs-typo:dt1", "m:m6", "f:m6", "m:m5", "f:m5", "w:C:/src/api-wt/api-login", "c:b:fix-token:fx3", "c:b:fix-token:fx2", "c:b:fix-token:fx1", "m:m4", "c:b:spike-cache:sc2", "c:b:spike-cache:sc1", "m:m3"];
check(JSON.stringify(rows) === JSON.stringify(want), `줄 차례 (${rows.join(",")})`);
const rowH = await ev(`Math.round(document.querySelector('[data-branch-key="m:m6"]').getBoundingClientRect().height)`);
check(rowH >= 31 && rowH <= 33, `줄 높이 ≈ 32px (${rowH})`);
check((await ev(`document.querySelector('[data-branch-key="m:m6"] svg').getAttribute('width')`)) === "46", "줄기 칸 46px");
check((await ev(`document.querySelector('[data-branch-key="m:m6"] .name').textContent.trim()`)) === "main", "main 맨 위 줄 = main 알약");
check((await ev(`document.querySelector('[data-branch-key="m:m6"] .wt').textContent.trim()`)) === "주 폴더", "main 옆 = 주 폴더(늘 보임)");
check((await count(`.name .stripe`)) === 0 && (await count(`[data-branch-key="c:b:fix-token:fx2"] .name`)) === 0, "세로 막대 없음 · 알약은 덩어리 첫 줄에만");
check((await ev(`document.querySelector('[data-branch-key="c:b:fix-token:fx1"] .fork')?.textContent.trim()`)) === "↳ m4에서 갈라짐", "덩어리 끝 줄 = 갈라진 곳(이름 칸)");
check((await exists(`[data-branch-key="w:C:/src/api-wt/api-login"] .agentdot.permission`)) === true, "✎ 줄(덩어리 첫 줄)에 에이전트 점 = 권한 대기");
check((await ev(`document.querySelector('[data-branch-key="c:b:spike-cache:sc2"] .wt').textContent.trim()`)) === "워크트리 없음", "spike-cache = 워크트리 없음");
check((await ev(`document.querySelector('[data-branch-key="f:m5"] .msg').textContent.trim()`)) === "커밋 2개 · m3에서 갈라져 병합됨", "접힘 줄 글");
check((await ev(`document.querySelector('[data-branch-key="f:m6"] .msg').textContent.trim()`)) === "커밋 2개 · squash 병합", "squash 접힘 줄 글 — squash 커밋 바로 아래");
check((await ev(`document.querySelector('[data-branch-key="f:m6"] .name.fold').textContent.trim()`)) === "▸ auth-squash", "squash 접힘 알약 = ▸ auth-squash(점선)");
check((await count(`[data-branch-key="f:m6"] .gut .pt.ring`)) === 1 && (await count(`[data-branch-key="f:m6"] .gut rect`)) === 0, "접힌 줄 표시 = 이중 고리(네모 없음)");
check((await ev(`getComputedStyle(document.querySelector('[data-branch-key="c:b:fix-token:fx3"]')).boxShadow`)) === "none", "고른 줄에 왼쪽 띠 없음");
check((await ev(`document.querySelector('.lwrap').scrollWidth <= document.querySelector('.lwrap').clientWidth`)) === true, "가로 스크롤 없음");

// ── ③ 오른쪽 칸 ──────────────────────────────────────────────────────────────
check((await count(`[data-branch-file]`)) === 3, `커밋 파일 셋 (${await count("[data-branch-file]")})`);
check((await exists("[data-branch-goto]")) === true, "[그 타일로] 단추");
check((await attr(`[data-branch-file="src/lib/old.ts"]`, "data-branch-file-doc-blocked")) === "", "지워진 파일 = 문서로는 못 연다(누르면 diff — docs/log/2026-10-05-diff-tile.md)");
console.log("capture:", await shot("branches-dark.png"));
await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(300);
console.log("capture:", await shot("branches-light.png"));
await ev(`delete document.documentElement.dataset.theme`); await sleep(200);

// ── ④ 접힘 펴기 · 다시 접기 ──────────────────────────────────────────────────
await click(`[data-branch-key="f:m5"]`); await sleep(500);
const opened = await rowsNow();
check(JSON.stringify(opened.slice(3, 6)) === JSON.stringify(["m:m5", "c:f:m5:dk2", "c:f:m5:dk1"]), `편 덩어리가 그 자리에 (${opened.join(",")})`);
check((await selKey()) === "c:f:m5:dk2", "편 덩어리 첫 커밋을 고름");
check((await ev(`document.activeElement?.getAttribute('data-branch-key')`)) === "c:f:m5:dk2", "초점도 그 줄로");
console.log("capture:", await shot("branches-folds.png"));
await click(`[data-branch-refold]`); await sleep(500);
check((await rowsNow()).includes("f:m5") && (await selKey()) === "m:m5", "다시 접기 → 접힘 줄 · 병합 커밋 줄을 고름");
check((await exists(`[data-branch-files-merge]`)) === true, "병합 커밋 — 바뀐 내용은 합쳐진 브랜치 쪽");
// 그래프(줄기 칸) · 이름 칸(알약 ▾ 이름 · 덩어리 다른 줄의 빈 이름 칸)을 눌러 다시 접기 — 편 덩어리의 커밋 줄 · 그 병합 커밋 줄 모두 손잡이
for (const [handle, cell] of [["c:f:m5:dk1", ".gut"], ["m:m5", ".gut"], ["c:f:m5:dk2", ".name .bn"], ["c:f:m5:dk1", ".ncell"]]) {
  await click(`[data-branch-key="f:m5"]`); await sleep(500);
  const g = await rectOf(`[data-branch-key="${handle}"] ${cell}`);
  await clickAt(g.x + g.width / 2, g.y + g.height / 2); await sleep(500);
  check((await rowsNow()).includes("f:m5") && (await selKey()) === "m:m5", `${cell} 누르기(${handle}) → 다시 접힘 (${(await rowsNow()).join(",")})`);
}
// 같은 손잡이로 펴기 — 접힌 줄의 그래프 · 이름 칸(▸ 이름)을 진짜 마우스로 눌러도 편다(10-27 — 빈 접기가 돌던 버그)
for (const cell of [".gut", ".name .bn"]) {
  const g = await rectOf(`[data-branch-key="f:m5"] ${cell}`);
  await clickAt(g.x + g.width / 2, g.y + g.height / 2); await sleep(500);
  check(!(await rowsNow()).includes("f:m5") && (await selKey()) === "c:f:m5:dk2", `접힌 줄 ${cell} 누르기 → 펼침 (${(await rowsNow()).join(",")})`);
  const h = await rectOf(`[data-branch-key="c:f:m5:dk2"] ${cell}`);
  await clickAt(h.x + h.width / 2, h.y + h.height / 2); await sleep(500);
  check((await rowsNow()).includes("f:m5"), `같은 칸 ${cell} 다시 누르기 → 접힘`);
}
// 메시지 칸은 지금처럼 고르기만
await click(`[data-branch-key="f:m5"]`); await sleep(500);
await click(`[data-branch-key="c:f:m5:dk1"] .msg`); await sleep(500);
check(!(await rowsNow()).includes("f:m5") && (await selKey()) === "c:f:m5:dk1", "메시지 칸 누르기 → 접지 않고 고름");
await click(`[data-branch-refold]`); await sleep(500);

// ── ⑤ ↑↓ 로 옮기고 Enter 로 고르기 ──────────────────────────────────────────
await click(`[data-branch-key="m:m4"]`); await sleep(500);
await ev(`document.querySelector('[data-branch-key="m:m4"]').focus()`);
check((await attr(`[data-branch-key="m:m4"]`, "tabindex")) === "0" && (await attr(`[data-branch-key="m:m3"]`, "tabindex")) === "-1", "로빙 탭 — 고른 줄만 0");
await key("ArrowDown", 0, "ArrowDown");
const focused = await ev(`document.activeElement?.getAttribute('data-branch-key')`);
check(focused === "c:b:spike-cache:sc2", `↓ → sc2 에 초점 (${focused})`);
check((await selKey()) === "m:m4", "↓ 는 고르지 않는다");
await key("Enter"); await sleep(600);
check((await selKey()) === "c:b:spike-cache:sc2", "Enter 로 sc2");
check(JSON.stringify(await branchPanes()) === JSON.stringify([{ projectId: "L1", branch: "spike-cache", name: "api-server" }]), `명세 = ${JSON.stringify(await branchPanes())}`);
const saved = await ev(`(async () => { const w = await ${tabsMod}; const ws = await ${importApp("lib/tabs.ts")}; return JSON.stringify(ws.saveNode(w.activeTab().root)); })()`);
check(saved.includes(`{"kind":"branches","branchGraph":{"projectId":"L1","branch":"spike-cache"}}`), "배치 저장 모양 — 프로젝트 id · 브랜치만");
check((await attr(`[data-branch-file="src-tauri/src/cache/key.rs"]`, "data-branch-file-doc-blocked")) === "", "워크트리 없는 브랜치 파일 = 문서로는 못 연다");
check((await attr(`[data-branch-file="src-tauri/src/cache/key.rs"]`, "title"))?.includes("체크아웃된 워크트리가 없어 열 수 없습니다"), "그 툴팁");
await key("End", 0, "End");
check((await ev(`document.activeElement?.getAttribute('data-branch-key')`)) === "m:m3", "End → 마지막 줄");

// ── ⑥ ✎ 줄 → 커밋 안 한 파일 ────────────────────────────────────────────────
await click(`[data-branch-key="w:C:/src/api-wt/api-login"]`); await sleep(600);
check((await ev(`JSON.stringify(window.__calls.map(c => c[0]))`)).includes("git_worktree_wip_files"), "git_worktree_wip_files 를 부름");
check((await count(`[data-branch-file]`)) === 2, "커밋 안 한 파일 둘");

// ── ⑦ 파일 Ctrl+클릭 → 문서 타일(그냥 누르면 diff 타일 — diff-tile-harness 가 본다) ──────────
await click(`[data-branch-key="c:b:fix-token:fx3"]`); await sleep(700);
await click(`[data-branch-file="src/auth/session.ts"]`, 2); await sleep(900);
const docs = JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return JSON.stringify(s.listPanes(w.activeTab().root).filter(p => p.kind === 'doc').map(p => p.path)); })()`));
check(docs.includes("C:\\src\\api-wt\\api-login\\src\\auth\\session.ts"), `문서 타일 경로 (${docs.join(",")})`);

// ── ⑧ 워크트리 줄 우클릭 "브랜치 그래프" → 같은 타일 · 그 브랜치 ────────────
await key("KeyJ", 10, "J"); await sleep(800);
const row = await rectOf(`[data-worktree-row="C:/src/api-wt/docs"]`);
await ev(`document.querySelector('[data-worktree-row="C:/src/api-wt/docs"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${row.x + 20}, clientY: ${row.y + 8} }))`);
await sleep(400);
check((await exists(`[data-worktree-action="branches"]`)) === true, "워크트리 메뉴에 '브랜치 그래프'");
await click(`[data-worktree-action="branches"]`); await sleep(800);
check((await branchPanes()).length === 1, "새 타일을 세우지 않는다");
check((await selKey()) === "c:b:docs-typo:dt1", "그 워크트리의 브랜치(docs-typo)");
// 병합된 브랜치(덩어리 없음)로 열면 — 그 접힘 줄을 고른다(다른 브랜치 커밋으로 새지 않는다).
const bgMod = importApp("app/branch-graph.svelte.ts");
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const m = await ${bgMod}; const p = w.residentWindowTabs().flatMap(t => s.listPanes(t.root)).find(p => p.kind === 'branches'); m.noteBranchGraph(p.id, { branch: 'auth-squash' }); })()`);
await sleep(600);
check((await selKey()) === "f:m6", `병합된 브랜치(auth-squash)로 열면 그 squash 접힘 줄 (${await selKey()})`);
check((await exists(`[data-branch-unfold]`)) === true, "접힘 줄 상세 — [눌러서 펼치기]");
await key("KeyJ", 10, "J"); await sleep(500);

// ── ⑨ 팔레트 "브랜치 그래프" — AI 타일(api-login)에서 ───────────────────────
await ev(`(async () => { const w = await ${tabsMod}; const t = w.tabOfPane('${ai.id}'); w.focusTile(t.id, '${ai.id}'); })()`); await sleep(400);
await key("KeyP", 10, "P"); await sleep(700);
await ev(`(() => { const i = document.querySelector('input.q'); i.value = '브랜치 그래프'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await sleep(500);
const rowIdx = await ev(`[...document.querySelectorAll('[data-row]')].findIndex(e => e.textContent.includes('브랜치 그래프'))`);
check(rowIdx >= 0, `팔레트에 '브랜치 그래프' 줄 (${rowIdx})`);
await ev(`[...document.querySelectorAll('[data-row]')][${rowIdx}].click()`); await sleep(900);
check((await selKey()) === "c:b:fix-token:fx3", `팔레트 → 지금 타일의 워크트리 브랜치 (${await selKey()})`);

// ── ⑩ 에이전트 턴 끝 → 스스로 다시 읽음(2026-11-02 — 예전 "새 변경 있음" 단추) ──────────────
const readsBefore = await ev(`window.__graphReads`);
const selBefore = await ev(`document.querySelector("[data-branch-selected]")?.textContent ?? null`);
const scrollBefore = await ev(`document.querySelector(".lwrap")?.scrollTop ?? null`);
await ev(fakeAgentSignal(`{ stream: '${ai.stream}', event: 'stop', detail: null, at: Date.now() }`)); await sleep(600);
check((await ev(`window.__graphReads`)) === readsBefore + 1, "턴 끝 → 한 번 스스로 다시 읽는다");
check((await ev(`document.querySelector("[data-branch-selected]")?.textContent ?? null`)) === selBefore, "고른 줄 그대로");
check((await ev(`document.querySelector(".lwrap")?.scrollTop ?? null`)) === scrollBefore, "스크롤 자리 그대로");

// ── ⑪ 이전 커밋 더 보기 ──────────────────────────────────────────────────────
await ev(`document.querySelector("[data-branch-more]").click()`); await sleep(600); // 목록 칸 아래 끝 — 곁에 연 문서 타일이 덮을 수 있어 직접 누른다
const lastGraph = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'git_commit_graph').at(-1)?.[1] ?? null)`);
check(JSON.parse(lastGraph)?.mainLimit === 62, `더 보기 → mainLimit 62 (${lastGraph})`);

// 좁은 타일 — 오른쪽 칸이 아래로 · 목록은 세로 스크롤만
await send("Emulation.setDeviceMetricsOverride", { width: 900, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(600);
await click("[data-branch-refresh]"); await sleep(700);
const fit = JSON.parse(await ev(`(() => { const r = document.querySelector("[data-branch-selected]"); const w = r?.closest(".lwrap"); if (!r || !w) return "null";
  const wr = w.getBoundingClientRect(); const rr = r.getBoundingClientRect();
  return JSON.stringify({ noX: w.scrollWidth <= w.clientWidth, inV: rr.top >= wr.top - 1 && rr.bottom <= wr.bottom + 1, st: w.scrollTop }); })()`));
check(fit && fit.noX && fit.inV, `새로 고침 → 고른 줄이 목록 칸 안 · 가로 스크롤 없음 (${JSON.stringify(fit)})`);
console.log("capture:", await shot("branches-narrow.png"));
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(300);

// ── ⑫ 원격 · 붙은 세션 없음 — 빈 새 탭에서 연다(시작 타일을 대신하면 탭 이름 = "브랜치 · web") ──────────
await key("KeyT", 10, "T"); await sleep(800);
await ev(`(async () => { const b = await ${importApp("app/branch-graph.svelte.ts")}; const pl = await ${importApp("app/project-list.svelte.ts")}; b.openBranchGraph(pl.projectById('R1')); })()`);
await sleep(900);
const loneTitle = await ev(`(async () => { const w = await ${tabsMod}; const ti = await ${importApp("app/titles.svelte.ts")}; return ti.displayTabTitle(w.activeTab()); })()`);
check(loneTitle === "브랜치 · web", `브랜치 타일 하나뿐인 탭 이름 (${loneTitle})`);
check((await ev(`[...document.querySelectorAll('.tab')].some(e => e.textContent.includes('브랜치 · web'))`)) === true, "탭 바에도 그 이름");
check((await exists(`[data-branch-graph="R1"] [data-branch-note="offline"]`)) === true, "원격 · 세션 없음 → 접속 후 표시됩니다");
check(!(await ev(`JSON.stringify(window.__calls.map(c => c[0]))`)).includes("ssh_git_commit_graph"), "원격 명령을 부르지 않았다");

check(errors.length === 0, `예외 0 (${errors.join(" | ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
