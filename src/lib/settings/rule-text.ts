// 자동 승인 규칙의 흐린 요약 글자 — `AutomationBundles` · `AutomationAllow` 가 같은 문구를 쓴다.
import { describeArgConstraints, type ArgConstraintPiece } from "$lib/policy";
import type { AllowRule } from "$lib/settings.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";

const LIST_MAX = 4;

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

export function ruleConstraintText(r: AllowRule, full: boolean): string {
  const parts: string[] = [];
  if (r.subcommands.length > 1) parts.push(t("settings.automation.rule.subs", { items: r.subcommands.join(" · ") }));
  for (const p of describeArgConstraints(r)) parts.push(pieceText(p, full));
  return parts.join(" · ");
}

export function ruleName(r: AllowRule): string {
  return r.subcommands.length === 1 ? `${r.exec} ${r.subcommands[0]}` : r.exec;
}
