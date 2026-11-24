/** 줄 위 단추와 ⋯ 메뉴 줄이 같은 표에서 나온다 — 단추를 하나 더할 때 메뉴 쪽을 빠뜨리지 않게. 순수하다(사전 · 설정을 읽지 않는다). */

import type { PaneMenuItem } from "$lib/pane/pane-menu";
import type { PaneSpec } from "$lib/session";

export interface ToolbarTool {
  /** 넓은 단추에 `data-file-<id>` 로 붙는다 — 검증 도구가 이 이름으로 찾는다 */
  id: string;
  icon: string;
  label: string;
  title?: string;
  pressed?: boolean;
  disabled?: boolean;
  /** `keybindings.ts` 의 `files` 층 액션 id */
  action?: string;
  sep?: boolean;
  fold?: boolean;
  run: () => void;
}

export interface ToolbarMenuRow {
  key: string;
  icon: string;
  logo?: string;
  pane?: PaneSpec;
  label: string;
  code?: string;
  hint?: string;
  /** 값이 있으면(빈 글자도) 하위 갈래로 들어가는 줄이다 — → 키도 이 줄을 고른다 */
  more?: string;
  /** `undefined` = 그냥 항목 · 참/거짓 = 켜짐 표시가 있는 항목 */
  checked?: boolean;
  radio?: boolean;
  disabled?: boolean;
  title?: string;
  sep?: boolean;
  danger?: boolean;
}

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

/** `BrowserToolbar.svelte` 머리말 "접혀서 빈 자리는 경로가 한꺼번에 받지 않는다" 의 계산 — 못 쟀으면 0 */
export function foldGap(wide: number | undefined, narrow: number | undefined): number {
  if (wide === undefined || narrow === undefined) return 0;
  return Math.max(0, Math.round(wide - narrow));
}

/** `BrowserToolbar.svelte` 의 `margin-left: max(0px, calc(var(--fold-tools) + var(--fold-over)))` 식의 거울 — 식을 고치면 둘을 같이 고친다 */
export function foldSpacer(gap: number, tileWidth: number, foldAt: number): number {
  return Math.max(0, gap + tileWidth - foldAt);
}

export function fileMenuTools(bar: readonly ToolbarTool[], menu: readonly ToolbarTool[], folded: boolean): ToolbarTool[] {
  const out: ToolbarTool[] = folded ? bar.filter((tool) => tool.fold === true).map((tool) => ({ ...tool, sep: false })) : [];
  menu.forEach((tool, i) => out.push(i === 0 ? { ...tool, sep: out.length > 0 } : tool));
  return out;
}

export function toPaneMenuItems(tools: readonly ToolbarTool[], hintOf: (action: string | undefined) => string): PaneMenuItem[] {
  return tools.map((tool) => {
    const check = tool.pressed !== undefined;
    return {
      action: `tool:${tool.id}`,
      label: tool.label,
      // 켜짐 ✓ 는 `PaneMenu` 가 줄 오른쪽 끝에 그린다 — 앞자리는 늘 도구의 그림이다
      icon: tool.icon,
      ...(check ? { checkbox: true, checked: tool.pressed } : {}),
      ...(tool.disabled ? { disabled: true, title: tool.title ?? tool.label } : {}),
      ...(tool.sep ? { separator: true } : {}),
      hint: hintOf(tool.action) || undefined,
    };
  });
}
