<script lang="ts">
  /**
   * **프라이버시 잠금(가림막)** — 창 전체를 흐리게 덮어, 자리를 비운 사이 터미널 출력이
   * 어깨너머로 읽히지 않게 한다 (`app/veil.svelte.ts` 가 열림 여부를 쥔다).
   *
   * ## 가림막이 **곧 관문**이다 (2026-09-19 밤, 사용자 결정)
   *
   * 옛 판은 "보안 잠금이 아니다 — 아무 키·클릭에 풀린다" 였다. 그 문장은 볼트가 가림막과
   * **함께 잠기기** 시작한 순간부터 반쪽이 됐다: 화면은 스페이스바 하나에 걷히는데 볼트는
   * 잠긴 채라, 사람이 보는 "잠김" 과 앱이 아는 "잠김" 이 달랐다. 이제 하나다 —
   * **걷는 것이 곧 볼트를 여는 것이다.**
   *
   * ## 관문의 꼴은 **하나다** — 화면은 마스터의 있고 없음을 말하지 않는다
   * (2026-09-19 밤, 사용자 되먹임 두 번)
   *
   * 첫 되먹임은 칸을 셋 모두에 세웠고 곁말 한 줄만 갈랐다. 그 한 줄이 아직 **말을 너무
   * 많이 했다**: 잠긴 화면을 들여다본 바깥 사람이 "비워 두고 Enter" 를 읽는 순간, 이 기계가
   * **아무 암호 없이 열린다**는 사실이 공짜로 넘어간다. 그래서 곁말을 지웠다 — 이제 세 꼴은
   * **DOM 한 글자까지 같다**(클래스·`data-*`·`disabled`·`placeholder`·`aria-describedby`
   * 무엇도 갈리지 않는다). 갈리는 것은 화면 **밖**, `vault_unlock` 이 받는 값뿐이다.
   *
   * | 볼트 | 화면 | 받아들이는 값 |
   * | --- | --- | --- |
   * | 마스터 있음 | (셋이 같다) | 맞는 암호 → `vault_unlock(그 값)` |
   * | 마스터 없음 | (셋이 같다) | **빈 값만** → `vault_unlock(null)` |
   * | 볼트 없음 | (셋이 같다) | **빈 값만** → 부를 명령 없음 |
   *
   * 뒤의 두 줄에서 빈 값이 **유일한 답**이라는 것이 이 판의 규칙이다: 무언가 쳐 넣었다면
   * 그것은 틀린 암호이고(물어볼 금고가 없거나 `null` 로만 열린다), 마스터 관문과 **같은
   * 줄**("마스터 암호가 맞지 않습니다")을 세운다. 세 꼴이 같은 줄을 세워야 틀린 값을 넣어
   * 보는 것으로도 마스터의 있고 없음을 알아낼 수 없다.
   *
   * 틀린 뒤에는 **칸을 비우고 커서를 도로 칸에 놓는다** — 마우스를 다시 집을 일 없이 바로
   * 고쳐 칠 수 있어야 한다. 커서는 세 경우 모두 처음부터 칸에 있다.
   *
   * **Escape 는 어느 꼴에서도 걷지 않는다.** 걷는 문은 이 폼 하나다.
   *
   * **다른 어떤 키·클릭도 아무 일도 하지 않는다.** 창 캡처 리스너는 이제 "걷는" 리스너가
   * 아니라 **삼키는** 리스너다 — 앱의 전역 키(창 버블 단계)에 한 글자도 닿지 않게 하고,
   * 카드 안의 암호 칸에서만 글자가 제 일을 한다. `Ctrl+Shift+B` 도 여기서 삼켜지므로 떠 있는
   * 가림막을 그 키로 끌 수 없다(`app/veil` 의 `raiseVeil` 도 같은 답을 낸다).
   *
   * 다른 창이 이미 볼트를 열어 두었더라도 **이 창의 관문은 그대로 선다** — 가림막은 화면
   * 잠금이고, 화면 잠금은 편의보다 일관성이 먼저다. 그때 `vault_unlock` 은 봉투에 암호를 다시
   * 맞춰 보고 열린 금고를 그대로 다시 연다 (`vault.rs` 의 `open_at` 은 상태를 보지 않는다).
   *
   * ## 흐림은 뒤에만 · 관문 카드는 또렷
   * `backdrop-filter: blur` 는 **뒤에 있는 것**만 흐리게 하고, 이 요소의 **자식은 또렷하게**
   * 그린다. 그래서 가운데 카드(시계·자물쇠·관문·위임 요약)는 선명하게 남는다 — "정상은 조용히,
   * 이상은 또렷" 을 이 대비로 만든다. 위험 토스트(120)는 이 층(115) 위로 뚫고 올라온다.
   *
   * ## 관문 상태가 여기 사는 이유
   * 가림막은 `{#if}` 로 붙었다 떨어지므로 **이 컴포넌트가 곧 관문의 수명**이다 — 걷히면
   * 인스턴스가 사라지며 `value` 도 함께 사라진다. 그래서 `vu`·`vm` 처럼 모듈에 칸을 두고
   * 닫히는 길마다 `""` 로 덮는 장치가 필요 없다 (저쪽은 모달이 큐 위에 살아 그래야 한다).
   */
  import { onMount, tick } from "svelte";
  import { closeVeil } from "$lib/app/veil.svelte.js";
  import { pendingPlans } from "$lib/app/pending-plans.svelte.js";
  import { resetVeiledTally, veiledTally } from "$lib/app/operation-notify.svelte.js";
  import { windowSessionCards } from "$lib/console/window-cards";
  import { hasReason, stripReason } from "$lib/error-reason";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import * as vault from "$lib/vault";

  /** 큰 시계 `HH:MM` (24시). 1초마다 갱신한다. */
  let clock = $state(formatClock());
  function formatClock(): string {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // ---------------------------------------------------------------------------
  // 관문 (머리말의 표)
  // ---------------------------------------------------------------------------

  /**
   * 무엇을 **받아들일 것인가**. 화면은 이 값을 **그리지 않는다** — 머리말의 표대로 세 꼴의
   * DOM 은 같고, 이 값은 `submitGate` 안에서만 읽힌다.
   *
   * `"loading"` 은 첫 `vault_status` 가 돌아오기 전의 한 틱이다 — 그동안 [열기] 는 잠들어
   * 있고 Enter 도 아무 일도 하지 않는다. **무엇이 답인지 모른 채 여는 일은 없다.**
   */
  type Gate = "loading" | "master" | "nomaster" | "absent";

  let mode = $state<Gate>("loading");
  let value = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  let card = $state<HTMLElement | null>(null);
  let field = $state<HTMLInputElement | null>(null);
  let openButton = $state<HTMLButtonElement | null>(null);

  /**
   * 커서가 있어야 할 곳 — **칸**이다. `loading` 의 한 틱과 칸이 아직 안 붙은 순간에만
   * [열기]·카드가 대신 받는다 (Enter 가 닿을 자리가 늘 있어야 한다).
   */
  function focusGate(): void {
    (field ?? openButton ?? card)?.focus({ preventScroll: true });
  }

  /**
   * 틀린 뒤의 자리 — **비우고 커서를 도로 칸에 놓는다**(머리말).
   *
   * `tick()` 을 한 번 기다리는 이유: `busy` 가 풀리며 칸의 `disabled` 가 떨어지는 것은
   * **다음 렌더**다. 그 전에 `focus()` 를 부르면 아직 비활성인 요소라 조용히 실패하고,
   * 커서 없는 화면에 키는 여전히 삼켜진 채로 남는다.
   */
  async function refocusField(): Promise<void> {
    value = "";
    await tick();
    focusGate();
  }

  /**
   * 볼트의 지금 모습을 묻고 관문의 꼴을 정한다.
   *
   * `fresh` 로 묻는다 — `openVeil` 이 방금 `vault_lock` 을 던졌고(기다리지 않는다), 5초
   * 기억이 옛 상태를 들고 있을 수 있다. **꼴을 가르는 것은 `hasMaster`·`absent` 뿐이라**
   * 잠금이 아직 안 끝났어도 답은 같지만, 이 화면에서 낡은 값을 쓸 이유가 없다.
   *
   * 물음이 실패하면 `$lib/vault` 가 "볼트 없음" 으로 접는다 → `absent` 관문이 선다. 그게
   * 맞다: 못 물어본 금고를 "마스터가 있다" 로 가정하면 열 길 없는 화면이 남는다.
   */
  async function readGate(): Promise<void> {
    const status = await vault.status(true);
    mode = status.state === "absent" ? "absent" : status.hasMaster ? "master" : "nomaster";
    // 칸은 이 대입 다음 렌더에 생긴다 — 마이크로태스크 하나를 양보하고 커서를 놓는다.
    await Promise.resolve();
    requestAnimationFrame(() => focusGate());
  }

  /**
   * **관문을 지난다** — 성공해야만 가림막이 걷힌다.
   *
   * - `master` → `vault_unlock(그 값)`. 틀리면 줄이 서고 칸은 **비워져 커서를 되받는다**.
   * - `nomaster` → 빈 값일 때만 `vault_unlock(null)`. 빈 **문자열**이 아니다 — 백엔드에서
   *   `Some("")` 은 마스터 금고의 **틀린 암호**로 읽힌다 (`app/prompts` 의 같은 줄).
   * - `absent` → 빈 값일 때 **아무 명령도 부르지 않는다.** 잠근 것이 없으니 열 것도 없다
   *   (`vault_unlock` 은 여기서 `[vault-absent]` 로 거절할 뿐이다).
   *
   * 뒤의 두 경우에 무언가 쳐 넣었다면 **명령을 내보내기 전에** 여기서 틀린 것으로 접는다
   * (머리말): 부를 곳이 없거나, 불러 봤자 `null` 아닌 값은 그 금고의 답이 아니다.
   */
  async function submitGate(): Promise<void> {
    if (busy || mode === "loading") return;
    if (mode !== "master" && value !== "") {
      error = t("app.veil.gate.wrong");
      void refocusField();
      return;
    }
    busy = true;
    error = null;
    try {
      if (mode !== "absent") await vault.unlock(mode === "master" ? value : null);
      value = "";
      busy = false;
      closeVeil();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      // "틀린 암호" 와 "상한 파일" 을 구분해 말하지 않는다 (`vault.rs`·잠금 해제 모달의 같은 줄).
      error = hasReason(message, "vault-wrong-master")
        ? t("app.veil.gate.wrong")
        : stripReason(message);
      busy = false;
      void refocusField();
    }
  }

  // ---------------------------------------------------------------------------
  // **세션 요약** — 세션 목록 판·상태바 세션 칸과 **같은 재료**(이 창의 타일 카드 판, `console/window-cards`)를 센다
  // (2026-10-07 — 앞선 판은 원격 위임 세션 목록 `list_console_sessions` 를 2초마다 읽어, 화면의 실제 세션과 맞지 않았다).
  // 타일 상태는 이미 반응형이라 폴링이 없다. 수만 보인다 — 가림막은 프라이버시 화면이라 이름·명령은 적지 않는다.
  // ---------------------------------------------------------------------------
  const board = $derived(windowSessionCards(t).board);
  // (오케스트레이션 3차 3b) 헤드리스 작업자에게는 사람이 답할 화면이 없다 — 예전의 Run 작업자 "대기" 셈(`needsHuman`)은 걷었다.
  const waiting = $derived(board.summary.input);

  // 검토 대기 작업안 수 · 가림막 동안 끝난 실행 수 — 수만(2026-10-28 — 예전엔 작업안 카드 한 줄 · 개수 토스트가 따로 섰다).
  // 작업안 목록은 메인 창에서만 차므로 분리 창의 가림막에는 서지 않는다(작업안 카드 · 상태바 배지와 같은 규칙).
  const reviews = $derived(pendingPlans().length);
  const ran = $derived(veiledTally());
  const runsDone = $derived(ran.error + ran.info + ran.success > 0);

  // ---------------------------------------------------------------------------
  // 입력을 **삼키는** 창 리스너 (옛 판에서는 "걷는" 리스너였다 — 머리말)
  //
  // 전역 키 처리(bubble 단계의 `svelte:window`)보다 **먼저** 잡으려고 **캡처 단계**로 창에
  // 건다. xterm 은 전역 keydown 을 창까지 흘려보내고(`keybindings.ts` 의 `isEditableTarget`
  // 이 `.xterm` 을 제외), 캡처는 그 bubble 핸들러를 이긴다 — 그래서 어떤 키도 터미널에
  // 닿거나 단축키를 트리거하지 않는다.
  //
  // `stopImmediatePropagation` 은 **전파만** 멈춘다(기본 동작은 그대로다). 그래서 암호 칸의
  // 글자 입력·`bind:value`(`input` 이벤트)는 멀쩡히 돌고, 막고 싶은 것만 `preventDefault`
  // 로 막는다.
  // ---------------------------------------------------------------------------

  function onKeydown(ev: KeyboardEvent): void {
    ev.stopImmediatePropagation();
    // IME 조합 중의 Enter 는 "확정" 이지 "제출" 이 아니다 (`keybindings.ts` 와 같은 결).
    if (ev.isComposing) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      void submitGate();
      return;
    }
    if (ev.key === "Escape") {
      // **어느 꼴에서도 걷지 않는다.** 옛 판은 마스터가 없을 때 Escape 를 [열기] 의 곁길로
      // 뒀지만, 폼이 셋 모두에 서는 지금 그 곁길은 "칸을 지나지 않고도 걷힌다" 는 예외가
      // 된다 — 걷는 문은 폼 하나다(머리말).
      ev.preventDefault();
      return;
    }
    // 그 밖의 키는 **암호 칸 안에서만** 제 일을 한다. 카드 밖이든 [열기] 위든 아무 일도
    // 없다 — 스페이스바로 버튼이 눌려 걷히면 "아무 키에 풀린다" 가 뒷문으로 돌아온다.
    if (!(ev.target instanceof HTMLInputElement)) ev.preventDefault();
  }

  function onPointerDown(ev: PointerEvent): void {
    // 카드 안(칸 클릭·[열기])은 제 일을 한다. 뒤의 타일·독으로 가는 클릭만 삼킨다.
    if (ev.target instanceof Node && card?.contains(ev.target)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }

  /**
   * 포커스를 카드 안에 묶어 둔다 — Tab 이나 뒤 화면의 자동 포커스가 커서를 밖으로 끌고
   * 나가면, 키가 여전히 삼켜지므로 **아무 데도 글자가 들어가지 않는 화면**이 된다.
   */
  function onFocusIn(ev: FocusEvent): void {
    if (ev.target instanceof Node && card?.contains(ev.target)) return;
    focusGate();
  }

  onMount(() => {
    void readGate();
    // 끝난 실행 수는 이 가림막이 선 뒤부터 센다
    resetVeiledTally();

    // 시계(떠 있는 동안만).
    const clockId = setInterval(() => (clock = formatClock()), 1000);

    window.addEventListener("keydown", onKeydown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focusin", onFocusIn, true);

    // 칸이 아직 없을 수 있다(`readGate` 가 돌아오기 전) — 그때는 카드가 받는다.
    focusGate();

    return () => {
      clearInterval(clockId);
      window.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("focusin", onFocusIn, true);
    };
  });
</script>

<!--
  z-index 115 — 팔레트·검색·치트시트(110) 위, 토스트(120) 아래. 위험 토스트는 일부러 뚫고
  올라오게 둔다(주석 참고). `pointer-events: auto` 로 뒤의 타일·독을 클릭에서 막는다.

  **모양(2026-10-28 — 잠금 화면 통일, 목업 LNdmYmQkmSP9qGzd8JwP4c)** — [시계] · [잠금 카드] · [요약] 이 세로로 선다.
  잠금 카드는 볼트 잠금 해제 모달(`dialogs/VaultUnlockDialog.svelte`)과 **한 벌**(전역 `.lock-card` — theme.css)이고,
  가림막만 뒤를 흐리며 시계 · 요약을 카드 **밖**에 둔다. 요약 = 세션(실행 중 · 대기 중 · 실패) + 검토 대기 작업안 수 +
  가림막 동안 끝난 실행 수 — 예전에는 작업안 카드(`ReviewCard`)의 한 줄 · 개수 토스트로 흩어져 있었다. 수만 보인다.
-->
<div class="veil" role="dialog" aria-label={t("app.veil.title")} aria-modal="true">
  <div class="clock">{clock}</div>

  <!-- 카드는 아래에서 올라온다(공용 `.modal-rise`). 흐림 층은 제 `veil-in` 그대로, 가림막이 붙을 때 한 번뿐이다 -->
  <div class="card lock-card glass-raised modal-rise" bind:this={card} tabindex="-1">
    <!-- 자물쇠 — "덮였다" 가 아니라 "잠겼다" 로 읽히게 하는 한 조각이다(사용자 결정). -->
    <span class="lock lock-badge" aria-hidden="true"><UiIcon name="lock" size={26} /></span>
    <h2 class="heading lock-title">{t("app.veil.gate.title")}</h2>
    <form
      class="lock-form"
      onsubmit={(ev) => {
        ev.preventDefault();
        void submitGate();
      }}
    >
      <!-- 세 경우가 **한 글자까지 같은 폼**을 쓴다(머리말). `mode` 는 여기 **한 번도
           나오지 않는다** — 나오는 순간 잠긴 화면이 볼트의 속을 말하게 된다. 유일한 예외는
           아래 [열기] 의 `loading` 인데, 그건 볼트의 꼴이 아니라 **아직 못 물어봤다**는
           한 틱이고 세 꼴 모두에서 똑같이 지나간다. -->
      {#if mode !== "loading"}
        <label class="lock-label" for="veil-input">{t("app.veil.gate.label")}</label>
        <input
          id="veil-input"
          class="lock-input"
          type="password"
          bind:this={field}
          bind:value
          autocomplete="off"
          spellcheck="false"
          disabled={busy}
          aria-invalid={error ? "true" : undefined}
          aria-describedby={error ? "veil-wrong" : undefined}
        />
      {/if}
      {#if error}
        <p class="wrong lock-wrong" id="veil-wrong">{error}</p>
      {/if}
      <button
        type="submit"
        class="open btn btn-primary lock-open"
        bind:this={openButton}
        disabled={busy || mode === "loading"}>{t("app.veil.gate.open")}</button
      >
    </form>
  </div>

  <!--
    요약 — 가려진 동안에도 **도는 것 · 기다리는 것 · 끝난 것**을 읽게 한다. 수만 보인다(프라이버시 화면 — 이름 · 명령 · 호스트는
    적지 않는다). ① 세션: 실행 중(성공색 점 · 숨쉬기) · 대기 중(강조색 점)은 늘 서고 0 이면 점이 회색, 실패는 있을 때만.
    ② 알약: 검토 대기 작업안(사람이 답할 것 — 주의 면) · 가림막 동안 끝난 실행(결마다 색 점) — 있을 때만.
  -->
  <div class="summary">
    {#if board.total > 0}
      <div class="delegation" data-veil-summary>
        <span class="chip run" class:zero={board.summary.running === 0} data-veil-running
          ><span class="dot" aria-hidden="true"></span>{t("app.veil.sessions.running", { n: board.summary.running })}</span
        >
        <span class="chip wait" class:zero={waiting === 0} data-veil-waiting
          ><span class="dot" aria-hidden="true"></span>{t("app.veil.sessions.waiting", { n: waiting })}</span
        >
        {#if board.summary.fail > 0}
          <span class="chip fail" data-veil-fail
            ><span class="dot" aria-hidden="true"></span>{t("app.veil.sessions.fail", { n: board.summary.fail })}</span
          >
        {/if}
      </div>
    {:else}
      <div class="delegation"><span class="muted">{t("app.veil.sessions.none")}</span></div>
    {/if}
    {#if reviews > 0 || runsDone}
      <div class="pills">
        {#if reviews > 0}
          <span class="pill review" data-veil-reviews
            ><UiIcon name="list-checks" size={15} />{t("app.review.count", { n: reviews })}</span
          >
        {/if}
        {#if runsDone}
          <span class="pill runs" data-veil-runs>
            {#if ran.error > 0}<span class="part err"><span class="dot" aria-hidden="true"></span>{t("app.opnotify.veiled.error", { n: ran.error })}</span>{/if}
            {#if ran.info > 0}<span class="part info"><span class="dot" aria-hidden="true"></span>{t("app.opnotify.veiled.info", { n: ran.info })}</span>{/if}
            {#if ran.success > 0}<span class="part ok"><span class="dot" aria-hidden="true"></span>{t("app.opnotify.veiled.success", { n: ran.success })}</span>{/if}
          </span>
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .veil {
    position: fixed;
    inset: 0;
    z-index: 115;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 20px;
    padding: var(--space-4);
    /* 서리유리 — dim 은 옅게(뒤가 흐릿하게 비친다), 가독성은 blur 가 죽인다.
       `--bg-overlay`(모달용 62% 다크)를 쓰면 "덮는" 느낌이라 옅은 base 틴트로 바꾼다. */
    background: color-mix(in srgb, var(--bg-base) 22%, transparent);
    backdrop-filter: blur(18px) saturate(1.1);
    -webkit-backdrop-filter: blur(18px) saturate(1.1);
    pointer-events: auto; /* 뒤의 화면을 입력에서 가린다 */
    /* 부드러운 페이드인 — 모션을 줄이는 환경에서는 끈다(아래 미디어 쿼리). */
    animation: veil-in 140ms ease-out;
  }

  @keyframes veil-in {
    from {
      opacity: 0;
    }
    to {
      opacity: 1;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .veil {
      animation: none;
    }
  }

  /* 큰 시계 — 카드 밖 위. 흐린 뒤 위에 바로 서므로 글자색은 또렷한 쪽 */
  .clock {
    font-size: 72px;
    font-weight: 300;
    line-height: 1;
    font-variant-numeric: tabular-nums;
    letter-spacing: 0.02em;
    color: var(--fg-1);
  }

  .summary {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
  }

  .delegation {
    display: flex;
    align-items: center;
    gap: 18px;
    font-size: 13px;
  }

  .muted {
    color: var(--fg-2);
  }

  /* 진행 한 줄 — 판·테두리 없이 **색은 점에만**(실행 중 = 성공색 · 기다림 = 강조색 · 실패 = 오류색). 글자는 옅게.
     0 이면 점이 회색으로 물러난다. */
  .chip {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    color: var(--fg-2);
    font-variant-numeric: tabular-nums;
  }

  .dot {
    flex: 0 0 auto;
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--chip-c);
    transition: background 200ms ease;
  }

  .chip.run {
    --chip-c: var(--ok);
  }

  .chip.wait {
    --chip-c: var(--accent);
  }

  .chip.fail {
    --chip-c: var(--err);
  }

  .chip.zero .dot {
    background: var(--fg-3);
    opacity: 0.5;
  }

  /* 도는 중이면 점이 숨쉰다 — 가려진 화면에서도 "지금 움직이고 있다" 가 읽히게 */
  .chip.run:not(.zero) .dot {
    animation: veil-breathe 1.6s ease-in-out infinite;
  }

  @keyframes veil-breathe {
    0%,
    100% {
      opacity: 1;
    }
    50% {
      opacity: 0.35;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .chip.run .dot {
      animation: none;
    }
  }

  /* 알약 줄 — 검토 대기(주의 면 — 사람이 답할 것) · 끝난 실행(중성 면 + 결마다 색 점) */
  .pills {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  .pill {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 32px;
    padding: 0 14px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    border-radius: 16px;
  }

  .pill.review {
    color: var(--warn);
    background: var(--warn-soft);
  }

  .pill.runs {
    gap: 12px;
    color: var(--fg-1);
    background: var(--glass-raised, var(--surface-raised-solid));
  }

  .part {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .part.err {
    --chip-c: var(--err);
  }

  .part.info {
    --chip-c: var(--fg-3);
  }

  .part.ok {
    --chip-c: var(--ok);
  }
</style>
