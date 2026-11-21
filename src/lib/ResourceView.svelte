<script lang="ts">
  import { closeCoverView, resourceViewOpen } from "$lib/app/usage-view.svelte.js";
  import CoverPanel from "$lib/CoverPanel.svelte";
  import ResourceBoard from "$lib/console/ResourceBoard.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

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
