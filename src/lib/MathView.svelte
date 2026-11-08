<script module lang="ts">
  import { loadKatex, loadedKatex, type Katex } from "$lib/katex-loader";
  import { katexOptions, mathErrorLine } from "$lib/math-text";

  /** 그린 결과 — 같은 원문 · 같은 모양(인라인/블록)이면 다시 그리지 않는다(자동 새로고침 · 편집 미리 보기). 오래된 것부터 버린다 */
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
   * **수식** — 문서 보기 타일의 `$…$`(인라인) · `$$…$$` · ```math(블록)을 KaTeX 로 그린다(`parseMarkdown` 의 `math` 선택을
   * 켠 글에서만 수식 토막 · 블록이 생긴다 — 기록 보기 · 명령 블록은 끈다: 에이전트 말에 `$` 가 흔하다(가격 · 셸 변수)).
   *
   * ## `{@html}` 원칙의 두 번째 예외
   *
   * 이 앱은 문서를 HTML 로 만들지 않는다(`MarkdownBlocks` 머리말). 예외는 둘이다 — mermaid SVG(`MermaidView`)와 여기.
   * 여기는 KaTeX `renderToString` 의 **HTML 글자**를 그대로 넣는다. KaTeX 는 원문의 글자를 모두 이스케이프해 제 요소
   * (`span` · MathML)로만 짜고, `trust: false` 라 HTML 을 낳는 명령(`\href` · `\url` · `\includegraphics` · `\html*`)은
   * 글자로 떨어진다. 크기 · 매크로 상한도 건다(선택은 `math-text.ts` 의 `katexOptions` 한 곳). 넣는 곳은 아래 `$effect`
   * 의 `innerHTML` 한 곳뿐이다.
   *
   * KaTeX 0.16.x 에는 "이미 오염된 프로토타입이 trust 제한을 우회할 수 있다" 는 낮은 등급 권고(GHSA-238p-pmpm-9mq7)가
   * 있다. 앞서 **다른 경로로** `Object.prototype` 이 오염돼 있어야 성립하는 2차 우회다 — 이 앱에는 그런 오염 경로가
   * 알려져 있지 않고, 선택 객체는 매번 새로 만들어 `trust: false` 를 제 속성으로 싣는다. 고친 판(0.18.2~)은 mermaid 가
   * 끌어오는 판과 갈리므로 같은 판을 쓴다(중복 설치를 피한다) — mermaid 를 올릴 때 함께 본다.
   *
   * ## 잃는 것이 없게
   *
   * KaTeX 를 받기 전 · 받기 실패 · 문법 오류면 **원문 그대로**다 — 인라인은 인라인 코드 모양, 블록은 `CodeView`. 실패면
   * 흐린 오류 툴팁(블록은 원문 위 한 줄도). 성공해야만 원문이 수식으로 바뀐다.
   *
   * ## 검색 · 선택
   *
   * 뿌리에 `data-math` 를 단다 — 문서 안 검색(`doc-find-dom.ts`)이 수식을 훑지 않는다(KaTeX 출력은 보이는 HTML 과 숨긴
   * MathML 에 같은 글자가 두 번 있고, 기호가 글자 노드로 쪼개져 셈이 이상해진다). 블록은 넓으면 가로로 민다.
   */
  import CodeView from "$lib/CodeView.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { tex, display = false }: { tex: string; display?: boolean } = $props();

  /** 받아 온 KaTeX — 이미 받았으면 첫 프레임부터 있다 */
  let katex = $state.raw(loadedKatex());
  /** 받기 실패의 까닭 — 다음 수식(또는 다시 그려진 이 수식)이 다시 시도한다 */
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
  /** 원문 위 · 툴팁의 까닭 — 문법 오류든 받기 실패든 */
  const why = $derived(result && "error" in result ? result.error : loadError);
  const failText = $derived(
    why === null ? null : why ? t("files.doc.md.math.fail", { reason: why }) : t("files.doc.md.math.fail.bare"),
  );

  let box = $state<HTMLElement | null>(null);

  // KaTeX HTML 을 넣는 유일한 곳 — 근거는 머리말("`{@html}` 원칙의 두 번째 예외")
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

  /* 블록 — 가운데(KaTeX 의 display 모양), 넓으면 가로로 민다 */
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

  /* 원문(받기 전 · 실패) — 인라인 코드와 같은 모양(`MarkdownBlocks` 의 `.ic`) */
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
