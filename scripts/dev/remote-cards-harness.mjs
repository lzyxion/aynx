// 헤드리스 검증 — **설정 › 원격 접속의 상태 줄 + 펼침 카드 넷** (2026-11-07). 명령은 전부 스텁이다 — tailscale 을 부르지 않는다.
//
// ① 처음 펼침(연결 전만 원격 접속 · 나머지 접힘) · 읽기 전에는 아무 카드도 안 열림(지난 값으로 열렸다 닫히지 않음) · 초록이 깜빡이지 않음 ② 한 번에 한 장
// ③ 토글 · 칩 · [모두 끊기] 를 실제 좌표로 눌러도 안 여닫힘(빈 자리 · 글자는 여닫음) ④ 경고 칩 → 보안 화면 ⑤ 폴링에도 사용자가 연/닫은 상태 유지
// ⑥ 앵커는 접힌 카드를 펴고 그 칸으로 간다 ⑦ 머리 안 중첩 단추 없음 ⑧ [모두 끊기] 실패면 기기 카드가 열림 ⑨ 720 · 400 폭 넘침 없음 ⑩ 원격 창
// ⑪ 상태별 제목 · 톤 · 칩 ⑫ 상태 줄 ↔ 첫 카드 2px · 끝 곡률 ⑬ 기록 경고 칩.
//
//   node scripts/dev/run-harness.mjs remote-cards-harness.mjs <outdir> --size 1200x900 --timeout 180
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

const HOST = "mypc.tail1234.ts.net";
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; let nextSession = 100;
  performance.setResourceTimingBufferSize(5000);
  const remoteMode = sessionStorage.getItem('h-remote');
  if (remoteMode) window.__AYNX_REMOTE__ = true;
  window.__stub = {
    status: remoteMode === '1'
      ? { enabled: true, listening: true, port: 47821, host: '${HOST}', funnel: 'off', tailscaleCli: true }
      : { enabled: false, listening: false, port: 47822, host: '', funnel: 'off', tailscaleCli: true },
    serve: { state: 'none' },
    devices: [],
    log: [],
    next: null,
    holdServe: false, releaseServe: [],  // true 면 remote_serve_status 가 답을 미룬다
    holdAccess: false, releaseAccess: [], // true 면 remote_status 가 답을 미룬다
    disconnect: 1,      // 문자열이면 remote_disconnect_all 이 그 글로 실패한다
    vault: { state: 'unlocked', hasMaster: false, entryCount: 0 },
  };
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] }, get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' }, list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }],
    load_snippets: null, save_snippets: null, save_settings: null, host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, resize_session: null, write_session: null, close_session: null, reap_window_sessions: null,
    vault_list: [], mcp_status: { clis: [] }, mcp_activity: null, list_forwards: [], session_log_path: null,
    audit_status: { state: 'off', written: 0, failed: 0 }, audit_runs: [], operation_results: {}, list_console_sessions: [], delegation_list_targets: [],
    list_operations: { pending: [], recent: [] }, agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [],
    'plugin:notification|is_permission_granted': true, 'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      const s = window.__stub;
      ${WORKSPACE_STUB}
      if (cmd === 'plugin:event|listen') return Promise.resolve(args.handler);
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      if (cmd === 'load_settings') return Promise.resolve(remoteMode === '1' ? { remote: { enabled: true, host: '${HOST}' } } : {});
      if (cmd === 'vault_status') return Promise.resolve(s.vault);
      if (cmd === 'remote_status') return s.holdAccess ? new Promise((r) => s.releaseAccess.push(() => r(s.status))) : Promise.resolve(s.status);
      if (cmd === 'remote_devices_list') return Promise.resolve(s.devices);
      if (cmd === 'remote_log') return Promise.resolve(s.log);
      if (cmd === 'remote_serve_status') return s.holdServe ? new Promise((r) => s.releaseServe.push(() => r(s.serve))) : Promise.resolve(s.serve);
      if (cmd === 'remote_serve_connect') { if (s.next?.kind === 'connected') s.serve = { state: 'ours' }; return Promise.resolve(s.next); }
      if (cmd === 'remote_disconnect_all') return typeof s.disconnect === 'string' ? Promise.reject(s.disconnect) : Promise.resolve(s.disconnect);
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
const viewport = (width, height) => send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
await viewport(1200, 900);
await ev(`sessionStorage.removeItem('h-remote')`);
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);

const modUrl = (part) => `performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${part}'))`;
const overlays = `(async () => await import(${modUrl("app/overlays.svelte.ts")}))()`;
const goTo = async (section, anchor = null) => {
  await ev(`(async () => (await ${overlays}).openSettingsAt(${JSON.stringify(section)}, ${JSON.stringify(anchor)}))()`);
  await sleep(500);
};
/** 섹션을 떠났다 돌아온다 — 처음 펼침을 다시 정한다 */
const reenter = async () => {
  await goTo("theme");
  await goTo("remote");
};
const setStub = (js) => ev(`(() => { const s = window.__stub; ${js}; return 1; })()`);
const openCards = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-remote-card-open]')].map((c) => c.dataset.remoteCard))`));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
/** 실제 좌표로 누른다 — `.click()` 은 덮개가 가로채는지 못 본다. 그 자리의 맨 위 요소(`hit`)를 돌려준다 */
const realClick = async (js) => {
  const p = JSON.parse(
    await ev(`JSON.stringify((() => { const el = ${js}; if (!el) return null; el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect(); const x = r.left + r.width / 2; const y = r.top + r.height / 2; const top = document.elementFromPoint(x, y); return { x, y, hit: top ? top.tagName + '.' + top.className : null, inside: !!top && (top === el || el.contains(top) || top.contains(el)) }; })())`),
  );
  if (!p) return null;
  await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: p.x, y: p.y, button: "left", clickCount: 1 });
  await sleep(300);
  return p;
};
const clickHead = (id) => realClick(`document.querySelector('[data-remote-card-toggle="${id}"]')`);

/** 상태 줄 읽기 */
const readState = async () =>
  JSON.parse(
    await ev(`JSON.stringify((() => { const r = document.querySelector('[data-remote-status]'); return { phase: r?.dataset.remoteStatus, tone: r?.dataset.tone, title: r?.querySelector('.name')?.textContent.trim(), note: r?.querySelector('.vstate-note')?.textContent.trim(), chips: [...(r?.querySelectorAll('[data-chip]') ?? [])].map((c) => c.dataset.chip), noMaster: !!r?.querySelector('[data-remote-no-master]'), chipRow: !!r?.querySelector('.vstate-chips') }; })())`),
  );
/** 스텁을 고치고 다시 들어와 상태 줄 · 처음 펼침을 본다 */
const expectState = async (name, js, want, open) => {
  await setStub(js);
  await reenter();
  await sleep(300);
  const st = await readState();
  const ok = st.title === want.title && st.tone === want.tone && eq(st.chips, want.chips ?? []) && st.noMaster === !!want.noMaster && st.chipRow === ((want.chips ?? []).length > 0 || !!want.noMaster) && (want.note === undefined || st.note === want.note);
  check(ok, `상태 — ${name}: ${st.title} · ${st.tone} · 칩 [${st.chips}] · 경고 ${st.noMaster} · "${st.note}"`);
  const cards = await openCards();
  check(eq(cards, open), `처음 펼침 — ${name}: [${cards}]`);
};
const NOW = new Date().toISOString();
const DEV = (over = {}) => ({ id: "d1", name: "내 폰 · Chrome", created: NOW, lastSeen: NOW, unlocked: true, connected: 1, ...over });
const LOG = [
  { at: NOW, kind: "unlocked", deviceId: "d1", deviceName: "내 폰" },
  { at: NOW, kind: "paired", deviceId: "d1", deviceName: "내 폰" },
];

// ── ① 처음 펼침: 연결 전 ──
await goTo("remote");
await sleep(300);
check(eq(await openCards(), ["access"]), `연결 전 → 원격 접속 카드 (${await openCards()})`);
await shot("1-first.png");
const off0 = await readState();
check(off0.title === "원격 접속 꺼짐" && off0.tone === "neutral" && off0.note === "[연결] 한 번으로 시작합니다." && off0.chips.length === 0 && !off0.chipRow, `꺼짐 상태 줄 (${off0.title} · ${off0.tone} · ${off0.note})`);
const heads = JSON.parse(
  await ev(`JSON.stringify([...document.querySelectorAll('[data-remote-card]')].map((c) => ({ id: c.dataset.remoteCard, title: c.querySelector('.slist-name').textContent.trim(), sup: c.querySelector('.head-sup').textContent.replace(/\\s+/g, ' ').trim() })))`),
);
console.log("heads:", JSON.stringify(heads));
check(heads.map((h) => h.id).join() === "access,devices,log,guide", "카드 넷의 차례");
check(heads.map((h) => h.title).join("|") === "원격 접속|페어링된 기기|최근 기록|설정 안내", "제목");
check(heads[1].sup === "없음" && heads[2].sup === "없음", `기기 · 기록이 없으면 "없음" (${heads[1].sup} / ${heads[2].sup})`);
check(heads[3].sup === "연결 뒤 · 보안 점검 · 직접 설정", `설정 안내 머리 (${heads[3].sup})`);
check(heads[0].sup === "연결 전", `원격 접속 머리 = 연결 전 (${heads[0].sup})`);
check((await ev(`!document.querySelector('.srow.status')`)) === true, "옛 상태 줄(.srow.status)이 없다");
check(((await ev(`document.querySelector('#remote-enabled').closest('.slist-switch').title`)) ?? "").includes("관문"), "토글 머리에 켜기 설명 툴팁이 남아 있다");
check((await ev(`document.querySelectorAll('.slist-open button, .slist-open a, button button').length`)) === 0, "머리 단추 안에 중첩 단추가 없다");

// ── [연결] → 연결됨 + 기기 0 ──
await setStub(`s.next = { kind: 'connected', host: '${HOST}', url: 'https://${HOST}/' }`);
await realClick(`document.querySelector('[data-remote-connect-go]')`);
await sleep(300);
check((await ev(`document.querySelector('[data-remote-connect]').dataset.state`)) === "connected", "[연결] → 연결됨");
check(eq(await openCards(), ["access"]), "[연결] 이 성공해도 보던 카드를 닫지 않는다");
const ON = `{ enabled: true, listening: true, port: 47822, host: '${HOST}', funnel: 'off', tailscaleCli: true }`;
const MASTER = `s.vault = { state: 'unlocked', hasMaster: true, entryCount: 0 }`;
const NOMASTER = `s.vault = { state: 'unlocked', hasMaster: false, entryCount: 0 }`;

// ── ⑪ 상태별 제목 · 톤 · 칩 · 처음 펼침(저장된 켬 — [연결] 이 저장했다) ──
await expectState("페어링 대기", `${MASTER}; s.status = ${ON}; s.serve = { state: 'ours' }`, { title: "연결됨 · 페어링 대기", tone: "ok", note: "다른 기기에서 주소를 열고 페어링합니다." }, []);
await shot("2-connected-no-device.png");
check((await ev(`document.querySelector('[data-remote-access-url]').textContent`)) === `https://${HOST}/`, "연결되면 원격 접속 머리 = 주소");
check((await ev(`document.querySelector('[data-remote-access-url]').classList.contains('mono') || getComputedStyle(document.querySelector('[data-remote-access-url]')).fontFamily.toLowerCase().includes('mono')`)) === true, "주소는 mono");
// 복사 단추는 머리에 하나 — 눌러도 카드가 여닫히지 않는다(덮개가 아니라 단추가 받는다)
const copyHit = JSON.parse(
  await ev(`(() => { const b = document.querySelector('[data-remote-card="access"] [data-remote-url-copy]'); if (!b) return JSON.stringify({ found: false }); const r = b.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); const count = document.querySelectorAll('[data-remote-url-copy]').length; b.click(); return JSON.stringify({ found: true, count, hit: top === b || b.contains(top), open: [...document.querySelectorAll('[data-remote-card-open]')].map((c) => c.dataset.remoteCard) }); })()`),
);
console.log("copy:", JSON.stringify(copyHit));
check(copyHit.found && copyHit.count === 1, "머리에 복사 단추 하나");
check(copyHit.hit === true, "복사 단추가 눌림을 받는다(덮개에 가리지 않음)");
check(copyHit.open?.length === 0, `복사를 눌러도 카드가 펼쳐지지 않는다 (${copyHit.open})`);
await expectState("페어링 대기 · 마스터 없음", `${NOMASTER}`, { title: "연결됨 · 페어링 대기", tone: "warn", note: "마스터 암호가 없어 페어링된 기기는 암호 없이 열립니다.", noMaster: true }, []);
await shot("2b-no-master.png");
await expectState("사용 중", `${MASTER}; s.devices = ${JSON.stringify([DEV(), DEV({ id: "d2", name: "노트북", unlocked: false, connected: 0 })])}; s.log = ${JSON.stringify(LOG)}`, { title: "원격 접속 사용 중", tone: "ok", note: "페어링한 기기만 들어올 수 있습니다." }, []);
await shot("3-done-all-closed.png");
await expectState("사용 중 · 마스터 없음", NOMASTER, { title: "원격 접속 사용 중", tone: "warn", note: "마스터 암호가 없어 페어링된 기기는 암호 없이 열립니다.", noMaster: true }, []);
const doneHeads = JSON.parse(
  await ev(`JSON.stringify({ open: document.querySelector('[data-remote-open-count]')?.textContent.trim(), devices: document.querySelector('[data-remote-card="devices"] .head-sup').textContent.replace(/\\s+/g, ' ').trim(), last: document.querySelector('[data-remote-log-last]').textContent.trim(), all: !!document.querySelector('[data-remote-disconnect-all]') })`),
);
console.log("done heads:", JSON.stringify(doneHeads));
check(doneHeads.open === "1대 열림" && doneHeads.devices.includes("전체 2대"), `기기 머리 = 열린 수 + 전체 수 (${doneHeads.devices})`);
check(doneHeads.last.endsWith("열림 · 내 폰"), `기록 머리 = 가장 최근 한 줄 (${doneHeads.last})`);
check(doneHeads.all, "열린 기기가 있으면 머리에 [모두 끊기]");
await expectState("Funnel 판정 불가 — 연결됨이어도 칩", `${MASTER}; s.status = { ...${ON}, funnel: 'unknown' }`, { title: "원격 접속 사용 중", tone: "ok", chips: ["funnel"] }, []);
await expectState("관문 닫힘", `s.status = { ...${ON}, listening: false, funnel: 'on', error: 'closed' }; s.devices = []`, { title: "관문 닫힘", tone: "bad", note: "이 포트가 Funnel 에 보여 앱이 관문을 닫았습니다.", chips: ["stopped", "funnel"] }, ["access"]);
await shot("7-funnel-closed.png");
check((await ev(`document.querySelector('[data-remote-access-url]').textContent`)) === `https://${HOST}/`, "관문이 닫혀도 serve 가 남아 있으면 머리 주소는 연결 줄과 같다(닫힘은 상태 줄이 말함)");
await expectState("관문 닫힘 · 마스터 없음", NOMASTER, { title: "관문 닫힘", tone: "bad", chips: ["stopped", "funnel"], noMaster: true }, ["access"]);
await expectState("serve 의 Funnel", `${MASTER}; s.status = ${ON}; s.serve = { state: 'funnel' }`, { title: "Funnel 로 공개 중", tone: "bad", chips: ["funnel"] }, ["access"]);
await expectState("수신 실패", `s.serve = { state: 'ours' }; s.status = { ...${ON}, listening: false, error: '받을 이름이 없어 열지 않았습니다' }`, { title: "수신 실패", tone: "bad", chips: ["failed"] }, ["access"]);
check((await ev(`document.querySelector('[data-remote-card="access"] .footnote')?.textContent`)) === "받을 이름이 없어 열지 않았습니다", "status.error 는 몸통 각주에 남는다");
await expectState("켠 직후(오류 없음) — 실패로 말하지 않는다", `s.status = { ...${ON}, listening: false, funnel: 'unknown' }`, { title: "확인 중…", tone: "neutral" }, []);
await expectState("CLI 없음 — 토글이 켜져 있어도", `s.status = { ...${ON}, tailscaleCli: false, funnel: 'unknown' }`, { title: "Tailscale 없음", tone: "warn", note: "Tailscale 이 없어 다른 기기에서 접속할 수 없습니다.", chips: ["cli"] }, ["access"]);
await shot("8-no-cli.png");
await expectState("serve 없음", `s.status = ${ON}; s.serve = { state: 'none' }`, { title: "아직 연결 안 됨", tone: "warn", note: "다른 기기에서 접속할 수 없습니다. [연결] 로 잇습니다." }, ["access"]);
await shot("9-no-serve.png");
check((await ev(`document.querySelector('[data-remote-access-url]').textContent`)) === "연결 전", "serve 가 없으면 원격 접속 머리 = 연결 전");
check((await ev(`!document.querySelector('[data-remote-url-copy]')`)) === true, "주소가 없으면 복사 단추도 없다");
await expectState("남의 443", `s.serve = { state: 'other', target: 'http://127.0.0.1:3000' }`, { title: "443 을 다른 대상이 사용 중", tone: "warn" }, ["access"]);
await expectState("serve 못 읽음", `s.serve = { state: 'unknown' }`, { title: "serve 를 확인하지 못함", tone: "warn" }, ["access"]);
await expectState("정상으로 복귀", `s.serve = { state: 'ours' }`, { title: "연결됨 · 페어링 대기", tone: "ok" }, []);

// ── ⑫ 이어 붙이기 ──
const seam = async () =>
  JSON.parse(
    await ev(`JSON.stringify((() => { const st = document.querySelector('[data-remote-status]'); const cs = getComputedStyle(st); const first = document.querySelector('[data-remote-card="access"]'); const last = document.querySelector('[data-remote-card="guide"]'); const fc = getComputedStyle(first); return { gap: first.getBoundingClientRect().top - st.getBoundingClientRect().bottom, top: parseFloat(cs.borderTopLeftRadius), bottom: parseFloat(cs.borderBottomLeftRadius), firstTop: parseFloat(fc.borderTopLeftRadius), lastBottom: parseFloat(getComputedStyle(last).borderBottomLeftRadius), left: st.getBoundingClientRect().left - first.getBoundingClientRect().left, right: st.getBoundingClientRect().right - first.getBoundingClientRect().right, leadGap: st.getBoundingClientRect().top - document.querySelector('.settings-panel section:not([hidden]) .lead').getBoundingClientRect().bottom }; })())`),
  );
const closedSeam = await seam();
console.log("seam closed:", JSON.stringify(closedSeam));
check(closedSeam.gap === 2, `상태 줄 ↔ 첫 카드 간격 2px (${closedSeam.gap})`);
check(closedSeam.top === 12 && closedSeam.bottom === 4 && closedSeam.firstTop === 4 && closedSeam.lastBottom === 12, `위 끝은 상태 줄 · 아래 끝은 마지막 카드만 큰 곡률 (${closedSeam.top}/${closedSeam.bottom}/${closedSeam.firstTop}/${closedSeam.lastBottom})`);
check(closedSeam.left === 0 && closedSeam.right === 0, "상태 줄과 카드의 좌우가 맞는다");
await clickHead("access");
await sleep(150);
const openSeam = await seam();
console.log("seam open:", JSON.stringify(openSeam));
check(openSeam.gap === 2 && openSeam.bottom === 4 && openSeam.firstTop === 4, `첫 카드를 펴도 상태 줄과 2px 로 이어진다 (간격 ${openSeam.gap} · ${openSeam.bottom}/${openSeam.firstTop})`);
await shot("10-seam-open.png");
await clickHead("access");
await sleep(150);

// ── 잘못된 카드가 열렸다 닫히지 않는다 — 지난 값(초록)이 남은 채 다시 들어와도 새로 읽기 전에는 확인 중 · 아무것도 안 연다 ──
await goTo("theme");
await setStub(`s.serve = { state: 'none' }; s.holdServe = true; s.holdAccess = true`);
await ev(`(() => {
  window.__opened = [];
  window.__tones = [];
  const root = document.querySelector('.remote-list');
  window.__watch = new MutationObserver((ms) => { for (const m of ms) { if (m.target.dataset?.remoteCard && m.target.hasAttribute('data-remote-card-open')) window.__opened.push(m.target.dataset.remoteCard); if (m.target.id === 'remote-state') window.__tones.push(m.target.dataset.tone); } });
  window.__watch.observe(root, { subtree: true, attributes: true, attributeFilter: ['data-remote-card-open', 'data-tone'] });
})()`);
await goTo("remote");
await sleep(400);
check(eq(await openCards(), []), `읽기 전에는 모두 접힘 (${await openCards()})`);
const checkingState = await readState();
check(checkingState.title === "확인 중…" && checkingState.tone === "neutral" && checkingState.phase === "checking", `읽기 전 상태 줄 = 확인 중 · 중립 (${checkingState.title} · ${checkingState.tone})`);
await setStub(`s.holdAccess = false; s.releaseAccess.splice(0).forEach((f) => f())`);
await sleep(200);
check(eq(await openCards(), []), "상태만 받고 serve 판정이 아직이면 그대로 접힘");
check((await readState()).tone === "neutral", "serve 판정 전에는 초록도 경고도 아니다");
await setStub(`s.holdServe = false; s.releaseServe.splice(0).forEach((f) => f())`);
await sleep(300);
check(eq(await openCards(), ["access"]), `새로 읽은 값으로 한 번 연다 (${await openCards()})`);
const seenWatch = JSON.parse(await ev(`(() => { window.__watch.disconnect(); return JSON.stringify({ opened: window.__opened, tones: window.__tones }); })()`));
check(eq(seenWatch.opened, ["access"]), `그 사이 다른 카드가 열린 적 없다 (${JSON.stringify(seenWatch.opened)})`);
check(!seenWatch.tones.includes("ok"), `초록이 깜빡인 적 없다 (${JSON.stringify(seenWatch.tones)})`);

// ── 받기 전에 사람이 먼저 열면 그대로 둔다 ──
await goTo("theme");
await setStub(`s.holdServe = true`);
await goTo("remote");
await clickHead("log");
check(eq(await openCards(), ["log"]), "데이터를 받기 전에 사람이 연 카드");
await setStub(`s.holdServe = false; s.releaseServe.splice(0).forEach((f) => f())`);
await sleep(300);
check(eq(await openCards(), ["log"]), `받은 뒤에도 사람이 연 카드가 그대로 (${await openCards()})`);

// ── ⑬ 기록 경고 칩 — 화면에 그리는 12건 기준 ──
const failLog = (n) => Array.from({ length: n }, () => ({ at: NOW, kind: "unlockFailed", deviceId: "d1", deviceName: "내 폰" }));
await setStub(`s.serve = { state: 'ours' }; s.log = ${JSON.stringify([...failLog(2), ...LOG])}`);
await sleep(3400);
const failChip = async () => ev(`document.querySelector('[data-remote-card="log"] [data-remote-log-failed]')?.textContent.trim() ?? null`);
check((await failChip()) === "잠금 해제 실패 2", `실패가 있으면 머리에 칩 (${await failChip()})`);
await shot("11-log-failed.png");
const chipHit = await realClick(`document.querySelector('[data-remote-log-failed]')`);
check(chipHit?.inside === true && eq(await openCards(), ["log"]), `기록 칩을 눌러도 여닫힘 없음 (${chipHit?.hit})`);
const oldFail = Array.from({ length: 12 }, () => LOG[0]).concat(failLog(1));
await setStub(`s.log = ${JSON.stringify(oldFail)}`);
await sleep(3400);
check((await failChip()) === null, "그리는 12건 밖으로 밀려나면 칩도 사라진다");
await setStub(`s.log = ${JSON.stringify(LOG)}`);
await sleep(3400);
check((await failChip()) === null, "실패가 없으면 칩 없음");

// ── ② 한 번에 한 장 ──
await setStub(`s.vault = { state: 'unlocked', hasMaster: false, entryCount: 0 }; s.devices = ${JSON.stringify([DEV()])}`);
await reenter();
await sleep(300);
for (const id of ["access", "devices", "log", "guide", "access"]) {
  await clickHead(id);
  check(eq(await openCards(), [id]), `${id} 를 누르면 그 카드만 열림 (${await openCards()})`);
}
const insideInert = await ev(`(() => { const closed = [...document.querySelectorAll('[data-remote-card]:not([data-remote-card-open]) .slist-collapse')]; return closed.length === 3 && closed.every((c) => c.inert); })()`);
check(insideInert === true, "접힌 카드 몸통은 inert");
await clickHead("access");
check(eq(await openCards(), []), "같은 카드를 다시 누르면 모두 접힘");

// ── ③ 머리의 손잡이 · 칩은 여닫지 않는다(실제 좌표) ──
for (const [name, js] of [
  ["토글", `document.getElementById('remote-enabled')`],
  ["열린 수 칩", `document.querySelector('[data-remote-open-count]')`],
]) {
  const before = await openCards();
  const p = await realClick(js);
  check(p?.inside === true, `${name} 이 그 자리의 맨 위에 있다 (${p?.hit})`);
  check(eq(await openCards(), before), `${name} 을 눌러도 여닫힘 없음 (${await openCards()})`);
}
// 토글을 눌렀으니 저장 전 칩이 선다 — 그 칩도 여닫지 않는다, 그다음 되돌린다
const unsavedHit = await realClick(`document.querySelector('[data-remote-unsaved]')`);
check(unsavedHit?.inside === true && eq(await openCards(), []), `저장 칩을 눌러도 여닫힘 없음 (${unsavedHit?.hit})`);
await ev(`document.getElementById('remote-enabled').click()`);
await sleep(150);
await realClick(`document.querySelector('[data-remote-card="devices"] .head-sup > span:not(.status-chip)')`);
check(eq(await openCards(), ["devices"]), "칩 줄의 글자는 머리를 누른 것과 같다");
await realClick(`document.querySelector('[data-remote-card="devices"] .slist-chev')`);
check(eq(await openCards(), []), "꺾쇠를 누르면 닫힌다");
const allBtn = await realClick(`document.querySelector('[data-remote-disconnect-all]')`);
check(allBtn?.inside === true, `[모두 끊기] 가 그 자리의 맨 위에 있다 (${allBtn?.hit})`);
check(eq(await openCards(), []), "[모두 끊기] 를 눌러도 여닫힘 없음");

// ── 공용 꺾쇠 — 펼친 카드의 꺾쇠는 회전(transform)으로 덮개 위에 올라와도 눌림을 줄 단추로 흘린다(settings.css · AI 에이전트에서 사용자 실기로 찾음 11-07) ──
await goTo("ai");
const firstAgent = await ev(`document.querySelector('.settings-view [data-agent-expand]')?.getAttribute('data-agent-expand')`);
check(!!firstAgent, `AI 에이전트 카드가 있다 (${firstAgent})`);
const agentOpen = () => ev(`document.querySelector('[data-agent-expand="${firstAgent}"]').getAttribute('aria-expanded')`);
const agentChev = `document.querySelector('[data-agent="${firstAgent}"] .slist-chev')`;
await realClick(agentChev);
check((await agentOpen()) === "true", "AI 에이전트 · 접힌 꺾쇠를 누르면 펼친다");
await sleep(300);
const openChev = await realClick(agentChev);
check(openChev?.hit?.startsWith("BUTTON") && openChev.hit.includes("slist-open"), `AI 에이전트 · 펼친 꺾쇠 자리의 맨 위는 줄 단추다 (${openChev?.hit})`);
check((await agentOpen()) === "false", "AI 에이전트 · 펼친 꺾쇠를 누르면 닫힌다");
await goTo("remote");

// ── ⑧ [모두 끊기] 실패 → 기기 카드가 열려 오류를 보인다 ──
await setStub(`s.disconnect = '끊기 실패: 시험'`);
await realClick(`document.querySelector('[data-remote-disconnect-all]')`);
await sleep(200);
check(eq(await openCards(), ["devices"]), `실패하면 기기 카드가 열린다 (${await openCards()})`);
check((await ev(`document.querySelector('[data-remote-card="devices"] [role=alert]')?.textContent`)) === "끊기 실패: 시험", "오류 줄이 보인다");
await shot("4-disconnect-failed.png");
await setStub(`s.disconnect = 1`);

// ── ⑤ 폴링에도 사용자가 연/닫은 상태 유지 ──
await clickHead("log");
check(eq(await openCards(), ["log"]), "최근 기록을 연다");
await setStub(`s.log = [{ at: new Date().toISOString(), kind: 'connected', deviceId: 'd1', deviceName: '내 폰' }, ...s.log]`);
await sleep(4000);
check(eq(await openCards(), ["log"]), `폴링이 지나도 연 카드 유지 (${await openCards()})`);
check((await ev(`document.querySelector('[data-remote-log-last]').textContent.includes('창 붙음')`)) === true, "폴링 값은 머리에 반영된다");
await clickHead("log");
await setStub(`s.devices = []`);
await sleep(4000);
check(eq(await openCards(), []), `폴링으로 판정 재료가 바뀌어도 닫은 채 유지 (${await openCards()})`);
await setStub(`s.devices = ${JSON.stringify([DEV()])}`);
await sleep(3400);
// 칩이 있어도 줄이 벌어지지 않게 상태 줄 ↔ 카드 2px 은 칩 있는 상태에서도 잰다
check((await seam()).gap === 2, "경고 칩이 서도 상태 줄 ↔ 첫 카드 2px");

// ── ④ 경고 칩 → 보안 화면 ──
const warn = await realClick(`document.querySelector('[data-remote-no-master]')`);
check(warn?.inside === true, `경고 칩이 그 자리의 맨 위에 있다 (${warn?.hit})`);
await sleep(300);
check((await ev(`document.getElementById('remote-enabled').getClientRects().length`)) === 0, "경고 칩을 누르면 보안 화면으로 간다(원격 접속이 안 보임)");

// ── ⑥ 앵커 ──
for (const [anchor, card] of [
  ["remote-host", "access"],
  ["remote-port", "access"],
  ["remote-checklist", "guide"],
  ["remote-devices-label", "devices"],
]) {
  await goTo("theme");
  await goTo("remote");
  await sleep(200);
  check(eq(await openCards(), []), `앵커 시험 앞 — 모두 접힘(${anchor})`);
  await goTo("remote", anchor);
  await sleep(200);
  const r = JSON.parse(
    await ev(`JSON.stringify((() => { const el = document.getElementById(${JSON.stringify(anchor)}); const b = el.getBoundingClientRect(); return { open: [...document.querySelectorAll('[data-remote-card-open]')].map((c) => c.dataset.remoteCard), inert: !!el.closest('[inert]'), h: b.height, inView: b.top >= 0 && b.bottom <= innerHeight, focus: document.activeElement === el, canFocus: el.matches('input') }; })())`),
  );
  check(eq(r.open, [card]), `앵커 ${anchor} → ${card} 카드가 펼쳐짐 (${r.open})`);
  check(!r.inert && r.h > 0 && r.inView, `앵커 ${anchor} 칸이 inert 밖 · 화면 안 (inert ${r.inert} · 높이 ${r.h} · 보임 ${r.inView})`);
  if (r.canFocus) check(r.focus, `앵커 ${anchor} 칸에 포커스`);
}
// 들어오면서 앵커로 곧장(판정이 앵커를 덮지 않는다)
await goTo("theme");
await setStub(`s.holdServe = true`);
await goTo("remote", "remote-checklist");
await setStub(`s.holdServe = false; s.releaseServe.splice(0).forEach((f) => f())`);
await sleep(400);
check(eq(await openCards(), ["guide"]), `앵커로 들어오면 판정이 덮지 않는다 (${await openCards()})`);
// 머리의 토글은 늘 보이므로 펼치지 않는다
await clickHead("guide");
await goTo("remote", "remote-enabled");
check(eq(await openCards(), []), "머리 토글 앵커는 카드를 펴지 않는다");

// ── ⑨ 폭 ──
const OVERFLOW = `JSON.stringify((() => {
  const panel = document.querySelector('.settings-panel') ?? document.querySelector('.remote-list').parentElement;
  const list = document.querySelector('.remote-list').getBoundingClientRect();
  const bad = [...document.querySelectorAll('.remote-list *')].filter((n) => {
    if (n.closest('[inert]') || n.closest('.command-block pre')) return false;
    const r = n.getBoundingClientRect();
    return r.width > 0 && (r.right > list.right + 0.5 || r.left < list.left - 0.5);
  }).map((n) => n.tagName + '.' + n.className);
  return { doc: document.documentElement.scrollWidth - innerWidth, panel: panel.scrollWidth - panel.clientWidth, list: list.width, bad: bad.slice(0, 5) };
})())`;
for (const [w, h] of [[720, 700], [400, 800]]) {
  await viewport(w, h);
  await setStub(`s.status = { ...${ON}, listening: false, funnel: 'on', error: 'closed' }`);
  await goTo("theme");
  await goTo("remote");
  await sleep(300);
  await shot(`5-${w}-state.png`);
  for (const id of ["access", "devices", "log", "guide"]) {
    const isOpen = eq(await openCards(), [id]);
    if (!isOpen) await clickHead(id);
    await sleep(100);
    const o = JSON.parse(await ev(OVERFLOW));
    check(o.doc <= 0 && o.panel <= 0 && o.bad.length === 0, `${w}px · ${id} — 가로 넘침 없음 (문서 ${o.doc} · 판 ${o.panel} · 목록 폭 ${o.list}${o.bad.length ? " · " + o.bad.join(",") : ""})`);
    await ev(`document.querySelector('[data-remote-card="${id}"]').scrollIntoView({ block: 'start' })`);
    await sleep(100);
    await shot(`5-${w}-${id}.png`);
  }
}
await viewport(1200, 900);

// ── ⑩ 원격 창 — serve 판정 없이 저장된 켬 + 수신 중을 연결됨으로 ──
await ev(`sessionStorage.setItem('h-remote', '1')`);
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);
await goTo("remote");
await sleep(300);
const remote = JSON.parse(
  await ev(`JSON.stringify({ remote: window.__AYNX_REMOTE__ === true, open: [...document.querySelectorAll('[data-remote-card-open]')].map((c) => c.dataset.remoteCard), connect: !!document.querySelector('[data-remote-connect]'), detect: [...document.querySelectorAll('[data-remote-card="access"] button')].some((b) => b.textContent.trim() === '찾기'), hostDisabled: document.getElementById('remote-host')?.disabled, portDisabled: document.getElementById('remote-port')?.disabled, toggleDisabled: document.getElementById('remote-enabled')?.disabled, url: document.querySelector('[data-remote-access-url]')?.textContent })`),
);
console.log("remote:", JSON.stringify(remote));
check(remote.remote, "원격 창 흉내로 떴다");
const r0 = await readState();
check(r0.title === "연결됨 · 페어링 대기" && r0.tone === "warn" && r0.note === "마스터 암호가 없어 페어링된 기기는 암호 없이 열립니다.", `원격 창: 저장된 켬 + 수신 중 + 기기 0 → 페어링 대기 (${r0.title} · ${r0.tone})`);
check(eq(remote.open, []), `원격 창: 연결됨이면 모두 접힘 (${remote.open})`);
check(remote.url === `https://${HOST}/`, `원격 창 머리 주소 (${remote.url})`);
check(!remote.connect && !remote.detect, "원격 창: 연결 줄 · [찾기] 없음");
check(remote.hostDisabled && remote.portDisabled && !remote.toggleDisabled, "원격 창: 이름 · 포트 잠김, 저장된 켬이면 끄기는 산다");
await shot("6-remote-window.png");
await expectState("원격 창 · 기기 있음", `s.vault = { state: 'unlocked', hasMaster: true, entryCount: 0 }; s.devices = ${JSON.stringify([DEV()])}`, { title: "원격 접속 사용 중", tone: "ok" }, []);
await expectState("원격 창 · CLI 판정 무시", `s.status = { ...s.status, tailscaleCli: false }`, { title: "원격 접속 사용 중", tone: "ok" }, []);
await expectState("원격 창 · 수신 실패", `s.devices = []; s.status = { ...s.status, tailscaleCli: true, listening: false, error: 'x' }`, { title: "수신 실패", tone: "bad", chips: ["failed"] }, ["access"]);
// 저장 꺼짐 — [연결] 을 말하지 않는다
await ev(`sessionStorage.setItem('h-remote', 'off')`);
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);
await goTo("remote");
await sleep(300);
const r1 = await readState();
check(r1.title === "원격 접속 꺼짐" && r1.note === "메인 PC 에서 켭니다." && !r1.note.includes("연결"), `원격 창 · 꺼짐 — [연결] 을 말하지 않는다 (${r1.note})`);
check(eq(await openCards(), ["access"]), "원격 창 · 꺼짐 → 원격 접속 카드");
check((await ev(`document.getElementById('remote-enabled').disabled`)) === true, "원격 창 · 꺼짐이면 토글 잠김");
await ev(`sessionStorage.removeItem('h-remote')`);

ws.close();
console.log(failed ? `FAILED ${failed}` : "ALL PASS");
process.exit(failed ? 1 : 0);
