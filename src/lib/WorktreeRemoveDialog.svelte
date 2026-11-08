<script lang="ts">
  /**
   * **워크트리 제거 확인** (docs/log/2026-09-24-worktrees.md "브랜치는 같이 지운다").
   *
   * 네이티브 확인을 대신한다 — "브랜치 <이름> 도 삭제" **칸**이 있어야 해서다. 칸은 셋 중 하나다
   * (순수 층 `branchDeleteOption`): 켜진 채(기본 — 앱이 `-b` 로 만든 브랜치) · 꺼지고 흐린 채 +
   * 까닭 한 줄(워크트리보다 먼저 있던 브랜치) · 꺼진 채 살아 있는 칸 + 까닭 한 줄(먼저 있던 브랜치인데 main 에
   * 병합됨 — 2026-10-05, docs/log/2026-10-05-worktree-one-to-one.md) · 없음(분리된 HEAD · 저장소의 지금 브랜치) ·
   * 원격(꺼진 채 살아 있는 칸 + 까닭 한 줄 — 원격에선 누가 브랜치를 만들었는지 모른다).
   * 켜 둬도 `-d` 뿐이다 — 병합되지 않은 커밋이 있으면 git 이 거절하고 브랜치는 남는다.
   *
   * 상태와 실행은 전부 `app/projects.svelte.ts` 에 있고 이 상자는 그리기만 한다(`ProjectForm` 과
   * 같은 분담). 상자 모양(`.overlay`/`.modal`)은 스니펫 저장 상자와 같은 값이다.
   *
   * "이 워크트리에 열린 탭 N개도 닫기" 칸(기본 켬 · 닫을 탭이 있을 때만)과 "다른 폴더 타일이 섞인 탭 M개는 남깁니다"
   * 한 줄(있을 때만) — docs/log/2026-10-05-worktree-cleanup-tabs-refresh.md. 수는 그리는 동안 다시 센다(반응형).
   *
   * Escape 는 **여기서 끊는다**(`stopPropagation`) — 창의 Escape 사슬로 새면 뒤에 깔린 독까지
   * 함께 닫는다. 열리면 [제거] 에 커서가 있어 Enter 한 번이면 된다(네이티브 확인과 같은 손).
   */
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { trapTab } from "$lib/focus-trap";
  import { branchDeleteToggleable } from "$lib/projects";
  import {
    cancelRemoveWorktree,
    setRemoveCloseTabs,
    setRemoveDeleteBranch,
    submitRemoveWorktree,
    worktreeRemoveDialog,
    worktreeRemoveTabs,
  } from "$lib/app/projects.svelte.js";

  const d = $derived(worktreeRemoveDialog());
  const tabs = $derived(worktreeRemoveTabs());
  const branchLabel = $derived(d?.worktree.branch ?? t("app.projects.worktrees.detached"));

  let submitEl = $state<HTMLButtonElement | null>(null);
  $effect(() => {
    if (d) submitEl?.focus();
  });

  /** 모달 뿌리 — Tab 이 모달 뒤로 새지 않게 여기서 되감는다 (`trapTab`) */
  let modalEl = $state<HTMLElement | null>(null);

  function onKeydown(ev: KeyboardEvent) {
    if (modalEl && trapTab(ev, modalEl)) return;
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    cancelRemoveWorktree();
  }
</script>

{#if d}
  <div class="overlay">
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div
      class="modal glass-raised"
      role="dialog"
      aria-modal="true"
      aria-labelledby="worktree-remove-title"
      tabindex="-1"
      data-worktree-remove
      bind:this={modalEl}
      onkeydown={onKeydown}
    >
      <h2 id="worktree-remove-title">{t("app.projects.worktrees.remove.title")}</h2>
      <p class="lead">
        {t("app.projects.worktrees.remove.confirm", { branch: branchLabel, path: d.worktree.path })}
      </p>

      {#if d.option.kind !== "hidden"}
        <label class="check" class:disabled={d.option.kind === "predates"}>
          <input
            type="checkbox"
            data-worktree-remove-branch
            checked={branchDeleteToggleable(d.option) && d.deleteBranch}
            disabled={d.option.kind === "predates" || d.busy}
            onchange={(e) => setRemoveDeleteBranch(e.currentTarget.checked)}
          />
          <span>{t("app.projects.worktrees.remove.deleteBranch", { branch: d.option.branch })}</span>
        </label>
        <p class="hint" data-worktree-remove-hint>
          {d.option.kind === "predates"
            ? t("app.projects.worktrees.remove.predates")
            : d.option.kind === "merged"
              ? t("app.projects.worktrees.remove.mergedHint")
              : d.option.kind === "remote"
                ? t("app.projects.worktrees.remove.remoteHint")
                : t("app.projects.worktrees.remove.deleteBranch.hint")}
        </p>
      {/if}

      {#if tabs.close.length > 0}
        <label class="check">
          <input
            type="checkbox"
            data-worktree-remove-tabs
            checked={d.closeTabs}
            disabled={d.busy}
            onchange={(e) => setRemoveCloseTabs(e.currentTarget.checked)}
          />
          <span>{t("app.projects.worktrees.remove.closeTabs", { count: tabs.close.length })}</span>
        </label>
        <p class="hint" data-worktree-remove-tabs-hint>{t("app.projects.worktrees.remove.closeTabs.hint")}</p>
      {/if}
      {#if tabs.mixed > 0}
        <p class="hint mixed" data-worktree-remove-mixed>
          {t("app.projects.worktrees.remove.mixedTabs", { count: tabs.mixed })}
        </p>
      {/if}

      <div class="actions">
        <button type="button" class="ghost btn btn-secondary" disabled={d.busy} onclick={() => cancelRemoveWorktree()}
          >{t("app.projects.worktrees.remove.cancel")}</button
        >
        <button
          type="button"
          class="danger btn"
          data-worktree-remove-submit
          bind:this={submitEl}
          disabled={d.busy}
          onclick={() => void submitRemoveWorktree()}>{t("app.projects.worktrees.remove.submit")}</button
        >
      </div>
    </div>
  </div>
{/if}

<style>
  /* `SnippetSaveDialog.svelte`·`ProjectForm.svelte` 의 `.overlay`/`.modal` 과 **같은 값**이다 */
  .overlay {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: var(--space-4);
    background: var(--bg-overlay);
  }

  .modal {
    width: 100%;
    max-width: 440px;
    max-height: calc(100vh - 32px);
    overflow-y: auto;
    padding: var(--space-4);
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line-strong);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
  }

  .modal h2 {
    margin: 0 0 var(--space-2);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
    color: var(--fg-1);
  }

  .lead {
    margin: 0 0 var(--space-4);
    font-size: var(--t-sm);
    line-height: 1.55;
    color: var(--fg-2);
    overflow-wrap: anywhere;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-sm);
    color: var(--fg-1);
    cursor: pointer;
  }

  .check.disabled {
    color: var(--fg-3);
    cursor: default;
  }

  .check input {
    margin: 0;
    accent-color: var(--accent);
  }

  .hint {
    margin: var(--space-1) 0 var(--space-4) 22px;
    font-size: var(--t-xs);
    line-height: 1.5;
    color: var(--fg-2);
  }

  /* 섞인 탭 한 줄 — 칸이 없을 수도 있어(닫을 탭 0) 들여쓰기 없이 선다 */
  .hint.mixed {
    margin-left: 0;
  }

  /*
    버튼 — 전역 `.btn` 세 종류 (docs/log/2026-09-25-finish-menus.md · 토큰층 "버튼 세 종류"):
    취소 = 보조(`.btn-secondary`), 제거 = 되돌릴 수 없는 확정이라 강조색이 아니라 채운 `--err`
    (메뉴 안 인라인 대화의 해제·제거와 같은 처방 — docs/log/2026-09-25-unified-dock.md).
    옛 선 두른 규칙은 지웠다 — 스코프 규칙이 전역 클래스를 이긴다.
  */
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  .danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .danger:hover:not(:disabled) {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
