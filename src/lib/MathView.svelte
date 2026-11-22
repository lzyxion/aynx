<script module lang="ts">
  import { loadKatex, loadedKatex, type Katex } from "$lib/katex-loader";
  import { katexOptions, mathErrorLine } from "$lib/math-text";

  const CACHE_MAX = 256;
  const cache = new Map<string, { html: string } | { error: string }>();

  function renderMath(k: Katex, tex: string, display: boolean): { html: string } | { error: string } {
    const key = `${display ? "D" : "I"}\n${tex}`;
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    let out: { html: string } | { error: string };
    try {
      out = { html: k.renderToString(tex, katexOptions(display)) };
    } catch (e) {
      out = { error: mathErrorLine(e) };
    }
    cache.set(key, out);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return out;
  }
</script>

<script lang="ts">
  /**
   * `{@html}` 원칙의 두 번째 예외(첫째는 mermaid SVG — `MermaidView`) — KaTeX `renderToString` 의 HTML 을 그대로 넣는다.
   * KaTeX 는 원문 글자를 모두 이스케이프하고 `trust: false` 라 HTML 을 낳는 명령(`\href` · `\url` · `\includegraphics` · `\html*`)은 글자로 떨어진다.
   * 선택은 `math-text.ts` 의 `katexOptions` 한 곳, 넣는 곳은 아래 `$effect` 의 `innerHTML` 한 곳뿐이다.
   * 알고 받은 권고 GHSA-238p-pmpm-9mq7(0.16.x — 이미 오염된 프로토타입이 trust 를 우회) — 앞서 다른 경로로 `Object.prototype` 이 오염돼야 성립하고
   * 선택 객체는 매번 새로 만든다. 고친 판은 0.18.2~ — mermaid 12.3 이 제 katex 0.18.x 를 따로 들고 오니, 올리면 한 벌로 합쳐진다.
   * 뿌리의 `data-math` 로 문서 안 검색(`doc-find-dom.ts`)이 수식을 건너뛴다 — KaTeX 출력은 HTML 과 숨긴 MathML 에 같은 글자가 두 번 있다.
   */
  import CodeView from "$lib/CodeView.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { tex, display = false }: { tex: string; display?: boolean } = $props();

  let katex = $state.raw(loadedKatex());
  let loadError = $state<string | null>(null);

  $effect(() => {
    if (katex) return;
    loadKatex().then(
      (k) => (katex = k),
      (e: unknown) => {
        loadError = mathErrorLine(e);
        console.error("[aynx] KaTeX 를 불러오지 못했습니다 — 수식 원문을 그대로 둡니다", e);
      },
    );
  });

  const result = $derived(katex ? renderMath(katex, tex, display) : null);
  const html = $derived(result && "html" in result ? result.html : null);
  const why = $derived(result && "error" in result ? result.error : loadError);
  const failText = $derived(
    why === null ? null : why ? t("files.doc.md.math.fail", { reason: why }) : t("files.doc.md.math.fail.bare"),
  );

  let box = $state<HTMLElement | null>(null);

  // KaTeX HTML 을 넣는 유일한 곳 — 근거는 머리말
  $effect(() => {
    if (!box || html === null) return;
    box.innerHTML = html;
  });
</script>

{#if display}
  {#if html !== null}
    <div class="mb" bind:this={box} data-math></div>
  {:else}
    <div data-math>
      {#if failText !== null}<div class="err" title={failText}>{failText}</div>{/if}
      <CodeView code={tex} lang={null} framed />
    </div>
  {/if}
{:else if html !== null}<span class="mi" bind:this={box} data-math></span
>{:else}<code class="src" data-math title={failText ?? undefined}>{tex}</code>{/if}

<style>
  /* 수식은 문서 본문의 줄바꿈 규칙(`pre-wrap` · `overflow-wrap: anywhere`)을 받지 않는다 — KaTeX 가 제 간격을 쥔다 */
  .mi,
  .mb {
    white-space: normal;
    overflow-wrap: normal;
  }

  .mb {
    min-width: 0;
    max-width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    padding: var(--space-1) 0;
  }

  .mb :global(.katex-display) {
    margin: 0;
  }

  /* `MarkdownBlocks` 의 `.ic` 와 같은 모양 */
  .src {
    padding: 0 3px;
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--surface-hover);
    border-radius: 4px;
    overflow-wrap: anywhere;
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
