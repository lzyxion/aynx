import { invoke } from "../ipc";
import { gitHeadKey, parseGitHead, shouldReadHead, type GitHead } from "$lib/pane-chips";

/**
 * 원격은 그 타일의 세션으로 `ssh_git_head` 를 묻는다 — 새 접속을 열지 않는다. 주기 폴링은 하지 않는다.
 */

const GAP_MS = 2000;

const heads = $state<Record<string, GitHead>>({});
const lastAt = new Map<string, number>();
const inflight = new Set<string>();

interface Watch {
  paneId: string;
  key: string;
  host: string | null;
  path: string;
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
    // 모르는 것으로(칩을 거둔다) — 틀린 브랜치를 남기는 것보다 낫다.
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

export function paneGitHead(host: string | null, path: string): GitHead | null {
  return heads[gitHeadKey(host?.trim() ? host : null, path)] ?? null;
}

export function refreshPaneGit(paneId: string): void {
  for (const w of watches.values()) if (w.paneId === paneId) void read(w);
}

export function refreshPaneGitAfterTurn(paneId: string): void {
  for (const w of watches.values()) if (w.paneId === paneId) void read(w, true);
}
