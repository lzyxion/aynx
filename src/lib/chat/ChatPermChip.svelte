<script lang="ts">
  /**
   * **권한 모드 칩**(2026-11-20 — 사이드 채팅 입력 칸 아래 줄 · 모델 키워드 바로 왼쪽 · 권한 모드 목업).
   * 높이 24 알약 · 그림 13 + 낱말(`Manual` · `Auto` — 번역하지 않는다). Manual = 연한 회색 면(중성) · 방패, Auto = 앱 강조색 채움 · 그림은
   * `PERM_AUTO_ICON`(한 군데에서 바꾼다). 좁은 칸에서도 **줄지 않는다**(모델 이름이 먼저 줄임표로 준다). 누르면 모드 메뉴(`ChatPermMenu`).
   * `title` · `aria-label` 에 지금 모드를 풀어 적는다. 폰(`touch`)은 누르는 자리만 44px 근처로 넓힌다.
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import { PERM_AUTO_ICON, PERM_MANUAL_ICON, PERM_MODE_WORD, permChipTitle } from "$lib/chat/perm-mode";
  import type { SideChatControls } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let { ctl, touch = false }: { ctl: SideChatControls; touch?: boolean } = $props();

  const mode = $derived(ctl.permMode);
  const title = $derived(permChipTitle(mode, ctl.permAllow.length, t));
</script>

{#if ctl.chat}
  <button
    type="button"
    class="pm"
    class:auto={mode === "auto"}
    class:on={ctl.permOpen}
    class:touch
    data-chat-perm-chip={mode}
    aria-haspopup="menu"
    aria-expanded={ctl.permOpen}
    aria-label={title}
    {title}
    onclick={(ev) => ctl.togglePerm(ev.currentTarget)}
  >
    <UiIcon name={mode === "auto" ? PERM_AUTO_ICON : PERM_MANUAL_ICON} size={13} />
    <span class="pm-word">{PERM_MODE_WORD[mode]}</span>
  </button>
{/if}

<style>
  /* 24 알약 · 줄지 않는다(`flex: none`) — 좁으면 옆 모델 키워드의 이름이 먼저 준다 */
  .pm {
    position: relative;
    flex: none;
    height: 24px;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 0 9px 0 7px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    white-space: nowrap;
    color: var(--fg-2);
    background: var(--control-tile-bg);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .pm:hover {
    color: var(--fg-1);
    background: var(--control-tile-bg-hover);
  }

  /* Auto — 앱 강조색 채움 */
  .pm.auto {
    color: var(--on-accent);
    background: var(--accent);
  }

  .pm.auto:hover {
    background: var(--accent-hover, var(--accent));
  }

  .pm:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 메뉴가 열려 있다 — 면은 그대로(모드 색이 뜻이다) · 포커스 테두리와 같은 결의 얇은 테두리 */
  .pm.on {
    box-shadow: 0 0 0 1px var(--line-strong);
  }

  /* 폰 — 보이는 크기는 그대로, 누르는 자리만 44px 근처 */
  .pm.touch::after {
    content: "";
    position: absolute;
    inset: -10px -3px;
  }
</style>
