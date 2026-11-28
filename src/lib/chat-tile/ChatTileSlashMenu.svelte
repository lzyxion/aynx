<script lang="ts">
  /**
   * `/` 메뉴 — 입력 칸 상자 위에 뜨는 목록. 포커스는 늘 입력 칸에 있다(줄은 `tabindex="-1"` · 누를 때 포커스를 뺏지 않는다).
   * 키는 부르는 쪽(`ChatTileFace` 의 입력 칸 갈고리)이 받는다 — 이 메뉴는 그리고 고른 줄을 넘기기만 한다(고르기는 부르는 쪽의 `runOnMenu`).
   * 아래쪽 자리를 쓰지 않는다 — 친 글을 덮지 않게 늘 상자 위, 모자라면 높이를 줄여 안에서 구른다.
   * 위로는 타일 몸(`bound`) 안에서 멈춘다 — 탭 띠 · 옆 타일을 덮지 않게(줄 셋 남짓은 늘 보인다).
   * aynx 줄의 설명은 늘 Aynx 문구다 — CLI 의 설명(`/clear` 의 "Clear conversation history")은 여기서 하는 일과 다르다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import type { AynxAction, SlashEntry } from "$lib/chat-tile/chat-tile-slash";
  import type { Key } from "$lib/i18n/keys";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    entries,
    active,
    pending,
    more = 0,
    sendable = true,
    anchor,
    bound = null,
    idBase,
    touch = false,
    onpick,
    onhover,
    onclose,
  }: {
    entries: SlashEntry[];
    active: number;
    pending: boolean;
    /** 상한(50줄) 밖에 남은 줄 수 — 바닥에 "N개 더" 줄 */
    more?: number;
    /** 글이 정말 보내질 때만 빈 결과 줄("보내면 글로 갑니다")을 보인다 */
    sendable?: boolean;
    /** 입력 칸 상자(`FlipComposer` 의 `.wrap`) */
    anchor: HTMLElement;
    /** 타일 몸 — 메뉴가 넘지 않을 위 · 옆 경계 */
    bound?: HTMLElement | null;
    /** 줄 id 앞머리 — 입력 칸의 `aria-activedescendant` 가 가리킨다 */
    idBase: string;
    touch?: boolean;
    onpick: (e: SlashEntry) => void;
    onhover: (i: number) => void;
    onclose: () => void;
  } = $props();

  const EDGE = 8;
  const MAX_W = 560;
  /** 마지막 포인터 자리 — 메뉴가 쉬는 포인터 밑에 떠도 줄을 고르지 않게, 실제로 움직였을 때만 고른다 */
  let lastPointer: string | null = null;

  function onPointerMove(ev: PointerEvent, i: number, off: boolean): void {
    const at = `${ev.screenX},${ev.screenY}`;
    const first = lastPointer === null;
    if (at === lastPointer) return;
    lastPointer = at;
    if (!first && !off && i !== active) onhover(i);
  }
  /** 줄 셋 남짓 — 타일이 작아도 이만큼은 보인다 */
  const MIN_H = 124;
  let el = $state<HTMLElement | null>(null);
  let scroller = $state<HTMLElement | null>(null);
  let left = $state(0);
  let bottom = $state(0);
  let width = $state(320);
  let maxH = $state(240);

  const ICON: Readonly<Record<AynxAction, string>> = {
    model: "ai",
    mode: "shield-check",
    newChat: "plus",
    conversations: "conversations",
    usage: "chart-column",
    context: "ai-gauge-2",
    compact: "view-compact",
    copyHint: "copy",
    diffHint: "git-compare",
    rewind: "undo",
    mcpStatus: "mcp", review: "list-checks", goal: "route", fast: "zap",
  };

  function desc(e: SlashEntry): string {
    const w = e.word ?? (e.cls === "aynx" ? e.action : null);
    if (w === "copyHint") return t("pane.chatTile.slash.copyHint");
    if (w === "diffHint") return t("pane.chatTile.slash.diffHint");
    if (w) return t(`pane.chatTile.slash.action.${w}` as Key);
    return e.description;
  }

  function place(): void {
    const box = anchor.getBoundingClientRect();
    const lim = bound?.getBoundingClientRect() ?? null;
    const lo = Math.max(EDGE, lim ? lim.left + 4 : 0);
    const hi = Math.min(window.innerWidth - EDGE, lim ? lim.right - 4 : Infinity);
    width = Math.max(Math.min(200, hi - lo), Math.min(MAX_W, box.width, hi - lo));
    left = Math.max(lo, Math.min(box.left, hi - width));
    bottom = window.innerHeight - box.top + 4;
    const top = Math.max(EDGE, lim ? lim.top + 4 : 0);
    // 대화를 다 덮지 않게 창 높이 절반 언저리에서 멈춘다 · 타일 위 끝을 넘지 않는다
    maxH = Math.max(MIN_H, Math.min(box.top - 4 - top, Math.max(240, window.innerHeight * 0.5)));
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    return untrack(() => {
      place();
      // 입력 칸이 자라면(여러 줄) 상자 위 자리가 바뀐다 · 폰 화면 키보드는 창 크기를 바꾼다
      const ro = new ResizeObserver(place);
      ro.observe(anchor);
      if (bound) ro.observe(bound);
      window.addEventListener("resize", place);
      return () => {
        ro.disconnect();
        window.removeEventListener("resize", place);
      };
    });
  });

  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (el?.contains(target) || anchor.contains(target)) return;
      onclose();
    };
    window.addEventListener("pointerdown", onDown, true);
    return () => window.removeEventListener("pointerdown", onDown, true);
  });

  // 고른 줄이 보이게 — 키로 옮기면 목록이 따라 구른다
  $effect(() => {
    const i = active;
    void entries;
    const box = scroller;
    if (!box || i < 0) return;
    untrack(() => box.querySelector<HTMLElement>(`[data-slash-i="${i}"]`)?.scrollIntoView({ block: "nearest" }));
  });

  const label = (e: SlashEntry) => (e.skill ? `$${e.name}` : `/${e.name}`);
</script>

<div
  class="csm menu-surface menu-keyed"
  class:touch
  style="left:{left}px;bottom:{bottom}px;width:{width}px;max-height:{maxH}px"
  bind:this={el}
  data-chat-tile-slash-menu
>
  <div class="csm-scroll glass-scroll" bind:this={scroller} id="{idBase}-list" role="listbox" aria-label={t("pane.chatTile.slash.menu")}>
    {#each entries as e, i (e.group + ":" + e.name)}
      {@const off = e.cls === "terminal"}
      {#if i === 0 || entries[i - 1].group !== e.group}
        <div class="csm-head" role="presentation" data-chat-tile-slash-group={e.group}>{t(`pane.chatTile.slash.group.${e.group}` as Key)}</div>
      {/if}
      <button
        type="button"
        class="menu-row csm-row"
        class:selected={i === active}
        class:off
        id="{idBase}-{i}"
        role="option"
        tabindex="-1"
        aria-selected={i === active}
        aria-disabled={off ? "true" : undefined}
        data-slash-i={i}
        data-chat-tile-slash={e.name}
        data-group={e.group}
        data-cls={e.cls}
        onmousedown={(ev) => ev.preventDefault()}
        onpointermove={(ev) => onPointerMove(ev, i, off)}
        onclick={() => onpick(e)}
      >
        <span class="csm-text">
          <span class="csm-line">
            <span class="csm-name">{label(e)}</span>
            {#if e.hint}<span class="csm-hint">{e.hint}</span>{/if}
          </span>
          {#if desc(e)}<span class="csm-desc">{desc(e)}</span>{/if}
        </span>
        {#if e.action}
          <span class="csm-go" aria-hidden="true"><UiIcon name={ICON[e.action]} size={14} /></span>
        {:else if off}
          <span class="csm-tag">{t("pane.chatTile.slash.terminalTag")}</span>
        {/if}
      </button>
    {/each}
    {#if more > 0}
      <div class="csm-note csm-more" role="presentation" data-chat-tile-slash-more={more}>{t("pane.chatTile.slash.more", { n: String(more) })}</div>
    {/if}
  </div>
  <!-- 목록 밖 바닥 줄 — 길게 구르는 목록에 묻히지 않게 -->
  {#if entries.length === 0 && sendable}
    <div class="csm-note" data-chat-tile-slash-empty>{t("pane.chatTile.slash.empty")}</div>
  {/if}
  {#if pending}
    <div class="csm-note" class:sep={entries.length > 0} data-chat-tile-slash-pending>{t("pane.chatTile.slash.pending")}</div>
  {/if}
</div>

<style>
  .csm {
    position: fixed;
    z-index: 41;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  .csm-scroll {
    flex: 1 1 auto;
    min-height: 0;
    overscroll-behavior: contain;
  }

  .csm-head {
    padding: var(--space-2) var(--space-3) 2px;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-3);
  }

  /* 두 줄 줄은 알약이 아니다(규칙 — 40px 넘는 줄) */
  .csm-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: auto;
    min-height: 36px;
    padding-top: 4px;
    padding-bottom: 4px;
    white-space: normal;
    border-radius: var(--radius-sm);
  }

  .csm.touch .csm-row {
    min-height: 48px;
  }

  .csm-row.off {
    cursor: default;
    opacity: 0.55;
  }

  .csm-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .csm-line {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .csm-name {
    flex: none;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
  }

  .csm-hint {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .csm-desc {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .csm-go {
    flex: none;
    display: inline-flex;
    color: var(--fg-3);
  }

  .csm-tag {
    flex: none;
    padding: 0 7px;
    font-size: var(--t-xs);
    line-height: 18px;
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .csm-note {
    flex: none;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .csm-note.sep {
    border-top: 1px solid var(--line);
  }

  .csm-more {
    padding-top: var(--space-1);
  }
</style>
