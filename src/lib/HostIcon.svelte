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
   * **호스트·그룹의 `icon` 한 칸을 그린다** (docs/log/2026-09-04-icons-and-rows.md).
   *
   * 값이 세 갈래일 수 있어서 이 컴포넌트가 있다:
   *
   * - `"svg:ubuntu"` — 내장 **컬러 로고**. 원본 색 그대로 인라인 SVG 로 그린다.
   * - `"svg:logos:mongodb-icon"` — **logos 전체**의 로고 (docs/log/2026-09-29-logos-full-icons.md).
   *   표가 늦게 오므로 아직이면 받아 오고(`ensureLogos`), 오는 동안은 **같은 크기의 빈 자리**를
   *   그린다. 표가 왔는데 그 이름이 없거나 받기가 실패하면 아래 이모지 갈래로 글자 그대로 떨어진다.
   * - `"svg:lucide:database"` — **lucide 전체**의 단색 선 아이콘(고르개의 "기본"). 받는 길은 logos 와
   *   같고, 로고와 달리 **색이 없다**: 획이 `currentColor` 라 [`color`](호스트 색)를 입고, 없으면 그
   *   자리의 글자색을 따른다. 굵기는 1.75.
   * - `"🐧"` (그 밖의 무엇이든) — 예전 그대로 **이모지 글자**.
   * - 빈 값 — `fallback` 이 `"server"` 면 테마 색(`--folder`, 호스트 색이 있으면 그 색) 서버 랙, `"folder"` 면 테마 색 폴더
   *   (`folder` 의 꽉 찬 그림 — 파일 목록의 디렉터리 줄과 같은 그림), `"none"` 이면 아무것도
   *   안 그린다. 사람이 골라 둔 값(이모지·`svg:`)이 있으면 위 두 갈래가 먼저라 폴백은 서지 않는다.
   *
   * 갈림을 이 한 자리에 가둔 이유는 아이콘을 그리는 곳이 여섯 군데(세션 타일의 줄·격자,
   * 시작 화면의 최근 세션, 팔레트, 호스트 폼의 미리보기, 고르개)이기 때문이다 — 각자
   * `startsWith("svg:")` 를 적으면 한 곳만 고치는 사고가 난다.
   *
   * 모르는 이름(`"svg:없는것"`)은 **글자 그대로** 떨어진다 (`iconNameOf` 가 `null`) —
   * 아무것도 안 그려 "지운 것처럼" 보이는 것보다, 이상한 값이 보이는 편이 고치기 쉽다.
   *
   * ## 정사각 칸에 맞추기
   *
   * 로고마다 viewBox 가 다르다 (logos 는 256, devicon 은 128, 세로로 긴 것도 있다). SVG 의
   * 기본 `preserveAspectRatio="xMidYMid meet"` 가 곧 `object-fit: contain` 이라, `width`·
   * `height` 를 같은 값으로 주면 **비율을 지킨 채 칸 가운데**에 들어간다 — 리눅스 펭귄처럼
   * 세로로 긴 로고가 옆으로 눌리지 않는다.
   */
  let {
    icon,
    size = 14,
    label = "",
    fallback = "none",
    color = null,
    mono = false,
  }: {
    /** 저장된 값 그대로 (`HostMeta.icon` · `GroupMeta.icon`) */
    icon: string | null | undefined;
    size?: number;
    /** 스크린 리더용 이름 — 비어 있으면 장식으로 본다 (`Glyph` 와 같은 규칙) */
    label?: string;
    /**
     * 아이콘이 없을 때 무엇을 그릴까 — 격자 보기는 빈칸이 뚫려 보여 `"server"` 를 쓰고,
     * 그룹(폴더)을 그리는 자리는 `"folder"` 로 앱의 기본 폴더를 받는다.
     */
    fallback?: "none" | "server" | "folder";
    /**
     * **lucide(단색) 아이콘과 기본 그림(폴더·서버)에만** 입히는 색 — 호스트 폼의 "색"(병합된 `HostMeta.color`) ·
     * 폴더 색(`GroupMeta.color`) · 프로젝트 색. 비면 그 자리의 글자색(기본 폴더·기본 서버는 `--folder`). 컬러 로고·
     * 이모지에는 쓰지 않는다 (로고는 원본 색이 요점이다 — docs/log/2026-09-29-folder-project-icons.md).
     */
    color?: string | null;
    /**
     * 컬러 로고를 **한 가지 색**(`currentColor` — 부모 글자색)의 실루엣으로 그린다(`monoBody` — 흰 칠 등은 구멍,
     * 구멍 색은 부모가 `--mono-cut` 으로 자기 판 색을 준다). 강조색 판 위의 독 실행 단추가 쓴다. 기본은 원본 색
     */
    mono?: boolean;
  } = $props();

  const name = $derived(iconNameOf(icon));
  /** logos 전체를 가리키는 이름 (큐레이션이 아니고 `svg:logos:` 로 시작할 때만) */
  const logosName = $derived(name ? null : logosNameOf(icon));
  /** lucide 전체를 가리키는 이름 (`svg:lucide:` 로 시작할 때만) */
  const lucideName = $derived(name ? null : lucideNameOf(icon));

  // 통째 표의 이름인데 표가 아직이면 받아 온다 — 한 번 받으면 모든 인스턴스가 함께 쓴다.
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
  /** 단색 선 아이콘인가 — 색·굵기를 앱이 입힌다 */
  const line = $derived(lucideName !== null && logo !== null);
  /** 표를 기다리는 중 — 글자로 떨어뜨리지 않고 빈 자리를 지킨다 (실패하면 글자로 떨어진다) */
  const waiting = $derived(
    (logosName !== null && logosSet() === null && logosStatus() !== "error") ||
      (lucideName !== null && lucideSet() === null && lucideStatus() !== "error"),
  );
  /** 이모지로 그릴 값 — 접두사가 아닌 아무 글자 (빈 값이면 `null`) */
  const emoji = $derived(logo || waiting ? null : (icon?.trim() || null));

  /**
   * 이 인스턴스만의 꼬리표 — 그라디언트 id 충돌을 막는다 ([`uniquifyIds`] 주석). Svelte 가
   * 주는 값이라 서버 렌더와 하이드레이션에서 같은 값이 나온다 (전역 카운터를 쓰면 어긋난다).
   */
  const uid = $props.id();
  /** 단색으로 칠하나 — 선 아이콘은 이미 단색이라 그대로 */
  const monoFill = $derived(mono && !line);
  const body = $derived(logo ? uniquifyIds(monoFill ? monoBody(logo.body, name) : logo.body, uid) : "");
</script>

{#if logo}
  <!--
    `{@html}` 로 붙이는 것은 **빌드 시점에 이 저장소가 생성한 마크업**이다
    (`host-icons.generated.ts` · `host-icons-logos.generated.json` — 사용자 입력도, 네트워크에서
    온 것도 아니다. 뒤의 것도 앱 자신의 출처에서 받는 번들 파일이다). 사용자가 고르는 것은 그
    목록의 **이름**뿐이고, 모르는 이름은 위에서 이미 걸러졌다.
  -->
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
  <!-- logos 전체 표를 받는 중 — 같은 크기의 옅은 자리만 (줄이 흔들리지 않게) -->
  <span class="waiting" style:width="{size}px" style:height="{size}px" aria-hidden="true"></span>
{:else if emoji}
  <!-- 이모지 — 시스템 UI 글꼴(윈도우면 Segoe UI Emoji)로 렌더된다 -->
  <span class="emoji" style:font-size="{size}px" aria-hidden={label ? undefined : "true"}>
    {emoji}
  </span>
{:else if fallback === "server"}
  <!--
    아이콘을 안 고른 호스트 — 폴더와 **같은 테마 색**(`--folder`)의 서버 랙 (2026-09-29,
    docs/log/2026-09-29-folder-project-icons.md). 색을 골라 둔 호스트면 그 색을 입는다(폴더 기본 그림과 같은 규칙).
    저장값에는 아무것도 적지 않는다 — 렌더할 때의 그림일 뿐이다.
  -->
  <span class="server" style:color={color || undefined}><Glyph d={SERVER_D} rule={SERVER_RULE} {size} {label} /></span>
{:else if fallback === "folder"}
  <!--
    아이콘을 안 고른 폴더 — 이모지 📁 는 글꼴이 칠하는 노랑 고정이라 앱 테마를 바꿔도 그
    한 칸만 다른 앱에서 온 것처럼 보였다. 그래서 `--folder` 를 입는 SVG 로 그린다 — **꽉 찬
    그림**(`UiIcon` 의 `filled`)이라 윤곽 아이콘 사이에서도 폴더가 한눈에 갈린다
    (docs/log/2026-09-25-duotone-glyphs.md).
  -->
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

  /*
   * lucide(단색 선) — 획은 `currentColor`(= 위 인라인 `color`, 없으면 물려받은 글자색). 굵기는
   * 1.75 로 덮는다: 원본 `stroke-width="2"` 는 presentation attribute 라 CSS 선언에 진다.
   */
  .logo.line :global(*) {
    stroke-width: 1.75;
  }

  .emoji {
    font-family: var(--font-ui);
    line-height: 1;
  }

  /* logos 전체 표를 받는 동안의 자리 — 중성 옅은 칸 */
  .waiting {
    display: block;
    flex: 0 0 auto;
    border-radius: var(--radius-sm);
    background: var(--surface-hover);
  }

  /* 아이콘을 안 고른 호스트 — 기본 폴더와 같은 테마 색(`--folder`). 호스트 색이 있으면 인라인 `color` 가 이긴다 */
  .server {
    display: block;
    color: var(--folder);
  }

  /* 아이콘을 안 고른 폴더 — 테마 색(파일 브라우저의 디렉터리 줄과 같은 `--folder`) */
  .folder {
    display: block;
    color: var(--folder);
  }
</style>
