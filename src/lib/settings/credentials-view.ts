import type { Key } from "$lib/i18n/keys";
import type { VaultItem, VaultStatus } from "$lib/vault";
import type { DelegationTargetView } from "$lib/delegation";
import type { DbAiView } from "$lib/db-ai";

/** 설정 › 보안 요약 ↔ 하위 화면의 순수 조각 — 요약의 "정리 필요 N" 과 하위 화면의 [정리 필요] 칩이 같은 판정을 써야 숫자가 어긋나지 않는다 */

export type VaultKind = VaultItem["kind"];

/** 부팅 알림 "설정에 없는 AI 권한" 이 가리키는 anchor — 설정 색인에는 오르지 않는다 */
export const DELEGATION_ORPHANS_ANCHOR = "delegation-orphans";

export const VAULT_KINDS: readonly VaultKind[] = ["host_password", "key_passphrase", "db_password", "mcp_env"];

export const VAULT_KIND_LABEL: Readonly<Record<VaultKind, Key>> = {
  host_password: "settings.credentials.kind.host_password",
  key_passphrase: "settings.credentials.items.kind.passphrase",
  db_password: "settings.credentials.kind.db_password",
  mcp_env: "settings.credentials.kind.mcp_env",
};

export function vaultKindCounts(items: readonly VaultItem[]): { kind: VaultKind; n: number }[] {
  return VAULT_KINDS.map((kind) => ({ kind, n: items.filter((i) => i.kind === kind).length })).filter((c) => c.n > 0);
}

function norm(q: string): string {
  return q.trim().toLowerCase();
}

export function matchesQuery(q: string, ...texts: (string | undefined | null)[]): boolean {
  const n = norm(q);
  if (n === "") return true;
  return texts.some((s) => !!s && s.toLowerCase().includes(n));
}

export function filterVaultItems(
  items: readonly VaultItem[],
  q: string,
  kind: VaultKind | "all",
  display: (item: VaultItem) => string,
): VaultItem[] {
  return items.filter((i) => (kind === "all" || i.kind === kind) && matchesQuery(q, display(i), i.target));
}

export function groupVaultItems(items: readonly VaultItem[]): { kind: VaultKind; items: VaultItem[] }[] {
  return VAULT_KINDS.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}

/** `=== false` 로 못 박는다 — 옛 백엔드는 이 칸을 안 보내고(`undefined`), 그때는 아무것도 고아가 아니어야 한다 */
export function isOrphanHost(target: DelegationTargetView): boolean {
  return target.alias_known === false;
}

export function filterDelegationTargets(
  targets: readonly DelegationTargetView[],
  q: string,
  onlyCleanup: boolean,
): DelegationTargetView[] {
  return targets.filter((v) => (!onlyCleanup || isOrphanHost(v)) && matchesQuery(q, v.alias));
}

export function dbAiNeedsCleanup(v: DbAiView): boolean {
  return !v.connKnown || !v.identityOk;
}

export function filterDbAiTargets(views: readonly DbAiView[], q: string, onlyCleanup: boolean): DbAiView[] {
  return views.filter((v) => (!onlyCleanup || dbAiNeedsCleanup(v)) && matchesQuery(q, v.name, v.id));
}

// ── 상태 줄 ──

export type VaultTone = "ok" | "warn" | "neutral";

export interface VaultFactChip {
  id: "items" | "master" | "nomaster" | "idle" | "idleoff";
  icon: string;
  label: Key;
  params?: Record<string, number>;
  title?: Key;
  look: "plain" | "accent" | "warn";
}

export interface VaultStateView {
  tone: VaultTone;
  /** 색만으로 가르지 않는다 — 열림은 열린 자물쇠 */
  icon: "lock-open" | "lock";
  title: Key;
  note: Key;
  chips: VaultFactChip[];
}

/** 0 이면 "꺼짐" — 그때 잠그는 길은 가림막 단축키뿐이다 */
function idleChip(idleLockMin: number): VaultFactChip {
  return idleLockMin > 0
    ? { id: "idle", icon: "clock", label: "settings.credentials.chip.idle", params: { n: idleLockMin }, look: "plain" }
    : { id: "idleoff", icon: "clock", label: "settings.credentials.chip.idleoff", look: "warn" };
}

function masterChip(hasMaster: boolean): VaultFactChip {
  return hasMaster
    ? { id: "master", icon: "shield-check", label: "settings.credentials.chip.master", title: "settings.credentials.state.note.master", look: "accent" }
    : { id: "nomaster", icon: "shield-off", label: "settings.credentials.chip.nomaster", title: "settings.credentials.state.note.nomaster", look: "warn" };
}

/** 위협 모델을 잃지 않는다 — 마스터 없음은 그 등급 문장(`state.note.nomaster`)과 경고색 칩이다. 값은 없다(개수만) */
export function vaultStateView(status: Pick<VaultStatus, "state" | "hasMaster" | "entryCount">, idleLockMin: number): VaultStateView {
  if (status.state === "absent") {
    return { tone: "neutral", icon: "lock", title: "settings.credentials.state.absent", note: "settings.credentials.state.note.absent", chips: [] };
  }
  if (status.state === "locked") {
    return {
      tone: "neutral",
      icon: "lock",
      title: "settings.credentials.state.locked",
      note: status.hasMaster ? "settings.credentials.state.note.master" : "settings.credentials.state.note.nomaster",
      chips: [masterChip(status.hasMaster)],
    };
  }
  const items: VaultFactChip = {
    id: "items",
    icon: "key",
    label: "settings.credentials.chip.items",
    params: { n: status.entryCount },
    look: "plain",
  };
  return {
    tone: status.hasMaster ? "ok" : "warn",
    icon: "lock-open",
    title: "settings.credentials.state.open",
    note: status.hasMaster ? "settings.credentials.state.open.master" : "settings.credentials.state.note.nomaster",
    chips: [items, masterChip(status.hasMaster), idleChip(idleLockMin)],
  };
}
