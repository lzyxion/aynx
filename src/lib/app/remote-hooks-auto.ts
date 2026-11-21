import { invoke, listen, type UnlistenFn } from "../ipc";
import { findPaneByStream } from "$lib/session";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { showNotice } from "$lib/app/notice";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";

/** Rust `agent_hooks::remote_auto_install` 의 이벤트 — 모든 창에 방송되므로 그 스트림의 타일을 쥔 창에서만 띄운다 */
export interface RemoteHooksAutoPayload {
  stream: string;
  alias: string;
  agent: string;
  version: number | null;
  reason: string | null;
  /** Rust 표의 `needs_trust_note` */
  needsTrust?: boolean;
}

/** 이 창의 타일이 아니면 `false`(하네스가 본다) */
export function remoteHooksAuto(p: RemoteHooksAutoPayload): boolean {
  if (typeof p?.stream !== "string") return false;
  if (!residentWindowTabs().some((tab) => findPaneByStream(tab.root, p.stream) !== null)) return false;
  if (p.reason == null) {
    const key = p.needsTrust === true ? "app.projects.hooks.auto.doneTrust" : "app.projects.hooks.auto.done";
    toast.success(t(key, { alias: p.alias, agent: p.agent, version: String(p.version ?? "") }));
  } else {
    showNotice(t("app.projects.hooks.auto.failed", { reason: stripReason(p.reason) }));
  }
  return true;
}

/** Rust `agent_hooks::LocalRefreshNotice` */
export interface LocalHookRefreshNotice {
  agent: string;
  version: number;
}

/** Rust 가 한 번만 건넨다 — 리로드에는 빈 목록 */
export async function noticeLocalHookRefresh(): Promise<void> {
  const list = await invoke<LocalHookRefreshNotice[]>("agent_hooks_take_local_refresh").catch(() => []);
  for (const n of list) {
    toast.success(t("app.projects.hooks.auto.localRefreshed", { agent: n.agent, version: String(n.version) }));
  }
}

export function listenRemoteHooksAuto(): Promise<UnlistenFn> {
  return listen<RemoteHooksAutoPayload>("remote-hooks-auto", (ev) => void remoteHooksAuto(ev.payload));
}
