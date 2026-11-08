<script lang="ts">
  import { canSaveForm, testTrigger, TEST_MAX_LINES, type TriggerForm } from "$lib/settings/model/trigger-form";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 트리거 **시험 칸** — 추가 · 편집 하위 화면(`TriggerEditor`)의 규칙 칸 아래 (docs/log/2026-10-05-trigger-examples.md).
   *
   * 붙여 넣은 출력 줄(여러 줄)에 **지금 칸의 규칙**이 어떻게 걸리는지 바로 보인다 — 계산은 `testTrigger`(순수)가 터미널과
   * 같은 엔진(`compileTriggers` · `matchLine` · `expandTemplate` · `safeUrl` · `translucent`)으로 한다. 아래 줄은 맞은
   * 구간마다 링크(실제로 열릴 주소, 못 열면 그 이유)와 툴팁(치환한 문구)을 펼쳐 보인다 — 마우스를 올려 보지 않아도 된다.
   * 여기서는 아무것도 열지 않는다(링크는 글자로만 보인다).
   */
  let { form, text = $bindable("") }: { form: TriggerForm; text?: string } = $props();

  const uid = $props.id();

  const result = $derived(testTrigger(form, text));
  /** 링크 · 툴팁이 있는 맞은 구간들 — 펼쳐 보이는 줄 (너무 길어지지 않게 앞 몇 개만) */
  const details = $derived(
    result.lines
      .flat()
      .filter((p) => p.hit && (p.hit.url !== null || p.hit.urlBlocked || p.hit.tooltip !== null))
      .slice(0, 8),
  );
  const empty = $derived(text.trim() === "");
  /** 패턴이 엔진에 들어가지 못하면 "맞은 곳 없음" 대신 "패턴을 고치면" 을 말한다 */
  const valid = $derived(canSaveForm(form));
</script>

<div class="tester" data-trigger-tester>
  <label class="tester-label" for="{uid}-text">{t("settings.triggers.test.head")}</label>
  <textarea
    id="{uid}-text"
    class="value tester-input"
    rows="3"
    aria-label={t("settings.triggers.test.aria")}
    placeholder={t("settings.triggers.test.placeholder")}
    autocomplete="off"
    spellcheck="false"
    bind:value={text}
  ></textarea>

  {#if !empty}
    <p class="tester-sum" role="status" aria-live="polite" data-hits={result.hits}>
      {#if !valid}
        {t("settings.triggers.test.invalid")}
      {:else if result.hits === 0}
        {t("settings.triggers.test.none")}
      {:else}
        {t("settings.triggers.test.count", { n: result.hits })}
      {/if}
      {#if result.truncated}
        <span class="trunc">· {t("settings.triggers.test.truncated", { max: TEST_MAX_LINES })}</span>
      {/if}
    </p>

    <div class="out" data-trigger-test-out>
      {#each result.lines as pieces, li (li)}
        <div class="out-line">
          {#each pieces as p, pi (pi)}
            {#if p.hit}
              <span
                class="hit"
                class:plain={!p.hit.fg && !p.hit.bg}
                class:link={p.hit.url !== null}
                style:color={p.hit.fg ?? undefined}
                style:background={p.hit.bg || undefined}
                title={p.hit.tooltip ?? undefined}>{p.text}</span
              >
            {:else}<span>{p.text}</span>{/if}
          {:else}<span>&nbsp;</span>{/each}
        </div>
      {/each}
    </div>

    {#if details.length > 0}
      <ul class="details">
        {#each details as d, i (i)}
          <li>
            <code class="d-hit">{d.text}</code>
            {#if d.hit?.url}
              <span class="d-kind">{t("settings.triggers.kind.link")}</span>
              <span class="d-url">{d.hit.url}</span>
            {:else if d.hit?.urlBlocked}
              <span class="d-kind">{t("settings.triggers.kind.link")}</span>
              <span class="d-blocked">{t("settings.triggers.test.blocked")}</span>
            {/if}
            {#if d.hit?.tooltip}
              <span class="d-kind">{t("settings.triggers.kind.tooltip")}</span>
              <span class="d-tip">{d.hit.tooltip}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  /* 시험 칸 — 자동 승인 시험 칸(`AutomationTester`)과 같은 필드 우물 판 */
  .tester {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .tester-label {
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--fg-2);
  }

  .tester-input {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    font-family: var(--font-mono, monospace);
  }

  .tester-sum {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .trunc {
    color: var(--fg-3);
  }

  /* 결과 — 터미널처럼 고정폭 한 줄씩, 길면 가로로 굴린다 */
  .out {
    overflow-x: auto;
    padding: var(--space-2);
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--fg-1);
    background: var(--surface-raised-solid, var(--surface));
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .out-line {
    white-space: pre;
  }

  .hit {
    border-radius: 2px;
  }

  /* 색이 없는 트리거(링크 · 툴팁만)도 어디가 맞았는지는 보이게 */
  .hit.plain {
    outline: 1px dashed var(--line-strong);
    outline-offset: -1px;
  }

  .hit.link {
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .details {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin: 0;
    padding: 0;
    list-style: none;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .details li {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px var(--space-2);
    min-width: 0;
  }

  .d-hit {
    font-family: var(--font-mono, monospace);
    color: var(--fg-1);
  }

  .d-kind {
    padding: 0 6px;
    font-size: 11px;
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  .d-url {
    min-width: 0;
    overflow-wrap: anywhere;
    font-family: var(--font-mono, monospace);
    color: var(--accent);
    user-select: text;
  }

  .d-blocked {
    color: var(--warn);
  }

  .d-tip {
    min-width: 0;
    overflow-wrap: anywhere;
    color: var(--fg-1);
    user-select: text;
  }
</style>
