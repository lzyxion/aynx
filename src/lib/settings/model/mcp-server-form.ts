// 외부 MCP 서버 폼의 순수 부분 — 이름 · 값의 진짜 검증은 Rust 한 곳(`agentMcpValidate`)이고,
// 비밀 값은 이 모듈을 지나지 않는다(여기 있는 것은 이름과 볼트 참조뿐).
import type { AiMcpServer } from "./schema";

export type McpTransport = AiMcpServer["transport"];

/** `value` 는 이 화면에서 새로 친 값만 든다 — 저장된 값은 돌려받지 않는다(`secret_ref` 만 · 편집을 열면 `value` 는 늘 빈 칸) */
export interface SecretDraft {
  name: string;
  value: string;
  secret_ref?: string;
  changed: boolean;
}

/** `agents` 를 생략한 옛 항목이 뜻하는 대상 */
export const DEFAULT_AGENTS: readonly string[] = ["claude", "codex"];

export function secretDrafts(entries: { name: string; secret_ref: string }[] | undefined): SecretDraft[] {
  return (entries ?? []).map((entry) => ({ ...entry, value: "", changed: false }));
}

/** 값은 싣지 않는다 */
export function secretRefs(secrets: SecretDraft[]): { name: string; secret_ref: string }[] {
  return secrets.map((entry) => ({ name: entry.name.trim(), secret_ref: entry.secret_ref ?? "pending" }));
}

/** `<범위|global>/<서버>/[header:]<이름>` — Rust 쪽 정리가 이 꼴을 안다 */
export function secretVaultKey(projectId: string, serverName: string, transport: McpTransport, entryName: string): string {
  return `${projectId || "global"}/${serverName}/${transport === "http" ? "header:" : ""}${entryName.trim()}`;
}

export function serverSummary(server: AiMcpServer): string {
  return server.transport === "http" ? (server.url ?? "") : [server.command, ...(server.args ?? [])].join(" ");
}

/** 지운 프로젝트를 가리키는 항목도 그대로 고를 수 있게 목록에만 남은 id 를 더한다 */
export function scopeIds(localProjectIds: string[], list: AiMcpServer[]): string[] {
  return [...new Set([...localProjectIds, ...list.flatMap((s) => (s.project_id ? [s.project_id] : []))])];
}

/** 편집은 `index`(저장 자리)로 한다 — 표시 순서와 다르다 */
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

/** 비밀 칸이 있는데 볼트 저장에 동의하지 않았으면 낼 수 없다 */
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

export function sideChatFields(sideChat: boolean | undefined): Pick<AiMcpServer, "side_chat"> {
  return sideChat ? { side_chat: true } : {};
}

/** 옛 `side_chat_no_ask` 칸이 남아 있었으면 함께 걷는다 */
export function toggleSideChat(server: AiMcpServer): AiMcpServer {
  const { side_chat: _on, ...rest } = server;
  delete (rest as Record<string, unknown>).side_chat_no_ask;
  return { ...rest, ...sideChatFields(!server.side_chat) };
}

export function toggleAgentIn(agents: string[], id: string): string[] {
  return agents.includes(id) ? agents.filter((agent) => agent !== id) : [...agents, id];
}

/** 대상 칩을 건드리지 않은 옛 항목은 `agents` 생략을 그대로 보존한다 */
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
    sideChat?: boolean;
  },
  initial: AiMcpServer | null,
  agentsChanged: boolean,
): AiMcpServer {
  const selectedAgents = agentsChanged || initial === null ? [...f.agents] : initial.agents;
  const scope = f.projectId ? { project_id: f.projectId } : {};
  const side = sideChatFields(f.sideChat);
  return f.transport === "stdio"
    ? { name: f.name.trim(), enabled: f.enabled, agents: selectedAgents, ...scope, transport: f.transport, command: f.command.trim(), args: [...f.args], env: secretRefs(f.secrets), ...side }
    : { name: f.name.trim(), enabled: f.enabled, agents: selectedAgents, ...scope, transport: f.transport, url: f.url.trim(), headers: secretRefs(f.secrets), ...side };
}

/** 이름 중복은 같은 범위 안에서만 본다 */
export function sameScopeNames(list: AiMcpServer[], editing: number | null, projectId: string): string[] {
  return list
    .filter((_, i) => i !== editing)
    .filter((entry) => (entry.project_id ?? "") === projectId)
    .map((entry) => entry.name);
}

export function putServer(list: AiMcpServer[], index: number | null, server: AiMcpServer): { list: AiMcpServer[]; index: number } {
  const next = [...list];
  if (index === null) {
    next.push(server);
    return { list: next, index: next.length - 1 };
  }
  next[index] = server;
  return { list: next, index };
}
