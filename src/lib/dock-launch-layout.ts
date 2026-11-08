/**
 * 독 실행 단추의 자리 셈(2026-10-28 — 목업 `DQCMggdqxPkLAv6uSXXDA7` 판 E). 순수 함수 — 화면은 `DockLaunch.svelte`.
 *
 * 격자는 네 열 `minmax(0,1fr) minmax(0,1fr) 52px 52px`: 앞 두 열 = **글자 칸**(기본 셸 · AI CLI — 알약), 뒤 두 열 = **아이콘 칸**
 * (로컬 파일 · 잠자기 방지 · 지난 대화 · 오케스트레이션 — 52px 원).
 *
 * - 글자 칸: 셸이 1줄에서 두 열을 다 쓴다. AI 는 2줄부터 한 줄에 둘씩 채우고, 마지막 줄에 하나만 남으면 그 하나가 두 열을 쓴다.
 * - 아이콘 칸: 1줄부터 한 줄에 둘씩, 받은 순서대로(없는 칸 — 예: 잠자기 방지가 없는 OS — 은 부르는 쪽이 빼고 넘긴다).
 * - 줄 수 = 두 쪽 중 긴 쪽. 빈 자리는 비워 둔다(AI 가 0 이면 2줄 글자 칸이 빈다).
 */

/** 격자의 한 자리 — 1부터 센다(CSS `grid-row` · `grid-column` 그대로) */
export interface LaunchCell {
  row: number;
  col: number;
  /** 차지하는 열 수(1 또는 2) */
  span: number;
}

export interface LaunchLayout {
  shell: LaunchCell;
  ais: LaunchCell[];
  icons: LaunchCell[];
  rows: number;
}

/** 아이콘 칸의 첫 열(글자 칸 둘 다음) */
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

/** 인라인 `grid-column` 값 — `시작 / span n` */
export function gridColumn(c: LaunchCell): string {
  return `${c.col} / span ${c.span}`;
}
