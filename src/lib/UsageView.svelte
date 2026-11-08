<script lang="ts">
  import { closeCoverView, usageViewOpen } from "$lib/app/usage-view.svelte.js";
  import CoverPanel from "$lib/CoverPanel.svelte";
  import UsageBoard from "$lib/console/UsageBoard.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  // ---------------------------------------------------------------------------
  // **사용량 화면** — 타일 캔버스를 통째로 덮는 사용량 전용 판 (2026-10-04 — 대시보드의 "사용량" 칸에서
  // 떼어 냈다). 상태는 `app/usage-view.svelte.ts`, 내용은 그 칸이 그리던 것 그대로(`console/UsageBoard.svelte`
  // — 맨 위 사용 한도 카드 `UsageLimits` 부터 모델 표까지). 데이터 읽기·폴링은 그 컴포넌트들이 이 화면이
  // **보이는 동안** 켠다(`usageViewOpen()`).
  //
  // 껍데기(덮기 · 키보드 · Escape · 아래에서 떠오르는 움직임)는 `CoverPanel.svelte` — 자원 화면(`ResourceView.svelte`)과 나눠 쓴다
  // (2026-10-17 — 잠깐 이 판 안의 [사용량 | 자원] 칸이었던 것을 따로 떼며 껍데기를 뺐다).
  // `data-usage-view` 는 하네스가 잡는 손잡이다.
  // ---------------------------------------------------------------------------
</script>

<CoverPanel
  open={usageViewOpen()}
  title={t("board.usageView.title")}
  subtitle={t("board.usageView.subtitle")}
  onclose={() => closeCoverView()}
  data-usage-view
>
  <UsageBoard />
</CoverPanel>
