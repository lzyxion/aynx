// `db-connections.json` 의 사본 — 이 파일은 가볍게 둔다: 호스트 쪽(`app/host-remove` · `app/host-rename`)도 들여온다.
import * as vault from "$lib/vault";
import { stripReason } from "$lib/error-reason";
import { connsVia, type DbConn } from "$lib/db-conn";
import { dbConnList, dbConnSave, errorMessage } from "$lib/query/query-backend";
import { removeFavorite } from "$lib/favorites.svelte.js";

let conns = $state<DbConn[]>([]);
let warnings = $state<string[]>([]);
let loaded = false;
let loading: Promise<void> | null = null;

export function dbConns(): DbConn[] {
  return conns;
}

export function dbConnWarnings(): string[] {
  return warnings;
}

export function findDbConn(id: string): DbConn | null {
  return conns.find((d) => d.id === id) ?? null;
}

export function dbConnsVia(host: string): DbConn[] {
  return connsVia(conns, host);
}

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

export function ensureDbConns(): Promise<void> {
  return loaded ? Promise.resolve() : reloadDbConns();
}

export async function saveDbConns(list: DbConn[]): Promise<void> {
  conns = await dbConnSave(list);
}

/** 볼트 비밀번호는 저장이 선 뒤에 걷는다 */
export async function removeDbConn(id: string): Promise<void> {
  await saveDbConns(conns.filter((d) => d.id !== id));
  forgetDbFavorites([id]);
  await forgetDbPasswords([id]);
}

/** 연결 id 는 다시 뽑히지 않아 남겨 두면 즐겨찾기 열 칸 중 하나를 보이지 않게 차지한다 — 저장에서도 뺀다 */
export function forgetDbFavorites(ids: readonly string[]): void {
  for (const id of ids) removeFavorite({ kind: "db", id });
}

const pwListeners = new Set<() => void>();

export function onDbPasswordsChanged(fn: () => void): () => void {
  pwListeners.add(fn);
  return () => pwListeners.delete(fn);
}

export function dbPasswordsChanged(): void {
  for (const f of pwListeners) f();
}

/** 볼트가 잠겨 있으면 걷지 못한 채 넘긴다 — 그 id 는 다시 뽑히지 않고 설정 › 보안에서 손으로 지울 수 있다 */
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
