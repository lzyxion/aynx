<script lang="ts">
  /** 상자(`root`) 안의 보이는 글자를 CSS Custom Highlight 로 칠하는 찾기 띠 — DOM 은 한 글자도 바꾸지 않는다(그린 블록 · 선택 · 스크롤이 그대로다) */
  import { onDestroy, tick, untrack } from "svelte";
  import FindBar from "$lib/FindBar.svelte";
  import { firstFrom, revealOffset, stepMatch } from "$lib/doc-find";
  import { clearFind, findRanges, paintFind } from "$lib/doc-find-dom";

  let {
    root,
    scroller,
    label,
    onclose,
  }: {
    root: HTMLElement | null;
    /** 찾을 때마다 묻는다 — 보기마다 상자가 다를 수 있다. `scrollIntoView` 는 조상까지 밀어서 쓰지 않는다 */
    scroller: () => HTMLElement | null;
    label: string;
    /** 부르는 쪽이 [`close`] 로 닫으면 오지 않는다 */
    onclose?: () => void;
  } = $props();

  let open = $state(false);
  let query = $state("");
  let caseSensitive = $state(false);
  let count = $state(0);
  let index = $state(-1);
  let bar = $state<ReturnType<typeof FindBar> | null>(null);
  let hits: Range[] = [];
  const owner = {};
  let frame = 0;
  let jumpNext = false;

  export function isOpen(): boolean {
    return open;
  }

  export function show(): boolean {
    if (!root) return false;
    open = true;
    void tick().then(() => bar?.focus());
    return true;
  }

  /** 부르는 쪽이 닫을 때 — `onclose` 는 부르지 않는다 */
  export function close(): void {
    if (!open) return;
    open = false;
    watched = null;
    clearFind(owner);
    hits = [];
    count = 0;
    index = -1;
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
    jumpNext = false;
  }

  function closeByUser(): void {
    close();
    onclose?.();
  }

  function schedule(jump: boolean): void {
    jumpNext ||= jump;
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      const j = jumpNext;
      jumpNext = false;
      refind(j);
    });
  }

  /** 글이 다시 그려진 것이면(`jump` 아님) 고른 번호를 지키고 밀지 않는다 — 자동 새로고침 · 따라가기가 읽던 자리를 끌고 가지 않게 */
  function refind(jump: boolean): void {
    if (!open) return;
    if (!root) {
      hits = [];
      count = 0;
      index = -1;
      paintFind(owner, [], null);
      return;
    }
    hits = findRanges(root, query, caseSensitive);
    count = hits.length;
    if (jump) {
      const box = scroller();
      const base = box ? box.getBoundingClientRect().top : 0;
      index = firstFrom(count, (i) => hits[i].getBoundingClientRect().top - base, 0);
    } else {
      index = count === 0 ? -1 : Math.min(Math.max(index, 0), count - 1);
    }
    paintFind(owner, hits, hits[index] ?? null);
    if (jump) reveal();
  }

  function step(dir: 1 | -1): void {
    if (count === 0) return;
    index = stepMatch(index, count, dir);
    paintFind(owner, hits, hits[index] ?? null);
    reveal();
  }

  function reveal(): void {
    const r = hits[index];
    const box = scroller();
    if (!r || !box) return;
    const rr = r.getBoundingClientRect();
    const br = box.getBoundingClientRect();
    box.scrollTo({
      top: revealOffset(box.scrollTop, box.clientHeight, rr.top - br.top + box.scrollTop, rr.height),
      left: revealOffset(box.scrollLeft, box.clientWidth, rr.left - br.left + box.scrollLeft, rr.width),
    });
  }

  $effect(() => {
    void query;
    void caseSensitive;
    if (!open) return;
    untrack(() => schedule(true));
  });

  let watched: HTMLElement | null = null;
  $effect(() => {
    const el = root;
    if (!open) return;
    if (el !== watched) {
      watched = el;
      untrack(() => schedule(true));
    }
    if (!el) return;
    const mo = new MutationObserver(() => schedule(false));
    mo.observe(el, { childList: true, subtree: true, characterData: true });
    return () => mo.disconnect();
  });

  onDestroy(() => {
    if (frame) cancelAnimationFrame(frame);
    clearFind(owner);
  });
</script>

{#if open}
  <FindBar bind:this={bar} bind:query bind:caseSensitive {count} {index} {label} onstep={step} onclose={closeByUser} />
{/if}
