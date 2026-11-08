/**
 * **diff 줄 코멘트 → AI 타일** 순수 층 (docs/log/2026-10-05-diff-tile.md "2단계").
 *
 * diff 타일에서 줄을 골라 코멘트를 달고, 모은 코멘트를 **한 덩어리 글**로 AI 타일 입력 줄에 붙여 넣는다(Enter 는 사람).
 * 이 파일은 그 길의 판단만 든다:
 *
 * | 무엇 | 함수 |
 * | --- | --- |
 * | 고른 범위 — 열쇠들 · 줄들 · 이름(`43–45행` · `옛 40행`) | [`selectionKeys`] · [`linesOf`] · [`rangeLabel`] |
 * | 붙여 넣을 글 — 부탁 한 문장(범위 · 호스트 · 폴더) + 코멘트마다 경로 · 줄 · 코드 몇 줄 · 할 말 | [`buildDiffPasteText`] |
 * | 받을 곳의 차례 — 같은 워크트리의 AI 타일이 먼저 · 골라진 채 | [`orderDiffTargets`] |
 *
 * 받을 타일의 판정(`isAgentPane` · `agentKindOf`)과 차례의 바탕(최근에 쓴 것이 위 — [`planAskTarget`]), 붙여 넣는 길(괄호 붙여넣기 ·
 * Enter 없음 — `pasteBytes`), 글자 걷기([`sanitizeForPaste`]) · 크기 상한([`ASK_CAPS`])은 **블록 → AI 타일**
 * (docs/log/2026-09-28-ask-ai-block.md)의 것을 그대로 쓴다.
 *
 * Svelte 를 import 하지 않는다 — vitest 대상이다.
 */

import { ASK_CAPS, planAskTarget, sanitizeForPaste, type AskCaps, type AskTile } from "$lib/ask-ai";
import { lineKey, type DiffGroup, type DiffLine } from "$lib/diff-view";
import type { DiffScopeKind, Tr } from "$lib/session";

// ---------------------------------------------------------------------------
// 고른 범위
// ---------------------------------------------------------------------------

/**
 * 고른 범위의 열쇠들 — `anchor` 와 `focus` 사이(양 끝 포함, 순서 무관). 헝크를 넘어가도 그 사이의 줄은 다 든다(한 줄 보기
 * 차례로 잰다 — 나란히 보기에서도). 모르는 열쇠면 빈 목록.
 */
export function selectionKeys(lines: readonly DiffLine[], anchor: string, focus: string): string[] {
  const keys = lines.map(lineKey);
  const a = keys.indexOf(anchor);
  const b = keys.indexOf(focus);
  if (a < 0 || b < 0) return [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return keys.slice(lo, hi + 1);
}

/** 열쇠들 → 줄들(파일 차례) */
export function linesOf(lines: readonly DiffLine[], keys: readonly string[]): DiffLine[] {
  const want = new Set(keys);
  return lines.filter((l) => want.has(lineKey(l)));
}

/**
 * 범위의 이름 — 새 판 줄 번호가 있으면 그것(`43–45행` · `43행`), 지운 줄만이면 옛 번호(`옛 40행` · `옛 40–42행`).
 * 지운 줄은 옛 번호로 코멘트를 단다(목업 — 나란히 보기에서도 왼쪽에서).
 */
export function rangeLabel(lines: readonly DiffLine[], tr: Tr): string {
  const news = lines.map((l) => l.newNo).filter((n): n is number => n !== null);
  if (news.length > 0) {
    const a = Math.min(...news);
    const b = Math.max(...news);
    return a === b ? tr("app.diff.lines.one", { n: a }) : tr("app.diff.lines.range", { a, b });
  }
  const olds = lines.map((l) => l.oldNo).filter((n): n is number => n !== null);
  if (olds.length === 0) return "";
  const a = Math.min(...olds);
  const b = Math.max(...olds);
  return a === b ? tr("app.diff.lines.oldOne", { n: a }) : tr("app.diff.lines.oldRange", { a, b });
}

// ---------------------------------------------------------------------------
// 코멘트
// ---------------------------------------------------------------------------

/**
 * 코멘트가 달린 **자리** — 범위 · (커밋 범위면) 커밋 · 묶음(커밋된 것 / ✎ 커밋 안 함). 같은 경로라도 묶음 · 범위가 다르면 다른
 * diff 라서 같은 줄 열쇠(`옛:새`)가 다른 줄을 가리킨다 — 배지 수 · 카드 자리는 이 자리까지 같을 때만 센다.
 */
export interface DiffCommentWhere {
  scope: DiffScopeKind;
  commit: string | null;
  group: DiffGroup;
}

/** 자리의 범위 서명 — 커밋 범위는 커밋까지(커밋마다 다른 diff), 나머지는 범위 이름 */
export function scopeSig(w: Pick<DiffCommentWhere, "scope" | "commit">): string {
  return w.scope === "commit" ? `commit:${w.commit ?? ""}` : w.scope;
}

/** 파일 목록 한 줄의 열쇠 — 범위 · 묶음 · 경로 (배지 수 · 카드를 이 열쇠로 가른다) */
export function commentEntryKey(w: Pick<DiffCommentWhere, "scope" | "commit" | "group">, path: string): string {
  return `${scopeSig(w)}|${w.group}:${path}`;
}

/** 코멘트 하나 — **타일 메모리에만** 산다(명세 · 배치 파일 · 디스크에 싣지 않는다 — 타일을 닫으면 사라진다) */
export interface DiffComment extends DiffCommentWhere {
  id: number;
  /** 저장소 뿌리 기준 경로 */
  path: string;
  /** 고른 줄들의 열쇠(파일 차례) — 카드는 마지막 줄 아래에 선다 */
  keys: string[];
  /** 고른 줄들의 사본 — 붙여 넣을 코드 몇 줄의 재료(파일을 다시 읽어도 사람이 본 그 줄이다) */
  lines: DiffLine[];
  /** `43–45행` */
  label: string;
  text: string;
  /** AI 타일에 넘겼다 — 흐리게 · [비우기] 대상 */
  sent: boolean;
}

/** 파일 목록 한 줄의 열쇠([`commentEntryKey`]) → 코멘트 수(배지). 같은 경로라도 묶음 · 범위가 다르면 따로 센다 */
export function commentCounts(comments: readonly DiffComment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of comments) {
    const k = commentEntryKey(c, c.path);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/** 이 코멘트가 지금 보는 파일(범위 · 묶음 · 경로)의 것인가 — 카드는 그럴 때만 선다 */
export function commentBelongs(c: DiffComment, where: DiffCommentWhere, path: string): boolean {
  return c.path === path && commentEntryKey(c, c.path) === commentEntryKey(where, path);
}

/** 경로의 마지막 조각 — 트레이 칩 `refresh.rs 79–80` */
export const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

// ---------------------------------------------------------------------------
// 붙여 넣을 글
// ---------------------------------------------------------------------------

/** 코멘트마다 싣는 코드 줄의 상한 */
export const EXCERPT_LINES = 8;
/** 코드 한 줄의 글자 상한 */
const EXCERPT_LINE_CHARS = 200;

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

/** 번호 — ①…⑳, 그다음은 `(21)` */
export function circled(n: number): string {
  return n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`;
}

/** [`buildDiffPasteText`] 가 보는 것 */
export interface DiffPasteInput {
  /** 그 범위의 브랜치(분리 HEAD 면 `null`) */
  branch: string | null;
  scope: DiffScopeKind;
  /** 주 브랜치 — `branch` 범위의 "main 대비" */
  main: string | null;
  /** `commit` 범위의 커밋 */
  commit: string | null;
  /** "이 PC" 또는 SSH 별칭 */
  host: string;
  /** 워크트리(또는 프로젝트) 폴더 — 모르면 `null` */
  folder: string | null;
  comments: readonly (Pick<DiffComment, "path" | "label" | "lines" | "text"> & Partial<DiffCommentWhere>)[];
}

const encoder = new TextEncoder();
const bytesOf = (s: string): number => encoder.encode(s).length;

/** 코드 줄들 — 공통 들여쓰기를 걷고 `    +   글` 꼴로(목업). 상한을 넘으면 앞 [`EXCERPT_LINES`] 줄 + `    …` */
export function excerptLines(lines: readonly DiffLine[]): string[] {
  const shown = lines.slice(0, EXCERPT_LINES);
  const indent = Math.min(
    ...shown.filter((l) => l.text.trim() !== "").map((l) => l.text.length - l.text.trimStart().length),
    Number.POSITIVE_INFINITY,
  );
  const cut = Number.isFinite(indent) ? indent : 0;
  const out = shown.map((l) => {
    const sign = l.kind === "add" ? "+" : l.kind === "del" ? "-" : " ";
    const body = l.text.slice(Math.min(cut, l.text.length - l.text.trimStart().length));
    const clipped = [...body].length > EXCERPT_LINE_CHARS ? [...body].slice(0, EXCERPT_LINE_CHARS - 1).join("") + "…" : body;
    return `    ${sign}   ${clipped}`.trimEnd();
  });
  if (lines.length > EXCERPT_LINES) out.push("    …");
  return out;
}

/** 범위의 말 — `main 대비` · `커밋 9f8e7d6` · `커밋 안 한 변경`. 브랜치 범위의 ✎ 커밋 안 함 묶음은 `커밋 안 한 변경` */
function scopeWords(
  w: { scope: DiffScopeKind; commit: string | null; group?: DiffGroup },
  main: string | null,
  tr: Tr,
): string {
  if (w.scope === "branch" && w.group !== "uncommitted") return tr("app.diff.paste.scope.branch", { main: main ?? "main" });
  if (w.scope === "commit") return tr("app.diff.paste.scope.commit", { hash: (w.commit ?? "").slice(0, 7) });
  if (w.scope === "range") return tr("app.diff.paste.scope.range", { hash: (w.commit ?? "").slice(0, 7) });
  return tr("app.diff.paste.scope.wip");
}

/**
 * **붙여 넣을 글** — 괄호 붙여넣기 한 덩어리(목업 그대로):
 *
 * ```text
 * feat-retry 브랜치 리뷰 코멘트 2개야. 반영해 줘. (main 대비 · 이 PC · ~/projects/aynx-wt/feat-retry)
 *
 * ① src-tauri/src/auth/refresh.rs 43–45행
 *     +   Ok(t) => break t,
 * → 3 은 설정값으로 빼 줘.
 * ```
 *
 * 코멘트가 다른 자리(다른 커밋 · ✎ 커밋 안 함)에서 달렸으면 그 줄 끝에 `(커밋 9f8e7d6)` 처럼 제 자리를 붙인다.
 * 코드는 코멘트마다 [`EXCERPT_LINES`] 줄까지, 모든 코멘트의 코드를 합쳐 `caps.tailBytes`(블록 → AI 타일의 출력 상한과 같은
 * 8 KB)까지 — 넘으면 그 뒤 코멘트는 코드 없이 "(코드는 길어서 생략)". 사람이 쓴 할 말은 자르지 않는다. 남의 글자는
 * [`sanitizeForPaste`] 로 걷는다(ESC 가 괄호 붙여넣기를 스스로 닫지 못하게). **끝은 줄바꿈 하나** — 커서가 다음 줄에 서서
 * 사람이 한마디 보탠 뒤 Enter 를 누른다.
 */
export function buildDiffPasteText(input: DiffPasteInput, tr: Tr, caps: AskCaps = ASK_CAPS): string {
  const n = input.comments.length;
  const lead = scopeWords(input, input.main, tr);
  const whereParts = [lead, input.host];
  if (input.folder?.trim()) whereParts.push(input.folder.trim());
  const where = whereParts.join(" · ");
  const out: string[] = [];
  out.push(
    input.branch
      ? tr("app.diff.paste.lead", { branch: input.branch, n, where })
      : tr("app.diff.paste.leadNoBranch", { n, where }),
  );
  let budget = caps.tailBytes;
  input.comments.forEach((c, i) => {
    out.push("");
    // 코멘트가 첫 줄과 다른 자리(다른 커밋 · 커밋 안 한 변경)에서 달렸으면 그 자리를 덧붙인다.
    const own = c.scope ? scopeWords({ scope: c.scope, commit: c.commit ?? null, group: c.group }, input.main, tr) : lead;
    const tag = own !== lead ? ` (${own})` : "";
    out.push(`${circled(i + 1)} ${tr("app.diff.paste.at", { path: c.path, range: c.label })}${tag}`);
    const code = excerptLines(c.lines);
    const size = code.reduce((s, l) => s + bytesOf(l) + 1, 0);
    if (code.length > 0 && size <= budget) {
      out.push(...code);
      budget -= size;
    } else if (code.length > 0) {
      out.push(`    ${tr("app.diff.paste.codeOmitted")}`);
      budget = 0;
    }
    const said = c.text.trim().replace(/\r\n?/g, "\n").split("\n");
    out.push(`→ ${said[0] ?? ""}`, ...said.slice(1).map((l) => `  ${l}`));
  });
  return sanitizeForPaste(out.join("\n")) + "\n";
}

// ---------------------------------------------------------------------------
// 받을 곳
// ---------------------------------------------------------------------------

/** [`orderDiffTargets`] 의 답 — `tiles` 차례 그대로 고르개에 그리고 `selected` 를 골라 둔다 */
export interface DiffTargets {
  tiles: AskTile[];
  /** 같은 워크트리의 타일 id 들 — 줄에 "같은 워크트리" */
  same: Set<string>;
  /** 골라진 줄(없으면 -1 — 타일이 하나도 없다: [복사] 만) */
  selected: number;
}

/**
 * **받을 곳의 차례** — 블록 → AI 타일의 [`planAskTarget`] 이 세운 차례(최근에 쓴 것이 위)를 바탕으로, **같은 워크트리의
 * AI 타일**을 맨 앞으로 올리고(그다음 이 탭의 것) 처음부터 골라 둔다. 같은 워크트리가 없으면 마지막에 쓴 타일이 골라진다.
 * 새로 열기 줄은 없다 — AI 타일이 없으면 [복사] 만 남는다(목업). diff 타일 자신은 받을 곳이 아니다.
 */
export function orderDiffTargets(input: {
  tiles: readonly AskTile[];
  sameWorktree: ReadonlySet<string>;
  currentTabId: string | null;
  sourcePaneId: string;
}): DiffTargets {
  // 탭을 가르지 않은 채(currentTabId=null) 부르면 "곧장" 이 없고 모든 타일이 최근 순 줄로 온다.
  const plan = planAskTarget({ tiles: input.tiles, currentTabId: null, sourcePaneId: input.sourcePaneId, clis: [], defaultCli: null });
  if (plan.mode !== "pick") return { tiles: [plan.tile], same: new Set(), selected: 0 };
  const rows = plan.rows.flatMap((r) => (r.kind === "tile" ? [r.tile] : []));
  const lastId = plan.rows[plan.selected]?.kind === "tile" ? (plan.rows[plan.selected] as { tile: AskTile }).tile.paneId : null;
  const rank = (t: AskTile) => (input.sameWorktree.has(t.paneId) ? 0 : t.tabId === input.currentTabId ? 1 : 2);
  const tiles = rows
    .map((t, i) => ({ t, i }))
    .sort((a, b) => rank(a.t) - rank(b.t) || a.i - b.i)
    .map((x) => x.t);
  const same = new Set(tiles.filter((t) => input.sameWorktree.has(t.paneId)).map((t) => t.paneId));
  let selected = tiles.findIndex((t) => same.has(t.paneId));
  if (selected < 0) selected = lastId ? tiles.findIndex((t) => t.paneId === lastId) : -1;
  if (selected < 0 && tiles.length > 0) selected = 0;
  return { tiles, same, selected };
}
