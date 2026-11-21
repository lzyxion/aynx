<script lang="ts">
  /**
   * 프라이버시 잠금(가림막) — 걷는 것이 곧 볼트를 여는 것이다(건너뛰는 길 없음 — docs/invariants.md 전문 2).
   *
   * 관문의 꼴은 하나다 — 마스터 있음 · 없음 · 볼트 없음의 세 꼴은 DOM 한 글자까지 같고, 갈리는 것은 `vault_unlock` 이 받는 값뿐이다.
   * "비워 두고 Enter" 같은 곁말을 적으면 이 기계가 암호 없이 열린다는 사실이 바깥 사람에게 넘어간다. 마스터가 없을 때 무언가
   * 쳐 넣었으면 마스터 관문과 같은 "틀린 암호" 줄을 세운다 — 틀린 값으로도 마스터의 있고 없음을 알아낼 수 없게.
   *
   * Escape 를 포함해 다른 어떤 키 · 클릭도 걷지 않는다 — 걷는 문은 이 폼 하나다(`Ctrl+Shift+B` 도 삼켜진다).
   * 다른 창이 이미 볼트를 열어 두었더라도 이 창의 관문은 그대로 선다.
   * 관문 값은 이 컴포넌트에 산다 — 걷히면 인스턴스와 함께 사라지므로 닫히는 길마다 지우는 장치가 필요 없다.
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

  let clock = $state(formatClock());
  function formatClock(): string {
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, "0");
    const mm = String(d.getMinutes()).padStart(2, "0");
    return `${hh}:${mm}`;
  }

  // ── 관문 ──

  /** 화면은 이 값을 그리지 않는다(머리말) · `"loading"` 동안은 열지 않는다 — 무엇이 답인지 모른 채 여는 일은 없다 */
  type Gate = "loading" | "master" | "nomaster" | "absent";

  let mode = $state<Gate>("loading");
  let value = $state("");
  let error = $state<string | null>(null);
  let busy = $state(false);

  let card = $state<HTMLElement | null>(null);
  let field = $state<HTMLInputElement | null>(null);
  let openButton = $state<HTMLButtonElement | null>(null);

  /** 칸이 아직 없으면 [열기] · 카드가 대신 받는다 — Enter 가 닿을 자리가 늘 있어야 한다 */
  function focusGate(): void {
    (field ?? openButton ?? card)?.focus({ preventScroll: true });
  }

  /** `disabled` 는 다음 렌더에 떨어진다 — `tick()` 전에 `focus()` 하면 조용히 실패해 키가 삼켜진 채 남는다 */
  async function refocusField(): Promise<void> {
    value = "";
    await tick();
    focusGate();
  }

  /**
   * `fresh` 로 묻는다 — `openVeil` 이 방금 던진 `vault_lock` 을 5초 기억이 모를 수 있다.
   * 실패는 "볼트 없음" 으로 접혀 `absent` 관문이 선다 — "마스터가 있다" 로 가정하면 열 길 없는 화면이 남는다.
   */
  async function readGate(): Promise<void> {
    const status = await vault.status(true);
    mode = status.state === "absent" ? "absent" : status.hasMaster ? "master" : "nomaster";
    // 칸은 이 대입 다음 렌더에 생긴다
    await Promise.resolve();
    requestAnimationFrame(() => focusGate());
  }

  /**
   * 성공해야만 가림막이 걷힌다. `nomaster` 는 빈 문자열이 아니라 `null` 로 연다 — 백엔드에서 `Some("")` 은 틀린 암호다.
   * `absent` 는 아무 명령도 부르지 않는다 — 잠근 것이 없으니 열 것도 없다.
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
      // "틀린 암호" 와 "상한 파일" 을 구분해 말하지 않는다(`vault.rs` · 잠금 해제 모달과 같다)
      error = hasReason(message, "vault-wrong-master")
        ? t("app.veil.gate.wrong")
        : stripReason(message);
      busy = false;
      void refocusField();
    }
  }

  // ── 요약 ── 수만 보인다 — 프라이버시 화면이라 이름 · 명령 · 호스트는 적지 않는다.
  const board = $derived(windowSessionCards(t).board);
  const waiting = $derived(board.summary.input);

  const reviews = $derived(pendingPlans().length);
  const ran = $derived(veiledTally());
  const runsDone = $derived(ran.error + ran.info + ran.success > 0);

  // ── 입력을 삼키는 창 리스너 ── 전역 키(버블 단계)보다 먼저 잡으려고 캡처 단계로 건다.
  // `stopImmediatePropagation` 은 전파만 멈춘다 — 암호 칸의 글자 입력은 그대로 돌고, 막을 것만 `preventDefault` 한다.

  function onKeydown(ev: KeyboardEvent): void {
    ev.stopImmediatePropagation();
    // IME 조합 중의 Enter 는 "확정" 이지 "제출" 이 아니다
    if (ev.isComposing) return;
    if (ev.key === "Enter") {
      ev.preventDefault();
      void submitGate();
      return;
    }
    if (ev.key === "Escape") {
      // 어느 꼴에서도 걷지 않는다 — 걷는 문은 폼 하나다
      ev.preventDefault();
      return;
    }
    // 암호 칸 밖에서는 막는다 — 스페이스바로 [열기]가 눌려 걷히면 "아무 키에 풀린다" 가 뒷문으로 돌아온다
    if (!(ev.target instanceof HTMLInputElement)) ev.preventDefault();
  }

  function onPointerDown(ev: PointerEvent): void {
    if (ev.target instanceof Node && card?.contains(ev.target)) return;
    ev.preventDefault();
    ev.stopImmediatePropagation();
  }

  /** 커서가 카드 밖으로 나가면 키가 여전히 삼켜져 아무 데도 글자가 들어가지 않는 화면이 된다 */
  function onFocusIn(ev: FocusEvent): void {
    if (ev.target instanceof Node && card?.contains(ev.target)) return;
    focusGate();
  }

  onMount(() => {
    void readGate();
    resetVeiledTally();

    const clockId = setInterval(() => (clock = formatClock()), 1000);

    window.addEventListener("keydown", onKeydown, true);
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("focusin", onFocusIn, true);

    focusGate();

    return () => {
      clearInterval(clockId);
      window.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("focusin", onFocusIn, true);
    };
  });
</script>

<!-- z-index 115 — 팔레트 · 검색(110) 위, 토스트(120) 아래 · 위험 토스트는 일부러 뚫고 올라오게 둔다 -->
<!-- 잠금 카드는 볼트 잠금 해제 모달(`dialogs/VaultUnlockDialog.svelte`)과 한 벌(전역 `.lock-card`)이다 -->
<div class="veil" role="dialog" aria-label={t("app.veil.title")} aria-modal="true">
  <div class="clock">{clock}</div>

  <div class="card lock-card glass-raised modal-rise" bind:this={card} tabindex="-1">
    <span class="lock lock-badge" aria-hidden="true"><UiIcon name="lock" size={26} /></span>
    <h2 class="heading lock-title">{t("app.veil.gate.title")}</h2>
    <form
      class="lock-form"
      onsubmit={(ev) => {
        ev.preventDefault();
        void submitGate();
      }}
    >
      <!-- 여기에 `mode` 의 세 꼴을 가르는 것을 넣지 않는다 — 넣는 순간 잠긴 화면이 볼트의 속을 말한다(`loading` 은 세 꼴 공통) -->
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
    /* 가독성은 blur 가 죽인다 — `--bg-overlay` 는 "덮는" 느낌이라 옅은 base 틴트를 쓴다 */
    background: color-mix(in srgb, var(--bg-base) 22%, transparent);
    backdrop-filter: blur(18px) saturate(1.1);
    -webkit-backdrop-filter: blur(18px) saturate(1.1);
    pointer-events: auto; /* 뒤의 화면을 입력에서 가린다 */
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
