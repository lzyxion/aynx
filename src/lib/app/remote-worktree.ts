import { invoke, listen, type UnlistenFn } from "../ipc";
import {
  parsePrepEvent,
  WORKTREE_PREP_EVENT,
  type WorktreePrepAnswer,
  type WorktreePrepEvent,
} from "$lib/remote-worktree";

/** 접속 명령을 부르기 전에 기다려야 첫 이벤트(`preparing`)를 놓치지 않는다 */
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

/** 기다리던 준비가 있었으면 `true` */
export async function answerWorktreePrep(ticket: string, answer: WorktreePrepAnswer): Promise<boolean> {
  try {
    return await invoke<boolean>("ssh_worktree_answer", { ticket, answer });
  } catch {
    return false;
  }
}
