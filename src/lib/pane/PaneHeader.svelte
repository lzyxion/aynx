<script lang="ts">
  import PaneIcon from "$lib/PaneIcon.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import HeaderChips, { HEAD_ICON_SIZE } from "$lib/pane/HeaderChips.svelte";
  import { hostLabel, hostMeta, type HostEntry } from "$lib/hosts";
  import type { ForwardInfo } from "$lib/forward";
  import {
    fetchSessionInfo,
    infoCardText,
    localInfoCard,
    sessionInfoCard,
    sessionInfoLines,
    type SessionCardView,
    type SessionInfo,
  } from "$lib/session-info";
  import { createHoverArm } from "$lib/pane/hover-arm.svelte.js";
  import { shellLabel, type PaneSpec } from "$lib/session";
  import type { AiStage } from "$lib/delegation";
  import type { DbAiLevel } from "$lib/db-ai";
  import { displayName, paneAi, resolvedShellOf } from "$lib/app/titles.svelte.js";
  import { tabOfPane } from "$lib/app/tabs.svelte.js";
  import { orchScreenPath } from "$lib/app/album-screen.svelte.js";
  import { studioLabel } from "$lib/app/studio-projects.svelte.js";
  import { aiDisplayName } from "$lib/pane-icons";
  import { dirtyDocPanes } from "$lib/app/doc-dirty.svelte.js";
  import { currentWindowLabel, tileCode } from "$lib/context";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { TmuxCardView } from "$lib/pane/tmux-sessions.svelte.js";
  import type { ForwardsCardView } from "$lib/pane/forward-menu.svelte.js";
  import type { ChipMoreItem } from "$lib/pane/chip-more-menu.svelte.js";
  import { chipFolder } from "$lib/pane-chips";
  import { localReportedFolder, reportedCwd } from "$lib/app/pane-cwd.svelte.js";
  import { queryLiveOf } from "$lib/app/query-live.svelte.js";
  import { findDbConn } from "$lib/app/db-conns.svelte.js";
  import { dbAiLevelOf } from "$lib/app/db-ai.svelte.js";
  import { queryAddress, queryCardIcon, queryInfoCard } from "$lib/query/info-card";
  import { markPaneHead, paneToolsOf } from "$lib/pane/pane-tools.svelte.js";
  import { registerFlipHead } from "$lib/pane/flip-motion";

  /**
   * **타일 헤더** — 정체성 + 드래그 손잡이 + 이 타일의 조작들
   * (docs/log/2026-09-02-pane-identity.md · docs/log/2026-09-05-titlebar-cleanup.md).
   *
   * 언제 붙는지는 `PaneHost` 가 정한다 (`[app] tile_header`). 여기는 붙기로 한 뒤의 모양만
   * 든다: 색 점 · 이름 · 상태 표식 둘 · 칩들(AI 권한 · tmux · 경유 · 포워딩 · 폴더 · 브랜치 — 이 순서, 전부 이름 묶음 안) · `⋯ ⤢ ×`.
   *
   * ## 그림은 전부 `UiIcon` 이다 (2026-09-15)
   *
   * 머리줄의 버튼 넷과 표식 둘이 전에는 **글자 기호**(`⋯ ⤢ × ✓ ✦`)와 **손으로 딴 SVG
   * path**(`FOLDER_D`)로 갈려 있었다 — 상태바가 겪은 것과 같은 어긋남이다(굵기·크기·광학
   * 중심이 제각각이고, 글자 기호는 글꼴이 바뀌면 모양도 바뀐다). 지금은 전부 `UiIcon`
   * 이고 크기를 띠와 같은 값으로 쓴다
   * (docs/log/2026-09-15-lucide-ui-icons.md).
   *
   * ## 아이콘은 셋뿐이다
   *
   * `⤢` `×` 와 그 앞의 `⋯`. (2026-10-11 — 폴더 버튼 📂 은 **폴더 칩**이 되었다: 같은 일을 하고, 이제 그 폴더의
   * 이름까지 말한다 — 아래 "폴더 칩 · 브랜치 칩" 절.) 나머지(분할·포워딩·원격 편집·SFTP·AI 읽기 허용·동시 입력
   * 참여·출력 복사·분리·닫기)는 전부 `⋯` 메뉴로 접었다 — 좁은 타일에서 헤더가 일곱 칸까지
   * 늘어나며 이름을 `web-0…` 로 밀어내고 있었고, 헤더의 첫째 일은 **정체성**이다.
   * 밖에 남긴 셋의 기준은 "자주 쓰거나, 상태를 눈으로 말해야 하거나" 다.
   *
   * 예외 하나(2026-10-17) — **AI 타일**(넘길 수 있는 타일만 · `pane/ai-flip.svelte.ts` 의 `canFlipPane`)에는 `⋯` 앞에 터미널 ⇄ 대화
   * 아이콘 단추가 하나 선다(`flip` 프롭 — 아니면 `null` 이라 없다). 그림은 **누르면 갈 면**(터미널 면이면 대화 그림)이고 이름이
   * "대화로 전환" / "터미널로 전환" 으로 바뀐다. 자주 오가는 조작이라 메뉴에 접지 않는다.
   *
   * ## 표식 둘은 버튼이 아니다
   *
   * 동시 입력 포함(`✓`, 경고색)과 AI 읽기 허용(`✦`, 강조색)은 **표시**다 (토글은 ⋯ 메뉴와
   * `Ctrl+클릭`). 둘 다 "켜 둔 줄 모르면 사고가 나는" 상태라 메뉴를 열어야 보이면 안 된다 —
   * 하나는 입력이 형제 서버로 함께 나가고, 하나는 명령·출력이 이 앱 밖으로 나간다.
   * 꺼져 있으면 아무것도 그리지 않으므로 평소 헤더는 조용하다.
   *
   * ## 몸과 한 장이다 (2026-10-20 타일 제목줄 개편 — 목업 SJgp6bQEPiRYkBCvjy3NuL)
   *
   * 머리줄과 몸 사이 선이 없다 — 머리줄이 몸과 **같은 면**이라 타일 한 장으로 읽힌다. 포커스는 타일 테두리 색(`PaneHost` 의 `.focused`)만 말한다.
   * - **터미널 · AI 타일**(`local` · `ssh`): 면 = 그 타일의 터미널 바탕 — 머리줄은 칠하지 않고 타일 판(`--term-bg-fill` — 투명도 · 월페이퍼를
   *   그대로 따른다)이 비친다. 글자 · 아이콘 · 칩은 터미널 글자색(`--term-fg`) 계열이다(칩 면은 그 색의 옅은 반투명). 크롬 글자를 터미널 면에
   *   얹지 않는 규칙(docs/conventions.md)과 같은 말이다: 글자와 바탕이 **둘 다 터미널 쪽**에서 온다.
   * - **그 밖의 타일**: 면 = 몸과 같은 크롬 면(`--bg-panel`). 문서 · 쿼리 · 브랜치 · diff · 파일 타일은 제 **도구줄이 이 줄 가운데로 올라온다**
   *   (`pane/pane-tools.svelte.ts` — 왼쪽 아이콘 · 이름 → 가운데 도구 → 오른쪽 `⋯ ⤢ ×` 한 줄). 좁으면 가운데 도구가 먼저 잘리고(제 접기 규칙도
   *   그대로 돈다) 이름 · `⋯ ⤢ ×` 는 끝까지 남는다. 파일 타일은 빵부스러기 경로가 이름 자리를 대신하고(`replaceName`) 뒤로/앞으로가 맨 앞에 선다.
   *   타일 아이콘은 없고(`hideIcon` — 10-20), 장소 패널이 펼쳐져 있으면 맨 앞 조각이 그 폭을 쥐어 경로 칸이 목록 열 위에서 시작한다(`span`).
   *   쿼리 타일은 사이드바 토글을 이름 뒤(`tail`)에 두고, 사이드바가 열려 있으면 왼쪽 무리(로고 · 이름 · 토글)를 사이드바 경계까지 고정한다
   *   (`span` — 쿼리 탭이 편집기 열 위에서 시작, 10-20 ④판). 연결 중에는 로고 자리에 도는 고리가 선다(`iconBusy`).
   *   문서 타일도 같은 규칙이다 — 목차 토글이 이름 뒤, 목차 패널(본문 왼쪽)이 열리면 무리가 그 경계까지(`pane/head-span.ts`). 경로 글자는
   *   머리줄에 없다(타일 ⋯ 의 [경로 복사] 줄 말풍선).
   * - **포커스 밖 타일**에서는 조작(`⋯ ⤢ ×` · 도구줄의 `data-head-act` 단추)이 숨으며 **자리도 접고**, 상태 · 정체(이름 · 칩 · DB 연결 중 고리 ·
   *   스크립트 탭 · 경로 · 기준 브랜치 · 읽기 전용 표지)만 남아 오른쪽 끝까지 붙어 선다(2026-10-20 실기 — 아래 스타일의 "드러냄" 절).
   *
   * ## 드래그·우클릭은 여기서 달지 않는다
   *
   * `draggable` 과 `data-pane-head` 만 달고, `dragstart`·`contextmenu` 는 `PaneHost` 가
   * 캔버스 한 곳에서 **위임**으로 받는다 — `<div>` 에 직접 달면 정적 요소 상호작용(a11y)으로
   * 걸리고 판정이 두 벌 생긴다.
   */
  let {
    pane,
    /** 이 타일의 호스트 (별칭으로 찾은 것) — 색 점과 툴팁의 `user@host:port` 를 여기서 읽는다 */
    host = null,
    /**
     * 헤더를 **한 톤 밝게** 그리는가 = 포커스됐거나, 타일이 하나뿐이거나.
     *
     * 하나뿐인 탭에는 `.focused` 를 아예 달지 않는데(비교할 형제가 없으니 강조가
     * 뜻이 없다), 헤더가 "항상" 이면 그 하나뿐인 타일의 헤더가 영영 흐린 톤으로 남아
     * 있지도 않은 "다른 활성 타일" 을 암시하게 된다.
     */
    active = false,
    /** 동시 입력에 포함됨 (`✓`) */
    included = false,
    /**
     * **AI 가 이 타일을 볼 수 있는가** — 터미널 타일에서만 참이다. 로컬은 타일의 "AI 읽기 허용", 원격은
     * 호스트의 AI 권한 단계가 읽기 이상(`app/delegation.svelte.ts` 의 `paneAiReadable`). 로컬은 AI 권한 칩이
     * 이 값으로 Read · Off 를 그린다(10-23 — 원격과 같은 칩 · 끔이어도 선다. 원격은 아래 [`aiStage`] 칩이 그 자리를 쥔다).
     */
    shared = false,
    /**
     * **원격 타일의 AI 권한 단계** (2026-10-07 — 원격 세션의 권한 = 호스트 하나의 단계). 로컬·그 밖이면
     * `null`. 머리줄에 미니 게이지 칩이 늘 서고(10-23 — 끔이면 빈 게이지 + Off), 누르면 권한 팝오버가 뜬다(`onaimenu`).
     */
    aiStage = null,
    /** **쿼리 타일의 DB AI 권한** (10-14 — 연결 하나의 단계) — 그 밖이면 `null`. 칩 · 팝오버는 원격과 같은 것(`HeaderChips` · `AiPermMenu`) */
    dbAi = null,
    /** 이 타일의 AI 권한 팝오버가 열려 있는가 (칩의 `aria-expanded`) */
    aiMenuOpen = false,
    zoomed = false,
    /** ⤢ 툴팁에 적을 **지금 걸린** 최대화 조합 */
    zoomCombo,
    /**
     * **AI 타일의 [터미널 | 대화]** — 지금 보이는 면(넘길 수 없는 타일이면 `null` — 단추가 없다). 넘김 자체는 `pane/AiFlip`
     * (같은 타일 안에서 옆으로 미끄러진다), 판정은 `pane/ai-flip.svelte.ts` 의 `canFlipPane`.
     */
    flip = null,
    /** 넘기기 단축키(툴팁) — 안 걸렸으면 빈 글자 */
    flipCombo = "",
    onflip,
    /** 이 타일의 ⋯ 메뉴가 열려 있는가 (`aria-expanded`) */
    menuOpen = false,
    /** 이 타일의 tmux 세션 목록이 열려 있는가 (칩의 `aria-expanded`) */
    tmuxMenuOpen = false,
    /** 이 타일의 포워딩 목록 메뉴가 열려 있는가 (칩의 `aria-expanded`) */
    forwardMenuOpen = false,
    /** 이 타일의 "+N" 칩 메뉴(넘쳐서 숨은 칩들)가 열려 있는가 (칩의 `aria-expanded`) */
    chipMoreOpen = false,
    /** 이 타일의 세션에 살아 있는 포트 포워드들 — 비어 있으면 칩을 그리지 않는다 */
    forwards = [],
    /**
     * 이 타일이 지금 물고 있는 백엔드 세션 id (없으면 `null`) — **이름 말풍선의 재료**를
     * 묻는 열쇠다 ([`fetchSessionInfo`]). 재연결하면 새 id 가 오므로 상태도 새로 뜬다.
     */
    sessionId = null,
    /** 이 타일이 지금 화면에 보이는가(`HostBox.shown` — 숨은 탭 · 숨은 워크스페이스면 거짓). 자원 칩은 보일 때만 표본을 당긴다 */
    shown = true,
    oninfocard,
    ontmuxcard,
    onforwardcard,
    onmenu,
    ontmuxmenu,
    onaimenu,
    onforwardmenu,
    onchipmore,
    onfiles,
    onzoom,
    onclose,
  }: {
    pane: PaneSpec;
    host?: HostEntry | null;
    active?: boolean;
    included?: boolean;
    shared?: boolean;
    aiStage?: AiStage | null;
    dbAi?: { level: DbAiLevel; broken: boolean } | null;
    aiMenuOpen?: boolean;
    zoomed?: boolean;
    zoomCombo: string;
    flip?: "term" | "convo" | null;
    flipCombo?: string;
    onflip?: (view: "term" | "convo") => void;
    menuOpen?: boolean;
    tmuxMenuOpen?: boolean;
    forwardMenuOpen?: boolean;
    chipMoreOpen?: boolean;
    forwards?: ForwardInfo[];
    sessionId?: number | null;
    shown?: boolean;
    /**
     * SSH 이름 카드를 띄우거나(`view`) 걷는다(`null`) — 카드는 타일 상자 **밖**에서 `PaneHost` 가 그린다
     * (상자마다 `isolation: isolate` 라 안에서 그리면 이웃 타일에 덮인다). `SessionInfoCard.svelte` 머리말.
     */
    oninfocard?: (view: SessionCardView | null) => void;
    /** tmux 칩 호버 카드를 띄우거나(`view`) 걷는다(`null`) — 이름 카드와 같은 까닭으로 `PaneHost` 가 그린다 */
    ontmuxcard?: (view: TmuxCardView | null) => void;
    /** 포워딩 칩 호버 카드 — tmux 카드와 같은 결 (`PaneHost` 가 상자 밖에 그린다) */
    onforwardcard?: (view: ForwardsCardView | null) => void;
    onmenu: (ev: MouseEvent) => void;
    /** tmux 칩 — 이벤트를 그대로 올린다 (팝오버 자리는 누른 칩의 사각형에서 나온다) */
    ontmuxmenu: (ev: MouseEvent) => void;
    /** AI 권한 칩 — tmux 칩과 같은 결 (팝오버는 `PaneHost` 가 상자 밖에 그린다) */
    onaimenu?: (ev: MouseEvent) => void;
    /** 포워딩 칩 — tmux 칩과 같은 결: 이벤트를 그대로 올린다 (목록 메뉴 자리는 누른 칩의 사각형에서 나온다) */
    onforwardmenu: (ev: MouseEvent) => void;
    /** "+N" 칩 — 숨은 칩 줄과 함께 올린다(메뉴는 `PaneHost` 가 상자 밖에 그린다 — `ChipMoreMenu`) */
    onchipmore?: (ev: MouseEvent, items: ChipMoreItem[]) => void;
    /** 폴더 칩 — 그 터미널의 폴더를 파일 타일로 (`openFilesFor` — 예전 📂 머리 버튼 · `Ctrl+Shift+O` 와 같은 몸통) */
    onfiles: () => void;
    onzoom: () => void;
    onclose: () => void;
  } = $props();

  /**
   * 머리줄 아이콘의 크기 — **여섯이 한 값을 나눠 쓴다** (버튼 넷 + 표식 둘 — 칩도 같은 값, 정의는 `HeaderChips` 의 `HEAD_ICON_*`). 칸마다
   * 적으면 하나가 뒤처져 그것만 커진다 (상태바 `StatusBar.svelte` 와 같은 규칙).
   *
   * 14px 는 24×24 버튼(작업면 단계 — 32px 머리줄) 안에서 여백이 고르게 남고(~58%, 상태바의
   * 비율과 같다) 옆의 `PaneIcon`(같은 값)과 같은 키다. 예전 값은 18×18 버튼의 13px 였다.
   */
  const ICON_SIZE = HEAD_ICON_SIZE;

  /** 헤더 색 점 — `sessions.toml` 의 병합된 최종 색. 없으면 점 자체를 그리지 않는다 */
  const color = $derived(host ? (hostMeta(host).color ?? null) : null);

  /**
   * **타일 코드** — 짧은 짝짓기 손잡이(`p2` / `t7·p2`). 머리줄에는 그리지 않고(2026-10-18) 이름 카드 · 말풍선에만 실린다.
   *
   * 창 레이블 + 타일 id 로만 만든다(cwd·이름과 무관) — 그래서 `paneName` 이 바뀌어도, 같은
   * 셸을 셋 열어 이름이 전부 "로컬" 이어도 셋이 서로 다르고, MCP `list_sessions` 의 `code` 와
   * **정확히 같은 문자열**이라 AI 가 "타일 p2" 라고 하면 사용자가 헤더에서 찾는다. 모든 종류의
   * 타일에 붙인다 — 코드는 타일의 안정된 신원이고(디버깅에도 쓴다), 세션이 없는 타일이 섞여도
   * 헤매지 않는다(MCP 짝짓기가 실제로 걸리는 것은 세션 타일뿐이지만 규칙은 하나로 둔다).
   *
   * 툴팁은 **완전한 저장소 키**(`main:pane-2`)다 — 파워유저·디버깅이 정확한 id 를 본다.
   */
  const code = $derived(tileCode(currentWindowLabel(), pane.id));
  /** 이 타일이 맡긴 도구줄(없으면 `null` — 터미널 · 작업안 · Run 보드) — 머리줄 가운데에 선다(머리말 "몸과 한 장이다") */
  const tools = $derived(paneToolsOf(pane.id));
  /** 왼쪽 무리 폭 고정(쿼리 타일 ④판 — 사이드바 경계까지, `pane-tools` 의 `span`) — `null` 이면 무리는 제 폭까지 */
  const span = $derived(tools?.span?.() ?? null);
  /** 아이콘 자리의 도는 고리(`pane-tools` 의 `iconBusy` — 쿼리 타일 연결 중) — 그 글자, 아니면 `null` */
  const iconBusy = $derived(tools?.iconBusy?.() ?? null);
  // 머리줄이 섰다는 사실을 표에 적는다 — 타일은 이것을 보고 제 도구줄을 몸 맨 위에 그릴지 정한다
  $effect(() => markPaneHead(pane.id));

  /**
   * **화면에 보이는 이름** — 이름 칸의 글자이자 이름 말풍선의 재료.
   *
   * 말풍선도 `paneName`(안정된 정체성)이 아니라 이것을 쓴다 (2026-09-28,
   * docs/log/2026-09-28-tile-header-tooltips.md): 셸 id 가 없는 AI 타일(Claude Code·Codex)은
   * `paneName` 이 "로컬" 이라, 이름 칸은 "Claude Code" 인데 말풍선은 "로컬" 이라고 말했다.
   */
  const shownName = $derived.by(() => {
    const tab = pane.kind === "run" ? tabOfPane(pane.id) : null;
    const path = tab?.orch ? orchScreenPath(tab) : null;
    if (path?.view === "library") return t("orch.home.library");
    if (path?.view === "studio") return studioLabel(path.repo ?? "");
    if (path?.view === "artists") return t("orch.nav.artists");
    if (path?.view === "new") return t("orch.library.newAlbum");
    return displayName(pane);
  });

  /**
   * **연결 상태 말풍선 첫 줄** — `web-01 — deploy@10.0.0.9:22` (호스트를 모르면 이름만).
   * SSH 이름 말풍선(아래 `nameTitle`)만 쓴다 (docs/log/2026-09-17-connect-diagnostics.md).
   */
  const head = $derived.by(() => {
    const label = host ? hostLabel(host) : "";
    return label ? t("pane.header.title.host", { name: shownName, host: label }) : shownName;
  });

  /*
   * 머리줄 전체에 걸던 툴팁(이름 + 미리 보기 + 드래그 안내 + "우클릭하면 메뉴")은 **뺐다**
   * (2026-09-28 사용자 결정, docs/log/2026-09-28-tile-header-tooltips.md). 머리줄 어디에
   * 손을 얹어도 서너 줄짜리 설명이 떴고, 그 첫 줄은 AI 타일에서 틀린 이름("로컬")까지 말했다.
   * 끌기·우클릭은 한 번 해 보면 아는 것이다.
   */

  /**
   * **미리 보기 문서**인가 (`PaneSpec.docPreview` · docs/log/2026-09-27-doc-tile.md "미리 보기 타일 재사용") —
   * 이름을 기울여 쓴다(VS Code 미리 보기 탭의 관례). 다음에 여는 파일이 이 칸을 갈아 끼운다는 표시다.
   */
  const docPreview = $derived(pane.kind === "doc" && pane.docPreview === true);

  /**
   * **저장 안 한 변경**이 있는 문서인가 (docs/log/2026-09-27-doc-edit.md "F2") — 이름 바로 뒤에 ● 하나.
   * 표는 편집기(`DocView`)가 채운다(`doc-dirty` — `$state` 라 여기서 반응형으로 읽힌다).
   */
  const unsaved = $derived(pane.kind === "doc" && dirtyDocPanes().includes(pane.id));

  // ── 연결 상태 말풍선 (docs/log/2026-09-17-connect-diagnostics.md) ───────────
  //
  // ## 왜 "미리 받아 두고 호버에서 갱신" 인가
  //
  // 툴팁 층(`tooltip.svelte.ts`)은 `pointerover` 를 **document 캡처 단계**에서 받아 그
  // 자리에서 `title` 글자를 읽고, 500ms 뒤에 **그때 읽어 둔 글자**를 띄운다. 즉 우리 쪽
  // 핸들러(버블)가 아무리 빨리 값을 채워도 **이번 호버에는 반영되지 않는다** — "호버하면
  // 그때 가져온다" 는 이 앱에서 원리적으로 한 박자 늦는다.
  //
  // 그래서 값은 **세션이 붙는 순간** 한 번 받아 둔다(사람이 머리줄에 다가가기 한참 전이다).
  // 호버는 **다음 번을 위한 갱신**이고, 실제로 낡는 값은 "접속 N분 전" 과 "지연 Nms" 둘뿐이라
  // 한 박자 늦어도 읽는 사람이 손해 볼 것이 없다. 타이머는 두지 않는다 — 타일마다 60초
  // 인터벌을 걸면 아무도 보지 않는 말풍선 때문에 세션마다 왕복이 하나씩 생긴다.
  let info = $state<SessionInfo | null>(null);
  /** 마지막으로 받아 온 시각 — 호버 갱신을 이 간격으로 묶는다 */
  let infoAt = 0;
  /** 이 갱신이 여전히 최신인가 (늦게 온 답이 새 세션의 값을 덮지 않게) */
  let infoFor: number | null = null;

  /** 지나치게 자주 묻지 않는다 — 셋째 줄의 값이 바뀔 만한 간격 */
  const INFO_STALE_MS = 30_000;

  async function loadInfo(id: number): Promise<void> {
    infoFor = id;
    infoAt = Date.now();
    try {
      const next = await fetchSessionInfo(id);
      if (infoFor === id) info = next;
    } catch {
      // 상태 한 장을 못 받은 것으로 화면이 달라질 일은 없다 — 말풍선이 예전 모양으로 남는다.
    }
  }

  $effect(() => {
    const id = sessionId;
    if (pane.kind !== "ssh" || id === null) {
      info = null;
      infoFor = null;
      return;
    }
    void loadInfo(id);
  });

  /** 머리줄에 포인터가 들어왔다 — **다음 호버를 위해** 값을 새로 받아 둔다 (위 주석) */
  function refreshInfoSoon(): void {
    const id = sessionId;
    if (pane.kind !== "ssh" || id === null) return;
    if (Date.now() - infoAt < INFO_STALE_MS) return;
    void loadInfo(id);
  }

  /**
   * 머리줄 요소 — `pointerover` 를 **마크업이 아니라 여기서** 건다.
   *
   * `onpointerover={…}` 를 `<div>` 에 직접 적으면 a11y 검사가 "역할 없는 정적 요소에 포인터
   * 상호작용" 으로 잡는다(`a11y_no_static_element_interactions`). 그런데 이 리스너는 **상호
   * 작용이 아니다** — 누르는 것도 고르는 것도 아니고, 말풍선 재료를 미리 받아 두는 캐시
   * 갱신일 뿐이라 키보드로 대신할 행동이 없다. 역할을 지어내 붙이는 대신(스크린 리더에
   * 없는 구조를 만든다) 리스너만 코드에서 건다 — `dragstart`·`contextmenu` 를 마크업에
   * 적지 않는 것과 같은 이유다(파일 머리말).
   */
  let headEl = $state<HTMLDivElement | null>(null);
  /** AI 타일이면 머리줄을 적는다 — 카드 뒤집기(`pane/flip-motion.ts`)가 면이 바뀌는 프레임까지 옛 면 색(`--flip-ink`)을 붙잡는다 */
  const flipHead = $derived(flip !== null);
  $effect(() => {
    const head = headEl;
    const id = pane.id;
    if (!head || !flipHead) return;
    return registerFlipHead(id, head);
  });

  function onHeadPointerOver(): void {
    refreshInfoSoon();
    measureName();
  }

  $effect(() => {
    const el = headEl;
    if (!el) return;
    el.addEventListener("pointerover", onHeadPointerOver, { passive: true });
    return () => el.removeEventListener("pointerover", onHeadPointerOver);
  });

  /**
   * SSH 이름의 **연결 상태 한 줄 글자** — 상태를 아직 못 받았으면 `null`.
   *
   * 2026-09-28 부터 눈으로 읽는 것은 카드(아래)이고, 이 글자는 이름 칸의 **접근성 설명**
   * (`aria-describedby` 가 가리키는 숨은 한 줄)만 쓴다 — 스크린 리더는 예전 말풍선과 같은 글자를 읽는다.
   */
  const nameTitle = $derived(
    info === null ? null : [head, ...sessionInfoLines(info, t, Date.now())].join("\n"),
  );

  // ── SSH 이름 카드 (docs/log/2026-09-28-tile-header-tooltips.md "SSH 이름 카드") ─────────────
  //
  // 이름 칸의 `title`(여러 줄 글자)을 **라벨 | 값 카드**로 바꿨다. 이름 칸에는 `title` 이 없다 — 공용
  // 말풍선(`tooltip.svelte.ts`)은 `[title]` 만 집으므로 둘이 겹쳐 뜨지 않는다(상태바 사용량 카드와 같은 판).
  //
  // 뜨는 규칙은 공용 말풍선에 맞춘다: 시계 `TOOLTIP_DELAY_MS` · 포인터가 나가거나 누르면 · `Esc` · 휠·스크롤 ·
  // 창 크기 · 창 포커스를 잃으면 접는다. 이름 칸은 탭 멈춤이 아니라(예전에도 아니었다) 키보드 포커스로는 뜨지
  // 않는다 — 탭 멈춤을 새로 만들지 않았다.
  //
  // 값은 예전 그대로 "미리 받아 두고 머리줄 호버에서 갱신"(위 절)이다. 카드는 반응형이라 호버 갱신의 답이
  // 카드가 떠 있는 동안 오면 그 자리에서 새 값으로 바뀐다 — 예전 말풍선처럼 한 박자 늦지 않는다.
  /** 카드를 연 시각 — "접속 N분 전" 의 기준 */
  let cardNow = $state(0);
  // 시계 · 창 전역 닫기는 공용 한 벌(`createHoverArm`) — tmux · 포워딩 칩 카드와 같다
  const nameHover = createHoverArm({
    target: () => nameEl,
    before: () => {
      // 로컬 터미널 타일도 같은 카드다(2026-10-11 — 원격 전용 줄만 빠진다, 아래 `localCard`). 비터미널 타일은 없다.
      // 로컬은 받아 올 것이 없다 — 앱이 이미 아는 사실(셸 · AI · 폴더)뿐이다.
      // 쿼리 타일도 같은 판(10-14 — 엔진 · 서버 버전 · 모드, 아래 `queryCard`). 받아 올 것이 없다(타일이 쥔 사본뿐).
      if (pane.kind === "query") return true;
      if (pane.kind !== "local" && (pane.kind !== "ssh" || sessionId === null)) return false;
      refreshInfoSoon();
      return true;
    },
    onShow: () => {
      cardNow = Date.now();
    },
  });
  const armCard = nameHover.arm;
  const hideCard = nameHover.hide;

  /**
   * 카드 한 장 — 시계가 다 돌았을 때만. SSH 는 상태를 받은 뒤, 로컬은 곧바로(`localCard` — 몸통만 다르고
   * 머리 · 판 · 자리 · 닫힘은 한 벌이다).
   */
  const cardView = $derived.by<SessionCardView | null>(() => {
    const anchor = nameHover.anchor;
    if (anchor === null) return null;
    if (pane.kind === "local") {
      return { name: shownName, code, address: "", color, card: localCard, anchor };
    }
    if (pane.kind === "query") {
      const q = queryCard;
      if (q === null) return null;
      return { name: shownName, code, address: q.address, color: null, icon: q.icon, card: q.card, anchor };
    }
    if (info === null) return null;
    return {
      name: shownName,
      code,
      address: host ? hostLabel(host) : "",
      color,
      card: sessionInfoCard(info, t, cardNow),
      anchor,
    };
  });

  // 떠 있는 동안 값이 바뀌면 새 장을 올리고, 걷히거나 이 머리줄이 사라지면 `null` 을 올린다.
  $effect(() => {
    const v = cardView;
    const emit = oninfocard;
    if (v === null || !emit) return;
    emit(v);
    return () => emit(null);
  });

  // SSH 가 아니게 되거나 세션이 바뀌면(재연결) 떠 있던 카드를 걷는다.
  $effect(() => {
    void sessionId;
    void pane.kind;
    return () => hideCard();
  });

  // ── 이름 말줄임 말풍선 (2026-09-28) ─────────────────────────────────────────
  //
  // SSH 가 아닌 타일의 이름에는 말풍선이 **없다** — 보이는 글자가 곧 전부다. 예외는 좁은
  // 타일에서 이름이 **말줄임(…)으로 잘렸을 때** 하나이고, 그때만 전체 이름을 건다.
  //
  // ## 언제 재는가 — 호버가 아니라 크기가 바뀔 때
  //
  // 툴팁 층은 `pointerover` 를 **document 캡처**로 받아 그 순간의 `title` 을 읽는다 (위
  // "연결 상태 말풍선" 절과 같은 사정) — 이름 칸의 호버 리스너에서 재면 이번 호버에는 늦는다.
  // 그래서 `title` 은 **미리** 붙어 있어야 하고, 잘림 여부는 이름 칸의 크기가 바뀔 때
  // (`ResizeObserver`) 잰다. 글자가 바뀌어 잘림이 생기거나 풀리면 칸의 폭도 바뀌므로(칸은
  // `max-content` 까지 자란다) 같은 관찰이 받는다. 이미 잘린 채로 글자만 바뀌면 여전히 잘린
  // 것이라 다시 잴 것이 없다 — `title` 이 `shownName` 을 반응형으로 따라간다.
  // 드문 틈(폭은 같은데 글자 폭만 바뀐 때 — 글꼴이 늦게 붙는 등)은 머리줄 `pointerover` 에서
  // 한 번 더 잰다 — 이름 칸에 닿기 전에 대개 머리줄을 먼저 지난다.
  let nameEl = $state<HTMLSpanElement | null>(null);
  /** 정체성 묶음 — 칩 접기가 재는 상자(`HeaderChips` 의 `fitBox` · `pane/chip-fit-dom.ts`) */
  let identEl = $state<HTMLSpanElement | null>(null);
  let truncated = $state(false);

  function measureName(): void {
    const el = nameEl;
    if (!el) return;
    truncated = el.scrollWidth > el.clientWidth;
  }

  $effect(() => {
    const el = nameEl;
    if (!el) return;
    const ro = new ResizeObserver(measureName);
    ro.observe(el);
    // 카드의 포인터 리스너도 여기서 건다 — 마크업에 적으면 정적 요소 상호작용(a11y)으로 잡힌다
    // (위 `headEl` 절과 같은 이유: 누르는 것이 아니라 보여 주는 것뿐이다).
    el.addEventListener("pointerenter", armCard, { passive: true });
    el.addEventListener("pointerleave", hideCard, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("pointerenter", armCard);
      el.removeEventListener("pointerleave", hideCard);
    };
  });

  /**
   * 이름 칸의 `title` — 전체 이름 뒤에 **타일 코드**(`이름 · p3`). **터미널이 아닌 타일만**(2026-10-11 — 로컬 터미널은
   * SSH 처럼 이름 카드가 코드를 쥔다, 아래 `localCard`). 2026-10-05 부터 코드 칩은 AI 읽기
   * 허용(✦) 타일에서만 서므로(docs/log/2026-09-25-leftovers-surface-header.md "덧붙임 (2026-10-05)"), 그 밖의 타일에서 코드를
   * 확인하는 길이 이 말풍선이다 — 그래서 잘리지 않았어도 늘 단다(예전엔 잘렸을 때만 전체 이름).
   * SSH 는 연결 상태를 받아 온 뒤로는 `title` 이 없다 — 카드(위, 이름 줄에 코드가 함께 선다)가 그 자리를
   * 쥔다. 받기 전(드문 틈)에는 다른 타일과 같은 말풍선이다.
   */
  const baseNameTip = $derived(pane.kind === "local" || pane.kind === "query" || nameTitle !== null ? null : `${shownName} · ${code}`);
  /** 타일이 맡긴 덧붙임 줄(`PaneTools.nameTip` — 브랜치 타일의 읽기 전용 · 기준 브랜치)을 둘째 줄부터 붙인다 */
  const nameTip = $derived.by(() => {
    const extra = tools?.nameTip?.() ?? null;
    if (extra === null) return baseNameTip;
    return baseNameTip === null ? `${shownName}\n${extra}` : `${baseNameTip}\n${extra}`;
  });
  /** 접근성 설명(숨은 한 줄)의 id */
  const infoDescId = $derived(`session-info-${pane.id}`);

  // ── 기준 폴더 (2026-10-11) — 폴더 칩 · 브랜치 칩(`HeaderChips`)과 로컬 이름 카드(아래 `localCard`)가 함께 쓴다 ──────
  //
  // - 기준 폴더 = 셸이 알려 준 지금 폴더(OSC 7 · 9;9 — 로컬 WSL 은 이 PC 경로로) → 시작 폴더(`PaneSpec.cwd`) → 모름.
  //   tmux 타일은 모름(셸 통합이 없다) — 폴더 칩은 흐린 `folder` + 까닭 말풍선, 브랜치 칩은 없다. 규칙은 `$lib/pane-chips`.
  const terminal = $derived(pane.kind === "local" || pane.kind === "ssh");
  const folder = $derived(
    !terminal
      ? null
      : chipFolder({
          reported: pane.kind === "local" ? localReportedFolder(pane) : reportedCwd(pane.id),
          start: pane.cwd,
          tmux: pane.kind === "ssh" && !!pane.tmux,
        }),
  );
  /**
   * **로컬 이름 카드의 몸통** (2026-10-11 사용자) — 로컬 터미널 타일의 이름도 SSH 처럼 카드가 뜬다(예전엔 `title`
   * 말풍선 `이름 · p3`). 머리(이름 + 코드)는 SSH 카드와 같고, 몸통은 앱이 이미 아는 것만: 지금 도는 AI(없으면 셸)
   * · 작업 폴더(폴더 칩과 같은 기준 `folder`). 로컬이 아니면 쓰지 않는다.
   */
  const localCard = $derived.by(() => {
    const ai = pane.kind === "local" ? paneAi(pane) : null;
    return localInfoCard(
      {
        ai: ai === null ? null : (aiDisplayName(ai) ?? ai),
        shell: shellLabel(resolvedShellOf(pane.id) ?? pane.shell, t),
        folder,
      },
      t,
    );
  });

  /**
   * **쿼리 타일의 이름 카드** (10-14 사용자) — 위 띠의 엔진 이름(호버 = 서버 버전)을 옮겼다. 원격 카드와 같은 판: 머리 = 엔진 로고 +
   * 이름 + 코드, 주소 줄 = `사용자@주소:포트`(SQLite 는 파일). 값은 연결 목록 사본 · 타일의 지금(`app/query-live`) · AI 권한 사본뿐이다
   * (비밀번호 없음 · 새 서버 op 없음). 줄 규칙은 `query/info-card`.
   */
  const queryCard = $derived.by(() => {
    if (pane.kind !== "query" || !pane.query) return null;
    const conn = findDbConn(pane.query.connId);
    const live = queryLiveOf(pane.id);
    return {
      address: queryAddress(conn),
      icon: queryCardIcon(conn, live),
      card: queryInfoCard({ name: shownName, conn, live, ai: dbAiLevelOf(pane.query.connId) }, t),
    };
  });

  /**
   * 이름 칸의 **접근성 설명**(숨은 한 줄 — 눈에는 카드) — SSH 는 연결 상태 글자(`nameTitle`), 로컬은 카드와 같은
   * 사실(`이름 · p3` + 줄들). 그 밖의 타일은 `null`(이름 `title` 말풍선이 그대로다).
   */
  const infoDesc = $derived(
    pane.kind === "local"
      ? infoCardText(`${shownName} · ${code}`, localCard)
      : queryCard !== null
        ? infoCardText([`${shownName} · ${code}`, queryCard.address].filter(Boolean).join(" · "), queryCard.card)
        : nameTitle,
  );

</script>

<div
  class="pane-head"
  class:active
  class:term={pane.kind === "local" || pane.kind === "ssh"}
  class:talk={flip === "convo"}
  class:has-tools={tools !== null}
  bind:this={headEl}
  data-pane-head={pane.id}
  draggable="true"
>
  <!--
    왼쪽 무리(맨 앞 조각 · 색 점 · 아이콘 · 이름 묶음 · 이름 뒤 조각) — 평소에는 `display: contents` 라 없는 것과 같다(아래 자식이 머리줄의 칸으로
    바로 선다). 타일이 `span` 을 주면(쿼리 타일 — 사이드바가 열림) 무리가 머리줄 왼쪽 끝부터 그 x 까지를 쥐는 상자가 된다(`pane-tools` · ④판).
  -->
  <div
    class="pane-group"
    class:spanned={span !== null}
    style:width={span === null ? null : `calc(${span}px - var(--space-3) - var(--space-2))`}
  >
  {#if tools?.lead}
    <!-- 타일이 맡긴 맨 앞 조각 — 파일 타일의 뒤로/앞으로 · 보기 고르개(`pane/pane-tools.svelte.ts`) -->
    <span class="pane-lead">{@render tools.lead()}</span>
  {/if}
  {#if color}
    <!-- 사이드바의 점과 **같은 색** (sessions.toml 의 병합된 최종값) -->
    <span class="swatch" style:background={color} aria-hidden="true"></span>
  {/if}
  <!--
    앞자리 아이콘 — 이 타일이 **무엇인가**를 그림 하나로 (PowerShell·Bash·배포판 펭귄·
    호스트에 붙인 로고·폴더). 색 점이 "어느 호스트" 를 말한다면 이쪽은 "무엇" 을 말한다:
    둘 다 있는 SSH 타일에서 점과 로고가 겹쳐 읽히지 않도록 점 **뒤**, 이름 **앞**이다.
    규칙은 `PaneIcon` 한 곳에 있다 (탭·상태바와 같은 답).
  -->
  {#if iconBusy !== null}
    <!-- 아이콘 자리의 도는 고리(쿼리 타일 연결 중 — `iconBusy`). 아이콘과 같은 상자 크기라 줄이 밀리지 않는다 -->
    <span class="icon-busy" role="status" title={iconBusy} aria-label={iconBusy} style:width="{ICON_SIZE}px" style:height="{ICON_SIZE}px"
      ><span class="ring" aria-hidden="true"></span></span
    >
  {:else if tools?.hideIcon !== true}
    <!-- 파일 타일은 아이콘을 그리지 않는다(`hideIcon` — 로컬 · 원격은 경로 칸 첫 조각이 말한다, 10-20 사용자) -->
    <PaneIcon {pane} size={ICON_SIZE} />
  {/if}

  <!--
    보이는 이름은 `displayName` — 로컬 타일이면 셸이 바꾼 창 제목(OSC 0/2)이나 해석된 셸
    이름을 띄운다("로컬" 대신).
  -->
  <!--
    이름의 말풍선(`nameTip`): SSH 타일은 **연결 상태** 카드(상태를 받아 온 뒤 —
    docs/log/2026-09-17-connect-diagnostics.md), 로컬 터미널은 같은 판의 카드(셸·AI · 폴더 — 2026-10-11),
    그 밖에는 전체 이름 · 타일 코드(`이름 · p3` — docs/log/2026-09-25-leftovers-surface-header.md "덧붙임 (2026-10-05)").
  -->
  <!--
    정체성 묶음 — 이름과 그 뒤 표식·칩을 **한 덩어리**로 둔다 (2026-09-26 — 그때는 타일 코드도 여기 섰다, 10-18 걷음,
    docs/log/2026-09-25-leftovers-surface-header.md 덧붙임). 예전에는 이름이 `flex:1` 이라
    코드가 그 뒤 빈칸을 건너 오른쪽 끝에 떨어져 섰다 — 동작 버튼이 숨은 타일에서는 옆에 아무것도
    없이 외톨이였다. 이제 늘어나는 칸은 이 묶음이고, 안에서 이름이 먼저 줄고(말줄임) 코드는 줄지
    않는다. AI 읽기 허용 표식(✦)도 같은 이유로 코드 뒤 이 묶음 안에 든다(2026-09-28). 나머지
    표식·버튼은 묶음 뒤라 예전 그대로 오른쪽에 선다.
  -->
  <span class="pane-ident" class:gone={tools?.replaceName === true} data-chip-fit bind:this={identEl}>
    <span
      class="pane-name"
      data-fit-name
      class:preview={docPreview}
      bind:this={nameEl}
      title={nameTip}
      aria-describedby={infoDesc === null ? null : infoDescId}
      data-session-info={infoDesc === null ? null : pane.id}>{shownName}</span
    >
    {#if unsaved}
      <!-- 저장 안 한 변경 — 글자 ●(편집기 도구줄의 표시와 같은 글자). 이름이 줄어도 이것은 줄지 않는다 -->
      <span class="unsaved" title={t("pane.header.doc.unsaved")} aria-label={t("pane.header.doc.unsaved")}>●</span>
    {/if}

    <!--
      타일 코드(`p2` — MCP `list_sessions.code`)는 머리줄에 그리지 않는다(2026-10-18 사용자 — 예전엔 AI 읽기 허용 로컬 타일에
      각인 칩이 섰다). 코드는 이름 카드(터미널)·말풍선(그 밖)·권한 팝오버 머리가 쥔다.
    -->
    <!--
      칩 묶음 — 폴더 · 브랜치 · 경유 · tmux · 포워딩 · 자원 · AI 권한을 **설정에 저장된 순서 · 켬끔대로**(2026-10-18) 늘어놓는다.
      마크업 · 칩별 색 · 넘칠 때 접기(이 묶음을 잰다 — `data-chip-fit` · 2026-10-23)는 `HeaderChips.svelte` 에 산다. 자식은 감싸개 없이 이 묶음(grid)의 칸으로 바로 선다.
    -->
    <HeaderChips
      {pane}
      {host}
      {shared}
      {aiStage}
      {dbAi}
      {aiMenuOpen}
      {tmuxMenuOpen}
      {forwardMenuOpen}
      {chipMoreOpen}
      {forwards}
      {sessionId}
      {shown}
      {folder}
      {ontmuxcard}
      {onforwardcard}
      {ontmuxmenu}
      {onaimenu}
      {onforwardmenu}
      {onchipmore}
      {onfiles}
      fitBox={identEl}
    />
  </span>
  {#if tools?.tail}
    <!-- 이름 뒤 조각 — 쿼리 타일의 사이드바 토글(무리 고정이면 무리 오른쪽 끝 = 사이드바 경계). 감싸개 없이 무리의 칸으로 선다(드러냄 절) -->
    {@render tools.tail()}
  {/if}
  </div>
  {#if tools}
    <!--
      가운데 — 그 타일의 도구줄(스니펫 — 정의한 타일의 상태 · 스코프 CSS 를 그대로 든다). 끌기는 단추 · 입력 칸 · 제 끌기가 있는 칸에서
      시작하지 않고(`drop-controller` 의 `onDragStart`), 우클릭은 그 칸이 제 메뉴를 갖고 있으면 그쪽이 먼저다(`PaneHost` 의 `onContextMenu`).
    -->
    <div class="pane-tools" data-pane-tools={pane.id}>{@render tools.bar(true)}</div>
  {/if}
  {#if infoDesc !== null}
    <!-- 터미널 이름의 접근성 설명 — 눈에는 카드(`SessionInfoCard`)가, 스크린 리더에는 같은 사실의 글자가 -->
    <span class="sr-info" id={infoDescId}>{infoDesc}</span>
  {/if}


  {#if included}
    <span class="syncmark" title={t("pane.header.sync.title")}>
      <UiIcon name="check" size={ICON_SIZE} />
    </span>
  {/if}

  {#if flip !== null}
    <!--
      터미널 ⇄ 대화 — AI 타일만(2026-10-17). 아이콘 단추 하나: 지금 터미널 면이면 대화 그림(`conversations`), 대화 면이면 터미널
      그림 — 누르면 그쪽으로. 눌림 상태(aria-pressed) 대신 이름이 "대화로 전환" / "터미널로 전환" 으로 바뀐다. 툴팁에 넘기기 조합.
    -->
    {@const to = flip === "term" ? "convo" : "term"}
    {@const label = t(to === "convo" ? "pane.flip.toConvo" : "pane.flip.toTerm")}
    <button
      type="button"
      class="head-btn flip-toggle"
      data-flip-toggle
      data-flip-to={to}
      title={flipCombo ? `${label} (${flipCombo})` : label}
      aria-label={label}
      onclick={(e) => {
        e.stopPropagation();
        onflip?.(to);
      }}
      ><UiIcon name={to === "convo" ? "conversations" : "terminal"} size={ICON_SIZE} /></button
    >
  {/if}

  <!--
    ⋯ — 이 타일에 거는 나머지 전부. 헤더 우클릭도 같은 메뉴를 연다.
    `data-tile-menu-btn` 은 "바깥 클릭으로 닫기" 가 이 버튼만 비켜 가게 하는 표시다
    (그래야 한 번 더 눌러 닫는 토글이 성립한다).
  -->
  <button
    type="button"
    class="head-btn more"
    data-tile-menu-btn
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    title={t("pane.header.menu.title")}
    aria-label={t("pane.header.menu.aria")}
    onclick={onmenu}><UiIcon name="more" size={ICON_SIZE} /></button
  >

  <!-- 📂 폴더 버튼은 2026-10-11 에 **폴더 칩**(정체성 묶음 안)이 되었다 — 같은 `onfiles` 다 -->

  <!--
    ⤢ 최대화 토글 — **모든 종류의 타일**에 붙는다 (터미널만의 조작이 아니다: 파일 목록도
    설정도 잠깐 크게 보고 싶을 때가 있다). 켜져 있으면 눌린 상태로 보이고, 툴팁이 지금
    걸린 조합을 그대로 말한다.

    **그림도 상태를 말한다**: 꺼져 있으면 밖으로 벌어지는 화살표(`maximize`), 켜져 있으면
    안으로 모이는 화살표(`restore`). 예전 한 글자(`⤢`)는 점등 색으로만 상태를 말했는데,
    색약·저대비 테마에서는 그 하나가 전부였다.
  -->
  <button
    type="button"
    class="head-btn zoom"
    class:on={zoomed}
    aria-pressed={zoomed}
    title={zoomed
      ? t("pane.header.zoom.on.title", { combo: zoomCombo })
      : t("pane.header.zoom.off.title", { combo: zoomCombo })}
    aria-label={t("pane.header.zoom.aria")}
    onclick={onzoom}
    ><UiIcon
      name={zoomed ? "restore" : "maximize"}
      size={ICON_SIZE}
    /></button
  >

  <button
    type="button"
    class="head-btn close"
    title={t("pane.header.close.title")}
    aria-label={t("pane.header.close.aria")}
    onclick={onclose}><UiIcon name="close" size={ICON_SIZE} /></button
  >
</div>

<style>
  /*
   * 헤더와 본문 — **높이를 flex 로 나누지 않고 절대배치로 못 박는다.**
   * 본문은 언제나 상자를 채우고, 헤더가 있는 상자에서만 `top` 이 헤더 높이만큼 내려간다
   * (`PaneHost` 의 `.pane-box.headed .pane-body`). 이러면 헤더가 생기고 사라져도 본문 DOM 은
   * 그대로이고(= 터미널 재마운트 없음), 터미널 높이 변화는 Terminal 안의 ResizeObserver →
   * refit 이 알아서 받아 낸다.
   */
  .pane-head {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    z-index: 3;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    box-sizing: border-box;
    /* 높이는 theme.css 의 `--tile-head-h`(32px) — `PaneHost` 가 본문을 같은 값만큼 내린다 */
    height: var(--tile-head-h);
    padding: 0 var(--space-1) 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    line-height: 1;
    color: var(--fg-2);
    /* 몸과 같은 크롬 면 · 구분선 없음(머리말 "몸과 한 장이다" — 2026-10-20. 예전 `--surface-raised` + 아래 `--line-faint` 선) */
    background: var(--tile-inner, var(--bg-panel));
    cursor: grab;
    user-select: none;
    /*
     * 헤더가 생길 때만 **불투명도**로 짧게 스며든다 (설정에서 "항상" 으로 바꾼 순간,
     * 타일이 둘이 되는 순간). 자리(`top`)는 절대 애니메이션하지 않는다 — 본문 높이가
     * 프레임마다 바뀌면 xterm 이 매 프레임 refit 하고 원격에 resize 를 쏟아붓는다.
     * 그래서 배치는 즉시, 색만 부드럽게다. 사라질 때는 페이드가 없다: `{#if}` 로 빠지는
     * 노드라 붙잡아 둘 자리가 없고, 붙잡으면 그동안 본문이 이미 올라와 있어 헤더가
     * 터미널 첫 줄 위에 겹친다.
     */
    animation: head-in 120ms ease-out;
    /* 조작 칸이 폭 0 ↔ 제 폭(`auto`)으로 접히고 펴질 때 그 사이를 그린다(아래 "드러냄" 절 — 모르는 엔진이면 그 자리에서 바뀔 뿐이다) */
    interpolate-size: allow-keywords;
  }

  @keyframes head-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* 움직임을 줄여 달라고 했으면 스며듦도 끈다 (트랜지션이 아니라 애니메이션이라 따로 적는다) */
  @media (prefers-reduced-motion: reduce) {
    .pane-head {
      animation: none;
    }
  }

  /* 활성 패널은 이름 글자만 한 단 밝게 — 면은 바꾸지 않는다(2026-10-20 — 포커스는 타일 테두리가 말한다. 예전엔 `--surface-hover` 판).
     타일 포커스는 강조색을 쓰지 않는다 (작업면 단계 결정 2). */
  .pane-head.active {
    color: var(--fg-1);
  }

  /*
   * **터미널 · AI 타일** — 머리줄을 칠하지 않는다: 타일 판(`.tile-frame` 의 `--term-bg-fill` — 터미널 테마 바탕 × 터미널 투명도)이 그대로
   * 비쳐 몸과 한 장이 된다. 글자는 터미널 글자색(`--term-fg` — `applySettings` 가 테마에서 옮겨 적는다), 단추는 그 색을 조금 흐리게.
   * 칩은 색 토큰을 이 스코프에서 터미널 글자색으로 바꿔 입힌다(칩 한 벌 `header-chip.css` 가 `--c` 로 판 · 글자를 만든다 — 판은 그 색의 옅은
   * 반투명). AI 권한의 승인 · 자동 단계 색(강조 · 경고)은 단계를 말하는 신호라 그대로 둔다.
   */
  .pane-head.term {
    --head-dim: color-mix(in srgb, var(--head-fg) 62%, transparent);
    --chip-tmux: var(--head-fg);
    --chip-folder: var(--head-fg);
    --chip-branch: var(--head-fg);
    --chip-jump: var(--head-fg);
    --chip-forward: var(--head-fg);
    --chip-ai-read: var(--head-fg);
    /* AI 권한 끔 칩(10-23) — 앱 테마의 흐린 글자는 터미널 바탕에서 안 읽힐 수 있어 머리줄의 흐린 글자로 */
    --chip-ai-off: var(--head-dim);
    --chip-resource: var(--head-fg);
    --chip-tint: 12%;
    --chip-tint-hover: 18%;
    color: var(--head-fg);
  }

  /*
   * **AI 타일의 [터미널 | 대화]**(2026-10-20 카드 뒤집기) — 대화 면이면 머리줄이 대화 층과 같은 면(`--surface-raised-solid`)으로 칠해지고
   * 글자는 크롬 글자색이다. 둘 다 수 `--flip-ink`(0 터미널 · 1 대화 — `pane/flip-motion.ts` 가 수로 등록) 하나로 섞는다: 쉬는 자리에선
   * 클래스가, 뒤집는 동안엔 계단 키프레임(타일이 가장자리를 지나 면이 바뀌는 프레임)이 정한다. 칩 · 단추가 모두 `--head-fg` 에서 색을 만든다.
   */
  .pane-head.term {
    --flip-ink: 0;
    --head-fg: color-mix(in srgb, var(--fg-1) calc(var(--flip-ink) * 100%), var(--term-fg));
    /* 검정 단색 로고(Codex …)도 면을 따른다 — 터미널 면이면 터미널 글자색(어두운 터미널 = 밝은 로고), 대화 면이면 크롬 값.
       오려낸 자리(`-inverse`)는 그 면의 바탕색. 같은 `--flip-ink` 라 뒤집기에서 글자와 함께 바뀐다(10-23 사용자) */
    --logo-mono: color-mix(in srgb, var(--logo-mono-chrome) calc(var(--flip-ink) * 100%), var(--term-fg));
    --logo-mono-inverse: color-mix(in srgb, var(--logo-mono-chrome-inverse) calc(var(--flip-ink) * 100%), var(--term-bg));
    background: color-mix(in srgb, var(--surface-raised-solid) calc(var(--flip-ink) * 100%), transparent);
  }

  .pane-head.term.talk {
    --flip-ink: 1;
  }

  /*
   * AI 읽기 허용은 머리줄에 **색을 입히지 않는다** — 틴트·훑기·강조색 아래 테두리를 걷었다
   * (2026-09-25 사용자 결정, docs/log/2026-09-25-work-surface.md 결정 4). 이것은 사용자가 켠
   * **옵션**일 뿐 AI 가 지금 이 타일에서 일하고 있다는 뜻이 아니다 — 실제 AI 작업은 백그라운드의
   * 따로 된 세션에서 돈다. 켜짐은 중성색 AI 권한 칩 하나(`HeaderChips` 의 `ai` — 막대 하나 + Read, 10-23)가 말한다.
   */

  .pane-head:active {
    cursor: grabbing;
  }

  /* 호스트 색 (sessions.toml) — 사이드바 점과 같은 값 */
  .swatch {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  /*
    정체성 묶음(이름 + 칩) — 머리줄에서 **늘어나는 칸은 이것 하나**다.
    이름·칩이 붙어 서고, 남는 폭은 묶음 뒤로 가서 나머지 표식·버튼을 오른쪽에 둔다.
    줄 수 있는 것은 이름 하나다.

    **안은 grid 다** (2026-09-28). 첫 칸을 `minmax(0, max-content)` 로 두면 이름 칸은 0 까지 준다.
    `justify-content: start` 는 뒤 칸(auto)이 남는 폭을 먹어 칩을 오른쪽으로 벌리지 않게 한다.

    **폭은 내용을 따르지 않는다** (2026-10-23 — `min-width: 0`). 칩 접기(`HeaderChips` · `pane/chip-fit-dom.ts`)가 이 상자의 폭을
    "칩 줄의 몫" 으로 재기 때문이다 — 예전처럼 `min-width: auto`(= 칩들의 폭)면 넘칠수록 상자가 함께 커져 넘침을 잴 수 없다.
    칩은 넘치기 전에 접히고(이름은 최소 72px 를 지킨다), 그래도 남는 넘침(아주 좁은 타일 — 숨지 않는 AI 권한 칩)은 이 상자가
    자른다(`overflow-x: clip` — ⋯ 위에 겹치지 않게. 세로는 그대로라 칩의 포커스 테가 잘리지 않는다).
  */
  .pane-ident {
    flex: 1;
    display: grid;
    grid-auto-flow: column;
    grid-template-columns: minmax(0, max-content);
    grid-auto-columns: auto;
    justify-content: start;
    align-items: center;
    column-gap: 6px;
    min-width: 0;
    overflow-x: clip;
  }

  /*
   * 도구줄이 선 머리줄 — 늘어나는 칸은 가운데 도구(`.pane-tools`)다. 이름 묶음은 제 폭까지만(그 이상은 말줄임 — 전체 이름은 말풍선)이고
   * 머리줄의 40% 를 넘지 않는다(긴 파일 이름이 도구를 다 밀어내지 않게). 좁아지면 도구 칸이 먼저 0 으로 줄어 잘리고, 그다음 이름이 준다.
   * 파일 타일은 이름 자리를 빵부스러기가 쥔다(`.gone` — 묶음을 그리지 않는다).
   */
  .pane-head.has-tools .pane-ident {
    flex: 0 1 auto;
    max-width: 40%;
  }

  .pane-ident.gone {
    display: none;
  }

  /*
   * 왼쪽 무리(쿼리 타일 ④판 — `pane-tools` 의 `span`). 평소에는 상자가 아니다(`contents` — 자식이 머리줄의 칸 그대로).
   * 고정이면 폭 = span − 머리줄 왼쪽 여백 − 무리 뒤 간격(인라인 `width` — 그래서 가운데 도구줄이 정확히 span 에서 시작한다).
   * 안에서 늘어나는 칸은 이름 묶음이고(남는 폭을 먹어 `tail` 을 오른쪽 끝으로 민다 · 모자라면 이름이 말줄임 — 전체 이름은 말풍선),
   * `tail` 의 조작이 포커스 밖에서 접혀도 무리 폭은 그대로다(탭이 밀리지 않는다). 아주 좁으면 무리도 준다(넘치지 않게).
   */
  .pane-group {
    display: contents;
  }

  .pane-group.spanned {
    flex: 0 1 auto;
    min-width: 0;
    box-sizing: border-box;
    align-self: stretch;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .pane-group.spanned .pane-ident {
    flex: 1 1 0;
    min-width: 0;
    max-width: none;
    overflow: hidden;
  }

  /*
   * 아이콘 자리의 도는 고리(`iconBusy` — 쿼리 타일 연결 중). 상자 = 아이콘 크기(인라인), 고리는 AI 대화 면의 도는 도구 고리
   * (`TranscriptBody` 의 `.spin` — 2px 테 · 위만 진하게 · 0.8s)와 같은 모양을 아이콘 크기에 맞춘 것. 움직임 줄이기면 서 있는 고리다.
   */
  .icon-busy {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .icon-busy .ring {
    width: 11px;
    height: 11px;
    box-sizing: border-box;
    border: 2px solid color-mix(in srgb, var(--fg-2) 25%, transparent);
    border-top-color: var(--fg-1);
    border-radius: 50%;
    animation: head-busy-spin 0.8s linear infinite;
  }

  @keyframes head-busy-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .icon-busy .ring {
      animation: none;
    }
  }

  .pane-tools {
    flex: 1 1 0;
    min-width: 0;
    align-self: stretch;
    display: flex;
    align-items: center;
    overflow: hidden;
    /* 도구줄은 제 글자 · 그림 색을 쓴다(그 타일의 스코프 CSS) — 머리줄의 끌기 커서만 걷는다 */
    cursor: default;
  }

  .pane-lead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    /* 조각 사이 — 파일 타일 도구줄(`.file-bar`)의 간격과 같은 4px(뒤로/앞으로 ↔ 보기 고르개) */
    gap: 4px;
    cursor: default;
  }

  /* 이름 — 패널이 좁아지면 여기서만 줄어든다 (숨은 조작 단추는 자리를 접는다 — 아래 "드러냄" 절).
     13px · 500 — 머리줄의 주역이다. 색은 머리줄을 따른다(포커스면 본문, 아니면 보조) */
  .pane-name {
    min-width: 0;
    /* 이름 뒤 한 숨 — 칩끼리 간격(6)보다 4 넓혀 "이름 | 칩들" 로 갈린다 (2026-10-11 사용자 요청) */
    margin-right: 4px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* SSH 이름의 접근성 설명 — 화면에서는 숨기고(카드가 대신) 읽기 도구에만 남긴다. 절대 위치라 flex 줄에 서지 않는다 */
  .sr-info {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: pre;
    border: 0;
  }

  /* 저장 안 한 변경 ● —이름 뒤 작은 글자. 강조색(누르는 것이 아니라 알리는 것이지만, 잃을 수 있는 것이라 눈에 띄게) */
  .unsaved {
    flex: 0 0 auto;
    margin-left: 4px;
    font-size: 9px;
    line-height: 1;
    color: var(--accent);
    cursor: default;
  }

  /* 미리 보기 문서 — 기울임(VS Code 의 미리 보기 탭). 기울어진 끝 글자가 말줄임 칸에 잘리지 않게 오른쪽 여유 */
  .pane-name.preview {
    font-style: italic;
    padding-right: 1px;
  }

  /*
    머리줄 버튼 넷 — 안에 드는 것은 이제 글자가 아니라 `UiIcon` 의 SVG 하나다 (2026-09-15).
    `UiIcon` 은 `display: block` 이라(줄 아래 descender 여백을 없애려는 규칙) 버튼 안에서
    저절로 가운데에 서지 않는다 — 그래서 **네 버튼 모두** flex 로 가운데를 잡는다 (예전에는
    폴더 버튼 하나만 SVG 라 거기에만 있던 규칙이다). 색은 건드리지 않는다: `currentColor` 라
    아래 호버·포커스·점등 규칙이 그대로 간다.
  */
  /* 작은 고스트 버튼(24×24 — `.btn-sm` 의 높이) — 흐림 회색, 손이 닿으면 한 단 밝은 글자와
     회색 판. 강조색 테두리 호버는 작업면 단계에서 뺐다. 활성 머리줄의 판(`--surface-hover`)
     위에서도 호버가 보이게 판은 한 단 더 밝힌다(`.btn-secondary` 의 호버 값). */
  .head-btn {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    box-sizing: border-box;
    width: 24px;
    height: 24px;
    padding: 0;
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    /* 접힐 때 지울 앞 간격 = 머리줄의 `gap`(아래 "드러냄" 절) — 단추 안은 24px 상자라 넘침을 잘라도 그림이 다 보인다 */
    --head-act-gap: var(--space-2);
    overflow: hidden;
    transition:
      opacity 120ms ease-out,
      width 120ms ease-out,
      margin 120ms ease-out;
  }

  /*
   * ## 드러냄 — 조작은 드러날 때만, 상태 · 정체는 늘 (2026-09-25 · 2026-10-20 실기 뒤 다시)
   *
   * 머리줄의 것은 두 부류다.
   * - **늘 보임**(상태 · 정체) — 그 타일을 읽는 데 필요한 것: 이름 · 칩 · 표식 · 타일 도구줄의 상태 칸(스크립트 탭 · 파일
   *   경로 · 문서 글자 크기 · 기준 브랜치 · 읽기 전용 표지 …). 아무 표시도 달지 않은 것은 전부 이쪽이다.
   * - **드러날 때만**(조작 단추) — `⋯ ⤢ ×` · 넘기기 단추(`.head-btn`)와 타일이 도구줄에서 `data-head-act` 를 단 요소(새로고침 · 새 폴더 · 보기 ·
   *   편집 …) · 이름 뒤 조각(`tail` — 쿼리 타일의 사이드바 토글, `.pane-group` 의 직계 칸)에서 `data-head-act` 를 단 요소, 그리고 맨 앞 조각
   *   (`.pane-lead` — 파일 타일의 뒤로/앞으로 · 보기 고르개). 표시 규칙은 `pane/pane-tools.svelte.ts` 머리말.
   *
   * 드러나는 때는 ① 포커스 타일(하나뿐인 타일 포함 — `active`) ② 포인터가 그 타일(머리줄이든 본문이든) 위에 있을 때 ③ 머리줄 안에 키보드
   * 포커스가 있을 때(Tab 으로 단추에 닿은 순간 보여야 한다) ④ 상태를 말하는 단추: 최대화가 켜진 ⤢("지금 크게 보는 중")와 메뉴가 열린 단추
   * (메뉴가 어디서 나왔는지) ⑤ 호버가 없는 장치(터치 — 드러낼 방법이 없다). **규칙은 아래 하나** — 그 밖일 때 숨긴다(머리줄은 `.pane-box` 의
   * 직계 자식이다(`PaneHost`) — 타일 전체의 호버는 그 상자에서 읽는다). 타일 코드는 2026-09-26~10-04 이 드러냄을 따랐다(10-18 머리줄에서 걷음).
   *
   * **숨으면 자리도 접는다**(2026-10-20 사용자 실기 — "포커스 밖에서 단추가 사라지면 늘 보여야 할 것의 자리를 다시 잡아야"): 폭 0 · 안쪽 여백 0 ·
   * 앞 간격을 음수 여백으로 지운다(`--head-act-gap` = 그 요소를 담은 줄의 `gap` — 줄이 정한다). 그래서 포커스 밖 타일은 늘 보이는 상태 칸이
   * 오른쪽 끝(`⋯ ⤢ ×` 자리)까지 붙어 선다(예: DB 타일 `로고 · 이름 · [스크립트 탭] ………`). 이름은 왼쪽이라 접혀도 밀리지 않는다.
   * 예외 하나 — 맨 앞 조각(`.pane-lead`)은 **자리를 쥔 채 흐려지기만** 한다: 아이콘 · 이름 **앞**이라 접으면 타일 위를 지날 때마다 정체가 옆으로
   * 미끄러진다.
   *
   * `display`/`visibility` 가 아니라 **폭 0 + 불투명도 + `pointer-events`** 다: 숨은 채로도 **Tab 으로 닿는다** — `visibility: hidden` · `display: none`
   * 이면 포커스 순서에서 빠져 ③ 드러냄이 영영 걸리지 않는다. 숨은 동안 그 자리를 누르면 머리줄(손잡이)이 받는다.
   */
  @media (hover: hover) {
    :global(.pane-box:not(:hover)) > .pane-head:not(.active):not(:focus-within) .head-btn:not(.zoom.on):not([aria-expanded="true"]),
    :global(.pane-box:not(:hover)) > .pane-head:not(.active):not(:focus-within) .pane-lead,
    :global(.pane-box:not(:hover)) > .pane-head:not(.active):not(:focus-within) .pane-group > :global([data-head-act]:not([aria-expanded="true"])),
    :global(.pane-box:not(:hover)) > .pane-head:not(.active):not(:focus-within) .pane-tools :global([data-head-act]:not([aria-expanded="true"]):not(:has([aria-expanded="true"]))) {
      opacity: 0;
      pointer-events: none;
    }

    :global(.pane-box:not(:hover)) > .pane-head:not(.active):not(:focus-within) .head-btn:not(.zoom.on):not([aria-expanded="true"]),
    :global(.pane-box:not(:hover)) > .pane-head:not(.active):not(:focus-within) .pane-group > :global([data-head-act]:not([aria-expanded="true"])),
    :global(.pane-box:not(:hover)) > .pane-head:not(.active):not(:focus-within) .pane-tools :global([data-head-act]:not([aria-expanded="true"]):not(:has([aria-expanded="true"]))) {
      width: 0;
      min-width: 0;
      padding-inline: 0;
      border-inline-width: 0;
      margin-inline: calc(-1 * var(--head-act-gap, 0px)) 0;
      overflow: hidden;
    }
  }

  /* 도구줄의 조작 칸도 같은 빠르기로 접히고 펴진다(폭 `auto` 까지 — `.pane-head` 의 `interpolate-size`) */
  .pane-lead,
  .pane-group > :global([data-head-act]),
  .pane-tools :global([data-head-act]) {
    transition:
      opacity 120ms ease-out,
      width 120ms ease-out,
      padding 120ms ease-out,
      margin 120ms ease-out;
  }

  @media (prefers-reduced-motion: reduce) {
    .head-btn,
    .pane-lead,
    .pane-group > :global([data-head-act]),
    .pane-tools :global([data-head-act]) {
      transition: none;
    }
  }

  .head-btn:hover {
    color: var(--fg-2);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

  /* 터미널 머리줄의 단추 — 터미널 글자색 계열(흐림 → 손이 오면 글자색 그대로 + 그 색의 옅은 판) */
  .pane-head.term .head-btn {
    color: var(--head-dim);
  }

  .pane-head.term .head-btn:hover,
  .pane-head.term .head-btn.zoom.on {
    color: var(--head-fg);
    background: color-mix(in srgb, var(--head-fg) 12%, transparent);
  }

  .head-btn:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /*
    상태 표식 — **버튼이 아니다** (토글은 ⋯ 메뉴에 있다). 아이콘 셋 규칙의 예외인 이유는
    켜 둔 줄 모르고 지나치면 안 되는 상태이기 때문이다. 꺼져 있으면 그리지 않는다.
    자리: 동시 입력은 ⋯ 앞 오른쪽. AI 읽기 허용은 칩 묶음의 AI 권한 칩이다(`HeaderChips.svelte` — 10-23 부터 원격과 같은 칩).
    상자는 버튼과 같은 이유로 flex 다 (안이 `display: block` 인 SVG 라 baseline 에 붙지 않는다).
  */
  .syncmark {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    line-height: 1;
    cursor: default;
  }

  /* 경고색 — 상자의 동시 입력 테두리·본문 배너와 같은 값이라 셋이 한 말로 읽힌다 */
  .syncmark {
    color: var(--warn);
  }

  /*
    최대화 중인 타일 — **눌린 토글**로 선다(본문 글자 + 회색 판 — 상태바의 열린 칸과 같은 말).
    화면에 타일이 하나뿐이라 "원래 이런 배치인가" 와 헷갈릴 수 있는데, 이 표식과 그림
    (`restore`)이 "지금 크게 보는 중" 이라고 말한다. 강조색이던 것을 작업면 단계에서 뺐다.
  */
  .head-btn.zoom.on {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

</style>
