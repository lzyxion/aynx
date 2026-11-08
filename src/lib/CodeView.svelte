<script lang="ts">
  /**
   * **코드 보기** — 고정폭 · 줄바꿈 끔(가로 스크롤) · 선택적 줄 번호 거터 · 구문 강조 (문서 보기 타일 계약 §2).
   *
   * 강조는 `$lib/highlight` 가 돌려준 **hast 트리**를 이 컴포넌트가 재귀로 그린다 — 글자 노드는 `{text}`, 요소
   * 노드는 `<span class=…>`. `{@html}` 이 없으니 원격 파일의 `<script>` 는 글자다. 언어를 모르거나 글이 너무 크면
   * (`tooLargeToHighlight`) 강조 없이 평문이다 — 띠로 알리는 것은 부르는 쪽 몫(같은 함수를 본다).
   *
   * 줄 번호는 **따로 선 칸**(`aria-hidden` · 선택 안 됨)이라 글을 골라 복사하면 번호가 딸려 오지 않는다. 두 칸은
   * 같은 글꼴·줄 높이로 줄이 맞고, 가로로 밀어도 거터는 왼쪽에 붙어 있다(sticky).
   *
   * 강조기는 **늦게 받는다**(`highlight-loader` — 메인 청크에서 뺐다, 문서 보기 B6). 받기 전에는 평문이고 도착하면
   * 그 자리에서 색이 붙는다 — 글자·줄 높이가 같아 흔들림이 없다. 언어가 없으면(평문 파일) 받지도 않는다.
   *
   * 색은 **기존 토큰에만** 기댄다(강조색 · ok · warn · err · 흐린 글자 · 폴더) — 라이트/다크가 저절로 따라간다.
   *
   * **복사 단추**는 판이 있을 때(`framed` — 마크다운 코드 블록 · 기록 보기 · mermaid 원문)만 오른쪽 위에 선다.
   * 파일 통째(`fill`)는 글을 골라 복사하는 화면이라 없다. `.cv` 가 가로 스크롤 상자라 단추는 그 **바깥** 래퍼에
   * 둔다 — 안에 두면 가로로 밀 때 글과 함께 밀려 나간다. 블록에 포인터가 얹히거나 포커스가 안에 있을 때만 보인다.
   * 피드백은 `CommandBlock` 과 같은 결 — 단추 자리의 체크 아이콘(1.5초)이고 툴팁·이름도 그동안 바뀐다.
   */
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
  }: {
    /** 보일 글 */
    code: string;
    /** 강조 언어 — lowlight 이름이나 별칭(`ts` · `sh` …). 모르거나 `null` 이면 평문 */
    lang: string | null;
    /** 왼쪽에 줄 번호 거터 */
    lineNumbers?: boolean;
    /** 판(배경 · 테두리 · 둥근 모서리 · 안쪽 여백) — 마크다운 안의 코드 블록 */
    framed?: boolean;
    /** 부모 높이를 채우고 스스로 세로로도 스크롤한다 — 파일 하나를 통째로 보일 때 */
    fill?: boolean;
  } = $props();

  /** 끝의 줄바꿈 하나는 빈 줄로 세지 않는다(파일은 대개 `\n` 으로 끝난다) */
  const shown = $derived(code.endsWith("\n") ? code.slice(0, -1) : code);
  /** 받아 온 강조기 — 이미 받았으면 첫 프레임부터 있다 */
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

  /** 복사 결과 — 1.5초 동안 단추의 그림·이름이 이것을 따른다 */
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
    // `code` 가 아니라 `shown` — 화면에 보이는 그대로다. 끝 줄바꿈까지 실으면 터미널에 붙여 넣는 순간
    // 마지막 줄이 Enter 와 함께 실행된다(마크다운 펜스는 대개 끝 줄바꿈이 없어 둘이 같다).
    const ok = await writeClipboard(shown);
    copied = ok ? "ok" : "fail";
    // 실패는 아이콘이 그대로라 눈에 띄지 않고, 툴팁은 누르는 순간 닫힌다 — 토스트로 알린다
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
    /* 문서 타일의 글자 크기 배율(`DocView` 의 `--doc-zoom` — 줄 번호 거터도 같은 글꼴을 물려받는다). 다른 화면에는 변수가 없어 1 */
    font-size: calc(var(--t-xs) * var(--doc-zoom, 1));
    line-height: 1.5;
    color: var(--fg-1);
  }

  /* 복사 단추의 자리 — 가로 스크롤 상자(`.cv`) 바깥이라 밀어도 단추는 제자리다 */
  .cvw {
    position: relative;
    min-width: 0;
  }

  /* 판 없는 작은 단추 — 배경은 판보다 한 톤 짙은 불투명 면이라 밑의 글을 덮고, 그림자 없이 선 하나 */
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
    height: 100%;
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

  /* `<code>` 의 브라우저 기본 글꼴(`monospace`)을 끊는다 — 거터와 다른 글꼴이면 줄 높이가 달라져
     (18px 대 18.57px) 줄 번호가 줄마다 밀린다(30줄쯤이면 한 줄). 거터와 **같은 글꼴·크기·줄 높이** */
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

  /* ── 강조 — hljs 이름을 기존 토큰에 (새 색 없음) ───────────────────────────
     키워드·타입은 "무엇인지" 를 말하는 자리라 제3색(`--tertiary`)이다 — `doc-editor-cm.ts` 와 같은 매핑 계약 */
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
