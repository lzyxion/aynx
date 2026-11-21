import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { ensureVaultUnlocked } from "$lib/app/prompts.svelte.js";
import { hasReason, stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import * as vault from "$lib/vault";

/**
 * 설정 › 보안 섹션이 보는 볼트 상태. 여기 손잡이는 [저장]을 기다리지 않고 그 자리에서 디스크를 바꾼다.
 * 부르는 op 중 무엇도 비밀을 돌려주지 않는다. 마스터 암호는 [`vm`] 에 잠깐 있다가 모달이 닫히는 모든 길에서 `""` 로 덮인다.
 */

// ── 화면이 읽는 상태 ──

/** `status` 는 `$lib/vault` 의 기억(TTL)을 일부러 건너뛴다 — 방금 누른 버튼의 결과가 늦게 보이면 안 먹은 줄 안다. */
const view = $state<{
  status: vault.VaultStatus;
  items: vault.VaultItem[];
  busy: boolean;
  error: string | null;
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

export function vaultItems(): vault.VaultItem[] {
  return view.items;
}

export function vaultBusy(): boolean {
  return view.busy;
}

export function vaultError(): string | null {
  return view.error;
}

export function vaultConfirmAll(): boolean {
  return view.confirmAll;
}

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

// ── 잠금 ──

// 설정에 [잠그기]는 두지 않는다 — 사용자 개념에서 잠금은 가림막 하나다(`app/veil` 이 `vault.lock()` 을 보낸다).

/** 접속 관문과 같은 모달을 연다 — 같은 마스터 암호를 두 화면이 따로 묻는 것처럼 읽히지 않게. */
export async function unlockVault(): Promise<void> {
  await ensureVaultUnlocked();
  await refreshVault();
}

// ── 항목 지우기 ──

export async function deleteVaultItem(item: vault.VaultItem): Promise<void> {
  view.confirmAll = false;
  await run(() => vault.remove(item.kind, item.target));
}

/** 두 번 눌러야 지워진다 — 확인은 버튼 라벨이 그 자리에서 바뀌는 것으로 준다. */
export async function deleteAllVaultItems(): Promise<void> {
  if (!view.confirmAll) {
    view.confirmAll = true;
    return;
  }
  view.confirmAll = false;
  await run(() => vault.removeAll());
}

export function cancelDeleteAll(): void {
  view.confirmAll = false;
}

// ── 마스터 암호 모달 ──
// 사람이 설정에서 연다 — `promptsBlocking()`(접속 대화 사슬)에는 들지 않고 `anyModalOpen()` 과 Escape 사슬에만 선다.

/** `"set"` 은 볼트가 없을 때(만들기)와 키 파일 볼트에 걸 때를 함께 받는다 · `"verify"` 는 상태를 바꾸지 않는 확인만. */
export type MasterMode = "set" | "change" | "remove" | "verify";

interface PendingMaster {
  mode: MasterMode;
  /** `verify` 의 약속 — 한 번만 부른다 */
  done?: (ok: boolean) => void;
}

const FOCUS_VAULT_MASTER = "vault-master";

const mQueue = $state<PendingMaster[]>([]);

export const vm = $state<{
  current: string;
  next: string;
  confirm: string;
  error: string | null;
  busy: boolean;
  /** 첫 칸이 될 수 있는 둘 — 참조를 하나로 두면 둘 다 그려질 때 나중 것이 덮어써 커서가 가운데 칸으로 간다. */
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

export function masterPrompt(): MasterMode | null {
  return mQueue[0]?.mode ?? null;
}

export function masterPromptVisible(): boolean {
  return mQueue.length > 0;
}

export function masterNeedsCurrent(): boolean {
  return view.status.hasMaster;
}

export function openMasterPrompt(mode: MasterMode, done?: (ok: boolean) => void): void {
  if (mQueue.length === 0) rememberFocusOrigin(FOCUS_VAULT_MASTER);
  vm.current = "";
  vm.next = "";
  vm.confirm = "";
  vm.error = null;
  vm.busy = false;
  mQueue.push({ mode, done });
}

/** 마스터가 없거나 볼트가 없다는 답이면 지킬 것이 없으니 `true` 다. */
export function verifyMasterPrompt(): Promise<boolean> {
  return new Promise((resolve) => openMasterPrompt("verify", resolve));
}

/** 닫는 유일한 문 — 어느 길로 닫히든 세 칸을 `""` 로 덮는다(암호가 지워지는 유일한 자리). */
export function closeMasterPrompt(): void {
  if (vm.busy) return;
  mQueue.shift()?.done?.(false);
  vm.current = "";
  vm.next = "";
  vm.confirm = "";
  vm.error = null;
  if (mQueue.length === 0) returnFocus(FOCUS_VAULT_MASTER);
}

/** 틀린 현재 암호는 모달을 닫지 않는다 — 그 칸에 줄만 세운다. */
export async function submitMasterPrompt(): Promise<void> {
  const mode = masterPrompt();
  if (mode === null || vm.busy) return;
  if (mode === "verify") return submitVerify();

  if (mode !== "remove") {
    if (vm.next === "") {
      vm.error = t("app.vault.master.empty");
      return;
    }
    // 불일치에서는 포커스를 옮기지 않는다 — 고칠 곳은 방금 치던 확인 칸이다.
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
    // "틀린 암호" 와 "손상된 파일" 을 구분해 말하지 않는다(`vault.rs` · 잠금 해제 모달과 같은 줄).
    vm.error = hasReason(message, "vault-wrong-master")
      ? t("app.vault.master.wrong")
      : stripReason(message);
    vm.busy = false;
    vm.current = "";
    vm.field?.focus();
  }
  await refreshVault();
}

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
    // 약속을 먼저 풀고 닫는다 — 닫기가 `false` 로 덮지 않게
    const head = mQueue[0];
    head?.done?.(true);
    if (head) head.done = undefined;
    closeMasterPrompt();
    return;
  }
  vm.current = "";
  vm.field?.focus();
}
