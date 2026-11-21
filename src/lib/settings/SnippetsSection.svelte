<script lang="ts">
  import { tick } from "svelte";
  import { snippets } from "$lib/snippets.svelte.js";
  import { snippetPreview, type Snippet } from "$lib/snippets";
  import { insertSnippet } from "$lib/app/snippets.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import SubViewStack from "$lib/settings/SubViewStack.svelte";
  import SnippetEditor from "$lib/settings/SnippetEditor.svelte";

  /**
   * 값은 `settings.toml` 이 아니라 자기 파일(`snippets.json`)에 산다 — 설정 창의 [저장] · [취소] 와 무관하게 그 자리에서 파일에 남는다.
   * [삽입] 은 줄 단추 밖의 따로 선 단추다 — 단추 안에 단추를 둘 수 없다.
   */

  /** 꺼지면(섹션 이동 · 모달 닫힘) 요약으로 돌아간다 */
  let { active = true }: { active?: boolean } = $props();

  const list = $derived(snippets());

  // ── 요약 ↔ 하위 화면 ──
  type View = { kind: "summary" } | { kind: "add" } | { kind: "edit"; id: string };
  let view = $state<View>({ kind: "summary" });
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let addBtn = $state<HTMLButtonElement | null>(null);
  /** 같은 편집 화면이라도 다른 줄이면 새로 그린다 */
  const viewKey = $derived(view.kind === "edit" ? `edit-${view.id}` : view.kind);

  function openSub(v: View): void {
    dir = "fwd";
    view = v;
    const p = rootEl?.closest<HTMLElement>(".settings-panel");
    if (p) p.scrollTop = 0;
  }

  async function closeSub(returnFocus: boolean, focusId: string | null = null): Promise<void> {
    if (view.kind === "summary") return;
    dir = returnFocus ? "back" : null;
    view = { kind: "summary" };
    if (!returnFocus) return;
    await tick();
    const el =
      focusId === null
        ? addBtn
        : (rootEl?.querySelector<HTMLElement>(`.snip-open[data-id="${CSS.escape(focusId)}"]`) ?? addBtn);
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  }

  function back(): void {
    void closeSub(true, view.kind === "edit" ? view.id : null);
  }

  const onescape = $derived(view.kind === "summary" ? null : back);

  $effect(() => {
    if (!active) void closeSub(false);
  });

  const scopeLabel = (s: Snippet) =>
    s.scope.kind === "host" ? s.scope.alias : t("settings.snippets.scope.all");
</script>

<SubViewStack view={viewKey} {dir} {onescape} bind:root={rootEl}>
  {#if view.kind === "add"}
    <SnippetEditor id={null} onback={back} onsaved={(id) => void closeSub(true, id)} ondeleted={() => void closeSub(true)} />
  {:else if view.kind === "edit"}
    <SnippetEditor id={view.id} onback={back} onsaved={(id) => void closeSub(true, id)} ondeleted={() => void closeSub(true)} />
  {:else}
    <p class="lead">
      <InfoNote id="snip-info" label={t("settings.snippets.subhead")} plain>
        {#snippet summary()}{t("settings.snippets.summary")}{/snippet}
        {#snippet note()}{t("settings.snippets.note")}{/snippet}
      </InfoNote>
    </p>
    <p class="footnote">{t("settings.snippets.footnote")}</p>
    <div class="list-head">
      <h4 class="subhead">{t("settings.snippets.list.subhead")}</h4>
      <button
        type="button"
        id="snip-add"
        class="btn btn-sm btn-secondary snip-add"
        bind:this={addBtn}
        onclick={() => openSub({ kind: "add" })}
      >
        <UiIcon name="plus" size={12} />
        <span>{t("settings.snippets.add.open")}</span>
        <UiIcon name="chevron" size={12} />
      </button>
    </div>

    {#if list.length > 0}
      <ul class="slist snip-rows" aria-label={t("settings.snippets.list.aria")}>
        {#each list as snippet (snippet.id)}
          <li class="slist-row snip-li" data-snippet-row={snippet.id}>
            <button
              type="button"
              class="slist-open snip-open"
              data-id={snippet.id}
              aria-label={t("settings.snippets.row.edit.aria", { name: snippet.name })}
              onclick={() => openSub({ kind: "edit", id: snippet.id })}
            >
              <span class="slist-lead" aria-hidden="true"><UiIcon name="terminal" size={16} /></span>
              <span class="slist-text">
                <span class="slist-title">
                  <span class="slist-name">{snippet.name}</span>
                  <span class="slist-pill tag" class:host={snippet.scope.kind === "host"}>{scopeLabel(snippet)}</span>
                  {#if !snippet.enter}<span class="slist-pill tag">{t("settings.snippets.chip.no_enter")}</span>{/if}
                </span>
                <span class="slist-sup"
                  ><span class="slist-mono">{snippetPreview(snippet.command)}</span
                  >{#if snippet.description}{" — "}{snippet.description}{/if}</span
                >
              </span>
            </button>
            <span class="slist-trail">
              <span class="snip-insert">
                <button
                  type="button"
                  class="btn btn-sm btn-secondary"
                  title={t("settings.snippets.insert.title")}
                  aria-label={t("settings.snippets.insert.aria", { name: snippet.name })}
                  onclick={() => void insertSnippet(snippet.id)}>{t("settings.snippets.insert")}</button
                >
              </span>
              <span class="slist-switch empty" aria-hidden="true"></span>
              <span class="slist-chev" aria-hidden="true"><UiIcon name="chevron" size={16} /></span>
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="slist-empty snip-empty">{t("settings.snippets.empty")}</p>
    {/if}
  {/if}
</SubViewStack>

<style>
  .snip-add {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .tag.host {
    color: var(--fg-1);
  }
</style>
