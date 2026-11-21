import { listen } from "../ipc";
import { isShared } from "$lib/ai.svelte.js";
import type { PaneSpec } from "$lib/session";
import { refreshDbAi } from "$lib/app/db-ai.svelte.js";
import {
  aiHostAlias,
  listDelegationTargets,
  removeDelegationTargets,
  setDelegationTarget,
  stageAtLeast,
  stageNeedsConfirm,
  stageOf,
  withStage,
  type AiStage,
  type DelegationGrants,
  type DelegationTargetView,
} from "$lib/delegation";
import { confirmApproveAll } from "./approve-all-confirm";

/**
 * `delegation.toml` 위임의 사본 — 읽는 자리(호스트 목록 표식 · 제거 확인 문구)가 동기라 쥔다.
 * 이 표가 원격 타일의 AI 권한을 정한다 — 다른 창에서 바꾼 단계는 `delegation-changed` 방송으로 따라온다.
 * 키는 소문자 별칭이다(ssh config 의 비교가 그렇다).
 */

let targets = $state<Map<string, DelegationGrants>>(new Map());

/** 위 표와 한 번의 `invoke` 에서 나와야 한다 — 따로 읽으면 방금 지운 줄이 화면에 남는다 */
let views = $state<DelegationTargetView[]>([]);

/** 없으면 빈 표다 — 위임은 명시로만 생긴다 */
export function delegations(): ReadonlyMap<string, DelegationGrants> {
  return targets;
}

export function delegationGrantsOf(alias: string): DelegationGrants | null {
  return targets.get(alias.trim().toLowerCase()) ?? null;
}

export function delegationTargetViews(): readonly DelegationTargetView[] {
  return views;
}

/** 별칭이 `~/.ssh/config` 에 없는 줄 — `=== false` 로 못 박는다: 옛 백엔드는 칸을 안 보내고 그때는 고아가 아니어야 한다 */
export function orphanDelegationTargets(): DelegationTargetView[] {
  return views.filter((v) => v.alias_known === false);
}

export async function refreshDelegationTargets(): Promise<void> {
  const list = await listDelegationTargets();
  const next = new Map<string, DelegationGrants>();
  for (const t of list) {
    const key = t.alias.trim().toLowerCase();
    if (key === "") continue;
    next.set(key, {
      connect: t.connect,
      read: t.read,
      propose: t.propose,
      auto_execute: t.auto_execute,
      approve_all: t.approve_all ?? false,
      vault_passphrase: t.vault_passphrase,
    });
  }
  targets = next;
  views = list;
}

/** 오류는 던진다 — 사람이 누른 일이라 조용히 실패하면 안 된다 */
export async function removeDelegation(alias: string): Promise<void> {
  await removeDelegationTargets([alias]);
  await refreshDelegationTargets();
}

export function listenDelegationChanged(): Promise<() => void> {
  return listen("delegation-changed", () => {
    void refreshDelegationTargets();
    // DB 연결의 AI 권한(같은 파일 `[[database]]`)도 같은 방송으로 온다
    void refreshDbAi();
  });
}

// ── AI 권한 단계 — 원격 세션의 권한 = 호스트 하나의 단계 ──

export function hostAiStage(alias: string): AiStage {
  return stageOf(delegationGrantsOf(alias));
}

/** 로컬 타일은 `null`(단계가 없다 · 읽기 허용 하나다) · 호스트 목록에 없는 원격 타일(빠른 접속)은 `off` 고정이다 */
export function paneAiStage(pane: { kind: string; alias?: string; adhoc?: unknown }): AiStage | null {
  if (pane.kind !== "ssh") return null;
  const alias = aiHostAlias(pane);
  return alias === null ? "off" : hostAiStage(alias);
}

/**
 * 서버로 거울을 밀어 올릴지(프라이버시 쓰기 게이트)를 정하는 판정 하나다.
 * 원격은 호스트 단계가 `read` 이상(타일의 `opted_in` 은 원격에서 뜻이 없다) · 로컬은 타일별 "AI 읽기 허용"(셸 · AI CLI 타일 같은 규칙).
 */
export function paneAiReadable(pane: PaneSpec): boolean {
  const stage = paneAiStage(pane);
  if (stage !== null) return stageAtLeast(stage, "read");
  return isShared(pane.id);
}

/** 모두 승인으로 새로 올리면 확인 상자가 먼저 선다 — [취소]면 아무것도 바꾸지 않는다 */
export async function setHostAiStage(alias: string, stage: AiStage): Promise<void> {
  if (stageNeedsConfirm(hostAiStage(alias), stage) && !(await confirmApproveAll("host", alias))) return;
  await setDelegationTarget(alias, withStage(delegationGrantsOf(alias), stage));
  await refreshDelegationTargets();
}

/** 단계가 `approve` 아래면 켜지지 않는다 · 끄면 볼트 암호구도 함께 꺼진다 */
export async function setHostHeadlessConnect(alias: string, on: boolean): Promise<void> {
  const cur = delegationGrantsOf(alias);
  const stage = stageOf(cur);
  const base = withStage(cur, stage);
  await setDelegationTarget(alias, { ...base, connect: on, vault_passphrase: on && base.vault_passphrase });
  await refreshDelegationTargets();
}
