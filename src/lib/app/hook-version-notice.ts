import type { PaneSpec } from "$lib/session";
import { createOnceGate, hookNoticeKey, hookOutdated, sentVersionOf } from "$lib/hook-version";
import { hookTargets, loadHookTargets } from "$lib/app/agent-hooks.svelte.js";
import { installRemoteHooksOn } from "$lib/app/remote-hooks";
import { liveSessionFor } from "$lib/app/remote-home.svelte.js";
import { sessionOf } from "$lib/app/sessions.svelte.js";
import { openSettingsAt } from "$lib/app/overlays.svelte.js";
import { agentAnchor } from "$lib/settings-index";
import { aiDisplayName } from "$lib/pane-icons";
import { t } from "$lib/i18n/i18n.svelte.js";
import { toast } from "$lib/toast.svelte.js";

/**
 * 옛 판 훅 알림 — 원격 훅 사본은 앱이 갈아 쓰지 않는다 (docs/log/2026-09-27-remote-hook-version.md).
 * 로컬에 옛 판이 오면 알아서 고치지 않고 설정으로 보낸다 — 훅 설정이 어느 사본을 가리킬지는 사용자가 고를 일이다.
 */

const once = createOnceGate();

/** 알림을 띄웠으면 `true`(하네스가 본다) */
export function noteHookVersion(pane: PaneSpec, kind: string | null, sent: unknown, latest: unknown): boolean {
  if (!kind || !hookOutdated(sent, latest)) return false;
  const remote = pane.kind === "ssh" ? (pane.alias?.trim() || null) : null;
  if (pane.kind === "ssh" && remote === null) return false;
  if (pane.kind !== "ssh" && pane.kind !== "local") return false;
  if (!once(hookNoticeKey({ remote }))) return false;
  const agent = aiDisplayName(kind) ?? kind;
  const from = sentVersionOf(sent);
  const params = {
    agent,
    from: from.orOlder ? t("app.hookVersion.orOlder", { n: from.n }) : `v${from.n}`,
    to: `v${latest as number}`,
  };
  const ms = 15000;
  if (remote !== null) {
    const paneId = pane.id;
    toast.info(t("app.hookVersion.remote", { ...params, alias: remote }), {
      ms,
      action: { label: t("app.hookVersion.reinstall"), run: () => void reinstallRemote(paneId, remote, kind) },
    });
  } else {
    toast.info(t("app.hookVersion.local", params), {
      ms,
      action: { label: t("app.hookVersion.openSettings"), run: () => openSettingsAt("ai", agentAnchor(kind, "hooks")) },
    });
  }
  return true;
}

async function reinstallRemote(paneId: string, alias: string, kind: string): Promise<void> {
  const id = sessionOf(paneId) ?? liveSessionFor(alias);
  if (id === null) {
    toast.info(t("app.projects.hooks.needSession"));
    return;
  }
  await loadHookTargets().catch(() => {});
  const target = hookTargets().find((x) => x.id === kind);
  if (!target) return;
  await installRemoteHooksOn(id, alias, target);
}
