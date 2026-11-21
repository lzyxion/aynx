// 호스트 폼의 세션 로그 폴더 한 줄 (docs/log/2026-09-17-scrollback-export-and-logs.md)
import { toast } from "$lib/toast.svelte.js";
import { logsDir, openLogsFolder } from "$lib/session-logs";

/** 앱이 사는 내내 변하지 않아 처음 한 번만 묻는다 */
let logsFolder = $state<string | null>(null);

export function sessionLogsFolder(): string | null {
  return logsFolder;
}

/** 붙든 경로 대신 [`openLogsFolder`] 로 간다 — 폴더가 없으면 만들어 준다 */
export async function openSessionLogsFolder(): Promise<void> {
  const failure = await openLogsFolder();
  if (failure !== null) toast.error(failure);
}

/** 실패는 삼킨다 — 폴더를 누를 때 같은 실패를 다시 만나 그때 말한다 */
export function ensureLogsFolder(): void {
  if (logsFolder !== null) return;
  void logsDir()
    .then((dir) => {
      logsFolder = dir;
    })
    .catch((e: unknown) => {
      console.error("[aynx] 로그 폴더 경로를 받지 못했습니다", e);
    });
}
