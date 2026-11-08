/**
 * **쿼리 타일의 자동 커밋 토글 · Ctrl+Enter 의 갈래**(10-14 사용자 결정 — docs/log/2026-10-13-db-write-mcp-design.md "자동 커밋 ·
 * 세이브포인트 메모"). 순수.
 *
 * - 쓰기 모드 띠의 [자동 커밋](기본 켬). **켬** = 지금과 같다(문장 하나 = 곧바로 커밋 · [트랜잭션 작업 시작] 으로 일회성 작업).
 *   **끔** = 데이터를 바꾸는 문장(서버 가드의 읽기 전용 허용 목록 밖 — 판정은 세션 서버 `table::query`)을 실행하는 순간 트랜잭션
 *   작업이 저절로 열린다. 조회(SELECT 류)만으로는 열리지 않는다(작업 밖 조회는 엔진의 `READ ONLY` 트랜잭션 — 잠금 · 스냅숏을 남기지
 *   않는다). [커밋] · [되돌리기] 뒤에도 끈 채 남고 다음 변경 문장에서 다시 열린다.
 * - 값은 **세션 서버가 쥔다**(`opened.autoCommit` · `db_set_write {autoCommit}`) — F5 로 화면이 새로 떠도 꺼진 채다(화면이 기본값으로
 *   돌아가 끈 줄 알고 친 문장이 곧바로 커밋되는 일이 없게). 저장하지 않는다 — 새 연결은 켬, 쓰기를 끄면 켬으로.
 * - **작업이 열려 있으면 바꾸지 않는다**(켜는 순간 열린 작업을 커밋하는 JDBC 식 뜻과 헷갈리지 않게 — [커밋] · [되돌리기] 로 먼저).
 * - [트랜잭션 작업 시작] 은 끔에서도 남는다(Codex 검토 반영 2 — 끔의 조회는 작업을 열지 않으므로 조회부터 한 작업으로 묶거나
 *   `SELECT … FOR UPDATE` 로 먼저 잠그려면 명시적으로 연다 · DBeaver 의 Smart commit 과 비슷한 뜻이다).
 */
import { splitStatements } from "./statement-at";
import type { DbDialect } from "./query-backend";

/** 토글의 모양 — `shown` = 판 13 서버 · 쓰기 모드 · `lockedByWork` = 열린 작업 때문에 못 바꾼다(말풍선이 까닭을 밝힌다) */
export interface AutoCommitToggle {
  shown: boolean;
  on: boolean;
  disabled: boolean;
  lockedByWork: boolean;
}

export function autoCommitToggle(o: {
  /** `opened.autoCommit` — 판 12 서버면 `undefined`(토글을 숨긴다) */
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

/** 자동 커밋이 꺼진 쓰기 타일인가(판 12 서버 · 읽기 전용이면 아니다) */
export function autoCommitOff(o: { autoCommit: boolean | undefined; writable: boolean }): boolean {
  return o.writable && o.autoCommit === false;
}

/**
 * `Ctrl+Enter` 가 보낼 길 — 보낼 글이 **여러 문장**이고 (자동 커밋 끔 또는 작업 중)이면 스크립트 실행기(서버가 나누고 전부 검사 — 하나라도
 * 거절이면 실행 0 · 작업 안 · 커밋 안 함 · 실행 한 번이 세이브포인트 하나). 그 밖은 지금처럼 문장 하나(여러 문장이면 서버가 "Alt+X 로"
 * 거절한다 — 자동 커밋 켬에서는 스크립트가 곧바로 커밋하므로 `Ctrl+Enter` 가 몰래 그 길로 가지 않는다).
 */
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
