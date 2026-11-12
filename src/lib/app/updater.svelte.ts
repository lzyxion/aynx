/**
 * **앱 안 업데이트의 화면 상태**(2026-11-12 — 사용자 결정 "알리기만 한다. 내려받기 · 설치는 사람이 고를 때만").
 *
 * - 상태의 주인은 Rust(`src-tauri/src/updater.rs`)다. 여기는 그 사본(`update-state` 이벤트 · `update_state`)을 들고, 무엇을 보일지는
 *   순수 모듈(`$lib/updater`)이 정한다.
 * - **주 창(집 PC)에서만** 선다(`startUpdater` — `app/boot`). 원격 창은 명령이 모두 거절되고(`remote/deny.rs` HOME_ONLY), 보조 창은
 *   칩을 그리지 않는다(사본이 비어 있다).
 * - 자동 확인 — 설정 `[updates] auto_check`(기본 켬)이면 부팅 한 박자 뒤와 6시간마다 `update_check(auto)`. 개발 빌드는 Rust 가
 *   그 요청을 그대로 돌려준다(손 [지금 확인]만 된다).
 * - 알림 — 새 판마다 토스트 **한 번**(`updater.json` 의 `toasted`) · 받기가 끝났을 때 카드가 닫혀 있으면 토스트 한 번.
 * - [다시 시작] — `app/boot` 이 넘긴 `leave`(창마다 저장 안 한 문서를 묻고 세션을 놓은 뒤 `update_install`)를 부른다. 이 모듈이
 *   `app/boot` 을 직접 부르지 않는 것은 순환을 피하려는 것이다(`npm run check:cycles`).
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

/** 포커스 복귀 이름표 (`app/focus-return`) */
const FOCUS_CARD = "update-card";

/** 창을 떠나 설치하는 길 — `app/boot` 의 `quitForUpdate` */
export type LeaveForUpdate = () => Promise<{ ok: boolean; error: string | null }>;

let view = $state<UpdateView | null>(null);
let cardOpen = $state(false);
let restarting = $state(false);
let started = false;
let leave: LeaveForUpdate | null = null;
/** 이 세션에서 받기 끝을 이미 알렸나(판 글자) — 같은 받기를 두 번 알리지 않게 */
let readyNoticed: string | null = null;
/** 이 세션에서 알린 판 — `toasted` 를 적기 전에 뜬 사본이 뒤따라와도 두 번 띄우지 않게 */
const toastedHere = new Set<string>();

/** 지금 사본(주 창 밖에서는 `null`) */
export function updateView(): UpdateView | null {
  return view;
}

/** 업데이트 카드가 떠 있나 — 떠 있는 동안 전역 키가 쉰다(`app/keys` 의 `anyModalOpen`) */
export function updateCardOpen(): boolean {
  return cardOpen;
}

/** [다시 시작]을 누른 뒤 창들이 세션을 놓는 중인가 */
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
  // 주 창 밖(보조 창의 설정 줄)은 사본을 들지 않는다 — 칩 · 알림 · 카드는 주 창 한 곳이다(그 줄은 제 값을 따로 받는다)
  if (!started) return;
  // 늦게 닿은 옛 사본(명령의 답이 그보다 뒤에 만든 이벤트를 뒤따라온 것)은 버린다 — 새 상태를 덮지 않게
  if (!isNewerView(view, next)) return;
  const before = view;
  view = next;
  // 새 판 — 판마다 한 번 알린다(적는 것은 Rust · 실패해도 이 세션에서는 다시 띄우지 않게 사본을 먼저 바꾼다)
  if (shouldToast(next) && !toastedHere.has(shownVersion(next)!)) {
    const version = shownVersion(next)!;
    toastedHere.add(version);
    view = { ...next, toasted: version };
    void invoke<UpdateView>("update_mark_toasted", { version }).catch(() => {});
    const title = t("app.update.toast.available.title", { version });
    const sub = t("app.update.toast.available.sub", { current: next.current });
    // 알림 카드(목업 — 아이콘 · 굵은 제목 · 흐린 줄 · [바뀐 점 보기] 채움 · [나중에] 테) — 자리 · 시계 · 닫기는 다른 토스트와 같다
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
  // 받기 끝 — 카드가 열려 있으면 카드가 그 자리에서 묻는다. 닫혀 있으면 토스트 한 번
  // (옛 사본을 버리므로 `downloading` 사본을 못 본 채 `ready` 가 올 수 있다 — 쥔 것이 `ready` 가 아니면 새로 받은 것이다)
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
  // 한 줄 알림 카드(목업 ③ — ✓ 초록 · 글 · [나중에] 테 · [지금 다시 시작] 채움)
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

/** 세션 서버가 센 살아 있는 세션 수(못 읽으면 `null`) */
export async function liveSessions(): Promise<number | null> {
  try {
    const s = await invoke<{ connected: boolean; sessions: number | null }>("session_server_status");
    return s.connected ? s.sessions : null;
  } catch {
    return null;
  }
}

/** 손 [지금 확인] · 자동 확인 */
export async function checkForUpdates(auto = false): Promise<void> {
  try {
    accept(await invoke<UpdateView>("update_check", { auto }));
  } catch (e) {
    if (!auto) toast.error(String(e));
  }
}

/** [업데이트] · [다시 시도] — 받기를 시작한다(진행은 이벤트로 온다) */
export async function downloadUpdate(): Promise<void> {
  try {
    accept(await invoke<UpdateView>("update_download"));
  } catch (e) {
    toast.error(String(e));
  }
}

/** [이 판 건너뛰기] · 설정의 [건너뛰기 되돌리기](`null`) */
export async function skipUpdate(version: string | null): Promise<void> {
  try {
    accept(await invoke<UpdateView>("update_skip", { version }));
  } catch (e) {
    toast.error(String(e));
  }
}

/** 설정 줄이 열릴 때 — 사본을 한 번 새로 받는다(보조 창의 설정도 같은 줄을 그린다) */
export async function refreshUpdateView(): Promise<UpdateView | null> {
  try {
    const next = await invoke<UpdateView>("update_state");
    accept(next);
    return next;
  } catch {
    return null;
  }
}

/** **[다시 시작]** — 창마다 저장 안 한 문서를 묻고 세션을 놓은 뒤 설치한다. 돌아오면 취소됐거나 실패한 것이다 */
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

/** 부팅 — 주 창 한 번. 이벤트를 받고 · 사본을 채우고 · 자동 확인을 건다 */
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
