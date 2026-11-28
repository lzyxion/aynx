<script lang="ts">
  /**
   * 채팅 모양 AI 타일의 잎 — 구독은 마운트된 동안 쥔다(숨은 탭도 — 떼어 둔 시계가 돌지 않게).
   * 언마운트가 곧 닫기다(터미널 · 쿼리 타일과 같다 — 탭 · 워크스페이스 전환은 잎을 내리지 않는다). 원격 창 · 창 이관이면 상태 층이 구독만 푼다.
   */
  import { untrack } from "svelte";
  import type { PaneSpec } from "$lib/session";
  import { seedChatTileLink } from "$lib/app/agent-sessions.svelte.js";
  import { chatTileLiveOf, observeChatTile, releaseChatTile, type ChatTileTarget } from "$lib/app/chat-tile-live.svelte.js";
  import ChatTileFace from "./ChatTileFace.svelte";

  let { pane, visible }: { pane: PaneSpec; visible: boolean } = $props();

  const spec = $derived(pane.kind === "chat" ? (pane.chat ?? null) : null);
  const target = $derived.by((): ChatTileTarget | null =>
    spec
      ? {
          paneId: pane.id,
          chat: spec.chatId,
          cli: spec.cli,
          model: spec.model,
          effort: spec.effort,
          cwd: spec.cwd,
          conv: spec.conv ?? null,
          permMode: spec.permMode ?? null,
          tier: spec.tier ?? null,
        }
      : null,
  );
  const live = $derived(spec ? chatTileLiveOf(spec.chatId) : null);

  // 붙기는 채팅 id 에만 건다 — 대화 id · 모델이 명세에 적힐 때마다 떠났다 붙으면 도는 턴의 꼬리를 잃는다
  const chatId = $derived(spec?.chatId ?? null);
  let unobserve: (() => void) | null = null;
  $effect(() => {
    if (!chatId) return;
    const tg = untrack(() => target);
    if (!tg) return;
    // 상태 층이 사본(`$state`)을 읽고 쓴다 — 추적하면 붙기마다 이 효과가 다시 돌아 떠났다 붙기를 되풀이한다
    untrack(() => {
      seedChatTileLink(pane);
      unobserve = observeChatTile(tg);
    });
    return () =>
      untrack(() => {
        // 닫기면 서버 close 가 먼저다 — 관찰을 먼저 풀면 쓸모없는 unsubscribe 가 한 번 더 간다
        releaseChatTile(tg, true);
        unobserve?.();
        unobserve = null;
      });
  });

  /** 새 관찰을 먼저 건다 — 옛 것을 먼저 풀면 사본이 지워져 다시 세우는 동안 기록이 비어 보인다 */
  function retry(): void {
    const tg = target;
    if (!tg) return;
    const old = unobserve;
    unobserve = observeChatTile(tg);
    old?.();
  }
</script>

<div class="leaf" data-chat-tile={spec?.chatId ?? ""} data-chat-tile-cli={spec?.cli ?? ""}>
  {#if target}
    <ChatTileFace {target} {live} {visible} onretry={retry} />
  {/if}
</div>

<style>
  .leaf {
    position: relative;
    height: 100%;
    min-height: 0;
    display: flex;
    flex-direction: column;
    background: var(--tile-inner, var(--bg-panel));
    container-type: inline-size;
  }
</style>
