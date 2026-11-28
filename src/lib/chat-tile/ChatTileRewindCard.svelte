<script lang="ts">
  /**
   * 되감기 확인 카드 — 대화 끝(입력 칸 위)의 꼬리 카드 자리. 되감기는 사람이 [실행]을 눌러야만 시작한다.
   * [실행]은 고른 범위의 미리 보기가 `can:true` 로 온 뒤에만 서고 첫 포커스는 [취소]다(Enter 가 곧바로 되감지 않게).
   * 범위를 바꾸면 미리 보기를 다시 묻는다(`onscope`) — 실행은 미리 본 범위에만 된다.
   */
  import { onMount, tick } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { holdCardInView } from "$lib/chat-tile/ChatTilePermCard.svelte";
  import { isImeKey } from "$lib/pane/ai-flip-keys";
  import type { RewindScope } from "$lib/side-chat-api";
  import type { ChatTileRewindAsk } from "$lib/chat-tile/chat-tile-rewind";
  import { rewindCardLines, rewindConfirmKey, rewindErrorText, rewindPinnedKey, rewindRetryable, rewindScopeKey, rewindTitleKey } from "$lib/chat-tile/chat-tile-text";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    ask,
    cli,
    cwd,
    scopes,
    busy = false,
    touch = false,
    onconfirm,
    oncancel,
    onscope,
  }: {
    ask: ChatTileRewindAsk;
    cli: "claude" | "codex";
    cwd: string;
    /** 이 CLI 가 되감는 범위 — 둘 이상이면 고르기가 선다 */
    scopes: readonly RewindScope[];
    /** 턴 중 · 카드 대기 — [다시 확인]을 막는다 */
    busy?: boolean;
    touch?: boolean;
    onconfirm: () => void;
    oncancel: () => void;
    onscope: (scope: RewindScope) => void;
  } = $props();

  const headId = `ct-rw-${Math.random().toString(36).slice(2, 10)}`;
  let cardEl = $state<HTMLElement | null>(null);
  let actionsEl = $state<HTMLElement | null>(null);
  let cancelEl = $state<HTMLButtonElement | null>(null);

  onMount(() => {
    void tick().then(() => cancelEl?.focus({ preventScroll: true }));
  });

  // 미리 보기가 오면 카드가 자란다 — 단추 줄이 다시 보이게
  $effect(() => {
    const el = cardEl;
    void ask.phase;
    void ask.preview;
    void ask.error;
    if (!el) return;
    return holdCardInView(el, () => actionsEl);
  });

  const applying = $derived(ask.phase === "applying");
  const canConfirm = $derived(applying || (ask.phase === "ready" && !!ask.preview?.can));
  const canRetry = $derived(ask.phase === "ready" && !ask.preview && rewindRetryable(ask.error));
  const lines = $derived(rewindCardLines(ask, cli));
  /** 낮은 카드(`data-tight`)에서만 보인다 — [실행]이 보이면 가장 무거운 경고 하나도 구르지 않고 보이게 */
  const pinKey = $derived(canConfirm ? rewindPinnedKey(lines) : null);
  const errorText = $derived(rewindErrorText(ask));

  // 포커스가 있던 단추가 사라지거나 막히면(실행 → 실패 · 다시 시도 → 없음) 몸으로 떨어지지 않게 [취소]로
  let lastFocus: HTMLElement | null = null;
  $effect(() => {
    void canConfirm;
    void canRetry;
    void applying;
    void busy;
    void tick().then(() => {
      const a = document.activeElement;
      if (a && a !== document.body) return;
      if (!lastFocus || (lastFocus.isConnected && !(lastFocus as HTMLButtonElement).disabled)) return;
      if (cancelEl && !cancelEl.disabled) cancelEl.focus({ preventScroll: true });
    });
  });

  /** cwd 안 경로는 짧게 — Codex 목록은 도구 입력의 경로 그대로다 */
  function shortPath(p: string): string {
    const base = cwd.replace(/[\\/]+$/, "");
    if (base === "") return p;
    const norm = (x: string) => x.replace(/\\/g, "/").toLowerCase();
    const head = norm(base) + "/";
    return norm(p).startsWith(head) ? p.slice(head.length).replace(/\\/g, "/") : p;
  }

  const claudeFiles = $derived(cli === "claude" && ask.preview?.can ? ask.preview.files : []);
  const moreFiles = $derived(cli === "claude" && ask.preview?.can ? ask.preview.moreFiles : 0);
  const localFiles = $derived(cli === "codex" && ask.preview?.can ? (ask.localFiles ?? []) : []);
  /** 파일 목록은 그 줄 바로 뒤에 선다 */
  const listAfter = (key: string) =>
    cli === "claude"
      ? key === "pane.chatTile.rewind.files.count" || key === "pane.chatTile.rewind.files.countNoLines"
      : key === "pane.chatTile.rewind.convo.filesHint";

  function onKey(ev: KeyboardEvent): void {
    if (ev.key !== "Escape" || isImeKey(ev)) return;
    ev.preventDefault();
    ev.stopPropagation();
    if (!applying) oncancel();
  }

  function pickScope(s: RewindScope): void {
    if (ask.phase !== "ready" || busy) return;
    if (s === ask.scope && ask.preview) return;
    onscope(s);
  }

  function onScopeKey(ev: KeyboardEvent): void {
    if (isImeKey(ev)) return;
    const dir = ev.key === "ArrowRight" || ev.key === "ArrowDown" ? 1 : ev.key === "ArrowLeft" || ev.key === "ArrowUp" ? -1 : 0;
    if (dir === 0) return;
    ev.preventDefault();
    const i = scopes.indexOf(ask.scope);
    const next = scopes[(i + dir + scopes.length) % scopes.length];
    pickScope(next);
    void tick().then(() => cardEl?.querySelector<HTMLElement>(`[data-chat-tile-rewind-scope="${next}"]`)?.focus({ preventScroll: true }));
  }
</script>

{#snippet fileList(paths: readonly string[], more: number)}
  <ul class="files" data-chat-tile-rewind-files>
    {#each paths as p, i (i)}<li class="file" title={p}>{shortPath(p)}</li>{/each}
    {#if more > 0}<li class="file more" data-chat-tile-rewind-more={more}>{t("pane.blockview.more", { n: more })}</li>{/if}
  </ul>
{/snippet}

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  bind:this={cardEl}
  class="card"
  class:touch
  role="group"
  aria-labelledby={headId}
  aria-busy={ask.phase !== "ready"}
  data-chat-tile-rewind-card={ask.phase}
  data-scope={ask.scope}
  onkeydown={onKey}
  onfocusin={(ev) => (lastFocus = ev.target as HTMLElement)}
>
  <!-- 낮은 카드에서는 이 칸만 구른다 — 단추 줄 밑으로 깔리는 줄이 없게 -->
  <div class="main" data-chat-tile-rewind-main>
    <div class="head">
      <UiIcon name="undo" size={16} />
      <span class="title" id={headId}>{t(rewindTitleKey(scopes))}</span>
    </div>
    {#if ask.quote}<div class="quote" data-chat-tile-rewind-quote title={ask.text}>「{ask.quote}」</div>{/if}
    {#if scopes.length > 1}
      <div class="scopes" role="radiogroup" aria-labelledby={headId} data-chat-tile-rewind-scopes>
        {#each scopes as s (s)}
          <button
            type="button"
            role="radio"
            class="scope"
            aria-checked={s === ask.scope}
            aria-disabled={ask.phase !== "ready" || busy ? "true" : undefined}
            tabindex={s === ask.scope ? 0 : -1}
            data-chat-tile-rewind-scope={s}
            onclick={() => pickScope(s)}
            onkeydown={onScopeKey}>{t(rewindScopeKey(s))}</button
          >
        {/each}
      </div>
    {/if}
    <div class="body" data-chat-tile-rewind-body>
      {#each lines as l, i (i)}
        <div
          class="line"
          class:quiet={ask.phase === "loading"}
          class:warn={l.key === "pane.chatTile.rewind.convo.codexFiles" || l.key === "pane.chatTile.rewind.files.onlyTracked"}
          class:pinned={l.key === pinKey}
          data-chat-tile-rewind-line={l.key.replace("pane.chatTile.rewind.", "")}
        >
          {#if ask.phase === "loading"}<span class="spin" aria-hidden="true"><UiIcon name="sync" size={13} /></span>{/if}<span>{t(l.key, l.vars)}</span>
        </div>
        {#if listAfter(l.key) && claudeFiles.length + moreFiles > 0}{@render fileList(claudeFiles, moreFiles)}{/if}
        {#if listAfter(l.key) && localFiles.length > 0}{@render fileList(localFiles, 0)}{/if}
      {/each}
      {#if errorText}<div class="error" role="alert" data-chat-tile-rewind-error>{errorText}</div>{/if}
    </div>
  </div>
  <div bind:this={actionsEl} class="actions" data-chat-tile-rewind-actions>
    {#if pinKey}<div class="pin" data-chat-tile-rewind-pin={pinKey.replace("pane.chatTile.rewind.", "")}>{t(pinKey)}</div>{/if}
    <button bind:this={cancelEl} type="button" class="btn btn-secondary btn-sm" data-chat-tile-rewind-cancel disabled={applying} onclick={oncancel}
      >{t("app.actions.cancel")}</button
    >
    {#if canRetry}
      <button type="button" class="btn btn-secondary btn-sm" data-chat-tile-rewind-retry disabled={busy} onclick={() => onscope(ask.scope)}
        >{t("pane.chatTile.err.retry")}</button
      >
    {/if}
    {#if canConfirm}
      <button type="button" class="btn btn-sm danger" data-chat-tile-rewind-confirm disabled={applying || busy} onclick={onconfirm}>
        {#if applying}<span class="spin" aria-hidden="true"><UiIcon name="sync" size={13} /></span>{/if}{t(rewindConfirmKey(ask.scope))}
      </button>
    {/if}
  </div>
</div>

<style>
  /* 권한 카드와 같은 판 — 머리 · 고르기 · 단추 줄은 붙고 본문만 구른다 */
  .card {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid color-mix(in srgb, var(--err) 45%, var(--line-strong));
    border-radius: 10px;
    overflow: hidden;
    box-sizing: border-box;
    max-height: var(--perm-room, none);
  }

  .main {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .head,
  .quote,
  .scopes,
  .actions {
    flex: none;
  }

  /* 낮은 타일 — 머리 · 고르기까지 다 붙이면 본문이 0 이 된다. 단추 줄 위 칸 전체가 구른다 */
  .card:global([data-tight]) {
    padding-top: var(--space-2);
    padding-bottom: 0;
  }

  .card:global([data-tight]) .main {
    overflow-y: auto;
  }

  .card:global([data-tight]) .body {
    flex: none;
    overflow: visible;
  }

  .card:global([data-tight]) .title {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 단추 곁에 붙인 경고는 낮은 카드에서만 — 본문의 같은 줄은 숨긴다 */
  .pin {
    display: none;
    flex: 1 0 100%;
    font-size: var(--t-xs);
    color: var(--warn);
    overflow-wrap: anywhere;
  }

  .card:global([data-tight]) .pin {
    display: block;
  }

  .card:global([data-tight]) .body .line.pinned {
    display: none;
  }

  /* 아래 여백은 단추 줄 안에 — 단추 줄 바닥이 카드 바닥이어야 `holdCardInView` 가 단추 줄을 대화 칸 밖으로 밀지 않는다 */
  .card:global([data-tight]) .actions {
    padding: var(--space-2) 0;
    border-top: 1px solid var(--line);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-semibold);
  }

  .title {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .quote {
    min-width: 0;
    font-size: var(--t-xs);
    color: var(--fg-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .scopes {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    padding: 3px;
    align-self: flex-start;
    max-width: 100%;
    box-sizing: border-box;
    background: var(--control-tile-bg);
    border-radius: 999px;
  }

  .scope {
    height: 24px;
    padding: 0 var(--space-3);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }

  .scope[aria-checked="true"] {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
    font-weight: var(--fw-semibold);
  }

  .scope[aria-disabled="true"] {
    cursor: default;
  }

  .scope[aria-disabled="true"]:not([aria-checked="true"]) {
    opacity: 0.55;
  }

  .scope:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .body > * {
    flex-shrink: 0;
  }

  .line {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    overflow-wrap: anywhere;
  }

  .line.quiet {
    color: var(--fg-3);
  }

  .line.warn {
    color: var(--warn);
  }

  /* 여덟 줄 높이에서 안쪽으로 구른다 — 폰은 다섯 줄 */
  .files {
    margin: 0;
    padding: var(--space-1) var(--space-3);
    list-style: none;
    max-height: calc(8 * 1.5em + 2 * var(--space-1));
    overflow-y: auto;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .card.touch .files {
    max-height: calc(5 * 1.5em + 2 * var(--space-1));
  }

  .file {
    overflow-wrap: anywhere;
  }

  .file.more {
    font-family: var(--font-ui);
    color: var(--fg-3);
  }

  .error {
    font-size: var(--t-xs);
    color: var(--err);
    overflow-wrap: anywhere;
  }

  .actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .actions .btn {
    flex: 1 1 auto;
    justify-content: center;
    white-space: nowrap;
  }

  .card.touch .actions .btn {
    height: 40px;
    font-size: var(--t-sm);
  }

  .card.touch .scope {
    height: 36px;
  }

  .btn.danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .btn.danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }

  .spin {
    flex: none;
    display: inline-flex;
    animation: rw-spin 1.1s linear infinite;
  }

  @keyframes rw-spin {
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
