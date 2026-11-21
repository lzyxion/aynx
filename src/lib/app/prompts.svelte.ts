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
 * 접속 중에 사람에게 묻는 것들 — 모두 대기열이다(모달이 겹치면 어느 서버에 답하는지 알 수 없다).
 * 금고만 한 답이 줄 전체에 간다 — 금고는 앱에 하나다(docs/log/2026-09-22-vault-unlock-queue.md).
 * 우선순위 금고 → 호스트 키 → 비밀번호 → 암호구 → 키 선택. 호스트 키가 비밀번호보다 앞인 것은 신뢰 결정이라서다 —
 * 뒤집으면 신뢰하지 않기로 한 서버에 이미 비밀번호를 친 셈이 된다.
 * 공개키 설치도 이 모달을 그대로 쓴다 — 비밀번호 입력 칸이 앱에 하나뿐이어야 "저장하지 않는다" 를 한 곳에서 지킨다.
 */

// ── 대상 문구 ──

/** 별칭 → `user@host:port` */
const targets = new Map<string, string>();

export function rememberTarget(host: HostEntry): void {
  const label = hostLabel(host);
  if (label) targets.set(host.name, label);
}

export function targetLabel(alias: string): string {
  return targets.get(alias) ?? alias;
}

// ── 호스트 키 확인 (TOFU) ──

// 대기열이라 큐가 빌 때 열림 · 마지막을 꺼낼 때 닫힘이다
const FOCUS_HOST_KEY = "host-key";
const FOCUS_PASSWORD = "password";
const FOCUS_KEY_PICK = "key-pick";
const FOCUS_VAULT = "vault-unlock";

interface Pending {
  prompt: HostKeyPrompt;
  resolve: (decision: HostKeyDecision) => void;
}

const queue = $state<Pending[]>([]);

export function hostKeyPrompt(): HostKeyPrompt | null {
  return queue[0]?.prompt ?? null;
}

export const confirmHostKey = (prompt: HostKeyPrompt) =>
  new Promise<HostKeyDecision>((resolve) => {
    if (queue.length === 0) rememberFocusOrigin(FOCUS_HOST_KEY);
    queue.push({ prompt, resolve });
  });

/** 모든 버튼과 Escape 가 이 한 문을 지난다 — Escape · 바깥 클릭은 언제나 `"reject"`(모르는 채로 닫는 것은 거부) */
export function answerHostKey(decision: HostKeyDecision): void {
  const item = queue.shift();
  if (queue.length === 0) returnFocus(FOCUS_HOST_KEY);
  item?.resolve(decision);
}

// ── 금고 (docs/log/2026-09-19-vault.md) ──

const vaultUi = $state<{ hasMaster: boolean }>({ hasMaster: false });

/** 거짓이면 "이 PC 의 내 계정" 등급이라고 말해야 한다 */
export function vaultHasMaster(): boolean {
  return vaultUi.hasMaster;
}

export function refreshVaultUi(): void {
  void vault.status().then((s) => {
    vaultUi.hasMaster = s.hasMaster;
  });
}

/**
 * 저장은 접속이 성공한 뒤에만 담는다 — 틀린 비밀번호를 담으면 다음 접속이 또 거부당한다.
 * 값이 사는 시간은 그 한 번의 시도뿐이다 — 담든 버리든 배열이 비워지며 값도 놓는다.
 */
interface PendingSave {
  kind: "password" | "passphrase" | "db_password";
  /** 호스트 별칭 · 개인키 전체 경로 · DB 연결 id — 볼트 대상 값 */
  target: string;
  value: string;
}

const pendingSaves: PendingSave[] = [];

function rememberSave(kind: PendingSave["kind"], target: string, value: string): void {
  const at = pendingSaves.findIndex((s) => s.kind === kind && s.target === target);
  if (at >= 0) pendingSaves.splice(at, 1);
  pendingSaves.push({ kind, target, value });
}

export function dropVaultSaves(): void {
  for (const s of pendingSaves) s.value = "";
  pendingSaves.length = 0;
}

/** 금고가 없으면 마스터 없이 만든다 — 체크를 켠 것이 곧 동의다(마스터를 또 묻지 않는다) */
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
    // 조용히 지나가면 사람은 담긴 줄 안다. 문구에는 값이 실리지 않는다(백엔드가 싣지 않는다)
    toast.error(stripReason(e instanceof Error ? e.message : String(e)));
  } finally {
    for (const item of items) item.value = "";
  }
}

// ── 잠금 해제 관문 ──

interface PendingUnlock {
  resolve: () => void;
}

const vuQueue = $state<PendingUnlock[]>([]);

export const vu = $state<{
  value: string;
  error: string | null;
  busy: boolean;
  /** 마스터가 없는 볼트에도 언제나 그린다 — 칸이 없는 꼴 자체가 "마스터 없음" 을 말해 준다 */
  field: HTMLInputElement | null;
}>({ value: "", error: null, busy: false, field: null });

export function vaultUnlockVisible(): boolean {
  return vuQueue.length > 0;
}

/**
 * 접속 전 관문 — 잠긴 금고에서 백엔드는 실패 대신 `None` 을 주므로, 이것이 없으면 담아 둔 비밀번호가 있는데도 묻는다.
 * 마스터 없는 잠긴 볼트에도 뜬다(가림막이 잠갔다 — 여는 길은 빈 Enter). 건너뛴 뒤 시작한 접속은 상태를 새로 보고 다시 묻는다.
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

/**
 * 닫는 유일한 문 — [열기] 성공 · [이번엔 건너뛰기] · Escape. 줄 전체를 한꺼번에 깨운다 — 하나씩 꺼내면 같은 마스터 암호를 타일 수만큼 친다.
 * 틀린 마스터는 이 문을 지나지 않는다.
 */
function finishVaultUnlock(): void {
  // 큐를 먼저 비운다 — 비우고 나서 깨워야 기다리던 쪽이 이어받는 자리에서 모달이 이미 닫혀 있다
  const waiting = vuQueue.splice(0, vuQueue.length);
  vu.value = "";
  vu.error = null;
  vu.busy = false;
  returnFocus(FOCUS_VAULT);
  for (const item of waiting) item.resolve();
}

/** 가림막을 걷은 자리가 부른다 — 볼트가 실제로 열렸을 때만 카드를 닫는다(열리지 않았으면 건너뛰는 길이 되면 안 된다) */
export async function settleVaultUnlockIfOpen(): Promise<void> {
  if (!vault.canSettleUnlockCard(vuQueue.length, vu.busy, "unlocked")) return;
  const status = await vault.status(true);
  if (!vault.canSettleUnlockCard(vuQueue.length, vu.busy, status.state)) return;
  vaultUi.hasMaster = status.hasMaster;
  finishVaultUnlock();
}

export function skipVaultUnlock(): void {
  if (vu.busy) return;
  finishVaultUnlock();
}

/**
 * "틀린 마스터" 와 "손상된 파일" 을 구분해 말하지 않는다 — 신탁이 된다(`vault.rs` 의 같은 줄).
 * 마스터가 없으면 `""` 가 아니라 `null` 을 보낸다 — 백엔드에서 `Some("")` 은 틀린 암호로 읽힌다.
 * 마스터 없는 볼트에 무언가 쳤으면 같은 "맞지 않습니다" 줄로 접는다 — 받아 열어 주면 "마스터 없음" 의 신탁이 된다.
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

// ── 비밀번호 입력 ──
// 입력값은 `pw.value` 한 곳에만 있고 모달이 닫히는 순간 지운다 — 큐 · 탭 · localStorage 어디에도 남기지 않는다.
// 저장 체크를 켰을 때만 접속이 선 뒤 금고로 간다.

interface PendingPassword {
  prompt: PasswordPrompt;
  resolve: (value: string | null) => void;
}

const pwQueue = $state<PendingPassword[]>([]);

/** 객체 한 칸인 것은 룬 모듈이 재대입되는 `$state` 를 export 할 수 없어서다 */
export const pw = $state<{ value: string; save: boolean; field: HTMLInputElement | null }>({
  value: "",
  save: false,
  field: null,
});

export function passwordPrompt(): PasswordPrompt | null {
  return pwQueue[0]?.prompt ?? null;
}

export function passwordVisible(): boolean {
  return !vaultUnlockVisible() && hostKeyPrompt() === null && pwQueue.length > 0;
}

export const promptPassword = (prompt: PasswordPrompt) =>
  new Promise<string | null>((resolve) => {
    if (pwQueue.length === 0) rememberFocusOrigin(FOCUS_PASSWORD);
    pwQueue.push({ prompt, resolve });
  });

/** 어느 경로로 닫히든 입력 칸을 즉시 비운다 */
export function resolvePassword(value: string | null): void {
  const item = pwQueue.shift();
  const save = pw.save;
  const alias = item?.prompt.alias;
  const db = item?.prompt.db;
  pw.value = "";
  pw.save = false;
  if (pwQueue.length === 0) returnFocus(FOCUS_PASSWORD);
  // `noSave`(연결 테스트)는 체크가 남아 있어도 담지 않는다
  if (value !== null && save && value !== "" && !item?.prompt.noSave) {
    if (db) rememberSave("db_password", db.id, value);
    else if (alias !== undefined) rememberSave("password", alias, value);
  }
  item?.resolve(value);
}

// ── 개인키 암호구 입력 — 비밀번호와 같은 규칙(값은 `pp.value` 한 칸 · 닫히면 지운다) ──

const FOCUS_PASSPHRASE = "passphrase";

interface PendingPassphrase {
  prompt: PassphrasePrompt;
  resolve: (value: string | null) => void;
}

const ppQueue = $state<PendingPassphrase[]>([]);

export const pp = $state<{ value: string; save: boolean; field: HTMLInputElement | null }>({
  value: "",
  save: false,
  field: null,
});

export function passphrasePrompt(): PassphrasePrompt | null {
  return ppQueue[0]?.prompt ?? null;
}

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

/** 모든 버튼과 Escape 가 이 한 문을 지난다 — 암호구가 지워지는 유일한 자리 */
export function resolvePassphrase(value: string | null): void {
  const item = ppQueue.shift();
  const save = pp.save;
  const path = item?.prompt.path;
  pp.value = "";
  pp.save = false;
  if (ppQueue.length === 0) returnFocus(FOCUS_PASSPHRASE);
  if (value !== null && save && path !== undefined && value !== "" && !item?.prompt.noSave) {
    rememberSave("passphrase", path, value);
  }
  item?.resolve(value);
}

// ── 설치할 공개키 고르기 ──

export type PickedKey =
  | { kind: "agent"; key: AgentKey }
  | { kind: "file"; key: KeyFile }
  | { kind: "new" };

export interface KeyPickRow {
  /** 지문은 두 무리에 같은 값이 올 수 있어 무리 이름을 앞에 붙인다 */
  id: string;
  group: "agent" | "file" | "new";
  first: boolean;
  label: string;
  detail: string;
  /** 서버에 들어갈 한 줄 전체 */
  title: string;
  picked: PickedKey;
}

export interface KeyPickPrompt {
  alias: string;
  agentKeys: AgentKey[];
  fileKeys: KeyFile[];
}

interface PendingKeyPick extends KeyPickPrompt {
  resolve: (picked: PickedKey | null) => void;
}

const keyQueue = $state<PendingKeyPick[]>([]);

export const keyPick = $state<{ index: number; el: HTMLElement | null }>({ index: 0, el: null });

export function keyPickPrompt(): KeyPickPrompt | null {
  return keyQueue[0] ?? null;
}

export function keyPickVisible(): boolean {
  return (
    !vaultUnlockVisible() &&
    hostKeyPrompt() === null &&
    !passwordVisible() &&
    !passphraseVisible() &&
    keyQueue.length > 0
  );
}

/** 줄 번호(`keyPick.index`)의 뜻이 여기 한 곳에서만 정해져야 ↑↓ · Enter · 클릭이 같은 줄을 가리킨다 */
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

export function keyPickGroupLabel(group: KeyPickRow["group"]): string {
  if (group === "agent") return t("app.keypick.group.agent");
  if (group === "file") return t("app.keypick.group.file");
  return t("app.keypick.group.new");
}

export const pickInstallKey = (alias: string, agentKeys: AgentKey[], fileKeys: KeyFile[]) =>
  new Promise<PickedKey | null>((resolve) => {
    if (keyQueue.length === 0) rememberFocusOrigin(FOCUS_KEY_PICK);
    keyQueue.push({ alias, agentKeys, fileKeys, resolve });
  });

export function resolveKeyPick(picked: PickedKey | null): void {
  const item = keyQueue.shift();
  keyPick.index = 0;
  if (keyQueue.length === 0) returnFocus(FOCUS_KEY_PICK);
  item?.resolve(picked);
}

/** Escape 는 창 keydown 의 모달 사슬이 받는다 */
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

/** 아래에 깔린 모달들(호스트 폼 · 포워딩 · 업로드 · 원격 편집)이 자기 표시 조건의 앞머리로 읽는다 */
export function promptsBlocking(): boolean {
  return (
    vaultUnlockVisible() ||
    hostKeyPrompt() !== null ||
    passwordVisible() ||
    passphraseVisible()
  );
}
