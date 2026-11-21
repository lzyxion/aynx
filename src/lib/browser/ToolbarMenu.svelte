<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import { nextMenuIndex, type ToolbarMenuRow } from "$lib/browser/toolbar-tools";

  /**
   * 고른 열쇠만 올린다 — 스냅샷 → 닫기 → 실행 순서는 부르는 쪽의 `runOnMenu` 가 든다(docs/conventions.md "메뉴를 닫는 코드").
   * 다룬 키는 전파를 끊는다 — 창 전역의 파일 타일 키(`file-keys.ts`)가 같은 ↑↓ 로 목록 선택을 움직이지 않게.
   */

  let {
    label,
    rows,
    trigger,
    align,
    onpick,
    /** `true` 면 단추로 포커스를 돌려준다 */
    onclose,
    onback,
    touch = false,
  }: {
    label: string;
    rows: readonly ToolbarMenuRow[];
    trigger: HTMLElement;
    align: "left" | "right";
    onpick: (key: string) => void;
    onclose: (back: boolean) => void;
    onback?: () => void;
    touch?: boolean;
  } = $props();

  const EDGE = 8;

  let el = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);

  $effect(() => {
    const node = el;
    if (!node) return;
    const r = trigger.getBoundingClientRect();
    const w = node.offsetWidth;
    const h = node.offsetHeight;
    const want = align === "right" ? r.right - w : r.left;
    left = Math.max(EDGE, Math.min(want, window.innerWidth - EDGE - w));
    const below = r.bottom + 4;
    top = below + h > window.innerHeight - EDGE ? Math.max(EDGE, r.top - 4 - h) : below;
    if (!node.contains(document.activeElement)) {
      const cur = node.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
      const first = node.querySelector<HTMLButtonElement>("button:not(:disabled)");
      (cur ?? first ?? node).focus({ preventScroll: true });
    }
  });

  /** 연 단추만 비켜 간다 — 그 단추의 click 이 닫기를 맡는다 */
  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (el?.contains(t) || trigger.contains(t)) return;
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

  function onKey(ev: KeyboardEvent) {
    const node = el;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose(true);
      return;
    }
    if (ev.key === "Tab") {
      onclose(false); // 포커스는 Tab 이 옮긴다 — 여기서 또 옮기면 서로 낚아챈다
      return;
    }
    if (ev.key === "ArrowRight" || ev.key === "ArrowLeft") {
      const at = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
      const row = at ? rows.find((r) => r.key === at.dataset.menuKey) : undefined;
      if (ev.key === "ArrowRight" && row?.more !== undefined && !row.disabled) {
        ev.preventDefault();
        ev.stopPropagation();
        onpick(row.key);
      } else if (ev.key === "ArrowLeft" && onback) {
        ev.preventDefault();
        ev.stopPropagation();
        onback();
      }
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) {
      // 맨 글자는 메뉴 안에서 끝낸다 — 목록의 "글자 쳐서 고르기" 가 메뉴 뒤에서 선택을 옮기지 않게.
      // 수식 조합(`Ctrl+1/2/3` · `Ctrl+I`)과 기능 키(`F11`)는 그대로 올려 보낸다 — 열린 채로도 먹는다.
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    const buttons = Array.from(node.querySelectorAll<HTMLButtonElement>("button[data-menu-key]"));
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next = nextMenuIndex(
      ev.key,
      at,
      buttons.map((b) => b.disabled),
    );
    if (next >= 0) buttons[next]?.focus();
  }

  function role(row: ToolbarMenuRow): string {
    if (row.checked === undefined) return "menuitem";
    return row.radio ? "menuitemradio" : "menuitemcheckbox";
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="tb-menu menu-surface"
  class:touch
  role="menu"
  aria-label={label}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{top}px"
  onkeydown={onKey}
  data-toolbar-menu
>
  {#each rows as row (row.key)}
    {#if row.sep}<hr class="menu-sep" />{/if}
    <button
      type="button"
      class="tb-row menu-row"
      class:danger={row.danger}
      role={role(row)}
      aria-checked={row.checked}
      aria-haspopup={row.more !== undefined ? "menu" : undefined}
      data-menu-key={row.key}
      disabled={row.disabled}
      title={row.title}
      onclick={() => onpick(row.key)}
    >
      <!-- `.menu-mark` 안에는 공백도 넣지 않는다 — inline-flex 칸이라 공백 노드가 그림을 민다(`PaneMenu` 와 같은 규칙) -->
      {#if row.pane}
        <span class="menu-mark tb-pane"><PaneIcon pane={row.pane} size={14} /></span>
      {:else if row.logo}
        <span class="menu-mark"><HostIcon icon={row.logo} size={14} mono /></span>
      {:else if row.icon}
        <span class="menu-mark"><UiIcon name={row.icon} size={14} /></span>
      {/if}
      {#if row.code}
        <span class="tb-label tb-named"><span class="tb-name">{row.label}</span><span class="tb-code">{row.code}</span></span>
      {:else}
        <span class="tb-label">{row.label}</span>
      {/if}
      {#if row.hint}<kbd class="menu-kbd">{row.hint}</kbd>{/if}
      {#if row.more !== undefined}
        {#if row.more}<span class="menu-kbd tb-more">{row.more}</span>{/if}
        <span class="tb-check" aria-hidden="true"><UiIcon name="chevron" size={14} /></span>
      {:else}
        <span class="tb-check" aria-hidden="true"
          >{#if row.checked}<UiIcon name="check" size={14} />{/if}</span
        >
      {/if}
    </button>
  {/each}
</div>

<style>
  .tb-menu {
    position: fixed;
    z-index: 41;
    min-width: 180px;
    max-width: 260px;
  }

  .tb-row {
    display: flex;
    align-items: center;
  }

  .tb-label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 원격 AI 타일은 로고 둘이라 16px 칸을 넘는다 */
  .tb-pane {
    width: auto;
    min-width: 16px;
  }

  .tb-named {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
  }
  .tb-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tb-code {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }

  .tb-more {
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .tb-menu.touch .tb-row {
    height: 44px;
  }

  /* 비어 있어도 폭을 차지한다 — 켜진 줄과 안 켜진 줄의 단축키가 같은 x 에 선다 */
  .tb-check {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    margin-left: var(--space-2);
    color: var(--fg-2);
  }
</style>
