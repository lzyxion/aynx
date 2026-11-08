// F4 트랙 화면 시나리오. 서버 동작은 메모리 스텁이며 모델을 호출하지 않는다.
import { albumSideLayout } from './orch-album-layout.mjs';

// 실기 10-31 — 경로 줄은 네 화면(앨범 · 트랙 · 아티스트 · 새 앨범)에서 한 모양: 든 판 왼쪽 위 기준 ← 의 (x, y) · 지름 · 글자 크기.
// 판 = 아티스트는 그 판(.panel), 새 앨범은 오른쪽 구성 칸, 앨범 · 트랙은 플레이어 판(타일).
const CRUMB_GEO = `(() => {
  const nav = document.querySelector('.pane-box:not(.hidden):not(.leaving) [data-orch-path]');
  const back = nav?.querySelector('[data-orch-back]');
  if (!back) return null;
  const card = nav.closest('[data-orch-artists] .panel, .config-col') ?? nav.closest('[data-run-board]');
  const c = card.getBoundingClientRect(), b = back.getBoundingClientRect(), n = nav.getBoundingClientRect();
  const cs = getComputedStyle(nav.querySelector('.crumbs'));
  return [Math.round(b.width), Math.round(b.height), Math.round(b.left - c.left), Math.round(b.top - c.top), cs.fontSize, cs.fontWeight, Math.round(n.height)];
})()`;
export async function runTrackV3(h, only) {
  const { ev, until, check, shot, calls, route, q, tabState, DETAIL, NOW, send } = h;
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  let seqNo = 100;
  const pushDetail = async d => {
    seqNo += 1;
    await ev(`(() => { window.__detail = Object.assign(${JSON.stringify(d)}, { latestSeq: ${seqNo} }); window.__details[window.__detail.runId] = window.__detail; window.__emit('orchestration-changed', { runId: window.__detail.runId, seq: ${seqNo} }); })()`);
  };
  const termScan = async label => check('F4 화면 낱말 — ' + label, await ev(`(() => {
    const c = document.querySelector('[data-track-player]').cloneNode(true);
    c.querySelectorAll('.mono, code, kbd, textarea, input').forEach(e => e.remove());
    document.body.appendChild(c);
    const text = c.innerText + ' ' + [...c.querySelectorAll('[title],[aria-label]')].map(e => (e.getAttribute('title') ?? '') + ' ' + (e.getAttribute('aria-label') ?? '')).join(' ');
    c.remove();
    return !/(?<![A-Za-z_])(Run|Runs|Task|Tasks)(?![A-Za-z_])|조정자|작업자|맡기기|맡긴 저장소|구성 묶음|스튜디오/.test(text);
  })()`), true);
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
  roles: [{ id: "impl", name: "구현가", kind: "write", cli: "claude", usable: true }, { id: "fixer", name: "수리공", kind: "write", cli: "codex", usable: true }, { id: "review", name: "검토자", kind: "judge", cli: "codex", usable: true }],
  tasks: [
    tsk("t1", "설정 파일 TODO 정리", "reported", "a1"),
    tsk("t2", "로그 회전 추가", "active", "a2"),
    tsk("t3", "문서 링크 고치기", "active", "a3"),
    tsk("t4", "오타 정리", "accepted", "a4"),
    tsk("t5", "경로 정규화 공통 함수", "reported", "a5"),
  ],
  attempts: [
    atp("a1", "t1", "claude", "구현가", "write", "reported", [turnOk(1)], { endedAt: NOW - 9 * 60_000 }),
    atp("r1", "t1", "codex", "검토자", "judge", "running", [turnRun(1, "Read", null)], { reviewOf: { reportId: "p1", commitOid: "c0ffee1234" } }),
    atp("a2", "t2", "claude", "구현가", "write", "running", [turnRun(1, "Edit src/log.rs", "sonnet")]),
    atp("a3", "t3", "codex", "수리공", "write", "idle", [turnOk(1)], { blocked: { need: "네트워크 접근(curl) 필요 — 링크가 살아 있는지 확인하려면 바깥 주소에 닿아야 합니다", at: NOW - 4 * 60_000 } }),
    atp("a4", "t4", "codex", "수리공", "write", "reported", [turnOk(1)], { endedAt: NOW - 30 * 60_000, startedAt: NOW - 33 * 60_000 }),
    atp("a5", "t5", "claude", "구현가", "write", "reported", [turnOk(1)], { endedAt: NOW - 2 * 60_000 }),
  ],
  reports: [rep("p1", "a1", "t1"), rep("p4", "a4", "t4"), rep("p5", "a5", "t5")],
  reviewState: { t1: { state: "pending", reportId: "p1", attemptId: "r1" } },
  accepted: [{ taskId: "t4", attemptId: "a4", reportId: "p4", commitOid: "c0ffee1234", reviewer: "coordinator", verification: null, acceptedAt: NOW - 25 * 60_000, integrationCommit: HEAD }],
  jobs: [{ jobId: "j5", taskId: "t5", phase: "awaiting-approval", candidate: "cand5555555", old: HEAD, startedAt: NOW - 60_000, awaitingAt: NOW - 60_000 }],
  log: [{ seq: 1, at: NOW - 60_000, actor: "coordinator", action: "create_task", target: "t1", outcome: "ok" }],
};
  const conv = (id) => ({ conversationId: `conv-${id}` });
  const DET = {
    ...FULL,
    attempts: FULL.attempts.map((a) =>
      a.id === "a2"
        ? { ...a, ...conv("a2"), baseCommit: HEAD, turns: [{ ...turnRun(1, "Edit", "sonnet"), args: { cli: "claude", grade: "edit", settingsControl: "restricted", effort: "high", turnMinutes: 30 } }] }
        : ["r1", "a3"].includes(a.id) ? { ...a, ...conv(a.id) } : a,
    ),
  };
  DET.attempts.unshift({ ...DET.attempts.find(a => a.id === 'a2'), id: 'a2-old', state: 'reported', startedAt: NOW - 30 * 60_000, endedAt: NOW - 20 * 60_000, conversationId: 'conv-a2-old', turns: [turnOk(1)] });
  const T = NOW - 6 * 60_000;
  const it = (role, at, extra = {}) => ({ role, text: null, truncated: false, images: 0, tool: null, at, ...extra });
  const tl = (name, summary, at, extra = {}) => it("tool", at, { tool: { name, summary, input: `{"file":"${summary}"}`, inputTruncated: false, output: "ok", outputTruncated: false, error: false, ...extra } });
  const a2items = [it("user", T + 2_000, { text: "[aynx 작업 지시] 로그 회전을 추가하세요 — 크기 기준 · 보관 개수는 설정에서" })];
  for (let i = 0; i < 14; i += 1) {
    a2items.push(tl(i % 3 === 0 ? "Read" : i % 3 === 1 ? "Grep" : "Edit", `src/log/part${i}.rs`, T + 10_000 + i * 15_000));
    if (i % 4 === 1) a2items.push(it("assistant", T + 12_000 + i * 15_000, { text: `단계 ${i} — 회전 경계를 다시 확인했습니다.` }));
  }
  a2items.push(tl("Bash", "cargo fmt", T + 260_000, { denied: true, output: null }));
  a2items.push(it("assistant", T + 300_000, { text: "회전 크기 상한 시험을 추가하는 중입니다" }));
  a2items.push(tl("Edit", "src/log.rs", NOW - 14_000, { output: null }));
  await ev(`(() => {
    window.__transcripts = {
      'a2-old': [{ role: 'assistant', text: '이전 시도의 기록', truncated: false, images: 0, tool: null, at: ${NOW - 21 * 60_000} }],
      a2: ${JSON.stringify(a2items)},
      r1: [{ role: 'user', text: '[aynx 검토 지시] 보고 p1 을 검토하세요', truncated: false, images: 0, tool: null, at: ${NOW - 120_000} }, { role: 'tool', text: null, truncated: false, images: 0, at: ${NOW - 60_000}, tool: { name: 'Read', summary: 'src/a.rs', input: null, inputTruncated: false, output: null, outputTruncated: false, error: false } }],
      a3: [{ role: 'assistant', text: '링크를 확인하려면 바깥 주소에 닿아야 합니다.', truncated: false, images: 0, tool: null, at: ${NOW - 5 * 60_000} }],
    };
    window.__activity = (args) => {
      const out = { a2: { status: 'ok', recent: null, changedCount: 2, dirty: true, lastGrowthAt: ${NOW} } };
      if (args.detail === 'a2') out.a2.wip = { files: [{ path: 'src/log.rs', status: 'modified', adds: 38, dels: 6, binary: false, uncommitted: true }, { path: 'src/log/tests.rs', status: 'added', adds: 16, dels: 0, binary: false, uncommitted: true, untracked: true }], fileCount: 2, truncated: false, base: '${HEAD}' };
      if (args.detail === 'a3') out.a3 = { status: 'ok', recent: null, changedCount: 0, wip: { files: [], fileCount: 0, truncated: false, base: '${HEAD}' } };
      return out;
    };
    window.__reportFiles = { p1: { taskId: 't1', reportId: 'p1', attemptId: 'a1', base: '${HEAD}', commit: 'c0ffee1234', files: [{ path: 'config/app.toml', status: 'modified', adds: 4, dels: 2, binary: false }, { path: 'docs/todo.md', status: 'deleted', adds: 0, dels: 12, binary: false }], fileCount: 2, truncated: false } };
  })()`);
  DET.runId = 'run-v3-live';
  DET.album = { rev: 1, members: [{ artist: 'a-12345678', name: '구현가', joinedRev: 1, grade: 'edit', allowedCommands: [] }], accept: { require: [], maxRework: 3 }, verifyAuto: false, planTools: false, wakeMax: 30, changedAt: null, riskConfirmedAt: null };
  await pushDetail(DET);
  await route({ view: 'album', runId: DET.runId });
  await until(`!!document.querySelector('[data-track="t2"] [data-track-artist="a2"]')`);
  const geo = {};
  if (only === 'v3-track') {
    // 목업 V3AlbumClosed 대조용 — 트랙 다섯 줄이 찬 앨범 판
    await sleep(400);
    await shot('v3-album-main.png');
    geo.album = await ev(CRUMB_GEO);
    check('B 경로 줄(앨범) — ← 32px 원 · 판 왼쪽 위 (24, 14) · 12.5px', geo.album?.slice(0, 5), [32, 32, 24, 14, '12.5px']);
    check('B 앨범 제목 — 남는 폭을 쓰고 잘리지 않음 · 메타 끝 외톨이 점 없음', await ev(`(() => {
      const tt = document.querySelector('[data-album-head] .title-text'); const head = document.querySelector('[data-album-head]').getBoundingClientRect();
      const dots = [...document.querySelectorAll('[data-album-head] .meta .dot')];
      const lonely = dots.some(d => { const nx = d.nextElementSibling; return !nx || Math.abs(nx.getBoundingClientRect().top - d.getBoundingClientRect().top) > 4; });
      return [tt.scrollWidth <= tt.clientWidth + 1 && tt.scrollHeight <= tt.clientHeight + 1, tt.getBoundingClientRect().right <= head.right, lonely];
    })()`), [true, true, false]);
    // 목업 V3AlbumSideDone(채팅 없음) — 넓은 앨범 칸 = 가운데 트랙 판 + 오른쪽 세부 칸 400(바탕 없음 · 카드 둘: 남은 한도 → 타임라인(남은 높이 · 안쪽만 구름)) ·
    // 트랙 표 아래 칩 · 탭 없음 · 트랙 판이 넓으면 진행 막대 열 보임
    const SIDE = `(${albumSideLayout.toString()})()`;
    const wideSide = (geo) => [geo.side, Math.abs(geo.w - 400) <= 4, geo.clear, geo.cards, geo.fill, geo.scroll, geo.right, geo.tabs, geo.chips, geo.prog];
    const WIDE_400 = [true, true, true, ['limits', 'timeline'], true, true, true, false, false, true];
    check('세부 칸(1400 · 채팅 없음) — 오른쪽 400 · 바탕 없음 · 카드 둘 순서 · 타임라인이 남은 높이 · 표 아래 칩/탭 없음 · 진행 열 보임', wideSide(await ev(SIDE)), WIDE_400);
    check('세부 칸 카드 머리 — 남은 한도 · 시작 때 고정 / 타임라인 · 최근이 위 · n', (await ev(SIDE)).head, ['남은 한도 · 시작 때 고정', '타임라인 · 최근이 위 · n']);
    check('세부 칸 남은 한도 — 칸 격자(3열) · 한도 탭과 같은 칸', await ev(`(() => { const g = document.querySelector('[data-album-side-card="limits"] .remaining'); const cols = getComputedStyle(g).gridTemplateColumns.split(' ').length;
      const names = (sel) => [...document.querySelectorAll(sel + ' dt')].map(e => e.textContent.trim()); return [cols, JSON.stringify(names('[data-album-side-card="limits"]')) === JSON.stringify(names('[data-run-remaining]')), names('[data-album-side-card="limits"]').length >= 5]; })()`), [3, true, true]);
    await send('Emulation.setDeviceMetricsOverride', { width: 1600, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(`(() => { const g = ${SIDE}; return !!g && g.side && g.center > 1000; })()`);
    check('세부 칸(1600 · 채팅 없음) — 같은 배치 · 폭 400 그대로', wideSide(await ev(SIDE)), WIDE_400);
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(`(() => { const g = ${SIDE}; return !!g && g.side && g.center < 1000; })()`);
    // 긴 이름 — 한 줄에 다 못 들면 두 줄까지 감는다(단추 줄 옆에 끼어 한 줄로 잘리지 않는다)
    await pushDetail({ ...DET, name: 'README 와 slug.js 의 TODO 셋을 트랙으로 나눠 처리해 줘 — 각 트랙마다 시험을 붙이고 검토자를 붙여 줘' });
    await until(`document.querySelector('[data-album-head] .title-text')?.textContent.includes('검토자를')`);
    check('B 긴 앨범 제목 — 두 줄까지 · 단추 줄보다 넓게', await ev(`(() => {
      const tt = document.querySelector('[data-album-head] .title-text'); const r = tt.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(tt).lineHeight);
      const actions = document.querySelector('[data-album-head] .actions').getBoundingClientRect();
      return [Math.round(r.height / lh), r.right > actions.left];
    })()`), [2, true]);
    await shot('v3-album-long-title.png');
    // 타임라인 — 사람의 앨범 구성 · 이름 변경 사건은 사람 문구(원문 낱말 아님)
    const withLog = { ...DET, log: [...DET.log, { seq: 2, at: NOW - 30_000, actor: 'human', action: 'album_changed', target: null, outcome: 'rev 2' }, { seq: 3, at: NOW - 20_000, actor: 'human', action: 'album_renamed', target: null, outcome: 'renamed' }] };
    await pushDetail(withLog);
    await until(`!!document.querySelector('[data-run-timeline] [data-ev="album_renamed"]')`);
    check('B 타임라인 — album_changed · album_renamed 번역', await ev(`['album_changed', 'album_renamed'].map(a => document.querySelector('[data-run-timeline] [data-ev="' + a + '"] .what')?.textContent.trim())`), ['앨범 권한 바꿈', '앨범 이름 바꿈']);
    // 좁은 앨범 칸(목업 V3AlbumSideNarrow — 1000 · 트랙 판이 560 아래가 되는 폭)에서는 세부 칸이 사라지고 트랙 표 아래 칩 · 탭으로 내려간다 — 아래 A안 단언은 이 배치에서 본다
    await send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(`(() => { const g = ${SIDE}; return !!g && !g.side && g.tabs; })()`);
    check('좁은 폭(1000) — 세부 칸 없음 · 트랙 표 아래 칩 · 탭', await ev(`(() => { const g = ${SIDE}; return [g.side, g.chips, g.tabs]; })()`), [false, true, true]);
    check('좁은 폭(1000) — 칩 · 탭 · 패널은 카드 한 장(바탕 있음 · 둥근) 안 · 트랙 표 아래 · 한도 칸 이름은 짧게', await ev(`(() => { const c = document.querySelector('[data-album-fold-card]'); if (!c) return null; const cs = getComputedStyle(c); const rows = document.querySelector('[data-run-tracks]') ?? document.querySelector('.album-content .cols'); const dts = [...c.querySelectorAll('[data-run-remaining] dt')].map(e => e.textContent.trim()); return [cs.backgroundColor !== 'rgba(0, 0, 0, 0)', parseFloat(cs.borderTopLeftRadius) >= 12, !!c.querySelector('[data-run-limit-chips]') && !!c.querySelector('[data-album-panel="timeline"]'), !rows || rows.getBoundingClientRect().bottom <= c.getBoundingClientRect().top + 1, dts.every(d => d.length <= 8)]; })()`), [true, true, true, true, true]);
    // A안(10-31 — ▶ 펼침 없음, 목업 V3FoldA · 사용자 배치): 트랙 표는 탭 밖 위에 늘 보이고, 그 아래 한도 칩 셋 → [타임라인 | 한도] 탭 · 판 어디에도 details 없음
    // [트랙 표 보임, 트랙 표가 탭 줄보다 위, 탭 줄이 칩보다 아래, 고른 탭들, 패널 보임(타임라인 · 한도), details 수]
    const albumTabs = `(() => { const b = document.querySelector('[data-run-board]'); const vis = (p) => { const e = b.querySelector('[data-album-panel="' + p + '"]'); return !!e && !e.hidden && e.getBoundingClientRect().height > 0; };
      const tr = b.querySelector('[data-run-tracks]').getBoundingClientRect(); const tl = b.querySelector('[role="tablist"][aria-label="앨범 보기"]').getBoundingClientRect(); const ch = b.querySelector('[data-run-limit-chips]').getBoundingClientRect();
      return [tr.height > 0, tr.bottom <= ch.top + 1, ch.bottom <= tl.top + 1, [...b.querySelectorAll('[data-album-tab]')].map(e => e.dataset.albumTab + '=' + e.getAttribute('aria-selected')), ['timeline', 'limits'].map(vis), b.querySelectorAll('details, summary, [data-album-tab="tracks"]').length]; })()`;
    check('A안 앨범 — 트랙 표 위 늘 보임 · 칩 · 아래 [타임라인 | 한도](처음 타임라인) · details 0', await ev(albumTabs), [true, true, true, ['timeline=true', 'limits=false'], [true, false], 0]);
    check('A안 앨범 탭 글자 — 타임라인 n · 한도', await ev(`[...document.querySelectorAll('[data-album-tab]')].map(e => e.textContent.trim().replace(/\\d+/, 'n'))`), ['타임라인 n', '한도']);
    check('A안 한도 칩 셋(늘 보임) — 동시 · 총 아티스트 쓴 수/한도 · 조율 시간 남음 · [한도 전부 →] 없음(탭과 겹쳐 걷음)', await ev(`(() => { const c = document.querySelector('[data-run-limit-chips]'); const r = c.getBoundingClientRect();
      return [[...c.querySelectorAll('[data-run-limit-chip]')].map(e => e.dataset.runLimitChip), /^동시 아티스트 \\d+ \\/ \\d+$/.test(c.querySelector('[data-run-limit-chip="concurrent"]').textContent.trim()), /^조율 시간 [\\d:]+ 남음$/.test(c.querySelector('[data-run-limit-chip="coord"]').textContent.trim()), !!c.querySelector('[data-run-limits-all]'), r.height > 0]; })()`),
      [['concurrent', 'total', 'coord'], true, true, false, true]);
    check('A안 [타임라인] 탭 — 사건 줄 보임', await ev(`document.querySelector('[data-run-timeline] [data-ev="album_renamed"]').getBoundingClientRect().height > 0`), true);
    await ev(`document.querySelector('[data-album-panel="timeline"]').scrollIntoView({ block: 'end' })`);
    await shot('v3-album-tab-timeline.png');
    await ev(`(() => { const b = document.querySelector('[data-album-tab="limits"]'); b.click(); b.focus(); })()`);
    await until(`document.activeElement?.dataset?.albumTab === 'limits'`);
    check('A안 [한도] 탭 — 한도 탭 · 칸 격자 · 탭 단추에 포커스 · 트랙 표는 그대로 보임', [...(await ev(albumTabs)), await ev(`[document.querySelectorAll('[data-run-remaining] dd').length >= 5, document.activeElement?.dataset.albumTab]`)],
      [true, true, true, ['timeline=false', 'limits=true'], [false, true], 0, [true, 'limits']]);
    await ev(`document.querySelector('[data-album-panel="limits"]').scrollIntoView({ block: 'end' })`);
    await shot('v3-album-tab-limits.png');
    // 키보드 — ← 로 옆 탭(WAI-ARIA 탭 · 포커스가 따라간다)
    await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37 });
    await until(`document.activeElement?.dataset?.albumTab === 'timeline'`);
    check('A안 탭 키보드 ← — 옆 탭으로 · 포커스 따라감', (await ev(albumTabs))[3], ['timeline=true', 'limits=false']);
    await ev(`document.querySelector('[data-album-tab="limits"]').click()`);
    await until(`document.querySelector('[data-album-tab="limits"]')?.getAttribute('aria-selected') === 'true'`);
    // 창 메모리 — 라이브러리에 갔다 돌아와도 그 앨범의 탭이 남는다
    await route({ view: 'library' });
    await route({ view: 'album', runId: DET.runId });
    await until(`!!document.querySelector('[data-album-tab="limits"]')`);
    check('A안 고른 탭은 화면 이동 뒤에도 그 앨범에 남음 · 트랙 표는 그대로', (await ev(albumTabs)).slice(0, 5), [true, true, true, ['timeline=false', 'limits=true'], [false, true]]);
    await ev(`document.querySelector('[data-album-tab="timeline"]').click()`);
    await until(`!document.querySelector('[data-album-panel="timeline"]').hidden`);
    await ev(`document.querySelector('[data-run-board] .album-content')?.scrollTo(0, 0)`);
    await shot('v3-album-narrow-1000.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(`(() => { const g = ${SIDE}; return !!g && g.center < 640; })()`);
    check('좁은 폭(620) — 세부 칸 없음 · 칩 · 탭 · 진행 열 숨김', await ev(`(() => { const g = ${SIDE}; return [g.side, g.chips, g.tabs, g.prog]; })()`), [false, true, true, false]);
    await shot('v3-album-narrow-620.png');
    await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(`(() => { const g = ${SIDE}; return !!g && g.side; })()`);
    // 끝난 앨범 · 이미 내보냄 — [브랜치로 내보내기] 대신 칩만 · 막대 가운데는 완료 표시(꺼진 ⏸ 아님)
    await pushDetail({ ...DET, state: 'done', endedAt: NOW - 1_000, attempts: DET.attempts.map(a => ({ ...a, state: a.state === 'running' ? 'reported' : a.state, turns: (a.turns ?? []).map(x => x.outcome === 'running' ? { ...x, outcome: 'ok', endedAt: NOW - 2_000 } : x) })), integration: { ...DET.integration, exportedHead: DET.integration.expectedHead } });
    await until(`document.querySelector('[data-album-head]')?.dataset.runStateWord === 'done' && !!document.querySelector('[data-integration-exported]')`);
    await until(`!!document.querySelector('[data-orch-bar-action="ended"]')`);
    check('B 끝난 앨범 — 내보냄 칩만(내보내기 단추 없음) · 막대 가운데 완료 표시', await ev(`[!!document.querySelector('[data-album-head] [data-run-action="export"]'), document.querySelector('[data-integration-exported]')?.dataset.integrationExported, !!document.querySelector('[data-orch-bar-action="pause"]'), !!document.querySelector('[data-orch-bar-action="ended"]')]`), [false, 'current', false, true]);
    check('끝난 앨범(채팅 없음) — 세부 칸 400 · 카드 둘', await ev(`(() => { const g = ${SIDE}; return [g.side, Math.abs(g.w - 400) <= 4, g.cards]; })()`), [true, true, ['limits', 'timeline']]);
    await shot('v3-album-done.png');
    await pushDetail(DET);
    await until(`document.querySelector('[data-album-head]')?.dataset.runStateWord === 'running' && !!document.querySelector('[data-track="t2"] [data-track-artist="a2"]') && !document.querySelector('[data-integration-exported]')`);
  }
  if (only !== 'v3-track') {
    await runTrackState(h, only, DET, pushDetail);
    return;
  }
  // 트랙 줄 자체가 지금 재생 중 화면으로 들어간다.
  await ev(`document.querySelector('[data-track="t2"] .head').click()`);
  await until(`!!document.querySelector('[data-artist-detail="a2"]') && document.querySelectorAll('[data-artist-lyrics] .line').length > 10`);
  await until(`!document.querySelector('.host.sliding, .host.anim')`);
  geo.track = await ev(CRUMB_GEO);
  check('B 경로 줄(트랙) = 앨범과 같은 자리 · 크기', geo.track, geo.album);
  check('B 트랙 — 작업 자원 라벨은 UI 글꼴(OID · 경로 값만 고정폭)', await ev(`(() => {
    const kv = document.querySelector('[data-track-card="resources"] .kv');
    return getComputedStyle(kv.querySelector('dt')).fontFamily !== getComputedStyle(kv.querySelector('dd.mono')).fontFamily;
  })()`), true);
  // 목업 V3TrackSide — 오른쪽 칸 400px · 바탕 없이 카드 넷(상태 → 시도 · 검토 → 바뀐 파일 → 작업 자원) · [diff 보기] 는 바뀐 파일 머리 · 맨 아래 [대화 기록 전체](넓게) ■ ⋯
  check('사이드 — 칸 폭 400±4 · 칸 바탕 없음 · 카드 넷 순서 · 평소 상태 카드(사람 할 일 없음)', await ev(`(() => {
    const side = document.querySelector('[data-track-side]'); const w = side.getBoundingClientRect().width;
    const cards = [...side.querySelectorAll('[data-track-card]')].map(c => c.dataset.trackCard);
    const st = side.querySelector('[data-track-card="status"]');
    const bg = getComputedStyle(side).backgroundColor; const clear = bg === 'transparent' || bg.replace(/\\s/g, '').endsWith(',0)');
    return [Math.abs(w - 400) <= 4, clear, cards, st.dataset.humanGate, st.querySelector('.state-chip')?.textContent.trim(), getComputedStyle(st).borderTopLeftRadius];
  })()`), [true, true, ['status', 'attempts', 'files', 'resources'], 'false', '사람 할 일 없음', '16px']);
  check('사이드 — [diff 보기] 는 바뀐 파일 카드 머리 · 맨 아래 줄 = 기록(넓게) ■ ⋯', await ev(`(() => {
    const files = document.querySelector('[data-track-card="files"]'); const row = document.querySelector('[data-artist-actions]');
    const tr = row.querySelector('[data-artist-transcript]').getBoundingClientRect().width; const side = document.querySelector('[data-track-side]').getBoundingClientRect().width;
    const kind = (b) => b.matches('[data-artist-transcript]') ? 'transcript' : b.matches('[data-artist-stop]') ? 'stop' : b.matches('[data-track-more]') ? 'more' : '?';
    return [!!files.querySelector('.card-head [data-artist-diff]'), files.querySelector('[data-artist-diff]')?.textContent.trim(), [...row.children].map(kind), tr / side > 0.6];
  })()`), [true, 'diff 보기', ['transcript', 'stop', 'more'], true]);
  check("F4 상세 — 앨범 판 자리 · 트랙 줄 없음", await ev(`[!!document.querySelector('[data-artist-detail="a2"]'), !!document.querySelector('[data-run-tracks]')]`), [true, false]);
  check('F4 머리 — 이웃은 시도가 아닌 트랙 번호', await ev(`[document.querySelector('[data-track-prev]')?.dataset.trackPrev, document.querySelector('[data-track-next]')?.dataset.trackNext]`), ['t1', 't3']);
  check("F4 부제 — 아티스트 · CLI 모델 · 권한 · 시도 · 턴(목업 한 줄)", await ev(`document.querySelector('[data-artist-sub]')?.textContent.trim()`), "구현가 · Claude sonnet · 편집 자동 · 시도 2 · 턴 1");
  check("F4 머리 — TRACK 2 · 지금 재생 중", await ev(`document.querySelector('[data-track-status-note]')?.textContent.trim()`), "TRACK 2 · 지금 재생 중");
  check("F4 가사 — 마지막 줄이 지금(크게 · 이퀄라이저) · 지금 도구 경과", await ev(`(() => { const ls = [...document.querySelectorAll('[data-artist-lyrics] .line')]; const last = ls[ls.length - 1]; return [last.classList.contains('now'), !!last.querySelector('.eq [data-eq="playing"]'), last.textContent.includes('Edit src/log.rs'), (document.querySelector('[data-artist-doing]')?.textContent.trim() ?? '').endsWith('째')]; })()`), [true, true, true, true]);
  check("F4 가사 — 거절 줄(호박) · 턴 시작 줄", await ev(`[!!document.querySelector('[data-artist-lyrics] .line[data-kind="denied"]'), !!document.querySelector('[data-artist-lyrics] .line[data-kind="turn"]')]`), [true, true]);
  check("F4 곁 — 도구 7 · 거절 0 · 경과/턴 시한 30분(상태 카드 안 숫자 칸)", await ev(`[document.querySelector('[data-artist-stat="tools"] .stat-num')?.textContent.trim(), document.querySelector('[data-artist-stat="denials"] .stat-num')?.textContent.trim(), /^\\d+:\\d\\d \\/ 30:00$/.test(document.querySelector('[data-artist-stat="clock"] .mono')?.textContent.trim() ?? ''), !!document.querySelector('[data-track-card="status"] .nums [data-artist-stat="tools"]')]`), ["7", "0", true, true]);
  await until(`document.querySelectorAll('[data-artist-file]').length === 2`);
  check("F4 바뀐 파일(작업 중 · wip 는 상세 칸에만 물었다) — M +38 −6 · A +16", await ev(`[document.querySelector('[data-artist-files]')?.dataset.artistFiles, [...document.querySelectorAll('[data-artist-file]')].map(x => x.textContent.replace(/\\s+/g, ' ').trim()), window.__calls.some(([c, a]) => c === 'orchestration_worker_activity' && a.detail === 'a2')]`), ["wip", ["M src/log.rs +38 −6", "A src/log/tests.rs +16"], true]);
  // A안(10-31 — ▶ 펼침 없음): 작업 자원 카드 머리 오른쪽 [턴 | 시도 정보] 탭 — 같은 자리를 바꿔 본다(처음은 턴 · 턴 줄이 바로 보인다)
  const resTabs = `(() => { const c = document.querySelector('[data-track-card="resources"]'); const shown = (e) => !!e && !e.hidden && e.getBoundingClientRect().height > 0;
    return [[...c.querySelectorAll('[data-artist-res-tab]')].map(e => e.textContent.trim() + '=' + e.getAttribute('aria-selected')), shown(c.querySelector('[data-artist-turns]')), shown(c.querySelector('[data-artist-res-info]')), document.querySelectorAll('[data-track-player] details, [data-track-player] summary').length]; })()`;
  check("F4 작업 자원 — worktree · 기준 두 줄 · 머리 오른쪽 [턴 1 | 시도 정보] · 턴 줄 바로 보임 · details 0", await ev(`(() => {
    const c = document.querySelector('[data-track-card="resources"]'); const kv = [...c.querySelectorAll('.kv dt, .kv dd')].map(x => x.textContent.trim());
    return [kv, !!c.querySelector('.card-head [role="tablist"] [data-artist-res-tab="turns"]'), document.querySelectorAll('[data-artist-turn]').length, document.querySelector('[data-artist-turn="1"]').getBoundingClientRect().height > 0, !!c.querySelector('[data-track-technical]')];
  })()`), [["worktree", "api-wt/a2", "기준", "a3f9c21"], true, 1, true, true]);
  check("F4 [턴 | 시도 정보] 처음 = 턴", await ev(resTabs), [["턴 1=true", "시도 정보=false"], true, false, 0]);
  await ev(`document.querySelector('[data-artist-res-tab="info"]').click()`);
  await until(`document.querySelector('[data-artist-res-tab="info"]')?.getAttribute('aria-selected') === 'true'`);
  check("F4 [시도 정보] 탭 — 턴 목록 자리에 시도 세부 정보", await ev(resTabs), [["턴 1=false", "시도 정보=true"], false, true, 0]);
  check('F4 옛 아티스트 칸은 선택 시도의 실행 상세로 보존', await ev(`[document.querySelector('[data-track-technical]').getBoundingClientRect().height > 0, document.querySelector('[data-track-technical] [data-attempt-id]')?.dataset.attemptId, document.querySelector('[data-track-technical] [data-attempt-turn]')?.dataset.turnRunning, document.querySelector('[data-track-technical] [data-attempt-model]')?.dataset.attemptModel, !!document.querySelector('[data-track-technical] [data-attempt-turn-args]'), document.querySelector('[data-track-technical] [data-attempt-turns]')?.getBoundingClientRect().height > 0]`), [true, 'a2', '1', 'sonnet', true, true]);
  await ev(`document.querySelector('[data-track-side]').scrollTop = 1e6`);
  await sleep(200);
  await shot('v3-track-res-info.png');
  await ev(`document.querySelector('[data-artist-res-tab="turns"]').click()`);
  await until(`document.querySelector('[data-artist-res-tab="turns"]')?.getAttribute('aria-selected') === 'true'`);
  check("F4 [턴] 탭으로 되돌림", await ev(resTabs), [["턴 1=true", "시도 정보=false"], true, false, 0]);
  await ev(`document.querySelector('[data-track-side]').scrollTop = 1e6`);
  await sleep(200);
  await shot('v3-track-res-turns.png');
  await ev(`document.querySelector('[data-track-side]').scrollTop = 0`);
  check("F4 상세에 undefined · NaN 없음", await ev(`!/undefined|NaN/.test(document.querySelector('[data-artist-detail]').innerText)`), true);
  check("F4 따라가기 — 처음엔 맨 아래", await ev(`(() => { const el = document.querySelector('[data-artist-lyrics]'); return [el.dataset.follow, el.scrollHeight - el.scrollTop - el.clientHeight < 30]; })()`), ["1", true]);
  await sleep(400);
  await shot("worker-playing.png");
  await shot('v3-track.png');
  // (⑤ 다듬기) 가사 단계 — 지금 줄 28px 굵게 · 바로 위 17 · 16 · 15 · 15px, 색은 위로 갈수록 옅게(목업 WorkerDetail)
  check(
    "⑤ 가사 단계 — 지금 28/900 · 위로 17 · 16 · 15 · 15px · 옅어짐",
    await ev(`(() => {
      const ls = [...document.querySelectorAll('[data-artist-lyrics] .line')];
      const now = ls[ls.length - 1]; const cs = getComputedStyle(now);
      const plain = ls.filter((l) => !l.classList.contains('now') && ['tool', 'say', 'prompt'].includes(l.dataset.kind) && !l.classList.contains('error'));
      const size = {}; const alpha = {};
      for (const l of plain) { const st = l.dataset.step; const c = getComputedStyle(l); size[st] ??= c.fontSize; const m = c.color.match(/[\\d.]+/g).map(Number); alpha[st] ??= (m[3] ?? 1) * (m[0] + m[1] + m[2]); }
      const dim = ['1', '2', '3', '4'].filter((k) => k in alpha).map((k) => alpha[k]);
      const want = { 1: '17px', 2: '16px', 3: '15px', 4: '15px' }; const seen = Object.keys(size);
      return [cs.fontSize, cs.fontWeight, seen.length >= 3 && seen.every((k) => size[k] === want[k]), dim.every((v, i) => i === 0 || v < dim[i - 1])];
    })()`),
    ["28px", "900", true, true],
  );
  await termScan("아티스트 상세");
  await shot("terms-detail.png");

  // 필터 — 도구만 · 말만
  await ev(`document.querySelector('[data-lyric-filter="tools"]').click()`);
  await sleep(200);
  check("F4 필터 도구만 — 도구 · 거절 줄만", await ev(`[...new Set([...document.querySelectorAll('[data-artist-lyrics] .line')].map(x => x.dataset.kind))].sort()`), ["denied", "tool"]);
  await ev(`document.querySelector('[data-lyric-filter="says"]').click()`);
  await sleep(200);
  check("F4 필터 말만 — 말 · 지시 줄만", await ev(`[...new Set([...document.querySelectorAll('[data-artist-lyrics] .line')].map(x => x.dataset.kind))].sort()`), ["prompt", "say"]);
  await shot("worker-filter-says.png");
  await ev(`document.querySelector('[data-lyric-filter="all"]').click()`);
  await sleep(300);

  // 위로 굴리면 따라가기 멈춤 → 새 줄이 와도 그 자리 · [최신으로]
  await ev(`(() => { const el = document.querySelector('[data-artist-lyrics]'); el.scrollTop = 0; el.dispatchEvent(new Event('scroll')); })()`);
  await until(`!!document.querySelector('[data-artist-latest]')`);
  const readsBefore = (await calls("orchestration_worker_transcript")).length;
  await ev(`(() => {
    window.__transcripts.a2 = [...window.__transcripts.a2.slice(0, -1), { ...window.__transcripts.a2[window.__transcripts.a2.length - 1], tool: { ...window.__transcripts.a2[window.__transcripts.a2.length - 1].tool, output: 'done' } }, { role: 'assistant', text: '시험 둘을 더 붙였습니다.', truncated: false, images: 0, tool: null, at: ${NOW - 2_000} }];
    const d = JSON.parse(JSON.stringify(window.__detail));
    d.attempts.find(a => a.id === 'a2').turns[0].tools = 8;
    window.__detail = d;
    window.__details[d.runId] = d;
    window.__emit('orchestration-progress', { runId: 'run-v3-live', attemptId: 'a2', turn: 1 });
  })()`);
  await until(`window.__calls.filter(([c]) => c === 'orchestration_worker_transcript').length > ${readsBefore}`, 6000);
  await until(`[...document.querySelectorAll('[data-artist-lyrics] .line')].some(x => x.textContent.includes('시험 둘을 더'))`);
  check("F4 위로 굴린 동안 새 줄이 와도 따라가지 않는다 · [최신으로]", await ev(`(() => { const el = document.querySelector('[data-artist-lyrics]'); return [el.dataset.follow, el.scrollTop < 40, !!document.querySelector('[data-artist-latest]')]; })()`), ["0", true, true]);
  check("F4 이어 붙임 — 같은 줄 두 번 없음(진행 중 도구가 끝나도 한 줄)", await ev(`[...document.querySelectorAll('[data-artist-lyrics] .line')].filter(x => x.textContent.includes('Edit src/log.rs')).length`), 1);
  await shot("worker-scrolled.png");
  await ev(`document.querySelector('[data-artist-latest]').click()`);
  await sleep(300);
  check("F4 [최신으로] → 다시 맨 아래 · 따라가기", await ev(`(() => { const el = document.querySelector('[data-artist-lyrics]'); return [el.dataset.follow, el.scrollHeight - el.scrollTop - el.clientHeight < 30, !document.querySelector('[data-artist-latest]')]; })()`), ["1", true, true]);


  await ev(`document.querySelector('[data-track-prev]').click()`);
  await until(`!!document.querySelector('[data-track-player="t1"]')`);
  check('F4 이웃 칩은 트랙 경로', (await tabState()).orch.taskId, 't1');
  await ev(`document.querySelector('[data-track-next]').click()`);
  await until(`!!document.querySelector('[data-track-player="t2"]')`);
  await ev(`document.querySelector('[data-track-attempt="a2-old"]').click()`);
  await until(`!!document.querySelector('[data-artist-detail="a2-old"]') && document.querySelector('[data-artist-lyrics]').textContent.includes('이전 시도의 기록')`);
  check('F4 시도 선택은 같은 트랙 경로에 담김', (await tabState()).orch, { view: 'track', runId: 'run-v3-live', taskId: 't2', attemptId: 'a2-old' });
  check('F4 선택 시도 강조', await ev(`document.querySelector('[data-track-attempt="a2-old"]').getAttribute('aria-pressed')`), 'true');
  await ev(`document.querySelector('[data-track-attempt="a2"]').click()`);
  await until(`!!document.querySelector('[data-artist-detail="a2"]') && !document.querySelector('[data-artist-lyrics]').textContent.includes('이전 시도의 기록')`);
  // 맨 위 뒤로 단추와 실제 Esc가 모두 앨범으로 돌아간다.
  const back = await ev(`(() => { const all = document.querySelectorAll('[data-track-player] [data-orch-back]'); const b = all[0]; const r = b.getBoundingClientRect(); return [all.length, document.querySelectorAll('[data-run-board] [data-orch-back]').length, Math.round(r.width), getComputedStyle(b).borderTopLeftRadius, b.querySelector('path')?.getAttribute('d'), b.getAttribute('title')?.includes('Esc')]; })()`);
  check('F4 뒤로 — 경로 줄 원형 32px 하나뿐 · 왼쪽 화살표 · Esc 도움말', back, [1, 1, 32, '50%', 'M19 12H5M11 6l-6 6 6 6', true]);
  await ev(`document.querySelector('[data-track-player] [data-orch-back]').click()`);
  await until(`!!document.querySelector('[data-run-tracks]')`);
  await ev(`(() => { const b = document.querySelector('[data-orch-now]'); b.focus(); b.click(); })()`);
  await until(`!!document.querySelector('[data-track-player="t2"]')`);
  check('F4 지금 곡 → 지금 시도 경로', (await tabState()).orch, { view: 'track', runId: 'run-v3-live', taskId: 't2', attemptId: 'a2' });
  check('F4 열면 포커스는 트랙 화면 안', await ev(`document.querySelector('[data-track-player]').contains(document.activeElement)`), true);
  check('F4 기록·diff·중단 단추 보존', await ev(`[document.querySelector('[data-artist-transcript]')?.disabled, !!document.querySelector('[data-artist-diff]'), document.querySelector('[data-artist-stop]')?.disabled]`), [false, true, false]);
  await ev(`document.querySelector('[data-artist-transcript]').click()`);
  await until(`!!document.querySelector('[data-convo-viewer="conv-a2"]')`);
  check('F4 대화 기록 전체는 고정 시도의 대화', await ev(`document.querySelector('[data-convo-viewer]')?.dataset.convoViewer`), 'conv-a2');
  await ev(`document.querySelector('[data-viewer-close]').click()`);
  await until(`!document.querySelector('[data-convo-viewer]')`);
  const stopBefore = (await calls('orchestration_stop_worker')).length;
  await ev(`window.__answers.orchestration_stop_worker = null; document.querySelector('[data-artist-stop]').click()`);
  await until(`!!document.querySelector('[data-artist-stop-confirm]')`);
  check('F4 중단 확인 전 서버 호출 없음', (await calls('orchestration_stop_worker')).length, stopBefore);
  await ev(`document.querySelector('[data-artist-stop-ok]').click()`);
  await until(`window.__calls.filter(([c]) => c === 'orchestration_stop_worker').length > ${stopBefore}`);
  check('F4 중단 확인은 지금 시도만', (await calls('orchestration_stop_worker')).slice(-1)[0], { runId: 'run-v3-live', attemptId: 'a2' });
  // ⋯ → 메뉴(메뉴 통로) — [트랙 취소] 는 옛 오른쪽 아래 글자 단추와 같은 명령(확인 없이 · 서버가 판 버전으로 다시 판정)
  await ev(`document.querySelector('[data-track-more]').click()`);
  await until(`!!document.querySelector('[data-toolbar-menu] [data-menu-key="cancel"]')`);
  check('⋯ 메뉴 — 트랙 취소(위험 글자) · 다시 열기 없음(작업 중 트랙)', await ev(`(() => { const m = document.querySelector('[data-toolbar-menu]'); const c = m.querySelector('[data-menu-key="cancel"]'); return [c.textContent.trim(), c.classList.contains('danger'), !!m.querySelector('[data-menu-key="reopen"]'), document.querySelector('[data-track-more]').getAttribute('aria-expanded')]; })()`), ['트랙 취소', true, false, 'true']);
  const setBefore = (await calls('orchestration_set_task_state')).length;
  await ev(`window.__answers.orchestration_set_task_state = null; document.querySelector('[data-toolbar-menu] [data-menu-key="cancel"]').click()`);
  await until(`window.__calls.filter(([c]) => c === 'orchestration_set_task_state').length > ${setBefore}`);
  const setCall = (await calls('orchestration_set_task_state')).slice(-1)[0];
  check('⋯ 트랙 취소 → 메뉴 닫고 그 트랙 취소 명령', [await ev(`!!document.querySelector('[data-toolbar-menu]')`), setCall.runId, setCall.taskId, setCall.state], [false, 'run-v3-live', 't2', 'cancelled']);
  // 앞 시나리오의 기기 폭에 기대지 않는다. 움직임 종료 뒤 기하를 한 번 측정한다.
  for (const width of [620, 390]) {
    await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width === 390 });
    await until(`!document.querySelector('.host.sliding, .host.anim')`);
    await ev(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    check('F4 ' + width + 'px 트랙 가로 넘침 없음', await ev(`(() => { const p = document.querySelector('[data-track-player]'); return p.scrollWidth <= p.clientWidth + 1; })()`), true);
    await shot('v3-track-' + width + '.png');
  }
  await send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(`!!document.querySelector('[data-run-tracks]')`);
  check('F4 Esc → 앨범 · 펼침 없음', await ev(`[!document.querySelector('[data-track-player]'), document.querySelectorAll('[data-track] .body').length]`), [true, 0]);
  for (const view of ['artists', 'new']) {
    await route({ view });
    await until(`!!document.querySelector('.pane-box:not(.hidden):not(.leaving) [data-orch-path="${view}"] [data-orch-back]') && !document.querySelector('.host.sliding, .host.anim')`);
    await ev(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    geo[view] = await ev(CRUMB_GEO);
    check(`B 경로 줄(${view}) = 앨범과 같은 자리 · 크기`, geo[view], geo.album);
    await shot(`v3-crumb-${view}.png`);
  }
}

async function runTrackState(h, only, detail, pushDetail) {
  const { ev, until, check, shot, route, calls, tabState } = h;
  const album = async () => {
    await route({ view: 'album', runId: detail.runId });
    await until(`!!document.querySelector('[data-run-tracks]')`);
  };
  if (only === 'v3-track-judge') {
    await ev(`document.querySelector('[data-track="t1"] .head').click()`);
    await until(`!!document.querySelector('[data-track-player="t1"]') && !!document.querySelector('[data-artist-detail="r1"]') && document.querySelectorAll('[data-artist-file]').length === 2`);
    check('F4 판정형 — 기본 시도는 도는 검토자 · 검토 대상 파일', await ev(`[document.querySelector('[data-artist-detail]').dataset.artistKind, document.querySelector('[data-artist-files]')?.dataset.artistFiles, [...document.querySelectorAll('[data-artist-file]')].map(x => x.dataset.letter).join('')]`), ['judge', 'review', 'MD']);
    check('F4 판정형 — 보고의 고정 파일 조회', (await calls('orchestration_report_files')).some(a => a.reportId === 'p1'), true);
    await ev(`document.querySelector('[data-track-attempt="a1"]').click()`);
    await until(`!!document.querySelector('[data-artist-detail="a1"]')`);
    check('F4 검토/쓰기 시도 전환은 같은 트랙', [(await tabState()).orch.taskId, (await tabState()).orch.attemptId], ['t1', 'a1']);
    await ev(`document.querySelector('[data-track-attempt="r1"]').click()`);
    await until(`!!document.querySelector('[data-artist-detail="r1"]')`);
    const finished = structuredClone(detail);
    const judge = finished.attempts.find(a => a.id === 'r1');
    judge.state = 'reported'; judge.endedAt = Date.now(); judge.turns[0].outcome = 'ok'; judge.turns[0].endedAt = Date.now();
    const verdict = { reviewId: 'review-track-1', attemptId: 'r1', taskId: 't1', reportId: 'p1', commitOid: 'c0ffee1234', verdict: 'changes-requested', summary: '경계 조건을 보강해 주세요.', findings: ['빈 경로를 처리하지 않습니다.'], state: 'current', at: Date.now() };
    finished.reviewReports = [verdict];
    finished.reviewState.t1 = { ...verdict, state: verdict.verdict };
    await pushDetail(finished);
    await until(`document.querySelector('[data-track-player="t1"]').textContent.includes('경계 조건을 보강해 주세요.')`);
    check('F4 검토 판정 — 판정·요약·지적 내용 표시(지금 보고의 판정은 검토 블록 한 곳 — 실기 10-31 두 번 나옴)', await ev(`(() => { const r = document.querySelector('[data-track-player="t1"]'); return [r.querySelector('[data-task-review] [data-review-summary]')?.textContent.includes('경계 조건을 보강해 주세요.'), r.querySelector('[data-task-review] [data-review-findings]')?.textContent.includes('빈 경로를 처리하지 않습니다.'), !!r.querySelector('[data-judgment="review-track-1"][data-verdict="changes-requested"]'), r.querySelectorAll('[data-track-judgment="review-track-1"]').length, (r.textContent.match(/경계 조건을 보강해 주세요/g) ?? []).length]; })()`), [true, true, true, 0, 1]);
    check('F4 사람 검토 단추 — 수락/반려 보존 · 첫 카드 = 사람 확인(호박) 안', await ev(`(() => { const st = document.querySelector('[data-track-side] [data-track-card]'); return [!!document.querySelector('[data-review-accept="t1"]'), !!document.querySelector('[data-review-reject="t1"]'), st.dataset.trackCard, st.dataset.humanGate, !!st.querySelector('[data-review-accept="t1"].gate-main'), !!st.querySelector('[data-review-reject="t1"].gate-reject')]; })()`), [true, true, 'status', 'true', true, true]);
    await ev(`window.__answers.orchestration_review_task = null`);
    for (const decision of ['accept', 'reject']) {
      const before = (await calls('orchestration_review_task')).length;
      await until(`!document.querySelector('[data-review-${decision}="t1"]').disabled`);
      await ev(`document.querySelector('[data-review-${decision}="t1"]').click()`);
      await until(`window.__calls.filter(([c]) => c === 'orchestration_review_task').length > ${before}`);
      check('F4 사람 판정 ' + decision + ' — 같은 트랙·버전', (await calls('orchestration_review_task')).slice(-1)[0], { runId: detail.runId, taskId: 't1', version: 1, decision });
    }
    await shot(only + '.png');
    await ev(`document.querySelector('[data-orch-crumb="album"]').click()`);
    await until(`!!document.querySelector('[data-run-tracks]')`);
    return;
  }
  if (only === 'v3-track-blocked') {
    // 사람 필요 종의 첫 사람 몫 트랙은 막힘 t3이다.
    await ev(`document.querySelector('[data-orch-bar-needs]').click()`);
    await until(`!!document.querySelector('[data-track-player="t3"]') && !!document.querySelector('[data-artist-detail="a3"]')`);
    check('F4 사람 필요 종 → 첫 사람 몫 트랙', (await tabState()).orch.taskId, 't3');
    await until(`!!document.querySelector('[data-artist-band="blocked"]')`);
    check('F4 막힘 — need·앨범 권한·지금 줄 없음', await ev(`[document.querySelector('[data-artist-band]')?.dataset.artistBand, document.querySelector('[data-artist-need]')?.textContent.includes('네트워크'), document.querySelector('[data-artist-permissions]')?.textContent.trim(), !!document.querySelector('[data-artist-lyrics] .line.now')]`), ['blocked', true, '앨범 권한', false]);
    await until(`document.querySelector('[data-artist-files="wip"]') && document.querySelectorAll('[data-artist-file]').length === 0`);
    check('F4 막힌 아티스트의 빈 파일도 상태 문구 표시', await ev(`document.querySelector('[data-artist-files]').textContent.trim().length > 0`), true);
    await shot(only + '.png');
    await ev(`document.querySelector('[data-artist-permissions]').click()`);
    await until(`!!document.querySelector('[data-album-permissions]')`);
    check('F4 막힘 관문은 같은 트랙 옆 앨범 권한 패널', [(await tabState()).orch.view, (await tabState()).orch.taskId, await ev(`!!document.querySelector('[data-track-player="t3"]')`)], ['track', 't3', true]);
    await ev(`document.querySelector('[data-perm-cancel]').click()`);
    await until(`!document.querySelector('[data-album-permissions]')`);
    await album();
    const paused = { ...detail, state: 'paused', pauseReason: 'coordinator-exited', coordinatorAttached: false };
    await pushDetail(paused);
    await until(`document.querySelector('[data-run-pause-band]')?.dataset.runPauseBand === 'coordinator' && !!document.querySelector('[data-run-pause-track="t3"]')`);
    check('F4 조율 멈춤 띠 [보기]는 첫 사람 몫 트랙', await ev(`document.querySelector('[data-run-pause-track]')?.dataset.runPauseTrack`), 't3');
    await ev(`document.querySelector('[data-run-pause-track="t3"]').click()`);
    await until(`!!document.querySelector('[data-track-player="t3"]') && !!document.querySelector('[data-artist-detail="a3"]')`);
    check('F4 조율 멈춤 띠 → 트랙 경로·지금 시도', (await tabState()).orch, { view: 'track', runId: detail.runId, taskId: 't3', attemptId: 'a3' });
    return;
  }
  if (only === 'v3-track-verify-ask') {
    await ev(`window.__answers.orchestration_approve_verify = null; window.__answers.orchestration_review_task = null`);
    await ev(`document.querySelector('[data-track-gate="verify"]').click()`);
    await until(`!!document.querySelector('[data-track-player="t5"]') && !!document.querySelector('[data-verify-ask="t5"]')`);
    check('F4 검증 관문 — 트랙 화면에서 확인', await ev(`[!!document.querySelector('[data-verify-run="t5"]'), document.querySelector('[data-verify-ask="t5"]').textContent.includes('npm test')]`), [true, true]);
    // 목업 V3TrackSideGate — 사람 확인이 필요하면 첫 카드가 호박 카드이고 확인 · [검증 실행] 이 그 안(맨 위라 화면 밖으로 밀리지 않는다)
    check('사이드 관문 — 첫 카드 = 호박 상태 카드 · 머리 "사람 확인 필요" · 확인과 [검증 실행] 이 그 안', await ev(`(() => {
      const st = document.querySelector('[data-track-side] [data-track-card]');
      return [st.dataset.trackCard, st.dataset.humanGate, st.classList.contains('gate'), st.querySelector('.gate-title')?.textContent.trim(), !!st.querySelector('[data-verify-ask="t5"] [data-verify-run="t5"]'), getComputedStyle(st).backgroundColor !== getComputedStyle(document.querySelector('[data-track-card="files"]')).backgroundColor];
    })()`), ['status', 'true', true, '사람 확인 필요', true, true]);
    const before = (await calls('orchestration_approve_verify')).length;
    // 확인 중 후보가 바뀌면 고정 묶음을 버려야 한다.
    const replaced = structuredClone(detail);
    replaced.jobs[0].candidate = 'new-candidate';
    await pushDetail(replaced);
    await until(`!document.querySelector('[data-verify-ask="t5"]')`);
    check('F4 바뀐 후보는 확인 취소 · 실행하지 않음', (await calls('orchestration_approve_verify')).length - before, 0);
    check('사이드 관문 — 확인 전: 후보 · 명령 상자 · [검증 실행](넓게) 이 호박 카드 안 · 안내 한 줄', await ev(`(() => {
      const st = document.querySelector('[data-track-side] [data-track-card="status"]'); const box = st.querySelector('[data-track-gate-box="t5"]');
      const run = box?.querySelector('[data-verify-approve="t5"]');
      return [st.dataset.humanGate, box?.querySelector('.verify-box .cmd')?.textContent.trim(), run?.classList.contains('gate-main'), !!run && run.getBoundingClientRect().width > box.getBoundingClientRect().width * 0.5, !!box?.querySelector('.gate-hint')];
    })()`), ['true', 'npm test', true, true, true]);
    await shot('v3-track-gate.png');
    // 작은 창(오른쪽 칸이 굴러가는 높이) — 확인 카드가 칸 스크롤 아래에 숨지 않는다(실기 10-31 22 → 23)
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1000, height: 560, deviceScaleFactor: 1, mobile: false });
    await until(`!document.querySelector('.host.sliding, .host.anim')`);
    await ev(`(() => { const s = document.querySelector('[data-track-side]'); if (s) s.scrollTop = 0; })()`);
    await ev(`document.querySelector('[data-verify-approve="t5"]').click()`);
    await until(`!!document.querySelector('[data-verify-run="t5"]')`);
    await new Promise(r => setTimeout(r, 300));
    check('B 검증 확인 카드 — 작은 창에서도 화면 안', await ev(`(() => { const c = document.querySelector('[data-verify-ask="t5"]').getBoundingClientRect(); const run = document.querySelector('[data-verify-run="t5"]').getBoundingClientRect(); return c.top >= 0 && run.bottom <= innerHeight; })()`), true);
    await shot(only + '-small.png');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await until(`!document.querySelector('.host.sliding, .host.anim')`);
    await shot(only + '.png');
    await ev(`document.querySelector('[data-verify-run="t5"]').click()`);
    await until(`window.__calls.filter(([c]) => c === 'orchestration_approve_verify').length > ${before}`);
    check('F4 검증 실행 — 지금 확인한 고정 묶음만', (await calls('orchestration_approve_verify')).slice(-1)[0], { runId: detail.runId, jobId: 'j5', candidate: 'new-candidate', commandSha: 'sha', old: detail.integration.expectedHead });
    await album();
  }
}
