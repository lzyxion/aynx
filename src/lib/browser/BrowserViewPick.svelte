<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import type { FileView } from "$lib/session";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { displayCombo, effectiveCombo } from "$lib/keybindings";
  import { settings } from "$lib/settings.svelte.js";
  import { runOnMenu } from "$lib/browser/menu-runner";
  import ToolbarMenu from "$lib/browser/ToolbarMenu.svelte";
  import type { ToolbarMenuRow } from "$lib/browser/toolbar-tools";

  let {
    view = "details",
    onview,
  }: {
    view?: FileView;
    onview?: (view: FileView) => void;
  } = $props();

  /** 순서가 곧 `Ctrl+1/2/3` 이다 */
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
      hint: displayCombo(effectiveCombo(VIEW_ACTION[v.view], settings.keybindings)),
      checked: view === v.view,
      radio: true,
    })),
  );

  let open = $state(false);
  let btn = $state<HTMLButtonElement | null>(null);

  function close(back: boolean) {
    open = false;
    if (back) btn?.focus({ preventScroll: true });
  }

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
