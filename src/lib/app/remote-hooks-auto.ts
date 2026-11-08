import { invoke, listen, type UnlistenFn } from "../ipc";
import { findPaneByStream } from "$lib/session";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { showNotice } from "$lib/app/notice";
import { stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";

/**
 * **원격 훅 자동 설치의 알림** (2026-10-08 — docs/log/2026-09-24-remote-agent-signals.md "자동 설치").
 *
 * 원격 타일을 열 때 Rust 가 호스트 옵션 에이전트 활성화(`agent` — 옛 `remote_hooks` · 기본 켬 · 2026-10-26 부터 AI 타일이
 * 아니어도)를 보고 서버에 Claude Code · Codex 훅을 심는다
 * (`agent_hooks::remote_auto_install` — 메뉴 설치와 같은 함수). 새로 심었거나 못 심었을 때만 이벤트
 * `remote-hooks-auto` 가 온다 — 이미 최신이면 조용하고, 같은 호스트 · 같은 에이전트는 앱 세션 동안 한 번뿐이다(Rust 장부).
 * 이벤트는 모든 창에 방송되므로 그 스트림의 타일을 쥔 창에서만 띄운다(`agent-signal` 과 같은 규칙).
 */
export interface RemoteHooksAutoPayload {
  stream: string;
  alias: string;
  agent: string;
  version: number | null;
  reason: string | null;
  /** 그 CLI 안의 `/hooks` 승인을 받아야 훅이 돈다(Codex — Rust 표의 `needs_trust_note`). */
  needsTrust?: boolean;
}

/** 한 건을 띄운다 — 이 창의 타일이 아니면 `false`(하네스가 본다). */
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

/** Rust `agent_hooks::LocalRefreshNotice` — 이 PC 의 우리 훅 항목을 앱이 새 판 모양으로 갈아 썼다(신뢰 단계가 있는 CLI 만). */
export interface LocalHookRefreshNotice {
  agent: string;
  version: number;
}

/**
 * **로컬 훅 자동 갱신의 안내** (2026-10-08 — `agent_hooks` 머리말 "우리 항목만 자동 갱신"). 앱이 뜰 때 Rust 가 이 PC 설정의
 * 우리 항목만 새 등록 모양으로 맞추고, Codex 처럼 바뀐 훅을 그 CLI 안에서 다시 승인(`/hooks`)해야 하는 것만 여기로 한 번 넘긴다.
 * 주 창이 부팅에서 한 번 부른다(Rust 가 한 번만 건넨다 — 리로드에는 빈 목록).
 */
export async function noticeLocalHookRefresh(): Promise<void> {
  const list = await invoke<LocalHookRefreshNotice[]>("agent_hooks_take_local_refresh").catch(() => []);
  for (const n of list) {
    toast.success(t("app.projects.hooks.auto.localRefreshed", { agent: n.agent, version: String(n.version) }));
  }
}

/** 창마다(메인 · 떼어 낸 창) `mountAppListeners` 가 건다. */
export function listenRemoteHooksAuto(): Promise<UnlistenFn> {
  return listen<RemoteHooksAutoPayload>("remote-hooks-auto", (ev) => void remoteHooksAuto(ev.payload));
}
