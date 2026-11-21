// 헤드리스 검증 — **문서 타일의 양옆 곁 패널**(왼쪽 파일 · 오른쪽 목차 — 2026-11-19 · `DocView` 의 "곁 패널" 절 · `doc-side-panels.ts` · `doc/files-controller.svelte.ts`).
//
// 스텁은 `doc-head-narrow-harness.mjs` 의 것(가짜 로컬 세션 · 파일은 `window.__files` 표 — 디스크에 쓰지 않는다)에 폴더 목록(`local_list`)과
// 하위 폴더 찾기(`list_text_files`)를 더했다. 가짜 폴더:
//   C:\notes — a.md(제목 여럿 · 긴 글) · b.md · c.txt · photo.png(목록에서 빠진다) · .hidden.md(둘러보기에서 빠진다) · sub\deep.md · empty\
// 로컬 문서 a.md 를 시작 화면 곁에 열고, 타일 폭은 분할 비율(`tab.root.ratio`)로 바꾼다(진짜 배치 — 상자 폭을 덮어쓰지 않는다).
//
// 보는 것:
// ① 넓은 타일 머리줄 — 이름 바로 뒤 파일 단추 · 도구줄 맨 끝(새로고침 뒤) 목차 단추 · 패널을 여닫아도 두 단추의 x 그대로 ·
//    연 직후 패널 폭이 0 과 240 사이를 지나 240 에 닿음(여닫는 움직임 — `sidePanelGrow`) · 켜진 두 토글의 계산된 바탕색이 같음(강조 면)
// ② 파일 패널 — 본문 왼쪽 240px · 찾기 칸 · 지금 폴더 줄 · `..` → 폴더 → 파일(그림 · 숨김 없음) · 지금 문서 강조 + aria-current · 포커스는 패널로 가지 않음
// ③ 폴더 줄 → 그 폴더 · `..` 로 복귀 · 빈 폴더 문구는 목록 안 `..` 줄 바로 아래(꼬리 줄엔 없음 · ↑↓ 가 건너뜀)
// ④ 찾기 — 하위 폴더 결과(deep.md + 흐린 sub) · 맞는 것 없음 · ↑↓(본문은 밀리지 않음) · Esc(질의 비움 → 본문 포커스)
// ⑤ 파일 줄 → 이 타일에서 바뀜(타일 수 · 이름 · 패널 켜짐 · 본문 포커스 · 미리 보기/고정 표식 유지 · 새 DocView 의 켜진 패널은 첫 프레임부터 240) ·
//    지금 문서 다시 고름 = 그대로
// ⑥ 목차 패널 — 본문 오른쪽 240px · border-left · 줄 → 그 제목으로 스크롤
// ⑦ 둘 다 — ≥882 둘 다 · 640~881 은 나중 것만(줄였다 넓히면 돌아옴) · 그 폭에서 열면 먼저 것이 명세에서도 꺼짐(aria-pressed 따라감)
// ⑧ 좁은 타일(<640) — 같은 자리의 드롭다운 단추 · 파일 드롭다운(화면 안 · 칸 포커스 · 폴더는 안 닫힘 · 파일은 닫히고 바뀜) ·
//    목차 드롭다운(오른쪽 변 맞춤 · 화면 안) · 열린 두 드롭다운 단추의 바탕색이 같음(켜진 토글과도) · 하나만 · Esc
// 기다림 — 누른 뒤에는 패널 상자의 움직임이 끝날 때까지(`settle` — 고정 sleep 이 아니라 조건)
// ⑨ 편집 중 저장 안 한 변경 → 파일 고름 → 확인 상자([저장하고 열기] · [버리고 열기]) · [취소] = 그대로 · [버리고 열기] = 바뀜(쓰기 없음)
// ⑩ 최대화한 문서 타일에서 파일을 골라도 최대화 유지
// ⑫ 문서 → 문서 갈아 끼우기(2026-11-20 — `doc-swap.ts`) — 긴 폴더(C:\other\many · 40장)로 옮겨 목록을 밀어 두고 고름 → 새 타일 상자에
//    등장 애니메이션 없음(프레임마다 상자 애니메이션 0 · 투명도 1 · 변환 없음) · 옮긴 폴더 · 줄 · 스크롤 그대로(새 목록의 모든 프레임) ·
//    "읽는 중" 한 프레임도 없음 · 본문이 새 문서 · 본문만 떠오름(본문 애니메이션 · 투명도 < 1 프레임). 찾기 글 'f' 로 같은 것을
//    (찾기 글 · 결과 줄 · 스크롤 · 다시 훑지 않음) · 파일 타일 길(`openDoc` 의 미리 보기 갈아 끼우기)도 등장 없음 · 본문 떠오름
// ⑬ 좁은 타일(520px — 파일 드롭다운)에서 골라 바꾸기(2026-11-20) — 드롭다운에서 many 로 옮겨 밀어 두고 고름 · notes 에서 'deep'(하위 sub 의 파일)을
//    찾아 고름 → 새 타일이 선 모든 프레임에서 드롭다운 닫힘 · 등장 애니메이션 없음 · 본문만 떠오름 ·
//    다시 열면 넘겨받은 폴더 · 줄 · 고른 줄 강조 · 스크롤(든 뒤 10 프레임 내내) · 닫았다 다시 열어도 스크롤 그대로 · ↑↓ 로 고른 줄이 보임 ·
//    폴더를 옮기면 맨 위(둘러보기) / 폴더 notes(문서의 폴더 sub 가 아님) · 찾기 글 · 결과 · 다시 훑지 않음(찾기) ·
//    넘겨받은 찾기 글에서 Esc 한 번 = 비우기만. 좁은 새 타일에 곁 패널 목록이 선 프레임 수는 **관찰만**(판정 아님 — 고치지 않기로 한 항목)
// ⑪ 콘솔 오류 0(`stub:` 거절 제외 — ⑬ 뒤에 잰다)
//
//   node scripts/dev/run-harness.mjs doc-side-panels-harness.mjs <outdir> --size 1400x900
//     → <outdir>/p1-wide.png · p2-files.png · p3-empty.png · p4-find.png · p4-nomatch.png · p5-switched.png · p5-root.png · p6-outline.png ·
//       p7-both.png · p7-mid.png · p8-narrow.png · p8-files-drop.png · p8-outline-drop.png · p9-confirm.png · p10-zoomed.png · p12-swapped.png ·
//       p13-narrow-swapped.png · p13-narrow-reopen.png · p13-narrow-find-reopen.png
import { reloadBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9279"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1446";
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${PAGE_PORT}`));
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
    return;
  }
  if (d.method === "Runtime.exceptionThrown") {
    const x = d.params.exceptionDetails;
    const s = (x.exception?.description ?? x.text ?? "").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("EXC " + s);
  }
  if (d.method === "Runtime.consoleAPICalled" && (d.params.type === "error" || d.params.type === "warning")) {
    const s = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0];
    // 경고는 Svelte 의 것만 센다(effect_update_depth_exceeded · state_unsafe_mutation 등)
    if (d.params.type === "warning" && !/svelte|effect_|state_/i.test(s)) return;
    if (!/stub:/.test(s)) errors.push(`console.${d.params.type} ${s}`);
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
const evj = async (e) => {
  const v = await ev(e);
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const p = path.join(outdir, name);
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
      console.log("PNG " + path.resolve(p));
      return;
    }
    await sleep(400);
  }
};
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};
const mouse = (type, x, y) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1 });
const hover = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
/**
 * 곁 패널의 여닫는 움직임(`sidePanelGrow` — 200ms)이 끝날 때까지 — 패널 상자(`.files-panel` · `.outline-panel`)에 도는 애니메이션이 없을 때까지
 * 기다린다(고정 sleep 이 아니라 조건). Svelte 5 의 전환은 Web Animations 라 `document.getAnimations()` 에 잡힌다
 */
const settle = async () => {
  await waitFor(
    `document.getAnimations().filter((a) => a.playState === 'running' && a.effect?.target?.matches?.('.files-panel, .outline-panel')).length === 0`,
    3000,
  );
  // 마지막 프레임이 그려지도록 한 틀 더
  await ev(`new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))`);
};
const clickXY = async (x, y) => {
  await hover(x, y);
  await mouse("mousePressed", x, y);
  await mouse("mouseReleased", x, y);
  await sleep(300);
  await settle();
};
const key = async (code, k, vk, modifiers = 0) => {
  await send("Input.dispatchKeyEvent", { type: "rawKeyDown", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: k, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk, modifiers });
  await sleep(250);
};
const esc = () => key("Escape", "Escape", 27);
const down = () => key("ArrowDown", "ArrowDown", 40);
const upKey = () => key("ArrowUp", "ArrowUp", 38);
const enterKey = () => key("Enter", "Enter", 13);

let bad = 0;
const rows = [];
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  rows.push([okj ? "PASS" : "FAIL", name, JSON.stringify(got), okj ? "" : JSON.stringify(want)]);
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
  return okj;
};
const unmeasured = [];
/** 판정 없이 본 값만 적는 줄(고치지 않기로 한 항목 — 실패로 세지 않는다) */
const observe = (name, got) => {
  rows.push(["관찰", name, JSON.stringify(got), ""]);
  console.log(`obs  ${name}: ${JSON.stringify(got)}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const W = importApp("app/tabs.svelte.ts");
const S = importApp("lib/session.ts");
const SESS = importApp("app/sessions.svelte.ts");
const PANES = importApp("app/panes.svelte.ts");
const ANCH = importApp("app/doc-anchors.svelte.ts");
const CONF = importApp("app/confirm-dialog.svelte.ts");

// ── 가짜 폴더 ─────────────────────────────────────────────────────────────────────
const DIR = "C:\\notes";
const A = DIR + "\\a.md";
const B = DIR + "\\b.md";
const C = DIR + "\\c.txt";
const para = "문서 타일의 곁 패널을 시험하는 긴 문단입니다. 스크롤이 생기도록 같은 말을 여러 번 적습니다. ".repeat(6);
const A_BODY = [
  "# 노트 A",
  "",
  para,
  "",
  "## 하나",
  "",
  ...Array.from({ length: 6 }, () => para + "\n"),
  "## 둘",
  "",
  ...Array.from({ length: 6 }, () => para + "\n"),
  "## 셋",
  "",
  ...Array.from({ length: 6 }, () => para + "\n"),
  "### 셋의 아래",
  "",
  ...Array.from({ length: 4 }, () => para + "\n"),
].join("\n");
const FILES = {
  [A]: A_BODY,
  [B]: "# 노트 B\n\n짧은 글입니다.\n",
  [C]: "plain text file\nsecond line\n",
  [DIR + "\\photo.png"]: "PNG",
  [DIR + "\\.hidden.md"]: "# hidden\n",
  [DIR + "\\sub\\deep.md"]: "# 깊은 노트\n\n하위 폴더의 글.\n",
  // 곁 타일 — 분할 비율로 문서 타일 폭을 바꾸려고 옆에 세우는 다른 폴더의 문서
  ["C:\\other\\z.md"]: "# 곁 타일\n",
};
const Z = "C:\\other\\z.md";
// ⑫ 의 긴 폴더 — 목록이 밀리도록 40장(문서 폴더 notes 와 다른 폴더라 "옮긴 폴더가 남는가" 도 본다)
const MANY = "C:\\other\\many";
const manyName = (i) => `f${String(i).padStart(2, "0")}.md`;
for (let i = 1; i <= 40; i++) FILES[`${MANY}\\${manyName(i)}`] = `# F${String(i).padStart(2, "0")}\n\n긴 폴더의 ${i}번째 글.\n`;
const DIRS = ["C:\\", DIR, DIR + "\\sub", DIR + "\\empty", "C:\\other", MANY];

const stub = () => `
  performance.setResourceTimingBufferSize(10000);
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => { const ids = evts.get(name) ?? []; for (const id of ids) cbs.get(id)?.({ event: name, id, payload }); return ids.length; };
  let nextSession = 100;
  // 파일 · 폴더 — 디스크에 쓰지 않는다(이 표에만)
  window.__files = ${JSON.stringify(FILES)}; window.__dirs = ${JSON.stringify(DIRS)}; window.__fileOps = []; window.__lists = [];
  const baseName = (p) => p.replace(/\\\\+$/, '').split(/[\\\\/]/).pop();
  const parentDir = (p) => { const i = p.lastIndexOf('\\\\'); const d = p.slice(0, i); return d.length === 2 ? d + '\\\\' : d; };
  const fileEntry = (p) => ({ name: baseName(p), path: p, kind: 'file', size: (window.__files[p] ?? '').length, mtime: 1700000000, mode: null, symlinkTarget: null, linkIsDir: false, hidden: false });
  const dirEntry = (p) => ({ name: baseName(p), path: p, kind: 'dir', size: 0, mtime: 1700000000, mode: null, symlinkTarget: null, linkIsDir: false, hidden: false });
  const children = (d) => {
    const files = Object.keys(window.__files).filter((p) => parentDir(p) === d).map(fileEntry);
    const dirs = window.__dirs.filter((p) => p !== d && p.length > 3 && parentDir(p) === d).map(dirEntry);
    return [...files, ...dirs];
  };
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    mcp_status: { clis: [{ id: 'claude', name: 'Claude Code', installed: true, registered: true }] },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, send_input: null, reap_window_sessions: null, session_log_path: null,
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
    local_roots: ['C:\\\\'],
    side_chats_load: { json: JSON.stringify({ v: 2, current: null, last: { cli: 'claude', model: '', effort: '' }, chats: [] }), rev: 1 },
  };
  const label = 'main';
  window.__label = label;
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'local_list') {
        window.__lists.push(args.path);
        if (!window.__dirs.includes(args.path)) return Promise.reject('[not-found] ' + args.path);
        return Promise.resolve(children(args.path));
      }
      if (cmd === 'list_text_files') {
        const root = args.root.replace(/\\\\+$/, '');
        const files = Object.keys(window.__files)
          .filter((p) => p.startsWith(root + '\\\\') && !baseName(p).startsWith('.'))
          .map((p) => ({ rel: p.slice(root.length + 1).split('\\\\').join('/'), path: p }))
          .sort((x, y) => x.rel.split('/').length - y.rel.split('/').length);
        return Promise.resolve({ root: args.root, files, truncated: false });
      }
      if (cmd === 'local_write_text') { window.__fileOps.push(['write', args.path]); window.__files[args.path] = args.text; return Promise.resolve({ version: 'v-' + args.text.length, size: args.text.length }); }
      if (cmd === 'local_stat') {
        if (args.path in window.__files) return Promise.resolve(fileEntry(args.path));
        if (window.__dirs.includes(args.path)) return Promise.resolve(dirEntry(args.path));
        return Promise.reject('[not-found] ' + args.path);
      }
      if (cmd === 'local_read_text') {
        const text = window.__files[args.path];
        return text === undefined ? Promise.reject('[not-found] ' + args.path) : Promise.resolve({ text, size: text.length, truncated: false, binary: false, lossy: false, version: 'v-' + text.length });
      }
      if (cmd === 'resize_session' || cmd === 'claim_session_size' || cmd === 'write_session') return Promise.resolve(true);
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false, mark_after_secs: 1 }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false } });
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve();
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`;

const VW = 1400;
const VH = 900;
await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: stub() });
await send("Emulation.setDeviceMetricsOverride", { width: VW, height: VH, deviceScaleFactor: 1, mobile: false });
// 새 문서의 부팅 끝까지 — `Page.reload` + `waitBoot` 는 옛 문서를 보고 바로 끝나 ⑨ 에서 "module not loaded yet:
// app/confirm-dialog.svelte.ts" 가 났다(2026-11-21). 쓰는 모듈은 다 기다린다(`S` · `CONF` 포함 — 둘 다 `+page` 가 곧바로 들인다).
await reloadBoot(send, ev);
await send("Page.bringToFront");
await send("Emulation.setFocusEmulationEnabled", { enabled: true });
for (let i = 0; i < 50; i++) {
  if ((await ev(`(async () => { try { await ${W}; await ${S}; await ${SESS}; await ${PANES}; await ${ANCH}; await ${CONF}; return true; } catch { return false; } })()`)) === true) break;
  await sleep(300);
}
await sleep(800);
errors.length = 0;

// ── 도우미 ────────────────────────────────────────────────────────────────────────
/** 지금 탭의 문서 타일들(id · 경로 · 표식) */
const docs = () =>
  evj(`(async () => { const w = await ${W}; const s = await ${S};
    const tab = w.residentWindowTabs().find((t) => t.id === w.activeTabId());
    return JSON.stringify({ count: s.listPanes(tab.root).length, zoomed: tab.zoomedPaneId ?? null,
      docs: s.listPanes(tab.root).filter((p) => p.kind === 'doc').map((p) => ({ id: p.id, path: p.path ?? null, preview: p.docPreview ?? null, files: p.docFiles ?? null, outline: p.docOutline ?? null })) }); })()`);
let cur = null; // 지금 문서 타일 id
/** 지금 문서 타일 = 곁 타일(z.md)이 아닌 문서 — `docs` 에는 그것 하나만 남긴다 */
const refreshCur = async () => {
  const d = await docs();
  d.docs = d.docs.filter((x) => x.path !== Z);
  cur = d.docs[0]?.id ?? null;
  return d;
};
const P = () => `document.querySelector('[data-pane="${cur}"]')`;
const HEAD = () => `document.querySelector('[data-pane-head="${cur}"]')`;
const DOC = () => `${P()}?.querySelector('.doc')`;
const rectOf = (expr) =>
  evj(`(() => { const e = ${expr}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ l: Math.round(b.left * 10) / 10, r: Math.round(b.right * 10) / 10, t: Math.round(b.top), b: Math.round(b.bottom), w: Math.round(b.width * 10) / 10, x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
const filesBtn = () => `${HEAD()}?.querySelector('button[aria-label^="파일"]')`;
const outlineBtn = () => `${HEAD()}?.querySelector('button[aria-label^="목차"]')`;
const refreshBtn = () => `${HEAD()}?.querySelector('button[aria-label="새로고침"]')`;
const PANEL = () => `${P()}?.querySelector('.files-panel')`;
const OPANEL = () => `${P()}?.querySelector('.outline-panel')`;
const BODY = () => `${P()}?.querySelector('.body')`;
/** 파일 칸의 줄들(패널 또는 드롭다운) */
const fileRows = (scope) =>
  evj(`JSON.stringify([...(${scope})?.querySelectorAll('li.row') ?? []].map((li) => ({ name: li.querySelector('.name')?.textContent.trim(), sub: li.querySelector('.sub')?.textContent.trim() ?? null,
    kind: li.classList.contains('up') ? 'up' : li.classList.contains('dir') ? 'dir' : 'file', current: li.getAttribute('aria-current'), active: li.classList.contains('active') })))`);
const filesInfo = (scope) =>
  evj(`(() => { const s = ${scope}; if (!s) return 'null'; return JSON.stringify({ input: !!s.querySelector('input.filter'), value: s.querySelector('input.filter')?.value ?? null,
    where: s.querySelector('.where-name')?.textContent.trim() ?? null, none: s.querySelector('li.none')?.textContent.trim() ?? null,
    foot: [...s.querySelectorAll('.foot p')].map((p) => p.textContent.trim()) }); })()`);
const clickRow = async (scope, name) => {
  const r = await rectOf(`[...(${scope})?.querySelectorAll('li.row') ?? []].find((li) => li.querySelector('.name')?.textContent.trim() === ${JSON.stringify(name)})`);
  if (!r) return false;
  await clickXY(r.x, r.y);
  return true;
};
const clickEl = async (expr) => {
  const r = await rectOf(expr);
  if (!r) return false;
  await clickXY(r.x, r.y);
  return true;
};
/** 타일 폭을 분할 비율로 맞춘다(진짜 배치) — 문서 타일의 `.doc` 폭이 `w` 근처가 되게 */
const setDocW = async (w) => {
  for (let i = 0; i < 3; i++) {
    const got = await evj(`(async () => { const ws = await ${W};
      const tab = ws.residentWindowTabs().find((t) => t.id === ws.activeTabId());
      const root = tab.root; if (root.type !== 'split') return 'null';
      const docEl = ${DOC()}; if (!docEl) return 'null';
      const docW = docEl.getBoundingClientRect().width;
      const inA = root.a.type === 'leaf' && root.a.pane.id === ${JSON.stringify(cur)};
      const share = inA ? root.ratio : 1 - root.ratio;
      const total = docW / share;
      const want = Math.min(0.92, Math.max(0.08, ${w} / total));
      root.ratio = inA ? want : 1 - want;
      return JSON.stringify({ docW, total });
    })()`);
    await sleep(600);
    const now = await ev(`${DOC()}?.getBoundingClientRect().width ?? 0`);
    if (got === "null" || Math.abs(now - w) < 6) return now;
  }
  return await ev(`${DOC()}?.getBoundingClientRect().width ?? 0`);
};
const focusDoc = () =>
  ev(`(async () => { const w = await ${W}; w.focusPane(w.activeTabId(), ${JSON.stringify(cur)}); await new Promise((r) => setTimeout(r, 300)); return true; })()`);
const activeIn = (expr) => ev(`(() => { const s = ${expr}; return !!s && s.contains(document.activeElement); })()`);
const pane = async () => (await docs()).docs.find((d) => d.id === cur) ?? null;
/**
 * 프레임마다 곁 패널 폭(테두리 포함 · 배치 폭 `offsetWidth` — 타일 등장의 크기 변환에 흔들리지 않게)을 적기 시작한다 — `sel` 에 맞는 모든 상자, 없으면 null. `samples()` 로 거둔다.
 * 움직임이 실제로 도는지(0 과 240 사이를 지나는지) · 처음 설 때 첫 프레임부터 240 인지 본다
 */
const startSampling = (sel, ms = 900) =>
  ev(`(() => { window.__samp = []; const t0 = performance.now();
    const f = () => { const els = [...document.querySelectorAll(${JSON.stringify(sel)})];
      window.__samp.push(els.length ? Math.max(...els.map((e) => e.offsetWidth)) : null);
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); };
    requestAnimationFrame(f); return true; })()`);
const samples = async (ms = 1000) => {
  await sleep(ms);
  return evj(`JSON.stringify(window.__samp)`);
};
/** 계산된 바탕색 — 켜진 단추 둘이 같은 강조 면인지 */
const bgOf = (expr) => ev(`(() => { const e = ${expr}; return e ? getComputedStyle(e).backgroundColor : null; })()`);
const TRANSPARENT = "rgba(0, 0, 0, 0)";
/** 포인터를 단추에서 치운다(본문 가운데) — 호버 면이 켬의 강조 면을 덮지 않게 */
const hoverAway = async () => {
  const b = await rectOf(BODY());
  if (b) await hover(b.x, b.y);
  await sleep(150);
};

// ── 문서 a.md 를 시작 화면 곁에 ───────────────────────────────────────────────────
const opened = await ev(`(async () => {
  const w = await ${W}; const s = await ${S}; const p = await ${PANES};
  const tab = w.residentWindowTabs().find((t) => t.id === w.activeTabId());
  const near = s.listPanes(tab.root)[0];
  return p.openDoc({ tabId: tab.id, nearPaneId: near.id, path: ${JSON.stringify(A)} });
})()`);
check("0 문서 타일이 섰다", typeof opened === "string", true);
cur = opened;
// 곁 타일 하나 — a.md 를 잠깐 고정해 z.md 가 옆에 서게 하고(미리 보기 칸을 갈아 끼우지 않게) 다시 미리 보기로
await ev(`(async () => { const p = await ${PANES}; const w = await ${W};
  p.keepDoc(${JSON.stringify(opened)});
  p.openDoc({ tabId: w.activeTabId(), nearPaneId: ${JSON.stringify(opened)}, path: ${JSON.stringify(Z)} });
  p.unkeepDoc(${JSON.stringify(opened)});
  w.focusPane(w.activeTabId(), ${JSON.stringify(opened)});
  return true; })()`);
await sleep(800);
check("0 곁 타일까지 둘", (await docs()).count, 2);
check("0 글이 그려졌다", await waitFor(`!!${P()}?.querySelector('.md-page [data-slug]')`, 8000), true);
await sleep(400);
const wWide = await setDocW(1100);
console.log("wide doc width", wWide);
await focusDoc();

// ① 머리줄 단추 자리
const headPos = () =>
  evj(`(() => { const h = ${HEAD()}; if (!h) return 'null';
    const name = h.querySelector('.pane-name')?.getBoundingClientRect();
    const f = ${filesBtn()}?.getBoundingClientRect(); const o = ${outlineBtn()}?.getBoundingClientRect(); const rf = ${refreshBtn()}?.getBoundingClientRect();
    const bar = ${outlineBtn()}?.closest('.bar');
    const btns = bar ? [...bar.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0) : [];
    return JSON.stringify({ nameR: name ? Math.round(name.right) : null, fL: f ? Math.round(f.left * 10) / 10 : null, oL: o ? Math.round(o.left * 10) / 10 : null, oR: o ? Math.round(o.right * 10) / 10 : null,
      rfR: rf ? Math.round(rf.right) : null, outlineLast: btns.length > 0 && btns[btns.length - 1] === ${outlineBtn()}, headR: Math.round(h.getBoundingClientRect().right),
      fPressed: ${filesBtn()}?.getAttribute('aria-pressed') ?? null, oPressed: ${outlineBtn()}?.getAttribute('aria-pressed') ?? null,
      fDrop: ${filesBtn()}?.classList.contains('side-drop') ?? null, oDrop: ${outlineBtn()}?.classList.contains('side-drop') ?? null }); })()`);
const p0 = await headPos();
console.log("head0", JSON.stringify(p0));
check("① 파일 단추가 이름 바로 뒤(0~16px)", p0 && p0.fL >= p0.nameR - 1 && p0.fL - p0.nameR <= 16, true);
check("① 목차 단추가 새로고침 뒤 · 도구줄 맨 끝", [p0?.oL > p0?.rfR - 1, p0?.outlineLast], [true, true]);
await shot("p1-wide.png");
/** 연 직후의 폭이 0 과 240 사이를 지나 240(+선 1)에 닿는가 — 움직임이 실제로 돈다 */
const grows = (s) => {
  const v = (s ?? []).filter((x) => x !== null);
  const last = v[v.length - 1];
  return [v.some((x) => x > 2 && x < 239), last === 240 || last === 241];
};
await startSampling(".files-panel");
await clickEl(filesBtn());
const sF = await samples();
console.log("files open widths", JSON.stringify(sF));
check("① 파일 패널 열기 — 폭이 0~240 사이를 지나 240 에 닿음(움직임)", grows(sF), [true, true]);
const p1 = await headPos();
await startSampling(".outline-panel");
await clickEl(outlineBtn());
const sO = await samples();
console.log("outline open widths", JSON.stringify(sO));
check("① 목차 패널 열기 — 폭이 0~240 사이를 지나 240 에 닿음(움직임)", grows(sO), [true, true]);
const p2 = await headPos();
console.log("head1", JSON.stringify(p1), "head2", JSON.stringify(p2));
check("① 파일 켬 · 목차 켬 뒤 두 단추 x 그대로", [p1?.fL, p1?.oL, p2?.fL, p2?.oL], [p0?.fL, p0?.oL, p0?.fL, p0?.oL]);
check("① aria-pressed 따라감(파일 켬 → 둘 다 켬)", [p1?.fPressed, p1?.oPressed, p2?.fPressed, p2?.oPressed], ["true", "false", "true", "true"]);
await hoverAway();
const bgF = await bgOf(filesBtn());
const bgO = await bgOf(outlineBtn());
console.log("on bg files", bgF, "outline", bgO);
check("① 켜진 파일 토글 · 켜진 목차 토글의 바탕색이 같다(강조 면)", [bgF === bgO, bgF !== TRANSPARENT && bgF !== null], [true, true]);
await shot("p7-both.png");
// 목차를 끄고 ②부터는 파일만
await clickEl(outlineBtn());
await sleep(400);
const p3 = await headPos();
check("① 목차 끔 뒤 x 그대로", [p3?.fL, p3?.oL], [p0?.fL, p0?.oL]);

// ② 파일 패널
const geo = await evj(`(() => { const d = ${DOC()}.getBoundingClientRect(); const p = ${PANEL()}?.getBoundingClientRect(); const b = ${BODY()}.getBoundingClientRect();
  return JSON.stringify({ dL: Math.round(d.left), pL: p ? Math.round(p.left) : null, pW: p ? Math.round(p.width) : null, pR: p ? Math.round(p.right) : null, bL: Math.round(b.left),
    border: ${PANEL()} ? getComputedStyle(${PANEL()}).borderRightWidth : null }); })()`);
console.log("geo", JSON.stringify(geo));
check("② 파일 패널 — 본문 왼쪽 · 폭 240(+선 1) · 본문이 바로 뒤", [geo?.pL === geo?.dL, geo?.pW === 240 || geo?.pW === 241, geo?.bL === geo?.pR, geo?.border], [true, true, true, "1px"]);
const fi = await filesInfo(PANEL());
check("② 찾기 칸 · 지금 폴더 줄 = notes", [fi?.input, fi?.where], [true, "notes"]);
const r0 = await fileRows(PANEL());
check("② 목록 순서 `..` → 폴더 → 파일 · 그림 · 숨김 없음", r0.map((r) => r.name), ["..", "empty", "sub", "a.md", "b.md", "c.txt"]);
check("② 지금 문서 줄 강조 + aria-current=page", r0.filter((r) => r.current === "page").map((r) => r.name), ["a.md"]);
check("② 지금 문서 줄의 강조 클래스", await ev(`[...${PANEL()}.querySelectorAll('li.row.current')].map((li) => li.querySelector('.name').textContent.trim()).join(',')`), "a.md");
check("② 패널은 <nav aria-label=파일>", await ev(`${PANEL()}?.querySelector('nav')?.getAttribute('aria-label') ?? null`), "파일");
check("② 열어도 포커스가 패널로 가지 않음", await activeIn(PANEL()), false);
check("② 패널 안에 data-tile-focus 없음", await ev(`${PANEL()}.querySelectorAll('[data-tile-focus]').length`), 0);
await shot("p2-files.png");

// ③ 폴더 들어가기 · `..` · 빈 폴더
await clickRow(PANEL(), "sub");
await sleep(400);
check("③ sub 로 들어감", [(await filesInfo(PANEL()))?.where, (await fileRows(PANEL())).map((r) => r.name)], ["sub", ["..", "deep.md"]]);
await clickRow(PANEL(), "..");
await sleep(400);
check("③ `..` 로 notes 복귀", [(await filesInfo(PANEL()))?.where, (await fileRows(PANEL())).length], ["notes", 6]);
await clickRow(PANEL(), "empty");
await sleep(400);
const fe = await filesInfo(PANEL());
const noneAfterUp = await ev(`(() => { const n = ${PANEL()}?.querySelector('li.none'); const p = n?.previousElementSibling;
  return !!n && !!p && p.matches('li.row.up') && n.closest('ul.list') === p.closest('ul.list') && n.getAttribute('role') !== 'option'; })()`);
check(
  "③ 빈 폴더 — `..` 하나 · 빈 폴더 문구는 목록 안 `..` 줄 바로 아래(고를 줄 아님) · 꼬리 줄에는 없음",
  [(await fileRows(PANEL())).map((r) => r.name), fe?.none, noneAfterUp, fe?.foot],
  [[".."], "이 폴더에 문서로 볼 파일이 없습니다", true, []],
);
// ↑↓ 는 문구 줄을 건너뛴다 — 고를 줄은 `..` 하나
await clickEl(`${PANEL()}.querySelector('input.filter')`);
await down();
await down();
check("③ 빈 폴더에서 ↓↓ → 고른 줄은 `..` 그대로(문구 줄은 고르지 않음)", (await fileRows(PANEL())).filter((r) => r.active).map((r) => r.name), [".."]);
await esc();
await shot("p3-empty.png");
await clickRow(PANEL(), "..");
await sleep(400);

// ④ 찾기
const bodyTop0 = await ev(`${BODY()}.scrollTop`);
await clickEl(`${PANEL()}.querySelector('input.filter')`);
await send("Input.insertText", { text: "deep" });
await sleep(700);
const fr = await fileRows(PANEL());
check("④ 찾기 'deep' → deep.md + 흐린 sub", fr.map((r) => [r.name, r.sub]), [["deep.md", "sub"]]);
check("④ 찾기 자료는 list_text_files 로(뿌리 = 지금 폴더)", await evj(`JSON.stringify(window.__calls.filter((c) => c[0] === 'list_text_files').map((c) => c[1].root))`), [DIR]);
await shot("p4-find.png");
await send("Input.insertText", { text: "zzq" });
await sleep(500);
check("④ 맞는 것 없음 문구", (await filesInfo(PANEL()))?.none, "맞는 파일이 없습니다");
await shot("p4-nomatch.png");
await esc();
check("④ Esc → 질의 비움 · 둘러보기 복귀 · 칸에 포커스 그대로", [(await filesInfo(PANEL()))?.value, (await fileRows(PANEL())).length, await activeIn(PANEL())], ["", 6, true]);
await send("Input.insertText", { text: "b" });
await sleep(600);
const fb = await fileRows(PANEL());
console.log("find b", JSON.stringify(fb));
check("④ 'b' → b.md 먼저 · 첫 줄이 고른 줄", [fb[0]?.name, fb[0]?.active], ["b.md", true]);
await down();
const fb2 = await fileRows(PANEL());
await upKey();
const fb3 = await fileRows(PANEL());
check("④ ↓ → 둘째 줄 · ↑ → 첫 줄", [fb2.findIndex((r) => r.active), fb3.findIndex((r) => r.active)], [fb.length > 1 ? 1 : 0, 0]);
check("④ 찾기 칸의 ↑↓ 가 본문을 밀지 않음", await ev(`${BODY()}.scrollTop`), bodyTop0);
check("④ aria-activedescendant 가 고른 줄", await ev(`(() => { const i = ${PANEL()}.querySelector('input.filter'); const id = i.getAttribute('aria-activedescendant'); return !!id && document.getElementById(id)?.classList.contains('active'); })()`), true);
await esc();
await esc();
check("④ Esc 두 번 → 본문(.doc) 포커스", await ev(`document.activeElement === ${DOC()}`), true);

// ⑤ 파일 줄 → 이 타일에서 바뀜
const before = await refreshCur();
const prevMark = before.docs[0].preview;
await startSampling(".files-panel", 1600);
await clickRow(PANEL(), "b.md");
const sSwitch = await samples(1500);
console.log("switch widths", JSON.stringify(sSwitch));
// 새 DocView 가 설 때(이 타일에서 문서 바꾸기) 켜져 있던 패널은 움직이지 않는다 — 보이는 프레임은 모두 240(+선 1)
check(
  "⑤ 새 DocView 의 켜진 파일 패널은 첫 프레임부터 240(움직이지 않음)",
  (sSwitch ?? []).filter((x) => x !== null).every((x) => x === 240 || x === 241) && (sSwitch ?? []).some((x) => x !== null),
  true,
);
const after = await refreshCur();
console.log("switch", JSON.stringify(before), "→", JSON.stringify(after));
check("⑤ 타일 수 그대로 · 문서는 b.md · 새 id", [after.count, after.docs.length, after.docs[0]?.path, after.docs[0]?.id !== before.docs[0].id], [before.count, 1, B, true]);
await waitFor(`!!${P()}?.querySelector('.md-page')`, 4000);
await sleep(300);
check("⑤ 머리줄 이름 = b.md", await ev(`${HEAD()}?.querySelector('.pane-name')?.textContent.trim() ?? null`), "b.md");
check("⑤ 파일 패널 켜진 채(명세 · 화면)", [after.docs[0]?.files, await ev(`!!${PANEL()}`)], [true, true]);
check("⑤ 포커스가 본문(새 타일의 .doc)", await ev(`document.activeElement === ${DOC()}`), true);
check("⑤ 미리 보기 표식 유지", after.docs[0]?.preview, prevMark);
check("⑤ 새 문서 줄 강조", (await fileRows(PANEL())).filter((r) => r.current === "page").map((r) => r.name), ["b.md"]);
await shot("p5-switched.png");
// 지금 문서 다시 고름 = 그대로
const idB = cur;
await clickRow(PANEL(), "b.md");
await sleep(700);
await refreshCur();
check("⑤ 지금 문서를 다시 고름 → 바뀌지 않음 · 본문 포커스", [cur === idB, await ev(`document.activeElement === ${DOC()}`)], [true, true]);
// 고정 → c.txt → 고정 유지
await ev(`(async () => (await ${PANES}).keepDoc(${JSON.stringify(cur)}))()`);
await sleep(300);
await clickRow(PANEL(), "c.txt");
await sleep(1200);
const afterC = await refreshCur();
check("⑤ 고정 문서에서 고름 → c.txt · 고정 유지(표식 없음)", [afterC.docs[0]?.path, afterC.docs[0]?.preview], [C, null]);
check("⑤ 코드 파일에서도 파일 패널 · 파일 단추", [await ev(`!!${PANEL()}`), await ev(`!!${filesBtn()}`)], [true, true]);
await clickRow(PANEL(), "a.md");
await sleep(1200);
await refreshCur();
await waitFor(`!!${P()}?.querySelector('.md-page [data-slug]')`, 4000);
check("⑤ a.md 로 돌아옴", (await pane())?.path, A);
// 같은 파일을 다른 타일이 이미 봄 → 그 타일로 포커스만(바꾸지 않음) · 가는 길에 C:\ 와 합성 루트("내 PC" — 찾기 막힘)
await clickRow(PANEL(), "..");
await sleep(400);
const atC = (await fileRows(PANEL())).map((r) => r.name);
check("⑤ C:\\ — `..`(내 PC) · notes · other", atC, ["..", "notes", "other"]);
await clickRow(PANEL(), "..");
await sleep(500);
const atRoot = await evj(`(() => { const i = ${PANEL()}.querySelector('input.filter'); return JSON.stringify({ ro: i.readOnly, ph: i.placeholder, rows: [...${PANEL()}.querySelectorAll('li.row')].map((li) => li.querySelector('.name').textContent.trim()) }); })()`);
console.log("root", JSON.stringify(atRoot));
check("⑤ 합성 루트 — `..` 없음 · 드라이브 줄 · 찾기 칸 막힘(까닭은 placeholder)", [atRoot?.rows?.[0] !== "..", atRoot?.rows?.length >= 1, atRoot?.ro, atRoot?.ph], [true, true, true, "드라이브 목록에서는 찾지 않습니다"]);
await shot("p5-root.png");
await clickEl(`${PANEL()}.querySelector('li.row')`);
await sleep(400);
await clickRow(PANEL(), "other");
await sleep(400);
const idA = cur;
const zId = (await docs()).docs.find((d) => d.path === Z)?.id;
await clickRow(PANEL(), "z.md");
await sleep(800);
const afterZ = await refreshCur();
const activeZ = await ev(`(async () => { const w = await ${W}; const tab = w.residentWindowTabs().find((t) => t.id === w.activeTabId()); return w.paneOf ? w.paneOf(tab) : null; })()`);
check("⑤ 같은 파일(z.md)을 곁 타일이 봄 → 이 타일은 그대로 · 그 타일로 포커스", [cur === idA, afterZ.docs[0]?.path, afterZ.count, activeZ === null ? "못 잼" : activeZ === zId], [true, A, 2, true]);
if (activeZ === null) unmeasured.push("⑤ 곁 타일 포커스 — paneOf 를 못 불러 못 잼");
await clickRow(PANEL(), "..");
await sleep(400);
await clickRow(PANEL(), "notes");
await sleep(400);
check("⑤ notes 로 돌아옴", (await filesInfo(PANEL()))?.where, "notes");

// ⑥ 목차 패널
await focusDoc();
await clickEl(outlineBtn());
await sleep(600);
const og = await evj(`(() => { const d = ${DOC()}.getBoundingClientRect(); const o = ${OPANEL()}?.getBoundingClientRect(); const b = ${BODY()}.getBoundingClientRect();
  return JSON.stringify({ dR: Math.round(d.right), oR: o ? Math.round(o.right) : null, oL: o ? Math.round(o.left) : null, oW: o ? Math.round(o.width) : null, bR: Math.round(b.right),
    border: ${OPANEL()} ? getComputedStyle(${OPANEL()}).borderLeftWidth : null }); })()`);
console.log("outline geo", JSON.stringify(og));
check("⑥ 목차 패널 — 본문 오른쪽 · 폭 240(+선 1) · border-left 1px", [og?.oR === og?.dR, og?.oW === 240 || og?.oW === 241, og?.bR === og?.oL, og?.border], [true, true, true, "1px"]);
const orow = await rectOf(`[...${OPANEL()}.querySelectorAll('li.row')].find((li) => li.textContent.trim() === '셋')`);
if (orow) {
  await clickXY(orow.x, orow.y);
  await sleep(700);
  const hd = await evj(`(() => { const b = ${BODY()}; const h = [...b.querySelectorAll('[data-slug]')].find((e) => e.textContent.trim() === '셋'); if (!h) return 'null';
    return JSON.stringify({ scroll: Math.round(b.scrollTop), off: Math.round(h.getBoundingClientRect().top - b.getBoundingClientRect().top) }); })()`);
  check("⑥ 목차 줄 '셋' → 그 제목이 본문 맨 위(0~40px)", [hd?.scroll > 0, hd?.off >= -2 && hd?.off <= 40], [true, true]);
} else {
  check("⑥ 목차 줄 '셋' 이 있다", false, true);
}
await shot("p6-outline.png");

// ⑦ 둘 다 · 중간 폭
// 지금: 파일 켬 · 목차 켬 · 넓음(1100) → 둘 다
const both = await evj(`JSON.stringify({ f: !!${PANEL()}, o: !!${OPANEL()} })`);
check("⑦ 넓은 타일(≥882) — 둘 다 보임", [both.f, both.o], [true, true]);
const wMid = await setDocW(760);
console.log("mid doc width", wMid);
await sleep(300);
const mid = await headPos();
check("⑦ 760px 로 줄임 — 나중에 연 목차만 보임 · aria-pressed 따라감", [await ev(`!!${PANEL()}`), await ev(`!!${OPANEL()}`), mid?.fPressed, mid?.oPressed], [false, true, "false", "true"]);
check("⑦ 줄여서 숨긴 것은 명세 그대로(파일 켬 유지)", (await pane())?.files, true);
await shot("p7-mid.png");
await setDocW(1100);
await sleep(300);
check("⑦ 다시 넓히면 둘 다 돌아옴", [await ev(`!!${PANEL()}`), await ev(`!!${OPANEL()}`)], [true, true]);
await setDocW(760);
await sleep(300);
await focusDoc();
await clickEl(filesBtn());
await sleep(500);
const mid2 = await headPos();
const pm2 = await pane();
check("⑦ 760px 에서 파일을 엶 → 목차가 명세에서도 꺼짐 · 파일만", [await ev(`!!${PANEL()}`), await ev(`!!${OPANEL()}`), pm2?.files, pm2?.outline, mid2?.fPressed, mid2?.oPressed], [true, false, true, null, "true", "false"]);
await clickEl(outlineBtn());
await sleep(500);
const mid3 = await headPos();
const pm3 = await pane();
check("⑦ 다시 목차를 엶 → 파일이 꺼짐", [await ev(`!!${PANEL()}`), await ev(`!!${OPANEL()}`), pm3?.files, pm3?.outline, mid3?.fPressed, mid3?.oPressed], [false, true, null, true, "false", "true"]);
// 파일을 다시 켜 두고(목차는 꺼진다) ⑧로
await clickEl(filesBtn());
await sleep(400);

// ⑧ 좁은 타일
const pWide = p0;
const wNarrow = await setDocW(520);
console.log("narrow doc width", wNarrow);
await focusDoc();
await sleep(300);
const pn = await headPos();
console.log("narrow head", JSON.stringify(pn));
check("⑧ 좁은 타일 — 두 단추가 드롭다운 단추(그림 + ▾)", [pn?.fDrop, pn?.oDrop], [true, true]);
check("⑧ 파일 드롭다운 단추 x = 넓을 때 토글 x(이름 뒤 같은 자리)", Math.abs((pn?.fL ?? 0) - (pWide?.fL ?? 0)) <= 1, true);
check("⑧ 목차 드롭다운 단추는 여전히 도구줄 맨 끝 · 머리줄 오른쪽 간격 그대로", [pn?.outlineLast, Math.abs((pn?.headR - pn?.oR) - (pWide?.headR - pWide?.oR)) <= 1], [true, true]);
check("⑧ 곁 패널 없음", [await ev(`!!${PANEL()}`), await ev(`!!${OPANEL()}`)], [false, false]);
await shot("p8-narrow.png");
await clickEl(filesBtn());
await sleep(500);
const POP = `document.querySelector('.files-pop')`;
const pop = await rectOf(POP);
const fbtn = await rectOf(filesBtn());
console.log("files pop", JSON.stringify(pop), "btn", JSON.stringify(fbtn));
check("⑧ 파일 드롭다운 열림 · 화면 안 · 단추 왼쪽 변 맞춤", [!!pop, pop && pop.l >= 0 && pop.r <= VW && pop.b <= VH, pop && Math.abs(pop.l - fbtn.l) <= 1], [true, true, true]);
check("⑧ 드롭다운이 열리면 찾기 칸에 포커스", await ev(`document.activeElement === ${POP}?.querySelector('input.filter')`), true);
check("⑧ 드롭다운 단추 aria-expanded", await ev(`${filesBtn()}?.getAttribute('aria-expanded')`), "true");
const bgFDrop = await bgOf(filesBtn());
check("⑧ 드롭다운 목록", (await fileRows(POP)).map((r) => r.name), ["..", "empty", "sub", "a.md", "b.md", "c.txt"]);
await shot("p8-files-drop.png");
await clickRow(POP, "sub");
await sleep(400);
check("⑧ 폴더 누름 → 닫히지 않고 들어감", [await ev(`!!${POP}`), (await fileRows(POP)).map((r) => r.name)], [true, ["..", "deep.md"]]);
await clickRow(POP, "..");
await sleep(400);
const nb = await docs();
await clickRow(POP, "b.md");
await sleep(1200);
const na = await refreshCur();
check("⑧ 파일 고름 → 드롭다운 닫힘 · 이 타일에서 b.md", [await ev(`!!${POP}`), na.count, na.docs[0]?.path], [false, nb.count, B]);
await waitFor(`!!${P()}?.querySelector('.md-page')`, 4000);
// a.md 로 되돌린다 — 드롭다운으로
await focusDoc();
await clickEl(filesBtn());
await sleep(500);
await clickRow(POP, "a.md");
await sleep(1200);
await refreshCur();
await waitFor(`!!${P()}?.querySelector('.md-page [data-slug]')`, 4000);
await focusDoc();
await sleep(300);
// 목차 드롭다운
await clickEl(outlineBtn());
await sleep(500);
const OPOP = `document.querySelector('.outline-pop')`;
const opop = await rectOf(OPOP);
const obtn = await rectOf(outlineBtn());
console.log("outline pop", JSON.stringify(opop), "btn", JSON.stringify(obtn));
check("⑧ 목차 드롭다운 열림 · 화면 안 · 단추 오른쪽 변 맞춤", [!!opop, opop && opop.l >= 0 && opop.r <= VW && opop.b <= VH, opop && Math.abs(opop.r - obtn.r) <= 1], [true, true, true]);
const bgODrop = await bgOf(outlineBtn());
console.log("drop open bg files", bgFDrop, "outline", bgODrop);
check("⑧ 열린 파일 드롭다운 단추 · 열린 목차 드롭다운 단추의 바탕색이 같고 켜진 토글과도 같다", [bgFDrop === bgODrop, bgFDrop === bgF, bgODrop !== TRANSPARENT], [true, true, true]);
await shot("p8-outline-drop.png");
// 목차가 열린 채 파일 단추를 진짜 마우스로 — 바깥 막(backdrop)이 먼저 받는다: 어느 쪽이든 둘이 함께 열려 있으면 안 된다
await clickEl(filesBtn());
await sleep(500);
const oneA = await evj(`JSON.stringify({ f: !!${POP}, o: !!${OPOP} })`);
console.log("after mouse on files while outline open", JSON.stringify(oneA));
check("⑧ 목차가 열린 채 파일 단추 누름 → 둘이 함께 열려 있지 않음 · 목차 닫힘", [oneA.f && oneA.o, oneA.o], [false, false]);
// 손잡이로 — 파일 드롭다운이 열린 채 목차 단추(요소 click — 바깥 막을 지나지 않는 키보드 길과 같다)
if (!oneA.f) {
  await ev(`${filesBtn()}.click()`);
  await sleep(400);
}
await ev(`${outlineBtn()}.click()`);
await sleep(400);
const oneB = await evj(`JSON.stringify({ f: !!${POP}, o: !!${OPOP} })`);
check("⑧ 파일 드롭다운이 열린 채 목차 단추 → 파일 닫히고 목차 열림", [oneB.f, oneB.o], [false, true]);
await ev(`${OPOP}?.querySelector('input')?.focus()`);
await esc();
await sleep(200);
check("⑧ 목차 드롭다운 Esc 로 닫힘 · 단추로 포커스", [await ev(`!!${OPOP}`), await ev(`document.activeElement === ${outlineBtn()}`)], [false, true]);
await clickEl(filesBtn());
await sleep(400);
await esc();
await sleep(200);
check("⑧ 파일 드롭다운 Esc(질의 없음) 로 닫힘 · 단추로 포커스", [await ev(`!!${POP}`), await ev(`document.activeElement === ${filesBtn()}`)], [false, true]);
await clickEl(filesBtn());
await sleep(400);
await send("Input.insertText", { text: "deep" });
await sleep(600);
await esc();
check("⑧ 파일 드롭다운 — 질의가 있으면 Esc 는 비우기만(열린 채)", [await ev(`!!${POP}`), (await filesInfo(POP))?.value], [true, ""]);
await esc();
// 넓히면 드롭다운이 닫힌다
await clickEl(filesBtn());
await sleep(300);
await setDocW(1100);
await sleep(300);
check("⑧ 넓어지면 드롭다운 닫힘", await ev(`!!${POP}`), false);

// ⑨ 편집 중 저장 안 한 변경 → 고름 → 확인
await ev(`(async () => (await ${ANCH}).setDocEdit(${JSON.stringify(cur)}))()`);
check("⑨ 편집 상태(편집기)", await waitFor(`!!${P()}?.querySelector('.cm-content')`, 8000), true);
await sleep(500);
await ev(`${P()}.querySelector('.cm-content').focus()`);
await send("Input.insertText", { text: "x" });
await sleep(500);
check("⑨ 편집 중에도 파일 패널", await ev(`!!${PANEL()}`), true);
const idEdit = cur;
const ops0 = await ev(`window.__fileOps.length`);
await clickRow(PANEL(), "b.md");
await sleep(600);
const cq = await evj(`(async () => { const c = (await ${CONF}).currentConfirm(); return JSON.stringify(c ? c.choices.map((x) => x.label) : null); })()`);
check("⑨ 확인 상자 — [취소] · [버리고 열기] · [저장하고 열기]", cq, ["취소", "버리고 열기", "저장하고 열기"]);
await shot("p9-confirm.png");
await ev(`(async () => (await ${CONF}).answerConfirm('Cancel'))()`);
await sleep(700);
await refreshCur();
check("⑨ [취소] → 문서 그대로(같은 타일 · a.md · 편집 중)", [cur === idEdit, (await pane())?.path, await ev(`!!${P()}?.querySelector('.cm-content')`)], [true, A, true]);
await clickRow(PANEL(), "b.md");
await sleep(600);
const cq2 = await evj(`(async () => { const c = (await ${CONF}).currentConfirm(); return JSON.stringify(c ? c.choices.map((x) => x.label) : null); })()`);
check("⑨ 다시 고름 → 다시 물음", Array.isArray(cq2), true);
await ev(`(async () => (await ${CONF}).answerConfirm('No'))()`);
await sleep(1200);
await refreshCur();
check("⑨ [버리고 열기] → b.md 로 바뀜 · 쓰기 없음", [cur !== idEdit, (await pane())?.path, await evj(`JSON.stringify(window.__fileOps.slice(${ops0}))`)], [true, B, []]);

// ⑩ 최대화 유지
const zoomed = await evj(`(async () => { const w = await ${W}; w.toggleZoom(w.activeTabId(), ${JSON.stringify(cur)}); await new Promise((r) => setTimeout(r, 600));
  const tab = w.residentWindowTabs().find((t) => t.id === w.activeTabId()); return JSON.stringify(tab.zoomedPaneId ?? null); })()`);
check("⑩ 최대화", zoomed, cur);
await waitFor(`!!${PANEL()}`, 3000);
await clickRow(PANEL(), "c.txt");
await sleep(1200);
const z2 = await refreshCur();
check("⑩ 최대화한 타일에서 고름 → 새 타일이 최대화 이어받음", [z2.docs[0]?.path, z2.zoomed === cur && cur !== null], [C, true]);
await shot("p10-zoomed.png");
await ev(`(async () => { const w = await ${W}; w.toggleZoom(w.activeTabId(), ${JSON.stringify(cur)}); return true; })()`);
await sleep(500);

// ⑫ 문서 → 문서 갈아 끼우기(2026-11-20 — 사용자 B 안): 타일 등장 없음 · 본문만 떠오름 · 파일 칸(폴더 · 찾기 글 · 결과 · 스크롤) 그대로
/**
 * 프레임마다 문서 타일 상자(곁 타일 제외)를 적는다 — id · 상자 투명도 · 변환 · 상자에 도는 애니메이션 수 · 본문(.body) 애니메이션 · 투명도 ·
 * 파일 목록 스크롤 · "읽는 중" 문구 줄. `swapFrames()` 로 거둔다
 */
const startSwapSampling = async (ms = 900) => {
  const zId = (await docs()).docs.find((d) => d.path === Z)?.id ?? "";
  return ev(`(() => { window.__sw = []; const t0 = performance.now(); const zId = ${JSON.stringify(zId)};
    const f = () => {
      for (const el of document.querySelectorAll('[data-pane]')) {
        const id = el.getAttribute('data-pane'); if (id === zId || !el.querySelector('.doc')) continue;
        const box = el.closest('.pane-box') ?? el; const cs = getComputedStyle(box); const body = el.querySelector('.body');
        const list = el.querySelector('.files-panel ul.list'); const none = el.querySelector('.files-panel li.none')?.textContent.trim() ?? null;
        window.__sw.push({ t: Math.round(performance.now() - t0), id, op: cs.opacity, tin: cs.getPropertyValue('--tile-in').trim(), tf: cs.transform,
          anims: box.getAnimations().length, bodyAnims: body ? body.getAnimations().length : null, bodyOp: body ? getComputedStyle(body).opacity : null,
          scroll: list ? Math.round(list.scrollTop) : null, none, pop: !!document.querySelector('.files-pop') });
      }
      if (performance.now() - t0 < ${ms}) requestAnimationFrame(f); };
    requestAnimationFrame(f); return true; })()`);
};
const swapFrames = async (ms = 1000) => {
  await sleep(ms);
  return evj(`JSON.stringify(window.__sw)`);
};
/** 새 타일(`id`)의 프레임들 — 상자 애니메이션 0 · 투명도 1 · 변환 없음 */
const noTileIn = (frames, id) => {
  const mine = (frames ?? []).filter((f) => f.id === id);
  return [mine.length > 0, mine.every((f) => f.anims === 0 && f.op === "1" && (f.tin === "" || f.tin === "1") && (f.tf === "none" || f.tf === "matrix(1, 0, 0, 1, 0, 0)"))];
};
/** 본문이 떠올랐는가 — 어느 프레임에서 본문에 애니메이션이 돌았고 투명도가 1 보다 작았다 */
const bodyFaded = (frames, id) => {
  const mine = (frames ?? []).filter((f) => f.id === id);
  return mine.some((f) => (f.bodyAnims ?? 0) > 0) && mine.some((f) => f.bodyOp !== null && Number(f.bodyOp) < 1);
};
const listScroll = () => ev(`${PANEL()}?.querySelector('ul.list')?.scrollTop ?? null`);
const setListScroll = async (y) => {
  await ev(`(() => { const l = ${PANEL()}.querySelector('ul.list'); l.scrollTop = ${y}; l.dispatchEvent(new Event('scroll')); return true; })()`);
  await sleep(250);
  return Math.round(await listScroll());
};
/** 목록 상자 안에 다 보이는 줄 하나(가운데쯤)의 이름 */
const midVisibleRow = () =>
  ev(`(() => { const l = ${PANEL()}.querySelector('ul.list'); const lb = l.getBoundingClientRect();
    const vis = [...l.querySelectorAll('li.row')].filter((li) => { const b = li.getBoundingClientRect(); return b.top >= lb.top && b.bottom <= lb.bottom && !li.classList.contains('current'); });
    return vis[Math.floor(vis.length / 2)]?.querySelector('.name')?.textContent.trim() ?? null; })()`);

await refreshCur();
await focusDoc();
if (!(await ev(`!!${PANEL()}`))) await clickEl(filesBtn());
await settle();
// notes → C:\ → other → many 로 옮긴다
await clickRow(PANEL(), "..");
await sleep(300);
await clickRow(PANEL(), "other");
await sleep(300);
await clickRow(PANEL(), "many");
await sleep(500);
check("⑫ 긴 폴더 many 로 옮김(40장)", [(await filesInfo(PANEL()))?.where, (await fileRows(PANEL())).length], ["many", 41]);
// (a)(c)(b-스크롤) 스크롤해 두고 보이는 줄 하나를 고른다
const sc1 = await setListScroll(260);
check("⑫ 목록이 밀렸다(260)", sc1 > 200, true);
const rowsBefore1 = (await fileRows(PANEL())).map((r) => r.name);
const pick1 = await midVisibleRow();
const id1 = cur;
const lists0 = await ev(`window.__lists.length`);
await startSwapSampling(900);
await clickRow(PANEL(), pick1);
const fr1 = await swapFrames(1000);
const af1 = await refreshCur();
console.log("swap1 pick", pick1, "frames", fr1?.length, "new", cur);
check("⑫ (a) 파일 칸에서 고름 → 새 id · 고른 문서", [cur !== id1, af1.docs[0]?.path], [true, `${MANY}\\${pick1}`]);
check("⑫ (a) 새 타일 상자에 등장 애니메이션 없음(애니메이션 0 · 투명도 1 · 변환 없음 — 모든 프레임)", noTileIn(fr1, cur), [true, true]);
const mine1 = (fr1 ?? []).filter((f) => f.id === cur);
check("⑫ (c) 옮긴 폴더가 남는다(many)", (await filesInfo(PANEL()))?.where, "many");
check("⑫ (b) 목록 줄 그대로 · 고른 줄만 강조가 옮겨 감", [(await fileRows(PANEL())).map((r) => r.name), (await fileRows(PANEL())).filter((r) => r.current === "page").map((r) => r.name)], [rowsBefore1, [pick1]]);
check("⑫ (b) 스크롤 그대로 — 새 목록의 모든 프레임이 넘겨받은 값(0 으로 가는 프레임 없음)", [Math.round(await listScroll()), mine1.filter((f) => f.scroll !== null).every((f) => f.scroll === sc1)], [sc1, true]);
check("⑫ (b) \"읽는 중\" 문구가 한 프레임도 없다", mine1.some((f) => f.none !== null), false);
check("⑫ (b) 같은 폴더를 다시 읽어도 줄을 비우지 않았다(다시 읽기 횟수는 상관없음 — 줄은 위에서 봄)", (await ev(`window.__lists.length`)) >= lists0, true);
check("⑫ (d) 본문이 새 문서를 그림", await waitFor(`${P()}?.querySelector('.md-page h1')?.textContent.includes(${JSON.stringify(pick1.replace(".md", "").toUpperCase())}) === true`, 4000), true);
const fade1 = bodyFaded(fr1, cur);
console.log("body fade frames", JSON.stringify(mine1.slice(0, 12).map((f) => [f.t, f.bodyAnims, f.bodyOp])));
check("⑫ (d) 본문만 떠올랐다(본문 애니메이션 · 투명도 < 1 인 프레임)", fade1, true);
check("⑫ 포커스가 본문(새 타일의 .doc)", await ev(`document.activeElement === ${DOC()}`), true);
// (b-찾기) 찾기 글 'f' → 40개 결과 · 밀어 두고 고른다
await clickEl(`${PANEL()}.querySelector('input.filter')`);
await send("Input.insertText", { text: "f" });
await sleep(800);
const hitsBefore = (await fileRows(PANEL())).map((r) => [r.name, r.sub]);
check("⑫ 찾기 'f' → 결과 줄 여럿(40)", hitsBefore.length, 40);
const sc2 = await setListScroll(300);
const pick2 = await midVisibleRow();
const scans0 = await ev(`window.__calls.filter((c) => c[0] === 'list_text_files').length`);
const id2 = cur;
await startSwapSampling(900);
await clickRow(PANEL(), pick2);
const fr2 = await swapFrames(1000);
const af2 = await refreshCur();
const mine2 = (fr2 ?? []).filter((f) => f.id === cur);
console.log("swap2 pick", pick2, "new", cur);
check("⑫ (b) 찾는 중 고름 → 바뀜", [cur !== id2, af2.docs[0]?.path], [true, `${MANY}\\${pick2}`]);
check("⑫ (a) 찾는 중 고른 경우도 등장 애니메이션 없음", noTileIn(fr2, cur), [true, true]);
check("⑫ (b) 찾기 글 · 결과 줄 · 스크롤 그대로", [(await filesInfo(PANEL()))?.value, (await fileRows(PANEL())).map((r) => [r.name, r.sub]), Math.round(await listScroll())], ["f", hitsBefore, sc2]);
check("⑫ (b) 새 목록의 모든 프레임이 넘겨받은 스크롤", mine2.filter((f) => f.scroll !== null).every((f) => f.scroll === sc2), true);
check("⑫ (b) 찾기 자료를 다시 훑지 않았다(넘겨받음)", await ev(`window.__calls.filter((c) => c[0] === 'list_text_files').length`), scans0);
check("⑫ (d) 본문이 새 문서를 그림", await waitFor(`${P()}?.querySelector('.md-page h1')?.textContent.includes(${JSON.stringify(pick2.replace(".md", "").toUpperCase())}) === true`, 4000), true);
check("⑫ (d) 본문만 떠올랐다", bodyFaded(fr2, cur), true);
await shot("p12-swapped.png");
// 찾기 글을 비우고 notes 로 돌아간다
await clickEl(`${PANEL()}.querySelector('input.filter')`);
await esc();
await esc();
// 파일 타일 길(openDoc 의 replace) — 미리 보기 곁 타일(z.md)을 갈아 끼운다: 등장 없음 · 본문 떠오름
const zPrev = (await docs()).docs.find((d) => d.path === Z);
if (zPrev?.preview) {
  await startSwapSampling(900);
  // 표본은 곁 타일을 빼므로 그 id 를 지금 읽어 둔 채 — 새 id 는 곁 타일이 아니다
  const newId = await ev(`(async () => { const p = await ${PANES}; const w = await ${W};
    return p.openDoc({ tabId: w.activeTabId(), nearPaneId: ${JSON.stringify(cur)}, path: ${JSON.stringify(`${MANY}\\${manyName(7)}`)} }); })()`);
  const fr3 = await swapFrames(1000);
  const replaced = (await docs()).docs.find((d) => d.id === newId);
  check("⑫ openDoc 의 replace(미리 보기 곁 타일) — 그 칸이 f07 로 · 새 id", [!!replaced, replaced?.path, newId !== zPrev.id], [true, `${MANY}\\${manyName(7)}`, true]);
  check("⑫ openDoc 의 replace — 등장 애니메이션 없음", noTileIn(fr3, newId), [true, true]);
  check("⑫ openDoc 의 replace — 본문만 떠올랐다", bodyFaded(fr3, newId), true);
} else {
  unmeasured.push("⑫ openDoc 의 replace — 곁 타일이 미리 보기가 아니라 못 잼");
}

// ⑬ 좁은 타일(<640 — 파일 드롭다운)에서 골라 문서 바꾸기(2026-11-20): 드롭다운이 닫힌 채 새 문서 · 등장 애니메이션 없음 · 본문만 떠오름 ·
//    다시 열면 넘겨받은 폴더 · 스크롤 · 고른 줄(둘러보기) / 폴더 · 찾기 글 · 결과(찾기 — 하위 폴더 파일이라 넘겨받지 않았다면 그 파일의 폴더로 선다)
// 곁 타일은 ⑫ 의 openDoc replace 뒤 z.md 가 아닐 수 있다 — 지금 문서(`cur`)가 아닌 문서 타일을 곁 타일로 본다
const sideId13 = (await docs()).docs.find((d) => d.id !== cur)?.id ?? null;
const refreshCur13 = async () => {
  const d = await docs();
  d.docs = d.docs.filter((x) => x.id !== sideId13);
  cur = d.docs[0]?.id ?? null;
  return d;
};
const POP13 = `document.querySelector('.files-pop')`;
const popScroll = () => ev(`${POP13}?.querySelector('ul.list')?.scrollTop ?? null`);
const setPopScroll = async (y) => {
  await ev(`(() => { const l = ${POP13}.querySelector('ul.list'); l.scrollTop = ${y}; l.dispatchEvent(new Event('scroll')); return true; })()`);
  await sleep(250);
  return Math.round(await popScroll());
};
const midVisibleInPop = () =>
  ev(`(() => { const l = ${POP13}.querySelector('ul.list'); const lb = l.getBoundingClientRect();
    const vis = [...l.querySelectorAll('li.row')].filter((li) => { const b = li.getBoundingClientRect(); return b.top >= lb.top && b.bottom <= lb.bottom && !li.classList.contains('current') && !li.classList.contains('up') && !li.classList.contains('dir'); });
    return vis[Math.floor(vis.length / 2)]?.querySelector('.name')?.textContent.trim() ?? null; })()`);
/** 드롭다운이 DOM 에 들어오는 순간부터 목록 상자의 scrollTop · scrollHeight · clientHeight 를 적는다(들어온 즉시 + 10 프레임) — `popMountLog()` 로 거둔다 */
const watchPopMount = () =>
  ev(`(() => { window.__pm = []; const rec = (tag) => { const l = document.querySelector('.files-pop ul.list'); window.__pm.push(l ? [tag, Math.round(l.scrollTop), l.scrollHeight, l.clientHeight] : [tag, null]); };
    const mo = new MutationObserver(() => { if (!document.querySelector('.files-pop')) return; mo.disconnect(); rec('mut'); queueMicrotask(() => rec('micro'));
      let n = 0; const f = () => { rec('raf' + n); if (++n < 10) requestAnimationFrame(f); }; requestAnimationFrame(f); });
    mo.observe(document.body, { childList: true, subtree: true }); return true; })()`);
const popMountLog = () => evj(`JSON.stringify(window.__pm ?? null)`);
const openPop = async () => {
  for (let i = 0; i < 2 && !(await ev(`!!${POP13}`)); i++) {
    const hit = await clickEl(filesBtn());
    await sleep(400);
    if (!(await ev(`!!${POP13}`)))
      console.log("⑬ openPop miss", i, "btn", hit, await ev(`JSON.stringify({ exp: ${filesBtn()}?.getAttribute('aria-expanded') ?? null, drop: ${filesBtn()}?.classList.contains('side-drop') ?? null, w: ${DOC()}?.getBoundingClientRect().width ?? null })`));
  }
  return await ev(`!!${POP13}`);
};
await refreshCur13();
const w13 = await setDocW(520);
console.log("⑬ narrow doc width", w13, "side", sideId13, "cur", cur);
await focusDoc();
await sleep(300);
check("⑬ 520px — 파일 단추가 드롭다운 단추 · 곁 패널 없음", [(await headPos())?.fDrop, await ev(`!!${PANEL()}`)], [true, false]);
// (1) 둘러보기 — many 로 다시 들어가 목록을 밀어 두고 고른다
check("⑬ 파일 드롭다운 열림", await openPop(), true);
await clickRow(POP13, "..");
await sleep(400);
await clickRow(POP13, "many");
await sleep(500);
check("⑬ 드롭다운에서 many 로 옮김(40장)", [(await filesInfo(POP13))?.where, (await fileRows(POP13)).length], ["many", 41]);
const sc13 = await setPopScroll(260);
check("⑬ 드롭다운 목록이 밀렸다", sc13 > 200, true);
const pick13 = await midVisibleInPop();
const rowsBefore13 = (await fileRows(POP13)).map((r) => r.name);
const id13a = cur;
await startSwapSampling(900);
await clickRow(POP13, pick13);
const fr13 = await swapFrames(1000);
const af13 = await refreshCur13();
const mine13 = (fr13 ?? []).filter((f) => f.id === cur);
console.log("⑬ pick", pick13, "new", cur, "frames", mine13.length, "pop frames", JSON.stringify(mine13.slice(0, 8).map((f) => [f.t, f.pop])),
  "panel-list frames(새 타일에 곁 패널 목록이 그려진 프레임)", mine13.filter((f) => f.scroll !== null).length, "spec files", af13.docs[0]?.files);
// 새 DocView 는 폭을 재기 전(폭 0 = 넓은 쪽으로 봄) 첫 그리기에 명세의 파일 패널 켬을 따라 곁 패널(DocFiles)을 세울 수 있다 — 이번에는
// 고치지 않는 항목이라(그 전부터 있던 동작 · 폭 0 을 좁다고 보면 숨은 탭에서 패널이 내려간다) 본 값만 적는다. 스크롤은 컨트롤러가 기억하므로
// 그 칸이 잠깐 서도 나중 드롭다운의 스크롤은 남는다(아래 "다시 열면 넘겨받은 스크롤")
observe("⑬ 좁은 새 타일에 곁 패널 목록(.files-panel)이 선 rAF 프레임 수 · 그 프레임들의 scrollTop", [
  mine13.filter((f) => f.scroll !== null).length,
  mine13.filter((f) => f.scroll !== null).map((f) => f.scroll),
]);
check("⑬ (둘러보기) 드롭다운에서 고름 → 새 id · 고른 문서", [cur !== id13a, af13.docs[0]?.path], [true, `${MANY}\\${pick13}`]);
check("⑬ 새 타일이 선 모든 프레임에서 드롭다운이 닫혀 있다 · 지금도 닫힘", [mine13.length > 0 && mine13.every((f) => f.pop === false), await ev(`!!${POP13}`)], [true, false]);
check("⑬ 새 타일 상자에 등장 애니메이션 없음(애니메이션 0 · 투명도 1 · 변환 없음 — 모든 프레임)", noTileIn(fr13, cur), [true, true]);
check("⑬ 본문이 새 문서를 그림", await waitFor(`${P()}?.querySelector('.md-page h1')?.textContent.includes(${JSON.stringify(pick13.replace(".md", "").toUpperCase())}) === true`, 4000), true);
check("⑬ 본문만 떠올랐다(본문 애니메이션 · 투명도 < 1 인 프레임)", bodyFaded(fr13, cur), true);
check("⑬ 새 타일도 드롭다운 단추(좁은 타일 그대로)", (await headPos())?.fDrop, true);
await shot("p13-narrow-swapped.png");
// 다시 열기 — 넘겨받은 폴더 · 줄 · 스크롤 · 고른 줄 강조
await watchPopMount();
check("⑬ 드롭다운 다시 열림", await openPop(), true);
console.log("⑬ reopen mount log [tag, scrollTop, scrollHeight, clientHeight]", JSON.stringify(await popMountLog()));
const re13 = { where: (await filesInfo(POP13))?.where, rows: (await fileRows(POP13)).map((r) => r.name), scroll: Math.round((await popScroll()) ?? -1), current: (await fileRows(POP13)).filter((r) => r.current === "page").map((r) => r.name) };
console.log("⑬ reopen", JSON.stringify({ ...re13, rows: re13.rows.length }));
check("⑬ 다시 열면 넘겨받은 폴더(many) · 같은 줄 · 고른 줄만 강조", [re13.where, JSON.stringify(re13.rows) === JSON.stringify(rowsBefore13), re13.current], ["many", true, [pick13]]);
// mount log — 드롭다운이 DOM 에 든 순간(mut · micro)과 이후 프레임의 scrollTop. 넘겨받은 값이 섰다가 0 으로 가면 "선 뒤 밀림",
// 처음부터 0 이면 "씨앗을 이미 누가 꺼내 감"
check("⑬ 다시 열면 넘겨받은 스크롤(닫기 전 값 — 커밋 노트의 \"스크롤이 새 타일에 그대로\")", re13.scroll, sc13);
check("⑬ 다시 연 드롭다운이 든 뒤 10 프레임 내내 그 스크롤(선 뒤 밀리지 않음)",
  ((await popMountLog()) ?? []).filter((r) => r[1] !== null).every((r) => r[1] === sc13), true);
await shot("p13-narrow-reopen.png");
// 같은 타일에서 닫았다 다시 열어도 그 스크롤 — 칸은 설 때마다 컨트롤러가 기억하는 값으로 선다
await esc();
check("⑬ Esc(찾기 글 없음) → 드롭다운 닫힘", await ev(`!!${POP13}`), false);
check("⑬ 닫았다 다시 열어도 스크롤 그대로", [await openPop(), Math.round((await popScroll()) ?? -1)], [true, sc13]);
// ↑↓ — 고른 줄이 바뀌면 그 줄이 목록 상자 안에 보인다(키를 눌렀을 때만 민다)
const activeInfo = () =>
  evj(`(() => { const l = ${POP13}?.querySelector('ul.list'); const a = l?.querySelector('li.row.active'); if (!a) return JSON.stringify(null);
    const lb = l.getBoundingClientRect(); const b = a.getBoundingClientRect();
    return JSON.stringify({ name: a.querySelector('.name')?.textContent.trim() ?? null, visible: b.top >= lb.top - 1 && b.bottom <= lb.bottom + 1, scroll: Math.round(l.scrollTop) }); })()`);
await ev(`${POP13}.querySelector('input.filter').focus()`);
const beforeKey13 = await activeInfo();
await down();
const afterDown13 = await activeInfo();
console.log("⑬ ↓ before", JSON.stringify(beforeKey13), "after", JSON.stringify(afterDown13));
check("⑬ ↓ 로 고른 줄이 목록 상자 안에 보인다", [afterDown13?.name !== beforeKey13?.name, afterDown13?.visible], [true, true]);
await upKey();
const afterUp13 = await activeInfo();
check("⑬ ↑ 로 고른 줄도 보인다", afterUp13?.visible, true);
// 폴더를 옮기면 맨 위 — 밀어 둔 채 `..` 로 나갔다 many 로 다시 들어온다(40장이라 0 이 줄 수에 눌려 생긴 값이 아니다)
// (`..` 줄은 밀어 둔 위쪽에 가려 있다 — 좌표 클릭 대신 줄의 click 으로 같은 `fc.pick` 을 부른다)
await setPopScroll(260);
await ev(`${POP13}.querySelector('li.row.up').click()`);
await sleep(400);
await clickRow(POP13, "many");
await sleep(500);
check("⑬ 폴더를 옮기면 목록 맨 위(나갔다 many 로 다시)", [(await filesInfo(POP13))?.where, Math.round((await popScroll()) ?? -1)], ["many", 0]);
// (2) 찾기 — notes 로 옮겨 'deep'(하위 폴더 sub 의 파일)을 찾아 고른다 — 넘겨받지 않았다면 새 타일의 칸은 sub 에서 선다
await clickRow(POP13, "..");
await sleep(400);
await clickRow(POP13, "..");
await sleep(400);
await clickRow(POP13, "notes");
await sleep(500);
check("⑬ 드롭다운에서 notes 로 옮김", (await filesInfo(POP13))?.where, "notes");
await ev(`${POP13}.querySelector('input.filter').focus()`);
await send("Input.insertText", { text: "deep" });
await sleep(800);
const hits13 = (await fileRows(POP13)).map((r) => [r.name, r.sub]);
check("⑬ 찾기 'deep' → deep.md + 흐린 sub", hits13, [["deep.md", "sub"]]);
const scans13 = await ev(`window.__calls.filter((c) => c[0] === 'list_text_files').length`);
const id13b = cur;
await startSwapSampling(900);
await clickRow(POP13, "deep.md");
const fr13b = await swapFrames(1000);
const af13b = await refreshCur13();
const mine13b = (fr13b ?? []).filter((f) => f.id === cur);
check("⑬ (찾기) 드롭다운에서 고름 → 새 id · sub\\deep.md", [cur !== id13b, af13b.docs[0]?.path], [true, `${DIR}\\sub\\deep.md`]);
check("⑬ (찾기) 새 타일의 모든 프레임에서 드롭다운 닫힘 · 지금도 닫힘", [mine13b.length > 0 && mine13b.every((f) => f.pop === false), await ev(`!!${POP13}`)], [true, false]);
check("⑬ (찾기) 등장 애니메이션 없음", noTileIn(fr13b, cur), [true, true]);
check("⑬ (찾기) 본문이 새 문서를 그림 · 본문만 떠오름", [await waitFor(`${P()}?.querySelector('.md-page h1')?.textContent.includes('깊은 노트') === true`, 4000), bodyFaded(fr13b, cur)], [true, true]);
check("⑬ 드롭다운 다시 열림(찾기 뒤)", await openPop(), true);
const re13b = { where: (await filesInfo(POP13))?.where, value: (await filesInfo(POP13))?.value, rows: (await fileRows(POP13)).map((r) => [r.name, r.sub]) };
console.log("⑬ reopen after find", JSON.stringify(re13b));
check("⑬ 다시 열면 넘겨받은 폴더 notes(문서의 폴더 sub 가 아님) · 찾기 글 'deep' · 결과 줄 그대로", [re13b.where, re13b.value, re13b.rows], ["notes", "deep", hits13]);
check("⑬ 찾기 자료를 다시 훑지 않았다(넘겨받음)", await ev(`window.__calls.filter((c) => c[0] === 'list_text_files').length`), scans13);
await shot("p13-narrow-find-reopen.png");
await esc();
const afterEsc1 = { open: await ev(`!!${POP13}`), value: (await filesInfo(POP13))?.value ?? null };
check("⑬ 넘겨받은 찾기 글이 있을 때 Esc 한 번 = 비우기만(드롭다운 열린 채)", [afterEsc1.open, afterEsc1.value], [true, ""]);
await esc();
check("⑬ Esc 두 번 → 드롭다운 닫힘", await ev(`!!${POP13}`), false);

// ⑪ 콘솔 오류
if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑪ 콘솔 오류 · 예외 · Svelte 경고 0", errors, []);
if (unmeasured.length) console.log("못 잰 것:\n  " + unmeasured.join("\n  "));
console.log("\n| 판정 | 항목 | 본 값 | 기대 |\n| --- | --- | --- | --- |");
for (const r of rows) console.log(`| ${r[0]} | ${r[1]} | ${r[2].replace(/\|/g, "\\|")} | ${r[3].replace(/\|/g, "\\|")} |`);
console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
