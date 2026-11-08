/**
 * 단축키 도움말(`CheatSheet.svelte`)의 **칩 만들기** — 순수 함수만 둔다
 * (docs/log/2026-09-28-cheatsheet-cleanup.md).
 *
 * 한 줄의 오른쪽은 칩 여럿이다. 칩 하나가 **조합 하나**이고(`·` 로 이어 한 칩에 담지 않는다),
 * 종류가 둘이다: 키보드 조합은 단축키 알약(`Keys.svelte` — 조합 하나가 알약 하나, 2026-10-28), 마우스 몸짓은 클릭이면 마우스 아이콘 칩(`우클릭` · `헤더 우클릭` 의 클릭 부분 —
 * `keycaps.ts` 의 `splitMouseGesture`). 클릭이 아닌 몸짓(끌기 등)은 지금 없다 — 들어오면 칩 없이 흐린 글자로 선다(10-28 옅은 칩 걷기).
 *
 * 조합 글자는 언제나 레지스트리의 **지금 걸린 값**(`effectiveCombo`)을 `displayCombo` 로 읽은
 * 것이라 사용자 오버라이드가 그대로 보인다 — 여기서는 그 글자를 받아 칩으로 나누고 접기만 한다.
 */
import { displayCombo } from "$lib/keybindings";
import { mergeComboGroups } from "$lib/status-items";

export type ChipKind = "key" | "mouse";

export interface Chip {
  text: string;
  kind: ChipKind;
}

/** 단축키 칩 하나 (고정 키 — `Ctrl+D` · `F2` …) */
export const keyChip = (text: string): Chip => ({ text, kind: "key" });

/** 마우스 몸짓 칩 하나 */
export const mouseChip = (text: string): Chip => ({ text, kind: "mouse" });

/**
 * 조합 여럿(내부 코드 문자열 — `effectiveCombo` 의 결과) → 단축키 칩들.
 *
 * - `merge` 가 없으면 조합마다 칩 하나 (`Ctrl+F` `Ctrl+Shift+F`).
 * - `merge` 가 있으면 **수식 키가 같은 것끼리** 끝 키만 그 글자로 이어 한 칩에 접는다
 *   (`mergeComboGroups` — 상태바 독 툴팁과 같은 규칙): 방향키 넷은 `""` 로 `Alt+←→↑↓`,
 *   독 셋은 `"/"` 로 `Ctrl+Shift+H/J/K`. 사용자가 하나만 다른 수식 키로 옮겼으면 그것은
 *   따로 선다 — 접는 순간 화면이 거짓말을 하면 안 된다.
 *
 * 모르는 id(`null`)는 조용히 빠진다. 하나도 안 남으면 `null` — 그 줄은 목록에서 빠진다.
 */
export function comboChips(
  combos: readonly (string | null | undefined)[],
  merge?: string,
): Chip[] | null {
  const shown = combos.filter((c): c is string => !!c).map((c) => displayCombo(c));
  if (shown.length === 0) return null;
  const texts = merge === undefined ? shown : mergeComboGroups(shown, merge);
  return texts.map(keyChip);
}

/**
 * `Alt+1`…`Alt+9` 아홉 줄을 칩 하나로. 아홉 개를 다 접으면 `Alt+123456789` 가 되어 안
 * 읽히므로, **첫 줄의 수식 키**만 빌려 `Alt+1…9` 로 적는다.
 */
export function nthChip(firstCombo: string | null | undefined): Chip[] | null {
  if (!firstCombo) return null;
  const parts = firstCombo.split("+");
  const mod = parts.slice(0, -1).join("+");
  return [keyChip(mod ? `${displayCombo(mod)}+1…9` : "1…9")];
}
