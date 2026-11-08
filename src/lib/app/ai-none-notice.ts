import { showNotice } from "$lib/app/notice";
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { openSettingsAt } from "$lib/app/overlays.svelte.js";
import type { AiCli } from "$lib/session";

/**
 * **열 AI CLI 가 없을 때의 한 줄**(2026-11-03) — Ctrl+Shift+A · 새 AI 타일 단축키가 함께 쓴다.
 *
 * - 감지는 됐는데 하나도 안 깔렸다 → "설치된 AI CLI 가 없습니다" + [설치 방법 보기](설정 › AI 에이전트 — 거기 [설치 방법 ↗])
 * - 깔린 것은 있는데 모두 껐다 → 예전 그대로 "사용 중인 AI 에이전트가 없습니다"
 */
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

/** 감지는 됐는데(빈 목록 = 감지 실패는 아니다) 하나도 안 깔렸다 */
export function noneInstalled(detected: readonly AiCli[]): boolean {
  return detected.length > 0 && !detected.some((c) => c.installed);
}
