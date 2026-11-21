/**
 * 앱 안 업데이트의 화면 상태 — 알리기만 한다. 내려받기 · 설치는 사람이 고를 때만(사용자 결정).
 * 상태의 주인은 Rust `updater.rs` 이고 여기는 그 사본이다. 주 창에서만 선다 — 원격 창은 명령이 모두 거절된다(`remote/deny.rs`).
 */

import { invoke, listen } from "$lib/ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import { settings } from "$lib/settings.svelte.js";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import {
  AUTO_CHECK_MS,
  FIRST_CHECK_DELAY_MS,
  isNewerView,
  shouldToast,
  shownVersion,
  UPDATE_EVENT,
  type UpdateView,
} from "$lib/updater";

const FOCUS_CARD = "update-card";

export type LeaveForUpdate = () => Promise<{ ok: boolean; error: string | null }>;

let view = $state<UpdateView | null>(null);
let cardOpen = $state(false);
let restarting = $state(false);
let started = false;
let leave: LeaveForUpdate | null = null;
let readyNoticed: string | null = null;
/** `toasted` 를 적기 전에 뜬 사본이 뒤따라와도 두 번 띄우지 않게 */
const toastedHere = new Set<string>();

export function updateView(): UpdateView | null {
  return view;
}

export function updateCardOpen(): boolean {
  return cardOpen;
}

export function updateRestarting(): boolean {
  return restarting;
}

export function openUpdateCard(): void {
  if (cardOpen || !view) return;
  rememberFocusOrigin(FOCUS_CARD);
  cardOpen = true;
}

export function closeUpdateCard(): void {
  if (!cardOpen) return;
  cardOpen = false;
  returnFocus(FOCUS_CARD);
}

function accept(next: UpdateView): void {
  // 주 창 밖은 사본을 들지 않는다 — 칩 · 알림 · 카드는 주 창 한 곳이다.
  if (!started) return;
  // 명령의 답이 그보다 뒤에 만든 이벤트를 뒤따라온 옛 사본은 버린다.
  if (!isNewerView(view, next)) return;
  const before = view;
  view = next;
  if (shouldToast(next) && !toastedHere.has(shownVersion(next)!)) {
    const version = shownVersion(next)!;
    toastedHere.add(version);
    view = { ...next, toasted: version };
    void invoke<UpdateView>("update_mark_toasted", { version }).catch(() => {});
    const title = t("app.update.toast.available.title", { version });
    const sub = t("app.update.toast.available.sub", { current: next.current });
    toast.info(`${title} · ${sub}`, {
      ms: 15000,
      tag: "update-available",
      notice: { icon: "download", tone: "accent", title, sub },
      actions: [
        { label: t("app.update.toast.whatsNew"), run: () => openUpdateCard(), id: "update-whats-new", primary: true },
        { label: t("app.update.toast.later"), run: () => {}, id: "update-later" },
      ],
    });
  }
  // 옛 사본을 버리므로 `downloading` 을 못 본 채 `ready` 가 올 수 있다 — 쥔 것이 `ready` 가 아니면 새로 받은 것이다.
  if (next.phase === "ready" && before !== null && before.phase !== "ready" && !cardOpen) {
    const version = next.available?.version ?? "";
    if (readyNoticed !== version) {
      readyNoticed = version;
      void noticeReady(version);
    }
  }
}

async function noticeReady(version: string): Promise<void> {
  const n = await liveSessions();
  const text =
    n !== null && n > 0
      ? t("app.update.toast.ready", { version, n })
      : t("app.update.toast.ready.none", { version });
  toast.info(text, {
    ms: 20000,
    tag: "update-ready",
    notice: { icon: "check", tone: "ok", title: text, row: true },
    actions: [
      { label: t("app.update.toast.later"), run: () => {}, id: "update-ready-later" },
      { label: t("app.update.toast.restart"), run: () => void restartToUpdate(), id: "update-restart", primary: true },
    ],
  });
}

export async function liveSessions(): Promise<number | null> {
  try {
    const s = await invoke<{ connected: boolean; sessions: number | null }>("session_server_status");
    return s.connected ? s.sessions : null;
  } catch {
    return null;
  }
}

export async function checkForUpdates(auto = false): Promise<void> {
  try {
    accept(await invoke<UpdateView>("update_check", { auto }));
  } catch (e) {
    if (!auto) toast.error(String(e));
  }
}

export async function downloadUpdate(): Promise<void> {
  try {
    accept(await invoke<UpdateView>("update_download"));
  } catch (e) {
    toast.error(String(e));
  }
}

/** `null` = 건너뛰기 되돌리기 */
export async function skipUpdate(version: string | null): Promise<void> {
  try {
    accept(await invoke<UpdateView>("update_skip", { version }));
  } catch (e) {
    toast.error(String(e));
  }
}

export async function refreshUpdateView(): Promise<UpdateView | null> {
  try {
    const next = await invoke<UpdateView>("update_state");
    accept(next);
    return next;
  } catch {
    return null;
  }
}

/** 돌아오면 취소됐거나 실패한 것이다 */
export async function restartToUpdate(): Promise<void> {
  if (!leave || restarting) return;
  restarting = true;
  try {
    const r = await leave();
    if (!r.ok && r.error) toast.error(t("app.update.restart.failed", { error: r.error }));
  } finally {
    restarting = false;
  }
}

/** 주 창에서만 부른다 */
export function startUpdater(opts: { leave: LeaveForUpdate }): void {
  if (started) return;
  started = true;
  leave = opts.leave;
  void listen<UpdateView>(UPDATE_EVENT, (e) => accept(e.payload)).catch(() => {});
  void invoke<UpdateView>("update_state")
    .then(accept)
    .catch(() => {});
  const auto = () => {
    if (settings.autoCheckUpdates) void checkForUpdates(true);
  };
  setTimeout(auto, FIRST_CHECK_DELAY_MS);
  setInterval(auto, AUTO_CHECK_MS);
}
