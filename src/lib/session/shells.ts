// 이 기기의 셸·AI CLI 목록(`list_shells`·`list_ai_clis` invoke)과 기본 셸 판정. 실패해도 throw 하지 않는다.

import { invoke } from "../ipc";
import { withoutDisabled } from "$lib/agent-enabled";

/** `list_shells` 가 돌려주는 항목 — 이 기기에 실제로 있는 셸 하나 (Rust 계약) */
export interface ShellInfo {
  /** `"pwsh"` | `"powershell"` | `"cmd"` | `"wsl:<distro>"` | `"gitbash"` */
  id: string;
  /**
   * 백엔드가 **목록을 만든 순간의 언어**로 구운 이름 — 화면은 이 글자를 그대로 찍지 않고
   * `shellInfoLabel`(names.ts)을 거친다(언어를 바꿔도 캐시된 목록의 옛 글자가 남지 않게).
   * 프런트가 모르는 새 셸일 때만 이 글자가 화면에 닿는다.
   */
  label: string;
}

/**
 * `list_shells` 의 답 — 목록 + **이 OS 의 초기 기본 셸** (Rust `ShellList` 계약).
 *
 * 기본을 목록과 함께 싣는 이유는 프런트가 **순서에 기대지 않게** 하려는 것이다
 * (예전에는 `shells[0]` 이 곧 기본이라고 읽었다). 칸 이름은 Rust 와 1:1 이라 snake_case 다.
 */
export interface ShellList {
  shells: ShellInfo[];
  /** OS 가 정하는 초기 기본 셸의 id. **아직 구현하지 않은 OS 에서는 `null`** */
  default_id: string | null;
}

/**
 * 기기에 있는 셸 목록. **실패하면 빈 목록 + 기본 없음** 이다 (throw 하지 않는다) —
 * 명령이 아직 없거나 감지가 실패해도 UI 는 "터미널" 한 줄로 계속 동작한다.
 */
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
 * **지금 실제로 기본인 셸의 id** — 설정값과 OS 초기값을 합치는 규칙 하나.
 *
 * 설정(`[shell] default`)에는 언제나 **구체적인 셸 이름**이 들어간다 ("시스템 기본" 이라는
 * 항목은 2026-09-16 에 없앴다 — Windows 에는 OS 가 정한 셸이라는 것이 없어 그 말이
 * 아무것도 가리키지 않았다). 다만 **설정이 아직 비어 있을 수 있고**(새로 깐 기기) 저장된
 * 셸이 이 기기엔 없을 수도 있다(설정 파일을 다른 PC 에서 가져왔다·WSL 배포판을 지웠다).
 * 그 두 경우 모두 **OS 초기값**([`ShellList.default_id`])으로 떨어진다.
 *
 * **설정 파일을 고쳐 쓰지 않는다** — 지운 배포판을 다시 깔면 아무것도 안 해도 원래 고른
 * 셸로 돌아와야 하기 때문이다. 판정은 열 때마다 이 함수가 새로 한다.
 *
 * 목록이 아직 안 왔거나(첫 그림) 감지가 실패했으면 `null` 이다 — 그때는 셸을 지정하지 않고
 * 열어 백엔드 폴백에 맡긴다.
 */
export function effectiveDefaultShellId(
  shells: readonly ShellInfo[],
  stored: string | null | undefined,
  osDefaultId: string | null,
): string | null {
  if (stored && shells.some((s) => s.id === stored)) return stored;
  return osDefaultId;
}

/** `list_ai_clis` 가 돌려주는 항목 — 알려진 AI CLI 하나 (Rust `AiCli` 계약) */
export interface AiCli {
  /** 안정 id (`"claude"` · `"codex"`) — 등록·상태 조회의 키 */
  id: string;
  /** 메뉴 항목에 그대로 찍는 표시 이름 */
  name: string;
  /** AI 타일이 자동 실행할 명령 (= 바이너리 이름) */
  command: string;
  /** 이 기기에 설치되어 있는가 (`<bin> --version`) */
  installed: boolean;
}

/**
 * 화면이 **내놓는** AI CLI 줄 — 설치된 것만. **감지 자체가 실패했을 때만**(빈 목록 — 성공하면 알려진 CLI 가 늘 다 온다)
 * claude 한 줄로 폴백한다(감지 딸꾹질 하나가 AI 진입점을 없애면 안 된다). 감지는 됐는데 하나도 안 깔렸으면 빈 목록 —
 * 부르는 쪽이 "설치" 안내를 그린다(2026-11-03 — 예전에는 이때도 claude 를 세워 깔린 것처럼 보였다). 독 · Ctrl+Shift+A ·
 * 프로젝트 시작 화면 · 사이드 채팅 · 블록 넘기기 · 폰 시트 · 오케스트레이션이 이 한 규칙을 함께 쓴다.
 * `disabled` 는 설정에서 끈 에이전트(`[ai] disabled_agents`) — 고르는 자리에서 빠진다.
 */
export function offeredAiClis(
  clis: readonly AiCli[],
  disabled: readonly string[] = [],
): { command: string; id: string; name: string }[] {
  const installed = clis.filter((c) => c.installed).map((c) => ({ command: c.command, id: c.id, name: c.name }));
  const offered = clis.length === 0 ? [{ command: "claude", id: "claude", name: "Claude Code" }] : installed;
  // 끈 에이전트는 폴백까지 지나서 뺀다 — 모두 끄면 빈 목록이다(부르는 쪽이 빈 상태를 그린다).
  return withoutDisabled(offered, (c) => c.id, disabled);
}

/**
 * 알려진 AI CLI 목록(설치 여부 포함). **실패하면 빈 배열** 이다 (throw 하지 않는다) —
 * 상태바 `>_` 메뉴가 감지 실패에도 그대로 뜨고 claude 단일 항목으로 폴백한다 (`listShells` 와 같은 원칙).
 */
export async function listAiClis(): Promise<AiCli[]> {
  try {
    const clis = await invoke<AiCli[]>("list_ai_clis");
    return Array.isArray(clis) ? clis : [];
  } catch {
    return [];
  }
}
