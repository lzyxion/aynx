import { invoke, listen } from "../ipc";
import { tick } from "svelte";
import { openInNewTab } from "$lib/app/tabs.svelte.js";
import { openSessionSheet } from "$lib/app/session-sheet.svelte.js";
import { findDbConn } from "$lib/app/db-conns.svelte.js";
import { paneForDetached, parseDetached, type DetachedSession } from "$lib/session/detached";

/**
 * 떨어진 세션 — 아무 창도 데려가지 않은 채 세션 서버에 살아 있는 세션. 닫지 않는다 — 사람이 [새 탭에 붙이기] · [닫기] 를 고른다.
 * 누가 떨어진 것인지는 Rust(`detached_sessions`)가 거른다 — 프런트는 창 목록 · OS 를 모른다.
 */

let list = $state<DetachedSession[]>([]);
let reveal = $state(0);

let started = false;
let debounce: ReturnType<typeof setTimeout> | null = null;

export function detachedSessions(): DetachedSession[] {
  return list;
}

export function detachedCount(): number {
  return list.length;
}

export async function refreshDetached(): Promise<number> {
  try {
    list = parseDetached(await invoke("detached_sessions"));
  } catch {
    // 서버 불통 — 다음 이벤트 · 포커스가 다시 읽는다
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

export function startDetached(): void {
  if (started || typeof window === "undefined") return;
  started = true;
  void listen("sessions-detached-changed", () => schedule()).catch(() => {});
  void listen("session-server-connected", () => schedule()).catch(() => {});
  window.addEventListener("focus", () => schedule());
  void refreshDetached();
}

export function openDetachedList(): void {
  openSessionSheet();
  void refreshDetached();
  reveal++;
  void tick();
}

/** 세션 목록 판이 이 묶음으로 스크롤할 신호 — 바뀔 때마다 */
export function detachedReveal(): number {
  return reveal;
}

export function attachDetachedInNewTab(s: DetachedSession): void {
  openInNewTab(paneForDetached(s, s.conn ? findDbConn(s.conn)?.name : null));
  list = list.filter((x) => x.stream !== s.stream);
  schedule();
}

/** 지금 떨어져 있을 때만 닫는다(그 사이 누가 붙었으면 아무 일도 없다) */
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
