// 헤드리스 검증 — **폰 배치의 ⤢(이 기기 크기로 맞추기)** = 카드의 [이 창 크기로](`mobile/policy.ts` 의 `claimsOnAttach` · `dropsFitOnLoss` · `Terminal.svelte`).
//
// 원격 창 흉내(`window.__AYNX_REMOTE__` · 400x844 · 터치)에 셸 타일 하나를 `applyMirrorTabs` 로 세운다. 시청자 붙기는 스텁 —
// 붙을 때마다 새 임대 회차 · 답은 "메인 PC 가 주인"(120×40). 주인 바뀜은 `window.__emit('session-size-owner', …)`.
// ① 꺼짐: 붙기 eligible false · ⤢ aria-pressed false · 되찾기 없음 ② ⤢ → eligible true 로 다시 붙고 키 없이 claim_session_size
// ③ 다른 쪽이 주인(이벤트) → ⤢ 저절로 꺼짐 · eligible false 로 다시 붙음 · 되찾기 없음 ④ 다시 ⤢ → 다시 되찾기 ⑤ 켜진 ⤢ → 꺼짐 · eligible false ⑥ 예외 0
//
//   node scripts/dev/run-harness.mjs mobile-fit-harness.mjs <outdir> --size 400x844
//     → <outdir>/fit-on.png · fit-off.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";

const [outdir = "out", port = process.env.CDP_PORT ?? "9277"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1444";
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${PAGE_PORT}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));

let seq = 0;
const pending = new Map();
const errors = [];
let counting = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
    return;
  }
  if (!counting) return;
  if (d.method === "Runtime.exceptionThrown") {
    const x = d.params.exceptionDetails;
    const s = (x.exception?.description ?? x.text ?? "").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("EXC " + s);
  }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    const s = (d.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("console.error " + s);
  }
};
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
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) {
    const p = path.join(outdir, name);
    fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
    console.log("PNG " + path.resolve(p));
  }
};
let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  window.__AYNX_REMOTE__ = true;
  const cbs = new Map(); let n = 0; window.__calls = []; let evId = 0;
  const evts = new Map();
  // 붙을 때마다 새 회차 — 메인 PC(회차 1) 가 주인이라고 답한다
  let epoch = 10; window.__lease = null;
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    list_ai_clis: [], list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [],
    probe_session: { state: 'attached', kind: 'local', sessionEpoch: 1, checkpoint: null },
    resize_session: null, claim_session_size: true, ack_session: null, write_session: null, detach_session_viewer: null,
  };
  window.__emit = (event, payload) => { const hs = evts.get(event) ?? []; for (const h of hs) cbs.get(h)?.({ event, id: ++evId, payload }); return hs.length; };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'remote-h-1' }, currentWebview: { label: 'remote-h-1', windowLabel: 'remote-h-1' }, windows: [{ label: 'remote-h-1' }], webviews: [{ label: 'remote-h-1', windowLabel: 'remote-h-1' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'load_settings') return Promise.resolve({ app: { status_bar: 'bottom' }, automation: { auto_approve: false } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') { evts.set(args.event, (evts.get(args.event) ?? []).filter((x) => x !== args.eventId)); return Promise.resolve(); }
      if (cmd === 'attach_session_viewer') {
        const lease = { stream: args.stream, sessionEpoch: 1, leaseEpoch: ++epoch };
        window.__lease = lease;
        return Promise.resolve({ id: 7, kind: 'local', viewer: true, lease, start: 0, end: 0, replayed: false, overrunBytes: 0, shell: 'pwsh',
          sizeOwner: false, ownerCols: 120, ownerRows: 40, ownerPrimary: true });
      }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});

const T = importApp("app/tabs.svelte.ts");
const WS = importApp("app/workspaces.svelte.ts");
const M = importApp("app/mobile.svelte.ts");

await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
await send("Page.reload", { ignoreCache: true });
await sleep(300);
await ev(`(() => { try { localStorage.removeItem('aynx.remote.fitHere'); } catch {} })()`);
await send("Page.reload", { ignoreCache: true });
await waitFor(`performance.getEntriesByType('resource').some(r => r.name.includes('app/tabs.svelte.ts')) && !!document.querySelector('.mobile-bar')`, 25000);
await sleep(1200);
counting = true;

await ev(`(async () => {
  const [t, w] = await Promise.all([${T}, ${WS}]);
  const ws = w.currentWorkspaceId();
  t.applyMirrorTabs([{ id: 'tab-s', title: 'sh', tabKey: 'k-s', workspaceId: ws, root: { type: 'leaf', pane: { id: 'sh', kind: 'local', historyStreamId: 's-s', tileKey: 'tk-sh' } } }], 'tab-s', {});
})()`);

/** 지금까지의 붙기 · 되찾기 · 키 쓰기 — `from` 번째 호출부터 */
const callsFrom = async (from) =>
  JSON.parse(
    await ev(`JSON.stringify(window.__calls.slice(${from}).map(([c, a]) => c === 'attach_session_viewer' ? ['attach', a.sizeOwnerEligible] : c === 'claim_session_size' ? ['claim', a.leaseEpoch, a.cols, a.rows] : c === 'write_session' ? ['write'] : c === 'detach_session_viewer' ? ['detach', a.leaseEpoch] : null).filter(Boolean))`),
  );
const mark = () => ev(`window.__calls.length`);
const pressed = () => ev(`document.querySelector('.mobile-bar .fit')?.getAttribute('aria-pressed') ?? null`);
const lease = () => ev(`JSON.stringify(window.__lease)`).then(JSON.parse);
const tapFit = async () => {
  const p = JSON.parse(
    (await ev(`(() => { const b = document.querySelector('.mobile-bar .fit'); if (!b) return 'null'; const r = b.getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }); })()`)) ?? "null",
  );
  if (!p) return false;
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: p.x, y: p.y }] });
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  return true;
};
const settle = (from, pred) => waitFor(`(() => { const c = window.__calls.slice(${from}); return ${pred}; })()`, 6000);

// ── ① 꺼짐(기본) ─────────────────────────────────────────────────────────────
check(await waitFor(`window.__calls.some(([c]) => c === 'attach_session_viewer')`, 10000), "① 셸 타일이 시청자로 붙었다");
await sleep(800);
let c = await callsFrom(0);
check(
  JSON.stringify(c.filter((x) => x[0] === "attach")) === JSON.stringify([["attach", false]]) && (await pressed()) === "false" && !c.some((x) => x[0] === "claim"),
  `① 꺼짐: 붙기 eligible false · ⤢ aria-pressed=${await pressed()} · 되찾기 없음 ${JSON.stringify(c)}`,
);
await shot("fit-off.png");

// ── ② ⤢ 탭 → eligible true 로 다시 붙고 키 없이 되찾기 ─────────────────────────
let from = await mark();
check(await tapFit(), "② ⤢ 를 누른다");
await settle(from, `c.some(([k]) => k === 'claim_session_size')`);
await sleep(500);
c = await callsFrom(from);
let L = await lease();
const ai2 = c.findIndex((x) => x[0] === "attach");
const ci2 = c.findIndex((x) => x[0] === "claim");
check(
  c[ai2]?.[1] === true && ci2 > ai2 && c[ci2][1] === L.leaseEpoch && !c.some((x) => x[0] === "write") && (await pressed()) === "true",
  `② ⤢ → 떼고(${JSON.stringify(c.filter((x) => x[0] === "detach"))}) eligible true 로 다시 붙음 · 키 없이 되찾기(회차 ${L.leaseEpoch}) · ⤢ 켜짐 ${JSON.stringify(c)}`,
);
await shot("fit-on.png");

// ── ③ 다른 쪽이 주인 → ⤢ 저절로 꺼짐 ───────────────────────────────────────────
from = await mark();
const heard = await ev(`window.__emit('session-size-owner', { stream: ${JSON.stringify(L.stream)}, sessionEpoch: 1, leaseEpoch: 1, cols: 120, rows: 40, primary: true })`);
await settle(from, `c.some(([k]) => k === 'attach_session_viewer')`);
await sleep(800);
c = await callsFrom(from);
check(
  heard > 0 && (await pressed()) === "false" && JSON.stringify(c.filter((x) => x[0] === "attach")) === JSON.stringify([["attach", false]]) && !c.some((x) => x[0] === "claim"),
  `③ 메인 PC 가 주인(이벤트 리스너 ${heard}) → ⤢ aria-pressed=${await pressed()} · eligible false 로 다시 붙음 · 되찾기 없음 ${JSON.stringify(c)}`,
);

// ── ④ 다시 ⤢ → 다시 되찾기 ──────────────────────────────────────────────────
from = await mark();
await tapFit();
await settle(from, `c.some(([k]) => k === 'claim_session_size')`);
await sleep(500);
c = await callsFrom(from);
L = await lease();
check(
  c.some((x) => x[0] === "attach" && x[1] === true) && c.filter((x) => x[0] === "claim").length === 1 && c.find((x) => x[0] === "claim")[1] === L.leaseEpoch && (await pressed()) === "true",
  `④ 다시 ⤢ → eligible true · 되찾기 한 번(회차 ${L.leaseEpoch}) ${JSON.stringify(c)}`,
);

// ── ⑤ 켜진 ⤢ → 꺼짐 · eligible false ────────────────────────────────────────
from = await mark();
await tapFit();
await settle(from, `c.some(([k]) => k === 'attach_session_viewer')`);
await sleep(800);
c = await callsFrom(from);
check(
  (await pressed()) === "false" && JSON.stringify(c.filter((x) => x[0] === "attach")) === JSON.stringify([["attach", false]]) && !c.some((x) => x[0] === "claim"),
  `⑤ 켜진 ⤢ → aria-pressed=${await pressed()} · eligible false 로 다시 붙음 · 되찾기 없음 ${JSON.stringify(c)}`,
);
check((await ev(`(async () => (await ${M}).fitThisDevice())()`)) === false && (await ev(`localStorage.getItem('aynx.remote.fitHere')`)) === "0", "⑤ 저장 값도 꺼짐");

// ── ⑥ 예외 ─────────────────────────────────────────────────────────────────
check(errors.length === 0, `⑥ 예외 · console.error 0 (${errors.length}${errors.length ? " — " + errors.slice(0, 3).join(" | ") : ""})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
