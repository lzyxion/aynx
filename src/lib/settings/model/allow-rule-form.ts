// 자동 승인 허용 패턴 편집 폼 ↔ 규칙 변환 · 검증. 규칙의 의미는 Rust `settings.rs` `AllowRule` · 판정 `policy.rs` 가 정한다.
// 1. 옛 모양 규칙은 몰래 바뀌지 않는다 — 손대지 않은 칸은 불러온 규칙(`base`)의 값을 글자 그대로 돌려준다(`formToRule`).
// 2. 틀린 값은 쓰지 않는다 — 검증(`validateForm`)에 걸리면 화면이 규칙을 초안에 쓰지 않는다.
import type { AllowRule } from "./schema";

/** 목록 칸은 쉼표 · 공백으로 나눈 글자, `max_args` 는 빈칸 = 제한 없음 */
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

export const FORM_LIST_FIELDS = ["subcommands", "first_arg", "deny_flags", "allow_flags", "require_flags"] as const;
type ListField = (typeof FORM_LIST_FIELDS)[number];

/** Rust 는 `u32` 지만 그 이상은 뜻이 없다(넘치면 파일을 못 읽는다) */
export const MAX_ARGS_LIMIT = 999;

/** ASCII 공백으로 나눈다 — 셸 낱말 경계와 같다 */
export function splitList(text: string): string[] {
  return text.split(/[,\s]+/).filter((s) => s !== "");
}

export function joinList(list: readonly string[] | undefined): string {
  return (list ?? []).join(", ");
}

/** 하위 명령은 바로 다음 낱말(안전한 쪽)이 기본이다 */
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

/** 옛 규칙(`sub_first` 없음)은 그 칸이 꺼진 채로 보인다 — 지금 의미 그대로 */
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
 * 검증을 통과한 폼에만 부른다. 글자가 그대로인 칸은 `base` 의 값을 그대로 쓴다 — 손으로 적은 항목이 폼을 지난다고 바뀌지 않게.
 * `sub_first` 는 하위 명령이 없으면 아무것도 막지 않는 칸이라 새 규칙에 지어 넣지 않는다(base 가 이미 가졌으면 둔다).
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

/** `policy.ts` `denyPatternOk` · Rust `deny_pattern_ok` 와 같은 규칙 — 틀린 항목이 하나라도 있으면 판정이 그 규칙을 통째로 끈다 */
export function denyItemOk(item: string): boolean {
  const stem = item.endsWith("*") ? item.slice(0, -1) : item;
  return item.startsWith("-") && !stem.includes("*");
}

/**
 * exec 의 공백 · `/` 는 판정이 첫 낱말의 basename 과 비교해 영영 맞지 않는다. `-` 로 시작하는 하위 명령도 영영 맞지 않는다.
 * 허용 · 필수 플래그가 `-` 로 시작하지 않으면 허용은 아무것도 안 열고, 필수는 규칙을 영영 막는다.
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

export function hasErrors(err: FormErrors): boolean {
  return Object.keys(err).length > 0;
}

/** 인자와 상관없이 exec 전부를 여는 규칙 — 저장은 되지만 화면이 경고를 단다(`sub_first` 는 하위 명령이 없으면 막는 것이 없어 보지 않는다) */
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

export function validatePattern(text: string, others: readonly string[]): "empty" | "duplicate" | null {
  const t = text.trim();
  if (t === "") return "empty";
  if (others.includes(t)) return "duplicate";
  return null;
}
