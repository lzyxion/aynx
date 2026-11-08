/**
 * **파일 타일 도구줄의 단추들** — 한 정의가 두 모양을 그린다(2026-10-11 · 2026-10-20 B안).
 *
 * 줄 위의 단추(새 폴더 · 가져오기/업로드 · 찾기)와 ⋯ 메뉴의 줄(숨김 파일 · 장소 패널 · 미리 보기 패널 — 새로고침은 경로 칸 안 ⟳)이 **같은 표 모양**이다.
 * 좁으면 `fold` 단추(새 폴더 · 업로드)가 줄에서 빠져 ⋯ 맨 위로 간다(`BrowserToolbar.svelte` 의 접기 규칙 · [`fileMenuTools`]).
 * 두 모양이 같은 표에서 나와야 단추를 하나 더할 때 메뉴 쪽을 빠뜨리지 않는다.
 *
 * ⋯ 는 둘 중 하나다 — 머리줄이 서 있으면 **타일 ⋯ 하나로 합친다**(위 줄들이 타일 메뉴 맨 위에 얹힌다 — [`toPaneMenuItems`] ·
 * `pane/pane-tools.svelte.ts`), 머리줄이 없으면 도구줄 끝의 제 ⋯ 다(`ToolbarMenu`).
 *
 * 이 파일은 순수하다(사전도 설정도 읽지 않는다) — 이름·툴팁·단축키 글자는 부르는 쪽(`SftpBrowser` · `BrowserToolbar`)이 지어서 넣는다.
 */

import type { PaneMenuItem } from "$lib/pane/pane-menu";

// 접는 폭은 여기 없다 — 타일 폭 판정 하나(`pane/head-span` 의 `filePlacesLayout` · `FILE_FOLD_MIN_WIDTH`, 2026-10-20)가 정한다.

export interface ToolbarTool {
  /** 표식 — 넓은 단추에 `data-file-<id>` 로 붙는다(검증 도구가 이 이름으로 찾는다) */
  id: string;
  /** `UiIcon` 이름 */
  icon: string;
  /** 이름 — 단추의 `aria-label` · 메뉴 줄의 글자 */
  label: string;
  /** 단추 툴팁 (없으면 `label`). 메뉴 줄에는 **흐릴 때만** 붙는다(왜 못 누르는지) */
  title?: string;
  /** 켜고 끄는 단추인가 — 값이 있으면 토글이다(`aria-pressed` · 메뉴의 ✓) */
  pressed?: boolean;
  disabled?: boolean;
  /** 단축키 액션 id (`keybindings.ts` 의 `files` 층) — 메뉴 줄 오른쪽에 지금 걸린 조합이 선다 */
  action?: string;
  /** 앞에 가는 구분선 — 폴더 조작과 타일 보기 토글을 가른다 */
  sep?: boolean;
  /** 좁으면(`filePlacesLayout` 의 `fold`) 줄에서 빠져 ⋯ 맨 위로 가는 단추인가 — 새 폴더 · 가져오기/업로드 */
  fold?: boolean;
  run: () => void;
}

/** 접힌 메뉴(`ToolbarMenu.svelte`)의 한 줄 */
export interface ToolbarMenuRow {
  key: string;
  /** 앞 그림(`UiIcon` 이름) — 빈 글자면 그림 칸 없이 글자만 선다 */
  icon: string;
  /** 앞 로고(`HostIcon` 값 — `iconRef(...)`) — 있으면 `icon` 대신 단색 로고가 선다(사용자가 바꾼 앱 아이콘을 따른다) */
  logo?: string;
  label: string;
  /** 오른쪽 단축키 글자 (빈 값이면 없음) */
  hint?: string;
  /** `undefined` = 그냥 항목 · 참/거짓 = 켜짐 표시가 있는 항목 */
  checked?: boolean;
  /** 하나만 고르는 무리(보기 셋)인가 — 역할만 바뀐다 */
  radio?: boolean;
  disabled?: boolean;
  title?: string;
  /** 앞에 구분선 */
  sep?: boolean;
  /** 되돌릴 수 없는 항목(삭제) — 전역 메뉴의 `.menu-row.danger`(의미색 글자) */
  danger?: boolean;
}

/**
 * 메뉴 안 ↑↓·Home·End 로 갈 다음 줄 — 흐린 줄은 건너뛴다. 끝에서 돌아 처음으로 간다.
 *
 * `at` 이 -1(아무 줄에도 포커스가 없다)이면 ↓ 는 첫 줄, ↑ 는 마지막 줄이다. 갈 줄이 하나도 없으면 -1.
 * 모르는 키도 -1 이다(부르는 쪽이 키를 놓아준다).
 */
export function nextMenuIndex(key: string, at: number, disabled: readonly boolean[]): number {
  const n = disabled.length;
  const live = disabled.map((d, i) => (d ? -1 : i)).filter((i) => i >= 0);
  if (live.length === 0) return -1;
  if (key === "Home") return live[0];
  if (key === "End") return live[live.length - 1];
  const step = key === "ArrowDown" ? 1 : key === "ArrowUp" ? -1 : 0;
  if (step === 0) return -1;
  if (at < 0 || at >= n) return step > 0 ? live[0] : live[live.length - 1];
  for (let k = 1; k <= n; k++) {
    const i = (at + step * k + n * k) % n;
    if (!disabled[i]) return i;
  }
  return -1;
}

/**
 * **접혀서 빈 폭** — 넓은 모양의 폭 − 접힌 모양의 폭(px, 0 아래로는 안 간다). 둘 중 하나를 아직 못 쟀으면 0 —
 * 그러면 빈칸이 없는 예전 모양(경로 칸이 빈 폭을 다 받는다)으로 물러선다.
 *
 * `BrowserToolbar.svelte` 머리말 "접혀서 빈 자리는 경로가 한꺼번에 받지 않는다". 소수 폭은 반올림한다(빈칸 식이
 * 반 픽셀씩 떨지 않게).
 */
export function foldGap(wide: number | undefined, narrow: number | undefined): number {
  if (wide === undefined || narrow === undefined) return 0;
  return Math.max(0, Math.round(wide - narrow));
}

/**
 * 접힌 뒤 남기는 빈칸의 폭 — `max(0, 빈 폭 + 타일 폭 − 접는 폭)`. 접는 순간(타일 폭 = 접는 폭)에는 빈 폭 그대로라
 * 경로 칸 폭이 이어지고, 타일이 1px 좁아질 때마다 1px 씩 닳는다.
 *
 * 실제 계산은 CSS 가 한다(`BrowserToolbar.svelte` 의 `margin-left: max(0px, calc(var(--fold-tools) + var(--fold-over)))`) — 이 함수는
 * 그 식의 거울이고, 시험이 이것으로 "타일 폭 → 경로 칸 폭" 곡선이 끊기지 않음을 본다. 식을 고치면 둘을 같이 고친다.
 */
export function foldSpacer(gap: number, tileWidth: number, foldAt: number): number {
  return Math.max(0, gap + tileWidth - foldAt);
}

/**
 * **⋯ 에 설 도구 줄** — 좁아서 접힌 줄 위 단추(`fold`)가 먼저, 그다음 늘 ⋯ 에 사는 줄들(`menu`). 접힌 것이 있으면 둘 사이에 선을 긋는다
 * ("이 폴더에 만드는 것" 과 "보는 법" 이 갈린다). 접히지 않았으면 `menu` 그대로다.
 */
export function fileMenuTools(bar: readonly ToolbarTool[], menu: readonly ToolbarTool[], folded: boolean): ToolbarTool[] {
  const out: ToolbarTool[] = folded ? bar.filter((tool) => tool.fold === true).map((tool) => ({ ...tool, sep: false })) : [];
  menu.forEach((tool, i) => out.push(i === 0 ? { ...tool, sep: out.length > 0 } : tool));
  return out;
}

/**
 * 도구 줄 → **타일 ⋯ 메뉴의 줄**(`PaneMenuItem` — 액션 `tool:<id>`). 켜고 끄는 줄은 타일 메뉴의 체크 관례(켜졌을 때만 `check` 그림 ·
 * `menuitemcheckbox`)를 따르고, 흐린 줄에만 툴팁(왜 못 누르는지)이 붙는다. `hintOf` 는 액션 id → 지금 걸린 조합 글자(없으면 빈 글자).
 */
export function toPaneMenuItems(tools: readonly ToolbarTool[], hintOf: (action: string | undefined) => string): PaneMenuItem[] {
  return tools.map((tool) => {
    const check = tool.pressed !== undefined;
    return {
      action: `tool:${tool.id}`,
      label: tool.label,
      icon: check ? (tool.pressed ? "check" : null) : tool.icon,
      ...(check ? { checkbox: true, checked: tool.pressed } : {}),
      ...(tool.disabled ? { disabled: true, title: tool.title ?? tool.label } : {}),
      ...(tool.sep ? { separator: true } : {}),
      hint: hintOf(tool.action) || undefined,
    };
  });
}
