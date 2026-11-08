// 호스트 폼의 **세션 로그 폴더** 한 줄 — 경로를 폼이 처음 열릴 때 한 번 받아 붙든다(`logsFolder` 는 여기에만 산다).
// `ensureLogsFolder` 는 내부 전용(폼을 여는 `form.svelte.ts` 가 부른다).
import { toast } from "$lib/toast.svelte.js";
import { logsDir, openLogsFolder } from "$lib/session-logs";

/**
 * **세션 로그가 쌓이는 폴더** — 로깅 칸 아래 한 줄이 이 경로를 그대로 보여 준다
 * (docs/log/2026-09-17-scrollback-export-and-logs.md).
 *
 * 앞서는 이 스위치를 켠 사람이 "그래서 파일이 어디에 생기는가" 를 알 길이 없었다.
 * 값은 앱이 사는 내내 변하지 않으므로 **폼을 처음 열 때 한 번만** 묻고 붙들어 둔다
 * (`null` 인 동안은 그 줄을 그리지 않는다 — 빈 경로를 보여 주느니 없는 편이 낫다).
 */
let logsFolder = $state<string | null>(null);

/** 로그 폴더 경로 (아직 못 받았으면 `null`) — 호스트 폼 마크업이 읽는다 */
export function sessionLogsFolder(): string | null {
  return logsFolder;
}

/**
 * 그 폴더를 연다 — 폼의 "폴더 열기" 미니 버튼.
 *
 * 붙들어 둔 경로를 쓰지 않고 **타일 ⋯ 메뉴와 같은 문**([`openLogsFolder`])으로 간다:
 * 그쪽이 폴더가 없으면 만들어 주기 때문이다(폼을 연 뒤에 폴더가 지워졌을 수도 있다).
 */
export async function openSessionLogsFolder(): Promise<void> {
  const failure = await openLogsFolder();
  if (failure !== null) toast.error(failure);
}

/**
 * 폼이 열릴 때 한 번 — 이미 받았으면 아무 일도 하지 않는다.
 *
 * 실패는 여기서 삼킨다(콘솔에만 남긴다): 이 값이 정하는 것은 **경로를 적은 한 줄을 그리는가**
 * 뿐이고, 사람이 실제로 폴더를 누를 때 [`openSessionLogsFolder`] 가 같은 실패를 다시 만나
 * 그때 말한다.
 */
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
