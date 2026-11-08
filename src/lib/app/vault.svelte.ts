import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { ensureVaultUnlocked } from "$lib/app/prompts.svelte.js";
import { hasReason, stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import * as vault from "$lib/vault";

/**
 * **설정 › 보안 섹션이 보는 상태** (docs/log/2026-09-19-vault.md ③ · 2026-09-19 밤에
 * 일반에서 떨어져 나와 자기 섹션을 받았다 — `CredentialsSection`).
 *
 * 단계 ②까지 금고는 접속 흐름 안에만 있었다 — 모달의 체크 하나로 담고, 잠겼으면 관문이
 * 열게 했다. 그러니 **담은 것을 보거나 지울 길이 없었고**, 마스터 암호를 거는 길도 없었다
 * (모달의 곁말이 "설정 › 보안에서 둘 수 있습니다" 라고 가리키는 자리가 비어 있었다).
 * 이 모듈이 그 자리다.
 *
 * ## 여기 있는 손잡이는 **[저장]을 기다리지 않는다**
 *
 * 설정 화면의 다른 값들은 미리보기 계약을 탄다(고르면 화면에 걸리고, 파일에는 [저장]이
 * 쓴다). 금고는 다르다 — 마스터 걸기·항목 지우기는 **그 자리에서 디스크를 바꾸는
 * 동작**이라 되돌릴 [취소] 가 없다("복원 정보 지우기" 와 같은 부류다). 섹션의 머리말이 그
 * 사실을 먼저 말한다.
 *
 * 값이던 한 칸(**자동 잠금 분**)은 2026-09-19 저녁에 사라졌다 — 볼트는 이제 프라이버시
 * 가림막과 **같은 시점에** 잠기고(`app/veil`), 그 시점을 정하는 칸은 프라이버시 줄 하나다
 * (docs/log/2026-09-19-vault.md 의 "가림막과 함께 잠긴다").
 *
 * ## 값은 여전히 한 방향이다
 *
 * 이 모듈이 부르는 것은 `list`·`has_*`·`delete*`·`set_master` 뿐이고, 그중 무엇도 비밀을
 * 돌려주지 않는다 (`$lib/vault` 머리말 · docs/conventions.md). 마스터 암호는 [`vm`] 의 칸에
 * 잠깐 있다가 모달이 닫히는 **모든 길**에서 `""` 로 덮인다.
 */

// ---------------------------------------------------------------------------
// 화면이 읽는 상태
// ---------------------------------------------------------------------------

/**
 * 금고의 지금 모습과 담긴 것들.
 *
 * `status` 는 `$lib/vault` 의 기억(TTL)을 **일부러 건너뛰고** 새로 묻는다 — 이 화면은
 * 상태를 바꾸는 화면이라, 방금 누른 버튼의 결과가 몇 초 늦게 보이면 사람은 버튼이 안 먹은
 * 줄 안다.
 */
const view = $state<{
  status: vault.VaultStatus;
  items: vault.VaultItem[];
  /** 지금 명령이 돌고 있는가 — 버튼 전부를 함께 재운다(두 번 눌러 두 번 지우지 않게) */
  busy: boolean;
  /** 섹션 아래 빨간 줄 (모달 안의 줄과 다른 자리다) */
  error: string | null;
  /** [모두 삭제] 를 한 번 눌러 **확인을 기다리는 중**인가 */
  confirmAll: boolean;
}>({
  status: { state: "absent", hasMaster: false, entryCount: 0, relock: false },
  items: [],
  busy: false,
  error: null,
  confirmAll: false,
});

export function vaultStatus(): vault.VaultStatus {
  return view.status;
}

/** 담긴 항목들 (잠겼거나 없으면 빈 목록) */
export function vaultItems(): vault.VaultItem[] {
  return view.items;
}

export function vaultBusy(): boolean {
  return view.busy;
}

export function vaultError(): string | null {
  return view.error;
}

/** [모두 삭제] 가 확인을 기다리는 중인가 (라벨이 그 자리에서 "정말 지울까요?" 로 바뀐다) */
export function vaultConfirmAll(): boolean {
  return view.confirmAll;
}

/**
 * 상태와 목록을 다시 읽는다 — **모든 동작 뒤**에, 그리고 섹션이 보일 때마다.
 *
 * 목록 조회는 잠긴 금고에서 `[vault-locked]`, 없는 금고에서 `[vault-absent]` 로 거절당한다.
 * 둘 다 **오류가 아니라 정상**이라(옵트인이므로 "아직 안 만들었다" 가 보통이다) 조용히 빈
 * 목록으로 접는다 — 화면이 그 사실을 이미 상태 줄로 말하고 있다.
 */
export async function refreshVault(): Promise<void> {
  view.status = await vault.status(true);
  if (view.status.state !== "unlocked") {
    view.items = [];
    return;
  }
  try {
    view.items = await vault.list();
  } catch {
    view.items = [];
  }
}

/** 명령 하나를 돌리고 상태를 다시 읽는다 — 실패는 섹션의 한 줄로 (값은 실리지 않는다) */
async function run(action: () => Promise<void>): Promise<boolean> {
  if (view.busy) return false;
  view.busy = true;
  view.error = null;
  try {
    await action();
    return true;
  } catch (e) {
    view.error = stripReason(e instanceof Error ? e.message : String(e));
    return false;
  } finally {
    view.busy = false;
    await refreshVault();
  }
}

// ---------------------------------------------------------------------------
// 잠금 · 자동 잠금
// ---------------------------------------------------------------------------

// 설정의 [잠그기](`lockVault`)는 2026-10-21 에 걷었다 — 사용자 개념에서 잠금은 가림막 하나다(`app/veil` 이 `vault.lock()` 을 보낸다).

/**
 * 잠금 해제 — **접속 관문과 같은 모달**을 연다 (`app/prompts` 의 `ensureVaultUnlocked`). 설정 › 보안의 들어가기 관문이 부른다
 * (볼트가 잠긴 채 보안에 들어올 때 — 가림막이 걸리지 않았는데 잠긴 경우, 예: 창 0개 잠금 뒤 다시 붙은 창).
 *
 * 창을 하나 더 만들지 않는 이유는 그것이 같은 물음이기 때문이다: 사람이 여기서 보는 칸과
 * 접속 도중에 보는 칸이 다르면, 같은 마스터 암호를 두 화면이 따로 묻는 것처럼 읽힌다.
 * 잠겨 있지 않으면 그 함수가 아무 일도 하지 않으므로 여기서 상태를 다시 보지 않는다.
 *
 * 마스터가 없는 볼트에서도 **같은 모달**이다 — 칸 없이 [열기] 하나짜리 확인 관문으로 뜬다.
 */
export async function unlockVault(): Promise<void> {
  await ensureVaultUnlocked();
  await refreshVault();
}

// ---------------------------------------------------------------------------
// 항목 지우기
// ---------------------------------------------------------------------------

/** 한 줄의 [삭제] — 없던 것을 지우는 것도 성공이다(백엔드가 멱등이다) */
export async function deleteVaultItem(item: vault.VaultItem): Promise<void> {
  view.confirmAll = false;
  await run(() => vault.remove(item.kind, item.target));
}

/**
 * [모두 삭제] — **두 번 눌러야 지워진다.**
 *
 * 확인을 네이티브 대화상자가 아니라 **버튼 라벨이 바뀌는 것**으로 주는 이유는 같은 섹션의
 * "복원 정보 지우기" 와 같다: 돌이킬 수 없는 한 번의 동작이지만 창을 한 장 더 띄울 만큼
 * 무겁지는 않고, 무엇보다 확인 문구가 눌린 버튼 **그 자리**에 있어야 무엇을 지우는지가
 * 붙어 읽힌다.
 */
export async function deleteAllVaultItems(): Promise<void> {
  if (!view.confirmAll) {
    view.confirmAll = true;
    return;
  }
  view.confirmAll = false;
  await run(() => vault.removeAll());
}

/** 확인 대기를 물린다 (다른 곳을 누르거나 섹션을 떠날 때) */
export function cancelDeleteAll(): void {
  view.confirmAll = false;
}

// ---------------------------------------------------------------------------
// 마스터 암호 모달 (`vault-master`)
//
// 접속 대화 넷과 **같은 대기열 꼴**이다 (`app/prompts` 머리말): 큐가 비어 있다가 첫 항목이
// 들어오는 순간이 열림, 마지막 항목을 꺼낸 순간이 닫힘, 그리고 닫는 문은 하나뿐이다.
// 다른 점은 **여는 쪽**이다 — 저쪽은 백엔드가 거절하며 물어 오지만 이쪽은 사람이 설정에서
// 누른다. 그래서 `promptsBlocking()`(접속 대화 사슬)에는 들어가지 않고, 전역 키를 재우는
// `anyModalOpen()` 과 Escape 사슬에만 선다.
// ---------------------------------------------------------------------------

/**
 * 무엇을 하러 열린 모달인가.
 *
 * `"set"` 은 두 경우를 함께 받는다 — 금고가 아직 **없거나**(그러면 이 확인이 곧 만들기다),
 * 있지만 키 파일 원천이거나. 둘 다 사람에게는 "마스터 암호를 새로 건다" 한 가지 일이고,
 * 화면을 가르면 같은 폼이 두 벌 생긴다.
 *
 * `"verify"` 는 설정 › 보안의 **들어가기 관문**(2026-10-21)이다 — 열린 볼트의 마스터를 확인만 하고(`vault_verify_master` —
 * 상태를 바꾸지 않는다) 결과는 [`verifyMasterPrompt`] 의 약속으로 돌려준다. 칸은 현재 암호 하나다.
 */
export type MasterMode = "set" | "change" | "remove" | "verify";

interface PendingMaster {
  mode: MasterMode;
  /** `verify` 의 약속 — 맞으면 `true`, 어느 길로든 닫히면 `false`(한 번만 부른다) */
  done?: (ok: boolean) => void;
}

const FOCUS_VAULT_MASTER = "vault-master";

const mQueue = $state<PendingMaster[]>([]);

/** 모달이 직접 바인딩하는 칸들 (`vu`·`pw` 와 같은 꼴) */
export const vm = $state<{
  /** 지금 금고를 여는 마스터 (걸려 있을 때만 쓴다) */
  current: string;
  next: string;
  confirm: string;
  /** 칸 아래 빨간 줄 — 불일치 · `[vault-wrong-master]` · 그 밖의 실패 */
  error: string | null;
  busy: boolean;
  /**
   * **첫 칸**이 될 수 있는 둘 — 마스터가 걸려 있으면 "현재" 칸이, 아니면 "새 암호" 칸이
   * 맨 위다. 참조를 하나로 두면 둘 다 그려지는 경우에 나중 것이 앞 것을 덮어써 커서가
   * 가운데 칸으로 간다.
   */
  field: HTMLInputElement | null;
  newField: HTMLInputElement | null;
}>({
  current: "",
  next: "",
  confirm: "",
  error: null,
  busy: false,
  field: null,
  newField: null,
});

/** 지금 열려 있는 마스터 암호 모달의 뜻 (없으면 `null`) */
export function masterPrompt(): MasterMode | null {
  return mQueue[0]?.mode ?? null;
}

export function masterPromptVisible(): boolean {
  return mQueue.length > 0;
}

/** 지금 금고에 마스터가 걸려 있는가 = **현재 암호 칸을 세우는가** */
export function masterNeedsCurrent(): boolean {
  return view.status.hasMaster;
}

/** [설정…] · [변경…] · [해제…] — 셋이 한 모달을 연다 */
export function openMasterPrompt(mode: MasterMode, done?: (ok: boolean) => void): void {
  if (mQueue.length === 0) rememberFocusOrigin(FOCUS_VAULT_MASTER);
  vm.current = "";
  vm.next = "";
  vm.confirm = "";
  vm.error = null;
  vm.busy = false;
  mQueue.push({ mode, done });
}

/**
 * 설정 › 보안 들어가기 관문 — 같은 모달을 **확인** 뜻으로 열고, 마스터가 맞으면 `true` 로 풀린다(취소 · Escape 는 `false`).
 * 볼트 상태는 바뀌지 않는다. 마스터가 없거나 볼트가 없다는 답이면 지킬 것이 없으니 `true` 다(그 사이 풀린 경우).
 */
export function verifyMasterPrompt(): Promise<boolean> {
  return new Promise((resolve) => openMasterPrompt("verify", resolve));
}

/**
 * 닫는 **유일한 문** — [취소]·Escape·성공이 전부 여기를 지난다.
 * 어느 길로 닫히든 세 칸을 `""` 로 덮는다 (암호가 지워지는 유일한 자리).
 */
export function closeMasterPrompt(): void {
  if (vm.busy) return;
  mQueue.shift()?.done?.(false);
  vm.current = "";
  vm.next = "";
  vm.confirm = "";
  vm.error = null;
  if (mQueue.length === 0) returnFocus(FOCUS_VAULT_MASTER);
}

/**
 * [확인] — 셋 중 하나를 한다.
 *
 * | 뜻 | 부르는 것 |
 * | --- | --- |
 * | `set` · 금고가 아직 없다 | `vault_create(master)` |
 * | `set` · 키 파일 금고에 건다 | `vault_set_master(new, null)` |
 * | `change` | `vault_set_master(new, current)` |
 * | `remove` | `vault_set_master(null, current)` |
 *
 * **틀린 현재 암호는 모달을 닫지 않는다** — 잠금 해제 모달과 같은 규칙으로 그 칸에 줄만
 * 세운다 (백엔드도 그때 디스크를 한 글자도 안 바꾼다: `vault.rs` 의 순서 셋).
 * 새 암호와 확인이 다르면 **부르지도 않는다** — 그건 서버에 물어볼 일이 아니다.
 */
export async function submitMasterPrompt(): Promise<void> {
  const mode = masterPrompt();
  if (mode === null || vm.busy) return;
  if (mode === "verify") return submitVerify();

  if (mode !== "remove") {
    if (vm.next === "") {
      vm.error = t("app.vault.master.empty");
      return;
    }
    // 불일치에서는 **포커스를 옮기지 않는다** — 사람은 방금 확인 칸을 치고 있었고, 고칠
    // 곳도 거기다. 커서를 첫 칸으로 되돌리면 잘 친 값을 다시 치게 된다.
    if (vm.next !== vm.confirm) {
      vm.error = t("app.vault.master.mismatch");
      return;
    }
  }

  const absent = view.status.state === "absent";
  const current = view.status.hasMaster ? vm.current : null;

  vm.busy = true;
  vm.error = null;
  try {
    if (mode === "remove") await vault.setMaster(null, current);
    else if (absent) await vault.create(vm.next);
    else await vault.setMaster(vm.next, current);
    vm.busy = false;
    closeMasterPrompt();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // "틀린 암호" 와 "손상된 파일" 을 구분해 말하지 않는다 (`vault.rs`·잠금 해제 모달과 같은 줄).
    vm.error = hasReason(message, "vault-wrong-master")
      ? t("app.vault.master.wrong")
      : stripReason(message);
    vm.busy = false;
    vm.current = "";
    vm.field?.focus();
  }
  await refreshVault();
}

/** `verify` 의 [확인] — 맞으면 약속을 `true` 로 풀고 닫는다. 틀림 · 막힘은 칸 밑 한 줄(모달은 그대로) */
async function submitVerify(): Promise<void> {
  if (vm.current === "") {
    vm.error = t("app.vault.master.empty");
    return;
  }
  vm.busy = true;
  vm.error = null;
  let pass = false;
  try {
    const r = await vault.verifyMaster(vm.current);
    if (r.result === "ok" || r.result === "no-master" || r.result === "no-vault") pass = true;
    else if (r.result === "limited") {
      vm.error = t("app.vault.master.verify.limited", { s: Math.ceil((r.retryAfterMs ?? 60_000) / 1000) });
    } else vm.error = t("app.vault.master.verify.wrong");
  } catch (e) {
    vm.error = stripReason(e instanceof Error ? e.message : String(e));
  }
  vm.busy = false;
  if (pass) {
    // 약속을 먼저 풀고(닫기가 `false` 로 덮지 않게) 닫는다
    const head = mQueue[0];
    head?.done?.(true);
    if (head) head.done = undefined;
    closeMasterPrompt();
    return;
  }
  vm.current = "";
  vm.field?.focus();
}
