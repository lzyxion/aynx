import { invoke, listen, type UnlistenFn } from "../ipc";
import {
  parsePrepEvent,
  WORKTREE_PREP_EVENT,
  type WorktreePrepAnswer,
  type WorktreePrepEvent,
} from "$lib/remote-worktree";

/**
 * **원격 새 워크트리 준비의 통로** — 이벤트 구독과 답 (docs/log/2026-09-29-remote-worktree-after-connect.md).
 * 규칙(페이로드 읽기)은 순수 층 `$lib/remote-worktree` 에 있다.
 */

/**
 * 그 표(`ticket`)의 준비 이벤트만 받는다. 구독이 선 뒤에 풀리는 약속을 돌려준다 — 접속 명령을 부르기 **전에** 기다려야
 * 첫 이벤트(`preparing`)를 놓치지 않는다. 구독 자체가 실패하면(이벤트 미지원) 아무것도 받지 않는 해제 함수다.
 */
export async function listenWorktreePrep(
  ticket: string,
  onEvent: (ev: WorktreePrepEvent) => void,
): Promise<UnlistenFn> {
  try {
    return await listen<unknown>(WORKTREE_PREP_EVENT, (e) => {
      const ev = parsePrepEvent(e.payload);
      if (ev && ev.ticket === ticket) onEvent(ev);
    });
  } catch {
    return () => {};
  }
}

/** 막대의 답 · 타일이 닫힐 때의 멈춤 — 기다리던 준비가 있었으면 `true`. 실패는 삼킨다(답할 곳이 이미 없다) */
export async function answerWorktreePrep(ticket: string, answer: WorktreePrepAnswer): Promise<boolean> {
  try {
    return await invoke<boolean>("ssh_worktree_answer", { ticket, answer });
  } catch {
    return false;
  }
}
