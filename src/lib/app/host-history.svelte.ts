import { invoke, listen } from "../ipc";
import { parseHistory, type HostHistory } from "$lib/host-history";

/**
 * **접속 이력의 창 사본** (docs/log/2026-09-23-host-history.md).
 *
 * 쓰는 것은 Rust 하나다 — 접속이 끝날 때마다 `history.json` 에 한 줄 적고
 * `host-history-changed` 를 쏜다. 이 모듈은 그 파일을 **읽기만** 한다: 창마다 사본 하나를
 * 들고, 부팅 때 한 번 · 이벤트가 올 때마다 · 창이 포커스를 얻을 때마다 다시 읽는다.
 * 포커스는 이벤트를 놓친 경우(창이 늦게 떴다 등)의 그물이다 — 파일 하나 읽기라 싸다.
 *
 * 메인 창과 떼어 낸 창이 같은 `+page` 를 지나므로 [`mountHostHistory`] 한 곳에서 둘 다 걸린다.
 */

/** 이벤트 이름 — Rust `host_history::CHANGED_EVENT` 와 같은 글자 */
export const HOST_HISTORY_CHANGED_EVENT = "host-history-changed";

let history = $state<HostHistory>({});

/** 지금 사본 (반응형) — 목록 정렬·말풍선·팔레트 "최근" 이 읽는다 */
export function hostHistory(): HostHistory {
  return history;
}

/** 다시 읽는다. 실패는 삼킨다 — 이력은 없어도 되는 편의값이다 */
export async function refreshHostHistory(): Promise<void> {
  try {
    history = parseHistory(await invoke<unknown>("host_history_list"));
  } catch (e) {
    console.warn("[aynx] 접속 이력을 읽지 못했습니다 (무시):", e);
  }
}

/** 통째로 지운다 — 설정 › 일반의 [지우기]. 실패는 **던진다**(설정 화면이 한 줄로 보인다) */
export async function clearHostHistory(): Promise<void> {
  await invoke("host_history_clear");
  history = {};
}

/** 호스트 이름 변경을 따라간다 — 이름 변경 팬아웃(`app/host-rename.ts`) 전용 */
export function renameHostHistory(from: string, to: string): Promise<void> {
  return invoke("host_history_rename", { from, to });
}

/** 별칭 하나를 지운다 — 제거 팬아웃(`app/host-remove.ts`) 전용 */
export async function forgetHostHistory(aliases: readonly string[]): Promise<void> {
  // 하나씩 차례로 — Rust 쪽 잠금이 어차피 줄 세우므로 동시에 쏠 이유가 없다.
  for (const alias of aliases) await invoke("host_history_forget", { alias });
}

/**
 * 창 수명 동안 사본을 맞춘다 — `mountAppListeners` 가 건다. 돌려준 함수가 전부 푼다.
 */
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
