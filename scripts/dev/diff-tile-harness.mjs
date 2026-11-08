// Headless harness: **diff 타일** (docs/log/2026-10-05-diff-tile.md). `branch-graph-harness.mjs` 스텁의 사본 — 표와 시나리오만 다르다.
//
//   node scripts/dev/run-harness.mjs diff-tile-harness.mjs <outdir> --size 1400x900
//
// 심어 두는 것: 로컬 프로젝트 api-server(C:\src\api — 워크트리 main · api-login(fix-token, 커밋 안 한 것 있음) · detached(분리 HEAD))
// 와 원격 프로젝트 web(dev-01:~/web). `git_diff_files` 는 범위마다(브랜치 전체 = 커밋된 셋 + 커밋 안 한 둘 · 커밋 하나 · 커밋 안
// 함 · 병합 커밋 m5), `git_diff_file` 은 경로마다(보통 헝크 둘 · 이진 · 잘림 · 5천 줄 big.txt) 답한다.
//
// 보는 것: ① 독 워크트리 줄 우클릭 "변경 보기 / main 대비" → 브랜치 전체 타일(파일 목록 두 묶음 · 범위 글자 · 첫 파일 diff) ·
// 분리 HEAD 줄은 흐림 ② 범위 단추 — ✎ 커밋 안 함 · 커밋 하나 ▾(고르개) · 브랜치 전체 ③ 나란히 — 폭 900 미만은 흐림 + 말풍선 ·
// 고르면 짝 줄 · 빈 칸 빗금 · 명세에 view ④ 좁은 모드(720 미만) — 드롭다운 · `[` `]` · 옛 줄 번호 칸 없음 ⑤ 5천 줄 파일 — 첫
// 그림이 빠르고 덩어리가 이어 붙는다 ⑥ 이진 · 잘림 · 병합 커밋 ⑦ 그래프 커밋 상세의 파일 → 같은 diff 타일이 커밋 하나로
// (Ctrl+클릭은 문서 타일) · "이 커밋 전체 diff ›" ⑧ 그래프 ✎ 줄의 파일 → 커밋 안 함 ⑨ 원격 · 붙은 세션 없음 → 안내 · 원격
// 명령 없음 ⑩ 예외 0.
// PNG: `diff-dark.png` · `diff-light.png` · `diff-split.png` · `diff-narrow.png`.
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
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
    { path: 'C:/src/api-wt/detached', branch: null, head: H('d'), bare: false, detached: true },
  ];
  const C = (hash, ago, subject, parents, added, deleted) => ({ hash, parents, subject, time: N - ago, added: parents.length >= 2 ? null : (added ?? 1), deleted: parents.length >= 2 ? null : (deleted ?? 0) });
  const COMMITS = [
    C('m6', 3600, '릴리스 노트 정리', ['m5'], 12, 2),
    C('m5', 8 * 3600, "Merge branch 'feat-design-k'", ['m4', 'dk2']),
    C('m4', 2 * 86400, '자동 승인 카드 높이 맞춤', ['m3'], 6, 6),
    C('fx3', 2 * 3600, '토큰 갱신 경합 수정', ['fx2'], 40, 12),
    C('fx2', 5 * 3600, '재시도 한도 추가', ['fx1'], 30, 5),
    C('fx1', 20 * 3600, '갱신 경합 테스트', ['m4'], 14, 2),
    C('dk2', 26 * 3600, '설정 툴팁', ['m4'], 26, 9),
  ];
  const br = (name, commits, base) => ({ name, head: commits[0], base, ahead: commits.length, behind: 0, commits, commits_truncated: false, merged: false, merged_kind: null, created_from: null, created_at: null });
  const GRAPH = {
    main: 'main', main_head: 'm6', main_more: false, truncated: false,
    main_line: ['m6', 'm5', 'm4'].map((hash) => ({ hash, skipped_before: 0 })),
    commits: COMMITS,
    branches: [br('fix-token', ['fx3', 'fx2', 'fx1'], 'm4')],
    folds: [{ merge: 'm5', name: 'feat-design-k', commits: ['dk2'], commits_truncated: false, base: 'm4', kind: 'merge' }],
    worktrees: [
      { path: 'C:/src/api', branch: 'main', head: 'm6', primary: true, dirty: null },
      { path: 'C:/src/api-wt/api-login', branch: 'fix-token', head: 'fx3', primary: false, dirty: { files: 2, added: 39, deleted: 9 } },
    ],
  };
  const cf = (path, status, added, deleted, old_path) => ({ path, old_path: old_path ?? null, status, added, deleted });
  const GFILES = { fx3: [cf('src/auth/refresh.rs', 'M', 22, 5), cf('src/auth/retry.rs', 'A', 8, 0)] };
  const GWIP = { 'C:/src/api-wt/api-login': [cf('src/lib/auth-status.ts', 'M', 5, 19), cf('notes/todo.md', 'A', 2, 0)] };
  const de = (path, status, added, deleted, group, extra = {}) => ({ path, old_path: null, status, added, deleted, binary: false, group, ...extra });
  const COMMITTED = [
    de('src/auth/mod.rs', 'M', 6, 2, 'committed'),
    de('src/auth/refresh.rs', 'M', 34, 10, 'committed'),
    de('src/auth/retry.rs', 'A', 48, 0, 'committed'),
    de('assets/logo.png', 'M', null, null, 'committed', { binary: true }),
    de('gen/huge.json', 'M', 30000, 0, 'committed'),
    de('big.txt', 'A', 5000, 0, 'committed'),
  ];
  const UNCOMMITTED = [de('src/lib/auth-status.ts', 'M', 5, 19, 'uncommitted'), de('notes/todo.md', 'A', 2, 0, 'uncommitted')];
  const commitsList = [{ hash: 'fx3', subject: '토큰 갱신 경합 수정', time: N - 7200 }, { hash: 'fx2', subject: '재시도 한도 추가', time: N - 18000 }, { hash: 'fx1', subject: '갱신 경합 테스트', time: N - 72000 }];
  const files = (s) => {
    const base = { main: 'main', branch: s.branch ?? null, base: null, tip: null, worktree: null, head: null, merge: false, root: false, files: [], commits: commitsList, commits_truncated: false, wip_count: null, truncated: false };
    // __dupRefresh: 같은 경로(refresh.rs)가 ✎ 커밋 안 함 묶음에도 있는 판(코멘트 배지가 묶음별로 세는지 — 2단계 실기 뒤).
    const unc = window.__dupRefresh ? [...UNCOMMITTED, de('src/auth/refresh.rs', 'M', 3, 1, 'uncommitted')] : UNCOMMITTED;
    if (s.kind === 'branch') return { ...base, base: 'm4'.padEnd(10, '0'), tip: 'fx3'.padEnd(10, '0'), worktree: 'C:/src/api-wt/api-login', head: 'fx3', files: [...COMMITTED, ...unc], wip_count: unc.length };
    if (s.kind === 'commit') {
      if (s.commit === 'm5') return { ...base, tip: 'm5', base: 'm4', merge: true };
      return { ...base, tip: s.commit, base: 'parent', worktree: s.branch === 'fix-token' ? 'C:/src/api-wt/api-login' : null, files: (GFILES[s.commit] ?? GFILES.fx3).map((f) => de(f.path, f.status, f.added, f.deleted, 'committed')), wip_count: 2 };
    }
    return { ...base, branch: 'fix-token', worktree: s.worktree, head: 'fx3', tip: 'fx3', files: UNCOMMITTED, wip_count: 2 };
  };
  const ctx = (o, n, text) => ({ kind: 'ctx', old_no: o, new_no: n, text, no_newline: false });
  const add = (n, text) => ({ kind: 'add', old_no: null, new_no: n, text, no_newline: false });
  const del = (o, text) => ({ kind: 'del', old_no: o, new_no: null, text, no_newline: false });
  const NORMAL = [
    { old_start: 38, old_lines: 5, new_start: 38, new_lines: 10, section: 'impl Refresher', lines: [
      ctx(38, 38, '    pub async fn refresh(&self) -> Result<Token> {'), ctx(39, 39, '        let _guard = self.lock.lock().await;'),
      del(40, '        let tok = self.fetch().await?;'),
      add(40, '        let mut tries = 0;'), add(41, '        let tok = loop {'), add(42, '            match self.fetch().await {'),
      add(43, '                Ok(t) => break t,'), add(44, '                Err(e) if tries < 3 => { tries += 1; backoff(tries).await }'),
      add(45, '                Err(e) => return Err(e),'), add(46, '            }'), add(47, '        };'),
      ctx(41, 48, '        self.store(&tok)?;'), ctx(42, 49, '        Ok(tok)'),
    ] },
    { old_start: 71, old_lines: 2, new_start: 78, new_lines: 3, section: 'impl Refresher', lines: [
      ctx(71, 78, '    fn expired(&self, t: &Token) -> bool {'), del(72, '        t.exp <= now()'),
      add(79, '        let skew = Duration::from_secs(30); // ' + 'x'.repeat(240)), add(80, '        t.exp <= now() + skew'),
    ] },
  ];
  const fileOf = (a) => {
    const base = { path: a.path, old_path: a.oldPath ?? null, binary: false, hunks: NORMAL, truncated: false, added: 10, deleted: 2 };
    if (a.path === 'assets/logo.png') return { ...base, binary: true, hunks: [], added: 0, deleted: 0 };
    if (a.path === 'gen/huge.json') return { ...base, truncated: true, hunks: [{ old_start: 0, old_lines: 0, new_start: 1, new_lines: 300, section: '', lines: Array.from({ length: 300 }, (_, i) => add(i + 1, '  "k' + i + '": ' + i + ',')) }] };
    if (a.path === 'big.txt') return { ...base, added: 5000, deleted: 0, hunks: [{ old_start: 0, old_lines: 0, new_start: 1, new_lines: 5000, section: '', lines: Array.from({ length: 5000 }, (_, i) => add(i + 1, 'line ' + i + ' ' + 'y'.repeat(i % 40))) }] };
    return base;
  };
  const answers = {
    list_hosts: { hosts: [host('dev-01', '10.0.0.9')], warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
    load_snippets: null, save_snippets: null,
    load_settings: { projects: { start_screen: 'off' }, terminal: { webgl: false } }, save_settings: null,
    host_history_list: {},
    projects_list: [
      { id: 'L1', name: 'api-server', host: null, path: 'C:\\\\src\\\\api', shell: null, command: 'claude', tmux: false },
      { id: 'R1', name: 'web', host: 'dev-01', path: '~/web', shell: null, command: 'claude', tmux: false },
    ],
    git_worktree_list: WT,
    git_worktree_changes: (a) => (a.paths ?? []).filter((p) => p !== 'C:/src/api').map((p) => ({ path: p, ahead: 3, added_lines: 84, deleted_lines: 19, merged: false })),
    git_commit_graph: GRAPH,
    git_commit_files: (a) => ({ hash: a.hash, merge: a.hash === 'm5', files: GFILES[a.hash] ?? [], truncated: false }),
    git_worktree_wip_files: (a) => ({ path: a.path, head: 'fx3', files: GWIP[a.path] ?? [], truncated: false }),
    git_diff_files: (a) => files(a.scope),
    git_diff_file: (a) => fileOf(a),
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    local_read_text: (a) => ({ path: a.path, text: 'x', version: '1', size: 1, binary: false, truncated: false }),
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: args?.shell ?? 'pwsh' }); }
      if (cmd === 'write_session') { window.__writes.push([args.id, args.data]); return Promise.resolve(null); }
      if (!(cmd in answers)) return Promise.reject(new Error('stub: ' + cmd));
      const a = answers[cmd];
      return Promise.resolve(typeof a === 'function' ? a(args ?? {}) : a);
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  window.__chan = {}; window.__writes = []; window.__clip = [];
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  try { Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__clip.push(t); return Promise.resolve(); }, readText: () => Promise.resolve('') } }); } catch {}
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);
errors.length = 0;
// 다시 읽힘 감지 — 스텁(`__calls`)은 새 문서마다 다시 서므로 그것으로는 리로드를 못 본다. 부팅 뒤 한 번 심은 표식이
// 끝까지 남아 있어야 한다(⑧ 에서 "페이지가 다시 읽혔다" 는 보고 — 2026-10-27 확인용).
await ev(`window.__bootMark = 1`);

const VK = { Enter: 13, Escape: 27, Tab: 9, ArrowUp: 38, ArrowDown: 40, BracketLeft: 219, BracketRight: 221 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, ...(type === "keyDown" && k.length === 1 && !(modifiers & 2) ? { text: k } : {}), ...(type === "keyDown" && code === "Enter" ? { text: "\r" } : {}) }); await sleep(250); };
const rectOf = async (sel) => JSON.parse(await ev(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`));
const clickAt = async (x, y, modifiers = 0) => { await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, modifiers }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1, modifiers }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1, modifiers }); await sleep(350); };
const click = async (sel, modifiers = 0) => { const r = await rectOf(sel); await clickAt(r.x + r.width / 2, r.y + r.height / 2, modifiers); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const tabsMod = importApp("app/tabs.svelte.ts");
const cwdMod = importApp("app/pane-cwd.svelte.ts");
const sessionsMod = importApp("app/sessions.svelte.ts");
const sessMod = importApp("lib/session.ts");
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const attr = (sel, name) => ev(`document.querySelector(${JSON.stringify(sel)})?.getAttribute('${name}') ?? null`);
const count = (sel) => ev(`document.querySelectorAll(${JSON.stringify(sel)}).length`);
const text = (sel) => ev(`document.querySelector(${JSON.stringify(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const diffPanes = () => ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return JSON.stringify(w.residentWindowTabs().flatMap(t => s.listPanes(t.root)).filter(p => p.kind === 'diff').map(p => p.diff)); })()`).then(JSON.parse);
const lastCall = (cmd) => ev(`JSON.stringify(window.__calls.filter(c => c[0] === '${cmd}').at(-1)?.[1] ?? null)`).then(JSON.parse);
const callCount = (cmd) => ev(`window.__calls.filter(c => c[0] === '${cmd}').length`);
const selFile = () => attr(`[data-diff-file][aria-pressed="true"]`, "data-diff-file");
const setWidth = async (w) => { await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false }); await sleep(600); };

// ── ① 독 워크트리 줄 우클릭 "변경 보기" → 브랜치 전체 ───────────────────────
const openWtMenu = async (wt) => {
  const row = await rectOf(`[data-worktree-row="${wt}"]`);
  await ev(`document.querySelector('[data-worktree-row="${wt}"]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${row.x + 20}, clientY: ${row.y + 8} }))`);
  await sleep(400);
};
await key("KeyJ", 10, "J"); await sleep(900);
await click(`[data-project-id="L1"] [data-project-twisty]`); await sleep(900);
await openWtMenu("C:/src/api-wt/detached");
check((await attr(`[data-worktree-action="diff"]`, "aria-disabled")) === "true", "분리 HEAD 워크트리의 '변경 보기' = 흐림");
await key("Escape", 0, "Escape"); await sleep(300);
await openWtMenu("C:/src/api-wt/api-login");
check((await text(`[data-worktree-action="diff"]`)) === "변경 보기main 대비" || (await text(`[data-worktree-action="diff"]`)) === "변경 보기 main 대비", `메뉴 줄 = 변경 보기 · main 대비 (${await text(`[data-worktree-action="diff"]`)})`);
await click(`[data-worktree-action="diff"]`); await sleep(1500);
await key("KeyJ", 10, "J"); await sleep(500);
const tabLabel = await ev(`(async () => { const w = await ${tabsMod}; const ti = await ${importApp("app/titles.svelte.ts")}; return ti.displayTabTitle(w.activeTab()); })()`);
check(tabLabel === "변경 · fix-token", `빈 탭을 대신한 diff 타일 — 탭 이름 '변경 · fix-token' (${tabLabel})`);
check((await ev(`[...document.querySelectorAll('[data-tab-id], .tab')].some(e => e.textContent.includes('변경 · fix-token'))`)) === true, "탭 바에도 그 이름");
check(JSON.stringify(await diffPanes()) === JSON.stringify([{ projectId: "L1", scope: "branch", branch: "fix-token", worktreePath: "C:/src/api-wt/api-login", name: "api-server" }]), `명세(처음 고른 파일은 사람이 고른 것이 아니라 적지 않는다) = ${JSON.stringify(await diffPanes())}`);
check(JSON.stringify((await lastCall("git_diff_files"))?.scope) === JSON.stringify({ kind: "branch", branch: "fix-token" }), "git_diff_files — 브랜치 전체");
check((await count(`[data-diff-file][data-diff-group="committed"]`)) === 6 && (await count(`[data-diff-file][data-diff-group="uncommitted"]`)) === 2, "파일 목록 — 커밋된 6 + ✎ 커밋 안 함 2");
check((await exists(`[data-diff-group-head="uncommitted"]`)) === true, "✎ 커밋 안 함 묶음 머리");
check((await text(`[data-diff-range]`)) === "merge-base m400000 … HEAD fx30000 + 작업 폴더", `범위 글자 (${await text(`[data-diff-range]`)})`);
check((await text(`[data-diff-scope-btn="branch"]`)) === "브랜치 전체 main 대비", `범위 단추 (${await text(`[data-diff-scope-btn="branch"]`)})`);
check((await text(`[data-diff-wip-count]`)) === "2", "✎ 커밋 안 함 2");
check((await text(`[data-diff-summary]`))?.startsWith("파일 8개"), `요약 (${await text(`[data-diff-summary]`)})`);
check((await selFile()) === "src/auth/mod.rs", "첫 파일을 고른 채");
const fileArgs = await lastCall("git_diff_file");
check(JSON.stringify(fileArgs) === JSON.stringify({ repo: "C:\\src\\api", scope: { kind: "branch", branch: "fix-token" }, path: "src/auth/mod.rs", oldPath: null, group: "committed" }), `git_diff_file — 그 파일 · 커밋된 묶음 (${JSON.stringify(fileArgs)})`);
check((await count(`[data-diff-hunk]`)) === 2 && (await count(`[data-diff-row]`)) === 17, `헝크 둘 · 줄 17 (${await count("[data-diff-row]")})`);
check((await attr(`[data-diff-row="40:-"]`, "data-diff-kind")) === "del" && (await attr(`[data-diff-row="-:43"]`, "data-diff-kind")) === "add", "뺌 · 더함 줄");
const longRow = await ev(`(() => { const b = document.querySelector('[data-diff-body]'); return JSON.stringify({ sw: b.scrollWidth, cw: b.clientWidth, h: document.querySelector('[data-diff-row="-:79"]').getBoundingClientRect().height }); })()`);
check(JSON.parse(longRow).sw > JSON.parse(longRow).cw && JSON.parse(longRow).h <= 21, `긴 줄은 접지 않고 가로 스크롤 (${longRow})`);
check((await attr(`[data-diff-doc]`, "disabled")) === null, "[문서로 열기] 켜짐(워크트리 있음)");
console.log("capture:", await shot("diff-dark.png"));
await ev(`document.documentElement.dataset.theme = 'light'`); await sleep(300);
console.log("capture:", await shot("diff-light.png"));
await ev(`delete document.documentElement.dataset.theme`); await sleep(200);

// 커밋 안 한 묶음의 같은 경로가 아닌 파일 → group uncommitted
await click(`[data-diff-file="src/lib/auth-status.ts"]`); await sleep(500);
check((await lastCall("git_diff_file"))?.group === "uncommitted", "커밋 안 한 파일 → group uncommitted");
check((await diffPanes())[0].file === "src/lib/auth-status.ts", "고른 파일이 명세에");

// ── ⑥ 이진 · 잘림 ───────────────────────────────────────────────────────────
await click(`[data-diff-file="assets/logo.png"]`); await sleep(500);
check((await exists(`[data-diff-note="binary"]`)) === true, "이진 파일 안내");
await click(`[data-diff-file="gen/huge.json"]`); await sleep(500);
check((await exists(`[data-diff-note="truncated"]`)) === true, "잘림 안내 + [문서로 열기]");

// ── ⑤ 5천 줄 ─────────────────────────────────────────────────────────────────
const t0 = Date.now();
await ev(`document.querySelector('[data-diff-file="big.txt"]').click()`);
let firstPaint = -1;
for (let i = 0; i < 40; i++) { if ((await count(`[data-diff-row]`)) > 0) { firstPaint = Date.now() - t0; break; } await sleep(50); }
check(firstPaint >= 0 && firstPaint < 1500, `5천 줄 — 첫 그림 ${firstPaint}ms`);
await sleep(1500);
const rowsBig = await count(`[data-diff-row]`);
check(rowsBig === 5000, `덩어리가 이어 붙어 5천 줄 모두 (${rowsBig})`);
const scrollMs = await ev(`(() => { const b = document.querySelector('[data-diff-body]'); const t = performance.now(); b.scrollTop = b.scrollHeight / 2; b.getBoundingClientRect(); document.body.offsetHeight; return Math.round(performance.now() - t); })()`);
check(scrollMs < 300, `가운데로 스크롤 ${scrollMs}ms`);

// ── ② 범위 단추 ─────────────────────────────────────────────────────────────
await click(`[data-diff-file="src/auth/refresh.rs"]`); await sleep(500);
await click(`[data-diff-scope-btn="wip"]`); await sleep(900);
check((await diffPanes())[0].scope === "wip" && JSON.stringify((await lastCall("git_diff_files"))?.scope) === JSON.stringify({ kind: "wip", worktree: "C:/src/api-wt/api-login", branch: "fix-token" }), `✎ 커밋 안 함 → wip (${JSON.stringify(await lastCall("git_diff_files"))})`);
check((await text(`[data-diff-range]`)) === "HEAD … 작업 폴더", "범위 글자 — HEAD … 작업 폴더");
check((await count(`[data-diff-file]`)) === 2, "커밋 안 한 파일 둘만");
await click(`[data-diff-scope-btn="commit"]`); await sleep(400);
check((await count(`[data-diff-commit]`)) === 3, "커밋 고르개 — 셋");
await click(`[data-diff-commit="fx2"]`); await sleep(900);
check((await diffPanes())[0].scope === "commit" && (await diffPanes())[0].commit === "fx2", "커밋 하나 — fx2");
check((await text(`[data-diff-range]`)) === "fx2^ … fx2", `범위 글자 — fx2^ … fx2 (${await text(`[data-diff-range]`)})`);
check((await text(`[data-diff-scope-btn="commit"]`))?.startsWith("커밋 fx2 · 재시도 한도 추가"), `커밋 단추 글 (${await text(`[data-diff-scope-btn="commit"]`)})`);
check((await exists(`[data-diff-commit-menu]`)) === false, "고르개는 닫힌다");
await click(`[data-diff-scope-btn="branch"]`); await sleep(900);
check((await diffPanes())[0].scope === "branch" && (await count(`[data-diff-file]`)) === 8, "브랜치 전체로 돌아옴");

// ── ③ 나란히 ─────────────────────────────────────────────────────────────────
check((await attr(`[data-diff-view-btn="split"]`, "disabled")) === null, "폭 1400 — 나란히 고를 수 있다");
await click(`[data-diff-file="src/auth/refresh.rs"]`); await sleep(500);
await click(`[data-diff-view-btn="split"]`); await sleep(500);
check((await attr(`[data-diff-pane]`, "data-diff-view")) === "split" && (await diffPanes())[0].view === "split", "나란히 — 명세에 view");
check((await count(`[data-diff-rows="split"] .pair`)) > 0 && (await count(`[data-diff-rows="split"] .fill`)) >= 7, `짝 줄 · 빈 칸 빗금 (${await count(".fill")})`);
const pairAlign = await ev(`(() => { const p = document.querySelector('[data-diff-row="-:41"]'); const [a, b] = p.querySelectorAll('.side'); return Math.abs(a.getBoundingClientRect().top - b.getBoundingClientRect().top) < 1 && Math.abs(a.getBoundingClientRect().height - b.getBoundingClientRect().height) < 1; })()`);
check(pairAlign === true, "짝의 두 칸이 같은 높이 · 같은 줄");
console.log("capture:", await shot("diff-split.png"));
await setWidth(1100);
check((await attr(`[data-diff-view-btn="split"]`, "disabled")) === null && (await attr(`[data-diff-pane]`, "data-diff-view")) === "split", "창 1100(175% 배율 최대화 · 타일 ~1046) — 나란히 그대로");
await setWidth(850);
check((await attr(`[data-diff-view-btn="split"]`, "disabled")) !== null && (await attr(`[data-diff-pane]`, "data-diff-view")) === "unified", "창 850 — 나란히 흐림 · 한 줄로 그림");
check((await attr(`[data-diff-view-btn="split"]`, "title")) === "타일 폭이 900px 이상일 때만 나란히 볼 수 있습니다", "그 말풍선");
check((await diffPanes())[0].view === "split", "고른 보기는 명세에 남는다(타일마다 기억)");

// ── ④ 좁은 모드 ─────────────────────────────────────────────────────────────
await setWidth(700);
check((await exists(`[data-diff-pane][data-diff-narrow]`)) === true && (await exists(`.lcol`)) === false, "좁은 모드 — 파일 목록 없음");
check((await text(`[data-diff-narrow-picker] .pos`)) === "2 / 8 ▾", `드롭다운 — 2 / 8 (${await text(`[data-diff-narrow-picker] .pos`)})`);
check((await count(`[data-diff-row="-:41"] .no`)) === 1, "옛 줄 번호 칸 없음(번호 하나)");
check((await text(`[data-diff-row="40:-"] .no`)) === "40", "지운 줄은 옛 번호");
await ev(`document.querySelector('[data-diff-pane]').focus()`);
await key("BracketRight", 0, "]"); await sleep(500);
check((await diffPanes())[0].file === "src/auth/retry.rs", "] → 다음 파일");
await key("BracketLeft", 0, "["); await sleep(500);
check((await diffPanes())[0].file === "src/auth/refresh.rs", "[ → 이전 파일");
await click(`[data-diff-narrow-picker]`); await sleep(300);
check((await count(`[data-diff-file-item]`)) === 8, "드롭다운 목록 여덟");
console.log("capture:", await shot("diff-narrow.png"));
await click(`[data-diff-file-item="src/lib/auth-status.ts"]`); await sleep(500);
check((await diffPanes())[0].file === "src/lib/auth-status.ts" && (await exists(`[data-diff-file-menu]`)) === false, "드롭다운에서 고름 · 닫힘");
await setWidth(1400);

// ── ⑥ 병합 커밋 ─────────────────────────────────────────────────────────────
const dvMod = importApp("app/diff-view.svelte.ts");
const plMod = importApp("app/project-list.svelte.ts");
await ev(`(async () => { const d = await ${dvMod}; const pl = await ${plMod}; d.openDiff(pl.projectById('L1'), { scope: 'commit', commit: 'm5', branch: 'fix-token' }); })()`);
await sleep(900);
check((await exists(`[data-diff-note="merge"]`)) === true, "병합 커밋 — 바뀐 내용은 합쳐진 브랜치 쪽");
check((await diffPanes()).length === 1, "같은 브랜치 — 새 타일 없이 그 타일");

// ── ⑦ 그래프 커밋 상세의 파일 → 같은 diff 타일 · 커밋 하나 ──────────────────
await ev(`(async () => { const b = await ${importApp("app/branch-graph.svelte.ts")}; const pl = await ${plMod}; b.openBranchGraph(pl.projectById('L1'), 'fix-token'); })()`);
await sleep(1400);
check((await exists(`[data-branch-diff-all]`)) === true && (await text(`[data-branch-diff-all]`)) === "이 커밋 전체 diff ›", "바뀐 파일 머리 — 이 커밋 전체 diff ›");
await click(`[data-branch-file="src/auth/retry.rs"]`); await sleep(1000);
const afterGraph = await diffPanes();
check(afterGraph.length === 1 && afterGraph[0].scope === "commit" && afterGraph[0].commit === "fx3" && afterGraph[0].file === "src/auth/retry.rs", `파일 → 커밋 하나 · 그 파일 (${JSON.stringify(afterGraph)})`);
check((await attr(`[data-diff-file-head]`, "data-diff-file-head")) === "src/auth/retry.rs", "그 파일을 고른 채");
const docsBefore = Number(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return w.residentWindowTabs().flatMap(t => s.listPanes(t.root)).filter(p => p.kind === 'doc').length; })()`));
await click(`[data-branch-file="src/auth/refresh.rs"]`, 2); await sleep(900);
const docsAfter = Number(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return w.residentWindowTabs().flatMap(t => s.listPanes(t.root)).filter(p => p.kind === 'doc').length; })()`));
check(docsAfter === docsBefore + 1, `Ctrl+클릭 → 문서 타일 (${docsBefore} → ${docsAfter})`);
check((await diffPanes())[0].file === "src/auth/retry.rs", "Ctrl+클릭은 diff 를 바꾸지 않는다");
// 문서 타일은 닫는다(타일이 셋이면 그래프 칸이 좁아진다).
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const d = w.residentWindowTabs().flatMap(t => s.listPanes(t.root)).find(p => p.kind === 'doc'); if (d) w.closePaneIn(w.tabOfPane(d.id).id, d.id); })()`);
await sleep(400);
check((await ev(`window.__bootMark`)) === 1 && (await ev(`location.href`)).includes("localhost"), "페이지가 그대로(다시 읽히지 않았다)");

// ── ⑧ 그래프 ✎ 줄의 파일 → 커밋 안 함 ────────────────────────────────────────
await click(`[data-branch-key="w:C:/src/api-wt/api-login"]`); await sleep(700);
check((await text(`[data-branch-diff-all]`)) === "커밋 안 한 변경 전체 diff ›", "✎ 줄 — 커밋 안 한 변경 전체 diff ›");
await ev(`document.querySelector('[data-branch-file="notes/todo.md"]').click()`); await sleep(1000);
const afterWip = await diffPanes();
check(afterWip.length === 1 && afterWip[0].scope === "wip" && afterWip[0].worktreePath === "C:/src/api-wt/api-login" && afterWip[0].file === "notes/todo.md", `✎ 파일 → 커밋 안 함 (${JSON.stringify(afterWip)})`);
check((await ev(`window.__bootMark`)) === 1, "⑧ 뒤에도 페이지가 그대로(다시 읽히지 않았다)");

// ══ 2단계 — 줄 코멘트 → AI 타일 ═════════════════════════════════════════════════
// 그래프 타일은 닫고(diff 타일 혼자 → 폭 1400) AI 타일 둘을 다른 탭에 연다: api-login 워크트리(같은 워크트리) · 주 폴더.
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; for (const p of w.residentWindowTabs().flatMap(t => s.listPanes(t.root)).filter(p => p.kind === 'branches')) w.closePaneIn(w.tabOfPane(p.id).id, p.id); })()`);
await sleep(500);
const diffId = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return w.residentWindowTabs().flatMap(t => s.listPanes(t.root)).find(p => p.kind === 'diff').id; })()`);
const openAi = async (cwd) => JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod};
  const p = s.newLocalPane(); Object.assign(p, { cwd: ${JSON.stringify(cwd)}, autorun: 'claude' }); w.openInNewTab(p);
  return JSON.stringify({ id: p.id }); })()`));
const aiSame = await openAi("C:/src/api-wt/api-login");
await sleep(1500);
const aiMain = await openAi("C:/src/api");
await sleep(1500);
const ESC = "\x1b", BEL = "\x07";
const prompt = `${ESC}]133;A${BEL}PS> ${ESC}]133;B${BEL}`;
const sidOf = (id) => ev(`(async () => (await ${sessionsMod}).sessionOf(${JSON.stringify(id)}))()`);
for (const [ai, cwd] of [[aiSame, "C:/src/api-wt/api-login"], [aiMain, "C:/src/api"]]) {
  ai.sid = await sidOf(ai.id);
  await ev(`(async () => (await ${cwdMod}).noteReportedCwd(${JSON.stringify(ai.id)}, ${JSON.stringify(cwd)}))()`);
  await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${prompt}claude\r\n${ESC}]133;C${BEL}`)})`);
  await sleep(650);
  await ev(`window.__feed(${ai.sid}, ${JSON.stringify(`${ESC}[?2004h╭─ Claude ─╮\r\n│ > │\r\n╰──────╯\r\n`)})`);
  await sleep(150);
}
check(typeof aiSame.sid === "number" && typeof aiMain.sid === "number", `AI 타일 세션 둘 (${aiSame.sid}, ${aiMain.sid})`);
await ev(`(async () => { const w = await ${tabsMod}; w.focusTile(w.tabOfPane(${JSON.stringify(diffId)}).id, ${JSON.stringify(diffId)}); })()`);
await sleep(500);
await ev(`(async () => { const d = await ${dvMod}; const pl = await ${plMod}; d.openDiff(pl.projectById('L1'), { scope: 'branch', branch: 'fix-token', file: 'src/auth/refresh.rs' }); })()`);
await sleep(1200);
await ev(`(async () => { const d = await ${dvMod}; d.noteDiff(${JSON.stringify(diffId)}, { view: undefined }); })()`);
await sleep(500);
check((await attr(`[data-diff-file-head]`, "data-diff-file-head")) === "src/auth/refresh.rs" && (await attr(`[data-diff-pane]`, "data-diff-view")) === "unified", "diff 타일 혼자 · refresh.rs · 한 줄");
check((await text(`.fhint`)) === "줄 번호를 끌어 여러 줄 고르기 · 고른 뒤 C 로 코멘트", "파일 머리의 안내");

// ── S1 줄 고르기 — 누름 · Shift+클릭 ──
await click(`[data-diff-sel="-:43"]`);
check((await count(`.selrow`)) === 1, "줄 번호 누름 → 한 줄");
await click(`[data-diff-sel="-:45"]`, 8);
check((await count(`.selrow`)) === 3, `Shift+클릭 → 43–45 (${await count(".selrow")})`);
check((await exists(`[data-diff-selbar]`)) === true, "+ 코멘트 줄");

// ── S2 C → 입력 칸 · Ctrl+Enter 추가 ──
await key("KeyC", 0, "c"); await sleep(300);
check((await exists(`[data-diff-composer]`)) === true && (await text(`[data-diff-composer] label`)) === "43–45행에 코멘트", "C → 43–45행에 코멘트");
check((await ev(`document.activeElement?.tagName`)) === "TEXTAREA", "입력 칸에 포커스");
check((await text(`[data-diff-chip-writing]`))?.includes("(쓰는 중)"), "트레이 — 쓰는 중 칩");
await key("BracketRight", 0, "]");
check((await diffPanes())[0].file === "src/auth/refresh.rs", "입력 칸 안의 ] 는 파일을 넘기지 않는다");
await ev(`(() => { const t = document.querySelector('[data-diff-composer] textarea'); t.value = '3 은 설정값으로 빼 줘. backoff 도 최대 대기 시간을 두고.'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await key("Enter", 2, "Enter"); await sleep(300);
check((await exists(`[data-diff-composer]`)) === false && (await count(`[data-diff-comment]`)) === 1, "Ctrl+Enter → 카드 하나");
check((await ev(`document.querySelector('[data-diff-row="-:45"]').nextElementSibling?.matches('[data-diff-comment]')`)) === true, "카드는 범위 마지막 줄 바로 아래");
check((await text(`[data-diff-file="src/auth/refresh.rs"] [data-diff-comment-count]`)) === "1", "파일 목록 배지 1");
check((await text(`[data-diff-tray] .tcount`)) === "코멘트 1개", "트레이 — 코멘트 1개");

// ── S3 끌어서 고르기 → + 코멘트 단추 ──
const r79 = await rectOf(`[data-diff-sel="-:79"]`); const r80 = await rectOf(`[data-diff-sel="-:80"]`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r79.x + 10, y: r79.y + 8 });
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: r79.x + 10, y: r79.y + 8, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r80.x + 10, y: r80.y + 8, button: "left", buttons: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r80.x + 10, y: r80.y + 8, button: "left", clickCount: 1 });
await sleep(300);
check((await count(`.selrow`)) === 2, `끌기 → 79–80 (${await count(".selrow")})`);
await click(`[data-diff-add-comment]`); await sleep(300);
check((await text(`[data-diff-composer] label`)) === "79–80행에 코멘트", "+ 코멘트 → 79–80행");
await ev(`(() => { const t = document.querySelector('[data-diff-composer] textarea'); t.value = '30초 여유가 왜 필요한지 주석 한 줄 달아 줘.'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await click(`[data-diff-composer-submit]`); await sleep(300);
check((await count(`[data-diff-comment]`)) === 2 && (await text(`[data-diff-file="src/auth/refresh.rs"] [data-diff-comment-count]`)) === "2", "코멘트 둘 · 배지 2");

// ── S3b 같은 경로가 ✎ 커밋 안 함에도 있으면 — 배지 · 카드는 그 묶음 · 그 범위의 것만 ──
await ev(`window.__dupRefresh = true`);
await click(`[data-diff-refresh]`); await sleep(900);
const cRef = `[data-diff-file="src/auth/refresh.rs"][data-diff-group="committed"]`;
const uRef = `[data-diff-file="src/auth/refresh.rs"][data-diff-group="uncommitted"]`;
check((await exists(uRef)) === true, "✎ 커밋 안 함 묶음에도 refresh.rs");
check((await text(`${cRef} [data-diff-comment-count]`)) === "2" && (await exists(`${uRef} [data-diff-comment-count]`)) === false, "배지는 커밋된 refresh.rs 에만 2 (같은 경로를 두 번 세지 않는다)");
await click(uRef); await sleep(600);
check((await count(`[data-diff-comment]`)) === 0 && (await count(`[data-diff-chip]`)) === 2, "✎ refresh.rs — 카드 없음 · 칩은 둘");
await click(`[data-diff-scope-btn="wip"]`); await sleep(1000);
check((await count(`[data-diff-comment]`)) === 0 && (await exists(`[data-diff-comment-count]`)) === false && (await count(`[data-diff-chip]`)) === 2, "커밋 안 함 범위 — 다른 범위의 카드 · 배지 없음, 칩은 남음");
await click(`[data-diff-chip]`); await sleep(1200);
check((await diffPanes())[0].scope === "branch" && (await attr(`[data-diff-file-head]`, "data-diff-file-head")) === "src/auth/refresh.rs", "칩 → 그 코멘트의 범위(브랜치 전체)로 돌아옴");
await click(cRef); await sleep(600);
check((await count(`[data-diff-comment]`)) === 2, "커밋된 refresh.rs — 카드 둘");
await ev(`window.__dupRefresh = false`);
await click(`[data-diff-refresh]`); await sleep(900);

// ── S4 나란히 — 지운 줄은 옛 번호 · Esc 취소 ──
await click(`[data-diff-view-btn="split"]`); await sleep(500);
check((await count(`[data-diff-comment]`)) === 2, "나란히로 바꿔도 카드 둘이 그 줄 아래에");
await click(`.side.old [data-diff-sel="72:-"]`);
check((await count(`.side.selrow`)) === 1, "나란히 — 왼쪽 지운 줄 고름");
await key("KeyC", 0, "c"); await sleep(300);
check((await text(`[data-diff-composer] label`)) === "옛 72행에 코멘트", "지운 줄 = 옛 72행");
await key("Escape", 0, "Escape"); await sleep(300);
check((await exists(`[data-diff-composer]`)) === false && (await count(`[data-diff-comment]`)) === 2, "Esc → 취소(코멘트 그대로)");
console.log("capture:", await shot("diff-comments-split.png"));
await click(`[data-diff-view-btn="unified"]`); await sleep(400);

// ── S5 받을 곳 — 같은 워크트리가 먼저 · 골라진 채 ──
check((await attr(`[data-diff-target]`, "data-diff-target")) === aiSame.id, `받을 곳 = 같은 워크트리 AI 타일 (${await attr("[data-diff-target]", "data-diff-target")})`);
check((await text(`[data-diff-target]`)) === "받을 곳: Claude Code · api-login ▾", `받을 곳 글 (${await text("[data-diff-target]")})`);
check((await text(`[data-diff-tray] .thint`)) === "붙여 넣기만 합니다 — 보내기(Enter)는 직접", "트레이 안내");
await click(`[data-diff-target]`); await sleep(300);
const items = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-diff-target-item]')].map(e => e.getAttribute('data-diff-target-item') + '|' + e.textContent.replace(/\\s+/g, ' ').trim()))`));
check(items.length === 2 && items[0].startsWith(aiSame.id) && items[0].includes("같은 워크트리") && !items[1].includes("같은 워크트리"), `고르개 줄 (${items.join(" / ")})`);
console.log("capture:", await shot("diff-comments.png"));
await key("Escape", 0, "Escape"); await sleep(200);

// ── S6 Ctrl+Shift+X → 괄호 붙여넣기 한 덩어리 · Enter 없음 ──
await ev(`document.querySelector('[data-diff-pane]').focus()`);
const writesBefore = await ev(`window.__writes.length`);
await key("KeyX", 10, "X"); await sleep(900);
const sent = JSON.parse(await ev(`JSON.stringify(window.__writes.slice(${writesBefore}))`));
check(sent.length === 1 && sent[0][0] === aiSame.sid, `같은 워크트리 AI 타일 세션에 한 번 (${JSON.stringify(sent.map(w => w[0]))})`);
const data = sent[0]?.[1] ?? "";
check(data.startsWith("\x1b[200~") && data.endsWith("\x1b[201~"), "괄호 붙여넣기로 감쌌다");
await sleep(600);
const after = JSON.parse(await ev(`JSON.stringify(window.__writes.slice(${writesBefore}))`));
check(after.length === 1 && data.indexOf("\x1b[201~") === data.length - 6, "Enter 를 보내지 않았다 — 쓰기는 괄호 붙여넣기 한 번뿐");
const body = data.replace(/^\x1b\[200~/, "").replace(/\x1b\[201~$/, "").replace(/\r/g, "\n");
check(body.startsWith("fix-token 브랜치 리뷰 코멘트 2개야. 반영해 줘. (main 대비 · 이 PC · C:/src/api-wt/api-login)"), `첫 줄 (${body.split("\n")[0]})`);
check(body.includes("① src/auth/refresh.rs 43–45행\n    +   Ok(t) => break t,") && body.includes("→ 3 은 설정값으로 빼 줘.") && body.includes("② src/auth/refresh.rs 79–80행"), "코멘트 둘 · 코드 줄 · 할 말");
check(body.endsWith("\n") && !body.endsWith("\n\n"), "끝은 줄바꿈 하나(보내는 Enter 가 아니라 다음 줄 커서)");
check((await ev(`(async () => (await ${tabsMod}).focusedPane()?.id ?? null)()`)) === aiSame.id, "그 AI 타일로 초점");
await ev(`(async () => { const w = await ${tabsMod}; w.focusTile(w.tabOfPane(${JSON.stringify(diffId)}).id, ${JSON.stringify(diffId)}); })()`);
await sleep(500);
check((await count(`.card.sent`)) === 2 && (await exists(`[data-diff-clear]`)) === true, "넘긴 코멘트 = 넘김(흐림) · [비우기]");
check((await attr(`[data-diff-send]`, "disabled")) !== null, "넘길 새 코멘트가 없으면 넘기기 흐림");

// ── S7 고치기 · 지우기 · 비우기 ──
await click(`[data-diff-sel="-:41"]`);
await key("KeyC", 0, "c"); await sleep(300);
await ev(`(() => { const t = document.querySelector('[data-diff-composer] textarea'); t.value = '첫 말'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await key("Enter", 2, "Enter"); await sleep(300);
check((await count(`[data-diff-comment]`)) === 3 && (await attr(`[data-diff-send]`, "disabled")) === null, "새 코멘트 → 넘기기 다시 켜짐");
const third = await ev(`[...document.querySelectorAll('[data-diff-comment]')].find(e => e.textContent.includes('첫 말')).getAttribute('data-diff-comment')`);
await click(`[data-diff-comment="${third}"] [data-diff-comment-edit]`); await sleep(300);
check((await ev(`document.querySelector('[data-diff-composer] textarea').value`)) === "첫 말", "고치기 → 입력 칸에 그 말");
await ev(`(() => { const t = document.querySelector('[data-diff-composer] textarea'); t.value = '고친 말'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await key("Enter", 2, "Enter"); await sleep(300);
check((await text(`[data-diff-comment="${third}"] .ctext`)) === "고친 말", "고친 말로 바뀜");
await click(`[data-diff-comment="${third}"] [data-diff-comment-delete]`); await sleep(300);
check((await count(`[data-diff-comment]`)) === 2, "지우기 → 하나 빠짐");
await click(`[data-diff-clear]`); await sleep(300);
check((await count(`[data-diff-comment]`)) === 0 && (await exists(`[data-diff-tray]`)) === false, "비우기 → 넘긴 것 지움 · 트레이 걷힘");

// ── S8 다른 파일의 코멘트 · 칩으로 돌아오기 ──
await click(`[data-diff-sel="-:43"]`);
await key("KeyC", 0, "c"); await sleep(300);
await ev(`(() => { const t = document.querySelector('[data-diff-composer] textarea'); t.value = '칩 시험'; t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await key("Enter", 2, "Enter"); await sleep(300);
await click(`[data-diff-file="src/auth/mod.rs"]`); await sleep(600);
check((await count(`[data-diff-comment]`)) === 0 && (await count(`[data-diff-chip]`)) === 1, "다른 파일 — 카드 없음 · 칩은 남음");
await click(`[data-diff-chip]`); await sleep(700);
check((await attr(`[data-diff-file-head]`, "data-diff-file-head")) === "src/auth/refresh.rs" && (await count(`[data-diff-comment]`)) === 1, "칩 → 그 파일 · 그 카드");

// ── S9 AI 타일이 없으면 [복사] 만 ──
await ev(`(async () => { const w = await ${tabsMod}; for (const id of [${JSON.stringify(aiSame.id)}, ${JSON.stringify(aiMain.id)}]) { const t = w.tabOfPane(id); if (t) w.closePaneIn(t.id, id); } })()`);
await sleep(800);
await ev(`(async () => { const w = await ${tabsMod}; w.focusTile(w.tabOfPane(${JSON.stringify(diffId)}).id, ${JSON.stringify(diffId)}); })()`);
await sleep(500);
check((await exists(`[data-diff-target]`)) === false && (await exists(`[data-diff-copy]`)) === true, "AI 타일 없음 → 받을 곳 없이 [복사]");
await click(`[data-diff-copy]`); await sleep(500);
const clip = JSON.parse(await ev(`JSON.stringify(window.__clip)`));
check(clip.length === 1 && clip[0].startsWith("fix-token 브랜치 리뷰 코멘트 1개야.") && !clip[0].includes("\x1b"), `복사한 글 (${(clip[0] ?? "").split("\n")[0]})`);

// 코멘트는 저장하지 않는다 — 명세 · 배치 파일에 없다.
const savedDiff = await ev(`(async () => { const w = await ${tabsMod}; const ws = await ${importApp("lib/tabs.ts")}; return JSON.stringify(ws.saveNode(w.tabOfPane(${JSON.stringify(diffId)}).root)); })()`);
check(!savedDiff.includes("칩 시험") && !savedDiff.includes("comment"), "코멘트는 배치 파일에 없다");

// ── ⑨ 원격 · 붙은 세션 없음 ─────────────────────────────────────────────────
await ev(`(async () => { const d = await ${dvMod}; const pl = await ${plMod}; d.openDiff(pl.projectById('R1'), { scope: 'branch', branch: 'feat' }); })()`);
await sleep(900);
check((await exists(`[data-diff-note="offline"]`)) === true, "원격 · 세션 없음 → 접속된 세션이 있어야…");
check(!(await ev(`JSON.stringify(window.__calls.map(c => c[0]))`)).includes("ssh_git_diff"), "원격 명령을 부르지 않았다");

check(errors.length === 0, `예외 0 (${errors.join(" | ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
