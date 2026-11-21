import { tick } from "svelte";
import { flatConversations, type AgentConversation } from "$lib/agent-sessions";
import { conversationList } from "$lib/app/agent-sessions.svelte.js";

/**
 * 기록 보기 시트의 저장소 — 본문은 시트 컴포넌트의 상태에만 쥐고 닫히면 버린다(저장 · 이관 짐 · 로그 · MCP 에 싣지 않는다).
 * 포커스는 `app/focus-return` 의 모달 표에 올리지 않고 스스로 돌려준다 — 시트가 떠 있는 동안 다른 모달의 반환이 막히지 않게.
 */

export interface ConversationView {
  conv: AgentConversation;
  at?: { tabId: string; paneId: string };
  /** 없으면 `replace` */
  how?: "replace" | "beside" | "tab";
  /** 오케스트레이션 작업자의 고정 대화 — 쪽을 그 Attempt 의 고정 파일에서만 받고 재개 · 새 대화로 계속은 내지 않는다(작업자는 Run 이 부린다) */
  worker?: { runId: string; attemptId: string };
}

let viewing = $state<ConversationView | null>(null);
let returnTo: HTMLElement | null = null;

export function conversationView(): ConversationView | null {
  return viewing;
}

export function conversationViewOpen(): boolean {
  return viewing !== null;
}

/** 이미 떠 있으면 내용만 갈아 끼운다(돌아갈 자리는 처음 연 때의 것) */
export function viewConversation(
  conv: AgentConversation,
  at?: { tabId: string; paneId: string },
  how: "replace" | "beside" | "tab" = "replace",
): void {
  rememberReturn();
  viewing = { conv, at, how };
}

function rememberReturn(): void {
  if (viewing === null && typeof document !== "undefined") {
    const el = document.activeElement;
    returnTo = el instanceof HTMLElement && el !== document.body ? el : null;
  }
}

/** `conv` 는 보드가 지은 머리 정보(제목 · 폴더 · 브랜치)다 */
export function viewWorkerConversation(conv: AgentConversation, worker: { runId: string; attemptId: string }): void {
  rememberReturn();
  viewing = { conv, worker };
}

/** `restore` 거짓(재개 · 타일로 가기)이면 돌려주지 않는다 — 그 동작이 포커스를 가져간다 */
export function closeConversationView(restore = true): void {
  if (viewing === null) return;
  viewing = null;
  const back = returnTo;
  returnTo = null;
  if (!restore || back === null) return;
  void tick().then(() => {
    const el = document.activeElement;
    const lost = el === null || el === document.body || el === document.documentElement;
    if (lost && back.isConnected) back.focus({ preventScroll: true });
  });
}

/** 팔레트가 닫히며 다음 틱에 포커스를 타일로 돌려주므로 그 뒤에 연다 — 앞서 열면 시트가 포커스를 빼앗긴다 */
export function viewConversationById(agent: string, id: string): void {
  const s = flatConversations(conversationList()).find((c) => c.agent === agent && c.id === id);
  if (!s) return;
  void tick().then(() => viewConversation(s));
}
