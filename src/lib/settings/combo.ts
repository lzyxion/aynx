import { displayCombo, effectiveCombo, type Overrides } from "$lib/keybindings";
import { t } from "$lib/i18n/i18n.svelte.js";

/** 안 걸린 조합(`displayCombo` 의 빈 문자열)을 사전 글자로 채운다 — `keybindings.ts` 는 화면 글자를 들지 않는다 */
export function comboText(id: string, overrides: Overrides): string {
  const combo = effectiveCombo(id, overrides);
  return combo ? displayCombo(combo) : t("settings.keys.unbound");
}
