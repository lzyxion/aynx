// 헤드리스 캡처 — **탭 밖 화면의 상태 글리프**(2026-11-03 · `AgentStatusGlyph.svelte` · `ErrorGlyph.svelte` ·
// docs/log/2026-11-03-tab-status-glyphs.md). 스텁은 `dock-dots-harness.mjs` · `run-history-harness.mjs` 의 사본이다.
//
// 세우는 것: 프로젝트 `aynx`(C:\src\proj — 워크트리 셋) · 호스트 셋(`dev-01` 은 폴더 lab).
//   로컬 AI 타일 셋 — 주 폴더 = 실행 중 · feat-x = 권한 대기 · agent-1 = 완료(안 봄) · 원격 AI 타일 하나(dev-01 · 권한 대기) ·
//   셸 타일 하나(명령 실패 · 안 보는 탭) · 작업안 실행 하나(대상 셋 — 실패 · 시간 초과 · 성공) · 감사 실패 1.
//   세션 판용 — 명령 실행 중 · 벨 · 벨 + 실행 중 · 끊김(접속 거절) 타일 · 다섯 분할 탭.
// 찍는 것(2배 · 그 판만 잘라서):
//   glyph-dock-projects.png — 프로젝트 독 워크트리 줄 셋(실행 중 · 권한 대기 · 완료)
//   glyph-dock-hosts.png — 호스트 독(dev-01 권한 대기)
//   glyph-start-projects.png — 시작 화면 프로젝트 위젯
//   sheet2-<flat|glass>-<dark|light>.png — 세션 판 전체 · sheet2-split-*.png — 다섯 분할 탭(작은 칸) · sheet2-tip-*.png — 권한 대기 칸 말풍선
//   glyph-exec-fail.png — 작업안 실행 결과 줄(실패 · 시간 초과) + 감사 알약(실패)
//   (폰 위 띠 · 고르기 화면은 찍지 않는다 — 맨 아래 주석)
// 판정은 글리프가 섰는지만 본다(PASS/FAIL 줄) — 모양은 사람이 PNG 로 본다.
//
// usage: node scripts/dev/run-harness.mjs glyph-screens-harness.mjs <outdir> --size 1280x860
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
import { waitBoot } from "./boot-wait.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9397";
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) {
    consoleBad.push(d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
  }
  if (d.method === "Runtime.exceptionThrown") consoleBad.push(String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text).slice(0, 200));
};
/** 콘솔 경고 · 오류 · 잡히지 않은 예외(세션 판 앞에서 비운다) */
let consoleBad = [];
const send = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    pending.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  return r.result?.exceptionDetails
    ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0]
    : r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let passed = 0;
const check = (ok, label) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
/** 선택자 상자(여백 pad)를 2배로 잘라 찍는다 — 없으면 창 전체 */
const shot = async (name, sel, pad = 8) => {
  const rect = sel
    ? JSON.parse(
        await ev(`JSON.stringify((() => { const e = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.getBoundingClientRect().width > 0); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.left, y: b.top, w: b.width, h: b.height }; })())`),
      )
    : null;
  const params = { format: "png" };
  if (rect) params.clip = { x: Math.max(0, rect.x - pad), y: Math.max(0, rect.y - pad), width: rect.w + pad * 2, height: rect.h + pad * 2, scale: 2 };
  const r = await send("Page.captureScreenshot", params);
  const p = path.join(outDir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log(`capture: ${p}${rect ? "" : " (창 전체 — 선택자 없음)"}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, id: h, payload }));
  try {
    localStorage.removeItem('aynx:dock');
    localStorage.removeItem('aynx:projects:expanded');
    localStorage.removeItem('aynx:hosts:expanded');
  } catch {}
  window.__ops = { pending: [], recent: [] };
  window.__results = {};
  const host = (name, ip, group) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null, group } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const answers = {
    list_hosts: { hosts: [host('dev-01', '10.0.0.9', 'lab'), host('lab-02', '10.0.0.7', 'lab'), host('nas', '10.0.0.2', null)], warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [], load_snippets: null, save_snippets: null,
    load_settings: { projects: { start_screen: 'off' }, ai: { notify_turn_end: false, notify_permission: false } }, save_settings: null,
    host_history_list: {},
    projects_list: [{ id: 'L1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, agent: 'claude', setupScript: '', tmux: false }],
    git_worktree_list: [
      { path: 'C:/src/proj', branch: 'main', head: 'a1', bare: false, detached: false },
      { path: 'C:/src/proj-wt/feat-x', branch: 'feat-x', head: 'b2', bare: false, detached: false },
      { path: 'C:/src/proj/.claude/worktrees/agent-1', branch: 'agent-1', head: 'c3', bare: false, detached: false },
    ],
    ssh_remote_home: '/root',
    session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, close_session: null, close_ssh: null, resize_session: null, resize_ssh: null,
    write_session: null, write_ssh: null, send_keepalive: 12,
    session_info: { auth: 'publickey', keyLabel: null, jump: null, banner: null, connectedAt: Date.now() },
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    list_forwards: [], list_console_sessions: [], delegation_list_targets: [], mcp_activity: null,
    // 감사 실패 1 — 감사 알약이 ErrorGlyph 로 선다
    audit_status: { running: true, written: 13, failed: 1, lastOkAt: 0, dir: 'C:/Users/me/AppData/Roaming/aynx-dev/audit' },
    audit_runs: [],
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
      if (cmd === 'open_ssh_session') return window.__sshFail ? Promise.reject(new Error('stub: refused')) : Promise.resolve({ id: nextSession++, tmux: null });
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
      if (cmd === 'operation_results') return Promise.resolve(window.__results[args.operationId] ?? {});
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);

const VK = { Escape: 27 };
const key = async (code, modifiers = 0, k = code) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0;
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(250);
};
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const cwdMod = importApp("app/pane-cwd.svelte.ts");

/** 새 탭에 타일 하나 — { id, stream, tab } */
const openTile = async (kind, extra) =>
  JSON.parse(
    await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod};
  const p = ${kind === "local" ? "s.newLocalPane()" : "s.newSshPane('dev-01')"}; Object.assign(p, ${JSON.stringify(extra)});
  w.openInNewTab(p); return JSON.stringify({ id: p.id, stream: p.historyStreamId ?? p.id, tab: w.activeTabId() }); })()`),
  );
const cd = (id, folder) => ev(`(async () => { (await ${cwdMod}).noteReportedCwd('${id}', ${JSON.stringify(folder)}); })()`);
const signal = async (stream, event, detail = null) => {
  await ev(fakeAgentSignal(`{ stream: '${stream}', event: '${event}', detail: ${detail === null ? "null" : `'${detail}'`}, at: Date.now() }`));
  await sleep(200);
};

// ── 타일들 ─────────────────────────────────────────────────────────────────
const A = await openTile("local", { cwd: "C:\\src\\proj", autorun: "claude" });
await sleep(800);
await cd(A.id, "C:\\src\\proj");
const B = await openTile("local", { cwd: "C:\\src\\proj-wt\\feat-x", autorun: "claude" });
await sleep(800);
await cd(B.id, "C:\\src\\proj-wt\\feat-x");
const C = await openTile("local", { cwd: "C:\\src\\proj\\.claude\\worktrees\\agent-1", autorun: "claude" });
await sleep(800);
await cd(C.id, "C:\\src\\proj\\.claude\\worktrees\\agent-1");
const R = await openTile("ssh", { cwd: "~/api", autorun: "claude" });
await sleep(800);
const SH = await openTile("local", {});
await sleep(800);
// 세션 판 판정용 — 명령 실행 중 · 벨 · 끊김(접속 거절) · 다섯 분할(작은 칸) 탭
const CMD = await openTile("local", {});
await sleep(400);
const BELL = await openTile("local", {});
await sleep(400);
await ev(`window.__sshFail = true`);
const BELLRUN = await openTile("local", {});
await sleep(400);
const OFF = await openTile("ssh", {});
await sleep(800);
await ev(`window.__sshFail = false`);
const SPLIT = await openTile("local", { autorun: "claude" });
await sleep(400);
const splitPanes = [];
for (let i = 0; i < 3; i++) {
  splitPanes.push(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newLocalPane(); w.openPaneHere(p); return p.id; })()`));
  await sleep(300);
}
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const p = s.newAiPane('codex'); w.openPaneHere(p); return p.id; })()`);
await sleep(600);
const splitInfo = JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; return JSON.stringify(s.listPanes(w.activeTab().root).map(p => ({ id: p.id, stream: p.historyStreamId ?? p.id, autorun: p.autorun ?? null }))); })()`));
// 잎 순서는 포커스를 따른다 — 종류로 찾는다
const splitBy = {
  claude: splitInfo.find((p) => p.autorun === "claude"),
  codex: splitInfo.find((p) => p.autorun === "codex"),
};
const [splitFail, splitCmd, splitQuiet] = splitInfo.filter((p) => p.autorun === null);
// 빈 탭(시작 화면)을 본다 — 다른 타일은 모두 안 보는 탭이다
await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; w.openTab(s.newTab()); })()`);
await sleep(600);
await signal(A.stream, "start");
await signal(B.stream, "start");
await signal(B.stream, "waiting", "permission");
await signal(C.stream, "start");
await signal(C.stream, "stop");
await signal(R.stream, "start");
await signal(R.stream, "waiting", "permission");
await ev(fakeAgentSignal(`{ stream: '${A.stream}', event: 'subagent-start', detail: null, agent: 'agent_a1', at: Date.now() }`));
await sleep(200);
await ev(`(async () => { const w = await ${tabsMod}; w.noteStatus('${SH.tab}', '${SH.id}', 'fail'); w.noteStatus('${CMD.tab}', '${CMD.id}', 'running'); })()`);
// 벨 — 조용한 칸 · 실행 중 칸(벨이 이긴다) · 실패 칸(실패가 이긴다) · 다섯 분할의 조용한 칸(아래에서 울린다)
await ev(`(async () => { const w = await ${tabsMod}; w.noteStatus('${BELLRUN.tab}', '${BELLRUN.id}', 'running'); })()`);
const bellMod = importApp("app/bell.svelte.ts");
await ev(`(async () => { const b = await ${bellMod}; for (const id of ['${BELL.id}', '${BELLRUN.id}', '${SH.id}']) b.bell(id, false); })()`);
// 다섯 분할 — 에이전트 권한 대기 · 셸 실패 · 명령 실행 중 · 조용함 · 에이전트 실행 중
await signal(splitBy.claude.stream, "start");
await signal(splitBy.claude.stream, "waiting", "permission");
await signal(splitBy.codex.stream, "start");
await ev(`(async () => { const w = await ${tabsMod}; w.noteStatus('${SPLIT.tab}', '${splitFail.id}', 'fail'); w.noteStatus('${SPLIT.tab}', '${splitCmd.id}', 'running'); (await ${bellMod}).bell('${splitQuiet.id}', false); })()`);
await sleep(600);

// ── 시작 화면 프로젝트 위젯 ─────────────────────────────────────────────────
const startDots = await ev(`[...document.querySelectorAll('[data-start-widget="projects"] .agentdot')].map(e => e.className.split(' ').filter(c => /^(running|permission|finished|none)$/.test(c)).join('')).join('|')`);
check(typeof startDots === "string" && startDots.length > 0, `시작 화면 프로젝트 위젯 글리프 (${startDots})`);
await shot("glyph-start-projects.png", '[data-start-widget="projects"]');

// ── 프로젝트 독 ─────────────────────────────────────────────────────────────
await key("KeyJ", 10, "J");
await sleep(1000);
await ev(`document.querySelector('[data-project-id="L1"] [data-project-twisty]')?.click()`);
await sleep(900);
const wt = JSON.parse(
  await ev(`JSON.stringify([...document.querySelectorAll('[data-worktree-row]')].map(r => [r.getAttribute('data-worktree-row'), r.querySelector('.agentdot')?.getAttribute('data-agent-dot') ?? null, !!r.querySelector('.agentdot svg')]))`),
);
check(
  JSON.stringify(wt.map((x) => x[1]).sort()) === JSON.stringify(["finished", "permission", "running"]) && wt.every((x) => x[2]),
  `워크트리 줄 셋 = 실행 중 · 권한 대기 · 완료 글리프 (${JSON.stringify(wt)})`,
);
await shot("glyph-dock-projects.png", "[data-project-dock]");

// ── 호스트 독 ───────────────────────────────────────────────────────────────
await key("KeyH", 10, "H");
await sleep(1000);
const gdot = await ev(`document.querySelector('.dock .sidebar [data-id="g:lab"] [data-group-dot]')?.getAttribute('data-agent-dot') ?? null`);
check(gdot === "permission", `접힌 폴더 lab = 권한 대기 (${gdot})`);
await ev(`document.querySelector('.dock .sidebar [data-id="g:lab"] [data-host-twisty]')?.click()`);
await sleep(600);
const hdot = await ev(`document.querySelector('.dock .sidebar [data-id="h:dev-01"] [data-host-dot]')?.getAttribute('data-agent-dot') ?? null`);
check(hdot === "permission", `dev-01 줄 = 권한 대기 (${hdot})`);
await shot("glyph-dock-hosts.png", ".dock .sidebar");
await key("KeyH", 10, "H"); // 같은 키 = 독 닫기
await sleep(600);

// ── 세션 판 탭 지도 ─────────────────────────────────────────────────────────
await ev(`(async () => (await ${importApp("app/session-sheet.svelte.ts")}).openSessionSheet())()`);
await sleep(900);
consoleBad = [];
const glyphAt = (tab, pane) => ev(`document.querySelector('[data-sheet-tab="${tab}"] [data-sheet-cell="${pane}"] [data-sheet-glyph]')?.getAttribute('data-sheet-glyph') ?? null`);
const faceAt = (tab, pane) => ev(`[...document.querySelector('[data-sheet-tab="${tab}"] [data-sheet-cell="${pane}"]').classList].filter(c => /^(s-(permission|finished|fail|running|idle|off)|bare)$/.test(c)).join(' ')`);
for (const [name, tile, want] of [
  ["에이전트 실행 중", A, "running"],
  ["권한 대기", B, "permission"],
  ["완료", C, "finished"],
  ["실패", SH, "fail"],
  ["명령 실행 중", CMD, "command"],
]) {
  check((await glyphAt(tile.tab, tile.id)) === want, `칸 글리프 ${name} = ${want}`);
}
check((await glyphAt(BELL.tab, BELL.id)) === "bell", "조용한 칸의 안 본 벨 = 종");
check((await glyphAt(BELLRUN.tab, BELLRUN.id)) === "bell", "실행 중 칸의 안 본 벨 = 종(벨이 실행 중을 이긴다)");
check((await faceAt(BELL.tab, BELL.id)) === "s-idle", `벨은 면을 칠하지 않는다 (${await faceAt(BELL.tab, BELL.id)})`);
check((await faceAt(A.tab, A.id)) === "s-running", `실행 중 칸 class (${await faceAt(A.tab, A.id)})`);
const offFace = await faceAt(OFF.tab, OFF.id);
console.log(`끊김 칸: ${offFace} · 글리프 ${await glyphAt(OFF.tab, OFF.id)}`);
check(offFace === "s-off" && (await glyphAt(OFF.tab, OFF.id)) === null, `끊김 칸 = 점선 · 글리프 없음 (${offFace})`);
const splitGlyphs = [];
for (const p of [splitBy.claude, splitFail, splitCmd, splitQuiet, splitBy.codex]) splitGlyphs.push(await glyphAt(SPLIT.tab, p.id));
check(JSON.stringify(splitGlyphs) === JSON.stringify(["permission", "fail", "command", "bell", "running"]), `다섯 분할 칸 (${splitGlyphs.join("|")})`);
// 이름 줄 = 탭 줄과 같은 표식(클래스 · 말풍선 · 서브 에이전트 수)
const lineOf = (root, tab) => `(() => { const r = document.querySelector('${root}'); const g = r?.querySelector('.tab-glyph'); const n = r?.querySelector('[data-subagents]'); return { cls: g ? [...g.classList].filter(c => !c.startsWith('svelte-')).join(' ') : null, title: g?.getAttribute('title') ?? null, sub: n?.dataset.subagents ?? null }; })()`;
for (const [name, tile] of [["실행 중", A], ["권한 대기", B], ["완료", C], ["실패", SH], ["명령 실행", CMD], ["벨", BELL], ["끊김", OFF], ["다섯 분할", SPLIT]]) {
  const [bar, line] = JSON.parse(await ev(`JSON.stringify([${lineOf(`.tab[data-tab="${tile.tab}"]`)}, ${lineOf(`[data-sheet-tab="${tile.tab}"] .tl`)}])`));
  check(JSON.stringify(bar) === JSON.stringify(line), `이름 줄 = 탭 줄 — ${name} (${JSON.stringify(line)})`);
}
check((await ev(`document.querySelectorAll('[data-sheet-tab] .tl .dot:not(.tab-glyph)').length`)) === 0, "이름 줄에 옛 고리 없음");
check((await ev(`document.querySelector('[data-sheet-tab="${A.tab}"] .tl [data-subagents]')?.dataset.subagents`)) === "1", "서브 에이전트 수");
// 이 줄은 단추가 아니다 — 포인터 모양 · 눌러도 판이 그대로
const lineGlyph = `document.querySelector('[data-sheet-tab="${B.tab}"] .tl [data-agent-dot]')`;
check((await ev(`getComputedStyle(${lineGlyph}).cursor`)) === "default", "이름 줄 글리프 cursor = default");
const activeBefore = await ev(`(async () => (await ${tabsMod}).activeTabId())()`);
await ev(`${lineGlyph}.dispatchEvent(new MouseEvent('click', { bubbles: true }))`);
await sleep(200);
check(
  (await ev(`(async () => (await ${tabsMod}).activeTabId())()`)) === activeBefore && (await ev(`!!document.querySelector('[data-session-sheet]')`)) === true,
  "이름 줄 글리프를 눌러도 탭이 안 바뀌고 판이 그대로",
);
// 머리 칩
const chips = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-sheet-summary] .schip')].map(c => [c.dataset.sum, c.textContent.trim(), !!c.querySelector('svg')]))`));
console.log("칩:", JSON.stringify(chips));
check(chips.map((c) => c[0]).join("|") === "permission|finished|fail|running|idle|off", "칩 순서 = 권한 대기 · 완료 · 실패 · 실행 중 · 조용함 · 끊김");
check(chips.slice(0, 4).every((c) => c[2]) && chips.slice(4).every((c) => !c[2]), "앞 넷만 글리프");
// 독 요약 줄의 뜻은 그대로 — 기다리는 수 = 권한 대기 + 완료 + 실패
const nOf = (i) => Number(chips[i][1].replace(/[^0-9]/g, ""));
const counts = JSON.parse(await ev(`(async () => { const m = await ${importApp("console/window-cards.ts")}; const s = await ${importApp("console/session-sheet.ts")}; const b = s.sheetBuckets(m.windowSessionCards((k) => k).board, Date.now()); return JSON.stringify(s.sheetCounts(b)); })()`));
check(counts.waiting === nOf(0) + nOf(1) + nOf(2), `sheetCounts 기다리는 수 = 세 칩의 합 (${JSON.stringify(counts)})`);

// 오케스트레이션 탭 — 플레이어 칸의 면 · 이름 줄 로고(목업 Wv3EDizxihWcEarKNfoXPP A안). 앨범 목록은 서버 대신 넣는다
const ALBUMS = [
  ["playing", { state: "running", running: { write: 1, judge: 0 } }, "s-album-playing", "1"],
  ["reviewing", { state: "running", running: { write: 0, judge: 1 } }, "s-album-reviewing", "1"],
  ["attention", { state: "running", blocked: 1, running: { write: 0, judge: 0 } }, "s-permission", "1"],
  ["done", { state: "done", running: { write: 0, judge: 0 } }, "bare", "1"],
  ["idle", { state: "running", running: { write: 0, judge: 0 } }, "bare", "0.7"],
];
const pulseMod = importApp("app/orch-pulse.svelte.ts");
const summaries = JSON.stringify(ALBUMS.map(([p, s]) => ({ runId: `run-${p}`, adoptable: { restore: true }, ...s })));
const albumTabs = {};
for (const [p] of ALBUMS) {
  albumTabs[p] = await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod}; const t = s.newTab(); t.root = { type: 'leaf', pane: { id: 'album-${p}', kind: 'run', run: { runId: 'run-${p}' } } }; t.orch = { view: 'album', runId: 'run-${p}' }; t.title = '${p}'; return w.openTab(t).id; })()`);
}
await ev(`(async () => (await ${pulseMod}).setRunSummaries(${summaries}))()`);
await sleep(300);
for (const [p, , face, opacity] of ALBUMS) {
  const seen = JSON.parse(await ev(`(() => { const r = document.querySelector('[data-sheet-tab="${albumTabs[p]}"]'); const c = r?.querySelector('[data-sheet-cell]'); return JSON.stringify({ pulse: c?.dataset.albumPulse, cls: c ? [...c.classList] : [], op: c ? getComputedStyle(c.querySelector('.ico')).opacity : null, eq: c?.querySelector('[data-eq]')?.dataset.eq, logo: r?.querySelector('[data-sheet-tab-logo] [data-eq]')?.dataset.eq }); })()`));
  check(seen.pulse === p && seen.eq === p && seen.logo === p, `앨범 ${p} — 칸 · 이름 줄 로고가 같은 맥박 (${JSON.stringify(seen)})`);
  check(seen.cls.includes(face) && seen.op === opacity, `앨범 ${p} — 면 ${face} · 아이콘 불투명도 ${opacity} (${seen.cls.join(" ")} · ${seen.op})`);
}
const noLogo = await ev(`[...document.querySelectorAll('[data-sheet-tab]')].filter(r => !r.querySelector('[data-sheet-tab-logo]')?.firstElementChild).map(r => r.dataset.sheetTab).join(',')`);
check(noLogo === "", `모든 탭 카드 이름 줄에 로고 (빠진 탭: ${noLogo})`);
check((await ev(`(() => { const l = document.querySelector('[data-sheet-tab] .tl'); return l.firstElementChild.hasAttribute('data-sheet-tab-logo') && l.children[1].classList.contains('tn'); })()`)) === true, "이름 줄 순서 = 로고 · 이름 · 표식");
await ev(`document.querySelector('[data-sheet-tab="${albumTabs.idle}"]').scrollIntoView({ block: 'end' })`);
await sleep(200);
await shot("sheet2-albums.png", "[data-session-sheet]", 4);
await ev(`document.querySelector('[data-session-sheet] .sbody').scrollTop = 0`);
await ev(`(async () => (await ${tabsMod}).selectTab('${activeBefore}'))()`);
await sleep(300);

// 말풍선 칩(권한 대기 칸) · 재질 × 밝기 — 판 전체 + 다섯 분할 탭
const modeMod = importApp("lib/mode.svelte.ts");
const setMat = importApp("lib/settings.svelte.ts");
const bgAt = (tile) => `getComputedStyle(document.querySelector('[data-sheet-tab="${tile.tab}"] [data-sheet-cell="${tile.id}"]')).backgroundColor`;
const tokens = `(() => { const c = getComputedStyle(document.querySelector('[data-sheet-tab="${B.tab}"] [data-sheet-cell="${B.id}"]')); const p = getComputedStyle(document.querySelector('[data-sum="permission"]')); return { cell: c.backgroundColor, ink: c.color, chip: p.backgroundColor, agentRun: ${bgAt(A)}, cmdRun: ${bgAt(CMD)}, quiet: ${bgAt(BELL)} }; })()`;
for (const [material, mode] of [["flat", "dark"], ["flat", "light"], ["glass", "dark"], ["glass", "light"]]) {
  await ev(`(async () => { (await ${modeMod}).setAppMode('${mode}'); (await ${setMat}).settings.current.app.material = '${material}'; })()`);
  await sleep(700);
  const seen = await ev(`document.documentElement.dataset.theme + '/' + document.documentElement.dataset.material`);
  check(seen === `${mode}/${material}`, `화면 재질 · 밝기 ${seen}`);
  const faces = await ev(tokens);
  console.log(`  ${seen} 면:`, JSON.stringify(faces));
  check(new Set([faces.agentRun, faces.cmdRun, faces.quiet]).size === 3, `${seen} 에이전트 실행 · 명령 실행 · 조용함 면이 서로 다르다`);
  await shot(`sheet2-${material}-${mode}.png`, "[data-session-sheet]", 4);
  // 판은 캔버스 절반에서 스크롤한다 — 다섯 분할 탭을 보이는 자리로 올려 찍고 되돌린다
  await ev(`document.querySelector('[data-sheet-tab="${SPLIT.tab}"]').scrollIntoView({ block: 'nearest' })`);
  await sleep(150);
  await shot(`sheet2-split-${material}-${mode}.png`, `[data-sheet-tab="${SPLIT.tab}"]`, 4);
  await ev(`document.querySelector('[data-session-sheet] .sbody').scrollTop = 0`);
  await sleep(150);
  await ev(`document.querySelector('[data-sheet-tab="${B.tab}"] [data-sheet-cell="${B.id}"]').dispatchEvent(new PointerEvent('pointerenter'))`);
  await sleep(250);
  await shot(`sheet2-tip-${material}-${mode}.png`, "[data-session-sheet]", 4);
  await ev(`document.querySelector('[data-sheet-tab="${B.tab}"] [data-sheet-cell="${B.id}"]').dispatchEvent(new PointerEvent('pointerleave'))`);
  await sleep(100);
}
await ev(`(async () => { (await ${modeMod}).setAppMode('dark'); (await ${setMat}).settings.current.app.material = 'glass'; })()`);
await sleep(400);
// 벨 조건 = 탭 줄 — 그 탭을 보면 거둬지고, 보는 탭에 표식이 남아 있어도 칸 · 탭 줄 모두 없다
await ev(`(async () => (await ${tabsMod}).selectTab('${BELL.tab}'))()`);
await sleep(300);
const bellBar = `!!document.querySelector('.tab[data-tab="${BELL.tab}"] .tab-glyph.bell')`;
check((await glyphAt(BELL.tab, BELL.id)) === null && (await ev(bellBar)) === false, "그 탭을 보면 칸 · 탭 줄의 종이 함께 거둬진다");
await ev(`(async () => (await ${bellMod}).bell('${BELL.id}', false))()`);
await sleep(300);
check((await glyphAt(BELL.tab, BELL.id)) === null && (await ev(bellBar)) === false, "지금 보는 탭은 표식이 있어도 칸 · 탭 줄 모두 종이 없다");
await ev(`(async () => (await ${tabsMod}).selectTab('${activeBefore}'))()`);
await sleep(300);
check((await glyphAt(BELL.tab, BELL.id)) === "bell" && (await ev(bellBar)) === true, "다른 탭으로 가면 칸 · 탭 줄에 함께 선다");
const bad = consoleBad.filter((m) => !m.startsWith("stub:") && !m.includes("stub: "));
const icons = consoleBad.filter((m) => m.includes("[UiIcon]"));
check(icons.length === 0, `[UiIcon] 경고 없음 (${icons.length})`);
console.log(`세션 판 동안 콘솔 경고 · 오류 ${consoleBad.length}건 (스텁 제외 ${bad.length}):`, JSON.stringify([...new Set(bad)].slice(0, 8)));
await ev(`(async () => { const m = await ${importApp("app/session-sheet.svelte.ts")}; if (m.sessionSheetOpen()) m.toggleSessionSheet(); })()`);
await sleep(500);

// ── 작업안 실행 결과(실패 · 시간 초과) · 감사 알약 ─────────────────────────────
await ev(`(() => {
  const op = { operationId: 'op-fail', command: 'systemctl restart app', targets: ['s1', 's2', 's3'], cwd: null, validate: null, mode: 'exec', strategy: 'sequential', concurrency: 1, timeoutSeconds: 60, state: 'failed', createdAt: Date.now(), requestedAt: Date.now(), expiresAt: null, title: '서비스 재시작', reason: null, idempotencyKey: null, approvalMethod: 'manual' };
  window.__ops = { pending: [], recent: [op] };
  window.__results['op-fail'] = {
    s1: { state: 'failed', exitCode: 1, stdout: '', stderr: 'boom', startedAt: 1, endedAt: 2, errorClass: null },
    s2: { state: 'timedOut', exitCode: null, stdout: '', stderr: '', startedAt: 1, endedAt: 2, errorClass: null },
    s3: { state: 'succeeded', exitCode: 0, stdout: '', stderr: '', startedAt: 1, endedAt: 2, errorClass: null },
  };
})()`);
await ev(`(async () => (await ${importApp("app/plans.svelte.ts")}).openPlansAt('op-fail'))()`);
await sleep(3400); // 폴링 한 바퀴 + 여유
await ev(`document.querySelector('li[data-exec-row][data-operation-id="op-fail"] .rtoggle')?.getAttribute('aria-expanded') === 'false' && document.querySelector('li[data-exec-row][data-operation-id="op-fail"] .rtoggle').click()`);
await sleep(500);
const execGlyphs = await ev(`[...document.querySelectorAll('li[data-exec-row][data-operation-id="op-fail"] [data-tdot]')].map(e => e.getAttribute('data-tdot')).join('|')`);
check(execGlyphs === "failed|timedOut", `실행 결과 줄 = 실패 · 시간 초과 글리프 (${execGlyphs})`);
const auditBad = await ev(`!!document.querySelector('[data-audit-pill] [data-audit-bad] svg')`);
check(auditBad === true, "감사 알약(실패) = 실패 글리프");
await shot("glyph-exec-fail.png", "[data-plans-view]");
await ev(`(async () => (await ${importApp("app/chat-dock.svelte.ts")}).closeChatDock(false))()`);
await sleep(400);

// 폰 폭(위 띠 · 고르기 화면)은 여기서 찍지 않는다 — 모바일 배치는 원격 웹 모드(`aynx-h-remote` + 다시 읽기)에서만 서고, 그때 탭은
// 집 PC 거울에서 오므로 이 판의 로컬 타일 · 신호가 넘어가지 않는다(거울 스텁까지 세우는 것은 이 판의 몫이 아니다).

console.log(`${passed} PASS · ${failed} FAIL`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
