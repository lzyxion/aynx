import { listen } from "../ipc";
import { EVENTS_LAGGED_EVENT, RUN_CHANGED_EVENT, runSnapshot } from "$lib/orchestration/api";
import { setRunSummaries } from "$lib/app/orch-pulse.svelte.js";
let started = false;
let timer: ReturnType<typeof setTimeout> | null = null;

export async function refreshCoordinators(): Promise<void> {
  try {
    setRunSummaries(await runSnapshot());
  } catch {
    /* 서버 없음 · 옛 판 */
  }
}

export function startOrchCoordinators(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void listen<unknown>(RUN_CHANGED_EVENT, () => schedule()).catch(() => {});
  // 재연결 · `events-lagged` 뒤에는 마지막 변화를 놓쳤을 수 있다
  void listen<unknown>("session-server-connected", () => schedule()).catch(() => {});
  void listen<unknown>(EVENTS_LAGGED_EVENT, () => schedule()).catch(() => {});
  void refreshCoordinators();
}

function schedule(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void refreshCoordinators();
  }, 500);
}
