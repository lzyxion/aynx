/**
 * 문서 편집기 몸통 — CodeMirror 6 을 쥐는 유일한 모듈. 정적으로 import 하지 않는다(`doc-editor-loader.ts` — 메인 청크에 들지 않게).
 * `Alt+화살표` 계열은 편집기 키맵에서 뺀다 — 앱의 타일 포커스 · 옮기기가 이긴다.
 * `lineSeparator` 는 `\n` 이어도 늘 명시한다 — 기본값이면 `\n` `\r\n` `\r` 을 모두 줄로 보고 `\n` 으로 합쳐 소수파 줄 끝을 조용히 바꾼다.
 */

import { Compartment, EditorSelection, EditorState, Prec, type Extension, type Range, StateEffect, StateField, Text } from "@codemirror/state";
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
import {
  defaultKeymap,
  history,
  historyField,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  selectAll,
  undo,
  undoDepth,
} from "@codemirror/commands";
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
import { mdTags } from "$lib/doc-editor-md-tags";
import { normalizeEol, type Eol } from "$lib/doc-edit";
import { docFormatEdit, type DocFormat } from "$lib/doc-format";
import { lineMarks, type RunMark, type StmtStatus } from "$lib/query/run-panel";
import type { CompleteFn } from "$lib/doc-editor-complete";

export interface EditorOptions {
  text: string;
  eol: Eol;
  indent: string;
  lang: string | null;
  /** 참이면 언어를 붙이지 않는다(`tooLargeToHighlight`) */
  plain: boolean;
  phrases: Record<string, string>;
  onsave: () => void;
  ondirty: (dirty: boolean) => void;
  onchange?: () => void;
  oncursor?: (line: number) => void;
  onviewport?: (top: number, bottom: number) => void;
  /** 편집기 기본 키맵보다 먼저 잡는다. `run` 이 `false` 면 그 키는 편집기의 것으로 넘어간다 */
  keys?: { key: string; run: () => boolean }[];
  readOnly?: boolean;
  runMarks?: boolean;
  docKey?: string;
  /** 주면 `doc-editor-complete` 를 늦게 받는다 — 목록이 떠 있을 때의 `Enter` · `Tab` · `Esc` 가 `keys` 보다 먼저다 */
  complete?: CompleteFn;
  /** 주지 않으면 처음 글이 기준. `null` 이면 기준을 모른다 — 저장할 때까지 늘 dirty(`doc-draft.ts`) */
  baseText?: string | null;
  /** 기록이 깨졌거나 이 글과 맞지 않으면 기록 없이, 선택도 맞지 않으면 선택 없이 선다 — 글은 늘 `text` 그대로 */
  restore?: { selection?: unknown; scrollPos?: number; history?: unknown };
}

export interface EditorSnapshot {
  text: string;
  eol: Eol;
  selection: unknown;
  scrollPos: number;
  history: unknown;
}

export interface EditorHandle {
  /** 줄 끝은 원문의 것 */
  getText(): string;
  markSaved(text: string): void;
  cursorLine(): number;
  focus(): void;
  openSearch(): void;
  lineText(line: number): string | null;
  /** 되돌리기 기록에 남는다 · 커서 · 포커스는 옮기지 않는다 */
  replaceInLine(line: number, from: number, to: number, insert: string): boolean;
  /** 글자 크기는 CSS 변수라 편집기가 모른다 — 바뀌면 불러 다시 재게 한다 */
  remeasure(): void;
  /** `from` 은 닻, `to` 는 머리 */
  selection(): { from: number; to: number };
  setText(text: string): void;
  insertText(text: string): void;
  insertAt(pos: number, text: string): void;
  select(from: number, to: number): void;
  setLang(lang: string | null): void;
  /** 열쇠마다 되돌리기 기록 · 커서 · 실행 표시가 따로 산다. `onchange` 는 부르지 않는다 */
  switchDoc(key: string, text: string): void;
  textOf(key: string): string | null;
  dropDoc(key: string): void;
  setRunMarks(marks: readonly RunMark[], key?: string): void;
  command(cmd: "undo" | "redo" | "selectAll"): void;
  historyState(): { undo: boolean; redo: boolean };
  selectedText(): string;
  format(kind: DocFormat): void;
  /** 동기 — 드래그 시작에서 뜬다 */
  snapshot(): EditorSnapshot;
  /** 글이 바뀌면 다른 값이다(`Text` 는 바뀌지 않는 값) */
  docRef(): object;
  /** 사람 입력도 이 손잡이의 고치기도 막는다. 고르기 · 복사는 된다 */
  setFrozen(on: boolean): void;
  destroy(): void;
}

// ── 실행 표시 ─────────────────────────────

const RUN_GLYPH: Record<StmtStatus, string> = { ok: "✓", undone: "↶", failed: "✕", skipped: "·", unknown: "?" };

interface RunView {
  lines: Map<number, { status: StmtStatus; tint: boolean; message?: string }>;
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

/** `CodeView` 의 hljs 표와 같은 토큰 매핑(새 색 없음) */
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
  // 각주 참조 바탕은 선택 바탕 `--accent-soft` 와 겹쳐도 보이게 반투명 섞음
  { tag: mdTags.math, color: "var(--tertiary)" },
  { tag: mdTags.texCommand, color: "color-mix(in srgb, var(--tertiary) 65%, var(--fg))" },
  { tag: mdTags.mathMark, color: "var(--fg-muted)" },
  { tag: mdTags.footnoteRef, color: "var(--accent)", backgroundColor: "color-mix(in srgb, var(--accent) 14%, transparent)", borderRadius: "3px" },
  { tag: mdTags.footnoteDef, color: "var(--accent)" },
]);

const chrome = EditorView.theme({
  "&": {
    height: "100%",
    color: "var(--fg-1)",
    backgroundColor: "transparent",
    // `--doc-zoom` 이 바뀌면 상위가 `remeasure` 로 다시 재게 한다
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

function takesAppKey(b: KeyBinding): boolean {
  const keys = [b.key, b.win, b.linux].filter((k): k is string => typeof k === "string");
  return keys.some((k) => /(^|-)Alt-/.test(k) && /Arrow/.test(k) && !/(^|-)(Mod|Ctrl)-/.test(k));
}

/** `readOnly` 는 우선이 가장 높은 값 하나를 쓴다 — `Prec.highest` 를 빼면 쿼리 타일의 `readOnly: false` 에 진다 */
const frozenExt: Extension = Prec.highest(EditorState.readOnly.of(true));

function initialState(
  text: string,
  extensions: () => Extension[],
  restore: EditorOptions["restore"],
): EditorState {
  const selection = restore?.selection;
  if (restore?.history !== undefined && restore.history !== null) {
    try {
      return EditorState.fromJSON(
        { doc: text, selection: selection ?? EditorSelection.single(0).toJSON(), history: restore.history },
        { extensions: extensions() },
        { history: historyField },
      );
    } catch {
      // 기록 없이
    }
  }
  if (selection !== undefined && selection !== null) {
    try {
      return EditorState.create({ doc: text, selection: EditorSelection.fromJSON(selection), extensions: extensions() });
    } catch {
      // 선택 없이
    }
  }
  return EditorState.create({ doc: text, extensions: extensions() });
}

export function createEditor(parent: HTMLElement, o: EditorOptions): EditorHandle {
  const language = new Compartment();
  const completion = new Compartment();
  // `switchDoc` 의 새 상태에도 다시 건다
  let completeExt: Extension = [];
  let base: Text | null = Text.empty;
  // 사람 입력은 `freezeSlot` 이, 이 손잡이의 고치기는 `frozen` 이 막는다
  const freezeSlot = new Compartment();
  let frozen = false;
  let dirty = false;
  let lastCursor = 0;

  const setDirty = (d: boolean) => {
    if (d === dirty) return;
    dirty = d;
    o.ondirty(d);
  };
  const measure = (doc: Text) => setDirty(base === null || doc.length !== base.length || !doc.eq(base));

  const saveKey: KeyBinding = {
    key: "Mod-s",
    preventDefault: true,
    run: () => {
      o.onsave();
      return true;
    },
  };

  const extensions = (): Extension[] => [
    freezeSlot.of(frozen ? frozenExt : []),
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
    completion.of(completeExt),
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

  const view = new EditorView({ parent, state: initialState(o.text, extensions, o.restore) });
  if (o.baseText === undefined) base = view.state.doc;
  else {
    base = o.baseText === null ? null : view.state.toText(o.baseText);
    measure(view.state.doc);
  }
  const scrollPos = o.restore?.scrollPos;
  if (typeof scrollPos === "number" && scrollPos > 0 && scrollPos <= view.state.doc.length) {
    view.dispatch({ effects: EditorView.scrollIntoView(scrollPos, { y: "start" }) });
  }

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
  // 늦게 받은 옛 언어가 새 언어를 덮지 않게
  let wantLang: string | null = null;
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

  if (o.complete) {
    const fn = o.complete;
    void import("$lib/doc-editor-complete")
      .then((m) => {
        if (destroyed) return;
        completeExt = m.completeExtension(fn);
        view.dispatch({ effects: completion.reconfigure(completeExt) });
      })
      .catch((e: unknown) => console.warn("[aynx] 자동완성을 받지 못했습니다", e));
  }

  let docKey = o.docKey ?? "";
  const stash = new Map<string, EditorState>();

  return {
    // `doc.toString()` 은 언제나 LF 로 잇는다 — 줄 끝 보존은 `sliceDoc()`
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
      if (frozen) return false;
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
      if (frozen) return;
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
      if (frozen) return;
      const insert = normalizeEol(text, o.eol);
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert },
        selection: { anchor: insert.length },
        userEvent: "input",
        scrollIntoView: true,
      });
    },
    insertText(text: string) {
      if (frozen) return;
      view.dispatch(view.state.replaceSelection(normalizeEol(text, o.eol)), { userEvent: "input", scrollIntoView: true });
    },
    insertAt(pos: number, text: string) {
      if (frozen) return;
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
      view.dispatch({ effects: [language.reconfigure(langExt), completion.reconfigure(completeExt)] });
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
    snapshot(): EditorSnapshot {
      const state = view.state;
      let json: { doc: string; selection: unknown; history?: unknown };
      try {
        json = state.toJSON({ history: historyField }) as typeof json;
      } catch {
        json = { doc: state.sliceDoc(), selection: state.selection.toJSON() };
      }
      const top = view.scrollDOM.getBoundingClientRect().top - view.documentTop;
      let scrollPos = 0;
      try {
        scrollPos = view.lineBlockAtHeight(Math.max(0, top)).from;
      } catch {
        scrollPos = 0;
      }
      return { text: json.doc, eol: o.eol, selection: json.selection, scrollPos, history: json.history ?? null };
    },
    docRef: () => view.state.doc,
    setFrozen(on: boolean) {
      if (on === frozen) return;
      frozen = on;
      view.dispatch({ effects: freezeSlot.reconfigure(on ? frozenExt : []) });
    },
    destroy() {
      destroyed = true;
      if (viewFrame) cancelAnimationFrame(viewFrame);
      view.scrollDOM.removeEventListener("scroll", onScroll);
      view.destroy();
    },
  };
}
