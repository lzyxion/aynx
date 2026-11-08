// 앨범 목록의 변화·재연결을 모아 탭과 재생 막대에 전한다.
import { listen } from "../ipc";
import { EVENTS_LAGGED_EVENT, RUN_CHANGED_EVENT, runSnapshot } from "$lib/orchestration/api";
import { setRunSummaries } from "$lib/app/orch-pulse.svelte.js";
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

/** 목록을 다시 읽는다(실패는 조용히 — 서버가 없으면 막대가 비어 있을 뿐) */
export async function refreshCoordinators(): Promise<void> {
  try {
    setRunSummaries(await runSnapshot());
  } catch {
    /* 서버 없음 · 옛 판 */
  }
}

/** 창마다 한 번(부팅) — 보드 신호 · 변화 이벤트를 걸고 한 번 읽는다(원격 창은 요약만 · 배치는 `placeChat` 이 거른다) */
export function startOrchCoordinators(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void listen<unknown>(RUN_CHANGED_EVENT, () => schedule()).catch(() => {});
  // F8 — 서버가 바뀌었거나(재연결) 이벤트를 버렸다(`events-lagged`) — 마지막 변화를 놓쳤을 수 있으니 한 번 다시 읽는다.
  void listen<unknown>("session-server-connected", () => schedule()).catch(() => {});
  void listen<unknown>(EVENTS_LAGGED_EVENT, () => schedule()).catch(() => {});
  void refreshCoordinators();
}

/** 변화가 몰려도 한 번만 읽는다(0.5초) */
function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void refreshCoordinators();
  }, 500);
}
