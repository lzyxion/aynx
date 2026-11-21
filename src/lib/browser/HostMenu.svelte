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

  /** 항목 핸들러는 전부 menu-runner 통로(스냅샷 → 닫기 → 실행)를 지난다 — 뒤집으면 남은 백드롭이 모달의 클릭을 가로챈다 */
  let {
    menu,
    mode,
    edit,
    newFolderParent,
    pasteTarget,
    selCount,
    hasClip,
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
    /** `""` = 최상위 */
    onpaste: (dest: string) => void;
    onremoveselection: () => void;
    /** `""` = 최상위 */
    onaddhost: (dest: string) => void;
    onreload: () => void;
    onstartnewfolder: () => void;
    onsubmitnewfolder: () => void;
    oneditfolder: (path: string) => void;
    onsubmitdissolve: () => void;
    onhostaction: (action: (host: HostEntry) => void, host: HostEntry) => void;
    onremovehost: (host: HostEntry) => void;
  } = $props();

  const actions = hostActions();

  let menuEl = $state<HTMLElement | null>(null);

  let dbView = $state(false);
  const hostDbs = $derived(menu.kind === "host" ? dbConnsVia(menu.host.name) : []);

  const onDb = (id: string) =>
    runOnMenu(
      () => (menu.kind === "host" ? { host: menu.host, id } : null),
      onclose,
      ({ host, id: dbId }) => actions.onopendb?.(host, dbId),
    );

  const onAddDb = () => runOnMenu(() => (menu.kind === "host" ? menu.host : null), onclose, (host) => actions.onadddb?.(host));

  function setDbView(on: boolean) {
    dbView = on;
    queueMicrotask(() => menuEl?.querySelector<HTMLElement>('[role="menuitem"]')?.focus());
  }

  /** 닫고 나서 `menu` 를 읽지 않는다 — 대상은 인자로 온다 */
  const onGroup = (fn: (path: string) => void) =>
    runOnMenu(() => (menu.kind === "group" ? menu.path : null), onclose, fn);

  const onHost = (action: (host: HostEntry) => void) =>
    runOnMenu(
      () => (menu.kind === "host" ? menu.host : null),
      onclose,
      (host) => onhostaction(action, host),
    );

  $effect(() => {
    if (mode === "newfolder") {
      edit.el?.focus();
      edit.el?.select();
    } else {
      menuEl?.focus();
    }
  });

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
      <button type="button" class="ctx-item menu-row" role="menuitem" data-group-addhost onclick={() => onGroup(onaddhost)}>
        {t("files.hostmenu.addhost")}
      </button>
      <button type="button" class="ctx-item menu-row" role="menuitem" onclick={onstartnewfolder}>
        {t("files.hostmenu.addsubfolder")}
      </button>
      {#if canOpenAll}
        <div class="ctx-sep menu-sep" role="separator"></div>
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
      <!-- 문장을 마크업 때문에 세 토막으로 나눴다 — 두 언어가 같은 차례로 읽히게 조각 순서(이름 → 설정 파일 → `Host` 블록)를 고정한다 -->
      <strong>{menu.host.name}</strong>
      {t("files.hostmenu.remove.confirm.a")}
      <code>~/.ssh/config</code>
      {t("files.hostmenu.remove.confirm.b")}
      <code>Host</code>
      {t("files.hostmenu.remove.confirm.c")}
    </div>
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
    <button
      type="button"
      class="ctx-item menu-row"
      role="menuitem"
      title={t("files.hostmenu.installkey.title")}
      onclick={() => onHost(actions.oninstallkey)}
    >
      {t("files.hostmenu.installkey")}
    </button>
    <!-- `danger` 가 아니다 — 지우는 것은 신뢰 기록이고 다음 접속의 지문 확인으로 되돌아온다 -->
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
  .menu-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    background: transparent;
    border: none;
    cursor: default;
  }

  /* `ctx-*` 이름은 표식으로 남는다 — 검증 도구가 이 이름으로 찾는다 */
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

  .ctx-confirm.refs {
    margin-top: calc(-1 * var(--space-1));
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

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

  /* `ctx-btn` 은 표식으로만 남는다(검증 도구가 찾는다) — 여기 모양 규칙을 두면 스코프 규칙이 전역 `.btn` 을 이겨 전역 모양이 안 먹는다 */
  .ctx-btn.danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .ctx-btn.danger:hover {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
