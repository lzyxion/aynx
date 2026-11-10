/**
 * **결과 표 칸 우클릭 메뉴의 줄 — 순수 층** (2026-11-10). 그리는 것은 타일 메뉴(`pane/PaneMenu.svelte` — 문서 편집기 · 터미널 본문
 * 우클릭과 같은 상자 · 같은 옆목록 · 같은 여는 몸짓)이고, 누른 줄(`tool:<열쇠>`)은 쿼리 타일의 `onmenu` 통로(`PaneHost` →
 * `tile-menu-controller` 의 `doc` 갈래)를 지나 그 표(`ResultGrid` 의 `pickCell`)로 돌아온다.
 *
 * 무리 순서는 다른 우클릭 메뉴와 같은 규칙(클립보드 → 거르기 → 따라가기):
 *
 *   복사 · 다른 형식으로 복사 ▸ ─ 필터 ▸ ─ <표> 에서 보기 · 이 행을 가리키는 행 ▸
 *
 * - **다른 형식으로 복사 ▸** CSV · JSON · Markdown(표) — 고른 범위(밖을 눌렀으면 그 칸 하나)
 * - **필터 ▸** 이 값으로 · 이 값 빼고 · 조건(거르기)에 더하기 — 이진 칸은 흐림
 * - **이 행을 가리키는 행 ▸** 이 표를 참조하는 외래 키마다 한 줄(표 이름 + 오른쪽 작은 글자 = 열) — 데이터 탭만
 */

import type { PaneMenuItem, PaneMenuRow } from "$lib/pane/pane-menu";
import type { Tr } from "$lib/session";

/** `pane/pane-tools.svelte.ts` 의 `TOOL_ACTION_PREFIX` 와 같은 값(그 모듈은 룬 상태라 순수 층에서 부르지 않는다 — `doc-menu.ts` 와 같은 까닭) */
const TOOL_ACTION_PREFIX = "tool:";

export interface GridMenuCtx {
  /** 데이터 탭인가(WHERE 로 거른다) — 아니면 쿼리 탭 결과(받은 행 안에서) */
  dataTab: boolean;
  /** 이진 칸 — 거르기를 흐린다 */
  bytes: boolean;
  /** 차트 보기 — 범위가 없으니 형식별 복사를 흐린다 */
  charting: boolean;
  /** 정방향 외래 키의 참조 표 이름(따라갈 수 있을 때) */
  follow: string | null;
  /** 역방향 외래 키 — 이 행에서 따라갈 수 없으면(값이 NULL · 열 없음) `ok: false` */
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

/** 쿼리 타일이 표들에게 건네는 타일 메뉴 문(Svelte 컨텍스트 열쇠) — 표가 몇 겹 아래에 있든 prop 을 꿰지 않는다 */
export const GRID_TILE_MENU = Symbol("query-grid-tile-menu");
export type GridTileMenu = (x: number, y: number, menu: { rows: PaneMenuRow[]; run: (key: string) => void }) => void;
