// Headless harness: **호스트 폼 표시 탭 정리** (docs/log/2026-09-29-hostform-display-tidy.md).
// `logos-icons-harness.mjs` 의 사본 — 스텁의 호스트 표와 시나리오만 다르다.
//
//   npx vite --port 1430 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9231 --user-data-dir=%TEMP%/edge-aynx-hfdisplay \
//     --window-size=1100,800 http://localhost:1430/
//   PAGE_PORT=1430 node scripts/dev/hostform-display-harness.mjs outdir 9231
//
// 심어 두는 것(병합값 · 원본은 셋 다 빈 블록): web-01(프리셋 prod 의 아이콘 svg:ubuntu · 색 #4a90d9) ·
// lab-01(물려받은 것 없음) · db-01(출처 모름 svg:logos:mongodb-icon · [defaults] 의 색 #8a8a8a).
//
// 보는 것: ① 칸 순서 아이콘 → 색 → 그룹 → 태그 ② web-01 — 곁말 "프리셋 prod 의 아이콘 · Ubuntu" /
// "프리셋 prod 의 색 · #4a90d9", 미리보기·견본이 물려받은 것을 흐리게, 되돌리기 말풍선, 폼 어디에도 `svg:` 없음
// ③ 빈 칸 저장 = 상속(패치의 icon·color 가 비어 있다) ④ lab-01 — 평소 문구 · 흐림 없음 ⑤ db-01 — "상속된 아이콘 ·
// Mongodb" · "기본값의 색 · #8a8a8a" ⑥ 색을 치면 견본의 흐림이 걷힌다. 콘솔 예외 0.
// PNG: `hf-display-inherited.png` · `hf-display-none.png`.
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
const errors = [];
ws.addEventListener("message", (m) => { const d = JSON.parse(m.data); if (d.method === "Runtime.exceptionThrown") errors.push(d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? "?"); });

await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = []; let nextSession = 100;
  performance.setResourceTimingBufferSize(5000);
  try { localStorage.removeItem('aynx:dock'); localStorage.removeItem('aynx:status-order'); } catch {}
  // meta = **병합값**(list_hosts) — 출처(icon_from·color_from)까지. 원본(get_host_meta)은 셋 다 비어 있다.
  const host = (name, ip, meta) => ({ name, host_name: ip, user: 'root', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null, color: null, group: null, icon_from: null, color_from: null, ...meta } });
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  const hosts = [
    host('web-01', '10.0.0.1', { icon: 'svg:ubuntu', icon_from: { kind: 'preset', name: 'prod' }, color: '#4a90d9', color_from: { kind: 'preset', name: 'prod' } }),
    host('lab-01', '192.168.0.9', {}),
    host('db-01', '10.0.1.1', { icon: 'svg:logos:mongodb-icon', color: '#8a8a8a', color_from: { kind: 'defaults' } }),
  ];
  window.__fake = { hosts };
  const answers = {
    list_hosts: { hosts, warnings: [] },
    list_group_meta: {}, list_host_meta: {}, edit_host: [], rename_group: null, set_group_meta: null,
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [],
    
    load_snippets: null,   save_snippets: null, 
    load_settings: {}, save_settings: null, host_history_list: {}, projects_list: [],
    git_worktree_list: [], ssh_remote_home: '/root', session_stats: { bytes: 0 }, local_cwd: null, ssh_cwd: null,
    report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, drop_ssh: null, resize_session: null, resize_ssh: null, write_session: null, write_ssh: null,
    reap_window_sessions: null, vault_status: 'none', vault_list: [], vault_has_password: false, vault_has_passphrase: false,
    mcp_status: { clis: [] }, delegation_list_targets: [], session_logs_dir: 'C:\\\\logs', home_dir: 'C:\\\\Users\\\\wl',
    'plugin:notification|is_permission_granted': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      // 원본 — 이 호스트 블록에는 아무것도 적혀 있지 않다(전부 물려받은 값)
      if (cmd === 'get_host_meta') return Promise.resolve({ ...META });
      if (cmd === 'set_host_meta') return Promise.resolve(null);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });

const key = async (code, modifiers = 0, k = code, wait = 250) => { const VK = { Enter: 13 }; const vk = code.startsWith("Key") ? code.charCodeAt(3) : VK[code] ?? 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(wait); };
await send("Page.reload", { ignoreCache: true }); await sleep(4500);

const H = `window.__H`;
await ev(`(async () => { const u = performance.getEntriesByType('resource').map(r => r.name).find(n => n.includes('/src/lib/app/hosts.svelte.ts')); window.__H = await import(u); return 'ok'; })()`);
const openDisplay = async (i) => {
  await ev(`(async () => { await ${H}.openEdit(window.__fake.hosts[${i}]); return 'ok'; })()`); await sleep(700);
  await ev(`(() => { const b = [...document.querySelectorAll('.host-modal .nav-item')][1]; b?.click(); return 'ok'; })()`); await sleep(400);
};
const closeForm = () => ev(`(${H}.closeForm(), 'closed')`);
const state = `(() => {
  const sec = [...document.querySelectorAll('.host-modal .host-panel > section')].find(s => !s.hidden);
  const icon = document.getElementById('f-icon');
  const color = sec.querySelector('.color-text');
  const resets = [...sec.querySelectorAll('.icon-field .reset, .file-row button')];
  const all = [sec.textContent, ...[...sec.querySelectorAll('[placeholder],[title],[aria-label],input')].flatMap(e => [e.getAttribute('placeholder'), e.getAttribute('title'), e.getAttribute('aria-label'), e.value])].filter(Boolean).join(' | ');
  return {
    labels: [...sec.querySelectorAll('.fields > label')].map(l => l.textContent.trim()),
    iconPh: icon.placeholder, iconVal: icon.value,
    previewInherited: sec.querySelector('.icon-field .preview').classList.contains('inherited'),
    previewDrawn: !!sec.querySelector('.icon-field .preview svg'),
    colorPh: color.placeholder,
    swatch: document.getElementById('f-color').value,
    swatchInherited: sec.querySelector('.swatch-wrap').classList.contains('inherited'),
    resetTitles: resets.map(b => b.title), resetArias: resets.map(b => b.getAttribute('aria-label')),
    leaksSvg: all.includes('svg:'),
  };
})()`;

// ── ①② web-01 — 프리셋 prod 에서 물려받은 아이콘·색 ──────────────────────────
await openDisplay(0);
const a = await ev(state);
console.log("web-01:", JSON.stringify(a));
check(JSON.stringify(a.labels) === JSON.stringify(["아이콘", "색", "그룹", "태그"]), "칸 순서 = 아이콘 → 색 → 그룹 → 태그");
check(a.iconPh === "프리셋 prod 의 아이콘 · Ubuntu" && a.iconVal === "", "아이콘 곁말 = 프리셋 prod 의 아이콘 · Ubuntu (칸은 비어 있다)");
check(a.previewInherited && a.previewDrawn, "미리보기가 물려받은 아이콘을 흐리게 그린다");
check(a.colorPh === "프리셋 prod 의 색 · #4a90d9", "색 곁말 = 프리셋 prod 의 색 · #4a90d9");
check(a.swatch === "#4a90d9" && a.swatchInherited, "견본 = 물려받은 색 · 흐림/빗금");
check(a.resetTitles.length === 2 && a.resetTitles.every((x) => x === "지우기 — 프리셋 prod 설정을 따름"), "되돌리기 말풍선 둘 = 지우기 — 프리셋 prod 설정을 따름");
check(JSON.stringify(a.resetArias) === JSON.stringify(["아이콘 지우기", "색 지우기"]), "되돌리기 접근성 이름 = 아이콘 지우기 · 색 지우기");
check(!a.leaksSvg, "표시 탭 어디에도 svg: 저장 형식이 없다");
console.log("capture:", await shot("hf-display-inherited.png"));

// ── ③ 빈 칸 저장 = 상속 ──────────────────────────────────────────────────────
await ev(`(document.querySelector('.host-modal form').requestSubmit(), 'submitted')`); await sleep(1200);
const patch = await ev(`JSON.stringify(window.__calls.filter(c => c[0] === 'set_host_meta' && c[1]?.name === 'web-01').map(c => c[1].patch))`);
console.log("set_host_meta web-01:", patch);
const p0 = JSON.parse(patch ?? "[]")[0] ?? null;
check(p0 !== null && !p0.icon && !p0.color, "빈 칸 저장 = 패치의 icon·color 비어 있음 (상속 유지)");
if ((await ev(`!!document.querySelector('.host-modal')`)) === true) await closeForm();
await sleep(300);

// ── ④ lab-01 — 물려받은 것 없음 ──────────────────────────────────────────────
await openDisplay(1);
const b = await ev(state);
console.log("lab-01:", JSON.stringify(b));
check(b.iconPh === "이름으로 검색하거나 이모지 입력", "아이콘 평소 문구 ((선택) 없음)");
check(b.colorPh === "없음 — 기본 색", "색 평소 문구 = 없음 — 기본 색");
check(!b.previewInherited && !b.swatchInherited, "흐림 없음");
check(b.resetTitles.length === 2 && b.resetTitles.every((x) => x === "지우기"), "되돌리기 말풍선 = 지우기");
console.log("capture:", await shot("hf-display-none.png"));
await closeForm(); await sleep(300);

// ── ⑤ db-01 — 출처 모름 · [defaults] ─────────────────────────────────────────
await openDisplay(2);
const c = await ev(state);
console.log("db-01:", JSON.stringify(c));
check(c.iconPh === "상속된 아이콘 · Mongodb", "출처 모름 = 상속된 아이콘 · Mongodb");
check(c.colorPh === "기본값의 색 · #8a8a8a", "[defaults] = 기본값의 색 · #8a8a8a");
check(!c.leaksSvg, "logos 값도 svg: 가 새지 않는다");

// ── ⑥ 색을 치면 흐림이 걷힌다 ────────────────────────────────────────────────
await ev(`(() => { const i = document.querySelector('.host-modal .color-text'); i.value = '#e5484d'; i.dispatchEvent(new Event('input', { bubbles: true })); return 'typed'; })()`); await sleep(300);
const d = await ev(state);
check(d.swatch === "#e5484d" && !d.swatchInherited, "자기 색 = 견본이 그 색 · 흐림 없음");
await closeForm();

check(errors.length === 0, `콘솔 예외 0 (${errors.join(" | ")})`);
console.log(failed === 0 ? "ALL PASS" : `${failed} FAILED`);
ws.close();
process.exit(failed === 0 ? 0 : 1);
