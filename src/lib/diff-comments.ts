/**
 * diff 줄 코멘트 → AI 타일 입력 줄 붙여넣기의 순수 층 — Enter 는 사람이 누른다.
 * 받을 타일 판정 · 붙여 넣는 길 · 글자 걷기 · 크기 상한은 블록 → AI 타일(`ask-ai`)의 것을 그대로 쓴다.
 */

import { ASK_CAPS, planAskTarget, sanitizeForPaste, type AskCaps, type AskTile } from "$lib/ask-ai";
import { lineKey, type DiffGroup, type DiffLine } from "$lib/diff-view";
import type { DiffScopeKind, Tr } from "$lib/session";

// ── 고른 범위 ──

/** 헝크를 넘어가도 그 사이의 줄은 다 든다(한 줄 보기 차례로 잰다 — 나란히 보기에서도) */
export function selectionKeys(lines: readonly DiffLine[], anchor: string, focus: string): string[] {
  const keys = lines.map(lineKey);
  const a = keys.indexOf(anchor);
  const b = keys.indexOf(focus);
  if (a < 0 || b < 0) return [];
  const [lo, hi] = a <= b ? [a, b] : [b, a];
  return keys.slice(lo, hi + 1);
}

export function linesOf(lines: readonly DiffLine[], keys: readonly string[]): DiffLine[] {
  const want = new Set(keys);
  return lines.filter((l) => want.has(lineKey(l)));
}

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

// ── 코멘트 ──

/**
 * 같은 경로라도 묶음 · 범위가 다르면 다른 diff 라서 같은 줄 열쇠(`옛:새`)가 다른 줄을 가리킨다 —
 * 배지 수 · 카드 자리는 이 자리까지 같을 때만 센다.
 */
export interface DiffCommentWhere {
  scope: DiffScopeKind;
  commit: string | null;
  group: DiffGroup;
}

export function scopeSig(w: Pick<DiffCommentWhere, "scope" | "commit">): string {
  return w.scope === "commit" ? `commit:${w.commit ?? ""}` : w.scope;
}

export function commentEntryKey(w: Pick<DiffCommentWhere, "scope" | "commit" | "group">, path: string): string {
  return `${scopeSig(w)}|${w.group}:${path}`;
}

/** 타일 메모리에만 산다 — 명세 · 배치 파일 · 디스크에 싣지 않는다 */
export interface DiffComment extends DiffCommentWhere {
  id: number;
  path: string;
  keys: string[];
  /** 사본 — 파일을 다시 읽어도 사람이 본 그 줄을 싣는다 */
  lines: DiffLine[];
  label: string;
  text: string;
  sent: boolean;
}

export function commentCounts(comments: readonly DiffComment[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of comments) {
    const k = commentEntryKey(c, c.path);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

export function commentBelongs(c: DiffComment, where: DiffCommentWhere, path: string): boolean {
  return c.path === path && commentEntryKey(c, c.path) === commentEntryKey(where, path);
}

export const fileName = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

// ── 붙여 넣을 글 ──

export const EXCERPT_LINES = 8;
const EXCERPT_LINE_CHARS = 200;

const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳";

export function circled(n: number): string {
  return n >= 1 && n <= 20 ? CIRCLED[n - 1] : `(${n})`;
}

export interface DiffPasteInput {
  branch: string | null;
  scope: DiffScopeKind;
  main: string | null;
  commit: string | null;
  host: string;
  folder: string | null;
  comments: readonly (Pick<DiffComment, "path" | "label" | "lines" | "text"> & Partial<DiffCommentWhere>)[];
}

const encoder = new TextEncoder();
const bytesOf = (s: string): number => encoder.encode(s).length;

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
 * 사람이 쓴 할 말은 자르지 않는다. 남의 글자는 [`sanitizeForPaste`] 로 걷는다(ESC 가 괄호 붙여넣기를 스스로 닫지 못하게).
 * 끝은 줄바꿈 하나 — Enter 는 사람이 누른다.
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

// ── 받을 곳 ──

export interface DiffTargets {
  tiles: AskTile[];
  same: Set<string>;
  /** 없으면 -1 — 받을 타일이 없어 [복사] 만 */
  selected: number;
}

/** diff 타일 자신은 받을 곳이 아니다 */
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
