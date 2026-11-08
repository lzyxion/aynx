/**
 * **세션 로그를 여는 두 길** (docs/log/2026-09-17-scrollback-export-and-logs.md).
 *
 * 세션 로깅(`src-tauri/src/session_log.rs`)은 지금까지 **쓰기만 하는 기능**이었다:
 * 호스트 폼에서 켜면 `<data_dir>/aynx/logs/<별칭>-<시각>.log` 가 쌓이지만, 그 경로가
 * 화면 어디에도 없어 사람은 파일을 손으로 찾아가야 했다.
 *
 * 여기 있는 것은 그 두 물음의 답이다 — "이 타일은 지금 어디에 쓰고 있는가"([`logPathOf`])와
 * "그것들이 쌓이는 폴더는 어디인가"([`logsDir`]). **여는 일은 OS 가 한다**(`plugin-opener`):
 * 앱이 로그를 대신 읽어 화면에 뿌리지 않는다. 그 파일에는 ANSI 시퀀스가 도착한 그대로
 * 들어 있어(로그 재생의 재료 — `session_log.rs` 머리말) 뷰어를 하나 더 만드는 일이 되고,
 * 무엇보다 사용자는 이미 자기 편집기를 갖고 있다.
 */

import { invoke } from "./ipc";
import { openPath } from "@tauri-apps/plugin-opener";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { SessionKind } from "$lib/session";

/**
 * 이 세션이 지금 쓰고 있는 로그 파일 (`null` = 로깅이 꺼져 있다).
 *
 * **로컬 셸은 언제나 `null`** 이다 — 세션 로깅은 `sessions.toml` 의 호스트 항목에 붙는
 * 옵트인이라 로컬 셸에는 걸 자리가 없다. 그래도 종류를 가리지 않고 묻는 이유는 부르는
 * 쪽(터미널 타일)이 갈래를 갖지 않게 하기 위해서다.
 *
 * 실패는 `null` 로 삼킨다: 이 값이 정하는 것은 메뉴 한 줄이 흐린지 아닌지뿐이고,
 * 세션이 이미 닫힌 뒤에 묻는 경우가 정상 경로에 있다.
 */
export async function logPathOf(kind: SessionKind, id: number): Promise<string | null> {
  try {
    return (await invoke<string | null>("session_log_path", { kind, id })) ?? null;
  } catch {
    return null;
  }
}

/**
 * 로그가 쌓이는 폴더. **Rust 가 답하기 전에 폴더를 만들어 둔다** — 로그를 한 번도 쓰지 않은
 * 사람이 열어도 탐색기가 "찾을 수 없습니다" 를 띄우지 않는다.
 *
 * 그래서 실패를 `null` 로 삼키지 않는다: 여기서 남는 실패는 "데이터 디렉터리를 찾을 수
 * 없다"·"폴더를 만들지 못했다" 뿐이고, 둘 다 사람에게 말해야 하는 것들이다. 던지는 값은
 * Rust 가 준 **보일 한 줄**이다.
 */
export async function logsDir(): Promise<string> {
  return await invoke<string>("session_logs_dir");
}

/**
 * 파일(또는 폴더)을 OS 기본 앱으로 연다. 성공하면 `true`.
 *
 * 세션 로그 파일은 세션이 끝난 뒤 지워졌을 수 있다 — 그 실패가 여기서 `false` 로 돌아오고,
 * 부르는 쪽이 한 줄로 말한다.
 */
export async function openLogPath(path: string): Promise<boolean> {
  try {
    await openPath(path);
    return true;
  } catch (e) {
    console.error(`[aynx] 경로를 열지 못했습니다: ${path}`, e);
    return false;
  }
}

/**
 * 로그 폴더를 연다 — 경로를 묻고(만들고) 그것을 여는 두 걸음이 늘 붙어 다녀 한 줄로 둔다.
 *
 * 성공하면 `null`, 실패하면 **그대로 띄울 한 줄**을 돌려준다. 실패 갈래가 둘이라 `boolean`
 * 이 아니다: 폴더를 만들지 못했으면 Rust 가 이유를 말해 주고(권한·디스크), 폴더는 있는데
 * 열지 못했으면 여기서 일반 문구를 붙인다.
 */
export async function openLogsFolder(): Promise<string | null> {
  let dir: string;
  try {
    dir = await logsDir();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return (await openLogPath(dir)) ? null : t("pane.term.logs_folder.failed");
}
