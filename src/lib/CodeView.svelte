<script lang="ts">
  /** 코드 보기 — hast 트리를 재귀로 그린다. `{@html}` 이 없으니 원격 파일의 `<script>` 는 글자다 */
  import type { ElementContent } from "hast";
  import { loadHighlighter, loadedHighlighter } from "$lib/highlight-loader";
  import { writeClipboard } from "$lib/clipboard";
  import { toast } from "$lib/toast.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";

  let {
    code,
    lang,
    lineNumbers = false,
    framed = false,
    fill = false,
    flashLine = null,
  }: {
    code: string;
    /** lowlight 이름이나 별칭 — 모르거나 `null` 이면 평문 */
    lang: string | null;
    lineNumbers?: boolean;
    framed?: boolean;
    fill?: boolean;
    /** 0 기준 · `fill` 일 때만 뜻이 있다 */
    flashLine?: number | null;
  } = $props();

  /** 끝의 줄바꿈 하나는 빈 줄로 세지 않는다 — `doc-line-jump.ts` 의 줄 셈과 같아야 한다 */
  const shown = $derived(code.endsWith("\n") ? code.slice(0, -1) : code);
  let hl = $state.raw(loadedHighlighter());
  $effect(() => {
    if (hl || !lang) return;
    loadHighlighter().then(
      (m) => (hl = m),
      (e: unknown) => console.error("[aynx] 구문 강조기를 불러오지 못했습니다 — 평문으로 둡니다", e),
    );
  });
  const tree = $derived(hl ? hl.highlight(shown, lang) : null);
  const gutter = $derived.by(() => {
    if (!lineNumbers) return "";
    let n = 1;
    for (let i = shown.indexOf("\n"); i >= 0; i = shown.indexOf("\n", i + 1)) n++;
    return Array.from({ length: n }, (_, k) => k + 1).join("\n");
  });

  let copied = $state<"ok" | "fail" | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(copyTimer));
  const copyLabel = $derived(
    copied === "ok"
      ? t("files.doc.md.code.copied")
      : copied === "fail"
        ? t("files.doc.md.code.copyfail")
        : t("files.doc.md.code.copy"),
  );

  async function onCopy(ev: MouseEvent): Promise<void> {
    // 문서 링크 손잡이(`MarkdownBlocks` 의 클릭) · 기록 보기의 접기 같은 상위 클릭으로 새지 않게
    ev.stopPropagation();
    // `code` 가 아니라 `shown` — 끝 줄바꿈까지 실으면 터미널에 붙여 넣는 순간 마지막 줄이 실행된다
    const ok = await writeClipboard(shown);
    copied = ok ? "ok" : "fail";
    if (!ok) toast.error(t("files.doc.md.code.copyfail"));
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 1500);
  }

  function cls(n: ElementContent): string {
    if (n.type !== "element") return "";
    const c = n.properties?.className;
    return Array.isArray(c) ? c.join(" ") : typeof c === "string" ? c : "";
  }
</script>

<!-- 한 줄로 적는다 — `<pre>` 안과 그 안에 그려지는 조각의 공백은 그대로 글이 된다 -->
{#snippet node(n: ElementContent)}{#if n.type === "text"}{n.value}{:else if n.type === "element"}<span class={cls(n)}
      >{#each n.children as c, i (i)}{@render node(c)}{/each}</span
    >{/if}{/snippet}

{#snippet view()}
  <div class="cv" class:framed class:fill data-code-view>
    {#if fill && flashLine !== null}<div class="flash" aria-hidden="true" style:--line={flashLine} data-line-flash></div>{/if}
    {#if lineNumbers}<pre class="gutter" aria-hidden="true">{gutter}</pre>{/if}
    <pre class="src"><code
        >{#if tree}{#each tree.children as n, i (i)}{#if n.type === "text" || n.type === "element"}{@render node(n)}{/if}{/each}{:else}{shown}{/if}</code
      ></pre>
  </div>
{/snippet}

{#if framed}
  <div class="cvw">
    {@render view()}
    <button
      type="button"
      class="copy btn btn-ghost btn-sm"
      class:ok={copied === "ok"}
      class:held={copied !== null}
      title={copyLabel}
      aria-label={copyLabel}
      data-code-copy
      onclick={(ev) => void onCopy(ev)}
    >
      <UiIcon name={copied === "ok" ? "check" : "copy"} size={13} />
    </button>
  </div>
{:else}
  {@render view()}
{/if}

<style>
  .cv {
    display: flex;
    align-items: flex-start;
    min-width: 0;
    overflow: auto;
    font-family: var(--font-mono);
    /* `DocView` 의 `--doc-zoom` */
    font-size: calc(var(--t-xs) * var(--doc-zoom, 1));
    line-height: 1.5;
    color: var(--fg-1);
  }

  /* 복사 단추는 가로 스크롤 상자(`.cv`) 바깥에 둔다 — 안에 두면 가로로 밀 때 글과 함께 밀려 나간다 */
  .cvw {
    position: relative;
    min-width: 0;
  }

  .copy {
    position: absolute;
    top: 4px;
    right: 4px;
    width: 24px;
    padding: 0;
    background: var(--surface-field-solid);
    border-color: var(--line);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .cvw:hover .copy,
  .cvw:focus-within .copy,
  .copy.held {
    opacity: 1;
  }

  .copy:hover:not(:disabled) {
    color: var(--fg-1);
    background: var(--surface-field-solid);
    border-color: var(--line-strong);
  }

  .copy.ok,
  .copy.ok:hover:not(:disabled) {
    color: var(--ok);
  }

  .cv.fill {
    position: relative;
    height: 100%;
  }

  /* "이 줄로" 의 판 — 줄 높이는 `.cv` 의 `line-height: 1.5`, 위 여백은 `.src` 의 것과 같아야 줄에 맞는다 */
  .cv.fill .src {
    position: relative;
  }

  .flash {
    position: absolute;
    left: 0;
    right: 0;
    top: calc(var(--space-2) + var(--line) * 1.5em);
    height: 1.5em;
    background: var(--accent-soft);
    pointer-events: none;
    animation: line-flash 2s ease-out forwards;
  }

  @keyframes line-flash {
    from {
      opacity: 1;
    }
    to {
      opacity: 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .flash {
      animation: none;
    }
  }

  .cv.framed {
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  pre {
    margin: 0;
    font: inherit;
    white-space: pre;
  }

  .src {
    flex: 1 0 auto;
    padding: var(--space-2) var(--space-3);
    user-select: text;
  }

  /* `<code>` 의 브라우저 기본 글꼴을 끊는다 — 거터와 글꼴이 다르면 줄 높이가 달라져 줄 번호가 밀린다 */
  .src code {
    font: inherit;
  }

  .gutter {
    position: sticky;
    left: 0;
    z-index: 1;
    flex: none;
    padding: var(--space-2) var(--space-2) var(--space-2) var(--space-3);
    text-align: right;
    color: var(--fg-3);
    background: var(--surface-field-solid);
    border-right: 1px solid var(--line);
    user-select: none;
  }

  .gutter + .src {
    padding-left: var(--space-2);
  }

  /* ── 강조 ── `doc-editor-cm.ts` 와 같은 매핑 */
  .src :global(.hljs-keyword),
  .src :global(.hljs-selector-tag),
  .src :global(.hljs-doctag),
  .src :global(.hljs-meta .hljs-keyword) {
    color: var(--tertiary);
  }

  .src :global(.hljs-string),
  .src :global(.hljs-regexp),
  .src :global(.hljs-addition),
  .src :global(.hljs-selector-attr),
  .src :global(.hljs-selector-pseudo),
  .src :global(.hljs-meta .hljs-string) {
    color: var(--ok);
  }

  .src :global(.hljs-number),
  .src :global(.hljs-literal),
  .src :global(.hljs-symbol),
  .src :global(.hljs-bullet),
  .src :global(.hljs-link) {
    color: var(--warn);
  }

  .src :global(.hljs-title),
  .src :global(.hljs-section),
  .src :global(.hljs-name),
  .src :global(.hljs-selector-id),
  .src :global(.hljs-selector-class) {
    color: var(--folder);
  }

  .src :global(.hljs-built_in),
  .src :global(.hljs-type),
  .src :global(.hljs-attr),
  .src :global(.hljs-attribute),
  .src :global(.hljs-variable),
  .src :global(.hljs-template-variable),
  .src :global(.hljs-property) {
    color: color-mix(in srgb, var(--tertiary) 55%, var(--fg));
  }

  .src :global(.hljs-comment),
  .src :global(.hljs-quote) {
    color: var(--fg-3);
    font-style: italic;
  }

  .src :global(.hljs-meta),
  .src :global(.hljs-punctuation),
  .src :global(.hljs-subst) {
    color: var(--fg-2);
  }

  .src :global(.hljs-deletion) {
    color: var(--err);
  }

  .src :global(.hljs-emphasis) {
    font-style: italic;
  }

  .src :global(.hljs-strong),
  .src :global(.hljs-section) {
    font-weight: var(--fw-semibold);
  }
</style>
