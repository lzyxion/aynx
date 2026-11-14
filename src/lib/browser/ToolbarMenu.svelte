<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import HostIcon from "$lib/HostIcon.svelte";
  import { nextMenuIndex, type ToolbarMenuRow } from "$lib/browser/toolbar-tools";

  /**
   * **파일 타일 도구줄의 접힌 메뉴** — 좁은 타일에서 보기 셋(▦ ▾)과 오른쪽 단추들(⋯)이 여는 작은 목록 (2026-10-11).
   *
   * 줄 = [그림][이름 ……… 단축키][✓]. 그림 칸은 단추에 있던 그 그림이고, ✓ 는 **오른쪽 끝 칸**이다(워크스페이스 목록과
   * 같은 자리 — 앞자리는 이미 그림이 차지한다). 토글은 `menuitemcheckbox`, 보기는 `menuitemradio` 다.
   *
   * 모양은 전역 메뉴 한 벌(`theme.css` 의 `.menu-*`), 몸짓은 `AiPermMenu` · `PaneMenu` 와 같다: 뜨면 지금 것(없으면
   * 첫 줄)에 포커스 · ↑↓ Home End 로 돌고 · Enter/Space 는 단추가 받고 · Escape 와 고르기는 단추로 포커스를 돌려주고 ·
   * 바깥을 누르면 그냥 닫는다. 이 컴포넌트는 고른 **열쇠**만 올린다 — 스냅샷 → 닫기 → 실행 순서는 부르는 쪽의
   * `runOnMenu` 가 든다 (docs/conventions.md "메뉴를 닫는 코드").
   *
   * 다룬 키는 전파를 끊는다 — 창 전역의 파일 타일 키(`file-keys.ts`)가 같은 ↑↓ 로 목록 선택을 움직이지 않게.
   *
   * 하위 갈래(2026-11-13 — 사이드 채팅 `[+]`): `more` 가 있는 줄은 오른쪽 끝에 흐린 글자 + `›` 이고 → 로도 고른다. ← 는 `onback` 을 부른다
   * (부르는 쪽이 줄을 바꾼다 — 갈래마다 이 메뉴를 다시 세우면 포커스가 새 줄로 간다). `touch`(폰)는 줄 높이 44px.
   */

  let {
    label,
    rows,
    /** 연 단추 — 자리를 재는 기준이자, 바깥 클릭 판정에서 비켜 갈 곳이다(다시 누르면 닫히는 토글) */
    trigger,
    /** 단추의 어느 쪽 끝에 맞출까 — 왼쪽 무리의 보기 고르개는 왼쪽, 오른쪽 끝의 ⋯ 는 오른쪽 */
    align,
    onpick,
    /** 닫아 달라 — `true` 면 단추로 포커스를 돌려준다 */
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
    /** ← — 하위 갈래에서 뿌리로(없으면 ← 는 아무 일도 없다) */
    onback?: () => void;
    /** 터치 화면(폰) — 줄 44px */
    touch?: boolean;
  } = $props();

  /** 화면 가장자리와 띄울 틈 */
  const EDGE = 8;

  let el = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);

  /**
   * 자리 — 단추 바로 아래, `align` 쪽 끝을 맞춘다. 그려진 폭을 재야 오른쪽 맞춤이 되므로 붙은 뒤에 한 번 잰다.
   * 창 밖으로 넘치면 안으로 당긴다(아래로 넘치면 단추 위로 올린다).
   */
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

  /** 바깥을 누르면 닫는다 — 연 단추만 비켜 간다(그 단추의 click 이 닫기를 맡는다). 창 크기가 바뀌어도 닫는다 */
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
      {#if row.logo}
        <span class="menu-mark"><HostIcon icon={row.logo} size={14} mono /></span>
      {:else if row.icon}
        <span class="menu-mark"><UiIcon name={row.icon} size={14} /></span>
      {/if}
      <span class="tb-label">{row.label}</span>
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
  /* 상자·줄·구분선은 전역 메뉴 한 벌 — 자리와 폭만 여기. 타일 우클릭 메뉴(`FileMenu`)와 같은 층 */
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

  /* 하위 갈래 줄의 오른쪽 흐린 글자(지금 연결 이름 · MCP 수) — 길면 말줄임 */
  .tb-more {
    min-width: 0;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 폰 — 손가락 크기(44px) */
  .tb-menu.touch .tb-row {
    height: 44px;
  }

  /* ✓ 칸 — 비어 있어도 폭을 차지한다(켜진 줄과 안 켜진 줄의 단축키가 같은 x 에 선다) */
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
