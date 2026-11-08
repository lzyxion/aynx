<script lang="ts">
  import { closeCoverView, plansCoverOpen } from "$lib/app/usage-view.svelte.js";
  import CoverPanel from "$lib/CoverPanel.svelte";
  import PlansView from "$lib/PlansView.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  // ---------------------------------------------------------------------------
  // **원격 창(데스크톱 폭)의 작업안 판** (2026-10-25) — 작업안은 집 PC 주 창의 채팅 독 갈래에 산다(독은 원격에 없다). 원격 창은
  // 집 PC 레이아웃을 바꾸지 않고 사용량 · 자원 화면과 같은 급의 판(캔버스를 덮는다 · 한 번에 하나 — `app/usage-view.svelte.ts`)으로
  // 본다. 여는 길은 `app/plans.svelte.ts` 의 `openPlans` 원격 갈래(폰 배치면 `mobile/MobilePlans.svelte`). 승인은 원격 재확인
  // 규칙 그대로다(`remote/deny.rs` — 새 명령 없음). `+page` 가 원격 · 데스크톱 배치에서만 마운트한다(작업안 몸통이 창에 둘 서지 않게).
  // ---------------------------------------------------------------------------
</script>

<CoverPanel
  open={plansCoverOpen()}
  title={t("board.plans.title")}
  subtitle={t("board.view.list.title")}
  onclose={() => closeCoverView()}
  data-plans-cover
>
  <PlansView visible={plansCoverOpen()} />
</CoverPanel>
