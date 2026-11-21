<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { HEAD_ICON_SIZE } from "$lib/pane/HeaderChips.svelte";
  import "$lib/pane/header-chip.css";
  import AiGaugeMini from "$lib/AiGaugeMini.svelte";
  import { gaugeIndex, gaugeTone } from "$lib/ai-gauge";
  import { AI_STAGES } from "$lib/delegation";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { moveChip, moveChipTo, type HeaderChipId } from "$lib/header-chips";
  import { insertIndexAt, measureLefts, playFlip } from "$lib/flip";
  import { resetHeaderChips, setHeaderChipOrder, setHeaderChipShown, settings } from "$lib/settings.svelte.js";
  import type { Key } from "$lib/i18n/keys";

  /**
   * 설정 › 터미널 "타일 머리줄 칩" — 누르면 켬/끔 · 끌면 순서(키보드는 `Alt+←/→`).
   * 끄는 칩은 끌기 그림이 찍힌 뒤(`setTimeout 0`)에 숨긴다 — 같은 틱에 숨기면 끌기가 취소된다.
   * `Alt+←/→` 는 전역 타일 포커스 이동(버블 단계)이라 칩의 keydown 이 먼저 받아 `stopPropagation` 한다 — 전역 단축키로 등록하지 않는다.
   */

  /** 설정 색인 anchor(`header-chips`) — `{id}-label` · `{id}-hint` 도 여기서 나온다 */
  let { id }: { id: string } = $props();

  type ChipView = { id: HeaderChipId; icon: string | null; color: string; name: string };

  const AI_SAMPLE_AT = gaugeIndex(AI_STAGES, "approve");

  /** `pane/HeaderChips` 의 그 칩과 같은 그림 · 색. 글자는 칩 이름이다 — 실제 값 샘플이면 막대가 넘쳐 가로 스크롤이 생겼다 */
  const CHIP_LOOK: Record<HeaderChipId, Omit<ChipView, "id" | "name">> = {
    folder: { icon: "folder", color: "var(--term-fg)" },
    branch: { icon: "git-branch", color: "var(--term-fg)" },
    tmux: { icon: "tmux", color: "var(--term-fg)" },
    jump: { icon: "route", color: "var(--term-fg)" },
    forward: { icon: "forward", color: "var(--term-fg)" },
    ai: { icon: null, color: "var(--chip-ai-approve)" },
    resource: { icon: "cpu", color: "var(--term-fg)" },
  };

  const NAME_KEY: Record<HeaderChipId, Key> = {
    folder: "settings.terminal.header_chips.name.folder",
    branch: "settings.terminal.header_chips.name.branch",
    tmux: "settings.terminal.header_chips.name.tmux",
    jump: "settings.terminal.header_chips.name.jump",
    forward: "settings.terminal.header_chips.name.forward",
    ai: "settings.terminal.header_chips.name.ai",
    resource: "settings.terminal.header_chips.name.resource",
  };

  /** 끌기 MIME — 글자(`text/plain`)로 두면 터미널 · 입력칸에 놓였을 때 글자로 들어간다 */
  const DRAG_TYPE = "application/x-aynx-header-chip";

  let groupEl = $state<HTMLElement | null>(null);
  let preview = $state<HeaderChipId[] | null>(null);
  let dragId = $state<HeaderChipId | null>(null);
  /** dragstart ~ dragend — `setTimeout 0` 이 dragend 뒤에 와도 빈자리를 세우지 않게 */
  let dragging: HeaderChipId | null = null;

  const shownOrder = $derived<readonly HeaderChipId[]>(preview ?? settings.headerChipOrder);
  const chips = $derived(shownOrder.map((id): ChipView => ({ id, ...CHIP_LOOK[id], name: t(NAME_KEY[id]) })));

  async function flip(change: () => void, pop: HeaderChipId | null = null): Promise<void> {
    const g = groupEl;
    const before = g ? measureLefts(g) : null;
    change();
    if (!g || !before) return;
    await tick();
    playFlip(g, before, pop);
  }

  function isOn(id: HeaderChipId): boolean {
    return !settings.headerChipsHidden.includes(id);
  }

  function tipOfChip(id: HeaderChipId): string {
    const name = t(NAME_KEY[id]);
    return isOn(id)
      ? t("settings.terminal.header_chips.tip.on", { name })
      : t("settings.terminal.header_chips.tip.off", { name });
  }

  function onKey(ev: KeyboardEvent, id: HeaderChipId): void {
    if (!ev.altKey || ev.ctrlKey || ev.shiftKey || ev.metaKey) return;
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    ev.preventDefault();
    ev.stopPropagation();
    const next = moveChip(settings.headerChipOrder, id, ev.key === "ArrowLeft" ? -1 : 1);
    if (next === settings.headerChipOrder) return;
    // 키를 받은 버튼이 keyed each 로 옮겨져도 같은 노드라 포커스가 남는다
    void flip(() => setHeaderChipOrder(next));
  }

  function onDragStart(ev: DragEvent, id: HeaderChipId): void {
    if (!ev.dataTransfer) return;
    ev.dataTransfer.effectAllowed = "move";
    ev.dataTransfer.setData(DRAG_TYPE, id);
    dragging = id;
    setTimeout(() => {
      if (dragging !== id) return;
      dragId = id;
      preview = [...settings.headerChipOrder];
    }, 0);
  }

  function onGroupDragOver(ev: DragEvent): void {
    if (dragId === null || preview === null || !groupEl) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "move";
    const id = dragId;
    const cur = preview;
    const idx = insertIndexAt(groupEl, cur.filter((x) => x !== id), ev.clientX);
    const next = moveChipTo(cur, id, idx);
    if (next.join() !== cur.join()) void flip(() => (preview = next));
  }

  function onGroupDrop(ev: DragEvent): void {
    if (dragId === null || preview === null) return;
    ev.preventDefault();
    const id = dragId;
    const order = preview;
    dragging = null;
    void flip(() => {
      setHeaderChipOrder(order);
      preview = null;
      dragId = null;
    }, id);
  }

  function onDragEnd(): void {
    dragging = null;
    if (dragId === null) return;
    void flip(() => {
      preview = null;
      dragId = null;
    });
  }

  function reset(): void {
    void flip(() => {
      resetHeaderChips();
      preview = null;
      dragId = null;
    });
  }
</script>

<div class="srow hc-row">
  <span class="name" id="{id}-label">{t("settings.terminal.header_chips.label")}</span>
  <button
    type="button"
    class="btn btn-sm btn-ghost hc-reset"
    title={t("settings.terminal.header_chips.reset_title")}
    onclick={reset}>{t("settings.terminal.header_chips.reset")}</button
  >
  <p class="hint" id="{id}-hint">{t("settings.terminal.header_chips.summary")}</p>
  <!-- 칩 묶음이 위치 기준(`position: relative`)이라 삽입 자리를 offsetLeft 로 잰다 -->
  <div class="hc-bar">
    <div
      class="hc-group"
      {id}
      role="group"
      aria-labelledby="{id}-label"
      aria-describedby="{id}-hint"
      bind:this={groupEl}
      ondragover={onGroupDragOver}
      ondrop={onGroupDrop}
    >
      {#each chips as c (c.id)}
        {@const on = isOn(c.id)}
        <button
          type="button"
          class="hchip hc-chip"
          class:off={!on}
          class:ghost={dragId === c.id}
          style:--c={c.color}
          data-flip-id={c.id}
          data-ai-tone={c.id === "ai" ? gaugeTone(AI_SAMPLE_AT) : undefined}
          draggable="true"
          aria-pressed={on}
          title={tipOfChip(c.id)}
          onclick={() => setHeaderChipShown(c.id, !on)}
          onkeydown={(ev) => onKey(ev, c.id)}
          ondragstart={(ev) => onDragStart(ev, c.id)}
          ondragend={onDragEnd}
        >
          {#if c.icon === null}<AiGaugeMini at={AI_SAMPLE_AT} />{:else}<UiIcon
              name={c.icon}
              size={HEAD_ICON_SIZE - 2}
            />{/if}
          <span class="hchip-t">{c.name}</span>
        </button>
      {/each}
    </div>
  </div>
</div>

<style>
  .srow > .hc-reset {
    grid-row: 1;
    align-self: start;
  }

  .srow > .hc-bar {
    grid-column: 1 / -1;
    grid-row: 3;
    justify-self: stretch;
  }

  .hc-bar {
    box-sizing: border-box;
    height: 36px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 0 6px; /* (36 − 테두리 2 − 칩 22) / 2 — 칩 알약이 막대 알약과 같은 중심의 끝을 갖는다 */
    background: var(--term-bg);
    --chip-ai-approve: var(--ai-term-lv2);
    --chip-ai-auto: var(--ai-term-lv3);
    --chip-ai-all: var(--ai-term-lv4);
    --ai-lv2: var(--ai-term-lv2);
    --ai-lv3: var(--ai-term-lv3);
    --ai-lv4: var(--ai-term-lv4);
    border: 1px solid var(--line);
    border-radius: 999px; /* 칩과 같은 알약(2026-10-19) */
    overflow-x: auto;
  }

  .hc-group {
    position: relative;
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .hc-chip {
    /* 머리줄 터미널 칩과 같은 판 짙기(`.pane-head.term` 의 12% · 18%) */
    --chip-tint: 12%;
    --chip-tint-hover: 18%;
    height: 22px;
    padding: 0 10px; /* 알약은 양 끝이 깎여 머리줄(8px)보다 한 치수 넓힌다 */
    gap: 5px;
    border-radius: 999px; /* 머리줄 칩과 같은 End-4 식 알약(2026-10-19 — 병합 때 6px 네모가 남았다) */
    cursor: grab;
  }

  .hc-chip:active {
    cursor: grabbing;
  }

  .hc-chip.off {
    --c: color-mix(in srgb, var(--term-fg) 45%, transparent) !important;
    background: transparent;
  }

  /* 단계 색이 남으면 켜진 칩처럼 읽힌다 */
  .hc-chip.off {
    --ai-c: var(--c);
  }

  .hc-chip.off:hover {
    background: color-mix(in srgb, var(--c) var(--chip-tint), transparent);
  }

  .hc-chip.ghost {
    visibility: hidden;
  }

</style>
