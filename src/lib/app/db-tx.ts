import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **열린 트랜잭션 작업이 있는 쿼리 타일** — 닫기 전에 한 번 묻는다(쿼리 타일 1단계 — 10-13 결정,
 * docs/log/2026-10-13-db-write-mcp-design.md).
 *
 * 쿼리 타일(`QueryView`)이 작업이 열리면 제 타일 id 를 적고(`noteDbTx`), 끝나거나 사라지면 지운다. 닫기의 길(타일 닫기 · 탭 닫기 ·
 * 보조 창 닫기 — `app/tabs` · `app/boot`)이 저장 안 한 문서의 물음(`unsaved-docs`)과 나란히 여기를 본다.
 *
 * - [되돌리고 닫기] — 닫는다. 타일이 사라지며 `db_close` 가 연결을 닫고, 닫힌 연결의 열린 트랜잭션은 **서버가 되돌린다**.
 * - [취소] · 대화를 × 로 닫음 · 대화를 못 띄움 — 닫지 않는다(묻지 못한 채 작업을 버리지 않는다).
 * - 묻지 않는 길: 페이지 리로드 · 크래시 · 메인 창 닫기(트레이로 남음) · GUI 종료 — 연결이 떼어지고 작업은 서버에 그대로 남는다
 *   (방치 시계는 계속 흐른다). 다른 창으로 옮기기(이관)도 작업이 따라간다. 트레이 [모든 세션 종료]는 묻지 않고 되돌린다.
 *
 * 탭 모듈을 가져오지 않는다(그쪽이 이것을 부른다 — 순환을 만들지 않게).
 */
const open = new Map<string, number>();

/** 이 타일의 작업 — 열려 있으면 문장 수, 아니면 `null`(지운다) */
export function noteDbTx(paneId: string, statements: number | null): void {
  if (statements === null) open.delete(paneId);
  else open.set(paneId, statements);
}

/** 이 타일에 열린 작업이 있는가 */
export function hasOpenDbTx(paneId: string): boolean {
  return open.has(paneId);
}

/** `paneIds` 중 열린 작업이 있는 것 */
export function dbTxPanes(paneIds: readonly string[]): string[] {
  return [...new Set(paneIds)].filter((id) => open.has(id));
}

/** 닫기 전 물음 — 닫아도 되면 `true`. 열린 작업이 없으면 묻지 않는다 */
export async function confirmDbTxClose(paneIds: readonly string[], nameOf: (paneId: string) => string): Promise<boolean> {
  const ids = dbTxPanes(paneIds);
  if (ids.length === 0) return true;
  const names = ids.map(nameOf).filter((n) => n !== "");
  const body = [t("app.dbTx.close.body", { count: ids.length }), "", ...names.map((n) => `· ${n}`)].join("\n").trimEnd();
  try {
    return await askConfirm(body, {
      title: t("app.dbTx.close.title"),
      kind: "warning",
      okLabel: t("app.dbTx.close.ok"),
      cancelLabel: t("app.dbTx.close.cancel"),
      danger: true,
    });
  } catch {
    showNotice(t("app.dbTx.close.noDialog"));
    return false;
  }
}
