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
   * **표시 트리거** 섹션 — 새 출력에만 붙는 하이라이트·링크·툴팁 ($lib/triggers,
   * docs/log/2026-09-04-trigger-links-tooltips.md).
   *
   * ## 요약과 하위 화면 (2026-10-05 — docs/log/2026-10-05-trigger-examples.md "하위 화면으로")
   *
   * 이 섹션 본문은 **요약**이다 — 내 트리거 목록(줄마다 색 견본 · 패턴 · 종류 요약 · 켜기/끄기 스위치 · 꺾쇠 `›` — 공용 `.slist` 줄) +
   * 오른쪽 위 [트리거 추가 ›]. 줄을 누르면(스위치 빼고) **편집**, [트리거 추가 ›] 는 **추가** 하위 화면
   * (`TriggerEditor` — 추가는 예시 카드 격자가 위에 더 선다)으로 미끄러져 바뀐다. 자동 승인(`AutomationSection`)과
   * 같은 틀이다: 자리 · 움직임 · Escape 는 `SubViewStack`, 머리(`‹ 트리거` + 제목)는 `SettingsSubView`. Escape 는
   * 하위 화면에서 요약으로만 가고(모달은 그대로), 돌아오면 그 화면을 연 줄(지웠으면 [트리거 추가 ›])에 포커스가
   * 선다. 섹션이 안 보이게 되면(다른 섹션 · 모달 닫힘) 쓰지 않은 칸은 버리고 요약으로 돌아간다.
   *
   * ## 종류 셋 (하이라이트 · 링크 · 툴팁)
   *
   * **종류는 따로 저장하지 않는다** — 그 칸에 값이 있으면 켜진 것이다. 불리언을 세 개 더 두면 "링크가 켜져 있는데
   * URL 이 비었다" 같은 모순 상태를 파일에도 적게 되고, 손으로 고친 `settings.toml` 에서 둘이 어긋났을 때 어느 쪽이
   * 진실인지 정할 근거가 없다. 편집 화면은 칸을 비우는 것으로 종류를 끈다(`trigger-form.ts`).
   */

  /** 이 섹션이 지금 보이는가 — 꺼지면(섹션 이동 · 모달 닫힘) 요약으로 돌아간다 */
  let { active = true }: { active?: boolean } = $props();

  const triggers = $derived(settings.current.triggers);

  // ── 요약 ↔ 하위 화면(추가 · 편집) — 화면 상태, 저장하지 않는다 ──
  type View = { kind: "summary" } | { kind: "add" } | { kind: "edit"; index: number };
  let view = $state<View>({ kind: "summary" });
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let addBtn = $state<HTMLButtonElement | null>(null);
  /** `{#key}` 의 이름 — 같은 편집 화면이라도 다른 줄이면 새로 그린다 */
  const viewKey = $derived(view.kind === "edit" ? `edit-${view.index}` : view.kind);

  function openSub(v: View): void {
    dir = "fwd";
    view = v;
    const p = rootEl?.closest<HTMLElement>(".settings-panel");
    if (p) p.scrollTop = 0;
  }

  /** 요약으로 — `focusRow` 를 주면 그 줄, `null` 이면 [트리거 추가 ›] 에 포커스(돌아올 때만) */
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

  /** 뒤로 · 취소 · Escape — 연 쪽으로 포커스를 돌린다 */
  function back(): void {
    void closeSub(true, view.kind === "edit" ? view.index : null);
  }

  const onescape = $derived(view.kind === "summary" ? null : back);

  $effect(() => {
    if (!active) void closeSub(false);
  });

  // ── 줄 요약 ──
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

<!--
  늘 보이는 머리말·꼬리말은 없다 — 종류별 설명(하이라이트는 새 출력부터 · 링크의 $1 · 보여주기만 하는 경계)은 편집
  화면 칸 이름의 툴팁에 산다. 정규식 오류 같은 상태 안내만 줄 밑에 선다.
-->
<SubViewStack view={viewKey} {dir} {onescape} bind:root={rootEl}>
  {#if view.kind === "add"}
    <TriggerEditor index={null} onback={back} onsaved={(i) => void closeSub(true, i)} ondeleted={() => void closeSub(true)} />
  {:else if view.kind === "edit"}
    {@const at = view.index}
    <TriggerEditor index={at} onback={back} onsaved={(i) => void closeSub(true, i)} ondeleted={() => void closeSub(true)} />
  {:else}
    <!-- 머리 — MCP · 지침 섹션과 같은 틀: 한 줄 설명(ⓘ 자세히) · 각주 · 목록 소제목과 단추 -->
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
      <!-- 줄 모양은 설정 공용 목록(`settings.css` 의 `.slist`) — 스니펫 · AI 에이전트 · MCP 와 한 벌이다 -->
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

  /* 목록 · 줄 모양은 `settings.css` 의 공용 `.slist` 한 벌이다. 여기는 트리거만의 조각 둘 — 색 견본과 정규식 오류 줄 */

  /* 색 견본 — 앞 칸을 그 트리거의 글자색 · 바탕색으로 채운다. 하이라이트가 없으면 점선 빈 칸 */
  .trg-swatch.slist-lead {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1;
  }

  .trg-swatch.none {
    background: transparent;
    border: 1px dashed var(--line);
  }

  /* 오류 — 줄 밑, 이름 시작선(앞 칸 32 + 틈 12)에 맞춘다 */
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
