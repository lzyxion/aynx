// 자동 승인 **허용 패턴 편집** 화면의 폼 ↔ 규칙 변환 · 입력 검증 · 안전 판정 — 순수 함수만
// (docs/log/2026-10-05-auto-approve-args.md "허용 패턴 편집"). 화면은 `settings/AutomationAllow.svelte`.
//
// 규칙의 의미는 Rust `settings.rs AllowRule` · 판정 `policy.rs` 가 정한다. 여기서 지키는 것은 둘이다:
// 1. **옛 모양 규칙은 몰래 바뀌지 않는다** — 사용자가 손대지 않은 칸은 불러온 규칙(`base`)의 값을 글자 그대로
//    돌려준다(`formToRule`). `sub_first` 를 안 적은 옛 규칙은 폼에서도 꺼진 채로 보이고, 그대로 두면 그대로다.
// 2. **틀린 값은 쓰지 않는다** — 검증(`validateForm`)에 걸리면 화면이 규칙을 초안에 쓰지 않는다. 검증 규칙은
//    Rust `sanitize`(공백 떼기 · 빈 exec 버림)와 판정(`deny_pattern_ok` — 형식 틀린 금지는 규칙째 꺼진다)이
//    조용히 하던 일을 칸 아래 한 줄로 미리 말하는 것이다.
import type { AllowRule } from "./schema";

/** 폼의 칸들 — 목록 칸은 쉼표·공백으로 나눈 글자, `max_args` 는 빈칸 = 제한 없음. */
export interface AllowRuleForm {
  exec: string;
  subcommands: string;
  sub_first: boolean;
  first_arg: string;
  max_args: string;
  deny_flags: string;
  allow_flags: string;
  require_flags: string;
}

/** 목록 칸 — 폼 글자 ↔ 문자열 목록. */
export const FORM_LIST_FIELDS = ["subcommands", "first_arg", "deny_flags", "allow_flags", "require_flags"] as const;
type ListField = (typeof FORM_LIST_FIELDS)[number];

/** 인자 수 상한의 화면 상한 — Rust 는 `u32` 지만 그 이상은 뜻이 없다(그리고 넘치면 파일을 못 읽는다). */
export const MAX_ARGS_LIMIT = 999;

/** 글자 → 목록: 쉼표·공백(ASCII 공백 — 셸 낱말 경계와 같다)으로 나누고 빈 조각은 버린다. 순서·중복은 그대로. */
export function splitList(text: string): string[] {
  return text.split(/[,\s]+/).filter((s) => s !== "");
}

/** 목록 → 글자: `, ` 로 잇는다. */
export function joinList(list: readonly string[] | undefined): string {
  return (list ?? []).join(", ");
}

/** 새 규칙의 빈 폼 — **하위 명령은 바로 다음 낱말**(안전한 쪽)이 기본이다. */
export function emptyForm(): AllowRuleForm {
  return {
    exec: "",
    subcommands: "",
    sub_first: true,
    first_arg: "",
    max_args: "",
    deny_flags: "",
    allow_flags: "",
    require_flags: "",
  };
}

/** 규칙 → 폼. 옛 규칙(`sub_first` 없음)은 그 칸이 꺼진 채로 보인다 — 지금 의미 그대로. */
export function ruleToForm(rule: AllowRule): AllowRuleForm {
  return {
    exec: rule.exec,
    subcommands: joinList(rule.subcommands),
    sub_first: rule.sub_first === true,
    first_arg: joinList(rule.first_arg),
    max_args: rule.max_args === undefined ? "" : String(rule.max_args),
    deny_flags: joinList(rule.deny_flags),
    allow_flags: joinList(rule.allow_flags),
    require_flags: joinList(rule.require_flags),
  };
}

/**
 * 폼 → 규칙. 검증을 통과한 폼에만 부른다(아니면 결과의 뜻은 보장하지 않는다).
 *
 * `base`(편집을 시작할 때 불러온 규칙)가 있으면 **글자가 그대로인 칸은 base 의 값을 그대로** 쓴다 — 손으로 적은
 * 파일의 항목(쉼표·공백이 든 낱말 등)이 폼을 한 번 지난다고 바뀌지 않게. 빈 목록 칸은 싣지 않는다(옛 모양 왕복).
 *
 * `sub_first` 는 체크돼 있고 하위 명령이 있을 때만 싣는다 — 하위 명령이 없으면 아무것도 막지 않는 칸이라 새 규칙에
 * 지어 넣지 않는다. 단 base 가 이미 그 칸을 갖고 있었으면(손으로 적은 파일) 체크가 남아 있는 한 그대로 둔다.
 */
export function formToRule(form: AllowRuleForm, base?: AllowRule | null): AllowRule {
  const list = (f: ListField): string[] => {
    const baseList = base?.[f];
    if (base && form[f] === joinList(baseList)) return [...(baseList ?? [])];
    return splitList(form[f]);
  };
  const rule: AllowRule = { exec: form.exec.trim(), subcommands: list("subcommands") };
  for (const f of ["deny_flags", "allow_flags", "require_flags", "first_arg"] as const) {
    const l = list(f);
    if (l.length > 0) rule[f] = l;
  }
  const maxText = form.max_args.trim();
  if (base && form.max_args === (base.max_args === undefined ? "" : String(base.max_args))) {
    if (base.max_args !== undefined) rule.max_args = base.max_args;
  } else if (maxText !== "") {
    const n = Number(maxText);
    if (Number.isInteger(n) && n >= 0) rule.max_args = n;
  }
  if (form.sub_first && (rule.subcommands.length > 0 || base?.sub_first === true)) rule.sub_first = true;
  return rule;
}

/** 칸 하나의 오류 — 화면이 `code` 로 문구를 고르고 `item` 을 끼운다. */
export interface FieldError {
  code:
    | "exec_empty"
    | "exec_space"
    | "exec_slash"
    | "sub_flag"
    | "bad_deny"
    | "not_flag"
    | "max_args";
  item?: string;
}

export type FormErrors = Partial<Record<keyof AllowRuleForm, FieldError>>;

/**
 * `deny_flags` 항목의 형식이 맞는가 — `-` 로 시작하고 `*` 는 끝에만. **`policy.ts denyPatternOk` · Rust
 * `deny_pattern_ok` 와 같은 규칙**이다(틀린 항목이 하나라도 있으면 판정이 그 규칙을 통째로 끈다).
 */
export function denyItemOk(item: string): boolean {
  const stem = item.endsWith("*") ? item.slice(0, -1) : item;
  return item.startsWith("-") && !stem.includes("*");
}

/**
 * 폼 검증 — 오류가 있는 칸만 담는다(빈 객체 = 통과).
 *
 * - exec: 비면 안 됨(Rust `sanitize` 가 버린다) · 공백 안 됨 · `/` 안 됨 — 판정은 명령 첫 낱말의 **basename** 과
 *   비교하므로 둘 다 영영 맞지 않는다.
 * - 하위 명령: `-` 로 시작하면 안 됨 — 하위 명령은 첫 **비플래그** 낱말이라 영영 맞지 않는다.
 * - 금지 플래그: [`denyItemOk`].
 * - 허용·필수 플래그: `-` 로 시작해야 — 아니면 허용은 아무것도 안 열고, 필수는 규칙을 영영 막는다.
 * - 인자 수 상한: 빈칸이거나 0–[`MAX_ARGS_LIMIT`] 정수.
 */
export function validateForm(form: AllowRuleForm): FormErrors {
  const err: FormErrors = {};
  const exec = form.exec.trim();
  if (exec === "") err.exec = { code: "exec_empty" };
  else if (/\s/.test(exec)) err.exec = { code: "exec_space" };
  else if (exec.includes("/")) err.exec = { code: "exec_slash" };
  const badSub = splitList(form.subcommands).find((s) => s.startsWith("-"));
  if (badSub !== undefined) err.subcommands = { code: "sub_flag", item: badSub };
  const badDeny = splitList(form.deny_flags).find((s) => !denyItemOk(s));
  if (badDeny !== undefined) err.deny_flags = { code: "bad_deny", item: badDeny };
  for (const f of ["allow_flags", "require_flags"] as const) {
    const bad = splitList(form[f]).find((s) => !s.startsWith("-"));
    if (bad !== undefined) err[f] = { code: "not_flag", item: bad };
  }
  const max = form.max_args.trim();
  if (max !== "" && !(/^\d+$/.test(max) && Number(max) <= MAX_ARGS_LIMIT)) err.max_args = { code: "max_args" };
  return err;
}

/** 오류가 하나라도 있는가. */
export function hasErrors(err: FormErrors): boolean {
  return Object.keys(err).length > 0;
}

/**
 * 규칙이 **인자와 상관없이 exec 전부**를 여는가 — 하위 명령도, 인자를 좁히는 칸(금지·허용·필수 플래그 · 다음
 * 낱말 · 인자 수)도 없다. 저장은 되지만 화면이 경고 한 줄을 단다. (`sub_first` 는 하위 명령이 없으면 아무것도 막지
 * 않으므로 보지 않는다.)
 */
export function isWideRule(rule: AllowRule): boolean {
  return (
    rule.subcommands.length === 0 &&
    (rule.deny_flags?.length ?? 0) === 0 &&
    (rule.allow_flags?.length ?? 0) === 0 &&
    (rule.require_flags?.length ?? 0) === 0 &&
    (rule.first_arg?.length ?? 0) === 0 &&
    rule.max_args === undefined
  );
}

/** 간단 패턴(문자열 접두) 검증 — 비면 안 되고, 다른 자리에 같은 패턴이 있으면 안 된다. */
export function validatePattern(text: string, others: readonly string[]): "empty" | "duplicate" | null {
  const t = text.trim();
  if (t === "") return "empty";
  if (others.includes(t)) return "duplicate";
  return null;
}
