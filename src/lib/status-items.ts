/**
 * **상태바 선두단에 서는 칸들** — 무엇이 서는가 · 어떤 순서인가 · 그 순서를 어떻게
 * 바꾸는가 (docs/log/2026-09-15-start-page-favorites.md ·
 * docs/log/2026-09-15-lucide-ui-icons.md).
 *
 * 이 표는 예전 `start-shortcuts.ts`(시작 화면의 아이콘 네 칸) → `status-actions.ts`(상태바로
 * 내려온 액션 셋)의 자리를 물려받은 것이다. 그 넷은 **빈 탭에서만** 닿는 자리에 있었다 —
 * 무언가를 하나라도 열면 사라지는 화면이라, 정작 "새 터미널을 하나 더" 가 필요한 순간에는
 * 없었다. 그래서 늘 보이는 띠(상태바)로 옮겼고, 이제 **토글 셋까지 한 목록**이다.
 *
 * ## 왜 토글과 액션을 한 목록으로 묶었나
 *
 * 두 종류는 **뜻이 다르다**: 토글(독·세션·작업안)은 떠 있는 표면을 여닫으므로
 * "열림" 불이 들어오고(`data-chrome-toggle`), 액션(새 터미널·로컬 파일·명령 팔레트)은 한 번
 * 하고 마는 일이라 불이 없다. 예전에는 그 차이를 **구분선 하나**로 말하며 토글 셋을 앞에,
 * 액션 셋을 뒤에 세웠다.
 *
 * 그 줄세우기를 버린다 — 사람이 그 띠에서 찾는 순서는 "토글이냐 액션이냐" 가 아니라
 * **얼마나 자주 쓰느냐**이기 때문이다. 기본 순서(아래)는 새 터미널 → 독 → 로컬 파일 →
 * 명령 팔레트 → 지난 대화 → 세션 → 작업안이고, 그러면 두 종류가 섞이므로 구분선은 뜻을 잃는다(지웠다). 종류의
 * 차이는 **불이 들어오느냐**로 이미 눈에 보인다.
 *
 * **호스트 · 프로젝트 · 레이아웃 세 칸은 독 칸 하나로 합쳤다** (2026-09-25 —
 * docs/log/2026-09-25-unified-dock.md). 셋이 한 면(런처 독)의 세 칸이 되면서 입구도 하나다:
 * 누르면 **마지막으로 쓴 칸**이 열리고, 칸 고르기는 독 안의 칸 막대와 H · J · K 가 한다.
 * 옛 저장값의 세 id 는 [`applyOrder`] 가 이 칸 하나로 접는다(첫째가 있던 자리에 선다).
 *
 * **설정은 이 목록에 없다** (2026-09-25 — docs/log/2026-09-25-notification-center.md 덧붙임).
 * 설정 토글은 하단 중앙 독(`FloatingStatusDock` — 워크스페이스 칸 → 파일시스템 → 설정)의 **맨 끝**에
 * 늘 선다(`StatusBar.svelte`, `data-signal="settings"`) — "늘 거기 있는 입구" 이고, 끌어서
 * 옮기는 순서에는 들지 않는다. (후미 묶음에는 앱 전체 상태 — ⚡ 자동 승인 · 볼트 · 🔔 알림 —
 * 만 선다: docs/log/2026-10-05-statusbar-trim.md.) 옛 저장값에 남은
 * `open-settings` 는 [`applyOrder`] 가 모르는 id 로 버린다.
 *
 * **2026-10-18 통합 독 — 메뉴 칸은 전부 독으로 들어갔다.** 새 터미널 · 로컬 파일 · 명령 팔레트 · 지난 대화 · 세션 · 작업안 ·
 * 오케스트레이션 칸(과 `>_` 셸 메뉴 · 알림 종 팝오버 · 하단 호버 독의 설정)은 독(`Dock.svelte`)의 아이콘 줄 · 실행 단추 · 알림
 * 칸이 맡는다. 같은 날 실기 뒤 **독 입구(`open-dock`)까지 걷어 이 표는 비었다**(독은 창 가장자리 호버 · 단축키 · 팔레트 · 알림
 * 배지로 연다). 그래서 위의 이야기(토글 · 액션 · 기본 순서)는 그 칸들이 섰던 때의
 * 기록이다. 같은 동작의 단축키 · 팔레트 · 단축키 도움말은 그대로다(띠의 칸만 사라졌다). 옛 저장값의 걷힌 id 는
 * [`applyOrder`] 가 모르는 id 로 **조용히 버린다**([`RETIRED_STATUS_IDS`] — 빈자리도, 되살아난 칸도 없다). 순서 바꾸기 틀
 * ([`reorder`] · 끌기 · `Alt+←/→`)은 칸이 다시 늘 때를 위해 그대로 둔다.
 *
 * 게다가 이 순서는 이제 **고정이 아니다** — 사람이 끌어서 바꾸고 그 결과가
 * `aynx:status-order` 에 남는다 ([`reorder`]·[`applyOrder`]·`status-order.svelte.ts`).
 * 그래서 "무엇이 먼저냐" 는 여기 적힌 기본값 하나로 충분하다.
 *
 * ## 아이콘은 이름 하나다 (2026-09-15)
 *
 * 예전에는 칸마다 **글자 기호**(`⌨ ▣ ⌕ ⚙ ▤`)이거나 **손으로 딴 SVG path**(`FOLDER_D`·
 * `LAYOUT_D`)였고, 그리는 쪽이 둘 중 무엇이냐를 갈라야 했다. 일곱이 한 줄에 서면 굵기·크기·
 * 광학 중심이 제각각이라 눈에 띄게 어긋났고, 글자 기호 쪽은 **글꼴이 바뀌면 모양도 바뀐다**.
 *
 * 그래서 [`StatusItem.icon`] 은 이제 **아이콘 이름 하나**다 (`ui-icons.generated.ts` 의 키).
 * 갈래가 없어졌으므로 `StatusBar.svelte` 는 `<UiIcon {name} />` 한 줄이면 된다.
 * `LAYOUT_D` 는 `+` 메뉴가 Lucide `layout` 으로 옮겨 가면서 **호출부가 없어져 지웠다**
 * (2026-09-15). `FOLDER_D` 도 파일 목록·호스트 트리가 Lucide 이중톤으로 옮겨 가며 지웠다
 * (docs/log/2026-09-25-duotone-glyphs.md).
 *
 * ## 왜 순수 모듈인가
 *
 * 이 저장소의 vitest 는 `environment: "node"` 라 `.svelte` 를 들여올 수 없다
 * (docs/log/2026-09-05-vitest.md). 목록과 순서 규칙이 회귀 테스트를 받을 수 있는 자리는
 * 순수 모듈뿐이라 **무엇이 서는가**(이 파일)와 **어떻게 그리는가**(`StatusBar.svelte`)와
 * **어디에 저장하는가**(`status-order.svelte.ts`)를 나눈다 — `favorites.ts` ↔
 * `favorites.svelte.ts` ↔ `DockFavorites.svelte` 와 같은 나눔이다. 특히 `action` 이
 * `keybindings.ts` 의 실제 id 인지는 사람 눈으로는 절대 안 잡히는 오타라(눌러도 아무 일이
 * 없는 버튼이 된다) 테스트가 대신 본다.
 */

// 이름은 **문구 키**다 — 이 모듈은 순수하게 남아야 해서(vitest 가 `.svelte.ts` 를 들이지
// 못한다) 사전을 부르지 않고 키만 든다. `t()` 는 그리는 쪽(`StatusBar.svelte`)이 부른다.
// `import type` 이라 런타임 모듈 그래프에는 남지 않는다 (`npm run check:cycles`).
import type { Key } from "$lib/i18n/keys";

/**
 * 칸의 종류.
 *
 * · `toggle` — 떠 있는 크롬 표면을 여닫는다. `data-chrome-toggle` 을 달고 열려 있으면
 *   불이 들어온다 (`StatusBar.svelte`).
 * · `action` — 한 번 하고 마는 일. 불이 없다 (같은 모양이면 "눌러도 안 켜지는 버튼" 으로
 *   읽힌다).
 */
export type StatusItemKind = "toggle" | "action";

/** 선두단의 칸 하나 */
export interface StatusItem {
  /**
   * 이 칸의 안정적인 id. **저장 키다** (`aynx:status-order` 에 이 글자가 그대로 들어간다) —
   * 라벨은 바꿔도 이것은 바꾸지 않는다 ([conventions](../../docs/conventions.md) 의
   * "id·식별자는 안 바뀐다" 규칙). 지금은 액션 id 와 같은 글자를 쓴다.
   */
  id: string;
  kind: StatusItemKind;
  /**
   * 액션 id — `keybindings.ts` 의 `ACTIONS` 에 있는 것과 **같은 글자**여야 한다(예외는
   * 팔레트 전용 id — 지금 표에는 없다).
   * 토글 칸도 갖는다: 누르는 일 자체는 프롭 콜백으로 가지만(`onhosts`·`onprojects`·
   * `onplans`), 툴팁의 조합은 여기서 낸다 — 조합을 화면에 하드코딩하면 사용자가 키를
   * 바꿨을 때 이 띠만 옛 글자를 말한다.
   */
  action: string;
  /**
   * 툴팁에 조합을 적을 액션들 — 없으면 `[action]` 하나다. 칸 하나가 여러 키의 문인 경우
   * (독 칸 = H · J · K)에 쓴다: 대표 하나만 적으면 나머지 둘의 키가 띠에서 사라진다.
   */
  tipActions?: readonly string[];
  /**
   * 그릴 아이콘의 이름 — `ui-icons.generated.ts` 의 키다. 그림은 `currentColor` 라
   * 띠의 글자색을 따라간다 (색이 고정인 이모지는 쓰지 않는다 —
   * docs/log/2026-09-04-icons-and-rows.md). 모르는 이름이면 `UiIcon` 이 아무것도 그리지
   * 않으므로 **아래 표를 고칠 때 `scripts/gen-ui-icons.mjs` 의 `WANTED` 를 함께 본다**
   * (테스트가 그 짝을 지킨다).
   */
  icon: string;
  /**
   * 툴팁·스크린 리더가 받는 **온전한 이름**의 문구 키. 띠에는 글자를 그리지 않으므로 이것이
   * 유일한 이름이다 (`t()` 는 `StatusBar.svelte` 가 부른다).
   */
  labelKey: Key;
}

/**
 * 칸들의 **기본 순서** — 왼쪽에서 오른쪽(세로 기둥에서는 위에서 아래) 그대로. **지금은 비어 있다**(머리말 — 2026-10-18 실기 뒤
 * 독 입구 칸까지 걷었다). 표 · 순서 규칙 · 저장은 칸이 다시 생길 때를 위해 그대로 둔다.
 */
export const STATUS_ITEMS: readonly StatusItem[] = [];

/**
 * **걷힌 칸의 옛 id** (2026-10-18 통합 독) — 사람이 순서를 바꿔 둔 `aynx:status-order` 에 남아 있을 수 있다. 표에 없으므로
 * [`applyOrder`] 가 모르는 id 로 버린다 — 이 목록은 그 사실을 적어 두고 시험이 지키게 하는 자리다(되살릴 때 같은 글자를 쓰지
 * 않도록 — "폐기 id 는 재사용하지 않는다", docs/conventions.md). `open-settings` 는 2026-09-25 에 먼저 빠졌다.
 */
export const RETIRED_STATUS_IDS: readonly string[] = [
  "new-shell",
  "open-localfs",
  "command-palette",
  "folder-conversations",
  "open-sessions",
  "open-plans",
  "orchestration-start",
  "open-settings",
  // 독 입구 — 2026-10-18 실기 뒤 걷었다(독은 가장자리 호버 · 단축키 · 팔레트 · 알림 배지로 연다)
  "open-dock",
];

/**
 * 합쳐서 없어진 칸의 옛 id → 그것을 물려받은 칸의 id.
 *
 * `aynx:status-order` 에 남은 옛 순서를 **버리지 않고 접는다**: 그 사람이 호스트 칸을 맨 앞에
 * 두었다면 독 칸이 맨 앞에 선다. 셋이 다 있으면 **첫째가 있던 자리**다 — [`applyOrder`] 의
 * "중복 id 는 앞의 것이 이긴다" 가 그대로 그 규칙이 된다. 2026-10-18 부터 물려받을 독 칸이 표에 없으므로(머리말) 접힌 뒤
 * 그 id 도 모르는 id 로 버려진다 — 접는 규칙은 순서 규칙(표본 시험)과 함께 남긴다.
 */
const MERGED_INTO: Readonly<Record<string, string | readonly string[]>> = {
  "open-hosts": "open-dock",
  "open-projects": "open-dock",
  "open-layouts": "open-dock",
  // 대시보드 칸(`open-console`)은 2026-10-07 에 세션 칸 + 작업안 칸으로 펼쳐졌고, 그 둘도 2026-10-18 에 독으로 들어갔다 —
  // 이제는 모르는 id 로 버린다(펼칠 칸이 없다).
};

/** 기본 순서의 id 목록 — 저장값이 없을 때(첫 실행) 그대로 쓰는 값 */
export const DEFAULT_STATUS_ORDER: readonly string[] = STATUS_ITEMS.map((i) => i.id);

/**
 * 저장된 id 순서 + 기본 목록 → **실제로 그릴 칸들**.
 *
 * 두 방향의 어긋남을 여기서 흡수한다 (저장값은 옛 판에서 쓴 것일 수 있다):
 * · **합쳐진 id 는 물려받은 칸으로 읽는다** — [`MERGED_INTO`] (호스트·프로젝트·레이아웃 → 독).
 * · **모르는 id 는 버린다** — 없어진 칸이 화면에 빈자리를 만들면 안 된다.
 * · **빠진 id 는 뒤에 붙인다**, 기본 순서 그대로 — 새 칸이 생겼을 때 이미 순서를 바꿔 둔
 *   사람에게도 그 칸이 보여야 한다 (저장값에 없다고 사라지면 "새 기능이 안 보인다" 가 된다).
 *
 * 중복 id 는 앞의 것이 이긴다.
 */
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

/**
 * `fromId` 칸을 **`toId` 칸 바로 앞으로** 옮긴 새 목록. `toId` 가 `null` 이면 맨 뒤로
 * (탭 스트립의 삽입선과 **같은 계약**이다 — `Tabs.svelte` 의 `dropBefore`/`dropEnd`).
 *
 * 아무것도 달라지지 않는 경우(같은 칸으로 놓기·모르는 id·이미 그 자리)에는 **같은 배열을
 * 그대로** 돌려준다 — 호출부가 `===` 로 "바뀐 게 없다" 를 알 수 있고, 새 배열을 만들면 이
 * 목록을 읽는 화면이 공연히 다시 그려진다 (`withFavorite` 과 같은 규칙).
 */
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

/**
 * 저장된 원시 값 → 믿을 수 있는 id 목록. **절대 throw 하지 않는다** — 모양이 어긋나면 빈
 * 목록이고, 그러면 [`applyOrder`] 가 기본 순서를 낸다 (`parseFavorites` 와 같은 판정).
 *
 * 여기서는 id 가 실제로 있는 칸인지 **묻지 않는다** — 그 판정은 [`applyOrder`] 한 곳에만
 * 두어야 "모르는 id 를 어떻게 다루는가" 의 답이 둘로 갈리지 않는다.
 */
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

/** id 목록 → 저장 문자열 (순수 — 같은 목록이면 같은 글자) */
export function serializeStatusOrder(ids: readonly string[]): string {
  return JSON.stringify([...ids]);
}

/**
 * 툴팁 한 줄 — 이름 + 지금 걸린 조합.
 *
 * 조합은 `keybindings.ts` 에서 온 값이라 사용자가 바꾸면 이 글자도 따라 바뀐다. **없을 수
 * 있다** (단축키를 푼 액션) — 그때는 괄호째 빼고 이름만 남긴다: 빈 괄호는 "여기 뭔가 있어야
 * 하는데 없다" 로 읽힌다.
 */
export function shortcutTitle(name: string, combo: string | null | undefined): string {
  return combo ? `${name} (${combo})` : name;
}

/**
 * 여러 조합(표시용 글자)을 툴팁 한 자리로 — **수식 키가 같은 것은 끝 키만 `/` 로 잇는다**.
 * `["Ctrl+Shift+H", "Ctrl+Shift+J", "Ctrl+Shift+K"]` → `"Ctrl+Shift+H/J/K"` (칩 하나).
 *
 * 사용자가 하나를 다른 수식 키로 옮겼으면 그것은 따로 선다 — 무리들은 공백 한 칸으로 이어
 * 저마다 칩이 된다(`tooltip.ts` 의 괄호 해석은 낱말 셋까지 받는다). 무리의 순서는 처음
 * 나온 순서, 무리 안 키의 순서는 들어온 순서다. 수식 키가 없는 조합과 끝 키에 `/`·공백이
 * 든 조합(`Ctrl+/` · `Num 1`)은 접으면 읽을 수 없으니 접지 않는다. 비었으면 `null`.
 */
export function mergeCombos(combos: readonly string[]): string | null {
  const groups = mergeComboGroups(combos);
  return groups.length === 0 ? null : groups.join(" ");
}

/**
 * [`mergeCombos`] 의 몸통 — 무리를 **칩 하나씩의 글자 목록**으로 돌려준다(이어 붙이지 않는다).
 *
 * `joiner` 는 한 무리 안 끝 키 사이의 글자다: 툴팁·독 셋은 `/`(`Ctrl+Shift+H/J/K`), 단축키
 * 도움말의 방향키 넷은 빈 글자(`Alt+←→↑↓`). 접는 규칙은 둘이 같다 — 수식 키가 같을 때만.
 */
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
