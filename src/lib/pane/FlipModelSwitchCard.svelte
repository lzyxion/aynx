<script lang="ts">
  /**
   * **Claude 의 모델 · Effort 전환 확인 카드**(2026-11-14 — 목업 E5 · 판정 `pane/flip-model-ack.ts` 의 `claudeSwitchAsk`). 그 타일 TUI 에 "Switch model?"
   * · "Change effort level?" 확인이 떠 있는 동안 AI 타일 대화 면의 대화 끝(권한 카드와 같은 자리 · 같은 판 — `TilePermissionCard` 의 `.perm`)에 선다.
   * [전환] · [취소] 는 부르는 쪽(`AiFlip`)이 TUI 에 **고정 키**(`SWITCH_YES_KEY` · `SWITCH_NO_KEY`)를 사람 입력 문으로 보낸다 — 이 카드는 누름만 알린다.
   * 제목의 이름은 화면 글자에서 읽은 **표시용**이다(보내는 키에 실리지 않는다 — 불변식 4).
   */
  import { t } from "$lib/i18n/i18n.svelte.js";
  import UiIcon from "$lib/UiIcon.svelte";
  import { effortName } from "$lib/chat/side-chat-controls.svelte";

  let {
    kind = "model",
    name,
    phone = false,
    onyes,
    onno,
  }: {
    /** 무엇을 바꾸는 확인인가 */
    kind?: "model" | "effort";
    /** 화면에서 읽은 대상 이름(모델 이름 · Effort 단계 — 표시용 · 모르면 빈 글) */
    name: string;
    phone?: boolean;
    onyes: () => void;
    onno: () => void;
  } = $props();

  const title = $derived(
    kind === "effort"
      ? name
        ? t("pane.flip.switch.titleEffort", { e: name === "auto" ? t("app.chatDock.cliDefault") : effortName(name) })
        : t("pane.flip.switch.titleEffortBare")
      : name
        ? t("pane.flip.switch.title", { model: name })
        : t("pane.flip.switch.titleBare"),
  );
</script>

<div class="perm" class:phone role="group" aria-label={title} data-flip-model-switch>
  <div class="perm-head">
    <UiIcon name="sync" size={16} />
    <span class="perm-title" data-flip-model-switch-title>{title}</span>
  </div>
  <div class="perm-desc">{t(kind === "effort" ? "pane.flip.switch.bodyEffort" : "pane.flip.switch.body")}</div>
  <div class="perm-actions">
    <button type="button" class="btn btn-primary btn-sm" data-flip-model-switch-yes onclick={onyes}>{t("pane.flip.switch.yes")}</button>
    <button type="button" class="btn btn-secondary btn-sm" data-flip-model-switch-no onclick={onno}>{t("pane.flip.switch.no")}</button>
  </div>
</div>

<style>
  /* 타일 권한 카드(`TilePermissionCard` 의 `.perm`)와 같은 판 — 기다리는 동안 경고색 테두리 */
  .perm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    color: var(--fg-1);
    background: var(--surface-field);
    border: 1px solid color-mix(in srgb, var(--warn) 55%, var(--line-strong));
    border-radius: 10px;
    flex: none;
  }

  .perm-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-semibold);
  }

  .perm-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .perm-desc {
    color: var(--fg-2);
    line-height: 1.6;
    overflow-wrap: anywhere;
  }

  .perm-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-1);
  }

  /* 글 너비대로(목업 E5) — 좌우 여백을 넉넉히 · 폰에서도 원이 되지 않게 */
  .perm-actions .btn {
    min-width: 72px;
    padding-inline: var(--space-4);
    justify-content: center;
  }

  .perm.phone .perm-actions .btn {
    min-height: 40px;
  }

  @media (pointer: coarse) {
    .perm-actions .btn {
      min-height: 40px;
    }
  }
</style>
