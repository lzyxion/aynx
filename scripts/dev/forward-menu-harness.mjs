// 헤드리스 검증 — 머리줄 포워딩 칩의 호버 카드 · 목록 메뉴 · 추가 모달 · 칩 순서 · 좁은 머리줄 접기 (2026-10-11).
// connect-diag-harness.mjs 의 SSH 스텁에 포워드 표(list_forwards · add_forward · remove_forward)와 경유(proxy_jump)를 얹었다.
// 앱이 건 에이전트 신호 포워드(`purpose: "agent-signal"`)는 표에 섞여 오지만 화면 어디에도 보이지 않는다(2026-10-27 사용자 결정 —
// `$lib/forward` 의 `userForwards`): 칩 개수 · 카드 · 메뉴에서 빠지고, 그것만 남으면 칩도 폴링도 없다(7절).
// usage: node scripts/dev/run-harness.mjs forward-menu-harness.mjs <outdir>
//   → fw-header.png · fw-card.png · fw-menu.png · fw-add-modal.png · fw-narrow.png · fw-dots-menu.png · fw-signal-only.png · fw-signal-plus-one.png
import { waitBoot } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const [outdir = "."] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const list = await (await fetch(`http://127.0.0.1:${process.env.CDP_PORT ?? "9224"}/json`)).json();
const t = list.find((x) => x.type === "page" && x.url.includes(`localhost:${process.env.PAGE_PORT ?? "1420"}`));
const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const events = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  } else if (d.method) events.push(d);
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
const shot = async (path) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(path, Buffer.from(r.result.data, "base64"));
      return "ok";
    }
    await sleep(500);
  }
  return "capture failed";
};
const results = [];
const check = (name, ok, detail = "") => {
  results.push([ok ? "PASS" : "FAIL", name, detail]);
  console.log(ok ? "PASS" : "FAIL", name, detail);
};

const FORWARDS = [
  { id: 1, session_id: 100, kind: "local", local_port: 15432, remote_host: "localhost", remote_port: 5432, conns: 5, active_conns: 2 },
  { id: 2, session_id: 100, kind: "dynamic", local_port: 1080, remote_host: "", remote_port: 0, conns: 0, active_conns: 0 },
  { id: 3, session_id: 100, kind: "remote", local_port: 47001, remote_host: "", remote_port: 47002, conns: 1, active_conns: 0, purpose: "agent-signal" },
];
const PRESETS = [
  { kind: "local", local_port: 15432, remote_host: "localhost", remote_port: 5432 },
  { kind: "dynamic", local_port: 1080, remote_host: "", remote_port: 0 },
];

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  let nextSession = 100;
  window.__forwards = ${JSON.stringify(FORWARDS)};
  const answers = {
    list_hosts: {hosts:[{name:'web-01', host_name:'web-01.internal', user:'deploy', port:22, proxy_jump:'bastion', meta:{color:'#5b9cf6', tags:[], forwards:${JSON.stringify(PRESETS)}}}],warnings:[]},
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {},
    get_host_meta: { tags: [], forwards: ${JSON.stringify(PRESETS)} },
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, resize_ssh: null, write_ssh: null, close_ssh: null,
    reap_window_sessions: null, session_log_path: null, list_snippets: [], load_settings: null,
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'open_ssh_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, tmux: null }); }
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'list_forwards') return Promise.resolve(window.__forwards.map((f) => ({ ...f })));
      if (cmd === 'remove_forward') { window.__forwards = window.__forwards.filter((f) => f.id !== args.id); return Promise.resolve(null); }
      if (cmd === 'add_forward') {
        const f = { id: 10 + window.__forwards.length, session_id: args.sessionId, kind: args.kind, local_port: args.localPort, remote_host: args.remoteHost, remote_port: args.remotePort, conns: 0, active_conns: 0 };
        window.__forwards = [...window.__forwards, f];
        return Promise.resolve(f);
      }
      if (cmd === 'session_info') return Promise.reject('no info');
      if (cmd === 'plugin:opener|open_url') { window.__opened = args; return Promise.resolve(null); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
// 고정 4.5초는 찬 vite(첫 의존성 최적화)에서 앱이 덜 떠 "open: no row" 로 전부 떨어졌다 — 부팅이 끝날 때까지 기다린다
// (탭 줄은 마운트 즉시 서고 부팅은 그 뒤에 끝난다 — `boot-wait.mjs`)
await waitBoot(ev);

const key = async (code, modifiers = 0, keyName = code) => {
  const vk =
    code.startsWith("Key") ? code.charCodeAt(3)
    : { Escape: 27, Enter: 13, ArrowDown: 40, ArrowUp: 38, Home: 36, End: 35 }[code] ?? 0;
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, modifiers, code, key: keyName, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(200);
};

// ── 1. SSH 타일 — 호스트 독에서 web-01 을 연다 (프리셋 자동 열기가 칩 표를 채운다) ─────────────
await key("KeyH", 10, "H");
await sleep(900);
console.log("open:", await ev(`(() => {
  const el = [...document.querySelectorAll('[data-id]')].find((e) => /web-01/.test(e.textContent || ''));
  if (!el) return 'no row';
  el.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
  return 'clicked';
})()`));
await sleep(1800);
await key("KeyH", 10, "H"); // 독을 닫는다
await sleep(600);

const order = await ev(`JSON.stringify((() => {
  const head = document.querySelector('.pane-head');
  if (!head) return null;
  const ident = head.querySelector('.pane-ident');
  return {
    ident: [...ident.children].map((c) => c.className.split(' ').filter((x) => /chip|pane-name|tile-code|sharemark/.test(x)).join('.')).filter(Boolean),
    outside: [...head.children].filter((c) => c !== ident).map((c) => c.className.split(' ')[0]),
    chip: head.querySelector('[data-forward-chip]')?.textContent.trim(),
    chipTitle: head.querySelector('[data-forward-chip]')?.getAttribute('title'),
  };
})())`);
console.log("header:", order);
const o = JSON.parse(order ?? "null");
// 기본 순서(2026-10-23 사용자 결정 — `header-chips.ts` 의 `HEADER_CHIP_IDS`): 폴더 → 브랜치 → 경유 → tmux → 포워딩 → 자원 → AI 권한
const want = ["pane-name", "folder-chip", "jump-chip", "fw-chip", "ai-chip"];
const got = (o?.ident ?? []).map((c) => want.find((w) => c.includes(w))).filter(Boolean);
check("칩 순서 이름 → 폴더 → 경유 → 포워딩 → AI 권한", JSON.stringify(got) === JSON.stringify(want), JSON.stringify(o?.ident));
check("경유·포워딩 칩이 이름 묶음 밖에 없다", !(o?.outside ?? []).some((c) => /chip/.test(c)), JSON.stringify(o?.outside));
check("포워딩 칩에 title 이 없다 (카드가 대신)", o?.chipTitle === null, String(o?.chipTitle));
check("칩 개수 2 — 앱 포워드(에이전트 신호)는 세지 않는다", /2/.test(o?.chip ?? "") && !/3/.test(o?.chip ?? ""), String(o?.chip));
console.log("capture header:", await shot(`${outdir}/fw-header.png`));

// ── 2. 호버 카드 ──────────────────────────────────────────────────────────────
await ev(`(() => {
  const el = document.querySelector('[data-forward-chip]');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, clientX: r.left + 4, clientY: r.top + 4 }));
})()`);
await sleep(900);
const card = await ev(`JSON.stringify((() => {
  const c = document.querySelector('[data-forwards-card]');
  if (!c) return null;
  return {
    head: c.querySelector('.f-head')?.textContent.trim().replace(/\\s+/g, ' '),
    rows: [...c.querySelectorAll('.f-row')].map((r) => r.textContent.trim().replace(/\\s+/g, ' ')),
    opacity: getComputedStyle(c).opacity,
  };
})())`);
console.log("card:", card);
const c = JSON.parse(card ?? "null");
check("호버 카드 — 줄 2개 + 머리 (앱 포워드 줄 없음)",
  c?.rows?.length === 2 && /2/.test(c?.head ?? "") && !c.rows.some((r) => /에이전트|47002/.test(r)), card);
console.log("capture card:", await shot(`${outdir}/fw-card.png`));
await ev(`document.querySelector('[data-forward-chip]').dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))`);
await sleep(150);
check("포인터가 떠나면 카드가 걷힌다", (await ev(`!!document.querySelector('[data-forwards-card]')`)) === false);

// ── 3. 클릭 → 목록 메뉴 ──────────────────────────────────────────────────────
await ev(`document.querySelector('[data-forward-chip]').click()`);
await sleep(500);
const menu = await ev(`JSON.stringify((() => {
  const m = document.querySelector('[data-forward-menu]');
  if (!m) return null;
  const chip = document.querySelector('[data-forward-chip]').getBoundingClientRect();
  const r = m.getBoundingClientRect();
  return {
    rows: [...m.querySelectorAll('[data-forward-row]')].map((row) => ({
      text: row.textContent.trim().replace(/\\s+/g, ' '),
      buttons: [...row.querySelectorAll('button')].map((b) => b.getAttribute('aria-label')),
    })),
    add: m.querySelector('[data-forward-add]')?.textContent.trim(),
    expanded: document.querySelector('[data-forward-chip]').getAttribute('aria-expanded'),
    under: Math.abs(r.left - chip.left) < 2 && r.top >= chip.bottom,
    focus: document.activeElement === m,
  };
})())`);
console.log("menu:", menu);
const mm = JSON.parse(menu ?? "null");
check("메뉴 — 줄 2개 · 추가 줄 · 칩 아래 · aria-expanded", mm?.rows?.length === 2 && !!mm?.add && mm?.under && mm?.expanded === "true", menu);
check("로컬 줄은 열기+중지, 동적은 중지만, 앱 포워드 줄은 없다",
  mm?.rows?.[0]?.buttons?.length === 2 && mm?.rows?.[1]?.buttons?.length === 1 && !mm.rows.some((r) => /에이전트|47002/.test(r.text)),
  JSON.stringify(mm?.rows?.map((r) => r.buttons)));
console.log("capture menu:", await shot(`${outdir}/fw-menu.png`));

// 키보드 — ↓ 는 첫 버튼, End 는 추가 줄, Esc 는 닫고 칩/이전 포커스로
await key("ArrowDown");
const k1 = await ev(`document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim()`);
await key("End");
const k2 = await ev(`document.activeElement?.hasAttribute('data-forward-add')`);
await key("ArrowDown");
const k3 = await ev(`document.activeElement?.getAttribute('aria-label')`);
check("↓ 첫 버튼 · End 추가 줄 · ↓ 고리", /브라우저|browser/i.test(String(k1)) && k2 === true && k3 === k1, `${k1} | ${k2} | ${k3}`);
await key("Escape");
await sleep(200);
check("Esc 로 닫힌다", (await ev(`!!document.querySelector('[data-forward-menu]')`)) === false);

// 토글 — 칩을 두 번 누르면 닫힌다 (pointerdown 이 칩을 비켜 간다)
await ev(`(() => { const b = document.querySelector('[data-forward-chip]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); })()`);
await sleep(300);
await ev(`(() => { const b = document.querySelector('[data-forward-chip]'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); b.click(); })()`);
await sleep(300);
check("칩 두 번 = 열고 닫기", (await ev(`!!document.querySelector('[data-forward-menu]')`)) === false);

// 브라우저에서 열기 — 메뉴가 닫히고 opener 가 불린다
await ev(`document.querySelector('[data-forward-chip]').click()`);
await sleep(400);
await ev(`document.querySelector('[data-forward-row="1"] button').click()`);
await sleep(400);
const opened = await ev(`JSON.stringify(window.__opened ?? null)`);
check("브라우저에서 열기 → opener 호출 · 메뉴 닫힘",
  /127\.0\.0\.1:15432/.test(opened ?? "") && (await ev(`!!document.querySelector('[data-forward-menu]')`)) === false, opened);

// 중지 — 동적 줄
await ev(`document.querySelector('[data-forward-chip]').click()`);
await sleep(400);
await ev(`document.querySelector('[data-forward-row="2"] button').click()`);
await sleep(800);
const afterStop = await ev(`JSON.stringify({
  removed: window.__calls.filter((c) => c[0] === 'remove_forward').map((c) => c[1].id),
  chip: document.querySelector('[data-forward-chip] .n')?.textContent,
  menu: !!document.querySelector('[data-forward-menu]'),
})`);
console.log("after stop:", afterStop);
const as = JSON.parse(afterStop);
check("중지 → remove_forward(2) · 칩 1 · 메뉴 닫힘", as.removed.join() === "2" && as.chip === "1" && !as.menu, afterStop);

// ── 4. 포워딩 추가… → 추가 모달 ───────────────────────────────────────────────
await ev(`document.querySelector('[data-forward-chip]').click()`);
await sleep(400);
await ev(`document.querySelector('[data-forward-add]').click()`);
await sleep(600);
const modal = await ev(`JSON.stringify((() => {
  const d = document.querySelector('[aria-labelledby="fw-title"]');
  if (!d) return null;
  return { title: d.querySelector('#fw-title')?.textContent, list: !!d.querySelector('.fw-list, .fw-empty'), focus: document.activeElement?.id };
})())`);
console.log("modal:", modal);
const md = JSON.parse(modal ?? "null");
check("추가 모달 — 제목 · 목록 없음 · 첫 칸 포커스", !!md && !md.list && md.focus === "fw-local", modal);
console.log("capture modal:", await shot(`${outdir}/fw-add-modal.png`));
await ev(`(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('fw-local', '18080'); set('fw-remote', '8080');
})()`);
await sleep(200);
await ev(`document.querySelector('[aria-labelledby="fw-title"] .actions .primary').click()`);
await sleep(900);
const afterAdd = await ev(`JSON.stringify({
  modal: !!document.querySelector('[aria-labelledby="fw-title"]'),
  chip: document.querySelector('[data-forward-chip] .n')?.textContent,
})`);
check("추가 → 모달 닫힘 · 칩 2", JSON.parse(afterAdd).modal === false && JSON.parse(afterAdd).chip === "2", afterAdd);

// ── 5. ⋯ 메뉴의 "포트 포워딩…" — 포워드가 있으면 같은 목록 메뉴 ─────────────────────
await ev(`(() => { const b = document.querySelector('[data-tile-menu-btn]'); b.click(); })()`);
await sleep(400);
// "포트 포워딩…" 은 `서버 ▸` 옆목록 안에 있다 — 옆목록을 차례로 열어 찾는다
await ev(`(async () => {
  for (const g of document.querySelectorAll('[data-flyout]')) {
    if (document.querySelector('[data-action="forward"]')) break;
    g.click();
    await new Promise((r) => setTimeout(r, 300));
  }
  document.querySelector('[data-action="forward"]')?.click();
})()`);
await sleep(500);
check("⋯ › 포트 포워딩… → 목록 메뉴", (await ev(`!!document.querySelector('[data-forward-menu]')`)) === true);
console.log("capture dots menu:", await shot(`${outdir}/fw-dots-menu.png`));
await key("Escape");
await sleep(200);

// ── 6. 좁은 머리줄 — **재서 접기**(2026-10-23 사용자 결정 · docs/log/2026-10-23-header-chip-fit.md). 예전 고정 문턱(내용 360px
//    이하에서 경유·포워딩 그림만)은 걷혔다: 실제로 넘칠 때만, 사용자 순서(= 중요도)의 **끝에서부터** 한 칩씩 짧은 꼴(그림만 ·
//    포워딩 = 그림 + 트래픽 점) → 그다음 끝에서부터 숨김("+N"). AI 권한 칩(`data-fit-pin`)은 숨지 않는다. 이름은 최소 폭
//    (72px, 이름이 더 짧으면 제 폭)을 지키고 다 접어도 넘칠 때만 준다.
const RANK = { full: 0, compact: 1, icon: 2, hidden: 3 };
let prevFit = null;
const sweep = [];
for (const w of [520, 440, 420, 400, 390, 380, 370, 360, 350, 330, 300, 250]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: 500, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  const m = await ev(`JSON.stringify((() => {
    const head = document.querySelector('.pane-head');
    const name = head.querySelector('.pane-name');
    const vis = (sel) => { const e = head.querySelector(sel); return !!e && getComputedStyle(e).display !== 'none'; };
    return {
      head: Math.round(head.getBoundingClientRect().width),
      // 머리줄 내용 상자 폭(안쪽 여백을 뺀 값)
      cw: Math.round(head.clientWidth - parseFloat(getComputedStyle(head).paddingLeft) - parseFloat(getComputedStyle(head).paddingRight)),
      nameW: Math.round(name.getBoundingClientRect().width),
      nameTrunc: name.scrollWidth > name.clientWidth,
      chips: [...head.querySelectorAll('[data-fit-chip]')].map((c) => ({ id: c.dataset.fitChip, fit: c.dataset.fit, pin: c.hasAttribute('data-fit-pin'), shown: getComputedStyle(c).display !== 'none' })),
      more: vis('[data-chip-more]'),
      fwText: vis('.fw-chip .label'), fwDot: vis('.fw-chip .dot'),
      overflow: head.scrollWidth > head.clientWidth,
    };
  })())`);
  console.log(`width ${w}:`, m);
  if (w === 300) console.log("capture narrow:", await shot(`${outdir}/fw-narrow.png`));
  const x = JSON.parse(m);
  sweep.push(x);
  const free = x.chips.filter((c) => !c.pin);
  const ranks = free.map((c) => RANK[c.fit]);
  check(`머리줄 ${x.cw}px — 넘치지 않는다`, !x.overflow, m);
  check(`머리줄 ${x.cw}px — 끝 칩부터 접힌다(앞 칩이 뒤 칩보다 더 접히지 않음)`, ranks.every((r, i) => i === 0 || r >= ranks[i - 1]), JSON.stringify(free));
  check(`머리줄 ${x.cw}px — AI 권한 칩은 숨지 않는다`, x.chips.filter((c) => c.pin).every((c) => c.fit !== "hidden" && c.shown), JSON.stringify(x.chips));
  check(`머리줄 ${x.cw}px — 숨긴 칩이 있으면 "+N" 이 서고, 아니면 없다`, x.more === free.some((c) => c.fit === "hidden"), m);
  const fw = x.chips.find((c) => c.id === "forward");
  if (fw && (fw.fit === "compact" || fw.fit === "icon")) check(`머리줄 ${x.cw}px — 접힌 포워딩 칩은 글자 없이 점이 남는다`, !x.fwText && x.fwDot, m);
  if (fw && fw.fit === "full") check(`머리줄 ${x.cw}px — 펴진 포워딩 칩은 글자가 보인다`, x.fwText, m);
  // 이름(45px — 최소 폭 72 보다 짧다)은 칩이 더 접을 것이 없을 때만 준다
  if (x.nameTrunc) check(`머리줄 ${x.cw}px — 이름은 칩을 다 접은 뒤에만 준다`, free.every((c) => c.fit === "hidden" || c.fit === "icon"), m);
  if (prevFit) check(`머리줄 ${x.cw}px — 좁아지면 접힘은 늘기만 한다`, free.every((c) => RANK[c.fit] >= (prevFit[c.id] ?? 0)), JSON.stringify({ prev: prevFit, now: free }));
  prevFit = Object.fromEntries(free.map((c) => [c.id, RANK[c.fit]]));
}
check("넓을 때 첫 칩(폴더)은 펴져 있다", sweep[0].chips.find((c) => c.id === "folder")?.fit === "full", JSON.stringify(sweep[0].chips));
check("가장 좁을 때는 숨긴 칩 + \"+N\" 까지 간다", sweep.at(-1).more && sweep.at(-1).chips.some((c) => c.fit === "hidden"), JSON.stringify(sweep.at(-1).chips));

// ── 7. 앱 포워드만 남으면 칩도 폴링도 없다 · 사람 포워드 하나를 더하면 칩 "1" (2026-10-27) ─────────────────
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 700, deviceScaleFactor: 1, mobile: false });
await sleep(600);
// 사람 포워드가 밖에서 사라졌다(백엔드 표에 에이전트 신호만) — 칩 폴링(5초)이 다음 바퀴에 그것을 읽는다
await ev(`(window.__forwards = window.__forwards.filter((f) => f.purpose === 'agent-signal').map((f) => ({ ...f })), true)`);
await sleep(6000);
const onlySignal = await ev(`JSON.stringify({
  chip: !!document.querySelector('[data-forward-chip]'),
  table: window.__forwards.map((f) => f.purpose ?? f.kind),
})`);
console.log("signal only:", onlySignal);
check("에이전트 신호만 — 칩이 없다", JSON.parse(onlySignal).chip === false, onlySignal);
console.log("capture signal only:", await shot(`${outdir}/fw-signal-only.png`));
const callsBefore = await ev(`window.__calls.filter((c) => c[0] === 'list_forwards').length`);
await sleep(6000);
const callsAfter = await ev(`window.__calls.filter((c) => c[0] === 'list_forwards').length`);
check("에이전트 신호만 — 칩 폴링 타이머가 서지 않는다(6초 동안 list_forwards 0번)", callsAfter === callsBefore, `${callsBefore} → ${callsAfter}`);

// ⋯ › 포트 포워딩… — 보이는 포워드가 0개라 추가 모달로 곧장 간다 → 로컬 하나 추가
await ev(`(() => { const b = document.querySelector('[data-tile-menu-btn]'); b.click(); })()`);
await sleep(400);
await ev(`(async () => {
  for (const g of document.querySelectorAll('[data-flyout]')) {
    if (document.querySelector('[data-action="forward"]')) break;
    g.click();
    await new Promise((r) => setTimeout(r, 300));
  }
  document.querySelector('[data-action="forward"]')?.click();
})()`);
await sleep(600);
check("⋯ › 포트 포워딩… → (보이는 포워드 0개) 추가 모달", (await ev(`!!document.querySelector('[aria-labelledby="fw-title"]')`)) === true);
await ev(`(() => {
  const set = (id, v) => { const el = document.getElementById(id); el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); };
  set('fw-local', '25432'); set('fw-remote', '5432');
})()`);
await sleep(200);
await ev(`document.querySelector('[aria-labelledby="fw-title"] .actions .primary').click()`);
await sleep(900);
const plusChip = await ev(`JSON.stringify({
  chip: document.querySelector('[data-forward-chip] .n')?.textContent,
  table: window.__forwards.length,
})`);
console.log("signal + one chip:", plusChip);
check("에이전트 신호 + 사람 로컬 하나 — 칩 1", JSON.parse(plusChip).chip === "1" && JSON.parse(plusChip).table === 2, plusChip);
await ev(`(() => {
  const el = document.querySelector('[data-forward-chip]');
  const r = el.getBoundingClientRect();
  el.dispatchEvent(new PointerEvent('pointerenter', { bubbles: false, clientX: r.left + 4, clientY: r.top + 4 }));
})()`);
await sleep(900);
const plusCard = await ev(`JSON.stringify({
  head: document.querySelector('[data-forwards-card] .f-head')?.textContent.trim().replace(/\\s+/g, ' '),
  rows: [...document.querySelectorAll('[data-forwards-card] .f-row')].map((r) => r.textContent.trim().replace(/\\s+/g, ' ')),
})`);
console.log("signal + one card:", plusCard);
const pc = JSON.parse(plusCard);
check("에이전트 신호 + 사람 로컬 하나 — 카드 한 줄", pc.rows.length === 1 && /25432/.test(pc.rows[0]) && /1/.test(pc.head ?? ""), plusCard);
console.log("capture signal + one:", await shot(`${outdir}/fw-signal-plus-one.png`));
await ev(`document.querySelector('[data-forward-chip]').dispatchEvent(new PointerEvent('pointerleave', { bubbles: false }))`);
await sleep(150);
await ev(`document.querySelector('[data-forward-chip]').click()`);
await sleep(500);
const plusMenu = await ev(`JSON.stringify([...document.querySelectorAll('[data-forward-menu] [data-forward-row]')].map((r) => r.textContent.trim().replace(/\\s+/g, ' ')))`);
console.log("signal + one menu:", plusMenu);
const pm = JSON.parse(plusMenu);
check("에이전트 신호 + 사람 로컬 하나 — 메뉴 한 줄", pm.length === 1 && /25432/.test(pm[0]), plusMenu);
await key("Escape");
await sleep(200);

const exc = events
  .filter((e) => e.method === "Runtime.exceptionThrown")
  .map((e) => (e.params.exceptionDetails.exception?.description ?? "").split("\n")[0])
  .filter((s) => !/stub:/.test(s))
  .slice(0, 6);
check("페이지 예외 없음", exc.length === 0, JSON.stringify(exc));
const fails = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - fails}/${results.length} PASS`);
ws.close();
process.exit(fails === 0 ? 0 : 1);
