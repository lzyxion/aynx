<script lang="ts">
  /**
   * **마크다운 블록 그리기** — `$lib/markdown` 이 나눈 블록·토막을 글자 보간(`{text}`)으로만 그린다. `{@html}` 없음.
   * 예외 둘 — 둘 다 문서 글이 아니라 그리기 엔진이 짠 출력이고, 넣는 곳은 각 컴포넌트의 `innerHTML` 한 곳뿐이다:
   * 1. `diagrams` 일 때 ```mermaid 블록은 `MermaidView` 가 mermaid 의 `securityLevel: "strict"` 출력(내장 DOMPurify 를
   *    지난 SVG)을 그대로 넣는다 — 근거는 `MermaidView` 머리말.
   * 2. 수식 토막 · 블록(`math` 선택으로 파싱한 글에만 생긴다 — 문서 보기 타일)은 `MathView` 가 KaTeX `renderToString`
   *    (`trust: false` · 크기 · 매크로 상한)의 HTML 을 그대로 넣는다 — 근거는 `MathView` 머리말.
   * ```svg 블록(`diagrams` 일 때 — `SvgView`)은 예외가 아니다: `Blob` → `blob:` 주소를 `<img>` 에만 준다(HTML 을 넣지 않는다 —
   * `<img>` 문맥에서는 스크립트 · 바깥 자원이 돌지 않는다).
   * 기록 보기(에이전트 말)와 문서 보기 타일(`.md`)이 같이 쓴다.
   *
   * - 굵게 · 기울임 · 취소선은 안쪽 토막(`inlines` — 링크 · 코드 · 중첩 강조 · 그림 · 수식)이 있으면 그것을 그 태그 안에서
   *   같은 `inl` 로 그린다(굵은 링크 = `<strong>` 안의 여느 링크 모양) · 없으면 평문 `text`.
   * - 코드 블록은 `CodeView`(판 있음) — 펜스의 언어로 강조, 모르면 평문. `diagrams` 를 받았으면 ```mermaid 는
   *   다이어그램(`MermaidView`) — 문서 보기 타일 · 사이드 채팅의 대화 면(2026-10-23 — `TranscriptBody` 의 `diagrams`)이 켠다
   *   (기록 보기 시트 · 타일 대화 면 · 명령 블록은 원문 그대로). 같은 `diagrams` 에서 ```svg 는 그림(`SvgView` — `<img>` 하나 ·
   *   512 KB 상한 · 못 그리면 원문, 2026-10-24). `codeActions` 를 받았으면(문서 타일만) 그림이 아닌 코드 블록은 머리 띠(언어가 있을 때만 —
   *   없으면 떠 있는 단추) + [복사] · [터미널에 넣기](`DocCodeBlock` — 블록 하나 = 뿌리 요소 하나 그대로)다.
   * - 링크는 글자 + (글자와 다르면) 흐린 주소. 배지 링크(`[![alt](img)](url)`)는 대체 글자만 — 주소는 툴팁(`linkUrlTail`). `onlink` 를 받았고 주소가 `http`/`https` 일 때만 **Ctrl(⌘)+클릭**
   *   으로 연다(터미널 OSC 8 과 같은 규칙 — 그 판정은 `isWebUrl` 하나). `onlink` 가 없으면 그냥 글자다.
   *   대화 면(`TranscriptBody` — 사이드 채팅 · 타일 대화 면 · 기록 보기, 2026-10-25 사용자 결정)은 `linkClick="plain"` 으로 **그냥 클릭**에
   *   열고, `linkStyle="chip"` 으로 **키워드 링크 + 그 자리 출처 칩**으로 그린다(판정은 `md-source-chips.ts`): 링크 글자는
   *   제자리에서 링크(강조색 밑줄)이고 칩을 만들지 않는다(그 링크가 여는 자리 — 2026-11-01 (나)안).
   *   **출처 이름표**(괄호 묶음 `([공식 문서](url))` — 줄 중간이어도, 또는 문장 끝 `.` `?` `!` `。` `…` 뒤 · 블록 맨 앞에 혼자 선 링크
   *   묶음으로 뒤가 블록 끝이나 줄바꿈인 것)는 **모델이 단 그 자리에서** 사이트 이름(`linkHost`)과 ↗ 를 단 알약 칩이 된다
   *   (2026-11-01 — 출처 칩은 모델이 단 자리 그대로 · 블록 끝 모음은 걷었다 · `placeSourceChips`). 괄호는 지우고 칩만 — 묶음 안 같은 주소
   *   연달음은 칩 하나 · 툴팁은 이름표 글자 + 주소. 굵게 · 기울임 · 취소선 안쪽은 괄호 묶음만 칩이 된다.
   *   `:` 뒤(`라벨: [A](u) · [B](u)`) · 링크뿐인 블록 · 표 칸(키워드 링크만)은 바꾸지 않는다.
   *   글자가 곧 주소나 사이트 이름이면 그 자리에 칩 하나. 칩 대상은 `onlink` 가 있고
   *   `http`/`https` 인 여느 링크만이다 — 배지 링크 · 그림 링크(`linkImages`) · 그 밖의 주소는 예전 그대로(꼬리는 걷힌다).
   *   글을 끌어 고르다 링크 위에서 놓은 클릭은 열지 않는다(`selecting`).
   * - **문서 링크**(`#절` · 스킴 없는 경로 — `classifyDocHref`)는 `ondoclink` 를 받았을 때만 산다(문서 보기 타일).
   *   같은 Ctrl+클릭이고 같은 모양이다. 주소는 적힌 그대로 올린다 — 푸는 일은 받는 쪽 몫.
   * - 제목에는 GitHub 식 앵커 이름을 `data-slug` 로 단다(`headingSlugs` — 같은 이름은 `-1` · `-2`). `id` 가 아닌
   *   까닭: 한 창에 문서 타일이 여럿이면 id 가 겹친다. 찾는 쪽은 자기 상자 안에서 이 속성으로 찾는다.
   * - 그림은 `images` 를 받았을 때만 불러온다(문서 보기 타일 — 문서와 같은 백엔드의 상대 · 절대 경로만 · 사이드 채팅의 에이전트 말 —
   *   로컬의 채팅 폴더 기준(2026-10-24 — `TranscriptBody` 의 `images`), 판정은 `doc-images.ts`).
   *   `<img>` 의 주소는 받는 쪽이 만든 `blob:` 뿐이다. 불러오는 동안 · 못 불러왔으면(바깥 주소 · 형식 · 너무 큼 · 없음 · 끊김)
   *   `[그림: alt]` 글자이고 까닭이 툴팁이다. 없으면(기록 보기 등) 언제나 그 글자다. 배지 링크는 어느 쪽이든 대체 글자다.
   * - 체크박스(`- [ ]`)는 `tasks` 를 받았을 때만 누를 수 있다(문서 보기 타일 — 파일 · 편집기 글에 되쓴다). 누르면 화면의
   *   체크를 바로 바꾸지 않고(`preventDefault`) 받는 쪽에 원문 줄과 누르기 전 상태만 올린다 — 쓰기가 성공해 글이 다시
   *   파싱되면 그때 바뀐다. 없으면 지금처럼 `disabled`(기록 보기 등).
   * - GitHub 알림(`> [!NOTE]` …)은 머리 줄(그림 + 종류 이름) + 본문의 옅은 상자다. 왼쪽 굵은 띠는 두지 않는다 —
   *   종류는 옅은 면 · 얇은 테두리 · 머리 줄 그림의 색이 말한다(색 짝은 아래 `.alert` 주석).
   * - 머리말(`frontmatter` 블록 — 문서 보기 타일이 파싱할 때만 생긴다)은 본문 맨 위 작은 접힘 상자(기본 접힘 · "머리말 ·
   *   N개 항목"). 펼치면 단순 `키: 값` 은 2열 표, 그 밖은 고정폭 원문. 접혀 있으면 안쪽을 **그리지 않는다** — 문서 안
   *   검색이 보이지 않는 글자를 세지 않고, 펼치면 DOM 이 바뀌어 검색이 다시 찾는다.
   * - 각주(`[^id]`)는 위첨자 번호(포인터를 얹으면 각주 글이 평문 툴팁)이고, 글 끝에 가로줄 + 번호 목록의 각주 구역이 선다.
   *   `onjump`(받는 쪽의 스크롤 상자를 미는 손잡이)를 받았을 때만 오간다 — 위첨자를 누르면 그 각주로, 항목 끝 ↩ 를 누르면
   *   그 참조 자리로. 링크와 달리 **그냥 클릭**이다: 링크의 Ctrl+클릭은 누르면 무엇이 열리는(바깥 브라우저 · 다른 타일)
   *   일을 글 고르다 잘못 누른 클릭에서 지키려는 것인데, 각주 오가기는 같은 문서 안의 스크롤뿐이라 잘못 눌러도 잃는 것이
   *   없다(GitHub 도 그냥 클릭). 찾는 것은 `id` 가 아니라 `data-fn` · `data-fn-ref` 속성이다(`data-slug` 와 같은 까닭 —
   *   한 창에 문서 타일이 여럿이면 id 가 겹친다). `onjump` 가 없으면(기록 보기) 위첨자는 툴팁만, ↩ 는 서지 않는다.
   * - `compact` — 제목을 본문 크기(굵게만)로. 기록 보기처럼 좁은 면에서 말 한 덩어리를 읽을 때.
   * - 그린 그림(`md-img` · 링크 그림 · ```svg)의 **우클릭 메뉴**(`ImageMenu` — 다운로드 · 다른 이름으로 저장 · 이미지 복사 · 링크/SVG 코드
   *   복사, 2026-10-24). 파일 그림은 `images.source` 가 원본을 알려 줄 때만 선다. 판정 · 일은 `image-menu.ts` · `image-actions.ts`.
   */
  import CodeView from "$lib/CodeView.svelte";
  import DocCodeBlock from "$lib/DocCodeBlock.svelte";
  import MermaidView from "$lib/MermaidView.svelte";
  import SvgView from "$lib/SvgView.svelte";
  import MathView from "$lib/MathView.svelte";
  import { isMermaidLang } from "$lib/mermaid-text";
  import { isSvgLang } from "$lib/svg-text";
  import UiIcon from "$lib/UiIcon.svelte";
  import { isWebUrl, linkHost, linkUrlTail, type MdAlertType, type MdBlock, type MdInline, type MdListItem } from "$lib/markdown";
  import { classifyDocHref, headingSlugs, inlineText } from "$lib/doc-links";
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
  }: {
    blocks: MdBlock[];
    /** 링크 열기 — 주소는 이미 `isWebUrl` 을 통과했다. 없으면 링크는 글자일 뿐이다 */
    onlink?: (href: string) => void;
    /** 문서 링크(`#절` · 경로) 열기 — 주소는 적힌 그대로. 없으면 그런 링크는 글자일 뿐이다 */
    ondoclink?: (href: string) => void;
    /** 제목 크기를 본문과 같게 */
    compact?: boolean;
    /** ```mermaid 블록을 다이어그램으로 · ```svg 블록을 그림으로 그린다(문서 보기 타일 · 사이드 채팅). 끄면 다른 코드 블록과 같다 */
    diagrams?: boolean;
    /**
     * 체크박스를 누를 수 있게 한다(문서 보기 타일). `blocked` 가 있으면 막힌 채 그 까닭이 툴팁이고, `busy` 의 줄은 쓰는
     * 동안 잠깐 막힌다. `ontoggle` 은 원문 줄(`MdListItem.line`)과 **누르기 전** 상태를 받는다. 없으면 체크박스는 글자 같은 그림
     */
    tasks?: {
      title: string;
      blocked: string | null;
      busy: ReadonlySet<number>;
      ontoggle: (line: number, wasChecked: boolean) => void;
    };
    /** 그림 불러오기(문서 보기 타일 · 사이드 채팅) — 주소마다 지금 상태 · `<img>` 가 못 그렸을 때 알림. 없으면 그림은 대체 글자뿐 */
    images?: {
      state(src: string): DocImageState;
      broken(src: string): void;
      /** 그림 우클릭 메뉴가 쓸 원본(`DocImageCache.source`) — 없으면 그 그림에는 메뉴가 서지 않는다 */
      source?(src: string): { path: string; mime: string; read: () => Promise<ArrayBuffer> } | null;
    };
    /** 그림 파일을 가리키는 여느 링크(`[열기](a.svg)`)도 링크 밑에 그림을 붙인다(사이드 채팅 — `images` 가 있을 때만 · 못 불러오면 링크만) */
    linkImages?: boolean;
    /** 링크를 여는 클릭 — `ctrl`(기본 · Ctrl(⌘)+클릭 — 문서 보기 타일) · `plain`(그냥 클릭 — 대화 면) */
    linkClick?: "ctrl" | "plain";
    /**
     * 웹 링크의 모양 — `inline`(기본 · 강조색 밑줄 글자 + 글자와 다르면 흐린 주소 — 문서 보기 타일) ·
     * `chip`(키워드 링크 + 블록 끝 사이트 이름 알약 칩 — 대화 면, 이 파일 머리말)
     */
    linkStyle?: "inline" | "chip";
    /**
     * 같은 문서 안의 그 자리로 가기(각주 ↔ 참조) — 받는 쪽이 **자기 스크롤 상자만** 민다(`scrollIntoView` 는 조상 상자까지
     * 밀어 타일 배치를 흔든다). 없으면 각주는 오가지 않는다
     */
    onjump?: (el: HTMLElement) => void;
    /**
     * 코드 블록의 머리 띠 — [복사] · (셸 계열 언어면) [터미널에 넣기](`DocCodeBlock` · 문서 타일만). `onterm` 은 블록 글과 누른 단추를
     * 받는다. 없으면 코드 블록은 예전 그대로(`CodeView` 판 + 떠 있는 복사 단추). 그림으로 그리는 블록(mermaid · svg · math)에는 서지 않는다
     */
    codeActions?: { onterm: (code: string, button: HTMLElement) => void };
  } = $props();

  /** ```math 펜스 — 수식 블록이다(파서가 `math` 로 나누지 않은 글에서도 머리 띠를 세우지 않는다) */
  const isMathFence = (lang: string | undefined) => (lang ?? "").trim().toLowerCase() === "math";

  /** 각주 번호 → 위첨자 툴팁(각주 글의 평문). 각주 구역은 늘 최상위 맨 끝 블록이다 */
  const fnTips = $derived.by(() => {
    const out = new Map<number, string>();
    const last = blocks[blocks.length - 1];
    if (last?.kind === "footnotes") for (const it of last.items) out.set(it.n, inlineText(it.inlines).trim());
    return out;
  });

  let rootEl = $state<HTMLDivElement | null>(null);

  /** 각주 오가기 — 눌린 것이 위첨자(`data-fn-ref`)나 ↩(`data-fn-back`)면 처리하고 `true` */
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

  /** 머리말 상자를 펼쳤는가 — 글이 다시 파싱돼도(자동 새로고침 · 편집 미리 보기) 그대로 */
  let fmOpen = $state(false);

  /** 이 항목의 체크박스를 지금 누를 수 있는가 */
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
  const live = (href: string) => (!!onlink && isWebUrl(href)) || (!!ondoclink && isDocLink(href));

  /** 제목 → 앵커 이름 (문서 순서로 겹침을 가른다) */
  const slugs = $derived(headingSlugs(blocks));

  /** 한 곳에서 받는다 — 링크마다 손잡이를 달지 않는다 */
  function onclick(ev: MouseEvent) {
    // 각주는 그냥 클릭 — 같은 문서 안 스크롤뿐이다(근거는 이 파일 머리 주석의 각주 항목)
    if (footnoteClick(ev)) return;
    if (linkClick === "ctrl" && !(ev.ctrlKey || ev.metaKey)) return;
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

  /** 이 링크에 걸친 글 고르기가 있는가 — 끌어 고르다 링크 위에서 놓은 클릭은 여는 클릭이 아니다(그냥 클릭 모드만) */
  function selecting(el: Element): boolean {
    const sel = window.getSelection();
    return !!sel && !sel.isCollapsed && sel.containsNode(el, true);
  }

  const linkTitle = (href: string) =>
    !live(href)
      ? href
      : linkClick === "plain"
        ? t("files.doc.md.link.openPlain", { href })
        : t("files.doc.md.link.open", { href });

  /** 출처 칩으로 그릴 링크인가 — 배지 · 그림 링크 · 열 수 없는 주소는 예전 모양 */
  const chipLink = (s: { href: string; image?: true }) =>
    linkStyle === "chip" && !s.image && !!onlink && isWebUrl(s.href) && !(linkImages && images && isImageLinkHref(s.href));
  /** 그 자리 출처 칩의 툴팁 — 이름표 글자(들) + 주소 */
  const sourceTitle = (s: { text: string; href: string }) =>
    s.text ? t("files.doc.md.link.source", { text: s.text, href: s.href }) : linkTitle(s.href);

  const level = (n: number) => Math.min(6, Math.max(1, n));

  /**
   * 그림 우클릭 메뉴 — 세울 항목 · 자리 · 항목을 받는 손잡이. 손잡이는 **여는 순간 평범한 지역 값으로 묶어 둔다** — 메뉴가 닫힌 뒤
   * 불리므로 이 상태(닫으면 `null`)를 거기서 읽으면 안 된다(docs/conventions.md 의 "메뉴를 닫는 코드")
   */
  let imgMenu = $state<{ kind: ImageTarget["kind"]; x: number; y: number; run: (a: ImageMenuAction) => void } | null>(null);
  const closeImgMenu = () => (imgMenu = null);

  function openImgMenu(ev: MouseEvent, target: ImageTarget, el: HTMLImageElement) {
    ev.preventDefault(); // 앱 메뉴 — 창 전역의 네이티브 메뉴 막기(`shouldBlockNativeContextMenu`)가 비켜 선다
    ev.stopPropagation();
    imgMenu = { kind: target.kind, x: ev.clientX, y: ev.clientY, run: (a) => runImageAction(a, target, el) };
  }

  /** 문서 그림(`md-img` · 링크 그림)의 우클릭 — 원본을 아는 그림만(`images.source`). ```svg 는 `SvgView` 가 `onmenu` 로 올린다 */
  function oncontextmenu(ev: MouseEvent) {
    const el = ev.target instanceof HTMLImageElement && ev.target.matches("img.md-img[data-img-src]") ? ev.target : null;
    const src = el?.getAttribute("data-img-src");
    const source = src ? images?.source?.(src) : null;
    if (!el || !source) return;
    openImgMenu(ev, { kind: "file", ...source }, el);
  }

  /** 알림 종류 → 머리 줄 그림 · 이름 */
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

<!-- 인라인 — 한 줄로 적는다(글자 칸이 pre-wrap 이라 태그 사이 공백이 그대로 보인다) -->
{#snippet inl(xs: MdInline[])}{#each xs as s, si (si)}{#if s.kind === "code"}<code class="ic">{s.text}</code
    >{:else if s.kind === "strong"}<strong>{#if s.inlines}{@render inl(s.inlines)}{:else}{s.text}{/if}</strong
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
      >{:else if s.kind === "link"}<span
        class="link"
        class:live={live(s.href)}
        data-href={live(s.href) ? s.href : undefined}
        title={linkTitle(s.href)}
        >{s.image ? s.text || t("files.doc.md.image", { alt: "" }) : s.text}</span
      >{#if linkStyle === "inline" && linkUrlTail(s) !== null}<span class="url">({s.href})</span>{/if}{#if linkImages && images && !s.image && isImageLinkHref(s.href)}{@const lim = images.state(s.href)}{#if lim.status === "ok"}<img
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
      >{:else if s.kind === "math"}<MathView tex={s.text} />{:else}{s.text}{/if}{/each}{/snippet}

<!-- 블록 인라인 — 대화 면은 출처 이름표를 그 자리 칩으로(머리말). 표 칸은 `inl` 만 부른다. 한 줄로 적는다(pre-wrap) -->
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
      <!-- 각주 구역 — 가로줄 + 번호 목록. ↩ 는 오갈 손잡이가 있을 때만(글자가 아니라 검색이 세지 않게 aria-hidden) -->
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

<!-- 클릭은 링크 여는 손잡이 하나뿐(Ctrl+클릭) — 키보드로 여는 길은 두지 않는다(링크는 초점을 받지 않는 글자) -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="md" class:compact {onclick} {oncontextmenu} bind:this={rootEl} data-markdown>{@render blockList(blocks)}</div>

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

  /* 표 칸은 낱말(한글 어절 포함) 안에서 끊지 않는다 — `anywhere` 는 칸의 최소 폭을 한 글자로 만들어 좁은 칸이 한 글자씩 세로로
     감겼다(실기 10-31 프로듀서 채팅의 "검/토" 열). 넘치는 긴 낱말은 그래도 끊기고, 표가 넓으면 `.tbl` 이 가로로 굴린다 */
  td,
  th {
    overflow-wrap: break-word;
    word-break: keep-all;
  }

  /* 제목 — 굵게 + 수준별 크기(글자 크기 토큰의 비율). compact 는 본문 크기 */
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

  /*
   * 알림 — 옅은 면 + 얇은 테두리 + 머리 줄 그림 색. 왼쪽 굵은 띠는 두지 않는다(사용자 취향 — 목차 지금 절도 같은 까닭으로
   * 걷었다). 색은 앱 토큰만 쓴다 — 앱에 파랑 · 보라 계열 토큰이 없어 GitHub 의 다섯 빛깔을 **뜻**으로 옮겼다:
   * - NOTE(참고) = 무채 — 가장 약한 알림이라 본문 면(`--surface-hover`)과 흐린 그림(`--fg-2`). GitHub 의 파랑은 "정보" 라는
   *   뜻일 뿐이고, 앱의 강조색은 IMPORTANT 가 써야 둘이 갈린다.
   * - TIP(팁) = `--ok` — 초록은 GitHub 와 같다. `--ok-soft` 가 없어 실행 기록(`ExecList`)처럼 `color-mix` 로 옅게 뽑는다.
   * - IMPORTANT(중요) = `--accent` / `--accent-soft` — 앱이 "눈여겨볼 것" 에 쓰는 색(GitHub 의 보라 자리).
   * - WARNING(경고) = `--warn` / `--warn-soft` — 대기 배너와 같은 앰버.
   * - CAUTION(주의) = `--err` / `--err-soft` — 실패 배너와 같은 빨강.
   * 테두리는 그 색을 옅게 섞어 면보다 한 단계만 진하다. 본문 글자색은 그대로(`--fg-1`) — 색은 머리 줄만 입는다.
   */
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
    margin: 0 var(--space-1) 0 calc(-1 * var(--space-4));
    vertical-align: -2px;
    accent-color: var(--accent);
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

  /* 각주 — 위첨자 번호는 줄 높이를 밀지 않게. 오갈 수 있으면 링크와 같은 강조색 */
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

  /*
   * 출처 칩(대화 면 — 이 파일 머리말) — 글줄 안의 작은 알약. 줄 높이를 밀지 않게 글자보다 작고(0.78em) 위아래 여백을 줄였다.
   * 면은 상태 층(`--control-ghost-hover` — 글래스에서도 비친다) + outlineVariant 테두리, 호버 · 포커스는 secondaryContainer
   * (`--accent-soft` · 글래스면 `--glass-pick`).
   */
  .src-chip {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    max-width: 22ch;
    margin: 0 0.1em 0 0.35em;
    padding: 0 6px 0 7px;
    font: inherit;
    font-size: 0.78em;
    /* 굵게 · 기울임 · 취소선 안에 서도(괄호 출처 — 강조 안쪽) 칩 글자는 여느 모양 */
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

  .url {
    margin-left: 0.3em;
    font-size: 0.88em;
    color: var(--fg-3);
  }

  .img {
    color: var(--fg-2);
    font-style: italic;
  }

  .img.loading {
    color: var(--fg-3);
  }

  /* 문서 속 그림 — 본문 폭을 넘지 않는다. 글줄 안에서는 가운데 맞춤 */
  .md-img {
    max-width: 100%;
    height: auto;
    vertical-align: middle;
  }

  /* 링크 그림 — 링크 글자 밑에 따로 한 줄 */
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

  /* 머리말 — 본문보다 한 단계 작은 접힘 상자. 요약 줄은 흐린 글자 */
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

  /* 표 — 넓으면 가로로 민다 */
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
