<script lang="ts" module>
  /** `value` 는 보낼 줄의 재료 — 부르는 쪽이 허용 목록으로 거른다 */
  export interface FlipModelRow {
    value: string;
    label: string;
    checked: boolean;
  }
</script>

<script lang="ts">
  /**
   * AI 타일 대화 면의 모델 메뉴 — 누름만 올린다. 보내는 줄은 부르는 쪽이 `pane/flip-model.ts` 의 허용 목록으로 짓는다(불변식 4).
   * Codex 게이지에 Default 고리가 없는 것은 한 줄로 되돌리는 명령이 없어서다.
   * `document.body` 로 옮겨 그린다 — 카드 뒤집기(`transform`) 상자 안에서는 `position: fixed` 의 기준이 창이 아니고, 대화 면의 캡처 단계 키가 메뉴 키를 먼저 가로챈다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import ChatEffortGauge from "$lib/chat/ChatEffortGauge.svelte";
  import { effortName } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    cli,
    models,
    levels,
    effort,
    ring,
    note,
    trigger,
    touch = false,
    onmodel,
    oneffort,
    onclose,
  }: {
    cli: string;
    models: readonly FlipModelRow[];
    levels: readonly string[];
    /** `""` = Default 고리(ring 일 때) */
    effort: string;
    ring: boolean;
    note: string;
    trigger: HTMLElement;
    touch?: boolean;
    onmodel: (value: string) => void;
    oneffort: (level: string) => void;
    /** 참이면 연 단추로 포커스 */
    onclose: (back: boolean) => void;
  } = $props();

  const EDGE = 8;
  const labelId = `flip-models-${Math.random().toString(36).slice(2, 8)}`;
  const anyChecked = $derived(models.some((m) => m.checked));

  let el = $state<HTMLElement | null>(null);

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
  let left = $state(0);
  let top = $state(0);

  function place(): void {
    const node = el;
    if (!node) return;
    const r = trigger.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    left = Math.max(EDGE, Math.min(r.right - w, window.innerWidth - EDGE - w));
    const above = r.top - 4 - h;
    top = above < EDGE ? Math.min(r.bottom + 4, window.innerHeight - EDGE - h) : above;
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(node);
      const cur = node.querySelector<HTMLElement>('[data-flip-model][aria-checked="true"]');
      (cur ?? node.querySelector<HTMLElement>("[data-flip-model], [data-chat-effort][tabindex='0']") ?? node).focus({ preventScroll: true });
      return () => ro.disconnect();
    });
  });

  /** 연 단추만 비켜 간다 — 그 단추의 click 이 닫기를 맡는다 */
  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (el?.contains(target) || trigger.contains(target)) return;
      onclose(false);
    };
    const onResize = () => onclose(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  });

  function onKey(ev: KeyboardEvent): void {
    const node = el;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose(true);
      return;
    }
    if (ev.key === "Tab") {
      const stops = Array.from(node.querySelectorAll<HTMLElement>('button[tabindex="0"]'));
      if (stops.length === 0) return;
      const i = stops.indexOf(document.activeElement as HTMLElement);
      const next = ev.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : i < 0 || i >= stops.length - 1 ? 0 : i + 1;
      ev.preventDefault();
      ev.stopPropagation();
      stops[next].focus({ preventScroll: true });
      return;
    }
    // 뒤의 입력 칸 · 대화 면 키가 받지 않게
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
  }

  function rove(ev: KeyboardEvent): void {
    if (ev.key !== "ArrowUp" && ev.key !== "ArrowDown" && ev.key !== "Home" && ev.key !== "End") return;
    const list = Array.from(el?.querySelectorAll<HTMLElement>("[data-flip-model]") ?? []);
    if (list.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = list.length - 1;
    else if (ev.key === "ArrowDown") next = i < 0 || i >= list.length - 1 ? 0 : i + 1;
    else next = i <= 0 ? list.length - 1 : i - 1;
    list[next].focus({ preventScroll: true });
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="fm menu-surface"
  class:touch
  role="dialog"
  aria-label={t("pane.flip.model.menu")}
  tabindex="-1"
  bind:this={el}
  use:portal
  style="left:{left}px;top:{top}px"
  onkeydown={onKey}
  data-flip-model-menu={cli}
>
  {#if models.length > 0}
    <div class="label" id={labelId}>{t("app.chatDock.model.label")}</div>
    <div class="models" role="radiogroup" aria-labelledby={labelId}>
      {#each models as m, i (m.value)}
        <button
          type="button"
          role="radio"
          class="row menu-row"
          aria-checked={m.checked}
          tabindex={m.checked || (!anyChecked && i === 0) ? 0 : -1}
          data-flip-model={m.value}
          onkeydown={rove}
          onclick={() => onmodel(m.value)}
        >
          <span class="row-label">{m.label}</span>
          <span class="check" aria-hidden="true">{#if m.checked}<UiIcon name="check" size={14} />{/if}</span>
        </button>
      {/each}
    </div>
    <hr class="menu-sep" />
  {/if}
  <ChatEffortGauge {levels} value={effort} nameOf={(e) => (e ? effortName(e) : ring ? effortName("") : "")} noDefault={!ring} {touch} onpick={(e) => oneffort(e)} />
  <p class="note" data-flip-model-note>{note}</p>
</div>

<style>
  /* `ChatModelPopover` 와 같은 층 · 같은 폭 */
  .fm {
    position: fixed;
    z-index: 41;
    box-sizing: border-box;
    width: min(288px, calc(100vw - 16px));
    max-height: calc(100vh - 16px);
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-2);
    overflow: hidden;
  }

  .label {
    flex: none;
    padding: 2px var(--space-3) 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .models {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
  }

  .fm.touch .row {
    height: 44px;
  }

  .note {
    margin: 0;
    padding: 0 var(--space-3) 2px;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .row-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .check {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    color: var(--control-sel-fg);
  }

  .row[aria-checked="true"] {
    font-weight: var(--fw-semibold);
  }
</style>
