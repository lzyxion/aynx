/**
 * **검정 단색 로고를 테마 색으로** — 생성기(`scripts/gen-host-icons.mjs`)가 로고 body 를 적기 전에
 * 한 번 거치는 순수 변환이다 (docs/log/2026-09-29-logos-full-icons.md 의 "검정 단색 로고" 절).
 *
 * logos 의 OpenAI(Codex) · Apple · GitHub · Vercel 같은 로고는 **검정 한 색**이다(칠 속성이 없어
 * 기본값 검정이거나 `#000`·`#161614` 같은 거의 검정). 다크 모드의 어두운 면 위에서 거의 안 보인다.
 * 이 로고들만 골라 검정을 `var(--logo-mono)`(라이트 ≈ 검정 · 다크 ≈ 흰색, `theme.css`)로 바꾼다.
 *
 * ## 무엇을 고르나
 *
 * body 에 적힌 색(`fill` · `stroke` · `stop-color` · `flood-color` · `lighting-color` · `color` —
 * 속성이든 `style` 이든)을 모아 셋으로 가른다:
 *
 * - **검정** — 밝기 낮고(가장 밝은 채널 ≤ 0x40) 무채에 가까운(채널 차 ≤ 0x18) 색. 칠 없는 도형
 *   (기본값 검정)도 여기 든다.
 * - **흰색** — 가장 어두운 채널 ≥ 0xF0, 채널 차 ≤ 0x10.
 * - **그 밖** — 하나라도 있으면 **손대지 않는다**. 테라코타 Claude, 검정 조각이 섞인 컬러 로고는 원본 그대로다.
 *
 * 그리고:
 *
 * | 적힌 색 | 처리 |
 * | --- | --- |
 * | 검정만 | 검정 → `var(--logo-mono)` (`"mono"`) |
 * | 검정 + 흰색 | 검정 → `--logo-mono`, 흰색 → `--logo-mono-inverse` (`"negative"`) — **통째 반전**이라 흰 오려낸 자리가 사라지지 않는다 |
 * | 검정 없음 · 그 밖 색 있음 | 그대로 (`null`) |
 *
 * 라이트 모드의 두 토큰은 원본(검정 · 흰색)과 같은 편이라 라이트에서는 전과 똑같이 보인다.
 *
 * **`<mask>` · `<style>` 이 있으면 건너뛴다** — 마스크 안의 흑백은 색이 아니라 투명도라 바꾸면 모양이
 * 깨지고, `<style>` 의 클래스 색은 여기서 읽지 않는다.
 * 모르는 색 표기(`hsl()` 등)도 "그 밖" 으로 본다 — 모르면 원본을 둔다.
 *
 * ## 칠 없는 도형
 *
 * 속성이 없는 도형의 기본 칠은 검정이다. 그 기본을 바꾸려고 body 전체를
 * `<g fill="var(--logo-mono)">` 로 감싼다 — 자기 칠이 있는 도형은 그 값이 이기고(위에서 바꿨다),
 * 없는 도형만 이 값을 물려받는다. SVG 표현 속성은 CSS 값으로 읽히므로 `var()` 가 그대로 풀린다.
 */

/** 모으는 색 속성 — 표현 속성과 `style` 선언 둘 다 */
const COLOR_PROPS = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"];

const ATTR_RE = new RegExp(`(\\s)(${COLOR_PROPS.join("|")})="([^"]*)"`, "gi");
const STYLE_RE = /(\sstyle=")([^"]*)(")/gi;
const STYLE_DECL_RE = new RegExp(`(^|;)(\\s*)(${COLOR_PROPS.join("|")})(\\s*:\\s*)([^;]*)`, "gi");

/** 칠 기본값(검정)을 받는 도형 태그 */
const SHAPE_RE = /<(path|rect|circle|ellipse|polygon|polyline|text|tspan)\b([^>]*)>/gi;

/**
 * 색 값 하나를 `[r, g, b]` 로 — 모르는 표기면 `null`
 *
 * @param {string} value
 * @returns {number[] | null}
 */
function parseColor(value) {
  const v = value.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,4})$/.exec(v);
  if (m) {
    const h = m[1];
    return [0, 1, 2].map((i) => parseInt(h[i] + h[i], 16));
  }
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/.exec(v);
  if (m) {
    const h = m[1];
    return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
  }
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,[^)]*)?\)$/.exec(v);
  if (m) return [+m[1], +m[2], +m[3]];
  if (v === "black") return [0, 0, 0];
  if (v === "white") return [255, 255, 255];
  return null;
}

/**
 * 색 값 하나의 갈래 — `"skip"` 은 색이 아닌 값(`none` · `url(#…)` · `currentColor` · `inherit` 등)
 *
 * @param {string} value
 * @returns {"black" | "white" | "other" | "skip"}
 */
export function colorKind(value) {
  const v = value.trim().toLowerCase();
  if (
    v === "" ||
    v === "none" ||
    v === "transparent" ||
    v === "currentcolor" ||
    v === "inherit" ||
    v.startsWith("url(")
  ) {
    return "skip";
  }
  const rgb = parseColor(v);
  if (!rgb) return "other";
  const max = Math.max(...rgb);
  const min = Math.min(...rgb);
  if (max <= 0x40 && max - min <= 0x18) return "black";
  if (min >= 0xf0 && max - min <= 0x10) return "white";
  return "other";
}

/**
 * 칠 속성이 없는 도형이 있는가 (기본값 검정을 쓰는 자리)
 *
 * @param {string} body
 */
function hasImplicitFill(body) {
  for (const m of body.matchAll(SHAPE_RE)) {
    const attrs = m[2];
    if (/\sfill="/i.test(attrs)) continue;
    if (/\sstyle="[^"]*\bfill\s*:/i.test(attrs)) continue;
    return true;
  }
  return false;
}

/**
 * body 에 적힌 색 값 전부
 *
 * @param {string} body
 * @returns {string[]}
 */
function colorsOf(body) {
  /** @type {string[]} */
  const out = [];
  for (const m of body.matchAll(ATTR_RE)) out.push(m[3]);
  for (const m of body.matchAll(STYLE_RE)) {
    for (const d of m[2].matchAll(STYLE_DECL_RE)) out.push(d[5]);
  }
  return out;
}

/**
 * 검정 단색 로고인가 — `"mono"`(검정만) · `"negative"`(검정 + 흰색) · `null`(손대지 않는다)
 *
 * @param {string} body
 * @returns {"mono" | "negative" | null}
 */
export function monoKind(body) {
  // 마스크의 흑백은 투명도고, `<style>` 의 클래스 색은 여기서 읽지 않는다 — 둘 다 원본을 둔다.
  if (/<(mask|style)\b/i.test(body)) return null;
  let black = hasImplicitFill(body);
  let white = false;
  for (const c of colorsOf(body)) {
    const k = colorKind(c);
    if (k === "other") return null;
    if (k === "black") black = true;
    if (k === "white") white = true;
  }
  if (!black) return null;
  return white ? "negative" : "mono";
}

export const MONO_VAR = "var(--logo-mono)";
export const MONO_INVERSE_VAR = "var(--logo-mono-inverse)";

/**
 * 검정 단색 로고면 색을 토큰으로 바꾼 body 를, 아니면 **받은 그대로** 돌려준다.
 *
 * @param {string} body
 * @returns {string}
 */
export function monoLogo(body) {
  const kind = monoKind(body);
  if (!kind) return body;
  /** @param {string} value */
  const swap = (value) => {
    const k = colorKind(value);
    if (k === "black") return MONO_VAR;
    if (k === "white") return MONO_INVERSE_VAR;
    return value;
  };
  let out = body.replace(
    ATTR_RE,
    (/** @type {string} */ _all, /** @type {string} */ sp, /** @type {string} */ prop, /** @type {string} */ value) =>
      `${sp}${prop}="${swap(value)}"`,
  );
  out = out.replace(
    STYLE_RE,
    (/** @type {string} */ _all, /** @type {string} */ open, /** @type {string} */ decls, /** @type {string} */ close) => {
    const next = decls.replace(
      STYLE_DECL_RE,
      (
        /** @type {string} */ _d,
        /** @type {string} */ sep,
        /** @type {string} */ ws,
        /** @type {string} */ prop,
        /** @type {string} */ colon,
        /** @type {string} */ value,
      ) => `${sep}${ws}${prop}${colon}${swap(value)}`,
    );
    return `${open}${next}${close}`;
  },
  );
  return `<g fill="${MONO_VAR}">${out}</g>`;
}
