<script lang="ts">
  import type { Snippet } from "svelte";
  import InfoNote from "$lib/settings/InfoNote.svelte";
  import TipName from "$lib/settings/TipName.svelte";
  import { t } from "$lib/i18n/i18n.svelte.js";

  /**
   * 설정 한 줄 — **라벨 | 컨트롤**, 라벨 안에 [`InfoNote`] 의 접힌 설명이 딸린다.
   *
   * 예전 `SettingsModal` 의 `.toggle-row` 블록 아홉 개가 전부 같은 열두 줄을 적고 있었다
   * (label.name → 이름 → span.hint → note-head → 요약 → ⓘ 스니펫 → note-full → 컨트롤).
   * 그 열두 줄과 그것이 기대는 CSS 를 여기 한 자리에 모은다.
   *
   * 컨트롤은 **스니펫으로 받는다** — 스위치·슬라이더·드롭다운이 제각각이고, 그 이벤트
   * 배선은 값이 사는 곳(각 섹션 → `settings.svelte.ts` 의 setter)과 붙어 있어야 한다.
   * 여기서 하는 일은 자리와 라벨 묶기(`for={id}`)뿐이다.
   */
  let {
    id,
    label,
    noteLabel,
    summary,
    note,
    tip,
    control,
  }: {
    /** 컨트롤의 `id` — `<label for>` 와 접힌 설명의 `{id}-note` 가 이 값에 매인다 */
    id: string;
    /** 줄의 이름 (라벨 첫 줄) */
    label: string;
    /**
     * ⓘ 버튼의 접근성 이름. 라벨과 다를 수 있어 따로 받는다 — 화면의 이름은 줄 맥락
     * 안에서 짧게 적히지만("밝기"·"투명도") 읽어 주는 이름은 홀로 서야 한다
     * ("모드 설명 자세히"). 안 주면 라벨에서 만든다.
     */
    noteLabel?: string;
    /** 늘 보이는 요약 한 줄 (살아 있는 값 포함) — `tip` 을 주면 쓰지 않는다 */
    summary?: Snippet;
    /** ⓘ 팝오버의 짧은 설명 — 없으면 ⓘ 없이 요약만 선다 */
    note?: Snippet;
    /**
     * **옵트인** — 주면 요약 줄·ⓘ 대신 이 글자가 **라벨에 얹는 툴팁**이 된다 (`TipName` — 앱 테마·터미널 섹션).
     * 말풍선은 앱 툴팁 층(`tooltip.svelte.ts` 가 `title` 을 가로채 테마로 그린다)이 띄우고,
     * 라벨은 Tab 으로 닿으며(포커스에도 뜬다) 같은 글자를 `aria-describedby` 로 잇는다.
     * `\n` 은 줄바꿈으로 읽힌다 (요약 한 줄 + 자세한 설명).
     */
    tip?: string;
    /** 오른쪽 손잡이 — 스위치·슬라이더·드롭다운 */
    control: Snippet;
  } = $props();
</script>

<div class="toggle-row">
  {#if tip !== undefined}
    <TipName {id} {label} {tip} for={id} />
  {:else if summary}
    <label class="name" for={id}>
      {label}
      <InfoNote {id} label={noteLabel ?? t("settings.row.note", { label })} {summary} {note} />
    </label>
  {:else}
    <label class="name" for={id}>{label}</label>
  {/if}
  {@render control()}
</div>

<!--
  모양은 `settings.css` 의 `.toggle-row` 에 있다 — 섹션이 손으로 적는 줄(`.srow`)과 **같은
  규칙 한 벌**을 써야 두 줄이 이웃해도 선·여백이 어긋나지 않는다. 줄 사이 선도 거기서 이웃
  선택자로 긋는다(옛 `flush` 프롭은 그래서 사라졌다 — 소제목 밑 첫 줄은 이웃이 없어 선이 없다).
-->
