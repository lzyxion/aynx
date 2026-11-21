/** 문서 편집의 순수 규칙 (docs/log/2026-09-27-doc-edit.md). 줄 끝은 원문의 우세한 것을 편집기 `lineSeparator` 로 삼아 저장 바이트를 원문과 같게 한다. */

import { hasReason } from "$lib/error-reason";
import { langOf } from "$lib/doc-lang";

// ── 줄 끝 ─────────────────────────────────────────────────────────────────────

export type Eol = "\n" | "\r\n";

/** 홀로 선 `\r` 은 세지 않는다 — 편집기에서 줄 안의 글자로 남아 그대로 저장된다 */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? "\r\n" : "\n";
}

/** 맞추지 않으면 `\r\n` 문서에 붙인 `\n` 이 줄 안의 글자로 남는다 */
export function normalizeEol(text: string, eol: Eol): string {
  return text.replace(/\r\n|\r|\n/g, eol);
}

// ── 들여쓰기 ───────────────────────────────────────────────────────────────────

export function detectIndent(text: string): string {
  let tabs = 0;
  const widths: number[] = [];
  for (const line of text.split(/\r\n|\n|\r/, 5000)) {
    if (line.startsWith("\t")) tabs++;
    else if (line.startsWith(" ")) {
      const n = line.length - line.trimStart().length;
      if (line.trim() !== "") widths.push(n);
    }
  }
  if (tabs > widths.length) return "\t";
  if (widths.length === 0) return "  ";
  for (const unit of [8, 4, 2]) {
    const fits = widths.filter((w) => w % unit === 0).length;
    if (fits >= widths.length * 0.9 && widths.some((w) => w === unit)) return " ".repeat(unit);
  }
  return "  ";
}

// ── 편집 가능 판정 ──────────────────────────────────────────────────────────────

export type EditBlock = "truncated" | "binary" | "lossy";

/** 잘린 파일을 저장하면 뒤가 날아가고, 대체 문자로 푼 글을 저장하면 원래 바이트가 망가진다 */
export function editBlockOf(file: { truncated: boolean; binary: boolean; lossy: boolean }): EditBlock | null {
  if (file.binary) return "binary";
  if (file.truncated) return "truncated";
  if (file.lossy) return "lossy";
  return null;
}

// ── 언어 ──────────────────────────────────────────────────────────────────────

/** `.toml` 은 보기는 ini 로 칠하지만 편집기에는 toml 모드가 있다 */
export function editorLangOf(path: string): string | null {
  if (/\.toml$/i.test(path)) return "toml";
  return langOf(path);
}

// ── 띠 ──────────────────────────────────────────────────────────────────────

export type Band =
  | { kind: "conflict" }
  | { kind: "changed"; disk: string }
  | { kind: "unsaved"; why: "gone" | "missing" | "error"; message?: string };

export interface BandState {
  band: Band | null;
  /** [무시] 한 디스크 version — 같은 version 으로는 다시 띠를 세우지 않는다 */
  ignored: string | null;
}

export const NO_BAND: BandState = { band: null, ignored: null };

export type SaveOutcome =
  | { ok: true }
  | { ok: false; why: "conflict" | "gone" | "missing" | "error"; message?: string };

export function saveFailureOf(message: string): SaveOutcome {
  if (hasReason(message, "conflict")) return { ok: false, why: "conflict" };
  if (hasReason(message, "session-gone")) return { ok: false, why: "gone" };
  if (hasReason(message, "missing")) return { ok: false, why: "missing" };
  return { ok: false, why: "error", message };
}

export function bandOnSave(s: BandState, r: SaveOutcome): BandState {
  if (r.ok) return NO_BAND;
  if (r.why === "conflict") return { band: { kind: "conflict" }, ignored: s.ignored };
  return { band: { kind: "unsaved", why: r.why, message: r.message }, ignored: s.ignored };
}

export function bandOnDisk(s: BandState, base: string, disk: string): BandState {
  if (disk === base) {
    return s.band?.kind === "changed" ? { band: null, ignored: null } : s;
  }
  if (disk === s.ignored) return s;
  if (s.band?.kind === "conflict") return s;
  if (s.band?.kind === "changed" && s.band.disk === disk) return s;
  return { band: { kind: "changed", disk }, ignored: s.ignored };
}

/** 저장하면 여전히 충돌로 멈춘다 — 무시는 알림만 끈다 */
export function bandOnIgnore(s: BandState): BandState {
  if (s.band?.kind !== "changed") return s;
  return { band: null, ignored: s.band.disk };
}

export function bandOnDismiss(s: BandState): BandState {
  return { band: null, ignored: s.ignored };
}
