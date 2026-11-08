<script lang="ts">
  /**
   * **```svg 블록을 그림으로**(2026-10-24) — `MarkdownBlocks` 의 `diagrams` 일 때만(문서 보기 타일 · 사이드 채팅). 규칙은 `svg-text.ts`.
   *
   * ## `{@html}` 원칙 — 예외가 아니다
   *
   * mermaid(`MermaidView`) · 수식(`MathView`)과 달리 여기는 HTML 을 넣지 않는다. 글을 `Blob(image/svg+xml)` 로 만들어
   * `URL.createObjectURL` 의 `blob:` 주소를 **`<img>` 의 `src`** 에만 준다. `<img>` 문맥의 SVG 는 스크립트 · 이벤트 손잡이가 돌지 않고
   * 바깥 자원도 읽지 않는다(문서 타일 그림 `doc-images.ts` 와 같은 규칙 — CSP `img-src` 의 `blob:` 덕에 산다). 주소는 글이 바뀌거나
   * 이 상자가 사라질 때 거둔다(`revokeObjectURL`).
   *
   * ## 잃는 것이 없게
   *
   * 크기 상한([`SVG_MAX_BYTES`])을 넘거나 `<svg` 태그가 없거나 `<img>` 가 그리지 못하면(깨진 SVG) 원문 `CodeView` 다(앞의 둘 중
   * 큰 것 · 깨짐은 흐린 한 줄을 얹는다). 그린 그림은 오른쪽 위 [원문 보기] 단추(코드 블록 복사 단추와 같은 자리 · 호버 규칙)로 원문
   * (`CodeView` — 그 [복사] 단추)과 오간다. 오간 상태는 이 블록의 한때 값이다.
   *
   * 그린 그림의 우클릭은 그림 메뉴다(`onmenu` — 다운로드 · 저장 · 이미지 복사 · SVG 코드 복사, `image-menu.ts`).
   *
   * 자라는 채팅 글의 닫히지 않은 울타리는 여기 오지 않는다(`TranscriptBody` 의 `splitOpenFence`) — 반쯤 쓴 SVG 를 그리려다 깨지지 않는다.
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
    /** 그린 그림의 우클릭 — 그림 메뉴(`MarkdownBlocks` 의 `ImageMenu`)를 연다. 받는 쪽이 `preventDefault` 한다 */
    onmenu?: (ev: MouseEvent, code: string, el: HTMLImageElement) => void;
  } = $props();

  const plan = $derived(svgPlan(code));
  /** 그린 그림의 `blob:` 주소 — 그릴 글일 때만 */
  let url = $state<string | null>(null);
  /** `<img>` 가 그리지 못했다(이 글에 대해) */
  let broken = $state(false);
  /** 원문을 보고 있다 */
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
        <!-- 원문을 보는 중 — 그림으로 돌아가기(오른쪽 위 [복사] 단추 바로 왼쪽) -->
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

  /* 단추 무리의 자리 — `MermaidView` 의 `.mw` 와 같다 */
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

  /* 코드 블록 복사 단추(`CodeView` `.copy`) · 다이어그램 배율 단추와 같은 자리 · 모양 · 호버 규칙 */
  .tools {
    position: absolute;
    top: 4px;
    right: 4px;
    display: flex;
    gap: 2px;
    opacity: 0;
    transition: opacity 120ms ease;
  }

  /* 원문 보기에서는 오른쪽 위가 [복사] 자리 — 바로 왼쪽에 둔다 */
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
