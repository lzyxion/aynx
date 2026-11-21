<script lang="ts">
  /**
   * `{@html}` 예외가 아니다 — HTML 을 넣지 않고 `blob:` 주소를 `<img>` 의 `src` 에만 준다(스크립트 · 바깥 자원이 돌지 않는다).
   * CSP `img-src` 의 `blob:` 덕에 산다.
   */
  import CodeView from "$lib/CodeView.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { SVG_MAX_BYTES, svgPlan } from "$lib/svg-text";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    code,
    onmenu,
  }: {
    code: string;
    /** 받는 쪽이 `preventDefault` 한다 */
    onmenu?: (ev: MouseEvent, code: string, el: HTMLImageElement) => void;
  } = $props();

  const plan = $derived(svgPlan(code));
  let url = $state<string | null>(null);
  let broken = $state(false);
  let source = $state(false);

  $effect(() => {
    const text = code;
    broken = false;
    if (plan !== "draw") {
      url = null;
      return;
    }
    const u = URL.createObjectURL(new Blob([text], { type: "image/svg+xml" }));
    url = u;
    return () => URL.revokeObjectURL(u);
  });

  const drawn = $derived(url !== null && !broken);
</script>

<div class="root">
  {#if drawn && !source}
    <div class="sw">
      <div class="svg" data-svg-view>
        <img
          src={url}
          alt={t("files.doc.md.svg.alt")}
          onerror={() => (broken = true)}
          oncontextmenu={(ev) => onmenu?.(ev, code, ev.currentTarget)}
        />
      </div>
      <div class="tools">
        <button
          type="button"
          class="btn btn-ghost btn-sm tb"
          title={t("files.doc.md.svg.source")}
          aria-label={t("files.doc.md.svg.source")}
          onclick={() => (source = true)}><UiIcon name="view-source" size={13} /></button
        >
      </div>
    </div>
  {:else}
    {#if plan === "large"}
      <div class="err">{t("files.doc.md.svg.toolarge", { limit: `${SVG_MAX_BYTES / 1024} KB` })}</div>
    {:else if broken}
      <div class="err">{t("files.doc.md.svg.fail")}</div>
    {/if}
    <div class="sw" data-svg-source>
      <CodeView {code} lang="xml" framed />
      {#if drawn}
        <div class="tools back">
          <button
            type="button"
            class="btn btn-ghost btn-sm tb"
            title={t("files.doc.md.svg.picture")}
            aria-label={t("files.doc.md.svg.picture")}
            onclick={() => (source = false)}><UiIcon name="view-rendered" size={13} /></button
          >
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .root {
    min-width: 0;
  }

  .sw {
    position: relative;
    min-width: 0;
  }

  .svg {
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    padding: var(--space-3);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    line-height: 0;
  }

  .svg img {
    display: block;
    max-width: 100%;
    height: auto;
    margin: 0 auto;
  }

  .tools {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  /* 오른쪽 위는 `CodeView` 의 [복사] 자리 */
  .tools.back {
    right: 30px;
  }

  .sw:hover .tools,
  .sw:focus-within .tools {
    opacity: 1;
  }

  .tb {
    width: 24px;
    padding: 0;
    background: var(--surface-field-solid);
    border-color: var(--line);
  }

  .tb:hover {
    color: var(--fg-1);
    background: var(--surface-field-solid);
    border-color: var(--line-strong);
  }

  .err {
    margin-bottom: var(--space-1);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
</style>
