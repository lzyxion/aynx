/**
 * AI 권한(`~/.aynx/delegation.toml`)의 프런트 통로와 단계 규칙.
 *
 * 원격(SSH) 세션의 권한은 호스트 별칭 하나의 블록이다 — 같은 호스트의 창 타일 · 헤드리스 세션이 같은 단계를 따른다.
 * 저장 형식은 불리언 그대로이고 판정이 누적이다 — 옛 파일의 비누적 조합도 [`stageOf`] 로 읽힌다(마이그레이션 없음).
 * 적는 길은 사람의 손(호스트 폼 · 타일 권한 팝오버 → Tauri 명령)뿐이다 — MCP 에는 대응하는 도구가 없다.
 * 신원 스냅샷(어느 서버인가)은 Rust 가 저장 순간 계산하고 검사한다 — 프런트가 쥐면 신원 그물이 사용자 입력이 된다.
 */

import { invoke } from "./ipc";
import type { Key } from "$lib/i18n/keys";

/**
 * Rust `DelegationGrants` 와 1:1 (snake_case 그대로).
 * `vault_passphrase` 는 이 호스트의 헤드리스 접속에만 볼트의 키 암호구를 쓴다 — 비밀번호는 여전히 아니다.
 */
export interface DelegationGrants {
  connect: boolean;
  read: boolean;
  propose: boolean;
  auto_execute: boolean;
  /** 모두 승인 — 그래도 전체 스위치 `[automation] auto_approve` 와 caps 는 본다. 옛 백엔드는 이 칸을 안 보낸다(= 끔) */
  approve_all?: boolean;
  vault_passphrase: boolean;
}

export interface DelegationTargetView extends DelegationGrants {
  alias: string;
  client: string;
  /**
   * 거짓이면 고아 위임(별칭이 `~/.ssh/config` 에 없음). 설정을 못 읽었으면 전부 참 · 옛 백엔드는 안 보낸다 —
   * 판정은 언제나 `=== false` (`console/delegation-rows.ts` 와 같은 규칙).
   */
  alias_known?: boolean;
}

export function noGrants(): DelegationGrants {
  return { connect: false, read: false, propose: false, auto_execute: false, approve_all: false, vault_passphrase: false };
}

export function anyGrant(g: DelegationGrants): boolean {
  return g.connect || g.read || g.propose || g.auto_execute || !!g.approve_all || g.vault_passphrase;
}

export function sameGrants(a: DelegationGrants, b: DelegationGrants): boolean {
  return (
    a.connect === b.connect &&
    a.read === b.read &&
    a.propose === b.propose &&
    a.auto_execute === b.auto_execute &&
    !!a.approve_all === !!b.approve_all &&
    a.vault_passphrase === b.vault_passphrase
  );
}

/** 단계를 내리면 접속이 켜진 채 남을 수 있어 저장은 이 함수를 지난다 (Rust `set_target` 이 같은 규칙으로 한 번 더 접는다) */
export function withDependencies(g: DelegationGrants): DelegationGrants {
  const read = g.read;
  const propose = read && g.propose;
  const connect = propose && g.connect;
  const auto_execute = propose && g.auto_execute;
  return {
    connect,
    read,
    propose,
    auto_execute,
    approve_all: auto_execute && !!g.approve_all,
    vault_passphrase: connect && g.vault_passphrase,
  };
}

// ── AI 권한 단계 ──

export type AiStage = "off" | "read" | "approve" | "auto" | "all";

export const AI_STAGES = ["off", "read", "approve", "auto", "all"] as const satisfies readonly AiStage[];

export const AI_STAGE_NAME: Readonly<Record<AiStage, Key>> = {
  off: "app.ai.stage.off",
  read: "app.ai.stage.read",
  approve: "app.ai.stage.approve",
  auto: "app.ai.stage.auto",
  all: "app.ai.stage.all",
};

export const AI_STAGE_DESC: Readonly<Record<AiStage, Key>> = {
  off: "app.ai.stage.off.desc",
  read: "app.ai.stage.read.desc",
  approve: "app.ai.stage.approve.desc",
  auto: "app.ai.stage.auto.desc",
  all: "app.ai.stage.all.desc",
};

export function stageNeedsConfirm(from: AiStage, to: AiStage): boolean {
  return to === "all" && from !== "all";
}

/** `read` 없이 `propose` 만 켜진 옛 블록은 `off` 다 — Rust 판정과 같은 결론이라 화면이 실제보다 넓게 말하지 않는다 */
export function stageOf(g: DelegationGrants | null | undefined): AiStage {
  if (!g || !g.read) return "off";
  if (!g.propose) return "read";
  if (!g.auto_execute) return "approve";
  return g.approve_all ? "all" : "auto";
}

export function stageAtLeast(a: AiStage, b: AiStage): boolean {
  return AI_STAGES.indexOf(a) >= AI_STAGES.indexOf(b);
}

/** `client` 는 이 모양에 없다 — Rust 가 블록의 모르는 키를 그대로 둔다 */
export function withStage(g: DelegationGrants | null | undefined, stage: AiStage): DelegationGrants {
  const base = g ?? noGrants();
  return withDependencies({
    connect: base.connect,
    vault_passphrase: base.vault_passphrase,
    read: stageAtLeast(stage, "read"),
    propose: stageAtLeast(stage, "approve"),
    auto_execute: stageAtLeast(stage, "auto"),
    approve_all: stage === "all",
  });
}

export function grantSummary(g: DelegationGrants, tr: (key: Key) => string): string {
  const parts = [tr(AI_STAGE_NAME[stageOf(g)])];
  const dep = withDependencies(g);
  if (dep.connect) parts.push(tr("app.ai.headless"));
  if (dep.vault_passphrase) parts.push(tr("app.ai.vault"));
  return parts.join(" · ");
}

/**
 * 빠른 접속(`adhoc`)의 `alias` 는 화면 이름이라 블록이 설 자리가 없다 — 그 타일의 권한은 `off` 고정.
 * 이 값이 곧 `report_session` 의 `hostAlias` 다(Rust 가 이 별칭으로 권한을 읽는다).
 */
export function aiHostAlias(pane: { kind: string; alias?: string; adhoc?: unknown }): string | null {
  if (pane.kind !== "ssh" || pane.adhoc) return null;
  const alias = pane.alias?.trim() ?? "";
  return alias === "" ? null : alias;
}

/** 실패는 삼킨다 — 위임 표식 하나 때문에 호스트 목록이 무너지면 안 된다 */
export async function listDelegationTargets(): Promise<DelegationTargetView[]> {
  try {
    return (await invoke<DelegationTargetView[]>("delegation_list_targets")) ?? [];
  } catch {
    return [];
  }
}

/** 모두 꺼져 있으면 블록을 지운다. 사람이 시킨 일이라 여기만 오류를 던진다 */
export function setDelegationTarget(alias: string, grants: DelegationGrants): Promise<void> {
  return invoke<void>("delegation_set_target", { alias, grants: withDependencies(grants) });
}

export function renameDelegationTarget(from: string, to: string): Promise<boolean> {
  return invoke<boolean>("delegation_rename_target", { from, to });
}

export function removeDelegationTargets(aliases: readonly string[]): Promise<number> {
  return invoke<number>("delegation_remove_targets", { aliases: [...aliases] });
}
