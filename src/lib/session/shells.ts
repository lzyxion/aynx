// 이 기기의 셸·AI CLI 목록과 기본 셸 판정. 실패해도 throw 하지 않는다.

import { invoke } from "../ipc";
import { withoutDisabled } from "$lib/agent-enabled";

/** Rust 계약 */
export interface ShellInfo {
  /** `"pwsh"` | `"powershell"` | `"cmd"` | `"wsl:<distro>"` | `"gitbash"` */
  id: string;
  /** 목록을 만든 순간의 언어로 구운 이름 — 화면은 그대로 찍지 않고 `shellInfoLabel`(names.ts)을 거친다 */
  label: string;
}

/** Rust `ShellList` 와 1:1 — 기본을 함께 싣는 것은 프런트가 목록 순서에 기대지 않게 하려는 것이다 */
export interface ShellList {
  shells: ShellInfo[];
  /** 아직 구현하지 않은 OS 에서는 `null` */
  default_id: string | null;
}

export async function listShells(): Promise<ShellList> {
  try {
    const list = await invoke<ShellList>("list_shells");
    return {
      shells: Array.isArray(list?.shells) ? list.shells : [],
      default_id: typeof list?.default_id === "string" ? list.default_id : null,
    };
  } catch {
    return { shells: [], default_id: null };
  }
}

/**
 * 저장된 셸이 이 기기에 없으면 OS 초기값으로 떨어진다. 설정 파일은 고쳐 쓰지 않는다 — 지운 배포판을 다시 깔면 원래 고른 셸로
 * 돌아와야 한다. `null` 이면 셸을 지정하지 않고 열어 백엔드 폴백에 맡긴다.
 */
export function effectiveDefaultShellId(
  shells: readonly ShellInfo[],
  stored: string | null | undefined,
  osDefaultId: string | null,
): string | null {
  if (stored && shells.some((s) => s.id === stored)) return stored;
  return osDefaultId;
}

/** Rust `AiCli` 계약 */
export interface AiCli {
  /** 안정 id (`"claude"` · `"codex"`) — 등록·상태 조회의 키 */
  id: string;
  name: string;
  command: string;
  installed: boolean;
}

/**
 * 감지 자체가 실패했을 때만(빈 목록) claude 한 줄로 폴백한다 — 감지 딸꾹질 하나가 AI 진입점을 없애면 안 된다. 감지는 됐는데 하나도
 * 안 깔렸으면 빈 목록(부르는 쪽이 "설치" 안내를 그린다). AI CLI 를 고르는 자리는 전부 이 한 규칙을 쓴다.
 */
export function offeredAiClis(
  clis: readonly AiCli[],
  disabled: readonly string[] = [],
): { command: string; id: string; name: string }[] {
  const installed = clis.filter((c) => c.installed).map((c) => ({ command: c.command, id: c.id, name: c.name }));
  const offered = clis.length === 0 ? [{ command: "claude", id: "claude", name: "Claude Code" }] : installed;
  // 끈 에이전트는 폴백까지 지나서 뺀다 — 모두 끄면 빈 목록이다.
  return withoutDisabled(offered, (c) => c.id, disabled);
}

export async function listAiClis(): Promise<AiCli[]> {
  try {
    const clis = await invoke<AiCli[]>("list_ai_clis");
    return Array.isArray(clis) ? clis : [];
  } catch {
    return [];
  }
}
