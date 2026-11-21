/** 독 실행 단추의 격자 자리 — 순수 함수. 격자 열 `minmax(0,1fr) minmax(0,1fr) 52px 52px` 는 `DockLaunch.svelte` 와 맞춘다. */

/** 1부터 센다(CSS `grid-row` · `grid-column` 그대로) */
export interface LaunchCell {
  row: number;
  col: number;
  span: number;
}

export interface LaunchLayout {
  shell: LaunchCell;
  ais: LaunchCell[];
  icons: LaunchCell[];
  rows: number;
}

const ICON_COL = 3;

export function launchLayout(aiCount: number, iconCount: number): LaunchLayout {
  const ai = Math.max(0, Math.floor(aiCount));
  const ic = Math.max(0, Math.floor(iconCount));
  const shell: LaunchCell = { row: 1, col: 1, span: 2 };
  const ais: LaunchCell[] = [];
  for (let i = 0; i < ai; i++) {
    const lone = i % 2 === 0 && i === ai - 1;
    ais.push({ row: 2 + Math.floor(i / 2), col: 1 + (i % 2), span: lone ? 2 : 1 });
  }
  const icons: LaunchCell[] = [];
  for (let j = 0; j < ic; j++) icons.push({ row: 1 + Math.floor(j / 2), col: ICON_COL + (j % 2), span: 1 });
  const textRows = 1 + Math.ceil(ai / 2);
  const iconRows = Math.ceil(ic / 2);
  return { shell, ais, icons, rows: Math.max(textRows, iconRows) };
}

export function gridColumn(c: LaunchCell): string {
  return `${c.col} / span ${c.span}`;
}
