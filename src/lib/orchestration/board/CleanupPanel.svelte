<script lang="ts">
  // ---------------------------------------------------------------------------
  // **[정리] 창**(통합 설계 6-3) — 앨범 위에 뜨는 넓은 모달: 왼쪽 = 고르기, 오른쪽 = 앨범 그래프(`CleanupGraph`). 연 순간 서버에서 읽은 재료(`clean`)와 고름을 그린다.
  // 열기 · 읽기 · 실행(`doCleanup`)과 고름 상태는 부모 보드가 쥐고, 고름(작업자 worktree · ref · 브랜치도 지우기)만 `bind:` 로 돌려준다.
  // 앨범 판은 컨테이너 질의 상자라 고정 위치가 창이 아니라 판에 묶인다 — 그래서 본문 아래로 옮겨 그린다(`MergeDialog` 와 같은 틀).
  // ---------------------------------------------------------------------------
  import { onMount, tick } from "svelte";
  import { trapTab } from "$lib/focus-trap";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import {
    CLEANUP_BLOCKER_KEY,
    CLEANUP_REF_KEY,
    CLEANUP_REF_TIP,
    cleanupCount,
    cleanupFootText,
    cleanupGroups,
    cleanupRefShort,
    cleanupFirstTab,
    cleanupWorktreeChip,
    keyText,
    shortOid,
    type CleanupGroupId,
    type CleanupPreview,
  } from "$lib/orchestration/model";
  import type { Key } from "$lib/i18n/keys";
  import SegTabs from "../player/SegTabs.svelte";
  import CleanupGraph from "./CleanupGraph.svelte";
  import { shortPath } from "./format";

  let {
    repo,
    clean,
    cleanWt = $bindable(),
    cleanRefs = $bindable(),
    cleanBranches = $bindable(),
    busy,
    doCleanup,
    oncancel,
  }: {
    repo: string;
    clean: CleanupPreview | null;
    cleanWt: string[];
    cleanRefs: string[];
    cleanBranches: boolean;
    busy: boolean;
    doCleanup: () => void;
    oncancel: () => void;
  } = $props();

  let dialogEl = $state<HTMLElement | null>(null);
  let firstEl = $state<HTMLButtonElement | null>(null);

  const GROUP_TITLE: Record<CleanupGroupId, Key> = {
    safe: "orch.cleanup.group.safe",
    review: "orch.cleanup.group.review",
    blocked: "orch.cleanup.group.blocked",
  };
  const GROUP_NOTE: Partial<Record<CleanupGroupId, Key>> = {
    safe: "orch.cleanup.group.safe.note",
    review: "orch.cleanup.group.review.note",
  };

  const groups = $derived(clean ? cleanupGroups(clean.worktrees) : []);
  // 읽기 전에는 지난번 고름이 남아 있을 수 있다 — 재료가 선 뒤에만 센다.
  const picked = $derived(clean ? { worktrees: cleanWt, refs: cleanRefs, branches: cleanBranches } : { worktrees: [], refs: [], branches: false });
  const count = $derived(cleanupCount(picked));
  /** 탭 — 사람이 고르기 전에는 재료로 정한다 */
  let tabPick = $state<string | null>(null);
  const tab = $derived(tabPick ?? (clean ? cleanupFirstTab(clean) : "worktrees"));

  function toggleIn(list: string[], v: string, on: boolean): string[] {
    return on ? [...list.filter((x) => x !== v), v] : list.filter((x) => x !== v);
  }

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function onKey(ev: KeyboardEvent): void {
    if (dialogEl && trapTab(ev, dialogEl)) return;
    // 앱의 전역 단축키 · 터미널이 이 창의 키를 받지 않게(창 버블 리스너보다 먼저 끊는다).
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      oncancel();
    }
  }

  onMount(() => {
    void tick().then(() => (firstEl ?? dialogEl)?.focus());
  });
</script>

<div class="overlay" role="presentation" use:portal onmousedown={(ev) => { if (ev.target === ev.currentTarget) oncancel(); }}>
  <div class="dialog glass-raised" role="dialog" aria-modal="true" aria-labelledby="run-clean-title" tabindex="-1" data-run-cleanup bind:this={dialogEl} onkeydown={onKey}>
    <div class="head">
      <h2 id="run-clean-title">{t("orch.cleanup.title")}</h2>
      <p>{t("orch.cleanup.lead")}</p>
    </div>

    {#if !clean}
      <p class="loading" role="status">{t("orch.cleanup.loading")}</p>
    {:else}
      <div class="graph-slot">
        <CleanupGraph {repo} {clean} picked={cleanWt} onclose={oncancel} />
      </div>

      <div class="picks">
        <!-- 오케스트레이션 화면은 ▶ 펼침을 쓰지 않는다(no-disclosure.test.ts) — 큰 덩어리는 고르기 알약 탭(2026-11-07 사용자 결정 A) -->
        {#if clean.refs.length > 0}
          <SegTabs tabs={[{ id: "worktrees", label: t("orch.cleanup.tab.worktrees", { n: clean.worktrees.length }) }, { id: "refs", label: t("orch.cleanup.tab.refs", { n: clean.refs.length }), title: t("orch.cleanup.tab.refs.tip") }]}
            value={tab} label={t("orch.cleanup.tabs.aria")} idBase="cleanup" name="cleanup" onpick={(id) => (tabPick = id)} />
        {/if}

        {#if tab === "worktrees"}
        <div class="panel" id="cleanup-worktrees" role="tabpanel" aria-labelledby="cleanup-worktrees-tab">
        {#if clean.worktrees.length === 0}
          <p class="small">{t("orch.cleanup.worktrees.empty")}</p>
        {:else}
          {#each groups as g (g.id)}
            {@const note = GROUP_NOTE[g.id]}
            <section class="group" data-cleanup-group={g.id}>
              <div class="group-head">{t(GROUP_TITLE[g.id])}{#if note}<small>{t(note)}</small>{/if}</div>
              <ul>
                {#each g.rows as w (w.path)}
                  {@const chip = cleanupWorktreeChip(w, t)}
                  <li data-cleanup-wt={w.path} data-eligible={String(w.eligible)}>
                    <label class="item" class:off={!w.eligible}>
                      <input type="checkbox" disabled={!w.eligible} checked={cleanWt.includes(w.path)}
                        onchange={(e) => (cleanWt = toggleIn(cleanWt, w.path, (e.currentTarget as HTMLInputElement).checked))} />
                      <span class="text">
                        <b>{w.taskTitle}</b>
                        <span class="mono" title={w.path}>{w.branch ?? shortPath(w.path)}</span>
                      </span>
                      <span class="chip {chip.tone}">{chip.text}</span>
                    </label>
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
          <label class="branches">
            <input type="checkbox" bind:checked={cleanBranches} data-cleanup-branches />
            <span>{t("orch.cleanup.deleteBranches")}<small>{t("orch.cleanup.deleteBranches.note")}</small></span>
          </label>
        {/if}
        </div>
        {:else}
        <div class="panel" id="cleanup-refs" role="tabpanel" aria-labelledby="cleanup-refs-tab" data-cleanup-refs>
          <p class="small first">{t("orch.cleanup.refs.note")}</p>
          <ul>
            {#each clean.refs as r (r.name)}
              <li data-cleanup-ref={r.name} data-kind={r.kind}>
                <label class="item" class:off={!r.eligible} title={CLEANUP_REF_TIP[r.kind] ? t(CLEANUP_REF_TIP[r.kind]) : undefined}>
                  <input type="checkbox" disabled={!r.eligible} checked={cleanRefs.includes(r.name)}
                    onchange={(e) => (cleanRefs = toggleIn(cleanRefs, r.name, (e.currentTarget as HTMLInputElement).checked))} />
                  <span class="text">
                    <b>{keyText(CLEANUP_REF_KEY, r.kind, t)}</b>
                    <span class="mono">{cleanupRefShort(r.name)} · {shortOid(r.oid)}</span>
                  </span>
                  {#if r.blocker}<span class="chip warn">{keyText(CLEANUP_BLOCKER_KEY, r.blocker, t)}</span>{/if}
                </label>
              </li>
            {/each}
          </ul>
        </div>
        {/if}
      </div>
    {/if}

    <div class="foot">
      {#if clean}<span data-cleanup-foot>{cleanupFootText(picked, t)}</span>{/if}
      <button type="button" class="btn btn-ghost" bind:this={firstEl} onclick={() => oncancel()}>{t("orch.cleanup.cancel")}</button>
      <button type="button" class="btn btn-primary" data-cleanup-ok disabled={busy || count === 0} onclick={doCleanup}>{t("orch.cleanup.ok", { n: count })}</button>
    </div>
  </div>
</div>

<style>
  .overlay { position: fixed; inset: 0; z-index: 112; display: grid; place-items: center; padding: var(--space-4); background: rgb(0 0 0 / 0.3); }
  .dialog {
    display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.25fr); grid-template-rows: auto minmax(0, 1fr) auto; gap: 14px 20px;
    width: min(980px, 100%); max-height: calc(100vh - 32px); overflow: hidden; box-sizing: border-box; padding: 22px 24px;
    background: var(--glass-raised, var(--surface-raised-solid)); border: 1px solid var(--line); border-radius: var(--radius-surface); box-shadow: var(--shadow-raised); color: var(--fg-1); outline: none;
  }
  .head, .foot, .loading { grid-column: 1 / -1; }
  .head p { margin: 2px 0 0; font-size: var(--t-sm); color: var(--fg-2); }
  h2 { margin: 0; font-size: 18px; font-weight: var(--fw-semibold); }
  .loading { margin: 0; font-size: var(--t-sm); color: var(--fg-3); }
  .picks { grid-column: 1; grid-row: 2; display: grid; align-content: start; gap: 14px; min-height: 0; overflow-y: auto; }
  .graph-slot { grid-column: 2; grid-row: 2; display: flex; min-width: 0; min-height: 0; }
  .group { display: grid; gap: 6px; }
  .group-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 6px; font-size: var(--t-sm); font-weight: var(--fw-semibold); color: var(--fg-2); }
  .group-head small { font-size: var(--t-xs); font-weight: 400; color: var(--fg-3); }
  ul { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
  .item { display: flex; align-items: flex-start; gap: 10px; min-width: 0; padding: 9px 12px; border-radius: var(--radius-surface-inner); background: var(--surface-hover); font-size: var(--t-sm); }
  .item input { flex: none; margin: 3px 0 0; }
  .item.off { opacity: 0.72; }
  .text { flex: 1 1 auto; display: grid; min-width: 0; }
  .text b { font-weight: 500; overflow-wrap: anywhere; }
  .mono { font-family: var(--font-mono); font-size: 11.5px; color: var(--fg-3); overflow-wrap: anywhere; }
  .chip { flex: none; padding: 0 var(--space-2); font-size: var(--t-xs); line-height: 20px; color: var(--fg-1); border-radius: 999px; white-space: nowrap; }
  .chip.ok { background: var(--ok-soft); }
  .chip.warn { background: var(--warn-soft); }
  .chip.line { color: var(--fg-2); border: 1px solid var(--line); }
  .branches { display: flex; align-items: flex-start; gap: 8px; font-size: var(--t-sm); }
  .branches input { flex: none; margin: 3px 0 0; }
  .branches small { display: block; font-size: var(--t-xs); color: var(--fg-3); }
  .panel { display: grid; align-content: start; gap: 14px; min-width: 0; }
  .small.first { margin: 0; }
  .small { margin: 8px 0 0; font-size: var(--t-xs); color: var(--fg-3); }
  .foot { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 8px; }
  .foot span { flex: 1 1 auto; min-width: 0; font-size: var(--t-sm); color: var(--fg-2); }
  /* 창이 좁거나 폰이면 한 단 — 그래프는 제목 아래, 창 전체가 스크롤한다 */
  @media (max-width: 760px) {
    .dialog { grid-template-columns: minmax(0, 1fr); grid-template-rows: none; overflow-y: auto; }
    .picks, .graph-slot { grid-column: 1; grid-row: auto; }
    .picks { overflow: visible; }
    .graph-slot { max-height: 320px; }
  }
  @media (pointer: coarse) { .foot button { min-height: 44px; padding-inline: 18px; } }
</style>
