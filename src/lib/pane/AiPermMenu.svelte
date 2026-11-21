<script lang="ts" generics="S extends string">
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGauge from "$lib/AiGauge.svelte";
  import { closeOnOutside, menuKeydown } from "$lib/pane/chip-menu.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import type { PermStageRow } from "$lib/pane/ai-perm-menu.svelte.js";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * 머리줄 AI 권한 팝오버 — 원격 타일(호스트 하나의 단계)과 쿼리 타일(DB 연결 하나의 단계)이 같은 상자를 쓴다.
   * 저장 · 대상은 모른다 — 고른 결과를 올리기만 하고, 저장과 `runOnMenu` 통로는 `ai-perm-menu.svelte.ts` · `db-ai-menu.svelte.ts` 가 든다.
   */
  let {
    title,
    sub,
    /** 원격 타일 머리줄에는 코드 칩이 없어 권한을 만지는 자리에서 "AI 가 이 코드로 본다" 를 맞춘다 */
    code,
    /** 낮은 것부터 */
    stages,
    /** `null` 이면 고른 표시가 없다(DB 연결의 대상이 바뀌어 권한이 풀렸을 때 — 다시 고르게 한다) */
    stage,
    notes = [],
    /** 원격만 */
    headless = null,
    settingsLabel = null,
    left,
    top,
    onpick,
    onsettings,
    onclose,
  }: {
    title: string;
    sub: string;
    code: string;
    stages: readonly PermStageRow<S>[];
    stage: S | null;
    notes?: readonly string[];
    headless?: { on: boolean; allowed: boolean; onchange: (on: boolean) => void } | null;
    settingsLabel?: string | null;
    left: number;
    top: number;
    onpick: (stage: S) => void;
    onsettings?: () => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  const stageIds = $derived(stages.map((s) => s.id));
  const rowOf = (id: S): PermStageRow<S> => stages.find((s) => s.id === id)!;
  const yolo = $derived(stage !== null && stages.length > 0 && stages[stages.length - 1].id === stage);

  let el = $state<HTMLElement | null>(null);

  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  $effect(() => {
    const node = el;
    const t = shownTop;
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (t > max) {
      clamped = Math.max(8, max);
      return;
    }
    if (!node.contains(document.activeElement)) {
      // 게이지의 고른 단추에 포커스 — ←→ 가 곧바로 돈다
      const cur = node.querySelector<HTMLButtonElement>("[data-gauge-stop]") ?? node.querySelector<HTMLButtonElement>("[data-ai-item]");
      (cur ?? node).focus({ preventScroll: true });
    }
  });

  /** 권한 칩만 비켜 간다 — 누름이 먼저 닫고 뒤따르는 click 이 다시 열지 않게 */
  $effect(() => closeOnOutside(() => el, "[data-ai-menu-btn]", onclose));

  function onKey(ev: KeyboardEvent) {
    menuKeydown(ev, el, "[data-gauge-stop], [data-ai-item]:not(:disabled), .headless input:not(:disabled)", onclose);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="aimenu menu-surface"
  class:yolo
  role="menu"
  aria-label={title}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
  data-ai-menu
>
  <div class="head">
    <div class="title-row">
      <p class="title">{title}</p>
      <span class="code" data-ai-menu-code>{code}</span>
    </div>
    <p class="sub">{sub}</p>
    {#each notes as note (note)}
      <p class="note" role="note" data-ai-menu-note>{note}</p>
    {/each}
  </div>

  <div class="gauge-row">
    <AiGauge
      levels={stageIds}
      value={stage}
      nameOf={(id) => tr(rowOf(id).name)}
      descOf={(id) => tr(rowOf(id).desc)}
      label={title}
      compact
      onpick={(id) => onpick(id)}
    />
  </div>

  {#if headless}
    {@const h = headless}
    <hr class="menu-sep" />

    <!-- 헤드리스 접속 — 단계가 승인 후 실행 아래면 잠긴다(켤 수 없다) -->
    <label class="headless" class:locked={!h.allowed} title={tr("app.ai.headless.desc")}>
      <span class="text">
        <span class="name">{tr("app.ai.headless")}</span>
        <span class="desc">{tr("app.ai.headless.desc")}</span>
      </span>
      <span class="switch">
        <Toggle
          checked={h.on && h.allowed}
          disabled={!h.allowed}
          label={tr("app.ai.headless")}
          onchange={(v) => h.onchange(v)}
        />
      </span>
    </label>
  {/if}

  {#if settingsLabel}
    <hr class="menu-sep" />

    <button type="button" class="menu-row link" role="menuitem" data-ai-item onclick={() => onsettings?.()}>
      <span>{settingsLabel}</span>
      <span class="menu-kbd"><UiIcon name="chevron" size={12} /></span>
    </button>
  {/if}
</div>

<style>
  .aimenu {
    position: fixed;
    z-index: 20;
    width: 320px;
    max-width: calc(100vw - 16px);
    max-height: 80vh;
    overflow-y: auto;
  }

  .head {
    padding: var(--space-1) var(--space-2) var(--space-2);
  }

  .title-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .code {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }

  .title {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    margin: 2px 0 0;
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--fg-3);
  }

  .note {
    margin: var(--space-1) 0 0;
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--warn);
    word-break: keep-all;
  }

  .gauge-row {
    padding: 0 var(--space-2) var(--space-2);
  }

  /* 전역 `.menu-surface` 보다 특이도가 높아야 한다 */
  .aimenu.yolo {
    border-color: var(--ai-all-line);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    font-size: var(--t-sm);
    line-height: 1.3;
  }

  .desc {
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--fg-3);
    word-break: keep-all;
  }

  .headless {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: 6px var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .headless .text {
    flex: 1;
  }

  .headless.locked {
    cursor: default;
  }

  .headless.locked .name {
    color: var(--fg-3);
  }

  .switch {
    flex: none;
    margin-top: 2px;
  }

  .link {
    display: flex;
    align-items: center;
    color: var(--fg-2);
  }
</style>
