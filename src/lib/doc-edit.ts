/**
 * **문서 편집(E1)의 순수 규칙** — `DocView` · `DocEditor` 가 보는 판정만 (docs/log/2026-09-27-doc-edit.md).
 *
 * - [`detectEol`] · [`normalizeEol`] — 줄 끝 보존. 원문의 우세한 줄 끝을 편집기의 `lineSeparator` 로 삼아
 *   **저장 바이트의 줄 끝이 원문과 같게** 한다(끝 개행 유무도 편집기가 그대로 들고 있다).
 * - [`detectIndent`] — Tab 키가 넣을 들여쓰기(탭 파일에 공백을 섞지 않는다).
 * - [`editBlockOf`] — 편집할 수 있는 파일인가(잘림 · 이진 · 깨진 UTF-8 이면 아니다 — 계약 §0).
 * - [`editorLangOf`] — 편집기의 언어 이름(`doc-lang` 의 강조 이름 + toml).
 * - 띠 상태 기계 — [`bandOnSave`] · [`bandOnDisk`] · [`bandOnIgnore`] · [`bandOnDismiss`].
 */

import { hasReason } from "$lib/error-reason";
import { langOf } from "$lib/doc-lang";

// ── 줄 끝 ─────────────────────────────────────────────────────────────────────

export type Eol = "\n" | "\r\n";

/**
 * 원문의 줄 끝 — `\r\n` 이 홀로 선 `\n` 보다 **많으면** `\r\n`, 아니면 `\n`(같거나 줄 끝이 없어도 `\n`).
 * 홀로 선 `\r`(옛 맥)은 세지 않는다 — 편집기에서는 줄 안의 특수 글자로 남아 그대로 저장된다.
 */
export function detectEol(text: string): Eol {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? "\r\n" : "\n";
}

/**
 * 붙여 넣은 글의 줄 끝을 문서의 것으로 맞춘다 — 편집기는 `lineSeparator` 하나로만 줄을 가르므로, 맞추지 않으면
 * `\r\n` 문서에 붙인 `\n` 이 줄 안의 글자로 남는다.
 */
export function normalizeEol(text: string, eol: Eol): string {
  return text.replace(/\r\n|\r|\n/g, eol);
}

// ── 들여쓰기 ───────────────────────────────────────────────────────────────────

/**
 * Tab 이 넣을 들여쓰기 — 탭으로 시작하는 줄이 공백으로 시작하는 줄보다 많으면 `"\t"`, 아니면 공백.
 * 공백 폭은 들여쓴 줄들의 앞 공백 수에서 가장 흔한 **최소 단위**(2 · 4 · 8 중 전부를 나누는 가장 큰 것)이고,
 * 모르면 2.
 */
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
    // 대부분(90%)이 그 단위의 배수면 그 단위 — 정렬용 공백 몇 줄에 흔들리지 않게
    if (fits >= widths.length * 0.9 && widths.some((w) => w === unit)) return " ".repeat(unit);
  }
  return "  ";
}

// ── 편집 가능 판정 ──────────────────────────────────────────────────────────────

/** 편집을 막는 사정 — 없으면 `null` */
export type EditBlock = "truncated" | "binary" | "lossy";

/**
 * 이 파일을 편집할 수 있는가 — 막는 까닭을 돌려준다(`null` = 된다). 잘린 파일을 저장하면 뒤가 날아가고,
 * 대체 문자로 푼 글을 저장하면 원래 바이트가 망가진다.
 */
export function editBlockOf(file: { truncated: boolean; binary: boolean; lossy: boolean }): EditBlock | null {
  if (file.binary) return "binary";
  if (file.truncated) return "truncated";
  if (file.lossy) return "lossy";
  return null;
}

// ── 언어 ──────────────────────────────────────────────────────────────────────

/** 편집기 언어 — 강조 이름(`langOf`)과 같되 `.toml` 은 제 이름(보기는 ini 로 칠하지만 편집기에는 toml 모드가 있다) */
export function editorLangOf(path: string): string | null {
  if (/\.toml$/i.test(path)) return "toml";
  return langOf(path);
}

// ── 띠(충돌 · 바뀜 · 저장 못 함) ─────────────────────────────────────────────────

/**
 * 편집 중 도구줄 아래에 서는 띠 하나.
 * - `conflict` — 저장이 `[conflict]` 로 거절됐다. [다시 불러오기(내 변경 버림)] [덮어쓰기] [취소].
 * - `changed` — 편집 중 자동 새로고침이 디스크가 바뀐 것을 봤다(같은 문구). [다시 불러오기] [무시].
 * - `unsaved` — 저장하지 못했다(연결 없음 · 원본 없음 · 그 밖). 글은 그대로다(복사는 된다).
 */
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

/** 저장 결과 → 띠. 성공이면 띠도 무시 기억도 지운다 */
export type SaveOutcome =
  | { ok: true }
  | { ok: false; why: "conflict" | "gone" | "missing" | "error"; message?: string };

/** 저장 실패 문구 → 갈래 (이유 코드는 `error-reason` 의 표) */
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

/**
 * 편집 중 디스크의 version 을 알았다(자동 새로고침 · 새로고침 단추).
 * - 편집의 기준(`base`)과 같으면 — `changed` 띠는 내린다(되돌아왔다). 다른 띠는 그대로.
 * - 다르면 — [무시] 한 그 version 이면 그대로, 충돌 띠가 서 있으면 그대로(더 강한 말이다), 아니면 `changed`.
 */
export function bandOnDisk(s: BandState, base: string, disk: string): BandState {
  if (disk === base) {
    return s.band?.kind === "changed" ? { band: null, ignored: null } : s;
  }
  if (disk === s.ignored) return s;
  if (s.band?.kind === "conflict") return s;
  if (s.band?.kind === "changed" && s.band.disk === disk) return s;
  return { band: { kind: "changed", disk }, ignored: s.ignored };
}

/** [무시] — 그 version 은 다시 알리지 않는다(저장하면 여전히 충돌로 멈춘다 — 불변 §0) */
export function bandOnIgnore(s: BandState): BandState {
  if (s.band?.kind !== "changed") return s;
  return { band: null, ignored: s.band.disk };
}

/** [취소] · 닫기 — 띠만 내린다 */
export function bandOnDismiss(s: BandState): BandState {
  return { band: null, ignored: s.ignored };
}
