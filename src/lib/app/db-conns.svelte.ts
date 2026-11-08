// **DB 연결 목록의 사본** — `db-connections.json` 하나(경유 · 직접 — 10-13 저장 하나로, docs/log/2026-10-12-query-tile.md).
//
// 독 DB 칸 · 고르기 모달 · 쿼리 타일 이름 · 호스트 우클릭 "DB 열기 ›" · 호스트 삭제 확인의 개수 · 설정 › 보안의 라벨이 **같은
// 사본**을 본다. 저장은 목록 통째(`db_conn_save` — 비밀이 없어 GUI 가 파일을 직접, 서버는 열 때 파일에서 다시 읽는다).
// 호스트 이름 변경 · 삭제는 Rust 명령(`edit_host` · `remove_host`)이 파일의 경유를 이미 고쳤다 — 여기서는 사본을 다시 읽고,
// 삭제면 사라진 연결의 볼트 비밀번호를 걷는다(`forgetDbPasswords`) — 즐겨찾기 칸도 함께 뺀다(`forgetDbFavorites`).
//
// 이 파일은 가볍게 둔다(백엔드 계약 · 볼트 · 문구 떼기만) — 호스트 쪽(`app/host-remove` · `app/host-rename`)도 들여온다.
import * as vault from "$lib/vault";
import { stripReason } from "$lib/error-reason";
import { connsVia, type DbConn } from "$lib/db-conn";
import { dbConnList, dbConnSave, errorMessage } from "$lib/query/query-backend";
import { removeFavorite } from "$lib/favorites.svelte.js";

let conns = $state<DbConn[]>([]);
let warnings = $state<string[]>([]);
let loaded = false;
let loading: Promise<void> | null = null;

/** 지금 아는 목록(파일 순서) */
export function dbConns(): DbConn[] {
  return conns;
}

/** 읽기 경고(뺀 줄마다 한 줄 · 읽기 실패 한 줄) */
export function dbConnWarnings(): string[] {
  return warnings;
}

/** id 로 하나 */
export function findDbConn(id: string): DbConn | null {
  return conns.find((d) => d.id === id) ?? null;
}

/** 이 호스트를 경유하는 연결들 — 지금 사본에서(호스트 우클릭 · 삭제 확인) */
export function dbConnsVia(host: string): DbConn[] {
  return connsVia(conns, host);
}

/** 파일에서 다시 읽는다(읽기 실패는 경고 한 줄 — 목록은 비운다) */
export function reloadDbConns(): Promise<void> {
  loading ??= dbConnList()
    .then(
      (r) => {
        conns = r.conns;
        warnings = r.warnings;
      },
      (e: unknown) => {
        conns = [];
        warnings = [stripReason(errorMessage(e))];
      },
    )
    .finally(() => {
      loaded = true;
      loading = null;
    });
  return loading;
}

/** 한 번도 안 읽었으면 읽는다 */
export function ensureDbConns(): Promise<void> {
  return loaded ? Promise.resolve() : reloadDbConns();
}

/** 목록 통째로 저장한다(던진다 — 서버 검증 문구 그대로) · 사본은 다듬은 목록으로 */
export async function saveDbConns(list: DbConn[]): Promise<void> {
  conns = await dbConnSave(list);
}

/**
 * 연결 하나를 지운다(던진다) — 저장이 선 **뒤에** 볼트의 그 비밀번호도 걷는다(열려 있을 때만, 실패는 조용히). 독의 삭제 · 고르기
 * 모달의 삭제가 함께 쓴다.
 */
export async function removeDbConn(id: string): Promise<void> {
  await saveDbConns(conns.filter((d) => d.id !== id));
  forgetDbFavorites([id]);
  await forgetDbPasswords([id]);
}

/**
 * 사라진 DB 연결을 가리키던 즐겨찾기 칸을 뺀다(없던 것은 그대로 — `removeFavorite` 가 같은 목록이면 저장하지 않는다). 그리기 단계도
 * 못 찾은 칸은 빼지만(`resolveFavorites`) 호스트와 달리 연결 id 는 다시 뽑히지 않아 돌아올 일이 없다 — 남겨 두면 열 칸 중 하나를
 * 보이지 않게 차지한다. 그래서 호스트 제거 팬아웃(`app/host-remove.ts`)처럼 저장에서도 뺀다. 볼트 걷기와 달리 볼트 상태와 무관하다.
 */
export function forgetDbFavorites(ids: readonly string[]): void {
  for (const id of ids) removeFavorite({ kind: "db", id });
}

/**
 * 사라진 DB 연결의 볼트 항목을 걷는다(멱등 — 없던 것도 성공). **실패는 조용히 넘긴다**: 볼트가 없거나 잠겨 있으면 걷지 못한
 * 항목이 남는데, 그 id 는 파일에서 이미 사라져 아무 연결도 그 값을 쓰지 않고(id 는 다시 뽑히지 않는다), 설정 › 보안 목록에서
 * 손으로 지울 수 있다. 호스트 제거의 다른 팬아웃 걸음과 같은 무게다.
 */
export async function forgetDbPasswords(ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const st = await vault.status().catch(() => null);
  if (st?.state !== "unlocked") return;
  for (const id of ids) {
    try {
      await vault.remove("db_password", id);
    } catch (e) {
      console.warn("[aynx] DB 비밀번호를 볼트에서 지우지 못했습니다:", id, e);
    }
  }
}
