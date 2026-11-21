import { invoke, listen } from "../ipc";
import { parseDbHistory, type DbHistory } from "$lib/db-history";

/** DB 접속 기록(`db-history.json`)의 창 사본 — 쓰는 것은 Rust 하나이고 이 모듈은 읽기만 한다. */

/** Rust `db_history::CHANGED_EVENT` 와 같은 글자 */
export const DB_HISTORY_CHANGED_EVENT = "db-history-changed";

let history = $state<DbHistory>({});

export function dbHistory(): DbHistory {
  return history;
}

export async function refreshDbHistory(): Promise<void> {
  try {
    history = parseDbHistory(await invoke<unknown>("db_history_list"));
  } catch (e) {
    console.warn("[aynx] DB 접속 기록을 읽지 못했습니다 (무시):", e);
  }
}

export function mountDbHistory(): () => void {
  void refreshDbHistory();
  const changed = listen(DB_HISTORY_CHANGED_EVENT, () => void refreshDbHistory()).catch(() => () => {});
  const onFocus = () => void refreshDbHistory();
  if (typeof window !== "undefined") window.addEventListener("focus", onFocus);
  return () => {
    void changed.then((un) => un());
    if (typeof window !== "undefined") window.removeEventListener("focus", onFocus);
  };
}
