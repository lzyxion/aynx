<script lang="ts">
  /**
   * 맥락 사용량 풍선 — 수 · 출처 · 마지막 압축 · [지금 압축]. 압축은 부르는 쪽이 한다(`runOnMenu` → 사람 op 하나 · 프로세스가 없으면 입력 칸에 넣기만).
   * 지침 칸은 Claude 만 — Codex 압축은 지침을 받지 않는다(서버도 거절한다).
   * 마지막 압축은 압축 전 수만 보인다 — 압축 뒤 수는 CLI 마다 미터와 기준이 다르다.
   * MCP 요약 줄은 누르면 MCP 상태 풍선으로 바꿔 연다(부르는 쪽) — 이 풍선은 CLI 에 묻지 않는다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import type { ChatTileCompaction } from "$lib/chat-tile/chat-tile-api";
  import { formatTokens, type ContextView } from "$lib/chat-tile/chat-tile-context";
  import type { SideChatStatus } from "$lib/side-chat-api";
  import type { Key } from "$lib/i18n/keys";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    cli,
    view,
    last,
    source,
    status,
    canCompact,
    anchor,
    touch = false,
    mcp = null,
    oncompact,
    onmcp,
    onclose,
  }: {
    cli: "claude" | "codex";
    view: ContextView;
    last: ChatTileCompaction | null;
    source: string;
    status: SideChatStatus;
    canCompact: boolean;
    /** 미터 칩 */
    anchor: HTMLElement;
    touch?: boolean;
    /** `mcpSummary` — null 이면 줄이 없다 */
    mcp?: { total: number; trouble: number } | null;
    oncompact: (instructions: string | null) => void;
    onmcp?: () => void;
    /** `back` = 칩으로 포커스를 돌린다 */
    onclose: (back: boolean) => void;
  } = $props();

  const EDGE = 8;
  const MAX_W = 340;
  const SOURCES = new Set(["turn", "command", "compact", "tokenUsage", "preCompact"]);
  let el = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  let width = $state<number | null>(null);
  let instr = $state("");

  const n = (v: number) => v.toLocaleString();
  const big = $derived(
    view.window === null || view.pct === null
      ? t("pane.chatTile.ctx.noWindow", { used: n(view.used) })
      : t("pane.chatTile.ctx.tokens", { used: n(view.used), window: n(view.window), pct: String(view.pct) }),
  );
  const lastLine = $derived(
    last === null
      ? null
      : last.preTokens !== null
        ? t("pane.chatTile.ctx.last", { pre: formatTokens(last.preTokens) })
        : t("pane.chatTile.ctx.lastNoTokens"),
  );
  // Codex 는 프로세스가 없으면 압축할 것이 없다 — Claude 는 입력 칸에 넣어 사람이 보내게 한다
  const blocked = $derived(!canCompact ? t("pane.chatTile.ctx.busy") : cli === "codex" && status === "stopped" ? t("pane.chatTile.ctx.notStarted") : null);

  function place(): void {
    const node = el;
    if (!node) return;
    const r = anchor.getBoundingClientRect();
    const box = anchor.closest("[data-flip-composer] .wrap")?.getBoundingClientRect() ?? null;
    if (box) width = Math.min(MAX_W, box.width, window.innerWidth - 2 * EDGE);
    const w = box && width !== null ? width : node.offsetWidth;
    const h = node.offsetHeight;
    const start = box ? Math.max(box.left, Math.min(r.left, box.right - w)) : r.left;
    left = Math.max(EDGE, Math.min(start, window.innerWidth - EDGE - w));
    // 입력 칸 상자 위에 — 친 글을 덮지 않게
    const above = (box ? box.top : r.top) - 4 - h;
    top = above >= EDGE ? above : Math.min(r.bottom + 4, Math.max(EDGE, window.innerHeight - EDGE - h));
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(node);
      // 막힌 [지금 압축] 에는 포커스를 주지 않는다 — 포커스 말풍선이 이유를 가리지 않게(이유는 단추 밑 줄에 늘 보인다)
      const go = blocked === null ? node.querySelector<HTMLElement>("[data-chat-tile-compact]") : null;
      const first = node.querySelector<HTMLElement>("[data-chat-tile-compact-instr]") ?? go;
      (first ?? node).focus({ preventScroll: true });
      return () => ro.disconnect();
    });
  });

  $effect(() => {
    const onDown = (ev: PointerEvent) => {
      const target = ev.target;
      if (!(target instanceof Node)) return;
      if (el?.contains(target) || anchor.contains(target)) return;
      onclose(false);
    };
    const onResize = () => onclose(false);
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("resize", onResize);
    };
  });

  function compact(): void {
    if (blocked !== null) return;
    const v = instr.trim();
    oncompact(cli === "claude" && v !== "" ? v : null);
  }

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose(true);
      return;
    }
    // 글을 치는 키가 타일 · 앱 단축키로 새지 않게
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="ctp menu-surface"
  class:touch
  role="dialog"
  aria-label={t("pane.chatTile.ctx.title")}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{top}px{width !== null ? `;width:${width}px;min-width:0;max-width:none` : ''}"
  onkeydown={onKey}
  data-chat-tile-context-popover={cli}
>
  <div class="ctp-head">{t("pane.chatTile.ctx.title")}</div>
  <div class="ctp-big" data-tone={view.tone} data-chat-tile-context-tokens>{big}</div>
  {#if SOURCES.has(source)}
    <div class="ctp-line" data-chat-tile-context-source={source}>{t(`pane.chatTile.ctx.src.${source}` as Key)}</div>
  {/if}
  {#if lastLine}
    <div class="ctp-line" data-chat-tile-context-last>{lastLine}</div>
  {/if}
  {#if cli === "claude"}
    <input
      class="ctp-instr"
      type="text"
      maxlength="1000"
      spellcheck="false"
      autocomplete="off"
      placeholder={t("pane.chatTile.ctx.instructions")}
      aria-label={t("pane.chatTile.ctx.instructions")}
      bind:value={instr}
      data-chat-tile-compact-instr
      onkeydown={(ev) => {
        if (ev.key === "Enter" && !ev.isComposing && ev.keyCode !== 229) {
          ev.preventDefault();
          compact();
        }
      }}
    />
  {/if}
  <button
    type="button"
    class="btn btn-primary btn-sm ctp-go"
    aria-disabled={blocked === null ? undefined : "true"}
    title={blocked ?? undefined}
    data-chat-tile-compact
    onclick={compact}>{t("pane.chatTile.ctx.compact")}</button
  >
  {#if blocked !== null}
    <div class="ctp-why" data-chat-tile-compact-blocked>{blocked}</div>
  {/if}
  <div class="ctp-note">{cli === "claude" ? t("pane.chatTile.ctx.autoNote") : t("pane.chatTile.ctx.codexNote")}</div>
  {#if mcp && onmcp}
    <button type="button" class="ctp-mcp" class:trouble={mcp.trouble > 0} data-chat-tile-context-mcp onclick={onmcp}
      ><UiIcon name="mcp" size={13} /><span class="ctp-mcp-text">{t("pane.chatTile.mcp.summary", { total: mcp.total, trouble: mcp.trouble })}</span><UiIcon
        name="chevron"
        size={12}
      /></button
    >
  {/if}
</div>

<style>
  .ctp {
    position: fixed;
    z-index: 41;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    width: max-content;
    min-width: 240px;
    max-width: min(340px, calc(100vw - 16px));
    padding: var(--space-3);
  }

  .ctp-head {
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-3);
  }

  .ctp-big {
    font-size: var(--t-sm);
    font-weight: var(--fw-semibold);
    font-variant-numeric: tabular-nums;
    overflow-wrap: anywhere;
  }

  .ctp-big[data-tone="warn"] {
    color: var(--warn);
  }

  .ctp-big[data-tone="high"] {
    color: var(--err);
  }

  .ctp-line {
    font-size: var(--t-xs);
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .ctp-instr {
    box-sizing: border-box;
    width: 100%;
    height: 30px;
    margin-top: var(--space-1);
    padding: 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .ctp.touch .ctp-instr {
    height: 40px;
  }

  .ctp-instr:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 0;
  }

  .ctp-go {
    align-self: flex-start;
    margin-top: var(--space-1);
  }

  .ctp.touch .ctp-go {
    min-height: 40px;
  }

  .ctp-go[aria-disabled="true"] {
    opacity: 0.5;
    cursor: default;
  }

  .ctp-note {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .ctp-mcp {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: var(--space-1);
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    text-align: left;
    background: var(--control-tile-bg);
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .ctp-mcp:hover {
    background: var(--control-tile-bg-hover);
  }

  .ctp-mcp:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .ctp-mcp.trouble {
    color: var(--warn);
  }

  .ctp.touch .ctp-mcp {
    min-height: 40px;
  }

  .ctp-mcp-text {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .ctp-why {
    font-size: var(--t-xs);
    color: var(--fg-2);
  }
</style>
