/**
 * 세션 컨텍스트 거울 · 세션 서버 명령의 얇은 `invoke` 래퍼. 거울 쪽 래퍼는 오류를 삼킨다 — 실패한 명령이 터미널을 무너뜨리면 안 된다.
 *
 * 프라이버시: 거울에 내용을 올리는 명령(`update_session_context` · `push_session_block(s)`)은 공유가 켜진 타일에서만 부른다.
 * 공유를 끄면 `report_session({ optedIn:false })` 가 서버 쪽 공유 데이터를 지운다. 새 타일의 기본값은 꺼짐이다.
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

export type LastCommand = CommandSnapshot;

/** 등록 · 토큰은 프런트로 보내지 않는다 */
export interface McpStatus {
  name: string;
  running: boolean;
  url: string;
}

// ---------------------------------------------------------------------------
// 타일 신원의 표시용 투영 — 거울 키는 여기 없다(`pane.historyStreamId` 가 키다).
// paneId 카운터는 창마다 따로 돌아 창이 여럿이면 부딪히므로 창 레이블을 접두사로 붙인다.
// ---------------------------------------------------------------------------

let windowLabel: string | null = null;

function label(): string {
  if (windowLabel === null) {
    try {
      windowLabel = getCurrentWindow().label;
    } catch {
      // 창 API 를 못 쓰는 환경(테스트·SSR)에서도 키는 나와야 한다
      windowLabel = "main";
    }
  }
  return windowLabel;
}

/** 표시용 완전 신원(`창라벨:타일id`) — 거울 키가 아니다 */
export function contextKey(paneId: string): string {
  return `${label()}:${paneId}`;
}

export function currentWindowLabel(): string {
  return label();
}

/**
 * 헤더에 보이고 MCP `list_sessions` 의 `code` 로 나가는 짧은 손잡이(`p2` · `t7·p2`).
 * Rust 는 키에서 파생하지 않고 이 문자열을 그대로 저장했다가 되돌려 준다.
 */
export function tileCode(windowLabel: string, paneId: string): string {
  const tile = paneId.startsWith("pane-") ? `p${paneId.slice(5)}` : paneId;
  if (windowLabel === "main") return tile;
  if (windowLabel.startsWith("tear-")) return `t${windowLabel.slice(5)}·${tile}`;
  return `${windowLabel}·${tile}`;
}

/**
 * 새로 뜬 페이지의 타일은 공유가 꺼짐에서 시작해 붙은 뒤에야 서버 값으로 되살아난다 — 그 앞의 꺼짐을 보내면 서버가 거울을 지운다.
 * 그래서 보고한 적 없고 세션도 서지 않은 채의 꺼짐은 보내지 않는다. 한 번 보고한 뒤의 꺼짐은 언제나 보낸다(프라이버시).
 */
export function shouldReportMirror(optedIn: boolean, announced: boolean, sessionLive: boolean): boolean {
  return optedIn || announced || sessionLive;
}

// ---------------------------------------------------------------------------
// 거울 invoke 래퍼 — 오류를 삼킨다
// ---------------------------------------------------------------------------

/**
 * `optedIn:false` 를 보내면 서버가 그 타일의 공유 데이터를 지운다(프라이버시). `key` 는 스트림을 따라 사는 거울 키,
 * `code` 는 타일의 지금 자리라 갈라 보낸다.
 * `sshSessionId` 는 실행 라우팅 표(`streamId → 살아 있는 SSH`)를 채운다 — executor 는 이 표로만 대상을 SSH 로 푼다(보안 불변).
 * 승인 · 실행에 닿는 표면은 여기 없다.
 */
export async function reportSession(
  key: string,
  label: string,
  kind: SessionKind,
  code: string,
  optedIn: boolean,
  sshSessionId?: number,
  /** tmux 타일 — 블록이 영영 오지 않는다. 알리지 않으면 AI 가 빈 이력을 "아직 안 돌았다" 로 읽고 기다린다 */
  screenOnly?: boolean,
  workspace?: { workspaceId?: string; workspaceName?: string; tabKey?: string },
  /**
   * 호스트 목록에 있는 SSH 타일만 — 로컬 · 빠른 접속은 `null`. Rust 가 이 별칭의 단계로 읽기 · 작업안 대상 · 자동 실행을 판정한다.
   * 프라이버시 쓰기 게이트는 여전히 프런트가 지킨다.
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

/** 공유가 꺼진 타일에는 절대 부르지 않는다 */
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

/** Rust `context.rs` 의 `CommandBlockMirror` 와 같은 모양 */
export interface SessionBlock {
  /** MCP 가 `(session, id)` 로 지목한다 */
  id: number;
  commandLine: string;
  cwd: string | null;
  startedAt: number;
  endedAt: number | null;
  exit: number | null;
  running: boolean;
  excerptHead: string[];
  excerptTail: string[];
  /** AI 가 "이게 전부인가" 를 추측하지 않게 하는 깃발 */
  truncated: boolean;
  capture: "complete" | "partial" | "unavailable";
}

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

/** 공유가 켜진 타일에서만 — 증분이다(매번 이력 전부를 보내면 블록 하나에 수 MB 가 IPC 를 지난다). 상한은 Rust 가 지킨다 */
export async function pushSessionBlock(key: string, block: CommandBlock): Promise<void> {
  try {
    await invoke("push_session_block", { key, block: toSessionBlock(block) });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

/**
 * 이력 전부를 한 번에 심는다(공유를 켤 때 · 이관 마운트). `report_session(optedIn:true)` 이 끝난 뒤에 부른다 — 키가 없으면 Rust 가 조용히 버린다.
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

export async function dropSession(key: string): Promise<void> {
  try {
    await invoke("drop_session", { key });
  } catch {
    /* Rust 미구현·실패 — 무시 */
  }
}

export async function mcpStatus(): Promise<McpStatus> {
  try {
    return await invoke<McpStatus>("mcp_status");
  } catch {
    return { name: "", running: false, url: "" };
  }
}

/** `client` 는 `initialize` 의 `clientInfo.name` */
export interface McpActivity {
  client: string | null;
  atMs: number;
}

export async function mcpActivity(): Promise<McpActivity | null> {
  try {
    return (await invoke<McpActivity | null>("mcp_activity")) ?? null;
  } catch {
    return null;
  }
}

export interface McpToolInfo {
  name: string;
  group: "read" | "plan" | "db" | "tile" | "coordinator" | "worker" | "reviewer" | string;
  description: string;
}

/** 옛 서버면 던진다 */
export async function mcpTools(): Promise<McpToolInfo[]> {
  return (await invoke<McpToolInfo[]>("mcp_tools")) ?? [];
}

/** 인자 · 결과는 없다 — 서버가 싣지 않는다 */
export interface McpCallRecord {
  tool: string;
  atMs: number;
  caller: "global" | "tile" | "worker" | "reviewer" | "sideChat" | string;
  client: string | null;
  outcome: "ok" | "error" | "rejected" | string;
  code: string | null;
}

export async function mcpCalls(): Promise<McpCallRecord[]> {
  return (await invoke<McpCallRecord[]>("mcp_calls")) ?? [];
}

/**
 * 가져가면 백엔드에서 지워진다 — 마운트 때와 `mcp-reregistered` 이벤트 때 둘 다 불러 어느 쪽이 이겨도 놓치지 않는다.
 */
export async function takeMcpNotice(): Promise<string | null> {
  try {
    return (await invoke<string | null>("take_mcp_notice")) ?? null;
  } catch {
    return null;
  }
}

/** Rust `AuditStatus` 계약 */
export interface AuditStatus {
  running: boolean;
  written: number;
  failed: number;
  /** epoch ms. 0 = 아직 없음 */
  lastOkAt: number;
  dir: string | null;
}

const AUDIT_DOWN: AuditStatus = { running: false, written: 0, failed: 0, lastOkAt: 0, dir: null };

export async function auditStatus(): Promise<AuditStatus> {
  try {
    return (await invoke<AuditStatus>("audit_status")) ?? AUDIT_DOWN;
  } catch {
    return AUDIT_DOWN;
  }
}

/** Rust `TARGETS` 표 — 에이전트를 화면에 손으로 적지 않는다 */
export interface AgentHooksTarget {
  /** 명령 인자(`"claude"`·`"codex"`) */
  id: string;
  /** 제품 이름 — 번역하지 않는다 */
  display: string;
  /** 설치 뒤 그 CLI 안에서 한 번 승인해야 한다(Codex `/hooks`) */
  needsTrustNote: boolean;
}

export async function agentHooksTargets(): Promise<AgentHooksTarget[]> {
  try {
    return (await invoke<AgentHooksTarget[]>("agent_hooks_targets")) ?? [];
  } catch {
    return [];
  }
}

/** 훅 설치는 사용자가 확인 창에서 누를 때만 한다 — Rust `HooksStatus` 계약 */
export interface AgentHooksStatus {
  installed: boolean;
  /** 우리 항목이 일부만 있다(옛 경로 등) — 다시 설치하면 맞춰진다 */
  partial: boolean;
  settingsPath: string;
  scriptPath: string;
  /** 설치가 더할 JSON — 확인 창에 그대로 보인다 */
  preview: string;
  error: string | null;
}

export async function agentHooksStatus(agent: string): Promise<AgentHooksStatus | null> {
  try {
    return (await invoke<AgentHooksStatus>("agent_hooks_status", { agent })) ?? null;
  } catch {
    return null;
  }
}

export async function setAgentHooks(agent: string, install: boolean): Promise<AgentHooksStatus> {
  return await invoke<AgentHooksStatus>(install ? "agent_hooks_install" : "agent_hooks_remove", { agent });
}

export async function agentHooksRemoteStatus(id: number, agent: string): Promise<AgentHooksStatus> {
  return await invoke<AgentHooksStatus>("agent_hooks_remote_status", { id, agent });
}

/** 명령 글자는 Rust 가 짓는다 */
export async function setAgentHooksRemote(id: number, agent: string, install: boolean): Promise<AgentHooksStatus> {
  return await invoke<AgentHooksStatus>(
    install ? "agent_hooks_remote_install" : "agent_hooks_remote_remove",
    { id, agent },
  );
}

// ---------------------------------------------------------------------------
// 에이전트의 지난 대화
// ---------------------------------------------------------------------------

export async function agentSessionsList(cwds: string[], limitPerCwd?: number): Promise<ConversationList> {
  return await invoke<ConversationList>("agent_sessions_list", { cwds, limitPerCwd: limitPerCwd ?? null });
}

/** 명령 한 줄은 Rust 가 대화 id 모양을 보고 짓는다 */
export interface AgentLaunchSpec {
  cwd: string;
  command: string;
}

/** `into` — 새 대화로 계속을 기록된 폴더가 아니라 이 폴더에서 */
export async function agentSessionLaunchSpec(
  agent: string,
  id: string,
  mode: "resume" | "fork",
  into?: string,
): Promise<AgentLaunchSpec> {
  return await invoke<AgentLaunchSpec>("agent_session_launch_spec", { agent, id, mode, ...(into ? { into } : {}) });
}

/** 로컬 대화만 — Rust 가 그 CLI 의 기록에 적는다 */
export async function agentSessionRename(agent: string, id: string, name: string): Promise<void> {
  await invoke<void>("agent_session_rename", { agent, id, name });
}

/** 로컬 대화만 — 그 CLI 의 기록에서 영구히 지운다 */
export async function agentSessionDelete(agent: string, id: string): Promise<void> {
  await invoke<void>("agent_session_delete", { agent, id });
}

/** 대화 ↔ 스트림 장부(id 뿐)의 날 답 — 읽기는 `parseConversationLinks`. 옛 서버면 던진다 */
export async function agentConversationLinks(): Promise<unknown> {
  return await invoke<unknown>("agent_conversation_links");
}

/** 재개 명령을 셸에 쓰기 전에 부른다 — 산 신호 토큰이 없는 스트림은 거짓. 옛 서버면 던진다 */
export async function agentConversationLaunched(stream: string, agent: string, id: string): Promise<boolean> {
  return await invoke<boolean>("agent_conversation_launched", { stream, agent, id });
}

/** 새 접속 없이 붙은 SSH 세션으로 읽는다 — `complete=false` 면 다시 불러 이어 읽는다 */
export async function agentSessionsRemoteList(id: number, force: boolean): Promise<RemoteConversationReply> {
  return await invoke<RemoteConversationReply>("agent_sessions_remote_list", { id, force });
}

/** 그 별칭을 읽어 둔 캐시에서만 찾는다 */
export async function agentSessionRemoteLaunchSpec(
  alias: string,
  agent: string,
  id: string,
  mode: "resume" | "fork",
): Promise<AgentLaunchSpec> {
  return await invoke<AgentLaunchSpec>("agent_session_remote_launch_spec", { alias, agent, id, mode });
}

/** 이름이 비면 호출을 못 만난 결과 */
export interface TranscriptTool {
  name: string;
  summary: string;
  input: string | null;
  inputTruncated: boolean;
  output: string | null;
  outputTruncated: boolean;
  error: boolean;
  /** `error` 보다 앞선다. 옛 답 · 꼬리에는 없다 */
  denied?: boolean;
}

/**
 * Rust `side_chat::event::LinkNote`. 옛 기록의 `labels` 는 `p6 로컬` 처럼 코드가 붙은 꼴 그대로다 · `""` = 이름 없는 타일. 세션 id 는 오지 않는다.
 */
export interface TranscriptLink {
  labels: string[];
  unlinked: boolean;
}

/** 오래된 것부터 온다 */
export interface TranscriptItem {
  role: "user" | "assistant" | "tool" | "interrupted";
  text: string | null;
  truncated: boolean;
  images: number;
  /** 줄에 바로 실려 그릴 수 있는 그림만 — 나머지는 "그림 N" 칩 */
  pictures?: TranscriptPicture[];
  tool: TranscriptTool | null;
  at: number | null;
  link?: TranscriptLink | null;
  /** 표시용 — 앨범 기록과 맞춰야 깨움 표지다(Rust `parse_wake_note`) */
  wake?: TranscriptWakeTag | null;
  files?: string[];
}

/** Rust `WakeTag` */
export interface TranscriptWakeTag {
  runId: string;
  gen: number;
  fromSeq: number;
  sha: string;
}

/** 바이트는 [`agentConversationImage`] 로 한 장씩 받는다 — 쪽을 작게 */
export interface TranscriptPicture {
  at: number;
  len: number;
  n: number;
  mime: string;
}

export interface TranscriptPage {
  items: TranscriptItem[];
  /** 다음 호출의 `before` */
  cursor: number | null;
  /** 모델 키워드 표시 전용 — 터미널로 보내지 않는다 */
  last?: {
    model: string;
    effort?: string | null;
    /** 메뉴로 덮어 둔 값 뒤에 새 답이 남았나를 이것으로만 가린다(`pane/flip-model-ack.ts`) */
    at?: number;
  };
}

/**
 * 파일은 Rust 가 id 로 목록의 색인에서만 찾는다(경로를 넘기지 않는다). 본문은 이 화면에만 쓴다 — 저장 · 로그 · MCP 로 보내지 않는다.
 */
export async function agentConversationTranscript(
  agent: string,
  id: string,
  before: number | null,
  limit?: number,
): Promise<TranscriptPage> {
  return await invoke<TranscriptPage>("agent_conversation_transcript", { agent, id, before, limit: limit ?? null });
}

/** 파일은 Rust 가 그 별칭의 캐시에서만 찾는다. 본문은 이 화면에만 */
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

/** 자리는 줄 하나와 꼭 맞아야 한다. 이 화면에만 */
export async function agentConversationImage(agent: string, id: string, p: TranscriptPicture): Promise<ArrayBuffer> {
  return await invoke<ArrayBuffer>("agent_conversation_image", { agent, id, at: p.at, len: p.len, n: p.n });
}

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
// 에이전트 사용량 — 숫자만
// ---------------------------------------------------------------------------

export async function agentUsageScan(): Promise<UsageScan> {
  return await invoke<UsageScan>("agent_usage_scan");
}

/** `days` · `agent` 가 `null` 이면 전체 */
export async function agentUsageSummary(
  days: number | null,
  agent: string | null,
  source?: { local: boolean; hosts: string[] },
): Promise<UsageSummary> {
  // 원격 몫은 Rust 의 원격 캐시에서만 온다(서버에 묻지 않는다)
  if (!source || source.hosts.length === 0) {
    return await invoke<UsageSummary>("agent_usage_summary", { days, agent, local: source?.local ?? null, hosts: null });
  }
  return await invoke<UsageSummary>("agent_usage_summary", { days, agent, local: source.local, hosts: source.hosts });
}

/** Rust `RemoteUsageProgress` */
export interface RemoteUsageProgress {
  host: string;
  doneBytes: number;
  totalBytes: number;
  pending: number;
  complete: boolean;
}

/** 사람이 누를 때만 · 새 접속 없음 — 몇 초씩 읽고 돌려주니 다 셀 때까지 다시 부른다 */
export async function agentUsageRemoteRead(id: number): Promise<RemoteUsageProgress> {
  return await invoke<RemoteUsageProgress>("agent_usage_remote_read", { id });
}

/** Codex 만 · 캐시에서. Claude 한도는 이 PC 의 상태줄에서만 온다 */
export async function agentUsageRemoteLimits(host: string): Promise<AgentLimits[]> {
  return await invoke<AgentLimits[]>("agent_usage_remote_limits", { host });
}

export async function agentUsageLimits(): Promise<AgentLimits[]> {
  return await invoke<AgentLimits[]>("agent_usage_limits");
}

/** Rust `agent_args::ArgsTargetInfo` */
export interface AgentArgsTarget {
  /** `[ai.args]` 의 키 */
  id: string;
  /** 제품 이름 — 번역하지 않는다 */
  display: string;
}

export async function agentArgsTargets(): Promise<AgentArgsTarget[]> {
  try {
    return (await invoke<AgentArgsTarget[]>("agent_args_targets")) ?? [];
  } catch {
    return [];
  }
}

/** Rust `agent_args::LaunchPreview` */
export interface AgentLaunchPreview {
  line: string | null;
  /** 있으면 저장하지 않는다 */
  error: string | null;
  /** 권한 확인을 건너뛰는 낱말들 — 막지 않고 알린다 */
  dangerous: string[];
}

/** 나누기 · 검사 · 인용은 전부 Rust(`agent_args.rs`)가 한다 */
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
 * 어떤 실패든 받은 명령 그대로 돌려준다 — 띄우기를 막지 않는다. `streamId` 는 `--mcp-config` 파일을 그 세션이 쓴다고 세션 서버에
 * 알린다(세션이 사는 동안 GUI 를 다시 켜도 파일이 남는다). 타일은 조정자가 될 수 없다 — 조정자는 프로듀서 채팅이다.
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

/** 스크립트 글자는 Rust 가 `projects.json` 에서 읽는다 — 여기서 싣지 않는다 */
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

export async function recordSetupResult(repo: string, path: string, code: number): Promise<void> {
  try {
    await invoke("worktree_setup_record", { repo, path, code });
  } catch (e) {
    console.warn("[aynx] 설정 스크립트 기록 실패:", e);
  }
}

export async function worktreeSetupCount(repo: string): Promise<number> {
  try {
    const n = await invoke<unknown>("worktree_setup_count", { repo });
    return typeof n === "number" ? n : 0;
  } catch {
    return 0;
  }
}

export async function agentMcpValidate(server: AiMcpServer, existingNames: string[]): Promise<string | null> {
  return await invoke<string | null>("agent_mcp_validate", { server, existingNames });
}

// 에이전트 지침 — 실패를 삼키지 않는다: 편집 초안을 남기고 화면에 이유를 보여 주어야 한다.
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

/** 깨진 관리 표시는 skipped 사유로 전달한다 */
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
  /** 프로젝트 하위 폴더(저장소 상대). 루트 · 전역은 null */
  subpath: string | null;
  /** 이 파일의 관리 블록에 들어가는 지침 이름(이름순) */
  instructions: string[];
  /** 그 가운데 본문이 관리 블록 밖에도 그대로 있는 지침 */
  duplicates: string[];
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

export function sideChatInstructionsLoad(): Promise<string> {
  return invoke<string>("side_chat_instructions_load");
}

/** 빈 글이면 파일을 지운다. 새로 띄우는 채팅부터 실린다 */
export function sideChatInstructionsSave(text: string): Promise<void> {
  return invoke<void>("side_chat_instructions_save", { text });
}

export function instructionsImportCandidates(projectId: string | null): Promise<ImportCandidate[]> {
  return invoke<ImportCandidate[]>("instructions_import_candidates", { projectId });
}

/** 타일을 열기 전에 await 한다 */
export function instructionsApplyWorktree(projectId: string, path: string): Promise<FileChange[]> {
  return invoke<FileChange[]>("instructions_apply_worktree", { projectId, path });
}

export function instructionsPreview(): Promise<FileChange[]> {
  return invoke<FileChange[]>("instructions_preview");
}

export function instructionsApply(): Promise<FileChange[]> {
  return invoke<FileChange[]>("instructions_apply");
}
