import { invoke } from "../ipc";
import { gitHeadKey, parseGitHead, shouldReadHead, type GitHead } from "$lib/pane-chips";

/**
 * **타일 머리줄 브랜치 칩의 재료** — (로컬/원격 호스트, 폴더) → 그 폴더가 선 git HEAD 캐시 (2026-10-11, 목업 E2).
 *
 * 로컬은 `git_head`, 원격은 **그 타일의 세션**으로 `ssh_git_head`(exec 왕복 하나 — 새 접속을 열지 않는다). 둘 다
 * `src-tauri/src/git_repo.rs`. 규칙(글자 · 묶기 판정)은 순수 층 `$lib/pane-chips`.
 *
 * ## 언제 읽나 — 주기 폴링 없음
 *
 * - 머리줄이 칩을 **세울 때** · 그 타일의 폴더가 **바뀔 때**(셸 통합 OSC 7 · 9;9) — 머리줄의 `$effect` 가 [`watchPaneGit`]
 * - **에이전트 턴이 끝날 때** — [`refreshPaneGitAfterTurn`](`app/agent-status` 가 워크트리 배지와 같은 자리에서 부른다)
 * - **창이 포커스를 되찾을 때** — 지켜보는 열쇠 전부(창 밖 터미널·편집기에서 브랜치를 바꿨을 수 있다)
 * - **칩에 손을 얹을 때** — [`refreshPaneGit`]
 *
 * 같은 열쇠는 왕복이 떠 있거나 마지막으로 읽은 지 [`GAP_MS`] 가 안 됐으면 다시 묻지 않는다(셋이 한꺼번에 와도 git 은 한 번).
 * 머리줄이 없으면(`[app] tile_header` · 타일 닫힘) 지켜보는 것이 없어 아무것도 읽지 않는다.
 *
 * 화면 전용 값이다 — 저장하지 않고 창 이관 짐에도 싣지 않는다.
 */

/** 같은 열쇠를 다시 묻지 않는 간격 */
const GAP_MS = 2000;

/** 열쇠 → HEAD. 반응형 — 머리줄이 읽는다 */
const heads = $state<Record<string, GitHead>>({});
const lastAt = new Map<string, number>();
const inflight = new Set<string>();

interface Watch {
  paneId: string;
  key: string;
  /** 원격이면 별칭(빠른 접속은 화면의 `user@host:port`), 로컬이면 `null` */
  host: string | null;
  path: string;
  /** 원격 왕복에 빌릴 그 타일의 세션 — 없으면 원격은 묻지 않는다 */
  sessionId: number | null;
}

const watches = new Map<number, Watch>();
let nextWatch = 1;
let focusHooked = false;

async function read(w: Watch, force = false): Promise<void> {
  const now = Date.now();
  if (!shouldReadHead({ now, lastAt: force ? undefined : lastAt.get(w.key), inflight: inflight.has(w.key), gapMs: GAP_MS })) return;
  if (w.host !== null && w.sessionId === null) return;
  inflight.add(w.key);
  lastAt.set(w.key, now);
  let next: GitHead;
  try {
    const raw =
      w.host !== null
        ? await invoke<unknown>("ssh_git_head", { id: w.sessionId, path: w.path })
        : await invoke<unknown>("git_head", { path: w.path });
    next = parseGitHead(raw);
  } catch {
    // 세션이 방금 끊겼다 · 낡은 백엔드 — 모르는 것으로(칩을 거둔다). 틀린 브랜치를 남기는 것보다 낫다.
    next = { kind: "none" };
  } finally {
    inflight.delete(w.key);
  }
  const cur = heads[w.key];
  if (!cur || JSON.stringify(cur) !== JSON.stringify(next)) heads[w.key] = next;
}

function onWindowFocus(): void {
  for (const w of watches.values()) void read(w);
}

/**
 * 머리줄이 이 (호스트, 폴더)의 브랜치를 지켜본다 — 곧바로 한 번 읽고(간격 안이면 캐시), 창 포커스 때 다시 읽는다.
 * 돌려받은 함수로 그만 지켜본다(`$effect` 정리 — 폴더가 바뀌면 새 열쇠로 다시 건다).
 */
export function watchPaneGit(o: { paneId: string; host: string | null; path: string; sessionId: number | null }): () => void {
  const host = o.host?.trim() ? o.host.trim() : null;
  const w: Watch = { paneId: o.paneId, key: gitHeadKey(host, o.path), host, path: o.path.trim(), sessionId: o.sessionId };
  const id = nextWatch++;
  watches.set(id, w);
  if (!focusHooked && typeof window !== "undefined") {
    window.addEventListener("focus", onWindowFocus);
    focusHooked = true;
  }
  void read(w);
  return () => {
    watches.delete(id);
  };
}

/** 그 (호스트, 폴더)의 HEAD — 아직 못 읽었으면 `null`. 반응형 */
export function paneGitHead(host: string | null, path: string): GitHead | null {
  return heads[gitHeadKey(host?.trim() ? host : null, path)] ?? null;
}

/** 칩에 손을 얹었다 — 그 타일이 지켜보는 열쇠를 한 번(간격 안이면 아무것도 하지 않는다) */
export function refreshPaneGit(paneId: string): void {
  for (const w of watches.values()) if (w.paneId === paneId) void read(w);
}

/**
 * 에이전트 턴이 끝났다 — 그 타일이 지켜보는 열쇠를 간격과 상관없이 한 번(턴이 브랜치를 바꿨을 수 있다).
 * 같은 폴더를 보는 다른 타일은 열쇠가 같아 함께 바뀐다.
 */
export function refreshPaneGitAfterTurn(paneId: string): void {
  for (const w of watches.values()) if (w.paneId === paneId) void read(w, true);
}
