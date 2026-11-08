import { dbAiAtLeast, dbAiNeedsConfirm, effectiveDbAi, listDbAi, removeDbAi, setDbAi, type DbAiLevel, type DbAiView } from "$lib/db-ai";
import { confirmApproveAll } from "$lib/app/approve-all-confirm";
import { showNotice } from "$lib/app/notice";
import { t } from "$lib/i18n/i18n.svelte.js";

/**
 * **앱이 들고 있는 DB AI 권한 사본**(쿼리 타일 3단계 3a) — `delegation.toml` `[[database]]` 블록들(스냅샷 값 없이 `identityOk` 만)과
 * 붙은 세션 서버의 판(`serverReady`). 읽는 자리(DB 연결 폼의 AI 칸 · 설정 › 보안의 표)가 동기라 사본으로 쥔다.
 *
 * 갱신은 폼 · 설정이 열릴 때와 Rust 의 `delegation-changed` 방송(`app/delegation.svelte.ts` 의 듣기가 함께 부른다)이다.
 */

let views = $state<DbAiView[]>([]);
let serverReady = $state(true);
let writePlans = $state(true);

/** 블록 전부(파일 순서) */
export function dbAiViews(): readonly DbAiView[] {
  return views;
}

/** 이 연결의 블록(없으면 `null`) */
export function dbAiViewOf(id: string): DbAiView | null {
  return views.find((v) => v.id === id) ?? null;
}

/** 이 연결에 실제로 걸린 단계 — 블록이 없거나 스냅샷이 어긋났으면 `off` */
export function dbAiLevelOf(id: string): DbAiLevel {
  return effectiveDbAi(dbAiViewOf(id));
}

/** 붙은 세션 서버가 DB MCP 도구를 아는가(판 11) */
export function dbAiServerReady(): boolean {
  return serverReady;
}

/** 붙은 세션 서버가 AI 의 DB 쓰기 작업안을 아는가(판 12 — 3b) */
export function dbAiWritePlans(): boolean {
  return writePlans;
}

/** 다시 읽는다 — 실패는 `listDbAi` 가 삼킨다 */
export async function refreshDbAi(): Promise<void> {
  const r = await listDbAi();
  views = r.targets;
  serverReady = r.serverReady;
  writePlans = r.writePlans;
}

/**
 * **쿼리 타일 머리줄 AI 권한 칩의 단계 고르기**(10-14) — 연결 하나의 단계를 **바로** 바꾼다(3a 의 Tauri 명령 `db_ai_set` 그대로 — 신원
 * 스냅샷은 Rust 가 지금 연결로 계산해 함께 적는다). 확인 대화는 띄우지 않는다(10-15 — 행이 모델 제공자로 간다는 경고는 팝오버의 단계 줄
 * 설명에 있다). 같은 단계를 다시 고르면 — 블록이 풀려 있으면(대상이 바뀜) 새 대상으로 다시 적고, 아니면 아무것도 하지 않는다. 사람이 시킨
 * 일이라 실패는 알린다.
 *
 * **성공 토스트는 없다**(10-15 — 원격 타일의 호스트 AI 권한과 같게): 칩 · 팝오버의 단계 줄이 바뀐 상태를 곧바로 보인다. 실패와
 * "서버가 아직 모른다"(판 낮은 서버 · 쓰기 작업안 미지원)만 알린다 — 실패 문구 · 통로는 원격 팝오버(`pane/ai-perm-menu` 의
 * `pickStage`)와 같은 `showNotice(pane.aiperm.failed)`.
 */
export async function setDbConnAi(conn: { id: string; name: string }, level: DbAiLevel): Promise<void> {
  const view = dbAiViewOf(conn.id);
  const current = effectiveDbAi(view);
  const broken = !!view && !view.identityOk;
  if (level === current && !broken) return;
  // 모두 승인으로 새로 올리면 확인 상자가 먼저 선다(10-23 — 그 밖의 단계는 예전처럼 바로 바꾼다).
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

/** 설정 › 보안 표의 [제거] — 지우고 다시 읽는다(오류는 던진다 — 사람이 누른 일) */
export async function removeDbAiBlock(id: string): Promise<void> {
  await removeDbAi([id]);
  await refreshDbAi();
}
