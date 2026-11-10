import { describe, expect, it, vi } from "vitest";
import { openDbFlow, type DbOpenDeps } from "./open-flow";
import type { DbOpened } from "./query-backend";
import type { PasswordPrompt, SshGateCreds } from "$lib/session";

const OPENED: DbOpened = { handle: 7, lease: 1, dialect: "postgres", serverVersion: "PostgreSQL 16", writable: false, reattached: false };
const target = { id: "Kp3_pg-main01", name: "shop", who: "reader@shop", via: "web-01" };
const tr = ((k: string, p?: Record<string, unknown>) => (p ? `${k} ${JSON.stringify(p)}` : k)) as DbOpenDeps["tr"];

/** 실패를 차례로 던지고 끝에 성공하는 `open` — 받은 인자를 적어 둔다 */
function deps(fails: unknown[], over: Partial<DbOpenDeps> = {}) {
  const calls: { password: string | undefined; ssh: SshGateCreds | undefined }[] = [];
  const order: string[] = [];
  const d: DbOpenDeps = {
    open: vi.fn(async (password, ssh) => {
      calls.push({ password, ssh: ssh ? { ...ssh } : undefined });
      const f = fails.shift();
      if (f !== undefined) throw f;
      return OPENED;
    }),
    via: "web-01",
    gates: {},
    askPassword: vi.fn(async () => "dbpw"),
    target,
    ensureUnlocked: vi.fn(async () => {
      order.push("unlock");
    }),
    flushSaves: vi.fn(() => order.push("flush")),
    dropSaves: vi.fn(() => order.push("drop")),
    tr,
    ...over,
  };
  return { d, calls, order };
}

describe("쿼리 타일 연결 열기 고리", () => {
  it("떼어 둔 연결이 있으면 볼트 관문 · 비밀번호 없이 그대로 붙는다 (9단계 — 리로드 · 재시작 · 이관)", async () => {
    const again = { ...OPENED, lease: 2, reattached: true };
    const { d, calls, order } = deps([], { reattach: vi.fn(async () => again) });
    expect(await openDbFlow(d)).toEqual({ ok: true, opened: again });
    expect(calls).toEqual([]);
    expect(order).toEqual([]);
    expect(d.askPassword).not.toHaveBeenCalled();
  });

  it("붙을 연결이 없으면(서버가 [session-gone]) 평소 관문으로 연다", async () => {
    const reattach = vi.fn(async () => {
      throw "[session-gone] DB 연결을 찾을 수 없습니다";
    });
    const { d, calls, order } = deps([], { reattach });
    expect(await openDbFlow(d)).toEqual({ ok: true, opened: OPENED });
    expect(reattach).toHaveBeenCalledTimes(1);
    expect(calls).toHaveLength(1);
    expect(order).toEqual(["unlock", "flush"]);
  });

  it("[db-carry](끊긴 연결이 빌린 비밀번호를 쥠)면 볼트 잠금 해제 · 비밀번호를 묻지 않고 곧바로 연다 (2026-11-10 실기)", async () => {
    const reattach = vi.fn(async () => {
      throw "[db-carry] [session-gone] DB 연결을 찾을 수 없습니다";
    });
    const { d, calls, order } = deps([], { reattach });
    expect(await openDbFlow(d)).toEqual({ ok: true, opened: OPENED });
    expect(calls).toEqual([{ password: undefined, ssh: undefined }]);
    expect(order).toEqual([]);
    expect(d.ensureUnlocked).not.toHaveBeenCalled();
    expect(d.askPassword).not.toHaveBeenCalled();
  });

  it("[db-carry] 로 연 것이 실패하면(빌린 값 거절) 평소 관문 — 볼트 잠금 해제 → 볼트 차례 → 묻기", async () => {
    const reattach = vi.fn(async () => {
      throw "[db-carry] [session-gone] x";
    });
    const { d, calls, order } = deps(["[db-auth] 맞지 않습니다", "[db-password] 비밀번호가 필요합니다"], { reattach });
    expect(await openDbFlow(d)).toEqual({ ok: true, opened: OPENED });
    expect(calls.map((c) => c.password)).toEqual([undefined, undefined, "dbpw"]);
    expect(order).toEqual(["unlock", "flush"]);
    expect(d.askPassword).toHaveBeenCalledTimes(1);
    expect(vi.mocked(d.askPassword).mock.calls[0][0]).toMatchObject({ attempt: 1 });
  });

  it("볼트 관문 → SSH 관문 → [db-password] → 모달 → 그 값을 실어 다시 → 성공 뒤에 저장", async () => {
    const hostKey = { kind: "host_key_unknown", fingerprint: "SHA256:x", key_type: "ssh-ed25519", host: "h", port: 22, no_store: false };
    const confirm = vi.fn(async () => "once" as const);
    const { d, calls, order } = deps([hostKey, "[db-password] 이 DB 는 비밀번호가 필요합니다"], { gates: { confirm } });
    const r = await openDbFlow(d);
    expect(r).toEqual({ ok: true, opened: OPENED });
    expect(calls.map((c) => [c.password, c.ssh?.hostKeyDecision])).toEqual([
      [undefined, null],
      [undefined, "once"],
      ["dbpw", null], // 비밀번호 뒤 새 고리 — 서버가 세워 둔 전송로를 쓰므로 SSH 답은 비어 있다
    ]);
    expect(d.askPassword).toHaveBeenCalledWith(
      expect.objectContaining({ alias: "web-01", message: "이 DB 는 비밀번호가 필요합니다", attempt: 1, storedRejected: false, db: target }),
    );
    expect(order).toEqual(["unlock", "flush"]);
  });

  it("볼트 값이 거절되면 모달이 그 사실을 받는다 · 틀리면 다시 묻고 3번 뒤엔 오류", async () => {
    const stored = "[db-auth] [db-stored-rejected] DB 비밀번호가 맞지 않습니다: x [SQLSTATE 28P01]";
    const wrong = "[db-auth] DB 비밀번호가 맞지 않습니다: x [SQLSTATE 28P01]";
    const { d } = deps([stored, wrong, wrong, wrong]);
    const r = await openDbFlow(d);
    expect(d.askPassword).toHaveBeenCalledTimes(3);
    expect(vi.mocked(d.askPassword).mock.calls[0][0]).toMatchObject({ storedRejected: true, attempt: 1 });
    expect(vi.mocked(d.askPassword).mock.calls[1][0]).toMatchObject({ storedRejected: false, attempt: 2 });
    expect(r).toEqual({ ok: false, kind: "error", message: "DB 비밀번호가 맞지 않습니다: x [SQLSTATE 28P01]", raw: wrong });
    expect(d.dropSaves).toHaveBeenCalled();
    expect(d.flushSaves).not.toHaveBeenCalled();
  });

  it("모달 취소 · SSH 관문 취소는 cancelled(연결 안 됨) — 적어 둔 값은 버린다", async () => {
    const a = deps(["[db-password] x"], { askPassword: vi.fn(async () => null) });
    expect(await openDbFlow(a.d)).toEqual({ ok: false, kind: "cancelled", message: "pane.query.connect.cancelled" });
    expect(a.order).toEqual(["unlock", "drop"]);
    const pw = { kind: "password_required", message: "need", diag: { cause: "auth_no_method" } };
    const b = deps([pw], { gates: { promptPassword: async () => null } });
    expect(await openDbFlow(b.d)).toMatchObject({ ok: false, kind: "cancelled" });
  });

  it("경유 없음은 SSH 답을 싣지 않는다 · DB 쪽 갈래(끊김 · 옛 서버 · 오류)는 문구에서 접두어를 뗀다", async () => {
    const { d, calls } = deps(["[server-outdated] 다시 시작하세요"], { via: null });
    expect(await openDbFlow(d)).toEqual({ ok: false, kind: "outdated", message: "다시 시작하세요", raw: "[server-outdated] 다시 시작하세요" });
    expect(calls[0].ssh).toBeUndefined();
    const e = deps(["인증서의 이름이 'db.test' 과(와) 맞지 않습니다"]);
    expect(await openDbFlow(e.d)).toMatchObject({ ok: false, kind: "error" });
  });

  it("연결 테스트 — noSave 를 DB 접속 모달에 싣는다 · 답의 꼴은 부르는 쪽 것(T) · 없으면 싣지 않는다", async () => {
    const tested = { dialect: "postgres" as const, serverVersion: "PostgreSQL 16", elapsedMs: 412 };
    const askPassword = vi.fn(async (_p: PasswordPrompt) => "dbpw");
    let n = 0;
    const r = await openDbFlow({
      open: async () => {
        if (n++ === 0) throw "[db-password] 이 DB 는 비밀번호가 필요합니다";
        return tested;
      },
      via: null,
      gates: {},
      askPassword,
      noSave: true,
      target,
      ensureUnlocked: async () => {},
      flushSaves: () => {},
      dropSaves: () => {},
      tr,
    });
    expect(r).toEqual({ ok: true, opened: tested });
    expect(askPassword.mock.calls[0][0]).toMatchObject({ noSave: true, db: target });
    const plain = deps(["[db-password] x"]);
    await openDbFlow(plain.d);
    expect(vi.mocked(plain.d.askPassword).mock.calls[0][0]).not.toHaveProperty("noSave");
  });

  it("SSH 쪽 실패(관문이 아닌)는 터미널과 같은 문구로", async () => {
    const other = { kind: "other", message: "연결 거부", diag: { cause: "tcp_refused" } };
    const { d } = deps([other]);
    const r = await openDbFlow(d);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain("연결 거부");
  });
});
