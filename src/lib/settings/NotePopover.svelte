<script lang="ts">
  import { placeTooltip } from "$lib/tooltip";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { closeNote, openNote } from "$lib/settings/note-popover.svelte.js";

  /**
   * 설정 · 호스트 폼의 ⓘ 설명 팝오버 — 그 ⓘ 가 자기 설정 화면 안에 있을 때만 그린다(설정이 독과 고정 타일에 둘 떠 있어도 한 벌).
   * `position: fixed` 로 앉힌다 — 본문 · 독의 overflow 에 `absolute` 는 잘린다. `document.body` 포털은 쓰지 않는다
   * (Svelte 5 가 블록을 걷을 때 옮긴 노드의 형제를 끌고 갈 수 있다 — `UsageHoverCard` 머리말).
   * 호스트 폼은 `{#if}` 로 통째로 뜨고 지므로 `active` 는 늘 참이고, 닫힘은 폼 쪽 `$effect` 가 맡는다.
   */
  let { active }: { active: boolean } = $props();

  let rootEl = $state<HTMLElement | null>(null);
  let popEl = $state<HTMLElement | null>(null);
  const MAX_W = 340;

  const cur = $derived.by(() => {
    const c = openNote();
    const root = rootEl?.parentElement;
    return c && root?.contains(c.anchor) ? c : null;
  });

  function widthFor(): number {
    const view = rootEl?.parentElement;
    if (!view) return MAX_W;
    const cs = getComputedStyle(view);
    const inner = view.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Math.max(160, Math.min(MAX_W, Math.floor(inner)));
  }

  $effect(() => {
    const c = cur;
    const el = popEl;
    if (!c || !el) return;
    // 자리는 손으로 적는다 — 상태로 돌리면 보이기(`visibility`)가 다음 그리기까지 늦어 포커스를 못 준다
    el.style.visibility = "hidden";
    const a = c.anchor.getBoundingClientRect();
    if (a.width === 0 && a.height === 0) {
      closeNote();
      return;
    }
    el.style.width = `${widthFor()}px`;
    const p = placeTooltip(
      { left: a.left, top: a.top, width: a.width, height: a.height },
      { width: el.offsetWidth, height: el.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    el.style.left = `${p.left}px`;
    el.style.top = `${p.top}px`;
    el.style.visibility = "visible";
    el.scrollTop = 0;
    el.focus({ preventScroll: true });
  });

  // 캡처 단계라 누른 곳의 동작은 그대로 산다 — 연 ⓘ 자신의 클릭은 ⓘ 의 토글이 받는다.
  $effect(() => {
    const c = cur;
    if (!c) return;
    const onDown = (ev: PointerEvent) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (popEl?.contains(t) || c.anchor.contains(t)) return;
      closeNote();
    };
    // 스크롤은 버블하지 않으므로 캡처로 조상 패널의 것까지 잡는다. 팝오버 안의 스크롤은 제외.
    const onScroll = (ev: Event) => {
      if (ev.target instanceof Node && popEl?.contains(ev.target)) return;
      closeNote();
    };
    const onResize = () => closeNote();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  });

  // 켜짐 → 꺼짐 으로 바뀔 때만 닫는다 — 고정 타일의 `open` 은 포커스까지 뜻해 포커스 없는 타일에서 ⓘ 를 누르는 순간에도 꺼져 있을 수 있다.
  let wasActive = false;
  $effect(() => {
    const now = active;
    if (wasActive && !now) closeNote();
    wasActive = now;
  });

  $effect(() => {
    if (veilVisible() && cur) closeNote();
  });

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape") return;
    // 설정 모달의 Escape(= 닫기)로 새지 않게 여기서 끊는다
    ev.preventDefault();
    ev.stopPropagation();
    closeNote(true);
  }
</script>

<!-- 자리 표시용 빈 칸 — 이것의 부모가 곧 이 팝오버가 책임지는 설정 화면이다 -->
<span class="note-pop-root" bind:this={rootEl} hidden></span>

{#if cur}
  <div
    id={cur.id}
    class="note-pop"
    role="dialog"
    aria-label={cur.label}
    tabindex="-1"
    bind:this={popEl}
    onkeydown={onKeydown}
  >
    {@render cur.note()}
  </div>
{/if}

<style>
  /* 비치지 않는 바탕이라 뒤의 설정 글자와 겹쳐 읽히지 않는다 */
  .note-pop {
    position: fixed;
    z-index: 111;
    box-sizing: border-box;
    max-height: 260px;
    overflow-y: auto;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--fg-2);
    word-break: keep-all;
    white-space: normal;
    text-align: left;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
    user-select: text;
    cursor: auto;
    left: 0;
    top: 0;
    visibility: hidden;
  }

  .note-pop:focus {
    outline: none;
  }

  .note-pop :global(strong) {
    color: var(--fg-1);
  }

  .note-pop :global(code) {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
  }
</style>
