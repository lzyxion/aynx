/**
 * **타일 ⋯ 메뉴의 항목 목록 — 데이터로** (docs/log/2026-09-05-titlebar-cleanup.md).
 *
 * 예전에는 항목 아홉 줄이 마크업 안에 `{#if}` 로 흩어져 있었다. 그래서 "SFTP 타일의
 * 메뉴에는 무엇이 뜨는가" 라는 물음에 답하려면 세 개의 `{#if}` 를 머릿속에서 겹쳐 봐야
 * 했고, 종류가 하나 늘 때 어느 조건에 걸리는지도 그때그때 다시 읽어야 했다.
 *
 * 여기서는 **순수 함수 하나**가 그 표를 만든다. 그리는 일은 `PaneMenu.svelte` 가 하고,
 * 무엇을 그릴지는 이 파일이 정한다 — 그래서 종류별 목록이 테스트로 고정된다.
 *
 * ## 종류별 표 (2026-09-17 — 묶음 둘이 `▸` 로 접혔다)
 *
 * | 타일 종류 | 줄 |
 * | --- | --- |
 * | `ssh` | 분할 2 · **서버 ▸** · **출력 ▸** · AI 권한… · 동시 입력 · 분리 · 닫기 (8) |
 * | `local` | 분할 2 · **출력 ▸** · AI 권한… · 동시 입력 · 분리 · 닫기 (7) |
 * | `query` | 분할 2 · AI 권한… · 분리 · 닫기 (5) — DB 연결 하나의 단계(10-14) |
 * | `settings`·`localfs`·`branches`·`diff`·`plans` | 분할 2 · 분리 · 닫기 (4) |
 * | `doc` (로컬 파일) | 분할 2 · 경로 복사 · 새 문서… · 분리 · 닫기 (6) |
 * | `doc` (원격 — `ctx.borrowed`) | 분할 2 · 경로 복사 · 새 문서… · 닫기 (5) — **분리가 빠진다** · 끊기면 새 문서…는 흐리게 |
 * | `sftp` | 분할 2 · 닫기 (3) — **분리가 빠진다** |
 * | `start` | 분할 2 · 닫기 (3) — 애초에 헤더가 붙지 않는다 |
 *
 * **폰 배치(`ctx.solo` · 10-20)는 모든 종류에서 분할 2 · 분리가 빠진다** — 늘 타일 하나 · 창 하나다.
 *
 * 문서 도구줄에 따로 있던 ⋯ 는 걷었다(한 타일에 ⋯ 가 위아래 둘이었다). 자동 새로고침 정보는 새로고침 단추 툴팁에 있다.
 *
 * 옆목록에 든 것 — **서버**: 포트 포워딩… · 원격 파일 · 원격 파일 편집… (+ tmux 타일이면
 * tmux 세션…) · **출력**: 마지막 출력 복사 · 스크롤백 저장… · 세션 로그 열기.
 *
 * **AI 줄은 어느 종류나 "AI 권한…" 하나다** (2026-10-07 원격 · 10-14 쿼리 · 10-23 로컬): 누르면 권한 팝오버
 * (`AiPermMenu.svelte`)를 연다. 원격은 **호스트 하나의 단계**, 로컬은 타일별 읽기 허용(Off · Read 만 — Ask 부터 잠김, 실행 권한
 * 없음 · 예전 체크 "AI 읽기 허용")이다. 호스트 목록에 없는 원격 타일(빠른 접속)은 흐리게 두고
 * "호스트로 저장하면 AI 권한을 줄 수 있습니다" 를 말한다.
 *
 * SSH 타일의 줄이 열다섯까지 자라 있었다 — 한 화면에 열다섯 줄이면 목록은 읽는 것이지
 * 겨누는 것이 아니게 된다. 접은 기준은 **대상**이다: `서버` 는 저 끝의 기계에 거는 일,
 * `출력` 은 이 타일이 만들어 낸 글자를 가져가는 일이고, 남은 줄들은 타일 자신에 건다
 * (docs/log/2026-09-17-tile-menu-flyouts.md).
 *
 * **"로그 폴더 열기" 는 이 메뉴를 떠났다** — 대상이 타일이 아니라 앱 전역의 한 폴더라
 * 타일마다 같은 줄이 서 있을 이유가 없었다. 지금은 설정 › 터미널의 "세션 로그 폴더" 줄과
 * 호스트 폼의 [폴더 열기] 둘이 그 문이다.
 *
 * SFTP 타일에서 "새 창으로 분리" 가 빠지는 근거는 `startPaneTear` 의 판정과 같다: 옆
 * 터미널의 세션을 빌려 쓰므로 혼자 새 창에 가면 그 자리에서 원본을 잃는다. 시작 타일은
 * 옮겨 봐야 같은 안내 화면이다.
 *
 * ## 메뉴가 둘, 정의는 하나 (docs/log/2026-09-05-terminal-context-menu.md)
 *
 * 터미널 본문 우클릭도 메뉴를 낸다. 그쪽은 위 표 **앞에** 화면·클립보드 항목을 얹은
 * 것뿐이라 [`terminalMenuItems`] 가 [`menuItemsFor`] 를 그대로 다시 쓴다 — 항목이 하나 늘
 * 때 "어느 메뉴에 넣을 것인가" 를 두 번 판단하지 않는다.
 */

import { hasSession, type PaneKind, type Tr } from "$lib/session";
import { snippetSaveLabel } from "$lib/snippets";
import { AI_STAGES, AI_STAGE_NAME, type AiStage } from "$lib/delegation";
import { DB_AI_LEVELS, DB_AI_NAME, type DbAiLevel } from "$lib/db-ai";
import { gaugeIconName, gaugeIndex } from "$lib/ai-gauge";

/** 항목의 신원 — 누른 결과를 상위 콜백으로 잇는 열쇠다 (`PaneHost` 의 `runTileMenu`) */
export type PaneMenuAction =
  // ── 터미널 우클릭 메뉴에만 뜨는 것들 (docs/log/2026-09-05-terminal-context-menu.md) ──
  /** 우클릭한 자리의 링크를 브라우저로 */
  | "open-link"
  /** 그 링크 주소를 클립보드로 */
  | "copy-link"
  /** 선택된 텍스트를 클립보드로 */
  | "copy"
  /** 클립보드 → 터미널 (여러 줄이면 확인을 한 번 묻는다) */
  | "paste"
  /** 버퍼 전체 선택 */
  | "select-all"
  /** 화면 지우기 (xterm `clear()` — 셸에 `clear` 를 보내는 것이 아니다) */
  | "clear-screen"
  /**
   * 우클릭한 줄의 명령(또는 이 타일의 마지막 명령)을 **스니펫으로 저장**한다 —
   * 저장 대화상자를 연다 (docs/log/2026-09-16-snippets.md).
   */
  | "save-snippet"
  /**
   * 우클릭한 줄의 블록(또는 이 타일의 마지막 끝난 블록)을 **AI 타일 입력 줄에 붙여 넣는다** — 받을 타일을
   * 고르는 상자가 뜰 수 있다 (docs/log/2026-09-28-ask-ai-block.md).
   */
  | "ask-ai"
  /**
   * **사이드 채팅에 묻기**(사이드 채팅 v2 5단계 — docs/log/2026-10-23-side-chat-dock.md 결정 11) — 고른 글자(없으면 그 블록)를 지금 사이드
   * 채팅 입력 칸에 채우고(보내지 않는다) 이 타일을 연결 칩에 건다. 독이 있는 주 창에서만 선다.
   */
  | "ask-side-chat"
  // ── 헤더 ⋯ 와 공통 ────────────────────────────────────────────────────────
  | "split-row"
  | "split-col"
  /**
   * **이 폴더의 지난 대화** — 이 타일의 폴더(워크트리)의 지난 대화를 팔레트 자리에 불러 이 타일 옆에 분할로 연다
   * (docs/log/2026-09-27-folder-conversations.md). 터미널 타일(로컬 · SSH)에만 선다 — SSH 타일은 폴더가 없어
   * 그 탭의 프로젝트 폴더로 물러선다.
   */
  | "folder-conversations"
  /**
   * **사이드 채팅에서 이어 가기**(사이드 채팅 v2 6단계) — 이 AI 타일의 대화를 새 사이드 채팅으로 갈라 온다(원본 · 타일은 그대로). 주 창의 로컬 AI
   * 타일이고 그 대화 연결(`agentLink`)을 알 때만 선다([`PaneMenuCtx.sideChatFork`]).
   */
  | "continue-side-chat"
  /**
   * **오케스트레이션으로 이어 가기**(2단계 단계 5 — 노트 5-3) — 이 로컬 AI 타일의 대화를 새 오케스트레이션 탭의 프로듀서 채팅으로 갈라 온다
   * (이 타일은 그대로 · 스튜디오는 서버가 그 대화의 기록된 cwd 에서 정한다). 오케스트레이션 탭 밖 · 대화를 아는 로컬 AI 타일에만 선다([`PaneMenuCtx.orchContinue`]).
   */
  | "continue-orchestration"
  | "forward"
  | "edit-remote"
  | "sftp"
  /** **tmux 타일만** — 서버의 tmux 세션 목록을 여는 팝오버 (전환·새 타일로 열기) */
  | "tmux-sessions"
  | "copy-output"
  /**
   * 이 타일의 **스크롤백 전체를 `.txt` 로 저장**한다 — 저장 대화상자를 연다
   * (docs/log/2026-09-17-scrollback-export-and-logs.md).
   */
  | "save-scrollback"
  /** 이 세션이 쓰고 있는 **세션 로그 파일**을 OS 기본 앱으로 (로깅이 켜진 타일만 눌린다) */
  | "session-log"
  // `logs-folder` 는 2026-09-17 에 이 메뉴를 떠났다 (설정 › 터미널 · 호스트 폼).
  /** **원격 · 쿼리 · 로컬 타일** — 호스트(원격) · DB 연결(쿼리) · 이 타일(로컬 — Off · Read 만)의 AI 권한 팝오버를 연다 */
  | "ai-permission"
  /**
   * **문서 타일만**(10-20) — 그 문서의 전체 경로(원격이면 원격 경로 — 별칭 없이)를 클립보드로. 머리줄 도구줄의 경로 글자를 걷은 대신
   * 이 줄의 말풍선이 경로를 보여 준다([`PaneMenuCtx.docPath`]). 파일 타일 우클릭의 "경로 복사" 와 같은 이름 · 같은 알림.
   */
  | "copy-path"
  /**
   * **문서 타일만**(2026-11-11) — 지금 문서와 같은 폴더 · 같은 백엔드에 새 문서를 만드는 이름 상자를 연다(`app/new-doc`). 타일 ⋯ 와 본문 우클릭(읽기
   * 모양 — `doc-menu.ts`)이 같은 줄([`newDocItem`])을 쓰고, 배선은 `tile-menu-controller` 의 한 칸이다([`PaneMenuCtx.docNew`]).
   */
  | "new-doc"
  | "toggle-sync"
  | "detach"
  | "close"
  // ── 폰(원격 웹 R5)의 위 띠 ⋯ 메뉴에만 — 머리줄을 그리지 않는 폰에서 **머리줄에만 있던 단추**의 자리([`PaneMenuCtx.phone`]) ──
  /** AI 타일의 [터미널 ⇄ 대화] 단추 — 누르면 `to` 쪽 면으로 */
  | "flip"
  /** 로컬 터미널의 폴더 칩 — 그 폴더의 파일 타일(원격은 "서버 ▸ 원격 파일" 이 같은 일이다) */
  | "files"
  /** 브랜치 칩 — 그 타일이 선 프로젝트의 브랜치 타일 */
  | "branches"
  // ── 타일이 머리줄 ⋯ 에 얹은 도구 줄([`PaneMenuCtx.tools`] · `pane/pane-tools.svelte.ts` — 2026-10-20) ──
  /** `tool:<열쇠>` — 누르면 그 타일이 맡긴 실행 함수가 열쇠로 불린다(파일 타일의 새로고침 · 숨김 파일 · 장소 · 미리 보기 …) */
  | `tool:${string}`;

export interface PaneMenuItem {
  action: PaneMenuAction;
  label: string;
  /**
   * 앞자리 **아이콘 이름** (`ui-icons.generated.ts` 의 키) — 없으면 `null` 이고 칸은
   * 빈 채로 폭만 차지한다. 체크 항목은 켜졌을 때만 `"check"` 다.
   *
   * 2026-09-15 에 글자 한 자(`◫ ⬓ ⧉ ↗ ×` …)에서 이름으로 바꿨다 — 앱 크롬의 다른 자리와
   * 같은 이유다(글꼴이 바뀌면 모양도 바뀌고, 한 메뉴 안에서 굵기·광학 중심이 제각각이었다).
   * 그리는 쪽은 `<UiIcon />` 한 줄이고, **오타는 빈 칸으로 조용히 사라지므로** 이 파일의
   * 이름이 실제로 생성 목록에 있는지 테스트가 본다 (`status-items.ts` 와 같은 처방).
   */
  icon: string | null;
  /** 체크 항목인가 — `role="menuitemcheckbox"` + `aria-checked` 가 붙는다 */
  checkbox?: boolean;
  checked?: boolean;
  /** 지금은 뜻이 없다 (흐리게 + 툴팁이 어디서 켜는지 말한다). 숨기지 **않는** 이유는 §동시 입력 */
  disabled?: boolean;
  title?: string;
  /** 이 항목 **앞에** 구분선을 하나 긋는다 */
  separator?: boolean;
  /** 오른쪽 끝에 흐리게 적는 단축키 글자 — 없거나 빈 글자면 적지 않는다 */
  hint?: string;
}

/**
 * 옆목록의 신원 — `data-flyout` 속성으로 그대로 나간다 (헤드리스 스크립트가 겨누는 이름).
 * 액션 id 와 같은 값 공간에 살지 않으므로 둘이 섞일 일이 없다.
 */
export type PaneFlyoutId = "server" | "output" | "format" | "paragraph" | "insert" | "copy-as" | "filter" | "refs";

/**
 * **옆목록을 여는 줄** (`▸`). 누르면 실행되는 것이 없어 [`PaneMenuItem`] 과 다른 모양이다 —
 * `action` 대신 [`flyout`] 을 갖고, 진짜 항목은 전부 [`children`] 안에 있다.
 *
 * 한 켜만 판다. 목록 안에 또 `▸` 가 서면 손이 지나야 하는 빈틈이 둘이 되고, 그것은 이 앱이
 * 2026-09-15 에 "들어갔다 나오는 메뉴가 주된 길이 되면 안 된다" 며 물린 그 모양이다.
 */
export interface PaneMenuGroup {
  flyout: PaneFlyoutId;
  label: string;
  icon: string | null;
  /** 옆목록에 설 줄들 — 전부 평범한 항목이다 */
  children: PaneMenuItem[];
  /** **자식이 전부 흐리면** 부모도 흐리다 (사유는 첫 자식의 것을 그대로 쓴다) */
  disabled?: boolean;
  title?: string;
  separator?: boolean;
}

/** 메뉴의 한 줄 — 누르는 항목이거나, 옆목록을 여는 부모 줄이다 */
export type PaneMenuRow = PaneMenuItem | PaneMenuGroup;

/** 이 줄이 옆목록을 여는 줄인가 */
export function isGroup(row: PaneMenuRow): row is PaneMenuGroup {
  return "flyout" in row;
}

/**
 * 줄의 신원 하나 — `{#each}` 의 키이자 `dropRows` 가 견주는 값이다.
 * 항목이면 액션 id, 부모 줄이면 옆목록 id 다 (둘은 겹치지 않는다).
 */
export function rowId(row: PaneMenuRow): PaneMenuAction | PaneFlyoutId {
  return isGroup(row) ? row.flyout : row.action;
}

/**
 * 자식 몇을 옆목록 한 줄로 묶는다.
 *
 * **전부 흐린 목록은 부모도 흐리다.** 자식이 하나도 눌리지 않는데 부모만 열리면, 사용자는
 * 한 켜 들어가서 흐린 줄 셋을 보고 다시 나와야 한다 — 그 사실은 들어가기 전에 읽혀야 한다.
 * 그때 말풍선은 **첫 자식의 사유를 그대로** 쓴다: 부모가 따로 "여기 쓸 게 없습니다" 라고
 * 뭉뚱그리면 왜 못 쓰는지(셸 통합이 없다·로깅이 꺼져 있다)를 결국 열어 봐야 안다.
 */
function flyoutRow(
  flyout: PaneFlyoutId,
  label: string,
  icon: string,
  title: string,
  children: PaneMenuItem[],
): PaneMenuGroup {
  const allOff = children.every((c) => c.disabled === true);
  return {
    flyout,
    label,
    icon,
    children,
    separator: true,
    disabled: allOff || undefined,
    title: allOff ? (children[0]?.title ?? title) : title,
  };
}

/** 항목의 상태를 정하는 바깥 사정 — 전부 타일 하나에 대한 물음이다 */
export interface PaneMenuCtx {
  /** 이 타일이 AI(MCP)에 공유되고 있는가 — **로컬 타일의 "AI 읽기 허용"** (원격은 [`aiStage`]) */
  shared: boolean;
  /** 로컬 **AI CLI 타일**인가(10-23) — 그러면 "AI 권한…" 줄이 없다(AI 타일에는 AI 읽기 권한이 아예 없다). 로컬에서만 본다 */
  aiTile?: boolean;
  /**
   * **원격 타일의 AI 권한 단계** — 호스트 하나의 단계(`$lib/delegation` 의 `stageOf`). 호스트 목록에 없는
   * 원격 타일(빠른 접속)은 `null` 이고 그때 "AI 권한…" 줄은 흐려진다. 로컬·그 밖의 종류에서는 보지 않는다.
   */
  aiStage?: AiStage | null;
  /**
   * **쿼리 타일의 DB AI 권한**(10-14) — 연결 하나의 단계와 풀림(대상이 바뀜). 연결이 목록에 없으면 `null` 이고 그때 "AI 권한…" 줄은
   * 흐려진다. 쿼리 타일에서만 본다.
   */
  dbAi?: { level: DbAiLevel; broken: boolean } | null;
  /** 이 **탭**의 동시 입력이 켜져 있는가 (꺼져 있으면 참여도 뜻이 없다) */
  syncOn: boolean;
  /** 이 타일이 그 동시 입력에 포함되어 있는가 */
  included: boolean;
  /**
   * 지금 "마지막 출력 복사" 를 누르면 **복사될 것이 있는가**
   * (= 끝난 OSC 133 블록이 있고 그 출력이 비어 있지 않다 — `CommandApi.canCopyOutput`).
   *
   * 없으면 항목을 흐리게 둔다. 숨기지 **않는** 이유는 동시 입력 참여와 같다: 그 기능이
   * 있다는 사실과 왜 지금 못 쓰는지(셸 통합이 없다)가 여기서 읽혀야 한다.
   */
  hasOutput: boolean;
  /**
   * 이 타일이 **화면만 있는 세션**인가 (간이 모드 — tmux 타일 ·
   * docs/log/2026-09-16-tmux-toggle.md).
   *
   * [`hasOutput`] 과 나란히 "마지막 출력 복사" 를 흐리게 만들지만 **말하는 것이 다르다**:
   * 저쪽은 "지금은 복사할 것이 없다"(기다리면 생긴다)이고 이쪽은 "이 타일에서는 원래
   * 안 된다"(기다려도 안 생긴다)이다. 같은 흐림에 다른 툴팁을 붙이는 이유가 그것이다.
   */
  screenOnly: boolean;
  /**
   * 지금 **저장할 스크롤백이 있는가** (버퍼가 비어 있지 않다 —
   * docs/log/2026-09-17-scrollback-export-and-logs.md).
   *
   * [`hasOutput`] 과 같은 처방이다: 없으면 흐리게 두되 숨기지 않는다. 다만 이쪽이 비는 경우는
   * 훨씬 드물다 — 방금 열려 아직 프롬프트조차 찍히지 않은 타일 정도다.
   */
  hasScrollback: boolean;
  /**
   * 이 세션이 **지금 로그를 쓰고 있는가** (`[hosts.<별칭>] log = true`).
   *
   * 로깅은 기본 꺼짐이고 호스트별 옵트인이라(CLAUDE.md 의 보안 제약) 이 값이 `false` 인
   * 타일이 대부분이다. 그래도 줄을 세우는 이유는 "이 앱에 세션 로그라는 것이 있다" 가
   * 여기서 읽혀야 하기 때문이고, 툴팁이 어디서 켜는지를 말한다 (동시 입력과 같은 규칙).
   */
  logging: boolean;
  /**
   * "이 폴더의 지난 대화" 줄 오른쪽에 적을 **지금의 단축키**(사용자가 바꿨으면 바꾼 글자 · 풀었으면 빈 글자) —
   * 이 모듈은 설정을 모르므로 부르는 쪽이 `displayCombo(effectiveCombo(...))` 로 넘긴다. 없으면 적지 않는다.
   */
  folderConvoHint?: string;
  /**
   * "사이드 채팅에서 이어 가기" 를 세울까(사이드 채팅 v2 6단계) — 부르는 쪽이 `app/side-chat-ask` 의 `tileForkSource`(주 창 · 로컬 · 대화 연결을
   * 앎 · 사이드 채팅 CLI)로 정한다. 없으면 아니다.
   */
  sideChatFork?: boolean;
  /**
   * 이 타일이 **남의 세션을 빌려 쓰는가** (`borrowsSession` — 원격 문서 타일 · docs/log/2026-09-27-doc-tile.md).
   * 종류만으로는 갈리지 않는 경우(문서 타일은 로컬이면 매인 데가 없고 원격이면 빌린다)를 부르는 쪽이 알려 준다 —
   * 참이면 "새 창으로 분리" 를 그리지 않는다(`startPaneTear` 와 같은 규칙). SFTP 타일은 종류로 이미 빠진다.
   */
  borrowed?: boolean;
  /**
   * **폰의 머리줄 대신**(원격 웹 R5 · 10-20) — 폰 배치는 타일 머리줄을 그리지 않으므로(`PaneHost` 의 `headed`) 머리줄에만 있던 단추를
   * 이 메뉴 맨 위 줄로 올린다. 위 띠의 ⋯(`MobileBar`)로 연 메뉴에만 넘긴다 — 데스크톱 · 터미널 길게 누르기 메뉴는 `undefined` 라 예전 그대로다.
   * `flip` = AI 타일의 지금 면(넘길 수 없으면 `null`).
   */
  phone?: { flip: "term" | "convo" | null };
  /**
   * **폰 배치(`mobileLayout`)인가**(원격 웹 R5 · 10-20) — 폰은 늘 타일 하나를 가장자리까지 그리고 창도 하나라 **분할 둘 · 새 창으로 분리**가
   * 뜻이 없다(나눠도 보이지 않고, 원격 브라우저에서 새 창은 집 PC 의 창이다). 참이면 그 세 줄을 그리지 않는다 — 위 띠 ⋯ · 길게 누르기 메뉴 모두.
   * 데스크톱 · 넓은 원격 창은 `undefined` 라 예전 그대로다.
   */
  solo?: boolean;
  /**
   * 이 타일이 **오케스트레이션 탭**에 있는가(2026-10-29 — 노트 D11) — 그 탭은 앱이 배치를 쥐므로 분할 둘 · 새 창으로 분리를 그리지 않는다.
   */
  orchTab?: boolean;
  /** "오케스트레이션으로 이어 가기" 를 세울까 — 오케스트레이션 탭 밖 · 대화(`agentLink`)를 아는 로컬 AI 타일(원격 창 아님 — `canContinueInOrch`) */
  orchContinue?: boolean;
  /**
   * **타일이 맡긴 도구 줄**(2026-10-20 타일 제목줄 개편 — 파일 타일 B안) — 도구줄이 머리줄로 올라간 타일은 제 도구 ⋯ 를 따로 두지 않고
   * 그 줄들을 이 메뉴 **맨 위**에 얹는다(구분선 하나 뒤에 타일 항목). 액션은 `tool:<열쇠>` 다. 머리줄 ⋯ · 머리줄 우클릭에만 넘긴다 —
   * 터미널 우클릭 메뉴와 머리줄이 없는 타일은 `undefined` 라 예전 그대로다.
   */
  tools?: readonly PaneMenuItem[];
  /**
   * **문서 타일의 경로**(10-20) — 있으면 "경로 복사" 줄이 서고 말풍선이 `별칭:경로`(원격) · `경로`(로컬)를 보여 준다(예전 도구줄의
   * 경로 글자와 같은 값 — 복사되는 것은 별칭 없는 `path`). 문서 타일에서만 넘긴다 — 없거나 `path` 가 비면 줄이 없다.
   */
  docPath?: { path: string; alias: string } | null;
  /**
   * **문서 타일의 [새 문서…]**(2026-11-11) — `true` 면 줄이 서고 눌린다, `false` 면 흐리게(끊긴 원격 · 원본을 잃은 원격 — 편집 단추와 같은 까닭 글),
   * `null` · 없음이면 줄이 없다(파일을 보이지 않는 문서 타일 · 다른 종류). 부르는 쪽이 `app/new-doc` 의 `newDocState` 로 정한다.
   */
  docNew?: boolean | null;
}

/** [새 문서…] 줄 하나 — 타일 ⋯ 와 문서 본문 우클릭이 같이 쓴다(`enabled` 가 거짓이면 흐리게 · 까닭은 말풍선) */
export function newDocItem(enabled: boolean, tr: Tr): PaneMenuItem {
  return {
    action: "new-doc",
    label: tr("files.doc.new"),
    icon: "plus",
    separator: true,
    ...(enabled ? {} : { disabled: true, title: tr("files.doc.edit.block.offline") }),
  };
}

/** 문서 경로의 보이는 글 — 원격이면 `별칭:경로`(예전 문서 도구줄의 경로 글자와 같은 꼴) */
export function docPathShown(p: { path: string; alias: string }): string {
  return p.alias ? `${p.alias}:${p.path}` : p.path;
}

/**
 * 터미널 우클릭 메뉴에만 필요한 바깥 사정 — **우클릭한 그 순간**의 스냅샷이다
 * (docs/log/2026-09-05-terminal-context-menu.md).
 */
export interface TermMenuCtx extends PaneMenuCtx {
  /** 우클릭한 자리에 링크가 있었으면 그 주소 (없으면 `null`) */
  link: string | null;
  /** 그때 선택된 텍스트가 있었는가 */
  hasSelection: boolean;
  /**
   * 그때 우클릭한 줄에서 찾은 **저장할 만한 명령** (없으면 `null` — 줄이 없다).
   *
   * 링크·선택과 같은 **스냅샷**이다: 메뉴가 떠 있는 동안 화면은 계속 흐르고, 사용자가 겨눈
   * 것은 누른 그 순간의 줄이다. 어느 줄이 어느 블록인지 푸는 일(`blockAtRow`)과 폴백
   * (마지막 끝난 블록)은 마커를 쥔 `Terminal.svelte` 가 하고, 여기 오는 것은 그 결과다.
   */
  snippet: SnippetSource | null;
  /**
   * 그때 우클릭한 줄의 **끝난 블록**(없으면 마지막 끝난 블록) — "이 블록을 AI 에게 묻기…" 의 대상
   * (docs/log/2026-09-28-ask-ai-block.md). 블록이 하나도 없으면(셸 통합이 없는 타일) `null` 이고 줄이 서지 않는다.
   * 없어도 되는 칸이다 — 옛 호출부(테스트)는 모른다.
   */
  askBlock?: { fromRow: boolean } | null;
  /** 그 줄 끝에 흐리게 적을 단축키 글자 (`ask-ai-block` — 사용자가 바꾼 그대로) */
  askHint?: string;
  /** "사이드 채팅에 묻기" 를 세울 수 있는 창인가(독이 있는 주 창 — 사이드 채팅 v2 5단계). 없으면 아니다 */
  sideChat?: boolean;
}

/** [`TermMenuCtx.snippet`] 한 칸 */
export interface SnippetSource {
  /** 저장할 명령문 — 비어 있지 않다 (빈 것은 `null` 로 온다) */
  command: string;
  /**
   * **우클릭한 그 줄**의 블록인가. `false` 면 커서 밑에 블록이 없어 이 타일의 마지막 끝난
   * 명령으로 물러선 것이고, 그 차이가 곧 라벨의 차이다 — 가리킨 것을 저장하는 줄과
   * "마지막 명령을" 저장하는 줄은 사용자에게 다른 약속이다.
   */
  fromRow: boolean;
}

/**
 * **폰의 머리줄 줄들**([`PaneMenuCtx.phone`]) — 머리줄에만 있던 단추(넘기기 · 폴더 칩(로컬) · 브랜치 칩)를 메뉴 맨 위에.
 * 머리줄의 나머지는 이미 이 메뉴에 있다(AI 권한 · tmux · 포워딩 · 원격 파일 · 닫기) — 최대화는 폰이 늘 타일 하나라 뜻이 없다.
 */
function phoneRows(kind: PaneKind, ctx: PaneMenuCtx, tr: Tr): PaneMenuItem[] {
  const phone = ctx.phone;
  if (phone === undefined) return [];
  const rows: PaneMenuItem[] = [];
  if (phone.flip !== null) {
    const toConvo = phone.flip === "term";
    rows.push({
      action: "flip",
      label: tr(toConvo ? "pane.flip.toConvo" : "pane.flip.toTerm"),
      icon: toConvo ? "conversations" : "terminal",
    });
  }
  if (kind === "local") rows.push({ action: "files", label: tr("pane.header.folder.unknown"), icon: "folder" });
  if (kind === "local" || kind === "ssh") rows.push({ action: "branches", label: tr("pane.menu.branches"), icon: "git-branch" });
  return rows;
}

/**
 * 이 타일의 메뉴에 뜰 항목들 — 위 표 그대로다.
 *
 * 분할 둘과 닫기는 **모든 종류**에 있다. 타일 배치는 그 안에 무엇이 들었든 같은 조작이기
 * 때문이다 (파일 목록도 설정도 옆에 하나 더 열 수 있다).
 */
export function menuItemsFor(kind: PaneKind, ctx: PaneMenuCtx, tr: Tr): PaneMenuRow[] {
  const phone = phoneRows(kind, ctx, tr);
  // 타일이 맡긴 도구 줄(파일 타일 B안) — 폰 줄 다음 · 분할 앞. 첫 줄의 선은 아래 끝에서 걷힌다
  const tools = ctx.tools ?? [];
  const lead = phone.length + tools.length;
  const items: PaneMenuRow[] = [...phone, ...tools];
  if (ctx.solo !== true && ctx.orchTab !== true) {
    // 예전 타이틀바의 ◫ ⬓ 다. 대상이 **이 타일**이라 방향만 고르면 된다
    // (자동 방향은 `split` 단축키와 명령 팔레트가 맡는다 — 그쪽은 고를 여지가 없는 길이다).
    // 폰(`solo`)에는 없다 — 늘 타일 하나라 나눠도 보이지 않는다.
    items.push(
      {
        action: "split-row",
        label: tr("pane.menu.split_row"),
        icon: "split-h",
        ...(lead > 0 ? { separator: true } : {}),
      },
      {
        action: "split-col",
        label: tr("pane.menu.split_col"),
        icon: "split-v",
      },
    );
  }

  if (hasSession(kind)) {
    // **이 폴더의 지난 대화** — 분할 둘 바로 아래(같은 "이 타일 옆에 하나 더" 무리다 — 고른 대화가 옆에 분할로 선다).
    items.push({
      action: "folder-conversations",
      label: tr("pane.menu.folder_conversations"),
      icon: "conversations",
      separator: true,
      hint: ctx.folderConvoHint || undefined,
    });
  }
  // **사이드 채팅에서 이어 가기**(6단계) — 지난 대화 바로 아래(같은 "이 대화를 다른 자리에서" 무리). 로컬 AI 타일의 대화를 알 때만 — 흐리게
  // 세우지 않는다(대화를 모르는 타일에는 갈라 올 것이 영영 없다 · 셸 타일에 서면 목록만 길어진다).
  if (kind === "local" && ctx.sideChatFork === true) {
    items.push({
      action: "continue-side-chat",
      label: tr("pane.menu.continueSideChat"),
      icon: "side-panel",
      title: tr("pane.menu.continueSideChat.title"),
    });
  }
  // **오케스트레이션으로 이어 가기**(단계 5 — 갈라 오기) — 같은 "이 대화를 다른 자리에서" 무리. 오케스트레이션 탭 밖 · 대화를 아는 로컬 AI 타일에만.
  if (kind === "local" && ctx.orchContinue === true) {
    items.push({
      action: "continue-orchestration",
      label: tr("pane.menu.continueOrch"),
      icon: "orchestra",
      title: tr("pane.menu.continueOrch.title"),
    });
  }

  if (kind === "ssh") {
    // **서버 ▸** — 저 끝의 기계에 거는 것들. 포워딩·원격 편집은 타이틀바에서 내려왔고(⇉ ✎),
    // 원격 파일은 헤더의 폴더 버튼과 **같은 항목**이다. 아이콘이 밖에 있는데 메뉴에도 있는
    // 이유는, 메뉴를 연 사람이 "이 타일로 할 수 있는 일" 의 목록을 여기서 읽기 때문이다.
    //
    // **원격 파일 줄은 헤더의 폴더 버튼과 같은 `folder` 를 쓴다** (2026-09-15). 예전에는
    // `mark` 칸이 텍스트 한 줄이라 컬러 이모지(`📂`)를 피해 기하 글자 `▣` 로 에둘렀고,
    // 그래서 한 기능이 헤더에서는 폴더, 메뉴에서는 네모로 보였다.
    //
    // 순서는 **여는 무게순**이다: 터널(포워딩) → 목록(원격 파일) → 파일 하나(원격 편집).
    const server: PaneMenuItem[] = [
      { action: "forward", label: tr("pane.menu.forward"), icon: "forward" },
      { action: "sftp", label: tr("pane.menu.sftp"), icon: "folder" },
      { action: "edit-remote", label: tr("pane.menu.edit_remote"), icon: "edit" },
    ];
    // **tmux 타일에만** 한 줄 더 (docs/log/2026-09-16-tmux-toggle.md). 흐리게 세우지 않고
    // 아예 없는 이유는 위의 세 줄과 다르다: 저것들은 모든 SSH 타일에 뜻이 있고 지금 못 쓰는
    // 사정만 툴팁이 말하지만, tmux 가 아닌 타일에는 **붙어 있는 tmux 클라이언트 자체가
    // 없어** 전환할 대상도 목록도 없다.
    //
    // 2026-09-16 부터 **주 입구는 머리줄의 tmux 칩**이다(같은 `list` 그림, 같은 팝오버).
    // 이 줄은 지우지 않는다 — `[app] tile_header` 로 머리줄을 끄면 칩도 함께 사라지므로
    // 그때는 여기가 유일한 길이다.
    if (ctx.screenOnly) {
      server.push({
        action: "tmux-sessions",
        label: tr("pane.menu.tmux"),
        icon: "list",
        title: tr("pane.menu.tmux.title"),
      });
    }
    items.push(
      flyoutRow("server", tr("pane.menu.server"), "server", tr("pane.menu.server.title"), server),
    );
  }

  if (hasSession(kind)) {
    // **출력 ▸** — 이 타일이 만들어 낸 글자를 밖으로 가져가는 셋. 설정·파일 타일에는
    // 복사할 출력도 버퍼도 로그도 없어 줄 자체가 서지 않는다.
    //
    // 셋의 차이는 **무엇을 얼마나** 가져가느냐다: 블록 하나를 클립보드로(복사) · 화면 전체를
    // 파일로(저장) · 세션이 디스크에 쌓고 있던 것을 그대로(로그).
    items.push(
      flyoutRow("output", tr("pane.menu.output"), "terminal", tr("pane.menu.output.title"), [
        {
          action: "copy-output",
          label: tr("pane.menu.copy_output"),
          icon: "copy",
          // 복사할 블록이 없으면 흐리게 — 예전에는 늘 눌렸고 결과만 토스트로 "복사할 출력이
          // 없습니다" 였다. 누르기 전에 알 수 있는 것을 누른 뒤에 알려 줄 이유가 없다.
          //
          // tmux 타일(간이 모드)은 **같은 흐림, 다른 문구**다: 기다리면 생기는 것이 아니라
          // 이 타일에서는 원래 안 된다는 뜻이라, 그 사실을 그대로 적는다.
          disabled: ctx.screenOnly || !ctx.hasOutput,
          title: ctx.screenOnly
            ? tr("pane.menu.copy_output.title.screen_only")
            : ctx.hasOutput
              ? tr("pane.menu.copy_output.title.ready")
              : tr("pane.menu.copy_output.title.empty"),
        },
        // tmux 타일에서도 **스크롤백 저장은 살아 있다** — 위 줄과 갈리는 자리가 여기다.
        // 복사는 OSC 133 블록이 있어야 하지만 버퍼는 간이 모드에도 있다(화면이 곧 그것이다).
        {
          action: "save-scrollback",
          label: tr("pane.menu.save_scrollback"),
          icon: "file-down",
          disabled: !ctx.hasScrollback,
          title: ctx.hasScrollback
            ? tr("pane.menu.save_scrollback.title.ready")
            : tr("pane.menu.save_scrollback.title.empty"),
        },
        {
          action: "session-log",
          label: tr("pane.menu.session_log"),
          icon: "file-text",
          // 로깅이 꺼진 타일에서는 열 파일이 없다. 숨기지 않는 이유는 동시 입력과 같다 —
          // 기능이 있다는 사실과 어디서 켜는지가 이 줄에서 읽혀야 한다.
          disabled: !ctx.logging,
          title: ctx.logging
            ? tr("pane.menu.session_log.title.on")
            : tr("pane.menu.session_log.title.off"),
        },
      ]),
    );
    // 권한 묶음은 여기서 시작한다 — 위 묶음은 "내용을 밖으로", 아래 둘은 "이 세션을
    // 누구에게 열어 줄 것인가" 라 같은 선 안에 둘 수 없다.
    // 로컬 AI CLI 타일(10-23)에는 AI 읽기 권한이 아예 없다 — 줄이 없고, 권한 묶음의 선은 동시 입력 줄이 긋는다.
    const noAiRow = kind === "local" && ctx.aiTile === true;
    const aiRow: PaneMenuItem =
      kind === "ssh"
        ? // 원격 — 권한은 **호스트 하나의 단계**라(2026-10-07) 체크 하나로 말할 수 없다. 누르면 권한
          // 팝오버가 그 자리에 뜬다(`tmux 세션…` 과 같은 "메뉴를 닫고 상자를 연다" 몸짓). 앞자리 그림은
          // 지금 단계의 **게이지 글리프**다(10-23 — 머리줄 칩의 미니 게이지와 같은 꼴 · 끔이면 빈 막대). 호스트 목록에 없는 타일은 흐리게(이유는 툴팁).
          {
            action: "ai-permission",
            separator: true,
            label: tr("pane.menu.aiperm"),
            icon: gaugeIconName(gaugeIndex(AI_STAGES, ctx.aiStage)),
            disabled: ctx.aiStage == null,
            title:
              ctx.aiStage == null
                ? tr("app.ai.adhoc")
                : tr("pane.menu.aiperm.title", { stage: tr(AI_STAGE_NAME[ctx.aiStage]) }),
          }
        : // 로컬 — 예전 체크 "AI 읽기 허용"(10-23 까지)을 원격과 같은 "AI 권한…" 줄로. 누르면 같은 팝오버(Off · Read 만 — 로컬 타일은
          // 실행 권한이 없어 Ask 부터 잠김). 그림은 게이지 글리프(끔 = 빈 막대 · 읽기 = 하나).
          {
            action: "ai-permission",
            separator: true,
            label: tr("pane.menu.aiperm"),
            icon: gaugeIconName(ctx.shared ? 1 : 0),
            title: tr("pane.menu.localaiperm.title", {
              stage: tr(AI_STAGE_NAME[ctx.shared ? "read" : "off"]),
            }),
          };
    items.push(
      ...(noAiRow ? [] : [aiRow]),
      // 동시 입력 **참여** — 탭의 동시 입력이 꺼져 있으면 참여도 뜻이 없으므로
      // 흐리게 두고 툴팁이 어디서 켜는지를 말한다 (탭 우클릭 메뉴). 항목을 아예 숨기지
      // 않는 이유는, 이 기능이 있다는 사실 자체가 여기서 읽혀야 하기 때문이다.
      {
        action: "toggle-sync",
        ...(noAiRow ? { separator: true } : {}),
        label: tr("pane.menu.sync"),
        icon: ctx.included ? "check" : null,
        checkbox: true,
        checked: ctx.included,
        disabled: !ctx.syncOn,
        title: ctx.syncOn ? tr("pane.menu.sync.title.on") : tr("pane.menu.sync.title.off"),
      },
    );
  }

  // 쿼리 타일의 AI 권한(10-14) — 원격의 "AI 권한…" 과 같은 줄 · 같은 팝오버(`AiPermMenu`). 머리줄 칩(10-23 부터 끔이어도 선다)을
  // 설정에서 숨긴 사람의 길이 여기다(원격과 같은 관례). 연결이 목록에 없으면(지워짐) 흐리게.
  if (kind === "query") {
    const db = ctx.dbAi ?? null;
    items.push({
      action: "ai-permission",
      separator: true,
      label: tr("pane.menu.aiperm"),
      icon: gaugeIconName(gaugeIndex(DB_AI_LEVELS, db?.level)),
      disabled: db === null,
      title:
        db === null
          ? tr("pane.menu.dbaiperm.missing")
          : db.broken
            ? tr("app.dbai.broken")
            : tr("pane.menu.dbaiperm.title", { stage: tr(DB_AI_NAME[db.level]) }),
    });
  }

  // 문서 타일의 "경로 복사"(10-20) — 머리줄에서 경로 글자를 걷은 대신 여기서 확인(말풍선)하고 가져간다. 대상이 타일이 아니라 그 문서라
  // 분할(타일 배치) 묶음과 선으로 가른다.
  if (kind === "doc" && ctx.docPath != null && ctx.docPath.path !== "") {
    items.push({
      action: "copy-path",
      label: tr("files.menu.copypath"),
      icon: "copy",
      title: docPathShown(ctx.docPath),
      separator: true,
    });
  }
  // 문서 타일의 [새 문서…](2026-11-11) — 경로 복사 아래 선 하나(대상이 이 문서가 아니라 그 폴더의 새 파일이다)
  if (kind === "doc" && ctx.docNew != null) items.push(newDocItem(ctx.docNew, tr));

  // 헤더를 창 밖으로 끄는 몸짓과 같은 결과다. 몸짓을 모르는 사람에게 그 기능이 존재한다는
  // 사실을 알리는 자리이기도 하다. 혼자 떼면 뜻이 깨지는 타일에서는 항목 자체를 그리지 않는다.
  // 원격 문서 타일도 여기서 빠진다(`ctx.borrowed`) — `startPaneTear` 가 거절하는 것과 같은 규칙이다.
  // 폰(`solo`)에는 분리도 없다 — 창이 하나뿐이고 원격 브라우저에서 새 창은 집 PC 의 창이다.
  const detachable = kind !== "sftp" && kind !== "start" && ctx.borrowed !== true && ctx.solo !== true && ctx.orchTab !== true;
  if (detachable) {
    // 그림이 "링크 열기"(`external`)와 갈리는 이유: 터미널 우클릭 메뉴에서는 **둘이 한
    // 목록에 함께 선다**. 나가는 곳이 브라우저냐 이 앱의 새 창이냐가 다르므로 그림도 다르다.
    items.push({
      action: "detach",
      label: tr("pane.menu.detach"),
      icon: "window",
      separator: true,
    });
  }
  items.push({
    action: "close",
    label: tr("pane.menu.close"),
    icon: "close",
    // 분리가 빠진 타일에서는 구분선이 닫기 앞으로 옮겨 온다 — 마지막 묶음("이 타일을
    // 치운다")은 종류와 무관하게 언제나 선 하나로 갈린다.
    separator: !detachable,
  });
  // 분할이 빠진 폰 목록은 첫 줄이 선을 일 수 있다 — 제목 바로 밑의 선은 묶음을 가르지 않는다.
  const first = items[0];
  if (first !== undefined && first.separator === true) items[0] = { ...first, separator: undefined };
  return items;
}

/**
 * **터미널 우클릭 메뉴의 항목들** (docs/log/2026-09-05-terminal-context-menu.md).
 *
 * 헤더 ⋯ 메뉴와 **한 정의**다 — 아래 묶음은 [`menuItemsFor`] 를 그대로 다시 쓴다.
 * 두 벌로 적으면 항목이 하나 늘 때마다 "어느 메뉴에 넣을 것인가" 를 두 번 판단하게 되고,
 * 그 판단이 갈리는 순간 같은 타일의 두 메뉴가 서로 다른 목록을 내놓는다.
 *
 * ## 묶음 넷
 *
 * | # | 묶음 | 뜰 조건 |
 * | --- | --- | --- |
 * | 1 | 링크 열기 · 링크 주소 복사 | 링크 **위**에서 우클릭했을 때만 |
 * | 2 | 복사 · 붙여넣기 · 모두 선택 · 화면 지우기 | 복사는 선택이 있을 때만 |
 * | 3 | **출력 ▸** (복사 · 스크롤백 저장 · 세션 로그) | 세션이 있는 타일에 늘 |
 * | 3' | 스니펫으로 저장 | 저장할 명령이 있을 때만 ([`TermMenuCtx.snippet`]) |
 * | 4 | 헤더 ⋯ 의 나머지 — **"서버 ▸" 만 빼고** | [`menuItemsFor`] 그대로 |
 *
 * 4번이 "그대로" 라는 말은 **새 항목이 저절로 따라온다**는 뜻이기도 하다. 그것이 맞는 이유는 두 메뉴의 관계가
 * 애초에 그렇게 정해져 있기 때문이다: 헤더를 꺼 둔 사람에게 **타일 조작으로 가는 유일한
 * 마우스 길**이 이 메뉴다 (헤더가 없으면 ⋯ 버튼도 없다).
 *
 * 3번이 4번에서 **끌어올려져** 있다. 그 묶음도 "이 화면을 가져간다" 계열이라 2번 바로 아래가
 * 제자리이고, 아래에 그대로 두면 같은 메뉴에 복사가 두 자리로 흩어진다. 그래서 아래에서는
 * [`dropRows`] 가 빼내고, 그때 그 줄이 들고 있던 구분선은 **다음 줄이 물려받는다**.
 *
 * **"서버 ▸" 는 ⋯ 전용이다** (2026-09-17). 우클릭 메뉴는 **화면 위에서 시작한 몸짓**이라
 * 그 자리에서 하고 싶은 일(고르고·붙이고·지우고)이 먼저 와야 하는데, 포워딩·원격 파일은
 * 타일이 아니라 저쪽 기계에 거는 일이라 목록을 길게 만들 뿐 손이 가지 않았다. 헤더를 꺼 둔
 * 사람에게도 길은 남아 있다 — 명령 팔레트와 `Ctrl+Shift+O` 가 같은 곳으로 간다.
 *
 * ## 검색이 없는 이유
 *
 * "선택 텍스트로 검색" 은 넣지 않았다. `@xterm/addon-search` 가 의존성에 있기는 하지만
 * 이 앱은 아직 그 애드온을 **어디에서도 붙이지 않는다** — 검색 UI 자체가 없다. 누르면
 * 아무 일도 안 하는 항목을 메뉴에 세우지 않는다 (동시 입력 참여를 흐리게라도 세우는 것과
 * 다른 점: 저건 켜는 자리가 화면에 **있다**).
 */
export function terminalMenuItems(kind: PaneKind, ctx: TermMenuCtx, tr: Tr): PaneMenuRow[] {
  const items: PaneMenuRow[] = [];

  // ① 링크 — **맨 위**다. 우클릭한 자리에 링크가 있었다는 것은 사용자가 그 링크를 겨눴다는
  // 뜻이고, 그때 하고 싶은 일이 목록 한가운데 있으면 안 된다.
  if (ctx.link !== null) {
    items.push(
      {
        action: "open-link",
        label: tr("pane.menu.open_link"),
        icon: "external",
        title: ctx.link,
      },
      { action: "copy-link", label: tr("pane.menu.copy_link"), icon: "copy", title: ctx.link },
    );
  }

  // ② 편집 — 복사는 **선택이 있을 때만** 뜬다 (비활성이 아니라 아예 없다: 선택이 없는데
  // "복사" 가 서 있으면 무엇이 복사될지를 사용자가 되물어야 한다).
  const editFirst = items.length > 0; // 링크 묶음 뒤면 선 하나로 가른다
  if (ctx.hasSelection) {
    // 복사 셋(링크 주소·선택·마지막 출력)은 **한 그림**이다 — 뜻이 같고 대상만 다르며,
    // 그 대상은 이름이 말한다. 예전 `⧉` 도 셋이 나눠 쓰던 한 글자였다.
    items.push({
      action: "copy",
      label: tr("pane.menu.copy"),
      icon: "copy",
      separator: editFirst,
    });
  }
  items.push(
    {
      action: "paste",
      label: tr("pane.menu.paste"),
      icon: "paste",
      separator: editFirst && !ctx.hasSelection,
    },
    { action: "select-all", label: tr("pane.menu.select_all"), icon: "select-all" },
    {
      action: "clear-screen",
      label: tr("pane.menu.clear"),
      icon: "erase",
      // 셸에 `clear` 를 보내는 것이 아니라는 사실이 여기서 읽혀야 한다 — 그 둘은 치고 있던
      // 명령줄이 실행되느냐에서 갈리고, 끊긴 타일에서는 결과가 아예 다르다.
      title: tr("pane.menu.clear.title"),
    },
  );

  // ③④ 헤더 ⋯ 의 목록. **"출력 ▸" 묶음만** 위로 끌어올리고 나머지는 순서 그대로다.
  // (2026-09-17 전에는 그 안의 두 줄을 낱개로 끌어올렸다 — 묶음이 된 지금은 줄 하나다.)
  const rest = menuItemsFor(kind, ctx, tr);
  const output = rest.find((row) => rowId(row) === "output");
  if (output) items.push({ ...output, separator: true });

  // ③'' **AI 에게 묻기** — 출력 바로 아래, 스니펫 위(목업 순서). 같은 "그 명령" 묶음이다(출력 · 그 블록을
  // AI 에게 · 명령 자체). 스니펫 줄과 같은 이유로 흐리게 세우지 않고 **아예 없다**: 블록이 없으면(셸 통합이
  // 없는 타일 · tmux 간이 모드) 넘길 것이 영영 없다.
  if (!ctx.screenOnly && ctx.askBlock) {
    items.push({
      action: "ask-ai",
      label: ctx.askBlock.fromRow ? tr("pane.menu.askai.row") : tr("pane.menu.askai.last"),
      icon: "ai",
      title: tr("pane.menu.askai.title"),
      hint: ctx.askHint || undefined,
    });
  }
  // ③''' **사이드 채팅에 묻기** — AI 에게 묻기 바로 아래(같은 "그 명령 · 그 글자를 AI 에게" 묶음). 고른 글자가 있으면 그것, 없으면 그
  // 블록 — 둘 다 없으면 줄이 없다. 로컬 · SSH 터미널만(연결 칩에 걸 수 있는 타일).
  const sideChatSource = ctx.hasSelection || (!ctx.screenOnly && !!ctx.askBlock);
  if (ctx.sideChat && (kind === "local" || kind === "ssh") && sideChatSource) {
    items.push({
      action: "ask-side-chat",
      label: tr("pane.menu.askSideChat"),
      icon: "side-panel",
      title: ctx.hasSelection ? tr("pane.menu.askSideChat.selection") : tr("pane.menu.askSideChat.block"),
    });
  }

  // ③' **스니펫으로 저장** — 출력 복사 바로 아래다 (docs/log/2026-09-16-snippets.md).
  //
  // 자리를 여기로 잡은 이유는 대상이 같기 때문이다: 저 줄이 "그 명령의 출력" 을 가져간다면
  // 이 줄은 "그 명령 자체" 를 가져간다. 아래의 타일 조작 묶음(분할·분리·닫기)에 섞이면
  // 대상이 명령인지 타일인지가 한 목록 안에서 갈린다.
  //
  // 흐리게 세우지 않고 **아예 없다**: "복사할 출력이 없다" 는 기다리면 생기는 사정이라 흐린
  // 줄이 그 사실을 말할 수 있지만, 여기서는 애초에 저장할 명령이 없다는 뜻이라 툴팁이 할
  // 말이 "명령을 한 번 치세요" 밖에 없다. 화면만 있는 세션(tmux 타일)도 같은 이유로 빠진다 —
  // 그쪽은 블록이 **영영** 생기지 않는다.
  if (!ctx.screenOnly && ctx.snippet !== null) {
    items.push({
      action: "save-snippet",
      label: ctx.snippet.fromRow
        ? tr("pane.menu.snippet.row", { name: snippetSaveLabel(ctx.snippet.command) })
        : tr("pane.menu.snippet.last"),
      icon: "bookmark",
      title: ctx.snippet.fromRow
        ? tr("pane.menu.snippet.row.title")
        : tr("pane.menu.snippet.last.title"),
    });
  }

  // "출력" 은 위로 갔고 "서버" 는 이 메뉴에 아예 서지 않는다 (머리말 참고).
  const tail = dropRows(rest, ["output", "server"]);
  for (const [i, item] of tail.entries()) {
    // 타일 조작 묶음의 첫 줄에 선을 하나 긋는다 — 여기서부터는 "이 화면" 이 아니라
    // "이 타일" 에 대한 항목이라는 것이 그 선의 뜻이다.
    items.push(i === 0 ? { ...item, separator: true } : item);
  }
  return items;
}

/**
 * 줄 몇을 목록에서 빼되, 그것들이 들고 있던 **구분선은 다음 줄에 넘긴다**.
 *
 * 구분선은 줄의 성질이 아니라 **묶음의 경계**다. 경계를 이고 있던 줄만 사라지면 그 경계도
 * 함께 사라져 서로 다른 묶음이 한 덩어리로 붙어 버린다.
 *
 * 2026-09-17 에 두 번 넓혔다: 하나(`dropAction`)에서 여럿으로, 그리고 액션 id 에서
 * [`rowId`] 로 (빼는 것이 이제 항목이 아니라 **묶음 줄**이다).
 */
function dropRows(
  rows: readonly PaneMenuRow[],
  ids: readonly (PaneMenuAction | PaneFlyoutId)[],
): PaneMenuRow[] {
  const out: PaneMenuRow[] = [];
  let carried = false;
  for (const row of rows) {
    if (ids.includes(rowId(row))) {
      carried ||= row.separator === true;
      continue;
    }
    out.push(carried && row.separator !== true ? { ...row, separator: true } : row);
    carried = false;
  }
  return out;
}
