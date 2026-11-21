/**
 * 상태바 선두단에 서는 칸들 — 지금 표는 비어 있다(칸은 전부 독으로 들어갔다). 표 · 순서 규칙 · 저장은 칸이 다시 늘 때를 위해 둔다.
 * 순수 모듈이다 — vitest 가 `.svelte` 를 들이지 못해 목록 · 순서 규칙의 시험은 여기서만 돈다.
 */

// 사전을 부르지 않고 키만 든다 — 이 모듈은 순수하게 남아야 한다
import type { Key } from "$lib/i18n/keys";

export type StatusItemKind = "toggle" | "action";

export interface StatusItem {
  /** `aynx:status-order` 에 글자 그대로 남는 저장 키다 — 바꾸지 않는다 */
  id: string;
  kind: StatusItemKind;
  /** `keybindings.ts` 의 `ACTIONS` 와 같은 글자여야 한다 — 틀리면 눌러도 아무 일이 없다 */
  action: string;
  /** 툴팁에 조합을 적을 액션들 — 없으면 `[action]` 하나 */
  tipActions?: readonly string[];
  /** `ui-icons.generated.ts` 의 키 — 표를 고칠 때 `scripts/gen-ui-icons.mjs` 의 `WANTED` 를 함께 본다 */
  icon: string;
  labelKey: Key;
}

export const STATUS_ITEMS: readonly StatusItem[] = [];

/** 걷힌 칸의 옛 id — `applyOrder` 가 모르는 id 로 버린다. 되살릴 때 같은 글자를 쓰지 않는다("폐기 id 는 재사용하지 않는다", docs/conventions.md) */
export const RETIRED_STATUS_IDS: readonly string[] = [
  "new-shell",
  "open-localfs",
  "command-palette",
  "folder-conversations",
  "open-sessions",
  "open-plans",
  "orchestration-start",
  "open-settings",
  "open-dock",
];

/** 합쳐서 없어진 칸의 옛 id → 물려받은 칸의 id. 옛 저장 순서를 접는다(셋이 다 있으면 첫째가 있던 자리) */
const MERGED_INTO: Readonly<Record<string, string | readonly string[]>> = {
  "open-hosts": "open-dock",
  "open-projects": "open-dock",
  "open-layouts": "open-dock",
};

export const DEFAULT_STATUS_ORDER: readonly string[] = STATUS_ITEMS.map((i) => i.id);

/** 모르는 id 는 버리고, 빠진 id 는 기본 순서대로 뒤에 붙인다 — 새 칸이 순서를 바꿔 둔 사람에게도 보이게. 중복은 앞의 것이 이긴다 */
export function applyOrder(
  savedIds: readonly string[] | null | undefined,
  defaults: readonly StatusItem[] = STATUS_ITEMS,
): readonly StatusItem[] {
  if (!savedIds || savedIds.length === 0) return defaults;
  const byId = new Map(defaults.map((i) => [i.id, i]));
  const out: StatusItem[] = [];
  const seen = new Set<string>();
  for (const raw of savedIds) {
    const merged = MERGED_INTO[raw] ?? raw;
    for (const id of typeof merged === "string" ? [merged] : merged) {
      const item = byId.get(id);
      if (!item || seen.has(id)) continue;
      seen.add(id);
      out.push(item);
    }
  }
  for (const item of defaults) {
    if (!seen.has(item.id)) out.push(item);
  }
  return out;
}

/** `toId` 앞으로(`null` 이면 맨 뒤) — 탭 스트립과 같은 계약. 바뀐 게 없으면 같은 배열을 돌려준다(호출부가 `===` 로 본다) */
export function reorder(
  list: readonly StatusItem[],
  fromId: string,
  toId: string | null,
): readonly StatusItem[] {
  if (fromId === toId) return list;
  const from = list.findIndex((i) => i.id === fromId);
  if (from < 0) return list;
  if (toId !== null && !list.some((i) => i.id === toId)) return list;
  const rest = list.filter((i) => i.id !== fromId);
  const at = toId === null ? rest.length : rest.findIndex((i) => i.id === toId);
  const next = [...rest.slice(0, at), list[from], ...rest.slice(at)];
  const same = next.every((item, i) => item.id === list[i]?.id);
  return same ? list : next;
}

/** throw 하지 않는다. 있는 칸인지는 묻지 않는다 — 그 판정은 `applyOrder` 한 곳에만 둔다 */
export function parseStatusOrder(raw: string | null | undefined): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: string[] = [];
  for (const item of data) {
    if (typeof item !== "string") continue;
    const id = item.trim();
    if (id === "" || out.includes(id)) continue;
    out.push(id);
  }
  return out;
}

export function serializeStatusOrder(ids: readonly string[]): string {
  return JSON.stringify([...ids]);
}

export function shortcutTitle(name: string, combo: string | null | undefined): string {
  return combo ? `${name} (${combo})` : name;
}

/**
 * 수식 키가 같은 것은 끝 키만 `/` 로 잇는다 — `["Ctrl+Shift+H", "Ctrl+Shift+J"]` → `"Ctrl+Shift+H/J"`. 무리는 공백 한 칸으로
 * 이어 저마다 칩이 된다(`tooltip.ts` 의 괄호 해석은 낱말 셋까지 받는다). 비었으면 `null`.
 */
export function mergeCombos(combos: readonly string[]): string | null {
  const groups = mergeComboGroups(combos);
  return groups.length === 0 ? null : groups.join(" ");
}

/** 수식 키가 없거나 끝 키에 `/` · 공백이 든 조합(`Ctrl+/` · `Num 1`)은 접으면 읽을 수 없어 접지 않는다 */
export function mergeComboGroups(combos: readonly string[], joiner = "/"): string[] {
  const groups: { prefix: string; keys: string[] }[] = [];
  for (const combo of combos) {
    if (!combo) continue;
    const cut = combo.lastIndexOf("+", combo.length - 2);
    const prefix = cut > 0 ? combo.slice(0, cut + 1) : "";
    const key = combo.slice(prefix.length);
    const mergeable = prefix !== "" && !/[/\s]/.test(key);
    const group = mergeable ? groups.find((g) => g.prefix === prefix && g.keys.length > 0) : undefined;
    if (group) group.keys.push(key);
    else groups.push(mergeable ? { prefix, keys: [key] } : { prefix: combo, keys: [] });
  }
  return groups.map((g) => g.prefix + g.keys.join(joiner));
}
