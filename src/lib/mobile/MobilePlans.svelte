<!--
  **폰 작업안 화면**(원격 웹 R5 · 2026-10-25) — 전체 화면 덮개. 작업안은 집 PC 주 창의 채팅 독 갈래에 살고(독은 원격에 없다), 폰은 집 PC
  레이아웃을 바꾸지 않고 이 덮개로 본다(`app/plans.svelte.ts` 의 `openPlans` 원격 · 폰 갈래). 들어오는 길: 시트(`MobileSheet`)의 작업안 줄 ·
  알림 화면(`MobileAlerts`)의 [작업안 기록] · 승인 대기 줄(`openPlansAt`).

  - 머리: ← 닫기(뒤로) + "작업안". 휴대폰 '뒤로' 도 닫는다 — 다른 폰 덮개와 같은 기록 칸(`MobileBar` 의 SvelteKit `pushState`).
  - 몸: `PlansView` 의 폰 꼴(`phone`) — 보기 탭 넓은 두 칸 · 감사 알약 · 거절/승인 터치 크기(44). 승인은 원격 재확인 규칙 그대로다
    (`remote/deny.rs` — 마스터가 있으면 그 순간 다시 묻는다 · 새 명령 없음).
  - 오른쪽에서 밀려 들어오고 밀려 나간다(다른 전체 화면 덮개와 같은 `pushOut`).
-->
<script lang="ts">
  import { pushOut } from "$lib/mobile/motion";
  import PlansView from "$lib/PlansView.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { closeMobileOverlay } from "$lib/app/mobile-sheets.svelte.js";

  let backBtn = $state<HTMLButtonElement | null>(null);
  // 열리면 뒤로 단추에 포커스 — 입력 칸이 아니라 화면 키보드가 뜨지 않고, Esc 가 이 덮개에서 받힌다
  $effect(() => {
    backBtn?.focus({ preventScroll: true });
  });

  function onkeydown(ev: KeyboardEvent) {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    ev.stopPropagation();
    closeMobileOverlay();
  }
</script>

<div class="mplans" out:pushOut|global role="dialog" aria-modal="true" aria-labelledby="mobile-plans-title" tabindex="-1" data-mobile-plans {onkeydown}>
  <header class="head">
    <button
      type="button"
      class="round"
      bind:this={backBtn}
      title={t("app.mobile.picker.close")}
      aria-label={t("app.mobile.picker.close")}
      onclick={closeMobileOverlay}><UiIcon name="chevron-left" size={20} /></button
    >
    <h2 id="mobile-plans-title" class="title">{t("board.plans.title")}</h2>
  </header>

  <div class="body">
    <PlansView visible={true} phone={true} />
  </div>
</div>

<style>
  .mplans {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    height: var(--app-h, 100dvh);
    /* 다른 폰 덮개와 같은 층 — 확인 상자(114) · 가림막 · 모달(100) 아래 */
    z-index: 90;
    display: flex;
    flex-direction: column;
    background: var(--m3-surface-container);
    color: var(--fg-1);
    outline: none;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }
  @media (prefers-reduced-motion: no-preference) {
    .mplans {
      animation: mplans-in 280ms cubic-bezier(0.2, 0.8, 0.2, 1);
    }
  }
  @keyframes mplans-in {
    from {
      /* 화면 폭 전체가 오른쪽에서 밀려 들어온다(밀어 넣는 화면 — 알림 · 설정 덮개와 같은 말) */
      transform: translateX(100%);
    }
  }
  .head {
    flex: 0 0 auto;
    display: flex;
    align-items: center;
    gap: var(--space-2);
    height: 56px;
    padding: 0 var(--space-2);
  }
  .title {
    margin: 0;
    font-size: 17px;
    font-weight: var(--fw-semibold);
  }
  .round {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: 999px;
    background: transparent;
    color: var(--fg-1);
    cursor: pointer;
  }
  .round:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: -2px;
  }
  .body {
    flex: 1 1 auto;
    min-height: 0;
  }
</style>
