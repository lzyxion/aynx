<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { closeOnOutside, menuKeydown } from "$lib/pane/chip-menu.svelte.js";
  import {
    forwardBrowserUrl,
    forwardKindFlag,
    forwardLabel,
    forwardStateLabel,
    isForwardActive,
    relayingConns,
    type ForwardInfo,
  } from "$lib/forward";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * **포워딩 목록 메뉴** (2026-10-11) — 머리줄 **포워딩 칩**이 연다(주 입구). ⋯ 메뉴의 "포트 포워딩…" 도 포워드가
   * 있으면 같은 상자를 연다 — 그쪽은 머리줄을 끈 사람(`[app] tile_header`)의 길이다.
   *
   * tmux 세션 목록(`TmuxMenu.svelte`)과 **같은 상자·같은 몸짓**이다: 칩 왼쪽 변 바로 아래에 서고, 바깥 클릭·창 크기
   * 변경·Escape 로 닫히며, ↑↓ · Home/End 로 줄의 버튼을 돈다. 모양은 전역 메뉴 한 벌(`.menu-surface` · `.menu-title` ·
   * `.menu-sep` · `.menu-row` · `.menu-mark`).
   *
   * ```text
   * web-01 · 포트 포워딩                 연결 2개 중계 중
   * ● -L 127.0.0.1:15432 → localhost:5432   활성 2   ↗ ×
   * ○ -D SOCKS 127.0.0.1:1080               대기 중      ×
   * ○ -R 원격 127.0.0.1:18080 → 내 PC …    대기 중      ×
   * ─────────────────────────────────────────────
   * +  포워딩 추가…
   * ```
   *
   * 줄 동작은 예전 포워딩 대화상자가 하던 것 **그대로**다 — [브라우저에서 열기](로컬 `-L` 만) · [중지]. 앱이 건 포워드
   * (에이전트 신호)는 표에 들어오지 않아 여기 오지 않는다(`$lib/forward` 의 `userForwards` · 2026-10-27). 맨 아래 "포워딩 추가…" 는 추가
   * 전용이 된 그 대화상자(`dialogs/ForwardDialog.svelte`)를 모달로 띄운다.
   *
   * ## 이 컴포넌트가 모르는 것
   *
   * 어느 타일이 대상인지, 누른 결과가 무엇을 하는지는 모른다. 줄의 값(포워드 · 주소)을 **인자로** 올리고
   * (`onstop` · `onbrowse` · `onadd`), 스냅샷 → 닫기 → 실행 순서는 `PaneHost` 의 통로(`runForwardMenu` → `runOnMenu`)가
   * 든다 (docs/conventions.md 의 "메뉴를 닫는 코드"). 목록은 칩과 같은 표(`app/forwards` 의 `forwardsOf`)라 반응형이다 —
   * 중지하면 줄이 빠지고, 0개가 되면 빈 안내 한 줄과 추가 줄만 남는다.
   */
  let {
    /** 머리글 = 대상 타일의 이름 */
    title,
    /** 이 타일의 세션에 살아 있는 포워드들 (칩과 같은 값) */
    forwards,
    left,
    top,
    onstop,
    onbrowse,
    onadd,
    onclose,
  }: {
    title: string;
    forwards: ForwardInfo[];
    left: number;
    top: number;
    /** 그 포워드를 중지 */
    onstop: (f: ForwardInfo) => void;
    /** 로컬(-L) 포워드를 시스템 기본 브라우저로 */
    onbrowse: (url: string) => void;
    /** 추가 모달을 연다 */
    onadd: () => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  /** 뜨면 자신에 포커스 — ↑↓ 가 곧바로 돈다. 세로 넘침은 붙은 뒤 잰다 (`TmuxMenu` 와 같은 처방) */
  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  $effect(() => {
    const node = el;
    const at = shownTop;
    void forwards.length; // 줄 수가 바뀌면 높이가 달라진다 — 그때 다시 잰다
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (at > max) {
      clamped = Math.max(8, max);
      return;
    }
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });
  });

  /**
   * 바깥을 누르면 닫는다 — 단 **머리줄의 포워딩 칩만 비켜 간다**(`TmuxMenu` 의 `[data-tmux-menu-btn]` 과 같은 이유:
   * 여기서 닫아 버리면 뒤따르는 `click` 이 "열려 있지 않다" 를 보고 다시 연다). 칩의 `data-forward-chip` 을 그대로 쓴다.
   */
  $effect(() => closeOnOutside(() => el, "[data-forward-chip]", onclose));

  /** ↑↓·Home/End 로 버튼을 돌고 Escape 로 닫는다 — Escape 는 여기서 끊는다(뒤 화면까지 닫지 않게) */
  function onKey(ev: KeyboardEvent) {
    menuKeydown(ev, el, "button:not([disabled])", onclose);
  }

  /** 머리글 오른쪽 — 지금 중계 중인 연결이 있을 때만 (칩의 트래픽 점과 같은 값) */
  const relaying = $derived(relayingConns(forwards));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="fwmenu menu-surface"
  role="menu"
  aria-label={tr("pane.fwmenu.aria", { title })}
  tabindex="-1"
  data-forward-menu
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
>
  <div class="head">
    <p class="group menu-title">{tr("pane.fwmenu.group", { title })}</p>
    {#if relaying > 0}
      <span class="summary">{tr("pane.header.forward.relaying", { n: relaying })}</span>
    {/if}
  </div>

  {#if forwards.length === 0}
    <p class="note">{tr("app.forward.empty")}</p>
  {/if}
  <!--
    한 줄 = [상태 점][종류 -L/-R/-D][포트 → 대상][상태 문구][브라우저에서 열기][중지] — 예전 대화상자 목록의 한 줄과
    같은 재료다(누적 수만 뺐다: "지금 쓰이는가" 는 점과 상태 문구가 말한다). 줄 자체는 누르는 것이 아니고, 버튼만
    `menuitem` 이라 ↑↓ 가 버튼 사이를 돈다.
  -->
  {#each forwards as f (f.id)}
    {@const on = isForwardActive(f)}
    {@const label = forwardLabel(f, tr)}
    {@const url = forwardBrowserUrl(f)}
    <div class="row" data-forward-row={f.id}>
      <span
        class="dot"
        class:on
        title={on ? tr("app.forward.dot.active") : tr("app.forward.dot.idle")}
        aria-hidden="true"
      ></span>
      <span class="flag">{forwardKindFlag(f)}</span>
      <span class="route" title={label}>{label}</span>
      <span class="state" class:on>{forwardStateLabel(f, tr)}</span>
      {#if url !== null}
        <button
          type="button"
          class="side"
          role="menuitem"
          title={tr("app.forward.open")}
          aria-label={tr("pane.fwmenu.open.aria", { url })}
          onclick={() => onbrowse(url)}
        >
          <UiIcon name="external" size={13} />
        </button>
      {/if}
      <button
        type="button"
        class="side stop"
        role="menuitem"
        title={tr("app.forward.stop")}
        aria-label={tr("pane.fwmenu.stop.aria", { label })}
        onclick={() => onstop(f)}
      >
        <UiIcon name="close" size={13} />
      </button>
    </div>
  {/each}

  <hr class="menu-sep" />
  <!-- 마지막 줄은 목록과 상관없이 늘 있다 (tmux 목록의 "새 세션" 자리) -->
  <button type="button" class="add menu-row" role="menuitem" data-forward-add onclick={onadd}>
    <span class="menu-mark"><UiIcon name="plus" size={14} /></span>{tr(
      "pane.fwmenu.add",
    )}
  </button>
</div>

<style>
  /* 상자·머리글·구분선·그림 칸은 전역 메뉴 한 벌(`theme.css` 의 `.menu-*`) — `TmuxMenu` 와 같은 종류의 목록이다.
     폭만 넓다(줄에 주소 한 줄과 버튼 둘이 든다). */
  .fwmenu {
    position: fixed;
    z-index: 20;
    min-width: 280px;
    max-width: 400px;
    max-height: 60vh;
    overflow-y: auto;
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .group {
    flex: 1;
    min-width: 0;
  }

  /* 머리글 오른쪽 — 중계 중인 연결 수(초록 — 칩 점과 같은 말) */
  .summary {
    flex: none;
    padding-right: var(--space-2);
    font-size: var(--t-xs);
    color: var(--ok);
    font-variant-numeric: tabular-nums;
  }

  /* 빈 상태 — 누를 수 없는 한 줄 */
  .note {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  /* 한 줄 — 높이 30px(tmux 목록 줄과 같다). 줄은 누르는 것이 아니라 판이 없다; 버튼만 칠해진다 */
  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 30px;
    padding-left: var(--space-3); /* 머리글(`.menu-title`)과 같은 x */
    font-size: var(--t-sm);
    border-radius: var(--radius-row);
  }

  /* 상태 점 — 대기 중은 확실히 "꺼진" 인상이어야 초록이 튄다 (예전 대화상자의 점과 같은 값) */
  .dot {
    flex: none;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--fg-muted);
    opacity: 0.5;
  }

  .dot.on {
    background: var(--ok);
    opacity: 1;
  }

  /* 종류 — `-L` · `-R` · `-D`. 식별자라 mono, 흐린 톤 (주소 앞의 짧은 표) */
  .flag {
    flex: none;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: var(--fg-3);
  }

  /* 포트 → 대상 — mono, 남는 폭을 먹고 말줄임 (전체는 `title`) */
  .route {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    color: var(--fg-1);
  }

  .state {
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .state.on {
    color: var(--ok);
  }

  /* 줄 끝 작은 버튼 — tmux 목록의 `side` 와 같은 크기·같은 색 */
  .side {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 28px;
    min-height: 30px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-row); /* 칠은 메뉴 줄과 같은 알약 */
    cursor: pointer;
  }

  .side:hover,
  .side:focus-visible {
    color: var(--fg-1);
    background: var(--surface-hover);
    outline: none;
  }

  /* 중지 — 손이 닿으면 의미색 (되돌릴 수 없는 일이다 — 다시 걸어야 한다) */
  .side.stop:hover,
  .side.stop:focus-visible {
    color: var(--err);
  }

  /* 추가 줄 — `.menu-row` 는 block 이라 그림 칸과 글자를 가운데로 맞추려 flex 로 */
  .add {
    display: flex;
    align-items: center;
  }
</style>
