<script lang="ts">
  /**
   * 대화 면 · 채팅 입력 칸 — IME 조합 중의 Enter 는 보내지 않는다(`pane/ai-flip-keys.ts` 의 `composerEnter`). 글은 이 컴포넌트의 상태에만 있다(저장 · 로그 없음).
   * `leading` 을 주면 두 줄 상자, 없으면 한 줄 알약(프로듀서 채팅)이다. `stoppable` 은 `busy` 와 달리 보내기를 막지 않는다 — TUI 는 도는 중에도 다음 말을 대기열에 받는다.
   * 타일의 대화 면은 `ondropdata` 를 주지 않는다 — 놓기는 타일 캔버스가 받아 `app/transfer` 가 칩으로 넣는다.
   */
  import { untrack, type Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { composerEnter } from "$lib/pane/ai-flip-keys";
  import { attachmentsReady, clipboardFiles, type ComposerAttachment } from "$lib/pane/composer-attachments";
  import { FS_DRAG_TYPE } from "$lib/fs-drag";

  import type { ComposerGate } from "$lib/pane/ai-flip.svelte.js";

  let {
    permission = false,
    onsend,
    onterminal,
    inField,
    leading,
    above,
    gate = null,
    busy = false,
    stoppable = false,
    oninterrupt,
    prefill = null,
    onprefilled,
    attachments = [],
    onremove,
    onattach,
    ondropdata,
    placeholder,
    enterNewline = false,
    terminalKeys = false,
    compact,
    touch = false,
    inputEl = $bindable(null),
  }: {
    permission?: boolean;
    /** 참이면 보냈다(칸을 비운다) */
    onsend: (text: string) => boolean;
    onterminal: () => void;
    inField?: Snippet;
    leading?: Snippet;
    above?: Snippet;
    /** 보내기만 막는다 — 칸에 치기는 된다 */
    gate?: ComposerGate | null;
    busy?: boolean;
    stoppable?: boolean;
    oninterrupt?: () => void;
    /** 번호가 바뀔 때마다 한 번 채우기만 한다(보내지 않는다) */
    prefill?: { text: string; n: number } | null;
    onprefilled?: (n: number) => void;
    placeholder?: string;
    attachments?: readonly ComposerAttachment[];
    onremove?: (id: number) => void;
    onattach?: (files: File[]) => void;
    /** 없으면 놓기를 받지 않는다 */
    ondropdata?: (dt: DataTransfer) => void;
    /** 폰: Enter 는 줄바꿈 — 화면 키보드의 Enter 자리도 줄바꿈 모양이어야 한다("보내기" 로 그려 놓고 줄을 바꾸면 거짓말이 된다) */
    enterNewline?: boolean;
    /** 전역 단축키가 이 칸에서도 먹는다(`keybindings` 의 `isTerminalKeysInput`) */
    terminalKeys?: boolean;
    compact?: boolean;
    /** 두 줄 상자의 아래 줄 여백을 키운다 — 넓힌 누르는 자리가 글 줄을 덮지 않게 */
    touch?: boolean;
    inputEl?: HTMLTextAreaElement | null;
  } = $props();

  let text = $state("");
  const twoRow = $derived(!!leading);
  /** 한 줄 알약에서 글이 단추 밑으로 가지 않게 */
  let inFieldW = $state(0);
  const MAX_ROWS = 6;
  /** 바뀌면 접힌 줄 수가 달라져 다시 잰다 */
  let fieldW = $state(0);

  /**
   * 높이 style 만 바꾼다 — IME 조합 중에도 글은 건드리지 않는다.
   * 재는 동안 상자 높이를 잠가 둘레의 스크롤(기록)이 끌려가지 않게 하고, 칸 자신의 스크롤 위치는 되돌린다.
   */
  function fit(el: HTMLTextAreaElement): void {
    if (el.clientWidth === 0) return; // 숨은 칸 — 보일 때 폭이 바뀌어 다시 잰다
    const box = el.parentElement;
    const cs = getComputedStyle(el);
    const max = parseFloat(cs.lineHeight) * MAX_ROWS + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    const top = el.scrollTop;
    if (box) box.style.height = `${box.offsetHeight}px`;
    // 스크롤바 없는 폭으로 잰다 — 스크롤바가 생겨 좁아진 폭으로 재면 상한 언저리에서 생겼다 사라졌다 할 수 있다
    el.style.overflowY = "hidden";
    el.style.height = "auto";
    const h = el.scrollHeight;
    el.style.height = `${Math.min(h, max)}px`;
    el.style.overflowY = h > max ? "auto" : "hidden";
    if (box) box.style.height = "";
    el.scrollTop = top;
  }

  $effect(() => {
    void text;
    void fieldW;
    const el = inputEl;
    if (el) fit(el);
  });

  let prefilled = 0;
  $effect(() => {
    const p = prefill;
    if (!p || p.n === prefilled) return;
    prefilled = p.n;
    text = untrack(() => text).trim() === "" ? p.text : `${untrack(() => text).replace(/\s+$/, "")}\n\n${p.text}`;
    onprefilled?.(p.n);
    requestAnimationFrame(() => {
      const el = inputEl;
      if (!el) return;
      el.focus({ preventScroll: true });
      el.setSelectionRange(el.value.length, el.value.length);
      el.scrollTop = el.scrollHeight;
    });
  });

  const canSend = $derived((text.trim() !== "" || attachments.length > 0) && attachmentsReady(attachments));
  const stopInPlace = $derived(busy || (stoppable && text.trim() === "" && attachments.length === 0));

  function submit(): void {
    if (!canSend || gate || busy) return;
    if (onsend(text)) text = "";
  }

  function onPaste(ev: ClipboardEvent): void {
    if (!onattach) return;
    const files = clipboardFiles(ev.clipboardData);
    if (files.length === 0) return;
    ev.preventDefault();
    onattach(files);
  }

  const takesDrag = (ev: DragEvent) => {
    const types = ev.dataTransfer?.types;
    return !!ondropdata && !!types && (types.includes("Files") || types.includes(FS_DRAG_TYPE));
  };
  let dragOver = $state(false);

  function onDragOver(ev: DragEvent): void {
    if (!takesDrag(ev)) return;
    ev.preventDefault();
    if (ev.dataTransfer) ev.dataTransfer.dropEffect = "copy";
    dragOver = true;
  }

  function onDragLeave(ev: DragEvent): void {
    const to = ev.relatedTarget;
    if (to instanceof Node && (ev.currentTarget as Node).contains(to)) return;
    dragOver = false;
  }

  function onDrop(ev: DragEvent): void {
    dragOver = false;
    if (!takesDrag(ev) || !ev.dataTransfer) return;
    ev.preventDefault();
    ev.stopPropagation();
    ondropdata?.(ev.dataTransfer);
    inputEl?.focus({ preventScroll: true });
  }

  const INTERACTIVE = 'button, a, input, textarea, select, label, [role="button"], [tabindex], [contenteditable]';

  /** 두 줄 상자의 빈 자리를 누르면 글 칸으로 — `mousedown` 에서 막아 이미 칸에 있던 커서 · 선택이 그대로 남는다 */
  function onWrapMousedown(ev: MouseEvent): void {
    if (!twoRow || ev.button !== 0) return;
    const target = ev.target;
    const wrap = ev.currentTarget as HTMLElement;
    if (!(target instanceof Element)) return;
    // 판정은 상자 안으로만 — 상자 밖 조상(채팅 독 · 타일 뿌리의 `tabindex="-1"`)에 걸리면 빈 자리를 놓친다
    const hit = target.closest(INTERACTIVE);
    if (hit && hit !== wrap && wrap.contains(hit)) return;
    ev.preventDefault();
    inputEl?.focus({ preventScroll: true });
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (enterNewline) {
      // IME 조합 중의 Enter 는 칸의 것 — `composerEnter` 에 수식 키를 떼고 묻는다
      const mod = ev.ctrlKey || ev.metaKey;
      if (!mod || ev.altKey || ev.shiftKey) return;
      if (composerEnter({ key: ev.key, code: ev.code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, isComposing: ev.isComposing, keyCode: ev.keyCode }) !== "send") return;
      ev.preventDefault();
      submit();
      return;
    }
    const what = composerEnter(ev);
    if (what !== "send") return;
    ev.preventDefault();
    submit();
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="composer"
  class:compact={compact ?? (!!inField || !!leading || !!above)}
  class:drag-over={dragOver}
  data-flip-composer
  ondragover={onDragOver}
  ondragleave={onDragLeave}
  ondrop={onDrop}
>
  {#if permission}
    <button type="button" class="answer btn btn-secondary btn-sm" data-flip-answer onclick={onterminal}
      >{t("pane.flip.answerInTerminal")}</button
    >
  {:else}
    {#if gate && !gate.card && !gate.quiet}
      <div class="gate-line" role="status" data-flip-gate="line">{gate.text}</div>
    {:else if gate && !gate.quiet}
      <div class="gate-card" role="status" data-flip-gate="card">
        <div class="gate-text">{gate.text}</div>
        {#if gate.terminal}
          <button type="button" class="btn btn-secondary btn-sm" data-flip-gate-terminal onclick={onterminal}
            >{t("pane.flip.gate.toTerminal")}</button
          >
        {/if}
        {#if gate.action}
          <button type="button" class="btn btn-primary btn-sm" data-flip-gate-action onclick={gate.action.run}>{gate.action.label}</button>
        {/if}
        {#if gate.tip}<div class="gate-tip">{gate.tip}</div>{/if}
      </div>
    {/if}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="wrap" class:two={twoRow} class:blocked={gate?.quiet === true} onmousedown={onWrapMousedown}>
      {#if above}
        <div class="above" data-flip-above>{@render above()}</div>
      {/if}
      {#if attachments.length > 0}
        <ul class="atts" aria-label={t("pane.flip.composer.attachments")} data-flip-attachments>
          {#each attachments as a (a.id)}
            <li
              class="att"
              class:staging={a.path === null}
              title={a.path === null ? t("pane.flip.composer.attaching") : a.name}
              data-flip-attachment
            >
              {#if a.url}
                <img class="thumb" src={a.url} alt="" />
              {:else}
                <span class="thumb icon" aria-hidden="true"><UiIcon name="file" size={14} /></span>
              {/if}
              <span class="att-name">{a.name}</span>
              {#if onremove}
                <button
                  type="button"
                  class="att-x"
                  data-flip-attachment-remove
                  title={t("pane.flip.composer.attachRemove", { name: a.name })}
                  aria-label={t("pane.flip.composer.attachRemove", { name: a.name })}
                  onclick={() => {
                    onremove(a.id);
                    inputEl?.focus({ preventScroll: true });
                  }}><UiIcon name="close" size={12} /></button
                >
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
      <textarea
        class="field"
        bind:this={inputEl}
        bind:value={text}
        bind:clientWidth={fieldW}
        rows="1"
        placeholder={gate?.quiet ? gate.text : (placeholder ?? t("pane.flip.composer.placeholder"))}
        readonly={gate?.quiet === true}
        aria-label={t("pane.flip.composer.aria")}
        spellcheck="false"
        autocomplete="off"
        enterkeyhint={enterNewline ? "enter" : "send"}
        data-flip-input
        data-terminal-keys={terminalKeys ? "" : undefined}
        onkeydown={onKeydown}
        onpaste={onPaste}
        style:padding-right={!twoRow && inField && inFieldW > 0 ? `${46 + inFieldW + 4}px` : undefined}
      ></textarea>
      {#if leading}
        <div class="row" class:touch>
          <div class="leading" data-flip-leading>{@render leading()}</div>
          {#if inField}
            <div class="in-field" data-flip-in-field>{@render inField()}</div>
          {/if}
          {@render sendButton()}
        </div>
      {:else}
        {#if inField}
          <div class="in-field" bind:clientWidth={inFieldW} data-flip-in-field>{@render inField()}</div>
        {/if}
        {@render sendButton()}
      {/if}
    </div>
  {/if}
</div>

{#snippet sendButton()}
  {#if stopInPlace && oninterrupt}
    <button
      type="button"
      class="send stop"
      data-flip-interrupt
      title={t(busy ? "pane.flip.composer.interrupt" : "pane.flip.composer.stop")}
      aria-label={t(busy ? "pane.flip.composer.interrupt" : "pane.flip.composer.stop")}
      onclick={() => {
        oninterrupt();
        inputEl?.focus({ preventScroll: true });
      }}><span class="stop-mark" aria-hidden="true"></span></button
    >
  {:else}
    <button
      type="button"
      class="send"
      data-flip-send
      disabled={!canSend || !!gate}
      title={t("pane.flip.composer.send")}
      aria-label={t("pane.flip.composer.send")}
      onclick={() => {
        submit();
        inputEl?.focus({ preventScroll: true });
      }}><UiIcon name="up" size={16} /></button
    >
  {/if}
{/snippet}

<style>
  /* 기록과 같은 가운데 한 단(760) */
  .composer {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(760px + 2 * var(--space-5));
    margin: 0 auto;
    padding: var(--space-2) var(--space-5) var(--space-4);
  }

  .wrap {
    position: relative;
    box-sizing: border-box;
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    border-radius: 22px;
  }

  .wrap.two {
    border-radius: 20px;
  }

  .wrap.blocked {
    border-style: dashed;
  }

  .wrap:focus-within {
    border-color: var(--focus-ring);
  }

  .composer.drag-over .wrap {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
  }

  .atts {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    margin: 0;
    padding: var(--space-2) var(--space-3) 0;
    list-style: none;
  }

  .att {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    max-width: 200px;
    padding: 2px;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: var(--control-ghost-hover);
    border: 1px solid var(--line);
    border-radius: 8px;
  }

  .att.staging {
    opacity: 0.55;
  }

  .thumb {
    flex: 0 0 auto;
    width: 28px;
    height: 28px;
    object-fit: cover;
    border-radius: 6px;
  }

  .thumb.icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-2);
    background: var(--surface-raised-solid);
  }

  .att-name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .att-x {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .att-x:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  /* 오른쪽 여백 = 보내기 원(32) + 둘레(6) + 숨 쉴 틈(8) — 글이 단추 밑으로 가지 않는다 */
  .field {
    display: block;
    box-sizing: border-box;
    width: 100%;
    min-height: 42px;
    padding: 10px 46px 10px var(--space-4);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    line-height: 20px;
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: 22px;
    resize: none;
    outline: none;
    overflow-y: hidden;
  }

  /*
   * 빈 칸 = 위 여백 11 + 20 + 2 = 33 · 아래 줄 41 · 테두리 2 → 76px.
   * 위 11px 는 패딩이 아니라 margin — 패딩이면 스크롤 영역 안이라 스크롤한 글이 상자 위 테두리 바로 밑까지 보인다.
   */
  .wrap.two .field {
    min-height: 22px;
    margin-top: 11px;
    padding: 0 14px 2px;
    border-radius: 0;
  }

  /* 자리가 모자라면 모델 키워드만 줄어든다 */
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 5px 5px;
  }

  /* 넓힌 누르는 자리(`::after` 6~7px)가 글 줄을 덮지 않게 */
  .row.touch {
    padding: 6px;
  }

  .row .leading {
    flex: none;
    height: 32px;
    display: flex;
    align-items: center;
    margin-right: auto;
  }

  .row .in-field {
    flex: 0 1 auto;
    min-width: 0;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: var(--space-1);
  }

  .row .send {
    position: static;
    flex: none;
  }

  .composer.compact {
    padding: var(--space-2) var(--space-3) var(--space-3);
  }

  /* 좁은 칸에서 둘째 줄이 반쯤 잘려 보이지 않게 */
  .field::placeholder {
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .answer {
    width: 100%;
    justify-content: center;
  }

  .gate-line {
    margin-bottom: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .gate-card {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: var(--space-2);
    margin-bottom: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
  }

  .gate-card .btn {
    justify-content: center;
  }

  .gate-tip {
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  .wrap:not(.two) .in-field {
    position: absolute;
    right: 43px;
    bottom: 5px;
    height: 32px;
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  .in-field:empty {
    display: none;
  }

  .above {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-width: 0;
    padding: 6px var(--space-2) 0;
  }

  /* 둘레 5px = (알약 안 높이 42 − 원 32) / 2 — 여러 줄이면 마지막 글 줄과 같은 높이 */
  .send {
    position: absolute;
    right: 5px;
    bottom: 5px;
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--on-accent, #fff);
    background: var(--accent);
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .send:disabled {
    color: var(--fg-3);
    background: var(--control-ghost-hover);
    cursor: default;
  }

  .send.stop {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
    border: 1px solid var(--line-strong);
  }

  .stop-mark {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    background: currentColor;
  }

  .send:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
</style>
