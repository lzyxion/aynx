// **떨어진 세션 목록**의 모양과 순수 판정 — 아무 창도 데려가지 않은 세션(설계 4.5 · ③-4).
//
// 목록 자체는 세션 서버가 쥐고 Rust 가 거른다(`detached_sessions` — Detached 이고 (복원이 데려가지 않았거나 ·
// 마지막 창이 지금 없다)). 여기 있는 것은 그 줄을 **어떻게 그리고 어떤 타일로 다시 붙일지**뿐이다(시험 대상).
//
// 쿼리 타일(`kind: "db"` — 2026-11-09 ②)도 창이 사라지면 같은 목록에 남는다(세션 서버의 DB 연결 표 · 열쇠 `query:<tileKey>`).
// 이름 · AI 권한은 화면이 제 사본(DB 연결 목록 · AI 권한)에서 연결 id 로 푼다.

import { newLocalPane, newQueryPane, newSshPane } from "./factory";
import { shellLabel } from "./names";
import type { PaneSpec, Tr } from "./spec";

/** Rust `detached_sessions` 의 한 줄 */
export interface DetachedSession {
  stream: string;
  kind: "local" | "ssh" | "db";
  /** 마지막으로 붙어 있던 창 라벨(`main` · `ws-…` · `tear-N`) */
  home: string;
  /** 그 창이 지금 열려 있는가 */
  homeOpen: boolean;
  /** 떨어진 시각(epoch ms) — 모르면 `null` */
  detachedAt: number | null;
  /** 마지막 출력 시각(epoch ms) — 출력이 없었으면 `null` */
  lastOutputAt: number | null;
  openedAt: number;
  /** 로컬 셸 id */
  shell: string | null;
  /** SSH 호스트 별칭 */
  alias: string | null;
  tmux: string | null;
  aiRead: boolean;
  /** 그 창의 복원이 끝났는데 데려가지 않았다 */
  unclaimed: boolean;
  /** 쿼리 타일(`db`)의 연결 id(`db-connections.json`) — 다른 종류는 `null` */
  conn: string | null;
  /** 쿼리 타일의 쓰기 모드 */
  writable: boolean;
  /** 쿼리 타일에 열린 트랜잭션 작업이 있다(떨어진 지 10분이면 서버가 되돌린다) */
  inTx: boolean;
}

/** 쿼리 타일의 DB 연결 열쇠 머리(`query:<tileKey>` — `app/query` 의 `queryStreamOf`) */
export const QUERY_STREAM_PREFIX = "query:";
// (오케스트레이션 3차 3b) 작업자 세션 표지(`orchestration` 칸 · 작업자 스트림 판정)는 걷었다 — 작업자는 헤드리스 턴(프로세스)이라 세션 ·
// 타일이 없다(docs/log/2026-10-16-orchestration-headless-design.md 6-2).

/** 받은 값을 믿을 만한 줄로 거른다 — 모양이 아닌 줄은 버린다(옛 서버·깨진 응답) */
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

/** 최근에 떨어진 것부터(모르는 시각은 맨 뒤), 같으면 스트림 순 — Rust 와 같은 순서를 다시 굳힌다 */
export function sortDetached(list: readonly DetachedSession[]): DetachedSession[] {
  return [...list].sort((a, b) => {
    const at = a.detachedAt ?? -1;
    const bt = b.detachedAt ?? -1;
    if (at !== bt) return bt - at;
    return a.stream < b.stream ? -1 : a.stream > b.stream ? 1 : 0;
  });
}

/** 줄의 이름 — 로컬은 셸 이름, SSH 는 별칭(tmux 면 `별칭 · tmux 이름`), DB 는 연결 이름(`dbName` — 모르면 연결 id) */
export function detachedName(s: DetachedSession, tr: Tr, dbName?: (connId: string) => string | null): string {
  if (s.kind === "local") return shellLabel(s.shell ?? undefined, tr);
  if (s.kind === "db") return (s.conn && dbName?.(s.conn)) || s.conn || tr("app.detached.window.unknown");
  const alias = s.alias ?? tr("app.detached.unknownHost");
  return s.tmux ? `${alias} · ${s.tmux}` : alias;
}

/** 마지막 창의 이름 — 주 창은 말로, 나머지는 라벨 그대로 */
export function detachedWindowName(home: string, tr: Tr): string {
  if (home === "main") return tr("app.detached.window.main");
  if (home.startsWith("tear-")) return tr("app.detached.window.tear", { label: home });
  return home || tr("app.detached.window.unknown");
}

/**
 * [새 탭에 붙이기] 의 타일 — 그 종류의 새 타일을 만들고 **스트림만 그 세션의 것으로** 바꾼다. 터미널의 첫 열기가
 * 이 스트림을 살펴(`probe_session`) 떨어진 세션에 붙는다(`attachDetached`) — 새 셸을 열지 않는다.
 */
export function paneForDetached(s: DetachedSession, dbName?: string | null): PaneSpec {
  if (s.kind === "db") {
    // 쿼리 타일 — 같은 `tileKey` 면 첫 열기(`db_open` 의 `reattachOnly`)가 서버의 같은 DB 연결에 다시 붙는다(비밀번호를 묻지 않는다).
    // 화면용 이름(`dbName` — 부르는 쪽이 연결 목록에서 찾는다)을 실어야 탭 제목이 연결 id 가 아니라 이름이 된다.
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

/**
 * 줄 앞 아이콘의 타일 — `PaneIcon` 이 그림만 고르게 하는 최소 명세(번호를 뽑지 않는다 — 그리기마다 [`paneForDetached`] 를 부르면 타일
 * 번호가 헛돈다).
 */
export function iconPaneForDetached(s: DetachedSession): PaneSpec {
  const id = `detached:${s.stream}`;
  if (s.kind === "db") return { id, kind: "query", query: { connId: s.conn ?? "" } };
  if (s.kind === "ssh") return { id, kind: "ssh", alias: s.alias ?? "" };
  return { id, kind: "local", ...(s.shell ? { shell: s.shell } : {}) };
}

/**
 * DB 줄의 짧은 상태 — `읽기 전용` · `쓰기` · `쓰기 · 트랜잭션 열림` 에 AI 권한(`aiName` — 끔이면 `null`)을 잇는다(예: `읽기 전용 · AI Read`).
 */
export function detachedDbStatus(s: DetachedSession, aiName: string | null, tr: Tr): string {
  const parts = [s.writable ? tr("app.detached.db.write") : tr("app.detached.db.readOnly")];
  if (s.writable && s.inTx) parts.push(tr("app.detached.db.tx"));
  if (aiName) parts.push(`AI ${aiName}`);
  return parts.join(" · ");
}
