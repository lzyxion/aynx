<script lang="ts">
  /**
   * **diff 타일의 패치 본문**(줄 그리기 — 한 줄 보기 / 나란히 · 덩어리 · 줄 고르기 단추 · "+ 코멘트" · 줄 아래 입력 칸 · 코멘트 카드) —
   * `DiffView.svelte` 에서 뗀 표시 조각(2026-10-27 분할 8차). 감싸개 없음 — `.dbody` 안에 예전 그대로의 원소만 그린다.
   *
   * 상태는 하나도 쥐지 않는다: 읽기 · 그린 덩어리 수(`shownChunks`) · 줄 고르기(`selSet` · 누름/끌기 `onNoDown` · `onNoEnter`) ·
   * "+ 코멘트" 자리(`selbarAt` · `selbarTop`) · 카드 · 입력 칸 자리(`cardsAt` · `composerAt`)는 부모 `DiffView` 가, 코멘트 · 입력 칸 ·
   * 받을 곳은 `diff/comments-controller.svelte.ts`(`cm`)가 쥔다. 줄 묶음 원소(`rowsEl` — 찾기 띠의 뿌리 · "+ 코멘트" 재기)만 `bind:`.
   * 문서 머리 · 이진 · 빈 파일 · 잘림 안내는 부모에 남는다.
   */
  import type { Snippet } from "svelte";
  import Keys from "$lib/Keys.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import CommentComposer from "$lib/diff/CommentComposer.svelte";
  import type { DiffCommentsController } from "$lib/diff/comments-controller.svelte.js";
  import type { DiffComment } from "$lib/diff-comments";
  import { lineKey, signOf, type DiffLine, type SplitRow, type UnifiedRow } from "$lib/diff-view";

  let {
    paneId,
    view,
    narrow,
    uChunks,
    sChunks,
    shownChunks,
    selSet,
    selbarAt,
    selbarTop,
    cardsAt,
    composerAt,
    cm,
    noOf,
    onNoDown,
    onNoEnter,
    rowsEl = $bindable(),
  }: {
    paneId: string;
    view: "unified" | "split";
    narrow: boolean;
    uChunks: UnifiedRow[][];
    sChunks: SplitRow[][];
    /** 지금 그린 덩어리 수 — 부모가 프레임마다 늘린다 */
    shownChunks: number;
    /** 고른 줄 열쇠들 */
    selSet: Set<string>;
    /** "+ 코멘트" 가 설 자리(줄 · 짝 줄 열쇠 — 없으면 `null`) */
    selbarAt: string | null;
    /** 그 세로 자리(줄 묶음 기준 px — 부모가 잰다) */
    selbarTop: number | null;
    /** 자리 → 그 아래 카드들(지금 파일의 코멘트만) */
    cardsAt: Map<string, { c: DiffComment; n: number }[]>;
    /** 입력 칸이 설 자리 */
    composerAt: string | null;
    cm: DiffCommentsController;
    noOf: (l: DiffLine) => number | null;
    onNoDown: (ev: PointerEvent, key: string) => void;
    onNoEnter: (key: string) => void;
    /** 줄 묶음(`.rows`) — 찾기 띠의 뿌리 · "+ 코멘트" 재기(부모) */
    rowsEl: HTMLDivElement | null;
  } = $props();
</script>

{#snippet text(l: DiffLine)}
  <span class="tx">{l.text}{#if l.noNewline}<span class="nonl" data-find-skip title={t("app.diff.file.noNewline")}>⏎̸</span>{/if}</span>
{/snippet}

<!--
  줄 번호 칸 = 줄 고르기 단추. 누르면 한 줄 · Shift+클릭 · 끌기로 여러 줄(포인터 — 탭 순회에는 넣지 않는다: 5천 줄이면 5천 번이다).
-->
{#snippet nos(key: string, children: Snippet)}
  <button
    type="button"
    class="nos"
    tabindex="-1"
    title={t("app.diff.sel.title")}
    data-diff-sel={key}
    onpointerdown={(ev) => onNoDown(ev, key)}
    onpointerenter={() => onNoEnter(key)}>{@render children()}</button
  >
{/snippet}

<!--
  고른 범위 끝 줄 바로 아래에 **떠 있는** "+ 코멘트" — 자리를 차지하면 뒤 줄이 밀려 끄는 손 아래가 바뀐다. 줄 덩어리는
  `content-visibility`(paint 격리)라 그 안에 두면 덩어리 끝에서 잘린다 — 그래서 줄 묶음(.rows) 위에 하나만 둔다.
-->
{#snippet selbar()}
  {#if selbarAt && selbarTop !== null}
    <span class="selbar" style:top="{selbarTop}px" data-diff-selbar data-find-skip>
      <button type="button" class="addc" title={t("app.diff.comment.addTitle")} data-diff-add-comment onclick={cm.openComposer}
        >{t("app.diff.comment.add")}</button
      ><Keys combo="C" size="sm" />
    </span>
  {/if}
{/snippet}

{#snippet below(slot: string)}
  {#if cm.composer && composerAt === slot}
    <CommentComposer
      composer={cm.composer}
      {paneId}
      bind:draft={cm.draft}
      bind:composerEl={cm.composerEl}
      onComposerKey={cm.onComposerKey}
      cancelComposer={cm.cancelComposer}
      submitComposer={cm.submitComposer}
    />
  {/if}
  {#each cardsAt.get(slot) ?? [] as item (item.c.id)}
    <div class="card" class:sent={item.c.sent} data-diff-comment={item.c.id} data-find-skip>
      <span class="cnum">{item.n}</span>
      <span class="crange">{item.c.label}</span>
      <span class="ctext">{item.c.text}</span>
      {#if item.c.sent}<span class="sentchip">{t("app.diff.card.sent")}</span>{/if}
      <span class="cacts"
        ><button type="button" class="lnk" data-diff-comment-edit onclick={() => cm.editComment(item.c)}>{t("app.diff.card.edit")}</button
        >·<button type="button" class="lnk" data-diff-comment-delete onclick={() => cm.deleteComment(item.c)}
          >{t("app.diff.card.delete")}</button
        ></span
      >
    </div>
  {/each}
{/snippet}

{#snippet unifiedRow(r: UnifiedRow)}
  {#if r.type === "hunk"}
    <div class="hunk" data-diff-hunk>{r.header}</div>
  {:else}
    {@const l = r.line}
    <div class="ln k-{l.kind}" class:narrow class:selrow={selSet.has(r.key)} data-diff-row={r.key} data-diff-kind={l.kind}>
      {#snippet numbers()}
        {#if narrow}
          <span class="no">{noOf(l) ?? ""}</span>
        {:else}
          <span class="no">{l.oldNo ?? ""}</span>
          <span class="no">{l.newNo ?? ""}</span>
        {/if}
      {/snippet}
      {@render nos(r.key, numbers)}
      <span class="sg" data-find-skip>{signOf(l.kind)}</span>
      {@render text(l)}
    </div>
    {@render below(r.key)}
  {/if}
{/snippet}

{#snippet half(l: DiffLine | null, side: "old" | "new")}
  {#if l}
    {#snippet number()}<span class="no">{(side === "old" ? l.oldNo : l.newNo) ?? ""}</span>{/snippet}
    {@render nos(lineKey(l), number)}
    <span class="sg" data-find-skip>{signOf(l.kind)}</span>
    {@render text(l)}
  {:else}
    <span class="fill" aria-hidden="true"></span>
  {/if}
{/snippet}

{#snippet splitRow(r: SplitRow)}
  {#if r.type === "hunk"}
    <div class="hunk" data-diff-hunk>{r.header}</div>
  {:else}
    <div class="pair" data-diff-row={r.key}>
      <div
        class="side old k-{r.left?.kind === 'ctx' ? 'ctx' : r.left ? 'del' : 'none'}"
        class:selrow={!!r.left && r.left.kind === "del" && selSet.has(lineKey(r.left))}
      >
        {@render half(r.left, "old")}
      </div>
      <div
        class="side new k-{r.right?.kind === 'ctx' ? 'ctx' : r.right ? 'add' : 'none'}"
        class:selrow={!!r.right && selSet.has(lineKey(r.right))}
      >
        {@render half(r.right, "new")}
      </div>
    </div>
    {@render below(r.key)}
  {/if}
{/snippet}
{#if view === "split"}
  <div class="sides-head"><span>{t("app.diff.side.old")}</span><span>{t("app.diff.side.new")}</span></div>
  <div class="rows split" data-diff-rows="split" bind:this={rowsEl}>
    {@render selbar()}
    {#each sChunks.slice(0, shownChunks) as part, ci (ci)}
      <div class="chunk" style:contain-intrinsic-size="auto {part.length * 20}px">
        {#each part as r (r.key)}{@render splitRow(r)}{/each}
      </div>
    {/each}
  </div>
{:else}
  <div class="rows unified" data-diff-rows="unified" bind:this={rowsEl}>
    {@render selbar()}
    {#each uChunks.slice(0, shownChunks) as part, ci (ci)}
      <div class="chunk" style:contain-intrinsic-size="auto {part.length * 20}px">
        {#each part as r (r.key)}{@render unifiedRow(r)}{/each}
      </div>
    {/each}
  </div>
{/if}

<style>
  .rows.unified {
    min-width: 100%;
    width: max-content;
  }

  .chunk {
    content-visibility: auto;
  }

  .hunk {
    position: sticky;
    left: 0;
    height: var(--row-h);
    line-height: var(--row-h);
    padding: 0 10px;
    color: var(--fg-3);
    background: var(--surface-field);
    white-space: pre;
  }

  .ln {
    display: grid;
    grid-template-columns: 88px 16px max-content;
    min-height: var(--row-h);
    line-height: var(--row-h);
  }

  .ln.narrow {
    grid-template-columns: 40px 16px max-content;
  }

  /* 줄 번호 칸 = 고르기 단추(한 줄 보기는 옛 · 새 두 칸, 좁으면 하나 · 나란히는 하나) */
  .nos {
    display: grid;
    grid-template-columns: 44px 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    line-height: inherit;
    text-align: right;
    cursor: pointer;
  }

  .ln.narrow .nos,
  .side .nos {
    grid-template-columns: 1fr;
  }

  .nos:hover .no {
    color: var(--fg);
  }

  /* 고른 줄 — 강조색 판 + 왼쪽 막대(이 화면의 선택 표시) */
  .selrow {
    background: var(--accent-soft) !important;
    box-shadow: inset 3px 0 0 var(--accent);
  }

  .selrow .no {
    color: var(--fg);
    font-weight: 600;
  }

  .no {
    padding-right: 8px;
    text-align: right;
    color: var(--fg-3);
    user-select: none;
  }

  .sg {
    text-align: center;
    user-select: none;
  }

  .tx {
    white-space: pre;
    padding-right: 16px;
  }

  .k-add {
    background: var(--plus-bg);
  }

  .k-add .sg,
  .k-add .no {
    color: var(--plus-fg);
  }

  .k-del {
    background: var(--minus-bg);
  }

  .k-del .sg,
  .k-del .no {
    color: var(--minus-fg);
  }

  .nonl {
    margin-left: 4px;
    color: var(--fg-3);
  }

  /* 나란히 — 짝 한 줄 = 두 칸. 긴 줄은 칸 안에서 접는다(두 칸의 줄 높이가 함께 자라 짝이 어긋나지 않는다) */
  .sides-head {
    display: grid;
    grid-template-columns: 1fr 1fr;
    position: sticky;
    top: 0;
    z-index: 1;
    /* 끈끈한 머리 — 밑으로 줄이 지나가니 글래스 크롬 타일에서는 불투명(`--tile-sticky` · `PaneHost`) */
    background: var(--tile-sticky, var(--surface-raised));
    border-bottom: 1px solid var(--border);
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-3);
  }

  .sides-head span {
    padding: 3px 12px;
  }

  .pair {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  }

  .side {
    display: grid;
    grid-template-columns: 44px 16px minmax(0, 1fr);
    min-height: var(--row-h);
    line-height: var(--row-h);
  }

  .side.old {
    border-right: 1px solid var(--border);
  }

  .side .tx {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .side.k-none {
    grid-template-columns: 1fr;
  }

  /* 맞은편에 줄이 없는 칸 — 빗금 */
  .fill {
    background: repeating-linear-gradient(
      135deg,
      transparent 0 6px,
      color-mix(in srgb, var(--fg) 5%, transparent) 6px 12px
    );
  }

  /* 고른 범위 아래 "+ 코멘트" 한 줄 */
  .rows {
    position: relative;
  }

  .selbar {
    position: absolute;
    z-index: 2;
    left: 96px;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px;
    border-radius: 999px;
    background: var(--surface-raised-solid);
    box-shadow: var(--shadow-tile);
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 16px;
    color: var(--fg-3);
    white-space: nowrap;
  }

  .addc {
    padding: 1px 8px;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: var(--surface-raised);
    color: var(--fg);
    font: inherit;
    cursor: pointer;
  }

  .addc:hover {
    border-color: var(--accent);
  }

  /* 쓰는 중 · 단 코멘트 — 범위 바로 아래, 줄 번호 칸만큼 들여(가로 스크롤해도 왼쪽에 붙어 있다) */
  .card {
    position: sticky;
    left: 0;
    box-sizing: border-box;
    width: min(640px, calc(100cqw - 120px));
    margin: 6px 12px 8px 104px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--surface-raised-solid);
    font-family: var(--font-ui);
    font-size: 12.5px;
  }

  .card {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 10px;
  }

  .card.sent {
    opacity: 0.55;
  }

  .cnum {
    flex: 0 0 auto;
    padding: 0 7px;
    border-radius: 999px;
    /* 코멘트 번호는 "무엇인지"(표지)라 제3색 채움 */
    background: var(--tertiary);
    color: var(--on-tertiary);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
  }

  .crange {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: 11.5px;
    color: var(--fg-3);
    line-height: 18px;
  }

  .ctext {
    flex: 1 1 auto;
    min-width: 0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    color: var(--fg);
    line-height: 1.5;
  }

  .sentchip {
    flex: 0 0 auto;
    padding: 0 7px;
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    font-size: 11px;
    line-height: 18px;
  }

  .cacts {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 4px;
    color: var(--fg-3);
    font-size: 11.5px;
  }

  .lnk {
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--fg-2);
    font: inherit;
    cursor: pointer;
  }

  .lnk:hover {
    color: var(--fg);
    text-decoration: underline;
  }

  .addc:focus-visible,
  .lnk:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: 1px;
  }
</style>
