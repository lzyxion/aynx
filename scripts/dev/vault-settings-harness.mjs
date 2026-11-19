// 헤드리스 검증 — **자격증명 볼트 ③ 설정·호스트 폼** (docs/log/2026-09-19-vault.md).
// `vault-harness.mjs`(② 인증 연결)의 짝이다: 저쪽은 접속 흐름을, 이쪽은 **화면**을 본다.
//
//   node scripts/dev/run-harness.mjs vault-settings-harness.mjs <outdir> --size 1200x900
//
// 만드는 것: <outdir>/vault-settings.png · <outdir>/vault-host-form.png · <outdir>/delegation.png
// 끝 줄 `SUMMARY pass=… fail=…` — 종료 코드는 FAIL 이 하나라도 있으면 1.
//
// 시나리오 다섯(볼트 상태마다 깨끗한 페이지 — 앱이 금고 상태를 몇 초 기억하므로 새로고침이 유일한 초기화다):
//   ① 볼트 없음 — 보안 관문([열기]) · 상태 줄 · [설정…] → 마스터 암호 모달(불일치는 부르지도 않는다 · 맞으면 `vault_create`)
//   ② 열림 + 마스터 — 관문 = 마스터 **확인**(틀리면 모달에 남는다) · 저장된 항목 하위 화면 · 줄 [삭제] · [변경…]
//   ③ 잠김 — 마스터가 있으면 부팅 때 가림막이 먼저 선다(그것만 본다) · 마스터 없는 잠긴 볼트로: 관문 = 접속 관문과 **같은**
//      잠금 해제 모달 · Escape 면 관문에 남고 · 글자를 치면 명령 없이 "맞지 않습니다" · 빈 칸이면 `vault_unlock(null)` 로 통과
//   ④ 호스트 목록의 볼트 표식 + 호스트 폼(F2)의 "저장된 자격증명" 칸 · [지우기]
//   ⑤ AI 권한 호스트 표 — 부팅 고아 알림 · 요약 칩 · 권한 칩 셋(단계 + 헤드리스 둘) · 고아 줄의 "정리 필요" 칩(말풍선에 이유)과
//      흐림 · [정리 필요] 거르기 · [제거]는 두 번 눌러야 지운다 · [호스트 설정…]이 호스트 폼을 **AI 권한** 칸으로 연다
//   ⑥ (회귀) 스텁이 `agent_args_targets` 에 빈 목록을 주면 호스트 폼이 그 명령을 몇 번 부르는가(≤ 2) · 폼이 Escape 로 닫히나
//
// 2026-10-21 — 보안은 **들어갈 때마다 관문**(`.gate` 카드)을 지나야 보이고, 목록 셋은 요약의 [관리 ›]이 여는 하위 화면이다.
// 2026-11-19 — 지금 화면에 맞춰 다시 짰다. 옛 판은 (가) `Page.reload` 뒤 고정 `sleep(4500)` 이라 찬 vite 에서 부팅 전에 Ctrl+, 를 쳐 ①이
// 흰 화면으로 찍혔고, (나) ④의 F2 에서 페이지가 멈췄다 — 옛 스텁이 `agent_args_targets` 를 곧바로 거절하자 호스트 폼(`HostForm.svelte`)의
// `$effect` 가 빈 목록을 받을 때마다 다시 불러(`argsTargets = []` 가 새 배열이라 효과가 또 돈다) 마이크로태스크 고리가 렌더러를 붙잡았고
// (Debugger.pause 의 스택: invoke ← agentArgsTargets ← $effect ← flush_queued_effects), 시한 없는 CDP 호출이 600초까지 기다렸다.
// 이 스텁은 그 명령에 답하고 모든 CDP 호출 · 기다리기에 시한이 있다. 바뀐 검사:
//   - 상태 줄의 [잠그기] · [잠금 해제…]는 걷혔다(잠금 = 가림막 하나) — "상태 줄에 단추가 없다" 로만 남긴다.
//   - 권한 칩은 다섯이 아니라 **셋**(단계 하나 + 헤드리스 접속 · 볼트 암호구 — 2026-10-07). 칩 `.gchip` · 요약 `.sum-chip` · 상태 줄
//     `.vchip` 은 20px 알약이다(2026-11-19).
//   - 고아 줄의 경고는 글자 줄이 아니라 칩 "정리 필요"이고 이유는 말풍선(`title`)에 있다.
//   - [호스트 설정…]은 세션 탭이 아니라 **AI 권한** 칸으로 연다.
//   - 잠김 관문은 마스터 없는 볼트로 본다 — 마스터가 있으면 부팅 가림막이 관문을 덮는다(옛 판은 가림막 밑에서 Escape 를 쳤다).
//   - 호스트 폼의 [지우기] 뒤에는 키 암호구 줄이 남는다(같은 호스트의 키 암호구도 볼트에 있다).
//   - 내비에서 보안은 "맨 아래" 가 아니라 **마지막 묶음의 첫 칸**이다(원격 접속이 그 아래 — 구분선 `data-nav-sep-before`).
//
// 잠금 자체(가림막이 걸 때 함께 잠긴다 · 마스터 없는 잠금 해제)는 셋째 짝인 `vault-veil-harness.mjs` 가 본다.
//
// **비밀은 절대 찍지 않는다** — 금고 명령이 받은 값은 `typeof`·길이로만 기록한다
// (`vault-harness.mjs` 의 같은 줄). 마스터 암호도 예외가 아니다.
import { reloadBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";

const [outdir = ".", portArg] = process.argv.slice(2);
const port = portArg ?? process.env.CDP_PORT ?? "9227";
fs.mkdirSync(outdir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1420";
const t0 = Date.now();

// ── 판정 ──
let pass = 0;
let fail = 0;
const fails = [];
const check = (name, ok, detail) => {
  if (ok) pass++;
  else {
    fail++;
    fails.push(name);
  }
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail === undefined ? "" : " — " + (typeof detail === "string" ? detail : JSON.stringify(detail))}`);
};
const summary = (why = "") => {
  console.log(`\nSUMMARY pass=${pass} fail=${fail}${why ? " " + why : ""} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  if (fails.length) console.log("FAILED:", fails.join(" | "));
};
// 전체 상한 — 러너 시한(600s)에 닿기 전에 스스로 FAIL 로 떨어진다
const HARD_CAP_MS = 300_000;
setTimeout(() => {
  check("전체 상한 안에 끝남", false, `${HARD_CAP_MS / 1000}s`);
  summary("(cap)");
  process.exit(1);
}, HARD_CAP_MS).unref();

// ── CDP ──
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (d.method) events.push(d);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 단계마다 시한 — 답이 없으면 그 단계만 실패로 넘긴다(러너 시한까지 멈추지 않게)
const send = (method, params = {}, ms = 10000) =>
  Promise.race([
    new Promise((r) => {
      const id = ++seq;
      pending.set(id, r);
      ws.send(JSON.stringify({ id, method, params }));
    }),
    sleep(ms).then(() => ({ error: { message: `timeout ${method}` } })),
  ]);
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.error) return "EXC " + r.error.message;
  return r.result?.exceptionDetails
    ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0]
    : r.result?.result?.value;
};
/** 조건 식이 `true` 가 될 때까지(시한 안) — 고정 sleep 대신 */
const waitFor = async (expr, ms = 8000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await ev(expr)) === true) return true;
    await sleep(120);
  }
  return false;
};
const shot = async (name) => {
  // 섹션 등장(480ms) · 하위 화면 미끄러짐(200ms)이 끝난 뒤 찍는다 — 도는 중이면 흐리거나 오른쪽이 잘려 찍혔다
  const end = Date.now() + 3000;
  while (Date.now() < end && (await ev(`document.getAnimations().filter((a) => a.playState === 'running' && isFinite(a.effect?.getComputedTiming?.().endTime ?? Infinity)).length`)) !== 0) await sleep(100);
  await sleep(150);
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (!r.result?.data) return null;
  const p = path.resolve(outdir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  return p;
};
await send("Page.enable");
await send("Runtime.enable");

// 담긴 항목 둘 — 종류가 갈리는 두 줄이라 목록의 그림·라벨·삭제가 모두 이 한 쌍으로 덮인다.
const KEY_PATH = "C:\\\\Users\\\\me\\\\.ssh\\\\id_ed25519";

// ── 스텁 — focus-ring-clip-harness 의 뼈대 + 금고 상태(시나리오마다 localStorage `__harness_vault`) ──
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  // 앱 상태는 판마다 비운다 — 하네스가 고른 금고 상태 한 칸만 남긴다
  const wanted = (() => { try { return JSON.parse(localStorage.getItem('__harness_vault') || 'null'); } catch { return null; } })();
  try { localStorage.clear(); if (wanted) localStorage.setItem('__harness_vault', JSON.stringify(wanted)); } catch {}
  const cbs = new Map(); let n = 0; window.__calls = []; window.__unstubbed = []; let nextSession = 100;
  window.__listeners = {};
  window.__vault = wanted ?? { state: 'absent', hasMaster: false };
  const MASTER = 'correct-master';

  // 금고 명령이 받은 **모양**만 적는다 — 값은 typeof · 길이로만 남는다.
  window.__vaultCalls = [];
  const shape = (v) => (v === undefined ? 'absent' : v === null ? 'null' : typeof v === 'string' ? 'string(' + v.length + ')' : typeof v);
  const noteVault = (cmd, args) => {
    window.__vaultCalls.push({ cmd, kind: args?.kind ?? null, target: args?.target ?? null, master: shape(args?.master), new: shape(args?.new), current: shape(args?.current) });
  };

  // ── AI 권한 호스트 — 아는 별칭 하나 + **고아** 하나(~/.ssh/config 에 없는 별칭 → alias_known:false) ──
  window.__delegation = [
    { alias: 'web-01', client: 'any', connect: true, read: true, propose: true, auto_execute: false, approve_all: false, vault_passphrase: true, alias_known: true },
    { alias: 'old-host', client: 'any', connect: true, read: true, propose: false, auto_execute: false, approve_all: false, vault_passphrase: false, alias_known: false },
  ];
  window.__delegationRemoved = [];

  window.__items = [
    { kind: 'host_password', target: 'web-01' },
    { kind: 'key_passphrase', target: '${KEY_PATH}' },
  ];

  const answers = {
    list_hosts: { hosts: [{ name: 'web-01', host_name: '10.0.0.9', user: 'deploy', port: 22, identity_file: '~/.ssh/id_ed25519', proxy_jump: null, meta: { tags: [], forwards: [], icon: null } }], warnings: [] },
    get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }],
    agent_hooks_targets: [], agent_args_targets: [{ id: 'claude', display: 'Claude Code' }],
    agent_launch_preview: { line: 'claude', error: null, dangerous: [] }, agent_mcp_validate: null,
    load_snippets: null, save_snippets: null, host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, resize_session: null, write_session: null, close_session: null, reap_window_sessions: null,
    list_forwards: [], session_log_path: null, list_ssh_key_files: [],
    session_logs_dir: 'C:\\\\Users\\\\me\\\\AppData\\\\Roaming\\\\aynx\\\\logs',
    agent_status: { pipe_alive: true, key_count: 0 }, agent_has_key: false,
    db_ai_list: { targets: [], serverReady: true, writePlans: true, connTest: true },
    db_conn_list: { conns: [], warnings: [] }, db_folders_load: null,
    list_console_sessions: [], list_operations: { pending: [], recent: [] }, operation_results: {},
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    agent_sessions_list: { groups: [], others: [], othersMore: false },
    term_theme_list: [], restore_done_sessions: { closed: 0, unclaimed: 0 }, git_worktree_list: [],
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [], agent_states_snapshot: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    mcp_status: { name: 'aynx-sessions-dev', running: true, url: 'http://127.0.0.1:43210/mcp' }, mcp_activity: null,
    'plugin:notification|is_permission_granted': true, 'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push(cmd);
      const V = window.__vault;
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      if (cmd === 'load_settings') return Promise.resolve({ app: { status_bar: 'bottom' } });
      if (cmd === 'save_settings') return Promise.resolve(null);
      if (cmd === 'vault_status') return Promise.resolve({ state: V.state, hasMaster: V.hasMaster, entryCount: V.state === 'unlocked' ? window.__items.length : 0 });
      if (cmd === 'vault_list') {
        if (V.state === 'locked') return Promise.reject('[vault-locked] 금고가 잠겨 있습니다');
        if (V.state === 'absent') return Promise.reject('[vault-absent] 금고가 없습니다');
        return Promise.resolve(window.__items.slice());
      }
      if (cmd === 'vault_has_password') return Promise.resolve(V.state === 'unlocked' && window.__items.some((i) => i.kind === 'host_password' && i.target === args?.alias));
      if (cmd === 'vault_has_passphrase' || cmd === 'vault_has_db_password') return Promise.resolve(false);
      if (cmd === 'vault_create') { noteVault(cmd, args); V.state = 'unlocked'; V.hasMaster = typeof args?.master === 'string'; return Promise.resolve(null); }
      if (cmd === 'vault_set_master') {
        noteVault(cmd, args);
        // 현재 암호가 필요한데 틀리면 디스크는 그대로다 (vault.rs 의 순서 셋)
        if (V.hasMaster && args?.current !== MASTER) return Promise.reject('[vault-wrong-master] 금고를 열지 못했습니다');
        V.hasMaster = typeof args?.new === 'string';
        return Promise.resolve(null);
      }
      if (cmd === 'vault_unlock') {
        noteVault(cmd, args);
        // 마스터 없는 볼트는 null 로만 열린다(빈 문자열이면 백엔드에서 "틀린 마스터")
        if (V.hasMaster ? args?.master !== MASTER : args?.master !== null) return Promise.reject('[vault-wrong-master] 금고를 열지 못했습니다');
        V.state = 'unlocked';
        return Promise.resolve(null);
      }
      if (cmd === 'vault_verify_master') {
        noteVault(cmd, args);
        if (!V.hasMaster) return Promise.resolve({ result: 'no-master' });
        return Promise.resolve({ result: args?.master === MASTER ? 'ok' : 'bad' });
      }
      if (cmd === 'vault_lock') { noteVault(cmd, args); V.state = 'locked'; return Promise.resolve(null); }
      if (cmd === 'vault_delete') {
        noteVault(cmd, args);
        window.__items = window.__items.filter((i) => !(i.kind === args?.kind && i.target === args?.target));
        return Promise.resolve(null);
      }
      if (cmd === 'vault_delete_all') { noteVault(cmd, args); window.__items = []; return Promise.resolve(null); }
      // ⑥ — 빈 에이전트 표(실패하는 길과 같다: agentArgsTargets 가 [] 로 떨어진다)
      if (cmd === 'agent_args_targets' && V.argsEmpty) return Promise.resolve([]);
      if (cmd === 'delegation_list_targets') return Promise.resolve(window.__delegation.slice());
      if (cmd === 'delegation_remove_targets') {
        const aliases = args?.aliases ?? [];
        window.__delegationRemoved.push(...aliases);
        window.__delegation = window.__delegation.filter((t) => !aliases.includes(t.alias));
        return Promise.resolve(aliases.length);
      }
      if (cmd in answers) return Promise.resolve(answers[cmd]);
      window.__unstubbed.push(cmd);
      return Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });

// ── 조작 도우미 ──
const VK = { Comma: 188, F2: 113, Escape: 27, Enter: 13 };
const key = async (code, modifiers, keyName) => {
  const vk = code.startsWith("Key") ? code.charCodeAt(3) : (VK[code] ?? 0);
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }, 5000);
  await sleep(120);
};
const J = JSON.stringify;
const text = (sel) => ev(`document.querySelector(${J(sel)})?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
/** 글자로 단추를 찾아 누른다 (라벨이 곧 계약인 자리들 — [설정…]·[변경…]) */
const clickText = (scope, label) =>
  ev(`(() => {
    const root = document.querySelector(${J(scope)});
    if (!root) return 'no scope';
    const b = [...root.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === ${J(label)});
    if (!b) return 'no button: ' + [...root.querySelectorAll('button')].map((e) => (e.textContent||'').trim()).join(' | ');
    if (b.disabled) return 'disabled';
    b.click();
    return 'clicked';
  })()`);
const fill = (sel, value) =>
  ev(`(() => {
    const el = document.querySelector(${J(sel)});
    if (!el) return 'no field';
    el.value = ${J(value)};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return 'filled';
  })()`);
/** 필드가 든 폼을 낸다 — 설정 독 · 다른 모달의 폼과 헷갈리지 않게 그 칸에서 거슬러 오른다 */
const submitOf = (fieldSel) =>
  ev(`(() => { const f = document.querySelector(${J(fieldSel)})?.closest('form'); if (!f) return 'no form'; f.requestSubmit(); return 'submitted'; })()`);
const vaultCalls = async (cmd) => J(await ev(`window.__vaultCalls.filter((c) => !${J(cmd ?? "")} || c.cmd === ${J(cmd ?? "")})`));

const VIS = `.settings-panel > section:not([hidden])`;
/** 시나리오 하나를 **깨끗한 페이지에서** — 금고 상태는 몇 초 기억되므로 새로고침이 유일한 초기화다 */
const scenario = async (vaultState) => {
  await ev(`(() => { localStorage.setItem('__harness_vault', ${J(J(vaultState))}); return 'set'; })()`);
  try {
    await reloadBoot(send, ev, { timeout: 30000 });
    return true;
  } catch (e) {
    check("부팅", false, e.message);
    return false;
  }
};

/** 설정 독을 Ctrl+, 로 열고 **보안** 칸을 고른다 (id 는 `credentials` 그대로) */
const openSecurity = async () => {
  await key("Comma", 2, ",");
  if (!(await waitFor(`!!document.querySelector('.settings-view .settings-nav')`))) return "settings not open";
  const r = await ev(`(() => { const b = document.querySelector('.settings-nav .nav-item[data-nav-tab="credentials"]'); if (!b) return 'no nav item'; b.click(); return 'clicked'; })()`);
  if (r !== "clicked") return r;
  if (!(await waitFor(`document.querySelector('.settings-nav .nav-item[data-nav-tab="credentials"]')?.getAttribute('aria-current') === 'page' && !!document.querySelector('${VIS} .gate, ${VIS} #vault-state')`)))
    return "security section not shown";
  return true;
};

/** 관문 [열기] / [잠금 해제…]를 누른다 */
const pressGate = () => ev(`(() => { const b = document.querySelector('${VIS} .gate .btn-primary'); if (!b) return 'no gate button'; if (b.disabled) return 'disabled'; b.click(); return 'clicked'; })()`);
const gatePassed = `!document.querySelector('${VIS} .gate') && !!document.querySelector('${VIS} #vault-state')`;

/** 요약의 [관리 ›] 하나를 눌러 그 하위 화면으로 (`#vault-items` · `#delegation-targets`) */
const openManage = async (id, title) => {
  const r = await ev(`(() => { const b = document.querySelector('${VIS} #${id}'); if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
  if (r !== "clicked") return r;
  return (await waitFor(`document.querySelector('${VIS} .sub-title')?.textContent.trim() === ${J(title)}`)) ? true : "sub view not shown";
};

/** 알약인가 — 높이 20px · 모서리가 높이의 반 이상(999px) */
const pillsOf = (sel) =>
  ev(`JSON.stringify([...document.querySelectorAll(${J(sel)})].map((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { h: Math.round(r.height), r: cs.borderRadius }; }))`).then((s) => {
    try {
      return JSON.parse(s);
    } catch {
      return [];
    }
  });
const allPills = (arr) => arr.length > 0 && arr.every((p) => p.h === 20 && parseFloat(p.r) >= 10);

/** 시나리오 하나를 시한 안에 — 멈추면 FAIL 로 떨어지고 다음 시나리오로 */
const run = async (name, ms, fn) => {
  console.log(`── ${name} ${"─".repeat(Math.max(0, 60 - name.length))}`);
  let timer;
  const r = await Promise.race([
    fn().then(() => "done", (e) => "error: " + (e?.message ?? e)),
    new Promise((res) => (timer = setTimeout(() => res("timeout"), ms))),
  ]);
  clearTimeout(timer);
  if (r !== "done") check(`${name} 끝남`, false, r);
};

// ═══ ① 볼트가 없다 ═════════════════════════════════════════════════════════
await run("① absent", 60000, async () => {
  if (!(await scenario({ state: "absent", hasMaster: false }))) return;
  check("보안 칸 열림", (await openSecurity()) === true);
  // 보안은 마지막 묶음(비밀 관리)의 첫 칸 — 그 앞에 구분선이 선다
  check(
    "보안은 마지막 묶음의 첫 칸",
    (await ev(`(() => { const sep = document.querySelector('.settings-nav [data-nav-sep-before="credentials"]'); const b = document.querySelector('.settings-nav [data-nav-tab="credentials"]'); return !!sep && sep.nextElementSibling === b && b.querySelector('.nav-label')?.textContent.trim() === '보안'; })()`)) === true,
  );
  check("관문 = 볼트 없음", (await ev(`document.querySelector('${VIS} .gate')?.dataset.credGate ?? null`)) === "absent");
  check("관문 단추 [열기]", (await text(`${VIS} .gate .btn-primary`)) === "열기");
  check("관문 통과([열기] 한 번)", (await pressGate()) === "clicked" && (await waitFor(gatePassed)));
  // 옛 자리(일반 안의 소제목)는 **비어 있어야 한다** — 두 곳에 그려지면 상태가 갈린다.
  check("일반에 볼트 소제목 없음", (await ev(`![...document.querySelectorAll('.settings-view .subhead')].some((e) => /볼트/.test(e.textContent))`)) === true);
  const st = await text(`${VIS} .vault-state-note`);
  check("상태 줄 = 볼트 없음", typeof st === "string" && st.startsWith("볼트 없음"), st);
  // 상태 줄은 글자 안내뿐이다(2026-10-21 — 잠금 = 가림막 하나). 볼트가 없으면 사실 칩도 없다.
  check("상태 줄에 단추 없음", (await ev(`!document.querySelector('${VIS} #vault-state button')`)) === true);
  check("볼트 없음 = 사실 칩 없음", (await ev(`document.querySelectorAll('${VIS} #vault-state .vchip').length`)) === 0);
  check("마스터 줄 단추 [설정…]", (await text(`${VIS} .vault-actions button`)) === "설정…");
  // 자동 잠금 **설정 줄**(옛 `#vault-autolock`)은 없다 — 잠그는 시점은 가림막 하나 · 그 시간은 섹션 끝 `#lock-idle`
  check("옛 자동 잠금 줄 없음 · 무입력 자동 잠금 줄 있음", (await ev(`!document.querySelector('#vault-autolock') && !!document.querySelector('${VIS} #lock-idle')`)) === true);
  const items = await ev(`document.querySelector('${VIS} #vault-items')?.closest('.srow')?.querySelector('.cred-summary')?.textContent.replace(/\\s+/g,' ').trim() ?? null`);
  check("저장된 항목 요약 = 없음", typeof items === "string" && items.startsWith("저장된 항목이 없습니다"), items);
  // 통과하면 포커스가 상태 줄 이름(`#vault-state-label`)에 서고 키보드 모드라 그 말풍선이 머리말을 덮는다 — 찍기 전에만 걷는다
  check("통과 뒤 포커스 = 상태 줄 이름", (await ev(`document.activeElement?.id ?? null`)) === "vault-state-label");
  await ev(`(() => { document.activeElement?.blur(); return 1; })()`);
  console.log("capture:", await shot("vault-settings.png"));

  // [설정…] → 마스터 암호 모달 (금고가 없으므로 현재 칸은 없어야 한다)
  check("[설정…] 누름", (await clickText(VIS, "설정…")) === "clicked");
  check("모달 제목 = 마스터 암호 설정", (await waitFor(`document.querySelector('#vault-master-title')?.textContent.trim() === '마스터 암호 설정'`)) === true);
  check("현재 칸 없음(볼트 없음)", (await ev(`!document.querySelector('#vault-master-current')`)) === true);
  check("새 칸 + 확인 칸", (await ev(`!!document.querySelector('#vault-master-new') && !!document.querySelector('#vault-master-confirm')`)) === true);

  // 불일치 — **부르지도 않는다**
  await fill("#vault-master-new", "master-one");
  await fill("#vault-master-confirm", "master-two");
  await submitOf("#vault-master-new");
  check("불일치 줄", await waitFor(`!!document.querySelector('[aria-labelledby="vault-master-title"] .wrong')`, 3000));
  check("불일치면 모달에 남음", (await ev(`!!document.querySelector('#vault-master-new')`)) === true);
  check("불일치면 금고 명령 0번", (await ev(`window.__vaultCalls.length`)) === 0);

  // 맞춰서 다시 — 금고가 없으므로 `vault_create(master)` 다
  await fill("#vault-master-confirm", "master-one");
  await submitOf("#vault-master-new");
  check("모달 닫힘", await waitFor(`!document.querySelector('#vault-master-new')`, 5000));
  const calls = await vaultCalls();
  check("vault_create(master = 문자열) 한 번", calls === J([{ cmd: "vault_create", kind: null, target: null, master: "string(10)", new: "absent", current: "absent" }]), calls);
  check("비밀이 DOM · 기록에 없음", (await ev(`!document.body.innerHTML.includes('master-one') && !document.body.innerHTML.includes('master-two') && !JSON.stringify(window.__vaultCalls).includes('master-')`)) === true);
  // 만든 뒤 상태 줄 — 열림 + 마스터(성공 톤) · 사실 칩 = 알약
  check("상태 줄이 볼트 열림으로", await waitFor(`(document.querySelector('${VIS} .vault-state-note')?.textContent ?? '').includes('볼트 열림') && document.querySelector('${VIS} #vault-state')?.dataset.tone === 'ok'`, 5000));
  const chipIds = await ev(`JSON.stringify([...document.querySelectorAll('${VIS} #vault-state .vchip')].map((c) => c.dataset.chip))`);
  check("사실 칩 = 항목 · 마스터 · 자동 잠금", /^\["items","master","idle(off)?"\]$/.test(String(chipIds)), chipIds);
  const vp = await pillsOf(`${VIS} #vault-state .vchip`);
  check("상태 줄 칩 .vchip = 알약", allPills(vp), vp);
});

// ═══ ② 열림 + 마스터 ═══════════════════════════════════════════════════════
await run("② unlocked + master", 60000, async () => {
  if (!(await scenario({ state: "unlocked", hasMaster: true }))) return;
  check("보안 칸 열림", (await openSecurity()) === true);
  check("관문 = 마스터 확인", (await ev(`document.querySelector('${VIS} .gate')?.dataset.credGate ?? null`)) === "master");
  check("요약은 관문 뒤(상태 줄 없음)", (await ev(`!document.querySelector('${VIS} #vault-state')`)) === true);
  await pressGate();
  check("확인 모달 = 현재 칸 하나", await waitFor(`document.querySelector('#vault-master-title')?.textContent.trim() === '마스터 암호 확인' && !!document.querySelector('#vault-master-current') && !document.querySelector('#vault-master-new')`));
  // 틀리면 모달에 남고 관문도 그대로
  await fill("#vault-master-current", "wrong-master");
  await submitOf("#vault-master-current");
  check("틀린 마스터 = 모달에 남음 + 줄", await waitFor(`!!document.querySelector('[aria-labelledby="vault-master-title"] .wrong') && !!document.querySelector('#vault-master-current')`, 4000));
  check("틀린 마스터 = 관문 그대로", (await ev(`!!document.querySelector('${VIS} .gate')`)) === true);
  await fill("#vault-master-current", "correct-master");
  await submitOf("#vault-master-current");
  check("맞는 마스터 = 관문 통과", await waitFor(gatePassed, 5000));
  const vc = await vaultCalls("vault_verify_master");
  check("vault_verify_master 두 번(값은 길이로만)", vc === J([
    { cmd: "vault_verify_master", kind: null, target: null, master: "string(12)", new: "absent", current: "absent" },
    { cmd: "vault_verify_master", kind: null, target: null, master: "string(14)", new: "absent", current: "absent" },
  ]), vc);
  check("확인은 상태를 바꾸지 않음(unlock · create 0번)", (await ev(`window.__vaultCalls.every((c) => c.cmd === 'vault_verify_master')`)) === true);
  check("상태 줄에 단추 없음", (await ev(`!document.querySelector('${VIS} #vault-state button')`)) === true);
  const sumChips = await ev(`JSON.stringify([...(document.querySelector('${VIS} #vault-items')?.closest('.cred-summary')?.querySelectorAll('.sum-chip') ?? [])].map((c) => c.textContent.trim()))`);
  check("항목 요약 칩 = 종류별 개수", sumChips === J(["호스트 비밀번호 1", "키 암호구 1"]), sumChips);
  const sp = await pillsOf(`${VIS} .cred-summary .sum-chip`);
  check("요약 칩 .sum-chip = 알약", allPills(sp), sp);
  check("마스터 줄 단추 [변경…] · [해제…]", (await ev(`JSON.stringify([...document.querySelectorAll('${VIS} .vault-actions button')].map((b) => b.textContent.trim()))`)) === J(["변경…", "해제…"]));

  check("[관리 ›] → 저장된 항목", (await openManage("vault-items", "저장된 항목")) === true);
  const rows = await ev(`JSON.stringify([...document.querySelectorAll('${VIS} .cred-list li')].map((li) => li.textContent.replace(/\\s+/g,' ').trim()))`);
  check("항목 줄 둘(대상 + [삭제])", rows === J(["web-01 삭제", "~/.ssh/id_ed25519 삭제"]), rows);
  check("묶음 머리 = 종류 + 개수", (await ev(`JSON.stringify([...document.querySelectorAll('${VIS} .cred-group-head')].map((h) => h.textContent.trim()))`)) === J(["호스트 비밀번호 1", "키 암호구 1"]));
  // 줄 하나 삭제 → `vault_delete {kind, target}` (확인 없이 — 옛 판 그대로) · 목록에서 빠진다
  await ev(`(() => { document.querySelector('${VIS} .cred-list li button')?.click(); return 1; })()`);
  check("줄이 하나로", await waitFor(`document.querySelectorAll('${VIS} .cred-list li').length === 1`, 4000));
  const del = await vaultCalls("vault_delete");
  check("vault_delete{host_password, web-01}", del === J([{ cmd: "vault_delete", kind: "host_password", target: "web-01", master: "absent", new: "absent", current: "absent" }]), del);

  // 하위 화면 → 요약(Escape) · 포커스는 그 화면을 연 [관리 ›] 로
  await key("Escape", 0, "Escape");
  check("Escape = 요약으로 + [관리 ›]에 포커스", await waitFor(`!!document.querySelector('${VIS} #vault-state') && document.activeElement?.id === 'vault-items'`, 4000));

  // [변경…] — 현재 + 새 + 확인
  check("[변경…] 누름", (await clickText(VIS, "변경…")) === "clicked");
  check("모달 제목 = 마스터 암호 변경", await waitFor(`document.querySelector('#vault-master-title')?.textContent.trim() === '마스터 암호 변경'`));
  check("현재 칸에 포커스", await waitFor(`document.activeElement?.id === 'vault-master-current'`, 3000));
  await fill("#vault-master-current", "correct-master");
  await fill("#vault-master-new", "master-two");
  await fill("#vault-master-confirm", "master-two");
  await submitOf("#vault-master-new");
  check("변경 뒤 모달 닫힘", await waitFor(`!document.querySelector('#vault-master-new')`, 5000));
  const sm = await vaultCalls("vault_set_master");
  check("vault_set_master(new · current = 문자열)", sm === J([{ cmd: "vault_set_master", kind: null, target: null, master: "absent", new: "string(10)", current: "string(14)" }]), sm);
});

// ═══ ③ 잠김 ════════════════════════════════════════════════════════════════
// 마스터가 있는 잠긴 볼트는 창이 뜰 때 **가림막이 먼저 선다**(`recheckVaultVeil` — 가림막을 걷는 것이 곧 볼트를 여는 것) — 그 뒤의 관문은
// 가림막에 가려 사람이 닿지 못하므로 여기서는 가림막이 섰다는 것만 보고, 관문 흐름은 **마스터 없는** 잠긴 볼트로 본다(부팅 때 가림막이
// 서지 않는다). 가림막 쪽 흐름 전부는 `vault-veil-harness.mjs`.
await run("③ locked", 60000, async () => {
  if (!(await scenario({ state: "locked", hasMaster: true }))) return;
  check("잠김 + 마스터 = 부팅 때 가림막", await waitFor(`!!document.querySelector('#veil-input')`, 5000));

  if (!(await scenario({ state: "locked", hasMaster: false }))) return;
  check("잠김 + 마스터 없음 = 가림막 없음", (await ev(`!document.querySelector('#veil-input')`)) === true);
  check("보안 칸 열림", (await openSecurity()) === true);
  // 잠긴 볼트 — 요약 대신 관문 카드(`data-cred-gate="locked"`), 단추는 접속 관문과 **같은** 잠금 해제 모달을 연다
  check("관문 = 잠김", (await ev(`document.querySelector('${VIS} .gate')?.dataset.credGate ?? null`)) === "locked");
  check("관문 단추 [잠금 해제…]", (await text(`${VIS} .gate .btn-primary`)) === "잠금 해제…");
  check("요약 숨김", (await ev(`!document.querySelector('${VIS} #vault-state')`)) === true);
  await pressGate();
  check("잠금 해제 모달(접속 관문과 같은 #vault-input) + 칸에 포커스", await waitFor(`!!document.querySelector('#vault-input') && document.activeElement?.id === 'vault-input'`));
  await key("Escape", 0, "Escape");
  check("Escape = 모달 닫힘 · 관문에 남음", (await waitFor(`!document.querySelector('#vault-input')`, 3000)) && (await ev(`!!document.querySelector('${VIS} .gate')`)) === true);
  check("취소 = vault_unlock 0번", (await ev(`window.__vaultCalls.filter((c) => c.cmd === 'vault_unlock').length`)) === 0);
  check("다시 [잠금 해제…]", (await pressGate()) === "clicked" && (await waitFor(`!!document.querySelector('#vault-input')`)));
  // 마스터 없는 볼트에 무언가 쳤으면 명령을 내보내기 전에 "맞지 않습니다" 로 접는다(칸의 꼴로 마스터 유무를 알려 주지 않는다)
  await fill("#vault-input", "anything");
  await submitOf("#vault-input");
  check("마스터 없음 + 글자 = 줄만 · 명령 0번", (await waitFor(`!!document.querySelector('.lock-card .wrong')`, 3000)) && (await ev(`window.__vaultCalls.length`)) === 0);
  await fill("#vault-input", "");
  await submitOf("#vault-input");
  check("빈 칸으로 열림 + 관문 통과", await waitFor(gatePassed, 5000));
  const un = await vaultCalls("vault_unlock");
  check("vault_unlock(master = null) 한 번", un === J([{ cmd: "vault_unlock", kind: null, target: null, master: "null", new: "absent", current: "absent" }]), un);
});

// ═══ ④ 호스트 목록 표식 · 호스트 폼의 저장된 자격증명 ════════════════════════
await run("④ host list marker + host form", 60000, async () => {
  if (!(await scenario({ state: "unlocked", hasMaster: false }))) return;
  const ROW = `[...document.querySelectorAll('.dock .item[data-id]')].find((e) => e.querySelector('.name')?.textContent.trim() === 'web-01')`;
  await key("KeyH", 10, "H"); // Ctrl+Shift+H — 호스트 독
  check("호스트 독에 web-01 줄", await waitFor(`!!(${ROW})`));
  check("web-01 줄에 볼트 표식", await waitFor(`!!(${ROW})?.querySelector('.vault')`, 4000));
  check("표식 말풍선 = 비밀번호 저장됨", (await ev(`(${ROW})?.querySelector('.vault')?.getAttribute('title') ?? null`)) === "비밀번호 저장됨");

  // 줄을 고르고 F2 — 수정 폼 (키는 고른 줄의 포커스에서 독의 `onKeydown` 으로 올라간다)
  const sel = await ev(`(() => { const b = ${ROW}; if (!b) return 'no row'; b.click(); b.focus(); return document.activeElement === b ? 'focused' : 'not focused'; })()`);
  check("줄 고름 + 포커스", sel === "focused", sel);
  await key("F2", 0, "F2");
  check("F2 = 호스트 폼(수정)", await waitFor(`!!document.querySelector('.host-modal #f-identity')`, 6000));
  check("저장된 자격증명 칸 = 비밀번호 저장됨", await waitFor(`/비밀번호 저장됨/.test(document.querySelector('.host-modal .vault-row')?.textContent ?? '')`, 4000), await text(".host-modal .vault-row"));
  // 이 줄은 접속 칸의 맨 아래라 화면 밖일 수 있다 — 패널만 굴린다(scrollIntoView 는 overflow:hidden 인 바깥 상자까지 민다)
  await ev(`(() => { const p = document.querySelector('.host-modal .host-panel'); const r = document.querySelector('.host-modal .vault-row'); if (p && r) p.scrollTop += r.getBoundingClientRect().top - p.getBoundingClientRect().top - p.clientHeight / 2; return 1; })()`);
  await sleep(250);
  console.log("capture:", await shot("vault-host-form.png"));
  const clr = await ev(`(() => { const b = document.querySelector('.host-modal .vault-row button'); if (!b) return 'no button'; b.click(); return b.getAttribute('aria-label'); })()`);
  check("[지우기] = 저장된 비밀번호 지우기", clr === "저장된 비밀번호 지우기", clr);
  // 이 호스트의 키(~/.ssh/id_ed25519)의 암호구도 볼트에 있다 — 비밀번호 줄만 빠지고 암호구 줄은 남는다
  check(
    "지운 뒤 = 비밀번호 줄만 빠지고 키 암호구 줄은 남음",
    await waitFor(`(() => { const s = document.querySelector('.host-modal .vault-row')?.textContent ?? ''; return !/비밀번호 저장됨/.test(s) && /키 암호구 저장됨/.test(s); })()`, 4000),
    await text(".host-modal .vault-row"),
  );
  const del = await vaultCalls("vault_delete");
  check("vault_delete{host_password, web-01}", del === J([{ cmd: "vault_delete", kind: "host_password", target: "web-01", master: "absent", new: "absent", current: "absent" }]), del);
  await key("Escape", 0, "Escape");
});

// ═══ ⑤ AI 권한 호스트 표 (2026-09-21 — 관제판의 위임 탭에서 옮겨 왔다) ══════
await run("⑤ AI delegation table", 60000, async () => {
  if (!(await scenario({ state: "unlocked", hasMaster: false }))) return;
  // 부팅 알림 — 고아 하나("설정에 없는 AI 권한 1개") + [설정 열기]가 그 표를 [정리 필요]로 연다(관문 뒤로 미뤘다가)
  const NOTE = `[...document.querySelectorAll('.toasts .toast')].find((t) => t.textContent.includes('설정에 없는 AI 권한 1개'))`;
  check("부팅 고아 알림", await waitFor(`!!(${NOTE})`, 8000));
  const act = await ev(`(() => { const b = [...((${NOTE})?.querySelectorAll('button') ?? [])].find((x) => x.textContent.trim() === '설정 열기'); if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
  check("알림 [설정 열기] 누름", act === "clicked", act);
  check("[설정 열기] = 보안 관문", await waitFor(`document.querySelector('${VIS} .gate')?.dataset.credGate === 'nomaster'`));
  await pressGate();
  check("통과하면 AI 권한 호스트 · [정리 필요]", await waitFor(`document.querySelector('${VIS} .sub-title')?.textContent.trim() === 'AI 권한 호스트' && document.querySelector('${VIS} .opt-chip[aria-pressed="true"]')?.dataset.value === 'cleanup'`, 5000));
  check("[정리 필요] = 고아 줄만", (await ev(`JSON.stringify([...document.querySelectorAll('${VIS} .grant-list li .target')].map((e) => e.textContent.trim()))`)) === J(["old-host"]));
  await ev(`(() => { document.querySelector('${VIS} .opt-chip[data-value="all"]')?.click(); return 1; })()`);
  check("[전체] = 두 줄", await waitFor(`document.querySelectorAll('${VIS} .grant-list li').length === 2`, 3000));

  // 요약 줄 — 개수 + 경고색 "정리 필요 1" 칩
  await key("Escape", 0, "Escape");
  check("Escape = 요약", await waitFor(`!!document.querySelector('${VIS} #delegation-targets')`, 4000));
  const hs = await ev(`document.querySelector('${VIS} #delegation-targets')?.closest('.cred-summary')?.textContent.replace(/\\s+/g,' ').trim() ?? null`);
  check("호스트 요약 = 2개 · 정리 필요 1", typeof hs === "string" && hs.startsWith("2개 정리 필요 1"), hs);
  check("정리 필요 칩 = 경고색", (await ev(`!!document.querySelector('${VIS} #delegation-targets')?.closest('.cred-summary')?.querySelector('.sum-chip.warn')`)) === true);

  check("[관리 ›] → AI 권한 호스트", (await openManage("delegation-targets", "AI 권한 호스트")) === true);
  const rowsJs = `JSON.stringify([...document.querySelectorAll('${VIS} .cred-list.grant-list li')].map((li) => ({
    alias: li.querySelector('.target')?.textContent.trim() ?? null,
    grants: [...li.querySelectorAll('.gchip')].map((c) => c.textContent.trim() + (c.classList.contains('on') ? '+' : '-')),
    warn: li.querySelector('.warn')?.textContent.trim() ?? null,
    buttons: [...li.querySelectorAll('button')].map((b) => b.textContent.trim()),
    dim: li.classList.contains('orphan'),
  })))`;
  const rows = JSON.parse((await ev(rowsJs)) ?? "[]");
  console.log("delegation rows:", J(rows));
  // 칩은 **셋** — 단계 하나(web-01 = Ask · old-host = Read) + 헤드리스 둘(접속 · 볼트 암호구). 꺼진 칩도 그린다(자리 고정)
  check("web-01 칩 = Ask · 헤드리스 접속 · 볼트 암호구(모두 켜짐)", J(rows[0]?.grants) === J(["Ask+", "헤드리스 접속+", "볼트 암호구+"]), rows[0]?.grants);
  check("old-host 칩 = Read · 헤드리스 접속 켬 · 볼트 암호구 끔", J(rows[1]?.grants) === J(["Read+", "헤드리스 접속+", "볼트 암호구-"]), rows[1]?.grants);
  check("아는 줄 = [호스트 설정…] · [제거] · 경고 없음 · 흐림 없음", rows[0] && rows[0].warn === null && !rows[0].dim && J(rows[0].buttons) === J(["호스트 설정…", "제거"]), rows[0]);
  check("고아 줄 = 칩 '정리 필요' · [제거]만 · 흐림", rows[1] && rows[1].warn === "정리 필요" && rows[1].dim && J(rows[1].buttons) === J(["제거"]), rows[1]);
  const why = await ev(`(() => { const w = document.querySelectorAll('${VIS} .grant-list li')[1]?.querySelector('.warn'); return w ? JSON.stringify({ title: w.getAttribute('title'), aria: w.getAttribute('aria-label') }) : null; })()`);
  const w = why ? JSON.parse(why) : {};
  check("고아 칩 말풍선에 이유 · 읽기 이름은 칩 + 이유", typeof w.title === "string" && w.title.length > 10 && w.aria === `정리 필요: ${w.title}`, w);
  const gp = await pillsOf(`${VIS} .grant-list .gchip`);
  check("권한 칩 .gchip = 알약(6개)", gp.length === 6 && allPills(gp), gp);
  const wp = await pillsOf(`${VIS} .grant-list .warn`);
  check("정리 필요 칩 = 알약", allPills(wp), wp);
  console.log("capture:", await shot("delegation.png"));

  // [제거]는 **두 번**이다 — 한 번은 확인(버튼 글자가 그 자리에서 바뀐다), 두 번째가 지운다.
  const clickRemove = (i) => ev(`(() => { const li = document.querySelectorAll('${VIS} .cred-list.grant-list li')[${i}]; if (!li) return 'no row'; const b = [...li.querySelectorAll('button')].pop(); b.click(); return b.textContent.trim(); })()`);
  check("[제거] 첫 누름", (await clickRemove(1)) === "제거");
  check("확인 글자 = 정말 지울까요?", await waitFor(`[...document.querySelectorAll('${VIS} .cred-list.grant-list li')][1]?.querySelector('button:last-of-type')?.textContent.trim() === '정말 지울까요?'`, 3000));
  check("아직 안 지움", (await ev(`window.__delegationRemoved.length`)) === 0);
  check("[정말 지울까요?] 둘째 누름", (await clickRemove(1)) === "정말 지울까요?");
  check("지운 별칭 = old-host", await waitFor(`JSON.stringify(window.__delegationRemoved) === '["old-host"]'`, 4000));
  check("남은 줄 = web-01 하나", await waitFor(`JSON.stringify([...document.querySelectorAll('${VIS} .grant-list li .target')].map((e) => e.textContent.trim())) === '["web-01"]'`, 4000));

  // [호스트 설정…] — 아는 별칭 줄에만 있고, 폼을 **AI 권한** 칸으로 연다.
  const hb = await ev(`(() => { const li = document.querySelectorAll('${VIS} .cred-list.grant-list li')[0]; const b = [...(li?.querySelectorAll('button') ?? [])].find((x) => /호스트 설정/.test(x.textContent)); if (!b) return 'no button'; b.click(); return 'clicked'; })()`);
  check("[호스트 설정…] 누름", hb === "clicked", hb);
  check("호스트 폼 열림", await waitFor(`!!document.querySelector('.host-modal #f-name')`, 6000));
  // 폼의 왼쪽 내비는 설정 화면과 **같은 컴포넌트**(`SectionNav`)라 선택 표시도 같은 `aria-current="page"` — 폼 안의 내비만 본다
  const tab = await ev(`document.querySelector('.host-modal .settings-nav .nav-item[aria-current="page"] .nav-label')?.textContent.trim() ?? null`);
  check("폼이 AI 권한 칸으로", tab === "AI 권한", tab);
  check("이름 칸 = web-01", (await ev(`document.querySelector('.host-modal #f-name')?.value ?? null`)) === "web-01");
  await key("Escape", 0, "Escape");
});

// ═══ ⑥ 빈 에이전트 표 — 호스트 폼이 `agent_args_targets` 를 끝없이 부르지 않는다 (2026-11-20) ══════
// 빈 목록(또는 실패 → [])을 받을 때마다 `$effect` 가 다시 돌던 고리(머리말 2026-11-19 (나))의 회귀 검사. 이번 열림에 한 번만 부른다.
await run("⑥ empty agent targets", 40000, async () => {
  if (!(await scenario({ state: "unlocked", hasMaster: false, argsEmpty: true }))) return;
  const ROW = `[...document.querySelectorAll('.dock .item[data-id]')].find((e) => e.querySelector('.name')?.textContent.trim() === 'web-01')`;
  const count = `window.__calls.filter((c) => c === 'agent_args_targets').length`;
  await key("KeyH", 10, "H");
  check("호스트 독에 web-01 줄", await waitFor(`!!(${ROW})`));
  await ev(`(() => { const b = ${ROW}; b?.click(); b?.focus(); return 1; })()`);
  const before = await ev(count);
  await key("F2", 0, "F2");
  check("F2 = 호스트 폼(수정)", await waitFor(`!!document.querySelector('.host-modal #f-identity')`, 6000));
  await sleep(1500);
  const after = await ev(count);
  const n = typeof before === "number" && typeof after === "number" ? after - before : null;
  check("열린 1.5초 동안 agent_args_targets ≤ 2번", n !== null && n <= 2, `calls=${n} (before=${before} after=${after})`);
  await key("Escape", 0, "Escape");
  check("Escape = 폼 닫힘(페이지가 반응)", await waitFor(`!document.querySelector('.host-modal')`, 4000));
});

// ── 끝 ──
const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? e.params.exceptionDetails.text ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s));
check("페이지 예외 0", exc.length === 0, exc.slice(0, 6));
const unst = await ev(`JSON.stringify([...new Set(window.__unstubbed)])`);
console.log("unstubbed (last page):", unst);
summary();
ws.close();
process.exit(fail === 0 ? 0 : 1);
