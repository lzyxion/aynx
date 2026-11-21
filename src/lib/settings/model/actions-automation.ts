import { clampInt, cloneAllowRule, hasArgConstraints } from "$lib/settings-codec";
import type { AllowRule } from "./schema";
import {
  APPROVAL_TTL_MINUTES_MAX,
  APPROVAL_TTL_MINUTES_MIN,
  AUDIT_RETENTION_DAYS_MAX,
  AUDIT_RETENTION_DAYS_MIN,
  AUTO_MAX_CONCURRENCY_MAX,
  AUTO_MAX_CONCURRENCY_MIN,
  AUTO_MAX_TARGETS_MAX,
  AUTO_MAX_TARGETS_MIN,
} from "./options";
import { settings } from "./store.svelte.js";

// 관제판의 자동 승인 훅이 `settings.automationPrefs` 를 반응형으로 읽으므로 저장 전 미리보기에서도 곧바로 새 정책이 먹는다

export function setAutoApprove(on: boolean) {
  settings.current.automation.auto_approve = on;
}

/** 범위는 백엔드 하드 경계와 같다 */
export function setAutoMaxTargets(n: number) {
  const v = clampInt(n, AUTO_MAX_TARGETS_MIN, AUTO_MAX_TARGETS_MAX);
  if (v !== undefined) settings.current.automation.max_targets = v;
}

export function setAutoMaxConcurrency(n: number) {
  const v = clampInt(n, AUTO_MAX_CONCURRENCY_MIN, AUTO_MAX_CONCURRENCY_MAX);
  if (v !== undefined) settings.current.automation.max_concurrency = v;
}

/** `0` = 만료 없음 · 자동 승인 토글과 무관하게 수동 승인을 기다리는 작업안에도 건다 */
export function setApprovalTtlMinutes(n: number) {
  const v = clampInt(n, APPROVAL_TTL_MINUTES_MIN, APPROVAL_TTL_MINUTES_MAX);
  if (v !== undefined) settings.current.automation.approval_ttl_minutes = v;
}

export function setNotifyReviewRequests(on: boolean) {
  settings.current.automation.notify_review_requests = on;
}

export function setNotifyOperationResults(on: boolean) {
  settings.current.automation.notify_operation_results = on;
}

/** `0` = 지우지 않음 */
export function setAuditRetentionDays(n: number) {
  const v = clampInt(n, AUDIT_RETENTION_DAYS_MIN, AUDIT_RETENTION_DAYS_MAX);
  if (v !== undefined) settings.current.automation.audit_retention_days = v;
}

/** Rust 는 승인 시점에 디스크의 값을 읽으므로 저장한 뒤의 승인부터 먹는다 */
export function setAuditOutputExcerpt(on: boolean) {
  settings.current.automation.audit_output_excerpt = on;
}

/** 정책 칸이라 원격 웹에서는 저장이 거절된다(`remote/deny.rs` `settings_home_only`) */
export function setAllowPipes(on: boolean) {
  settings.current.automation.allow_pipes = on;
}

export function addAllowPattern(pattern: string): boolean {
  const t = pattern.trim();
  if (!t || settings.current.automation.allow_patterns.includes(t)) return false;
  settings.current.automation.allow_patterns = [
    ...settings.current.automation.allow_patterns,
    t,
  ];
  return true;
}

export function removeAllowPattern(index: number) {
  const list = settings.current.automation.allow_patterns;
  if (index < 0 || index >= list.length) return;
  settings.current.automation.allow_patterns = list.filter((_, i) => i !== index);
}

export function setAllowPattern(index: number, pattern: string): boolean {
  const list = settings.current.automation.allow_patterns;
  const t = pattern.trim();
  if (index < 0 || index >= list.length || !t) return false;
  if (list[index] === t) return false;
  if (list.some((p, i) => i !== index && p === t)) return false;
  settings.current.automation.allow_patterns = list.map((p, i) => (i === index ? t : p));
  return true;
}

/** 규칙은 화면이 이미 검증 · 변환한 것이다(`allow-rule-form.ts` `formToRule`) */
export function setAllowRule(index: number, rule: AllowRule): void {
  const list = settings.current.automation.allow;
  if (index < 0 || index >= list.length) return;
  settings.current.automation.allow = list.map((r, i) => (i === index ? cloneAllowRule(rule) : cloneAllowRule(r)));
}

export function addAllowRule(rule: AllowRule): number {
  const next = settings.current.automation.allow.map(cloneAllowRule);
  next.push(cloneAllowRule(rule));
  settings.current.automation.allow = next;
  return next.length - 1;
}

export function removeAllowRule(index: number): void {
  const list = settings.current.automation.allow;
  if (index < 0 || index >= list.length) return;
  settings.current.automation.allow = list.filter((_, i) => i !== index).map(cloneAllowRule);
}

/**
 * 켜는 것은 id 를 목록에 넣는 것뿐이다 — 규칙을 `allow` 에 복사하면 묶음 내용이 바뀌어도 옛 규칙으로 굳는다
 * (펼치기는 판정 시점에 `effectiveAllowRules` · Rust `effective_allow_rules` 가 한다).
 */
export function setBundleEnabled(id: string, on: boolean) {
  const cur = settings.current.automation.bundles;
  const has = cur.includes(id);
  if (on === has) return;
  settings.current.automation.bundles = on ? [...cur, id] : cur.filter((b) => b !== id);
}

/** `[automation.bundle_off]` 끄기는 좁히기만 한다 — 묶음이 켜져 있어도 그 명령은 사람 승인으로 간다 */
export function setBundleCommandEnabled(bundle: string, key: string, on: boolean) {
  const cur = settings.current.automation.bundle_off;
  const list = cur[bundle] ?? [];
  const has = list.includes(key);
  if (on === !has) return;
  const nextList = on ? list.filter((k) => k !== key) : [...list, key];
  const next = { ...cur };
  if (nextList.length > 0) next[bundle] = nextList;
  else delete next[bundle];
  settings.current.automation.bundle_off = next;
}

/**
 * 인자 제약 있는 규칙에는 합치지 않고 새 줄을 더한다 — 합치면 미리보기가 말하지 않은 제약이 붙거나 남는다.
 * `auto_approve` 는 여기서 절대 켜지 않는다 — 무인 실행을 켜는 길은 설정 화면의 토글 하나뿐이다.
 */
export function addAllowRules(rules: readonly AllowRule[]): number {
  let changed = 0;
  const next = settings.current.automation.allow.map(cloneAllowRule);
  for (const rule of rules) {
    const exec = rule.exec.trim();
    if (!exec) continue;
    const subs = rule.subcommands.map((s) => s.trim()).filter((s) => s !== "");
    const existing = next.find((r) => r.exec === exec && !hasArgConstraints(r));
    if (!existing) {
      next.push({ exec, subcommands: [...subs] });
      changed += 1;
      continue;
    }
    if (existing.subcommands.length === 0) continue;
    if (subs.length === 0) {
      existing.subcommands = []; // 넓힘 — 승인 카드 미리보기가 이미 말한 확장이다
      changed += 1;
      continue;
    }
    const missing = subs.filter((s) => !existing.subcommands.includes(s));
    if (missing.length === 0) continue;
    existing.subcommands = [...existing.subcommands, ...missing];
    changed += 1;
  }
  if (changed > 0) settings.current.automation.allow = next;
  return changed;
}
