<script lang="ts" module>
  /** 머리줄 버튼 · 표식(`PaneHeader`)과 칩이 나눠 쓰는 한 값(근거는 `PaneHeader` 의 `ICON_SIZE` 주석) */
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
  import { setLocalAiRead } from "$lib/pane/local-ai";
  import { resourceOutdated, resourceRing, resourceTop, watchResources } from "$lib/app/resources.svelte.js";
  import { openResourceView } from "$lib/app/usage-view.svelte.js";
  import { formatCpu, formatMem, tileUsage, topLine } from "$lib/resources";
  import { overflowAnchor, type ChipFitMode, type FitResult } from "$lib/pane/chip-fit";
  import { observeChipFit } from "$lib/pane/chip-fit-dom";
  import type { ChipMoreItem } from "$lib/pane/chip-more-menu.svelte.js";
  import type { HeaderChipId } from "$lib/header-chips";
  import "./header-chip.css";

  /**
   * 타일 머리줄의 칩 묶음 — 칩은 부모 묶음(`.pane-ident`, grid)의 칸으로 바로 선다. 순서 · 켬끔은 `settings.headerChipsShown`.
   * 넘치면 끝 칩부터 짧은 꼴 → 숨김 + "+N" 으로 재서 접는다(`chip-fit.ts` · `chip-fit-dom.ts`) — AI 권한 칩은 숨지 않는다. 펴기는 16px 여유가 생길 때만.
   * 호버 카드는 타일 상자 밖에서 `PaneHost` 가 그린다 — 상자마다 `isolation: isolate` 라 안에서 그리면 이웃 타일에 덮인다.
   * `data-*` 손잡이(`data-ai-menu-btn` · `data-ai-read-chip` · `data-tmux-menu-btn` · `data-jump-chip` · `data-forward-chip` · `data-folder-chip` ·
   * `data-branch-chip` · `data-resource-chip`)는 하네스 · 바깥 클릭 판정이 잡는 이름이라 바꾸지 않는다.
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
    /** 로컬이면 켜졌을 때만 눈 칩이 선다(원격은 `aiStage` 칩) */
    shared?: boolean;
    aiStage?: AiStage | null;
    /** `broken` = 연결 대상이 바뀌어 권한이 풀렸다(끔으로 동작) */
    dbAi?: { level: DbAiLevel; broken: boolean } | null;
    aiMenuOpen?: boolean;
    tmuxMenuOpen?: boolean;
    forwardMenuOpen?: boolean;
    forwards?: ForwardInfo[];
    sessionId?: number | null;
    /** 자원 칩은 보일 때만 표본을 당긴다 */
    shown?: boolean;
    folder: string | null;
    ontmuxcard?: (view: TmuxCardView | null) => void;
    onforwardcard?: (view: ForwardsCardView | null) => void;
    ontmuxmenu: (ev: MouseEvent) => void;
    onaimenu?: (ev: MouseEvent) => void;
    onforwardmenu: (ev: MouseEvent) => void;
    onfiles: () => void;
    fitBox?: HTMLElement | null;
    chipMoreOpen?: boolean;
    /** 숨은 칩 줄은 여는 순간의 사본이다 */
    onchipmore?: (ev: MouseEvent, items: ChipMoreItem[]) => void;
  } = $props();

  const ICON_SIZE = HEAD_ICON_SIZE;

  /**
   * 경유는 접속 순간에만 쓰는 값이라 열린 세션에 남지 않는다 — 칩은 호스트 캐시의 지금 설정을 보여 준다(실제 연결은 옛 경로일 수 있다).
   * 빠른 접속 타일은 늘 `null` — `alias` 가 화면의 `user@host:port` 라 같은 이름의 호스트가 있으면 남의 경유를 뒤집어쓴다.
   */
  const jump = $derived(
    pane.kind === "ssh" && !pane.adhoc ? (host?.proxy_jump?.trim() || null) : null,
  );

  const relaying = $derived(relayingConns(forwards));

  /**
   * 하네스가 개수를 `<span class="n">` 에서 읽으므로 사전 문장을 화면에 없는 글자(U+0000)로 가른다.
   * 그 글자를 소스에 글자 그대로 적지 않는다 — NUL 바이트가 박히면 `grep` · `rg` 가 이 소스를 바이너리로 보고 건너뛴다.
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

  // ── tmux 칩 호버 카드 ──
  // 목록 팝오버가 열려 있으면 띄우지 않는다. 목록을 아직 하나도 못 읽었으면 카드는 뜨지 않는다.
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

  // ── 포워딩 칩 호버 카드 ──
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

  $effect(() => {
    void sessionId;
    return () => hideFwCard();
  });

  // ── 폴더 칩 · 브랜치 칩 ──
  // 폴더 칩의 열리는 폴더는 `onfiles` 몸통이 다시 정한다 — 칩의 글자와 별개다.
  const terminal = $derived(pane.kind === "local" || pane.kind === "ssh");
  /** 원격 캐시 열쇠의 호스트 — 로컬은 `null` */
  const gitHost = $derived(pane.kind === "ssh" ? pane.alias?.trim() || `#${pane.id}` : null);
  const folderName = $derived(folderNameOf(folder));
  const folderTip = $derived(
    folder !== null
      ? t("pane.header.folder.title", { path: folder })
      : t(folderUnknownTipKey({ tmux: pane.kind === "ssh" && !!pane.tmux })),
  );
  const folderLabel = $derived(folderName !== "" ? folderName : t("pane.header.folder.unknown.chip"));

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

  function onChipEnter(): void {
    refreshPaneGit(pane.id);
  }

  function openBranches(): void {
    openBranchGraphOfPane(pane.id, gitHead?.kind === "branch" ? gitHead.name : null);
  }

  // ── 자원 칩 ──
  // 로컬 타일만 — 프로세스 트리는 이 PC 에 있다. 말풍선에는 실행 파일 이름만 온다(명령줄은 오지 않는다).
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

  // ── 접기 ──
  let fit = $state<FitResult | null>(null);
  $effect(() => {
    const box = fitBox;
    if (!box) return;
    return observeChipFit(box, (r) => (fit = r));
  });

  const fitModes = $derived.by(() => {
    const m = new Map<string, ChipFitMode>();
    fit?.ids.forEach((id, i) => m.set(id, fit!.modes[i]));
    return m;
  });
  const hiddenIds = $derived((fit?.hidden ?? []) as HeaderChipId[]);
  /** 첫 숨은 칩의 앞 — 그 칩이 지금 순서에 없으면(막 빠짐) 끝의 쉬는 자리 */
  const moreAt = $derived.by(() => {
    if (fit === null) return null;
    const at = overflowAnchor(fit);
    return at !== null && (settings.headerChipsShown as readonly string[]).includes(at) ? at : null;
  });

  /** `forms` = 꼴 수(1 = 접을 글자 없음 · 2 = 그림만까지 · 3 = 자원: 짧은 꼴 → 그림) */
  function fitAttrs(id: HeaderChipId, forms: number, pin = false): Record<string, string | undefined> {
    return {
      "data-fit-chip": id,
      "data-fit-forms": String(forms),
      "data-fit-pin": pin ? "" : undefined,
      "data-fit": fitModes.get(id) ?? "full",
    };
  }

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

<!-- 끈 칩은 아예 그리지 않는다 — AI 권한 칩도 예외 없음(자동 승인 경고색 · DB 연결 풀림도 함께 숨는다, 사용자 결정) -->
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
  숨은 칩이 없으면 끝에 쉬는 자리(`idle` — 보이지 않는다)로 서서 잴 때만 나타난다.
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

<!-- 로컬 타일은 단계가 Off · Read 둘뿐이라 게이지가 아니다 — 켜졌을 때만 눈 칩이 서고, 누르면 바로 끈다(끄기는 원격 창에서도 묻지 않는다) -->
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
{:else if pane.kind === "local" && shared}
  <button
    type="button"
    class="hchip ai-chip"
    {...fitAttrs("ai", 1, true)}
    data-ai-read-chip={pane.id}
    title={t("pane.header.aiRead.title")}
    aria-label={t("pane.header.aiRead.title")}
    onclick={() => setLocalAiRead(pane.id, false)}
  >
    <UiIcon name="ai-read" size={ICON_SIZE - 2} />
  </button>
{/if}
{/snippet}

<!-- 권한을 줄 수 없는 타일의 Off 칩 — `disabled` 가 아니라 `aria-disabled` 인 것은 말풍선이 떠야 해서다. `data-ai-menu-btn` 은 달지 않는다 -->
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

<!-- tmux 칩 — 개수는 넣지 않는다(사용자 결정: 이름 옆 숫자는 뜻이 애매하다) -->
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

<!-- 경유 칩 — 상태 하나뿐이라 버튼이 아니다(아무 일도 안 하는 버튼은 "누를 수 있는 것" 의 뜻을 흐린다) -->
{#snippet jumpChip()}
{#if jump}
  <span class="hchip jump-chip" {...fitAttrs("jump", 2)} data-jump-chip={pane.id} title={t("pane.header.jump.title", { jump })}>
    <UiIcon name="route" size={ICON_SIZE - 2} />
    <span class="hchip-t" data-fold="1">{t("pane.header.jump.chip", { jump })}</span>
  </span>
{/if}
{/snippet}

<!-- 포워딩 칩 — 호스트 프리셋으로 자동으로 열린 것은 토스트가 없어 열렸다는 사실을 말하는 자리가 여기 하나다. 점은 트래픽이 흐를 때만 -->
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
  /* 칩 한 벌은 전역 `./header-chip.css` — 여기는 칩마다의 색 · 접기 */

  /* 글꼴은 칩 한 벌(UI 글꼴) — mono 를 쓰면 칩이 나란히 설 때 한 줄에 글꼴이 둘로 보인다 */
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

  .folder-chip {
    --c: var(--chip-folder);
  }

  .folder-chip .hchip-t {
    max-width: 18ch;
  }

  .folder-chip .hchip-t.muted {
    color: var(--head-dim);
  }

  .branch-chip {
    --c: var(--chip-branch);
  }

  .branch-chip .hchip-t {
    max-width: 24ch;
  }

  /*
    접기 — 꼴마다의 모양은 여기 한 곳. 재는 동안(`data-chip-measure`)에는 숨은 칩 · 쉬는 "+N" 까지 모든 칩이 그 꼴로 선다.
    `data-fold`: 1 = 짧은 꼴부터 걷힘 · 2 = 그림 꼴부터 걷힘(자원의 CPU).
  */
  /* 칩은 제 꼴의 폭 아래로 줄지 않는다 — `min-width: 0` 이면 grid 가 칩까지 나눠 줄여 긴 칩의 글자가 옆 칩에 겹친다 */
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

  /* 숫자는 고정폭 — 수가 바뀌어도 잰 폭을 그대로 쓴다 */
  .more-chip {
    --c: var(--head-fg, var(--fg-2));
    padding: 0 7px;
    font-variant-numeric: tabular-nums;
  }

  /* 버튼이 아닌 표식이라 호버 판이 없다 */
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

  .fw-chip {
    --c: var(--chip-forward);
  }

  /*
    `.label` 은 평범한 inline 이어야 한다 — flex 로 만들면 낱말과 숫자 사이의 공백 텍스트 노드가 버려져 `포워딩1` 로 붙는다.
  */
  .fw-chip .n {
    font-variant-numeric: tabular-nums;
  }

  /* 맥박은 불투명도와 크기만 — 자리를 흔들면 옆 버튼들이 매 프레임 움직인다 */
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

  @media (prefers-reduced-motion: reduce) {
    .fw-chip .dot {
      animation: none;
    }
  }

  /* 색은 게이지 자리(`data-ai-tone`)로 고른다 — 원격과 DB 가 같은 자리면 같은 색. 글자라 대비 4.5:1 이 하한(`theme.css` 의 `--chip-ai-*`) */
  .ai-chip {
    --c: var(--chip-ai-read);
    gap: 5px;
  }

  .ai-chip[data-ai-tone="0"] {
    --c: var(--chip-ai-off);
  }

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

  .res-chip {
    --c: var(--chip-resource);
    font-variant-numeric: tabular-nums;
  }
</style>
