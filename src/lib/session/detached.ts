// 떨어진 세션 목록의 모양과 순수 판정 — 목록 자체는 세션 서버가 쥐고 Rust 가 거른다(`detached_sessions`).

import { newLocalPane, newQueryPane, newSshPane } from "./factory";
import { shellLabel } from "./names";
import type { PaneSpec, Tr } from "./spec";

/** Rust `detached_sessions` 의 한 줄 */
export interface DetachedSession {
  stream: string;
  kind: "local" | "ssh" | "db";
  /** 마지막으로 붙어 있던 창 라벨(`main` · `ws-…` · `tear-N`) */
  home: string;
  homeOpen: boolean;
  /** epoch ms */
  detachedAt: number | null;
  lastOutputAt: number | null;
  openedAt: number;
  shell: string | null;
  alias: string | null;
  tmux: string | null;
  aiRead: boolean;
  /** 그 창의 복원이 끝났는데 데려가지 않았다 */
  unclaimed: boolean;
  /** 쿼리 타일(`db`)의 연결 id(`db-connections.json`) */
  conn: string | null;
  writable: boolean;
  /** 떨어진 지 10분이면 서버가 되돌린다 */
  inTx: boolean;
}

/** 쿼리 타일의 DB 연결 열쇠 머리(`query:<tileKey>` — `app/query` 의 `queryStreamOf`) */
export const QUERY_STREAM_PREFIX = "query:";

/** 모양이 아닌 줄은 버린다(옛 서버·깨진 응답) */
export function parseDetached(raw: unknown): DetachedSession[] {
  if (!Array.isArray(raw)) return [];
  const out: DetachedSession[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const o = r as Record<string, unknown>;
    if (typeof o.stream !== "string" || (o.kind !== "local" && o.kind !== "ssh" && o.kind !== "db")) continue;
    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const str = (v: unknown) => (typeof v === "string" && v !== "" ? v : null);
    // 쿼리 타일은 연결 id 와 `query:` 열쇠가 있어야 다시 붙일 수 있다.
    if (o.kind === "db" && (typeof o.conn !== "string" || o.conn === "" || !o.stream.startsWith(QUERY_STREAM_PREFIX))) continue;
    out.push({
      stream: o.stream,
      kind: o.kind,
      home: typeof o.home === "string" ? o.home : "",
      homeOpen: o.homeOpen === true,
      detachedAt: num(o.detachedAt),
      lastOutputAt: num(o.lastOutputAt),
      openedAt: num(o.openedAt) ?? 0,
      shell: str(o.shell),
      alias: str(o.alias),
      tmux: str(o.tmux),
      aiRead: o.aiRead === true,
      unclaimed: o.unclaimed === true,
      conn: str(o.conn),
      writable: o.writable === true,
      inTx: o.inTx === true,
    });
  }
  return sortDetached(out);
}

/** Rust 와 같은 순서를 다시 굳힌다 */
export function sortDetached(list: readonly DetachedSession[]): DetachedSession[] {
  return [...list].sort((a, b) => {
    const at = a.detachedAt ?? -1;
    const bt = b.detachedAt ?? -1;
    if (at !== bt) return bt - at;
    return a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : 0;
  });
}

export function detachedName(s: DetachedSession, tr: Tr, dbName?: (connId: string) => string | null): string {
  if (s.kind === "local") return shellLabel(s.shell ?? undefined, tr);
  if (s.kind === "db") return (s.conn && dbName?.(s.conn)) || s.conn || tr("app.detached.window.unknown");
  const alias = s.alias ?? tr("app.detached.unknownHost");
  return s.tmux ? `${alias} · ${s.tmux}` : alias;
}

export function detachedWindowName(home: string, tr: Tr): string {
  if (home === "main") return tr("app.detached.window.main");
  if (home.startsWith("tear-")) return tr("app.detached.window.tear", { label: home });
  return home || tr("app.detached.window.unknown");
}

/** 그 종류의 새 타일에 스트림만 그 세션의 것을 단다 — 첫 열기가 떨어진 세션에 붙는다(새 셸을 열지 않는다) */
export function paneForDetached(s: DetachedSession, dbName?: string | null): PaneSpec {
  if (s.kind === "db") {
    // 같은 `tileKey` 면 첫 열기(`db_open` 의 `reattachOnly`)가 서버의 같은 DB 연결에 다시 붙는다(비밀번호를 묻지 않는다).
    const pane = newQueryPane({ connId: s.conn ?? "", name: dbName ?? undefined });
    pane.tileKey = s.stream.slice(QUERY_STREAM_PREFIX.length);
    return pane;
  }
  const shell = s.shell ?? undefined;
  const pane = s.kind === "local" ? newLocalPane(shell) : newSshPane(s.alias ?? "");
  if (s.kind === "ssh" && s.tmux) pane.tmux = s.tmux;
  pane.historyStreamId = s.stream;
  return pane;
}

/** 번호를 뽑지 않는 최소 명세 — 그리기마다 [`paneForDetached`] 를 부르면 타일 번호가 헛돈다 */
export function iconPaneForDetached(s: DetachedSession): PaneSpec {
  const id = `detached:${s.stream}`;
  if (s.kind === "db") return { id, kind: "query", query: { connId: s.conn ?? "" } };
  if (s.kind === "ssh") return { id, kind: "ssh", alias: s.alias ?? "" };
  return { id, kind: "local", ...(s.shell ? { shell: s.shell } : {}) };
}

export function detachedDbStatus(s: DetachedSession, aiName: string | null, tr: Tr): string {
  const parts = [s.writable ? tr("app.detached.db.write") : tr("app.detached.db.readOnly")];
  if (s.writable && s.inTx) parts.push(tr("app.detached.db.tx"));
  if (aiName) parts.push(`AI ${aiName}`);
  return parts.join(" · ");
}
