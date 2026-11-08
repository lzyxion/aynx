// 헤드리스 검증 — 탭 폭: 기본 200px · 좁으면 모두 같이 줄기 · 하한(아이콘 한 칸) 뒤 생략 + `⌄N` 목록 · × 로 닫는 동안 얼림
// (docs/log/2026-09-29-tab-width-shrink.md · `src/lib/tab-overflow.ts`).
//
// 스텁은 `status-signals-harness.mjs` 의 것을 줄인 사본이다(탭은 빈 탭 = launcher 만 연다 — 세션 없음).
//
// usage:
//   npx vite --port 1440 --strictPort
//   "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" --headless=new \
//     --remote-debugging-port=9241 --user-data-dir=%TEMP%/edge-aynx-tabs --window-size=1100,800 \
//     http://localhost:1440/
//   CDP_PORT=9241 PAGE_PORT=1440 node scripts/dev/tab-width-harness.mjs out-prefix
//     → <prefix>-tabs-3.png · -tabs-8.png · -tabs-frozen.png · -tabs-released.png · -tabs-30.png · -tabs-30-menu.png · -tabs-30-picked.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
const [outdir0 = "out"] = process.argv.slice(2);
// 탭 모양 — pill · flat (기본 pill). 출력 파일 이름에도 붙는다.
const STYLE = process.env.TAB_STYLE ?? "pill";
const outdir = `${outdir0}-${STYLE}`;
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
const shot = async (path) => {
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png", clip: { x: 0, y: 0, width: 1100, height: 120, scale: 1 } });
    if (r.result?.data) { fs.writeFileSync(path, Buffer.from(r.result.data, "base64")); return "ok"; }
    await sleep(500);
  }
  return "capture failed";
};
const mouse = (type, x, y) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: type === "mouseMoved" ? "none" : "left", clickCount: type === "mouseMoved" ? 0 : 1 });

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
  const evts = new Map();
  const answers = {
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, 
    load_settings: { app: { status_bar: 'bottom' }, terminal: { tab_style: ${JSON.stringify(STYLE)} } },
    list_forwards: [], reap_window_sessions: null, list_snippets: [],
    audit_status: { state: 'off', written: 0, failed: 0 },
    list_operations: { pending: [], recent: [] }, mcp_activity: null,
    vault_status: { state: 'off', hasMaster: false, entryCount: 0 },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [],
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
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
await send("Emulation.setDeviceMetricsOverride", { width: 1100, height: 800, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
// 부팅을 기다린다 (첫 실행은 vite 의 의존성 최적화로 오래 걸린다)
for (let i = 0; i < 60 && !(await ev(`!!document.querySelector('.tabs .strip .new')`)); i += 1) await sleep(500);
if (!(await ev(`!!document.querySelector('.tabs .strip .new')`))) {
  console.log("BOOT FAIL", await ev(`document.body.innerText.slice(0, 800)`));
  process.exit(1);
}
await sleep(500);
check("탭 모양이 스텁대로다", (await ev(`document.querySelector('.tabs').dataset.tabStyle`)) === STYLE, STYLE);

/** 탭 줄의 모습 — 탭 폭들 · 스크롤 여부 · `+` 와 드래그 자리 */
const read = async () =>
  JSON.parse(await ev(`JSON.stringify((() => {
    const strip = document.querySelector('.tabs .strip');
    const tabs = [...strip.querySelectorAll('.tab:not(.elided)')];
    const r = strip.getBoundingClientRect();
    const plus = strip.querySelector('.new').getBoundingClientRect();
    const drag = strip.querySelector('.dragspace').getBoundingClientRect();
    return {
      n: tabs.length,
      widths: tabs.map((t) => Math.round(t.getBoundingClientRect().width * 10) / 10),
      scroll: strip.scrollWidth > strip.clientWidth + 1,
      plusVisible: plus.right <= r.right + 0.5 && plus.left >= r.left,
      drag: Math.round(drag.width),
      frozen: strip.classList.contains('frozen'),
      hiddenClose: tabs.filter((t) => getComputedStyle(t.querySelector('.close')).display === 'none').length,
      hiddenTitle: tabs.filter((t) => getComputedStyle(t.querySelector('.title')).display === 'none').length,
      elided: strip.querySelectorAll('.tab.elided').length,
      more: strip.querySelector('.more')?.textContent.trim() ?? null,
      moreVisible: (() => { const m = strip.querySelector('.more'); if (!m) return false; const b = m.getBoundingClientRect(); return b.right <= r.right + 0.5 && b.left >= r.left; })(),
      activeVisible: tabs.some((t) => t.classList.contains('active')),
    };
  })())`));
const addTabsTo = async (n) => {
  await ev(`(async () => {
    while (document.querySelectorAll('.tabs .strip .tab').length < ${n}) {
      document.querySelector('.tabs .new').click();
      await new Promise((r) => setTimeout(r, 30));
    }
  })()`);
  await sleep(400);
};
const uniq = (a) => [...new Set(a)];

// ── 1. 탭 셋 = 모두 200px ──────────────────────────────────────────────────
await addTabsTo(3);
let s = await read();
check("탭 셋은 모두 200px", s.n === 3 && s.widths.every((w) => w === 200), s.widths);
check("탭 셋 — 스크롤 없음", !s.scroll, s.scroll);
await shot(`${outdir}-tabs-3.png`);

// ── 2. 탭 여덟 @1100px = 모두 같은 폭으로 줄고 다 보인다 ────────────────────
// (1100px 창에서 탭 줄이 쓰는 폭은 창 제어·`+`·끌기 자리를 빼고 ~950px — 여덟이면 아직 기본 폭 아래 · 하한 위다.
//  서른이면 하한 아래라 생략 쪽이다.)
await addTabsTo(8);
s = await read();
const w8 = s.widths[0];
check("탭 여덟은 같은 폭(±0.5)", s.widths.every((w) => Math.abs(w - w8) <= 0.5), uniq(s.widths));
check("그 폭은 하한(36) 이상 · 200 미만", w8 >= 36 && w8 < 200, w8);
check("탭 여덟 — 스크롤 없음", !s.scroll, s.scroll);
check("`+` 가 보인다", s.plusVisible, s.plusVisible);
// 같은 폭이면 × 를 접는 것도 한결같아야 한다(안 보는 탭 전부 접거나 · 하나도 안 접거나)
check("× 접힘이 칸마다 한결같다", s.hiddenClose === 0 || s.hiddenClose === s.n - 1, s.hiddenClose);
check("창 끌기 자리가 남는다(≥24px)", s.drag >= 24, s.drag);
await shot(`${outdir}-tabs-8.png`);

// ── 3. × 로 닫는 동안 얼림 ─────────────────────────────────────────────────
// 다섯째 탭의 × 위에 커서를 두고 두 번 누른다 — 남은 탭은 넓어지지 않고, 다음 × 가 커서 밑에 온다.
// × 는 좁은 비활성 탭에서 접혀 있을 수 있어 먼저 그 탭에 손을 얹고(× 가 선다) 자리를 잰다.
const tabXY = JSON.parse(await ev(`JSON.stringify((() => {
  const r = document.querySelectorAll('.tabs .strip .tab')[3].getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
})())`));
await mouse("mouseMoved", tabXY.x, tabXY.y);
await sleep(100);
const closeXY = JSON.parse(await ev(`JSON.stringify((() => {
  const c = document.querySelectorAll('.tabs .strip .tab')[3].querySelector('.close').getBoundingClientRect();
  return { x: c.left + c.width / 2, y: c.top + c.height / 2 };
})())`));
await mouse("mouseMoved", closeXY.x, closeXY.y);
await sleep(100);
for (let i = 0; i < 2; i += 1) {
  await mouse("mousePressed", closeXY.x, closeXY.y);
  await mouse("mouseReleased", closeXY.x, closeXY.y);
  await sleep(300);
}
s = await read();
check("두 번 닫아 여섯", s.n === 6, s.n);
check("얼린 동안 폭이 그대로다", s.frozen && s.widths.every((w) => Math.abs(w - w8) <= 0.5), { frozen: s.frozen, w: uniq(s.widths), w8 });
check("다음 × 가 커서 밑에 있다",
  await ev(`!!document.elementFromPoint(${closeXY.x}, ${closeXY.y})?.closest('.close')`), true);
await shot(`${outdir}-tabs-frozen.png`);

// 커서가 스트립을 떠나면(터미널 쪽으로) 풀리고 다시 넓어진다
await mouse("mouseMoved", 550, 500);
await sleep(400);
s = await read();
check("떠나면 풀린다", !s.frozen, s.frozen);
check("풀리면 다시 넓어진다(같은 폭)", s.widths[0] > w8 + 1 && s.widths.every((w) => Math.abs(w - s.widths[0]) <= 0.5), uniq(s.widths));
check("풀린 뒤 스크롤 없음", !s.scroll, s.scroll);
await shot(`${outdir}-tabs-released.png`);

// ── 4. 탭 서른 = 아이콘 한 칸(36px)까지 줄고, 넘치는 것은 접혀 `⌄N` 목록으로 — 스크롤 없음 ─────────
await addTabsTo(30);
s = await read();
// 칸 수는 내림이라 남는 몇 px 은 flex 가 나눠 준다 — 하한 이상 · 한 칸을 더 넣을 만큼은 아니다
check("보이는 탭은 하한 36px 근처(같은 폭)", s.widths.every((w) => w >= 36 && w < 42 && Math.abs(w - s.widths[0]) <= 0.5), uniq(s.widths));
check("스크롤 없음", !s.scroll, s.scroll);
check("넘친 탭은 접힌다", s.elided > 0 && s.n + s.elided === 30, { shown: s.n, elided: s.elided });
check("`⌄N` 단추가 접힌 수를 말하고 보인다", s.more === String(s.elided) && s.moreVisible, { more: s.more, vis: s.moreVisible });
check("`+` 가 보인다", s.plusVisible, s.plusVisible);
check("창 끌기 자리가 남는다(≥24px)", s.drag >= 24, s.drag);
check("활성 탭(마지막에 연 것)이 보인다", s.activeVisible, s.activeVisible);
check("아이콘만 — 모든 탭의 제목·× 가 접힌다", s.hiddenTitle === s.n && s.hiddenClose === s.n, { title: s.hiddenTitle, close: s.hiddenClose });
await shot(`${outdir}-tabs-30.png`);

// `⌄N` 을 누르면 접힌 탭 목록이 뜨고, 고르면 그 탭이 활성이 되어 줄에 선다
await ev(`document.querySelector('.tabs .more').click()`);
await sleep(200);
const rows = await ev(`document.querySelectorAll('[data-tabs-more-menu] [data-tabs-more-option]').length`);
check("목록 줄 수 = 접힌 수", rows === s.elided, rows);
await send("Page.captureScreenshot", { format: "png" }).then((r) => r.result?.data && fs.writeFileSync(`${outdir}-tabs-30-menu.png`, Buffer.from(r.result.data, "base64")));
const picked = await ev(`(() => { const b = document.querySelector('[data-tabs-more-menu] [data-tabs-more-option]'); const id = b.dataset.tabsMoreOption; b.click(); return id; })()`);
await sleep(300);
check("고른 탭이 활성이고 보인다",
  await ev(`(() => { const t = document.querySelector('.tabs .tab.active'); return !!t && t.dataset.tab === ${JSON.stringify(picked)}; })()`), picked);
check("목록이 닫혔다", await ev(`!document.querySelector('[data-tabs-more-menu]')`), true);
s = await read();
check("고른 뒤에도 스크롤 없음 · 접힌 수 그대로", !s.scroll && s.n + s.elided === 30, { shown: s.n, elided: s.elided });
await shot(`${outdir}-tabs-30-picked.png`);

console.log(bad === 0 ? "ALL OK" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
