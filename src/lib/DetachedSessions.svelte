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
  import {
    detachedDbStatus,
    detachedName,
    detachedWindowName,
    iconPaneForDetached,
    type DetachedSession,
  } from "$lib/session/detached";
  import { relativeTime } from "$lib/notifications";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import PaneIcon from "$lib/PaneIcon.svelte";
  import { findDbConn } from "$lib/app/db-conns.svelte.js";
  import { dbAiLevelOf } from "$lib/app/db-ai.svelte.js";
  import { DB_AI_NAME } from "$lib/db-ai";

  /**
   * **떨어진 세션** 묶음 — 세션 목록 판(`SessionSheet`)의 맨 위(③-4 · 설계 4.5). 아무 창도 데려가지 않은 세션이 하나라도
   * 있을 때만 선다. 줄마다 아이콘 · 이름 · 마지막 창 · 떨어진 시각 · 마지막 출력 + [새 탭에 붙이기] [닫기]. 쿼리 타일(`db` — 2026-11-09 ②)은
   * 마지막 출력 대신 짧은 상태(읽기 전용 · 쓰기 · 트랜잭션 열림 · AI 권한)를 싣는다 — 이름 · AI 권한은 앱의 사본에서 연결 id 로 푼다.
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

  function dbName(id: string): string | null {
    return findDbConn(id)?.name ?? null;
  }

  function meta(s: DetachedSession): string {
    const window = detachedWindowName(s.home, t);
    if (s.kind === "db") {
      const level = s.conn ? dbAiLevelOf(s.conn) : "off";
      const ai = level === "off" ? null : t(DB_AI_NAME[level]);
      return t("app.detached.metaDb", { window, detached: when(s.detachedAt), status: detachedDbStatus(s, ai, t) });
    }
    return t("app.detached.meta", { window, detached: when(s.detachedAt), output: when(s.lastOutputAt) });
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
          <span class="ico" aria-hidden="true"><PaneIcon pane={iconPaneForDetached(s)} size={14} /></span>
          <span class="names">
            <span class="name">{detachedName(s, t, dbName)}</span>
            <span class="meta">{meta(s)}</span>
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

  .ico {
    flex: none;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: var(--surface-field);
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
