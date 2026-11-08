<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { addTags, removeTagAt, splitTagText } from "$lib/tag-input";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **태그 칩 입력** — 친 글자가 칸 아래에 칩으로 쌓이고, 칩의 `×` 로 하나씩 뺀다
   * (docs/log/2026-09-20-host-form-tabs.md 의 "태그 = 칩 입력").
   *
   * 예전에는 쉼표로 구분된 **한 줄**이었다 (`prod, web`). 저장되는 값은 그때도 배열이었고
   * 쪼개는 일은 [저장]을 누르는 순간에만 일어났다 — 화면은 문자열, 파일은 배열이라 사람이
   * 친 글자가 실제로 무엇이 될지는 저장해 봐야 알았다. 이제 그 변환이 **치는 자리로**
   * 올라와, 규칙이 눈에 보이는 물건(칩)이 된다.
   *
   * 값은 언제나 `string[]` 이다 — 다듬어졌고, 비어 있지 않고, 겹치지 않는다(`tag-input.ts`).
   * 그래서 부르는 쪽은 받은 배열을 **그대로** 저장하면 된다.
   *
   * ## 칩은 칸 **아래**다
   *
   * 칸 안에 칩을 넣는 모양(메일 주소 칸)도 있지만, 여기서는 칸이 폼의 다른 칸들과 **같은
   * 상자**로 보여야 한다 — 이 줄만 높이가 들쭉날쭉하면 격자가 흔들린다. 칩은 그 아래에
   * 흐르고, 하나도 없으면 **아무것도 그리지 않는다**(빈 줄이 자리를 먹지 않게).
   *
   * ## 언제 확정되는가
   *
   * | 몸짓 | 결과 |
   * | --- | --- |
   * | `Enter` (글자 있음) | 확정 · 칸 비움 · **폼 제출로 새지 않는다** |
   * | `Enter` (빈 칸) | 아무것도 안 한다 — 다른 칸과 같이 폼의 Enter 다 |
   * | 쉼표를 치거나 붙여넣기 | `input` 한 번에 확정 — 마지막 쉼표 **앞**은 칩이 되고 뒤는 칸에 남는다 |
   * | 칸을 떠남(`focusout`) | 확정 — **[저장]을 누르러 간 손이 방금 친 태그를 잃지 않게** |
   * | 빈 칸에서 `Backspace` | 마지막 칩을 뺀다 (글자가 있으면 평소의 지우기다) |
   */
  let {
    id,
    tags = $bindable([]),
    placeholder = "",
    ariaLabel,
  }: {
    /** 글자 칸에 붙는다 — 폼의 `<label for>` 이 그대로 이 칸을 가리킨다 */
    id?: string;
    /** 태그들 — 다듬어졌고 비어 있지 않고 겹치지 않는다 */
    tags: string[];
    placeholder?: string;
    ariaLabel?: string;
  } = $props();

  /** 아직 칩이 되지 않은 글자 */
  let text = $state("");
  let inputEl = $state<HTMLInputElement | null>(null);
  let wrapEl = $state<HTMLElement | null>(null);

  /** 칸의 글자를 칩으로 — 더할 것이 없으면 칸만 비운다 */
  function commit(): void {
    const next = addTags(tags, text);
    text = "";
    if (next !== tags) tags = next;
  }

  /**
   * 글자가 들어왔다. **쉼표가 보이면 그 자리에서 확정**한다 — 사람이 `web,` 를 치든 목록을
   * 통째로 붙여 넣든 같은 한 길을 지난다(그래서 `,` 만을 위한 키 핸들러가 없다).
   * 마지막 구분자 **뒤**의 글자는 아직 치는 중이므로 칸에 남긴다.
   */
  function onInput(): void {
    const at = Math.max(text.lastIndexOf(","), text.lastIndexOf("\n"));
    if (at < 0) return;
    const head = text.slice(0, at);
    // 뒤에 남는 글자에서 **앞쪽 공백만** 턴다 — `a, b` 를 친 손은 칸에 `b` 가 남기를
    // 기대한다(그 공백은 구분자의 일부다). 태그 안쪽 공백은 그대로 산다(`web server`).
    const tail = text.slice(at + 1).replace(/^\s+/, "");
    const next = addTags(tags, head);
    text = tail;
    if (next !== tags) tags = next;
  }

  function keydown(ev: KeyboardEvent): void {
    if (ev.key === "Enter") {
      // 빈 칸의 Enter 는 이 컴포넌트의 것이 아니다 — 다른 칸과 같이 폼으로 간다.
      if (splitTagText(text).length === 0) return;
      ev.preventDefault();
      commit();
      return;
    }
    // 빈 칸에서만 — 글자가 남아 있는데 칩이 지워지면 방금 친 글자를 잃는다.
    if (ev.key === "Backspace" && text === "" && tags.length > 0) {
      ev.preventDefault();
      tags = removeTagAt(tags, tags.length - 1);
    }
  }

  function remove(i: number): void {
    tags = removeTagAt(tags, i);
    // 하나 뺀 뒤의 손은 계속 치는 손이다 (`×` 에 포커스가 남으면 다음 Tab 이 엉뚱한 데서 시작한다)
    inputEl?.focus();
  }
</script>

<!--
  칸을 떠나면 확정한다 — **[저장]을 누르러 간 손이 방금 친 태그를 잃지 않게**.
  `focusout` 은 클릭의 `mousedown` 뒤·`click` 앞에 오므로, 제출 핸들러가 읽는 `hostForm.tags`
  에는 이미 그 태그가 들어 있다. `relatedTarget` 이 이 덩어리 안이면(칩의 `×`) 떠난 것이 아니다.
-->
<div
  class="tag-field"
  bind:this={wrapEl}
  onfocusout={(ev) => {
    const to = ev.relatedTarget;
    if (to instanceof Node && wrapEl?.contains(to)) return;
    commit();
  }}
>
  <input
    {id}
    bind:value={text}
    bind:this={inputEl}
    {placeholder}
    aria-label={ariaLabel}
    autocomplete="off"
    spellcheck="false"
    oninput={onInput}
    onkeydown={keydown}
  />
  {#if tags.length > 0}
    <div class="chips">
      {#each tags as tag, i (tag)}
        <span class="chip">
          <span class="label">{tag}</span>
          <button
            type="button"
            class="x"
            aria-label={t("app.tags.remove", { tag })}
            title={t("app.tags.remove", { tag })}
            onclick={() => remove(i)}
          >
            <UiIcon name="close" size={11} />
          </button>
        </span>
      {/each}
    </div>
  {/if}
</div>

<style>
  .tag-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    min-width: 0;
  }

  /*
   * 칸은 폼의 `.fields input` 과 **같은 규칙**이다 — 스코프 CSS 는 자식 컴포넌트에 닿지
   * 않으므로(그쪽 선택자에는 그 파일의 스코프 클래스가 붙는다) 여기에 다시 적는다.
   */
  input {
    width: 100%;
    box-sizing: border-box;
    height: var(--field-height);
    padding: 0 var(--space-3);
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--fg);
    background: var(--field-bg);
    border: 1px solid transparent;
    border-radius: var(--field-radius);
    outline: none;
    box-shadow: var(--glass-ctl-edge, none);
  }

  input:hover:not(:disabled, :focus) {
    background: var(--control-bg-hover);
  }

  input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  input::placeholder {
    font-family: var(--font-ui);
    color: var(--fg-muted);
  }

  /* 칩은 흐른다 — 많아지면 줄이 늘 뿐 칸의 높이는 그대로다 */
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 4px;
    min-width: 0;
  }

  /*
   * 칩의 모양은 호스트 목록의 태그(`browser/HostList.svelte` 의 `.tag`)와 **같은 토큰**이다
   * (`--bg-chip` · `--fg-chip` · 모서리 4px) — 같은 물건이 두 화면에서 다르게 생기면 그것이
   * 같은 태그라는 사실이 흐려진다. 다른 것은 **크기**뿐이다: 저쪽은 줄 끝에 붙는 곁말(10px)
   * 이고 여기서는 손으로 지우는 물건이라 `×` 를 누를 자리가 있어야 한다.
   */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    max-width: 100%;
    height: 22px;
    padding: 2px 6px 2px 8px;
    box-sizing: border-box;
    font-family: var(--font-ui);
    font-size: 12px;
    color: var(--fg-chip);
    background: var(--bg-chip);
    border-radius: 4px;
  }

  /* 긴 태그는 말줄임으로 끊는다 — `×` 를 밀어내지 않는다 */
  .label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* `UiIcon` 은 `display:block` 이라 버튼 안에서 저절로 가운데 서지 않는다 */
  .x {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 1px;
    color: inherit;
    background: transparent;
    border: none;
    border-radius: 3px;
    opacity: 0.7;
    cursor: pointer;
  }

  .x:hover {
    opacity: 1;
    background: var(--bg-hover);
  }

  .x:focus-visible {
    outline: 1px solid var(--accent);
    outline-offset: -1px;
    opacity: 1;
  }
</style>
