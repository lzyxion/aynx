// ---------------------------------------------------------------------------
// 툴팁의 **순수 규칙 둘** — 글자를 쪼개는 것과 자리를 잡는 것
// (docs/log/2026-09-16-themed-tooltips.md).
//
// DOM 도 상태도 모른다. 배선(위임 리스너·`title` 바꿔치기)은 `tooltip.svelte.ts` 가 쥐고,
// 그리기는 `Tooltip.svelte` 가 한다. 여기 두 함수만 테스트가 붙는다 — 판정이 애매한 것은
// 전부 이 파일 안에 있기 때문이다.
// ---------------------------------------------------------------------------

/** 포인터가 한 요소 위에 머물러야 하는 시간 (ms) — 이보다 짧으면 스쳐 지나가도 뜬다 */
export const TOOLTIP_DELAY_MS = 500;

/** 기준 요소와 말풍선 사이 간격 (px) */
export const TOOLTIP_GAP = 8;

/** 화면 가장자리에 남겨 두는 여백 (px) */
export const TOOLTIP_MARGIN = 8;

// ---------------------------------------------------------------------------
// 1. 글자 쪼개기 — 괄호 안의 **단축키 조합만** 칩으로 뽑는다
// ---------------------------------------------------------------------------

/** 말풍선 한 줄을 이루는 조각 — 보통 글자이거나 단축키 칩이다 */
export interface TooltipSegment {
  kind: "text" | "kbd";
  value: string;
}

/**
 * 수식 키 — 조합의 **앞자리에만** 설 수 있다.
 *
 * `keybindings.ts` 가 실제로 만드는 것은 `Ctrl`·`Alt`·`Shift` 셋뿐이지만(Meta 는 v1 에서
 * 무시), 문구에는 다른 OS 의 이름이 섞여 적힐 수 있어 함께 받는다. 이 목록은 **판정용**이지
 * 바인딩 규칙이 아니다.
 */
const MODIFIERS = new Set([
  "ctrl",
  "control",
  "alt",
  "shift",
  "win",
  "meta",
  "cmd",
  "command",
  "super",
  "option",
]);

/**
 * 조합의 **끝자리**에 설 수 있는 이름들. 두 칸으로 나뉘는 기준은 **혼자 서도 키로 읽히는가**다.
 *
 * `(Esc)`·`(Backspace)` 는 수식 키가 없어도 누가 봐도 키 이름이다. 반면 `(위)`·`(a)` 는
 * 평범한 말이라 수식 키가 붙어야만(`Ctrl+클릭`·`Alt+화살표`) 조합으로 읽힌다 — 한국어
 * 낱말과 한 글자가 여기 오는 이유다. 목록을 닫아 두는 것이 요점이다: 아무 말이나 받으면
 * `(선택) 22` 같은 평범한 괄호가 칩이 된다.
 */
const STANDALONE_KEYS = new Set([
  "enter",
  "esc",
  "escape",
  "tab",
  "space",
  "spacebar",
  "backspace",
  "delete",
  "del",
  "insert",
  "ins",
  "home",
  "end",
  "pgup",
  "pgdn",
  "pageup",
  "pagedown",
  "arrowup",
  "arrowdown",
  "arrowleft",
  "arrowright",
]);

/**
 * 수식 키가 붙어야만 조합으로 읽히는 끝자리 (한 글자는 아래 규칙이 따로 받는다).
 *
 * **두 언어의 낱말이 함께 산다.** 이것은 화면에 보여 주는 글자가 아니라 **판정표**라
 * 사전으로 옮기지 않는다 — 같은 툴팁이 한국어에서는 `(Ctrl+클릭)`, 영어에서는
 * `(Ctrl+click)` 으로 오고, 칩이 되는 규칙은 언어와 무관하게 같아야 한다.
 */
const DEPENDENT_KEYS = new Set([
  "up",
  "down",
  "left",
  "right",
  "arrow",
  "arrows",
  "click",
  "double-click",
  "doubleclick",
  "right-click",
  "rightclick",
  "drag",
  "wheel",
  "화살표",
  "위",
  "아래",
  "왼쪽",
  "오른쪽",
  "클릭",
  "더블클릭",
  "우클릭",
  "드래그",
  "휠",
  "엔터",
  "스페이스",
]);

/** 끝자리로 인정되는가 — `solo` 는 수식 키 없이도 혼자 설 수 있는지 */
function readKeyName(part: string): { ok: boolean; solo: boolean } {
  if (/^f([1-9]|1[0-2])$/i.test(part)) return { ok: true, solo: true };
  const lower = part.toLowerCase();
  if (STANDALONE_KEYS.has(lower)) return { ok: true, solo: true };
  if (DEPENDENT_KEYS.has(lower)) return { ok: true, solo: false };
  // 한 글자(영문·숫자·`,`·`/` …)는 키일 수도, 그냥 말일 수도 있다 — 수식 키가 정한다
  if (part.length === 1) return { ok: true, solo: false };
  return { ok: false, solo: false };
}

/** `Ctrl+Shift+N` 처럼 **하나의** 조합인가. `strong` 은 그것만으로 조합이라 단언할 수 있는지 */
function readCombo(token: string): { ok: boolean; strong: boolean } {
  const parts = token.split("+");
  if (parts.some((p) => p === "")) return { ok: false, strong: false };
  const last = parts[parts.length - 1];
  const head = parts.slice(0, -1);
  if (!head.every((p) => MODIFIERS.has(p.toLowerCase()))) return { ok: false, strong: false };
  // `Ctrl+Shift+H/J/K` — 수식 키가 같은 조합 여럿을 한 칩으로 접은 꼴(`mergeCombos`). 수식 키가
  // 붙어 있을 때만 인정한다: `(a/b)` 같은 보통 글자는 칩이 되지 않는다. `Ctrl+/` 의 `/` 는 키 하나다.
  if (last.length > 1 && last.includes("/")) {
    const keys = last.split("/");
    if (head.length === 0 || keys.some((k) => k === "" || !readKeyName(k).ok)) {
      return { ok: false, strong: false };
    }
    return { ok: true, strong: true };
  }
  const key = readKeyName(last);
  if (!key.ok) return { ok: false, strong: false };
  return { ok: true, strong: head.length > 0 || key.solo };
}

/**
 * 괄호 안의 글자가 단축키인가 — **아니면 그냥 글자로 둔다**.
 *
 * 문턱을 세 겹으로 둔 이유는 이 앱의 괄호가 대부분 단축키가 아니기 때문이다:
 * `(선택) deploy` · `(기본 · 상속)` · `(타일 메뉴 · Ctrl+클릭으로 제외)` 는 전부 글자로
 * 남아야 한다. 그래서 (a) 낱말 셋 이하 · (b) 낱말마다 온전한 조합 · (c) 그중 적어도 하나가
 * **단언할 수 있는** 조합(수식 키가 붙었거나 혼자 서는 키 이름). 셋째 조건이 `(위)`·`(a)`
 * 처럼 우연히 한 낱말인 괄호를 걸러 낸다 — 애매하면 글자다.
 */
function readComboPhrase(content: string): string[] | null {
  const tokens = content.trim().split(/\s+/);
  if (tokens.length === 0 || tokens.length > 3) return null;
  let strong = false;
  for (const token of tokens) {
    const r = readCombo(token);
    if (!r.ok) return null;
    strong ||= r.strong;
  }
  return strong ? tokens : null;
}

/** 괄호 한 쌍 — 줄바꿈을 넘지 않는다 (`title` 은 여러 줄일 수 있다) */
const PAREN = /\(([^()\n]+)\)/g;

/**
 * 툴팁 글자를 **보통 글자 + 단축키 칩**으로 쪼갠다.
 *
 * 칩이 되는 것은 `(Ctrl+Shift+N)` · `(Ctrl+B d)` · `(Ctrl+클릭)` 처럼 괄호에 싸인 조합뿐이고,
 * 그때 **괄호는 버린다** (칩의 테두리가 그 일을 한다). 낱말이 여럿인 조합(`Ctrl+B d`)은
 * 칩도 여럿이 되고 사이에 공백 한 칸이 남는다.
 *
 * 칩이 하나도 없으면 글자 조각 하나만 돌려준다 — 부르는 쪽에서 분기할 것이 없다.
 */
export function tooltipSegments(text: string): TooltipSegment[] {
  if (text === "") return [];

  const out: TooltipSegment[] = [];
  /** 글자는 붙여 모은다 — 조각이 잘게 쪼개지면 `white-space: pre-line` 이 줄을 이상하게 접는다 */
  const pushText = (value: string): void => {
    if (value === "") return;
    const last = out[out.length - 1];
    if (last && last.kind === "text") last.value += value;
    else out.push({ kind: "text", value });
  };

  let cursor = 0;
  PAREN.lastIndex = 0;
  for (let m = PAREN.exec(text); m !== null; m = PAREN.exec(text)) {
    const tokens = readComboPhrase(m[1]);
    if (tokens === null) continue; // 단축키가 아니다 — 괄호째 글자로 남는다
    pushText(text.slice(cursor, m.index));
    tokens.forEach((token, i) => {
      if (i > 0) pushText(" ");
      out.push({ kind: "kbd", value: token });
    });
    cursor = m.index + m[0].length;
  }
  pushText(text.slice(cursor));

  return out;
}

// ---------------------------------------------------------------------------
// 2. 자리 잡기 — 아래가 기본, 안 들어가면 위로 뒤집고, 가로는 화면 안으로 민다
// ---------------------------------------------------------------------------

/** 기준 요소의 상자 (뷰포트 좌표 — `getBoundingClientRect` 그대로) */
export interface TooltipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** 말풍선의 실제 크기 (그린 뒤 재어서 넣는다) */
export interface TooltipSize {
  width: number;
  height: number;
}

/** 놓을 자리 — `position: fixed` 라 뷰포트 좌표 그대로 쓴다 */
export interface TooltipPlacement {
  left: number;
  top: number;
  /** 위로 뒤집혔는가 (화살표를 달게 되면 이 값이 방향을 정한다) */
  above: boolean;
}

/**
 * 말풍선을 놓을 자리.
 *
 * 규칙은 셋이다. **아래·가운데**가 기본, 아래가 모자라고 위가 넉넉하면 **위로 뒤집고**,
 * 가로는 언제나 `[여백, 화면폭 − 여백 − 말풍선폭]` 으로 **민다**(뒤집지 않는다 — 가로로
 * 뒤집으면 커서가 말풍선 한가운데에 놓여 어느 요소를 설명하는지 읽기 어렵다).
 *
 * 위아래 **둘 다** 모자라면(작은 창에 긴 툴팁) 아래를 고른 뒤 화면 안으로 민다 — 잘려 나가는
 * 것보다 겹치는 편이 낫다.
 *
 * `prefer: "above"` 면 위아래 순서만 바뀐다 — 위가 기본, 위가 모자라고 아래가 넉넉하면 아래로.
 */
export function placeTooltip(
  anchor: TooltipRect,
  bubble: TooltipSize,
  viewport: TooltipSize,
  prefer: "above" | "below" = "below",
): TooltipPlacement {
  const belowTop = anchor.top + anchor.height + TOOLTIP_GAP;
  const aboveTop = anchor.top - TOOLTIP_GAP - bubble.height;
  const fitsBelow = belowTop + bubble.height <= viewport.height - TOOLTIP_MARGIN;
  const fitsAbove = aboveTop >= TOOLTIP_MARGIN;
  const above = prefer === "above" ? fitsAbove || !fitsBelow : !fitsBelow && fitsAbove;

  const maxTop = Math.max(TOOLTIP_MARGIN, viewport.height - TOOLTIP_MARGIN - bubble.height);
  const top = Math.min(Math.max(above ? aboveTop : belowTop, TOOLTIP_MARGIN), maxTop);

  const centered = anchor.left + anchor.width / 2 - bubble.width / 2;
  const maxLeft = Math.max(TOOLTIP_MARGIN, viewport.width - TOOLTIP_MARGIN - bubble.width);
  const left = Math.min(Math.max(centered, TOOLTIP_MARGIN), maxLeft);

  return { left, top, above };
}

/**
 * **옆에** 놓을 자리 — 세로 기둥(왼쪽·오른쪽 상태바)에서 뜨는 카드용 (상태바 사용량 카드,
 * docs/log/2026-09-28-usage-hover-bars.md). 기둥이 왼쪽이면 오른쪽(`side: "right"`)에, 오른쪽이면 왼쪽에 선다.
 *
 * 규칙은 `placeTooltip` 을 옆으로 돌린 것이다: 정한 쪽이 모자라고 반대쪽이 넉넉하면 **뒤집고**, 세로는
 * 기준 요소의 가운데에 맞춘 뒤 `[여백, 화면높이 − 여백 − 카드높이]` 로 **민다**. 둘 다 모자라면 정한 쪽을
 * 고른 뒤 화면 안으로 민다. `above` 는 늘 `false` 다(위아래가 아니다).
 */
export function placeBeside(
  anchor: TooltipRect,
  bubble: TooltipSize,
  viewport: TooltipSize,
  side: "left" | "right",
): TooltipPlacement {
  const rightLeft = anchor.left + anchor.width + TOOLTIP_GAP;
  const leftLeft = anchor.left - TOOLTIP_GAP - bubble.width;
  const fitsRight = rightLeft + bubble.width <= viewport.width - TOOLTIP_MARGIN;
  const fitsLeft = leftLeft >= TOOLTIP_MARGIN;
  const goRight = side === "right" ? fitsRight || !fitsLeft : !fitsLeft && fitsRight;

  const maxLeft = Math.max(TOOLTIP_MARGIN, viewport.width - TOOLTIP_MARGIN - bubble.width);
  const left = Math.min(Math.max(goRight ? rightLeft : leftLeft, TOOLTIP_MARGIN), maxLeft);

  const centered = anchor.top + anchor.height / 2 - bubble.height / 2;
  const maxTop = Math.max(TOOLTIP_MARGIN, viewport.height - TOOLTIP_MARGIN - bubble.height);
  const top = Math.min(Math.max(centered, TOOLTIP_MARGIN), maxTop);

  return { left, top, above: false };
}
