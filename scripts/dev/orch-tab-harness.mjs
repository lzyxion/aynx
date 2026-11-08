// F4: 기본(ORCH_ONLY 없음/빈 값)은 옛 묶음 ①~⑰ + v3 시나리오 전부.
// ORCH_ONLY=v3-all 은 v3만. producer/wake/fixb/remote/db 선택 실행도 유지한다.
// 실행은 오케스트레이터. 모든 앨범/프로듀서는 메모리 스텁이며 CLI·모델 호출 없음.
// 헤드리스 검증 — **오케스트레이션 탭 1단계 ① 탭 틀**(2026-10-29 — docs/log/2026-10-29-orchestration-player-tab.md D1 · D2 · D3 · D7 · D11 ·
// 0-3 Q1=B). 모델 호출 없음 · 개발 앱 없음(vite + 헤드리스 Edge + Tauri 스텁 — `run-history-harness.mjs` 와 같은 꼴).
//
// 시나리오: ① 팔레트 → 한 잎 라이브러리 · ② [새 앨범] 초안 → 보내기(가짜 producer_album_start) ·
// ③ 성공 답의 앨범 경로·왼쪽 채팅(같은 탭) · 막대 ⏸ → orchestration_pause · ✕ = 응답 끊기.
// (2단계 단계 6 — 1단계 터미널 프로듀서 길(`orchestration_set_producer` · 첫 지시 PTY · 스트림 배치)은 걷었다)
// ④ 오케스트레이션 탭이 지금 탭일 때 "여기 열기" = 새 탭(D11) · 분할 거절 · ⑤ (2단계 단계 5) 보통 탭의 AI 타일 ⋯ 메뉴 [오케스트레이션으로 이어 가기] =
// 갈라 오기(대화를 알 때만 줄 · 잠긴 초안 → 시작 · 원래 타일 그대로 · 이관 = 구독만 풂 — `s5-fork-menu` · `s5-fork`) ·
// ⑮ 원격 거울 · 폰(제 구독 · 보내기 · 폰 폭 · 라이브러리 복귀 — `s5-remote` · `s5-phone` · `s5-phone-library` · `ORCH_ONLY=remote` 면 ⑮ 만) ·
// ⑦ 콘솔 오류 0.
//
//   node scripts/dev/run-harness.mjs orch-tab-harness.mjs <outdir> --size 1400x900
//     → <outdir>/orch-home.png · orch-preparing.png · orch-album.png · orch-continue.png · album-*.png ·
//       v3-track*.png · worker-filter-says.png · worker-scrolled.png(트랙 화면 — 옛 ③ 작업자 상세 검사 이전) ·
//       스튜디오 없음 · 있음 · 이어서 듣기 두 종류 · 최근 앨범 · 이어받기 채우기) ·
//       탭 줄 · 독 · 설정 메뉴 · 화면 낱말 훑기(Run · 조정자 · 작업자 · 맡기기 · Task — 모노 글꼴 코드 낱말은 예외) · 가사 단계 효과) ·
//       producer-*.png(⑪ 2단계 단계 3 프로듀서 채팅 — 홈 첫 말 → 그 자리에서 채팅 · 응답 · 도구 알약 · get_run → 앨범 · 대기열 · [끊고 전달] · ✕ ·
//       권한 카드 · 정책 거절 줄 · exited · [다시 띄우기] · 이어받기 채우기 · (실기 a 고침) 띄우기 전 칩 `producer-adopt-chips` · 620px
//       `producer-narrow-620` · `home-narrow-620` · 서버 재시작 뒤 기록만 `producer-orphan`).
//       wake-*.png(⑫ 2단계 단계 4 앱이 깨움 — 기록의 깨움 알약 · 앱 기록 없음 · 턴 끝 경계 · 사람 필요 카드 `wake-history` · 꼬리의 깨움 알약 `wake-live` ·
//       fixb-*.png(⑬ · ⑭ 2단계 단계 4 실기 b 고침 — 깨움 알약 중복 없음 · 다시 알림 `fixb-wake-dup` · O6 = 0 즉시 띠 `fixb-o6-off` · 620px 앨범 머리 · 막대 `fixb-620` ·
//       끝난 앨범 띠 `fixb-ended` · F5 뒤 알림 센터 `fixb-notify-f5`).
//       polish-*.png(⑰ 10-30 실기 다듬기 — 단추 모양 · 상태 아이콘 · 막대 글래스 · 상세 ← · Esc · 조율 멈춤 띠 · 납작 막대 · 채팅 아래 정렬 · DB 폼 설명 — `ORCH_ONLY=db` 면 DB 폼만).
import { runOrchV3, ALBUM_PERMISSION_STUB } from "./orch-v3-scenarios.mjs";
import { WORKSPACE_STUB } from "./workspace-stub.mjs";
import { waitBoot, reloadBoot } from "./boot-wait.mjs";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => {
  const p = path.join(outdir, name);
  const r = await send("Page.captureScreenshot", { format: "png" });
  if (r.result?.data) {
    fs.writeFileSync(p, Buffer.from(r.result.data, "base64"));
    console.log("PNG " + path.resolve(p));
  } else console.log("capture failed: " + p);
};
let bad = 0;
const check = (name, got, want) => {
  const okj = JSON.stringify(got) === JSON.stringify(want);
  if (!okj) bad += 1;
  console.log(`${okj ? "ok  " : "FAIL"} ${name}: ${JSON.stringify(got)}${okj ? "" : ` (want ${JSON.stringify(want)})`}`);
};
const until = async (expr, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if ((await ev(expr)) === true) return true;
    await sleep(120);
  }
  return false;
};
// (⑤) 오케스트레이션 화면(플레이어 판 · 재생 막대 · 오케스트레이션 탭 제목)에 옛 낱말이 남지 않았나 — 모노 글꼴(코드 낱말 `get_run` …) · 입력 칸 값은 빼고 본다
const OLD_TERMS = /스튜디오|라인업|(?<![A-Za-z_])(Run|Runs|Task|Tasks)(?![A-Za-z_])|조정자|작업자|맡기기|맡긴 저장소|구성 묶음/;
const termScan = async (label) => {
  const txt = await ev(`(() => {
    const roots = [...document.querySelectorAll('.pane-box:not(.hidden) [data-run-board]'), document.querySelector('.orch-strip:not(.hidden)')].filter(Boolean);
    const parts = roots.map((r) => { const c = r.cloneNode(true); c.querySelectorAll('.mono, code, kbd, textarea, input').forEach((x) => x.remove()); document.body.appendChild(c); const t = c.innerText + ' ' + [...c.querySelectorAll('[title],[aria-label]')].map((x) => (x.getAttribute('title') ?? '') + ' ' + (x.getAttribute('aria-label') ?? '')).join(' '); c.remove(); return t; });
    const tabs = [...document.querySelectorAll('[role=tablist] [data-tab]')].filter((x) => x.querySelector('.kind [data-eq]')).map((x) => x.innerText + ' ' + (x.querySelector('[title]')?.getAttribute('title') ?? ''));
    return [...parts, ...tabs].join('\\n');
  })()`);
  const hits = String(txt).split('\n').filter((l) => OLD_TERMS.test(l)).map((l) => l.trim().slice(0, 120));
  check(`⑤ 화면 낱말 — ${label}에 옛 낱말 없음`, hits, []);
};
// (⑰ 10-30 실기 다듬기) 단추 모양 훑기 — 판 · 막대 · 프로듀서 채팅 안에서 칠한 면(배경)이나 테두리가 있는 단추는 알약 · 원이어야 한다
// (반지름 6px 미만 = "직각처럼 보인다"). 글자만 있는 단추(링크 · 이름)는 빼고 본다.
const squareButtons = async () =>
  ev(`(() => {
    const roots = [...document.querySelectorAll('.pane-box:not(.hidden) [data-run-board], .orch-strip:not(.hidden), .pane-box:not(.hidden) [data-producer-face]')];
    const out = [];
    for (const r of roots) for (const b of r.querySelectorAll('button')) {
      const cs = getComputedStyle(b);
      if (cs.display === 'none' || b.getBoundingClientRect().width === 0) continue;
      const painted = (cs.backgroundColor !== 'rgba(0, 0, 0, 0)' && cs.backgroundColor !== 'transparent') || (parseFloat(cs.borderTopWidth) > 0 && cs.borderTopColor !== 'rgba(0, 0, 0, 0)');
      const rad = parseFloat(cs.borderTopLeftRadius) || 0;
      const pct = cs.borderTopLeftRadius.endsWith('%');
      if (painted && !pct && rad < 6) out.push((b.className || b.tagName) + ':' + (b.textContent ?? '').trim().slice(0, 12));
    }
    return out;
  })()`);
const importApp = (file) =>
  `(async () => { const e = performance.getEntriesByType('resource').map(r => r.name).find(u => u.includes('${file}')); if (!e) throw new Error('module not loaded yet: ${file}'); return await import(e); })()`;

const NOW = Date.now();
const DETAIL = {
  runId: "run-aaaa", name: "로그 회전 앨범", state: "running", gen: 1, createdAt: NOW - 18 * 60_000, updatedAt: NOW,
  repo: "C:/work/api", worktreeDir: "C:/work/api-wt", coordinatorAttached: true, coordinatorChat: null,
  limits: { maxConcurrentWorkers: 3, maxTotalWorkers: 6, coordinationMinutes: 120, turnMinutes: 30, maxReviews: 4 },
  coordinationDeadlineAt: NOW + 102 * 60_000, executionDeadlineAt: NOW + 200 * 60_000,
  tasks: [], attempts: [], reports: [], accepted: [], reviews: [], commits: [], transcripts: {},
  // 서버 `store/view.rs::remaining` 의 칸 전부(① 의 스크린샷에 "Task undefined · 분당 호출 undefined" 가 보였던 것은 이 가짜 판에 칸이 빠졌던 탓)
  remaining: { tasks: 18, callsThisMinute: 30, concurrentWorkers: 3, totalWorkers: 6, turns: 20, reviews: 4, coordinationSeconds: 6120, executionSeconds: 12000 }, latestSeq: 1, log: [],
  origin: { by: "human", producer: "pc-harness" }, roles: [], acceptRules: null,
};

await send("Page.enable");
await send("Runtime.enable");
await send("Page.addScriptToEvaluateOnNewDocument", {
  source: `
  performance.setResourceTimingBufferSize(10000);
  // ⑮ (단계 5) 원격 창 흉내 — 관문 폴리필이 세우는 표식 하나 · 거울 스냅숏 · 서버 표(스텁)는 sessionStorage 에서(다시 읽어도 남는다)
  if (sessionStorage.getItem('aynx-h-remote') === '1') window.__AYNX_REMOTE__ = true;
  const cbs = new Map(); let n = 0; window.__cbs = cbs; window.__chan = {}; window.__calls = [];
  const evts = new Map();
  window.__emit = (name, payload) => {
    const ids = evts.get(name) ?? [];
    for (const id of ids) cbs.get(id)?.({ event: name, id, payload });
    return ids.length;
  };
  let nextSession = 100;
  window.__detail = ${JSON.stringify(DETAIL)};
  window.__settings = { app: { status_bar: 'bottom' }, automation: { auto_approve: false } };
  window.__vault = { state: 'unlocked', hasMaster: false, entryCount: 0 };
  const answers = {
    restore_done_sessions: { closed: 0, unclaimed: 0 },
    list_hosts: { hosts: [], warnings: [] },
    list_shells: {shells:[{id:'pwsh',label:'PowerShell 7'}], default_id:'pwsh'},
    list_ai_clis: [{ id: 'claude', name: 'Claude Code', command: 'claude', installed: true }, { id: 'codex', name: 'Codex', command: 'codex', installed: true }],
    list_group_meta: {}, list_host_meta: {},
    session_stats: {bytes:0}, local_cwd: null, report_session: null, update_session_context: null,
    push_session_block: null, drop_session: null, resize_session: null, write_session: null,
    send_input: null, list_forwards: [], reap_window_sessions: null, session_log_path: null, list_snippets: [],
    list_console_sessions: [], delegation_list_targets: [], vault_list: [], vault_lock: null, mcp_activity: null,
    orchestration_snapshot: [], orchestration_notices: [], orchestration_pause: null,
    orchestration_worker_activity: {}, orchestration_report_drift: [],
    agent_conversation_transcript: { items: [], cursor: null },
  };
  window.__answers = answers;
  // 서버 목록 요약 · 맡기기 보기의 모양 흉내(10-30 호환 걷기 — 화면은 칸이 늘 있다고 본다): 판에 적지 않은 칸은 서버의 기본으로 채운다.
  // adoptable 은 서버 adopt_verdict 의 표 그대로(보류 · 조율 한도 · 조정자 있음 · 사람 일시정지 · 프로듀서 끝 · running · orphaned · 끝남).
  const verdict = (r) => {
    if (r.state === 'paused') {
      if (r.hold) return { restore: false, autoResume: false, why: 'on-hold' };
      if (r.pauseReason === 'coordination-limit') return { restore: false, autoResume: false, why: 'coordination-limit' };
      if (r.coordinatorAttached) return { restore: false, autoResume: false, why: r.pauseReason === 'human' ? 'paused-by-person' : 'has-coordinator' };
      return { restore: true, autoResume: r.pauseReason === 'coordinator-exited', why: null };
    }
    return { restore: false, autoResume: false, why: r.state === 'running' ? 'running' : r.state === 'orphaned' ? 'not-found' : 'ended' };
  };
  window.__sumFull = (r) => { const b = { coordinatorAttached: false, origin: { by: 'human' }, running: { write: 0, judge: 0 }, hold: null, coordinatorChat: null, producers: [], wake: null, ...r }; return { adoptable: verdict(b), ...b }; };
  // (2단계 단계 3) 프로듀서 채팅 op — 표 하나 · 구독 통로(Channel 의 콜백 id) · 대기열(바쁠 때 보낸 말) · 사건은 window.__pcEmit 로
  window.__pcState = { chats: (() => { try { return JSON.parse(sessionStorage.getItem('h.pcchats') ?? '{}'); } catch { return {}; } })(), q: [], held: false, busy: false, ch: {}, gen: {}, idx: {}, seq: {} };
  answers.mirror_get = (() => { try { return JSON.parse(sessionStorage.getItem('h.mirror') ?? 'null'); } catch { return null; } })();
  const pcSnap = (chat) => { const c = window.__pcState.chats[chat]; return { chat, cli: c.cli, model: c.model, effort: c.effort, repo: c.repo, epoch: c.epoch, seq: window.__pcState.seq[chat] ?? 0, status: c.life === 'ended' ? 'stopped' : window.__pcState.busy ? 'running' : 'ready', life: c.life ?? 'live', ended: c.ended ?? null, conversationId: c.conv ?? null, forkFrom: c.forkFrom ?? null, wake: c.wake ?? null, readOnly: false, queue: { items: window.__pcState.q.map((x) => ({ clientId: x.clientId, state: x.state })), held: window.__pcState.held }, liveTurn: [], pending: [], album: null }; };
  window.__pc = (cmd, a) => {
    const st = window.__pcState;
    if (cmd === 'producer_chat_open') { const run = a.mode?.run; const prior = st.chats[a.chat]; st.chats[a.chat] = { ...prior, cli: a.cli, model: a.model, effort: a.effort ?? null, repo: run ? window.__details?.[run]?.repo : prior?.repo, epoch: 0, conv: a.mode?.conv ?? null, run }; return Promise.resolve(pcSnap(a.chat)); }
    // 서버 재시작 흉내(⑪ 끝) — 표에 없는 채팅의 끝난 이유 · 귀속 앨범
    if (cmd === 'producer_chat_status' && !st.chats[a.chat] && st.gone?.[a.chat]) return Promise.resolve({ open: false, ...st.gone[a.chat] });
    if (!st.chats[a.chat]) return Promise.reject(new Error('[session-gone] this producer chat is not open on the session server'));
    // Channel의 전송 index는 통로마다 0부터, 채팅 사건 seq는 재구독 뒤에도 이어진다.
    if (cmd === 'producer_chat_subscribe') { st.ch[a.chat] = a.channel?.id; st.idx[a.chat] = 0; st.gen[a.chat] = (st.gen[a.chat] ?? 6) + 1; return Promise.resolve({ subGen: st.gen[a.chat], snapshot: pcSnap(a.chat) }); }
    if (cmd === 'producer_chat_send') { if (st.busy) { st.q.push({ clientId: a.clientId, state: 'queued' }); return Promise.resolve({ state: 'queued', position: st.q.length, epoch: 3 }); } st.chats[a.chat].epoch = 3; return Promise.resolve({ state: 'dispatching', epoch: 3 }); }
    if (cmd === 'producer_chat_attach') return Promise.resolve(pcSnap(a.chat));
    if (cmd === 'producer_chat_queue_cancel') { const i = st.q.findIndex((x) => x.clientId === a.clientId); if (i >= 0) st.q.splice(i, 1); return Promise.resolve(i >= 0); }
    if (cmd === 'producer_chat_interrupt') return Promise.resolve(st.busy);
    if (cmd === 'producer_chat_decide') return Promise.resolve(true);
    if (cmd === 'producer_chat_set_model') { st.chats[a.chat].model = a.model; return Promise.resolve(true); }
    if (cmd === 'producer_chat_set_effort') { st.chats[a.chat].effort = a.effort; return Promise.resolve(true); }
    if (cmd === 'producer_chat_unsubscribe') { if (st.gen[a.chat] !== a.subGen) return Promise.resolve(false); delete st.ch[a.chat]; return Promise.resolve(true); }
    if (cmd === 'producer_chat_close') return Promise.resolve(true);
    if (cmd === 'producer_chat_status') return Promise.resolve({ open: true, snapshot: pcSnap(a.chat) });
    return Promise.reject(new Error('stub: ' + cmd));
  };
  window.__pcEmit = (chat, ev) => { const st = window.__pcState; const id = st.ch[chat]; if (ev.t === 'exited' && st.chats[chat]) { st.chats[chat].life = 'ended'; st.chats[chat].ended = ev.why; } const cb = cbs.get(id); if (!cb) return 'no channel'; st.seq[chat] = (st.seq[chat] ?? 0) + ((ev.t === 'notice' && /^queue-/.test(ev.code)) || ev.t === 'woken' ? 0 : 1); cb({ message: { chat, epoch: 3, seq: st.seq[chat], ev, subs: [{ conn: 1, window: 'main', subGen: st.gen[chat] }] }, index: st.idx[chat]++ }); return 'ok'; };
  window.__feed = (sid, text) => { const c = window.__chan[sid]; if (!c) return 'no session'; const cb = cbs.get(c.cb); if (!cb) return 'no cb'; const buf = new TextEncoder().encode(text).buffer; cb({ message: buf, index: c.idx++ }); return 'ok'; };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' }, windows: [{label:'main'}], webviews: [{label:'main', windowLabel:'main'}] },
    invoke: (cmd, args) => {
      ${WORKSPACE_STUB}
      window.__calls.push([cmd, args]);
      if (cmd === 'git_repo_status') return Promise.resolve(window.__repoStatuses?.[args.path] ?? { kind: 'notRepo' });
      if (cmd === 'producer_fork_probe') return window.__forkNotRepo ? Promise.reject(new Error('[not-a-repo]')) : Promise.resolve({ repo: 'C:/work/api' });
      if (cmd === 'orchestration_album_defaults') return Promise.resolve(window.__albumDefaults?.[args.repo] ?? answers.orchestration_album_defaults ?? {});
      if (cmd === 'producer_album_start') return (async () => {
        // 원격 관문의 표 발급만 흉내 내며 실제 앱 재확인 모달을 연다. CLI·모델은 실행하지 않는다.
        if (window.__AYNX_REMOTE__) {
          const ticket = await window.__AYNX_REMOTE_UI__.reauth({ cmd, hasMaster: true, submit: async (password) => password === 'harness' ? { status: 200, data: { ticket: 'fake-ticket' } } : { status: 401, data: {} } });
          if (ticket !== 'fake-ticket') throw new Error('fake ticket missing');
          window.__reauthTickets = (window.__reauthTickets ?? 0) + 1;
        }
        const input = args.input;
        const key = input.chat + ':' + input.clientId;
        const memory = window.__albumResults ??= {};
        if (memory[key]) return memory[key];
        if (window.__albumFailure) throw new Error('[' + window.__albumFailure + '] 서버 내부 상세');
        const runId = window.__albumRunId ?? ('run-v3-start-' + Object.keys(memory).length);
        delete window.__albumRunId;
        const sent = !window.__albumNotSent;
        window.__pcState.chats[input.chat] = { cli: input.cli, model: input.model, effort: input.effort, repo: input.repo, epoch: 1, run: runId };
        const artists = answers.orchestration_artist_list ?? [];
        const d = { ...window.__detail, runId, latestSeq: 1, name: input.name.trim() || input.text.split('\\n')[0].slice(0, 40), repo: input.repo, state: 'running', coordinatorAttached: true, coordinatorChat: input.chat,
          tasks: [], attempts: [], roles: input.album.members.map((m) => ({ id: m.artist, ...artists.find((a) => a.id === m.artist), usable: true })),
          album: { ...input.album, rev: 1, members: input.album.members.map((m) => ({ ...m, name: artists.find((a) => a.id === m.artist)?.name ?? '아티스트', joinedRev: 1 })) } };
        (window.__details ??= {})[runId] = d;
        answers.orchestration_snapshot = [...(answers.orchestration_snapshot ?? []), { ...d, taskCount: 0, taskStates: {}, attemptCount: 0 }];
        const result = memory[key] = { runId, gen: 1, chat: input.chat, sent, state: sent ? 'dispatching' : 'not-sent', epoch: 1 };
        window.__emit('orchestration-changed', { runId, seq: d.latestSeq });
        if (window.__albumLostReply) { window.__albumLostReply = false; throw new Error('응답 유실'); }
        return result;
      })();
      ${ALBUM_PERMISSION_STUB}
      if (cmd === 'orchestration_rename_album') {
        const d = window.__details[args.runId]; d.name = args.name.trim(); d.latestSeq++;
        window.__emit('orchestration-changed', { runId: args.runId, seq: d.latestSeq });
        return Promise.resolve({ runId: args.runId, name: d.name, latestSeq: d.latestSeq });
      }
      if (cmd === 'open_local_session') { const id = nextSession++; window.__chan[id] = { cb: args?.onData?.id, idx: 0 }; return Promise.resolve({ id, shell: 'pwsh' }); }
      if (cmd === 'orchestration_artist_list') return Promise.resolve(answers.orchestration_artist_list ?? []);
      if (cmd === 'orchestration_artist_set') {
        const artist = { ...args.input, id: args.input.id ?? 'a-11111111' };
        const list = answers.orchestration_artist_list ?? [];
        answers.orchestration_artist_list = [...list.filter((a) => a.id !== artist.id), artist];
        window.__emit('orchestration-artists-changed', null);
        return Promise.resolve(artist);
      }
      if (cmd === 'orchestration_artist_remove') {
        if (window.__artistInUse) return Promise.reject(new Error('[artist-in-use] ' + JSON.stringify({ runIds: window.__artistInUse })));
        answers.orchestration_artist_list = (answers.orchestration_artist_list ?? []).filter((a) => a.id !== args.id);
        window.__emit('orchestration-artists-changed', null);
        return Promise.resolve(true);
      }
      if (cmd === 'orchestration_snapshot') return Promise.resolve((answers.orchestration_snapshot ?? []).map(window.__sumFull));
      if (cmd.startsWith('producer_chat_') && window.__pc) return window.__pc(cmd, args);
      if (cmd === 'orchestration_run') return Promise.resolve((window.__details ?? {})[args.runId] ?? window.__detail);
      // ③ 작업자 상세 — 고정 대화 끝 쪽 · 최근 활동(상세가 연 칸에만 wip) · 보고 파일 목록
      if (cmd === 'orchestration_worker_transcript') return Promise.resolve({ items: (window.__transcripts ?? {})[args.attemptId] ?? [], cursor: null });
      if (cmd === 'orchestration_worker_activity') return Promise.resolve(window.__activity ? window.__activity(args) : {});
      if (cmd === 'orchestration_report_files') return Promise.resolve((window.__reportFiles ?? {})[args.reportId] ?? { taskId: args.taskId, reportId: args.reportId, attemptId: '', base: 'b', commit: 'c', files: [], fileCount: 0, truncated: false });
      // (실기 b 고침 A) 감독 사건 — 미확인 목록은 비고, 확인한 것은 sessionStorage 에 적어 \`recent: true\` 로 돌려준다(F5 를 건너 산다 — 서버 메모리 흉내)
      if (cmd === 'orchestration_notices') { let r = []; try { r = JSON.parse(sessionStorage.getItem('h.recent') ?? '[]'); } catch {} return Promise.resolve(args?.recent ? r : []); }
      if (cmd === 'orchestration_notices_ack') { const sent = window.__sentNotices ?? {}; let r = []; try { r = JSON.parse(sessionStorage.getItem('h.recent') ?? '[]'); } catch {} for (const id of args.ids ?? []) if (sent[id]) r.push(sent[id]); sessionStorage.setItem('h.recent', JSON.stringify(r)); return Promise.resolve({ acked: (args.ids ?? []).length }); }
      if (cmd === 'load_settings') return Promise.resolve(window.__settings);
      if (cmd === 'vault_status') return Promise.resolve(window.__vault);
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
await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
await reloadBoot(send, ev);
await sleep(800);
errors.length = 0;

const tabsMod = importApp("app/tabs.svelte.ts");
const keysMod = importApp("app/keys.svelte.ts");
const orchMod = importApp("app/orchestration.svelte.ts");
const calls = async (cmd) => JSON.parse(await ev(`JSON.stringify(window.__calls.filter(([c]) => c === '${cmd}').map(([, a]) => a))`));
const tabState = async () =>
  JSON.parse(
    await ev(`(async () => { const m = await ${tabsMod}; const t = m.activeTab(); const walk = (n) => n.type === 'leaf' ? [{ id: n.pane.id, kind: n.pane.kind, ai: !!n.pane.injectMcpToken, run: n.pane.run?.runId ?? null }] : [...walk(n.a), ...walk(n.b)];
      return JSON.stringify({ id: t.id, orch: t.orch ?? null, title: t.pinnedTitle ?? null, split: t.root.type === 'split' ? t.root.dir : null, leaves: walk(t.root), count: m.currentWorkspaceTabs().length }); })()`),
  );

const ONLY = process.env.ORCH_ONLY ?? "";
const H = '.pane-box:not(.hidden)';
const need = async (expr) => {
  if (!await until(expr)) { await shot('legacy-preparation-timeout.png'); throw new Error('옛 묶음 준비 시간 초과: ' + expr); }
};
const fill = async (selector, value) => {
  await need(`!!document.querySelector('${H} ${selector}')`);
  await ev(`(() => { const el = document.querySelector('${H} ${selector}'); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
};
// 옛 묶음의 채팅·깨움 준비도 실제 입구인 라이브러리 → 초안 → 가짜 앨범 시작을 지난다.
const legacyDraft = async () => {
  await ev(`(() => {
    window.__answers.orchestration_artist_list = [{ id: 'a-legacy', name: '구현', icon: 'claude', cli: 'claude', kind: 'write', model: 'sonnet', effort: 'high', instructions: '' }];
    window.__answers.orchestration_album_defaults = { members: [{ artist: 'a-legacy', grade: 'edit', allowedCommands: [] }], producer: { cli: 'claude', model: 'opus', effort: 'high' } };
    window.__albumFailure = null; window.__albumNotSent = false; window.__albumLostReply = false;
    window.__pcState.busy = false; window.__pcState.q = []; window.__pcState.held = false;
    window.__answers.agent_conversation_transcript = { items: [], cursor: null };
    window.__emit('orchestration-artists-changed', null);
  })()`);
  await ev(`(async () => (await ${orchMod}).openOrchHome())()`);
  await need(`!!document.querySelector('${H} [data-library-new-album]')`);
  await ev(`document.querySelector('${H} [data-library-new-album]').click()`);
  await need(`!!document.querySelector('${H} [data-new-album]')`);
  await need(`document.querySelector('${H} [data-new-browse]')?.matches(':enabled') === true`);
  await ev(`document.querySelector('${H} [data-new-browse]').click()`);
  await fill('[data-new-repo-path]', 'C:/work/api');
  await need(`document.querySelector('${H} [data-new-repo-apply]')?.matches(':enabled') === true`);
  await ev(`document.querySelector('${H} [data-new-repo-apply]').click()`);
  await need(`document.querySelector('${H} [data-new-model]')?.value === 'opus' && document.querySelectorAll('${H} [data-new-member]').length === 1`);
};
const sendLegacyAlbum = async (runId, name, text) => {
  await fill('[data-new-name]', name); await fill('[data-new-first]', text);
  await need(`document.querySelector('${H} [data-new-start]')?.disabled === false`);
  await ev(`window.__albumRunId = ${JSON.stringify(runId)}; document.querySelector('${H} [data-new-start]').click()`);
  await need(`(async () => (await ${tabsMod}).activeTab()?.orch?.runId === ${JSON.stringify(runId)})()`);
  await need(`!!document.querySelector('${H} [data-producer-face] [data-flip-input]') && !!document.querySelector('${H} [data-album-head]')`);
  const input = (await calls('producer_album_start')).slice(-1)[0]?.input;
  if (!input?.chat) throw new Error('옛 묶음: producer_album_start 입력 없음');
  await need(`window.__calls.some(([c, a]) => c === 'producer_chat_subscribe' && a.chat === ${JSON.stringify(input.chat)})`);
  return input;
};
const legacyAlbum = async (runId, name, text) => { await legacyDraft(); return sendLegacyAlbum(runId, name, text); };
const v3 = { ev, until, tabState, orchMod, tabsMod, check, shot, calls, squareButtons, NOW, DETAIL, send, waitBoot, reloadBoot, importApp };
if (ONLY === "") {
// ① 팔레트 → 한 잎 라이브러리. 새 앨범 칸은 F2의 new 경로에서만 선다.
const before = (await tabState()).count;
await ev(`(async () => (await ${keysMod}).runAction('orchestration-board'))()`);
await until(`!!document.querySelector('[data-orch-library]')`);
let s = await tabState();
check("① 라이브러리 — 새 탭 · 경로 표지 · 플레이어 한 잎", [s.count - before, s.orch, s.leaves.map((p) => p.kind)], [1, { view: "library" }, ["run"]]);
await shot("orch-home.png");
await legacyDraft();

// ② 초안에는 서버 채팅이 없고 보내기에서 가짜 producer_album_start가 앨범을 만든다.
const BODY = "로그 형식을 통일해 줘";
const sess0 = (await calls("open_local_session")).length;
const w0 = (await calls("write_session")).length;
await shot("orch-preparing.png");
const tabsBefore = (await tabState()).count;
const started2 = await sendLegacyAlbum('run-aaaa', '로그 회전 앨범', BODY);
s = await tabState();
check("② 보내기 — 앨범 시작에 저장소·첫 말, fresh/send 없음", [started2.repo, started2.text, (await calls('producer_chat_open')).length, (await calls('producer_chat_send')).length], ['C:/work/api', BODY, 0, 0]);
check("② CLI 창 없음 · PTY 쓰기 없음 · 표지 명령 없음", [(await calls("open_local_session")).length - sess0, (await calls("write_session")).length - w0, await ev(`window.__calls.some(([c]) => c === 'orchestration_set_producer')`)], [0, 0, false]);
// ③ 성공 답이 같은 탭의 앨범 경로와 왼쪽 채팅으로 연결된다. 이벤트 장부 길은 ⑪에서 보존한다.
check("③ 같은 탭이 앨범 — 새 탭 없음", [s.orch, s.count - tabsBefore, s.leaves.map((p) => p.kind)], [{ view: "album", runId: "run-aaaa" }, 0, ['producer', 'run']]);
check("③ 플레이어 주소 · 제목", [s.leaves.find((p) => p.kind === 'run')?.run, s.title], ["run-aaaa", "로그 회전 앨범"]);
await until(`!!document.querySelector('[data-orch-bar-action="pause"]:not([disabled])')`);
await ev(`document.querySelector('[data-orch-bar-action="pause"]').click()`);
await until(`window.__calls.some(([c]) => c === 'orchestration_pause')`);
check("③ ⏸ → orchestration_pause", (await calls("orchestration_pause")).map((a) => a.runId), ["run-aaaa"]);
check(
  "③ ✕ = 프로듀서 채팅 응답 끊기(쉬는 중이면 꺼짐 · Esc 문구 없음)",
  await ev(`(() => { const b = document.querySelector('.orch-strip:not(.hidden) [data-orch-bar-action="interrupt"]'); return [b?.disabled, b?.title.includes('Esc')]; })()`),
  [true, false],
);
check("③ 작업자 수 표시", await ev(`document.querySelector('[data-orch-bar-workers]')?.textContent.trim()`), "아티스트 0 / 3");
await sleep(400);
await shot("orch-album.png");
// F3: 닫기는 확인 없이 구독만 푼다. 같은 앨범·채팅을 다시 열어 ③-b 이후의 판을 복원한다.
// 경로 이동·라이브러리 기다림 등 수명 상세는 v3-producer-lives에서 검사한다.
{
  const albumTabId = s.id;
  const chat = started2.chat;
  const close0 = (await calls('producer_chat_close')).length;
  const unsub0 = (await calls('producer_chat_unsubscribe')).filter(a => a.chat === chat).length;
  const sub0 = (await calls('producer_chat_subscribe')).filter(a => a.chat === chat).length;
  const open0 = (await calls('producer_chat_open')).length;
  const start0 = (await calls('producer_album_start')).length;
  const send0 = (await calls('producer_chat_send')).length;
  await ev(`(async () => { const m = await ${tabsMod}; void m.closeTabAsked(${JSON.stringify(albumTabId)}); })()`);
  const closed = await until(`(async () => { const m = await ${tabsMod}; return !m.residentWindowTabs().some(t => t.id === ${JSON.stringify(albumTabId)}) && window.__calls.filter(([c, a]) => c === 'producer_chat_unsubscribe' && a.chat === ${JSON.stringify(chat)}).length > ${unsub0}; })()`);
  check(
    "③ 앨범 탭 닫기 — 확인 없이 닫힘·구독만 해제·서버 close 0",
    [closed, await ev(`!!document.querySelector('[data-confirm-dialog]')`), (await calls('producer_chat_close')).length - close0, await ev(`window.__pcState.chats[${JSON.stringify(chat)}]?.run === 'run-aaaa'`)],
    [true, false, 0, true],
  );
  await ev(`(async () => (await ${orchMod}).openAlbumTab('run-aaaa'))()`);
  await need(`!!document.querySelector('${H} [data-producer-face="${chat}"] [data-flip-input]') && !!document.querySelector('${H} [data-album-head]') && !document.querySelector('[data-confirm-dialog]')`);
  await need(`window.__calls.filter(([c, a]) => c === 'producer_chat_subscribe' && a.chat === ${JSON.stringify(chat)}).length > ${sub0}`);
  check("③ 다시 열기 — 같은 채팅 재구독·새 open/start/send 없음·close 0", [
    (await calls('producer_chat_subscribe')).slice(-1)[0]?.chat,
    (await calls('producer_chat_open')).length - open0,
    (await calls('producer_album_start')).length - start0,
    (await calls('producer_chat_send')).length - send0,
    (await calls('producer_chat_close')).length - close0,
  ], [chat, 0, 0, 0, 0]);
  s = await tabState();
  check("③ 후속 상태 복원 — 다시 연 탭·같은 앨범 경로·플레이어·제목", [s.id !== albumTabId, s.count, s.orch, s.leaves.map(p => p.kind), s.leaves.find(p => p.kind === 'run')?.run, s.title], [true, tabsBefore, { view: 'album', runId: 'run-aaaa' }, ['producer', 'run'], 'run-aaaa', '로그 회전 앨범']);
  await shot("orch-album-reopened.png");
}

// ③-b 앨범 판(② — 목업 Main): 트랙 다섯(검토 중 · 작업 중 · 막힘 · 수락 · 검증 대기) → 펼침 · [검증 실행] · 사람 필요 배지 · 보류/저장 실패 · 완료
let seqNo = 1;
const pushDetail = async (d) => {
  seqNo += 1;
  await ev(`(() => { window.__detail = Object.assign(${JSON.stringify(d)}, { latestSeq: ${seqNo} }); window.__details[window.__detail.runId] = window.__detail; window.__emit('orchestration-changed', { runId: 'run-aaaa', seq: ${seqNo} }); })()`);
  await sleep(500);
};
const HEAD = "a3f9c21d0e8b7a6f5e4d3c2b1a09f8e7d6c5b4a3";
const T0 = NOW - 40 * 60_000;
const tsk = (id, title, state, cur, extra = {}) => ({ id, title, goal: title, dependsOn: [], version: 1, state, currentAttempt: cur, createdAt: T0, updatedAt: NOW, ...extra });
const atp = (id, taskId, cli, roleName, kind, state, turns, extra = {}) => ({
  id, taskId, cli, gen: 1, state, kind, roleName, role: kind === "judge" ? "reviewer" : "worker", startedAt: NOW - 11 * 60_000,
  worktree: `C:/work/api-wt/${id}`, branch: `orch-${id}`, conversationId: null, turns, ...extra,
});
const turnRun = (n, tool, model) => ({ n, startedAt: NOW - 6 * 60_000, outcome: "running", tools: 7, denials: 0, lastTool: tool, model });
const turnOk = (n) => ({ n, startedAt: NOW - 20 * 60_000, endedAt: NOW - 14 * 60_000, outcome: "ok", tools: 12, denials: 0 });
const rep = (reportId, attemptId, taskId) => ({ reportId, attemptId, taskId, outcome: "success", summary: "끝냈습니다", commitOid: "c0ffee1234", baseCommitOid: HEAD, dirty: false, changedFiles: ["src/a.rs"], at: NOW - 9 * 60_000, late: false });
const FULL = {
  ...DETAIL,
  name: "README TODO 정리",
  limits: { ...DETAIL.limits, maxTasks: 20, maxCallsPerMinute: 30, maxReviews: 4 },
  remaining: { ...DETAIL.remaining, reviews: 3, concurrentWorkers: 1 },
  verify: { command: "npm test", commandSha: "sha", timeoutMinutes: 10, autoRun: false },
  integration: { workRef: "refs/aynx/orch/aaaa/int", exportBranch: "orch-aaaa-int", baseCommit: "1234567890", baseBranch: "main", expectedHead: HEAD, exportedHead: null },
  roles: [{ id: "impl", name: "impl", kind: "write", cli: "claude", usable: true }, { id: "fixer", name: "fixer", kind: "write", cli: "codex", usable: true }, { id: "review", name: "review", kind: "judge", cli: "codex", usable: true }],
  tasks: [
    tsk("t1", "설정 파일 TODO 정리", "reported", "a1"),
    tsk("t2", "로그 회전 추가", "active", "a2"),
    tsk("t3", "문서 링크 고치기", "active", "a3"),
    tsk("t4", "오타 정리", "accepted", "a4"),
    tsk("t5", "경로 정규화 공통 함수", "reported", "a5"),
  ],
  attempts: [
    atp("a1", "t1", "claude", "impl", "write", "reported", [turnOk(1)], { endedAt: NOW - 9 * 60_000 }),
    atp("r1", "t1", "codex", "review", "judge", "running", [turnRun(1, "Read", null)], { reviewOf: { reportId: "p1", commitOid: "c0ffee1234" } }),
    atp("a2", "t2", "claude", "impl", "write", "running", [turnRun(1, "Edit src/log.rs", "sonnet")]),
    atp("a3", "t3", "codex", "fixer", "write", "idle", [turnOk(1)], { blocked: { need: "네트워크 접근(curl) 필요 — 링크가 살아 있는지 확인하려면 바깥 주소에 닿아야 합니다", at: NOW - 4 * 60_000 } }),
    atp("a4", "t4", "codex", "fixer", "write", "reported", [turnOk(1)], { endedAt: NOW - 30 * 60_000, startedAt: NOW - 33 * 60_000 }),
    atp("a5", "t5", "claude", "impl", "write", "reported", [turnOk(1)], { endedAt: NOW - 2 * 60_000 }),
  ],
  reports: [rep("p1", "a1", "t1"), rep("p4", "a4", "t4"), rep("p5", "a5", "t5")],
  reviewState: { t1: { state: "pending", reportId: "p1", attemptId: "r1" } },
  accepted: [{ taskId: "t4", attemptId: "a4", reportId: "p4", commitOid: "c0ffee1234", reviewer: "coordinator", verification: null, acceptedAt: NOW - 25 * 60_000, integrationCommit: HEAD }],
  jobs: [{ jobId: "j5", taskId: "t5", phase: "awaiting-approval", candidate: "cand5555555", old: HEAD, startedAt: NOW - 60_000, awaitingAt: NOW - 60_000 }],
  log: [{ seq: 1, at: NOW - 60_000, actor: "coordinator", action: "create_task", target: "t1", outcome: "ok" }],
};
await pushDetail(FULL);
await need(`document.querySelectorAll('${H} [data-run-tracks] [data-track]').length === 5`);
check(
  "③-b 트랙 글리프 — 검토 · 재생 · 막힘 · 번호 · 시계",
  await ev(`[...document.querySelectorAll('[data-track]')].map(x => x.dataset.trackGlyph)`),
  ["reviewing", "playing", "attention", "number", "waiting"],
);
check('③-b 막힌 줄 [앨범 권한] · 검증 줄 [검증 실행]', await ev(`[...document.querySelectorAll('[data-track-gate]')].map(x => x.textContent.trim())`), ['앨범 권한', '검증 실행']);
check("③-b 번호를 가린 그림의 aria — '#2 · …'", await ev(`document.querySelector('[data-track="t2"] .no')?.getAttribute('aria-label')?.startsWith('#2 · ')`), true);
check("③-b 머리 메타 — 트랙 5 · 수락 1 · 통합 a3f9c21", await ev(`[document.querySelector('[data-album-tracks]')?.textContent, document.querySelector('[data-album-accepted]')?.textContent, document.querySelector('[data-album-head] [data-integration-head]')?.textContent.includes('a3f9c21')]`), ["트랙 5", "수락 1", true]);
check("③-b 참여 아티스트 Claude · Codex", await ev(`[...document.querySelectorAll('[data-album-artists] [data-artist]')].map(x => x.dataset.artist)`), ["claude", "codex"]);
check("③-b 판 · 막대에 undefined 없음", await ev(`!/undefined|NaN/.test(document.querySelector('[data-run-board]').innerText + document.querySelector('.orch-strip:not(.hidden)').innerText)`), true);
check("③-b 막대 — 지금 곡 = 로그 회전(작업 중)", await ev(`[document.querySelector('[data-orch-now]')?.dataset.orchNow, document.querySelector('[data-orch-now] .name')?.textContent.trim()]`), ["a2", "#2 로그 회전 추가"]);
check("③-b 막대 — 사람 필요 2(막힘 · 검증) · 검토 1/4", await ev(`[document.querySelector('[data-orch-bar-needs]')?.dataset.orchBarNeeds, document.querySelector('[data-orch-bar-reviews]')?.textContent.trim()]`), ["2", "검토 1 / 4"]);
check("③-b 막대 카드 높이 96", await ev(`Math.round(document.querySelector('.orch-strip:not(.hidden) [data-orch-bar]').getBoundingClientRect().height)`), 96);
await shot("album-main.png");
await termScan("앨범 판 · 재생 막대");
await shot("terms-album.png");
// ⑰ (10-30 실기 다듬기) 단추 모양 · 상태 아이콘 · 재생 막대 글래스
{
  check("⑰ 상태 칸 아이콘 — 검토 · 재생 · 막힘 · 수락 · 확인 대기", await ev(`[...document.querySelectorAll('[data-track]')].map(x => x.querySelector('[data-track-status-icon]')?.dataset.trackStatusIcon)`), ["reviewing", "playing", "attention", "done", "waiting"]);
  check("⑰ 상태 칸 그림이 실제로 선다(5) · 앨범 머리 = 사람 필요(경고)", await ev(`[document.querySelectorAll('[data-track] .status [data-status-icon]').length, document.querySelector('[data-album-head] [data-run-state-icon]')?.dataset.runStateIcon]`), [5, "attention"]);
  check("⑰ 단추 모양 — 뒤로 · [더 보기] = 원 · 내보내기 = 알약", await ev(`['[data-orch-back]', '[data-album-more]', '[data-run-action="export"]'].map(selector => { const el = document.querySelector('${H} ' + selector); if (!(el instanceof Element)) throw new Error('단추 모양 검사 대상 없음: ' + selector); return getComputedStyle(el).borderTopLeftRadius; })`), ["50%", "50%", "999px"]);
  check("⑰ 칠한 단추 중 직각(반지름 < 6px) 없음 — 앨범 판 · 막대 · 채팅", await squareButtons(), []);
  check("⑰ 사람 필요 종 — 있을 때 문구(n건)", await ev(`document.querySelector('[data-orch-bar-needs]')?.getAttribute('title')`), "사람이 필요한 일 2건 — 누르면 그 트랙으로");
  // 막대 글래스 — 평면이면 지금 모양(단색) · 글래스면 독과 같은 판(`.glass-mid` — 흐림 한 겹 · 흰 선)
  const bar = `document.querySelector('.orch-strip:not(.hidden) [data-orch-bar]')`;
  const mat0 = await ev(`document.documentElement.dataset.material ?? ''`);
  await ev(`document.documentElement.dataset.material = 'flat'`);
  await sleep(250);
  await shot("polish-album-flat-dark.png");
  const flatBg = await ev(`getComputedStyle(${bar}).backgroundColor`);
  check("⑰ 평면 막대 = 단색 판(흐림 없음)", await ev(`[${bar}.classList.contains('glass-mid'), getComputedStyle(${bar}, '::before').backdropFilter]`), [true, "none"]);
  await ev(`document.documentElement.dataset.material = 'glass'`);
  await sleep(250);
  check("⑰ 글래스 막대 — 흐림 한 겹 · 판 색이 바뀜", await ev(`[getComputedStyle(${bar}, '::before').backdropFilter.includes('blur'), getComputedStyle(${bar}).backgroundColor !== ${JSON.stringify(flatBg)}]`), [true, true]);
  await shot("polish-album-glass-dark.png");
  await ev(`document.documentElement.dataset.theme = 'light'`);
  await sleep(250);
  await shot("polish-album-glass-light.png");
  await ev(`document.documentElement.dataset.material = 'flat'`);
  await sleep(250);
  await shot("polish-album-flat-light.png");
  await ev(`document.documentElement.dataset.theme = 'dark'`);
  await sleep(250);
  check("⑰ 평면으로 되돌리면 막대 판 색 그대로", await ev(`getComputedStyle(${bar}).backgroundColor`), flatBg);
  if (mat0) await ev(`document.documentElement.dataset.material = ${JSON.stringify(mat0)}`);
  else await ev(`delete document.documentElement.dataset.material`);
  await sleep(250);
}
// F4: 지금 곡·배지·검증 관문·뒤로/Esc·가사 검사는 v3-track 묶음이 맡는다.
// 앨범 [더 보기]의 동작은 이 묶음에 남긴다.
await ev(`document.querySelector('[data-album-more]').click()`);
await until(`!!document.querySelector('[data-toolbar-menu]')`);
check('③-b [⋯] 메뉴 — 일시정지 · 내보내기는 머리 · 중단 · 인라인 판 없음', await ev(`[!!document.querySelector('[data-toolbar-menu] [data-menu-key="pause"]'), !!document.querySelector('[data-album-head] [data-run-action="export"]'), !!document.querySelector('[data-toolbar-menu] [data-menu-key="stop"]'), !!document.querySelector('[data-album-more-panel]')]`), [true, true, true, false]);
await shot('album-review.png');
// 메뉴 줄이 실제로 일을 한다(스냅샷 → 닫기 → 실행) — 일시정지 · 앨범 정보 · 중단 확인
{
  const p0 = (await calls("orchestration_pause")).length;
  await ev(`document.querySelector('[data-toolbar-menu] [data-menu-key="pause"]').click()`);
  await until(`!document.querySelector('[data-toolbar-menu]')`);
  check("③-b 메뉴 [일시정지] — 닫히고 서버 호출 한 번", (await calls("orchestration_pause")).length - p0, 1);
  const pickRow = async (key) => {
    await until(`!document.querySelector('[data-album-more]').disabled`);
    await ev(`document.querySelector('[data-album-more]').click()`);
    await until(`!!document.querySelector('[data-toolbar-menu] [data-menu-key="${key}"]:not(:disabled)')`);
    await ev(`document.querySelector('[data-toolbar-menu] [data-menu-key="${key}"]').click()`);
    await until(`!document.querySelector('[data-toolbar-menu]')`);
  };
  await pickRow("info");
  await until(`!!document.querySelector('[data-album-info]')`);
  check("③-b 메뉴 [앨범 정보] — 앨범 위의 창", await ev(`!!document.querySelector('[data-album-info]')`), true);
  await ev(`document.querySelector('[data-album-info] .btn').click()`);
  await until(`!document.querySelector('[data-album-info]')`);
}

// 보류 + 저장 실패(F7) + 프로듀서 없음(멈춤)
await pushDetail({ ...FULL, state: "paused", pauseReason: "hold", coordinatorAttached: false, hold: { reason: "integration-diverged", at: NOW }, persist: { ok: false, lastSavedSeq: 1, failing: { since: NOW - 30_000, reason: "disk-full", count: 3 } } });
await until(`!!document.querySelector('[data-run-hold]') && !!document.querySelector('[data-run-persist-failing]')`);
check("③-b 보류 막대 · 저장 실패 띠 · [조정]", await ev(`[document.querySelector('[data-run-hold]')?.dataset.runHold, document.querySelector('[data-run-persist-failing]')?.dataset.runPersistFailing, !!document.querySelector('[data-run-action="reconcile"]')]`), ["integration-diverged", "disk-full", true]);
check("③-b 보류면 사람 필요 첫 항목은 앨범 단위", await ev(`document.querySelector('[data-orch-bar-needs]')?.dataset.orchBarNeeds`), "3");
await ev(`document.querySelector('[data-run-board] .scroll').scrollTo(0, 0)`);
await sleep(300);
await shot("album-hold.png");
// ⑰ 조율 멈춤 띠 — 재생 막대 바로 위 한 줄(호박) · 머리의 같은 띠는 걷음 · 긴 설명은 툴팁 · 앨범 상태 아이콘 = 멈춤
{
  const geo = `(() => { const b = document.querySelector('[data-run-pause-band]'); const s = document.querySelector('.orch-strip:not(.hidden) [data-orch-bar]'); const br = b.getBoundingClientRect(); const sr = s.getBoundingClientRect(); const board = document.querySelector('.pane-box:not(.hidden) [data-run-board]'); return { gap: Math.round(sr.top - br.bottom), oneLine: br.height <= 44, noOverflow: board.scrollWidth <= board.clientWidth + 1, title: (b.getAttribute('title') ?? '').length > b.textContent.trim().length }; })()`;
  check("⑰ 멈춤 띠 — 보류 · 머리 띠(phrase) 없음 · 앨범 아이콘 멈춤", await ev(`[document.querySelector('[data-run-pause-band]')?.dataset.runPauseBand, !!document.querySelector('[data-run-phrase]'), document.querySelector('[data-run-state-icon]')?.dataset.runStateIcon]`), ["hold", false, "paused"]);
  const g1 = JSON.parse(await ev(`JSON.stringify(${geo})`));
  check("⑰ 멈춤 띠 — 막대 바로 위(간격 0~40px) · 한 줄 · 긴 설명은 툴팁", [g1.gap >= 0 && g1.gap <= 40, g1.oneLine, g1.title], [true, true, true]);
  await shot("polish-paused-band.png");
  await pushDetail({ ...FULL, state: "paused", pauseReason: "human", coordinatorAttached: true });
  await until(`document.querySelector('[data-run-pause-band]')?.dataset.runPauseBand === 'paused'`);
  check("⑰ 멈춤 띠 — 사람의 일시정지 · [재개] 단추 · 짧은 문구", await ev(`[!!document.querySelector('[data-run-pause-action="resume"]'), document.querySelector('[data-run-pause-band] .pause-text')?.textContent.trim()]`), [true, "조율 멈춤 — 아티스트는 계속 돎"]);
  const rN = (await calls("orchestration_resume")).length;
  await ev(`document.querySelector('[data-run-pause-action="resume"]').click()`);
  await until(`window.__calls.filter(([c]) => c === 'orchestration_resume').length > ${rN}`);
  check("⑰ 멈춤 띠 [재개] → orchestration_resume", (await calls("orchestration_resume")).length - rN, 1);
  await sleep(300);
  await shot("polish-paused-resume.png");
  // 620px — 한 줄 · 막대와 겹치지 않음 · 판 가로 넘침 없음(다크 · 라이트) · 1200px
  await send("Emulation.setDeviceMetricsOverride", { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  const g2 = JSON.parse(await ev(`JSON.stringify(${geo})`));
  check("⑰ 620px 멈춤 띠 — 막대 위 · 한 줄 · 넘침 없음", [g2.gap >= 0 && g2.gap <= 40, g2.oneLine, g2.noOverflow], [true, true, true]);
  await shot("polish-paused-620-dark.png");
  await ev(`document.documentElement.dataset.theme = 'light'`);
  await sleep(250);
  await shot("polish-paused-620-light.png");
  await ev(`document.documentElement.dataset.theme = 'dark'`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(400);
  await shot("polish-paused-1200-dark.png");
  await ev(`document.documentElement.dataset.theme = 'light'`);
  await sleep(250);
  await shot("polish-paused-1200-light.png");
  await ev(`document.documentElement.dataset.theme = 'dark'`);
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
}

// 완료
const doneTasks = FULL.tasks.map((x) => ({ ...x, state: "accepted" }));
const doneAtt = FULL.attempts.filter((a) => a.kind === "write").map((a) => ({ ...a, state: "reported", blocked: null, turns: [turnOk(1)], endedAt: NOW - 60_000 }));
await pushDetail({ ...FULL, state: "done", endedAt: NOW, tasks: doneTasks, attempts: doneAtt, jobs: [], reviewState: {}, accepted: doneTasks.map((x) => ({ taskId: x.id, attemptId: x.currentAttempt, reportId: "p", commitOid: "c0ffee1234", reviewer: "coordinator", verification: null, acceptedAt: NOW - 60_000, integrationCommit: HEAD })) });
await until(`[...document.querySelectorAll('[data-track]')].every(x => x.dataset.tone === 'done')`);
check("⑰ 끝난 앨범 — 멈춤 띠 없음 · 앨범 아이콘 = 체크 · 종 꺼짐 · 툴팁(없음 + 뜻)", await ev(`[!!document.querySelector('[data-run-pause-band]'), document.querySelector('[data-run-state-icon]')?.dataset.runStateIcon, document.querySelector('[data-orch-bar-needs]')?.getAttribute('aria-disabled'), (document.querySelector('[data-orch-bar-needs]')?.getAttribute('title') ?? '').startsWith('사람이 필요한 일 없음 —')]`), [false, "done", "true", true]);
check("③-b 완료 — 전부 번호 · 초록 · 배지 0", await ev(`[[...document.querySelectorAll('[data-track]')].map(x => x.dataset.trackGlyph).join(','), document.querySelector('[data-orch-bar-needs]')?.dataset.orchBarNeeds]`), ["number,number,number,number,number", "0"]);
await sleep(300);
await shot("album-done.png");
// F4: ③-c 작업자 상세 검사는 독립 v3-track{,-judge,-blocked,-verify-ask}로 옮겼다.

// 다음 단계(④~)를 위해 빈 앨범으로 되돌린다
await pushDetail(DETAIL);

// ④ D11 — 오케스트레이션 탭이 지금 탭일 때 여는 타일은 새 탭 · 분할은 거절
const albumTab = s.id;
await ev(`(async () => { const m = await ${tabsMod}; const sess = await ${importApp("lib/session.ts")}; m.openPaneHere(sess.newLocalPane()); })()`);
await sleep(400);
s = await tabState();
check("④ 여기 열기 = 새 탭", [s.id !== albumTab, s.orch, s.leaves.map((l) => l.kind)], [true, null, ["local"]]);
await ev(`(async () => { const m = await ${tabsMod}; m.pickTab(${JSON.stringify(albumTab)}); m.splitActive(); })()`);
await sleep(300);
check("④ 분할 거절 — 잎 둘 그대로", (await tabState()).leaves.length, 2);

// ⑤ 보통 AI 타일의 메뉴 노출·순서 → fork 잠긴 초안 → 시작. 원래 타일 보존·채팅 탭 이관은 계속 검사한다.
const FORK_SRC = "0f0f0f0f-1111-4222-8333-444444444444";
await ev(`(async () => { const m = await ${tabsMod}; const sess = await ${importApp("lib/session.ts")}; m.openInNewTab(sess.newAiPane('claude', 'C:/work/api')); })()`);
await sleep(800);
s = await tabState();
const aiId = s.leaves[0].id;
const aiTabId = s.id;
check("⑤ 보통 탭의 AI 타일", [s.orch, s.leaves.map((l) => l.kind)], [null, ["local"]]);
const menuRows = async () => {
  await ev(`document.querySelector('[data-pane="${aiId}"] [data-pane-head]')?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 100 }))`);
  await sleep(300);
  return JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"]')].map(b => b.textContent.trim()))`));
};
const closeMenu = async () => { await ev(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`); await sleep(200); };
let rows5 = await menuRows();
check("⑤ 대화를 모르는 타일 — [오케스트레이션으로 이어 가기] 없음", rows5.some((x) => x.includes("오케스트레이션으로 이어 가기")), false);
await closeMenu();
await ev(`(async () => (await ${importApp("app/agent-sessions.svelte.ts")}).linkAgentSession(${JSON.stringify(aiId)}, 'claude', ${JSON.stringify(FORK_SRC)}))()`);
rows5 = await menuRows();
const iSide = rows5.findIndex((x) => x.includes("사이드 채팅에서 이어 가기"));
const iOrch = rows5.findIndex((x) => x.includes("오케스트레이션으로 이어 가기"));
check("⑤ 대화를 알면 줄이 선다 — 사이드 채팅 갈라 오기 바로 아래", [iOrch >= 0, iOrch === iSide + 1], [true, true]);
await shot("s5-fork-menu.png");
// F2가 대체한 fork fresh/스튜디오 안내 검사는 v3-fork의 probe·잠긴 초안·시작 몸 검사로 옮겼다.
await ev(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('오케스트레이션으로 이어 가기')).click()`);
await need(`!!document.querySelector('${H} [data-new-repo-locked]') && document.querySelector('${H} [data-new-model]')?.value === 'opus'`);
await sendLegacyAlbum('run-fork-legacy', '갈라 온 앨범', '원본 대화를 이어서 나눠 줘');
s = await tabState();
// Svelte 상태 Proxy는 CDP returnByValue로 직접 받으면 빈 객체가 된다. 페이지 안에서 직렬화한다(F1과 같은 경계).
const forkLeafSpec = JSON.parse(await ev(`(async () => { const t = (await ${tabsMod}).activeTab(); return JSON.stringify(t.root.a.pane.producer); })()`));
await need(`!!${JSON.stringify(forkLeafSpec?.chatId)} && document.querySelector('${H} [data-producer-face]')?.dataset.producerFace === ${JSON.stringify(forkLeafSpec?.chatId)} && window.__calls.some(([c, a]) => c === 'producer_chat_subscribe' && a.chat === ${JSON.stringify(forkLeafSpec?.chatId)})`);
check("⑤ 원래 타일은 제자리 그대로(같은 탭 · 같은 id · 보통 탭)", JSON.parse(await ev(`(async () => { const m = await ${tabsMod}; const t = m.currentWorkspaceTabs().find((x) => x.id === ${JSON.stringify(aiTabId)}); return JSON.stringify([!!t, t?.root.type === 'leaf' ? t.root.pane.id : null, !t?.orch]); })()`)), [true, aiId, true]);
await shot("s5-fork.png");
// 그 탭이 다른 창으로 옮겨 간다(뜯기 — 실제 창 넘기기 길: `startTear` → 받는 창의 release ACK `releaseWorkspaceTear` = markHandoff → 탭 빼기 → tick →
// releaseHandoff) → 구독만 푼다(같은 subGen) · 닫지 않는다. (실기 c 고침 A — 예전에는 잎이 타이머 안에서 이관 표시를 읽어 이미 풀린 표시로 채팅을 닫았다.
// 예전 하네스는 표시를 손으로 걸고 풀지 않아 그 틈을 못 봤다.)
{
  const forkChat = forkLeafSpec?.chatId ?? "";
  const forkTab = (await tabState()).id;
  const forkGen = await ev(`window.__pcState.gen[${JSON.stringify(forkChat)}]`);
  const unsubN = (await calls("producer_chat_unsubscribe")).length;
  const closeN = (await calls("producer_chat_close")).length;
  const released = await ev(`(async () => { window.__answers.stash_handoff = null; const tear = await ${importApp("app/tear.svelte.ts")}; const tok = tear.startTear(${JSON.stringify(forkTab)}); if (tok === null) return 'refused'; return await tear.releaseWorkspaceTear(tok); })()`);
  await until(`window.__calls.filter(([c]) => c === 'producer_chat_unsubscribe').length > ${unsubN}`);
  await sleep(300);
  check(
    "⑤ 뜯기(실제 release 길) — 옛 창은 그 subGen만 푼다 · 서버에서 닫지 않는다(close 0)",
    [released, (await calls("producer_chat_unsubscribe")).slice(unsubN).map((a) => [a.chat === forkChat, a.subGen]), (await calls("producer_chat_close")).length - closeN],
    [true, [[true, forkGen]], 0],
  );
}

// ⑧ 새 라이브러리의 저장소 필터·아티스트 열 검증으로 교체했다.
await ev(`(async () => (await ${orchMod}).openOrchHome())()`);
await need(`!!document.querySelector('${H} [data-orch-library]')`);
// ⑨ (⑤ · 10-31) 로고 · 상태 그림 — 목록 요약(running{write, judge}) → 탭 줄 상태 그림(헤드폰 · 막대 · ⏸ · 원 ✓) · 런처 독(늘 헤드폰 + 개수 배지) · 설정 메뉴 · 팔레트 정적 로고(헤드폰)
{
  const sum = (runId, name, state, extra = {}) => ({ runId, name, state, orphaned: state === 'orphaned', gen: 1, createdAt: NOW - 600_000, updatedAt: NOW, repo: 'C:/work/api', latestSeq: 3, taskCount: 2, taskStates: {}, attemptCount: 2, running: { write: 0, judge: 0 }, coordinatorStream: null, ...extra });
  const SNAP5 = [
    sum('p-play', '재생 앨범', 'running', { running: { write: 2, judge: 0 } }),
    sum('p-rev', '검토 앨범', 'running', { running: { write: 0, judge: 1 } }),
    sum('p-att', '막힌 앨범', 'running', { blocked: 1 }),
    sum('p-idle', '쉬는 앨범', 'running'),
    sum('p-done', '끝난 앨범', 'done'),
  ];
  const coordMod = importApp('app/orch-coordinators.svelte.ts');
  await ev(`(async () => { window.__answers.orchestration_snapshot = ${JSON.stringify(SNAP5)}; window.__details = {}; await (await ${coordMod}).refreshCoordinators(); })()`);
  for (const r of SNAP5) await ev(`(async () => (await ${orchMod}).openOrchPathInNewTab({ view: 'album', runId: ${JSON.stringify(r.runId)} }))()`);
  await sleep(600);
  const tabEq = await ev(`(async () => { const m = await ${tabsMod}; return JSON.stringify(m.currentWorkspaceTabs().filter((t) => t.orch).map((t) => [t.orch.runId ?? '', document.querySelector('[data-tab="' + t.id + '"] .kind [data-eq]')?.dataset.eq ?? null])); })()`);
  const eqOf = Object.fromEntries(JSON.parse(tabEq));
  // 10-31 조율 멈춤 = 사람 필요와 같은 호박 ⏸(세로 둥근 막대 둘 · 움직임 없음 — 사용자 "통일")
  await ev(`(async () => { window.__answers.orchestration_snapshot = [...${JSON.stringify(SNAP5)}, ${JSON.stringify(sum("p-pause", "멈춘 앨범", "paused"))}]; await (await ${coordMod}).refreshCoordinators(); })()`);
  await ev(`(async () => (await ${orchMod}).openOrchPathInNewTab({ view: 'album', runId: 'p-pause' }))()`);
  await sleep(600);
  check('10-31 멈춘 앨범 탭 = paused · ⏸(둥근 막대 둘) · 움직이는 막대 없음 · 사람 필요와 같은 그림 · 같은 색', await ev(`(async () => { const m = await ${tabsMod}; const eqOf = (id) => { const t = m.currentWorkspaceTabs().find((x) => x.orch?.runId === id); return document.querySelector('[data-tab="' + t.id + '"] .kind [data-eq]'); }; const p = eqOf('p-pause'); const a = eqOf('p-att'); const svg = p.querySelector('svg'); return [p.dataset.eq, svg?.dataset.eqShape, svg?.querySelectorAll('rect').length, p.querySelectorAll('.eq-bar').length, a.querySelector('svg')?.innerHTML === svg?.innerHTML, getComputedStyle(a).color === getComputedStyle(p).color]; })()`), ['paused', 'pause', 2, 0, true, true]);
  await shot("polish-tab-paused-bars.png");
  await ev(`(async () => { window.__answers.orchestration_snapshot = ${JSON.stringify(SNAP5)}; await (await ${coordMod}).refreshCoordinators(); })()`);
  await sleep(300);
  check('⑨ 탭 줄 막대 — 재생 · 검토 · 사람 필요 · 쉼 · 끝 · 홈 = 로고', ['p-play', 'p-rev', 'p-att', 'p-idle', 'p-done', ''].map((k) => eqOf[k] ?? null), ['playing', 'reviewing', 'attention', 'idle', 'done', 'logo']);
  check(
    '10-31 상태 그림 — 재생 · 검토 = 움직이는 막대 넷 · 사람 필요 = ⏸ · 끝 = 원 ✓ · 쉼 · 홈 = 헤드폰 · 칸 폭은 상태와 무관',
    await ev(`(() => { const q = (st) => document.querySelector('[role=tablist] [data-tab] .kind [data-eq="' + st + '"]'); const shape = (e) => e.querySelector('svg')?.dataset.eqShape ?? (e.querySelectorAll('.eq-bar').length + ' bars ' + (getComputedStyle(e.querySelector('.eq-bar')).animationName !== 'none' ? 'moving' : 'still')); const ws = ['playing', 'reviewing', 'attention', 'idle', 'done', 'logo'].map((s) => Math.round(q(s).getBoundingClientRect().width)); const d = q('done').querySelector('svg'); return [...['playing', 'reviewing', 'attention', 'idle', 'done', 'logo'].map((s) => shape(q(s))), !!d.querySelector('circle[fill=none]') && !!d.querySelector('path'), q('idle').querySelector('svg path')?.getAttribute('d'), new Set(ws).size]; })()`),
    ['4 bars moving', '4 bars moving', 'pause', 'headphones', 'check', 'headphones', true, 'M7 21H5q-.825 0-1.412-.587T3 19v-7q0-1.875.713-3.512t1.924-2.85t2.85-1.925T12 3t3.513.713t2.85 1.924t1.925 2.85T21 12v7q0 .825-.587 1.413T19 21h-2q-.825 0-1.412-.587T15 19v-4q0-.825.588-1.412T17 13h2v-1q0-2.925-2.037-4.962T12 5T7.038 7.038T5 12v1h2q.825 0 1.413.588T9 15v4q0 .825-.587 1.413T7 21m0-6H5v4h2zm10 0v4h2v-4zM7 15H5zm10 0h2z', 1],
  );
  // 막대는 제 칸 안 — 전역 `.bar`(BrowserToolbar) 같은 이름에 물들면 막대가 넓어져 탭 제목을 덮는다(10-31 첫 시도에서 본 것)
  check('10-31 탭 막대 넷이 칸 안 · 막대 폭 ≤ 4px', await ev(`(() => { const e = document.querySelector('[role=tablist] [data-tab] .kind [data-eq="playing"]'); const r = e.getBoundingClientRect(); return [...e.querySelectorAll('.eq-bar')].every((b) => { const q = b.getBoundingClientRect(); return q.width <= 4 && q.left >= r.left - 0.5 && q.right <= r.right + 0.5; }); })()`), true);
  await sleep(400);
  await shot('logo-tabs.png');
  // 런처 독 — 로고는 늘 헤드폰(상태 그림 없음 — 10-31) · 상태는 배지만: 산 앨범 4(끝난 것은 세지 않음) · 사람 필요가 있어 호박
  const HEAD_D = 'M7 21H5q-.825 0-1.412-.587T3 19v-7q0-1.875.713-3.512t1.924-2.85t2.85-1.925T12 3t3.513.713t2.85 1.924t1.925 2.85T21 12v7q0 .825-.587 1.413T19 21h-2q-.825 0-1.412-.587T15 19v-4q0-.825.588-1.412T17 13h2v-1q0-2.925-2.037-4.962T12 5T7.038 7.038T5 12v1h2q.825 0 1.413.588T9 15v4q0 .825-.587 1.413T7 21m0-6H5v4h2zm10 0v4h2v-4zM7 15H5zm10 0h2z';
  const dockTile = `(() => { const b = document.querySelector('[data-launch="orchestration-start"]'); const badge = b.querySelector('[data-orch-badge]'); return [!!b.querySelector('[data-eq]'), b.querySelector('.ico svg path')?.getAttribute('d'), b.querySelectorAll('.ico svg rect').length, badge?.textContent.trim() ?? null, badge?.classList.contains('attention') ?? null]; })()`;
  await ev(`(async () => (await ${importApp('app/dock.svelte.ts')}).openDock('alerts'))()`);
  await until(`!!document.querySelector('[data-launch="orchestration-start"] .ico svg')`);
  check('10-31 독 칸 — 앨범이 돌아도 헤드폰 그대로(상태 그림 없음) · 배지 4 · 호박', await ev(dockTile), [false, HEAD_D, 0, '4', true]);
  await sleep(400);
  await shot('logo-dock.png');
  // 재생만 도는 앨범 — 배지 파랑
  await ev(`(async () => { window.__answers.orchestration_snapshot = [${JSON.stringify(SNAP5[0])}]; await (await ${coordMod}).refreshCoordinators(); })()`);
  await sleep(300);
  check('10-31 독 칸 — 재생 앨범 하나 = 헤드폰 · 배지 1 · 파랑', await ev(dockTile), [false, HEAD_D, 0, '1', false]);
  // 조율 멈춤만 있어도 배지 호박
  await ev(`(async () => { window.__answers.orchestration_snapshot = [${JSON.stringify(SNAP5[0])}, ${JSON.stringify(sum('p-pause', '멈춘 앨범', 'paused'))}]; await (await ${coordMod}).refreshCoordinators(); })()`);
  await sleep(300);
  check('10-31 독 칸 — 조율 멈춤 = 헤드폰 · 배지 2 · 호박', await ev(dockTile), [false, HEAD_D, 0, '2', true]);
  // 산 앨범이 없으면 헤드폰 · 배지 없음
  await ev(`(async () => { window.__answers.orchestration_snapshot = [${JSON.stringify(SNAP5[4])}]; await (await ${coordMod}).refreshCoordinators(); })()`);
  await sleep(300);
  check('⑨ 독 칸 — 산 앨범 없음 = 헤드폰 · 배지 없음', await ev(dockTile), [false, HEAD_D, 0, null, null]);
  await ev(`(async () => (await ${importApp('app/dock.svelte.ts')}).closeDock())()`);
  // 정적 로고(설정 메뉴 · 팔레트 · 알림 줄의 `UiIcon name="orchestra"`)도 같은 헤드폰
  check('10-31 정적 로고 orchestra = 헤드폰', await ev(`(async () => { const m = await ${importApp('/src/lib/ui-icons.generated.ts')}; return m.UI_ICONS.orchestra.body.includes(${JSON.stringify(HEAD_D)}); })()`), true);
  // 팔레트 — 오케스트레이션 줄의 그림
  check('⑨ 팔레트 그림표 — orchestration-board · start = orchestra', await ev(`(async () => { const m = await ${importApp('/src/lib/dock.ts')}; return JSON.stringify(m.DOCK_ACTION_ICONS.filter(([a]) => a.startsWith('orchestration-'))); })()`), JSON.stringify([['orchestration-start', 'orchestra'], ['orchestration-board', 'orchestra']]));
}
}
// ⑪ 프로듀서 채팅 — 새 앨범 초안 → 시작 답의 채팅 구독 · 응답(스텁 사건 흐름) ·
// 에이전트 머리 · 도구 알약(get_run · create_task ×2 · spawn_worker role=impl) · 사람 시작 답 → 같은 탭이 앨범 · 대기열(턴 중 보낸 말 ·
// [취소]) · [끊고 전달] · ✕(머리 · 재생 막대 = interrupt deliverQueued:false) · 권한 카드(→ decide) · 정책 거절 줄 · exited + [다시 띄우기](resume) · 좁은 폭
if (ONLY === "" || ONLY === "producer") {
  const H = ".pane-box:not(.hidden)";
  const F = `${H} [data-producer-face]`;
  await ev(`(() => { window.__details = window.__details ?? {}; window.__details['run-pc'] = Object.assign(JSON.parse(JSON.stringify(window.__detail)), { runId: 'run-pc', name: '프로듀서 앨범', state: 'running', latestSeq: 1 }); window.__answers.orchestration_snapshot = []; })()`);
  // 도구 역할 이름은 현재 앨범의 역할 표에서 읽는다.
  await ev(`(async () => (await ${importApp('app/dock.svelte.ts')}).closeDock())()`);
  const FIRST = "README 의 TODO 네 개를 나눠서 처리해 줘. 고친 곳마다 시험도 붙이고.";
  const wN = (await calls("write_session")).length;
  const sessN = (await calls("open_local_session")).length;
  const sent = await legacyAlbum('run-pc', '프로듀서 앨범', FIRST);
  const chat = sent.chat;
  await ev(`(() => { const d = window.__details['run-pc']; d.roles.push({ id: 'a-1c374dcd', name: '구현', cli: 'claude', kind: 'write', usable: true }); d.latestSeq++; window.__emit('orchestration-changed', { runId: d.runId, seq: d.latestSeq }); })()`);
  let ps = await tabState();
  check("⑪ CLI 창 없음 — 새 세션 · PTY 쓰기 없음", [(await calls("open_local_session")).length - sessN, (await calls("write_session")).length - wN], [0, 0]);
  check("⑪ 첫 말 = 오른쪽 말풍선(받기 전)", await ev(`document.querySelector('${F} [data-item="user"]')?.textContent.includes('README')`), true);
  // 프로듀서 응답(스텁 사건 흐름)
  const E = (ev) => `window.__pcEmit(${JSON.stringify(chat)}, ${JSON.stringify(ev)})`;
  const clientId = sent?.clientId ?? null;
  await ev(`window.__pcState.busy = true`);
  await ev(E({ t: "ready", cli: "claude", version: "2.1.312", model: "opus", models: ["opus", "sonnet"], efforts: {}, conversationId: "0199aabb-0000-4000-8000-000000000001" }));
  await ev(E({ t: "turnStarted", turn: "t1" }));
  await ev(E({ t: "userAccepted", clientId }));
  await ev(E({ t: "textDelta", item: "m1", text: "저장소 proj 에서 앨범을 열고 네 트랙으로 나눴습니다. " }));
  await ev(E({ t: "toolStarted", item: "u1", name: "mcp__aynx-sessions-dev__get_run", summary: "", input: {} }));
  await ev(E({ t: "toolFinished", item: "u1", ok: true, output: "{\"runId\":\"run-pc\"}" }));
  await ev(E({ t: "toolStarted", item: "u2", name: "mcp__aynx-sessions-dev__create_task", summary: "", input: { title: "a" } }));
  await ev(E({ t: "toolFinished", item: "u2", ok: true, output: "ok" }));
  await ev(E({ t: "toolStarted", item: "u3", name: "mcp__aynx-sessions-dev__create_task", summary: "", input: { title: "b" } }));
  await ev(E({ t: "toolFinished", item: "u3", ok: true, output: "ok" }));
  // (실기 a FAIL 1) Codex code mode 의 exec — 안에서 부른 도구 이름이 알약(표시만)
  await ev(E({ t: "toolStarted", item: "u3x", name: "exec", summary: "", input: "text(await tools.mcp__aynx_sessions_dev__get_run({}));" }));
  await ev(E({ t: "toolFinished", item: "u3x", ok: true, output: "ok" }));
  await ev(E({ t: "toolStarted", item: "u4", name: "mcp__aynx-sessions-dev__spawn_worker", summary: "", input: { role: "a-1c374dcd", taskId: "task-1" } }));
  await until(`document.querySelectorAll('${F} [data-tool-pill]').length >= 4`);
  check("⑪ 응답 중 — 머리 상태 · 캐릭터 고리 · 모델", await ev(`[document.querySelector('${F} [data-producer-state]')?.dataset.producerState, !!document.querySelector('${F} .head .avatar-wrap.live'), document.querySelector('${F} [data-producer-model]')?.textContent.trim()]`), ["responding", true, "opus · high · 이 앨범 전용"]);
  check("⑪ 에이전트 머리(캐릭터 + 이름 · 응답 중)", await ev(`[document.querySelectorAll('${F} [data-item="agent-head"]').length, !!document.querySelector('${F} [data-producer-head="live"]')]`), [1, true]);
  check("⑪ 도구 알약 — 접두 뗌 · ×n · code mode exec = 안의 도구 · role = 역할 이름", await ev(`[...document.querySelectorAll('${F} [data-tool-pill]')].map(x => x.textContent.replace(/[✓!]/g, '').trim())`), ["get_run", "create_task ×2", "get_run", "spawn_worker role=구현"]);
  check("⑪ 알약 툴팁 = 화면 문구 · 도는 알약", await ev(`[document.querySelector('${F} [data-tool-pill="get_run"]')?.title, !!document.querySelector('${F} [data-tool-pill="spawn_worker role=구현"].run')]`), ["앨범 상태 읽기", true]);
  await ev(`document.querySelector('${F} [data-tool-pill="create_task"]').click()`);
  await sleep(200);
  check("⑪ 알약을 누르면 도구 줄이 펼쳐진다", await ev(`document.querySelectorAll('${F} [data-item="tool"]').length`), 2);
  await ev(`document.querySelector('${F} [data-tool-pill="create_task"]').click()`);
  await sleep(300);
  await shot("producer-chat.png");
  // 사람 시작의 답이 이미 같은 탭을 앨범으로 옮겼다.
  ps = await tabState();
  check("⑪ 사람 시작 뒤 같은 앨범·채팅 유지", [ps.orch, ps.leaves.map((l) => l.kind), ps.title], [{ view: "album", runId: "run-pc" }, ["producer", "run"], "프로듀서 앨범"]);
  await shot("producer-album.png");
  // 대기열 — 턴 중에 보낸 말은 대기열 줄로 · [취소]
  const Q1 = "시험은 vitest 로 해 줘";
  await ev(`(() => { const el = document.querySelector('${F} [data-flip-composer] textarea'); el.value = ${JSON.stringify(Q1)}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })); })()`);
  await until(`!!document.querySelector('${F} [data-producer-queue]')`);
  check("⑪ 대기열 1 — 턴이 끝나면 전달 · 글 · [취소]", await ev(`[document.querySelector('${F} [data-producer-queue]')?.dataset.producerQueue, document.querySelector('${F} [data-producer-queue-item] .qtext')?.textContent, !!document.querySelector('${F} [data-producer-queue-cancel]'), document.querySelector('${F} .queue-head')?.textContent.includes('턴이 끝나면')]`), ["1", Q1, true, true]);
  check("⑪ 대기열의 글은 꼬리 말풍선이 아니다", await ev(`[...document.querySelectorAll('${F} [data-item="user"]')].some(x => x.textContent.includes(${JSON.stringify(Q1)}))`), false);
  await sleep(200);
  await shot("producer-queue.png");
  // ⑰ (10-30 실기) 아래 줄 정렬 — 대기열 칩 · 알약 칸의 왼쪽 가장자리 · [취소] = 알약 칸 오른쪽 · [끊고 전달] 은 알약 칸 안(보내기 왼쪽 · 같은 세로 중심) · 칸 아래 줄 없음
  check(
    "⑰ 채팅 아래 — 왼쪽 가장자리 한 줄 · [취소] 오른쪽 끝 · [끊고 전달] 칸 안 · 세로 중심 · 칸 아래 줄 없음",
    await ev(`(() => {
      const w = document.querySelector('${F} [data-flip-composer] .wrap').getBoundingClientRect();
      const chip = document.querySelector('${F} .qchip').getBoundingClientRect();
      const cancel = document.querySelector('${F} [data-producer-queue-cancel]').getBoundingClientRect();
      const del = document.querySelector('${F} [data-producer-deliver]').getBoundingClientRect();
      const snd = document.querySelector('${F} [data-flip-send]').getBoundingClientRect();
      return [Math.abs(chip.left - w.left) <= 1, Math.abs(cancel.right - w.right) <= 6, del.left > w.left && del.right < snd.left && del.top >= w.top && del.bottom <= w.bottom, Math.abs((del.top + del.bottom) / 2 - (snd.top + snd.bottom) / 2) <= 1, !document.querySelector('${F} [data-flip-tools]')];
    })()`),
    [true, true, true, true, true],
  );
  check("⑰ 칠한 단추 중 직각 없음 — 채팅 대기열 · 칸", await squareButtons(), []);
  await shot("polish-chat-queue.png");
  // [끊고 전달] → interrupt{deliverQueued:true}
  await ev(`document.querySelector('${F} [data-producer-deliver]').click()`);
  await until(`window.__calls.some(([c, a]) => c === 'producer_chat_interrupt' && a.deliverQueued === true)`);
  check("⑪ [끊고 전달] → interrupt deliverQueued:true", (await calls("producer_chat_interrupt")).slice(-1).map((a) => a.deliverQueued), [true]);
  // [취소]
  await ev(`document.querySelector('${F} [data-producer-queue-cancel]').click()`);
  await until(`!document.querySelector('${F} [data-producer-queue]')`);
  check("⑪ [취소] → queue_cancel(그 clientId) · 줄 걷힘", (await calls("producer_chat_queue_cancel")).slice(-1).map((a) => a.clientId.length > 0), [true]);
  // ✕ — 머리 · 재생 막대 둘 다 interrupt{deliverQueued:false}
  const iN = (await calls("producer_chat_interrupt")).length;
  await ev(`document.querySelector('${F} [data-producer-interrupt]').click()`);
  await until(`!!document.querySelector('.orch-strip:not(.hidden) [data-orch-bar-action="interrupt"]:not([disabled])')`);
  await ev(`document.querySelector('.orch-strip:not(.hidden) [data-orch-bar-action="interrupt"]').click()`);
  await until(`window.__calls.filter(([c]) => c === 'producer_chat_interrupt').length >= ${iN + 2}`);
  check("⑪ ✕(머리 · 재생 막대) → interrupt deliverQueued:false · Esc 없음", [(await calls("producer_chat_interrupt")).slice(iN).map((a) => a.deliverQueued), (await calls("write_session")).length - wN], [[false, false], 0]);
  // 권한 카드(서버가 카드로 세운 두 종류만 온다 — 여기선 스튜디오 밖 Read)
  await ev(E({ t: "permission", requestId: "r1", kind: "tool", title: "Read — 저장소 밖", detail: "C:/other/notes.md", toolName: "Read" }));
  await until(`!!document.querySelector('${F} [data-producer-perm="r1"] [data-producer-allow]')`);
  check("⑪ 권한 카드 — 머리 상태 권한 대기", await ev(`document.querySelector('${F} [data-producer-state]')?.dataset.producerState`), "permission");
  await shot("producer-perm.png");
  await ev(`document.querySelector('${F} [data-producer-perm="r1"] [data-producer-allow]').click()`);
  await until(`window.__calls.some(([c]) => c === 'producer_chat_decide')`);
  check("⑪ [허용] → decide(그 요청 · allow · 세대)", (await calls("producer_chat_decide")).slice(-1).map((a) => [a.requestId, a.decision, a.epoch]), [["r1", "allow", 3]]);
  await ev(E({ t: "permissionResolved", requestId: "r1", decision: "allow", by: "human" }));
  // 정책 거절(카드 없이) — 알림 줄
  await ev(E({ t: "notice", code: "denied-by-policy", detail: "fileChange" }));
  await until(`!!document.querySelector('${F} [data-producer-denied-line]')`);
  check("⑪ 정책 거절 — 머리 아래 한 줄 · 꼬리 알림", await ev(`[document.querySelector('${F} [data-producer-denied-line]')?.textContent.includes('작업자에게 맡기세요'), !!document.querySelector('${F} [data-producer-denied="fileChange"]')]`), [true, true]);
  await shot("producer-denied.png");
  // 턴 끝 → 쉼 · 작업자 기다리는 중(앨범 running — 목록 요약)
  await ev(`window.__pcState.busy = false`);
  await ev(E({ t: "toolFinished", item: "u4", ok: true, output: "ok" }));
  await ev(E({ t: "turnEnded", turn: "t1", outcome: "ok", message: null }));
  await ev(`(async () => (await ${importApp("app/orch-pulse.svelte.ts")}).setRunSummaries([{ runId: 'run-pc', name: '프로듀서 앨범', state: 'running', blocked: 1, taskStates: {}, taskCount: 4, running: { write: 1, judge: 0 } }].map(window.__sumFull)))()`);
  await until(`document.querySelector('${F} [data-producer-state]')?.dataset.producerState === 'waiting'`);
  check("⑪ 턴 끝 — 작업자 기다리는 중 · 사람 필요 카드(막힌 아티스트)", await ev(`[document.querySelector('${F} [data-producer-state]')?.dataset.producerState, !!document.querySelector('${F} [data-producer-human]')]`), ["waiting", true]);
  await sleep(300);
  await shot("producer-waiting.png");
  // 프로세스 끝 — exited{why, restartable} · [다시 띄우기] = resume 으로 연다(띄우지 않는다)
  await ev(E({ t: "exited", code: 1, reason: "exit", why: "crashed", restartable: true }));
  await until(`!!document.querySelector('${F} [data-producer-exited]')`);
  check("⑪ exited — 끝난 이유 · [다시 띄우기]", await ev(`[document.querySelector('${F} [data-producer-exited]')?.dataset.producerExited, document.querySelector('${F} [data-producer-state]')?.dataset.producerState, !!document.querySelector('${F} [data-producer-exited] [data-producer-restart]')]`), ["crashed", "ended", true]);
  await shot("producer-exited.png");
  const oN = (await calls("producer_chat_open")).length;
  await ev(`document.querySelector('${F} [data-producer-exited] [data-producer-restart]').click()`);
  await until(`window.__calls.filter(([c]) => c === 'producer_chat_open').length > ${oN}`);
  check("⑪ [다시 띄우기] → open resume(그 대화)", (await calls("producer_chat_open")).slice(oN).map((a) => [a.chat === chat, a.mode.kind, a.mode.conv]), [[true, "resume", "0199aabb-0000-4000-8000-000000000001"]]);
  // 잎의 주소에 대화 id 가 적혔다(저장 · 서버 표를 잃었을 때 resume)
  check("⑪ 잎 주소 — opened · conv", await ev(`(async () => { const m = await ${tabsMod}; const t = m.activeTab(); const walk = (n) => n.type === 'leaf' ? [n.pane] : [...walk(n.a), ...walk(n.b)]; const p = walk(t.root).find((x) => x.kind === 'producer'); return JSON.stringify([p.producer.opened, p.producer.conv]); })()`), JSON.stringify([true, "0199aabb-0000-4000-8000-000000000001"]));
  // 좁은 폭 — 가로 넘침 없음
  await send("Emulation.setDeviceMetricsOverride", { width: 760, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  check("⑪ 좁은 폭 — 프로듀서 면 가로 넘침 없음", await ev(`(() => { const f = document.querySelector('${F}'); return !!f && f.scrollWidth <= f.clientWidth + 1; })()`), true);
  await shot("producer-narrow.png");
  // (실기 a 4) 620px — 채팅 머리 두 줄(제목 · 상태 칩) · 가로 넘침 없음
  await send("Emulation.setDeviceMetricsOverride", { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(600);
  check(
    "⑪ 620px — 채팅: 가로 넘침 없음 · 제목 한 줄 · 상태 칩이 제목 아래",
    await ev(`(() => { const f = document.querySelector('${F}'); const ti = f.querySelector('.head .title'); const s = f.querySelector('[data-producer-state]'); const lh = parseFloat(getComputedStyle(ti).lineHeight) || 20; return [f.scrollWidth <= f.clientWidth + 1, ti.getBoundingClientRect().height < lh * 1.6, s.getBoundingClientRect().top >= ti.getBoundingClientRect().bottom - 2]; })()`),
    [true, true, true],
  );
  await shot("producer-narrow-620.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);

  // (실기 a FAIL 2) 세션 서버 재시작 — 귀속 앨범이 orphaned 이고 되찾을 수 없으면 처음부터 기록만(입력 칸 없음 · [다시 띄우기] 없음 · "말하면 다시 띄웁니다" 없음)
  await ev(`(() => { const st = window.__pcState; delete st.chats[${JSON.stringify(chat)}]; st.gone = { [${JSON.stringify(chat)}]: { gone: 'server-restarted', album: { runId: 'run-pc', state: 'orphaned', adoptable: { restore: false, autoResume: false, why: 'orphaned' } } } }; window.__emit('session-server-connected', { replaced: false }); })()`);
  await until(`!!document.querySelector('${F} [data-producer-readonly]')`);
  await sleep(300);
  check(
    "⑪ orphaned 앨범의 채팅 — 첫 화면부터 기록만 · 입력 칸 없음 · [다시 띄우기] · 끝 띠 없음",
    await ev(`[document.querySelector('${F} [data-producer-state]')?.dataset.producerState, !!document.querySelector('${F} [data-flip-composer]'), !!document.querySelector('${F} [data-producer-readonly-foot]'), !!document.querySelector('${F} [data-producer-gone]'), !!document.querySelector('${F} [data-producer-restart]'), document.querySelector('${F}').innerText.includes('다시 띄웁니다')]`),
    ["readOnly", false, true, false, false, false],
  );
  await shot("producer-orphan.png");
  await ev(`(() => { delete window.__pcState.gone; })()`);

  // 좁은 라이브러리도 아티스트 열과 목록이 한 열로 흐른다.
  await ev(`(async () => (await ${orchMod}).openOrchHome())()`);
  await until(`!!document.querySelector('${H} [data-orch-library]')`);
  await send("Emulation.setDeviceMetricsOverride", { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(700);
  check("⑪ 620px 라이브러리 — 가로 넘침 없음 · 아티스트 열", await ev(`(() => { const el = document.querySelector('${H} [data-orch-home]'); return [el.scrollWidth <= el.clientWidth + 1, !!el.querySelector('[data-library-artists]')]; })()`), [true, true]);
  await shot("home-narrow-620.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
}

// ⑫ (2단계 단계 4) 앱이 깨움 — 꼬리의 "앱이 깨움" 점선 알약(사건 `woken` · 턴 시작 뒤 · id → 트랙 번호) · 기록의 깨움(앨범 `wakes` 의 SHA 와 한 번씩
// 맞는 것만 알약 · 사람이 같은 문장을 친 것은 말풍선 + "앱 기록 없음") · 기록의 턴 끝 경계 · 깨움 꺼짐 띠(사람 말 사이 n/30) · 사람 필요 카드(상세
// `needsHuman`) · 대화 중 모델 · 강도 칩(→ set_model · set_effort) · 입력 칸 자리표시 글. 1단계 터미널 탭에는 깨움이 없다(PTY 쓰기 없음).
if (ONLY === "" || ONLY === "producer" || ONLY === "wake") {
  const H = ".pane-box:not(.hidden)";
  const F = `${H} [data-producer-face]`;
  const WT = (id, title, state, cur) => ({ id, title, goal: title, dependsOn: [], version: 1, state, currentAttempt: cur, createdAt: NOW - 30 * 60_000, updatedAt: NOW });
  const WA = (id, taskId, state, extra = {}) => ({ id, taskId, cli: "claude", gen: 1, state, kind: "write", roleName: "impl", role: "worker", startedAt: NOW - 10 * 60_000, worktree: null, branch: null, conversationId: null, turns: [], ...extra });
  const WAKE_TEXT = "[AYNX app notice — not from the person] Album run-wk (gen 1) changed after seq 4: task t1 reported success; task t2 integrated. Read get_run (or wait_run with afterSeq=4) for details, then keep coordinating. If nothing needs you now, end your turn with a one-line note.";
  await ev(`(async () => (await ${importApp('app/dock.svelte.ts')}).closeDock())()`);
  const { chat } = await legacyAlbum('run-wk', '깨움 앨범', '로그 회전을 나눠서 해 줘');
  const E = (e) => `window.__pcEmit(${JSON.stringify(chat)}, ${JSON.stringify(e)})`;
  check("⑫ 입력 칸 자리표시 글 — 프로듀서에게 말하기…", await ev(`document.querySelector('${F} [data-flip-composer] textarea')?.placeholder`), "프로듀서에게 말하기…");
  // 앨범 — 트랙 둘 · 막힌 아티스트(트랙 #2) · 깨움 예약 기록 하나(SHA 's-real' — 기록의 첫 깨움 문장과 맞는다)
  const DET = {
    ...DETAIL, runId: "run-wk", name: "깨움 앨범", state: "running", latestSeq: 20,
    tasks: [WT("t1", "설정 TODO", "accepted", "a1"), WT("t2", "로그 회전", "active", "a2")],
    attempts: [WA("a1", "t1", "reported"), WA("a2", "t2", "idle", { blocked: { need: "네트워크 접근 필요", at: NOW - 60_000 } })],
    wakes: [{ wakeId: "wake-1", chat, sha: "s-real", fromSeq: 4, toSeq: 9, at: NOW - 120_000, items: [{ what: "reported-success", taskId: "t1", attemptId: "a1" }, { what: "integrated", taskId: "t2" }] }],
  };
  await ev(`(() => { window.__details['run-wk'] = ${JSON.stringify(DET)}; window.__emit('orchestration-changed', { runId: 'run-wk', seq: ${DET.latestSeq} }); })()`);
  // 기록 — 사람 첫 말 · 답 · **앱이 깨움**(기록 맞음) · 답 · 사람이 같은 문장을 그대로 친 것(기록 없음 — 이미 앞의 깨움이 가져갔다) · 답
  const U = (text, at, sha = null) => ({ role: "user", text, truncated: false, images: 0, tool: null, at, ...(sha ? { wake: { runId: "run-wk", gen: 1, fromSeq: 4, sha } } : {}) });
  const A = (text, at) => ({ role: "assistant", text, truncated: false, images: 0, tool: null, at });
  await ev(`(() => { window.__answers.agent_conversation_transcript = { items: ${JSON.stringify([
    U("로그 회전을 나눠서 해 줘", NOW - 300_000),
    A("앨범을 열고 트랙 둘로 나눴습니다. 작업자를 띄웠습니다.", NOW - 290_000),
    U(WAKE_TEXT, NOW - 119_000, "s-real"),
    A("#1 보고를 읽고 수락했습니다. #2 는 통합됐습니다.", NOW - 110_000),
    U(WAKE_TEXT, NOW - 60_000, "s-real"),
    A("그 문장은 앱 기록이 없어 사람 말로 읽었습니다.", NOW - 55_000),
  ])}, cursor: null }; })()`);
  // 첫 턴 — 대화 id 가 서면 기록을 읽는다
  await ev(`window.__pcState.busy = true`);
  await ev(E({ t: "ready", cli: "claude", version: "2.1.312", model: "opus", models: ["opus", "sonnet"], efforts: {}, conversationId: "0199aabb-0000-4000-8000-0000000000wk" }));
  await ev(E({ t: "turnStarted", turn: "t1" }));
  await ev(E({ t: "text", item: "m1", text: "앨범을 열고 트랙 둘로 나눴습니다." }));
  await ev(`window.__pcState.busy = false`);
  await ev(E({ t: "turnEnded", turn: "t1", outcome: "ok", message: null }));
  await until(`(async () => { const m = await ${tabsMod}; return m.activeTab()?.orch?.runId === 'run-wk'; })()`);
  await ev(`(async () => (await ${importApp("app/orch-pulse.svelte.ts")}).setRunSummaries([{ runId: 'run-wk', name: '깨움 앨범', state: 'running', blocked: 1, taskStates: {}, taskCount: 2, wake: { off: null, segment: 3, cap: 30, total: 3, max: 200, live: null } }].map(window.__sumFull)))()`);
  await until(`document.querySelectorAll('${F} [data-item="wake"]').length === 1`, 8000);
  check(
    "⑫ 기록 — 앨범 기록과 맞는 깨움 하나만 알약(#1 보고 · #2 통합 · seq 4 뒤) · 같은 문장을 사람이 친 것은 말풍선 + 앱 기록 없음",
    await ev(`[document.querySelectorAll('${F} [data-item="wake"]').length, document.querySelector('${F} [data-item="wake"]')?.textContent.trim(), document.querySelectorAll('${F} [data-wake-unrecorded]').length, [...document.querySelectorAll('${F} [data-item="user"]')].filter((x) => x.textContent.includes('AYNX app notice')).length]`),
    [1, "앱이 깨움 · #1 보고 · #2 통합 (seq 4 뒤)", 1, 1],
  );
  check("⑫ 기록의 턴 끝 경계 — 에이전트 줄 뒤 사람 말(알약 포함) 앞마다 · 시각", await ev(`[document.querySelectorAll('${F} [data-item="turn-break"]').length, /턴 끝 · 프로듀서 쉼 \\(\\d\\d:\\d\\d\\)/.test(document.querySelector('${F} [data-item="turn-break"]')?.textContent ?? '')]`), [2, true]);
  check("⑫ 사람 필요 카드 — 상세 재료(needsHuman · 트랙 번호)", await ev(`document.querySelector('${F} [data-producer-human] .human-text')?.textContent.trim()`), "#2 아티스트가 막혔습니다 — 앨범 권한에서 허용하면 같은 아티스트에게 이어서 시킵니다");
  await sleep(300);
  await shot("wake-history.png");
  // 지금 턴 — 앱이 깨움(턴 시작 뒤 사건 `woken`) → 꼬리 가운데 점선 알약 · id → 트랙 번호 · PTY 쓰기 없음
  const wN = (await calls("write_session")).length;
  await ev(`window.__pcState.busy = true`);
  await ev(E({ t: "turnStarted", turn: "t2" }));
  await ev(E({ t: "woken", wake: { wakeId: "wake-2", runId: "run-wk", gen: 1, fromSeq: 12, toSeq: 15, items: [{ what: "blocked", taskId: null, attemptId: "a2" }, { what: "person-resumed", taskId: null, attemptId: null }], more: 0, resync: false } }));
  await ev(E({ t: "textDelta", item: "m2", text: "#2 아티스트가 막혔습니다 — 사람에게 알립니다." }));
  await until(`!!document.querySelector('${F} [data-producer-wake="wake-2"]')`);
  check(
    "⑫ 꼬리 — 앱이 깨움 알약(#2 막힘 · 사람이 재개 · seq 12 뒤) · 응답 중 · PTY 쓰기 없음",
    [...(await ev(`[document.querySelector('${F} [data-producer-wake="wake-2"]')?.textContent.trim(), document.querySelector('${F} [data-producer-state]')?.dataset.producerState]`)), (await calls("write_session")).length - wN],
    ["앱이 깨움 · #2 막힘 · 사람이 재개 (seq 12 뒤)", "responding", 0],
  );
  await sleep(300);
  await shot("wake-live.png");
  await ev(`window.__pcState.busy = false`);
  await ev(E({ t: "turnEnded", turn: "t2", outcome: "ok", message: null }));
  // 깨움 꺼짐 띠 — 사람 말 사이 상한에 닿음(30/30)
  await ev(`(async () => (await ${importApp("app/orch-pulse.svelte.ts")}).setRunSummaries([{ runId: 'run-wk', name: '깨움 앨범', state: 'running', blocked: 1, taskStates: {}, taskCount: 2, wake: { off: 'segment-max', segment: 30, cap: 30, total: 41, max: 200, live: null } }].map(window.__sumFull)))()`);
  await until(`!!document.querySelector('${F} [data-producer-wake-off]')`);
  check("⑫ 깨움 꺼짐 띠 — 사람 말 사이 깨움 30/30 — 다음 말을 기다립니다", await ev(`[document.querySelector('${F} [data-producer-wake-off]')?.dataset.producerWakeOff, document.querySelector('${F} [data-producer-wake-off]')?.textContent.trim()]`), ["segment-max", "사람 말 사이 깨움 30/30 — 다음 말을 기다립니다"]);
  await sleep(300);
  await shot("wake-off.png");
  // 대화 중 모델 · 강도 칩 → 칩 줄 → 고르면 set_model · set_effort(다음 턴부터)
  await ev(`document.querySelector('${F} [data-producer-tune="model"]').click()`);
  await until(`!!document.querySelector('${F} [data-producer-tune-row="model"]')`);
  await sleep(200);
  await shot("wake-model-chip.png");
  await ev(`document.querySelector('${F} [data-producer-tune-model="sonnet"]').click()`);
  await until(`window.__calls.some(([c]) => c === 'producer_chat_set_model')`);
  await ev(`document.querySelector('${F} [data-producer-tune="effort"]').click()`);
  await until(`!!document.querySelector('${F} [data-producer-tune-effort="low"]')`);
  await ev(`document.querySelector('${F} [data-producer-tune-effort="low"]').click()`);
  await until(`window.__calls.some(([c]) => c === 'producer_chat_set_effort')`);
  check(
    "⑫ 모델 · 강도 칩 → set_model(sonnet) · set_effort(low) · 머리 글자 · 잎 주소",
    [
      (await calls("producer_chat_set_model")).map((a) => [a.chat === chat, a.model]),
      (await calls("producer_chat_set_effort")).map((a) => [a.chat === chat, a.effort]),
      await ev(`document.querySelector('${F} [data-producer-model]')?.textContent.replace(/\\s+/g, ' ').trim()`),
      await ev(`(async () => { const m = await ${tabsMod}; const t = m.activeTab(); const walk = (n) => n.type === 'leaf' ? [n.pane] : [...walk(n.a), ...walk(n.b)]; const p = walk(t.root).find((x) => x.kind === 'producer'); return [p.producer.model, p.producer.effort].join('/'); })()`),
    ],
    [[[true, "sonnet"]], [[true, "low"]], "sonnet · low · 이 앨범 전용", "sonnet/low"],
  );
  await ev(`(async () => (await ${importApp("app/orch-pulse.svelte.ts")}).setRunSummaries([].map(window.__sumFull)))()`);
}

// ⑬ (2단계 단계 4 실기 b 고침) — B: 목록 요약이 바뀌면(맡기기 O6 = 0 — 서버가 seq 그대로의 변화 이벤트) F5 없이 곧바로 "앱 깨움이 꺼져" 띠 ·
// C: 재시도 깨움 알약 "다시 알림" · G: 도는 아티스트 · 통합이 없으면 "쉼 — 말하면 이어 갑니다" · H: 도는 깨움 턴의 깨움은 기록과 꼬리 중 하나만 ·
// D: 620px 앨범 머리 · 재생 막대 · 입력 칸 · E: 끝난 앨범 채팅의 끝 띠 "기록만"(다시 띄우기 없음). A(알림 센터 · F5 뒤)는 맨 끝(⑭ — 페이지를 다시 읽는다).
if (ONLY === "" || ONLY === "fixb") {
  const H = ".pane-box:not(.hidden)";
  const F = `${H} [data-producer-face]`;
  const WT = (id, title, state, cur) => ({ id, title, goal: title, dependsOn: [], version: 1, state, currentAttempt: cur, createdAt: NOW - 30 * 60_000, updatedAt: NOW });
  const WA = (id, taskId, state) => ({ id, taskId, cli: "claude", gen: 1, state, kind: "write", roleName: "impl", role: "worker", startedAt: NOW - 10 * 60_000, worktree: null, branch: null, conversationId: null, turns: [] });
  const LIVE_TEXT = "[AYNX app notice — not from the person] Album run-fx (gen 1) changed after seq 6: task t1 integrated. Read get_run (or wait_run with afterSeq=6) for details, then keep coordinating. If nothing needs you now, end your turn with a one-line note.";
  await ev(`(async () => (await ${importApp("app/dock.svelte.ts")}).closeDock())()`);
  const { chat } = await legacyAlbum('run-fx', '실기용 앨범', 'e1 · e2 를 나눠서 해 줘');
  const E = (e) => `window.__pcEmit(${JSON.stringify(chat)}, ${JSON.stringify(e)})`;
  // 앨범 — 트랙 둘(수락) · 통합 ref(→ [브랜치로 내보내기]) · 세대 2(지금 세대가 묶임) · 깨움 기록 둘(첫 깨움 · 같은 범위 재시도 — 도는 턴의 것)
  const DET = {
    ...DETAIL, runId: "run-fx", name: "실기용 앨범 다섯 번째 — 긴 이름은 좁은 폭에서 줄임표로", state: "running", latestSeq: 12, gen: 2, coordinatorAttached: true,
    tasks: [WT("t1", "e1.txt 추가", "accepted", "a1"), WT("t2", "e2.txt 추가", "accepted", "a2")],
    attempts: [WA("a1", "t1", "reported"), WA("a2", "t2", "reported")],
    integration: { workRef: "refs/aynx/orch/fx/int", exportBranch: "orch-fx-int", baseCommit: "1234567890", baseBranch: "main", expectedHead: "4dab32d0000000000000000000000000000000aa", exportedHead: null },
    wakes: [
      { wakeId: "wake-a", chat, sha: "s-a", fromSeq: 6, toSeq: 9, at: NOW - 120_000, items: [{ what: "integrated", taskId: "t1" }] },
      { wakeId: "wake-b", chat, sha: "s-live", fromSeq: 6, toSeq: 9, at: NOW - 30_000, retry: true, items: [{ what: "integrated", taskId: "t1" }] },
    ],
  };
  await ev(`(() => { window.__details['run-fx'] = ${JSON.stringify(DET)}; window.__emit('orchestration-changed', { runId: 'run-fx', seq: ${DET.latestSeq} }); })()`);
  const U = (text, at, sha = null) => ({ role: "user", text, truncated: false, images: 0, tool: null, at, ...(sha ? { wake: { runId: "run-fx", gen: 1, fromSeq: 6, sha } } : {}) });
  const A = (text, at) => ({ role: "assistant", text, truncated: false, images: 0, tool: null, at });
  // 기록 — 첫 깨움(s-a) · 답 · **지금 도는 재시도 깨움**(s-live — CLI 가 이미 기록에 쓴 사람 말 · F5 직후 기록이 이것까지 읽는다)
  const HIST = [
    U("e1 · e2 를 나눠서 해 줘", NOW - 300_000),
    A("앨범을 열고 트랙 둘로 나눴습니다.", NOW - 290_000),
    U(LIVE_TEXT, NOW - 119_000, "s-a"),
    A("턴을 끝냅니다.", NOW - 110_000),
    U(LIVE_TEXT, NOW - 29_000, "s-live"),
  ];
  await ev(`(() => { window.__answers.agent_conversation_transcript = { items: ${JSON.stringify(HIST)}, cursor: null }; })()`);
  await ev(`window.__pcState.busy = true`);
  await ev(E({ t: "ready", cli: "claude", version: "2.1.312", model: "opus", models: ["opus"], efforts: {}, conversationId: "0199aabb-0000-4000-8000-0000000000fx" }));
  await ev(E({ t: "turnStarted", turn: "t1" }));
  await ev(`window.__pcState.busy = false`);
  await ev(E({ t: "turnEnded", turn: "t1", outcome: "ok", message: null }));
  await until(`(async () => { const m = await ${tabsMod}; return m.activeTab()?.orch?.runId === 'run-fx'; })()`);
  const SUM = (extra) => JSON.stringify([{ runId: "run-fx", name: DET.name, state: "running", gen: 2, latestSeq: 12, taskStates: { accepted: 2 }, taskCount: 2, running: { write: 1, judge: 0 }, coordinatorAttached: true, wake: { off: null, segment: 2, cap: 30, total: 2, max: 200, live: null }, ...extra }]);
  // 목록 요약은 orch-coordinators 가 변화 이벤트에 다시 읽는다(스텁의 `orchestration_snapshot` 을 바꾸고 이벤트만 낸다 — seq 그대로)
  const summarize = (extra) => ev(`(() => { window.__answers.orchestration_snapshot = ${SUM(extra)}; window.__emit('orchestration-changed', { runId: 'run-fx', seq: 12 }); })()`);
  await summarize({});
  // H · C — 지금 도는 재시도 깨움(꼬리 — F5 직후 스냅숏의 `wake` 와 같은 꼴) → 기록의 같은 깨움 말은 그리지 않는다 · 꼬리 알약 하나 · "다시 알림"
  await ev(`window.__pcState.busy = true`);
  await ev(E({ t: "turnStarted", turn: "t2" }));
  await ev(E({ t: "woken", wake: { wakeId: "wake-b", runId: "run-fx", gen: 1, fromSeq: 6, toSeq: 9, items: [{ what: "integrated", taskId: "t1", attemptId: null }], more: 0, resync: false, retry: true } }));
  await until(`!!document.querySelector('${F} [data-producer-wake="wake-b"]')`);
  await until(`document.querySelectorAll('${F} [data-item="wake"]').length >= 1`, 8000);
  await sleep(500);
  const pills = async () => JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('${F} [data-item="wake"], ${F} [data-producer-wake]')].map((x) => x.textContent.trim().replace(/\\s+/g, ' ')))`));
  check(
    "⑬ H · C — 도는 깨움 턴: 기록의 첫 깨움 알약 + 꼬리의 재시도 알약 하나(같은 글 둘 없음) · 재시도 = 다시 알림",
    await pills(),
    ["앱이 깨움 · #1 통합 (seq 6 뒤)", "앱이 깨움 · 다시 알림 · #1 통합 (seq 6 뒤)"],
  );
  await shot("fixb-wake-dup.png");
  // 턴이 끝나도 같은 깨움은 하나(꼬리가 걷히면 기록 쪽이 그린다)
  await ev(`window.__pcState.busy = false`);
  await ev(E({ t: "turnEnded", turn: "t2", outcome: "interrupted", message: null }));
  await sleep(1500);
  const after = await pills();
  check("⑬ H — 턴 끝 뒤에도 같은 깨움은 하나씩(재시도 표지 하나)", [after.length, new Set(after).size, after.filter((x) => x.includes("다시 알림")).length], [2, 2, 1]);
  // G — 도는 아티스트 · 판정 · 통합이 없는 도는 앨범 → "쉼 — 말하면 이어 갑니다"(작업자 기다리는 중 아님)
  await summarize({ running: { write: 0, judge: 0 } });
  await until(`document.querySelector('${F} [data-producer-state]')?.dataset.producerState === 'rest'`, 4000);
  check("⑬ G — 깨움 턴을 끊은 뒤 도는 것이 없으면 머리 칩 = 쉼 — 말하면 이어 갑니다", await ev(`[document.querySelector('${F} [data-producer-state]')?.dataset.producerState, document.querySelector('${F} [data-producer-state]')?.textContent.trim()]`), ["rest", "쉼 — 말하면 이어 갑니다"]);
  // B — 맡기기 O6 = 0 저장 → 서버가 seq 그대로 변화 이벤트(시험 `wake_cap_change_refreshes_summary`) → 목록 다시 읽기 → 곧바로 띠(F5 없이)
  check("⑬ B — 바뀌기 전 띠 없음", await ev(`!!document.querySelector('${F} [data-producer-wake-off]')`), false);
  const t0 = Date.now();
  await summarize({ running: { write: 0, judge: 0 }, wake: { off: "off", segment: 2, cap: 0, total: 2, max: 200, live: null } });
  await until(`!!document.querySelector('${F} [data-producer-wake-off="off"]')`, 3000);
  check("⑬ B — O6 = 0: seq 그대로의 변화 이벤트 하나로 띠 섬(F5 없이 · 1.5초 안)", [await ev(`document.querySelector('${F} [data-producer-wake-off]')?.dataset.producerWakeOff`), Date.now() - t0 < 1500], ["off", true]);
  check("⑬ B — 지금 세대가 묶였으면 옛 프로듀서 표지 없음(세대 2)", await ev(`[!!document.querySelector('${H} [data-run-old-coordinator]'), !!document.querySelector('${H} [data-album-head]')]`), [false, true]);
  await shot("fixb-o6-off.png");
  // D — 620px: 앨범 머리(제목 한 줄 · 상태 줄을 단추가 덮지 않음 · 메타가 한 낱말씩 감기지 않음) · 재생 막대(오른쪽 칸이 ✕ 를 덮지 않음)
  await send("Emulation.setDeviceMetricsOverride", { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(900);
  const geo = JSON.parse(await ev(`(() => {
    const r = (el) => el ? el.getBoundingClientRect() : null;
    const hit = (a, b) => !!a && !!b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
    const head = document.querySelector('${H} [data-album-head]');
    const name = head?.querySelector('.name'); const kicker = head?.querySelector('.kicker'); const actions = head?.querySelector('.actions');
    const meta = [...(head?.querySelectorAll('.meta > span:not(.dot)') ?? [])];
    const lh = name ? parseFloat(getComputedStyle(name).lineHeight) || 24 : 0;
    const bar = document.querySelector('.orch-strip:not(.hidden) [data-orch-bar]');
    const x = bar?.querySelector('[data-orch-bar-action="interrupt"]'); const right = bar?.querySelector('.right');
    const kids = right ? [...right.children].filter((c) => getComputedStyle(c).display !== 'none') : [];
    return JSON.stringify({
      nameOneLine: !!name && r(name).height < lh * 1.6,
      kickerFree: !hit(r(kicker), r(actions)),
      metaOneLine: meta.length > 0 && meta.every((m) => r(m).height < 26),
      barClear: !!x && kids.every((k) => !hit(r(k), r(x))),
      noOverflow: !!head && head.parentElement.scrollWidth <= head.parentElement.clientWidth + 1,
    });
  })()`));
  check("⑬ D — 620px: 제목 한 줄 · 상태 줄을 단추가 덮지 않음 · 메타 항목 한 줄씩 · 막대 오른쪽 칸이 ✕ 를 덮지 않음 · 판 가로 넘침 없음", [geo.nameOneLine, geo.kickerFree, geo.metaOneLine, geo.barClear, geo.noOverflow], [true, true, true, true, true]);
  await shot("fixb-620.png");
  await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(500);
  // E — 끝난 앨범(서버 판정 why ended)의 채팅에서 프로듀서가 끝남 → 끝 띠 "앨범이 끝났습니다 — 기록만" · [다시 띄우기] · adopt_run 안내 없음
  await ev(`(() => { window.__details['run-fx'] = Object.assign(window.__details['run-fx'], { state: 'done' }); })()`);
  await summarize({ state: "done", running: { write: 0, judge: 0 }, adoptable: { restore: false, autoResume: false, why: "ended" } });
  await sleep(900);
  await ev(E({ t: "exited", code: 0, reason: "exit", why: "album-ended", restartable: false }));
  await until(`!!document.querySelector('${F} [data-producer-exited]')`);
  check(
    "⑬ E — 끝난 앨범의 끝 띠 = 기록만 · adopt_run 안내 없음 · [다시 띄우기] 없음",
    await ev(`(() => { const c = document.querySelector('${F} [data-producer-exited]'); return [!!c.querySelector('[data-producer-album-ended]'), /adopt_run/.test(c.textContent), !!c.querySelector('[data-producer-restart]')]; })()`),
    [true, false, false],
  );
  await shot("fixb-ended.png");
  await ev(`(async () => (await ${importApp("app/orch-pulse.svelte.ts")}).setRunSummaries([].map(window.__sumFull)))()`);
  await ev(`window.__answers.orchestration_snapshot = []`);
}

if (ONLY === "" || ONLY === "fixb") {
  const notifMod = importApp("app/notifications.svelte.ts");
  const N = (seq, kind, extra = {}) => ({ id: `run-fx#${seq}:${kind}:-`, runId: "run-fx", runName: "실기용 앨범", kind, at: Date.now() - 60_000 + seq, ...extra });
  const SENT = [
    N(20, "wake-limit", { detail: "segment-max" }),
    N(21, "worker-blocked", { attemptId: "a1", taskTitle: "e1.txt 추가" }),
    N(22, "wake-ignored"),
    N(23, "run-ended", { detail: "done" }),
  ];
  const rows = async () => JSON.parse(await ev(`(async () => JSON.stringify((await ${notifMod}).notificationList().filter((e) => e.kind === 'orchestration').map((e) => [e.text, e.read])))()`));
  await ev(`(() => { window.__sentNotices = Object.fromEntries(${JSON.stringify(SENT)}.map((n) => [n.id, n])); sessionStorage.removeItem('h.recent'); })()`);
  for (const n of SENT) await ev(`window.__emit('orchestration-notice', ${JSON.stringify(n)})`);
  await sleep(800);
  const before = (await rows()).map(([text]) => text);
  check(
    "⑭ A — 사건 넷이 알림 센터에 · 깨움 문구(사람 말 사이 상한 · 반응하지 않음) · '사람이 볼 일' 없음 · 확인됨",
    [before.length, before.some((x) => x.includes("사람이 볼 일")), before.some((x) => x.includes("사람 말 사이 깨움 상한")), before.some((x) => x.includes("반응하지 않았습니다")), JSON.parse(await ev(`sessionStorage.getItem('h.recent') ?? '[]'`)).length],
    [4, false, true, true, 4],
  );
  await reloadBoot(send, ev);
  await sleep(1500);
  const restored = await rows();
  check("⑭ A — F5 뒤 주 창 알림 센터에 같은 넷(읽음 · 시각 순)", [restored.length, restored.every(([, read]) => read), restored.map(([text]) => text).sort().join("|") === [...before].sort().join("|")], [4, true, true]);
  check("⑭ A — F5 뒤 되살린 줄은 토스트를 띄우지 않는다", await ev(`[...document.querySelectorAll('.toast')].filter((x) => x.textContent.includes('실기용 앨범')).length`), 0);
  // F5 뒤 새 사건 — 토스트 + 한 줄(듣기는 새 페이지가 다시 건다)
  await ev(`window.__emit('orchestration-notice', ${JSON.stringify(N(24, "wake-failed"))})`);
  await sleep(600);
  const now = await rows();
  check(
    "⑭ A — F5 뒤 새 사건(wake-failed) = 알림 센터 맨 위 · 토스트",
    [now.length, now[0][0].includes("깨우지 못했습니다"), now[0][1], await ev(`[...document.querySelectorAll('.toast')].some((x) => x.textContent.includes('깨우지 못했습니다'))`)],
    [5, true, false, true],
  );
  await ev(`(async () => (await ${importApp("app/dock.svelte.ts")}).openDock('alerts'))()`);
  await sleep(700);
  await shot("fixb-notify-f5.png");
}
// ⑮ (2단계 단계 5) 원격 거울 · 폰 — 집 PC 창의 오케스트레이션 탭(연 프로듀서 채팅 잎)이 원격 창 거울에 보이면 원격 창이 **제 구독 통로**로 같은 채팅을
// 그린다(subscribe 를 원격 페이지가 따로 부른다) · 원격에서 보내기(ALLOW — clientId) · 사건은 그 통로로 와 꼬리에 선다 · 원격 창은 집 PC 채팅을 닫지 않는다
// (잎이 거울에서 빠지면 구독만 푼다) · 폰 폭(390)에서 잎이 무너지지 않는다. 원격 초안 시작은 v3-new-remote-reauth가 검사한다.
if (ONLY === "" || ONLY === "remote") {
  const H = ".pane-box:not(.hidden)";
  await ev(`(async () => (await ${importApp('app/dock.svelte.ts')}).closeDock())()`).catch(() => null);
  // 집 PC 쪽도 새 흐름으로 연 실제 앨범 경로를 거울에 싣는다(new 경로에는 채팅 잎이 없다).
  await legacyAlbum('run-remote', '원격 앨범', '원격에서도 이어서 처리해 줘');
  const made = JSON.parse(await ev(`(async () => {
    const m = await ${tabsMod}; const snapMod = await ${importApp("mirror/snapshot.ts")};
    const t = m.activeTab(); const leaf = t.root.a.pane;
    const chat = leaf.producer.chatId;
    const ws = m.activeTab().workspaceId ?? 'w1';
    const snap = snapMod.buildSnapshot({ source: 'home', workspace: { id: ws, name: 'W' }, tabs: [{ ...m.activeTab(), workspaceId: ws }], activeTabId: t.id, focusOf: () => null });
    sessionStorage.setItem('h.mirror', JSON.stringify(snap));
    sessionStorage.setItem('h.pcchats', JSON.stringify(window.__pcState.chats));
    sessionStorage.setItem('aynx-h-remote', '1');
    return JSON.stringify({ chat, tab: t.id });
  })()`));
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 820, deviceScaleFactor: 1, mobile: false });
  try {
    await reloadBoot(send, ev);
    const RF = `${H} [data-producer-leaf="${made.chat}"]`;
    await until(`!!document.querySelector('${RF}[data-phase="chat"] [data-producer-face]')`, 10000);
    check("⑮ 원격 창 — 거울의 오케스트레이션 탭에 프로듀서 채팅 잎", await ev(`[window.__AYNX_REMOTE__ === true, !!document.querySelector('${RF}[data-phase="chat"] [data-producer-face]')]`), [true, true]);
    await until(`window.__calls.some(([c, a]) => c === 'producer_chat_subscribe' && a.chat === ${JSON.stringify(made.chat)})`);
    check("⑮ 원격 창이 제 구독 통로를 건다(이 페이지의 Channel)", await ev(`(() => { const a = window.__calls.find(([c, x]) => c === 'producer_chat_subscribe' && x.chat === ${JSON.stringify(made.chat)}); return [!!a, typeof a?.[1]?.channel?.id === 'number' || typeof a?.[1]?.channel === 'object']; })()`), [true, true]);
    const E = (e) => `window.__pcEmit(${JSON.stringify(made.chat)}, ${JSON.stringify(e)})`;
    await ev(E({ t: "ready", cli: "claude", version: "2.1.312", model: "opus", models: ["opus"], efforts: {}, conversationId: "0199aabb-0000-4000-8000-0000000000ee" }));
    await ev(E({ t: "turnStarted", turn: "t1" }));
    await ev(E({ t: "textDelta", item: "m1", text: "원격 창에서도 같은 대화가 보입니다." }));
    await until(`document.querySelector('${RF}')?.textContent.includes('원격 창에서도 같은 대화')`);
    check("⑮ 사건이 원격 페이지의 통로로 와 꼬리에 선다", await ev(`document.querySelector('${RF}')?.textContent.includes('원격 창에서도 같은 대화')`), true);
    await ev(E({ t: "turnEnded", turn: "t1", outcome: "ok" }));
    await sleep(300);
    // 원격에서 보내기 — 같은 op(ALLOW) · clientId
    const sendN = JSON.parse(await ev(`JSON.stringify(window.__calls.filter(([c]) => c === 'producer_chat_send').length)`));
    await ev(`(() => { const el = document.querySelector('${RF} [data-flip-composer] textarea'); el.value = '원격에서 보내는 말'; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true })); })()`);
    await until(`window.__calls.filter(([c]) => c === 'producer_chat_send').length > ${sendN}`);
    const rs = JSON.parse(await ev(`JSON.stringify(window.__calls.filter(([c]) => c === 'producer_chat_send').slice(-1)[0][1])`));
    check("⑮ 원격에서 보내기 — 같은 채팅 · 글 그대로 · clientId", [rs.chat === made.chat, rs.text, typeof rs.clientId === "string" && rs.clientId.length > 0], [true, "원격에서 보내는 말", true]);
    await sleep(400);
    await shot("s5-remote.png");
    // 폰 폭 — 잎이 무너지지 않는다(가로 넘침 없음 · 입력 칸 · 머리 제목이 보인다)
    await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
    await sleep(1500);
    await ev(`(async () => { const m = await ${tabsMod}; m.pickTab(m.currentWorkspaceTabs().find((x) => x.orch)?.id ?? ''); })()`);
    await sleep(800);
    // 폰은 타일 하나씩(solo) — 프로듀서 잎을 고른다
    await ev(`(async () => { const m = await ${tabsMod}; const t = m.activeTab(); const p = t.root.type === 'split' ? t.root.a.pane : null; if (p) m.focusTile(t.id, p.id); })()`);
    await sleep(800);
    const geo = JSON.parse(await ev(`(() => { const leaf = [...document.querySelectorAll('[data-producer-leaf="${made.chat}"]')].find((x) => x.getBoundingClientRect().width > 0); if (!leaf) return JSON.stringify(null); const r = leaf.getBoundingClientRect(); const ta = leaf.querySelector('[data-flip-composer] textarea')?.getBoundingClientRect(); return JSON.stringify({ w: Math.round(r.width), vw: innerWidth, noOverflow: leaf.scrollWidth <= leaf.clientWidth + 1 && document.documentElement.scrollWidth <= innerWidth + 1, composer: !!ta && ta.width > 120 && ta.right <= innerWidth + 1 }); })()`));
    console.log("PHONE", JSON.stringify(geo));
    check("⑮ 폰 폭(390) — 잎이 화면 폭 · 가로 넘침 없음 · 입력 칸이 보인다", [geo !== null && geo.w >= 300, geo?.noOverflow, geo?.composer], [true, true, true]);
    await shot("s5-phone.png");
    // 거울에서 라이브러리로 돌아가 채팅 잎을 빼도 집 PC의 서버 채팅은 닫지 않는다.
    await ev(`(() => { const s = JSON.parse(sessionStorage.getItem('h.mirror')); const library = (t) => { const player = t.root.b; delete player.pane.run; t.root = player; t.orch = { view: 'library' }; }; for (const t of s.tabs ?? []) library(t); for (const w of s.workspaces ?? []) for (const t of w.tabs ?? []) library(t); window.__emit('mirror-layout', s); })()`);
    await need(`!document.querySelector('${RF}') && !!document.querySelector('${H} [data-orch-library]')`);
    check("⑮ 원격 창은 집 PC 채팅을 닫지 않는다(잎이 바뀌어도 close 없음)", await ev(`window.__calls.filter(([c]) => c === 'producer_chat_close').length`), 0);
    await shot("s5-phone-library.png");
  } finally {
    await ev(`sessionStorage.removeItem('aynx-h-remote'); sessionStorage.removeItem('h.mirror'); sessionStorage.removeItem('h.pcchats')`);
    await send("Emulation.setDeviceMetricsOverride", { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    // ipc.isRemote는 모듈 적재 시 한 번 정해진다. 저장 표식만 지우면 다음 시나리오도 원격 창이다.
    await reloadBoot(send, ev);
    check("⑮ 원격 시나리오 뒤 집 PC 모드 복귀", await ev(`(async () => (await ${importApp('lib/ipc.ts')}).isRemote)()`), false);
  }
}
// ⑰ (10-30 실기) DB 연결 폼의 설명 — 늘 보이는 설명은 한 줄 이하 · 나머지는 ⓘ 팝오버 · 위험 고지(행이 모델 제공자로)는 늘 보인다
//   `ORCH_ONLY=db` 면 이것만.
if (ONLY === "" || ONLY === "db") {
  const qMod = importApp("app/query.svelte.ts");
  await ev(`(async () => { const m = await ${qMod}; await m.openConnForm(); m.setConnEngine('postgres'); m.dbPicker.form.tlsMode = 'verify-ca'; await m.setConnAi('read'); })()`);
  await until(`!!document.querySelector('[data-db-picker="form"]')`);
  await sleep(400);
  const lines = async () =>
    JSON.parse(await ev(`JSON.stringify([...document.querySelectorAll('[data-db-picker="form"] .lead, [data-db-picker="form"] .ai-desc, [data-db-picker="form"] .note')].map((x) => { const lh = parseFloat(getComputedStyle(x).lineHeight) || 18; return { t: x.textContent.trim().slice(0, 24), one: x.getBoundingClientRect().height <= lh * 1.5 }; }))`));
  for (const w of [1200, 620]) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(400);
    const ls = await lines();
    if (w === 1200) check("⑰ DB 폼 — 설명 · 경고 줄이 모두 한 줄(1200)", ls.filter((l) => !l.one).map((l) => l.t), []);
    for (const th of ["dark", "light"]) {
      await ev(`document.documentElement.dataset.theme = '${th}'`);
      await sleep(250);
      await shot(`polish-db-form-${w}-${th}.png`);
    }
    await ev(`document.documentElement.dataset.theme = 'dark'`);
  }
  await send("Emulation.setDeviceMetricsOverride", { width: 1200, height: 900, deviceScaleFactor: 1, mobile: false });
  await sleep(300);
  check(
    "⑰ DB 폼 — 위험 고지 늘 보임(행이 모델 제공자로) · ⓘ 셋(머리 · 행 · CA) · 계정 권고는 팝오버로",
    await ev(`(() => { const f = document.querySelector('[data-db-picker="form"]'); return [f.querySelector('[data-db-ai-rows]')?.textContent.includes('모델 제공자'), f.querySelectorAll('.info-toggle').length >= 3, f.innerText.includes('최종 방어선')]; })()`),
    [true, true, false],
  );
  await ev(`document.querySelector('[data-db-ai-rows] .info-toggle').click()`);
  await until(`!!document.querySelector('.note-pop')`);
  check("⑰ DB 폼 — ⚠ 를 누르면 긴 권고가 팝오버로", await ev(`(document.querySelector('.note-pop')?.textContent ?? '').includes('개인정보')`), true);
  await shot("polish-db-form-popover.png");
  await ev(`(async () => { (await ${qMod}).closeDbPicker(); })()`);
  await sleep(300);
}
if (ONLY === '' || ONLY === 'v3-all') {
  for (const scenario of ['v3-library', 'v3-artists', 'v3-nav-esc', 'v3-new-album', 'v3-new-album-fail', 'v3-fork', 'v3-adopt', 'v3-new-remote-reauth', 'v3-album-perm', 'v3-album-perm-remote', 'v3-producer-lives', 'v3-producer-end', 'v3-album-done', 'v3-track', 'v3-track-judge', 'v3-track-blocked', 'v3-track-verify-ask']) await runOrchV3(v3, scenario);
}
else if (ONLY.startsWith('v3-')) await runOrchV3(v3, ONLY);
check("⑦ 콘솔 오류", errors, []);
console.log(bad === 0 ? "ALL PASS" : `${bad} FAIL`);
ws.close();
process.exit(bad === 0 ? 0 : 1);
