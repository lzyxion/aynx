/** 원격 창은 맞추지 않는다 — 탭은 메인 PC 창이 쥐고 거기서 같은 탭을 맞춘다 */

import { isRemote } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { orchBroken, orchRoot, orchPath, playerPaneOf, producerLeafOf } from "$lib/orchestration/orch-tab";
import { studioLabel } from "$lib/app/studio-projects.svelte.js";

let started = false;

export function startOrchTabRepair(): void {
  if (started || isRemote || typeof window === "undefined") return;
  started = true;
  $effect.root(() => {
    $effect(() => {
      for (const tab of residentWindowTabs()) {
        if (!tab.orch) continue;
        if (orchBroken(tab)) { delete tab.orch; continue; }
        const path = orchPath(tab);
        if (JSON.stringify(path) !== JSON.stringify(tab.orch)) tab.orch = path;
        if (path.view === "library" || path.view === "artists" || path.view === "studio") {
          const title = path.view === "studio" ? studioLabel(path.repo ?? "") : t(path.view === "library" ? "orch.home.library" : "orch.nav.artists");
          if (tab.pinnedTitle !== title) { tab.pinnedTitle = title; tab.title = title; }
        }
        const player = playerPaneOf(tab)!;
        if (!path.runId && player.run) delete player.run;
        if (path.runId && player.run?.runId !== path.runId) player.run = { runId: path.runId };
        if ((path.view === "library" || path.view === "studio" || path.view === "artists" || path.view === "new") && producerLeafOf(tab)) tab.root = orchRoot(null, player);
      }
    });
  });
}

