<script lang="ts">
  import { closeCoverView, usageViewOpen } from "$lib/app/usage-view.svelte.js";
  import CoverPanel from "$lib/CoverPanel.svelte";
  import UsageBoard from "$lib/console/UsageBoard.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  // `data-usage-view` 는 하네스가 잡는 손잡이다.
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
