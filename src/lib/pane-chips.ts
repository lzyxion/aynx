/**
 * **타일 머리줄의 폴더 칩 · 브랜치 칩 — 규칙만 담은 순수 모듈** (2026-10-11, 목업 E2).
 *
 * 머리줄(`pane/PaneHeader.svelte`)은 모든 터미널 타일(로컬 셸 · 로컬 AI · SSH)에 같은 규칙으로 칩 둘을 세운다:
 *
 * - **폴더 칩** — 지금 폴더(셸 통합 OSC 7 · 9;9)의 **마지막 이름**. 모르면 시작 폴더(`PaneSpec.cwd`). 누르면 예전
 *   📂 머리 버튼이 하던 일(그 터미널의 폴더를 파일 타일로 — `openFilesFor`)을 그대로 한다. 폴더를 모르면 그림만.
 * - **브랜치 칩** — 그 폴더가 선 git HEAD(브랜치 이름 · detached 면 짧은 해시). 저장소가 아니거나 모르면
 *   **그리지 않는다** — 틀린 값보다 없는 편이 낫다.
 *
 * 읽기(Tauri 왕복 · 언제 다시 읽나)는 `app/pane-git.svelte.ts`. 여기는 글자와 판정뿐이다.
 */

/** Rust `git_repo::GitHead` 와 1:1 (`kind` 로 갈린다) */
export type GitHead = { kind: "branch"; name: string } | { kind: "detached"; sha: string } | { kind: "none" };

const NONE: GitHead = { kind: "none" };

/** 칩에 실을 만한 낱말인가 — 비었거나 공백·제어 문자가 끼면 버린다(Rust `head_word` 와 같은 규칙) */
function word(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const w = v.trim();
  return w !== "" && !/[\s\u0000-\u001f\u007f]/.test(w) ? w : null;
}

/** 백엔드의 원시 값 → [`GitHead`]. **throw 하지 않는다** — 모양이 어긋나면 `none` */
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

/** 브랜치 칩의 글자 — 없으면 `null`(칩을 그리지 않는다) */
export function branchChipText(head: GitHead | null | undefined): string | null {
  if (!head) return null;
  if (head.kind === "branch") return head.name;
  if (head.kind === "detached") return head.sha;
  return null;
}

/**
 * 경로의 **마지막 폴더 이름** — 폴더 칩의 글자. 구분자는 `/`·`\` 둘 다 받는다(WSL 의 `\\wsl.localhost\…` ·
 * 원격 `~/src/api` · Windows `C:\Users\me`). 끝의 구분자는 무시한다. 뿌리만 남으면 뿌리 그대로(`/` · `C:` · `~`).
 */
export function folderNameOf(path: string | null | undefined): string {
  const p = (path ?? "").trim();
  if (p === "") return "";
  const trimmed = p.replace(/[\\/]+$/, "");
  if (trimmed === "") return p.startsWith("\\") ? "\\" : "/";
  const parts = trimmed.split(/[\\/]+/);
  return parts[parts.length - 1] ?? trimmed;
}

/**
 * 칩이 기준으로 삼을 폴더 — 셸이 알려 준 지금 폴더 → 시작 폴더 → 모름(`null`).
 * tmux 타일은 셸 통합이 없고 시작 폴더도 tmux 세션의 지금 자리를 말하지 못하므로 **모름**이다(흐린 `folder` · 브랜치 칩 없음).
 */
export function chipFolder(o: { reported: string | null | undefined; start: string | null | undefined; tmux?: boolean }): string | null {
  if (o.tmux) return null;
  const r = o.reported?.trim();
  if (r) return r;
  const s = o.start?.trim();
  return s ? s : null;
}

/**
 * 폴더를 모를 때(`chipFolder` 가 `null`) 칩 말풍선의 **까닭** 사전 열쇠 — tmux 타일은 tmux 안의 폴더를 알 길이 없고,
 * 그 밖은 셸이 아직 폴더를 알려 주지 않았다(OSC 7 · 셸 통합 없음). 칩 글자는 까닭과 무관하게 흐린 `folder` 다.
 */
export function folderUnknownTipKey(o: { tmux: boolean }): "pane.header.folder.unknown.tmux" | "pane.header.folder.unknown.shell" {
  return o.tmux ? "pane.header.folder.unknown.tmux" : "pane.header.folder.unknown.shell";
}

/** 캐시 열쇠 — 로컬은 경로만, 원격은 호스트(대소문자 무시) + 경로 */
export function gitHeadKey(host: string | null | undefined, path: string): string {
  const h = host?.trim().toLowerCase() ?? "";
  return `${h}\n${path.trim()}`;
}

/**
 * 지금 다시 읽어야 하나 — 같은 열쇠의 왕복이 떠 있으면 아니고, 마지막으로 읽은 지 `gapMs` 가 안 됐으면 아니다
 * (cwd 변경 · 포커스 · 호버 · 턴 끝이 한꺼번에 와도 git 은 한 번). 한 번도 안 읽었으면 언제나 읽는다.
 */
export function shouldReadHead(o: { now: number; lastAt: number | undefined; inflight: boolean; gapMs: number }): boolean {
  if (o.inflight) return false;
  if (o.lastAt === undefined) return true;
  return o.now - o.lastAt >= o.gapMs;
}
