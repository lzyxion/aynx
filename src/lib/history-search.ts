/**
 * **앱 차원 명령 이력 검색** — 팔레트의 `!` 접두사가 보는 목록을 만드는 순수 규칙
 * (docs/log/2026-09-17-history-search.md).
 *
 * 블록 이력(`block-history.ts`)은 **타일마다 따로** 쌓인다. 그래서 "아까 그 명령" 을 다시
 * 치려면 그 명령을 쳤던 타일을 먼저 찾아야 하는데, 사람이 기억하는 것은 대개 명령 쪽이고
 * 타일 쪽이 아니다 (`web-01` 이었나 `db-01` 이었나). 이 모듈이 하는 일은 그 뒤집기다 —
 * **창 안의 모든 타일**의 이력을 한 줄로 펴서 최신순으로 세운다.
 *
 * ## 이 파일은 순수다
 *
 * 룬도 DOM 도 Tauri 도 없다 — `snippets.ts`·`finish-notify.ts` 와 같은 분담이다. 저장소를
 * 임포트하지도 않는다: [`collectHistory`] 는 **블록을 읽는 함수를 인자로** 받는다
 * (`blocksOf`). 그래야 테스트가 가짜 이력을 그대로 넣을 수 있고, 이 모듈이
 * `block-history.ts` 에 묶이지 않는다 (`finish-notify.ts` 가 `CommandBlock` 을 인자 타입으로
 * 쓰지 않는 것과 같은 판단 — 필요한 것은 필드 몇 개뿐이다).
 *
 * "지금 이 창에 어떤 타일이 있나" 와 "그 타일을 뭐라고 부르나" 는 앱 상태라 부르는 쪽
 * (`app/history.svelte.ts`)이 이미 풀어서 넘긴다.
 *
 * ## 메모리만 — 디스크에 남기지 않는다
 *
 * 이 목록의 원천은 **블록 링 하나뿐**이고 그 링은 세션이 사는 동안만 산다
 * (`block-history.ts` 머리말 ③). 여기서 파일을 하나 만들면 그 순간 이것은 **세션 로깅과
 * 같은 부류**가 된다 — 사람이 친 명령이 디스크에 남는 일이고, 그 제약은 CLAUDE.md 에
 * "기본 꺼짐 · 세션별 옵트인" 으로 이미 못 박혀 있다. 그래서 지속은 하지 않는다: 앱을
 * 닫으면 이력도 함께 사라진다.
 */

import type { Tr } from "$lib/finish-notify";

/**
 * 팔레트에서 **명령 이력만 보는** 질의 접두사 (`>` 명령 · `@` 탭 · `#` 그룹 · `;` 스니펫 옆의
 * 다섯째).
 *
 * `!` 인 이유는 셸의 관습 그대로다 — `!!` · `!$` · `!1234` 가 전부 "지난 명령" 을 가리키는
 * 글자라, 터미널을 쓰는 사람에게는 새로 외울 것이 없다. 값이 여기 사는 이유는
 * [`SNIPPET_QUERY_PREFIX`](`snippets.ts`)와 같다: 거르는 쪽과 힌트 줄이 **같은 글자**를
 * 알아야 하고, 한쪽에 리터럴로 적으면 다른 쪽이 조용히 어긋난다.
 */
export const HISTORY_QUERY_PREFIX = "!";

/**
 * 한 번에 모으는 최대 줄 수.
 *
 * 타일당 링이 이미 200 블록(`BLOCK_CAPS.paneBlocks`)이라 타일이 열 개면 2000 줄이 된다.
 * 그 전부를 중복 제거하고 정렬하는 일은 팔레트가 **글자를 칠 때마다** 돌 자리는 아니다
 * (팔레트가 그리는 것은 어차피 `MAX_ITEMS` 40줄이다). 500 은 "며칠치 명령" 에 해당하는
 * 양이면서 정렬 비용이 눈에 띄지 않는 선이다.
 */
export const HISTORY_CAP = 500;

/**
 * [`collectHistory`] 가 블록에서 읽는 칸 — **`CommandBlock` 의 부분집합**이다.
 *
 * 통째로 받지 않는 이유는 `finish-notify.ts` 와 같다: 인자 타입으로 `CommandBlock` 을 쓰면
 * 이 순수 모듈이 `block-history.ts` 에 묶이고, 그쪽이 언젠가 이 목록을 쓰고 싶어지면 곧바로
 * 순환이다. 실제로 쓰는 것은 다섯 칸뿐이라 구조적으로 맞춰만 둔다.
 */
export interface HistoryBlock {
  commandLine: string;
  startedAt: number;
  endedAt: number | null;
  exit: number | null;
}

/** 이력을 모을 타일 하나 — id 와 **사람이 읽는 이름**(`paneName`) */
export interface HistoryPane {
  id: string;
  label: string;
}

/**
 * 목록 한 줄 — **명령 하나**이고, 그 명령이 **가장 최근에** 돈 자리를 함께 싣는다.
 *
 * 같은 명령이 여러 타일에서 돌았으면 줄은 하나뿐이고(중복 제거), 그 줄이 가리키는 타일·시각·
 * 종료 코드는 **가장 최근 것**이다 — 사람이 `!` 로 찾는 것은 "그 명령을 다시 넣는 것" 이지
 * "언제 어디서 몇 번 돌았나" 가 아니다.
 */
export interface HistoryEntry {
  /**
   * 터미널에 넣을 **명령 원문** (앞뒤 공백만 뗐다).
   *
   * 중복 제거의 키이기도 하다. 다듬는 것을 여기서 한 번에 해 두는 이유는 넣는 쪽이 그대로
   * 쓰기 때문이다 — 꼬리 공백이 붙은 줄과 안 붙은 줄이 목록에 둘 서면 사람은 그 둘을
   * 구분할 수 없다.
   */
  command: string;
  /** 가장 최근에 이 명령이 돈 타일 (점프용이 아니라 **라벨의 출처**다) */
  paneId: string;
  /** 그 타일의 이름 (`paneName` — SSH 면 별칭, 로컬이면 셸 이름) */
  paneLabel: string;
  /** `C` 를 본 시각 (epoch ms) — 정렬과 상대 시각의 기준 */
  startedAt: number;
  /** `D` 를 본 시각. `null` = 아직 실행 중 */
  endedAt: number | null;
  /** `D;n` 의 종료 코드. `null` = 못 읽었거나 아직 안 끝났다 */
  exit: number | null;
}

/**
 * **창 안의 모든 타일**의 블록을 한 목록으로 — 최신순 · 중복 제거 · 상한.
 *
 * 순서에 뜻이 있다.
 *
 * 1. **빈 명령문을 버린다.** `B`~`C` 를 못 읽은 블록(tmux 안 · 훅이 반쪽)은 명령문이 비어
 *    있고, 그 줄을 목록에 세우면 **눌러도 빈 글자가 터미널로 나가는 줄**이 된다
 *    (`lastFinishedBlock` 이 같은 것을 거르는 이유와 같다).
 * 2. **최신순으로 세운다** (`startedAt` 내림차순). 같은 ms 면 **링에서 나중인 블록이 위**다 —
 *    타임스탬프가 겹치는 일은 드물지 않다(`ls` 처럼 순식간에 끝나는 명령을 잇달아 치면 `C`
 *    둘이 같은 밀리초에 찍힌다). 안정 정렬에만 기대면 그 자리에서 **오래된 것이 위로 올라와**
 *    목록의 약속이 깨지므로, 모을 때 매긴 일련번호로 한 번 더 가른다.
 * 3. **중복을 접는다.** 첫 등장만 남으므로 ②를 지난 뒤에는 그것이 곧 **가장 최근 것**이다.
 * 4. **상한에서 자른다** ([`HISTORY_CAP`]).
 *
 * 실행 중인 블록도 들어온다 — "방금 친 그 명령" 이 목록의 맨 위에 없으면 `!` 를 친 사람이
 * 가장 먼저 찾을 줄이 빠진 것이다. 결말을 모르는 것은 [`HistoryEntry.exit`] 가 `null` 로
 * 말한다 (화면은 그때 아무 표도 달지 않는다 — 없는 성패를 지어내지 않는다).
 */
export function collectHistory(
  panes: readonly HistoryPane[],
  blocksOf: (paneId: string) => readonly HistoryBlock[],
  cap = HISTORY_CAP,
): HistoryEntry[] {
  // `seq` 는 목록 밖으로 나가지 않는다 — 동점을 가르는 데만 쓰는 값이라 [`HistoryEntry`] 에
  // 칸을 늘리지 않고 여기서만 곁들여 든다.
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
 * 지금 질의로 거른 줄들 — **명령문만 훑는다**.
 *
 * 타일 이름을 훑지 않는 것이 요점이다. `!` 는 "명령을 찾는다" 는 뜻이고, 이름까지 섞으면
 * `!web` 이 web-01 에서 돈 **명령 전부**를 끌고 온다 — 그 물음(어느 타일에서 뭘 했나)에는
 * 이미 다른 답이 있다(관제판 · 타일별 `#` 블록 검색). 목록을 좁히는 글자가 명령 하나뿐이라야
 * 친 글자와 서는 줄의 관계가 흔들리지 않는다.
 *
 * `fuzzy` 를 인자로 받는 이유는 이 모듈이 순수이기 때문이다 — `hosts.ts` 의 `fuzzyMatch` 는
 * Tauri `invoke` 를 든 파일에 살아서 그대로 임포트하면 vitest 가 이 파일을 못 돌린다
 * (`snippets.ts` 의 `subsequence` 가 같은 이유로 제 규칙을 따로 들고 있다). 여기서는
 * 규칙을 베끼는 대신 **팔레트가 쓰는 바로 그 함수**를 받아 쓴다.
 */
export function historyPaletteEntries(
  query: string,
  entries: readonly HistoryEntry[],
  fuzzy: (query: string, text: string) => boolean,
): HistoryEntry[] {
  return entries.filter((e) => fuzzy(query, e.command));
}

/**
 * 지난 시각을 **상대 시각 한 마디**로 — 목록 오른쪽 끝의 뒷글자다 (`3분 전`).
 *
 * `tmux.ts` 의 `relativeCreated` 와 비슷한 계단이지만 **같은 함수가 아니다**. 그쪽은 tmux 가
 * 주는 **초**를 받고 `전` 없는 짧은 꼬리(`2시간`, 2026-10-05 부터)와 `pane.tmux.ago.*` 사전을 쓰며, 무엇보다
 * `invoke` 를 든 파일에 산다 — 순수 계약(머리말)을 깨지 않고는 빌려 올 수 없다. 둘을 한
 * 함수로 합치는 것은 그 파일에서 Tauri 를 걷어낸 뒤의 일이다.
 *
 * 하루를 넘기면 날짜로 바꾸는 것은 같은 판단이다: 그쯤 되면 사람이 찾는 단서가 "몇 시간
 * 전" 이 아니라 "어느 날" 이다. 시계가 뒤로 간 경우(NTP 보정)는 `방금` 으로 접는다 —
 * 틀린 미래를 말하지 않는다.
 */
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
