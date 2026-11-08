<script lang="ts">
  // **완료되면 자동 병합** 칸 — [새 앨범] · [앨범 권한]의 검증 칸 아래. 검증 명령이 없으면 꺼진 채 비활성(서버도 `no-verify-command` 로 거절한다).
  import { t } from "$lib/i18n/i18n.svelte.js";
  import Toggle from "$lib/Toggle.svelte";

  let {
    checked = $bindable(false),
    enabled,
    tag,
    onchange,
  }: { checked?: boolean; enabled: boolean; tag: string; onchange?: () => void } = $props();
  const id = $props.id();
</script>

<div class="opt" data-auto-merge={tag} data-auto-merge-enabled={enabled ? "" : undefined}>
  <label class="text" for={id}>
    <b>{t("orch.merge.auto.title")}</b>
    <span>{t(enabled ? "orch.merge.auto.text" : "orch.merge.auto.needVerify")}</span>
  </label>
  <Toggle {id} checked={enabled && checked} disabled={!enabled} label={t("orch.merge.auto.title")}
    onchange={(v: boolean) => { checked = v; onchange?.(); }} />
</div>

<style>
  .opt { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; min-width: 0; }
  .text { display: grid; gap: 2px; min-width: 0; font-size: var(--t-xs); line-height: 1.5; color: var(--fg-3); }
  b { font-size: var(--t-sm); font-weight: var(--fw-semibold); color: var(--fg-1); }
</style>
