<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { closeNote, isNoteOpenFor, showNote } from "$lib/settings/note-popover.svelte.js";

  /**
   * 요약 한 줄 + ⓘ(팝오버 — 그리는 것은 뿌리의 `NotePopover` 한 벌, docs/log/2026-09-28-settings-note-popover.md).
   * ⓘ 는 거의 언제나 `<label>` 안이라 `preventDefault` 로 라벨의 클릭 넘김을 끊는다 — 안 끊으면 스위치가 켜지거나 슬라이더로 포커스가 튄다.
   * 포커스가 ⓘ 에 남은 Esc 도 여기서 끊는다 — 안 끊으면 한 번의 Esc 가 독을 닫는다.
   */
  let {
    id,
    label,
    summary,
    note,
    plain = false,
    tone = "info",
  }: {
    /** 팝오버의 id 를 `{id}-note` 로 정한다 — `aria-controls` 와 짝이 맞아야 한다 */
    id: string;
    label?: string;
    summary: Snippet;
    /** 없으면 ⓘ 도 없다 */
    note?: Snippet;
    plain?: boolean;
    /** `warn` 은 켜면 글자가 바깥으로 나가는 줄(메신저의 명령 줄 · 대화 싣기)에 단다 */
    tone?: "info" | "warn";
  } = $props();

  let btn = $state<HTMLButtonElement | null>(null);
  const open = $derived(isNoteOpenFor(btn));
  const noteId = $derived(`${id}-note`);

  function toggle(ev: MouseEvent): void {
    ev.preventDefault();
    ev.stopPropagation();
    if (!btn || !note) return;
    if (open) closeNote(true);
    else showNote({ id: noteId, anchor: btn, label: label ?? "", note });
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key !== "Escape" || !open) return;
    ev.preventDefault();
    ev.stopPropagation();
    closeNote(true);
  }
</script>

<!-- 몸통은 스니펫으로 한 번만 적는다 — 두 번 적으면 한쪽만 고치는 사고가 난다 -->
{#snippet body()}
  <span class="note-head">
    {@render summary()}
    {#if note}<button
      type="button"
      class="info-toggle"
      class:on={open}
      class:warn={tone === "warn"}
      aria-expanded={open}
      aria-controls={noteId}
      aria-haspopup="dialog"
      title={open ? undefined : t("settings.info.more")}
      aria-label={label}
      bind:this={btn}
      onclick={toggle}
      onkeydown={onKeydown}
    >
      <UiIcon name={tone === "warn" ? "warning" : "info"} size={13} />
    </button>{/if}
  </span>
{/snippet}

{#if plain}
  {@render body()}
{:else}
  <span class="hint">{@render body()}</span>
{/if}

<style>
  /* ── 요약 한 줄 + ⓘ ── */

  /* flex 로 두면 문장이 한 줄을 넘을 때 ⓘ 가 다음 줄 맨 앞으로 떨어진다 — 인라인 흐름으로 둔다 */
  .note-head {
    display: block;
  }

  /* `UiIcon` 은 `display:block` 이라 `vertical-align` 으로 x-높이 가운데에 맞춘다 */
  .info-toggle {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 2px;
    padding: 0;
    vertical-align: -2px;
    line-height: 1;
    color: inherit;
    background: none;
    border: 0;
    border-radius: 3px;
    cursor: pointer;
    opacity: 0.75;
  }

  .info-toggle:hover,
  .info-toggle:focus-visible,
  .info-toggle.on {
    opacity: 1;
  }

  .info-toggle.on {
    color: var(--fg-1);
  }

  .info-toggle.warn,
  .info-toggle.warn.on {
    color: var(--warn);
    opacity: 1;
  }

  .info-toggle:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 1px;
  }
</style>
