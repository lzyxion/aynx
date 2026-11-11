// Headless harness: **프로젝트 독 · 워크트리** (docs/log/2026-09-24-projects.md ·
// docs/log/2026-09-24-worktrees.md). `host-history-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx \
//     --window-size=1100,800 http://localhost:1420/
//   node scripts/dev/projects-harness.mjs outdir [port]
//
// 포트는 둘째 인자 또는 `CDP_PORT` (기본 9224). 앱 페이지의 포트는 `PAGE_PORT` (기본 1420) — 떠 있는 앱을
// 건드리지 않으려면 따로 띄운 vite(`npx vite --port 1431 --strictPort`)와 그 주소를 연 Edge 로 돌린다.
//
// 심어 두는 것: 호스트 하나(`dev-01`, tmux 호스트) · `projects_list` 에 프로젝트 **둘** —
// 로컬 `aynx`(C:\src\proj · 에이전트 claude) · 원격 `api`(dev-01 · ~/api · 에이전트 codex · tmux 켬).
// 탭은 없다(시작 화면이 본문이다). 네이티브 확인(`plugin:dialog|message`)은 "아니오" 로 답한다.
//
// 보는 것: ① 호스트 독(`Ctrl+Shift+H`)에는 **프로젝트가 없다**(가짜 폴더·줄 없음, `+` 는 평범한
// "호스트 추가") · 프로젝트 독(`Ctrl+Shift+J`)이 제목 "프로젝트" 로 뜨고 검색 칸이 포커스를 받으며
// 두 줄(`R1`·`L1`, 이름순)과 위치 배지(`dev-01`·`로컬`)가 선다 · 원격을 펼치면(세션 없음) 왕복 없이
// "접속 후 표시됩니다" ② 로컬 줄 우클릭 → 메뉴 여섯 줄(브랜치 그래프 포함) →
// "열기" 가 `open_local_session { cwd, injectMcpToken }` + 첫 입력 `write_session "claude\r"` ·
// 열린 타일 명세(앱 모듈 인스턴스로 읽는다) ③ 키보드 — 검색 `api` → Enter 가 원격을 연다
// (`open_ssh_session { start, noTmux:false }`) · ↓ + F2 = 편집 폼 · Delete = 확인(거절이면 안 지운다)
// ④ 명령 팔레트 "프로젝트" 묶음 ⑤ 툴바 `+` → 폼 검증(워크트리 폴더: 자리표시 = 기본 자리,
// 저장소 안이면 오류) → `project_upsert { worktreeDir }` ⑥ 워크트리 — **독의 트리**: 펼침 화살표 →
// 아이 줄 둘(모두 왼쪽 폴더 이름 · 오른쪽 브랜치, 주 폴더 굵게 + 표식, 툴팁 = 온전한 경로) — 끝의 "+" 아이 줄은 없다 · 펼침이 localStorage 에 ·
// 키보드 ←(접기) →(펼치기·첫 아이) ↑↓(아이를 지난다) · F2 는 아이에서 쉰다 · Delete = 제거 확인 ·
// 아이 메뉴(주 폴더엔 제거 없음 — 원격도 제거가 있고, 세션이 없으면 알림 한 줄) · Enter = 새 탭 · 아이 줄의 에이전트 점 · 검색이 워크트리를 걸면
// 저절로 펼침(저장 안 함) · 프로젝트 줄 오른쪽 `+`(평소 투명 · 손이 올라가면·고르면 보임 · 누르면 펼침은
// 그대로, 프로젝트 줄 아래 이름 칸) · Insert 도 같은 칸 · `+` 와 메뉴 항목이 같은 이름 칸 · 이름 칸 아래 **온전한 자리** ·
// `git_worktree_add { repo, name, dir }` → 목록 다시 읽기 · 알림 "워크트리를 만들었습니다: <경로>" +
// [폴더 열기] · 탭 제목 `aynx · feat-y` · 원격 트리는 붙은 세션으로 · `~/api` 타일 ≡ git 의 `/root/api` 줄
// (`ssh_remote_home` 한 번) · 원격은 첫 입력 재료 ⑦ 에이전트 상태 점(셋 — 실행 중 · 권한 대기 · 완료, 근거는 훅 신호뿐 ·
// 출력만으로는 점 없음 · 미상 없음 — docs/log/2026-10-01-agent-status-three.md) ⑧ Claude Code 훅 신호
// (`agent-signal` 이벤트 — 스텁 이벤트 버스 `window.__emit` 로 쏜다 · docs/log/2026-09-24-agent-hook-signals.md ·
// `tool-done` 포함) ⑨ 원격 AI 타일의 열기 인자(`open_ssh_session { streamId · start }` — 신호 판정은 세션 서버, `agentStream` 칸 없음)과 원격 프로젝트 메뉴의
// "원격에 Claude Code 훅 설치…" / "원격 훅 제거" (docs/log/2026-09-24-remote-agent-signals.md)
// ⑩ 턴 끝 알림 — 훅 `stop` 이 (포커스된 그 타일이면) 조용 · (다른 탭이면) 토스트 + "보기" 가 그 타일로 ·
// (창이 앞에 없으면) OS 알림 한 장(`window.Notification` 스텁)만 · (설정 끔이면) 아무것도
// (docs/log/2026-09-25-agent-stop-notify.md). 창 포커스는 `window.__focus` 로 고른다(`document.hasFocus` 스텁).
// PNG: `projects-dock.png` · `projects-menu.png` · `projects-palette.png` · `projects-form.png` ·
// `worktree-tree.png` · `worktree-search.png` · `project-plus.png` · `project-plus-ask.png` ·
// `worktree-prompt.png` · `agent-dot.png` ·
// `agent-dot-hook.png` · `agent-stop-toast.png` · `agent-permission-toast.png`.
// ⑪ 평범한 셸 타일(AI 타일로 열지 않은 것)에서 손으로 친 claude — `open_local_session { injectMcpToken:false,
// streamId }` · 도는 명령이 claude 가 되기 전의 신호는 버린다 · 그 뒤 점과 턴 끝 알림 · `waiting` 범주
// `permission` 만 알림(토스트 · OS · 알림 센터 `agent-permission`) · `idle`·`other`·범주 없음은 조용 ·
// `[ai] notify_permission` 끔 · 앞에 다른 명령을 단 줄(`cd …; claude …`)은 제목이 작업 이름으로 바뀌어도
// 에이전트 타일로 남고 stop 이 알림에 닿는다 (docs/log/2026-09-25-shell-claude-signals.md).
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal, FAKE_AGENT_SIGNAL_FN } from "./agent-signal-fake.mjs";
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

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  // \`importApp\` 는 리소스 타이밍 목록에서 모듈 URL 을 찾는다 — 기본 버퍼(250)는 dev 서버의 모듈 수에 모자란다.
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  // 이벤트 버스 — \`listen\` 이 건 콜백 id 를 이름별로 모으고, \`__emit\` 이 Rust 의 \`app.emit\` 대신 부른다.
  window.__listeners = {};
  // 창 포커스 (⑩) — \`app/os-notify\` 의 \`windowFocused()\` 가 읽는 \`document.hasFocus\` 를 시나리오가 고른다.
  window.__focus = true; document.hasFocus = () => window.__focus;
  // OS 알림 (⑩) — 플러그인의 \`sendNotification\` 은 \`new window.Notification(title, opts)\` 다.
  // 권한은 "허용" 으로 두고, 쏜 알림은 \`__calls\` 에 \`['Notification', { title, body }]\` 로 남긴다.
  window.Notification = class { static permission = 'granted'; static requestPermission() { return Promise.resolve('granted'); }
    constructor(title, opts) { window.__calls.push(['Notification', { title, body: opts?.body ?? null }]); } };
  window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, id: h, payload }));
  // 앞 판이 남긴 펼침(같은 --user-data-dir)을 지운다 — 시나리오는 "전부 접힘" 에서 시작한다.
  try { localStorage.removeItem('aynx:projects:expanded'); } catch {}
  const HOSTS = [{ name: 'dev-01', host_name: '10.0.0.9', user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null, tmux: true } }];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: true };
  const PROJECTS = [
    // 새 모양(2026-09-28 — 옛 "시작 명령" 대신 에이전트 · 설정 스크립트, docs/log/2026-09-28-project-agent-setup-script.md).
    // 옛 'codex --model o3' 의 추가 인자는 설정 › AI 가 쥐고 Rust 가 붙인다 — 프런트가 싣는 명령은 'codex' 다.
    { id: 'L1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, agent: 'claude', setupScript: '', tmux: false },
    { id: 'R1', name: 'api', host: 'dev-01', path: '~/api', shell: null, agent: 'codex', setupScript: '', tmux: true },
  ];
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META,
    list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
     load_snippets: null, 
     save_snippets: null, 
    // 로컬 프로젝트를 열면 이제 늘 시작 화면이 선다(2026-09-27 — docs/log/2026-09-27-folder-conversations.md). 이 판은 여는
    // 길(셸 · 명세 · 점)을 보므로 예전처럼 곧장 열게 끈다 — 시작 화면은 project-start · folder-convos 판이 본다.
    load_settings: { projects: { start_screen: 'off' } }, save_settings: null,
    host_history_list: {},
    projects_list: PROJECTS,
    git_worktree_list: [
      { path: 'C:/src/proj', branch: 'main', head: 'a1', bare: false, detached: false },
      { path: 'C:/src/proj-wt/feat-x', branch: 'feat-x', head: 'b2', bare: false, detached: false, created_by_app: true },
    ],
    ssh_git_worktree_list: [
      { path: '/root/api', branch: 'main', head: 'c3', bare: false, detached: false },
      { path: '/root/api-wt/fix', branch: 'fix', head: 'd4', bare: false, detached: false },
    ],
    // 원격 \`$HOME\` — \`~/api\` 타일을 git 의 \`/root/api\` 줄과 맞대는 데 쓴다(별칭마다 한 번).
    ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, close_session: null, close_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [],
    mcp_status: { clis: [] },
    // 에이전트 표(Rust \`agent_args::TARGETS\`) — 프로젝트 폼의 에이전트 고르개가 읽는다. 진짜 백엔드는 늘 답한다.
    agent_args_targets: [{ id: 'claude', display: 'Claude Code' }, { id: 'codex', display: 'Codex' }],
    'plugin:notification|is_permission_granted': true,
    // 네이티브 확인은 "아니오" — Delete 가 확인을 거치는지만 본다(지우지 않는다).
    // 플러그인의 \`ask\` 는 \`plugin:dialog|message\` 를 부르고 눌린 단추 글자를 받는다.
    'plugin:dialog|message': 'No',
    // 원격 훅 (⑨) — 에이전트 표 둘(Claude Code · Codex), 상태는 "설치되지 않음", 설치·제거는 새 상태를 돌려준다.
    agent_hooks_targets: [{ id: 'claude', display: 'Claude Code', needsTrustNote: false }, { id: 'codex', display: 'Codex', needsTrustNote: true }],
    agent_hooks_remote_status: { installed: false, partial: false, settingsPath: '~/.claude/settings.json', scriptPath: '~/.config/aynx/hooks/aynx-agent-signal.sh', preview: '{"hooks":{}}', error: null },
    agent_hooks_remote_install: { installed: true, partial: false, settingsPath: '~/.claude/settings.json', scriptPath: '~/.config/aynx/hooks/aynx-agent-signal.sh', preview: '{}', error: null },
    agent_hooks_remote_remove: { installed: false, partial: false, settingsPath: '~/.claude/settings.json', scriptPath: '~/.config/aynx/hooks/aynx-agent-signal.sh', preview: '{}', error: null },
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      // 네이티브 확인의 답 — 시나리오가 \`__dialogAnswer\` 로 고른다(기본 "아니오").
      if (cmd === 'plugin:dialog|message') return Promise.resolve(window.__dialogAnswer ?? 'No');
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++, tmux: 'aynx-1' });
      // 워크트리 목록은 저장소마다 — aynx 만 git 저장소다(⑤ 의 새 프로젝트는 git 이 거절한다).
      // \`__wtCreated\` — 곁 파일이 feat-x 를 "앱이 만들었다" 고 말하는가 (제거 확인의 브랜치 칸이 이 값으로 갈린다).
      // \`__wtDetached\` — feat-x 를 분리된 HEAD 로 (⑥ 의 줄 순서 확인 — 폴더 이름과 브랜치 글자가 달라야 양쪽 칸을 가른다).
      if (cmd === 'git_worktree_list') return args.repo === 'C:\\\\src\\\\proj' ? Promise.resolve(answers.git_worktree_list.map((w) => w.branch === 'feat-x' ? { ...w, created_by_app: window.__wtCreated !== false, ...(window.__wtDetached ? { branch: null, detached: true } : {}) } : w)) :Promise.reject(new Error('fatal: not a git repository'));
      // 제거의 답은 시나리오가 고른다 (\`__removeAnswer\`) — 지움 · 병합 안 됨 · 먼저 있던 것.
      if (cmd === 'git_worktree_remove') return Promise.resolve(window.__removeAnswer ?? { removed: true, branch: 'feat-x', branch_deleted: true, branch_kept_reason: null, message: null });
      // 원격 제거 — 칸을 켜지 않았으니 브랜치는 남긴다(\`not_requested\`).
      if (cmd === 'ssh_git_worktree_remove') return Promise.resolve({ removed: true, branch: 'fix', branch_deleted: false, branch_kept_reason: 'not_requested', message: null });
      if (cmd === 'project_upsert') return Promise.resolve({ ...args.project, id: args.project.id || 'N1' });
      // 브랜치 삭제 (docs/log/2026-10-01-worktree-branch-ops.md) — 재료는 시나리오가 \`__branchChoices\` 로 덮는다.
      if (cmd === 'git_worktree_branch_choices' || cmd === 'ssh_git_worktree_branch_choices') return Promise.resolve({ deletable: ['old-a', 'old-b'], ...(window.__branchChoices ?? {}) });
      // 새 워크트리 상자의 미리 보기 · 자동 완성 재료 (docs/log/2026-10-05-worktree-one-to-one.md)
      if (cmd === 'git_worktree_add_preview' || cmd === 'ssh_git_worktree_add_preview') return Promise.resolve({ main: 'main', local: ['feat-x', 'main', 'old-a', 'old-b'], remote: ['origin/main', 'origin/feat-remote', 'origin/old-a'], checked_out: ['main', 'feat-x'] });
      // 독 변경 배지 — \`__wtMerged\` 가 없으면 답하지 않는다(배지 없음). true 면 feat-x 가 "병합됨"(⑥ 의 [정리]),
      // 'squash' 면 앞선 커밋 3 · 줄 수가 남은 채 squash 병합(2026-10-05 — 숫자 대신 칩).
      if (cmd === 'git_worktree_changes') return window.__wtMerged == null ? Promise.reject(new Error('stub: git_worktree_changes')) : Promise.resolve((args.paths ?? []).map((p) => { const sq = window.__wtMerged === 'squash'; const m = (window.__wtMerged === true || sq) && p.endsWith('/feat-x'); return { path: p, ahead: sq ? 3 : 0, added_lines: sq ? 40 : 0, deleted_lines: sq ? 2 : 0, merged: m, merged_kind: m ? (sq ? 'squash' : 'ancestry') : null }; }));
      if (cmd === 'git_branch_delete' || cmd === 'ssh_git_branch_delete') return window.__deleteRefuse ? Promise.reject(window.__deleteRefuse) : Promise.resolve(args.branch);
      if (cmd === 'git_worktree_add') return Promise.resolve({ path: (args.dir ?? 'C:\\\\src\\\\proj-wt') + '\\\\' + args.name, branch: args.name, branch_created: true });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);
// 앱 모듈이 다 뜰 때까지 기다린다 — 찬 vite 에서는 4.5초 안에 tabs 모듈이 안 떠 첫 단축키가 허공에 갔다
for (let i = 0; i < 60 && !(await ev(`performance.getEntriesByType('resource').some((r) => r.name.includes('app/tabs.svelte.ts')) && !!document.querySelector('[data-tile-canvas]')`)); i++) await sleep(250);
await sleep(800);

const key = async (code, modifiers, k) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : ({ Enter: 13, Escape: 27, ArrowDown: 40, ArrowUp: 38, ArrowLeft: 37, ArrowRight: 39, Tab: 9, F2: 113, Delete: 46, Insert: 45 })[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(250); };
/** 앱이 이미 올린 것과 **같은 모듈 인스턴스** (`?t=` 질의까지 그대로 — README 의 keygen 절) */
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
// OS 알림 제목 앞머리 = 앱이 쓰는 `APP_TITLE`(`src/lib/app/instance.ts`). vite 개발 서버에서는
// `import.meta.env.DEV` 라 `Aynx (dev)` 다(릴리스 번들이면 `Aynx`) — docs/log/2026-09-26-dev-release-isolation.md.
const appTitle = async () => { const t = await ev(`(async () => (await ${importApp("app/instance.ts")}).APP_TITLE)()`); if (t !== "Aynx (dev)" && t !== "Aynx") throw new Error(`unexpected APP_TITLE: ${t}`); return t; };
const projectRowIds = () => ev(`[...document.querySelectorAll('[data-project-dock] [data-project-id]')].map(e => e.getAttribute('data-project-id')).join('|')`);
const projectDockShown = () => ev(`(() => { const el = document.querySelector('[data-project-dock]'); return !!el && el.offsetParent !== null; })()`);
// 런처 독(호스트 · 프로젝트)은 머리줄 이름 대신 칸 막대를 세운다 — 고른 칸의 이름을 읽는다
// (docs/log/2026-09-25-unified-dock.md). 설정 독은 예전처럼 `.title` 이다.
const dockTitle = () => ev(`(document.querySelector('.dock .head .title') ?? document.querySelector('.dock .head .seg[aria-selected="true"]'))?.textContent?.trim() ?? null`);

// ── ① 호스트 독에는 프로젝트가 없다 · 프로젝트 독은 자기 자리에 ─────────────────
await key("KeyH", 10, "H"); await sleep(1200);
const hostRows = await ev(`[...document.querySelectorAll('.sidebar [data-id]')].map(e => e.getAttribute('data-id')).join('|')`);
console.log("host dock rows:", hostRows);
check(hostRows === "h:dev-01", `호스트 독 = 호스트 줄만 (가짜 '프로젝트' 폴더 없음) (${hostRows})`);
const hostAdd = await ev(`[...document.querySelectorAll('.sidebar .dock-search .icon-btn')].map(b => b.getAttribute('title')).filter(Boolean).join('|')`);
check(typeof hostAdd === "string" && hostAdd.includes("호스트 추가") && !hostAdd.includes("추가…") && (await ev(`!!document.querySelector('[data-hosts-add]')`)) === false, `호스트 독의 + 는 평범한 '호스트 추가' 단추 (${hostAdd})`);
await key("KeyJ", 10, "J"); await sleep(900);
check((await projectDockShown()) === true, "Ctrl+Shift+J → 프로젝트 독 (호스트 독이 그 자리에서 바뀐다)");
check((await dockTitle()) === "프로젝트", `독 머리줄 = 프로젝트 (${await dockTitle()})`);
check((await ev(`document.activeElement?.classList.contains('search') && !!document.activeElement.closest('[data-project-dock]')`)) === true, "열리는 순간 검색 칸에 커서");
const rows0 = await projectRowIds();
console.log("project dock rows:", rows0);
check(rows0 === "R1|L1", "줄 = 원격 api · 로컬 aynx (이름순)");
const badges = await ev(`[...document.querySelectorAll('[data-project-dock] .where')].map(e => e.textContent.trim()).join('|')`);
check(badges === "dev-01|로컬", `위치 배지 = dev-01 | 로컬 (${badges})`);
const tails = await ev(`[...document.querySelectorAll('[data-project-dock] .hint')].map(e => e.textContent.trim()).join('|')`);
check(tails === "api|proj", `폴더 꼬리 = api | proj (${tails})`);
// 원격 프로젝트를 펼치면 — 붙은 세션이 없으니 왕복 없이 "접속 후 표시됩니다" 한 줄
const bOff = await ev(`window.__calls.length`);
await ev(`document.querySelector('[data-project-dock] [data-project-id="R1"] [data-project-twisty]').click()`); await sleep(400);
const offNote = await ev(`document.querySelector('[data-project-dock] [data-worktree-note]')?.textContent.trim() ?? null`);
check(offNote === "접속 후 표시됩니다", `원격 펼침 (세션 없음) → 안내 한 줄 (${offNote})`);
check((await ev(`window.__calls.slice(${bOff}).some(c => c[0] === 'ssh_git_worktree_list' || c[0] === 'open_ssh_session')`)) === false, "목록 하나 보려고 접속하지 않는다");
check((await ev(`!!document.querySelector('[data-project-id="R1"] [data-worktree-add="R1"]')`)) === true, "접속 전이어도 프로젝트 줄의 '+' 는 선다 (원격은 첫 입력이 만든다)");
await ev(`document.querySelector('[data-project-dock] [data-project-id="R1"] [data-project-twisty]').click()`); await sleep(400);
const statusOn = await ev(`document.querySelector('[data-chrome-toggle][aria-label^="프로젝트"], [data-chrome-toggle][title^="프로젝트"]')?.classList.contains('on') ?? 'missing'`);
console.log("status bar projects toggle on:", statusOn);
console.log("capture:", await shot("projects-dock.png"));
await key("KeyJ", 10, "J"); await sleep(500);
check((await projectDockShown()) === false, "Ctrl+Shift+J 한 번 더 → 닫힌다 (토글)");

// ── ② 로컬 프로젝트 우클릭 → 메뉴 → 열기 ────────────────────────────────────
const showProjects = async () => {
  await key("Escape", 0, "Escape"); await sleep(200);
  if ((await projectDockShown()) !== true) { await key("KeyJ", 10, "J"); await sleep(800); }
  // 남은 검색어를 비운다(앞 걸음의 `api` 등)
  await ev(`(() => { const el = document.querySelector('[data-project-dock] .search'); if (el && el.value) { el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); } })()`);
  await sleep(200);
};
const openMenuOn = (id) => ev(`(() => { const el = document.querySelector('[data-project-dock] [data-project-id="${id}"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 8 })); return new Promise((ok) => setTimeout(() => ok(!!document.querySelector('[data-project-menu]')), 150)); })()`);
await showProjects();
check((await openMenuOn("L1")) === true, "로컬 프로젝트 우클릭 → 프로젝트 메뉴");
await sleep(300);
const items = await ev(`[...document.querySelectorAll('[data-project-menu] button')].map(b => (b.disabled ? '~' : '') + b.textContent.trim()).join('|')`);
console.log("menu items:", items);
check(items === "열기|지금 탭에 열기|브랜치 그래프|새 워크트리에서 열기…|편집…|삭제", "메뉴 = 열기 · 지금 탭에 · 브랜치 그래프 · 새 워크트리 · 편집 · 삭제 (옆목록 `워크트리 ▸` 는 독의 트리로 옮겼다 · 브랜치 그래프는 docs/log/2026-09-29-branch-graph.md)");
console.log("capture:", await shot("projects-menu.png"));
const before = await ev(`window.__calls.length`);
await ev(`[...document.querySelectorAll('[data-project-menu] button')].find(b => b.textContent.trim() === '열기').click()`);
await sleep(2500);
const localOpen = await ev(`JSON.stringify(window.__calls.slice(${before}).filter(c => c[0] === 'open_local_session').map(c => ({ cwd: c[1].cwd, shell: c[1].shell, injectMcpToken: c[1].injectMcpToken })))`);
console.log("open_local_session:", localOpen);
check(localOpen === JSON.stringify([{ cwd: "C:\\src\\proj", shell: "pwsh", injectMcpToken: true }]), "open_local_session 에 cwd · 기본 셸 · MCP 토큰 표식");
const firstInput = await ev(`JSON.stringify(window.__calls.slice(${before}).filter(c => c[0] === 'write_session').map(c => c[1].data))`);
check(firstInput === JSON.stringify(["claude\r"]), `첫 입력 = claude + Enter (한 번) (${firstInput})`);
const paneSpec = await ev(`(async () => { const m = await ${importApp("app/tabs.svelte.ts")}; const out = []; const walk = (n) => n.type === 'leaf' ? out.push(n.pane) : (walk(n.a), walk(n.b)); for (const tab of m.residentWindowTabs()) walk(tab.root); const p = out.find(p => p.kind === 'local'); return p ? JSON.stringify({ kind: p.kind, cwd: p.cwd, autorun: p.autorun, injectMcpToken: p.injectMcpToken }) : 'no local pane: ' + JSON.stringify(out.map(p => p.kind)); })()`);
check(paneSpec === JSON.stringify({ kind: "local", cwd: "C:\\src\\proj", autorun: "claude", injectMcpToken: true }), "열린 타일의 명세 = cwd · autorun · injectMcpToken");

// ── ③ 키보드 — 검색 + Enter = 열기 · ↓ + F2 = 편집 · Delete = 확인 ──────────
await showProjects();
await ev(`document.querySelector('[data-project-dock] .search').focus()`);
await send("Input.insertText", { text: "api" }); await sleep(300);
check((await projectRowIds()) === "R1", "검색 'api' → 원격 한 줄");
const before2 = await ev(`window.__calls.length`);
await key("Enter", 0, "Enter"); await sleep(2500);
const sshOpen = await ev(`JSON.stringify(window.__calls.slice(${before2}).filter(c => c[0] === 'open_ssh_session').map(c => ({ alias: c[1].alias, start: c[1].start, noTmux: c[1].noTmux })))`);
console.log("open_ssh_session:", sshOpen);
check(sshOpen === JSON.stringify([{ alias: "dev-01", start: { cwd: "~/api", command: "codex", worktree: null }, noTmux: false }]), "Enter → open_ssh_session { start{cwd,command,worktree:null}, noTmux:false }");
check((await ev(`window.__calls.slice(${before2}).filter(c => c[0] === 'write_ssh').length`)) === 0, "원격은 프런트가 첫 입력을 쓰지 않는다 (Rust 가 조립)");
// ⑨ 원격 AI 타일 — 그 타일의 스트림 · 시작 명령(codex)만 싣는다. 신호를 세울지는 세션 서버가 정한다(Rust `ssh::open::signal_stream` —
// 2026-10-27, 프런트의 `agentStream` 칸은 걷었다).
const remoteStream = await ev(`(async () => { const m = await ${importApp("app/tabs.svelte.ts")}; const out = []; const walk = (n) => n.type === 'leaf' ? out.push(n.pane) : (walk(n.a), walk(n.b)); for (const tab of m.residentWindowTabs()) walk(tab.root); const p = out.find(p => p.kind === 'ssh' && p.cwd === '~/api'); return p ? (p.historyStreamId ?? p.id) : null; })()`);
const sentStream = await ev(`JSON.stringify(window.__calls.slice(${before2}).filter(c => c[0] === 'open_ssh_session').map(c => [c[1].streamId, 'agentStream' in c[1], /codex/.test(c[1].start?.command ?? '')]))`);
check(!!remoteStream && sentStream === JSON.stringify([[remoteStream, false, true]]), `원격 AI 타일 → open_ssh_session { streamId: 그 타일의 스트림 · start: codex · agentStream 없음 } (${sentStream} vs ${remoteStream})`);
await showProjects();
await ev(`document.querySelector('[data-project-dock] .search').focus()`);
await key("ArrowDown", 0, "ArrowDown"); await key("ArrowDown", 0, "ArrowDown");
check((await ev(`document.querySelector('[data-project-dock] .item.selected')?.getAttribute('data-project-id')`)) === "L1", "↓↓ → 둘째 줄(aynx)");
await key("F2", 0, "F2"); await sleep(400);
const editTitle = await ev(`document.querySelector('[data-project-form] h2')?.textContent?.trim() ?? null`);
check(editTitle === "프로젝트 편집", `F2 → 편집 폼 (${editTitle})`);
await key("Escape", 0, "Escape"); await sleep(300);
await showProjects();
await ev(`(() => { const b = document.querySelector('[data-project-dock] [data-project-id="L1"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); b.focus(); })()`); await sleep(150);
const b3 = await ev(`window.__calls.length`);
await key("Delete", 0, "Delete"); await sleep(500);
const del = await ev(`JSON.stringify(window.__calls.slice(${b3}).map(c => c[0]).filter(n => n === 'plugin:dialog|message' || n === 'project_remove'))`);
check(del === JSON.stringify(["plugin:dialog|message"]), `Delete → 네이티브 확인 · "아니오" 면 지우지 않는다 (${del})`);

// ── ④ 팔레트 ─────────────────────────────────────────────────────────────────
await key("Escape", 0, "Escape"); await sleep(200);
await key("KeyP", 10, "P"); await sleep(700);
const sections = await ev(`[...document.querySelectorAll('.palette .section')].map(e => e.textContent).join('|')`);
check(typeof sections === "string" && sections.split("|").includes("프로젝트"), "팔레트에 프로젝트 묶음");
const projRows = await ev(`(() => { const section = [...document.querySelectorAll('.palette .section')].find(e => e.textContent === '프로젝트'); const rows = []; for (let row = section?.nextElementSibling; row && !row.classList.contains('section'); row = row.nextElementSibling) rows.push(row); return rows.map(b => b.querySelector('.label')?.textContent + ' / ' + b.querySelector('.tail')?.textContent).join('|'); })()`);
check(projRows === "api / dev-01 · api|aynx / 로컬 · proj", `프로젝트 줄 = 이름 + 위치 · 폴더 꼬리 (${projRows})`);
console.log("capture:", await shot("projects-palette.png"));
await key("Escape", 0, "Escape"); await sleep(300);

// ── ⑤ 툴바 + → 프로젝트 추가 폼 — 워크트리 폴더 칸 ──────────────────────────
await showProjects();
await ev(`document.querySelector('[data-project-add]').click()`); await sleep(400);
check((await ev(`!!document.querySelector('[data-project-form]')`)) === true, "+ → 프로젝트 폼이 곧바로 뜬다 (두 줄 메뉴 없음)");
await ev(`document.querySelector('[data-project-submit]').click()`); await sleep(300);
const err = await ev(`document.querySelector('[data-project-form] .err')?.textContent ?? null`);
check(err === "이름을 입력하세요", `빈 폼 저장 → 이름 칸 오류 (${err})`);
const fill = (field, v) => ev(`(() => { const el = document.querySelector('[data-project-field="${field}"]'); el.value = ${JSON.stringify(v)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
await fill("name", "새 프로젝트"); await fill("path", "/home/me/repo"); await sleep(200);
const ph = await ev(`document.querySelector('[data-project-field="worktreeDir"]')?.placeholder ?? null`);
check(ph === "/home/me/repo-wt", `워크트리 폴더 자리표시 = 기본 자리 (${ph})`);
const help = await ev(`document.querySelector('[data-project-field="worktreeDir"]')?.closest('.cell')?.querySelector('.hint')?.textContent?.trim() ?? null`);
check(help === "새 워크트리는 이 폴더 아래 <이름> 으로 만들어집니다.", `도움말 한 줄 (${help})`);
await fill("worktreeDir", "/home/me/repo/wt"); await sleep(100);
await ev(`document.querySelector('[data-project-submit]').click()`); await sleep(300);
const wtErr = await ev(`document.querySelector('[data-project-field="worktreeDir"]')?.closest('.cell')?.querySelector('.err')?.textContent ?? null`);
check(wtErr === "저장소 폴더 밖의 절대 경로를 적으세요", `저장소 안 → 워크트리 폴더 오류 (${wtErr})`);
await fill("worktreeDir", "/srv/wt"); await sleep(200);
console.log("capture:", await shot("projects-form.png"));
const before3 = await ev(`window.__calls.length`);
await ev(`document.querySelector('[data-project-submit]').click()`); await sleep(600);
const upsert = await ev(`JSON.stringify(window.__calls.slice(${before3}).filter(c => c[0] === 'project_upsert').map(c => c[1].project))`);
console.log("project_upsert:", upsert);
// 옛 `command` 칸 대신 에이전트 · 설정 스크립트 · 이관 안내 · 아이콘 · 색 (docs/log/2026-09-28-project-agent-setup-script.md · 2026-09-29-folder-project-icons.md)
check(upsert === JSON.stringify([{ id: "", name: "새 프로젝트", host: null, path: "/home/me/repo", shell: null, agent: "claude", setupScript: "", migration: null, tmux: false, worktreeDir: "/srv/wt", icon: null, color: null }]), "project_upsert 모양 (로컬 · 기본 에이전트 claude · worktreeDir)");
check((await ev(`!!document.querySelector('[data-project-form]')`)) === false, "저장하면 폼이 닫힌다");
check((await projectRowIds()).split("|").includes("N1"), "저장한 줄이 곧바로 독에 선다");

// ── ⑥ 워크트리 — 독의 트리 (docs/log/2026-09-24-worktrees.md "독의 트리") ──────
/**
 * 독의 줄 모양 — P:id(+ 펼침) · W:왼쪽(`.branch`)(*주 폴더) · 오른쪽(`.hint`) · N:안내.
 * **모든 줄이 왼쪽 폴더 이름 · 오른쪽 브랜치**다 — 주 폴더 줄은 이름을 굵게 하고 `주 폴더` 표식을 붙인다
 * (2026-09-30 `179a48c` 가 나머지 줄을, 2026-10-03 `27180b8` 이 주 폴더 줄까지 같은 배치로).
 */
const treeShape = () => ev(`[...document.querySelectorAll('[data-project-dock] [data-row-key], [data-project-dock] [data-worktree-note]')].map(e => {
  if (e.hasAttribute('data-project-id')) return 'P:' + e.getAttribute('data-project-id') + (e.getAttribute('aria-expanded') === 'true' ? '+' : '');
  if (e.hasAttribute('data-worktree-row')) return 'W:' + e.querySelector('.branch').textContent.trim() + (e.querySelector('[data-worktree-primary]') ? '*' : '') + ' · ' + e.querySelector('.hint').textContent.trim();
  return 'N:' + e.textContent.trim();
}).join('|')`);
// 꺾쇠(줄 오른쪽 끝)를 누른다 = 줄 한 번 누르기 — 펼치기/접기는 250ms 뒤다(두 번 누르기 = 열기를 기다린다)
const twisty = (id) => ev(`document.querySelector('[data-project-dock] [data-project-id="${id}"] [data-project-twisty]').click()`);
const selectedKey = () => ev(`(() => { const e = document.querySelector('[data-project-dock] .item.selected'); if (!e) return null; if (e.hasAttribute('data-project-id')) return 'P:' + e.getAttribute('data-project-id'); if (e.hasAttribute('data-worktree-row')) return 'W:' + e.getAttribute('data-worktree-row'); return '?'; })()`);
const storedExpanded = () => ev(`localStorage.getItem('aynx:projects:expanded')`);

await showProjects();
check((await treeShape()) === "P:R1|P:L1|P:N1", `처음엔 전부 접힘 (${await treeShape()})`);
const bList = await ev(`window.__calls.length`);
await twisty("L1"); await sleep(500);
console.log("tree after expand:", await treeShape());
check((await treeShape()) === "P:R1|P:L1+|W:proj* · main|W:feat-x · feat-x|P:N1", "펼침 → 워크트리 줄 둘(주 폴더 표식) — 끝의 '+' 아이 줄은 없다");
check((await ev(`window.__calls.slice(${bList}).filter(c => c[0] === 'git_worktree_list').map(c => c[1].repo).join('|')`)) === "C:\\src\\proj", "펼치는 순간 git_worktree_list { repo } 한 번");
const primaryBold = await ev(`getComputedStyle(document.querySelector('[data-worktree-row="C:/src/proj"] .branch')).fontWeight`);
check(Number(primaryBold) >= 600, `주 폴더 브랜치는 굵게 (${primaryBold})`);
const otherBold = await ev(`getComputedStyle(document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"] .branch')).fontWeight`);
check(Number(otherBold) < 600, `나머지 줄의 왼쪽 칸(폴더 이름)은 굵지 않다 (${otherBold})`);
// 줄 순서 — feat-x 는 폴더 이름과 브랜치가 같은 글자라 위 모양으로는 두 칸이 갈리지 않는다. 분리된 HEAD 로 한 번
// 다시 읽어(접었다 펴기) 왼쪽 = 폴더 이름 · 오른쪽 = 브랜치 자리('(분리된 HEAD)') 를 본다. 주 폴더 줄은 그대로.
await ev(`window.__wtDetached = true`);
await twisty("L1"); await sleep(200); await twisty("L1"); await sleep(500);
const detachedShape = await treeShape();
check(detachedShape === "P:R1|P:L1+|W:proj* · main|W:feat-x · (분리된 HEAD)|P:N1", `나머지 줄 = 왼쪽 폴더 이름 · 오른쪽 브랜치(없으면 분리된 HEAD) · 주 폴더 줄도 같은 배치 — 27180b8 (${detachedShape})`);
await ev(`window.__wtDetached = false`);
await twisty("L1"); await sleep(200); await twisty("L1"); await sleep(500);
check((await treeShape()) === "P:R1|P:L1+|W:proj* · main|W:feat-x · feat-x|P:N1", "다시 브랜치 feat-x 로 (뒤 시나리오는 그대로)");
const rowTip = await ev(`document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"]').title`);
check(rowTip === "C:/src/proj-wt/feat-x", `워크트리 줄 툴팁 = 온전한 경로 (${rowTip})`);
check((await ev(`[...document.querySelectorAll('[data-project-dock] [data-worktree-add]')].every(e => !!e.closest('[data-project-id]'))`)) === true, "'+' 는 프로젝트 줄 안에만 (아이 줄로 서지 않는다)");
check((await storedExpanded()) === '["L1"]', `펼침이 localStorage 에 남는다 (${await storedExpanded()})`);
// 펼침 판(2026-10-19) — 펼친 프로젝트와 아이들이 한 묶음 판(li.dtree-node.open) · 꺾쇠는 줄 오른쪽 끝
check((await ev(`!!document.querySelector('[data-project-dock] li.dtree-node.open > [data-project-id="L1"]') && !!document.querySelector('[data-project-dock] li.dtree-node.open [data-worktree-row="C:/src/proj"]')`)) === true, "펼친 L1 = 아이들과 한 묶음 판");
check((await ev(`(() => { const row = document.querySelector('[data-project-dock] [data-project-id="L1"]'); const ch = row.querySelector('[data-project-twisty]'); return row.querySelector('.line').lastElementChild === ch; })()`)) === true, "꺾쇠는 줄 오른쪽 끝");
// 줄 한 번 누르기 = 고르기 + (250ms 뒤) 펼치기/접기 · Ctrl 누르기 = 고르기만. 아래 시나리오가 줄을 고를 때는 Ctrl 누르기를 쓴다
await ev(`document.querySelector('[data-project-dock] [data-project-id="L1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`); await sleep(400);
check((await treeShape()).startsWith("P:R1|P:L1+"), "Ctrl 누르기는 펼침을 건드리지 않는다");
await ev(`document.querySelector('[data-project-dock] [data-project-id="L1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`); await sleep(100);
check((await treeShape()).startsWith("P:R1|P:L1+") && (await selectedKey()) === "P:L1", "한 번 누르기 — 곧바로 고르고, 접기는 잠깐 미룬다");
await sleep(250);
check((await ev(`document.querySelector('[data-project-dock] [data-project-id="L1"]').getAttribute('aria-expanded')`)) === "false", "250ms 뒤 접힌다");
await sleep(300); // 아이들 묶음이 접혀 사라지는 200ms
check((await treeShape()) === "P:R1|P:L1|P:N1", `접힘 움직임이 끝나면 아이 줄이 없다 (${await treeShape()})`);
await ev(`document.querySelector('[data-project-dock] [data-project-id="L1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))`); await sleep(500);
check((await treeShape()).startsWith("P:R1|P:L1+|W:proj*"), "다시 한 번 누르기 → 펼친다");

// 키보드 — ← 접기 · → 펼치기 · → 첫 아이 · ↓ 아이들을 지난다 · ← 부모로
await ev(`(() => { const b = document.querySelector('[data-project-dock] [data-project-id="L1"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); b.focus(); })()`); await sleep(150);
await key("ArrowLeft", 0, "ArrowLeft"); await sleep(200);
check((await treeShape()) === "P:R1|P:L1|P:N1", "← → 접힌다");
check((await storedExpanded()) === "[]", "접힘도 저장된다");
await key("ArrowRight", 0, "ArrowRight"); await sleep(400);
check((await treeShape()).startsWith("P:R1|P:L1+|W:proj*"), "→ → 펼친다");
await key("ArrowRight", 0, "ArrowRight");
check((await selectedKey()) === "W:C:/src/proj", `→ (펼친 줄) → 첫 아이 (${await selectedKey()})`);
await key("ArrowDown", 0, "ArrowDown");
check((await selectedKey()) === "W:C:/src/proj-wt/feat-x", `↓ → 마지막 아이 feat-x ('+' 줄이 없다) (${await selectedKey()})`);
await key("ArrowDown", 0, "ArrowDown"); await key("ArrowDown", 0, "ArrowDown");
check((await selectedKey()) === "P:N1", `↓↓ → 마지막 프로젝트에서 멈춘다 (${await selectedKey()})`);
await key("ArrowUp", 0, "ArrowUp");
check((await selectedKey()) === "W:C:/src/proj-wt/feat-x", "↑ → 마지막 아이로 복귀");
await key("ArrowUp", 0, "ArrowUp");
check((await selectedKey()) === "W:C:/src/proj", `↑ → 주 폴더 (${await selectedKey()})`);
await key("ArrowDown", 0, "ArrowDown");
check((await selectedKey()) === "W:C:/src/proj-wt/feat-x", `↓ → feat-x (${await selectedKey()})`);
// F2 는 아이 줄에서 아무것도 하지 않는다
await key("F2", 0, "F2"); await sleep(300);
check((await ev(`!!document.querySelector('[data-project-form]')`)) === false, "F2 는 워크트리 줄에서 쉰다");
// Delete = 제거 확인 상자 (취소면 안 지운다) — 네이티브 확인이 아니라 "브랜치도 삭제" 칸이 있는 앱 상자다
const bDel = await ev(`window.__calls.length`);
await key("Delete", 0, "Delete"); await sleep(500);
const removeBox = () => ev(`(() => { const d = document.querySelector('[data-worktree-remove]'); if (!d) return null; const c = d.querySelector('[data-worktree-remove-branch]'); return { box: c ? { checked: c.checked, disabled: c.disabled, label: c.parentElement.textContent.trim() } : null, hint: d.querySelector('[data-worktree-remove-hint]')?.textContent.trim() ?? null, focus: document.activeElement?.hasAttribute('data-worktree-remove-submit') ?? false }; })()`);
const box0 = await removeBox();
console.log("remove dialog:", JSON.stringify(box0));
check(box0?.box?.checked === true && box0.box.disabled === false && box0.box.label === "브랜치 feat-x 도 삭제", `Delete (로컬 워크트리) → 제거 확인 상자 · '브랜치 feat-x 도 삭제' 가 **켜진 채** (${JSON.stringify(box0)})`);
check(box0?.focus === true, "상자가 열리면 [제거] 에 커서 (Enter 한 번)");
console.log("capture:", await shot("worktree-remove.png"));
await key("Escape", 0, "Escape"); await sleep(300);
const wtDel = await ev(`JSON.stringify(window.__calls.slice(${bDel}).map(c => c[0]).filter(n => n === 'plugin:dialog|message' || n === 'git_worktree_remove' || n === 'project_remove'))`);
check(wtDel === "[]" && (await ev(`!!document.querySelector('[data-worktree-remove]')`)) === false, `Escape → 닫히고 지우지 않는다 · 네이티브 확인도 없다 (${wtDel})`);
check((await ev(`!!document.querySelector('[data-project-dock]')`)) === true, "상자의 Escape 가 뒤의 독까지 닫지 않는다");
console.log("capture:", await shot("worktree-tree.png"));

// 아이 줄 우클릭 메뉴 — 열기 · 지금 탭에 · 폴더 열기 · 제거… (주 폴더에는 제거가 없다)
const openWtMenu = (path) => ev(`(() => { const el = document.querySelector('[data-worktree-row="${path}"]'); const r = el.getBoundingClientRect(); el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 40, clientY: r.top + 8 })); return new Promise((ok) => setTimeout(() => ok([...document.querySelectorAll('[data-project-menu] button')].map(b => b.textContent.trim()).join('|')), 150)); })()`);
const wtMenu = await openWtMenu("C:/src/proj-wt/feat-x");
// 브랜치 그래프(docs/log/2026-09-29-branch-graph.md) · 설정 스크립트 실행(docs/log/2026-09-28-project-agent-setup-script.md)
check(wtMenu === "열기|지금 탭에 열기|브랜치 그래프|변경 보기main 대비|브랜치 삭제…|설정 스크립트 실행|폴더 열기|제거…", `워크트리 줄 메뉴 (${wtMenu})`);
await key("Escape", 0, "Escape"); await sleep(200);
const wtMenu0 = await openWtMenu("C:/src/proj");
check(wtMenu0 === "열기|지금 탭에 열기|브랜치 그래프|변경 보기main 대비|브랜치 삭제…|설정 스크립트 실행|폴더 열기", `주 폴더 줄 메뉴 — 제거 없음, 브랜치 삭제는 있다 (${wtMenu0})`);
await key("Escape", 0, "Escape"); await sleep(200);

// 제거 — 브랜치는 같이 지운다 (docs/log/2026-09-24-worktrees.md "브랜치는 같이 지운다")
{
  const toastWith = (s) => ev(`[...document.querySelectorAll('.toast .text')].map(e => e.textContent.trim()).find(x => x === ${JSON.stringify(s)}) ?? null`);
  const removeVia = async (answer) => {
    await ev(`window.__removeAnswer = ${JSON.stringify(answer)}`);
    await openWtMenu("C:/src/proj-wt/feat-x");
    await ev(`document.querySelector('[data-worktree-action="remove"]').click()`); await sleep(400);
    const box = await removeBox();
    const b = await ev(`window.__calls.length`);
    await ev(`document.querySelector('[data-worktree-remove-submit]').click()`); await sleep(700);
    const calls = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => c[0] === 'git_worktree_remove').map(c => c[1]))`);
    const relist = await ev(`window.__calls.slice(${b}).some(c => c[0] === 'git_worktree_list')`);
    return { box, calls, relist };
  };
  // ① 앱이 만든 브랜치 — 칸 켜진 채 그대로 [제거] → deleteBranch:true, 알림 "… · 브랜치 feat-x 삭제"
  const r1 = await removeVia({ removed: true, branch: "feat-x", branch_deleted: true, branch_kept_reason: null, message: null });
  check(r1.box?.box?.checked === true, "메뉴 '제거…' → 같은 상자, 칸 켜진 채");
  check(r1.calls === JSON.stringify([{ repo: "C:\\src\\proj", path: "C:/src/proj-wt/feat-x", deleteBranch: true }]), `git_worktree_remove { repo, path, deleteBranch: true } (${r1.calls})`);
  check((await toastWith("워크트리를 제거했습니다 · 브랜치 feat-x 삭제")) !== null, "알림 = 워크트리를 제거했습니다 · 브랜치 feat-x 삭제");
  check(r1.relist === true, "지운 뒤 트리를 다시 읽는다");
  // ② 병합되지 않은 커밋 — git 이 -d 를 거절 → 남김
  await ev(`window.__removeAnswer = null`);
  const r2 = await removeVia({ removed: true, branch: "feat-x", branch_deleted: false, branch_kept_reason: "unmerged", message: "error: the branch 'feat-x' is not fully merged" });
  check((await toastWith("워크트리를 제거했습니다 · 브랜치 feat-x 은 남겼습니다 (병합되지 않은 커밋)")) !== null, `알림 = … 브랜치 feat-x 은 남겼습니다 (병합되지 않은 커밋) (${r2.calls})`);
  // ③ 먼저 있던 브랜치 — 곁 파일이 "앱이 만들지 않았다" → 칸이 꺼지고 흐리며 까닭 한 줄, deleteBranch:false
  await ev(`window.__wtCreated = false`);
  await twisty("L1"); await sleep(200); await twisty("L1"); await sleep(500);
  const r3 = await removeVia({ removed: true, branch: "feat-x", branch_deleted: false, branch_kept_reason: "predates", message: null });
  console.log("predates dialog:", JSON.stringify(r3.box));
  check(r3.box?.box?.checked === false && r3.box.box.disabled === true, `먼저 있던 브랜치 → 칸 꺼짐 + 흐림 (${JSON.stringify(r3.box)})`);
  check(r3.box?.hint === "이 브랜치는 워크트리보다 먼저 있었습니다", `까닭 한 줄 (${r3.box?.hint})`);
  check(r3.calls === JSON.stringify([{ repo: "C:\\src\\proj", path: "C:/src/proj-wt/feat-x", deleteBranch: false }]), `deleteBranch: false (${r3.calls})`);
  check((await toastWith("워크트리를 제거했습니다 · 브랜치는 남겼습니다 (워크트리보다 먼저 있던 브랜치)")) !== null, "알림 = … 브랜치는 남겼습니다 (워크트리보다 먼저 있던 브랜치)");
  await ev(`window.__wtCreated = true; window.__removeAnswer = null`);
}

// Enter (아이 줄) → 새 탭에서 그 워크트리
await ev(`(() => { const b = document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"]'); b.click(); b.focus(); })()`); await sleep(150);
const b4 = await ev(`window.__calls.length`);
await key("Enter", 0, "Enter"); await sleep(2000);
const wtOpen = await ev(`JSON.stringify(window.__calls.slice(${b4}).filter(c => c[0] === 'open_local_session').map(c => c[1].cwd))`);
check(wtOpen === JSON.stringify(["C:/src/proj-wt/feat-x"]), `Enter (워크트리 줄) → open_local_session cwd (${wtOpen})`);
const tabTitles = () => ev(`[...document.querySelectorAll('.tab .title')].map(e => e.textContent.trim()).join('|')`);
check((await tabTitles()).split("|").includes("aynx · feat-x"), `있는 워크트리 탭 제목 = aynx · feat-x (${await tabTitles()})`);
// 타일을 하나 더 띄워도 워크트리 탭의 제목은 그대로다 — 고정 제목(`pinnedTitle`)이 합성 제목을 이긴다
// (docs/log/2026-09-27-project-tab-title.md). 확인한 뒤 더한 타일은 닫아 뒤 시나리오를 그대로 둔다.
{
  const w = importApp("app/tabs.svelte.ts");
  const added = await ev(`(async () => { const m = await ${w}; const t = m.activeTab(); m.splitActive(); return JSON.stringify({ tab: t.id, pane: m.paneOf(m.activeTab()) }); })()`); await sleep(400);
  const { tab: pinTab, pane: pinPane } = JSON.parse(added);
  const shown = await ev(`document.querySelector('.tab[data-tab="${pinTab}"] .title')?.textContent?.trim() ?? null`);
  const count = await ev(`(async () => { const m = await ${w}; const walk = (n) => n.type === 'leaf' ? 1 : walk(n.a) + walk(n.b); return walk(m.residentWindowTabs().find(t => t.id === '${pinTab}').root); })()`);
  check(count === 2 && shown === "aynx · feat-x", `타일 둘이어도 탭 제목 고정 = aynx · feat-x (${count} · ${shown})`);
  await ev(`(async () => { const m = await ${w}; m.closePaneIn('${pinTab}', '${pinPane}'); })()`); await sleep(300);
}

// 에이전트 점 — 그 폴더에서 시작한 AI 타일에 훅 신호가 있으면 줄에 탭과 같은 점. 점의 근거는 훅 신호뿐이다
// (2026-10-01 90fb2e1 · docs/log/2026-10-01-agent-status-three.md — 출력 추정 · 미상 고리는 없다).
{
  const agentMod = importApp("app/agent-status.svelte.ts");
  const tabsMod = importApp("app/tabs.svelte.ts");
  const fx = await ev(`(async () => { const m = await ${tabsMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); for (const tab of m.residentWindowTabs()) for (const p of walk(tab.root, [])) if (p.cwd === 'C:/src/proj-wt/feat-x') return p.id; return null; })()`);
  await showProjects();
  const rowDot = () => ev(`document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"] .agentdot')?.className ?? 'none'`);
  /** 그 cwd 에서 연 타일의 스트림으로 훅 신호 하나 */
  const hookAt = (cwd, event) => ev(`(async () => { const m = await ${tabsMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); for (const tab of m.residentWindowTabs()) for (const p of walk(tab.root, [])) if (p.cwd === ${JSON.stringify(cwd)} && p.historyStreamId) { await ${FAKE_AGENT_SIGNAL_FN}({ stream: p.historyStreamId, event: '${event}', detail: null, at: Date.now() }); return true; } return false; })()`);
  check((await rowDot()) === "none", `열린 직후 = 점 없음 (미상 고리는 없다) (${await rowDot()})`);
  await ev(`(async () => { const a = await ${agentMod}; const w = await ${tabsMod}; a.agentOutput(w.findPaneAnywhere('${fx}')); })()`); await sleep(300);
  check((await rowDot()) === "none", `출력만으로는 점이 서지 않는다 (${await rowDot()})`);
  check((await hookAt("C:/src/proj-wt/feat-x", "start")) === true, "준비: feat-x 타일에 훅 start");
  await sleep(300);
  check((await rowDot()).includes("running"), `훅 start → 줄의 점도 탭과 같이 실행 중 (${await rowDot()})`);
  // 주 폴더 줄에도 점이 선다 — ② 에서 "열기" 한 aynx 타일이 그 폴더(C:\src\proj)에서 시작했다(구분자·대소문자 무시).
  check((await hookAt("C:\\src\\proj", "start")) === true, "준비: ② 의 aynx 타일에 훅 start");
  await sleep(300);
  check((await ev(`document.querySelector('[data-worktree-row="C:/src/proj"] .agentdot')?.className ?? 'none'`)).includes("running"), "주 폴더 줄 = ② 의 aynx 타일 점 (역슬래시 cwd ≡ git 의 C:/src/proj)");
  check((await ev(`document.querySelectorAll('[data-worktree-parent="L1"] .agentdot').length`)) === 2, "점은 짝이 있는 줄에만 (둘)");
}

// 브랜치 삭제 (docs/log/2026-10-01-worktree-branch-ops.md) — 어느 줄에서든(저장소 단위). 슬롯 "새 브랜치…" 는 2026-10-05 에 뺐다.
{
  await showProjects();
  const toastHas = (s) => ev(`[...document.querySelectorAll('.toast')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()).find(x => x.includes(${JSON.stringify(s)})) ?? null`);
  const branchBox = () => ev(`(() => { const d = document.querySelector('[data-worktree-branch]'); if (!d) return null; return { mode: d.getAttribute('data-worktree-branch'), picks: [...d.querySelectorAll('[data-worktree-branch-pick]')].map(r => r.getAttribute('data-worktree-branch-pick') + (r.checked ? '*' : '')).join('|') }; })()`);
  await openWtMenu("C:/src/proj-wt/feat-x"); await sleep(200);
  check((await ev(`!!document.querySelector('[data-worktree-action="newBranch"]')`)) === false, "슬롯 '새 브랜치…' 항목은 없다");
  await key("Escape", 0, "Escape"); await sleep(200);

  // 주 폴더 줄에서도 · 고를 브랜치 목록(첫 줄이 골라진 채) · -d 만
  const bC = await ev(`window.__calls.length`);
  await openWtMenu("C:/src/proj"); await sleep(200);
  await ev(`document.querySelector('[data-worktree-action="deleteBranch"]').click()`); await sleep(500);
  const cCalls = await ev(`JSON.stringify(window.__calls.slice(${bC}).filter(c => c[0].includes('branch_choices')).map(c => [c[0], c[1]]))`);
  check(cCalls === JSON.stringify([["git_worktree_branch_choices", { repo: "C:\\src\\proj" }]]), `누를 때 git_worktree_branch_choices { repo } 한 번 (${cCalls})`);
  const db0 = await branchBox();
  console.log("delete-branch dialog:", JSON.stringify(db0));
  check(db0?.mode === "delete" && db0.picks === "old-a*|old-b", `주 폴더 줄 '브랜치 삭제…' → 상자 · 후보 old-a(골라짐)·old-b (${JSON.stringify(db0)})`);
  console.log("capture:", await shot("worktree-delete-branch.png"));
  await ev(`document.querySelector('[data-worktree-branch-pick="old-b"]').click()`); await sleep(100);
  const bX = await ev(`window.__calls.length`);
  await ev(`document.querySelector('[data-worktree-branch-submit]').click()`); await sleep(600);
  const xCalls = await ev(`JSON.stringify(window.__calls.slice(${bX}).filter(c => c[0] === 'git_branch_delete').map(c => c[1]))`);
  check(xCalls === JSON.stringify([{ repo: "C:\\src\\proj", branch: "old-b" }]), `git_branch_delete { repo, branch } (${xCalls})`);
  check((await toastHas("브랜치 old-b 을(를) 삭제했습니다")) !== null, "알림 = 브랜치 old-b 을(를) 삭제했습니다");
  // 거절(병합되지 않은 커밋) — git 의 한 줄과 함께 남겼다고 말한다
  await ev(`window.__deleteRefuse = "error: the branch 'old-a' is not fully merged"`);
  await openWtMenu("C:/src/proj-wt/feat-x"); await sleep(200);
  await ev(`document.querySelector('[data-worktree-action="deleteBranch"]').click()`); await sleep(500);
  await ev(`document.querySelector('[data-worktree-branch-submit]').click()`); await sleep(600);
  check((await toastHas("브랜치 old-a 은(는) 남겼습니다: error: the branch 'old-a' is not fully merged")) !== null, "삭제 거절 → '브랜치 old-a 은(는) 남겼습니다: <git 의 한 줄>'");
  await ev(`window.__deleteRefuse = null`);
  // 지울 브랜치가 없으면 상자 대신 알림
  await ev(`window.__branchChoices = { deletable: [] }`);
  await openWtMenu("C:/src/proj"); await sleep(200);
  await ev(`document.querySelector('[data-worktree-action="deleteBranch"]').click()`); await sleep(500);
  check((await branchBox()) === null && (await toastHas("지울 수 있는 브랜치가 없습니다")) !== null, "지울 것 없음 → 상자 없이 알림 한 줄");
  await ev(`window.__branchChoices = null`);
  // Escape 는 상자만 닫는다
  await openWtMenu("C:/src/proj"); await sleep(200);
  await ev(`document.querySelector('[data-worktree-action="deleteBranch"]').click()`); await sleep(500);
  await key("Escape", 0, "Escape"); await sleep(300);
  check((await branchBox()) === null && (await ev(`!!document.querySelector('[data-project-dock]')`)) === true, "Escape → 상자만 닫힌다 (독은 그대로)");

  // [정리] — "병합됨" 칩 옆. 누르면 제거 확인 상자(같은 흐름) · 줄의 클릭(열기)은 일어나지 않는다 · 주 폴더 줄엔 없다.
  const wcMod = importApp("app/worktree-changes.svelte.ts");
  const plMod = importApp("app/project-list.svelte.ts");
  const reloadChanges = () => ev(`(async () => { const m = await ${wcMod}; const pl = await ${plMod}; const p = pl.projects().find(x => x.id === 'L1'); await m.loadWorktreeChanges(p, ['C:/src/proj-wt/feat-x']); })()`);
  await ev(`window.__wtMerged = true`); await reloadChanges(); await sleep(300);
  const chip = await ev(`document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"] [data-worktree-changes]')?.textContent.trim() ?? null`);
  const cleanup = await ev(`(() => { const b = document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"] [data-worktree-cleanup]'); return b ? { text: b.textContent.trim(), title: b.title } : null; })()`);
  check(chip === "병합됨" && cleanup?.text === "정리" && cleanup.title === "워크트리와 브랜치를 제거합니다…", `병합됨 칩 옆 [정리] (${chip} · ${JSON.stringify(cleanup)})`);
  check((await ev(`!!document.querySelector('[data-worktree-row="C:/src/proj"] [data-worktree-cleanup]')`)) === false, "주 폴더 줄에는 [정리] 가 없다");
  console.log("capture:", await shot("worktree-cleanup.png"));
  const bK = await ev(`window.__calls.length`);
  await ev(`document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"] [data-worktree-cleanup]').click()`); await sleep(500);
  const kBox = await removeBox();
  check(kBox?.box?.checked === true && kBox.box.label === "브랜치 feat-x 도 삭제", `[정리] → 제거 확인 상자 · 브랜치도 삭제 켜진 채 (${JSON.stringify(kBox)})`);
  const kCalls = await ev(`JSON.stringify(window.__calls.slice(${bK}).map(c => c[0]).filter(n => n === 'open_local_session' || n === 'git_worktree_remove' || n.startsWith('git_branch')))`);
  check(kCalls === "[]", `[정리] 는 줄을 열지 않고 · 바로 지우지도 않는다 (${kCalls})`);
  await key("Escape", 0, "Escape"); await sleep(300);
  check((await removeBox()) === null, "Escape → 상자가 닫힌다");
  // 2026-10-05 — 앱 밖에서 만든 브랜치라도 병합됨이면 칸은 살되 **꺼진 채** · 사람이 켜면 deleteBranch:true
  await ev(`window.__wtCreated = false`);
  await twisty("L1"); await sleep(200); await twisty("L1"); await sleep(500);
  await reloadChanges(); await sleep(300);
  await ev(`document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"] [data-worktree-cleanup]').click()`); await sleep(500);
  const mBox = await removeBox();
  check(mBox?.box?.checked === false && mBox.box.disabled === false, `병합된 먼저 있던 브랜치 → 칸 살아 있고 꺼진 채 (${JSON.stringify(mBox)})`);
  check(mBox?.hint?.startsWith("앱 밖에서 만든 브랜치입니다 — main 에 병합돼 있어 지울 수 있습니다"), `까닭 한 줄 (${mBox?.hint})`);
  await ev(`window.__removeAnswer = ${JSON.stringify({ removed: true, branch: "feat-x", branch_deleted: true, branch_kept_reason: null, message: null })}`);
  await ev(`document.querySelector('[data-worktree-remove-branch]').click()`); await sleep(150);
  const bM = await ev(`window.__calls.length`);
  await ev(`document.querySelector('[data-worktree-remove-submit]').click()`); await sleep(700);
  const mCalls = await ev(`JSON.stringify(window.__calls.slice(${bM}).filter(c => c[0] === 'git_worktree_remove').map(c => c[1]))`);
  check(mCalls === JSON.stringify([{ repo: "C:\\src\\proj", path: "C:/src/proj-wt/feat-x", deleteBranch: true }]), `켜고 [제거] → deleteBranch: true (${mCalls})`);
  await ev(`window.__wtCreated = true; window.__removeAnswer = null`);
  await twisty("L1"); await sleep(200); await twisty("L1"); await sleep(500);
  await ev(`window.__wtMerged = false`); await reloadChanges(); await sleep(300);
  check((await ev(`!!document.querySelector('[data-worktree-cleanup]')`)) === false, "병합되지 않으면 [정리] 도 없다");
  // 2026-10-05 — squash 병합: 앞선 커밋이 남아도 숫자 배지 대신 같은 칩 + [정리], 툴팁만 squash.
  await ev(`window.__wtMerged = 'squash'`); await reloadChanges(); await sleep(300);
  const sqChip = await ev(`(() => { const e = document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"] [data-worktree-changes]'); return e ? { attr: e.getAttribute('data-worktree-changes'), text: e.textContent.trim(), title: e.title } : null; })()`);
  check(sqChip?.attr === "merged" && sqChip.text === "병합됨" && sqChip.title.startsWith("squash 병합으로 main 에 들어갔습니다 — [정리] 로 워크트리와 브랜치를 제거할 수 있습니다"), `squash 병합 → 병합됨 칩 · squash 툴팁 (${JSON.stringify(sqChip)})`);
  check((await ev(`!!document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"] [data-worktree-cleanup]')`)) === true, "squash 병합에도 [정리]");
  await ev(`window.__wtMerged = null`);
}

// 검색 — 워크트리 이름이 걸리면 그 프로젝트가 저절로 펼쳐진다 (저장된 펼침은 그대로)
await showProjects();
await ev(`(() => { const b = document.querySelector('[data-project-dock] [data-project-id="L1"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); b.focus(); })()`); await sleep(100);
await key("ArrowLeft", 0, "ArrowLeft"); await sleep(200);
check((await treeShape()) === "P:R1|P:L1|P:N1", "(검색 전) L1 접음");
await ev(`document.querySelector('[data-project-dock] .search').focus()`);
await send("Input.insertText", { text: "feat-x" }); await sleep(600);
console.log("search tree:", await treeShape());
check((await treeShape()) === "P:L1+|W:feat-x · feat-x", "검색 'feat-x' → L1 저절로 펼침 + 걸린 워크트리만");
check((await selectedKey()) === "W:C:/src/proj-wt/feat-x", `검색 첫 선택 = 걸린 워크트리 (곧바로 Enter) (${await selectedKey()})`);
check((await storedExpanded()) === "[]", "검색의 저절로 펼침은 저장하지 않는다");
console.log("capture:", await shot("worktree-search.png"));

// 새 워크트리 — 프로젝트 줄 오른쪽의 `+` 가 메뉴와 **같은** 이름 칸을 연다 · 칸 아래 온전한 자리
// (2026-09-25 — 끝의 "+ 새 워크트리…" 아이 줄을 뺐다)
await showProjects();
{
  const plusOf = (id) => `document.querySelector('[data-project-dock] [data-project-id="${id}"] [data-worktree-add="${id}"]')`;
  const plusOpacity = (id) => ev(`getComputedStyle(${plusOf(id)}).opacity`);
  const mouse = async (type, x, y) => { await send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 }); };
  // 선택을 비우고(Escape 는 검색 칸에서도 뿌리까지 간다) 손을 독 밖으로 — 평소 모양
  await ev(`document.querySelector('[data-project-dock] .search').focus()`); await key("Escape", 0, "Escape");
  if ((await projectDockShown()) !== true) { await key("KeyJ", 10, "J"); await sleep(800); }
  await mouse("mouseMoved", 1000, 700); await sleep(250);
  check((await treeShape()) === "P:R1|P:L1|P:N1", `(시험 전) 전부 접힘 (${await treeShape()})`);
  check((await ev(`document.querySelector('[data-project-dock] .item.selected')`)) === null, "(시험 전) 고른 줄 없음");
  check((await plusOpacity("L1")) === "0", `평소에는 '+' 가 보이지 않는다 (opacity ${await plusOpacity("L1")})`);
  check((await ev(`getComputedStyle(${plusOf("L1")}).pointerEvents`)) === "none", "보이지 않는 '+' 는 잡히지도 않는다");
  const tip = await ev(`${plusOf("L1")}.title + ' | ' + ${plusOf("L1")}.getAttribute('aria-label')`);
  check(tip === "새 워크트리 (Insert) | 새 워크트리", `'+' 툴팁·이름 (${tip})`);
  // 손을 줄에 올리면 보인다
  const rowBox = await ev(`(() => { const r = document.querySelector('[data-project-dock] [data-project-id="L1"]').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  await mouse("mouseMoved", rowBox.x, rowBox.y); await sleep(250);
  check((await plusOpacity("L1")) === "1", `줄에 손이 올라가면 '+' 가 보인다 (opacity ${await plusOpacity("L1")})`);
  check((await plusOpacity("R1")) === "0", "다른 줄의 '+' 는 여전히 숨는다");
  console.log("capture:", await shot("project-plus.png"));
  // 고른 줄이면 손이 떠나도 보인다
  await ev(`document.querySelector('[data-project-dock] [data-project-id="R1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }))`);
  await mouse("mouseMoved", 1000, 700); await sleep(250);
  check((await plusOpacity("R1")) === "1" && (await plusOpacity("L1")) === "0", "고른 줄의 '+' 는 손이 없어도 보인다");
  // 진짜 마우스로 '+' 를 누른다 (pointer-events 가 산다) — 펼침·열기와 섞이지 않는다
  await mouse("mouseMoved", rowBox.x, rowBox.y); await sleep(250);
  const plusBox = await ev(`(() => { const r = ${plusOf("L1")}.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
  const bP = await ev(`window.__calls.length`);
  await mouse("mouseMoved", plusBox.x, plusBox.y); await mouse("mousePressed", plusBox.x, plusBox.y); await mouse("mouseReleased", plusBox.x, plusBox.y); await sleep(350);
  check((await ev(`document.activeElement?.hasAttribute('data-worktree-name') && !!document.activeElement.closest('[data-project-menu]')`)) === true, "'+' → 메뉴 상자의 이름 칸이 뜨고 포커스를 받는다");
  check((await treeShape()) === "P:R1|P:L1|P:N1", `'+' 는 펼침을 건드리지 않는다 (접힌 채) (${await treeShape()})`);
  check((await ev(`window.__calls.slice(${bP}).some(c => c[0] === 'open_local_session' || c[0] === 'git_worktree_list')`)) === false, "'+' 는 프로젝트를 열지도, 목록을 읽지도 않는다");
  check((await selectedKey()) === "P:L1", `'+' 를 누른 줄이 골라진다 (${await selectedKey()})`);
  const anchor = await ev(`(() => { const row = document.querySelector('[data-project-dock] [data-project-id="L1"]').getBoundingClientRect(); const m = document.querySelector('[data-project-menu]').getBoundingClientRect(); return Math.round(m.top - row.bottom) + ',' + Math.round(m.left - row.left); })()`);
  check(anchor === "2,0", `이름 칸은 프로젝트 줄 바로 아래 (위 틈,왼쪽 차 = ${anchor})`);
  await mouse("mouseMoved", 1000, 700); await sleep(250);
  check((await plusOpacity("L1")) === "1" && (await ev(`${plusOf("L1")}.classList.contains('open')`)) === true, "이름 칸이 떠 있는 동안 그 줄의 '+' 는 보인다");
  const hint0 = await ev(`document.querySelector('[data-worktree-where]')?.textContent ?? null`);
  check(hint0 === "자리: C:\\src\\proj-wt\\<이름>", `비었을 때 = 기본 자리 + <이름> (${hint0})`);
  console.log("capture:", await shot("project-plus-ask.png"));
  await key("Escape", 0, "Escape"); await sleep(150); await key("Escape", 0, "Escape"); await sleep(200); // 목록 접기 → 상자 닫기
  check((await ev(`!!document.querySelector('[data-project-menu]')`)) === false, "Escape 둘 (목록이 떠 있으면 첫 번째는 목록만 접는다) → 이름 칸이 닫힌다");
  // 펼친 줄에서도 같다 — 펼침은 그대로, 칸은 프로젝트 줄 아래
  await twisty("L1"); await sleep(500);
  await ev(`${plusOf("L1")}.click()`); await sleep(300);
  check((await ev(`document.activeElement?.hasAttribute('data-worktree-name')`)) === true && (await treeShape()) === "P:R1|P:L1+|W:proj* · main|W:feat-x · feat-x|P:N1", `펼친 줄의 '+' → 같은 칸 · 펼침 그대로 (${await treeShape()})`);
  await key("Escape", 0, "Escape"); await sleep(150); await key("Escape", 0, "Escape"); await sleep(200); // 목록 접기 → 상자 닫기
}
// 프로젝트 메뉴의 항목도 같은 칸이다
const bAsk = await ev(`window.__calls.length`);
await openMenuOn("L1"); await sleep(300);
await ev(`document.querySelector('[data-project-action="worktree"]').click()`); await sleep(300);
check((await ev(`document.activeElement?.hasAttribute('data-worktree-name')`)) === true, "메뉴 '새 워크트리에서 열기…' → 같은 이름 칸");
await send("Input.insertText", { text: "-bad" }); await sleep(150);
const b5 = await ev(`window.__calls.length`);
await ev(`document.querySelector('[data-worktree-submit]').click()`); await sleep(300);
const nameErr = await ev(`document.querySelector('[data-project-menu] .ctx-error')?.textContent ?? null`);
check(typeof nameErr === "string" && nameErr.includes("- 로 시작"), `'-bad' → 이름 오류 한 줄 (${nameErr})`);
check((await ev(`window.__calls.slice(${b5}).some(c => c[0] === 'git_worktree_add')`)) === false, "막힌 이름은 git 을 부르지 않는다");
// 브랜치 콤보박스 (docs/log/2026-10-05-worktree-one-to-one.md "콤보박스") — 재료는 상자가 열릴 때 한 번.
// 줄마다 고르면 일어날 일을 말한다 · 판정 한 줄(data-worktree-plan)은 없어졌다.
{
  const pCalls = await ev(`JSON.stringify(window.__calls.slice(${bAsk}).filter(c => c[0] === 'git_worktree_add_preview').map(c => c[1]))`);
  check(pCalls === JSON.stringify([{ repo: "C:\\src\\proj" }]), `상자가 열릴 때 git_worktree_add_preview { repo } 한 번 (${pCalls})`);
  const setName = async (v) => { await ev(`(() => { const el = document.querySelector('[data-worktree-name]'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); })()`); if (v) await send("Input.insertText", { text: v }); await sleep(250); };
  // 줄 = kind:name, 강조 '*', 고를 수 없음 '!'
  const rows = () => ev(`(() => { const l = document.querySelector('[data-worktree-rows]'); return l ? [...l.querySelectorAll('[data-worktree-row-kind]')].map(b => b.dataset.worktreeRowKind + ':' + b.dataset.worktreeRowName + (b.classList.contains('on') ? '*' : '') + (b.getAttribute('aria-disabled') === 'true' ? '!' : '')).join('|') : null; })()`);
  const rowText = (kind) => ev(`document.querySelector('[data-worktree-rows] [data-worktree-row-kind="${kind}"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
  const nameVal = () => ev(`document.querySelector('[data-worktree-name]')?.value ?? null`);
  const menuOpen = () => ev(`!!document.querySelector('[data-project-menu]')`);
  const reopen = async () => { await openMenuOn("L1"); await sleep(300); await ev(`document.querySelector('[data-project-action="worktree"]').click()`); await sleep(400); };
  const addNames = (from) => ev(`JSON.stringify(window.__calls.slice(${from}).filter(c => c[0] === 'git_worktree_add').map(c => c[1].name))`);
  check((await ev(`!!document.querySelector('[data-worktree-plan]')`)) === false, "판정 한 줄(data-worktree-plan)은 없다 — 줄이 대신 말한다");
  // 빈 칸 = 모든 브랜치(주 브랜치 · 로컬과 같은 이름의 원격 줄 제외) · 체크아웃된 것은 흐리게 · **강조 없음**(빈 칸의 Enter 가
  // 첫 브랜치를 열지 않게 — 2026-10-05 실기)
  await setName("");
  check((await rows()) === "busy:feat-x!|local:old-a|local:old-b|remote:feat-remote", `빈 칸 → 모든 브랜치 · feat-x 흐림 · 강조 없음 (${await rows()})`);
  check((await rowText("busy")) === "⎇ feat-x 다른 워크트리에서 열림", `흐린 줄 표식 (${await rowText("busy")})`);
  check((await rowText("remote")) === "⎇ origin/feat-remote 원격 · 받아 옴", `원격 줄 = 온전한 참조 + 동작 (${await rowText("remote")})`);
  check((await rowText("local")) === "⎇ old-a 로컬", `로컬 줄 (${await rowText("local")})`);
  console.log("capture:", await shot("worktree-combobox.png"));
  {
    const b0 = await ev(`window.__calls.length`);
    await key("Enter", 0, "Enter"); await sleep(250);
    const err0 = await ev(`document.querySelector('[data-project-menu] .ctx-error')?.textContent.trim() ?? null`);
    check(err0 === "이름을 입력하세요" && (await addNames(b0)) === "[]" && (await menuOpen()) === true, `빈 칸 Enter → '이름을 입력하세요' · 만들지 않는다 (${err0} · ${await addNames(b0)})`);
    const b1 = await ev(`window.__calls.length`);
    await ev(`document.querySelector('[data-worktree-submit]').click()`); await sleep(250);
    check((await addNames(b1)) === "[]" && (await menuOpen()) === true, "빈 칸 [만들고 열기] → 만들지 않는다");
  }
  await setName("");
  await key("ArrowUp", 0, "ArrowUp");
  check((await rows()) === "busy:feat-x!|local:old-a|local:old-b|remote:feat-remote*", `빈 칸 ↑ → 끝 줄 (${await rows()})`);
  await key("ArrowDown", 0, "ArrowDown");
  check((await rows()) === "busy:feat-x!|local:old-a*|local:old-b|remote:feat-remote", `↓ → 처음으로 돈다 (흐린 줄 건너뜀) (${await rows()})`);
  // 글자를 쳤다가 다시 비우면 강조도 없음으로
  await setName("ol"); await setName("");
  check((await rows()) === "busy:feat-x!|local:old-a|local:old-b|remote:feat-remote", `다시 비우면 강조 없음 (${await rows()})`);
  // 새 이름 → 맨 위 만들기 줄(강조) · 부분 일치 거르기
  await setName("old");
  check((await rows()) === "create:old*|local:old-a|local:old-b", `'old' → 만들기 줄 + old-a · old-b (${await rows()})`);
  check((await rowText("create")) === '＋ 새 브랜치 "old" 만들기 main 에서', `만들기 줄 (${await rowText("create")})`);
  // 있는 브랜치와 똑같으면 만들기 줄이 없다 · 체크아웃된 것뿐이면 강조도 없다
  await setName("feat-x");
  check((await rows()) === "busy:feat-x!", `'feat-x' → 흐린 줄 하나 · 만들기 없음 (${await rows()})`);
  // 이름 규칙에 어긋나면 만들기 줄이 없다
  await setName("a b");
  check((await rows()) === null, `'a b' → 줄 없음 (${await rows()})`);
  // Tab = 이름만 채운다 (원격도 짧은 이름)
  await setName("remote");
  check((await rows()) === "create:remote*|remote:feat-remote", `'remote' → 만들기 줄 + 원격 줄 (${await rows()})`);
  const bT = await ev(`window.__calls.length`);
  await key("ArrowDown", 0, "ArrowDown"); await key("Tab", 0, "Tab"); await sleep(150);
  check((await nameVal()) === "feat-remote" && (await menuOpen()) === true && (await addNames(bT)) === "[]", `Tab → 칸 = feat-remote · 만들지 않는다 (${await nameVal()})`);
  // Escape — 목록을 먼저 접고(↓ 로 다시 편다), 그다음 Escape 가 상자를 닫는다
  await setName("ol");
  check((await rows()) !== null, "준비: 목록이 떠 있다");
  await key("Escape", 0, "Escape"); await sleep(150);
  check((await rows()) === null && (await menuOpen()) === true, "첫 Escape → 목록만 접힌다");
  await key("ArrowDown", 0, "ArrowDown"); await sleep(150);
  check((await rows()) === "create:ol*|local:old-a|local:old-b", `↓ → 목록이 다시 펴진다 (${await rows()})`);
  await key("Escape", 0, "Escape"); await sleep(150);
  await key("Escape", 0, "Escape"); await sleep(200);
  check((await menuOpen()) === false, "목록이 접힌 뒤의 Escape → 상자가 닫힌다");
  // Enter = 강조 줄을 고른다(만들고 연다)
  await reopen();
  await setName("ol");
  await key("ArrowDown", 0, "ArrowDown"); await key("ArrowDown", 0, "ArrowDown");
  check((await rows()) === "create:ol|local:old-a|local:old-b*", `↓↓ → old-b 강조 (${await rows()})`);
  const bE = await ev(`window.__calls.length`);
  await key("Enter", 0, "Enter"); await sleep(1500);
  check((await addNames(bE)) === JSON.stringify(["old-b"]) && (await menuOpen()) === false, `Enter → git_worktree_add { name: old-b } · 상자 닫힘 (${await addNames(bE)})`);
  // 클릭 = 고른다 — 원격 줄은 짧은 이름으로(Rust 가 원격 추적 갈래로 간다) · 흐린 줄 클릭은 아무 일도 없다
  await reopen();
  await setName("");
  const bC = await ev(`window.__calls.length`);
  await ev(`document.querySelector('[data-worktree-row-kind="busy"]').click()`); await sleep(200);
  check((await addNames(bC)) === "[]" && (await menuOpen()) === true, "흐린 줄 클릭 → 아무 일도 없다");
  await ev(`document.querySelector('[data-worktree-row-kind="remote"]').click()`); await sleep(1500);
  check((await addNames(bC)) === JSON.stringify(["feat-remote"]) && (await menuOpen()) === false, `원격 줄 클릭 → git_worktree_add { name: feat-remote } (${await addNames(bC)})`);
  // 빈 칸에서 ↓ + Enter → 첫 브랜치(old-a)를 연다
  await reopen();
  await setName("");
  await key("ArrowDown", 0, "ArrowDown");
  const bD = await ev(`window.__calls.length`);
  await key("Enter", 0, "Enter"); await sleep(1500);
  check((await addNames(bD)) === JSON.stringify(["old-a"]) && (await menuOpen()) === false, `빈 칸 ↓ Enter → git_worktree_add { name: old-a } (${await addNames(bD)})`);
  await reopen();
}
const bFy = await ev(`window.__calls.length`);
await ev(`(() => { const el = document.querySelector('[data-worktree-name]'); el.value = ''; el.dispatchEvent(new Event('input', { bubbles: true })); el.focus(); })()`);
await send("Input.insertText", { text: "feat-y" }); await sleep(250);
const hint = await ev(`document.querySelector('[data-worktree-where]')?.textContent ?? null`);
check(hint === "자리: C:\\src\\proj-wt\\feat-y", `친 이름의 온전한 자리 (${hint})`);
const clipped = await ev(`(() => { const el = document.querySelector('[data-worktree-where]'); return el.scrollWidth > el.clientWidth + 1; })()`);
check(clipped === false, "자리 줄이 잘리지 않는다 (말줄임 없음)");
console.log("capture:", await shot("worktree-prompt.png"));
await ev(`document.querySelector('[data-worktree-submit]').click()`); await sleep(2200);
const addCalls = await ev(`JSON.stringify(window.__calls.slice(${bFy}).filter(c => c[0] === 'git_worktree_add').map(c => c[1]))`);
check(addCalls === JSON.stringify([{ repo: "C:\\src\\proj", name: "feat-y", dir: null }]), `git_worktree_add { repo, name, dir } (${addCalls})`);
const newOpen = await ev(`JSON.stringify(window.__calls.slice(${bFy}).filter(c => c[0] === 'open_local_session').map(c => c[1].cwd))`);
check(newOpen === JSON.stringify(["C:\\src\\proj-wt\\feat-y"]), `돌려준 경로로 타일이 뜬다 (${newOpen})`);
const order = await ev(`(() => { const s = window.__calls.slice(${bFy}).map(c => c[0]); return s.indexOf('git_worktree_add') < s.indexOf('open_local_session'); })()`);
check(order === true, "만들고 나서 연다 (git_worktree_add → open_local_session)");
const relist = await ev(`(() => { const s = window.__calls.slice(${bFy}).map(c => c[0]); return s.lastIndexOf('git_worktree_list') > s.indexOf('git_worktree_add'); })()`);
check(relist === true, "만든 뒤 트리의 목록을 한 번 다시 읽는다");
const toastText = await ev(`[...document.querySelectorAll('.toast .text')].map(e => e.textContent.trim()).find(s => s.startsWith('워크트리를') && s.includes('feat-y')) ?? null`);
check(toastText === "워크트리를 만들었습니다: C:\\src\\proj-wt\\feat-y", `알림 = 온전한 경로 (${toastText})`);
const toastAct = await ev(`[...document.querySelectorAll('.toast')].find(e => e.textContent.includes('워크트리를 만들었습니다'))?.querySelector('.act')?.textContent?.trim() ?? null`);
check(toastAct === "폴더 열기", `알림 단추 = 폴더 열기 (${toastAct})`);
check((await tabTitles()).split("|").includes("aynx · feat-y"), `새 워크트리 탭 제목 = aynx · feat-y (${await tabTitles()})`);
check((await ev(`!!document.querySelector('[data-project-menu]')`)) === false, "만들고 열기 뒤 이름 상자가 닫힌다 (실기 ③)");

// 실기 ③ — 키보드 길: 프로젝트 줄 Insert → 이름 → Enter. 확정의 Enter 가 독까지 올라가면 골라진
// 프로젝트 줄을 Enter 로 **또 연다**(예전엔 "+" 줄을 다시 열어 상자가 안 닫힌 것처럼 보였다)를 본다.
{
  await showProjects();
  await ev(`(() => { const b = document.querySelector('[data-project-dock] [data-project-id="L1"]'); b.dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true })); b.focus(); })()`); await sleep(150);
  const shapeK = await treeShape();
  await key("Insert", 0, "Insert"); await sleep(300);
  check((await ev(`document.activeElement?.hasAttribute('data-worktree-name')`)) === true, "프로젝트 줄 Insert → 이름 칸에 포커스");
  check((await treeShape()) === shapeK, "Insert 도 펼침을 건드리지 않는다");
  await send("Input.insertText", { text: "feat-e" }); await sleep(150);
  const bE = await ev(`window.__calls.length`);
  await key("Enter", 0, "Enter"); await sleep(2200);
  check((await ev(`window.__calls.slice(${bE}).filter(c => c[0] === 'git_worktree_add').length`)) === 1, "Enter 확정 → git_worktree_add 한 번");
  const opened = await ev(`JSON.stringify(window.__calls.slice(${bE}).filter(c => c[0] === 'open_local_session').map(c => c[1].cwd))`);
  check(opened === JSON.stringify(["C:\\src\\proj-wt\\feat-e"]), `확정의 Enter 가 독까지 새지 않는다 — 열린 것은 새 워크트리 하나뿐 (${opened})`);
  check((await ev(`!!document.querySelector('[data-project-menu]')`)) === false, "Enter 확정 뒤 상자가 닫혀 있다 (다시 열리지 않는다)");
  // 워크트리 줄의 Insert 는 그 부모 프로젝트의 칸이다
  await showProjects();
  if (!(await treeShape()).includes("P:L1+")) { await twisty("L1"); await sleep(500); }
  await ev(`(() => { const b = document.querySelector('[data-worktree-row="C:/src/proj-wt/feat-x"]'); b.click(); b.focus(); })()`); await sleep(150);
  await key("Insert", 0, "Insert"); await sleep(300);
  const askTitle = await ev(`document.querySelector('[data-project-menu] .ctx-title')?.textContent.trim() ?? null`);
  check((await ev(`document.activeElement?.hasAttribute('data-worktree-name')`)) === true && askTitle === "새 워크트리 — aynx", `워크트리 줄 Insert → 부모 프로젝트의 이름 칸 (${askTitle})`);
  await key("Escape", 0, "Escape"); await sleep(150); await key("Escape", 0, "Escape"); await sleep(200); // 목록 접기 → 상자 닫기
}

// 실기 ③ — 터미널이 포커스를 쥔 채로 상자를 열어도 칸이 포커스를 받고, 터미널이 되찾으려 해도
// 칸으로 돌아오며, 포커스가 터미널에 있어도 Escape 가 닫는다.
{
  await showProjects();
  const hasXterm = await ev(`!!document.querySelector('.xterm-helper-textarea')`);
  check(hasXterm === true, "터미널이 있다 (시험 준비)");
  await ev(`(() => { document.querySelector('.xterm-helper-textarea').focus(); document.querySelector('[data-worktree-add="L1"]').click(); })()`); await sleep(300);
  check((await ev(`document.activeElement?.hasAttribute('data-worktree-name')`)) === true, "터미널 포커스 중에 열어도 이름 칸이 포커스를 받는다");
  await ev(`document.querySelector('.xterm-helper-textarea').focus()`); await sleep(200);
  check((await ev(`document.activeElement?.hasAttribute('data-worktree-name')`)) === true, "터미널이 포커스를 되찾아도(term.focus) 칸으로 돌아온다");
  // 포커스를 **실제로** 받는 터미널을 고른다(숨은 탭의 터미널은 focus() 가 먹지 않아 칸에 그대로 남는다 — 그러면
  // 브랜치 목록이 떠 있는 칸의 Escape 라 목록만 접힌다, 2026-10-05 콤보박스).
  const escFrom = await ev(`(() => { const ta = [...document.querySelectorAll('.xterm-helper-textarea')].find((t) => { t.focus(); return document.activeElement === t; }); if (!ta) return 'none'; ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true })); return 'xterm'; })()`); await sleep(200);
  console.log("escape from:", escFrom);
  check((await ev(`!!document.querySelector('[data-project-menu]')`)) === false, "포커스가 터미널에 있어도 Escape 가 상자를 닫는다");
}

// 원격 — 트리는 붙어 있는 세션으로(③ 에서 api 를 열었다), 새 워크트리는 첫 입력 재료로
await showProjects();
await twisty("R1"); await sleep(600);
const rRows = await ev(`[...document.querySelectorAll('[data-project-dock] [data-worktree-parent="R1"]')].map(b => b.getAttribute('data-worktree-row')).join('|')`);
check(rRows === "/root/api|/root/api-wt/fix", `원격 트리 = 붙어 있는 세션의 ssh_git_worktree_list (${rRows})`);
// `~` 와 git 의 절대 경로 — ③ 에서 연 api 타일은 `~/api` 에서 시작했고(codex = AI 타일) git 은
// `/root/api` 로 적는다. 홈(`ssh_remote_home` → /root)으로 양쪽을 펴서 주 폴더 줄에 점이 선다.
{
  const homeCalls = await ev(`window.__calls.filter(c => c[0] === 'ssh_remote_home').length`);
  check(homeCalls === 1, `원격 홈은 별칭마다 한 번만 묻는다 (${homeCalls})`);
  // 점은 훅 신호가 있어야 선다(90fb2e1) — ③ 의 api 타일 스트림으로 start 하나
  await ev(`(async () => { const m = await ${importApp("app/tabs.svelte.ts")}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); for (const tab of m.residentWindowTabs()) for (const p of walk(tab.root, [])) if (p.cwd === '~/api' && p.historyStreamId) await ${FAKE_AGENT_SIGNAL_FN}({ stream: p.historyStreamId, event: 'start', detail: null, at: Date.now() }); })()`);
  await sleep(300);
  const rDot = await ev(`document.querySelector('[data-worktree-row="/root/api"] .agentdot')?.className ?? 'none'`);
  check(rDot !== "none", `~/api 에서 연 타일 → /root/api 줄에 점 (${rDot})`);
  const fixDot = await ev(`document.querySelector('[data-worktree-row="/root/api-wt/fix"] .agentdot')?.className ?? 'none'`);
  check(fixDot === "none", `다른 워크트리 줄에는 점이 없다 (${fixDot})`);
  await twisty("R1"); await sleep(200); await twisty("R1"); await sleep(600);
  check((await ev(`window.__calls.filter(c => c[0] === 'ssh_remote_home').length`)) === 1, "다시 펼쳐도 홈은 다시 묻지 않는다 (사본)");
}
const rMenu = await openWtMenu("/root/api-wt/fix");
check(rMenu === "열기|지금 탭에 열기|브랜치 그래프|변경 보기main 대비|브랜치 삭제…|설정 스크립트 실행|제거…", `원격 워크트리 메뉴 — 폴더 열기 없음 · 제거 있음 (${rMenu})`);
await key("Escape", 0, "Escape"); await sleep(200);
const rMenu0 = await openWtMenu("/root/api");
check(rMenu0 === "열기|지금 탭에 열기|브랜치 그래프|변경 보기main 대비|브랜치 삭제…|설정 스크립트 실행", `원격 주 폴더 메뉴 — 제거 없음 (${rMenu0})`);
await key("Escape", 0, "Escape"); await sleep(200);

// 원격 브랜치 삭제 — 붙은 세션으로 (docs/log/2026-10-01-worktree-branch-ops.md)
{
  const rhMod = importApp("app/remote-home.svelte.ts");
  const liveId = await ev(`(async () => (await ${rhMod}).liveSessionFor('dev-01'))()`);
  const bB = await ev(`window.__calls.length`);
  await openWtMenu("/root/api-wt/fix"); await sleep(250);
  await ev(`document.querySelector('[data-worktree-action="deleteBranch"]').click()`); await sleep(500);
  await ev(`document.querySelector('[data-worktree-branch-submit]').click()`); await sleep(700);
  const rb = await ev(`JSON.stringify(window.__calls.slice(${bB}).filter(c => c[0].includes('branch')).map(c => [c[0], c[1]]))`);
  check(rb === JSON.stringify([
    ["ssh_git_worktree_branch_choices", { id: liveId, repo: "~/api" }],
    ["ssh_git_branch_delete", { id: liveId, repo: "~/api", branch: "old-a" }],
  ]), `원격 = ssh_git_worktree_branch_choices { id, repo } → ssh_git_branch_delete { id, repo, branch } (${rb})`);
  check((await ev(`window.__calls.slice(${bB}).some(c => c[0] === 'ssh_git_worktree_list')`)) === true, "원격도 지운 뒤 트리를 다시 읽는다");
}

// 원격 제거 (docs/log/2026-09-24-worktrees.md "원격 제거") — 붙은 세션으로, 칸은 **꺼진 채**.
{
  const sessMod = importApp("app/sessions.svelte.ts");
  const rhMod = importApp("app/remote-home.svelte.ts");
  const liveId = await ev(`(async () => (await ${rhMod}).liveSessionFor('dev-01'))()`);
  await ev(`(() => { const b = document.querySelector('[data-worktree-row="/root/api-wt/fix"]'); b.click(); b.focus(); })()`); await sleep(150);
  const bR = await ev(`window.__calls.length`);
  await key("Delete", 0, "Delete"); await sleep(500);
  const rBox = await removeBox();
  console.log("remote remove dialog:", JSON.stringify(rBox));
  check(rBox?.box?.checked === false && rBox.box.disabled === false && rBox.box.label === "브랜치 fix 도 삭제", `Delete (원격 워크트리) → 상자 · 칸 **꺼진 채**(켤 수는 있다) (${JSON.stringify(rBox)})`);
  check(rBox?.hint === "원격에서는 앱이 브랜치를 만들었는지 알 수 없어 기본은 남깁니다. 켜면 병합된 경우에만 삭제합니다.", `원격 까닭 한 줄 (${rBox?.hint})`);
  console.log("capture:", await shot("worktree-remove-remote.png"));
  await ev(`document.querySelector('[data-worktree-remove-submit]').click()`); await sleep(700);
  const rCalls = await ev(`JSON.stringify(window.__calls.slice(${bR}).filter(c => c[0] === 'ssh_git_worktree_remove' || c[0] === 'git_worktree_remove').map(c => [c[0], c[1]]))`);
  check(rCalls === JSON.stringify([["ssh_git_worktree_remove", { id: liveId, repo: "~/api", path: "/root/api-wt/fix", deleteBranch: false }]]), `ssh_git_worktree_remove { id, repo, path, deleteBranch:false } (${rCalls})`);
  const rToastKept = await ev(`[...document.querySelectorAll('.toast .text')].map(e => e.textContent.trim()).find(x => x === '워크트리를 제거했습니다 · 브랜치 fix 은 남겼습니다') ?? null`);
  check(rToastKept !== null, "알림 = 워크트리를 제거했습니다 · 브랜치 fix 은 남겼습니다");
  check((await ev(`window.__calls.slice(${bR}).some(c => c[0] === 'ssh_git_worktree_list')`)) === true, "원격도 지운 뒤 트리를 다시 읽는다");

  // 붙은 세션이 없으면 — 알림 한 줄, 상자도 호출도 없다. (세션 표를 잠시 비웠다가 되돌린다)
  const saved = await ev(`(async () => { const s = await ${sessMod}; const w = await ${importApp("app/tabs.svelte.ts")}; const out = []; const walk = (n) => n.type === 'leaf' ? (n.pane.kind === 'ssh' && out.push(n.pane.id)) : (walk(n.a), walk(n.b)); for (const t of w.residentWindowTabs()) walk(t.root); const kept = out.map(id => [id, s.sessionOf(id)]); for (const [id] of kept) s.noteSession(id, null); return JSON.stringify(kept); })()`);
  check((await ev(`(async () => (await ${rhMod}).liveSessionFor('dev-01'))()`)) === null, "세션을 비웠다 (시험 준비)");
  const bN = await ev(`window.__calls.length`);
  await openWtMenu("/root/api-wt/fix");
  await ev(`document.querySelector('[data-worktree-action="remove"]').click()`); await sleep(500);
  const noSessToast = await ev(`[...document.querySelectorAll('.toast .text')].map(e => e.textContent.trim()).find(x => x === '접속된 세션이 있어야 원격 워크트리를 제거할 수 있습니다') ?? null`);
  check(noSessToast !== null, "세션 없음 → '접속된 세션이 있어야 원격 워크트리를 제거할 수 있습니다'");
  check((await ev(`!!document.querySelector('[data-worktree-remove]')`)) === false, "세션 없음 → 상자가 뜨지 않는다");
  check((await ev(`window.__calls.slice(${bN}).some(c => c[0] === 'ssh_git_worktree_remove')`)) === false, "세션 없음 → 호출 없음");
  await ev(`(async () => { const s = await ${sessMod}; for (const [id, sid] of ${saved}) if (sid !== null) s.noteSession(id, sid); })()`);
}
// ⑨ 원격 Claude Code 훅 — 원격 프로젝트 메뉴에만 · 붙은 세션으로 · 확인 창을 거친다
{
  const rhMod = importApp("app/remote-home.svelte.ts");
  const liveId = await ev(`(async () => (await ${rhMod}).liveSessionFor('dev-01'))()`);
  await openMenuOn("R1"); await sleep(300);
  const rItems = await ev(`[...document.querySelectorAll('[data-project-menu] button')].map(b => b.textContent.trim()).join('|')`);
  check(rItems === "열기|지금 탭에 열기|브랜치 그래프|새 워크트리에서 열기…|원격에 Claude Code 훅 설치…|원격 Claude Code 훅 제거|원격에 Codex 훅 설치…|원격 Codex 훅 제거|편집…|삭제", `원격 프로젝트 메뉴에 훅 설치·제거 (${rItems})`);
  console.log("capture:", await shot("projects-menu-remote-hooks.png"));
  // 확인 창에서 "아니오" — 상태만 읽고 쓰지 않는다
  const bH = await ev(`window.__calls.length`);
  await ev(`document.querySelector('[data-project-action="hooksInstall"]').click()`); await sleep(600);
  const hCalls = await ev(`JSON.stringify(window.__calls.slice(${bH}).filter(c => c[0].startsWith('agent_hooks_remote') || c[0] === 'plugin:dialog|message').map(c => c[0] === 'plugin:dialog|message' ? [c[0], c[1].message.split('\\n')[0], c[1].message.includes('~/.claude/settings.json')] : [c[0], c[1]]))`);
  check(hCalls === JSON.stringify([["agent_hooks_remote_status", { id: liveId, agent: 'claude' }], ["plugin:dialog|message", "원격: dev-01", true]]), `설치… → 상태(id) → 확인 창 첫 줄 '원격: dev-01' + 서버 경로 · "아니오" 면 쓰지 않는다 (${hCalls})`);
  // "설치" — 쓴다
  await ev(`window.__dialogAnswer = '설치'`);
  await openMenuOn("R1"); await sleep(300);
  const bH2 = await ev(`window.__calls.length`);
  await ev(`document.querySelector('[data-project-action="hooksInstall"]').click()`); await sleep(700);
  const hCalls2 = await ev(`JSON.stringify(window.__calls.slice(${bH2}).filter(c => c[0].startsWith('agent_hooks_remote')).map(c => [c[0], c[1]]))`);
  check(hCalls2 === JSON.stringify([["agent_hooks_remote_status", { id: liveId, agent: 'claude' }], ["agent_hooks_remote_install", { id: liveId, agent: 'claude' }]]), `확인 → agent_hooks_remote_install { id, agent } (${hCalls2})`);
  const hToast = await ev(`[...document.querySelectorAll('.toast .text')].map(e => e.textContent.trim()).find(x => x.startsWith('dev-01 에 Claude Code 훅을')) ?? null`);
  check(hToast !== null, `설치 알림 (${hToast})`);
  await ev(`window.__dialogAnswer = undefined`);
  // 제거 — 확인 없이
  await openMenuOn("R1"); await sleep(300);
  const bH3 = await ev(`window.__calls.length`);
  await ev(`document.querySelector('[data-project-action="hooksRemove"]').click()`); await sleep(600);
  const hCalls3 = await ev(`JSON.stringify(window.__calls.slice(${bH3}).filter(c => c[0].startsWith('agent_hooks_remote') || c[0] === 'plugin:dialog|message').map(c => [c[0], c[1]?.id ?? null]))`);
  check(hCalls3 === JSON.stringify([["agent_hooks_remote_remove", liveId]]), `원격 훅 제거 → agent_hooks_remote_remove { id } (확인 없이) (${hCalls3})`);
  // 로컬 프로젝트 메뉴에는 없다
  await openMenuOn("L1"); await sleep(300);
  check((await ev(`!!document.querySelector('[data-project-action="hooksInstall"]')`)) === false, "로컬 프로젝트 메뉴에는 원격 훅 항목이 없다");
  await key("Escape", 0, "Escape"); await sleep(200);
}
await twisty("R1"); await sleep(400);
await openMenuOn("R1"); await sleep(300);
await ev(`document.querySelector('[data-project-action="worktree"]').click()`); await sleep(300);
const rHint0 = await ev(`document.querySelector('[data-worktree-where]')?.textContent ?? null`);
check(rHint0 === "자리: ~/api-wt/<이름>", `원격 자리 미리 보기 (${rHint0})`);
await send("Input.insertText", { text: "feat-z" }); await sleep(150);
const b6 = await ev(`window.__calls.length`);
await ev(`document.querySelector('[data-worktree-submit]').click()`); await sleep(2200);
// 표(`ticket`)는 타일이 뽑는 난수라 모양만 본다(2026-09-29 B안 — 준비 이벤트 · 답이 이 글자로 타일을 가리킨다).
const rNew = await ev(`JSON.stringify(window.__calls.slice(${b6}).filter(c => c[0] === 'open_ssh_session').map(c => {
  const s = c[1].start; const w = s.worktree;
  return { ...s, worktree: w ? { repo: w.repo, name: w.name, ticket: /^[0-9a-f]{32}$/.test(w.ticket) } : w };
}))`);
console.log("remote new worktree start:", rNew);
check(rNew === JSON.stringify([{ cwd: "~/api-wt/feat-z", command: "codex", worktree: { repo: "~/api", name: "feat-z", ticket: true } }]), "원격 새 워크트리 = start { cwd: 워크트리, worktree: { repo, name, ticket } }");
check((await ev(`window.__calls.slice(${b6}).some(c => c[0] === 'ssh_git_repo_status')`)) === false, "원격은 앞에서 붙은 세션을 빌려 판정하지 않는다 (타일이 접속한 뒤 묻는다)");
check((await ev(`window.__calls.slice(${b6}).some(c => c[0] === 'git_worktree_add')`)) === false, "원격은 로컬 git 을 부르지 않는다");
const rToast = await ev(`[...document.querySelectorAll('.toast')].find(e => e.textContent.includes('원격에서 워크트리를'))?.querySelector('.text')?.textContent?.trim() ?? null`);
check(rToast === "원격에서 워크트리를 만듭니다: ~/api-wt/feat-z", `원격 알림 = 만듭니다 + 온전한 자리 (${rToast})`);
const rToastAct = await ev(`[...document.querySelectorAll('.toast')].find(e => e.textContent.includes('원격에서 워크트리를'))?.querySelectorAll('.act').length ?? -1`);
check(rToastAct === 0, "원격 알림에는 폴더 열기 단추가 없다");

// ── ⑦ 에이전트 상태 점 (docs/log/2026-10-01-agent-status-three.md — 실행 중 · 권한 대기 · 완료, 훅 신호만) ────
await key("Escape", 0, "Escape"); await sleep(200);
const agentMod = importApp("app/agent-status.svelte.ts");
const tabsMod = importApp("app/tabs.svelte.ts");
// feat-y 워크트리 타일 — 자기 탭에 혼자 있는 로컬 claude 타일
const target = await ev(`(async () => { const m = await ${tabsMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); for (const tab of m.residentWindowTabs()) for (const p of walk(tab.root, [])) if (p.cwd === 'C:\\\\src\\\\proj-wt\\\\feat-y') return JSON.stringify({ tab: tab.id, pane: p.id }); return null; })()`);
console.log("agent tile:", target);
const { tab: agentTab, pane: agentPane } = JSON.parse(target ?? "{}");
const dotClass = () => ev(`document.querySelector('.tab[data-tab="${agentTab}"] [data-agent-dot]')?.className ?? 'none'`);
const report = (fn) => ev(`(async () => { const a = await ${agentMod}; const w = await ${tabsMod}; const p = w.findPaneAnywhere('${agentPane}'); a.${fn}(p); return a.isAgentPane(p); })()`);
check((await dotClass()) === "none", `열린 직후(신호 없음) = 점 없음 — 미상 고리는 없다 (${await dotClass()})`);
check((await report("agentOutput")) === true, "그 타일은 AI 타일로 판정된다");
await sleep(300);
check((await dotClass()) === "none", `출력만으로는 점이 서지 않는다 (포커스 다시 그리기도 출력이다) (${await dotClass()})`);

// ── ⑧ Claude Code 훅 신호 (docs/log/2026-09-24-agent-hook-signals.md) ─────────
// Rust 가 `agent-signal` {stream, event, detail, at} 을 방송한다 — 여기서는 스텁 버스로 같은 모양을 쏜다.
const stream = await ev(`(async () => { const w = await ${tabsMod}; return w.findPaneAnywhere('${agentPane}')?.historyStreamId ?? null; })()`);
const openedStream = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'open_local_session' && c[1].cwd === 'C:\\\\src\\\\proj-wt\\\\feat-y').map(c => ({ inject: c[1].injectMcpToken, streamId: c[1].streamId })))`);
check(!!stream && openedStream === JSON.stringify([{ inject: true, streamId: stream }]), `AI 타일 열기가 streamId(= historyStreamId) 를 싣는다 (${openedStream} vs ${stream})`);
check((await ev(`(window.__listeners['agent-signal'] ?? []).length`)) >= 1, "창이 agent-signal 을 듣는다");
const signal = (event, detail = null) => ev(fakeAgentSignal(`{ stream: '${stream}', event: '${event}', detail: ${detail === null ? "null" : `'${detail}'`}, at: Date.now() }`));
await signal("start"); await sleep(300);
check((await dotClass()).includes("running"), `훅 start → 실행 중 (${await dotClass()})`);
const tip = await ev(`document.querySelector('.tab[data-tab="${agentTab}"] [data-agent-dot]')?.getAttribute('title')`);
check(tip === "Claude Code 실행 중", `말풍선 (${tip})`);
console.log("capture:", await shot("agent-dot.png"));
// 점을 누르면 그 탭 · 그 타일로 (먼저 다른 탭을 본다)
await ev(`(async () => { const w = await ${tabsMod}; const other = w.currentWorkspaceTabs().find(t => t.id !== '${agentTab}'); if (other) w.selectTab(other.id); })()`); await sleep(300);
await ev(`document.querySelector('.tab[data-tab="${agentTab}"] [data-agent-dot]').dispatchEvent(new MouseEvent('click', { bubbles: true }))`); await sleep(300);
const focused = await ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return t ? t.id + '/' + w.paneOf(t) : null; })()`);
check(focused === `${agentTab}/${agentPane}`, `점 클릭 → 그 탭의 그 타일 (${focused})`);
await sleep(3600);
check((await dotClass()).includes("running"), `조용해도 훅의 실행 중은 그대로 (오래 생각하는 턴) (${await dotClass()})`);
await signal("waiting"); await sleep(300);
check((await dotClass()).includes("running"), `훅 waiting(범주 없음 — 옛 스크립트) → 상태를 바꾸지 않는다 (${await dotClass()})`);
await signal("tool"); await sleep(300);
check((await dotClass()).includes("running"), `훅 tool(PreToolUse) → 실행 중 (${await dotClass()})`);
// 권한 물음(대기) → 사람이 승인 → 그 도구가 끝남(PostToolUse → tool-done) = 실행 중으로 돌아온다
await signal("waiting", "permission"); await sleep(300);
check((await dotClass()).includes("permission"), `권한 물음 → 권한 대기 (${await dotClass()})`);
await signal("tool-done"); await sleep(300);
check((await dotClass()).includes("running"), `훅 tool-done(PostToolUse) → 실행 중 (승인 뒤) (${await dotClass()})`);
// 완료는 "그 타일을 아직 안 봄" 일 때만 선다(보면 사라진다) — 다른 탭을 보는 채로 stop
await ev(`(async () => { const w = await ${tabsMod}; const other = w.currentWorkspaceTabs().find(t => t.id !== '${agentTab}'); if (other) w.selectTab(other.id); })()`); await sleep(300);
await report("agentOutput"); await signal("stop"); await sleep(300);
check((await dotClass()).includes("finished"), `훅 stop(안 본 탭) → 완료 — 출력이 막 흘렀어도 (발견 ①) (${await dotClass()})`);
await ev(fakeAgentSignal(`{ stream: 'nope', event: 'start', detail: null, at: 0 }`)); await sleep(300);
check((await dotClass()).includes("finished"), `이 창에 없는 스트림은 버린다 (${await dotClass()})`);
console.log("capture:", await shot("agent-dot-hook.png"));
await ev(`(async () => { const w = await ${tabsMod}; w.selectTab('${agentTab}'); })()`); await sleep(300);
check((await dotClass()) === "none", `그 탭을 보면 완료가 사라진다 (${await dotClass()})`);

// ── ⑩ 턴 끝 알림 (docs/log/2026-09-25-agent-stop-notify.md) ──────────────────
// 훅 `stop` 하나가 알린다 — (포커스된 그 타일) 조용 · (다른 탭) 배너 · (창이 없음) OS 알림 + 배너 · (끔) 조용.
// 2026-09-27 부터 창 안 표면은 토스트가 아니라 위 가운데 배너다(docs/log/2026-09-27-agent-banners.md).
{
  const setMod = importApp("lib/settings.svelte.ts");
  // 이름 = 그 타일의 **탭 제목**(탭 바가 그린 글자 그대로 — 셸 라벨 `PowerShell 7` 이 아니다)
  const tileName = await ev(`document.querySelector('.tab[data-tab="${agentTab}"] .title')?.textContent?.trim() ?? null`);
  check(tileName === "aynx · feat-y", `알림 이름 = 탭 제목 (${tileName})`);
  const bannerMod = importApp("app/agent-banners.svelte.ts");
  /** 그 타일의 해결되지 않은 배너 항목 (없으면 null) — {kind, text, hidden} */
  const bannerOf = (pane) => ev(`(async () => { const m = await ${bannerMod}; const b = m.agentBannerItems().find(x => x.paneId === '${pane}'); return b ? JSON.stringify({ kind: b.kind, text: b.text, at: b.at }) : null; })()`).then((v) => (v ? JSON.parse(v) : null));
  const stopToasts = () => ev(`[...document.querySelectorAll('.toast')].filter(e => e.textContent.includes('Claude Code 작업이 끝났습니다')).length`);
  const osCalls = (from) => ev(`JSON.stringify(window.__calls.slice(${from}).filter(c => c[0] === 'Notification').map(c => c[1]))`);
  const focusAgent = () => ev(`(async () => { const w = await ${tabsMod}; w.focusTile('${agentTab}', '${agentPane}'); })()`);
  const showOther = () => ev(`(async () => { const w = await ${tabsMod}; const other = w.currentWorkspaceTabs().find(t => t.id !== '${agentTab}'); if (other) w.selectTab(other.id); return !!other; })()`);
  console.log("agent tile name:", tileName);
  check((await ev(`document.hidden`)) === false, "헤드리스 창이 hidden 이 아니다 (windowFocused 의 다른 항)");
  // (a) 창 포커스 + 그 타일이 활성 탭의 포커스 타일 → 조용
  await ev(`window.__focus = true; window.dispatchEvent(new Event('focus'))`); await focusAgent(); await sleep(200);
  const t0 = await stopToasts(); const c0 = await ev(`window.__calls.length`);
  await signal("stop"); await sleep(600);
  check((await bannerOf(agentPane)) === null && (await stopToasts()) === t0 && (await osCalls(c0)) === "[]", `(a) 보고 있는 타일의 stop → 배너·토스트·OS 알림 없음 (${await osCalls(c0)})`);
  // (b) 창 포커스 + 다른 탭 → 토스트(타일 이름) + "보기" 가 그 타일로
  check((await showOther()) === true, "(b) 다른 탭이 있다");
  await sleep(200);
  const c1 = await ev(`window.__calls.length`);
  await signal("stop"); await sleep(600);
  const banner = await bannerOf(agentPane);
  check(banner?.kind === "stop" && banner.text === `${tileName} — Claude Code 작업이 끝났습니다`, `(b) 다른 탭에서 stop → 배너 (${JSON.stringify(banner)})`);
  const bannerTitle = await ev(`document.querySelector('[data-agent-banner][data-pane="${agentPane}"] .title')?.textContent?.trim() ?? null`);
  check(bannerTitle === `Claude Code · ${tileName}`, `(b) 배너 머리줄 = 에이전트 · 탭 제목 (${bannerTitle})`);
  check((await osCalls(c1)) === "[]", `(b) 창을 보고 있으면 OS 알림은 없다 (${await osCalls(c1)})`);
  console.log("capture:", await shot("agent-stop-toast.png"));
  const act = await ev(`(() => { const b = document.querySelector('[data-agent-banner][data-pane="${agentPane}"] [data-banner-open]'); if (!b) return null; const label = b.textContent.trim(); b.click(); return label; })()`);
  await sleep(300);
  const after = await ev(`(async () => { const w = await ${tabsMod}; const t = w.activeTab(); return t ? t.id + '/' + w.paneOf(t) : null; })()`);
  check(act === "보기" && after === `${agentTab}/${agentPane}`, `(b) "보기" → 그 탭의 그 타일 (${act} · ${after})`);
  check((await bannerOf(agentPane)) === null, "(b) [보기] → 해결");
  // (c) 창이 앞에 없음 → OS 알림 한 장 + 배너 항목(돌아왔을 때 남아 있게 — 토스트는 없다)
  await ev(`window.__focus = false; window.dispatchEvent(new Event('blur'))`);
  const t2 = await stopToasts(); const c2 = await ev(`window.__calls.length`);
  await signal("stop"); await sleep(800);
  const os2 = await osCalls(c2);
  const app = await appTitle();
  check(os2 === JSON.stringify([{ title: `${app} · ${tileName}`, body: "Claude Code 작업이 끝났습니다" }]), `(c) 창이 없으면 OS 알림 한 장 (${os2})`);
  check((await stopToasts()) === t2, `(c) 그때 토스트는 더하지 않는다 (${await stopToasts()} vs ${t2})`);
  check((await bannerOf(agentPane))?.kind === "stop", "(c) 배너 항목도 선다 (보던 타일이어도 — 창이 뒤에 있었다)");
  // 창이 돌아오면 그 타일이 포커스돼 있으므로 곧바로 풀린다 — (d) 는 빈 상태에서 센다
  await ev(`window.__focus = true; window.dispatchEvent(new Event('focus'))`); await sleep(400);
  check((await bannerOf(agentPane)) === null, "(c) 창이 돌아오면 보던 그 타일의 배너는 풀린다");
  await ev(`window.__focus = false; window.dispatchEvent(new Event('blur'))`);
  // (d) 설정 끔 → 창이 없어도 · 다른 탭이어도 아무것도
  await ev(`(async () => (await ${setMod}).setNotifyTurnEnd(false))()`);
  const c3 = await ev(`window.__calls.length`); const t3 = await stopToasts();
  await signal("stop"); await sleep(600);
  await ev(`window.__focus = true; window.dispatchEvent(new Event('focus'))`); await showOther(); await sleep(200);
  await signal("stop"); await sleep(600);
  check((await osCalls(c3)) === "[]" && (await stopToasts()) === t3 && (await bannerOf(agentPane)) === null, `(d) 끄면 OS 알림도 배너도 없다 (${await osCalls(c3)} · ${await stopToasts()} vs ${t3})`);
  // 되돌린다 — 뒤 시나리오는 켬 · 포커스 · 그 타일에서 이어진다
  await ev(`(async () => (await ${setMod}).setNotifyTurnEnd(true))()`);
  check((await ev(`(async () => (await ${setMod}).settings.notifyTurnEnd)()`)) === true, "(d) 다시 켰다");
  await focusAgent(); await sleep(200);
}
// 실기 ② — 에이전트가 끝나 셸 프롬프트(OSC 133 A)가 돌아오면 끝남 · 헤더는 셸로
{
  const titlesMod = importApp("app/titles.svelte.ts");
  const nameOf = () => ev(`(async () => { const t = await ${titlesMod}; const w = await ${tabsMod}; return t.displayName(w.findPaneAnywhere('${agentPane}')); })()`);
  check((await nameOf()) === "Claude Code", `끝나기 전 헤더 = Claude Code (${await nameOf()})`);
  // 명령(C) 없이 온 A 는 세지 않는다 — 세션이 막 열려 그리는 첫 프롬프트
  await signal("start"); await sleep(300);
  await report("agentPromptReturned"); await sleep(300);
  check((await dotClass()).includes("running"), `명령 전의 프롬프트는 끝남이 아니다 (실행 중 그대로) (${await dotClass()})`);
  await report("agentCommandStarted"); await report("agentOutput"); await sleep(200);
  check((await dotClass()) === "none", `에이전트 명령 시작(C) → 지난 훅 신호를 지운다 · 출력만으로는 점 없음 (${await dotClass()})`);
  // 훅이 실행 중을 말하고 있어도 프롬프트 복귀(끝남)가 이긴다
  await signal("start"); await sleep(300);
  check((await dotClass()).includes("running"), `(끝나기 전) 훅 start → 실행 중 (${await dotClass()})`);
  await report("agentPromptReturned"); await sleep(300);
  check((await dotClass()) === "none", `/exit → 셸 프롬프트 복귀 → 끝남 = 점 없음 (${await dotClass()})`);
  check((await nameOf()) !== "Claude Code", `헤더가 셸로 돌아온다 (${await nameOf()})`);
  await signal("start"); await sleep(300);
  check((await dotClass()) === "none", `셸로 돌아온 뒤의 훅 신호는 점을 되살리지 않는다 (${await dotClass()})`);
}
await report("agentExit"); await sleep(300);
check((await dotClass()) === "none", `세션 종료 → 끝남 = 점 없음 (${await dotClass()})`);

// ── ⑪ 평범한 셸 타일에서 손으로 친 claude (docs/log/2026-09-25-shell-claude-signals.md) ──────
// AI 타일로 열지 않은 로컬 타일도 스트림을 싣고(Rust 가 신호 전용 토큰을 심는다 — MCP 토큰은 아니다),
// 도는 명령(OSC 133 — 여기서는 `reportRunningCommand` + `agentCommandStarted` 스텁)이 `claude` 가 되면
// 훅 신호가 점·알림에 닿는다. `waiting` 은 범주가 `permission` 일 때만 알린다.
{
  const panesMod = importApp("app/panes.svelte.ts");
  const titlesMod = importApp("app/titles.svelte.ts");
  const sessionMod = importApp("lib/session.ts");
  const setMod = importApp("lib/settings.svelte.ts");
  const ncMod = importApp("app/notifications.svelte.ts");
  await ev(`window.__focus = true; window.dispatchEvent(new Event('focus'))`);
  const b0 = await ev(`window.__calls.length`);
  await ev(`(async () => (await ${panesMod}).addLocal({ id: 'pwsh', label: 'PowerShell 7' }))()`); await sleep(1500);
  const opened = JSON.parse(await ev(`JSON.stringify(window.__calls.slice(${b0}).filter(c => c[0] === 'open_local_session').map(c => ({ inject: c[1].injectMcpToken, streamId: c[1].streamId })))`));
  check(opened.length === 1 && opened[0].inject === false && typeof opened[0].streamId === "string", `평범한 셸 타일 = injectMcpToken:false + streamId (${JSON.stringify(opened)})`);
  const plainStream = opened[0]?.streamId;
  const found = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessionMod}; for (const tab of w.residentWindowTabs()) { const p = s.findPaneByStream(tab.root, '${plainStream}'); if (p) return JSON.stringify({ tab: tab.id, pane: p.id }); } return null; })()`);
  const { tab: plainTab, pane: plainPane } = JSON.parse(found ?? "{}");
  check(!!plainPane, `스트림으로 그 타일을 찾는다 (${found})`);
  const plainSignal = (event, detail = null) => ev(fakeAgentSignal(`{ stream: '${plainStream}', event: '${event}', detail: ${detail === null ? "null" : `'${detail}'`}, at: Date.now() }`));
  const isAgent = () => ev(`(async () => { const a = await ${agentMod}; const w = await ${tabsMod}; return a.isAgentPane(w.findPaneAnywhere('${plainPane}')); })()`);
  const plainStatus = () => ev(`(async () => { const a = await ${agentMod}; const w = await ${tabsMod}; return a.agentStatusOf(w.findPaneAnywhere('${plainPane}')); })()`);
  // 창 안 표면 = 배너(타일마다 한 항목 — 같은 타일의 새 알림은 그 항목을 바꾼다). 토스트는 더는 안 뜬다.
  const bannerMod = importApp("app/agent-banners.svelte.ts");
  const plainBanner = () => ev(`(async () => { const m = await ${bannerMod}; const b = m.agentBannerItems().find(x => x.paneId === '${plainPane}'); return b ? JSON.stringify({ kind: b.kind, text: b.text, at: b.at }) : null; })()`).then((v) => (v ? JSON.parse(v) : null));
  const toastsWith = (text) => ev(`[...document.querySelectorAll('.toast')].filter(e => e.textContent.includes(${JSON.stringify(text)})).length`);
  const osSince = (from) => ev(`JSON.stringify(window.__calls.slice(${from}).filter(c => c[0] === 'Notification').map(c => c[1]))`);
  const showOtherThanPlain = () => ev(`(async () => { const w = await ${tabsMod}; const other = w.currentWorkspaceTabs().find(t => t.id !== '${plainTab}'); if (other) w.selectTab(other.id); return !!other; })()`);
  const PERM = "Claude Code 가 권한을 묻고 있습니다";
  const STOP = "Claude Code 작업이 끝났습니다";

  // (a) claude 가 돌기 전 — 셸 타일은 에이전트가 아니다. 신호는 버린다.
  check((await isAgent()) === false, "(a) claude 전: 에이전트 타일이 아니다");
  await plainSignal("start"); await sleep(300);
  check((await plainStatus()) === null, `(a) claude 전의 신호는 버린다 — 점 없음 (${await plainStatus()})`);
  // (b) 손으로 친 claude — OSC 133 의 도는 명령
  await ev(`(async () => { const t = await ${titlesMod}; const a = await ${agentMod}; const w = await ${tabsMod}; t.reportRunningCommand('${plainPane}', 'claude'); a.agentCommandStarted(w.findPaneAnywhere('${plainPane}')); })()`); await sleep(200);
  check((await isAgent()) === true, "(b) 도는 명령 claude → 에이전트 타일");
  await plainSignal("start"); await sleep(300);
  check((await plainStatus()) === "running", `(b) 훅 start → 실행 중 (${await plainStatus()})`);
  const plainDot = await ev(`document.querySelector('.tab[data-tab="${plainTab}"] [data-agent-dot]')?.className ?? 'none'`);
  check(plainDot.includes("running"), `(b) 그 탭의 점 = 실행 중 (${plainDot})`);
  // (c) 다른 탭을 보는 중 stop → 턴 끝 토스트
  check((await showOtherThanPlain()) === true, "(c) 다른 탭으로 간다"); await sleep(200);
  await plainSignal("stop"); await sleep(600);
  const cBanner = await plainBanner();
  check(cBanner?.kind === "stop" && cBanner.text.endsWith(` — ${STOP}`), `(c) stop → 턴 끝 배너 (${JSON.stringify(cBanner)})`);
  check((await toastsWith(STOP)) === 0, "(c) 토스트로는 뜨지 않는다");
  // (d) waiting + permission → 권한 물음 배너 (tool 이 턴 끝 항목을 풀고, 같은 타일의 한 항목이 권한으로)
  await plainSignal("tool"); await plainSignal("waiting", "permission"); await sleep(600);
  const dBanner = await plainBanner();
  check(dBanner?.kind === "permission" && dBanner.text.endsWith(` — ${PERM}`), `(d) waiting·permission → 권한 물음 배너 (${JSON.stringify(dBanner)})`);
  check((await plainStatus()) === "permission", `(d) 점 = 권한 대기 (${await plainStatus()})`);
  check((await ev(`document.querySelector('[data-signal="notify"] .notify-pill')?.classList.contains('urgent') ?? false`)) === true, "(d) 종 배지 = 강조색 (권한 물음)");
  console.log("capture:", await shot("agent-permission-toast.png"));
  // (e) tool-done → 권한 항목은 저절로 풀린다 · waiting + idle · other · 범주 없음(옛 스크립트) → 알림 없음 (점은 그대로 — 상태를 바꾸지 않는다)
  const c1 = await ev(`window.__calls.length`);
  await plainSignal("tool-done"); await sleep(300);
  check((await plainBanner()) === null, "(e) tool-done → 권한 배너가 저절로 풀린다");
  await plainSignal("waiting", "idle"); await sleep(400);
  check((await plainStatus()) === "running", `(e) waiting·idle → 점은 그대로 (tool-done 의 실행 중) (${await plainStatus()})`);
  await plainSignal("waiting", "other"); await plainSignal("waiting"); await sleep(600);
  check((await plainBanner()) === null && (await osSince(c1)) === "[]", "(e) idle·other·범주 없음 → 알림 없음");
  // (f) 창이 앞에 없음 → 권한 물음 OS 알림 한 장 + 배너 항목
  await ev(`window.__focus = false; window.dispatchEvent(new Event('blur'))`);
  const c2 = await ev(`window.__calls.length`); const p2 = await toastsWith(PERM);
  await plainSignal("waiting", "permission"); await sleep(800);
  const os2 = JSON.parse(await osSince(c2));
  check(os2.length === 1 && os2[0].body === PERM && os2[0].title.startsWith(`${await appTitle()} · `), `(f) 창이 없으면 OS 알림 한 장 (${JSON.stringify(os2)})`);
  check((await toastsWith(PERM)) === p2, "(f) 그때 토스트는 더하지 않는다");
  check((await plainBanner())?.kind === "permission", "(f) 배너 항목도 선다");
  // (g) notify_permission 끔 → 권한 물음은 조용 · 턴 끝은 그대로
  await ev(`window.__focus = true; window.dispatchEvent(new Event('focus'))`);
  await plainSignal("tool-done"); await sleep(300); // (f) 의 항목을 푼다 — 빈 데서 센다
  await ev(`(async () => (await ${setMod}).setNotifyPermission(false))()`);
  const c3 = await ev(`window.__calls.length`);
  await plainSignal("waiting", "permission"); await sleep(500);
  check((await plainBanner()) === null && (await osSince(c3)) === "[]", "(g) 끄면 권한 물음 알림 없음");
  await plainSignal("stop"); await sleep(500);
  check((await plainBanner())?.kind === "stop", "(g) 턴 끝 알림은 따로 켜져 있다");
  await ev(`(async () => (await ${setMod}).setNotifyPermission(true))()`);
  check((await ev(`(async () => (await ${setMod}).settings.notifyPermission)()`)) === true, "(g) 다시 켰다");

  // (h) 앞에 다른 명령을 단 줄 — 09-25 실기: `cd …; claude …` 는 첫 토큰이 cd 라 제목으로만 AI 였고,
  // Claude 가 제목을 작업 이름으로 바꾸자 셸로 돌아가 stop 이 버려졌다. 이제 도는 명령이 조각마다 본다.
  const setTitle = (title) => ev(`(async () => (await ${titlesMod}).reportOscTitle('${plainPane}', ${JSON.stringify(title)}))()`);
  await ev(`(async () => { const t = await ${titlesMod}; const a = await ${agentMod}; const w = await ${tabsMod}; t.reportRunningCommand('${plainPane}', null); a.agentPromptReturned(w.findPaneAnywhere('${plainPane}')); })()`); await sleep(200);
  await setTitle("✳ Git status check"); await sleep(100);
  check((await isAgent()) === false, "(h) 프롬프트로 돌아옴 + 작업 이름 제목만 → 에이전트 아님 (제목 폴백은 'Claude Code' 뿐)");
  await ev(`(async () => { const t = await ${titlesMod}; const a = await ${agentMod}; const w = await ${tabsMod}; t.reportRunningCommand('${plainPane}', 'cd C:/Users/you/projects/aynx; claude --permission-mode default'); a.agentCommandStarted(w.findPaneAnywhere('${plainPane}')); })()`);
  await setTitle("claude"); await sleep(200);
  check((await isAgent()) === true, "(h) 도는 명령 `cd …; claude --permission-mode default` → 에이전트 타일");
  await setTitle("✳ Git status check"); await sleep(200);
  check((await isAgent()) === true, "(h) Claude 가 제목을 '✳ Git status check' 로 바꿔도 에이전트 타일로 남는다");
  // 이 타일은 워크트리 탭(`aynx · feat-y`)에 더해졌다 — 탭 제목은 고정이라(docs/log/2026-09-27-project-tab-title.md)
  // 타일의 보이는 이름으로 본다.
  const hName = await ev(`(async () => { const t = await ${titlesMod}; const w = await ${tabsMod}; return t.displayName(w.findPaneAnywhere('${plainPane}')); })()`);
  check(hName.includes("Claude Code"), `(h) 타일 이름 = Claude Code (${hName.trim()})`);
  const hTab = await ev(`document.querySelector('.tab[data-tab="${plainTab}"] .title')?.textContent?.trim() ?? ''`);
  check(hTab === "aynx · feat-y", `(h) 탭 제목은 워크트리 이름 그대로 (${hTab})`);
  await plainSignal("start"); await sleep(300);
  check((await plainStatus()) === "running", `(h) 훅 start → 실행 중 (${await plainStatus()})`);
  check((await showOtherThanPlain()) === true, "(h) 다른 탭으로 간다"); await sleep(200);
  // (h) 의 start 가 (g) 의 턴 끝 항목을 풀었다 — 새 stop 이 새 항목을 세운다(시각으로 가른다).
  const before4 = await plainBanner();
  await plainSignal("stop"); await sleep(600);
  const h4 = await plainBanner();
  check(before4 === null && h4?.kind === "stop", `(h) stop → 턴 끝 배너 (${JSON.stringify(before4)} → ${JSON.stringify(h4)})`);
  check((await plainStatus()) !== "running", `(h) 점이 실행 중에 붙지 않는다 (${await plainStatus()})`);
}

// ── ⑫ 옛 판 훅 알림 (docs/log/2026-09-27-remote-hook-version.md) ──────────────
// 5판 스크립트는 신호에 판(`v`)을 싣고 Rust 가 `hookVersion`·`hookLatest` 로 내보낸다. 원격 AI 타일(③ 의 `~/api`
// codex)에서 옛 판 신호 → 알림 한 번 + [다시 설치…] = 프로젝트 메뉴와 같은 확인 창·설치(그 타일의 세션) ·
// 같은 호스트는 다시 권하지 않는다 · 로컬 타일(⑧ 의 feat-y claude)의 옛 판은 [설정 열기].
{
  const sessMod = importApp("app/sessions.svelte.ts");
  const REMOTE_NOTE = "dev-01 의 Codex 훅이 옛 판입니다 (v4 이하 → v5)";
  const LOCAL_NOTE = "이 PC 의 Claude Code 훅이 옛 판입니다 (v4 → v5)";
  const noteCount = (text) => ev(`[...document.querySelectorAll('.toast .text')].filter(e => e.textContent.trim().startsWith(${JSON.stringify(text)})).length`);
  const direct = (s, extra) => ev(`(async () => (await ${agentMod}).agentSignal({ stream: '${s}', event: 'tool', detail: null, at: Date.now(), ${extra} }))()`);
  const remoteSid = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); for (const tab of w.residentWindowTabs()) for (const p of walk(tab.root, [])) if ((p.historyStreamId ?? p.id) === '${remoteStream}') return s.sessionOf(p.id); return null; })()`);
  check(typeof remoteSid === "number", `원격 AI 타일에 세션이 붙어 있다 (시험 준비 · ${remoteSid})`);
  // (a) 새 판 · 기준 없음(옛 Rust·손 신호) → 알림 없음, 신호는 받는다
  check((await direct(remoteStream, "hookVersion: 5, hookLatest: 5")) === true && (await noteCount("dev-01 의 Codex 훅")) === 0, "(a) 새 판 신호 → 받되 알림 없음");
  check((await direct(remoteStream, "")) === true && (await noteCount("dev-01 의 Codex 훅")) === 0, "(a) 판 칸이 아예 없으면 판정하지 않는다");
  // (b) 옛 판(판 없음 + 기준 5) → 알림 한 번 · 신호도 그대로 받는다
  check((await direct(remoteStream, "hookVersion: null, hookLatest: 5")) === true, "(b) 옛 판 신호도 받는다 (점은 그대로 움직인다)");
  await sleep(300);
  check((await noteCount(REMOTE_NOTE)) === 1, `(b) 원격 옛 판 → 알림 '${REMOTE_NOTE} …'`);
  const actLabel = await ev(`[...document.querySelectorAll('.toast')].find(e => e.textContent.includes(${JSON.stringify(REMOTE_NOTE)}))?.querySelector('.act')?.textContent?.trim() ?? null`);
  check(actLabel === "다시 설치…", `(b) 단추 = 다시 설치… (${actLabel})`);
  console.log("capture:", await shot("hook-version-remote.png"));
  // (c) 같은 호스트의 옛 판 신호가 또 와도 다시 권하지 않는다
  await direct(remoteStream, "hookVersion: 4, hookLatest: 5"); await sleep(300);
  check((await noteCount(REMOTE_NOTE)) === 1 && (await noteCount("dev-01 의 Codex 훅이 옛 판입니다 (v4 →")) === 0, "(c) 같은 호스트는 한 번만");
  // (d) [다시 설치…] → 프로젝트 메뉴와 같은 길 — 상태(그 타일의 세션) → 확인 창 → 설치
  await ev(`window.__dialogAnswer = '설치'`);
  const bV = await ev(`window.__calls.length`);
  await ev(`[...document.querySelectorAll('.toast')].find(e => e.textContent.includes(${JSON.stringify(REMOTE_NOTE)})).querySelector('.act').click()`); await sleep(900);
  const vCalls = await ev(`JSON.stringify(window.__calls.slice(${bV}).filter(c => c[0].startsWith('agent_hooks_remote') || c[0] === 'plugin:dialog|message').map(c => c[0] === 'plugin:dialog|message' ? [c[0], c[1].message.split('\\n')[0]] : [c[0], c[1]]))`);
  check(vCalls === JSON.stringify([["agent_hooks_remote_status", { id: remoteSid, agent: "codex" }], ["plugin:dialog|message", "원격: dev-01"], ["agent_hooks_remote_install", { id: remoteSid, agent: "codex" }]]), `(d) 다시 설치… → 상태 → 확인 창 → agent_hooks_remote_install { 그 타일의 세션, codex } (${vCalls})`);
  const vDone = await ev(`[...document.querySelectorAll('.toast .text')].map(e => e.textContent.trim()).find(x => x.startsWith('dev-01 에 Codex 훅을')) ?? null`);
  check(vDone !== null && vDone.includes("/hooks"), `(d) 완료 알림 + Codex 신뢰 안내 (${vDone})`);
  await ev(`window.__dialogAnswer = undefined`);
  await direct(remoteStream, "hookVersion: null, hookLatest: 5"); await sleep(300);
  check((await noteCount(REMOTE_NOTE)) === 0, "(d) 설치 뒤에도 같은 호스트는 다시 권하지 않는다");
  // (e) 로컬 AI 타일의 옛 판 → [설정 열기] (자동으로 고치지 않는다) — ⑪ 의 손으로 친 claude 타일(지금 에이전트인 로컬 타일)
  const localStream = await ev(`(async () => { const w = await ${tabsMod}; const a = await ${agentMod}; const walk = (n, out) => (n.type === 'leaf' ? out.push(n.pane) : (walk(n.a, out), walk(n.b, out)), out); for (const tab of w.residentWindowTabs()) for (const p of walk(tab.root, [])) if (p.kind === 'local' && a.agentKindOf(p) === 'claude') return p.historyStreamId ?? p.id; return null; })()`);
  check(typeof localStream === "string", `로컬 claude 타일이 있다 (시험 준비 · ${localStream})`);
  check((await direct(localStream, "hookVersion: 4, hookLatest: 5")) === true, "(e) 로컬 옛 판 신호도 받는다");
  await sleep(300);
  check((await noteCount(LOCAL_NOTE)) === 1, `(e) 로컬 옛 판 → 알림 '${LOCAL_NOTE} …'`);
  const bL = await ev(`window.__calls.length`);
  const lAct = await ev(`(() => { const b = [...document.querySelectorAll('.toast')].find(e => e.textContent.includes(${JSON.stringify(LOCAL_NOTE)}))?.querySelector('.act'); const l = b?.textContent?.trim() ?? null; b?.click(); return l; })()`); await sleep(900);
  check(lAct === "설정 열기", `(e) 단추 = 설정 열기 (${lAct})`);
  check((await dockTitle()) === "설정", `(e) 설정 독이 열린다 (${await dockTitle()})`);
  check((await ev(`window.__calls.slice(${bL}).some(c => c[0] === 'agent_hooks_install' || c[0].startsWith('agent_hooks_remote'))`)) === false, "(e) 로컬은 알아서 설치하지 않는다");
  await direct(localStream, "hookVersion: null, hookLatest: 5"); await sleep(300);
  check((await noteCount(LOCAL_NOTE.replace("(v4 →", "(v4 이하 →"))) === 0, "(e) 로컬도 한 번만");
  console.log("capture:", await shot("hook-version-local.png"));
}

// ── 워크트리 제거 때 그 워크트리의 탭도 닫기 · 독이 보일 때·창이 돌아올 때 다시 읽기 ─────────────
// (docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md)
{
  const tabsM = importApp("app/tabs.svelte.ts");
  const factM = importApp("session/factory.ts");
  const sessM = importApp("app/sessions.svelte.ts");
  const FX = "C:/src/proj-wt/feat-x";
  /** 그 cwd 의 로컬 타일 하나를 새 탭으로 — (탭 id, 타일 id) */
  const openAt = (cwd) => ev(`(async () => { const w = await ${tabsM}; const f = await ${factM}; const p = f.newLocalPane('pwsh'); p.cwd = ${JSON.stringify(cwd)}; w.openInNewTab(p, 'wt-test'); return JSON.stringify({ tab: w.residentWindowTabs().find(t => JSON.stringify(t.root).includes(p.id)).id, pane: p.id }); })()`).then(JSON.parse);
  const tabAlive = (id) => ev(`(async () => (await ${tabsM}).residentWindowTabs().some(t => t.id === '${id}'))()`);
  const tabsBox = () => ev(`(() => { const d = document.querySelector('[data-worktree-remove]'); if (!d) return null; const c = d.querySelector('[data-worktree-remove-tabs]'); return { tabs: c ? { checked: c.checked, label: c.parentElement.textContent.trim() } : null, hint: d.querySelector('[data-worktree-remove-tabs-hint]')?.textContent.trim() ?? null, mixed: d.querySelector('[data-worktree-remove-mixed]')?.textContent.trim() ?? null }; })()`);
  const openRemove = async () => { await showProjects(); await openWtMenu(FX); await ev(`document.querySelector('[data-worktree-action="remove"]').click()`); await sleep(400); };
  // 앞 시나리오가 남긴 feat-x 탭들(워크트리 탭 · 에이전트 타일)도 셈에 든다 — 먼저 지금 수를 읽는다.
  await openRemove();
  const before = await tabsBox();
  console.log("remove dialog (tabs) before:", JSON.stringify(before));
  const n0 = Number(before?.tabs?.label.match(/탭 (\d+)개/)?.[1] ?? 0);
  await key("Escape", 0, "Escape"); await sleep(300);
  // 준비: feat-x 안 타일만 든 탭 하나(하위 폴더) + feat-x 와 주 폴더 타일이 섞인 탭 하나 + 비슷한 이름(feat-x2) 탭 하나
  const only = await openAt(`${FX}/src`);
  const mixed = await openAt(FX);
  await ev(`(async () => { const w = await ${tabsM}; const f = await ${factM}; const p = f.newLocalPane('pwsh'); p.cwd = 'C:/src/proj'; w.openPaneBeside('${mixed.tab}', '${mixed.pane}', p); })()`);
  const near = await openAt("C:/src/proj-wt/feat-x2");
  await sleep(1500);
  await openRemove();
  const box = await tabsBox();
  console.log("remove dialog (tabs):", JSON.stringify(box));
  check(box?.tabs?.checked === true && box.tabs.label === `이 워크트리에 열린 탭 ${n0 + 1}개도 닫기`, `상자 = '이 워크트리에 열린 탭 ${n0 + 1}개도 닫기' 칸이 **켜진 채** (feat-x2 · 섞인 탭은 셈에 들지 않는다) (${JSON.stringify(box)})`);
  check(box?.hint === "그 탭의 세션(셸 · 에이전트 · SSH 접속)이 끝납니다.", `세션이 끝난다는 한 줄 (${box?.hint})`);
  check(box?.mixed === "다른 폴더 타일이 섞인 탭 1개는 남깁니다", `섞인 탭 한 줄 (${box?.mixed})`);
  console.log("capture:", await shot("worktree-remove-tabs.png"));
  const sid = await ev(`(async () => (await ${sessM}).sessionOf('${only.pane}'))()`);
  check(typeof sid === "number", `준비: 닫을 탭의 셸에 세션이 있다 (${sid})`);
  const b = await ev(`window.__calls.length`);
  const t0 = Date.now();
  await ev(`document.querySelector('[data-worktree-remove-submit]').click()`); await sleep(1400);
  const order = await ev(`JSON.stringify(window.__calls.slice(${b}).filter(c => (c[0] === 'close_session' && c[1].id === ${sid}) || c[0] === 'git_worktree_remove').map(c => c[0]))`);
  check(order === JSON.stringify(["close_session", "git_worktree_remove"]), `순서 = 탭을 닫고(close_session) → 그다음 git_worktree_remove (${order})`);
  check((await tabAlive(only.tab)) === false, "feat-x 안 타일만 든 탭은 닫혔다");
  check((await tabAlive(mixed.tab)) === true && (await tabAlive(near.tab)) === true, "섞인 탭 · feat-x2 탭은 남는다");
  check(Date.now() - t0 >= 500, "닫은 셸이 끝날 틈을 둔 뒤 지운다");
  // 칸을 끄면 탭은 그대로 두고 지우기만 한다
  const again = await openAt(FX);
  await sleep(1200);
  await openRemove();
  await ev(`document.querySelector('[data-worktree-remove-tabs]').click()`); await sleep(150);
  const b2 = await ev(`window.__calls.length`);
  await ev(`document.querySelector('[data-worktree-remove-submit]').click()`); await sleep(900);
  check((await tabAlive(again.tab)) === true && (await ev(`window.__calls.slice(${b2}).some(c => c[0] === 'git_worktree_remove')`)) === true, "칸을 끄면 → 탭은 남고 제거만 돈다");
  // 제거가 실패하면(탭은 이미 닫았다) 알림에 그 사실을 덧붙인다
  await ev(`window.__removeAnswer = { removed: false, branch: 'feat-x', branch_deleted: false, branch_kept_reason: null, message: "fatal: 'C:/src/proj-wt/feat-x' contains modified or untracked files" }`);
  await openRemove();
  await ev(`document.querySelector('[data-worktree-remove-submit]').click()`); await sleep(1400);
  const failNote = await ev(`[...document.querySelectorAll('.toast .text')].map(e => e.textContent.trim()).find(x => x.startsWith("fatal: 'C:/src/proj-wt/feat-x'")) ?? null`);
  check(failNote !== null && failNote.endsWith("탭 1개는 이미 닫았습니다"), `실패 알림 + '탭 N개는 이미 닫았습니다' (${failNote})`);
  await ev(`window.__removeAnswer = null`);

  // ③ 독이 보이게 될 때 · 보이는 채로 창이 돌아올 때 펼친 프로젝트를 다시 읽는다 (3초에 한 번 · 시계 없음)
  await showProjects();
  if (!(await treeShape()).includes("P:L1+")) { await twisty("L1"); await sleep(500); }
  const lists = (from) => ev(`window.__calls.slice(${from}).filter(c => c[0] === 'git_worktree_list').length`);
  await key("KeyJ", 10, "J"); await sleep(400);
  check((await projectDockShown()) === false, "준비: 독을 닫는다");
  await sleep(3200);
  const bO = await ev(`window.__calls.length`);
  await key("KeyJ", 10, "J"); await sleep(700);
  check((await lists(bO)) === 1, `독이 열리는 순간 펼친 로컬 프로젝트의 목록을 한 번 다시 읽는다 (${await lists(bO)})`);
  check((await treeShape()).includes("P:L1+|W:proj*"), "펼침은 그대로");
  await key("KeyJ", 10, "J"); await sleep(300); await key("KeyJ", 10, "J"); await sleep(500);
  check((await lists(bO)) === 1, `3초 안에 다시 열면 읽지 않는다 (${await lists(bO)})`);
  await sleep(3200);
  const bF = await ev(`window.__calls.length`);
  await ev(`window.dispatchEvent(new Event('focus'))`); await sleep(600);
  check((await lists(bF)) === 1, `독이 보이는 채로 창 focus → 한 번 다시 읽는다 (${await lists(bF)})`);
  await key("KeyJ", 10, "J"); await sleep(400);
  await sleep(3200);
  const bH = await ev(`window.__calls.length`);
  await ev(`window.dispatchEvent(new Event('focus'))`); await sleep(600);
  check((await lists(bH)) === 0, `독이 닫혀 있으면 focus 에도 읽지 않는다 (${await lists(bH)})`);
}

console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
