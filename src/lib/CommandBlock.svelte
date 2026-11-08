<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";
  import { writeClipboard } from "$lib/clipboard";

  /**
   * **사용자가 그 자리에서 칠 명령 몇 줄 + 오른쪽 위 복사 아이콘** (docs/log/2026-09-28-project-create.md).
   *
   * 폼 폭에 꽉 차는 코드 블록이다 — 내용 폭만큼 줄어드는 칩이 아니다. 줄은 `white-space: pre`
   * 로 두고 넘치면 **블록 안에서** 가로로 민다(줄바꿈으로 명령이 깨지면 복사해도 손으로 쳐도
   * 틀린다). 글자는 선택 가능하다 — 복사 단추가 있어도 한 줄만 고르는 사람이 있다.
   *
   * 바탕은 문서 보기의 코드 블록(`MarkdownBlocks.svelte` `.pre`)과 같은 크롬 우물 `--surface-field` + `--line`.
   * (글자가 크롬 색이라 바탕도 크롬에서 — 터미널 바탕이면 "라이트 크롬 + 어두운 터미널" 에서 안 보였다.)
   * 복사 피드백은 **단추 자리의 체크 아이콘**(1.5초)이다 — 눌린 바로 그 자리에서 보이므로
   * 성공 토스트를 또 띄우지 않는다. 실패 알림은 `copy` 를 준 호출부의 몫이다.
   */
  let {
    lines,
    label,
    copy = () => writeClipboard(lines.join("\n")),
  }: {
    /** 보일(그리고 복사할) 줄들 */
    lines: readonly string[];
    /** 복사 단추의 툴팁 · aria-label */
    label: string;
    /** 복사 — 성공하면 `true`. 기본은 줄들을 줄바꿈으로 이어 클립보드에 */
    copy?: () => Promise<boolean>;
  } = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | undefined;

  async function onCopy(): Promise<void> {
    if (!(await copy())) return;
    copied = true;
    clearTimeout(timer);
    timer = setTimeout(() => (copied = false), 1500);
  }

  $effect(() => () => clearTimeout(timer));
</script>

<div class="command-block">
  <pre class="lines">{lines.join("\n")}</pre>
  <button
    type="button"
    class="copy btn btn-ghost btn-sm"
    class:copied
    title={label}
    aria-label={label}
    data-command-copy
    onclick={() => void onCopy()}
  >
    <UiIcon name={copied ? "check" : "copy"} size={13} />
  </button>
</div>

<style>
  .command-block {
    position: relative;
    width: 100%;
    box-sizing: border-box;
  }

  .lines {
    margin: 0;
    width: 100%;
    box-sizing: border-box;
    overflow-x: auto;
    /* 오른쪽은 복사 단추 자리만큼 비운다 — 긴 줄이 단추 밑으로 들어가지 않게 */
    padding: var(--space-3) calc(var(--space-3) + 28px) var(--space-3) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    line-height: 1.7;
    white-space: pre;
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
    user-select: text;
    cursor: text;
  }

  .copy {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 24px;
    padding: 0;
  }

  .copy.copied {
    color: var(--ok);
  }
</style>
