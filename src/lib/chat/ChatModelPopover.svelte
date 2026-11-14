<script lang="ts">
  /**
   * **모델 메뉴**(2026-11-13 — 사이드 채팅 입력 칸의 모델 키워드가 연다 · 목업 D2) — 한 상자에 셋: 맨 위 **CLI 스위치**(세그먼트 — 고를 수 있는
   * CLI 만), 가운데 **모델 목록**(CLI 기본 · 정한 순서 · [직접 입력…] — 누르면 그 줄이 이름 칸이 된다), 아래 **Effort 게이지**(`ChatEffortGauge`
   * — 강도를 받지 않는 모델이면 없다). 확인하지 않은 CLI 버전이면 맨 위에 경고 한 줄.
   *
   * 고른 뒤에도 **열려 있다**(모델과 Effort 를 한 번에) — 닫기는 Esc(연 단추로 포커스를 돌려준다) · 바깥 누르기 · 창 크기 바뀜. 고르기의 몸은
   * `SideChatControls`(메뉴 통로를 지난다)이고 이 상자는 누름만 넘긴다.
   *
   * 키보드: 뜨면 고른 모델 줄에 포커스 · Tab 은 묶음(CLI · 모델 · Effort) 사이를 돌고 상자 밖으로 새지 않는다 · CLI 는 ←→ 로 옮겨 Enter/Space
   * 로 고른다(바꾸면 프로세스를 다시 연다 — 옮기기만으로 고르지 않는다) · 모델은 ↑↓ · Effort 는 ←→ 로 곧바로 고른다(산 프로세스에 곧바로).
   * 자리는 `ToolbarMenu` 와 같은 셈(연 단추의 오른쪽 끝에 맞추고 · 아래로 넘치면 위로 · 창 안으로 당김) — 폰에서도 화면 밖으로 나가지 않는다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import ChatEffortGauge from "$lib/chat/ChatEffortGauge.svelte";
  import { aiIconName } from "$lib/pane-icons";
  import { effortName, type SideChatControls } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    ctl,
    trigger,
    touch = false,
  }: {
    ctl: SideChatControls;
    /** 연 단추(모델 키워드) — 자리의 기준 · 바깥 누르기에서 비켜 갈 곳 */
    trigger: HTMLElement;
    /** 폰 — 줄 44px */
    touch?: boolean;
  } = $props();

  const EDGE = 8;
  const labelId = `models-${Math.random().toString(36).slice(2, 8)}`;

  let el = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  const chat = $derived(ctl.chat);

  /** 자리 — 연 단추의 오른쪽 끝에 맞추고 아래(넘치면 위)에. 붙은 뒤 · 내용이 바뀌어 높이가 달라질 때마다 다시 잰다 */
  function place(): void {
    const node = el;
    if (!node) return;
    const r = trigger.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    left = Math.max(EDGE, Math.min(r.right - w, window.innerWidth - EDGE - w));
    const below = r.bottom + 4;
    top = below + h > window.innerHeight - EDGE ? Math.max(EDGE, r.top - 4 - h) : below;
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    // 붙을 때 한 번만 — 자리 재기가 읽는 것(연 단추 등)에 매이면 고를 때마다 다시 돌아 포커스를 모델 줄로 빼앗았다(하네스 ⑦)
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(node);
      // 첫 포커스 — 고른 모델 줄(없으면 첫 줄)
      const cur = node.querySelector<HTMLElement>('[data-chat-model][aria-checked="true"]');
      (cur ?? node.querySelector<HTMLElement>("[data-chat-model]") ?? node).focus({ preventScroll: true });
      return () => ro.disconnect();
    });
  });

  /** 바깥을 누르면 닫는다 — 연 단추만 비켜 간다(그 단추의 click 이 닫기를 맡는다). 창 크기가 바뀌어도 닫는다 */
  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (el?.contains(target) || trigger.contains(target)) return;
      ctl.closeModel(false);
    };
    const onResize = () => ctl.closeModel(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  });

  /** [직접 입력…] 칸이 서면 그 칸에 포커스 */
  $effect(() => {
    if (ctl.customOpen && inputEl) {
      inputEl.focus({ preventScroll: true });
      inputEl.select();
    }
  });

  function onKey(ev: KeyboardEvent): void {
    const node = el;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      ctl.closeModel(true);
      return;
    }
    if (ev.key === "Tab") {
      // 상자 안에서 돈다 — 묶음마다 Tab 에 걸린 것 하나(고른 것)
      const stops = Array.from(node.querySelectorAll<HTMLElement>('button[tabindex="0"], input')).filter((x) => !x.hasAttribute("disabled"));
      if (stops.length === 0) return;
      const i = stops.indexOf(document.activeElement as HTMLElement);
      const next = ev.shiftKey ? (i <= 0 ? stops.length - 1 : i - 1) : i < 0 || i >= stops.length - 1 ? 0 : i + 1;
      ev.preventDefault();
      ev.stopPropagation();
      stops[next].focus({ preventScroll: true });
      return;
    }
    // 맨 글자는 상자 안에서 끝낸다(뒤의 목록 · 칸이 받지 않게) — 수식 조합은 그대로 올려 보낸다
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
  }

  /** 줄 묶음 안 화살표 — 포커스만 옮긴다(끝에서 돈다). `sel` = 그 묶음의 단추 */
  function rove(ev: KeyboardEvent, sel: string, keys: readonly [string, string]): void {
    if (ev.key !== keys[0] && ev.key !== keys[1] && ev.key !== "Home" && ev.key !== "End") return;
    const list = Array.from(el?.querySelectorAll<HTMLElement>(sel) ?? []);
    if (list.length === 0) return;
    ev.preventDefault();
    ev.stopPropagation();
    const i = list.indexOf(document.activeElement as HTMLElement);
    let next: number;
    if (ev.key === "Home") next = 0;
    else if (ev.key === "End") next = list.length - 1;
    else if (ev.key === keys[1]) next = i < 0 || i >= list.length - 1 ? 0 : i + 1;
    else next = i <= 0 ? list.length - 1 : i - 1;
    list[next].focus({ preventScroll: true });
  }

  function onCustomKey(ev: KeyboardEvent): void {
    if (ev.isComposing) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      ctl.commitCustom();
      // 칸이 걷혔다 — 새로 고른 줄(또는 [직접 입력…])로 포커스
      requestAnimationFrame(() => {
        const node = el;
        const cur = node?.querySelector<HTMLElement>('[data-chat-model][aria-checked="true"]');
        (cur ?? node?.querySelector<HTMLElement>("[data-chat-model-custom]"))?.focus({ preventScroll: true });
      });
    } else if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation(); // 메뉴를 닫지 않는다 — 입력만 그만둔다
      ctl.cancelCustom();
      requestAnimationFrame(() => el?.querySelector<HTMLElement>("[data-chat-model-custom]")?.focus({ preventScroll: true }));
    }
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="mp menu-surface"
  class:touch
  role="dialog"
  aria-label={t("app.chatDock.chip.menu")}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{top}px"
  onkeydown={onKey}
  data-chat-model-menu
>
  {#if ctl.untested}
    <p class="warn" role="note" data-chat-untested><UiIcon name="warning" size={14} /><span>{t("app.chatDock.chip.untested", { v: ctl.untested })}</span></p>
  {/if}

  {#if chat}
    <!-- CLI 스위치 — 세그먼트(고를 수 있는 CLI 만). 옮기기는 ←→ · 고르기는 Enter/Space(프로세스를 다시 연다) -->
    <div class="seg-group" role="radiogroup" aria-label={t("app.chatDock.cli.aria")} style:--seg-n={Math.max(1, ctl.offered.length)}>
      {#each ctl.offered as x (x.id)}
        {@const on = x.id === chat.cli}
        {@const name = aiIconName(x.id)}
        <button
          type="button"
          role="radio"
          class="seg"
          class:on
          aria-checked={on}
          tabindex={on ? 0 : -1}
          data-chat-cli={x.id}
          onkeydown={(ev) => rove(ev, "[data-chat-cli]", ["ArrowLeft", "ArrowRight"])}
          onclick={() => ctl.pickCli(x.id)}
        >
          {#if name}<AiGlyph {name} size={14} mono />{:else}<UiIcon name="ai" size={14} />{/if}
          <span class="seg-name">{x.name}</span>
        </button>
      {/each}
    </div>

    <div class="label" id={labelId}>{t("app.chatDock.model.label")}</div>
    <div class="models" role="radiogroup" aria-labelledby={labelId}>
      {#each ctl.models as m (m.value)}
        <button
          type="button"
          role="radio"
          class="row menu-row"
          aria-checked={m.checked}
          tabindex={m.checked ? 0 : -1}
          data-chat-model={m.value}
          onkeydown={(ev) => rove(ev, "[data-chat-model], [data-chat-model-custom]", ["ArrowUp", "ArrowDown"])}
          onclick={() => ctl.pickModel(m.value)}
        >
          <span class="row-label">{m.label}</span>
          <span class="check" aria-hidden="true">{#if m.checked}<UiIcon name="check" size={14} />{/if}</span>
        </button>
      {/each}
      {#if ctl.customOpen}
        <input
          class="custom menu-input"
          bind:this={inputEl}
          bind:value={ctl.customText}
          aria-label={t("app.chatDock.chip.custom.aria")}
          aria-invalid={!ctl.customOk}
          title={ctl.customOk ? t("app.chatDock.chip.custom.aria") : t("app.chatDock.chip.custom.bad")}
          placeholder={t("app.chatDock.cliDefault")}
          spellcheck="false"
          autocomplete="off"
          data-chat-model-input
          onkeydown={onCustomKey}
          onblur={() => ctl.cancelCustom()}
        />
      {:else}
        <button
          type="button"
          class="row menu-row dim"
          tabindex={ctl.models.some((m) => m.checked) ? -1 : 0}
          data-chat-model-custom
          onkeydown={(ev) => rove(ev, "[data-chat-model], [data-chat-model-custom]", ["ArrowUp", "ArrowDown"])}
          onclick={() => ctl.startCustom()}><span class="row-label">{t("app.chatDock.chip.custom")}</span></button
        >
      {/if}
    </div>

    {#if ctl.effortShown}
      <hr class="menu-sep" />
      <ChatEffortGauge levels={ctl.efforts} value={chat.effort} nameOf={effortName} {touch} onpick={(e) => ctl.pickEffort(e)} />
    {/if}
  {/if}
</div>

<style>
  /* 상자 · 줄 · 구분선은 전역 메뉴 한 벌 — 폭과 자리만 여기. 메뉴(`ToolbarMenu`)와 같은 층 */
  .mp {
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

  .warn {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin: 0;
    padding: var(--space-1) var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .warn :global(svg) {
    flex: none;
    margin-top: 1px;
    color: var(--warn);
  }

  /* CLI 스위치 — 낮은 면 알약 안 같은 폭 칸(독 갈래 · MD3 세그먼트와 같은 말 — 고른 칸 = secondaryContainer) */
  .seg-group {
    flex: none;
    display: grid;
    grid-template-columns: repeat(var(--seg-n), minmax(0, 1fr));
    gap: 2px;
    padding: 3px;
    background: var(--m3-surface-container-low);
    border-radius: 999px;
  }

  .seg {
    min-width: 0;
    height: 30px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--control-fg);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .seg:not(.on):hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .seg.on {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  .seg:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .seg-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .label {
    flex: none;
    padding: 2px var(--space-3) 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 모델 줄 — 넘치면 이 칸만 굴린다(상자는 굴리지 않는다 — 글래스 흐림 층이 밀리지 않게) */
  .models {
    flex: 0 1 auto;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .row {
    display: flex;
    align-items: center;
    height: 32px;
  }

  .mp.touch .row,
  .mp.touch .seg {
    height: 44px;
  }

  .row-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row.dim {
    color: var(--fg-2);
  }

  .check {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    margin-left: var(--space-2);
    color: var(--control-sel-fg);
  }

  .row[aria-checked="true"] {
    font-weight: var(--fw-semibold);
  }

  /* [직접 입력…] 칸 — 줄 자리에 같은 높이 */
  .custom {
    box-sizing: border-box;
    width: 100%;
    height: 32px;
    margin: 0;
  }

  .mp.touch .custom {
    height: 44px;
  }

  .custom[aria-invalid="true"] {
    border-color: var(--err);
  }
</style>
