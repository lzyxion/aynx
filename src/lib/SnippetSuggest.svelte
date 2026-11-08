<script lang="ts">
  import type { SnippetSuggestion } from "$lib/snippets";

  /**
   * **입력 중 스니펫 제안** — 프롬프트에 치고 있는 글자에 맞는 스니펫을 커서 옆에 띄운다
   * (docs/log/2026-09-16-snippets.md 의 "입력 중 제안").
   *
   * 이 컴포넌트가 아는 것은 **줄 목록과 좌표**뿐이다. 무엇이 걸렸는지(`suggestSnippets`),
   * 어디가 커서인지(xterm 셀 기하), 고르면 무엇이 나가는지(`DEL × n` + 명령)는 전부
   * `Terminal.svelte` 가 정한다 — 그 셋은 하나같이 **그 타일의 사정**이고, 여기서 알면
   * 같은 상자를 다른 자리에 띄울 수 없게 된다.
   *
   * ## 자리
   *
   * 타일 상자(`.term`, `position: relative`) 안의 `position: absolute` 다. 창 단위
   * `fixed` 로 올리지 않는 이유는 타일마다 자기 커서가 있기 때문이고(두 타일이 동시에
   * 프롬프트일 수 있다), 그 상자 안에 있어야 타일이 스크롤·리사이즈될 때 함께 사라진다.
   * 넘침 처리(좌우 클램프 · 위로 뒤집기)는 좌표를 만드는 쪽이 이미 끝냈다.
   *
   * ## 몸짓
   *
   * **키보드가 진짜 길이다** — `↓` 로 고르고 `Tab`/`Enter` 로 넣는다. 마우스는 곁길이라
   * 줄은 누를 수 있게 두되(`button`), 호버가 선택을 옮기지는 **않는다**: 여기서 사람의 손은
   * 키보드 위에 있고, 지나가던 포인터가 선택을 바꾸면 방금 `↓` 로 고른 줄이 소리 없이
   * 달라진다 (팔레트·검색 목록과 갈리는 유일한 자리다 — 그쪽은 손이 마우스에 있다).
   *
   * 줄의 모양은 팔레트와 같다 (`.row` + `.sel`) — 헤드리스 검증도 같은 손잡이로 찾는다.
   */
  let {
    items,
    sel,
    left,
    top,
    onpick,
  }: {
    /** 그릴 줄들 (빈 배열이면 상위가 아예 마운트하지 않는다) */
    items: readonly SnippetSuggestion[];
    /** 하이라이트된 줄 (`-1` = 아직 아무것도 안 골랐다 — 그때 Enter·Tab 은 셸로 간다) */
    sel: number;
    /** 타일 상자 기준 좌표(px) — 넘침 보정은 이미 끝나 있다 */
    left: number;
    top: number;
    /** 줄을 눌렀다 (마우스) */
    onpick: (id: string) => void;
  } = $props();
</script>

<div class="suggest menu-surface" data-snippet-suggest style:left="{left}px" style:top="{top}px">
  {#each items as item, i (item.id)}
    <button
      type="button"
      data-row
      class="row"
      class:sel={i === sel}
      onmousedown={(ev) => {
        // 포커스가 xterm 에서 떠나면 이 상자가 곧바로 접힌다(`active` 가 내려간다) —
        // 누르기도 전에 대상이 사라지는 셈이라, 마우스 다운의 기본 동작을 막아 포커스를
        // 터미널에 붙들어 둔다 (클릭은 그대로 `onclick` 으로 온다).
        ev.preventDefault();
      }}
      onclick={() => onpick(item.id)}
    >
      <span class="name">{item.name}</span>
      <span class="cmd">{item.preview}</span>
    </button>
  {/each}
</div>

<style>
  /*
   * 상자는 tmux 팝오버·`PaneMenu` 와 **같은 판**이다 — 앱 안의 "고르는 목록" 이 서로
   * 다르게 생기면 그것이 같은 종류라는 사실이 화면에서 사라진다. 폭만 좁다(커서 옆이다).
   * 판 · 선 · 모서리 · 그림자는 전역 `.menu-surface`(10-29 — 예전 `--bg-panel` 은 슬라이더를 타 밑의 터미널 글자가
   * 비쳤다): 평면은 불투명 `--surface-raised-solid`, 글래스는 `--glass-float` + 흐림 · 흰 선(theme.css 재질 절).
   * 여기 남는 것은 자리 · 폭 · 안쪽 여백뿐이다(줄은 알약 — `--radius-row`).
   */
  .suggest {
    position: absolute;
    z-index: 5;
    min-width: 220px;
    max-width: 360px;
    padding: 3px;
  }

  .row {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    padding: 3px var(--space-3);
    font: inherit;
    font-size: 12px;
    color: var(--fg);
    text-align: left;
    background: none;
    border: 0;
    border-radius: var(--radius-row); /* 한 줄짜리 줄의 칠은 알약(2026-10-29 — 그 전엔 바깥 16 − 여백 3 − 테두리 1 = 12) */
    cursor: pointer;
  }

  .row.sel {
    background: var(--bg-hover);
  }

  .name {
    flex: 0 1 auto;
    overflow: hidden;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* 명령은 곁글이다 — 이름을 밀어내지 않게 줄의 남는 자리만 차지한다 */
  .cmd {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--fg-muted);
    text-align: right;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>
