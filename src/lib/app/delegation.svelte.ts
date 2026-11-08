import { listen } from "../ipc";
import { isShared } from "$lib/ai.svelte.js";
import { paneAi } from "$lib/app/titles.svelte.js";
import type { PaneSpec } from "$lib/session";
import { refreshDbAi } from "$lib/app/db-ai.svelte.js";
import {
  aiHostAlias,
  listDelegationTargets,
  removeDelegationTargets,
  setDelegationTarget,
  stageAtLeast,
  stageNeedsConfirm,
  stageOf,
  withStage,
  type AiStage,
  type DelegationGrants,
  type DelegationTargetView,
} from "$lib/delegation";
import { confirmApproveAll } from "./approve-all-confirm";

/**
 * **앱이 들고 있는 위임 사본** — `~/.aynx/delegation.toml` 의 "어느 호스트에 무엇을 위임했는가" 를
 * 별칭 → 권한 넷의 표 하나로 쥔다 (docs/log/2026-09-21-fleet-delegation-ui.md).
 *
 * 사본이 필요한 이유는 **읽는 자리가 동기**이기 때문이다: 호스트 목록의 줄 끝 표식은 그리는
 * 순간 답을 내야 하고, 제거 확인 대화상자의 "위임 2" 도 대화상자를 띄우기 전에 세어야
 * 한다. 줄마다 `invoke` 를 던지면 목록이 한 번 그려질 때마다 왕복이 수십 번이다.
 *
 * 갱신은 **호스트 목록을 다시 읽는 그 자리**([`refreshHosts`])와 Rust 의 **`delegation-changed`**
 * 방송([`listenDelegationChanged`] — 세 쓰기 명령이 성공할 때마다 모든 창에 온다)이다. 2026-10-07 부터
 * 이 표가 **원격 타일의 AI 권한**을 정하므로(아래 [`paneAiReadable`]) 다른 창에서 바꾼 단계도 곧바로
 * 따라와야 한다 — 그 방송이 그 길이다. 에디터로 파일을 직접 고치면 여전히 다음 재로드에서 맞춰진다.
 *
 * 키는 **소문자 별칭**이다 (`aliasKey` 와 같은 규칙 — ssh config 의 비교가 그렇다).
 */

let targets = $state<Map<string, DelegationGrants>>(new Map());

/**
 * **같은 읽기의 줄 목록** — 설정 › 보안의 `AI 위임 호스트` 표와 부팅 알림이 읽는다
 * (docs/log/2026-09-21-fleet-delegation-ui.md).
 *
 * 위의 표(별칭 → 권한)와 **한 번의 `invoke` 에서** 나온다. 목록을 따로 읽는 함수를 두면
 * 두 사본이 서로 다른 시각의 파일을 가리키게 되고, 위임을 지운 직후가 정확히 그 자리다
 * (표는 새로 읽었는데 줄 목록은 옛것 → 방금 지운 줄이 화면에 남는다).
 */
let views = $state<DelegationTargetView[]>([]);

/** 지금 위임 표 (별칭 소문자 → 권한 넷). 없으면 빈 표다 — 위임은 명시로만 생긴다 */
export function delegations(): ReadonlyMap<string, DelegationGrants> {
  return targets;
}

/** 이 별칭에 위임된 권한 (없으면 `null`) */
export function delegationGrantsOf(alias: string): DelegationGrants | null {
  return targets.get(alias.trim().toLowerCase()) ?? null;
}

/** 위임 줄 전부 — 파일에 적힌 순서 그대로 (설정의 표가 그린다) */
export function delegationTargetViews(): readonly DelegationTargetView[] {
  return views;
}

/**
 * **고아 위임** — 별칭이 `~/.ssh/config` 에 없어 영영 붙지 않는 줄들.
 *
 * `=== false` 로 못 박는다: 옛 백엔드는 이 칸을 아예 안 보내고(`undefined`), 그때는 아무것도
 * 고아가 아니어야 한다 (`console/delegation-rows.ts` 의 같은 칸과 같은 규칙).
 */
export function orphanDelegationTargets(): DelegationTargetView[] {
  return views.filter((v) => v.alias_known === false);
}

/**
 * 표를 다시 읽는다. 실패는 `listDelegationTargets` 가 빈 목록으로 삼키므로 여기서 갈래가 하나다
 * (위임 표식이 잠깐 없는 것과 목록이 안 뜨는 것은 무게가 다르다).
 *
 * 퓨처를 **돌려준다** — 대부분의 부르는 자리는 기다리지 않지만(표식 하나가 한 박자 늦게
 * 뜨는 것과 부팅이 늦어지는 것은 무게가 다르다), 부팅의 고아 알림은 읽기가 끝나야 셀 수 있다.
 */
export async function refreshDelegationTargets(): Promise<void> {
  const list = await listDelegationTargets();
  const next = new Map<string, DelegationGrants>();
  for (const t of list) {
    const key = t.alias.trim().toLowerCase();
    if (key === "") continue;
    next.set(key, {
      connect: t.connect,
      read: t.read,
      propose: t.propose,
      auto_execute: t.auto_execute,
      approve_all: t.approve_all ?? false,
      vault_passphrase: t.vault_passphrase,
    });
  }
  targets = next; // 통째로 갈아 끼운다 — 읽는 쪽이 `$derived` 하나로 따라온다
  views = list;
}

/**
 * 위임 한 줄을 **지운다** — 설정 › 보안의 표에서 [제거]를 누른 자리.
 *
 * 지우고 나서 표를 다시 읽는 것이 요점이다: 이 사본을 읽는 자리가 셋(호스트 목록 표식 ·
 * 제거 확인 문구 · 이 표)이라, 하나만 손으로 고치면 나머지 둘이 옛 값을 계속 보인다.
 *
 * 오류는 **던진다** — 사람이 누른 일이라 조용히 실패하면 안 된다(부르는 쪽이 한 줄로 말한다).
 */
export async function removeDelegation(alias: string): Promise<void> {
  await removeDelegationTargets([alias]);
  await refreshDelegationTargets();
}

/**
 * **`delegation-changed` 를 듣는다** — 어느 창에서든 권한이 바뀌면(호스트 폼 · 머리줄 팝오버 · 설정의
 * [제거]) Rust 가 모든 창에 알리고, 이 창은 표를 다시 읽는다. 원격 타일의 읽기 허용·머리줄 칩이 이
 * 표 하나를 따르므로 그 둘이 함께 맞춰진다. 부팅(`app/boot.svelte.ts`)이 창마다 건다.
 */
export function listenDelegationChanged(): Promise<() => void> {
  return listen("delegation-changed", () => {
    void refreshDelegationTargets();
    // DB 연결의 AI 권한(쿼리 타일 3a — 같은 파일 `[[database]]`)도 같은 방송으로 온다.
    void refreshDbAi();
    // 저장소 맡기기(`[[repo]]`) · 구성 묶음(오케스트레이션 3차 1단계)도 같은 방송이다.
  });
}

// ---------------------------------------------------------------------------
// AI 권한 단계 (2026-10-07 — 원격 세션의 권한 = 호스트 하나의 단계)
// ---------------------------------------------------------------------------

/** 이 별칭의 AI 권한 단계 (블록이 없으면 `off`) — 누적 규칙은 `$lib/delegation` 의 `stageOf` */
export function hostAiStage(alias: string): AiStage {
  return stageOf(delegationGrantsOf(alias));
}

/**
 * 이 타일의 **원격 AI 권한 단계** — 원격 타일이 아니면 `null`(로컬 타일은 단계가 없다 · 읽기 허용
 * 하나다). 호스트 목록에 없는 원격 타일(빠른 접속)은 **`off` 고정**이다.
 */
export function paneAiStage(pane: { kind: string; alias?: string; adhoc?: unknown }): AiStage | null {
  if (pane.kind !== "ssh") return null;
  const alias = aiHostAlias(pane);
  return alias === null ? "off" : hostAiStage(alias);
}

/**
 * 이 타일이 **AI 에게 보이는가** — 서버로 거울을 밀어 올릴지(프라이버시 쓰기 게이트)를 정하는 판정
 * 하나다(`Terminal.svelte` · 머리줄 · 대시보드 · 블록 넘기기가 함께 읽는다).
 *
 * - 원격: 호스트 단계가 `read` 이상. 타일의 `opted_in` 토글은 원격에서 뜻이 없다(Rust 도 그 값을 안 본다).
 * - 로컬: 타일별 "AI 읽기 허용"(`ai.svelte.ts`) 그대로 — **단 로컬 AI CLI 타일(Claude · Codex 가 도는 타일 — `paneAi`)은 늘 `false`**
 *   (10-23 사용자 결정: AI 타일에는 AI 읽기 권한이 아예 없다 — 칩 · ⋯ 메뉴 줄도 없고 켜져 있던 값은 `Terminal.svelte` 가 끈다).
 */
export function paneAiReadable(pane: PaneSpec): boolean {
  const stage = paneAiStage(pane);
  if (stage !== null) return stageAtLeast(stage, "read");
  return isShared(pane.id) && !localAiTile(pane);
}

/** 로컬 AI CLI 타일인가(10-23 — AI 읽기 권한이 없는 타일). 판정은 탭 점 · 머리줄과 같은 `paneAi` 한 벌. 반응형 */
export function localAiTile(pane: PaneSpec): boolean {
  return pane.kind === "local" && paneAi(pane) !== null;
}

/**
 * 머리줄 팝오버에서 단계를 고른다 — **곧바로 저장한다**(`delegation_set_target`). 헤드리스 묶음은
 * 지키되 의존을 접고(`withStage`), 저장 뒤 표를 다시 읽는다(방송도 오지만 이 창은 기다리지 않는다).
 * 오류는 던진다 — 사람이 누른 일이다. **모두 승인으로 새로 올리면 확인 상자가 먼저 선다**(`confirmApproveAll` — [취소]면 아무것도
 * 바꾸지 않는다).
 */
export async function setHostAiStage(alias: string, stage: AiStage): Promise<void> {
  if (stageNeedsConfirm(hostAiStage(alias), stage) && !(await confirmApproveAll("host", alias))) return;
  await setDelegationTarget(alias, withStage(delegationGrantsOf(alias), stage));
  await refreshDelegationTargets();
}

/**
 * 머리줄 팝오버의 "헤드리스 접속" 토글 — 단계가 `approve` 아래면 켜지지 않는다(`withDependencies`).
 * 끄면 볼트 암호구도 함께 꺼진다.
 */
export async function setHostHeadlessConnect(alias: string, on: boolean): Promise<void> {
  const cur = delegationGrantsOf(alias);
  const stage = stageOf(cur);
  const base = withStage(cur, stage);
  await setDelegationTarget(alias, { ...base, connect: on, vault_passphrase: on && base.vault_passphrase });
  await refreshDelegationTargets();
}
