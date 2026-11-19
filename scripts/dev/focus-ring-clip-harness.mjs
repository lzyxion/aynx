// 헤드리스 검증 — **설정 화면의 포커스 링이 조상에게 잘리는 컨트롤**을 기계로 찾는다 (2026-11-19 — 보안 › 저장된 항목의 찾기 칸 ·
// 지침 › 사이드 채팅 지침의 입력 상자가 좌우로 잘린다는 보고).
//
// 설정 모달의 섹션 전부 + 스텁으로 닿는 하위 화면 · 펼침 칸을 차례로 열고, 화면마다 보이는 포커스 가능한 컨트롤에 키보드 포커스
// (`focus({ focusVisible: true })` — 그 앞에 CDP 로 Shift 를 한 번 눌러 키보드 모드로)를 준 뒤:
//   링 사각형 = 링을 그리는 요소(컨트롤 자신 또는 `:has(:focus-visible)` 로 링을 받는 조상)의 테두리 상자 + (outline-width + outline-offset)
//   자르는 사각형 = overflow 가 visible 이 아닌 조상마다 padding box(clientLeft/Width — 스크롤 막대 제외) · clip 축은 + overflow-clip-margin
// 링이 자르는 사각형을 넘으면 {화면, 컨트롤, 변, px, 자르는 조상} 을 적는다. 세로 스크롤 상자의 위 · 아래는 세지 않는다(스크롤로 가려진 것).
// 컨트롤이 자르는 조상 밖에 통째로 있으면(접힌 펼침 칸 · 스크롤 밖) 보이지 않는 것이라 뺀다.
// 기하로 걸린 것은 **그림으로 한 번 더 본다** — 링 한가운데(테두리 상자 밖 2px)를 포커스 전 · 후로 잘라 찍어 픽셀이 바뀌었는지(= 링이 실제로 칠해졌는지).
//
//   node scripts/dev/run-harness.mjs focus-ring-clip-harness.mjs <outdir> --size 1200x900 --timeout 400 [-- --tag before] [-- --baseline <이전 layout.json>]
//
// 만드는 것(<outdir>): `<tag>-clips.json`(잘림 목록) · `<tag>-layout.json`(화면마다 컨트롤 사각형 — 고치기 전 · 후 배치 비교용) ·
// `<tag>-NN-<화면>.png`(화면마다) · `<tag>-focus-*.png`(대표 장면 둘) · `<tag>-chip-*.png`(칩 장면).
// `--baseline` 을 주면 같은 화면 · 같은 컨트롤의 사각형을 비교해 달라진 것을 센다(0 이어야 한다).
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const argv = process.argv.slice(2);
const outdir = argv[0] ?? "out";
const port = argv[1] ?? process.env.CDP_PORT ?? "9268";
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const TAG = flag("--tag") ?? "run";
const BASELINE = flag("--baseline");
fs.mkdirSync(outdir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// 단계마다 시한 — 답이 없으면 그 단계만 실패로 넘긴다(러너 시한까지 멈추지 않게)
const send = (method, params = {}, ms = 15000) =>
  Promise.race([
    new Promise((r) => { const id = ++seq; pending.set(id, r); ws.send(JSON.stringify({ id, method, params })); }),
    sleep(ms).then(() => ({ error: { message: `timeout ${method}` } })),
  ]);
const ev = async (e) => {
  const r = await send("Runtime.evaluate", { expression: e, awaitPromise: true, returnByValue: true });
  if (r.error) return "EXC " + r.error.message;
  return r.result?.exceptionDetails ? "EXC " + (r.result.exceptionDetails.exception?.description ?? "").split("\n")[0] : r.result?.result?.value;
};
const evj = async (e) => {
  const v = await ev(`JSON.stringify(${e})`);
  if (typeof v !== "string" || v.startsWith("EXC ")) throw new Error(`eval failed: ${v}`);
  return JSON.parse(v);
};
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (!r.result?.data) return null;
  const p = path.join(outdir, `${TAG}-${name}.png`);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  return path.resolve(p);
};

// ── 작은 PNG 읽개(Chromium 캡처 = 8비트 RGB/RGBA · 비인터레이스) — 링 픽셀 확인용 ──
function decodePng(buf) {
  let o = 8, w = 0, h = 0, ct = 0;
  const idat = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o); const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") { w = data.readUInt32BE(0); h = data.readUInt32BE(4); ct = data[9]; }
    else if (type === "IDAT") idat.push(data);
    else if (type === "IEND") break;
    o += 12 + len;
  }
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp; const px = Buffer.alloc(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)]; const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0; const b = y > 0 ? px[(y - 1) * stride + x] : 0;
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0;
      let v = src[x];
      if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) { const p = a + b - c; const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      px[y * stride + x] = v & 255;
    }
  }
  return { w, h, bpp, px };
}
/** (x, y) 둘레 3×3 의 픽셀 — 링이 칠해졌는지 포커스 전 · 후를 비교한다 */
async function pixelsAt(x, y) {
  const r = await send("Page.captureScreenshot", { format: "png", clip: { x: Math.round(x) - 1, y: Math.round(y) - 1, width: 3, height: 3, scale: 1 } });
  if (!r.result?.data) return null;
  const img = decodePng(Buffer.from(r.result.data, "base64"));
  return [...img.px];
}

await send("Page.enable");
await send("Runtime.enable");

// ── 스텁 — messenger-settings-harness 의 뼈대 + 보안(볼트 열림 · 마스터 없음 = 관문 [열기]) · 지침 · 템플릿 · DB 권한 ──
const STUB = `
  performance.setResourceTimingBufferSize(10000);
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__calls = []; window.__unstubbed = []; let nextSession = 100;
  window.__listeners = {};
  const NOBOT = () => ({ configured: false, bot: null, paired: false, pairName: null, pending: null, link: 'off' });
  const TPL = JSON.stringify({ version: 1, templates: [{ id: 't-1', name: '개발 탭', root: { dir: 'row', ratio: 0.5, a: { kind: 'local', shell: 'pwsh' }, b: { kind: 'local', shell: 'pwsh' } }, savedAt: Date.now() - 3600000 }] });
  const answers = {
    list_hosts: { hosts: [{ name: 'web-01', host_name: '10.0.0.9', user: 'deploy', port: 22, identity_file: null, proxy_jump: null, meta: { tags: [], forwards: [], icon: null } }], warnings: [] },
    get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }, { id: 'cmd', label: 'Command Prompt' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: true }],
    agent_hooks_targets: [{ id: 'claude', display: 'Claude Code', needsTrustNote: false }, { id: 'codex', display: 'Codex', needsTrustNote: true }],
    agent_args_targets: [{ id: 'claude', display: 'Claude Code' }, { id: 'codex', display: 'Codex' }],
    agent_launch_preview: { line: 'claude', error: null, dangerous: [] }, agent_mcp_validate: null,
    load_snippets: null, save_snippets: null, host_history_list: {}, projects_list: [{ id: 'P1', name: 'proj', host: null, path: 'C:\\\\src\\\\proj', shell: null, command: '', tmux: false, worktreeDir: null }],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, resize_session: null, write_session: null, close_session: null, reap_window_sessions: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 3 },
    vault_list: [{ kind: 'host_password', target: 'web-01' }, { kind: 'key_passphrase', target: 'C:\\\\Users\\\\me\\\\.ssh\\\\id_ed25519' }, { kind: 'db_password', target: 'db-1' }],
    delegation_list_targets: [
      { alias: 'web-01', client: 'any', connect: true, read: true, propose: true, auto_execute: false, approve_all: false, vault_passphrase: true, alias_known: true },
      { alias: 'old-host', client: 'any', connect: true, read: true, propose: false, auto_execute: false, approve_all: false, vault_passphrase: false, alias_known: false },
    ],
    // 둘째 · 셋째 줄 = "대상 바뀜" · "정리 필요" 경고 칩 장면(2026-11-19)
    db_ai_list: { targets: [
      { id: 'db-1', level: 'read', identityOk: true, headless: false, connKnown: true, name: 'local pg' },
      { id: 'db-2', level: 'read', identityOk: false, headless: false, connKnown: true, name: 'staging pg' },
      { id: 'db-gone', level: 'schema', identityOk: true, headless: false, connKnown: false, name: null },
    ], serverReady: true, writePlans: true, connTest: true },
    db_conn_list: { conns: [], warnings: [] }, db_folders_load: null,
    mcp_status: { name: 'aynx-sessions-dev', running: true, url: 'http://127.0.0.1:43210/mcp' }, mcp_activity: null,
    mcp_tools: [{ name: 'list_sessions', group: 'read', description: 'The AI-readable open sessions.' }, { name: 'create_execution_plan', group: 'plan', description: 'Saves a task plan (draft).' }],
    mcp_calls: [],
    list_forwards: [], session_log_path: null, audit_status: { state: 'off', written: 0, failed: 0 }, operation_results: {},
    list_console_sessions: [], list_operations: { pending: [], recent: [] },
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    agent_sessions_list: { groups: [], others: [], othersMore: false },
    term_theme_list: [], restore_done_sessions: { closed: 0, unclaimed: 0 }, git_worktree_list: [],
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [], agent_states_snapshot: [],
    instructions_list: { items: [{ name: 'house-style', description: '공용 코드 규칙', targets: ['*'], enabled: true, scope: 'global', projects: [], subpath: null, body: '# rules' }], broken: [] },
    side_chat_instructions_load: '답은 한국어로.',
    instructions_import_candidates: [], instructions_preview: { changes: [] },
    load_tab_templates: TPL, save_tab_templates: null,
    remote_status: { enabled: true, listening: true, port: 8765, host: 'mypc.tail1234.ts.net', funnel: 'off', tailscaleCli: true },
    remote_serve_status: { state: 'ours' }, remote_devices_list: [], remote_log: [],
    session_server_status: { connected: true, server_pid: 4242, protocol: 33, app_version: '0.1.4', launch_mode: 'detached', uptime_ms: 3600000, clients: 1, sessions: 3, own_job: false, mismatch: false, last_error: null },
    messenger_status: { configured: false, via: null }, messenger_bot_status: NOBOT(),
    'plugin:notification|is_permission_granted': true, 'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push(cmd);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      if (cmd === 'load_settings') return Promise.resolve({ app: { status_bar: 'bottom' }, remote: { enabled: true, host: 'mypc.tail1234.ts.net' } });
      if (cmd === 'save_settings') return Promise.resolve(null);
      if (cmd === 'agent_hooks_status') return Promise.resolve({ installed: args.agent === 'claude', partial: args.agent === 'codex', settingsPath: '~/.' + args.agent + '/settings.json', scriptPath: '~/.aynx/hook', preview: '{}', error: null });
      if (cmd in answers) return Promise.resolve(answers[cmd]);
      window.__unstubbed.push(cmd);
      return Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`;

// ── 페이지 안의 재기 — 후보 모으기 · 링 · 자르는 조상 ──
const PROBE = `
window.__ring = (() => {
  const SEL = 'input:not([type=hidden]), textarea, select, button, [role=combobox], a[href], [tabindex]:not([tabindex="-1"])';
  const desc = (el) => {
    if (!el || el.nodeType !== 1) return '?';
    let s = el.tagName.toLowerCase();
    if (el.id) s += '#' + el.id;
    const cls = [...el.classList].filter(c => !/^svelte-/.test(c)).slice(0, 3);
    if (cls.length) s += '.' + cls.join('.');
    return s;
  };
  const label = (el) => (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('title') || el.textContent || '').replace(/\\s+/g, ' ').trim().slice(0, 40);
  const clipsOf = (el) => {
    const out = [];
    let pastScroll = false; // 세로 스크롤 상자를 지났으면 그 바깥 조상의 위 · 아래 자르기는 뜻이 없다(이미 스크롤 상자가 가린다)
    for (let a = el.parentElement; a; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const ox = cs.overflowX, oy = cs.overflowY;
      if (ox === 'visible' && oy === 'visible') continue;
      const r = a.getBoundingClientRect();
      const L = r.left + a.clientLeft, T = r.top + a.clientTop;
      const m = parseFloat(cs.overflowClipMargin) || 0;
      const yScroll = pastScroll || oy === 'auto' || oy === 'scroll';
      if (oy === 'auto' || oy === 'scroll') pastScroll = true;
      out.push({
        el: a, d: desc(a),
        x: ox !== 'visible', y: oy !== 'visible',
        // 세로로 스크롤되는 상자(와 그 바깥)는 위 · 아래를 세지 않는다 — 스크롤로 가려진 것은 잘림이 아니다
        yScroll,
        l: L - (ox === 'clip' ? m : 0), r: L + a.clientWidth + (ox === 'clip' ? m : 0),
        t: T - (oy === 'clip' ? m : 0), b: T + a.clientHeight + (oy === 'clip' ? m : 0),
        how: ox + '/' + oy + (m ? ' +' + m : ''),
      });
    }
    return out;
  };
  const visibleIn = (rect, clips) => clips.every(c => (!c.x || (rect.right > c.l + 0.5 && rect.left < c.r - 0.5)) && (!c.y || (rect.bottom > c.t + 0.5 && rect.top < c.b - 0.5)));
  function candidates(scope) {
    return [...scope.querySelectorAll(SEL)].filter(el => {
      if (el.disabled || el.closest('[inert]') || el.closest('[hidden]')) return false;
      if (typeof el.checkVisibility === 'function' && !el.checkVisibility({ checkOpacity: false, checkVisibilityCSS: true })) return false;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return false;
      return true;
    });
  }
  /** 포커스된 컨트롤의 링 — 컨트롤 자신 또는 조상(:has 로 링을 받는 줄) 중 outline 이 선 것 */
  function ringOwners(el, scope) {
    const out = [];
    for (let a = el; a && a !== scope.parentElement; a = a.parentElement) {
      const cs = getComputedStyle(a);
      const w = parseFloat(cs.outlineWidth) || 0;
      if (cs.outlineStyle === 'none' || w <= 0) continue;
      const e = w + (parseFloat(cs.outlineOffset) || 0);
      if (e <= 0) continue; // 안쪽에 그리는 링(음수 offset)은 상자 밖으로 안 나간다
      out.push({ el: a, e, w, off: parseFloat(cs.outlineOffset) || 0 });
    }
    return out;
  }
  function scan(scopeSel) {
    const scope = document.querySelector(scopeSel);
    if (!scope) return { error: 'no scope ' + scopeSel };
    const cands = candidates(scope);
    window.__cands = cands;
    const layout = []; const clips = []; let noFv = 0; let measured = 0;
    cands.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      const key = desc(el) + '|' + label(el);
      layout.push({ i, key, x: +r.left.toFixed(2), y: +r.top.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) });
    });
    // 세로 스크롤 상자(설정 본문)를 한 화면씩 내리며 그때 보이는 것을 잰다 — 접힌 칸 안의 것은 끝까지 안 보여 빠진다
    const panel = document.querySelector('.settings-panel');
    const stops = [0];
    if (panel && panel.contains(scope)) for (let y = panel.clientHeight * 0.8; y < panel.scrollHeight - panel.clientHeight + 1; y += panel.clientHeight * 0.8) stops.push(Math.round(y));
    if (stops.length > 1 && panel) stops.push(panel.scrollHeight - panel.clientHeight);
    const done = new Set();
    for (const top of stops) {
    if (panel && stops.length > 1) panel.scrollTop = top;
    const scrollTop = panel ? panel.scrollTop : 0;
    cands.forEach((el, i) => {
      if (done.has(i)) return;
      const before = el.getBoundingClientRect();
      const cl0 = clipsOf(el);
      if (!visibleIn(before, cl0)) return; // 접힌 칸 · 스크롤 밖 — 보이지 않는다
      done.add(i);
      try { el.focus({ preventScroll: true, focusVisible: true }); } catch { el.focus({ preventScroll: true }); }
      if (document.activeElement !== el) return;
      measured++;
      if (!el.matches(':focus-visible')) noFv++;
      for (const o of ringOwners(el, scope)) {
        const R = o.el.getBoundingClientRect();
        const ring = { l: R.left - o.e, r: R.right + o.e, t: R.top - o.e, b: R.bottom + o.e };
        // 변마다 자르는 조상을 모두 모으고, 가장 많이 자르는(같으면 가장 안쪽) 것을 주인으로 적는다
        const bySide = {};
        for (const c of clipsOf(o.el)) {
          const cut = [];
          if (c.x && ring.l < c.l - 0.25) cut.push(['left', Math.min(o.e, c.l - ring.l)]);
          if (c.x && ring.r > c.r + 0.25) cut.push(['right', Math.min(o.e, ring.r - c.r)]);
          if (c.y && !c.yScroll && ring.t < c.t - 0.25) cut.push(['top', Math.min(o.e, c.t - ring.t)]);
          if (c.y && !c.yScroll && ring.b > c.b + 0.25) cut.push(['bottom', Math.min(o.e, ring.b - c.b)]);
          for (const [side, px] of cut) (bySide[side] ??= []).push({ px: +px.toFixed(2), d: c.d + ' (' + c.how + ')' });
        }
        for (const [side, list] of Object.entries(bySide)) {
          const top = list.reduce((a, b) => (b.px > a.px ? b : a));
          clips.push({
            i, scrollTop, ctl: desc(el), label: label(el), owner: o.el === el ? 'self' : desc(o.el), side, px: top.px,
            ring: +o.e.toFixed(2), clipper: top.d, all: list.map((x) => x.d + ' ' + x.px).join(' ; '),
            // 링 한가운데(테두리 상자 밖 w/2 + offset) — 그림 확인 자리
            px_x: side === 'left' ? R.left - o.off - o.w / 2 : side === 'right' ? R.right + o.off + o.w / 2 : R.left + R.width / 2,
            px_y: side === 'top' ? R.top - o.off - o.w / 2 : side === 'bottom' ? R.bottom + o.off + o.w / 2 : R.top + R.height / 2,
          });
        }
      }
      el.blur();
    });
    }
    if (panel) panel.scrollTop = 0;
    return { n: cands.length, measured, noFv, layout, clips };
  }
  return { scan, desc };
})();
'ok'`;

await send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);
console.log("probe:", await ev(PROBE));

const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const overlays = importApp("app/overlays.svelte.ts");
const VIS = `.settings-panel > section:not([hidden])`;
const openSection = async (id) => {
  await ev(`(async () => (await ${overlays}).openSettingsAt(${JSON.stringify(id)}))()`);
  await sleep(700); // 섹션 등장 움직임 480ms
  if (id === "credentials") {
    const gate = await ev(`document.querySelector('${VIS} .gate')?.dataset.credGate ?? null`);
    if (gate) {
      await ev(`document.querySelector('${VIS} .gate .btn-primary')?.click()`);
      await sleep(700);
    }
  }
};
const keyShift = async () => {
  for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16 });
  await sleep(30);
};

const SECTIONS = ["theme", "general", "keys", "terminal", "snippets", "triggers", "templates", "ai", "mcp", "instructions", "automation", "notifications", "credentials", "remote"];
// 섹션마다 하위 화면 · 펼침으로 가는 단추(+ 공용 `.slist-open` 줄 단추 — 하위 화면 또는 펼침)
const OPENERS = {
  theme: ["#avatars-open"],
  snippets: ["#snip-add"],
  triggers: ["#trg-add"],
  automation: ["#auto-bundles", "#auto-allow"],
  mcp: ["#ai-mcp-add"],
  instructions: ["#instructions-add", "#instructions-import", "#instructions-apply"],
  credentials: ["#vault-items", "#delegation-targets", "#db-ai-targets"],
  remote: ['[data-remote-card-toggle="guide"]'],
};
const MAX_SLIST = 6;

const results = []; // {screen, n, measured, noFv, clips}
const layoutAll = {};
let shotNo = 0;
const allClips = [];
const hScroll = []; // 하위 화면 · 펼침을 여는 동안의 가로 넘침

async function scanScreen(screen, scope = VIS) {
  await keyShift();
  const r = await evj(`window.__ring.scan(${JSON.stringify(scope)})`).catch((e) => ({ error: e.message }));
  if (r.error) { console.log(`SCREEN ${screen}: ${r.error}`); return; }
  // 그림 확인 — 걸린 컨트롤마다 링 자리의 픽셀을 포커스 전 · 후로
  for (const c of r.clips) {
    await ev(`(() => { const p = document.querySelector('.settings-panel'); if (p) p.scrollTop = ${c.scrollTop}; return 1; })()`);
    await keyShift();
    await sleep(30);
    const off = await pixelsAt(c.px_x, c.px_y);
    await ev(`(() => { const el = window.__cands[${c.i}]; try { el.focus({ preventScroll: true, focusVisible: true }); } catch { el.focus({ preventScroll: true }); } return 1; })()`);
    await sleep(60);
    const on = await pixelsAt(c.px_x, c.px_y);
    await ev(`(() => { window.__cands[${c.i}]?.blur(); return 1; })()`);
    c.painted = !!(off && on) && on.some((v, k) => Math.abs(v - off[k]) > 6);
    delete c.px_x; delete c.px_y;
  }
  await ev(`(() => { const p = document.querySelector('.settings-panel'); if (p) p.scrollTop = 0; return 1; })()`);
  const name = String(++shotNo).padStart(2, "0") + "-" + screen.replace(/[^\w.-]+/g, "_");
  await shot(name);
  layoutAll[screen] = r.layout;
  results.push({ screen, n: r.n, measured: r.measured, noFv: r.noFv, clips: r.clips.length });
  for (const c of r.clips) allClips.push({ screen, ...c });
  console.log(`SCREEN ${screen}: 후보 ${r.n} · 잰 것 ${r.measured} · focus-visible 아님 ${r.noFv} · 잘림 ${r.clips.length}`);
}

const t0 = Date.now();
await openSection("theme");
await scanScreen("nav", ".settings-nav");
for (const sec of SECTIONS) {
  await openSection(sec);
  await scanScreen(sec);
  // 열 단추 목록 — 요약에서 한 번 모은다(id 단추 + `.slist-open` 앞 몇 개)
  const openers = await evj(`(() => {
    const root = document.querySelector('${VIS}');
    const out = [];
    for (const s of ${JSON.stringify(OPENERS[sec] ?? [])}) if (root.querySelector(s)) out.push({ sel: s, i: 0 });
    [...root.querySelectorAll('.slist-open')].filter(b => !b.disabled).slice(0, ${MAX_SLIST}).forEach((b, i) => out.push({ sel: '.slist-open', i, name: b.id || b.dataset.name || b.textContent.replace(/\\s+/g, ' ').trim().slice(0, 18) }));
    return out;
  })()`).catch(() => []);
  for (const o of openers) {
    // 요약에서 다시 시작 — 다른 섹션에 갔다 오면 하위 화면 · 펼침이 요약으로 돌아간다(보안은 관문을 다시 지난다)
    await openSection(sec === "general" ? "theme" : "general");
    await openSection(sec);
    // 누르고 미끄러지는 동안(200ms) 설정 본문에 가로 넘침이 생기는지 프레임마다 본다 — `.sub-views` 가 자르는 까닭
    const clicked = await ev(`(async () => {
      const b = document.querySelectorAll('${VIS} ${o.sel}')[${o.i}]; if (!b) return 'none';
      const p = document.querySelector('.settings-panel'); let max = 0;
      b.click();
      const end = performance.now() + 400;
      while (performance.now() < end) { await new Promise(requestAnimationFrame); max = Math.max(max, p.scrollWidth - p.clientWidth, p.scrollLeft); }
      return 'ok:' + max;
    })()`);
    if (!String(clicked).startsWith("ok")) { console.log(`  opener ${o.sel}[${o.i}] 없음`); continue; }
    const hOverflow = Number(String(clicked).slice(3));
    if (hOverflow > 0) console.log(`  HSCROLL ${sec} ${o.sel}[${o.i}] 가로 넘침 ${hOverflow}px`);
    hScroll.push({ sec, opener: o.sel + "[" + o.i + "]", px: hOverflow });
    await sleep(200);
    await scanScreen(`${sec}>${o.sel === ".slist-open" ? "row:" + o.name : o.sel.replace(/^#/, "")}`);
  }
  if (Date.now() - t0 > 300_000) { console.log("시간 상한 — 남은 섹션을 건너뛴다"); break; }
}

// ── 대표 장면 둘(포커스한 채) · 칩 장면 ──
// 대표 장면 — 포커스 전 · 후로 링의 왼쪽 · 오른쪽 한가운데(상자 밖 2px)를 그림으로 비교해 "칠해졌는가" 를 함께 적는다
const focusShot = async (sel, name) => {
  const S = JSON.stringify(sel);
  const pts = await evj(`(() => { const el = document.querySelector(${S}); if (!el) return null; const r = el.getBoundingClientRect(); return { l: [r.left - 2, r.top + r.height / 2], r: [r.right + 2, r.top + r.height / 2] }; })()`).catch(() => null);
  if (!pts) { console.log(`focus ${name}: none`); return; }
  const off = { l: await pixelsAt(...pts.l), r: await pixelsAt(...pts.r) };
  await keyShift();
  const ok = await ev(`(() => { const el = document.querySelector(${S}); el.focus({ preventScroll: true, focusVisible: true }); return el.matches(':focus-visible') ? 'fv' : 'focus'; })()`);
  await sleep(150);
  const on = { l: await pixelsAt(...pts.l), r: await pixelsAt(...pts.r) };
  const painted = (k) => !!(off[k] && on[k]) && on[k].some((v, i) => Math.abs(v - off[k][i]) > 6);
  console.log(`focus ${name}: ${ok} · 링 왼쪽 칠함 ${painted("l")} · 오른쪽 칠함 ${painted("r")} → ${await shot(name)}`);
};
await openSection("general"); await openSection("credentials");
await ev(`document.querySelector('${VIS} #vault-items')?.click()`); await sleep(500);
await focusShot(`${VIS} .cred-search`, "focus-cred-search");
await openSection("general"); await openSection("instructions");
await ev(`document.querySelector('${VIS} #instructions-side-chat')?.click()`); await sleep(500);
await focusShot(`${VIS} textarea.value`, "focus-sidechat-body");

// 칩 장면 — 보안 요약 · AI 권한 호스트 · MCP 세션 서버 · 지침 사이드 채팅 칩 · AI 에이전트 훅 줄
await openSection("general"); await openSection("credentials");
console.log("chip credentials summary:", await shot("chip-credentials-summary"));
await ev(`(() => { const p = document.querySelector('.settings-panel'); const el = document.querySelector('${VIS} #vault-items-row') ?? document.querySelector('${VIS} #vault-items'); if (p && el) p.scrollTop = Math.max(0, el.getBoundingClientRect().top - p.getBoundingClientRect().top - 120); return 1; })()`);
await sleep(200);
console.log("chip credentials summary (items):", await shot("chip-credentials-summary-items"));
await ev(`document.querySelector('${VIS} #delegation-targets')?.click()`); await sleep(500);
console.log("chip delegation hosts:", await shot("chip-delegation-hosts"));
await openSection("general"); await openSection("credentials");
await ev(`document.querySelector('${VIS} #db-ai-targets')?.click()`); await sleep(500);
console.log("chip db ai targets:", await shot("chip-db-ai-targets"));
console.log("warn chips:", JSON.stringify(await evj(`[...document.querySelectorAll('${VIS} .grant-list .warn')].map(e => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { text: e.textContent.trim(), aria: e.getAttribute('aria-label'), h: r.height, w: +r.width.toFixed(1), bg: cs.backgroundColor, r: cs.borderRadius }; })`).catch((e) => e.message)));
await openSection("general"); await openSection("mcp");
await ev(`(document.querySelector('${VIS} #ai-mcp-sessions .slist-open') ?? document.querySelector('${VIS} .slist-open'))?.click()`); await sleep(600);
console.log("chip mcp session server:", await shot("chip-mcp-session-server"));
await openSection("general"); await openSection("instructions");
console.log("chip instructions side chat:", await shot("chip-instructions-sidechat"));
await openSection("general"); await openSection("ai");
await ev(`document.querySelector('${VIS} .slist-open')?.click()`); await sleep(600);
await ev(`(() => { const p = document.querySelector('.settings-panel'); const el = [...document.querySelectorAll('${VIS} [id$="-hooks"]')][0]; if (p && el) p.scrollTop = Math.max(0, el.getBoundingClientRect().top - p.getBoundingClientRect().top - 200); return 1; })()`);
await sleep(250);
console.log("chip ai agent hooks:", await shot("chip-ai-agent-hooks"));

// ── 설정 밖(`--outside`) — 호스트 · 프로젝트 · DB 연결 폼(글래스 모달) · 독 · 명령 팔레트 · 채팅 독을 같은 재기로(보고만 — 고치지 않는다) ──
// 화면마다 새로 읽어 깨끗한 판에서 연다(닫는 길이 화면마다 달라서). 스크롤 상자 안에서 아래로 가려진 컨트롤은 재지 않는다.
if (argv.includes("--outside")) {
  const OUT = [
    { name: "out:host-form", mod: "app/hosts/form.svelte.ts", call: "openAdd()", scope: `[...document.querySelectorAll('.modal')].at(-1)`, tabs: true },
    { name: "out:project-form", mod: "app/projects.svelte.ts", call: "openProjectForm()", scope: `[...document.querySelectorAll('.modal')].at(-1)`, tabs: true },
    { name: "out:db-conn-form", mod: "app/query.svelte.ts", call: "openConnForm()", scope: `[...document.querySelectorAll('[aria-modal="true"]')].at(-1)`, tabs: true },
    { name: "out:palette", mod: "app/overlays.svelte.ts", call: "openPalette('')", scope: `document.querySelector('.palette')` },
    { name: "out:dock-hosts", mod: "app/dock.svelte.ts", call: "openDock('hosts')", scope: `[...document.querySelectorAll('.dock')].at(-1)` },
    { name: "out:dock-projects", mod: "app/dock.svelte.ts", call: "openDock('projects')", scope: `[...document.querySelectorAll('.dock')].at(-1)` },
    { name: "out:dock-db", mod: "app/dock.svelte.ts", call: "openDock('db')", scope: `[...document.querySelectorAll('.dock')].at(-1)` },
    { name: "out:dock-alerts", mod: "app/dock.svelte.ts", call: "openDock('alerts')", scope: `[...document.querySelectorAll('.dock')].at(-1)` },
    { name: "out:chat-dock", mod: "app/chat-dock.svelte.ts", call: "(m.setChatDockAvailable(true), m.openChatDock())", scope: `document.querySelector('.chat-dock') ?? [...document.querySelectorAll('[class*="chat-dock"]')].at(-1)` },
  ];
  const mark = (scopeJs) => ev(`(() => { document.querySelectorAll('[data-ring-scope]').forEach(e => e.removeAttribute('data-ring-scope')); const el = ${scopeJs}; if (!el) return 'none'; el.setAttribute('data-ring-scope', ''); return 'ok'; })()`);
  for (const o of OUT) {
    await send("Page.reload", { ignoreCache: true });
    try { await waitBoot(ev, { timeout: 20000 }); } catch (e) { console.log(`${o.name}: ${e.message}`); continue; }
    await sleep(600);
    await ev(PROBE);
    const r = await ev(`(async () => { const m = await ${importApp(o.mod)}; ${o.call.startsWith("(") ? o.call : "m." + o.call}; return 'ok'; })()`);
    await sleep(700);
    if ((await mark(o.scope)) !== "ok") { console.log(`${o.name}: 열지 못함 (${r})`); continue; }
    await scanScreen(o.name, "[data-ring-scope]");
    if (o.tabs) {
      const n = await ev(`document.querySelectorAll('[data-ring-scope] .settings-nav .nav-item').length`);
      for (let i = 1; i < (typeof n === "number" ? Math.min(n, 8) : 0); i++) {
        const name = await ev(`(() => { const t = document.querySelectorAll('[data-ring-scope] .settings-nav .nav-item')[${i}]; t.click(); return t.textContent.trim().slice(0, 16); })()`);
        await sleep(400);
        await mark(o.scope);
        await scanScreen(`${o.name}>${name}`, "[data-ring-scope]");
      }
    }
  }
}

// ── 결과 ──
fs.writeFileSync(path.join(outdir, `${TAG}-clips.json`), JSON.stringify({ results, clips: allClips }, null, 1));
fs.writeFileSync(path.join(outdir, `${TAG}-layout.json`), JSON.stringify(layoutAll, null, 1));
console.log("\n화면별:");
for (const r of results) console.log(`  ${r.screen.padEnd(40)} 후보 ${String(r.n).padStart(3)} 잼 ${String(r.measured).padStart(3)} fv아님 ${r.noFv} 잘림 ${r.clips}`);
console.log(`\n잘림 ${allClips.length}건 (그림으로 확인된 링 칠함 = painted)`);
console.log("화면 | 컨트롤 | 링 주인 | 변 | px | 자르는 조상(overflow) | 링 칠함");
for (const c of allClips) console.log(`${c.screen} | ${c.ctl} "${c.label}" | ${c.owner} | ${c.side} | ${c.px}/${c.ring} | ${c.clipper} [모두: ${c.all}] | ${c.painted}`);
const unst = await evj(`[...new Set(window.__unstubbed)]`).catch(() => []);
console.log("unstubbed:", JSON.stringify(unst));

let layoutDiff = null;
if (BASELINE && fs.existsSync(BASELINE)) {
  const base = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
  layoutDiff = { screens: 0, compared: 0, moved: [] };
  for (const [screen, rows] of Object.entries(layoutAll)) {
    const b = base[screen];
    if (!b) continue;
    layoutDiff.screens++;
    const bm = new Map(b.map((x) => [x.i + "|" + x.key, x]));
    for (const x of rows) {
      const y = bm.get(x.i + "|" + x.key);
      if (!y) continue;
      layoutDiff.compared++;
      if (x.x !== y.x || x.y !== y.y || x.w !== y.w || x.h !== y.h) layoutDiff.moved.push({ screen, key: x.key, before: y, after: x });
    }
  }
  console.log(`\n배치 비교(${BASELINE}): 화면 ${layoutDiff.screens} · 컨트롤 ${layoutDiff.compared} · 달라진 것 ${layoutDiff.moved.length}`);
  for (const m of layoutDiff.moved.slice(0, 30)) console.log(`  MOVED ${m.screen} ${m.key} ${JSON.stringify(m.before)} → ${JSON.stringify(m.after)}`);
}
ws.close();
const bad = allClips.filter((c) => !c.painted).length;
const hMax = Math.max(0, ...hScroll.map((h) => h.px));
console.log(`\nSUMMARY clips=${allClips.length} unpainted=${bad} openers=${hScroll.length} hscroll_max=${hMax}px${layoutDiff ? ` moved=${layoutDiff.moved.length}` : ""} (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
process.exit(0);
