// Headless harness: **독의 에이전트 점** (docs/log/2026-09-27-dock-agent-dots.md).
// `projects-harness.mjs` · `hosts-tree-harness.mjs` 스텁의 줄임판.
//
//   npx vite --port 1587 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new --remote-debugging-port=9397 \
//     --user-data-dir=%TEMP%/edge-aynx-dockdots --window-size=1200,900 http://localhost:1587/
//   PAGE_PORT=1587 node scripts/dev/dock-dots-harness.mjs <outdir> 9397
//
// 심어 두는 것: 로컬 프로젝트 aynx(C:\src\proj — 워크트리 main · feat-x · 주 저장소 안의 .claude/worktrees/agent-1) ·
// 호스트 셋(dev-01 · lab-02 는 폴더 `lab`, nas 는 최상위). 타일은 앱 모듈로 연다 — 로컬 claude 타일 하나(홈에서 시작)와
// dev-01 의 SSH claude 타일 하나. 셸이 알려 준 폴더(OSC 7)는 `app/pane-cwd` 의 `noteReportedCwd` 로 심고, 에이전트 상태는
// 스텁 이벤트 버스로 훅 신호를 쏜다 — Rust 와 같은 모양은 `agent-signal-fake.mjs`.
//
// 보는 것: ① 등록 폴더 밖의 타일은 점이 없다 → `cd` 로 주 폴더 안에 들어가면 접힌 프로젝트 줄에 점(목록을 안 읽었으니
// 주 폴더 자리 · 말풍선 "proj — …") ② 펼치면 프로젝트 줄 점은 사라지고 워크트리 줄(main)로 · `cd` 로 feat-x 로 옮기면
// feat-x 줄 · 주 저장소 안의 워크트리로 옮기면 가장 깊은 agent-1 줄만 ③ 접으면 접힌 점 + 말풍선 "<워크트리> — <에이전트>
// <상태>" · 훅 waiting 이면 입력 대기 ④ 독이 닫히면 상태 표시줄 독 칸에 부름 점(입력 대기일 때만 — running 이면 없다,
// 독이 열려 있으면 없다) ⑤ 호스트 독: 접힌 폴더 `lab` 에 점 · 펼치면 폴더 점은 사라지고 dev-01 줄에 · 로컬 타일은 호스트
// 줄에 서지 않는다 · 원격 대기 → 입구 점(말풍선 "호스트: …") ⑥ 점을 눌러도 줄의 뜻 그대로(선택만) ⑦ 예외 0.
// PNG: `dockdots-projects.png` · `dockdots-hosts.png` · `dockdots-entrance.png`.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { fakeAgentSignal } from "./agent-signal-fake.mjs";
import fs from "node:fs";
import path from "node:path";
const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.argv[3] ?? process.env.CDP_PORT ?? "9397";
const pagePort = process.env.PAGE_PORT ?? "1587";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"); };
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
    localStorage.removeItem('aynx:hosts:expanded');
  } catch {}
  const host = (name, ip, group) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null, group } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const answers = {
    list_hosts: { hosts: [host('dev-01', '10.0.0.9', 'lab'), host('lab-02', '10.0.0.7', 'lab'), host('nas', '10.0.0.2', null)], warnings: [] },
    get_host_meta: META, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
     load_snippets: null, 
     save_snippets: null, 
    load_settings: { projects: { start_screen: 'off' } }, save_settings: null,
    host_history_list: {},
    projects_list: [{ id: 'L1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: 'claude', tmux: false }],
    git_worktree_list: [
      { path: 'C:/src/proj', branch: 'main', head: 'a1', bare: false, detached: false },
      { path: 'C:/src/proj-wt/feat-x', branch: 'feat-x', head: 'b2', bare: false, detached: false },
      { path: 'C:/src/proj/.claude/worktrees/agent-1', branch: 'agent-1', head: 'c3', bare: false, detached: false },
    ],
    ssh_remote_home: '/root',
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
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'open_ssh_session') return Promise.resolve({ id: nextSession++, tmux: null });
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);

const VK = { Enter: 13, Escape: 27 };
const key = async (code, modifiers = 0, k = code) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(250); };
const click = async (sel) => { const r = JSON.parse(await ev(`JSON.stringify(document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect())`)); const x = r.x + r.width / 2, y = r.y + r.height / 2; await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y }); await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", clickCount: 1 }); await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", clickCount: 1 }); await sleep(300); };
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const tabsMod = importApp("app/tabs.svelte.ts");
const sessMod = importApp("lib/session.ts");
const cwdMod = importApp("app/pane-cwd.svelte.ts");

/** 새 탭에 AI 타일 하나를 연다 — 돌려주는 값은 { id, stream } */
const openTile = async (kind, extra) => JSON.parse(await ev(`(async () => { const w = await ${tabsMod}; const s = await ${sessMod};
  const p = ${kind === "local" ? "s.newLocalPane()" : "s.newSshPane('dev-01')"}; Object.assign(p, ${JSON.stringify(extra)});
  w.openInNewTab(p); return JSON.stringify({ id: p.id, stream: p.historyStreamId ?? p.id }); })()`));
const cd = (id, folder) => ev(`(async () => { (await ${cwdMod}).noteReportedCwd('${id}', ${JSON.stringify(folder)}); })()`);
const signal = (stream, event) => ev(fakeAgentSignal(`{ stream: '${stream}', event: '${event}', detail: null, at: Date.now() }`));
const attr = (sel, name) => ev(`document.querySelector(${JSON.stringify(sel)})?.getAttribute('${name}') ?? null`);
const exists = (sel) => ev(`!!document.querySelector(${JSON.stringify(sel)})`);
const projDot = `[data-project-dock] [data-project-dot="L1"]`;
const wtDot = (p) => `[data-worktree-row="${p}"] .agentdot`;
const entrance = `.statusbar [data-status-id="open-dock"] [data-dock-attention]`;

// ── ① 폴더 밖의 타일 → cd 로 주 폴더 안 ────────────────────────────────────
const A = await openTile("local", { cwd: "C:\\Users\\me", autorun: "claude" });
await sleep(1500);
await key("KeyJ", 10, "J"); await sleep(1000);
check((await ev(`document.querySelectorAll('[data-project-dock] [data-project-id]').length`)) === 1, "프로젝트 독에 프로젝트 줄 하나");
check((await exists(projDot)) === false, "등록 폴더 밖(홈)에서 시작한 타일 — 점 없음");
await cd(A.id, "C:\\src\\proj\\src"); await sleep(300);
check((await attr(projDot, "data-agent-dot")) === "unknown", `cd 로 주 폴더 안 → 접힌 프로젝트 줄에 미상 점 (${await attr(projDot, "data-agent-dot")})`);
check((await attr(projDot, "title")) === "proj — Claude Code 상태 미상", `말풍선 = 주 폴더 자리 (${await attr(projDot, "title")})`);

// ── ② 펼침 → 워크트리 줄로 · cd 가 줄을 옮긴다 · 가장 깊은 폴더 ─────────────
await click(`[data-project-id="L1"] [data-project-twisty]`); await sleep(800);
check((await exists(projDot)) === false, "펼치면 프로젝트 줄의 점은 사라진다");
check((await attr(wtDot("C:/src/proj"), "data-agent-dot")) === "unknown", "주 워크트리(main) 줄에 점");
check((await attr(wtDot("C:/src/proj"), "title")) === "Claude Code 상태 미상", `워크트리 줄 말풍선 = 에이전트 + 상태 (${await attr(wtDot("C:/src/proj"), "title")})`);
await cd(A.id, "C:\\src\\proj-wt\\feat-x"); await sleep(300);
check((await exists(wtDot("C:/src/proj"))) === false && (await exists(wtDot("C:/src/proj-wt/feat-x"))) === true, "cd 로 feat-x → feat-x 줄로 옮긴다 (두 번 세지 않는다)");
await cd(A.id, "C:\\src\\proj\\.claude\\worktrees\\agent-1"); await sleep(300);
const deep = await ev(`[...document.querySelectorAll('[data-worktree-row] .agentdot')].map(e => e.closest('[data-worktree-row]').getAttribute('data-worktree-row')).join('|')`);
check(deep === "C:/src/proj/.claude/worktrees/agent-1", `주 저장소 안의 워크트리 → 가장 깊은 agent-1 줄만 (${deep})`);
await signal(A.stream, "waiting"); await sleep(300);
check((await attr(wtDot("C:/src/proj/.claude/worktrees/agent-1"), "data-agent-dot")) === "waiting", "훅 waiting → 워크트리 줄 입력 대기");
console.log("capture:", await shot("dockdots-projects.png"));

// ── ③ 접으면 접힌 점 + 말풍선 ───────────────────────────────────────────────
await click(`[data-project-id="L1"] [data-project-twisty]`); await sleep(400);
check((await attr(projDot, "data-agent-dot")) === "waiting", "접으면 프로젝트 줄에 입력 대기 점");
check((await attr(projDot, "title")) === "agent-1 — Claude Code 입력 대기", `접힌 말풍선 = <워크트리> — <에이전트> <상태> (${await attr(projDot, "title")})`);
// 점을 눌러도 줄의 뜻 그대로 — 줄 한 번 누르기(선택 + 잠깐 뒤 펼침, 2026-10-19), 새 탭 없음
const tabsBefore = await ev(`document.querySelectorAll('.tab').length`);
await click(projDot); await sleep(400);
check((await ev(`document.querySelectorAll('.tab').length`)) === tabsBefore, "점을 눌러도 아무것도 열리지 않는다");
check((await ev(`document.querySelector('[data-project-id="L1"]').classList.contains('selected')`)) === true, "점 클릭 = 줄 선택");
check((await ev(`document.querySelector('[data-project-id="L1"]').getAttribute('aria-expanded')`)) === "true", "점 클릭 = 줄 누르기라 펼친다");

// ── ④ 독 입구의 부름 점 — 2026-10-18 실기 뒤 상태바 독 입구 칸이 걷혀 점이 설 자리가 없다(없어야 한다) ─────────
check((await exists(entrance)) === false, "상태바에 독 입구 칸 · 부름 점이 없다 (2026-10-18)");

// ── ⑤ 호스트 독 ──────────────────────────────────────────────────────────────
const B = await openTile("ssh", { cwd: "~/api", autorun: "claude" });
await sleep(1500);
await key("KeyH", 10, "H"); await sleep(1000);
const groupDotSel = `.dock .sidebar [data-id="g:lab"] [data-group-dot]`;
check((await attr(groupDotSel, "data-agent-dot")) === "unknown", `접힌 폴더 lab 에 점 (${await attr(groupDotSel, "data-agent-dot")})`);
check((await attr(groupDotSel, "title")) === "dev-01 — Claude Code 상태 미상", `폴더 말풍선 = <호스트> — … (${await attr(groupDotSel, "title")})`);
await click(`.dock .sidebar [data-id="g:lab"] [data-host-twisty]`); await sleep(500);
check((await exists(groupDotSel)) === false, "펼치면 폴더 점은 사라진다");
const hostDotSel = `.dock .sidebar [data-id="h:dev-01"] [data-host-dot]`;
check((await attr(hostDotSel, "data-agent-dot")) === "unknown", "dev-01 줄에 점");
check((await ev(`document.querySelectorAll('.dock .sidebar [data-host-dot]').length`)) === 1, "로컬 타일(실행 중)은 호스트 줄에 서지 않는다 — 점은 dev-01 하나");
check((await ev(`!!document.querySelector('.dock .sidebar [data-id="h:dev-01"] .lead .dot')`)) === false, "색 점(.dot)과 겹치지 않는다(색 없는 호스트)");
await signal(B.stream, "waiting"); await sleep(300);
check((await attr(hostDotSel, "data-agent-dot")) === "waiting" && (await attr(hostDotSel, "title")) === "Claude Code 입력 대기", `원격 대기 → dev-01 입력 대기 (${await attr(hostDotSel, "title")})`);
console.log("capture:", await shot("dockdots-hosts.png"));
check(errors.length === 0, `예외 0 (${errors.join(" / ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
