<script lang="ts">
  import type { Snippet } from "svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { closeNote, isNoteOpenFor, showNote } from "$lib/settings/note-popover.svelte.js";

  /**
   * **요약 한 줄 + ⓘ** — ⓘ 를 누르면 설명이 **팝오버**로 뜬다
   * (docs/log/2026-09-28-settings-note-popover.md; 처음 모양은 docs/log/2026-09-04-settings-cleanup.md §2).
   *
   * 설명이 두세 줄씩 늘어지면 손잡이(슬라이더·스위치·select)가 화면 밖으로 밀려 **정작
   * 만질 것이 안 보인다**. 그래서 늘 보이는 것은 한 줄 요약 + 살아 있는 값(`60%`·`8px`)뿐이다.
   *
   * 예전에는 ⓘ 가 설명 전문을 요약 **밑에 펼쳤다**(`.note-full`). 펼칠 때마다 줄이 길어져
   * 아래 손잡이들이 통째로 밀려 내려갔다. 지금은 떠 있는 상자라 **줄 높이가 한 픽셀도 변하지
   * 않는다**. 그리는 것은 설정 화면 뿌리의 `NotePopover` 한 벌이고, 여기서는 "이 ⓘ 가 이
   * 스니펫을 열었다" 를 칸(`note-popover.svelte.ts`)에 적기만 한다 — 칸이 하나라 다른 ⓘ 를 열면
   * 앞의 것이 닫힌다. 팝오버를 이 자리(`<label>` 안)에 그리지 않는 이유도 그 파일 머리말에 있다.
   *
   * 호스트 폼(`HostForm.svelte`)도 같은 것을 쓴다(`plain` · 팝오버는 그 모달 뿌리에 한 벌 —
   * docs/log/2026-09-28-hostform-note-popover.md). 긴 설명은 `docs/user/hosts.md` 에 산다.
   *
   * ## 두 가지 자리
   *
   * - 기본은 `.hint` 로 감싼다 — 라벨 안(`SettingRow`)이나 격자의 안내 칸에 들어갈 때.
   * - `plain` 이면 감싸지 않는다 — 이미 `.lead` 문단 안이라 그 문단의 글자 크기를 써야 할 때.
   *
   * ## ⓘ 버튼의 `preventDefault`
   *
   * 이 버튼은 거의 언제나 `<label>` 안에 산다 (안내가 손잡이의 라벨 안에 있으므로). 라벨은
   * 자기 안에서 일어난 클릭을 짝지어진 컨트롤로 넘기는 것이 기본 동작이라, 그대로 두면 ⓘ 를
   * 누를 때마다 스위치가 켜지거나 슬라이더로 포커스가 튄다. `preventDefault` 가 그
   * 넘김을 끊고, `stopPropagation` 은 행 전체를 듣는 바깥 핸들러까지 가지 않게 한다.
   *
   * ## Esc
   *
   * 열면 포커스가 팝오버로 가고 Esc 는 거기서 받는다. 포커스가 ⓘ 에 남아 있는 경우(팝오버가
   * 뜨기 전 다시 누르기 등)도 여기서 받아 끊는다 — 그러지 않으면 한 번의 Esc 가 독을 닫는다.
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
    /** ⓘ 버튼과 팝오버의 접근성 이름 (예: `"모드 설명 자세히"`) — `note` 가 없으면 쓰지 않는다 */
    label?: string;
    /** 늘 보이는 요약 한 줄 */
    summary: Snippet;
    /**
     * ⓘ 를 누르면 팝오버로 뜨는 설명. **없으면 ⓘ 도 없다** — 요약 한 줄로 충분한 줄
     * (선택지 이름이 곧 설명인 것 등). 긴 설명은 `docs/user/settings.md` 에 산다.
     */
    note?: Snippet;
    /** `.hint` 로 감싸지 않는다 (`.lead` 문단 안에서 쓸 때) */
    plain?: boolean;
    /**
     * 단추의 모양 — `info`(ⓘ, 기본) · `warn`(주의 삼각형, 이 아이콘만 `--warn` 색). `warn` 은 켜면 글자가 바깥으로
     * 나가는 줄(메신저의 명령 줄·대화 싣기)에 단다 — 줄 설명은 보통 색 그대로 두고 위험 문장은 팝오버로 뺀다.
     * 팝오버 기계는 같다.
     */
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

<!--
  요약 줄 + ⓘ. `plain` 인지에 따라 `.hint` 한 겹만 달라지므로 몸통은 스니펫으로 한 번만
  적는다 (같은 줄을 두 번 적으면 한쪽만 고치는 사고가 난다).
-->
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
  /* ── 요약 한 줄 + ⓘ ────────────────────────────────────────────────────
     설정 화면과 호스트 폼이 **이 한 벌**을 쓴다 — 사용자가 한 번 배우면 어디서든 통한다. */

  /* 요약 줄 — 문구 + ⓘ 가 **한 문단으로 흐른다**.
     예전에는 `display:flex; flex-wrap:wrap` 이었다. 그러면 요약 `<span>` 이 통째로 flex 항목
     하나라, 문장이 한 줄을 넘는 순간 그 항목이 줄 폭을 다 먹고 ⓘ 가 **다음 줄 맨 앞**으로
     떨어졌다("앱 글꼴" 줄에서 봤다). 지금은 평범한 인라인 흐름이라 ⓘ 는 언제나 문장의 마지막
     낱말 바로 뒤에 붙는다. */
  .note-head {
    display: block;
  }

  /* 인라인 ⓘ — 안내 색을 물려받는 작은 아이콘 버튼 (배경·테두리 없음).
     `UiIcon` 은 `display:block` 이라 상자 안에서 저절로 가운데 서지 않는다. 글줄 안에 서므로
     `vertical-align` 으로 아이콘 몸통을 글자의 x-높이 가운데에 맞춘다(13px 아이콘 · 12px 글자). */
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

  /* 팝오버가 떠 있는 동안은 진하게 — 어느 ⓘ 의 설명인지 눈으로 잇는다 */
  .info-toggle:hover,
  .info-toggle:focus-visible,
  .info-toggle.on {
    opacity: 1;
  }

  .info-toggle.on {
    color: var(--fg-1);
  }

  /* 주의 — 아이콘만 주의색. 흐리게 두지 않는다(눈에 띄어야 하는 표식이다) */
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
