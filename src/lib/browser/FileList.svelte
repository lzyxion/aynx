<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { ROW_ICON_PX } from "$lib/host-icons";
  import { isCutPath } from "$lib/fs-clipboard.svelte";
  import {
    formatMode,
    formatMtime,
    formatSize,
    glyphOf,
    isDirLike,
    type SftpEntry,
  } from "$lib/sftp-browser";
  import type { SelectionController } from "$lib/browser/selection-controller.svelte";
  import type { MarqueeController } from "$lib/browser/marquee.svelte";
  import type { DragController } from "$lib/browser/drag-controller.svelte";
  import { dropDirOf, nameMatch, type FileTreeRow } from "$lib/file-tree";
  import { extBadge } from "$lib/browser/file-view";
  import type { FileView } from "$lib/session";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **파일 목록 상자** — 줄·아이콘·선택 표시·드롭 존·내보내기 손잡이·러버밴드·스켈레톤.
   *
   * 이 상자는 셋을 겸한다: 스크롤 상자 · **러버밴드의 좌표 원점** · 지금 폴더로의
   * **드롭 대상**(빈 바닥에 놓으면 `cwd` 다). 그래서 요소 자체를 부모가 잡아야 하고
   * (`bind:el`), 마퀴·드래그 컨트롤러도 부모가 만들어 내려 준다 — 이 컴포넌트는 **그림만**
   * 그린다. 상태를 여기 두면 키보드(창 전역)와 목록(여기)이 서로 다른 선택을 보게 된다.
   *
   * **세 보기를 한 길로 그린다** (docs/log/2026-10-07-file-tile-dolphin.md) — 줄은 순수 모형
   * `fileTreeRows`(`$lib/file-tree`)가 편 것이고, 아이콘·간단히 보기는 그중 "깊이 0 · 펼침 없음" 인 판을
   * 격자로 늘어놓을 뿐이다. 그래서 선택·러버밴드·끌기·드롭·잘라내기 표시가 보기마다 갈리지 않는다 — 항목
   * 하나는 언제나 `data-path` 를 단 `.row` 하나다(러버밴드가 그것만 센다).
   *
   * - **자세히**(`details`) — 예전 트리 보기 그대로: 줄 앞 **펼침 화살표 칸**, 깊이만큼의 **들여쓰기**, **곁줄**
   *   (읽는 중 · 비어 있음 · N개 더 보기), 그리고 맨 위의 칸 머리(이름 · 크기 · 수정한 날짜 · 권한).
   * - **아이콘**(`icons`) — 왼쪽→오른쪽으로 채우는 격자. 큰 글리프 · 확장자 배지 · 두 줄 이름. 크기는 `--icon-scale`.
   * - **간단히**(`compact`) — 위→아래로 채우고 열이 옆으로 는다(가로 스크롤). 한 열의 칸 수는 목록 높이를 재어 정한다.
   */
  let {
    /** 화면에 그릴 줄 (숨김 필터·펼침·상한을 이미 지난 것) */
    rows,
    /** 목록 전체 개수 — "숨김 파일뿐입니다" 를 가르는 유일한 근거 */
    totalCount,
    selection,
    order,
    marquee,
    drag,
    backendKey,
    cwd,
    hasCwd,
    loading,
    /** 200ms 를 넘긴 읽기 — 그때만 스켈레톤을 세운다 */
    slowLoad,
    /** 줄 오른쪽 끝의 **내보내기 손잡이**를 그릴 자리인가 (드라이브 뿌리 줄은 따로 뺀다) */
    canExport,
    /** 보기 — 자세히일 때만 펼침 화살표 칸 · 들여쓰기 · 줄 위 OS 파일 드롭이 선다 */
    mode = "details",
    /** 아이콘 보기의 크기 배율 (`browser/file-view.ts` 의 `iconZoomScale`) */
    iconScale = 1,
    /** 아이콘 보기에서 `Ctrl+휠` — 한 단계 위(+)·아래(−). 크기는 부모가 패널 명세에 적는다 */
    onzoom = () => {},
    /** 이 항목이 드라이브 뿌리처럼 **만질 수 없는 줄**인가 (내보내기 손잡이) */
    isLocked = () => false,
    onopen,
    onmenu,
    /** 펼침 화살표를 눌렀다 — 펼치기/접기는 부모가 한다 (게으른 읽기가 거기 있다) */
    ontoggle = () => {},
    /** "N개 더 보기" 를 눌렀다 — 그 폴더의 한도를 늘리는 것은 부모다 */
    onmore = () => {},
    /** 필터 줄의 질의 — 비어 있지 않으면 이름의 맞는 부분을 강조하고, 맞지 않는(조상이라 남은) 줄을 흐리게 그린다 */
    filter = "",
    /** 맞는 항목의 id (`filterRows` 의 `matched`) */
    matched = new Set<string>(),
    el = $bindable(null),
  }: {
    rows: readonly FileTreeRow[];
    totalCount: number;
    selection: SelectionController;
    order: readonly string[];
    marquee: MarqueeController;
    drag: DragController;
    backendKey: string;
    cwd: string;
    hasCwd: boolean;
    loading: boolean;
    slowLoad: boolean;
    canExport: boolean;
    mode?: FileView;
    iconScale?: number;
    onzoom?: (delta: number) => void;
    isLocked?: (path: string) => boolean;
    onopen: (entry: SftpEntry) => void;
    onmenu: (ev: MouseEvent, entry: SftpEntry) => void;
    ontoggle?: (row: Extract<FileTreeRow, { kind: "entry" }>) => void;
    onmore?: (parent: string) => void;
    filter?: string;
    matched?: ReadonlySet<string>;
    el?: HTMLDivElement | null;
  } = $props();

  /** 거르는 중인가 — 빈 목록의 문구가 "맞는 항목이 없습니다" 가 되고, 이름에 강조가 선다 */
  const filtering = $derived(filter.trim() !== "");

  /** 자세히 보기인가 — 예전 "트리 보기" 의 몫(펼침 · 들여쓰기 · 곁줄)이 전부 여기에 걸린다 */
  const tree = $derived(mode === "details");

  /**
   * 간단히 보기의 **한 열 칸 수** — 목록 상자의 높이 ÷ 한 칸의 높이. 상자 크기가 바뀌면(타일을 끌어 키움 · 필터 줄이
   * 열림) 다시 잰다. 칸 높이는 줄 토큰(`--row-*`)이 정하므로 그려진 첫 칸에서 읽는다(없으면 줄 토큰 언저리의 값).
   */
  let compactRows = $state(12);
  $effect(() => {
    const list = el;
    if (mode !== "compact" || !list) return;
    void rows.length; // 첫 칸이 생기는 순간 다시 잰다(빈 목록에서 시작했을 때)
    const measure = () => {
      const item = list.querySelector<HTMLElement>(".row");
      const h = item?.getBoundingClientRect().height || 22;
      const cs = getComputedStyle(list);
      const avail = list.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
      compactRows = Math.max(1, Math.floor(avail / h));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(list);
    return () => ro.disconnect();
  });

  /**
   * **`Ctrl+휠` = 아이콘 크기** (아이콘 보기에서만). `passive: false` 로 직접 거는 이유: 기본 동작(스크롤)을 끊어야
   * 하고, 속성 이벤트(`onwheel`)는 수동(passive)으로 붙을 수 있다. 다른 보기의 `Ctrl+휠` 은 손대지 않는다.
   */
  $effect(() => {
    const list = el;
    if (mode !== "icons" || !list) return;
    const onWheel = (ev: WheelEvent) => {
      if (!ev.ctrlKey || ev.deltaY === 0) return;
      ev.preventDefault();
      onzoom(ev.deltaY < 0 ? 1 : -1);
    };
    list.addEventListener("wheel", onWheel, { passive: false });
    return () => list.removeEventListener("wheel", onWheel);
  });

  /** 한 단의 들여쓰기 (px) — 호스트·프로젝트 트리와 같은 값 */
  const INDENT_PX = 16;

  /** 줄의 왼쪽 여백 — 기본 여백에 깊이만큼 더한다 (인라인 스타일 하나라 CSS 가 깊이를 몰라도 된다) */
  function indent(depth: number): string {
    return `calc(var(--row-pad-x) + ${depth * INDENT_PX}px)`;
  }

  /**
   * 줄 앞 글리프 — [`glyphOf`] 가 돌려주는 **종류**를 `UiIcon` 이름으로. 표 하나로 두는
   * 이유는 마크업에서 삼항 세 겹을 읽는 것보다 낫고, 종류가 늘 때 고칠 자리가 한 곳이기
   * 때문이다 (docs/log/2026-09-25-duotone-glyphs.md).
   */
  const GLYPH_ICON = {
    dir: "folder",
    dirlink: "folder-symlink",
    link: "file-symlink",
    file: "file",
  } as const;

  /**
   * 스켈레톤 막대 다섯 줄 — 개수만 뜻이 있고 값은 `{#each}` 의 키로만 쓴다. 다섯인 이유는
   * 목록 상자의 위쪽 한 화면을 채우기에 충분하면서, 실제로는 없는 항목을 많이 그려
   * "긴 목록이 오는 중" 이라고 넘겨짚지 않는 선이기 때문이다.
   */
  const SKELETON_ROWS = [0, 1, 2, 3, 4];
</script>

<!-- 이름 — 거르는 중이면 맞는 부분을 `<mark>` 로 강조한다(필터 줄) -->
{#snippet nameOf(name: string)}
  {@const hit = filtering ? nameMatch(name, filter) : null}
  {#if hit}{name.slice(0, hit[0])}<mark class="hit">{name.slice(hit[0], hit[1])}</mark>{name.slice(hit[1])}{:else}{name}{/if}
{/snippet}

<div
  class="list"
  class:icons={mode === "icons"}
  class:compact={mode === "compact"}
  class:drop-over={drag.dropDir === cwd && hasCwd}
  style:--icon-scale={iconScale}
  style:--compact-rows={compactRows}
  bind:this={el}
  role="presentation"
  onpointerdown={marquee.pointerdown}
  onpointermove={marquee.pointermove}
  onpointerup={marquee.pointerup}
  ondragover={(ev) => drag.dirDragOver(ev, cwd)}
  ondragleave={() => drag.dirDragLeave(cwd)}
  ondrop={(ev) => drag.applyDrop(ev, cwd)}
>
  <!--
    **읽는 중 스켈레톤** — 200ms 를 넘긴 읽기에만 뜬다 (`slowLoad`).

    "비어 있습니다" 는 `loading` 이 아닐 때만 적는다. 읽는 도중에는 아직 아무것도 모르는
    상태인데 그 문구를 세우면 **없는 사실을 단정**하게 된다. 읽는 중이면서 아직 느리지도
    않은 찰나에는 아래 `{:else}` 로 떨어져 **보고 있던 목록이 그대로** 남는다.
  -->
  {#if slowLoad}
    <div class="skel" role="status" aria-label={t("files.browser.loading.aria")}>
      {#each SKELETON_ROWS as i (i)}
        <div class="skel-row" style:width="{60 + ((i * 37) % 35)}%"></div>
      {/each}
    </div>
  {:else if rows.length === 0 && !loading}
    <p class="empty">
      {filtering
        ? t("files.filter.none", { query: filter.trim() })
        : totalCount > 0
          ? t("files.browser.empty.hiddenonly")
          : t("files.browser.empty")}
    </p>
  {:else}
    <!--
      칸 머리 — 자세히 보기에만. 줄과 **같은 격자 칸**이라(아래 `.dhead` · `.row.tree`) 좁은 타일에서 칸이 접힐 때
      머리도 같은 규칙(`@container file-list`)으로 함께 접힌다. 누르는 정렬은 없다 — 정렬은 백엔드 것 하나다.
    -->
    {#if tree}
      <div class="dhead" aria-hidden="true">
        <span></span>
        <span></span>
        <span>{t("files.col.name")}</span>
        <span class="size">{t("files.col.size")}</span>
        <span class="mtime">{t("files.col.mtime")}</span>
        <span class="mode">{t("files.col.mode")}</span>
        <span></span>
      </div>
    {/if}
    <div class="items">
    {#each rows as row (row.id)}
      {#if row.kind === "entry"}
        {@const entry = row.entry}
        {@const glyph = glyphOf(entry)}
        {@const target = dropDirOf(row)}
        {@const badge = mode === "icons" && (glyph === "file" || glyph === "link") && iconScale >= 1 ? extBadge(entry.name) : null}
        <!--
          한 줄이 네 역할을 겸한다: 선택 · 열기(더블클릭) · **드래그 핸들** · **드롭 대상**.
          폴더 줄 위에 놓으면 그 폴더가 목적지이고, 파일 줄 위에 놓으면 **그 파일이 든 폴더**다
          (`dropDirOf` — 파일 안에는 놓을 자리가 없으니 그것이 유일하게 말이 되는 뜻이다). 들어가기
          보기에서 그 폴더는 곧 지금 폴더라 예전(목록 상자가 받아 `cwd` 로)과 같은 곳에 떨어진다.

          트리 보기의 줄은 **OS 파일**(탐색기에서 끌어온 것)도 직접 받는다 — `data-inner-drop-files`
          를 보고 `PaneHost` 가 타일 전체 하이라이트를 양보한다. 빈 바닥은 여전히 타일이 받아 뿌리로 간다.
        -->
        <div
          class="row"
          class:tree
          class:icon-item={mode === "icons"}
          class:compact-item={mode === "compact"}
          class:selected={selection.has(row.id)}
          class:focused={selection.focus === row.id}
          class:dragging={drag.draggingPaths?.has(entry.path)}
          class:cut={isCutPath(backendKey, entry.path)}
          class:drop-over={drag.dropDir === entry.path}
          class:dim={filtering && !matched.has(row.id)}
          style:padding-left={tree ? indent(row.depth) : null}
          data-path={entry.path}
          data-depth={row.depth}
          data-inner-drop-files={tree ? "" : undefined}
          aria-expanded={row.expandable ? row.expanded : undefined}
          role="button"
          tabindex="-1"
          draggable={drag.canDrag(entry.path)}
          title={entry.symlinkTarget ? `${entry.path} → ${entry.symlinkTarget}` : entry.path}
          onclick={(ev) => selection.click(ev, row.id, order)}
          ondblclick={() => onopen(entry)}
          oncontextmenu={(ev) => onmenu(ev, entry)}
          onpointerdown={(ev) => drag.rowPointerDown(ev, entry)}
          ondragstart={(ev) => drag.startDrag(ev, entry)}
          ondragend={drag.cleanup}
          ondragover={(ev) => drag.dirDragOver(ev, target, tree)}
          ondragleave={() => drag.dirDragLeave(target)}
          ondrop={(ev) => drag.applyDrop(ev, target, tree)}
          onkeydown={(ev) => {
            // 줄 자체는 키를 처리하지 않는다 (창 전역의 `onKeydown` 이 주인이다). 다만
            // 포커스가 줄에 있을 때 Enter·Space 가 **클릭으로 합성되는 것**은 막아야
            // 한다 — 안 그러면 Enter 한 번에 "열기" 가 두 번 돈다.
            if (ev.key === "Enter" || ev.key === " ") ev.preventDefault();
          }}
        >
          <!--
            펼침 화살표 — 트리 보기에만 있는 칸. 폴더 줄은 화살표, 파일 줄은 같은 폭을 비워 같은
            깊이의 글리프가 세로로 맞는다(호스트 트리의 `.twisty`·`.twisty-pad` 와 같은 치수).
            클릭·더블클릭을 여기서 멈춰 줄의 선택·들어가기와 섞이지 않게 한다. 키보드 길은 →·← 다.
          -->
          {#if mode === "icons"}
            <!--
              아이콘 보기의 칸 — 큰 글리프 · (파일이면) 확장자 배지 · 두 줄까지의 이름. 글리프 크기는 `UiIcon` 의
              `size` 가 아니라 CSS(`--tile-icon-size × --icon-scale`)가 정한다 — 단계를 바꿀 때 다시 그리지 않는다.
            -->
            <span class="glyph big" class:folder-ink={glyph === "dir" || glyph === "dirlink"}>
              <UiIcon name={GLYPH_ICON[glyph]} size={36} filled={glyph === "dir"} />
            </span>
            {#if badge}<span class="badge">{badge}</span>{/if}
            <span class="name">{@render nameOf(entry.name)}</span>
          {:else}
          {#if tree}
            {#if row.expandable}
              <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
              <span
                class="twisty"
                data-file-twisty
                title={row.expanded ? t("files.tree.collapse") : t("files.tree.expand")}
                onclick={(ev) => {
                  ev.stopPropagation();
                  ontoggle(row);
                }}
                ondblclick={(ev) => ev.stopPropagation()}
                ><UiIcon name={row.expanded ? "chevron-down" : "chevron"} size={12} /></span
              >
            {:else}
              <span class="twisty-pad" aria-hidden="true"></span>
            {/if}
          {/if}
          <!--
            앞자리 글리프 — 종류만 `glyphOf` 가 정하고 그림은 여기서 고른다. **폴더와 폴더 링크**는
            `--folder` 색의 꽉 찬 그림(폴더 링크는 꺾인 화살표가 뚫린 `folder-symlink` — 들어갈 수 있으니
            폴더처럼 보인다)이고, 파일·파일 링크는 흐린 글자색의 윤곽 하나다 — 윤곽 아이콘 사이에서
            폴더가 한눈에 갈리는 것이 요점이다 (호스트 트리의 폴더와 같은 그림·같은 색 —
            docs/log/2026-09-25-duotone-glyphs.md).
          -->
          <span class="glyph" class:folder-ink={glyph === "dir" || glyph === "dirlink"}>
            <UiIcon
              name={GLYPH_ICON[glyph]}
              size={ROW_ICON_PX}
              filled={glyph === "dir"}
            />
          </span>
          <!--
            이름 칸 — 못 읽은 폴더(권한·끊긴 링크)는 이름 뒤에 **그 줄 안에서** 오류를 한 줄 적는다.
            타일 위쪽 오류 띠는 뿌리를 못 읽었을 때의 것이라, 깊은 폴더 하나의 실패를 거기 올리면
            어느 폴더 얘기인지가 흐려진다. 다시 펼치면(→ · 화살표) 다시 읽는다.
          -->
          <span class="name-cell">
            <span class="name">{@render nameOf(entry.name)}</span>
            {#if row.error}
              <span class="row-err" title={row.error}>{row.error}</span>
            {/if}
          </span>
          {#if tree}
          <span class="size">{isDirLike(entry) ? "—" : formatSize(entry.size)}</span>
          <span class="mtime">{formatMtime(entry.mtime)}</span>
          <span class="mode">{formatMode(entry.mode)}</span>
          <!--
            **내보내기 손잡이** — 잡고 그대로 끌면 탐색기로 나간다 (수식 키가 필요 없다).
            줄에 호버할 때만 보이고, 자리는 늘 잡아 둔다(칸이 있어 줄이 흔들리지 않는다).
            드라이브 뿌리 줄(트리 보기에서 "내 PC" 아래)에는 없다 — 셸에 넘길 수 없는 자리다.

            `aria-hidden` + 포커스 불가인 이유: 이것은 **몸짓의 손잡이**이지 버튼이 아니다.
            키보드로 같은 일을 하는 길은 우클릭 메뉴의 [탐색기로 내보내기…] 가 이미 갖고
            있으므로, 여기에 탭 정거장을 하나 더 세우면 목록을 훑는 탭 이동만 길어진다.
          -->
          {#if canExport && !isLocked(entry.path)}
            <span
              class="grip"
              role="presentation"
              aria-hidden="true"
              title={t("files.browser.export.grip.title")}
              onpointerdown={(ev) => drag.armExport(ev, entry, "grip")}
            >
              <UiIcon name="export" size={12} />
            </span>
          {/if}
          {/if}
          {/if}
        </div>
      {:else if row.kind === "more"}
        <!--
          **N개 더 보기** — 큰 폴더(`node_modules` 한 층)는 처음 `TREE_PAGE` 줄만 그리고 나머지를
          이 한 줄로 접는다 (가상 스크롤 대신 고른 이유는 `$lib/file-tree` 의 `TREE_PAGE` 주석).
          키보드 커서가 앉을 수 있는 유일한 곁줄이다 — Enter 가 누르기와 같다.
        -->
        <div
          class="row aux more"
          class:selected={selection.has(row.id)}
          style:padding-left={indent(row.depth)}
          data-nav-id={row.id}
          data-inner-drop-files=""
          role="button"
          tabindex="-1"
          onclick={() => onmore(row.parent)}
          onkeydown={(ev) => {
            if (ev.key === "Enter" || ev.key === " ") ev.preventDefault();
          }}
          ondragover={(ev) => drag.dirDragOver(ev, row.parent, tree)}
          ondragleave={() => drag.dirDragLeave(row.parent)}
          ondrop={(ev) => drag.applyDrop(ev, row.parent, tree)}
        >
          <span class="twisty-pad" aria-hidden="true"></span>
          <span class="aux-text">{t("files.tree.more", { count: row.hidden })}</span>
        </div>
      {:else}
        <!--
          곁줄 둘 — **읽는 중**(펼쳤는데 아직 목록이 안 왔다)과 **비어 있음**. 커서가 앉지 않는다.
          읽는 중 줄은 150ms 뒤에야 떠오른다(`.aux.loading` 의 지연 애니메이션) — 로컬·가까운 서버는
          그 안에 목록이 와서 깜빡이지 않고, 먼 서버에서만 "읽고 있다" 가 보인다.
        -->
        <div
          class="row aux"
          class:loading={row.kind === "loading"}
          style:padding-left={indent(row.depth)}
          data-aux={row.kind}
          data-inner-drop-files=""
          role="presentation"
          ondragover={(ev) => drag.dirDragOver(ev, row.parent, tree)}
          ondragleave={() => drag.dirDragLeave(row.parent)}
          ondrop={(ev) => drag.applyDrop(ev, row.parent, tree)}
        >
          <span class="twisty-pad" aria-hidden="true"></span>
          <span class="aux-text"
            >{row.kind === "loading" ? t("files.tree.loading") : t("files.tree.empty")}</span
          >
        </div>
      {/if}
    {/each}
    </div>
  {/if}

  <!-- 러버밴드 — 내용 좌표계라 목록과 함께 스크롤된다 -->
  {#if marquee.box}
    {@const box = marquee.box}
    <div
      class="marquee"
      aria-hidden="true"
      style:left="{box.left}px"
      style:top="{box.top}px"
      style:width="{box.right - box.left}px"
      style:height="{box.bottom - box.top}px"
    ></div>
  {/if}
</div>

<style>
  /* `position: relative` 는 러버밴드의 좌표 원점이다 (`.marquee` 는 이 상자의 내용 좌표계에 앉는다) */
  .list {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    /* 좌우 여백은 세션 타일의 목록과 같은 토큰 — 둥근 강조가 벽에 붙지 않고, 두 타일의
       아이콘이 같은 x 에서 시작한다 */
    padding: 2px var(--row-inset);
    /* 좁은 타일에서 곁 칸을 차례로 접는 기준 (아래 `@container file-list`) */
    container: file-list / inline-size;
  }

  /* 목록의 빈 바닥에 놓으면 **지금 폴더**가 목적지다 — 안쪽 테두리 하나로만 말한다
     (배경을 칠하면 그 아래 줄들의 선택 표시와 색이 겹쳐 무엇이 골라졌는지 안 보인다) */
  .list.drop-over {
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  /*
   * 러버밴드 — 옅은 면에 또렷한 테두리 하나. 포인터 이벤트를 받지 않아야 그 아래 줄의
   * hover 와 커서가 계속 살아 있다 (사각형이 커서를 잡아먹으면 긋는 동안 화면이 죽는다).
   */
  .marquee {
    position: absolute;
    z-index: 2;
    background: var(--accent-soft);
    border: 1px solid var(--accent);
    border-radius: 2px;
    pointer-events: none;
  }

  /*
   * 한 줄 = 글리프 + 이름 + 크기 + 시각 + 권한. 이름만 늘어나고 나머지 셋은 **고정 폭**이라
   * 세로로 줄이 맞는다 — 목록을 눈으로 훑을 때 숫자가 같은 자리에 서야 비교가 된다.
   */
  .row {
    display: grid;
    /* 치수는 **세션 타일과 같은 토큰**이다 (`theme.css` 의 `--row-*`) — 두 타일을 나란히
       놓으면 같은 폴더가 같은 크기·같은 자리에서 시작해야 한다
       (docs/log/2026-09-04-icons-and-rows.md) */
    /* 마지막 14px 은 **내보내기 손잡이**의 자리다 — 손잡이가 없는 타일(원격)에도 같은
       칸을 비워 두어, 두 타일을 나란히 놓았을 때 권한 칸이 같은 자리에서 끝난다 */
    grid-template-columns: var(--row-icon) minmax(0, 1fr) 68px 92px 76px 14px;
    align-items: center;
    gap: var(--row-gap);
    padding: var(--row-pad-y) var(--row-pad-x);
    /* 둥근 강조는 세션 타일의 `.item` 과 같다 — 선택·드롭 표시가 두 타일에서 같은 모양이어야 한다 */
    border-radius: var(--radius);
    font-size: var(--row-font);
    color: var(--fg);
    cursor: default;
    user-select: none;
  }

  /* 자세히 보기 — 앞에 펼침 화살표 칸(12px)이 하나 더 선다. 들여쓰기는 줄의 `padding-left`(인라인)라
     오른쪽 고정 칸(크기·시각·권한)은 깊이와 상관없이 같은 자리에 선다 — 이름 칸만 줄어든다.
     칸 머리(`.dhead`)도 같은 격자다 — 머리 글자가 그 아래 값과 같은 x 에 선다 */
  .row.tree,
  .dhead {
    grid-template-columns: 12px var(--row-icon) minmax(0, 1fr) 68px 92px 76px 14px;
  }

  .dhead {
    display: grid;
    align-items: center;
    gap: var(--row-gap);
    padding: var(--row-pad-y) var(--row-pad-x);
    margin-bottom: 2px;
    font-size: 11px;
    color: var(--fg-muted);
    border-bottom: 1px solid var(--line);
    user-select: none;
  }

  .dhead .size {
    text-align: right;
  }

  /* ── 아이콘 보기 — 왼쪽→오른쪽으로 채우는 격자. 칸 폭·글리프는 토큰 × 크기 배율(`--icon-scale`) ── */
  .list.icons .items {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(calc(var(--tile-icon-cell) * var(--icon-scale)), 1fr));
    gap: var(--space-1);
    align-content: start;
  }

  .row.icon-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    padding: var(--space-2) var(--space-1) 6px;
    text-align: center;
  }

  .glyph.big :global(svg) {
    width: calc(var(--tile-icon-size) * var(--icon-scale));
    height: calc(var(--tile-icon-size) * var(--icon-scale));
  }

  /* 확장자 배지 — 글리프 바로 밑에 작게. 같은 그림의 파일들이 종류로 갈린다 */
  .badge {
    margin-top: -2px;
    font-family: var(--font-mono);
    font-size: 9px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: var(--fg-muted);
  }

  /* 이름은 두 줄까지 — 넘치면 말줄임. 긴 이름은 어디서든 끊는다(파일 이름에는 띄어쓰기가 드물다) */
  .row.icon-item .name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    -webkit-box-orient: vertical;
    white-space: normal;
    word-break: break-all;
    line-height: 1.3;
  }

  /* ── 간단히 보기 — 위→아래로 채우고 열이 옆으로 는다. 한 열의 칸 수(`--compact-rows`)는 높이를 재어 정한다 ── */
  .list.compact {
    overflow-x: auto;
    overflow-y: hidden;
  }

  .list.compact .items {
    display: grid;
    grid-auto-flow: column;
    grid-template-rows: repeat(var(--compact-rows), auto);
    grid-auto-columns: minmax(var(--compact-col-min), var(--compact-col-max));
    column-gap: var(--space-2);
    align-content: start;
    justify-content: start;
  }

  .row.compact-item {
    grid-template-columns: var(--row-icon) minmax(0, 1fr);
  }

  .row:hover {
    background: var(--bg-hover);
  }

  /*
   * 골라진 것은 배경으로 말한다 (docs/log/2026-09-04-hosts-multiselect.md 의 규칙 그대로).
   * 커서(포커스)에는 따로 표시를 두지 않는다 — 세션 타일의 `.item` 과 같이, 예전의 왼쪽
   * 세로 띠는 선택 배경과 겹쳐 읽혀 지웠다.
   */
  .row.selected {
    background: var(--accent-soft);
  }

  /* 끌고 가는 동안의 표준 피드백 — 원본은 자리에 남되 "지금 들려 있다" 는 인상만 준다 */
  .row.dragging {
    opacity: 0.45;
  }

  /* 잘라내기로 담긴 것 — "곧 여기서 사라진다" 는 예고. 복사는 원본이 그대로라 표시하지 않는다 */
  .row.cut {
    opacity: 0.5;
  }

  /* 거르는 중 — 맞지 않는데 남은 줄(맞는 것의 조상 폴더)은 흐리게 */
  .row.dim {
    opacity: 0.55;
  }

  /* 거르는 중 — 이름에서 맞는 부분 */
  .hit {
    color: inherit;
    background: color-mix(in srgb, var(--accent) 35%, transparent);
    border-radius: 2px;
  }

  /* 이 폴더 줄이 지금 드롭 목적지다 */
  .row.drop-over {
    background: var(--accent-soft);
    box-shadow: inset 0 0 0 1px var(--accent);
  }

  /*
   * 파일·링크 글리프는 **흐린 글자색**(`--fg-3`)의 선이다 — 이름이 주인공이고 앞자리는 종류만
   * 말한다. 골라진 줄(`--accent-soft` 판)에서는 한 단 진하게(`--fg-2`) 올려 판 위에서 흐려지지
   * 않게 한다. 호버는 배경만 바꾸는 줄이라 글리프도 그대로 둔다.
   */
  .glyph {
    display: flex;
    align-items: center;
    justify-content: center;
    line-height: 1;
    color: var(--fg-3);
  }

  .row.selected .glyph {
    color: var(--fg-2);
  }

  /*
   * 폴더 글리프의 **잉크 색** — 호스트 트리의 폴더(`HostIcon` 의 `.folder`)와 한 벌이다.
   * `UiIcon` 은 어느 그림이든 `currentColor` 라 색을 바꾸는 자리는 감싸는 요소 하나뿐이다.
   * 골라진 줄에서도 폴더 색 그대로다 (위 `.row.selected .glyph` 보다 뒤·같은 특이도로 이긴다).
   */
  .glyph.folder-ink,
  .row.selected .glyph.folder-ink {
    color: var(--folder);
  }

  /* 이름 + (못 읽은 폴더면) 오류 한 줄 — 이름이 먼저 줄고 오류는 그 뒤에서 말줄임 */
  .name-cell {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
  }

  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-err {
    flex: 0 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-size: var(--t-xs);
    color: var(--err);
  }

  /*
   * 펼침 화살표 — 호스트 트리(`HostList` 의 `.twisty`)와 같은 치수·같은 색. 누르는 자리라 줄
   * hover 와 따로 한 번 더 진해진다. 파일 줄은 같은 폭을 비워(`.twisty-pad`) 글리프가 맞는다.
   */
  .twisty,
  .twisty-pad {
    display: inline-flex;
    flex: 0 0 12px;
    align-items: center;
    justify-content: center;
    width: 12px;
    height: 16px;
  }

  .twisty {
    color: var(--fg-3);
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .twisty:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  /*
   * 곁줄(읽는 중 · 비어 있음 · 더 보기) — 격자가 아니라 한 줄 글자다. 화살표 칸을 비우고 그 뒤
   * 간격 하나에서 글자가 시작해 **아이 줄의 글리프와 같은 x** 에 선다.
   */
  .row.aux {
    display: flex;
    align-items: center;
    gap: var(--row-gap);
    color: var(--fg-3);
    font-size: var(--t-xs);
  }

  .row.aux:not(.more):hover {
    background: transparent;
  }

  .aux-text {
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 읽는 중 — 150ms 뒤에야 떠오른다 (위 마크업 주석) */
  .row.aux.loading {
    animation: aux-in 120ms ease 150ms both;
  }

  @keyframes aux-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  /* 더 보기 — 눌리는 줄이라 글자가 한 단 진하고 손 모양 커서다 */
  .row.aux.more {
    color: var(--fg-2);
    cursor: pointer;
  }

  .row.aux.more:hover {
    color: var(--fg-1);
  }

  .size,
  .mtime,
  .mode {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--fg-muted);
    white-space: nowrap;
  }

  .size {
    text-align: right;
  }

  /*
   * **좁은 타일** — 곁 칸은 고정 폭이라(합쳐 ~250px) 그대로 두면 이름 칸이 0 으로 접힌다. 목록 폭이
   * 줄면 덜 중요한 칸부터 **통째로** 뺀다: 권한 → 시각 → 크기. 이름은 늘 남는다. 480px 이상은 예전과 같다.
   * (문서 타일이 파일 타일 옆을 자주 갈라 좁은 파일 타일이 흔해졌다 — docs/log/2026-09-27-doc-tile.md)
   */
  /* 이 문턱(480)은 `pane/head-span` 의 `FILE_LIST_MODE_MIN_W` 와 같은 값이다 — 머리줄 경로 칸의 정렬도 이 순간 풀린다(시험이 소스로 묶는다) */
  @container file-list (max-width: 479px) {
    .row {
      grid-template-columns: var(--row-icon) minmax(0, 1fr) 68px 92px 14px;
    }
    .row.tree,
    .dhead {
      grid-template-columns: 12px var(--row-icon) minmax(0, 1fr) 68px 92px 14px;
    }
    .mode {
      display: none;
    }
  }

  @container file-list (max-width: 379px) {
    .row {
      grid-template-columns: var(--row-icon) minmax(0, 1fr) 68px 14px;
    }
    .row.tree,
    .dhead {
      grid-template-columns: 12px var(--row-icon) minmax(0, 1fr) 68px 14px;
    }
    .mtime {
      display: none;
    }
  }

  @container file-list (max-width: 259px) {
    .row {
      grid-template-columns: var(--row-icon) minmax(0, 1fr) 14px;
    }
    .row.tree,
    .dhead {
      grid-template-columns: 12px var(--row-icon) minmax(0, 1fr) 14px;
    }
    .size {
      display: none;
    }
  }

  /*
   * 내보내기 손잡이 — **줄에 손이 올라갔을 때만** 보인다. 늘 보이면 줄마다 아이콘이 하나씩
   * 더 붙어 목록이 시끄러워지고, 자리는 늘 비워 두므로(위 `grid-template-columns` 의 마지막
   * 칸) 나타났다 사라져도 글자가 밀리지 않는다.
   *
   * 커서는 `grab` 이다 — 누르면 무슨 일이 나는지(끌 수 있다)를 모양이 먼저 말한다.
   */
  .grip {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--fg-muted);
    cursor: grab;
    opacity: 0;
    transition: opacity 90ms ease;
  }

  .row:hover .grip {
    opacity: 1;
  }

  .grip:hover {
    color: var(--accent);
  }

  /* 손이 닿지 않는 곳에서는 **잡히지도 않아야** 한다 — 투명한 채로 눌리면 유령 손잡이가 된다 */
  .row:not(:hover) .grip {
    pointer-events: none;
  }

  .empty {
    margin: 0;
    padding: 8px 12px;
    font-size: 12px;
    color: var(--fg-muted);
  }

  /*
    읽는 중 스켈레톤 — 줄 높이·좌우 여백을 **실제 줄과 같게** 맞춘다. 목록이 도착하는
    순간 막대가 그대로 글자로 바뀐 것처럼 보여야 화면이 튀지 않는다.
  */
  .skel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: calc(var(--row-pad-y) + 4px) var(--row-inset);
  }

  .skel-row {
    height: 12px;
    border-radius: var(--radius);
    background: linear-gradient(
      90deg,
      var(--bg-hover) 0%,
      var(--border) 50%,
      var(--bg-hover) 100%
    );
    background-size: 200% 100%;
    animation: skel-sweep 1.2s linear infinite;
  }

  @keyframes skel-sweep {
    from {
      background-position: 100% 0;
    }
    to {
      background-position: -100% 0;
    }
  }

  /* 움직임을 줄여 달라고 했으면 **흐린 막대만** 남는다 (자리 표시는 그대로 뜻이 있다) */
  @media (prefers-reduced-motion: reduce) {
    .skel-row {
      animation: none;
      background: var(--bg-hover);
    }
  }
</style>
