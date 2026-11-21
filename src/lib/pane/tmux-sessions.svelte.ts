// 머리줄 tmux 칩의 세션 목록 — SSH 세션 id 별 마지막 `tmux ls` 결과.
// 주기 읽기는 없다 — 칩에 개수를 띄우지 않으므로 늘 신선할 이유가 없다.
import { SvelteMap } from "svelte/reactivity";
import { listTmuxSessions, type TmuxSessionInfo } from "$lib/tmux";

const STALE_MS = 30_000;

interface Entry {
  list: TmuxSessionInfo[];
  at: number;
}

const lists = new SvelteMap<number, Entry>();
const refs = new Map<number, number>();
const inflight = new Set<number>();

export function tmuxSessionsOf(sessionId: number | null): TmuxSessionInfo[] | null {
  return sessionId === null ? null : (lists.get(sessionId)?.list ?? null);
}

export function noteTmuxSessions(sessionId: number, list: readonly TmuxSessionInfo[]): void {
  lists.set(sessionId, { list: [...list], at: Date.now() });
}

async function refresh(sessionId: number): Promise<void> {
  if (inflight.has(sessionId)) return;
  inflight.add(sessionId);
  try {
    const list = await listTmuxSessions(sessionId);
    if (refs.has(sessionId)) noteTmuxSessions(sessionId, list);
  } catch {
    // 앞의 값을 그대로 둔다 — 카드가 깜빡 사라지는 것보다 잠깐 낡은 편이 낫다
  } finally {
    inflight.delete(sessionId);
  }
}

export function refreshTmuxSessionsIfStale(sessionId: number): void {
  const e = lists.get(sessionId);
  if (e && Date.now() - e.at < STALE_MS) return;
  void refresh(sessionId);
}

export interface TmuxCardView {
  sessions: TmuxSessionInfo[];
  /** `PaneSpec.tmux` */
  current: string;
  anchor: { left: number; top: number; width: number; height: number };
}

export function watchTmuxSessions(sessionId: number): () => void {
  const n = refs.get(sessionId) ?? 0;
  refs.set(sessionId, n + 1);
  if (n === 0) void refresh(sessionId);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const cur = refs.get(sessionId) ?? 0;
    if (cur > 1) {
      refs.set(sessionId, cur - 1);
      return;
    }
    refs.delete(sessionId);
    lists.delete(sessionId);
  };
}
