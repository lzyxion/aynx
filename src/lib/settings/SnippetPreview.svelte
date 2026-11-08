<script lang="ts">
  import { previewSnippet } from "$lib/settings/model/snippet-form";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 스니펫 **미리보기** — 추가 · 편집 하위 화면(`SnippetEditor`)의 칸 아래, 트리거의 시험 칸 자리
   * (docs/log/2026-10-05-snippets-subview.md).
   *
   * 지금 명령이 넣을 때 **무엇을 묻고 무엇이 나가는가**를 바로 보인다: 물어볼 칸마다 값 칸이 기본값으로 채워진 채
   * 서고(넣을 때 열리는 묻는 화면과 같은 시작), 거기 시험 삼아 적으면 아래 줄이 터미널에 나갈 글자로 바뀐다. 계산은
   * `previewSnippet`(순수)이 삽입 경로와 같은 `placeholdersOf` · `defaultValuesOf` · `renderSnippet` 으로 한다.
   * 시험 값은 이 화면에만 산다 — 저장하지도, 아무 터미널에 보내지도 않는다.
   */
  let { command, enter }: { command: string; enter: boolean } = $props();

  const uid = $props.id();

  /** 시험 삼아 적은 값 — 칸 이름 → 값 (지운 칸은 빈 값으로 남아 기본값을 되살리지 않는다) */
  let typed = $state<Record<string, string>>({});

  const result = $derived(previewSnippet(command, typed));
  const empty = $derived(command.trim() === "");
</script>

<div class="preview" data-snippet-preview>
  <span class="pv-label" id="{uid}-head">{t("settings.snippets.preview.head")}</span>

  {#if empty}
    <p class="pv-note">{t("settings.snippets.preview.empty")}</p>
  {:else}
    {#if result.fields.length > 0}
      <p class="pv-note">{t("settings.snippets.placeholders.label")}</p>
      <div class="pv-fields" role="group" aria-labelledby="{uid}-head">
        {#each result.fields as f, i (f.name)}
          <label class="pv-field" for="{uid}-f{i}" data-placeholder={f.name}>
            <span class="pv-name">{f.name}</span>
            <input
              id="{uid}-f{i}"
              class="value"
              value={result.values[f.name] ?? ""}
              placeholder={f.default ?? ""}
              title={f.description ?? undefined}
              aria-label={t("settings.snippets.preview.value.aria", { name: f.name })}
              autocomplete="off"
              spellcheck="false"
              oninput={(e) => (typed = { ...typed, [f.name]: e.currentTarget.value })}
            />
            {#if f.description}<span class="pv-desc">{f.description}</span>{/if}
          </label>
        {/each}
      </div>
      {#if result.annotated}
        <p class="pv-note">{t("settings.snippets.placeholders.hint")}</p>
      {/if}
    {/if}

    <div class="out" data-snippet-preview-out
      >{result.text}{#if enter}<span class="enter" aria-hidden="true">⏎</span>{/if}</div>
    <p class="pv-note" data-enter={enter ? "on" : "off"}>
      {enter ? t("settings.snippets.preview.enter") : t("settings.snippets.preview.no_enter")}
    </p>
  {/if}
</div>

<style>
  /* 트리거 시험 칸(`TriggerTester`)과 같은 필드 우물 판 */
  .preview {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .pv-label {
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--fg-2);
  }

  .pv-note {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
    word-break: keep-all;
  }

  .pv-fields {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .pv-field {
    display: grid;
    grid-template-columns: 7em minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-3);
    row-gap: 2px;
  }

  .pv-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    color: var(--fg-1);
  }

  .pv-field .value {
    min-width: 0;
    font-family: var(--font-mono, monospace);
  }

  .pv-desc {
    grid-column: 2;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  /* 나갈 글자 — 터미널처럼 고정폭, 여러 줄 명령은 줄 그대로 */
  .out {
    overflow-x: auto;
    padding: var(--space-2);
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.6;
    white-space: pre;
    color: var(--fg-1);
    background: var(--surface-raised-solid, var(--surface));
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    user-select: text;
  }

  .enter {
    margin-left: var(--space-1);
    color: var(--fg-3);
  }
</style>
