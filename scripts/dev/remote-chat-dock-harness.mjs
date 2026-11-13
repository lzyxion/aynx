// 헤드리스 검증 — **원격 웹 창의 사이드 채팅** 화면 단계 (2026-11-01 · docs/log/2026-11-01-remote-side-chat.md).
//
// 처음부터 원격 창 흉내(`window.__AYNX_REMOTE__` — 관문 폴리필이 세우는 표식 하나)로 뜬다. 사이드 채팅 명령은 스텁이다: 채팅 하나
// (`chat-a` — 서버 표에서 턴이 돌고 권한 카드 하나가 기다린다), 통로(`side_chat_subscribe`)는 Channel id 를 쥐어 사건을 손으로 흘린다.
// 보는 것:
// ① 원격 데스크톱 폭(1400x900) — 채팅 독이 마운트 · `toggleChatDock`(open-chat-dock) 으로 열림 · 작업안 몸통(`[data-chat-dock-plans]`)은
//    숨어 있다 · 머리줄 ▾ 점 = 권한 · 권한 카드가 선다
// ② 원격 독의 작업안 칸 → 주 창과 같이 독의 작업안 갈래로 바뀐다(2026-11-13 — 예전엔 캔버스를 덮는 판 `PlansCover`)
// ③ 다른 창이 먼저 답한 권한 카드(`[unknown-request]`) — 오류 줄 · 오류 토스트 없이 삼킨다
// ④ 다른 창이 보낸 사람 글(`userAccepted{text}`) — 곧바로 말풍선
// ⑤ 원격 폰(390x844) — 독 없음 · 상태줄 말풍선(점 = 권한) → 전체 화면 덮개 · 포커스는 뒤로 단추(입력 칸 아님) · 입력 칸
//    `enterkeyhint="enter"` · 그림 고르기 단추 · Enter = 줄바꿈(보내지 않는다) · 휴대폰 '뒤로' = 닫기 · 시트의 사이드 채팅 줄 → 덮개
// ⑥ 잡히지 않은 예외 · 콘솔 오류 0(`stub:` 거절 제외)
// ⑧ 마지막 선택은 CLI 마다 — Claude 칩에서 opus · high → Codex(강도 low) → Claude 로 돌아오면 opus · high 로 다시 연다(side_chat_open 에 강도까지) ·
//    저장의 last = {cli, byCli} · [새 채팅]도 Claude · opus · high
// ⑦ 채팅 목록 줄의 단추 둘(이름 바꾸기 · 지우기 — 2026-11-01): 데스크톱은 호버에만 보이고, 폰 덮개는 늘 보인다. 연필 → 이름 칸 → Enter 로
//    바뀐다(폰은 조합 중 Enter 를 거른다) · 휴지통 → 지우기 확인 상자(취소하면 아무것도 지우지 않는다) · 줄 선택(채팅 열기)으로 번지지 않는다
//
// usage: node scripts/dev/run-harness.mjs remote-chat-dock-harness.mjs <outdir> --size 1400x900
//   → <outdir>/remote-dock.png · remote-dock-list-hover.png · phone-chat.png · phone-chat-list.png
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";
const [outdir = "out", port = process.env.CDP_PORT ?? "9273"] = process.argv.slice(2);
const PAGE_PORT = process.env.PAGE_PORT ?? "1441";
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
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    if (d.params.args.some((a) => /stub:/.test(String(a.value ?? a.description ?? "")))) return;
    errors.push("console.error " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0]);
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
const mouse = (x, y) => send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
const pressEnter = async () => {
  for (const type of ["keyDown", "keyUp"])
    await send("Input.dispatchKeyEvent", { type, code: "Enter", key: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
};
/** ⑦ 목록 줄의 이름 바꾸기 · 지우기(취소) — 데스크톱 독과 폰 덮개 공용. `root` = 목록을 담은 상자 선택자 */
const rowActions = async (label, root, newTitle, imeCheck) => {
  const q = (sel) => `document.querySelector('${root} ${sel}')`;
  const calls0 = await ev(`window.__calls.length`);
  // 연필 — 이름 칸이 서고 지금 제목이 담긴다(줄 선택으로 번지지 않는다 — 목록이 그대로 열려 있다)
  await ev(`${q('[data-chat-row-rename="chat-a"]')}.click()`);
  await sleep(300);
  const inp = q("input.rename");
  const r1 = JSON.parse(await ev(`JSON.stringify([${inp}?.value ?? null, document.activeElement === ${inp}, !!${q("[data-chat-dock-rows]")}])`));
  await ev(`(() => { const i = ${inp}; i.value = '${newTitle}'; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  let ime = null;
  if (imeCheck) {
    // 조합 중 Enter — 확정이 아니다(칸이 남는다)
    await ev(`${inp}.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true, cancelable: true }))`);
    await sleep(150);
    ime = await ev(`!!${inp}`);
  }
  await pressEnter();
  await sleep(500);
  const r2 = JSON.parse(await ev(`JSON.stringify([!!${inp}, ${q('[data-chat-row="chat-a"] .row-title')}?.textContent.trim() ?? null, window.__calls.slice(${calls0}).some(([c]) => c === 'side_chats_save')])`));
  check(`⑦ ${label} 연필 → 이름 칸(지금 제목 · 포커스 · 목록 그대로)${imeCheck ? " · 조합 중 Enter 거름" : ""} → Enter 로 바뀜 · 저장`,
    [...r1, ...(imeCheck ? [ime] : []), ...r2], ["디스크 점검", true, true, ...(imeCheck ? [true] : []), false, newTitle, true]);
  // 휴지통 — 지우기 확인 상자(제목이 실린다) → 취소하면 아무것도 지우지 않는다
  await ev(`${q('[data-chat-row-delete="chat-a"]')}.click()`);
  await sleep(500);
  const r3 = JSON.parse(await ev(`JSON.stringify([!!document.querySelector('[data-confirm-dialog]'), document.querySelector('[data-confirm-dialog]')?.innerText.includes('${newTitle}') ?? false])`));
  await ev(`document.querySelector('[data-confirm-dialog] .btn-secondary')?.click()`);
  await sleep(500);
  const r4 = JSON.parse(await ev(`JSON.stringify([!!document.querySelector('[data-confirm-dialog]'), window.__calls.some(([c]) => c === 'side_chat_close' || c === 'side_chats_delete'), !!${q('[data-chat-row="chat-a"]')}])`));
  check(`⑦ ${label} 휴지통 → 확인 상자(제목) → 취소 = 지우지 않음`, [...r3, ...r4], [true, true, false, false, true]);
};
const shot = async (name) => {
  const p = path.join(outdir, name);
  for (let i = 0; i < 3; i += 1) {
    const r = await send("Page.captureScreenshot", { format: "png" });
    if (r.result?.data) {
      fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
      console.log("PNG " + path.resolve(p));
      return;
    }
    await sleep(500);
  }
  console.log("capture failed: " + p);
};
let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const waitFor = async (expr, ms = 8000) => {
  for (let i = 0; i < ms / 200; i++) {
    if ((await ev(expr)) === true) return true;
    await sleep(200);
  }
  return false;
};

const NOW = Date.now();
const FILE = {
  v: 2,
  current: "chat-a",
  last: { cli: "claude", model: "", effort: "" },
  chats: [{ id: "chat-a", cli: "claude", model: "", effort: "", title: "디스크 점검", createdAt: NOW - 600_000, usedAt: NOW - 60_000, used: [], links: {} }],
};
const PERM = { t: "permission", requestId: "r1", kind: "command", title: "명령 실행", detail: "df -h /", toolName: "Bash" };

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  window.__AYNX_REMOTE__ = true;
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__calls = [];
  const evts = new Map();
  window.__sideChan = null; window.__sideIdx = 0;
  /** 사이드 채팅 통로로 사건 하나를 흘린다(Channel 의 순서 번호 그대로) */
  window.__sideEmit = (msg) => { const cb = cbs.get(window.__sideChan); if (!cb) return false; cb({ index: window.__sideIdx++, message: msg }); return true; };
  window.__decide = 'unknown';
  let rev = 1;
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false } };
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_group_meta: {}, list_host_meta: {}, list_snippets: [],
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: true }],
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    side_chat_dir: 'C:/Users/me/AppData/Roaming/aynx-dev/side-chats/chat-a',
    side_chat_list: [{ chat: 'chat-a', cli: 'claude', model: '', effort: null, epoch: 1, status: 'running', conversationId: null, viewers: 1, detached: false }],
  };
  const snap = () => ({
    link: null, chat: 'chat-a', cli: 'claude', model: '', effort: null, epoch: 1, leaseEpoch: 1, seq: 2, status: 'running',
    conversationId: null, cwd: null, mcpServers: [],
    liveTurn: [{ t: 'turnStarted', turn: 't1' }, { t: 'userAccepted', clientId: null, text: '디스크 남은 공간 알려 줘' }],
    pending: window.__decide === 'done' ? [] : [${JSON.stringify(PERM)}],
  });
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'remote-h-1' }, currentWebview: { label: 'remote-h-1', windowLabel: 'remote-h-1' }, windows: [{label:'remote-h-1'}], webviews: [{label:'remote-h-1', windowLabel:'remote-h-1'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'load_settings') return Promise.resolve(window.__settings);
      if (cmd === 'side_chats_load') return Promise.resolve({ json: ${JSON.stringify(JSON.stringify(FILE))}, rev });
      if (cmd === 'side_chats_save') { rev += 1; return Promise.resolve({ rev }); }
      if (cmd === 'side_chat_subscribe') { window.__sideChan = args.channel.id; return Promise.resolve(null); }
      if (cmd === 'side_chat_attach') return Promise.resolve(snap());
      // ⑧ CLI 바꾸기 — 다시 열기(띄우지 않음)는 그 뜻 그대로의 멈춘 스냅숏 · 모델 · 강도 바꾸기는 받기만
      if (cmd === 'side_chat_open') return Promise.resolve({ ...snap(), cli: args.cli, model: args.model, effort: args.effort, status: 'stopped', seq: 0, liveTurn: [], pending: [] });
      if (cmd === 'side_chat_close' || cmd === 'side_chat_set_model' || cmd === 'side_chat_set_effort') return Promise.resolve(true);
      if (cmd === 'side_chat_decide') {
        // 다른 창이 먼저 답했다 — 서버는 둘째를 '[unknown-request]' 로 돌려준다(그 뒤 attach 에는 카드가 없다)
        window.__decide = 'done';
        return Promise.reject('[unknown-request] 기다리는 요청이 아닙니다');
      }
      if (cmd === 'plugin:event|listen') { const a = evts.get(args.event) ?? []; a.push(args.handler); evts.set(args.event, a); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') { evts.set(args.event, (evts.get(args.event) ?? []).filter((x) => x !== args.eventId)); return Promise.resolve(); }
      return (cmd in answers) ? Promise.resolve(answers[cmd]) : Promise.reject(new Error('stub: ' + cmd));
    },
    transformCallback: (cb) => { const id = ++n; cbs.set(id, cb); return id; },
    unregisterCallback: (id) => cbs.delete(id),
    convertFileSrc: (p) => p, plugins: {}, postMessage: () => {}, ipc: () => {},
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`,
});

// ── ① 원격 데스크톱 폭 ──────────────────────────────────────────────────────────
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
check("① 원격 데스크톱 — 채팅 독이 마운트", await waitFor(`!!document.querySelector('[data-chat-dock]')`), true);
await waitFor(`window.__calls.some(([c]) => c === 'side_chats_load')`);
await sleep(1200);
errors.length = 0;

const chatDockMod = importApp("app/chat-dock.svelte.ts");
const sheetsMod = importApp("app/mobile-sheets.svelte.ts");
await ev(`(async () => (await ${chatDockMod}).toggleChatDock())()`);
await waitFor(`!!document.querySelector('[data-side-chat-perm="r1"]')`);
await sleep(600);
const D = JSON.parse(await ev(`JSON.stringify({
  open: document.querySelector('[data-chat-dock]').classList.contains('open'),
  plansBody: !!document.querySelector('[data-chat-dock-plans]:not([hidden])'),
  headDot: document.querySelector('[data-chat-dock-list] .dot')?.dataset.dot ?? null,
  perm: !!document.querySelector('[data-side-chat-perm="r1"] [data-side-chat-allow]'),
  title: document.querySelector('[data-chat-dock-list] .title')?.textContent.trim(),
  subscribed: window.__sideChan !== null,
})`));
check("① open-chat-dock → 열림 · 작업안 몸통 숨음 · ▾ 점 = 권한 · 카드 · 제목 · 통로", D, {
  open: true, plansBody: false, headDot: "permission", perm: true, title: "디스크 점검", subscribed: true,
});
await shot("remote-dock.png");

// ── ② 작업안 칸 → 독의 작업안 갈래(주 창과 같다 · 덮는 판 없음) ─────────────────────
await ev(`document.querySelector('[data-dock-section="plans"]').click()`);
await sleep(900);
check("② 작업안 칸 → 독의 작업안 갈래 · 덮는 판 없음",
  JSON.parse(await ev(`JSON.stringify([!!document.querySelector('[data-chat-dock-plans]:not([hidden]) [data-plans-view]'), document.querySelector('[data-dock-section="plans"]').getAttribute('aria-pressed'), document.querySelector('[data-chat-dock-body]').hidden, !!document.querySelector('[data-plans-cover]')])`)),
  [true, "true", true, false]);
await ev(`document.querySelector('[data-dock-section="chat"]').click()`);
await sleep(400);

// ── ③ 다른 창이 먼저 답한 카드 — 조용히 삼킨다 ──────────────────────────────────────
await ev(`document.querySelector('[data-side-chat-perm="r1"] [data-side-chat-allow]').click()`);
await sleep(1500);
check("③ [unknown-request] — 오류 줄 없음 · 대괄호 낱말이 화면에 없음 · 다시 맞춰 카드가 걷힘",
  JSON.parse(await ev(`JSON.stringify([!!document.querySelector('[data-side-chat-error]'), document.body.innerText.includes('unknown-request') || document.body.innerText.includes('기다리는 요청이 아닙니다'), !!document.querySelector('[data-side-chat-perm="r1"] [data-side-chat-allow]')])`)),
  [false, false, false]);

// ── ④ 다른 창이 보낸 사람 글 ──────────────────────────────────────────────────────
await ev(`window.__sideEmit({ windows: ['main', 'remote-h-1'], chat: 'chat-a', epoch: 1, seq: 3, ev: { t: 'userAccepted', clientId: 'cother1', text: '다른 창에서 보낸 말' } })`);
await sleep(700);
check("④ 다른 창의 사람 글이 곧바로 선다", await ev(`document.querySelector('[data-chat-dock-body]').innerText.includes('다른 창에서 보낸 말')`), true);

// ── ⑦ 데스크톱 독의 목록 줄 단추 — 호버에만 보인다 ─────────────────────────────────
await ev(`document.querySelector('[data-chat-dock-list]').click()`);
await waitFor(`!!document.querySelector('[data-chat-dock] [data-chat-row-wrap="chat-a"]')`);
await mouse(2, 2);
await sleep(200);
// 원격 창의 안내 토스트("메인 PC 창이 닫혀 있어…")가 독 목록 위를 덮는다 — 이 단계만 토스트를 숨긴다(호버가 줄에 닿게)
await ev(`(() => { const s = document.createElement('style'); s.id = 'h-no-toast'; s.textContent = '.toast { display: none !important; }'; document.head.append(s); })()`);
await sleep(100);
// 줄 위에서 실제로 맞는 점(줄을 왼쪽부터 훑어 줄 안이 맞는 첫 점)
const hoverAt = JSON.parse(await ev(`(() => {
  const w = document.querySelector('[data-chat-dock] [data-chat-row-wrap="chat-a"]');
  const r = w.getBoundingClientRect();
  const y = r.y + r.height / 2;
  for (let x = r.x + 8; x < r.right - 8; x += 12) if (w.contains(document.elementFromPoint(x, y))) return JSON.stringify([x, y]);
  return 'null';
})()`));
const dockShown = () => ev(`getComputedStyle(document.querySelector('[data-chat-dock] [data-chat-row-wrap="chat-a"] .acts')).display !== 'none'`);
const hidden0 = await dockShown();
if (hoverAt) await mouse(hoverAt[0], hoverAt[1]);
await sleep(250);
const hover1 = await dockShown();
const actW = JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-chat-dock] [data-chat-row-wrap="chat-a"] .act')].map((b) => Math.round(b.getBoundingClientRect().width)))`));
check("⑦ 데스크톱 — 단추 둘은 호버 전 숨김 · 호버에 보임 · 32px", [hidden0, hover1, actW], [false, true, [32, 32]]);
await shot("remote-dock-list-hover.png");
await rowActions("데스크톱", "[data-chat-dock]", "새 이름", false);
await ev(`document.getElementById('h-no-toast')?.remove()`);
await mouse(2, 2);
await ev(`document.querySelector('[data-chat-dock-list]').click()`);
await sleep(300);

// ── ⑧ 마지막 선택은 CLI 마다(2026-11-01) — Claude opus · high → Codex(low) → Claude 로 돌아오면 opus · high · 새 채팅도 ──────────
const chipText = () => ev(`document.querySelector('[data-chat-dock] [data-chat-chip] .chip-text')?.textContent.trim() ?? null`);
const effortText = () => ev(`document.querySelector('[data-chat-dock] [data-chat-effort-chip] .chip-text')?.textContent.trim() ?? null`);
/** 칩 메뉴의 한 줄을 누른다(필요하면 "답하는 중" 확인 상자에 [지금 바꾸기]) */
const pickMenu = async (chipSel, key) => {
  await ev(`document.querySelector('[data-chat-dock] ${chipSel}').click()`);
  await waitFor(`!!document.querySelector('[data-toolbar-menu] [data-menu-key="${key}"]')`, 3000);
  await ev(`document.querySelector('[data-toolbar-menu] [data-menu-key="${key}"]').click()`);
  await sleep(400);
  if (await ev(`!!document.querySelector('[data-confirm-dialog]')`)) {
    await ev(`document.querySelector('[data-confirm-dialog] .actions .btn:not(.btn-secondary)').click()`);
    await sleep(500);
  }
  await sleep(300);
};
const lastOpen = () => ev(`JSON.stringify((window.__calls.filter(([c]) => c === 'side_chat_open').at(-1) ?? [null, null])[1])`);
const savedLast = () => ev(`JSON.stringify(JSON.parse((window.__calls.filter(([c]) => c === 'side_chats_save').at(-1) ?? [null, { json: '{}' }])[1].json).last ?? null)`);
await pickMenu("[data-chat-chip]", "model:opus");
await pickMenu("[data-chat-effort-chip]", "effort:high");
const claudeEffort = await effortText();
check("⑧ Claude 에서 opus · high", [await chipText(), claudeEffort?.includes("high") ?? false], ["Claude Code · opus", true]);
await pickMenu("[data-chat-chip]", "cli:codex");
const toCodex = JSON.parse(await lastOpen());
check("⑧ Codex 로 — 기억 없음 = 기본 모델 · 기본 강도로 다시 연다", [toCodex?.cli, toCodex?.model, toCodex?.effort], ["codex", "", null]);
await pickMenu("[data-chat-effort-chip]", "effort:low");
await pickMenu("[data-chat-chip]", "cli:claude");
const toClaude = JSON.parse(await lastOpen());
check("⑧ Claude 로 돌아오면 opus · high 로 다시 연다(강도도 실림) · 칩도 그대로",
  [toClaude?.cli, toClaude?.model, toClaude?.effort, await chipText(), await effortText()],
  ["claude", "opus", "high", "Claude Code · opus", claudeEffort]);
await pickMenu("[data-chat-chip]", "cli:codex");
const backCodex = JSON.parse(await lastOpen());
check("⑧ 다시 Codex — low 가 남았다", [backCodex?.model, backCodex?.effort], ["", "low"]);
await pickMenu("[data-chat-chip]", "cli:claude");
await sleep(600);
check("⑧ 저장의 last = {cli, byCli} 새 모양",
  JSON.parse(await savedLast()),
  { cli: "claude", byCli: { claude: { model: "opus", effort: "high" }, codex: { model: "", effort: "low" } } });
await ev(`document.querySelector('[data-chat-dock-new]').click()`);
await sleep(800);
check("⑧ 새 채팅도 Claude · opus · high", [await chipText(), await effortText()], ["Claude Code · opus", claudeEffort]);

await ev(`(async () => (await ${chatDockMod}).closeChatDock(false))()`);
await sleep(300);

// ── ⑤ 원격 폰 ──────────────────────────────────────────────────────────────────
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Page.reload", { ignoreCache: true });
check("⑤ 폰 배치로 떴다(위 띠)", await waitFor(`!!document.querySelector('.mobile-bar')`), true);
await waitFor(`!!document.querySelector('[data-signal="side-chat"] .chat-dot')`);
await sleep(500);
check("⑤ 독 없음 · 상태줄 말풍선 · 점 = 권한",
  JSON.parse(await ev(`JSON.stringify([!!document.querySelector('[data-chat-dock]'), !!document.querySelector('[data-signal="side-chat"]'), document.querySelector('[data-signal="side-chat"] .chat-dot')?.dataset.chatDot ?? null])`)),
  [false, true, "permission"]);
await ev(`document.querySelector('[data-signal="side-chat"]').click()`);
await waitFor(`!!document.querySelector('[data-mobile-chat] [data-side-chat-face]')`);
await sleep(700);
const P = JSON.parse(await ev(`(() => {
  const m = document.querySelector('[data-mobile-chat]');
  const ta = m?.querySelector('textarea[data-flip-input]');
  const r = m?.getBoundingClientRect();
  return JSON.stringify({
    overlay: !!m,
    full: !!r && Math.round(r.width) === innerWidth,
    focusBack: document.activeElement?.hasAttribute('data-mobile-chat-back') ?? false,
    hint: ta?.getAttribute('enterkeyhint') ?? null,
    pick: !!m?.querySelector('[data-side-chat-pick]') && m.querySelector('input[type=file]')?.getAttribute('accept') === 'image/*',
    title: m?.querySelector('[data-mobile-chat-list] .title')?.textContent.trim() ?? null,
    perm: !!m?.querySelector('[data-side-chat-perm="r1"]'),
  });
})()`));
check("⑤ 말풍선 → 전체 화면 덮개 · 포커스 = 뒤로 · enterkeyhint=enter · 그림 고르기 · 제목 · 권한 카드", P, {
  overlay: true, full: true, focusBack: true, hint: "enter", pick: true, title: "디스크 점검", perm: true,
});
// Enter = 줄바꿈(보내지 않는다)
await ev(`document.querySelector('[data-mobile-chat] textarea[data-flip-input]').focus()`);
await send("Input.insertText", { text: "첫 줄" });
for (const type of ["keyDown", "keyUp"])
  await send("Input.dispatchKeyEvent", { type, code: "Enter", key: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, ...(type === "keyDown" ? { text: "\r" } : {}) });
await sleep(300);
check("⑤ Enter = 줄바꿈 · side_chat_send 없음",
  JSON.parse(await ev(`JSON.stringify([document.querySelector('[data-mobile-chat] textarea[data-flip-input]').value.includes('\\n'), window.__calls.some(([c]) => c === 'side_chat_send')])`)),
  [true, false]);
await ev(`document.activeElement?.blur()`);
await shot("phone-chat.png");
await ev(`history.back()`);
await sleep(700);
check("⑤ 휴대폰 '뒤로' → 덮개가 닫힌다", await ev(`!!document.querySelector('[data-mobile-chat]')`), false);
await ev(`(async () => (await ${sheetsMod}).openMobileSheet())()`);
await sleep(600);
await ev(`document.querySelector('[data-sheet="side-chat"]').click()`);
await sleep(800);
check("⑤ 시트의 사이드 채팅 줄 → 폰 덮개", await ev(`!!document.querySelector('[data-mobile-chat]')`), true);

// ── ⑦ 폰 덮개의 목록 줄 단추 — 늘 보인다 ─────────────────────────────────────────
await ev(`document.querySelector('[data-mobile-chat-list]').click()`);
await waitFor(`!!document.querySelector('[data-mobile-chat] [data-chat-row-wrap="chat-a"]')`);
await sleep(300);
check("⑦ 폰 — 단추 둘이 호버 없이 늘 보인다 · 32px",
  JSON.parse(await ev(`JSON.stringify([getComputedStyle(document.querySelector('[data-mobile-chat] [data-chat-row-wrap="chat-a"] .acts')).display !== 'none', [...document.querySelectorAll('[data-mobile-chat] [data-chat-row-wrap="chat-a"] .act')].map((b) => Math.round(b.getBoundingClientRect().height))])`)),
  [true, [32, 32]]);
await ev(`(() => { const s = document.createElement('style'); s.id = 'h-no-toast'; s.textContent = '.toast { display: none !important; }'; document.head.append(s); })()`);
await shot("phone-chat-list.png");
await ev(`document.getElementById('h-no-toast')?.remove()`);
await rowActions("폰", "[data-mobile-chat]", "폰 새 이름", true);
check("⑦ 폰 — 단추를 눌러도 덮개 · 목록이 그대로", await ev(`!!document.querySelector('[data-mobile-chat] [data-chat-dock-rows]')`), true);
await ev(`history.back()`);
await sleep(500);

if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑥ 잡히지 않은 예외·콘솔 오류 0", errors.length, 0);
console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
