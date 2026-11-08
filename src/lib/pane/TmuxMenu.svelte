<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { closeOnOutside, menuKeydown } from "$lib/pane/chip-menu.svelte.js";
  import TmuxStateDot from "$lib/pane/TmuxStateDot.svelte";
  import { listTmuxSessions, relativeCreated, tmuxSummary, type TmuxSessionInfo } from "$lib/tmux";
  import { noteTmuxSessions } from "$lib/pane/tmux-sessions.svelte.js";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * **tmux 세션 목록 팝오버** (docs/log/2026-09-16-tmux-toggle.md).
   *
   * 머리줄의 **tmux 칩**이 연다(주 입구). ⋯ 메뉴의 "tmux 세션…" 도 같은 상자를 여는데,
   * 그쪽은 머리줄을 끈 사람(`[app] tile_header`)의 길이다.
   *
   * 상자·좌표·몸짓(바깥 클릭·Escape·↑↓)은 `PaneMenu` 와 **같은 규칙**이고, 안에 드는 것만
   * 다르다: 항목이 고정된 목록이 아니라 **서버에 물어서 오는 줄들**이라 로딩·빈 상태가 있다.
   *
   * ## 왜 ⋯ 메뉴의 옆목록(flyout)이 아닌가
   *
   * 옆목록은 **즉시 그릴 수 있는 짧은 목록**의 자리다(예전 `+` 메뉴의 셸 이름들). 이쪽은 왕복이
   * 있고(3초 시한), 줄마다 버튼이 둘이며, 이름이 길다. 옆목록 자리에 넣으면 메뉴가 떠 있는
   * 동안 폭·높이가 두 번 바뀌고 부모 메뉴까지 따라 움직인다. 그래서 **메뉴를 닫고 그 자리에**
   * 상자 하나를 새로 연다 — 사용자가 보기에는 한 걸음 들어간 것과 같다.
   *
   * ## 이 컴포넌트가 모르는 것
   *
   * 어느 타일이 대상인지, 전환이 무엇을 하는지는 모른다. 누른 결과는 `onswitch(name)` ·
   * `onopen(name | null)` · `onkill(세션)` 세 줄로 올리고, 스냅샷 → 닫기 → 실행 순서는 `PaneHost` 의 통로
   * (`runTmuxMenu` → `runOnMenu` · 끄기는 `killTmuxFromMenu` — 닫고 묻고 끈 뒤 같은 자리에 다시 연다)가 든다
   * (docs/conventions.md).
   */
  let {
    /** 머리글 = 대상 타일의 이름 */
    title,
    /** 이 타일의 SSH 세션 번호 — 목록을 묻는 상대다 (없으면 끊긴 타일이다) */
    sessionId,
    /** 이 타일이 지금 붙어 있는 tmux 세션 이름 (`aria-current` 가 붙는 줄) */
    current,
    left,
    top,
    onswitch,
    onopen,
    onkill,
    onclose,
  }: {
    title: string;
    sessionId: number | null;
    current: string | null;
    left: number;
    top: number;
    /** 이 타일에서 그 세션으로 전환 */
    onswitch: (name: string) => void;
    /** 새 타일로 연다. `null` 이면 **새 세션**(다음 번호를 백엔드가 고른다) */
    onopen: (name: string | null) => void;
    /** 그 세션을 끈다(`tmux kill-session`) — 확인 대화 · 실행 · 다시 읽기는 부른 쪽(`tmux-menu.svelte.ts`) */
    onkill: (s: TmuxSessionInfo) => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  let el = $state<HTMLElement | null>(null);

  /** `null` = 아직 읽는 중. 배열이면 읽었다(빈 배열 = 세션이 없다) */
  let rows = $state<TmuxSessionInfo[] | null>(null);
  /** 읽지 **못한** 사유 한 줄 (전송 오류 — "없음" 과 다르다) */
  let failed = $state<string | null>(null);
  /** 지금 묻는 중인가 — 새로고침 버튼이 쉬고 돌아간다 */
  let loading = $state(false);

  /**
   * **한 판 읽기** — 뜨는 순간과 새로고침 버튼이 함께 쓰는 몸통.
   *
   * 세대 번호(`gen`)로 늦게 온 응답을 버린다: 버튼을 두 번 누르면 왕복이 두 개 떠 있고,
   * 먼저 보낸 것이 나중에 돌아올 수 있다 (`tmux ls` 는 SSH 왕복이라 순서가 보장되지 않는다).
   * 그때 낡은 목록이 새 목록을 덮으면 **새로고침이 화면을 되돌리는** 꼴이 된다.
   *
   * 다시 읽는 동안 **앞의 목록은 지우지 않는다** — 줄이 사라졌다 돌아오면 상자 높이가
   * 두 번 튀고, 그 사이 누르려던 줄이 손 아래에서 없어진다. 대신 버튼만 돌아간다.
   */
  let gen = 0;
  async function load(): Promise<void> {
    const id = sessionId;
    const mine = ++gen;
    if (id === null) {
      rows = [];
      failed = tr("pane.tmux.failed");
      return;
    }
    loading = true;
    failed = null;
    try {
      const list = await listTmuxSessions(id);
      if (mine !== gen) return; // 늦게 온 응답 — 버린다
      rows = list;
      noteTmuxSessions(id, list); // 머리줄 칩의 호버 카드도 같은 결과를 쓴다
    } catch (e: unknown) {
      if (mine !== gen) return;
      // 첫 판이면 "읽는 중" 을 끝내야 하므로 빈 목록을 세운다. 이미 읽은 적이 있으면
      // 그 목록을 **그대로 두고** 실패 한 줄만 얹는다 (있던 것이 오류로 사라지지 않는다).
      rows ??= [];
      failed = e instanceof Error ? e.message : String(e);
    } finally {
      if (mine === gen) loading = false;
    }
  }

  /**
   * 뜨는 순간 한 번 묻는다. 상자는 열 때마다 새로 붙으므로(`PaneHost` 의 `{#if tmuxMenu}`)
   * **다시 열면 다시 읽는다** — 새로고침 버튼은 그 사이에 서버에서 무슨 일이 일어났는지를
   * 상자를 닫지 않고 보는 길이다.
   */
  $effect(() => {
    void sessionId; // 대상이 바뀌면 다시 읽는다
    void load();
    return () => {
      gen++; // 상자가 사라졌다 — 떠 있는 응답은 아무 데도 닿지 않는다
    };
  });

  /** 상자가 뜨면 자신에 포커스 — ↑↓ 가 곧바로 돈다 (`PaneMenu` 와 같은 처방) */
  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  $effect(() => {
    const node = el;
    const t = shownTop;
    void rows; // 줄이 채워지면 높이가 달라진다 — 그때 다시 잰다
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (t > max) {
      clamped = Math.max(8, max);
      return;
    }
    if (!node.contains(document.activeElement)) node.focus({ preventScroll: true });
  });

  /**
   * 바깥을 누르면 닫는다 — 단 **머리줄의 tmux 칩만 비켜 간다**(`PaneMenu` 가 ⋯ 버튼을
   * 비켜 가는 것과 같은 표시·같은 이유): 여기서 닫아 버리면 뒤따르는 `click` 이 "열려 있지
   * 않다" 를 보고 다시 열어, 한 번 더 눌러 닫는 토글이 성립하지 않는다.
   */
  $effect(() => closeOnOutside(() => el, "[data-tmux-menu-btn]", onclose));

  /** ↑↓·Home/End 로 돌고 Escape 로 닫는다 — Escape 는 여기서 끊는다(뒤 화면까지 닫지 않게) */
  function onKey(ev: KeyboardEvent) {
    // 새로고침은 ↑↓ 고리 **밖**이다 (머리줄의 손잡이지 고를 항목이 아니다 — 위 마크업 주석).
    menuKeydown(ev, el, "button:not([disabled]):not([data-tmux-refresh])", onclose);
  }

  /** 점의 말 — 글자 설명은 호버로만 (`TmuxStateDot` 머리말) */
  function stateTitle(s: TmuxSessionInfo): string {
    return s.attached > 0
      ? tr("pane.tmux.state.attached", { n: s.attached })
      : tr("pane.tmux.state.empty");
  }

  /** 머리글 오른쪽 `●n ○m` — 읽은 목록이 있을 때만 */
  const summary = $derived(rows === null || rows.length === 0 ? null : tmuxSummary(rows));
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="tmuxmenu menu-surface"
  role="menu"
  aria-label={tr("pane.tmux.aria", { title })}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
>
  <!--
    머리줄 = 제목 + 새로고침. 버튼이 `role="menuitem"` 이 **아닌** 이유: ↑↓ 는 세션 줄들 사이를
    도는 것이고(그 목록에 끼면 첫 번째 ↓ 가 늘 새로고침에 걸린다), 이것은 목록을 고르는 일이
    아니라 목록 자체를 다시 읽는 일이다. Tab 으로는 닿는다.
  -->
  <div class="head">
    <p class="group menu-title">{tr("pane.tmux.group", { title })}</p>
    {#if summary}
      <span
        class="summary"
        title={tr("pane.tmux.summary.title", { attached: summary.attached, empty: summary.empty })}
      >
        <span class="sum"><TmuxStateDot attached={1} />{summary.attached}</span>
        <span class="sum"><TmuxStateDot attached={0} />{summary.empty}</span>
      </span>
    {/if}
    <button
      type="button"
      class="refresh"
      class:spinning={loading}
      disabled={loading || sessionId === null}
      title={tr("pane.tmux.refresh.title")}
      aria-label={tr("pane.tmux.refresh.aria")}
      data-tmux-refresh
      onclick={() => void load()}
    >
      <UiIcon name="refresh" size={13} />
    </button>
  </div>

  {#if rows === null}
    <p class="note">{tr("pane.tmux.loading")}</p>
  {:else}
    <!--
      실패 한 줄은 목록과 **함께** 뜬다. 새로고침이 실패했을 때 앞서 읽은 줄들을 지우면
      사용자는 방금까지 보이던 세션이 사라졌다고 읽는다 — 사라진 것은 목록이 아니라 왕복이다.
    -->
    {#if failed}
      <p class="note bad">{failed}</p>
    {/if}
    {#if !failed && rows.length === 0}
      <p class="note">{tr("pane.tmux.empty")}</p>
    {/if}
    <!--
      한 줄 = [✓ 칸][상태 점][이름][창 수][나이][새 타일][끄기] (2026-10-05 — 예전 두 줄 "창 3 · 붙어 있음 ·
      2시간 전" 을 접었다. 붙음 상태는 점, 창 수는 작은 아이콘 + 숫자, 나이는 짧은 꼬리).
      이 타일이 붙어 있는 줄은 줄 전체에 옅은 판을 깐다.
    -->
    {#each rows as s (s.name)}
      {@const here = s.name === current}
      <div class="row" class:here aria-current={here ? "true" : undefined}>
        <button
          type="button"
          class="pick"
          class:idle={s.attached === 0}
          role="menuitem"
          disabled={here}
          title={here
            ? tr("pane.tmux.current.title")
            : tr("pane.tmux.switch.title", { name: s.name })}
          onclick={() => onswitch(s.name)}
        >
          <span class="mark menu-mark"
            >{#if here}<UiIcon name="check" size={14} />{/if}</span
          >
          <TmuxStateDot attached={s.attached} title={stateTitle(s)} />
          <span class="name">{s.name}</span>
          <span class="wins" title={tr("pane.tmux.windows.title", { n: s.windows })}
            ><UiIcon name="window" size={11} />{s.windows}</span
          >
          <span class="age">{relativeCreated(s.created, Date.now(), tr)}</span>
        </button>
        <button
          type="button"
          class="side"
          role="menuitem"
          title={tr("pane.tmux.open.title", { name: s.name })}
          aria-label={tr("pane.tmux.open.aria", { name: s.name })}
          onclick={() => onopen(s.name)}
        >
          <UiIcon name="split-h" size={13} />
        </button>
        <!--
          끄기(2026-10-27) — 되돌릴 수 없으니 누르면 확인부터 묻는다. 이 타일이 붙어 있는 줄도 단추는 같고(감추면 "이 세션을
          끄려면 다른 타일로 가라" 가 된다) 툴팁과 확인 글이 "이 타일의 연결도 끝난다" 를 먼저 말한다.
        -->
        <button
          type="button"
          class="side kill"
          role="menuitem"
          title={here
            ? tr("pane.tmux.kill.title_attr_here", { name: s.name })
            : tr("pane.tmux.kill.title_attr", { name: s.name })}
          aria-label={tr("pane.tmux.kill.aria", { name: s.name })}
          data-tmux-kill={s.name}
          onclick={() => onkill(s)}
        >
          <UiIcon name="trash" size={13} />
        </button>
      </div>
    {/each}
  {/if}

  <hr class="menu-sep" />
  <!-- 마지막 줄은 목록과 상관없이 늘 있다 — 읽기에 실패해도 새로 하나 여는 길은 남는다 -->
  <button
    type="button"
    class="pick new"
    role="menuitem"
    title={tr("pane.tmux.new.title")}
    onclick={() => onopen(null)}
  >
    <span class="mark menu-mark"><UiIcon name="plus" size={14} /></span><span
      class="label">{tr("pane.tmux.new")}</span
    >
  </button>
</div>

<style>
  /* 상자·머리글·구분선·그림 칸은 전역 메뉴 한 벌(`theme.css` 의 `.menu-*`)이다 — `PaneMenu` 와
     다르게 생기면 "같은 종류의 목록" 이라는 사실이 화면에서 사라진다. 폭만 넓다(줄마다 이름 +
     부연 한 줄이 든다). 줄(`.pick`)은 두 줄짜리라 `.menu-row` 를 쓰지 않고 여기서 그린다. */
  .tmuxmenu {
    position: fixed;
    z-index: 20;
    min-width: 240px;
    max-width: 320px;
    max-height: 60vh;
    overflow-y: auto;
  }

  /* 제목은 남는 폭을 다 먹고(이름이 길다), 새로고침은 오른쪽 끝에 붙는다 */
  .head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* 머리글(`.menu-title`) — 새로고침 옆에서 남는 폭을 다 먹는다 */
  .group {
    flex: 1;
    min-width: 0;
  }

  /* 새로고침 — 줄의 `side` 버튼과 같은 크기·같은 색 (같은 종류의 작은 손잡이다) */
  .refresh {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    width: 24px;
    height: 24px;
    color: var(--fg-3);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .refresh:hover:not(:disabled),
  .refresh:focus-visible {
    color: var(--fg-2);
    background: var(--surface-hover);
    outline: none;
  }

  .refresh:disabled {
    cursor: default;
  }

  /* 읽는 동안 돌린다 — 목록이 그대로 남아 있으므로 "무엇이 일어나는 중인가" 는 이것뿐이다 */
  .refresh.spinning :global(svg) {
    animation: tmux-spin 0.9s linear infinite;
  }

  @keyframes tmux-spin {
    to {
      transform: rotate(360deg);
    }
  }

  /* 움직임을 줄여 달라고 한 사람에게는 돌리지 않는다 — 흐리게만 (앱의 다른 맥박과 같은 처방) */
  @media (prefers-reduced-motion: reduce) {
    .refresh.spinning :global(svg) {
      animation: none;
      opacity: 0.5;
    }
  }

  /* 로딩·빈 상태·오류 — 누를 수 없는 한 줄이다 */
  .note {
    margin: 0;
    padding: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .note.bad {
    color: var(--err);
  }

  /* 머리글 요약 `●n ○m` — 새로고침 앞, 흐린 숫자 */
  .summary {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }

  .sum {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* 한 줄 = 고르는 버튼(넓게) + 새 타일 버튼(좁게). 이 타일의 줄은 줄 전체에 옅은 판.
     줄 · 고르는 버튼 · 옆 버튼의 칠은 알약(`--radius-row` — 메뉴 한 벌과 같은 모양, 2026-10-29) */
  .row {
    display: flex;
    align-items: stretch;
    gap: var(--space-1);
    border-radius: var(--radius-row);
  }

  .row.here {
    background: var(--surface-hover);
  }

  /* 한 줄짜리 — [✓][점][이름][창 수][나이]. 높이 30px */
  .pick {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: 1;
    min-width: 0;
    box-sizing: border-box;
    min-height: 30px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    text-align: left;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: var(--radius-row);
    cursor: pointer;
  }

  .pick:hover:not(:disabled),
  .pick:focus-visible,
  .side:hover,
  .side:focus-visible {
    background: var(--surface-hover);
    outline: none;
  }

  /* 지금 붙어 있는 줄 — 누를 수 없지만 흐리게 하지 않는다: 체크와 판이 왜인지를 말한다 */
  .pick:disabled {
    cursor: default;
  }

  /* 이름 — mono, 남는 폭을 먹고 말줄임. 비어 있는 세션은 한 톤 흐리게 */
  .name {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: 12.5px;
  }

  .pick.idle .name {
    color: var(--fg-2);
  }

  /* 창 수 · 나이 — 작고 흐린 꼬리. 숫자 폭이 같아 줄끼리 세로로 맞는다 */
  .wins {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .age {
    flex: none;
    min-width: 36px;
    text-align: right;
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  /* 마지막 줄(새 세션) — 그림 칸 + 라벨 */
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 오른쪽 작은 버튼 — 같은 줄의 둘째 · 셋째 행동(새 타일로 열기 · 끄기) */
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
    border-radius: var(--radius-row);
    cursor: pointer;
  }

  /* 끄기 — 손이 닿으면 의미색(포워딩 목록의 중지 단추와 같은 처방 — 되돌릴 수 없는 일이다) */
  .side.kill:hover,
  .side.kill:focus-visible {
    color: var(--err);
  }
</style>
