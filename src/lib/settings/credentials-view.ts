import type { Key } from "$lib/i18n/keys";
import type { VaultItem, VaultStatus } from "$lib/vault";
import type { DelegationTargetView } from "$lib/delegation";
import type { DbAiView } from "$lib/db-ai";

/**
 * 설정 › 보안의 **요약 ↔ 하위 화면**(2026-10-21)이 쓰는 순수 조각 — 종류별 개수 · 검색 · 거르기 · 묶기.
 *
 * 화면(`CredentialsSection` 요약 · `VaultItemsView` · `DelegationHostsView` · `DbAiTargetsView`)은 목록을
 * 그대로 받아 이 함수들로 줄을 고르고, 판정(고아 · 대상 바뀜)도 여기 하나에서 한다 — 요약의 "정리 필요 N" 칩과
 * 하위 화면의 [정리 필요] 칩이 같은 눈으로 세야 숫자가 어긋나지 않는다. DOM · 사전을 모른다(문구는 키로만).
 */

export type VaultKind = VaultItem["kind"];

/**
 * 부팅의 "설정에 없는 AI 권한" 알림이 가리키는 anchor — 섹션(`CredentialsSection.expandForAnchor`)이 받으면
 * AI 권한 호스트 하위 화면을 [정리 필요] 칩으로 연다. 설정 색인(`settings-index.ts`)에는 오르지 않는다(색인의 목적지는 요약의 [관리 ›]).
 */
export const DELEGATION_ORPHANS_ANCHOR = "delegation-orphans";

/** 종류 순서 — 요약 칩 · 하위 화면의 칩 · 묶음 머리가 모두 이 순서다 */
export const VAULT_KINDS: readonly VaultKind[] = ["host_password", "key_passphrase", "db_password", "mcp_env"];

/**
 * 종류 이름 — 칩 · 묶음 머리 · 삭제 단추의 aria 가 같은 글자를 쓴다. 비밀번호는 DB 비밀번호와 나란히
 * 서므로 "호스트 비밀번호" 다(옛 판의 줄마다 붙던 "비밀번호" 는 묶음 머리가 대신 말한다).
 */
export const VAULT_KIND_LABEL: Readonly<Record<VaultKind, Key>> = {
  host_password: "settings.credentials.kind.host_password",
  key_passphrase: "settings.credentials.items.kind.passphrase",
  db_password: "settings.credentials.kind.db_password",
  mcp_env: "settings.credentials.kind.mcp_env",
};

/** 종류별 개수 — **있는 종류만**, `VAULT_KINDS` 순서로 */
export function vaultKindCounts(items: readonly VaultItem[]): { kind: VaultKind; n: number }[] {
  return VAULT_KINDS.map((kind) => ({ kind, n: items.filter((i) => i.kind === kind).length })).filter((c) => c.n > 0);
}

/** 검색어 — 앞뒤 공백을 걷고 대소문자를 무시한다(빈 글자 = 모두 맞음) */
function norm(q: string): string {
  return q.trim().toLowerCase();
}

/** 글자 조각 중 하나라도 검색어를 품는가 */
export function matchesQuery(q: string, ...texts: (string | undefined | null)[]): boolean {
  const n = norm(q);
  if (n === "") return true;
  return texts.some((s) => !!s && s.toLowerCase().includes(n));
}

/**
 * 저장된 항목 거르기 — 종류(`"all"` = 전부) + 검색어. 검색은 **화면의 대상 표기**(`display` — 키 경로는 `~/.ssh/…`,
 * DB 는 "경유 · 연결 이름")와 원래 대상(별칭 · 전체 경로 · 연결 id)에 부분 일치한다.
 */
export function filterVaultItems(
  items: readonly VaultItem[],
  q: string,
  kind: VaultKind | "all",
  display: (item: VaultItem) => string,
): VaultItem[] {
  return items.filter((i) => (kind === "all" || i.kind === kind) && matchesQuery(q, display(i), i.target));
}

/** 종류별로 묶는다 — 빈 묶음은 없고 `VAULT_KINDS` 순서, 묶음 안은 받은 순서 그대로 */
export function groupVaultItems(items: readonly VaultItem[]): { kind: VaultKind; items: VaultItem[] }[] {
  return VAULT_KINDS.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0);
}

/**
 * **고아 위임**인가 — 별칭이 `~/.ssh/config` 에 없다. `=== false` 로 못 박는다: 옛 백엔드는 이 칸을 안 보내고
 * (`undefined`), 그때는 아무것도 고아가 아니어야 한다.
 */
export function isOrphanHost(target: DelegationTargetView): boolean {
  return target.alias_known === false;
}

/** AI 권한 호스트 거르기 — 별칭 검색 + (켜면) 정리 필요만 */
export function filterDelegationTargets(
  targets: readonly DelegationTargetView[],
  q: string,
  onlyCleanup: boolean,
): DelegationTargetView[] {
  return targets.filter((v) => (!onlyCleanup || isOrphanHost(v)) && matchesQuery(q, v.alias));
}

/** DB 연결 블록이 정리 거리인가 — 연결이 목록에 없거나(고아) 권한을 준 뒤 대상이 바뀌었다 */
export function dbAiNeedsCleanup(v: DbAiView): boolean {
  return !v.connKnown || !v.identityOk;
}

/** AI 권한 DB 연결 거르기 — 이름(없으면 id) · id 검색 + (켜면) 정리 필요만 */
export function filterDbAiTargets(views: readonly DbAiView[], q: string, onlyCleanup: boolean): DbAiView[] {
  return views.filter((v) => (!onlyCleanup || dbAiNeedsCleanup(v)) && matchesQuery(q, v.name, v.id));
}

// ---------------------------------------------------------------------------
// 상태 줄(2026-10-21 — 목업 안 A): 상태 타일 + 제목 · 한 마디 + 사실 칩
// ---------------------------------------------------------------------------

/** 줄의 톤 — `ok` = 열림 + 마스터(성공 토큰) · `warn` = 열림 + 마스터 없음(경고 토큰) · `neutral` = 없음 · 잠김 */
export type VaultTone = "ok" | "warn" | "neutral";

/** 사실 칩 하나 — 모양(`plain` 회색 판 · `accent` secondaryContainer · `warn` 점선 경고색)과 그림 · 문구 키 */
export interface VaultFactChip {
  id: "items" | "master" | "nomaster" | "idle" | "idleoff";
  icon: string;
  label: Key;
  params?: Record<string, number>;
  /** 칩의 말풍선 — 짧은 글자가 못 다 하는 사실(위협 모델 문장) */
  title?: Key;
  look: "plain" | "accent" | "warn";
}

export interface VaultStateView {
  tone: VaultTone;
  /** 타일 그림 — 열림은 열린 자물쇠, 나머지는 닫힌 자물쇠(색만으로 가르지 않는다) */
  icon: "lock-open" | "lock";
  title: Key;
  note: Key;
  chips: VaultFactChip[];
}

/** 자동 잠금 칩 — 0 이면 "꺼짐 — 앱을 닫을 때까지 열림"(그때 잠그는 길은 가림막 단축키뿐이다) */
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

/**
 * 볼트 상태 → 상태 줄의 톤 · 그림 · 문구 · 칩. **위협 모델을 잃지 않는다**: 마스터 없음은 한 마디가 그 등급 문장
 * (`state.note.nomaster` — "이 PC 의 내 계정으로 로그인한 사람은 볼 수 있습니다")이고 칩도 경고색이다. 값은 없다(개수만).
 * 잠김은 들어가기 관문 때문에 요약에 거의 그려지지 않지만, 그 찰나에도 깨지지 않게 중립 톤 + 마스터 칩만 낸다.
 */
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
