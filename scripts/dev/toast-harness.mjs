// 헤드리스 검증 — **토스트 새 모양·움직임** (docs/log/2026-09-25-toast-redesign.md).
//
// 순서(같은 날 덧붙임): **새것이 맨 위**다 — A·B·C 를 밀어 넣으면 DOM 은 C·B·A 이고, 새것이
// 들어오는 순간 이전의 첫 항목은 `flip` 으로 한 칸 내려간다(도중 표본이 아래로 움직이는 중).
//
// `notify-center-harness.mjs` 의 스텁 사본 — 시나리오만 다르다. ① 셋을 밀어 넣으면 들어오는
// 도중의 항목은 오른쪽 바깥(제 폭 이상)에 있다가 `none` 으로 선다 · ② 가운데를 닫으면 그것은
// 오른쪽으로 나가고(도중 표본) 아래 것은 미끄러져 올라간다(`getAnimations`) · ③ 왼쪽 띠가
// 없다(왼쪽 테두리 = 다른 변) · ④ 결마다 둥근 원 안에 아이콘 · ⑤ 검토 대기 카드는 기둥
// **밖**(아래 가운데 — docs/log/2026-09-27-review-popup-card.md)에 서고 토스트가 빠져도 움직이지 않는다 · ⑥ 마지막 한 줄도(기둥째 사라질 때) 미끄러져 나간다 ·
// ⑦ reduce 면 전부 즉시 · 콘솔 예외 0.
//
// usage:
//   npx vite --port 1434 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-aynx-toast \
//     --window-size=1200,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/toast-harness.mjs <outdir> 9250
//     → <outdir>/toast-stack.png · toast-stack-light.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outDir = ".", port = process.env.CDP_PORT ?? "9250"] = process.argv.slice(2);
fs.mkdirSync(outDir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1434";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
let collecting = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (!collecting) return;
  if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description ?? "exception");
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error")
    errors.push(d.params.args.map((a) => a.value ?? a.description).join(" "));
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
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  const p = path.join(outDir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  console.log("PNG " + path.resolve(p));
};
let failed = 0;
const check = (ok, label) => {
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
/** 앱이 이미 올린 것과 **같은 모듈 인스턴스** (README 의 keygen 절) */
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const TOAST = importApp("/lib/toast.svelte.ts");
/**
 * 계산된 `translate` 의 가로 몫(px). 전이 도중에는 `calc(39.8% + 9.5px)` 처럼 **퍼센트가
 * 섞여** 나온다(퍼센트는 제 폭 기준) — 그것까지 풀어 준다. `none` 이면 0. 세로 몫은 늘 0 이라
 * 계산값에 나오지 않는다(나오는 것은 전부 가로다).
 */
const TX = `((el) => { const v = getComputedStyle(el).translate; if (v === 'none') return 0; const w = el.getBoundingClientRect().width; let s = 0; for (const [, n, u] of v.matchAll(/(-?[0-9.]+)(%|px)/g)) s += u === '%' ? (+n / 100) * w : +n; return s; })`;

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  // 모듈이 많아 기본 버퍼(250)를 넘으면 뒤에 올린 모듈이 importApp 에서 안 보인다 — 넉넉히
  performance.setResourceTimingBufferSize(10000);
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  window.__listeners = {};
  window.__ops = { pending: [], recent: [] };
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false } };
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_group_meta: {}, list_host_meta: {},  load_snippets: null, 
     save_snippets: null,  save_settings: null,
    host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    list_ai_clis: [], operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    audit_status: { state: 'off', written: 0, failed: 0 }, mcp_activity: null, list_forwards: [],
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: args?.shell ?? 'pwsh' });
      if (cmd === 'list_operations') return Promise.resolve(window.__ops);
      if (cmd === 'load_settings') return Promise.resolve(window.__settings);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 800, deviceScaleFactor: 1, mobile: false });
collecting = true;
await send("Page.reload", { ignoreCache: true });
await sleep(4000);

// 오래 떠 있게 — 단언 도중 시계가 먼저 지우지 않도록
const LONG = "{ ms: 600000 }";

// ── ① 들어오기 — 셋을 차례로, 각각 60ms 뒤 표본 ─────────────────────────────
const enter = JSON.parse(
  await ev(`(async () => {
    const m = await ${TOAST};
    const out = [];
    const texts = [['success', '업로드를 마쳤습니다: report.pdf'], ['error', '연결하지 못했습니다: dev-01 (시간 초과)'], ['info', '설정을 다시 읽었습니다']];
    for (const [k, s] of texts) {
      const prev = document.querySelector('.toasts .toast');
      const prevY0 = prev?.getBoundingClientRect().top ?? 0;
      m.toast[k](s, ${LONG});
      await new Promise((r) => setTimeout(r, 60));
      const els = [...document.querySelectorAll('.toasts .toast')];
      const el = els[0];
      // 이전의 첫 항목 — 한 칸 아래로 미끄러지는 중이어야 한다 (도중이라 아직 끝자리 전)
      const push = prev ? { same: els[1] === prev, anims: prev.getAnimations().length, dy: prev.getBoundingClientRect().top - prevY0 } : null;
            const w = el.getBoundingClientRect().width;
      // 첫 키프레임 = 출발점 (calc(100% + 24px) 를 제 폭으로 푼다) — 표본 시각의 흔들림과 무관하다
      const k0 = el.getAnimations()[0]?.effect.getKeyframes()[0]?.translate ?? '';
      let start = 0; for (const [, n, u] of k0.matchAll(/(-?[0-9.]+)(%|px)/g)) start += u === '%' ? (+n / 100) * w : +n;
      out.push({ kind: k, tx: ${TX}(el), start, w, anim: el.getAnimations().length, push });
      await new Promise((r) => setTimeout(r, 260));
      if (push) push.final = prev.getBoundingClientRect().top - prevY0;
    }
    return JSON.stringify(out);
  })()`),
);
console.log("ENTER", JSON.stringify(enter));
for (const e of enter)
  check(e.anim > 0 && e.start >= e.w + 12 && e.tx > 20, `① ${e.kind}: 창 오른쪽 바깥에서 출발(${e.start.toFixed(0)}px ≥ 폭 ${e.w.toFixed(0)} + 여백 12) · 60ms 뒤에도 아직 오른쪽 (${e.tx.toFixed(0)}px)`);
for (const e of enter.filter((x) => x.push))
  check(
    e.push.same && e.push.anims > 0 && e.push.dy > 0 && e.push.final > e.push.dy,
    `① ${e.kind} 가 들어올 때 이전 첫 항목은 둘째 칸으로 미끄러져 내려간다 (animations ${e.push.anims}, 도중 +${e.push.dy.toFixed(1)}px → 끝 +${e.push.final?.toFixed(1)}px)`,
  );
await sleep(300);
const settled = JSON.parse(
  await ev(`JSON.stringify([...document.querySelectorAll('.toasts .toast')].map((el) => { const cs = getComputedStyle(el); return { translate: cs.translate, transform: cs.transform, opacity: cs.opacity, anim: el.getAnimations().length }; }))`),
);
console.log("SETTLED", JSON.stringify(settled));
check(settled.length === 3 && settled.every((s) => s.translate === "none" && s.transform === "none" && s.opacity === "1" && s.anim === 0), "① 셋 다 제자리 (translate/transform none, opacity 1)");
check(
  (await ev(`JSON.stringify([...document.querySelectorAll('.toasts .toast')].map((e) => e.className.match(/success|error|info/)[0]))`)) === '["info","error","success"]',
  "① 새것이 맨 위 — A·B·C 를 넣으면 C·B·A",
);
await shot("toast-order.png");

// ── ③④ 모양 — 띠 없음 · 원 안의 아이콘 ──────────────────────────────────────
const look = JSON.parse(
  await ev(`JSON.stringify([...document.querySelectorAll('.toasts .toast')].map((el) => {
    const cs = getComputedStyle(el); const mk = el.querySelector('.mark'); const ms = getComputedStyle(mk);
    const svg = mk.querySelector('svg');
    return { kind: el.className.match(/success|error|info/)[0],
      bl: cs.borderLeftWidth, bt: cs.borderTopWidth, blc: cs.borderLeftColor, btc: cs.borderTopColor,
      w: mk.getBoundingClientRect().width, h: mk.getBoundingClientRect().height, radius: ms.borderRadius,
      bg: ms.backgroundColor, color: ms.color, svg: !!svg, text: mk.textContent.trim() };
  }))`),
);
console.log("LOOK", JSON.stringify(look, null, 1));
for (const l of look) {
  check(l.bl === l.bt && l.blc === l.btc, `③ ${l.kind}: 왼쪽 띠 없음 (left ${l.bl} ${l.blc} = top ${l.bt} ${l.btc})`);
  check(l.svg && l.text === "" && l.radius === "50%" && l.w === l.h && l.w >= 18 && l.bg !== "rgba(0, 0, 0, 0)", `④ ${l.kind}: 둥근 원(${l.w}px, ${l.radius}, bg ${l.bg}) 안의 아이콘 (획 ${l.color})`);
}
check(new Set(look.map((l) => l.color)).size === 3, "④ 결마다 색이 다르다");
await shot("toast-stack.png");
await ev(`document.documentElement.dataset.theme = 'light'`);
await sleep(200);
await shot("toast-stack-light.png");
await ev(`delete document.documentElement.dataset.theme`);

// ── ② 가운데를 닫는다 — 나가는 것은 오른쪽으로, 아래 것은 미끄러져 올라온다 ─────
const exit = JSON.parse(
  await ev(`(async () => {
    const els = [...document.querySelectorAll('.toasts .toast')];
    const [top, mid, low] = els;
    const lowY0 = low.getBoundingClientRect().top, midY0 = mid.getBoundingClientRect().top, topY0 = top.getBoundingClientRect().top;
    mid.querySelector('.x').click();
    await new Promise((r) => setTimeout(r, 70));
    const r = {
      midTx: ${TX}(mid), midW: mid.getBoundingClientRect().width,
      midPos: getComputedStyle(mid).position, midDy: mid.getBoundingClientRect().top - midY0,
      midOpacity: +getComputedStyle(mid).opacity,
      lowAnims: low.getAnimations().length, lowDy: low.getBoundingClientRect().top - lowY0,
      topAnims: top.getAnimations().length, topDy: top.getBoundingClientRect().top - topY0,
    };
    await new Promise((r) => setTimeout(r, 400));
    r.after = document.querySelectorAll('.toasts .toast').length;
    r.midGone = !mid.isConnected;
    r.lowFinal = low.getBoundingClientRect().top - midY0;
    r.lowTransform = getComputedStyle(low).transform;
    return JSON.stringify(r);
  })()`),
);
console.log("EXIT", JSON.stringify(exit));
check(exit.midTx > 5 && exit.midOpacity < 1, `② 닫힌 것은 오른쪽으로 나간다 (translate ${exit.midTx.toFixed(0)}px, opacity ${exit.midOpacity.toFixed(2)})`);
check(Math.abs(exit.midDy) < 1, `② 나가는 동안 제 자리에서 (세로 이동 ${exit.midDy.toFixed(1)}px, position ${exit.midPos})`);
check(exit.lowAnims > 0 && exit.lowDy < 0, `② 아래 것은 미끄러져 올라간다 (animations ${exit.lowAnims}, 도중 ${exit.lowDy.toFixed(1)}px)`);
check(exit.topAnims === 0 && exit.topDy === 0, "② 위 것은 가만히 있다");
check(exit.after === 2 && exit.midGone && Math.abs(exit.lowFinal) < 1 && exit.lowTransform === "none", `② 끝나면 둘 · 아래 것이 빈자리에 선다 (${exit.lowFinal.toFixed(1)}px)`);

// ── ⑤ 검토 대기 카드 — 기둥 밖에 서고, 토스트가 빠져도 움직이지 않는다 ──────
const NOW = Date.now();
await ev(`window.__ops = { pending: [{ operationId: 'op-1', command: 'uptime', targets: ['s1'], cwd: null, validate: null, mode: 'exec', strategy: 'sequential', concurrency: 1, timeoutSeconds: 60, state: 'awaitingApproval', createdAt: ${NOW}, requestedAt: ${NOW}, expiresAt: null, title: 'nginx 설정 재적용', reason: null, idempotencyKey: null }], recent: [] }`);
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(900);
check((await ev(`document.querySelectorAll('.rcard').length`)) === 1 && (await ev(`document.querySelectorAll('.toasts .rcard').length`)) === 0, "⑤ 카드가 섰고 토스트 기둥 안이 아니다 (2026-09-27)");
await sleep(400);
const card = JSON.parse(
  await ev(`(async () => {
    const c = document.querySelector('.rcard');
    const y0 = c.getBoundingClientRect().top, x0 = c.getBoundingClientRect().right;
    const els = [...document.querySelectorAll('.toasts .toast')];
    els[0].querySelector('.x').click();
    const seen = [];
    for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 30)); seen.push([c.getAnimations().length, c.getBoundingClientRect().top - y0, c.getBoundingClientRect().right - x0]); }
    return JSON.stringify(seen);
  })()`),
);
console.log("CARD", JSON.stringify(card));
check(card.every(([a, dy, dx]) => a === 0 && dy === 0 && dx === 0), "⑤ 카드에는 애니메이션이 없고 자리도 그대로다");
await shot("toast-with-card.png");
await ev(`window.__ops = { pending: [], recent: [] }`);
await ev(`window.dispatchEvent(new Event('focus'))`);
await sleep(900);

// ── ⑥ 마지막 한 줄 — 기둥째 사라져도 미끄러져 나간다 ────────────────────────
const last = JSON.parse(
  await ev(`(async () => {
    const m = await ${TOAST};
    for (const t of [...m.toasts]) m.dismiss(t.id);
    await new Promise((r) => setTimeout(r, 400));
    m.toast.info('마지막 한 줄', ${LONG});
    await new Promise((r) => setTimeout(r, 60));
    const el = document.querySelector('.toasts .toast');
    const inTx = ${TX}(el);
    await new Promise((r) => setTimeout(r, 300));
    m.dismiss(m.toasts[0].id);
    await new Promise((r) => setTimeout(r, 70));
    const outTx = ${TX}(el);
    const stillThere = el.isConnected;
    await new Promise((r) => setTimeout(r, 300));
    return JSON.stringify({ inTx, outTx, stillThere, boxes: document.querySelectorAll('.toasts').length });
  })()`),
);
console.log("LAST", JSON.stringify(last));
check(last.inTx > 50, `⑥ 혼자 뜨는 한 줄도 오른쪽에서 들어온다 (${last.inTx.toFixed(0)}px)`);
check(last.stillThere && last.outTx > 5, `⑥ 혼자 지는 한 줄도 오른쪽으로 나간다 (${last.outTx.toFixed(0)}px)`);
check(last.boxes === 0, "⑥ 다 나가면 기둥도 없다");

// ── ⑦ reduce — 전부 즉시 ─────────────────────────────────────────────────
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
const rm = JSON.parse(
  await ev(`(async () => {
    const m = await ${TOAST};
    m.toast.success('하나', ${LONG}); m.toast.error('둘', ${LONG}); m.toast.info('셋', ${LONG});
    await new Promise((r) => setTimeout(r, 30));
    const els = [...document.querySelectorAll('.toasts .toast')];
    const inAnims = els.reduce((a, e) => a + e.getAnimations().length, 0);
    const inTx = els.map((e) => getComputedStyle(e).translate);
    els[1].querySelector('.x').click();
    await new Promise((r) => setTimeout(r, 30));
    const r = { inAnims, inTx, afterClose: document.querySelectorAll('.toasts .toast').length, lowAnims: els[2].getAnimations().length };
    for (const t of [...m.toasts]) m.dismiss(t.id);
    return JSON.stringify(r);
  })()`),
);
console.log("REDUCE", JSON.stringify(rm));
check(rm.inAnims === 0 && rm.inTx.every((x) => x === "none"), "⑦ reduce: 들어올 때 움직임 없음");
check(rm.afterClose === 2 && rm.lowAnims === 0, "⑦ reduce: 닫으면 곧장 빠지고 아래 것도 곧장 선다");
await send("Emulation.setEmulatedMedia", { features: [] });

check(errors.length === 0, `콘솔 예외 0 (${errors.length})`);
for (const e of errors) console.log("  ERR", e.split("\n")[0]);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
