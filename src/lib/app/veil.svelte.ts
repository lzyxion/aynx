/**
 * 프라이버시 잠금(가림막)의 열림 여부 — 창마다 하나. 관문(암호 칸)의 수명은 `Veil.svelte` 컴포넌트다.
 *
 * 불변식(→ docs/invariants.md 전문 2):
 * - 가림막이 걸리면 볼트도 잠긴다 — 자동 가림이든 `Ctrl+Shift+B` 든, 마스터가 있든 없든 같다. 볼트에 따로 유휴 시계를 두지 않는다.
 * - 가림막을 걷는 것이 곧 볼트를 여는 것이다 — [`closeVeil`] 은 `Veil.svelte` 관문의 `vault_unlock` 성공 뒤에만 불린다. 아무 키 · 클릭에 풀리는 길은 없다.
 * - 메인 PC 창들은 서로 맞춘다 — 걷혔다는 소식을 받은 창은 볼트가 실제로 열렸는지 다시 물은 뒤에만 걷는다.
 *   원격 웹 창은 끼지 않는다(두 이벤트는 `remote/deny.rs` 의 `REMOTE_EMIT_DENIED`).
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { settleVaultUnlockIfOpen } from "$lib/app/prompts.svelte.js";
import { emit, isRemote, listen, type UnlistenFn } from "$lib/ipc";
import * as vault from "$lib/vault";

export const VEIL_RAISED_EVENT = "veil-raised";
export const VEIL_LIFTED_EVENT = "veil-lifted";

let windowLabel: string | null = null;
/** 제가 낸 이벤트를 제가 다시 받지 않게 */
function selfLabel(): string {
  if (windowLabel !== null) return windowLabel;
  try {
    windowLabel = getCurrentWindow().label;
  } catch {
    windowLabel = "";
  }
  return windowLabel;
}

/*
 * 이벤트 이름은 내보내는 호출의 첫 인자에 상수로 바로 적는다 — 시험 `remote/deny.rs` 의 `frontend_emits_are_classified` 가 그 글자를 읽는다.
 */
function broadcastRaised(): void {
  if (!isRemote) void emit(VEIL_RAISED_EVENT, { window: selfLabel() }).catch(() => {});
}

function broadcastLifted(): void {
  if (!isRemote) void emit(VEIL_LIFTED_EVENT, { window: selfLabel() }).catch(() => {});
}

const FOCUS_VEIL = "veil";

let open = $state(false);

export function veilVisible(): boolean {
  return open;
}

/** 볼트를 잠그는 자리는 여기 하나다. 이미 떠 있으면 아무 일도 없다 — 인터벌이 매 틱 불러도 잠금이 거듭 나가지 않는다. */
export function openVeil(): void {
  if (open) return;
  rememberFocusOrigin(FOCUS_VEIL);
  open = true;
  // 기다리지 않는다 — 실패해도 다음 접근이 여전히 사람에게 묻는다.
  void vault.lock().catch(() => {});
  broadcastRaised();
}

/**
 * 볼트를 잠그지 않고 연다. 창 0개 잠금(`relock`)은 HTTP MCP 티켓을 정지할 뿐이라, 여기서 `vault.lock()`(폐기)을 보내면
 * 살아남은 AI CLI 의 외부 MCP 가 해제 뒤에도 돌아오지 않는다.
 */
export function raiseVeilForRelock(): void {
  if (open) return;
  rememberFocusOrigin(FOCUS_VEIL);
  open = true;
}

/**
 * 부팅 첫머리와 세션 서버에 다시 붙은 뒤에 부른다. 없는 볼트(`absent`)는 가림막을 세우지 않는다(옵트인).
 * 마스터가 걸린 볼트가 잠겨 있으면 창이 뜰 때 가림막이 선다(사용자 결정) — 건너뛰는 길은 없고 마스터를 잊었으면 `vault.bin` 을
 * 손으로 지운다(앱 안에 길을 두지 않는다 — 지나가는 사람이 지울 수 있게 되므로).
 */
export async function recheckVaultVeil(replaced = false, windowBoot = false): Promise<void> {
  const status = await vault.status(true);
  if (status.relock) raiseVeilForRelock();
  else if (replaced && status.state !== "absent") openVeil();
  else if (windowBoot && status.state === "locked" && status.hasMaster) raiseVeilForRelock();
}

/** 관문을 지난 뒤에만 불린다 — 다른 길이 남으면 "잠김" 카드가 스페이스바 하나에 걷힌다. */
export function closeVeil(): void {
  open = false;
  returnFocus(FOCUS_VEIL);
  broadcastLifted();
  void settleVaultUnlockIfOpen();
}

export function listenVeilAcrossWindows(): Promise<UnlistenFn> {
  if (isRemote) return Promise.resolve(() => {});
  const fromOther = (payload: unknown): boolean =>
    (payload as { window?: string } | null)?.window !== selfLabel();
  const raised = listen(VEIL_RAISED_EVENT, (ev) => {
    if (fromOther(ev.payload)) raiseVeilForRelock();
  });
  const lifted = listen(VEIL_LIFTED_EVENT, (ev) => {
    if (!open || !fromOther(ev.payload)) return;
    void vault
      .status(true)
      .then((status) => {
        if (open && status.state !== "locked") {
          open = false;
          returnFocus(FOCUS_VEIL);
          void settleVaultUnlockIfOpen();
        }
      })
      .catch(() => {});
  });
  return Promise.all([raised, lifted]).then(([a, b]) => () => {
    a();
    b();
  });
}

/** 켜기만 한다 — 같은 키로 닫히면 관문이 뜻을 잃는다. 액션 id `toggle-veil` 은 `settings.toml` 키라 그대로다. */
export function raiseVeil(): void {
  if (open) return;
  openVeil();
}
