// **내부 전용** — 터미널 하나에 붙은 셸 통합의 공유 상태. 바뀌는 상태는 이 객체에만 산다.

import type { IDecoration, IMarker, Terminal } from "@xterm/xterm";
import type { Tr } from "$lib/finish-notify";
import { FALLBACK_LOCALE, translate } from "$lib/i18n/dict";
import type { BlockSink, MarkerTag, PaneStatus } from "./types";

/** 싱크 없는 부름의 문구 — 언제나 한국어. vitest 가 그대로 돌리는 순수 모듈이라 `i18n.svelte.ts`(룬)를 못 들인다. */
export const koTr: Tr = (key, params) => translate(FALLBACK_LOCALE, key, params);

export interface CommandRecord {
  /** A — 점프의 착지점이자 실패 표시 자리 */
  promptMarker: IMarker;
  /** B — 여기부터가 사용자가 친 글자. B 를 안 보내는 훅도 있어 `null` 이 정상값이다 */
  bMarker: IMarker | null;
  bCol: number;
  /** C — 출력의 첫 줄 */
  cmdMarker: IMarker | null;
  /** D — 출력의 끝, 이 줄은 포함하지 않는다 */
  outMarker: IMarker | null;
  exit: number | null;
  decorations: IDecoration[];
}

export const MAX_RECORDS = 2000;

export interface SiState {
  readonly term: Terminal;
  readonly onstatus: (status: PaneStatus | null) => void;
  readonly sink?: BlockSink;
  readonly records: CommandRecord[];
  status: PaneStatus | null;
  cwd: string | null;
  /** records 인덱스 · `null` = 바닥(지금 프롬프트)에서 새로 시작 */
  jumpCursor: number | null;
  /** 블록 id → 프롬프트 마커 — 값이 마커라 스스로 낡는다: 죽은 항목은 쓸고, 넣은 순서대로 `MAX_RECORDS` 까지만 남긴다 */
  readonly blockLines: Map<number, IMarker>;
  /** `restoreMarkers` 가 그린 실패 표시 — 레코드에 딸리지 않아 수명을 여기서 쥔다 */
  readonly restored: IDecoration[];
  /** 마커를 함께 드는 것은 줄이 밀려 데코가 걷혀도 이 참조가 남기 때문이다 — `sweepBlockLines` 가 비운다 */
  band: { deco: IDecoration; marker: IMarker } | null;
  /**
   * 처음 본 `A` 의 태그로 고정 — 목표는 "살아 있는 출처가 정확히 하나다" 라 남의 133 이 먼저 오면 그쪽이 이긴다.
   * 셸 쪽 탐지는 아는 이름만 보므로 최종 결정은 여기서 한다. `dispose` · `resetSource`(세션 교체)에서 풀린다.
   */
  sourceTag: MarkerTag | null;
  /** `B` 뒤 `C` 앞 — 셸이 갈리면(재연결 · 이관) 뜻을 잃어 `resetSource` · `dispose` 에서 꺼진다 */
  inputMode: boolean;
  readonly diag: { foreignDropped: number; collapsedPrompts: number };
  /**
   * Windows 의 `clear` 는 ConPTY 를 거쳐 `CSI 3 J` + 줄마다 `CSI K` 로 와서 `J` 를 보는 순간엔 글자가 아직 있다 —
   * 다음 133 에서 새 프롬프트가 찍히기 전에 빈 줄을 본다. 빈 줄 조건은 `ED 3` 만 온 경우 화면 띠를 잘못 걷지 않게 한다.
   */
  eraseCheckPending: boolean;
}

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
