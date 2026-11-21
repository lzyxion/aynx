/**
 * 타일 머리줄 칩의 순서 · 켬끔. 칩 id 는 `settings.toml` 의 `[app] header_chip_order` · `header_chips_hidden` 에 글자 그대로 남는다 — 바꾸지 않는다.
 * 파일에는 끈 것을 적는다 — 나중에 늘어난 칩은 저절로 켬이다.
 */

/** 이 배열의 순서가 기본 순서다. `ai` 는 원격 호스트 단계 칩 · 쿼리 타일 DB AI 칩 · 로컬 타일의 눈 칩을 함께 켜고 끈다 */
export const HEADER_CHIP_IDS = ["folder", "branch", "jump", "tmux", "forward", "resource", "ai"] as const;

/**
 * 옛 `ai_read` 를 쓰던 때의 기본 순서 — 옮긴 결과가 이것과 같으면 "기본" 으로 접는다([`migrateLegacyChips`]).
 * 옛 id 가 없는 파일에는 쓰지 않는다 — 사용자가 일부러 이 순서로 옮겨 둔 것일 수 있다.
 */
const PREVIOUS_DEFAULT_ORDER = ["folder", "branch", "tmux", "jump", "forward", "ai", "resource"];

/** 옛 칩 id(`ai` 로 합침) — 읽을 때만 안다. 이 호환을 지우면 옛 설정 파일의 칩 순서 · 켬끔이 틀어진다 */
const LEGACY_AI_READ = "ai_read";

const trimmed = (v: unknown): unknown => (typeof v === "string" ? v.trim() : v);

/**
 * 순서: `ai` 가 있으면 그 자리가 이기고 `ai_read` 는 버린다. 켬끔: `ai` 는 둘 다 끈 칩이었을 때만 끈다 —
 * 단 옛 파일임이 드러날 때만(`ai_read` 가 어딘가 있을 때). 새 파일의 `hidden = ["ai"]` 와 글자가 같아 가를 수 없다.
 */
export function migrateLegacyChips(order: unknown, hidden: unknown): { order: unknown; hidden: unknown } {
  const orderList = Array.isArray(order) ? order.map(trimmed) : null;
  const hiddenList = Array.isArray(hidden) ? hidden.map(trimmed) : null;
  const legacyInOrder = orderList?.includes(LEGACY_AI_READ) ?? false;
  const legacyInHidden = hiddenList?.includes(LEGACY_AI_READ) ?? false;
  if (!legacyInOrder && !legacyInHidden) return { order, hidden };

  let nextOrder: unknown = order;
  if (orderList !== null) {
    nextOrder = orderList.includes("ai")
      ? orderList.filter((v) => v !== LEGACY_AI_READ)
      : orderList.map((v) => (v === LEGACY_AI_READ ? "ai" : v));
    if (legacyInOrder && sameList(normalizeChipOrder(nextOrder), PREVIOUS_DEFAULT_ORDER)) nextOrder = undefined;
  }

  let nextHidden: unknown = hidden;
  if (hiddenList !== null) {
    const bothOff = hiddenList.includes("ai") && legacyInHidden;
    const rest = hiddenList.filter((v) => v !== "ai" && v !== LEGACY_AI_READ);
    nextHidden = bothOff ? [...rest, "ai"] : rest;
  }
  return { order: nextOrder, hidden: nextHidden };
}

export type HeaderChipId = (typeof HEADER_CHIP_IDS)[number];

export function isHeaderChipId(v: unknown): v is HeaderChipId {
  return typeof v === "string" && (HEADER_CHIP_IDS as readonly string[]).includes(v);
}

function knownUnique(raw: unknown): HeaderChipId[] {
  if (!Array.isArray(raw)) return [];
  const out: HeaderChipId[] = [];
  for (const v of raw) {
    const id = typeof v === "string" ? v.trim() : v;
    if (isHeaderChipId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 순서에 빠진 id 는 기본 순서상 앞 이웃 바로 뒤에 끼운다 — 사용자가 옮겨 둔 칩들의 상대 순서는 그대로다 */
export function normalizeChipOrder(raw: unknown): HeaderChipId[] {
  const out = knownUnique(raw);
  HEADER_CHIP_IDS.forEach((id, i) => {
    if (out.includes(id)) return;
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.indexOf(HEADER_CHIP_IDS[j]);
      if (k >= 0) {
        at = k + 1;
        break;
      }
    }
    out.splice(at, 0, id);
  });
  return out;
}

/** 기본 순서대로 — 파일이 순서에 흔들리지 않게 */
export function normalizeChipHidden(raw: unknown): HeaderChipId[] {
  const set = knownUnique(raw);
  return HEADER_CHIP_IDS.filter((id) => set.includes(id));
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

export function isDefaultChipOrder(order: readonly string[]): boolean {
  return sameList(order, HEADER_CHIP_IDS);
}

/** 끝을 넘으면 같은 배열을 그대로 돌려준다 */
export function moveChip<T extends string>(order: readonly T[], id: T, delta: -1 | 1): readonly T[] {
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  next[i] = order[j];
  next[j] = order[i];
  return next;
}

/** `index` 는 나머지 사이의 자리(0..나머지 개수로 자른다) */
export function moveChipTo<T extends string>(order: readonly T[], id: T, index: number): T[] {
  const rest = order.filter((x) => x !== id);
  if (rest.length === order.length) return order.slice();
  rest.splice(Math.max(0, Math.min(rest.length, index)), 0, id);
  return rest;
}
