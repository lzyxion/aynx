/**
 * **저장 안 한 문서의 초안** — 창을 넘는 이관 짐에 실리는 편집 상태 하나의 모양 · 한도 · 정화(순수 — 룬 없음).
 *
 * 문서 편집기의 저장 안 한 글은 그 웹뷰의 편집기 메모리에만 있다. 창을 넘기면(분리 · 다른 창에 놓기) 받는 창의 문서
 * 타일이 파일을 **다시 읽으므로**, 예전에는 저장 안 한 문서는 창을 넘지 않았다(`unsavedVerdict("move-window")` 거절).
 * 이제는 드래그 시작에서 편집기의 상태를 **동기로** 떠([`DocDraft`]) 이관 짐(`tear.ts` 의 `TearPane.docDraft`)에 싣고,
 * 받는 창이 그 글로 편집을 잇는다(`app/doc-drafts.svelte.ts` · `DocView`).
 *
 * **패널 명세(`PaneSpec`)에는 넣지 않는다** — 명세는 배치 · 워크스페이스 파일에 저장된다. 초안은 짐(Rust 사서함의 메모리 ·
 * 5분 시한)과 받는 창의 메모리 표에만 산다. 로그 · 콘솔 · 영속 파일에 글을 남기지 않는다.
 *
 * 한도 둘:
 * - 글 — 편집 상한과 같은 [`DRAFT_TEXT_MAX_BYTES`](2 MiB, UTF-8). 넘으면 **싣지 않는다**(= 예전처럼 창 넘기기 거절).
 * - 실행 취소 기록(CodeMirror `historyField` JSON) — [`DRAFT_HISTORY_MAX_CHARS`]. 넘으면 **기록만 버리고** 글 · 커서는 싣는다.
 */

import type { Eol } from "$lib/doc-edit";

/** 글의 상한(UTF-8 바이트) — 읽기 · 편집 상한(`TEXT_VIEW_MAX_BYTES`)과 같은 값 */
export const DRAFT_TEXT_MAX_BYTES = 2 * 1024 * 1024;
/** 실행 취소 기록 JSON 의 상한(글자 수) — 넘으면 기록만 버린다 */
export const DRAFT_HISTORY_MAX_CHARS = 1024 * 1024;
/** 선택 범위 개수 상한 — 다중 커서가 이보다 많으면 선택을 버린다(글은 그대로) */
const SELECTION_MAX_RANGES = 1000;
/** 기준 version 글자 수 상한 — 백엔드의 version 은 짧은 도장이다 */
const VERSION_MAX_CHARS = 256;

/** CodeMirror 선택의 JSON 모양(`EditorSelection.toJSON`) — 위치는 글자 위치(줄 끝은 한 칸) */
export interface DraftSelection {
  ranges: { anchor: number; head: number }[];
  main: number;
}

/** 이관 짐에 실리는 초안 하나 */
export interface DocDraft {
  /** 편집기의 지금 글(줄 끝은 원문의 것 — `sliceDoc`) */
  text: string;
  /** 편집의 기준 version — 저장의 기대값. 받는 창의 디스크가 이것과 다르면 "디스크가 바뀌었습니다" 띠 */
  baseVersion: string;
  /** 편집기의 줄 끝 — 받는 편집기가 같은 줄 끝으로 서야 선택 · 기록의 위치가 맞는다 */
  eol: Eol;
  /** 선택 · 커서 — 없으면 맨 앞 */
  selection?: DraftSelection;
  /** 화면 맨 위 줄의 글자 위치 — 없으면 맨 위 */
  scrollPos?: number;
  /** 실행 취소 기록(`historyField` JSON) — 없으면 기록 없이 */
  history?: unknown;
}

/** 받는 편집기가 되살릴 것(`DocEditor` 의 `restore`) — [`DocDraft`] 에서 글 · 기준 version 을 뺀 것 + 기준 글 */
export interface DocEditorRestore {
  eol: Eol;
  /** 저장해 둔 글 — 받은 디스크가 초안의 기준 version 과 같을 때 그 글, 아니면 `null`(모른다 = 저장할 때까지 dirty) */
  baseText: string | null;
  selection?: DraftSelection;
  scrollPos?: number;
  history?: unknown;
}

/** 문자열의 UTF-8 바이트 수 — 복사본을 만들지 않고 센다 */
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

/** JSON 으로 적은 글자 수 — 못 적으면(순환 등) `null` */
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

/** 선택 JSON 을 모양이 맞을 때만 남긴다 — 위치가 글 밖이면 버린다(받는 편집기가 한 번 더 확인한다) */
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

/**
 * 보내는 쪽 — 편집기에서 뜬 값을 한도에 맞춘다. 글이 상한을 넘으면 `null`(싣지 않는다 = 창 넘기기 거절),
 * 기록이 상한을 넘거나 JSON 으로 적을 수 없으면 **기록만** 뺀다.
 */
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

/**
 * 받는 쪽 — 짐(JSON)에서 꺼낸 값을 **모양이 맞을 때만** 초안으로. 글 · 기준 version · 줄 끝이 맞지 않으면 `null`(초안 없음),
 * 선택 · 스크롤 · 기록은 하나씩 걸러 맞지 않는 것만 버린다. 기록의 **뜻**(이 글과 맞는가)은 받는 편집기가 세울 때 가린다
 * (깨졌으면 기록 없이 글만 — `doc-editor-cm` 의 `createEditor`).
 */
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
    // 기록은 객체 하나여야 한다(`{ done, undone }`) — 그 밖의 모양은 버린다
    history: history && typeof history === "object" && !Array.isArray(history) ? history : undefined,
  });
}
