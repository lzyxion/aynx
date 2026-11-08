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
   * **스니펫** 섹션 — 저장해 둔 명령의 목록·편집·삽입 (docs/log/2026-09-16-snippets.md).
   *
   * 다른 섹션과 달리 값이 `settings.toml` 이 아니라 **자기 파일**(`snippets.json`)에 산다 — "이름 붙여 아껴 둔 것"
   * 이기 때문이다. 그래서 여기 있는 조작은 설정 창의 [저장]/[취소] 를 기다리지 않고 **그 자리에서 파일에 남는다**
   * (디바운스 저장). 설정 화면의 푸터 두 버튼은 이 섹션과 무관하다.
   *
   * ## 요약과 하위 화면 (2026-10-05 — docs/log/2026-10-05-snippets-subview.md)
   *
   * 트리거 · 자동 승인과 같은 틀이다. 이 섹션 본문은 **요약** — 줄마다 이름 · 범위 칩 · 명령 미리보기 · 꺾쇠 `›` 와
   * 따로 선 [삽입](공용 `.slist` 줄), 오른쪽 위 [스니펫 추가 ›]. 줄을 누르면 **편집**, [스니펫 추가 ›] 는 **추가** 하위 화면
   * (`SnippetEditor`)으로 미끄러져 바뀐다. 자리 · 움직임 · Escape 는 `SubViewStack`, 머리는 `SettingsSubView`.
   * 돌아오면 그 화면을 연 줄(새로 넣었으면 그 줄, 지웠으면 [스니펫 추가 ›])에 포커스가 선다. 섹션이 안 보이게
   * 되면(다른 섹션 · 모달 닫힘) 쓰지 않은 칸은 버리고 요약으로 돌아간다.
   *
   * ## [삽입] 이 여기 있는 이유
   *
   * 스니펫의 쓸모는 결국 터미널에 들어가는 것이라, 만들어 두고 한 번 눌러 볼 자리가 있어야 한다. 실제 몸통은
   * 단축키·팔레트와 **같은 함수**다 (`insertSnippet`) — 터미널 타일이 포커스가 아니면 그쪽이 안내 한 줄을 띄운다.
   * (설정을 **독**으로 열어 두고 누르면 뒤의 타일이 그대로 포커스라 곧바로 들어간다.) 줄 누르기가 편집이라 [삽입] 은
   * 그 단추 **밖**의 따로 선 작은 단추다 — 단추 안에 단추를 둘 수 없고, 누른 자리가 편집과 겹치지 않는다.
   */

  /** 이 섹션이 지금 보이는가 — 꺼지면(섹션 이동 · 모달 닫힘) 요약으로 돌아간다 */
  let { active = true }: { active?: boolean } = $props();

  const list = $derived(snippets());

  // ── 요약 ↔ 하위 화면(추가 · 편집) — 화면 상태, 저장하지 않는다 ──
  type View = { kind: "summary" } | { kind: "add" } | { kind: "edit"; id: string };
  let view = $state<View>({ kind: "summary" });
  let dir = $state<"fwd" | "back" | null>(null);
  let rootEl = $state<HTMLElement | null>(null);
  let addBtn = $state<HTMLButtonElement | null>(null);
  /** `{#key}` 의 이름 — 같은 편집 화면이라도 다른 줄이면 새로 그린다 */
  const viewKey = $derived(view.kind === "edit" ? `edit-${view.id}` : view.kind);

  function openSub(v: View): void {
    dir = "fwd";
    view = v;
    const p = rootEl?.closest<HTMLElement>(".settings-panel");
    if (p) p.scrollTop = 0;
  }

  /** 요약으로 — `focusId` 를 주면 그 줄, `null` 이면 [스니펫 추가 ›] 에 포커스(돌아올 때만) */
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

  /** 뒤로 · 취소 · Escape — 연 쪽으로 포커스를 돌린다 */
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
    <!-- 머리 — MCP · 지침 섹션과 같은 틀: 한 줄 설명(ⓘ 자세히) · 각주 · 목록 소제목과 단추 -->
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
      <!-- 줄 모양은 설정 공용 목록(`settings.css` 의 `.slist`) — 트리거 · AI 에이전트 · MCP 와 한 벌이다.
           스위치가 없어 그 자리를 비워 두고(`.slist-switch.empty`) 꺾쇠 열을 다른 목록과 맞춘다 -->
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

  /*
    목록 · 줄 · 알약 모양은 `settings.css` 의 공용 `.slist` 한 벌이다. 범위 알약의 이름이 `.chip` 이 **아닌** 이유: 예전
    `settings.css` 의 `.settings-view .chip`(색 견본, `width:18px`)에 갇혀 **한 줄에 한 글자씩** 쌓인 적이 있다.
    호스트 범위는 글자만 한 단 진하다.
  */
  .tag.host {
    color: var(--fg-1);
  }
</style>
