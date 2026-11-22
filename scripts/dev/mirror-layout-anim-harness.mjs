// 원격 창의 배치 애니메이션 — 거울 스냅숏의 구조 변화에만 `withLayoutAnim` 문이 열리는지.
//   node scripts/dev/run-harness.mjs mirror-layout-anim-harness.mjs <outdir> --size 1100x800
//
// 헤드리스 스텁 — `window.__AYNX_REMOTE__` 로 뜨고 탭은 `mirror-layout` 방송(메인 PC 출처)으로 세운다(본: file-ui-remote-harness).
// 타일은 세션 없는 파일 타일(localfs)이다 — 보는 것은 배치 상자뿐이다.
// 보는 것: ① 첫 스냅숏 = 문 닫힘 ② 비율만 = 문 닫힘 · 곧바로 새 자리 ③ 분할 = 문 열림 · 옆 상자 트랜지션 · 260ms 뒤 걷힘
// ④ 자리 바꾸기 = 문 열림 ⑤ 닫기 = 유령 하나 + 문 열림 ⑥ 폰 배치(폭 400)의 분할 = 문 닫힘.
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";

const outDir = process.argv[2] ?? ".";
fs.mkdirSync(outDir, { recursive: true });
const port = process.env.CDP_PORT ?? process.argv[3] ?? "9224";
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (d.method === "Runtime.exceptionThrown") errors.push(String(d.params.exceptionDetails?.exception?.description ?? d.params.exceptionDetails?.text).slice(0, 240));
};
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? r.result.exceptionDetails.text);
  return r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
const check = (ok, label) => { if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"} ${label}`); };

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  performance.setResourceTimingBufferSize(10000);
  window.__AYNX_REMOTE__ = true;
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0;
  const evts = new Map();
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] }, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [], list_snippets: [], list_forwards: [],
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [],
    agent_states_snapshot: [], local_home: 'C:\\\\h', local_roots: ['C:\\\\'], local_places: [], local_free_space: null,
    local_list: [], local_conflicts: [], projects_list: [], host_history_list: {},
  };
  window.__emit = (name, payload) => { for (const h of evts.get(name) ?? []) cbs.get(h)?.({ event: name, id: 0, payload }); };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'remote-h-1' }, currentWebview: { label: 'remote-h-1', windowLabel: 'remote-h-1' }, windows: [{ label: 'remote-h-1' }], webviews: [{ label: 'remote-h-1', windowLabel: 'remote-h-1' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      if (cmd === 'mirror_request') return Promise.resolve(null);
      if (cmd === 'load_settings') return Promise.resolve({ app: { status_bar: 'bottom' }, automation: { auto_approve: false } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(600);

const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const S = importApp("mirror/snapshot");
const T = importApp("app/tabs.svelte");

// 트리 글: 잎 = 타일 이름(a · b · c), 가지 = [dir, ratio, a, b].
// id 꼬리는 숫자여야 한다 — `PaneHost` 의 상자 순서가 `paneOrder`(꼬리 숫자)라, 숫자가 없으면 트리 순서를 따라 자리 바꾸기에 DOM 노드가 옮겨져 트랜지션이 끊긴다
const NUM = { a: 1, b: 2, c: 3 };
const leaf = (name) => ({ type: "leaf", pane: { id: `home-${NUM[name]}`, kind: "localfs", tileKey: `k-${name}`, path: "C:\\h" } });
const node = (t) => (typeof t === "string" ? leaf(t) : { type: "split", dir: t[0], ratio: t[1], a: node(t[2]), b: node(t[3]) });

/**
 * 메인 PC 가 보낸 것처럼 거울을 밀고 같은 식 안에서 적용 직후를 잰다 — 다음 프레임까지 기다려 DOM 이 새 배치를 받은 뒤.
 * `watch` 타일의 상자는 그 프레임과 400ms 뒤를 견준다.
 */
const push = (tree, watch) => ev(`(async () => {
  const s = await ${S};
  const host = () => document.querySelector('.host.tile-canvas');
  const box = (name) => host()?.querySelector(':scope > .pane-box[data-pane="hhome-' + ${JSON.stringify(NUM)}[name] + '"]');
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height].map(Math.round); };
  const tab = { id: 'home-tab', title: 'f', tabKey: 'tk', workspaceId: 'w1', root: ${JSON.stringify(node(tree))} };
  window.__emit('mirror-layout', s.buildSnapshot({
    source: 'home', workspace: { id: 'w1', name: 'W' }, tabs: [tab], activeTabId: 'home-tab', focusOf: () => 'home-1',
  }));
  const ghostsSync = document.querySelector('.tile-ghosts')?.childElementCount ?? -1;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  const w = ${JSON.stringify(watch ?? null)};
  const el = w ? box(w) : null;
  const anims = el ? el.getAnimations().map((a) => a.transitionProperty ?? a.animationName ?? '?') : [];
  const out = {
    anim: host()?.classList.contains('anim') ?? null,
    ghosts: ghostsSync,
    anims,
    early: rect(el),
    boxes: host() ? host().querySelectorAll(':scope > .pane-box').length : -1,
  };
  await new Promise((r) => setTimeout(r, 400));
  out.late = rect(el);
  out.animLate = host()?.classList.contains('anim') ?? null;
  return JSON.stringify(out);
})()`).then(JSON.parse);
const settle = () => sleep(500);
const moved = (r) => r.early !== null && r.late !== null && JSON.stringify(r.early) !== JSON.stringify(r.late);
const dump = (r) => JSON.stringify(r);

const before = await ev(`${T}.then(t => t.residentWindowTabs().length)`);

// ① 첫 스냅숏
let r = await push(["row", 0.5, "a", "b"], "b");
check(r.boxes === 2 && r.anim === false, `① 첫 스냅숏(타일 둘 · 앞선 탭 ${before}) — anim 없음 ${dump(r)}`);
await settle();

// ② 비율만
r = await push(["row", 0.3, "a", "b"], "b");
check(r.anim === false && r.anims.length === 0 && !moved(r), `② 비율만 — anim 없음 · 곧바로 새 자리 ${dump(r)}`);
await settle();

// ③ 분할로 타일 하나 더
r = await push(["row", 0.3, "a", ["col", 0.5, "b", "c"]], "b");
const sized = r.anims.some((p) => ["left", "top", "width", "height"].includes(p));
check(r.boxes === 3 && r.anim === true && (sized || moved(r)), `③ 분할 — anim · 옆 상자 트랜지션 ${dump(r)}`);
check(r.animLate === false, `③ 260ms 뒤 anim 이 걷힌다 (400ms 뒤 ${r.animLate})`);
await settle();

// ④ 두 타일 자리 바꾸기
r = await push(["row", 0.3, "b", ["col", 0.5, "a", "c"]], "a");
check(r.anim === true && (r.anims.length > 0 || moved(r)), `④ 자리 바꾸기 — anim ${dump(r)}`);
await settle();

// ⑤ 타일 하나 닫기
r = await push(["row", 0.3, "b", "a"], "a");
check(r.boxes === 2 && r.anim === true && r.ghosts === 1, `⑤ 닫기 — 유령 하나 + anim ${dump(r)}`);
await settle();

// ⑥ 폰 배치(폭 400 — `mobileLayout()`)
await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 844, deviceScaleFactor: 1, mobile: false });
await sleep(600);
const phone = await ev(`${importApp("app/mobile.svelte")}.then(m => m.mobileLayout())`);
r = await push(["row", 0.3, "b", ["col", 0.5, "a", "c"]], "a");
check(phone === true && r.anim !== true, `⑥ 폰 배치(mobileLayout=${phone})의 분할 — anim 없음 ${dump(r)}`);

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" | ").slice(0, 300)})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAIL`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
