<script lang="ts">
  import { settings } from "$lib/settings.svelte.js";
  import { bundleById } from "$lib/automation-presets";
  import {
    reasonText,
    testAutoApproval,
    type AutoApprovalTestResult,
  } from "$lib/settings/model/auto-approval-test";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";

  /** 자동 승인 시험 칸 — 판정을 Rust 에 묻는다(`test_auto_approval` — 실행하지 않는다). 보내는 설정은 저장 전 초안 전체다 */
  let { examples = DEFAULT_EXAMPLES }: { examples?: readonly string[] } = $props();

  const uid = $props.id();

  function nameOf(id: string): string {
    const b = bundleById(id);
    if (!b) return id;
    const k = `settings.automation.bundle.${b.id}.name`;
    const s = t(k as Key);
    return s === k ? b.name : s;
  }

  let command = $state("");
  let result = $state<AutoApprovalTestResult | null>(null);
  let failure = $state<string | null>(null);
  let reqSeq = 0;

  $effect(() => {
    const cmd = command.trim();
    // 초안 설정을 읽어 의존성으로 건다 — 스위치 · 규칙을 바꾸면 다시 묻는다
    const draft = $state.snapshot(settings.current.automation);
    if (cmd === "") {
      reqSeq++;
      result = null;
      failure = null;
      return;
    }
    const my = ++reqSeq;
    const timer = setTimeout(() => {
      testAutoApproval(cmd, draft).then(
        (r) => {
          if (my !== reqSeq) return;
          result = r;
          failure = null;
        },
        (e) => {
          if (my !== reqSeq) return;
          result = null;
          failure = e instanceof Error ? e.message : String(e);
        },
      );
    }, 200);
    return () => clearTimeout(timer);
  });

  const resultText = $derived(
    result ? result.reasons.map((r) => reasonText(r, (k, a) => t(k as Key, a), nameOf)).join(" + ") : "",
  );
</script>

<script module lang="ts">
  const DEFAULT_EXAMPLES = [
    "tail -f /var/log/syslog",
    "cat /etc/hosts",
    "docker ps -a",
    "git fetch origin",
    "ls | grep conf",
    "systemctl restart nginx",
  ];
</script>

<div class="tester">
  <label class="tester-label" for="{uid}-test">{t("settings.automation.test.label")}</label>
  <input
    id="{uid}-test"
    class="value tester-input"
    placeholder={t("settings.automation.test.placeholder")}
    autocomplete="off"
    spellcheck="false"
    bind:value={command}
  />
  <p class="tester-result" role="status" aria-live="polite" data-verdict={result?.verdict ?? ""}>
    {#if result}
      <span class="verdict v-{result.verdict}">{t(`settings.automation.test.verdict.${result.verdict}` as Key)}</span>
      <span class="reason">{resultText}</span>
    {:else if failure}
      <span class="reason">{t("settings.automation.test.failed", { error: failure })}</span>
    {/if}
  </p>
  {#if result && !result.enabled}
    <p class="tester-off">{t("settings.automation.test.off")}</p>
  {/if}
  <div class="examples">
    <span class="examples-label">{t("settings.automation.test.examples")}</span>
    {#each examples as ex (ex)}
      <button type="button" class="example" onclick={() => (command = ex)}>{ex}</button>
    {/each}
  </div>
</div>

<style>
  .tester {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    margin-bottom: var(--space-3);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .tester-label {
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
    color: var(--fg-2);
  }

  .tester-input {
    width: 100%;
    box-sizing: border-box;
    font-family: var(--font-mono, monospace);
  }

  .tester-result {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: var(--space-1) var(--space-2);
    min-height: 1.5em;
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .verdict {
    flex: 0 0 auto;
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-weight: 600;
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .verdict.v-auto {
    color: var(--ok);
    background: color-mix(in srgb, var(--ok) 16%, transparent);
  }

  .verdict.v-manual {
    color: var(--warn);
    background: var(--warn-soft);
  }

  .verdict.v-excluded {
    color: var(--err);
    background: var(--err-soft);
  }

  .reason {
    min-width: 0;
    overflow-wrap: anywhere;
    user-select: text;
  }

  .tester-off {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--warn);
  }

  .examples {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
  }

  .examples-label {
    margin-right: var(--space-1);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .example {
    padding: 1px var(--space-2);
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    line-height: 1.6;
    color: var(--fg-2);
    background: var(--surface-hover);
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .example:hover {
    color: var(--fg-1);
    border-color: var(--line-strong);
  }

  .example:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
</style>
