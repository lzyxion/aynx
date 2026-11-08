// 머리줄 tmux 칩의 **세션 목록** — SSH 세션 id 별로 마지막 `tmux ls` 결과와 그 시각을 들고 있는다.
// 칩 호버 카드(`TmuxSessionsCard`)가 이것을 그린다.
//
// 읽는 때는 셋이다: 칩이 처음 서는 순간(`watchTmuxSessions`) · 목록 팝오버가 읽을 때
// (`noteTmuxSessions` — 같은 왕복을 다시 하지 않는다) · 칩 호버로 카드를 띄울 때 읽은 지
// 30초가 넘었으면 뒤에서 한 번(`refreshTmuxSessionsIfStale` — 카드는 반응형이라 답이 오면 바뀐다).
// 주기 읽기는 없다 — 칩에 개수를 띄우지 않기로 하면서(2026-10-05 사용자) 늘 신선할 이유가 없어졌다.
// 한 창 안에서 같은 세션을 보는 칩이 여럿이어도 값은 하나다(참조 수, 마지막이 빠지면 지운다).
// 못 읽으면 앞의 값을 그대로 둔다 — 카드가 깜빡 사라지는 것보다 잠깐 낡은 편이 낫다.
import { SvelteMap } from "svelte/reactivity";
import { listTmuxSessions, type TmuxSessionInfo } from "$lib/tmux";

/** 호버가 다시 묻기 전까지 믿는 시간 */
const STALE_MS = 30_000;

interface Entry {
  list: TmuxSessionInfo[];
  /** 읽은 시각 (`Date.now()`) */
  at: number;
}

const lists = new SvelteMap<number, Entry>();
const refs = new Map<number, number>();
/** 지금 묻는 중인 세션 — 호버가 겹쳐도 왕복은 하나 */
const inflight = new Set<number>();

/** 이 SSH 세션의 tmux 세션 목록 (아직 못 읽었으면 `null`) */
export function tmuxSessionsOf(sessionId: number | null): TmuxSessionInfo[] | null {
  return sessionId === null ? null : (lists.get(sessionId)?.list ?? null);
}

/** 목록을 읽은 쪽(팝오버)이 결과를 알린다 */
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
    // 앞의 값을 그대로 둔다 (머리말)
  } finally {
    inflight.delete(sessionId);
  }
}

/** 칩 호버 — 읽은 지 오래됐으면(또는 아직 없으면) 뒤에서 한 번 다시 묻는다 */
export function refreshTmuxSessionsIfStale(sessionId: number): void {
  const e = lists.get(sessionId);
  if (e && Date.now() - e.at < STALE_MS) return;
  void refresh(sessionId);
}

/** 칩 호버 카드 한 장 — 머리줄이 짓고 `PaneHost` 가 타일 상자 밖에서 그린다 (`SessionCardView` 와 같은 판) */
export interface TmuxCardView {
  /** 서버의 세션들 (읽은 그대로의 순서) */
  sessions: TmuxSessionInfo[];
  /** 이 타일이 붙어 있는 세션 이름 (`PaneSpec.tmux`) */
  current: string;
  /** 칩의 상자 (뷰포트 좌표) */
  anchor: { left: number; top: number; width: number; height: number };
}

/** 칩이 서 있는 동안 목록을 든다. 돌려받은 함수로 그만 본다 (마지막이 그만 보면 값도 지운다). */
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
