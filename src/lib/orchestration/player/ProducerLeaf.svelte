<script lang="ts">
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
  const ended = $derived(albumEnded(runSummaryOf(runId)));
  const target = $derived.by((): ProducerTarget | null => {
    if (!spec?.opened || !runId) return null;
    return { chat: spec.chatId, cli: spec.cli === "codex" ? "codex" : "claude", model: spec.model, effort: spec.effort,
      studio: spec.studio, conv: spec.conv ?? null, adoptRun: runId };
  });
  // 붙기는 채팅 id 에만 건다 — target 이 대화 id 로 새로 지어질 때 떠났다 다시 붙으면 첫 말 말풍선을 잃고
  // CLI 가 아직 쓰지 않은 기록을 읽어 "그 대화를 찾지 못했습니다" 가 뜬다.
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
