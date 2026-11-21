<script lang="ts">
  /**
   * 마크다운 블록 그리기 — 글자 보간(`{text}`)으로만 그린다. `{@html}` 없음.
   * 예외 둘 — 문서 글이 아니라 그리기 엔진이 짠 출력이고 넣는 곳은 각 컴포넌트의 `innerHTML` 한 곳뿐이다: mermaid SVG(`MermaidView` 머리말) ·
   * KaTeX 수식(`MathView` 머리말). ```svg(`SvgView`)는 예외가 아니다 — `blob:` 주소를 `<img>` 에만 준다(스크립트 · 바깥 자원이 돌지 않는다).
   * 웹 링크는 `onlink` 가 있고 `http`/`https` 일 때만 연다(판정은 `isWebUrl` 하나). `<img>` 의 주소는 받는 쪽이 만든 `blob:` 뿐이다.
   * 경로 링크는 `<button>` 이 아니라 `role="link"` 글자다 — 문서 안 찾기(`doc-find-dom` 의 `SKIP`)가 단추 글자를 건너뛰고 끌어 고르기도 단추 안에서 시작되지 않는다.
   * 제목 앵커 · 각주는 `id` 가 아니라 `data-slug` · `data-fn` 속성으로 찾는다 — 한 창에 문서 타일이 여럿이면 id 가 겹친다.
   * 각주 오가기는 그냥 클릭이다 — 같은 문서 안 스크롤뿐이라 잘못 눌러도 잃는 것이 없다(링크의 Ctrl+클릭은 잘못 누른 클릭에서 지키려는 것).
   */
  import CodeView from "$lib/CodeView.svelte";
  import DocCodeBlock from "$lib/DocCodeBlock.svelte";
  import MermaidView from "$lib/MermaidView.svelte";
  import SvgView from "$lib/SvgView.svelte";
  import MathView from "$lib/MathView.svelte";
  import { isMermaidLang } from "$lib/mermaid-text";
  import { isSvgLang } from "$lib/svg-text";
  import UiIcon from "$lib/UiIcon.svelte";
  import { isWebUrl, linkHost, type MdAlertType, type MdBlock, type MdInline, type MdListItem } from "$lib/markdown";
  import { classifyDocHref, headingSlugs, hrefPathLink, inlineText } from "$lib/doc-links";
  import { codePathLink, splitProsePaths, type PathMatch } from "$lib/path-links";
  import type { DocImageState } from "$lib/doc-images.svelte";
  import { isImageLinkHref } from "$lib/doc-images";
  import { chipOnly, placeSourceChips } from "$lib/md-source-chips";
  import ImageMenu from "$lib/ImageMenu.svelte";
  import { imageMenuActions, type ImageMenuAction } from "$lib/image-menu";
  import { runImageAction, type ImageTarget } from "$lib/image-actions";
  import { isRemote } from "$lib/ipc";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    blocks,
    onlink,
    ondoclink,
    compact = false,
    diagrams = false,
    tasks,
    images,
    linkImages = false,
    linkClick = "ctrl",
    linkStyle = "inline",
    onjump,
    codeActions,
    paths,
  }: {
    blocks: MdBlock[];
    /** 주소는 이미 `isWebUrl` 을 통과했다 */
    onlink?: (href: string) => void;
    /** 주소는 적힌 그대로 — 푸는 일은 받는 쪽 몫 */
    ondoclink?: (href: string) => void;
    compact?: boolean;
    diagrams?: boolean;
    /** `ontoggle` 은 원문 줄과 누르기 전 상태를 받는다 — 화면의 체크는 쓰기가 성공해 글이 다시 파싱될 때 바뀐다 */
    tasks?: {
      title: string;
      blocked: string | null;
      busy: ReadonlySet<number>;
      ontoggle: (line: number, wasChecked: boolean) => void;
    };
    images?: {
      state(src: string): DocImageState;
      broken(src: string): void;
      /** 없으면 그 그림에는 우클릭 메뉴가 서지 않는다 */
      source?(src: string): { path: string; mime: string; read: () => Promise<ArrayBuffer> } | null;
    };
    linkImages?: boolean;
    linkClick?: "ctrl" | "plain";
    /** `chip` — 키워드 링크 + 그 자리 출처 칩(판정은 `md-source-chips.ts`) */
    linkStyle?: "inline" | "chip";
    /** 받는 쪽이 자기 스크롤 상자만 민다 — `scrollIntoView` 는 조상 상자까지 밀어 타일 배치를 흔든다 */
    onjump?: (el: HTMLElement) => void;
    codeActions?: { onterm: (code: string, button: HTMLElement) => void };
    /** `title` 이 `null` 이면 링크가 아니다 */
    paths?: { title: (m: PathMatch) => string | null; open: (m: PathMatch) => void };
  } = $props();

  /** 파서가 `math` 로 나누지 않은 글에서도 ```math 에는 머리 띠를 세우지 않는다 */
  const isMathFence = (lang: string | undefined) => (lang ?? "").trim().toLowerCase() === "math";

  /** 각주 구역은 늘 최상위 맨 끝 블록이다 */
  const fnTips = $derived.by(() => {
    const out = new Map<number, string>();
    const last = blocks[blocks.length - 1];
    if (last?.kind === "footnotes") for (const it of last.items) out.set(it.n, inlineText(it.inlines).trim());
    return out;
  });

  let rootEl = $state<HTMLDivElement | null>(null);

  function footnoteClick(ev: MouseEvent): boolean {
    const el = ev.target instanceof Element ? ev.target.closest("[data-fn-ref], [data-fn-back]") : null;
    if (!el || !onjump || !rootEl) return false;
    const ref = el.getAttribute("data-fn-ref");
    const back = el.getAttribute("data-fn-back");
    // 값은 파서가 만든 숫자(`n` · `n:occ`)뿐이라 선택자에 그대로 넣는다
    const target =
      ref !== null
        ? rootEl.querySelector<HTMLElement>(`[data-fn="${ref.split(":")[0]}"]`)
        : rootEl.querySelector<HTMLElement>(`[data-fn-ref="${back}"]`);
    if (!target) return false;
    ev.preventDefault();
    onjump(target);
    return true;
  }

  /** 글이 다시 파싱돼도(자동 새로고침 · 편집 미리 보기) 그대로 */
  let fmOpen = $state(false);

  const taskLive = (li: MdListItem) => !!tasks && tasks.blocked === null && li.line !== undefined && !tasks.busy.has(li.line);

  function taskClick(ev: MouseEvent, li: MdListItem) {
    // 화면의 체크는 글이 다시 파싱될 때 바뀐다 — 쓰기가 실패해도 거짓 상태가 남지 않는다
    ev.preventDefault();
    if (!tasks || !taskLive(li) || li.line === undefined || li.checked === undefined) return;
    tasks.ontoggle(li.line, li.checked);
  }

  const isDocLink = (href: string) => {
    const k = classifyDocHref(href).kind;
    return k === "anchor" || k === "path";
  };
  const hrefPath = (href: string): PathMatch | null => {
    if (!paths || isWebUrl(href)) return null;
    const m = hrefPathLink(href);
    return m && paths.title(m) !== null ? m : null;
  };
  const textPathTip = (text: string): string | null => {
    const m = paths ? codePathLink(text) : null;
    return m && paths ? paths.title(m) : null;
  };
  const live = (href: string) => (!!onlink && isWebUrl(href)) || (!!ondoclink && isDocLink(href)) || hrefPath(href) !== null;

  function pathOfEl(el: Element): PathMatch | null {
    if (!paths || !el.hasAttribute("data-path-link")) return null;
    const raw = el.getAttribute("data-path");
    if (raw !== null) return textPathTip(raw) !== null ? codePathLink(raw) : null;
    const href = el.getAttribute("data-href");
    return href ? hrefPath(href) : null;
  }

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Enter" || ev.isComposing || !paths || !(ev.target instanceof Element)) return;
    const m = pathOfEl(ev.target);
    if (!m) return;
    ev.preventDefault();
    paths.open(m);
  }

  const slugs = $derived(headingSlugs(blocks));

  function onclick(ev: MouseEvent) {
    if (footnoteClick(ev)) return;
    if (linkClick === "ctrl" && !(ev.ctrlKey || ev.metaKey)) return;
    const pathEl = ev.target instanceof Element ? ev.target.closest("[data-path-link]") : null;
    if (pathEl) {
      if (linkClick === "plain" && selecting(pathEl)) return;
      const m = pathOfEl(pathEl);
      if (m && paths) {
        ev.preventDefault();
        paths.open(m);
      }
      return;
    }
    const el = ev.target instanceof Element ? ev.target.closest("[data-href]") : null;
    const href = el?.getAttribute("data-href");
    if (!el || !href) return;
    if (linkClick === "plain" && selecting(el)) return;
    if (onlink && isWebUrl(href)) {
      ev.preventDefault();
      onlink(href);
    } else if (ondoclink && isDocLink(href)) {
      ev.preventDefault();
      ondoclink(href);
    }
  }

  /** 끌어 고르다 링크 위에서 놓은 클릭은 여는 클릭이 아니다 */
  function selecting(el: Element): boolean {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed && sel.containsNode(el, true);
  }

  const linkTitle = (href: string) =>
    !live(href)
      ? href
      : hrefPath(href) !== null
        ? (paths?.title(hrefPath(href)!) ?? href)
        : linkClick === "plain"
        ? t("files.doc.md.link.openPlain", { href })
        : href;

  const chipLink = (s: { href: string; image?: true }) =>
    linkStyle === "chip" && !s.image && !!onlink && isWebUrl(s.href) && !(linkImages && images && isImageLinkHref(s.href));
  const sourceTitle = (s: { text: string; href: string }) =>
    s.text ? t("files.doc.md.link.source", { text: s.text, href: s.href }) : linkTitle(s.href);

  const level = (n: number) => Math.min(6, Math.max(1, n));

  /** 손잡이는 여는 순간 지역 값으로 묶어 둔다 — 메뉴가 닫힌 뒤 불리므로 이 상태(닫으면 `null`)를 읽으면 안 된다(docs/conventions.md 의 "메뉴를 닫는 코드") */
  let imgMenu = $state<{ kind: ImageTarget["kind"]; x: number; y: number; run: (a: ImageMenuAction) => void } | null>(null);
  const closeImgMenu = () => (imgMenu = null);

  function openImgMenu(ev: MouseEvent, target: ImageTarget, el: HTMLImageElement) {
    ev.preventDefault(); // 앱 메뉴 — 창 전역의 네이티브 메뉴 막기(`shouldBlockNativeContextMenu`)가 비켜 선다
    ev.stopPropagation();
    imgMenu = { kind: target.kind, x: ev.clientX, y: ev.clientY, run: (a) => runImageAction(a, target, el) };
  }

  /** ```svg 는 `SvgView` 가 `onmenu` 로 올린다 */
  function oncontextmenu(ev: MouseEvent) {
    const el = ev.target instanceof HTMLImageElement && ev.target.matches("img.md-img[data-img-src]") ? ev.target : null;
    const src = el?.getAttribute("data-img-src");
    const source = src ? images?.source?.(src) : null;
    if (!el || !source) return;
    openImgMenu(ev, { kind: "file", ...source }, el);
  }

  const ALERT_ICON: Record<MdAlertType, string> = {
    note: "info",
    tip: "alert-tip",
    important: "alert-important",
    warning: "warning",
    caution: "alert-caution",
  };
  const alertLabel = (type: MdAlertType) =>
    type === "note"
      ? t("files.doc.md.alert.note")
      : type === "tip"
        ? t("files.doc.md.alert.tip")
        : type === "important"
          ? t("files.doc.md.alert.important")
          : type === "warning"
            ? t("files.doc.md.alert.warning")
            : t("files.doc.md.alert.caution");
</script>

<!-- 한 줄로 적는다 — 글자 칸이 pre-wrap 이라 태그 사이 공백이 그대로 보인다 -->
{#snippet inl(xs: MdInline[])}{#each xs as s, si (si)}{#if s.kind === "code"}{@const tip = textPathTip(s.text)}{#if tip !== null}<span role="link" tabindex="0" data-path-link data-path={s.text} title={tip}
          ><code class="ic path">{s.text}</code></span
        >{:else}<code class="ic">{s.text}</code>{/if}{:else if s.kind === "strong"}<strong>{#if s.inlines}{@render inl(s.inlines)}{:else}{s.text}{/if}</strong
    >{:else if s.kind === "em"}<em>{#if s.inlines}{@render inl(s.inlines)}{:else}{s.text}{/if}</em
    >{:else if s.kind === "del"}<del>{#if s.inlines}{@render inl(s.inlines)}{:else}{s.text}{/if}</del>{:else if s.kind === "link" && s.source}<button
        type="button"
        class="src-chip"
        data-href={s.href}
        title={sourceTitle(s)}
        ><span class="src-host">{linkHost(s.href)}</span><UiIcon name="external" size={10} /></button
      >{:else if s.kind === "link" && chipLink(s) && chipOnly(s)}<button
        type="button"
        class="src-chip solo"
        data-href={s.href}
        title={linkTitle(s.href)}
        ><span class="src-host">{linkHost(s.href)}</span><UiIcon name="external" size={10} /></button
      >{:else if s.kind === "link" && hrefPath(s.href) !== null}<span
        class="link live"
        role="link"
        tabindex="0"
        data-path-link
        data-href={s.href}
        title={linkTitle(s.href)}>{s.image ? s.text || t("files.doc.md.image", { alt: "" }) : s.text}</span
      >{:else if s.kind === "link"}<span
        class="link"
        class:live={live(s.href)}
        data-href={live(s.href) ? s.href : undefined}
        title={linkTitle(s.href)}
        >{s.image ? s.text || t("files.doc.md.image", { alt: "" }) : s.text}</span
      >{#if linkImages && images && !s.image && isImageLinkHref(s.href)}{@const lim = images.state(s.href)}{#if lim.status === "ok"}<img
            class="md-img link-img"
            data-img-src={s.href}
            src={lim.url}
            alt={s.text}
            title={s.text || undefined}
            onerror={() => images?.broken(s.href)}
          />{/if}{/if}{:else if s.kind === "image"}{@const im = images?.state(s.href)}{#if im?.status === "ok"}<img
          class="md-img"
          data-img-src={s.href}
          src={im.url}
          alt={s.text}
          title={s.text || undefined}
          onerror={() => images?.broken(s.href)}
        />{:else}<span class="img" class:loading={im?.status === "loading"} title={im?.status === "fail" ? im.why : s.href}
          >{t("files.doc.md.image", { alt: s.text })}</span
        >{/if}{:else if s.kind === "fnref"}<sup
        class="fnref"
        class:live={!!onjump}
        data-fn-ref="{s.n}:{s.occ}"
        title={fnTips.get(s.n) || undefined}>{s.n}</sup
      >{:else if s.kind === "math"}<MathView tex={s.text} />{:else if s.kind === "text" && paths}{#each splitProsePaths(s.text) as g, gi (gi)}{@const tip = g.path ? textPathTip(g.text) : null}{#if tip !== null}<span
            class="link live"
            role="link"
            tabindex="0"
            data-path-link
            data-path={g.text}
            title={tip}>{g.text}</span
          >{:else}{g.text}{/if}{/each}{:else}{s.text}{/if}{/each}{/snippet}

<!-- 표 칸은 `inl` 만 부른다. 한 줄로 적는다(pre-wrap) -->
{#snippet blockInl(xs: MdInline[])}{#if linkStyle === "chip"}{@render inl(placeSourceChips(xs, chipLink))}{:else}{@render inl(xs)}{/if}{/snippet}

{#snippet list(b: Extract<MdBlock, { kind: "list" }>)}
  {#each b.items as li, lii (lii)}
    <li style:margin-left="{li.depth * 16}px" class:task={li.checked !== undefined}
      >{#if li.checked !== undefined}{#if tasks}<input
            type="checkbox"
            class="live"
            checked={li.checked}
            disabled={!taskLive(li)}
            aria-busy={li.line !== undefined && tasks.busy.has(li.line)}
            title={tasks.blocked ?? tasks.title}
            onclick={(ev) => taskClick(ev, li)}
          />{:else}<input type="checkbox" checked={li.checked} disabled tabindex="-1" />{/if}{/if}{@render blockInl(
        li.inlines,
      )}</li
    >
  {/each}
{/snippet}

{#snippet blockList(bs: MdBlock[])}
  {#each bs as b, bi (bi)}
    {#if b.kind === "code" && diagrams && isMermaidLang(b.lang)}
      <MermaidView code={b.text} />
    {:else if b.kind === "code" && diagrams && isSvgLang(b.lang)}
      <SvgView code={b.text} onmenu={(ev, code, el) => openImgMenu(ev, { kind: "svg", code }, el)} />
    {:else if b.kind === "code" && codeActions && !isMermaidLang(b.lang) && !isSvgLang(b.lang) && !isMathFence(b.lang)}
      <DocCodeBlock code={b.text} lang={b.lang || null} onterm={codeActions.onterm} />
    {:else if b.kind === "code"}
      <CodeView code={b.text} lang={b.lang || null} framed />
    {:else if b.kind === "math"}
      <MathView tex={b.text} display />
    {:else if b.kind === "pre"}
      <pre class="pre">{b.text}</pre>
    {:else if b.kind === "frontmatter"}
      <details class="fm" bind:open={fmOpen}>
        <summary>{t("files.doc.md.frontmatter", { count: String(b.count) })}</summary>
        {#if fmOpen}
          {#if b.entries && b.entries.length > 0}
            <div class="tbl">
              <table class="fm-table">
                <tbody>
                  {#each b.entries as e, ei (ei)}
                    <tr><th scope="row">{e.key}</th><td>{e.value}</td></tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {:else}
            <pre class="pre">{b.text}</pre>
          {/if}
        {/if}
      </details>
    {:else if b.kind === "footnotes"}
      <!-- ↩ 는 검색이 세지 않게 aria-hidden -->
      <section class="fns" aria-label={t("files.doc.md.footnotes")} data-footnotes>
        <hr />
        <ol class="md-list">
          {#each b.items as it (it.n)}
            <li data-fn={it.n}
              >{@render blockInl(it.inlines)}{#if onjump}{#each { length: it.refs } as _, oi (oi)}<span
                    class="fnback"
                    aria-hidden="true"
                    data-fn-back="{it.n}:{oi + 1}"
                    title={t("files.doc.md.footnote.back")}>↩{#if oi > 0}<sup>{oi + 1}</sup>{/if}</span
                  >{/each}{/if}</li
            >
          {/each}
        </ol>
      </section>
    {:else if b.kind === "hr"}
      <hr />
    {:else if b.kind === "list"}
      {#if b.ordered}
        <ol class="md-list" start={b.start}>{@render list(b)}</ol>
      {:else}
        <ul class="md-list">{@render list(b)}</ul>
      {/if}
    {:else if b.kind === "table"}
      <div class="tbl">
        <table>
          <thead>
            <tr>
              {#each b.header as cell, ci (ci)}<th style:text-align={b.align[ci]}>{@render inl(cell)}</th>{/each}
            </tr>
          </thead>
          <tbody>
            {#each b.rows as row, ri (ri)}
              <tr>
                {#each row as cell, ci (ci)}<td style:text-align={b.align[ci]}>{@render inl(cell)}</td>{/each}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else if b.kind === "quote"}
      <blockquote class="quote">{@render blockList(b.blocks)}</blockquote>
    {:else if b.kind === "alert"}
      <div class="alert {b.type}" role="note">
        <p class="alert-head"><UiIcon name={ALERT_ICON[b.type]} size={14} /><span>{alertLabel(b.type)}</span></p>
        {@render blockList(b.blocks)}
      </div>
    {:else if b.kind === "h"}
      <svelte:element this={`h${level(b.level)}`} class="h h{level(b.level)}" data-slug={slugs.get(b)}>{@render blockInl(b.inlines)}</svelte:element>
    {:else}
      <p>{@render blockInl(b.inlines)}</p>
    {/if}
  {/each}
{/snippet}

<!-- 키보드로 여는 길은 경로 링크의 Enter 뿐이다(그 밖의 링크는 초점을 받지 않는 글자) -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" class:compact {onclick} {onkeydown} {oncontextmenu} bind:this={rootEl} data-markdown>{@render blockList(blocks)}</div>

{#if imgMenu}
  <ImageMenu actions={imageMenuActions(imgMenu.kind, isRemote)} x={imgMenu.x} y={imgMenu.y} onclose={closeImgMenu} onpick={imgMenu.run} />
{/if}

<style>
  .md {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .md > :global(*),
  .quote > :global(*),
  .alert > :global(*) {
    margin: 0 0 var(--space-2);
  }

  .md > :global(:last-child),
  .quote > :global(:last-child),
  .alert > :global(:last-child) {
    margin-bottom: 0;
  }

  p,
  .h,
  .md-list li,
  td,
  th {
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }

  /* `anywhere` 는 칸의 최소 폭을 한 글자로 만들어 좁은 칸이 한 글자씩 세로로 감긴다 */
  td,
  th {
    overflow-wrap: break-word;
    word-break: keep-all;
  }

  .h {
    font-weight: var(--fw-semibold);
    line-height: 1.3;
    font-size: 1em;
  }

  .md:not(.compact) .h1 {
    font-size: 1.6em;
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--line);
  }

  .md:not(.compact) .h2 {
    font-size: 1.35em;
    padding-bottom: var(--space-1);
    border-bottom: 1px solid var(--line);
  }

  .md:not(.compact) .h3 {
    font-size: 1.15em;
  }

  .md:not(.compact) .h5,
  .md:not(.compact) .h6 {
    font-size: 0.92em;
    color: var(--fg-2);
  }

  .md:not(.compact) > .h:not(:first-child) {
    margin-top: var(--space-4);
  }

  .quote {
    margin-left: 0;
    margin-right: 0;
    padding-left: var(--space-3);
    border-left: 2px solid var(--line-strong);
    color: var(--fg-2);
  }

  /* 왼쪽 굵은 띠는 두지 않는다(사용자 취향). 앱에 파랑 · 보라 토큰이 없어 GitHub 의 빛깔을 뜻으로 옮겼다 — NOTE 는 무채, IMPORTANT 가 강조색 */
  .alert {
    --alert-tone: var(--fg-2);
    --alert-face: var(--surface-hover);
    padding: var(--space-2) var(--space-3);
    background: var(--alert-face);
    border: 1px solid color-mix(in srgb, var(--alert-tone) 35%, transparent);
    border-radius: var(--radius-sm);
  }

  .alert.tip {
    --alert-tone: var(--ok);
    --alert-face: color-mix(in srgb, var(--ok) 12%, transparent);
  }

  .alert.important {
    --alert-tone: var(--accent);
    --alert-face: var(--accent-soft);
  }

  .alert.warning {
    --alert-tone: var(--warn);
    --alert-face: var(--warn-soft);
  }

  .alert.caution {
    --alert-tone: var(--err);
    --alert-face: var(--err-soft);
  }

  .alert-head {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    font-weight: var(--fw-semibold);
    color: var(--alert-tone);
  }

  .md-list {
    padding-left: var(--space-5);
  }

  .md-list li.task {
    list-style: none;
  }

  .task input {
    /* 입력 요소는 브라우저가 글자 크기를 따로 준다(≈13.3px) — 물려받아야 `em` 이 본문 글자 기준이 된다 */
    font-size: inherit;
    --checkbox-size: 0.86em;
    margin: 0 var(--space-1) 0 calc(-1 * var(--space-4));
    vertical-align: -0.04em;
    border-radius: 4px;
  }

  .task input.live:not(:disabled) {
    cursor: pointer;
  }

  hr {
    border: none;
    border-top: 1px solid var(--line);
  }

  del {
    color: var(--fg-2);
  }

  .fnref {
    margin-left: 1px;
    font-size: 0.75em;
    line-height: 0;
    color: var(--fg-2);
  }

  .fnref.live,
  .fnback {
    color: var(--accent);
    cursor: pointer;
  }

  .fns {
    font-size: 0.92em;
    color: var(--fg-2);
  }

  .fns > hr {
    margin: 0 0 var(--space-2);
  }

  .fns > .md-list {
    margin: 0;
  }

  .fnback {
    margin-left: 0.3em;
    user-select: none;
  }

  .fnback sup {
    font-size: 0.75em;
    line-height: 0;
  }

  .ic {
    padding: 0 3px;
    font-family: var(--font-mono);
    font-size: 0.92em;
    background: var(--surface-hover);
    border-radius: 4px;
    overflow-wrap: anywhere;
  }

  .ic.path {
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .ic.path:hover {
    text-decoration-color: var(--accent);
  }

  [data-path-link]:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
    border-radius: 2px;
  }

  .link.live {
    color: var(--accent);
    text-decoration: underline;
    text-decoration-color: color-mix(in srgb, var(--accent) 45%, transparent);
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .link.live:hover {
    text-decoration-color: var(--accent);
  }

  .src-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 22ch;
    margin: 0 0.1em 0 0.35em;
    padding: 0 6px 0 7px;
    font: inherit;
    font-size: 0.78em;
    /* 강조 안쪽에 서도 칩 글자는 여느 모양 */
    font-weight: 400;
    font-style: normal;
    text-decoration: none;
    line-height: 1.55;
    vertical-align: 0.08em;
    color: var(--fg-2);
    background: var(--control-ghost-hover);
    border: 1px solid var(--m3-outline-variant, var(--line));
    border-radius: 999px;
    cursor: pointer;
  }

  .src-chip.solo {
    margin-left: 0.1em;
  }

  .src-chip:hover,
  .src-chip:focus-visible {
    color: var(--on-accent-soft);
    background: var(--glass-pick, var(--accent-soft));
    border-color: transparent;
  }

  .src-chip:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .src-host {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .img {
    color: var(--fg-2);
    font-style: italic;
  }

  .img.loading {
    color: var(--fg-3);
  }

  .md-img {
    max-width: 100%;
    height: auto;
    vertical-align: middle;
  }

  .link-img {
    display: block;
    margin-top: var(--space-1);
  }

  .pre {
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    /* 문서 타일의 글자 크기 배율(`DocView` 의 `--doc-zoom`) — 다른 화면에는 변수가 없어 1 */
    font-size: calc(var(--t-xs) * var(--doc-zoom, 1));
    line-height: 1.5;
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    overflow-x: auto;
    white-space: pre;
  }

  .fm {
    font-size: 0.92em;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .fm > summary {
    padding: var(--space-1) var(--space-2);
    color: var(--fg-2);
    cursor: pointer;
    user-select: none;
  }

  .fm[open] > summary {
    border-bottom: 1px solid var(--line);
  }

  .fm > .tbl,
  .fm > .pre {
    margin: var(--space-2);
  }

  .fm-table th {
    font-family: var(--font-mono);
    font-weight: var(--fw-regular);
    color: var(--fg-2);
    white-space: nowrap;
  }

  .tbl {
    max-width: 100%;
    overflow-x: auto;
  }

  table {
    border-collapse: collapse;
    font-size: 0.95em;
  }

  th,
  td {
    padding: var(--space-1) var(--space-2);
    border: 1px solid var(--line);
    text-align: left;
    vertical-align: top;
  }

  th {
    font-weight: var(--fw-semibold);
    background: var(--surface-hover);
  }
</style>
