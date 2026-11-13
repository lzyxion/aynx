<script lang="ts">
  import UiIcon from "$lib/UiIcon.svelte";

  /**
   * 켬/끔 스위치 — 앱 안의 **모든 boolean 설정**이 쓰는 한 벌.
   *
   * ## 왜 체크박스가 아니라 스위치인가
   *
   * **고르는 기준(2026-11-13 사용자 결정 — `docs/conventions.md` "토글 · 체크박스 · 라디오")**: 대상(연결 · 호스트 · 앨범 · 설정)에
   * **저장되어 계속 남는 켬/끔**이면 이 스위치다 — 설정 화면이든 [저장] 이 있는 폼이든 같다. **이번 한 번의 동작에 딸린 선택**
   * (워크트리를 지우면서 브랜치도), 목록에서 여럿 고르기, "이해했습니다" 확인, 문서 할 일은 체크박스, 여럿 중 하나는 라디오다.
   * 체크박스 · 라디오도 OS 위젯이 아니라 앱이 그린다(`theme.css` 의 "앱 체크박스" 절 — 이 스위치와 같은 면 · 같은 강조색).
   *
   * ## 안을 들여다보면 여전히 체크박스다
   *
   * 그리는 것만 우리가 하고 **동작·접근성은 네이티브에 맡긴다**: 안에 진짜
   * `<input type="checkbox" role="switch">` 가 트랙 전체를 덮고 있고 `opacity:0` 로 보이지만
   * 않을 뿐이다. 그래서 공짜로 따라오는 것이 많다 — Space 로 토글, Tab 순서, `<label for>` 로
   * 라벨 클릭, 스크린 리더의 "스위치, 켬"(role=switch 가 `aria-checked` 를 알아서 낸다),
   * 폼 리셋. 직접 만든 `div` + keydown 으로는 이걸 다 되살려야 하고 대개 하나씩 빠진다.
   *
   * ## 쓰는 법 — 두 가지 배선을 다 받는다
   *
   * ```svelte
   * <Toggle bind:checked={form.log} id="f-log" />                       <!-- 폼 상태 -->
   * <Toggle checked={settings.autoReconnect} onchange={setAutoReconnect} /> <!-- 설정 스토어 -->
   * ```
   *
   * `checked` 는 `$bindable` 이라 `bind:` 로 묶으면 양방향이고, 그냥 값을 주면 단방향이다.
   * 후자에서는 `onchange` 로 올라온 값을 상위가 스토어에 넣고, 그 스토어가 다시 `checked`
   * 로 내려오면서 화면이 맞춰진다 (지금 설정 화면 전부가 이 모양이다).
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
    /** `<label for>` 로 라벨과 묶으려면 준다 (설정 화면의 모든 행이 이렇게 묶여 있다) */
    id?: string;
    disabled?: boolean;
    /** 곁에 보이는 라벨이 없을 때의 접근성 이름 (`aria-label`) */
    label?: string;
    title?: string;
    /** 사용자가 바꿨을 때. 새 값만 준다 — 호출부가 이벤트 객체를 풀 일이 없게 */
    onchange?: (checked: boolean) => void;
    /** 하네스 · 시험의 손잡이(`data-*`) — 안쪽 진짜 체크박스에 그대로 단다(`.checked` · `.click()` 이 체크박스 때와 같게) */
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
  <!-- 실제로 보이는 것 — 클릭·포커스는 위 input 이 받는다 (그래서 aria-hidden 이다) -->
  <span class="track" aria-hidden="true">
    <span class="knob"><UiIcon name="check" size={12} /></span>
  </span>
</span>

<style>
  /* MD3 switch(2026-10-18 — End-4 식 목업, 실기: 52×32 는 커서 MD3 비율 그대로 줄였다): 40×24 트랙 · 2px 테두리.
     꺼짐 = surfaceContainerHighest 트랙(`--control-bg`) + outline 테두리 · 12px outline 손잡이,
     켜짐 = primary 트랙 · 18px onPrimary 손잡이 안에 ✓(onPrimaryContainer). 감싸는 쪽이 `--toggle-{on,off}-{bg,knob}` ·
     `--toggle-off-bg-hover` · `--toggle-off-border` 로 바꿀 수 있다 */
  .toggle {
    position: relative;
    flex: 0 0 auto;
    display: inline-block;
    width: 40px;
    height: 24px;
    vertical-align: middle;
  }

  /*
   * 진짜 체크박스 — **트랙 전체를 덮는다**. `display:none`·`visibility:hidden` 이면 포커스를
   * 못 받고 Space 도 안 먹으므로, 보이지만 않게(`opacity:0`) 두고 자리는 그대로 차지시킨다.
   * 이러면 마우스 클릭도 이 요소가 직접 받아 label 배선이 없어도 눌린다.
   */
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

  /* 손잡이 — 트랙 안쪽(테두리 안 36×20) 기준. 꺼짐 12px 은 왼쪽 4px, 켜짐 18px 은 오른쪽 2px 에 선다 */
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
    /* 글래스면 위쪽 빛 선(theme.css 재질 절) — 평면은 없음 */
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

  /* 마우스가 올라가면 꺼진 쪽도 상태 층 한 겹 — 누를 수 있는 것임을 알린다 */
  .toggle.off input:hover:not(:disabled) + .track {
    background: var(--toggle-off-bg-hover, var(--control-bg-hover));
  }

  /* 포커스 링은 앱의 다른 곳과 같은 **중성** 링 (키보드로 왔을 때만). 강조색은 켜진 트랙의
     몫이다 — 링까지 강조색이면 꺼진 스위치에 포커스만 와도 "켜졌다" 로 읽힌다
     (docs/log/2026-09-25-finish-settings.md). */
  .toggle input:focus-visible + .track {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  .toggle input:disabled + .track {
    opacity: 0.45;
  }

  /* 움직임을 줄이라고 한 사용자에게는 노브가 순간이동한다 — 상태는 그대로 보인다 */
  @media (prefers-reduced-motion: reduce) {
    .track,
    .knob {
      transition: none;
    }
  }
</style>
