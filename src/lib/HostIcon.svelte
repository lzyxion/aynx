<script lang="ts">
  import Glyph from "$lib/Glyph.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import {
    glyphFor,
    iconNameOf,
    monoBody,
    logosNameOf,
    lucideNameOf,
    setGlyph,
    uniquifyIds,
    SERVER_D,
    SERVER_RULE,
    type IconGlyph,
  } from "$lib/host-icons";
  import {
    ensureLogos,
    ensureLucide,
    logosSet,
    logosStatus,
    lucideSet,
    lucideStatus,
  } from "$lib/icon-sets.svelte";

  /**
   * 호스트 · 그룹의 `icon` 한 칸 — `svg:` 갈림을 여기 한 곳에 가둔다. 통째 표(logos · lucide)를 받는 동안은 같은 크기의 빈 자리,
   * 표에 없거나 받기가 실패하면 글자 그대로 떨어진다.
   */
  let {
    icon,
    size = 14,
    label = "",
    fallback = "none",
    color = null,
    mono = false,
  }: {
    icon: string | null | undefined;
    size?: number;
    /** 비어 있으면 장식으로 본다 */
    label?: string;
    fallback?: "none" | "server" | "folder";
    /** lucide 와 기본 그림(폴더 · 서버)에만 입힌다 — 컬러 로고 · 이모지는 원본 색이 요점이다 */
    color?: string | null;
    /** 컬러 로고를 `currentColor` 실루엣으로 — 구멍 색은 부모가 `--mono-cut` 으로 준다 */
    mono?: boolean;
  } = $props();

  const name = $derived(iconNameOf(icon));
  const logosName = $derived(name ? null : logosNameOf(icon));
  const lucideName = $derived(name ? null : lucideNameOf(icon));

  $effect(() => {
    if (logosName && logosSet() === null) void ensureLogos();
    if (lucideName && lucideSet() === null) void ensureLucide();
  });

  const logo = $derived.by((): IconGlyph | null => {
    if (name) return glyphFor(name);
    if (logosName) {
      const set = logosSet();
      return set ? setGlyph(set, logosName) : null;
    }
    if (lucideName) {
      const set = lucideSet();
      return set ? setGlyph(set, lucideName) : null;
    }
    return null;
  });
  const line = $derived(lucideName !== null && logo !== null);
  const waiting = $derived(
    (logosName !== null && logosSet() === null && logosStatus() !== "error") ||
      (lucideName !== null && lucideSet() === null && lucideStatus() !== "error"),
  );
  const emoji = $derived(logo || waiting ? null : (icon?.trim() || null));

  /** 전역 카운터를 쓰면 서버 렌더와 하이드레이션의 값이 어긋난다 */
  const uid = $props.id();
  const monoFill = $derived(mono && !line);
  const body = $derived(logo ? uniquifyIds(monoFill ? monoBody(logo.body, name) : logo.body, uid) : "");
</script>

{#if logo}
  <!-- `{@html}` 은 이 저장소가 생성한 번들 마크업뿐이다 — 사용자는 이름만 고르고, 모르는 이름은 위에서 걸러진다 -->
  <svg
    class="logo"
    class:line
    style:color={line ? color || undefined : undefined}
    fill={monoFill ? "currentColor" : undefined}
    viewBox={logo.viewBox}
    width={size}
    height={size}
    role={label ? "img" : "presentation"}
    aria-hidden={label ? undefined : "true"}
    aria-label={label || undefined}>{@html body}</svg
  >
{:else if waiting}
  <span class="waiting" style:width="{size}px" style:height="{size}px" aria-hidden="true"></span>
{:else if emoji}
  <span class="emoji" style:font-size="{size}px" aria-hidden={label ? undefined : "true"}>
    {emoji}
  </span>
{:else if fallback === "server"}
  <span class="server" style:color={color || undefined}><Glyph d={SERVER_D} rule={SERVER_RULE} {size} {label} /></span>
{:else if fallback === "folder"}
  <!-- 이모지 📁 는 글꼴의 노랑 고정이라 테마를 따르지 않는다 — `--folder` 를 입는 SVG 로 그린다 -->
  <span class="folder" style:color={color || undefined}
    ><UiIcon name="folder" {size} {label} filled /></span
  >
{/if}

<style>
  /* `display: block` — 줄 안에서 baseline 아래 여백이 생기면 그 줄만 높아진다 (`Glyph` 와 같은 이유) */
  .logo,
  .emoji {
    display: block;
    flex: 0 0 auto;
  }

  /* 원본 `stroke-width="2"` 는 presentation attribute 라 이 CSS 선언에 진다 */
  .logo.line :global(*) {
    stroke-width: 1.75;
  }

  .emoji {
    font-family: var(--font-ui);
    line-height: 1;
  }

  .waiting {
    display: block;
    flex: 0 0 auto;
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
  }

  .server {
    display: block;
    color: var(--folder);
  }

  .folder {
    display: block;
    color: var(--folder);
  }
</style>
