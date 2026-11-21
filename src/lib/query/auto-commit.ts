/**
 * 쿼리 타일의 자동 커밋 토글 · Ctrl+Enter 의 갈래(docs/log/2026-10-13-db-write-mcp-design.md "자동 커밋 · 세이브포인트 메모").
 *
 * - 값은 세션 서버가 쥐고 화면은 저장하지 않는다 — F5 뒤 화면이 기본값(켬)으로 돌아가면 끈 줄 알고 친 문장이 곧바로 커밋된다.
 * - 작업이 열려 있으면 바꾸지 않는다 — 켜는 순간 열린 작업을 커밋하는 JDBC 식 뜻과 헷갈린다.
 * - 끔에서도 [트랜잭션 작업 시작] 을 남긴다 — 끔의 조회는 작업을 열지 않으므로 조회부터 묶으려면 명시적으로 연다.
 */
import { splitStatements } from "./statement-at";
import type { DbDialect } from "./query-backend";

/** `lockedByWork` = 열린 작업 때문에 못 바꾼다 */
export interface AutoCommitToggle {
  shown: boolean;
  on: boolean;
  disabled: boolean;
  lockedByWork: boolean;
}

export function autoCommitToggle(o: {
  /** 판 12 서버면 `undefined`(토글을 숨긴다) */
  autoCommit: boolean | undefined;
  writable: boolean;
  txOpen: boolean;
  running: boolean;
  busy: boolean;
  connected: boolean;
}): AutoCommitToggle {
  const shown = o.autoCommit !== undefined && o.writable;
  const on = o.autoCommit !== false;
  return {
    shown,
    on,
    disabled: !o.connected || o.running || o.busy || o.txOpen,
    lockedByWork: o.txOpen,
  };
}

export function autoCommitOff(o: { autoCommit: boolean | undefined; writable: boolean }): boolean {
  return o.writable && o.autoCommit === false;
}

/** 자동 커밋 켬에서는 스크립트가 곧바로 커밋하므로 `Ctrl+Enter` 가 스크립트 길로 가면 안 된다 */
export function runRoute(o: {
  text: string;
  dialect: DbDialect;
  inWork: boolean;
  autoCommitOff: boolean;
  scriptSupported: boolean;
}): "query" | "script" {
  if (!o.scriptSupported || !(o.inWork || o.autoCommitOff)) return "query";
  return splitStatements(o.text, o.dialect).length > 1 ? "script" : "query";
}
