<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";

  /**
   * 설정의 **하위 화면 틀** — 자동 승인의 묶음 편집(`AutomationBundles`) · 허용 패턴 편집(`AutomationAllow`)과
   * 트리거의 추가 · 편집(`TriggerEditor`) · 스니펫의 추가 · 편집(`SnippetEditor`) · 외부 MCP 서버의 추가 · 편집(`McpServerEditor`) · 보안의 목록 셋(`VaultItemsView` · `DelegationHostsView` · `DbAiTargetsView`) · 테마의 아바타(`AppThemeSection` → `AvatarsSection`)가 함께 쓴다 (docs/log/2026-10-05-auto-approve-args.md ·
   * docs/log/2026-10-05-trigger-examples.md). 맨 위 `‹ <요약 이름>` + 제목, 그 아래는 부른 쪽의 본문.
   *
   * 미끄러지는 움직임 · Escape(하위 화면 → 요약)는 요약 쪽의 `SubViewStack`, 돌아온 뒤 포커스는 요약이 맡는다. 이
   * 틀이 하는 일은 들어올 때 뒤로 가기에 포커스를 두는 것뿐이다(키보드가 새 화면의 맨 위에서 시작한다).
   */
  let {
    title,
    back,
    backAria,
    onback,
    children,
  }: {
    title: string;
    /** 뒤로 가기 글자 — 돌아갈 요약의 이름(`자동 승인` · `트리거` · `스니펫` · `MCP`) */
    back: string;
    backAria: string;
    onback: () => void;
    children: Snippet;
  } = $props();

  let backBtn = $state<HTMLButtonElement | null>(null);

  $effect(() => {
    backBtn?.focus({ preventScroll: true });
  });
</script>

<div class="sub-head">
  <button
    type="button"
    class="btn btn-sm btn-ghost back"
    aria-label={backAria}
    bind:this={backBtn}
    onclick={onback}
  >
    <UiIcon name="chevron-left" size={14} />
    <span>{back}</span>
  </button>
  <h4 class="sub-title">{title}</h4>
</div>

{@render children()}

<style>
  .sub-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin-bottom: var(--space-3);
  }

  /* 고스트 버튼은 판이 없어 글자가 곧 왼쪽 끝 — 안쪽 여백만큼 당겨 본문과 왼쪽을 맞춘다 */
  .back {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: calc(-1 * var(--space-2));
    color: var(--fg-2);
  }

  .back:hover {
    color: var(--fg-1);
  }

  .sub-title {
    margin: 0;
    font-family: var(--font-ui);
    font-size: var(--t-sm);
    font-weight: 600;
    color: var(--fg-1);
  }
</style>
