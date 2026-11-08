// 헤드리스 검증 — **토스트 자리**(2026-11-04 · `Toasts.svelte` · docs/log/2026-11-04-toast-position.md).
//
// 상태바 자리 넷 × 모양 셋에서 토스트 오른쪽 끝을 잰다: 오른쪽 상태바면 그 바로 왼쪽(틈 12px) · 나머지는 창 오른쪽에서 12px.
// 채팅 독 · 세션 판을 열어도 자리가 같고, 폰 배치(원격 · 폭 400)는 설정이 오른쪽이어도 오른쪽 끝이다.
//
//   node scripts/dev/run-harness.mjs toast-position-harness.mjs <outdir> --size 1280x860
//     → <outdir>/toast-right-flat.png · toast-right-hug.png · toast-right-panel.png · toast-phone.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";

const [outdir = "out"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? "9224"}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
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
    ? `EXC ${(r.result.exceptionDetails.exception?.description ?? "").split("\n")[0]}`
    : r.result?.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (file) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) fs.writeFileSync(path.join(outdir, file), Buffer.from(r.result.data, "base64"));
};
let bad = 0;
let good = 0;
const check = (name, ok, got) => {
  if (ok) good += 1;
  else bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}`);
};
const near = (a, b, tol = 1) => Math.abs(a - b) <= tol;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  const c = JSON.parse(localStorage.getItem('__toast_case') ?? '{"pos":"bottom","style":"flat"}');
  if (c.remote) window.__AYNX_REMOTE__ = true;
  const cbs = new Map(); let n = 0;
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {},
    load_settings: { app: { status_bar: c.pos, status_bar_style: c.style } },
    list_forwards: [], reap_window_sessions: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    list_operations: { pending: [], recent: [] }, mcp_activity: null,
    vault_status: { state: 'off', hasMaster: false, entryCount: 0 },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], agent_usage_limits: [],
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});

const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map((r) => r.name).find((u) => u.includes('${file}')); return import(e ?? '/src/lib/${file}'); })()`;

/** 그 설정으로 다시 띄운다 */
const open = async (c) => {
  await ev(`localStorage.setItem('__toast_case', ${JSON.stringify(JSON.stringify(c))})`);
  await send("Page.reload");
  for (let i = 0; i < 80; i += 1) {
    await sleep(200);
    if ((await ev(`!!document.querySelector('.app') && document.readyState === 'complete'`)) === true) break;
  }
  await sleep(1200);
};

const pushToast = async () => {
  await ev(`(async () => { (await ${importApp("toast.svelte.ts")}).toast.info('복사했습니다 — 3줄'); })()`);
  await sleep(450);
};

const measure = async () =>
  JSON.parse(
    await ev(`JSON.stringify((() => {
      const t = document.querySelector('.toasts .toast')?.getBoundingClientRect();
      const s = document.querySelector('.statusbar.vertical')?.getBoundingClientRect();
      const app = document.querySelector('.app');
      return {
        winW: window.innerWidth,
        toastR: t?.right ?? null, toastT: t?.top ?? null, toastL: t?.left ?? null,
        barL: s?.left ?? null, barR: s?.right ?? null,
        attr: app.dataset.statusbar, mobile: app.classList.contains('mobile'),
      };
    })())`),
  );

for (const pos of ["top", "bottom", "left", "right"]) {
  for (const style of ["flat", "hug", "panel"]) {
    await open({ pos, style });
    await pushToast();
    const m = await measure();
    if (m.toastR === null) {
      check(`${pos}/${style} 토스트가 섰다`, false, m);
      continue;
    }
    if (pos === "right") {
      check(`${pos}/${style} 상태바 바로 왼쪽(틈 12px)`, m.barL !== null && near(m.barL - m.toastR, 12), { toastR: m.toastR, barL: m.barL });
      check(`${pos}/${style} 왼쪽으로 넘어가지 않음`, m.toastL > m.winW / 2, { toastL: m.toastL });
      await shot(`toast-right-${style}.png`);
    } else {
      check(`${pos}/${style} 창 오른쪽에서 12px`, near(m.winW - m.toastR, 12), { fromRight: m.winW - m.toastR });
    }
  }
}

// 채팅 독 · 세션 판 — 열어도 자리가 같다(토스트가 위에 뜬다)
for (const pos of ["bottom", "right"]) {
  await open({ pos, style: "flat" });
  await pushToast();
  const base = await measure();
  await ev(`(async () => { (await ${importApp("app/chat-dock.svelte.ts")}).openChatDock(); })()`);
  await sleep(500);
  const dock = await measure();
  const dockOpen = await ev(`!!document.querySelector('.chat-dock.open')`);
  check(`${pos} 채팅 독이 열렸다`, dockOpen === true, dockOpen);
  check(`${pos} 채팅 독을 열어도 자리 그대로`, near(dock.toastR, base.toastR) && near(dock.toastT, base.toastT), { base: base.toastR, dock: dock.toastR });
  const onTop = await ev(`(() => {
    const t = document.querySelector('.toasts .toast').getBoundingClientRect();
    const el = document.elementFromPoint(t.left + 10, t.top + t.height / 2);
    return !!el?.closest('.toasts');
  })()`);
  check(`${pos} 토스트가 독 위에 뜬다`, onTop === true, onTop);
  await ev(`(async () => { (await ${importApp("app/chat-dock.svelte.ts")}).toggleChatDock(); (await ${importApp("app/session-sheet.svelte.ts")}).openSessionSheet(); })()`);
  await sleep(500);
  const sheet = await measure();
  const sheetOpen = await ev(`!!document.querySelector('[data-session-sheet]')`);
  check(`${pos} 세션 판이 열렸다`, sheetOpen === true, sheetOpen);
  check(`${pos} 세션 판을 열어도 자리 그대로`, near(sheet.toastR, base.toastR), { base: base.toastR, sheet: sheet.toastR });
}

// 폰 — 설정이 오른쪽이어도 오른쪽 끝
await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 844, deviceScaleFactor: 1, mobile: false });
await open({ pos: "right", style: "flat", remote: true });
await pushToast();
const phone = await measure();
check("폰 배치다", phone.mobile === true, phone.mobile);
check("폰은 오른쪽 끝에서 12px", phone.toastR !== null && near(phone.winW - phone.toastR, 12), { fromRight: phone.winW - phone.toastR });
await shot("toast-phone.png");
await send("Emulation.clearDeviceMetricsOverride");
await ev(`localStorage.removeItem('__toast_case')`);

console.log(`${good} ok · ${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
