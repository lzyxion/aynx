/**
 * **편집기 자동완성 붙이기** — `@codemirror/autocomplete` 를 쥐는 유일한 모듈. `doc-editor-cm.ts` 가 `complete` 칸을 받은 편집기(쿼리 타일의
 * SQL 편집기)를 만들 때만 늦게 받는다 — 문서 · 파일 편집기는 이 청크를 받지 않는다. 후보는 부르는 쪽 함수(`query/sql-completer`)가 짓는다.
 *
 * 키(목록이 떠 있을 때만 — 없으면 원래 키로 흘러간다): `Enter` · `Tab` = 넣기 · `Esc` = 닫기 · `↑` `↓` `PageUp` `PageDown` = 고르기.
 * `Ctrl+Space` = 부르기. 저절로 뜨는 때는 후보 함수가 정한다(낱말 두 글자 이상 · 점 뒤). 모양은 앱 메뉴(`.menu-surface`)와 같은 토큰.
 * 이 편집기의 말풍선(실패 문장 말풍선 포함)은 `document.body` 에 그린다.
 */
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

/** 자동완성 확장 — `fn` 이 후보를 짓는다 */
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
    // 열을 아직 다 못 읽었으면(`partial`) 타자마다 다시 묻는다 — 읽기가 끝나면 열이 들어온다
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
    // 말풍선은 `body` 에 — 쿼리 타일은 컨테이너 질의 상자(`qtile`) 안이고 편집기 칸이 `overflow: hidden` 이라 그 안이면 잘린다
    tooltips({ parent: document.body }),
    look,
  ];
}
