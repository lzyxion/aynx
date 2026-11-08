<script lang="ts">
  // ---------------------------------------------------------------------------
  // **채팅 독의 채팅 목록**(머리줄 제목 ▾ — 맨 위 [새 채팅], 줄 = 로고 · 제목 · 모델 · 시각 · 점, 우클릭 = 이름 바꾸기 · 지우기) —
  // `ChatDock.svelte` 에서 뗀 표시 조각. 목록 · 고르기 · 새 채팅 · 이름 바꾸기 저장과 열림 상태는 부모 독이 쥔다. 이름 칸의 글
  // (`renameText`)과 우클릭 대상(`rowMenu` — 줄 메뉴 `ToolbarMenu` 는 부모가 독 안에 그리고 `runOnMenu` 로 실행)만 `bind:` 로 부모 상태에 잇는다.
  // 로고 · 점은 부모의 스니펫을 그대로 받는다(머리줄과 같은 한 벌).
  // 줄 오른쪽의 단추 둘(연필 = 이름 바꾸기 · 휴지통 = 지우기 — 2026-11-01)은 호버 · 키보드 포커스에서 보이고, 터치 기기(`(hover: none)`)에서는
  // 늘 보인다(원격 · 폰에는 우클릭이 없다 — 폰 덮개 · `handheld()` 는 `always`). 하는 일은 우클릭 메뉴의 두 항목과 같다(`onrename` · `ondelete` — 부모 몸).
  // ---------------------------------------------------------------------------
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { SideChat } from "$lib/side-chat";
  import type { Dot } from "./chat-presentation";

  let {
    rows,
    current,
    offered,
    renaming,
    renameText = $bindable(),
    rowMenu = $bindable(),
    titleOf,
    rowSub,
    dotOf,
    pickChat,
    createChat,
    onRenameKey,
    commitRename,
    onrename,
    ondelete,
    always = false,
    logo,
    dot,
  }: {
    rows: SideChat[];
    current: SideChat | null;
    offered: readonly { id: string }[] | null;
    renaming: string | null;
    renameText: string;
    rowMenu: { id: string; el: HTMLElement } | null;
    titleOf: (c: SideChat | null) => string;
    rowSub: (c: SideChat) => string;
    dotOf: (c: SideChat) => Dot;
    pickChat: (id: string) => void;
    createChat: () => Promise<void>;
    onRenameKey: (ev: KeyboardEvent) => void;
    commitRename: () => void;
    onrename: (c: SideChat) => void;
    ondelete: (c: SideChat) => void;
    /** 단추를 늘 보인다 — 폰 덮개 · 폰 취급 기기(`handheld()`). 그 밖에도 `(hover: none)` 이면 CSS 가 늘 보인다 */
    always?: boolean;
    logo: Snippet<[string, number]>;
    dot: Snippet<[Dot]>;
  } = $props();

  /**
   * 이름 칸이 서면 포커스 + 글 전체 고르기. `autofocus` 는 Svelte 가 지금 포커스가 `body` 일 때만 옮겨, 단추(연필)를 누른 뒤나 입력 칸에
   * 포커스가 있던 채로는 칸에 들어가지 않았다(그러면 Enter 가 엉뚱한 단추를 누른다)
   */
  function focusRename(el: HTMLInputElement): void {
    el.focus();
    el.select();
  }
</script>

<div class="list" class:always role="listbox" aria-label={t("app.chatDock.list")} data-chat-dock-rows>
  <button type="button" class="row new" disabled={!offered || offered.length === 0} onclick={() => void createChat()}>
    <span class="row-logo"><UiIcon name="plus" size={16} /></span>
    <span class="row-title">{t("app.chatDock.new")}</span>
  </button>
  {#each rows as c (c.id)}
    {#if renaming === c.id}
      <div class="row editing">
        <span class="row-logo">{@render logo(c.cli, 16)}</span>
        <input
          class="rename"
          aria-label={t("app.chatDock.rename.aria")}
          bind:value={renameText}
          use:focusRename
          onkeydown={onRenameKey}
          onblur={commitRename}
        />
      </div>
    {:else}
      <div class="row-wrap" data-chat-row-wrap={c.id}>
        <button
          type="button"
          class="row"
          class:cur={c.id === current?.id}
          role="option"
          aria-selected={c.id === current?.id}
          data-chat-row={c.id}
          onclick={() => pickChat(c.id)}
          oncontextmenu={(ev) => {
            ev.preventDefault();
            rowMenu = { id: c.id, el: ev.currentTarget as HTMLElement };
          }}
        >
          <span class="row-logo">{@render logo(c.cli, 16)}</span>
          <span class="row-text">
            <span class="row-title">{titleOf(c)}</span>
            <span class="row-sub">{rowSub(c)}</span>
          </span>
          {@render dot(dotOf(c))}
        </button>
        <span class="acts">
          <button
            type="button"
            class="act"
            title={t("app.chatDock.rename")}
            aria-label={t("app.chatDock.rename")}
            data-chat-row-rename={c.id}
            onclick={(ev) => {
              ev.stopPropagation();
              onrename(c);
            }}><UiIcon name="edit" size={15} /></button
          >
          <button
            type="button"
            class="act danger"
            title={t("app.chatDock.delete")}
            aria-label={t("app.chatDock.delete")}
            data-chat-row-delete={c.id}
            onclick={(ev) => {
              ev.stopPropagation();
              ondelete(c);
            }}><UiIcon name="trash" size={15} /></button
          >
        </span>
      </div>
    {/if}
  {/each}
</div>

<style>
  /* 채팅 목록 — 머리줄 바로 아래, 본문 위에 덮인다 */
  .list {
    position: absolute;
    top: 52px;
    left: var(--space-2);
    right: var(--space-2);
    z-index: 3;
    max-height: min(60%, 420px);
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: var(--space-1);
    background: var(--surface-raised-solid);
    border: 1px solid var(--line-strong);
    border-radius: 12px;
    box-shadow: var(--shadow-raised);
  }

  .row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 40px;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: transparent;
    border: none;
    border-radius: 8px;
    cursor: pointer;
    text-align: left;
  }

  .row:hover:not(:disabled),
  .row-wrap:hover .row,
  .row.cur {
    background: var(--control-ghost-hover);
  }

  .row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 줄 + 오른쪽 단추 둘 — 단추는 줄 위에 겹쳐 서고, 보일 때 줄 글이 그 폭만큼 비켜 선다 */
  .row-wrap {
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .acts {
    position: absolute;
    top: 50%;
    right: var(--space-1);
    transform: translateY(-50%);
    display: none;
    gap: 2px;
  }

  .row-wrap:hover .acts,
  .row-wrap:focus-within .acts,
  .always .acts {
    display: inline-flex;
  }

  .row-wrap:hover .row,
  .row-wrap:focus-within .row,
  .always .row-wrap .row {
    padding-right: calc(2 * 32px + 2px + var(--space-2));
  }

  .act {
    width: 32px;
    height: 32px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-row);
    cursor: pointer;
  }

  .act:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .act.danger:hover {
    color: var(--err);
  }

  .act:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  /* 터치 기기 — 호버가 없으니 늘 보인다 */
  @media (hover: none) {
    .acts {
      display: inline-flex;
    }

    .row-wrap .row {
      padding-right: calc(2 * 32px + 2px + var(--space-2));
    }
  }

  .row.new {
    color: var(--accent);
  }

  .row-logo {
    flex: 0 0 auto;
    width: 20px;
    display: inline-flex;
    justify-content: center;
  }

  .row-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .row-title,
  .row-sub {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .row-sub {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .rename {
    flex: 1;
    min-width: 0;
    height: 28px;
    padding: 0 var(--space-3);
    font: inherit;
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--focus-ring);
    border-radius: 999px;
    outline: none;
  }
</style>
