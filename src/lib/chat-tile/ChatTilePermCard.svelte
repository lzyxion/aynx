<script module lang="ts">
  function scrollerOf(el: HTMLElement): HTMLElement | null {
    for (let x = el.parentElement; x; x = x.parentElement) {
      const o = getComputedStyle(x).overflowY;
      if (o === "auto" || o === "scroll") return x;
    }
    return null;
  }

  /**
   * 기다리는 카드를 대화 칸 높이(`--perm-room`)까지로 묶고 단추 줄이 보이게 굴려 둔다 — 계획 · 질문 카드도 같은 규칙.
   * 카드 CSS 는 `max-height: var(--perm-room)` · 머리 · 단추 줄 `flex: none` · 몸만 `overflow-y: auto` 여야 단추 줄이 늘 보인다.
   * `minRoom` 보다 대화 칸이 낮으면 카드가 칸을 넘는다 — 그 칸 높이까지 줄어도 되는 카드만 낮춘다.
   */
  export function holdCardInView(card: HTMLElement, actions: () => HTMLElement | null, minRoom = 140): () => void {
    const sc = scrollerOf(card);
    if (!sc) return () => {};
    const fit = () => {
      const cs = getComputedStyle(sc);
      const room = sc.clientHeight - (parseFloat(cs.paddingTop) || 0) - (parseFloat(cs.paddingBottom) || 0) - 8;
      card.style.setProperty("--perm-room", `${Math.max(minRoom, room)}px`);
      // 낮은 타일 — 카드가 여백을 줄여 몸(선택지 · diff)에 높이를 더 준다
      card.toggleAttribute("data-tight", room < 360);
    };
    // 단추 줄이 대화 칸 안에 들게 — 위로 넘치면 카드 머리가 보이게
    const reveal = () => {
      const a = actions()?.getBoundingClientRect();
      if (!a) return;
      const c = card.getBoundingClientRect();
      const S = sc.getBoundingClientRect();
      if (a.bottom > S.bottom) sc.scrollTop += a.bottom - S.bottom + 12;
      else if (c.top < S.top && a.bottom - c.top <= S.height) sc.scrollTop -= S.top - c.top + 12;
    };
    fit();
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(fit);
    ro?.observe(sc);
    const raf = requestAnimationFrame(() => requestAnimationFrame(reveal));
    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
    };
  }
</script>

<script lang="ts">
  /**
   * 채팅 타일의 권한 카드 — 답은 사람만 낸다(`chat_tile_decide`). [이 대화에서 늘 허용]은 서버가 그 요청에 요약을 실었을 때만 서고
   * 결정 낱말만 보낸다 — 무엇을 실을지는 서버 어댑터가 고른다. 단추 글(`sessionAllowLabel`)은 누르면 실제로 되는 일을 말한다.
   * diff 는 요청에 실린 도구 입력으로만 짓는다(파일을 읽지 않는다) — 입력이 없으면 서버의 설명 글을 그대로.
   * 명령은 전체 글 · MCP 는 서버 · 도구 · 인자를 보인다. Codex 패치는 diff 를 위에, 실제로 도는 명령 전체를 밑에 둔다.
   * 모델이 쓴 이유는 그 아래 따로 — 사람이 그 설명만 보고 허용하지 않게.
   */
  import { onMount } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { LiveEntry } from "$lib/side-chat-live";
  import type { SessionAllowView } from "$lib/side-chat-api";
  import { chatPermKindText, chatPermView, sessionAllowLabel } from "$lib/chat-tile/chat-tile-text";

  let {
    perm,
    input,
    sessionAllow,
    agent,
    busy,
    ondecide,
  }: {
    perm: Extract<LiveEntry, { kind: "permission" }>;
    /** `live.permInputs[requestId]` */
    input?: unknown;
    /** `live.permSessions[requestId]` — 없으면 셋째 단추가 없다 */
    sessionAllow?: SessionAllowView;
    agent: string;
    busy: boolean;
    ondecide: (d: "allow" | "deny" | "allowSession") => void;
  } = $props();

  let cardEl = $state<HTMLElement | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);
  /** 이 카드에서 [늘 허용]을 눌렀다 — 끝난 줄 글자만 고른다 */
  let pickedSession = $state(false);

  onMount(() => {
    const el = cardEl;
    if (!el || perm.resolved) return;
    return holdCardInView(el, () => actionsEl);
  });

  const view = $derived(chatPermView(perm, input));
  const kindText = $derived(chatPermKindText(view, perm.toolName));
  const doneWhat = $derived(
    view.patch && view.patch.files.length > 0
      ? view.patch.files.join(" · ")
      : view.command
        ? view.command.text.split("\n")[0]
        : view.mcp
          ? `${view.mcp.server} · ${view.mcp.tool}`
          : view.target,
  );
  const resolvedText = $derived.by(() => {
    const r = perm.resolved;
    if (!r) return "";
    if (r.by === "human" && r.decision === "allow" && pickedSession) return t("pane.chatTile.perm.allowedSession");
    if (r.by === "human") return t(r.decision === "allow" ? "pane.chatTile.perm.allowed" : "pane.chatTile.perm.denied");
    return t("pane.chatTile.perm.cancelled");
  });
</script>

{#snippet diffRows(rows: { op: string; text: string }[])}
  <div class="perm-diff" data-chat-tile-perm-diff>
    {#each rows as r, i (i)}
      {#if r.op === "gap"}
        <div class="row gap" aria-hidden="true">⋯</div>
      {:else}
        <div class="row" class:add={r.op === "+"} class:del={r.op === "-"} class:hunk={r.op === "hunk"} data-op={r.op}>
          <span class="sign" aria-hidden="true">{r.op === "hunk" ? "" : r.op}</span><span class="txt">{r.text}</span>
        </div>
      {/if}
    {/each}
  </div>
{/snippet}

{#if perm.resolved}
  <div class="done" data-chat-tile-perm={perm.requestId} data-chat-tile-perm-result={perm.resolved.by}>
    <span class="done-icon" aria-hidden="true"><UiIcon name="shield-check" size={13} /></span>
    <span class="done-title">{kindText}{doneWhat ? ` · ${doneWhat}` : ""}</span>
    <span class="done-result">{resolvedText}</span>
  </div>
{:else}
  <div bind:this={cardEl} class="perm" role="group" aria-label={t("pane.chatTile.perm.title", { agent })} data-chat-tile-perm={perm.requestId} data-chat-tile-perm-kind={view.kind}>
    <div class="perm-head">
      <UiIcon name="shield-check" size={16} />
      <span class="perm-title">{t("pane.chatTile.perm.title", { agent })}</span>
      {#if view.kind === "mcp"}<span class="perm-badge">MCP</span>{/if}
    </div>
    <div class="perm-body" data-chat-tile-perm-body>
      <div class="perm-kind" title={perm.title || undefined}>{kindText}</div>
      {#if view.patch}
        {#if view.patch.files.length > 0}<div class="perm-path" data-chat-tile-perm-patch-files>{view.patch.files.join(" · ")}</div>{/if}
        <div data-chat-tile-perm-patch>{@render diffRows(view.patch.rows)}</div>
        {#if view.patch.truncated}<div class="perm-warn" data-chat-tile-perm-patch-truncated>{t("pane.chatTile.perm.truncated")}</div>{/if}
      {/if}
      {#if view.command}
        {#if view.patch}<div class="perm-label" data-chat-tile-perm-patch-command>{t("pane.chatTile.perm.patchCommand")}</div>{/if}
        <pre class="perm-detail perm-cmd" data-chat-tile-perm-command>{view.command.text}</pre>
        {#if view.command.truncated}<div class="perm-warn" data-chat-tile-perm-truncated>{t("pane.chatTile.perm.truncated")}</div>{/if}
        {#if view.command.cwd}
          <div class="perm-field" data-chat-tile-perm-cwd>
            <span class="perm-label">{t("pane.chatTile.perm.cwd")}</span><span class="perm-path">{view.command.cwd}</span>
          </div>
        {/if}
      {:else if view.mcp}
        <div class="perm-field" data-chat-tile-perm-mcp-server>
          <span class="perm-label">{t("pane.chatTile.perm.server")}</span><span class="perm-path">{view.mcp.server}</span>
        </div>
        <div class="perm-field" data-chat-tile-perm-mcp-tool>
          <span class="perm-label">{t("pane.chatTile.perm.tool")}</span><span class="perm-path">{view.mcp.tool || "?"}</span>
        </div>
        <div class="perm-field top" data-chat-tile-perm-mcp-args>
          <span class="perm-label">{t("pane.chatTile.perm.args")}</span>
          {#if view.mcp.args !== null}
            <pre class="perm-detail perm-args">{view.mcp.args}</pre>
          {:else}
            <span class="perm-none">{t("pane.chatTile.perm.noArgs")}</span>
          {/if}
        </div>
      {:else if view.target}
        <div class="perm-path" data-chat-tile-perm-target>{view.target}</div>
      {/if}
      {#if view.diff && view.diff.length > 0}
        {@render diffRows(view.diff)}
      {:else if view.text}
        <pre class="perm-detail" class:diff={view.kind === "patch"} data-chat-tile-perm-text>{view.text}</pre>
      {/if}
      {#if view.reason}
        <div class="perm-reason" data-chat-tile-perm-reason>
          <span class="perm-label">{t("pane.chatTile.perm.reason")}</span><span class="perm-reason-text">{view.reason}</span>
        </div>
      {/if}
    </div>
    <div bind:this={actionsEl} class="perm-actions" data-chat-tile-perm-actions>
      <button type="button" class="btn btn-primary btn-sm" data-chat-tile-allow disabled={busy} onclick={() => ondecide("allow")}
        >{t("pane.chatTile.perm.allow")}</button
      >
      <button type="button" class="btn btn-secondary btn-sm" data-chat-tile-deny disabled={busy} onclick={() => ondecide("deny")}
        >{t("pane.chatTile.perm.deny")}</button
      >
      {#if sessionAllow}
        <button
          type="button"
          class="btn btn-secondary btn-sm session"
          data-chat-tile-perm-session={sessionAllow.kind}
          title={`${sessionAllowLabel(sessionAllow, true)}\n${t("pane.chatTile.perm.session.tip")}`}
          disabled={busy}
          onclick={() => {
            pickedSession = true;
            ondecide("allowSession");
          }}>{sessionAllowLabel(sessionAllow)}</button
        >
      {/if}
    </div>
  </div>
{/if}

<style>
  /* AI 타일 권한 카드(`pane/TilePermissionCard`) · 사이드 채팅 카드와 같은 판 */
  .perm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid color-mix(in srgb, var(--warn) 55%, var(--line-strong));
    border-radius: 10px;
    overflow: hidden;
    box-sizing: border-box;
    max-height: var(--perm-room, none);
  }

  .perm-head,
  .perm-actions {
    flex: none;
  }

  /* 긴 몫(명령 · diff · 인자)은 여기서 구른다 — 머리 · 단추 줄은 카드에 붙어 있다 */
  .perm-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .perm-body > * {
    flex-shrink: 0;
  }

  .perm-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-semibold);
  }

  .perm-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .perm-badge {
    flex: none;
    padding: 1px 8px;
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
    color: var(--fg-2);
    border: 1px solid var(--line);
    border-radius: 999px;
  }

  .perm-kind {
    font-size: var(--t-xs);
    color: var(--fg-1);
  }

  .perm-field {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    font-size: var(--t-xs);
  }

  .perm-field.top {
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-1);
  }

  .perm-label {
    flex: none;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .perm-none {
    color: var(--fg-3);
  }

  .perm-cmd {
    color: var(--fg-1);
  }

  .perm-warn {
    font-size: var(--t-xs);
    color: var(--warn);
    overflow-wrap: anywhere;
  }

  /* 모델이 쓴 글 — 허용할 것 자체(위)보다 낮게 */
  .perm-reason {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding-left: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
    border-left: 2px solid var(--line);
    overflow-wrap: anywhere;
  }

  .perm-reason-text {
    font-style: italic;
  }

  .perm-path {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .perm-detail {
    margin: 0;
    max-height: 240px;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.5;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .perm-detail.diff {
    white-space: pre;
    overflow-wrap: normal;
  }

  .perm-diff {
    max-height: 260px;
    overflow-x: hidden;
    overflow-y: auto;
    padding: var(--space-1) 0;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.5;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  /* 긴 줄은 감싼다 — 좁은 타일에서 가로 스크롤 없이 */
  .row {
    display: flex;
    min-width: 0;
    padding: 0 var(--space-3) 0 var(--space-2);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  .row .txt {
    flex: 1 1 auto;
    min-width: 0;
  }

  .row .sign {
    flex: none;
    width: 1.4em;
    color: var(--fg-3);
    user-select: none;
  }

  .row.add {
    background: color-mix(in srgb, var(--ok) 14%, transparent);
  }

  .row.add .sign {
    color: var(--ok);
  }

  .row.del {
    background: color-mix(in srgb, var(--err) 12%, transparent);
  }

  .row.del .sign {
    color: var(--err);
  }

  .row.hunk {
    color: var(--fg-3);
  }

  .row.gap {
    justify-content: center;
    color: var(--fg-3);
  }

  .perm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .perm-actions .btn {
    flex: 1 1 auto;
    justify-content: center;
    white-space: nowrap;
  }

  /* 늘 허용 글은 규칙 · 폴더를 실어 길다 — 한 줄을 다 쓰고 넘치면 감싼다 */
  .perm-actions .btn.session {
    flex: 1 1 100%;
    min-width: 0;
    height: auto;
    min-height: 28px;
    padding-top: 4px;
    padding-bottom: 4px;
    white-space: normal;
    overflow-wrap: anywhere;
    text-align: center;
  }

  .done {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .done-icon {
    flex: none;
    display: inline-flex;
    color: var(--fg-2);
  }

  .done-title {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-2);
  }

  .done-result {
    flex: none;
    white-space: nowrap;
  }

  .done-result::before {
    content: "· ";
  }
</style>
