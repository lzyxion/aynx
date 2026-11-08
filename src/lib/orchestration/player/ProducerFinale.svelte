<script lang="ts">
  // ---------------------------------------------------------------------------
  // **프로듀서 마무리 카드**(10-31 — 목업 `V3AlbumDone`). 끝난 앨범의 머리 아래 한 장: 프로듀서 얼굴 · "프로듀서 마무리 · 시각 · 앨범 완료" ·
  // 그 프로듀서 대화의 **마지막 어시스턴트 말** 앞부분(세 줄 · 넘치면 말줄임) · 오른쪽 [전체 대화 →](왼쪽 대화 기록 잎).
  // 사람이 완료 · 중단한 앨범이면 머리글이 "앨범 완료 전 프로듀서의 마지막 말"이다(그 말은 끝나기 전의 말이라 본문이 머리글과 어긋날 수 있다 · 2026-11-05).
  // 글은 대화 기록 화면과 같은 읽기(`agent_conversation_transcript` — 최신 쪽 하나)로만 얻는다. 기록이 없거나 못 읽으면 카드를 그리지 않는다.
  // 프로듀서는 앨범이 끝난 뒤에 최종 요약을 쓰므로 채팅이 닫힐 때까지 다시 읽는다(`followFinale` — 2026-11-07).
  // 본문은 이 화면에만 — 저장 · 로그로 보내지 않는다.
  // ---------------------------------------------------------------------------
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { agentConversationTranscript } from "$lib/context";
  import { finalePreview, followFinale } from "../model/producer";
  import { producerChatStatus } from "../producer-api";
  import ArtistAvatar from "./ArtistAvatar.svelte";

  let {
    chat,
    cli,
    conv,
    runState,
    byHuman = false,
    onopen,
  }: {
    /** 그 프로듀서 채팅 id — 열려 있는 동안 글을 다시 읽는다 */
    chat: string;
    cli: "claude" | "codex";
    /** 그 프로듀서 채팅 자신의 대화 id */
    conv: string;
    /** 앨범 상태 낱말(`done` · `stopped` · `stopping`) */
    runState: string;
    /** 사람이 끝냈다(`endedByHuman`) — 이 말은 끝나기 전의 말이라 머리글이 그렇게 말한다 */
    byHuman?: boolean;
    onopen: () => void;
  } = $props();

  const done = $derived(runState === "done");
  const title = $derived(
    !byHuman ? t("orch.album.finale.title") : t(done ? "orch.album.finale.beforeDone" : "orch.album.finale.beforeStop"),
  );

  let preview = $state<{ text: string; at: number | null } | null>(null);
  $effect(() => {
    const c = cli;
    const id = conv;
    const room = chat;
    preview = null;
    // 최종 요약은 앨범이 끝난 뒤에 적힌다 — 채팅이 닫힐 때까지 다시 읽는다
    return followFinale({
      isOpen: () => producerChatStatus(room).then((s) => s.open),
      read: () => agentConversationTranscript(c, id, null, 20).then((page) => finalePreview(page.items)),
      show: (p) => (preview = p),
    });
  });

  function clockOf(at: number | null): string {
    if (at === null) return "";
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }
</script>

{#if preview}
  <section class="finale" data-producer-finale data-finale-by-human={byHuman || undefined} aria-label={title}>
    <ArtistAvatar {cli} size={30} />
    <div class="body">
      <div class="line">
        <b>{title}</b>
        {#if preview.at !== null}<span class="dim">· {clockOf(preview.at)}</span>{/if}
        {#if !byHuman}<span class="dim">· {t(done ? "orch.album.finale.done" : "orch.album.finale.stopped")}</span>{/if}
        <span class="grow"></span>
        <button type="button" class="all" data-producer-finale-open onclick={onopen}>{t("orch.album.finale.all")}</button>
      </div>
      <p class="text" data-producer-finale-text>{preview.text}</p>
    </div>
  </section>
{/if}

<style>
  .finale {
    display: flex;
    align-items: flex-start;
    gap: 12px;
    margin: var(--space-2) 28px 0;
    padding: 14px 16px;
    border-radius: var(--radius-lg, 16px);
    background: var(--m3-surface-container, var(--surface-hover));
    color: var(--fg-1);
  }
  .body {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .line {
    display: flex;
    align-items: baseline;
    flex-wrap: wrap;
    gap: 4px 6px;
    font-size: var(--t-xs);
  }
  .dim {
    color: var(--fg-3);
  }
  .grow {
    flex: 1 1 auto;
  }
  .all {
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: transparent;
    border: 0;
    border-radius: 999px;
    padding: 2px 8px;
    cursor: pointer;
    white-space: nowrap;
  }
  .all:hover {
    background: var(--control-bg-hover, var(--surface-hover));
  }
  .all:focus-visible {
    outline: 2px solid var(--focus-ring, var(--accent));
    outline-offset: 2px;
  }
  .text {
    margin: 0;
    font-size: var(--t-sm);
    line-height: 1.55;
    overflow-wrap: anywhere;
    overflow: hidden;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    line-clamp: 3;
    -webkit-box-orient: vertical;
  }
  @container album-content (max-width: 480px) {
    .finale {
      margin: var(--space-2) 16px 0;
    }
  }
  @container album-content (max-width: 400px) {
    .finale {
      margin: var(--space-2) 14px 0;
      padding: 12px;
    }
  }
</style>
