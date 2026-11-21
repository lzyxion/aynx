/** 타일 머리줄의 폴더 칩 · 브랜치 칩 규칙 — 읽기는 `app/pane-git.svelte.ts` */

/** Rust `git_repo::GitHead` 와 1:1 */
export type GitHead = { kind: "branch"; name: string } | { kind: "detached"; sha: string } | { kind: "none" };

const NONE: GitHead = { kind: "none" };

/** Rust `head_word` 와 같은 규칙 */
function word(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const w = v.trim();
  return w !== "" && !/[\s\u0000-\u001f\u007f]/.test(w) ? w : null;
}

export function parseGitHead(raw: unknown): GitHead {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  if (o.kind === "branch") {
    const name = word(o.name);
    return name ? { kind: "branch", name } : NONE;
  }
  if (o.kind === "detached") {
    const sha = word(o.sha);
    return sha ? { kind: "detached", sha } : NONE;
  }
  return NONE;
}

/** 모르면 `null` — 틀린 값보다 칩이 없는 편이 낫다 */
export function branchChipText(head: GitHead | null | undefined): string | null {
  if (!head) return null;
  if (head.kind === "branch") return head.name;
  if (head.kind === "detached") return head.sha;
  return null;
}

/** 구분자는 `/`·`\` 둘 다(WSL `\\wsl.localhost\…` · 원격 · Windows) */
export function folderNameOf(path: string | null | undefined): string {
  const p = (path ?? "").trim();
  if (p === "") return "";
  const trimmed = p.replace(/[\\/]+$/, "");
  if (trimmed === "") return p.startsWith("\\") ? "\\" : "/";
  const parts = trimmed.split(/[\\/]+/);
  return parts[parts.length - 1] ?? trimmed;
}

/** tmux 타일은 모름이다 — 시작 폴더가 tmux 세션의 지금 자리를 말하지 못한다 */
export function chipFolder(o: { reported: string | null | undefined; start: string | null | undefined; tmux?: boolean }): string | null {
  if (o.tmux) return null;
  const r = o.reported?.trim();
  if (r) return r;
  const s = o.start?.trim();
  return s ? s : null;
}

export function folderUnknownTipKey(o: { tmux: boolean }): "pane.header.folder.unknown.tmux" | "pane.header.folder.unknown.shell" {
  return o.tmux ? "pane.header.folder.unknown.tmux" : "pane.header.folder.unknown.shell";
}

/** 원격 호스트는 대소문자를 무시한다 */
export function gitHeadKey(host: string | null | undefined, path: string): string {
  const h = host?.trim().toLowerCase() ?? "";
  return `${h}\n${path.trim()}`;
}

export function shouldReadHead(o: { now: number; lastAt: number | undefined; inflight: boolean; gapMs: number }): boolean {
  if (o.inflight) return false;
  if (o.lastAt === undefined) return true;
  return o.now - o.lastAt >= o.gapMs;
}
