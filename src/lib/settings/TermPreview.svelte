<script lang="ts">
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { ITheme } from "@xterm/xterm";

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
    margin-bottom: 16px;
    /* 상자 크기는 고정 — 글꼴을 키우면 넘치는 줄은 잘린다 */
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
  /* `.bar` 로 두지 않는다 — 브라우저 툴바의 전역 `.bar` 가 묻어 세로선 커서가 L 자로 커진다 */
  .cursor.beam {
    width: 0;
    border-left: 2px solid;
  }
  .cursor.underline {
    border-bottom: 2px solid;
  }
</style>
