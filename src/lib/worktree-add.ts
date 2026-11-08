/**
 * **새 워크트리의 브랜치 콤보박스 — 줄 짓기 (순수 층)** (docs/log/2026-10-05-worktree-one-to-one.md).
 *
 * "새 워크트리에서 열기…" 상자(`browser/ProjectMenu.svelte`)의 이름 칸 아래 목록이다 — 줄마다 **그 줄을 고르면 무슨 일이
 * 일어나는지**를 말한다(새로 만들기 · 로컬 브랜치 엶 · 원격을 받아 옴 · 고를 수 없음). 재료는 상자가 열릴 때 한 번
 * 읽는 Rust `AddPreview`(`git_worktree_add_preview` · 원격은 붙은 세션의 `ssh_*` 짝) — 로컬 브랜치 · 원격 추적
 * `<원격>/<이름>` · 주 브랜치 · 체크아웃된 브랜치. 판정의 원본은 실행 때의 Rust `worktree_branch::plan_add` 이고 이 파일은
 * **같은 표**로 미리 보여 줄 뿐이다:
 *
 * | 이름 | 미리 보기 |
 * |---|---|
 * | 로컬 브랜치가 있다 | 있는 브랜치를 엽니다(다른 워크트리에 체크아웃돼 있으면 git 이 거절한다고 덧붙인다) |
 * | 없고 원격 추적이 하나 | `<원격>/<이름>` 을 받아 엽니다 |
 * | 원격 추적이 둘 이상 | 정할 수 없습니다(Rust 가 거절한다) |
 * | 둘 다 없다 | `<주 브랜치>` 에서 새 브랜치를 만듭니다 |
 *
 * 원격 이름은 첫 `/` 에서 자른다(Rust `parse_refs` 와 같다). fetch 는 없다 — 이미 받아 둔 참조만.
 */
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

/** `*_worktree_add_preview` 의 답을 읽는다 (Rust 는 snake_case) — 모양이 어긋난 칸은 빈 값으로 */
export function parseAddPreview(raw: unknown): AddPreview {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    main: typeof o.main === "string" && o.main !== "" ? o.main : null,
    local: strings(o.local),
    remote: strings(o.remote),
    checkedOut: strings(o.checked_out),
  };
}

/** `<원격>/<이름>` 의 `<이름>` — 원격 이름은 첫 `/` 에서 자른다 */
function branchOfRemote(ref: string): string {
  const i = ref.indexOf("/");
  return i < 0 ? "" : ref.slice(i + 1);
}

/**
 * 콤보박스의 줄 하나.
 *
 * - `create` — 친 이름으로 새 브랜치(주 브랜치에서). 친 이름이 비지 않고 · 이름 규칙에 맞고 · 로컬 · 원격 추적 어디에도
 *   없을 때만 맨 위에 선다.
 * - `local` — 있는 로컬 브랜치를 엶. `remote` — 원격에만 있는 것을 받아 옴(고르면 `<이름>` 을 넘긴다 — 그래야 Rust 가
 *   원격 추적 갈래로 간다).
 * - `busy` — 다른 워크트리에 체크아웃돼 있다(git 이 거절한다) · `ambiguous` — 여러 원격에 같은 이름(Rust 가 거절한다).
 *   둘은 **흐리게 보이되 고를 수 없다**(화살표가 건너뛴다).
 */
export type WorktreeRow =
  | { kind: "create"; name: string; main: string | null }
  | { kind: "local"; name: string }
  | { kind: "remote"; name: string; ref: string }
  | { kind: "busy"; name: string }
  | { kind: "ambiguous"; name: string; refs: string[] };

/** 고를 수 있는 줄인가 — `busy` · `ambiguous` 는 아니다 */
export function rowSelectable(r: WorktreeRow): boolean {
  return r.kind === "create" || r.kind === "local" || r.kind === "remote";
}

/** 줄의 열쇠(목록 안에서 하나) */
export function rowKey(r: WorktreeRow): string {
  return r.kind === "remote" ? `remote:${r.ref}` : `${r.kind}:${r.name}`;
}

/**
 * 콤보박스 줄들 (**순수 함수**).
 *
 * - 빈 칸이면 **모든 브랜치**(로컬 + 원격에만 있는 것, 주 브랜치 제외) — 펼친 드롭다운처럼.
 * - 치면 대소문자 무시 부분 일치로 거른다. 차례: 친 글자와 **똑같은 것** → 앞에서 맞는 것 → 안쪽에서 맞는 것
 *   (각 무리 안에서는 로컬 → 원격, git 의 순서). 주 브랜치는 친 글자와 똑같을 때만 보인다(대개 체크아웃돼 있어 `busy`).
 * - 로컬과 같은 이름의 원격 줄은 빠진다(로컬이 이긴다 — Rust `plan_add` 와 같다).
 * - 맨 위의 `create` 줄은 친 이름이 비지 않고 · 이름 규칙에 맞고(`worktreeNameProblem`) · 어떤 브랜치(로컬 · 원격 추적의
 *   짧은 이름 · 주 브랜치)와도 같지 않을 때만.
 */
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

/** 고를 수 있는 첫 줄(없으면 -1) */
export function firstSelectableRow(rows: readonly WorktreeRow[]): number {
  return rows.findIndex(rowSelectable);
}

/**
 * 사람이 아직 옮기지 않았을 때의 강조 줄 — **빈 칸이면 없음(-1)**, 치면 고를 수 있는 첫 줄.
 * 빈 칸은 목록을 보여 줄 뿐이다: 기본 강조를 두면 상자를 열고 Enter 한 번에 첫 브랜치가 열렸다(2026-10-05 실기) —
 * 빈 칸의 Enter 는 예전처럼 "이름을 입력하세요" 다. ↓/↑ 로 옮기면 그때부터 강조가 선다.
 */
export function defaultRow(text: string, rows: readonly WorktreeRow[]): number {
  return text.trim() === "" ? -1 : firstSelectableRow(rows);
}

/** 강조를 ↑(-1)·↓(+1)로 옮긴다 — 고를 수 없는 줄은 건너뛰고 끝에서 돌아온다. 고를 줄이 없으면 -1 */
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
