// 헤드리스 검증 — **설정 › 알림 › 채널(메신저 다리 1b)** 과 **설정 상태 칩 색(전체 색)** 을 찍고 단언한다
// (docs/log/2026-11-18-messenger-bridge.md "구현 기록 — 1b" · 사용자 확정 목업 "설정 › 알림 › 채널"). 11 · 12 는 Discord 봇(3c — 한 번에
// 한 방식 · 2026-11-19 A안 · 목업 "Discord 채널 줄" ①–⑥): "연결 방식" 줄이 늘 맨 위 · 머리줄 첫 칩 = 지금 방식 · 웹훅 → [봇] → 토큰 → 확인
// ([취소] · 거절 · [바꾸기] — 웹훅이 지워진다) → 짝짓기 → 연결됨 → [웹훅] → 주소 → 확인 → 웹훅(`messenger_replace_bot_with_webhook`) → 해제 →
// 연결 전 등록(확인 없음) · 옛 세션 서버 · 원격 잠금(바꾸기는 어느 방향이든 메인 PC 전용).
//
//   node scripts/dev/run-harness.mjs messenger-settings-harness.mjs <outdir> --size 1200x900
//
// 스텁: 웹훅 채널 `messenger_status`(채널별 · `window.__hooks` · Discord 봇 토큰이 있으면 `via: "bot"`) · `messenger_set_webhook` ·
// `messenger_replace_bot_with_webhook`(주소 모양만 본다) · `messenger_test`, 봇
// `messenger_bot_status`(채널별 `window.__bots`) · `messenger_bot_set_token` · `messenger_bot_pair` · `messenger_bot_unpair` · `messenger_bot_test`,
// 설정 읽기 · 저장(`load_settings` · `save_settings` — 받은 payload 를 `__calls` 에 적는다). 서버 사건 `messenger-bot-event` 는 리스너 표로 쏜다
// (`window.__emit`). 원격 창은 `window.__AYNX_REMOTE__ = true` 를 둘째 주입 스크립트로 얹고 다시 읽는다(file-ui-remote-harness 와 같은 표식).
// 테마는 `document.documentElement.dataset.theme`(settings-modal-harness 와 같은 길).
//
// 캡처(<outdir>): 채널 묶음만 자른 `NN-<상태>.png` + 설정 창 전체 `NN-<상태>-full.png`, 칩 비교는 섹션 화면 한 장씩.
// 비밀은 찍지 않는다 — 토큰 · 웹훅 스텁이 받은 값은 `typeof` · 길이로만 적는다.
// 진짜 세션 서버 · Telegram 은 없다: 롱폴 · 짝짓기 코드의 생성 · 봇 답장 · 원격 관문의 실제 거절(`remote/deny.rs`)은 여기서 보지 않는다.
import { waitBoot, reloadBoot, waitToastsGone } from "./boot-wait.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import fs from "node:fs";
import path from "node:path";

const [outdir = "out", port = process.env.CDP_PORT ?? "9268"] = process.argv.slice(2);
fs.mkdirSync(outdir, { recursive: true });
const pagePort = process.env.PAGE_PORT ?? "1420";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const target = list.find((x) => x.type === "page" && x.url.includes(`localhost:${pagePort}`));
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const pending = new Map();
const errors = [];
let collecting = false;
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) {
    pending.get(d.id)(d);
    pending.delete(d.id);
  }
  if (!collecting) return;
  if (d.method === "Runtime.exceptionThrown") {
    const s = d.params.exceptionDetails?.exception?.description?.split("\n")[0] ?? d.params.exceptionDetails?.text ?? "?";
    errors.push(s);
  }
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    errors.push((d.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0]);
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
  const v = await ev(`JSON.stringify(${e})`);
  if (typeof v !== "string" || v.startsWith("EXC ")) throw new Error(`eval failed: ${v}`);
  return JSON.parse(v);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failed = 0;
let passed = 0;
const check = (ok, label) => {
  if (ok) passed++;
  else failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}`);
};
const W = 1200;
const H = 900;

// ── 스텁 ─────────────────────────────────────────────────────────────────────
const STUB = `
  performance.setResourceTimingBufferSize(10000);
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__calls = []; window.__unstubbed = []; let nextSession = 100;
  window.__listeners = {};
  window.__emit = (event, payload) => (window.__listeners[event] ?? []).forEach((h) => cbs.get(h)?.({ event, id: h, payload }));
  window.__hooks = { discord: true, slack: false };
  const NOBOT = () => ({ configured: false, bot: null, paired: false, pairName: null, pending: null, link: 'off' });
  // 봇 채널마다 — Telegram · Discord(2026-11-19 A안)
  window.__bots = { telegram: NOBOT(), discord: NOBOT() };
  window.__discordOutdated = false;
  window.__settings = { app: { status_bar: 'bottom' }, messenger: {}, remote: { enabled: true, host: 'mypc.tail1234.ts.net' } };
  const botNow = (ch) => JSON.parse(JSON.stringify(window.__bots[ch]));
  const chOf = (args) => (args && args.channel) || 'telegram';
  const answers = {
    list_hosts: { hosts: [], warnings: [] }, get_host_meta: {}, list_group_meta: {}, list_host_meta: {},
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: false }],
    agent_hooks_targets: [{ id: 'claude', display: 'Claude Code', needsTrustNote: false }, { id: 'codex', display: 'Codex', needsTrustNote: true }],
    agent_args_targets: [{ id: 'claude', display: 'Claude Code' }, { id: 'codex', display: 'Codex' }],
    agent_launch_preview: { line: 'claude', error: null, dangerous: [] },
    load_snippets: null, save_snippets: null, host_history_list: {}, projects_list: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null, push_session_block: null,
    drop_session: null, resize_session: null, write_session: null, close_session: null, reap_window_sessions: null,
    vault_status: { state: 'unlocked', hasMaster: true, entryCount: 0 }, vault_list: [],
    mcp_status: { name: 'aynx-sessions-dev', running: true, url: 'http://127.0.0.1:43210/mcp' }, mcp_activity: null,
    list_forwards: [], session_log_path: null, audit_status: { state: 'off', written: 0, failed: 0 }, operation_results: {},
    list_console_sessions: [], delegation_list_targets: [], list_operations: { pending: [], recent: [] },
    agent_usage_scan: { files: 0, elapsedMs: 1, conversations: [] }, agent_usage_limits: [],
    agent_sessions_list: { groups: [], others: [], othersMore: false },
    term_theme_list: [], restore_done_sessions: { closed: 0, unclaimed: 0 }, git_worktree_list: [],
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [], agent_states_snapshot: [],
    remote_status: { enabled: true, listening: false, port: 8765, host: 'mypc.tail1234.ts.net', funnel: 'unknown', tailscaleCli: true, error: 'bind 127.0.0.1:8765 failed' },
    remote_serve_status: { state: 'ours' },
    remote_devices_list: [
      { id: 'd1', name: 'Pixel 9', created: '2026-11-01T00:00:00Z', lastSeen: '2026-11-19T01:00:00Z', unlocked: true, connected: 1 },
      { id: 'd2', name: 'iPad', created: '2026-11-02T00:00:00Z', lastSeen: '2026-11-18T01:00:00Z', unlocked: false, connected: 0 },
    ],
    remote_log: [
      { at: '2026-11-19T01:00:00Z', kind: 'unlockFailed', deviceId: 'd2', deviceName: 'iPad' },
      { at: '2026-11-19T00:50:00Z', kind: 'unlocked', deviceId: 'd1', deviceName: 'Pixel 9' },
    ],
    session_server_status: { connected: true, server_pid: 4242, protocol: 33, app_version: '0.1.4', launch_mode: 'detached', uptime_ms: 3600000, clients: 1, sessions: 3, own_job: false, mismatch: false, last_error: null },
    messenger_send: null,
    'plugin:notification|is_permission_granted': true, 'plugin:path|resolve_directory': 'C:\\\\Users\\\\me',
  };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{ label: 'main' }], webviews: [{ label: 'main', windowLabel: 'main' }] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      // 비밀은 적지 않는다 — 토큰 · 웹훅 주소는 모양만
      const safe = args && typeof args === 'object' ? { ...args } : args;
      if (safe && typeof safe.token === 'string') safe.token = { type: 'string', len: safe.token.length };
      if (safe && typeof safe.url === 'string') safe.url = { type: 'string', len: safe.url.length };
      window.__calls.push([cmd, safe]);
      if (cmd === 'plugin:event|listen') { (window.__listeners[args.event] ??= []).push(args.handler); return Promise.resolve(args.handler); }
      if (cmd === 'plugin:event|unlisten') return Promise.resolve(null);
      if (cmd === 'open_local_session') return Promise.resolve({ id: nextSession++, shell: 'pwsh' });
      if (cmd === 'load_settings') return Promise.resolve(window.__settings);
      if (cmd === 'save_settings') return Promise.resolve(null);
      if (cmd === 'agent_hooks_status') return Promise.resolve({ installed: args.agent === 'claude', partial: args.agent === 'codex', settingsPath: '~/.' + args.agent + '/settings.json', scriptPath: '~/.aynx/hook', preview: '{}', error: null });
      if (cmd === 'messenger_status') {
        if (args.channel === 'discord' && window.__bots.discord.configured) return Promise.resolve({ configured: true, via: 'bot' });
        const on = window.__hooks[args.channel] === true;
        return Promise.resolve({ configured: on, via: on ? 'webhook' : null });
      }
      if (cmd === 'messenger_set_webhook') {
        if (args.channel === 'discord' && window.__bots.discord.configured) return Promise.reject(new Error('[bot-configured] 봇이 연결돼 있습니다'));
        window.__hooks[args.channel] = typeof args.url === 'string'; return Promise.resolve({ configured: window.__hooks[args.channel] });
      }
      // 봇 → 웹훅 바꾸기(2026-11-19) — 주소 검사 → 봇 해제 → 웹훅 저장(백엔드 계약 · 틀리면 아무것도 안 바뀜)
      if (cmd === 'messenger_replace_bot_with_webhook') {
        if (args.channel !== 'discord') return Promise.reject(new Error('Discord 만'));
        if (!/^https:\\/\\/discord\\.com\\/api\\/webhooks\\/\\d+\\/\\S+$/.test(args.url)) return Promise.reject(new Error('Discord 웹훅 주소가 아닙니다'));
        window.__bots.discord = NOBOT(); window.__hooks.discord = true;
        return Promise.resolve({ configured: true, via: 'webhook' });
      }
      if (cmd === 'messenger_test' || cmd === 'messenger_bot_test') return Promise.resolve(null);
      if (cmd === 'messenger_bot_status') {
        if (chOf(args) === 'discord' && window.__discordOutdated) return Promise.reject(new Error('[server-outdated] 세션 서버를 다시 시작하세요'));
        return Promise.resolve(botNow(chOf(args)));
      }
      if (cmd === 'messenger_bot_set_token') {
        const ch = chOf(args);
        if (args.token === null) { window.__bots[ch] = NOBOT(); return Promise.resolve(botNow(ch)); }
        const ok = ch === 'discord' ? /^[\\w-]+\\.[\\w-]+\\.[\\w-]+$/.test(args.token) : /^\\d+:/.test(args.token);
        if (!ok) return Promise.reject(new Error('[bad-token] 봇 토큰이 맞지 않습니다'));
        // Discord — 봇 토큰을 받으면 웹훅을 지운다(백엔드 계약)
        if (ch === 'discord') window.__hooks.discord = false;
        window.__bots[ch] = { ...window.__bots[ch], configured: true, bot: ch === 'discord' ? 'aynx-bot' : 'my_aynx_bot', link: 'ok' };
        return Promise.resolve(botNow(ch));
      }
      if (cmd === 'messenger_bot_pair') {
        const ch = chOf(args); const b = window.__bots[ch];
        window.__bots[ch] = args.allow ? { ...b, paired: true, pairName: b.pending?.name ?? null, pending: null } : { ...b, pending: null };
        return Promise.resolve(botNow(ch));
      }
      if (cmd === 'messenger_bot_unpair') { const ch = chOf(args); window.__bots[ch] = { ...window.__bots[ch], paired: false, pairName: null }; return Promise.resolve(botNow(ch)); }
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

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", { source: STUB });
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await send("Page.reload", { ignoreCache: true });
await waitBoot(ev);
await sleep(800);
collecting = true;

const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const overlays = importApp("app/overlays.svelte.ts");
const setMod = importApp("lib/settings.svelte.ts");

// ── 도우미 ───────────────────────────────────────────────────────────────────
const CH = (c) => `document.querySelector('[data-messenger-channel="${c}"]')`;
const LIST = `document.querySelector('.slist.accordion.channels')`;
const openNotifications = async (anchor = null) => {
  await ev(`(async () => (await ${overlays}).openSettingsAt('notifications', ${JSON.stringify(anchor)}))()`);
  await sleep(700);
};
const expanded = () => evj(`[...document.querySelectorAll('[data-messenger-open]')].map(e => e.dataset.messengerChannel)`);
const clickHead = async (c) => {
  await ev(`${CH(c)}.querySelector('.slist-open').click()`);
  await sleep(450);
};
const collapseAll = async () => {
  for (const c of await expanded()) await clickHead(c);
};
const setTheme = async (theme) => {
  await ev(`document.documentElement.dataset.theme = ${JSON.stringify(theme)}`);
  await sleep(250);
};
/** 봇 상태를 바꾸고 서버 사건을 쏜다(화면이 두 채널을 다 다시 읽는다 — 사건 몸통에 `channel` 을 싣지 않는다) */
const setBot = async (bot, channel = "telegram") => {
  await ev(`(() => { window.__bots[${JSON.stringify(channel)}] = ${JSON.stringify(bot)}; window.__emit('messenger-bot-event', { changed: true }); })()`);
  await sleep(500);
};
const calls = (cmd) => evj(`window.__calls.filter(c => c[0] === '${cmd}').map(c => c[1])`);
const resetCalls = () => ev(`(window.__calls.length = 0, 1)`);
/**
 * 채널 묶음을 보이는 자리로 — "메신저" 소제목부터 보이게. `scrollIntoView` 는 `overflow: hidden` 조상(설정 창)까지 밀어
 * 창 아래가 비어 찍혔다 — 설정 본문의 스크롤 칸만 직접 민다.
 */
const scrollToEl = (expr, pad = 12) =>
  ev(`(() => { const el = ${expr}; if (!el) return 'none'; let sc = el.parentElement;
    while (sc && !/(auto|scroll)/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    if (!sc) return 'no scroller'; sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - ${pad}; return 'ok'; })()`);
const scrollChannels = async () => {
  await scrollToEl(`(() => { const l = ${LIST}; let h = l.previousElementSibling; while (h && h.tagName !== 'H4') h = h.previousElementSibling; return h ?? l; })()`);
  await sleep(200);
};
const toastsGone = async () => {
  try {
    await waitToastsGone(ev, { timeout: 8000 });
  } catch {
    await ev(`document.querySelectorAll('.toasts .toast button.x').forEach(b => b.click())`);
    await sleep(300);
  }
};
const shots = [];
const capture = async (name, clip) => {
  const params = { format: "png", captureBeyondViewport: false };
  if (clip) params.clip = { ...clip, scale: 1 };
  const r = await send("Page.captureScreenshot", params);
  if (!r.result?.data) {
    console.log(`NOSHOT ${name}`);
    return;
  }
  const p = path.resolve(outdir, name);
  fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
  shots.push(p);
  console.log("PNG " + p);
};
/** 채널 묶음(소제목 + 목록) 자른 것 + 설정 창 전체 */
const shotChannels = async (name) => {
  await toastsGone();
  await scrollChannels();
  const rect = await evj(`(() => {
    const l = ${LIST}; const h = l.previousElementSibling; const a = (h ?? l).getBoundingClientRect(); const b = l.getBoundingClientRect();
    const view = l.closest('.settings-modal')?.getBoundingClientRect() ?? { top: 0, bottom: innerHeight };
    const top = Math.max(view.top, Math.min(a.top, b.top) - 12);
    const bottom = Math.min(view.bottom, b.bottom + 12);
    return { x: Math.max(0, b.left - 12), y: top, width: b.width + 24, height: Math.max(40, bottom - top) };
  })()`);
  await capture(`${name}.png`, rect);
  await capture(`${name}-full.png`);
};
/** 섹션 하나(칩 비교) — 설정 창 전체 */
const shotSection = async (section, name, scrollSel = null) => {
  await ev(`(async () => (await ${overlays}).openSettingsAt(${JSON.stringify(section)}))()`);
  await sleep(900);
  if (scrollSel) {
    await scrollToEl(`document.querySelector(${JSON.stringify(scrollSel)})`, 160);
    await sleep(250);
  }
  await toastsGone();
  await capture(`${name}.png`);
};

// ── 1. 접힌 목록 ──────────────────────────────────────────────────────────────
await openNotifications();
const vis = await ev(`!!${LIST} && ${LIST}.getClientRects().length > 0`);
check(vis === true, "알림 섹션의 채널 목록이 보인다");
const order = await evj(`[...${LIST}.querySelectorAll('[data-messenger-channel]')].map(e => e.dataset.messengerChannel)`);
check(JSON.stringify(order) === JSON.stringify(["discord", "slack", "telegram"]), `채널 셋 · 순서 (${order.join(",")})`);
check((await expanded()).length === 0, "처음엔 모두 접힘");
const toggles = await evj(`({ discord: !!document.getElementById('messenger-discord'), slack: !!document.getElementById('messenger-slack'), telegram: !!document.getElementById('messenger-telegram') })`);
check(toggles.discord && !toggles.slack && !toggles.telegram, `연결된 채널만 보내기 스위치 (${JSON.stringify(toggles)})`);
const noOld = await evj(`(() => { const l = ${LIST}; const btns = [...l.querySelectorAll('button')]; return {
  plus: btns.filter(b => /\\+\\s*연결/.test(b.textContent)).length,
  menu: l.querySelectorAll('[aria-haspopup], .menu-btn, .more').length + btns.filter(b => /⋯|…/.test(b.textContent.trim()) && b.textContent.trim().length <= 2).length,
}; })()`);
check(noOld.plus === 0 && noOld.menu === 0, `[+ 연결] 단추 · ⋯ 메뉴 없음 (${JSON.stringify(noOld)})`);
const heads = await evj(`[...${LIST}.querySelectorAll('[data-messenger-state]')].map(e => e.textContent.replace(/\\s+/g, ' ').trim())`);
console.log("heads:", JSON.stringify(heads));
check(heads[0]?.includes("보내는 중") && heads[1]?.includes("연결 안 됨") && heads[2]?.includes("연결 안 됨"), `머리 칩 (${heads.join(" | ")})`);
await shotChannels("01-collapsed-discord-on-slack-off-telegram-off");
await setTheme("light");
await shotChannels("09a-light-collapsed");
await setTheme("dark");

// 머리줄 보내기 스위치를 눌러도 펼침은 그대로(접힌 채)
await ev(`document.getElementById('messenger-discord').click()`);
await sleep(300);
const afterToggle = await evj(`({ open: [...document.querySelectorAll('[data-messenger-open]')].length, send: document.getElementById('messenger-discord').checked })`);
check(afterToggle.open === 0 && afterToggle.send === false, `접힌 줄의 보내기 스위치 → 펼침 그대로 · 꺼짐 (${JSON.stringify(afterToggle)})`);
const pausedHead = await ev(`${CH("discord")}.querySelector('[data-messenger-state]').textContent.trim()`);
check(/보내기 꺼짐/.test(pausedHead), `끈 채널 칩 = 보내기 꺼짐 (${pausedHead})`);
await ev(`document.getElementById('messenger-discord').click()`);
await sleep(300);

// ── 한 번에 한 칸 ────────────────────────────────────────────────────────────
await clickHead("discord");
check(JSON.stringify(await expanded()) === '["discord"]', "Discord 를 누르면 Discord 만 펼침");
await clickHead("slack");
check(JSON.stringify(await expanded()) === '["slack"]', "Slack 을 누르면 Discord 는 접히고 Slack 만");
await clickHead("slack");
check((await expanded()).length === 0, "같은 줄을 다시 누르면 접힘");

// ── 6. Discord 펼침 · 연결됨 / Slack 펼침 · 연결 전 ─────────────────────────
await clickHead("discord");
const dBody = await evj(`(() => { const b = ${CH("discord")}.querySelector('.slist-body'); return { text: b.innerText.replace(/\\s+/g, ' '), danger: !!b.querySelector('.btn.danger') }; })()`);
check(/등록됨/.test(dBody.text) && /테스트 보내기/.test(dBody.text) && dBody.danger, `Discord 몸통 = 등록됨 · 테스트 보내기 · 연결 해제 (${dBody.text})`);
await shotChannels("06a-discord-open-connected");
await resetCalls();
await ev(`[...${CH("discord")}.querySelectorAll('.slist-body button')].find(b => /테스트 보내기/.test(b.textContent)).click()`);
await sleep(300);
check(JSON.stringify(await calls("messenger_test")) === '[{"channel":"discord"}]', "[테스트 보내기] → messenger_test{channel:discord}");
await clickHead("slack");
const sBody = await evj(`(() => { const b = ${CH("slack")}.querySelector('.slist-body'); const i = b.querySelector('#messenger-slack-webhook'); return { input: !!i, type: i?.type, text: b.innerText.replace(/\\s+/g, ' ') }; })()`);
check(sBody.input && sBody.type === "password", `Slack 몸통 = 웹훅 주소 칸(비밀번호형) (${sBody.text})`);
await shotChannels("06b-slack-open-not-connected");
await clickHead("slack");

// ── 2. Telegram 펼침 · 연결 전 ──────────────────────────────────────────────
await clickHead("telegram");
check(await ev(`!!document.getElementById('messenger-telegram-token')`), "Telegram 연결 전 = 봇 토큰 칸");
await shotChannels("02-telegram-open-no-token");

// [연결] 뒤 칸은 비어 있다 — 거절된 값(칸이 남는 길)으로 본다
const typeToken = async (v) => {
  await ev(`(() => { const i = document.getElementById('messenger-telegram-token'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(120);
};
await resetCalls();
await typeToken("not-a-token");
await ev(`document.getElementById('messenger-telegram-token').closest('form').querySelector('button[type=submit]').click()`);
await sleep(500);
const rej = await evj(`(() => { const i = document.getElementById('messenger-telegram-token'); const f = i?.closest('form'); return { value: i?.value ?? null, alert: f?.querySelector('[role=alert]')?.textContent ?? null }; })()`);
check(rej.value === "", `[연결] 뒤 봇 토큰 칸은 비어 있다(거절돼도) (${JSON.stringify(rej.value)})`);
check(!!rej.alert && !/\[bad-token\]/.test(rej.alert), `거절 문구가 칸 밑에 · 대괄호 표식 없음 (${rej.alert})`);
await shotChannels("02b-telegram-token-rejected");
const setTok = await calls("messenger_bot_set_token");
check(setTok.length === 1 && setTok[0].token?.type === "string", `messenger_bot_set_token 한 번 (토큰은 모양만 기록 ${JSON.stringify(setTok)})`);
await typeToken("123456789:AAexample");
await ev(`document.getElementById('messenger-telegram-token').closest('form').querySelector('button[type=submit]').click()`);
await sleep(600);

// ── 3. 토큰만 · 짝 없음 ─────────────────────────────────────────────────────
const pairIdle = await evj(`(() => { const c = ${CH("telegram")}; return { pairing: c.querySelector('[data-messenger-pairing]')?.dataset.messengerPairing ?? null, head: c.querySelector('[data-messenger-state]').textContent.replace(/\\s+/g, ' ').trim(), toggle: !!document.getElementById('messenger-telegram'), open: c.hasAttribute('data-messenger-open') }; })()`);
check(pairIdle.pairing === "idle" && /계정 연결 대기/.test(pairIdle.head) && /@my_aynx_bot/.test(pairIdle.head), `토큰만 = 계정 연결 안내 · 머리 칩 + 봇 이름 (${pairIdle.head})`);
check(!pairIdle.toggle, "짝 전에는 Telegram 보내기 스위치가 없다");
await shotChannels("03-telegram-token-no-pair");

// ── 4. pending — 접힌 채 사건으로 저절로 펼쳐진다 ────────────────────────────
await collapseAll();
check((await expanded()).length === 0, "pending 전 모두 접힘");
await setBot({ configured: true, bot: "my_aynx_bot", paired: false, pairName: null, pending: { code: "482913", name: "Jin" }, link: "ok" });
await sleep(400);
const pend = await evj(`(() => { const c = ${CH("telegram")}; const code = c.querySelector('.code'); return { open: [...document.querySelectorAll('[data-messenger-open]')].map(e => e.dataset.messengerChannel), code: code?.textContent.trim() ?? null, visible: !!code && code.getBoundingClientRect().height > 0 }; })()`);
check(JSON.stringify(pend.open) === '["telegram"]', `pending 사건 → Telegram 칸이 저절로 펼쳐짐 (${pend.open})`);
check(pend.code === "482 913" && pend.visible, `코드가 보인다 (${pend.code})`);
await shotChannels("04-telegram-pending-code-auto-expanded");
await resetCalls();
await ev(`[...${CH("telegram")}.querySelectorAll('.pair button')].find(b => /허용/.test(b.textContent)).click()`);
await sleep(600);
const pairCalls = await calls("messenger_bot_pair");
check(JSON.stringify(pairCalls) === '[{"channel":"telegram","code":"482913","allow":true}]', `[허용] → messenger_bot_pair{code, allow:true} (${JSON.stringify(pairCalls)})`);

// ── 5. 연결됨 ───────────────────────────────────────────────────────────────
const linked = await evj(`(() => { const c = ${CH("telegram")}; return { toggle: !!document.getElementById('messenger-telegram'), send: document.getElementById('messenger-telegram')?.checked ?? null, name: c.querySelector('[data-messenger-pair-name]')?.textContent ?? null, chat: !!document.getElementById('messenger-channel-telegram-chat'), open: c.hasAttribute('data-messenger-open') }; })()`);
check(linked.toggle && linked.send === true && linked.name === "Jin" && linked.chat && linked.open, `허용 뒤 = 연결됨 · 보내기 켬 · 계정 Jin · 말하기 줄 · 칸 펼친 채 (${JSON.stringify(linked)})`);
const chatBefore = await ev(`(async () => (await ${setMod}).settings.messenger.telegramChat)()`);
await ev(`document.getElementById('messenger-channel-telegram-chat').click()`);
await sleep(300);
const chatAfter = await ev(`(async () => (await ${setMod}).settings.messenger.telegramChat)()`);
check(chatBefore === false && chatAfter === true, `말하기 스위치 → 설정 모델 telegramChat ${chatBefore} → ${chatAfter}`);
const warn = await ev(`!!${CH("telegram")}.querySelector('.slist-body .warn-chip, .slist-body [class*="warn"]')`);
check(warn === true, "말하기 켬 → 경고 칩");
// 펼친 Telegram 칸의 보내기 스위치 — 펼침 그대로
await ev(`document.getElementById('messenger-telegram').click()`);
await sleep(300);
check(JSON.stringify(await expanded()) === '["telegram"]' && (await ev(`document.getElementById('messenger-telegram').checked`)) === false, "펼친 칸의 보내기 스위치 → 펼침 그대로 · 꺼짐");
await ev(`document.getElementById('messenger-telegram').click()`);
await sleep(300);
const tgHead = await ev(`${CH("telegram")}.querySelector('[data-messenger-state]').textContent.replace(/\\s+/g, ' ').trim()`);
check(/보내는 중/.test(tgHead) && /말하기 켜짐/.test(tgHead), `연결됨 머리 칩 = 보내는 중 · 말하기 켜짐 (${tgHead})`);
const edges = await evj(`[...${LIST}.querySelectorAll('[data-messenger-channel]')].map(e => ({ c: e.dataset.messengerChannel, first: e.classList.contains('g-first'), last: e.classList.contains('g-last'), r: getComputedStyle(e).borderTopLeftRadius + '/' + getComputedStyle(e).borderBottomLeftRadius }))`);
console.log("edges:", JSON.stringify(edges));
check(edges[1].last && edges[2].first && edges[2].last, `Telegram 펼침 → Slack 은 위 묶음의 끝 · Telegram 은 홀로 (${JSON.stringify(edges)})`);
await shotChannels("05-telegram-connected-chat-on");
await setTheme("light");
await shotChannels("09b-light-telegram-connected");
await setTheme("dark");

// [저장] payload 에 telegram_chat: true
await resetCalls();
const saveRes = await ev(`(() => { const b = [...document.querySelectorAll('.settings-view button')].find(x => x.textContent.trim() === '저장'); if (!b) return 'none'; b.click(); return 'ok'; })()`);
await sleep(600);
const saved = await calls("save_settings");
check(saveRes === "ok" && saved.length === 1 && saved[0]?.settings?.messenger?.telegram_chat === true, `[저장] payload 의 [messenger] telegram_chat = true (${JSON.stringify(saved[0]?.settings?.messenger)})`);

// 팔레트 색인 — messenger-channel-telegram 으로 가면 그 칸이 펼쳐진다
await clickHead("telegram");
check((await expanded()).length === 0, "색인 전 Telegram 접음");
await ev(`(async () => (await ${overlays}).openSettingsAt('general'))()`);
await sleep(400);
await openNotifications("messenger-channel-telegram");
check(JSON.stringify(await expanded()) === '["telegram"]', `색인 messenger-channel-telegram → Telegram 칸 펼침 (${await expanded()})`);
await collapseAll();
await openNotifications("messenger-channel-telegram-chat");
const chatAnchor = await evj(`({ open: [...document.querySelectorAll('[data-messenger-open]')].map(e => e.dataset.messengerChannel), inView: (() => { const r = document.getElementById('messenger-channel-telegram-chat')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; })() })`);
check(JSON.stringify(chatAnchor.open) === '["telegram"]' && chatAnchor.inView, `색인 messenger-channel-telegram-chat → 펼치고 그 줄이 보인다 (${JSON.stringify(chatAnchor)})`);

// ── 7. 받는 고리 conflict (접힌 줄) ─────────────────────────────────────────
await collapseAll();
await setBot({ configured: true, bot: "my_aynx_bot", paired: true, pairName: "Jin", pending: null, link: "conflict" });
const conflict = await ev(`${CH("telegram")}.querySelector('[data-messenger-state]').textContent.replace(/\\s+/g, ' ').trim()`);
check(/글을 받지 못함/.test(conflict) && /다른 프로그램/.test(conflict), `conflict → "글을 받지 못함" 칩 + 곁글 (${conflict})`);
check((await expanded()).length === 0, "conflict 사건은 칸을 펼치지 않는다");
await shotChannels("07-telegram-link-conflict-collapsed");

// 좁은 창 — 곁글 · 칩 줄바꿈과 펼친 몸통의 손잡이 줄바꿈
await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
await sleep(500);
const narrowConflict = await evj(`(() => { const c = ${CH("telegram")}; const row = c.querySelector('.slist-row').getBoundingClientRect(); const sup = c.querySelector('[data-messenger-state]').getBoundingClientRect(); return { rowRight: row.right, supRight: sup.right, over: c.scrollWidth > c.clientWidth }; })()`);
check(!narrowConflict.over && narrowConflict.supRight <= narrowConflict.rowRight, `좁은 창 · conflict 칩 줄이 넘치지 않는다 (${JSON.stringify(narrowConflict)})`);
await shotChannels("07n-narrow-760-conflict-collapsed");
await setBot({ configured: true, bot: "my_aynx_bot", paired: true, pairName: "Jin", pending: null, link: "ok" });
await clickHead("telegram");
const narrowOver = await ev(`(() => { const b = ${CH("telegram")}.querySelector('.slist-body'); return [...b.querySelectorAll('button, input, .warn-chip')].filter(e => { const r = e.getBoundingClientRect(); const p = b.getBoundingClientRect(); return r.right > p.right + 0.5 || r.left < p.left - 0.5; }).length; })()`);
check(narrowOver === 0, `좁은 창 · 펼친 Telegram 몸통의 손잡이가 넘치지 않는다 (${narrowOver})`);
await shotChannels("05n-narrow-760-telegram-connected");
await clickHead("telegram");
await clickHead("slack");
await shotChannels("06n-narrow-760-slack-open-not-connected");
await clickHead("slack");
await send("Emulation.setDeviceMetricsOverride", { width: W, height: H, deviceScaleFactor: 1, mobile: false });
await sleep(500);

// ── 11. Discord — 한 번에 한 방식(2026-11-19 A안 · 목업 "Discord 채널 줄" ①–⑥): "연결 방식" 줄이 늘 맨 위 · 머리줄 첫 칩 = 지금 방식 ·
//        웹훅 → [봇] → 토큰 → 확인([취소] · 거절 · [바꾸기]) → 짝짓기 → 연결됨 → [웹훅] → 주소 → 확인 → 웹훅 → 해제 → 연결 전 등록(확인 없음) ──
const dBodyOf = () =>
  evj(`(() => { const c = ${CH("discord")}; const b = c.querySelector('.slist-body');
    const names = [...b.querySelectorAll(':scope > .srow > .name, :scope > form.srow > .name, :scope > .srow.pair-row > .name')].map(e => e.textContent.trim());
    const tok = document.getElementById('messenger-discord-token'); const wh = document.getElementById('messenger-discord-webhook');
    const sup = c.querySelector('[data-messenger-state]'); const kind = sup.querySelector('[data-messenger-kind]');
    const confirm = b.querySelector('[data-messenger-confirm]');
    return { names, text: b.innerText.replace(/\\s+/g, ' '), token: tok ? { type: tok.type, value: tok.value, placeholder: tok.placeholder, disabled: tok.disabled, title: tok.title } : null,
      webhook: !!wh, hookInput: wh ? { value: wh.value, disabled: wh.disabled, title: wh.title } : null,
      via: c.querySelector('#messenger-discord-via [aria-pressed=true]')?.dataset.value ?? null,
      kind: kind ? kind.textContent.trim() : null, kindFirst: !!kind && sup.firstElementChild === kind, kindDot: !!kind?.querySelector('.dot'),
      confirm: confirm ? confirm.innerText.replace(/\\s+/g, ' ').trim() : null,
      head: sup.textContent.replace(/\\s+/g, ' ').trim(), toggle: !!document.getElementById('messenger-discord'),
      open: c.hasAttribute('data-messenger-open') }; })()`);
const dButton = (re) => `[...${CH("discord")}.querySelectorAll('.slist-body button')].find(b => ${re}.test(b.textContent))`;
const pickVia = async (v) => {
  await ev(`${CH("discord")}.querySelector('#messenger-discord-via [data-value=${v}]').click()`);
  await sleep(300);
};
/** 칸에 넣고 [연결] — 바꾸기 몸통이면 확인이 선다 */
const typeInto = async (id, v) => {
  await ev(`(() => { const i = document.getElementById('${id}'); i.value = ${JSON.stringify(v)}; i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await sleep(120);
  await ev(`document.getElementById('${id}').closest('form').querySelector('button[type=submit]').click()`);
  await sleep(400);
};
const confirmGo = async () => {
  await ev(`${CH("discord")}.querySelector('[data-messenger-confirm-go]').click()`);
  await sleep(600);
};
const confirmCancel = async () => {
  await ev(`${CH("discord")}.querySelector('[data-messenger-confirm-cancel]').click()`);
  await sleep(300);
};
const alertOf = (id) => ev(`document.getElementById('${id}')?.closest('form')?.querySelector('[role=alert]')?.textContent ?? null`);
await collapseAll();
await clickHead("discord");
// ① 웹훅 연결됨
let d = await dBodyOf();
check(
  JSON.stringify(d.names) === JSON.stringify(["연결 방식", "웹훅", "웹훅 연결 해제"]) && d.via === "webhook" && !d.token && /보내는 중/.test(d.head),
  `① 웹훅 연결됨 = 연결 방식[웹훅] · 웹훅 · 웹훅 연결 해제 (${JSON.stringify(d.names)} · via ${d.via} · ${d.head})`,
);
check(d.kind === "웹훅" && d.kindFirst && !d.kindDot, `① 머리줄 첫 칩 = 웹훅(점 없음) (${JSON.stringify([d.kind, d.kindFirst, d.kindDot])})`);
check(!/봇으로 바꾸기/.test(d.text), "[봇으로 바꾸기] 줄은 없다");
await shotChannels("11a-state1-webhook-connected");
// ② [봇] — 봇 토큰 칸 + 바꾸기 안내 · 아무것도 안 바뀜
await resetCalls();
await pickVia("bot");
d = await dBodyOf();
check(
  JSON.stringify(d.names) === JSON.stringify(["연결 방식", "봇 토큰"]) && d.via === "bot" && d.token?.type === "password" && /^MT/.test(d.token.placeholder) && !d.webhook,
  `② [봇] → 봇 토큰 칸 하나(비밀번호형 · Discord 자리표시) (${JSON.stringify(d.names)} · ${d.token?.placeholder})`,
);
check(/개발자 포털/.test(d.text) && /지금은 웹훅으로 연결돼 있습니다/.test(d.text), `② 요령 + "지금은 웹훅으로…" 한 줄 (${d.text})`);
check(d.kind === "웹훅" && (await ev(`window.__hooks.discord`)) === true && (await calls("messenger_bot_set_token")).length === 0, "② 머리줄 칩은 웹훅 그대로 · 아무 명령도 없음");
await shotChannels("11b-state2-webhook-pick-bot");
await pickVia("webhook");
d = await dBodyOf();
check(JSON.stringify(d.names) === JSON.stringify(["연결 방식", "웹훅", "웹훅 연결 해제"]), `② 에서 [웹훅] → ① 로 돌아감 (${JSON.stringify(d.names)})`);
await pickVia("bot");
// ③ [연결] → 확인 — 칸은 비고 사라진다 · [취소] 는 칸으로
await typeInto("messenger-discord-token", "MTIzNDU2Nzg5MDEy.Gx1a2b.abcdefghijklmnop");
d = await dBodyOf();
check(!!d.confirm && /웹훅을 봇으로 바꿀까요\?/.test(d.confirm) && /바꾸기/.test(d.confirm) && /취소/.test(d.confirm) && !d.token, `③ [연결] → 칸 자리에 확인 · 토큰 칸 없음 (${d.confirm})`);
check((await calls("messenger_bot_set_token")).length === 0 && d.kind === "웹훅", "③ 확인 전에는 명령이 없다 · 칩은 웹훅");
const noSecret = await ev(`!${CH("discord")}.innerHTML.includes('abcdefghijklmnop')`);
check(noSecret === true, "③ 친 토큰이 화면(DOM)에 남지 않는다");
await shotChannels("11c-state3-confirm-to-bot");
await confirmCancel();
d = await dBodyOf();
check(!d.confirm && d.token?.value === "" && (await calls("messenger_bot_set_token")).length === 0 && (await ev(`window.__hooks.discord`)) === true, `③ [취소] → 빈 칸으로 · 명령 없음 · 웹훅 그대로 (${JSON.stringify(d.token)})`);
// 틀린 토큰 → [바꾸기] → 거절 — 아무것도 안 바뀜
await typeInto("messenger-discord-token", "123456789:AAtelegram-shape");
await confirmGo();
const dRejAlert = await alertOf("messenger-discord-token");
d = await dBodyOf();
check(d.token?.value === "" && !!dRejAlert && !/\[bad-token\]/.test(dRejAlert) && !d.confirm, `틀린 토큰 → 칸으로 · 문구 칸 밑 · 표식 없음 (${dRejAlert})`);
check((await ev(`window.__hooks.discord`)) === true && d.kind === "웹훅" && (await calls("messenger_bot_set_token")).length === 1, "거절되면 웹훅 그대로 · 칩 웹훅");
await shotChannels("11c2-discord-to-bot-rejected");
// 맞는 토큰 → [바꾸기] → 계정 연결 화면 · 칩 봇
await resetCalls();
await typeInto("messenger-discord-token", "MTIzNDU2Nzg5MDEy.Gx1a2b.abcdefghijklmnop");
await confirmGo();
const dSet = await calls("messenger_bot_set_token");
const dStatusCalls = await calls("messenger_status");
check(
  dSet.length === 1 && dSet[0].channel === "discord" && dSet[0].token?.type === "string",
  `[바꾸기] → messenger_bot_set_token{channel:discord} 한 번(토큰은 모양만 ${JSON.stringify(dSet)})`,
);
check(dStatusCalls.some((c) => c.channel === "discord"), `토큰이 받아들여지면 messenger_status{discord} 를 다시 읽는다 (${JSON.stringify(dStatusCalls)})`);
d = await dBodyOf();
check(
  !d.token && !d.webhook && !/등록됨/.test(d.text) && d.via === "bot" && JSON.stringify(d.names) === JSON.stringify(["연결 방식", "계정 연결", "봇 연결 해제"]),
  `바꾼 뒤 = 연결 방식[봇] · 계정 연결 · 봇 연결 해제(웹훅 줄 없음) (${JSON.stringify(d.names)})`,
);
check(d.kind === "봇" && d.kindFirst, `바꾼 뒤 머리줄 첫 칩 = 봇 (${d.kind})`);
check(/계정 연결 대기/.test(d.head) && /aynx-bot/.test(d.head) && !/@aynx-bot/.test(d.head) && !d.toggle, `머리 = 계정 연결 대기 + aynx-bot(@ 없음) · 보내기 스위치 없음 (${d.head})`);
check(/DM/.test(d.text) && /같은 서버/.test(d.text), `짝짓기 요령 = DM · 설치 또는 같은 서버 (${d.text})`);
await shotChannels("11b-discord-bot-pairing");

// pending — 접힌 채 사건(채널 칸 없음)으로 두 채널을 다시 읽고 Discord 칸이 저절로 펼쳐진다
await collapseAll();
await resetCalls();
await setBot({ configured: true, bot: "aynx-bot", paired: false, pairName: null, pending: { code: "135790", name: "my_account" }, link: "ok" }, "discord");
await sleep(300);
const reread = (await calls("messenger_bot_status")).map((c) => c?.channel);
check(reread.includes("telegram") && reread.includes("discord"), `사건 하나 → 두 채널 봇 상태를 다시 읽는다 (${JSON.stringify(reread)})`);
const dPend = await evj(`(() => { const c = ${CH("discord")}; const code = c.querySelector('.code'); return { open: [...document.querySelectorAll('[data-messenger-open]')].map(e => e.dataset.messengerChannel), code: code?.textContent.trim() ?? null, who: c.querySelector('.who')?.textContent ?? '' }; })()`);
check(JSON.stringify(dPend.open) === '["discord"]' && dPend.code === "135 790" && /my_account/.test(dPend.who), `Discord pending → 저절로 펼침 · 코드 · 이름 (${JSON.stringify(dPend)})`);
await shotChannels("11c-discord-pending-code");
await resetCalls();
await ev(`[...${CH("discord")}.querySelectorAll('.pair button')].find(b => /허용/.test(b.textContent)).click()`);
await sleep(600);
check(JSON.stringify(await calls("messenger_bot_pair")) === '[{"channel":"discord","code":"135790","allow":true}]', "[허용] → messenger_bot_pair{channel:discord, code, allow:true}");
d = await dBodyOf();
check(
  JSON.stringify(d.names) === JSON.stringify(["연결 방식", "메신저에서 AI 타일에 말하기", "연결된 계정", "봇", "봇 연결 해제"]) && !d.webhook && d.toggle && d.open && d.via === "bot",
  `④ Discord 봇 연결됨 = 연결 방식[봇] · 말하기 · 연결된 계정 · 봇 · 봇 연결 해제(웹훅 줄 없음) · 보내기 스위치 (${JSON.stringify(d.names)})`,
);
check(d.kind === "봇" && d.kindFirst, `④ 머리줄 첫 칩 = 봇 (${d.kind})`);
const dLinked = await evj(`(() => { const c = ${CH("discord")}; return { name: c.querySelector('[data-messenger-pair-name]')?.textContent ?? null, send: document.getElementById('messenger-discord')?.checked ?? null, chat: document.getElementById('messenger-channel-discord-chat')?.checked ?? null }; })()`);
check(dLinked.name === "my_account" && dLinked.send === true && dLinked.chat === false, `연결된 계정 my_account · 보내기 켬 · 말하기 끔 (${JSON.stringify(dLinked)})`);
const tgChatBefore = await ev(`(async () => (await ${setMod}).settings.messenger.telegramChat)()`);
await ev(`document.getElementById('messenger-channel-discord-chat').click()`);
await sleep(300);
const dChat = JSON.parse(await ev(`(async () => { const s = (await ${setMod}).settings.messenger; return JSON.stringify({ discord: s.discordChat, telegram: s.telegramChat }); })()`));
check(dChat.discord === true && dChat.telegram === tgChatBefore, `Discord 말하기 → discordChat true · telegramChat 그대로 (${JSON.stringify(dChat)})`);
const dWarn = await ev(`!!${CH("discord")}.querySelector('.slist-body .warn-chip, .slist-body [class*="warn"]')`);
check(dWarn === true, "Discord 말하기 켬 → 경고 칩");
d = await dBodyOf();
check(/보내는 중/.test(d.head) && /말하기 켜짐/.test(d.head), `Discord 머리 = 보내는 중 · 말하기 켜짐 (${d.head})`);
await resetCalls();
await ev(`${dButton("/테스트 보내기/")}.click()`);
await sleep(300);
check(JSON.stringify(await calls("messenger_bot_test")) === '[{"channel":"discord"}]', "봇 [테스트 보내기] → messenger_bot_test{channel:discord}");
await shotChannels("11d-discord-bot-connected-chat-on");
await setTheme("light");
await shotChannels("11d-light-discord-bot-connected");
await setTheme("dark");
await resetCalls();
await ev(`(() => { const b = [...document.querySelectorAll('.settings-view button')].find(x => x.textContent.trim() === '저장'); b?.click(); })()`);
await sleep(600);
const dSaved = await calls("save_settings");
check(dSaved[0]?.settings?.messenger?.discord_chat === true, `[저장] payload 의 [messenger] discord_chat = true (${JSON.stringify(dSaved[0]?.settings?.messenger)})`);

// 색인 — 말하기 줄
await collapseAll();
await ev(`(async () => (await ${overlays}).openSettingsAt('general'))()`);
await sleep(400);
await openNotifications("messenger-channel-discord-chat");
const dAnchor = await evj(`({ open: [...document.querySelectorAll('[data-messenger-open]')].map(e => e.dataset.messengerChannel), inView: (() => { const r = document.getElementById('messenger-channel-discord-chat')?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom <= innerHeight; })() })`);
check(JSON.stringify(dAnchor.open) === '["discord"]' && dAnchor.inView, `색인 messenger-channel-discord-chat → Discord 펼침 · 줄이 보인다 (${JSON.stringify(dAnchor)})`);

// ⑤ 봇 연결됨에서 [웹훅] — 주소 칸 + 바꾸기 안내 · 아무것도 안 바뀜
await resetCalls();
await pickVia("webhook");
d = await dBodyOf();
check(
  JSON.stringify(d.names) === JSON.stringify(["연결 방식", "Discord 웹훅 주소"]) && d.via === "webhook" && d.hookInput && !d.hookInput.disabled && !d.token,
  `⑤ [웹훅] → 웹훅 주소 칸 하나 (${JSON.stringify(d.names)})`,
);
check(/지금은 봇으로 연결돼 있습니다/.test(d.text) && /웹후크/.test(d.text), `⑤ 요령 + "지금은 봇으로…" 한 줄 (${d.text})`);
check(d.kind === "봇" && (await calls("messenger_replace_bot_with_webhook")).length === 0 && (await calls("messenger_set_webhook")).length === 0, "⑤ 머리줄 칩은 봇 그대로 · 명령 없음");
await shotChannels("11e-state5-bot-pick-webhook");
await pickVia("bot");
d = await dBodyOf();
check(JSON.stringify(d.names) === JSON.stringify(["연결 방식", "메신저에서 AI 타일에 말하기", "연결된 계정", "봇", "봇 연결 해제"]), `⑤ 에서 [봇] → ④ 로 돌아감 (${JSON.stringify(d.names)})`);
await pickVia("webhook");
// ⑥ [연결] → 확인 · [취소]
const GOOD_HOOK = "https://discord.com/api/webhooks/123456789/abcDEF-token_xyz";
await typeInto("messenger-discord-webhook", GOOD_HOOK);
d = await dBodyOf();
check(!!d.confirm && /봇을 웹훅으로 바꿀까요\?/.test(d.confirm) && /AI 타일에 말할 수 없습니다/.test(d.confirm) && !d.webhook, `⑥ [연결] → 확인 · 주소 칸 없음 (${d.confirm})`);
check((await calls("messenger_replace_bot_with_webhook")).length === 0 && d.kind === "봇", "⑥ 확인 전에는 명령이 없다 · 칩은 봇");
await shotChannels("11f-state6-confirm-to-webhook");
await confirmCancel();
d = await dBodyOf();
check(!d.confirm && d.hookInput?.value === "" && (await ev(`window.__bots.discord.configured`)) === true, `⑥ [취소] → 빈 칸 · 봇 그대로 (${JSON.stringify(d.hookInput)})`);
// 틀린 주소 → [바꾸기] → 거절 — 봇 그대로
await typeInto("messenger-discord-webhook", "https://evil.example/api/webhooks/1/x");
await confirmGo();
const hookRej = await alertOf("messenger-discord-webhook");
d = await dBodyOf();
check(!!hookRej && d.hookInput?.value === "" && (await ev(`window.__bots.discord.configured`)) === true && d.kind === "봇", `틀린 주소 → 칸 밑 문구 · 봇 그대로 (${hookRej})`);
check((await calls("messenger_replace_bot_with_webhook")).length === 1 && (await calls("messenger_set_webhook")).length === 0, "거절도 새 명령 한 번 · messenger_set_webhook 은 부르지 않는다");
// 맞는 주소 → [바꾸기] → 웹훅
await resetCalls();
await typeInto("messenger-discord-webhook", GOOD_HOOK);
await confirmGo();
const rep = await calls("messenger_replace_bot_with_webhook");
check(rep.length === 1 && rep[0].channel === "discord" && rep[0].url?.type === "string" && (await calls("messenger_set_webhook")).length === 0, `[바꾸기] → messenger_replace_bot_with_webhook{channel:discord, url} 한 번 (${JSON.stringify(rep)})`);
d = await dBodyOf();
check(
  JSON.stringify(d.names) === JSON.stringify(["연결 방식", "웹훅", "웹훅 연결 해제"]) && d.via === "webhook" && d.kind === "웹훅" && d.kindFirst && d.toggle && /보내는 중/.test(d.head) && !/말하기 켜짐/.test(d.head),
  `바꾼 뒤 = 웹훅 몸통 · 칩 웹훅 · 말하기 칩 없음 (${JSON.stringify(d.names)} · ${d.head})`,
);
await shotChannels("11g-discord-switched-to-webhook");
// 웹훅 해제 → 연결 전 — 방식 고르기(처음은 봇) · 칩 없음
await resetCalls();
await ev(`${dButton("/^\\s*연결 해제\\s*$/")}.click()`);
await sleep(600);
check(JSON.stringify(await calls("messenger_set_webhook")) === '[{"channel":"discord","url":null}]', "웹훅 연결 해제 → messenger_set_webhook{channel:discord, url:null}");
d = await dBodyOf();
check(
  d.via === "bot" && !!d.token && !d.webhook && /연결 안 됨/.test(d.head) && !d.toggle && d.kind === null && JSON.stringify(d.names) === JSON.stringify(["연결 방식", "봇 토큰"]),
  `해제 뒤 = 연결 방식 [봇] + 봇 토큰 칸 · 연결 안 됨 · 방식 칩 없음 (${JSON.stringify(d.names)} · via ${d.via} · ${d.kind})`,
);
check(!/지금은/.test(d.text), "연결 전 칸에는 바꾸기 안내가 없다");
await shotChannels("11h-discord-not-connected-bot");
await pickVia("webhook");
d = await dBodyOf();
check(d.via === "webhook" && d.webhook && !d.token && JSON.stringify(d.names) === JSON.stringify(["연결 방식", "Discord 웹훅 주소"]), `[웹훅] → 웹훅 주소 칸 하나 (${JSON.stringify(d.names)})`);
await shotChannels("11i-discord-not-connected-webhook");
await pickVia("bot");
// 연결 전 봇 등록은 확인 없이 곧바로 → 봇 연결 해제
await resetCalls();
await typeInto("messenger-discord-token", "MTIzNDU2Nzg5MDEy.Gx1a2b.abcdefghijklmnop");
await sleep(300);
d = await dBodyOf();
check(!d.confirm && (await calls("messenger_bot_set_token")).length === 1 && JSON.stringify(d.names) === JSON.stringify(["연결 방식", "계정 연결", "봇 연결 해제"]), `연결 전 봇 토큰 → 확인 없이 등록 (${JSON.stringify(d.names)})`);
await resetCalls();
await ev(`${dButton("/^\\s*연결 해제\\s*$/")}.click()`);
await sleep(600);
check(JSON.stringify(await calls("messenger_bot_set_token")) === '[{"channel":"discord","token":null}]', "봇 연결 해제 → messenger_bot_set_token{channel:discord, token:null}");
d = await dBodyOf();
check(d.via === "bot" && !!d.token && d.kind === null, `봇 해제 뒤 = 연결 전 (${JSON.stringify(d.names)})`);

// 옛 세션 서버 — Discord 봇 상태가 [server-outdated] 로 거절되면 토큰 칸 밑에 표식 없이
await ev(`(() => { window.__discordOutdated = true; window.__emit('messenger-bot-event', { changed: true }); })()`);
await sleep(500);
const outdated = await ev(`document.getElementById('messenger-discord-token')?.closest('form')?.querySelector('[role=alert]')?.textContent ?? null`);
check(!!outdated && /세션 서버/.test(outdated) && !/\[server-outdated\]/.test(outdated), `옛 세션 서버 → 토큰 칸 밑 문구 · 표식 없음 (${outdated})`);
await shotChannels("11j-discord-server-outdated");
await ev(`(() => { window.__discordOutdated = false; window.__emit('messenger-bot-event', { changed: true }); })()`);
await sleep(400);
await collapseAll();

// ── 10. 칩 색 — AI 에이전트 · 원격 접속 · 일반 › 세션 서버, 어두운 · 밝은 ────────
for (const theme of ["dark", "light"]) {
  await setTheme(theme);
  await shotSection("ai", `10-chips-ai-agents-${theme}`);
  await shotSection("remote", `10-chips-remote-${theme}`);
  await shotSection("general", `10-chips-session-server-${theme}`, "[data-session-server-state]");
}
await setTheme("dark");
const chipTones = await evj(`(() => { const out = {}; for (const e of document.querySelectorAll('.status-chip')) { const t = [...e.classList].find(c => c !== 'status-chip' && !c.startsWith('s-') && !c.startsWith('svelte-')); out[t] = (out[t] ?? 0) + 1; } return out; })()`);
console.log("chip tones on last section:", JSON.stringify(chipTones));

const unstubbed = await evj(`[...new Set(window.__unstubbed)]`);
console.log("unstubbed commands (main):", JSON.stringify(unstubbed));
const mainErrors = errors.filter((e) => !/stub: /.test(e));
check(mainErrors.length === 0, `콘솔 오류 0 — 메인 PC 창 (${mainErrors.length}) ${mainErrors.slice(0, 3).join(" | ")}`);

// ── 8. 원격 창 — 연결된 Telegram ────────────────────────────────────────────
errors.length = 0;
collecting = false;
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__AYNX_REMOTE__ = true;
  window.__bots = { telegram: { configured: true, bot: 'my_aynx_bot', paired: true, pairName: 'Jin', pending: null, link: 'ok' },
    discord: { configured: true, bot: 'aynx-bot', paired: true, pairName: 'my_account', pending: null, link: 'ok' } };
  window.__hooks = { discord: true, slack: false };`,
});
await reloadBoot(send, ev);
await sleep(800);
collecting = true;
check((await ev(`window.__AYNX_REMOTE__ === true`)) === true, "원격 창 표식");
await openNotifications();
await clickHead("telegram");
const remote = await evj(`(() => {
  const c = ${CH("telegram")}; const body = c.querySelector('.slist-body');
  const btn = (re) => [...body.querySelectorAll('button')].find(b => re.test(b.textContent));
  const chat = document.getElementById('messenger-channel-telegram-chat');
  const re = btn(/다시 연결/); const un = btn(/연결 해제/); const test = btn(/테스트 보내기/);
  return { open: c.hasAttribute('data-messenger-open'), repair: re ? { disabled: re.disabled, title: re.title } : null, unbot: un ? { disabled: un.disabled, title: un.title } : null,
    test: test ? test.disabled : null, chat: chat ? { disabled: chat.disabled, checked: chat.checked, title: chat.title } : null };
})()`);
console.log("remote:", JSON.stringify(remote));
check(remote.open, "원격 창 · Telegram 펼침");
check(remote.repair?.disabled === true && remote.unbot?.disabled === true && /메인 PC/.test(remote.unbot?.title ?? ""), `원격 창 → [다시 연결] · [연결 해제] disabled + "메인 PC" 툴팁 (${JSON.stringify([remote.repair, remote.unbot])})`);
check(remote.test === false, "원격 창 → [테스트 보내기] 는 산다");
check(remote.chat?.disabled === true && remote.chat?.checked === false, `원격 창 → 말하기 스위치 잠금(저장된 값 꺼짐) (${JSON.stringify(remote.chat)})`);
await shotChannels("08-remote-telegram-connected-locked");
// 원격 창의 연결 전 채널 — Discord 연결 해제 · Slack 주소 칸(웹훅은 HOME_ONLY 표에 없다 — 기록만)
await clickHead("slack");
const remoteSlack = await evj(`(() => { const i = document.getElementById('messenger-slack-webhook'); return { input: !!i, disabled: i?.disabled ?? null }; })()`);
console.log("remote slack webhook input:", JSON.stringify(remoteSlack));
await clickHead("slack");
// 원격 창 — 봇으로 연결한 Discord: 다시 연결 · 연결 해제 · 말하기 켜기 잠김(Telegram 과 따로 · 저장된 discord_chat 이 꺼짐)
await clickHead("discord");
const remoteD = await evj(`(() => {
  const c = ${CH("discord")}; const body = c.querySelector('.slist-body');
  const btn = (re) => [...body.querySelectorAll('button')].find(b => re.test(b.textContent));
  const chat = document.getElementById('messenger-channel-discord-chat');
  const re = btn(/다시 연결/); const un = btn(/연결 해제/); const test = btn(/테스트 보내기/);
  return { open: c.hasAttribute('data-messenger-open'), repair: re ? { disabled: re.disabled, title: re.title } : null, unbot: un ? { disabled: un.disabled, title: un.title } : null,
    test: test ? test.disabled : null, chat: chat ? { disabled: chat.disabled, checked: chat.checked, title: chat.title } : null };
})()`);
console.log("remote discord:", JSON.stringify(remoteD));
check(
  remoteD.open && remoteD.repair?.disabled === true && remoteD.unbot?.disabled === true && /메인 PC/.test(remoteD.unbot?.title ?? "") && remoteD.test === false,
  `원격 창 · Discord 봇 → [다시 연결] · [연결 해제] 잠김 + "메인 PC" · [테스트 보내기] 는 산다 (${JSON.stringify([remoteD.repair, remoteD.unbot, remoteD.test])})`,
);
check(remoteD.chat?.disabled === true && /메인 PC/.test(remoteD.chat?.title ?? ""), `원격 창 · Discord 말하기 잠금 (${JSON.stringify(remoteD.chat)})`);
await shotChannels("12a-remote-discord-bot-locked");
await setBot({ configured: true, bot: "aynx-bot", paired: false, pairName: null, pending: { code: "246810", name: "my_account" }, link: "ok" }, "discord");
const remotePair = await evj(`[...${CH("discord")}.querySelectorAll('.pair button')].map(b => ({ t: b.textContent.trim(), disabled: b.disabled, title: b.title }))`);
check(remotePair.length === 2 && remotePair.every((b) => b.disabled && /메인 PC/.test(b.title)), `원격 창 · Discord [허용] · [거절] 잠김 (${JSON.stringify(remotePair)})`);
// 봇으로 연결된 Discord 에서 [웹훅] — 주소 칸 · [연결] 잠김 + "메인 PC"(봇을 지우는 바꾸기는 메인 PC 전용)
await setBot({ configured: true, bot: "aynx-bot", paired: true, pairName: "my_account", pending: null, link: "ok" }, "discord");
await pickVia("webhook");
const remoteToHook = await evj(`(() => { const i = document.getElementById('messenger-discord-webhook'); const s = i?.closest('form')?.querySelector('button[type=submit]'); return i ? { disabled: i.disabled, title: i.title, submit: s?.disabled ?? null, submitTitle: s?.title ?? '' } : null; })()`);
check(remoteToHook?.disabled === true && remoteToHook.submit === true && /메인 PC/.test(remoteToHook.title) && /메인 PC/.test(remoteToHook.submitTitle), `원격 창 · 봇 Discord → [웹훅] 칸 · [연결] 잠김 + "메인 PC" (${JSON.stringify(remoteToHook)})`);
await shotChannels("12b-remote-discord-bot-to-webhook-locked");
await pickVia("bot");
// 웹훅으로 연결된 Discord 에서 [봇] — 토큰 칸 · [연결] 잠김
await ev(`(() => { window.__hooks.discord = true; })()`);
await setBot({ configured: false, bot: null, paired: false, pairName: null, pending: null, link: "off" }, "discord");
await sleep(300);
d = await dBodyOf();
check(d.kind === "웹훅" && JSON.stringify(d.names) === JSON.stringify(["연결 방식", "웹훅", "웹훅 연결 해제"]), `원격 창 · 웹훅 Discord = ① 과 같다 (${JSON.stringify(d.names)})`);
await pickVia("bot");
d = await dBodyOf();
const remoteToBotSubmit = await evj(`(() => { const s = document.getElementById('messenger-discord-token')?.closest('form')?.querySelector('button[type=submit]'); return s ? { disabled: s.disabled, title: s.title } : null; })()`);
check(d.token?.disabled === true && /메인 PC/.test(d.token.title) && remoteToBotSubmit?.disabled === true, `원격 창 · 웹훅 Discord → [봇] 토큰 칸 · [연결] 잠김 + "메인 PC" (${JSON.stringify([d.token, remoteToBotSubmit])})`);
await shotChannels("12c-remote-discord-webhook-to-bot-locked");
// 연결 전 — 웹훅 등록은 원격에서도 되고 봇 토큰은 잠긴다(그대로). `messenger_status` 는 화면이 설 때 읽으므로 셋째 주입 스크립트로 비우고 다시 읽는다
await clickHead("discord");
collecting = false;
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `window.__hooks = { discord: false, slack: false };
  window.__bots.discord = { configured: false, bot: null, paired: false, pairName: null, pending: null, link: 'off' };`,
});
await reloadBoot(send, ev);
await sleep(800);
collecting = true;
await openNotifications();
await clickHead("discord");
d = await dBodyOf();
console.log("remote none:", JSON.stringify({ names: d.names, kind: d.kind, token: d.token }));
check(d.kind === null && d.via === "bot" && d.token?.disabled === true, `원격 창 · 연결 전 [봇] → 토큰 칸 잠김 (${JSON.stringify([d.names, d.token])})`);
await pickVia("webhook");
d = await dBodyOf();
check(d.hookInput && d.hookInput.disabled === false && !/지금은/.test(d.text), `원격 창 · 연결 전 [웹훅] → 주소 칸은 산다 (${JSON.stringify(d.hookInput)})`);
await shotChannels("12d-remote-discord-not-connected-webhook");
await clickHead("discord");
const remoteErrors = errors.filter((e) => !/stub: /.test(e));
const unstubbedR = await evj(`[...new Set(window.__unstubbed)]`);
console.log("unstubbed commands (remote):", JSON.stringify(unstubbedR));
check(remoteErrors.length === 0, `콘솔 오류 0 — 원격 창 (${remoteErrors.length}) ${remoteErrors.slice(0, 3).join(" | ")}`);

ws.close();
console.log(`\nSHOTS ${shots.length}`);
console.log(failed ? `FAILED ${failed} / PASSED ${passed}` : `ALL PASS (${passed})`);
process.exit(failed ? 1 : 0);
