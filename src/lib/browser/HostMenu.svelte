<script lang="ts">
  import type { HostEntry } from "$lib/hosts";
  import { dbConnsVia } from "$lib/app/db-conns.svelte.js";
  import { DB_ENGINE_ICON } from "$lib/db-conn";
  import HostIcon from "$lib/HostIcon.svelte";
  import { lastSegment, type HostMenuTarget } from "$lib/host-folders";
  import { runAfterClose, runOnMenu } from "$lib/browser/menu-runner";
  import { hostActions } from "$lib/pane/host-actions";
  import type { InlineEdit } from "$lib/browser/inline-edit.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **호스트 트리의 우클릭 메뉴** — 폴더 · 호스트 · 빈 배경이 **같은 상자**를 공유한다
   * (`menu.kind`). 바깥을 덮는 투명 백드롭이 바깥 클릭(과 우클릭)을 받아 닫고, 그 위에
   * 커서 자리(클램프)로 뜨는 메뉴가 앉는다.
   *
   * 폴더 조작 중 해제·하위 폴더 추가는 모드를 바꿔 이 상자 안에서 확정하고, **편집(이름 · 아이콘 · 색)은 상위의
   * 모달 한 장**(`FolderEditDialog` — 2026-09-29, docs/log/2026-09-29-folder-project-icons.md)이다. 호스트 조작은
   * 대부분 상위 콜백에 위임하되 파괴적인 "제거" 만 confirm 모드로 확인한다.
   *
   * 항목 핸들러는 **전부 통로 하나**를 지난다 (`$lib/browser/menu-runner` ·
   * `docs/conventions.md`): 스냅샷 → 닫기 → 실행. 콜백이 모달을 여는데 백드롭이 남아 있으면
   * 그 클릭을 가로채므로 닫는 순서가 먼저다.
   */
  let {
    menu,
    mode,
    edit,
    /** 새 폴더가 생길 부모 경로 — 배경 메뉴면 최상위(`""`), 폴더 메뉴면 그 폴더 안이다 */
    newFolderParent,
    /**
     * 다중 선택 메뉴의 "붙여넣기" 가 붙일 폴더 — 고른 줄의 폴더(`Sidebar` 의 `targetFolder`).
     * 폴더 메뉴는 그 폴더에, 빈 곳 메뉴는 최상위에 붙이므로 이 값을 쓰지 않는다.
     */
    pasteTarget,
    selCount,
    hasClip,
    /** 상위가 "전체 열기" 를 받아 주는가 — 없으면 그 항목 자체를 그리지 않는다 */
    canOpenAll,
    onclose,
    onmode,
    onopenall,
    oncut,
    oncopy,
    onpaste,
    onremoveselection,
    onaddhost,
    onreload,
    onstartnewfolder,
    onsubmitnewfolder,
    oneditfolder,
    onsubmitdissolve,
    onhostaction,
    onremovehost,
  }: {
    menu: HostMenuTarget;
    mode: "menu" | "confirm" | "newfolder";
    edit: InlineEdit;
    newFolderParent: string;
    pasteTarget: string;
    selCount: number;
    hasClip: boolean;
    canOpenAll: boolean;
    onclose: () => void;
    onmode: (next: "confirm") => void;
    onopenall: () => void;
    oncut: () => void;
    oncopy: () => void;
    /** `dest` 폴더에 붙여넣는다 (`""` = 최상위) */
    onpaste: (dest: string) => void;
    onremoveselection: () => void;
    /** `dest` 폴더에 호스트를 만든다 — 폼의 그룹 칸이 그 경로로 채워져 뜬다 (`""` = 최상위) */
    onaddhost: (dest: string) => void;
    onreload: () => void;
    onstartnewfolder: () => void;
    onsubmitnewfolder: () => void;
    /** 폴더 편집 모달을 연다 (이름 · 아이콘 · 색 — 대상 경로는 인자로 온다) */
    oneditfolder: (path: string) => void;
    onsubmitdissolve: () => void;
    /** 호스트 항목 하나를 상위 콜백에 넘긴다 (열기·새 세션·속성 …) */
    onhostaction: (action: (host: HostEntry) => void, host: HostEntry) => void;
    onremovehost: (host: HostEntry) => void;
  } = $props();

  /**
   * 호스트 콜백 묶음 — **컨텍스트에서 직접** 꺼낸다
   * (docs/log/2026-09-05-refactor-structure.md). 예전에는 `Sidebar` 가 일곱 개짜리 어댑터
   * 객체를 지어 프롭으로 내려 주었다: 이름만 바꿔 붙이는 통로라, 항목을 하나 더하려면
   * `+page` · `PaneHost` · `Sidebar` · 여기 네 곳이 함께 움직여야 했다.
   */
  const actions = hostActions();

  let menuEl = $state<HTMLElement | null>(null);

  /**
   * "DB 열기 ›" 의 하위 목록을 보고 있는가 — 같은 상자 안에서 줄을 갈아 끼운다(쿼리 타일 6단계). 그 호스트를 **경유하는**
   * DB 연결(`db-connections.json` 의 `via`)이 하나라도 있을 때만 항목이 선다. 하위 목록 끝의 "DB 연결 추가…" 는 경유를 그 호스트로
   * 미리 고른 폼을 연다(같은 통로).
   */
  let dbView = $state(false);
  const hostDbs = $derived(menu.kind === "host" ? dbConnsVia(menu.host.name) : []);

  /** DB 줄 통로 — 대상(호스트 · 연결 id)은 **인자로** 온다 */
  const onDb = (id: string) =>
    runOnMenu(
      () => (menu.kind === "host" ? { host: menu.host, id } : null),
      onclose,
      ({ host, id: dbId }) => actions.onopendb?.(host, dbId),
    );

  /** "DB 연결 추가…" 통로 — 대상(호스트)은 닫기 전에 스냅샷한다 */
  const onAddDb = () => runOnMenu(() => (menu.kind === "host" ? menu.host : null), onclose, (host) => actions.onadddb?.(host));

  /** 하위 목록을 열고 닫으면 첫 줄로 포커스 — 키보드로 들어간 사람이 길을 잃지 않게 */
  function setDbView(on: boolean) {
    dbView = on;
    queueMicrotask(() => menuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }

  /** 폴더 항목 통로 — 대상(폴더 경로)은 **인자로** 온다 (닫고 나서 `menu` 를 읽지 않는다) */
  const onGroup = (fn: (path: string) => void) =>
    runOnMenu(() => (menu.kind === "group" ? menu.path : null), onclose, fn);

  /** 호스트 항목 통로 — 대상은 **인자로** 온다 (닫고 나서 파생값을 읽지 않는다) */
  const onHost = (action: (host: HostEntry) => void) =>
    runOnMenu(
      () => (menu.kind === "host" ? menu.host : null),
      onclose,
      (host) => onhostaction(action, host),
    );

  // 메뉴가 뜨면(또는 모드가 바뀌면) 알맞은 곳에 포커스를 준다 — 입력 모드면 칸, 아니면 메뉴 자체.
  $effect(() => {
    if (mode === "newfolder") {
      edit.el?.focus();
      edit.el?.select();
    } else {
      menuEl?.focus();
    }
  });

  // 커서 자리에 띄우되 화면 밖으로 넘치지 않게 클램프한다 (렌더 뒤 실제 크기를 재야 하므로 effect).
  $effect(() => {
    if (!menuEl) return;
    void mode; // 모드가 바뀌어 크기가 달라지면 다시 잰다
    const r = menuEl.getBoundingClientRect();
    let nx = menu.x;
    let ny = menu.y;
    if (nx + r.width > window.innerWidth) nx = window.innerWidth - r.width - 4;
    if (ny + r.height > window.innerHeight) ny = window.innerHeight - r.height - 4;
    menuEl.style.left = Math.max(4, nx) + "px";
    menuEl.style.top = Math.max(4, ny) + "px";
  });

  /** 메뉴 안 키보드 — Escape 로 닫고, ↑/↓ 로 메뉴 항목 사이를 오간다 (menu 모드에서만) */
  function menuKeydown(ev: KeyboardEvent) {
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      onclose();
      return;
    }
    if (mode !== "menu") return;
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const items = menuEl ? [...menuEl.querySelectorAll<HTMLElement>('[role="menuitem"]')] : [];
      if (items.length === 0) return;
      const at = items.indexOf(document.activeElement as HTMLElement);
      const next =
        ev.key === "ArrowDown" ? (at + 1) % items.length : (at - 1 + items.length) % items.length;
      items[next]?.focus();
    }
  }
</script>

<button
  type="button"
  class="menu-backdrop"
  tabindex="-1"
  aria-label={t("files.hostmenu.close.aria")}
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
  aria-label={menu.kind === "group"
    ? t("files.hostmenu.group.aria")
    : menu.kind === "bg"
      ? t("files.hostmenu.bg.aria")
      : t("files.hostmenu.host.aria")}
  bind:this={menuEl}
  onkeydown={menuKeydown}
>
  {#if mode === "newfolder"}
    <!--
      폴더 추가 — 배경 메뉴("폴더 추가…")와 폴더 메뉴("하위 폴더 추가…")가 **같은 폼**을
      쓴다. 다른 것은 부모 경로뿐이고 그건 `newFolderParent` 가 이미 정했으므로, 여기서는
      어디에 만드는지를 제목에 보여 주기만 한다 (최상위면 "최상위").
      Enter 로 확정, Escape 로 취소 — 예전 이름 변경 칸과 같은 인라인 입력 관례다.
    -->
    <div class="ctx-title menu-title" title={newFolderParent || t("files.host.top")}>
      {t("files.hostmenu.newfolder.title", {
        path: newFolderParent === "" ? t("files.host.top") : newFolderParent,
      })}
    </div>
    <input
      class="ctx-input menu-input"
      data-inline-edit
      bind:value={edit.value}
      bind:this={edit.el}
      spellcheck="false"
      autocomplete="off"
      placeholder={t("files.hostmenu.newfolder.placeholder")}
      oninput={() => (edit.error = null)}
      onkeydown={(ev) => {
        if (ev.key === "Enter") {
          ev.preventDefault();
          onsubmitnewfolder();
        }
      }}
    />
    {#if edit.error}
      <div class="ctx-error">{edit.error}</div>
    {/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.hostmenu.cancel")}</button>
      <button type="button" class="ctx-btn btn btn-sm btn-primary" onclick={onsubmitnewfolder}>
        {t("files.hostmenu.newfolder.submit")}
      </button>
    </div>
  {:else if selCount >= 2 && menu.kind !== "bg"}
    <!--
      **다중 선택 메뉴** — 여럿을 골라 놓고 무엇을 우클릭했든 같은 메뉴다. 단일 메뉴의
      항목 대부분(이름 변경·복제·속성·공개키 설치)은 "그 하나" 를 전제로 하는 것이라
      여기서는 뜻이 없다. 남는 것은 **전부에 대해 뜻이 있는 넷**뿐이고, 그래서 목록이
      짧다 — 짧은 것이 이 메뉴의 정확한 모습이다.
    -->
    <div class="ctx-title menu-title">{t("files.hostmenu.selected", { count: selCount })}</div>
    {#if canOpenAll}
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        onclick={() => runAfterClose(onclose, onopenall)}
      >
        {t("files.hostmenu.openall")}
      </button>
      <div class="ctx-sep menu-sep" role="separator"></div>
    {/if}
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncut)}>
      {t("files.hostmenu.cut")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, oncopy)}>
      {t("files.hostmenu.copy")}
    </button>
    {#if hasClip}
      <!-- 고른 줄의 폴더에 붙인다 — `Ctrl+V` 와 같은 자리 (`pasteTarget`) -->
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        onclick={() => runOnMenu(() => pasteTarget, onclose, onpaste)}
      >
        {t("files.hostmenu.paste")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button
      type="button"
      class="ctx-item menu-row danger"
      role="menuitem"
      onclick={() => runAfterClose(onclose, onremoveselection)}
    >
      {t("files.hostmenu.removeselection")}
    </button>
  {:else if menu.kind === "bg"}
    <!--
      빈 배경 메뉴 — 대상이 없으니 **최상위**가 대상이다 (트리에는 들어가 있는 폴더가 없다 —
      docs/log/2026-09-25-hosts-tree.md). 만들기 둘(호스트 → 폴더 — 파일 타일의 새 파일 → 새 폴더와 같은 순서)이 먼저이고 새로고침이 끝에
      붙는다 (밖에서 `~/.ssh/config` 를 고쳤을 때의 수동 진입점 — 평소에는 창 포커스 복귀가
      알아서 다시 읽는다. 옛 툴바의 ⟳ 가 걷힌 뒤로는 이것이 유일한 수동 진입점이다).
    -->
    <div class="ctx-title menu-title">{t("files.host.top")}</div>
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      onclick={() => runAfterClose(onclose, () => onaddhost(""))}
    >
      {t("files.hostmenu.addhost")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={onstartnewfolder}>
      {t("files.hostmenu.addfolder")}
    </button>
    {#if hasClip}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <!--
        빈 곳 우클릭의 붙여넣기 — **최상위가 대상**이다. 항목을 하나도 고르지 않은 채로 붙일 수
        있어야 하고(방금 다른 창에서 잘라 왔다), 그 상태에서는 항목 메뉴가 뜰 자리가 없다.
      -->
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        onclick={() => runAfterClose(onclose, () => onpaste(""))}
      >
        {t("files.hostmenu.paste")}
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => runAfterClose(onclose, onreload)}>
      {t("files.hostmenu.refresh")}
    </button>
  {:else if menu.kind === "group"}
    {#if mode === "menu"}
      <div class="ctx-title menu-title" title={menu.path}>{lastSegment(menu.path)}</div>
      <!--
        무리 순서는 파일 타일 메뉴와 같다(VS Code 탐색기): 만들기 → 열기 → 붙여넣기 → 편집 → 위험한 것(그룹 해제)은 맨 아래.
        이 폴더 **안에** 만들기·붙이기 — 옛 탐색기에서는 폴더에 들어가 빈 곳 메뉴로 하던 일이다.
        트리에는 들어갈 자리가 없으므로 폴더 메뉴가 그 셋을 맡는다 (docs/log/2026-09-25-hosts-tree.md).
      -->
      <button type="button" class="ctx-item menu-row" role="menuitem" data-group-addhost onclick={() => onGroup(onaddhost)}>
        {t("files.hostmenu.addhost")}
      </button>
      <!-- 배경 메뉴의 "폴더 추가…" 와 같은 폼 — 부모가 이 폴더라는 것만 다르다 -->
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={onstartnewfolder}>
        {t("files.hostmenu.addsubfolder")}
      </button>
      {#if canOpenAll}
        <div class="ctx-sep menu-sep" role="separator"></div>
        <!-- 폴더를 터미널 타일 위로 끄는 것과 **같은 조작**의 무드래그 진입점 -->
        <button
          type="button"
          class="ctx-item menu-row"
          role="menuitem"
          onclick={() => runAfterClose(onclose, onopenall)}
        >
          {t("files.hostmenu.openall")}
        </button>
      {/if}
      {#if hasClip}
        <div class="ctx-sep menu-sep" role="separator"></div>
        <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onGroup(onpaste)}>
          {t("files.hostmenu.paste")}
        </button>
      {/if}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <!--
        편집 — 이름 · 아이콘 · 색을 한 모달에서 (옛 "이름 변경" · "아이콘과 색" 두 항목을 합쳤다). 모달을 여는 항목이라
        통로(`onGroup` → `runOnMenu`)로 닫고 나서 연다 — 백드롭이 남으면 모달의 첫 클릭을 가로챈다.
      -->
      <button
        type="button"
        class="ctx-item menu-row"
        role="menuitem"
        data-group-edit
        onclick={() => onGroup(oneditfolder)}
      >
        {t("files.hostmenu.edit")}
      </button>
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row danger" role="menuitem" onclick={() => onmode("confirm")}>
        {t("files.hostmenu.dissolve")}
      </button>
    {:else}
      <div class="ctx-confirm">{t("files.hostmenu.dissolve.confirm")}</div>
      <div class="ctx-row">
        <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.hostmenu.cancel")}</button>
        <button type="button" class="ctx-btn danger btn btn-sm" onclick={onsubmitdissolve}>
          {t("files.hostmenu.dissolve.submit")}
        </button>
      </div>
    {/if}
  {:else if mode === "confirm"}
    <div class="ctx-confirm">
      <!--
        문장을 세 토막으로 쪼갠 이유는 **마크업이 끼어서**다 (`docs/conventions.md` —
        문자열에 HTML 을 넣지 않는다). 두 언어가 같은 차례로 읽히도록 조각의 순서는
        이름 → 설정 파일 → `Host` 블록으로 고정한다.
      -->
      <strong>{menu.host.name}</strong>
      {t("files.hostmenu.remove.confirm.a")}
      <code>~/.ssh/config</code>
      {t("files.hostmenu.remove.confirm.b")}
      <code>Host</code>
      {t("files.hostmenu.remove.confirm.c")}
    </div>
    <!--
      **함께 정리되는 자리**가 있으면 한 줄 더 (docs/log/2026-09-17-host-remove-fanout.md).
      세는 것은 상위다(`onhostrefs`) — 이 메뉴가 즐겨찾기·스니펫·레이아웃·열린 탭을 직접
      들여오면 우클릭 메뉴 하나가 앱의 절반에 얽힌다. 걸리는 자리가 없으면 줄도 없다.
    -->
    {@const refs = actions.onhostrefs?.([menu.host.name]) ?? null}
    {#if refs}
      <div class="ctx-confirm refs">{refs}</div>
    {/if}
    <div class="ctx-row">
      <button type="button" class="ctx-btn btn btn-sm btn-secondary" onclick={onclose}>{t("files.hostmenu.cancel")}</button>
      <button
        type="button"
        class="ctx-btn danger btn btn-sm"
        onclick={() => runOnMenu(() => (menu.kind === "host" ? menu.host : null), onclose, onremovehost)}
      >
        {t("files.hostmenu.remove")}
      </button>
    </div>
  {:else if dbView}
    <div class="ctx-title menu-title" title={menu.host.name}>{menu.host.name} · {t("files.hostmenu.opendb")}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => setDbView(false)}>
      ‹ {t("files.hostmenu.opendb.back")}
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    {#each hostDbs as d (d.id)}
      <button type="button" class="ctx-item menu-row" role="menuitem" data-host-db={d.id} onclick={() => onDb(d.id)}>
        <span class="menu-mark"><HostIcon icon={DB_ENGINE_ICON[d.engine]} size={14} /></span>{d.name}
      </button>
    {/each}
    {#if actions.onadddb}
      <div class="ctx-sep menu-sep" role="separator"></div>
      <button type="button" class="ctx-item menu-row" role="menuitem" data-host-adddb onclick={onAddDb}>
        {t("files.hostmenu.adddb")}
      </button>
    {/if}
  {:else}
    <!--
      무리 순서(파일 타일 메뉴와 같은 규칙): 열기 → 편집 · 이름 변경 · 복제 → 키 → 위험한 것(제거)은 맨 아래 혼자.
    -->
    <div class="ctx-title menu-title" title={menu.host.name}>{menu.host.name}</div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onHost(actions.onconnect)}>
      {t("files.hostmenu.open")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onHost(actions.onconnectnew)}>
      {t("files.hostmenu.opennewtab")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onHost(actions.onnewsession)}>
      {t("files.hostmenu.newsession")}
    </button>
    {#if hostDbs.length > 0 && actions.onopendb}
      <!-- 그 호스트를 경유하는 DB 연결 — 같은 상자에서 하위 목록으로 갈아 끼운다(쿼리 타일 · 지금 탭에 새 타일) -->
      <button type="button" class="ctx-item menu-row db-more" role="menuitem" data-host-opendb onclick={() => setDbView(true)}>
        <span>{t("files.hostmenu.opendb")}</span><span class="more" aria-hidden="true">›</span>
      </button>
    {/if}
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onHost(actions.onedithost)}>
      {t("files.hostmenu.properties")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onHost(actions.onrenamehost)}>
      {t("files.hostmenu.rename")}
    </button>
    <button type="button" class="ctx-item menu-row" role="menuitem" onclick={() => onHost(actions.onduplicatehost)}>
      {t("files.hostmenu.duplicate")}
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <!--
      공개키 설치 — 비밀번호로 1회 접속해 서버에 키를 심고 이후 무비밀번호로 만든다.
      말줄임표는 "누르면 곧 뜨는 창이 더 있다"(키 선택·비밀번호) 는 관례다.
    -->
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      title={t("files.hostmenu.installkey.title")}
      onclick={() => onHost(actions.oninstallkey)}
    >
      {t("files.hostmenu.installkey")}
    </button>
    <!--
      호스트 키 잊기 — `~/.ssh/known_hosts` 의 이 서버 줄을 지운다 (`ssh-keygen -R` 상당).
      서버를 재설치한 뒤 "호스트 키가 바뀌었습니다" 를 만났을 때의 손 없는 출구다. 확인은
      상위가 `ask()` 로 받으므로 여기서는 말줄임표로 "창이 하나 더 뜬다" 만 알린다.
      위험 항목(`danger`)이 아닌 이유: 지우는 것은 접속 정보가 아니라 **신뢰 기록**이고,
      다음 접속에서 지문을 다시 확인하는 것으로 되돌아온다.
    -->
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      title={t("files.hostmenu.forgetkey.title")}
      onclick={() => onHost(actions.onforgethostkey)}
    >
      {t("files.hostmenu.forgetkey")}
    </button>
    <div class="ctx-sep menu-sep" role="separator"></div>
    <button type="button" class="ctx-item menu-row danger" role="menuitem" onclick={() => onmode("confirm")}>
      {t("files.hostmenu.remove")}
    </button>
  {/if}
</div>

<style>
  /* 바깥 클릭을 받아 닫는 투명 백드롭 — 메뉴보다 한 겹 아래에 깔린다 */
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

  /* 입력 모드의 검증 실패 한 줄 (폴더 추가) — 칸 바로 아래, 메뉴는 열린 채로 */
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

  /* 함께 정리되는 자리 — 경고가 아니라 **부연**이라 한 단계 흐리게, 위 문장에 붙여 놓는다 */
  .ctx-confirm.refs {
    margin-top: calc(-1 * var(--space-1));
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  /* "DB 열기 ›" — 하위 목록이 있다는 표시를 오른쪽 끝에 */
  .db-more {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .db-more .more {
    color: var(--fg-3);
  }

  .ctx-row {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-1) 2px;
  }

  /*
   * 인라인 대화의 단추 — 모양은 전역 `.btn .btn-sm` 세 종류다 (docs/log/2026-09-25-unified-dock.md ·
   * 토큰층 "버튼 세 종류"). 취소 = 보조(회색 판), 확인 = 주(채운 강조색 — 이 상자의 하나뿐인 주 동작).
   * 옛 선 두른 단추 규칙은 지웠다 — 스코프 규칙이 전역 클래스를 이기므로 남기면 안 먹는다.
   * `ctx-btn` 은 표식으로만 남는다(검증 도구가 이 이름으로 찾는다).
   */
  /* 되돌릴 수 없는 확인 — 주 동작 자리지만 강조색이 아니라 의미색(`--err`)으로 채운다 */
  .ctx-btn.danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .ctx-btn.danger:hover {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
