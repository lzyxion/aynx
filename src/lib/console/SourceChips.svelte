<script lang="ts">
  /**
   * **"어디서" 칩** — 사용량 화면의 출처 (docs/log/2026-09-27-remote-conversations.md "2단계").
   *
   * "이 PC · 38" · "⇄ dev-01 · 27" · "모두". 붙은 SSH 타일이 없는 호스트는 **흐리게** 서고 "12분 전 읽음 · 연결 없음" 을 달고
   * 있다(마지막으로 읽은 값 — 자동으로 접속하지 않는다). 칩이 없으면(원격을 읽은 적이 없다) 아무것도 그리지 않는다. 고르는 일은
   * 저장소(`app/dashboard-source`)가 하고, 두 칸이 같은 출처를 본다.
   */
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { readMinutes, type SourceChip, type SourceKey } from "$lib/dashboard-source";

  let {
    chips,
    current,
    now,
    onpick,
  }: {
    chips: readonly SourceChip[];
    current: SourceKey;
    now: number;
    onpick: (key: SourceKey) => void;
  } = $props();

  function label(c: SourceChip): string {
    if (c.kind === "local") return c.count === null ? t("board.source.localBare") : t("board.source.local", { n: c.count });
    if (c.kind === "all") return t("board.source.all");
    return t("board.source.host", { host: c.alias ?? "", n: c.count ?? 0 });
  }

  /** 흐린 호스트 칩의 꼬리 — "12분 전 읽음 · 연결 없음" */
  function note(c: SourceChip): string | null {
    if (c.kind !== "host") return null;
    if (c.loading) return t("board.source.reading");
    if (c.live) return null;
    const m = readMinutes(c.readAt, now);
    const ago = m === null ? null : m === 0 ? t("board.source.readNow") : t("board.source.readAgo", { n: m });
    return ago === null ? t("board.source.offline") : `${ago} · ${t("board.source.offline")}`;
  }
</script>

{#if chips.length > 0}
  <div class="chips" role="radiogroup" aria-label={t("board.source.aria")} data-source-chips>
    {#each chips as c (c.key)}
      {@const n = note(c)}
      <button
        type="button"
        class="chip {c.kind}"
        class:on={c.key === current}
        class:dim={c.kind === "host" && !c.live}
        role="radio"
        aria-checked={c.key === current}
        data-source-chip={c.key}
        data-live={c.kind === "host" ? String(c.live) : undefined}
        title={c.kind === "host" && !c.live ? t("board.source.offline.title", { host: c.alias ?? "" }) : undefined}
        onclick={() => onpick(c.key)}
        >{#if c.kind === "host"}<span class="glyph" aria-hidden="true">⇄</span>{/if}{label(c)}{#if n}<span
            class="note"
            data-source-note>{n}</span
          >{/if}</button
      >
    {/each}
  </div>
{/if}

<style>
  .chips {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    min-width: 0;
  }

  .chip {
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    padding: 2px var(--space-3);
    font: inherit;
    font-size: var(--t-xs);
    line-height: 18px;
    font-variant-numeric: tabular-nums;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }

  .chip:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 고른 출처 — 범위 칩과 같은 `--accent-soft` 판 */
  .chip.on {
    color: var(--fg-1);
    background: var(--accent-soft);
    border-color: transparent;
  }

  /* 붙은 SSH 타일이 없는 호스트 — 마지막으로 읽은 값(흐리게) */
  .chip.dim {
    color: var(--fg-3);
    border-style: dashed;
  }

  .glyph {
    color: var(--fg-3);
  }

  .note {
    margin-left: var(--space-1);
    color: var(--fg-3);
  }
</style>
