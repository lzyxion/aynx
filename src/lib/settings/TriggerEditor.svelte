<script lang="ts">
  import { untrack } from "svelte";
  import {
    settings,
    insertTrigger,
    replaceTrigger,
    removeTrigger,
    DEFAULT_TRIGGER_BG,
    MAX_TRIGGERS,
  } from "$lib/settings.svelte.js";
  import { TRIGGER_EXAMPLES, isExampleAdded, type TriggerExample } from "$lib/settings/model/example-triggers";
  import {
    canSaveForm,
    emptyTriggerForm,
    exampleToForm,
    formToTrigger,
    isInert,
    patternError,
    triggerToForm,
    urlWarning,
    type TriggerForm,
  } from "$lib/settings/model/trigger-form";
  import { toHex } from "$lib/settings/color";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import TriggerTester from "$lib/settings/TriggerTester.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 트리거 **추가 · 편집** — 설정 › 트리거의 하위 화면 (docs/log/2026-10-05-trigger-examples.md "하위 화면으로").
   *
   * 요약(`TriggersSection`)의 [트리거 추가 ›] 또는 줄 누르기가 연다. 틀(`SettingsSubView`)은 자동 승인과 공용이고,
   * 움직임 · Escape · 돌아온 뒤 포커스는 요약이 맡는다. 위에서부터: (추가만) 예시 카드 · 규칙 칸 · 시험 칸 · 단추.
   *
   * - **칸은 이 화면 안에만 산다** — [추가] · [저장] 을 눌러야 초안(`settings.current.triggers`)에 쓴다. 자동 승인의
   *   허용 패턴 편집처럼 칸마다 그 자리에서 쓰지 않는 이유: 트리거는 즉시 반영이라(터미널이 초안을 구독) 정규식을
   *   치는 도중의 반쪽 패턴이 열린 터미널마다 칠해진다. [취소] · 뒤로 · Escape 는 아무것도 쓰지 않는다.
   * - 예시 카드는 **틀**이다 — 고르면 규칙 칸이 그 예시로, 시험 칸이 그 예시의 샘플 줄로 채워진다. 같은 패턴이 이미
   *   목록에 있으면 ✓ 만 달고 고를 수는 있다.
   * - 종류(하이라이트 · 링크 · 툴팁)는 칸의 값이다 — 색 둘 다 지우면 하이라이트 없음, 링크 · 툴팁 칸이 비면 그 종류 없음.
   */
  let {
    index,
    onback,
    onsaved,
    ondeleted,
  }: {
    /** 고칠 항목의 위치 — `null` 이면 추가 */
    index: number | null;
    /** [취소] · 뒤로 · Escape — 아무것도 쓰지 않고 요약으로 */
    onback: () => void;
    /** [추가] · [저장] 뒤 — 넣거나 고친 항목의 위치 */
    onsaved: (index: number) => void;
    ondeleted: () => void;
  } = $props();

  const uid = $props.id();
  const adding = $derived(index === null);

  /** 편집 시작 시점의 켜짐 — [저장] 은 켜고 끄기를 건드리지 않는다(그건 요약 줄의 스위치다) */
  const startEnabled = untrack(() => (index === null ? true : (settings.current.triggers[index]?.enabled ?? true)));
  let form = $state<TriggerForm>(
    untrack(() => {
      const cur = index === null ? undefined : settings.current.triggers[index];
      return cur ? triggerToForm(cur) : emptyTriggerForm();
    }),
  );
  let testText = $state("");
  /** 고른 예시 카드 — `"blank"` = 빈 트리거 */
  let picked = $state<string>("blank");
  /** 패턴 칸을 한 번이라도 만졌는가 — 처음 열린 빈 칸에 "패턴을 적으세요" 를 띄우지 않는다 */
  let touched = $state(false);

  const triggers = $derived(settings.current.triggers);
  const pErr = $derived(patternError(form.pattern));
  const showPErr = $derived(pErr !== null && (pErr.code === "regex" || touched || !adding));
  const uWarn = $derived(urlWarning(form.url));
  const full = $derived(adding && triggers.length >= MAX_TRIGGERS);
  const canCommit = $derived(canSaveForm(form) && !full);

  // 편집 중인 항목이 바깥에서 사라지면(설정 [취소] 로 되돌림 등) 요약으로 — 없는 자리에 쓰지 않게.
  $effect(() => {
    if (index !== null && !settings.current.triggers[index]) untrack(onback);
  });

  function pickBlank(): void {
    form = emptyTriggerForm();
    testText = "";
    picked = "blank";
    touched = false;
  }

  function pickExample(ex: TriggerExample): void {
    form = exampleToForm(ex);
    testText = ex.sample;
    picked = ex.id;
    touched = false;
  }

  function commit(): void {
    if (!canCommit) {
      touched = true;
      return;
    }
    const tr = formToTrigger(form, startEnabled);
    if (index === null) {
      const at = insertTrigger(tr);
      if (at >= 0) onsaved(at);
    } else {
      replaceTrigger(index, tr);
      onsaved(index);
    }
  }

  function remove(): void {
    if (index === null) return;
    removeTrigger(index);
    ondeleted();
  }

  /** 한 줄 칸에서 Enter = [추가]/[저장] (설정 화면은 `<form>` 이 아니라 직접 받는다) */
  function onFieldKey(e: KeyboardEvent): void {
    if (e.key !== "Enter" || e.isComposing) return;
    // 글자 칸에서만 — 단추(색 지우기)의 Enter 는 그 단추 몫이다.
    if (!(e.target instanceof HTMLInputElement) || e.target.type === "color") return;
    e.preventDefault();
    commit();
  }

  const pErrText = $derived(
    pErr === null
      ? ""
      : pErr.code === "empty"
        ? t("settings.triggers.err.pattern.empty")
        : t("settings.triggers.error.draft", { message: pErr.message }),
  );
  const uWarnText = $derived(
    uWarn === null
      ? ""
      : uWarn.code === "invalid"
        ? t("settings.triggers.link.warn.invalid")
        : t("settings.triggers.link.warn.scheme", { scheme: uWarn.scheme }),
  );
</script>

{#snippet swatch(fg: string | null | undefined, bg: string | null | undefined)}
  <span class="ex-swatch" class:none={!fg && !bg} style:color={fg ?? undefined} style:background={bg ?? undefined} aria-hidden="true"
    >{fg || bg ? "Aa" : ""}</span
  >
{/snippet}

<SettingsSubView
  title={adding ? t("settings.triggers.title.add") : t("settings.triggers.title.edit")}
  back={t("settings.triggers.back")}
  backAria={t("settings.triggers.back.aria")}
  {onback}
>
  {#if adding}
    <h5 class="group-head">{t("settings.triggers.start.head")}</h5>
    <div class="ex-grid" role="group" aria-label={t("settings.triggers.start.head")}>
      <button
        type="button"
        class="ex-card"
        class:sel={picked === "blank"}
        aria-pressed={picked === "blank"}
        data-example="blank"
        onclick={pickBlank}
      >
        {@render swatch(null, null)}
        <span class="ex-text">
          <span class="ex-name">{t("settings.triggers.start.blank")}</span>
          <span class="ex-desc">{t("settings.triggers.start.blank.desc")}</span>
        </span>
      </button>
      {#each TRIGGER_EXAMPLES as ex (ex.id)}
        {@const added = isExampleAdded(triggers, ex)}
        <button
          type="button"
          class="ex-card"
          class:sel={picked === ex.id}
          aria-pressed={picked === ex.id}
          data-example={ex.id}
          title={ex.trigger.pattern}
          onclick={() => pickExample(ex)}
        >
          {@render swatch(ex.trigger.fg, ex.trigger.bg)}
          <span class="ex-text">
            <span class="ex-name">{t(ex.name)}</span>
            <span class="ex-desc">{t(ex.desc)}</span>
          </span>
          {#if added}
            <span class="ex-added" title={t("settings.triggers.examples.added.title")} data-added
              ><UiIcon name="check" size={12} /><span class="sr-only"
                >{t("settings.triggers.examples.added")}</span
              ></span
            >
          {/if}
        </button>
      {/each}
    </div>
    <h5 class="group-head">{t("settings.triggers.rule.head")}</h5>
  {/if}

  <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
  <section class="rule-form" aria-label={t("settings.triggers.rule.head")} onkeydown={onFieldKey}>
    <div class="ff" data-field="pattern">
      <TipName
        id="{uid}-pattern-name"
        for="{uid}-pattern"
        label={t("settings.triggers.f.pattern")}
        tip={t("settings.triggers.f.pattern.tip")}
      />
      <input
        id="{uid}-pattern"
        class="value"
        class:bad={showPErr}
        value={form.pattern}
        placeholder={String.raw`\bERROR\b`}
        autocomplete="off"
        spellcheck="false"
        aria-invalid={showPErr ? "true" : undefined}
        aria-describedby={showPErr ? `${uid}-pattern-err` : undefined}
        oninput={(e) => {
          form.pattern = e.currentTarget.value;
          touched = true;
        }}
      />
      {#if showPErr}<p class="field-err" id="{uid}-pattern-err" role="alert">{pErrText}</p>{/if}
    </div>

    <div class="ff" data-field="colors">
      <TipName
        id="{uid}-colors-name"
        for="{uid}-fg"
        label={t("settings.triggers.f.colors")}
        tip={t("settings.triggers.kind.highlight.title")}
      />
      <div class="trg-colors">
        <span class="trg-sample" style:color={form.fg ?? undefined} style:background={form.bg ?? undefined} aria-hidden="true"
          >{t("settings.triggers.sample")}</span
        >
        <span class="trg-color">
          <span class="hint">{t("settings.triggers.color.fg")}</span>
          <input
            id="{uid}-fg"
            class="swatch"
            class:unset={!form.fg}
            type="color"
            aria-label={t("settings.triggers.color.fg.aria")}
            value={toHex(form.fg ?? "#d6d8de")}
            oninput={(e) => (form.fg = e.currentTarget.value)}
          />
          <button
            type="button"
            class="btn btn-sm btn-ghost icon"
            disabled={!form.fg}
            title={t("settings.triggers.color.fg.clear.title")}
            aria-label={t("settings.triggers.color.fg.clear.aria")}
            onclick={() => (form.fg = null)}><UiIcon name="reset" size={13} /></button
          >
        </span>
        <span class="trg-color">
          <span class="hint">{t("settings.triggers.color.bg")}</span>
          <input
            class="swatch"
            class:unset={!form.bg}
            type="color"
            aria-label={t("settings.triggers.color.bg.aria")}
            value={toHex(form.bg ?? DEFAULT_TRIGGER_BG)}
            oninput={(e) => (form.bg = e.currentTarget.value)}
          />
          <button
            type="button"
            class="btn btn-sm btn-ghost icon"
            disabled={!form.bg}
            title={t("settings.triggers.color.bg.clear.title")}
            aria-label={t("settings.triggers.color.bg.clear.aria")}
            onclick={() => (form.bg = null)}><UiIcon name="reset" size={13} /></button
          >
        </span>
      </div>
    </div>

    <div class="ff" data-field="url">
      <TipName
        id="{uid}-url-name"
        for="{uid}-url"
        label={t("settings.triggers.kind.link")}
        tip={t("settings.triggers.kind.link.title")}
      />
      <input
        id="{uid}-url"
        class="value"
        value={form.url}
        aria-label={t("settings.triggers.link.aria")}
        placeholder="https://jira.example.com/browse/$1"
        autocomplete="off"
        spellcheck="false"
        oninput={(e) => (form.url = e.currentTarget.value)}
      />
      {#if uWarn}<p class="field-warn" data-warn="url">{uWarnText}</p>{/if}
    </div>

    <div class="ff" data-field="tooltip">
      <TipName
        id="{uid}-tooltip-name"
        for="{uid}-tooltip"
        label={t("settings.triggers.kind.tooltip")}
        tip={t("settings.triggers.kind.tooltip.title")}
      />
      <input
        id="{uid}-tooltip"
        class="value"
        value={form.tooltip}
        aria-label={t("settings.triggers.tooltip.aria")}
        placeholder={t("settings.triggers.tooltip.placeholder")}
        autocomplete="off"
        oninput={(e) => (form.tooltip = e.currentTarget.value)}
      />
    </div>

    {#if isInert(form)}
      <p class="note" data-note="inert">{t("settings.triggers.inert")}</p>
    {/if}
  </section>

  <TriggerTester {form} bind:text={testText} />

  <div class="form-actions">
    {#if !adding}
      <button
        type="button"
        class="btn btn-sm btn-ghost del"
        aria-label={t("settings.triggers.item.delete.aria", { pattern: form.pattern })}
        onclick={remove}>{t("settings.triggers.delete")}</button
      >
    {/if}
    <span class="spacer"></span>
    {#if full}
      <span class="full-why" role="note">{t("settings.triggers.error.full", { max: MAX_TRIGGERS })}</span>
    {/if}
    <button type="button" class="btn btn-sm btn-ghost cancel" onclick={onback}>{t("settings.triggers.cancel")}</button>
    <button type="button" class="btn btn-sm btn-primary commit" disabled={!canCommit} onclick={commit}
      >{adding ? t("settings.triggers.commit.add") : t("settings.triggers.commit.save")}</button
    >
  </div>
</SettingsSubView>

<style>
  .group-head {
    margin: var(--space-3) 0 var(--space-2);
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--fg-2);
  }

  .group-head:first-of-type {
    margin-top: 0;
  }

  /* 예시 카드 — 좁으면 한 줄에 하나, 넓으면 서넛 */
  .ex-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
    gap: var(--space-2);
  }

  .ex-card {
    position: relative;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    padding: var(--space-2);
    text-align: left;
    color: var(--fg-1);
    background: transparent;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    cursor: pointer;
  }

  .ex-card:hover:not(.sel) {
    background: var(--surface-hover);
  }

  .ex-card.sel {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .ex-card:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 색 견본 — 요약 줄 · 표본(`.trg-sample`)과 같은 결. 색이 없는 예시(링크 · 툴팁만)는 점선 빈 칸 */
  .ex-swatch {
    flex: 0 0 auto;
    box-sizing: border-box;
    width: 28px;
    height: 18px;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 16px;
    text-align: center;
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .ex-swatch.none {
    border-style: dashed;
  }

  .ex-text {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-width: 0;
    gap: 1px;
  }

  .ex-name,
  .ex-desc {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .ex-name {
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 500;
  }

  .ex-desc {
    font-family: var(--font-ui);
    font-size: 11px;
    color: var(--fg-3);
  }

  .ex-added {
    flex: 0 0 auto;
    display: inline-flex;
    color: var(--ok);
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  /* 규칙 칸 — 허용 패턴 편집(`AutomationAllow`)의 폼과 같은 결: 이름 | 칸, 좁으면 이름이 위로 */
  .rule-form {
    container-type: inline-size;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
  }

  .ff {
    display: grid;
    grid-template-columns: 7em minmax(0, 1fr);
    align-items: center;
    column-gap: var(--space-3);
    row-gap: 2px;
  }

  .ff > :global(.name) {
    justify-self: start;
    cursor: help;
  }

  .ff > :global(.name:focus-visible) {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: 2px;
  }

  .ff > .value,
  .ff > .trg-colors,
  .field-err,
  .field-warn {
    grid-column: 2;
  }

  .ff > .value.bad {
    border-color: var(--err);
  }

  .field-err,
  .field-warn {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    word-break: keep-all;
  }

  .field-err {
    color: var(--err);
  }

  .field-warn {
    color: var(--warn);
  }

  @container (max-width: 420px) {
    .ff {
      grid-template-columns: minmax(0, 1fr);
    }

    .ff > .value,
    .ff > .trg-colors,
    .field-err,
    .field-warn {
      grid-column: 1;
    }
  }

  .trg-colors {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2) var(--space-3);
  }

  .trg-color {
    display: flex;
    align-items: center;
    gap: var(--space-1);
  }

  /* 안 쓰는 색 — 고르개는 기본값을 보여 주지만 흐리게(지금은 칠하지 않는다는 뜻) */
  .swatch.unset {
    opacity: 0.4;
  }

  .trg-color .hint {
    margin-top: 0;
  }

  .trg-sample {
    padding: 2px var(--space-2);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    white-space: nowrap;
  }

  .note {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .form-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    margin-top: var(--space-3);
  }

  .spacer {
    flex: 1 1 auto;
  }

  .full-why {
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--err);
  }

  .del {
    color: var(--fg-2);
  }

  .del:hover {
    color: var(--err);
    background: var(--err-soft);
  }
</style>
