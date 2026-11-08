<script lang="ts" generics="S extends string">
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGauge from "$lib/AiGauge.svelte";
  import { closeOnOutside, menuKeydown } from "$lib/pane/chip-menu.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import type { PermStageRow } from "$lib/pane/ai-perm-menu.svelte.js";
  import { t as tr } from "$lib/i18n/i18n.svelte.js";

  /**
   * **머리줄 AI 권한 팝오버** — 원격 타일(2026-10-07 — 원격 세션의 AI 권한 = 호스트 하나의 단계)과
   * 쿼리 타일(10-14 — DB 연결 하나의 단계)이 **같은 상자**를 쓴다.
   *
   * 로컬 타일(10-23 — 예전 "AI 읽기 허용" 토글)도 같은 상자다: 단계는 원격과 같은 다섯이되 Ask 부터 잠기고(`lockedFrom`), 아래에
   * 각주 한 줄(`footnote` — "로컬 타일은 AI 실행 대상이 아닙니다 …")이 서며 설정 링크는 없다(`settingsLabel` 없음).
   *
   * 머리줄의 권한 칩과 ⋯ 메뉴의 "AI 권한…" 이 연다. 안에 드는 것은 제목("{이름} 의 AI 권한") · 부제 ·
   * (있으면) 안내 줄 · 단계 게이지(`AiGauge` 좁은 꼴 — 10-23, 예전 단계 라디오 줄) · 구분선 · (원격만) 헤드리스 접속 토글(단계 < 승인 후
   * 실행이면 잠김) · 설정 링크("호스트 설정 › AI" · "DB 연결 설정").
   *
   * 상자·좌표·몸짓(바깥 클릭·Escape·↑↓)은 `TmuxMenu` · `PaneMenu` 와 **같은 규칙**이고 전역 메뉴 한 벌
   * (`theme.css` 의 `.menu-*`)을 쓴다.
   *
   * ## 이 컴포넌트가 모르는 것
   *
   * 저장이 어떻게 되는지, 어느 타일이 대상인지, 단계가 몇 개인지는 모른다. 단계 줄은 부르는 쪽이 넘기고(`stages`),
   * 고른 결과를 `onpick(stage)` · `headless.onchange(on)` · `onsettings()` 로 올린다. 저장(원격 `delegation_set_target` ·
   * DB `db_ai_set`)과 통로(`runOnMenu` — 상자를 닫는 줄만)는 `pane/ai-perm-menu.svelte.ts` · `pane/db-ai-menu.svelte.ts`
   * 가 든다 (docs/conventions.md "메뉴를 닫는 코드").
   */
  let {
    title,
    sub,
    /**
     * 이 팝오버를 연 타일의 코드(`p3`) — 제목 줄 끝에 흐리게(이름 카드 `SessionInfoCard` 의 `.s-code` 와 같은 모양).
     * 원격 타일 머리줄에는 코드 칩이 없어서(2026-10-11) 권한을 만지는 자리에서 "AI 가 이 코드로 본다" 를 맞춘다.
     */
    code,
    /** 고를 단계들(낮은 것부터) */
    stages,
    /**
     * 지금 단계 (권한 표 사본에서 온다 — 고르면 곧 바뀐다). `null` 이면 어느 줄도 고른 표시가 없다
     * (DB 연결의 대상이 바뀌어 권한이 풀렸을 때 — 다시 고르게 한다).
     */
    stage,
    /** 부제 아래 안내 줄(경고색) — 풀림 · 이전 판 서버 등 */
    notes = [],
    /** 헤드리스 접속 토글 — 원격만(없으면 그 줄과 구분선을 그리지 않는다) */
    headless = null,
    settingsLabel = null,
    lockedFrom,
    footnote = null,
    left,
    top,
    onpick,
    onsettings,
    onclose,
  }: {
    title: string;
    sub: string;
    code: string;
    stages: readonly PermStageRow<S>[];
    stage: S | null;
    notes?: readonly string[];
    headless?: { on: boolean; allowed: boolean; onchange: (on: boolean) => void } | null;
    /** 상자를 닫고 설정 화면을 여는 줄 — 없으면(로컬 타일) 그 줄과 구분선을 그리지 않는다 */
    settingsLabel?: string | null;
    /** 이 자리부터 잠긴다(게이지 `lockedFrom`) — 로컬 타일은 2(Off · Read 만) */
    lockedFrom?: number;
    /** 맨 아래 흐린 한 줄(로컬 타일 — 왜 잠겼는가) */
    footnote?: string | null;
    left: number;
    top: number;
    onpick: (stage: S) => void;
    onsettings?: () => void;
    onclose: (back: "none" | "trigger") => void;
  } = $props();

  const stageIds = $derived(stages.map((s) => s.id));
  const rowOf = (id: S): PermStageRow<S> => stages.find((s) => s.id === id)!;
  /** 맨 위 단계(모두 승인)면 상자 테두리가 따뜻해진다(게이지 카드와 같은 말 — 목업) */
  const yolo = $derived(stage !== null && stages.length > 0 && stages[stages.length - 1].id === stage);

  let el = $state<HTMLElement | null>(null);

  /** 넘침 잡기 + 뜨면 자신에 포커스 — `TmuxMenu` 와 같은 처방 */
  let clamped = $state<number | null>(null);
  const shownTop = $derived(clamped ?? top);
  $effect(() => {
    const node = el;
    const t = shownTop;
    if (!node) return;
    const max = window.innerHeight - 8 - node.offsetHeight;
    if (t > max) {
      clamped = Math.max(8, max);
      return;
    }
    if (!node.contains(document.activeElement)) {
      // 게이지의 고른 단추에 포커스 — ←→ 가 곧바로 돈다(고른 것이 없으면 게이지의 첫 자리 — `data-gauge-stop`)
      const cur = node.querySelector<HTMLButtonElement>("[data-gauge-stop]") ?? node.querySelector<HTMLButtonElement>("[data-ai-item]");
      (cur ?? node).focus({ preventScroll: true });
    }
  });

  /** 바깥을 누르면 닫는다 — 머리줄의 권한 칩만 비켜 간다(`data-ai-menu-btn` — tmux 칩과 같은 이유) */
  $effect(() => closeOnOutside(() => el, "[data-ai-menu-btn]", onclose));

  /** ↑↓·Home/End 로 돌고 Escape 로 닫는다 — Escape 는 여기서 끊는다(뒤 화면까지 닫지 않게) */
  function onKey(ev: KeyboardEvent) {
    // 게이지(고른 단추 하나) · 헤드리스 스위치(잠기지 않았을 때) · 링크 — 문서 순서 그대로 돈다
    menuKeydown(ev, el, "[data-gauge-stop], [data-ai-item]:not(:disabled), .headless input:not(:disabled)", onclose);
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="aimenu menu-surface"
  class:yolo
  role="menu"
  aria-label={title}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{shownTop}px"
  onkeydown={onKey}
  data-ai-menu
>
  <div class="head">
    <div class="title-row">
      <p class="title">{title}</p>
      <span class="code" data-ai-menu-code>{code}</span>
    </div>
    <p class="sub">{sub}</p>
    {#each notes as note (note)}
      <p class="note" role="note" data-ai-menu-note>{note}</p>
    {/each}
  </div>

  <!--
    단계 — 게이지 좁은 꼴(10-23 — `AiGauge.svelte`). 예전 단계 줄 다섯(라디오 · 그림 · 이름 + 설명)을 대신한다. ←→ 로 고르고(게이지가 받는다),
    ↑↓ 는 이 상자의 줄 사이를 돈다 — 게이지는 고른 단추 하나(`data-gauge-stop`)가 한 줄이다.
  -->
  <div class="gauge-row">
    <AiGauge
      levels={stageIds}
      value={stage}
      nameOf={(id) => tr(rowOf(id).name)}
      descOf={(id) => tr(rowOf(id).desc)}
      label={title}
      compact
      {lockedFrom}
      onpick={(id) => onpick(id)}
    />
  </div>

  {#if headless}
    {@const h = headless}
    <hr class="menu-sep" />

    <!--
      헤드리스 접속 — 단계가 승인 후 실행 아래면 잠긴다(켤 수 없다). 줄 전체가 하나의 스위치다:
      `Toggle` 의 칸이 `label` 안에 들어 줄 어디를 눌러도 뒤집히고, ↑↓ 는 그 칸에 멈춘다(Space 로 뒤집는다).
    -->
    <label class="headless" class:locked={!h.allowed} title={tr("app.ai.headless.desc")}>
      <span class="text">
        <span class="name">{tr("app.ai.headless")}</span>
        <span class="desc">{tr("app.ai.headless.desc")}</span>
      </span>
      <span class="switch">
        <Toggle
          checked={h.on && h.allowed}
          disabled={!h.allowed}
          label={tr("app.ai.headless")}
          onchange={(v) => h.onchange(v)}
        />
      </span>
    </label>
  {/if}

  {#if settingsLabel}
    <hr class="menu-sep" />

    <button type="button" class="menu-row link" role="menuitem" data-ai-item onclick={() => onsettings?.()}>
      <span>{settingsLabel}</span>
      <span class="menu-kbd"><UiIcon name="chevron" size={12} /></span>
    </button>
  {/if}

  {#if footnote}
    <hr class="menu-sep" />
    <p class="foot" role="note" data-ai-menu-foot>{footnote}</p>
  {/if}
</div>

<style>
  /* 상자·구분선은 전역 메뉴 한 벌(`theme.css` 의 `.menu-*`) — 자리와 폭만 여기 */
  .aimenu {
    position: fixed;
    z-index: 20;
    width: 320px;
    max-width: calc(100vw - 16px);
    max-height: 80vh;
    overflow-y: auto;
  }

  .head {
    padding: var(--space-1) var(--space-2) var(--space-2);
  }

  /* 제목 + 타일 코드 — 이름 카드의 머리 줄(`.s-title`)과 같은 배치: 제목이 먼저 줄고 코드는 줄지 않는다 */
  .title-row {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  /* 이름 카드의 `.s-code` 와 같은 모양 — mono · 흐린 글자 · 판 없음 */
  .code {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }

  .title {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sub {
    margin: 2px 0 0;
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--fg-3);
  }

  /* 안내 줄 — 풀림 · 이전 판 서버(DB 연결 폼의 `.ai-desc.warn` 과 같은 말) */
  .note {
    margin: var(--space-1) 0 0;
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--warn);
    word-break: keep-all;
  }

  /* 게이지 자리 — 머리 글자와 같은 안쪽 여백 */
  .gauge-row {
    padding: 0 var(--space-2) var(--space-2);
  }

  /* 모두 승인 — 상자 테두리가 따뜻해진다(게이지 카드의 `.yolo` 와 같은 말). 전역 `.menu-surface` 보다 특이도가 높다 */
  .aimenu.yolo {
    border-color: var(--ai-all-line);
  }

  .text {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .name {
    font-size: var(--t-sm);
    line-height: 1.3;
  }

  .desc {
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--fg-3);
    word-break: keep-all;
  }

  /* 헤드리스 접속 — 이름 + 설명 · 오른쪽 끝 스위치 */
  .headless {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    padding: 6px var(--space-2);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .headless .text {
    flex: 1;
  }

  .headless.locked {
    cursor: default;
  }

  .headless.locked .name {
    color: var(--fg-3);
  }

  .switch {
    flex: none;
    margin-top: 2px;
  }

  /* 각주(로컬 타일 — 왜 Ask 부터 잠겼는가) — 부제와 같은 흐린 글자 */
  .foot {
    margin: 0;
    padding: var(--space-1) var(--space-2) var(--space-1);
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--fg-3);
    word-break: keep-all;
  }

  /* "호스트 설정 › AI" — 메뉴 줄 한 벌 + 오른쪽 `›` */
  .link {
    display: flex;
    align-items: center;
    color: var(--fg-2);
  }
</style>
