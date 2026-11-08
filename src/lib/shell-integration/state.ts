// **내부 전용** — 터미널 하나에 붙은 셸 통합의 **공유 상태**(`SiState`)와 그 레코드 모양·상한·한국어 고정 문구.
// `attachShellIntegration` 이 `createState` 로 하나 만들어 조각들에 넘긴다 — 바뀌는 상태는 이 객체에만 산다.

import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import type { Tr } from "$lib/finish-notify";
import { FALLBACK_LOCALE, translate } from "$lib/i18n/dict";
import type { BlockSink, MarkerTag, PaneStatus } from "./types";

/**
 * 싱크 자체가 없는 부름(`attachShellIntegration(term, onstatus)` — 테스트와 표식이 필요
 * 없는 자리)이 쓰는 문구 함수 — **언제나 한국어**다.
 *
 * 이 파일은 vitest 가 그대로 돌리는 순수 모듈이라 `i18n.svelte.ts`(룬)를 들여올 수 없다.
 * 화면 쪽은 `BlockSink.tr` 로 `t` 를 넘긴다 ([`statusLabel`] 은 기본값 없이 **반드시**
 * 받는다 — 탭 바·상태 표시줄이 그리는 글자라 조용히 한국어로 남으면 안 된다).
 */
export const koTr: Tr = (key, params) => translate(FALLBACK_LOCALE, key, params);

/** 명령 하나의 경계. 마커는 xterm 이 줄을 따라 옮겨 준다 */
export interface CommandRecord {
  /** A — 프롬프트가 시작한 줄 (= 사용자가 명령을 친 줄). 점프의 착지점이자 실패 표시 자리 */
  promptMarker: IMarker;
  /**
   * B — **프롬프트가 끝난 자리**(줄). 여기부터가 사용자가 친 글자다.
   *
   * 이것이 없으면 명령문에 프롬프트 문자열(`u@host:~$ `)이 앞에 붙는다 — 화면을 읽는 것
   * 말고는 명령을 알 길이 없고, 셸이 알려 주는 경계는 A·B·C·D 뿐이기 때문이다. B 를 안 보내는
   * 훅(A/C/D 만 내는 것들)도 있어 `null` 이 정상값이고, 그때는 옛 동작(줄 통째로)으로 떨어진다.
   */
  bMarker: IMarker | null;
  /** B 시점의 **열**(`cursorX`). [`bMarker`] 의 줄에서 여기부터가 명령문이다 */
  bCol: number;
  /** C — 명령이 시작된 줄 (= 출력의 첫 줄). 아직 명령을 안 쳤으면 null */
  cmdMarker: IMarker | null;
  /** D — 명령이 끝난 줄 (= 출력의 끝, 이 줄은 포함하지 않는다) */
  outMarker: IMarker | null;
  /** D 가 알려 준 종료 코드. 아직 안 끝났으면 null */
  exit: number | null;
  /**
   * 이 명령의 **상태 띠** 데코레이션 (프롬프트 줄 왼쪽 거터의 세로 색선). 명령당 하나로
   * 교체된다 — C 에서 실행 중(파랑), D 에서 성공(회색)/실패(빨강). 실패는 줄 배경 강조까지
   * 더해 둘이다. 아직 명령을 안 친 프롬프트(A 만 온 자리)면 비어 있다.
   */
  decorations: IDecoration[];
}

/** 레코드 보관 상한. 스크롤백보다 넉넉하되 무한히 자라지 않게 */
export const MAX_RECORDS = 2000;

/**
 * 셸 통합 한 벌의 상태 — 예전에 `attachShellIntegration` 의 지역 변수였던 것들이다(주석은 그 자리의 것 그대로).
 * 조각 함수들은 이것을 첫 인자 `s` 로 받는다. 읽기 전용 칸은 참조가 바뀌지 않는 것(내용은 바뀐다)이다.
 */
export interface SiState {
  readonly term: Terminal;
  readonly onstatus: (status: PaneStatus | null) => void;
  readonly sink?: BlockSink;
  readonly records: CommandRecord[];
  status: PaneStatus | null;
  /** 셸이 마지막으로 알려 준 폴더 (OSC 7 · OSC 9;9). 한 번도 못 봤으면 null */
  cwd: string | null;
  /**
   * 명령 점프의 현재 위치 (records 인덱스). `null` = "바닥(현재 프롬프트)에서 새로 시작".
   * 새 프롬프트(A)가 뜰 때마다 리셋되어, 명령을 하나 친 뒤의 다음 점프는 다시 바닥에서
   * 출발한다 (사용자가 "이전 명령" 을 누를 때 기준이 늘 지금 위치이도록).
   */
  jumpCursor: number | null;
  /**
   * 블록 id → 그 블록의 **프롬프트 마커** ([`CommandApi.lineOfBlock`]).
   *
   * 값이 마커라 **스스로 낡는다** — 줄이 스크롤백 밖으로 밀리면 xterm 이 dispose 하고, 그때
   * 이 항목은 죽은 참조가 된다. 무한히 자라지 않게 두 가지를 한다: [`prune`] 이 죽은 항목을
   * 쓸어 내고, 그러고도 남으면 **넣은 순서대로**(= 오래된 블록부터) [`MAX_RECORDS`] 까지만
   * 남긴다. 이력 링(타일당 200블록)이 축출한 번호는 다시 조회될 일이 없으므로 이 상한만으로
   * 충분하다.
   */
  readonly blockLines: Map<number, IMarker>;
  /**
   * [`ShellIntegration.restoreMarkers`] 가 그린 실패 표시들. 레코드에 딸리지 않으므로
   * (넘어온 화면에는 살아 있는 [`CommandRecord`] 가 없다) 수명을 여기서 쥔다 — 줄이
   * 스크롤백 밖으로 밀리면 xterm 이 마커와 함께 알아서 걷고, 나머지는 `dispose` 가 걷는다.
   */
  readonly restored: IDecoration[];
  /**
   * 지금 두르고 있는 **블록 띠** ([`CommandApi.bandBlock`]) — 터미널당 하나다.
   *
   * 마커를 함께 드는 이유는 수명 때문이다: 그 줄이 스크롤백 밖으로 밀리면 xterm 이 마커와
   * 함께 데코를 걷지만 **이 참조는 남는다**. [`sweepBlockLines`] 가 그때 여기를 비운다
   * (죽은 데코를 다시 dispose 하는 것은 무해하지만, 살아 있는 척하는 참조는 아니다).
   */
  band: { deco: IDecoration; marker: IMarker } | null;
  /**
   * **이 터미널의 133 을 내는 쪽** — 처음 본 `A` 의 태그로 고정된다 (설계 §5 ②).
   *
   * 남의 셸 통합이 이미 서 있으면 프롬프트마다 `A` 가 둘이 되어 블록이 갈라진다. 셸 쪽
   * 탐지([`SNIPPET`] 의 첫 `if`)가 대부분을 막지만 **아는 이름만** 보므로, 최종 결정은
   * 여기서 한다: 고정된 태그와 다른 마커는 **버린다**. 목표는 "우리가 이긴다" 가 아니라
   * **"살아 있는 소스가 정확히 하나다"** 이고, 그래서 남의 133 이 먼저 오면 그쪽이 이긴다
   * (우리 소비 기능은 태그를 가리지 않는다).
   *
   * 고정은 [`ShellIntegration.dispose`] 와 [`ShellIntegration.resetSource`](세션 교체)에서 풀린다.
   */
  sourceTag: MarkerTag | null;
  /**
   * **지금 프롬프트에서 명령을 치는 중인가** (`B` 뒤 `C` 앞 — [`ShellIntegration.inputAnchor`]).
   *
   * 전이 규칙은 순수 함수([`inputModeAfter`])가 쥐고 여기서는 그 결과만 든다. 셸이 갈리면
   * (재연결·이관) 뜻을 잃으므로 [`resetSource`] 와 [`dispose`] 에서 함께 꺼진다.
   */
  inputMode: boolean;
  readonly diag: { foreignDropped: number; collapsedPrompts: number };
  /**
   * `ED 3`(스크롤백 지우기) 뒤 **다음 133 에서** 한 번 보는 빈 줄 검사가 남아 있는가.
   *
   * Windows 의 `clear`(Clear-Host · `cls`)는 ConPTY 를 거치며 `CSI 2 J` 가 **아니라**
   * `CSI 3 J` + 줄마다 `CSI K` + `CSI H` 로 온다 (실기 2026-09-27). 화면 줄을 지우는 것은 뒤따르는
   * `CSI K` 들이라 `J` 를 보는 그 순간에는 아직 글자가 있다 — 그래서 셸이 돌아와 다음 마커
   * (`D`·`A`)를 낼 때, 새 프롬프트 글자가 찍히기 **전에** 화면의 프롬프트 줄이 비었는지 본다.
   * 빈 줄 검사는 `ED 3` 만 온 경우(화면은 그대로)에 화면의 띠를 잘못 걷지 않게 하는 조건이다.
   */
  eraseCheckPending: boolean;
}

/** 새 상태 — 초기값은 옛 지역 변수의 초기값 그대로다 */
export function createState(
  term: Terminal,
  onstatus: (status: PaneStatus | null) => void,
  sink?: BlockSink,
): SiState {
  return {
    term,
    onstatus,
    sink,
    records: [],
    status: null,
    cwd: null,
    jumpCursor: null,
    blockLines: new Map<number, IMarker>(),
    restored: [],
    band: null,
    sourceTag: null,
    inputMode: false,
    diag: { foreignDropped: 0, collapsedPrompts: 0 },
    eraseCheckPending: false,
  };
}
