<script lang="ts">
  import { placeTooltip } from "$lib/tooltip";
  import { veilVisible } from "$lib/app/veil.svelte.js";
  import { closeNote, openNote } from "$lib/settings/note-popover.svelte.js";

  /**
   * 설정의 ⓘ 설명을 그리는 **팝오버 한 벌** (docs/log/2026-09-28-settings-note-popover.md).
   *
   * 호스트 폼(`HostForm.svelte`)도 제 모달 뿌리에 한 벌을 세운다 — 규칙은 같고 "설정 화면" 을
   * "호스트 폼 모달" 로 읽으면 된다(docs/log/2026-09-28-hostform-note-popover.md). 그 폼은
   * `{#if}` 로 통째로 뜨고 지므로 `active` 는 늘 참이고, 닫힘은 폼 쪽 `$effect` 가 맡는다.
   *
   * `SettingsModal` 의 뿌리(`.settings-view`)에 하나 선다. 무엇을 그릴지는 모듈 칸
   * (`note-popover.svelte.ts`)이 쥐고, 이 컴포넌트는 **그 ⓘ 가 자기 설정 화면 안에 있을 때만**
   * 그린다 — 설정이 독과 고정 타일에 둘 떠 있어도 팝오버는 한 벌이다.
   *
   * ## 자리 — `position: fixed` · 잘리지 않는다
   *
   * 설정 본문(`.settings-panel`)은 `overflow-y: auto`, 독은 `overflow: hidden` 이라 `absolute`
   * 면 잘린다. 고르개(`Dropdown`)와 같은 길로 화면 좌표에 앉힌다 — 독은 여닫이가 끝나면
   * `transform` 을 남기지 않으므로 `fixed` 의 기준 상자는 창이다(`Dock.svelte` 의 여닫이 주석).
   * `document.body` 포털은 쓰지 않는다(Svelte 5 가 블록을 걷을 때 옮긴 노드의 형제를 끌고
   * 갈 수 있다 — `UsageHoverCard` 머리말).
   *
   * 두 걸음이다: 투명하게 그려 높이를 재고, `placeTooltip`(아래가 기본 · 모자라면 위로
   * 뒤집기 · 가로는 창 안으로 민다)으로 자리를 잡은 뒤 보인다. 폭은 `min(설정 화면 안쪽 폭,
   * 340px)`, 높이는 260px 을 넘으면 팝오버 자신이 스크롤한다.
   *
   * ## 닫히는 길
   *
   * ⓘ 다시 누르기 · Esc(포커스가 ⓘ 로 돌아간다) · 바깥 누르기 · 다른 ⓘ 열기(칸이 하나라 갈아
   * 끼워진다) · 설정 본문 스크롤과 창 크기 바꾸기(따라다니지 않고 닫는다 — `Dropdown` 과 같다) ·
   * 설정이 안 보이게 될 때(`SettingsModal` 의 `open`) · 가림막.
   */
  let { active }: { active: boolean } = $props();

  let rootEl = $state<HTMLElement | null>(null);
  let popEl = $state<HTMLElement | null>(null);
  const MAX_W = 340;

  /** 이 설정 화면 안의 ⓘ 가 연 것만 — 다른 설정 화면(독 ↔ 고정 타일)의 것은 그쪽이 그린다 */
  const cur = $derived.by(() => {
    const c = openNote();
    const root = rootEl?.parentElement;
    return c && root?.contains(c.anchor) ? c : null;
  });

  /** 폭 — 설정 화면의 안쪽 폭과 340px 중 좁은 쪽 */
  function widthFor(): number {
    const view = rootEl?.parentElement;
    if (!view) return MAX_W;
    const cs = getComputedStyle(view);
    const inner = view.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    return Math.max(160, Math.min(MAX_W, Math.floor(inner)));
  }

  // 열리면(또는 다른 ⓘ 로 갈아 끼워지면) 재고 → 앉히고 → 포커스를 준다.
  $effect(() => {
    const c = cur;
    const el = popEl;
    if (!c || !el) return;
    // 자리는 손으로 적는다 — 상태로 돌리면 보이기(`visibility`)가 다음 그리기까지 늦어 포커스를 못 준다
    el.style.visibility = "hidden";
    const a = c.anchor.getBoundingClientRect();
    if (a.width === 0 && a.height === 0) {
      closeNote(); // ⓘ 가 이미 안 보인다 (섹션이 갈렸다)
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

  // 바깥을 누르면 닫는다 — 캡처 단계라 누른 곳의 동작은 그대로 산다(다른 ⓘ 는 곧장 열린다).
  // 연 ⓘ 자신은 제외한다: 그 클릭은 ⓘ 의 토글이 받는다.
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

  // 설정이 안 보이게 되면(독이 닫힘 · 고정 타일이 가려짐) 닫는다. **켜짐 → 꺼짐** 으로 바뀔
  // 때만 본다 — 고정 타일의 `open` 은 "보이고 포커스도 가진" 뜻이라, 포커스 없는 타일에서 ⓘ 를
  // 누르는 순간에도 꺼져 있을 수 있다(그때 곧장 닫으면 팝오버가 뜨지 못한다).
  let wasActive = false;
  $effect(() => {
    const now = active;
    if (wasActive && !now) closeNote();
    wasActive = now;
  });

  // 가림막이 내려오면 닫는다 (다른 뜬 상자들과 같다 — `RemoteChip` 의 상자)
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
  <!--
    비모달 대화상자 — 포커스를 받아 화살표·PgUp/PgDn 으로 긴 설명을 스크롤하고, Esc 로 닫는다.
    Tab 으로 빠져나가면 그대로 둔다(바깥 누르기·스크롤이 닫는다).
  -->
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
  /*
   * 뜬 면 한 벌 — 메뉴·툴팁과 같은 토큰(`--surface-raised-solid` · `--line-strong` ·
   * `--shadow-raised`). 비치지 않는 바탕이라 뒤의 설정 글자와 겹쳐 읽히지 않는다.
   * 글자는 예전 펼친 전문(`.hint`)과 같은 크기·색이다.
   */
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
    /* 재는 동안은 안 보인다 — 자리를 잡으면 스크립트가 켠다 */
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
