// 툴팁의 순수 규칙 둘 — 글자 쪼개기 · 자리 잡기(DOM · 상태 없음).

export const TOOLTIP_DELAY_MS = 500;

export const TOOLTIP_GAP = 8;

export const TOOLTIP_MARGIN = 8;

// ── 1. 글자 쪼개기 — 괄호 안의 단축키 조합만 칩으로 뽑는다 ──

export interface TooltipSegment {
  kind: "text" | "kbd";
  value: string;
}

/** 판정용이지 바인딩 규칙이 아니다 — 문구에 다른 OS 의 키 이름이 섞여 적힐 수 있어 함께 받는다 */
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

/** 수식 키 없이도 키로 읽히는 끝자리. 목록을 닫아 둔다 — 아무 말이나 받으면 `(선택) 22` 같은 괄호가 칩이 된다 */
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

/** 수식 키가 붙어야만 조합으로 읽히는 끝자리 — 화면 글자가 아니라 판정표라 두 언어의 낱말을 함께 두고 사전으로 옮기지 않는다 */
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

/** `solo` = 수식 키 없이도 혼자 설 수 있다 */
function readKeyName(part: string): { ok: boolean; solo: boolean } {
  if (/^f([1-9]|1[0-2])$/i.test(part)) return { ok: true, solo: true };
  const lower = part.toLowerCase();
  if (STANDALONE_KEYS.has(lower)) return { ok: true, solo: true };
  if (DEPENDENT_KEYS.has(lower)) return { ok: true, solo: false };
  // 한 글자(영문·숫자·`,`·`/` …)는 키일 수도, 그냥 말일 수도 있다 — 수식 키가 정한다
  if (part.length === 1) return { ok: true, solo: false };
  return { ok: false, solo: false };
}

/** `strong` = 그것만으로 조합이라 단언할 수 있다 */
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
 * 이 앱의 괄호는 대부분 단축키가 아니다 — 낱말 셋 이하 · 낱말마다 온전한 조합 · 그중 하나라도 단언할 수 있는 조합일 때만 칩이고,
 * 애매하면 글자다.
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

/** 줄바꿈을 넘지 않는다(`title` 은 여러 줄일 수 있다) */
const PAREN = /\(([^()\n]+)\)/g;

/** 괄호에 싸인 조합만 칩이 되고 괄호는 버린다(칩의 테두리가 그 일을 한다) */
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

// ── 2. 자리 잡기 — 아래가 기본, 안 들어가면 위로 뒤집고, 가로는 화면 안으로 민다 ──

/** 뷰포트 좌표 — `getBoundingClientRect` 그대로 */
export interface TooltipRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface TooltipSize {
  width: number;
  height: number;
}

export interface TooltipPlacement {
  left: number;
  top: number;
  above: boolean;
}

/**
 * 가로는 뒤집지 않고 민다 — 뒤집으면 어느 요소를 설명하는지 읽기 어렵다. 위아래 둘 다 모자라면 정한 쪽을 고른 뒤 화면 안으로 민다
 * (잘려 나가는 것보다 겹치는 편이 낫다).
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

/** 옆에 놓을 자리 — 세로 기둥(왼쪽 · 오른쪽 상태바)에서 뜨는 카드용. [`placeTooltip`] 을 옆으로 돌린 규칙이다 */
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
