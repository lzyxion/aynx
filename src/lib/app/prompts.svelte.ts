import { hostLabel, type HostEntry } from "$lib/hosts";
import { rememberFocusOrigin, returnFocus } from "$lib/app/focus-return.svelte.js";
import { agentKeyLabel, keyFileLabel, shortFingerprint, type AgentKey } from "$lib/copyid";
import { hasReason, stripReason } from "$lib/error-reason";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";
import * as vault from "$lib/vault";
import type { KeyFile } from "$lib/keygen";
import type {
  HostKeyDecision,
  HostKeyPrompt,
  PassphrasePrompt,
  PasswordPrompt,
} from "$lib/session";

/**
 * **접속 중에 사람에게 묻는 것들** — 금고 잠금 해제 · 호스트 키(TOFU) · 비밀번호 ·
 * 키 암호구 · 설치할 공개키.
 *
 * 넷 다 모양이 같다: 백엔드가 거절하며 사정을 실어 보내면 화면이 모달을 띄우고, 사람이 답할
 * 때까지 기다렸다가 그 답으로 **다시 시도**한다. 그래서 넷 다 **대기열**이다 — 여러 타일이
 * 동시에 물어보면 앞에서부터 한 개씩 보여 준다 (모달 여러 장이 겹치면 어느 서버에 답하는지
 * 알 수 없다).
 *
 * **금고만 한 답이 줄 전체에 간다** (2026-09-22): 나머지 셋은 물음이 대상마다 다르지만
 * 금고는 앱에 하나여서, 한 번 열면(또는 한 번 건너뛰면) 그때 기다리던 타일 전부의 답이 된다
 * ([`finishVaultUnlock`] · docs/log/2026-09-22-vault-unlock-queue.md).
 *
 * ## 우선순위가 여기 한 곳에 있다
 *
 * 금고 잠금 해제 → 호스트 키 → 비밀번호 → 암호구 → 키 선택 순이다. 금고가 맨 앞인 이유는
 * **접속을 시작하기 전에** 지나는 관문이기 때문이다 (담아 둔 비밀번호를 쓰려면 금고가 먼저
 * 열려 있어야 한다 — 열고 나서야 `open_ssh_session` 을 부른다). 호스트 키가 그다음인 이유는 **그것이
 * 신뢰 결정**이기 때문이다 (비밀번호를 먼저 받아 두면 신뢰하지 않기로 한 서버에 이미
 * 비밀번호를 친 셈이 된다). 앱의 나머지 모달(호스트 폼·포워딩·업로드·편집)은 전부 이
 * 넷보다 뒤라, 그 사슬의 앞머리를 [`promptsBlocking`] 하나로 읽는다.
 *
 * ## 공개키 설치가 이 모달들을 그대로 쓴다
 *
 * 백엔드 `install_public_key` 의 거부 페이로드는 `open_ssh_session` 과 완전히 같은 태그
 * 유니온이다 (docs/log/2026-09-03-copy-id.md §7). 그래서 그 흐름은 새 다이얼로그를 만들지
 * 않고 여기 있는 [`confirmHostKey`]·[`promptPassword`] 를 그대로 부른다 — 사용자가 접속할
 * 때 본 것과 똑같은 창이 떠야 "같은 종류의 일" 로 읽히고, 무엇보다 **비밀번호 입력 칸이
 * 앱에 하나뿐이어야** "저장하지 않는다" 는 규칙을 한 곳에서 지킬 수 있다.
 */

// ---------------------------------------------------------------------------
// 대상 문구 — 모달이 "어디에 붙는 중인지" 를 말할 수 있게
// ---------------------------------------------------------------------------

/** 별칭 → `user@host:port` (호스트를 고를 때 기억해 둔다. 비밀번호 모달 본문에 쓴다) */
const targets = new Map<string, string>();

/** 비밀번호 모달이 "어디에 붙는 중인지" 를 말할 수 있게 대상 문구를 기억해 둔다 */
export function rememberTarget(host: HostEntry): void {
  const label = hostLabel(host);
  if (label) targets.set(host.name, label);
}

/** 그 별칭의 대상 문구 (모르면 별칭 그대로) */
export function targetLabel(alias: string): string {
  return targets.get(alias) ?? alias;
}

// ---------------------------------------------------------------------------
// 호스트 키 확인 (TOFU)
// ---------------------------------------------------------------------------

/**
 * 포커스 복귀 이름표들 (`app/focus-return`).
 *
 * 전부 **대기열**이라 "열렸다/닫혔다" 의 뜻이 다른 모달과 다르다: 큐가 비어 있다가 첫 항목이
 * 들어오는 순간이 열림이고, 마지막 항목을 꺼낸 순간이 닫힘이다. 세 줄이 겹쳐 떠 있는 동안에는
 * 표가 비지 않으므로 중간에 포커스가 새 나가지 않는다.
 */
const FOCUS_HOST_KEY = "host-key";
const FOCUS_PASSWORD = "password";
const FOCUS_KEY_PICK = "key-pick";
const FOCUS_VAULT = "vault-unlock";

interface Pending {
  prompt: HostKeyPrompt;
  resolve: (decision: HostKeyDecision) => void;
}

const queue = $state<Pending[]>([]);

/** 지금 물어보고 있는 호스트 키 (없으면 `null`) */
export function hostKeyPrompt(): HostKeyPrompt | null {
  return queue[0]?.prompt ?? null;
}

export const confirmHostKey = (prompt: HostKeyPrompt) =>
  new Promise<HostKeyDecision>((resolve) => {
    // 대기열이 비어 있었다 = 지금 화면이 모달로 덮인다. 그 직전의 포커스를 적어 둔다
    // (`app/focus-return` — 답하고 나면 사람은 치던 자리로 돌아간다).
    if (queue.length === 0) rememberFocusOrigin(FOCUS_HOST_KEY);
    queue.push({ prompt, resolve });
  });

/**
 * 큐에서 하나 꺼내 답한다 — 모달의 **모든 버튼과 Escape** 가 이 한 문을 지난다.
 *
 * 2026-09-16 에 `boolean` 에서 [`HostKeyDecision`] 으로 넓어졌다: 바뀐 키에는 "이번만" 과
 * "갱신" 이 생겼고, 그 셋을 boolean 둘로 쪼개면 호출부마다 조합이 달라진다.
 * Escape·바깥 클릭은 언제나 `"reject"` 다 — **모르는 채로 닫는 것은 거부**다.
 */
export function answerHostKey(decision: HostKeyDecision): void {
  const item = queue.shift();
  if (queue.length === 0) returnFocus(FOCUS_HOST_KEY);
  item?.resolve(decision);
}

// ---------------------------------------------------------------------------
// 금고 — "다음부터 묻지 않기" 가 사는 곳 (docs/log/2026-09-19-vault.md)
//
// 2026-09-19 ② 에 ssh-agent 가 있던 자리를 금고가 이어받았다. 에이전트 키는 **여전히
// 맨 먼저, 조용히** 시도되지만(백엔드), 사용자에게 "다시 묻지 않게 하는 길" 로 보여 주는
// 것은 이제 모달의 체크 하나다.
// ---------------------------------------------------------------------------

/**
 * 저장 체크의 곁말이 읽는 값 — 화면이 반응하도록 `$lib/vault` 의 답을 여기 베껴 쓴다.
 *
 * 지금 모달이 보는 것은 [`hasMaster`] 하나뿐이다(곁말 두 줄이 그것으로 갈린다). 금고
 * 섹션이 붙는 단계 ③은 `$lib/vault` 를 직접 읽으면 되므로 여기 창구를 더 내지 않는다.
 */
const vaultUi = $state<{ hasMaster: boolean }>({ hasMaster: false });

/** 마스터 비밀번호가 걸려 있는가 — 거짓이면 "이 PC 의 내 계정" 등급이라고 말해야 한다 */
export function vaultHasMaster(): boolean {
  return vaultUi.hasMaster;
}

/** 금고 상태를 (기억해 둔 값으로) 한 번 읽어 화면 값에 베낀다 — 모달이 뜰 때 부른다 */
export function refreshVaultUi(): void {
  void vault.status().then((s) => {
    vaultUi.hasMaster = s.hasMaster;
  });
}

/**
 * **접속이 서면 담을 것들** — 사용자가 "이 앱에 저장" 을 켜고 답한 값.
 *
 * 왜 여기 적어 두고 나중에 담는가: 저장은 **접속이 성공한 뒤**에만 뜻이 있다. 틀린
 * 비밀번호를 담으면 다음 접속이 그 틀린 값으로 한 번 더 거부당하고, 사용자는 왜 묻는지
 * 모르는 창을 다시 본다. 그래서 값을 이 한 곳에 쥐고 있다가 **세션이 실제로 선 자리**
 * (`Terminal.svelte`)가 [`flushVaultSaves`] 로 꺼내 간다 — 실패하면 [`dropVaultSaves`].
 *
 * 값이 사는 시간은 그 한 번의 시도뿐이다. 담든 버리든 이 배열은 **비워지면서** 값도 놓는다.
 */
interface PendingSave {
  kind: "password" | "passphrase" | "db_password";
  /** 호스트 별칭 · 개인키 **전체 경로** · DB 연결 id */
  target: string;
  value: string;
}

const pendingSaves: PendingSave[] = [];

/** 같은 대상은 한 번만 (마지막에 친 값이 이긴다) */
function rememberSave(kind: PendingSave["kind"], target: string, value: string): void {
  const at = pendingSaves.findIndex((s) => s.kind === kind && s.target === target);
  if (at >= 0) pendingSaves.splice(at, 1);
  pendingSaves.push({ kind, target, value });
}

/** 접속이 실패했다 — 담지 않고 버린다 (값도 함께 놓는다) */
export function dropVaultSaves(): void {
  for (const s of pendingSaves) s.value = "";
  pendingSaves.length = 0;
}

/**
 * **접속이 섰다 — 이제 담는다.**
 *
 * 금고가 아직 없으면 **마스터 없이 만든다**: 체크를 켠 것이 곧 "만들어도 좋다" 이고,
 * 거기서 마스터를 또 묻는 창을 띄우면 접속이 끝난 자리에 대화가 하나 더 쌓인다
 * (마스터는 설정에서 나중에 걸 수 있고, 모달의 곁말이 그 자리를 가리킨다).
 */
export async function flushVaultSaves(): Promise<void> {
  const items = pendingSaves.splice(0, pendingSaves.length);
  if (items.length === 0) return;
  try {
    if ((await vault.status()).state === "absent") await vault.create(null);
    for (const item of items) {
      if (item.kind === "password") await vault.storePassword(item.target, item.value);
      else if (item.kind === "db_password") await vault.storeDbPassword(item.target, item.value);
      else await vault.storePassphrase(item.target, item.value);
    }
    refreshVaultUi();
  } catch (e) {
    // 담지 못한 것은 **오류로 말한다** — 조용히 지나가면 사용자는 담긴 줄 알고 다음
    // 접속에서 또 묻는 창을 본다. 문구에는 값이 실리지 않는다(백엔드가 싣지 않는다).
    toast.error(stripReason(e instanceof Error ? e.message : String(e)));
  } finally {
    for (const item of items) item.value = "";
  }
}

// ── 잠금 해제 관문 ───────────────────────────────────────────────────────────

interface PendingUnlock {
  resolve: () => void;
}

const vuQueue = $state<PendingUnlock[]>([]);

/** 잠금 해제 모달이 직접 바인딩하는 칸들 (`pw` 와 같은 꼴) */
export const vu = $state<{
  value: string;
  /** 칸 아래 빨간 줄 — `[vault-wrong-master]` 또는 그 밖의 실패 문구 */
  error: string | null;
  busy: boolean;
  /**
   * 마스터 암호 칸 — **언제나 그려진다**(2026-09-19 밤).
   *
   * 저녁 판은 마스터가 없는 볼트에서 칸을 세우지 않고 [열기] 버튼을 첫 포커스로 삼았다.
   * 그 꼴 자체가 "이 볼트에는 마스터가 없다" 를 말해 주므로 가림막 관문과 함께 지웠다 —
   * 이제 두 경우가 같은 폼이고 포커스 자리도 늘 이 칸이다.
   */
  field: HTMLInputElement | null;
}>({ value: "", error: null, busy: false, field: null });

/** 지금 잠금 해제를 기다리고 있는가 */
export function vaultUnlockVisible(): boolean {
  return vuQueue.length > 0;
}

/**
 * **접속 전 관문** — 금고가 잠겨 있으면 먼저 열게 한다.
 *
 * 잠긴 금고에서 `password_for` 는 `None` 을 준다(백엔드가 실패시키지 않는다). 그래서
 * 이 관문이 없으면 담아 둔 비밀번호가 있는데도 모달이 뜨고, 사용자는 "저장했는데 왜 묻지"
 * 를 만난다. 여는 것은 **사람의 결정**이므로 [이번엔 건너뛰기] 가 언제나 있다.
 *
 * 잠기지 않았거나 금고가 없으면 **아무 일도 하지 않는다** — 옵트인이므로 그게 보통이다.
 *
 * **마스터가 없는 볼트에도 뜬다** (2026-09-19 저녁). 옛 판은 `locked` + `hasMaster === false`
 * 를 "키 파일이 사라져 **열 수 없는** 금고" 로 읽고 조용히 지나갔다. 이제 그 조합의 보통
 * 뜻은 **가림막이 잠갔다** 이고, 여는 길은 빈 Enter 하나다([`submitVaultUnlock`]). 키 파일이
 * 정말 사라졌다면 그 [열기] 가 실패하며 이유를 칸 아래에 적는다 — 묻지 않고 지나가는 것보다
 * 정직하다.
 *
 * **여럿이 동시에 닿아도 모달은 한 장이고 답도 한 번이다** (2026-09-22): 이미 모달이 서
 * 있으면 줄에만 서고, 열리든 건너뛰어지든 [`finishVaultUnlock`] 이 그 줄을 통째로 깨운다.
 * 그 뒤에 시작한 접속은 여기 다시 들어와 `vault.status()` 를 새로 보므로, 그 사이에 볼트가
 * 다시 잠겼으면 **다시 묻는다**.
 */
export async function ensureVaultUnlocked(): Promise<void> {
  const status = await vault.status();
  vaultUi.hasMaster = status.hasMaster;
  if (status.state !== "locked") return;
  await new Promise<void>((resolve) => {
    if (vuQueue.length === 0) rememberFocusOrigin(FOCUS_VAULT);
    vuQueue.push({ resolve });
  });
}

// 저녁 판의 `vaultUnlockNeedsMaster()` 는 **화면이 읽던 값**이었다(마스터가 없으면 칸을
// 세우지 않았다). 그 꼴 자체가 볼트의 속을 말해 주므로 2026-09-19 밤에 사라졌다 — 이제
// 마스터의 있고 없음을 읽는 자리는 [`submitVaultUnlock`] 하나이고, 거기서 `vaultUi.hasMaster`
// 를 직접 본다.

/**
 * 닫는 **유일한 문** — [열기] 성공 · [이번엔 건너뛰기] · Escape 가 전부 지난다.
 *
 * **줄 서 있던 것을 한꺼번에 깨운다** (2026-09-22 ·
 * docs/log/2026-09-22-vault-unlock-queue.md). 다른 대기열 넷은 하나씩 꺼내는 것이 옳다 —
 * 물음이 저마다 다르기 때문이다(이 서버의 호스트 키 · 저 서버의 비밀번호). 그런데 **금고는
 * 앱에 하나**라, 한 번 연 것이 곧 모두에게 열린 것이다. `Ctrl+Shift+R`(`reconnect-all`)이
 * 복원된 SSH 타일을 계단식으로 붙이면 타일마다 이 관문에 닿는데, 한 개씩 꺼내면 금고가 이미
 * 열린 뒤에도 모달이 다음 대기자를 위해 다시 서고 사용자는 **같은 마스터 암호를 타일 수만큼**
 * 친다.
 *
 * [이번엔 건너뛰기]·Escape 도 **같이 깨운다**: "지금은 말고" 는 그 순간 줄 서 있던 무리
 * 전체에 대한 답이다 (건너뛰기를 n 번 누르게 하는 것은 같은 버그의 뒷면이다). 뒤늦게
 * 시작한 접속은 [`ensureVaultUnlocked`] 를 **다시** 부르고 거기서 상태를 새로 보므로 또
 * 묻는다 — 건너뛴 것은 그때 줄 서 있던 그 한 무리뿐이다.
 *
 * 틀린 마스터는 이 문을 **지나지 않는다** ([`submitVaultUnlock`] 이 모달을 세워 둔 채 칸
 * 아래에 줄만 긋는다).
 */
function finishVaultUnlock(): void {
  // 큐를 **먼저** 비운다 — 모달의 표시 조건이 [`vaultUnlockVisible`](= 큐가 비지 않음)이라,
  // 비우고 나서 깨워야 기다리던 쪽이 이어받는 자리에서 모달이 이미 닫혀 있다.
  const waiting = vuQueue.splice(0, vuQueue.length);
  vu.value = "";
  vu.error = null;
  vu.busy = false;
  // 큐는 방금 비었다 — 조건 없이 돌려준다 (표에 이름표가 없으면 `returnFocus` 가 지나간다).
  returnFocus(FOCUS_VAULT);
  for (const item of waiting) item.resolve();
}

/** [이번엔 건너뛰기] · Escape — 금고 없이 이번 접속을 계속한다 */
export function skipVaultUnlock(): void {
  if (vu.busy) return;
  finishVaultUnlock();
}

/**
 * [열기] — 틀리면 **모달을 닫지 않고** 그 칸에 줄만 세운다.
 *
 * "틀린 마스터" 와 "손상된 파일" 을 구분해 말하지 않는다: AEAD 가 둘을 구분해 주지 않고,
 * 구분해 주는 척하는 문구는 공격자에게 신탁이 된다 (`vault.rs` 의 같은 줄).
 *
 * **마스터가 없으면 `null` 을 보낸다** — 빈 문자열이 아니다. 백엔드에서 `None` 은 "키
 * 원천이 알아서 연다"(키 파일 금고) 이고, `Some("")` 은 마스터 금고에서 **틀린 암호**로
 * 읽힌다. 상태가 낡아 실제로는 마스터가 걸린 볼트였다면 그때 `[vault-locked]` 가 오고,
 * 그 문구가 칸 아래에 선다.
 *
 * **마스터가 없으면 빈 값이 유일한 답이다** (2026-09-19 밤 — 가림막 관문의 같은 규칙).
 * 칸은 두 경우 모두 서므로 사람이 무언가 칠 수 있는데, 그 값은 이 금고의 답이 아니다:
 * 명령을 내보내기 전에 여기서 **같은 "맞지 않습니다" 줄**로 접는다. 조용히 받아 열어 주면
 * 그 반응이 곧 "이 볼트에는 마스터가 없다" 는 신탁이 된다.
 */
export async function submitVaultUnlock(): Promise<void> {
  if (vuQueue.length === 0 || vu.busy) return;
  const needsMaster = vaultUi.hasMaster;
  if (!needsMaster && vu.value !== "") {
    vu.error = t("app.vault.unlock.wrong");
    vu.value = "";
    vu.field?.focus();
    return;
  }
  vu.busy = true;
  vu.error = null;
  try {
    await vault.unlock(needsMaster ? vu.value : null);
    refreshVaultUi();
    finishVaultUnlock();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    vu.error = hasReason(message, "vault-wrong-master")
      ? t("app.vault.unlock.wrong")
      : stripReason(message);
    vu.busy = false;
    vu.value = "";
    vu.field?.focus();
  }
}

// ---------------------------------------------------------------------------
// 비밀번호 입력
//
// TOFU 와 같은 "끊고 재시도" 계약이라 모달도 같은 대기열 모양이다. 입력값은 [`pw.value`]
// 한 곳에만 있고, 모달이 닫히는 순간 "" 로 지운다 — 큐 항목·탭·localStorage 어디에도
// 남기지 않는다.
//
// **한 군데만 달라졌다 (2026-09-19 ②)**: [`pw.save`] 를 켜면 접속이 **선 뒤에** 그 값이
// 금고로 간다 ([`flushVaultSaves`]). 켜지 않으면 예전과 글자 그대로 같다 — 이 앱은
// 여전히 아무것도 기억하지 않는다.
// ---------------------------------------------------------------------------

interface PendingPassword {
  prompt: PasswordPrompt;
  resolve: (value: string | null) => void;
}

const pwQueue = $state<PendingPassword[]>([]);

/**
 * 모달이 직접 바인딩하는 칸들 (`bind:value` · `bind:this`).
 *
 * 상태를 **객체 한 칸**에 모으는 이유는 룬 모듈이 재대입되는 `$state` 를 export 할 수 없기
 * 때문이다 — 필드 대입은 그대로 반응하므로 `bind:` 가 아무 손해 없이 붙는다.
 */
export const pw = $state<{ value: string; save: boolean; field: HTMLInputElement | null }>({
  value: "",
  save: false,
  field: null,
});

/** 지금 물어보고 있는 비밀번호 요청 (없으면 `null`) */
export function passwordPrompt(): PasswordPrompt | null {
  return pwQueue[0]?.prompt ?? null;
}

/** 호스트 키 확인이 더 급하므로 TOFU 모달이 떠 있으면 비밀번호 모달은 기다린다 */
export function passwordVisible(): boolean {
  return !vaultUnlockVisible() && hostKeyPrompt() === null && pwQueue.length > 0;
}

export const promptPassword = (prompt: PasswordPrompt) =>
  new Promise<string | null>((resolve) => {
    if (pwQueue.length === 0) rememberFocusOrigin(FOCUS_PASSWORD);
    pwQueue.push({ prompt, resolve });
  });

/**
 * 큐에서 하나 꺼내 답한다. 어느 경로로 닫히든 입력 칸을 즉시 비운다.
 *
 * 체크가 켜져 있으면 값을 [`pendingSaves`] 에 적어 둔다 — **담는 것은 접속이 선 뒤**다.
 */
export function resolvePassword(value: string | null): void {
  const item = pwQueue.shift();
  const save = pw.save;
  const alias = item?.prompt.alias;
  const db = item?.prompt.db;
  pw.value = "";
  pw.save = false;
  if (pwQueue.length === 0) returnFocus(FOCUS_PASSWORD);
  if (value !== null && save && value !== "") {
    // DB 접속 모달이면 볼트 `db_password`(대상 = 연결 id) — 담는 것은 역시 **접속이 선 뒤**다(`query/open-flow`).
    if (db) rememberSave("db_password", db.id, value);
    else if (alias !== undefined) rememberSave("password", alias, value);
  }
  item?.resolve(value);
}

// ---------------------------------------------------------------------------
// 개인키 암호구 입력 (docs/log/2026-09-19-identity-file-auth.md)
//
// 비밀번호와 **한 글자도 다르지 않은 규칙**이다: 끊고 재시도하는 계약, 대기열 하나,
// 입력값은 [`pp.value`] 한 칸에만 있고 모달이 닫히는 순간 `""` 로 지운다. 다른 것은
// 대상뿐이다 — 저쪽은 서버의 비밀번호이고 이쪽은 **내 디스크의 키 파일**이다.
//
// 그래서 자리도 비밀번호 **바로 뒤**다: 호스트 키(신뢰 결정)보다 뒤이고, 암호구를 물은
// 뒤에야 비밀번호 차례가 올 수 있으므로 둘이 동시에 뜰 일은 없다.
// ---------------------------------------------------------------------------

const FOCUS_PASSPHRASE = "passphrase";

interface PendingPassphrase {
  prompt: PassphrasePrompt;
  resolve: (value: string | null) => void;
}

const ppQueue = $state<PendingPassphrase[]>([]);

/**
 * 모달이 직접 바인딩하는 칸들 (`pw` 와 같은 꼴).
 *
 * `save` 는 비밀번호 모달의 것과 **같은 체크**다 (기본은 꺼짐). 2026-09-19 ② 이전에는
 * 이 자리에 "이 키를 ssh-agent 에 넣기" 가 있었는데, 그 길은 `ssh-add` 타일을 열어
 * **같은 암호구를 한 번 더** 묻는 것이었다 — 금고는 이미 받은 값을 그대로 담는다.
 */
export const pp = $state<{ value: string; save: boolean; field: HTMLInputElement | null }>({
  value: "",
  save: false,
  field: null,
});

/** 지금 물어보고 있는 암호구 요청 (없으면 `null`) */
export function passphrasePrompt(): PassphrasePrompt | null {
  return ppQueue[0]?.prompt ?? null;
}

/** 호스트 키·비밀번호가 더 급하다 — 그 모달이 떠 있으면 암호구는 기다린다 */
export function passphraseVisible(): boolean {
  return (
    !vaultUnlockVisible() &&
    hostKeyPrompt() === null &&
    !passwordVisible() &&
    ppQueue.length > 0
  );
}

export const promptPassphrase = (prompt: PassphrasePrompt) =>
  new Promise<string | null>((resolve) => {
    if (ppQueue.length === 0) rememberFocusOrigin(FOCUS_PASSPHRASE);
    ppQueue.push({ prompt, resolve });
  });

/**
 * 큐에서 하나 꺼내 답한다 — **모든 버튼과 Escape** 가 이 한 문을 지난다.
 * 어느 경로로 닫히든 입력 칸을 즉시 비운다 (암호구가 지워지는 유일한 자리).
 *
 * 체크가 켜져 있으면 **경로를 열쇠로** 적어 둔다 — 금고의 대상이 곧 그 경로다.
 */
export function resolvePassphrase(value: string | null): void {
  const item = ppQueue.shift();
  const save = pp.save;
  const path = item?.prompt.path;
  pp.value = "";
  pp.save = false;
  if (ppQueue.length === 0) returnFocus(FOCUS_PASSPHRASE);
  if (value !== null && save && path !== undefined && value !== "") {
    rememberSave("passphrase", path, value);
  }
  item?.resolve(value);
}

// ---------------------------------------------------------------------------
// 설치할 공개키 고르기 (docs/log/2026-09-03-copy-id-ui.md · 2026-09-17-keygen.md)
//
// 공개키 설치 흐름이 **새로 만드는 유일한 모달**이었다. 2026-09-17 에 목록이 두 무리로
// 늘었다 — ssh-agent 의 키와 `~/.ssh` 의 키 파일 — 그리고 맨 아래 "새 키 만들기…" 한 줄이
// 붙었다. 키가 하나도 없는 사람에게 이 창이 막다른 골목이었기 때문이다.
// ---------------------------------------------------------------------------

/**
 * 고른 결과. **셋 중 하나**다 — 심을 줄이 어디서 왔는지가 그 뒤의 처리를 가른다
 * (에이전트 키는 지문으로, 파일 키는 줄 자체로 설치하고, `"new"` 는 모달을 한 장 더 연다).
 */
export type PickedKey =
  | { kind: "agent"; key: AgentKey }
  | { kind: "file"; key: KeyFile }
  | { kind: "new" };

/** 고르개가 그리는 한 줄 — 무리(`group`)가 곧 소제목이다 */
export interface KeyPickRow {
  /** `{#each}` 의 열쇠. 지문은 두 무리에 같은 값이 올 수 있어 무리 이름을 앞에 붙인다 */
  id: string;
  group: "agent" | "file" | "new";
  /** 무리의 **첫 줄**인가 — 소제목은 이 줄 위에만 그린다 */
  first: boolean;
  label: string;
  /** 오른쪽 곁말 (짧은 지문, `"새 키"` 줄에서는 빈 문자열) */
  detail: string;
  // (2026-09-19 ② 에 꼬리말 `note` 가 없어졌다 — "(에이전트에 없음)" 은 에이전트가
  //  "다시 묻지 않게 하는 길" 이던 시절의 안내였고, 그 자리는 이제 금고다.)
  /** 툴팁 — 서버에 들어갈 한 줄 전체 */
  title: string;
  picked: PickedKey;
}

/** 고르개가 답해야 하는 물음 하나 — "이 호스트에 어느 키를 심을까" */
export interface KeyPickPrompt {
  alias: string;
  agentKeys: AgentKey[];
  fileKeys: KeyFile[];
}

interface PendingKeyPick extends KeyPickPrompt {
  resolve: (picked: PickedKey | null) => void;
}

const keyQueue = $state<PendingKeyPick[]>([]);

/** 하이라이트된 줄과 포커스를 받을 상자 (↑↓ 로 옮기고 Enter 로 고른다) */
export const keyPick = $state<{ index: number; el: HTMLElement | null }>({ index: 0, el: null });

/** 지금 고르고 있는 요청 (없으면 `null`) */
export function keyPickPrompt(): KeyPickPrompt | null {
  return keyQueue[0] ?? null;
}

/** TOFU·비밀번호·암호구가 더 급하다 — 그것들이 떠 있으면 키 선택은 기다린다 (같은 규칙의 4단) */
export function keyPickVisible(): boolean {
  return (
    !vaultUnlockVisible() &&
    hostKeyPrompt() === null &&
    !passwordVisible() &&
    !passphraseVisible() &&
    keyQueue.length > 0
  );
}

/**
 * 두 무리와 마지막 한 줄을 **하나의 평평한 목록**으로 편다.
 *
 * 화면은 무리별로 소제목을 그리지만 ↑↓ 는 그 경계를 모른다 — 사람이 보기에 목록은 하나이고,
 * 무리는 그 안의 구획이기 때문이다. 목록을 컴포넌트에서 조립하지 않고 여기 두는 이유도
 * 그것이다: **줄 번호(`keyPick.index`)의 뜻이 한 곳에서만 정해져야** ↑↓·Enter·클릭이
 * 같은 줄을 가리킨다.
 *
 * 파일 키 중 **에이전트에 이미 있는 것은 뺀다** (지문으로 맞춘다) — 같은 키가 두 줄로
 * 보이면 사용자는 둘의 차이를 찾게 되는데, 차이가 없다.
 */
export function keyPickRows(cur: KeyPickPrompt): KeyPickRow[] {
  const inAgent = new Set(cur.agentKeys.map((k) => k.fingerprint));
  const rows: KeyPickRow[] = [];

  cur.agentKeys.forEach((key, i) => {
    rows.push({
      id: `agent:${key.fingerprint}`,
      group: "agent",
      first: i === 0,
      label: agentKeyLabel(key),
      detail: shortFingerprint(key.fingerprint),
      title: key.publicLine,
      picked: { kind: "agent", key },
    });
  });

  const files = cur.fileKeys.filter((k) => !inAgent.has(k.fingerprint));
  files.forEach((key, i) => {
    rows.push({
      id: `file:${key.fingerprint}`,
      group: "file",
      first: i === 0,
      label: keyFileLabel(key),
      detail: shortFingerprint(key.fingerprint),
      title: key.publicLine,
      picked: { kind: "file", key },
    });
  });

  rows.push({
    id: "new",
    group: "new",
    first: true,
    label: t("app.keypick.new"),
    detail: "",
    title: t("app.keypick.new.title"),
    picked: { kind: "new" },
  });
  return rows;
}

/** 무리 소제목 — `keyPickRows` 가 매긴 `group` 의 사람 글자 */
export function keyPickGroupLabel(group: KeyPickRow["group"]): string {
  if (group === "agent") return t("app.keypick.group.agent");
  if (group === "file") return t("app.keypick.group.file");
  return t("app.keypick.group.new");
}

/**
 * 키를 고르게 한다 — 취소(Escape·취소 버튼)면 `null`.
 *
 * 두 목록을 **함께** 받는 이유: 겹침 제거가 지문 비교라 한쪽만으로는 할 수 없고, 호출부가
 * 두 번 물어보면 그 사이에 목록이 어긋날 수 있다.
 */
export const pickInstallKey = (alias: string, agentKeys: AgentKey[], fileKeys: KeyFile[]) =>
  new Promise<PickedKey | null>((resolve) => {
    if (keyQueue.length === 0) rememberFocusOrigin(FOCUS_KEY_PICK);
    keyQueue.push({ alias, agentKeys, fileKeys, resolve });
  });

/** 큐에서 하나 꺼내 답한다 (어느 경로로 닫히든 여기를 지난다) */
export function resolveKeyPick(picked: PickedKey | null): void {
  const item = keyQueue.shift();
  keyPick.index = 0;
  if (keyQueue.length === 0) returnFocus(FOCUS_KEY_PICK);
  item?.resolve(picked);
}

/** 키 선택 모달의 ↑↓·Enter (Escape 는 창 keydown 의 모달 사슬이 받는다) */
export function onKeyPickKeydown(ev: KeyboardEvent): void {
  const cur = keyPickPrompt();
  if (!cur) return;
  const rows = keyPickRows(cur);
  const n = rows.length;
  if (ev.key === "ArrowDown") {
    ev.preventDefault();
    keyPick.index = (keyPick.index + 1) % n;
  } else if (ev.key === "ArrowUp") {
    ev.preventDefault();
    keyPick.index = (keyPick.index - 1 + n) % n;
  } else if (ev.key === "Enter") {
    ev.preventDefault();
    resolveKeyPick(rows[keyPick.index]?.picked ?? null);
  }
}

// ---------------------------------------------------------------------------

/**
 * **접속 대화 셋 중 하나라도 떠 있는가** — 아래에 깔린 모달들(호스트 폼·포워딩·업로드·
 * 원격 편집)이 자기 표시 조건의 앞머리로 읽는 값이다.
 *
 * 키 선택은 여기 들어가지 않는다: 그 모달은 **호스트 폼보다 뒤가 아니라 앞**이지만, 폼이
 * 떠 있는 동안 공개키 설치가 시작될 길이 없으므로 사슬에 넣어도 답이 같고, 넣지 않으면
 * `keyPickVisible` 이 폼을 참조하지 않아 의존 방향이 한 줄 단순해진다.
 */
export function promptsBlocking(): boolean {
  return (
    vaultUnlockVisible() ||
    hostKeyPrompt() !== null ||
    passwordVisible() ||
    passphraseVisible()
  );
}
