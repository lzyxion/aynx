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
 * **옛 판 훅 알림** (docs/log/2026-09-27-remote-hook-version.md).
 *
 * 훅 스크립트의 판을 올려도 **원격 사본은 그대로**다 — 로컬 사본은 앱이 뜰 때 Rust 가 갈아 쓰지만
 * (`agent_hooks::refresh_installed_script`) 서버의 `~/.config/aynx/hooks/aynx-agent-signal.sh` 는 아무도
 * 건드리지 않아, 대화 id 같은 새 칸이 조용히 빠진 채 신호가 온다. 5판부터 신호가 제 판을 싣고 Rust 가 이
 * 앱의 판을 곁들여 보내므로, 옛 판 신호가 오는 순간 그 호스트에 **한 번** 알린다:
 *
 * - 원격 타일 — "<별칭> 의 <에이전트> 훅이 옛 판입니다 (v4 이하 → v5)" + [다시 설치…] — 프로젝트 메뉴의
 *   "원격에 <에이전트> 훅 설치…" 와 **같은 몸통**([`installRemoteHooksOn`] — 같은 확인 창)을, 신호가 막
 *   온 그 타일의 세션으로 부른다.
 * - 로컬 타일 — 앱이 뜰 때 이미 갈아 썼는데도 옛 판이 왔다는 것은 훅 설정이 **다른 사본**(다른
 *   인스턴스 — 개발 빌드와 릴리스는 스크립트 폴더가 다르다)을 가리키거나 갈아 쓰기가 실패했다는 뜻이다.
 *   알아서 고치지 않고 설정 › AI 의 그 에이전트 훅 줄([설정 열기])로 보낸다 — 거기서 다시 설치하면 훅
 *   설정이 이 앱의 사본을 가리키게 되는데, 그것은 사용자가 고를 일이다.
 *
 * 한 앱 세션에 호스트마다 한 번(창마다 한 번 — 모듈이 창마다 산다). 닫든 설치하든 다시 권하지 않는다.
 */

const once = createOnceGate();

/**
 * 신호 하나의 판을 본다 — 알림을 띄웠으면 `true`(하네스가 본다). `kind` 는 그 타일의 에이전트
 * (`agentKindOf` — 부르는 쪽이 이미 가렸다), `sent`·`latest` 는 `agent-signal` 의 `hookVersion`·`hookLatest`.
 */
export function noteHookVersion(pane: PaneSpec, kind: string | null, sent: unknown, latest: unknown): boolean {
  if (!kind || !hookOutdated(sent, latest)) return false;
  const remote = pane.kind === "ssh" ? (pane.alias?.trim() || null) : null;
  if (pane.kind === "ssh" && remote === null) return false; // 이름 없는 원격 — 가리킬 호스트가 없다
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

/** [다시 설치…] — 그 타일의 세션(닫혔으면 같은 별칭의 다른 세션)으로 프로젝트 메뉴와 같은 설치 */
async function reinstallRemote(paneId: string, alias: string, kind: string): Promise<void> {
  const id = sessionOf(paneId) ?? liveSessionFor(alias);
  if (id === null) {
    toast.info(t("app.projects.hooks.needSession"));
    return;
  }
  await loadHookTargets().catch(() => {});
  const target = hookTargets().find((x) => x.id === kind);
  if (!target) return; // 이 빌드가 훅을 내놓지 않는 에이전트
  await installRemoteHooksOn(id, alias, target);
}
