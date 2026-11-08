<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import {
    fileMenuTools,
    foldGap,
    type ToolbarMenuRow,
    type ToolbarTool,
  } from "$lib/browser/toolbar-tools";

  /**
   * **파일 타일의 도구줄 한 줄** (docs/log/2026-10-07-file-tile-dolphin.md — KDE Dolphin 의 배치 · 2026-10-20 B안).
   *
   *     [‹ ›] [▦▾]  [ 내 PC › C: › Users › you  ⟳ ]  [+ ⇪]  [찾기]  (⋯)
   *
   * 2026-10-20 타일 제목줄 개편(목업 SJgp6bQEPiRYkBCvjy3NuL · B안) — 머리줄이 서 있으면 이 줄이 **머리줄 가운데로 올라간다**(`inHead` ·
   * `pane/pane-tools.svelte.ts`): 뒤로/앞으로(`BrowserNav`) · 보기 고르개(`BrowserViewPick`)는 머리줄 맨 앞(타일 아이콘 앞), 빵부스러기가 이름
   * 자리, ⋯ 는 **타일 ⋯ 하나**(도구 줄이 타일 메뉴 맨 위에 얹힌다). 머리줄이 없으면(설정 `tile_header` · 폰) 예전 자리(목록 위)에 서고 끝에
   * 제 ⋯ 를 단다(`nav` 스니펫 — 뒤로/앞으로 · 보기 — 가 맨 앞).
   *
   * - 가운데 경로 칸(`location`)은 스니펫, 줄 위 단추는 **표**(`tools` — 접으면 ⋯ 로 가야 해서 마크업이 아니라 값이다). 위로 가기 단추는 없다 —
   *   경로 칸의 상위 조각이 그 일을 한다. 새로고침 ⟳ 는 경로 칸 안 오른쪽 끝이다(브라우저 주소창의 자리 — `LocationBar`).
   * - **보기는 늘 그림 하나**(지금 보기 ▦ ▾ — 누르면 셋을 고르는 목록 · `BrowserViewPick`). 자리는 뒤로/앞으로 바로 다음(사용자 실기 10-20).
   * - 숨김 파일 · 장소 패널 · 미리 보기 패널은 ⋯ 안(`menuTools`)이다.
   *
   * ## 경로 칸은 장소 패널 경계에서 시작한다 (2026-10-20)
   *
   * 장소 패널이 펼쳐져 있으면 경로 칸의 왼쪽 끝 = 목록 열의 x(패널 폭 — `pane/head-span` 의 `filePlacesLayout` 의 `span`). 머리줄 안이면 머리줄이
   * 맨 앞 조각(뒤로/앞으로 · 보기)을 그 폭으로 쥔다(`pane-tools` 의 `span`). 머리줄이 없으면 이 줄이 `nav` 를 같은 폭의 상자(`navSpan`)에 담는다 —
   * 같은 정렬을 이 줄이 예전(`aligned` — 10-20 개편 때 걷힌 것)처럼 다시 맡는다. 아이콘만 남은 패널 · 패널 없음이면 고정 없이 제 폭이다.
   *
   * ## 좁으면 새 폴더 · 업로드부터 ⋯ 로 접는다
   *
   * 판정은 **타일 폭** 하나다(`folded` — `pane/head-span` 의 `filePlacesLayout` 의 `fold`, 2026-10-20: 좁힐 때 경로 칸이 최대한 남도록 정렬 해제 →
   * 장소 패널 아이콘만 → 단추 접기 → 패널 없음 순서를 그 한 곳이 정한다 — 예전의 줄 폭 컨테이너 쿼리(300px)는 걷었다). 접히면 `fold` 단추가
   * 흐름 밖의 보이지 않는 상자가 되고(`position:absolute` + `visibility:hidden` — 언제나 잴 수 있다), 메뉴도 같은 값으로 접힘을 읽는다([`fileMenuTools`]).
   * 줄 안의 폭을 재서 접지 않으므로 접힘이 제 결과에 되먹지 않는다. 단축키는 창 전역의 `file-keys.ts` 가
   * 받으므로 접혀도 그대로다.
   *
   * ### 접혀서 빈 자리는 경로가 한꺼번에 받지 않는다 (2026-10-11 사용자 요청)
   *
   * 접는 순간 비는 폭(단추 둘 ≈ 56px)을 경로 칸이 다 받으면 타일을 좁히는데 경로 칸이 **갑자기 넓어진다**. 그래서 빈 자리를 **빈칸으로 남겨**
   * 두고, 그 빈칸이 줄이 좁아지는 만큼 1:1 로 줄게 한다(`foldSpacer` 와 같은 식 — 빈칸 = max(0, 접혀서 빈 폭 + 줄 폭 − 접는 폭)). "접혀서 빈 폭" 은
   * 단추 무리의 폭을 잰 값(`foldGap`)이라 단추 수(업로드 가능 여부)가 달라도 곡선이 이어진다.
   *
   * ## 머리줄 안의 포커스 밖 — 경로만 남는다 (2026-10-20 사용자 실기)
   *
   * 단추 무리 둘(`.tools.fold` · `.tools.stay`)과 경로 칸의 새로고침은 **조작**이라 `data-head-act` 를 단다 — 포커스 밖 타일에서는 숨으며 자리를
   * 접고 빵부스러기(그 타일의 이름 = 위치)만 남는다(`pane/pane-tools.svelte.ts` "늘 보임 / 드러날 때만"). 몸 위에 그릴 때는 아무 일도 없다.
   *
   * ## 스타일이 `:global` 인 이유
   *
   * 스니펫의 내용은 **넘겨준 쪽(부모)의 스코프**로 컴파일된다 — 부모가 `.bar-btn` 을 붙인 버튼(`BrowserNav` 포함)에는 이 컴포넌트의 scoped CSS 가
   * 닿지 않는다. 그래서 툴바 버튼 클래스만 전역으로 낸다(쓰는 곳은 파일 타일뿐).
   */
  let {
    /** 통째로 못 쓰는 상태 (원격 타일의 연결 끊김) */
    disabled = false,
    /** 머리줄 안에서 그리는가 — 테두리 · 여백이 없고 제 ⋯ 를 달지 않는다(타일 ⋯ 가 그 줄들을 맡는다) */
    inHead = false,
    /** 줄 맨 앞(머리줄이 없을 때의 뒤로/앞으로 · 보기 고르개 — `BrowserNav` · `BrowserViewPick`) */
    nav,
    /** 머리줄이 없을 때 `nav` 무리가 끝나는 x(줄 왼쪽 끝 기준 px — 장소 패널 경계, `filePlacesLayout` 의 `span`). `null` 이면 제 폭 */
    navSpan = null,
    /** 새 폴더 · 업로드를 ⋯ 로 접는가(`filePlacesLayout` 의 `fold`) */
    folded = false,
    /** 타일 폭 − 접는 폭(`filePlacesLayout` 의 `foldOver`) — 접힌 뒤 빈칸이 1:1 로 닳는 몫 */
    foldOver = 0,
    /** 가운데 넓은 칸 (경로 칸) */
    location,
    /** 줄 위 단추들 — `fold` 단추는 좁으면 ⋯ 로 (`toolbar-tools.ts`) */
    tools = [],
    /** 늘 ⋯ 안에 사는 줄들 — 숨김 파일 · 장소 · 미리 보기 */
    menuTools = [],
    /** 오른쪽 끝에 덧붙일 것 (화면에 안 보이는 파일 칸 따위 — 접히지 않는다) */
    right,
  }: {
    disabled?: boolean;
    inHead?: boolean;
    nav?: Snippet;
    navSpan?: number | null;
    folded?: boolean;
    foldOver?: number;
    location?: Snippet;
    tools?: readonly ToolbarTool[];
    menuTools?: readonly ToolbarTool[];
    right?: Snippet;
  } = $props();

  /** 액션에 **지금 걸린** 조합 (사용자 오버라이드를 지난 것) — 메뉴 줄 오른쪽 글자 */
  const hintOf = (action: string | undefined) =>
    action ? displayCombo(effectiveCombo(action, settings.keybindings)) : "";

  /** 줄 위 단추 — 접히는 무리(새 폴더 · 업로드)와 늘 서는 무리(찾기) */
  const foldTools = $derived(tools.filter((tool) => tool.fold === true));
  const stayTools = $derived(tools.filter((tool) => tool.fold !== true));

  // ── 제 ⋯ 메뉴 (머리줄이 없을 때만 — 보기 고르개는 `BrowserViewPick` 이 제 목록을 쥔다) ─────────────────────
  let moreOpen = $state(false);
  let moreBtn = $state<HTMLButtonElement | null>(null);

  // ── 접혀서 빈 폭 (머리말 "접혀서 빈 자리는 경로가 한꺼번에 받지 않는다") ─────────────────────
  let foldEl = $state<HTMLElement | null>(null);
  let foldWidth = $state(0);

  $effect(() => {
    const el = foldEl;
    if (!el) return;
    // 접힌 모양은 아무것도 없다(⋯ 는 접힘과 무관하게 선다) — 빈 폭 = 무리 폭 + 무리 뒤 간격(줄의 gap 4px)
    const measure = () => (foldWidth = foldGap(el.offsetWidth + 4, 0));
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  /** 제 ⋯ 에 설 줄 — 연 순간의 줄 폭으로 접힘을 읽는다(CSS 의 컨테이너 쿼리와 같은 문턱) */
  let moreTools = $state<ToolbarTool[]>([]);

  const toolRows = $derived<ToolbarMenuRow[]>(
    moreTools.map((tool) => ({
      key: tool.id,
      icon: tool.icon,
      label: tool.label,
      hint: hintOf(tool.action),
      checked: tool.pressed,
      disabled: tool.disabled,
      // 흐린 줄에만 툴팁 — 왜 못 누르는지 (누를 수 있는 줄의 툴팁은 이름의 되풀이라 군말이다)
      title: tool.disabled ? (tool.title ?? tool.label) : undefined,
      sep: tool.sep,
    })),
  );

  function toggleMore() {
    if (!moreOpen) moreTools = fileMenuTools(tools, menuTools, folded);
    moreOpen = !moreOpen;
  }

  /** 닫는다 — `back` 이면 연 단추로 포커스를 돌려준다 */
  function closeMenu(back: boolean) {
    moreOpen = false;
    if (back) moreBtn?.focus({ preventScroll: true });
  }

  /** 메뉴 줄 — 통로(`runOnMenu`)를 지난다: 대상을 뜨고 → 닫고(단추로 포커스) → 실행 */
  function pickTool(key: string) {
    runOnMenu(
      () => moreTools.find((tool) => tool.id === key),
      () => closeMenu(true),
      (tool) => tool.run(),
    );
  }
</script>

{#snippet toolButton(tool: ToolbarTool)}
  {#if tool.sep}<span class="bar-sep" aria-hidden="true"></span>{/if}
  <button
    type="button"
    class="bar-btn"
    class:on={tool.pressed === true}
    {...{ [`data-file-${tool.id}`]: "" }}
    title={tool.title ?? tool.label}
    aria-label={tool.label}
    aria-pressed={tool.pressed}
    disabled={tool.disabled}
    onclick={tool.run}><UiIcon name={tool.icon} size={14} /></button
  >
{/snippet}

<div
  class="bar file-bar"
  class:in-head={inHead}
  class:folded
  style:--fold-tools="{foldWidth}px"
  style:--fold-over="{foldOver}px"
>
  {#if !inHead && navSpan !== null}
    <!-- 장소 패널 경계까지 쥐는 무리 — 폭 = 경계 x − 줄 왼쪽 여백(6) − 무리 뒤 간격(4) -->
    <span class="nav-span" style:width="calc({navSpan}px - 10px)">{@render nav?.()}</span>
  {:else if !inHead}
    {@render nav?.()}
  {/if}

  {@render location?.()}

  {#if foldTools.length > 0}
    <!-- 접히는 단추(새 폴더 · 업로드) — 좁으면 흐름 밖의 보이지 않는 상자로 남아 폭만 잰다 -->
    <span class="tools fold" data-head-act bind:this={foldEl}>
      {#each foldTools as tool (tool.id)}{@render toolButton(tool)}{/each}
    </span>
  {/if}

  {#if stayTools.length > 0}
    <span class="tools stay" data-head-act>
      {#each stayTools as tool (tool.id)}{@render toolButton(tool)}{/each}
    </span>
  {/if}

  {#if !inHead && (menuTools.length > 0 || foldTools.length > 0)}
    <!-- 머리줄이 없을 때의 제 ⋯ — 머리줄이 서면 그 줄들은 타일 ⋯ 맨 위로 간다 -->
    <span class="more">
      <button
        type="button"
        class="bar-btn"
        bind:this={moreBtn}
        data-file-tools-more
        aria-haspopup="menu"
        aria-expanded={moreOpen}
        title={t("files.toolbar.more")}
        aria-label={t("files.toolbar.more")}
        onclick={toggleMore}><UiIcon name="more" size={14} /></button
      >
      {#if moreOpen && moreBtn}
        <ToolbarMenu
          label={t("files.toolbar.more")}
          rows={toolRows}
          trigger={moreBtn}
          align="right"
          onpick={pickTool}
          onclose={closeMenu}
        />
      {/if}
    </span>
  {/if}
  {@render right?.()}
</div>

<style>
  /*
   * `.bar` 는 **전역 규칙으로 남겨 둔다** — 예전부터 이 파일이 전역으로 내던 값이라, 같은 이름을 쓰는 다른
   * 화면(문서·diff·브랜치 타일의 머리 줄)이 모르는 새 그 값에 기대고 있을 수 있다. 값은 예전 그대로다.
   * 파일 타일의 줄은 `.file-bar` 로 제 값을 덧씌운다.
   */
  :global(.bar) {
    display: flex;
    align-items: center;
    gap: 4px;
    flex: 0 0 auto;
    padding: 5px 6px;
    border-bottom: 1px solid var(--border);
  }

  .file-bar {
    padding: 4px 6px;
    border-bottom-color: var(--line);
  }

  /* 머리줄 안 — 가운데 칸을 채우고(폭은 머리줄이 정한다) 테두리 · 여백이 없다(머리줄과 몸 사이에 선을 긋지 않는다) */
  .file-bar.in-head {
    flex: 1 1 0;
    min-width: 0;
    padding: 0;
    border-bottom: none;
    /* 줄의 gap — 포커스 밖에서 접히는 단추 무리(`data-head-act`)의 앞 간격을 지운다(`pane/pane-tools.svelte.ts`) */
    --head-act-gap: 4px;
  }

  /* 줄 위 단추 무리 — 줄의 `gap` 과 같은 4px */
  .tools {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  .more {
    display: inline-flex;
  }

  /* 머리줄이 없을 때 장소 패널 경계까지 쥐는 무리(`navSpan`) — 아주 좁으면 제 내용 폭 아래로는 안 준다 */
  .nav-span {
    flex: 0 0 auto;
    min-width: max-content;
    box-sizing: border-box;
    display: flex;
    align-items: center;
    gap: 4px;
  }

  /* 무리 안의 가는 세로 선 */
  .bar-sep {
    flex: 0 0 auto;
    width: 1px;
    height: 14px;
    margin: 0 2px;
    background: var(--line);
  }

  /* 열린 메뉴의 단추 — 손이 올라간 판과 같은 면(켜짐의 `--accent-soft` 와 갈린다: 이것은 토글이 아니다). 보기 고르개(`BrowserViewPick`)도 받는다 */
  :global(.bar-btn[aria-expanded="true"]) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  /*
   * 좁으면 — 새 폴더 · 업로드를 ⋯ 로(`folded` — 타일 폭 판정). 빈 폭은 찾기 앞 빈칸으로 남아 타일 폭과 1:1 로 닳는다
   * (`foldSpacer` 와 같은 식 — `--fold-over` 가 타일 폭 − 접는 폭).
   */
  .file-bar.folded .tools.fold {
    position: absolute;
    visibility: hidden;
    pointer-events: none;
  }
  .file-bar.folded .tools.stay {
    margin-left: max(0px, calc(var(--fold-tools) + var(--fold-over)));
  }

  /*
   * 글자 버튼도 아이콘 버튼도 같은 상자다 — `UiIcon` 은 `display:block` 이라 버튼 안에서 저절로 가운데
   * 서지 않으므로 여기서 한 번만 가운데를 잡는다 (스니펫으로 들어오는 부모 쪽 버튼들도 이 전역 규칙을 받는다).
   */
  :global(.bar-btn) {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 3px 5px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    min-height: 1.4em;
    color: var(--fg-muted);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  :global(.bar-btn:hover:not(:disabled)) {
    color: var(--fg);
    background: var(--bg-hover);
  }

  :global(.bar-btn:focus-visible) {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
  }

  :global(.bar-btn:disabled) {
    opacity: 0.4;
    cursor: default;
  }

  /* 켜진 토글(찾기 · 지금 보기) — 강조 면 하나로 말한다 */
  :global(.bar-btn.on) {
    color: var(--fg);
    background: var(--accent-soft);
  }
</style>
