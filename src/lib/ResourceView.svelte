<script lang="ts">
  import { closeCoverView, resourceViewOpen } from "$lib/app/usage-view.svelte.js";
  import CoverPanel from "$lib/CoverPanel.svelte";
  import ResourceBoard from "$lib/console/ResourceBoard.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  // ---------------------------------------------------------------------------
  // **자원 화면** (2026-10-17) — 사용량 화면과 같은 급의 둘째 판(캔버스를 덮는다 · 한 번에 하나 — `app/usage-view.svelte.ts`).
  // 진입점은 상태바의 CPU · 메모리 고리(토글)와 타일 머리줄의 자원 칩. 몸통은 `console/ResourceBoard.svelte`(이 PC 전체 · 앱 ·
  // 로컬 타일의 CPU · 메모리, 지난 30분) — 표본은 그 몸통이 이 화면이 **보이는 동안** 당긴다. 처음에는 사용량 화면 안의
  // [사용량 | 자원] 칸이었다. `data-resource-view` 는 하네스가 잡는 손잡이다.
  // ---------------------------------------------------------------------------
</script>

<CoverPanel
  open={resourceViewOpen()}
  title={t("board.resources.title")}
  subtitle={t("board.resources.subtitle")}
  onclose={() => closeCoverView()}
  data-resource-view
>
  <ResourceBoard />
</CoverPanel>
