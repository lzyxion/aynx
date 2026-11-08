<script lang="ts">
  import { baseNameOf } from "$lib/fs-backend";
  import { formatSize } from "$lib/sftp-browser";
  import { t } from "$lib/i18n/i18n.svelte.js";
  import type { Conflict, OnConflict } from "$lib/fs-ops";
  import type { TransferJob } from "$lib/browser/fs-transfer.svelte";

  /**
   * **전송 한 줄과 충돌 확인** — 목록 아래에 붙는 얇은 띠, 그리고 그 위를 덮는 대화상자.
   *
   * 셋이 **같은 자리**를 나눠 쓴다 (드래그 힌트 · 진행률 · 없음). 동시에 뜨는 일이 없으므로
   * 한 컴포넌트가 셋의 순서를 들고 있는 편이, 타일 본문에 조건 세 개가 흩어져 있는 것보다
   * 무엇이 언제 보이는지 읽기 쉽다.
   */
  let {
    job,
    percent,
    /** 충돌 대화상자의 내용 (없으면 안 뜬다) */
    pending,
    /** 드래그 중의 힌트 한 줄 — 전송 막대와 같은 자리다 */
    hint = null,
    oncancel,
    onresolve,
    ondismiss,
  }: {
    job: TransferJob | null;
    percent: number;
    pending: { conflicts: Conflict[] } | null;
    hint?: string | null;
    oncancel: () => void;
    onresolve: (policy: OnConflict) => void;
    ondismiss: () => void;
  } = $props();

  /** 충돌 목록 한 줄 — 셋까지는 이름을 적고, 넘치면 "외 N개" 를 **한 문장 안에서** 잇는다 */
  const conflictNames = $derived(
    pending
      ? pending.conflicts
          .slice(0, 3)
          .map((c) => baseNameOf(c.path))
          .join(", ")
      : "",
  );
</script>

{#if hint}
  <div class="hint">{hint}</div>
{/if}

<!--
  전송 하나 — 아래에 붙는 얇은 줄. [취소] 는 **취소할 수 있는 전송에만** 붙는다
  (`job.op === 0` 이면 같은 곳 안의 이동이라 멈출 청크 경계가 없다).
-->
{#if job}
  <div class="transfer">
    <span class="tr-name" title={job.current}>
      {t(job.labelKey)}{job.filesTotal > 0 ? ` ${job.filesDone}/${job.filesTotal}` : ""}
    </span>
    <div class="tr-bar"><div class="tr-fill" style:width={`${percent}%`}></div></div>
    <span class="tr-num">
      {formatSize(job.bytesDone)}{job.bytesTotal > 0
        ? ` / ${formatSize(job.bytesTotal)} · ${percent}%`
        : ""}
    </span>
    {#if job.op !== 0}
      <button type="button" class="tr-cancel btn btn-sm btn-ghost" disabled={job.canceling} onclick={oncancel}>
        {job.canceling ? t("files.transfer.canceling") : t("files.transfer.cancel")}
      </button>
    {/if}
  </div>
{/if}

<!--
  충돌 확인 — 붙여넣기·드롭 **전에** 한 번만 묻는다 (최상위 이름들만 보므로 질문도 하나다).
  타일 안에 갇힌 오버레이라(`.sftp` 가 좌표 원점), 타일이 여럿이면 각자 자기 것만 묻는다.
-->
{#if pending}
  <div class="dialog-veil" role="presentation">
    <div class="dialog glass-raised" role="dialog" aria-modal="true" aria-label={t("files.transfer.conflict.aria")}>
      <div class="dialog-title">
        {pending.conflicts.length === 1
          ? t("files.transfer.conflict.title.one")
          : t("files.transfer.conflict.title.other", { count: pending.conflicts.length })}
      </div>
      <div class="dialog-body">
        {pending.conflicts.length > 3
          ? t("files.transfer.conflict.more", {
              names: conflictNames,
              count: pending.conflicts.length - 3,
            })
          : conflictNames}
      </div>
      <div class="dialog-row">
        <button type="button" class="dlg-btn btn btn-sm btn-ghost" onclick={ondismiss}>{t("files.transfer.cancel")}</button>
        <button type="button" class="dlg-btn btn btn-sm btn-secondary" onclick={() => onresolve("skip")}>
          {t("files.transfer.conflict.skip")}
        </button>
        <button type="button" class="dlg-btn btn btn-sm btn-secondary" onclick={() => onresolve("rename")}>
          {t("files.transfer.conflict.rename")}
        </button>
        <button type="button" class="dlg-btn danger btn btn-sm" onclick={() => onresolve("overwrite")}>
          {t("files.transfer.conflict.overwrite")}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  /* 전송 한 줄 — 목록 아래에 붙어 진행률만 말한다 */
  .transfer {
    display: flex;
    align-items: center;
    gap: 8px;
    flex: 0 0 auto;
    padding: 5px 10px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg-muted);
  }

  /* 드래그 힌트 — 전송 막대와 같은 자리·같은 결로, 한 줄 넘지 않게 */
  .hint {
    flex: 0 0 auto;
    padding: 4px 10px;
    border-top: 1px solid var(--border);
    font-size: 11px;
    color: var(--fg-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .tr-name {
    flex: 0 1 auto;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--fg);
  }

  /*
    진행 막대 — 중성이다: `--surface-hover` 홈에 `--fg-2` 채움 (docs/log/2026-09-25-leftovers-menus-dots.md).
    진행은 강조색 셋 — 선택된 행 · 화면당 하나인 주 동작 · 입력 대기 — 어디에도 들지 않고,
    바로 옆 [취소]가 이 줄의 유일한 행동이다. 강조색 막대는 "누르라" 로 읽혔다.
  */
  .tr-bar {
    flex: 1 1 auto;
    height: 4px;
    background: var(--surface-hover);
    border-radius: 2px;
    overflow: hidden;
  }

  .tr-fill {
    height: 100%;
    background: var(--fg-2);
    transition: width 120ms linear;
  }

  .tr-num {
    flex: 0 0 auto;
    font-family: var(--font-mono);
    font-size: 10px;
    white-space: nowrap;
  }

  /* 취소 — 모양은 전역 `.btn .btn-sm .btn-ghost` (옛 선 두른 단추는 지웠다) */
  .tr-cancel {
    flex: 0 0 auto;
  }

  /* ── 충돌 확인 대화상자 ──────────────────────────────────────────────────── */

  /* 타일 안에 갇힌 오버레이 — 뒤를 살짝 덮어 지금 답해야 할 것이 하나라고 말한다 */
  .dialog-veil {
    position: absolute;
    inset: 0;
    z-index: 30;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
    background: rgb(0 0 0 / 35%);
  }

  .dialog {
    max-width: 320px;
    padding: 10px 12px;
    /* 대화 상자 등급의 뜬 면(10-29 — `term/PasteConfirm` 과 같은 수): 평면은 불투명, 글래스는 `.glass-raised` 의 흐림 ·
       흰 선. 글래스의 파일 타일은 이미 흐린 판(`.glass-tile`)이지만 대화 상자는 독 위 모달처럼 제 등급을 따로 진다 */
    background: var(--glass-raised, var(--surface-raised-solid));
    border: 1px solid var(--border);
    border-radius: var(--radius-surface);
    box-shadow: var(--shadow-modal);
  }

  .dialog-title {
    font-family: var(--font-ui);
    font-size: 12px;
    font-weight: 600;
    color: var(--fg);
  }

  .dialog-body {
    margin: 6px 0 10px;
    font-family: var(--font-ui);
    font-size: 11px;
    line-height: 1.4;
    color: var(--fg-muted);
    overflow-wrap: anywhere;
  }

  /* 네 갈래가 한 줄에 다 서지 않으면 감싼다 (타일이 좁을 수 있다) */
  .dialog-row {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    gap: var(--space-2);
  }

  /*
   * 단추 — 전역 `.btn .btn-sm` (메뉴의 `.ctx-btn` 과 같은 처방, docs/log/2026-09-25-finish-menus.md):
   * 취소 = 고스트, 건너뛰기·이름 바꾸기 = 보조, 덮어쓰기(되돌릴 수 없음) = 채운 `--err`.
   * `dlg-btn` 은 표식으로만 남는다.
   */
  .dlg-btn.danger {
    color: var(--on-accent);
    background: var(--err);
    font-weight: var(--fw-semibold);
  }

  .dlg-btn.danger:hover {
    background: color-mix(in srgb, var(--err) 88%, var(--fg));
  }
</style>
