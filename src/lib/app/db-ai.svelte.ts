import { dbAiAtLeast, dbAiNeedsConfirm, effectiveDbAi, effectiveDbHeadless, listDbAi, removeDbAi, setDbAi, type DbAiLevel, type DbAiView } from "$lib/db-ai";
import { confirmApproveAll } from "$lib/app/approve-all-confirm";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";

/** `delegation.toml` `[[database]]` 블록의 사본 — 신원 스냅샷 값 없이 `identityOk` 만 쥔다. */

let views = $state<DbAiView[]>([]);
let serverReady = $state(true);
let writePlans = $state(true);
let connTest = $state(true);

export function dbAiViews(): readonly DbAiView[] {
  return views;
}

export function dbAiViewOf(id: string): DbAiView | null {
  return views.find((v) => v.id === id) ?? null;
}

/** 블록이 없거나 스냅샷이 어긋났으면 `off` */
export function dbAiLevelOf(id: string): DbAiLevel {
  return effectiveDbAi(dbAiViewOf(id));
}

/** 블록이 없거나 스냅샷이 어긋났으면 `false` */
export function dbAiHeadlessOf(id: string): boolean {
  return effectiveDbHeadless(dbAiViewOf(id));
}

/** 붙은 세션 서버가 DB MCP 도구를 아는가(판 11) */
export function dbAiServerReady(): boolean {
  return serverReady;
}

/** 붙은 세션 서버가 AI 의 DB 쓰기 작업안을 아는가(판 12) */
export function dbAiWritePlans(): boolean {
  return writePlans;
}

/** 붙은 세션 서버가 [연결 테스트]를 아는가(판 28) */
export function dbConnTestReady(): boolean {
  return connTest;
}

export async function refreshDbAi(): Promise<void> {
  const r = await listDbAi();
  views = r.targets;
  serverReady = r.serverReady;
  writePlans = r.writePlans;
  connTest = r.connTest;
}

/** 성공 토스트는 없다(원격 타일의 호스트 AI 권한과 같게) — 실패와 "서버가 아직 모른다" 만 알린다 */
export async function setDbConnAi(conn: { id: string; name: string }, level: DbAiLevel): Promise<void> {
  const view = dbAiViewOf(conn.id);
  const current = effectiveDbAi(view);
  const broken = !!view && !view.identityOk;
  if (level === current && !broken) return;
  if (dbAiNeedsConfirm(current, level) && !(await confirmApproveAll("db", conn.name))) return;
  try {
    await setDbAi(conn.id, level);
    await refreshDbAi();
    if (!serverReady && level !== "off") showNotice(t("app.dbai.server.outdated"));
    else if (!writePlans && dbAiAtLeast(level, "approve")) showNotice(t("app.dbai.approve.restart"));
  } catch (e) {
    showNotice(t("pane.aiperm.failed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

export async function removeDbAiBlock(id: string): Promise<void> {
  await removeDbAi([id]);
  await refreshDbAi();
}
