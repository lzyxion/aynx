/**
 * 콘솔 세션 폴링 래퍼 — `list_console_sessions`(Rust) 를 얇게 감싼다 (A3b-1).
 *
 * `operations.ts` 와 같은 원칙: **오류는 삼킨다** — Rust 가 아직 없거나 실패해도 관제판이
 * 무너지면 안 된다(빈 목록으로 계속 그린다). 순수 조립·정렬은 `delegation-rows.ts` 가 하고,
 * 이 모듈은 `invoke` 왕복 하나만 진다.
 */

import { invoke } from "../ipc";
import type { ConsoleSession } from "./delegation-rows";

/**
 * 앱 전역 세션 뷰를 읽는다(공유 창 세션 + 위임 대상 — 접속·미접속 모두). 실패하면 빈 목록.
 * MCP `list_sessions` 와 **같은 객체**이고 여기 사람 콘솔용 진입점이 [`list_console_sessions`] 다.
 */
export async function listConsoleSessions(): Promise<ConsoleSession[]> {
  try {
    return (await invoke<ConsoleSession[]>("list_console_sessions")) ?? [];
  } catch {
    return [];
  }
}
