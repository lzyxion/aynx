import { invoke, listen } from "../ipc";
import { parseDbHistory, type DbHistory } from "$lib/db-history";

/**
 * **DB 접속 기록의 창 사본** (2026-10-20 — `app/host-history.svelte.ts` 와 같은 모양).
 *
 * 쓰는 것은 Rust 하나다 — 세션 서버가 사람 쿼리 타일의 접속 성공마다 `db-history.json` 에 한 줄 적고 `db-history-changed` 를 쏜다
 * (GUI 가 중계). 연결을 지울 때 그 줄을 걷는 것도 Rust(`db_conn_save` · `remove_host`)다. 이 모듈은 그 파일을 **읽기만** 한다: 창마다
 * 사본 하나를 들고, 부팅 때 한 번 · 이벤트가 올 때마다 · 창이 포커스를 얻을 때마다 다시 읽는다(포커스는 이벤트를 놓친 경우의 그물).
 */

/** 이벤트 이름 — Rust `db_history::CHANGED_EVENT` 와 같은 글자 */
export const DB_HISTORY_CHANGED_EVENT = "db-history-changed";

let history = $state<DbHistory>({});

/** 지금 사본 (반응형) — 독 DB 칸의 "최근" 정렬이 읽는다 */
export function dbHistory(): DbHistory {
  return history;
}

/** 다시 읽는다. 실패는 삼킨다 — 기록은 없어도 되는 편의값이다(옛 판 GUI 명령이 없을 때도 빈 표 그대로) */
export async function refreshDbHistory(): Promise<void> {
  try {
    history = parseDbHistory(await invoke<unknown>("db_history_list"));
  } catch (e) {
    console.warn("[aynx] DB 접속 기록을 읽지 못했습니다 (무시):", e);
  }
}

/** 창 수명 동안 사본을 맞춘다 — `mountAppListeners` 가 건다. 돌려준 함수가 전부 푼다. */
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
