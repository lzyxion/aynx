<script lang="ts">
  // **확인 · 알림 상자**(10-16) — OS 기본 메시지 상자(`plugin-dialog` 의 `ask` · `message`) 대신 앱 테마를 따르는 모달.
  // 상태 · 줄 · 포커스 되돌리기는 `app/confirm-dialog.svelte.ts`, Escape 사슬 · `anyModalOpen` 은 `app/keys`. 꼴은
  // `WorkspaceDeleteDialog` 와 같다(Tab 순환 `trapTab` · 바깥 누르기 = 취소). 첫 포커스는 상태 모듈이 고른 단추 —
  // 위험 · 경고 · 오류면 [취소](`DbWriteDialog` 와 같은 규칙). 다른 모달(설정 · 호스트 폼 …) 안에서 물어도 그 위에 뜬다.
  // 훅 설치 확인(`askHookInstall` — `req.hooks`)은 같은 줄 · 키 · 포커스를 쓰되 폭이 넓고(520px) 본문 한 줄 아래에
  // `HookInstallBody` 를 그린다(원격이면 제목 옆 칩).
  import { tick } from "svelte";
  import { trapTab } from "$lib/focus-trap";
  import AiGaugeMini from "$lib/AiGaugeMini.svelte";
  import { GAUGE_SEGMENTS } from "$lib/ai-gauge";
  import {
    ackBlocks,
    answerConfirm,
    confirmAcked,
    currentConfirm,
    dismissConfirm,
    setConfirmAcked,
  } from "$lib/app/confirm-dialog.svelte.js";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import HookInstallBody from "$lib/dialogs/HookInstallBody.svelte";

  const req = $derived(currentConfirm());
  let modalEl = $state<HTMLElement | null>(null);
  const buttons: HTMLButtonElement[] = $state([]);

  $effect(() => {
    const r = req;
    if (!r) return;
    void tick().then(() => {
      if (currentConfirm() === r) buttons[r.focus]?.focus();
    });
  });

  function onKey(ev: KeyboardEvent): void {
    if (modalEl && trapTab(ev, modalEl)) return;
    // 앱의 전역 단축키 · 파일 타일 키 · 터미널이 이 상자의 키를 받지 않게(창 버블 리스너보다 먼저 끊는다).
    ev.stopPropagation();
    if (ev.key === "Escape") {
      ev.preventDefault();
      dismissConfirm();
    }
  }
</script>

{#if req}
  <div
    class="overlay"
    role="presentation"
    onmousedown={(ev) => {
      if (ev.target === ev.currentTarget) dismissConfirm();
    }}
  >
    <div
      class="modal glass-raised"
      class:wide={req.hooks !== undefined || req.section !== undefined}
      class:yolo={req.variant === "approve-all"}
      data-confirm-dialog={req.kind}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={req.title ? "confirm-dialog-title" : undefined}
      aria-describedby="confirm-dialog-body"
      tabindex="-1"
      bind:this={modalEl}
      onkeydown={onKey}
    >
      <div class="glass-scroll">
      {#if req.title || req.kind !== "info"}
        <h2 id="confirm-dialog-title">
          {#if req.kind !== "info"}
            <svg class="icon {req.kind}" viewBox="0 0 24 24" aria-hidden="true">
              {#if req.kind === "error"}
                <circle cx="12" cy="12" r="10" /><path d="m15 9-6 6" /><path d="m9 9 6 6" />
              {:else}
                <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" /><path d="M12 9v4" /><path
                  d="M12 17h.01"
                />
              {/if}
            </svg>
          {/if}
          <span>{req.title}</span>
          {#if req.hooks?.remote}
            <span class="chip">{t("settings.ai.hooks.confirm.remote", { alias: req.hooks.remote })}</span>
          {/if}
        </h2>
      {/if}
      {#if req.variant === "approve-all"}
        <!-- 모두 승인 미리 보기(10-23 목업) — 고르려는 단계의 게이지가 가득 찬 모양 -->
        <div class="preview"><AiGaugeMini at={GAUGE_SEGMENTS} shape="track" /></div>
      {/if}
      <p class="body" id="confirm-dialog-body">{req.body}</p>
      {#if req.hooks}
        <!-- 줄의 다음 훅 확인이 접힘 · 복사 상태를 물려받지 않게 요청마다 새로 -->
        {#key req}<HookInstallBody hooks={req.hooks} />{/key}
      {/if}
      {#if req.callout}<p class="callout" role="note">{req.callout}</p>{/if}
      {#if req.section}
        <div class="section">
          <p class="section-label">{req.section.label}</p>
          <p class="section-text">{req.section.text}</p>
        </div>
      {/if}
      {#if req.points?.length}
        <ul class="points">
          {#each req.points as p, i (i)}<li>{p}</li>{/each}
        </ul>
      {/if}
      {#if req.ack}
        <label class="ack">
          <input type="checkbox" checked={confirmAcked()} onchange={(ev) => setConfirmAcked(ev.currentTarget.checked)} data-confirm-ack />
          <span>{req.ack}</span>
        </label>
      {/if}
      <div class="actions">
        {#each req.choices as c, i (i)}
          <button
            type="button"
            class="btn {c.tone === 'secondary'
              ? 'btn-secondary'
              : req.variant === 'approve-all'
                ? 'yolo-solid'
                : c.tone === 'danger'
                  ? 'danger-solid'
                  : 'btn-primary'}"
            data-confirm-choice={c.result}
            disabled={ackBlocks(req, c, confirmAcked())}
            bind:this={buttons[i]}
            onclick={() => answerConfirm(c.result)}>{c.label}</button
          >
        {/each}
      </div>
      {#if req.footnote}<p class="footnote">{req.footnote}</p>{/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .overlay {
    position: fixed;
    inset: 0;
    /* 다른 모달(100~111 — 설정 독 · 호스트 폼 · DB 고르기 …) 안에서 물어도 그 위 · 가림막(115) 아래 */
    z-index: 114;
    display: grid;
    place-items: center;
    padding: var(--space-4);
    background: rgb(0 0 0 / 0.3);
  }
  .modal {
    width: min(420px, 100%);
    max-height: calc(100vh - 32px);
    display: flex;
    flex-direction: column;
    overflow: hidden; /* 스크롤은 안쪽 `.glass-scroll`(theme.css) — 흐림 층이 밑동까지 덮게 */
    box-sizing: border-box;
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--line);
    border-radius: var(--radius-surface); /* 바깥 면(2026-10-25) */
    box-shadow: var(--shadow-raised);
    color: var(--fg-1);
  }

  .glass-scroll {
    padding: var(--space-4);
  }
  .modal.wide {
    width: min(520px, 100%);
  }
  h2 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    font-size: var(--t-md);
    font-weight: var(--fw-semibold);
  }
  .chip {
    flex: none;
    max-width: 50%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    padding: 1px var(--space-2);
    border-radius: 999px;
    background: var(--bg-chip);
    color: var(--fg-chip);
    font-size: var(--t-xs);
    font-weight: var(--fw-regular);
  }
  .icon {
    flex: none;
    width: 18px;
    height: 18px;
    fill: none;
    stroke: currentColor;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .icon.warning {
    color: var(--warn);
  }
  .icon.error {
    color: var(--err);
  }
  .body {
    margin: 0;
    font-size: var(--t-sm);
    line-height: 1.5;
    /* 부르는 쪽이 `\n` 으로 줄을 나눈다(목록 · 두 문장) */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .callout {
    margin: var(--space-3) 0 0;
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    background: var(--warn-soft);
    color: var(--fg-1);
    font-size: var(--t-sm);
    line-height: 1.5;
    overflow-wrap: anywhere;
  }
  .section {
    margin-top: var(--space-3);
  }
  .section p {
    margin: 0;
    overflow-wrap: anywhere;
  }
  .section-label {
    margin-bottom: 4px !important;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--fg-2);
  }
  .section-text {
    font-size: var(--t-sm);
    line-height: 1.5;
    color: var(--fg-2);
  }
  .actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
    margin-top: var(--space-4);
  }

  /* Destructive button pattern from src/lib/console/PlanList.svelte. */
  .btn.danger-solid {
    color: var(--err);
    background: var(--err-soft);
    font-weight: var(--fw-semibold);
  }
  .btn.danger-solid:hover {
    background: color-mix(in srgb, var(--err) 22%, var(--err-soft));
  }

  /* 모두 승인 확인(10-23 목업) — 따뜻한 테두리 · 주황 경고 그림 · 게이지 미리 보기 · 점 목록 · 「이해했습니다」 칸 · 주황 확인 단추 */
  .modal.yolo {
    border-color: var(--ai-all-line);
  }
  .modal.yolo .icon.warning {
    color: var(--ai-lv4);
  }
  .preview {
    display: flex;
    margin: 0 0 var(--space-3);
  }
  .points {
    margin: var(--space-3) 0 0;
    padding-left: 18px;
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--fg-2);
  }
  .points li + li {
    margin-top: 4px;
  }
  .ack {
    display: flex;
    align-items: flex-start;
    gap: var(--space-2);
    margin-top: var(--space-3);
    font-size: var(--t-sm);
    line-height: 1.45;
    cursor: pointer;
  }
  .ack input {
    flex: none;
    width: 16px;
    height: 16px;
    margin: 2px 0 0;
    accent-color: var(--ai-lv4);
  }
  .btn.yolo-solid {
    color: var(--ai-all-ink);
    background: var(--ai-all-soft);
    box-shadow: inset 0 0 0 1px var(--ai-all-line);
    font-weight: var(--fw-semibold);
  }
  .btn.yolo-solid:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ai-lv4) 24%, var(--surface-raised-solid));
  }
  .footnote {
    margin: var(--space-3) 0 0;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  /* 폰 · 태블릿(원격 웹 R5) — 손가락으로 누를 단추는 44px 높이 */
  @media (pointer: coarse) {
    .actions button {
      min-height: 44px;
      padding-inline: 18px;
    }
  }
</style>
