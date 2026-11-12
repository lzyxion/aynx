<script lang="ts">
  // **업데이트 카드**(2026-11-12 — 사용자 승인 목업) — 상태바 업데이트 칩 · 새 판 알림의 [바뀐 점 보기]가 연다. 상태 · 실행은
  // `app/updater`(사본 · 받기 · 건너뛰기 · 다시 시작), 판정은 순수 `$lib/updater`. 꼴은 `ConfirmDialog` 와 같은 글래스 모달(Tab 순환
  // `trapTab` · 바깥 누르기 · Esc = [나중에]). **고르기 전에는 아무것도 받거나 깔지 않는다** — [업데이트]가 받기를, [지금 다시 시작]이
  // 설치를 연다. 받는 동안 닫아도 받기는 이어진다(칩이 진행을 보인다).
  //
  // 경고 상자의 바쁜 세션 — 이 창(주 창)의 카드 판(`console/window-cards` — 보조 창 타일 포함)에서 도는 AI 턴 · 셸에서 도는 명령,
  // 실행 중인 작업안(`app/pending-plans`). 끝날 세션 수는 세션 서버가 센 수(`session_server_status` — 떨어진 세션 포함)다.
  import { tick, untrack } from "svelte";
  import { openUrl } from "@tauri-apps/plugin-opener";
  import { trapTab } from "$lib/focus-trap";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import { isWebUrl, parseMarkdown } from "$lib/markdown";
  import { megabytes, percent, summarizeBusy, type BusySummary } from "$lib/updater";
  import {
    closeUpdateCard,
    downloadUpdate,
    liveSessions,
    restartToUpdate,
    skipUpdate,
    updateCardOpen,
    updateRestarting,
    updateView,
  } from "$lib/app/updater.svelte.js";
  import { windowSessionCards } from "$lib/console/window-cards";
  import { runningPlans } from "$lib/app/pending-plans.svelte.js";
  import { planName } from "$lib/running-now";

  let modalEl = $state<HTMLElement | null>(null);
  let primary = $state<HTMLButtonElement | null>(null);
  let sessions = $state<number | null>(null);

  const view = $derived(updateView());
  const open = $derived(updateCardOpen() && view !== null && view.available !== null);
  const avail = $derived(view?.available ?? null);
  const phase = $derived(view?.phase ?? "idle");

  // 뜰 때마다 세션 수를 새로 읽고 주 단추에 커서를 놓는다 — 여는 것 하나에만 묶는다(`QuitDialog` 와 같은 까닭)
  $effect(() => {
    if (!open) return;
    untrack(() => {
      sessions = null;
      void liveSessions().then((n) => (sessions = n));
      void tick().then(() => primary?.focus());
    });
  });

  const busy = $derived.by((): BusySummary => {
    if (!open) return { sessions: 0, busy: [], idle: 0 };
    const ai: string[] = [];
    const shell: string[] = [];
    for (const group of windowSessionCards(t).board.groups) {
      for (const card of group.cards) {
        if (card.state !== "running") continue;
        if (card.kind === "ai") ai.push(card.title ?? card.ai ?? "");
        else if (card.kind !== "headless" && card.running) shell.push(card.commandShort || card.title || "");
      }
    }
    return summarizeBusy({ sessions, ai, shell, plans: runningPlans().map(planName) });
  });

  const date = $derived.by(() => {
    const raw = avail?.date;
    if (!raw) return null;
    const at = Date.parse(raw);
    return Number.isFinite(at) ? new Date(at).toLocaleDateString() : null;
  });

  const pct = $derived(view ? percent(view.received, view.total) : null);

  function onKey(ev: KeyboardEvent): void {
    if (modalEl && trapTab(ev, modalEl)) return;
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      closeUpdateCard();
    }
  }

  function openPage(href: string): void {
    if (isWebUrl(href)) void openUrl(href).catch(() => {});
  }

  function skip(): void {
    const v = avail?.version;
    closeUpdateCard();
    if (v) void skipUpdate(v);
  }

  function restart(): void {
    closeUpdateCard();
    void restartToUpdate();
  }
</script>

{#if open && view && avail}
  <div
    class="overlay"
    role="presentation"
    onmousedown={(ev) => {
      if (ev.target === ev.currentTarget) closeUpdateCard();
    }}
  >
    <div
      class="modal glass-raised modal-rise"
      data-update-card={phase}
      role="dialog"
      aria-modal="true"
      aria-label={t("app.update.card.aria")}
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKey}
    >
      <div class="glass-scroll">
        <h2>
          <UiIcon name="up" size={18} />
          <span>{t("app.update.card.title", { version: avail.version })}</span>
        </h2>
        <p class="meta">
          {date
            ? t("app.update.card.meta", { current: view.current, date })
            : t("app.update.card.meta.nodate", { current: view.current })}
          · <button type="button" class="link" data-update-page onclick={() => openPage(avail.page)}
            >{t("app.update.card.page")}<UiIcon name="external" size={12} /></button
          >
        </p>

        <p class="section-label">{t("app.update.card.notes")}</p>
        <div class="notes" data-update-notes>
          {#if avail.notes.trim()}
            <MarkdownBlocks blocks={parseMarkdown(avail.notes)} compact onlink={openPage} linkClick="plain" />
          {:else}
            <p class="empty">{t("app.update.card.notes.empty")}</p>
          {/if}
        </div>

        {#if phase === "downloading"}
          <div class="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct ?? undefined}>
            <div class="bar" class:unknown={pct === null} style:width={pct === null ? "30%" : `${pct}%`}></div>
          </div>
          <p class="progress-text">
            {pct === null
              ? t("app.update.card.downloading.unknown", { received: megabytes(view.received) })
              : t("app.update.card.downloading", { pct })}
            {#if view.total !== null}
              <span class="size">{t("app.update.card.downloading.size", { received: megabytes(view.received), total: megabytes(view.total) })}</span>
            {/if}
          </p>
        {:else if phase === "ready"}
          <p class="ok" data-update-ready>{t("app.update.card.ready")}</p>
        {:else if phase === "installing"}
          <p class="ok">{t("app.update.card.installing")}</p>
        {:else if phase === "failed"}
          <p class="fail" role="alert" data-update-error>
            {t("app.update.card.failed")}
            {#if view.error}<span class="why">{view.error}</span>{/if}
          </p>
        {/if}

        <div class="warn" role="note" data-update-warn>
          <p>
            {busy.sessions === 0
              ? t("app.update.card.warn.none")
              : busy.busy.length === 0
                ? t("app.update.card.warn.calm", { n: busy.sessions })
                : t("app.update.card.warn", { n: busy.sessions, m: busy.busy.length })}
          </p>
          {#if busy.busy.length > 0 || busy.idle > 0}
            <div class="chips">
              {#each busy.busy as b, i (i)}
                <span class="chip busy" data-busy-kind={b.kind}
                  >{t(b.kind === "ai" ? "app.update.card.busy.ai" : b.kind === "shell" ? "app.update.card.busy.shell" : "app.update.card.busy.plan", {
                    name: b.name,
                  })}</span
                >
              {/each}
              {#if busy.idle > 0}<span class="chip">{t("app.update.card.idle", { n: busy.idle })}</span>{/if}
            </div>
          {/if}
          <p class="keep">{t("app.update.card.keep")}</p>
        </div>

        <div class="actions">
          {#if phase === "available" || phase === "failed"}
            <button type="button" class="btn btn-ghost skip" data-update-skip onclick={skip}>{t("app.update.card.skip")}</button>
          {/if}
          <span class="spacer"></span>
          <button type="button" class="btn btn-secondary" data-update-later onclick={closeUpdateCard}>{t("app.update.card.later")}</button>
          {#if phase === "available"}
            <button type="button" class="btn btn-primary" data-update-go bind:this={primary} onclick={() => void downloadUpdate()}
              >{t("app.update.card.update")}</button
            >
          {:else if phase === "failed"}
            <button type="button" class="btn btn-primary" data-update-retry bind:this={primary} onclick={() => void downloadUpdate()}
              >{t("app.update.card.retry")}</button
            >
          {:else if phase === "ready"}
            <button
              type="button"
              class="btn btn-primary"
              data-update-restart
              bind:this={primary}
              disabled={updateRestarting()}
              onclick={restart}>{t("app.update.card.restart")}</button
            >
          {:else}
            <button type="button" class="btn btn-primary" disabled bind:this={primary}>{t("app.update.card.update")}</button>
          {/if}
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: rgb(0 0 0 / 0.3);
  }
  .modal {
    width: min(480px, 100%);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 스크롤은 안쪽 `.glass-scroll`(theme.css) */
    box-sizing: border-box;
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-raised);
    color: var(--fg-1);
    outline: none;
  }
  .glass-scroll {
    padding: var(--space-4);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
  }
  .meta {
    margin: 4px 0 var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .link {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 0;
    font: inherit;
    color: var(--accent);
    background: none;
    border: none;
    cursor: pointer;
  }
  .link:hover {
    text-decoration: underline;
  }
  .section-label {
    margin: 0 0 4px;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }
  /* 릴리스 노트 — 우물 면 · 길면 안에서 스크롤(150px) */
  .notes {
    max-height: 150px;
    overflow-y: auto;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }
  .notes .empty {
    margin: 0;
    color: var(--fg-2);
  }
  .progress {
    height: 6px;
    margin-top: var(--space-3);
    overflow: hidden;
    background: var(--line);
    border-radius: 999px;
  }
  .bar {
    height: 100%;
    background: var(--accent);
    border-radius: 999px;
    transition: width 200ms linear;
  }
  .bar.unknown {
    opacity: 0.6;
  }
  .progress-text {
    display: flex;
    justify-content: space-between;
    margin: 4px 0 0;
    font-size: var(--t-xs);
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
  }
  .ok {
    margin: var(--space-3) 0 0;
    font-size: var(--t-sm);
    color: var(--ok);
  }
  .fail {
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--err-soft);
    border-radius: var(--radius-sm);
    overflow-wrap: anywhere;
  }
  .fail .why {
    display: block;
    margin-top: 2px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  /* 경고 상자 — `ConfirmDialog` 의 callout 과 같은 면 */
  .warn {
    margin-top: var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.5;
    background: var(--warn-soft);
    border-radius: var(--radius-sm);
  }
  .warn p {
    margin: 0;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    margin-top: var(--space-2);
  }
  .chip {
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-chip);
    background: var(--bg-chip);
    border-radius: 999px;
  }
  .chip.busy {
    color: var(--fg-1);
    box-shadow: inset 0 0 0 1px var(--warn);
  }
  .keep {
    margin-top: var(--space-2) !important;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }
  .spacer {
    flex: 1 1 auto;
  }
  .skip {
    color: var(--fg-2);
  }
  @media (pointer: coarse) {
    .actions button {
      min-height: 44px;
      padding-inline: 18px;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .bar {
      transition: none;
    }
  }
</style>
