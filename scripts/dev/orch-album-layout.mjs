// CDP에서 문자열로 실행한다. CSS 레이아웃 px와 transform 이후의 화면 px를 섞지 않는다.
export function compactAlbumHead() {
  const head = document.querySelector('.pane-box:not(.hidden):not(.leaving) [data-album-head]');
  if (!head) return [false, false, false, false];
  const title = head.querySelector('.title-text');
  const cover = head.querySelector('.cover');
  const rect = head.getBoundingClientRect();
  const range = document.createRange();
  range.selectNodeContents(title);
  const lines = [...range.getClientRects()].filter(r => r.width > 0 && r.height > 0);
  // inline-flex의 줄 상자 높이는 글리프/아이콘보다 클 수 있다. 실제 텍스트 조각의 줄을 센다.
  const oneLine = lines.length > 0 && lines.every(r => Math.abs(r.top - lines[0].top) <= 1);
  const inside = [...head.querySelectorAll('.info, .name, .rename-title, .meta, .actions, .actions button')]
    .filter(e => e.getClientRects().length).every(e => {
      const r = e.getBoundingClientRect();
      return r.left >= rect.left - 1 && r.right <= rect.right + 1;
    });
  const hidden = getComputedStyle(cover).display === 'none';
  const size = getComputedStyle(cover);
  // 권한 패널이 열린 폭(목업 V3Album)은 104px 표지 그대로 — 그보다 크지만 않으면 된다
  const small = hidden || (parseFloat(size.width) <= 104.5 && parseFloat(size.height) <= 104.5);
  const cr = cover.getBoundingClientRect();
  const faces = [...cover.querySelectorAll('.face .avatar')];
  // overflow:hidden으로 잘라 숨기는 것만으로 통과하지 않는다. 원래 얼굴 전체가 네모 안이어야 한다.
  const contained = hidden || faces.every(e => {
    const r = e.getBoundingClientRect();
    return r.left >= cr.left - 0.5 && r.top >= cr.top - 0.5 && r.right <= cr.right + 0.5 && r.bottom <= cr.bottom + 0.5;
  });
  return [oneLine, head.scrollWidth <= head.clientWidth + 1 && inside, small, contained];
}

export function albumScreenLayout() {
  const board = document.querySelector('.pane-box:not(.hidden):not(.leaving) [data-run-board][data-run-id]:not([data-run-id=""])');
  if (!board) return { ok: false, why: 'no-album' };
  const player = board.closest('.pane-box');
  const host = player.closest('.host');
  const hr = host.getBoundingClientRect();
  const painted = e => {
    if (!e || !e.getClientRects().length) return false;
    for (let p = e; p && p !== host; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) < 0.95) return false;
      const fade = s.getPropertyValue('--tile-in').trim();
      if (fade && Number(fade) < 0.95) return false;
    }
    return true;
  };
  const panes = [...host.querySelectorAll('.pane-box')].filter(e => e.dataset.tab === player.dataset.tab && painted(e));
  const rects = panes.map(e => e.getBoundingClientRect()).sort((a, b) => a.left - b.left);
  const gaps = rects.map((r, i) => r.left - (i ? rects[i - 1].right : hr.left));
  if (rects.length) gaps.push(hr.right - rects[rects.length - 1].right);
  const leaves = [...panes.flatMap(e => [...e.querySelectorAll('[data-producer-leaf]')])];
  const chats = leaves.every(e => painted(e) && !!e.querySelector('[data-producer-face]') && !!e.textContent.trim());
  return { ok: rects.length > 0 && painted(player) && gaps.every(g => g >= -2 && g <= 18) && chats,
    gaps: gaps.map(g => Math.round(g)), producers: leaves.length };
}

// 앨범 판 세부의 배치(목업 V3AlbumSide*) — 넓으면 오른쪽 세부 칸(카드 둘), 좁으면 트랙 표 아래 칩 · [타임라인 | 한도] 탭.
// 돌려주는 것: side = 세부 칸이 보인다 · w = 그 폭 · clear = 칸 바탕 없음 · cards = 카드 순서 · fill = 타임라인 카드가 칸 아래까지 ·
// scroll = 타임라인은 카드 안쪽만 구른다 · tabs / chips = 트랙 표 아래 탭 줄 · 칩이 보인다 · prog = 트랙 표 진행 열(열 머리 — 줄과 같은 문턱)이 보인다 ·
// center = 가운데 트랙 판 폭 · panel = 앨범 권한 패널이 보인다 · panelRight = 패널이 판 오른쪽 끝에 붙었다
export function albumSideLayout() {
  const b = document.querySelector('.pane-box:not(.hidden):not(.leaving) [data-run-board][data-run-id]:not([data-run-id=""])');
  if (!b) return null;
  const shown = (e) => !!e && e.getClientRects().length > 0 && e.getBoundingClientRect().height > 0 && e.getBoundingClientRect().width > 0;
  const side = b.querySelector('[data-album-side]');
  const panel = b.querySelector('[data-album-permissions]') ?? b.querySelector('.album-body > .panel');
  const center = b.querySelector('.album-content').getBoundingClientRect();
  const br = b.getBoundingClientRect();
  const out = {
    side: shown(side), tabs: shown(b.querySelector('[role="tablist"][aria-label="앨범 보기"]')), chips: shown(b.querySelector('[data-run-limit-chips]')),
    prog: shown(b.querySelector('.cols .c-prog')), center: Math.round(center.width), panel: shown(panel),
    panelRight: shown(panel) ? Math.abs(panel.getBoundingClientRect().right - br.right) <= 2 : null,
  };
  if (!out.side) return out;
  const sr = side.getBoundingClientRect();
  const bg = getComputedStyle(side).backgroundColor;
  const tl = side.querySelector('[data-album-side-card="timeline"]');
  const tr = tl.getBoundingClientRect();
  const sc = tl.querySelector('.side-scroll');
  return { ...out, w: Math.round(sr.width), clear: bg === 'transparent' || bg.replace(/\s/g, '').endsWith(',0)'),
    cards: [...side.querySelectorAll('[data-album-side-card]')].map((c) => c.dataset.albumSideCard),
    fill: Math.abs(tr.bottom - sr.bottom) <= 2, scroll: getComputedStyle(sc).overflowY === 'auto' && tr.height <= sr.height + 1,
    head: [...side.querySelectorAll('[data-album-side-card] h3')].map((h) => [...h.childNodes].map((n) => n.textContent.trim()).join(' ').replace(/\d+/g, 'n')),
    right: sr.left >= center.right };
}
