<script lang="ts">
  import type { Snippet } from "svelte";
  import type { MessengerChannel } from "$lib/messenger-notify";
  import type { ChannelHead } from "$lib/settings/messenger-view";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import BrandMark from "$lib/settings/BrandMark.svelte";
  import StatusChip from "$lib/settings/StatusChip.svelte";

  /** 채널 줄에 [+ 연결] 단추 · ⋯ 메뉴를 두지 않는다 — 그 일은 몸통의 줄이 한다(일관성 우선) */
  let {
    channel,
    name,
    id,
    open,
    first,
    last,
    instant = false,
    ontoggle,
    connected,
    sendId,
    send,
    onSendChange,
    head,
    aside = "",
    anchorFor,
    children,
  }: {
    channel: MessengerChannel;
    name: string;
    /** 팔레트 색인의 anchor(`messenger-channel-<채널>`) */
    id: string;
    open: boolean;
    first: boolean;
    last: boolean;
    instant?: boolean;
    ontoggle: () => void;
    connected: boolean;
    sendId: string;
    send: boolean;
    onSendChange: (on: boolean) => void;
    head: ChannelHead;
    /** 남의 글자일 수 있어 글자로만 그린다 */
    aside?: string;
    /** 접혀 있거나 아직 없는 몸통 안 줄의 색인 anchor — 색인이 이 칸으로 떨어진다(`data-anchor-for`) */
    anchorFor?: string;
    children: Snippet;
  } = $props();

  const bodyId = $derived(`${id}-body`);
</script>

<section
  class="slist-item channel"
  class:off={connected && !send}
  class:open
  class:instant
  class:g-first={first}
  class:g-last={last}
  {id}
  data-messenger-channel={channel}
  data-messenger-open={open ? "" : undefined}
  data-anchor-for={anchorFor}
>
  <div class="slist-row">
    <button type="button" class="slist-open" aria-expanded={open} aria-controls={bodyId} onclick={ontoggle}>
      <span class="slist-lead brand-lead" aria-hidden="true"><BrandMark {channel} size={18} /></span>
      <span class="slist-text">
        <span class="slist-title"><span class="slist-name">{name}</span></span>
        <span class="slist-sup chip-line" data-messenger-state={channel}>
          {#if head.kind}<StatusChip tone="info" data-messenger-kind>{t(head.kind)}</StatusChip>{/if}
          {#each head.chips as c (c.key)}
            <StatusChip tone={c.tone} title={c.tone === "bad" && aside ? aside : undefined} data-tip-place="above"
              >{t(c.key)}</StatusChip
            >
          {/each}
          {#if aside}<span class="aside">{aside}</span>{/if}
        </span>
      </span>
    </button>
    <span class="slist-trail">
      {#if connected}
        <span class="slist-switch">
          <Toggle
            id={sendId}
            checked={send}
            label={t("settings.messenger.channel.send.label", { channel: name })}
            onchange={onSendChange}
          />
        </span>
      {:else}
        <span class="slist-switch empty" aria-hidden="true"></span>
      {/if}
      <span class="slist-chev" aria-hidden="true"><UiIcon name="chevron-down" size={16} /></span>
    </span>
  </div>

  <div class="slist-collapse" id={bodyId} inert={!open}>
    <div class="slist-collapse-inner">
      <div class="slist-panel">
        <div class="rows term slist-body">
          {@render children()}
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  /* 밝은 테마는 `BrandMark` 가 칩을 걷으므로 앞 칸 면을 그대로 둔다 — 걷으면 마크만 떠 AI 에이전트 줄과 모양이 갈린다 */
  :global(:root:not([data-theme="light"])) .brand-lead {
    background: none;
  }

  .brand-lead :global(.brand) {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }

  /* 칩 높이를 공용 `.slist-sup` 의 넘침 자르기가 깎지 않게 */
  .slist-sup.chip-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-1);
    overflow: visible;
    white-space: normal;
  }

  .aside {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg-3);
  }
</style>
