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
   * 타일 머리줄 — 붙을지는 `PaneHost` 가 정한다(`[app] tile_header`) (docs/log/2026-09-02-pane-identity.md).
   * - 동시 입력 표식(✓)은 버튼이 아니라 표시다 — 켠 줄 모르면 입력이 형제 서버로 함께 나가므로 메뉴 안에 숨기지 않는다.
   * - `dragstart` · `contextmenu` 는 여기서 달지 않는다 — `PaneHost` 가 캔버스 한 곳에서 위임으로 받는다(직접 달면 a11y 경고 · 판정이 두 벌).
   */
  let {
    pane,
    host = null,
    /** 포커스됐거나 타일이 하나뿐이면 참 — 하나뿐인 타일이 흐리면 없는 "다른 활성 타일" 을 암시한다 */
    active = false,
    included = false,
    shared = false,
    aiStage = null,
    dbAi = null,
    aiMenuOpen = false,
    zoomed = false,
    zoomCombo,
    flip = null,
    flipCombo = "",
    onflip,
    menuOpen = false,
    tmuxMenuOpen = false,
    forwardMenuOpen = false,
    chipMoreOpen = false,
    forwards = [],
    sessionId = null,
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
    /** 카드는 타일 상자 밖에서 `PaneHost` 가 그린다 — 상자마다 `isolation: isolate` 라 안에서 그리면 이웃 타일에 덮인다 */
    oninfocard?: (view: SessionCardView | null) => void;
    ontmuxcard?: (view: TmuxCardView | null) => void;
    onforwardcard?: (view: ForwardsCardView | null) => void;
    onmenu: (ev: MouseEvent) => void;
    ontmuxmenu: (ev: MouseEvent) => void;
    onaimenu?: (ev: MouseEvent) => void;
    onforwardmenu: (ev: MouseEvent) => void;
    onchipmore?: (ev: MouseEvent, items: ChipMoreItem[]) => void;
    onfiles: () => void;
    onzoom: () => void;
    onclose: () => void;
  } = $props();

  /** 버튼 넷 + 표식 · 칩이 한 값을 나눠 쓴다 — 칸마다 적으면 하나가 뒤처져 그것만 커진다 */
  const ICON_SIZE = HEAD_ICON_SIZE;

  const color = $derived(host ? (hostMeta(host).color ?? null) : null);

  const code = $derived(tileCode(currentWindowLabel(), pane.id));
  const tools = $derived(paneToolsOf(pane.id));
  const span = $derived(tools?.span?.() ?? null);
  const iconBusy = $derived(tools?.iconBusy?.() ?? null);
  // 타일은 이 표를 보고 제 도구줄을 몸 맨 위에 그릴지 정한다
  $effect(() => markPaneHead(pane.id));

  const shownName = $derived.by(() => {
    const tab = pane.kind === "run" ? tabOfPane(pane.id) : null;
    const path = tab?.orch ? orchScreenPath(tab) : null;
    if (path?.view === "library") return t("orch.home.library");
    if (path?.view === "studio") return studioLabel(path.repo ?? "");
    if (path?.view === "artists") return t("orch.nav.artists");
    if (path?.view === "new") return t("orch.library.newAlbum");
    return displayName(pane);
  });

  const head = $derived.by(() => {
    const label = host ? hostLabel(host) : "";
    return label ? t("pane.header.title.host", { name: shownName, host: label }) : shownName;
  });

  const docPreview = $derived(pane.kind === "doc" && pane.docPreview === true);

  const unsaved = $derived(pane.kind === "doc" && dirtyDocPanes().includes(pane.id));

  // ── 연결 상태 말풍선 (docs/log/2026-09-17-connect-diagnostics.md) ───────────
  // 툴팁 층은 `pointerover` 를 document 캡처에서 받아 그 순간의 글자를 띄우므로 호버에서 가져오면 한 박자 늦다 —
  // 값은 세션이 붙을 때 받아 두고 호버는 다음 번을 위한 갱신이다. 타이머는 두지 않는다(타일마다 왕복이 생긴다).
  let info = $state<SessionInfo | null>(null);
  let infoAt = 0;
  /** 늦게 온 답이 새 세션의 값을 덮지 않게 */
  let infoFor: number | null = null;

  const INFO_STALE_MS = 30_000;

  async function loadInfo(id: number): Promise<void> {
    infoFor = id;
    infoAt = Date.now();
    try {
      const next = await fetchSessionInfo(id);
      if (infoFor === id) info = next;
    } catch {
      // 못 받으면 말풍선이 예전 값으로 남는다
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

  function refreshInfoSoon(): void {
    const id = sessionId;
    if (pane.kind !== "ssh" || id === null) return;
    if (Date.now() - infoAt < INFO_STALE_MS) return;
    void loadInfo(id);
  }

  /** `pointerover` 는 마크업이 아니라 코드에서 건다 — 상호작용이 아닌 캐시 갱신이라 역할을 지어 붙이지 않는다(a11y) */
  let headEl = $state<HTMLDivElement | null>(null);
  /** 카드 뒤집기(`pane/flip-motion.ts`)가 면이 바뀌는 프레임까지 옛 면 색(`--flip-ink`)을 붙잡는다 */
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

  const nameTitle = $derived(
    info === null ? null : [head, ...sessionInfoLines(info, t, Date.now())].join("\n"),
  );

  // ── 이름 카드 (docs/log/2026-09-28-tile-header-tooltips.md "SSH 이름 카드") ─────────────
  // 카드가 서는 타일의 이름 칸에는 `title` 이 없다 — 공용 말풍선은 `[title]` 만 집으므로 둘이 겹쳐 뜨지 않는다.
  let cardNow = $state(0);
  const nameHover = createHoverArm({
    target: () => nameEl,
    before: () => {
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

  $effect(() => {
    const v = cardView;
    const emit = oninfocard;
    if (v === null || !emit) return;
    emit(v);
    return () => emit(null);
  });

  $effect(() => {
    void sessionId;
    void pane.kind;
    return () => hideCard();
  });

  // ── 이름 말줄임 말풍선 ─────────────────────────────────────────
  // `title` 은 미리 붙어 있어야 해서(툴팁 층이 캡처로 읽는다) 잘림은 호버가 아니라 `ResizeObserver` 로 잰다.
  // 폭은 같은데 글자 폭만 바뀐 틈은 머리줄 `pointerover` 에서 한 번 더 잰다.
  let nameEl = $state<HTMLSpanElement | null>(null);
  /** 칩 접기가 재는 상자(`HeaderChips` 의 `fitBox` · `pane/chip-fit-dom.ts`) */
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
    // 카드의 포인터 리스너도 코드에서 건다 — 위 `headEl` 과 같은 이유(a11y)
    el.addEventListener("pointerenter", armCard, { passive: true });
    el.addEventListener("pointerleave", hideCard, { passive: true });
    return () => {
      ro.disconnect();
      el.removeEventListener("pointerenter", armCard);
      el.removeEventListener("pointerleave", hideCard);
    };
  });

  /** 카드가 없는 타일에서 타일 코드를 확인하는 길이 이 말풍선이다 — 잘리지 않아도 늘 단다 */
  const baseNameTip = $derived(pane.kind === "local" || pane.kind === "query" || nameTitle !== null ? null : `${shownName} · ${code}`);
  const nameTip = $derived.by(() => {
    const extra = tools?.nameTip?.() ?? null;
    if (extra === null) return baseNameTip;
    return baseNameTip === null ? `${shownName}\n${extra}` : `${baseNameTip}\n${extra}`;
  });
  const infoDescId = $derived(`session-info-${pane.id}`);

  // ── 기준 폴더 ──────
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

  /** 값은 연결 목록 사본 · 타일의 지금(`app/query-live`) · AI 권한 사본뿐이다 — 비밀번호 없음 · 새 서버 op 없음 */
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
  class:keep-tools={tools?.keepBar === true}
  bind:this={headEl}
  data-pane-head={pane.id}
  draggable="true"
>
  <div
    class="pane-group"
    class:spanned={span !== null}
    style:width={span === null ? null : `calc(${span}px - var(--space-3) - var(--space-2))`}
  >
  {#if tools?.lead}
    <span class="pane-lead">{@render tools.lead()}</span>
  {/if}
  {#if color}
    <span class="swatch" style:background={color} aria-hidden="true"></span>
  {/if}
  {#if iconBusy !== null}
    <span class="icon-busy" role="status" title={iconBusy} aria-label={iconBusy} style:width="{ICON_SIZE}px" style:height="{ICON_SIZE}px"
      ><span class="ring" aria-hidden="true"></span></span
    >
  {:else if tools?.hideIcon !== true}
    <PaneIcon {pane} size={ICON_SIZE} />
  {/if}

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
      <span class="unsaved" title={t("pane.header.doc.unsaved")} aria-label={t("pane.header.doc.unsaved")}>●</span>
    {/if}

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
    <!-- 감싸개 없이 무리의 직계 칸으로 둔다 — "드러냄" 셀렉터가 `.pane-group >` 다 -->
    {@render tools.tail()}
  {/if}
  </div>
  {#if tools}
    <div class="pane-tools" data-pane-tools={pane.id}>{@render tools.bar(true)}</div>
  {/if}
  {#if infoDesc !== null}
    <span class="sr-info" id={infoDescId}>{infoDesc}</span>
  {/if}


  {#if included}
    <span class="syncmark" title={t("pane.header.sync.title")}>
      <UiIcon name="check" size={ICON_SIZE} />
    </span>
  {/if}

  {#if flip !== null}
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

  <!-- `data-tile-menu-btn` — "바깥 클릭으로 닫기" 가 이 버튼만 비켜 가야 다시 눌러 닫는 토글이 선다 -->
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
  /* 높이를 flex 로 나누지 않고 절대배치로 못 박는다 — 머리줄이 생기고 사라져도 본문 DOM 이 그대로라 터미널이 재마운트되지 않는다 */
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
    /* `PaneHost` 가 본문을 같은 값만큼 내린다 */
    height: var(--tile-head-h);
    padding: 0 var(--space-1) 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    line-height: 1;
    color: var(--fg-2);
    background: var(--tile-inner, var(--bg-panel));
    cursor: grab;
    user-select: none;
    /* 불투명도만 애니메이션한다 — 자리(`top`)를 움직이면 xterm 이 매 프레임 refit 하고 원격에 resize 를 쏟아붓는다 */
    animation: head-in 120ms ease-out;
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

  @media (prefers-reduced-motion: reduce) {
    .pane-head {
      animation: none;
    }
  }

  /* 면 · 강조색은 바꾸지 않는다 — 포커스는 타일 테두리가 말한다 */
  .pane-head.active {
    color: var(--fg-1);
  }

  /*
   * 터미널 · AI 타일 — 머리줄을 칠하지 않아 타일 판(`--term-bg-fill`)이 비친다. AI 권한 승인 · 자동 · 모두 색은 단계 신호라
   * 터미널 글자색으로 바꾸지 않고 터미널 바탕 기준(`theme.css` 의 `--ai-term-lv*`)으로 바꿔 입는다.
   */
  .pane-head.term {
    --head-dim: color-mix(in srgb, var(--head-fg) 62%, transparent);
    --chip-tmux: var(--head-fg);
    --chip-folder: var(--head-fg);
    --chip-branch: var(--head-fg);
    --chip-jump: var(--head-fg);
    --chip-forward: var(--head-fg);
    --chip-ai-read: var(--head-fg);
    /* 앱 테마의 흐린 글자는 터미널 바탕에서 안 읽힐 수 있다 */
    --chip-ai-off: var(--head-dim);
    --chip-resource: var(--head-fg);
    --chip-tint: 12%;
    --chip-tint-hover: 18%;
    color: var(--head-fg);
  }

  /* `--flip-ink`(0 터미널 · 1 대화)는 `pane/flip-motion.ts` 가 수로 등록한다 — 뒤집는 동안은 그쪽 계단 키프레임이 정한다 */
  .pane-head.term {
    --flip-ink: 0;
    --head-fg: color-mix(in srgb, var(--fg-1) calc(var(--flip-ink) * 100%), var(--term-fg));
    --logo-mono: color-mix(in srgb, var(--logo-mono-chrome) calc(var(--flip-ink) * 100%), var(--term-fg));
    --logo-mono-inverse: color-mix(in srgb, var(--logo-mono-chrome-inverse) calc(var(--flip-ink) * 100%), var(--term-bg));
    background: color-mix(in srgb, var(--surface-raised-solid) calc(var(--flip-ink) * 100%), transparent);
    /* 미니 게이지의 찬 막대(`--ai-c` ← `--ai-lv*`)는 칩 안에서 같은 값으로 다시 선언한다(아래 `.ai-chip`) */
    --head-ai-lv2: color-mix(in srgb, var(--ai-lv2) calc(var(--flip-ink) * 100%), var(--ai-term-lv2));
    --head-ai-lv3: color-mix(in srgb, var(--ai-lv3) calc(var(--flip-ink) * 100%), var(--ai-term-lv3));
    --head-ai-lv4: color-mix(in srgb, var(--ai-lv4) calc(var(--flip-ink) * 100%), var(--ai-term-lv4));
    --chip-ai-approve: var(--head-ai-lv2);
    --chip-ai-auto: var(--head-ai-lv3);
    --chip-ai-all: var(--head-ai-lv4);
  }

  .pane-head.term :global(.ai-chip) {
    --ai-lv2: var(--head-ai-lv2);
    --ai-lv3: var(--head-ai-lv3);
    --ai-lv4: var(--head-ai-lv4);
  }

  .pane-head.term.talk {
    --flip-ink: 1;
  }

  /* AI 읽기 허용은 머리줄에 색을 입히지 않는다 — 켠 옵션일 뿐 AI 가 지금 이 타일에서 일한다는 뜻이 아니다 */

  .pane-head:active {
    cursor: grabbing;
  }

  .swatch {
    flex: 0 0 auto;
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }

  /*
    `min-width: 0` — 칩 접기(`pane/chip-fit-dom.ts`)가 이 상자의 폭을 칩 줄의 몫으로 잰다. 내용 폭을 따르면 넘침을 잴 수 없다.
    가로만 자른다 — 세로를 자르면 칩의 포커스 테가 잘린다.
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

  /* 40% 는 `image/bar-fit.ts` 의 이름 묶음 셈과 같은 값이다 */
  .pane-head.has-tools .pane-ident {
    flex: 0 1 auto;
    max-width: 40%;
  }

  /* 모자란 폭은 이름이 먼저 먹는다 — 도구줄 끝의 [저장] 이 먼저 잘리지 않게 */
  .pane-head.keep-tools .pane-ident {
    flex-shrink: 10000;
  }

  .pane-head.keep-tools .pane-tools {
    flex-basis: auto;
  }

  .pane-ident.gone {
    display: none;
  }

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
    cursor: default;
  }

  .pane-lead {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    /* 파일 타일 도구줄(`.file-bar`)의 간격과 같은 값 */
    gap: 4px;
    cursor: default;
  }

  .pane-name {
    min-width: 0;
    margin-right: 4px;
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

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

  .unsaved {
    flex: 0 0 auto;
    margin-left: 4px;
    font-size: 9px;
    line-height: 1;
    color: var(--accent);
    cursor: default;
  }

  /* 기울어진 끝 글자가 말줄임 칸에 잘리지 않게 오른쪽 여유 */
  .pane-name.preview {
    font-style: italic;
    padding-right: 1px;
  }

  /* `UiIcon` 은 `display: block` 이라 버튼 안에서 저절로 가운데에 서지 않는다 — flex 로 잡는다. 폭 24px 은 `image/bar-fit.ts` 가 셈에 쓴다 */
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
    /* 접힐 때 지울 앞 간격 = 머리줄의 `gap`(아래 "드러냄" 절) */
    --head-act-gap: var(--space-2);
    overflow: hidden;
    transition:
      opacity 120ms ease-out,
      width 120ms ease-out,
      margin 120ms ease-out;
  }

  /*
   * ## 드러냄 — 조작은 드러날 때만, 상태 · 정체는 늘
   *
   * 조작 = `.head-btn` · `.pane-lead` · 도구줄과 `.pane-group` 직계의 `[data-head-act]`(표시 규칙은 `pane/pane-tools.svelte.ts` 머리말).
   * 숨으면 자리도 접고 앞 간격은 `--head-act-gap`(그 요소를 담은 줄의 `gap` — 줄이 정한다)을 음수 여백으로 지운다.
   * `.pane-lead` 만 자리를 쥔 채 흐려진다 — 아이콘 · 이름 앞이라 접으면 타일 위를 지날 때마다 정체가 미끄러진다.
   * `display` · `visibility` 로 숨기지 않는다 — 포커스 순서에서 빠져 Tab 으로 닿아 드러나는 길(`:focus-within`)이 끊긴다.
   * 타일 전체의 호버는 머리줄의 직계 부모 `.pane-box`(`PaneHost`)에서 읽는다.
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

  .syncmark {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    line-height: 1;
    cursor: default;
  }

  .syncmark {
    color: var(--warn);
  }

  .head-btn.zoom.on {
    color: var(--fg-1);
    background: color-mix(in srgb, var(--fg) 7%, var(--surface-hover));
  }

</style>
