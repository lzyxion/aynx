<script lang="ts">
  /**
   * 코드 블록 — [복사] · [터미널에 넣기](`MarkdownBlocks` 가 `codeActions` 를 받았을 때만).
   * [터미널에 넣기]는 셸 입력 줄에 넣기만 한다 — Enter 는 사람(`app/code-to-term`). 언어를 아는 곳이 여기라 `codeForTerm` 은 여기서 한 번만.
   */
  import CodeView from "$lib/CodeView.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { writeClipboard } from "$lib/clipboard";
  import { codeForTerm, isShellLang } from "$lib/code-to-term";
  import { toast } from "$lib/toast.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";

  let {
    code,
    lang,
    onterm,
  }: {
    code: string;
    lang: string | null;
    /** `button` 아래에 고르기 상자가 서고 Esc 면 포커스가 돌아온다 */
    onterm: (code: string, button: HTMLElement) => void;
  } = $props();

  /** `CodeView` 의 `shown` 과 같은 셈 — 복사는 보이는 그대로 */
  const shown = $derived(code.endsWith("\n") ? code.slice(0, -1) : code);
  const label = $derived((lang ?? "").trim().split(/\s+/)[0] ?? "");
  const shell = $derived(isShellLang(lang));

  let copied = $state<"ok" | "fail" | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => () => clearTimeout(copyTimer));
  const copyLabel = $derived(
    copied === "ok"
      ? t("files.doc.md.code.copied")
      : copied === "fail"
        ? t("files.doc.md.code.copyfail")
        : t("files.doc.md.code.copy"),
  );

  async function onCopy(ev: MouseEvent): Promise<void> {
    ev.stopPropagation(); // 문서 링크 손잡이(`MarkdownBlocks` 의 클릭)로 새지 않게
    const ok = await writeClipboard(shown);
    copied = ok ? "ok" : "fail";
    if (!ok) toast.error(t("files.doc.md.code.copyfail"));
    clearTimeout(copyTimer);
    copyTimer = setTimeout(() => (copied = null), 1500);
  }

  function onTerm(ev: MouseEvent): void {
    ev.stopPropagation();
    if (ev.currentTarget instanceof HTMLElement) onterm(codeForTerm(code, lang), ev.currentTarget);
  }
</script>

{#snippet acts(float: boolean)}
  <span class="acts" class:float class:held={copied !== null} data-find-skip={float ? "" : undefined}>
    <button
      type="button"
      class="btn btn-sm btn-ghost act copy"
      class:ok={copied === "ok"}
      title={copyLabel}
      aria-label={copyLabel}
      data-code-copy
      onclick={(ev) => void onCopy(ev)}
    >
      <UiIcon name={copied === "ok" ? "check" : "copy"} size={13} /><span class="txt">{copyLabel}</span>
    </button>
    {#if shell}
      <button
        type="button"
        class="btn btn-sm btn-primary act"
        title={t("files.doc.codeterm.button.title")}
        aria-label={t("files.doc.codeterm.button")}
        data-code-term
        onclick={onTerm}
      >
        <UiIcon name="terminal" size={13} /><span class="txt">{t("files.doc.codeterm.button")}</span>
      </button>
    {/if}
  </span>
{/snippet}

<!-- 뿌리 요소는 늘 `.dcb` 하나 — `DocView` 의 `renderedBlockAt` 이 `.md` 자식 수 == 최상위 블록 수에 기댄다 -->
<div class="dcb" data-code-block>
  {#if label}
    <div class="head" data-find-skip>
      <span class="lang">{label}</span>
      {@render acts(false)}
    </div>
  {/if}
  <CodeView code={code} {lang} />
  {#if !label}{@render acts(true)}{/if}
</div>

<style>
  .dcb {
    position: relative;
    min-width: 0;
    container-type: inline-size;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
    min-height: 28px;
    padding: 2px var(--space-1) 2px var(--space-3);
    border-bottom: 1px solid var(--line);
    user-select: none;
  }

  .lang {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .acts {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: var(--space-1);
    opacity: 0;
    transition: opacity 120ms ease;
  }

  .dcb:hover .acts,
  .dcb:focus-within .acts,
  .acts.held {
    opacity: 1;
  }

  @media (hover: none) {
    .acts {
      opacity: 1;
    }
  }

  /* 가로 스크롤 상자 `.cv` 가 아니라 판(`.dcb`)에 붙어 밀어도 제자리 */
  .acts.float {
    position: absolute;
    top: 4px;
    right: 4px;
    user-select: none;
  }

  .act {
    height: 22px;
  }

  .copy {
    border-color: var(--line);
  }

  .copy:hover:not(:disabled) {
    border-color: var(--line-strong);
  }

  /* 떠 있을 때는 밑의 글을 덮으니 불투명 */
  .float .copy,
  .float .copy:hover:not(:disabled) {
    background: var(--surface-field-solid);
  }

  .copy.ok,
  .copy.ok:hover:not(:disabled) {
    color: var(--ok);
  }

  @container (max-width: 360px) {
    .txt {
      display: none;
    }

    .act {
      width: 26px;
      padding: 0;
    }
  }
</style>
