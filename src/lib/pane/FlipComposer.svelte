<script lang="ts">
  /**
   * **대화 면 입력 칸**(2026-10-17 — `pane/AiFlip` 의 아래 줄). 여러 줄 칸이고 Enter = 보내기 · Shift+Enter = 줄바꿈 · **IME 조합
   * 중의 Enter 는 보내지 않는다**(조합을 끝내는 Enter — 판정은 순수 층 `pane/ai-flip-keys.ts` 의 `composerEnter`).
   *
   * 보내기는 부르는 쪽(`onsend`)이 그 타일 터미널의 사람 입력 문으로 한다(`TermActions.submitText` — 새 쓰기 길 없음). 보냈으면 칸을
   * 비운다. 대화 면의 **키보드 집**이 이 칸이다 — 편집 요소라 한글 IME 가 첫 글자부터 켜져 있다(넘길 때 `AiFlip` 이 포커스를 준다).
   *
   * 에이전트가 **권한을 묻는 중**이면(`permission`) 칸 대신 "터미널에서 답하기 →" 한 줄 — 답은 터미널의 CLI 화면에서 한다.
   * 글은 이 컴포넌트의 상태에만 있다(저장 · 로그 없음).
   *
   * 모양은 **`leading` 유무로 두 갈래**다(2026-11-20 — 두 줄 상자 목업 · 사용자 결정 — 기본 380px 독에서
   * 글 쓸 자리가 독 폭의 1/3 남짓이던 한 줄 알약을 사이드 채팅 · AI 타일 대화 면에서 걷었다):
   * - **두 줄 상자**(`leading` 을 준 칸 — 사이드 채팅 `SideChatFace` · AI 타일 대화 면 `AiFlip`): 반지름 20px 둥근 상자(한 줄이든 여러 줄이든
   *   같음) 안에 위에서부터 `above`(연결 칩 줄) · 첨부 칩 줄 · **글 줄(상자 폭 전부)** · **아래 줄**(흐름 안의 flex 줄 —
   *   `[+]`(`leading`) … (빈 자리) … `inField`(모델 키워드) · 보내기 원). 빈 칸이면 약 76px. 자리가 모자라면 `inField` 가 줄어든다(모델
   *   이름이 줄임표 — `min-width: 0` 사슬) · `[+]` · 보내기는 줄지 않는다. 폰(`touch`)은 아래 줄 여백만 6px 로 키운다(넓힌 누르는 자리가 글
   *   줄을 덮지 않게). 상자 안 **빈 자리**(글 줄 위 여백 · 아래 줄 단추 사이)를 누르면 글 칸에 포커스(2026-11-20 실기 — 위 여백이 칸 밖이라
   *   눌러도 안 들어갔다 · 단추 · 칩 등 상호작용 요소 안은 빼고 · `mousedown` 에서 막아 커서 · 선택은 그대로).
   * - **한 줄 알약**(`leading` 이 없는 칸 — 프로듀서 채팅 · 2026-10-23 그대로): 한 줄 44px · 반지름 22px(여러 줄로 자라면 같은 반지름의
   *   둥근 상자), 칸 안 오른쪽 아래에 둥근 보내기 원(마지막 글 줄과 같은 높이). `inField`(프로듀서 채팅의 [끊고 전달] — 10-30 실기)는 칸 안
   *   보내기 원 왼쪽에 서고 글은 그 폭만큼 오른쪽을 비운다(재어서).
   * 보내기 원은 두 모양 모두 Enter 와 같은 `submit` → `onsend` 길. 칸 아래(상자 밖) 줄은 없다(2026-11-13 — 목업 D안). `above` 는 상자 안 글 줄 위
   * (첨부 칩 줄 앞)에 한 줄. `inField` · `leading` · `above` 중 하나라도 있으면 좁은 독 여백(`compact` — 부른 쪽이 정하면 그 값 · AI 타일
   * 대화 면은 `compact={false}` 로 760 단 여백)을 쓴다. 옛 크기 질의 상자(`container: composer` — 좁은 알약에서 모델 이름 · 막대 감추기)는
   * 두 줄이 되며 걷었다.
   *
   * **자라기**(두 모양 공통 · 2026-11-20): 칸은 **접힌 줄까지** 내용 높이만큼 자라고(`fit` — 높이를 `auto` 로 풀어 `scrollHeight` 를 재고
   * `MAX_ROWS` 줄에서 자른다) 넘으면 글 칸 안에서만 스크롤한다(그 전에는 스크롤바 없음). 글이 바뀔 때(치기 · `prefill` · 보낸 뒤 비우기)와
   * 칸 폭이 바뀔 때(독 폭 끌기 · 타일 크기 — `bind:clientWidth`) 다시 잰다. 재는 동안 상자 높이를 잠가 둘레(기록 스크롤)가 흔들리지 않게 하고
   * 칸의 스크롤 위치는 되돌린다. 높이 style 만 바꾸니 IME 조합 중에도 글은 건드리지 않는다.
   *
   * `gate` 를 주면(채팅 독 — 2026-10-23) **보내기만 막는다**(Enter · 단추 — 칸에 치기는 된다): 칸 위에 한 줄(CLI 시작 중) 또는 카드(시작 묻기 ·
   * CLI 나감 — 문구 · 단추 · 안내 한 줄). 막는 까닭은 부르는 쪽이 정한다.
   *
   * `busy` 를 주면(사이드 채팅 v2 — 턴이 도는 동안) 보내기 단추 자리가 **[중단]**(`oninterrupt` — 같은 원 · 안에 네모)이 되고 Enter 는
   * 보내지 않는다(치기는 된다 — 턴이 끝나면 그 글을 보낸다).
   *
   * `stoppable` 을 주면(AI 타일 대화 면 — 2026-11-02 · 에이전트가 일하는 중) 칸이 비었을 때 보내기 원이 **같은 자리의 [중지]**(`oninterrupt`)가
   * 된다(사이드 채팅 [중단]과 같은 모양). 칸에 글 · 첨부가 있으면 보내기로 돌아온다 — `busy` 와 달리 보내기는 막지 않는다(TUI 는 도는 중에도
   * 다음 말을 대기열에 받아 둔다).
   *
   * `prefill` 을 주면(사이드 채팅 5단계 — [AI에게 묻기] → 사이드 채팅) 번호가 바뀔 때마다 그 글을 칸에 **채우기만** 한다(보내지 않는다 —
   * 칸이 비었으면 그 글, 아니면 빈 줄 하나 뒤에 덧붙임) · 커서를 끝으로 · `onprefilled(n)` 로 알린다.
   *
   * **첨부 칩**(2026-10-24): `attachments` 를 주면 칸 안 글 줄 위에 칩 줄(작은 미리보기 — 그림이면 `blob:` · 아니면 파일 아이콘 + 이름
   * + ×(`onremove`)). 칩이 있으면 글이 비어도 보낸다 · 준비 중인 칩(경로 없음)이 있으면 막는다 · 비우기는 부르는 쪽(보낸 뒤). 칸의
   * **파일 붙여넣기**(클립보드에 글 없이 그림 · 파일만 — `clipboardFiles`)는 `onattach` 로(글 붙여넣기는 그대로). `ondropdata` 를 주면
   * (사이드 채팅 — 타일 캔버스 밖이다) 이 상자가 OS 파일 · 파일 타일 짐의 끌어 놓기를 받아 그대로 넘긴다. 타일의 대화 면은 주지 않는다
   * (놓기는 타일 캔버스가 받아 `app/transfer` 가 칩으로 넣는다).
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
    /** 에이전트가 권한을 묻는 중 */
    permission?: boolean;
    /** 보낸다 — 참이면 보냈다(칸을 비운다) */
    onsend: (text: string) => boolean;
    /** 터미널 면으로 */
    onterminal: () => void;
    /** 칸 안 보내기 왼쪽의 단추(프로듀서 채팅의 [끊고 전달] · 사이드 채팅 · AI 타일의 모델 키워드) — 없으면 자리도 없다 */
    inField?: Snippet;
    /** 아래 줄 왼쪽 끝의 단추(사이드 채팅 · AI 타일의 `[+]`) — 주면 두 줄 상자, 없으면 한 줄 알약 */
    leading?: Snippet;
    /** 칸 안 글 줄 위 한 줄(사이드 채팅의 연결 칩) */
    above?: Snippet;
    /** 보내기를 막는 사정(채팅 독) — 있으면 Enter · 보내기 단추가 아무것도 보내지 않는다 */
    gate?: ComposerGate | null;
    /** 턴이 돈다(사이드 채팅 v2) — 보내기 대신 [중단] */
    busy?: boolean;
    /** 보내기 옆 [중지](AI 타일 대화 면 — 보내기는 그대로) */
    stoppable?: boolean;
    /** [중단] · [중지] */
    oninterrupt?: () => void;
    /** 칸에 채울 글(사이드 채팅 — 번호가 바뀔 때마다 한 번) */
    prefill?: { text: string; n: number } | null;
    /** 채웠다 */
    onprefilled?: (n: number) => void;
    /** 칸의 자리표시 글(없으면 "메시지 보내기" — 프로듀서 채팅은 "프로듀서에게 말하기…") */
    placeholder?: string;
    /** 첨부 칩(칸 위 줄) */
    attachments?: readonly ComposerAttachment[];
    /** 칩의 × */
    onremove?: (id: number) => void;
    /** 칸에 그림을 붙여 넣었다 */
    onattach?: (files: File[]) => void;
    /** 이 상자에 파일을 놓았다(사이드 채팅) — 없으면 놓기를 받지 않는다 */
    ondropdata?: (dt: DataTransfer) => void;
    /**
     * 폰(화면 키보드 — 원격 폰 덮개 · 2026-11-01): Enter 는 줄바꿈이고 보내기는 단추(붙인 키보드는 Ctrl · ⌘ + Enter). 화면 키보드의
     * Enter 자리도 줄바꿈 모양(`enterkeyhint="enter"`)이다 — "보내기" 로 그려 놓고 줄을 바꾸면 거짓말이 된다.
     */
    enterNewline?: boolean;
    /**
     * 단축키에서는 터미널처럼(AI 타일 대화 면 — 2026-11-02 · `keybindings` 의 `isTerminalKeysInput`): 전역 단축키(새 탭 · 탭 전환 · 나누기 · 팔레트 …)가
     * 이 칸에서도 먹는다. 글 편집 키는 그대로 칸의 것. 사이드 채팅 · 프로듀서 채팅은 주지 않는다.
     */
    terminalKeys?: boolean;
    /** 좁은 독 여백 — 없으면 칸 안 단추가 있을 때(독). AI 타일 대화 면은 단추가 있어도 거짓(760 단 여백) */
    compact?: boolean;
    /** 폰(터치) — 두 줄 상자의 아래 줄 여백을 키운다(부른 쪽 단추의 넓힌 누르는 자리가 글 줄을 덮지 않게) */
    touch?: boolean;
    inputEl?: HTMLTextAreaElement | null;
  } = $props();

  let text = $state("");
  /** 두 줄 상자(`leading` 을 준 칸) — 아니면 한 줄 알약 */
  const twoRow = $derived(!!leading);
  /** 한 줄 알약 안 단추 자리의 폭(`inField` — 글이 그 밑으로 가지 않게) */
  let inFieldW = $state(0);
  /** 칸 높이 상한(줄) — 넘으면 칸 안에서 스크롤 */
  const MAX_ROWS = 6;
  /** 글 칸의 폭 — 바뀌면(독 폭 · 타일 크기) 접힌 줄 수가 달라져 다시 잰다 */
  let fieldW = $state(0);

  /**
   * 칸 높이를 내용에 맞춘다(접힌 줄 포함 · 최대 `MAX_ROWS` 줄 — 넘으면 칸 안 스크롤). 높이 style 만 바꾼다(글 · 커서는 그대로).
   * 재는 동안 상자 높이를 잠가 둘레의 스크롤(기록)이 잠깐 줄었다 는 높이에 끌려가지 않게 하고, 칸 자신의 스크롤 위치는 되돌린다.
   */
  function fit(el: HTMLTextAreaElement): void {
    if (el.clientWidth === 0) return; // 숨은 칸(권한 카드가 선 동안 등) — 보일 때 폭이 바뀌어 다시 잰다
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

  /** 보낼 것이 있다(글 또는 칩) · 칩이 모두 준비됐다 */
  const canSend = $derived((text.trim() !== "" || attachments.length > 0) && attachmentsReady(attachments));
  /** 보내기 자리가 [중단] · [중지]인가 — 사이드 채팅의 턴(`busy`)이거나, AI 타일 에이전트가 일하는데 칸이 비었다(`stoppable` · 보낼 것 없음) */
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

  /** 우리가 받는 끌기인가 — OS 파일 · 파일 타일 짐 */
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

  /** 상호작용 요소(와 그 안) — 두 줄 상자의 빈 자리 누르기에서 뺀다 */
  const INTERACTIVE = 'button, a, input, textarea, select, label, [role="button"], [tabindex], [contenteditable]';

  /**
   * 두 줄 상자의 빈 자리(글 줄 위 여백 · 아래 줄 단추 사이 등)를 누르면 글 칸으로. `mousedown` 에서 기본 동작을 막아 다른 곳의 포커스를
   * 빼앗기거나 글 고르기가 시작되지 않게 한다 — 이미 칸에 있었으면 커서 · 선택이 그대로 남는다.
   */
  function onWrapMousedown(ev: MouseEvent): void {
    if (!twoRow || ev.button !== 0) return;
    const target = ev.target;
    const wrap = ev.currentTarget as HTMLElement;
    if (!(target instanceof Element)) return;
    // 판정은 상자 안으로만 — 상자 밖 조상(채팅 독 뿌리 · 타일 뿌리의 `tabindex="-1"`)에 걸리면 빈 자리를 놓친다(2026-11-20 실기). 상자 자신도 빈 자리
    const hit = target.closest(INTERACTIVE);
    if (hit && hit !== wrap && wrap.contains(hit)) return;
    ev.preventDefault();
    inputEl?.focus({ preventScroll: true });
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (enterNewline) {
      // IME 조합 중의 Enter 는 칸의 것(`composerEnter` 가 거른다 — 수식 키를 떼고 묻는다)
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
    <!-- 빈 자리 누르기 = 글 칸 포커스(두 줄 상자 · 마우스 편의뿐 — 키보드는 Tab 으로 칸에 간다) -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="wrap" class:two={twoRow} class:blocked={gate?.quiet === true} onmousedown={onWrapMousedown}>
      {#if above}
        <div class="above" data-flip-above>{@render above()}</div>
      {/if}
      {#if attachments.length > 0}
        <!-- 첨부 칩 — 알약 안 글 줄 위(미리보기 · 이름 · ×) -->
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
        <!-- 두 줄 상자의 아래 줄 — [+] … 모델 키워드 · 보내기 -->
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
  <!-- 보내기(Enter 와 같은 길) · 턴이 돌면 같은 원의 [중단](AI 타일은 칸이 빌 때 [중지] = Esc 하나) — 알약은 칸 안 오른쪽 아래, 두 줄 상자는 아래 줄 끝 -->
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
  /* 아래 줄 — 기록과 같은 가운데 한 단(760) */
  .composer {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 100%;
    max-width: calc(760px + 2 * var(--space-5));
    margin: 0 auto;
    padding: var(--space-2) var(--space-5) var(--space-4);
  }

  /* 알약 · 두 줄 상자 — 글 칸 · 칩 줄(· 아래 줄)을 함께 두른다(테두리 · 면은 여기 · 글 칸은 투명) */
  .wrap {
    position: relative;
    box-sizing: border-box;
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    border-radius: 22px;
  }

  /* 두 줄 상자 — 한 줄이든 여러 줄이든 같은 반지름 */
  .wrap.two {
    border-radius: 20px;
  }

  /* 칸 자체가 막혔다(`gate.quiet`) — 점선 */
  .wrap.blocked {
    border-style: dashed;
  }

  .wrap:focus-within {
    border-color: var(--focus-ring);
  }

  /* 사이드 채팅 — 파일을 끌고 올라온 동안 */
  .composer.drag-over .wrap {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 35%, transparent);
  }

  /* 첨부 칩 줄 — 알약 안 위쪽(둥근 끝 안으로 들인다) */
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

  /*
   * 알약 — 한 줄(44px)에서 시작해 내용 줄 수(접힌 줄 포함)만큼 자라고(최대 `MAX_ROWS` — `fit`) 그 뒤는 칸 안 스크롤. 한 줄이면 반지름
   * 22px 로 양끝이 반원, 여러 줄로 자라면 같은 반지름의 둥근 상자(MD3 · End-4 의 큰 둥근 모양).
   * 오른쪽 여백 = 보내기 원(32) + 둘레(6) + 숨 쉴 틈(8) — 글이 단추 밑으로 가지 않는다.
   */
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
   * 두 줄 상자의 글 줄 — 상자 폭 전부(단추는 아래 줄). 빈 칸 = 위 여백 11 + 20 + 2 = 33 · 아래 줄 41 · 테두리 2 → 76px.
   * 위 11px 는 칸의 패딩이 아니라 바깥 여백(margin) — 패딩이면 스크롤 영역 안이라 6줄을 넘겨 스크롤한 글이 상자 위 테두리 바로 밑까지 보였다.
   */
  .wrap.two .field {
    min-height: 22px;
    margin-top: 11px;
    padding: 0 14px 2px;
    border-radius: 0;
  }

  /* 두 줄 상자의 아래 줄 — 흐름 안의 flex 줄: [+] … (빈 자리) … 모델 키워드 · 보내기. 자리가 모자라면 키워드만 줄어든다(이름 줄임표) */
  .row {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    padding: 4px 5px 5px;
  }

  /* 폰 — 넓힌 누르는 자리(`::after` 6~7px)가 글 줄을 덮지 않게 */
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

  /* 칸 안 단추가 있는 모양(채팅 독 · 프로듀서 채팅) — 좁은 독이라 양옆 여백을 줄인다 */
  .composer.compact {
    padding: var(--space-2) var(--space-3) var(--space-3);
  }

  /* 자리표시 글은 한 줄 — 좁은 칸에서 둘째 줄이 반쯤 잘려 보이지 않게 줄임표(실기 b 24-real-620) */
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

  /* 보내기를 막는 사정 — 한 줄(시작 중)은 흐린 글, 카드(시작 묻기 · CLI 나감)는 칸 위의 얇은 판 */
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

  /* 알약 안 보내기 원 왼쪽의 단추 자리 — 원(32px)과 같은 높이 · 같은 바닥(여러 줄이면 마지막 글 줄 높이) */
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

  /* 글 줄 위 한 줄(연결 칩) — 첨부 칩 줄과 같은 들임. 첨부 줄이 뒤따르면 그 줄의 위 여백이 사이를 띄운다 */
  .above {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-1);
    min-width: 0;
    padding: 6px var(--space-2) 0;
  }

  /*
   * 보내기 — 알약 칸 안 오른쪽 아래. 둘레 5px = (알약 안 높이 42 − 원 32) / 2 → 한 줄이면 가운데, 여러 줄이면 마지막 글 줄과 같은 높이
   * (글 줄 가운데 = 아래 여백 10 + 줄 높이 20 / 2 = 20px ≈ 원 가운데 21px · 알약 테두리 1px 안쪽 기준).
   */
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

  /* [중단] — 같은 자리 · 같은 원, 안에 네모 하나 */
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
