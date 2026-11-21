/** 편집기 자동완성 — `@codemirror/autocomplete` 를 쥐는 유일한 모듈. `complete` 칸을 받은 편집기만 늦게 받는다(문서 · 파일 편집기는 이 청크를 받지 않는다). */
import { acceptCompletion, autocompletion, type Completion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, tooltips } from "@codemirror/view";
import type { CompleteItem } from "$lib/query/sql-complete";

export type CompleteFn = (text: string, pos: number, explicit: boolean) => Promise<{ from: number; items: CompleteItem[]; partial?: boolean } | null>;

const WORD = /^[\p{L}\p{N}_$]*$/u;

const look = EditorView.theme({
  ".cm-tooltip.cm-tooltip-autocomplete": {
    padding: "var(--space-1)",
    color: "var(--fg-1)",
    backgroundColor: "var(--glass-float, var(--surface-raised-solid))",
    border: "1px solid var(--line-strong)",
    borderRadius: "var(--radius-surface)",
    boxShadow: "var(--shadow-raised)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": {
    maxHeight: "16em",
    minWidth: "220px",
    maxWidth: "min(480px, 80vw)",
    fontFamily: "var(--font-mono)",
    fontSize: "11px",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li": {
    display: "flex",
    alignItems: "center",
    gap: "12px",
    height: "22px",
    padding: "0 var(--space-2)",
    lineHeight: "22px",
    borderRadius: "var(--radius-row)",
    color: "var(--fg-1)",
  },
  ".cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    color: "var(--fg-1)",
    background: "var(--surface-hover)",
  },
  "&.cm-focused .cm-tooltip.cm-tooltip-autocomplete > ul > li[aria-selected]": {
    color: "var(--fg-1)",
    background: "var(--surface-hover)",
  },
  ".cm-completionLabel": { flex: "1 1 auto", minWidth: "0", overflow: "hidden", textOverflow: "ellipsis" },
  ".cm-completionDetail": {
    flex: "0 0 auto",
    marginLeft: "auto",
    fontStyle: "normal",
    fontFamily: "var(--font-ui)",
    fontSize: "10px",
    color: "var(--fg-3)",
  },
  ".cm-completionMatchedText": { textDecoration: "none", fontWeight: "var(--fw-semibold)", color: "var(--fg)" },
  ".cm-completion-keyword .cm-completionLabel": { color: "var(--tertiary)" },
});

export function completeExtension(fn: CompleteFn): Extension {
  const source = async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const r = await fn(ctx.state.doc.toString(), ctx.pos, ctx.explicit);
    if (!r || ctx.aborted || r.items.length === 0) return null;
    const options: Completion[] = r.items.map((i) => ({
      label: i.label,
      type: i.kind,
      ...(i.detail ? { detail: i.detail } : {}),
      ...(i.apply !== undefined && i.apply !== i.label ? { apply: i.apply } : {}),
      ...(i.boost ? { boost: i.boost } : {}),
    }));
    // `partial` 이면 타자마다 다시 묻는다 — 열 읽기가 끝나면 열이 들어온다
    return { from: r.from, options, ...(r.partial ? {} : { validFor: WORD }) };
  };
  return [
    autocompletion({
      override: [source],
      icons: false,
      maxRenderedOptions: 80,
      tooltipClass: () => "menu-surface",
      optionClass: (c) => `cm-completion-${c.type ?? "x"}`,
    }),
    Prec.highest(keymap.of([{ key: "Tab", run: acceptCompletion }])),
    // 쿼리 타일의 편집기 칸이 `overflow: hidden` 이라 그 안에 그리면 말풍선이 잘린다
    tooltips({ parent: document.body }),
    look,
  ];
}
