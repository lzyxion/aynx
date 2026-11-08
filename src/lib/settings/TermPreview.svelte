<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { ITheme } from "@xterm/xterm";

  /**
   * **터미널 미리보기** — 지금 고른 팔레트·글꼴·커서 모양을 그대로 입힌 작은 가짜 터미널.
   *
   * 진짜 xterm 을 띄우지 않고 팔레트를 *눈으로* 확인하기 위한 장식이다: 색은 전부 `theme`
   * 에서 인라인으로 꺼내 쓰고(토큰이 아니라 터미널 팔레트라서), 아래 컨트롤을 만지면 props 가
   * 반응적으로 다시 흘러 들어와 즉시 바뀐다. 순수 장식이라 `aria-hidden`·비선택이다.
   */
  let {
    theme,
    fontFamily,
    fontSize,
    cursorStyle,
  }: {
    theme: ITheme;
    fontFamily: string;
    fontSize: number;
    cursorStyle: string;
  } = $props();

  // 글꼴은 설정값 그대로 쓴다(8~32px) — 미리보기 안에서 글자가 실제로 커졌다 작아진다.
  // **상자 크기는 고정**이라(아래 CSS 의 `height`), 글자가 커지면 넘치는 줄은 잘려 보인다.
</script>

<div
  class="preview"
  aria-hidden="true"
  style:background={theme.background}
  style:color={theme.foreground}
  style:font-family={fontFamily}
  style:font-size="{fontSize}px"
>
  <div class="line">
    <span style:color={theme.green}>user@aynx</span>
    <span style:color={theme.blue}>~/project</span>
    <span style:color={theme.magenta}>(main)</span>
    <span style:color={theme.foreground}>$</span> ls
  </div>
  <div class="line">
    <span style:color={theme.blue}>src</span>{"  "}<span style:color={theme.green}
      >build.sh</span
    >{"  "}README.md{"  "}<span style:color={theme.brightBlack}>.gitignore</span>
  </div>
  <div class="line">
    <span style:color={theme.foreground}>$</span> git status
  </div>
  <div class="line">
    <span style:color={theme.yellow}>{t("settings.terminal.preview.modified")}</span> src/app.ts{"   "}<span
      style:color={theme.red}>{t("settings.terminal.preview.deleted")}</span
    > old.ts
  </div>
  <div class="line">
    <span style:color={theme.green}>{t("settings.terminal.preview.passed")}</span>{"   "}<span style:color={theme.red}
      >{t("settings.terminal.preview.failed")}</span
    >{"   "}<span style:color={theme.cyan}>{t("settings.terminal.preview.info")}</span>
  </div>
  <div class="line">
    <span style:color={theme.green}>user@aynx</span>
    <span style:color={theme.blue}>~/project</span>
    <span style:color={theme.foreground}>$</span>{" "}<!--
    커서 — 마지막 프롬프트 바로 뒤. 모양만 다르고 색은 theme.cursor 하나로 칠한다. 미리보기라
    깜빡이지 않고 가만히 서 있다. -->{#if cursorStyle === "underline"}<span
        class="cursor underline"
        style:border-bottom-color={theme.cursor}
      ></span>{:else if cursorStyle === "bar"}<span
        class="cursor beam"
        style:border-left-color={theme.cursor}
      ></span>{:else}<span class="cursor block" style:background={theme.cursor}></span
      >{/if}
  </div>
</div>

<style>
  .preview {
    /* 아래 옵션 줄과 붙지 않게 여백을 둔다 (미리보기는 리드 문단과 컨트롤 사이에 뜬다) */
    margin-bottom: 16px;
    /* **상자 크기는 고정** — 글꼴을 키워도 상자가 커지지 않고, 넘치는 줄은 잘린다
       (`overflow: hidden`). 패딩·높이는 px 라 글꼴에 안 딸려 온다. box-sizing 으로 높이에
       테두리·패딩을 포함시킨다. */
    box-sizing: border-box;
    height: 148px;
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    line-height: 1.35;
    overflow: hidden;
    user-select: none;
  }
  .line {
    white-space: pre;
  }
  .cursor {
    display: inline-block;
    width: 0.6em;
    height: 1.1em;
    vertical-align: text-bottom;
  }
  /* `.bar` 가 아니라 `.beam` — 브라우저 툴바의 전역 `.bar`(flex · 패딩 · 아래 선)가 묻어 세로선 커서가 L 자로 커지고 줄이 벌어졌다(10-17). */
  .cursor.beam {
    width: 0;
    border-left: 2px solid;
  }
  .cursor.underline {
    border-bottom: 2px solid;
  }
</style>
