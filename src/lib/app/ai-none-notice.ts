import { showNotice } from "$lib/app/notice";
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { openSettingsAt } from "$lib/app/overlays.svelte.js";
import type { AiCli } from "$lib/session";

export function noticeNoAiCli(detected: readonly AiCli[]): void {
  if (noneInstalled(detected)) {
    toast.info(t("app.ai.noneInstalled"), {
      ms: 10000,
      action: { label: t("app.ai.noneInstalled.open"), run: () => openSettingsAt("ai") },
    });
    return;
  }
  showNotice(t("app.ai.noneEnabled"));
}

/** 빈 목록은 감지 실패라 "안 깔림" 이 아니다 */
export function noneInstalled(detected: readonly AiCli[]): boolean {
  return detected.length > 0 && !detected.some((c) => c.installed);
}
