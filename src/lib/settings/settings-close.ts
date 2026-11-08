/**
 * **설정 [저장] · 닫기의 순서** — 저장하면 고른 테마 프로필에도 지금 모양을 반영하고, 닫기는 [취소] 와 같되 미저장 변경이 있으면 먼저
 * 저장할지 묻는다 (docs/log/2026-10-22-settings-close-asks-save.md). 순수 — 저장 · 반영 · 묻기 · 되돌림은 주입한다(시험).
 * 배선은 `SettingsModal.svelte`, 닫히는 길의 문은 `app/dock.svelte.ts` 의 `setSettingsLeaveGuard`.
 *
 * ## 저장 — [`saveAndReflect`]
 *
 * 묻지 않는다. 설정을 파일에 쓰고, **성공했고** 고른 프로필이 있고 지금 모양이 그와 다르면 그 프로필을 지금 모양으로 덮어쓴다(알림 한 줄).
 * 저장이 실패하면 반영하지 않는다. 프로필이 없거나 같으면 반영도 알림도 없다. [저장] 단추와 닫기 물음의 [저장] 이 같은 길이다.
 * 곧바로 저장하는 다른 길(프로필 적용 · 모드 전환)은 이 함수를 지나지 않는다.
 *
 * ## 닫기 — [`settleSettingsClose`]
 *
 * | 상태 | 답 | 결과 |
 * | --- | --- | --- |
 * | 미저장 변경 없음 | — | 닫는다 |
 * | 있음 | [저장] | 위의 저장(프로필 반영 포함) — 성공이면 닫고, 실패면 닫지 않는다(오류는 화면에) |
 * | 있음 | [저장 안 함] | [취소] 와 같은 되돌림 뒤 닫는다 |
 * | 있음 | 물림(Escape · 바깥 누르기 · [계속 편집]) | 닫지 않는다 — 편집을 잃지 않게 |
 */

/** 묻기의 답 — `askChoice` 와 같은 글자(`Yes` = 저장 · `No` = 저장 안 함 · `Cancel` = 물림) */
export type CloseAnswer = "Yes" | "No" | "Cancel";

export interface SaveAndReflectDeps {
  /** 설정 파일에 쓴다 — 성공했는가 */
  write: () => Promise<boolean>;
  /** 고른 프로필이 있고 지금 모양이 그와 다르면 그 id, 아니면 `null` */
  modifiedProfile: () => Promise<string | null>;
  /** 그 프로필을 지금 모양으로 덮어쓴다(알림은 이쪽) */
  reflect: (id: string) => void;
}

/** 저장하고, 성공했으면 고른 프로필에도 반영한다 — 저장했는가 */
export async function saveAndReflect(d: SaveAndReflectDeps): Promise<boolean> {
  if (!(await d.write())) return false;
  const id = await d.modifiedProfile();
  if (id !== null) d.reflect(id);
  return true;
}

export interface SettingsCloseDeps {
  dirty: () => boolean;
  ask: () => Promise<CloseAnswer>;
  /** [`saveAndReflect`] — 성공했는가 */
  save: () => Promise<boolean>;
  /** 설정 [취소] 와 같은 되돌림(닫기는 빼고) */
  revert: () => void;
}

/** 닫아도 되는가 — 참이면 부른 쪽이 닫는다 */
export async function settleSettingsClose(d: SettingsCloseDeps): Promise<boolean> {
  if (!d.dirty()) return true;
  const answer = await d.ask();
  if (answer === "Cancel") return false;
  if (answer === "Yes") return d.save();
  d.revert();
  return true;
}
