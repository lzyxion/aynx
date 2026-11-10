import { invoke, listen } from "../ipc";
import { tick } from "svelte";
import { openInNewTab } from "$lib/app/tabs.svelte.js";
import { openSessionSheet } from "$lib/app/session-sheet.svelte.js";
import { findDbConn } from "$lib/app/db-conns.svelte.js";
import { paneForDetached, parseDetached, type DetachedSession } from "$lib/session/detached";

/**
 * **떨어진 세션** — 아무 창도 데려가지 않은 채 세션 서버에 살아 있는 세션(설계 4.5 · ③-4).
 *
 * 예전(0c 전 임시 정책)에는 복원이 끝난 창이 "데려가지 않은 세션" 을 **닫았다**(`release_unclaimed_sessions`). ③-4
 * 부터 닫지 않는다 — 복원이 데려가지 않았거나(`restore_done_sessions` 가 표시만 한다) 마지막 창이 지금 없는 세션은
 * 떨어진 채 여기 목록에 남고, 사람이 [새 탭에 붙이기] 또는 [닫기] 를 고른다. 누가 떨어진 것인지는 Rust 가 거른다
 * (`detached_sessions` — 프런트는 창 목록·OS 를 모른다).
 *
 * 창마다 하나의 사본이다. 다시 읽는 때: 서버 이벤트 `sessions-detached-changed`(디바운스) · 창 포커스 · 연 화면이 직접.
 * 그리는 곳: 세션 목록 판(`SessionSheet` → `DetachedSessions`) · 런처 독의 바닥 위 한 줄 · 부팅 안내 · 트레이 메뉴(Rust).
 */

let list = $state<DetachedSession[]>([]);
/** 세션 목록 판이 이 묶음으로 스크롤해야 하는가 — [`openDetachedList`] 가 세운다 */
let reveal = $state(0);

let started = false;
let debounce: ReturnType<typeof setTimeout> | null = null;

/** 지금 떨어진 세션들 — 반응형 */
export function detachedSessions(): DetachedSession[] {
  return list;
}

/** 떨어진 세션 수 — 반응형 */
export function detachedCount(): number {
  return list.length;
}

/** 목록을 다시 읽는다 — 실패하면 그대로 둔다(서버가 아직 안 붙었다) */
export async function refreshDetached(): Promise<number> {
  try {
    list = parseDetached(await invoke("detached_sessions"));
  } catch {
    // 서버 불통 — 다음 이벤트·포커스가 다시 읽는다
  }
  return list.length;
}

function schedule(): void {
  if (debounce !== null) clearTimeout(debounce);
  debounce = setTimeout(() => {
    debounce = null;
    void refreshDetached();
  }, 250);
}

/** 부팅에서 한 번(모든 창) — 이벤트·포커스로 다시 읽는다 */
export function startDetached(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void listen("sessions-detached-changed", () => schedule()).catch(() => {});
  void listen("session-server-connected", () => schedule()).catch(() => {});
  window.addEventListener("focus", () => schedule());
  void refreshDetached();
}

/** 세션 목록 판의 "떨어진 세션" 묶음으로 데려간다(부팅 안내 [보기] · 독 · 트레이) */
export function openDetachedList(): void {
  openSessionSheet();
  void refreshDetached();
  reveal++;
  void tick();
}

/** 판이 스크롤할 신호 — 바뀔 때마다 그 묶음을 보인다 */
export function detachedReveal(): number {
  return reveal;
}

/** [새 탭에 붙이기] — 그 종류의 새 타일을 새 탭에 열고, 첫 열기가 그 스트림에 붙는다(새 셸을 열지 않는다) */
export function attachDetachedInNewTab(s: DetachedSession): void {
  openInNewTab(paneForDetached(s, s.conn ? findDbConn(s.conn)?.name : null));
  // 목록에서 곧바로 뺀다 — 붙고 나면 서버 이벤트가 다시 맞춘다(붙기가 실패하면 다시 나타난다).
  list = list.filter((x) => x.stream !== s.stream);
  schedule();
}

/** [닫기] — 지금 떨어져 있을 때만 닫는다(그 사이 누가 붙었으면 아무 일도 없다). 닫았으면 `true` */
export async function closeDetached(stream: string): Promise<boolean> {
  let closed = false;
  try {
    closed = (await invoke<boolean>("close_detached_session", { stream })) === true;
  } catch {
    closed = false;
  }
  await refreshDetached();
  return closed;
}
