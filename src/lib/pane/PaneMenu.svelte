<script lang="ts">
  import { tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import {
    isGroup,
    rowId,
    type PaneFlyoutId,
    type PaneMenuAction,
    type PaneMenuRow,
  } from "$lib/pane/pane-menu";
  import {
    FLYOUT_CLOSE_MS,
    FLYOUT_EST_ROW,
    FLYOUT_EST_WIDTH,
    FLYOUT_OPEN_MS,
    flyoutKeyAction,
    placeFlyout,
  } from "$lib/menu-flyout";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * **타일 ⋯ 메뉴** (docs/log/2026-09-05-titlebar-cleanup.md).
   *
   * 항목을 정하는 것은 [`menuItemsFor`](./pane-menu.ts) 이고, 여기는 그 목록을 그리고
   * **몸짓**(키보드·바깥 클릭·화면 넘침)을 든다. 누른 결과는 `onrun(action)` 한 줄로
   * 위에 올린다 — 이 컴포넌트는 어느 타일이 대상인지조차 모른다. 대상을 스냅샷하고
   * 닫는 순서는 `PaneHost` 의 통로(`runTileMenu` → `runOnMenu`)가 든다
   * (`docs/conventions.md` — 메뉴를 닫는 코드는 값을 스냅샷한 뒤에 온다).
   *
   * ## 왜 타일 상자 **밖**에 그리는가
   *
   * `.pane-box` 는 저마다 `isolation: isolate` 라 스택 문맥이 갇혀 있다. 상자 안의
   * `position: fixed` 요소는 뒤에 그려지는 이웃 타일과 분할선 층(`.lines`)에 덮인다.
   * 그래서 이 컴포넌트는 `{#each boxes}` 밖, 캔버스의 마지막 자식으로 한 벌만 산다.
   * 한 번에 하나만 열리므로 목록이 하나뿐이어도 잃는 것이 없다.
   *
   * ## 스타일은 `Tabs` 의 메뉴와 같은 규칙
   *
   * `position: fixed` + 손수 계산한 화면 좌표, 같은 배경/테두리/그림자 토큰, `.item`,
   * 폭을 고정한 `.mark`, `<hr>` 구분선. 두 메뉴가 다르게 생기면 "같은 종류의 목록" 이라는
   * 사실이 화면에서 사라진다.
   *
   * ## 앞자리는 `UiIcon` 하나다 (2026-09-15)
   *
   * `.mark` 칸이 받는 것은 글자 한 자(`◫ ⬓ ⧉ ↗ ×` …)가 아니라 **이름**이고, 그 이름은
   * `pane-menu.ts` 가 정한다 (`ui-icons.generated.ts` 의 키). 갈래가 없으므로 그리는 쪽은
   * `<UiIcon />` 한 줄이다 — 이름이 없는 줄(`icon: null`)은 칸만 비워 둔다
   * (docs/log/2026-09-15-lucide-ui-icons.md).
   *
   * ## 옆으로 뜨는 목록 (2026-09-17)
   *
   * `▸` 를 단 줄(`서버` · `출력`)은 나머지를 **옆에** 띄운다. 몸짓·자리 규칙은 탭 바 `+`
   * 메뉴와 **같은 것**을 쓴다 (`$lib/menu-flyout` — 뜸 250ms · 닫기 200ms · 오른쪽 우선
   * 왼쪽 폴백 · `→` 로 들어가고 `←` 로 나온다). 목록 안의 줄도 바깥 줄과 **같은 `onrun`**
   * 을 지나므로 `PaneHost` 의 통로(`runTileMenu` → `runOnMenu`)는 그대로다
   * (docs/log/2026-09-17-tile-menu-flyouts.md).
   *
   * 목록은 메뉴 상자의 **형제**다 — 메뉴가 `overflow-y: auto` 라 안에 넣으면 잘린다.
   * 대신 바깥 클릭 판정이 **둘 다** 보게 한다: 형제로 내보낸 목록을 판정에서 빼먹으면
   * 항목을 누르는 순간 메뉴가 닫혀 그 항목이 조용히 죽는다 (이 저장소가 두 번 겪은 모양).
   */
  let {
    /** 머리글 = 대상 타일의 이름 */
    title,
    items,
    left,
    top,
    onrun,
    /**
     * 닫아 달라 — 포커스를 어디로 되돌릴지는 **어떻게 닫혔는가**가 정한다.
     * `"trigger"` 는 ⋯ 버튼(Escape), `"none"` 은 아무 데도 (바깥을 눌렀거나 창이 바뀐 경우 —
     * 그쪽에서 이미 다른 곳으로 포커스가 가고 있어 여기서 한 번 더 옮기면 서로 낚아챈다).
     * 항목을 골라 닫는 `"back"` 은 이 컴포넌트가 부르지 않는다 (`onrun` 쪽이 든다).
     */
    onclose,
  }: {
    title: string;
    items: readonly PaneMenuRow[];
    left: number;
    top: number;
    onrun: (action: PaneMenuAction) => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  // ── 옆으로 뜨는 목록 (docs/log/2026-09-17-tile-menu-flyouts.md) ────────────
  //
  // 상태는 여기, 규칙(자리·키)은 `$lib/menu-flyout` 에 있다 — 옆목록을 다는 메뉴가 다시 생기면
  // 같은 모듈을 써서 `▸` 가 서로 다른 속도로 열리거나 다른 쪽으로 넘칠 일이 없게 한다.

  let flyout = $state<PaneFlyoutId | null>(null);
  let flyoutLeft = $state(0);
  let flyoutTop = $state(0);
  let flyoutEl = $state<HTMLElement | null>(null);

  /** 지금 열려 있는 목록의 줄들 (닫혀 있으면 `null`) */
  const openGroup = $derived(items.filter(isGroup).find((g) => g.flyout === flyout) ?? null);

  let hoverTimer: ReturnType<typeof setTimeout> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;

  function clearFlyoutTimers() {
    if (hoverTimer !== null) clearTimeout(hoverTimer);
    if (closeTimer !== null) clearTimeout(closeTimer);
    hoverTimer = null;
    closeTimer = null;
  }

  /** 예약된 타이머는 메뉴와 함께 사라진다 (닫힌 뒤에 목록이 뜨는 일이 없게) */
  $effect(() => () => clearFlyoutTimers());

  /** `▸` 줄의 버튼 — `data-flyout` 이 그 자리의 이름이자 헤드리스 스크립트의 손잡이다 */
  function rowElement(kind: PaneFlyoutId): HTMLButtonElement | null {
    return el?.querySelector<HTMLButtonElement>(`[data-flyout="${kind}"]`) ?? null;
  }

  /** 목록의 화면 좌표를 다시 잰다 — 규칙(오른쪽 우선·왼쪽 폴백·세로 클램프)은 순수 모듈에 있다 */
  function placeFlyoutNow(kind: PaneFlyoutId) {
    const row = rowElement(kind)?.getBoundingClientRect();
    const menu = el?.getBoundingClientRect();
    if (!row || !menu) return;
    const count = items.filter(isGroup).find((g) => g.flyout === kind)?.children.length ?? 0;
    const size = flyoutEl
      ? { width: flyoutEl.offsetWidth, height: flyoutEl.offsetHeight }
      : { width: FLYOUT_EST_WIDTH, height: count * FLYOUT_EST_ROW + 8 };
    const at = placeFlyout(row, menu, size, {
      width: window.innerWidth,
      height: window.innerHeight,
    });
    flyoutLeft = at.left;
    flyoutTop = at.top;
  }

  function openFlyout(kind: PaneFlyoutId, focusFirst = false) {
    clearFlyoutTimers();
    flyout = kind;
    placeFlyoutNow(kind); // 첫 자리는 어림값 — 아래 `$effect` 가 그려진 크기로 고쳐 잡는다
    if (!focusFirst) return;
    void tick().then(() => flyoutEl?.querySelector("button")?.focus());
  }

  function closeFlyout() {
    clearFlyoutTimers();
    flyout = null;
  }

  /**
   * 줄 위에 머무르면 연다. 이미 다른 줄의 목록이 떠 있어도 **같은 뜸** 뒤에 갈아 끼운다(그동안은 떠 있던 목록이 그대로 — 10-25 사용자:
   * 옆 줄로 스치기만 해도 목록이 바뀌었다)
   */
  function hoverRow(kind: PaneFlyoutId, disabled: boolean) {
    if (disabled) return; // 전부 흐린 묶음 — 열어 봐야 흐린 줄뿐이다
    clearFlyoutTimers(); // 되돌아온 손 — 예약된 닫기를 취소한다
    if (flyout === kind) return;
    hoverTimer = setTimeout(() => openFlyout(kind), FLYOUT_OPEN_MS);
  }

  /** 줄에서든 목록에서든 포인터가 나가면 조금 뒤에 닫는다 (둘 사이 빈틈을 지나는 손을 위해) */
  function leaveSoon() {
    clearFlyoutTimers();
    closeTimer = setTimeout(() => (flyout = null), FLYOUT_CLOSE_MS);
  }

  /**
   * 줄을 누르면 — 뜸 없이 곧바로 연다. **이미 떠 있으면 그대로 둔다**(10-25 — 호버로 막 열린 목록을 그 줄을 누르려던 클릭이 닫던 겹침).
   * 닫기는 ← · Escape · 바깥 누르기 · 다른 줄이다
   */
  function toggleFlyout(kind: PaneFlyoutId) {
    if (flyout !== kind) openFlyout(kind);
    else clearFlyoutTimers();
  }

  /** `▸` 줄 위에서의 ArrowRight — 목록을 열고 첫 항목으로 들어간다 (Enter·Space 는 click 이 받는다) */
  function rowKey(ev: KeyboardEvent, kind: PaneFlyoutId, disabled: boolean) {
    if (disabled || flyoutKeyAction(ev.key, "row") !== "open") return;
    ev.preventDefault();
    openFlyout(kind, true);
  }

  /** 그려진 목록의 **실제 크기**로 자리를 다시 잡는다 (어림값으로 연 첫 프레임을 고친다) */
  $effect(() => {
    const kind = flyout;
    if (kind === null || !flyoutEl) return;
    placeFlyoutNow(kind);
  });

  /**
   * 목록 안에서의 키 — `←` 는 한 켜 나가고, Escape 도 **한 켜만** 닫는다 (메뉴는 남는다).
   *
   * Escape 를 여기서 끊는 이유는 바깥 메뉴와 같다 — 창 전역까지 올라가면 메뉴를 닫으려던
   * 키가 뒤에 깔린 화면까지 함께 닫는다. 목록은 메뉴의 형제라 이벤트가 메뉴를 지나지 않으므로
   * 이 핸들러가 그 자리를 혼자 든다. ↑↓ 는 목록 안에서만 돈다.
   */
  function onFlyoutKey(ev: KeyboardEvent) {
    const node = flyoutEl;
    const back = flyout;
    if (!node || back === null) return;
    if (ev.key === "Escape" || flyoutKeyAction(ev.key, "flyout") === "close") {
      ev.preventDefault();
      ev.stopPropagation();
      closeFlyout();
      rowElement(back)?.focus();
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    moveFocus(node, ev.key);
  }

  /**
   * 실제로 그리는 세로 자리 — 프롭이 준 자리에서 시작해 **아래로 넘치면 위로 접어 올린다**.
   *
   * 보정을 미리 못 하는 이유는 높이를 알 수 없기 때문이다: 항목 수가 타일 종류마다 다르다.
   * 그래서 붙은 뒤에 재서 한 번 옮기고, 그다음 실행에서는 조건이 거짓이라 멈춘다.
   */
  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  /**
   * 다른 타일의 메뉴로 갈아탈 때(열린 채 옆 타일의 ⋯ 를 누른 경우) 보정을 되돌린다.
   * `left`·`items` 도 함께 읽는 이유: 나란한 두 타일의 헤더는 **`top` 이 같다** —
   * 세로 자리만 보면 갈아탄 것을 알아채지 못해 지난번 보정이 그대로 남는다.
   */
  $effect(() => {
    void left;
    void items;
    void top;
    clamped = null;
  });

  /**
   * 메뉴가 뜨면 **상자 자신에 포커스**를 준다.
   *
   * 첫 항목이 아니라 상자를 포커스하는 이유: 키 처리는 상자에 걸려 있어 ↑↓ 는 이것만으로
   * 곧바로 돌고(첫 실행에서 맨 위/맨 아래를 잡는다), 마우스로 연 사람에게 파란 링이 미리
   * 하나 그어져 있지 않기 때문이다. Enter 는 항목으로 내려간 뒤에만 뜻을 갖는다.
   */
  $effect(() => {
    const node = el;
    const t = shownTop;
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (t > max) {
      clamped = Math.max(8, max);
      return;
    }
    // 포커스가 **옆목록에 가 있으면 도로 뺏지 않는다** — 목록은 상자 밖(형제)이라
    // `node.contains` 만 보면 "아무 데도 없다" 로 읽힌다.
    const focused = document.activeElement;
    if (!node.contains(focused) && !flyoutEl?.contains(focused)) {
      node.focus({ preventScroll: true });
    }
  });

  /**
   * 바깥을 누르면 닫는다 — ⋯ 버튼 위는 뺀다 (그쪽은 자기 click 이 토글한다).
   *
   * **옆목록도 "안" 이다.** 목록은 메뉴의 형제라 `el.contains` 에 걸리지 않는데, 그것을
   * 빼먹으면 목록의 줄을 누르는 순간 메뉴가 닫혀 그 항목이 조용히 죽는다.
   */
  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const t = ev.target;
      if (!(t instanceof Node)) return;
      if (el?.contains(t) || flyoutEl?.contains(t)) return;
      if (t instanceof Element && t.closest("[data-tile-menu-btn]")) return;
      onclose("none");
    };
    const onResize = () => onclose("none");
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("resize", onResize);
    };
  });

  /**
   * 메뉴 안에서의 키보드 — ↑↓(Home/End)로 항목 사이를 돌고 Escape 로 닫는다.
   * Enter/Space 는 `<button>` 이 이미 한다.
   *
   * Escape 는 여기서 **끊는다** — 창 전역 Escape(모달 닫기 등)까지 올라가면 메뉴를 닫으려던
   * 키가 뒤에 있는 화면까지 함께 닫는다.
   */
  function onKey(ev: KeyboardEvent) {
    const node = el;
    if (!node) return;
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      // **한 켜씩** 닫는다 — 옆목록이 떠 있으면 그것만 닫고 메뉴는 남긴다 (예전 `+` 메뉴와 같던
      // 규칙: 잘못 연 목록 때문에 메뉴까지 사라지면 하려던 일을 처음부터 다시 한다).
      const back = flyout;
      if (back !== null) {
        closeFlyout();
        rowElement(back)?.focus();
        return;
      }
      onclose("trigger");
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(ev.key)) return;
    ev.preventDefault();
    moveFocus(node, ev.key);
  }

  /**
   * ↑↓(Home/End)로 상자 안의 누를 수 있는 줄 사이를 돈다 — **메뉴와 옆목록이 같은 함수**를
   * 쓴다 (상자만 다르고 규칙은 같다: 흐린 줄은 건너뛰고, 끝에서 반대편으로 감긴다).
   */
  function moveFocus(node: HTMLElement, key: string) {
    const buttons = Array.from(
      node.querySelectorAll<HTMLButtonElement>("button.item:not([disabled])"),
    );
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const down = key === "ArrowDown";
    const next =
      key === "Home"
        ? 0
        : key === "End"
          ? buttons.length - 1
          : at < 0
            ? down
              ? 0
              : buttons.length - 1
            : (at + (down ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="tilemenu menu-surface"
  role="menu"
  aria-label={tr("pane.menu.aria", { title })}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
>
  <!-- 머리 글은 메뉴 폭 안에서 말줄임한다(theme.css `.menu-title`) — 잘린 경로 · 제목은 말풍선으로 -->
  <p class="group menu-title" {title}>{title}</p>
  {#each items as item (rowId(item))}
    {#if item.separator}
      <hr class="menu-sep" />
    {/if}
    {#if isGroup(item)}
      <!--
        **옆목록을 여는 줄** (`서버 ▸` · `출력 ▸`). 누르면 실행되는 것이 없으므로 `onrun`
        을 부르지 않는다 — 여는 길은 셋이다: 250ms 머무르기 · 클릭 · `→`.
        `data-flyout` 은 자리 계산(`rowElement`)이 찾는 표식이자 헤드리스 스크립트의 손잡이다.
      -->
      <button
        type="button"
        class="item parent menu-row"
        role="menuitem"
        aria-haspopup="menu"
        aria-expanded={flyout === item.flyout}
        data-flyout={item.flyout}
        disabled={item.disabled}
        title={item.title}
        onclick={() => toggleFlyout(item.flyout)}
        onkeydown={(ev) => rowKey(ev, item.flyout, item.disabled === true)}
        onpointerenter={() => hoverRow(item.flyout, item.disabled === true)}
        onpointerleave={leaveSoon}
      >
        <span class="mark menu-mark"
          >{#if item.icon}<UiIcon name={item.icon} size={14} />{/if}</span
        >{item.label}<span class="chev menu-kbd"
          ><UiIcon name="chevron" size={12} /></span
        >
      </button>
    {:else}
      <button
        type="button"
        class="item menu-row"
        class:hinted={!!item.hint}
        role={item.checkbox ? "menuitemcheckbox" : "menuitem"}
        aria-checked={item.checkbox ? item.checked : undefined}
        data-action={item.action}
        disabled={item.disabled}
        title={item.title}
        onclick={() => onrun(item.action)}
      >
        <!-- `.mark` 안에는 **공백도 넣지 않는다** — inline-flex 칸이라 공백 노드가 또 하나의
             flex 항목이 되어 아이콘이 칸 가운데에서 밀린다 (`Tabs` 의 메뉴와 같은 규칙) -->
        <span class="mark menu-mark"
          >{#if item.icon}<UiIcon name={item.icon} size={14} />{/if}</span
        >{item.label}{#if item.hint}<kbd class="menu-kbd" data-menu-hint>{item.hint}</kbd>{/if}
      </button>
    {/if}
  {/each}
</div>

<!--
  **옆으로 뜨는 목록** — 메뉴 상자의 **형제**다 (메뉴가 `overflow-y: auto` 라 안에 넣으면
  잘린다). 좌표는 `placeFlyout` 이 잡고, 바깥 클릭 판정은 이 상자도 "안" 으로 친다.
  줄은 바깥 목록과 **같은 `onrun`** 을 지난다 — 통로(`runOnMenu`)가 하나라는 뜻이다.
-->
{#if openGroup}
  <div
    class="flyout menu-surface"
    role="menu"
    aria-label={openGroup.label}
    tabindex="-1"
    bind:this={flyoutEl}
    style="left:{flyoutLeft}px;top:{flyoutTop}px"
    onpointerenter={clearFlyoutTimers}
    onpointerleave={leaveSoon}
    onkeydown={onFlyoutKey}
  >
    {#each openGroup.children as child (child.action)}
      <button
        type="button"
        class="item menu-row"
        class:hinted={!!child.hint}
        role={child.checkbox ? "menuitemcheckbox" : "menuitem"}
        aria-checked={child.checkbox ? child.checked : undefined}
        data-action={child.action}
        disabled={child.disabled}
        title={child.title}
        onclick={() => onrun(child.action)}
      >
        <span class="mark menu-mark"
          >{#if child.icon}<UiIcon
              name={child.icon}
              size={14}
            />{/if}</span
        >{child.label}{#if child.hint}<kbd class="menu-kbd" data-menu-hint>{child.hint}</kbd>{/if}
      </button>
    {/each}
  </div>
{/if}

<style>
  /*
    모양은 전역 메뉴 한 벌(`theme.css` 의 `.menu-surface`·`.menu-row`·`.menu-title`·`.menu-mark`·
    `.menu-kbd`·`.menu-sep` — docs/log/2026-09-25-leftovers-menus-dots.md). 상자는 비치지 않는 뜬 면
    판이라 터미널 글자 위에 떠도 읽힌다. 여기 남는 것은 자리·폭과 이 메뉴만의 줄(옆목록 `▸`)뿐이다.
    줄이 13px 라 폭 상한은 240 (실측 190px).

    아이콘 칸(`.menu-mark`)은 **비어 있을 때도 폭을 차지한다** — 아이콘이 없는 줄도 글자가 같은
    x 에서 시작한다. 색은 `--fg-2` 라 흐린 줄(`:disabled` 의 `opacity`)이 아이콘에도 그대로 걸린다.
  */
  .tilemenu {
    position: fixed;
    z-index: 20; /* 분할선(.lines: 2)·포커스 타일(1) 위 — 캔버스 안에서 가장 높다 */
    min-width: 180px;
    max-width: 240px;
    max-height: 60vh;
    overflow-y: auto;
  }

  /*
    **옆목록을 여는 줄** — 오른쪽 끝에 `▸` 가 선다 (docs/log/2026-09-17-tile-menu-flyouts.md).
    `.menu-row` 는 `display: block` 이라 `▸`(`.menu-kbd` — `margin-left: auto`)를 끝으로 밀 수
    없으므로 이 줄만 flex 가 된다. `gap` 은 쓰지 않는다 — 글자 시작 x 가 다른 줄과 같아야 한다.
  */
  .item.parent {
    display: flex;
    align-items: center;
  }

  /* 단축키 글자가 붙은 줄 — `▸` 줄과 같은 까닭으로 flex(끝으로 미는 `margin-left: auto` 가 먹게) */
  .item.hinted {
    display: flex;
    align-items: center;
  }

  .item.parent .chev {
    display: inline-flex;
  }

  /*
    옆으로 뜨는 목록 — 이 메뉴와 **같은 상자**다 (좌표만 스크립트가 잰다: `placeFlyout`).
    `z-index` 가 메뉴(20)보다 한 칸 위인 것은 왼쪽으로 넘어갔을 때 메뉴에 가리지 않게 함이다.
  */
  .flyout {
    position: fixed;
    z-index: 21;
    min-width: 160px;
    max-width: 260px;
    max-height: 60vh;
    overflow-y: auto;
  }
</style>
