// 셸 통합의 공개 모양(타입만).

import type { CommandBlock } from "$lib/block-history";
import type { Tr } from "$lib/finish-notify";
import type { InputAnchor } from "$lib/snippet-input";

/** `null` = OSC 133 을 한 번도 못 봤다. 성공 · 실패는 다음 명령이 시작될 때까지 유지된다 */
export type PaneStatus = "running" | "ok" | "fail";

export interface CommandSnapshot {
  /** 화면에서 읽은 명령문 — 정확한 명령 문자열은 서버의 `~/.aynx/history` 에 있다 */
  commandLine: string;
  output: string;
  exit: number | null;
  running: boolean;
}

/**
 * 블록의 프롬프트 줄을 커서 줄에서 몇 줄 위인가로 적은 값 — 마커는 창을 못 건너서 이관에 이것을 싣는다.
 * 바닥은 `buffer.length` 가 아니라 커서 줄이다 — `length` 는 창 크기(rows)를 타서 다른 크기 창에서 풀면 어긋난다
 * (docs/log/2026-09-08-block-history-store.md).
 */
export interface MarkerDistance {
  blockId: number;
  /** 0 = 커서와 같은 줄 */
  promptFromBottom: number;
}

export interface CommandApi {
  last(): CommandSnapshot | null;
  jump(dir: -1 | 1): boolean;
  /** `null` = 화면에서 밀려났다이지 "그런 블록이 없다" 가 아니다 — 블록 자체는 이력에 남는다 */
  lineOfBlock(blockId: number): number | null;
  /** `#` 검색 점프 뒤에 두른다 — 터미널당 하나, 계기(키 · 포커스 잃음)는 `Terminal.svelte` 가 `clearBand` 로 배선한다 */
  bandBlock(blockId: number): boolean;
  clearBand(): void;
  markerDistances(): MarkerDistance[];
  copyOutput(): Promise<CopyResult>;
  /** 답은 마커를 든 이 모듈만 안다 — 밖에서 흉내 내면 메뉴는 눌리는데 "복사할 출력이 없습니다" 로 어긋난다 */
  canCopyOutput(): boolean;
  status(): PaneStatus | null;
  /** 셸이 스스로 알려 준 폴더 — 로컬 타일의 📂 가 프로세스 조회(`local_cwd`)보다 먼저 본다 */
  cwd(): string | null;
  /** OSC 133 이 없는 세션이어도 동작한다 (화면 텍스트를 읽는다) */
  tail(lines: number): string[];
  /** 마커가 밀려났거나 이관으로 넘어온 블록이면 `null` — 발췌는 가운데를 버려 버퍼보다 먼저 본다 (docs/log/2026-09-28-ask-ai-block.md) */
  blockOutput(blockId: number): string[] | null;
}

export type CopyResult =
  | "ok"
  | "empty"
  /** 권한 · 비보안 컨텍스트 */
  | "denied"
  /** 그 패널에 터미널이 없다 */
  | "none";

export interface ShellIntegration extends CommandApi {
  dispose(): void;
  /** 세션이 갈렸다(재연결 · 이관) — 안 풀면 새 셸의 마커가 옛 태그와 다를 때 통째로 버려진다 */
  resetSource(): void;
  /**
   * 새 창이 `restore.buffer` 를 다 쓴 뒤에 부른다 — 그 전이면 버퍼가 비어 전부 범위 밖으로 떨어진다.
   * 레코드 상태 기계는 건드리지 않는다 — 넘어온 화면은 지나간 출력이라 점프 목록 · `last()` 가 다시 세면 안 된다.
   */
  restoreMarkers(entries: readonly MarkerDistance[]): number;
  /** `null` = 입력 모드가 아니다. 창 밖에서 두드릴 창구가 아니라 `CommandApi` 에 두지 않는다 (docs/log/2026-09-16-snippets.md) */
  inputAnchor(): InputAnchor | null;
  /** 진단 카운터 — 자가 회복은 일부러 넣지 않는다 (CLAUDE.md 원칙) */
  diagnostics(): MarkerDiagnostics;
}

export interface MarkerDiagnostics {
  source: MarkerTag | null;
  foreignDropped: number;
  collapsedPrompts: number;
}

/** 우리 스니펫만 `aynx=1` 을 붙인다 — 남의 셸 통합은 `foreign` */
export type MarkerTag = "aynx" | "foreign";

export interface BlockSink {
  paneId: string;
  /** 공유 여부 판단은 부르는 쪽이 한다 — 이 모듈은 프라이버시 정책을 알지 못한다 */
  onblock?: (block: CommandBlock) => void;
  /** `C` 에서 명령문, `D` 에서 `null` (docs/log/2026-09-16-ai-tile-identity-from-command.md) */
  oncommand?: (commandLine: string | null) => void;
  /** 출처 고정을 통과한 `A` 만 — 전화면 TUI 는 `A` 를 내지 않아 명령 뒤의 `A` 는 그 명령이 끝났다는 뜻이다 */
  onprompt?: () => void;
  /** 바뀔 때만 · 셸이 준 글자 그대로(WSL 이면 배포판 안의 POSIX 경로) */
  oncwd?: (cwd: string) => void;
  /** 함수인 것은 설정을 구독할 수 없어서다 — 바꾼 값은 다음 블록부터, 이미 그린 표식은 그대로 */
  markAfterSecs?: () => number;
  /** 없으면 한국어. 함수인 이유는 `markAfterSecs` 와 같다 */
  tr?: Tr;
  askButton?: {
    label: () => string;
    hint: () => string;
    title: () => string;
    run: (blockId: number, rect: DOMRect) => void;
  };
  richButton?: {
    label: () => string;
    title: () => string;
    run: (blockId: number, rowRect: DOMRect) => void;
  };
}
