/**
 * **문서 편집기 몸통** — CodeMirror 6 을 쥐는 유일한 모듈 (문서 편집 E1 · docs/log/2026-09-27-doc-edit.md).
 *
 * 이 모듈은 **정적으로 import 하지 않는다** — `doc-editor-loader.ts` 가 편집을 처음 시작할 때 한 번 받는다
 * (강조기 `highlight-loader` 와 같은 모양). 그래서 CodeMirror 는 메인 청크에 들지 않는다. 언어 모드도 저마다
 * 따로 받는다(`@codemirror/legacy-modes` 의 StreamParser — 파일 하나에 언어 하나).
 *
 * 밖으로 내보내는 것은 [`createEditor`] 하나와 그 손잡이([`EditorHandle`])뿐이다 — `DocEditor.svelte` 는
 * CodeMirror 의 타입을 모른다.
 *
 * ## 키
 *
 * - `Ctrl+S` → 저장(`onsave`). 가장 먼저 잡는다.
 * - `Alt+↑/↓`(줄 옮기기) · `Alt+Shift+↑/↓`(줄 복제) · `Alt+←/→`(구문 단위 이동)는 **빼 둔다** — 앱의 타일
 *   포커스(`Alt+화살표`) · 타일 옮기기(`Alt+Shift+화살표`)가 이긴다(계약 §3 — 전역 층도 따로 잡는다).
 * - `Ctrl+F` 는 편집기의 검색 패널이다. 편집 중인 문서 타일의 편집기 밖(도구줄 · 미리 보기)에서 누른 `Ctrl+F` 도
 *   이 패널을 연다([`EditorHandle.openSearch`] — `app/doc-find.ts`).
 * - `Tab` 은 들여쓰기(`indentWithTab`) — 빠져나가려면 `Esc` 다음 `Tab`(CodeMirror 의 규칙) 또는 `Alt+화살표`.
 *
 * ## 줄 끝
 *
 * `EditorState.lineSeparator` 를 원문의 우세한 줄 끝으로 **늘 명시한다**(`\n` 이어도). 명시하면 편집기는 그 글자
 * 하나로만 줄을 가르므로 소수파 줄 끝(`\n` 파일 속 `\r\n` 몇 줄)도 줄 안의 글자로 남아 **그대로 저장된다** —
 * 기본값이면 셋(`\n` `\r\n` `\r`)을 모두 줄로 보고 `\n` 으로 합쳐 조용히 바꾼다. 붙여 넣은 글은 문서의 줄 끝으로
 * 맞춘다(`clipboardInputFilter`). 끝 개행은 마지막 빈 줄로 들고 있어 그대로 나간다.
 */

import { Compartment, EditorState, type Extension, type Range, StateEffect, StateField, Text } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  GutterMarker,
  drawSelection,
  gutter,
  hoverTooltip,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  type KeyBinding,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap, indentWithTab, redo, redoDepth, selectAll, undo, undoDepth } from "@codemirror/commands";
import {
  HighlightStyle,
  StreamLanguage,
  bracketMatching,
  indentUnit,
  syntaxHighlighting,
  type StreamParser,
} from "@codemirror/language";
import { openSearchPanel, search, searchKeymap } from "@codemirror/search";
import { tags } from "@lezer/highlight";
import { normalizeEol, type Eol } from "$lib/doc-edit";
import { docFormatEdit, type DocFormat } from "$lib/doc-format";
import { lineMarks, type RunMark, type StmtStatus } from "$lib/query/run-panel";

export interface EditorOptions {
  text: string;
  eol: Eol;
  /** Tab 이 넣을 들여쓰기(`"\t"` 또는 공백들) */
  indent: string;
  /** 편집기 언어 이름(`editorLangOf`) — 모르면 `null`(평문) */
  lang: string | null;
  /** 강조를 끌 만큼 큰가(`tooLargeToHighlight`) — 참이면 언어를 붙이지 않는다 */
  plain: boolean;
  /** 검색 패널 등의 문구(영어 원문 → 화면 문구) */
  phrases: Record<string, string>;
  onsave: () => void;
  /** 저장해 둔 글과 달라졌는가가 바뀔 때 */
  ondirty: (dirty: boolean) => void;
  /** 글이 바뀌었다(타자 하나하나) — 미리 보기가 디바운스해 다시 그린다. 글은 [`EditorHandle.getText`] 로 묻는다 */
  onchange?: () => void;
  /** 커서(주 선택의 머리)가 있는 줄이 바뀌었다 — 0 기준 */
  oncursor?: (line: number) => void;
  /** 스크롤해서 보이는 줄의 범위(맨 위 · 맨 아래)가 바뀌었다 — 0 기준, 그림 틀마다 많아야 한 번 */
  onviewport?: (top: number, bottom: number) => void;
  /**
   * 부르는 쪽의 키 — 편집기 기본 키맵보다 **먼저** 잡는다(쿼리 타일의 `Mod-Enter` 실행 · `Escape` 취소). `run` 이 `false` 를
   * 돌려주면 그 키는 편집기의 것으로 넘어간다(예: 실행 중이 아닐 때의 `Escape` 는 검색 패널 닫기).
   */
  keys?: { key: string; run: () => boolean }[];
  /** 읽기 전용 — 고르기 · 복사 · 검색은 되고 고치기는 안 된다(쿼리 타일의 DDL 보기). 글은 [`EditorHandle.setText`] 로만 바뀐다 */
  readOnly?: boolean;
  /**
   * 실행 표시(쿼리 타일 10-14) — 줄 번호 옆 거터(✓ ↶ ✕ · ?) · 연한 줄 바탕 · 실패 문장 물결 밑줄과 말풍선을 켠다
   * ([`EditorHandle.setRunMarks`]). 글이 바뀌면 저절로 지워진다.
   */
  runMarks?: boolean;
  /** 처음 글의 열쇠 — 여러 글을 한 편집기에서 바꿔 끼울 때([`EditorHandle.switchDoc`] — 쿼리 타일의 스크립트 탭) */
  docKey?: string;
}

export interface EditorHandle {
  /** 지금 글(줄 끝은 원문의 것) */
  getText(): string;
  /** 이 글을 저장했다 — 기준을 옮기고 dirty 를 다시 잰다(저장 사이에 친 글은 dirty 로 남는다) */
  markSaved(text: string): void;
  /** 커서가 있는 줄 — 0 기준 */
  cursorLine(): number;
  focus(): void;
  /** 검색 패널을 열고 그 칸으로 포커스 — 편집기 밖에서 누른 `Ctrl+F` */
  openSearch(): void;
  /** 그 줄(0 기준)의 글(줄 끝 글자 없이) — 없는 줄이면 `null` */
  lineText(line: number): string | null;
  /**
   * 그 줄(0 기준) 안 `[from, to)` 열을 `insert` 로 바꾼다 — 사람이 친 것과 같이 **되돌리기 기록에 남는다**(미리 보기의
   * 체크박스). 커서 · 포커스는 옮기지 않는다. 줄 · 열이 범위 밖이면 `false`
   */
  replaceInLine(line: number, from: number, to: number, insert: string): boolean;
  /** 글자 크기가 바뀌었다(CSS 변수 — 편집기는 모른다) — 줄 높이 · 글자 폭을 다시 잰다 */
  remeasure(): void;
  /** 주 선택의 범위(글자 위치 — `from` 은 닻, `to` 는 머리 · 빈 선택이면 둘이 같다) */
  selection(): { from: number; to: number };
  /** 글 전체를 바꾼다 — 사람이 친 것과 같이 되돌리기 기록에 남고 커서는 끝으로 */
  setText(text: string): void;
  /** 주 선택을 글자로 바꾼다(빈 선택이면 커서 자리에 넣는다) — 되돌리기 기록에 남고 커서는 넣은 글 뒤로(쿼리 타일 스키마 트리) */
  insertText(text: string): void;
  /** 그 글자 위치에 글자를 넣는다(선택은 건드리지 않고 넣은 글 뒤로 커서) — 되돌리기 기록에 남는다(쿼리 타일의 [편집기에 넣기]) */
  insertAt(pos: number, text: string): void;
  /** 그 범위를 고르고 보이게 굴린다(글은 바꾸지 않는다 — 쿼리 타일 스크립트 결과의 문장 짚기). 범위는 글 길이 안으로 자른다 */
  select(from: number, to: number): void;
  /** 언어를 바꾼다(쿼리 타일 — 연결이 서야 방언을 안다). `null` 이면 평문 */
  setLang(lang: string | null): void;
  /**
   * 보이는 글을 `key` 의 글로 바꿔 끼운다(쿼리 타일의 스크립트 탭 — 탭마다 되돌리기 기록 · 커서 · 실행 표시가 따로 산다). 지금 글은
   * 그 열쇠로 넣어 두고, `key` 를 처음 보면 `text` 로 새로 만든다. 같은 열쇠면 아무것도 안 한다. `onchange` 는 부르지 않는다
   */
  switchDoc(key: string, text: string): void;
  /** 넣어 둔(또는 지금 보이는) 그 열쇠의 글 — 모르면 `null` */
  textOf(key: string): string | null;
  /** 넣어 둔 글을 버린다(탭 닫기) */
  dropDoc(key: string): void;
  /**
   * 실행 표시를 바꾼다(빈 배열 = 지운다) — `key` 를 주면 넣어 둔 그 글에(지금 보이는 글이면 화면에). `runMarks` 를 켠 편집기만.
   * 자리가 글 밖이면 그 표시만 버린다
   */
  setRunMarks(marks: readonly RunMark[], key?: string): void;
  /** 우클릭 메뉴(문서 타일)의 편집 명령 — 키(`Ctrl+Z` · `Ctrl+Y` · `Ctrl+A`)와 같은 명령이다. 끝나면 편집기로 포커스 */
  command(cmd: "undo" | "redo" | "selectAll"): void;
  /** 되돌릴 · 다시 할 것이 있나(메뉴의 흐림) */
  historyState(): { undo: boolean; redo: boolean };
  /** 고른 글(여럿이면 주 선택 — 줄 끝은 원문의 것) */
  selectedText(): string;
  /** 마크다운 서식을 주 선택에 건다(`doc-format.ts` — 한 덩어리 · 되돌리기 한 번) */
  format(kind: DocFormat): void;
  destroy(): void;
}

// ── 실행 표시(쿼리 타일 10-14 — 규칙 · 상태 뜻은 `query/run-panel`) ─────────────────────────────

const RUN_GLYPH: Record<StmtStatus, string> = { ok: "✓", undone: "↶", failed: "✕", skipped: "·", unknown: "?" };

interface RunView {
  /** 0 기준 줄 → 그 줄의 표시 */
  lines: Map<number, { status: StmtStatus; tint: boolean; message?: string }>;
  /** 실패 문장 자리(말풍선) */
  errors: { from: number; to: number; message: string }[];
  deco: DecorationSet;
}

const RUN_EMPTY: RunView = { lines: new Map(), errors: [], deco: Decoration.none };
const setRun = StateEffect.define<readonly RunMark[]>();

function buildRun(state: EditorState, marks: readonly RunMark[]): RunView {
  const len = state.doc.length;
  const ok = marks.filter((m) => m.from >= 0 && m.to <= len && m.to > m.from);
  if (ok.length === 0) return RUN_EMPTY;
  const lines = lineMarks(ok, (pos) => state.doc.lineAt(pos).number - 1);
  const ranges: Range<Decoration>[] = [];
  for (const [line, m] of lines) {
    const at = state.doc.line(line + 1).from;
    ranges.push(Decoration.line({ class: `cm-run-${m.status}${m.tint ? " cm-run-tint" : ""}` }).range(at));
  }
  const errors: RunView["errors"] = [];
  for (const m of ok) {
    if (m.status !== "failed") continue;
    ranges.push(Decoration.mark({ class: "cm-run-err" }).range(m.from, m.to));
    if (m.message) errors.push({ from: m.from, to: m.to, message: m.message });
  }
  return { lines, errors, deco: Decoration.set(ranges, true) };
}

const runField = StateField.define<RunView>({
  create: () => RUN_EMPTY,
  update(v, tr) {
    for (const e of tr.effects) if (e.is(setRun)) return buildRun(tr.state, e.value);
    return tr.docChanged ? RUN_EMPTY : v;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

class RunMarker extends GutterMarker {
  constructor(
    readonly status: StmtStatus,
    readonly message?: string,
  ) {
    super();
  }
  eq(o: RunMarker): boolean {
    return o.status === this.status && o.message === this.message;
  }
  toDOM(): Node {
    const el = document.createElement("span");
    el.className = `cm-run-mark cm-run-mark-${this.status}`;
    el.textContent = RUN_GLYPH[this.status];
    if (this.message) el.title = this.message;
    return el;
  }
}

/** 실행 표시 확장 — 필드 · 거터(줄 번호 오른쪽) · 실패 말풍선 */
function runExtensions(): Extension[] {
  return [
    runField,
    gutter({
      class: "cm-run-gutter",
      lineMarker(view, line) {
        const m = view.state.field(runField).lines.get(view.state.doc.lineAt(line.from).number - 1);
        return m ? new RunMarker(m.status, m.message) : null;
      },
      lineMarkerChange: (u) => u.startState.field(runField) !== u.state.field(runField),
      initialSpacer: () => new RunMarker("ok"),
    }),
    hoverTooltip((view, pos) => {
      const hit = view.state.field(runField).errors.find((e) => pos >= e.from && pos <= e.to);
      if (!hit) return null;
      return {
        pos: hit.from,
        end: hit.to,
        above: true,
        create: () => {
          const dom = document.createElement("div");
          dom.className = "cm-run-tip";
          dom.textContent = hit.message;
          return { dom };
        },
      };
    }),
  ];
}

/** 편집기 언어 이름 → StreamParser (받는 것은 그때 한 번) */
async function parserFor(lang: string): Promise<StreamParser<unknown> | null> {
  switch (lang) {
    case "markdown":
      return (await import("$lib/doc-editor-markdown")).markdownMode as StreamParser<unknown>;
    case "bash":
      return (await import("@codemirror/legacy-modes/mode/shell")).shell;
    case "powershell":
      return (await import("@codemirror/legacy-modes/mode/powershell")).powerShell;
    case "python":
      return (await import("@codemirror/legacy-modes/mode/python")).python;
    case "javascript":
      return (await import("@codemirror/legacy-modes/mode/javascript")).javascript;
    case "typescript":
      return (await import("@codemirror/legacy-modes/mode/javascript")).typescript;
    case "json":
      return (await import("@codemirror/legacy-modes/mode/javascript")).json;
    case "yaml":
      return (await import("@codemirror/legacy-modes/mode/yaml")).yaml;
    case "toml":
      return (await import("@codemirror/legacy-modes/mode/toml")).toml;
    case "ini":
      return (await import("@codemirror/legacy-modes/mode/properties")).properties;
    case "dockerfile":
      return (await import("@codemirror/legacy-modes/mode/dockerfile")).dockerFile;
    case "nginx":
      return (await import("@codemirror/legacy-modes/mode/nginx")).nginx;
    case "rust":
      return (await import("@codemirror/legacy-modes/mode/rust")).rust;
    case "go":
      return (await import("@codemirror/legacy-modes/mode/go")).go;
    case "c":
      return (await import("@codemirror/legacy-modes/mode/clike")).c;
    case "cpp":
      return (await import("@codemirror/legacy-modes/mode/clike")).cpp;
    case "java":
      return (await import("@codemirror/legacy-modes/mode/clike")).java;
    case "sql":
      return (await import("@codemirror/legacy-modes/mode/sql")).standardSQL;
    // 쿼리 타일의 방언 셋(`QueryView` — 연결의 `dialect`)
    case "sql-sqlite":
      return (await import("@codemirror/legacy-modes/mode/sql")).sqlite;
    case "sql-postgres":
      return (await import("@codemirror/legacy-modes/mode/sql")).pgSQL;
    case "sql-mysql":
      return (await import("@codemirror/legacy-modes/mode/sql")).mySQL;
    case "xml":
      return (await import("@codemirror/legacy-modes/mode/xml")).xml;
    case "css":
      return (await import("@codemirror/legacy-modes/mode/css")).css;
    case "diff":
      return (await import("@codemirror/legacy-modes/mode/diff")).diff;
    default:
      return null;
  }
}

/**
 * 강조 색 — `CodeView` 의 hljs 표와 **같은 토큰 매핑**(새 색 없음 · 라이트/다크를 저절로 따른다):
 * 키워드 `--tertiary` · 문자열 `--ok` · 숫자/리터럴 `--warn` · 제목/이름 `--folder` · 속성/내장 `--tertiary`·`--fg` 섞음 ·
 * 주석 `--fg-3` 기울임 · 구두점/메타 `--fg-2` · 삭제/잘못 `--err`.
 */
const MIX = "color-mix(in srgb, var(--tertiary) 55%, var(--fg))";
const highlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.modifier, tags.controlKeyword], color: "var(--tertiary)" },
  { tag: [tags.string, tags.special(tags.string), tags.regexp, tags.inserted], color: "var(--ok)" },
  { tag: [tags.number, tags.bool, tags.atom, tags.null, tags.literal, tags.link, tags.url, tags.list], color: "var(--warn)" },
  {
    tag: [tags.heading, tags.function(tags.variableName), tags.definition(tags.variableName), tags.className, tags.tagName, tags.labelName],
    color: "var(--folder)",
  },
  {
    tag: [tags.typeName, tags.attributeName, tags.propertyName, tags.standard(tags.variableName), tags.special(tags.variableName), tags.namespace],
    color: MIX,
  },
  { tag: [tags.comment, tags.quote], color: "var(--fg-3)", fontStyle: "italic" },
  { tag: [tags.meta, tags.punctuation, tags.processingInstruction, tags.contentSeparator, tags.monospace], color: "var(--fg-2)" },
  { tag: [tags.deleted, tags.invalid], color: "var(--err)" },
  { tag: tags.emphasis, fontStyle: "italic" },
  { tag: tags.strikethrough, textDecoration: "line-through" },
  { tag: [tags.strong, tags.heading], fontWeight: "var(--fw-semibold)" },
]);

/** 편집기 겉모습 — 앱 토큰만. 거터는 `CodeView` 와 같은 바탕·선·글자색 */
const chrome = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--fg-1)",
    backgroundColor: "transparent",
    // 문서 타일의 글자 크기 배율(`DocView` 의 `--doc-zoom`) — 바뀌면 상위가 [`EditorHandle.remeasure`] 로 다시 재게 한다
    fontSize: "calc(var(--t-xs) * var(--doc-zoom, 1))",
  },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--font-mono)", lineHeight: "1.5" },
  ".cm-content": { caretColor: "var(--fg)", padding: "var(--space-2) 0" },
  ".cm-line": { padding: "0 var(--space-3) 0 var(--space-2)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, ::selection": {
    backgroundColor: "var(--accent-soft)",
  },
  ".cm-gutters": {
    color: "var(--fg-3)",
    backgroundColor: "var(--surface-field-solid)",
    borderRight: "1px solid var(--line)",
  },
  ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--surface-hover) 60%, transparent)" },
  ".cm-activeLineGutter": { backgroundColor: "var(--surface-hover)", color: "var(--fg-2)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "var(--accent-soft)", outline: "1px solid var(--accent)" },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "var(--err-soft)" },
  ".cm-searchMatch": { backgroundColor: "var(--warn-soft)", outline: "1px solid var(--warn)" },
  ".cm-searchMatch.cm-searchMatch-selected": { backgroundColor: "var(--accent-soft)" },
  ".cm-panels": { backgroundColor: "var(--bg-panel)", color: "var(--fg-1)", fontFamily: "var(--font-ui)" },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-panels.cm-panels-bottom": { borderTop: "1px solid var(--border)" },
  ".cm-panel.cm-search": { fontSize: "11px", padding: "4px 6px" },
  ".cm-panel.cm-search label": { fontSize: "11px", color: "var(--fg-2)" },
  ".cm-textfield": {
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
    color: "var(--fg)",
    backgroundColor: "var(--surface-field)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
  },
  ".cm-button": {
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
    color: "var(--fg)",
    backgroundImage: "none",
    backgroundColor: "transparent",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
  },
  ".cm-specialChar": { color: "var(--err)" },
  // 실행 표시(쿼리 타일 — `runMarks`) — 의미색 토큰만(라이트 · 다크를 저절로 따른다). 바탕은 아주 옅게.
  ".cm-run-gutter .cm-gutterElement": {
    padding: "0 4px 0 2px",
    textAlign: "center",
    fontFamily: "var(--font-ui)",
    fontWeight: "var(--fw-semibold)",
  },
  ".cm-run-mark-ok": { color: "var(--ok)" },
  ".cm-run-mark-undone": { color: "var(--accent)" },
  ".cm-run-mark-failed": { color: "var(--err)" },
  ".cm-run-mark-skipped": { color: "var(--fg-3)" },
  ".cm-run-mark-unknown": { color: "var(--warn)" },
  ".cm-line.cm-run-tint.cm-run-ok": { backgroundColor: "color-mix(in srgb, var(--ok) 7%, transparent)" },
  ".cm-line.cm-run-tint.cm-run-undone": { backgroundColor: "color-mix(in srgb, var(--accent) 8%, transparent)" },
  ".cm-line.cm-run-tint.cm-run-failed": { backgroundColor: "color-mix(in srgb, var(--err) 11%, transparent)" },
  ".cm-line.cm-run-tint.cm-run-skipped": { opacity: "0.55" },
  ".cm-run-err": { textDecoration: "underline wavy var(--err)", textDecorationSkipInk: "none", textUnderlineOffset: "3px" },
  ".cm-tooltip.cm-tooltip-hover": {
    backgroundColor: "var(--bg-panel)",
    border: "1px solid var(--border)",
    borderRadius: "var(--radius)",
  },
  ".cm-run-tip": {
    maxWidth: "420px",
    padding: "4px 8px",
    fontFamily: "var(--font-ui)",
    fontSize: "11px",
    color: "var(--fg-1)",
    whiteSpace: "pre-wrap",
    wordBreak: "break-word",
  },
});

/** 앱이 이겨야 하는 조합 — `Alt+화살표` 계열 전부(편집기 키맵에서 뺀다) */
function takesAppKey(b: KeyBinding): boolean {
  const keys = [b.key, b.win, b.linux].filter((k): k is string => typeof k === "string");
  return keys.some((k) => /(^|-)Alt-/.test(k) && /Arrow/.test(k) && !/(^|-)(Mod|Ctrl)-/.test(k));
}

export function createEditor(parent: HTMLElement, o: EditorOptions): EditorHandle {
  const language = new Compartment();
  let base: Text = Text.empty;
  let dirty = false;
  let lastCursor = 0;

  const setDirty = (d: boolean) => {
    if (d === dirty) return;
    dirty = d;
    o.ondirty(d);
  };
  const measure = (doc: Text) => setDirty(doc.length !== base.length || !doc.eq(base));

  const saveKey: KeyBinding = {
    key: "Mod-s",
    preventDefault: true,
    run: () => {
      o.onsave();
      return true;
    },
  };

  const extensions = (): Extension[] => [
    lineNumbers(),
    o.runMarks ? runExtensions() : [],
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    drawSelection(),
    highlightActiveLine(),
    bracketMatching(),
    search({ top: true }),
    keymap.of([...(o.keys ?? []).map((k): KeyBinding => ({ key: k.key, preventDefault: false, run: () => k.run() })), saveKey]),
    keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap, indentWithTab].filter((b) => !takesAppKey(b))),
    syntaxHighlighting(highlightStyle),
    chrome,
    language.of([]),
    EditorState.lineSeparator.of(o.eol),
    indentUnit.of(o.indent),
    EditorState.tabSize.of(o.indent === "\t" ? 4 : o.indent.length || 4),
    EditorState.phrases.of(o.phrases),
    EditorState.readOnly.of(o.readOnly === true),
    EditorView.clipboardInputFilter.of((text) => normalizeEol(text, o.eol)),
    EditorView.contentAttributes.of({ spellcheck: "false", autocorrect: "off", autocapitalize: "off" }),
    EditorView.updateListener.of((u) => {
      if (u.docChanged) {
        measure(u.state.doc);
        o.onchange?.();
      }
      if (u.docChanged || u.selectionSet) {
        const line = u.state.doc.lineAt(u.state.selection.main.head).number - 1;
        if (line !== lastCursor) {
          lastCursor = line;
          o.oncursor?.(line);
        }
      }
    }),
  ];

  const view = new EditorView({ parent, state: EditorState.create({ doc: o.text, extensions: extensions() }) });
  base = view.state.doc;

  // 보이는 줄 범위 — 스크롤 사건마다 재지 않고 그림 틀에 한 번. 같은 범위면 알리지 않는다
  let viewFrame = 0;
  let lastView = "";
  const lineAtHeight = (h: number) => view.state.doc.lineAt(view.lineBlockAtHeight(Math.max(0, h)).from).number - 1;
  const onScroll = () => {
    if (viewFrame || !o.onviewport) return;
    viewFrame = requestAnimationFrame(() => {
      viewFrame = 0;
      const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
      const first = lineAtHeight(top);
      const last = lineAtHeight(top + view.scrollDOM.clientHeight - 1);
      const key = `${first}:${last}`;
      if (key === lastView) return;
      lastView = key;
      o.onviewport?.(first, last);
    });
  };
  view.scrollDOM.addEventListener("scroll", onScroll, { passive: true });

  let destroyed = false;
  // 마지막으로 청한 언어 — 늦게 받은 옛 언어가 새 언어를 덮지 않게
  let wantLang: string | null = null;
  // 지금 건 언어 — 바꿔 끼운 글(`switchDoc`)에도 다시 건다
  let langExt: Extension = [];
  const applyLang = (lang: string | null) => {
    wantLang = lang;
    if (!lang) {
      langExt = [];
      view.dispatch({ effects: language.reconfigure([]) });
      return;
    }
    void parserFor(lang)
      .then((p) => {
        if (!p || destroyed || wantLang !== lang) return;
        langExt = StreamLanguage.define(p);
        view.dispatch({ effects: language.reconfigure(langExt) });
      })
      .catch((e: unknown) => console.warn(`[aynx] 편집기 언어를 받지 못했습니다: ${lang}`, e));
  };
  if (o.lang && !o.plain) applyLang(o.lang);

  // 바꿔 끼우는 글들(스크립트 탭) — 보이는 글의 열쇠와 넣어 둔 상태
  let docKey = o.docKey ?? "";
  const stash = new Map<string, EditorState>();

  return {
    // `doc.toString()` 은 언제나 LF 로 잇는다 — `sliceDoc()` 이 lineSeparator 로 잇는다(줄 끝 보존)
    getText: () => view.state.sliceDoc(),
    markSaved(text: string) {
      base = view.state.toText(text);
      measure(view.state.doc);
    },
    cursorLine: () => view.state.doc.lineAt(view.state.selection.main.head).number - 1,
    focus: () => view.focus(),
    openSearch() {
      view.focus();
      openSearchPanel(view);
    },
    lineText(line: number) {
      const doc = view.state.doc;
      if (!Number.isInteger(line) || line < 0 || line >= doc.lines) return null;
      return doc.line(line + 1).text;
    },
    replaceInLine(line: number, from: number, to: number, insert: string) {
      const doc = view.state.doc;
      if (!Number.isInteger(line) || line < 0 || line >= doc.lines) return false;
      const l = doc.line(line + 1);
      if (from < 0 || to < from || l.from + to > l.to) return false;
      view.dispatch({ changes: { from: l.from + from, to: l.from + to, insert }, userEvent: "input" });
      return true;
    },
    remeasure: () => view.requestMeasure(),
    command(cmd) {
      view.focus();
      if (cmd === "undo") undo(view);
      else if (cmd === "redo") redo(view);
      else selectAll(view);
    },
    historyState: () => ({ undo: undoDepth(view.state) > 0, redo: redoDepth(view.state) > 0 }),
    selectedText() {
      const m = view.state.selection.main;
      return view.state.sliceDoc(m.from, m.to);
    },
    format(kind: DocFormat) {
      const m = view.state.selection.main;
      const e = docFormatEdit(view.state.doc.toString(), m.anchor, m.head, kind);
      view.focus();
      view.dispatch({
        changes: { from: e.from, to: e.to, insert: normalizeEol(e.insert, o.eol) },
        selection: { anchor: e.anchor, head: e.head },
        userEvent: "input",
        scrollIntoView: true,
      });
    },
    selection() {
      const m = view.state.selection.main;
      return { from: m.anchor, to: m.head };
    },
    setText(text: string) {
      const insert = normalizeEol(text, o.eol);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert },
        selection: { anchor: insert.length },
        userEvent: "input",
        scrollIntoView: true,
      });
    },
    insertText(text: string) {
      view.dispatch(view.state.replaceSelection(normalizeEol(text, o.eol)), { userEvent: "input", scrollIntoView: true });
    },
    insertAt(pos: number, text: string) {
      const at = Math.max(0, Math.min(pos, view.state.doc.length));
      const insert = normalizeEol(text, o.eol);
      view.dispatch({ changes: { from: at, insert }, selection: { anchor: at + insert.length }, userEvent: "input", scrollIntoView: true });
    },
    select(from: number, to: number) {
      const len = view.state.doc.length;
      const a = Math.max(0, Math.min(from, len));
      const h = Math.max(a, Math.min(to, len));
      view.dispatch({ selection: { anchor: a, head: h }, scrollIntoView: true });
    },
    setLang: (lang: string | null) => applyLang(lang),
    switchDoc(key: string, text: string) {
      if (key === docKey) return;
      stash.set(docKey, view.state);
      const next = stash.get(key) ?? EditorState.create({ doc: normalizeEol(text, o.eol), extensions: extensions() });
      stash.delete(key);
      docKey = key;
      view.setState(next);
      view.dispatch({ effects: language.reconfigure(langExt) });
    },
    textOf(key: string) {
      if (key === docKey) return view.state.sliceDoc();
      return stash.get(key)?.sliceDoc() ?? null;
    },
    dropDoc(key: string) {
      stash.delete(key);
    },
    setRunMarks(marks: readonly RunMark[], key?: string) {
      if (key === undefined || key === docKey) {
        if (view.state.field(runField, false) !== undefined) view.dispatch({ effects: setRun.of(marks) });
        return;
      }
      const s = stash.get(key);
      if (s && s.field(runField, false) !== undefined) stash.set(key, s.update({ effects: setRun.of(marks) }).state);
    },
    destroy() {
      destroyed = true;
      if (viewFrame) cancelAnimationFrame(viewFrame);
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
    },
  };
}
