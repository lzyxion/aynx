import type { AgentStatus } from "$lib/agent-status";
import type { SideChatStatus } from "$lib/side-chat-api";
import { chatTileDot } from "$lib/chat-tile/chat-tile-status";
import { hasAgentUnseen } from "$lib/app/agent-unseen.svelte.js";

/**
 * 채팅 잎의 탭 점 재료 — 잎(`paneId`)마다 이 창이 본 상태. 잎 모듈이다: 값 import 는 agent-unseen · chat-tile-status 뿐
 * (`app/agent-status` 가 읽고 `app/chat-tile-live` 가 적는다 — 어느 한쪽에 두면 순환이 선다).
 * 안 봄 표식은 터미널 AI 타일과 같은 표(`agent-unseen`)라 탭을 보는 순간의 지우기를 그대로 받는다.
 */

interface Row {
  cli: "claude" | "codex";
  status: SideChatStatus;
  sending: boolean;
  pending: number;
}

const rows = $state<Record<string, Row>>({});

export function setChatTileActivity(paneId: string, cli: "claude" | "codex", a: { status: SideChatStatus; sending: boolean; pending: number }): void {
  const cur = rows[paneId];
  if (cur && cur.cli === cli && cur.status === a.status && cur.sending === a.sending && cur.pending === a.pending) return;
  rows[paneId] = { cli, status: a.status, sending: a.sending, pending: a.pending };
}

export function dropChatTileStatus(paneId: string): void {
  if (paneId in rows) delete rows[paneId];
}

export function chatTileStatusOf(paneId: string): AgentStatus | null {
  const r = rows[paneId];
  return r ? chatTileDot({ status: r.status, sending: r.sending, pending: r.pending, unseen: hasAgentUnseen(paneId) }) : null;
}

export function chatTileCliOf(paneId: string): "claude" | "codex" | null {
  return rows[paneId]?.cli ?? null;
}
