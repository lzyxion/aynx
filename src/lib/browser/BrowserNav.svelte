<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /** 갈 곳이 없어도 숨기지 않고 비활성으로 둔다 — 숨기면 줄 폭이 흔들려 경로 칸이 눌릴 때마다 옆으로 움직인다 */
  let {
    canBack = false,
    canForward = false,
    disabled = false,
    onback,
    onforward,
  }: {
    canBack?: boolean;
    canForward?: boolean;
    disabled?: boolean;
    onback: () => void;
    onforward: () => void;
  } = $props();
</script>

<span class="nav">
  <button
    type="button"
    class="bar-btn"
    title={t("files.toolbar.back.title")}
    aria-label={t("files.toolbar.back")}
    disabled={disabled || !canBack}
    onclick={onback}><UiIcon name="chevron-left" size={14} /></button
  >
  <button
    type="button"
    class="bar-btn"
    title={t("files.toolbar.forward.title")}
    aria-label={t("files.toolbar.forward")}
    disabled={disabled || !canForward}
    onclick={onforward}><UiIcon name="chevron" size={14} /></button
  >
</span>

<style>
  .nav {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: 2px;
  }
</style>
