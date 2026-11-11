<script lang="ts">
  /**
   * **문서 타일의 코드 블록 — 머리 띠 + [복사] · [터미널에 넣기]** (`MarkdownBlocks` 의 `codeActions` 를 받았을 때만 — 문서 타일의 읽기
   * 보기 · 편집 중 미리 보기). 다른 사용처(기록 보기 · 사이드 채팅 · 블록 리치 보기)는 예전처럼 `CodeView` 의 판 + 떠 있는 복사 단추다.
   *
   * - 판 하나(`CodeView` framed 와 같은 우물 면 · 테두리 · 반지름) 위쪽에 가는 머리 띠 — 왼쪽은 펜스 언어 이름, 오른쪽은 알약 단추 둘.
   *   **펜스에 언어가 없으면 띠를 그리지 않고** 같은 단추 둘을 판 오른쪽 위에 띄운다(`CodeView` 의 떠 있는 복사 단추와 같은 자리 —
   *   가로 스크롤 상자 `.cv` 바깥의 판 안이라 밀어도 제자리 · 호버 때만 보여 첫 줄 글을 늘 가리지는 않는다).
   *   [복사]는 테두리만 있는 중성, [터미널에 넣기]는 강조색 채움(`btn-primary`). 단추는 블록에 포인터가 얹히거나 포커스가 안에 있을 때만
   *   보이고, 호버가 없는 터치 기기(`(hover: none)`)에서는 늘 보인다(`ChatHistory` 와 같은 규칙).
   * - [터미널에 넣기]는 **셸 계열 언어일 때만**(`isShellLang` — 언어 없음 포함). 누르면 받는 쪽(`onterm` — 문서 타일 →
   *   `app/code-to-term`)이 셸 타일의 입력 줄에 **넣기만** 한다(Enter 는 사람). 언어를 아는 곳이 여기라 넘기기 전에 한 번
   *   `codeForTerm` 으로 주석 줄 · 빈 줄을 뺀다(줄 안 주석 · 남은 줄의 글자는 그대로 · 끝 줄바꿈 떼기 · 정화는 받는 쪽). [복사]는 원문 그대로다.
   * - 블록 하나 = **뿌리 요소 하나**(`.dcb`) — 문서 타일의 줄 이동(`DocView` 의 `renderedBlockAt`)이 `.md` 자식 수 == 최상위 블록 수에 기댄다.
   * - 머리 띠 · 떠 있는 단추는 문서 안 찾기가 훑지 않고(`data-find-skip` — 언어 이름이 매치로 세이지 않게) 글 고르기에도 딸려 오지 않는다(`user-select: none`).
   * - 좁은 블록(컨테이너 폭 360px 아래)에서는 단추 글자를 접고 아이콘만 — 이름 · 툴팁은 그대로다.
   * - 복사 피드백은 `CodeView` 의 떠 있는 단추와 같은 결 — 1.5초 체크 아이콘 · 이름, 실패는 토스트.
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
    /** 블록 글 */
    code: string;
    /** 펜스 언어 (없으면 `null`) */
    lang: string | null;
    /** [터미널에 넣기] — 넣을 글(`codeForTerm` 을 거친 블록 글)과 누른 단추(고르기 상자가 그 아래에 선다 · Esc 면 포커스가 돌아온다) */
    onterm: (code: string, button: HTMLElement) => void;
  } = $props();

  /** 끝의 줄바꿈 하나는 화면에 없는 글이다(`CodeView` 의 `shown` 과 같은 셈) — 복사는 보이는 그대로 */
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

<!-- 뿌리 요소는 늘 `.dcb` 하나 — 띠가 있든 없든(줄 이동이 블록 수를 센다) -->
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
  /* 판 — `CodeView` framed 와 같은 우물 면 · 테두리 · 반지름. 너비를 재는 컨테이너라 좁으면 단추 글자를 접는다 */
  .dcb {
    position: relative;
    min-width: 0;
    container-type: inline-size;
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  /* 가는 머리 띠 — 언어 이름 · 단추 둘. 아래 선 하나로 글과 나뉜다 */
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

  /* 터치 기기 — 호버가 없으니 늘 보인다 */
  @media (hover: none) {
    .acts {
      opacity: 1;
    }
  }

  /* 언어 없는 블록 — 띠 대신 판 오른쪽 위에 뜬다(`CodeView` 의 `.copy` 와 같은 자리). 판(`.dcb`)에 붙어 가로로 밀어도 제자리 */
  .acts.float {
    position: absolute;
    top: 4px;
    right: 4px;
    user-select: none;
  }

  .act {
    height: 22px;
  }

  /* [복사] — 테두리만 있는 중성 알약 */
  .copy {
    border-color: var(--line);
  }

  .copy:hover:not(:disabled) {
    border-color: var(--line-strong);
  }

  /* 떠 있을 때는 밑의 글을 덮는 불투명 면 — `CodeView` 의 떠 있는 복사 단추와 같은 면 */
  .float .copy,
  .float .copy:hover:not(:disabled) {
    background: var(--surface-field-solid);
  }

  .copy.ok,
  .copy.ok:hover:not(:disabled) {
    color: var(--ok);
  }

  /* 좁은 블록 — 글자를 접고 아이콘만(이름 · 툴팁은 그대로) */
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
