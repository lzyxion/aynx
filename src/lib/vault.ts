import { invoke } from "./ipc";

/**
 * 자격증명 금고의 프런트 창구 (docs/log/2026-09-19-vault.md).
 * 비밀을 돌려받는 함수는 없다 — 넣기만 한다. 값을 돌려주는 함수를 여기 새로 내지 않는다
 * (docs/conventions.md 의 "볼트 값은 프런트로 돌려주지 않는다").
 * 상태는 몇 초 기억하고, 상태를 바꾸는 자리는 곧바로 `invalidateStatus` 로 지운다.
 */

/** Rust `VaultItem` 과 1:1 — 값이 실릴 자리가 없다 */
export interface VaultItem {
  kind: "host_password" | "key_passphrase" | "mcp_env" | "db_password";
  /** 호스트 별칭 · 개인키 전체 경로 · MCP 참조 · DB 연결 `id` */
  target: string;
}

/** Rust `VaultStatus` 와 1:1 */
export interface VaultStatus {
  state: "absent" | "locked" | "unlocked";
  /** 거짓이면 빈 값(Enter)으로 여는 확인 관문이다(보호가 아니다) — 가림막이 걸리면 어느 쪽이든 잠기므로 여는 문은 하나다 */
  hasMaster: boolean;
  entryCount: number;
  /** `"windows_zero"` = 보는 창이 하나도 없었다(마지막 창 파괴 · GUI 종료/kill) */
  lockReason?: "shade" | "user" | "windows_zero";
  /**
   * 열려 있던 금고를 창 0개 잠금이 닫았다 — 붙는 창이 가림막을 세우되 볼트를 다시 잠그지 않는다:
   * 창 0개 잠금은 HTTP MCP 티켓을 정지하고, 가림막 잠금은 폐기한다.
   */
  relock: boolean;
}

/** 못 물어봤으면 "없다" 로 읽는다 — 옵트인이므로 그게 정상이다 */
const UNKNOWN: VaultStatus = {
  state: "absent",
  hasMaster: false,
  entryCount: 0,
  relock: false,
};

const STATUS_TTL_MS = 5000;

let cached: { at: number; value: VaultStatus } | null = null;

/** 볼트가 실제로 열렸을 때만 — `absent` · `locked` 에 카드를 닫으면 건너뛰는 길이 된다 */
export function canSettleUnlockCard(waiting: number, busy: boolean, state: VaultStatus["state"] | null): boolean {
  return waiting > 0 && !busy && state === "unlocked";
}

export function invalidateStatus(): void {
  cached = null;
}

/** 실패는 `UNKNOWN` 으로 접는다 — 이 물음이 화면을 막아서는 안 된다 */
export async function status(fresh = false): Promise<VaultStatus> {
  if (!fresh && cached && Date.now() - cached.at < STATUS_TTL_MS) return cached.value;
  try {
    const value = await invoke<VaultStatus>("vault_status");
    cached = { at: Date.now(), value };
    return value;
  } catch {
    return UNKNOWN;
  }
}

/** `master === null` 이면 키 파일 금고 — 이 사용자의 설정 폴더를 읽을 수 있는 자는 열 수 있다(브라우저가 저장한 비밀번호와 같은 등급) */
export async function create(master: string | null): Promise<void> {
  await invoke("vault_create", { master });
  invalidateStatus();
}

/** 틀린 마스터는 `[vault-wrong-master]` 오류 · 마스터가 없는 볼트는 `null` 로 연다(확인 관문 — 보호가 아니다) */
export async function unlock(master: string | null): Promise<void> {
  await invoke("vault_unlock", { master });
  invalidateStatus();
}

/**
 * 마스터가 있든 없든 잠기고 스스로 다시 열리지 않는다 · HTTP MCP 티켓을 폐기한다.
 * 설정의 [잠그기]는 걷었지만 Rust 계약의 `"user"` 는 그대로 둔다.
 */
export async function lock(reason: "shade" | "user" = "shade"): Promise<void> {
  await invoke("vault_lock", { reason });
  invalidateStatus();
}

/** 부르는 쪽은 이 호출 뒤 값을 곧바로 버린다 */
export async function storePassword(alias: string, value: string): Promise<void> {
  await invoke("vault_store_password", { alias, value });
  invalidateStatus();
}

/** 대상은 개인키의 전체 경로다 */
export async function storePassphrase(path: string, value: string): Promise<void> {
  await invoke("vault_store_passphrase", { path, value });
  invalidateStatus();
}

/** 대상은 `db-connections.json` 연결의 고정 `id` 다(호스트 별칭이 아니다) — 8~32자 `[A-Za-z0-9_-]` 가 아니면 백엔드가 거절한다 */
export async function storeDbPassword(id: string, value: string): Promise<void> {
  await invoke("vault_store_db_password", { id, value });
  invalidateStatus();
}

/** `current` 가 틀리면 `[vault-wrong-master]` 가 오고 디스크는 한 글자도 안 바뀐다 */
export async function setMaster(next: string | null, current: string | null): Promise<void> {
  await invoke("vault_set_master", { new: next, current });
  invalidateStatus();
}

/** 판정 글자와 막힌 길이(ms)뿐, 값은 없다 */
export interface MasterCheck {
  result: "ok" | "bad" | "no-master" | "no-vault" | "limited";
  retryAfterMs?: number | null;
}

/** 확인만 한다 — 볼트 상태를 바꾸지 않고, 서버가 실패 빈도를 센다(`limited`) */
export async function verifyMaster(master: string): Promise<MasterCheck> {
  return await invoke<MasterCheck>("vault_verify_master", { master });
}

/** 종류와 대상뿐이고 값은 없다 — 잠겼거나 없으면 던진다 */
export async function list(): Promise<VaultItem[]> {
  return await invoke<VaultItem[]>("vault_list");
}

/** 없던 것을 지우는 것도 성공이다(멱등) */
export async function remove(kind: VaultItem["kind"], target: string): Promise<void> {
  await invoke("vault_delete", { kind, target });
  invalidateStatus();
}

/** 금고 파일은 남고 비워진다 — 키 원천은 사용자가 정한 설정이다 */
export async function removeAll(): Promise<void> {
  await invoke("vault_delete_all");
  invalidateStatus();
}

/** 실패(금고 없음 · 잠김)는 거짓으로 접는다 */
export async function hasPassword(alias: string): Promise<boolean> {
  try {
    return await invoke<boolean>("vault_has_password", { alias });
  } catch {
    return false;
  }
}

export async function hasPassphrase(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>("vault_has_passphrase", { path });
  } catch {
    return false;
  }
}

export async function hasDbPassword(id: string): Promise<boolean> {
  try {
    return await invoke<boolean>("vault_has_db_password", { id });
  } catch {
    return false;
  }
}

/** MCP 환경변수 · 헤더 값은 보내기만 하고 새 참조를 받는다 — 기존 값은 돌려받지 않는다 */
export async function storeMcpEnv(label: string, value: string): Promise<string> {
  const reference = await invoke<string>("vault_store_mcp_env", { label, value });
  invalidateStatus();
  return reference;
}
