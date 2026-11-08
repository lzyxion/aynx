<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **지난 대화 줄의 단추 묶음** — `[⋯] [재개]` 둘(2026-10-16 사용자 결정 "가장 단순한 B"). 상태줄 지난 대화
   * (`FolderConversations`)와 프로젝트 시작 화면(`ProjectStart`)이 같은 묶음을 쓴다.
   *
   * 주 동작 하나만 글자 단추로 선다 — 열린 대화면 [타일로 가기], 아니면 [재개](폴더가 없으면 흐림). 나머지는 ⋯ 메뉴(무리 순서는
   * 파일 타일 메뉴와 같은 규칙 — 열기 → 이름 → 위험한 것은 맨 아래): 기록 보기 ·
   * 새 대화로 계속(열린 대화에는 없음 · 폴더 없으면 흐림) · 여기로 가져오기(`onhere` 가 있을 때만 — 다른 폴더의 로컬 대화) ·
   * 이름 바꾸기(구분선 뒤 · `onrename` 이 있을 때만 — 로컬 대화. 열림 · 밖에서 열림이면 흐리고 툴팁에 까닭) ·
   * 삭제…(맨 아래 · 구분선 뒤 위험 글자 · `ondelete` 가 있을 때만 — 로컬 대화. 열림 · 밖에서 열림 · 갈라 나간 대화가 있으면 흐리고
   * 툴팁에 까닭 · 지우는 중이면 흐림. 확인 상자는 부르는 쪽 `deleteConversation`)
   * (docs/log/2026-10-24-convo-rename.md). 메뉴 모양 · 키 처리는 파일 타일의 접힌 메뉴(`ToolbarMenu`) 그대로, 실행은 `runOnMenu`(스냅샷 →
   * 닫기 → 실행 — docs/conventions.md "메뉴를 닫는 코드").
   *
   * 단추는 Tab 순서에 들지 않는다(`tabindex=-1`) — 두 화면 모두 키보드는 목록이 쥐고 같은 일을 단축키로 한다.
   * `keepFocus` 면 누를 때 포커스를 옮기지 않는다(상태줄 팝업 — 입력칸이 키보드를 쥔다).
   */
  let {
    open,
    cwdExists,
    keepFocus = false,
    viewKey,
    onview,
    onfork,
    onhere,
    onrename,
    renameBlocked = null,
    ondelete,
    deleteBlocked = null,
    onprimary,
    onmenu,
    onclosefocus,
  }: {
    /** 이 창의 타일에 열려 있는 대화 — 주 동작이 [타일로 가기] */
    open: boolean;
    /** 대화의 폴더가 아직 있나 — 없으면 재개 · 새 대화로 계속이 흐리다(여기로 가져오기는 된다) */
    cwdExists: boolean;
    keepFocus?: boolean;
    /** 기록 보기의 단축키 글자 — 화면마다 다르다(팝업 Ctrl+Enter · 시작 화면 V) */
    viewKey: string;
    onview: () => void;
    onfork: () => void;
    /** 여기로 가져오기 — 이 줄에서 할 수 없으면 넘기지 않는다(메뉴에 줄이 없다) */
    onhere?: () => void;
    /** 이름 바꾸기 — 이 줄에서 할 수 없으면(원격 대화) 넘기지 않는다(메뉴에 줄이 없다) */
    onrename?: () => void;
    /** 이름 바꾸기를 흐리는 까닭(툴팁 문구) — 열림 · 밖에서 열림. `null` 이면 된다 */
    renameBlocked?: string | null;
    /** 삭제 — 이 줄에서 할 수 없으면(원격 대화) 넘기지 않는다(메뉴에 줄이 없다) */
    ondelete?: () => void;
    /** 삭제를 흐리는 까닭(툴팁 문구) — 열림 · 밖에서 열림 · 갈라 나간 대화 · 지우는 중. `null` 이면 된다 */
    deleteBlocked?: string | null;
    onprimary: () => void;
    /** 메뉴가 열렸다 · 닫혔다 — 팝업은 열린 동안 마우스를 따라 고른 줄을 옮기지 않는다(메뉴로 가는 길에 다른 줄을 지난다) */
    onmenu?: (open: boolean) => void;
    /** Escape 로 닫았을 때 포커스를 돌려줄 곳 — 없으면 ⋯ 단추 */
    onclosefocus?: () => void;
  } = $props();

  let moreBtn = $state<HTMLButtonElement | null>(null);
  let menuOpen = $state(false);

  const rows = $derived<ToolbarMenuRow[]>([
    { key: "view", icon: "scroll-text", label: t("board.convo.view"), hint: viewKey },
    ...(open
      ? []
      : [
          {
            key: "fork",
            icon: "git-branch",
            label: t("board.convo.fork"),
            hint: "Shift+Enter",
            disabled: !cwdExists,
            title: cwdExists ? undefined : t("board.convo.missing.title"),
          },
        ]),
    ...(onhere ? [{ key: "here", icon: "download", label: t("app.folderConvos.forkHere"), hint: "Ctrl+Shift+Enter" }] : []),
    ...(onrename
      ? [
          {
            key: "rename",
            icon: "edit",
            label: t("board.convo.rename"),
            sep: true,
            disabled: renameBlocked !== null,
            title: renameBlocked ?? undefined,
          },
        ]
      : []),
    ...(ondelete
      ? [
          {
            key: "delete",
            icon: "trash",
            label: t("board.convo.delete"),
            sep: true,
            danger: true,
            disabled: deleteBlocked !== null,
            title: deleteBlocked ?? undefined,
          },
        ]
      : []),
  ]);

  function setMenu(next: boolean): void {
    if (menuOpen === next) return;
    menuOpen = next;
    onmenu?.(next);
  }

  function closeMenu(back: boolean): void {
    setMenu(false);
    if (!back) return;
    if (onclosefocus) onclosefocus();
    else moreBtn?.focus();
  }

  function pick(key: string): void {
    const run: Record<string, (() => void) | undefined> = {
      view: onview,
      fork: onfork,
      here: onhere,
      rename: onrename,
      delete: ondelete,
    };
    runOnMenu(() => run[key], () => closeMenu(false), (fn) => fn());
  }

  /** 줄의 클릭 · 더블클릭으로 번지지 않게 */
  function stop(ev: Event): void {
    ev.stopPropagation();
  }

  function noFocus(ev: MouseEvent): void {
    if (keepFocus) ev.preventDefault();
  }

  // 줄이 사라지면(고른 줄이 바뀌어 묶음이 걷힘) 메뉴도 함께 — 부모에게 닫혔다고 알린다
  $effect(() => () => {
    if (menuOpen) onmenu?.(false);
  });
</script>

<span class="acts" data-convo-acts>
  <button
    type="button"
    class="btn btn-ghost btn-sm more"
    tabindex="-1"
    data-act="more"
    aria-haspopup="menu"
    aria-expanded={menuOpen}
    aria-label={t("app.convoActs.more")}
    title={t("app.convoActs.more")}
    bind:this={moreBtn}
    onmousedown={noFocus}
    ondblclick={stop}
    onclick={(ev) => {
      stop(ev);
      setMenu(!menuOpen);
    }}><UiIcon name="more" size={14} /></button
  >
  <button
    type="button"
    class="btn btn-primary btn-sm"
    tabindex="-1"
    data-act={open ? "goto" : "resume"}
    title={open ? t("board.convo.goto") : `${t("board.convo.resume")} (Enter)`}
    disabled={!open && !cwdExists}
    onmousedown={noFocus}
    ondblclick={stop}
    onclick={(ev) => {
      stop(ev);
      onprimary();
    }}>{open ? t("board.convo.goto") : t("board.convo.resume")}</button
  >
</span>

{#if menuOpen && moreBtn}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <span class="menu-host" onclick={stop} ondblclick={stop} onmousedown={stop}>
    <ToolbarMenu label={t("app.convoActs.more")} {rows} trigger={moreBtn} align="right" onpick={pick} onclose={closeMenu} />
  </span>
{/if}

<style>
  .acts {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .more {
    width: 26px;
    padding: 0;
    justify-content: center;
  }

  .menu-host {
    display: contents;
  }
</style>
