<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    attachDetachedInNewTab,
    closeDetached,
    detachedReveal,
    detachedSessions,
    refreshDetached,
  } from "$lib/app/detached.svelte.js";
  import { closeSessionSheet } from "$lib/app/session-sheet.svelte.js";
  import { detachedName, detachedWindowName, type DetachedSession } from "$lib/session/detached";
  import { relativeTime } from "$lib/notifications";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **떨어진 세션** 묶음 — 세션 목록 판(`SessionSheet`)의 맨 위(③-4 · 설계 4.5). 아무 창도 데려가지 않은 세션이 하나라도
   * 있을 때만 선다. 줄마다 이름 · 마지막 창 · 떨어진 시각 · 마지막 출력 + [새 탭에 붙이기] [닫기].
   * 상태는 `app/detached` — 여기는 그리기와 단추뿐이다.
   *
   * (오케스트레이션 3차 3b) 작업자는 헤드리스 턴이라 세션이 없다 — "Run 작업자" 묶음은 걷었다.
   */

  const rows = $derived(detachedSessions());
  let now = $state(Date.now());
  let busy = $state<string | null>(null);
  let sectionEl = $state<HTMLElement | null>(null);

  onMount(() => {
    void refreshDetached();
    const timer = setInterval(() => (now = Date.now()), 30_000);
    return () => clearInterval(timer);
  });

  // 부팅 안내 [보기] · 독 · 트레이에서 왔다 — 이 묶음을 보인다.
  $effect(() => {
    if (detachedReveal() === 0) return;
    void tick().then(() => sectionEl?.scrollIntoView({ block: "nearest" }));
  });

  function when(at: number | null): string {
    return at === null ? t("app.detached.never") : relativeTime(at, now, t);
  }

  function attach(s: DetachedSession) {
    closeSessionSheet(false);
    attachDetachedInNewTab(s);
  }

  async function close(s: DetachedSession) {
    busy = s.stream;
    try {
      await closeDetached(s.stream);
    } finally {
      busy = null;
    }
  }
</script>

{#if rows.length > 0}
  <section class="detached" data-detached-group aria-label={t("app.detached.title")} bind:this={sectionEl}>
    <div class="label">{t("app.detached.title")}<b>{rows.length}</b></div>
    <p class="lead">{t("app.detached.lead")}</p>
    <ul class="rows">
      {#each rows as s (s.stream)}
        <li class="row" data-detached-row={s.stream} data-detached-kind={s.kind}>
          <span class="names">
            <span class="name">{detachedName(s, t)}</span>
            <span class="meta"
              >{t("app.detached.meta", {
                window: detachedWindowName(s.home, t),
                detached: when(s.detachedAt),
                output: when(s.lastOutputAt),
              })}</span
            >
          </span>
          <button
            type="button"
            class="btn btn-sm btn-secondary"
            data-detached-attach={s.stream}
            disabled={busy === s.stream}
            onclick={() => attach(s)}>{t("app.detached.attach")}</button
          >
          <button
            type="button"
            class="btn btn-sm btn-ghost"
            data-detached-close={s.stream}
            disabled={busy === s.stream}
            onclick={() => void close(s)}>{t("app.detached.close")}</button
          >
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .detached {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .label {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-1);
    font-size: 11px;
    font-weight: var(--fw-semibold);
    letter-spacing: 0.04em;
    color: var(--fg-3);
  }

  .label b {
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }

  .lead {
    margin: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    /* 판(세션 목록 판 · 독)이 이미 칠한다 — 글래스는 투명(`--glass-inner`, 반투명 두 겹 방지), 평면은 예전 불투명 면 */
    background: var(--glass-inner, var(--surface-raised-solid));
  }

  .names {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .name {
    font-size: var(--t-sm);
    color: var(--fg-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .meta {
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
