<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { ClockOptions } from "$lib/start-clock";

  /**
   * **위젯 위 우클릭 메뉴** (2026-11-03) — 그 위젯의 설정과 편집 모드 입구만 둔다(판을 고치는 되돌리기 · 레이아웃 리셋은
   * 빈 자리의 판 메뉴 · 편집 중 판 위 단추 줄에 — 사용자 결정).
   *  · 시계면 `24시간` · `12시간` — 하나만(`menuitemradio`) / `초 표시` · `날짜 표시` — 켜고 끄기(`menuitemcheckbox`)
   *  · 평소(잠김)에만 `배치 편집` — 편집 중에는 줄이 없다(나오기는 판 위 [완료] · Esc). 시계 아닌 위젯을 편집 중에 우클릭하면
   *    줄이 하나도 없으니 `StartPage` 가 이 메뉴를 띄우지 않는다.
   * 고른 줄은 오른쪽 끝 ✓ 칸(파일 타일 도구줄의 접힌 메뉴 `ToolbarMenu` 와 같은 자리 · 같은 모양).
   *
   * 상자 · 자리 · 키는 판 메뉴(`StartBoardMenu`)와 같다 — 앱 메뉴 한 벌(`.menu-surface` · `.menu-row` · `.menu-sep`),
   * `document.body` 로 옮겨 그림, 화면 밖으로 넘치지 않게 죄기, ↑↓ 로 돌기 · Escape 로 닫기. 항목 핸들러는 **메뉴 통로 하나**를
   * 지난다(`$lib/browser/menu-runner` · docs/conventions.md 의 "메뉴를 닫는 코드"): 스냅샷 → 닫기 → 실행. 새 표시는 스냅샷
   * 순간의 `clock` 으로 셈해 콜백 인자로 넘긴다(닫힌 뒤의 값을 읽지 않게).
   */
  let {
    x,
    y,
    clock,
    editing,
    onclose,
    onpick,
    onedit,
  }: {
    /** 연 자리(창 좌표 — 우클릭한 포인터) */
    x: number;
    y: number;
    /** 시계 위젯이면 지금 고른 표시 — 아니면 `null`(표시 옵션 줄이 없다) */
    clock: Readonly<ClockOptions> | null;
    /** 편집 모드인가 — 편집 중이면 [배치 편집] 줄이 없다 */
    editing: boolean;
    onclose: () => void;
    /** 새 시계 표시 — 메뉴가 닫힌 **뒤** 불린다 */
    onpick: (next: ClockOptions) => void;
    /** 편집 모드로 들어가기 — 판 메뉴의 [배치 편집]과 같은 동작 */
    onedit: () => void;
  } = $props();

  let menuEl = $state<HTMLElement | null>(null);

  /** 이 노드를 `body` 끝으로 옮긴다(`StartBoardMenu` 와 같은 까닭) — 사라질 때 함께 걷는다 */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // 커서 자리에 띄우되 화면 밖으로 넘치지 않게(판 메뉴와 같은 클램프)
  $effect(() => {
    if (!menuEl) return;
    const r = menuEl.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  // 뜨면 지금 고른 시간 표기 줄(없으면 첫 줄)에 포커스(`ToolbarMenu` 와 같은 몸짓)
  $effect(() => {
    if (!menuEl) return;
    const cur = menuEl.querySelector<HTMLElement>('[role="menuitemradio"][aria-checked="true"]');
    (cur ?? items(menuEl)[0])?.focus();
  });

  function items(box: HTMLElement): HTMLElement[] {
    return [...box.querySelectorAll<HTMLElement>('[role^="menuitem"]')].filter((el) => !(el as HTMLButtonElement).disabled);
  }

  function onKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
      return;
    }
    if ((ev.key === "ArrowDown" || ev.key === "ArrowUp") && menuEl) {
      ev.preventDefault();
      ev.stopPropagation();
      const list = items(menuEl);
      const i = list.indexOf(document.activeElement as HTMLElement);
      const next = ev.key === "ArrowDown" ? (i + 1) % list.length : (i - 1 + list.length) % list.length;
      list[next]?.focus();
    }
  }

  /** 시계 줄 하나 — 스냅샷(지금 표시로 셈한 새 표시) → 닫기 → 실행 */
  function pick(change: (cur: Readonly<ClockOptions>) => ClockOptions) {
    const cur = clock;
    if (!cur) return;
    runOnMenu(() => change(cur), onclose, (next) => onpick(next));
  }
</script>

{#snippet check(on: boolean)}
  <span class="check" aria-hidden="true">{#if on}<UiIcon name="check" size={14} />{/if}</span>
{/snippet}

<div class="portal" use:portal>
  <button
    type="button"
    class="menu-backdrop"
    tabindex="-1"
    aria-label={t("files.menu.close.aria")}
    onclick={onclose}
    oncontextmenu={(ev) => {
      ev.preventDefault();
      onclose();
    }}
  ></button>
  <div
    class="widget-menu menu-surface"
    role="menu"
    tabindex="-1"
    aria-label={t(clock ? "app.start.clock.menu.aria" : "app.start.widget.menu.aria")}
    data-start-widget-menu={clock ? "clock" : "widget"}
    style:left="{x}px"
    style:top="{y}px"
    bind:this={menuEl}
    onkeydown={onKeydown}
  >
    {#if clock}
      <button
        type="button"
        class="menu-row row"
        role="menuitemradio"
        aria-checked={!clock.hour12}
        data-clock-menu="h24"
        onclick={() => pick((cur) => ({ ...cur, hour12: false }))}
      >
        <span class="label">{t("app.start.clock.menu.h24")}</span>
        {@render check(!clock.hour12)}
      </button>
      <button
        type="button"
        class="menu-row row"
        role="menuitemradio"
        aria-checked={clock.hour12}
        data-clock-menu="h12"
        onclick={() => pick((cur) => ({ ...cur, hour12: true }))}
      >
        <span class="label">{t("app.start.clock.menu.h12")}</span>
        {@render check(clock.hour12)}
      </button>
      <div class="menu-sep" role="separator"></div>
      <button
        type="button"
        class="menu-row row"
        role="menuitemcheckbox"
        aria-checked={clock.seconds}
        data-clock-menu="seconds"
        onclick={() => pick((cur) => ({ ...cur, seconds: !cur.seconds }))}
      >
        <span class="label">{t("app.start.clock.menu.seconds")}</span>
        {@render check(clock.seconds)}
      </button>
      <button
        type="button"
        class="menu-row row"
        role="menuitemcheckbox"
        aria-checked={clock.date}
        data-clock-menu="date"
        onclick={() => pick((cur) => ({ ...cur, date: !cur.date }))}
      >
        <span class="label">{t("app.start.clock.menu.date")}</span>
        {@render check(clock.date)}
      </button>
    {/if}
    {#if !editing}
      {#if clock}<div class="menu-sep" role="separator"></div>{/if}
      <button
        type="button"
        class="menu-row row"
        role="menuitem"
        data-widget-menu-edit
        onclick={() => runAfterClose(onclose, onedit)}
      >
        <span class="label">{t("app.start.board.edit.start")}</span>
        {#if clock}<span class="check" aria-hidden="true"></span>{/if}
      </button>
    {/if}
  </div>
</div>

<style>
  .portal {
    display: contents;
  }

  /* 바깥 클릭을 받아 닫는 투명 백드롭 — 판 메뉴와 같은 층 */
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 105;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  .widget-menu {
    position: fixed;
    z-index: 106;
    min-width: 160px;
    max-width: 260px;
  }

  .row {
    display: flex;
    align-items: center;
  }

  .label {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ✓ 칸 — 비어 있어도 폭을 차지한다(`ToolbarMenu` 의 `.tb-check` 와 같은 칸) */
  .check {
    display: inline-flex;
    flex: none;
    align-items: center;
    justify-content: center;
    width: 16px;
    margin-left: var(--space-2);
    color: var(--fg-2);
  }
</style>
