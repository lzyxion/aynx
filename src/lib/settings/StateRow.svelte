<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";

  /**
   * 설정의 **상태 줄 한 벌** — 왼쪽 상태 타일(그림만 · aria-hidden) + 오른쪽 두 단(위: 제목 · 한 마디, 아래: 사실 칩 줄). 보안 · 원격 접속이 쓴다.
   * 글자 전부가 `role="status"` 로 읽힌다. 톤은 `data-tone`(`ok` · `warn` · `bad` · `neutral`) — 줄 판의 옅은 틴트는 `::before` 가 깐다
   * (묶음 카드 규칙이 `background` 를 쥐고 있어서). 칩은 부르는 쪽이 `.vstate-chips` 안에 그린다(칩 모양은 화면마다 다르다).
   */
  let {
    tone,
    icon,
    note,
    id,
    bodyClass,
    title,
    chips,
    ...rest
  }: {
    tone: string;
    icon: string;
    note: string;
    id?: string;
    /** 줄 글자 칸의 덧붙이는 클래스 */
    bodyClass?: string;
    /** 제목 — `.name` 하나 */
    title: Snippet;
    chips?: Snippet;
  } & Record<`data-${string}`, unknown> = $props();
</script>

<div class="srow vstate" {id} data-tone={tone} {...rest}>
  <span class="vstate-tile" aria-hidden="true"><UiIcon name={icon} size={24} /></span>
  <div class="vstate-body {bodyClass ?? ''}" role="status">
    <div class="vstate-head">
      {@render title()}
      <span class="vstate-note">{note}</span>
    </div>
    {@render chips?.()}
  </div>
</div>

<style>
  /* 타일 + 두 단. 묶음 카드(`.srow` 판)는 그대로 쓰고 격자만 flex 로 바꾼다 */
  .srow.vstate {
    display: flex;
    align-items: flex-start;
    gap: var(--space-3);
    position: relative;
    isolation: isolate;
  }

  /* 톤의 옅은 틴트 — 카드 판 위 한 겹(카드 규칙이 `background` 를 쥐어 판 자체는 못 바꾼다) */
  .srow.vstate::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    border-radius: inherit;
    pointer-events: none;
  }

  .srow.vstate[data-tone="ok"]::before {
    background: color-mix(in srgb, var(--ok) 8%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--ok) 28%, transparent);
  }

  .srow.vstate[data-tone="warn"]::before {
    background: color-mix(in srgb, var(--warn) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--warn) 40%, transparent);
  }

  .srow.vstate[data-tone="bad"]::before {
    background: color-mix(in srgb, var(--err) 10%, transparent);
    box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--err) 40%, transparent);
  }

  .vstate-tile {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    border-radius: calc(var(--radius-surface-inner) - 2px);
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  [data-tone="ok"] > .vstate-tile {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 18%, transparent);
  }

  [data-tone="warn"] > .vstate-tile {
    color: var(--warn);
    background: var(--warn-soft);
  }

  [data-tone="bad"] > .vstate-tile {
    color: var(--err);
    background: color-mix(in srgb, var(--err) 18%, transparent);
  }

  .vstate-body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .vstate-head {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    column-gap: var(--space-2);
    row-gap: 2px;
  }

  .vstate-head :global(.name) {
    font-weight: 600;
  }

  .vstate-note {
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  [data-tone="warn"] .vstate-note,
  [data-tone="bad"] .vstate-note {
    color: var(--fg-1);
  }

  /* 사실 칩 — 좁으면 줄바꿈 */
  .vstate-body :global(.vstate-chips) {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: 0;
    list-style: none;
  }
</style>
