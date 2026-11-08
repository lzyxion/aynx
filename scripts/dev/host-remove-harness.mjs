// Headless harness: 호스트 **제거 팬아웃** (docs/log/2026-09-17-host-remove-fanout.md).
// `blocks-harness.mjs` 의 사본 — 스텁 표와 시나리오만 다르다.
//
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9224 --user-data-dir=%TEMP%/edge-aynx \
//     --window-size=1100,800 http://localhost:1420/
//   (PAGE_PORT · CDP_PORT 로 격리 서버를 가리킬 수 있다 — 기본 1420 · 9224)
//   node scripts/dev/host-remove-harness.mjs host-remove-confirm.png
//
// 포트는 `CDP_PORT` 로 바꾼다 (기본 9224) — 다른 헤드리스 판이 이미 9224 를 쓰고 있으면
// 그쪽 탭을 리로드해 버리므로, 자기 `--user-data-dir` 로 하나 더 띄우고 그 포트를 준다.
//
// 심어 두는 것: 즐겨찾기 두 칸(`web-01`·`db-01`) · 호스트 스니펫 하나(`web-01`) + 전역 하나 ·
// 다른 워크스페이스의 `web-01` 저장 잎 하나와 로컬 잎 하나 · 현재 워크스페이스의 열린 SSH 타일.
// 그 상태에서 독을 열고 `web-01` 을 우클릭 → 제거 → 확인까지 몰아 본 뒤, 확인 문구의 숫자와
// 백엔드로 나간 짐(`save_snippets`·`workspaces_apply`)·localStorage 를 확인한다.
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const out = process.argv[2] ?? "host-remove-confirm.png";
const port = process.env.CDP_PORT ?? "9224";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl); await new Promise((r) => (ws.onopen = r));
let seq = 0; const pending = new Map(); const events = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method) events.push(d); };
const send = (method, params = {}) => new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
const ev = async (e) => { const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true }); return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); fs.writeFileSync(name, Buffer.from(r.result.data, "base64")); return name; };
await send("Page.enable"); await send("Runtime.enable");

const SNIPPETS = JSON.stringify({
  version: 1,
  snippets: [
    { id: "S1", name: "web 재시작", command: "systemctl restart web", scope: { kind: "host", alias: "web-01" }, enter: true },
    { id: "S2", name: "목록", command: "ls -la", scope: { kind: "all" }, enter: true },
  ],
});
await send("Page.addScriptToEvaluateOnNewDocument", { source: `
  const cbs = new Map(); let n = 0; window.__calls = [];
  try { localStorage.setItem('aynx:favorites', JSON.stringify([{kind:'host',alias:'web-01'},{kind:'host',alias:'db-01'}])); } catch {}
  const HOSTS = [
    { name: 'web-01', host_name: '10.0.0.1', user: 'deploy', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [] } },
    { name: 'db-01', host_name: '10.0.0.2', user: 'deploy', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [] } },
  ];
  const META = { tags: [], forwards: [], color: null, icon: null, group: null, scrollback: null, on_connect: null, log: false, shell_integration: null, tmux: false };
  window.__fake = { HOSTS };
  window.__workspaceSeed = { kind: 'aynx.workspaces', version: 2, revision: 1, activeWorkspaceId: 'default', workspaces: [
    { id: 'default', name: '기본', lastActive: {}, tabs: [{ tabKey: 'live', title: 'web-01', placement: { kind: 'main' }, root: { kind: 'ssh', alias: 'web-01', tileKey: 'live-ssh' } }] },
    { id: 'cold', name: '다른 작업', lastActive: {}, tabs: [{ tabKey: 'cold-tab', title: '작업', placement: { kind: 'main' }, root: { dir: 'row', ratio: 0.5, a: { kind: 'ssh', alias: 'web-01', tileKey: 'cold-ssh' }, b: { kind: 'local', tileKey: 'cold-local' } } }] },
  ] };
  const answers = {
    list_hosts: { hosts: HOSTS, warnings: [] },
    get_host_meta: META,
    list_group_meta: {}, list_host_meta: {},
    list_shells: [{ id: 'pwsh', label: 'PowerShell 7' }],
    
    load_snippets: ${JSON.stringify(SNIPPETS)},
    
     save_snippets: null, 
    session_logs_dir: 'C:\\\\Users\\\\wl\\\\AppData\\\\Local\\\\aynx\\\\logs',
    // 제거는 **경고 목록**을 돌려준다 (비어 있으면 안내도 없다).
    remove_host: null,
    set_host_meta: null,
    forget_host_key: { host: '10.0.0.1', port: 22, removed: 2 },
    // 네이티브 확인 대화상자 — 다중 선택·Delete 키 경로가 쓴다 (우클릭 한 개는 인라인 확인).
    'plugin:dialog|ask': true,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      window.__calls.push([cmd, args]); return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd)); },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
` });
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true }); await sleep(4500);

console.log("favorites seeded:", await ev(`localStorage.getItem('aynx:favorites')`));
console.log("open ssh tiles:", await ev(`document.querySelectorAll('[data-pane]').length`));

// ── ① 호스트 독을 연다 (Ctrl+Shift+H) ──────────────────────────────────────
const key = async (code, modifiers, k) => { const vk = code.startsWith("Key") ? code.charCodeAt(3) : 0; for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, modifiers, code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk }); await sleep(250); };
await key("KeyH", 10, "H"); await sleep(1200);
console.log("host rows:", await ev(`[...document.querySelectorAll('[data-id]')].map(e => e.getAttribute('data-id')).join('|')`));

// ── ② `web-01` 우클릭 → "제거" ─────────────────────────────────────────────
const ctx = `(() => {
  const el = document.querySelector('[data-id="h:web-01"]');
  if (!el) return 'no row';
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + 8, clientY: r.top + 8 }));
  return 'opened';
})()`;
console.log("contextmenu:", await ev(ctx)); await sleep(400);
const clickRemove = `(() => {
  const b = [...document.querySelectorAll('.ctx-item')].find(x => x.textContent.trim() === '제거' || x.textContent.trim() === 'Remove');
  if (!b) return 'no item';
  b.click(); return 'clicked';
})()`;
console.log("click 제거:", await ev(clickRemove)); await sleep(400);

// ── ③ 확인 문구 — 함께 정리되는 자리가 한 줄로 붙는다 ──────────────────────
const confirmText = `[...document.querySelectorAll('.ctx-confirm')].map(e => e.textContent.replace(/\\s+/g, ' ').trim()).join(' ⏎ ')`;
const text = await ev(confirmText);
console.log("confirm text:", JSON.stringify(text));
const want = ["즐겨찾기 1", "스니펫 1", "저장된 워크스페이스 타일 1", "열린 타일 1"];
for (const w of want) console.log(`${text && text.includes(w) ? "PASS" : "FAIL"} 확인 문구에 '${w}'`);
console.log("capture:", await shot(out));

// ── ④ 확인 → 제거 + 팬아웃 ────────────────────────────────────────────────
const confirmRemove = `(() => {
  const b = [...document.querySelectorAll('.ctx-btn.danger')].pop();
  if (!b) return 'no button'; b.click(); return 'clicked';
})()`;
console.log("confirm click:", await ev(confirmRemove));
await sleep(1200); // 스니펫·워크스페이스 저장 디바운스 200ms + 여유

const asserts = `(() => {
  const calls = window.__calls;
  const removed = calls.filter(c => c[0] === 'remove_host').map(c => c[1]?.name);
  const snippets = calls.filter(c => c[0] === 'save_snippets').pop();
  const rewrite = calls.filter(c => c[0] === 'workspaces_apply' && c[1]?.mutation?.op === 'rewriteHostAliases').pop();
  let favs = null; try { favs = localStorage.getItem('aynx:favorites'); } catch {}
  return {
    removeHostArgs: removed,
    snippetsJson: snippets?.[1]?.json ?? null,
    workspaceFile: window.__workspaceFile,
    rewrite: rewrite?.[1]?.mutation ?? null,
    favorites: favs,
  };
})()`;
const r = await ev(asserts);
const ok = (name, cond) => console.log(`${cond ? "PASS" : "FAIL"} ${name}`);
console.log("calls:", JSON.stringify(r));
ok("remove_host 가 web-01 로 불렸다", JSON.stringify(r.removeHostArgs) === JSON.stringify(["web-01"]));
ok("save_snippets 짐에 web-01 범위가 없다", !!r.snippetsJson && !r.snippetsJson.includes("web-01"));
ok("save_snippets 짐에 전역 스니펫은 남았다", !!r.snippetsJson && r.snippetsJson.includes("S2"));
ok("전체 워크스페이스의 저장 트리에서 별칭 제거", !!r.rewrite && !JSON.stringify(r.workspaceFile).includes('"alias":"web-01"'));
ok("cold 트리는 로컬 잎으로 접힌다", r.workspaceFile?.workspaces.find(w => w.id === "cold")?.tabs[0].root.tileKey === "cold-local");
ok("즐겨찾기에서 web-01 이 빠졌다", !!r.favorites && !r.favorites.includes("web-01"));
ok("즐겨찾기의 db-01 은 그대로다", !!r.favorites && r.favorites.includes("db-01"));
console.log("열린 타일은 그대로 (닫지 않는다):", await ev(`document.querySelectorAll('[data-pane]').length`));

const exc = events.filter((e) => e.method === "Runtime.exceptionThrown").map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0]).filter((s) => !/stub:/.test(s)).slice(0, 5);
if (exc.length) console.log("EXC", exc);
ws.close();
