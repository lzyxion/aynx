// 헤드리스 검증 — **채팅 모양 AI 타일**(2026-11-27 — `chat-tile/ChatTileLeaf` · `ChatTileFace` · `ChatTilePermCard` · 독 [채팅] · AI 고르기 상자 [채팅]).
// 서버는 없다 — `chat_tile_*` 명령은 스텁이 답하고 사건은 Channel 로 민다(`__ctEmit`). 스텁 꼴은 `side-chat-perm-mode-harness.mjs` 그대로.
// 보는 것: ① 독 [채팅](설정 켬 · 끄면 없음) ② 누르면 채팅 잎 · open{fresh} · subscribe ③ 보내기 → send{epoch:0, clientId} · 흐름 말풍선 ④ 도구 줄
// ⑤ 권한 카드 단추 둘 · diff · [허용] → decide{allow} · 입력 칸 대신 한 줄 ⑥ [중지] → interrupt ⑦ 모델 · 강도 → set_model · set_effort
// ⑧ needs-terminal 알림 줄 ⑨ 리로드 → 같은 id 로 subscribe(open 없음) · [session-gone] 이면 open{resume} ⑩ 턴 중 닫기 → 확인 상자 → close
// ⑪ 원격 창(remote-h-1) 렌더 · 명세 안 씀 ⑫ 폰 폭 400 · 키 띠 숨김 · 예외 0.
// ⑬ Claude MCP · Write 카드 ⑭ 띄우는 중(보낸 뒤 턴 전) 닫기 → 확인 상자 ⑮ Codex 명령 카드 = 명령 전체 · 폴더 · 이유(따로)
// ⑯ Codex 꼴 턴 끝 — 흘러나온 글 · 명령 줄 · 거절됨이 남는다 ⑰ Codex MCP 카드 = 서버 · 도구 · 인자 ⑱ 폰 폭 카드 넘침 없음.
// ⑲ [+] → 파일 고르기 → 칩 · send{images, files} · 말풍선의 그림 · 파일 이름 ⑳ 빈 글 + 칩만 · 상한(8개 · 10 MB) ㉑ 붙여 넣기 · 입력 칸에 놓기
// ㉒ 판 거절 · 첨부 판정 오류 문구 ㉓ 숨은 탭의 점 실행 → 권한 → 끝남 · 배너 · 그 탭을 보면 풀림 · 끊긴 턴은 배너 없음
// ㉔ 메신저 명령 0 ㉕ 사이드 채팅 독 [conversation-in-chat-tile] 문구.
// ㉖ 턴이 끝나 기록으로 그린 첨부 말 — 파일 칩 · 그림(경로 글 없음) ㉗ Read 카드 경로 한 번 ㉘ 작은 타일(560×400)의 긴 카드 — 단추가 보이고 긴 몫만 구른다
// ㉙ 로컬 명령(/context) — 기록을 다시 받아도 말풍선 · 출력이 남는다 · 문단 나눔 ㉚ Codex 기록의 명령 줄 이름 = 실시간 줄(command).
// 권한 모드 · 카드(docs/log/2026-11-28-chat-tile-stage3-contract.md 7절 E1–E13): ㉛ 모드 칩 · 메뉴 → set_perm_mode{chat, epoch, mode} ㉜ auto 줄
// ㉝ 칩 밖 모드 = 표지뿐 ㉞ 판 거절 ㉟ 늘 허용 셋째 단추(결정 낱말만) ㊱ 단추 둘 ㊲ 계획 카드 ㊳ 질문 카드 ㊴ 작은 타일 ㊵ Codex 칩 ㊶ 패치 diff · Codex 질문
// ㊷ Codex 계획 덩어리 ㊸ 원격 창 칩(명세 안 씀) ㊹ 폰 폭.
// F(턴이 끝난 뒤): F1 답한 Claude 계획이 꼬리 · 기록 둘 다에서 본 글 · 결과로 남는다 · F1b 기록만이면 믿을 본문 없이 경로 · 결과 ·
// F2 Codex 계획 덩어리 · 안내 줄(Plan 일 때 마지막 하나) · F3 새 파일 diff · F4 늘 허용 흔적 · F6 긴 규칙 단추 · F7 질문 안내 · 낮은 타일 · 폰.
// G(`/` 메뉴 · 맥락 사용량 · 압축 — docs/log/2026-11-28-chat-tile-stage4-5-contract.md 7절 S1–S15): 메뉴 여는 조건 · 거르기 · 키 · IME · Esc ·
// 터미널 전용 막기 · Aynx 동작 · 새 채팅 · Codex 스킬 · 압축 op 몸 · 미터 세 색 · 풍선 · 압축 표지 · 프로세스 없음 · 작은 타일 · 원격 · 폰.
// R(되감기 — docs/log/2026-11-28-chat-tile-stage6-contract.md 7절 FE-B S16–S30 · 13절): 기록 줄 단추 · 카드(범위 고르기 · 미리 보기 다시 · N개 더 ·
// 되돌릴 것 없음 · 기록 없음 · 반쪽 실패) · [실행] 없이는 실행 0 · 흔적 · 대화 되감기 뒤 다시 읽기 · 빈 칸에만 글 · 다른 창 · `/rewind` 고르기 · Codex · 작은 타일 · 원격 · 폰.
// 낮은 카드의 단추 곁 경고 · 다시 해도 같은 실패(압축 전 · 없는 기준점) · 그림만 보낸 메시지 · 빈 대화의 흔적 · 다음 턴 뒤에도 남는 압축 줄.
// V(검토 · 목표 · MCP 상태 · 속도 — docs/log/2026-11-28-chat-tile-stage7-contract.md 7절 FE-B T1–T15 · 13절 → S31–S46): MCP 풍선(연 때 한 번 · 허용 칸만 · 느림 · 시한 · 로그인 안내) ·
// Claude `/goal` 안내 줄 · 검토 카드(대상 넷 · 미리 채움 · 턴 중 막힘 · 표지) · 목표 카드 · 띠 · [중지] · 속도 줄 · 칩 · `/fast` · 하나만 · 작은 타일 · 원격 · 폰.
// W(S47–S52): 리로드 뒤 속도 칩 · 줄 · 목록 모르는 등급 끄기 · 검토 중지 표지(결과 글 뒤 · 다음 턴 뒤에도) · 남는 `/goal` 말풍선 ·
// MCP 풍선(시작 전 · 연결된 줄 · 꺼진 줄 · 사건 표 · 읽기 실패) · `/` 메뉴(쉬는 포인터 · 정확히 친 명령 Enter) · 검토 실패 뒤 보내기 · 빈 목표 까닭 · 낮은 목표 카드.
// X(CLI 바꾸기 X1–X7): 모델 메뉴 맨 위 CLI 줄 · 누르면 확인 없이 바로 바꿈(빈 대화 · 대화 · 첨부가 있어도 — 머리 · 탭 제목 · 옛 항목 close · 쓰던 글 옮김 · 첨부는 안 옮김) ·
// 지금 CLI 누름은 아무 일 없음 · 일하는 중은 칩이 잠겨 메뉴가 닫힘 · 작은 타일 · 좁은 창 · 원격 창 · 폰에는 줄 없음.
// CLI 바꾸기 · `/clear` 는 같은 타일(pane id)에서 몸만 다시 선다 — 타일 상자 · 머리줄 DOM 그대로 · 등장 애니메이션 없음.
// H(머리줄): H1 몸 위 띠 없음 · 대화 영역이 머리줄 바로 아래 H2 이름 뒤 흐린 대화 제목(말줄임) · ⋯ 앞 [중지](턴 중만) H3 좁은 타일 = 그림만
// H4 카드가 떠도 머리줄 [중지] H5 원격 창 = 머리줄 H6 폰 = 입력 칸이 물러난 안내 줄의 [중지] · 누르면 끊음.
//
//   node scripts/dev/run-harness.mjs chat-tile-harness.mjs <outdir> --size 1280x860
import { waitBoot } from "./boot-wait.mjs";
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
  if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
    const s = d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").split("\n")[0];
    if (!/stub:/.test(s)) errors.push("console.error " + s);
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
const VK = { Escape: 27, Enter: 13, Tab: 9 };
const key = async (code) => {
  const vk = VK[code] ?? 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: code, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(200);
};
const mouse = (type, x, y, extra = {}) =>
  send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
/** 진짜 마우스로 누른다 — 자리가 가라앉은 뒤 가운데 */
const clickAt = async (expr) => {
  const at = () => evj(`(() => { const e = ${expr}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
  let r = await at();
  for (let i = 0; i < 20 && r; i++) {
    await sleep(100);
    const r2 = await at();
    if (r2 && r2.x === r.x && r2.y === r.y) break;
    r = r2;
  }
  if (!r) return false;
  await mouse("mouseMoved", r.x, r.y, { buttons: 0 });
  await mouse("mousePressed", r.x, r.y);
  await mouse("mouseReleased", r.x, r.y);
  await sleep(250);
  return true;
};

/** 진짜 마우스 오른쪽 단추 — 창 전역 `contextmenu` 차단까지 같은 길 */
const rightClickAt = async (expr) => {
  const at = () => evj(`(() => { const e = ${expr}; if (!e) return 'null'; const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
  let r = await at();
  for (let i = 0; i < 20 && r; i++) {
    await sleep(100);
    const r2 = await at();
    if (r2 && r2.x === r.x && r2.y === r.y) break;
    r = r2;
  }
  if (!r) return false;
  await mouse("mouseMoved", r.x, r.y, { buttons: 0 });
  await mouse("mousePressed", r.x, r.y, { button: "right", buttons: 2 });
  await mouse("mouseReleased", r.x, r.y, { button: "right", buttons: 0 });
  await sleep(250);
  return true;
};
const DOCK_AI = (cli) => `.dock [data-launch="ai"][data-ai-id="${cli}"]`;
const DOCK_MENU = `.dock [data-launch-menu="ai"]`;
/** 독 AI 칸 우클릭 → 모양 메뉴의 한 항목 */
const dockOpenAs = async (cli, form) => {
  await rightClickAt(`document.querySelector('${DOCK_AI(cli)}')`);
  if (!(await waitFor(`!!document.querySelector('${DOCK_MENU} [data-launch-form="${form}"]')`, 3000))) return false;
  return clickAt(`document.querySelector('${DOCK_MENU} [data-launch-form="${form}"]')`);
};

let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;
const W = importApp("app/tabs.svelte.ts");
const SET = importApp("/src/lib/settings.svelte.ts");
const DOCKM = importApp("app/dock.svelte.ts");

const ESC = "\x1b", BEL = "\x07";
const PROMPT = `${ESC}]133;A${BEL}PS C:\\> ${ESC}]133;B${BEL}${ESC}[?2004h`;
const CONV = "1b4e28ba-2fa1-11d2-883f-0016d3cca427";
const CHAT = "ct-0f1e2d3c-4b5a-4697-8877-665544332211";

const stub = (remote, sc = false) => `
  performance.setResourceTimingBufferSize(10000);
  ${remote ? "window.__AYNX_REMOTE__ = true;" : ""}
  try { localStorage.clear(); } catch {}
  const cbs = new Map(); let n = 0; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => { for (const h of evts.get(name) ?? []) cbs.get(h)?.({ event: name, id: 0, payload }); };
  // 리로드를 넘어 남는 기록 — 리로드 전 닫기가 없었는지 · 뒤의 open/subscribe 를 본다
  const keep = (cmd, args) => { const a = JSON.parse(sessionStorage.getItem('h.ct') || '[]'); a.push([cmd, args]); sessionStorage.setItem('h.ct', JSON.stringify(a)); };
  window.__persistWorkspace = true;
  if (sessionStorage.getItem('h.reload') && sessionStorage.getItem('h.ws')) window.__workspaceSeed = JSON.parse(sessionStorage.getItem('h.ws'));
  window.__ctChan = null; window.__ctIdx = 0; window.__ctSeq = 0;
  // 리로드 장면의 스냅숏 덧칸 — 서버 표가 리로드를 넘어 쥔 값
  window.__ctSnap = JSON.parse(sessionStorage.getItem('h.snap') || 'null');
  window.__ctGone = sessionStorage.getItem('h.gone') === '1';
  // 서버 표 — 모르는 채팅의 subscribe 는 [session-gone](잎이 open 으로 세운다) · 리로드를 넘어 남는다
  const known = new Set(JSON.parse(sessionStorage.getItem('h.known') || '["${CHAT}"]'));
  const know = (chat) => { known.add(chat); sessionStorage.setItem('h.known', JSON.stringify([...known])); };
  window.__ctEmit = (msg) => { const cb = cbs.get(window.__ctChan); if (!cb) return false; cb({ index: window.__ctIdx++, message: msg }); return true; };
  window.__transcript = { items: [], cursor: null };
  let subGen = 0;
  let nextSession = 100;
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; cb({ message: new TextEncoder().encode(text).buffer, index: c.idx++ }); return 'ok'; };
  const boot = (id) => setTimeout(() => window.__feed(id, ${JSON.stringify(PROMPT)}), 300);
  // 스냅숏 덧칸(권한 모드 칸 \`permMode\` · \`cliMode\`) — 장면이 \`window.__ctSnap\` 로 고른다
  const snap = (a) => ({ chat: a?.chat ?? '${CHAT}', cli: a?.cli ?? 'claude', model: a?.model ?? '', effort: a?.effort ?? null, cwd: 'C:/src/proj',
    epoch: 0, seq: window.__ctSeq, status: 'stopped', conversationId: null, mcpServers: [], liveTurn: [], pending: [], ...(window.__ctSnap ?? {}) });
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: { shells: [{ id: 'pwsh', label: 'PowerShell 7' }], default_id: 'pwsh' },
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: true }],
    mcp_status: { clis: [{ id: 'claude', name: 'Claude Code', installed: true, registered: true }] },
    list_group_meta: {}, list_host_meta: {}, list_snippets: [], list_forwards: [],
    session_stats: { bytes: 0 }, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, send_input: null, reap_window_sessions: null, session_log_path: null,
    list_operations: { pending: [], recent: [] }, audit_runs: [],
    audit_status: { running: true, written: 0, failed: 0, lastOkAt: 0, dir: '' },
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], mcp_activity: null,
    vault_status: { state: 'unlocked', hasMaster: false, entryCount: 0 },
    codex_models: { configured: null, models: [] },
    side_chats_load: { json: null, rev: 1 }, side_chat_list: [],
    agent_states_snapshot: [], local_home: 'C:\\\\Users\\\\h', projects_list: [], host_history_list: {},
    agent_conversation_links: [], save_settings: null,
  };
  // ㉕ 사이드 채팅 하나 — 그 대화를 채팅 타일이 쥐고 있다고 서버가 거절한다
  const SC = { v: 2, current: 'sc-1', last: { cli: 'claude', model: '', effort: '' },
    chats: [{ id: 'sc-1', cli: 'claude', model: '', effort: '', title: 'held', createdAt: 1, usedAt: 2, used: [], links: { claude: '${CONV}' } }] };
  if (${sc ? "true" : "false"}) answers.side_chats_load = { json: JSON.stringify(SC), rev: 1 };
  let att = 0;
  const label = ${remote ? "'remote-h-1'" : "'main'"};
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label }, currentWebview: { label, windowLabel: label }, windows: [{ label }], webviews: [{ label, windowLabel: label }] },
    invoke: (cmd, args, opts) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd.startsWith('chat_tile_')) keep(cmd, cmd === 'chat_tile_subscribe' ? { chat: args.chat } : args);
      if (cmd === 'chat_tile_open') { know(args.chat); return Promise.resolve(snap(args)); }
      if (cmd === 'chat_tile_subscribe') {
        if (!known.has(args.chat)) return Promise.reject(new Error('[session-gone] no such chat tile'));
        if (window.__ctGone) { window.__ctGone = false; sessionStorage.removeItem('h.gone'); return Promise.reject(new Error('[session-gone] chat tile is gone')); }
        window.__ctChan = args.channel.id; window.__ctIdx = 0; return Promise.resolve({ subGen: ++subGen, snapshot: snap({ chat: args.chat }) });
      }
      if (cmd === 'chat_tile_unsubscribe' || cmd === 'chat_tile_close' || cmd === 'chat_tile_decide' || cmd === 'chat_tile_interrupt'
          || cmd === 'chat_tile_set_model' || cmd === 'chat_tile_set_effort') return Promise.resolve(true);
      if (cmd === 'chat_tile_compact') return window.__ctCompactFail ? Promise.reject(new Error(window.__ctCompactFail)) : Promise.resolve(true);
      if (cmd === 'chat_tile_rewind') return window.__ctRewindFail ? Promise.reject(new Error(window.__ctRewindFail)) : Promise.resolve({ epoch: 1 });
      if (cmd === 'chat_tile_set_perm_mode') return window.__ctModeFail ? Promise.reject(new Error(window.__ctModeFail)) : Promise.resolve(true);
      if (cmd === 'chat_tile_send') return window.__ctSendFail ? Promise.reject(new Error(window.__ctSendFail)) : Promise.resolve({ epoch: 1 });
      // 7단계 — 검토 · 목표(시작/멈춤 두 명령) · 속도 · MCP 읽기
      if (cmd === 'chat_tile_review') return window.__ctReviewFail ? Promise.reject(new Error(window.__ctReviewFail)) : Promise.resolve({ epoch: 1 });
      if (cmd === 'chat_tile_goal_start' || cmd === 'chat_tile_goal_stop') return window.__ctGoalFail ? Promise.reject(new Error(window.__ctGoalFail)) : Promise.resolve({ epoch: 1 });
      if (cmd === 'chat_tile_set_tier') return Promise.resolve(true);
      if (cmd === 'chat_tile_mcp_status') return window.__ctMcpFail ? Promise.reject(new Error(window.__ctMcpFail)) : Promise.resolve(window.__ctMcpAnswer ?? true);
      // 앱 첨부 자리의 사본 경로 — 채팅 타일은 이 경로만 싣는다
      if (cmd === 'stage_agent_attachment') { att += 1; const name = decodeURIComponent(opts?.headers?.['x-file-name'] ?? 'x');
        return Promise.resolve('C:/Users/h/AppData/Roaming/aynx-dev/attachments/' + String(att).padStart(64, '0') + '/' + name); }
      if (cmd === 'side_chat_subscribe') return Promise.resolve(null);
      if (cmd === 'side_chat_attach') return Promise.reject(new Error('[session-gone] no such side chat'));
      if (cmd === 'side_chat_open') return Promise.reject(new Error('[conversation-in-chat-tile] this conversation is open in a chat tile'));
      if (cmd === 'agent_conversation_transcript') return Promise.resolve(window.__transcript);
      if (cmd === 'agent_sessions_list' && window.__convOthers) return Promise.resolve({ groups: args.cwds.map((c) => ({ cwd: c, exists: true, sessions: [], more: false })), others: window.__convOthers, othersMore: false });
      if (cmd === 'agent_conversation_image') return Promise.resolve(Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0)).buffer);
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; boot(id); return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'probe_session') return Promise.resolve({ state: 'none', sessionEpoch: null, checkpoint: null });
      if (cmd === 'write_session') return Promise.resolve(null);
      if (cmd === 'resize_session' || cmd === 'claim_session_size') return Promise.resolve(true);
      if (cmd === 'load_settings') return Promise.resolve({ terminal: { webgl: false }, app: { status_bar: 'bottom', tile_header: 'always' }, automation: { auto_approve: false },
        projects: { start_screen: 'off' }, ai: { start_dir: 'C:\\\\src\\\\proj', chat_tile: true } });
      if (cmd === 'mirror_request') return Promise.resolve(null);
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

await send("Page.enable");
await send("Runtime.enable");
let scriptId = null;
const bootPage = async ({ remote, width, height, mobile = false, fresh = true, sc = false }) => {
  if (scriptId) await send("Page.removeScriptToEvaluateOnNewDocument", { identifier: scriptId });
  scriptId = (await send("Page.addScriptToEvaluateOnNewDocument", { source: stub(remote, sc) })).result.identifier;
  if (fresh) await ev(`(sessionStorage.clear(), 1)`);
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: mobile ? 2 : 1, mobile });
  await send("Page.reload", { ignoreCache: true });
  if (mobile) await waitFor(`!!document.querySelector('.mobile-bar')`, 15000);
  else await waitBoot(ev);
  await send("Page.bringToFront");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true });
  for (let i = 0; i < 50; i++) {
    if ((await ev(`(async () => { try { await ${W}; return true; } catch { return false; } })()`)) === true) break;
    await sleep(300);
  }
  await sleep(800);
};
const callsOf = (cmd, from = 0) => evj(`JSON.stringify(window.__calls.slice(${from}).filter(([c]) => c === '${cmd}').map(([, a]) => a))`);
const kept = () => evj(`sessionStorage.getItem('h.ct') || '[]'`);
const callCount = () => ev(`window.__calls.length`);
let LABEL = "main";
let subGenNow = 1;
const emit = (e, chat) =>
  ev(`(() => { window.__ctSeq += 1; return window.__ctEmit({ chat: ${JSON.stringify(chat)}, epoch: 1, seq: window.__ctSeq, ev: ${JSON.stringify(e)}, subs: [{ conn: 1, window: '${LABEL}', subGen: ${subGenNow} }] }); })()`);
/** 이 창의 채팅 잎 명세(없으면 null) */
const chatSpec = () =>
  evj(`(async () => { const t = await ${W}; for (const tab of t.residentWindowTabs()) { const stack = [tab.root]; while (stack.length) { const x = stack.pop(); if (x.type === 'leaf') { if (x.pane.kind === 'chat') return JSON.stringify({ id: x.pane.id, tab: tab.id, chat: x.pane.chat }); } else stack.push(x.a, x.b); } } return 'null'; })()`);
const L = "[data-chat-tile]";
/** [중지] — 머리줄(데스크톱)이든 입력 칸이 물러난 안내 줄(폰)이든 한 타일에 하나 */
const STOP = "[data-chat-tile-stop]";
/** 채팅 잎이 선 타일 상자 · 머리줄 */
const CT_BOX = `document.querySelector('${L}')?.closest('[data-pane]')`;
const CT_HEAD = `${CT_BOX}?.querySelector(':scope > [data-pane-head]')`;
/** 새 채팅(CLI 바꾸기 · /clear) 전에 타일 상자 · 머리줄 DOM 에 표지를 단다 — 뒤에 같은 노드인지 본다 */
const markFrame = () => ev(`(() => { const b = ${CT_BOX}; const h = ${CT_HEAD}; if (!b || !h) return false; b.__ctMark = 1; h.__ctMark = 1; return true; })()`);
const frameKept = () => evj(`(() => { const b = ${CT_BOX}; const h = ${CT_HEAD}; return JSON.stringify([b?.__ctMark === 1, h?.__ctMark === 1]); })()`);
/** 상자 · 머리줄 자신에 걸린 애니메이션 수(등장 `in:` · 머리줄 head-in — 호버 전환은 뺀다) */
const frameAnims = () => ev(`(() => { const b = ${CT_BOX}; const h = ${CT_HEAD}; const n = (e) => e ? e.getAnimations().filter((x) => !(x instanceof CSSTransition)).length : -1; return n(b) + n(h); })()`);
/** 머리줄 — 이름 · 제목 · [중지] · ⋯ 의 자리와 잘림 */
const headShape = () =>
  evj(`(() => { const h = ${CT_HEAD}; if (!h) return 'null'; const R = (e) => e ? e.getBoundingClientRect() : null;
    const name = h.querySelector('.pane-name'), title = h.querySelector('[data-chat-tile-title]'), stop = h.querySelector('${STOP}'), more = h.querySelector('[data-tile-menu-btn]');
    const N = R(name), T = R(title), S = R(stop), M = R(more), H = R(h);
    return JSON.stringify({ title: title?.textContent.trim() ?? null, titleAfterName: !!(T && N && T.left >= N.right - 0.5), titleCut: !!title && title.scrollWidth > title.clientWidth + 1,
      nameCut: !!name && name.scrollWidth > name.clientWidth, titleDim: !!title && getComputedStyle(title).color !== getComputedStyle(name).color,
      stop: !!stop, stopText: stop?.textContent.trim() ?? null, stopLabel: stop?.getAttribute('aria-label') ?? null, stopTip: stop?.getAttribute('title') ?? null,
      stopBeforeMore: !!(S && M && S.right <= M.left + 0.5), stopShown: !!S && S.width >= 20, stopInHead: !!(S && S.top >= H.top - 0.5 && S.bottom <= H.bottom + 0.5) }); })()`);

// ═══ A. 메인 PC 창 ═══════════════════════════════════════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;

// ① 독 — 모양 단추는 없고 AI 칸은 예전 글 칸 그대로 · 우클릭 = 모양 메뉴(설정 켬일 때만)
await ev(`(async () => (await ${DOCKM}).openDock('alerts'))()`);
await waitFor(`!!document.querySelector('.dock [data-launch="ai"]')`, 6000);
const dockShape = () => ev(`JSON.stringify([document.querySelectorAll('.dock .tile.text[data-launch="ai"]').length, document.querySelectorAll('.dock [data-launch="ai-chat"], .dock [data-launch-pair], .dock .choice').length, [...document.querySelectorAll('.dock .tile.text[data-launch="ai"] .lbl')].every((l) => l.scrollWidth <= l.clientWidth)])`);
const offShape = JSON.parse(await dockShape());
check("① 설정 켬 — AI 칸 둘 · 모양 단추 없음", offShape.slice(0, 2), [2, 0]);
await shot("launcher-dock.png");
await rightClickAt(`document.querySelector('${DOCK_AI("claude")}')`);
check("① 우클릭 = 모양 메뉴 두 항목 · 기본(터미널) 표시", await evj(`JSON.stringify([...document.querySelectorAll('${DOCK_MENU} [data-launch-form]')].map((b) => [b.dataset.launchForm, b.hasAttribute('data-default'), b.textContent.trim()]))`),
  [["terminal", true, "터미널로 열기 기본"], ["chat", false, "채팅으로 열기"]]);
check("① 메뉴가 첫 항목에 포커스", await ev(`document.activeElement?.dataset?.launchForm ?? null`), "terminal");
await shot("launcher-dock-menu.png");
await key("Escape");
check("① Esc = 메뉴만 닫힘 · 독은 그대로", await ev(`!document.querySelector('${DOCK_MENU}') && !!document.querySelector('${DOCK_AI("claude")}')`), true);
// 키보드 — 칸에 포커스 · Shift+F10 / 메뉴 키
await ev(`document.querySelector('${DOCK_AI("codex")}').focus()`);
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, code: "F10", key: "F10", modifiers: 8, windowsVirtualKeyCode: 121, nativeVirtualKeyCode: 121 });
await sleep(250);
check("① Shift+F10 = 같은 메뉴(Codex)", await ev(`document.querySelector('${DOCK_MENU}')?.dataset.aiId ?? null`), "codex");
await key("Escape");
await ev(`document.querySelector('${DOCK_AI("claude")}').focus()`);
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, code: "ContextMenu", key: "ContextMenu", windowsVirtualKeyCode: 93, nativeVirtualKeyCode: 93 });
await sleep(250);
check("① 메뉴 키 = 같은 메뉴(Claude)", await ev(`document.querySelector('${DOCK_MENU}')?.dataset.aiId ?? null`), "claude");
await key("Escape");
check("① 키로 연 메뉴를 닫으면 포커스가 칸으로", await ev(`document.activeElement?.dataset?.aiId ?? null`), "claude");
await ev(`(async () => (await ${SET}).setChatTile(false))()`);
await sleep(300);
check("① 설정 끔 — 칸은 켬과 같다(이름 잘림 여부까지)", JSON.parse(await dockShape()), offShape);
await rightClickAt(`document.querySelector('${DOCK_AI("claude")}')`);
check("① 설정 끔 — 우클릭해도 모양 메뉴 없음", await ev(`document.querySelectorAll('.dock [data-launch-menu]').length`), 0);
// 설정 끔 + 기본 채팅 — 누르기는 터미널
await ev(`(async () => (await ${SET}).setAiLaunchForm('chat'))()`);
await sleep(200);
const leafIds = () => evj(`(async () => { const t = await ${W}; const out = []; for (const tab of t.residentWindowTabs()) { const stack = [tab.root]; while (stack.length) { const x = stack.pop(); if (x.type === 'leaf') out.push([tab.id, x.pane.id, x.pane.kind ?? null, x.pane.autorun ?? null]); else stack.push(x.a, x.b); } } return JSON.stringify(out); })()`);
const leavesBefore = (await leafIds()).map((x) => x[1]);
let c0 = await callCount();
await clickAt(`document.querySelector('${DOCK_AI("claude")}')`);
await sleep(800);
const newLeaves = (await leafIds()).filter((x) => !leavesBefore.includes(x[1]));
check("① 설정 끔 · 기본 채팅 — 누르기 = 터미널 AI 타일(chat_tile_open 없음)", [(await callsOf("chat_tile_open", c0)).length, newLeaves.map((x) => [x[2] === "chat", /claude/.test(x[3] ?? "")])], [0, [[false, true]]]);
// 처음 판으로 — 연 터미널 타일 · 바꾼 설정을 걷는다(스텁 설정 = 실험 켬 · 기본 터미널)
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;

// ② 우클릭 [채팅으로 열기] → 채팅 잎 · open{fresh} · subscribe
await ev(`(async () => (await ${DOCKM}).openDock('alerts'))()`);
await waitFor(`!!document.querySelector('${DOCK_AI("claude")}')`, 6000);
c0 = await callCount();
await dockOpenAs("claude", "chat");
check("② 채팅 잎이 선다", await waitFor(`!!document.querySelector('${L} [data-chat-tile-face]')`, 6000), true);
await waitFor(`window.__calls.filter(([c]) => c === 'chat_tile_subscribe').length >= 2`, 4000);
const opened = await callsOf("chat_tile_open", c0);
let spec = await chatSpec();
check("② 명세 — ct- id · claude · 타일 폴더 · conv 없음", [/^ct-[0-9a-f-]{36}$/.test(spec?.chat?.chatId ?? ""), spec?.chat?.cli, spec?.chat?.cwd, "conv" in (spec?.chat ?? {})], [true, "claude", "C:\\src\\proj", false]);
check("② subscribe([session-gone]) → chat_tile_open{mode: fresh, cwd} 한 번 → subscribe", [opened.map((a) => [a.chat === spec.chat.chatId, a.cli, a.mode]), (await callsOf("chat_tile_subscribe", c0)).length],
  [[[true, "claude", { kind: "fresh", cwd: "C:\\src\\proj" }]], 2]);
check("② 머리줄 이름 · 터미널로 그리지 않음", [await ev(`document.querySelector('[data-pane="${spec.id}"]').textContent.includes('Claude Code 채팅')`),
  await ev(`!document.querySelector('[data-pane="${spec.id}"] .xterm')`)], [true, true]);
// H1 머리줄 아래 띠 없음 — 형태 칩 · 띠가 없고 대화 영역이 머리줄 바로 아래에서 시작한다
check("H1 띠 · 형태 칩 없음 · 몸의 첫 칸이 머리줄 바로 아래", await evj(`(() => { const f = document.querySelector('${L} [data-chat-tile-face]'); const h = ${CT_HEAD};
  const first = f.firstElementChild; return JSON.stringify([!document.querySelector('[data-chat-tile-bar], [data-chat-tile-form]'), first?.hasAttribute('data-viewer-body') || !!first?.querySelector('[data-viewer-body]'),
    Math.abs(first.getBoundingClientRect().top - h.getBoundingClientRect().bottom) <= 1]); })()`), [true, true, true]);
const CH = spec.chat.chatId;
await shot("chat-tile-empty.png");

// ②-1 입력 칸에서도 앱 단축키(대화 면 입력 칸과 같다) — Ctrl+Shift+P 가 팔레트를 연다
await ev(`document.querySelector('${L} [data-flip-input]').focus()`);
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, code: "KeyP", key: "P", modifiers: 2 | 8, windowsVirtualKeyCode: 80, nativeVirtualKeyCode: 80 });
check("②-1 입력 칸에서 Ctrl+Shift+P → 팔레트", await waitFor(`!!document.querySelector('.palette')`, 3000), true);
await key("Escape");
check("②-1 Esc → 팔레트 닫힘", await waitFor(`!document.querySelector('.palette')`, 3000), true);

// ③ 보내기 → send{epoch:0, clientId} · 흐름 말풍선
await ev(`document.querySelector('${L} [data-flip-input]').focus()`);
await send("Input.insertText", { text: "src 폴더를 정리해 줘" });
c0 = await callCount();
await key("Enter");
await sleep(400);
const sent = await callsOf("chat_tile_send", c0);
check("③ chat_tile_send{chat, epoch:0, text, clientId}", sent.map((a) => [a.chat === CH, a.epoch, a.text, typeof a.clientId === "string" && a.clientId.length > 0]), [[true, 0, "src 폴더를 정리해 줘", true]]);
const cid = sent[0]?.clientId;
await emit({ t: "ready", cli: "claude", version: "2.1.300", model: "claude-sonnet-5-5", models: ["opus", "sonnet", "default"], efforts: { "": ["low", "medium", "high"] }, conversationId: CONV }, CH);
await emit({ t: "turnStarted", turn: "t1" }, CH);
await emit({ t: "userAccepted", clientId: cid, text: "src 폴더를 정리해 줘" }, CH);
await emit({ t: "textDelta", item: "a1", text: "먼저 파일을 살펴보겠습니다. " }, CH);
await emit({ t: "textDelta", item: "a1", text: "`src/main.ts:12` 를 봅니다." }, CH);
await sleep(400);
check("③ 사람 말풍선 · 흐름 글", [await ev(`[...document.querySelectorAll('${L} [data-item="user"]')].some((e) => e.textContent.includes('src 폴더를 정리해 줘'))`),
  await ev(`document.querySelector('${L}').textContent.includes('먼저 파일을 살펴보겠습니다')`)], [true, true]);
spec = await chatSpec();
check("③ 턴이 선 뒤 명세에 conv(메인 PC 창)", spec.chat.conv, CONV);
check("③ 모델 칩 = 고른 값(CLI 기본) — CLI 가 알린 실효 이름으로 바뀌지 않는다(사이드 채팅 칩과 같게)",
  await ev(`document.querySelector('${L} [data-chat-model-chip]')?.textContent.trim().split(/\\s+/)[0]`), "Default");

// ④ 도구 줄
await emit({ t: "toolStarted", item: "tool1", name: "Read", summary: "src/main.ts", input: { file_path: "C:/src/proj/src/main.ts" } }, CH);
await emit({ t: "toolFinished", item: "tool1", ok: true, output: "42 lines" }, CH);
await emit({ t: "toolStarted", item: "tool2", name: "Grep", summary: "TODO", input: { pattern: "TODO" } }, CH);
await sleep(400);
check("④ 도구 줄 둘(끝난 것 · 도는 것)", [await ev(`document.querySelectorAll('${L} [data-item="tool"]').length`), await ev(`document.querySelectorAll('${L} [data-tool-running]').length`)], [2, 1]);
check("④ [중지] 가 선다(턴 중)", await ev(`!!document.querySelector('${STOP}')`), true);
await shot("chat-tile-midturn.png");

// H2 머리줄 — 이름 뒤 흐린 대화 제목 · ⋯ 앞 [중지](글 · 툴팁) · 몸에는 [중지] 없음
const LONG_TITLE = "src 폴더 정리 — 오래된 유틸 파일을 모아 옮기고 테스트까지 다시 맞추는 아주 긴 대화 제목";
await ev(`(window.__convOthers = [{ agent: 'claude', id: '${CONV}', cwd: 'C:\\\\src\\\\proj', branch: null, title: ${JSON.stringify(LONG_TITLE)}, titleSource: 'ai', startedAt: Date.now() - 60000,
  updatedAt: Date.now(), model: null, forkedFrom: null, cwdExists: true }], 1)`);
await ev(`(async () => (await ${importApp("app/agent-sessions.svelte.ts")}).loadConversations())()`);
await waitFor(`!!(${CT_HEAD})?.querySelector('[data-chat-tile-title]')`, 4000);
let hs = await headShape();
check("H2 머리줄 — 이름 뒤 흐린 제목 · 넓은 타일에서도 넘치면 말줄임 · 이름은 안 잘림",
  [hs?.title, hs?.titleAfterName, hs?.titleDim, hs?.nameCut], [LONG_TITLE, true, true, false]);
check("H2 머리줄 [중지] — ⋯ 앞 · 머리줄 안 · 글 · 툴팁 · 이름표 · 몸에는 없음",
  [hs?.stop, hs?.stopBeforeMore, hs?.stopInHead, hs?.stopText, hs?.stopTip, hs?.stopLabel, await ev(`document.querySelectorAll('${L} ${STOP}').length`)],
  [true, true, true, "중지", "중지", "중지", 0]);
await shot("h2-head-title-stop.png");
// H3 좁은 타일 — 제목이 먼저 줄고 [중지]는 그림만(이름표 · 툴팁은 남는다)
await send("Emulation.setDeviceMetricsOverride", { width: 400, height: 760, deviceScaleFactor: 1, mobile: false });
await sleep(700);
hs = await headShape();
check("H3 좁은 타일(400) — 제목 말줄임 · 이름 안 잘림 · [중지] 그림만 · 툴팁 · 이름표 · ⋯ 앞",
  [hs?.titleCut, hs?.nameCut, hs?.stopShown, hs?.stopText, hs?.stopTip, hs?.stopLabel, hs?.stopBeforeMore], [true, false, true, "", "중지", "중지", true]);
await shot("h3-narrow-head.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(500);
await emit({ t: "toolFinished", item: "tool2", ok: true, output: "3 matches" }, CH);

// ⑤ 권한 카드 — 단추 둘 · diff · [허용]
await emit({ t: "permission", requestId: "p1", kind: "tool", title: "Edit main.ts", detail: "edit src/main.ts", toolName: "Edit",
  input: { file_path: "C:/src/proj/src/main.ts", old_string: "const a = 1;\nconst b = 2;", new_string: "const a = 1;\nconst b = 3;" } }, CH);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="p1"]')`, 3000);
await sleep(300);
const card = await evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-perm="p1"]'); const R = c.getBoundingClientRect(); const btns = [...c.querySelectorAll('.perm-actions button')];
  return JSON.stringify({ buttons: btns.map((b) => b.textContent.trim()), inside: btns.every((b) => { const x = b.getBoundingClientRect(); return x.left >= R.left - 0.5 && x.right <= R.right + 0.5; }),
    kind: c.dataset.chatTilePermKind, target: c.querySelector('[data-chat-tile-perm-target]')?.textContent.trim() ?? null,
    diff: [...c.querySelectorAll('[data-chat-tile-perm-diff] .row')].map((r) => r.dataset.op + r.textContent.trim().replace(/^[-+ ]/, '').trim()) }); })()`);
check("⑤ 카드 — [허용] [거절] 둘뿐 · 카드 안 · 파일 고치기 · 경로 · 줄 diff", [card.buttons, card.inside, card.kind, card.target, card.diff],
  [["허용", "거절"], true, "edit", "C:/src/proj/src/main.ts", [" const a = 1;", "-const b = 2;", "+const b = 3;"]]);
check("⑤ 기다리는 동안 입력 칸 대신 한 줄", [await ev(`!!document.querySelector('${L} [data-chat-tile-held]')`), await ev(`getComputedStyle(document.querySelector('${L} .composer-slot')).display`)], [true, "none"]);
hs = await headShape();
check("H4 카드가 떠 입력 칸이 물러나도 머리줄 [중지]가 보인다 · 안내 줄에는 없음(데스크톱)",
  [hs?.stop, hs?.stopShown, await ev(`!document.querySelector('${L} [data-chat-tile-held] ${STOP}')`)], [true, true, true]);
check("⑤ 늘 허용 · 모드 칩 · 사이드 채팅 [+] 메뉴 없음", await ev(`!document.querySelector('${L} [data-side-chat-allow-chat], ${L} [data-chat-perm-chip], ${L} [data-chat-plus], ${L} [data-flip-pick]')`), true);
await shot("chat-tile-perm.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-allow]')`);
await sleep(300);
check("⑤ [허용] = chat_tile_decide{allow}", (await callsOf("chat_tile_decide", c0)).map((a) => [a.chat === CH, a.requestId, a.decision]), [[true, "p1", "allow"]]);
await emit({ t: "permissionResolved", requestId: "p1", decision: "allow", by: "human" }, CH);
await sleep(300);
check("⑤ 답한 카드 = 끝난 한 줄 · 입력 칸 돌아옴", [await ev(`document.querySelector('${L} [data-chat-tile-perm="p1"]')?.textContent.includes('허용함') ?? false`),
  await ev(`!document.querySelector('${L} [data-chat-tile-held]') && getComputedStyle(document.querySelector('${L} .composer-slot')).display !== 'none'`)], [true, true]);

// ⑥ [중지]
c0 = await callCount();
await clickAt(`document.querySelector('${STOP}')`);
await sleep(300);
check("⑥ [중지] = chat_tile_interrupt{chat, epoch}", (await callsOf("chat_tile_interrupt", c0)).map((a) => [a.chat === CH, a.epoch]), [[true, 1]]);
await emit({ t: "text", item: "a1", text: "먼저 파일을 살펴보겠습니다. `src/main.ts:12` 를 봅니다." }, CH);
await ev(`(window.__transcript = { items: [
  { role: 'user', text: 'src 폴더를 정리해 줘', truncated: false, images: 0, tool: null, at: Date.now() - 5000 },
  { role: 'assistant', text: '먼저 파일을 살펴보겠습니다. \`src/main.ts:12\` 를 봅니다.', truncated: false, images: 0, tool: null, at: Date.now() - 4000 },
], cursor: null }, 1)`);
await emit({ t: "turnEnded", turn: "t1", outcome: "interrupted", message: null }, CH);
await sleep(800);
check("⑥ 턴 끝 — [중지] 걷힘 · 기록에서 받은 말 · 경로 링크", [await ev(`!document.querySelector('${STOP}')`),
  await ev(`document.querySelector('${L}').textContent.includes('먼저 파일을 살펴보겠습니다')`), await ev(`!!document.querySelector('${L} [data-path-link]')`)], [true, true, true]);

// ⑦ 모델 · 강도
await clickAt(`document.querySelector('${L} [data-chat-model-chip]')`);
check("⑦ 모델 메뉴가 열린다", await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000), true);
check("⑦ CLI 기본 줄은 하나 — `default` 별칭 줄 없음", await ev(`[...document.querySelectorAll('[data-flip-model]')].map((b) => b.dataset.flipModel).filter((v) => v === '' || v === 'default').join('|')`), "");
await shot("chat-tile-model-menu.png");
c0 = await callCount();
await clickAt(`document.querySelector('[data-flip-model="opus"]')`);
await sleep(300);
await clickAt(`document.querySelector('[data-flip-model-menu] [data-chat-effort="high"]')`);
await sleep(400);
check("⑦ set_model{opus} · set_effort{high}", [(await callsOf("chat_tile_set_model", c0)).map((a) => a.model), (await callsOf("chat_tile_set_effort", c0)).map((a) => a.effort)], [["opus"], ["high"]]);
spec = await chatSpec();
check("⑦ 메인 PC 창 명세에 모델 · 강도", [spec.chat.model, spec.chat.effort], ["opus", "high"]);
await key("Escape");
await sleep(200);

// ⑧ needs-terminal 알림 줄
await emit({ t: "turnStarted", turn: "t2" }, CH);
await emit({ t: "notice", code: "needs-terminal", detail: "AskUserQuestion" }, CH);
await sleep(400);
const note = await ev(`document.querySelector('${L} [data-chat-tile-notice="needs-terminal"]')?.textContent.trim() ?? ''`);
check("⑧ needs-terminal 알림 줄 = 터미널 모양 안내(도구 이름)", [note.includes("터미널 모양"), note.includes("AskUserQuestion")], [true, true]);
await shot("chat-tile-needs-terminal.png");
await emit({ t: "turnEnded", turn: "t2", outcome: "ok", message: null }, CH);
await sleep(500);

/** 카드 읽기 — 칸 글 · 카드가 타일 몸 안 · 가로 넘침 없음 */
const permCard = (id) =>
  evj(`(() => { const c = document.querySelector('[data-chat-tile-perm="${id}"]'); if (!c) return 'null'; const F = c.closest('[data-chat-tile-face]').getBoundingClientRect(); const R = c.getBoundingClientRect();
    const tx = (s) => c.querySelector(s)?.textContent.trim() ?? null; const pre = c.querySelector('pre');
    return JSON.stringify({ kind: c.dataset.chatTilePermKind, command: tx('[data-chat-tile-perm-command]'), cwd: tx('[data-chat-tile-perm-cwd]'), reason: tx('[data-chat-tile-perm-reason]'),
      server: tx('[data-chat-tile-perm-mcp-server]'), tool: tx('[data-chat-tile-perm-mcp-tool]'), args: tx('[data-chat-tile-perm-mcp-args]'), text: tx('[data-chat-tile-perm-text]'), target: tx('[data-chat-tile-perm-target]'),
      diff: [...c.querySelectorAll('[data-chat-tile-perm-diff] .row')].map((r) => r.dataset.op + r.textContent.trim().replace(/^[-+ ]/, '').trim()),
      buttons: [...c.querySelectorAll('.perm-actions button')].map((b) => b.textContent.trim()),
      inside: R.left >= F.left - 0.5 && R.right <= F.right + 0.5, wrap: !pre || pre.scrollWidth <= pre.clientWidth + 1 }); })()`);

// ⑬ Claude MCP 카드 — 서버 · 도구 · 인자(사람이 허용하는 것 자체)
await emit({ t: "turnStarted", turn: "t5" }, CH);
await emit({ t: "permission", requestId: "p5", kind: "mcpTool", title: "tavily · search", detail: '{\n  "query": "tauri plugin",\n  "max_results": 3\n}', toolName: "mcp__tavily__search",
  input: { query: "tauri plugin", max_results: 3 } }, CH);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="p5"]')`, 3000);
await sleep(300);
let pc = await permCard("p5");
check("⑬ Claude MCP 카드 — 서버 · 도구 · 인자 · 단추 둘 · 타일 안", [pc.kind, pc.server, pc.tool, pc.args?.includes('"query": "tauri plugin"'), pc.buttons, pc.inside],
  ["mcp", "서버tavily", "도구search", true, ["허용", "거절"], true]);
await shot("chat-tile-claude-mcp.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="p5"] [data-chat-tile-deny]')`);
await emit({ t: "permissionResolved", requestId: "p5", decision: "deny", by: "human" }, CH);
// ⑬ Claude Write 카드 — 대상 경로 · 새 내용이 + 줄
await emit({ t: "permission", requestId: "p6", kind: "tool", title: "Write", detail: "", toolName: "Write", input: { file_path: "C:/src/proj/note.txt", content: "hello\nworld\n" } }, CH);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="p6"]')`, 3000);
await sleep(300);
pc = await permCard("p6");
check("⑬ Claude Write 카드 — 경로 · 새 내용 + 줄", [pc.kind, pc.target, pc.diff, pc.inside], ["write", "C:/src/proj/note.txt", ["+hello", "+world"], true]);
await shot("chat-tile-claude-write.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="p6"] [data-chat-tile-deny]')`);
await emit({ t: "permissionResolved", requestId: "p6", decision: "deny", by: "human" }, CH);
// ㉗ Read 카드 — Claude 의 설명 글이 같은 경로(홈을 `~` 로 줄인 꼴)면 경로는 한 번만
const READ_PATH = "C:\\Users\\h\\AppData\\Roaming\\aynx-dev\\attachments\\" + "ab".repeat(32) + "\\memo-heron.txt";
await emit({ t: "permission", requestId: "p7", kind: "tool", title: "Read", detail: "~\\AppData\\Roaming\\aynx-dev\\attachments\\" + "ab".repeat(32) + "\\memo-heron.txt",
  toolName: "Read", input: { file_path: READ_PATH } }, CH);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="p7"]')`, 3000);
await sleep(300);
pc = await permCard("p7");
check("㉗ Read 카드 — 경로 한 번(대상 칸) · 설명 글 칸 없음 · 경로 글이 카드에 한 번", [pc.kind, pc.target, pc.text,
  await ev(`document.querySelector('${L} [data-chat-tile-perm="p7"]').textContent.split('memo-heron.txt').length - 1`)], ["read", READ_PATH, null, 1]);
await shot("chat-tile-read-card.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="p7"] [data-chat-tile-deny]')`);
await emit({ t: "permissionResolved", requestId: "p7", decision: "deny", by: "human" }, CH);
// ㉘ 작은 타일 — 긴 Write 카드도 [허용] [거절] 이 대화 칸 안에 보이고 긴 몫만 카드 안에서 구른다
await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 400, deviceScaleFactor: 1, mobile: false });
await sleep(600);
const LONG = Array.from({ length: 80 }, (_, i) => `line ${i + 1}`).join("\n");
await emit({ t: "permission", requestId: "p8", kind: "tool", title: "Write", detail: "", toolName: "Write", input: { file_path: "C:/src/proj/long.txt", content: LONG } }, CH);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="p8"]')`, 3000);
await sleep(800);
/** 단추 줄이 대화 칸(구르는 몸)의 보이는 자리 안 · 카드 몸이 구른다 · 카드가 대화 칸보다 높지 않다 */
const actionsSeen = (id) =>
  evj(`(() => { const c = document.querySelector('[data-chat-tile-perm="${id}"]'); if (!c) return 'null'; let sc = c.parentElement;
    while (sc && !/auto|scroll/.test(getComputedStyle(sc).overflowY)) sc = sc.parentElement;
    const S = sc.getBoundingClientRect(), A = c.querySelector('[data-chat-tile-perm-actions]').getBoundingClientRect(), R = c.getBoundingClientRect(), b = c.querySelector('[data-chat-tile-perm-body]');
    return JSON.stringify({ actions: A.top >= S.top - 0.5 && A.bottom <= S.bottom + 0.5 && A.bottom <= innerHeight + 0.5, fits: R.height <= S.height + 0.5,
      bodyScrolls: b.scrollHeight > b.clientHeight + 1 || [...b.querySelectorAll('pre, [data-chat-tile-perm-diff]')].some((x) => x.scrollHeight > x.clientHeight + 1) }); })()`);
check("㉘ 작은 타일(560×400) — 긴 카드의 단추 줄이 보임 · 카드가 대화 칸 안 · 긴 몫이 구른다", await actionsSeen("p8"), { actions: true, fits: true, bodyScrolls: true });
await shot("chat-tile-small-card.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="p8"] [data-chat-tile-deny]')`);
check("㉘ 작은 타일 — [거절] 을 바로 누를 수 있다", (await callsOf("chat_tile_decide")).some((a) => a.requestId === "p8" && a.decision === "deny"), true);
await emit({ t: "permissionResolved", requestId: "p8", decision: "deny", by: "human" }, CH);
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await emit({ t: "turnEnded", turn: "t5", outcome: "ok", message: null }, CH);
await sleep(500);

// ⑨ 리로드 — 같은 id 로 subscribe(open 없음) · 그다음 [session-gone] 이면 open{resume}
await ev(`(sessionStorage.setItem('h.reload', '1'), sessionStorage.setItem('h.ct', '[]'), 1)`);
await bootPage({ remote: false, width: 1280, height: 860, fresh: false });
await waitFor(`!!document.querySelector('${L} [data-chat-tile-face]')`, 6000);
await waitFor(`window.__calls.some(([c]) => c === 'chat_tile_subscribe')`, 4000);
let k = await kept();
check("⑨ 리로드 — 같은 chatId 로 subscribe · open 없음 · close 없음", [k.filter(([c]) => c === "chat_tile_subscribe").map(([, a]) => a.chat === CH), k.some(([c]) => c === "chat_tile_open" || c === "chat_tile_close")], [[true], false]);
await ev(`(sessionStorage.setItem('h.gone', '1'), sessionStorage.setItem('h.ct', '[]'), 1)`);
await bootPage({ remote: false, width: 1280, height: 860, fresh: false });
await waitFor(`!!document.querySelector('${L} [data-chat-tile-face]')`, 6000);
await waitFor(`(JSON.parse(sessionStorage.getItem('h.ct') || '[]')).filter(([c]) => c === 'chat_tile_subscribe').length >= 2`, 5000);
k = await kept();
check("⑨ [session-gone] → open{resume conv} → 다시 subscribe", k.map(([c, a]) => (c === "chat_tile_open" ? [c, a.mode, a.model, a.effort] : [c])).filter(([c]) => c !== "chat_tile_unsubscribe"),
  [["chat_tile_subscribe"], ["chat_tile_open", { kind: "resume", conv: CONV }, "opus", "high"], ["chat_tile_subscribe"]]);
subGenNow = 2;

// ⑩ 턴 중 닫기 → 확인 상자 → close
spec = await chatSpec();
await emit({ t: "turnStarted", turn: "t3" }, CH);
await sleep(300);
c0 = await callCount();
await ev(`(async () => (await ${W}).closePaneIn(${JSON.stringify(spec.tab)}, ${JSON.stringify(spec.id)}))()`);
check("⑩ 턴 중 닫기 = 확인 상자", await waitFor(`!!document.querySelector('[data-confirm-dialog]')`, 3000), true);
check("⑩ 상자 문구", await ev(`document.querySelector('[data-confirm-dialog]').textContent.includes('채팅 타일을 닫을까요?')`), true);
await shot("chat-tile-close-busy.png");
check("⑩ 묻는 동안은 닫지 않음", (await callsOf("chat_tile_close", c0)).length, 0);
await clickAt(`document.querySelector('[data-confirm-dialog] [data-confirm-choice="Ok"]')`);
await sleep(500);
check("⑩ [닫기] = chat_tile_close{chat} · 잎 걷힘", [(await callsOf("chat_tile_close", c0)).map((a) => a.chat === CH), await ev(`!document.querySelector('${L}')`)], [[true], true]);

// AI 고르기 상자 — 모양 단추 없음 · 우클릭 = 모양 메뉴 · Alt+Enter = 기본이 아닌 모양
const PICK = importApp("app/ai-launch.svelte.ts");
await ev(`(async () => (await ${PICK}).openAiLaunchPicker())()`);
await waitFor(`!!document.querySelector('[data-ai-launch-picker] [data-ai-launch-row]')`, 4000);
await sleep(500);
check("고르기 상자 — 모양 단추 없음", await ev(`document.querySelectorAll('[data-ai-launch-forms], [data-ai-launch-picker] [data-ai-launch-form]').length`), 0);
await shot("launcher-picker.png");
await rightClickAt(`document.querySelector('[data-ai-launch-row][aria-selected="true"]')`);
check("고르기 상자 — 우클릭 = 모양 메뉴 · 기본(터미널) 표시 · 다른 쪽은 Alt+Enter", await evj(`JSON.stringify([...document.querySelectorAll('[data-ai-launch-menu] [data-ai-launch-form]')].map((b) => [b.dataset.aiLaunchForm, b.hasAttribute('data-default'), b.textContent.trim()]))`),
  [["terminal", true, "터미널로 열기 기본"], ["chat", false, "채팅으로 열기 Alt+Enter"]]);
await shot("launcher-picker-menu.png");
await key("Escape");
check("고르기 상자 — Esc 가 메뉴만 닫는다", await ev(`!document.querySelector('[data-ai-launch-menu]') && !!document.querySelector('[data-ai-launch-picker]')`), true);
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, code: "F10", key: "F10", modifiers: 8, windowsVirtualKeyCode: 121, nativeVirtualKeyCode: 121 });
await sleep(250);
check("고르기 상자 — Shift+F10 = 같은 메뉴", await ev(`!!document.querySelector('[data-ai-launch-menu]')`), true);
await key("Escape");
c0 = await callCount();
for (const type of ["keyDown", "keyUp"]) await send("Input.dispatchKeyEvent", { type, code: "Enter", key: "Enter", modifiers: 1, windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 });
check("고르기 상자 — Alt+Enter(기본 터미널) = 채팅 잎 · open{fresh}", [await waitFor(`!!document.querySelector('${L}') && window.__calls.slice(${c0}).some(([c]) => c === 'chat_tile_open')`, 5000), (await callsOf("chat_tile_open", c0)).map((a) => a.mode.kind)], [true, ["fresh"]]);

// ⑭ 띄우는 중 닫기 — 첫 보내기를 받은 뒤 턴이 서기 전(Claude ≈5초)에도 묻는다 · 둘째 글은 막힌다
await waitFor(`!!document.querySelector('${L} [data-flip-input]') && window.__calls.filter(([c]) => c === 'chat_tile_subscribe').length > 0`, 4000);
await sleep(400);
spec = await chatSpec();
await ev(`document.querySelector('${L} [data-flip-input]').focus()`);
await send("Input.insertText", { text: "시작하자마자 닫기" });
c0 = await callCount();
await key("Enter");
await waitFor(`window.__calls.slice(${c0}).some(([c]) => c === 'chat_tile_send')`, 3000);
await sleep(300);
check("⑭ 보낸 뒤 턴 전 — 입력 칸 대신 '시작하는 중' 줄 · [중지] 없음", [await ev(`document.querySelector('${L} [data-flip-gate]')?.textContent.trim() ?? null`), await ev(`!document.querySelector('${STOP}')`)],
  ["Claude Code 시작하는 중…", true]);
await ev(`(async () => (await ${W}).closePaneIn(${JSON.stringify(spec.tab)}, ${JSON.stringify(spec.id)}))()`);
check("⑭ 띄우는 중 닫기 = 확인 상자", await waitFor(`!!document.querySelector('[data-confirm-dialog]')`, 3000), true);
await shot("chat-tile-close-starting.png");
check("⑭ 묻는 동안은 닫지 않음", [(await callsOf("chat_tile_close", c0)).length, await ev(`!!document.querySelector('${L}')`)], [0, true]);
await clickAt(`document.querySelector('[data-confirm-dialog] [data-confirm-choice="Ok"]')`);
await sleep(500);
check("⑭ [닫기] = chat_tile_close · 잎 걷힘", [(await callsOf("chat_tile_close", c0)).length, await ev(`!document.querySelector('${L}')`)], [1, true]);
// ═══ D. 첨부 · 탭 점 · 배너 ═══════════════════════════════════════════════════════════════
// 기본 모양 = 채팅 — 고르기 상자의 Enter 가 채팅으로 연다
await ev(`(async () => (await ${SET}).setAiLaunchForm('chat'))()`);
await ev(`(async () => (await ${importApp("app/ai-launch.svelte.ts")}).openAiLaunchPicker())()`);
await waitFor(`!!document.querySelector('[data-ai-launch-picker] [data-ai-launch-row]')`, 4000);
await sleep(400);
await rightClickAt(`document.querySelector('[data-ai-launch-row][aria-selected="true"]')`);
check("D 기본 채팅 — 메뉴의 기본 표시가 채팅으로", await evj(`JSON.stringify([...document.querySelectorAll('[data-ai-launch-menu] [data-ai-launch-form]')].map((b) => [b.dataset.aiLaunchForm, b.hasAttribute('data-default')]))`), [["terminal", false], ["chat", true]]);
await key("Escape");
c0 = await callCount();
await key("Enter");
await ev(`(async () => (await ${SET}).setAiLaunchForm('terminal'))()`);
await waitFor(`!!document.querySelector('${L} [data-flip-input]') && window.__calls.slice(${c0}).filter(([c]) => c === 'chat_tile_subscribe').length > 0`, 6000);
await sleep(500);
spec = await chatSpec();
const CHD = spec.chat.chatId;
const PANED = spec.id;
const TABD = spec.tab;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==";
/** 파일 몇 개를 DataTransfer 로 — `big` 이면 10 MB 를 넘는 것 하나를 더한다 */
const DT = (names, big = false) => `(() => { const dt = new DataTransfer(); const png = Uint8Array.from(atob('${PNG}'), (c) => c.charCodeAt(0));
  for (const n of ${JSON.stringify(names)}) dt.items.add(n.endsWith('.png') ? new File([png], n, { type: 'image/png' }) : new File(['export const a = 1;\\n'], n, { type: 'text/plain' }));
  ${big ? "dt.items.add(new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'huge.bin'));" : ""} return dt; })()`;
const chips = () => evj(`JSON.stringify([...document.querySelectorAll('${L} [data-flip-attachment]')].map((li) => [li.querySelector('.att-name')?.textContent.trim(), li.classList.contains('staging')]))`);
const pickFiles = (names, big = false) => ev(`(() => { const i = document.querySelector('${L} [data-chat-tile-pick]'); i.files = ${DT(names, big)}.files; i.dispatchEvent(new Event('change', { bubbles: true })); return true; })()`);
/** 스텁 환경의 저장 실패 토스트가 말풍선을 가린다 — 캡처 때만 숨긴다 */
const quietShot = async (name) => {
  await ev(`(() => { const st = document.createElement('style'); st.id = 'h-quiet'; st.textContent = '.toast { display: none !important; }'; document.head.append(st); return 1; })()`);
  await shot(name);
  await ev(`(document.getElementById('h-quiet')?.remove(), 1)`);
};
const toasts = () => evj(`JSON.stringify([...document.querySelectorAll('.toast')].map((e) => e.textContent.trim()))`);
const endTurn = async (turn) => {
  await emit({ t: "turnStarted", turn }, CHD);
  await emit({ t: "turnEnded", turn, outcome: "ok", message: null }, CHD);
  await sleep(400);
};

// ⑲ [+] → 파일 고르기 → 칩 → send{images, files}
await ev(`(() => { const i = document.querySelector('${L} [data-chat-tile-pick]'); window.__picked = 0; i.click = () => { window.__picked += 1; }; return 1; })()`);
const plusAt = await evj(`(() => { const b = document.querySelector('${L} [data-chat-tile-plus]'); return b ? JSON.stringify({ label: b.getAttribute('aria-label'), menu: b.hasAttribute('aria-haspopup') }) : 'null'; })()`);
check("⑲ [+] 단추 — 이름 '파일 업로드' · 메뉴 없음", plusAt, { label: "파일 업로드", menu: false });
await clickAt(`document.querySelector('${L} [data-chat-tile-plus]')`);
check("⑲ [+] 누름 = 숨은 파일 고르기", await ev(`window.__picked`), 1);
await pickFiles(["shot.png", "main.ts"]);
check("⑲ 칩 둘 · 준비됨", await waitFor(`[...document.querySelectorAll('${L} [data-flip-attachment]')].length === 2 && !document.querySelector('${L} [data-flip-attachment].staging')`, 4000), true);
check("⑲ 칩 이름", (await chips()).map(([n]) => n), ["shot.png", "main.ts"]);
check("⑲ 앱 첨부 자리에 올림 — stage_agent_attachment 둘", (await callsOf("stage_agent_attachment", c0)).length, 2);
await ev(`document.querySelector('${L} [data-flip-input]').focus()`);
await send("Input.insertText", { text: "이거 봐 줘" });
await quietShot("chat-tile-attach-chips.png");
c0 = await callCount();
await key("Enter");
await sleep(500);
let sends = await callsOf("chat_tile_send", c0);
check("⑲ chat_tile_send{images:[…png], files:[…ts]} — 앱 첨부 자리의 경로만",
  sends.map((a) => [a.chat === CHD, a.text, a.images.map((x) => x.replace(/^.*\/attachments\/0+\d+\//, "@/")), a.files.map((x) => x.replace(/^.*\/attachments\/0+\d+\//, "@/"))]),
  [[true, "이거 봐 줘", ["@/shot.png"], ["@/main.ts"]]]);
check("⑲ 보낸 뒤 칩 비움", (await chips()).length, 0);
const bubble = await evj(`(() => { const u = [...document.querySelectorAll('${L} [data-item="user"]')].pop(); return JSON.stringify({ pics: u?.querySelectorAll('[data-sent-pic]').length ?? -1, files: [...(u?.querySelectorAll('[data-sent-file]') ?? [])].map((e) => e.textContent.trim()) }); })()`);
check("⑲ 말풍선 — 그림 미리 보기 하나 · 파일 이름", bubble, { pics: 1, files: ["main.ts"] });
await quietShot("chat-tile-attach-sent.png");
await emit({ t: "userAccepted", clientId: sends[0]?.clientId, text: "이거 봐 줘" }, CHD);
// ㉖ 턴이 끝나면 기록이 그린다 — 기록 읽기가 서버 꼬리(`Attached file: …`)를 파일 칩으로 걷어 준 꼴 · 그림은 기록의 그림 블록
await emit({ t: "ready", cli: "claude", version: "2.1.332", model: "claude-haiku-5-5", models: [], efforts: {}, conversationId: "2c5f0d1e-7a8b-4c9d-9e0f-112233445566" }, CHD);
await ev(`(window.__transcript = { items: [
  { role: 'user', text: '이거 봐 줘', truncated: false, images: 1, pictures: [{ at: 0, len: 68, n: 0, mime: 'image/png' }], files: ['main.ts'], tool: null, at: Date.now() - 2000 },
  { role: 'assistant', text: '첨부 파일 이름은 main.ts 입니다.', truncated: false, images: 0, tool: null, at: Date.now() - 1000 },
], cursor: null }, 1)`);
await endTurn("d1");
await sleep(600);
const recBubble = await evj(`(() => { const u = [...document.querySelectorAll('${L} [data-item="user"]')].pop(); return JSON.stringify({ text: u?.querySelector('.utext')?.textContent.trim() ?? null,
  files: [...(u?.querySelectorAll('[data-sent-file]') ?? [])].map((e) => e.textContent.trim()), pics: u?.querySelectorAll('img.upic:not([data-sent-pic])').length ?? -1, answer: document.querySelector('${L}').textContent.includes('첨부 파일 이름은'),
  countChip: [...(u?.querySelectorAll('.chip') ?? [])].some((e) => /그림|이미지/.test(e.textContent)), path: document.querySelector('${L}').textContent.includes('Attached file') }); })()`);
check("㉖ 기록으로 그린 첨부 말 — 글 · 파일 칩 · 기록의 그림 한 장 · 답 · 개수 칩 · 경로 글 없음", recBubble, { text: "이거 봐 줘", files: ["main.ts"], pics: 1, answer: true, countChip: false, path: false });
await quietShot("chat-tile-attach-record.png");

// ㉙ 로컬 명령 — 모델 턴 없이 CLI 가 답한 /context 는 기록 읽기가 숨긴다. 기록을 다시 받아도 타일이 떠 있는 동안 말풍선 · 출력이 남는다
const CTX_OUT = "## Context Usage\n\n**Model:** claude-haiku-5-5\n\n다만 이 줄은 둘째 문단";
await ev(`document.querySelector('${L} [data-flip-input]').focus()`);
await send("Input.insertText", { text: "/context" });
// `/` 메뉴가 열려 있으면 Enter 는 줄을 고른다(넣기만) — 닫고 보낸다
await key("Escape");
c0 = await callCount();
await key("Enter");
await sleep(300);
sends = await callsOf("chat_tile_send", c0);
await emit({ t: "turnStarted", turn: null }, CHD);
await emit({ t: "userAccepted", clientId: sends[0]?.clientId, text: "/context" }, CHD);
await emit({ t: "text", item: null, text: CTX_OUT }, CHD);
await emit({ t: "turnEnded", turn: null, outcome: "ok", message: null }, CHD);
await sleep(1500);
const localSeen = async () => evj(`(() => { const r = document.querySelector('${L}'); const us = [...r.querySelectorAll('[data-item="user"]')].map((e) => e.querySelector('.utext')?.textContent.trim());
  const out = [...r.querySelectorAll('[data-item="assistant"]')].find((e) => e.textContent.includes('Context Usage'));
  return JSON.stringify({ user: us.filter((x) => x === '/context').length, out: !!out, blocks: out ? out.querySelectorAll('h1, h2, h3, h4, h5, h6, p').length : 0, last: us[us.length - 1] ?? null }); })()`);
check("㉙ /context — 기록을 다시 받은 뒤에도 말풍선 하나 · 출력 · 문단 셋(제목 · 문단 둘 — 붙지 않는다)", await localSeen(), { user: 1, out: true, blocks: 3, last: "/context" });
await quietShot("chat-tile-local-command.png");
// 다음 턴의 기록이 와도 제자리(때 순서) — 뒤 턴이 그 뒤에 선다
await ev(`(window.__transcript.items.push({ role: 'user', text: '다음 말', truncated: false, images: 0, tool: null, at: Date.now() + 1000 },
  { role: 'assistant', text: '다음 답', truncated: false, images: 0, tool: null, at: Date.now() + 2000 }), 1)`);
await endTurn("d1b");
await sleep(600);
check("㉙ 다음 턴 뒤에도 남고 자리는 그 턴 앞", await localSeen(), { user: 1, out: true, blocks: 3, last: "다음 말" });

// ⑳ 빈 글 + 칩만 → 보냄 · 상한
await pickFiles(["notes.md"]);
await waitFor(`[...document.querySelectorAll('${L} [data-flip-attachment]')].length === 1 && !document.querySelector('${L} [data-flip-attachment].staging')`, 4000);
await ev(`document.querySelector('${L} [data-flip-input]').focus()`);
c0 = await callCount();
await key("Enter");
await sleep(400);
sends = await callsOf("chat_tile_send", c0);
check("⑳ 빈 글 + 칩 하나 → 보냄(files 만)", sends.map((a) => [a.text, a.images.length, a.files.length]), [["", 0, 1]]);
await endTurn("d2");
c0 = await callCount();
await pickFiles(["a1.ts", "a2.ts", "a3.ts", "a4.ts", "a5.ts", "a6.ts", "a7.ts", "a8.ts", "a9.ts"]);
await sleep(400);
check("⑳ 9개 → 칩 없음 · 올리지 않음 · 알림(8개까지)", [(await chips()).length, (await callsOf("stage_agent_attachment", c0)).length, (await toasts()).some((x) => x.includes("8"))], [0, 0, true]);
await pickFiles(["ok.ts"], true);
await sleep(500);
check("⑳ 10 MB 넘는 것은 빼고 알림 · 나머지는 칩", [(await chips()).map(([n]) => n), (await toasts()).some((x) => x.includes("huge.bin"))], [["ok.ts"], true]);
await shot("chat-tile-attach-caps.png");
await ev(`document.querySelector('${L} [data-flip-attachment-remove]').click()`);
await sleep(200);

// ㉑ 붙여 넣기 · 입력 칸에 놓기
await ev(`(() => { const i = document.querySelector('${L} [data-flip-input]'); i.dispatchEvent(new ClipboardEvent('paste', { clipboardData: ${DT(["paste.png"])}, bubbles: true, cancelable: true })); return 1; })()`);
await ev(`(() => { const c = document.querySelector('${L} [data-flip-composer]'); const dt = ${DT(["drop.ts"])};
  c.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, bubbles: true, cancelable: true })); c.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true })); return 1; })()`);
await waitFor(`[...document.querySelectorAll('${L} [data-flip-attachment]')].length === 2 && !document.querySelector('${L} [data-flip-attachment].staging')`, 4000);
check("㉑ 붙여 넣기 · 놓기 → 칩", (await chips()).map(([n]) => n), ["paste.png", "drop.ts"]);

// ㉒ 판 거절 · 첨부 판정 → 오류 줄 문구
await ev(`(window.__ctSendFail = '[server-outdated] 세션 서버가 이전 판이라 채팅 타일에 파일을 붙일 수 없습니다', 1)`);
await ev(`document.querySelector('${L} [data-flip-input]').focus()`);
await send("Input.insertText", { text: "옛 서버" });
await key("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-error]')`, 3000);
check("㉒ [server-outdated] → 오류 줄(다시 시작 안내) · 말풍선 실패", [await ev(`document.querySelector('${L} [data-chat-tile-error]')?.textContent.trim()`),
  await ev(`[...document.querySelectorAll('${L} [data-item="user"]')].pop()?.textContent.includes('보내지 못했습니다') ?? false`)],
  ["세션 서버가 이전 판입니다 — 설정 › 세션 서버에서 [다시 시작] 하세요", true]);
await quietShot("chat-tile-attach-outdated.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-error] .banner-x')`);
await ev(`(window.__ctSendFail = '[file-outside] attachment is outside the attachment folder', 1)`);
await pickFiles(["x.ts"]);
await waitFor(`[...document.querySelectorAll('${L} [data-flip-attachment]')].length === 1 && !document.querySelector('${L} [data-flip-attachment].staging')`, 4000);
await ev(`document.querySelector('${L} [data-flip-input]').focus()`);
await key("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-error]')`, 3000);
check("㉒ [file-outside] → 첨부 실패 문구", await ev(`document.querySelector('${L} [data-chat-tile-error]')?.textContent.trim()`), "붙인 파일을 보내지 못했습니다 — 다시 붙여 보세요.");
await clickAt(`document.querySelector('${L} [data-chat-tile-error] .banner-x')`);
await ev(`(window.__ctSendFail = null, 1)`);

// ㉓ 숨은 탭의 점 · 배너
const tabDot = () => ev(`document.querySelector('[data-tab="${TABD}"] [data-agent-dot]')?.dataset.agentDot ?? null`);
const banner = () => evj(`JSON.stringify([...document.querySelectorAll('[data-agent-banner][data-pane="${PANED}"]')].map((b) => b.dataset.kind))`);
await ev(`(async () => { const w = await ${W}; const s = await ${importApp("lib/session.ts")}; w.openTab(s.newTab()); })()`);
await sleep(800);
const OTHER = await ev(`(async () => (await ${W}).activeTabId())()`);
const c5 = await callCount();
check("㉓ 빈 탭을 본다", OTHER !== TABD, true);
await emit({ t: "turnStarted", turn: "d5" }, CHD);
await sleep(300);
check("㉓ turnStarted → 그 탭 점 running", await tabDot(), "running");
await emit({ t: "permission", requestId: "dp1", kind: "command", title: "Bash", detail: "ls", toolName: "Bash", input: { command: "ls" } }, CHD);
await waitFor(`!!document.querySelector('[data-agent-banner][data-pane="${PANED}"]')`, 3000);
check("㉓ permission → 점 permission · 권한 배너(paneId)", [await tabDot(), await banner()], ["permission", ["permission"]]);
await quietShot("chat-tile-tab-permission.png");
await emit({ t: "permissionResolved", requestId: "dp1", decision: "allow", by: "human" }, CHD);
await waitFor(`!document.querySelector('[data-agent-banner][data-pane="${PANED}"]')`, 3000);
check("㉓ permissionResolved → 배너 풀림 · 점 running", [await banner(), await tabDot()], [[], "running"]);
await emit({ t: "turnEnded", turn: "d5", outcome: "ok", message: null }, CHD);
await waitFor(`!!document.querySelector('[data-agent-banner][data-pane="${PANED}"]')`, 3000);
check("㉓ turnEnded ok → 점 finished · 끝남 배너", [await tabDot(), await banner()], ["finished", ["stop"]]);
await quietShot("chat-tile-tab-finished.png");
await ev(`(async () => (await ${W}).pickTab(${JSON.stringify(TABD)}))()`);
await waitFor(`!document.querySelector('[data-agent-banner][data-pane="${PANED}"]')`, 3000);
check("㉓ 그 탭을 보면 점 · 배너 풀림", [await tabDot(), await banner()], [null, []]);
await ev(`(async () => (await ${W}).pickTab(${JSON.stringify(OTHER)}))()`);
await sleep(300);
await emit({ t: "turnStarted", turn: "d6" }, CHD);
await emit({ t: "turnEnded", turn: "d6", outcome: "interrupted", message: null }, CHD);
await sleep(600);
check("㉓ 끊긴 턴 → 배너 없음 · 점 없음", [await banner(), await tabDot()], [[], null]);
await emit({ t: "turnStarted", turn: "d7" }, CHD);
await emit({ t: "turnEnded", turn: "d7", outcome: "error", message: "boom" }, CHD);
await waitFor(`!!document.querySelector('[data-agent-banner][data-pane="${PANED}"]')`, 3000);
check("㉓ 실패한 턴 → 실패 배너", await banner(), ["failed"]);
await ev(`(async () => (await ${W}).pickTab(${JSON.stringify(TABD)}))()`);
await waitFor(`!document.querySelector('[data-agent-banner][data-pane="${PANED}"]')`, 3000);

// ㉔ 메신저 명령 0
check("㉔ 점 · 배너 사이 invoke 기록에 messenger_ 명령 0", await evj(`JSON.stringify(window.__calls.slice(${c5}).map(([c]) => c).filter((c) => c.startsWith('messenger_')))`), []);
// 하네스가 만든 탭 정리 — 채팅 잎은 쉬는 중이라 묻지 않고 닫힌다
await ev(`(async () => { const w = await ${W}; w.closePaneIn(${JSON.stringify(TABD)}, ${JSON.stringify(PANED)}); })()`);
await sleep(500);
check("D 채팅 잎 닫힘 = chat_tile_close", [(await callsOf("chat_tile_close")).some((a) => a.chat === CHD), await ev(`!document.querySelector('${L}')`)], [true, true]);
check("A 예외 0", errors.slice(), []);
// ㉕ 사이드 채팅 독 — 그 대화를 채팅 타일이 쥐면 서버가 거절하고 독 오류 줄이 그 문구다
await bootPage({ remote: false, width: 1280, height: 860, sc: true });
errors.length = 0;
const CHATS = importApp("app/side-chats.svelte.ts");
const CDOCK = importApp("app/chat-dock.svelte.ts");
await ev(`(async () => { (await ${CHATS}).selectSideChat('sc-1'); (await ${CDOCK}).openChatDockAt('chat'); })()`);
await waitFor(`!!document.querySelector('[data-side-chat-error]')`, 6000);
check("㉕ side_chat_open [conversation-in-chat-tile] → 독 오류 줄 문구",
  [await ev(`document.querySelector('[data-side-chat-error] .error-text')?.textContent.trim() ?? null`), [...new Set((await callsOf("side_chat_open")).map((a) => JSON.stringify(a.mode)))]],
  ["이 대화는 채팅 타일에 열려 있습니다 — 그 타일을 닫은 뒤 다시 해 보세요", [JSON.stringify({ kind: "resume", conv: CONV })]]);
await sleep(1500);
// 거절은 곧바로 와도 독이 open 을 되풀이하지 않는다
check("㉕ 거절이 이어져도 side_chat_open 한 번", (await callsOf("side_chat_open")).length, 1);
await shot("side-chat-in-chat-tile.png");
check("㉕ 예외 0", errors.slice(), []);

// ═══ E. 권한 모드 칩 · 늘 허용 · 계획 · 질문 · 패치(3단계) ═══════════════════════════════════
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;
const CLAUDE3 = ["default", "acceptEdits", "plan"];
const CODEX3 = ["readOnly", "auto", "plan"];
/** 채팅 잎 하나를 독 우클릭 [채팅으로 열기] 로 연다 — 스냅숏 덧칸은 열기 전에 고른다 */
const openChatTile = async (cli, extra) => {
  await ev(`(window.__ctSnap = ${JSON.stringify(extra)}, 1)`);
  // 독이 늦게 서면 누름이 빗나간다 — 한 번 더 연다(`openCT` 와 같다)
  for (let tries = 0; tries < 2; tries++) {
    await ev(`(async () => (await ${DOCKM}).openDock('alerts'))()`);
    await waitFor(`!!document.querySelector('${DOCK_AI(cli)}')`, 6000);
    await sleep(300);
    const from = await callCount();
    await dockOpenAs(cli, "chat");
    const up = await waitFor(`!!document.querySelector('${L} [data-chat-tile-mode-chip]') && window.__calls.slice(${from}).filter(([c]) => c === 'chat_tile_subscribe').length >= 2`, 6000);
    await sleep(500);
    const sp = await chatSpec();
    if (up && sp) return sp;
  }
  return chatSpec();
};
const modeChip = () =>
  evj(`(() => { const b = document.querySelector('${L} [data-chat-tile-mode-chip]'); return b ? JSON.stringify({ mode: b.dataset.chatTileModeChip, foreign: b.dataset.foreign, text: b.textContent.trim(), accent: b.classList.contains('accent'), disabled: b.disabled }) : 'null'; })()`);
const menuRows = () => evj(`JSON.stringify([...document.querySelectorAll('[data-chat-tile-mode-menu] button[data-chat-tile-mode]')].map((b) => b.dataset.chatTileMode))`);
const openModeMenu = async () => {
  await clickAt(`document.querySelector('${L} [data-chat-tile-mode-chip]')`);
  return waitFor(`!!document.querySelector('[data-chat-tile-mode-menu]')`, 3000);
};
const keysOf = (o) => Object.keys(o ?? {}).sort();
/** 카드의 단추 글 · 모든 단추가 카드 안 */
const cardButtons = (id) =>
  evj(`(() => { const c = document.querySelector('[data-chat-tile-perm="${id}"]'); if (!c) return 'null'; const R = c.getBoundingClientRect(); const bs = [...c.querySelectorAll('[data-chat-tile-perm-actions] button')];
    return JSON.stringify({ buttons: bs.map((b) => b.textContent.trim()), inside: bs.every((b) => { const x = b.getBoundingClientRect(); return x.left >= R.left - 0.5 && x.right <= R.right + 0.5 && x.bottom <= R.bottom + 0.5; }),
      scroll: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
const cardUp = async (id) => {
  await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="${id}"]')`, 3000);
  await sleep(500);
};
const resolve = (id, decision, chat) => emit({ t: "permissionResolved", requestId: id, decision, by: "human" }, chat);
const doneText = (id) => ev(`document.querySelector('${L} [data-chat-tile-perm="${id}"]')?.textContent.trim() ?? null`);

// ㉛ E1 Claude — 스냅숏 cliMode 가 칩 글자 · 메뉴는 고를 수 있는 셋 · 고르면 set_perm_mode{chat, epoch, mode} 그대로
spec = await openChatTile("claude", { permMode: null, cliMode: { mode: "default", choices: CLAUDE3 } });
const CE = spec.chat.chatId;
check("㉛ E1 칩 = CLI 가 알린 모드(Manual · 중성 면)", await modeChip(), { mode: "default", foreign: "false", text: "Manual", accent: false, disabled: false });
check("㉛ E1 칩은 [+] 오른쪽 · 입력 칸 아랫줄 왼쪽", await ev(`(() => { const p = document.querySelector('${L} [data-chat-tile-plus]').getBoundingClientRect(); const c = document.querySelector('${L} [data-chat-tile-mode-chip]').getBoundingClientRect(); return c.left >= p.right && Math.abs((c.top + c.bottom) / 2 - (p.top + p.bottom) / 2) < 3; })()`), true);
check("㉛ E1 메뉴가 열린다", await openModeMenu(), true);
check("㉛ E1 메뉴 줄 = 셋(auto · bypass · 묻지 않기 없음) · 지금 것 체크", [await menuRows(), await ev(`document.querySelector('[data-chat-tile-mode-menu] [aria-checked="true"]')?.dataset.chatTileMode ?? null`),
  await ev(`!document.querySelector('[data-chat-tile-mode="bypassPermissions"], [data-chat-tile-mode="dontAsk"], [data-chat-tile-mode="auto"]')`)], [CLAUDE3, "default", true]);
check("㉛ E1 메뉴 설명 줄", await ev(`document.querySelector('[data-chat-tile-mode-menu] [data-chat-tile-mode="acceptEdits"]').textContent.includes('파일 편집은 묻지 않고')`), true);
await shot("e1-mode-menu-claude.png");
c0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-mode-menu] [data-chat-tile-mode="acceptEdits"]')`);
await sleep(300);
let modeCalls = await callsOf("chat_tile_set_perm_mode", c0);
check("㉛ E1 [Accept edits] = chat_tile_set_perm_mode — 열쇠 정확히 chat · epoch · mode", modeCalls.map((a) => [keysOf(a), a.chat === CE, typeof a.epoch, a.mode]), [[["chat", "epoch", "mode"], true, "number", "acceptEdits"]]);
check("㉛ E1 고른 뒤 메뉴 닫힘 · 입력 칸에 포커스(BODY 로 잃지 않는다)", [await ev(`!document.querySelector('[data-chat-tile-mode-menu]')`), await ev(`document.activeElement?.hasAttribute('data-flip-input') ?? false`)], [true, true]);
await emit({ t: "cliMode", mode: "acceptEdits", choices: CLAUDE3, chosen: "acceptEdits" }, CE);
await sleep(300);
spec = await chatSpec();
check("㉛ E1 사건 cliMode → 칩 Accept edits(강조 면) · 메인 PC 명세 permMode", [await modeChip(), spec.chat.permMode], [{ mode: "acceptEdits", foreign: "false", text: "Accept edits", accent: true, disabled: false }, "acceptEdits"]);
await shot("e1-mode-chip-accept.png");

// ㉜ E2 CLI 가 auto 를 알리면 넷째 줄
await emit({ t: "cliMode", mode: "acceptEdits", choices: [...CLAUDE3, "auto"], chosen: "acceptEdits" }, CE);
await sleep(200);
await openModeMenu();
check("㉜ E2 choices 에 auto → 넷째 줄 Auto", await menuRows(), [...CLAUDE3, "auto"]);
await key("Escape");
check("㉜ E2 Esc → 메뉴 닫힘 · 칩에 포커스", [await ev(`!document.querySelector('[data-chat-tile-mode-menu]')`), await ev(`document.activeElement?.hasAttribute('data-chat-tile-mode-chip') ?? false`)], [true, true]);

// ㉝ E3 사용자 설정의 bypass — 읽기 전용 표지 · 고르는 줄 없음 · 눌러도 invoke 없음
await emit({ t: "cliMode", mode: "bypassPermissions", choices: CLAUDE3 }, CE);
await sleep(200);
check("㉝ E3 칩 = Bypass (사용자 설정) · 경고 표지", await modeChip(), { mode: "bypassPermissions", foreign: "true", text: "Bypass (사용자 설정)", accent: false, disabled: false });
await openModeMenu();
const foreignRow = await evj(`(() => { const m = document.querySelector('[data-chat-tile-mode-menu]'); const f = m.firstElementChild; return JSON.stringify({ first: f?.dataset.chatTileModeForeign ?? null, disabled: f?.getAttribute('aria-disabled'), button: f?.tagName === 'BUTTON', text: f?.textContent.includes('사용자 설정') }); })()`);
check("㉝ E3 메뉴 첫 줄 = 고를 수 없는 표지(aria-disabled · 단추 아님) · 고르는 줄은 셋 그대로", [foreignRow, await menuRows()], [{ first: "bypassPermissions", disabled: "true", button: false, text: true }, CLAUDE3]);
await shot("e3-mode-foreign.png");
c0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-mode-foreign]')`);
await sleep(300);
check("㉝ E3 표지 줄을 눌러도 set_perm_mode 없음", (await callsOf("chat_tile_set_perm_mode", c0)).length, 0);
await key("Escape");
await emit({ t: "cliMode", mode: "default", choices: CLAUDE3, chosen: "default" }, CE);

// ㉞ E12 판 거절 → 오류 줄 · 칩이 흐린 채 남지 않는다
await ev(`(window.__ctModeFail = '[server-outdated] 세션 서버가 이전 판이라 채팅 타일의 권한 모드를 쓸 수 없습니다', 1)`);
await openModeMenu();
await clickAt(`document.querySelector('[data-chat-tile-mode-menu] [data-chat-tile-mode="plan"]')`);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-error]')`, 3000);
check("㉞ E12 [server-outdated] → 오류 줄 문구 · 칩 다시 누를 수 있음", [await ev(`document.querySelector('${L} [data-chat-tile-error]')?.textContent.trim()`), (await modeChip()).disabled],
  ["세션 서버가 이전 판입니다 — 설정 › 세션 서버에서 [다시 시작] 하세요", false]);
await quietShot("e12-mode-outdated.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-error] .banner-x')`);
await ev(`(window.__ctModeFail = null, 1)`);

// ㉟ E5 늘 허용 셋째 단추 — 글자가 실제 효과 · 누르면 결정 낱말만(열쇠 여섯)
await emit({ t: "turnStarted", turn: "e5" }, CE);
const EDIT_IN = { file_path: "C:/src/proj/src/a.ts", old_string: "a", new_string: "b" };
const SESSION_LABEL = { mode: "허용 · 이 대화를 편집 자동 허용(Accept edits)으로", rules: "허용 · 이 대화에서 Bash(npm test:*) 늘 허용", dirs: "허용 · 이 대화에서 이 폴더 허용: C:\\src\\other", command: "허용 · 이 대화에서 같은 명령은 늘" };
await emit({ t: "permission", requestId: "s-mode", kind: "tool", title: "Edit", detail: "", toolName: "Edit", input: EDIT_IN, sessionAllow: { kind: "mode", detail: "acceptEdits" } }, CE);
await cardUp("s-mode");
check("㉟ E5 kind mode — 단추 셋 · 셋째 = 편집 자동 허용 · 카드 안", await cardButtons("s-mode"), { buttons: ["허용", "거절", SESSION_LABEL.mode], inside: true, scroll: true });
check("㉟ E5 셋째 단추 툴팁 = CLI 자신의 규칙", await ev(`document.querySelector('[data-chat-tile-perm-session="mode"]').title.includes('설정 파일에 쓰지 않고')`), true);
await shot("e5-session-mode.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-perm-session="mode"]')`);
await sleep(300);
let dec = await callsOf("chat_tile_decide", c0);
check("㉟ E5 누름 = chat_tile_decide{allowSession} — 열쇠 여섯 · 글 · 답 없음",
  dec.map((a) => [keysOf(a), a.chat === CE, a.requestId, a.decision, a.message, a.answers]), [[["answers", "chat", "decision", "epoch", "message", "requestId"], true, "s-mode", "allowSession", null, null]]);
await resolve("s-mode", "allow", CE);
await sleep(300);
check("㉟ E5 끝난 줄 = 허용함 · 이 대화에서 늘", (await doneText("s-mode"))?.includes("허용함 · 이 대화에서 늘"), true);
await emit({ t: "permission", requestId: "s-rules", kind: "command", title: "Bash", detail: "npm test", toolName: "Bash", input: { command: "npm test -- --run", description: "run tests" }, sessionAllow: { kind: "rules", detail: "Bash(npm test:*)" } }, CE);
await cardUp("s-rules");
check("㉟ E5 kind rules — 셋째 = 규칙 글", await cardButtons("s-rules"), { buttons: ["허용", "거절", SESSION_LABEL.rules], inside: true, scroll: true });
await shot("e5-session-rules.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="s-rules"] [data-chat-tile-deny]')`);
await resolve("s-rules", "deny", CE);
await emit({ t: "permission", requestId: "s-dirs", kind: "tool", title: "Read", detail: "", toolName: "Read", input: { file_path: "C:\\src\\other\\x.txt" }, sessionAllow: { kind: "dirs", detail: "C:\\src\\other" } }, CE);
await cardUp("s-dirs");
check("㉟ E5 kind dirs — 셋째 = 이 폴더", await cardButtons("s-dirs"), { buttons: ["허용", "거절", SESSION_LABEL.dirs], inside: true, scroll: true });
await shot("e5-session-dirs.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="s-dirs"] [data-chat-tile-allow]')`);
await resolve("s-dirs", "allow", CE);
await sleep(300);
check("㉟ E5 [허용] 은 그냥 허용함", (await doneText("s-dirs"))?.endsWith("허용함"), true);
// ㊱ E6 늘 허용 요약이 없는 카드 — 단추 둘
await emit({ t: "permission", requestId: "s-none", kind: "tool", title: "Edit", detail: "", toolName: "Edit", input: EDIT_IN }, CE);
await cardUp("s-none");
check("㊱ E6 sessionAllow 없음 → 단추 둘", (await cardButtons("s-none")).buttons, ["허용", "거절"]);
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="s-none"] [data-chat-tile-deny]')`);
await resolve("s-none", "deny", CE);

// ㊲ E7 계획 카드 — 마크다운 · 파일 경로 · 승인 = allow · 고칠 점 + 계속 = deny{message}
const PLAN = "## 정리 계획\n\n1. `src/a.ts` 를 나눈다\n2. 시험을 더한다\n\n```ts\nexport const x = 1;\n```";
const PLAN_PATH = "C:\\Users\\h\\.claude\\plans\\tidy-heron.md";
await emit({ t: "permission", requestId: "pl1", kind: "tool", title: "ExitPlanMode", detail: PLAN, toolName: "ExitPlanMode", input: { plan: PLAN, planFilePath: PLAN_PATH } }, CE);
await cardUp("pl1");
const planCard = await evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-plan-card="pl1"]'); if (!c) return 'null'; const p = c.querySelector('[data-chat-tile-plan]');
  return JSON.stringify({ h2: p?.querySelector('h2')?.textContent.trim() ?? null, ol: p?.querySelectorAll('ol li').length ?? 0, code: !!p?.querySelector('pre, code'), file: c.querySelector('[data-chat-tile-plan-file]')?.textContent.includes('tidy-heron.md') ?? false,
    feedback: !!c.querySelector('[data-chat-tile-plan-feedback]'), buttons: [...c.querySelectorAll('[data-chat-tile-perm-actions] button')].map((b) => b.textContent.trim()), perm: !!c.querySelector('[data-chat-tile-allow]') }); })()`);
check("㊲ E7 계획 카드 — 제목(h2) · 목록 · 코드 · 파일 경로 · 고칠 점 칸 · [계속 계획] [계획 승인]", planCard,
  { h2: "정리 계획", ol: 2, code: true, file: true, feedback: true, buttons: ["계속 계획", "계획 승인"], perm: false });
await shot("e7-plan-card.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-plan-approve]')`);
await sleep(300);
check("㊲ E7 [계획 승인] = decide{allow} · 글 없음", (await callsOf("chat_tile_decide", c0)).map((a) => [a.requestId, a.decision, a.message, a.answers]), [["pl1", "allow", null, null]]);
await resolve("pl1", "allow", CE);
await sleep(300);
check("㊲ E7 끝난 줄 = 계획 승인함", (await doneText("pl1"))?.includes("계획 승인함"), true);
await emit({ t: "permission", requestId: "pl2", kind: "tool", title: "ExitPlanMode", detail: PLAN, toolName: "ExitPlanMode", input: { plan: PLAN } }, CE);
await cardUp("pl2");
await ev(`document.querySelector('${L} [data-chat-tile-plan-feedback]').focus()`);
await send("Input.insertText", { text: "x" });
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-plan-keep]')`);
await sleep(300);
check("㊲ E7 고칠 점 'x' + [계속 계획] = decide{deny, message:'x'} · 파일 줄 없음(경로 없음)",
  [(await callsOf("chat_tile_decide", c0)).map((a) => [a.requestId, a.decision, a.message]), await ev(`!document.querySelector('${L} [data-chat-tile-plan-card="pl2"] [data-chat-tile-plan-file]')`)], [[["pl2", "deny", "x"]], true]);
await resolve("pl2", "deny", CE);
await sleep(300);
check("㊲ E7 끝난 줄 = 계속 계획함", (await doneText("pl2"))?.includes("계속 계획함"), true);

// ㊳ E8 질문 카드 — 둘(하나 · 여럿) · 단계 · [답하기] 흐림 → 둘 고름 → decide{answer, answers}
const QS = [
  { question: "Which color?", header: "Color", multiSelect: false, options: [{ label: "Red", description: "warm" }, { label: "Green", description: "cool" }] },
  { question: "Which sizes?", header: "Size", multiSelect: true, options: [{ label: "S" }, { label: "M" }, { label: "L" }] },
];
await emit({ t: "permission", requestId: "qa1", kind: "tool", title: "AskUserQuestion", detail: "Which color? / Which sizes?", toolName: "AskUserQuestion", input: { questions: QS } }, CE);
await cardUp("qa1");
const qCard = () => evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-q-card="qa1"]'); if (!c) return 'null'; const a = c.querySelector('[data-chat-tile-q-answer]');
  return JSON.stringify({ count: c.querySelector('[data-chat-tile-q-count]')?.textContent.trim() ?? null, q: c.querySelector('[data-chat-tile-question]')?.dataset.chatTileQuestion ?? null,
    roles: [...c.querySelectorAll('[data-chat-tile-q-option]')].map((o) => o.getAttribute('role')), other: !!c.querySelector('[data-chat-tile-q-other]'), answer: a ? a.disabled : null }); })()`);
check("㊳ E8 질문 카드 — 1 / 2 · 첫 질문 하나 고르기(radio) · 직접 쓰기 · [답하기] 흐림", await qCard(), { count: "1 / 2", q: "Which color?", roles: ["radio", "radio"], other: true, answer: true });
await shot("e8-question-single.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-q-option="Red"]')`);
await clickAt(`document.querySelector('${L} [data-chat-tile-q-next]')`);
check("㊳ E8 둘째 질문 = 여럿 고르기(checkbox) · 아직 흐림", await qCard(), { count: "2 / 2", q: "Which sizes?", roles: ["checkbox", "checkbox", "checkbox"], other: true, answer: true });
check("㊳ E8 빠진 질문 안내", await ev(`document.querySelector('${L} [data-chat-tile-q-missing]')?.textContent.trim() ?? null`), "2번 질문에 답해 주세요");
await clickAt(`document.querySelector('${L} [data-chat-tile-q-option="S"]')`);
await clickAt(`document.querySelector('${L} [data-chat-tile-q-option="L"]')`);
check("㊳ E8 둘 다 고름 → [답하기] 켜짐 · 체크 상태", [(await qCard()).answer, await ev(`[...document.querySelectorAll('${L} [data-chat-tile-q-option][aria-checked="true"]')].map((o) => o.dataset.chatTileQOption).join(',')`)], [false, "S,L"]);
await shot("e8-question-multi.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-q-answer]')`);
await sleep(300);
check("㊳ E8 [답하기] = decide{answer, answers 질문 글 열쇠} · 글 없음",
  (await callsOf("chat_tile_decide", c0)).map((a) => [keysOf(a).length, a.requestId, a.decision, a.answers, a.message]), [[6, "qa1", "answer", { "Which color?": "Red", "Which sizes?": "S, L" }, null]]);
await resolve("qa1", "allow", CE);
await sleep(300);
check("㊳ E8 끝난 줄 = 답함", (await doneText("qa1"))?.includes("답함"), true);
// 직접 쓰기 — Enter 는 숨은 입력 칸의 보내기로 새지 않는다
await emit({ t: "permission", requestId: "qa2", kind: "tool", title: "AskUserQuestion", detail: "Name?", toolName: "AskUserQuestion", input: { questions: [{ question: "Name?", header: "Name", multiSelect: false, options: [{ label: "heron" }] }] } }, CE);
await cardUp("qa2");
await ev(`document.querySelector('${L} [data-chat-tile-q-card="qa2"] [data-chat-tile-q-other]').focus()`);
await send("Input.insertText", { text: "egret" });
c0 = await callCount();
await key("Enter");
check("㊳ E8 직접 쓰기 Enter → 보내기 · 결정 없음 · 카드 그대로", [(await callsOf("chat_tile_send", c0)).length, (await callsOf("chat_tile_decide", c0)).length, await ev(`!!document.querySelector('${L} [data-chat-tile-q-card="qa2"] [data-chat-tile-q-answer]')`)], [0, 0, true]);
await shot("e8-question-other.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-q-card="qa2"] [data-chat-tile-q-answer]')`);
await sleep(300);
check("㊳ E8 직접 쓴 답 = answers{Name?: egret}", (await callsOf("chat_tile_decide", c0)).map((a) => [a.decision, a.answers]), [["answer", { "Name?": "egret" }]]);
await resolve("qa2", "allow", CE);
await emit({ t: "permission", requestId: "qa3", kind: "tool", title: "AskUserQuestion", detail: "?", toolName: "AskUserQuestion", input: { questions: [{ question: "Go?", multiSelect: false, options: [{ label: "yes" }] }] } }, CE);
await cardUp("qa3");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-q-card="qa3"] [data-chat-tile-q-decline]')`);
await sleep(300);
check("㊳ E8 [답하지 않기] = decide{deny}", (await callsOf("chat_tile_decide", c0)).map((a) => [a.decision, a.answers]), [["deny", null]]);
await resolve("qa3", "deny", CE);
await sleep(300);
check("㊳ E8 끝난 줄 = 답하지 않음", (await doneText("qa3"))?.includes("답하지 않음"), true);

// ㊴ 작은 타일(560×400) — 늘 허용 · 계획 · 질문 카드의 단추 줄이 보이고 긴 몫만 구른다
await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 400, deviceScaleFactor: 1, mobile: false });
await sleep(600);
const LONG_PLAN = "## 긴 계획\n\n" + Array.from({ length: 40 }, (_, i) => `${i + 1}. 단계 ${i + 1} — 파일을 고친다`).join("\n");
const smallCases = [
  ["sm-rules", { t: "permission", requestId: "sm-rules", kind: "command", title: "Bash", detail: "", toolName: "Bash", input: { command: Array.from({ length: 30 }, (_, i) => `echo ${i}`).join("\n") }, sessionAllow: { kind: "rules", detail: "Bash(echo:*), Bash(npm run check:*)" } }, "e-small-session.png"],
  ["sm-plan", { t: "permission", requestId: "sm-plan", kind: "tool", title: "ExitPlanMode", detail: LONG_PLAN, toolName: "ExitPlanMode", input: { plan: LONG_PLAN, planFilePath: PLAN_PATH } }, "e-small-plan.png"],
  ["sm-q", { t: "permission", requestId: "sm-q", kind: "tool", title: "AskUserQuestion", detail: "", toolName: "AskUserQuestion",
    input: { questions: [{ question: "Which one of these many options?", header: "Pick", multiSelect: false, options: Array.from({ length: 8 }, (_, i) => ({ label: `option ${i + 1}`, description: "a description line for this option" })) }, QS[1]] } }, "e-small-question.png"],
];
for (const [id, e, png] of smallCases) {
  await emit(e, CE);
  await cardUp(id);
  await sleep(400);
  check(`㊴ 작은 타일 ${id} — 단추 줄 보임 · 카드가 대화 칸 안 · 긴 몫이 구른다`, await actionsSeen(id), { actions: true, fits: true, bodyScrolls: true });
  check(`㊴ 작은 타일 ${id} — 단추가 카드 안 · 가로 넘침 없음`, await cardButtons(id).then((x) => [x.inside, x.scroll]), [true, true]);
  await shot(png);
  await clickAt(`document.querySelector('${L} [data-chat-tile-perm="${id}"] ${id === "sm-q" ? "[data-chat-tile-q-decline]" : id === "sm-plan" ? "[data-chat-tile-plan-keep]" : "[data-chat-tile-deny]"}')`);
  check(`㊴ 작은 타일 ${id} — 바로 누를 수 있다(deny)`, (await callsOf("chat_tile_decide")).some((a) => a.requestId === id && a.decision === "deny"), true);
  await resolve(id, "deny", CE);
  await sleep(200);
}
// 작은 타일의 모드 메뉴 — 화면 안
await emit({ t: "turnEnded", turn: "e5", outcome: "ok", message: null }, CE);
await sleep(600);
await openModeMenu();
const menuIn = () => evj(`(() => { const m = document.querySelector('[data-chat-tile-mode-menu]'); if (!m) return 'null'; const r = m.getBoundingClientRect(); return JSON.stringify({ inside: r.left >= 0 && r.right <= innerWidth + 0.5 && r.top >= 0 && r.bottom <= innerHeight + 0.5, rows: m.querySelectorAll('button[data-chat-tile-mode]').length }); })()`);
check("㊴ 작은 타일 — 모드 메뉴가 화면 안", await menuIn(), { inside: true, rows: 3 });
await shot("e-small-mode-menu.png");
await key("Escape");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await ev(`(async () => { const w = await ${W}; w.closePaneIn(${JSON.stringify(spec.tab)}, ${JSON.stringify(spec.id)}); })()`);
await sleep(500);

// ㊵ E4 Codex — Read only · Auto · Plan + 다음 메시지 줄 · 사용자 config 밖이면 Custom 표지
spec = await openChatTile("codex", { permMode: null, cliMode: { mode: "readOnly", choices: CODEX3 } });
const CX = spec.chat.chatId;
check("㊵ E4 Codex 칩 = Read only(중성 면)", await modeChip(), { mode: "readOnly", foreign: "false", text: "Read only", accent: false, disabled: false });
await openModeMenu();
check("㊵ E4 Codex 메뉴 = Read only · Auto · Plan + 다음 메시지부터 줄", [await menuRows(), await ev(`[...document.querySelectorAll('[data-chat-tile-mode-menu] button')].map((b) => b.querySelector('.cmm-word').textContent).join(' · ')`),
  await ev(`document.querySelector('[data-chat-tile-mode-menu] [data-chat-tile-mode-next]')?.textContent.trim() ?? null`), await ev(`!document.querySelector('[data-chat-tile-mode-menu] [data-chat-tile-mode-foreign]')`)],
  [CODEX3, "Read only · Auto · Plan", "다음 메시지부터 적용됩니다", true]);
await shot("e4-mode-menu-codex.png");
c0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-mode-menu] [data-chat-tile-mode="auto"]')`);
await sleep(300);
check("㊵ E4 [Auto] = set_perm_mode{mode:auto}", (await callsOf("chat_tile_set_perm_mode", c0)).map((a) => [keysOf(a), a.chat === CX, a.mode]), [[["chat", "epoch", "mode"], true, "auto"]]);
await emit({ t: "cliMode", mode: "custom", choices: CODEX3 }, CX);
await sleep(200);
check("㊵ E4 Codex custom → Custom (사용자 설정) 표지", await modeChip(), { mode: "custom", foreign: "true", text: "Custom (사용자 설정)", accent: false, disabled: false });
await openModeMenu();
check("㊵ E4 custom 메뉴 — 표지 줄 + 고르는 줄 셋", [await ev(`document.querySelector('[data-chat-tile-mode-menu]').firstElementChild?.dataset.chatTileModeForeign ?? null`), await menuRows()], ["custom", CODEX3]);
await shot("e4-mode-foreign-codex.png");
await key("Escape");
await emit({ t: "cliMode", mode: "auto", choices: CODEX3, chosen: "auto" }, CX);

// ㊶ E9 Codex apply_patch 명령 카드 — diff 가 위 · 실제 명령 전체가 밑 · 늘 허용 없음
const PATCH = "*** Begin Patch\n*** Update File: src/a.ts\n@@\n-const old = 1;\n+const neu = 2;\n*** End Patch";
const PATCH_CMD = `"C:\\Program Files\\PowerShell\\7\\pwsh.exe" -Command '$patch = "*** Begin Patch\`n*** Update File: src/a.ts\`n@@\`n-const old = 1;\`n+const neu = 2;\`n*** End Patch"\n& C:\\codex\\codex.exe --codex-run-as-apply-patch $patch'`;
await emit({ t: "turnStarted", turn: "e9" }, CX);
await emit({ t: "permission", requestId: "pp1", kind: "command", title: "apply_patch", detail: "", toolName: "commandExecution",
  input: { command: PATCH_CMD, cwd: "C:\\src\\proj", reason: "파일을 고칩니다", patch: PATCH, patchKind: "applyPatch", files: ["src/a.ts"] } }, CX);
await cardUp("pp1");
const patchCard = await evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-perm="pp1"]'); const d = c.querySelector('[data-chat-tile-perm-patch]'); const p = c.querySelector('[data-chat-tile-perm-command]');
  return JSON.stringify({ files: c.querySelector('[data-chat-tile-perm-patch-files]')?.textContent.trim() ?? null, rows: [...(d?.querySelectorAll('.row') ?? [])].filter((r) => r.dataset.op === '+' || r.dataset.op === '-').map((r) => r.dataset.op + r.querySelector('.txt').textContent),
    label: c.querySelector('[data-chat-tile-perm-patch-command]')?.textContent.trim() ?? null, below: !!(d && p && (d.compareDocumentPosition(p) & Node.DOCUMENT_POSITION_FOLLOWING)), command: p?.textContent ?? null,
    buttons: [...c.querySelectorAll('[data-chat-tile-perm-actions] button')].map((b) => b.textContent.trim()) }); })()`);
check("㊶ E9 apply_patch 카드 — 파일 · diff 줄 · '실제 명령' 이름표 · 명령 전체가 diff 밑 · 단추 둘", patchCard,
  { files: "src/a.ts", rows: ["-const old = 1;", "+const neu = 2;"], label: "실제 명령", below: true, command: PATCH_CMD, buttons: ["허용", "거절"] });
await shot("e9-patch-command.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="pp1"] [data-chat-tile-allow]')`);
await resolve("pp1", "allow", CX);
await emit({ t: "permission", requestId: "pp2", kind: "fileChange", title: "src/b.ts", detail: "", toolName: "fileChange",
  input: { files: ["src/b.ts"], patch: "--- a/src/b.ts\n+++ b/src/b.ts\n@@ -1,2 +1,2 @@\n keep\n-gone\n+came", patchKind: "unified", reason: "rename" } }, CX);
await cardUp("pp2");
pc = await permCard("pp2");
check("㊶ E9 fileChange(unified) 카드 — diff 줄 · 명령 이름표 없음", [pc.kind, pc.diff.filter((r) => /^[-+ ]/.test(r)), await ev(`!document.querySelector('${L} [data-chat-tile-perm="pp2"] [data-chat-tile-perm-patch-command]')`)],
  ["patch", [" keep", "-gone", "+came"], true]);
await shot("e9-patch-filechange.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="pp2"] [data-chat-tile-deny]')`);
await resolve("pp2", "deny", CX);
// Codex 명령의 늘 허용 = 같은 명령만
await emit({ t: "permission", requestId: "pc1", kind: "command", title: "npm test", detail: "", toolName: "commandExecution", input: { command: "npm test", cwd: "C:\\src\\proj" }, sessionAllow: { kind: "command", detail: "npm test" } }, CX);
await cardUp("pc1");
check("㊶ E5 Codex kind command — 셋째 = 같은 명령은 늘", (await cardButtons("pc1")).buttons, ["허용", "거절", SESSION_LABEL.command]);
await shot("e5-session-command.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-perm-session="command"]')`);
await sleep(300);
check("㊶ E5 Codex 늘 허용 = decide{allowSession} 결정 낱말만", (await callsOf("chat_tile_decide", c0)).map((a) => [keysOf(a).length, a.decision, a.message, a.answers]), [[6, "allowSession", null, null]]);
await resolve("pc1", "allow", CX);
// Codex 질문 — 하나 고르기만 · 직접 쓰기는 isOther 일 때만 · 답 열쇠는 질문 글(서버가 id 로 바꾼다)
await emit({ t: "permission", requestId: "cq1", kind: "tool", title: "request_user_input", detail: "Which env?", toolName: "request_user_input",
  input: { questions: [{ id: "env", header: "Env", question: "Which env?", isOther: true, isSecret: false, options: [{ label: "dev", description: "local" }, { label: "prod", description: "live" }] },
    { id: "go", header: "Go", question: "Proceed?", isOther: false, isSecret: false, options: [{ label: "yes" }, { label: "no" }] }] } }, CX);
await cardUp("cq1");
check("㊶ Codex 질문 — 첫 질문 직접 쓰기 있음(isOther) · radio", [await ev(`!!document.querySelector('${L} [data-chat-tile-q-card="cq1"] [data-chat-tile-q-other]')`),
  await ev(`[...document.querySelectorAll('${L} [data-chat-tile-q-card="cq1"] [data-chat-tile-q-option]')].map((o) => o.getAttribute('role')).join(',')`)], [true, "radio,radio"]);
await ev(`document.querySelector('${L} [data-chat-tile-q-card="cq1"] [data-chat-tile-q-other]').focus()`);
await send("Input.insertText", { text: "staging" });
await shot("e8-codex-question.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-q-next]')`);
check("㊶ Codex 둘째 질문 — isOther 거짓 → 직접 쓰기 없음", await ev(`!document.querySelector('${L} [data-chat-tile-q-card="cq1"] [data-chat-tile-q-other]')`), true);
await clickAt(`document.querySelector('${L} [data-chat-tile-q-option="no"]')`);
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-q-card="cq1"] [data-chat-tile-q-answer]')`);
await sleep(300);
check("㊶ Codex 질문 [답하기] = answers{질문 글: 답}", (await callsOf("chat_tile_decide", c0)).map((a) => [a.decision, a.answers]), [["answer", { "Which env?": "staging", "Proceed?": "no" }]]);
await resolve("cq1", "allow", CX);

// ㊷ E10 Codex 계획 글 덩어리 — 단추 없음 · 끝나면 안내 줄
await emit({ t: "textDelta", item: "i1#plan", text: "## 계획\n\n1. 첫 단계\n" }, CX);
await sleep(300);
const planBlock = () => evj(`(() => { const b = document.querySelector('${L} [data-chat-tile-plan-block]'); return b ? JSON.stringify({ streaming: b.dataset.streaming, h2: b.querySelector('h2')?.textContent.trim() ?? null, buttons: b.querySelectorAll('button').length, hint: !!b.querySelector('[data-chat-tile-plan-hint]'), assistant: [...document.querySelectorAll('${L} [data-item="assistant"]')].some((x) => x.textContent.includes('첫 단계')) }) : 'null'; })()`);
check("㊷ E10 plan delta → 계획 덩어리(흐르는 중 · 안내 없음 · 보통 답 말풍선 아님)", await planBlock(), { streaming: "true", h2: "계획", buttons: 0, hint: false, assistant: false });
await emit({ t: "text", item: "i1#plan", text: "## 계획\n\n1. 첫 단계\n2. 둘째 단계" }, CX);
await sleep(300);
check("㊷ E10 plan 끝 · 모드가 Plan 이 아님 → 안내 줄 없음", await planBlock(), { streaming: "false", h2: "계획", buttons: 0, hint: false, assistant: false });
await emit({ t: "cliMode", mode: "plan", choices: CODEX3, chosen: "plan" }, CX);
await sleep(300);
check("㊷ E10 모드 Plan → 안내 줄 · 단추 없음", await planBlock(), { streaming: "false", h2: "계획", buttons: 0, hint: true, assistant: false });
await shot("e10-codex-plan-block.png");
await emit({ t: "turnEnded", turn: "e9", outcome: "ok", message: null }, CX);
await sleep(600);
check("E 예외 0", errors.slice(), []);
await ev(`(async () => { const w = await ${W}; w.closePaneIn(${JSON.stringify(spec.tab)}, ${JSON.stringify(spec.id)}); })()`);
await sleep(500);
await ev(`(window.__ctSnap = null, 1)`);

// ═══ F. 턴이 끝난 뒤 — 답한 계획 · 늘 허용 흔적 · Codex 계획 · 새 파일 diff · 긴 규칙 · 질문 안내 ═══════════════════
errors.length = 0;
const setRecord = (items) => ev(`(window.__transcript = { items: ${JSON.stringify(items)}, cursor: null }, 1)`);
const nowMs = async () => Number(await ev(`Date.now()`));
const tool = (name, input, output, extra = {}) => ({ name, summary: "", input, inputTruncated: false, output, outputTruncated: false, error: false, ...extra });
const rec = (role, text, at, extra = {}) => ({ role, text, truncated: false, images: 0, tool: null, at, ...extra });
/** 계획 덩어리 읽기 — 꼬리 · 기록 둘 다 */
const planBlocks = () =>
  evj(`JSON.stringify([...document.querySelectorAll('${L} [data-chat-tile-plan-block]')].map((b) => ({ h2: b.querySelector('h2')?.textContent.trim() ?? null, body: b.dataset.hasBody,
    outcome: b.dataset.chatTilePlanOutcome, file: b.querySelector('[data-chat-tile-plan-file]')?.textContent.includes('const-heron.md') ?? false,
    feedback: b.querySelector('[data-chat-tile-plan-feedback-done]')?.textContent.trim() ?? null, hint: !!b.querySelector('[data-chat-tile-plan-hint]'), record: !!b.closest('[data-item="card"]') })))`);

// F1 Claude — 고친 계획을 승인한 턴: 꼬리의 끝난 카드도 · 기록으로 바뀐 뒤에도 사람이 본 글 · 결과가 그 자리에 남는다
spec = await openChatTile("claude", { permMode: "plan", cliMode: { mode: "plan", choices: CLAUDE3 } });
const CF = spec.chat.chatId;
await emit({ t: "ready", cli: "claude", version: "2.1.332", model: "claude-sonnet-5-5", models: [], efforts: {}, conversationId: "3a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d" }, CF);
const F0 = await nowMs();
await emit({ t: "turnStarted", turn: "f1" }, CF);
const PLAN_C = "## const c 추가\n\n1. `const c = 0;` 를 넣는다";
const PLAN_D = "## const d 추가\n\n1. `const d = 0;` 를 넣는다";
const PF = "C:\\Users\\h\\.claude\\plans\\const-heron.md";
await emit({ t: "permission", requestId: "f-p1", kind: "tool", title: "ExitPlanMode", detail: PLAN_C, toolName: "ExitPlanMode", input: { plan: PLAN_C, planFilePath: PF } }, CF);
await cardUp("f-p1");
await ev(`document.querySelector('${L} [data-chat-tile-plan-card="f-p1"] [data-chat-tile-plan-feedback]').focus()`);
await send("Input.insertText", { text: "c 대신 d 로" });
await clickAt(`document.querySelector('${L} [data-chat-tile-plan-card="f-p1"] [data-chat-tile-plan-keep]')`);
await resolve("f-p1", "deny", CF);
await sleep(300);
const F1 = await nowMs();
await sleep(30);
await emit({ t: "permission", requestId: "f-p2", kind: "tool", title: "ExitPlanMode", detail: PLAN_D, toolName: "ExitPlanMode", input: { plan: PLAN_D, planFilePath: PF } }, CF);
await cardUp("f-p2");
await clickAt(`document.querySelector('${L} [data-chat-tile-plan-card="f-p2"] [data-chat-tile-plan-approve]')`);
await resolve("f-p2", "allow", CF);
await sleep(300);
const liveBlocks = [
  { h2: "const c 추가", body: "true", outcome: "kept", file: true, feedback: "고칠 점c 대신 d 로", hint: false, record: false },
  { h2: "const d 추가", body: "true", outcome: "approved", file: true, feedback: null, hint: false, record: false },
];
check("F1 꼬리 — 답한 계획 둘이 그 자리에 계획 덩어리(본 글 · 결과 · 고칠 점)", await planBlocks(), liveBlocks);
// F6 · F4 폴더 밖 읽기의 늘 허용 — 단추 글은 줄이고(끝을 남김) 툴팁은 원래 규칙 · 누른 흔적은 턴 뒤에도
const RULE = "Read(//c/Users/h/AppData/Roaming/aynx-dev/attachments/0ad9a153eab8fe73eb597ca3a5088ff88a99719acb25a0cd93c1e869616b9ac2/**)";
const F2 = await nowMs();
await emit({ t: "permission", requestId: "f-s1", kind: "tool", title: "Read", detail: "", toolName: "Read", input: { file_path: "C:\\Users\\h\\AppData\\Roaming\\aynx-dev\\attachments\\0ad9\\memo.txt" }, sessionAllow: { kind: "rules", detail: RULE } }, CF);
await cardUp("f-s1");
const sessBtn = await evj(`(() => { const b = document.querySelector('${L} [data-chat-tile-perm-session="rules"]'); const r = b.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(b).lineHeight) || 18;
  return JSON.stringify({ text: b.textContent.trim(), title: b.title.split('\\n')[0], lines: Math.round((r.height - 8) / lh) }); })()`);
check("F6 긴 규칙 — 단추 글은 줄임(16진 이름 · 가운데) · 끝(/**)은 남김 · 한두 줄 · 툴팁은 원래 규칙",
  [sessBtn.text.includes("0ad9a153…") && !sessBtn.text.includes("0ad9a153eab8") && sessBtn.text.includes("/**)"), sessBtn.lines <= 2, sessBtn.title.includes(RULE)], [true, true, true]);
await shot("f6-session-rule-short.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-perm-session="rules"]')`);
await sleep(300);
check("F6 누르면 결정 낱말만 — 규칙 글은 싣지 않는다", (await callsOf("chat_tile_decide", c0)).map((a) => [a.decision, a.message, JSON.stringify(a).includes("attachments")]), [["allowSession", null, false]]);
await resolve("f-s1", "allow", CF);
await sleep(300);
check("F4 꼬리에 카드가 있는 동안은 흔적 줄을 겹쳐 그리지 않는다", await ev(`document.querySelectorAll('${L} [data-chat-tile-trace]').length`), 0);
// 기록 — CLI 기록의 계획 줄은 본문을 모르거나(첫 호출 input:{}) 낡은 입력(앞 계획)을 실었다
const F3 = await nowMs();
await setRecord([
  rec("user", "main.ts 에 const c 를 넣는 계획을 세워 줘", F0),
  rec("tool", null, F0 + 1, { tool: tool("ExitPlanMode", null, "c 대신 d 로", { error: true, denied: true }), plan: { file: PF, outcome: "kept", feedback: "c 대신 d 로" } }),
  rec("tool", null, F1 + 1, { tool: tool("ExitPlanMode", '{"plan":"## const c 추가 (낡은 입력)"}', "User has approved your plan."), plan: { file: PF, outcome: "approved" } }),
  rec("tool", null, F2 + 1, { tool: tool("Read", '{"file_path":"memo.txt"}', "attach-test") }),
  rec("assistant", "`main.ts` 에 `const d = 0;` 을 넣었습니다.", F3),
]);
await emit({ t: "turnEnded", turn: "f1", outcome: "ok", message: null }, CF);
await waitFor(`document.querySelectorAll('${L} [data-item="card"] [data-chat-tile-plan-block]').length === 2`, 6000);
await sleep(400);
check("F1 턴 뒤(기록) — 계획 둘이 같은 자리에 사람이 본 글 · 결과 · 고칠 점으로", await planBlocks(),
  liveBlocks.map((b) => ({ ...b, record: true })));
check("F1 턴 뒤 — 낡은 입력 글 · ExitPlanMode 도구 줄이 보이지 않는다", [await ev(`document.querySelector('${L}').textContent.includes('낡은 입력')`), await ev(`document.querySelectorAll('${L} [data-tool="ExitPlanMode"]').length`)], [false, 0]);
const trace = await evj(`(() => { const t = document.querySelector('${L} [data-chat-tile-trace]'); return t ? JSON.stringify({ kind: t.dataset.chatTileTrace, text: t.textContent.trim(), title: t.title, inNote: !!t.closest('[data-item="note"]') }) : 'null'; })()`);
check("F4 턴 뒤 — 늘 허용 흔적 한 줄(무엇을 · 줄인 글 · 툴팁 원래 규칙)", [trace.kind, trace.text.startsWith("이 대화에서 늘 허용함:"), trace.text.includes("/**)"), trace.title.includes(RULE), trace.inNote], ["rules", true, true, true, true]);
await shot("f1-plan-after-turn.png");
await ev(`(async () => { const w = await ${W}; w.closePaneIn(${JSON.stringify(spec.tab)}, ${JSON.stringify(spec.id)}); })()`);
await sleep(500);

// F1b 기록만 있는 대화(다시 연 타일) — 믿을 본문이 없으면 경로 · 결과만 · 흔적은 지어내지 않는다
spec = await openChatTile("claude", { permMode: null, cliMode: { mode: "default", choices: CLAUDE3 } });
const CF2 = spec.chat.chatId;
await emit({ t: "ready", cli: "claude", version: "2.1.332", model: "claude-sonnet-5-5", models: [], efforts: {}, conversationId: "4b2c3d4e-5f60-4b7c-8d9e-0f1a2b3c4d5e" }, CF2);
const G0 = await nowMs();
await setRecord([
  rec("user", "계획", G0 - 5000),
  rec("tool", null, G0 - 4000, { tool: tool("ExitPlanMode", null, "c 대신 d 로", { error: true, denied: true }), plan: { file: PF, outcome: "kept", feedback: "c 대신 d 로" } }),
  rec("tool", null, G0 - 3000, { tool: tool("ExitPlanMode", '{"plan":"## 낡은 입력"}', "User has approved your plan."), plan: { body: "## 승인된 계획\n\n1. d", file: PF, outcome: "approved" } }),
  rec("tool", null, G0 - 2000, { tool: tool("Read", '{"file_path":"memo.txt"}', "x") }),
]);
await emit({ t: "turnStarted", turn: "g1" }, CF2);
await emit({ t: "turnEnded", turn: "g1", outcome: "ok", message: null }, CF2);
await waitFor(`document.querySelectorAll('${L} [data-item="card"] [data-chat-tile-plan-block]').length === 2`, 6000);
await sleep(300);
check("F1b 기록만 — 본문 없는 계획은 경로 · 결과 · 고칠 점만 · 승인 본문은 기록의 승인 글 · 낡은 입력 없음 · 흔적 없음",
  [await planBlocks(), await ev(`document.querySelector('${L}').textContent.includes('낡은 입력')`), await ev(`document.querySelectorAll('${L} [data-chat-tile-trace]').length`)],
  [[{ h2: null, body: "false", outcome: "kept", file: true, feedback: "고칠 점c 대신 d 로", hint: false, record: true },
    { h2: "승인된 계획", body: "true", outcome: "approved", file: true, feedback: null, hint: false, record: true }], false, 0]);
await shot("f1b-plan-record-only.png");
await ev(`(async () => { const w = await ${W}; w.closePaneIn(${JSON.stringify(spec.tab)}, ${JSON.stringify(spec.id)}); })()`);
await sleep(500);

// F2 Codex 계획 — 턴 뒤 · 기록에서도 계획 덩어리 · 안내 줄은 지금 Plan 일 때 마지막 덩어리에만
spec = await openChatTile("codex", { permMode: "plan", cliMode: { mode: "plan", choices: CODEX3 } });
const CXF = spec.chat.chatId;
await emit({ t: "ready", cli: "codex", version: "0.172.0", model: "gpt-6.2-astra", models: [], efforts: {}, conversationId: "01a21e84-57cc-76a1-8a1a-a12687c1e036" }, CXF);
const H0 = await nowMs();
await emit({ t: "turnStarted", turn: "h1" }, CXF);
await emit({ t: "textDelta", item: "h1#plan", text: "## 둘째 계획\n\n1. 맨 아래에 넣는다" }, CXF);
await emit({ t: "text", item: "h1#plan", text: "## 둘째 계획\n\n1. 맨 아래에 넣는다" }, CXF);
await sleep(300);
check("F2 꼬리 — 계획 덩어리 · Plan 이라 안내 줄", await planBlocks(), [{ h2: "둘째 계획", body: "true", outcome: "", file: false, feedback: null, hint: true, record: false }]);
await setRecord([
  rec("user", "계획 세워", H0 - 9000),
  rec("assistant", "## 첫 계획\n\n1. 맨 위에 넣는다", H0 - 8000, { plan: {} }),
  rec("user", "다시", H0 - 1000),
  rec("assistant", "## 둘째 계획\n\n1. 맨 아래에 넣는다", H0 + 10, { plan: {} }),
]);
await emit({ t: "turnEnded", turn: "h1", outcome: "ok", message: null }, CXF);
await waitFor(`document.querySelectorAll('${L} [data-item="card"] [data-chat-tile-plan-block]').length === 2`, 6000);
await sleep(600);
const codexAfter = [
  { h2: "첫 계획", body: "true", outcome: "", file: false, feedback: null, hint: false, record: true },
  { h2: "둘째 계획", body: "true", outcome: "", file: false, feedback: null, hint: true, record: true },
];
check("F2 턴 뒤(기록) — 보통 답 말풍선이 아니라 계획 덩어리 · 안내 줄은 마지막 덩어리 하나", [await planBlocks(), await ev(`[...document.querySelectorAll('${L} [data-item="assistant"]')].some((x) => x.textContent.includes('계획'))`)], [codexAfter, false]);
await shot("f2-codex-plan-after-turn.png");
await emit({ t: "cliMode", mode: "auto", choices: CODEX3, chosen: "auto" }, CXF);
await sleep(300);
check("F2 모드를 Auto 로 → 안내 줄 없음(덩어리는 그대로)", (await planBlocks()).map((b) => [b.h2, b.hint]), [["첫 계획", false], ["둘째 계획", false]]);

// F3 Codex 새 파일 승인 카드 — 모든 줄 + · 경로는 머리에 한 번 · 긴 줄은 감싼다(가로 스크롤 없음)
const NEW_PATH = "C:\\Users\\h\\AppData\\Local\\Temp\\proj\\x2.txt";
const LONG_LINE = "two " + "long-content-".repeat(30);
await emit({ t: "turnStarted", turn: "h2" }, CXF);
await emit({ t: "permission", requestId: "f-new", kind: "fileChange", title: NEW_PATH, detail: "", toolName: "fileChange",
  input: { files: [NEW_PATH], patch: `@@ -0,0 +1,2 @@\n+two\n+${LONG_LINE}\n`, patchKind: "unified" } }, CXF);
await cardUp("f-new");
const newCard = await evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-perm="f-new"]'); const d = c.querySelector('[data-chat-tile-perm-diff]');
  const rows = [...d.querySelectorAll('.row')];
  return JSON.stringify({ files: c.querySelector('[data-chat-tile-perm-patch-files]')?.textContent.trim() ?? null, ops: rows.map((r) => r.dataset.op),
    pathRow: rows.some((r) => r.textContent.includes('x2.txt')), hscroll: d.scrollWidth > d.clientWidth + 1, wrapped: rows[2].getBoundingClientRect().height > rows[1].getBoundingClientRect().height * 1.5,
    green: getComputedStyle(rows[1]).backgroundColor !== 'rgba(0, 0, 0, 0)' }); })()`);
check("F3 새 파일 — 머리에 경로 한 번 · 줄은 hunk 뒤 모두 + · 경로 줄 없음 · 가로 스크롤 없음 · 긴 줄 감쌈 · 더한 줄 색",
  newCard, { files: NEW_PATH, ops: ["hunk", "+", "+"], pathRow: false, hscroll: false, wrapped: true, green: true });
await shot("f3-codex-new-file.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="f-new"] [data-chat-tile-deny]')`);
await resolve("f-new", "deny", CXF);
await emit({ t: "turnEnded", turn: "h2", outcome: "ok", message: null }, CXF);
await sleep(600);
await ev(`(async () => { const w = await ${W}; w.closePaneIn(${JSON.stringify(spec.tab)}, ${JSON.stringify(spec.id)}); })()`);
await sleep(500);

// F7 질문 카드 — 하나뿐인 질문도 왜 [답하기]가 흐린지 · 낮은 타일에서 선택지가 더 보인다
spec = await openChatTile("claude", { permMode: null, cliMode: { mode: "default", choices: CLAUDE3 } });
const CQ = spec.chat.chatId;
const Q4 = { question: "동, 서, 남, 북 중 하나를 골라 주세요.", header: "방향 선택", multiSelect: false,
  options: ["동", "서", "남", "북"].map((label) => ({ label, description: `${label}쪽 방향입니다 — 한 줄 설명이 조금 길게 이어집니다` })) };
await emit({ t: "turnStarted", turn: "q1" }, CQ);
await emit({ t: "permission", requestId: "f-q1", kind: "tool", title: "AskUserQuestion", detail: Q4.question, toolName: "AskUserQuestion", input: { questions: [Q4] } }, CQ);
await cardUp("f-q1");
const qState = () => evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-q-card="f-q1"]'); return JSON.stringify({ missing: c.querySelector('[data-chat-tile-q-missing]')?.textContent.trim() ?? null, answer: c.querySelector('[data-chat-tile-q-answer]').disabled }); })()`);
check("F7a 하나뿐인 질문 — 고르기 전 [답하기] 흐림 + 이유 줄", await qState(), { missing: "1번 질문에 답해 주세요", answer: true });
await clickAt(`document.querySelector('${L} [data-chat-tile-q-option="북"]')`);
check("F7a 고르면 이유 줄 걷힘 · [답하기] 켜짐", await qState(), { missing: null, answer: false });
// 낮은 타일 — 위아래로 나눈 타일의 높이(창 400)
await send("Emulation.setDeviceMetricsOverride", { width: 1000, height: 400, deviceScaleFactor: 1, mobile: false });
await sleep(700);
const qSmall = await evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-q-card="f-q1"]'); const b = c.querySelector('[data-chat-tile-perm-body]').getBoundingClientRect();
  const seen = [...c.querySelectorAll('[data-chat-tile-q-option]')].filter((o) => { const r = o.getBoundingClientRect(); return r.top >= b.top - 0.5 && r.bottom <= b.bottom + 0.5; }).length;
  return JSON.stringify({ tight: c.hasAttribute('data-tight'), seen }); })()`);
check("F7b 낮은 타일 — 촘촘한 꼴 · 선택지가 둘 넘게 보인다 · 단추 줄 보임", [qSmall.tight, qSmall.seen >= 3, (await actionsSeen("f-q1")).actions], [true, true, true]);
await shot("f7-question-small.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await clickAt(`document.querySelector('${L} [data-chat-tile-q-card="f-q1"] [data-chat-tile-q-decline]')`);
await resolve("f-q1", "deny", CQ);
await emit({ t: "turnEnded", turn: "q1", outcome: "ok", message: null }, CQ);
await sleep(500);
check("F 예외 0", errors.slice(), []);
await ev(`(async () => { const w = await ${W}; w.closePaneIn(${JSON.stringify(spec.tab)}, ${JSON.stringify(spec.id)}); })()`);
await sleep(500);
await ev(`(window.__ctSnap = null, 1)`);

// ═══ B. 원격 창 — 거울로 선 채팅 잎 · 명세를 쓰지 않는다 ═══════════════════════════════════
const pushMirror = (pane) =>
  ev(`(async () => {
    const s = await ${importApp("mirror/snapshot")};
    const tab = { id: 'home-tab', title: 'c', tabKey: 'tk', workspaceId: 'w1', root: { type: 'leaf', pane: ${JSON.stringify(pane)} } };
    window.__emit('mirror-layout', s.buildSnapshot({ source: 'home', workspace: { id: 'w1', name: 'W' }, tabs: [tab], activeTabId: 'home-tab', focusOf: () => 'home-1' }));
  })()`);
const MIRROR_PANE = { id: "home-1", kind: "chat", tileKey: "ck", chat: { chatId: CHAT, cli: "codex", model: "", effort: "", cwd: "C:/src/proj" } };
LABEL = "remote-h-1";
subGenNow = 1;
await bootPage({ remote: true, width: 1280, height: 860 });
errors.length = 0;
await pushMirror(MIRROR_PANE);
check("⑪ 원격 창 — 거울의 채팅 잎이 선다 · subscribe(open 없음)", [await waitFor(`!!document.querySelector('${L} [data-chat-tile-face]')`, 6000),
  await waitFor(`window.__calls.some(([c]) => c === 'chat_tile_subscribe')`, 4000), (await callsOf("chat_tile_open")).length], [true, true, 0]);
await emit({ t: "ready", cli: "codex", version: "0.80.0", model: "gpt-6-sol", models: [], efforts: {}, conversationId: CONV }, CHAT);
await emit({ t: "turnStarted", turn: "r1" }, CHAT);
await emit({ t: "userAccepted", clientId: "c-remote", text: "메인 PC 에서 보낸 말" }, CHAT);
await emit({ t: "permission", requestId: "q1", kind: "command", title: "npm test", detail: "npm test", toolName: "commandExecution" }, CHAT);
await sleep(500);
spec = await chatSpec();
check("⑪ 원격 — 다른 창이 보낸 사람 말풍선 · Codex 명령 카드 · 명세에 conv 안 씀",
  [await ev(`document.querySelector('${L}').textContent.includes('메인 PC 에서 보낸 말')`), await ev(`document.querySelector('${L} [data-chat-tile-perm="q1"]')?.dataset.chatTilePermKind ?? null`), "conv" in (spec?.chat ?? {})],
  [true, "command", false]);
hs = await headShape();
check("H5 원격 창 — 카드가 떠 있어도 [중지]는 머리줄(⋯ 앞) · 안내 줄에는 없음 · 띠 없음",
  [hs?.stop, hs?.stopShown, hs?.stopBeforeMore, await ev(`!document.querySelector('${L} [data-chat-tile-held] ${STOP}')`), await ev(`!document.querySelector('[data-chat-tile-bar]')`)], [true, true, true, true, true]);
await shot("chat-tile-remote.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-deny]')`);
await sleep(300);
check("⑪ 원격 [거절] = decide{deny}", (await callsOf("chat_tile_decide", c0)).map((a) => a.decision), ["deny"]);
await emit({ t: "permissionResolved", requestId: "q1", decision: "deny", by: "human" }, CHAT);
await emit({ t: "turnEnded", turn: "r1", outcome: "ok", message: null }, CHAT);
await sleep(600);

// ⑮ Codex 명령 카드 — 실제 명령 전체(줄바꿈 · 잘림 없음) · 폴더 · 에이전트의 이유는 따로
const CMD = "Set-Content -LiteralPath 'note-codex.txt' -Value 'hello' -Encoding ascii -ErrorAction Stop\n[System.IO.File]::ReadAllText((Resolve-Path 'note-codex.txt').Path) -ceq \"hello`r`n\"";
const REASON = "현재 폴더가 읽기 전용으로 설정되어 있습니다. 요청하신 note-codex.txt 파일 쓰기를 허용하시겠어요?";
const PARTIAL = "쓰기 권한이 거절되어 다른 방법을 찾아보겠습니다. 먼저 폴더 권한을";
await emit({ t: "turnStarted", turn: "r2" }, CHAT);
await emit({ t: "userAccepted", clientId: "c-r2", text: "note-codex.txt 를 만들어 줘" }, CHAT);
await emit({ t: "toolStarted", item: "cmd1", name: "command", summary: "Set-Content -LiteralPath 'note-codex.txt' -Value 'hello' -Encoding ascii -ErrorAction Stop [System.IO.File]::Rea…", input: null }, CHAT);
await emit({ t: "permission", requestId: "q2", kind: "command", title: "Set-Content -LiteralPath 'note-codex.txt' -Val…", detail: `${REASON}\nC:\\repo`, toolName: "commandExecution",
  input: { command: CMD, cwd: "C:\\repo", reason: REASON } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="q2"]')`, 3000);
await sleep(300);
pc = await permCard("q2");
check("⑮ Codex 명령 카드 — 명령 전체 · 폴더 · 이유(따로) · 서버 글 칸 없음 · 단추 둘 · 타일 안 · 줄바꿈",
  [pc.kind, pc.command, pc.cwd, pc.reason, pc.text, pc.buttons, pc.inside, pc.wrap],
  ["command", CMD, "폴더C:\\repo", `에이전트가 밝힌 이유${REASON}`, null, ["허용", "거절"], true, true]);
await shot("chat-tile-codex-command.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="q2"] [data-chat-tile-deny]')`);
await sleep(300);
check("⑮ [거절] = decide{deny}", (await callsOf("chat_tile_decide", c0)).map((a) => [a.requestId, a.decision]), [["q2", "deny"]]);
await emit({ t: "permissionResolved", requestId: "q2", decision: "deny", by: "human" }, CHAT);
await emit({ t: "toolFinished", item: "cmd1", ok: false, output: null }, CHAT);
await emit({ t: "textDelta", item: "m2", text: PARTIAL }, CHAT);
await sleep(300);
const liveCmdRow = await ev(`[...document.querySelectorAll('${L} [data-item="tool"] [data-tool]')].map((b) => b.dataset.tool).find((n) => n === 'command') ?? null`);
await shot("chat-tile-codex-before-end.png");

// ⑯ Codex 꼴 턴 끝([중지]) — 롤아웃에는 부분 답이 없고 도구는 코드 모드 기록에서 읽은 명령 줄 · 거절 표지
// 기록 줄은 Rust 기록 읽기의 꼴 그대로 — `exec_command` 는 실시간 줄처럼 `command` · 줄을 이은 명령(120자)
const REC_SUM = (() => { const j = CMD.trim().split(/\s+/).join(" "); return [...j].length > 120 ? [...j].slice(0, 120).join("").trimEnd() + "…" : j; })();
await ev(`(window.__transcript = { items: [
  { role: 'user', text: '메인 PC 에서 보낸 말', truncated: false, images: 0, tool: null, at: Date.now() - 9000 },
  { role: 'user', text: 'note-codex.txt 를 만들어 줘', truncated: false, images: 0, tool: null, at: Date.now() - 5000 },
  { role: 'tool', text: null, truncated: false, images: 0, at: Date.now() - 4000, tool: { name: 'command', summary: ${JSON.stringify(REC_SUM)},
    input: ${JSON.stringify(JSON.stringify({ cmd: CMD, workdir: "C:\\repo" }, null, 2))}, inputTruncated: false, output: 'Script error: rejected by user', outputTruncated: false, error: true, denied: true } },
  { role: 'interrupted', text: null, truncated: false, images: 0, tool: null, at: Date.now() - 3000 },
], cursor: null }, 1)`);
await emit({ t: "turnEnded", turn: "r2", outcome: "interrupted", message: null }, CHAT);
await sleep(1500);
const endState = await evj(`(() => { const r = document.querySelector('${L}'); const tool = [...r.querySelectorAll('[data-item="tool"]')].find((x) => x.textContent.includes('Set-Content'));
  return JSON.stringify({ partial: r.textContent.includes(${JSON.stringify(PARTIAL)}), tool: !!tool, denied: !!tool?.querySelector('[data-tool-denied]'), raw: r.textContent.includes('tools.exec_command'),
    interrupted: !!r.querySelector('[data-item="interrupted"]') || r.textContent.includes('중단'), card: !!r.querySelector('[data-chat-tile-perm="q2"]'),
    name: tool?.querySelector('[data-tool]')?.dataset.tool ?? null, second: tool?.querySelector('.tsum')?.textContent.includes('[System.IO.File]') ?? false }); })()`);
check("⑯ 턴 끝 — 흘러나온 글 그대로 · 명령 줄(코드 조각 아님) · 거절됨 · 중단 표식",
  [endState.partial, endState.tool, endState.denied, endState.raw, endState.interrupted], [true, true, true, false, true]);
check("㉚ Codex 명령 줄 — 실시간 · 기록 모두 이름 command · 기록 줄도 둘째 줄까지", [liveCmdRow, endState.name, endState.second], ["command", "command", true]);
await shot("chat-tile-codex-turn-end.png");

// ⑰ Codex MCP 카드 — CLI 의 영어 물음 글 대신 서버 · 도구 · 인자
await emit({ t: "turnStarted", turn: "r3" }, CHAT);
await emit({ t: "permission", requestId: "q3", kind: "mcpTool", title: "aynx-sessions-dev · list_sessions", detail: 'Allow the aynx-sessions-dev MCP server to run tool "list_sessions"?',
  toolName: "mcp__aynx-sessions-dev__list_sessions", input: { server: "aynx-sessions-dev", tool: "list_sessions", arguments: { scope: "all", limit: 5 } } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="q3"]')`, 3000);
await sleep(300);
pc = await permCard("q3");
check("⑰ Codex MCP 카드 — 서버 · 도구 · 인자 · 영어 물음 글 없음 · 타일 안",
  [pc.kind, pc.server, pc.tool, pc.args?.includes('"limit": 5'), await ev(`document.querySelector('${L} [data-chat-tile-perm="q3"]').textContent.includes('Allow the')`), pc.inside],
  ["mcp", "서버aynx-sessions-dev", "도구list_sessions", true, false, true]);
await shot("chat-tile-codex-mcp.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-perm="q3"] [data-chat-tile-allow]')`);
await emit({ t: "permissionResolved", requestId: "q3", decision: "allow", by: "human" }, CHAT);
await emit({ t: "turnEnded", turn: "r3", outcome: "ok", message: null }, CHAT);
await sleep(500);

// ㊸ E11 원격 창 — 칩이 돈다 · 명세에 permMode 를 쓰지 않는다
await emit({ t: "cliMode", mode: "readOnly", choices: CODEX3 }, CHAT);
await sleep(300);
check("㊸ E11 원격 — 칩 Read only", (await modeChip()).text, "Read only");
await openModeMenu();
c0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-mode-menu] [data-chat-tile-mode="plan"]')`);
await sleep(300);
check("㊸ E11 원격 — [Plan] = set_perm_mode{chat, epoch, mode:plan}", (await callsOf("chat_tile_set_perm_mode", c0)).map((a) => [keysOf(a), a.chat === CHAT, a.mode]), [[["chat", "epoch", "mode"], true, "plan"]]);
await emit({ t: "cliMode", mode: "plan", choices: CODEX3, chosen: "plan" }, CHAT);
await sleep(300);
spec = await chatSpec();
check("㊸ E11 원격 — 칩 Plan · 명세에 permMode 없음", [(await modeChip()).text, "permMode" in (spec?.chat ?? {})], ["Plan", false]);
await shot("e11-remote-mode.png");
check("B 예외 0", errors.slice(), []);

// ═══ C. 폰 폭 400 ═══════════════════════════════════════════════════════════════════
await bootPage({ remote: true, width: 400, height: 844, mobile: true });
errors.length = 0;
await pushMirror(MIRROR_PANE);
const phoneUp = await waitFor(`!!document.querySelector('${L} [data-chat-tile-face]')`, 8000);
check("⑫ 폰 — 채팅 잎", phoneUp, true);
await emit({ t: "turnStarted", turn: "m1" }, CHAT);
await emit({ t: "textDelta", item: "m", text: "폰에서도 보입니다" }, CHAT);
await sleep(500);
const fit = await evj(`(() => { const f = document.querySelector('${L} [data-chat-tile-face]'); const c = document.querySelector('${L} [data-flip-composer] .wrap'); if (!f || !c) return 'null';
  const F = f.getBoundingClientRect(), C = c.getBoundingClientRect(); return JSON.stringify({ face: F.left >= -0.5 && F.right <= innerWidth + 0.5, composer: C.left >= 0 && C.right <= innerWidth + 0.5 && C.bottom <= innerHeight + 0.5 && C.height > 0,
    scroll: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
check("⑫ 폰 — 잎 · 입력 칸이 화면 안 · 가로 넘침 없음", fit, { face: true, composer: true, scroll: true });
check("⑫ 폰 — 터미널 키 띠 숨김(대화 면과 같게)", await ev(`(() => { const k = document.querySelector('.mobile-keys'); return k ? getComputedStyle(k).display : 'missing'; })()`), "none");
await shot("chat-tile-phone.png");
// ⑱ 폰 — 명령 · MCP 카드가 화면 안(명령은 줄바꿈 · 가로 넘침 없음)
await emit({ t: "permission", requestId: "m-cmd", kind: "command", title: "Set-Content …", detail: "", toolName: "commandExecution",
  input: { command: CMD + " | Out-File -FilePath C:\\repo\\very\\long\\path\\that\\keeps\\going\\and\\going\\log.txt", cwd: "C:\\repo", reason: REASON } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="m-cmd"]')`, 3000);
await sleep(400);
const phoneCard = async (id) => evj(`(() => { const c = document.querySelector('[data-chat-tile-perm="${id}"]'); const R = c.getBoundingClientRect(); const pre = c.querySelector('pre');
  return JSON.stringify({ inside: R.left >= -0.5 && R.right <= innerWidth + 0.5, wrap: !pre || pre.scrollWidth <= pre.clientWidth + 1, scroll: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
check("⑱ 폰 — 명령 카드 화면 안 · 줄바꿈", await phoneCard("m-cmd"), { inside: true, wrap: true, scroll: true });
// H6 폰 — 머리줄이 없어 입력 칸이 물러난 동안 [중지]는 안내 줄에 · 누르기 좋은 크기 · 누르면 끊는다
const heldStop = await evj(`(() => { const s = document.querySelector('${L} [data-chat-tile-held] ${STOP}'); if (!s) return 'null'; const S = s.getBoundingClientRect();
  return JSON.stringify({ n: document.querySelectorAll('${STOP}').length, head: !!${CT_HEAD}, inside: S.left >= -0.5 && S.right <= innerWidth + 0.5 && S.bottom <= innerHeight + 0.5, tall: S.height >= 36, text: s.textContent.trim(), label: s.getAttribute('aria-label') }); })()`);
check("H6 폰 — 머리줄 없음 · [중지]는 안내 줄에 하나 · 화면 안 · ≥ 36px · 글", heldStop, { n: 1, head: false, inside: true, tall: true, text: "중지", label: "중지" });
await shot("h6-phone-held-stop.png");
c0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-held] ${STOP}')`);
await sleep(300);
check("H6 폰 — 안내 줄 [중지] = chat_tile_interrupt 하나", (await callsOf("chat_tile_interrupt", c0)).map((a) => a.chat === CHAT), [true]);
check("㉘ 폰 — 명령 카드의 단추 줄이 굴리지 않아도 보임 · 카드가 대화 칸 안", await actionsSeen("m-cmd").then((x) => [x.actions, x.fits]), [true, true]);
await shot("chat-tile-phone-command-actions.png");
await ev(`document.querySelector('[data-chat-tile-perm="m-cmd"]').scrollIntoView({ block: 'center' })`);
await sleep(300);
await shot("chat-tile-phone-command.png");
await emit({ t: "permissionResolved", requestId: "m-cmd", decision: "deny", by: "human" }, CHAT);
await emit({ t: "permission", requestId: "m-mcp", kind: "mcpTool", title: "aynx-sessions-dev · list_sessions", detail: "", toolName: "mcp__aynx-sessions-dev__list_sessions",
  input: { server: "aynx-sessions-dev", tool: "list_sessions", arguments: { scope: "all", note: "a fairly long argument value that should wrap inside the card on a phone" } } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="m-mcp"]')`, 3000);
await sleep(400);
check("⑱ 폰 — MCP 카드 화면 안", await phoneCard("m-mcp"), { inside: true, wrap: true, scroll: true });
await ev(`document.querySelector('[data-chat-tile-perm="m-mcp"]').scrollIntoView({ block: 'center' })`);
await sleep(300);
await shot("chat-tile-phone-mcp.png");
await emit({ t: "permissionResolved", requestId: "m-mcp", decision: "deny", by: "human" }, CHAT);
await sleep(300);

// ㊹ E13 폰 — 모드 칩 · 메뉴가 화면 안 · 질문 · 패치 카드도 화면 안 · 단추 줄이 보인다
await emit({ t: "cliMode", mode: "readOnly", choices: CODEX3 }, CHAT);
await sleep(300);
check("㊹ E13 폰 — 칩이 입력 칸 안", await ev(`(() => { const c = document.querySelector('${L} [data-chat-tile-mode-chip]'); const w = document.querySelector('${L} [data-flip-composer] .wrap'); if (!c || !w) return false; const C = c.getBoundingClientRect(), W2 = w.getBoundingClientRect(); return C.left >= W2.left && C.right <= W2.right && C.bottom <= W2.bottom; })()`), true);
await openModeMenu();
check("㊹ E13 폰 — 모드 메뉴가 화면 안 · 줄 셋", await menuIn(), { inside: true, rows: 3 });
await shot("e13-phone-mode-menu.png");
await key("Escape");
await emit({ t: "permission", requestId: "m-q", kind: "tool", title: "request_user_input", detail: "", toolName: "request_user_input",
  input: { questions: [{ id: "env", header: "Env", question: "Which environment should this deploy go to?", isOther: true, isSecret: false, options: [{ label: "dev", description: "local machine" }, { label: "staging", description: "shared test server" }, { label: "prod", description: "live" }] }] } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="m-q"]')`, 3000);
await sleep(400);
check("㊹ E13 폰 — 질문 카드 화면 안 · 단추 줄 보임", [await phoneCard("m-q"), await actionsSeen("m-q").then((x) => [x.actions, x.fits])], [{ inside: true, wrap: true, scroll: true }, [true, true]]);
await shot("e13-phone-question.png");
await emit({ t: "permissionResolved", requestId: "m-q", decision: "deny", by: "human" }, CHAT);
await emit({ t: "permission", requestId: "m-patch", kind: "command", title: "apply_patch", detail: "", toolName: "commandExecution",
  input: { command: PATCH_CMD, cwd: "C:\\src\\proj", patch: PATCH, patchKind: "applyPatch", files: ["src/a.ts"] } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="m-patch"]')`, 3000);
await sleep(400);
check("㊹ E13 폰 — 패치 카드 화면 안 · 단추가 카드 안 · 단추 줄 보임", [await phoneCard("m-patch"), (await cardButtons("m-patch")).inside, await actionsSeen("m-patch").then((x) => x.actions)], [{ inside: true, wrap: true, scroll: true }, true, true]);
await shot("e13-phone-patch.png");
await emit({ t: "permissionResolved", requestId: "m-patch", decision: "deny", by: "human" }, CHAT);
await emit({ t: "permission", requestId: "m-sess", kind: "command", title: "npm run check", detail: "", toolName: "commandExecution",
  input: { command: "npm run check && npm test", cwd: "C:\\src\\proj" }, sessionAllow: { kind: "command", detail: "npm run check && npm test" } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="m-sess"]')`, 3000);
await sleep(400);
check("㊹ E13 폰 — 늘 허용 카드 단추 셋이 카드 안 · 화면 안", [await cardButtons("m-sess"), await actionsSeen("m-sess").then((x) => x.actions)],
  [{ buttons: ["허용", "거절", SESSION_LABEL.command], inside: true, scroll: true }, true]);
await shot("e13-phone-session.png");
await emit({ t: "permissionResolved", requestId: "m-sess", decision: "deny", by: "human" }, CHAT);
// F 폰 — 새 파일 diff · 긴 규칙 단추 · 답한 계획 덩어리가 화면 안(가로 넘침 없음)
await emit({ t: "permission", requestId: "m-new", kind: "fileChange", title: "x2.txt", detail: "", toolName: "fileChange",
  input: { files: ["C:\\Users\\h\\AppData\\Local\\Temp\\proj\\x2.txt"], patch: `@@ -0,0 +1,2 @@\n+two\n+${"long-content-".repeat(20)}\n`, patchKind: "unified" },
  sessionAllow: { kind: "rules", detail: "Read(//c/Users/h/AppData/Roaming/aynx-dev/attachments/0ad9a153eab8fe73eb597ca3a5088ff88a99719acb25a0cd93c1e869616b9ac2/**)" } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="m-new"]')`, 3000);
await sleep(500);
check("F 폰 — 새 파일 카드 화면 안 · diff 가로 스크롤 없음 · 단추가 카드 안",
  [await phoneCard("m-new"), await ev(`(() => { const d = document.querySelector('${L} [data-chat-tile-perm="m-new"] [data-chat-tile-perm-diff]'); return d.scrollWidth <= d.clientWidth + 1; })()`), (await cardButtons("m-new")).inside],
  [{ inside: true, wrap: true, scroll: true }, true, true]);
await shot("f-phone-new-file.png");
await emit({ t: "permissionResolved", requestId: "m-new", decision: "deny", by: "human" }, CHAT);
await emit({ t: "permission", requestId: "m-plan", kind: "tool", title: "ExitPlanMode", detail: "## 계획\n\n1. `const d = 0;`", toolName: "ExitPlanMode", input: { plan: "## 계획\n\n1. `const d = 0;`", planFilePath: "C:\\Users\\h\\.claude\\plans\\a-very-long-plan-file-name-for-the-phone-width-check.md" } }, CHAT);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="m-plan"]')`, 3000);
await emit({ t: "permissionResolved", requestId: "m-plan", decision: "allow", by: "human" }, CHAT);
await sleep(400);
check("F 폰 — 답한 계획 덩어리 화면 안 · 결과 글", [await phoneCard("m-plan"), await ev(`document.querySelector('${L} [data-chat-tile-perm="m-plan"] [data-chat-tile-plan-block]')?.dataset.chatTilePlanOutcome ?? null`)],
  [{ inside: true, wrap: true, scroll: true }, "approved"]);
await shot("f-phone-plan-done.png");

if (errors.length) console.log("ERRORS\n  " + errors.join("\n  "));
check("⑫ 잡히지 않은 예외 · 콘솔 오류 0", errors.length, 0);

// ═══ G. `/` 메뉴 · 맥락 사용량 · 압축(4 · 5단계 — docs/log/2026-11-28-chat-tile-stage4-5-contract.md 7절 S1–S15) ════════════
LABEL = "main";
subGenNow = 1;
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;
const GVK = { Escape: 27, Enter: 13, Tab: 9, ArrowDown: 40, ArrowUp: 38, ArrowRight: 39 };
const press = async (code, modifiers = 0) => {
  const vk = GVK[code] ?? 0;
  await send("Input.dispatchKeyEvent", { type: "keyDown", code, key: code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await send("Input.dispatchKeyEvent", { type: "keyUp", code, key: code, modifiers, windowsVirtualKeyCode: vk, nativeVirtualKeyCode: vk });
  await sleep(220);
};
const FIELD = `document.querySelector('${L} [data-flip-input]')`;
/** 칸을 통째로 바꾼다(지우기 · 붙여 넣기 흉내) — 안의 `bind:value` 가 받도록 input 사건까지 */
const setField = (text) =>
  ev(`(() => { const el = ${FIELD}; el.focus(); el.value = ${JSON.stringify(text)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.setSelectionRange(el.value.length, el.value.length); return el.value; })()`);
const typeIn = async (text) => {
  await ev(`${FIELD}.focus()`);
  await send("Input.insertText", { text });
  await sleep(250);
};
const fieldState = () => evj(`(() => { const el = ${FIELD}; return JSON.stringify({ value: el.value, caret: el.selectionStart, focus: document.activeElement === el }); })()`);
const slashMenu = () =>
  evj(`(() => { const m = document.querySelector('[data-chat-tile-slash-menu]'); if (!m) return 'null'; const rows = [...m.querySelectorAll('[role="option"]')];
    return JSON.stringify({ rows: rows.map((r) => r.dataset.chatTileSlash), sel: rows.find((r) => r.getAttribute('aria-selected') === 'true')?.dataset.chatTileSlash ?? null,
      off: rows.filter((r) => r.getAttribute('aria-disabled') === 'true').map((r) => r.dataset.chatTileSlash), groups: [...m.querySelectorAll('[data-chat-tile-slash-group]')].map((g) => g.dataset.chatTileSlashGroup),
      labels: rows.map((r) => r.querySelector('.csm-name')?.textContent.trim()), pending: !!m.querySelector('[data-chat-tile-slash-pending]'), empty: !!m.querySelector('[data-chat-tile-slash-empty]'),
      descs: Object.fromEntries(rows.map((r) => [r.dataset.chatTileSlash, r.querySelector('.csm-desc')?.textContent.trim() ?? ''])), more: m.querySelector('[data-chat-tile-slash-more]')?.textContent.trim() ?? null }); })()`);
/** 메뉴가 그 타일 몸 안 — 위 끝(탭 띠 · 옆 타일)을 넘지 않고 입력 칸 상자 위 · 보이는 줄 셋 이상 */
const slashInTile = () =>
  evj(`(() => { const m = document.querySelector('[data-chat-tile-slash-menu]'); const f = document.querySelector('${L} [data-chat-tile-face]'); const w = document.querySelector('${L} [data-flip-composer] .wrap'); if (!m || !f || !w) return 'null';
    const M = m.getBoundingClientRect(), F = f.getBoundingClientRect(), W2 = w.getBoundingClientRect(); const s = m.querySelector('[role="listbox"]');
    const vis = [...m.querySelectorAll('[role="option"]')].filter((r) => { const R = r.getBoundingClientRect(); const S = s.getBoundingClientRect(); return R.top >= S.top - 0.5 && R.bottom <= S.bottom + 0.5; }).length;
    return JSON.stringify({ inTile: M.top >= F.top - 0.5 && M.left >= F.left - 0.5 && M.right <= F.right + 0.5, above: M.bottom <= W2.top + 0.5, rows3: vis >= 3, scrolls: s.scrollHeight > s.clientHeight }); })()`);
const meterStale = () => ev(`document.querySelector('${L} [data-chat-tile-context]')?.hasAttribute('data-chat-tile-context-stale') ?? null`);
const slashPlace = () =>
  evj(`(() => { const m = document.querySelector('[data-chat-tile-slash-menu]'); const w = document.querySelector('${L} [data-flip-composer] .wrap'); if (!m || !w) return 'null'; const M = m.getBoundingClientRect(), W2 = w.getBoundingClientRect();
    return JSON.stringify({ above: M.bottom <= W2.top + 0.5, inside: M.left >= -0.5 && M.right <= innerWidth + 0.5 && M.top >= -0.5, scroll: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
const slashAria = () => evj(`(() => { const el = ${FIELD}; return JSON.stringify([el.getAttribute('aria-autocomplete'), !!el.getAttribute('aria-controls'), !!el.getAttribute('aria-activedescendant') && !!document.getElementById(el.getAttribute('aria-activedescendant'))]); })()`);
const slashNoteOf = () => evj(`(() => { const n = document.querySelector('${L} [data-chat-tile-slash-note]'); return n ? JSON.stringify({ kind: n.dataset.chatTileSlashNote, text: n.textContent.trim() }) : 'null'; })()`);
const meter = () =>
  evj(`(() => { const b = document.querySelector('${L} [data-chat-tile-context]'); if (!b) return 'null'; const c = document.querySelector('${L} [data-chat-tile-compact-inline]'); const m = document.querySelector('${L} [data-chat-tile-mode-chip]').getBoundingClientRect(); const B = b.getBoundingClientRect();
    const w = document.querySelector('${L} [data-flip-composer] .wrap').getBoundingClientRect();
    return JSON.stringify({ tone: b.dataset.chatTileContext, text: b.textContent.trim(), inline: c ? (c.getAttribute('aria-disabled') ?? 'on') : null, rightOfMode: B.left >= m.right - 0.5, inBox: B.right <= w.right + 0.5 && (!c || c.getBoundingClientRect().right <= w.right + 0.5) }); })()`);
const popOf = () =>
  evj(`(() => { const p = document.querySelector('[data-chat-tile-context-popover]'); if (!p) return 'null'; const R = p.getBoundingClientRect(); const w = document.querySelector('${L} [data-flip-composer] .wrap').getBoundingClientRect(); const b = p.querySelector('[data-chat-tile-compact]');
    return JSON.stringify({ tokens: p.querySelector('[data-chat-tile-context-tokens]')?.textContent.trim() ?? null, source: p.querySelector('[data-chat-tile-context-source]')?.dataset.chatTileContextSource ?? null,
      last: p.querySelector('[data-chat-tile-context-last]')?.textContent.trim() ?? null, instr: !!p.querySelector('[data-chat-tile-compact-instr]'), go: b?.getAttribute('aria-disabled') ?? 'on', tip: b?.title || b?.dataset.tip || '',
      why: p.querySelector('[data-chat-tile-compact-blocked]')?.textContent.trim() ?? null, srcText: p.querySelector('[data-chat-tile-context-source]')?.textContent.trim() ?? null,
      inside: R.left >= -0.5 && R.right <= innerWidth + 0.5 && R.top >= -0.5 && R.bottom <= innerHeight + 0.5, above: R.bottom <= w.top + 0.5 }); })()`);
const noticeOf = (code) => ev(`[...document.querySelectorAll('${L} [data-chat-tile-notice="${code}"]')].map((n) => n.textContent.trim()).pop() ?? null`);
const openPop = async () => {
  await clickAt(`document.querySelector('${L} [data-chat-tile-context]')`);
  return waitFor(`!!document.querySelector('[data-chat-tile-context-popover]')`, 3000);
};
/** 채팅 잎 하나를 독 우클릭 [채팅으로 열기] 로 연다 — 스냅숏 덧칸은 열기 전에 고른다 */
const openCT = async (cli, extra) => {
  await ev(`(window.__ctSnap = ${JSON.stringify(extra)}, 1)`);
  // 독이 늦게 서면 누름이 빗나간다 — 한 번 더 연다
  for (let tries = 0; tries < 2; tries++) {
    await ev(`(async () => (await ${DOCKM}).openDock('alerts'))()`);
    await waitFor(`!!document.querySelector('${DOCK_AI(cli)}')`, 6000);
    await sleep(300);
    const from = await callCount();
    await dockOpenAs(cli, "chat");
    const up = await waitFor(`!!document.querySelector('${L} [data-chat-tile-mode-chip]') && window.__calls.slice(${from}).filter(([c]) => c === 'chat_tile_subscribe').length >= 2`, 10000);
    await sleep(500);
    const sp = await chatSpec();
    if (up && sp) return sp;
  }
  return chatSpec();
};
const closeCT = async (s) => {
  await ev(`(async () => (await ${W}).closePaneIn(${JSON.stringify(s.tab)}, ${JSON.stringify(s.id)}))()`);
  await sleep(500);
};
const CMODE = { mode: "default", choices: ["default", "acceptEdits", "plan"] };
const CLAUDE_CMDS = {
  commands: [
    { name: "compact", description: "Free up context by summarizing the conversation so far", hint: "<optional custom summarization instructions>", kind: "builtin", aliases: [] },
    { name: "context", description: "Visualize current context usage as a colored grid", hint: "", kind: "builtin", aliases: [] },
    { name: "model", description: "Set the AI model for Claude Code", hint: "[model]", kind: "builtin", aliases: [] },
    { name: "clear", description: "Clear conversation history and free up context", hint: "", kind: "builtin", aliases: ["reset", "new"] },
    { name: "code-review", description: "Review the current diff for correctness bugs", hint: "[target]", kind: "builtin", aliases: ["review"] },
    { name: "docs", description: "(anthropic-skills) Editable docs people share and comment on", hint: "", kind: "skill", aliases: ["anthropic-skills:docs"] },
    { name: "heron-notes", description: "Summarize the heron notes folder (user)", hint: "<topic>", kind: "command", aliases: [] },
    { name: "doctor", description: "Diagnose and verify your Claude Code installation and settings", hint: "", kind: "skill", aliases: [] },
    { name: "config", description: "Open config panel", hint: "", kind: "builtin", aliases: ["settings"] },
  ],
  terminal: ["doctor", "color"],
};
const READY_C = { t: "ready", cli: "claude", version: "2.1.332", model: "claude-sonnet-5-5", models: ["opus", "sonnet"], efforts: {}, conversationId: CONV };
const keysOfG = (o) => Object.keys(o ?? {}).sort();

// S8 목록 없음(첫 보내기 전) — Aynx 줄 + 고정 compact · context + 대기 안내 줄
let gs = await openCT("claude", { permMode: null, cliMode: CMODE });
await typeIn("/");
let gm = await slashMenu();
check("S8 목록 없음 — Aynx 줄 · 고정 compact/context · 대기 줄 · 흐린 줄 없음",
  [gm?.groups, gm?.rows?.includes("model") && gm.rows.includes("clear") && gm.rows.includes("usage"), gm?.rows?.filter((n) => n === "compact" || n === "context"), gm?.pending, gm?.off],
  [["aynx", "builtin"], true, ["compact", "context"], true, []]);
check("S8 목록 전 고정 줄에도 설명(Aynx 문구)", [gm?.descs?.compact, gm?.descs?.context], ["대화 맥락 압축", "맥락 사용량 보기"]);
await shot("g-s8-pending.png");
await setField("");
await closeCT(gs);

// S1 Claude 스냅숏 commands — `/` 로 메뉴 · 무리 머리 · 흐린 doctor · CLI 가 알린 터미널 전용 이름 color
gs = await openCT("claude", { permMode: null, cliMode: CMODE, commands: CLAUDE_CMDS });
let GC = gs.chat.chatId;
let g0 = await callCount();
for (const t of ["hello /co", " /co", "$co"]) {
  await setField("");
  await typeIn(t);
  check(`S1 메뉴는 첫 글자 / 일 때만 — ${JSON.stringify(t)} 는 열지 않음`, await slashMenu(), null);
}
await setField("");
await typeIn("/");
gm = await slashMenu();
check("S1 `/` → 메뉴 · 무리 머리 다섯 · doctor · color 흐림(aria-disabled) · 숨김 없음",
  [gm?.groups, gm?.off, gm?.rows?.includes("docs"), gm?.rows?.includes("heron-notes"), gm?.rows?.length <= 50],
  [["aynx", "builtin", "skill", "command", "terminal"], ["color", "config", "doctor"], true, true, true]);
check("S1 메뉴는 입력 칸 상자 위 · 화면 안 · 포커스는 입력 칸 · aria", [await slashPlace(), (await fieldState()).focus, await slashAria()],
  [{ above: true, inside: true, scroll: true }, true, ["list", true, true]]);
await shot("g-s1-menu-claude.png");

// S2 거르기 · ↓ · Enter → "/compact " · 메뉴 닫힘 · 보내기 없음
await typeIn("comp");
check("S2 `/comp` → compact · 흐린 고정 터미널 이름(autocompact)", [(await slashMenu())?.rows, (await slashMenu())?.sel], [["compact", "autocompact"], "compact"]);
await setField("/co");
await sleep(200);
gm = await slashMenu();
check("S2 `/co` → 무리는 붙어 있고 무리 안은 이름 앞 일치가 먼저 · 무리 머리 되풀이 없음", [gm?.rows?.slice(0, 7), gm?.sel, gm?.groups], [["copy", "usage", "code-review", "compact", "context", "docs", "color"], "copy", ["aynx", "builtin", "skill", "terminal"]]);
await shot("g-s2-filter.png");
for (let i = 0; i < 6 && (await slashMenu())?.sel !== "context"; i++) await press("ArrowDown");
await press("ArrowDown");
check("S2 ↓ 는 다음 무리의 고를 수 있는 줄로(설명 일치 docs)", (await slashMenu())?.sel, "docs");
await press("ArrowUp");
await press("ArrowUp");
check("S2 ↑ 두 번 → compact", (await slashMenu())?.sel, "compact");
await press("Enter");
check("S2 Enter → 칸 \"/compact \" · 커서 끝 · 메뉴 닫힘 · chat_tile_send 없음", [await fieldState(), await slashMenu(), (await callsOf("chat_tile_send", g0)).length],
  [{ value: "/compact ", caret: 9, focus: true }, null, 0]);
await setField("/code");
await press("Tab");
check("S2 Tab 도 고른다 — \"/code-review \"", (await fieldState()).value, "/code-review ");

// S3 IME 조합 중 Enter · Shift+Enter 는 메뉴가 받지 않는다
await setField("/co");
await sleep(150);
const synth = (init) =>
  evj(`(() => { const el = ${FIELD}; const e = new KeyboardEvent('keydown', Object.assign({ bubbles: true, cancelable: true }, ${JSON.stringify(init)})); el.dispatchEvent(e); return JSON.stringify({ prevented: e.defaultPrevented, value: el.value }); })()`);
g0 = await callCount();
check("S3 IME 조합 중 Enter(isComposing) → 아무것도 안 함", await synth({ key: "Enter", code: "Enter", isComposing: true }), { prevented: false, value: "/co" });
check("S3 IME keyCode 229 → 아무것도 안 함", await synth({ key: "Process", code: "Enter", keyCode: 229 }), { prevented: false, value: "/co" });
check("S3 Shift+Enter → 메뉴가 막지 않는다(줄바꿈 그대로)", (await synth({ key: "Enter", code: "Enter", shiftKey: true })).value, "/co");
check("S3 그 사이 메뉴는 열린 채 · 보내기 없음", [(await slashMenu()) !== null, (await callsOf("chat_tile_send", g0)).length], [true, 0]);

// S4 Esc → 닫힘 · 같은 글에 다시 안 열림 · 한 자 더 치면 열림
await press("Escape");
check("S4 Esc → 닫힘 · 칸 글 그대로", [await slashMenu(), (await fieldState()).value], [null, "/co"]);
await press("ArrowRight");
check("S4 글이 같으면 다시 열지 않는다", await slashMenu(), null);
await typeIn("n");
check("S4 한 자 더 치면 열림(/con)", (await slashMenu())?.rows?.[0], "context");

// S5 터미널 전용 — 쳐서 보내기 · 흐린 줄 누름 모두 보내지 않고 안내
await setField("/doctor");
await sleep(150);
g0 = await callCount();
await press("Enter");
check("S5 `/doctor` + Enter → chat_tile_send 없음 · 안내 줄 · 글 남음 · 메뉴 다시 안 열림", [(await callsOf("chat_tile_send", g0)).length, await slashNoteOf(), (await fieldState()).value, await slashMenu()],
  [0, { kind: "terminal", text: "/doctor은(는) 터미널 모양에서만 됩니다 — 터미널 모양으로 열어 주세요" }, "/doctor", null]);
await shot("g-s5-terminal-note.png");
await typeIn(" ");
check("S5 다음 입력에 안내 줄이 걷힌다", await slashNoteOf(), null);
await setField("/config theme");
await press("Enter");
check("S5 고정 터미널 전용(/config x) 도 막는다", [(await callsOf("chat_tile_send", g0)).length, (await slashNoteOf())?.kind], [0, "terminal"]);
await setField("/col");
await sleep(150);
await clickAt(`document.querySelector('[data-chat-tile-slash-menu] [data-chat-tile-slash="color"]')`);
check("S5 흐린 줄을 눌러도 넣지 않고 안내만", [(await fieldState()).value, (await slashNoteOf())?.text?.startsWith("/color"), (await callsOf("chat_tile_send", g0)).length], ["/col", true, 0]);

// 모르는 `/x` 는 글로 간다
await setField("/nope 이건 그냥 글");
g0 = await callCount();
await press("Enter");
let gsent = await callsOf("chat_tile_send", g0);
check("S5 모르는 /nope → 보통 글로 보낸다 · skills 빈 칸", gsent.map((a) => [a.text, a.skills]), [["/nope 이건 그냥 글", []]]);
await emit(READY_C, GC);
await emit({ t: "turnStarted", turn: "g1" }, GC);
await emit({ t: "userAccepted", clientId: gsent[0]?.clientId ?? null, text: "/nope 이건 그냥 글" }, GC);
await emit({ t: "turnEnded", turn: "g1", outcome: "ok", message: null }, GC);
await sleep(600);

// 과금 클라우드 리뷰(`/code-review ultra` · 별칭 `/review ultra`)는 `/ultrareview` 처럼 막는다 — 다른 인자는 글로 간다
const ULTRA_NOTE = { kind: "terminal", text: "/code-review ultra은(는) 터미널 모양에서만 됩니다 — 터미널 모양으로 열어 주세요" };
for (const [typed, esc] of [["/code-review ultra", false], ["/code-review ULTRA 12", true], ["/review ultra", false]]) {
  await setField("");
  await typeIn(typed);
  await sleep(150);
  if (esc) await press("Escape");
  g0 = await callCount();
  await press("Enter");
  check(`${typed}${esc ? " (Esc 뒤)" : ""} + Enter → 보내기 없음 · 터미널 안내 · 글 남음`,
    [(await callsOf("chat_tile_send", g0)).length, await slashNoteOf(), (await fieldState()).value], [0, ULTRA_NOTE, typed]);
}
await shot("g-code-review-ultra-note.png");
await setField("/code-review low");
g0 = await callCount();
await press("Enter");
gsent = await callsOf("chat_tile_send", g0);
check("/code-review low → 글로 보낸다", gsent.map((a) => a.text), ["/code-review low"]);
await emit({ t: "turnStarted", turn: "g1u" }, GC);
await emit({ t: "userAccepted", clientId: gsent[0]?.clientId ?? null, text: "/code-review low" }, GC);
await emit({ t: "turnEnded", turn: "g1u", outcome: "ok", message: null }, GC);
await sleep(600);

// S6 `/model` 줄 → 모델 메뉴 · 글 비움 · 쳐서 보낸 /model sonnet 도 메뉴
await setField("/mod");
await sleep(150);
g0 = await callCount();
await press("Enter");
check("S6 /model 줄 → 모델 메뉴 열림 · 칸 비움 · 보내기 없음", [await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 2000), (await fieldState()).value, (await callsOf("chat_tile_send", g0)).length], [true, "", 0]);
await shot("g-s6-model-menu.png");
await press("Escape");
await setField("/model sonnet");
await press("Enter");
check("S6 쳐서 보낸 /model sonnet → 모델 메뉴 · 보내기 없음 · set_model 없음", [await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 2000), (await callsOf("chat_tile_send", g0)).length, (await callsOf("chat_tile_set_model", g0)).length], [true, 0, 0]);
await press("Escape");
await waitFor(`!document.querySelector('[data-flip-model-menu]')`, 2000);

// Aynx 동작 — /usage = 사용량 화면 · /resume = 지난 대화 · /copy = 안내 줄
await setField("/usage");
await press("Enter");
check("S6 /usage → 사용량 화면", await ev(`(async () => (await ${importApp("app/usage-view.svelte.ts")}).usageViewOpen())()`), true);
await shot("g-s6-usage.png");
await ev(`(async () => (await ${importApp("app/usage-view.svelte.ts")}).closeCoverView(false))()`);
await sleep(300);
await setField("/resume");
await press("Enter");
check("S6 /resume → 지난 대화 열림", await ev(`(async () => (await ${importApp("app/folder-conversations.svelte.ts")}).folderConversationsVisible())()`), true);
await ev(`(async () => (await ${importApp("app/folder-conversations.svelte.ts")}).closeFolderConversations())()`);
await sleep(300);
await setField("/copy");
await press("Enter");
check("S6 /copy → 안내 줄 copyHint · 보내기 없음", [(await slashNoteOf())?.kind, (await callsOf("chat_tile_send", g0)).length], ["copyHint", 0]);
await setField("");

// S7 /clear → 같은 자리 새 채팅(chatId 바뀜) · 옛 항목 chat_tile_close
await markFrame();
g0 = await callCount();
await setField("/clear");
await press("Enter");
const clearAnims = await frameAnims();
await waitFor(`window.__calls.slice(${g0}).some(([c, a]) => c === 'chat_tile_close' && a.chat === ${JSON.stringify(GC)})`, 4000);
await waitFor(`window.__calls.slice(${g0}).filter(([c]) => c === 'chat_tile_subscribe').length >= 2`, 4000);
await sleep(500);
const gsNew = await chatSpec();
check("S7 /clear → 잎의 chatId 바뀜 · 같은 cli · 같은 자리 · 옛 항목 close · 보내기 없음",
  [gsNew.chat.chatId !== GC, gsNew.chat.cli, gsNew.tab === gs.tab, (await callsOf("chat_tile_close", g0)).some((a) => a.chat === GC), (await callsOf("chat_tile_send", g0)).length],
  [true, "claude", true, true, 0]);
check("S7 /clear → 같은 타일(pane id) · 틀 · 머리줄 DOM 그대로 · 등장 애니메이션 없음 · 입력 칸 포커스",
  [gsNew.id === gs.id, ...(await frameKept()), clearAnims, (await fieldState()).focus], [true, true, true, 0, true]);
gs = gsNew;
GC = gs.chat.chatId;

// S11 맥락 미터 — 세 색 · 85 % 부터 인라인 [압축] · 풍선 → chat_tile_compact{instructions:null} · 지침 "x"
await emit(READY_C, GC);
await emit({ t: "contextUsage", used: 36149, window: 1000000, source: "turn" }, GC);
await sleep(300);
check("S11 contextUsage{36149, 1M} → 미터 36.1k / 1M · 중성 · 모드 칩 오른쪽 · 인라인 [압축] 없음", await meter(), { tone: "ok", text: "36.1k / 1M", inline: null, rightOfMode: true, inBox: true });
await shot("g-s11-meter-ok.png");
await emit({ t: "contextUsage", used: 720000, window: 1000000, source: "turn" }, GC);
await sleep(250);
check("S11 72% → warn", (await meter())?.tone, "warn");
await shot("g-s11-meter-warn.png");
await emit({ t: "contextUsage", used: 900000, window: 1000000, source: "turn" }, GC);
await sleep(250);
check("S11 90% → high · 인라인 [압축]", await meter(), { tone: "high", text: "900k / 1M", inline: "on", rightOfMode: true, inBox: true });
await shot("g-s11-meter-high.png");
check("S11 미터 누름 → 풍선", await openPop(), true);
check("S11 풍선 — 수 · 출처 · 지침 칸(Claude) · [지금 압축] 켬 · 입력 칸 위", await popOf(),
  { tokens: "900,000 / 1,000,000 토큰 (90%)", source: "turn", last: null, instr: true, go: "on", tip: "", why: null, srcText: "마지막 턴 기준", inside: true, above: true });
await shot("g-s11-popover.png");
g0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-context-popover] [data-chat-tile-compact]')`);
let gcomp = await callsOf("chat_tile_compact", g0);
check("S11 [지금 압축] → chat_tile_compact 열쇠 chat · epoch · instructions = null · 풍선 닫힘", [gcomp.map((a) => [keysOfG(a), a.chat === GC, typeof a.epoch, a.instructions]), await popOf()],
  [[[["chat", "epoch", "instructions"], true, "number", null]], null]);

// S12 압축 표지 — started → 알림 · 바쁨 · done → 36.2k → 8.3k
await emit({ t: "turnStarted", turn: null }, GC);
await emit({ t: "compaction", phase: "started", trigger: "manual", preTokens: null, postTokens: null }, GC);
await sleep(300);
check("S12 started → \"압축하는 중\" 알림 · [중지] · 인라인 [압축] 흐림", [await noticeOf("compacting"), await ev(`!!document.querySelector('${STOP}')`), (await meter())?.inline],
  ["맥락을 압축하는 중…", true, "true"]);
await openPop();
check("S12 턴 중 [지금 압축] 흐림 · 툴팁 · 이유 줄이 보인다", [(await popOf())?.go, (await popOf())?.tip, (await popOf())?.why], ["true", "턴이 끝난 뒤 압축할 수 있습니다", "턴이 끝난 뒤 압축할 수 있습니다"]);
g0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-context-popover] [data-chat-tile-compact]')`);
check("S12 흐린 [지금 압축] 은 보내지 않는다", (await callsOf("chat_tile_compact", g0)).length, 0);
await shot("g-s12-compacting.png");
await press("Escape");
await emit({ t: "compaction", phase: "done", trigger: "manual", preTokens: 36241, postTokens: 8335 }, GC);
await emit({ t: "contextUsage", used: 900000, window: 1000000, source: "preCompact" }, GC);
await sleep(300);
check("S12 done → \"압축했습니다 — 압축 전 36.2k 토큰\"(뒤 수 없음) · started 줄은 갈음됨", [await noticeOf("compacted"), await noticeOf("compacting")], ["맥락을 압축했습니다 — 압축 전 36.2k 토큰", null]);
check("S12 압축 뒤 미터 — 압축 전 값 그대로 · 흐림 표지", [(await meter())?.text, await meterStale()], ["900k / 1M", true]);
await shot("g-s12-compacted.png");
await emit({ t: "turnEnded", turn: null, outcome: "ok", message: null }, GC);
await sleep(800);
await openPop();
check("S12 턴 뒤 풍선 — 마지막 압축(압축 전 수만) · 출처 압축 전 값 · 단추 켬", [(await popOf())?.last, (await popOf())?.source, (await popOf())?.srcText, (await popOf())?.go],
  ["마지막 압축: 압축 전 36.2k 토큰", "preCompact", "압축 전 값 — 다음 턴에 갱신됩니다", "on"]);
await shot("g-s12-stale-popover.png");
await ev(`(() => { const i = document.querySelector('[data-chat-tile-compact-instr]'); i.focus(); return 1; })()`);
await send("Input.insertText", { text: "x" });
g0 = await callCount();
await press("Enter");
gcomp = await callsOf("chat_tile_compact", g0);
check("S11 지침 \"x\" + Enter → instructions:\"x\"", gcomp.map((a) => a.instructions), ["x"]);
await emit({ t: "turnStarted", turn: null }, GC);
await emit({ t: "compaction", phase: "started", trigger: "manual", preTokens: null, postTokens: null }, GC);
await emit({ t: "notice", code: "compact-failed", detail: "Not enough messages to compact." }, GC);
await sleep(300);
check("S12 실패 알림이 \"압축하는 중\" 줄을 갈음한다", [await noticeOf("compact-failed"), await noticeOf("compacting")], ["압축하지 못했습니다: Not enough messages to compact.", null]);
await shot("g-s12-failed.png");
await emit({ t: "turnEnded", turn: null, outcome: "ok", message: null }, GC);
await sleep(600);
// [중지] 한 압축 — 중립 줄(오류 색 아님) · 돌던 줄 없음
await emit({ t: "turnStarted", turn: null }, GC);
await emit({ t: "compaction", phase: "started", trigger: "manual", preTokens: null, postTokens: null }, GC);
await emit({ t: "notice", code: "compact-canceled", detail: null }, GC);
await sleep(300);
check("S12 멈춘 압축 → \"압축을 중지했습니다\" · 돌던 줄 없음 · 오류 색 아님",
  [await noticeOf("compact-canceled"), await noticeOf("compacting"), await ev(`document.querySelector('${L} [data-chat-tile-notice="compact-canceled"]')?.classList.contains('err') ?? null`)],
  ["압축을 중지했습니다", null, false]);
await shot("g-s12-canceled.png");
await emit({ t: "turnEnded", turn: null, outcome: "ok", message: null }, GC);
await sleep(600);
// 다음 턴의 값이 오면 흐림이 걷힌다
await emit({ t: "turnStarted", turn: null }, GC);
await emit({ t: "contextUsage", used: 41000, window: 1000000, source: "turn" }, GC);
await emit({ t: "turnEnded", turn: null, outcome: "ok", message: null }, GC);
await sleep(500);
check("S12 다음 턴 값 → 미터 흐림 걷힘", [(await meter())?.text, await meterStale()], ["41k / 1M", false]);
await closeCT(gs);

// S13 프로세스 없음(Claude) — [지금 압축] 은 입력 칸에 넣기만 · invoke 없음
gs = await openCT("claude", { permMode: null, cliMode: CMODE, commands: CLAUDE_CMDS, context: { used: 905000, window: 1000000, source: "turn" }, lastCompaction: { trigger: "manual", preTokens: 36241, postTokens: 8335 } });
GC = gs.chat.chatId;
check("S13 스냅숏 context → 미터 high", (await meter())?.tone, "high");
await openPop();
check("S13 스냅숏 lastCompaction → 풍선 마지막 압축(압축 전 수만)", (await popOf())?.last, "마지막 압축: 압축 전 36.2k 토큰");
await ev(`(() => { const i = document.querySelector('[data-chat-tile-compact-instr]'); i.focus(); return 1; })()`);
await send("Input.insertText", { text: "keep auth" });
g0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-context-popover] [data-chat-tile-compact]')`);
check("S13 stopped Claude [지금 압축] → 칸 \"/compact keep auth\" · invoke 없음 · 풍선 닫힘",
  [(await fieldState()).value, (await callsOf("chat_tile_compact", g0)).length, (await callsOf("chat_tile_send", g0)).length, await popOf()], ["/compact keep auth", 0, 0, null]);
await setField("");
await clickAt(`document.querySelector('${L} [data-chat-tile-compact-inline]')`);
check("S13 인라인 [압축] 도 칸에 \"/compact \" 만", [(await fieldState()).value, (await callsOf("chat_tile_compact", g0)).length], ["/compact ", 0]);
await setField("");

// 작은 타일(560×400) — 메뉴 · 미터 · 풍선이 화면 안 · 친 글을 덮지 않는다
await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 400, deviceScaleFactor: 1, mobile: false });
await sleep(600);
await typeIn("/");
check("작은 타일 — 메뉴가 입력 칸 위 · 화면 안", await slashPlace(), { above: true, inside: true, scroll: true });
check("작은 타일 — 메뉴가 타일 몸 안(탭 띠 · 옆 타일 위로 넘지 않음) · 줄 셋 이상 · 안에서 구름", await slashInTile(), { inTile: true, above: true, rows3: true, scrolls: true });
await shot("g-small-menu-claude.png");
await press("Escape");
await setField("");
check("작은 타일 — 미터 · 인라인 [압축] 이 입력 칸 상자 안", (await meter())?.inBox, true);
await openPop();
check("작은 타일 — 풍선 화면 안", (await popOf())?.inside, true);
await shot("g-small-popover.png");
await press("Escape");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await closeCT(gs);

// S16 정확히 친 이름 — 흐린 줄이어도 그 줄이 고른 줄 · Enter 는 보내기 길이 막고 안내 · 다른 명령을 넣지 않는다
const EXACT_CMDS = {
  commands: [
    { name: "doctor", description: "Diagnose the install", hint: "", kind: "skill", aliases: [] },
    { name: "skill-doctor", description: "Check skills for problems", hint: "", kind: "skill", aliases: [] },
    { name: "update-config", description: "Edit settings.json for you", hint: "", kind: "skill", aliases: [] },
    { name: "clear", description: "Clear conversation history and free up context", hint: "", kind: "builtin", aliases: ["reset", "new"] },
    { name: "effort", description: "Set effort level", hint: "", kind: "builtin", aliases: [] },
    { name: "rename", description: "Rename the current conversation", hint: "", kind: "builtin", aliases: [] },
    { name: "do-thing", description: "x", hint: "", kind: "command", aliases: [] },
    ...Array.from({ length: 60 }, (_, i) => ({ name: `zz-skill-${String(i).padStart(2, "0")}`, description: "filler", hint: "", kind: "skill", aliases: [] })),
  ],
  terminal: ["doctor"],
};
gs = await openCT("claude", { permMode: null, cliMode: CMODE, commands: EXACT_CMDS });
GC = gs.chat.chatId;
g0 = await callCount();
for (const [typed, name] of [["doctor", "doctor"], ["config", "config"]]) {
  await setField("");
  await typeIn(`/${typed}`);
  gm = await slashMenu();
  check(`S16 /${typed} → 맨 위 · 고른 줄 ${name}(흐림) · 빈 결과 줄 없음`, [gm?.rows?.[0], gm?.sel, gm?.off?.includes(name), gm?.empty], [name, name, true, false]);
  await shot(`g-s16-exact-${typed}.png`);
  await press("Enter");
  check(`S16 /${typed} + Enter → 다른 명령을 넣지 않음 · 보내기 없음 · 안내 줄`, [(await fieldState()).value, (await callsOf("chat_tile_send", g0)).length, (await slashNoteOf())?.kind], [`/${typed}`, 0, "terminal"]);
}
await setField("");
await typeIn("/config");
await press("Tab");
check("S16 /config + Tab → 넣지 않고 안내만", [(await fieldState()).value, (await slashNoteOf())?.kind, (await callsOf("chat_tile_send", g0)).length], ["/config", "terminal", 0]);
await setField("");
await typeIn("/skill-doctor");
await press("Tab");
check("S16 /skill-doctor(고를 수 있는 정확 일치) + Tab → 그 이름을 넣는다", (await fieldState()).value, "/skill-doctor ");
await setField("");
await typeIn("/skill-doctor");
await press("Enter");
check("S16 /skill-doctor + Enter → 친 그대로 보낸다(다른 명령이 아니다)", (await callsOf("chat_tile_send", g0)).map((a) => a.text), ["/skill-doctor"]);
await emit({ t: "turnStarted", turn: "s16-send" }, GC);
await emit({ t: "turnEnded", turn: "s16-send", outcome: "ok", message: null }, GC);
await sleep(300);
await setField("");
await typeIn("/do");
gm = await slashMenu();
check("S16 /do(정확 일치 없음) → 무리 머리 되풀이 없음 · 첫 고를 수 있는 줄", [gm?.groups?.length === new Set(gm?.groups).size, gm?.off?.includes(gm?.sel)], [true, false]);
await setField("");
await typeIn("/permissions");
gm = await slashMenu();
check("S16 목록에 없는 고정 터미널 이름(/permissions) → 흐린 줄 · \"보내면 글로 갑니다\" 없음", [gm?.rows, gm?.off, gm?.empty], [["permissions"], ["permissions"], false]);
await setField("");
await typeIn("/");
gm = await slashMenu();
check("S16 Aynx 줄 설명은 Aynx 문구 — /clear · /effort · /rename", [gm?.descs?.clear, gm?.descs?.effort, gm?.descs?.rename], ["이 자리에 새 채팅", "응답 강도 고르기", "지난 대화 목록에서 이름 바꾸기"]);
// 셈은 7단계 갈래 표(`chat-tile-slash.ts`) 뒤의 값
check("S16 빈 질의 — 50줄 · 바닥에 \"N개 더\" 줄(고를 수 없음)", [gm?.rows?.length, gm?.more], [50, "24개 더 있습니다 — 더 쳐서 좁혀 보세요"]);
await ev(`(() => { const s = document.querySelector('[data-chat-tile-slash-menu] [role="listbox"]'); s.scrollTop = s.scrollHeight; return 1; })()`);
await sleep(200);
await shot("g-s16-more.png");
await press("Escape");
await setField("");
await closeCT(gs);

// S9 Codex 스킬 — `$name ` 넣기 · 보내기 skills:[name] · 글에서 지우면 skills:[]
const CODEX_CMDS = {
  commands: [
    { name: "review-agent", description: "Review with a subagent", hint: "", kind: "skill", aliases: [] },
    { name: "heron-review", description: "Review the change like a heron watching the pond", hint: "", kind: "skill", aliases: [] },
    { name: "tidy-imports", description: "Sort and group imports", hint: "", kind: "skill", aliases: [] },
  ],
  terminal: [],
};
gs = await openCT("codex", { permMode: null, cliMode: { mode: "readOnly", choices: ["readOnly", "auto", "plan"] }, commands: CODEX_CMDS });
let GX = gs.chat.chatId;
await typeIn("/");
gm = await slashMenu();
check("S9 Codex 메뉴 — Aynx 줄(compact · approvals …) + 스킬 줄은 $name", [gm?.groups, gm?.rows?.includes("compact"), gm?.rows?.includes("approvals"), gm?.labels?.filter((l) => l.startsWith("$"))],
  [["aynx", "skill"], true, true, ["$heron-review", "$review-agent", "$tidy-imports"]]);
await shot("g-s9-menu-codex.png");
await typeIn("her");
await press("Enter");
check("S9 스킬 고름 → 칸 \"$heron-review \"", (await fieldState()).value, "$heron-review ");
await typeIn("src 를 봐 줘");
g0 = await callCount();
await press("Enter");
gsent = await callsOf("chat_tile_send", g0);
check("S9 보내기 → text 그대로 · skills:[heron-review]", gsent.map((a) => [a.text, a.skills]), [["$heron-review src 를 봐 줘", ["heron-review"]]]);
await emit({ t: "ready", cli: "codex", version: "0.172.0", model: "gpt-6-sol", models: [], efforts: {}, conversationId: CONV }, GX);
await emit({ t: "turnStarted", turn: "x1" }, GX);
await emit({ t: "userAccepted", clientId: gsent[0]?.clientId ?? null, text: gsent[0]?.text }, GX);
await emit({ t: "turnEnded", turn: "x1", outcome: "ok", message: null }, GX);
await sleep(600);
await setField("/tidy");
await sleep(150);
await press("Enter");
await setField("그냥 글로 바꿈");
g0 = await callCount();
await press("Enter");
gsent = await callsOf("chat_tile_send", g0);
check("S9 고른 뒤 글에서 $name 을 지우면 skills:[]", gsent.map((a) => a.skills), [[]]);
await emit({ t: "turnStarted", turn: "x2" }, GX);
await emit({ t: "userAccepted", clientId: gsent[0]?.clientId ?? null, text: gsent[0]?.text }, GX);
await emit({ t: "turnEnded", turn: "x2", outcome: "ok", message: null }, GX);
await sleep(600);

// S10 Codex /compact — 메뉴 줄 · 쳐서 보내기 모두 chat_tile_compact · 보내기 없음
await setField("/compact");
await sleep(150);
g0 = await callCount();
await press("Enter");
gcomp = await callsOf("chat_tile_compact", g0);
check("S10 Codex /compact 줄 → chat_tile_compact{instructions:null} · 칸 비움 · 보내기 없음", [gcomp.map((a) => [keysOfG(a), a.chat === GX, a.instructions]), (await fieldState()).value, (await callsOf("chat_tile_send", g0)).length],
  [[[["chat", "epoch", "instructions"], true, null]], "", 0]);
await emit({ t: "turnStarted", turn: "x3" }, GX);
await emit({ t: "compaction", phase: "started", trigger: "manual", preTokens: null, postTokens: null }, GX);
await emit({ t: "contextUsage", used: 4800, window: 272000, source: "tokenUsage" }, GX);
await emit({ t: "compaction", phase: "done", trigger: "manual", preTokens: 61000, postTokens: null }, GX);
await emit({ t: "turnEnded", turn: "x3", outcome: "ok", message: null }, GX);
await sleep(600);
await setField("/compact");
await press("Escape");
g0 = await callCount();
await press("Enter");
check("S10 쳐서 보낸 /compact(메뉴 닫힘) → chat_tile_compact · 보내기 없음", [(await callsOf("chat_tile_compact", g0)).length, (await callsOf("chat_tile_send", g0)).length], [1, 0]);
await emit({ t: "turnStarted", turn: "x4" }, GX);
await emit({ t: "turnEnded", turn: "x4", outcome: "ok", message: null }, GX);
await sleep(600);
check("S10 Codex 미터 — 4.8k / 272k", (await meter())?.text, "4.8k / 272k");
await openPop();
check("S10 Codex 풍선 — 지침 칸 없음 · 출처 CLI 가 알린 값 · 마지막 압축은 압축 전 수만", [(await popOf())?.instr, (await popOf())?.source, (await popOf())?.last], [false, "tokenUsage", "마지막 압축: 압축 전 61k 토큰"]);
await shot("g-s10-popover-codex.png");
await press("Escape");
// /approvals → 권한 모드 메뉴 · /status → 풍선
await setField("/approvals");
await press("Enter");
check("S10 /approvals → 권한 모드 메뉴", await waitFor(`!!document.querySelector('[data-chat-tile-mode-menu]')`, 2000), true);
await press("Escape");
await setField("/status");
await press("Enter");
check("S10 /status → 맥락 사용량 풍선", await waitFor(`!!document.querySelector('[data-chat-tile-context-popover]')`, 2000), true);
await press("Escape");
await setField("/mcp");
await press("Enter");
// 7단계 — Codex `/mcp` 는 MCP 상태 풍선(보내지 않는다)
check("S10 Codex /mcp → MCP 풍선 · 보내기 없음", [await waitFor(`!!document.querySelector('[data-chat-tile-mcp-popover]')`, 2000), (await callsOf("chat_tile_send", g0)).length], [true, 0]);
await press("Escape");
// S17 Codex 정확히 친 이름이 고른 줄 — 스킬($review-agent)을 넣지 않는다 · "글로 갑니다" 없음. 터미널 전용(init)은 흐린 줄 · 안내
await setField("");
await typeIn("/init");
gm = await slashMenu();
check("S17 Codex /init → 흐린 줄 맨 위 · 고른 줄 · 빈 결과 줄 없음", [gm?.rows?.[0], gm?.sel, gm?.off?.includes("init"), gm?.empty], ["init", "init", true, false]);
await press("Enter");
check("S17 Codex /init + Enter → 넣지 않음 · 보내기 없음 · 안내 줄", [(await fieldState()).value, (await callsOf("chat_tile_send", g0)).length, (await slashNoteOf())?.kind], ["/init", 0, "terminal"]);
await setField("");
await typeIn("/review");
gm = await slashMenu();
check("S17 Codex /review → Aynx 줄 맨 위 · 고른 줄 · 흐리지 않음 · 빈 결과 줄 없음", [gm?.rows?.[0], gm?.sel, gm?.off?.includes("review"), gm?.empty], ["review", "review", false, false]);
await shot("g-s17-codex-review.png");
await press("Enter");
check("S17 Codex /review + Enter → 스킬을 넣지 않고 검토 카드 · 보내기 없음", [(await fieldState()).value, (await callsOf("chat_tile_send", g0)).length, await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 2000)], ["", 0, true]);
await clickAt(`document.querySelector('${L} [data-chat-tile-review-cancel]')`);
await setField("");
await typeIn("/nope");
check("S17 Codex 모르는 /nope → 빈 결과 줄(정말 글로 간다)", (await slashMenu())?.empty, true);
await setField("");
await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 400, deviceScaleFactor: 1, mobile: false });
await sleep(600);
await typeIn("/");
check("작은 타일 — Codex 메뉴가 입력 칸 위 · 화면 안", await slashPlace(), { above: true, inside: true, scroll: true });
check("작은 타일 — Codex 메뉴가 타일 몸 안 · 줄 셋 이상", await slashInTile().then((x) => [x?.inTile, x?.above, x?.rows3]), [true, true, true]);
await shot("g-small-menu-codex.png");
await press("Escape");
await setField("");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await closeCT(gs);
await ev(`(window.__ctSnap = null, 1)`);
check("G 메인 PC 예외 0", errors.slice(), []);

// ═══ R. 되감기(6단계 — docs/log/2026-11-28-chat-tile-stage6-contract.md 7절 FE-B · 13절) ════════════════════════
errors.length = 0;
const UA = ["30b5bc5c-33b6-47d1-802c-c06d0d28a931", "30b5bc5c-33b6-47d1-802c-c06d0d28a932"];
const TA = ["01a21d10-b57d-73b3-b3c6-f273fd0ffb11", "01a21d10-b57d-73b3-b3c6-f273fd0ffb12"];
const U2_TEXT = "둘째 메시지 — README 도 고쳐 줘\n둘째 줄";
const RT0 = await nowMs();
const claudeRec = [
  rec("user", "첫 메시지 — src/a.ts 를 고쳐 줘", RT0 - 9000, { anchor: UA[0] }),
  rec("assistant", "src/a.ts 를 고쳤습니다.", RT0 - 8000),
  rec("user", U2_TEXT, RT0 - 7000, { anchor: UA[1] }),
  rec("tool", null, RT0 - 6900, { tool: tool("Edit", JSON.stringify({ file_path: "C:/src/proj/README.md", old_string: "a", new_string: "b" }), "ok") }),
  rec("assistant", "README 도 고쳤습니다.", RT0 - 6000),
  rec("user", "기준점 없는 사람 말", RT0 - 5000),
  rec("assistant", "알겠습니다.", RT0 - 4000),
];
const codexRec = [
  rec("user", "첫 턴 — 계획을 세워 줘", RT0 - 9000, { anchor: TA[0] }),
  rec("assistant", "계획입니다.", RT0 - 8000),
  rec("user", "둘째 턴 — README 를 고쳐 줘", RT0 - 7000, { anchor: TA[1] }),
  rec("tool", null, RT0 - 6900, { tool: tool("apply_patch", "*** Begin Patch\n*** Update File: C:/src/proj/README.md\n@@\n-a\n+b\n*** End Patch", "ok") }),
  rec("assistant", "README 를 고쳤습니다.", RT0 - 6000),
];
const RVC = "5c3d4e5f-6a7b-4c8d-9e0f-1a2b3c4d5e6f";
const pv = (anchor, scope, extra = {}) => ({ t: "rewind", phase: "preview", anchor, scope, can: true, files: [], moreFiles: 0, insertions: null, deletions: null, turns: null, skippedLinks: null, error: null, ...extra });
const rwDone = (anchor, scope, extra = {}) => ({ ...pv(anchor, scope), phase: "done", ...extra });
const rwFailed = (anchor, scope, error) => ({ ...pv(anchor, scope), phase: "failed", can: false, error });
const rwCalls = (from) => callsOf("chat_tile_rewind", from);
const trCalls = (from) => callsOf("agent_conversation_transcript", from);
const rwBtns = () =>
  evj(`JSON.stringify([...document.querySelectorAll('${L} [data-chat-tile-rewind]')].map((b) => ({ a: b.dataset.chatTileRewind, user: !!b.closest('[data-item="user"]'), op: getComputedStyle(b).opacity, dis: b.getAttribute('aria-disabled'), label: b.getAttribute('aria-label') })))`);
const rwBtn = (a) => `document.querySelector('${L} [data-chat-tile-rewind="${a}"]')`;
const rwCard = () =>
  evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-rewind-card]'); if (!c) return 'null'; const conf = c.querySelector('[data-chat-tile-rewind-confirm]'); const cancel = c.querySelector('[data-chat-tile-rewind-cancel]');
    const retry = c.querySelector('[data-chat-tile-rewind-retry]'); const a = document.activeElement;
    return JSON.stringify({ phase: c.dataset.chatTileRewindCard, scope: c.dataset.scope, title: c.querySelector('#' + c.getAttribute('aria-labelledby'))?.textContent.trim() ?? null, role: c.getAttribute('role'),
      quote: c.querySelector('[data-chat-tile-rewind-quote]')?.textContent.trim() ?? null, lines: [...c.querySelectorAll('[data-chat-tile-rewind-line]')].map((l) => l.dataset.chatTileRewindLine),
      files: [...c.querySelectorAll('[data-chat-tile-rewind-files] li:not(.more)')].map((l) => l.textContent.trim()), more: c.querySelector('[data-chat-tile-rewind-more]')?.textContent.trim() ?? null,
      confirm: conf ? { text: conf.textContent.trim(), disabled: conf.disabled, danger: conf.classList.contains('danger') && getComputedStyle(conf).backgroundColor !== 'rgba(0, 0, 0, 0)' } : null,
      cancelOff: cancel?.disabled ?? null, retry: retry ? (retry.disabled ? 'off' : 'on') : null, error: c.querySelector('[data-chat-tile-rewind-error]')?.textContent.trim() ?? null,
      scopes: [...c.querySelectorAll('[data-chat-tile-rewind-scope]')].map((b) => [b.dataset.chatTileRewindScope, b.getAttribute('aria-checked')]), group: c.querySelector('[role="radiogroup"]') ? true : false,
      focus: a?.hasAttribute('data-chat-tile-rewind-cancel') ? 'cancel' : a?.hasAttribute('data-chat-tile-rewind-confirm') ? 'confirm' : a?.dataset?.chatTileRewindScope ? 'scope:' + a.dataset.chatTileRewindScope : a?.hasAttribute('data-flip-input') ? 'input' : (a?.tagName ?? null) }); })()`);
const rwLine = (k) => ev(`document.querySelector('${L} [data-chat-tile-rewind-line="${k}"]')?.textContent.trim() ?? null`);
const rwTraces = () => evj(`JSON.stringify([...document.querySelectorAll('${L} [data-chat-tile-rewind-trace]')].map((t) => [t.dataset.chatTileRewindTrace, t.textContent.trim(), !!t.closest('[data-item="note"]')]))`);
const hoverAt = async (expr) => {
  const r = await evj(`(() => { const e = ${expr}; if (!e) return 'null'; e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return JSON.stringify({ x: Math.round(b.left + b.width / 2), y: Math.round(b.top + b.height / 2) }); })()`);
  if (r) await mouse("mouseMoved", r.x, r.y, { buttons: 0 });
  await sleep(350);
};
const rwPicker = () =>
  evj(`(() => { const m = document.querySelector('[data-chat-tile-rewind-picker]'); if (!m) return 'null'; const rows = [...m.querySelectorAll('[role="option"]')]; const R = m.getBoundingClientRect(); const w = document.querySelector('${L} [data-flip-composer] .wrap').getBoundingClientRect();
    return JSON.stringify({ rows: rows.map((r) => r.dataset.chatTileRewindPick), sel: rows.find((r) => r.getAttribute('aria-selected') === 'true')?.dataset.chatTileRewindPick ?? null, quotes: rows.map((r) => r.querySelector('.crp-quote')?.textContent.trim()),
      empty: m.querySelector('[data-chat-tile-rewind-pick-empty]')?.textContent.trim() ?? null, focus: m.contains(document.activeElement), above: R.bottom <= w.top + 0.5,
      inside: R.left >= -0.5 && R.right <= innerWidth + 0.5 && R.top >= -0.5, minH: rows.length ? Math.min(...rows.map((r) => r.getBoundingClientRect().height)) : null }); })()`);
/** 기록을 깔고 한 턴을 끝내 기록 보기를 세운다 */
const seedRecord = async (chat, items, ready, users) => {
  await setRecord(items);
  await emit(ready, chat);
  await emit({ t: "turnStarted", turn: "r0" }, chat);
  await emit({ t: "turnEnded", turn: "r0", outcome: "ok", message: null }, chat);
  return waitFor(`document.querySelectorAll('${L} [data-item="user"]').length === ${users}`, 6000);
};
/** 단추 줄에 붙인 경고 — 낮은 카드에서만 보인다 */
const rwPin = () =>
  evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-rewind-card]'); const p = c?.querySelector('[data-chat-tile-rewind-pin]'); if (!p) return 'null'; const s = document.querySelector('${L} [data-viewer-body]');
    const P = p.getBoundingClientRect(), S = s.getBoundingClientRect(), C = c.getBoundingClientRect(); const conf = c.querySelector('[data-chat-tile-rewind-confirm]')?.getBoundingClientRect(); const dup = c.querySelector('[data-chat-tile-rewind-body] .line.pinned');
    return JSON.stringify({ key: p.dataset.chatTileRewindPin, text: p.textContent.trim(), shown: P.height > 0 && P.top >= Math.max(S.top, C.top) - 0.5 && P.bottom <= Math.min(S.bottom, C.bottom) + 0.5,
      nearBtn: !!conf && P.bottom <= conf.top + 0.5 && conf.top - P.bottom < 24, tight: c.hasAttribute('data-tight'), dupHidden: !dup || dup.getBoundingClientRect().height === 0 }); })()`);
/** 카드의 구르는 칸만 굴려 그 줄을 다 보이게 — `scrollIntoView` 는 대화 칸까지 굴려 단추 줄을 밀어낸다 */
const RW_MAIN_TO = `((m, el) => { const R = el.getBoundingClientRect(), M = m.getBoundingClientRect(); if (R.bottom > M.bottom) m.scrollTop += R.bottom - M.bottom; if (R.top < M.top) m.scrollTop -= M.top - R.top; })`;
/** 단추 줄 밑으로 깔리는 줄이 없는지 — 구르는 칸이 단추 줄 위에서 끝나고 · 범위 칸과 본문 마지막 줄을 굴려 다 보일 수 있다 · 처음엔 맨 위 */
const rwCover = () =>
  evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-rewind-card]'); if (!c) return 'null'; const m = c.querySelector('[data-chat-tile-rewind-main]'); const A = c.querySelector('[data-chat-tile-rewind-actions]').getBoundingClientRect();
    const M = m.getBoundingClientRect(); const atTop = m.scrollTop === 0; const t = c.querySelector('#' + c.getAttribute('aria-labelledby')); const q = c.querySelector('[data-chat-tile-rewind-quote]');
    const oneLine = (el) => !el || el.getBoundingClientRect().height <= (parseFloat(getComputedStyle(el).lineHeight) || 18) * 1.5;
    const reach = (el) => { ${RW_MAIN_TO}(m, el); const R = el.getBoundingClientRect(), M2 = m.getBoundingClientRect(), A2 = c.querySelector('[data-chat-tile-rewind-actions]').getBoundingClientRect();
      return R.height > 0 && R.top >= M2.top - 1 && R.bottom <= M2.bottom + 1 && R.bottom <= A2.top + 1; };
    const scopes = [...c.querySelectorAll('[data-chat-tile-rewind-scope]')].every(reach);
    const rows = [...c.querySelectorAll('[data-chat-tile-rewind-body] .line, [data-chat-tile-rewind-body] .error')].filter((x) => x.getBoundingClientRect().height > 0); const last = rows.length ? reach(rows[rows.length - 1]) : true;
    m.scrollTop = 0;
    return JSON.stringify({ tight: c.hasAttribute('data-tight'), atTop, mainAbove: M.bottom <= A.top + 0.5, oneLine: oneLine(t) && oneLine(q), scopes, last }); })()`);
const COVER_OK = { tight: true, atTop: true, mainAbove: true, oneLine: true, scopes: true, last: true };
const RW_KEYS = ["anchor", "chat", "dryRun", "epoch", "scope"];
const rwShape = (a) => [keysOfG(a), a.anchor, a.scope, a.dryRun];

gs = await openCT("claude", { permMode: null, cliMode: CMODE, commands: CLAUDE_CMDS });
let RC = gs.chat.chatId;
check("R 기록이 선다(사람 말 셋)", await seedRecord(RC, claudeRec, { ...READY_C, conversationId: RVC }, 3), true);
let r0 = await callCount();

await hoverAt(CT_HEAD);
// S16 기록 사람 줄 — 기준점 있는 줄에만 [되감기] · 호버 전 숨김 · 호버하면 보임 · 에이전트 줄 · 기준점 없는 줄에는 없음
let rbtns = await rwBtns();
check("S16 단추는 기준점 있는 사람 줄 둘에만 · 호버 전 숨김 · 이름 = 기본 범위(파일과 대화)",
  [rbtns.map((b) => b.a), rbtns.every((b) => b.user), rbtns.map((b) => b.op), rbtns[0]?.label], [UA, true, ["0", "0"], "이 메시지 전으로 되감기"]);
await hoverAt(`[...document.querySelectorAll('${L} [data-item="user"]')][1]`);
check("S16 호버 → 그 줄 단추가 보인다 · 복사 단추 곁", [(await rwBtns())[1]?.op, await ev(`!!${rwBtn(UA[1])}.closest('[data-msg-copy="user"]')?.querySelector('.mcopy-btn')`)], ["1", true]);
await shot("r-s16-hover.png");

// S17 누름 → dryRun · 범위 both(Claude 기본) · 카드 loading · [실행] 없음 · 첫 포커스 [취소]
await clickAt(rwBtn(UA[1]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await sleep(300);
let rc = await rwCalls(r0);
check("S17 chat_tile_rewind 몸 = {chat, epoch, anchor, scope, dryRun} 만 · both · dryRun:true", [rc.map(rwShape), rc[0]?.chat === RC], [[[RW_KEYS, UA[1], "both", true]], true]);
let rcard = await rwCard();
check("S17 카드 loading · 머리 · 인용 첫 줄 · 범위 셋(라디오 · 파일과 대화) · [실행] 없음 · 포커스 [취소]",
  [rcard.phase, rcard.role, rcard.title, rcard.quote, rcard.lines, rcard.group, rcard.scopes, rcard.confirm, rcard.focus],
  ["loading", "group", "이 메시지 전으로 되감기", "「둘째 메시지 — README 도 고쳐 줘」", ["files.loading"], true, [["both", "true"], ["conversation", "false"], ["files", "false"]], null, "cancel"]);
check("S17 loading 줄 \"확인하는 중\"", await rwLine("files.loading"), "되돌릴 파일을 확인하는 중…");
await shot("r-s17-loading.png");

// S18 preview{both, 파일 둘, +12 −3} → 목록 둘 · 줄 · 위험 색 [실행] · 포커스는 [취소] 그대로
await emit(pv(UA[1], "both", { files: ["src/a.ts", "README.md"], insertions: 12, deletions: 3 }), RC);
await sleep(300);
rcard = await rwCard();
check("S18 both ready — 줄(count · onlyTracked · 대화 지움) · 파일 둘 · [파일과 대화 되감기] 위험 색 · 포커스 [취소]",
  [rcard.phase, rcard.lines, rcard.files, rcard.confirm, rcard.focus, rcard.error], ["ready", ["files.count", "files.onlyTracked", "convo.claude"], ["src/a.ts", "README.md"], { text: "파일과 대화 되감기", disabled: false, danger: true }, "cancel", null]);
check("S18 count 줄에 +12 −3", (await rwLine("files.count"))?.includes("(+12 −3)"), true);
await shot("r-s18-both-ready.png");

// 범위 바꾸기 — [파일만] → 미리 보기 다시 · 50 + N개 더 · 목록은 안에서 구른다
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="files"]')`);
rc = await rwCalls(r0);
rcard = await rwCard();
check("범위 [파일만] → 새 미리 보기(dryRun · files) · 카드 loading · [실행] 걷힘", [rc.slice(1).map(rwShape), rcard.phase, rcard.confirm, rcard.scopes.find(([, c]) => c === "true")?.[0]], [[[RW_KEYS, UA[1], "files", true]], "loading", null, "files"]);
const FIFTY = Array.from({ length: 50 }, (_, i) => `src/mod-${String(i).padStart(2, "0")}/index.ts`);
await emit(pv(UA[1], "files", { files: FIFTY, moreFiles: 7, insertions: 80, deletions: 20 }), RC);
await sleep(300);
rcard = await rwCard();
check("파일만 ready — 줄(count · keepConvo · onlyTracked) · 목록 50 · \"… 7개 더\" · [파일 되돌리기]",
  [rcard.lines, rcard.files.length, rcard.more, rcard.confirm?.text], [["files.count", "files.keepConvo", "files.onlyTracked"], 50, "… 7개 더", "파일 되돌리기"]);
check("파일 목록은 안에서 구른다(여덟 줄 남짓)", await ev(`(() => { const l = document.querySelector('${L} [data-chat-tile-rewind-files]'); return l.scrollHeight > l.clientHeight && l.clientHeight < 200; })()`), true);
await shot("r-more-files.png");
// 같은 범위를 다시 눌러도(미리 보기 있음) 묻지 않는다 · 화살표 키 = 라디오
let rn = (await rwCalls(r0)).length;
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="files"]')`);
check("같은 범위 다시 누름 — 새 미리 보기 없음", (await rwCalls(r0)).length, rn);
await ev(`document.querySelector('${L} [data-chat-tile-rewind-scope="files"]').focus()`);
await press("ArrowLeft");
rc = await rwCalls(r0);
check("라디오 ← → [대화만] · 미리 보기 다시 · 포커스가 따라간다", [rc.slice(rn).map(rwShape), (await rwCard()).focus], [[[RW_KEYS, UA[1], "conversation", true]], "scope:conversation"]);
await emit(pv(UA[1], "conversation"), RC);
await sleep(300);
rcard = await rwCard();
check("대화만 ready — 줄(대화 지움 · 파일 그대로) · [대화 되감기] · 목록 없음", [rcard.lines, rcard.confirm?.text, rcard.files], [["convo.claude", "convo.claudeFilesStay"], "대화 되감기", []]);
await shot("r-convo-only.png");
// 되돌릴 파일 없음 · 파일 기록 없음
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="files"]')`);
await emit(pv(UA[1], "files"), RC);
await sleep(300);
check("파일 0 — 줄(none · keepConvo)", (await rwCard()).lines, ["files.none", "files.keepConvo"]);
await shot("r-nothing-to-restore.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="both"]')`);
await emit(pv(UA[1], "both", { can: false, error: "No file checkpoint found for this message." }), RC);
await sleep(300);
rcard = await rwCard();
check("S20 can:false(체크포인트 없음) — noCheckpoint · [대화만] 안내 · [실행] 없음 · 오류 줄 없음", [rcard.lines, rcard.confirm, rcard.error, rcard.retry], [["files.noCheckpoint", "both.convoOnly"], null, null, null]);
check("S20 문구에 '체크포인트' 없음", await ev(`document.querySelector('${L} [data-chat-tile-rewind-card]').textContent.includes('체크포인트')`), false);
await shot("r-s20-no-checkpoint.png");
check("여기까지 실행(dryRun:false) 0 — [실행]을 누르지 않았다", (await rwCalls(r0)).filter((a) => a.dryRun === false).length, 0);

// S19 both [실행] → dryRun:false · applying(흐림 · 취소 막힘 · Esc 무시 · 단추 막힘) → done files → done conversation
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="conversation"]')`);
await emit(pv(UA[1], "conversation"), RC);
await sleep(200);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="both"]')`);
await emit(pv(UA[1], "both", { files: ["src/a.ts", "README.md"], insertions: 12, deletions: 3 }), RC);
await sleep(300);
rn = (await rwCalls(r0)).length;
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
rc = await rwCalls(r0);
rcard = await rwCard();
check("S19 [실행] → 한 번 · dryRun:false · both · applying · [실행] 흐림 · [취소] 막힘", [rc.slice(rn).map(rwShape), rcard.phase, rcard.confirm?.disabled, rcard.cancelOff], [[[RW_KEYS, UA[1], "both", false]], "applying", true, true]);
check("S19 실행 중 기록 줄 단추 aria-disabled", (await rwBtns()).map((b) => b.dis), ["true", "true"]);
await press("Escape");
check("S19 실행 중 Esc 는 닫지 않는다", (await rwCard())?.phase, "applying");
await shot("r-s19-applying.png");
const trBefore = (await trCalls(0)).length;
await setRecord(claudeRec.slice(0, 2));
await emit(rwDone(UA[1], "files", { skippedLinks: 0 }), RC);
await sleep(200);
check("S19 both — 파일 쪽 done 뒤에도 대화 쪽을 기다린다", (await rwCard())?.phase, "applying");
await emit(rwDone(UA[1], "conversation"), RC);
await waitFor(`!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await waitFor(`document.querySelectorAll('${L} [data-item="user"]').length === 1`, 4000);
await sleep(300);
let trAfter = await trCalls(0);
check("S19 카드 닫힘 · 흔적 both · 기록을 처음부터 다시 읽음(before:null) · 잘린 대화",
  [await rwCard(), await rwTraces(), trAfter.length > trBefore, trAfter.slice(trBefore).some((a) => a.before === null), await ev(`document.querySelectorAll('${L} [data-item="user"]').length`)],
  [null, [["both", "「둘째 메시지 — README 도 고쳐 줘」 전으로 파일과 대화를 되감았습니다", true]], true, true, 1]);
check("S22 빈 입력 칸에 되감은 글 · 보내지 않음 · 포커스 입력 칸", [(await fieldState()).value, (await fieldState()).focus, (await callsOf("chat_tile_send", r0)).length], [U2_TEXT, true, 0]);
await shot("r-s19-trace-prefill.png");
await setField("");

// 파일만 done → 흔적(파일 수 · 연결) · 기록 다시 읽기 없음 · 입력 칸 그대로
await hoverAt(`document.querySelector('${L} [data-item="user"]')`);
await clickAt(rwBtn(UA[0]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
// 범위 고르기는 미리 보기가 온 뒤에만 받는다
await emit(pv(UA[0], "both", { files: ["src/a.ts"], insertions: 1, deletions: 1 }), RC);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="files"]')`);
await emit(pv(UA[0], "files", { files: ["src/a.ts"], insertions: 1, deletions: 1 }), RC);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
const trF = (await trCalls(0)).length;
await emit(rwDone(UA[0], "files", { skippedLinks: 2 }), RC);
await waitFor(`!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await sleep(900);
check("파일만 done — 흔적 files(파일 1 · 연결 2) · 기록 다시 읽기 없음 · 입력 칸 빈 채",
  [(await rwTraces()).pop(), (await trCalls(0)).length, (await fieldState()).value],
  [["files", "파일 1개를 「첫 메시지 — src/a.ts 를 고쳐 줘」 전으로 되돌렸습니다 · 대화는 그대로입니다 (연결 2개는 되돌리지 못했습니다)", true], trF, ""]);
await shot("r-files-trace.png");

// both 반쪽 실패 — 파일은 되돌림 · 대화 거절 → 카드 남음 · 오류 · [다시 시도] · 흔적 files
await clickAt(rwBtn(UA[0]));
await emit(pv(UA[0], "both", { files: ["src/a.ts"], insertions: 1, deletions: 1 }), RC);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
const tracesN = (await rwTraces()).length;
await emit(rwDone(UA[0], "files", { skippedLinks: 0 }), RC);
await emit(rwFailed(UA[0], "conversation", "stale_target"), RC);
await sleep(300);
rcard = await rwCard();
check("반쪽 실패 — 카드 ready · \"파일은 되돌렸지만 …\" · [실행] 없음 · [다시 시도] · 흔적 files 하나 더",
  [rcard?.phase, rcard?.error, rcard?.confirm, rcard?.retry, (await rwTraces()).length - tracesN, (await rwTraces()).pop()?.[0]],
  ["ready", "파일은 되돌렸지만 대화는 되감지 못했습니다 — CLI가 되감기를 거절했습니다 (CLI: stale_target)", null, "on", 1, "files"]);
await shot("r-partial-failure.png");
rn = (await rwCalls(r0)).length;
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-retry]')`);
check("[다시 시도] → 같은 범위 미리 보기", (await rwCalls(r0)).slice(rn).map(rwShape), [[RW_KEYS, UA[0], "both", true]]);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
check("[취소] → 카드 닫힘 · 포커스 입력 칸", [await rwCard(), (await fieldState()).focus], [null, true]);

// 글이 있는 입력 칸은 건드리지 않는다
await setField("내가 친 글");
await clickAt(rwBtn(UA[0]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await emit(pv(UA[0], "both", { files: [], insertions: 0, deletions: 0 }), RC);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="conversation"]')`);
await emit(pv(UA[0], "conversation"), RC);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
let trN = (await trCalls(0)).length;
await setRecord(claudeRec.slice(0, 2));
await emit(rwDone(UA[0], "conversation"), RC);
await waitFor(`!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await sleep(600);
check("S22 글이 있던 칸은 그대로 · 기록 다시 읽음 · 보내기 없음", [(await fieldState()).value, (await trCalls(0)).length > trN, (await callsOf("chat_tile_send", r0)).length], ["내가 친 글", true, 0]);

// S23 다른 창의 대화 되감기(이 창은 묻지 않음) → 흔적 convoOther · 기록 다시 · 입력 칸 그대로
trN = (await trCalls(0)).length;
await emit(rwDone(UA[0], "conversation"), RC);
await sleep(700);
check("S23 다른 창 done{conversation} → 흔적 convoOther · 기록 다시 · 칸 그대로 · 카드 없음",
  [(await rwTraces()).pop(), (await trCalls(0)).length > trN, (await fieldState()).value, await rwCard()],
  [["conversation", "다른 창에서 대화를 되감았습니다 · 파일은 그대로입니다", true], true, "내가 친 글", null]);
await setField("");
await setRecord(claudeRec);
await emit({ t: "turnStarted", turn: "r1" }, RC);
await emit({ t: "turnEnded", turn: "r1", outcome: "ok", message: null }, RC);
await waitFor(`document.querySelectorAll('${L} [data-item="user"]').length === 3`, 6000);

// S25 카드가 열린 채 턴이 서면 — 오류 줄 · [실행] 없음 · [다시 시도] 막힘 / S24 턴 중 단추 aria-disabled · 누름 무시
await clickAt(rwBtn(UA[1]));
await emit(pv(UA[1], "both", { files: ["src/a.ts"], insertions: 1, deletions: 1 }), RC);
await sleep(300);
await emit({ t: "turnStarted", turn: "r2" }, RC);
await sleep(300);
rcard = await rwCard();
check("S25 turnStarted → 오류 줄(턴) · [실행] 없음 · [다시 시도] 막힘", [rcard?.error, rcard?.confirm, rcard?.retry], ["턴이 끝난 뒤 다시 해 보세요", null, "off"]);
await shot("r-s25-turn-started.png");
rn = (await rwCalls(r0)).length;
rbtns = await rwBtns();
await clickAt(rwBtn(UA[0]));
check("S24 턴 중 — 단추 aria-disabled · title 안내 · 누름 → invoke 없음",
  [rbtns.map((b) => b.dis), await ev(`${rwBtn(UA[0])}.title`), (await rwCalls(r0)).length - rn], [["true", "true"], "턴이 끝난 뒤 되감을 수 있습니다", 0]);
await emit({ t: "turnEnded", turn: "r2", outcome: "ok", message: null }, RC);
await sleep(600);
check("턴 뒤 [다시 시도] 켜짐", (await rwCard())?.retry, "on");
// S28 Esc(카드에 포커스) → 닫힘 · invoke 없음 · 입력 칸으로
await ev(`document.querySelector('${L} [data-chat-tile-rewind-cancel]').focus()`);
rn = (await rwCalls(r0)).length;
await press("Escape");
check("S28 Esc → 카드 닫힘 · 서버에 보내지 않음 · 포커스 입력 칸", [await rwCard(), (await rwCalls(r0)).length - rn, (await fieldState()).focus], [null, 0, true]);

// op 거절 — [nothing-to-rewind] 문구 · [다시 시도]
await ev(`(window.__ctRewindFail = '[nothing-to-rewind] no turn has finished in this conversation yet', 1)`);
await clickAt(rwBtn(UA[1]));
await sleep(400);
rcard = await rwCard();
check("미리 보기 op 거절 → 카드 남음 · 이유 문구 · [다시 시도] · [실행] 없음", [rcard?.phase, rcard?.error, rcard?.retry, rcard?.confirm], ["ready", "아직 끝난 턴이 없어 되감을 것이 없습니다", "on", null]);
await shot("r-op-refused.png");
await ev(`(window.__ctRewindFail = null, 1)`);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-retry]')`);
await emit(pv(UA[1], "both", { files: ["src/a.ts"], insertions: 1, deletions: 1 }), RC);
await sleep(300);
check("[다시 시도] 뒤 미리 보기 → [실행] · 사라진 [다시 시도]의 포커스는 [취소]로", [(await rwCard())?.confirm?.text, (await rwCard())?.focus], ["파일과 대화 되감기", "cancel"]);

// 한 번에 하나 — 카드가 열린 채 모드 칩 → 카드 거둠 · 모드 메뉴
await clickAt(`document.querySelector('${L} [data-chat-tile-mode-chip]')`);
check("한 번에 하나 — 모드 메뉴가 열리면 카드는 닫힌다", [await waitFor(`!!document.querySelector('[data-chat-tile-mode-menu]')`, 2000), await rwCard()], [true, null]);
await press("Escape");

// S26 `/rewind` Enter → 보내지 않음 · 고르기 메뉴(최신 위 · 기준점 줄만) · ↓ Enter → 카드 · `/checkpoint` 도 · 줄 누름
rn = (await rwCalls(r0)).length;
await setField("/rewind");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-rewind-picker]')`, 3000);
let pk = await rwPicker();
check("S26 /rewind → chat_tile_send 없음 · 칸 비움 · 메뉴 = 최신 위 · 기준점 줄만 · 첫 줄 고름 · 포커스 메뉴 · 입력 칸 위",
  [(await callsOf("chat_tile_send", r0)).length, (await fieldState()).value, pk?.rows, pk?.sel, pk?.focus, pk?.above, pk?.inside, pk?.quotes?.[0]],
  [0, "", [UA[1], UA[0]], UA[1], true, true, true, "둘째 메시지 — README 도 고쳐 줘"]);
await shot("r-s26-picker.png");
await press("ArrowDown");
check("S26 ↓ → 둘째 줄", (await rwPicker())?.sel, UA[0]);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
check("S26 Enter → 메뉴 닫힘 · 그 줄 카드(dryRun)", [await rwPicker(), (await rwCalls(r0)).slice(rn).map(rwShape), (await rwCard())?.quote], [null, [[RW_KEYS, UA[0], "both", true]], "「첫 메시지 — src/a.ts 를 고쳐 줘」"]);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
await setField("/checkpoint");
await sleep(200);
await press("Enter");
check("S26 /checkpoint 도 고르기 메뉴", await waitFor(`!!document.querySelector('[data-chat-tile-rewind-picker]')`, 3000), true);
rn = (await rwCalls(r0)).length;
await clickAt(`document.querySelector('[data-chat-tile-rewind-picker] [data-chat-tile-rewind-pick="${UA[1]}"]')`);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
check("S26 줄 누름(runOnMenu) → 카드 · 예외 없음", [(await rwCalls(r0)).slice(rn).map((a) => a.anchor), errors.slice()], [[UA[1]], []]);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
await setField("/rewind");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-rewind-picker]')`, 3000);
await press("Escape");
check("S26 메뉴 Esc → 닫힘 · 입력 칸으로 · invoke 없음", [await rwPicker(), (await fieldState()).focus], [null, true]);
await setField("/rewind");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-rewind-picker]')`, 3000);
await clickAt(`document.querySelector('${L} [data-chat-tile-mode-chip]')`);
check("한 번에 하나 — 모드 칩 누름 → 고르기 메뉴 닫힘", [await rwPicker(), await waitFor(`!!document.querySelector('[data-chat-tile-mode-menu]')`, 2000)], [null, true]);
await press("Escape");
await setRecord([]);
await setField("/rewind");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-rewind-picker]')`, 3000);
check("S26 되감을 말이 없으면 안내 줄", (await rwPicker())?.empty, "되감을 수 있는 메시지가 없습니다");
await shot("r-s26-picker-empty.png");
await press("Escape");
await setRecord(claudeRec);

// 작은 타일(560×400) — 카드는 대화 칸 높이까지 · 단추 줄 보임 · 목록만 안에서 구른다 · 입력 칸 보임
await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 400, deviceScaleFactor: 1, mobile: false });
await sleep(600);
await hoverAt(rwBtn(UA[1]));
await clickAt(rwBtn(UA[1]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await sleep(300);
check("작은 타일 loading — 단추 줄 밑에 깔린 줄 없음 · 범위 칸 · 마지막 줄 닿음 · 머리 한 줄", await rwCover(), COVER_OK);
await shot("r-small-tile-loading.png");
await emit(pv(UA[1], "both", { files: FIFTY, moreFiles: 3, insertions: 80, deletions: 20 }), RC);
await sleep(600);
check("작은 타일 ready(both) — 단추 줄 밑에 깔린 줄 없음 · 범위 칸 · 마지막 줄 닿음 · 맨 위에서 시작", await rwCover(), COVER_OK);
const smallFit = await evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-rewind-card]'); const s = document.querySelector('${L} [data-viewer-body]'); const a = c.querySelector('[data-chat-tile-rewind-actions]'); const w = document.querySelector('${L} [data-flip-composer] .wrap');
  const C = c.getBoundingClientRect(), S = s.getBoundingClientRect(), A = a.getBoundingClientRect(), W2 = w.getBoundingClientRect();
  return JSON.stringify({ body: c.querySelector('[data-chat-tile-rewind-body]').getBoundingClientRect().height > 40, fits: C.height <= Math.max(S.height, 140) + 0.5, actions: A.top >= S.top - 0.5 && A.bottom <= S.bottom + 0.5, composer: W2.bottom <= innerHeight + 0.5 && W2.top >= S.bottom - 0.5, noX: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
check("작은 타일 — 카드가 대화 칸 안 · 본문이 접히지 않음(카드가 구름 · 높이 하한 140 은 권한 카드와 같다) · 단추 줄 보임 · 입력 칸 보임 · 가로 넘침 없음", smallFit, { body: true, fits: true, actions: true, composer: true, noX: true });
await shot("r-small-tile.png");
const ONLY_TRACKED = "Claude의 편집 도구가 건드린 파일을 그때 내용으로 되돌립니다 — 그 뒤 누가 고쳤든 사라집니다";
check("작은 타일 both — [실행] 곁에 파일 경고(되돌릴 수 없는 쪽) · 구르지 않고 보임 · 본문의 같은 줄은 숨김",
  await rwPin(), { key: "files.onlyTracked", text: ONLY_TRACKED, shown: true, nearBtn: true, tight: true, dupHidden: true });
await ev(`(() => { const m = document.querySelector('${L} [data-chat-tile-rewind-main]'); m.scrollTop = 120; return 1; })()`);
await sleep(200);
check("작은 타일 — 본문을 굴려도 경고는 단추 곁에 남는다", (await rwPin())?.shown, true);
await shot("r-small-tile-scrolled.png");
// 범위 칸은 굴려서 실제로 누를 수 있다(단추 줄에 가리지 않는다)
await ev(`(${RW_MAIN_TO}(document.querySelector('${L} [data-chat-tile-rewind-main]'), document.querySelector('${L} [data-chat-tile-rewind-scope="conversation"]')), 1)`);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="conversation"]')`);
check("작은 타일 — 범위 칸 누름이 닿는다(conversation 미리 보기)", (await rwCalls(r0)).pop()?.scope, "conversation");
await emit(pv(UA[1], "conversation"), RC);
await sleep(400);
check("작은 타일 대화만 — 경고는 \"Claude는 그 부분을 잊습니다\"", [(await rwPin())?.key, (await rwPin())?.shown], ["convo.claude", true]);
// 사람이 굴린 자리는 범위를 바꿔도 그대로다 — 여기서는 맨 위를 보지 않는다
check("작은 타일 대화만 — 단추 줄 밑에 깔린 줄 없음", { ...(await rwCover()), atTop: true }, COVER_OK);
await shot("p-small-claude-convo-pin.png");
// 다시 할 수 없는 실패 — [실행]이 사라지면 포커스는 [취소]
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
await emit(rwFailed(UA[1], "conversation", "before_compact"), RC);
await sleep(400);
rcard = await rwCard();
check("작은 타일 before_compact — [취소]만 · 포커스 [취소] · 단추 줄 밑에 깔린 줄 없음",
  [rcard?.error, rcard?.confirm, rcard?.retry, rcard?.focus, await rwCover()], ["압축 전 메시지로는 되감을 수 없습니다", null, null, "cancel", COVER_OK]);
await shot("p-small-before-compact.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);

// 다시 해도 같은 실패 — 압축 전 기준점(서버가 읽은 낱말) · 없는 기준점 → [다시 시도] 없음 · 일반 실패에는 CLI 낱말
await hoverAt(rwBtn(UA[0]));
await clickAt(rwBtn(UA[0]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await emit(pv(UA[0], "both", { files: [], insertions: 0, deletions: 0 }), RC);
await sleep(300);
check("큰 타일 — 단추 곁 경고는 숨김(본문에 있다)", await ev(`document.querySelector('${L} [data-chat-tile-rewind-pin]')?.getBoundingClientRect().height ?? 0`), 0);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="conversation"]')`);
await emit(pv(UA[0], "conversation"), RC);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
await emit(rwFailed(UA[0], "conversation", "before_compact"), RC);
await sleep(300);
rcard = await rwCard();
check("before_compact → \"압축 전 메시지로는 되감을 수 없습니다\" · [다시 시도] 없음 · [실행] 없음 · [취소] · 포커스 [취소]",
  [rcard?.error, rcard?.retry, rcard?.confirm, rcard?.cancelOff, rcard?.focus], ["압축 전 메시지로는 되감을 수 없습니다", null, null, false, "cancel"]);
await shot("p-before-compact.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
await hoverAt(rwBtn(UA[0]));
await clickAt(rwBtn(UA[0]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await emit(pv(UA[0], "both", { files: [], insertions: 0, deletions: 0 }), RC);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-scope="conversation"]')`);
await emit(pv(UA[0], "conversation"), RC);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
await emit(rwFailed(UA[0], "conversation", "target_not_found"), RC);
await sleep(300);
rcard = await rwCard();
check("target_not_found → 일반 실패 + CLI 낱말 · [다시 시도] 없음 · 포커스 [취소]", [rcard?.error, rcard?.retry, rcard?.focus], ["CLI가 되감기를 거절했습니다 (CLI: target_not_found)", null, "cancel"]);
await shot("p-not-retryable.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);

// 그림만 보낸 메시지 — 고르기 메뉴 · 카드 인용이 비지 않는다
const IMG_A = "30b5bc5c-33b6-47d1-802c-c06d0d28a933";
await setRecord([...claudeRec, rec("user", null, RT0 - 3000, { anchor: IMG_A, images: 1 }), rec("assistant", "그림을 봤습니다.", RT0 - 2000)]);
await setField("/rewind");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-rewind-picker]')`, 3000);
pk = await rwPicker();
check("그림만 보낸 메시지 — 고르기 메뉴 줄 인용 = \"그림만 보낸 메시지\"", [pk?.rows?.[0], pk?.quotes?.[0]], [IMG_A, "그림만 보낸 메시지"]);
await shot("p-picker-image-only.png");
await clickAt(`document.querySelector('[data-chat-tile-rewind-picker] [data-chat-tile-rewind-pick="${IMG_A}"]')`);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
check("그림만 보낸 메시지 — 카드 인용", (await rwCard())?.quote, "「그림만 보낸 메시지」");
await shot("p-card-image-only.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
await setRecord(claudeRec);
await closeCT(gs);

// S21 · S22 Codex — 대화만 · 범위 고르기 없음 · 턴 수 · 기록 기준 바뀐 파일 · "Codex는 파일을 되돌리지 않습니다" · done → 다시 읽기 · 빈 칸에 글
gs = await openCT("codex", { cli: "codex", permMode: null, cliMode: { mode: "readOnly", choices: ["readOnly", "auto", "plan"] } });
let RX = gs.chat.chatId;
check("S21 Codex 기록이 선다", await seedRecord(RX, codexRec, { t: "ready", cli: "codex", version: "0.172.0", model: "gpt-6-sol", models: [], efforts: {}, conversationId: RVC }, 2), true);
r0 = await callCount();
check("S21 Codex 단추 이름 = 대화 되감기", (await rwBtns()).map((b) => [b.a, b.label]), [[TA[0], "이 메시지 전으로 대화 되감기"], [TA[1], "이 메시지 전으로 대화 되감기"]]);
await hoverAt(`[...document.querySelectorAll('${L} [data-item="user"]')][1]`);
await clickAt(rwBtn(TA[1]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await sleep(200);
rcard = await rwCard();
check("S21 Codex → dryRun · conversation · 카드 loading · 범위 고르기 없음 · 머리 대화 되감기",
  [(await rwCalls(r0)).map(rwShape), rcard.phase, rcard.group, rcard.title, rcard.lines], [[[RW_KEYS, TA[1], "conversation", true]], "loading", false, "대화 되감기", ["convo.loading"]]);
await emit(pv(TA[1], "conversation", { turns: 2 }), RX);
await sleep(300);
rcard = await rwCard();
check("S21 Codex ready — count · forget · filesStay · filesHint + 목록(기록 기준) · codexFiles · [대화 되감기]",
  [rcard.lines, rcard.files, rcard.confirm?.text, rcard.confirm?.danger], [["convo.count", "convo.forget", "convo.filesStay", "convo.filesHint", "convo.codexFiles"], ["README.md"], "대화 되감기", true]);
check("S21 Codex 문구 — 턴 수 · git 안내(터미널 모양 약속 없음)", [await rwLine("convo.count"), await rwLine("convo.codexFiles"), await ev(`document.querySelector('${L} [data-chat-tile-rewind-card]').textContent.includes('터미널 모양')`)],
  ["이 메시지부터 턴 2개가 대화에서 빠집니다", "Codex는 파일을 되돌리지 않습니다 — 필요하면 git으로 되돌리세요", false]);
await shot("r-s21-codex-card.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
check("S22 Codex [실행] → dryRun:false", (await rwCalls(r0)).filter((a) => a.dryRun === false).map(rwShape), [[RW_KEYS, TA[1], "conversation", false]]);
trN = (await trCalls(0)).length;
await setRecord(codexRec.slice(0, 2));
await emit(rwDone(TA[1], "conversation", { turns: 2 }), RX);
await waitFor(`document.querySelectorAll('${L} [data-item="user"]').length === 1`, 4000);
await sleep(300);
check("S22 Codex done — 카드 닫힘 · 흔적 convo · 처음부터 다시(before:null) · 빈 칸에 글 · 보내기 없음",
  [await rwCard(), (await rwTraces()).pop(), (await trCalls(0)).slice(trN).some((a) => a.before === null), (await fieldState()).value, (await callsOf("chat_tile_send", r0)).length],
  [null, ["conversation", "「둘째 턴 — README 를 고쳐 줘」 전으로 대화를 되감았습니다 · 파일은 그대로입니다", true], true, "둘째 턴 — README 를 고쳐 줘", 0]);
await shot("r-s22-codex-after.png");
await setField("");

// 작은 Codex 타일(창 560×400 — 타일은 실측의 519×329 남짓) — [대화 되감기]가 보이면 "Codex는 빠진 내용을 잊습니다" 도 보인다
await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 400, deviceScaleFactor: 1, mobile: false });
await sleep(600);
await hoverAt(rwBtn(TA[0]));
await clickAt(rwBtn(TA[0]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await sleep(300);
check("작은 Codex 카드 loading — 단추 줄 밑에 깔린 줄 없음", await rwCover(), COVER_OK);
await emit(pv(TA[0], "conversation", { turns: 1 }), RX);
await sleep(600);
check("작은 Codex 카드 ready — 단추 줄 밑에 깔린 줄 없음 · 마지막 줄 닿음", await rwCover(), COVER_OK);
check("작은 Codex 카드 — 단추 곁에 forget 경고 · 보임",
  await rwPin(), { key: "convo.forget", text: "Codex는 빠진 내용을 잊습니다 — 되감은 뒤에는 다시 불러올 수 없습니다", shown: true, nearBtn: true, tight: true, dupHidden: true });
await shot("p-small-codex-pin.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
await emit(rwFailed(TA[0], "conversation", "target_not_found"), RX);
await sleep(400);
rcard = await rwCard();
check("작은 Codex 카드 실패 — [실행] 없음 · 포커스 [취소] · 단추 줄 밑에 깔린 줄 없음", [rcard?.confirm, rcard?.focus, await rwCover()], [null, "cancel", COVER_OK]);
await shot("p-small-codex-failed.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
await hoverAt(rwBtn(TA[0]));
await clickAt(rwBtn(TA[0]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await emit(pv(TA[0], "conversation", { turns: 1 }), RX);
await sleep(400);
await send("Emulation.setDeviceMetricsOverride", { width: 255, height: 420, deviceScaleFactor: 1, mobile: false });
await sleep(600);
check("아주 좁은 Codex 카드(255) — 경고 보임 · 가로 넘침 없음", [(await rwPin())?.shown, await ev(`document.documentElement.scrollWidth <= innerWidth + 1`)], [true, true]);
await shot("p-tiny-codex-card.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
await sleep(300);
await shot("p-tiny-codex-no-card.png");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);

// 빈 대화로 되감음 — 기록 줄이 없어도 흔적은 보인다(빈 안내 대신)
await hoverAt(rwBtn(TA[0]));
await clickAt(rwBtn(TA[0]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await emit(pv(TA[0], "conversation", { turns: 1 }), RX);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
await setRecord([]);
await emit(rwDone(TA[0], "conversation", { turns: 1 }), RX);
await waitFor(`document.querySelectorAll('${L} [data-item="user"]').length === 0`, 4000);
await sleep(500);
check("빈 대화 — 흔적 줄이 보인다 · 빈 안내 없음",
  [(await rwTraces()).pop(), await ev(`!!document.querySelector('${L} [data-viewer-empty]')`)],
  [["conversation", "「첫 턴 — 계획을 세워 줘」 전으로 대화를 되감았습니다 · 파일은 그대로입니다", true], false]);
await shot("p-empty-convo-trace.png");
await setField("");

// 압축 끝 줄은 다음 턴 뒤에도 남는다(이 창이 본 것만 · 메모리뿐)
await setRecord(codexRec.slice(0, 2));
await emit({ t: "turnStarted", turn: "c1" }, RX);
await emit({ t: "compaction", phase: "started", trigger: "manual", preTokens: null, postTokens: null }, RX);
await emit({ t: "compaction", phase: "done", trigger: "manual", preTokens: 36241, postTokens: 8335 }, RX);
await emit({ t: "turnEnded", turn: "c1", outcome: "ok", message: null }, RX);
await sleep(400);
await emit({ t: "turnStarted", turn: "c2" }, RX);
await emit({ t: "turnEnded", turn: "c2", outcome: "ok", message: null }, RX);
await sleep(900);
check("다음 턴 뒤 — 꼬리 알림은 걷혀도 압축 줄 하나가 기록 쪽에 남는다",
  await evj(`JSON.stringify({ trace: [...document.querySelectorAll('${L} [data-chat-tile-compact-trace]')].map((e) => [e.textContent.trim(), !!e.closest('[data-item="note"]')]), tail: document.querySelectorAll('${L} [data-chat-tile-notice="compacted"]').length })`),
  { trace: [["맥락을 압축했습니다 — 압축 전 36.2k 토큰", true]], tail: 0 });
await shot("p-compact-kept.png");
// S27 Codex /undo 는 이제 그 CLI 의 명령이 아니다(13-2) — 터미널 전용 줄 없음 · 글로 간다
await setField("/undo");
await sleep(200);
gm = await slashMenu();
check("S27 Codex /undo — 메뉴에 undo 줄 없음 · 터미널 안내 없음(글로 간다)", [gm?.rows?.includes("undo") ?? false, gm?.empty, await slashNoteOf()], [false, true, null]);
await setField("");
await closeCT(gs);
await ev(`(window.__ctSnap = null, 1)`);
check("R 메인 PC 예외 0", errors.slice(), []);

// ═══ V. 검토 · 목표 · MCP 상태 · 속도(7단계 — docs/log/2026-11-28-chat-tile-stage7-contract.md 7절 FE-B · 13절) ════════════
// S31–S45: MCP 풍선(연 때 한 번 묻기 · 허용 칸만 · 느림 · 시한 · 로그인 안내) · Claude `/goal` 은 보냄 + 안내 줄 · Codex 검토 카드(대상 넷 · 미리 채움 ·
// 턴 중 막힘 · 표지) · 목표 카드 · 띠(상태 · 단추 · 밖에서 정한 목표) · [중지] · 속도 줄 · 칩 · `/fast` · 떠 있는 것 하나만 · 작은 타일 · 원격 · 폰.
errors.length = 0;
const VSECRET = { url: "https://u:SECRET-pw@h", headers: { Authorization: "SECRET-h" }, error: "SECRET-err", config: { command: "x", args: ["--ticket", "SECRET-ticket"], env: { K: "SECRET-env" } } };
const MCP_ROWS = [
  { name: "blender", state: "connected", auth: null, tools: 5, scope: "user" },
  { name: "aynx-sessions", state: "connected", auth: null, tools: 14, scope: "app", aynx: true },
  { name: "claude.ai Gmail", state: "needsAuth", auth: null, tools: null, scope: "cloud" },
  { name: "tavily", state: "connecting", auth: null, tools: null, scope: "app", picked: true },
  { name: "zeta", state: "failed", auth: null, tools: null, scope: "user" },
];
const mcpPop = () =>
  evj(`(() => { const p = document.querySelector('[data-chat-tile-mcp-popover]'); if (!p) return 'null'; const R = p.getBoundingClientRect(); const w = document.querySelector('${L} [data-flip-composer] .wrap')?.getBoundingClientRect();
    const rows = [...p.querySelectorAll('[data-chat-tile-mcp-row]')];
    return JSON.stringify({ rows: rows.map((r) => r.dataset.chatTileMcpRow), states: rows.map((r) => r.querySelector('[data-chat-tile-mcp-state]')?.textContent.trim()),
      tools: rows.map((r) => r.querySelector('[data-chat-tile-mcp-tools]')?.textContent.trim() ?? null), tags: rows.map((r) => [...r.querySelectorAll('[data-chat-tile-mcp-tag]')].map((x) => x.textContent.trim()).join('+')),
      login: rows.filter((r) => r.querySelector('[data-chat-tile-mcp-login]')).map((r) => r.dataset.chatTileMcpRow), asking: !!p.querySelector('[data-chat-tile-mcp-asking]'),
      askText: p.querySelector('[data-chat-tile-mcp-asking]')?.textContent.trim() ?? null, dim: p.querySelector('[data-chat-tile-mcp-dim]')?.textContent.trim() ?? null,
      error: p.querySelector('[data-chat-tile-mcp-error]')?.textContent.trim() ?? null, empty: !!p.querySelector('[data-chat-tile-mcp-empty]'), secret: p.textContent.includes('SECRET'),
      buttons: [...p.querySelectorAll('button')].map((b) => b.dataset.chatTileMcpRefresh !== undefined ? 'refresh' : b.textContent.trim()),
      inside: R.left >= -0.5 && R.right <= innerWidth + 0.5 && R.top >= -0.5 && R.bottom <= innerHeight + 0.5, above: !!w && R.bottom <= w.top + 0.5, noX: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
const mcpAsks = (from) => callsOf("chat_tile_mcp_status", from);
const reviewCard = () =>
  evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-review-card]'); if (!c) return 'null'; const C = c.getBoundingClientRect(); const go = c.querySelector('[data-chat-tile-review-start]'); const a = c.querySelector('[data-chat-tile-review-actions]').getBoundingClientRect();
    const body = document.querySelector('${L} [data-viewer-body]').getBoundingClientRect();
    return JSON.stringify({ kind: c.dataset.kind, checked: c.querySelector('[role="radio"][aria-checked="true"]')?.dataset.chatTileReviewKind ?? null, radios: c.querySelectorAll('[role="radio"]').length,
      group: c.getAttribute('role') === 'group' && !!document.getElementById(c.getAttribute('aria-labelledby') ?? ''),
      focus: document.activeElement?.dataset?.chatTileReviewKind ?? (c.contains(document.activeElement) ? document.activeElement.tagName : null),
      branch: c.querySelector('[data-chat-tile-review-branch]')?.value ?? null, sha: c.querySelector('[data-chat-tile-review-sha]')?.value ?? null, instr: c.querySelector('[data-chat-tile-review-instructions]')?.value ?? null,
      inline: !!c.querySelector('[data-chat-tile-review-inline]'), why: c.querySelector('[data-chat-tile-review-why]')?.textContent.trim() ?? null, go: go ? !go.disabled : null,
      error: c.querySelector('[data-chat-tile-review-error]')?.textContent.trim() ?? null,
      actionsSeen: a.bottom <= body.bottom + 1 && a.top >= body.top - 1, inside: C.left >= -0.5 && C.right <= innerWidth + 0.5, noX: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
const goalCard = () =>
  evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-goal-card]'); if (!c) return 'null'; const go = c.querySelector('[data-chat-tile-goal-set]'); const a = c.querySelector('[data-chat-tile-goal-actions]').getBoundingClientRect();
    const body = document.querySelector('${L} [data-viewer-body]').getBoundingClientRect(); const C = c.getBoundingClientRect();
    return JSON.stringify({ objective: c.querySelector('[data-chat-tile-goal-objective]')?.value ?? null, budget: c.querySelector('[data-chat-tile-goal-budget][aria-checked="true"]')?.dataset.chatTileGoalBudget ?? null,
      budgets: [...c.querySelectorAll('[data-chat-tile-goal-budget]')].map((b) => b.textContent.trim()), count: c.querySelector('[data-chat-tile-goal-count]')?.textContent.trim() ?? null,
      warn: c.querySelector('[data-chat-tile-goal-warn]')?.textContent.trim() ?? null, replace: !!c.querySelector('[data-chat-tile-goal-replace]'), why: c.querySelector('[data-chat-tile-goal-why]')?.textContent.trim() ?? null,
      focus: document.activeElement?.hasAttribute?.('data-chat-tile-goal-objective') ?? false, go: go ? !go.disabled : null, error: c.querySelector('[data-chat-tile-goal-error]')?.textContent.trim() ?? null,
      group: c.getAttribute('role') === 'group', actionsSeen: a.bottom <= body.bottom + 1 && a.top >= body.top - 1, inside: C.left >= -0.5 && C.right <= innerWidth + 0.5, noX: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
const goalBand = () =>
  evj(`(() => { const b = document.querySelector('${L} [data-chat-tile-goal]'); if (!b) return 'null'; const B = b.getBoundingClientRect(); const w = document.querySelector('${L} [data-flip-composer] .wrap')?.getBoundingClientRect();
    const chip = document.querySelector('${L} [data-chat-tile-mode-chip]')?.getBoundingClientRect(); const btns = [...b.querySelectorAll('button[data-chat-tile-goal-pause], button[data-chat-tile-goal-resume], button[data-chat-tile-goal-clear]')];
    const row = b.querySelector('.row').getBoundingClientRect();
    return JSON.stringify({ status: b.dataset.chatTileGoal, tone: b.dataset.tone, word: b.querySelector('[data-chat-tile-goal-status]')?.textContent.trim(), tokens: b.querySelector('[data-chat-tile-goal-tokens] .num')?.textContent.trim(),
      head: b.querySelector('[data-chat-tile-goal-objective-line]')?.textContent.trim(), title: b.querySelector('[data-chat-tile-goal-objective-line]')?.title ?? null,
      buttons: btns.map((x) => x.dataset.chatTileGoalPause !== undefined ? 'pause' : x.dataset.chatTileGoalResume !== undefined ? 'resume' : 'clear'), titles: btns.map((x) => x.title),
      auto: b.querySelector('[data-chat-tile-goal-auto]')?.textContent.trim() ?? null, error: b.querySelector('[data-chat-tile-goal-band-error]')?.textContent.trim() ?? null,
      clear: !!w && B.bottom <= w.top + 0.5 && (!chip || B.bottom <= chip.top + 0.5), oneLine: row.height <= 40, btnsIn: btns.every((x) => { const r = x.getBoundingClientRect(); return r.right <= B.right + 0.5 && r.left >= B.left - 0.5 && r.width > 0; }),
      inside: B.left >= -0.5 && B.right <= innerWidth + 0.5, noX: document.documentElement.scrollWidth <= innerWidth + 1, h: Math.round(B.height) }); })()`);
const goalCalls = (from) => evj(`JSON.stringify(window.__calls.slice(${from}).filter(([c]) => c === 'chat_tile_goal_start' || c === 'chat_tile_goal_stop'))`);
const tierMenu = () =>
  evj(`(() => { const m = document.querySelector('[data-flip-model-menu]'); if (!m) return 'null'; const rows = [...m.querySelectorAll('[data-chat-tile-tier]')]; const R = m.getBoundingClientRect();
    return JSON.stringify({ rows: rows.map((r) => r.dataset.chatTileTier), checked: rows.find((r) => r.getAttribute('aria-checked') === 'true')?.dataset.chatTileTier ?? null,
      names: rows.map((r) => r.querySelector('.tier-name')?.textContent.trim()), descs: rows.map((r) => r.querySelector('.tier-desc')?.textContent.trim() ?? null),
      focus: document.activeElement?.dataset?.chatTileTier ?? null, inside: R.left >= -0.5 && R.right <= innerWidth + 0.5 && R.top >= -0.5 && R.bottom <= innerHeight + 0.5 }); })()`);
const tierChip = () => evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-tier-chip]'); return c ? JSON.stringify({ id: c.dataset.chatTileTierChip, title: c.title, chip: document.querySelector('${L} [data-chat-model-chip]').title }) : 'null'; })()`);
const READY_X7 = { t: "ready", cli: "codex", version: "0.172.0", model: "gpt-6.2-sol", models: ["gpt-6.2-sol", "gpt-mini"], efforts: {}, conversationId: CONV };
const TIERS = { byModel: { "gpt-6.2-sol": [{ id: "priority", name: "Fast", description: "2x speed, increased usage" }], "gpt-mini": [] }, thread: "default" };
const CXMODE = { mode: "readOnly", choices: ["readOnly", "auto", "plan"] };
const turn = async (chat, id, run) => {
  await emit({ t: "turnStarted", turn: id }, chat);
  if (run) await run();
  await emit({ t: "turnEnded", turn: id, outcome: "ok", message: null }, chat);
  await sleep(300);
};

// S31 Claude `/mcp` → 풍선 · 묻기 한 번 · 보내지 않음 · 줄 순서 aynx → 문제 → 연결 중 → 연결됨 · 로그인 안내 · 허용 칸만
let vs = await openCT("claude", { permMode: null, cliMode: CMODE, commands: CLAUDE_CMDS, context: { used: 120000, window: 200000, source: "turn" },
  mcpStatus: { source: "init", stale: false, servers: MCP_ROWS.map((r) => ({ ...r, ...VSECRET })) } });
let VC = vs.chat.chatId;
await emit(READY_C, VC);
await sleep(300);
let v0 = await callCount();
await setField("/mcp");
await sleep(200);
await press("Enter");
check("S31 `/mcp` Enter → MCP 풍선", await waitFor(`!!document.querySelector('[data-chat-tile-mcp-popover]')`, 3000), true);
let vp = await mcpPop();
check("S31 묻기 한 번 · 보내기 없음 · 칸 비움", [(await mcpAsks(v0)).map((a) => [keysOfG(a), a.chat === VC]), (await callsOf("chat_tile_send", v0)).length, (await fieldState()).value], [[[["chat", "epoch"], true]], 0, ""]);
check("S31 줄 순서(aynx → 문제 → 연결 중 → 연결됨) · 상태 글 · 도구 수 · 표", [vp?.rows, vp?.states, vp?.tools, vp?.tags],
  [["aynx-sessions", "claude.ai Gmail", "zeta", "tavily", "blender"], ["연결됨", "로그인 필요", "실패", "연결 중", "연결됨"], ["도구 14개", null, null, null, "도구 5개"], ["Aynx", "", "", "Aynx가 실음", ""]]);
check("S31 로그인 필요 줄 밑에만 터미널 안내 · 묻는 중 표 · SECRET 없음 · 단추는 [새로 고침] 하나 · 입력 칸 위 · 화면 안",
  [vp?.login, vp?.asking, vp?.secret, vp?.buttons, vp?.above, vp?.inside], [["claude.ai Gmail"], true, false, ["refresh"], true, true]);
await shot("v-s31-mcp-asking.png");
// 답(허용 칸 밖 SECRET 이 붙어 와도 그리지 않는다)
await emit({ t: "mcpStatus", source: "list", servers: [...MCP_ROWS.slice(0, 3), { ...MCP_ROWS[3], state: "connected", tools: 3 }].map((r) => ({ ...r, aynx: undefined, picked: undefined, ...VSECRET })) }, VC);
await sleep(300);
vp = await mcpPop();
check("S31 답 → 줄 갱신(tavily 연결됨 · 도구 3) · aynx/picked 물려받음 · 묻는 중 표 걷힘 · SECRET 없음",
  [vp?.rows, vp?.tools, vp?.tags, vp?.asking, vp?.secret], [["aynx-sessions", "claude.ai Gmail", "blender", "tavily"], ["도구 14개", null, "도구 5개", "도구 3개"], ["Aynx", "", "", "Aynx가 실음"], false, false]);
await shot("v-s31-mcp-rows.png");
v0 = await callCount();
await sleep(6000);
check("S31 열린 동안 스스로 다시 묻지 않는다(6초)", (await mcpAsks(v0)).length, 0);

// S32 [새로 고침] → 한 번 더 · 거짓 답 → "마지막 턴 기준" · 느림 · 시한 · 거절 글
await ev(`(window.__ctMcpAnswer = false, 1)`);
await clickAt(`document.querySelector('[data-chat-tile-mcp-refresh]')`);
await sleep(300);
vp = await mcpPop();
check("S32 [새로 고침] → 묻기 한 번 · 거짓 답 → 마지막 턴 기준", [(await mcpAsks(v0)).length, vp?.dim, vp?.asking], [1, "마지막 턴 기준", false]);
await shot("v-s32-mcp-lastturn.png");
await ev(`(window.__ctMcpAnswer = true, 1)`);
await clickAt(`document.querySelector('[data-chat-tile-mcp-refresh]')`);
await sleep(300);
v0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-mcp-refresh]')`);
check("S32 묻는 중 [새로 고침] → 겹쳐 묻지 않음", (await mcpAsks(v0)).length, 0);
await sleep(5200);
vp = await mcpPop();
check("S32 5초 넘음 → 오래 걸림 글", [vp?.asking, vp?.askText?.includes("오래 걸리고")], [true, true]);
await shot("v-s32-mcp-slow.png");
await sleep(10200);
vp = await mcpPop();
check("S32 15초 넘음 → 시한 글 · 다시 묻지 않음", [vp?.dim?.includes("15초"), (await mcpAsks(v0)).length], [true, 0]);
await shot("v-s32-mcp-timeout.png");
await ev(`(window.__ctMcpFail = '[mcp-status-busy] asked a moment ago', 1)`);
await clickAt(`document.querySelector('[data-chat-tile-mcp-refresh]')`);
await sleep(300);
vp = await mcpPop();
check("S32 거절 → 풍선 안 오류 글(위 배너 아님) · 줄은 남음", [vp?.error, await ev(`!!document.querySelector('${L} [data-chat-tile-error]')`), vp?.rows?.length], ["조금 뒤 다시 눌러 주세요", false, 4]);
await shot("v-s32-mcp-error.png");
await ev(`(window.__ctMcpFail = null, 1)`);
await press("Escape");
check("S32 Esc → 닫힘 · 입력 칸으로", [await ev(`!document.querySelector('[data-chat-tile-mcp-popover]')`), (await fieldState()).focus], [true, true]);
// 포커스가 입력 칸에 있을 때도 — 풍선만 닫히고 친 글 · 다른 층은 그대로(거짓 답 = 묻는 중이 남지 않게)
await ev(`(window.__ctMcpAnswer = false, 1)`);
await setField("/mcp");
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-mcp-popover]')`, 3000);
await setField("남길 글");
check("S32 풍선 열림 · 포커스 입력 칸", [await ev(`!!document.querySelector('[data-chat-tile-mcp-popover]')`), (await fieldState()).focus], [true, true]);
await press("Escape");
check("S32 입력 칸 Esc → 풍선 닫힘 · 글 남음 · 포커스 입력 칸 · 타일 그대로", [await ev(`!document.querySelector('[data-chat-tile-mcp-popover]')`), await fieldState(), await ev(`!!document.querySelector('${L}')`)],
  [true, { value: "남길 글", caret: 4, focus: true }, true]);
await setField("");
await ev(`(window.__ctMcpAnswer = true, 1)`);
// 미터 풍선의 MCP 요약 줄 → MCP 풍선으로 바꿔 연다(묻기 한 번)
await openPop();
check("S32 미터 풍선 MCP 요약 줄", await ev(`document.querySelector('[data-chat-tile-context-mcp]')?.textContent.trim() ?? null`), "MCP 4개 · 문제 1개");
v0 = await callCount();
await clickAt(`document.querySelector('[data-chat-tile-context-mcp]')`);
await sleep(300);
check("S32 요약 줄 → 미터 풍선 닫힘 · MCP 풍선 · 묻기 한 번", [await ev(`!document.querySelector('[data-chat-tile-context-popover]')`), await ev(`!!document.querySelector('[data-chat-tile-mcp-popover]')`), (await mcpAsks(v0)).length], [true, true, 1]);
await emit({ t: "mcpStatus", source: "list", servers: MCP_ROWS }, VC);
await sleep(200);
// 떠 있는 것 하나만 — MCP 풍선이 열린 채 `/` → 풍선 닫힘 · 메뉴
await typeIn("/");
check("S32 MCP 풍선 열린 채 `/` → 풍선 닫힘 · `/` 메뉴", [await ev(`!document.querySelector('[data-chat-tile-mcp-popover]')`), (await slashMenu()) !== null], [true, true]);
await setField("");

// S33 Claude `/mcp enable x` → 보내지 않음 · 터미널 안내 · 글 남음
v0 = await callCount();
await setField("/mcp enable blender");
await press("Enter");
check("S33 `/mcp enable …` → 보내지 않음 · 묻지 않음 · 터미널 안내 · 글 남음",
  [(await callsOf("chat_tile_send", v0)).length, (await mcpAsks(v0)).length, (await slashNoteOf())?.kind, (await fieldState()).value], [0, 0, "terminal", "/mcp enable blender"]);

// S34 Claude `/goal 조건` → 그대로 보냄 · 안내 줄 · 띠 · 카드 없음 · `/goal` · `/goal clear` 는 안내 없음
await setField("/goal 시험이 모두 지날 때까지");
v0 = await callCount();
await press("Enter");
let vsent = await callsOf("chat_tile_send", v0);
check("S34 Claude `/goal 조건` → chat_tile_send 글 그대로", vsent.map((a) => a.text), ["/goal 시험이 모두 지날 때까지"]);
await turn(VC, "g1", async () => emit({ t: "userAccepted", clientId: vsent[0]?.clientId ?? null, text: vsent[0]?.text }, VC));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-note]')`, 3000);
check("S34 안내 줄 하나 · 목표 띠 · 카드 없음", [await ev(`document.querySelectorAll('${L} [data-chat-tile-goal-note]').length`), await ev(`document.querySelector('${L} [data-chat-tile-goal-note]')?.textContent.trim()`),
  await ev(`!document.querySelector('${L} [data-chat-tile-goal], ${L} [data-chat-tile-goal-card]')`)], [1, "Claude가 조건을 이룰 때까지 이어서 일합니다 — [중지]로 멈추고 /goal clear로 지웁니다", true]);
await shot("v-s34-claude-goal-note.png");
for (const txt of ["/goal", "/goal clear"]) {
  await setField(txt);
  await sleep(150);
  v0 = await callCount();
  await press("Enter");
  const s2 = await callsOf("chat_tile_send", v0);
  await turn(VC, `g-${txt.length}`, async () => emit({ t: "userAccepted", clientId: s2[0]?.clientId ?? null, text: s2[0]?.text }, VC));
  check(`S34 Claude \`${txt}\` → 보냄 · 안내 줄 늘지 않음`, [s2.map((a) => a.text), await ev(`document.querySelectorAll('${L} [data-chat-tile-goal-note]').length`)], [[txt], 1]);
}
// Claude 는 속도 줄 없음 · `/fast` 는 터미널 안내
await clickAt(`document.querySelector('${L} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000);
check("S42 Claude 모델 메뉴 — 속도 줄 없음 · 구분선 하나(모델 | 강도)", [await ev(`document.querySelectorAll('[data-flip-model-menu] [data-chat-tile-tiers]').length`), await ev(`[...document.querySelectorAll('[data-flip-model-menu] hr')].filter((h) => !h.previousElementSibling?.matches('[data-chat-tile-cli-row]')).length`)], [0, 1]);
await press("Escape");
await setField("/fast");
await sleep(150);
v0 = await callCount();
await press("Enter");
check("S42 Claude `/fast` → 막힘(터미널 안내) · 보내지 않음 · 메뉴 안 열림", [(await slashNoteOf())?.kind, (await callsOf("chat_tile_send", v0)).length, await ev(`!document.querySelector('[data-flip-model-menu]')`)], ["terminal", 0, true]);
await setField("");
await closeCT(vs);

// S35 Codex 검토 카드 — `/review` → 카드 · 기본 대상 · 첫 포커스 라디오 · [검토 시작] 전에는 0 · 대상 넷의 몸
// 스텁의 subscribe 스냅숏은 cli 를 모른다 — 덧칸으로 준다
vs = await openCT("codex", { cli: "codex", permMode: null, cliMode: CXMODE, commands: CODEX_CMDS, tiers: TIERS });
let VX = vs.chat.chatId;
await emit(READY_X7, VX);
await sleep(300);
v0 = await callCount();
await setField("/review");
await sleep(200);
await press("Enter");
check("S35 `/review` → 검토 카드", await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000), true);
let vr = await reviewCard();
check("S35 라디오 넷 · 기본 커밋하지 않은 변경 · 첫 포커스 = 그 라디오 · 이 대화 안 안내 · role=group · 보낸 것 0",
  [vr?.radios, vr?.checked, vr?.focus, vr?.inline, vr?.group, (await callsOf("chat_tile_review", v0)).length, (await callsOf("chat_tile_send", v0)).length], [4, "uncommittedChanges", "uncommittedChanges", true, true, 0, 0]);
await shot("v-s35-review-card.png");
await press("Escape");
check("S35 Esc → 카드 닫힘 · 입력 칸 포커스 · 보낸 것 0", [await ev(`!document.querySelector('${L} [data-chat-tile-review-card]')`), (await fieldState()).focus, (await callsOf("chat_tile_review", v0)).length], [true, true, 0]);
const reviewWith = async (kind, fill) => {
  await setField("/review");
  await sleep(200);
  await press("Enter");
  await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
  if (kind) await clickAt(`document.querySelector('${L} [data-chat-tile-review-kind="${kind}"]')`);
  if (fill) await fill();
  await sleep(150);
  const shotName = `v-s35-review-${kind ?? "default"}.png`;
  await shot(shotName);
  const from = await callCount();
  await clickAt(`document.querySelector('${L} [data-chat-tile-review-start]')`);
  await sleep(300);
  const got = (await callsOf("chat_tile_review", from)).map((a) => [keysOfG(a), a.chat === VX, a.target]);
  await turn(VX, `rv-${kind}`);
  return got;
};
check("S35 [검토 시작] → chat_tile_review{chat, epoch, target:{uncommittedChanges}} · 카드 닫힘",
  [await reviewWith(null), await ev(`!document.querySelector('${L} [data-chat-tile-review-card]')`)], [[[["chat", "epoch", "target"], true, { type: "uncommittedChanges" }]], true]);
check("S35 기준 브랜치(기본 main)", await reviewWith("baseBranch"), [[["chat", "epoch", "target"], true, { type: "baseBranch", branch: "main" }]]);
check("S35 커밋 하나", await reviewWith("commit", async () => { await ev(`document.querySelector('${L} [data-chat-tile-review-sha]').focus()`); await send("Input.insertText", { text: "ea1dbc41" }); }),
  [[["chat", "epoch", "target"], true, { type: "commit", sha: "ea1dbc41" }]]);
// S36 `/review 인증만` → 직접 지시에 미리 채움 · 틀린 브랜치는 흐림 · 턴 중이면 카드 대신 안내
await setField("/review 인증 흐름만 봐 줘");
v0 = await callCount();
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
vr = await reviewCard();
check("S36 `/review 글` → 직접 지시 · 그 글 · 보낸 것 0", [vr?.checked, vr?.instr, (await callsOf("chat_tile_review", v0)).length, (await callsOf("chat_tile_send", v0)).length], ["custom", "인증 흐름만 봐 줘", 0, 0]);
await shot("v-s36-review-custom.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-review-start]')`);
await sleep(300);
check("S36 직접 지시 몸", (await callsOf("chat_tile_review", v0)).map((a) => a.target), [{ type: "custom", instructions: "인증 흐름만 봐 줘" }]);
await turn(VX, "rv-custom");
await setField("/review");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
await clickAt(`document.querySelector('${L} [data-chat-tile-review-kind="baseBranch"]')`);
await ev(`(() => { const i = document.querySelector('${L} [data-chat-tile-review-branch]'); i.focus(); i.select(); return 1; })()`);
await send("Input.insertText", { text: "-x" });
await sleep(200);
vr = await reviewCard();
check("S36 브랜치 `-x` → [검토 시작] 흐림 · 까닭 글", [vr?.go, vr?.why], [false, "브랜치 · 커밋 · 지시를 확인해 주세요"]);
await shot("v-s36-review-bad-branch.png");
v0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-review-start]')`);
check("S36 흐린 [검토 시작] → 보낸 것 0", (await callsOf("chat_tile_review", v0)).length, 0);
// 카드가 열린 채 턴이 서면 흐림 + 까닭
await emit({ t: "turnStarted", turn: "auto1" }, VX);
await sleep(300);
await clickAt(`document.querySelector('${L} [data-chat-tile-review-kind="uncommittedChanges"]')`);
vr = await reviewCard();
check("S36 카드 열린 채 턴 → [검토 시작] 흐림 · 턴 뒤 안내", [vr?.go, vr?.why], [false, "턴이 끝난 뒤 검토할 수 있습니다"]);
await shot("v-s36-review-busy-card.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-review-cancel]')`);
await setField("/review");
await sleep(200);
v0 = await callCount();
await press("Enter");
check("S36 턴 중 `/review` → 카드 대신 안내 줄 · 보낸 것 0", [await ev(`!document.querySelector('${L} [data-chat-tile-review-card]')`), (await slashNoteOf())?.text, (await callsOf("chat_tile_review", v0)).length],
  [true, "턴이 끝난 뒤 검토할 수 있습니다", 0]);
await emit({ t: "turnEnded", turn: "auto1", outcome: "ok", message: null }, VX);
await setField("");
await sleep(300);

// S37 표지 — 검토하는 중 → 마쳤습니다 + 결과 글 · 그 사이 [중지]
await emit({ t: "turnStarted", turn: "rvB" }, VX);
await emit({ t: "review", phase: "started", label: "current changes", text: null }, VX);
await sleep(300);
check("S37 시작 표지 = 검토하는 중: label · 회전", [await noticeOf("reviewing"), await ev(`!!document.querySelector('${L} [data-chat-tile-notice="reviewing"] .spin')`)], ["검토하는 중: current changes", true]);
v0 = await callCount();
await clickAt(`document.querySelector('${STOP}')`);
check("S37 검토 중 [중지] → interrupt 하나", (await callsOf("chat_tile_interrupt", v0)).length, 1);
await emit({ t: "review", phase: "done", label: "current changes", text: "1. [P1] `src/a.ts:12` 에서 널 검사가 빠졌습니다." }, VX);
await sleep(300);
check("S37 끝 표지 = 검토를 마쳤습니다 · 결과 글은 보통 모델 글", [await noticeOf("reviewed"), await noticeOf("reviewing"), await ev(`[...document.querySelectorAll('${L} [data-item="assistant"]')].some((e) => e.textContent.includes('[P1]'))`)],
  ["검토를 마쳤습니다: current changes", null, true]);
await shot("v-s37-review-markers.png");
await emit({ t: "turnEnded", turn: "rvB", outcome: "ok", message: null }, VX);
await sleep(500);

// S38 목표 카드 — `/goal 글` → 카드 · 글 미리 채움 · 경고 · 한도 기본 500k · [목표 정하기] → goal_start{set}
await setField("/goal 모든 시험이 지날 때까지 고쳐 줘");
v0 = await callCount();
await press("Enter");
check("S38 `/goal 글` → 목표 카드", await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000), true);
let vg = await goalCard();
check("S38 글 미리 채움 · 첫 포커스 = 목표 글 · 한도 다섯 · 기본 500k · 경고 · 갈음 안내 없음 · 보낸 것 0",
  [vg?.objective, vg?.focus, vg?.budgets, vg?.budget, vg?.warn?.includes("새 메시지 없이 턴을 이어 엽니다"), vg?.warn?.includes("[멈춤]은 다음 자동 턴만"), vg?.replace, vg?.count, vg?.group, (await goalCalls(v0)).length],
  ["모든 시험이 지날 때까지 고쳐 줘", true, ["100k", "250k", "500k", "1M", "2M"], "500000", true, true, false, `${[..."모든 시험이 지날 때까지 고쳐 줘"].length} / 4000`, true, 0]);
await shot("v-s38-goal-card.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-set]')`);
await sleep(300);
check("S38 [목표 정하기] → chat_tile_goal_start{chat, epoch, action:set, objective, tokenBudget:500000} · 카드 닫힘",
  [(await goalCalls(v0)).map(([c, a]) => [c, keysOfG(a), a.action, a.objective, a.tokenBudget]), await ev(`!document.querySelector('${L} [data-chat-tile-goal-card]')`)],
  [[["chat_tile_goal_start", ["action", "chat", "epoch", "objective", "tokenBudget"], "set", "모든 시험이 지날 때까지 고쳐 줘", 500000]], true]);
// 빈 글 · 4000자 넘음 → 흐림 · 다른 한도
await setField("/goal");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000);
check("S38 빈 글 → [목표 정하기] 흐림", (await goalCard())?.go, false);
await send("Input.insertText", { text: "가".repeat(4001) });
await sleep(200);
vg = await goalCard();
check("S38 4001자 → 흐림 · 까닭 · 셈 4001 / 4000", [vg?.go, vg?.why, vg?.count], [false, "목표 글이 비었거나 너무 깁니다", "4001 / 4000"]);
await ev(`(() => { const t = document.querySelector('${L} [data-chat-tile-goal-objective]'); t.focus(); t.select(); return 1; })()`);
await send("Input.insertText", { text: "README 를 다듬어 줘" });
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-budget="1000000"]')`);
v0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-set]')`);
await sleep(300);
check("S38 1M 고름 → tokenBudget 1000000", (await goalCalls(v0)).map(([, a]) => [a.objective, a.tokenBudget]), [["README 를 다듬어 줘", 1000000]]);

// S39 목표 띠 — 상태마다 단추 · 쓴 토큰 / 한도 · 입력 칸 위 제 줄 · [멈춤] = stop{pause} · [다시] = start{resume} · [지우기] = stop{clear}
const GOAL = { objective: "모든 시험이 지날 때까지\n둘째 줄 설명", status: "active", tokensUsed: 81230, tokenBudget: 500000, secondsUsed: 312, auto: false };
await emit({ t: "goal", goal: GOAL }, VX);
await sleep(300);
let vb = await goalBand();
check("S39 active 띠 — 진행 중 · 81.2k / 500k · 첫 줄 · title 전체 · [멈춤][지우기] · 입력 칸 · 모드 칩 위 · 한 줄",
  [vb?.status, vb?.word, vb?.tokens, vb?.head, vb?.title, vb?.buttons, vb?.clear, vb?.oneLine, vb?.btnsIn],
  ["active", "진행 중", "81.2k / 500k", "모든 시험이 지날 때까지", GOAL.objective, ["pause", "clear"], true, true, true]);
check("S39 단추 title = 뜻 글", vb?.titles, ["다음 자동 턴을 막습니다 — 도는 턴은 [중지]로 끊습니다", "목표를 지웁니다 — 이미 도는 턴은 [중지]로 끊습니다"]);
await shot("v-s39-band-active.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-objective-line]')`);
check("S39 목표 글 누름 → 전체 글 펼침", await ev(`document.querySelector('${L} [data-chat-tile-goal-full]')?.textContent ?? null`), GOAL.objective);
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-objective-line]')`);
v0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-pause]')`);
await sleep(300);
check("S39 [멈춤] → chat_tile_goal_stop{chat, epoch, action:pause} 하나", (await goalCalls(v0)).map(([c, a]) => [c, keysOfG(a), a.action]), [["chat_tile_goal_stop", ["action", "chat", "epoch"], "pause"]]);
await emit({ t: "goal", goal: { ...GOAL, status: "paused" } }, VX);
await sleep(300);
vb = await goalBand();
check("S39 paused → 멈춤 · [다시][지우기]", [vb?.word, vb?.buttons, vb?.tone], ["멈춤", ["resume", "clear"], "paused"]);
await shot("v-s39-band-paused.png");
v0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-resume]')`);
await sleep(300);
check("S39 [다시] → chat_tile_goal_start{action:resume} 하나(글 · 한도 null)", (await goalCalls(v0)).map(([c, a]) => [c, a.action, a.objective, a.tokenBudget]), [["chat_tile_goal_start", "resume", null, null]]);
for (const [st, word, btns] of [["budgetLimited", "토큰 한도 도달", ["resume", "clear"]], ["blocked", "막힘", ["resume", "clear"]], ["usageLimited", "사용 한도", ["resume", "clear"]], ["complete", "이룸", ["clear"]]]) {
  await emit({ t: "goal", goal: { ...GOAL, status: st, tokensUsed: st === "budgetLimited" ? 512000 : 81230 } }, VX);
  await sleep(250);
  vb = await goalBand();
  check(`S39 ${st} → ${word} · 단추 ${btns.join("+")}`, [vb?.word, vb?.buttons], [word, btns]);
  if (st === "budgetLimited") {
    check("S39 한도 도달 — 512k / 500k", vb?.tokens, "512k / 500k");
    await shot("v-s39-band-budget.png");
  }
}
v0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-clear]')`);
await sleep(300);
check("S39 [지우기] → chat_tile_goal_stop{action:clear} 하나", (await goalCalls(v0)).map(([c, a]) => [c, a.action]), [["chat_tile_goal_stop", "clear"]]);
await emit({ t: "goal", goal: null }, VX);
await sleep(250);
check("S39 goal null → 띠 사라짐", await goalBand(), null);
await emit({ t: "goal", goal: { ...GOAL, auto: true } }, VX);
await sleep(250);
vb = await goalBand();
check("S39 auto → Aynx 밖에서 정한 목표 표 · 같은 단추", [vb?.auto, vb?.buttons], ["Aynx 밖에서 정한 목표", ["pause", "clear"]]);
await shot("v-s39-band-outside.png");
// 목표가 있을 때 `/goal 글` → 갈음 안내
await setField("/goal 다른 목표");
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000);
check("S39 목표가 있으면 카드에 갈음 안내", (await goalCard())?.replace, true);
await shot("v-s39-goal-replace.png");
// 거절(원격 창 재확인 취소 등) → 카드에 글 · 다시 보내지 않음
await ev(`(window.__ctGoalFail = 'the master password was not confirmed', 1)`);
v0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-set]')`);
await sleep(600);
vg = await goalCard();
check("S39 거절 → 카드 남음 · 카드 안 글 · 위 배너 없음 · 한 번만", [vg !== null, vg?.error, await ev(`!!document.querySelector('${L} [data-chat-tile-error]')`), (await goalCalls(v0)).length],
  [true, "the master password was not confirmed", false, 1]);
await shot("v-s39-goal-refused.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-cancel]')`);
v0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-pause]')`);
await sleep(600);
vb = await goalBand();
check("S39 띠 단추 거절 → 띠 안 글 · 한 번만", [vb?.error, (await goalCalls(v0)).length], ["the master password was not confirmed", 1]);
await ev(`(window.__ctGoalFail = null, 1)`);

// S40 목표 active · 턴 중 [중지] → interrupt 하나뿐(목표 멈춤은 서버 몫)
await emit({ t: "goal", goal: GOAL }, VX);
await emit({ t: "turnStarted", turn: "auto2" }, VX);
await sleep(300);
vb = await goalBand();
check("S40 턴 중에도 띠 보임 · [멈춤] 눌러짐", [vb?.status, vb?.buttons], ["active", ["pause", "clear"]]);
await shot("v-s40-band-running.png");
v0 = await callCount();
await clickAt(`document.querySelector('${STOP}')`);
await sleep(300);
check("S40 [중지] → chat_tile_interrupt 하나 · 목표 명령 0", [(await callsOf("chat_tile_interrupt", v0)).length, (await goalCalls(v0)).length], [1, 0]);
await emit({ t: "turnEnded", turn: "auto2", outcome: "interrupted", message: null }, VX);
await sleep(300);

// S41 속도 줄 — 모델 메뉴 바닥 · CLI 기본(스레드 값) + Fast(설명) · 고르면 set_tier · 명세 · 칩 번개 · `/fast` → 메뉴 + 속도 줄 포커스
await clickAt(`document.querySelector('${L} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000);
let vt = await tierMenu();
check("S41 속도 줄 — CLI 기본(default 흐림) · Fast(설명) · 고른 것 기본", [vt?.rows, vt?.names, vt?.descs, vt?.checked, vt?.inside],
  [["default", "priority"], ["CLI 기본", "Fast"], ["default", "2x speed, increased usage"], "default", true]);
await shot("v-s41-tier-menu.png");
v0 = await callCount();
await clickAt(`document.querySelector('[data-flip-model-menu] [data-chat-tile-tier="priority"]')`);
await sleep(400);
check("S41 Fast → chat_tile_set_tier{chat, epoch, tier:priority} · 메뉴 열린 채 · 고른 줄", [(await callsOf("chat_tile_set_tier", v0)).map((a) => [keysOfG(a), a.tier]), (await tierMenu())?.checked],
  [[[["chat", "epoch", "tier"], "priority"]], "priority"]);
let vchip = await tierChip();
check("S41 명세 tier · 칩 번개 · title · 모델 칩 title 에 속도", [(await chatSpec())?.chat?.tier, vchip?.id, vchip?.title, vchip?.chip?.includes("속도: Fast")], ["priority", "priority", "속도: Fast", true]);
await press("Escape");
await shot("v-s41-tier-chip.png");
await setField("/fast");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000);
await sleep(300);
check("S41 Codex `/fast` → 모델 메뉴 · 속도 줄 포커스", [(await tierMenu())?.focus, (await fieldState()).value], ["priority", ""]);
await press("ArrowUp");
check("S41 ↑ → CLI 기본 줄로", (await tierMenu())?.focus, "default");
// 등급 없는 모델로 바꾸면 고른 등급을 떨군다(set_tier null) · 속도 줄 · 칩 없음
v0 = await callCount();
await clickAt(`document.querySelector('[data-flip-model="gpt-mini"]')`);
await sleep(500);
check("S41 등급 없는 모델 → set_model · set_tier{null} · 속도 줄 없음 · 칩 없음 · 명세 tier 없음",
  [(await callsOf("chat_tile_set_model", v0)).map((a) => a.model), (await callsOf("chat_tile_set_tier", v0)).map((a) => a.tier), (await tierMenu())?.rows ?? [], await tierChip(), "tier" in ((await chatSpec())?.chat ?? {})],
  [["gpt-mini"], [null], [], null, false]);
await press("Escape");
// S42 등급 없는 모델의 `/fast` → 안내 줄
await setField("/fast");
await sleep(200);
await press("Enter");
check("S42 등급 없는 모델 `/fast` → 안내 줄 · 메뉴 안 열림", [(await slashNoteOf())?.text, await ev(`!document.querySelector('[data-flip-model-menu]')`)], ["이 모델은 속도를 고를 수 없습니다", true]);
await setField("");

// S43 떠 있는 것 · 카드 하나만 — 검토 카드 열린 채 모델 메뉴 → 카드 닫힘 · 목표 카드 열린 채 권한 카드 → 닫힘 · MCP 풍선 → 카드 닫힘
await setField("/review");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
await clickAt(`document.querySelector('${L} [data-chat-model-chip]')`);
await sleep(300);
check("S43 검토 카드 열린 채 모델 메뉴 → 카드 닫힘 · 메뉴 하나", [await ev(`!document.querySelector('${L} [data-chat-tile-review-card]')`), await ev(`document.querySelectorAll('[data-flip-model-menu]').length`)], [true, 1]);
await press("Escape");
await setField("/goal 하나");
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000);
await setField("/mcp");
await sleep(200);
await press("Enter");
await sleep(300);
check("S43 목표 카드 열린 채 `/mcp` → 카드 닫힘 · 풍선", [await ev(`!document.querySelector('${L} [data-chat-tile-goal-card]')`), await ev(`!!document.querySelector('[data-chat-tile-mcp-popover]')`)], [true, true]);
await emit({ t: "mcpStatus", source: "list", servers: MCP_ROWS }, VX);
await press("Escape");
await setField("/review");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
await emit({ t: "turnStarted", turn: "pp" }, VX);
await emit({ t: "permission", requestId: "v-p1", kind: "command", title: "Bash", detail: "", toolName: "Bash", input: { command: "npm test" } }, VX);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-perm="v-p1"]')`, 3000);
check("S43 권한 카드가 오면 검토 카드 닫힘(글은 버림)", await ev(`!document.querySelector('${L} [data-chat-tile-review-card]')`), true);
check("S43 권한 대기 중에도 목표 띠 보임", (await goalBand())?.status, "active");
await clickAt(`document.querySelector('${L} [data-chat-tile-deny]')`);
await emit({ t: "permissionResolved", requestId: "v-p1", decision: "deny", by: "human" }, VX);
await emit({ t: "turnEnded", turn: "pp", outcome: "ok", message: null }, VX);
await sleep(400);

// S44 작은 타일(560×400) — 띠 한 줄 · 단추 보임 · 카드 단추 줄 · 풍선 화면 안
await send("Emulation.setDeviceMetricsOverride", { width: 560, height: 400, deviceScaleFactor: 1, mobile: false });
await sleep(700);
vb = await goalBand();
check("S44 작은 타일 띠 — 한 줄 · 단추 띠 안 · 입력 칸 위 · 가로 넘침 없음", [vb?.oneLine, vb?.btnsIn, vb?.clear, vb?.noX], [true, true, true, true]);
await shot("v-s44-small-band.png");
await setField("/review");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
await clickAt(`document.querySelector('${L} [data-chat-tile-review-kind="custom"]')`);
await sleep(400);
vr = await reviewCard();
check("S44 작은 타일 검토 카드 — 단추 줄 보임 · 가로 넘침 없음", [vr?.actionsSeen, vr?.noX], [true, true]);
await shot("v-s44-small-review.png");
await press("Escape");
await setField("/goal 작은 타일");
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000);
await sleep(400);
vg = await goalCard();
check("S44 작은 타일 목표 카드 — 단추 줄 보임 · 가로 넘침 없음", [vg?.actionsSeen, vg?.noX], [true, true]);
await shot("v-s44-small-goal.png");
await press("Escape");
await setField("/mcp");
await sleep(200);
await press("Enter");
await sleep(400);
vp = await mcpPop();
check("S44 작은 타일 MCP 풍선 — 화면 안", [vp?.inside, vp?.noX], [true, true]);
await shot("v-s44-small-mcp.png");
await press("Escape");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await setField("");
await closeCT(vs);
await ev(`(window.__ctSnap = null, 1)`);
check("V 메인 PC 예외 0", errors.slice(), []);

// ═══ W. 6차 실기 뒤 다듬기(S47–S52) ════════════════════════════════════════════════════════════════
errors.length = 0;
// S47 CLI 기본 모델에 Fast 를 고른 채 리로드 — 칩 번개 · 속도 줄이 그대로(스냅숏 cliModel) · 턴이 지나도 · 목록을 몰라도 고른 등급은 숨기지 않는다
const W_BASE = { cli: "codex", permMode: null, cliMode: CXMODE, commands: CODEX_CMDS, tiers: TIERS, cliModel: "gpt-6.2-sol" };
let wsp = await openCT("codex", W_BASE);
let WX = wsp.chat.chatId;
await clickAt(`document.querySelector('${L} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000);
check("S47 CLI 기본 모델 — 속도 줄(스냅숏 cliModel 의 목록)", (await tierMenu())?.rows, ["default", "priority"]);
await clickAt(`document.querySelector('[data-flip-model-menu] [data-chat-tile-tier="priority"]')`);
await sleep(400);
await press("Escape");
check("S47 Fast 고름 → 명세 tier · 칩 번개", [(await chatSpec())?.chat?.tier, (await tierChip())?.id], ["priority", "priority"]);
const reloadWith = async (snapExtra) => {
  await ev(`(sessionStorage.setItem('h.snap', ${JSON.stringify(JSON.stringify(snapExtra))}), sessionStorage.setItem('h.reload', '1'), sessionStorage.setItem('h.ct', '[]'), 1)`);
  await bootPage({ remote: false, width: 1280, height: 860, fresh: false });
  await waitFor(`!!document.querySelector('${L} [data-chat-tile-face]')`, 6000);
  await waitFor(`(JSON.parse(sessionStorage.getItem('h.ct') || '[]')).some(([c]) => c === 'chat_tile_subscribe')`, 5000);
  await sleep(600);
  wsp = (await chatSpec()) ?? wsp;
};
await reloadWith({ ...W_BASE, tier: "priority" });
check("S47 리로드 뒤 — 칩 번개 그대로", (await tierChip())?.id, "priority");
await clickAt(`document.querySelector('${L} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000);
let wt = await tierMenu();
check("S47 리로드 뒤 — 속도 줄 · Fast 고른 줄", [wt?.rows, wt?.checked, wt?.names], [["default", "priority"], "priority", ["CLI 기본", "Fast"]]);
await shot("w-s47-reload-tier-menu.png");
await press("Escape");
await turn(WX, "w1");
check("S47 턴이 지나도 칩 그대로", (await tierChip())?.id, "priority");
await shot("w-s47-reload-tier-chip.png");
// 옛 서버처럼 지금 모델을 모를 때 — 칩은 남고 속도 줄의 "CLI 기본" 으로 끈다
await reloadWith({ ...W_BASE, cliModel: undefined, tier: "priority" });
check("S47 지금 모델을 몰라도 고른 등급은 칩에 남는다", (await tierChip())?.id, "priority");
await clickAt(`document.querySelector('${L} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000);
wt = await tierMenu();
check("S47 목록 모름 — 속도 줄에 CLI 기본 + 고른 등급(이름은 다른 모델이 알린 것)", [wt?.rows, wt?.checked, wt?.names], [["default", "priority"], "priority", ["CLI 기본", "Fast"]]);
let w0 = await callCount();
await clickAt(`document.querySelector('[data-flip-model-menu] [data-chat-tile-tier="default"]')`);
await sleep(400);
check("S47 CLI 기본 → set_tier{null} · 칩 사라짐 · 명세 tier 없음", [(await callsOf("chat_tile_set_tier", w0)).map((a) => a.tier), await tierChip(), "tier" in ((await chatSpec())?.chat ?? {})], [[null], null, false]);
await press("Escape");
await ev(`(sessionStorage.removeItem('h.snap'), window.__ctSnap = ${JSON.stringify(W_BASE)}, 1)`);

// S48 끊긴 검토 — "검토를 중지했습니다" · 결과 글 뒤 · 다음 턴 뒤에도 흔적으로 남는다
await emit(READY_X7, WX);
await emit({ t: "turnStarted", turn: "rvS" }, WX);
await emit({ t: "review", phase: "started", label: "current changes", text: null }, WX);
await emit({ t: "text", item: "msg_rs", text: "Review was interrupted. Please re-run /review and wait for it to complete." }, WX);
await emit({ t: "review", phase: "stopped", label: "current changes", text: null }, WX);
await sleep(300);
const reviewOrder = () =>
  evj(`(() => { const n = document.querySelector('${L} [data-chat-tile-notice="review-stopped"]'); const a = [...document.querySelectorAll('${L} [data-item="assistant"]')].find((e) => e.textContent.includes('Review was interrupted'));
    return JSON.stringify({ text: n?.textContent.trim() ?? null, after: !!n && !!a && !!(a.compareDocumentPosition(n) & Node.DOCUMENT_POSITION_FOLLOWING), err: n?.classList.contains('err') ?? null,
      done: document.querySelectorAll('${L} [data-chat-tile-notice="reviewed"]').length, running: document.querySelectorAll('${L} [data-chat-tile-notice="reviewing"]').length }); })()`);
check("S48 끊긴 검토 → 중지 표지 · 결과 글 뒤 · 오류색 아님 · 마침 표지 · 검토 중 줄 없음", await reviewOrder(),
  { text: "검토를 중지했습니다: current changes", after: true, err: false, done: 0, running: 0 });
await shot("w-s48-review-stopped.png");
await emit({ t: "turnEnded", turn: "rvS", outcome: "interrupted", message: null }, WX);
await sleep(500);
await turn(WX, "w2");
await sleep(500);
check("S48 다음 턴 뒤 — 꼬리 표지는 걷혀도 흔적 줄 하나가 남는다",
  await evj(`JSON.stringify({ trace: [...document.querySelectorAll('${L} [data-chat-tile-review-trace]')].map((e) => [e.dataset.chatTileReviewTrace, e.textContent.trim()]), tail: document.querySelectorAll('${L} [data-chat-tile-notice="review-stopped"]').length })`),
  { trace: [["review-stopped", "검토를 중지했습니다: current changes"]], tail: 0 });
await shot("w-s48-review-trace.png");

// S52 검토가 서지 않음(review-failed) → 바쁨이 곧바로 풀려 보낼 수 있다 · 빈 목표 글의 까닭 · 낮은 타일의 목표 카드
await setField("/review");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
await clickAt(`document.querySelector('${L} [data-chat-tile-review-start]')`);
await sleep(300);
await emit({ t: "notice", code: "review-failed", detail: "thread not loaded" }, WX);
await sleep(200);
await setField("검토 대신 그냥 물어볼게");
w0 = await callCount();
await press("Enter");
await sleep(300);
check("S52 review-failed → 곧바로 보낼 수 있다(15초를 기다리지 않는다)", (await callsOf("chat_tile_send", w0)).map((a) => a.text), ["검토 대신 그냥 물어볼게"]);
await turn(WX, "w3");
await setField("/goal");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000);
let wg = await goalCard();
check("S52 빈 목표 글 → [목표 정하기] 흐림 · 까닭 줄", [wg?.go, wg?.why], [false, "목표 글이 비었거나 너무 깁니다"]);
await shot("w-s52-goal-empty-why.png");
await press("Escape");
await emit({ t: "goal", goal: { objective: "count from 1 to 8, one number per turn", status: "paused", tokensUsed: 1400, tokenBudget: 100000, secondsUsed: 12, auto: false } }, WX);
// 타일 몸이 520×330 남짓 — 창은 탭 띠 · 상태 줄만큼 크다
await send("Emulation.setDeviceMetricsOverride", { width: 540, height: 420, deviceScaleFactor: 1, mobile: false });
await sleep(700);
await setField("/goal");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000);
await sleep(600);
const goalFieldSeen = () =>
  evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-goal-card]'); if (!c) return 'null'; const f = c.querySelector('[data-chat-tile-goal-objective]').getBoundingClientRect();
    const a = c.querySelector('[data-chat-tile-goal-actions]').getBoundingClientRect(); const body = document.querySelector('${L} [data-viewer-body]').getBoundingClientRect();
    const main = c.querySelector('.main').getBoundingClientRect(); const top = Math.max(body.top, main.top) - 1, bot = Math.min(body.bottom, main.bottom) + 1;
    const wi = c.querySelector('[data-chat-tile-goal-why-inline]'); const wiR = wi?.getBoundingClientRect();
    return JSON.stringify({ tight: c.hasAttribute('data-tight'), why: wi && wiR.height > 0 ? wi.textContent.trim() : null, field: f.height >= 24 && f.top >= top && f.bottom <= bot, actions: a.top >= body.top - 1 && a.bottom <= body.bottom + 1, focus: document.activeElement?.hasAttribute?.('data-chat-tile-goal-objective') ?? false,
      noX: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
check("S52 낮은 타일(약 520×330) 목표 카드 — 목표 글 칸이 먼저 보임 · 까닭은 글 칸 머리 · 단추 줄 보임 · 포커스 · 가로 넘침 없음", await goalFieldSeen(), { tight: true, why: "목표 글이 비었거나 너무 깁니다", field: true, actions: true, focus: true, noX: true });
await shot("w-s52-small-goal-card.png");
await press("Escape");
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
await sleep(400);
await emit({ t: "goal", goal: null }, WX);
await setField("");
await closeCT(wsp);
await ev(`(window.__ctSnap = null, 1)`);

// S49 Claude `/goal 조건` — 턴이 끝나 기록을 다시 받아도 사람이 보낸 말풍선 · 로컬 출력이 남는다(기록에 있는 모델 답은 겹치지 않는다)
wsp = await openCT("claude", { permMode: null, cliMode: CMODE, commands: CLAUDE_CMDS });
WX = wsp.chat.chatId;
await setRecord([]);
await emit(READY_C, WX);
await setField("/goal 시험이 모두 지날 때까지");
w0 = await callCount();
await press("Enter");
const wsent = await callsOf("chat_tile_send", w0);
await emit({ t: "turnStarted", turn: null }, WX);
await emit({ t: "userAccepted", clientId: wsent[0]?.clientId ?? null, text: wsent[0]?.text }, WX);
await emit({ t: "text", item: null, text: "Goal set: 시험이 모두 지날 때까지" }, WX);
await emit({ t: "text", item: null, text: "시험을 돌려 보겠습니다." }, WX);
// 기록 읽기는 `/goal` 의 사람 말 · 로컬 출력을 숨긴다 — 모델 답만 남는다
await ev(`(window.__transcript = { items: [{ role: 'assistant', text: '시험을 돌려 보겠습니다.', truncated: false, images: 0, tool: null, at: Date.now() + 50 }], cursor: null }, 1)`);
await emit({ t: "turnEnded", turn: null, outcome: "ok", message: null }, WX);
await sleep(900);
await turn(WX, "w4");
await sleep(900);
check("S49 다음 턴 뒤에도 — `/goal` 말풍선 · 로컬 출력 · 모델 답은 한 번씩",
  await evj(`JSON.stringify({ users: [...document.querySelectorAll('${L} [data-item="user"]')].map((e) => e.textContent.trim()).filter((x) => x.startsWith('/goal')),
    set: [...document.querySelectorAll('${L} [data-item="assistant"]')].filter((e) => e.textContent.includes('Goal set:')).length,
    answer: [...document.querySelectorAll('${L} [data-item="assistant"]')].filter((e) => e.textContent.includes('시험을 돌려 보겠습니다')).length })`),
  { users: ["/goal 시험이 모두 지날 때까지"], set: 1, answer: 1 });
await shot("w-s49-goal-bubble-kept.png");

// S49b Claude `/code-review` — 기록은 사람 말을 글 그대로 돌려주고 로컬 출력은 숨긴다 · 답은 한 번 남고 말풍선은 겹치지 않는다
await setField("/code-review low");
w0 = await callCount();
await press("Enter");
const rsent = await callsOf("chat_tile_send", w0);
await emit({ t: "turnStarted", turn: null }, WX);
await emit({ t: "userAccepted", clientId: rsent[0]?.clientId ?? null, text: rsent[0]?.text }, WX);
await emit({ t: "toolStarted", item: "rv1", name: "Task", summary: "review", input: null }, WX);
await emit({ t: "text", item: null, text: "(none)" }, WX);
await ev(`(window.__transcript = { items: [...window.__transcript.items, { role: 'user', text: '/code-review low', truncated: false, images: 0, tool: null, at: Date.now() - 200 }], cursor: null }, 1)`);
await emit({ t: "turnEnded", turn: null, outcome: "ok", message: null }, WX);
await sleep(900);
const reviewSeen = () => evj(`JSON.stringify({ users: [...document.querySelectorAll('${L} [data-item="user"]')].map((e) => e.textContent.trim()).filter((x) => x.startsWith('/code-review')).length,
  out: [...document.querySelectorAll('${L} [data-item="assistant"]')].filter((e) => e.textContent.trim() === '(none)').length })`);
check("S49b `/code-review` 턴 끝 — 말풍선 하나 · 답 (none) 한 번", [rsent.map((a) => a.text), await reviewSeen()], [["/code-review low"], { users: 1, out: 1 }]);
await turn(WX, "w5");
await sleep(900);
check("S49b 다음 턴 뒤에도 그대로", await reviewSeen(), { users: 1, out: 1 });
await shot("w-s49b-code-review-kept.png");
await setRecord([]);

// S50 MCP 풍선 — 시작 전 · 연결된 줄은 로그인 안내 없음 · 꺼지고 도구 없는 줄은 맨 뒤 흐림 · 사건 줄의 Aynx 표 · 읽기 실패는 곧바로 풍선에
await closeCT(wsp);
wsp = await openCT("claude", { permMode: null, cliMode: CMODE, commands: CLAUDE_CMDS });
WX = wsp.chat.chatId;
await ev(`(window.__ctMcpAnswer = false, 1)`);
await setField("/mcp");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-mcp-popover]')`, 3000);
await sleep(300);
let wp = await mcpPop();
check("S50 시작 전 — 첫 메시지 뒤에 보인다 · '마지막 턴 기준' · '없습니다' 없음",
  [await ev(`document.querySelector('[data-chat-tile-mcp-empty]')?.textContent.trim() ?? null`), wp?.dim],
  ["CLI가 아직 시작되지 않았습니다 — 첫 메시지를 보낸 뒤 목록이 나타납니다", null]);
await shot("w-s50-mcp-not-started.png");
await press("Escape");
await ev(`(window.__ctMcpAnswer = true, 1)`);
await emit(READY_C, WX);
await setField("/mcp");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-mcp-popover]')`, 3000);
// 서버가 사건 줄에도 표 둘을 얹는다 — 리로드 없이 첫 풍선에서 보인다
await emit({ t: "mcpStatus", source: "list", servers: [
  { name: "old-srv", state: "disabled", auth: null, tools: 0, scope: "user", aynx: false, picked: false },
  { name: "linear", state: "connected", auth: "notLoggedIn", tools: 7, scope: "user", aynx: false, picked: false },
  { name: "aynx-sessions", state: "connected", auth: null, tools: 14, scope: "app", aynx: true, picked: false },
  { name: "gmail", state: "needsAuth", auth: null, tools: null, scope: "cloud", aynx: false, picked: false },
  { name: "tavily", state: "connected", auth: null, tools: 3, scope: "app", aynx: false, picked: true },
] }, WX);
await sleep(300);
wp = await mcpPop();
check("S50 줄 순서 · 표(사건에서) · 로그인 안내는 needsAuth 줄만 · 꺼지고 도구 없는 줄 흐림",
  [wp?.rows, wp?.tags, wp?.login, await ev(`[...document.querySelectorAll('[data-chat-tile-mcp-row].idle')].map((e) => e.dataset.chatTileMcpRow).join(',')`)],
  [["aynx-sessions", "gmail", "linear", "tavily", "old-srv"], ["Aynx", "", "", "Aynx가 실음", ""], ["gmail"], "old-srv"]);
await shot("w-s50-mcp-rows.png");
await clickAt(`document.querySelector('[data-chat-tile-mcp-refresh]')`);
await sleep(200);
check("S50 [새로 고침] → 묻는 중", (await mcpPop())?.asking, true);
await emit({ t: "notice", code: "mcp-status-failed", detail: null }, WX);
await sleep(300);
wp = await mcpPop();
check("S50 읽기 실패 알림 → 묻는 중이 곧바로 풀리고 풍선에 실패 글(빨강)",
  [wp?.asking, wp?.dim, await ev(`document.querySelector('[data-chat-tile-mcp-dim]')?.classList.contains('err') ?? null`)], [false, "MCP 상태를 읽지 못했습니다", true]);
await shot("w-s50-mcp-failed.png");
await press("Escape");

// S51 `/` 메뉴 — 쉬는 포인터 밑에 메뉴가 떠도 줄을 고르지 않는다(실제로 움직일 때만) · 정확히 친 그대로 보내는 명령은 Enter 한 번에 간다
const wrapBox = await evj(`(() => { const r = document.querySelector('${L} [data-flip-composer] .wrap').getBoundingClientRect(); return JSON.stringify({ x: Math.round(r.left + 80), y: Math.round(r.top - 18) }); })()`);
await mouse("mouseMoved", wrapBox.x, wrapBox.y, { buttons: 0 });
await setField("/c");
await sleep(400);
const under = () => ev(`document.elementFromPoint(${wrapBox.x}, ${wrapBox.y})?.closest('[data-chat-tile-slash]')?.dataset.chatTileSlash ?? null`);
let wm = await slashMenu();
const firstPick = wm?.rows?.find((r) => !(wm?.off ?? []).includes(r)) ?? null;
const hovered = await under();
check("S51 쉬는 포인터 밑에 메뉴가 떠도 — 고른 줄은 첫 줄(포인터 밑 줄이 아니다)", [wm?.sel, hovered !== null && hovered !== firstPick], [firstPick, true]);
await mouse("mouseMoved", wrapBox.x, wrapBox.y, { buttons: 0 });
await sleep(200);
check("S51 같은 자리의 움직임 사건 — 그대로", (await slashMenu())?.sel, firstPick);
// 메뉴가 뜬 뒤 첫 움직임은 기준점 — 이어지는 움직임부터 고른다
await mouse("mouseMoved", wrapBox.x + 2, wrapBox.y, { buttons: 0 });
await mouse("mouseMoved", wrapBox.x + 4, wrapBox.y, { buttons: 0 });
await sleep(200);
check("S51 실제로 움직이면 그 줄을 고른다", (await slashMenu())?.sel, await under());
await shot("w-s51-slash-pointer.png");
await mouse("mouseMoved", 5, 5, { buttons: 0 });
await setField("/code-review");
await sleep(300);
w0 = await callCount();
await press("Enter");
await sleep(400);
check("S51 정확히 친 `/code-review` + Enter → 한 번에 보냄 · 칸 비움", [(await callsOf("chat_tile_send", w0)).map((a) => a.text), (await fieldState()).value], [["/code-review"], ""]);
await turn(WX, "w5");
await setField("/code-review");
await sleep(300);
await press("Tab");
check("S51 Tab 은 그대로 넣기 — 보내지 않음", [(await fieldState()).value, (await callsOf("chat_tile_send", w0)).length], ["/code-review ", 1]);
await setField("/review");
await sleep(300);
w0 = await callCount();
await press("Enter");
await sleep(300);
check("S51 별칭 `/review` 도 Enter 한 번 — 친 글 그대로", (await callsOf("chat_tile_send", w0)).map((a) => a.text), ["/review"]);
await turn(WX, "w6");
await setField("/code-rev");
await sleep(300);
w0 = await callCount();
await press("Enter");
await sleep(300);
check("S51 덜 친 이름 + Enter → 줄을 넣기만(보내지 않음)", [(await fieldState()).value, (await callsOf("chat_tile_send", w0)).length], ["/code-review ", 0]);
await setField("/mcp");
await sleep(300);
w0 = await callCount();
await press("Enter");
await sleep(300);
check("S51 Aynx 동작 줄은 그대로(풍선) · 보내지 않음", [await ev(`!!document.querySelector('[data-chat-tile-mcp-popover]')`), (await callsOf("chat_tile_send", w0)).length], [true, 0]);
await press("Escape");
await setField("");
await closeCT(wsp);
await ev(`(window.__ctSnap = null, window.__ctMcpAnswer = undefined, 1)`);
check("W 메인 PC 예외 0", errors.slice(), []);

// S14 원격 창 — 메뉴 · 압축 동작(ALLOW) · 그 자리 새 채팅 줄 없음
const gMirror = (pane) =>
  ev(`(async () => {
    const s = await ${importApp("mirror/snapshot")};
    const tab = { id: 'home-tab', title: 'c', tabKey: 'tk', workspaceId: 'w1', root: { type: 'leaf', pane: ${JSON.stringify(pane)} } };
    window.__emit('mirror-layout', s.buildSnapshot({ source: 'home', workspace: { id: 'w1', name: 'W' }, tabs: [tab], activeTabId: 'home-tab', focusOf: () => 'home-1' }));
  })()`);
const G_PANE = { id: "home-1", kind: "chat", tileKey: "ck", chat: { chatId: CHAT, cli: "claude", model: "", effort: "", cwd: "C:/src/proj" } };
LABEL = "remote-h-1";
subGenNow = 1;
await bootPage({ remote: true, width: 1280, height: 860 });
errors.length = 0;
await ev(`(window.__ctSnap = ${JSON.stringify({ cliMode: CMODE, commands: CLAUDE_CMDS, context: { used: 880000, window: 1000000, source: "turn" } })}, 1)`);
await gMirror(G_PANE);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-context]')`, 8000);
await emit(READY_C, CHAT);
await sleep(400);
await typeIn("/");
gm = await slashMenu();
check("S14 원격 — 메뉴 열림 · clear(그 자리 새 채팅) 줄 없음", [gm !== null, gm?.rows?.includes("clear"), gm?.rows?.includes("model")], [true, false, true]);
await shot("g-s14-remote-menu.png");
await press("Escape");
await setField("/clear");
g0 = await callCount();
await press("Enter");
check("S14 원격 — 쳐서 보낸 /clear 는 잎을 갈지 않고 보내지도 않는다", [(await chatSpec())?.chat?.chatId, (await callsOf("chat_tile_send", g0)).length, (await callsOf("chat_tile_close", g0)).length], [CHAT, 0, 0]);
await setField("");
await clickAt(`document.querySelector('${L} [data-chat-tile-compact-inline]')`);
gcomp = await callsOf("chat_tile_compact", g0);
check("S14 원격 — 인라인 [압축] → chat_tile_compact", gcomp.map((a) => [a.chat, a.instructions]), [[CHAT, null]]);
await emit({ t: "turnStarted", turn: null }, CHAT);
await emit({ t: "turnEnded", turn: null, outcome: "ok", message: null }, CHAT);
await sleep(500);
check("S14 원격 예외 0", errors.slice(), []);

// S29 원격 창 — 단추 · 카드 · 실행 동작(ALLOW) · 명세는 쓰지 않는다
const specR = await chatSpec();
check("S29 원격 — 기록이 선다", await seedRecord(CHAT, claudeRec, READY_C, 3), true);
r0 = await callCount();
await clickAt(rwBtn(UA[1]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await emit(pv(UA[1], "both", { files: ["src/a.ts"], insertions: 1, deletions: 1 }), CHAT);
await sleep(300);
await shot("r-s29-remote-card.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-confirm]')`);
await emit(rwDone(UA[1], "files", { skippedLinks: 0 }), CHAT);
await emit(rwDone(UA[1], "conversation"), CHAT);
await waitFor(`!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await sleep(300);
check("S29 원격 — 미리 보기 → 실행 → 흔적 · 명세 그대로",
  [(await rwCalls(r0)).map((a) => [a.anchor, a.scope, a.dryRun]), (await rwTraces()).pop()?.[0], JSON.stringify(await chatSpec()) === JSON.stringify(specR)],
  [[[UA[1], "both", true], [UA[1], "both", false]], "both", true]);
await setField("");
check("S29 원격 예외 0", errors.slice(), []);

LABEL = "remote-h-1";
subGenNow = 1;
await bootPage({ remote: true, width: 1280, height: 860 });
errors.length = 0;
// S45 원격 창 — 넷 동작(검토 · 목표 시작/멈춤 · MCP 읽기 · 속도) · 속도를 골라도 명세는 그대로 · 목표 시작 거절(재확인)은 카드에 글 · 다시 보내지 않음
const V_PANE = { id: "home-1", kind: "chat", tileKey: "ck", chat: { chatId: CHAT, cli: "codex", model: "", effort: "", cwd: "C:/src/proj" } };
const vMirror = (pane) =>
  ev(`(async () => {
    const s = await ${importApp("mirror/snapshot")};
    const tab = { id: 'home-tab', title: 'c', tabKey: 'tk', workspaceId: 'w1', root: { type: 'leaf', pane: ${JSON.stringify(pane)} } };
    window.__emit('mirror-layout', s.buildSnapshot({ source: 'home', workspace: { id: 'w1', name: 'W' }, tabs: [tab], activeTabId: 'home-tab', focusOf: () => 'home-1' }));
  })()`);
const V_SNAP = { cli: "codex", cliMode: CXMODE, commands: CODEX_CMDS, tiers: TIERS, mcpStatus: { source: "startup", stale: false, servers: MCP_ROWS },
  goal: { objective: "원격에서 본 목표", status: "active", tokensUsed: 120000, tokenBudget: 250000, secondsUsed: 40, auto: false } };
await ev(`(window.__ctSnap = ${JSON.stringify(V_SNAP)}, 1)`);
await vMirror(V_PANE);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal]')`, 8000);
await emit(READY_X7, CHAT);
await sleep(400);
const vSpecR = await chatSpec();
let vr0 = await callCount();
check("S45 원격 — 목표 띠 · 120k / 250k", [(await goalBand())?.status, (await goalBand())?.tokens], ["active", "120k / 250k"]);
await shot("v-s45-remote-band.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-pause]')`);
await sleep(300);
check("S45 원격 — [멈춤] → goal_stop{pause}", (await goalCalls(vr0)).map(([c, a]) => [c, a.action]), [["chat_tile_goal_stop", "pause"]]);
await setField("/review");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
vr0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-review-start]')`);
await sleep(300);
check("S45 원격 — 검토 → chat_tile_review", (await callsOf("chat_tile_review", vr0)).map((a) => a.target), [{ type: "uncommittedChanges" }]);
await turn(CHAT, "rr1");
await setField("/mcp");
await sleep(200);
vr0 = await callCount();
await press("Enter");
await sleep(300);
check("S45 원격 — MCP 풍선 · 묻기 한 번", [await ev(`!!document.querySelector('[data-chat-tile-mcp-popover]')`), (await mcpAsks(vr0)).length], [true, 1]);
await shot("v-s45-remote-mcp.png");
await press("Escape");
await clickAt(`document.querySelector('${L} [data-chat-model-chip]')`);
await waitFor(`!!document.querySelector('[data-flip-model-menu] [data-chat-tile-tier]')`, 3000);
vr0 = await callCount();
await clickAt(`document.querySelector('[data-flip-model-menu] [data-chat-tile-tier="priority"]')`);
await sleep(400);
check("S45 원격 — 속도 → set_tier{priority} · 칩 번개 · 명세 그대로", [(await callsOf("chat_tile_set_tier", vr0)).map((a) => a.tier), (await tierChip())?.id, JSON.stringify(await chatSpec()) === JSON.stringify(vSpecR)],
  [["priority"], "priority", true]);
await press("Escape");
// 목표 정하기 거절(원격 재확인) — 카드에 글 · 한 번만
await ev(`(window.__ctGoalFail = 'the master password was not confirmed', 1)`);
await setField("/goal 원격 목표");
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000);
vr0 = await callCount();
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-set]')`);
await sleep(600);
check("S45 원격 — 목표 정하기 거절 → 카드 글 · goal_start 한 번 · 다시 보내지 않음", [(await goalCard())?.error, (await goalCalls(vr0)).map(([c]) => c)], ["the master password was not confirmed", ["chat_tile_goal_start"]]);
await shot("v-s45-remote-goal-refused.png");
await sleep(1500);
check("S45 원격 — 1.5초 뒤에도 다시 보내지 않음", (await goalCalls(vr0)).length, 1);
await ev(`(window.__ctGoalFail = null, 1)`);
await clickAt(`document.querySelector('${L} [data-chat-tile-goal-cancel]')`);
check("S45 원격 — 명세 그대로", JSON.stringify(await chatSpec()) === JSON.stringify(vSpecR), true);
check("S45 원격 예외 0", errors.slice(), []);

// S15 폰 폭 400 — 메뉴 · 풍선 화면 안 · 미터 short · 예외 0
await bootPage({ remote: true, width: 400, height: 844, mobile: true });
errors.length = 0;
await ev(`(window.__ctSnap = ${JSON.stringify({ cliMode: CMODE, commands: CLAUDE_CMDS, context: { used: 880000, window: 1000000, source: "turn" } })}, 1)`);
await gMirror(G_PANE);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-context]')`, 8000);
await emit(READY_C, CHAT);
await sleep(500);
check("S15 폰 — 미터 short(88%) · 인라인 [압축] 없음(풍선에서만) · 입력 칸 상자 안", await meter().then((m) => [m?.text, m?.inline, m?.inBox]), ["88%", null, true]);
await shot("g-s15-phone-meter.png");
await typeIn("/");
check("S15 폰 — 메뉴가 입력 칸 위 · 화면 안 · 가로 넘침 없음", await slashPlace(), { above: true, inside: true, scroll: true });
check("S15 폰 — 줄 높이가 누르기 좋게(≥ 44px)", await ev(`Math.min(...[...document.querySelectorAll('[data-chat-tile-slash-menu] [role="option"]')].slice(0, 5).map((r) => r.getBoundingClientRect().height)) >= 44`), true);
await shot("g-s15-phone-menu.png");
await typeIn("comp");
await clickAt(`document.querySelector('[data-chat-tile-slash-menu] [data-chat-tile-slash="compact"]')`);
check("S15 폰 — 줄을 누르면 넣기(\"/compact \")", (await fieldState()).value, "/compact ");
await setField("");
await openPop();
check("S15 폰 — 풍선 화면 안", (await popOf())?.inside, true);
await shot("g-s15-phone-popover.png");
await press("Escape");
await ev(`(window.__ctSnap = null, 1)`);
check("S15 폰 예외 0", errors.slice(), []);

// S30 폰 폭 400 — 단추는 늘 보임 · 카드 · 고르기 메뉴가 화면 안 · 누르기 좋은 크기 · 파일 목록 다섯 줄 높이 · 예외 0
check("S30 폰 — 기록이 선다", await seedRecord(CHAT, claudeRec, READY_C, 3), true);
check("S30 폰 — [되감기] 단추가 호버 없이 보인다", (await rwBtns()).map((b) => b.op), ["1", "1"]);
await clickAt(rwBtn(UA[1]));
await waitFor(`!!document.querySelector('${L} [data-chat-tile-rewind-card]')`, 3000);
await emit(pv(UA[1], "both", { files: FIFTY.slice(0, 20), insertions: 40, deletions: 9 }), CHAT);
await sleep(500);
const phoneRw = await evj(`(() => { const c = document.querySelector('${L} [data-chat-tile-rewind-card]'); const C = c.getBoundingClientRect(); const l = c.querySelector('[data-chat-tile-rewind-files]');
  const lh = parseFloat(getComputedStyle(l).lineHeight) || 18; const btns = [...c.querySelectorAll('[data-chat-tile-rewind-actions] button')].map((b) => b.getBoundingClientRect().height);
  const sc = [...c.querySelectorAll('[data-chat-tile-rewind-scope]')].map((b) => b.getBoundingClientRect());
  return JSON.stringify({ inside: C.left >= -0.5 && C.right <= innerWidth + 0.5 && C.top >= -0.5 && C.bottom <= innerHeight + 0.5, list5: l.clientHeight <= 5 * lh + 16, scrolls: l.scrollHeight > l.clientHeight,
    btns: btns.every((h) => h >= 40), scopes: sc.every((r) => r.height >= 36 && r.right <= C.right + 0.5), noX: document.documentElement.scrollWidth <= innerWidth + 1 }); })()`);
check("S30 폰 — 카드 화면 안 · 목록 다섯 줄 · 안에서 구름 · 단추 ≥ 40 · 범위 칸 ≥ 36 · 가로 넘침 없음", phoneRw, { inside: true, list5: true, scrolls: true, btns: true, scopes: true, noX: true });
const phoneCover = await rwCover();
check("S30 폰 — 단추 줄 밑에 깔린 줄 없음 · 범위 칸 · 마지막 줄 닿음", phoneCover && { ...phoneCover, tight: true, oneLine: true }, COVER_OK);
await shot("r-s30-phone-card.png");
await clickAt(`document.querySelector('${L} [data-chat-tile-rewind-cancel]')`);
await setField("/rewind");
await sleep(250);
await press("Enter");
await waitFor(`!!document.querySelector('[data-chat-tile-rewind-picker]')`, 3000);
pk = await rwPicker();
check("S30 폰 — 고르기 메뉴 화면 안 · 입력 칸 위 · 줄 ≥ 44px", [pk?.inside, pk?.above, (pk?.minH ?? 0) >= 44, pk?.rows], [true, true, true, [UA[1], UA[0]]]);
await shot("r-s30-phone-picker.png");
await press("Escape");
await setField("");
check("S30 폰 예외 0", errors.slice(), []);

await bootPage({ remote: true, width: 400, height: 844, mobile: true });
errors.length = 0;
// S46 폰 폭 400 — 띠 · MCP 풍선 · 검토 · 목표 카드가 화면 안 · 누르기 좋은 크기 · 예외 0
await ev(`(window.__ctSnap = ${JSON.stringify(V_SNAP)}, 1)`);
await vMirror(V_PANE);
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal]')`, 8000);
await emit(READY_X7, CHAT);
await sleep(500);
let vph = await goalBand();
check("S46 폰 — 띠 화면 안 · 입력 칸 위 · 단추 띠 안 · 가로 넘침 없음", [vph?.inside, vph?.clear, vph?.btnsIn, vph?.noX], [true, true, true, true]);
check("S46 폰 — 띠 단추 ≥ 36px", await ev(`[...document.querySelectorAll('${L} [data-chat-tile-goal] .btns button')].every((b) => b.getBoundingClientRect().height >= 36)`), true);
await shot("v-s46-phone-band.png");
await setField("/mcp");
await sleep(200);
await press("Enter");
await sleep(400);
const vpm = await mcpPop();
check("S46 폰 — MCP 풍선 화면 안 · 가로 넘침 없음", [vpm?.inside, vpm?.noX], [true, true]);
await shot("v-s46-phone-mcp.png");
await press("Escape");
await setField("/review");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-review-card]')`, 3000);
await clickAt(`document.querySelector('${L} [data-chat-tile-review-kind="commit"]')`);
await sleep(400);
const vpr = await reviewCard();
check("S46 폰 — 검토 카드 화면 안 · 단추 줄 보임 · 라디오 ≥ 40px", [vpr?.inside, vpr?.actionsSeen, vpr?.noX, await ev(`[...document.querySelectorAll('${L} [data-chat-tile-review-kind]')].every((b) => b.getBoundingClientRect().height >= 40)`)],
  [true, true, true, true]);
await shot("v-s46-phone-review.png");
await press("Escape");
// 폰은 Enter 가 줄바꿈 — `/` 메뉴의 줄로 연다
await setField("/goal");
await sleep(200);
await press("Enter");
await waitFor(`!!document.querySelector('${L} [data-chat-tile-goal-card]')`, 3000);
await sleep(400);
const vpg = await goalCard();
check("S46 폰 — 목표 카드 화면 안 · 단추 줄 보임 · 갈음 안내", [vpg?.inside, vpg?.actionsSeen, vpg?.noX, vpg?.replace], [true, true, true, true]);
await shot("v-s46-phone-goal.png");
await press("Escape");
await setField("");
await ev(`(window.__ctSnap = null, 1)`);
check("S46 폰 예외 0", errors.slice(), []);

// ═══ X. 한 타일에서 CLI 바꾸기 — 그 자리에 다른 CLI 의 새 대화(모델 메뉴 맨 위 CLI 줄) ═══════════════════════════════
LABEL = "main";
subGenNow = 1;
await bootPage({ remote: false, width: 1280, height: 860 });
errors.length = 0;
const TITLES = importApp("app/titles.svelte.ts");
const tabTitleNow = () => ev(`(async () => { const w = await ${W}; const ti = await ${TITLES}; return ti.displayTabTitle(w.activeTab()); })()`);
const headOf = (paneId) => ev(`document.querySelector('[data-pane="${paneId}"]')?.textContent.replace(/\\s+/g, ' ').trim() ?? null`);
const CHIP = `document.querySelector('${L} [data-chat-model-chip]')`;
const openModelMenu = async () => {
  await clickAt(CHIP);
  return waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000);
};
const cliMenu = () =>
  evj(`(() => { const m = document.querySelector('[data-flip-model-menu]'); if (!m) return 'null'; const row = m.querySelector('[data-chat-tile-cli-row]'); const M = m.getBoundingClientRect();
    const segs = [...m.querySelectorAll('[data-chat-tile-cli]')];
    const inM = (e) => { const R = e.getBoundingClientRect(); return R.left >= M.left - 0.5 && R.right <= M.right + 0.5 && R.top >= M.top - 0.5 && R.bottom <= M.bottom + 0.5; };
    return JSON.stringify({ row: !!row, first: !!row && m.firstElementChild === row, segs: segs.map((s) => s.dataset.chatTileCli), on: segs.filter((s) => s.getAttribute('aria-checked') === 'true').map((s) => s.dataset.chatTileCli),
      logos: segs.length > 0 && segs.every((s) => !!s.querySelector('svg')), names: segs.map((s) => s.textContent.trim()), models: m.querySelectorAll('[data-flip-model]').length > 0,
      inside: M.left >= -0.5 && M.right <= innerWidth + 0.5 && M.top >= -0.5 && M.bottom <= innerHeight + 0.5, segsIn: segs.every(inM), noX: document.documentElement.scrollWidth <= innerWidth + 1,
      segH: Math.round(segs[0]?.getBoundingClientRect().height ?? 0) }); })()`);
const clickCli = (id) => clickAt(`document.querySelector('[data-flip-model-menu] [data-chat-tile-cli="${id}"]')`);
/** 갈아 끼우기를 기다린다 — 옛 항목 close · 새 항목 subscribe(open 뒤) */
const waitSwap = async (oldChat, from) => {
  await waitFor(`window.__calls.slice(${from}).some(([c, a]) => c === 'chat_tile_close' && a.chat === ${JSON.stringify(oldChat)})`, 5000);
  await waitFor(`window.__calls.slice(${from}).filter(([c, a]) => c === 'chat_tile_subscribe' && a.chat !== ${JSON.stringify(oldChat)}).length >= 2`, 5000);
  await sleep(500);
  return chatSpec();
};

// X1 메뉴 맨 위 CLI 줄 — 사이드 채팅 모델 풍선과 같은 세그먼트 · 로고 · 지금 CLI 고름 · 아래는 그대로
let xs = await openCT("claude", null);
let XC = xs.chat.chatId;
check("X1 (준비) Claude 채팅 잎 · 탭 제목 · 머리", [xs.chat.cli, (await tabTitleNow())?.includes("Claude Code"), (await headOf(xs.id))?.includes("Claude Code 채팅")], ["claude", true, true]);
await setField("쓰던 글 그대로");
check("X1 모델 메뉴 열림", await openModelMenu(), true);
let xm = await cliMenu();
check("X1 CLI 줄 — 맨 위 · Claude Code | Codex · 로고 · 지금 CLI 고름 · 모델 줄은 아래 그대로",
  [xm?.row, xm?.first, xm?.segs, xm?.names, xm?.logos, xm?.on, xm?.models, xm?.inside, xm?.segsIn],
  [true, true, ["claude", "codex"], ["Claude Code", "Codex"], true, ["claude"], true, true, true]);
await shot("x1-cli-row.png");
// ←→ 는 옮기기만 — 고르지 않는다
await ev(`document.querySelector('[data-flip-model-menu] [data-chat-tile-cli="claude"]').focus()`);
let x0 = await callCount();
await press("ArrowRight");
check("X1 → 는 포커스만 Codex 로 · 잎 그대로 · close 없음", [await ev(`document.activeElement?.dataset.chatTileCli ?? null`), (await chatSpec())?.chat?.chatId === XC, (await callsOf("chat_tile_close", x0)).length], ["codex", true, 0]);
await ev(`document.querySelector('[data-flip-model-menu] [data-chat-tile-cli="claude"]').focus()`);

// X2 빈 대화 — 누르면 바로 바꾼다
await markFrame();
x0 = await callCount();
await clickCli("codex");
const swapAnims = await frameAnims();
let xn = await waitSwap(XC, x0);
check("X2 같은 타일(pane id) · 틀 · 머리줄 DOM 그대로 · 등장 애니메이션 없음", [xn?.id === xs.id, ...(await frameKept()), swapAnims], [true, true, true, 0]);
check("X2 빈 대화 → 바로 Codex 새 잎 · 같은 자리 · 폴더만 물려줌 · model/effort 빈 값 · conv/permMode/tier 없음",
  [xn?.chat?.cli, xn?.chat?.chatId !== XC, xn?.tab === xs.tab, xn?.chat?.model, xn?.chat?.effort, xn?.chat?.cwd === xs.chat.cwd, ["conv", "permMode", "tier"].filter((k) => k in (xn?.chat ?? {}))],
  ["codex", true, true, "", "", true, []]);
check("X2 옛 항목 close · 새 항목은 open{fresh, codex}(CLI 를 띄우지 않음) · 보내기 없음",
  [(await callsOf("chat_tile_close", x0)).map((a) => a.chat === XC), (await callsOf("chat_tile_open", x0)).map((a) => [a.chat === xn?.chat?.chatId, a.cli, a.mode?.kind]), (await callsOf("chat_tile_send", x0)).length],
  [[true], [[true, "codex", "fresh"]], 0]);
check("X2 머리 · 탭 제목이 Codex 를 따른다 · 메뉴 닫힘", [(await headOf(xn?.id))?.includes("Codex 채팅"), (await tabTitleNow())?.includes("Codex"), await ev(`!document.querySelector('[data-flip-model-menu]')`)], [true, true, true]);
check("X2 쓰던 글이 새 잎 입력 칸으로 · 포커스도", await fieldState().then((f) => [f.value, f.focus]), ["쓰던 글 그대로", true]);
await shot("x2-switched-codex.png");
xs = xn;
XC = xs.chat.chatId;

// X5 일하는 중 — 칩이 잠기고 열린 메뉴는 닫힌다(CLI 줄에 닿을 길이 없다)
await setField("");
check("X5 (준비) 메뉴 열림", await openModelMenu(), true);
await emit({ t: "ready", cli: "codex", version: "0.80.0", model: "gpt-6-sol", models: [], efforts: {}, conversationId: null }, XC);
await emit({ t: "turnStarted", turn: "x5" }, XC);
await sleep(400);
check("X5 턴이 서면 메뉴 닫힘 · 칩 잠김", [await ev(`!document.querySelector('[data-flip-model-menu]')`), await ev(`${CHIP}?.getAttribute('aria-disabled')`)], [true, "true"]);
await clickAt(CHIP);
await sleep(300);
check("X5 잠긴 칩을 눌러도 메뉴 없음 · 잎 그대로", [await ev(`!document.querySelector('[data-flip-model-menu]')`), (await chatSpec())?.chat?.chatId === XC], [true, true]);
await shot("x5-working-locked.png");
await emit({ t: "turnEnded", turn: "x5", outcome: "ok", message: null }, XC);
await sleep(400);

// X3 대화 · 첨부가 있어도 누르면 바로 바뀜(확인 없음 — 사이드 채팅 CLI 줄과 같다) · 쓰던 글은 옮기고 첨부는 옮기지 않는다
await setField("첫 말");
x0 = await callCount();
await press("Enter");
await sleep(300);
const xcid = (await callsOf("chat_tile_send", x0))[0]?.clientId;
await emit({ t: "ready", cli: "codex", version: "0.80.0", model: "gpt-6-sol", models: [], efforts: {}, conversationId: CONV }, XC);
await emit({ t: "turnStarted", turn: "x3" }, XC);
await emit({ t: "userAccepted", clientId: xcid, text: "첫 말" }, XC);
await emit({ t: "textDelta", item: "xa", text: "답입니다" }, XC);
await ev(`(window.__transcript = { items: [
  { role: 'user', text: '첫 말', truncated: false, images: 0, tool: null, at: Date.now() - 3000 },
  { role: 'assistant', text: '답입니다', truncated: false, images: 0, tool: null, at: Date.now() - 2000 },
], cursor: null }, 1)`);
await emit({ t: "turnEnded", turn: "x3", outcome: "ok", message: null }, XC);
await sleep(800);
await pickFiles(["notes.txt"]);
await waitFor(`!!document.querySelector('${L} [data-flip-attachment]:not(.staging)')`, 4000);
await setField("다음 글");
check("X3 (준비) 대화 · 첨부 칩 · 메뉴 열림", [(await chatSpec())?.chat?.conv, await ev(`document.querySelectorAll('${L} [data-flip-attachment]').length`), await openModelMenu()], [CONV, 1, true]);
await shot("x3-before-switch.png");
x0 = await callCount();
await clickCli("claude");
xn = await waitSwap(XC, x0);
check("X3 대화 · 첨부가 있어도 바로 Claude 새 잎 · 같은 자리 · conv 없음 · 옛 항목 close · 새 항목은 send 없음",
  [xn?.chat?.cli, xn?.chat?.chatId !== XC, xn?.tab === xs.tab, "conv" in (xn?.chat ?? {}), (await callsOf("chat_tile_close", x0)).map((a) => a.chat === XC), (await callsOf("chat_tile_send", x0)).length],
  ["claude", true, true, false, [true], 0]);
check("X3 머리 · 탭 제목 Claude Code · 메뉴 닫힘 · 쓰던 글 · 포커스 · 첨부 칩 없음",
  [(await headOf(xn?.id))?.includes("Claude Code 채팅"), (await tabTitleNow())?.includes("Claude Code"), await ev(`!document.querySelector('[data-flip-model-menu]')`),
    ...(await fieldState().then((f) => [f.value, f.focus])), await ev(`document.querySelectorAll('${L} [data-flip-attachment]').length`)],
  [true, true, true, "다음 글", true, 0]);
await shot("x3-switched-claude.png");
xs = xn;
XC = xs.chat.chatId;
// 같은 CLI 를 누르면 아무 일 없음(메뉴도 열린 채)
await openModelMenu();
x0 = await callCount();
await clickCli("claude");
await sleep(400);
check("X4 지금 CLI 누름 → 메뉴 열린 채 · 잎 그대로 · close 없음", [!!(await cliMenu())?.row, (await chatSpec())?.chat?.chatId === XC, (await callsOf("chat_tile_close", x0)).length], [true, true, 0]);
await press("Escape");

// X6 작은 타일(560×400) · 좁은 창(400) — 줄이 메뉴 폭 안 · 메뉴 화면 안 · 가로 넘침 없음
for (const [w, h, name] of [[560, 400, "x6-small-tile.png"], [400, 760, "x6-narrow.png"]]) {
  await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  await openModelMenu();
  await sleep(300);
  xm = await cliMenu();
  check(`X6 ${w}×${h} — 메뉴 화면 안 · 세그먼트가 메뉴 안 · 가로 넘침 없음`, [xm?.row, xm?.inside, xm?.segsIn, xm?.noX], [true, true, true, true]);
  await shot(name);
  await press("Escape");
}
await send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 860, deviceScaleFactor: 1, mobile: false });
check("X 예외 0", errors.slice(), []);

// X7 원격 창 · 폰 — CLI 줄 없음(원격 창은 타일 명세를 쓰지 않는다)
LABEL = "remote-h-1";
subGenNow = 1;
for (const [mobile, w, h, name] of [[false, 1280, 860, "x7-remote.png"], [true, 400, 844, "x7-phone.png"]]) {
  await bootPage({ remote: true, width: w, height: h, mobile });
  errors.length = 0;
  await pushMirror(MIRROR_PANE);
  await waitFor(`!!document.querySelector('${L} [data-chat-tile-face]') && ${CHIP}?.getAttribute('aria-disabled') !== 'true'`, 8000);
  await sleep(400);
  if (!(await openModelMenu())) await ev(`(${CHIP}.click(), 1)`);
  await waitFor(`!!document.querySelector('[data-flip-model-menu]')`, 3000);
  xm = await cliMenu();
  check(`X7 ${mobile ? "폰" : "원격 창"} — 모델 메뉴는 열림 · CLI 줄 없음 · 화면 안`, [xm?.models, xm?.row, xm?.segs, xm?.inside, xm?.noX], [true, false, [], true, true]);
  await shot(name);
  await press("Escape");
  check(`X7 ${mobile ? "폰" : "원격 창"} 예외 0`, errors.slice(), []);
}

console.log(bad === 0 ? "ALL OK" : `${bad} FAILED`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
