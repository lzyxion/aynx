<script lang="ts">
  import { onMount, untrack } from "svelte";
  import { sideChatInstructionsSave } from "$lib/context";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import SettingsSubView from "./SettingsSubView.svelte";

  /**
   * **사이드 채팅 지침** 편집(2026-11-01) — 설정 › 지침의 하위 화면. 글은 `<데이터 루트>/sidechat/CLAUDE.md` 하나에 **즉시** 저장한다
   * (지침 편집기와 같은 규칙 — 설정 창 [저장]/[취소]와 무관 · 빈 글이면 파일을 지운다). 싣는 것은 세션 서버가 채팅을 띄울 때 그 파일을
   * 직접 읽어서다(Claude 지침 파일 · Codex `developerInstructions`) — 이 화면은 [반영]이 없다.
   */
  let { text, onback, onsaved }: { text: string; onback: () => void; onsaved: (text: string) => void } = $props();

  const uid = $props.id();
  let body = $state(untrack(() => text));
  let busy = $state(false);
  let error = $state<string | null>(null);
  let closed = false;
  onMount(() => () => { closed = true; });

  async function save(): Promise<void> {
    if (busy) return;
    busy = true;
    error = null;
    const next = body.trim() === "" ? "" : body;
    try {
      await sideChatInstructionsSave(next);
      if (!closed) onsaved(next);
    } catch (e) {
      if (!closed) error = stripReason(typeof e === "string" ? e : e instanceof Error ? e.message : t("settings.instructions.side_chat.error.save"));
    } finally { busy = false; }
  }
</script>

<SettingsSubView title={t("settings.instructions.side_chat.name")}
  back={t("settings.instructions.back")} backAria={t("settings.instructions.back.aria")} {onback}>
  <form onsubmit={(ev) => { ev.preventDefault(); void save(); }}>
    <fieldset class="side-form" disabled={busy}>
      <legend class="sr-only">{t("settings.instructions.side_chat.name")}</legend>
      <textarea id="{uid}-body" class="value body-input" bind:value={body} rows="10" spellcheck="false"
        aria-label={t("settings.instructions.side_chat.name")} aria-describedby="{uid}-help"
        placeholder={t("settings.instructions.side_chat.placeholder")}></textarea>
      <p class="note" id="{uid}-help">{t("settings.instructions.side_chat.help")}</p>
    </fieldset>
    {#if error}<p class="field-error" role="alert">{error}</p>{/if}
    <div class="form-actions">
      <span class="spacer"></span>
      <button type="button" class="btn btn-sm btn-ghost" onclick={onback}>{t("settings.actions.cancel")}</button>
      <button type="submit" class="btn btn-sm btn-primary" disabled={busy || body === text}>{t("settings.actions.save")}</button>
    </div>
  </form>
</SettingsSubView>

<style>
  .side-form { display: flex; flex-direction: column; gap: var(--space-2); min-width: 0; margin: 0; padding: 0; border: 0; }
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  .body-input { box-sizing: border-box; width: 100%; min-width: 0; min-height: 180px; font-family: var(--font-mono); line-height: 1.5; resize: vertical; }
  .note { margin: 0; color: var(--fg-2); font-size: var(--t-xs); line-height: 1.5; }
  .field-error { margin: 0; color: var(--err); font-size: var(--t-xs); overflow-wrap: anywhere; }
  .form-actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--space-2); margin-top: var(--space-3); }
  .spacer { flex: 1 1 auto; }
</style>
