<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { RENAME_MAX_CHARS, renameDraft } from "$lib/agent-sessions";

  /**
   * **지난 대화 이름 고치기 칸** — 줄의 제목 자리에 선다(docs/log/2026-10-24-convo-rename.md). 상태줄 지난 대화
   * (`FolderConversations`)와 프로젝트 시작 화면(`ProjectStart`)이 같은 칸을 쓴다(단추는 `ConvoRowActions` 의 ⋯ 메뉴).
   *
   * Enter = 저장(그대로면 닫기만) · Esc = 취소. 저장 중은 칸 안의 돌기 하나(칸 높이는 그대로), 실패하면 칸을 그대로 두고 아래에
   * 떠 있는 말풍선으로 Rust 의 문구를 보인다. 포커스를 잃어도 닫지 않는다 —
   * 메뉴가 닫히며 목록이 포커스를 되찾는 순간과 겹치기 때문이다(닫는 길은 Enter · Esc 둘). 키 · 마우스는 줄 · 목록으로 번지지 않는다
   * (두 화면 모두 줄 · 목록이 Enter · ↑↓ · 더블클릭을 쥔다).
   */
  let {
    value,
    onsave,
    ondone,
  }: {
    /** 지금 제목 — 칸의 처음 글자 */
    value: string;
    /** 다듬은 이름을 적는다 — 실패는 던진다(문구 = 화면에 보일 것) */
    onsave: (name: string) => Promise<void>;
    /** 닫는다(저장 끝 · 취소) */
    ondone: () => void;
  } = $props();

  // 처음 글자만 받는다(그 뒤로는 사람이 고친다)
  // svelte-ignore state_referenced_locally
  let draft = $state(value);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let el = $state<HTMLInputElement | null>(null);

  $effect(() => {
    if (!el) return;
    el.focus();
    el.select();
  });

  async function save(): Promise<void> {
    if (busy) return;
    const d = renameDraft(draft, value);
    if (d.kind !== "ok") {
      if (d.kind === "same") ondone();
      else if (d.kind === "empty") error = t("board.convo.rename.empty");
      else error = t("board.convo.rename.tooLong", { n: RENAME_MAX_CHARS });
      return;
    }
    busy = true;
    error = null;
    try {
      await onsave(d.name);
      ondone();
    } catch (e) {
      error = t("board.convo.rename.failed", { e: e instanceof Error ? e.message : String(e) });
    } finally {
      busy = false;
    }
  }

  function onKeydown(ev: KeyboardEvent): void {
    ev.stopPropagation();
    if (ev.isComposing) return;
    if (ev.code === "Enter" || ev.code === "NumpadEnter") {
      ev.preventDefault();
      void save();
    } else if (ev.code === "Escape") {
      ev.preventDefault();
      if (!busy) ondone();
    }
  }

  function stop(ev: Event): void {
    ev.stopPropagation();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<span class="edit" data-convo-rename onclick={stop} ondblclick={stop} onmousedown={stop}>
  <input
    class="menu-input"
    type="text"
    bind:this={el}
    bind:value={draft}
    maxlength={RENAME_MAX_CHARS * 2}
    disabled={busy}
    autocomplete="off"
    spellcheck="false"
    aria-label={t("board.convo.rename.aria")}
    aria-invalid={error !== null}
    title={t("board.convo.rename.hint")}
    onkeydown={onKeydown}
    oninput={() => (error = null)}
  />
  {#if busy}
    <span class="spin" role="status" aria-label={t("board.convo.rename.saving")} title={t("board.convo.rename.saving")}></span>
  {:else if error}
    <span class="err" role="alert" data-convo-rename-error>{error}</span>
  {/if}
</span>

<style>
  /* 칸 높이는 늘 그대로 — 저장 중은 칸 안 오른쪽 끝의 작은 돌기, 실패는 칸 아래에 떠 있는 말풍선(줄 · 목록을 밀지 않는다) */
  .edit {
    position: relative;
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
  }

  .edit .menu-input {
    flex: 1 1 auto;
    min-width: 0;
    height: 24px;
    margin: 0;
    padding-right: 22px;
  }

  .edit .menu-input[aria-invalid="true"] {
    border-color: var(--err);
  }

  .spin {
    position: absolute;
    top: 50%;
    right: 7px;
    width: 10px;
    height: 10px;
    margin-top: -5px;
    box-sizing: border-box;
    border: 2px solid color-mix(in srgb, var(--fg-2) 25%, transparent);
    border-top-color: var(--fg-1);
    border-radius: 50%;
    animation: cte-spin 0.8s linear infinite;
    pointer-events: none;
  }

  @keyframes cte-spin {
    to {
      transform: rotate(360deg);
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .spin {
      animation: none;
    }
  }

  .err {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 5;
    padding: 4px 8px;
    border: 1px solid var(--err);
    border-radius: 6px;
    background: var(--surface-raised-solid);
    box-shadow: var(--shadow-raised);
    color: var(--err);
    font-size: var(--t-xs);
    white-space: normal;
  }
</style>
