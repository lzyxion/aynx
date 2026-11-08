import { describe, expect, it, vi } from "vitest";
import { runSshGates, type SshGateCreds } from "./ssh-gates";
import { SessionOpenError } from "./errors";

const unknownKey = { kind: "host_key_unknown", fingerprint: "SHA256:abc", key_type: "ssh-ed25519", host: "h", port: 22, no_store: false };
const pwRequired = (message = "need") => ({ kind: "password_required", message, diag: { cause: "auth_no_method" } });
const locked = (path: string, wrong = false) => ({ kind: "passphrase_required", path, fingerprint: null, wrong, stored_rejected: false });

/** 실패를 차례로 던지고 마지막에 성공하는 시도 — 매번 받은 답(사본)을 적어 둔다 */
function script(fails: unknown[], ok: unknown = "opened") {
  const seen: SshGateCreds[] = [];
  const attempt = vi.fn(async (c: SshGateCreds) => {
    seen.push({ ...c, declinedKeys: [...c.declinedKeys] });
    const next = fails.shift();
    if (next !== undefined) throw next;
    return ok;
  });
  return { attempt, seen };
}

describe("runSshGates — 터미널 SSH 열기와 쿼리 타일 경유가 함께 쓰는 관문 고리", () => {
  it("호스트 키 → 비밀번호 순으로 묻고 답을 실어 다시 부른다 · 값은 그 시도 한 번뿐", async () => {
    const { attempt, seen } = script([unknownKey, pwRequired()]);
    const confirm = vi.fn(async () => "once" as const);
    const promptPassword = vi.fn(async () => "pw1");
    await expect(runSshGates("web-01", { confirm, promptPassword }, attempt)).resolves.toBe("opened");
    expect(seen.map((c) => [c.hostKeyDecision, c.password])).toEqual([
      [null, null],
      ["once", null],
      ["once", "pw1"],
    ]);
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ alias: "web-01", fingerprint: "SHA256:abc", changed: false, canRecord: true }));
    expect(promptPassword).toHaveBeenCalledWith(expect.objectContaining({ alias: "web-01", attempt: 1, maxAttempts: 3 }));
  });

  it("호스트 키는 한 번만 묻는다 — 두 번째는 그대로 실패", async () => {
    const { attempt } = script([unknownKey, unknownKey]);
    const confirm = vi.fn(async () => "trust" as const);
    await expect(runSshGates("a", { confirm }, attempt)).rejects.toBeInstanceOf(SessionOpenError);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it("호스트 키 거부 · 비밀번호 취소는 cancelled / password_cancelled", async () => {
    const r1 = script([unknownKey]);
    await expect(runSshGates("a", { confirm: async () => "reject" }, r1.attempt)).rejects.toMatchObject({ detail: { kind: "cancelled" } });
    const r2 = script([pwRequired()]);
    await expect(runSshGates("a", { promptPassword: async () => null }, r2.attempt)).rejects.toMatchObject({
      detail: { kind: "password_cancelled" },
    });
  });

  it("비밀번호는 3번까지 — 넷째 거절은 그대로 실패", async () => {
    const { attempt } = script([pwRequired(), pwRequired("wrong"), pwRequired("wrong"), pwRequired("wrong")]);
    const promptPassword = vi.fn(async () => "x");
    await expect(runSshGates("a", { promptPassword }, attempt)).rejects.toMatchObject({ detail: { kind: "password_required" } });
    expect(promptPassword).toHaveBeenCalledTimes(3);
  });

  it("암호구는 키 파일마다 세고, 취소한 키는 declinedKeys 로 되돌려 결국 비밀번호로 간다", async () => {
    const { attempt, seen } = script([locked("/k/a"), locked("/k/b"), pwRequired()]);
    const promptPassphrase = vi.fn(async (p: { path: string }) => (p.path === "/k/a" ? "pp" : null));
    const promptPassword = vi.fn(async () => "pw");
    await runSshGates("a", { promptPassphrase, promptPassword }, attempt);
    expect(seen[1]).toMatchObject({ passphrase: "pp", passphraseFor: "/k/a", declinedKeys: [] });
    expect(seen[2]).toMatchObject({ passphrase: null, passphraseFor: null, declinedKeys: ["/k/b"] });
    expect(seen[3]).toMatchObject({ password: "pw", passphrase: null, declinedKeys: ["/k/b"] });
  });

  it("묻는 창이 없으면 관문 실패도 그대로 던진다(비대화형)", async () => {
    const { attempt } = script([pwRequired()]);
    await expect(runSshGates("a", {}, attempt)).rejects.toMatchObject({ detail: { kind: "password_required" } });
  });

  it("passthrough — 관문이 아닌 실패는 해석하지 않고 받은 그대로 던진다(쿼리 타일의 [db-password])", async () => {
    const { attempt } = script([unknownKey, "[db-password] 이 DB 는 비밀번호가 필요합니다"]);
    const passthrough = (e: unknown) => typeof e === "string";
    await expect(runSshGates("a", { confirm: async () => "once" }, attempt, { passthrough })).rejects.toBe(
      "[db-password] 이 DB 는 비밀번호가 필요합니다",
    );
    // passthrough 가 없으면 예전처럼 `other` 로 감싼다(터미널 열기 동작 불변).
    const r = script(["boom"]);
    await expect(runSshGates("a", {}, r.attempt)).rejects.toMatchObject({ detail: { kind: "other", message: "boom" } });
  });
});
