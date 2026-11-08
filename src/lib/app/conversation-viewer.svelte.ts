import { tick } from "svelte";
import { flatConversations, type AgentConversation } from "$lib/agent-sessions";
import { conversationList } from "$lib/app/agent-sessions.svelte.js";

/**
 * **기록 보기의 저장소** — 지금 펼친 대화 하나(없으면 `null`)와 닫은 뒤 키보드가 돌아갈 자리
 * (docs/log/2026-09-27-conversation-viewer.md). 그림은 `ConversationViewer.svelte`(타일 캔버스 오른쪽에
 * 뜨는 시트), 여는 문 — 프로젝트 시작 화면의 줄(`V` · [기록 보기]) · 팔레트의 대화 줄(`Ctrl+Enter` · 그리고
 * aynx 밖에서 열린 대화의 재개 — 시트가 확인을 한 번 묻는다). 대시보드의 지난 대화 줄은 2026-09-28 에 뺐다.
 *
 * 본문은 여기 두지 않는다 — 시트가 열릴 때 Rust 에서 한 쪽씩 받아 **그 컴포넌트의 상태에만** 쥐고, 닫히면
 * 버린다(저장 · 이관 짐 · 로그 · MCP 어디에도 싣지 않는다).
 *
 * ## 포커스
 *
 * 독과 같은 방식으로 **스스로** 돌려준다(`app/focus-return` 의 모달 표에 올리지 않는다 — 시트가 떠 있는 동안
 * 다른 모달이 열렸다 닫혀도 그쪽의 반환이 막히지 않게): 열 때의 `document.activeElement` 를 적어 두고, 닫은 뒤
 * 포커스가 `<body>` 로 떨어졌을 때만 그 자리로 돌려준다. 재개 · 타일로 가기처럼 **갈 곳을 스스로 정한** 닫기는
 * 돌려주지 않는다.
 */

export interface ConversationView {
  conv: AgentConversation;
  /** 시작 화면에서 열었으면 그 타일 자리 — 재개 · 새 대화로 계속이 그 자리를 갈아 끼운다 */
  at?: { tabId: string; paneId: string };
  /**
   * `at` 을 어떻게 쓰나 — `replace` 면 그 자리를 갈아 끼우고(시작 화면), `beside` 면 그 타일 옆에 분할로
   * (이 폴더의 지난 대화 — docs/log/2026-09-27-folder-conversations.md). 없으면 `replace`.
   */
  how?: "replace" | "beside" | "tab";
  /**
   * 오케스트레이션 작업자의 **고정 대화**(6단계 — 보드 [기록 보기]). 있으면 쪽을 그 Attempt 의 고정 파일에서만 받고(Run 보드의 op —
   * `orchestration_worker_transcript`) 재개 · 새 대화로 계속은 내지 않는다(작업자는 Run 이 부린다).
   */
  worker?: { runId: string; attemptId: string };
}

let viewing = $state<ConversationView | null>(null);
let returnTo: HTMLElement | null = null;

/** 지금 펼친 대화(없으면 `null`) — 반응형 */
export function conversationView(): ConversationView | null {
  return viewing;
}

/** 시트가 떠 있나 — 반응형(창의 Escape 사슬이 본다) */
export function conversationViewOpen(): boolean {
  return viewing !== null;
}

/** 대화 하나를 펼친다 — 이미 떠 있으면 내용만 갈아 끼운다(돌아갈 자리는 처음 연 때의 것) */
export function viewConversation(
  conv: AgentConversation,
  at?: { tabId: string; paneId: string },
  how: "replace" | "beside" | "tab" = "replace",
): void {
  rememberReturn();
  viewing = { conv, at, how };
}

/** 연 자리를 적어 둔다(처음 열 때만) */
function rememberReturn(): void {
  if (viewing === null && typeof document !== "undefined") {
    const el = document.activeElement;
    returnTo = el instanceof HTMLElement && el !== document.body ? el : null;
  }
}

/** Run 작업자의 고정 대화를 펼친다(6단계 — 보드 [기록 보기]). `conv` 는 보드가 지은 머리 정보(제목 · 폴더 · 브랜치)다 */
export function viewWorkerConversation(conv: AgentConversation, worker: { runId: string; attemptId: string }): void {
  rememberReturn();
  viewing = { conv, worker };
}

/**
 * 닫는다. `restore` 가 참이면(Escape · 닫기 단추 · 바깥 누르기) 다음 틱에 포커스가 잃어버린 채일 때만 연 자리로
 * 돌려준다. 거짓이면(재개 · 타일로 가기) 잊는다 — 그 동작이 포커스를 가져간다.
 */
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

/**
 * 팔레트의 `Ctrl+Enter` — 목록에서 그 대화를 찾아 펼친다. 팔레트가 닫히며 다음 틱에 포커스를 타일로 돌려주므로
 * 그 **뒤에** 연다(팔레트의 "사용량" 줄과 같은 처방) — 그래야 시트가 받은 포커스를 빼앗기지 않는다.
 */
export function viewConversationById(agent: string, id: string): void {
  const s = flatConversations(conversationList()).find((c) => c.agent === agent && c.id === id);
  if (!s) return;
  void tick().then(() => viewConversation(s));
}
