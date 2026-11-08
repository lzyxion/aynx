<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * **파일 타일의 뒤로 · 앞으로** — 도구줄 맨 앞(2026-10-20 B안에서 `BrowserToolbar` 에서 꺼냈다).
   *
   * 머리줄이 서 있으면 머리줄 **맨 앞**(타일 아이콘 앞 — `pane/pane-tools.svelte.ts` 의 `lead`)에, 아니면 도구줄 맨 앞에 선다 — 브라우저 ·
   * 탐색기가 전부 그 자리에 둔다. 갈 곳이 없으면 흐리게 비활성으로 남긴다(숨기면 줄 폭이 흔들려 경로 칸이 눌릴 때마다 옆으로 움직인다).
   * 그림은 `UiIcon` — 경로 칸의 구분자도 같은 `chevron` 이라 한 가족으로 읽힌다. 단추 모양은 전역 `.bar-btn`(`BrowserToolbar`).
   */
  let {
    canBack = false,
    canForward = false,
    disabled = false,
    onback,
    onforward,
  }: {
    canBack?: boolean;
    canForward?: boolean;
    /** 통째로 못 쓰는 상태 (원격 타일의 연결 끊김) */
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
