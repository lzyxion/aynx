<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { closeOnOutside, menuKeydown } from "$lib/pane/chip-menu.svelte.js";
  import TmuxStateDot from "$lib/pane/TmuxStateDot.svelte";
  import { listTmuxSessions, relativeCreated, tmuxSummary, type TmuxSessionInfo } from "$lib/tmux";
  import { noteTmuxSessions } from "$lib/pane/tmux-sessions.svelte.js";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * tmux 세션 목록 팝오버 (docs/log/2026-09-16-tmux-toggle.md).
   * ⋯ 메뉴의 옆목록에 넣지 않는다 — 왕복이 있어 떠 있는 동안 폭 · 높이가 두 번 바뀌고 부모 메뉴까지 움직인다. 메뉴를 닫고 그 자리에 연다.
   */
  let {
    title,
    sessionId,
    current,
    left,
    top,
    onswitch,
    onopen,
    onkill,
    onclose,
  }: {
    title: string;
    sessionId: number | null;
    current: string | null;
    left: number;
    top: number;
    onswitch: (name: string) => void;
    /** `null` 이면 새 세션(다음 번호를 백엔드가 고른다) */
    onopen: (name: string | null) => void;
    onkill: (s: TmuxSessionInfo) => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  /** `null` = 아직 읽는 중 · 빈 배열 = 세션이 없다 */
  let rows = $state<TmuxSessionInfo[] | null>(null);
  /** 읽지 못한 사유 — "없음" 과 다르다 */
  let failed = $state<string | null>(null);
  let loading = $state(false);

  /**
   * `gen` 으로 늦게 온 응답을 버린다 — `tmux ls` 는 SSH 왕복이라 순서가 보장되지 않아 낡은 목록이 새 목록을 덮는다.
   * 다시 읽는 동안 앞의 목록은 지우지 않는다 — 상자 높이가 튀고 누르려던 줄이 손 아래에서 없어진다.
   */
  let gen = 0;
  async function load(): Promise<void> {
    const id = sessionId;
    const mine = ++gen;
    if (id === null) {
      rows = [];
      failed = tr("pane.tmux.failed");
      return;
    }
    loading = true;
    failed = null;
    try {
      const list = await listTmuxSessions(id);
      if (mine !== gen) return;
      rows = list;
      noteTmuxSessions(id, list); // 머리줄 칩의 호버 카드도 같은 결과를 쓴다
    } catch (e: unknown) {
      if (mine !== gen) return;
      rows ??= []; // 이미 읽은 목록은 그대로 두고 실패 한 줄만 얹는다
      failed = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === gen) loading = false;
    }
  }

  $effect(() => {
    void sessionId;
    void load();
    return () => {
      gen++;
    };
  });

  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  $effect(() => {
    const node = el;
    const t = shownTop;
    void rows; // 줄이 채워지면 높이가 달라져 다시 잰다
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (t > max) {
      clamped = Math.max(8, max);
      return;
    }
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });
  });

  /** 머리줄 tmux 칩만 비켜 간다 — 여기서 닫으면 뒤따르는 `click` 이 다시 열어 눌러 닫는 토글이 서지 않는다 */
  $effect(() => closeOnOutside(() => el, "[data-tmux-menu-btn]", onclose));

  /** Escape 는 여기서 끊는다 — 뒤 화면까지 닫지 않게 */
  function onKey(ev: KeyboardEvent) {
    // 새로고침은 ↑↓ 고리 밖이다(`menuitem` 도 아니다) — 끼면 첫 ↓ 가 늘 새로고침에 걸린다
    menuKeydown(ev, el, "button:not([disabled]):not([data-tmux-refresh])", onclose);
  }

  function stateTitle(s: TmuxSessionInfo): string {
    return s.attached > 0
      ? tr("pane.tmux.state.attached", { n: s.attached })
      : tr("pane.tmux.state.empty");
  }

  const summary = $derived(rows === null || rows.length === 0 ? null : tmuxSummary(rows));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="tmuxmenu menu-surface"
  role="menu"
  aria-label={tr("pane.tmux.aria", { title })}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
>
  <div class="head">
    <p class="group menu-title">{tr("pane.tmux.group", { title })}</p>
    {#if summary}
      <span
        class="summary"
        title={tr("pane.tmux.summary.title", { attached: summary.attached, empty: summary.empty })}
      >
        <span class="sum"><TmuxStateDot attached={1} />{summary.attached}</span>
        <span class="sum"><TmuxStateDot attached={0} />{summary.empty}</span>
      </span>
    {/if}
    <button
      type="button"
      class="refresh"
      class:spinning={loading}
      disabled={loading || sessionId === null}
      title={tr("pane.tmux.refresh.title")}
      aria-label={tr("pane.tmux.refresh.aria")}
      data-tmux-refresh
      onclick={() => void load()}
    >
      <UiIcon name="refresh" size={13} />
    </button>
  </div>

  {#if rows === null}
    <p class="note">{tr("pane.tmux.loading")}</p>
  {:else}
    {#if failed}
      <p class="note bad">{failed}</p>
    {/if}
    {#if !failed && rows.length === 0}
      <p class="note">{tr("pane.tmux.empty")}</p>
    {/if}
    {#each rows as s (s.name)}
      {@const here = s.name === current}
      <div class="row" class:here aria-current={here ? "true" : undefined}>
        <button
          type="button"
          class="pick"
          class:idle={s.attached === 0}
          role="menuitem"
          disabled={here}
          title={here
            ? tr("pane.tmux.current.title")
            : tr("pane.tmux.switch.title", { name: s.name })}
          onclick={() => onswitch(s.name)}
        >
          <span class="mark menu-mark"
            >{#if here}<UiIcon name="check" size={14} />{/if}</span
          >
          <TmuxStateDot attached={s.attached} title={stateTitle(s)} />
          <span class="name">{s.name}</span>
          <span class="wins" title={tr("pane.tmux.windows.title", { n: s.windows })}
            ><UiIcon name="window" size={11} />{s.windows}</span
          >
          <span class="age">{relativeCreated(s.created, Date.now(), tr)}</span>
        </button>
        <button
          type="button"
          class="side"
          role="menuitem"
          title={tr("pane.tmux.open.title", { name: s.name })}
          aria-label={tr("pane.tmux.open.aria", { name: s.name })}
          onclick={() => onopen(s.name)}
        >
          <UiIcon name="split-h" size={13} />
        </button>
        <!-- 이 타일이 붙어 있는 줄도 끄기 단추를 감추지 않는다 — 감추면 "끄려면 다른 타일로 가라" 가 된다 -->
        <button
          type="button"
          class="side kill"
          role="menuitem"
          title={here
            ? tr("pane.tmux.kill.title_attr_here", { name: s.name })
            : tr("pane.tmux.kill.title_attr", { name: s.name })}
          aria-label={tr("pane.tmux.kill.aria", { name: s.name })}
          data-tmux-kill={s.name}
          onclick={() => onkill(s)}
        >
          <UiIcon name="trash" size={13} />
        </button>
      </div>
    {/each}
  {/if}

  <hr class="menu-sep" />
  <button
    type="button"
    class="pick new"
    role="menuitem"
    title={tr("pane.tmux.new.title")}
    onclick={() => onopen(null)}
  >
    <span class="mark menu-mark"><UiIcon name="plus" size={14} /></span><span
      class="label">{tr("pane.tmux.new")}</span
    >
  </button>
</div>

<style>
  .tmuxmenu {
    position: fixed;
    z-index: 20;
    min-width: 240px;
    max-width: 320px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .group {
    flex: 1;
    min-width: 0;
  }

  .refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 24px;
    height: 24px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .refresh:hover:not(:disabled),
  .refresh:focus-visible {
    color: var(--fg-2);
    background: var(--surface-hover);
    outline: none;
  }

  .refresh:disabled {
    cursor: default;
  }

  .refresh.spinning :global(svg) {
    animation: tmux-spin 0.9s linear infinite;
  }

  @keyframes tmux-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .refresh.spinning :global(svg) {
      animation: none;
      opacity: 0.5;
    }
  }

  .note {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .note.bad {
    color: var(--err);
  }

  .summary {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }

  .sum {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .row {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    border-radius: var(--radius-row);
  }

  .row.here {
    background: var(--surface-hover);
  }

  .pick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    min-height: 30px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    text-align: left;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-row);
    cursor: pointer;
  }

  .pick:hover:not(:disabled),
  .pick:focus-visible,
  .side:hover,
  .side:focus-visible {
    background: var(--surface-hover);
    outline: none;
  }

  /* 누를 수 없지만 흐리게 하지 않는다 — 체크와 판이 왜인지를 말한다 */
  .pick:disabled {
    cursor: default;
  }

  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
  }

  .pick.idle .name {
    color: var(--fg-2);
  }

  .wins {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .age {
    flex: none;
    min-width: 36px;
    text-align: right;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .side {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    min-height: 30px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-row);
    cursor: pointer;
  }

  .side.kill:hover,
  .side.kill:focus-visible {
    color: var(--err);
  }
</style>
