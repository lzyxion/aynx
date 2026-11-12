<script lang="ts">
  /**
   * 토스트 무리 — 창 오른쪽 위에 한 벌 (docs/log/2026-09-04-ui-polish-zoom-toast-cheatsheet.md).
   * 오른쪽 상태바면 그 바로 왼쪽에 붙고, 독 · 세션 판은 가려도 자리를 바꾸지 않는다 — 토스트 알림이 우선이다(2026-11-04 사용자 결정 ·
   * 예전의 "오른쪽 상태바면 왼쪽에 뜬다" 는 낡은 규칙이라 걷었다 · docs/log/2026-11-04-toast-position.md).
   *
   * 큐는 이 컴포넌트의 것이 아니다 (`$lib/toast.svelte`). 여기가 하는 일은 셋뿐이다:
   * **그리기 · 호버로 시계 멈추기 · 닫기 버튼**. 상태를 밖에 둔 덕에 어느 타일에서
   * 밀어 넣어도 알림이 그 타일의 크기·수명에 갇히지 않는다.
   *
   * `+page` 에 **한 번만** 마운트한다 — 두 벌이 뜨면 같은 큐를 두 자리에서 그린다.
   *
   * ## 검토 대기 카드는 여기 없다 (2026-09-27)
   *
   * 2026-09-22 부터 닷새 동안 **검토 대기 카드**(`ReviewCard.svelte`)가 이 기둥의 고정 첫
   * 칸이었다(docs/log/2026-09-22-review-card.md). 카드가 명령 전문과 승인 단추를 싣게 되면서
   * 토스트 자리(오른쪽 위 한 줄짜리)에 맞지 않게 커졌고, 제 자리 — `.body` 의 아래 가운데 —
   * 로 나갔다(docs/log/2026-09-27-review-popup-card.md). 이 기둥은 다시 **토스트만** 그린다.
   */
  import { dismiss, holdToasts, releaseToasts, toasts } from "$lib/toast.svelte";
  import { activeTab } from "$lib/app/tabs.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import { codeSpans } from "$lib/code-spans";
  // `{#each toasts as t}` 가 이미 `t` 를 쓰고 있어 사전 창구는 `tr` 로 들인다 (이 파일만의 예외)
  import { t as tr } from "$lib/i18n/i18n.svelte.js";
  import { cubicIn, cubicOut } from "svelte/easing";
  import { flip } from "svelte/animate";
  import type { TransitionConfig } from "svelte/transition";
  /** 오케스트레이션 탭의 앨범 · 트랙 화면이 앞에 있으면 한 줄 더 아래 — 판 맨 위 경로 줄 오른쪽 끝 단추([새 탭으로 열기] · 이웃 트랙)와
   *  앨범 권한 머리(✕)를 기본 자리(112px)가 덮었다(실기 10-31). 라이브러리 · 아티스트 · 새 앨범은 그 줄 오른쪽이 비어 그대로 둔다 */
  const belowOrchHead = $derived(activeTab()?.orch?.view === "album" || activeTab()?.orch?.view === "track");

  /** 사용자가 움직임을 줄여 달라고 했는가 (PaneHost 의 `tileIn` 과 같은 질문) */
  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * 놓인 쪽의 창 **바깥에서** 미끄러져 들어온다 — 거리는 제 폭 + 기둥의 오른쪽 여백(12px)과
   * 여유 한 뼘이라, 첫 프레임에 한 조각도 창 안에 걸치지 않는다.
   *
   * `transform` 이 아니라 **`translate` 속성**으로 민다. `transform` 칸은 둘이 이미 쓴다 —
   * `animate:flip` 이 자리 옮김을, Svelte 가 떠나는 항목을 제자리에 붙들어 두는 보정
   * (`position:absolute` + `transform: translate(…)`)을 거기 적는다. 같은 칸을 전이가
   * 덮으면 그 보정이 지워져 떠나는 항목이 기둥 맨 위로 튄다. `translate` 는 `transform`
   * 과 **합성**되는 별개 속성이라 셋이 서로를 지우지 않는다.
   *
   * **글래스에서는 상자의 `opacity` 를 움직이지 않는다**(10-29 — theme.css "글래스 면의 등장은 opacity 를 움직이지 않는다" ·
   * `CheatSheet` 의 `slide` 와 같은 수). `opacity` 가 1 아래인 동안 상자가 배경 뿌리가 되어 `.glass-raised` 의 흐림 판(`::before`)이
   * 창 뒤를 못 보고, 움직임이 끝나는 순간 유리가 툭 켜진다. 그래서 글래스는 판 색 · 선 · 그림자와 안의 내용(`--toast-fade` →
   * `.toast > *`)을 페이드한다 — 흐림 판은 처음부터 서 있다. 평면은 예전 그대로 상자의 `opacity` 다. 재질은 전이가 설 때 한 번 본다.
   */
  function slideCss(): (t: number, u: number) => string {
    const glass = document.documentElement.dataset.material === "glass";
    return (t, u) => {
      const move = `translate:calc(${u} * (100% + 24px)) 0`;
      if (!glass) return `opacity:${t};${move}`;
      const p = `${(t * 100).toFixed(1)}%`;
      return (
        `${move};--toast-fade:${t.toFixed(3)};` +
        `background-color:color-mix(in srgb, var(--glass-float) ${p}, transparent);` +
        `border-color:color-mix(in srgb, var(--glass-rim) ${p}, transparent);` +
        // 모양은 `--glass-shadow` 와 같은 값 — 끝 프레임이 쉬는 상태와 같다
        `box-shadow:0 8px 32px color-mix(in srgb, var(--glass-shadow-color) ${p}, transparent)`
      );
    };
  }

  function slideIn(_node: Element): TransitionConfig {
    if (reducedMotion()) return { duration: 0 };
    return { duration: 220, easing: cubicOut, css: slideCss() };
  }

  /**
   * 떠날 때는 놓인 쪽으로 **되돌아 나간다**. 자리는 Svelte 가 먼저 비운다 — `animate:` 가
   * 걸린 keyed each 는 떠나는 항목을 `position:absolute` 로 띄워 흐름에서 빼므로, 아래
   * 것들은 그 순간부터 `flip` 으로 미끄러져 올라온다(빈자리가 남았다가 한꺼번에 튀지 않는다).
   */
  function slideOut(_node: Element): TransitionConfig {
    if (reducedMotion()) return { duration: 0 };
    return { duration: 180, easing: cubicIn, css: slideCss() };
  }

  /**
   * 결마다 원 안에 세울 아이콘. 오류의 `x` 는 오른쪽 닫기 단추와 같은 그림이지만 저쪽은
   * 흐린 맨 글자, 이쪽은 붉은 원 안이라 섞이지 않는다. 알림(info)은 종(`bell`)으로 말한다.
   */
  const MARK = { success: "check", error: "close", info: "bell" } as const;

  /** 남은 것들이 새 자리로 미끄러지는 시간 — 줄여 달라고 했으면 0(그 자리로 곧장) */
  const flipMs = () => (reducedMotion() ? 0 : 200);
</script>

<!--
  `aria-live` 는 상자에 건다 — 항목마다 걸면 같은 알림이 두 번 읽힌다. 오류만 `assertive`
  로 올릴 수도 있지만 그러려면 상자가 둘이어야 하고, 그때는 두 줄이 서로 다른 자리에서
  쌓인다. 여기서는 한 상자에 모으고 결은 색과 앞의 표식이 말한다.
-->
{#if toasts.length > 0}
  <div
    class="toasts"
    class:orch={belowOrchHead}
    role="status"
    aria-live="polite"
    onmouseenter={holdToasts}
    onmouseleave={releaseToasts}
  >
    {#each toasts as t (t.id)}
      <!-- `|global` — 기둥은 `{#if}` 안이라 **첫 토스트는 기둥과 함께 서고 마지막 토스트는
           기둥과 함께 진다**. 지역 전이는 부모 블록이 함께 서고 질 때 돌지 않으므로, 그대로
           두면 정작 가장 흔한 판(혼자 뜨고 혼자 지는 한 줄)이 미끄러지지 않는다. -->
      <!-- 상자는 하나다(`animate:` 는 each 의 외동 자식이어야 한다) — 몸만 둘로 갈린다: **알림 카드**(`ToastNotice` — 2026-11-12
           업데이트 알림 목업 · 아이콘 | 제목 · 흐린 줄 · 단추 줄(주 동작 채움 · 나머지 테) + 오른쪽 위 ×, `row` 면 한 줄)와 보통 토스트 -->
      <div
        class="toast glass-raised {t.notice ? 'notice' : t.kind}"
        class:row={t.notice?.row}
        data-toast={t.tag ?? null}
        in:slideIn|global
        out:slideOut|global
        animate:flip={{ duration: flipMs() }}
      >
        {#if t.notice}
          <span class="n-icon {t.notice.tone}" aria-hidden="true"><UiIcon name={t.notice.icon} size={t.notice.row ? 16 : 20} /></span>
          <span class="n-body">
            <span class="n-title">{t.notice.title}</span>
            {#if t.notice.sub}<span class="n-sub">{t.notice.sub}</span>{/if}
            {#if !t.notice.row && t.actions.length > 0}
              <span class="n-acts">
                {#each t.actions as act (act.label)}
                  <button
                    type="button"
                    class="btn btn-sm {act.primary ? 'btn-primary' : 'btn-ghost outline'}"
                    data-toast-action={act.id ?? null}
                    onclick={() => {
                      act.run();
                      dismiss(t.id);
                    }}>{act.label}</button
                  >
                {/each}
              </span>
            {/if}
          </span>
          {#if t.notice.row}
            {#each t.actions as act (act.label)}
              <button
                type="button"
                class="act btn btn-sm {act.primary ? 'btn-primary' : 'btn-ghost outline'}"
                data-toast-action={act.id ?? null}
                onclick={() => {
                  act.run();
                  dismiss(t.id);
                }}>{act.label}</button
              >
            {/each}
          {/if}
          <button type="button" class="x" aria-label={tr("app.toast.dismiss")} onclick={() => dismiss(t.id)}
            ><UiIcon name="close" size={13} /></button
          >
        {:else}
        <!-- 결의 표식 — 둥근 원 안의 아이콘. 원 자신이 테두리라 **원을 품은 아이콘**
             (`circle-check`·`info`)은 고르지 않는다(원이 두 겹이 된다). -->
        <span class="mark" aria-hidden="true">
          <UiIcon name={MARK[t.kind]} size={12} />
        </span>
        {#if t.detail}
          <!-- 두 줄짜리 몸 (`ToastDetail`) — 머리 + 부제(앞 토막만 결의 색). 작업안 실행 결과 알림 -->
          <span class="text two" data-toast-detail
            ><span class="t-head"
              ><span class="t-head-text">{t.detail.head}</span>{#if t.detail.chip}<span
                  class="chip"
                  title={t.detail.chipTitle}>{t.detail.chip}</span
                >{/if}</span
            ><span class="t-sub"
              ><span class="lead {t.detail.tone ?? 'plain'}">{t.detail.lead}</span>{#if t.detail.tail}&nbsp;·
                {t.detail.tail}{/if}</span
            ></span
          >
        {:else if t.sub}
          <!-- 글 + 흐린 보조 줄 (`ToastOpts.sub`) — 백틱 구간만 인라인 코드, HTML 은 해석하지 않는다 -->
          <span class="text two" data-toast-sub
            ><span>{t.text}</span><span class="t-sub"
              >{#each codeSpans(t.sub) as s, i (i)}{#if s.code}<code>{s.text}</code>{:else}{s.text}{/if}{/each}</span
            ></span
          >
        {:else}
          <span class="text">{t.text}</span>
        {/if}
        <!-- 버튼은 여럿일 수 있다 — 왼쪽부터 **다음 걸음 순서**다 (`ToastItem.actions`) -->
        {#each t.actions as act (act.label)}
          <button
            type="button"
            class="act btn btn-secondary btn-sm"
            data-toast-action={act.id ?? null}
            onclick={() => {
              act.run();
              dismiss(t.id);
            }}
          >
            {act.label}
          </button>
        {/each}
        <button type="button" class="x" aria-label={tr("app.toast.dismiss")} onclick={() => dismiss(t.id)}
          ><UiIcon name="close" size={13} /></button
        >
        {/if}
      </div>
    {/each}
  </div>
{/if}

<style>
  /*
    모달(100)·팔레트(110)보다도 위다. 토스트는 무엇 위에서든 **방금 일어난 일**을 말하는
    자리이고, 화면 구석 한 줄이라 밑의 화면을 가리지도 않는다.
  */
  .toasts {
    position: fixed;
    /* 오른쪽 상태바면 그 폭만큼 비킨다(`--sb-inset-right` — `+page` · 독과 같은 값 · 폰 배치는 늘 위 띠라 값이 없다) */
    right: calc(var(--sb-inset-right, 0px) + 12px);
    /* 우측 **상단** — 탭 줄(37px)·위에 둔 상태 표시줄(30px)·거터(8px)·타일 헤더(32px) 아래
       (2026-09-25 작업면 단계에서 탭 줄·헤더가 커져 100 → 112 — 위 합이 107이다).
       아래 구석은 프롬프트·시작 화면 즐겨찾기가 있는 자리라 알림이 그 위를 덮었고, 헤더 높이
       안쪽에 두면 오른쪽 끝 타일의 닫기·최대화 버튼을 가린다 (2026-09-15, 사용자). 상태
       표시줄을 다른 가장자리로 옮기거나 헤더를 숨기면 여백이 남을 뿐 겹치지 않는다.
       새것이 맨 위에 들어오고 있던 것들은 한 칸씩 내려간다 — 순서는 큐가
       정한다(`toasts` 주석). */
    top: 112px;
    z-index: 120;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-end;
    pointer-events: none; /* 빈 자리로는 클릭이 그대로 통과한다 */
  }

  /* 오케스트레이션 탭 — 경로 줄(위 여백 14 + ← 32)과 권한 판 머리(여백 18 + ✕ 30)를 지나서. 다른 탭은 그대로 */
  .toasts.orch {
    top: 164px;
  }

  .toast {
    pointer-events: auto; /* 항목 자신은 잡힌다 (호버로 멈추고 버튼을 누른다) */
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 420px;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-1);
    /* 타일 글자 위에 뜬다 — 평면은 투명도 슬라이더를 타지 않는 뜬 면 판 (토큰층 "투명도"), 글래스면 중 층 유리 */
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-raised);
    user-select: text;
  }
  /* 글래스 등장 · 퇴장 때 상자 대신 내용이 페이드한다(`slideCss`) — 쉬는 동안은 값이 없어 1 */
  .toast > * {
    opacity: var(--toast-fade, 1);
  }

  /*
    결은 **앞의 둥근 표식 하나**로만 말한다 (2026-09-25 — 왼쪽 띠를 걷었다,
    docs/log/2026-09-25-toast-redesign.md). 원은 결의 색을 옅게 깐 바탕에 같은 색의 획 —
    상자 배경까지 물들이면 글자 대비가 흔들리므로 색은 이 20px 안에만 둔다.
    `--mark` 하나만 결마다 갈아 끼운다. 알림(info)은 **무채(`--fg-2`)** 다 —
    정보 알림은 강조 셋(선택된 행 · 주 동작 · 입력 대기) 밖이라 강조색을 쓰지 않는다.
  */
  .mark {
    --mark: var(--fg-2);
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    border-radius: 50%;
    color: var(--mark);
    background: color-mix(in srgb, var(--mark) 18%, transparent);
  }
  .toast.success .mark {
    --mark: var(--ok);
  }
  .toast.error .mark {
    --mark: var(--err);
  }

  .text {
    flex: 1 1 auto;
    min-width: 0;
  }

  /* 두 줄짜리 몸 — 머리는 한 줄에 가두고(말줄임), 부제는 한 치수 작게·회색. 결의 색은 부제의
     앞 토막에만 둔다(표식 원과 같은 결 — 상자 전체를 물들이지 않는다). */
  .text.two {
    display: grid;
    gap: 1px;
  }
  .t-head {
    display: flex;
    align-items: center;
    min-width: 0;
    color: var(--fg-1);
  }
  .t-head-text {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chip {
    flex: none;
    margin-left: 6px;
    padding: 0 6px;
    font-size: var(--t-xs);
    line-height: 18px;
    color: var(--fg-2);
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
  }
  .t-sub {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  /* 보조 줄의 인라인 코드 (`ToastOpts.sub`) */
  .t-sub code {
    font-family: var(--font-mono);
    padding: 0 4px;
    color: var(--fg-1);
    background: var(--surface-hover);
    border-radius: var(--radius-sm);
  }
  .lead.good {
    color: var(--ok);
    font-weight: 600;
  }
  .lead.bad {
    color: var(--err);
    font-weight: 600;
  }

  /* 다음 걸음 단추 — 전역 `.btn .btn-secondary .btn-sm` (옛 선 두른 강조색 글자는 지웠다 —
     토스트는 화면의 주 동작 자리가 아니다). 여기서는 줄지 않게만 */
  .act {
    flex: none;
  }

  /* 알림 카드(`ToastNotice`) — 340px 카드: 아이콘 | 제목 · 흐린 줄 · 단추 줄, × 는 오른쪽 위. `row` 는 한 줄 */
  .toast.notice {
    position: relative;
    align-items: flex-start;
    gap: var(--space-3);
    box-sizing: border-box;
    width: min(340px, calc(100vw - 24px));
    max-width: none;
    padding: var(--space-3) var(--space-4) var(--space-3) var(--space-3);
    border-radius: var(--radius-surface);
  }
  .toast.notice.row {
    align-items: center;
    gap: var(--space-2);
    width: auto;
    max-width: 460px;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
  }
  .n-icon {
    flex: none;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    color: var(--n-tone);
    background: color-mix(in srgb, var(--n-tone) 16%, transparent);
  }
  .n-icon.accent {
    --n-tone: var(--accent);
  }
  .n-icon.ok {
    --n-tone: var(--ok);
  }
  .toast.notice.row .n-icon {
    width: 24px;
    height: 24px;
  }
  .n-body {
    flex: 1 1 auto;
    min-width: 0;
    display: grid;
    gap: 2px;
  }
  .n-title {
    font-weight: var(--fw-semibold);
    overflow-wrap: anywhere;
  }
  .toast.notice.row .n-title {
    font-weight: var(--fw-regular);
    white-space: nowrap;
  }
  .n-sub {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .n-acts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }
  /* 테 두른 단추 — 전역 `.btn-ghost` 에 선 하나(주 동작은 `.btn-primary` 채움) */
  .toast.notice .outline {
    color: var(--fg-1);
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }
  .toast.notice:not(.row) .x {
    position: absolute;
    top: var(--space-2);
    right: var(--space-2);
  }

  .x {
    flex: none;
    /* `UiIcon` 은 `display:block` 이라 버튼 안에서 저절로 가운데 서지 않는다 */
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    padding: 0;
    line-height: 1;
    color: var(--fg-3);
    background: transparent;
    border: 0;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }
  .x:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }
</style>
