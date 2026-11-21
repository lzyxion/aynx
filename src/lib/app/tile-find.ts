// 타일 안 찾기의 문 — 키 id 는 `find` 하나로 둔다: 새 id 를 만들면 사용자가 `find` 에 다시 묶은 조합이 어떤 타일에서만 안 먹는다.
// 여는 함수가 `false` 면 부르는 쪽이 터미널 검색으로 떨어진다.

const openers = new Map<string, () => boolean>();

/** 같은 함수가 아직 적혀 있을 때만 푼다 */
export function registerTileFind(paneId: string, open: () => boolean): () => void {
  openers.set(paneId, open);
  return () => {
    if (openers.get(paneId) === open) openers.delete(paneId);
  };
}

export function openTileFind(paneId: string): boolean {
  return openers.get(paneId)?.() ?? false;
}

export const FIND_ZONE_ATTR = "data-find-zone";

/** 시험이 흉내 낼 수 있는 만큼만 */
interface ZoneBox {
  matches(selector: string): boolean;
  querySelector(selector: string): unknown;
}

const zones = new WeakMap<object, () => boolean>();

export function registerFindZone(el: object, open: () => boolean): () => void {
  zones.set(el, open);
  return () => {
    if (zones.get(el) === open) zones.delete(el);
  };
}

export function openFindZoneIn(box: ZoneBox): boolean {
  const sel = `[${FIND_ZONE_ATTR}]`;
  const el = box.matches(sel) ? box : box.querySelector(sel);
  if (!el || typeof el !== "object") return false;
  return zones.get(el)?.() ?? false;
}
