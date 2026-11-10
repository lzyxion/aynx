import { invoke } from "./ipc";

/**
 * **자격증명 금고의 프런트 창구** — Rust `vault.rs` 명령의 얇은 껍데기 한 벌
 * (docs/log/2026-09-19-vault.md).
 *
 * ## 값은 한 방향으로만 흐른다
 *
 * 이 파일에 **비밀을 돌려받는 함수는 하나도 없다.** 넣는 함수([`storePassword`]·
 * [`storePassphrase`])는 있지만 꺼내는 함수는 없다 — 값을 실제로 쓰는 것은 Rust 안의
 * `password_for`/`passphrase_for` 이고 그 둘은 IPC 표면에 없다. 그래서 프런트가 아는 것은
 * "금고가 있는가·잠겼는가·몇 개 들었는가", 그리고 [`list`]·[`hasPassword`]·
 * [`hasPassphrase`] 가 말하는 **종류와 대상**까지다 — 그 셋이 화면(설정의 금고 섹션 ·
 * 호스트 폼의 "저장된 자격증명" 줄 · 목록 줄의 표식)이 쓸 수 있는 전부이고, 값을 돌려주는
 * 함수를 여기 새로 내는 일은 없다 (docs/conventions.md 의 "볼트 값은 프런트로 돌려주지
 * 않는다").
 *
 * ## 상태는 **몇 초 동안 기억한다**
 *
 * `vault_status` 는 잠긴 마스터 금고에서 디스크를 다시 보고, 열린 금고에서는 잠금 하나를
 * 지난다. 접속 한 번에 이 물음이 서너 번 나오므로(잠금 해제 관문 · 저장 체크의 곁말 ·
 * 저장 직전의 "금고가 있나") 그때마다 왕복하면 모달이 늦게 뜬다. TTL 은 [`STATUS_TTL_MS`]
 * 이고, **상태를 바꾸는 자리**(만들기·잠금 해제)는 [`invalidateStatus`] 로 곧바로 지운다 —
 * 틀린 값을 몇 초 들고 있느니 한 번 더 묻는다.
 *
 * 룬을 쓰지 않는 평범한 모듈이다: 화면이 반응해야 하는 자리(`app/prompts.svelte.ts`)가
 * 이 값을 자기 `$state` 에 베껴 쓴다.
 */

/** Rust `VaultItem` 과 1:1 — **값이 실릴 자리가 없다** (종류와 대상뿐) */
export interface VaultItem {
  kind: "host_password" | "key_passphrase" | "mcp_env" | "db_password";
  /** 호스트 별칭(비밀번호) · 개인키 **전체 경로**(암호구) · MCP 참조 · DB 연결 `id`(DB 비밀번호) */
  target: string;
}

/** Rust `VaultStatus` 와 1:1 (camelCase 그대로) */
export interface VaultStatus {
  /** `"absent"` = 아직 만들지 않았다 · `"locked"` = 마스터가 필요하다 · `"unlocked"` */
  state: "absent" | "locked" | "unlocked";
  /**
   * 마스터 비밀번호가 걸려 있는가.
   *
   * **잠금 해제 모달이 칸을 세울지가 이것으로 갈린다** — 거짓이면 빈 값 하나(Enter)로 여는
   * **확인 관문**이다(보호가 아니다). 가림막이 걸리면 어느 쪽이든 잠기므로, 여는 문은 하나다.
   */
  hasMaster: boolean;
  /** 열려 있을 때만 실제 개수 */
  entryCount: number;
  /**
   * 잠긴 까닭 (③-3b1 — 금고는 세션 서버에 산다). `"shade"` 가림막 · `"user"` 설정 [잠그기] ·
   * `"windows_zero"` 보는 창이 하나도 없었다(마지막 창 파괴·GUI 종료/kill). 잠겨 있지 않으면 없다.
   */
  lockReason?: "shade" | "user" | "windows_zero";
  /**
   * **열려 있던** 금고를 창 0개 잠금이 닫았다 — 붙는 창이 가림막(관문)을 세운다. 이때 가림막은 볼트를 **다시 잠그지
   * 않는다**(`app/veil` 의 `raiseVeilForRelock`): 창 0개 잠금은 HTTP MCP 티켓을 *정지*하고, 가림막 잠금은 *폐기*하기 때문이다.
   */
  relock: boolean;
}

/** 금고를 아직 못 물어봤을 때의 값 — **"없다"** 로 읽는다(옵트인이므로 그게 정상이다) */
const UNKNOWN: VaultStatus = {
  state: "absent",
  hasMaster: false,
  entryCount: 0,
  relock: false,
};

/** 상태를 기억해 두는 시간 (ms). 접속 한 번 안의 물음들을 한 왕복으로 묶을 만큼만 */
const STATUS_TTL_MS = 5000;

let cached: { at: number; value: VaultStatus } | null = null;

/**
 * 떠 있는 잠금 해제 카드를 **다른 곳에서 연 볼트**(가림막)로 닫아도 되는가 — 기다리는 접속이 있고 · 카드가 [열기]를 처리하는
 * 중이 아니고 · 볼트가 **실제로 열렸을 때만**(`absent` · `locked` 는 닫지 않는다 — 건너뛰는 길이 되면 안 된다). 2026-11-10.
 */
export function canSettleUnlockCard(waiting: number, busy: boolean, state: VaultStatus["state"] | null): boolean {
  return waiting > 0 && !busy && state === "unlocked";
}

/** 기억해 둔 값을 버린다 — 금고를 만들거나 열거나 잠근 **직후**에 부른다 */
export function invalidateStatus(): void {
  cached = null;
}

/**
 * 지금 금고 상태. 실패는 [`UNKNOWN`] 으로 접는다 — 이 물음이 화면을 막아서는 안 된다.
 *
 * `fresh` 를 켜면 기억해 둔 값을 무시하고 다시 묻는다.
 */
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

/**
 * 금고를 만든다. `master === null` 이면 **키 파일 금고**다 — 아무것도 묻지 않는 대신
 * "이 사용자의 설정 폴더를 읽을 수 있는 자는 열 수 있다"(브라우저가 저장한 비밀번호와 같은
 * 등급). 그 문장은 화면이 그대로 말한다.
 */
export async function create(master: string | null): Promise<void> {
  await invoke("vault_create", { master });
  invalidateStatus();
}

/**
 * 잠금을 푼다. 틀린 마스터는 `[vault-wrong-master]` 가 붙은 오류다.
 *
 * **`null` 이 뜻을 갖는다** (2026-09-19 저녁): 마스터가 없는 볼트는 `null` 하나로 열린다 —
 * 가림막이 걸릴 때 그런 볼트도 함께 잠그기로 했으므로(`app/veil`), 다시 여는 문도 하나여야
 * 한다. 그 문은 보호가 아니라 **확인 관문**이고, 모달이 그 사실을 글자로 적는다.
 */
export async function unlock(master: string | null): Promise<void> {
  await invoke("vault_unlock", { master });
  invalidateStatus();
}

/**
 * 지금 잠근다 — **마스터가 있든 없든** 잠기고, 잠긴 뒤에는 스스로 다시 열리지 않는다.
 *
 * 부르는 쪽은 **프라이버시 가림막**이 걸리는 자리 하나다(`"shade"` — `app/veil.svelte.ts` 의 `openVeil`, 무입력 자동이든
 * 단축키든). 설정의 [잠그기](`"user"`)는 2026-10-21 에 걷었지만(잠금 = 가림막 하나) Rust 계약의 `"user"` 는 그대로 둔다.
 * 둘 다 HTTP MCP 티켓을 폐기한다.
 */
export async function lock(reason: "shade" | "user" = "shade"): Promise<void> {
  await invoke("vault_lock", { reason });
  invalidateStatus();
}

/**
 * 호스트 비밀번호를 담는다. 같은 별칭이 있으면 갈아 끼운다.
 *
 * 값은 **방금 접속에 쓴 그것**이고, 이 호출 뒤 부르는 쪽이 곧바로 버린다
 * (`app/prompts.svelte.ts` 의 `flushVaultSaves`).
 */
export async function storePassword(alias: string, value: string): Promise<void> {
  await invoke("vault_store_password", { alias, value });
  invalidateStatus();
}

/** 개인키 파일의 암호구를 담는다 — 대상이 **전체 경로**다 */
export async function storePassphrase(path: string, value: string): Promise<void> {
  await invoke("vault_store_passphrase", { path, value });
  invalidateStatus();
}

/**
 * 쿼리 타일 DB 연결의 비밀번호를 담는다 — 대상은 `db-connections.json` 연결의 **고정 `id`**(호스트 별칭이 아니다 —
 * 호스트 이름을 바꿔도 같은 열쇠). id 가 8~32자 `[A-Za-z0-9_-]` 가 아니면 백엔드가 거절한다.
 * 부르는 자리는 SSH 와 같이 **접속 모달의 "이 앱에 저장" 하나**다(인증 성공 뒤 — DB 모달은 쿼리 타일 연결 단계라 아직 없다).
 * 호스트 폼은 담지 않는다(지우기뿐).
 */
export async function storeDbPassword(id: string, value: string): Promise<void> {
  await invoke("vault_store_db_password", { id, value });
  invalidateStatus();
}

/**
 * **키 원천을 바꾼다** — 마스터 걸기(`next = 문자열`) · 풀기(`next = null`) · 갈아 끼우기.
 *
 * `current` 는 **지금** 금고를 여는 마스터다(마스터가 없는 금고면 `null`). 틀리면
 * `[vault-wrong-master]` 가 오고 **디스크는 한 글자도 안 바뀐다** (`vault.rs` 의 순서 셋).
 */
export async function setMaster(next: string | null, current: string | null): Promise<void> {
  await invoke("vault_set_master", { new: next, current });
  invalidateStatus();
}

/** [`verifyMaster`] 의 답 — 판정 글자와 막힌 길이(ms)뿐, 값은 없다 */
export interface MasterCheck {
  result: "ok" | "bad" | "no-master" | "no-vault" | "limited";
  retryAfterMs?: number | null;
}

/**
 * 마스터 암호를 **확인만** 한다(설정 › 보안 들어가기 관문 — 2026-10-21). 볼트 상태를 바꾸지 않고, 서버가 실패 빈도를
 * 센다(5번 틀리면 막힌다 — `limited`). 암호는 한 방향이다(Rust `vault_verify_master`).
 */
export async function verifyMaster(master: string): Promise<MasterCheck> {
  return await invoke<MasterCheck>("vault_verify_master", { master });
}

/**
 * 무엇이 들어 있는가 — **종류와 대상뿐이고 값은 없다**.
 *
 * 잠긴 금고에서는 `[vault-locked]`, 금고가 없으면 `[vault-absent]` 로 **거절한다** —
 * 부르는 쪽이 그 둘을 화면의 상태로 이미 알고 있으므로(`status`), 여기서는 던지는 대로 둔다.
 */
export async function list(): Promise<VaultItem[]> {
  return await invoke<VaultItem[]>("vault_list");
}

/** 항목 하나를 지운다. 없던 것을 지우는 것도 **성공**이다(멱등, 백엔드와 같은 규칙) */
export async function remove(kind: VaultItem["kind"], target: string): Promise<void> {
  await invoke("vault_delete", { kind, target });
  invalidateStatus();
}

/** 전부 지운다 — **금고 파일은 남고 비워진다**(키 원천은 사용자가 정한 설정이다) */
export async function removeAll(): Promise<void> {
  await invoke("vault_delete_all");
  invalidateStatus();
}

/**
 * 이 별칭의 비밀번호가 담겨 있는가 — 호스트 폼의 "저장된 자격증명" 줄이 묻는다.
 *
 * 실패(금고 없음·잠김)는 **거짓으로 접는다**: 이 물음의 답은 화면의 한 줄일 뿐이고,
 * 못 물어본 것과 "없다" 는 그 줄에서 같은 그림이다.
 */
export async function hasPassword(alias: string): Promise<boolean> {
  try {
    return await invoke<boolean>("vault_has_password", { alias });
  } catch {
    return false;
  }
}

/** 이 개인키 파일의 암호구가 담겨 있는가 ([`hasPassword`] 와 같은 규칙, 대상이 경로다) */
export async function hasPassphrase(path: string): Promise<boolean> {
  try {
    return await invoke<boolean>("vault_has_passphrase", { path });
  } catch {
    return false;
  }
}

/** 이 DB 연결의 비밀번호가 담겨 있는가 ([`hasPassword`] 와 같은 규칙, 대상이 연결 `id` 다). 지우기는 `remove("db_password", id)` */
export async function hasDbPassword(id: string): Promise<boolean> {
  try {
    return await invoke<boolean>("vault_has_db_password", { id });
  } catch {
    return false;
  }
}

/** MCP 환경변수·헤더 값은 보내기만 하고 새 참조를 받는다. 기존 값은 돌려받지 않는다. */
export async function storeMcpEnv(label: string, value: string): Promise<string> {
  const reference = await invoke<string>("vault_store_mcp_env", { label, value });
  invalidateStatus();
  return reference;
}
