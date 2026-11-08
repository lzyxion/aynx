<script lang="ts">
  import { baseNameOf, LOCAL_KEY, type FsBackend } from "$lib/fs-backend";
  import { isDirLike, type SftpEntry } from "$lib/sftp-browser";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import type { InlineEdit } from "$lib/browser/inline-edit.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **파일 타일의 우클릭 메뉴** — 항목 메뉴 · 다중 선택 메뉴 · 빈 배경 메뉴, 그리고 그 안에서
   * 모드만 바꿔 뜨는 인라인 폼 셋(이름 변경 · 새 폴더 · 삭제 확인).
   *
   * 항목 핸들러는 **전부 통로 하나**를 지난다 (`$lib/browser/menu-runner` ·
   * `docs/conventions.md`): 스냅샷 → 닫기 → 실행. `entry` 는 이 컴포넌트의 프롭이므로 닫는
   * 순간(부모가 `menu = null`) 통째로 사라진다 — 닫고 나서 읽으면 그 자리에서 죽는다.
   */
  let {
    menu,
    mode,
    edit,
    backend,
    cwd,
    /** 새 폴더 폼이 만들 자리 — 부르는 쪽이 폼을 연 순간 정한다(툴바 = 대상 폴더 · 폴더 메뉴 = 그 폴더) */
    newFolderDir = cwd,
    /** 트리 보기인가 — 폴더 줄 메뉴에 "새 폴더…" 가 선다 */
    tree = false,
    atRoot,
    isLocal,
    selCount,
    selPaths,
    /** 전송이 도는 중인가 — [다운로드]·[내보내기]를 흐리게 하고 이유를 괄호로 적는다 */
    busy,
    hasClip,
    /** 지금 삭제 확인이 걸려 있는 경로들 (하나일 수도, 고른 것 전부일 수도 있다) */
    removeTargets,
    /** 백엔드가 "비어 있지 않다" 로 거절한 뒤에만 참 — 그때만 재귀 삭제를 묻는다 */
    confirmRecursive,
    sourcePaneId,
    onclose,
    oncut,
    oncopy,
    onpaste,
    ondownload,
    onexport,
    onopenentry,
    onpreview,
    oneditentry,
    onopenexternal,
    onreveal,
    oncopypath,
    onstartrename,
    onstartremove,
    onstartnewfolder,
    onstartnewfile,
    onpickupload,
    onimportfolders,
    onrevealhere,
    onrefresh,
    oncdhere,
    onsubmitrename,
    onsubmitnewfolder,
    onsubmitnewfile,
    onsubmitremove,
  }: {
    menu: { x: number; y: number; entry: SftpEntry | null };
    mode: "menu" | "rename" | "newfolder" | "newfile" | "confirm";
    edit: InlineEdit;
    backend: FsBackend;
    cwd: string;
    newFolderDir?: string;
    tree?: boolean;
    atRoot: boolean;
    isLocal: boolean;
    selCount: number;
    selPaths: readonly string[];
    busy: boolean;
    hasClip: boolean;
    removeTargets: readonly string[];
    confirmRecursive: boolean;
    sourcePaneId: string | null;
    onclose: () => void;
    oncut: () => void;
    oncopy: () => void;
    onpaste: () => void;
    ondownload: (paths: readonly string[]) => void;
    onexport: (paths: readonly string[]) => void;
    onopenentry: (entry: SftpEntry) => void;
    /** "미리 보기" — 문서 보기 타일로 연다(docs/log/2026-09-27-doc-tile.md). 없으면 그 줄이 서지 않는다 */
    onpreview?: (entry: SftpEntry) => void;
    oneditentry: (entry: SftpEntry) => void;
    onopenexternal: (entry: SftpEntry) => void;
    onreveal: (entry: SftpEntry) => void;
    oncopypath: (entry: SftpEntry) => void;
    onstartrename: () => void;
    onstartremove: () => void;
    onstartnewfolder: () => void;
    onstartnewfile: () => void;
    onpickupload: () => void;
    onimportfolders: () => void;
    onrevealhere: () => void;
    onrefresh: () => void;
    oncdhere: () => void;
    onsubmitrename: () => void;
    onsubmitnewfolder: () => void;
    onsubmitnewfile: () => void;
    onsubmitremove: (recursive: boolean) => void;
  } = $props();

  /** 확인 문구에 적을 이름 — 하나면 그 이름, 여럿이면 개수 */
  const removeLabel = $derived(
    removeTargets.length === 1
      ? baseNameOf(removeTargets[0])
      : t("files.menu.remove.targets", { count: removeTargets.length }),
  );

  /** 항목 하나를 대상으로 하는 통로 — 대상은 **인자로** 온다 */
  const onEntry = (fn: (entry: SftpEntry) => void) => runOnMenu(() => menu.entry, onclose, fn);

  function menuKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
    }
  }
</script>

<button
  type="button"
  class="menu-backdrop"
  tabindex="-1"
  aria-label={t("files.menu.close.aria")}
  onclick={onclose}
  oncontextmenu={(ev) => {
    ev.preventDefault();
    onclose();
  }}
></button>
<div
  class="ctx-menu menu-surface"
  role="menu"
  tabindex="-1"
  aria-label={menu.entry ? t("files.menu.entry.aria") : t("files.menu.dir.aria")}
  style:left={`${menu.x}px`}
  style:top={`${menu.y}px`}
  onkeydown={menuKeydown}
>
  {#if mode === "rename"}
    <div class="ctx-title menu-title">{t("files.menu.rename.title")}</div>
    <input
      class="ctx-input menu-input"
      data-inline-edit
      bind:value={edit.value}
      bind:this={edit.el}
      spellcheck="false"
      autocomplete="off"
      placeholder={t("files.menu.rename.placeholder")}
      oninput={() => (edit.error = null)}
      onkeydown={(ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          onsubmitrename();
        }
      }}
    />
    {#if edit.error}<div class="ctx-error">{edit.error}</div>{/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.menu.cancel")}</button>
      <button type="button" class="ctx-btn btn btn-sm btn-primary" onclick={onsubmitrename}>
        {t("files.menu.rename.submit")}
      </button>
    </div>
  {:else if mode === "newfolder" || mode === "newfile"}
    <!-- 새 폴더 · 새 파일은 같은 폼이다 — 제목 · 자리 글자 · 확정만 갈린다 -->
    {@const file = mode === "newfile"}
    {@const submitNew = file ? onsubmitnewfile : onsubmitnewfolder}
    <div class="ctx-title menu-title" title={newFolderDir}>
      {t(file ? "files.menu.newfile.title" : "files.menu.newfolder.title", { path: newFolderDir })}
    </div>
    <input
      class="ctx-input menu-input"
      data-inline-edit
      bind:value={edit.value}
      bind:this={edit.el}
      spellcheck="false"
      autocomplete="off"
      placeholder={t(file ? "files.menu.newfile.placeholder" : "files.menu.newfolder.placeholder")}
      oninput={() => (edit.error = null)}
      onkeydown={(ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          submitNew();
        }
      }}
    />
    {#if edit.error}<div class="ctx-error">{edit.error}</div>{/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.menu.cancel")}</button>
      <button type="button" class="ctx-btn btn btn-sm btn-primary" onclick={submitNew}>
        {t("files.menu.newfolder.submit")}
      </button>
    </div>
  {:else if mode === "confirm"}
    <!--
      삭제 확인. 처음에는 그냥 "지울까?" 이고, 백엔드가 "비어 있지 않다" 로 거절한 뒤에만
      재귀 삭제 버튼이 나타난다 (`confirmRecursive`) — 그 편이 실수로 트리를 통째로 날리는
      길을 한 단계 멀리 둔다. 여럿이면 **개수**를 적는다: 하나를 지우는 줄 알았는데 스물이
      사라지는 일이 없어야 한다.
    -->
    <div class="ctx-title menu-title" title={removeTargets.join("\n")}>{removeLabel}</div>
    <div class="ctx-confirm">
      {confirmRecursive
        ? t("files.menu.remove.confirm.recursive")
        : t("files.menu.remove.confirm")}
    </div>
    {#if edit.error}<div class="ctx-error">{edit.error}</div>{/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.menu.cancel")}</button>
      {#if confirmRecursive}
        <button type="button" class="ctx-btn danger btn btn-sm" onclick={() => onsubmitremove(true)}>
          {t("files.menu.remove.recursive")}
        </button>
      {:else}
        <button type="button" class="ctx-btn danger btn btn-sm" onclick={() => onsubmitremove(false)}>
          {t("files.menu.remove")}
        </button>
      {/if}
    </div>
  {:else if menu.entry && selCount >= 2}
    <!--
      **다중 선택 메뉴** — 여럿을 골라 놓고 무엇을 우클릭했든 같은 메뉴다. 단일 메뉴의
      항목 대부분(열기·편집·이름 변경·경로 복사)은 "그 하나" 를 전제로 하는 것이라 여기서는
      뜻이 없다. 남는 것은 **전부에 대해 뜻이 있는 것**뿐이고, 무리 순서는 단일 메뉴와 같다
      (클립보드 → 보내기 → 삭제 — VS Code 탐색기의 순서).
    -->
    <div class="ctx-title menu-title">{t("files.menu.selected", { count: selCount })}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncut)}>
      {t("files.menu.cut")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncopy)}>
      {t("files.menu.copy")}
    </button>
    {#if hasClip && !atRoot}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onpaste)}>
        {t("files.menu.paste")}
      </button>
    {/if}
    {#if backend.canDownload || (backend.key === LOCAL_KEY && !atRoot)}
      <div class="ctx-sep menu-sep" role="separator"></div>
    {/if}
    <!-- [다운로드] — 하나를 전제하지 않는 조작이라 다중 메뉴에도 있고, 단일 메뉴와 같은 함수로 간다 -->
    {#if backend.canDownload}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        disabled={busy}
        onclick={() => runOnMenu(() => [...selPaths], onclose, ondownload)}
      >
        {busy ? t("files.menu.download.busy") : t("files.menu.download")}
      </button>
    {/if}
    <!--
      로컬 타일의 짝 — `Alt`+드래그가 못 하는 자리(네트워크·긴 경로)의 대체 길이기도 하다
      (docs/log/2026-09-04-native-drag-out.md).
    -->
    {#if backend.key === LOCAL_KEY && !atRoot}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        disabled={busy}
        onclick={() => runOnMenu(() => [...selPaths], onclose, onexport)}
      >
        {busy ? t("files.menu.export.busy") : t("files.menu.export")}
      </button>
    {/if}
    {#if !atRoot}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row danger" role="menuitem" onclick={onstartremove}>
        {t("files.menu.remove.more")}
      </button>
    {/if}
  {:else if menu.entry}
    <!--
      **항목 하나의 메뉴** — 무리 순서는 VS Code 탐색기를 따른다: 만들기(트리의 폴더 줄만) → 열기 → 보내기 →
      클립보드 → 경로 복사 → 이름 바꾸기 · 삭제(위험한 것이 맨 아래). 무리 사이에만 구분선을 둔다.
    -->
    {@const entry = menu.entry}
    {@const canCreate = tree && isDirLike(entry) && !atRoot}
    {@const canSend = backend.canDownload || (backend.key === LOCAL_KEY && !atRoot)}
    <div class="ctx-title menu-title" title={entry.path}>{entry.name}</div>
    {#if canCreate}
      <!--
        **트리의 폴더 줄에서 곧바로 새 파일 · 새 폴더** — 들어가기 보기에서는 "폴더에 들어가 빈 곳 메뉴로" 하던
        일을 그 자리로 옮겼다(호스트 트리의 폴더 메뉴 "하위 폴더 추가…" 와 같은 까닭). 폼은 이 메뉴
        안에서 모드만 바꿔 뜬다 — 대상 경로는 부르는 쪽이 메뉴를 연 순간 정해 둔 값이다.
      -->
      <button type="button" class="ctx-item menu-row" role="menuitem" data-menu-newfile onclick={onstartnewfile}>
        {t("files.menu.newfile")}
      </button>
      <button type="button" class="ctx-item menu-row" role="menuitem" data-menu-newfolder onclick={onstartnewfolder}>
        {t("files.menu.newfolder")}
      </button>
      <div class="ctx-sep menu-sep" role="separator"></div>
    {/if}
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(onopenentry)}>
      {isDirLike(entry) ? t("files.menu.enter") : t("files.menu.open")}
    </button>
    <!--
      미리 보기 — 파일에만, 글자로 읽을 수 있는 백엔드(`canView`)에서만. 이름으로 거르지 않는다(모르는 확장자도
      사람이 골랐으면 열어 본다 — 이진이면 타일이 그렇게 말한다). 통로는 다른 줄과 같은 `onEntry`.
    -->
    {#if !isDirLike(entry) && backend.canView && onpreview}
      {@const preview = onpreview}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(preview)}>
        {t("files.doc.preview")}
      </button>
    {/if}
    {#if !isDirLike(entry) && backend.canEdit}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(oneditentry)}>
        {t("files.menu.edit.external")}
      </button>
    {/if}
    <!--
      로컬 전용 두 줄. "기본 앱으로 열기" 는 파일에만 붙인다 — 폴더에서 그 뜻은 이미 위
      [들어가기] 가 갖고 있고, 탐색기로 보내는 길은 바로 아래 줄이 따로 있다.
    -->
    {#if !isDirLike(entry) && backend.canOpenExternal}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(onopenexternal)}>
        {t("files.menu.openexternal")}
      </button>
    {/if}
    {#if backend.canReveal}
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(onreveal)}>
        {t("files.menu.reveal")}
      </button>
    {/if}
    {#if canSend}
      <div class="ctx-sep menu-sep" role="separator"></div>
    {/if}
    <!--
      **폴더도 받는다** — 예전에는 파일에만 붙던 줄이다. 받을 자리는 폴더 선택 대화상자가
      정하고, 그 뒤는 붙여넣기·드롭과 같은 몸통이다.
    -->
    {#if backend.canDownload}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        disabled={busy}
        onclick={() => onEntry((e) => ondownload([e.path]))}
      >
        {busy ? t("files.menu.download.busy") : t("files.menu.download")}
      </button>
    {/if}
    <!-- [탐색기로 내보내기…] — 다중 메뉴와 **같은 함수**로 간다 (대상만 이 한 줄이다) -->
    {#if backend.key === LOCAL_KEY && !atRoot}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        disabled={busy}
        onclick={() => onEntry((e) => onexport([e.path]))}
      >
        {busy ? t("files.menu.export.busy") : t("files.menu.export")}
      </button>
    {/if}
    {#if !atRoot}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <!-- 클립보드 셋 — 하나짜리 메뉴에도 붙는다 (다중 메뉴와 **같은 함수**로 간다) -->
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncut)}>
        {t("files.menu.cut")}
      </button>
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncopy)}>
        {t("files.menu.copy")}
      </button>
      {#if hasClip}
        <!-- 붙일 자리는 부르는 쪽이 메뉴를 연 순간 정해 둔 폴더다 — 트리에서는 이 줄의 폴더(폴더면 그
             안, 파일이면 그것이 든 폴더), 들어가기 보기에서는 지금 폴더 -->
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onpaste)}>
          {t("files.menu.paste")}
        </button>
      {/if}
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onEntry(oncopypath)}>
      {t("files.menu.copypath")}
    </button>
    {#if !atRoot}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={onstartrename}>
        {t("files.menu.rename.more")}
      </button>
      <button type="button" class="ctx-item menu-row danger" role="menuitem" onclick={onstartremove}>
        {t("files.menu.remove.more")}
      </button>
    {/if}
  {:else}
    <!--
      **빈 곳 메뉴** — 대상은 지금 폴더. 무리 순서(VS Code 탐색기 빈 곳과 같은 뜻): 만들기 → 이 폴더 열기(탐색기 · 터미널) →
      붙여넣기 → 들여오기(업로드 · 가져오기) → 새로 고침. 무리가 하나라도 앞에 섰을 때만 구분선을 둔다.
    -->
    {@const gCreate = !atRoot}
    {@const gPlace = (backend.canReveal && !atRoot) || !!sourcePaneId}
    {@const gPaste = hasClip && !atRoot}
    {@const gBring = !atRoot && (backend.canUpload || isLocal)}
    <div class="ctx-title menu-title" title={cwd}>{cwd === "" ? t("files.browser.mypc") : cwd}</div>
    {#if gCreate}
      <button type="button" class="ctx-item menu-row" role="menuitem" data-menu-newfile onclick={onstartnewfile}>
        {t("files.menu.newfile")}
      </button>
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={onstartnewfolder}>
        {t("files.menu.newfolder")}
      </button>
    {/if}
    {#if gPlace}
      {#if gCreate}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
      {#if backend.canReveal && !atRoot}
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onrevealhere)}>
          {t("files.menu.revealhere")}
        </button>
      {/if}
      {#if sourcePaneId}
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncdhere)}>
          {t("files.menu.cdhere")}
        </button>
      {/if}
    {/if}
    {#if gPaste}
      {#if gCreate || gPlace}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
      <!--
        빈 곳 우클릭의 붙여넣기 — **지금 폴더가 대상**이라 여기가 제자리다. 항목을 하나도
        고르지 않은 채로 붙일 수 있어야 하고(방금 다른 타일에서 잘라 왔다), 그 상태에서는
        항목 메뉴가 뜰 자리가 없다.
      -->
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onpaste)}>
        {t("files.menu.paste")}
      </button>
    {/if}
    {#if gBring}
      {#if gCreate || gPlace || gPaste}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
      {#if backend.canUpload}
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onpickupload)}>
          {isLocal ? t("files.menu.import") : t("files.menu.upload")}
        </button>
      {/if}
      <!--
        **폴더 가져오기** — 로컬 타일에만. 파일은 탐색기에서 끌어다 놓으면 되지만 폴더는
        웹 DnD 로 오지 않아(`File` 이 아니다) 대화상자로 경로를 받는 길이 하나 필요하다.
        항목 메뉴의 [탐색기로 내보내기…] 와 정확히 짝이다.
      -->
      {#if isLocal}
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onimportfolders)}>
          {t("files.menu.importfolders")}
        </button>
      {/if}
    {/if}
    {#if gCreate || gPlace || gPaste || gBring}<div class="ctx-sep menu-sep" role="separator"></div>{/if}
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onrefresh)}>
      {t("files.menu.refresh")}
    </button>
  {/if}
</div>

<style>
  /* ── 우클릭 메뉴 (호스트 트리와 같은 모양) ───────────────────────────────── */

  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  /*
   * 커서 자리(JS 로 클램프)에 뜨는 작은 메뉴 상자. 모양(상자·줄·머리글·구분선·인라인 칸)은
   * 전역 메뉴 한 벌(`theme.css` 의 `.menu-*` — docs/log/2026-09-25-leftovers-menus-dots.md)이고
   * 여기 남는 것은 자리와 폭뿐이다. `ctx-*` 이름은 표식으로 남는다(검증 도구가 이 이름으로 찾는다).
   */
  .ctx-menu {
    position: fixed;
    z-index: 41;
    min-width: 160px;
    max-width: 240px;
  }

  .ctx-error {
    padding: 0 var(--space-2) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.4;
    color: var(--err);
  }

  .ctx-confirm {
    padding: var(--space-1) var(--space-2) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    line-height: 1.45;
    color: var(--fg-1);
  }

  .ctx-row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1) 2px;
  }

  /*
   * 인라인 대화의 단추 — 전역 `.btn .btn-sm` 세 종류 (`HostMenu`·`ProjectMenu` 와 같은 처방,
   * docs/log/2026-09-25-finish-menus.md). 취소 = 보조, 확인 = 주(채운 강조색), 되돌릴 수 없는
   * 확인(삭제) = 채운 `--err`. 옛 선 두른 규칙은 지웠다 — 스코프 규칙이 전역 클래스를 이긴다.
   * `ctx-btn` 은 표식으로만 남는다.
   */
  .ctx-btn.danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .ctx-btn.danger:hover {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
