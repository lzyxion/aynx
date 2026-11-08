// 자동 승인 규칙의 **흐린 요약 글자** — 묶음 조정의 명령 줄(`AutomationBundles`)과 허용 패턴 편집의 규칙 줄·폼
// 미리보기(`AutomationAllow`)가 같은 문구를 쓴다 (docs/log/2026-10-05-auto-approve-args.md).
// 조각은 `policy.ts describeArgConstraints` 가 고르고, 여기서는 사전 문구로 그리기만 한다.
import { describeArgConstraints, type ArgConstraintPiece } from "$lib/policy";
import type { AllowRule } from "$lib/settings.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";

/** 목록이 이보다 길면 줄여 쓴다(`… 외 n개`) — title 용 전체 글자는 `full` 로. */
const LIST_MAX = 4;

/** 인자 제약 조각 하나의 문구. */
export function pieceText(p: ArgConstraintPiece, full: boolean): string {
  const items =
    full || p.items.length <= LIST_MAX
      ? p.items.join(" · ")
      : t("settings.automation.rule.more", {
          items: p.items.slice(0, LIST_MAX).join(" · "),
          n: p.items.length - LIST_MAX,
        });
  switch (p.kind) {
    case "first_arg":
      return t("settings.automation.rule.first_arg", { items });
    case "no_args":
      return t("settings.automation.rule.no_args");
    case "max_args":
      return t("settings.automation.rule.max_args", { n: p.items[0] });
    case "require":
      return t("settings.automation.rule.require", { items });
    case "allow":
      return t("settings.automation.rule.allow", { items });
    case "deny":
      return t("settings.automation.rule.deny", { items });
  }
}

/**
 * 규칙 하나의 제약 글자 — 하위 명령이 **여럿**이면 `a · b 만` 이 앞에 서고(하나면 이름 쪽에 붙인다 — `ruleName`),
 * 인자 제약 조각이 뒤따른다. 아무 제약도 없으면 빈 글자.
 */
export function ruleConstraintText(r: AllowRule, full: boolean): string {
  const parts: string[] = [];
  if (r.subcommands.length > 1) parts.push(t("settings.automation.rule.subs", { items: r.subcommands.join(" · ") }));
  for (const p of describeArgConstraints(r)) parts.push(pieceText(p, full));
  return parts.join(" · ");
}

/** 규칙의 이름 — exec, 하위 명령이 하나면 `exec sub`. */
export function ruleName(r: AllowRule): string {
  return r.subcommands.length === 1 ? `${r.exec} ${r.subcommands[0]}` : r.exec;
}
