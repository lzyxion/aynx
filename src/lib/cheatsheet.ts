/** 칩 하나가 조합 하나다 — `·` 로 이어 한 칩에 담지 않는다 */
import { displayCombo } from "$lib/keybindings";
import { mergeComboGroups } from "$lib/status-items";

export type ChipKind = "key" | "mouse";

export interface Chip {
  text: string;
  kind: ChipKind;
}

export const keyChip = (text: string): Chip => ({ text, kind: "key" });

export const mouseChip = (text: string): Chip => ({ text, kind: "mouse" });

/** 사용자가 하나만 다른 수식 키로 옮겼으면 그것은 따로 선다 — 접는 순간 화면이 거짓말을 하면 안 된다. 하나도 안 남으면 `null`(그 줄이 빠진다) */
export function comboChips(
  combos: readonly (string | null | undefined)[],
  merge?: string,
): Chip[] | null {
  const shown = combos.filter((c): c is string => !!c).map((c) => displayCombo(c));
  if (shown.length === 0) return null;
  const texts = merge === undefined ? shown : mergeComboGroups(shown, merge);
  return texts.map(keyChip);
}

/** 첫 줄의 수식 키만 빌려 `Alt+1…9` 로 적는다 — 아홉을 다 접으면 `Alt+123456789` 라 안 읽힌다 */
export function nthChip(firstCombo: string | null | undefined): Chip[] | null {
  if (!firstCombo) return null;
  const parts = firstCombo.split("+");
  const mod = parts.slice(0, -1).join("+");
  return [keyChip(mod ? `${displayCombo(mod)}+1…9` : "1…9")];
}
