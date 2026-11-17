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
   * **템플릿** 섹션(2026-11-17) — 탭 템플릿 전부(프로젝트 템플릿 · 프로젝트 없음)의 목록 · 편집(이름 · 프로젝트 · 지우기).
   *
   * 프로젝트 시작 화면의 템플릿 칸은 그 프로젝트 템플릿만 보이므로, **프로젝트 없는 템플릿을 고칠 자리**가 여기 하나다. 만들기 ·
   * 배치 고치기 · 열기는 여기 없다(탭 우클릭 [템플릿 저장] — 같은 이름이면 덮어쓸지 묻는다 · 시작 화면 · 팔레트) — 그래서 추가 단추도 없다.
   *
   * 스니펫 섹션과 같은 결이다 — 값이 `settings.toml` 이 아니라 **자기 파일**(`tab-templates.json`)에 살고, 조작은 설정 창의
   * [저장]/[취소] 와 무관하게 그 자리에서 파일에 남는다. 칸이 보일 때마다 디스크 최신을 다시 읽는다(다른 창이 고쳤을 수 있다).
   *
   * ## 요약과 하위 화면 (2026-11-17 사용자 — "다른 설정들과 이질적" → 스니펫과 같은 틀)
   *
   * 본문은 **요약** — 공용 `.slist` 줄(`settings.css`)마다 앞 칸 배치 그림(`TemplatePreview` 64×40 — 시작 화면 카드와 같은 크기. 32 칸 안의 28×20 은 칸 로고가 들어가지 않아 무엇인지 몰라
   * 되돌렸다 — 2026-11-17 사용자) · 이름 · 프로젝트
   * 알약 · 타일 요약 + 저장한 날 · 꺾쇠 `›`. 줄 전체가 `.slist-open` 단추이고, 누르면 **편집** 하위 화면(`TemplateEditor`)으로
   * 미끄러져 바뀐다. 자리 · 움직임 · Escape 는 `SubViewStack`, 머리는 `SettingsSubView`. 돌아오면 그 줄(지웠으면 첫 줄)에 포커스가
   * 선다. 섹션이 안 보이게 되면(다른 섹션 · 모달 닫힘) 쓰지 않은 칸은 버리고 요약으로 돌아간다. 순서는 파일 순서(최근 저장 먼저).
   */

  /** 이 섹션이 지금 보이는가 — 보일 때 다시 읽고, 꺼지면 요약으로 돌아간다 */
  let { active = true }: { active?: boolean } = $props();

  const list = $derived(tabTemplates());

  // ── 요약 ↔ 편집 하위 화면 — 화면 상태, 저장하지 않는다 ──
  type View = { kind: "summary" } | { kind: "edit"; id: string };
  let view = $state<View>({ kind: "summary" });
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  /** `{#key}` 의 이름 — 같은 편집 화면이라도 다른 줄이면 새로 그린다 */
  const viewKey = $derived(view.kind === "edit" ? `edit-${view.id}` : view.kind);

  function openSub(v: View): void {
    dir = "fwd";
    view = v;
    const p = rootEl?.closest<HTMLElement>(".settings-panel");
    if (p) p.scrollTop = 0;
  }

  /** 요약으로 — `focusId` 를 주면 그 줄, `null` 이면(지웠음) 첫 줄에 포커스(돌아올 때만) */
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

  /** 뒤로 · 취소 · Escape — 연 줄로 포커스를 돌린다 */
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
    <!-- 머리 — 스니펫 섹션과 같은 틀: 한 줄 설명(ⓘ 자세히) · 각주 · 목록 소제목 -->
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
      <!-- 줄 모양은 설정 공용 목록(`settings.css` 의 `.slist`) — 스니펫 · 트리거와 한 벌. 스위치가 없어 그 자리를 비워 두고
           (`.slist-switch.empty`) 꺾쇠 열을 다른 목록과 맞춘다 -->
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
              <!-- 앞 칸 — 배치 그림을 32 칸 안에(칸이 작아 로고는 크기 규칙대로 들어갈 칸에만) -->
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
  /* 앞 칸 — 32 칸(`.slist-lead`) 대신 시작 화면 카드와 같은 64×40 배치 그림(칸마다 로고가 들어가는 크기) */
  .tpl-lead {
    display: inline-flex;
    flex: none;
  }

  /* 프로젝트 템플릿은 글자만 한 단 진하다(스니펫의 호스트 범위 알약과 같다) */
  .tag.project {
    color: var(--fg-1);
  }
</style>
