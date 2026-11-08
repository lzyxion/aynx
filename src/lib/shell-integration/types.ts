// 셸 통합의 **공개 모양** — 패널 상태 · 명령 스냅숏 · 마커 거리 · 창구(`CommandApi`·`ShellIntegration`) · 싱크(`BlockSink`).
// 값은 없다(타입만). 모든 형제가 여기서 모양을 받아 간다.

import type { CommandBlock } from "$lib/block-history";
import type { Tr } from "$lib/finish-notify";
import type { InputAnchor } from "$lib/snippet-input";

/**
 * 패널 하나의 명령 상태. `null` = OSC 133 을 한 번도 못 봤다 (= 알 수 없다).
 * "실행 중" 은 살아 있는 값이고, "성공/실패" 는 다음 명령이 시작될 때까지 유지된다.
 */
export type PaneStatus = "running" | "ok" | "fail";

/** 6단계(MCP `get_last_command`) 가 먹을 재료 — 마지막 명령 한 건의 스냅숏 */
export interface CommandSnapshot {
  /**
   * 사용자가 친 **명령문**(화면에서 읽은 것). `B`(프롬프트 끝)부터 `C` 직전까지라
   * 프롬프트 문자열은 **빠져 있다**. `B` 를 안 보내는 훅에서는 어쩔 수 없이 프롬프트가
   * 앞에 붙는다 (`commandLineOf` 의 폴백).
   * **정확한 명령 문자열은 서버의 `~/.aynx/history` 에 있다** (스니펫이 D 시점에 적는다).
   */
  commandLine: string;
  /** C~D 구간 텍스트 (`isWrapped` 를 이어붙인 논리 줄). 아직 안 끝났으면 "" */
  output: string;
  /** 종료 코드. 아직 실행 중이면 null */
  exit: number | null;
  /** 지금 실행 중인가 */
  running: boolean;
}

/**
 * 블록 하나의 프롬프트 줄을 **버퍼 바닥에서 몇 줄 위인가**로 적은 값 — 창 이관에 실린다
 * (docs/log/2026-09-08-block-history-store.md 의 "이관 뒤 마커 복원").
 *
 * 마커 자체(`IMarker`)는 xterm 버퍼 좌표라 창을 못 건넌다. 그런데 이관에 실리는 것은 셀
 * 내용뿐이라(`SerializeAddon`) OSC 133 은 새 창에 도착하지 않고, 그래서 지금까지 넘어간
 * 타일은 `#` 검색에서 블록을 **찾기는 하는데 점프는 못 하는** 상태였다("밀려난 블록"
 * 안내가 떴다 — 실기 확인 2026-09-09).
 *
 * 그 다리가 이 값이다: **줄 번호가 아니라 거리**를 실으면 새 창에서 다시 절대 줄로 풀 수 있다.
 *
 * ## 바닥은 `buffer.length` 가 아니라 **커서 줄**이다
 *
 * `buffer.active.length` 는 `baseY + rows` 라 **창 크기(rows)를 탄다** — 분리 창은 거의
 * 언제나 소스 창과 크기가 다르므로, 그 값을 기준으로 재면 짧은 버퍼에서 거리가 통째로
 * 어긋난다(내용 10줄·30행 창에서 뜬 값을 24행 창에서 풀면 음수가 된다). 반면 커서 줄
 * (`baseY + cursorY`)은 **내용의 끝**이라 직렬화가 그대로 재현하는 자리이고, xterm 의
 * `registerMarker(cursorYOffset)` 가 쓰는 기준이기도 하다 — 즉 되돌릴 때 변환이 없다.
 */
export interface MarkerDistance {
  /** [`CommandBlock.id`] — 타일 안에서만 뜻이 있는 번호라 창을 건너도 그대로 둔다 */
  blockId: number;
  /** 커서 줄에서 **위로** 몇 줄인가 (0 = 커서와 같은 줄) */
  promptFromBottom: number;
}

/** 패널 밖(패널 헤더·MCP)에서 이 패널의 명령 레코드를 두드리는 창구 */
export interface CommandApi {
  /** 마지막 명령 한 건 (없으면 null) */
  last(): CommandSnapshot | null;
  /** 이전(-1)·다음(+1) 프롬프트로 스크롤. 갈 곳이 없으면 false */
  jump(dir: -1 | 1): boolean;
  /**
   * 블록 하나(`CommandBlock.id`)가 시작한 **프롬프트 줄 번호** — 없으면 `null`.
   *
   * `#` 블록 검색의 결과를 고르면 그 줄로 스크롤해야 하는데, 블록 이력(`block-history.ts`)은
   * **마커를 일부러 들지 않는다**(그래야 이관·직렬화가 된다). 그래서 "블록 → 줄" 을 아는
   * 자리는 마커를 쥔 이 모듈뿐이고, 이 창구가 그 다리다.
   *
   * `null` 이 뜻하는 것은 **"화면에서 밀려났다"** 이지 "그런 블록이 없다" 가 아니다 —
   * 스크롤백 밖으로 나간 줄의 마커는 xterm 이 스스로 dispose 하고, 그래도 블록 자체(명령문·
   * 종료 코드·발췌)는 이력에 남는다. 부르는 쪽은 그 경우 점프 대신 안내를 띄운다.
   */
  lineOfBlock(blockId: number): number | null;
  /**
   * 블록 하나를 **띠로 두른다** — 프롬프트 줄부터 그 블록의 마지막 출력 줄까지에 반투명
   * 강조를 깔고 왼쪽 가장자리에 세로선을 세운다. `false` = 그릴 자리가 없다(마커가 밀려났다).
   *
   * `#` 검색의 점프가 착지한 뒤 부른다. 점프만으로는 **매치된 글자 몇 개만** 강조되어 그
   * 블록이 어디서 시작해 어디서 끝나는지가 화면에서 읽히지 않는다 — 상태 띠(거터 3px)는
   * 프롬프트 한 줄에만 서므로 출력의 범위를 말해 주지 못한다.
   *
   * 수명은 **남긴 강조([`stepKept`])와 같다**: 그 터미널에 키를 치거나 포커스를 잃으면
   * 사라지고, 다음 점프가 새 띠로 갈아 끼운다. 터미널당 하나뿐이다 (`Terminal.svelte` 가
   * 그 계기들을 [`clearBand`] 로 배선한다).
   */
  bandBlock(blockId: number): boolean;
  /** 지금 두른 띠를 걷는다 (없으면 아무 일도 하지 않는다) */
  clearBand(): void;
  /**
   * 지금 살아 있는 블록 마커들의 **거리 목록** ([`MarkerDistance`]) — 이관이 실어 보낸다.
   *
   * [`lineOfBlock`] 의 뒷면이다: 저쪽은 "블록 → 이 창의 줄", 이쪽은 "블록 → 창을 건널 수
   * 있는 값". 죽은 마커는 빠지므로 목록은 언제나 **지금 되짚을 수 있는 블록들**이다.
   */
  markerDistances(): MarkerDistance[];
  /** 마지막 **완료된** 명령의 출력만 클립보드로 */
  copyOutput(): Promise<CopyResult>;
  /**
   * 지금 [`copyOutput`] 을 부르면 복사될 것이 있는가 — 즉 **끝난 OSC 133 블록**이 있고
   * 그 출력이 비어 있지 않은가. 메뉴가 그 항목을 흐리게 그릴지 정하는 데만 쓴다
   * (docs/log/2026-09-05-terminal-context-menu.md).
   *
   * 물음을 여기 두는 이유: 답을 아는 것은 마커를 들고 있는 이 모듈뿐이고, 그걸 밖에서
   * 흉내 내면 "메뉴는 눌리는데 토스트만 '복사할 출력이 없습니다'" 로 어긋난다.
   */
  canCopyOutput(): boolean;
  /** 지금 상태 (`null` = OSC 133 없음) */
  status(): PaneStatus | null;
  /**
   * 셸이 **스스로 알려 준** 현재 폴더 (OSC 7 · OSC 9;9). 한 번도 못 봤으면 `null`.
   *
   * 이 값을 믿는 이유는 셸이 자기 상태를 직접 말한 것이기 때문이다 — 프로세스를 뒤져
   * 얻은 값(`local_cwd`)보다 정확하고, 원격 셸에서도 성립한다. 그래서 로컬 타일의 📂 가
   * 폴더를 정할 때 **첫 번째로** 본다 (`app/panes.svelte.ts` 의 `openFilesFor`).
   */
  cwd(): string | null;
  /**
   * 버퍼의 **마지막 N 논리 줄** (6단계 — AI 컨텍스트 미러링). 스크롤백 꼬리를 서버에
   * 비춰 둘 때 쓴다. 버퍼 읽기를 한 곳(`readLines`)에 모아 두려고 여기에 둔다 —
   * OSC 133 이 없는 세션이어도 동작한다 (마커가 아니라 화면 텍스트를 읽으므로).
   */
  tail(lines: number): string[];
  /**
   * 블록 하나의 **출력 전부**(`C`..`D` 의 논리 줄 — "출력만 복사" 와 같은 읽기) — 마커가 밀려났거나 이관으로
   * 넘어온 블록(프롬프트 마커만 있다)이면 `null`. 블록을 AI 타일에 넘길 때 **이력의 발췌보다 먼저** 본다:
   * 발췌는 가운데를 버려 "앞 N줄 생략" 의 N 을 모르지만 버퍼는 전부를 안다
   * (docs/log/2026-09-28-ask-ai-block.md).
   */
  blockOutput(blockId: number): string[] | null;
}

/**
 * 출력 복사의 결말. 실패를 예외로 던지지 않는 이유는 호출부가 전부 UI 라서다 —
 * 사용자에게 보여 줄 한 줄이 필요하지 스택 트레이스가 필요한 게 아니다.
 */
export type CopyResult =
  | "ok"
  /** 복사할 것이 없다 (완료된 명령이 없거나 출력이 비었거나 스크롤백 밖으로 밀렸다) */
  | "empty"
  /** 클립보드를 못 썼다 (권한·비보안 컨텍스트) */
  | "denied"
  /** 그 패널에 터미널이 없다 (아직 마운트 전 · 이미 언마운트) */
  | "none";

export interface ShellIntegration extends CommandApi {
  dispose(): void;
  /**
   * **세션이 갈렸다** — 소스 고정을 푼다 (재연결 · 창 이관으로 다른 셸이 이 터미널에 붙었다).
   *
   * 고정(`sourceTag`)은 "이 셸의 133 은 누가 내는가" 라 셸이 바뀌면 뜻을 잃는다. 터미널은
   * 그대로 살아 있으므로(스크롤백·레코드 유지) 여기서 푸는 수밖에 없다 — 안 풀면 새 셸의
   * 마커가 옛 태그와 다를 때 통째로 버려진다.
   */
  resetSource(): void;
  /**
   * **이관으로 넘어온 마커를 다시 심는다** — 되살린 개수를 돌려준다
   * (docs/log/2026-09-08-block-history-store.md 의 "이관 뒤 마커 복원").
   *
   * 부르는 자리는 하나다: 새 창의 터미널이 `restore.buffer` 를 **다 쓴 뒤**
   * (`Terminal.svelte` 의 `t.write` 콜백). 그 전에 부르면 버퍼가 아직 비어 있어 전부
   * 범위 밖으로 떨어진다.
   *
   * 심는 것은 **블록 → 프롬프트 줄** 다리(`lineOfBlock`)와 실패 표시뿐이다.
   * [`CommandRecord`] 상태 기계는 건드리지 않는다 — 그 레코드들은 살아 있는 셸의 것이고,
   * 넘어온 화면은 이미 지나간 출력이라 점프 목록·`last()` 가 그것을 다시 세면 안 된다
   * (다음 프롬프트부터 새 셸의 레코드가 평소대로 쌓인다).
   */
  restoreMarkers(entries: readonly MarkerDistance[]): number;
  /**
   * **지금 프롬프트에서 명령문이 시작하는 자리** (`null` = 입력 모드가 아니다) —
   * 인라인 스니펫 제안이 읽는 값이다 (docs/log/2026-09-16-snippets.md 의 "입력 중 제안").
   *
   * 입력 모드는 **`B` 뒤 `C` 앞**이고, 그 전이는 순수 규칙 하나가 정한다
   * ([`inputModeAfter`]). 여기서 더하는 것은 **줄이 살아 있다는 사실**뿐이다: 값을 `B`
   * 시점에 복사해 두면 화면이 스크롤할 때마다 어긋나므로, 줄은 마커(`bMarker`)에게 묻고
   * 열만 그때의 값(`bCol`)을 쓴다.
   *
   * [`CommandApi`] 가 아니라 이쪽에 있는 이유: 이 값을 읽는 곳은 **그 터미널을 직접 쥔
   * 컴포넌트 하나**뿐이라 레지스트리를 지날 이유가 없다 (창 밖에서 두드릴 창구가 아니다).
   */
  inputAnchor(): InputAnchor | null;
  /**
   * 진단 카운터 — **자가 회복은 일부러 넣지 않는다** (CLAUDE.md 원칙 · 설계 §5 의 한계).
   * 실기에서 한 번 보고 정한다.
   */
  diagnostics(): MarkerDiagnostics;
}

/** [`ShellIntegration.diagnostics`] 가 돌려주는 것 */
export interface MarkerDiagnostics {
  /** 고정된 출처 (`null` = 아직 `A` 를 한 번도 못 봤다) */
  source: MarkerTag | null;
  /** 다른 출처라 버린 마커 수 */
  foreignDropped: number;
  /** 같은 줄에 두 번 온 `A` 를 접은 수 */
  collapsedPrompts: number;
}

/**
 * 마커의 **출처** — 우리 스니펫만 `aynx=1` 을 붙인다 (`A;aynx=1` … `D;<코드>;aynx=1`).
 * 남의 셸 통합(VS Code·iTerm2·kitty)은 태그가 없으므로 `foreign` 이다.
 */
export type MarkerTag = "aynx" | "foreign";

/**
 * **블록 이력을 쌓을 자리** (`$lib/block-history`) — 주면 `C`/`D` 마다 블록이 저장된다.
 *
 * 선택 인자인 이유는 이 모듈의 나머지(상태 띠·점프·출력 복사)가 이력 없이도 완전히
 * 동작하기 때문이다. 실제 타일은 언제나 준다 (`Terminal.svelte`).
 */
export interface BlockSink {
  /** 이 터미널이 사는 타일의 id — 이력 저장소의 키다 */
  paneId: string;
  /**
   * 블록이 **닫힐 때** 한 번 (`D`). Rust 거울로 밀어 올릴 기회다 — 공유 여부 판단은
   * 부르는 쪽(`Terminal.svelte`)이 한다. 이 모듈은 프라이버시 정책을 알지 못한다.
   */
  onblock?: (block: CommandBlock) => void;
  /**
   * **지금 도는 명령이 바뀌었다** — `C` 에서 명령문, `D` 에서 `null`(프롬프트로 돌아왔다).
   *
   * [`onblock`] 과 나눠 둔 이유는 시점이 다르기 때문이다: 저쪽은 **끝난 뒤**의 기록(발췌·
   * 종료 코드)이고 이쪽은 **도는 동안**의 사실이다. 타일 아이콘·이름이 이 값을 읽어
   * "지금 Claude Code 가 도는 칸" 을 화면에 세운다
   * (docs/log/2026-09-16-ai-tile-identity-from-command.md).
   *
   * 명령문은 [`CommandSnapshot.commandLine`]·블록 이력과 **같은 추출**이다 (`B`~`C`).
   */
  oncommand?: (commandLine: string | null) => void;
  /**
   * **셸 프롬프트가 떴다** (`A` — 출처 고정을 통과한 것만). 에이전트 상태 점이 "에이전트가 끝나
   * 셸로 돌아왔다" 를 읽는 자리다(docs/log/2026-09-24-agent-status-dot.md) — 전화면 TUI 는 `A` 를
   * 내지 않으므로 명령이 돈 뒤의 `A` 는 그 명령이 끝났다는 뜻이다. 거르는 일(에이전트 타일인가 ·
   * 명령이 돈 뒤인가)은 받는 쪽이 한다.
   */
  onprompt?: () => void;
  /**
   * **셸이 알려 준 폴더가 바뀌었다** (OSC 7 · OSC 9;9) — 값이 **달라질 때만** 부른다(프롬프트마다 오는 같은 값은
   * 삼킨다). "이 폴더의 지난 대화" 가 그 타일의 지금 폴더를 알려고 듣는다(docs/log/2026-09-27-folder-conversations.md).
   * 값은 셸이 준 글자 그대로다(WSL 이면 배포판 안의 POSIX 경로 — 옮기는 일은 받는 쪽).
   */
  oncwd?: (cwd: string) => void;
  /**
   * **몇 초 이상 걸린 명령에 시간 표식을 다나** (`[terminal] mark_after_secs`) —
   * 없거나 `0` 이하면 안 그린다.
   *
   * 값이 아니라 **함수**인 것이 요점이다: 설정은 언제든 바뀌고, 이 모듈은 설정을 구독할
   * 수 없다(룬도 임포트도 없다). 블록이 닫히는 그 순간 물어보면 바꾼 값이 **다음 블록
   * 부터** 곧바로 듣는다 — 이미 그려진 표식은 그대로 남는다(지난 화면을 소급해 고치지
   * 않는다는 이 파일의 다른 규칙들과 같다).
   *
   * 판단이 밖에 있는 이유는 `onblock` 과 같다 — 이 모듈은 프라이버시도 설정도 알지 못한다.
   */
  markAfterSecs?: () => number;
  /**
   * 표식·말풍선의 **문구를 내는 함수** (`t`). 없으면 한국어로 떨어진다.
   *
   * [`markAfterSecs`] 와 같은 이유로 **함수**다: 이 모듈은 설정도 언어도 구독할 수 없고
   * (룬도 임포트도 없다), 그리는 그 순간 물어보면 바뀐 언어가 **다음 블록부터** 곧바로
   * 듣는다 — 이미 그려진 표식은 그대로 남는다(지난 화면을 소급해 고치지 않는다).
   */
  tr?: Tr;
  /**
   * **실패 줄의 [AI에게 묻기] 단추** (docs/log/2026-09-28-ask-ai-block.md) — 있으면 실패한 블록의 프롬프트 줄
   * 배경(`.aynx-fail-row`)에 단추 하나를 심는다. 단추는 그 줄에 손을 올렸을 때만 보이고(CSS), 누르면 `run` 이
   * 블록 id 와 단추의 화면 사각형을 받는다(고르기 상자가 그 아래에 선다).
   *
   * 문구가 **함수**인 것은 [`tr`] 과 같은 이유다(그리는 순간의 언어 · 사용자가 바꾼 단축키). 판단(어느 타일로
   * 넘기나)은 이 모듈이 알지 못한다 — 부르는 쪽(`Terminal.svelte`)의 일이다.
   */
  askButton?: {
    label: () => string;
    hint: () => string;
    title: () => string;
    run: (blockId: number, rect: DOMRect) => void;
  };
  /**
   * **블록 줄의 [리치하게 보기] 단추**(2026-10-18 — `term/BlockView.svelte`) — 있으면 출력이 있는 끝난 블록의 프롬프트 줄에
   * 단추를 심는다(성공 줄은 투명한 줄 데코 `.aynx-block-row`, 실패 줄은 `.aynx-fail-row` 안 — [AI에게 묻기] 와 한
   * 묶음). 손을 올린 줄에만 보이고(CSS), 누르면 `run` 이 블록 id 와 **그 줄의 화면 사각형**(카드가 커지기 시작할 자리)을 받는다.
   */
  richButton?: {
    label: () => string;
    title: () => string;
    run: (blockId: number, rowRect: DOMRect) => void;
  };
}
