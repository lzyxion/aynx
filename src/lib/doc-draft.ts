/**
 * 저장 안 한 문서의 초안 — 창을 넘는 이관 짐(`tear.ts` 의 `TearPane.docDraft`)에 실린다(순수 — 룬 없음).
 * `PaneSpec` 에는 넣지 않는다 — 명세는 배치 · 워크스페이스 파일에 저장된다. 로그 · 콘솔 · 영속 파일에 글을 남기지 않는다.
 */

import type { Eol } from "$lib/doc-edit";

/** 읽기 · 편집 상한(`TEXT_VIEW_MAX_BYTES`)과 같은 값 */
export const DRAFT_TEXT_MAX_BYTES = 2 * 1024 * 1024;
export const DRAFT_HISTORY_MAX_CHARS = 1024 * 1024;
const SELECTION_MAX_RANGES = 1000;
const VERSION_MAX_CHARS = 256;

/** `EditorSelection.toJSON` 모양 — 위치는 글자 위치(줄 끝은 한 칸) */
export interface DraftSelection {
  ranges: { anchor: number; head: number }[];
  main: number;
}

export interface DocDraft {
  /** 줄 끝은 원문의 것 */
  text: string;
  baseVersion: string;
  /** 받는 편집기가 같은 줄 끝으로 서야 선택 · 기록의 위치가 맞는다 */
  eol: Eol;
  selection?: DraftSelection;
  scrollPos?: number;
  /** `historyField` JSON */
  history?: unknown;
}

export interface DocEditorRestore {
  eol: Eol;
  /** `null` = 모른다 — 저장할 때까지 dirty */
  baseText: string | null;
  selection?: DraftSelection;
  scrollPos?: number;
  history?: unknown;
}

export function utf8Bytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
}

function jsonSize(v: unknown): number | null {
  try {
    const s = JSON.stringify(v);
    return typeof s === "string" ? s.length : null;
  } catch {
    return null;
  }
}

function isEol(v: unknown): v is Eol {
  return v === "\n" || v === "\r\n";
}

function isPos(v: unknown): v is number {
  return Number.isSafeInteger(v) && (v as number) >= 0;
}

export function sanitizeSelection(raw: unknown, textLength: number): DraftSelection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const { ranges, main } = raw as { ranges?: unknown; main?: unknown };
  if (!Array.isArray(ranges) || ranges.length === 0 || ranges.length > SELECTION_MAX_RANGES) return undefined;
  if (!Number.isSafeInteger(main) || (main as number) < 0 || (main as number) >= ranges.length) return undefined;
  const out: DraftSelection["ranges"] = [];
  for (const r of ranges) {
    if (!r || typeof r !== "object") return undefined;
    const { anchor, head } = r as { anchor?: unknown; head?: unknown };
    if (!isPos(anchor) || !isPos(head) || anchor > textLength || head > textLength) return undefined;
    out.push({ anchor, head });
  }
  return { ranges: out, main: main as number };
}

/** 글이 상한을 넘으면 `null`(= 창 넘기기 거절), 기록이 넘치면 기록만 뺀다 */
export function fitDocDraft(d: DocDraft): DocDraft | null {
  if (typeof d.text !== "string" || utf8Bytes(d.text) > DRAFT_TEXT_MAX_BYTES) return null;
  if (typeof d.baseVersion !== "string" || d.baseVersion.length > VERSION_MAX_CHARS || !isEol(d.eol)) return null;
  const out: DocDraft = { text: d.text, baseVersion: d.baseVersion, eol: d.eol };
  const sel = sanitizeSelection(d.selection, d.text.length);
  if (sel) out.selection = sel;
  if (isPos(d.scrollPos) && d.scrollPos <= d.text.length) out.scrollPos = d.scrollPos;
  if (d.history !== undefined && d.history !== null) {
    const size = jsonSize(d.history);
    if (size !== null && size <= DRAFT_HISTORY_MAX_CHARS) out.history = d.history;
  }
  return out;
}

/** 기록이 이 글과 맞는지는 받는 편집기가 가린다(`doc-editor-cm` 의 `createEditor`) */
export function sanitizeDocDraft(raw: unknown): DocDraft | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  if (typeof o.text !== "string" || typeof o.baseVersion !== "string") return null;
  const history = o.history;
  return fitDocDraft({
    text: o.text,
    baseVersion: o.baseVersion,
    eol: o.eol as Eol,
    selection: o.selection as DraftSelection | undefined,
    scrollPos: o.scrollPos as number | undefined,
    history: history && typeof history === "object" && !Array.isArray(history) ? history : undefined,
  });
}
