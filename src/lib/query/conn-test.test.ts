import { describe, expect, it } from "vitest";
import {
  beginConnTest,
  connFormKey,
  connTestChip,
  connTestMayUseVault,
  connTestReason,
  elapsedSeconds,
  finishConnTest,
  idleConnTest,
  invalidConnTest,
  newConnTestStream,
  onConnFormChange,
  resetConnTest,
} from "./conn-test";
import { connOfRow, connRowOf, emptyConnRow } from "./conn-form";
import type { DbConn } from "$lib/db-conn";

const SAVED: DbConn = {
  id: "Kp3_pg-main01",
  name: "shop",
  engine: "postgres",
  via: "web-01",
  host: "localhost",
  port: 5432,
  database: "shop",
  user: "reader",
  tls_mode: "prefer",
};
const OK = { dialect: "postgres" as const, serverVersion: "PostgreSQL 16.4", elapsedMs: 412 };

describe("연결 테스트 칩 상태", () => {
  it("시작 → 답 → 같은 회차만 받는다", () => {
    const s0 = idleConnTest();
    const s1 = beginConnTest(s0, "k", 1000);
    expect(s1.phase).toEqual({ kind: "running", startedAt: 1000 });
    expect(s1.gen).toBe(s0.gen + 1);
    const done = finishConnTest(s1, s1.gen, { kind: "ok", result: OK });
    expect(done.phase).toEqual({ kind: "ok", result: OK });
    // 옛 회차의 늦은 답은 버린다
    expect(finishConnTest(s1, s1.gen - 1, { kind: "cancelled" })).toBe(s1);
  });

  it("[취소] · 폼 다시 열기 = 회차를 올려 도는 시도의 답을 버린다", () => {
    const s1 = beginConnTest(idleConnTest(), "k", 0);
    const cancelled = resetConnTest(s1);
    expect(cancelled.phase.kind).toBe("idle");
    expect(cancelled.gen).toBe(s1.gen + 1);
    expect(finishConnTest(cancelled, s1.gen, { kind: "ok", result: OK })).toBe(cancelled);
  });

  it("칸을 바꾸면 칩이 사라진다(도는 중 포함) · 그대로면 같은 상태", () => {
    const row = connRowOf(SAVED);
    const key = connFormKey(row);
    const running = beginConnTest(idleConnTest(), key, 0);
    expect(onConnFormChange(running, key)).toBe(running);
    const moved = onConnFormChange(running, connFormKey({ ...row, port: 6543 }));
    expect(moved.phase.kind).toBe("idle");
    expect(finishConnTest(moved, running.gen, { kind: "ok", result: OK })).toBe(moved);
    const ok = finishConnTest(running, running.gen, { kind: "ok", result: OK });
    for (const change of [{ name: "x" }, { host: "db" }, { user: "admin" }, { database: "d" }, { via: null }, { tlsMode: "require" as const }]) {
      expect(onConnFormChange(ok, connFormKey({ ...row, ...change })).phase.kind, JSON.stringify(change)).toBe("idle");
    }
    const idle = idleConnTest(3);
    expect(onConnFormChange(idle, "other")).toBe(idle);
  });

  it("지난 초는 내림 · 음수 없음", () => {
    expect(elapsedSeconds(1000, 1999)).toBe(0);
    expect(elapsedSeconds(1000, 3500)).toBe(2);
    expect(elapsedSeconds(1000, 500)).toBe(0);
  });

  it("테스트 열쇠는 dbtest- 머리", () => {
    expect(newConnTestStream(() => 0.5)).toMatch(/^dbtest-[0-9a-z]+$/);
    expect(newConnTestStream()).not.toBe(newConnTestStream());
  });
});

describe("연결 테스트 — 폼이 틀렸을 때", () => {
  it("곧바로 실패 칩(문구 그대로) · 도는 시도의 답은 버린다 · 칸을 고치면 지워진다", () => {
    const running = beginConnTest(idleConnTest(), "k0", 0);
    const s = invalidConnTest(running, "k1", "이름이 비어 있습니다");
    expect(s.phase).toEqual({ kind: "invalid", message: "이름이 비어 있습니다" });
    expect(finishConnTest(s, running.gen, { kind: "cancelled" })).toBe(s);
    const tr = (k: string) => k;
    expect(connTestChip(s.phase, 0, tr)).toEqual({ mark: "err", label: "이름이 비어 있습니다", detail: "이름이 비어 있습니다" });
    expect(onConnFormChange(s, "k1")).toBe(s);
    expect(onConnFormChange(s, "k2").phase.kind).toBe("idle");
  });
});

describe("연결 테스트 실패 갈래", () => {
  it("이유 접두어 — 인증", () => {
    expect(connTestReason("[db-auth] DB 비밀번호가 맞지 않습니다: x [SQLSTATE 28P01]")).toBe("auth");
    expect(connTestReason("[db-auth] [db-stored-rejected] 맞지 않습니다")).toBe("auth");
    expect(connTestReason("[db-password] 이 DB 는 비밀번호가 필요합니다")).toBe("auth");
  });

  it("OS 번호 · 드라이버 고정 조각 — 호스트 · 거절 · 시간 초과 (OS 언어와 무관)", () => {
    expect(connTestReason("PostgreSQL 에 붙지 못했습니다: error connecting to server: 알려진 호스트가 없습니다. (os error 11001)")).toBe("host");
    expect(connTestReason("Could not connect to MySQL: failed to lookup address information: Name or service not known")).toBe("host");
    expect(connTestReason("Could not connect to PostgreSQL: error connecting to server: 대상 컴퓨터에서 연결을 거부했으므로 연결하지 못했습니다. (os error 10061)")).toBe("refused");
    expect(connTestReason("Connection refused (os error 111)")).toBe("refused");
    expect(connTestReason("Could not connect to MySQL / MariaDB: connect timed out")).toBe("timeout");
    expect(connTestReason("error connecting to server: (os error 10060)")).toBe("timeout");
    expect(connTestReason("timeout waiting for server")).toBe("timeout");
  });

  it("TLS — 인증서 · 서버가 TLS 를 받지 않음 · 네트워크 갈래가 먼저", () => {
    expect(connTestReason("서버 인증서를 확인하지 못했습니다. 원인: 인증서가 만료되었습니다")).toBe("tls");
    expect(connTestReason("이 DB 서버는 TLS(SSL)를 받지 않습니다 — …")).toBe("tls");
    expect(connTestReason("The server certificate could not be verified")).toBe("tls");
    expect(connTestReason("MySQL 서버 인증서를 확인하려고 붙지 못했습니다: Connection refused (os error 10061)")).toBe("refused");
  });

  it("그 밖 — 연결 실패", () => {
    expect(connTestReason("SQLite 파일을 열지 못했습니다 (C:\\x.db): unable to open database file")).toBe("failed");
    expect(connTestReason("경유 호스트 'x' 를 찾을 수 없습니다 — 호스트 목록(~/.ssh/config)에 없습니다")).toBe("failed");
  });
});

describe("연결 테스트의 볼트 잠금 해제 물음", () => {
  it("저장된 연결을 편집 중이고 대상이 그대로일 때만", () => {
    const same = connOfRow({ ...connRowOf(SAVED), name: "새 이름", tlsMode: "require" });
    if (!same.ok) throw new Error("form");
    expect(connTestMayUseVault(SAVED, same.conn)).toBe(true);
    expect(connTestMayUseVault(null, same.conn)).toBe(false);
    for (const change of [{ host: "db" }, { port: 1 }, { user: "u" }, { database: "d" }, { via: null }, { engine: "mysql" as const }]) {
      const r = connOfRow({ ...connRowOf(SAVED), ...change });
      if (!r.ok) throw new Error("form");
      expect(connTestMayUseVault(SAVED, r.conn), JSON.stringify(change)).toBe(false);
    }
    const fresh = connOfRow({ ...emptyConnRow(), name: "n", path: "C:\\a.db" });
    if (!fresh.ok) throw new Error("form");
    expect(connTestMayUseVault(SAVED, fresh.conn)).toBe(false);
  });
});

describe("연결 테스트 칩 그림", () => {
  const tr = (k: string, p?: Record<string, string | number>) => (p ? `${k} ${JSON.stringify(p)}` : k);
  it("없음 · 도는 중(지난 초) · 연결됨(판 · 경유 · ms) · 실패(서버 문구 전체) · 취소됨", () => {
    expect(connTestChip({ kind: "idle" }, 0, tr)).toBeNull();
    expect(connTestChip({ kind: "running", startedAt: 0 }, 2500, tr)).toMatchObject({ mark: "spin", label: 'app.query.form.test.running {"s":2}' });
    const ok = connTestChip({ kind: "ok", result: { ...OK, via: "web-01" } }, 0, tr)!;
    expect(ok.mark).toBe("ok");
    expect(ok.label).toBe('app.query.form.test.ok {"ms":412}');
    expect(ok.detail.split("\n")).toEqual([
      'app.query.form.test.detail.version {"v":"PostgreSQL 16.4"}',
      'app.query.form.test.detail.via {"via":"web-01"}',
      'app.query.form.test.detail.elapsed {"ms":412}',
      "app.query.form.test.detail.note",
    ]);
    expect(connTestChip({ kind: "ok", result: OK }, 0, tr)!.detail).toContain("app.query.form.test.detail.direct");
    expect(connTestChip({ kind: "error", reason: "auth", message: "full text" }, 0, tr)).toEqual({
      mark: "err",
      label: "app.query.form.test.reason.auth",
      detail: "full text",
    });
    expect(connTestChip({ kind: "cancelled" }, 0, tr)).toMatchObject({ mark: "none", label: "app.query.form.test.cancelled" });
  });
});
