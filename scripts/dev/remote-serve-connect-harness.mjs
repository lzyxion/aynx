// 헤드리스 검증 — **설정 › 원격 접속의 "Tailscale 연결" 줄** (2026-11-06). 명령은 전부 스텁이다 — tailscale 을 부르지 않는다.
//
// ① 처음 → 하는 중 → 연결됨(저장 전 다른 칸 편집은 그대로 · save_settings 안 부름) ② [serve 끄기] ③ 443 사용 중 → 취소 → 바꾸고 연결
// ④ 관리 화면(주소 있음/없음) ⑤ 실패 일반 ⑥ CLI 없음 ⑦ 설정 안내 카드의 차례 ⑧ 어느 상태든 줄 높이 · 토글 줄 위치 그대로 · [연결] 이 성공해도 보던 카드를 닫지 않음.
// 카드 자체(처음 펼침 · 여닫기 · 앵커 · 폭)는 remote-cards-harness.mjs.
//
//   node scripts/dev/run-harness.mjs remote-serve-connect-harness.mjs <outdir> --size 1200x900 --timeout 120
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
  // 시험이 고치는 칸 — 답(또는 connect 대기) · 부른 기록
  window.__stub = {
    status: { enabled: false, listening: false, port: 47822, host: '', funnel: 'off', tailscaleCli: true },
    serve: { state: 'none' },
    next: null,        // 다음 remote_serve_connect 의 답 — { reject: '문구' } 면 던진다
    hold: false,       // true 면 connect 가 release() 까지 기다린다
    release: null,
    calls: [],
  };
  const answers = {
    list_hosts: { hosts: [], warnings: [] }, get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' }, list_ai_clis: [],
    load_snippets: null, save_snippets: null, host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, resize_session: null, write_session: null, close_session: null, reap_window_sessions: null,
    vault_status: 'none', vault_list: [], mcp_status: { clis: [] }, mcp_activity: null, list_forwards: [], session_log_path: null,
    audit_status: { state: 'off', written: 0, failed: 0 }, operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    list_operations: { pending: [], recent: [] }, agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    remote_devices_list: [], remote_log: [],
    'plugin:notification|is_permission_granted': true, 'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
    'plugin:event|emit': null, 'plugin:opener|open_url': null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      const s = window.__stub;
      if (cmd === 'plugin:event|emit') s.calls.push({ cmd, args }); // WORKSPACE_STUB 이 먼저 받아 끝낸다
      ${WORKSPACE_STUB}
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      if (cmd === 'load_settings') return Promise.resolve({});
      if (cmd === 'remote_status') return Promise.resolve(s.status);
      if (cmd === 'remote_serve_status') { s.calls.push({ cmd, args }); return Promise.resolve(s.serve); }
      if (cmd === 'remote_serve_off') { s.calls.push({ cmd, args }); s.serve = { state: 'none' }; return Promise.resolve(null); }
      if (cmd === 'save_settings' || cmd === 'plugin:opener|open_url') s.calls.push({ cmd, args });
      if (cmd === 'save_settings') return Promise.resolve(null);
      if (cmd === 'remote_serve_connect') {
        s.calls.push({ cmd, args });
        const answer = () => {
          const a = s.next;
          if (a?.reject) return Promise.reject(a.reject);
          if (a?.kind === 'connected') s.serve = { state: 'ours' };
          return Promise.resolve(a);
        };
        return s.hold ? new Promise((r) => { s.release = () => r(answer()); }) : answer();
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
await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);

const modUrl = (part) => `performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${part}'))`;
const overlays = `(async () => await import(${modUrl("app/overlays.svelte.ts")}))()`;
const store = `(async () => await import(${modUrl("settings/model/store.svelte.ts")}))()`;
await ev(`(async () => (await ${overlays}).openSettingsAt('remote'))()`);
await sleep(700);

const READ = `JSON.stringify((() => {
  const row = document.querySelector('[data-remote-connect]');
  const toggle = document.getElementById('remote-enabled');
  const toggleRow = toggle?.closest('.slist-row');
  const r = row?.getBoundingClientRect();
  const line = row?.querySelector('.line2');
  return {
    state: row?.dataset.state,
    h: r?.height,
    toggleTop: toggleRow?.getBoundingClientRect().top,
    text: line?.textContent.replace(/\\s+/g, ' ').trim(),
    warn: line ? getComputedStyle(line).color === getComputedStyle(document.documentElement).getPropertyValue('--warn') || line.classList.contains('warn') : false,
    buttons: [...(row?.querySelectorAll('.size-row button') ?? [])].map((b) => ({ text: b.textContent.trim(), disabled: b.disabled })),
    checked: toggle?.checked ?? toggle?.getAttribute('aria-checked'),
    hostValue: document.getElementById('remote-host')?.value,
    unsaved: !!document.querySelector('[data-remote-unsaved]'),
    newSiblings: row?.parentElement?.querySelectorAll('[data-remote-connect] ~ [role=alert]').length,
    openCards: [...document.querySelectorAll('[data-remote-card-open]')].map((c) => c.dataset.remoteCard),
  };
})())`;
const read = async () => JSON.parse(await ev(READ));
const click = async (sel) => {
  const r = await ev(`(() => { const b = document.querySelector('${sel}'); if (!b) return 'none'; b.click(); return 'ok'; })()`);
  await sleep(200);
  return r;
};
const setStub = (js) => ev(`(() => { const s = window.__stub; ${js}; return 1; })()`);
const calls = async (cmd) => JSON.parse(await ev(`JSON.stringify(window.__stub.calls.filter(c => c.cmd === '${cmd}'))`));
const clearCalls = () => setStub(`s.calls = []`);

const HOST = "mypc.tail1234.ts.net";
const CONNECTED = `{ kind: 'connected', host: '${HOST}', url: 'https://${HOST}/' }`;
const seen = [];
const note = (name, r) => seen.push({ name, h: r.h, toggleTop: r.toggleTop });

// ── 처음 ──
await sleep(300);
const ready = await read();
console.log("ready:", JSON.stringify(ready));
check(ready.state === "ready", `처음 = ready (${ready.state})`);
check(ready.openCards.join() === "access", `연결 전에는 원격 접속 카드가 펼쳐져 있다 (${ready.openCards})`);
check(ready.text.includes("한 번에"), `둘째 줄 안내 (${ready.text})`);
check(ready.buttons.length === 1 && ready.buttons[0].text === "연결" && !ready.buttons[0].disabled, "단추 [연결]");
note("ready", ready);
await shot("1-ready.png");
const firstStatus = await calls("remote_serve_status");
check(firstStatus.length >= 1 && firstStatus[0].args.port === null, `섹션이 보이면 판정을 읽는다(포트 null · ${firstStatus.length}번)`);

// ── 저장 전 다른 칸 편집을 건 채 연결 ──
await ev(`(async () => { (await ${store}).settings.current.app.accent = '#123456'; })()`);
await sleep(100);
await setStub(`s.next = ${CONNECTED}; s.hold = true`);
await clearCalls();
check((await click("[data-remote-connect-go]")) === "ok", "[연결] 누름");
const busy = await read();
console.log("busy:", JSON.stringify(busy));
check(busy.state === "busy" && busy.text.includes("serve 거는 중"), `진행 중 문구 (${busy.text})`);
check(busy.buttons[0]?.disabled === true, "진행 중 [연결] 꺼짐");
note("busy", busy);
await shot("2-busy.png");
const args = (await calls("remote_serve_connect"))[0]?.args;
check(args?.port === null && args?.replace === null, `connect 인자 (${JSON.stringify(args)})`);
await setStub(`s.hold = false; s.release()`);
await sleep(300);

// ── 연결됨 ──
const on = await read();
console.log("connected:", JSON.stringify(on));
check(on.state === "connected", `연결됨 (${on.state})`);
check(on.openCards.join() === "access", `[연결] 이 성공해도 보던 카드를 닫지 않는다 (${on.openCards})`);
check(!on.text.includes(`https://${HOST}/`) && (await ev(`document.querySelector('[data-remote-connect-on]')?.textContent`)) === "serve 열림", "연결 줄은 주소 대신 serve 열림");
check((await ev(`document.querySelector('[data-remote-access-url]')?.textContent`)) === `https://${HOST}/`, "주소는 카드 머리에");
check(on.buttons.length === 1 && on.buttons[0].text === "serve 끄기", "단추 [serve 끄기]");
check(String(on.checked) === "true", `토글 켜짐 (${on.checked})`);
check(on.hostValue === HOST, `이름 칸 채움 (${on.hostValue})`);
check(on.unsaved === false, "원격 칸은 저장 전 칩이 없다");
note("connected", on);
await shot("3-connected.png");
const kept = await ev(`(async () => { const m = await ${store}; return JSON.stringify({ accent: m.settings.current.app.accent, savedAccent: m.settings.saved.app.accent ?? null, dirty: m.settings.dirty, savedRemote: m.settings.saved.remote }); })()`);
console.log("kept:", kept);
const k = JSON.parse(kept);
check(k.accent === "#123456" && k.savedAccent !== "#123456" && k.dirty === true, "저장 전 다른 칸 편집이 편집인 채로 남는다");
check(k.savedRemote.enabled === true && k.savedRemote.host === HOST, "saved.remote 는 맞춰진다");
check((await calls("save_settings")).length === 0, "save_settings 를 부르지 않는다(함께 저장 없음)");
const emits = await calls("plugin:event|emit");
check(emits.some((c) => c.args?.event === "settings-saved"), "다른 창에 저장 알림");
await ev(`(async () => { const m = await ${store}; m.settings.current.app.accent = m.settings.saved.app.accent; })()`);

// ── 켜졌지만 serve 는 우리 것인 채 저장이 꺼진 경우(멱등) · 끄기 ──
await clearCalls();
await click("[data-remote-serve-off]");
await sleep(200);
const off = await read();
check(off.state === "ready", `[serve 끄기] → 처음 (${off.state})`);
check((await calls("remote_serve_off")).length === 1, "remote_serve_off 한 번");
check(String(off.checked) === "true" && off.hostValue === HOST, "끄기는 [remote] 를 안 바꾼다");

// ── 443 사용 중 ──
const TARGET = "http://127.0.0.1:3000";
await setStub(`s.next = { kind: 'confirm', target: '${TARGET}' }; s.serve = { state: 'other', target: '${TARGET}' }`);
await clearCalls();
const before = await read();
check(before.state === "ready", "누르기 전에는 남의 443 도 말하지 않는다");
await click("[data-remote-connect-go]");
await sleep(150);
const other = await read();
console.log("other:", JSON.stringify(other));
check(other.state === "other" && other.text.includes(TARGET) && other.text.includes("끊깁니다"), `경고 문구 (${other.text})`);
check(other.buttons.map((b) => b.text).join("|") === "취소|바꾸고 연결", "단추 [취소] [바꾸고 연결]");
note("other", other);
await shot("4-other.png");
await click("[data-remote-connect-cancel]");
check((await read()).state === "ready", "[취소] → 처음");
await click("[data-remote-connect-go]");
await sleep(150);
await setStub(`s.next = ${CONNECTED}`);
await clearCalls();
await click("[data-remote-connect-replace]");
await sleep(200);
const replaced = await calls("remote_serve_connect");
check(replaced[0]?.args?.replace === TARGET, `[바꾸고 연결] 이 확인한 대상을 보낸다 (${replaced[0]?.args?.replace})`);
check((await read()).state === "connected", "바꾸고 연결 → 연결됨");
await click("[data-remote-serve-off]");
await sleep(200);

// ── 관리 화면 ──
const ADMIN = "https://login.tailscale.com/f/serve?node=abc";
await setStub(`s.next = { kind: 'admin', message: '이 tailnet 에서 serve 또는 HTTPS 인증서가 꺼져 있습니다.', url: '${ADMIN}' }`);
await click("[data-remote-connect-go]");
await sleep(150);
const admin = await read();
console.log("admin:", JSON.stringify(admin));
check(admin.state === "admin" && admin.text.includes("HTTPS"), `관리 화면 원인 (${admin.text})`);
check(admin.buttons.map((b) => b.text).join("|") === "관리 화면 ↗|다시 시도", "단추 [관리 화면 ↗] [다시 시도]");
note("admin", admin);
await shot("5-admin.png");
await clearCalls();
await click("[data-remote-connect-admin]");
const opened = await calls("plugin:opener|open_url");
check(opened[0]?.args?.url === ADMIN, `관리 화면을 연다 (${opened[0]?.args?.url})`);
await setStub(`s.next = { kind: 'admin', message: 'HTTPS certificates are not available' }`);
await click("[data-remote-connect-retry]");
await sleep(150);
const adminNoUrl = await read();
check(adminNoUrl.state === "admin" && adminNoUrl.buttons.map((b) => b.text).join("|") === "다시 시도", "주소가 없으면 [다시 시도] 만");

// ── 실패 일반 ──
await setStub(`s.next = { reject: 'tailscale serve 가 실패했습니다: Access denied' }`);
await click("[data-remote-connect-retry]");
await sleep(150);
const bad = await read();
console.log("failed:", JSON.stringify(bad));
check(bad.state === "failed" && bad.text.includes("Access denied"), `실패 문구 (${bad.text})`);
check(bad.buttons.map((b) => b.text).join("|") === "다시 시도", "단추 [다시 시도]");
note("failed", bad);
await shot("6-failed.png");
await setStub(`s.next = ${CONNECTED}`);
await click("[data-remote-connect-retry]");
await sleep(200);
check((await read()).state === "connected", "다시 시도 → 연결됨");
await click("[data-remote-serve-off]");
await sleep(200);

// ── CLI 없음(3초 폴링이 가져온다) ──
await setStub(`s.status = { ...s.status, tailscaleCli: false }`);
await sleep(3400);
const nocli = await read();
console.log("nocli:", JSON.stringify(nocli));
check(nocli.state === "nocli" && nocli.text.includes("Tailscale 이 없습니다"), `CLI 없음 (${nocli.text})`);
check(nocli.buttons.map((b) => b.text).join("|") === "Tailscale 설치 ↗", "단추 [Tailscale 설치 ↗]");
check((await ev(`document.querySelector('[data-remote-status] [data-chip="cli"]')?.textContent.trim()`)) === "Tailscale 찾을 수 없음", "CLI 가 없으면 상태 줄 칩이 그 말을 한다");
note("nocli", nocli);
await shot("7-nocli.png");
await clearCalls();
await click("[data-remote-connect-install]");
const install = await calls("plugin:opener|open_url");
check(install[0]?.args?.url === "https://tailscale.com/download", `설치 주소 (${install[0]?.args?.url})`);
await setStub(`s.status = { ...s.status, tailscaleCli: true }`);
await sleep(3400);
check((await ev(`!document.querySelector('[data-remote-status] [data-chip="cli"]')`)) === true, "CLI 가 있으면 Tailscale 칩이 없다");

// ── 줄 높이 · 토글 위치 ──
console.log("seen:", JSON.stringify(seen));
const h0 = seen[0].h;
const t0 = seen[0].toggleTop;
for (const s of seen) {
  check(s.h === h0, `줄 높이 그대로 — ${s.name} (${h0} → ${s.h})`);
  check(s.toggleTop === t0, `토글 줄 위치 그대로 — ${s.name} (${t0} → ${s.toggleTop})`);
}

// ── 안내 자리 ──
await click(`[data-remote-card-toggle="guide"]`);
await sleep(300);
const guide = JSON.parse(
  await ev(`JSON.stringify((() => {
  const card = document.querySelector('[data-remote-card="guide"]');
  const d = document.querySelector('[data-remote-manual]');
  const row = document.querySelector('[data-remote-connect]');
  const access = document.querySelector('[data-remote-card="access"]');
  const heads = [...card.querySelectorAll('.guide h4')].map(n => n.textContent.trim());
  const hints = [...card.querySelectorAll('.guide > .hint')].map(n => n.textContent);
  return {
    open: card.hasAttribute('data-remote-card-open'),
    inGuide: !!d && card.contains(d),
    noDetails: !card.querySelector('details'),
    visible: !!d && !d.closest('[inert]') && d.getBoundingClientRect().height > 0,
    heads,
    hasServe: !!d?.textContent.includes('tailscale serve --bg --https=443 http://127.0.0.1:'),
    hasName: !!d?.textContent.includes('Self.DNSName'),
    hints,
    funnel: !!card.querySelector('.guide > .warn-line'),
    checklist: card.querySelector('#remote-checklist ~ .checklist')?.children.length ?? 0,
    firstRow: [...row.parentElement.children].filter(c => c.classList.contains('srow'))[0] === row,
    rowInAccess: access.contains(row),
    toggleInHead: !!document.getElementById('remote-enabled').closest('.slist-row'),
    oldStatusRow: !!document.querySelector('.srow.status'),
    oldFunnelLink: !!document.querySelector('[data-remote-serve-chip]'),
  };
})())`),
);
console.log("guide:", JSON.stringify(guide));
check(guide.open && guide.inGuide && guide.noDetails && guide.visible, "직접 설정하기는 설정 안내 카드 안에 펼쳐 보인다");
check(guide.heads.join("|") === "연결 뒤|보안 점검|직접 설정하기", `차례 = 연결 뒤 → 보안 점검 → 직접 설정하기 (${guide.heads})`);
check(guide.hasServe && guide.hasName, "serve 명령 · 이름 찾기가 그 안에 있다");
check(guide.hints.length >= 1 && guide.hints[0].includes("연결 요청"), `연결 뒤는 [연결 요청] 단계 (${guide.hints.length})`);
check(guide.funnel, "Funnel 경고가 연결 뒤에 있다");
check(guide.checklist === 5, `보안 점검 다섯 줄 (${guide.checklist})`);
check(guide.firstRow && guide.rowInAccess && guide.toggleInHead, "연결 줄이 원격 접속 카드의 맨 위 · 토글은 머리");
check(guide.oldStatusRow === false, "옛 상태 줄(.srow.status)이 없다");
await ev(`document.querySelector('[data-remote-manual]').scrollIntoView()`);
await sleep(150);
await shot("8-guide.png");

// ── 좁은 창 ──
await click(`[data-remote-card-toggle="access"]`);
await sleep(300);
await send("Emulation.setDeviceMetricsOverride", { width: 720, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await ev(`document.querySelector('[data-remote-connect]').scrollIntoView()`);
await sleep(150);
const narrow = await read();
console.log("narrow:", JSON.stringify(narrow));
check(narrow.state === "ready", "좁은 창에서도 그려진다");
const overflow = await ev(`(() => { const r = document.querySelector('[data-remote-connect]'); const b = r.getBoundingClientRect(); return [...r.querySelectorAll('button, .line2')].every(n => { const c = n.getBoundingClientRect(); return c.left >= b.left - 0.5 && c.right <= b.right + 0.5; }); })()`);
check(overflow === true, "좁은 창에서 줄 밖으로 넘치지 않음");
await shot("9-narrow.png");

ws.close();
console.log(failed ? `FAILED ${failed}` : "ALL PASS");
process.exit(failed ? 1 : 0);
