<script lang="ts">
  import { settings, setBundleEnabled, setBundleCommandEnabled } from "$lib/settings.svelte.js";
  import {
    BUNDLE_GROUPS,
    bundleById,
    bundleCommands,
    isCommandOff,
    type AutomationBundle,
    type BundleCommand,
  } from "$lib/automation-presets";
  import { ruleConstraintText } from "$lib/settings/rule-text";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import AutomationTester from "$lib/settings/AutomationTester.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { isRemote } from "$lib/ipc";

  /**
   * 묶음 편집 — 설정 › 자동 승인의 하위 화면(docs/log/2026-10-05-auto-approve-args.md).
   * 명령 끄기는 좁히기만 한다(`[automation.bundle_off]`) — 묶음을 꺼도 명령 스위치는 남아 다시 켜면 그대로다.
   */
  let { onback }: { onback: () => void } = $props();

  const auto = $derived(settings.current.automation);
  const uid = $props.id();
  /** 원격 창은 볼 수만 있다 */
  const lockTip = $derived(isRemote ? t("settings.remote.homeOnly") : undefined);

  // ── 묶음 이름 · 설명 ──
  function bundleName(b: AutomationBundle): string {
    const k = `settings.automation.bundle.${b.id}.name`;
    const s = t(k as Key);
    return s === k ? b.name : s;
  }
  function bundleDesc(b: AutomationBundle): string {
    const k = `settings.automation.bundle.${b.id}.description`;
    const s = t(k as Key);
    return s === k ? b.description : s;
  }

  // ── 펼침(저장하지 않는다) ──
  let open = $state<Record<string, boolean>>({});

  // ── 명령 줄의 흐린 제약 글자 ──
  function commandText(c: BundleCommand): [string, string] {
    const one = (full: boolean) =>
      c.rules
        .map((r) => ruleConstraintText(r, full))
        .filter((s) => s !== "")
        .join(full ? "\n" : " / ");
    return [one(false), one(true)];
  }
</script>

<SettingsSubView
  title={t("settings.automation.bundles.title")}
  back={t("settings.automation.bundles.back")}
  backAria={t("settings.automation.bundles.back.aria")}
  {onback}
>
<AutomationTester />

{#each BUNDLE_GROUPS as g (g.id)}
  <h5 class="group-head">{t(`settings.automation.bundles.group.${g.id}` as Key)}</h5>
  {#if g.caution}
    <p class="caution" role="note">
      <UiIcon name="warning" size={13} />
      <span>{t("settings.automation.bundles.caution")}</span>
    </p>
  {/if}
  <ul class="bundle-rows">
    {#each g.bundles as id (id)}
      {@const b = bundleById(id)}
      {#if b}
        {@const cmds = bundleCommands(b)}
        {@const on = auto.bundles.includes(id)}
        {@const onCount = cmds.filter((c) => !isCommandOff(auto.bundle_off, id, c.key)).length}
        {@const expanded = open[id] === true}
        <li class="bundle-row" class:on data-bundle={id}>
          <div class="row-main">
            <button
              type="button"
              class="exp"
              aria-expanded={expanded}
              aria-controls="{uid}-{id}-cmds"
              aria-label={t("settings.automation.bundles.expand.aria", { name: bundleName(b) })}
              onclick={() => (open[id] = !expanded)}
            >
              <UiIcon name="chevron" size={14} />
            </button>
            <div class="row-text">
              <span class="row-name">{bundleName(b)}</span>
              <span class="row-desc">{bundleDesc(b)}</span>
            </div>
            <span class="row-count">{t("settings.automation.bundles.count", { on: onCount, total: cmds.length })}</span>
            <Toggle
              checked={on}
              label={t("settings.automation.bundles.toggle.aria", { name: bundleName(b) })}
              disabled={isRemote}
              title={lockTip}
              onchange={(v) => setBundleEnabled(id, v)}
            />
          </div>
          {#if expanded}
            <ul class="cmd-list" id="{uid}-{id}-cmds">
              {#each cmds as c (c.key)}
                {@const [cons, consFull] = commandText(c)}
                {@const cmdOn = !isCommandOff(auto.bundle_off, id, c.key)}
                <li class="cmd-row" class:off={!cmdOn} data-key={c.key}>
                  <span class="mini">
                    <Toggle
                      checked={cmdOn}
                      label={t("settings.automation.bundles.command.aria", { name: bundleName(b), cmd: c.key })}
                      disabled={isRemote}
                      title={lockTip}
                      onchange={(v) => setBundleCommandEnabled(id, c.key, v)}
                    />
                  </span>
                  <code class="cmd-name">{c.key}</code>
                  {#if cons}<span class="cmd-cons" title={consFull}>{cons}</span>{/if}
                </li>
              {/each}
            </ul>
          {/if}
        </li>
      {/if}
    {/each}
  </ul>
{/each}
</SettingsSubView>

<style>
  .exp:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  .group-head {
    margin: var(--space-4) 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--fg-2);
  }

  .caution {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: calc(-1 * var(--space-1)) 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .caution :global(svg) {
    flex: 0 0 auto;
    color: var(--warn);
    transform: translateY(2px);
  }

  .bundle-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .bundle-row + .bundle-row {
    border-top: 1px solid var(--line);
  }

  .row-main {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-2) var(--space-3) var(--space-2) var(--space-1);
    min-height: 40px;
  }

  .exp {
    flex: 0 0 auto;
    width: 24px;
    height: 24px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .exp:hover {
    color: var(--fg-1);
    background: var(--surface-hover);
  }

  .exp :global(svg) {
    transition: transform 160ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }

  .exp[aria-expanded="true"] :global(svg) {
    transform: rotate(90deg);
  }

  .row-text {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .row-name {
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    font-weight: 500;
    color: var(--fg-1);
  }

  .row-desc {
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.45;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .row-count {
    flex: 0 0 auto;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
    font-variant-numeric: tabular-nums;
  }

  .cmd-list {
    list-style: none;
    margin: 0;
    padding: 0 var(--space-3) var(--space-2) calc(var(--space-1) + 24px + var(--space-2));
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .cmd-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 24px;
    min-width: 0;
  }

  .bundle-row:not(.on) .cmd-row,
  .cmd-row.off {
    opacity: 0.6;
  }

  .mini {
    flex: 0 0 auto;
    display: inline-flex;
    width: 40px;
    justify-content: center;
  }

  .cmd-name {
    flex: 0 0 auto;
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    color: var(--fg-1);
  }

  .cmd-cons {
    min-width: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @media (prefers-reduced-motion: reduce) {
    .exp :global(svg) {
      transition: none;
    }
  }
</style>
