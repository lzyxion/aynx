import { askHookInstall } from "$lib/app/confirm-dialog.svelte.js";
import { agentHooksRemoteStatus, setAgentHooksRemote, type AgentHooksTarget } from "$lib/context";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { toast } from "$lib/toast.svelte.js";

/**
 * **원격에 <에이전트> 훅 설치** 의 몸통 — 살아 있는 세션 `id` 로(docs/log/2026-09-24-remote-agent-signals.md
 * "원격 훅 설치"). 부르는 곳은 둘이다: 원격 프로젝트 메뉴(`projects.svelte.ts` 의 `installRemoteHooks` —
 * 그 별칭의 세션을 찾아 온다)와 옛 판 훅 알림의 [다시 설치…](`hook-version-notice.ts` — 신호가 막 온 그
 * 타일의 세션 · docs/log/2026-09-27-remote-hook-version.md). 두 길이 **같은 확인 창**을 지난다.
 *
 * 먼저 서버의 설정을 읽어 **무엇을 쓸지 그대로 보여 주는** 확인 창을 띄운다(로컬 설치와 같은 `askHookInstall` —
 * 제목 옆에 "원격: <별칭>" 칩이 붙는다). 서버 설정이 깨진 JSON 이면 확인 창 없이 그 까닭 한 줄로 끝난다(Rust 도
 * 쓰지 않는다). 확인 창을 못 띄우면 쓰지 않는다. 설치 뒤 그 CLI 안의 승인이 필요한 에이전트(Codex
 * `/hooks`)면 완료 알림에 그 한 줄을 붙인다. 돌려주는 값은 설치했는가.
 */
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
