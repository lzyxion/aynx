<script lang="ts">
  /**
   * MCP 서버 상태 풍선 — 읽기만. 줄은 이름 · 상태 · 인증 낱말 · 도구 수 · Aynx 표뿐이다(값 · URL · 오류 글은 받지도 그리지도 않는다).
   * CLI 에 묻는 것은 여는 쪽(연 때 한 번 · [새로 고침])뿐 — 열려 있는 동안 스스로 다시 묻지 않는다. 켜기 · 끄기 · 로그인 단추는 짓지 않는다.
   */
  import { untrack } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import type { ChatTileMcpStatus } from "$lib/chat-tile/chat-tile-api";
  import { mcpAskKey, mcpAuthKey, mcpNeedsLogin, mcpRowIdle, mcpRowsSorted, mcpStateKey, type McpAsk } from "$lib/chat-tile/chat-tile-mcp";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    cli,
    status,
    ask,
    error = null,
    notStarted = false,
    anchor,
    bound = null,
    touch = false,
    onrefresh,
    onclose,
  }: {
    cli: "claude" | "codex";
    status: ChatTileMcpStatus | null;
    ask: McpAsk | null;
    /** 읽기 op 의 거절 — 문구로 고른 것 */
    error?: string | null;
    /** CLI 를 한 번도 띄우지 않아 아는 것이 없다 — 빈 목록 대신 "첫 메시지 뒤에 보인다" */
    notStarted?: boolean;
    /** 입력 칸 상자(또는 그 안의 칩) — 그 위에 선다 */
    anchor: HTMLElement;
    /** 위 끝을 이 상자(타일 몸) 안에 — 탭 띠 · 옆 타일을 덮지 않게 */
    bound?: HTMLElement | null;
    touch?: boolean;
    onrefresh: () => void;
    /** `back` = 입력 칸으로 포커스를 돌린다 */
    onclose: (back: boolean) => void;
  } = $props();

  const EDGE = 8;
  const MAX_W = 380;
  const headId = `ct-mcp-${Math.random().toString(36).slice(2, 10)}`;
  let el = $state<HTMLElement | null>(null);
  let left = $state(0);
  let top = $state(0);
  let width = $state<number | null>(null);
  let maxH = $state<number | null>(null);

  const rows = $derived(mcpRowsSorted(status?.servers ?? []));
  const asking = $derived(ask === "asking" || ask === "slow");
  const fresh = $derived(notStarted && (status?.servers.length ?? 0) === 0);
  const dimKey = $derived(fresh ? null : mcpAskKey(ask, status?.stale ?? false));

  function place(): void {
    const node = el;
    if (!node) return;
    const r = anchor.getBoundingClientRect();
    const box = anchor.closest("[data-flip-composer] .wrap")?.getBoundingClientRect() ?? r;
    width = Math.min(MAX_W, Math.max(240, box.width), window.innerWidth - 2 * EDGE);
    const w = width;
    left = Math.max(EDGE, Math.min(box.left, window.innerWidth - EDGE - w));
    // 입력 칸 상자 위에 — 친 글을 덮지 않게. 위 자리가 모자라면 그 높이까지만 서고 줄 목록이 구른다
    const ceil = Math.max(EDGE, bound?.getBoundingClientRect().top ?? EDGE);
    const room = box.top - 4 - ceil;
    const below = window.innerHeight - EDGE - (r.bottom + 4);
    if (room >= 160 || room >= below) {
      maxH = Math.max(120, room);
      const h = Math.min(node.scrollHeight, maxH);
      top = Math.max(ceil, box.top - 4 - h);
    } else {
      maxH = Math.max(120, below);
      top = r.bottom + 4;
    }
  }

  $effect(() => {
    const node = el;
    if (!node) return;
    return untrack(() => {
      place();
      const ro = new ResizeObserver(place);
      ro.observe(node);
      const list = node.querySelector("[data-chat-tile-mcp-rows]");
      if (list) ro.observe(list);
      (node.querySelector<HTMLElement>("[data-chat-tile-mcp-refresh]") ?? node).focus({ preventScroll: true });
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

  function onKey(ev: KeyboardEvent): void {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose(true);
      return;
    }
    if (ev.key.length === 1 && !ev.ctrlKey && !ev.altKey && !ev.metaKey) ev.stopPropagation();
  }

  function refresh(): void {
    if (!asking) onrefresh();
  }

  /** 상태 점의 색 무리 */
  function tone(state: string): string {
    if (state === "connected") return "ok";
    if (state === "needsAuth" || state === "failed") return "warn";
    if (state === "connecting") return "run";
    return "off";
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="mcp menu-surface"
  class:touch
  role="dialog"
  aria-labelledby={headId}
  tabindex="-1"
  bind:this={el}
  style="left:{left}px;top:{top}px{width !== null ? `;width:${width}px` : ''}{maxH !== null ? `;max-height:${maxH}px` : ''}"
  onkeydown={onKey}
  data-chat-tile-mcp-popover={cli}
  data-ask={ask ?? "idle"}
>
  <div class="head">
    <UiIcon name="mcp" size={14} />
    <span class="title" id={headId}>{t("pane.chatTile.mcp.title")}</span>
    <button
      type="button"
      class="btn btn-ghost btn-sm refresh"
      aria-disabled={asking ? "true" : undefined}
      data-chat-tile-mcp-refresh
      onclick={refresh}
      ><span class:spin={asking} aria-hidden="true"><UiIcon name="refresh" size={13} /></span>{t("pane.chatTile.mcp.refresh")}</button
    >
  </div>
  {#if asking}
    <div class="line quiet" role="status" data-chat-tile-mcp-asking>
      <span class="spin" aria-hidden="true"><UiIcon name="sync" size={12} /></span><span>{t(ask === "slow" ? "pane.chatTile.mcp.slow" : "pane.chatTile.mcp.asking")}</span>
    </div>
  {:else if dimKey}
    <div class="line" class:quiet={ask !== "failed"} class:err={ask === "failed"} role="status" data-chat-tile-mcp-dim={ask ?? "stale"}>{t(dimKey)}</div>
  {/if}
  {#if error}<div class="line err" role="alert" data-chat-tile-mcp-error>{error}</div>{/if}
  {#if rows.length === 0}
    {#if fresh}<div class="line quiet" data-chat-tile-mcp-empty="not-started">{t("pane.chatTile.mcp.notStarted")}</div>
    {:else if !asking}<div class="line quiet" data-chat-tile-mcp-empty>{t("pane.chatTile.mcp.empty")}</div>{/if}
  {:else}
    <ul class="rows" data-chat-tile-mcp-rows>
      {#each rows as r (r.name)}
        {@const auth = mcpAuthKey(r.auth)}
        <li class="row" class:idle={mcpRowIdle(r)} data-chat-tile-mcp-row={r.name} data-state={r.state}>
          <div class="r1">
            {#if r.state === "connecting"}
              <span class="spin dot-spin" aria-hidden="true"><UiIcon name="sync" size={10} /></span>
            {:else}
              <span class="dot" data-tone={tone(r.state)} aria-hidden="true"></span>
            {/if}
            <span class="name" title={r.name}>{r.name}</span>
            {#if r.aynx}<span class="tag" data-chat-tile-mcp-tag="aynx">{t("pane.chatTile.mcp.tag.aynx")}</span>{/if}
            {#if r.picked}<span class="tag" data-chat-tile-mcp-tag="picked">{t("pane.chatTile.mcp.tag.picked")}</span>{/if}
          </div>
          <div class="r2">
            <span class="state" data-tone={tone(r.state)} data-chat-tile-mcp-state={r.state}>{t(mcpStateKey(r.state))}</span>
            {#if auth}<span class="sep" aria-hidden="true">·</span><span data-chat-tile-mcp-auth={r.auth}>{t(auth)}</span>{/if}
            {#if r.tools !== null}<span class="sep" aria-hidden="true">·</span><span data-chat-tile-mcp-tools={r.tools}>{t("pane.chatTile.mcp.tools", { n: r.tools })}</span>{/if}
          </div>
          {#if mcpNeedsLogin(r)}<div class="login" data-chat-tile-mcp-login>{t("pane.chatTile.mcp.loginTerminal")}</div>{/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .mcp {
    position: fixed;
    z-index: 41;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
    max-width: calc(100vw - 16px);
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    overflow: hidden;
  }

  .head {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    color: var(--fg-2);
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-3);
  }

  .refresh {
    flex: none;
    gap: 4px;
  }

  .refresh[aria-disabled="true"] {
    opacity: 0.55;
    cursor: default;
  }

  .mcp.touch .refresh {
    min-height: 40px;
  }

  .line {
    flex: none;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
    overflow-wrap: anywhere;
  }

  .line.quiet {
    color: var(--fg-3);
  }

  .line.err {
    color: var(--err);
  }

  .rows {
    flex: 0 1 auto;
    min-height: 0;
    margin: 0;
    padding: 0 var(--space-1) 0 0;
    list-style: none;
    overflow-y: auto;
    overscroll-behavior: contain;
    display: flex;
    flex-direction: column;
  }

  .row {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 1px;
    padding: 6px 0;
    border-top: 1px solid var(--line);
  }

  .row:first-child {
    border-top: none;
  }

  .row.idle {
    opacity: 0.55;
  }

  .r1 {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .dot {
    flex: none;
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--fg-3);
  }

  .dot[data-tone="ok"] {
    background: var(--ok);
  }

  .dot[data-tone="warn"] {
    background: var(--warn);
  }

  .dot[data-tone="off"] {
    opacity: 0.5;
  }

  .dot-spin {
    width: 10px;
    color: var(--fg-2);
  }

  .name {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-sm);
  }

  .tag {
    flex: none;
    padding: 0 6px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    white-space: nowrap;
  }

  .r2 {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 4px;
    padding-left: 14px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .state[data-tone="warn"] {
    color: var(--warn);
  }

  .state[data-tone="ok"] {
    color: var(--ok);
  }

  .sep {
    color: var(--fg-3);
  }

  .login {
    padding-left: 14px;
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .spin {
    flex: none;
    display: inline-flex;
    animation: mcp-spin 1.1s linear infinite;
  }

  @keyframes mcp-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }
</style>
