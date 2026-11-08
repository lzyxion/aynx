// 헤드리스 검증 — **설정 › 원격 접속의 저장 전 안내 = 원격 접속 카드 머리의 칩** (2026-11-06).
//
// ① 처음엔 칩 없음 ② 토글을 누르면 칩이 머리 칩 줄(토글 왼쪽)에 서고 머리 높이는 그대로 · 옛 줄 안내 없음 ③ 되돌리면 사라짐 ④ 이름을 바꿔도 칩이 선다 ⑤ 좁은 창에서 넘치지 않음
// ⑥ 마스터 암호 경고는 상태 줄의 칩이고 **저장된 켬** 기준이다 — 저장 전 토글로는 안 서고, 저장하면 서며, 누르면 보안 화면으로 간다.
//
//   node scripts/dev/run-harness.mjs remote-unsaved-chip-harness.mjs <outdir> --size 1200x900
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9252"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1436";
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
let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (!r.result?.data) return;
  const p = path.join(outdir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log("PNG " + path.resolve(p));
};
await send("Page.enable");
await send("Runtime.enable");

await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; let nextSession = 100;
  performance.setResourceTimingBufferSize(5000);
  const answers = {
    list_hosts: { hosts: [], warnings: [] }, get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' }, list_ai_clis: [],
    load_snippets: null, save_snippets: null, save_settings: null, host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, resize_session: null, write_session: null, close_session: null, reap_window_sessions: null,
    vault_status: 'none', vault_list: [], mcp_status: { clis: [] }, mcp_activity: null, list_forwards: [], session_log_path: null,
    audit_status: { state: 'off', written: 0, failed: 0 }, operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    list_operations: { pending: [], recent: [] }, agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    remote_status: { enabled: false, listening: false, port: 8765, funnel: 'off', tailscaleCli: true, error: null },
    remote_devices: [], remote_devices_list: [], remote_log: [], remote_serve_status: { state: 'none' },
    'plugin:notification|is_permission_granted': true, 'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      if (cmd === 'load_settings') return Promise.resolve({});
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);

const overlays = `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('app/overlays.svelte.ts')); return await import(e); })()`;
await ev(`(async () => (await ${overlays}).openSettingsAt('remote'))()`);
await sleep(700);

const READ = `JSON.stringify((() => {
  const toggle = document.getElementById('remote-enabled');
  const box = (toggle?.closest('.toggle') ?? toggle)?.getBoundingClientRect();
  const row = toggle?.closest('.slist-row');
  const sup = toggle?.closest('.slist-row')?.querySelector('.head-sup');
  const stateRow = document.querySelector('[data-remote-status]');
  const chip = document.querySelector('[data-remote-unsaved]');
  const c = chip?.getBoundingClientRect();
  const r = row?.getBoundingClientRect();
  const warn = document.querySelector('[data-remote-no-master]');
  const w = warn?.getBoundingClientRect();
  const statusTop = sup?.getBoundingClientRect().top;
  const belowTop = document.querySelector('#remote-host')?.getBoundingClientRect().top;
  const nested = document.querySelectorAll('.slist-open button').length;
  return { found: !!toggle, visible: !!toggle && toggle.getClientRects().length > 0, statusTop, belowTop, nested, warn: warn ? { tag: warn.tagName, left: w.left, right: w.right, midY: w.top + w.height / 2, inRow: stateRow.contains(warn) } : null, checked: toggle?.checked ?? toggle?.getAttribute('aria-checked'), rowH: r?.height, rowRight: r?.right, chip: chip ? { text: chip.textContent.trim(), left: c.left, right: c.right, midY: c.top + c.height / 2, h: c.height, inRow: sup.contains(chip) } : null, toggleLeft: box?.left, toggleMidY: box ? box.top + box.height / 2 : null, oldLine: !!document.querySelector('.hint.unsaved') };
})())`;
const read = async () => JSON.parse(await ev(READ));
const clickToggle = async () => {
  await ev(`document.getElementById('remote-enabled').click()`);
  await sleep(250);
};

const a = await read();
console.log("before:", JSON.stringify(a));
check(a.found, "원격 접속 섹션 · 토글이 보임");
check(a.chip === null && !a.oldLine, "처음엔 칩 없음");

await clickToggle();
const b = await read();
console.log("toggled:", JSON.stringify(b));
await shot("chip.png");
check(b.chip?.inRow === true, `칩이 머리 칩 줄에 선다 (${b.chip?.text})`);
check(b.chip && b.chip.right <= b.toggleLeft, `칩이 토글 왼쪽 (칩 끝 ${b.chip?.right} · 토글 ${b.toggleLeft})`);
check(b.rowH === a.rowH, `머리 높이 그대로 (${a.rowH} → ${b.rowH})`);
check(b.chip?.h === 20, `상태 칩 높이 20 (${b.chip?.h})`);
check(!b.oldLine, "옛 줄 안내 없음");
check(a.warn === null, "꺼져 있으면 마스터 경고 칩 없음");
check(b.warn === null, "저장 전 토글로는 마스터 경고 칩이 서지 않는다(저장된 값 기준)");
check(b.statusTop === a.statusTop && b.belowTop === a.belowTop, `켜도 칩 줄 · 아래 칸이 밀리지 않음 (${a.belowTop} → ${b.belowTop})`);
check(b.nested === 0, `머리 단추 안에 단추가 없다 (${b.nested})`);

await clickToggle();
const c = await read();
check(c.chip === null, "되돌리면 칩이 사라짐");

await ev(`(() => { const i = document.getElementById('remote-host'); i.value = 'mypc.tail1234.ts.net'; i.dispatchEvent(new Event('change', { bubbles: true })); })()`);
await sleep(250);
const d = await read();
check(d.chip !== null, "이름을 바꿔도 칩이 선다");

await send("Emulation.setDeviceMetricsOverride", { width: 720, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(400);
const e = await read();
console.log("narrow:", JSON.stringify(e));
await shot("chip-narrow.png");
check(e.chip && e.chip.left >= 0 && e.chip.right <= e.toggleLeft && e.rowH === a.rowH, `좁은 창에서도 넘치거나 줄이 늘지 않음 (높이 ${e.rowH})`);

// 칩 둘이 함께 서는 좁은 창 — 켜고 저장한 뒤 다시 끄면 저장 칩 + 마스터 경고 칩이 함께 선다
await clickToggle();
const stored = await ev(`(async () => { const b = [...document.querySelectorAll('.settings-view button')].find((x) => x.textContent.trim() === '저장'); if (!b) return 'none'; b.click(); return 'ok'; })()`);
await sleep(500);
const saved = await read();
console.log("saved:", stored, JSON.stringify(saved));
check(saved.warn?.inRow === true && saved.warn.tag === "BUTTON" && saved.chip === null, `저장하면 마스터 경고 칩이 상태 줄에 서고 저장 칩은 걷힌다 (${saved.warn?.tag})`);
await clickToggle();
const f = await read();
console.log("narrow both:", JSON.stringify(f));
await shot("chip-narrow-both.png");
check(f.warn && f.chip && f.warn.left >= 0 && f.chip.right <= f.toggleLeft && f.rowH === a.rowH, `좁은 창에서 칩 둘이어도 넘치거나 머리가 늘지 않음 (왼쪽 ${f.warn?.left} · 높이 ${f.rowH})`);

await ev(`document.querySelector('[data-remote-no-master]').click()`);
await sleep(500);
const g = await read();
check(!g.visible, "경고 칩을 누르면 보안 화면으로 감(원격 접속 줄이 안 보임)");

ws.close();
console.log(failed ? `FAILED ${failed}` : "ALL PASS");
process.exit(failed ? 1 : 0);
