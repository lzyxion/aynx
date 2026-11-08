/**
 * **프라이버시 잠금(가림막) — 화면 전체를 흐리게 덮는 층의 열림 여부.**
 *
 * `console.svelte.ts` 와 **같은 규칙의 상태 모듈**이다 — 창마다 하나 · 여기 사는 것은 열림
 * 불리언 하나뿐. 카드 안의 관문(암호 칸·오류 줄)은 `Veil.svelte` 가 자기 안에 들고 있다:
 * 가림막은 `{#if}` 로 붙었다 떨어지므로 **컴포넌트가 곧 그 관문의 수명**이고, 그러면 닫힐 때
 * 칸을 비우는 일을 따로 적을 자리가 없다.
 *
 * 임포트는 포커스 복귀(`app/focus-return`) · 볼트(`$lib/vault`) · 이벤트(`ipc` · 창 라벨)다. 셋 다 이
 * 모듈을 모르므로 순환이 서지 않는다 (`npm run check:cycles`). 가림막도 다른 모달과 같은
 * 증상이 있었다: 카드가 스크린리더를 위해 포커스를 가져가고(`Veil.svelte`), 걷히면 그 카드가
 * 사라지며 키보드가 `<body>` 에 떨어진다 — 흐림을 풀어 준 그 키 다음부터 셸에 글자가 들어가지
 * 않았다.
 *
 * ## 가림막이 걸리면 **볼트도 잠근다** (2026-09-19 저녁, 사용자 결정)
 *
 * 규칙 하나다: **자리를 비우면 둘 다.** 무입력 자동 가림(`[lock] idle`)이든 손으로 누른
 * `Ctrl+Shift+B` 든 같고, 볼트에 마스터 암호가 있든 없든 같다. 볼트가 자기 유휴 시계를
 * 들고 있던 옛 판(`[vault] auto_lock_minutes`)은 사라졌다 — 같은 사건(자리 비움)을 두 시계가
 * 따로 세면, 사용자가 칸 **둘**을 맞춰 놓아야 원하는 한 가지를 얻는다
 * (docs/log/2026-09-19-vault.md 의 "가림막과 함께 잠긴다").
 *
 * 잠그기는 **기다리지 않는다**(fire-and-forget): 가림막은 지금 당장 떠야 하는 층이고, 잠금은
 * 메모리 한 칸을 버리는 일이라 실패할 거리가 없다(실패해도 다음 접근이 여전히 물어본다).
 *
 * ## 가림막이 **곧 관문**이다 (2026-09-19 밤, 앞 줄을 다시 다듬은 결정)
 *
 * 걷는 것이 곧 **볼트를 여는 것**이다. 마스터가 걸려 있으면 가림막 위에서 그 암호를 치고,
 * 없으면 빈 Enter 하나다 — 그래서 **아무 키·클릭에 풀리던 길은 사라졌다**. [`closeVeil`] 을
 * 부르는 자리도 하나뿐이다: `Veil.svelte` 의 관문이 `vault_unlock` 에 성공한 순간
 * (docs/log/2026-09-19-vault.md 의 "가림막이 곧 관문").
 *
 * 그래서 [`raiseVeil`] 은 **켜기만 한다**. 옛 이름은 `toggleVeil` 이었고 같은 키
 * (`Ctrl+Shift+B`)가 열고 닫았는데, 그 키로 닫히면 관문이 뜻을 잃는다. 이름을 바꾼 것은
 * "toggle 인데 toggle 하지 않는다" 가 다음 사람에게 거짓말이기 때문이다 — **액션 id
 * (`toggle-veil`)는 그대로다**(`settings.toml` 키다 · docs/conventions.md).
 *
 * ## 가림막은 **앱 전체에 하나처럼** 선다 (2026-10-28 사용자 결정 — docs/log/2026-10-28-lock-screens.md)
 *
 * 상태는 여전히 창마다 하나지만 집 PC 창들은 서로 맞춘다 — 사람은 하나고, 자리를 비운 것도 그 사람이다:
 * - 어느 창에서 가림막이 서면([`openVeil`]) [`VEIL_RAISED_EVENT`] 로 다른 창도 선다(볼트는 이미 잠겼으니 다시 잠그지 않는다).
 * - 한 창에서 관문을 지나면([`closeVeil`]) [`VEIL_LIFTED_EVENT`] 로 다른 창도 걷힌다 — 받는 창은 볼트가 **실제로 열렸는지**
 *   (`locked` 가 아닌지) 다시 물은 뒤에만 걷는다(이벤트 하나로 걷히지 않게). 09-19 의 "이미 열려 있어도 창마다 관문은 선다" 를 바꿨다.
 * - 원격 웹 창은 끼지 않는다 — 제 관문(원격 가림막)이 따로 있고, 두 이벤트는 원격 창이 낼 수 없다(`remote/deny.rs` 의 `REMOTE_EMIT_DENIED`).
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { emit, isRemote, listen, type UnlistenFn } from "$lib/ipc";
import * as vault from "$lib/vault";

/** 가림막이 섰다 — 다른 집 PC 창도 세운다 (짐 = 보낸 창 라벨) */
export const VEIL_RAISED_EVENT = "veil-raised";
/** 관문을 지났다 — 다른 집 PC 창도 볼트가 열렸는지 확인하고 걷는다 (짐 = 보낸 창 라벨) */
export const VEIL_LIFTED_EVENT = "veil-lifted";

let windowLabel: string | null = null;
/** 이 창의 라벨 — 제가 낸 이벤트를 제가 다시 받지 않게(게으르게 한 번 · Tauri 없는 자리에서는 빈 값) */
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
 * 다른 집 PC 창에 알린다 — 원격 창은 내지 않는다(문이 거절한다) · 실패는 삼킨다(이 창의 가림막은 이미 섰다/걷혔다).
 * 이벤트 이름은 내보내는 호출의 첫 인자에 상수로 바로 적는다 — 원격 이벤트 분류 시험(`remote/deny.rs` 의 `frontend_emits_are_classified`)이 그 글자를 읽는다.
 */
function broadcastRaised(): void {
  if (!isRemote) void emit(VEIL_RAISED_EVENT, { window: selfLabel() }).catch(() => {});
}

function broadcastLifted(): void {
  if (!isRemote) void emit(VEIL_LIFTED_EVENT, { window: selfLabel() }).catch(() => {});
}

/** 포커스 복귀 이름표 (`app/focus-return`) */
const FOCUS_VEIL = "veil";

let open = $state(false);

/** 지금 가림막이 떠 있는가 */
export function veilVisible(): boolean {
  return open;
}

/**
 * 연다 — **무입력 자동 가림과 `Ctrl+Shift+B` 가 함께 지나는 한 문**이고, 그래서 볼트를
 * 잠그는 자리도 여기 하나다 (머리말).
 *
 * 이미 떠 있으면 아무 일도 하지 않는다 — 인터벌이 매 틱 다시 부르더라도(`app/idle-lock`)
 * 잠금 명령이 거듭 나가지 않는다.
 */
export function openVeil(): void {
  if (open) return;
  rememberFocusOrigin(FOCUS_VEIL);
  open = true;
  // 기다리지 않는다. 실패해도 볼트는 그저 열린 채이고, 다음 접근이 여전히 사람에게 묻는다.
  void vault.lock().catch(() => {});
  broadcastRaised();
}

/**
 * **볼트를 잠그지 않고** 연다 — 볼트가 이미 다른 까닭으로 잠겨 있을 때(③-3b1 · 금고는 세션 서버에 산다).
 *
 * - `relock`: 보는 창이 하나도 없어 세션 서버가 볼트를 **창 0개 잠금**으로 잠갔다(마지막 창 파괴·GUI 종료/kill). 그 잠금은
 *   HTTP MCP 티켓을 *정지*할 뿐이라, 여기서 `vault.lock()`(가림막 잠금 = *폐기*)을 보내면 살아남은 AI CLI 의 외부 MCP 가
 *   해제 뒤에도 돌아오지 않는다. 그래서 잠그지 않고 관문만 세운다 — 걷는 것(`vault_unlock`)이 곧 티켓을 되살린다.
 *
 * 이미 떠 있으면 아무 일도 하지 않는다.
 */
export function raiseVeilForRelock(): void {
  if (open) return;
  rememberFocusOrigin(FOCUS_VEIL);
  open = true;
}

/**
 * 볼트를 다시 본다 — 부팅 첫머리와 세션 서버에 **다시 붙은** 뒤(`session-server-connected`)에 부른다.
 *
 * - `relock` 이면 [`raiseVeilForRelock`] (잠그지 않고 관문만).
 * - 서버가 **바뀌었으면**(크래시·재시작 — 볼트는 그 메모리와 함께 사라졌다) 볼트가 있는 한 [`openVeil`] — 새 서버에는
 *   폐기할 티켓도 없다. 없는 볼트(`absent`)는 가림막을 세우지 않는다(옵트인 — 볼트 없는 사람의 화면은 예전 그대로).
 * - `windowBoot`(집 PC 창의 부팅 첫머리 — 메인 · 보조 창, 원격 창 아님)이고 **마스터가 걸린 볼트가 잠겨 있으면** 가림막(2026-10-28 사용자 결정 — 마스터를 걸었으면
 *   앱을 다시 켤 때 무조건 화면을 가린다). 세션 서버가 새로 뜬 날(재부팅 · 10분 자진 종료 · [모든 세션 종료] 뒤)에도 첫 화면이
 *   잠금 해제 모달이 아니라 가림막 관문이고, 건너뛰는 길은 없다 — 마스터를 잊었으면 `vault.bin` 을 손으로 지운다(앱 안에 길을
 *   두지 않는다 — 지나가는 사람이 지울 수 있게 되므로). 이미 잠긴 금고라 다시 잠그지 않는다([`raiseVeilForRelock`]).
 *   마스터 없는 볼트는 예전 그대로(접속 때 Enter 하나의 잠금 해제 모달). 보조 창도 대상이다 — 잠긴 때만 서므로 새 창마다
 *   가리지 않는다(가림막이 선 동안 다른 창에서 끌어낸 창 · F5 로 다시 뜬 창이 맨 화면을 보이지 않게). 마스터가 걸린 볼트가
 *   잠긴 채 가림막 없는 창은 이제 없다 — 잠금 해제 모달은 마스터 없는 볼트에만 남는다.
 */
export async function recheckVaultVeil(replaced = false, windowBoot = false): Promise<void> {
  const status = await vault.status(true);
  if (status.relock) raiseVeilForRelock();
  else if (replaced && status.state !== "absent") openVeil();
  else if (windowBoot && status.state === "locked" && status.hasMaster) raiseVeilForRelock();
}

/**
 * 걷는다 — **관문을 지난 뒤에만** 불린다 (`Veil.svelte` 의 `vault_unlock` 성공 자리).
 *
 * 아무 키·클릭이 부르던 옛 길은 없다: 그 길이 남아 있으면 "잠김" 이라고 적어 둔 카드가
 * 스페이스바 하나에 걷히고, 화면이 거짓말을 한다.
 */
export function closeVeil(): void {
  open = false;
  returnFocus(FOCUS_VEIL);
  broadcastLifted();
}

/**
 * 다른 창의 가림막을 따라간다 — 집 PC 창의 부팅(`app/boot`)이 한 번 건다(머리말 "앱 전체에 하나처럼").
 * 섰다는 소식 → 잠그지 않고 세운다([`raiseVeilForRelock`]). 걷혔다는 소식 → 볼트가 `locked` 가 아니면 걷는다.
 */
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
        }
      })
      .catch(() => {});
  });
  return Promise.all([raised, lifted]).then(([a, b]) => () => {
    a();
    b();
  });
}

/**
 * `toggle-veil`(기본 `Ctrl+Shift+B`) · 팔레트 — **켜기만 한다**.
 *
 * 떠 있는 동안 같은 키를 눌러도 아무 일도 없다. 실은 가림막의 캡처 리스너가 그 키를 먼저
 * 삼키므로 여기까지 오지도 않지만(`Veil.svelte`), 팔레트·다른 길이 생겨도 같은 답이 되도록
 * 문 안쪽에도 적어 둔다.
 */
export function raiseVeil(): void {
  if (open) return;
  openVeil();
}
