/**
 * 세션 컨텍스트 미러링 (6단계 — AI 연동 · docs/log/2026-09-02-mcp-frontend.md).
 *
 * 살아 있는 패널의 **OSC 133 명령 맥락**(마지막 명령·상태·스크롤백 꼬리)을 Rust 쪽
 * 컨텍스트 저장소에 그대로 비춰 둔다. 그러면 앱 안의 MCP 서버가 그 값을 외부 AI(claude)
 * 에게 **읽기 전용**으로 내어 줄 수 있다 — 쓰기 경로는 없다(사람이 Sync Input 으로 실행한다).
 *
 * ## 왜 여기서 얇게 감싸는가
 *
 * 이 파일은 5개의 `invoke` 를 **문자열 계약 그대로** 감싸기만 한다. Rust 쪽은 별도 에이전트가
 * 병렬로 짓고 있어 svelte-check 시점에 명령이 아직 없을 수 있으므로, **전부 오류를 삼킨다**
 * — 없는/실패한 명령이 터미널을 절대 무너뜨리지 않아야 한다 (세션·설정 래퍼와 같은 원칙).
 *
 * ## 프라이버시 (하드 요구사항)
 *
 * `update_session_context` 는 **공유가 켜진 패널에서만** 부른다 (내용을 서버로 밀어 올리는
 * 유일한 경로다). 공유를 끄면 `report_session({ optedIn:false })` 가 서버 쪽 공유 데이터를
 * 지운다. 모든 새 패널의 기본값은 **꺼짐**이다 (`$lib/ai.svelte.ts`).
 */

import { invoke } from "./ipc";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { AiMcpServer } from "$lib/settings/model/schema";
import type { CommandBlock } from "$lib/block-history";
import type { ConversationList } from "$lib/agent-sessions";
import type { RemoteConversationReply } from "$lib/remote-conversations";
import type { AgentLimits, UsageScan } from "$lib/agent-usage";
import type { UsageSummary } from "$lib/usage-board";
import type { CommandSnapshot, PaneStatus } from "$lib/shell-integration";
import type { SessionKind } from "$lib/session";

/**
 * 마지막 명령 한 건 — `CommandApi.last()` 가 돌려주는 `CommandSnapshot` 과 **같은 모양**이다
 * (Rust `LastCommand` 계약: `{ commandLine, output, exit, running }`). 재정의하지 않고 재사용한다.
 */
export type LastCommand = CommandSnapshot;

/** 세션 서버의 구동 상태 — 등록·토큰은 프런트로 보내지 않는다. */
export interface McpStatus {
  name: string;
  running: boolean;
  url: string;
}

// ---------------------------------------------------------------------------
// 타일 신원 두 갈래 (2026-09-09 · 정체성 분리)
//
// **거울 키는 여기 있지 않다** — `pane.historyStreamId`(창 이관·리로드를 넘는 안정 신원)를
// Terminal 이 그대로 키로 쓴다. 이 파일이 만드는 두 값은 **화면/디버깅용 투영**이다:
// - [`contextKey`] = `"<windowLabel>:<paneId>"` — 헤더 툴팁에 박히는 사람용 완전 신원.
// - [`tileCode`] = `p2` / `t7·p2` — 헤더에 dim 으로 박히고 MCP `code` 로 나가는 짧은 손잡이.
//
// paneId 카운터는 **창마다 따로** 돌아(tear-out) 창이 여럿이면 부딪히므로, 창 레이블을
// 접두사로 붙여 전역에서 유일하게 만든다. 창 레이블은 창 수명 내내 불변이라 한 번만 캐시한다.
// ---------------------------------------------------------------------------

let windowLabel: string | null = null;

function label(): string {
  if (windowLabel === null) {
    try {
      windowLabel = getCurrentWindow().label;
    } catch {
      // 창 API 를 못 쓰는 환경(테스트·SSR)에서도 키는 나와야 한다 — 유일성만 지키면 된다.
      windowLabel = "main";
    }
  }
  return windowLabel;
}

/**
 * 패널의 **완전 신원**(`창라벨:타일id`) — 헤더 툴팁이 파워유저·디버깅에 그대로 보여 준다.
 *
 * 예전엔 이 값이 거울 키였지만, 이제 거울 키는 `pane.historyStreamId` 다 (이관·리로드를
 * 넘어야 하므로). 이 값은 창 안에서 타일을 사람 눈에 짚어 주는 표시용 손잡이로만 남는다.
 */
export function contextKey(paneId: string): string {
  return `${label()}:${paneId}`;
}

/**
 * 이 창의 레이블 — 캐시된 [`label`] 을 밖으로 낸다 (창 수명 내내 불변).
 *
 * [`contextKey`] 가 이미 이 값을 접두사로 쓴다. 헤더가 [`tileCode`] 를 부르려면 같은 값을
 * 알아야 하므로 게터 하나만 내보낸다 — `getCurrentWindow()` 를 두 곳에서 부르지 않게.
 */
export function currentWindowLabel(): string {
  return label();
}

/**
 * **타일 코드** — 사람이 헤더에서 읽고 AI 가 MCP 로 부르는 짧은 짝짓기 손잡이.
 *
 * 타일 신원의 두 투영 중 하나다 ([`contextKey`] 가 다른 하나). 규칙:
 * - 메인 창: `pane-2` → `p2` (접두사 없음 — 흔한 경우가 가장 짧다).
 * - 뜯어낸 창 `tear-7`: `pane-2` → `t7·p2` (전역 유일 + 어느 창인지 힌트).
 *
 * 타일 id(`pane-<n>`)는 창 수명 내내 불변이라 이 코드도 불변이고, cwd·이름과 무관해
 * `paneName` 이 바뀌어도 흔들리지 않는 **안정된 앵커**다. 이관으로 창이 바뀌면 접두사가
 * 새 창에 맞게 바뀐다 — 타일이 정말 창을 옮겼으니 맞는 동작이다.
 *
 * 이 값은 헤더에 dim 으로 박히고, Terminal 이 [`reportSession`] 으로 **`code`** 에 실어 보내
 * MCP `list_sessions` 가 그대로 낸다 (거울 키=streamId 와 갈라져, 위치가 바뀌면 code 만 갱신).
 * Rust 는 더 이상 키에서 파생하지 않는다 — 이 문자열을 그대로 저장했다가 되돌려 준다.
 */
export function tileCode(windowLabel: string, paneId: string): string {
  const tile = paneId.startsWith("pane-") ? `p${paneId.slice(5)}` : paneId;
  if (windowLabel === "main") return tile;
  if (windowLabel.startsWith("tear-")) return `t${windowLabel.slice(5)}·${tile}`;
  return `${windowLabel}·${tile}`;
}

/**
 * **이번 `report_session` 을 보낼 것인가**(2026-11-10). 새로 뜬 페이지(GUI 재시작 · 리로드 · 트레이에서 다시 연 창)의 타일은 공유
 * 토글이 **꺼짐에서 시작**하고, 떨어진 세션에 붙는 순간에야 서버의 값(로컬 "AI 읽기 허용" — probe `aiRead`)으로 되살아난다. 그 앞의
 * 꺼짐은 사람이 정한 값이 아닌데 `optedIn:false` 로 나가면 서버가 거울(창이 없던 동안 서버 해석기가 쓴 명령 블록 포함)을 지운다.
 * 그래서 **아직 아무것도 보고하지 않았고 세션도 서지 않은** 채의 꺼짐은 보내지 않는다 — 세션이 서거나(붙기 · 새로 열기) 켜지면 그때
 * 처음 보낸다. 한 번 보고한 뒤의 꺼짐(사람이 끔 · 호스트 단계 내림)은 언제나 보낸다(프라이버시).
 */
export function shouldReportMirror(optedIn: boolean, announced: boolean, sessionLive: boolean): boolean {
  return optedIn || announced || sessionLive;
}

// ---------------------------------------------------------------------------
// invoke 래퍼 — 전부 오류를 삼킨다 (Rust 가 아직 없어도 터미널이 살아 있어야 한다)
// ---------------------------------------------------------------------------

/**
 * 패널의 존재와 **공유 여부**를 서버에 알린다.
 * - 터미널 마운트 시 한 번(로컬은 `optedIn:false`, 원격은 그 호스트의 지금 단계대로) — 단 꺼짐이면 세션이 선 뒤에
 *   ([`shouldReportMirror`]).
 * - 공유가 뒤집힐 때마다 다시 — 로컬은 타일의 "AI 읽기 허용" 토글, 원격은 호스트의 AI 권한 단계가
 *   `read` 를 넘나들 때(`delegation-changed`).
 *
 * `optedIn:false` 를 보내면 서버가 그 패널의 공유 데이터를 지운다 (프라이버시).
 *
 * `key` 는 **거울 키**(=`pane.historyStreamId`, 이관·리로드를 넘는 안정 신원)이고, `code` 는
 * 사람이 헤더에서 보고 AI 가 짝짓는 **현재 타일 위치**(`p2`·`t7·p2` — [`tileCode`])다. 둘을
 * 갈라 보내는 이유: 참조는 스트림을 따라 살아야 하고(key), 표시는 타일이 옮겨 간 지금 자리를
 * 비춰야 한다(code). 서버가 `code` 를 그대로 저장했다가 `list_sessions` 로 낸다.
 *
 * `sshSessionId`(단계 9 — 실행 브로커)는 이 스트림이 지금 물고 있는 **백엔드 SSH 세션 id** 다.
 * 서버가 `streamId → 살아 있는 SSH u32` 실행 라우팅 표를 이 값으로 채운다(로컬이거나 없으면
 * 라우팅을 지운다). executor 는 이 표로만 대상을 살아 있는 SSH 로 푼다(보안 불변). 이 계약에
 * 더한 **선택 인자 하나**가 프런트 변경의 전부다 — 승인·실행에 닿는 표면은 여기 없다.
 */
export async function reportSession(
  key: string,
  label: string,
  kind: SessionKind,
  code: string,
  optedIn: boolean,
  sshSessionId?: number,
  /**
   * **화면만 있는 세션인가** (tmux 타일 — 간이 모드). 이 타일에는 OSC 133 파서가 아예 붙지
   * 않아 블록이 **영영 올라오지 않는데**, 그 사실을 말해 주지 않으면 AI 는 빈 이력을
   * "아직 아무것도 안 돌았다" 로 읽고 기다린다. Rust 가 MCP `mode:"screen"` 으로 표면화한다
   * (docs/log/2026-09-16-tmux-toggle.md).
   */
  screenOnly?: boolean,
  workspace?: { workspaceId?: string; workspaceName?: string; tabKey?: string },
  /**
   * **이 원격 타일의 호스트 별칭** — 호스트 목록에 있는 SSH 타일만(`$lib/delegation` 의 `aiHostAlias`),
   * 로컬·빠른 접속은 `null`. Rust 가 이 별칭의 `delegation.toml` 단계로 그 타일의 읽기·작업안 대상·자동
   * 실행을 판정한다(2026-10-07 — 원격 세션의 AI 권한 = 호스트 하나). 원격 타일의 `optedIn` 은 그 단계가
   * `read` 이상인가를 그대로 비춘 값이다(프라이버시 쓰기 게이트는 여전히 프런트가 지킨다).
   */
  hostAlias?: string | null,
): Promise<void> {
  try {
    await invoke("report_session", {
      key,
      label,
      kind,
      code,
      optedIn,
      sshSessionId,
      screenOnly: screenOnly ?? false,
      ...workspace,
      hostAlias: hostAlias ?? null,
    });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

/**
 * 공유가 켜진 패널의 명령 맥락을 밀어 올린다 (**공유 OFF 패널에는 절대 부르지 않는다**).
 * 상태 전이(running/ok/fail)마다 부르면 되는 자연스러운 주기다.
 */
export async function updateSessionContext(
  key: string,
  status: PaneStatus | null,
  last: LastCommand | null,
  scrollbackTail: string[],
): Promise<void> {
  try {
    await invoke("update_session_context", { key, status, last, scrollbackTail });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

/**
 * Rust 거울에 실리는 **블록 하나**의 모양 (`context.rs` 의 `CommandBlockMirror`).
 *
 * 프런트의 [`CommandBlock`] 을 그대로 보내지 않는 이유는 셋이다: ①`paneId` 는 저장소 키에
 * 이미 들어 있다 ②중첩 객체(`excerpt`)를 평평하게 펴면 Rust 쪽 구조체가 한 겹으로 끝난다
 * ③`bytes`(축출 계산용 내부 값)는 밖에서 아무 뜻이 없다.
 */
export interface SessionBlock {
  /** 타일 안에서 단조 증가하는 블록 번호 — MCP 가 `(session, id)` 로 지목한다 */
  id: number;
  commandLine: string;
  cwd: string | null;
  startedAt: number;
  endedAt: number | null;
  exit: number | null;
  /** `get_last_command` 계약과 같은 이유로 **명시한다** (파생값이지만 밖으로는 값이다) */
  running: boolean;
  excerptHead: string[];
  excerptTail: string[];
  /** 발췌가 무언가를 버렸는가 — AI 가 "이게 전부인가" 를 추측하지 않게 하는 깃발 */
  truncated: boolean;
  /** 발췌를 어떻게 담았나 — complete(전부)·partial(가운데 잘림)·unavailable(마커 유실로 못 읽음) */
  capture: "complete" | "partial" | "unavailable";
}

/** 블록 → 거울 모양 (순수 변환 — 위 주석의 세 가지를 여기서 적용한다) */
export function toSessionBlock(block: CommandBlock): SessionBlock {
  return {
    id: block.id,
    commandLine: block.commandLine,
    cwd: block.cwd,
    startedAt: block.startedAt,
    endedAt: block.endedAt,
    exit: block.exit,
    running: block.running,
    excerptHead: block.excerpt.head,
    excerptTail: block.excerpt.tail,
    truncated: block.excerpt.truncated,
    capture: block.excerpt.capture,
  };
}

/**
 * 방금 끝난 블록 하나를 거울에 **덧붙인다** (공유가 켜진 패널에서만 부른다).
 *
 * `update_session_context` 가 라이브 필드를 통째로 갈아 끼우는 것과 달리 이쪽은 **증분**이다
 * — 이력은 200건까지 쌓이므로 매번 전부 다시 보내면 블록 하나에 수 MB 가 IPC 를 지난다.
 * 상한(200블록·1MB)은 Rust 가 지킨다: 거울이 상한을 넘겨 보내와도 저장소는 tail 만 쥔다는
 * 스크롤백의 규칙과 같다.
 */
export async function pushSessionBlock(key: string, block: CommandBlock): Promise<void> {
  try {
    await invoke("push_session_block", { key, block: toSessionBlock(block) });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

/**
 * 이력 **전부를 한 번에** 거울에 심는다 — 창을 건너온 타일의 거울 재구성 전용
 * (docs/log/2026-09-08-block-history-store.md 의 "거울 재구성" · 2026-09-09).
 *
 * 저장소 키가 `창라벨:타일id` 라서 이관은 **반드시 새 키**를 만든다: 옛 창이 자기 키를
 * 버리고 새 창이 빈 키를 등록하므로, 프런트가 이력을 잘 안고 왔어도 `list_commands` 는
 * 0 을 낸다. [`pushSessionBlock`] 의 증분 규칙은 그대로 두고 이 한 번만 통째로 보낸다
 * (상한 200블록·1MB 는 여기서도 Rust 가 지킨다).
 *
 * **`report_session(optedIn:true)` 이 끝난 뒤에 부른다** — 키가 아직 없으면 Rust 는
 * 조용히 버린다 (단건 push 와 같은 규칙).
 */
export async function pushSessionBlocks(
  key: string,
  blocks: readonly CommandBlock[],
): Promise<void> {
  if (blocks.length === 0) return;
  try {
    await invoke("push_session_blocks", { key, blocks: blocks.map(toSessionBlock) });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

/** 패널이 사라진다 — 서버 쪽 항목을 지운다 (터미널 언마운트·이관) */
export async function dropSession(key: string): Promise<void> {
  try {
    await invoke("drop_session", { key });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

/** MCP 상태 조회. 실패하면 "아무것도 없음" 으로 답한다 (UI 가 계속 그려질 수 있게) */
export async function mcpStatus(): Promise<McpStatus> {
  try {
    return await invoke<McpStatus>("mcp_status");
  } catch {
    return { name: "", running: false, url: "" };
  }
}

/** 마지막으로 처리한 MCP 요청의 도장 — 클라이언트 이름은 `initialize` 의 `clientInfo.name`(모르면 `null`) */
export interface McpActivity {
  client: string | null;
  atMs: number;
}

/** 마지막 MCP 요청(없거나 서버에 닿지 못하면 `null`) — Tauri `mcp_activity` */
export async function mcpActivity(): Promise<McpActivity | null> {
  try {
    return (await invoke<McpActivity | null>("mcp_activity")) ?? null;
  } catch {
    return null;
  }
}

/** 세션 서버가 낼 수 있는 도구 하나 — 서버 스키마에서 뽑은 이름 · 묶음 · 첫 문장(영어) */
export interface McpToolInfo {
  name: string;
  group: "read" | "plan" | "db" | "tile" | "coordinator" | "worker" | "reviewer" | string;
  description: string;
}

/** 도구 목록(Tauri `mcp_tools`) — 실패(서버에 닿지 못함 · 옛 서버)는 던진다 */
export async function mcpTools(): Promise<McpToolInfo[]> {
  return (await invoke<McpToolInfo[]>("mcp_tools")) ?? [];
}

/** 최근 도구 호출 한 줄 — 인자 · 결과는 없다(서버가 싣지 않는다) */
export interface McpCallRecord {
  tool: string;
  atMs: number;
  caller: "global" | "tile" | "worker" | "reviewer" | "sideChat" | string;
  client: string | null;
  outcome: "ok" | "error" | "rejected" | string;
  code: string | null;
}

/** 최근 도구 호출(최근 것부터 · Tauri `mcp_calls`) — 실패는 던진다 */
export async function mcpCalls(): Promise<McpCallRecord[]> {
  return (await invoke<McpCallRecord[]>("mcp_calls")) ?? [];
}

/**
 * 백엔드가 시작 직후 **전역 등록 해제 이관**을 했다면 그 한 줄을 가져온다 (없으면 `null`).
 *
 * 가져가면 백엔드에서 지워지므로 여러 번 불러도 토스트는 한 번만 뜬다 — 마운트 때 한 번,
 * `mcp-reregistered` 이벤트가 올 때 또 한 번 불러 **어느 쪽이 이겨도** 놓치지 않는다.
 */
export async function takeMcpNotice(): Promise<string | null> {
  try {
    return (await invoke<string | null>("take_mcp_notice")) ?? null;
  } catch {
    return null;
  }
}

/**
 * 감사 로거의 건강 상태 (Rust `AuditStatus` 계약 · 백로그 #8) — 관제판이 "감사가 도는지" 를
 * 볼 수 있게. 예전엔 쓰기 실패가 stderr 로만 갔다.
 */
export interface AuditStatus {
  /** 쓰기 스레드가 살아 있는가 */
  running: boolean;
  /** 성공적으로 기록한 레코드 수 */
  written: number;
  /** 실패한 쓰기·직렬화·파일 열기 수 */
  failed: number;
  /** 마지막으로 성공적으로 쓴 시각(epoch ms). 0 = 아직 없음 */
  lastOkAt: number;
  /** 감사 파일 폴더(없으면 null) */
  dir: string | null;
}

const AUDIT_DOWN: AuditStatus = { running: false, written: 0, failed: 0, lastOkAt: 0, dir: null };

/** 감사 로거 상태를 읽는다. 실패하면 "꺼짐"(UI 가 계속 그려질 수 있게). */
export async function auditStatus(): Promise<AuditStatus> {
  try {
    return (await invoke<AuditStatus>("audit_status")) ?? AUDIT_DOWN;
  } catch {
    return AUDIT_DOWN;
  }
}

/**
 * **에이전트 훅** 하나 — 설정 › AI 의 줄과 원격 메뉴 항목을 이 목록으로 그린다(Rust `TARGETS` —
 * docs/log/2026-09-26-codex-hooks.md). 에이전트를 화면에 손으로 적지 않는다: 셋째가 붙으면 Rust 표
 * 한 줄로 화면까지 따라온다.
 */
export interface AgentHooksTarget {
  /** 안정 id — 명령 인자(`"claude"`·`"codex"`) */
  id: string;
  /** 제품 이름 — 번역하지 않는다 */
  display: string;
  /** 설치 뒤 그 CLI 안에서 한 번 승인해야 한다(Codex `/hooks`) — 안내 한 줄을 더한다 */
  needsTrustNote: boolean;
}

/** 에이전트 표. 실패하면 빈 목록(줄이 그려지지 않을 뿐이다). */
export async function agentHooksTargets(): Promise<AgentHooksTarget[]> {
  try {
    return (await invoke<AgentHooksTarget[]>("agent_hooks_targets")) ?? [];
  } catch {
    return [];
  }
}

/**
 * **에이전트 훅** 설치 상태 (Rust `HooksStatus` 계약 · docs/log/2026-09-24-agent-hook-signals.md).
 *
 * 훅은 탭의 에이전트 상태 점에 정확한 신호("턴 시작 · 도구 · 손을 기다림 · 턴 끝")를 준다. 설치는
 * 그 에이전트의 훅 설정 파일(`~/.claude/settings.json` · `~/.codex/hooks.json`)의 `hooks` 에 우리
 * 항목을 더하고 공용 스크립트 하나를 쓴다 — 사용자가 확인 창에서 누를 때만.
 */
export interface AgentHooksStatus {
  /** 모든 훅이 지금 경로로 들어 있다 */
  installed: boolean;
  /** 우리 항목이 일부만 있다(옛 경로 등) — 다시 설치하면 맞춰진다 */
  partial: boolean;
  settingsPath: string;
  scriptPath: string;
  /** 설치가 더할 JSON — 확인 창에 그대로 보인다 */
  preview: string;
  /** 설정 파일을 못 읽었다(깨진 JSON 등) */
  error: string | null;
}

/** 훅 설치 상태를 읽는다. 실패하면 `null`(줄이 "확인할 수 없음" 을 그린다). */
export async function agentHooksStatus(agent: string): Promise<AgentHooksStatus | null> {
  try {
    return (await invoke<AgentHooksStatus>("agent_hooks_status", { agent })) ?? null;
  } catch {
    return null;
  }
}

/** 훅을 설치하거나(`true`) 우리 항목만 뺀다(`false`). 실패는 Rust 문구 그대로 던진다. */
export async function setAgentHooks(agent: string, install: boolean): Promise<AgentHooksStatus> {
  return await invoke<AgentHooksStatus>(install ? "agent_hooks_install" : "agent_hooks_remove", { agent });
}

/**
 * **원격** 훅 상태 — 살아 있는 SSH 세션 `id` 의 서버에서 그 에이전트의 설정을 읽는다
 * (docs/log/2026-09-24-remote-agent-signals.md). 모양은 로컬과 같고 경로 둘이 서버의 것이다.
 * 실패(세션 없음·서버 오류)는 Rust 문구 그대로 던진다.
 */
export async function agentHooksRemoteStatus(id: number, agent: string): Promise<AgentHooksStatus> {
  return await invoke<AgentHooksStatus>("agent_hooks_remote_status", { id, agent });
}

/** 원격 훅을 설치하거나(`true`) 우리 항목만 뺀다(`false`) — 명령 글자는 Rust 가 짓는다. */
export async function setAgentHooksRemote(id: number, agent: string, install: boolean): Promise<AgentHooksStatus> {
  return await invoke<AgentHooksStatus>(
    install ? "agent_hooks_remote_install" : "agent_hooks_remote_remove",
    { id, agent },
  );
}

// ---------------------------------------------------------------------------
// 에이전트의 지난 대화 (docs/log/2026-09-26-agent-sessions.md) — 읽기 전용 · 로컬만
// ---------------------------------------------------------------------------

/**
 * 지난 대화 목록 — 등록 경로(로컬 프로젝트·워크트리)별 묶음과 "기타". 묶음마다 최신
 * `limitPerCwd` 개(기본 50). 실패는 그대로 던진다(저장소가 조용한 한 줄로 바꾼다).
 */
export async function agentSessionsList(cwds: string[], limitPerCwd?: number): Promise<ConversationList> {
  return await invoke<ConversationList>("agent_sessions_list", { cwds, limitPerCwd: limitPerCwd ?? null });
}

/** 재개(`resume`) · 새 대화로 계속(`fork`) 할 폴더와 명령 한 줄 — Rust 가 대화 id 모양을 보고 짓는다 */
export interface AgentLaunchSpec {
  cwd: string;
  command: string;
}

/**
 * 실패(모르는 대화 · 폴더 없음 · 모양이 틀린 id)는 Rust 문구 그대로 던진다. `into` — 새 대화로 계속을 기록된 폴더가
 * 아니라 이 폴더에서(**여기로 가져와 계속** — 다른 워크트리의 대화를 지금 워크트리로)
 */
export async function agentSessionLaunchSpec(
  agent: string,
  id: string,
  mode: "resume" | "fork",
  into?: string,
): Promise<AgentLaunchSpec> {
  return await invoke<AgentLaunchSpec>("agent_session_launch_spec", { agent, id, mode, ...(into ? { into } : {}) });
}

/**
 * 지난 대화 이름 바꾸기 — Rust 가 그 CLI 의 기록에 적는다(Claude 대화 파일의 `custom-title` 줄 · Codex app-server
 * `thread/name/set` — docs/log/2026-10-24-convo-rename.md). 로컬 대화만. 실패(방금 쓰인 대화 · 모르는 대화 · Codex 오류)는
 * Rust 문구 그대로 던진다.
 */
export async function agentSessionRename(agent: string, id: string, name: string): Promise<void> {
  await invoke<void>("agent_session_rename", { agent, id, name });
}

/**
 * 지난 대화 지우기 — Rust 가 그 CLI 의 기록에서 **영구히** 지운다(Claude 대화 파일 + 딸린 폴더 — 링크가 있으면 거절 · Codex app-server
 * `thread/delete` — docs/log/2026-10-24-convo-rename.md "지우기"). 로컬 대화만. 실패(방금 쓰인 대화 · 갈라 나간 대화가 있음 · 링크 ·
 * Codex 오류)는 Rust 문구 그대로 던진다.
 */
export async function agentSessionDelete(agent: string, id: string): Promise<void> {
  await invoke<void>("agent_session_delete", { agent, id });
}

/**
 * 세션 서버의 대화 ↔ 스트림 장부(어느 대화를 어느 산 스트림이 쥐었나 · 언제 놓였나 — id 뿐 · docs/log/2026-10-24-convo-rename.md
 * "열림 판정 — 세션 서버 장부"). 날 답 — 읽기는 `$lib/agent-sessions` 의 `parseConversationLinks`. 옛 서버(op 를 모름)면 던진다.
 */
export async function agentConversationLinks(): Promise<unknown> {
  return await invoke<unknown>("agent_conversation_links");
}

/**
 * 그 타일(스트림)에 대화를 여는 명령을 썼다고 세션 서버 장부에 알린다 — 신호를 기다리지 않고 그 대화가 그 스트림에 열림으로 선다
 * (재개 autorun — 그 명령을 셸에 쓰기 전에). 적었으면 참(산 신호 토큰이 없는 스트림은 거짓). id 뿐이다. 옛 서버(op 를 모름)면 던진다.
 */
export async function agentConversationLaunched(stream: string, agent: string, id: string): Promise<boolean> {
  return await invoke<boolean>("agent_conversation_launched", { stream, agent, id });
}

/**
 * **원격** 지난 대화 — 살아 있는 SSH 타일 세션 `id` 의 전송로로 그 서버의 대화 파일을 읽는다(새 접속 없음 ·
 * docs/log/2026-09-27-remote-conversations.md). 한 번에 몇 초만 읽고 `complete=false` 면 다시 부른다(이어 읽는다).
 * `force` = 1분 캐시를 건너뛰고 목록을 새로 뽑는다(F5).
 */
export async function agentSessionsRemoteList(id: number, force: boolean): Promise<RemoteConversationReply> {
  return await invoke<RemoteConversationReply>("agent_sessions_remote_list", { id, force });
}

/** 원격 대화의 재개 · 새 대화로 계속 — 서버의 폴더와 명령 한 줄(그 별칭을 읽어 둔 캐시에서만 찾는다) */
export async function agentSessionRemoteLaunchSpec(
  alias: string,
  agent: string,
  id: string,
  mode: "resume" | "fork",
): Promise<AgentLaunchSpec> {
  return await invoke<AgentLaunchSpec>("agent_session_remote_launch_spec", { alias, agent, id, mode });
}

/** 기록 보기의 도구 호출 한 번 (docs/log/2026-09-27-conversation-viewer.md) — 이름이 비면 호출을 못 만난 결과 */
export interface TranscriptTool {
  name: string;
  /** 한 줄 요약(`git status` · `src/x.ts`) — 없으면 빈 글자 */
  summary: string;
  input: string | null;
  inputTruncated: boolean;
  /** 결과 — 아직 없으면 `null` */
  output: string | null;
  outputTruncated: boolean;
  error: boolean;
  /** 권한에서 거절돼 돌지 않았다("거절됨" — `error` 보다 앞선다). 옛 답 · 꼬리에는 없다 */
  denied?: boolean;
}

/**
 * 사람 말 맨 앞의 **앱 연결 머리글**이 알린 연결(사이드 채팅 — Rust `side_chat::event::LinkNote`). `label` = 보낼 때의 타일 표시 이름(입력 칸
 * 칩과 같은 이름 · 10-24 전 기록은 `p6 로컬` 처럼 코드가 붙은 꼴 그대로 · 비면 이름 없는 타일) · `unlinked` = 사람이 연결을 끊었다. 세션 id 는 오지 않는다.
 */
export interface TranscriptLink {
  label?: string;
  unlinked?: boolean;
}

/** 기록의 항목 하나 — 오래된 것부터 온다. `interrupted` = 끊긴 턴(글 없음 — "중단함" 한 줄) */
export interface TranscriptItem {
  role: "user" | "assistant" | "tool" | "interrupted";
  text: string | null;
  /** 글이 잘렸다(Rust 가 2만 자에서 자른다) */
  truncated: boolean;
  images: number;
  /** 그중 줄에 바로 실려 그릴 수 있는 그림의 자리(Rust `TranscriptImage`) — 없으면 칸이 없다. 나머지는 "그림 N" 칩 */
  pictures?: TranscriptPicture[];
  tool: TranscriptTool | null;
  at: number | null;
  /** 사람 말 앞의 연결 머리글(걷혀 글에는 없다) — 없으면 칸이 없다 */
  link?: TranscriptLink | null;
  /** (프로듀서 채팅) 사람 말이 앱이 깨움의 꼴이다(Rust `parse_wake_note` — 앨범 · 세대 · 범위 시작 · 글 전체 SHA). 표시용 — 앨범 기록과 맞춰야 표지 */
  wake?: TranscriptWakeTag | null;
}

/** 기록의 깨움 꼴(Rust `WakeTag`) */
export interface TranscriptWakeTag {
  runId: string;
  gen: number;
  fromSeq: number;
  sha: string;
}

/**
 * 사람 말에 **바로 실린** 그림 한 장의 자리(Claude 붙여넣기 · 끌어 놓은 파일의 base64 · Codex 데이터 URL) — 그 줄의 시작 바이트 ·
 * 길이 · 줄 안의 차례. 바이트는 [`agentConversationImage`] 로 한 장씩 받는다(쪽을 작게).
 */
export interface TranscriptPicture {
  at: number;
  len: number;
  n: number;
  mime: string;
}

/** 한 쪽 — `cursor` 가 있으면 더 오래된 쪽이 있다(다음 호출의 `before`) */
export interface TranscriptPage {
  items: TranscriptItem[];
  cursor: number | null;
}

/**
 * 지난 대화 하나의 한 쪽 — `before` 가 없으면 최신 쪽. 파일은 Rust 가 id 로 목록의 색인에서만 찾는다(경로를
 * 넘기지 않는다). 본문은 **이 화면에만** 쓴다 — 저장·로그·MCP 로 보내지 않는다.
 */
export async function agentConversationTranscript(
  agent: string,
  id: string,
  before: number | null,
  limit?: number,
): Promise<TranscriptPage> {
  return await invoke<TranscriptPage>("agent_conversation_transcript", { agent, id, before, limit: limit ?? null });
}

/**
 * **원격** 대화의 한 쪽 — 살아 있는 SSH 타일 세션 `id` 의 전송로로 그 서버의 파일을 끝에서 거꾸로 읽는다(로컬과 같은 리더 ·
 * 같은 커서 · docs/log/2026-09-27-remote-conversations.md "2단계"). 파일은 Rust 가 그 별칭의 캐시에서만 찾는다. 본문은 이 화면에만.
 */
export async function agentConversationTranscriptRemote(
  id: number,
  agent: string,
  conversation: string,
  before: number | null,
  limit?: number,
): Promise<TranscriptPage> {
  return await invoke<TranscriptPage>("agent_conversation_transcript_remote", {
    id,
    agent,
    conversation,
    before,
    limit: limit ?? null,
  });
}

/**
 * 기록 속 그림 한 장의 원시 바이트 — 파일은 쪽과 같이 Rust 가 id 로 색인에서만 찾고, 자리는 줄 하나와 꼭 맞아야 한다. 이 화면에만.
 */
export async function agentConversationImage(agent: string, id: string, p: TranscriptPicture): Promise<ArrayBuffer> {
  return await invoke<ArrayBuffer>("agent_conversation_image", { agent, id, at: p.at, len: p.len, n: p.n });
}

/** **원격** 기록 속 그림 한 장 — 살아 있는 SSH 타일 세션 `id` 의 전송로로(쪽과 같은 캐시 경로 · 같은 검사) */
export async function agentConversationImageRemote(
  id: number,
  agent: string,
  conversation: string,
  p: TranscriptPicture,
): Promise<ArrayBuffer> {
  return await invoke<ArrayBuffer>("agent_conversation_image_remote", {
    id,
    agent,
    conversation,
    at: p.at,
    len: p.len,
    n: p.n,
  });
}

// ---------------------------------------------------------------------------
// 에이전트 사용량 (docs/log/2026-09-26-agent-usage.md) — 숫자만 · 로컬만
// ---------------------------------------------------------------------------

/** 대화마다 토큰 — 첫 호출은 대화 파일 전체를 읽고(수백 ms), 그다음은 늘어난 몫만. 실패는 그대로 던진다 */
export async function agentUsageScan(): Promise<UsageScan> {
  return await invoke<UsageScan>("agent_usage_scan");
}

/**
 * 기간 요약 — 대시보드 "사용량" 칸. `days` = 기간의 날 수(`null` = 기록 전체), `agent` = 거르개(`null` = 전체).
 * 대화별 토큰과 같은 캐시를 나눠 쓴다. 실패는 그대로 던진다.
 */
export async function agentUsageSummary(
  days: number | null,
  agent: string | null,
  source?: { local: boolean; hosts: string[] },
): Promise<UsageSummary> {
  // 출처를 넘기지 않으면 예전 그대로(이 PC 만) — 원격 몫은 Rust 의 원격 캐시에서만 온다(서버에 묻지 않는다)
  if (!source || source.hosts.length === 0) {
    return await invoke<UsageSummary>("agent_usage_summary", { days, agent, local: source?.local ?? null, hosts: null });
  }
  return await invoke<UsageSummary>("agent_usage_summary", { days, agent, local: source.local, hosts: source.hosts });
}

/** 전체 사용량 읽기의 진행 — Rust `RemoteUsageProgress` */
export interface RemoteUsageProgress {
  host: string;
  doneBytes: number;
  totalBytes: number;
  pending: number;
  complete: boolean;
}

/**
 * **원격 전체 사용량 읽기** — 살아 있는 SSH 타일 세션 `id` 의 전송로로 그 서버의 큰 대화 파일을 조각씩 센다(사람이 누를
 * 때만 · 새 접속 없음 · docs/log/2026-09-27-remote-conversations.md "2단계"). 몇 초씩 읽고 돌려준다 — 다 셀 때까지 다시 부른다.
 */
export async function agentUsageRemoteRead(id: number): Promise<RemoteUsageProgress> {
  return await invoke<RemoteUsageProgress>("agent_usage_remote_read", { id });
}

/** 원격 호스트의 요금제 한도 — Codex 만(서버 롤아웃 꼬리에서 · 캐시). Claude 한도는 이 PC 의 상태줄에서만 온다 */
export async function agentUsageRemoteLimits(host: string): Promise<AgentLimits[]> {
  return await invoke<AgentLimits[]>("agent_usage_remote_limits", { host });
}

/** 에이전트마다 요금제 한도 % — 싸다(파일 하나 + 롤아웃 꼬리 몇 개) */
export async function agentUsageLimits(): Promise<AgentLimits[]> {
  return await invoke<AgentLimits[]>("agent_usage_limits");
}

/** 추가 인자 칸을 그릴 에이전트 하나 (Rust `agent_args::ArgsTargetInfo`) */
export interface AgentArgsTarget {
  /** 안정 id — `[ai.args]` 의 키 */
  id: string;
  /** 제품 이름 — 번역하지 않는다 */
  display: string;
}

/** 추가 인자 칸의 에이전트 표(Rust `agent_args::TARGETS`). 실패하면 빈 목록(칸이 그려지지 않을 뿐이다). */
export async function agentArgsTargets(): Promise<AgentArgsTarget[]> {
  try {
    return (await invoke<AgentArgsTarget[]>("agent_args_targets")) ?? [];
  } catch {
    return [];
  }
}

/** 추가 인자 미리보기 (Rust `agent_args::LaunchPreview`) */
export interface AgentLaunchPreview {
  /** 새 대화로 띄울 한 줄 — 규칙에 어긋나면 `null` */
  line: string | null;
  /** 어긋난 까닭 — 있으면 저장하지 않는다 */
  error: string | null;
  /** 권한 확인을 건너뛰는 낱말들 — 막지 않고 알린다 */
  dangerous: string[];
}

/**
 * 적는 중인 추가 인자의 판정·미리보기 — 나누기·검사·인용·자리는 전부 Rust(`agent_args.rs`)가 한다. `noDaemon` 은
 * 화면의 지금 Codex 스위치, `shell` 은 기본 셸 id(인용 모양). 부르지 못하면 `null`(칸은 그냥 적힌다).
 */
export async function agentLaunchPreview(
  agent: string,
  args: string,
  noDaemon: boolean,
  shell: string | null,
): Promise<AgentLaunchPreview | null> {
  try {
    return await invoke<AgentLaunchPreview>("agent_launch_preview", { agent, args, noDaemon, shell });
  } catch {
    return null;
  }
}

/**
 * 타일이 자동 실행할 명령 — Rust 가 설정의 추가 인자(`agent_args.rs`)를 놓고, 외부 MCP 를 싣고, codex 면
 * `--no-daemon` 을 붙여 준다(`agent_autorun.rs`). claude 의 한도 % 는 명령 줄이 아니라 타일 환경의 mod 가 받는다. 어떤 실패든 **받은 명령 그대로**
 * 돌려준다 — 띄우기를 막지 않는다. `streamId` 는 그 타일의 스트림 — `--mcp-config` 파일을 그 세션이 쓴다고 세션 서버에
 * 알린다(세션이 살아 있는 동안 GUI 를 다시 켜도 파일이 남는다 — 2026-10-09 ③-3c). (3차 6단계) 사람이 띄운 조정자 타일 갈래
 * (`orchestrationRunId` · `[run-ended]`)는 걷었다 — (2단계 단계 6) 타일은 조정자가 될 수 없다(조정자는 오케스트레이션 탭의 프로듀서 채팅).
 */
export async function agentAutorunCommand(
  command: string,
  shell: string | null,
  cwd: string | null,
  injectMcpToken: boolean,
  streamId: string | null = null,
): Promise<string> {
  try {
    const r = await invoke<unknown>("agent_autorun_command", { command, shell, cwd, injectMcpToken, streamId });
    return typeof r === "string" && r.trim() !== "" ? r : command;
  } catch {
    return command;
  }
}

/**
 * 프로젝트 설정 스크립트를 그 타일의 셸에서 돌릴 **한 줄** (docs/log/2026-09-28-project-agent-setup-script.md) — 스크립트
 * 글자는 Rust 가 `projects.json` 에서 읽는다(여기서 싣지 않는다). 로컬 PowerShell · cmd 는 앱 데이터 폴더의 임시 파일을
 * 가리키는 줄, 로컬 POSIX(Git Bash · WSL)는 같은 폴더의 `.sh` 를 가리키는 `sh '<경로>'`, 원격은 `sessionId`(그 타일의 SSH
 * 세션)의 exec 로 서버에 먼저 쓴 `sh "$HOME/.cache/aynx/setup-<nonce>.sh"` 다 — POSIX 는 파일을 못 쓰면 `sh -c '…'` 긴 한 줄로
 * 떨어진다. 실패(스크립트가 없어졌다 · PowerShell · cmd 파일을 못 썼다)는 throw.
 */
export async function projectSetupLine(
  projectId: string,
  cwd: string,
  shell: string | null,
  nonce: string,
  launchAgent: boolean,
  sessionId: number | null = null,
): Promise<string> {
  return await invoke<string>("project_setup_line", { projectId, cwd, shell, nonce, launchAgent, sessionId });
}

/** 로컬 워크트리의 설정 스크립트 결과를 곁 파일에 적는다 — 실패해도 조용하다(사람의 일은 이미 끝났다) */
export async function recordSetupResult(repo: string, path: string, code: number): Promise<void> {
  try {
    await invoke("worktree_setup_record", { repo, path, code });
  } catch (e) {
    console.warn("[aynx] 설정 스크립트 기록 실패:", e);
  }
}

/** 이 저장소에서 설정 스크립트를 돌린 워크트리 수 — 모르면 0 (프로젝트 제거 확인) */
export async function worktreeSetupCount(repo: string): Promise<number> {
  try {
    const n = await invoke<unknown>("worktree_setup_count", { repo });
    return typeof n === "number" ? n : 0;
  } catch {
    return 0;
  }
}

/** 외부 MCP 항목의 실행 검증 — 실패 이유는 Rust, 목록에 넣기 전 이 화면에서 한 번 묻는다. */
export async function agentMcpValidate(server: AiMcpServer, existingNames: string[]): Promise<string | null> {
  return await invoke<string | null>("agent_mcp_validate", { server, existingNames });
}

// 에이전트 지침 — 자기 파일에 저장하고, 실제 에이전트 파일 반영은 별도 명령이다.
// 실패를 삼키지 않는다: 편집 초안을 남기고 화면에 이유를 보여 주어야 한다.
export interface Instruction {
  name: string;
  description: string | null;
  targets: string[];
  enabled: boolean;
  scope: "global" | "project";
  projects: string[];
  subpath: string | null;
  body: string;
}

/** 원본 파일을 복사할 후보 — 깨진 관리 표시는 skipped 사유로 전달한다. */
export interface ImportCandidate {
  source: string;
  label: string;
  suggestedName: string;
  description: string | null;
  targets: string[];
  scope: "global" | "project";
  projects: string[];
  subpath: string | null;
  body: string;
  skipped: string | null;
}

export interface InstructionList {
  items: Instruction[];
  broken: { name: string; reason: string }[];
}

/** Rust agent_instructions::FileChange — nullable 칸도 IPC 계약 그대로다. */
export interface FileChange {
  path: string;
  host: string | null;
  scope: "global" | "project";
  projectId: string | null;
  agent: string | null;
  action: "create" | "update" | "delete" | "unchanged" | "skipped" | "error";
  reason: string | null;
  block: string | null;
}

export function instructionsList(): Promise<InstructionList> {
  return invoke<InstructionList>("instructions_list");
}

export function instructionSave(item: Instruction, previousName: string | null): Promise<Instruction> {
  return invoke<Instruction>("instruction_save", { item, previousName });
}

export function instructionDelete(name: string): Promise<void> {
  return invoke<void>("instruction_delete", { name });
}

/** 사이드 채팅 지침(`<데이터 루트>/sidechat/CLAUDE.md`) — 없으면 빈 글. */
export function sideChatInstructionsLoad(): Promise<string> {
  return invoke<string>("side_chat_instructions_load");
}

/** 사이드 채팅 지침을 저장한다 — 빈 글이면 파일을 지운다. 새로 띄우는 채팅부터 두 CLI 모두에 실린다. */
export function sideChatInstructionsSave(text: string): Promise<void> {
  return invoke<void>("side_chat_instructions_save", { text });
}

export function instructionsImportCandidates(projectId: string | null): Promise<ImportCandidate[]> {
  return invoke<ImportCandidate[]>("instructions_import_candidates", { projectId });
}

/** 새 로컬 워크트리 하나에만 지침을 쓴다 — 타일을 열기 전에 await한다. */
export function instructionsApplyWorktree(projectId: string, path: string): Promise<FileChange[]> {
  return invoke<FileChange[]>("instructions_apply_worktree", { projectId, path });
}

export function instructionsPreview(): Promise<FileChange[]> {
  return invoke<FileChange[]>("instructions_preview");
}

export function instructionsApply(): Promise<FileChange[]> {
  return invoke<FileChange[]>("instructions_apply");
}
