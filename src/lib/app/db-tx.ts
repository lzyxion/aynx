import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * 열린 트랜잭션이 있는 쿼리 타일 — 닫기 전에 묻는다. 닫으면 `db_close` 가 연결을 닫고 서버가 되돌린다(docs/log/2026-10-13-db-write-mcp-design.md).
 */
const open = new Map<string, number>();

/** `null` = 작업 없음(지운다) */
export function noteDbTx(paneId: string, statements: number | null): void {
  if (statements === null) open.delete(paneId);
  else open.set(paneId, statements);
}

export function hasOpenDbTx(paneId: string): boolean {
  return open.has(paneId);
}

export function dbTxPanes(paneIds: readonly string[]): string[] {
  return [...new Set(paneIds)].filter((id) => open.has(id));
}

/** 대화를 못 띄우면 닫지 않는다 — 묻지 못한 채 작업을 버리지 않는다 */
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
