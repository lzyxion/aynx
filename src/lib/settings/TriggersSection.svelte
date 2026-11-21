<script lang="ts">
  import { tick } from "svelte";
  import { settings, updateTrigger, triggerErrorAt } from "$lib/settings.svelte.js";
  import type { Trigger } from "$lib/triggers";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import SubViewStack from "$lib/settings/SubViewStack.svelte";
  import TriggerEditor from "$lib/settings/TriggerEditor.svelte";

  /**
   * 종류(하이라이트 · 링크 · 툴팁)는 따로 저장하지 않는다 — 칸에 값이 있으면 켜진 것이다. 불리언을 두면 "링크가 켜져 있는데
   * URL 이 비었다" 같은 모순을 파일에 적게 되고 손으로 고친 `settings.toml` 에서 어느 쪽이 진실인지 정할 근거가 없다.
   */

  /** 꺼지면(섹션 이동 · 모달 닫힘) 요약으로 돌아간다 */
  let { active = true }: { active?: boolean } = $props();

  const triggers = $derived(settings.current.triggers);

  // ── 요약 ↔ 하위 화면 ──
  type View = { kind: "summary" } | { kind: "add" } | { kind: "edit"; index: number };
  let view = $state<View>({ kind: "summary" });
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let addBtn = $state<HTMLButtonElement | null>(null);
  /** 같은 편집 화면이라도 다른 줄이면 새로 그린다 */
  const viewKey = $derived(view.kind === "edit" ? `edit-${view.index}` : view.kind);

  function openSub(v: View): void {
    dir = "fwd";
    view = v;
    const p = rootEl?.closest<HTMLElement>(".settings-panel");
    if (p) p.scrollTop = 0;
  }

  async function closeSub(returnFocus: boolean, focusRow: number | null = null): Promise<void> {
    if (view.kind === "summary") return;
    dir = returnFocus ? "back" : null;
    view = { kind: "summary" };
    if (!returnFocus) return;
    await tick();
    const el =
      focusRow === null
        ? addBtn
        : (rootEl?.querySelector<HTMLElement>(`.trg-open[data-index="${focusRow}"]`) ?? addBtn);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  }

  function back(): void {
    void closeSub(true, view.kind === "edit" ? view.index : null);
  }

  const onescape = $derived(view.kind === "summary" ? null : back);

  $effect(() => {
    if (!active) void closeSub(false);
  });

  const hasHighlight = (tr: Trigger) => Boolean(tr.fg || tr.bg);
  const hasLink = (tr: Trigger) => Boolean(tr.url?.trim());
  const hasTooltip = (tr: Trigger) => Boolean(tr.tooltip?.trim());

  function kindsText(tr: Trigger): string {
    const parts: string[] = [];
    if (hasHighlight(tr)) parts.push(t("settings.triggers.kind.highlight"));
    if (hasLink(tr)) parts.push(t("settings.triggers.kind.link"));
    if (hasTooltip(tr)) parts.push(t("settings.triggers.kind.tooltip"));
    return parts.length > 0 ? parts.join(" · ") : t("settings.triggers.row.inert");
  }
</script>

<SubViewStack view={viewKey} {dir} {onescape} bind:root={rootEl}>
  {#if view.kind === "add"}
    <TriggerEditor index={null} onback={back} onsaved={(i) => void closeSub(true, i)} ondeleted={() => void closeSub(true)} />
  {:else if view.kind === "edit"}
    {@const at = view.index}
    <TriggerEditor index={at} onback={back} onsaved={(i) => void closeSub(true, i)} ondeleted={() => void closeSub(true)} />
  {:else}
    <p class="lead">
      <InfoNote id="trg-info" label={t("settings.triggers.subhead")} plain>
        {#snippet summary()}{t("settings.triggers.summary")}{/snippet}
        {#snippet note()}{t("settings.triggers.note")}{/snippet}
      </InfoNote>
    </p>
    <p class="footnote">{t("settings.triggers.footnote")}</p>
    <div class="list-head">
      <h4 class="subhead">{t("settings.triggers.list.subhead")}</h4>
      <button
        type="button"
        id="trg-add"
        class="btn btn-sm btn-secondary trg-add"
        bind:this={addBtn}
        onclick={() => openSub({ kind: "add" })}
      >
        <UiIcon name="plus" size={12} />
        <span>{t("settings.triggers.add.open")}</span>
        <UiIcon name="chevron" size={12} />
      </button>
    </div>

    {#if triggers.length > 0}
      <ul class="slist trg-rows" aria-label={t("settings.triggers.list.aria")}>
        {#each triggers as trigger, i (i)}
          {@const err = triggerErrorAt(i)}
          <li class="slist-row trg-li" class:off={!trigger.enabled} data-trigger-row={i}>
            <button
              type="button"
              class="slist-open trg-open"
              data-index={i}
              aria-label={t("settings.triggers.row.edit.aria", { pattern: trigger.pattern })}
              onclick={() => openSub({ kind: "edit", index: i })}
            >
              <span
                class="slist-lead trg-swatch"
                class:none={!hasHighlight(trigger)}
                style:color={trigger.fg || undefined}
                style:background={trigger.bg || undefined}
                aria-hidden="true">{hasHighlight(trigger) ? "Aa" : ""}</span
              >
              <span class="slist-text">
                <span class="slist-title"><span class="slist-name" title={trigger.pattern}>{trigger.pattern}</span></span>
                <span class="slist-sup">{kindsText(trigger)}</span>
              </span>
            </button>
            <span class="slist-trail">
              <span class="slist-switch">
                <Toggle
                  checked={trigger.enabled}
                  label={t("settings.triggers.item.toggle", { pattern: trigger.pattern })}
                  onchange={(on) => updateTrigger(i, { enabled: on })}
                />
              </span>
              <span class="slist-chev" aria-hidden="true"><UiIcon name="chevron" size={16} /></span>
            </span>
            {#if err}
              <p class="trg-err" role="alert">
                {t("settings.triggers.error.item", { message: err.message })}
              </p>
            {/if}
          </li>
        {/each}
      </ul>
    {:else}
      <p class="slist-empty trg-empty">{t("settings.triggers.empty")}</p>
    {/if}
  {/if}
</SubViewStack>

<style>
  .trg-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .trg-swatch.slist-lead {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1;
  }

  .trg-swatch.none {
    background: transparent;
    border: 1px dashed var(--line);
  }

  /* 44px = 이름 시작선(앞 칸 32 + 틈 12) */
  .trg-err {
    flex: 1 0 100%;
    margin: 0;
    padding: 0 0 var(--space-1) 44px;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--err);
    word-break: keep-all;
  }
</style>
