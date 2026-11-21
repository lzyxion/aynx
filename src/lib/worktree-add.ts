// 새 워크트리 브랜치 콤보박스의 줄 짓기 — 판정의 원본은 실행 때의 Rust `worktree_branch::plan_add` 이고 여기는 같은 표로 미리 보여 줄 뿐이다.
// fetch 는 없다 — 이미 받아 둔 참조만.
import { worktreeNameProblem } from "$lib/projects";

/** Rust `AddPreview` */
export interface AddPreview {
  main: string | null;
  local: string[];
  /** `<원격>/<이름>` */
  remote: string[];
  checkedOut: string[];
}

function strings(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x !== "") : [];
}

export function parseAddPreview(raw: unknown): AddPreview {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    main: typeof o.main === "string" && o.main !== "" ? o.main : null,
    local: strings(o.local),
    remote: strings(o.remote),
    checkedOut: strings(o.checked_out),
  };
}

/** 원격 이름은 첫 `/` 에서 자른다 — Rust `parse_refs` 와 같다 */
function branchOfRemote(ref: string): string {
  const i = ref.indexOf("/");
  return i < 0 ? "" : ref.slice(i + 1);
}

/** `remote` 를 고르면 `<이름>` 을 넘긴다 — 그래야 Rust 가 원격 추적 갈래로 간다 */
export type WorktreeRow =
  | { kind: "create"; name: string; main: string | null }
  | { kind: "local"; name: string }
  | { kind: "remote"; name: string; ref: string }
  | { kind: "busy"; name: string }
  | { kind: "ambiguous"; name: string; refs: string[] };

export function rowSelectable(r: WorktreeRow): boolean {
  return r.kind === "create" || r.kind === "local" || r.kind === "remote";
}

export function rowKey(r: WorktreeRow): string {
  return r.kind === "remote" ? `remote:${r.ref}` : `${r.kind}:${r.name}`;
}

/** 로컬과 같은 이름의 원격 줄은 빠진다 — 로컬이 이긴다(Rust `plan_add` 와 같다) */
export function worktreeRows(text: string, p: AddPreview): WorktreeRow[] {
  const typed = text.trim();
  const q = typed.toLowerCase();
  const localSet = new Set(p.local);
  const busy = new Set(p.checkedOut);
  const pool: WorktreeRow[] = [];
  for (const b of p.local) {
    if (b === p.main && b !== typed) continue;
    pool.push(busy.has(b) ? { kind: "busy", name: b } : { kind: "local", name: b });
  }
  const refsOf = new Map<string, string[]>();
  for (const r of p.remote) {
    const b = branchOfRemote(r);
    if (!b || b === "HEAD" || localSet.has(b)) continue;
    refsOf.set(b, [...(refsOf.get(b) ?? []), r]);
  }
  for (const [b, refs] of refsOf) {
    if (b === p.main && b !== typed) continue;
    pool.push(refs.length === 1 ? { kind: "remote", name: b, ref: refs[0] } : { kind: "ambiguous", name: b, refs });
  }
  const lower = (r: WorktreeRow) => r.name.toLowerCase();
  const exact = pool.filter((r) => r.name === typed);
  const prefix = pool.filter((r) => r.name !== typed && lower(r).startsWith(q));
  const inner = pool.filter((r) => r.name !== typed && !lower(r).startsWith(q) && lower(r).includes(q));
  const rows = q ? [...exact, ...prefix, ...inner] : pool;
  const known = typed !== "" && (localSet.has(typed) || refsOf.has(typed) || typed === p.main);
  if (typed !== "" && !known && worktreeNameProblem(typed) === null) {
    return [{ kind: "create", name: typed, main: p.main }, ...rows];
  }
  return rows;
}

export function firstSelectableRow(rows: readonly WorktreeRow[]): number {
  return rows.findIndex(rowSelectable);
}

/** 빈 칸이면 강조 없음 — 기본 강조를 두면 상자를 열고 Enter 한 번에 첫 브랜치가 열린다 */
export function defaultRow(text: string, rows: readonly WorktreeRow[]): number {
  return text.trim() === "" ? -1 : firstSelectableRow(rows);
}

export function stepSelectableRow(rows: readonly WorktreeRow[], at: number, dir: 1 | -1): number {
  const n = rows.length;
  if (n === 0 || !rows.some(rowSelectable)) return -1;
  let i = at < 0 || at >= n ? (dir === 1 ? -1 : 0) : at;
  for (let k = 0; k < n; k++) {
    i = (i + dir + n) % n;
    if (rowSelectable(rows[i])) return i;
  }
  return -1;
}
