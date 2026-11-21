import { invoke, listen } from "../ipc";
import { parseHistory, type HostHistory } from "$lib/host-history";

/**
 * 접속 이력의 창 사본 — 쓰는 것은 Rust 하나이고 여기서는 읽기만 한다 (docs/log/2026-09-23-host-history.md).
 * 창 포커스 때도 다시 읽는다 — 이벤트를 놓친 경우의 그물이다.
 */

/** Rust `host_history::CHANGED_EVENT` 와 같은 글자 */
export const HOST_HISTORY_CHANGED_EVENT = "host-history-changed";

let history = $state<HostHistory>({});

export function hostHistory(): HostHistory {
  return history;
}

/** 실패는 삼킨다 — 이력은 없어도 되는 편의값이다 */
export async function refreshHostHistory(): Promise<void> {
  try {
    history = parseHistory(await invoke<unknown>("host_history_list"));
  } catch (e) {
    console.warn("[aynx] 접속 이력을 읽지 못했습니다 (무시):", e);
  }
}

/** 실패는 던진다(설정 화면이 한 줄로 보인다) */
export async function clearHostHistory(): Promise<void> {
  await invoke("host_history_clear");
  history = {};
}

export function renameHostHistory(from: string, to: string): Promise<void> {
  return invoke("host_history_rename", { from, to });
}

export async function forgetHostHistory(aliases: readonly string[]): Promise<void> {
  for (const alias of aliases) await invoke("host_history_forget", { alias });
}

export function mountHostHistory(): () => void {
  void refreshHostHistory();
  const changed = listen(HOST_HISTORY_CHANGED_EVENT, () => void refreshHostHistory()).catch(
    () => () => {},
  );
  const onFocus = () => void refreshHostHistory();
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  return () => {
    void changed.then((un) => un());
    if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
  };
}
