<script lang="ts">
  import type { Snippet } from "svelte";
  import type { MessengerChannel } from "$lib/messenger-notify";
  import type { ChannelHead } from "$lib/settings/messenger-view";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import Toggle from "$lib/Toggle.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import BrandMark from "$lib/settings/BrandMark.svelte";
  import StatusChip from "$lib/settings/StatusChip.svelte";

  /**
   * **메신저 채널 한 칸** — 채널 목록(`MessengerSettings`)의 펼침 칸 하나
   * (docs/log/2026-11-18-messenger-bridge.md "1b" · 사용자 확정 목업 B안 — AI 에이전트 설정과 같은 틀).
   *
   * - **머리 줄**(공용 `.slist` 줄) — 브랜드 마크 · 이름 · 방식 칩(Discord · Slack 의 봇 · 웹훅, Telegram 의 봇 — `info` — 점 없는 회색 · 상태가 아니라 종류) · 상태 칩(+ 곁글) · 끝 칸의 "이 채널로 알림 보내기" 스위치 · 펼침 꺾쇠. 머리를 누르면
   *   몸통이 펼쳐진다(한 번에 하나만 — 상태는 부모가 쥔다). 스위치는 **연결된 채널만** 서고, 연결 전이면 자리를 비워 둔다(꺾쇠 열이 맞게).
   *   스위치는 머리 단추 **밖**이라 눌러도 펼침이 바뀌지 않는다(`McpSection` 의 사용 토글과 같다).
   * - **몸통** — 채널마다 다른 줄들(`MessengerBot` · `MessengerDual`)을 `children` 으로 받는다. 접혀 있으면 `inert`.
   *
   * 예전의 [+ 연결] 단추 · ⋯ 메뉴는 없다(2026-11-19 사용자 확인 — 일관성 우선) — 그 일은 몸통의 줄이 한다.
   */
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
    /** 화면에 적는 채널 이름 */
    name: string;
    /** 칸 자체의 id — 팔레트 색인의 anchor(`messenger-channel-<채널>`) */
    id: string;
    open: boolean;
    /** 보이는 묶음의 첫 · 끝(`.g-first` · `.g-last` — `accordionEdges`) */
    first: boolean;
    last: boolean;
    /** 설정 색인이 펼칠 때 전이를 건너뛴다 */
    instant?: boolean;
    ontoggle: () => void;
    /** 연결됐는가 — 보내기 스위치를 세운다 */
    connected: boolean;
    /** 보내기 스위치의 id(`messenger-<채널>`) */
    sendId: string;
    send: boolean;
    onSendChange: (on: boolean) => void;
    /** 머리의 칩들 — `telegramHead` · `dualHead`(맨 앞 방식 칩은 `head.kind`) */
    head: ChannelHead;
    /** 칩 뒤의 곁글(봇 이름 · 겹침 안내) — 남의 글자일 수 있어 글자로만 그린다 */
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
  /* 앞 칸 = 브랜드 칩 자체 — 흰 칩(`BrandMark`)을 공용 앞 칸 크기 · 모서리로 키운다(칩 안에 칩이 겹치지 않게).
     밝은 테마는 `BrandMark` 가 칩을 걷으므로 공용 앞 칸 면을 그대로 둔다 — 걷으면 마크만 떠 AI 에이전트 줄과 모양이 갈렸다(2026-11-19 하네스 캡처) */
  :global(:root:not([data-theme="light"])) .brand-lead {
    background: none;
  }

  .brand-lead :global(.brand) {
    width: 32px;
    height: 32px;
    border-radius: 10px;
  }

  /* 딸린 줄 자리의 칩 줄 — 칩 높이를 공용 `.slist-sup` 의 넘침 자르기가 깎지 않게 · 좁으면 곁글이 줄어든다 */
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
