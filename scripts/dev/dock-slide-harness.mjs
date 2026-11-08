// Headless harness: **독 여닫이 — 닫히는 동안의 그림** (docs/log/2026-09-25-dock-slide.md).
// `projects-harness.mjs` 의 사본 — 스텁 표를 줄이고 시나리오만 다르다.
//
//   npx vite --port 1434 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9250 --user-data-dir=%TEMP%/edge-dock \
//     --window-size=1100,800 http://localhost:1434/
//   PAGE_PORT=1434 node scripts/dev/dock-slide-harness.mjs outdir 9250
//
// 보는 것: 닫기는 논리가 곧장(`hidden`)이고 그림만 140ms 남아 미끄러진다. 그 140ms 동안
// ① 보던 본문이 **그대로** 그려져 있다(`display:none` 이 아니다) ② 상자 폭이 열려 있던 폭 그대로다
// (폭 손잡이로 바꾼 폭 — 호스트 폭으로 튀지 않는다) ③ 제목(런처 독이면 고른 칸의 이름 — unified-dock)이 그대로다. 끝나면 `display:none`.
// 설정 독은 가운데 모달이라 닫힘이 즉시다(2026-10-04 — ⇱ 단추는 2026-10-02 에 걷힘). 호스트를 닫고(도중 · 끝난 뒤) 프로젝트를 열면
// **첫 프레임부터** 프로젝트 본문이고 호스트 본문은 숨어 있다. 샘플은 페이지 안의 타이머로 잰다
// (CDP 왕복이 끼면 40ms 창을 놓친다). PNG: `dock-closing.png`(닫히는 도중).
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
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
  const cbs = new Map(); let n = 0; window.__calls = [];
  const answers = {
    list_hosts: { hosts: [{ name: 'dev-01', host_name: '10.0.0.9', user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } }], warnings: [] },
    get_host_meta: { tags: [], forwards: [] }, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
     load_snippets: null, 
     save_snippets: null, 
    load_settings: {}, save_settings: null, host_history_list: {},
    projects_list: [{ id: 'L1', name: 'aynx', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: null, tmux: false }],
    git_worktree_list: [],
    reap_window_sessions: null, vault_status: 'none', vault_list: [], mcp_status: { clis: [] },
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  try { localStorage.removeItem('aynx:dock'); } catch {}
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
await send("Page.reload", { ignoreCache: true }); await waitBoot(ev);

const key = async (code, modifiers, k) => { const vk = code.charCodeAt(3); for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); };
/** 앱이 이미 올린 것과 **같은 모듈 인스턴스** (README 의 keygen 절) */
const importApp = (file) => `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const rect = () => ev(`(() => { const r = document.querySelector('.dock').getBoundingClientRect(); return JSON.stringify({ x: r.left, y: r.top, w: r.width, h: r.height }); })().toString()`).then(JSON.parse);

/**
 * 페이지 안에서 독을 닫고(Escape) 40·100·300ms 에 잰다. 본문은 네 칸의 `display` 로 읽는다
 * (보이는 칸의 이름만 모은다) — 닫히는 도중이면 보던 칸 하나가 남아 있어야 한다.
 */
const SAMPLE = `(() => {
  const d = document.querySelector('.dock');
  // 2026-10-18 통합 독 — 런처 본문 넷은 칸 카드(.card) 안, 설정 본문만 상자 바로 아래다(마크업 순서 그대로).
  // 칸 안의 목록 컴포넌트(호스트 · 프로젝트 · DB)도 제 '.body' 를 가지므로 독 자신의 본문만 고른다(카드의 자식 · 상자의 자식).
  const bodies = [...d.querySelectorAll(':scope > .body, :scope .card > .body')];
  const NAMES = ['alerts', 'hosts', 'projects', 'db', 'settings'];
  return () => ({
    hidden: d.hidden, display: getComputedStyle(d).display,
    width: Math.round(d.getBoundingClientRect().width),
    title: (d.querySelector('.head .title') ?? d.querySelector('.segs .seg[aria-selected="true"] .seg-lbl')).textContent.trim(),
    shownBodies: bodies.map((b, i) => getComputedStyle(b).display !== 'none' ? NAMES[i] : null).filter(Boolean).join('|'),
    // 머리줄 단추 수 — 설정 독은 닫기 하나(옛 ⇱ 는 2026-10-02 설정 타일과 함께 걷혔다 — docs/log/2026-10-02-settings-modal.md), 런처는 머리줄 없음(0)
    pin: d.querySelectorAll('.head .head-btn').length,
    tr: getComputedStyle(d).transform,
  });
})()`;
const closeAndSample = () => ev(`(() => { const s = ${SAMPLE}; const out = { before: s() };
  document.querySelector('.dock').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  return Promise.resolve().then(() => { out.t0 = s(); }).then(() => new Promise((ok) => { setTimeout(() => { out.t40 = s(); }, 40); setTimeout(() => { out.t100 = s(); }, 100); setTimeout(() => { out.t300 = s(); ok(JSON.stringify(out)); }, 300); }));
})()`).then(JSON.parse);

const verifyClose = (label, o, body) => {
  console.log(label, JSON.stringify(o));
  check(o.before.shownBodies === body && !o.before.hidden, `${label}: 열려 있을 때 본문 = ${body}`);
  check(o.t0.hidden === true, `${label}: hidden 은 곧장 (마이크로태스크 한 번 뒤 — Svelte 가 비우는 자리)`);
  for (const k of ["t40", "t100"]) {
    const s = o[k];
    check(s.display !== "none", `${label} ${k}: 아직 그려져 있다 (display ${s.display})`);
    check(s.shownBodies === body, `${label} ${k}: 보던 본문이 그대로 (${s.shownBodies || "없음"})`);
    check(s.width === o.before.width, `${label} ${k}: 폭 그대로 ${s.width} = ${o.before.width}`);
    check(s.title === o.before.title, `${label} ${k}: 제목 그대로 (${s.title})`);
    check(s.pin === o.before.pin, `${label} ${k}: 머리줄 단추 그대로 (⇱ ${s.pin})`);
  }
  check(o.t300.display === "none", `${label} 끝: display none`);
};

// ── ① 프로젝트 독: 폭을 손잡이로 바꾼 뒤 닫는다 ─────────────────────────────
await key("KeyJ", 10, "J"); await sleep(500);
const hostsW = await ev(`${importApp("app/dock.svelte")}.then(m => m.dockWidthOf('hosts'))`);
let r = await rect();
console.log("projects open rect", r, "hosts width", hostsW);
// 손잡이 드래그 — 오른쪽 가장자리 3px 안쪽을 잡고 끌어 넓힌다. 끄는 동안 폭이 따라와야 한다.
const gx = r.x + r.w - 3, gy = r.y + r.h / 2, target = hostsW + 130;
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: gx, y: gy });
await send("Input.dispatchMouseEvent", { type: "mousePressed", x: gx, y: gy, button: "left", clickCount: 1 });
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x + target - 40, y: gy, button: "left", buttons: 1 }); await sleep(50);
const mid = await rect();
check(Math.abs(mid.w - (target - 40)) <= 2, `드래그 중 폭이 따라온다 (${mid.w} ≈ ${target - 40})`);
await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: r.x + target, y: gy, button: "left", buttons: 1 }); await sleep(50);
await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: r.x + target, y: gy, button: "left", clickCount: 1 }); await sleep(100);
r = await rect();
check(Math.abs(r.w - target) <= 2 && Math.abs(r.w - hostsW) > 50, `놓은 폭 ${r.w} (호스트 폭 ${hostsW} 과 다르다)`);
// 도중 캡처 — 닫기를 걸고 70ms 뒤에 찍는다
await ev(`document.querySelector('.dock').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
await sleep(60);
console.log("capture:", await shot("dock-closing.png"));
await sleep(300);
await key("KeyJ", 10, "J"); await sleep(500);
verifyClose("projects", await closeAndSample(), "projects");

// ── ② 설정 독 — 가운데 모달(2026-10-02 · 등장 키프레임 2026-10-04)이라 **닫힘은 즉시**다 ─────────────────
// 배경막이 `{#if}` 로 곧장 빠지는 것과 맞춘다(`Dock.svelte` 의 "설정 모달 등장" 주석 — 전이를 끈다). 미끄러지는 것은 창 끝 독(런처)뿐.
await key("Comma", 2, ","); await sleep(600);
if ((await ev(`document.querySelector('.dock').hidden`)) === true) { await ev(`${importApp("app/dock.svelte")}.then(m => m.openDock('settings'))`); await sleep(600); }
const settingsO = await closeAndSample();
console.log("settings", JSON.stringify(settingsO));
check(settingsO.before.shownBodies === "settings" && !settingsO.before.hidden, "settings: 열려 있을 때 본문 = settings");
check(settingsO.t0.hidden === true && settingsO.t40.display === "none" && settingsO.t100.display === "none" && settingsO.t300.display === "none", "settings: 닫으면 곧장 display none (모달 — 미끄러짐 없음)");
check(settingsO.t0.tr === "none", `settings: 닫힐 때 transform 이 걸리지 않는다 (${settingsO.t0.tr})`);
check(settingsO.before.pin === 1, "설정: 머리줄 단추 = 닫기 하나(⇱ 없음)");
check((await ev(`!!document.querySelector('.dock .settings-view')`)) === true, "설정 본문은 붙어 있다");

// ── ③ 호스트를 닫고 → 프로젝트를 연다: 첫 프레임부터 프로젝트 본문 ─────────────
// (a) 닫히는 도중에 연다 (되돌아오는 길) · (b) 다 닫힌 뒤에 연다
for (const [label, wait] of [["도중", 60], ["끝난 뒤", 300]]) {
  await key("KeyH", 10, "H"); await sleep(500);
  const o = await ev(`(async () => { const m = await ${importApp("app/dock.svelte")}; const s = ${SAMPLE};
    document.querySelector('.dock').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await new Promise((ok) => setTimeout(ok, ${wait}));
    const out = { closing: s() };
    m.openDock('projects');
    await Promise.resolve();
    out.micro = s();
    await new Promise((ok) => requestAnimationFrame(() => { out.frame = s(); ok(); }));
    return JSON.stringify(out); })()`).then(JSON.parse);
  console.log(`hosts→projects (${label})`, JSON.stringify(o));
  // 끝난 뒤에는 상자가 `display:none` 이다 (안쪽 칸의 계산값은 부모를 따르지 않으므로 상자로 본다)
  if (wait < 140) check(o.closing.display !== "none" && o.closing.shownBodies === "hosts", `(${label}) 닫히는 중 본문 = hosts (${o.closing.shownBodies})`);
  else check(o.closing.display === "none", `(${label}) 다 닫혔다 (display ${o.closing.display})`);
  check(o.frame.shownBodies === "projects" && !o.frame.hidden, `(${label}) 첫 프레임부터 프로젝트 본문 · 호스트 숨김 (${o.frame.shownBodies})`);
  check(o.frame.title === "프로젝트", `(${label}) 첫 프레임 제목 = 프로젝트 (${o.frame.title})`);
  check(o.frame.width === Math.round(r.w), `(${label}) 첫 프레임 폭 = 프로젝트 폭 (${o.frame.width})`);
  await ev(`document.querySelector('.dock').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(350);
}

// ── ④ 열린 채로 종류 바꾸기 — 전이 없음 · 폭은 새 종류 ──────────────────────
await key("KeyJ", 10, "J"); await sleep(500);
await key("KeyH", 10, "H"); await sleep(40);
const sw = await ev(`(() => { const d = document.querySelector('.dock'); return JSON.stringify({ anims: d.getAnimations().length, w: Math.round(d.getBoundingClientRect().width), title: (d.querySelector('.head .title') ?? d.querySelector('.segs .seg[aria-selected="true"] .seg-lbl')).textContent.trim() }); })()`).then(JSON.parse);
// 2026-09-25 (unified-dock): 런처 세 칸은 **한 폭**이다 — 프로젝트 칸에서 넓힌 폭이 호스트 칸에도 그대로다.
check(sw.anims === 0 && sw.w === Math.round(r.w) && sw.title === "호스트", `열린 채로 프로젝트→호스트: 전이 없음 · 같은 폭(런처 한 폭) · 칸 이름 (${JSON.stringify(sw)})`);
await ev(`document.querySelector('.dock').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`); await sleep(350);

// ── ⑤ 움직임 줄이기 — 곧장 사라진다 ─────────────────────────────────────────
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
await key("KeyJ", 10, "J"); await sleep(300);
const red = await ev(`(() => { const d = document.querySelector('.dock'); d.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return new Promise((ok) => setTimeout(() => ok(getComputedStyle(d).display), 20)); })()`);
check(red === "none", `reduce: 닫으면 곧장 display none (${red})`);
await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });

console.log(failed ? `${failed} FAILED` : "ALL PASS"); process.exit(failed ? 1 : 0);
