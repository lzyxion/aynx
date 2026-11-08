<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import type { FileView } from "$lib/session";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";

  /**
   * **파일 타일의 보기 고르개** — 지금 보기의 그림 + ▾ 하나. 누르면 셋을 고르는 목록이 아래로 뜬다(툴팁은 이름만 — "보기").
   *
   * 자리는 뒤로/앞으로(`BrowserNav`) **바로 다음**이다(2026-10-20 사용자 실기 — `‹ › · ▦▾ · 위치 아이콘 · 경로 …`): 머리줄이 서 있으면
   * 머리줄 맨 앞 조각(`pane/pane-tools.svelte.ts` 의 `lead` — 타일 아이콘 앞), 아니면 도구줄 맨 앞(`BrowserToolbar` 의 `nav`). 그래서
   * `BrowserToolbar` 에서 꺼냈다. `Ctrl+1/2/3` 은 창 전역의 `file-keys.ts` 가 받는다(이 단추와 같은 길 — `onview`).
   * 단추 모양은 전역 `.bar-btn`(`BrowserToolbar`).
   */
  let {
    view = "details",
    onview,
  }: {
    /** 지금 보기 — 고르개의 그림 */
    view?: FileView;
    /** 보기를 골랐다 (`Ctrl+1/2/3` 과 같은 길) */
    onview?: (view: FileView) => void;
  } = $props();

  /** 보기 셋 — 순서가 곧 `Ctrl+1/2/3` 이다(Dolphin 과 같은 차례) */
  const VIEWS: readonly { view: FileView; icon: string; label: Key }[] = [
    { view: "icons", icon: "grid", label: "files.view.icons" },
    { view: "compact", icon: "view-compact", label: "files.view.compact" },
    { view: "details", icon: "list", label: "files.view.details" },
  ];

  const VIEW_ACTION: Record<FileView, string> = {
    icons: "files-view-icons",
    compact: "files-view-compact",
    details: "files-view-details",
  };

  const currentView = $derived(VIEWS.find((v) => v.view === view) ?? VIEWS[2]);

  const rows = $derived<ToolbarMenuRow[]>(
    VIEWS.map((v) => ({
      key: v.view,
      icon: v.icon,
      label: t(v.label),
      // 지금 걸린 조합(사용자 오버라이드를 지난 것)
      hint: displayCombo(effectiveCombo(VIEW_ACTION[v.view], settings.keybindings)),
      checked: view === v.view,
      radio: true,
    })),
  );

  let open = $state(false);
  let btn = $state<HTMLButtonElement | null>(null);

  /** 닫는다 — `back` 이면 단추로 포커스를 돌려준다 */
  function close(back: boolean) {
    open = false;
    if (back) btn?.focus({ preventScroll: true });
  }

  /** 메뉴 줄 — 통로(`runOnMenu`)를 지난다: 대상을 뜨고 → 닫고(단추로 포커스) → 실행 */
  function pick(key: string) {
    runOnMenu(
      () => VIEWS.find((v) => v.view === key)?.view,
      () => close(true),
      (v) => onview?.(v),
    );
  }
</script>

<span class="views-pick">
  <button
    type="button"
    class="bar-btn view-pick-btn"
    bind:this={btn}
    data-file-view-pick
    aria-haspopup="menu"
    aria-expanded={open}
    title={t("files.view.group")}
    aria-label={t("files.view.pick.aria", { name: t(currentView.label) })}
    onclick={() => (open = !open)}
    ><UiIcon name={currentView.icon} size={13} /><UiIcon
      name="chevron-down"
      size={10}
    /></button
  >
  {#if open && btn}
    <ToolbarMenu label={t("files.view.group")} {rows} trigger={btn} align="left" onpick={pick} onclose={close} />
  {/if}
</span>

<style>
  .views-pick {
    flex: 0 0 auto;
    display: inline-flex;
    position: relative;
  }

  .view-pick-btn {
    gap: 1px;
  }
</style>
