/**
 * 세션 로그를 여는 두 길 — 여는 일은 OS 가 한다(`plugin-opener`). 앱이 로그를 대신 읽어 화면에 뿌리지 않는다
 * (파일에는 ANSI 시퀀스가 도착한 그대로 들어 있다 — `session_log.rs` 머리말).
 */

import { invoke } from "./ipc";
import { openPath } from "@tauri-apps/plugin-opener";
import { t } from "$lib/i18n/i18n.svelte.js";
import type { SessionKind } from "$lib/session";

/** `null` = 로깅이 꺼져 있다(로컬 셸은 언제나). 세션이 닫힌 뒤에 묻는 경우가 정상 경로에 있어 실패는 `null` 로 삼킨다 */
export async function logPathOf(kind: SessionKind, id: number): Promise<string | null> {
  try {
    return (await invoke<string | null>("session_log_path", { kind, id })) ?? null;
  } catch {
    return null;
  }
}

/** Rust 가 답하기 전에 폴더를 만들어 둔다. 실패는 삼키지 않는다 — 던지는 값은 Rust 가 준 보일 한 줄이다 */
export async function logsDir(): Promise<string> {
  return await invoke<string>("session_logs_dir");
}

export async function openLogPath(path: string): Promise<boolean> {
  try {
    await openPath(path);
    return true;
  } catch (e) {
    console.error(`[aynx] 경로를 열지 못했습니다: ${path}`, e);
    return false;
  }
}

/** 성공하면 `null`, 실패하면 그대로 띄울 한 줄 */
export async function openLogsFolder(): Promise<string | null> {
  let dir: string;
  try {
    dir = await logsDir();
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return (await openLogPath(dir)) ? null : t("pane.term.logs_folder.failed");
}
