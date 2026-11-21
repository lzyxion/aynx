<script lang="ts">
  import { tick, untrack } from "svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import TemplatePreview from "$lib/TemplatePreview.svelte";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import SubViewStack from "$lib/settings/SubViewStack.svelte";
  import TemplateEditor from "$lib/settings/TemplateEditor.svelte";
  import { templateProjectPill, templateRowSub } from "$lib/settings/templates-view";
  import { reloadTabTemplates, tabTemplates, templateSummary } from "$lib/app/tab-templates.svelte.js";
  import { projectById } from "$lib/app/project-list.svelte.js";
  import type { TabTemplate } from "$lib/tab-templates";

  /**
   * 프로젝트 없는 템플릿을 고칠 자리는 여기 하나다. 만들기 · 배치 고치기 · 열기는 두지 않는다(탭 우클릭 [템플릿 저장] · 시작 화면 · 팔레트).
   * 값은 자기 파일(`tab-templates.json`)에 산다 — 설정 창의 [저장] · [취소] 와 무관하다. 보일 때마다 다시 읽는다(다른 창이 고쳤을 수 있다).
   */

  let { active = true }: { active?: boolean } = $props();

  const list = $derived(tabTemplates());

  // ── 요약 ↔ 편집 하위 화면 ──
  type View = { kind: "summary" } | { kind: "edit"; id: string };
  let view = $state<View>({ kind: "summary" });
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
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
      (focusId === null ? null : rootEl?.querySelector<HTMLElement>(`.tpl-open[data-id="${CSS.escape(focusId)}"]`)) ??
      rootEl?.querySelector<HTMLElement>(".tpl-open");
    el?.scrollIntoView({ block: "nearest" });
    el?.focus({ preventScroll: true });
  }

  function back(): void {
    void closeSub(true, view.kind === "edit" ? view.id : null);
  }

  const onescape = $derived(view.kind === "summary" ? null : back);

  $effect(() => {
    if (!active) {
      void closeSub(false);
      return;
    }
    untrack(() => void reloadTabTemplates());
  });

  function pillOf(tpl: TabTemplate): { label: string; project: boolean } {
    const p = templateProjectPill(tpl.projectId, (id) => projectById(id)?.name);
    if (p.kind === "project") return { label: p.name, project: true };
    return { label: t(p.kind === "gone" ? "settings.templates.project.gone" : "settings.templates.project.none"), project: false };
  }
</script>

<SubViewStack view={viewKey} {dir} {onescape} bind:root={rootEl}>
  {#if view.kind === "edit"}
    <TemplateEditor id={view.id} onback={back} onsaved={(id) => void closeSub(true, id)} ondeleted={() => void closeSub(true)} />
  {:else}
    <p class="lead">
      <InfoNote id="tpl-info" label={t("settings.templates.subhead")} plain>
        {#snippet summary()}{t("settings.templates.summary")}{/snippet}
        {#snippet note()}{t("settings.templates.note")}{/snippet}
      </InfoNote>
    </p>
    <p class="footnote">{t("settings.templates.footnote")}</p>
    <div class="list-head">
      <h4 class="subhead">{t("settings.templates.list.subhead")}</h4>
    </div>

    {#if list.length > 0}
      <ul class="slist tpl-rows" aria-label={t("settings.templates.list.aria")}>
        {#each list as tpl (tpl.id)}
          {@const pill = pillOf(tpl)}
          <li class="slist-row" data-template-row={tpl.id}>
            <button
              type="button"
              class="slist-open tpl-open"
              data-id={tpl.id}
              aria-label={t("settings.templates.row.edit.aria", { name: tpl.name })}
              onclick={() => openSub({ kind: "edit", id: tpl.id })}
            >
              <span class="tpl-lead" aria-hidden="true"><TemplatePreview root={tpl.root} width={64} height={40} /></span>
              <span class="slist-text">
                <span class="slist-title">
                  <span class="slist-name" title={tpl.name}>{tpl.name}</span>
                  <span class="slist-pill tag" class:project={pill.project}>{pill.label}</span>
                </span>
                <span class="slist-sup">{templateRowSub(templateSummary(tpl.root), tpl.savedAt, Date.now(), t)}</span>
              </span>
            </button>
            <span class="slist-trail">
              <span class="slist-switch empty" aria-hidden="true"></span>
              <span class="slist-chev" aria-hidden="true"><UiIcon name="chevron" size={16} /></span>
            </span>
          </li>
        {/each}
      </ul>
    {:else}
      <p class="slist-empty tpl-empty">{t("settings.templates.empty")}</p>
    {/if}
  {/if}
</SubViewStack>

<style>
  /* 32 칸(`.slist-lead`)은 쓰지 않는다 — 그보다 작으면 칸 로고가 들어가지 않는다 */
  .tpl-lead {
    display: inline-flex;
    flex: none;
  }

  .tag.project {
    color: var(--fg-1);
  }
</style>
