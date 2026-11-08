import { describe, expect, it } from "vitest";
import { translate } from "$lib/i18n/dict";
import {
  RTT_WARN_MS,
  infoCardText,
  localInfoCard,
  sessionInfoCard,
  sessionInfoLines,
  type SessionInfo,
} from "$lib/session-info";
import {
  describeSessionError,
  openErrorHint,
  parseSessionError,
  type SessionError,
  type Tr,
} from "$lib/session";

/**
 * **접속 진단 + 연결 상태** (docs/log/2026-09-17-connect-diagnostics.md).
 *
 * 두 축을 각각 고정한다: 백엔드가 실어 보낸 `diag` 를 힌트 한 줄로 옮기는 규칙과,
 * `SessionInfo` 한 벌을 말풍선 두 줄로 펴는 규칙.
 */

const ko: Tr = (key, params) => translate("ko", key, params);
const en: Tr = (key, params) => translate("en", key, params);

/** 백엔드 페이로드 한 벌 (`SshOpenError` 직렬화 모양 그대로) */
function payload(kind: string, message: string, diag?: unknown): unknown {
  return diag === undefined ? { kind, message } : { kind, message, diag };
}

describe("openErrorHint — 다음에 할 일", () => {
  it("사유마다 제 힌트를 고른다", () => {
    const cases: [string, string][] = [
      ["dns", "호스트 주소를 확인하세요 (호스트 폼 → 호스트 주소)"],
      ["tcp_refused", "포트가 맞는지, 서버에 sshd 가 떠 있는지 확인하세요"],
      ["tcp_timeout", "방화벽·VPN 을 확인하거나, 경유 호스트가 필요한지 보세요"],
      ["tcp_unreachable", "네트워크 경로를 확인하세요 (VPN·라우팅)"],
      ["auth_password_rejected", "비밀번호를 다시 입력해 보세요"],
      ["auth_no_method", "서버가 허용하는 인증 방식을 확인하세요 (키 또는 비밀번호)"],
      ["banner_or_protocol", "SSH 서버가 아닌 포트일 수 있습니다 — 포트 번호를 확인하세요"],
    ];
    for (const [cause, hint] of cases) {
      const err = parseSessionError(payload("other", "…", { cause }), ko);
      expect(openErrorHint(err, ko), cause).toBe(hint);
    }
  });

  it("키가 거부된 실패는 '공개키 설치…' 로 데려간다", () => {
    const err = parseSessionError(payload("auth", "키 거부", { cause: "auth_key_rejected" }), ko);
    expect(openErrorHint(err, ko)).toContain("공개키 설치…");
  });

  it("`IdentitiesOnly` 는 사유를 바꾸지 않고 꼬리 한 마디만 붙인다", () => {
    const plain = parseSessionError(payload("auth", "키 거부", { cause: "auth_key_rejected" }), ko);
    const only = parseSessionError(
      payload("auth", "키 거부", { cause: "auth_key_rejected", identities_only: true }),
      ko,
    );
    const base = openErrorHint(plain, ko) ?? "";
    expect(openErrorHint(only, ko)).toBe(base + " (IdentitiesOnly 가 켜져 있어 지정한 키만 시도했습니다)");
    expect(openErrorHint(only, en)).toContain("IdentitiesOnly is on");
    // 플래그가 없는 예전 페이로드는 한 글자도 달라지지 않는다.
    expect(openErrorHint(plain, ko)).toBe(base);
  });

  it("읽히지 않는 키 파일은 그 파일을 보라고 말한다", () => {
    const err = parseSessionError(payload("auth", "…", { cause: "key_file_unreadable" }), ko);
    expect(openErrorHint(err, ko)).toContain("IdentityFile");
  });

  it("경유 실패는 **안쪽 사유**의 힌트를 쓴다", () => {
    const err = parseSessionError(
      payload("other", "경유 호스트 bastion 에서 실패: …", {
        cause: "jump",
        jump: "bastion",
        inner: "tcp_refused",
      }),
      ko,
    );
    expect(openErrorHint(err, ko)).toBe("포트가 맞는지, 서버에 sshd 가 떠 있는지 확인하세요");
  });

  it("안쪽을 모르는 경유 실패는 경유 자신의 힌트로 떨어진다", () => {
    const err = parseSessionError(payload("auth", "…", { cause: "jump", jump: "bastion" }), ko);
    expect(openErrorHint(err, ko)).toBe("경유 호스트에 먼저 붙을 수 있는지 확인하세요");
  });

  it("`other` 와 진단 없는 실패에는 힌트가 없다", () => {
    expect(openErrorHint(parseSessionError(payload("other", "?", { cause: "other" }), ko), ko)).toBe(
      null,
    );
    // 옛 백엔드 · 프런트가 스스로 만든 실패 (진단 필드가 아예 없다)
    expect(openErrorHint(parseSessionError(payload("other", "?"), ko), ko)).toBe(null);
    expect(openErrorHint({ kind: "cancelled" } as SessionError, ko)).toBe(null);
  });

  it("모르는 사유 코드는 버린다 — 뒤에 늘어난 갈래를 옛 화면이 지어내지 않게", () => {
    const err = parseSessionError(payload("other", "…", { cause: "quantum_flux" }), ko);
    expect("diag" in err ? err.diag : undefined).toBe(undefined);
    expect(openErrorHint(err, ko)).toBe(null);
  });

  it("힌트도 번역된다", () => {
    const err = parseSessionError(payload("other", "…", { cause: "dns" }), en);
    expect(openErrorHint(err, en)).toBe("Check the host address (host form → host address)");
  });

  it("호스트 키 계약은 그대로다 — 진단이 붙지 않는다", () => {
    const err = parseSessionError(
      { kind: "host_key_unknown", fingerprint: "SHA256:a", key_type: "ssh-ed25519" },
      ko,
    );
    expect(err.kind).toBe("host_key_unknown");
    expect(openErrorHint(err, ko)).toBe(null);
  });
});

describe("passphrase_required — 다이얼로그 계약 (2026-09-19)", () => {
  /** Rust `SshOpenError::PassphraseRequired` 직렬화 모양 그대로 */
  const locked = {
    kind: "passphrase_required",
    path: "C:\Users\wl\.ssh\id_ed25519_x",
    fingerprint: "SHA256:abc",
    wrong: false,
  };

  it("경로·지문·틀림 표시를 그대로 받아 낸다", () => {
    const err = parseSessionError(locked, ko);
    expect(err.kind).toBe("passphrase_required");
    if (err.kind !== "passphrase_required") throw new Error("kind");
    // **전체 경로**여야 한다 — 재시도의 `passphraseFor` 로 되돌려 주는 열쇠다.
    expect(err.path).toBe("C:\Users\wl\.ssh\id_ed25519_x");
    expect(err.fingerprint).toBe("SHA256:abc");
    expect(err.wrong).toBe(false);
    // 호스트 키와 같은 성질 — 문구도 진단도 없다(화면이 그릴 글자는 사전이 만든다).
    expect("message" in err).toBe(false);
    expect(openErrorHint(err, ko)).toBe(null);
  });

  it("지문이 없어도 받아 낸다 — `.pub` 이 없는 키가 있다", () => {
    const err = parseSessionError({ ...locked, fingerprint: undefined, wrong: true }, ko);
    if (err.kind !== "passphrase_required") throw new Error("kind");
    expect(err.fingerprint).toBe(null);
    expect(err.wrong).toBe(true);
  });

  it("금고에 담아 둔 값이 거부되면 `storedRejected` 가 선다 — `wrong` 과 다른 사실이다", () => {
    // 2026-09-19 ② (docs/log/2026-09-19-vault.md): `wrong` 은 "사람이 방금 친 것이
    // 틀렸다" 이고, 이쪽은 아직 아무것도 치지 않았다. 모달의 한 줄이 이 둘로 갈린다.
    const stale = parseSessionError({ ...locked, stored_rejected: true }, ko);
    if (stale.kind !== "passphrase_required") throw new Error("kind");
    expect(stale.storedRejected).toBe(true);
    expect(stale.wrong).toBe(false);
    // 옛 백엔드에는 없던 칸이라 없으면 거짓이다.
    const plain = parseSessionError(locked, ko);
    if (plain.kind !== "passphrase_required") throw new Error("kind");
    expect(plain.storedRejected).toBe(false);
  });

  it("비밀번호 쪽도 같은 칸을 받아 낸다", () => {
    const err = parseSessionError(
      { kind: "password_required", message: "…", stored_rejected: true },
      ko,
    );
    if (err.kind !== "password_required") throw new Error("kind");
    expect(err.storedRejected).toBe(true);
    expect(
      parseSessionError({ kind: "password_required", message: "…" }, ko),
    ).toMatchObject({ storedRejected: false });
  });

  it("경로가 없는 페이로드는 이 갈래가 아니다 — 옛 백엔드로 떨어진다", () => {
    // `path` 가 없으면 재시도할 방법이 없다(어느 키인지 모른다) → 평범한 실패로 본다.
    const err = parseSessionError({ kind: "passphrase_required" }, ko);
    expect(err.kind).toBe("other");
  });

  it("끝까지 틀렸을 때의 문구는 **경로만** 말한다", () => {
    const err = parseSessionError({ ...locked, wrong: true }, ko);
    const line = describeSessionError(err, ko);
    expect(line).toContain("C:\Users\wl\.ssh\id_ed25519_x");
    expect(describeSessionError({ kind: "passphrase_cancelled" } as SessionError, ko)).toContain(
      "취소",
    );
    // 영어에서도 같은 자리
    expect(describeSessionError(err, en)).toContain("passphrase");
  });
});

describe("sessionInfoLines — 말풍선 두 줄", () => {
  const NOW = 1_700_000_000_000;
  const base: SessionInfo = {
    server_version: "OpenSSH_9.6p1",
    auth_method: "agent",
    identity: "~/.ssh/id_ed25519",
    jump: null,
    connected_at_ms: NOW - 12 * 60_000,
    keepalive_secs: 30,
    rtt_ms: 38,
  };

  it("가진 것을 전부 편다", () => {
    expect(sessionInfoLines({ ...base, jump: "bastion" }, ko, NOW)).toEqual([
      "인증: 키 (~/.ssh/id_ed25519) · 경유: bastion",
      "서버: OpenSSH_9.6p1 · 접속 12분 전 · 지연 38ms",
    ]);
  });

  it("없는 칸은 줄에서 통째로 빠진다", () => {
    const bare: SessionInfo = {
      server_version: "",
      auth_method: "password",
      identity: null,
      jump: null,
      connected_at_ms: NOW - 5_000,
      keepalive_secs: 30,
      rtt_ms: null,
    };
    expect(sessionInfoLines(bare, ko, NOW)).toEqual(["인증: 비밀번호", "접속 방금"]);
  });

  it("파일 키로 붙으면 '키 파일 (경로)' 이다 — 에이전트 키와 한 눈에 갈린다", () => {
    expect(sessionInfoLines({ ...base, auth_method: "key_file" }, ko, NOW)[0]).toBe(
      "인증: 키 파일 (~/.ssh/id_ed25519)",
    );
    expect(sessionInfoLines({ ...base, auth_method: "key_file" }, en, NOW)[0]).toBe(
      "Auth: key file (~/.ssh/id_ed25519)",
    );
  });

  it("금고에서 꺼낸 비밀번호는 '비밀번호 (저장됨)' 이다 — 방금 친 것과 갈린다", () => {
    // 2026-09-19 ② (docs/log/2026-09-19-vault.md): "왜 안 묻지?" 의 답이 같은 줄에 있어야
    // 한다. `identity` 는 없다 — 비밀번호 인증에는 키 설명이 없다.
    const vaulted: SessionInfo = { ...base, auth_method: "password_vault", identity: null };
    expect(sessionInfoLines(vaulted, ko, NOW)[0]).toBe("인증: 비밀번호 (저장됨)");
    expect(sessionInfoLines(vaulted, en, NOW)[0]).toBe("Auth: password (saved)");
  });

  it("금고의 암호구로 연 키 파일에는 '저장됨' 이 붙는다", () => {
    const stored: SessionInfo = { ...base, auth_method: "key_file", identity_stored: true };
    expect(sessionInfoLines(stored, ko, NOW)[0]).toBe("인증: 키 파일 (~/.ssh/id_ed25519, 저장됨)");
    expect(sessionInfoLines(stored, en, NOW)[0]).toBe("Auth: key file (~/.ssh/id_ed25519, saved)");
    // 옛 백엔드에는 없던 칸이다 — 없으면 예전과 글자 그대로 같다.
    expect(sessionInfoLines({ ...base, auth_method: "key_file" }, ko, NOW)[0]).toBe(
      "인증: 키 파일 (~/.ssh/id_ed25519)",
    );
  });

  it("keepalive 는 **꺼져 있을 때만** 적는다", () => {
    expect(sessionInfoLines({ ...base, keepalive_secs: null }, ko, NOW)[1]).toContain(
      "keepalive 꺼짐",
    );
    expect(sessionInfoLines(base, ko, NOW)[1]).not.toContain("keepalive");
  });

  it("RTT 0 은 '못 쟀다' 가 아니다", () => {
    expect(sessionInfoLines({ ...base, rtt_ms: 0 }, ko, NOW)[1]).toContain("지연 0ms");
  });

  it("영어에서도 같은 조각이 같은 자리에 선다", () => {
    expect(sessionInfoLines({ ...base, jump: "bastion" }, en, NOW)).toEqual([
      "Auth: key (~/.ssh/id_ed25519) · via bastion",
      "Server: OpenSSH_9.6p1 · connected 12m ago · latency 38ms",
    ]);
  });

  // ── 연결 공유 (docs/log/2026-09-23-ssh-connection-sharing.md) ──────────────
  it("혼자 쓰는 연결에는 공유 줄이 아예 없다", () => {
    // 옛 백엔드에는 없던 칸이다 — 없으면 예전과 글자 그대로 같다.
    expect(sessionInfoLines(base, ko, NOW)).toHaveLength(2);
    expect(sessionInfoLines({ ...base, shared_with: 0, joined: false }, ko, NOW)).toHaveLength(2);
  });

  it("같은 연결을 쓰는 타일이 있으면 줄 하나가 더 선다", () => {
    const shared = sessionInfoLines({ ...base, shared_with: 2 }, ko, NOW);
    expect(shared).toHaveLength(3);
    expect(shared[2]).toBe("연결 공유: 다른 타일 2개와 같은 연결");
    expect(sessionInfoLines({ ...base, shared_with: 1 }, en, NOW)[2]).toBe(
      "Shared connection: with 1 other tile(s)",
    );
  });

  it("같은 연결을 빌린 DB 연결은 타일 수와 따로 줄 하나로 (쿼리 타일 9단계)", () => {
    // 서버가 타일 수(`shared_with`)에서 DB 핀을 뺐다 — 화면은 'DB 연결 N' 을 따로 보인다.
    const lines = sessionInfoLines({ ...base, shared_with: 0, db_conns: 2 }, ko, NOW);
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe("이 연결을 쓰는 DB 연결 2개");
    const both = sessionInfoLines({ ...base, shared_with: 1, db_conns: 1 }, en, NOW);
    expect(both.slice(2)).toEqual(["Shared connection: with 1 other tile(s)", "1 database connection(s) use this connection"]);
    expect(sessionInfoLines({ ...base, db_conns: 0 }, ko, NOW)).toHaveLength(2);
    const card = sessionInfoCard({ ...base, shared_with: 0, db_conns: 3 }, ko, NOW).rows.map((r) => [r.key, r.label, r.value]);
    expect(card).toContainEqual(["db", "DB", "DB 연결 3"]);
    expect(card.some(([k]) => k === "shared")).toBe(false);
  });

  it("얹혀 붙은 타일은 인증 줄 앞에서 출처를 밝힌다", () => {
    // 그 인증은 **이 타일이 한 것이 아니다** — 연결을 세운 타일의 것이다.
    expect(sessionInfoLines({ ...base, joined: true, shared_with: 1 }, ko, NOW)[0]).toBe(
      "(공유 연결) 인증: 키 (~/.ssh/id_ed25519)",
    );
    expect(sessionInfoLines({ ...base, joined: true }, en, NOW)[0]).toBe(
      "(shared) Auth: key (~/.ssh/id_ed25519)",
    );
    // 경유 조각은 그대로 같은 줄에 매달린다 (앞머리만 붙는다).
    expect(sessionInfoLines({ ...base, joined: true, jump: "bastion" }, ko, NOW)[0]).toBe(
      "(공유 연결) 인증: 키 (~/.ssh/id_ed25519) · 경유: bastion",
    );
  });

  it("에이전트 포워딩을 켠 세션은 인증 줄에 한 마디를 단다 (없으면 예전 그대로)", () => {
    expect(sessionInfoLines({ ...base, agent_forward: true }, ko, NOW)[0]).toBe(
      "인증: 키 (~/.ssh/id_ed25519) · 에이전트 포워딩 켬",
    );
    expect(sessionInfoLines({ ...base, agent_forward: true }, en, NOW)[0]).toContain(
      "Agent forwarding on",
    );
    expect(sessionInfoLines({ ...base, agent_forward: false }, ko, NOW)[0]).toBe(
      "인증: 키 (~/.ssh/id_ed25519)",
    );
  });

  it("연결을 세운 타일은 옆에 타일이 붙어도 '(공유 연결)' 을 달지 않는다", () => {
    // `joined` 는 "누가 인증했나" 이고 `shared_with` 는 "지금 몇이 쓰나" 다 — 축이 다르다.
    const lines = sessionInfoLines({ ...base, joined: false, shared_with: 1 }, ko, NOW);
    expect(lines[0]).toBe("인증: 키 (~/.ssh/id_ed25519)");
    expect(lines[2]).toBe("연결 공유: 다른 타일 1개와 같은 연결");
  });
});

describe("sessionInfoCard — 이름 카드의 라벨 | 값 줄 (2026-09-28)", () => {
  const NOW = 1_700_000_000_000;
  const full: SessionInfo = {
    server_version: "OpenSSH_9.6",
    auth_method: "agent",
    identity: "~/.ssh/id_ed25519",
    jump: "bastion",
    connected_at_ms: NOW - 12 * 60_000,
    keepalive_secs: 30,
    rtt_ms: 23,
    shared_with: 2,
    agent_forward: true,
  };
  /** 줄을 `[라벨, 값, 톤]` 으로 */
  const flat = (info: SessionInfo, tr: Tr = ko) =>
    sessionInfoCard(info, tr, NOW).rows.map((r) => [r.label, r.value, r.tone]);

  it("가진 것을 전부 정해진 순서로 편다", () => {
    expect(flat(full)).toEqual([
      ["인증", "키 · ~/.ssh/id_ed25519", "normal"],
      ["경유", "bastion", "normal"],
      ["접속", "12분 전", "normal"],
      ["지연", "23ms", "normal"],
      ["서버", "OpenSSH_9.6", "normal"],
      ["공유", "다른 타일 2개와 같은 연결", "normal"],
      ["포워딩", "에이전트", "normal"],
    ]);
    expect(sessionInfoCard(full, ko, NOW).warnings).toEqual([]);
    expect(sessionInfoCard(full, ko, NOW).rows.map((r) => r.key)).toEqual([
      "auth", "jump", "connected", "rtt", "server", "shared", "forward",
    ]);
  });

  it("없는 값의 줄은 통째로 빠진다", () => {
    const bare: SessionInfo = {
      server_version: "",
      auth_method: "password",
      identity: null,
      jump: null,
      connected_at_ms: NOW - 5_000,
      keepalive_secs: 30,
      rtt_ms: null,
    };
    expect(flat(bare)).toEqual([
      ["인증", "비밀번호", "normal"],
      ["접속", "방금", "normal"],
    ]);
    expect(sessionInfoCard(bare, ko, NOW).warnings).toEqual([]);
  });

  it("얹혀 붙은 타일은 인증 값 앞에서 출처를 밝힌다", () => {
    const [auth] = sessionInfoCard({ ...full, joined: true }, ko, NOW).rows;
    expect(auth.value).toBe("공유 연결 — 키 · ~/.ssh/id_ed25519");
    expect(sessionInfoCard({ ...full, joined: true }, en, NOW).rows[0].value).toBe(
      "shared connection — key · ~/.ssh/id_ed25519",
    );
  });

  it("금고의 암호구로 연 키에는 '(저장됨)' 이 붙는다 — 공유 연결이면 그 안쪽에", () => {
    const stored: SessionInfo = { ...full, auth_method: "key_file", identity_stored: true };
    expect(sessionInfoCard(stored, ko, NOW).rows[0].value).toBe("키 파일 · ~/.ssh/id_ed25519 (저장됨)");
    expect(sessionInfoCard({ ...stored, joined: true }, ko, NOW).rows[0].value).toBe(
      "공유 연결 — 키 파일 · ~/.ssh/id_ed25519 (저장됨)",
    );
    expect(sessionInfoCard(stored, en, NOW).rows[0].value).toBe("key file · ~/.ssh/id_ed25519 (saved)");
  });

  it(`지연이 ${RTT_WARN_MS}ms 이상이면 경고색이다 (바로 아래는 아니다)`, () => {
    const rtt = (ms: number) => sessionInfoCard({ ...full, rtt_ms: ms }, ko, NOW).rows.find((r) => r.key === "rtt");
    expect(rtt(RTT_WARN_MS)).toMatchObject({ value: `${RTT_WARN_MS}ms`, tone: "warn" });
    expect(rtt(RTT_WARN_MS - 1)?.tone).toBe("normal");
    // 0 은 "못 쟀다" 가 아니다
    expect(rtt(0)).toMatchObject({ value: "0ms", tone: "normal" });
  });

  it("keepalive 는 줄이 아니라 **꺼졌을 때만** 맨 아래 경고 한 줄이다", () => {
    const off = sessionInfoCard({ ...full, keepalive_secs: null }, ko, NOW);
    expect(off.warnings).toEqual(["keepalive 꺼짐"]);
    expect(off.rows.some((r) => r.value.includes("keepalive"))).toBe(false);
    expect(sessionInfoCard({ ...full, keepalive_secs: null }, en, NOW).warnings).toEqual(["keepalive off"]);
  });

  it("영어 라벨", () => {
    expect(sessionInfoCard(full, en, NOW).rows.map((r) => r.label)).toEqual([
      "Auth", "Via", "Connected", "Latency", "Server", "Shared", "Forwarding",
    ]);
  });
});

describe("localInfoCard — 로컬 터미널 이름 카드 (2026-10-11)", () => {
  it("셸 타일 — 셸 · 폴더 두 줄", () => {
    const card = localInfoCard({ ai: null, shell: "PowerShell", folder: "C:\Users\me\proj" }, ko);
    expect(card.rows.map((r) => [r.key, r.label, r.value])).toEqual([
      ["shell", "셸", "PowerShell"],
      ["folder", "폴더", "C:\Users\me\proj"],
    ]);
    expect(card.warnings).toEqual([]);
  });

  it("AI 가 돌아도 셸 줄(이름과 겹치는 AI 줄은 없다) · 폴더를 모르면 줄이 없다", () => {
    const card = localInfoCard({ ai: "Claude Code", shell: "PowerShell", folder: null }, en);
    expect(card.rows.map((r) => [r.key, r.label, r.value])).toEqual([["shell", "Shell", "PowerShell"]]);
  });

  it("접근성 글자 — 머리 한 줄 + 라벨: 값", () => {
    const card = localInfoCard({ ai: null, shell: "Bash", folder: "/home/me" }, en);
    expect(infoCardText("Bash · p3", card)).toBe("Bash · p3\nShell: Bash\nFolder: /home/me");
  });
});
