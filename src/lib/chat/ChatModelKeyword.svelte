<script lang="ts" module>
  /** 키워드 한 벌 — 부르는 쪽이 다 지은 값(AI 타일 대화 면) */
  export interface KeywordView {
    cli: string;
    /** 모델 글자 — 모르면 `null`(로고만) */
    label: string | null;
    /** 막대 칸(낮은 것부터) — 비면 막대 없음 */
    efforts: readonly string[];
    /** 지금 강도 — 칸 밖이면 막대가 비어 있다 */
    effort: string;
    title: string;
    open: boolean;
    /** 잠김 — 흐리고 ⌄ 없음 · 누름은 무시 */
    locked: boolean;
    onopen: (el: HTMLElement) => void;
  }
</script>

<script lang="ts">
  /**
   * **모델 키워드**(2026-11-13 — 사이드 채팅 입력 칸 안 보내기 왼쪽 · 목업 D1) — `CLI 로고 · 모델 이름 · 작은 Effort 막대 · ⌄` 한 단추. 누르면 모델
   * 메뉴(`ChatModelPopover` — CLI 스위치 · 모델 · Effort). 모델 이름은 목록 줄과 같은 글자(`keywordModelLabel`), 강도는 글자 대신 막대(단계
   * 이름은 `title` · `aria-label`) — 강도를 받지 않는 모델이면 막대가 없다. 확인하지 않은 CLI 버전이면 경고 그림.
   *
   * 좁은 알약(`FlipComposer` 의 `container: composer`)에서는 이름을 더 줄이고, 아주 좁으면 이름 · 막대를 감춰 `로고 ⌄` 만 남긴다.
   *
   * 몸은 두 갈래가 같다: 사이드 채팅은 `ctl`(`SideChatControls`)을 주고, **AI 타일 대화 면**(2026-11-13 — 목업 E2 · E4 · `pane/AiFlip`)은
   * 다 지은 `view`(`KeywordView` — 기록의 마지막 답에서 읽은 값)를 준다. `view` 에만 있는 것: 이름 없음(첫 답 전 — 로고만) · **잠김**
   * (에이전트가 일하는 중 — 흐리고 ⌄ 없음 · 눌러도 열리지 않는다).
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import AiGlyph from "$lib/AiGlyph.svelte";
  import { aiIconName } from "$lib/pane-icons";
  import { effortName, keywordModelLabel, type SideChatControls } from "$lib/chat/side-chat-controls.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    ctl,
    view,
    cliName = "",
    touch = false,
  }: { ctl?: SideChatControls; view?: KeywordView; cliName?: string; touch?: boolean } = $props();

  /** 사이드 채팅의 손잡이 → 같은 한 벌(모양 · 동작은 예전 그대로) */
  const k = $derived.by((): (KeywordView & { untested: string | null }) | null => {
    if (view) return { ...view, untested: null };
    const chat = ctl?.chat;
    if (!ctl || !chat) return null;
    const c = ctl;
    const effortText = t("app.chatDock.effort.chip", { e: effortName(chat.effort) });
    const head = `${cliName} · ${keywordModelLabel(chat.model)}${c.effortShown ? ` · ${effortText}` : ""}`;
    return {
      cli: chat.cli,
      label: keywordModelLabel(chat.model),
      efforts: c.effortShown ? c.efforts : [],
      effort: chat.effort,
      title: c.untested ? `${head}\n${t("app.chatDock.chip.untested", { v: c.untested })}` : head,
      open: c.modelOpen,
      locked: false,
      onopen: (el) => c.toggleModel(el),
      untested: c.untested,
    };
  });
  const logo = $derived(k ? aiIconName(k.cli) : null);
  /** 막대 — 칸 수 = 단계 수, 지금 단계까지 찬다(Default · 모름이면 비어 있다) */
  const filled = $derived(k ? k.efforts.indexOf(k.effort) + 1 : 0);
</script>

{#if k}
  <button
    type="button"
    class="kw"
    class:on={k.open}
    class:locked={k.locked}
    class:touch
    data-chat-model-chip
    data-locked={k.locked ? "" : undefined}
    aria-haspopup="dialog"
    aria-expanded={k.open}
    aria-disabled={k.locked ? "true" : undefined}
    tabindex={k.locked ? -1 : undefined}
    aria-label={k.title}
    title={k.title}
    onclick={(ev) => {
      if (!k.locked) k.onopen(ev.currentTarget);
    }}
  >
    <span class="kw-logo" aria-hidden="true">{#if logo}<AiGlyph name={logo} size={14} mono />{:else}<UiIcon name="ai" size={14} />{/if}</span>
    {#if k.label !== null}<span class="kw-name" data-chat-model-name>{k.label}</span>{/if}
    {#if k.efforts.length > 0}
      <span class="kw-gauge" style:--kw-n={k.efforts.length} data-chat-effort-bars={filled} aria-hidden="true">
        {#each k.efforts as e, i (e)}<span class="kw-bar" class:filled={i < filled} style:--kw-i={i}></span>{/each}
      </span>
    {/if}
    {#if k.untested}<span class="kw-warn" aria-hidden="true"><UiIcon name="warning" size={12} /></span>{/if}
    {#if !k.locked}<span class="kw-chev" aria-hidden="true"><UiIcon name="chevron-down" size={14} /></span>{/if}
  </button>
{/if}

<style>
  /* 알약 칸 안 — 보내기 원과 같은 높이 대(30) · 글자 단추(테두리 없음) · 메뉴가 열려 있으면 고른 면 */
  .kw {
    position: relative;
    height: 30px;
    max-width: 100%;
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 0 4px 0 8px;
    font-family: var(--font-ui);
    font-size: var(--t-xs);
    color: var(--fg-2);
    white-space: nowrap;
    background: transparent;
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .kw:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .kw.on {
    color: var(--control-sel-fg);
    background: var(--control-sel-bg);
  }

  /* 잠김(AI 타일 — 에이전트가 일하는 중 · 목업 E4) — 흐리게만, 누름 · 고른 면 · 테두리 없음 · ⌄ 자리만큼 오른쪽을 맞춘다.
     메뉴를 닫으며 돌려받은 포커스가 그대로 남아 포커스 고리가 테두리처럼 보였다(2026-11-13 실기) — 잠긴 동안은 Tab 에서도 빠진다 */
  .kw.locked {
    padding-right: 8px;
    opacity: 0.5;
    cursor: default;
  }

  .kw.locked:hover {
    color: var(--fg-2);
    background: transparent;
  }

  .kw.locked:focus-visible {
    outline: none;
  }

  .kw:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }

  /* 폰 — 보이는 크기는 그대로, 누르는 자리만 44px 근처로 넓힌다 */
  .kw.touch::after {
    content: "";
    position: absolute;
    inset: -7px -2px;
  }

  .kw-logo,
  .kw-chev,
  .kw-warn {
    flex: none;
    display: inline-flex;
  }

  .kw-warn {
    color: var(--warn);
  }

  .kw-name {
    min-width: 0;
    max-width: 9em;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* 작은 막대 — 칸마다 키가 자란다(낮은 것부터). 찬 칸 = 주 색(`--control-on-bg`), 빈 칸 = 게이지 비활성 */
  .kw-gauge {
    flex: none;
    display: inline-flex;
    align-items: flex-end;
    gap: 1.5px;
    height: 12px;
  }

  .kw-bar {
    flex: none;
    width: 2.5px;
    height: calc(4px + (8px * (var(--kw-i) + 1) / var(--kw-n)));
    border-radius: 1px;
    background: var(--control-track);
  }

  .kw-bar.filled {
    background: var(--control-on-bg);
  }

  /* 좁은 알약 — 이름을 줄이고, 아주 좁으면 이름 · 막대를 감춰 로고 ⌄ 만 */
  @container composer (max-width: 300px) {
    .kw-name {
      max-width: 5.5em;
    }
  }

  @container composer (max-width: 230px) {
    .kw-name,
    .kw-gauge {
      display: none;
    }
  }
</style>
