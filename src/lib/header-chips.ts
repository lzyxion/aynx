/**
 * **타일 머리줄 칩의 순서 · 켬끔** (2026-10-18 — 설정 › 터미널 "타일 머리줄 칩", 목업 E5yfAAq5XawDLGCjhSAH4U).
 *
 * 칩 id 는 `settings.toml` 의 `[app] header_chip_order` · `header_chips_hidden` 에 적히는 값이라 **바꾸지 않는다**
 * (conventions 의 "id 는 안 바뀐다"). 파일에는 켠 것이 아니라 **끈 것**을 적는다 — 나중에 칩이 늘면 그 칩은 저절로 켬이다.
 *
 * 읽을 때의 규칙(`normalizeChipOrder`): 모르는 id 는 버리고 · 중복은 처음 것만 · 순서에 빠진 id 는 기본 순서상
 * **앞 이웃 바로 뒤**에 끼운다(앞 이웃이 하나도 없으면 맨 앞). 그래서 새 칩은 기본 자리 근처에 나타나고, 사용자가
 * 옮겨 둔 칩들의 상대 순서는 그대로다.
 *
 * **옛 id `ai_read`**(로컬 타일의 "AI 읽기" 칩 — 2026-10-18 ~ 10-23)는 `ai` 하나로 합쳤다(10-23 — 로컬 타일도 원격과 같은
 * AI 권한 칩 · 팝오버). 옛 파일은 [`migrateLegacyChips`] 가 읽을 때 옮기고, 다시 적지 않는다.
 *
 * 이 모듈은 아무것도 import 하지 않는다(설정 모델 · 머리줄 · 설정 화면이 함께 부른다).
 */

/**
 * 칩 id — 이 배열의 순서가 기본 순서다. `ai` 는 원격 호스트 단계 칩 · 쿼리 타일 DB AI 칩 · 로컬 타일의 AI 권한 칩(Off · Read —
 * 10-23, 옛 `ai_read`)을 함께 켜고 끈다.
 *
 * 기본 순서(10-23 사용자 결정): 폴더 → 브랜치 → 경유 → tmux → 포워딩 → 자원 → AI 권한. 경유가 tmux 앞(접속 경로 순서),
 * AI 권한은 끔이어도 늘 서는 칩이라 맨 끝 고정 자리. 그 전(10-18 ~ 10-23)의 기본은 [`PREVIOUS_DEFAULT_ORDER`].
 */
export const HEADER_CHIP_IDS = ["folder", "branch", "jump", "tmux", "forward", "resource", "ai"] as const;

/**
 * 10-18 ~ 10-23 의 기본 순서 — 옛 `ai_read` 파일을 옮긴 결과가 이것과 같으면 "기본" 으로 접는다([`migrateLegacyChips`]).
 * 앱은 기본과 같은 순서를 파일에 적지 않았으니, 옛 파일에서 이 순서가 나오는 것은 `ai_read` 하나만 옮겨 둔 경우뿐이다
 * (`ai` 의 자리가 이겨 `ai_read` 가 버려지면 나머지는 그때의 기본 그대로). 옛 id 가 없는 파일에는 쓰지 않는다 —
 * 지금 사용자가 일부러 이 순서로 옮겨 둔 것일 수 있다.
 */
const PREVIOUS_DEFAULT_ORDER = ["folder", "branch", "tmux", "jump", "forward", "ai", "resource"];

/** 옛 칩 id — 로컬 타일의 "AI 읽기" 칩(10-23 에 `ai` 로 합침). 읽을 때만 안다 */
const LEGACY_AI_READ = "ai_read";

const trimmed = (v: unknown): unknown => (typeof v === "string" ? v.trim() : v);

/**
 * **옛 `ai_read` 를 `ai` 로 옮긴다**(10-23) — 저장된 순서 · 끈 칩 둘을 함께 본다(켬끔은 둘을 합쳐야 정해진다).
 *
 * - 순서: `ai` 가 있으면 그 자리가 이기고 `ai_read` 는 버린다. 없으면 `ai_read` 의 자리에 `ai` 를 둔다. 옮긴 순서가
 *   그때의 기본([`PREVIOUS_DEFAULT_ORDER`])과 같으면 `undefined`(= 지금의 기본)로 접는다 — 고친 것이 `ai_read` 하나뿐이었다.
 * - 켬끔: 둘 중 하나라도 켜져 있었으면 켬 — `ai` 는 **둘 다** 끈 칩이었을 때만 끈다. 단 옛 파일임이 드러날 때만 이 규칙을 쓴다
 *   (끈 칩에 `ai_read` 가 있거나 순서에 `ai_read` 가 있을 때). 새 파일의 `hidden = ["ai"]` 와 옛 파일의 "원격 칩만 끔" 은 글자가
 *   같아 가를 수 없다 — 그때는 새 뜻(끔)으로 읽는다.
 *
 * 배열이 아닌 값은 그대로 돌려준다(뒤의 정규화가 기본으로 접는다). 모르는 id · 중복은 건드리지 않는다. **순수**
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

/** 아는 id 만 · 중복 없이 · 받은 순서대로 */
function knownUnique(raw: unknown): HeaderChipId[] {
  if (!Array.isArray(raw)) return [];
  const out: HeaderChipId[] = [];
  for (const v of raw) {
    const id = typeof v === "string" ? v.trim() : v;
    if (isHeaderChipId(id) && !out.includes(id)) out.push(id);
  }
  return out;
}

/** 저장된 순서 → **모든 칩이 한 번씩 든** 순서 (파일 머리말의 규칙). 배열이 아니면 기본 순서 */
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

/** 저장된 "끈 칩" → 아는 id 만 · 중복 없이 · 기본 순서대로(파일이 순서에 흔들리지 않게) */
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

/** 칩 하나를 이웃과 맞바꾼다(키보드 Alt+←/→) — 끝을 넘으면 같은 배열을 그대로 돌려준다 */
export function moveChip<T extends string>(order: readonly T[], id: T, delta: -1 | 1): readonly T[] {
  const i = order.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= order.length) return order;
  const next = order.slice();
  next[i] = order[j];
  next[j] = order[i];
  return next;
}

/** 칩 하나를 빼서 **나머지 사이의** `index` 자리에 끼운다(끌어서 놓기) — `index` 는 0..나머지 개수로 자른다 */
export function moveChipTo<T extends string>(order: readonly T[], id: T, index: number): T[] {
  const rest = order.filter((x) => x !== id);
  if (rest.length === order.length) return order.slice();
  rest.splice(Math.max(0, Math.min(rest.length, index)), 0, id);
  return rest;
}
