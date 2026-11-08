// **타일 안 찾기의 문** — `find` 액션(`Ctrl+F` · 팔레트)이 **포커스된 타일에 제 찾기가 있으면** 여기로 온다
// (`app/keys.svelte.ts` 의 `case "find"`, 2026-10-19 사용자 결정). 키 id 는 그대로 `find` 하나다 — 새 id 를 만들면
// settings.toml 에 줄이 늘고, 사용자가 `find` 를 다시 묶어 둔 조합이 어떤 타일에서만 안 먹는다. 갈래는 **타일 종류**이고, 그
// 판정은 타일 자신이 한다: 각 타일 컴포넌트가 제 타일 id 로 여는 함수를 적어 두고(`registerTileFind`), 액션은 그 함수를 부른다.
//
// - 문서 타일(`DocView`) — 문서 안 찾기 띠(편집 중이면 편집기의 검색 패널)
// - AI 타일(`pane/AiFlip`) — **대화 면일 때만** 대화 기록 안 찾기 띠(터미널 면이면 `false` — 아래 터미널 검색)
// - 파일 타일(`SftpBrowser`) — 이름 거르기 줄(`files-filter` 와 같은 일)
// - diff 타일(`DiffView`) — 펼친 패치 안 찾기 띠
// - 쿼리 타일(`QueryView`) — 포커스가 결과 칸이면 그 결과 표 찾기(아래 "찾기 자리"), 아니면 스키마 트리 거르기 칸
//
// 함수가 `false` 면(적힌 함수가 없다 · 찾을 글이 없다) 예전 길로 떨어진다: 터미널 타일이면 그 터미널 범위 칩의 검색,
// 그 밖(브랜치 · 작업안 · 보드 · 시작 타일 · 포커스 타일 없음)이면 모든 터미널 검색이다.
//
// ## 찾기 자리 — 타일 안의 한 구역
//
// 한 타일 안에 찾기가 여럿일 수 있다(쿼리 타일의 결과 표는 문장마다 따로 그려지고 다시 실행하면 새로 선다). 그 구역은 제 뿌리
// 요소에 `data-find-zone` 을 달고 여는 함수를 요소에 묶어 둔다(`registerFindZone`). 타일의 여는 함수는 포커스가 든 상자 안의
// 구역을 연다(`openFindZoneIn`). 요소가 사라지면 묶음도 함께 사라진다(`WeakMap`).

const openers = new Map<string, () => boolean>();

/** 그 타일의 여는 함수를 적는다. 돌려준 함수로 푼다(같은 함수가 아직 적혀 있을 때만 지운다) */
export function registerTileFind(paneId: string, open: () => boolean): () => void {
  openers.set(paneId, open);
  return () => {
    if (openers.get(paneId) === open) openers.delete(paneId);
  };
}

/** 그 타일의 찾기를 연다 — 적힌 함수가 없거나 그 타일이 지금 찾을 것이 없으면 `false` */
export function openTileFind(paneId: string): boolean {
  return openers.get(paneId)?.() ?? false;
}

/** 찾기 자리가 다는 표식 */
export const FIND_ZONE_ATTR = "data-find-zone";

/** 요소 하나 — 시험이 흉내 낼 수 있는 만큼만 */
interface ZoneBox {
  matches(selector: string): boolean;
  querySelector(selector: string): unknown;
}

const zones = new WeakMap<object, () => boolean>();

/** 그 구역(뿌리 요소)의 여는 함수를 묶는다. 돌려준 함수로 푼다 */
export function registerFindZone(el: object, open: () => boolean): () => void {
  zones.set(el, open);
  return () => {
    if (zones.get(el) === open) zones.delete(el);
  };
}

/** 상자 자신 또는 그 안의 첫 찾기 자리를 연다 — 없거나 그 자리가 지금 찾을 것이 없으면 `false` */
export function openFindZoneIn(box: ZoneBox): boolean {
  const sel = `[${FIND_ZONE_ATTR}]`;
  const el = box.matches(sel) ? box : box.querySelector(sel);
  if (!el || typeof el !== "object") return false;
  return zones.get(el)?.() ?? false;
}
