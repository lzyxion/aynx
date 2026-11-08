<script lang="ts" module>
  /** 카드를 여는 재료 — `Terminal.svelte` 가 블록 줄 단추에서 짓는다 */
  export interface BlockViewOpen {
    blockId: number;
    command: string;
    exit: number | null;
    durationMs: number | null;
    /** 출력 전부(버퍼) — 밀려났으면 이력의 발췌 */
    text: string;
    /** 발췌라 가운데가 빠졌다 */
    partial: boolean;
    /** 그 블록 줄의 사각형(터미널 상자 기준 px) — 카드가 여기서 커진다 */
    row: { top: number; bottom: number; left: number; right: number };
  }
</script>

<script lang="ts">
  /**
   * **명령 블록 리치 보기 카드**(2026-10-18 — 목업 ②' "블록이 제자리에서 펼쳐지기"). 블록 줄의 [리치하게 보기] 가 연다
   * (`shell-integration/decorations.ts` → `Terminal.svelte`). 형식 판정 · 표 · 정렬은 순수 층 `$lib/block-view`.
   *
   * - **자리 · 움직임**: 터미널 상자(`.term`) 안에 절대 배치 — 보통은 상자 안쪽 16px 을 남기고 덮고, 출력이 짧으면(`isShortOutput`)
   *   블록 줄 바로 아래(자리가 모자라면 위)의 작은 카드. 그 블록 줄의 가운데를 `transform-origin` 으로 `scale(0.42)` · 투명에서
   *   커진다(320ms `cubic-bezier(0.2,0,0,1)`). 닫으면(× · 막 누르기 · Esc) 그 블록의 **지금 자리**로 줄어들며(220ms) 사라진다 —
   *   그 사이 스크롤로 화면 밖이면 상자 가운데로. 움직임 줄이기면 움직임 없이.
   * - **뒤 터미널은 그대로**다 — 어두운 막(짧은 카드는 투명 막)이 덮을 뿐 `display:none` 이 아니다(WebGL 유지 · 숨은 터미널의 0 폭
   *   재기 — `term/hidden-render-gate.ts`). 출력도 계속 받는다.
   * - **내용**: JSON → 트리(`JsonTree`) · 표(객체 배열이면 — 머리 눌러 정렬 · 칸 눌러 복사) · 원문 / CSV · 줄 맞춘 표(`docker ps` 등) → 표 · 원문 /
   *   마크다운 → 렌더(`MarkdownBlocks` — 문서 보기 타일과 공용) · 원문 / 그 밖 → 원문. 1MB 를 넘으면 원문만.
   * - 본문은 이미 화면에 있던 글자뿐이다(버퍼 · 이력) — 새 Tauri 명령 · MCP 길 없음, 로그에 싣지 않는다.
   */
  import { onMount, tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import MarkdownBlocks from "$lib/MarkdownBlocks.svelte";
  import JsonTree from "./JsonTree.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { formatDuration } from "$lib/finish-notify";
  import { writeClipboard } from "$lib/clipboard";
  import { toast } from "$lib/toast.svelte.js";
  import { parseMarkdown } from "$lib/markdown";
  import { prefersReducedMotion } from "$lib/console/dashboard-motion";
  import {
    csvTable,
    detectFormat,
    headCommand,
    isShortOutput,
    jsonTable,
    sortRows,
    viewsFor,
    type BlockViewKind,
    type Table,
  } from "$lib/block-view";

  let {
    open,
    originNow,
    onclose,
  }: {
    open: BlockViewOpen;
    /** 닫을 때 그 블록 줄의 **지금** 가운데(터미널 상자 기준) — 화면 밖이면 `null`(상자 가운데로 줄어든다) */
    originNow: () => { x: number; y: number } | null;
    /** 닫힘 움직임이 끝났다 — 부르는 쪽이 이 카드를 걷는다 */
    onclose: () => void;
  } = $props();

  const OPEN_MS = 320;
  const CLOSE_MS = 220;
  const EASE = "cubic-bezier(0.2, 0, 0, 1)";
  const START_SCALE = 0.42;
  /** 상자 가장자리에 남기는 틈 */
  const INSET = 16;
  /** 짧은 카드가 블록 줄 아래에 서려면 필요한 높이 — 모자라면 위로 */
  const SHORT_MIN_ROOM = 160;

  // svelte-ignore state_referenced_locally
  const detected = detectFormat(open.text);
  // svelte-ignore state_referenced_locally
  const short = isShortOutput(open.text);
  const views = viewsFor(detected);
  let view = $state<BlockViewKind>(views[0]);

  const table = $derived.by((): Table | null => {
    if (view !== "table") return null;
    if (detected.format === "json") return jsonTable(detected.json);
    if (detected.format === "csv") return csvTable(open.text);
    if (detected.format === "columns") return detected.columns ?? null;
    return null;
  });
  let sort = $state<{ col: number; dir: 1 | -1 } | null>(null);
  const rows = $derived(table ? (sort ? sortRows(table.rows, sort.col, sort.dir) : table.rows) : []);

  function sortBy(col: number): void {
    sort = sort?.col === col ? { col, dir: sort.dir === 1 ? -1 : 1 } : { col, dir: 1 };
  }

  let host = $state<HTMLElement | null>(null);
  let card = $state<HTMLDivElement | null>(null);
  let scrim = $state<HTMLDivElement | null>(null);
  let closing = false;

  /** 카드 자리(터미널 상자 기준) — 짧으면 블록 줄 아래(모자라면 위), 아니면 안쪽 16px */
  const place = $derived.by(() => {
    const h = host?.clientHeight ?? 0;
    if (!short) return `top:${INSET}px;left:${INSET}px;right:${INSET}px;bottom:${INSET}px`;
    const below = h - open.row.bottom - INSET;
    if (below >= SHORT_MIN_ROOM || below >= open.row.top - INSET)
      return `top:${open.row.bottom + 4}px;left:${INSET}px;right:${INSET}px;max-height:${Math.max(80, below)}px`;
    return `bottom:${h - open.row.top + 4}px;left:${INSET}px;right:${INSET}px;max-height:${Math.max(80, open.row.top - INSET)}px`;
  });

  /** 카드 상자 기준 transform-origin — 상자 기준 점을 카드 안쪽 좌표로 */
  function originIn(p: { x: number; y: number }): string {
    if (!card) return "50% 50%";
    const c = card.getBoundingClientRect();
    const hb = host?.getBoundingClientRect();
    const x = p.x - (c.left - (hb?.left ?? 0));
    const y = p.y - (c.top - (hb?.top ?? 0));
    return `${Math.round(x)}px ${Math.round(y)}px`;
  }

  onMount(() => {
    host = card?.parentElement ?? null;
    void tick().then(() => {
      card?.focus({ preventScroll: true });
      if (!card || prefersReducedMotion()) return;
      card.style.transformOrigin = originIn({
        x: (open.row.left + open.row.right) / 2,
        y: (open.row.top + open.row.bottom) / 2,
      });
      card.animate(
        [
          { transform: `scale(${START_SCALE})`, opacity: 0 },
          { transform: "scale(1)", opacity: 1 },
        ],
        { duration: OPEN_MS, easing: EASE },
      );
      scrim?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 260, easing: "ease" });
    });
  });

  /** 닫기 — 그 블록의 지금 자리로(밖이면 상자 가운데로) 줄어든 뒤 걷힌다 */
  export function close(): void {
    if (closing) return;
    closing = true;
    if (!card || prefersReducedMotion()) {
      onclose();
      return;
    }
    const p = originNow() ?? { x: (host?.clientWidth ?? 0) / 2, y: (host?.clientHeight ?? 0) / 2 };
    card.style.transformOrigin = originIn(p);
    const a = card.animate(
      [
        { transform: "scale(1)", opacity: 1 },
        { transform: `scale(${START_SCALE})`, opacity: 0 },
      ],
      { duration: CLOSE_MS, easing: EASE, fill: "forwards" },
    );
    scrim?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: CLOSE_MS, easing: "ease", fill: "forwards" });
    a.finished.then(onclose, onclose);
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape" || ev.isComposing) return;
    ev.preventDefault();
    ev.stopPropagation();
    close();
  }

  async function copy(text: string, what: "output" | "cell"): Promise<void> {
    const ok = await writeClipboard(text);
    if (ok) toast.info(t(what === "output" ? "pane.blockview.copied" : "pane.blockview.cellCopied"), { ms: 1500 });
    else toast.error(t("files.doc.md.code.copyfail"));
  }

  const meta = $derived(
    [
      open.durationMs !== null ? formatDuration(open.durationMs, t) : null,
      open.exit !== null ? t("pane.blockview.exit", { code: open.exit }) : null,
    ].filter((x): x is string => x !== null),
  );

  const VIEW_LABEL: Record<BlockViewKind, "pane.blockview.view.tree" | "pane.blockview.view.table" | "pane.blockview.view.rendered" | "pane.blockview.view.raw"> = {
    tree: "pane.blockview.view.tree",
    table: "pane.blockview.view.table",
    rendered: "pane.blockview.view.rendered",
    raw: "pane.blockview.view.raw",
  };
</script>

<!-- 막 — 누르면 닫힌다. 짧은 카드는 투명(터미널이 그대로 보인다) -->
<div
  class="bv-scrim"
  class:clear={short}
  bind:this={scrim}
  role="presentation"
  data-block-view-scrim
  onpointerdown={(e) => {
    e.preventDefault();
    close();
  }}
></div>
<div
  class="bv-card"
  class:short
  bind:this={card}
  style={place}
  role="dialog"
  aria-label={t("pane.blockview.aria")}
  tabindex="-1"
  data-block-view={open.blockId}
  data-format={detected.format}
  onkeydown={onKeydown}
>
  <header class="head">
    <span class="title">{t("pane.blockview.title")}</span>
    <span class="cmd" title={open.command}>{headCommand(open.command)}</span>
    {#each meta as m (m)}<span class="meta" class:fail={open.exit !== null && open.exit !== 0 && m.includes(String(open.exit))}>{m}</span>{/each}
    <span class="grow"></span>
    {#if views.length > 1}
      <div class="tabs" role="tablist" aria-label={t("pane.blockview.views")}>
        {#each views as v (v)}
          <button
            type="button"
            role="tab"
            class="tab"
            class:on={view === v}
            aria-selected={view === v}
            data-block-view-tab={v}
            onclick={() => (view = v)}>{t(VIEW_LABEL[v])}</button
          >
        {/each}
      </div>
    {/if}
    <button
      type="button"
      class="icon"
      title={t("pane.blockview.copy")}
      aria-label={t("pane.blockview.copy")}
      data-block-view-copy
      onclick={() => void copy(open.text, "output")}><UiIcon name="copy" size={14} /></button
    >
    <button
      type="button"
      class="icon"
      title={t("pane.blockview.close")}
      aria-label={t("pane.blockview.close")}
      data-block-view-close
      onclick={close}><UiIcon name="close" size={14} /></button
    >
  </header>
  {#if open.partial}
    <p class="partial">{t("pane.blockview.partial")}</p>
  {/if}
  <div class="body" data-block-view-body={view}>
    {#if view === "tree"}
      <JsonTree value={detected.json} />
    {:else if view === "table" && table}
      <table class="grid">
        <thead>
          <tr>
            {#each table.columns as c, i (i)}
              <th>
                <button type="button" class="th" data-col={i} onclick={() => sortBy(i)}
                  >{c}{#if sort?.col === i}<span class="dir" aria-hidden="true">{sort.dir === 1 ? " ↑" : " ↓"}</span>{/if}</button
                >
              </th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each rows as r, ri (ri)}
            <tr>
              {#each table.columns as _c, ci (ci)}
                {@const v = r[ci] ?? null}
                <td class:empty={v === null || v === ""} title={v ?? ""} onclick={() => v !== null && void copy(v, "cell")}>{v ?? "—"}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    {:else if view === "rendered"}
      <div class="md"><MarkdownBlocks blocks={parseMarkdown(open.text)} /></div>
    {:else}
      <pre class="raw">{open.text}</pre>
    {/if}
  </div>
</div>

<style>
  /* 막 — 터미널 상자만 덮는다(상자 밖 · 머리줄은 그대로) */
  .bv-scrim {
    position: absolute;
    inset: 0;
    z-index: 20;
    background: rgba(5, 6, 8, 0.55);
  }

  .bv-scrim.clear {
    background: transparent;
  }

  .bv-card {
    position: absolute;
    z-index: 21;
    display: flex;
    flex-direction: column;
    min-height: 0;
    box-sizing: border-box;
    font-family: var(--font-ui);
    color: var(--fg-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    box-shadow: var(--shadow-raised);
    overflow: hidden;
    outline: none;
  }

  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    height: 40px;
    padding: 0 var(--space-2) 0 var(--space-4);
    border-bottom: 1px solid var(--line);
    font-size: var(--t-sm);
  }

  .title {
    flex: 0 0 auto;
    font-weight: var(--fw-semibold);
  }

  .cmd {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .meta {
    flex: 0 0 auto;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .meta.fail {
    color: var(--err);
  }

  .grow {
    flex: 1;
  }

  .tabs {
    flex: 0 0 auto;
    display: inline-flex;
    gap: 4px;
  }

  .tab {
    height: 26px;
    padding: 0 10px;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 7px;
    cursor: pointer;
  }

  .tab.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .icon:hover,
  .tab:hover {
    background: var(--surface-hover);
    color: var(--fg-1);
  }

  .tab:focus-visible,
  .icon:focus-visible,
  .th:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .partial {
    margin: 0;
    padding: var(--space-1) var(--space-4);
    font-size: var(--t-xs);
    color: var(--warn);
    border-bottom: 1px solid var(--line);
  }

  .body {
    flex: 1;
    min-height: 0;
    overflow: auto;
    padding: var(--space-3) var(--space-4);
  }

  .raw {
    margin: 0;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.6;
    white-space: pre;
    color: var(--fg-1);
  }

  .md {
    max-width: 860px;
  }

  .grid {
    width: 100%;
    border-collapse: collapse;
    font-size: var(--t-sm);
  }

  .grid th {
    position: sticky;
    top: calc(-1 * var(--space-3));
    padding: 0;
    text-align: left;
    background: var(--surface-raised-solid);
    border-bottom: 1px solid var(--line-strong);
  }

  .th {
    width: 100%;
    padding: 6px 8px;
    font: inherit;
    font-weight: 500;
    text-align: left;
    color: var(--fg-2);
    background: transparent;
    border: none;
    cursor: pointer;
    white-space: nowrap;
  }

  .th:hover {
    color: var(--fg-1);
  }

  .grid td {
    max-width: 420px;
    padding: 6px 8px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    border-bottom: 1px solid var(--line);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    cursor: copy;
  }

  .grid td.empty {
    color: var(--fg-3);
    cursor: default;
  }

  .grid tr:hover td {
    background: var(--surface-hover);
  }
</style>
