import { displayCombo, effectiveCombo, type Overrides } from "$lib/keybindings";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 설정 화면이 쓰는 **조합 표기** — `Ctrl+Shift+T`, 안 걸렸으면 "(없음)".
 *
 * `keybindings.ts` 는 순수 모듈이라 화면 글자를 들지 않는다: [`displayCombo`] 는 안 걸린
 * 조합에 **빈 문자열**을 돌려주고, 그 빈 자리를 사전으로 채우는 것이 이 함수다
 * (docs/log/2026-09-17-i18n.md 의 "화면 글자는 여기 없다").
 *
 * 세 섹션(단축키·잠금·탭)이 같은 세 줄을 각자 적고 있었기에 여기 한 자리에 둔다.
 */
export function comboText(id: string, overrides: Overrides): string {
  const combo = effectiveCombo(id, overrides);
  return combo ? displayCombo(combo) : t("settings.keys.unbound");
}
