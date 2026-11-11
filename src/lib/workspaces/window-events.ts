// 웹뷰마다 저장소가 갈리므로 응답 id를 가진 작은 요청/ACK 통로를 쓴다.
import { emitTo, listen } from "../ipc";
import { currentWindowLabel } from "$lib/context";
import type { UnsavedWindow } from "./quit";
export type WindowAction =
  | { kind: "inspect" }
  | { kind: "saveDocs"; ids: string[] }
  | { kind: "hostAliases"; aliases: string[]; to?: string }
  /** `token` — 창 이관에서 받는 창이 짐을 꺼내기 직전·물러설 때(보낸 창이 실은 초안을 확인 · 잠금 · 풀기 — `app/tear` 의 `holdTearSource`) */
  | { kind: "pause"; token?: number }
  | { kind: "resume"; token?: number }
  /** 앱 전체 종료 직전 — 이 창의 세션 타일을 체크포인트와 함께 놓는다(세션은 서버에 산다 · ③-2) */
  | { kind: "leaveSessions" }
  | { kind: "release"; token: number }
  | { kind: "focus"; paneId?: string; streamId?: string; workspaceId?: string; tabKey?: string; tileKey?: string }
  /**
   * 보조 창 → 주 창: 작업안을 열어 달라(2026-10-25 — 작업안은 주 창의 채팅 독 갈래에만 산다). `at` = 그 작업안으로 데려가기 ·
   * `history` = 기록의 그 실행 · 둘 다 없으면 `view` 로 연다. 받는 쪽은 `app/plans.svelte.ts` 의 `takePlansWindowRequest`.
   */
  | { kind: "plans"; at?: string; history?: string; view?: "list" | "history" };
export interface WindowRequest { id: string; sender: string; action: WindowAction }
export type WindowReply = boolean | UnsavedWindow;
let localHandler: ((action: WindowAction) => Promise<WindowReply>) | null = null;
export async function requestWindow(label: string, action: WindowAction, timeout = 3000): Promise<WindowReply | null> {
  const id = label === currentWindowLabel() ? null : crypto.randomUUID();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let unlisten: (() => void) | undefined;
  let settled = false;
  try {
    return await new Promise<WindowReply | null>((resolve) => {
      const finish = (reply: WindowReply | null) => { settled = true; resolve(reply); };
      timer = setTimeout(() => finish(null), timeout);
      if (label === currentWindowLabel()) {
        const handle = localHandler;
        if (!handle) { finish(null); return; }
        void Promise.resolve().then(() => handle(action)).catch(() => false).then(finish);
        return;
      }
      void listen<WindowReply>("workspace-reply-" + id, (event) => finish(event.payload), { target: { kind: "WebviewWindow", label: currentWindowLabel() } }).then((un) => {
        if (settled) { un(); return; }
        unlisten = un;
        void emitTo(label, "workspace-request", { id, sender: currentWindowLabel(), action }).catch(() => finish(null));
      }).catch(() => finish(null));
    });
  } finally { clearTimeout(timer); unlisten?.(); }
}
export function listenWindowRequests(handle: (action: WindowAction) => Promise<WindowReply>): Promise<() => void> {
  localHandler = handle;
  return listen<WindowRequest>("workspace-request", (event) => {
    const { id, sender, action } = event.payload;
    if (sender === currentWindowLabel()) return;
    void handle(action).catch(() => false).then((reply) => emitTo(sender, "workspace-reply-" + id, reply)).catch(() => {});
  }, { target: { kind: "WebviewWindow", label: currentWindowLabel() } }).then((un) => () => {
    if (localHandler === handle) localHandler = null;
    un();
  }).catch((error) => {
    if (localHandler === handle) localHandler = null;
    throw error;
  });
}
