<script lang="ts">
  /**
   * 토스트 무리 — 창 오른쪽 위에 한 벌(오른쪽 상태바면 그 바로 왼쪽). 독 · 세션 판이 가려도 자리를 바꾸지 않는다 — 토스트가 우선이다.
   * `+page` 에 한 번만 마운트한다 — 두 벌이 뜨면 같은 큐를 두 자리에서 그린다.
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
  /** 오케스트레이션 앨범 · 트랙 화면이면 한 줄 더 아래 — 기본 자리가 판 맨 위 경로 줄 오른쪽 단추 · 앨범 권한 머리(✕)를 덮는다 */
  const belowOrchHead = $derived(activeTab()?.orch?.view === "album" || activeTab()?.orch?.view === "track");

  const reducedMotion = () =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /**
   * `transform` 이 아니라 `translate` 속성으로 민다 — `transform` 은 `animate:flip` 과 떠나는 항목의 제자리 보정이 쓴다
   * (전이가 덮으면 그 보정이 지워져 떠나는 항목이 기둥 맨 위로 튄다).
   * 글래스에서는 상자의 `opacity` 를 움직이지 않는다(theme.css "글래스 면의 등장은 `opacity` 를 움직이지 않는다" · `CheatSheet` 의 `slide` 와 같은 수)
   * — 판 색 · 선 · 그림자와 안의 내용(`--toast-fade`)을 페이드한다. 재질은 전이가 설 때 한 번 본다.
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

  function slideOut(_node: Element): TransitionConfig {
    if (reducedMotion()) return { duration: 0 };
    return { duration: 180, easing: cubicIn, css: slideCss() };
  }

  /** 원 자신이 테두리라 원을 품은 아이콘(`circle-check` · `info`)은 고르지 않는다 — 원이 두 겹이 된다 */
  const MARK = { success: "check", error: "close", info: "bell" } as const;

  const flipMs = () => (reducedMotion() ? 0 : 200);
</script>

<!-- `aria-live` 는 상자에 건다 — 항목마다 걸면 같은 알림이 두 번 읽힌다 -->
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
      <!-- `|global` — 첫 토스트는 기둥과 함께 서고 마지막 토스트는 기둥과 함께 진다. 지역 전이는 부모 블록과 함께 서고 질 때 돌지 않는다 -->
      <!-- 상자는 하나다 — `animate:` 는 each 의 외동 자식이어야 한다 -->
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
        <span class="mark" aria-hidden="true">
          <UiIcon name={MARK[t.kind]} size={12} />
        </span>
        {#if t.detail}
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
          <span class="text two" data-toast-sub
            ><span>{t.text}</span><span class="t-sub"
              >{#each codeSpans(t.sub) as s, i (i)}{#if s.code}<code>{s.text}</code>{:else}{s.text}{/if}{/each}</span
            ></span
          >
        {:else}
          <span class="text">{t.text}</span>
        {/if}
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
  /* 모달(100) · 팔레트(110)보다도 위다 */
  .toasts {
    position: fixed;
    right: calc(var(--sb-inset-right, 0px) + 12px);
    /* 탭 줄 · 위 상태바 · 거터 · 타일 헤더(합 107) 아래 — 헤더 높이 안쪽이면 오른쪽 끝 타일의 닫기 · 최대화를 가린다 */
    top: 112px;
    z-index: 120;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    align-items: flex-end;
    pointer-events: none;
  }

  .toasts.orch {
    top: 164px;
  }

  .toast {
    pointer-events: auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 420px;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-1);
    /* 타일 글자 위에 뜬다 — 평면은 투명도를 타지 않는 판 */
    background: var(--glass-float, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-raised);
    user-select: text;
  }
  /* 글래스 등장 · 퇴장 때 상자 대신 내용이 페이드한다(`slideCss`) */
  .toast > * {
    opacity: var(--toast-fade, 1);
  }

  /* 결은 앞의 둥근 표식 하나로만 말한다 — 상자 배경까지 물들이면 글자 대비가 흔들린다. 알림(info)은 무채 — 강조 셋 밖이다 */
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

  .act {
    flex: none;
  }

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
