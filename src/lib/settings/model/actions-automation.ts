// 설정 화면 **자동 승인 정책** 편집 — 상한 · 만료 · 작업안 알림 · 감사 · allowlist · 묶음
// (`AutomationSection`, 관제판의 "승인하면서 배우기").
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

// ---------------------------------------------------------------------------
// 자동 승인 정책 편집 (설정 화면 — 단계 10b)
//
// 다른 setter 처럼 `settings.current` 만 바꾼다 — `applySettings` 는 부르지 않는다(DOM 토큰이
// 아니다). 관제판의 자동 승인 훅이 `settings.automationPrefs` 를 반응형으로 읽으므로 저장 전
// 미리보기에서도 곧바로 새 정책이 먹는다(트리거·단축키와 같은 즉시 반영).
// ---------------------------------------------------------------------------

/** 자동 승인 켬/끔. */
export function setAutoApprove(on: boolean) {
  settings.current.automation.auto_approve = on;
}

/** 대상 수 상한을 정한다 — 범위로 자른다(백엔드 하드 경계와 같은 범위). 비숫자는 무시. */
export function setAutoMaxTargets(n: number) {
  const v = clampInt(n, AUTO_MAX_TARGETS_MIN, AUTO_MAX_TARGETS_MAX);
  if (v !== undefined) settings.current.automation.max_targets = v;
}

/** 동시 실행 상한을 정한다 — 위와 같은 규칙. */
export function setAutoMaxConcurrency(n: number) {
  const v = clampInt(n, AUTO_MAX_CONCURRENCY_MIN, AUTO_MAX_CONCURRENCY_MAX);
  if (v !== undefined) settings.current.automation.max_concurrency = v;
}

/**
 * **검토 대기 만료**(분)를 정한다 — `0`(만료 없음)을 포함한 범위로 자른다. 비숫자는 무시.
 * 자동 승인 토글과 무관하게 먹는다(만료는 수동 승인을 기다리는 작업안에도 건다).
 */
export function setApprovalTtlMinutes(n: number) {
  const v = clampInt(n, APPROVAL_TTL_MINUTES_MIN, APPROVAL_TTL_MINUTES_MAX);
  if (v !== undefined) settings.current.automation.approval_ttl_minutes = v;
}

/**
 * **검토 요청 OS 알림** 켬/끔 — 창이 앞에 없을 때 승인 대기 작업안이 새로 들어오면 OS 알림
 * 한 줄이 나간다(docs/log/2026-09-22-review-notify.md). 자동 승인 토글과 무관하게 먹는다.
 *
 * 다음 갱신부터 곧바로 듣는다 — `app/pending-plans.svelte.ts` 가 `settings.current` 를 그
 * 자리에서 읽으므로 저장 전 미리보기에서도 바로 조용해진다.
 */
export function setNotifyReviewRequests(on: boolean) {
  settings.current.automation.notify_review_requests = on;
}

/**
 * **실행 결과 OS 알림** 켬/끔 — 창이 앞에 없을 때 작업안 실행이 끝나면 OS 알림 한 줄이 나간다
 * (docs/log/2026-09-28-run-result-notify.md). 토스트·알림 센터 기록은 이 칸과 무관하다.
 * `app/operation-notify.svelte.ts` 가 끝날 때마다 `settings.current` 를 그 자리에서 읽는다.
 */
export function setNotifyOperationResults(on: boolean) {
  settings.current.automation.notify_operation_results = on;
}

/**
 * **감사 로그 보관 일수**를 정한다 — `0`(지우지 않음)을 포함한 범위로 자른다. 비숫자는 무시.
 * 지우는 일은 Rust 쓰기 스레드가 한다(앱 시작 · 날짜가 바뀐 첫 쓰기 — docs/log/2026-09-28-run-history.md).
 */
export function setAuditRetentionDays(n: number) {
  const v = clampInt(n, AUDIT_RETENTION_DAYS_MIN, AUDIT_RETENTION_DAYS_MAX);
  if (v !== undefined) settings.current.automation.audit_retention_days = v;
}

/**
 * **실행 출력 발췌** 켬/끔 — 켜면 작업안 실행이 끝날 때 대상별 출력 꼬리가 감사 로그에 적힌다(기본 끔).
 * Rust 는 **승인 시점**에 디스크의 값을 읽으므로 저장한 뒤의 승인부터 먹는다.
 */
export function setAuditOutputExcerpt(on: boolean) {
  settings.current.automation.audit_output_excerpt = on;
}

/**
 * **파이프(`|`) 허용** 켬/끔(10-22 옵트인 · 기본 끔) — 켜면 파이프로 이은 명령도 단계마다 허용 범위면 자동 승인 후보가 된다.
 * 정책 칸이라 원격 웹에서는 저장이 거절된다(`remote/deny.rs` `settings_home_only`).
 */
export function setAllowPipes(on: boolean) {
  settings.current.automation.allow_pipes = on;
}

/**
 * allowlist 에 패턴을 하나 붙인다. 공백을 떼고, 비었거나 이미 있으면 안 넣는다.
 * 반환값은 실제로 들어갔는지 (입력 칸을 비울지 판단에 쓴다).
 */
export function addAllowPattern(pattern: string): boolean {
  const t = pattern.trim();
  if (!t || settings.current.automation.allow_patterns.includes(t)) return false;
  // 배열을 새로 만들어 확실히 반응시킨다 (트리거·단축키와 같은 이유).
  settings.current.automation.allow_patterns = [
    ...settings.current.automation.allow_patterns,
    t,
  ];
  return true;
}

/** allowlist 에서 한 항목을 지운다. */
export function removeAllowPattern(index: number) {
  const list = settings.current.automation.allow_patterns;
  if (index < 0 || index >= list.length) return;
  settings.current.automation.allow_patterns = list.filter((_, i) => i !== index);
}

/**
 * allowlist 의 한 항목을 바꾼다 — 허용 패턴 편집 화면이 쓴다. 공백을 떼고, 비었거나 **다른 자리에** 같은 패턴이
 * 있으면 안 바꾼다. 반환값은 바뀌었는지.
 */
export function setAllowPattern(index: number, pattern: string): boolean {
  const list = settings.current.automation.allow_patterns;
  const t = pattern.trim();
  if (index < 0 || index >= list.length || !t) return false;
  if (list[index] === t) return false;
  if (list.some((p, i) => i !== index && p === t)) return false;
  settings.current.automation.allow_patterns = list.map((p, i) => (i === index ? t : p));
  return true;
}

/**
 * 구조적 규칙(`[[automation.allow]]`) 하나를 그 자리에서 바꾼다 — 허용 패턴 편집 화면의 폼이 쓴다. 규칙은
 * 화면이 이미 검증·변환한 것(`allow-rule-form.ts formToRule`)이고, 여기서는 사본으로 바꿔 끼우기만 한다.
 */
export function setAllowRule(index: number, rule: AllowRule): void {
  const list = settings.current.automation.allow;
  if (index < 0 || index >= list.length) return;
  settings.current.automation.allow = list.map((r, i) => (i === index ? cloneAllowRule(rule) : cloneAllowRule(r)));
}

/** 구조적 규칙 하나를 끝에 붙이고 그 자리(index)를 돌려준다 — 편집 화면의 [추가]. 합치지 않는다(새 줄). */
export function addAllowRule(rule: AllowRule): number {
  const next = settings.current.automation.allow.map(cloneAllowRule);
  next.push(cloneAllowRule(rule));
  settings.current.automation.allow = next;
  return next.length - 1;
}

/** 구조적 규칙 하나를 지운다. */
export function removeAllowRule(index: number): void {
  const list = settings.current.automation.allow;
  if (index < 0 || index >= list.length) return;
  settings.current.automation.allow = list.filter((_, i) => i !== index).map(cloneAllowRule);
}

/**
 * 묶음 프리셋 하나를 켜고 끈다 (`[automation] bundles`).
 *
 * 켜는 것은 **id 를 목록에 넣는 것뿐**이다 — 규칙을 복사해 `allow` 에 붙이지 않는다. 그래야
 * 나중에 묶음 내용이 바뀌어도 사용자의 목록이 옛 규칙으로 굳지 않고, 끄면 정확히 되돌아온다
 * (펼치기는 판정 시점에 `effectiveAllowRules`·Rust `effective_allow_rules` 가 한다).
 */
export function setBundleEnabled(id: string, on: boolean) {
  const cur = settings.current.automation.bundles;
  const has = cur.includes(id);
  if (on === has) return;
  settings.current.automation.bundles = on ? [...cur, id] : cur.filter((b) => b !== id);
}

/**
 * 묶음 안의 명령 하나를 켜고 끈다 (`[automation.bundle_off]` — 키는 `commandKey`).
 *
 * 끄기는 **좁히기만** 한다 — 묶음이 켜져 있어도 그 명령은 사람 승인으로 간다. 묶음을 꺼도 끈 명령은
 * 남는다(다시 켜면 그대로). 다 켜면 그 묶음의 칸이 사라져 파일에 안 적힌다.
 */
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
 * 구조적 규칙들을 `[[automation.allow]]` 에 **합쳐 넣는다** — 관제판의 "승인하면서 배우기" 가
 * 쓴다(docs/log/2026-09-16-auto-approval-bundles.md). 실제로 바뀐 규칙 수를 돌려준다.
 *
 * 합치는 규칙(같은 `exec` 의 **인자 제약 없는** 규칙이 이미 있을 때 — 제약 있는 규칙에 합치면
 *   미리보기가 말하지 않은 제약이 새 서브커맨드에 붙거나, 넓힐 때 제약이 남아 말과 다르므로
 *   그런 규칙은 건드리지 않고 새 줄을 더한다):
 * - 기존이 **빈 목록**(= 서브커맨드 개념 없음, 이미 전부 열림)이면 **아무것도 하지 않는다**.
 * - 새 규칙이 **빈 목록**이면 기존을 빈 목록으로 **넓힌다**(그 exec 을 통째로 위임). 이 확장은
 *   승인 카드가 미리보기로 먼저 보여 준 것이다 — 조용히 넓히지 않는다.
 * - 둘 다 목록이 있으면 **없는 서브커맨드만 덧붙인다**.
 *
 * **`auto_approve` 는 여기서 절대 켜지 않는다.** 목록을 넓히는 것과 무인 실행을 켜는 것은
 * 다른 결정이고, 뒤쪽은 설정 화면의 토글 하나뿐이다.
 */
export function addAllowRules(rules: readonly AllowRule[]): number {
  let changed = 0;
  // 사본 위에서 합치고 마지막에 한 번만 대입한다(반응 한 번 · 중간 상태 없음).
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
    if (existing.subcommands.length === 0) continue; // 이미 exec 통째로 열려 있다.
    if (subs.length === 0) {
      existing.subcommands = []; // exec 전체로 넓힘 — 미리보기가 이미 말한 확장이다.
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
