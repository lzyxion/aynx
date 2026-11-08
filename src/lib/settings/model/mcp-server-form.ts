// 설정 › MCP 의 **외부 MCP 서버 요약 · 추가/편집 하위 화면** 순수 부분 (docs/log/2026-10-05-mcp-subview.md).
// 화면은 `settings/ExternalMcpServers.svelte`(요약) · `settings/McpServerEditor.svelte`(추가 · 편집).
//
// 옛 추가/편집 모달(`McpServerDialog`)에 인라인으로 있던 계산을 **모양 그대로** 옮겼다 — 이름 · 값의 진짜 검증은
// 여전히 Rust 한 곳(`agentMcpValidate`)이고, 비밀 값은 이 모듈을 지나지 않는다(여기 있는 것은 이름과 볼트 참조뿐).
import type { AiMcpServer } from "./schema";

export type McpTransport = AiMcpServer["transport"];

/**
 * 폼의 비밀 칸 한 줄(환경변수 · HTTP 헤더). `value` 는 **이 화면에서 새로 친 값만** 들고 저장 순간 볼트로 가며,
 * 저장된 값은 돌려받지 않는다(`secret_ref` 만 — 편집을 열면 `value` 는 늘 빈 칸).
 */
export interface SecretDraft {
  name: string;
  value: string;
  secret_ref?: string;
  changed: boolean;
}

/** 대상 칩을 고르지 않은 옛 항목(`agents` 생략)이 뜻하는 대상 — 둘 다 */
export const DEFAULT_AGENTS: readonly string[] = ["claude", "codex"];

/** 저장된 참조 → 폼 줄. 값은 비우고 "안 바뀜" 으로 — 저장된 값은 프런트에 오지 않는다. */
export function secretDrafts(entries: { name: string; secret_ref: string }[] | undefined): SecretDraft[] {
  return (entries ?? []).map((entry) => ({ ...entry, value: "", changed: false }));
}

/** 폼 줄 → 목록에 남길 참조(이름 다듬기 · 아직 볼트에 안 간 줄은 `"pending"`). 값은 싣지 않는다. */
export function secretRefs(secrets: SecretDraft[]): { name: string; secret_ref: string }[] {
  return secrets.map((entry) => ({ name: entry.name.trim(), secret_ref: entry.secret_ref ?? "pending" }));
}

/** 볼트 항목 이름 — `<범위|global>/<서버>/[header:]<이름>` (옛 모달과 같은 꼴 · Rust 쪽 정리가 이 꼴을 안다). */
export function secretVaultKey(projectId: string, serverName: string, transport: McpTransport, entryName: string): string {
  return `${projectId || "global"}/${serverName}/${transport === "http" ? "header:" : ""}${entryName.trim()}`;
}

/** 요약 줄의 한 줄 설명 — HTTP 면 URL, stdio 면 명령과 인자 */
export function serverSummary(server: AiMcpServer): string {
  return server.transport === "http" ? (server.url ?? "") : [server.command, ...(server.args ?? [])].join(" ");
}

/** 범위 후보 id — 로컬 프로젝트 + 목록에만 남은 프로젝트 id(지운 프로젝트를 가리키는 항목도 그대로 고를 수 있게) */
export function scopeIds(localProjectIds: string[], list: AiMcpServer[]): string[] {
  return [...new Set([...localProjectIds, ...list.flatMap((s) => (s.project_id ? [s.project_id] : []))])];
}

/** 표시 순서 — 앱 전체 먼저, 그다음 범위 이름순. 같은 범위 안은 저장 순서. 편집은 `index`(저장 자리)로 한다. */
export function sortForDisplay(
  list: AiMcpServer[],
  scopeLabel: (id: string) => string,
): { server: AiMcpServer; index: number }[] {
  return list
    .map((server, index) => ({ server, index }))
    .sort((a, b) => {
      const aId = a.server.project_id ?? "";
      const bId = b.server.project_id ?? "";
      if (aId === bId) return a.index - b.index;
      if (!aId) return -1;
      if (!bId) return 1;
      return scopeLabel(aId).localeCompare(scopeLabel(bId)) || aId.localeCompare(bId);
    });
}

/** [추가]/[저장] 이 흐린가 — 이름 · (명령|URL) 이 비었거나, 비밀 칸이 있는데 볼트 저장에 동의하지 않았거나, 검사 중 */
export function cannotSubmitServer(f: {
  busy: boolean;
  name: string;
  transport: McpTransport;
  command: string;
  url: string;
  secretCount: number;
  storeSecrets: boolean;
}): boolean {
  return (
    f.busy ||
    f.name.trim() === "" ||
    (f.secretCount > 0 && !f.storeSecrets) ||
    (f.transport === "stdio" ? f.command.trim() === "" : f.url.trim() === "")
  );
}

/** 사이드 채팅 칸 — 켤 때만 적는다(옛 판과 같은 글자). 묻지 않기는 사이드 채팅이 켜졌을 때만 남긴다(끄면 같이 걷는다). */
export function sideChatFields(sideChat: boolean | undefined, noAsk: boolean | undefined): Pick<AiMcpServer, "side_chat" | "side_chat_no_ask"> {
  if (!sideChat) return {};
  return noAsk ? { side_chat: true, side_chat_no_ask: true } : { side_chat: true };
}

/** 목록 줄의 사이드 채팅 칩 누르기 — 켜고 끄기(끄면 묻지 않기도 걷는다). 다른 칸은 그대로. */
export function toggleSideChat(server: AiMcpServer): AiMcpServer {
  const { side_chat: _on, side_chat_no_ask: _noAsk, ...rest } = server;
  return { ...rest, ...sideChatFields(!server.side_chat, server.side_chat_no_ask) };
}

/** 칩 하나 켜고 끄기 */
export function toggleAgentIn(agents: string[], id: string): string[] {
  return agents.includes(id) ? agents.filter((agent) => agent !== id) : [...agents, id];
}

/**
 * 폼 → 목록 항목. 대상 칩을 건드리지 않은 옛 항목은 `agents` 생략(1차 호환)을 그대로 보존한다.
 * 비밀 칸은 참조만(`secretRefs`) — 새로 친 값은 저장 쪽이 볼트에 넣은 뒤 참조를 다시 채운다.
 */
export function buildServer(
  f: {
    name: string;
    enabled: boolean;
    agents: string[];
    projectId: string;
    transport: McpTransport;
    command: string;
    args: string[];
    url: string;
    secrets: SecretDraft[];
    /** 대상 › 사이드 채팅 칩 · 사이드 채팅에서 묻지 않기(생략 = 끔) */
    sideChat?: boolean;
    sideChatNoAsk?: boolean;
  },
  initial: AiMcpServer | null,
  agentsChanged: boolean,
): AiMcpServer {
  const selectedAgents = agentsChanged || initial === null ? [...f.agents] : initial.agents;
  const scope = f.projectId ? { project_id: f.projectId } : {};
  const side = sideChatFields(f.sideChat, f.sideChatNoAsk);
  return f.transport === "stdio"
    ? { name: f.name.trim(), enabled: f.enabled, agents: selectedAgents, ...scope, transport: f.transport, command: f.command.trim(), args: [...f.args], env: secretRefs(f.secrets), ...side }
    : { name: f.name.trim(), enabled: f.enabled, agents: selectedAgents, ...scope, transport: f.transport, url: f.url.trim(), headers: secretRefs(f.secrets), ...side };
}

/** 이름 중복 검사에 넘길 이름 — 고치는 항목 자신은 빼고, **같은 범위**의 것만 */
export function sameScopeNames(list: AiMcpServer[], editing: number | null, projectId: string): string[] {
  return list
    .filter((_, i) => i !== editing)
    .filter((entry) => (entry.project_id ?? "") === projectId)
    .map((entry) => entry.name);
}

/** 목록에 넣기(`index === null` → 끝에 추가) — 넣은 자리를 함께 돌려준다 */
export function putServer(list: AiMcpServer[], index: number | null, server: AiMcpServer): { list: AiMcpServer[]; index: number } {
  const next = [...list];
  if (index === null) {
    next.push(server);
    return { list: next, index: next.length - 1 };
  }
  next[index] = server;
  return { list: next, index };
}
