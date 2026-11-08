<script lang="ts">
  /**
   * **창 제목줄** — 탭 바가 곧 창 제목줄이다(decorations:false). `+page.svelte` 에서 옮겨 왔다(2026-10-27 분할 7차 — 마크업 ·
   * 클래스 · i18n 키 불변). 오른쪽 끝에 최소화 · 최대화 · 닫기를 직접 그리고, 탭 뒤 빈 공간(Tabs 안의 `.dragspace`)을 잡아
   * 창을 옮긴다(더블클릭 = 최대화). 제목줄 자신의 끌기 속성은 둥근 패널 스타일에서 드러나는 패널 둘레 여백 몫이다(그 밖에는
   * 자식이 꽉 차 드러나지 않는다).
   *
   * - 탭 바(`Tabs`)는 부모가 `children` 으로 넘긴다 — 배선(콜백 스무 개)은 부모의 상태라 부모에 둔다. 탭 바는 이 상자의
   *   **직계 자식**이어야 한다(`pane/workspace-slide.ts` 의 `.titlebar > .tabs`).
   * - 높이(`height`)는 부모가 묶어 `--titlebar-h` 로 쓴다(캔버스 위 끝 — 감싸기 · 글래스 흐림 판의 구멍 · `.canvas-edge`).
   * - 상태바 자리 · 모양에 따라 달라지는 규칙은 이 상자의 `data-statusbar` · `data-statusbar-style`(부모 `.app` 과 같은 값)에
   *   건다 — 조상 `.app` 에 기대지 않는다. 모바일 배치에서는 이 컴포넌트가 아예 그려지지 않으므로(`MobileBar`) 예전의
   *   `:not(.mobile)` 조건은 늘 참이라 뺐다. 상태바 · 캔버스 쪽 짝 규칙은 `+page.svelte` 에 남았다.
   * - 원격 창은 창 제어를 그리지 않는다(`isRemote`).
   * - **위 상태바는 이 줄 안이다**(2026-10-28 — 목업 PHfVWdUwgNyYFdJvYSZBkv): 부모가 `status` 로 넘기면 탭 뒤 · 창 단추 앞에 그린다
   *   (`StatusBar` 의 `inline`). 예전의 두 줄 머리(탭 줄 + 상태바 줄 · `--head-sb-h`)는 없다 — 모양(평면 · 둥근 패널 · 감싸기)은 한 줄 그대로.
   * - 창 제어는 **설정으로 켤 때만** 선다(`[app] window_controls` — 기본 끔, 2026-10-28). 끄면 닫기는 독의 [끝내기…] 모달
   *   (`dialogs/QuitDialog` — 보조 창은 [이 창 닫기] 판), 최대화는 탭 뒤 빈 곳 더블클릭, 최소화는 OS 단축키다.
   */
  import type { Snippet } from "svelte";
  import type { StatusBarPosition, StatusBarStyle } from "$lib/settings.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import { isRemote, winClose, winMaximized, winMinimize, winToggleMax } from "$lib/app/window.svelte.js";
  import { settings } from "$lib/settings.svelte.js";

  let {
    position,
    barStyle,
    height = $bindable(0),
    children,
    status,
  }: {
    /** 상태바 자리 — 부모 `.app` 의 `data-statusbar` 와 같은 값 */
    position: StatusBarPosition;
    /** 상태바 모양 — 부모 `.app` 의 `data-statusbar-style` 와 같은 값 */
    barStyle: StatusBarStyle;
    /** 제목줄 높이(px) — 부모가 `--titlebar-h` 로 쓴다 */
    height?: number;
    /** 탭 바 */
    children: Snippet;
    /** 탭 줄 안의 상태바(데스크톱 위 배치) — 탭 뒤 · 창 단추 앞 */
    status?: Snippet;
  } = $props();
</script>

<div
  class="titlebar"
  data-tauri-drag-region
  data-statusbar={position}
  data-statusbar-style={barStyle}
  bind:clientHeight={height}
>
  {@render children()}
  {@render status?.()}
  {#if !isRemote && settings.windowControls}<div class="winctl glass-band">
    <button
      type="button"
      class="winbtn"
      title={t("app.window.minimize")}
      aria-label={t("app.window.minimize")}
      onclick={winMinimize}
      >−</button
    >
    <button
      type="button"
      class="winbtn"
      title={winMaximized() ? t("app.window.restore") : t("app.window.maximize")}
      aria-label={winMaximized() ? t("app.window.restore") : t("app.window.maximize")}
      onclick={winToggleMax}>{winMaximized() ? "❐" : "□"}</button
    >
    <button
      type="button"
      class="winbtn close"
      title={t("app.window.close")}
      aria-label={t("app.window.close")}
      onclick={winClose}
      >✕</button
    >
  </div>{/if}
</div>

<style>
  /* 커스텀 타이틀바 — 탭 바(flex:1) + 오른쪽 창 제어. decorations:false 라 이게 창 제목줄이다 */
  .titlebar {
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    min-width: 0;
  }

  /* 자식 컴포넌트(Tabs)의 루트를 폭 채우게 — 창 제어를 오른쪽 끝으로 민다 */
  .titlebar :global(.tabs) {
    flex: 1;
    min-width: 0;
    /* 높이 = 탭 줄 두께(안쪽 + 아래 선 — `+page` 의 `--tab-row` · `--tab-line`). 상태바 띠 · 기둥과 같은 값으로 못 박아 화면 배율에서도 두께가 같다 */
    box-sizing: border-box;
    height: calc(var(--tab-row) + var(--tab-line));
  }

  .winctl {
    flex: 0 0 auto;
    display: flex;
    align-items: stretch;
    /* 탭 줄과 한 띠다 — 재질 글래스면 같은 옅은 띠 판(`.glass-band`) */
    background: var(--glass-band, var(--bg-panel));
    border-bottom: 1px solid var(--border);
  }

  .winbtn {
    width: 46px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    font-family: var(--font-ui);
    font-size: 13px;
    line-height: 1;
    color: var(--fg-muted);
    background: transparent;
    border: none;
    cursor: pointer;
    transition:
      background 120ms ease,
      color 120ms ease;
  }

  .winbtn:hover {
    background: var(--bg-hover);
    color: var(--fg);
  }

  /* 닫기만 위험색 호버 (Windows 관례) */
  .winbtn.close:hover {
    background: var(--err);
    color: #fff;
  }

  /*
   * **상태바 감싸기(hug)** — 짝 규칙(캔버스 모서리 조각 · 창 전체 흐림 판)은 `+page.svelte` 의 감싸기 절.
   * 글래스면 창 전체 판 한 장이 흐림을 들므로 자리마다의 판(`.glass-band::before`)은 끈다(상태바 쪽은 `+page`).
   */
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="hug"]::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="hug"] :global(.tabs)::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="hug"] .winctl::before {
    display: none;
  }
  /* 제목줄 아래 선을 지운다(위 띠가 아니면) — 제목줄과 감긴 모서리가 한 면으로 이어지고, 캔버스 위 선이 곡선 사이를 잇는다 */
  .titlebar[data-statusbar="left"][data-statusbar-style="hug"] :global(.tabs),
  .titlebar[data-statusbar="left"][data-statusbar-style="hug"] .winctl,
  .titlebar[data-statusbar="right"][data-statusbar-style="hug"] :global(.tabs),
  .titlebar[data-statusbar="right"][data-statusbar-style="hug"] .winctl,
  .titlebar[data-statusbar="bottom"][data-statusbar-style="hug"] :global(.tabs),
  .titlebar[data-statusbar="bottom"][data-statusbar-style="hug"] .winctl,
  .titlebar[data-statusbar="top"][data-statusbar-style="hug"] :global(.tabs),
  .titlebar[data-statusbar="top"][data-statusbar-style="hug"] .winctl,
  .titlebar[data-statusbar="top"][data-statusbar-style="hug"] :global(.statusbar) {
    border-bottom: none; /* 투명이 아니라 없앤다 — 흐림 판은 테두리 안쪽만 덮어 투명한 1px 칸으로 바탕이 비쳤다 */
  }
  /* 감싸기 — 탭 줄 안 상태바도 판을 따로 들지 않는다(창 전체 판 한 장 — 위 절) */
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="hug"] :global(.statusbar)::before {
    display: none;
  }
  /* 글래스 — 흐림 판을 **한 장**으로. 탭 줄 · 창 단추 · 상태바가 판을 따로 들면 맞닿은 곳마다 바탕을 달리 흐려 이음매가 비친다.
     제목줄이 상태바 높이만큼 아래로 늘어난 판 하나를 들고 세 자리의 판은 끈다(상태바 쪽은 `+page`). 상태바 위 가장자리 빛 선
     (`--glass-edge`)도 함께 사라진다. 감싸기(hug)는 창 전체 판 한 장이 따로 든다(위 감싸기 절) */
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"] {
    position: relative;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"]::before {
    content: "";
    position: absolute;
    inset: 0;
    z-index: -1;
    pointer-events: none;
    box-shadow: var(--glass-edge);
    backdrop-filter: var(--glass-filter-band);
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"] :global(.tabs)::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"] .winctl::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar="top"][data-statusbar-style="flat"] :global(.statusbar)::before {
    display: none;
  }

  /*
   * **캔버스 가장자리**(`.canvas-edge` — `+page.svelte` 의 같은 절) — 탭 줄 아래 변은 그 상자의 위 테두리가 긋는다. 탭 줄 ·
   * 창 단추의 아래 테두리는 색만 투명으로 둔다(자리 1px 그대로 — 배치가 안 움직인다). 글래스 아래 띠면 탭 줄 · 창 단추의 판을
   * 테두리 안쪽만 칠해 선이 판 위에 한 번 더 겹치지 않는다.
   */
  .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.tabs),
  .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .winctl,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"][data-statusbar="bottom"] :global(.tabs),
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"][data-statusbar="bottom"] .winctl {
    border-bottom-color: transparent;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"][data-statusbar="bottom"] :global(.tabs),
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"][data-statusbar="bottom"] .winctl {
    background-clip: padding-box;
  }
  /*
   * L + 글래스 — 흐림과 판 색은 창 전체 한 장(`+page` 의 `.app::before`)이 든다. 판의 위 빛 선(`--glass-edge`)은 판이 창 밖으로
   * 4px 나가 있으니 제목줄이 진다(판 위 · 탭 줄 글자 밑). 탭 줄 · 창 단추는 판 색 · 흐림 판을 끈다(기둥 쪽은 `+page`).
   */
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) {
    box-shadow: var(--glass-edge);
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.tabs)::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .winctl::before {
    display: none;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) :global(.tabs),
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="flat"]:is([data-statusbar="left"], [data-statusbar="right"]) .winctl {
    background: transparent;
  }

  /*
   * **둥근 패널이면 탭 줄도 떠 있는 둥근 패널**(10-22 사용자 결정 — 목업 A). 상태바 패널과 같은 여백(`--space-2`) · 반지름 ·
   * 가장자리(글래스 = `--glass-rim` 선 · 평면 재질 = `--line` 테두리)이고 창 단추는 패널 안 오른쪽 끝이다.
   *  - DOM 은 그대로 — 판은 제목줄의 `::before`(테두리 · 판 색 · 흐림)가 진다(`::after` 는 끈다). 제목줄은 여백 + 테두리 1px
   *    만큼 안쪽 여백을 두고, 탭 줄 · 창 단추는 판 · 흐림 · 아래 선을 끈다(두 상자가 판을 따로 들면 맞닿은 곳에 이음매가 비친다).
   *    `z-index: -1` — 제목줄은 쌓임 맥락이 없어 위 머리 절의 흐림 판처럼 탭 줄 글자 밑 · 창 바탕 위에 선다.
   *  - 창 끌기: 패널 둘레 여백(창 위 · 양옆)은 제목줄 자신이라 그 `data-tauri-drag-region` 이 받는다(더블클릭 = 최대화 그대로).
   *    패널 안 빈 곳은 탭 뒤 `.dragspace` 와 탭 줄 자신의 여백(`Tabs` 루트의 같은 속성). 창 단추는 창 끝에서 9px 안이라
   *    프레임 없는 창의 크기 조절 띠(가장자리 몇 px)와 겹치지 않는다.
   *  - 최대화해도 여백은 남는다 — 상태바 패널 · 감싸기 테두리와 같다.
   *  - 아래 · 왼쪽 · 오른쪽 상태바 패널은 따로 뜬 판이다 — 탭 패널 아래 변에서 `--space-2` 뒤에 상태바 · 타일이 같은 줄로 시작한다.
   *  - 위 상태바면 상태 묶음이 이 패널 **안**(탭 뒤 · 창 단추 앞)에 든다 — 한 줄 패널(2026-10-28 · 예전엔 두 줄 패널).
   */
  .titlebar[data-statusbar-style="panel"] {
    position: relative;
    padding: calc(var(--space-2) + 1px) calc(var(--space-2) + 1px) 1px;
  }
  .titlebar[data-statusbar-style="panel"]::before,
  .titlebar[data-statusbar-style="panel"]::after {
    content: "";
    position: absolute;
    z-index: -1;
    pointer-events: none;
  }
  .titlebar[data-statusbar-style="panel"]::before {
    inset: var(--space-2) var(--space-2) 0;
    border: 1px solid var(--glass-rim, var(--line));
    border-radius: var(--radius-surface); /* 떠 있는 면 — 타일 · 상태바 패널과 같은 큰 면 모서리(2026-10-25) */
    background: var(--glass-band, var(--surface-raised));
  }
  .titlebar[data-statusbar-style="panel"]::after {
    display: none;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="panel"]::before {
    background-clip: padding-box;
    backdrop-filter: var(--glass-filter-band);
  }
  .titlebar[data-statusbar-style="panel"] :global(.tabs),
  .titlebar[data-statusbar-style="panel"] .winctl,
  .titlebar[data-statusbar-style="panel"] :global(.statusbar) {
    background: transparent;
    border-bottom: none;
  }
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="panel"] :global(.tabs)::before,
  :global(:root[data-material="glass"]) .titlebar[data-statusbar-style="panel"] .winctl::before {
    display: none;
  }
  /* 닫기 호버의 위험색이 패널 모서리 곡선을 따라 끝나게(테두리 안쪽 곡선 R−1) */
  .titlebar[data-statusbar-style="panel"] .winbtn.close {
    border-radius: 0 calc(var(--radius-surface) - 1px) calc(var(--radius-surface) - 1px) 0;
  }
</style>
