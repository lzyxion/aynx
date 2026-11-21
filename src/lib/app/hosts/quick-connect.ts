// 빠른 접속 (docs/log/2026-09-16-quick-connect-and-host-keys.md)
import { toast } from "$lib/toast.svelte.js";
import { t } from "$lib/i18n/i18n.svelte.js";
import { openPaneHere } from "$lib/app/tabs.svelte.js";
import { newAdhocSshPane, type PaneSpec } from "$lib/session";
import type { QuickConnectTarget } from "$lib/quick-connect";
import { hostForm } from "./form-model.svelte.js";
import { openAdd } from "./form.svelte.js";

export function quickConnect(target: QuickConnectTarget): void {
  openPaneHere(newAdhocSshPane(target));
}

/** 재연결마다 새 세션 id 로 다시 지나므로, 없으면 네트워크가 흔들릴 때마다 같은 토스트가 뜬다 */
const adhocOffered = new Set<string>();

export function offerSaveAdhocHost(pane: PaneSpec): void {
  if (!pane.adhoc || adhocOffered.has(pane.id)) return;
  adhocOffered.add(pane.id);
  const target = pane.adhoc;
  toast.info(t("files.host.adhoc.connected", { target: pane.alias ?? target.host }), {
    action: {
      label: t("files.host.adhoc.save"),
      run: () => openAddFromTarget(target),
    },
  });
}

/** 이미 있는 별칭이면 백엔드가 거절하고 폼이 그 문구를 띄운다 */
export function openAddFromTarget(target: QuickConnectTarget): void {
  openAdd();
  hostForm.name = target.host;
  hostForm.hostName = target.host;
  hostForm.user = target.user ?? "";
  hostForm.port = target.port ?? null;
}
