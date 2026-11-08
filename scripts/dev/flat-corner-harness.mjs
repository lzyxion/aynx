// 헤드리스 검증 — 평면 상태줄 왼쪽 · 오른쪽의 안쪽 모서리 곡선(2026-11-03 · `+page.svelte` 의 `.canvas-corner` 절).
// 재질(평면 · 글래스) × 자리(왼쪽 · 오른쪽) × 배율(1 · 1.25 · 1.5) 마다 자리를 재고 모서리를 확대해 찍는다. 세션 판(Ctrl+Shift+M)을
// 연 판도 찍어 자르는 상자가 같은 곡률인지 본다.
//
// usage: node scripts/dev/run-harness.mjs flat-corner-harness.mjs <outdir> --size 1100x700
//   → <outdir>/corner-<material>-<pos>-<scale>.png (모서리 6배 확대) · -full.png (창 전체) · -sheet.png (세션 판 연 모서리)
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? "9224"}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl);
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
const shot = async (file, clip) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", clip ? { format: "png", clip, captureBeyondViewport: false } : { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(path.join(outdir, file), Buffer.from(r.result.data, "base64"));
      return;
    }
    await sleep(400);
  }
  console.log("capture failed", file);
};

let bad = 0;
const check = (name, ok, got) => {
  if (!ok) bad += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}`);
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0;
  const c = JSON.parse(localStorage.getItem('__corner_case') ?? '{"pos":"left","material":"flat"}');
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {},
    load_settings: { app: { status_bar: c.pos, status_bar_style: 'flat', material: c.material } },
    list_forwards: [], reap_window_sessions: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    list_operations: { pending: [], recent: [] }, mcp_activity: null,
    vault_status: { state: 'off', hasMaster: false, entryCount: 0 },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], agent_usage_limits: [],
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
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

/** 자리 재기 — 조각 · L 위 변 · 기둥 · 캔버스 · 세션 판 자르는 상자 */
const measure = () =>
  ev(`JSON.stringify((() => {
    const app = document.querySelector('.app');
    const cs = getComputedStyle(app);
    const px = (v) => parseFloat(v);
    const corner = document.querySelector('.canvas-corner'), edge = document.querySelector('.canvas-edge');
    const col = document.querySelector('.statusbar.vertical'), pane = document.querySelector('.body .pane');
    const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { l: b.left, t: b.top, r: b.right, b: b.bottom, w: b.width, h: b.height }; };
    const clip = document.querySelector('[data-session-drop]');
    return {
      material: document.documentElement.dataset.material,
      pos: app.dataset.statusbar, style: app.dataset.statusbarStyle,
      sbW: col ? col.getBoundingClientRect().width : null, tbH: px(cs.getPropertyValue('--titlebar-h')),
      cornerR: cs.getPropertyValue('--corner-r').trim(),
      corner: r(corner), cornerDisplay: corner && getComputedStyle(corner).display,
      edge: r(edge), col: r(col), pane: r(pane),
      colImage: col && getComputedStyle(col).borderImageSource.slice(0, 40),
      colSlice: col && getComputedStyle(col).borderImageSlice,
      clipRadius: clip && getComputedStyle(clip).borderRadius,
      gap: px(getComputedStyle(document.documentElement).getPropertyValue('--gap')),
      radius: px(getComputedStyle(document.documentElement).getPropertyValue('--radius-surface')),
    };
  })())`).then((s) => JSON.parse(s));

const boot = async (c, scale) => {
  await ev(`localStorage.setItem('__corner_case', ${JSON.stringify(JSON.stringify(c))})`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: scale, mobile: false });
  await send("Page.reload", { ignoreCache: true });
  for (let i = 0; i < 60; i += 1) {
    const ok = await ev(`!!document.querySelector('.statusbar.vertical') && document.documentElement.dataset.material === ${JSON.stringify(c.material)}`);
    if (ok === true) break;
    await sleep(400);
  }
  await sleep(900);
};

for (const material of ["flat", "glass"]) {
  for (const pos of ["left", "right"]) {
    for (const scale of [1, 1.25, 1.5]) {
      const tag = `${material}-${pos}-${scale}`;
      await boot({ pos, material }, scale);
      const m = await measure();
      if (!m.corner) {
        check(`${tag}: 부팅`, false, m);
        continue;
      }
      const R = m.gap + m.radius;
      const X = R + 1;
      const near = (a, b) => Math.abs(a - b) < 0.6;
      check(`${tag}: 조각이 선다`, m.cornerDisplay === "block" && near(m.corner.w, X) && near(m.corner.h, X), { w: m.corner.w, X });
      check(`${tag}: 조각 위 = 제목줄 − 1`, near(m.corner.t, m.tbH - 1), { t: m.corner.t, tbH: m.tbH });
      if (pos === "left") {
        check(`${tag}: 조각 왼쪽 = 기둥 선 칸`, near(m.corner.l, m.sbW - 1), { l: m.corner.l, sbW: m.sbW });
        check(`${tag}: 위 변은 곡선 끝에서`, near(m.edge.l, m.sbW + R), { edgeL: m.edge.l, want: m.sbW + R });
        check(`${tag}: 기둥 선 오른쪽 한 줄`, m.colSlice?.replace(/\s+/g, " ") === "0 1 0 0", m.colSlice);
      } else {
        check(`${tag}: 조각 오른쪽 = 기둥 선 칸`, near(m.corner.r, 1100 - m.sbW + 1), { r: m.corner.r });
        check(`${tag}: 위 변은 곡선 끝에서`, near(m.edge.r, 1100 - m.sbW - R), { edgeR: m.edge.r, want: 1100 - m.sbW - R });
        check(`${tag}: 기둥 선 왼쪽 한 줄`, m.colSlice?.replace(/\s+/g, " ") === "0 0 0 1", m.colSlice);
      }
      check(`${tag}: 기둥 선 그림`, String(m.colImage).startsWith("linear-gradient"), m.colImage);
      // 모서리 6배 확대 — 조각 둘레 여유 16px
      const cx = pos === "left" ? m.corner.l - 16 : m.corner.r - X - 16;
      await shot(`corner-${tag}.png`, { x: cx, y: m.corner.t - 16, width: X + 40, height: X + 40, scale: 6 });
      if (scale === 1) {
        await shot(`corner-${tag}-full.png`);
        // 세션 판 — 자르는 상자의 곡률 · 내려온 카드
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "M", code: "KeyM", modifiers: 2 | 8, windowsVirtualKeyCode: 77 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "M", code: "KeyM", modifiers: 2 | 8, windowsVirtualKeyCode: 77 });
        await sleep(600);
        const s = await measure();
        const want = pos === "left" ? `${R}px 0px 0px` : `0px ${R}px 0px 0px`;
        check(`${tag}: 세션 판 자르는 상자 곡률`, String(s.clipRadius).startsWith(want), s.clipRadius);
        await shot(`corner-${tag}-sheet.png`, { x: cx, y: m.corner.t - 16, width: X + 120, height: X + 80, scale: 4 });
        await send("Input.dispatchKeyEvent", { type: "rawKeyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(300);
      }
    }
  }
}

console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
