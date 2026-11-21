import { askHookInstall } from "$lib/app/confirm-dialog.svelte.js";
import { agentHooksRemoteStatus, setAgentHooksRemote, type AgentHooksTarget } from "$lib/context";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { toast } from "$lib/toast.svelte.js";

/** 원격 훅 설치 — 무엇을 쓸지 보여 주는 확인 창을 거치지 않고는 쓰지 않는다(docs/log/2026-09-24-remote-agent-signals.md) */
export async function installRemoteHooksOn(id: number, alias: string, target: AgentHooksTarget): Promise<boolean> {
  const fail = (e: unknown) =>
    showNotice(t("app.projects.hooks.failed", { reason: stripReason(e instanceof Error ? e.message : String(e)) }));
  let st;
  try {
    st = await agentHooksRemoteStatus(id, target.id);
  } catch (e) {
    fail(e);
    return false;
  }
  if (st.error) {
    fail(st.error);
    return false;
  }
  let go = false;
  try {
    go = await askHookInstall(target.display, {
      remote: alias,
      scriptPath: st.scriptPath,
      settingsPath: st.settingsPath,
      preview: st.preview,
    });
  } catch {
    return false;
  }
  if (!go) return false;
  try {
    await setAgentHooksRemote(id, target.id, true);
    const done = t("app.projects.hooks.done.install", { alias, agent: target.display });
    toast.success(
      target.needsTrustNote ? `${done} ${t("settings.ai.hooks.trust", { agent: target.display })}` : done,
    );
    return true;
  } catch (e) {
    fail(e);
    return false;
  }
}
