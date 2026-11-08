import { describe, expect, it } from "vitest";
import { classifyDbError } from "./query-backend";
import { stripReason } from "$lib/error-reason";

describe("DB 오류 접두어 분류", () => {
  it("다시 열기 · 취소 · 서버 옛 판 · 그 밖", () => {
    expect(classifyDbError("[stale-lease] 낡았습니다")).toBe("reopen");
    expect(classifyDbError("[session-gone] 닫혔습니다")).toBe("reopen");
    expect(classifyDbError("[cancelled] 쿼리를 취소했습니다")).toBe("cancelled");
    expect(classifyDbError("[server-outdated] 세션 서버가 이전 판")).toBe("outdated");
    expect(classifyDbError("no such table: x")).toBe("error");
    expect(classifyDbError("호스트를 경유하는 DB 연결은 아직 지원하지 않습니다")).toBe("error");
  });

  it("server-outdated 도 화면에 찍기 전 접두어가 떨어진다", () => {
    expect(stripReason("[server-outdated] 다시 시작하세요")).toBe("다시 시작하세요");
  });

  it("7단계 — 끊김 · 비밀번호(청함 · 거절 · 볼트 값 거절)", () => {
    expect(classifyDbError("[db-disconnected] DB 연결이 끊겼습니다")).toBe("disconnected");
    expect(classifyDbError("[db-password] 이 DB 는 비밀번호가 필요합니다")).toBe("password");
    expect(classifyDbError("[db-auth] DB 비밀번호가 맞지 않습니다")).toBe("password");
    expect(classifyDbError("[db-auth] [db-stored-rejected] DB 비밀번호가 맞지 않습니다")).toBe("password");
    expect(stripReason("[db-auth] [db-stored-rejected] 맞지 않습니다: x [SQLSTATE 28P01]")).toBe("맞지 않습니다: x [SQLSTATE 28P01]");
  });

  it("Codex 검토 반영 2 — 작업이 필요한 조회 · 실행 결과 미확인", () => {
    expect(classifyDbError("[db-needs-work] 이 문장은 데이터를 바꿉니다")).toBe("needsWork");
    expect(classifyDbError("[db-unconfirmed] 기다리기를 멈추고 이 연결을 끊었습니다\n연결이 끊겨")).toBe("unconfirmed");
    expect(stripReason("[db-unconfirmed] 모름")).toBe("모름");
    expect(stripReason("[db-needs-work] 안내")).toBe("안내");
  });

  it("1단계 — 낡은 트랜잭션 작업 요청", () => {
    expect(classifyDbError("[db-tx-stale] 이 트랜잭션 작업은 이미 끝났습니다")).toBe("txStale");
    expect(stripReason("[db-tx-stale] 이미 끝났습니다")).toBe("이미 끝났습니다");
  });
});
