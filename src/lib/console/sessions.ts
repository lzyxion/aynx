import { invoke } from "../ipc";
import type { ConsoleSession } from "./delegation-rows";

/** 오류는 삼킨다 — 실패해도 관제판은 빈 목록으로 계속 그린다. MCP `list_sessions` 와 같은 객체다. */
export async function listConsoleSessions(): Promise<ConsoleSession[]> {
  try {
    return (await invoke<ConsoleSession[]>("list_console_sessions")) ?? [];
  } catch {
    return [];
  }
}
