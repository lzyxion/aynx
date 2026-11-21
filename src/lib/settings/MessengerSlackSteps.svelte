<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Key } from "$lib/i18n/keys";
  import { writeClipboard } from "$lib/clipboard";
  import { toast } from "$lib/toast.svelte.js";
  import { codeSpans, SLACK_MANIFEST } from "$lib/settings/messenger-view";

  const STEPS: readonly Key[] = [
    "settings.messenger.slack.bot.step1",
    "settings.messenger.slack.bot.step2",
    "settings.messenger.slack.bot.step3",
  ];

  async function copyManifest() {
    if (await writeClipboard(SLACK_MANIFEST)) toast.success(t("settings.messenger.slack.manifest.copied"));
    else toast.error(t("settings.messenger.slack.manifest.copyFailed"));
  }
</script>

<ol class="steps" data-messenger-slack-steps>
  {#each STEPS as key, i (key)}
    <li>
      <span
        >{#each codeSpans(t(key)) as part, j (j)}{#if part.code}<code>{part.text}</code>{:else}{part.text}{/if}{/each}</span
      >
      {#if i === 0}
        <button
          type="button"
          class="btn btn-sm btn-secondary"
          id="messenger-slack-manifest-copy"
          onclick={() => void copyManifest()}>{t("settings.messenger.slack.manifest.copy")}</button
        >
      {/if}
    </li>
  {/each}
</ol>

<style>
  .steps {
    flex: 1 1 100%;
    display: grid;
    gap: var(--space-1);
    margin: var(--space-2) 0 0;
    padding: 0;
    list-style: none;
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--fg-3);
    word-break: keep-all;
    counter-reset: step;
  }

  .steps li {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1) var(--space-2);
    counter-increment: step;
  }

  .steps li::before {
    content: counter(step);
    flex: none;
    display: grid;
    place-items: center;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    font-size: 10px;
    color: var(--fg-2);
    background: var(--m3-surface-container-highest);
  }

  .steps li > span {
    flex: 1 1 220px;
    min-width: 0;
  }

  .steps code {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
  }
</style>
