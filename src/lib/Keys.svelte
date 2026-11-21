<script lang="ts">
  /**
   * 단축키 표시 한 벌 — 메뉴 줄의 단축키만 예외로 흐린 글자 한 줄이다(`theme.css` 의 `.menu-kbd`).
   * 구분 글자(`+` · 공백)와 클릭 낱말은 눈에만 숨기고 DOM 에는 남긴다 — 복사 · 스크린 리더 · 하니스의 `textContent` 가 `Ctrl+Shift+H` 로 읽힌다.
   */
  import UiIcon from "$lib/UiIcon.svelte";
  import { mouseButton, splitKeySequence } from "$lib/keycaps";

  let { combo, size = "md" }: { combo: string; size?: "md" | "sm" } = $props();

  const groups = $derived(splitKeySequence(combo));
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
