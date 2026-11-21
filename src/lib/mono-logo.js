/**
 * 검정 단색 로고를 테마 색(`var(--logo-mono)` — `theme.css`)으로 바꾸는 순수 변환 — 생성기(`scripts/gen-host-icons.mjs`)가 거친다.
 * 검정 · 흰색 밖의 색이 하나라도 있으면 손대지 않는다. 검정 + 흰색이면 통째 반전이라 흰 오려낸 자리가 사라지지 않는다.
 * 모르는 색 표기(`hsl()` 등)도 다른 색으로 본다 — 모르면 원본을 둔다.
 */

const COLOR_PROPS = ["fill", "stroke", "stop-color", "flood-color", "lighting-color", "color"];

const ATTR_RE = new RegExp(`(\\s)(${COLOR_PROPS.join("|")})="([^"]*)"`, "gi");
const STYLE_RE = /(\sstyle=")([^"]*)(")/gi;
const STYLE_DECL_RE = new RegExp(`(^|;)(\\s*)(${COLOR_PROPS.join("|")})(\\s*:\\s*)([^;]*)`, "gi");

/** 칠 기본값(검정)을 받는 도형 태그 — 칠 없는 도형도 검정으로 친다 */
const SHAPE_RE = /<(path|rect|circle|ellipse|polygon|polyline|text|tspan)\b([^>]*)>/gi;

/**
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
