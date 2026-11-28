<script lang="ts">
  /**
   * 권한 모드 메뉴 — 줄은 `view.choices` 뿐이다. 칩 밖 모드(bypass · 묻지 않기 · Codex custom)는 맨 위 고를 수 없는 줄로만 보인다.
   * 고르기는 부르는 쪽의 `runOnMenu`(스냅숏 → 닫기 → 실행)를 탄다 — 이 메뉴는 값을 넘기기만 한다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { nextMenuIndex } from "$lib/browser/toolbar-tools";
  import { cliModeWord, type ChatModeView } from "$lib/chat-tile/chat-tile-mode";
  import type { Key } from "$lib/i18n/keys";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    cli,
    view,
    trigger,
    touch = false,
    onpick,
    onclose,
  }: {
    cli: "claude" | "codex";
    view: ChatModeView;
    trigger: HTMLElement;
    touch?: boolean;
    onpick: (mode: string) => void;
    /** `back` = 칩으로 포커스를 돌린다 */
    onclose: (back: boolean) => void;
  } = $props();

  const EDGE = 8;
  const MAX_W = 320;
  let el = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  let width = $state<number | null>(null);

  const ICON: Readonly<Record<string, string>> = { default: "shield-check", readOnly: "shield-check", acceptEdits: "edit", plan: "list-checks", auto: "zap" };

  function desc(mode: string): string {
    return t(`pane.chatTile.mode.${cli}.${mode}` as Key);
  }

  function place(): void {
    const node = el;
    if (!node) return;
    const r = trigger.getBoundingClientRect();
    // 왼쪽 끝을 입력 칸 상자(`FlipComposer` 의 `.wrap`)에 맞춘다 — 칩은 그 상자의 아랫줄 왼쪽이다
    const box = trigger.closest("[data-flip-composer] .wrap")?.getBoundingClientRect() ?? null;
    if (box) width = Math.min(MAX_W, box.width, window.innerWidth - 2 * EDGE);
    const w = box && width !== null ? width : node.offsetWidth;
    const h = node.offsetHeight;
    const start = box ? box.left : r.left;
    left = Math.max(EDGE, Math.min(start, window.innerWidth - EDGE - w));
    // 입력 칸 상자 위에 — 친 글을 덮지 않게(자리가 모자라면 칩 아래 · 화면 안)
    const above = (box ? box.top : r.top) - 4 - h;
    top = above >= EDGE ? above : Math.min(r.bottom + 4, Math.max(EDGE, window.innerHeight - EDGE - h));
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(node);
      const cur = node.querySelector<HTMLElement>('button[data-chat-tile-mode][aria-checked="true"]');
      (cur ?? node.querySelector<HTMLElement>("button") ?? node).focus({ preventScroll: true });
      return () => ro.disconnect();
    });
  });

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
      onclose(false);
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) {
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextMenuIndex(
      ev.key,
      at,
      buttons.map((b) => b.disabled),
    );
    if (next >= 0) buttons[next]?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="cmm menu-surface"
  class:touch
  role="menu"
  aria-label={t("pane.chatTile.mode.menu")}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{top}px{width !== null ? `;width:${width}px;min-width:0;max-width:none` : ''}"
  onkeydown={onKey}
  data-chat-tile-mode-menu={cli}
>
  {#if view.foreign && view.current !== null}
    <div class="menu-row cmm-row foreign" role="menuitemradio" aria-checked="true" aria-disabled="true" data-chat-tile-mode-foreign={view.current}>
      <span class="cmm-icon warn" aria-hidden="true"><UiIcon name="warning" size={14} /></span>
      <span class="cmm-text">
        <span class="cmm-word">{t("pane.chatTile.mode.foreign", { mode: cliModeWord(view.current) })}</span>
        <span class="cmm-desc">{t("pane.chatTile.mode.foreignNote")}</span>
      </span>
      <span class="cmm-check" aria-hidden="true"><UiIcon name="check" size={14} /></span>
    </div>
    <hr class="menu-sep" />
  {/if}
  {#each view.choices as m (m)}
    {@const on = m === view.current}
    <button type="button" class="menu-row cmm-row" role="menuitemradio" aria-checked={on} data-chat-tile-mode={m} onclick={() => onpick(m)}>
      <span class="cmm-icon" class:accent={m !== "default" && m !== "readOnly"} aria-hidden="true"><UiIcon name={ICON[m] ?? "shield-check"} size={14} /></span>
      <span class="cmm-text">
        <span class="cmm-word">{cliModeWord(m)}</span>
        <span class="cmm-desc">{desc(m)}</span>
      </span>
      <span class="cmm-check" aria-hidden="true">{#if on}<UiIcon name="check" size={14} />{/if}</span>
    </button>
  {/each}
  {#if cli === "codex"}
    <div class="cmm-note" data-chat-tile-mode-next>{t("pane.chatTile.mode.codexNext")}</div>
  {/if}
</div>

<style>
  .cmm {
    position: fixed;
    z-index: 41;
    box-sizing: border-box;
    width: max-content;
    min-width: 240px;
    max-width: min(340px, calc(100vw - 16px));
  }

  .cmm-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: auto;
    min-height: 40px;
    padding-top: 5px;
    padding-bottom: 5px;
    white-space: normal;
  }

  .cmm.touch .cmm-row {
    min-height: 48px;
  }

  .cmm-row.foreign {
    cursor: default;
  }

  .cmm-row.foreign:hover {
    background: transparent;
  }

  .cmm-icon {
    flex: none;
    width: 22px;
    height: 22px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-2);
    background: var(--control-tile-bg);
    border-radius: 50%;
  }

  .cmm-icon.accent {
    color: var(--on-accent);
    background: var(--accent);
  }

  .cmm-icon.warn {
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 16%, transparent);
  }

  .cmm-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    line-height: 1.3;
  }

  .cmm-word {
    font-weight: var(--fw-semibold);
  }

  .cmm-desc {
    font-size: var(--t-xs);
    color: var(--fg-2);
    white-space: normal;
    word-break: keep-all;
    overflow-wrap: anywhere;
  }

  .cmm-check {
    flex: none;
    width: 16px;
    display: inline-flex;
    justify-content: center;
    color: var(--fg-2);
  }

  .cmm-note {
    padding: var(--space-1) var(--space-3) var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }
</style>
