/**
 * 앱 차원 명령 이력 검색 — 팔레트의 `!` 가 보는 목록(순수). 블록은 읽는 함수(`blocksOf`)로 받는다 — `block-history.ts` 에 묶이면 순환이 된다.
 * 메모리만 — 디스크에 남기면 세션 로깅과 같은 부류가 된다(기본 꺼짐 · 세션별 옵트인 → docs/invariants.md 전문 5).
 */

import type { Tr } from "$lib/finish-notify";

/** 거르는 쪽과 힌트 줄이 같은 글자를 알아야 한다 */
export const HISTORY_QUERY_PREFIX = "!";

/** 팔레트가 글자를 칠 때마다 정렬하는 양의 상한 */
export const HISTORY_CAP = 500;

/** `CommandBlock` 의 부분집합 */
export interface HistoryBlock {
  commandLine: string;
  startedAt: number;
  endedAt: number | null;
  exit: number | null;
}

export interface HistoryPane {
  id: string;
  /** `paneName` */
  label: string;
}

/** 같은 명령이 여러 타일에서 돌았으면 줄은 하나 — 가리키는 자리는 가장 최근 것이다 */
export interface HistoryEntry {
  /** 앞뒤 공백만 뗀 원문 — 중복 제거의 키 */
  command: string;
  /** 라벨의 출처다 (점프용이 아니다) */
  paneId: string;
  paneLabel: string;
  /** `C` 를 본 시각 (epoch ms) */
  startedAt: number;
  /** `D` 를 본 시각. `null` = 아직 실행 중 */
  endedAt: number | null;
  /** `D;n` 의 종료 코드. `null` = 못 읽었거나 아직 안 끝났다 */
  exit: number | null;
}

/**
 * 빈 명령문은 버린다 — 눌러도 빈 글자가 터미널로 나가는 줄이 된다.
 * 같은 ms 는 링에서 나중인 블록이 위다(`seq`) — 안정 정렬에만 기대면 오래된 것이 위로 올라온다.
 */
export function collectHistory(
  panes: readonly HistoryPane[],
  blocksOf: (paneId: string) => readonly HistoryBlock[],
  cap = HISTORY_CAP,
): HistoryEntry[] {
  const all: { entry: HistoryEntry; seq: number }[] = [];
  let seq = 0;
  for (const pane of panes) {
    for (const block of blocksOf(pane.id)) {
      const command = typeof block.commandLine === "string" ? block.commandLine.trim() : "";
      if (command === "") continue;
      all.push({
        seq: seq++,
        entry: {
          command,
          paneId: pane.id,
          paneLabel: pane.label,
          startedAt: block.startedAt,
          endedAt: block.endedAt,
          exit: block.exit,
        },
      });
    }
  }

  all.sort((a, b) => b.entry.startedAt - a.entry.startedAt || b.seq - a.seq);

  const out: HistoryEntry[] = [];
  const seen = new Set<string>();
  for (const { entry } of all) {
    if (seen.has(entry.command)) continue;
    seen.add(entry.command);
    out.push(entry);
    if (out.length >= cap) break;
  }
  return out;
}

/**
 * 명령문만 훑는다 — 타일 이름까지 섞으면 `!web` 이 web-01 의 명령 전부를 끌고 온다.
 * `fuzzy` 를 인자로 받는다 — `hosts.ts` 의 `fuzzyMatch` 는 Tauri 를 든 파일이라 vitest 가 못 돌린다.
 */
export function historyPaletteEntries(
  query: string,
  entries: readonly HistoryEntry[],
  fuzzy: (query: string, text: string) => boolean,
): HistoryEntry[] {
  return entries.filter((e) => fuzzy(query, e.command));
}

/** 시계가 뒤로 간 경우는 `방금` 으로 접는다. `tmux.ts` 의 `relativeCreated` 와는 단위 · 사전이 달라 합치지 않았다 */
export function relativeTime(then: number, now: number, tr: Tr): string {
  if (!Number.isFinite(then) || !Number.isFinite(now)) return "";
  const sec = Math.floor((now - then) / 1000);
  if (sec < 60) return tr("commands.palette.history.ago.now");
  const min = Math.floor(sec / 60);
  if (min < 60) return tr("commands.palette.history.ago.minutes", { n: min });
  const hour = Math.floor(min / 60);
  if (hour < 24) return tr("commands.palette.history.ago.hours", { n: hour });
  const day = Math.floor(hour / 24);
  if (day < 7) return tr("commands.palette.history.ago.days", { n: day });
  const d = new Date(then);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
