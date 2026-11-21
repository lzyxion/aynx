<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";

  /**
   * 켬/끔 스위치 — 대상에 저장되어 계속 남는 켬/끔이면 이것이고, 한 번의 동작에 딸린 선택 · 여럿 고르기 · 확인은 체크박스다
   * (`docs/conventions.md` "토글 · 체크박스 · 라디오"). 안은 진짜 `<input type="checkbox" role="switch">` 다 — Space · Tab ·
   * `<label for>` · 스크린 리더 · 폼 리셋을 네이티브에 맡긴다.
   */
  let {
    checked = $bindable(false),
    id = undefined,
    disabled = false,
    label = undefined,
    title = undefined,
    onchange = undefined,
    ...data
  }: {
    checked?: boolean;
    id?: string;
    disabled?: boolean;
    /** 곁에 보이는 라벨이 없을 때의 `aria-label` */
    label?: string;
    title?: string;
    onchange?: (checked: boolean) => void;
    /** 하네스 · 시험의 손잡이(`data-*`) — 안쪽 진짜 체크박스에 단다(`.checked` · `.click()` 이 체크박스 때와 같게) */
    [key: `data-${string}`]: string | boolean | undefined;
  } = $props();
</script>

<span class="toggle" class:on={checked} class:off={!checked}>
  <input
    {...data}
    {id}
    {disabled}
    {title}
    type="checkbox"
    role="switch"
    aria-label={label}
    {checked}
    onchange={(e) => {
      // `bind:` 로 묶였으면 이 대입이 상위까지 올라가고, 아니면 이 컴포넌트 안에서만 남았다가
      // 상위가 스토어를 고쳐 다시 내려보내는 값으로 덮인다 — 어느 쪽이든 화면과 값이 맞는다.
      checked = e.currentTarget.checked;
      onchange?.(checked);
    }}
  />
  <span class="track" aria-hidden="true">
    <span class="knob"><UiIcon name="check" size={12} /></span>
  </span>
</span>

<style>
  /* MD3 switch 40×24. 감싸는 쪽이 `--toggle-{on,off}-{bg,knob}` · `--toggle-off-bg-hover` · `--toggle-off-border` 로 바꿀 수 있다 */
  .toggle {
    position: relative;
    flex: 0 0 auto;
    display: inline-block;
    width: 40px;
    height: 24px;
    vertical-align: middle;
  }

  /* 진짜 체크박스가 트랙 전체를 덮는다 — `display:none` · `visibility:hidden` 이면 포커스 · Space 를 못 받는다 */
  .toggle input {
    position: absolute;
    inset: 0;
    z-index: 1;
    width: 100%;
    height: 100%;
    margin: 0;
    opacity: 0;
    cursor: pointer;
  }

  .toggle input:disabled {
    cursor: default;
  }

  .track {
    position: absolute;
    inset: 0;
    box-sizing: border-box;
    background: var(--toggle-off-bg, var(--control-bg));
    border: 2px solid var(--toggle-off-border, var(--control-outline));
    border-radius: 999px;
    transition:
      background 120ms ease,
      border-color 120ms ease;
  }

  .knob {
    position: absolute;
    top: 50%;
    left: 4px;
    width: 12px;
    height: 12px;
    margin-top: -6px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: transparent;
    background: var(--toggle-off-knob, var(--control-outline));
    border-radius: 50%;
    transition:
      left 120ms ease,
      width 120ms ease,
      height 120ms ease,
      margin 120ms ease,
      background 120ms ease;
  }

  .toggle.on .track {
    background: var(--toggle-on-bg, var(--control-on-bg));
    border-color: var(--toggle-on-bg, var(--control-on-bg));
    box-shadow: var(--glass-on-edge, none);
  }

  .toggle.on .knob {
    left: 16px;
    width: 18px;
    height: 18px;
    margin-top: -9px;
    color: var(--toggle-on-check, var(--m3-on-primary-container));
    background: var(--toggle-on-knob, var(--control-on-fg));
  }

  .toggle.off input:hover:not(:disabled) + .track {
    background: var(--toggle-off-bg-hover, var(--control-bg-hover));
  }

  /* 포커스 링은 중성 — 강조색이면 꺼진 스위치에 포커스만 와도 "켜졌다" 로 읽힌다 */
  .toggle input:focus-visible + .track {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .toggle input:disabled + .track {
    opacity: 0.45;
  }

  @media (prefers-reduced-motion: reduce) {
    .track,
    .knob {
      transition: none;
    }
  }
</style>
