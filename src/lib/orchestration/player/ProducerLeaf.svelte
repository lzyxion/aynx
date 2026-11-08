<script lang="ts">
  // 연 앨범의 프로듀서 채팅만 그린다. 새 앨범은 플레이어의 new 초안 경로에서 시작한다.
  import { untrack } from "svelte";
  import type { PaneSpec } from "$lib/session";
  import { focusTile, tabOfPane } from "$lib/app/tabs.svelte.js";
  import { closeProducerLog, noteProducerSpec } from "$lib/app/orchestration.svelte.js";
  import { observeProducer, openProducer, type ProducerTarget } from "$lib/app/producer-chat.svelte.js";
  import { runSummaryOf } from "$lib/app/orch-pulse.svelte.js";
  import { albumEnded } from "../model/producer";
  import { albumRunId, playerPaneOf } from "../orch-tab";
  import ProducerChat from "./ProducerChat.svelte";

  let { pane, visible }: { pane: PaneSpec; visible: boolean } = $props();
  const spec = $derived(pane.producer ?? null);
  const tab = $derived(tabOfPane(pane.id));
  const runId = $derived(tab ? albumRunId(tab) : null);
  /** 끝난 앨범 — 이 잎은 [프로듀서 대화 기록](읽기만)이라 머리에 ✕ 가 선다(걷으면 플레이어 전체 폭) */
  const ended = $derived(albumEnded(runSummaryOf(runId)));
  const target = $derived.by((): ProducerTarget | null => {
    if (!spec?.opened || !runId) return null;
    return { chat: spec.chatId, cli: spec.cli === "codex" ? "codex" : "claude", model: spec.model, effort: spec.effort,
      studio: spec.studio, conv: spec.conv ?? null, adoptRun: runId };
  });
  // 붙기는 채팅 id 에만 건다 — 첫 턴이 서면 대화 id 가 잎 주소(`conv`)에 적혀 target 이 새로 지어지는데, 그때 떠났다 다시 붙으면 꼬리(사람의
  // 첫 말 말풍선)를 잃고 CLI 가 아직 쓰지 않은 기록을 읽어 "그 대화를 찾지 못했습니다" 가 떴다(실기 18). 채팅이 같으면 붙은 채로 둔다.
  const chatId = $derived(target?.chat ?? null);
  $effect(() => {
    if (!visible || !chatId) return;
    const tg = untrack(() => target);
    if (tg) return untrack(() => observeProducer(tg));
  });
  function openAlbumBoard() {
    const player = tab ? playerPaneOf(tab) : null;
    if (tab && player) focusTile(tab.id, player.id);
  }
</script>

<div class="leaf" data-producer-leaf={spec?.chatId ?? ""} data-phase="chat">
  {#if target}
    <ProducerChat {target} {runId} onalbum={openAlbumBoard}
      respec={(p) => { noteProducerSpec(pane.id, p); void openProducer({ ...target!, ...p, conv: null }); }}
      onretune={(p) => noteProducerSpec(pane.id, p)}
      onclose={ended && tab ? () => closeProducerLog(tab!.id) : undefined} />
  {/if}
</div>

<style>
  /* 채팅 머리의 좁은 폭 규칙은 창이 아니라 이 잎의 너비를 본다. */
  .leaf { height: 100%; min-height: 0; display: flex; flex-direction: column; background: var(--tile-inner, var(--bg-panel)); container-type: inline-size; }
</style>
