<script lang="ts">
  /**
   * **tmux 칩 호버 카드** — 머리줄 tmux 칩에 얹으면 뜨는, 서버의 세션들을 점과 함께 늘어놓은 작은 카드
   * (2026-10-05 사용자 — 예전에는 칩의 `title` 한 줄 "tmux 세션 aynx-2" 였다).
   *
   * ```text
   * tmux 세션 3            ● 2  ○ 1
   * [● aynx-2] [●² build] [○ old-logs]
   * ```
   *
   * - 머리: 세션 수 + 오른쪽 `●붙은 수 ○빈 수` 요약(`tmuxSummary`)
   * - 칩: 상태 점(`TmuxStateDot`) + 이름. 이 타일의 세션은 강조색 머리카락 테두리, 비어 있으면 이름을 흐리게
   * - 6개까지만 그리고 나머지는 `+N` — 다 보려면 칩을 누른다(목록 팝오버)
   *
   * 자리·층·몸짓은 SSH 이름 카드(`SessionInfoCard.svelte`)와 같은 판이다: `position: fixed`, 자리는
   * `placeTooltip`, **타일 상자 밖**(`PaneHost` 최상위)에 그린다, 두 걸음(재고 → 보인다), 커서를 먹지 않는다 — 틀은 공용 `HoverCard.svelte`.
   * `aria-hidden` — 시각 층이다(칩의 `aria-label` 이 이름을 쥐고, 목록은 칩을 누르면 연다).
   */
  import TmuxStateDot from "$lib/pane/TmuxStateDot.svelte";
  import { tmuxSummary, type TmuxSessionInfo } from "$lib/tmux";
  import HoverCard from "$lib/HoverCard.svelte";
  import type { TooltipRect } from "$lib/tooltip";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    sessions,
    current,
    anchor,
  }: {
    sessions: TmuxSessionInfo[];
    /** 이 타일이 붙어 있는 세션 이름 */
    current: string;
    /** 칩의 상자(뷰포트 좌표) */
    anchor: TooltipRect;
  } = $props();

  /** 카드에 그리는 칩 수 상한 — 넘으면 `+N` */
  const MAX_SHOWN = 6;

  const summary = $derived(tmuxSummary(sessions));
  /** 이 타일의 세션을 맨 앞으로 — 6개 상한에 잘려 나가지 않게 */
  const ordered = $derived([
    ...sessions.filter((s) => s.name === current),
    ...sessions.filter((s) => s.name !== current),
  ]);
  const shown = $derived(ordered.slice(0, MAX_SHOWN));
  const more = $derived(ordered.length - shown.length);
</script>

<HoverCard
  {anchor}
  watch={[sessions, current]}
  minWidth={200}
  maxWidth={320}
  padX="10px"
  gap="7px"
  lineHeight={1.3}
  data-tmux-sessions-card=""
>
  <div class="t-head">
    <span class="t-title">{t("pane.tmux.card.title", { n: sessions.length })}</span>
    <span class="t-sum"><TmuxStateDot attached={1} />{summary.attached}</span>
    <span class="t-sum"><TmuxStateDot attached={0} />{summary.empty}</span>
  </div>
  <div class="t-list">
    {#each shown as s (s.name)}
      <span class="t-s" class:here={s.name === current} class:idle={s.attached === 0}>
        <TmuxStateDot attached={s.attached} />
        <span class="t-n">{s.name}</span>
      </span>
    {/each}
    {#if more > 0}
      <span class="t-more">{t("pane.tmux.card.more", { n: more })}</span>
    {/if}
  </div>
</HoverCard>

<style>
  /* 머리 — 세션 수(남는 폭) + `●n ○m` */
  .t-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }
  .t-title {
    flex: 1;
    min-width: 0;
    white-space: nowrap;
  }
  .t-sum {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    color: var(--fg-2);
  }

  /* 세션 칩들 — 넘치면 다음 줄로 */
  .t-list {
    display: flex;
    flex-wrap: wrap;
    gap: 5px;
  }
  .t-s {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    max-width: 100%;
    box-sizing: border-box;
    padding: 3px 7px 3px 6px;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    border-radius: 5px;
    background: color-mix(in srgb, var(--fg) 5%, transparent);
  }
  /* 이 타일의 세션 — 강조색 머리카락 테두리 하나 (판은 다른 칩과 같다) */
  .t-s.here {
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--accent) 60%, transparent);
  }
  .t-s.idle .t-n {
    color: var(--fg-2);
  }
  .t-n {
    min-width: 0;
    max-width: 18ch;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .t-more {
    align-self: center;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--fg-3);
  }
</style>
