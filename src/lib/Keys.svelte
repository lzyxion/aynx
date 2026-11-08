<script lang="ts">
  /**
   * 단축키 표시 한 벌 — 앱의 단축키 글자가 이것으로 선다(2026-10-25 통일). **메뉴 줄의 단축키만 예외**로 흐린 글자 한 줄이다
   * (`theme.css` 의 `.menu-kbd` — Windows 는 키 이름이 낱말이라 메뉴 줄마다 칩 셋이 늘어서 무겁다, VS Code 와 같은 갈래).
   *
   * `<Keys combo="Ctrl+Shift+H" />` → `( Ctrl Shift H )` — **조합 하나가 알약 하나**(`.keycap-group`, 2026-10-28)이고 안의 키는
   * `<kbd class="keycap">` 글자, `+` 는 키 사이 간격이 대신한다. 공백으로 이은 시퀀스(`Ctrl+B d`)는 묶음마다 알약이 따로 선다.
   * 쪼개기 규칙은 `keycaps.ts`, 모양은 `theme.css` 의 단축키 칩 절 한 곳 — 부르는 쪽은 자리 · 간격만 정한다.
   *
   * 마우스 클릭 낱말(`클릭` · `우클릭` · `더블클릭` · `click` …— `keycaps.ts` 의 `mouseButton`)은 글자 대신 **마우스 아이콘 칩**이다
   * (`Ctrl+클릭` → `( Ctrl 🖱 )`). 낱말은 숨긴 글자로 칩 안에 남는다.
   *
   * 구분 글자(`+` · 공백)와 클릭 낱말은 눈에만 숨기고 DOM 에는 남긴다 — 복사 · 스크린 리더 · 하니스의 `textContent` 가
   * 예전처럼 `Ctrl+Shift+H` · `Ctrl+클릭` 으로 읽힌다.
   *
   * `size="sm"` 은 글줄 안 · 툴팁처럼 줄 높이가 낮은 자리(알약 높이 16px). 글자색은 둘레의
   * `--keycap-fg` 로 바꾼다(강조색 단추 위 등).
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import { mouseButton, splitKeySequence } from "$lib/keycaps";

  let { combo, size = "md" }: { combo: string; size?: "md" | "sm" } = $props();

  const groups = $derived(splitKeySequence(combo));
  /** 칩 높이 20 · 16 안에 서는 아이콘 한 변 */
  const iconSize = $derived(size === "sm" ? 12 : 14);
</script>

<span class="keycaps" class:sm={size === "sm"}
  >{#each groups as keys, gi (gi)}{#if gi > 0}<span class="keycap-sep">{" "}</span>{/if}<span class="keycap-group"
      >{#each keys as key, i (i)}{@const button = mouseButton(key)}{#if i > 0}<span class="keycap-sep">+</span>{/if}{#if button}<kbd
            class="keycap keycap-mouse"
            data-mouse={button}
            ><UiIcon name={button === "right" ? "mouse-right" : "mouse-left"} size={iconSize} /><span class="keycap-label"
              >{key}</span
            ></kbd
          >{:else}<kbd class="keycap">{key}</kbd>{/if}{/each}</span
    >{/each}</span
>
