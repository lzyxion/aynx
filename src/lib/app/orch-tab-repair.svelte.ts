/**
 * **오케스트레이션 탭 모양 맞추기**(2026-10-29 오케스트레이션 탭 1단계 → 2026-10-30 2단계 단계 6 — aynx-notes
 * docs/log/2026-10-30-orchestration-structured-producer.md 6절 — 1단계 탭을 보통 탭으로
 * 돌리던 복원 갈래는 10-30 호환 걷기에서 걷었다).
 *
 * 탭 트리는 저장 · 창 이관 · 손 편집으로 앱이 쥔 고정 배치에서 벗어날 수 있다. 이 창의 탭을 지켜보다 둘을 고친다(순수 판정은
 * `orchestration/orch-tab.ts`):
 *
 * - **플레이어 잎이 사라진 오케스트레이션 탭**(사람이 플레이어를 닫음)은 표지(`orch`)를 걷어 보통 탭으로 돌린다 — 그 안의 타일은 그대로.
 * - 경로를 정규화한다. 모르는 표지는 라이브러리로 버리고, 라이브러리·아티스트에서 프로듀서 잎을 뺀다.
 * - new 경로는 플레이어 안에서만 초안을 그린다. 서버 채팅·프로듀서 잎은 제출이 성공한 뒤 세운다.
 *
 * 원격 창은 맞추지 않는다(탭은 집 PC 창이 쥔다 — 집 PC 창이 같은 탭을 보고 맞춘다). 서버에는 아무것도 적지 않는다(1단계의 "프로듀서 표지"
 * Tauri 명령은 걷었다 — 프로듀서는 프로듀서 채팅 자체다).
 */

import { isRemote } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { residentWindowTabs } from "$lib/app/tabs.svelte.js";
import { orchBroken, orchRoot, orchPath, playerPaneOf, producerLeafOf } from "$lib/orchestration/orch-tab";
import { studioLabel } from "$lib/app/studio-projects.svelte.js";

let started = false;

/** 창마다 한 번(부팅 — 집 PC 창). */
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

