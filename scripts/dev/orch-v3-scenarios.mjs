// F1~F4 UI 시나리오. 모든 명령은 orch-tab-harness의 메모리 스텁으로만 간다.
import { runTrackV3 } from './orch-v3-track.mjs';
import { albumScreenLayout, albumSideLayout, compactAlbumHead } from './orch-album-layout.mjs';

const noAlbumGap = async (h, label) => {
  // fork는 다른 탭에서 돌아온다. DOM 존재와 탭 슬라이드 종료는 별개다.
  // 원하는 기하가 될 때까지 재시도하지 않고, 움직임이 끝난 뒤 한 번만 잰다.
  if (!await h.until(`!document.querySelector('.host.sliding, .host.anim')`)) {
    await h.shot(label + '-layout-timeout.png');
    throw new Error(label + ': 앨범 배치 애니메이션 종료 시간 초과');
  }
  await h.ev(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
  const result = await h.ev(`(${albumScreenLayout.toString()})()`);
  h.check('앨범 화면 왼쪽 빈 자리 없음 — ' + label, result?.ok, true);
  if (!result?.ok) console.log('앨범 배치 진단 ' + JSON.stringify(result));
};
export const ALBUM_PERMISSION_STUB = String.raw`
      if (cmd === 'orchestration_album_widen' || cmd === 'orchestration_album_set') return (async () => {
        if (cmd === 'orchestration_album_widen' && window.__AYNX_REMOTE__) {
          const ticket = await window.__AYNX_REMOTE_UI__.reauth({ cmd, hasMaster: true, submit: async password => password === 'harness' ? { status: 200, data: { ticket: 'fake-ticket' } } : { status: 401, data: {} } });
          if (ticket !== 'fake-ticket') throw new Error('cancelled');
          window.__reauthTickets = (window.__reauthTickets ?? 0) + 1;
        }
        const d = window.__details[args.runId]; const old = d.album; const n = args.next;
        if (window.__permFailure) {
          const word = window.__permFailure; window.__permFailure = null;
          if (word === 'album-changed') { old.rev++; old.wakeMax = 17; d.latestSeq++; }
          throw new Error('[' + word + '] 서버 내부 상세');
        }
        if (args.expectRev !== old.rev) throw new Error('[album-changed]');
        const rank = { read: 0, edit: 1, full: 2 };
        const widened = n.members.some(m => { const o = old.members.find(o => o.artist === m.artist); return o ? rank[m.grade] > rank[o.grade] || m.allowedCommands.some(c => !o.allowedCommands.includes(c)) : m.grade !== 'read' || m.allowedCommands.length > 0; })
          || (!old.verifyAuto && n.verifyAuto) || (!old.planTools && n.planTools) || n.wakeMax > old.wakeMax || n.accept.maxRework > old.accept.maxRework
          || old.accept.require.some(o => !n.accept.require.some(r => r.role === o.role && r.passes >= o.passes));
        if (widened && cmd === 'orchestration_album_set') throw new Error('[widens]');
        const risky = n.verifyAuto || n.planTools || n.members.some(m => m.grade === 'full');
        const newRisk = (!old.verifyAuto && n.verifyAuto) || (!old.planTools && n.planTools) || n.members.some(m => m.grade === 'full' && !old.members.some(o => o.artist === m.artist && o.grade === 'full'));
        if (risky && (newRisk || old.riskConfirmedAt == null) && !args.riskConfirmed) throw new Error('[risk-not-confirmed]');
        d.album = { ...n, rev: old.rev + 1, changedAt: Date.now(), riskConfirmedAt: args.riskConfirmed ? Date.now() : old.riskConfirmedAt,
          members: n.members.map(m => ({ ...m, name: answers.orchestration_artist_list.find(a => a.id === m.artist)?.name, joinedRev: old.members.find(o => o.artist === m.artist)?.joinedRev ?? old.rev + 1 })) };
        d.latestSeq++; window.__emit('orchestration-changed', { runId: d.runId, seq: d.latestSeq });
        return { runId: d.runId, rev: d.album.rev, widened, latestSeq: d.latestSeq };
      })();
`;
export async function runOrchV3(h, only) {
  const { tabState, orchMod, tabsMod, check, shot, calls, squareButtons, DETAIL } = h;
  // 빈 목록의 every() 성공이나 무시된 until(false)가 후속 실패를 가리지 않게 준비 실패에서 멈춘다.
  const ev = async (expr) => {
    const value = await h.ev(expr);
    if (typeof value === 'string' && value.startsWith('EXC ')) throw new Error(`${only}: ${value}\n${expr}`);
    return value;
  };
  const until = async (expr) => {
    if (!await h.until(expr)) {
      const diagnostic = await h.ev(`({ rows: [...document.querySelectorAll('.pane-box:not(.hidden) [data-orch-recent-row]')].map(e => e.dataset.orchRecentRow), snapshot: window.__answers?.orchestration_snapshot?.map(r => r.runId), calls: window.__calls?.slice(-12).map(([cmd]) => cmd), text: document.querySelector('.pane-box:not(.hidden) [data-run-board]')?.textContent?.slice(0, 1200) })`);
      await shot(only + '-timeout.png');
      throw new Error(`${only}: 준비 조건 시간 초과: ${expr}\n현재 탭: ${JSON.stringify(await tabState())}\n화면/스텁: ${JSON.stringify(diagnostic)}`);
    }
    return true;
  };
  const H = '.pane-box:not(.hidden):not(.leaving)';
  const q = (selector) => `${H} ${selector}`;
  const click = async (selector) => ev(`document.querySelector(${JSON.stringify(q(selector))}).click()`);
  const input = async (selector, value) => ev(`(() => { const e = document.querySelector(${JSON.stringify(q(selector))}); e.value = ${JSON.stringify(value)}; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const idleBar = async (view) => check(`F2-c: ${view} 빈 막대는 꺼진 회색 ▶`, await ev(`(() => {
    const bar = document.querySelector('.orch-strip:not(.hidden)'); const b = bar?.querySelector('[data-orch-bar-action="start"]');
    return !!b && b.disabled && !!b.querySelector('svg path') && !b.querySelector('svg rect') && b.classList.contains('idle') && parseFloat(getComputedStyle(b).opacity) < 1 && !bar.querySelector('[data-orch-bar-action="pause"]');
  })()`), true);
  const route = async (path) => {
    await ev(`(async () => { const o = await ${orchMod}; const m = await ${tabsMod}; o.openOrchHome(); o.navigateOrchTab(m.activeTab().id, ${JSON.stringify(path)}); })()`);
    // 원격 경로는 이 페이지의 albumScreens에 있다. 집 PC 거울의 tab.orch는 그대로다.
    await until(`(async () => { const t = (await ${tabsMod}).activeTab(); const s = await ${h.importApp('app/album-screen.svelte.ts')}; return !!t && JSON.stringify(s.orchScreenPath(t)) === ${JSON.stringify(JSON.stringify(path))}; })()`);
  };
  const sum = (runId, name, state, repo) => ({ ...DETAIL, runId, name, state, repo, taskCount: 0, taskStates: {}, attemptCount: 0, orphaned: false });
  const live = sum('run-v3-live', '이어지는 앨범', 'running', 'C:/work/api');
  const done = sum('run-v3-done', '끝난 앨범', 'done', 'C:/work/docs');
  const artist = { id: 'a-12345678', name: '구현가', icon: 'claude', cli: 'claude', kind: 'write', model: 'sonnet', effort: 'high', instructions: '작은 변경부터 검증하세요.' };
  await ev(`(() => { window.__answers.orchestration_artist_list = [${JSON.stringify(artist)}]; window.__answers.orchestration_snapshot = ${JSON.stringify([live, done])}; window.__details = { 'run-v3-live': ${JSON.stringify(live)}, 'run-v3-done': ${JSON.stringify(done)} }; })()`);
  await route({ view: 'library' });
  await until(`!!document.querySelector('${q('[data-library-artists]')}')`);
  // 설정 시나리오가 이미 빈 라이브러리를 열었다. 응답 객체 교체만으로는 로더가 다시 읽지 않는다.
  await click('[data-orch-filter="all"]');
  await ev(`window.__emit('orchestration-artists-changed', null); window.__emit('orchestration-changed', { runId: 'run-v3-live', seq: 2 })`);
  await until(`document.querySelectorAll('${q('[data-orch-recent-row]')}').length === 2`);

  if (['v3-new-album', 'v3-new-album-fail', 'v3-new-album-rich', 'v3-new-remote-reauth', 'v3-fork', 'v3-adopt'].includes(only)) {
    await runF2({ ...h, ev, until, click, input, route, q, artist, live, done, idleBar }, only);
    return;
  }
  if (['v3-album-perm', 'v3-album-perm-remote', 'v3-producer-lives', 'v3-producer-end', 'v3-album-done'].includes(only)) {
    await runF3({ ...h, ev, until, click, input, route, q, artist, live }, only);
    return;
  }

  if (['v3-track', 'v3-track-judge', 'v3-track-blocked', 'v3-track-verify-ask'].includes(only)) {
    await runTrackV3({ ...h, ev, until, click, input, route, q }, only);
    return;
  }

  if (only === 'v3-library') {
    await idleBar('라이브러리');
    await until(`document.querySelectorAll('${q('[data-orch-recent-row]')}').length === 2`);
    check('v3-library: 라이브러리는 플레이어 한 잎', [(await tabState()).orch, (await tabState()).leaves.map((p) => p.kind)], [{ view: 'library' }, ['run']]);
    await until(`document.querySelectorAll('${q('[data-library-artist]')}').length === 1`);
    check('v3-library: 아티스트 칸 머리의 [+ 새 아티스트] 알약 하나 · 관리 · 아래 점선 카드 없음 · 새 앨범 진입', await ev(`(() => { const a = document.querySelector('${q('[data-library-artists]')}'); const c = a.querySelectorAll('[data-artists-create]'); return [c.length, !!c[0]?.closest('header'), c[0]?.textContent.trim(), !!a.querySelector('[data-artists-manage]'), a.querySelectorAll('.card.add').length, document.querySelector('${q('[data-library-new-album]')}')?.disabled]; })()`), [1, true, '새 아티스트', false, 0, false]);
    check('v3-library: 스튜디오 카드는 목록에서 수집', await ev(`[...document.querySelectorAll('${q('[data-library-repo]')}')].map((e) => e.dataset.libraryRepo)`), ['C:/work/api', 'C:/work/docs']);
    check('v3-library: 카드의 재생 표시 = 산 앨범이 있는 스튜디오만', await ev(`[...document.querySelectorAll('${q('[data-library-repo]')}')].map((e) => [e.dataset.libraryRepo, e.hasAttribute('data-studio-live'), !!e.querySelector('[data-eq="playing"]')])`), [['C:/work/api', true, true], ['C:/work/docs', false, false]]);
    check('v3-library: 앨범 줄 작은 글에 스튜디오 이름 · 따로 저장소 칸 없음', await ev(`[document.querySelector('${q('[data-orch-recent-row="run-v3-done"] small')}')?.textContent.startsWith('docs · '), !!document.querySelector('${q('[data-orch-recent-row] .repo')}')]`), [true, false]);
    // 카드 → 스튜디오 화면(걸러지기만 하지 않는다) · 빵부스러기 · 머리 · 범위
    await click('[data-library-repo="C:/work/docs"]');
    await until(`!!document.querySelector('${q('[data-studio-head]')}')`);
    check('v3-studio: 경로 · 한 잎', [(await tabState()).orch, (await tabState()).leaves.map((p) => p.kind)], [{ view: 'studio', repo: 'C:/work/docs' }, ['run']]);
    check('v3-studio: 빵부스러기 라이브러리 › docs · 카드 칸 없음 · 그 스튜디오 앨범만 · 작은 글에 이름 없음', await ev(`[document.querySelector('${q('[data-orch-crumb="studio"]')}')?.textContent, !!document.querySelector('${q('[data-library-repos]')}'), [...document.querySelectorAll('${q('[data-orch-recent-row]')}')].map((e) => e.dataset.orchRecentRow), document.querySelector('${q('[data-orch-recent-row] small')}')?.textContent.includes('docs')]`), ['docs', false, ['run-v3-done'], false]);
    check('v3-studio: 머리 경로 · 수 · 진행 중 없으면 이어서 듣기 숨김', await ev(`[document.querySelector('${q('[data-studio-path]')}')?.textContent, document.querySelector('${q('[data-studio-summary]')}')?.textContent, !!document.querySelector('${q('[data-orch-continue]')}')]`), ['C:/work/docs', '앨범 1 · 진행 중 0', false]);
    check('v3-studio: 표지 104px · 판 가로 넘침 없음', await ev(`(() => { const c = document.querySelector('${q('.studio-cover')}').getBoundingClientRect(); const l = document.querySelector('${q('[data-orch-library]')}'); return [Math.round(c.width), Math.round(c.height), l.scrollWidth <= l.clientWidth + 1]; })()`), [104, 104, true]);
    await shot('v3-studio.png');
    // 스튜디오 경유 앨범: 빵부스러기 세 칸 · ← = 스튜디오
    await click('[data-orch-recent-row="run-v3-done"] .album-name');
    await until(`!!document.querySelector('${q('[data-orch-crumb="album"]')}')`);
    check('v3-studio: 앨범 경로에 출발 스튜디오', (await tabState()).orch, { view: 'album', runId: 'run-v3-done', fromRepo: 'C:/work/docs' });
    check('v3-studio: 앨범 빵부스러기 라이브러리 › docs › 앨범', await ev(`[...document.querySelectorAll('${q('[data-orch-crumb]')}')].map((e) => e.dataset.orchCrumb)`), ['library', 'studio', 'album']);
    await click('[data-orch-path="album"] [data-orch-back]');
    await until(`!!document.querySelector('${q('[data-studio-head]')}')`);
    check('v3-studio: 앨범 ← = 스튜디오', (await tabState()).orch, { view: 'studio', repo: 'C:/work/docs' });
    // [+ 새 앨범] 은 그 스튜디오를 골라 둔 채로
    await click('[data-library-new-album]');
    await until(`!!document.querySelector('${q('[data-new-selected-repo]')}')`);
    check('v3-studio: 새 앨범에 스튜디오가 골라져 있음', await ev(`document.querySelector('${q('[data-new-selected-repo]')}').textContent.trim()`), 'C:/work/docs');
    // 앨범이 하나도 없는 스튜디오(보관 · 삭제 뒤) — 라이브러리로 튕기지 않고 빈 문구만
    await route({ view: 'studio', repo: 'C:/work/gone' });
    await until(`!!document.querySelector('${q('[data-studio-empty]')}')`);
    check('v3-studio: 빈 스튜디오 = 머리 + 빈 문구만', await ev(`[(${JSON.stringify(q('[data-orch-filter]'))} && document.querySelectorAll(${JSON.stringify(q('[data-orch-filter]'))}).length), !!document.querySelector(${JSON.stringify(q('[data-orch-recent]'))}), !!document.querySelector(${JSON.stringify(q('[data-studio-head]'))})]`), [0, false, true]);
    check('v3-studio: 빈 스튜디오 경로 유지', (await tabState()).orch, { view: 'studio', repo: 'C:/work/gone' });
    await route({ view: 'studio', repo: 'C:/work/docs' });
    await until(`!!document.querySelector('${q('[data-studio-head]')}')`);
    await h.send('Emulation.setDeviceMetricsOverride', { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    check('v3-studio: 620px 가로 넘침 없음', await ev(`(() => { const el = document.querySelector(${JSON.stringify(q('[data-orch-home]'))}); return el.scrollWidth <= el.clientWidth + 1; })()`), true);
    await shot('v3-studio-620.png');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await click('[data-orch-back]');
    await until(`!!document.querySelector('${q('[data-library-repos]')}')`);
    check('v3-studio: 스튜디오 ← = 라이브러리', (await tabState()).orch, { view: 'library' });
    // 진행 중이면 그 필터에 앨범이 없는 스튜디오는 카드가 사라진다
    await click('[data-orch-filter="live"]');
    await until(`!document.querySelector('${q('[data-library-repo="C:/work/docs"]')}')`);
    await until(`document.querySelectorAll('${q('[data-orch-album]')}').length === 1`);
    await click('[data-orch-filter="all"]');
    check('v3-library: 직각 단추 없음', await squareButtons(), []);
    check('F1 다듬기: 표지 물음표·상태 목록점 없음', await ev(`[...document.querySelectorAll('${q('[data-orch-library]')}')].every(e => !e.textContent.includes('?') && !e.textContent.includes('•'))`), true);
    check('F1 다듬기: 안쪽 라이브러리는 글래스 판을 겹치지 않음', await ev(`!document.querySelector('${q('[data-orch-library]')}').classList.contains('glass-mid')`), true);
    // 목업 대조용 풍성한 판 — 아티스트 넷(작업형 · 검토형) · 이어서 듣기 둘(재생 · 이어받기) · 참여 얼굴 · 내보낸 브랜치.
    // latestSeq 를 올려 둬 뒤 시나리오의 준비(latestSeq 1)가 라이브러리 상세 캐시를 다시 읽게 한다.
    const crew = [artist, { ...artist, id: 'a-22222222', name: '수리공', icon: 'codex', cli: 'codex', model: '', effort: '' }, { ...artist, id: 'a-33333333', name: '검토자', icon: 'gpt', cli: 'codex', kind: 'judge', model: '', effort: '' }, { ...artist, id: 'a-44444444', name: '문서 정리가', icon: 'gemini', model: 'haiku', effort: '' }];
    const richLive = { ...live, latestSeq: 5, taskCount: 5, taskStates: { accepted: 1 }, running: { write: 1, judge: 0 }, album: { rev: 1, members: [{ artist: 'a-12345678', name: '구현가' }, { artist: 'a-22222222', name: '수리공' }], planTools: false } };
    const richPaused = { ...sum('run-v3-paused', '로그 형식 통일', 'paused', 'C:/work/api'), latestSeq: 5, taskCount: 3, coordinatorAttached: false, pauseReason: 'coordinator-exited', adoptable: { restore: true, autoResume: true, why: null }, running: { write: 0, judge: 0 }, album: { rev: 1, members: [{ artist: 'a-22222222', name: '수리공' }], planTools: false } };
    const richDone = { ...done, latestSeq: 5, taskCount: 4, running: { write: 0, judge: 0 }, integration: { exportedHead: 'abc1234', exportBranch: 'orch-7c1e-int' }, album: { rev: 1, members: [{ artist: 'a-44444444', name: '문서 정리가' }], planTools: false } };
    await ev(`(() => { window.__answers.orchestration_artist_list = ${JSON.stringify(crew)}; window.__answers.orchestration_snapshot = ${JSON.stringify([richLive, richPaused, richDone])}; Object.assign(window.__details, { 'run-v3-live': ${JSON.stringify(richLive)}, 'run-v3-paused': ${JSON.stringify(richPaused)}, 'run-v3-done': ${JSON.stringify(richDone)} }); window.__emit('orchestration-artists-changed', null); window.__emit('orchestration-changed', { runId: 'run-v3-live', seq: 5 }); })()`);
    await until(`document.querySelectorAll('${q('[data-library-artist]')}').length === 4 && document.querySelectorAll('${q('[data-orch-album]')}').length === 2`);
    check('v3-library: 필터가 맨 위 · 스튜디오 카드는 그 아래', await ev(`(() => { const a = document.querySelector('${q('[data-orch-filter="all"]')}').getBoundingClientRect(); const b = document.querySelector('${q('[data-library-repo="C:/work/api"]')}').getBoundingClientRect(); return b.top >= a.bottom; })()`), true);
    check('v3-library: 이어받기는 원형 ▶ 단추', await ev(`(() => { const b = document.querySelector('${q('[data-orch-adopt="run-v3-paused"]')}'); const r = b.getBoundingClientRect(); return [Math.round(r.width) === Math.round(r.height), !!b.getAttribute('aria-label')]; })()`), [true, true]);
    await shot('v3-library.png');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    check('v3-library: 620px 가로 넘침 없음', await ev(`(() => { const el = document.querySelector('${q('[data-orch-home]')}'); return el.scrollWidth <= el.clientWidth + 1; })()`), true);
    await shot('v3-library-620.png');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    // 아티스트 칸 접기 — 아바타만 있는 좁은 띠 · 툴팁 = 이름 · CLI · 종류 · 다시 그려도(화면 왕복) 접힘 기억 · 펼치면 카드
    const strip = `document.querySelector('${q('[data-library-artists]')}')`;
    check('아티스트 칸: 펼침 상태의 접기 단추', await ev(`(() => { const b = ${strip}.querySelector('[data-library-artists-toggle]'); return [b?.getAttribute('aria-expanded'), !!b?.title]; })()`), ['true', true]);
    await click('[data-library-artists-toggle]');
    await until(`${strip}.hasAttribute('data-collapsed')`);
    await new Promise((r) => setTimeout(r, 400));
    check('아티스트 칸: 접으면 아바타만(카드 · 안내 없음) · 원형 + 하나 · 관리 없음', await ev(`(() => { const a = ${strip}; return [a.querySelectorAll('[data-library-artist]').length, a.querySelectorAll('.card').length, !!a.querySelector('.lead'), a.querySelector('[data-artists-create]')?.textContent.trim(), !!a.querySelector('[data-artists-manage]'), a.querySelector('[data-library-artists-toggle]').getAttribute('aria-expanded')]; })()`), [4, 0, false, '', false, 'false']);
    check('아티스트 칸: 접힌 띠는 좁다(≤ 90px) · 툴팁에 이름 · CLI · 종류', await ev(`(() => { const a = ${strip}; return [a.getBoundingClientRect().width <= 90, a.querySelector('[data-library-artist="a-33333333"]').title]; })()`), [true, '검토자 · Codex · 검토형']);
    // 창마다 따로 — 키 = `aynx:orch:artists-collapsed:<창 라벨>`(창끼리 하나를 나눠 쓰던 옛 키는 없다)
    const collapsedKey = `(async () => 'aynx:orch:artists-collapsed:' + (await ${h.importApp('/lib/context.ts')}).currentWindowLabel())()`;
    const ownKey = await ev(collapsedKey);
    check('아티스트 칸: 접힘은 이 창 라벨의 키에만 남는다', await ev(`[localStorage.getItem(${JSON.stringify(ownKey)}), Object.keys(localStorage).filter(k => k.startsWith('aynx:orch:artists-collapsed')).length, localStorage.getItem('aynx:orch:artists-collapsed')]`), ['1', 1, null]);
    await shot('v3-library-collapsed.png');
    await click('[data-library-artist="a-33333333"]');
    await until(`!!document.querySelector('${q('[data-orch-artists]')}')`);
    await until(`document.querySelector('${q('[data-artist-name]')}')?.value === '검토자'`);
    check('아티스트 칸: 아바타를 누르면 아티스트 화면에서 그 아티스트를 고른다', await ev(`document.querySelector('${q('[data-artist-card="a-33333333"]')}')?.classList.contains('selected')`), true);
    await route({ view: 'library' });
    await until(`!!${strip}`);
    check('아티스트 칸: 다시 그려도 접힘 기억', await ev(`${strip}.hasAttribute('data-collapsed')`), true);
    await click('[data-library-artists-toggle]');
    await until(`!${strip}.hasAttribute('data-collapsed') && ${strip}.querySelectorAll('.card[data-library-artist]').length === 4`);
    // 다른 창이 접어 둔 키가 있어도 이 창은 펼친 채(그 키는 건드리지 않는다)
    await ev(`localStorage.setItem('aynx:orch:artists-collapsed:other-window', '1')`);
    await route({ view: 'artists' });
    await until(`!!document.querySelector('${q('[data-orch-artists]')}')`);
    await route({ view: 'library' });
    await until(`!!${strip}`);
    check('아티스트 칸: 다른 창의 접힘은 이 창에 번지지 않는다', await ev(`[${strip}.hasAttribute('data-collapsed'), localStorage.getItem('aynx:orch:artists-collapsed:other-window')]`), [false, '1']);
    await ev(`localStorage.removeItem('aynx:orch:artists-collapsed:other-window')`);
    check('아티스트 칸: 펼치면 카드 · 저장소 걷힘', await ev(`[localStorage.getItem(${JSON.stringify(ownKey)}), ${strip}.querySelector('[data-library-artists-toggle]').getAttribute('aria-expanded')]`), [null, 'true']);
  }

  if (only === 'v3-artists') {
    await click('[data-artists-create]');
    await until(`!!document.querySelector('${q('[data-orch-artists]')}')`);
    await idleBar('아티스트');
    check('v3-artists: 라이브러리 [+ 새 아티스트] → 새 아티스트 폼(빈 이름 · 고른 카드 없음)', await ev(`[document.querySelector('${q('[data-artist-name]')}')?.value, document.querySelectorAll('${q('[data-artist-card].selected')}').length]`), ['', 0]);
    await until(`!!document.querySelector('${q('[data-artist-card="a-12345678"]')}')`);
    await click('[data-artist-card="a-12345678"]');
    await until(`document.querySelector('${q('[data-artist-name]')}')?.value === '구현가' && document.querySelectorAll('${q('[data-artist-kind-choice]')}').length === 2`);
    check('F1 다듬기: 이름·모델·지침 입력 반지름 6px 이상', await ev(`[...document.querySelectorAll('${q('[data-artist-name]')}, ${q('[data-artist-model]')}, ${q('[data-artist-instructions]')}')].length === 3 && [...document.querySelectorAll('${q('[data-artist-name]')}, ${q('[data-artist-model]')}, ${q('[data-artist-instructions]')}')].every(e => parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 6)`), true);
    check('v3-artists: 기존 종류 잠김', await ev(`[...document.querySelectorAll('${q('[data-artist-kind-choice]')}')].every((e) => e.disabled)`), true);
    await input('[data-artist-name]', '개정 구현가');
    await click('[data-artist-save]');
    await until(`!!document.querySelector('${q('[data-artist-saved]')}')`);
    check('v3-artists: 저장 몸은 프로필만', (await calls('orchestration_artist_set')).slice(-1).map(({ input }) => [input.id, input.name, input.kind, 'permission' in input, 'allowedCommands' in input]), [['a-12345678', '개정 구현가', 'write', false, false]]);
    await ev(`window.__artistInUse = ['run-v3-live']`);
    await click('[data-artist-remove]');
    await until(`!!document.querySelector('${q('[data-artist-in-use]')}')`);
    check('v3-artists: 삭제 막힘은 앨범 이름', await ev(`document.querySelector('${q('[data-artist-in-use]')}').textContent.includes('이어지는 앨범')`), true);
    await ev(`window.__artistInUse = null`);
    await click('[data-artist-remove]');
    await until(`document.querySelectorAll('${q('[data-artist-card]')}').length === 0`);
    await click('[data-artist-new]');
    await until(`!!document.querySelector('${q('[data-artist-name]')}') && !document.querySelector('${q('[data-artist-name]')}').disabled`);
    await input('[data-artist-name]', '검토가');
    await click('[data-artist-kind-choice="judge"]');
    await input('[data-artist-instructions]', '가'.repeat(1366));
    check('v3-artists: 4 KiB 넘는 지침 저장 차단', await ev(`document.querySelector('${q('[data-artist-save]')}').disabled`), true);
    await input('[data-artist-instructions]', '변경을 검토하세요.');
    await click('[data-artist-save]');
    await until(`!!document.querySelector('${q('[data-artist-saved]')}')`);
    check('v3-artists: 새 검토형은 서버 id를 받는다', (await calls('orchestration_artist_set')).slice(-1).map(({ input }) => [input.kind, 'id' in input]), [['judge', false]]);
    await until(`!!document.querySelector('${q('[data-artist-card="a-11111111"]')}')`);
    check('v3-artists: 서버가 준 id로 저장됨', await ev(`document.querySelector('${q('[data-artist-card="a-11111111"]')}')?.classList.contains('selected')`), true);
    // 저장된 값과 다른 미저장 편집을 둬야 갱신이 폼을 덮는 회귀도 잡는다.
    await input('[data-artist-name]', '검토가 편집 중');
    await ev(`window.__answers.orchestration_artist_list.push({ ...${JSON.stringify(artist)}, id: 'a-87654321', name: '다른 창의 아티스트' }); window.__emit('orchestration-artists-changed', null)`);
    await until(`!!document.querySelector('${q('[data-artist-card="a-87654321"]')}')`);
    check('v3-artists: 목록 갱신은 편집 폼을 덮지 않음', await ev(`document.querySelector('${q('[data-artist-name]')}').value`), '검토가 편집 중');
    // 목업 대조용 — 작업형 · 검토형 섞인 격자
    await ev(`window.__answers.orchestration_artist_list.push({ ...${JSON.stringify(artist)}, id: 'a-22222222', name: '수리공', icon: 'codex', cli: 'codex', model: '', effort: '' }, { ...${JSON.stringify(artist)}, id: 'a-44444444', name: '문서 정리가', icon: 'gemini', model: 'haiku', effort: '' }); window.__emit('orchestration-artists-changed', null)`);
    await until(`document.querySelectorAll('${q('[data-artist-card]')}').length === 4`);
    check('v3-artists: 편집 판의 저장 단추가 화면 안', await ev(`(() => { const b = document.querySelector('${q('[data-artist-save]')}').getBoundingClientRect(); const f = document.querySelector('${q('[data-artist-editor]')}').getBoundingClientRect(); return b.bottom <= f.bottom + 1 && b.bottom <= innerHeight; })()`), true);
    // 고르기만 하면 [저장] 꺼짐 · 진짜 마우스로 연필을 눌러 연 뒤 Esc — 팝오버만 닫고 경로는 그대로(창의 Esc 사슬로 새지 않음)
    await click('[data-artist-card="a-22222222"]');
    await until(`document.querySelector('${q('[data-artist-name]')}')?.value === '수리공'`);
    check('v3-artists: 고르기만 한 기존 아티스트는 [저장] 꺼짐', await ev(`document.querySelector('${q('[data-artist-save]')}').disabled`), true);
    const pencilAt = await ev(`(() => { const r = document.querySelector('${q('[data-artist-icon-toggle]')}').getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    const mouseClick = async () => { for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased']) await h.send('Input.dispatchMouseEvent', { type, x: pencilAt[0], y: pencilAt[1], button: 'left', clickCount: 1 }); };
    const escape = async () => { for (const type of ['keyDown', 'keyUp']) await h.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }); await new Promise((r) => setTimeout(r, 200)); };
    const before = JSON.stringify((await tabState()).orch);
    await mouseClick();
    await until(`document.querySelectorAll('${q('[data-artist-icon]')}').length === 5`);
    check('v3-artists: 팝오버를 열면 아이콘에 포커스', await ev(`!!document.activeElement?.matches('[data-artist-icon]')`), true);
    // 실기(마우스 클릭 뒤 포커스가 연필에 남은 경우) 재현 — 포커스를 연필로 되돌린 채 Esc
    await ev(`document.querySelector('${q('[data-artist-icon-toggle]')}').focus()`);
    await escape();
    check('v3-artists: 연필에 포커스가 남은 채 Esc — 팝오버만 닫힘 · 경로 그대로', [await ev(`document.querySelectorAll('${q('[data-artist-icon]')}').length`), JSON.stringify((await tabState()).orch) === before, await ev(`!!document.querySelector('${q('[data-orch-artists]')}')`)], [0, true, true]);
    await mouseClick();
    await until(`document.querySelectorAll('${q('[data-artist-icon]')}').length === 5`);
    await escape();
    check('v3-artists: 팝오버 안 Esc — 닫고 포커스는 연필로 · 경로 그대로', [await ev(`document.querySelectorAll('${q('[data-artist-icon]')}').length`), await ev(`!!document.activeElement?.matches('[data-artist-icon-toggle]')`), JSON.stringify((await tabState()).orch) === before], [0, true, true]);
    // 실기(real/09 · 판 높이 ≈ 480px)처럼 낮은 창에서도 지침 칸까지는 스크롤 없이 보인다
    const instructionsFit = `(() => { const t = document.querySelector('${q('[data-artist-instructions]')}').getBoundingClientRect(); const b = document.querySelector('${q('[data-artist-editor] .body')}'); return t.bottom <= b.getBoundingClientRect().bottom + 1 && b.scrollTop === 0; })()`;
    check('v3-artists: 지침 칸이 편집 판 몸 안에 다 보인다', await ev(instructionsFit), true);
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 760, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    check('v3-artists: 낮은 창(760)에서도 지침 칸이 다 보인다', [await ev(instructionsFit), await ev(`Math.round(document.querySelector('${q('[data-artist-editor]')}').getBoundingClientRect().height) <= 520`)], [true, true]);
    await shot('v3-artists-760.png');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    await click('[data-artist-icon-toggle]');
    await until(`document.querySelectorAll('${q('[data-artist-icon]')}').length === 5`);
    await shot('v3-artists-icons.png');
    await click('[data-artist-icon="codex"]');
    check('v3-artists: 아바타 고르기 팝오버 — 고르면 닫힘', await ev(`document.querySelectorAll('${q('[data-artist-icon]')}').length`), 0);
    await shot('v3-artists.png');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
    await new Promise((r) => setTimeout(r, 300));
    check('v3-artists: 620px 가로 넘침 없음', await ev(`(() => { const el = document.querySelector('${q('[data-orch-artists]')}'); return el.scrollWidth <= el.clientWidth + 1; })()`), true);
    await shot('v3-artists-620.png');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
  }

  if (only === 'v3-nav-esc') {
    const original = await tabState();
    await ev(`(async () => (await ${orchMod}).openAlbumTab('run-v3-live'))()`);
    await until(`!!document.querySelector('${q('[data-album-head]')}')`);
    check('v3-nav-esc: 앨범 표지와 플레이어 주소 일치', [(await tabState()).orch, (await tabState()).leaves.find((p) => p.kind === 'run')?.run], [{ view: 'album', runId: 'run-v3-live' }, 'run-v3-live']);
    check('v3-nav-esc: 앨범은 같은 탭으로 이동', [(await tabState()).id, (await tabState()).count], [original.id, original.count]);
    await ev(`(async () => { const o = await ${orchMod}; const m = await ${tabsMod}; o.navigateOrchTab(m.activeTab().id, { view: 'track', runId: 'run-v3-live', taskId: 't1' }); })()`);
    await until(`!!document.querySelector('${q('[data-orch-crumb="track"]')}')`);
    await until(`(async () => (await ${tabsMod}).activeTab()?.orch?.view === 'track')()`);
    // DOM 입력칸이 이벤트를 받아도 경로를 빼앗지 않는다.
    await ev(`(() => { const root = document.querySelector('${q('[data-run-board]')}'); const el = document.createElement('input'); el.dataset.v3EscInput = ''; root.append(el); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); })()`);
    check('v3-nav-esc: 입력 포커스 보존', [(await tabState()).orch.view, await ev(`document.activeElement?.hasAttribute('data-v3-esc-input')`)], ['track', true]);
    for (const attrs of [{ contenteditable: 'true' }, { role: 'menu' }, { role: 'dialog' }]) {
      await ev(`(() => { const el = document.createElement('div'); for (const [k, v] of Object.entries(${JSON.stringify(attrs)})) el.setAttribute(k, v); el.tabIndex = 0; document.querySelector('${q('[data-run-board]')}').append(el); el.focus(); el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); el.remove(); })()`);
      check('v3-nav-esc: 편집·메뉴·모달 Esc 보존 ' + JSON.stringify(attrs), (await tabState()).orch.view, 'track');
    }
    await ev(`document.querySelector('[data-v3-esc-input]').remove(); document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Process', code: 'Escape', isComposing: true, bubbles: true }))`);
    check('v3-nav-esc: IME Esc는 이동하지 않음', (await tabState()).orch.view, 'track');
    await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
    await until(`(async () => (await ${tabsMod}).activeTab().orch.view === 'album')()`);
    await click('[data-album-new-tab]');
    await until(`(async () => (await ${tabsMod}).currentWorkspaceTabs().length === ${original.count + 1})()`);
    check('v3-nav-esc: 새 탭은 같은 앨범 경로', (await tabState()).orch, { view: 'album', runId: 'run-v3-live' });
    const copy = await tabState();
    await ev(`(async () => (await ${orchMod}).openAlbumTab('run-v3-live'))()`);
    check('v3-nav-esc: 같은 앨범이 다른 탭에 있어도 현재 탭 유지', (await tabState()).id, copy.id);
    await click('[data-orch-back]');
    await until(`!!document.querySelector('${q('[data-orch-library]')}')`);
    await click('[data-artists-create]');
    await until(`!!document.querySelector('${q('[data-orch-artists]')}')`);
    await ev(`document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
    await until(`!!document.querySelector('${q('[data-orch-library]')}')`);
    await click('[data-artists-create]');
    await until(`!!document.querySelector('${q('[data-orch-artists]')}')`);
    await click('[data-orch-crumb="library"]');
    await until(`!!document.querySelector('${q('[data-orch-library]')}')`);
    await ev(`(async () => { const m = await ${tabsMod}; m.activeTab().orch = { runId: '옛 표지' }; })()`);
    await until(`(async () => (await ${tabsMod}).activeTab().orch.view === 'library')()`);
    check('v3-nav-esc: 옛 표지는 라이브러리', (await tabState()).orch, { view: 'library' });
    await shot('v3-nav-esc.png');
  }
}

async function runF2(h, only) {
  const { ev, until, click, input, route, q, artist, live, done, calls, check, shot, tabState, orchMod, tabsMod, importApp, idleBar } = h;
  const first = '로그 회전 작업을 나눠 주세요.';
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const defaults = { members: [{ artist: artist.id, grade: 'edit', allowedCommands: [] }], accept: { require: [], maxRework: 3 }, producer: { cli: 'claude', model: 'haiku', effort: 'low' } };
  const seed = async () => {
    await ev(`(() => {
      window.__answers.projects_list = [
        { id: 'docs', name: '문서', path: 'C:/work/docs', host: null },
        { id: 'folder', name: '일반 폴더', path: 'C:/work/folder', host: null },
        { id: 'api', name: 'API', path: 'C:/work/api', host: null },
        { id: 'remote', name: '원격', path: '/srv/api', host: 'server' },
      ];
      window.__repoStatuses = { 'C:/work/api': { kind: 'ok' }, 'C:/work/docs': { kind: 'ok' }, 'C:/work/folder': { kind: 'notRepo' } };
      window.__answers.orchestration_artist_list = [${JSON.stringify(artist)}]; window.__answers.orchestration_album_defaults = ${JSON.stringify(defaults)};
      // adopt도 이 준비를 거친다. 완료 앨범을 지우면 상세 스텁의 옛 __detail로 떨어진다.
      window.__answers.orchestration_snapshot = ${JSON.stringify([live, done])}; window.__details = { 'run-v3-live': ${JSON.stringify(live)}, 'run-v3-done': ${JSON.stringify(done)} };
      window.__emit('projects-changed', null); window.__emit('orchestration-artists-changed', null); window.__emit('orchestration-changed', { runId: 'run-v3-live', seq: 2 });
    })()`);
    await until(`(async () => (await ${orchMod}).localProjects().length === 3)()`);
  };
  await seed();
  await ev(`(() => { window.__calls.length = 0; window.__albumFailure = null; window.__albumNotSent = false; window.__albumLostReply = false; window.__albumResults = {}; window.__forkNotRepo = false; })()`);
  async function draft() {
    await click('[data-library-new-album]');
    await until(`!!document.querySelector('${q('[data-new-album]')}')`);
    await until(`document.querySelectorAll('${q('[data-new-repo]')}').length === 2 && document.querySelector('${q('[data-new-model]')}')?.value === 'haiku'`);
    if (only === 'v3-new-album') {
      check('F2-c: 첫 말이 비어 있으면 시작 차단', await ev(`document.querySelector('${q('[data-new-start]')}').disabled`), true);
      check('F2-c: 저장소 묶음·제목 한 번, 경로 입력은 접힘', await ev(`(() => { const s = document.querySelector('${q('[data-new-repo-section]')}'); return [document.querySelectorAll('${q('[data-new-repo-section]')}').length, s.querySelectorAll('h3').length, !!s.querySelector('[data-new-repo-path]'), s.querySelector('[data-new-browse]').getAttribute('aria-expanded'), s.querySelectorAll('[data-new-selected-repo]').length]; })()`), [1, 1, false, 'false', 1]);
      check('F2-c: 로컬 git 프로젝트만, 지난 앨범 저장소 우선·기본 선택', await ev(`[ [...document.querySelectorAll('${q('[data-new-repo]')}')].map(e => e.dataset.newRepo), document.querySelector('${q('[data-new-repo][aria-pressed="true"]')}')?.dataset.newRepo, document.querySelector('${q('[data-new-selected-repo]')}').textContent.trim() ]`), [['C:/work/api', 'C:/work/docs'], 'C:/work/api', 'C:/work/api']);
      // 2절 설명 — 서버가 지난 앨범에서 왔다고 밝힐 때(fromLast)만 "지난번에 고른 구성"(씨앗 기본 구성에도 멤버가 있다)
      const artistsHint = `[...document.querySelectorAll('${q('[data-new-album] .hint')}')][1]?.textContent ?? ''`;
      check('새 앨범: 처음 쓰는 저장소는 "지난 구성" 문구 없음', await ev(`!(${artistsHint}).includes('지난번')`), true);
      await ev(`window.__albumDefaults = { 'C:/work/docs': { ...${JSON.stringify(defaults)}, fromLast: true } }`);
      await click('[data-new-repo="C:/work/docs"]');
      await until(`document.querySelector('${q('[data-new-selected-repo]')}')?.textContent.trim() === 'C:/work/docs' && document.querySelector('${q('[data-new-repo="C:/work/docs"]')}')?.matches(':enabled') === true`);
      await until(`(${artistsHint}).includes('지난번')`);
      check('새 앨범: fromLast 면 "지난 구성" 문구', await ev(`(${artistsHint}).includes('문서')`), true);
      await ev(`window.__albumDefaults = null`);
      // 4절 한도 · 기타 — A안(10-31 · ▶ 펼침 없음): 요약 줄 · [펼치기] 대신 작은 숫자 칸 격자가 늘 보인다(그 자리에서 고친다) · 화면에 details 없음
      check('새 앨범 4절: 접지 않음 — 한도 다섯 · 되돌림 · 깨움 칸과 작업안 도구가 늘 보임 · details 0', await ev(`(() => {
        const s = document.querySelector('${q('[data-new-limits-section]')}'); const shown = (e) => !!e && e.getBoundingClientRect().height > 0;
        return [s.querySelectorAll('[data-new-limit]').length, [...s.querySelectorAll('[data-new-limit], [data-new-rework], [data-new-wake], [data-new-plan-tools]')].every(shown), s.querySelector('h3')?.textContent.trim(),
          document.querySelectorAll('${q('[data-new-album] details')}, ${q('[data-new-album] summary')}').length];
      })()`), [5, true, '한도 · 기타', 0]);
      await ev(`document.querySelector('${q('[data-new-limits-section]')}').scrollIntoView({ block: 'center' })`);
      await sleep(200);
      await shot('v3-new-album-limits-open.png');
      await idleBar('초안');
      check('F2-c: 프로듀서 머리 알약·큰 제목 간격', await ev(`(() => { const head = document.querySelector('${q('[data-new-producer-head]')}'); const pill = head.querySelector('.draft-pill'); const title = document.querySelector('${q('[data-new-album] h2')}'); const body = title.parentElement.getBoundingClientRect(); const h = head.getBoundingClientRect(), r = title.getBoundingClientRect(); return [h.height > 0 && !!title.textContent.trim() && r.height > 0 && r.top >= body.top && r.bottom <= body.bottom, r.top - h.bottom >= 20, parseFloat(getComputedStyle(pill).borderTopLeftRadius) >= 20, parseFloat(getComputedStyle(head).fontSize) < parseFloat(getComputedStyle(title).fontSize)]; })()`), [true, true, true, true]);
      check('F2-c: 빵부스러기 › 양옆 같은 간격', await ev(`(() => { const sep = document.querySelector('${q('[data-orch-path="new"] .sep')}'); const a = sep.previousElementSibling.getBoundingClientRect(), b = sep.getBoundingClientRect(), c = sep.nextElementSibling.getBoundingClientRect(); return b.left - a.right >= 6 && Math.abs((b.left - a.right) - (c.left - b.right)) <= 1; })()`), true);
    }
    await click('[data-new-browse]');
    await until(`document.querySelector('${q('[data-new-browse]')}')?.getAttribute('aria-expanded') === 'true' && !!document.querySelector('${q('[data-new-repo-path]')}')`);
    await input('[data-new-repo-path]', 'C:/work/api');
    await until(`document.querySelector('${q('[data-new-repo-apply]')}')?.matches(':enabled') === true`);
    await click('[data-new-repo-apply]');
    await until(`document.querySelector('${q('[data-new-model]')}')?.value === 'haiku' && !document.querySelector('${q('[data-new-repo-path]')}') && document.querySelector('${q('[data-new-browse]')}')?.matches(':enabled') === true`);
    if (only === 'v3-new-album') {
      check('F2-c: 다른 경로 적용 뒤 한 줄·접힘', await ev(`[document.querySelector('${q('[data-new-selected-repo]')}').textContent.trim(), document.querySelector('${q('[data-new-browse]')}').getAttribute('aria-expanded')]`), ['C:/work/api', 'false']);
      // 다시 펼쳤다가 접어도 고른 저장소는 그대로이고 입력 줄은 한 벌뿐이다.
      await click('[data-new-browse]'); await until(`!!document.querySelector('${q('[data-new-repo-path]')}')`);
      await click('[data-new-browse]'); await until(`!document.querySelector('${q('[data-new-repo-path]')}')`);
      check('F2-c: 펼침 토글은 선택 경로 유지', await ev(`document.querySelector('${q('[data-new-selected-repo]')}').textContent.trim()`), 'C:/work/api');
    }
    await input('[data-new-first]', first);
    await until(`document.querySelector('${q('[data-new-start]')}')?.disabled === false`);
  }
  async function started() {
    await until(`!!document.querySelector('${q('[data-album-head]')}') && !!document.querySelector('${q('[data-producer-leaf] [data-flip-input]')}')`);
    const start = (await calls('producer_album_start')).slice(-1)[0].input;
    check(`${only}: 왼쪽 채팅은 시작 답의 chat`, await ev(`document.querySelector('${q('[data-producer-leaf]')}')?.dataset.producerLeaf`), start.chat);
    await noAlbumGap(h, only);
    return start;
  }

  if (only === 'v3-new-remote-reauth') {
    // 거울은 라이브러리 한 잎. 새 초안·시작 결과는 원격 창 메모리에만 보인다.
    await ev(`(async () => { const m = await ${tabsMod}; const sm = await ${importApp('mirror/snapshot.ts')}; const t = m.activeTab(); const ws = t.workspaceId ?? 'w1'; sessionStorage.setItem('h.mirror', JSON.stringify(sm.buildSnapshot({ source: 'home', workspace: { id: ws, name: 'W' }, tabs: [{ ...t, workspaceId: ws }], activeTabId: t.id, focusOf: () => null }))); sessionStorage.setItem('aynx-h-remote', '1'); })()`);
    try {
      await h.reloadBoot(h.send, h.ev);
      await until(`!!document.querySelector('${q('[data-library-new-album]')}')`); await seed(); await draft();
      const mirrorBefore = await tabState();
      await click('[data-new-start]');
      await until(`!!document.querySelector('[data-remote-reauth-what]')`);
      check('원격 시작: 읽기/편집 구성도 앨범 시작 재확인', await ev(`document.querySelector('[data-remote-reauth-what]').textContent`), '앨범 시작하기');
      await ev(`document.querySelector('[data-remote-reauth-cancel]').click()`);
      await until(`!!document.querySelector('${q('[data-new-error]')}')`);
      check('원격 취소: 초안·첫 말 유지', await ev(`document.querySelector('${q('[data-new-first]')}').value`), first);
      await click('[data-new-start]'); await until(`!!document.querySelector('[data-remote-reauth-what]')`);
      await ev(`(() => { const e = document.querySelector('[data-remote-reauth] input[type="password"]'); e.value = 'harness'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await ev(`document.querySelector('[data-remote-reauth-ok]').click()`); await started();
      check('원격: REAUTH 표를 거치고 _basic 호출 없음', [await ev(`window.__reauthTickets`), (await calls('producer_album_start_basic')).length], [1, 0]);
      check('원격: 집 PC 거울 명세를 고치지 않음', (await tabState()).orch, mirrorBefore.orch);
      await shot('v3-new-remote-reauth.png');
    } finally {
      await ev(`sessionStorage.removeItem('aynx-h-remote'); sessionStorage.removeItem('h.mirror'); sessionStorage.removeItem('h.pcchats')`);
      await h.reloadBoot(h.send, h.ev);
      check('F1-b: 원격 시나리오 뒤 로컬 복귀', await ev(`(async () => (await ${importApp('lib/ipc.ts')}).isRemote)()`), false);
    }
    return;
  }

  if (only === 'v3-adopt') {
    const paused = { ...live, state: 'paused', coordinatorAttached: false, pauseReason: 'coordinator-exited', adoptable: { restore: true, autoResume: true, why: null }, album: { rev: 4, members: [], planTools: false } };
    await route({ view: 'album', runId: 'run-v3-done' });
    await until(`!!document.querySelector('${q('[data-album-head][data-run-state-word="done"]')}')`);
    await noAlbumGap(h, '완료 앨범·채팅 없음');
    await ev(`window.__answers.orchestration_snapshot = [${JSON.stringify(paused)}]; window.__details['run-v3-live'] = ${JSON.stringify(paused)}; window.__emit('orchestration-changed', { runId: 'run-v3-live', seq: 2 })`);
    await route({ view: 'album', runId: 'run-v3-live' });
    await until(`!!document.querySelector('${q('[data-run-pause-action="adopt"]')}')`);
    await noAlbumGap(h, '이어받기 전·채팅 없음');
    await route({ view: 'library' }); await until(`!!document.querySelector('${q('[data-orch-adopt="run-v3-live"]')}')`);
    await click('[data-orch-adopt="run-v3-live"]'); await until(`!!document.querySelector('${q('[data-producer-leaf] [data-flip-input]')}')`);
    check('이어받기: adopt 모드 · 구성 쓰기 없음', [(await calls('producer_chat_open')).slice(-1)[0].mode, (await calls('producer_album_start')).length, (await calls('orchestration_album_widen')).length, (await calls('orchestration_album_set')).length], [{ kind: 'adopt', run: 'run-v3-live' }, 0, 0, 0]);
    check('이어받기: 앱은 문장을 채우기만', [(await calls('producer_chat_send')).length, await ev(`document.querySelector('${q('[data-flip-input]')}').value.includes('run-v3-live')`)], [0, true]);
    await shot('v3-adopt-library.png');
    await route({ view: 'library' }); await route({ view: 'album', runId: 'run-v3-live' });
    await until(`!!document.querySelector('${q('[data-run-pause-action="adopt"]')}')`); await click('[data-run-pause-action="adopt"]');
    await until(`!!document.querySelector('${q('[data-producer-leaf] [data-flip-input]')}')`);
    check('멈춤 띠도 같은 adopt 입구', (await calls('producer_chat_open')).slice(-1)[0].mode, { kind: 'adopt', run: 'run-v3-live' });
    await noAlbumGap(h, '이어받기 채팅');
    await shot('v3-adopt.png'); return;
  }

  if (only === 'v3-fork') {
    const conv = '0f0f0f0f-1111-4222-8333-444444444444';
    // 이미 열어 둔 일반 초안도 fork 진입에서 새 초안으로 교체되어야 한다.
    await draft(); await input('[data-new-first]', '이전 초안');
    await ev(`(async () => { const m = await ${tabsMod}; const s = await ${importApp('lib/session.ts')}; m.openInNewTab(s.newAiPane('claude', 'C:/work/api')); })()`);
    const source = await tabState(); const pane = source.leaves[0].id;
    await ev(`(async () => (await ${importApp('app/agent-sessions.svelte.ts')}).linkAgentSession(${JSON.stringify(pane)}, 'claude', ${JSON.stringify(conv)}))()`);
    await ev(`(async () => { window.__forkNotRepo = true; await (await ${orchMod}).forkIntoOrchestration(${JSON.stringify(pane)}); })()`);
    await until(`window.__calls.some(([c]) => c === 'producer_fork_probe')`);
    check('fork: 저장소 아님은 원래 타일 유지', (await tabState()).id, source.id);
    await ev(`window.__forkNotRepo = false; document.querySelector('[data-pane="${pane}"] [data-pane-head]').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 600, clientY: 100 }))`);
    await until(`[...document.querySelectorAll('[role="menuitem"]')].some(b => b.textContent.includes('오케스트레이션으로 이어 가기'))`);
    await ev(`[...document.querySelectorAll('[role="menuitem"]')].find(b => b.textContent.includes('오케스트레이션으로 이어 가기')).click()`);
    await until(`!!document.querySelector('${q('[data-new-repo-locked]')}') && document.querySelector('${q('[data-new-model]')}')?.value === 'haiku'`);
    check('fork: 초안에서 채팅을 열지 않음', (await calls('producer_chat_open')).length, 0);
    await until(`document.querySelectorAll('${q('[data-new-repo]')}').length === 2`);
    check('fork: 저장소 칩·다른 프로젝트 잠김, 경로 입력 없음', await ev(`[ [...document.querySelectorAll('${q('[data-new-repo]')}')].every(e => e.disabled), document.querySelector('${q('[data-new-browse]')}').disabled, !document.querySelector('${q('[data-new-repo-path]')}'), document.querySelector('${q('[data-new-selected-repo]')}').textContent.trim() ]`), [true, true, true, 'C:/work/api']);
    await input('[data-new-first]', first); await until(`document.querySelector('${q('[data-new-start]')}')?.disabled === false`);
    await click('[data-new-start]'); const start = await started();
    check('fork: 시작 몸에 원본 · 서버 저장소', [start.fork, start.repo], [{ agent: 'claude', conv }, 'C:/work/api']);
    await shot('v3-fork.png'); return;
  }

  await draft();
  check('초안: 서버 채팅·앨범 없음', [(await calls('producer_chat_open')).length, (await calls('producer_album_start')).length], [0, 0]);
  check('초안: 입력 반지름 6px 이상(제목 자리는 밑줄 입력)', await ev(`[...document.querySelectorAll('${q('[data-new-album] input:not([type="checkbox"]):not([data-new-name])')}, ${q('[data-new-album] textarea')}, ${q('[data-new-album] select')}')].every(e => parseFloat(getComputedStyle(e).borderTopLeftRadius) >= 6)`), true);
  if (only === 'v3-new-album-rich') {
    // 눈으로 보는 풍성한 초안(v3-all 밖) — 쓰기형 둘 · 판정형 하나 · 허용 명령 · 검증 명령 · 모델 칸 펼침.
    const fixer = { ...artist, id: 'a-22222222', name: '수리공', icon: 'codex', cli: 'codex', model: '' };
    const judge = { ...artist, id: 'a-33333333', name: '검토자', icon: 'codex', cli: 'codex', kind: 'judge', model: '' };
    await ev(`window.__answers.orchestration_artist_list = ${JSON.stringify([artist, fixer, judge])}; window.__emit('orchestration-artists-changed', null)`);
    await click('[data-new-add]'); await until(`!!document.querySelector('${q('[data-new-artist="a-22222222"]')}')`);
    await click('[data-new-artist="a-22222222"]'); await click('[data-new-add]'); await click('[data-new-artist="a-33333333"]');
    await click('[data-new-member="a-22222222"] [data-new-grade="read"]');
    for (const cmd of ['npm test', 'cargo test', 'git diff']) { await click('[data-new-member="a-12345678"] [data-new-command-add]'); await input('[data-new-command="a-12345678"]', cmd); await ev(`document.querySelector('${q('[data-new-command="a-12345678"]')}').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`); await ev(`document.activeElement?.blur()`); }
    await input('[data-new-verify-command]', 'npm test');
    await click('[data-new-cli="claude"]');
    check('풍성한 초안: 멤버 셋 · 명령 셋 · 판정형 통과 칸', await ev(`[document.querySelectorAll('${q('[data-new-member]')}').length, document.querySelectorAll('${q('[data-new-member="a-12345678"] .cmd:not(.add)')}').length, !!document.querySelector('${q('[data-new-passes="a-33333333"]')}')]`), [3, 3, true]);
    await shot('v3-new-album-rich.png');
    for (const width of [620, 390]) {
      await h.send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: false });
      await new Promise((r) => setTimeout(r, 300));
      check(`풍성한 초안: ${width}px 가로 넘침 없음`, await ev(`(() => { const el = document.querySelector('${q('[data-new-album]')}'); return el.scrollWidth <= el.clientWidth + 1; })()`), true);
      await shot(`v3-new-album-rich-${width}.png`);
    }
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false }); return;
  }
  if (only === 'v3-new-album-fail') {
    await shot('v3-new-album-blank.png');
    const failures = ['bad-args', 'risk-not-confirmed', 'widens', 'already-produced', 'not-a-repo', 'out-of-scope:repo', 'git-too-old', 'invalid-state', 'unknown-role', 'no-usable-artist', 'too-many-runs', 'integration-failed', 'producer-mcp-unavailable', 'spawn-failed', 'not-a-tile'];
    for (const word of failures) {
      const count = (await calls('producer_album_start')).length;
      await ev(`window.__albumFailure = ${JSON.stringify(word)}`); await click('[data-new-start]');
      await until(`window.__calls.filter(([c]) => c === 'producer_album_start').length === ${count + 1} && !!document.querySelector('${q('[data-new-error]')}') && document.querySelector('${q('[data-new-start]')}')?.disabled === false`);
      check('실패 문구·초안 유지: ' + word, await ev(`document.querySelector('${q('[data-new-first]')}').value === ${JSON.stringify(first)} && !document.querySelector('${q('[data-new-error]')}').textContent.includes('서버 내부 상세')`), true);
    }
    await shot('v3-new-album-error.png');
    check('실패 재시도 clientId 고정', new Set((await calls('producer_album_start')).map((a) => a.input.clientId)).size, 1);
    await input('[data-new-name]', '수정한 앨범');
    await ev(`window.__albumFailure = null; window.__albumNotSent = true; window.__albumLostReply = true`);
    await click('[data-new-start]'); await until(`document.querySelector('${q('[data-new-error]')}')?.textContent.includes('초안은 남아')`);
    check('수정하면 새 clientId', new Set((await calls('producer_album_start')).map((a) => a.input.clientId)).size, 2);
    await click('[data-new-start]'); await started();
    await until(`document.querySelector('${q('[data-flip-input]')}')?.value === ${JSON.stringify(first)}`);
    const n = (await calls('producer_album_start')).length;
    await click('[data-flip-send]'); await until(`window.__calls.some(([c]) => c === 'producer_chat_send')`);
    check('sent:false 재전송은 기존 채팅 send', [(await calls('producer_album_start')).length, (await calls('producer_chat_send')).slice(-1)[0].text], [n, first]);
    await shot('v3-new-album-fail.png'); return;
  }
  await input('[data-new-name]', '새 구성 앨범');
  await click('[data-new-grade="full"]');
  check('전부 자동은 위험 확인 전에 시작 차단', await ev(`document.querySelector('${q('[data-new-start]')}').disabled`), true);
  // A안(10-31 · ▶ 펼침 없음) — 위험 '자세히' 는 ⓘ 팝오버: 열면 말풍선에 전문 · aria 짝 · 포커스는 말풍선, Esc 로 닫히고 포커스는 ⓘ 로(화면은 그대로)
  await click('[data-new-risk] .info-toggle');
  await until(`getComputedStyle(document.querySelector('.note-pop[role="dialog"]') ?? document.body).visibility === 'visible' && !!document.querySelector('.note-pop')`);
  check('A안 ⓘ 팝오버 열림 — 위험 전문 · aria-expanded · aria-controls · 포커스 · details 0', await ev(`(() => { const b = document.querySelector('${q('[data-new-risk] .info-toggle')}'); const p = document.querySelector('.note-pop');
    return [b.getAttribute('aria-expanded'), b.getAttribute('aria-controls') === p.id, p.getAttribute('aria-label'), p.textContent.includes('샌드박스 없이'), document.activeElement === p, document.querySelectorAll('${q('[data-run-board] details')}').length]; })()`),
    ['true', true, '자세히', true, true, 0]);
  await shot('v3-info-popover.png');
  for (const type of ['keyDown', 'keyUp']) await h.send('Input.dispatchKeyEvent', { type, key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
  await until(`!document.querySelector('.note-pop')`);
  check('A안 ⓘ 팝오버 Esc — 닫힘 · 포커스 ⓘ 로 · 새 앨범 화면 그대로', await ev(`(() => { const b = document.querySelector('${q('[data-new-risk] .info-toggle')}'); return [b.getAttribute('aria-expanded'), document.activeElement === b, !!document.querySelector('${q('[data-new-album]')}')]; })()`), ['false', true, true]);
  await click('[data-new-risk] .info-toggle');
  await until(`!!document.querySelector('.note-pop')`);
  await ev(`document.querySelector('${q('[data-new-name]')}').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }))`);
  await until(`!document.querySelector('.note-pop')`);
  check('A안 ⓘ 팝오버 바깥 누르기 — 닫힘', await ev(`document.querySelector('${q('[data-new-risk] .info-toggle')}').getAttribute('aria-expanded')`), 'false');
  await click('[data-new-risk-confirm]'); await until(`document.querySelector('${q('[data-new-start]')}')?.disabled === false`);
  await shot('v3-new-album-draft.png'); await click('[data-new-start]'); const start = await started();
  check('새 앨범: 경로·위험 확인·첫 말', [(await tabState()).orch.view, start.album.riskConfirmed, start.text], ['album', true, first]);
  await click('[data-album-rename]'); await input('[data-album-name-input]', '사람이 바꾼 이름'); await click('[data-album-name-save]');
  await until(`document.querySelector('${q('[data-album-rename]')}')?.textContent.includes('사람이 바꾼 이름')`);
  check('앨범 이름은 사람 명령으로 변경', (await calls('orchestration_rename_album')).slice(-1)[0].name, '사람이 바꾼 이름');
  await shot('v3-new-album.png');
}

async function runF3(h, only) {
  const { ev, until, click, input, route, q, artist, live, calls, check, shot, tabState, orchMod, tabsMod, importApp } = h;
  const chat = 'pc-v3-album-lifetime';
  const config = { rev: 4, members: [{ artist: artist.id, name: artist.name, joinedRev: 1, grade: 'read', allowedCommands: [] }], accept: { require: [], maxRework: 3 }, verifyAuto: false, planTools: false, wakeMax: 30, changedAt: 1, riskConfirmedAt: null };
  const album = { ...live, latestSeq: 20, coordinatorChat: chat, coordinatorAttached: true, producers: [chat], running: { write: 0, judge: 0 }, tasks: [], attempts: [], album: config,
    verify: { command: 'npm test', timeoutMinutes: 10, autoRun: false } };
  const seed = async () => {
    await ev(`(() => {
      window.__answers.orchestration_artist_list = [${JSON.stringify(artist)}];
      window.__answers.orchestration_snapshot = [${JSON.stringify(album)}]; window.__details = { 'run-v3-live': ${JSON.stringify(album)} };
      window.__pcState.chats[${JSON.stringify(chat)}] = { cli: 'claude', model: 'haiku', effort: 'low', repo: 'C:/work/api', epoch: 3, conv: '0199aabb-0000-4000-8000-000000000001', run: 'run-v3-live' };
      window.__pcState.busy = false; window.__permFailure = null;
      // 사람이 끝내는 op의 서버 효과만 흉내 낸다. 원래 스텁은 구독 0에서도 chats를 보존한다.
      const prior = window.__pc;
      window.__pc = (cmd, a) => {
        if (cmd !== 'producer_chat_close' || a.chat !== ${JSON.stringify(chat)}) return prior(cmd, a);
        const d = window.__details['run-v3-live']; d.state = 'paused'; d.pauseReason = 'coordinator-exited'; d.coordinatorChat = null; d.coordinatorAttached = false; d.latestSeq++;
        delete window.__pcState.chats[a.chat]; (window.__pcState.gone ??= {})[a.chat] = { gone: 'closed', album: { runId: d.runId, state: d.state, adoptable: { restore: true, autoResume: true, why: null } } };
        window.__answers.orchestration_snapshot = [d]; window.__emit('orchestration-changed', { runId: d.runId, seq: d.latestSeq });
        return Promise.resolve(true);
      };
      window.__emit('orchestration-changed', { runId: 'run-v3-live', seq: 20 }); window.__emit('orchestration-artists-changed', null);
    })()`);
    await route({ view: 'album', runId: 'run-v3-live' });
    await until(`!!document.querySelector('${q('[data-album-permissions-open]')}') && !!document.querySelector('${q('[data-producer-face="' + chat + '"]')}')`);
  };
  const open = async () => { await click('[data-album-permissions-open]'); await until(`!!document.querySelector('${q('[data-perm-member]')}')`); };
  const grade = async value => click(`[data-perm-member="${artist.id}"] [data-perm-grade="${value}"]`);
  const applied = async () => until(`!document.querySelector('${q('[data-album-permissions]')}')`);
  const compactHead = async () => {
    // 패널·컨테이너 배치 갱신을 두 프레임 기다린다. 검사 결과를 until 조건으로 삼아 실패를 가리지 않는다.
    await ev(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    check('권한 패널: 제목 한 줄·머리 가로 넘침 없음·작은 표지·얼굴 안쪽', await ev(`(${compactAlbumHead.toString()})()`), [true, true, true, true]);
    await noAlbumGap(h, only);
    check('이름 바꾸기: 앱의 stroke 연필 SVG·접근 이름·기본 흐림', await ev(`(() => {
      const button = document.querySelector('${q('[data-album-rename]')}'); const icon = button.querySelector('.rename-icon');
      return [!!button.querySelector('svg path[stroke="currentColor"]'), button.getAttribute('aria-label')?.includes('이름 바꾸기') === true, parseFloat(getComputedStyle(icon).opacity) < 1];
    })()`), [true, true, true]);
  };

  if (only === 'v3-album-perm-remote') {
    // 로컬에서 먼저 같은 앨범/채팅에 붙은 뒤 그 명세와 서버 표를 원격 페이지로 넘긴다.
    await seed();
    check('원격 준비: 거울 잎과 서버 채팅 모두 존재', await ev(`(async () => {
      const t = (await ${tabsMod}).activeTab(); const o = await ${importApp('orchestration/orch-tab.ts')};
      return [o.producerLeafOf(t)?.producer?.chatId, !!window.__pcState.chats[${JSON.stringify(chat)}]];
    })()`), [chat, true]);
    await ev(`(async () => { const m = await ${tabsMod}; const sm = await ${importApp('mirror/snapshot.ts')}; const t = m.activeTab(); const ws = t.workspaceId ?? 'w1'; sessionStorage.setItem('h.mirror', JSON.stringify(sm.buildSnapshot({ source: 'home', workspace: { id: ws, name: 'W' }, tabs: [{ ...t, workspaceId: ws }], activeTabId: t.id, focusOf: () => null }))); sessionStorage.setItem('h.pcchats', JSON.stringify(window.__pcState.chats)); sessionStorage.setItem('aynx-h-remote', '1'); })()`);
    try {
      await h.reloadBoot(h.send, h.ev); await seed();
      check('원격 경로: 같은 채팅 재구독·새 open/close 없음', [
        (await calls('producer_chat_subscribe')).slice(-1)[0]?.chat,
        (await calls('producer_chat_open')).filter(a => a.chat === chat).length,
        (await calls('producer_chat_close')).filter(a => a.chat === chat).length,
      ], [chat, 0, 0]);
      // 실제 채팅 잎을 통해 원격에서 사람의 말도 보낼 수 있다(메모리 스텁).
      const sendN = (await calls('producer_chat_send')).length;
      await input('[data-producer-face] [data-flip-composer] textarea', '원격 권한 점검');
      await ev(`document.querySelector('${q('[data-producer-face] [data-flip-composer] textarea')}').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true, cancelable: true }))`);
      await until(`window.__calls.filter(([c]) => c === 'producer_chat_send').length > ${sendN}`);
      check('원격 프로듀서 채팅 보내기', (await calls('producer_chat_send')).slice(-1)[0]?.text, '원격 권한 점검');
      await open(); await compactHead();
      await grade('full'); await click('[data-perm-risk-confirm]'); await click('[data-perm-apply]');
      await until(`!!document.querySelector('[data-remote-reauth-what]')`);
      check('원격 권한 넓힘 REAUTH 이름', await ev(`document.querySelector('[data-remote-reauth-what]').textContent`), '앨범 권한 넓히기');
      await ev(`document.querySelector('[data-remote-reauth-cancel]').click()`); await until(`!!document.querySelector('${q('[data-perm-error]')}')`);
      check('원격 취소는 편집 보존', await ev(`document.querySelector('${q('[data-perm-grade="full"]')}').getAttribute('aria-pressed')`), 'true');
      await grade('read'); await input('[data-perm-wake]', '29'); await click('[data-perm-apply]'); await applied();
      check('원격 좁힘 set은 표 발급 없음', [(await calls('orchestration_album_set')).length, await ev(`window.__reauthTickets ?? 0`)], [1, 0]);
      await open(); await grade('full'); await click('[data-perm-risk-confirm]'); await click('[data-perm-apply]');
      await until(`!!document.querySelector('[data-remote-reauth-what]')`);
      await ev(`(() => { const e = document.querySelector('[data-remote-reauth] input[type="password"]'); e.value = 'harness'; e.dispatchEvent(new Event('input', { bubbles: true })); })()`);
      await ev(`document.querySelector('[data-remote-reauth-ok]').click()`);
      await applied(); check('원격 넓힘은 표 한 장', await ev(`window.__reauthTickets`), 1); await shot(only + '.png');
    } finally {
      await ev(`sessionStorage.removeItem('aynx-h-remote'); sessionStorage.removeItem('h.mirror'); sessionStorage.removeItem('h.pcchats')`);
      await h.reloadBoot(h.send, h.ev);
      check('F3 원격 뒤 로컬 복귀', await ev(`(async () => (await ${importApp('lib/ipc.ts')}).isRemote)()`), false);
    }
    return;
  }

  await seed();
  if (only === 'v3-producer-lives') {
    await until(`!!document.querySelector('${q('[data-producer-lifetime]')}') && !!document.querySelector('${q('[data-producer-face] [data-viewer-body]')}') && !document.querySelector('.host.sliding, .host.anim')`);
    await ev(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))`);
    check('F4 수명 안내는 채팅 본문과 같은 안쪽 여백', await ev(`(() => {
      const face = document.querySelector('${q('[data-producer-face]')}');
      const note = face.querySelector('[data-producer-lifetime]'); const fr = face.getBoundingClientRect(); const r = note.getBoundingClientRect();
      const n = getComputedStyle(note);
      return [parseFloat(n.paddingLeft) > 0, Math.abs((r.left - fr.left) - (fr.right - r.right)) < 1, r.left - fr.left >= 8, !!note.querySelector('svg') && !!note.querySelector('b')];
    })()`), [true, true, true, true]);
    const close0 = (await calls('producer_chat_close')).length;
    const unsub0 = (await calls('producer_chat_unsubscribe')).length;
    const tab = (await tabState()).id;
    await ev(`(async () => { const m = await ${tabsMod}; await m.closeTabAsked(${JSON.stringify(tab)}); })()`);
    await until(`window.__calls.filter(([c]) => c === 'producer_chat_unsubscribe').length > ${unsub0}`);
    check('탭 닫기는 확인 없이 구독만', [await ev(`!!document.querySelector('[data-confirm-dialog]')`), (await calls('producer_chat_close')).length - close0], [false, 0]);
    await ev(`(async () => (await ${orchMod}).openAlbumTab('run-v3-live'))()`);
    await until(`!!document.querySelector('${q('[data-producer-face="' + chat + '"]')}')`);
    check('다시 열면 같은 채팅·새 open 없음', [(await calls('producer_chat_subscribe')).slice(-1)[0].chat, (await calls('producer_chat_close')).length - close0, (await calls('producer_chat_open')).filter(a => a.chat === chat).length], [chat, 0, 0]);
    await noAlbumGap(h, '탭 다시 열기');
    await route({ view: 'library' });
    await until(`!!document.querySelector('${q('[data-library-producer-waiting]')}')`);
    await route({ view: 'album', runId: 'run-v3-live' }); await until(`!!document.querySelector('${q('[data-producer-face="' + chat + '"]')}')`);
    check('경로 이동도 서버 close 0', (await calls('producer_chat_close')).length - close0, 0);
    await noAlbumGap(h, '라이브러리 왕복');
    await shot(only + '.png'); return;
  }
  if (only === 'v3-album-done') {
    // 10-31 끝난 앨범(목업 V3AlbumDone · 채팅은 진행 중 앨범과 같은 왼쪽 자리) — 진행 중엔 왼쪽 채팅(회귀) · 끝나는 순간 잎 유지 ·
    // 다시 열면 전체 폭 · 머리 [프로듀서 대화 기록] + [⋯] 메뉴 · 마무리 카드 · 대화 기록 = 같은 폭 왼쪽 잎 · ✕ / Esc 로 걷힘 · 서버 open 0
    const leafBox = `(() => { const l = document.querySelector('${q('[data-producer-leaf]')}'); const b = l?.closest('.pane-box'); return b ? Math.round(b.getBoundingClientRect().width) : 0; })()`;
    const kinds = async () => (await tabState()).leaves.map((p) => p.kind);
    check('끝난 앨범 회귀: 진행 중 앨범은 왼쪽 프로듀서 채팅', await kinds(), ['producer', 'run']);
    const liveWidth = await ev(leafBox);
    const open0 = (await calls('producer_chat_open')).length;
    const conv = '0199aabb-0000-4000-8000-000000000001';
    // 앨범이 끝난다(서버: 쉬는 순간 채팅을 닫고 album-ended) — 마지막 어시스턴트 말이 기록에 있다
    await ev(`(() => {
      const d = window.__details['run-v3-live'];
      Object.assign(d, { state: 'done', endedAt: Date.now(), coordinatorChat: null, coordinatorAttached: false, latestSeq: d.latestSeq + 1,
        integration: { workRef: 'refs/aynx/orch/7c1e/int', exportBranch: 'orch-7c1e-int', baseCommit: 'aaaa1111bbbb', baseBranch: 'main', expectedHead: 'e41f0b7ccc', exportedHead: 'e41f0b7ccc' } });
      delete window.__pcState.chats[${JSON.stringify(chat)}];
      (window.__pcState.gone ??= {})[${JSON.stringify(chat)}] = { gone: 'album-ended', album: { runId: d.runId, state: 'done', adoptable: { restore: false, autoResume: false, why: 'ended' } } };
      window.__answers.agent_conversation_transcript = { items: [
        { role: 'user', text: 'README 의 TODO 네 개를 나눠서 처리해 줘.', truncated: false, images: 0, tool: null, at: Date.now() - 400000 },
        { role: 'assistant', text: '앨범을 열고 네 트랙으로 나눴습니다.', truncated: false, images: 0, tool: null, at: Date.now() - 390000 },
        { role: 'assistant', text: '**TODO 넷**을 트랙 넷으로 처리했고 모두 검토 통과 뒤 수락했습니다. 통합 브랜치 \`orch-7c1e-int\` 로 내보냈습니다 — main 병합은 [병합 명령 복사]로 하세요.', truncated: false, images: 0, tool: null, at: Date.now() - 60000 },
      ], cursor: null };
      window.__answers.orchestration_snapshot = [d]; window.__emit('orchestration-changed', { runId: d.runId, seq: d.latestSeq });
    })()`);
    await until(`document.querySelector('${q('[data-run-state]')}')?.closest('[data-album-head]')?.dataset.runStateWord === 'done' && !!document.querySelector('${q('[data-album-log]')}')`);
    check('끝나는 순간: 보던 채팅 잎은 걷지 않는다', await kinds(), ['producer', 'run']);
    await route({ view: 'library' });
    await route({ view: 'album', runId: 'run-v3-live' });
    await until(`!!document.querySelector('${q('[data-producer-finale]')}')`);
    await ev(`new Promise(resolve => setTimeout(resolve, 600))`);
    check('다시 열면: 채팅 잎 없이 플레이어 전체 폭', await kinds(), ['run']);
    // 목업 V3AlbumSideDone — 채팅 없는 끝난 앨범의 세부 칸은 트랙 화면과 같은 400 · 가운데 트랙 판에 마무리 카드 · 넓어서 진행 열 보임
    const doneSide = `(() => { const g = (${albumSideLayout.toString()})(); const f = document.querySelector('${q('[data-producer-finale]')}')?.getBoundingClientRect();
      return [g.side, Math.abs(g.w - 400) <= 4, g.cards, g.prog, !!f && f.right <= document.querySelector('${q('[data-album-side]')}').getBoundingClientRect().left]; })()`;
    check('끝난 앨범(채팅 없음) — 세부 칸 400 · 카드 둘 · 진행 열 보임 · 마무리 카드는 가운데 판', await ev(doneSide), [true, true, ['limits', 'timeline'], true, true]);
    check('끝난 앨범 머리: [프로듀서 대화 기록](헤드폰) · [⋯] 메뉴 · 권한 단추 없음 · 내보냄 칩', await ev(`(() => { const h = document.querySelector('${q('[data-album-head]')}'); const b = h.querySelector('[data-album-log]');
      return [!!b, !!b?.querySelector('svg'), !!h.querySelector('[data-album-menu]'), !!h.querySelector('[data-album-permissions-open]'), document.querySelector('${q('[data-integration-exported]')}')?.textContent.trim()]; })()`),
      [true, true, true, false, '내보냄 orch-7c1e-int']);
    check('마무리 카드: 마지막 어시스턴트 말 · 마크다운 걷음 · 앨범 완료 · [전체 대화 →]', await ev(`(() => { const c = document.querySelector('${q('[data-producer-finale]')}'); const t = c.querySelector('[data-producer-finale-text]').textContent;
      return [t.startsWith('TODO 넷을 트랙 넷으로'), t.includes('**'), c.textContent.includes('앨범 완료'), !!c.querySelector('[data-producer-finale-open]')]; })()`), [true, false, true, true]);
    await noAlbumGap(h, '끝난 앨범');
    await shot('v3-album-done.png');
    await click('[data-album-menu]');
    await until(`!!document.querySelector('[data-toolbar-menu]')`);
    check('[⋯] 메뉴: 대화 기록 · 새 탭 · 병합 명령 복사 · worktree 정리 · 앨범 정보', await ev(`[...document.querySelectorAll('[data-toolbar-menu] [data-menu-key]')].map((e) => e.dataset.menuKey + ':' + e.textContent.trim())`),
      ['log:프로듀서 대화 기록', 'newtab:새 탭으로 열기', 'merge:병합 명령 복사', 'cleanup:worktree 정리', 'info:앨범 정보']);
    await shot('v3-album-done-menu.png');
    await ev(`document.querySelector('[data-toolbar-menu] [data-menu-key="log"]').click()`);
    await until(`!!document.querySelector('${q('[data-producer-log-close]')}') && !document.querySelector('.host.sliding, .host.anim')`);
    await ev(`new Promise(resolve => setTimeout(resolve, 500))`);
    check('대화 기록: 왼쪽 잎 · 진행 중 채팅과 같은 폭 · 닫힘 줄 · 입력 칸 없음', await ev(`(() => { const f = document.querySelector('${q('[data-producer-face]')}');
      return [f?.dataset.producerFace, !!f?.querySelector('[data-producer-closed-foot]'), !!f?.querySelector('[data-flip-composer]')]; })()`), [chat, true, false]);
    check('대화 기록 폭 = 진행 중 채팅 폭', Math.abs((await ev(leafBox)) - liveWidth) <= 2 && liveWidth > 0, true);
    check('대화 기록이 서면 세부 칸은 채팅 있는 폭 360', await ev(`(() => { const g = (${albumSideLayout.toString()})(); return [g.side, Math.abs(g.w - 360) <= 4]; })()`), [true, true]);
    check('대화 기록 열기: 서버 producer_chat_open 0 · 이 채팅 구독만', [(await calls('producer_chat_open')).length - open0, (await calls('producer_chat_subscribe')).slice(-1)[0]?.chat], [0, chat]);
    await shot('v3-album-done-chat.png');
    // 좁은 잎(620 창 · 잎 약 216) — ✕ 는 제목과 같은 첫 줄에 남는다(부제는 말줄임 · 10-31 사용자 지적)
    await h.send('Emulation.setDeviceMetricsOverride', { width: 620, height: 900, deviceScaleFactor: 1, mobile: false });
    await ev(`new Promise(resolve => setTimeout(resolve, 400))`);
    check('좁은 대화 기록 잎: ✕ 가 제목 줄에 · 머리 밖으로 넘치지 않음', await ev(`(() => { const f = document.querySelector('${q('[data-producer-face]')}'); const x = f?.querySelector('[data-producer-log-close]')?.getBoundingClientRect(); const ti = f?.querySelector('.head .title')?.getBoundingClientRect(); const hd = f?.querySelector('.head')?.getBoundingClientRect();
      return !!(x && ti && hd) && [Math.abs((x.top + x.height / 2) - (ti.top + ti.height / 2)) <= 12, x.right <= hd.right + 1]; })()`), [true, true]);
    await shot('v3-album-done-chat-620.png');
    await h.send('Emulation.setDeviceMetricsOverride', { width: 1400, height: 900, deviceScaleFactor: 1, mobile: false });
    await ev(`new Promise(resolve => setTimeout(resolve, 400))`);
    await click('[data-producer-log-close]');
    await until(`!document.querySelector('${q('[data-producer-face]')}')`);
    check('✕: 잎을 걷어 다시 전체 폭 · 경로 그대로', [await kinds(), (await tabState()).orch], [['run'], { view: 'album', runId: 'run-v3-live' }]);
    await click('[data-producer-finale-open]');
    await until(`!!document.querySelector('${q('[data-producer-face]')}')`);
    await ev(`document.querySelector('${q('[data-producer-face]')}').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true, cancelable: true }))`);
    await until(`!document.querySelector('${q('[data-producer-face]')}')`);
    check('Esc(대화 기록 안): 잎만 걷고 경로는 앨범 그대로 · 서버 open 여전히 0', [await kinds(), (await tabState()).orch, (await calls('producer_chat_open')).length - open0], [['run'], { view: 'album', runId: 'run-v3-live' }, 0]);
    await ev(`(() => { delete window.__pcState.gone; window.__answers.agent_conversation_transcript = { items: [], cursor: null }; })()`);
    return;
  }
  if (only === 'v3-producer-end') {
    const before = (await calls('producer_chat_close')).length;
    await click('[data-producer-end]'); await until(`!!document.querySelector('[data-confirm-dialog]')`);
    check('끝내기 확인에 조율 멈춤·이어받기 안내', await ev(`(() => { const s = document.querySelector('[data-confirm-dialog]').textContent; return s.includes('조율 멈춤') && s.includes('새 프로듀서로 이어받기'); })()`), true);
    await ev(`document.querySelector('[data-confirm-choice="Cancel"]').click()`);
    check('취소는 close 없음', (await calls('producer_chat_close')).length, before);
    await click('[data-producer-end]'); await until(`!!document.querySelector('[data-confirm-dialog]')`);
    await ev(`document.querySelector('[data-confirm-choice="Ok"]').click()`);
    await until(`window.__details['run-v3-live'].pauseReason === 'coordinator-exited'`);
    check('끝내기 확인 후 기존 close 한 번', (await calls('producer_chat_close')).slice(before).map(a => a.chat), [chat]);
    await until(`document.querySelector('${q('[data-run-pause-band]')}')?.dataset.runPauseBand === 'coordinator'`);
    await noAlbumGap(h, '프로듀서 끝남');
    // 입력이 닫힌 채팅은 "말하면 이어집니다" 빈 문구를 쓰지 않는다(닫힘 줄과 어긋남 — 통합 10-31)
    const face = `document.querySelector('${q('[data-producer-face="' + chat + '"]')}')`;
    await until(`!!${face}?.querySelector('[data-producer-closed-foot]')`);
    check('프로듀서 끝남: 닫힘 줄 · 빈 문구는 닫힌 문구', await ev(`(() => { const f = ${face}; const e = f.querySelector('[data-viewer-empty]'); return [f.querySelector('[data-producer-closed-foot]').dataset.producerClosedFoot, !!f.querySelector('[data-flip-composer]'), e ? !e.textContent.includes('말하면') : true]; })()`), ['closed', false, true]);
    await shot(only + '.png'); return;
  }

  // 목업 V3AlbumSideLive(채팅 있음 · 1400) — 채팅 약 360(앨범 · 트랙 화면이 같은 분할) · 오른쪽 세부 칸 360 · 카드 둘 · 트랙 판이 좁아 진행 열 숨김 · 표 아래 칩/탭 없음
  const SIDE = `(${albumSideLayout.toString()})()`;
  const chatW = await ev(`(() => { const l = document.querySelector('${q('[data-producer-leaf]')}'); return Math.round(l?.closest('.pane-box')?.getBoundingClientRect().width ?? 0); })()`);
  check('세부 칸(1400 · 채팅 있음) — 채팅 340~380 · 세부 360 · 카드 둘 · 트랙 판 560 이상 · 진행 열 숨김 · 칩/탭 없음', await ev(`(() => { const g = ${SIDE};
    return [${chatW} >= 340 && ${chatW} <= 380, g.side, Math.abs(g.w - 360) <= 4, g.cards, g.center >= 560, g.prog, g.chips, g.tabs]; })()`), [true, true, true, ['limits', 'timeline'], true, false, false, false]);
  await shot('v3-album-side-chat.png');
  await open();
  // 권한 패널이 열리면 세부 칸 자리를 패널이 대신 차지한다(두 칸이 겹치지 않는다 · 표 아래 칩/탭으로 내려가지도 않는다)
  check('권한 패널 열림 — 세부 칸 대신 패널(판 오른쪽 끝) · 칩/탭 없음', await ev(`(() => { const g = ${SIDE}; return [g.panel, g.panelRight, g.side, g.chips, g.tabs]; })()`), [true, true, false, false, false]);
  await shot('v3-album-perm-side.png');
  // A안(10-31 · ▶ 펼침 없음) — 기타(작업안 도구 · 깨움 상한)는 늘 보이는 칸, 시작 때 고정된 한도는 늘 보이는 작은 칩 · 패널에 details 없음
  check('A안 앨범 권한 — 기타 칸 · 고정 한도 칩이 늘 보임 · details 0', await ev(`(() => { const p = document.querySelector('${q('[data-album-permissions]')}'); const shown = (e) => !!e && e.getBoundingClientRect().height > 0;
    return [shown(p.querySelector('[data-perm-plan-tools]')), shown(p.querySelector('[data-perm-wake]')), p.querySelectorAll('[data-perm-fixed] [data-perm-fixed-limit]').length, [...p.querySelectorAll('[data-perm-fixed-limit]')].every(shown), p.querySelectorAll('details, summary').length]; })()`),
    [true, true, 5, true, 0]);
  await ev(`document.querySelector('${q('[data-perm-fixed]')}').scrollIntoView({ block: 'center' })`);
  await shot('v3-album-perm-fold.png');
  await grade('edit');
  await compactHead();
  check('넓힘 거울과 바뀐 줄',await ev(`[document.querySelector('${q('[data-perm-mode]')}').dataset.permMode, !!document.querySelector('${q('[data-perm-changed]')}')]`), ['widen', true]);
  await shot('v3-album-perm-edit.png');
  await click('[data-perm-apply]'); await applied();
  check('권한 패널 닫힘 — 세부 칸이 돌아온다', await ev(`(() => { const g = ${SIDE}; return [g.panel, g.side, Math.abs(g.w - 360) <= 4]; })()`), [false, true, true]);
  check('넓힘은 widen', (await calls('orchestration_album_widen')).slice(-1)[0].expectRev, 4);
  await open(); await grade('read'); await click('[data-perm-apply]'); await applied();
  check('좁힘은 set', (await calls('orchestration_album_set')).slice(-1)[0].expectRev, 5);
  await open(); await grade('full');
  check('새 위험은 확인 전 적용 차단', await ev(`document.querySelector('${q('[data-perm-apply]')}')?.disabled`), true);
  await click('[data-perm-risk-confirm]'); await click('[data-perm-apply]'); await applied();
  check('위험 확인 몸', (await calls('orchestration_album_widen')).slice(-1)[0].riskConfirmed, true);
  await open(); await input('[data-perm-wake]', '29'); await ev(`window.__permFailure = 'album-changed'`); await click('[data-perm-apply]');
  await until(`document.querySelector('${q('[data-perm-error]')}')?.textContent.includes('다른 곳에서 바뀌었습니다') && document.querySelector('${q('[data-perm-wake]')}')?.value === '17'`);
  await input('[data-perm-wake]', '16'); await click('[data-perm-apply]'); await applied();
  check('충돌 뒤 새 rev로 재검토 적용', (await calls('orchestration_album_set')).slice(-1)[0].expectRev, 8);
  await open(); await input('[data-perm-wake]', '15'); await ev(`window.__permFailure = 'widens'`); await click('[data-perm-apply]');
  await until(`!!document.querySelector('${q('[data-perm-widen-confirm]')}')`);
  check('서버 widens면 넓힘 재질문', await ev(`document.querySelector('${q('[data-perm-apply]')}')?.disabled`), true);
  await click('[data-perm-widen-confirm] input'); await click('[data-perm-apply]'); await applied();
  check('서버 widens 뒤 widen 호출', (await calls('orchestration_album_widen')).slice(-1)[0].expectRev, 9);
  const next = (await calls('orchestration_album_widen')).slice(-1)[0].next;
  check('메타데이터·고정 칸 전송 없음', [Object.keys(next).sort(), Object.keys(next.members[0]).sort()], [['accept', 'members', 'planTools', 'verifyAuto', 'wakeMax'], ['allowedCommands', 'artist', 'grade']]);
  await shot(only + '.png');
}
