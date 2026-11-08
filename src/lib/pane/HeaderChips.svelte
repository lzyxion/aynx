<script lang="ts" module>
  /**
   * 머리줄 아이콘의 크기 — 머리줄 버튼 · 표식(`PaneHeader`)과 칩이 **한 값**을 나눠 쓴다(근거는 `PaneHeader` 의
   * `ICON_SIZE` 주석). 칩 그림은 2px 작게(`ICON_SIZE - 2`).
   */
  export const HEAD_ICON_SIZE = 14;
</script>

<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import type { HostEntry } from "$lib/hosts";
  import { relayingConns, type ForwardInfo } from "$lib/forward";
  import type { PaneSpec } from "$lib/session";
  import AiGaugeMini from "$lib/AiGaugeMini.svelte";
  import { gaugeTone } from "$lib/ai-gauge";
  import { AI_STAGES, AI_STAGE_NAME, aiHostAlias, type AiStage } from "$lib/delegation";
  import { DB_AI_LEVELS, DB_AI_NAME, type DbAiLevel } from "$lib/db-ai";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import {
    refreshTmuxSessionsIfStale,
    tmuxSessionsOf,
    watchTmuxSessions,
    type TmuxCardView,
  } from "$lib/pane/tmux-sessions.svelte.js";
  import type { ForwardsCardView } from "$lib/pane/forward-menu.svelte.js";
  import { createHoverArm } from "$lib/pane/hover-arm.svelte.js";
  import { branchChipText, folderNameOf, folderUnknownTipKey } from "$lib/pane-chips";
  import { paneGitHead, refreshPaneGit, watchPaneGit } from "$lib/app/pane-git.svelte.js";
  import { openBranchGraphOfPane } from "$lib/app/branch-graph.svelte.js";
  import { settings } from "$lib/settings.svelte.js";
  import { localAiTile } from "$lib/app/delegation.svelte.js";
  import { resourceOutdated, resourceRing, resourceTop, watchResources } from "$lib/app/resources.svelte.js";
  import { openResourceView } from "$lib/app/usage-view.svelte.js";
  import { formatCpu, formatMem, tileUsage, topLine } from "$lib/resources";
  import { overflowAnchor, type ChipFitMode, type FitResult } from "$lib/pane/chip-fit";
  import { observeChipFit } from "$lib/pane/chip-fit-dom";
  import type { ChipMoreItem } from "$lib/pane/chip-more-menu.svelte.js";
  import type { HeaderChipId } from "$lib/header-chips";
  import "./header-chip.css";

  /**
   * **타일 머리줄의 칩 묶음** (2026-10-11 `PaneHeader.svelte` 에서 떼었다 — 마크업 · 스타일 · 접기 불변).
   * 순서 · 켬끔은 설정이 정한다(2026-10-18 — `settings.headerChipsShown`, 기본은 `$lib/header-chips` 의 `HEADER_CHIP_IDS` 순서:
   * 폴더 → 브랜치 → 경유 → tmux → 포워딩 → 자원 → AI 권한 — 10-23). 끈 칩은 그리지 않는다.
   *
   * 감싸개가 없다 — 칩은 부모의 정체성 묶음(`.pane-ident`, grid — `data-chip-fit` · `fitBox` 프롭)의 칸으로 바로 선다.
   *
   * ## 접기 표 — 재서 접는다, 사용자 순서가 곧 중요도 (2026-10-23 — docs/log/2026-10-23-header-chip-fit.md)
   *
   * 예전 고정 문턱(머리줄 폭 400 · 360 · 320 · 240px container query)은 걷었다 — 칩 수 · 순서 · 이름 길이를 몰랐다.
   *
   * ```text
   * 들어가면        아무것도 접지 않는다 (몫 = 묶음 폭 − 이름 최소 72px(이름이 더 짧으면 제 폭) − ● · Run 칩 − 펴질 ⋯ ⤢ × 몫)
   * 넘치면 1차      끝에서부터 한 칩씩 짧은 꼴로 — 그림만 (AI 권한 = 게이지만 · 포워딩 = 그림 + 트래픽 점 · tmux = 그림만)
   *                 자원 칩은 두 번: CPU · 메모리 → CPU → 그림
   * 그래도 넘치면 2차  끝에서부터 한 칩씩 숨기고 "+N" 칩 하나 (누르면 숨은 칩 목록 — 줄을 누르면 그 칩의 일)
   * AI 권한          어느 자리에 있든 숨지 않는다 — 게이지만까지
   * 펴기            16px 여유가 생길 때만 (문턱에서 깜빡이지 않게)
   * ```
   *
   * 판정(순수)은 `chip-fit.ts`, 재기(관찰자 · 한 rAF · 버튼 몫)는 `chip-fit-dom.ts`. 여기는 칩마다 표식(`data-fit-chip` · 꼴 수
   * `data-fit-forms` · 숨지 않음 `data-fit-pin` · 지금 꼴 `data-fit`)과 접히는 글자 표식(`data-fold` — 1 = 짧은 꼴부터 · 2 = 그림 꼴부터)을
   * 달고, 꼴마다의 모양은 아래 CSS 한 곳이 정한다. 재기 전 첫 그림은 모두 제 폭이고, 넘치는 몫은 묶음이 자른다(`overflow-x: clip`).
   *
   * 칩의 호버 카드(tmux · 포워딩)는 타일 상자 **밖**에서 `PaneHost` 가 그린다 — 여기는 값을 짓고 `ontmuxcard` ·
   * `onforwardcard` 로 올리기만 한다(상자마다 `isolation: isolate` 라 안에서 그리면 이웃 타일에 덮인다).
   * `data-*` 손잡이(`data-ai-menu-btn` · `data-ai-read-chip`(로컬 타일의 AI 권한 칩 — 10-23 부터 같은 칩) · `data-tmux-menu-btn` · `data-jump-chip` · `data-forward-chip` ·
   * `data-folder-chip` · `data-branch-chip` · `data-resource-chip`)는 하네스 · 바깥 클릭 판정이 잡는 이름이라 바꾸지 않는다.
   */
  let {
    pane,
    host = null,
    shared = false,
    aiStage = null,
    dbAi = null,
    aiMenuOpen = false,
    tmuxMenuOpen = false,
    forwardMenuOpen = false,
    forwards = [],
    sessionId = null,
    shown = true,
    folder,
    ontmuxcard,
    onforwardcard,
    ontmuxmenu,
    onaimenu,
    onforwardmenu,
    onfiles,
    fitBox = null,
    chipMoreOpen = false,
    onchipmore,
  }: {
    pane: PaneSpec;
    host?: HostEntry | null;
    /** AI 가 이 타일을 볼 수 있는가 — 로컬이면 AI 권한 칩의 Read(원격은 `aiStage` 칩) */
    shared?: boolean;
    /** 원격 타일의 AI 권한 단계 — 로컬·그 밖이면 `null` */
    aiStage?: AiStage | null;
    /**
     * 쿼리 타일의 DB AI 권한(10-14 — 연결 하나의 단계) — 그 밖이거나 연결이 목록에 없으면 `null`. 원격 칩과 같은 칩이 늘 서고(10-23) 누르면
     * 같은 권한 팝오버(`AiPermMenu`)가 뜬다(`onaimenu`). `broken` 은 연결 대상이 바뀌어 권한이 풀린 상태(끔으로 동작).
     */
    dbAi?: { level: DbAiLevel; broken: boolean } | null;
    aiMenuOpen?: boolean;
    tmuxMenuOpen?: boolean;
    forwardMenuOpen?: boolean;
    forwards?: ForwardInfo[];
    sessionId?: number | null;
    /** 타일이 지금 화면에 보이는가 — 자원 칩은 보일 때만 표본을 당긴다 */
    shown?: boolean;
    /** 기준 폴더(`PaneHeader` — 이름 카드와 같은 값). 터미널이 아니면 `null` */
    folder: string | null;
    ontmuxcard?: (view: TmuxCardView | null) => void;
    onforwardcard?: (view: ForwardsCardView | null) => void;
    ontmuxmenu: (ev: MouseEvent) => void;
    onaimenu?: (ev: MouseEvent) => void;
    onforwardmenu: (ev: MouseEvent) => void;
    onfiles: () => void;
    /** 칩이 칸으로 서는 묶음(`PaneHeader` 의 `.pane-ident` — `data-chip-fit`). 여기를 재서 접는다(`chip-fit-dom.ts`) */
    fitBox?: HTMLElement | null;
    /** 이 타일의 "+N" 메뉴가 열려 있는가 (`aria-expanded`) */
    chipMoreOpen?: boolean;
    /** "+N" 칩 — 숨은 칩 줄(여는 순간의 사본)과 함께 올린다. 메뉴는 `PaneHost` 가 상자 밖에 그린다 */
    onchipmore?: (ev: MouseEvent, items: ChipMoreItem[]) => void;
  } = $props();

  const ICON_SIZE = HEAD_ICON_SIZE;

  /**
   * **이 세션이 거쳐 온 경유 호스트**(`ProxyJump`) — 없으면 `null` 이고 칩을 그리지 않는다.
   *
   * 값의 출처는 호스트 캐시의 `HostEntry.proxy_jump` 다 (`PaneHost` 가 별칭으로 찾아 넘긴
   * `host` 프롭). 세션 자신에게 물을 길은 없다 — 경유는 `ssh` 가 접속 순간에만 쓰는 값이라
   * 열린 세션에 남지 않는다. 그래서 "붙을 때 이 설정이었다" 가 이 칩이 말할 수 있는 전부이고,
   * 호스트 폼에서 경유를 바꾸면 이미 열린 타일의 칩도 곧바로 따라간다(캐시가 갱신되므로) —
   * 그 타일의 실제 연결은 여전히 옛 경로다. 그래도 칩을 두는 편이 낫다: 이 값이 쓸모 있는
   * 순간은 "느리다 / 갑자기 끊겼다" 를 설명해야 할 때이고, 그때 보는 것은 지금의 설정이다.
   *
   * **빠른 접속 타일(`adhoc`)은 언제나 `null`** 이다 — 그 타일의 `alias` 는 설정의 별칭이
   * 아니라 화면에 보이는 `user@host:port` 라(`PaneSpec.adhoc`), 우연히 같은 이름의 호스트가
   * 설정에 있으면 남의 경유 정보를 뒤집어쓴다.
   */
  const jump = $derived(
    pane.kind === "ssh" && !pane.adhoc ? (host?.proxy_jump?.trim() || null) : null,
  );

  /**
   * **지금 이 타일의 터널들을 오가는 연결 수** — 0 이면 리스너만 서 있는 상태다.
   *
   * 칩 안의 점과 툴팁 마지막 줄이 이 하나를 본다. 누적 `conns` 가 아니라 `active_conns`
   * 인 이유는 `forward.ts` 의 `isForwardActive` 에 적혀 있다 — "한 번이라도 붙었다" 는
   * 지금 쓰이는 중인지를 말해 주지 못한다.
   */
  const relaying = $derived(relayingConns(forwards));

  /**
   * 칩 글자를 **숫자 앞뒤로 가른 것** — `forward ` + `2` + ``(10-23 — 연결 칩 글자는 모든 언어에서 소문자 영어 키워드 + 값: `via` · `tmux` · `forward`).
   *
   * 문장 전체(`forward {n}`)는 사전이 쥔다 — 영어는 수에 따라 단어가 갈리고
   * 어순도 언어마다 다르니 조각을 마크업에서 이어 붙일 수 없다(conventions 의 i18n 규칙).
   * 그런데 헤드리스 검증 스크립트는 **개수 하나**를 읽어야 하므로 그 숫자만 `<span class="n">`
   * 안에 서야 한다. 그래서 자리표시자에 **화면에 없는 글자**(U+0000)를 한 번 넣고 그 자리에서
   * 자른다 — 사전의 어느 자리에 `{n}` 이 있든 그대로 따라간다.
   *
   * 그 글자를 소스에 **글자 그대로** 적지 않는 이유: 편집기·도구에 따라 진짜 NUL 바이트가
   * 파일에 박히고, 그러면 `grep`·`rg` 가 이 소스를 바이너리로 보고 건너뛴다 (실제로 한 번
   * 그렇게 저장됐다). 소스는 순수 ASCII 로 두고 값만 실행 시에 만든다.
   */
  const NUM_SLOT = String.fromCharCode(0);
  const chipText = $derived.by(() => {
    const phrase = t(
      forwards.length === 1 ? "pane.header.forward.chip.one" : "pane.header.forward.chip.other",
      { n: NUM_SLOT },
    );
    const [head, tail = ""] = phrase.split(NUM_SLOT);
    return { head, tail };
  });

  // 포워딩 칩의 호버는 예전 `title`(머리 + 터널마다 한 줄 + 중계 중 연결 수)을 **카드**로 바꿨다 (2026-10-11 —
  // tmux 칩과 같은 몸짓, 아래 "포워딩 칩 호버 카드" 절). 숫자만으로는 "무엇이 열려 있는지" 를 알 수 없고, 그것을
  // 보려고 목록을 여는 것이 이 칩이 없애려던 걸음이라 카드가 터널마다 한 줄을 편다.

  // ── tmux 칩 호버 카드 (2026-10-05) ───────────────────────────────────────────
  //
  // 칩의 시스템 `title`(문장 한 줄)을 **세션들을 점과 함께 늘어놓은 카드**로 바꿨다(`TmuxSessionsCard`).
  // 뜨는 규칙은 이름 카드(위)와 같다: 시계 `TOOLTIP_DELAY_MS` · 포인터가 나가거나 누르면 · `Esc` · 휠·스크롤 ·
  // 창 크기 · 창 포커스를 잃으면 접는다. 목록 팝오버가 열려 있으면 띄우지 않는다(같은 내용이 이미 크게 떠 있다).
  // 목록은 칩이 설 때 한 번 읽어 두고(`watchTmuxSessions`), 호버 때 오래됐으면 뒤에서 다시 묻는다 —
  // 아직 하나도 못 읽었으면 카드는 뜨지 않는다(칩의 `aria-label` 이 이름을 쥔다).
  $effect(() => {
    if (!pane.tmux || sessionId === null) return;
    return watchTmuxSessions(sessionId);
  });
  const tmuxSessions = $derived(pane.tmux ? tmuxSessionsOf(sessionId) : null);

  let tmuxEl = $state<HTMLButtonElement | null>(null);
  const tmuxHover = createHoverArm({
    target: () => tmuxEl,
    before: () => {
      if (sessionId !== null) refreshTmuxSessionsIfStale(sessionId);
      return true;
    },
  });
  const armTmuxCard = tmuxHover.arm;
  const hideTmuxCard = tmuxHover.hide;

  const tmuxCardView = $derived<TmuxCardView | null>(
    pane.tmux && tmuxSessions !== null && tmuxSessions.length > 0 && tmuxHover.anchor !== null && !tmuxMenuOpen
      ? { sessions: tmuxSessions, current: pane.tmux, anchor: tmuxHover.anchor }
      : null,
  );

  $effect(() => {
    const v = tmuxCardView;
    const emit = ontmuxcard;
    if (v === null || !emit) return;
    emit(v);
    return () => emit(null);
  });

  // 칩이 사라지거나 세션이 바뀌면(재연결) 떠 있던 카드를 걷는다
  $effect(() => {
    void sessionId;
    void pane.tmux;
    return () => hideTmuxCard();
  });

  // ── 포워딩 칩 호버 카드 (2026-10-11) ─────────────────────────────────────────
  //
  // tmux 칩 카드(위)와 **같은 몸짓**이다: 시계 `TOOLTIP_DELAY_MS` · 포인터가 나가거나 누르면 · `Esc` · 휠·스크롤 · 창 크기 ·
  // 창 포커스를 잃으면 접는다. 목록 메뉴가 열려 있으면 띄우지 않는다(같은 내용이 이미 크게 떠 있다). 값은 칩과 같은
  // `forwards` 프롭(`app/forwards` 의 표 — 5초 주기로 연결 수를 다시 읽는다)이라 따로 묻지 않는다.
  let fwEl = $state<HTMLButtonElement | null>(null);
  const fwHover = createHoverArm({ target: () => fwEl });
  const armFwCard = fwHover.arm;
  const hideFwCard = fwHover.hide;

  const fwCardView = $derived<ForwardsCardView | null>(
    forwards.length > 0 && fwHover.anchor !== null && !forwardMenuOpen ? { forwards, anchor: fwHover.anchor } : null,
  );

  $effect(() => {
    const v = fwCardView;
    const emit = onforwardcard;
    if (v === null || !emit) return;
    emit(v);
    return () => emit(null);
  });

  // 세션이 바뀌면(재연결) 떠 있던 카드를 걷는다. 칩이 사라지면(포워드 0개) 카드도 `fwCardView` 가 `null` 이 되어 걷힌다
  $effect(() => {
    void sessionId;
    return () => hideFwCard();
  });

  // ── 폴더 칩 · 브랜치 칩 (2026-10-11, 목업 E2) ──────────────────────────────────
  //
  // **모든 터미널 타일**(로컬 셸 · 로컬 AI · SSH)에 같은 규칙이다. 규칙(글자 · 기준 폴더)은 `$lib/pane-chips`,
  // 브랜치 읽기(언제 · 묶기)는 `app/pane-git` — 여기는 기준을 정해 지켜보고 그리기만 한다.
  //
  // - 기준 폴더 = 셸이 알려 준 지금 폴더(OSC 7 · 9;9 — 로컬 WSL 은 이 PC 경로로) → 시작 폴더(`PaneSpec.cwd`) → 모름.
  //   tmux 타일은 모름(셸 통합이 없다) — 폴더 칩은 흐린 `folder` + 까닭 말풍선, 브랜치 칩은 없다.
  // - 폴더 칩을 누르면 예전 📂 머리 버튼과 **같은 몸통**(`onfiles` → `openFilesFor`)이다. 열리는 폴더는 그 몸통이 다시
  //   정한다(로컬은 OSC → OS 조회 `local_cwd`, tmux 는 `ssh_tmux_cwd`) — 칩의 글자와 별개로 예전 동작 그대로다.
  // - 브랜치 칩은 HEAD 를 알 때만 선다(저장소 아님 · 모름이면 없음). 누르면 그 타일이 선 프로젝트의 브랜치 타일.
  const terminal = $derived(pane.kind === "local" || pane.kind === "ssh");
  /** 원격 캐시 열쇠의 호스트 — 별칭(빠른 접속은 화면의 `user@host:port`), 로컬은 `null` */
  const gitHost = $derived(pane.kind === "ssh" ? pane.alias?.trim() || `#${pane.id}` : null);
  const folderName = $derived(folderNameOf(folder));
  const folderTip = $derived(
    folder !== null
      ? t("pane.header.folder.title", { path: folder })
      : t(folderUnknownTipKey({ tmux: pane.kind === "ssh" && !!pane.tmux })),
  );
  /** 칩 글자 — 이름, 모르면 흐린 `folder`(모든 언어에서 같은 낱말 · 이름처럼 접힌다) */
  const folderLabel = $derived(folderName !== "" ? folderName : t("pane.header.folder.unknown.chip"));

  // 지켜보기 — 폴더 · 세션(원격 재연결)이 바뀌면 새로 건다. 머리줄이 사라지면 그만 본다.
  $effect(() => {
    if (!terminal || folder === null) return;
    return watchPaneGit({
      paneId: pane.id,
      host: gitHost,
      path: folder,
      sessionId: pane.kind === "ssh" ? sessionId : null,
    });
  });

  const gitHead = $derived(terminal && folder !== null ? paneGitHead(gitHost, folder) : null);
  const branchText = $derived(branchChipText(gitHead));
  const branchTip = $derived(branchText !== null ? t("pane.header.branch.title", { branch: branchText }) : "");

  /** 칩에 손을 얹었다 — 그 폴더의 브랜치를 한 번 다시(같은 열쇠 짧은 간격은 `app/pane-git` 이 묶는다) */
  function onChipEnter(): void {
    refreshPaneGit(pane.id);
  }

  function openBranches(): void {
    openBranchGraphOfPane(pane.id, gitHead?.kind === "branch" ? gitHead.name : null);
  }

  // ── 자원 칩 (2026-10-17 — 로컬 자원 모니터) ──────────────────────────────────
  //
  // **로컬 타일만**(셸 아래 프로세스 트리는 이 PC 에 있다 — 원격 타일엔 없다). 세션이 서 있고 · 타일이 보이고 · 설정이 켜져
  // 있을 때만 표본을 당긴다(`watchResources` — 세션 서버의 관찰 임대). 값은 세션 서버가 2초마다 잰 그 타일 트리의 합(CPU 는
  // 기계 전체 대비 · 메모리는 전용 작업 집합 합). 말풍선은 상위 프로세스 이름 셋까지(실행 파일 이름 — 명령줄은 오지 않는다).
  // 누르면 자원 화면(앱 전체 · 지난 30분).
  const resStream = $derived(
    pane.kind === "local" && sessionId !== null && settings.resourceChip ? (pane.historyStreamId ?? null) : null,
  );
  $effect(() => {
    if (resStream === null || !shown) return;
    return watchResources();
  });
  const res = $derived(resStream !== null && !resourceOutdated() ? tileUsage(resourceRing(), resStream) : null);
  const resTip = $derived.by(() => {
    if (res === null || resStream === null) return "";
    const head = t("pane.header.resource.title", { cpu: formatCpu(res.cpu), mem: formatMem(res.mem) });
    const tops = (resourceTop().tiles[resStream] ?? []).map(topLine);
    return tops.length > 0 ? `${head}\n${tops.join("\n")}` : head;
  });

  // ── 접기 (2026-10-23 — 머리말 "접기 표") ───────────────────────────────────
  //
  // 묶음을 재서(`observeChipFit`) 칩마다의 꼴을 받는다. 판정이 바뀔 때만 값이 온다. 아직 못 잰 칩(막 선 칩)은 제 폭이다.
  let fit = $state<FitResult | null>(null);
  $effect(() => {
    const box = fitBox;
    if (!box) return;
    return observeChipFit(box, (r) => (fit = r));
  });

  /** 칩 id → 지금 꼴 */
  const fitModes = $derived.by(() => {
    const m = new Map<string, ChipFitMode>();
    fit?.ids.forEach((id, i) => m.set(id, fit!.modes[i]));
    return m;
  });
  /** 숨은 칩 — 사용자 순서대로 */
  const hiddenIds = $derived((fit?.hidden ?? []) as HeaderChipId[]);
  /** "+N" 이 설 자리 = 첫 숨은 칩의 앞(`overflowAnchor`) — 그 칩이 지금 순서에 없으면(막 빠짐) 끝의 쉬는 자리 */
  const moreAt = $derived.by(() => {
    if (fit === null) return null;
    const at = overflowAnchor(fit);
    return at !== null && (settings.headerChipsShown as readonly string[]).includes(at) ? at : null;
  });

  /** 칩 하나의 접기 표식 — `forms` = 꼴 수(1 = 접을 글자 없음 · 2 = 그림만까지 · 3 = 자원: 짧은 꼴 → 그림) */
  function fitAttrs(id: HeaderChipId, forms: number, pin = false): Record<string, string | undefined> {
    return {
      "data-fit-chip": id,
      "data-fit-forms": String(forms),
      "data-fit-pin": pin ? "" : undefined,
      "data-fit": fitModes.get(id) ?? "full",
    };
  }

  /** "+N" 메뉴의 줄 — 숨은 칩마다 제 폭 글자 · 그 칩의 일(여는 순간의 사본) */
  function moreItems(): ChipMoreItem[] {
    const out: ChipMoreItem[] = [];
    for (const id of hiddenIds) {
      if (id === "folder" && terminal) {
        out.push({ id, icon: "folder", label: folderLabel, title: folderTip, muted: folderName === "", action: "files" });
      } else if (id === "branch" && branchText !== null) {
        out.push({
          id,
          icon: "git-branch",
          label: branchText,
          action: "branch",
          branch: gitHead?.kind === "branch" ? gitHead.name : null,
        });
      } else if (id === "jump" && jump) {
        out.push({ id, icon: "route", label: t("pane.header.jump.chip", { jump }), action: null });
      } else if (id === "tmux" && pane.tmux) {
        out.push({ id, icon: "tmux", label: `tmux ${pane.tmux}`, action: "tmux" });
      } else if (id === "forward" && forwards.length > 0) {
        out.push({ id, icon: "forward", label: `${chipText.head}${forwards.length}${chipText.tail}`, action: "forward" });
      } else if (id === "resource" && res !== null) {
        out.push({ id, icon: "cpu", label: `${formatCpu(res.cpu)} · ${formatMem(res.mem)}`, action: "resource" });
      }
    }
    return out;
  }

  const moreLabel = $derived(
    hiddenIds.length === 0 ? "" : t("pane.header.more.aria", { n: hiddenIds.length, list: moreItems().map((i) => i.label).join(", ") }),
  );
</script>

<!--
  **칩은 저장된 순서대로 한 줄에 선다** (2026-10-18 — 설정 › 터미널 "타일 머리줄 칩", 목업 E5yfAAq5XawDLGCjhSAH4U). 예전에는 칩마다
  자리가 코드로 고정돼 있었다(AI 권한은 타일 코드 바로 뒤 · tmux → 경유 → 포워딩 → 폴더 → 브랜치 → 자원). 이제 순서와 켬끔은
  `settings.headerChipsShown`(`[app] header_chip_order` · `header_chips_hidden` — `$lib/header-chips`) 하나가 정하고, 끈 칩은 아예
  그리지 않는다(AI 권한 칩도 예외 없음 — 자동 승인 실행 경고색 · DB 연결 풀림도 함께 숨는다, 사용자 결정). 칩이 아닌 것(타일 코드 ·
  동시 입력 ✓ · 버튼)의 자리는 `PaneHeader` 그대로다. 아래 스니펫 하나가 칩 하나이고, 칩마다의 "왜" 는 스니펫 위 주석에 있다.
-->
{#each settings.headerChipsShown as id (id)}
  {#if id === moreAt}{@render moreChip(false)}{/if}
  {#if id === "ai"}{@render aiChip()}
  {:else if id === "tmux"}{@render tmuxChip()}
  {:else if id === "jump"}{@render jumpChip()}
  {:else if id === "forward"}{@render forwardChip()}
  {:else if id === "folder"}{@render folderChip()}
  {:else if id === "branch"}{@render branchChip()}
  {:else if id === "resource"}{@render resourceChip()}
  {/if}
{/each}
{#if moreAt === null}{@render moreChip(true)}{/if}

<!--
  "+N" 칩 (2026-10-23 — 접기 2차) — 넘쳐서 숨은 칩 수. **첫 숨은 칩의 자리**에 선다(`overflowAnchor`): 숨김은 끝에서부터라 그 뒤에는
  숨지 않는 AI 권한 칩만 남는다 — 기본 순서면 `[폴더] [브랜치] [+3] [AI]`, AI 권한은 제 자리(끝)를 지키고 "+N" 은 숨은 칩들이 서 있던
  바로 그 자리다. 숨은 칩이 없으면 끝에 쉬는 자리로 서서(`idle` — 보이지 않는다) 잴 때만 나타난다(제 폭을 재 둔다 — 숫자는 한 자리).
  누르면 숨은 칩 목록(`ChipMoreMenu` — `PaneHost` 가 상자 밖에), 말풍선 · `aria-label` 은 숨은 칩의 글자를 늘어놓는다.
  `data-chip-more` 는 메뉴의 "바깥 누름으로 닫기" 가 비켜 가는 표시이자 재기(`chip-fit-dom`)의 손잡이다.
-->
{#snippet moreChip(idle: boolean)}
  <button
    type="button"
    class="hchip more-chip"
    class:idle
    data-chip-more={pane.id}
    aria-haspopup="menu"
    aria-expanded={idle ? undefined : chipMoreOpen}
    title={idle ? undefined : moreLabel}
    aria-label={idle ? undefined : moreLabel}
    onclick={(ev) => onchipmore?.(ev, moreItems())}
    >+{idle ? 1 : hiddenIds.length}</button
  >
{/snippet}

<!--
  AI 권한 칩 — **종류로 갈린다** (2026-10-07). **끔이어도 선다**(10-23 사용자 결정 — 빈 게이지 + Off, 흐린 색 `--chip-ai-off`.
  보기 싫으면 설정 › 터미널 › 타일 머리줄 칩의 AI 권한을 끈다 — 원격 · 쿼리 · 로컬이 함께 숨는다):
  - 원격 — 호스트의 AI 권한 단계를 **미니 게이지(막대 넷) + 짧은 단계 이름**으로(10-23 — 막대가 지금 자리까지 차고 단계 색을 입는다:
    읽기 · 승인 후 · 자동 = 강조색 계열 · 모두 = 주황). **버튼이다** — 누르면 권한 팝오버(단계 게이지 · 헤드리스 접속)가 뜬다.
    호스트 목록에 없는 타일(빠른 접속 — 별칭 없음)은 팝오버가 열리지 않으므로 Off 칩이 **흐린 채**(`aria-disabled`) 서고 말풍선이
    이유를 말한다(⋯ 메뉴의 흐린 "AI 권한…" 과 같은 글 `app.ai.adhoc`).
  - 쿼리 타일 — DB 연결의 AI 권한(아래). 연결이 목록에 없으면 같은 흐린 Off 칩(⋯ 메뉴와 같은 글 `pane.menu.dbaiperm.missing`).
  - 로컬 타일(10-23 — 사용자 결정 A, 예전 따로 선 'AI 읽기' 칩 `ai_read`) — **같은 칩**: 막대 하나 + Read 또는 빈 게이지 + Off.
    누르면 같은 팝오버(Off · Read 만 — Ask 부터 잠김)가 뜬다.
    **예외 — 로컬 AI CLI 타일(Claude · Codex 가 도는 타일, 판정 `localAiTile`)에는 칩이 없다**(10-23 사용자 결정 — AI 타일에는 AI 읽기
    권한이 아예 없다: ⋯ 메뉴의 "AI 권한…" 줄도 없고 `paneAiReadable` 이 늘 `false`). 평범한 로컬 셸 · 원격 · 쿼리는 위 규칙대로 늘 선다.
-->
{#snippet aiChip()}
{#if aiStage !== null}
  {#if aiHostAlias(pane) === null}
    {@render aiChipDisabled(t("app.ai.adhoc"))}
  {:else}
    {@const hostAt = AI_STAGES.indexOf(aiStage)}
    <button
      type="button"
      class="hchip ai-chip"
      {...fitAttrs("ai", 2, true)}
      data-stage={aiStage}
      data-ai-tone={gaugeTone(hostAt)}
      data-ai-menu-btn
      aria-haspopup="menu"
      aria-expanded={aiMenuOpen}
      title={t("app.ai.stage.chip", { stage: t(AI_STAGE_NAME[aiStage]) })}
      aria-label={t("app.ai.stage.chip", { stage: t(AI_STAGE_NAME[aiStage]) })}
      onclick={(ev) => onaimenu?.(ev)}
    >
      <AiGaugeMini at={hostAt} />
      <span class="hchip-t" data-fold="1">{t(AI_STAGE_NAME[aiStage])}</span>
    </button>
  {/if}
{:else if dbAi !== null}
  <!--
    쿼리 타일의 DB AI 권한 칩 (10-14) — 원격 칩과 **같은 칩 · 같은 손잡이**(`data-ai-menu-btn` · 팝오버 `AiPermMenu`). 끔이면 빈 게이지 + Off.
    연결 대상이 바뀌어 권한이 풀렸으면 끔 그림 + 경고색으로 선다 — 다시 고르라는 말이다.
  -->
  {@const dbTip = dbAi.broken
    ? `${t("app.ai.stage.chip", { stage: t(DB_AI_NAME.off) })} · ${t("app.dbai.menu.broken")}`
    : t("app.ai.stage.chip", { stage: t(DB_AI_NAME[dbAi.level]) })}
  {@const dbAt = DB_AI_LEVELS.indexOf(dbAi.level)}
  <button
    type="button"
    class="hchip ai-chip"
    {...fitAttrs("ai", 2, true)}
    data-stage={dbAi.broken ? "broken" : dbAi.level}
    data-ai-tone={gaugeTone(dbAt)}
    data-ai-menu-btn
    data-db-ai-chip
    aria-haspopup="menu"
    aria-expanded={aiMenuOpen}
    title={dbTip}
    aria-label={dbTip}
    onclick={(ev) => onaimenu?.(ev)}
  >
    <AiGaugeMini at={dbAt} />
    <span class="hchip-t" data-fold="1">{t(DB_AI_NAME[dbAi.level])}</span>
  </button>
{:else if pane.kind === "query"}
  {@render aiChipDisabled(t("pane.menu.dbaiperm.missing"))}
{:else if pane.kind === "local" && !localAiTile(pane)}
  <!-- 로컬 타일의 AI 권한 칩(10-23) — 원격 칩과 같은 칩 · 같은 손잡이. 단계는 Off · Read 둘뿐이다 -->
  {@const localStage = shared ? "read" : "off"}
  {@const localAt = shared ? 1 : 0}
  {@const localTip = t("app.ai.stage.chip", { stage: t(AI_STAGE_NAME[localStage]) })}
  <button
    type="button"
    class="hchip ai-chip"
    {...fitAttrs("ai", 2, true)}
    data-stage={localStage}
    data-ai-tone={gaugeTone(localAt)}
    data-ai-menu-btn
    data-ai-read-chip={pane.id}
    aria-haspopup="menu"
    aria-expanded={aiMenuOpen}
    title={localTip}
    aria-label={localTip}
    onclick={(ev) => onaimenu?.(ev)}
  >
    <AiGaugeMini at={localAt} />
    <span class="hchip-t" data-fold="1">{t(AI_STAGE_NAME[localStage])}</span>
  </button>
{/if}
{/snippet}

<!--
  권한을 줄 수 없는 타일의 Off 칩(10-23) — 별칭 없는 원격 타일 · 목록에 없는 DB 연결. 팝오버가 열릴 데가 없어 누름은 아무 일도 하지 않고
  (`aria-disabled` — `disabled` 가 아닌 것은 말풍선이 떠야 해서다), 말풍선이 이유를 말한다. `data-ai-menu-btn` 은 달지 않는다.
-->
{#snippet aiChipDisabled(why: string)}
  <button
    type="button"
    class="hchip ai-chip off-locked"
    {...fitAttrs("ai", 2, true)}
    data-stage="off"
    data-ai-tone="0"
    data-ai-chip-disabled
    aria-disabled="true"
    title={why}
    aria-label={`${t("app.ai.stage.chip", { stage: t(AI_STAGE_NAME.off) })} · ${why}`}
  >
    <AiGaugeMini at={0} />
    <span class="hchip-t" data-fold="1">{t(AI_STAGE_NAME.off)}</span>
  </button>
{/snippet}

<!--
  tmux 칩 — "이 타일은 화면만 있는 세션이다"(간이 모드)를 말하는 유일한 상시 표시이고,
  **세션 목록의 주 입구**다 (docs/log/2026-09-16-tmux-toggle.md). 모양은 머리줄 칩
  한 벌(`.hchip` — 2026-10-11 부터 종류별 고유 색 `--chip-tmux`, 예전엔 색 없는 회색 각인)이다.

  **정체성 묶음 안**에 선다 (2026-10-05 사용자 — 자리는 2026-10-18 부터 저장 순서) — 예전에는 묶음 뒤(오른쪽 버튼 줄 앞)라,
  포커스가 빠져 버튼 줄이 숨으면 판 깐 칩만 빈칸 끝에 혼자 떠 보였다. 이제 이름과 한 덩어리로 읽힌다. 안에 드는 것은 흐린 `tmux` + **붙어 있는 세션 이름**(어느 세션인지가
  칩만 보고 보인다) — 개수는 넣지 않는다(사용자 결정: 이름 옆 숫자는 뜻이 애매하다, 개수·상태는 호버 카드).
  (예전엔 비포커스 타일에서 판을 걷었다 — 2026-10-11 부터 칩은 늘 판을 깐다.)

  **버튼이다** — 목록은 이 칩 말고 다른 손잡이가 ⋯ 메뉴의 "tmux 세션…" 하나뿐이다(사용자 확인,
  2026-09-16). 그 항목은 남는다: `[app] tile_header` 로 머리줄을 끈 사람에게는 그쪽이 유일한 길이다.
  호버하면 시스템 `title` 대신 세션 카드가 뜬다(위 "tmux 칩 호버 카드").
-->
{#snippet tmuxChip()}
{#if pane.tmux}
  <button
    type="button"
    class="hchip tmux-chip"
    {...fitAttrs("tmux", 2)}
    data-tmux-menu-btn
    aria-haspopup="menu"
    aria-expanded={tmuxMenuOpen}
    aria-label={t("pane.header.tmux.aria", { name: pane.tmux })}
    bind:this={tmuxEl}
    onpointerenter={armTmuxCard}
    onpointerleave={hideTmuxCard}
    onclick={(ev) => {
      hideTmuxCard();
      ontmuxmenu(ev);
    }}
    ><UiIcon name="tmux" size={ICON_SIZE - 2} /><span class="tmux-k" data-fold="1">tmux</span><span
      class="tmux-n" data-fold="1">{pane.tmux}</span></button
  >
{/if}
{/snippet}

<!--
  경유 칩 — 이 세션은 **혼자 가지 않았다**(`ProxyJump`). 호스트 목록의 `route` 표식과
  **같은 그림**이고, 거기서 "고르기 전에 알아야 하는 성질" 이던 것이 여기서는 "지금 이
  연결의 모양" 이 된다: 느리거나 갑자기 끊겼을 때 사람이 가장 먼저 의심해야 하는 칸이
  경유 단계인데, 그 사실은 호스트 폼을 열기 전에는 아무 데도 적혀 있지 않았다.

  **버튼이 아니다.** tmux 칩은 목록이라는 갈 곳이 있어 버튼이지만, 경유는 상태 하나뿐이라
  누를 데가 없다 — 아무 일도 안 하는 버튼을 두면 머리줄에서 "누를 수 있는 것" 의 뜻이
  흐려진다 (표식 둘 ✓·✦ 와 같은 판단).

  **색은 쓰지 않는다** (`.tmux-chip` 과 같은 흐린 톤). 포워딩 칩만 강조색인 이유는 그것이
  "지금 로컬 포트가 물려 있다" 는 켜진 상태이기 때문이고, 경유는 켜고 끄는 것이 아니라
  이 호스트의 생김새다. 기본 자리도 그 사이다 — tmux(어떻게 붙었나) → 경유(어디를 거쳤나) →
  포워딩(무엇이 켜져 있나). 사용자가 설정에서 옮길 수 있다.

  `data-jump-chip` 은 헤드리스 검증 스크립트가 잡는 손잡이다 (`data-forward-chip` 과 같은
  규칙 — 글자가 바뀌어도 안 깨지게 둔 자리라 **이름을 바꾸지 않는다**).
-->
{#snippet jumpChip()}
{#if jump}
  <span class="hchip jump-chip" {...fitAttrs("jump", 2)} data-jump-chip={pane.id} title={t("pane.header.jump.title", { jump })}>
    <UiIcon name="route" size={ICON_SIZE - 2} />
    <span class="hchip-t" data-fold="1">{t("pane.header.jump.chip", { jump })}</span>
  </span>
{/if}
{/snippet}

<!--
  포워딩 칩 — **지금 이 타일 위로 터널이 서 있다**는 상시 표시이자 목록의 지름길
  (docs/log/2026-09-17-forward-presets.md). 호스트 프리셋으로 자동으로 열린 것은 성공해도
  토스트를 띄우지 않으므로, 열렸다는 사실을 말하는 자리가 여기 하나다.

  **몸은 tmux 칩과 같고 색은 다르다.** 처음에는 `.tmux-chip` 을 그대로 입고 `⇄ 1` 만
  띄웠는데, 타일 코드 옆에 붙은 10px dim 두 글자는 **아무도 못 본다**(사용자 확인,
  2026-09-17). tmux 칩은 "왜 명령 이력이 없는지" 를 설명하는 칸이라 조용해도 되지만,
  이쪽은 **지금 켜져 있는 상태**다 — 로컬 포트가 물려 있고 그 사실을 잊으면 다른 앱이
  그 포트를 못 쓴다. 그래서 회색 판을 깐 칩에 말(`포워딩 1`)까지 적는다(2026-09-25 작업면
  단계까지는 강조색 알약이었다 — 강조색은 이제 입력 대기·주 동작·선택 행에만 쓴다). 옆의 ✓·✦ 와 자리를 다투지 않는다: 저쪽은 그림 하나뿐인 표식이고 이쪽은
  이름 바로 뒤에 서는 알약이라 읽는 순서가 다르다.

  **점은 트래픽이 흐를 때만** 뜬다 (`--ok` = 테마의 "정상 동작 중"). 리스너가 서 있는
  것과 그 위로 실제 연결이 오가는 것은 다른 일이고, 사용자가 "연결이 된 건지 모르겠다"
  고 말한 자리가 정확히 그 차이였다. 숫자는 툴팁 마지막 줄이 말한다 — 좁은 머리줄에
  숫자를 둘 띄우면 어느 쪽이 터널 수인지 흐려진다.

  `data-forward-chip` 은 헤드리스 검증 스크립트가 잡는 손잡이다(개수는 `.n` 에서 읽는다)
  — 글자가 `1` 에서 `포워딩 1` 로 바뀌어도 그 스크립트가 깨지지 않게 둔 자리라 **이름을
  바꾸지 않는다**. 목록 메뉴의 "바깥 누름으로 닫기" 가 비켜 가는 표시도 이것이다.

  **tmux 칩과 같은 몸짓이다** (2026-10-11): 호버하면 시스템 `title` 대신 카드(`ForwardsCard` — 터널마다 한 줄 ·
  종류 · 상태)가 뜨고, 누르면 칩 아래에 목록 메뉴(`ForwardMenu` — 줄마다 [브라우저에서 열기] · [중지], 맨 아래
  "포워딩 추가…" → 추가 모달)가 뜬다. 예전에는 누르면 목록 + 추가 폼 대화상자가 떴다 — 그 대화상자는 이제 추가 전용이다.
-->
{#snippet forwardChip()}
{#if forwards.length > 0}
  <button
    type="button"
    class="hchip fw-chip"
    {...fitAttrs("forward", 2)}
    class:live={relaying > 0}
    data-forward-chip={pane.id}
    aria-haspopup="menu"
    aria-expanded={forwardMenuOpen}
    aria-label={t("pane.header.forward.aria")}
    bind:this={fwEl}
    onpointerenter={armFwCard}
    onpointerleave={hideFwCard}
    onclick={(ev) => {
      hideFwCard();
      onforwardmenu(ev);
    }}
  >
    <UiIcon name="forward" size={ICON_SIZE - 2} />
    <span class="label" data-fold="1">{chipText.head}<span class="n">{forwards.length}</span>{chipText.tail}</span>
    {#if relaying > 0}
      <span class="dot" aria-hidden="true"></span>
    {/if}
  </button>
{/if}
{/snippet}

<!--
  폴더 칩 · 브랜치 칩 (2026-10-11, 목업 E2) — 정체성 묶음 안(기본 순서 맨 앞 둘). 이름이 먼저 줄고(묶음의 grid), 머리줄이
  넘치면 칩이 이름(최소 폭)보다 먼저 접힌다(머리말 "접기 표" — 끝 칩부터 그림만 → 숨김 + "+N").
  폴더 칩은 예전 📂 머리 버튼의 자리이자 일이다(같은 `onfiles`). 말풍선은 이름만(동작 · 대상 —
  docs/log/2026-09-28-tile-header-tooltips.md 의 "표식·칩 말풍선은 이름만"), `aria-label` 이 같은 글자다.
  `data-folder-chip` · `data-branch-chip` 은 하네스가 잡는 손잡이다.
-->
{#snippet folderChip()}
  {#if terminal}
  <button
    type="button"
    class="hchip folder-chip"
    {...fitAttrs("folder", 2)}
    data-folder-chip={pane.id}
    title={folderTip}
    aria-label={folderTip}
    onpointerenter={onChipEnter}
    onclick={onfiles}
  >
    <UiIcon name="folder" size={ICON_SIZE - 2} />
    <span class="hchip-t" class:muted={folderName === ""} data-fold="1">{folderLabel}</span>
  </button>
  {/if}
{/snippet}

{#snippet branchChip()}
  {#if terminal && branchText !== null}
  <button
    type="button"
    class="hchip branch-chip"
    {...fitAttrs("branch", 2)}
    class:detached={gitHead?.kind === "detached"}
    data-branch-chip={pane.id}
    title={branchTip}
    aria-label={branchTip}
    onpointerenter={onChipEnter}
    onclick={openBranches}
  >
    <UiIcon name="git-branch" size={ICON_SIZE - 2} />
    <span class="hchip-t" data-fold="1">{branchText}</span>
  </button>
  {/if}
{/snippet}

<!--
  자원 칩 (2026-10-17) — 로컬 타일의 `CPU 34% · 1.2GB`(셸과 그 아래 프로세스의 합). 표본이 아직 없으면(처음 2~4초) 서지 않는다.
  누르면 자원 화면(상태바 자원 고리와 같은 판 — 2026-10-17). 말풍선은 합 한 줄 + 상위 프로세스 셋까지. `data-resource-chip` 은 하네스 손잡이.
-->
{#snippet resourceChip()}
{#if res !== null}
  <button
    type="button"
    class="hchip res-chip"
    {...fitAttrs("resource", 3)}
    data-resource-chip={pane.id}
    title={resTip}
    aria-label={resTip}
    onclick={() => openResourceView()}
  >
    <UiIcon name="cpu" size={ICON_SIZE - 2} />
    <span class="hchip-t" data-fold="2">{formatCpu(res.cpu)}<span class="res-mem" data-fold="1"> · {formatMem(res.mem)}</span></span>
  </button>
{/if}
{/snippet}

<style>
  /* 칩 한 벌(`.hchip` · `.hchip-t` — 판 · 호버 · 포커스)은 전역 `./header-chip.css`(설정 화면의 칩 줄과 공용). 여기는 칩마다의 색 · 접기 */

  /*
    tmux 칩 — "이 타일은 화면만 있는 세션이다"(간이 모드)의 상시 표시이자 세션 목록의 주 입구. 세션 이름은 16자에서 말줄임.
    글꼴은 칩 한 벌(`.hchip` — UI 글꼴 12px)이다: 식별자라 mono 11px 였지만 칩이 나란히 서면 한 줄에 글꼴이 둘로
    보였다(2026-10-11 사용자 지적). 브랜치 칩도 같은 이유로 mono 를 걷었다.
  */
  .tmux-chip {
    --c: var(--chip-tmux);
    gap: 5px;
  }

  .tmux-k {
    flex: none;
  }

  .tmux-n {
    flex: none;
    max-width: 16ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 폴더 칩 — 마지막 폴더 이름(말이라 머리줄 글꼴). 모르면 흐린 `folder`(`.muted` — 머리줄의 흐린 글자) */
  .folder-chip {
    --c: var(--chip-folder);
  }

  .folder-chip .hchip-t {
    max-width: 18ch;
  }

  .folder-chip .hchip-t.muted {
    color: var(--head-dim);
  }

  /* 브랜치 칩 — detached 면 짧은 해시. 글꼴은 칩 한 벌(위 tmux 칩 주석) */
  .branch-chip {
    --c: var(--chip-branch);
  }

  .branch-chip .hchip-t {
    max-width: 24ch;
  }

  /*
    **접기 — 꼴마다의 모양은 여기 한 곳** (2026-10-23 — 머리말 "접기 표"). 칩의 꼴은 `data-fit`(판정 — `chip-fit.ts`)이 정하고, 재는
    동안(`chip-fit-dom.ts` 가 묶음에 `data-chip-measure` 를 잠깐 단다)에는 **모든 칩이 그 꼴**로 선다(숨은 칩 · 쉬는 "+N" 도 — 폭을 재야 한다).
    접히는 글자는 `data-fold`: 1 = 짧은 꼴부터 걷힘(그림만 · 자원은 메모리) · 2 = 그림 꼴부터 걷힘(자원의 CPU). 글자를 다 걷은 칩은 그림
    상자 폭(안쪽 여백 5px)이다. 예전 고정 문턱(머리줄 폭 컨테이너 질의 400 · 360 · 320 · 240)은 걷었다.
  */
  /*
    칩은 묶음(grid)에서 **제 꼴의 폭 아래로 줄지 않는다** — 칩 한 벌의 `min-width: 0` 이면 grid 의 auto 칸이 칩까지 이름과 똑같이 나눠
    줄여, 들어간다고 판정한 줄에서도 긴 칩(브랜치)이 잘려 글자가 옆 칩에 겹쳤다(10-23 하네스). 줄어드는 것은 이름 칸 하나다.
  */
  .hchip {
    min-width: max-content;
  }

  :global([data-chip-fit]:not([data-chip-measure])) > .hchip[data-fit="hidden"],
  :global([data-chip-fit]:not([data-chip-measure])) > .more-chip.idle {
    display: none;
  }

  :global([data-chip-fit]:not([data-chip-measure])) > [data-fit="compact"] [data-fold="1"],
  :global([data-chip-fit]:not([data-chip-measure])) > [data-fit="icon"] [data-fold],
  :global([data-chip-fit][data-chip-measure="compact"]) > [data-fit-chip] [data-fold="1"],
  :global([data-chip-fit][data-chip-measure="icon"]) > [data-fit-chip] [data-fold] {
    display: none;
  }

  :global([data-chip-fit]:not([data-chip-measure])) > .hchip[data-fit="compact"]:not([data-fit-forms="3"]),
  :global([data-chip-fit]:not([data-chip-measure])) > .hchip[data-fit="icon"],
  :global([data-chip-fit][data-chip-measure="compact"]) > .hchip[data-fit-chip]:not([data-fit-forms="3"]),
  :global([data-chip-fit][data-chip-measure="icon"]) > .hchip[data-fit-chip] {
    padding: 0 5px;
  }

  /*
    "+N" 칩 — 숨은 칩 수. 중성 색(머리줄 글자색 — 터미널 머리줄이면 `--head-fg`, 그 밖은 보조 글자), 숫자는 고정폭이라 수가 바뀌어도
    폭이 같다(잰 폭을 그대로 쓴다).
  */
  .more-chip {
    --c: var(--head-fg, var(--fg-2));
    padding: 0 7px;
    font-variant-numeric: tabular-nums;
  }

  /*
    경유 칩 — **톤은 `.tmux-chip`, 몸은 표식**이다 (버튼이 아니라 `<span>` 이라 호버·포커스·
    테두리가 통째로 없고 커서도 글자 그대로다). 흐린 톤을 저쪽에서 그대로 가져오는 이유는
    둘이 같은 말을 하기 때문이다 — 사고가 아니라 **이 세션이 어떻게 붙었는지**를 설명하는 칸.

    글꼴만 갈린다: `.tmux-chip` 안에 드는 것은 `tmux` 라는 식별자 하나뿐이라 mono 로 둘 수
    있었지만, 여기 드는 것은 **말**(`경유`)이라 mono 로 찍으면 한글 자간이 벌어진다
    (`.fw-chip` 이 같은 자리에서 배운 것). 그래서 머리줄과 같은 `--font-ui` 다.

    좁은 타일에서는 이웃 칩들과 같은 규칙이다(머리말 "접기 표" — 순서대로 그림만 → 숨김 + "+N" 메뉴의 보기만 하는 줄).
    경유지 이름은 18자에서 말줄임(전체는 말풍선).
  */
  /* 2026-10-11 — 칩 한 벌(`.hchip`)에 고유 색 `--chip-jump`. 버튼이 아닌 표식이라 호버 판·선이 없다 */
  .jump-chip {
    --c: var(--chip-jump);
    cursor: default;
  }

  .jump-chip .hchip-t {
    max-width: 18ch;
  }

  .jump-chip:hover {
    background: color-mix(in srgb, var(--c) var(--chip-tint), transparent);
    box-shadow: none;
  }

  /*
    포워딩 칩 — **켜져 있는 상태를 말하는 칩**이라 `.tmux-chip` 과 달리 **판을 깐다**
    (마크업 쪽 주석의 근거: dim 한 `⇄ 1` 은 아무도 못 봤다). 예전에는 강조색 테두리·글자·틴트의
    알약이었는데, 작업면 단계에서 **중성**(보조 글자 · 회색 판 · 작은 모서리)으로 옮겼다 —
    강조색은 "골라진 것 / 입력 대기" 의 색이고 포워딩은 그 어느 쪽도 아니다. 판 + 말(`포워딩 1`)
    + 트래픽 점(초록)만으로 dim 글자와는 충분히 갈린다 — 누를 수는 있지만 첫째 일은 표시다.

    글꼴은 머리줄과 같은 `--font-ui` 다 (`.tmux-chip` 의 mono 가 아니다): 안에 드는 것이
    `tmux` 라는 식별자가 아니라 **말**(`포워딩`)이라 mono 로 찍으면 한글 자간이 벌어진다.
    숫자만 mono·tabular 로 되돌려 1 ↔ 2 가 바뀔 때 칩 폭이 덜 흔들리게 한다.

    좁은 타일에서 짧은 꼴은 글자(`포워딩 n`)를 접고 그림 + 트래픽 점만 남긴다(머리말 "접기 표"). 더 모자라면 순서대로
    숨고 "+N" 메뉴의 줄이 된다(누르면 같은 목록 메뉴). 개수 · 줄은 호버 카드가 쥔다.
  */
  /* 2026-10-11 — 칩 한 벌(`.hchip` — 판·호버·포커스)에 고유 색 `--chip-forward`. 중성 회색 판이던 것을 다른 칩과 맞췄다 */
  .fw-chip {
    --c: var(--chip-forward);
  }

  /*
    `.label` 은 **평범한 inline** 이어야 한다 — flex 로 만들면 사전이 넣어 둔 낱말과 숫자
    사이의 공백(`포워딩 {n}` 의 그 한 칸)이 "공백뿐인 텍스트 노드" 라 flex 항목에서 통째로
    버려지고 화면에 `포워딩1` 로 붙는다 (2026-09-17 캡처에서 실제로 났다).
  */
  /* 숫자는 UI 글꼴의 고정폭 숫자 — 머리줄 칩들과 한 글꼴(2026-10-11, tmux 칩 주석) */
  .fw-chip .n {
    font-variant-numeric: tabular-nums;
  }

  /*
    트래픽 점 — 테마의 `--ok`(세이지 그린)다. 그 토큰의 주석이 이미 "트래픽이 흐르는
    포워드의 점" 이라고 적고 있고, 모달 목록의 점과 **같은 색**이라야 두 화면이 한 말을 한다.
    회색 판 위에 초록이 하나 뜨는 대비라 작아도(5px) 눈에 걸린다.

    맥박은 **불투명도와 크기만** 건드린다 — 자리(레이아웃)를 흔들면 옆 버튼들이 매 프레임
    움직인다. 주기 1.8초는 "살아 있다" 로 읽히되 깜빡임으로는 읽히지 않는 선이다.
  */
  .fw-chip .dot {
    flex: 0 0 auto;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--ok);
    box-shadow: 0 0 4px color-mix(in srgb, var(--ok) 70%, transparent);
    animation: fw-pulse 1.8s ease-in-out infinite;
  }

  @keyframes fw-pulse {
    0%,
    100% {
      opacity: 1;
      transform: scale(1);
    }
    50% {
      opacity: 0.35;
      transform: scale(0.72);
    }
  }

  /*
    움직임을 줄여 달라고 했으면 점은 **그대로 선다** — 켜짐/꺼짐의 뜻은 점의 존재 자체가
    이미 말하고 있으므로 맥박만 없앤다.
  */
  @media (prefers-reduced-motion: reduce) {
    .fw-chip .dot {
      animation: none;
    }
  }

  /*
    AI 권한 칩 (2026-10-07 · 모양은 2026-10-11 칩 한 벌 `.hchip` · 2026-10-23 게이지) — **미니 게이지(막대 넷) + 짧은 단계 이름**
    (끔 · 읽기 · 승인 후 · 자동 · 모두). 막대는 팝오버 게이지와 같은 규칙으로 지금 자리까지 차고 단계 색을 입는다(`AiGaugeMini`).
    칩 글자 · 판의 색은 게이지 자리(`data-ai-tone`)로 고른다 — 원격과 DB 가 같은 자리면 같은 색이다: 자리 1(읽기 전용 · 구조만) = 중성 ·
    2 = 강조색 · 3(자동 승인 실행 · DB 승인 후 실행) = 밝은 강조색 · 4(모두 승인) = 주황. DB 연결이 풀렸으면(대상이 바뀜) 경고색.
    끔(자리 0 — 10-23 부터 칩이 선다)은 흐린 색 `--chip-ai-off`(`--ai-lv0` · 터미널 머리줄은 머리줄의 흐린 글자 `--head-dim`).
    글자라 4.5:1 이 하한 — 색은 `theme.css` 의 `--chip-ai-*`(대비 수치도 거기).
  */
  .ai-chip {
    --c: var(--chip-ai-read);
    gap: 5px;
  }

  .ai-chip[data-ai-tone="0"] {
    --c: var(--chip-ai-off);
  }

  /* 권한을 줄 수 없는 타일의 Off 칩 — 누를 데가 없어 호버 판 · 손가락 커서가 없다(말풍선은 뜬다) */
  .ai-chip.off-locked {
    cursor: default;
    opacity: 0.75;
  }

  .ai-chip.off-locked:hover {
    background: color-mix(in srgb, var(--c) var(--chip-tint), transparent);
  }

  .ai-chip[data-ai-tone="2"] {
    --c: var(--chip-ai-approve);
  }

  .ai-chip[data-ai-tone="3"] {
    --c: var(--chip-ai-auto);
  }

  .ai-chip[data-ai-tone="4"] {
    --c: var(--chip-ai-all);
  }

  .ai-chip[data-stage="broken"] {
    --c: var(--chip-ai-broken);
  }

  /* 자원 칩 — 읽기 전용 수치라 중성(`--chip-resource`). 숫자는 고정폭이라 2초마다 바뀌어도 칩 폭이 덜 흔들린다 */
  .res-chip {
    --c: var(--chip-resource);
    font-variant-numeric: tabular-nums;
  }
</style>
