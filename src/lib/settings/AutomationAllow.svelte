<script lang="ts">
  import { tick, untrack } from "svelte";
  import {
    settings,
    addAllowPattern,
    removeAllowPattern,
    setAllowPattern,
    setAllowRule,
    addAllowRule,
    removeAllowRule,
    type AllowRule,
  } from "$lib/settings.svelte.js";
  import { cloneAllowRule, sameAllowRules } from "$lib/settings-codec";
  import {
    MAX_ARGS_LIMIT,
    emptyForm,
    formToRule,
    hasErrors,
    isWideRule,
    ruleToForm,
    splitList,
    validateForm,
    validatePattern,
    type AllowRuleForm,
    type FieldError,
  } from "$lib/settings/model/allow-rule-form";
  import { classifyRisk } from "$lib/operations";
  import { ruleConstraintText, ruleName } from "$lib/settings/rule-text";
  import SettingsSubView from "$lib/settings/SettingsSubView.svelte";
  import AutomationTester from "$lib/settings/AutomationTester.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import Toggle from "$lib/Toggle.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";

  /**
   * **허용 패턴 편집** — 설정 › 자동 승인의 하위 화면 (docs/log/2026-10-05-auto-approve-args.md "허용 패턴 편집").
   *
   * 요약(`AutomationSection`)의 [편집 ›] 이 연다. 틀(`SettingsSubView`)과 시험 칸(`AutomationTester`)은 묶음 편집과
   * 공용이고, 움직임·Escape·돌아온 뒤 포커스는 요약이 맡는다. 위에서부터: 시험 칸 · 규칙 목록 · 고른 줄의 폼.
   *
   * - 목록은 사용자 구조적 규칙(`[[automation.allow]]`)과 간단 패턴(`allow_patterns` — 문자열 접두)을 '규칙'/'간단'
   *   표시로 한 줄씩 보인다. "승인하면서 배우기"(`addAllowRules`)가 더한 규칙도 같은 목록에 그대로 선다.
   * - **있는 줄의 편집은 다른 설정처럼 그 자리에서 초안에 쓴다**(미리보기 → [저장]/[취소]). 검증에 걸린 동안은 쓰지
   *   않고 칸 아래에 이유 한 줄을 단다. **새 줄은 [추가] 를 눌러야 들어간다** — 칸을 채우는 도중의 반쪽 규칙
   *   (`git` 만 적은 순간 = git 전부)이 초안에 서지 않게.
   * - 손대지 않은 칸은 불러온 규칙의 값을 글자 그대로 남긴다(`formToRule` 의 `base`) — 옛 모양 규칙(`sub_first` 없음)은
   *   꺼진 채로 보이고, 고친 칸만 바뀐다.
   * - 다른 곳에서 초안이 바뀌면([취소] · 배우기) 고른 줄의 폼을 다시 읽는다.
   */
  let { onback }: { onback: () => void } = $props();

  const uid = $props.id();
  const auto = $derived(settings.current.automation);

  type Sel =
    | { kind: "rule"; index: number }
    | { kind: "pattern"; index: number }
    | { kind: "new-rule" }
    | { kind: "new-pattern" }
    | null;

  let sel = $state<Sel>(null);
  let form = $state<AllowRuleForm>(emptyForm());
  let patternText = $state("");
  /** 편집을 시작할 때 불러온 규칙 — 손대지 않은 칸은 이 값을 그대로 남긴다. 새 규칙이면 없음. */
  let base = $state.raw<AllowRule | null>(null);
  /** 마지막으로 불러오거나 쓴 값 — 초안이 이것과 달라지면 바깥에서 바뀐 것이라 폼을 다시 읽는다. */
  let lastRule: AllowRule | null = null;
  let lastPattern: string | null = null;

  let addRuleBtn = $state<HTMLButtonElement | null>(null);
  let formEl = $state<HTMLElement | null>(null);

  const isRuleSel = $derived(sel?.kind === "rule" || sel?.kind === "new-rule");
  const isPatternSel = $derived(sel?.kind === "pattern" || sel?.kind === "new-pattern");
  const errors = $derived(isRuleSel ? validateForm(form) : {});
  /** 폼이 지금 뜻하는 규칙 — 검증을 통과했을 때만(미리보기·경고가 쓴다). */
  const formRule = $derived(isRuleSel && !hasErrors(errors) ? formToRule(form, base) : null);
  const patternErr = $derived.by(() => {
    if (!isPatternSel) return null;
    const others = auto.allow_patterns.filter((_, i) => !(sel?.kind === "pattern" && i === sel.index));
    return validatePattern(patternText, others);
  });
  const subFirstDisabled = $derived(splitList(form.subcommands).length === 0 && base?.sub_first !== true);
  const dangerous = $derived.by(() => {
    if (isRuleSel) {
      const exec = form.exec.trim();
      return exec !== "" && classifyRisk(exec) === "dangerous";
    }
    if (isPatternSel) {
      const p = patternText.trim();
      return p !== "" && classifyRisk(p) === "dangerous";
    }
    return false;
  });

  // ── 고르기 ──
  function selectRule(i: number): void {
    const r = settings.current.automation.allow[i];
    if (!r) return;
    base = cloneAllowRule(r);
    lastRule = cloneAllowRule(r);
    form = ruleToForm(r);
    sel = { kind: "rule", index: i };
  }

  function selectPattern(i: number): void {
    const p = settings.current.automation.allow_patterns[i];
    if (p === undefined) return;
    patternText = p;
    lastPattern = p;
    sel = { kind: "pattern", index: i };
  }

  async function focusFirstField(): Promise<void> {
    await tick();
    formEl?.querySelector<HTMLInputElement>("input.value")?.focus();
  }

  function newRule(): void {
    base = null;
    lastRule = null;
    form = emptyForm();
    sel = { kind: "new-rule" };
    void focusFirstField();
  }

  function newPattern(): void {
    patternText = "";
    lastPattern = null;
    sel = { kind: "new-pattern" };
    void focusFirstField();
  }

  // ── 쓰기 — 있는 줄은 그 자리에서, 새 줄은 [추가] 로 ──
  function applyRule(): void {
    if (sel?.kind !== "rule") return;
    if (hasErrors(validateForm(form))) return;
    const r = formToRule(form, base);
    const cur = settings.current.automation.allow[sel.index];
    lastRule = cloneAllowRule(r);
    if (cur && sameAllowRules([cur], [r])) return;
    setAllowRule(sel.index, r);
  }

  function setField(key: Exclude<keyof AllowRuleForm, "sub_first">, value: string): void {
    form[key] = value;
    applyRule();
  }

  function setSubFirst(on: boolean): void {
    form.sub_first = on;
    applyRule();
  }

  function commitNewRule(): void {
    if (sel?.kind !== "new-rule" || hasErrors(validateForm(form))) return;
    const i = addAllowRule(formToRule(form, null));
    selectRule(i);
    void focusFirstField();
  }

  function onPatternInput(value: string): void {
    patternText = value;
    if (sel?.kind !== "pattern" || patternErr !== null) return;
    lastPattern = value.trim();
    setAllowPattern(sel.index, value);
  }

  function commitNewPattern(): void {
    if (sel?.kind !== "new-pattern" || patternErr !== null) return;
    if (!addAllowPattern(patternText)) return;
    selectPattern(settings.current.automation.allow_patterns.length - 1);
    void focusFirstField();
  }

  function onFormKey(e: KeyboardEvent): void {
    if (e.key !== "Enter" || e.isComposing) return;
    if (sel?.kind === "new-rule") {
      e.preventDefault();
      commitNewRule();
    } else if (sel?.kind === "new-pattern") {
      e.preventDefault();
      commitNewPattern();
    }
  }

  async function removeSelected(): Promise<void> {
    const s = sel;
    if (s?.kind === "rule") removeAllowRule(s.index);
    else if (s?.kind === "pattern") removeAllowPattern(s.index);
    sel = null;
    lastRule = null;
    lastPattern = null;
    await tick();
    addRuleBtn?.focus();
  }

  // 바깥에서 초안이 바뀌면([취소] · 배우기 · 다른 창) 고른 줄의 폼을 다시 읽는다. 줄이 사라졌으면 고름을 푼다.
  $effect(() => {
    const s = sel;
    if (s?.kind === "rule") {
      const cur = settings.current.automation.allow[s.index];
      untrack(() => {
        if (!cur) {
          sel = null;
          return;
        }
        if (lastRule && sameAllowRules([cur], [lastRule])) return;
        selectRule(s.index);
      });
    } else if (s?.kind === "pattern") {
      const cur = settings.current.automation.allow_patterns[s.index];
      untrack(() => {
        if (cur === undefined) {
          sel = null;
          return;
        }
        if (cur === lastPattern) return;
        selectPattern(s.index);
      });
    }
  });

  // ── 문구 ──
  /** 규칙 줄의 흐린 요약 — 제약 칩 문구 + (옛 규칙이면) 하위 명령 앞 플래그 허용. 아무것도 없으면 '인자 제한 없음'. */
  function ruleSummary(r: AllowRule, full: boolean): string {
    const parts: string[] = [];
    const c = ruleConstraintText(r, full);
    if (c) parts.push(c);
    if (r.subcommands.length > 0 && r.sub_first !== true) parts.push(t("settings.automation.allow.rule.loose_sub"));
    return parts.length === 0 ? t("settings.automation.allow.rule.all") : parts.join(" · ");
  }

  function errText(e: FieldError): string {
    return t(`settings.automation.allow.err.${e.code}` as Key, { item: e.item ?? "", max: MAX_ARGS_LIMIT });
  }

  const formTitle = $derived(
    sel?.kind === "new-rule"
      ? t("settings.automation.allow.form.new.rule")
      : sel?.kind === "new-pattern"
        ? t("settings.automation.allow.form.new.pattern")
        : sel?.kind === "pattern"
          ? t("settings.automation.allow.form.edit.pattern")
          : t("settings.automation.allow.form.edit.rule"),
  );
  const selName = $derived(
    sel?.kind === "rule"
      ? ruleName(auto.allow[sel.index] ?? { exec: "", subcommands: [] })
      : sel?.kind === "pattern"
        ? (auto.allow_patterns[sel.index] ?? "")
        : "",
  );

  const listEmpty = $derived(auto.allow.length === 0 && auto.allow_patterns.length === 0);
</script>

{#snippet field(
  key: Exclude<keyof AllowRuleForm, "sub_first">,
  name: string,
)}
  {@const err = errors[key]}
  <div class="ff" data-field={key}>
    <TipName
      id="{uid}-{key}-name"
      for="{uid}-{key}"
      label={t(`settings.automation.allow.f.${name}.label` as Key)}
      tip={t(`settings.automation.allow.f.${name}.tip` as Key)}
    />
    <input
      id="{uid}-{key}"
      class="value"
      class:bad={!!err}
      value={form[key]}
      placeholder={t(`settings.automation.allow.f.${name}.ph` as Key)}
      autocomplete="off"
      spellcheck="false"
      aria-invalid={err ? "true" : undefined}
      aria-describedby={err ? `${uid}-${key}-err` : undefined}
      oninput={(e) => setField(key, e.currentTarget.value)}
    />
    {#if err}<p class="field-err" id="{uid}-{key}-err">{errText(err)}</p>{/if}
  </div>
{/snippet}

<SettingsSubView
  title={t("settings.automation.allow.title")}
  back={t("settings.automation.bundles.back")}
  backAria={t("settings.automation.bundles.back.aria")}
  {onback}
>
  <AutomationTester />

  <div class="list-head">
    <h5 class="group-head">{t("settings.automation.allow.list")}</h5>
    <div class="list-actions">
      <button
        type="button"
        class="btn btn-sm btn-secondary add-rule"
        aria-label={t("settings.automation.allow.add.rule.aria")}
        bind:this={addRuleBtn}
        onclick={newRule}
      >
        <UiIcon name="plus" size={12} />
        <span>{t("settings.automation.allow.add.rule")}</span>
      </button>
      <button
        type="button"
        class="btn btn-sm btn-secondary add-pattern"
        aria-label={t("settings.automation.allow.add.pattern.aria")}
        onclick={newPattern}
      >
        <UiIcon name="plus" size={12} />
        <span>{t("settings.automation.allow.add.pattern")}</span>
      </button>
    </div>
  </div>

  {#if listEmpty && sel === null}
    <p class="list-empty">{t("settings.automation.allow.list.empty")}</p>
  {:else}
    <ul class="allow-rows" aria-label={t("settings.automation.allow.list")}>
      {#each auto.allow as r, i (i)}
        {@const on = sel?.kind === "rule" && sel.index === i}
        <li>
          <button
            type="button"
            class="allow-row"
            class:sel={on}
            aria-current={on ? "true" : undefined}
            data-kind="rule"
            data-index={i}
            onclick={() => selectRule(i)}
          >
            <span class="kind k-rule">{t("settings.automation.allow.kind.rule")}</span>
            <code class="row-cmd">{ruleName(r)}</code>
            <span class="row-sum" title={ruleSummary(r, true)}>{ruleSummary(r, false)}</span>
          </button>
        </li>
      {/each}
      {#if sel?.kind === "new-rule"}
        <li>
          <div class="allow-row sel ghost" data-kind="new-rule">
            <span class="kind k-rule">{t("settings.automation.allow.kind.rule")}</span>
            <span class="row-sum">{t("settings.automation.allow.form.new.rule")}</span>
          </div>
        </li>
      {/if}
      {#each auto.allow_patterns as p, i (p)}
        {@const on = sel?.kind === "pattern" && sel.index === i}
        <li>
          <button
            type="button"
            class="allow-row"
            class:sel={on}
            aria-current={on ? "true" : undefined}
            data-kind="pattern"
            data-index={i}
            onclick={() => selectPattern(i)}
          >
            <span class="kind k-pattern">{t("settings.automation.allow.kind.pattern")}</span>
            <code class="row-cmd">{p}</code>
            <span class="row-sum">{t("settings.automation.allow.pattern.desc")}</span>
          </button>
        </li>
      {/each}
      {#if sel?.kind === "new-pattern"}
        <li>
          <div class="allow-row sel ghost" data-kind="new-pattern">
            <span class="kind k-pattern">{t("settings.automation.allow.kind.pattern")}</span>
            <span class="row-sum">{t("settings.automation.allow.form.new.pattern")}</span>
          </div>
        </li>
      {/if}
    </ul>
  {/if}

  {#if sel === null}
    {#if !listEmpty}<p class="pick">{t("settings.automation.allow.pick")}</p>{/if}
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <section class="rule-form" data-form={sel.kind} bind:this={formEl} aria-label={formTitle} onkeydown={onFormKey}>
      <div class="form-head">
        <h5 class="form-title">{formTitle}</h5>
        {#if sel.kind === "rule" || sel.kind === "pattern"}
          <button
            type="button"
            class="btn btn-sm btn-ghost del"
            aria-label={t("settings.automation.allow.delete.aria", { name: selName })}
            onclick={() => void removeSelected()}>{t("settings.automation.allow.delete")}</button
          >
        {/if}
      </div>

      {#if isRuleSel}
        {@render field("exec", "exec")}
        {@render field("subcommands", "subs")}
        <div class="ff" data-field="sub_first">
          <TipName
            id="{uid}-sub_first-name"
            for="{uid}-sub_first"
            label={t("settings.automation.allow.f.sub_first.label")}
            tip={t("settings.automation.allow.f.sub_first.tip")}
          />
          <span class="ff-toggle">
            <Toggle id="{uid}-sub_first" checked={form.sub_first} disabled={subFirstDisabled} onchange={setSubFirst} />
          </span>
        </div>
        {@render field("first_arg", "first_arg")}
        {@render field("max_args", "max_args")}
        {@render field("deny_flags", "deny")}
        {@render field("allow_flags", "allow")}
        {@render field("require_flags", "require")}

        <div class="preview" data-preview>
          <span class="preview-label">{t("settings.automation.allow.preview")}</span>
          {#if formRule}
            <code class="row-cmd">{ruleName(formRule)}</code>
            <span class="row-sum">{ruleSummary(formRule, true)}</span>
          {:else}
            <span class="row-sum">—</span>
          {/if}
        </div>
      {:else}
        <div class="ff" data-field="pattern">
          <TipName
            id="{uid}-pattern-name"
            for="{uid}-pattern"
            label={t("settings.automation.allow.f.pattern.label")}
            tip={t("settings.automation.allow.f.pattern.tip")}
          />
          <input
            id="{uid}-pattern"
            class="value"
            class:bad={patternErr !== null && (sel.kind === "pattern" || patternText !== "")}
            value={patternText}
            placeholder={t("settings.automation.allow.f.pattern.ph")}
            autocomplete="off"
            spellcheck="false"
            aria-invalid={patternErr !== null ? "true" : undefined}
            oninput={(e) => onPatternInput(e.currentTarget.value)}
          />
          {#if patternErr !== null && (sel.kind === "pattern" || patternText !== "")}
            <p class="field-err">{t(`settings.automation.allow.err.pattern_${patternErr}` as Key)}</p>
          {/if}
        </div>
      {/if}

      {#if dangerous}
        <p class="note danger" role="note" data-note="danger">
          <UiIcon name="shield-check" size={13} />
          <span>{t("settings.automation.allow.warn.danger")}</span>
        </p>
      {:else if formRule && isWideRule(formRule)}
        <p class="note wide" role="note" data-note="wide">
          <UiIcon name="warning" size={13} />
          <span>{t("settings.automation.allow.warn.wide")}</span>
        </p>
      {/if}
      {#if (sel.kind === "rule" && hasErrors(errors)) || (sel.kind === "pattern" && patternErr !== null)}
        <p class="note invalid" data-note="invalid">{t("settings.automation.allow.invalid")}</p>
      {/if}

      {#if sel.kind === "new-rule" || sel.kind === "new-pattern"}
        <div class="form-actions">
          <button type="button" class="btn btn-sm btn-ghost discard" onclick={() => (sel = null)}
            >{t("settings.automation.allow.discard")}</button
          >
          <button
            type="button"
            class="btn btn-sm btn-primary commit"
            disabled={sel.kind === "new-rule" ? hasErrors(errors) : patternErr !== null}
            onclick={sel.kind === "new-rule" ? commitNewRule : commitNewPattern}
            >{t("settings.automation.allow.commit")}</button
          >
        </div>
      {/if}
    </section>
  {/if}
</SettingsSubView>

<style>
  .list-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    flex-wrap: wrap;
    margin: var(--space-4) 0 var(--space-2);
  }

  .group-head {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: 600;
    letter-spacing: 0.02em;
    color: var(--fg-2);
  }

  .list-actions {
    display: flex;
    gap: var(--space-1);
  }

  .list-actions .btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .list-empty,
  .pick {
    margin: var(--space-2) 0 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  /* 규칙 목록 — 묶음 편집과 같은 1px 선의 둥근 판, 줄 사이도 1px 선 */
  .allow-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    overflow: hidden;
  }

  .allow-rows > li + li {
    border-top: 1px solid var(--line);
  }

  .allow-row {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    width: 100%;
    min-height: 36px;
    padding: var(--space-1) var(--space-3);
    box-sizing: border-box;
    text-align: left;
    color: var(--fg-1);
    background: transparent;
    border: none;
    cursor: pointer;
    min-width: 0;
  }

  .allow-row:hover:not(.sel) {
    background: var(--surface-hover);
  }

  .allow-row.sel {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    box-shadow: inset 2px 0 0 var(--accent);
  }

  .allow-row.ghost {
    cursor: default;
  }

  .allow-row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }

  .kind {
    flex: 0 0 auto;
    padding: 0 6px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 18px;
    font-weight: 500;
    border-radius: var(--radius-sm);
    color: var(--fg-2);
    background: var(--surface-hover);
  }

  /* 종류 배지 — "무엇인지" 라 제3색 */
  .kind.k-rule {
    color: var(--tertiary);
    background: color-mix(in srgb, var(--tertiary) 14%, transparent);
  }

  .row-cmd {
    flex: 0 0 auto;
    max-width: 45%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono, monospace);
    font-size: var(--t-xs);
    color: var(--fg-1);
  }

  .row-sum {
    min-width: 0;
    flex: 1 1 auto;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 폼 — 필드 우물 판 하나. 좁으면(컨테이너) 이름이 칸 위로 올라간다. */
  .rule-form {
    container-type: inline-size;
    margin-top: var(--space-3);
    padding: var(--space-3);
    border: 1px solid var(--line);
    border-radius: var(--radius-md);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .form-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .form-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--fg-1);
  }

  .del {
    color: var(--fg-2);
  }

  .del:hover {
    color: var(--err);
    background: var(--err-soft);
  }

  .ff {
    display: grid;
    grid-template-columns: 11em minmax(0, 1fr);
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
  .ff > .ff-toggle {
    grid-column: 2;
  }

  .ff-toggle {
    display: inline-flex;
    justify-self: start;
  }

  .ff > .value.bad {
    border-color: var(--err);
  }

  .field-err {
    grid-column: 2;
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--err);
  }

  @container (max-width: 420px) {
    .ff {
      grid-template-columns: minmax(0, 1fr);
    }

    .ff > .value,
    .ff > .ff-toggle,
    .field-err {
      grid-column: 1;
    }
  }

  .preview {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    min-width: 0;
    padding-top: var(--space-2);
    border-top: 1px solid var(--line);
  }

  .preview-label {
    flex: 0 0 auto;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .preview .row-sum {
    white-space: normal;
    overflow-wrap: anywhere;
  }

  .note {
    display: flex;
    align-items: baseline;
    gap: var(--space-2);
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  .note :global(svg) {
    flex: 0 0 auto;
    transform: translateY(2px);
  }

  .note.wide {
    color: var(--warn);
  }

  .note.danger :global(svg) {
    color: var(--ok);
  }

  .note.invalid {
    color: var(--err);
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }
</style>
