/**
 * 결과 표 칸 우클릭 메뉴의 줄. 그리는 것은 타일 메뉴(`pane/PaneMenu.svelte`)이고, 누른 줄(`tool:<열쇠>`)은 쿼리 타일의 `onmenu`
 * 통로를 지나 `ResultGrid` 로 돌아온다. 무리 순서는 다른 우클릭 메뉴와 같은 규칙(클립보드 → 거르기 → 따라가기)이다.
 */

import type { PaneMenuItem, PaneMenuRow } from "$lib/pane/pane-menu";
import type { Tr } from "$lib/session";

/** `pane/pane-tools.svelte.ts` 의 `TOOL_ACTION_PREFIX` 와 같은 값 — 그 모듈은 룬 상태라 순수 층에서 부르지 않는다 */
const TOOL_ACTION_PREFIX = "tool:";

export interface GridMenuCtx {
  /** 데이터 탭이면 WHERE 로, 아니면 받은 행 안에서 거른다 */
  dataTab: boolean;
  bytes: boolean;
  /** 차트 보기 — 범위가 없으니 형식별 복사를 흐린다 */
  charting: boolean;
  /** 정방향 외래 키의 참조 표 이름 */
  follow: string | null;
  /** 역방향 외래 키 — 이 행에서 따라갈 수 없으면 `ok: false` */
  refs: readonly { table: string; columns: readonly string[]; ok: boolean }[];
}

const item = (key: string, label: string, icon: string | null, extra: Partial<PaneMenuItem> = {}): PaneMenuItem => ({
  action: `${TOOL_ACTION_PREFIX}${key}`,
  label,
  icon,
  ...extra,
});

export function gridMenuRows(ctx: GridMenuCtx, tr: Tr): PaneMenuRow[] {
  const rows: PaneMenuRow[] = [
    item("copy", tr("pane.menu.copy"), "copy", { hint: "Ctrl+C" }),
    {
      flyout: "copy-as",
      label: tr("pane.query.cell.copyAs"),
      icon: "file-text",
      disabled: ctx.charting,
      children: [
        item("copy:csv", "CSV", null, { disabled: ctx.charting }),
        item("copy:json", "JSON", null, { disabled: ctx.charting }),
        item("copy:md", "Markdown", null, { disabled: ctx.charting }),
      ],
    },
    {
      flyout: "filter",
      label: tr("pane.query.cell.filter"),
      icon: "filter",
      separator: true,
      disabled: ctx.bytes,
      children: [
        item("eq", tr("pane.query.cell.filter.eq"), null, { disabled: ctx.bytes }),
        item("ne", tr("pane.query.cell.filter.ne"), null, { disabled: ctx.bytes }),
        item("and", tr(ctx.dataTab ? "pane.query.cell.filter.and" : "pane.query.cell.filter.addLocal"), null, { disabled: ctx.bytes }),
      ],
    },
  ];
  const nav = ctx.follow !== null || ctx.refs.length > 0;
  if (ctx.follow !== null) rows.push(item("follow", tr("pane.query.cell.follow", { table: ctx.follow }), "external", { separator: true }));
  if (ctx.refs.length > 0) {
    rows.push({
      flyout: "refs",
      label: tr("pane.query.cell.refs"),
      icon: "link",
      separator: nav && ctx.follow === null,
      disabled: ctx.refs.every((x) => !x.ok),
      children: ctx.refs.map((x, i) => item(`ref:${i}`, x.table, null, { hint: x.columns.join(", "), disabled: !x.ok })),
    });
  }
  return rows;
}

/** 쿼리 타일이 표들에게 건네는 타일 메뉴 문(Svelte 컨텍스트 열쇠) */
export const GRID_TILE_MENU = Symbol("query-grid-tile-menu");
export type GridTileMenu = (x: number, y: number, menu: { rows: PaneMenuRow[]; run: (key: string) => void }) => void;
