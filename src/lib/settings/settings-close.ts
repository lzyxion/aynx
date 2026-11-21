/**
 * 설정 [저장] · 닫기의 순서 — 순수(저장 · 반영 · 묻기 · 되돌림은 주입한다) (docs/log/2026-10-22-settings-close-asks-save.md).
 * 곧바로 저장하는 다른 길(프로필 적용 · 모드 전환)은 `saveAndReflect` 를 지나지 않는다.
 */

/** `askChoice` 와 같은 글자(`Yes` = 저장 · `No` = 저장 안 함 · `Cancel` = 물림) */
export type CloseAnswer = "Yes" | "No" | "Cancel";

export interface SaveAndReflectDeps {
  write: () => Promise<boolean>;
  /** 고른 프로필이 있고 지금 모양이 그와 다르면 그 id, 아니면 `null` */
  modifiedProfile: () => Promise<string | null>;
  reflect: (id: string) => void;
}

export async function saveAndReflect(d: SaveAndReflectDeps): Promise<boolean> {
  if (!(await d.write())) return false;
  const id = await d.modifiedProfile();
  if (id !== null) d.reflect(id);
  return true;
}

export interface SettingsCloseDeps {
  dirty: () => boolean;
  ask: () => Promise<CloseAnswer>;
  save: () => Promise<boolean>;
  /** 설정 [취소] 와 같은 되돌림(닫기는 빼고) */
  revert: () => void;
}

/** 참이면 부른 쪽이 닫는다 */
export async function settleSettingsClose(d: SettingsCloseDeps): Promise<boolean> {
  if (!d.dirty()) return true;
  const answer = await d.ask();
  if (answer === "Cancel") return false;
  if (answer === "Yes") return d.save();
  d.revert();
  return true;
}
