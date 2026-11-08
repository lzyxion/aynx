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
   * **설정 › 터미널 "타일 머리줄 칩"** (2026-10-18 — 목업 E5yfAAq5XawDLGCjhSAH4U, 사용자 확정) — 머리줄 모양 막대 하나에 칩 일곱을
   * 샘플 글자로 늘어놓고, **누르면 켬/끔 · 끌면 순서**를 바꾼다(키보드는 칩에 포커스를 두고 `Alt+←/→`). 모양은 진짜 머리줄 칩
   * 한 벌(`pane/header-chip.css` 의 `.hchip` · `theme.css` 의 `--chip-*`)이고, 끈 칩은 판을 걷고 흐린 글자로 선다.
   *
   * 끌기(HTML5 drag): 끌기 그림이 찍힌 **뒤에**(`setTimeout 0` — 같은 틱에 숨기면 끌기가 취소된다) 원래 칩을 `visibility:hidden`
   * 으로 비워 자리(폭)만 남긴다. 커서 x 와 다른 칩의 배치상 중심을 비교해 삽입 자리를 정하고, **미리 보기 순서**(`preview`)를
   * 바꿔 빈자리가 놓일 곳으로 옮겨 간다 — 강조선은 없다. 이웃 칩은 FLIP(`$lib/flip`)으로 밀려나고, 놓으면 그 칩이 내려앉으며
   * 순서가 저장된다. 줄 밖에 놓거나 Esc 면 drop 없이 dragend 만 오고 원래 순서로 미끄러져 돌아간다.
   *
   * `Alt+←/→` 는 전역에서 타일 포커스 이동(`focus-left/right`)이다 — 그 처리는 창의 **버블 단계**라, 칩의 keydown 이 먼저 받아
   * `stopPropagation` 하면 타일 포커스가 움직이지 않는다. 전역 단축키로 등록하지 않는다(이 줄 안에서만의 뜻이다).
   */

  /** 칩 묶음의 `id` — 설정 색인 anchor(`settings-index.ts` 의 `header-chips`). `{id}-label` · `{id}-hint` 도 여기서 나온다 */
  let { id }: { id: string } = $props();

  type ChipView = { id: HeaderChipId; icon: string | null; color: string; name: string };

  /**
   * AI 권한 칩의 샘플 단계 — 승인 후 실행(Ask). 진짜 칩처럼 그림 자리에 **미니 게이지**(`AiGaugeMini`)가 서고, 칩 판 · 글자는 그 자리의 색
   * (`data-ai-tone` — 막대의 `--ai-c` 도 여기서 나온다)이다.
   */
  const AI_SAMPLE_AT = gaugeIndex(AI_STAGES, "approve");

  /**
   * 칩마다의 그림 · 색 — `pane/HeaderChips` 의 그 칩과 같다. 터미널 타일 머리줄(10-20 개편)처럼 칩은 **터미널 글자색**(`--term-fg`)이고,
   * 단계를 말하는 신호인 AI 권한 칩만 제 색을 둔다(`PaneHeader` 의 `.pane-head.term` 과 같은 규칙). 글자는 실제 값 샘플이 아니라 **칩 이름**이다
   * (10-18 사용자 — 샘플(`aynx` · `3.2% · 412 MB` …)이면 막대가 넘쳐 가로 스크롤이 생겼다). 그림이 `null` 이면 AI 권한 칩이다 — 그림 자리에
   * 진짜 칩과 같은 미니 게이지(아래 `AI_SAMPLE_AT`)가 선다(10-23). AI 권한 칩 하나가 원격 · 쿼리 · 로컬 타일을 함께 켜고 끈다
   * (10-23 — 예전 따로 선 로컬 'AI 읽기' 칩 `ai_read` 를 합쳤다. 옛 설정의 옮기기는 `$lib/header-chips` 의 `migrateLegacyChips`).
   */
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
  /** 끄는 동안 보이는 순서(끄는 칩이 들어갈 자리가 이미 비어 있다) — 끌지 않을 때는 `null` */
  let preview = $state<HeaderChipId[] | null>(null);
  /** 끄는 중인 칩(빈자리로 보인다) */
  let dragId = $state<HeaderChipId | null>(null);
  /** dragstart ~ dragend — `setTimeout 0` 이 dragend 뒤에 와도 빈자리를 세우지 않게 */
  let dragging: HeaderChipId | null = null;

  const shownOrder = $derived<readonly HeaderChipId[]>(preview ?? settings.headerChipOrder);
  const chips = $derived(shownOrder.map((id): ChipView => ({ id, ...CHIP_LOOK[id], name: t(NAME_KEY[id]) })));

  /** 상태를 바꾸고(`change`) 바뀐 자리로 미끄러지게 — `pop` 은 방금 놓인 칩 */
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

  // 줄 밖에 놓았거나 Esc — drop 없이 끝났으면 원래 순서로 미끄러져 돌아간다
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
  <!-- 머리줄 모양 막대 — 칩 묶음만 둔다(10-18 사용자: 타일 이름 샘플 없이). 칩 묶음이 위치 기준(`position: relative`)이라 삽입 자리를 offsetLeft 로 잰다 -->
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
  /* [기본값] — 이름 줄 오른쪽 위 */
  .srow > .hc-reset {
    grid-row: 1;
    align-self: start;
  }

  /* 막대는 두 칸을 다 쓰는 셋째 줄 */
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
    /* 막대 = 터미널 타일 머리줄 — 터미널 바탕 위에 칩(10-20 개편: 머리줄이 터미널 바탕을 그대로 비춘다) */
    background: var(--term-bg);
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

  /* 설정 줄의 칩은 누르고 끄는 손잡이라 머리줄 칩보다 한 치수 크다(목업 22px) */
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

  /* 끔 — 판을 걷고 흐린 글자. 손을 얹으면 회색 판이 한 단 선다 */
  .hc-chip.off {
    --c: color-mix(in srgb, var(--term-fg) 45%, transparent) !important;
    background: transparent;
  }

  /* 끈 AI 권한 칩 — 게이지의 찬 막대도 흐린 글자색으로(단계 색이 남으면 켜진 칩처럼 읽힌다) */
  .hc-chip.off {
    --ai-c: var(--c);
  }

  .hc-chip.off:hover {
    background: color-mix(in srgb, var(--c) var(--chip-tint), transparent);
  }

  /* 끄는 칩 — 자리(폭)만 남긴다. 그 빈자리가 곧 놓일 자리다 */
  .hc-chip.ghost {
    visibility: hidden;
  }

</style>
