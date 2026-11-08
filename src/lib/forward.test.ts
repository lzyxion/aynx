import { describe, expect, it } from "vitest";
import {
  diffForwardPresets,
  duplicateBindIndex,
  emptyForwardRow,
  forwardBindKey,
  forwardBrowserUrl,
  forwardKindFlag,
  forwardLabel,
  forwardRowOf,
  forwardStateLabel,
  invalidPort,
  isAppForward,
  isForwardActive,
  parseForwardRow,
  parseForwardRows,
  relayingConns,
  sameForwardTarget,
  userForwards,
  type ForwardInfo,
  type ForwardKind,
  type ForwardPreset,
} from "$lib/forward";
import { translate } from "$lib/i18n/dict";
import type { Tr } from "$lib/session";

/** 포트 포워딩 표시 규칙 (docs/log/2026-09-01-port-forward.md) */

function forward(patch: Partial<ForwardInfo> = {}): ForwardInfo {
  return {
    id: 1,
    session_id: 900_001,
    kind: "local",
    local_port: 15432,
    remote_host: "localhost",
    remote_port: 5432,
    conns: 0,
    active_conns: 0,
    ...patch,
  };
}

describe("forwardBrowserUrl (docs/log/2026-09-27-forward-open-browser.md)", () => {
  it("로컬(-L)은 루프백의 로컬 포트를 http 로 연다", () => {
    expect(forwardBrowserUrl(forward({ local_port: 18080, remote_port: 8080 }))).toBe(
      "http://127.0.0.1:18080/",
    );
  });

  it("목적지가 443 · 8443 이면 https 로 어림한다", () => {
    expect(forwardBrowserUrl(forward({ local_port: 18443, remote_port: 443 }))).toBe(
      "https://127.0.0.1:18443/",
    );
    expect(forwardBrowserUrl(forward({ local_port: 18444, remote_port: 8443 }))).toBe(
      "https://127.0.0.1:18444/",
    );
  });

  it("원격(-R)은 서버 쪽이 들으므로 열 주소가 없다", () => {
    expect(
      forwardBrowserUrl(forward({ kind: "remote", remote_host: "", remote_port: 18080, local_port: 8080 })),
    ).toBeNull();
  });

  it("동적(-D)은 SOCKS 프록시라 열 주소가 없다", () => {
    expect(
      forwardBrowserUrl(forward({ kind: "dynamic", remote_host: "", remote_port: 0, local_port: 1080 })),
    ).toBeNull();
  });
});

describe("forwardLabel", () => {
  const ko: Tr = (key, params) => translate("ko", key, params);
  const en: Tr = (key, params) => translate("en", key, params);

  it("`127.0.0.1:로컬 → 원격:포트` 한 줄", () => {
    expect(forwardLabel(forward(), ko)).toBe("127.0.0.1:15432 → localhost:5432");
  });

  it("원격 호스트가 IP 여도 같은 모양이다", () => {
    expect(
      forwardLabel(forward({ remote_host: "10.0.0.5", remote_port: 80, local_port: 8080 }), ko),
    ).toBe("127.0.0.1:8080 → 10.0.0.5:80");
  });

  it("원격(-R)은 서버 → 내 PC 방향을 양쪽 이름과 함께 말한다", () => {
    const f = forward({ kind: "remote", remote_host: "", remote_port: 18080, local_port: 8080 });
    expect(forwardLabel(f, ko)).toBe("원격 127.0.0.1:18080 → 내 PC 127.0.0.1:8080");
    expect(forwardLabel(f, en)).toBe("remote 127.0.0.1:18080 → this PC 127.0.0.1:8080");
  });

  it("동적(-D)은 SOCKS 포트 하나", () => {
    const f = forward({ kind: "dynamic", remote_host: "", remote_port: 0, local_port: 1080 });
    expect(forwardLabel(f, ko)).toBe("SOCKS 127.0.0.1:1080");
    expect(forwardLabel(f, en)).toBe("SOCKS 127.0.0.1:1080");
  });
});

describe("isForwardActive", () => {
  it("지금 열려 있는 연결이 있으면 활성이다", () => {
    expect(isForwardActive(forward({ active_conns: 1 }))).toBe(true);
  });

  it("누적 `conns` 는 판단 기준이 아니다 — '한 번이라도 붙었다' 만 말한다", () => {
    expect(isForwardActive(forward({ conns: 42, active_conns: 0 }))).toBe(false);
  });
});

describe("forwardStateLabel", () => {
  // 문구는 **인자로** 들어간다 (기본값이 없다 — 모달이 `t` 를 넘긴다).
  const ko: Tr = (key, params) => translate("ko", key, params);

  it("활성이면 개수를 함께 적는다", () => {
    expect(forwardStateLabel(forward({ active_conns: 2 }), ko)).toBe("활성 2");
  });

  it("리스너만 서 있으면 '대기 중'", () => {
    expect(forwardStateLabel(forward({ conns: 7, active_conns: 0 }), ko)).toBe("대기 중");
  });
});

describe("invalidPort — 폼의 즉시 피드백", () => {
  it("1–65535 의 정수만 통과한다", () => {
    expect(invalidPort(1)).toBe(false);
    expect(invalidPort(22)).toBe(false);
    expect(invalidPort(65535)).toBe(false);
  });

  it("범위 밖·0·음수는 거절한다", () => {
    expect(invalidPort(0)).toBe(true);
    expect(invalidPort(-1)).toBe(true);
    expect(invalidPort(65536)).toBe(true);
  });

  it("빈 칸(`null`)과 소수·NaN 도 거절한다", () => {
    // `<input type="number">` 바인딩이 빈 값을 `null` 로 준다.
    expect(invalidPort(null)).toBe(true);
    expect(invalidPort(80.5)).toBe(true);
    expect(invalidPort(Number.NaN)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 호스트별 프리셋 (docs/log/2026-09-17-forward-presets.md)
//
// 규칙은 Rust `port_forward::validate` + `sessions_meta::validate_forwards` 와 **같다** —
// 여기 있는 것은 왕복 없이 그 자리에서 알려 주기 위한 한 벌이다.
// ---------------------------------------------------------------------------

describe("parseForwardRow", () => {
  const ko: Tr = (key, params) => translate("ko", key, params);

  const row = (
    localPort: number | null,
    remoteHost: string,
    remotePort: number | null,
    kind: ForwardKind = "local",
  ) => ({ kind, localPort, remoteHost, remotePort });

  it("정상 줄은 프리셋이 된다 (원격 호스트의 앞뒤 공백은 다듬는다)", () => {
    const r = parseForwardRow(row(15432, "  localhost ", 5432), ko);
    expect(r).toEqual({
      ok: true,
      preset: { kind: "local", local_port: 15432, remote_host: "localhost", remote_port: 5432 },
    });
  });

  it("빈 칸·범위 밖 포트는 어느 칸인지 말한다", () => {
    expect(parseForwardRow(row(null, "localhost", 5432), ko))
      .toMatchObject({ ok: false, error: expect.stringContaining("로컬 포트") });
    expect(parseForwardRow(row(15432, "localhost", 0), ko))
      .toMatchObject({ ok: false, error: expect.stringContaining("원격 포트") });
  });

  it("빈 원격 호스트는 거절한다", () => {
    expect(parseForwardRow(row(15432, "   ", 5432), ko))
      .toMatchObject({ ok: false, error: expect.stringContaining("원격 호스트") });
  });

  it("가운데 공백은 다듬을 수 없으므로 거절한다 (Rust 와 같은 규칙)", () => {
    expect(parseForwardRow(row(15432, "db 01", 5432), ko))
      .toMatchObject({ ok: false, error: expect.stringContaining("공백") });
  });

  it("원격(-R): 두 포트가 다 필요하고 감춘 호스트 칸은 비워서 내보낸다", () => {
    expect(parseForwardRow(row(8080, "localhost", 18080, "remote"), ko)).toEqual({
      ok: true,
      preset: { kind: "remote", local_port: 8080, remote_host: "", remote_port: 18080 },
    });
    expect(parseForwardRow(row(8080, "", null, "remote"), ko))
      .toMatchObject({ ok: false, error: expect.stringContaining("원격 포트") });
    expect(parseForwardRow(row(null, "", 18080, "remote"), ko))
      .toMatchObject({ ok: false, error: expect.stringContaining("로컬 포트") });
  });

  it("동적(-D): 로컬 포트 하나만 본다 — 원격 칸은 무엇이 있든 비운다", () => {
    expect(parseForwardRow(row(1080, "db 01", null, "dynamic"), ko)).toEqual({
      ok: true,
      preset: { kind: "dynamic", local_port: 1080, remote_host: "", remote_port: 0 },
    });
    expect(parseForwardRow(row(0, "", null, "dynamic"), ko))
      .toMatchObject({ ok: false, error: expect.stringContaining("로컬 포트") });
  });
});

describe("duplicateBindIndex / forwardBindKey", () => {
  const p = (local: number, kind: ForwardKind = "local", remote = 1): ForwardPreset => ({
    kind,
    local_port: local,
    remote_host: kind === "local" ? "localhost" : "",
    remote_port: remote,
  });

  it("겹치는 것이 없으면 -1", () => {
    expect(duplicateBindIndex([p(15432), p(16379), p(18080)])).toBe(-1);
  });

  it("앞줄과 겹치는 **뒷줄**의 번호를 준다 (그 줄에 표시를 붙인다)", () => {
    expect(duplicateBindIndex([p(15432), p(16379), p(15432)])).toBe(2);
  });

  it("로컬·동적은 내 PC 포트를, 원격은 서버 포트를 잡는다", () => {
    expect(forwardBindKey(p(1080, "dynamic"))).toBe(forwardBindKey(p(1080)));
    expect(forwardBindKey(p(8080, "remote", 18080))).toBe("R:18080");
    // 로컬 18080 과 원격(서버 18080)은 다른 자리
    expect(duplicateBindIndex([p(18080), p(3000, "remote", 18080)])).toBe(-1);
    // 원격 둘이 같은 로컬 포트로 이어 주는 것은 괜찮다
    expect(duplicateBindIndex([p(3000, "remote", 18080), p(3000, "remote", 18081)])).toBe(-1);
    // 로컬 1080 과 동적 1080 은 같은 리스너
    expect(duplicateBindIndex([p(1080), p(1080, "dynamic")])).toBe(1);
  });

  it("종류가 없는 옛 줄은 로컬로 본다", () => {
    expect(forwardBindKey({ local_port: 15432, remote_port: 5432 })).toBe("L:15432");
  });
});

describe("parseForwardRows — 폼 전체", () => {
  const ko: Tr = (key, params) => translate("ko", key, params);

  it("빈 목록도 성공이다 (= 이 호스트는 자동으로 아무것도 열지 않는다)", () => {
    expect(parseForwardRows([], ko)).toEqual({ ok: true, presets: [] });
  });

  it("첫 실패의 줄 번호를 함께 준다", () => {
    const r = parseForwardRows(
      [
        { kind: "local", localPort: 15432, remoteHost: "localhost", remotePort: 5432 },
        { kind: "local", localPort: 18080, remoteHost: "", remotePort: 8080 },
      ],
      ko,
    );
    expect(r).toMatchObject({ ok: false, index: 1 });
  });

  it("같은 로컬 포트가 두 번이면 그 뒷줄을 가리키며 거절한다", () => {
    const r = parseForwardRows(
      [
        { kind: "local", localPort: 15432, remoteHost: "localhost", remotePort: 5432 },
        { kind: "local", localPort: 15432, remoteHost: "localhost", remotePort: 6379 },
      ],
      ko,
    );
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(r.ok === false && r.error).toContain("15432");
  });

  it("같은 서버 포트의 원격 둘은 '원격 포트' 문구로 거절한다", () => {
    const r = parseForwardRows(
      [
        { kind: "remote", localPort: 3000, remoteHost: "", remotePort: 18080 },
        { kind: "remote", localPort: 3001, remoteHost: "", remotePort: 18080 },
      ],
      ko,
    );
    expect(r).toMatchObject({ ok: false, index: 1 });
    expect(r.ok === false && r.error).toContain("원격 포트 18080");
  });
});

describe("emptyForwardRow / forwardRowOf", () => {
  it("새 줄은 로컬이고 원격 호스트만 미리 채워진다 (DB 포워딩의 전형)", () => {
    expect(emptyForwardRow()).toEqual({
      kind: "local",
      localPort: null,
      remoteHost: "localhost",
      remotePort: null,
    });
  });

  it("저장된 프리셋은 그대로 폼 줄이 된다 (종류가 없으면 로컬)", () => {
    expect(forwardRowOf({ local_port: 15432, remote_host: "db", remote_port: 5432 })).toEqual({
      kind: "local",
      localPort: 15432,
      remoteHost: "db",
      remotePort: 5432,
    });
  });

  it("원격·동적 줄은 감춘 칸에 쓸 만한 기본값을 둔다", () => {
    expect(
      forwardRowOf({ kind: "remote", local_port: 8080, remote_host: "", remote_port: 18080 }),
    ).toEqual({ kind: "remote", localPort: 8080, remoteHost: "localhost", remotePort: 18080 });
    expect(
      forwardRowOf({ kind: "dynamic", local_port: 1080, remote_host: "", remote_port: 0 }),
    ).toEqual({ kind: "dynamic", localPort: 1080, remoteHost: "localhost", remotePort: null });
  });
});

/**
 * 저장할 때 살아 있는 세션에 반영하는 **차이 규칙**
 * (docs/log/2026-09-17-forward-presets.md 의 "저장 시 열린 세션에 반영")
 */

const p = (local_port: number, remote_host: string, remote_port: number): ForwardPreset => ({
  local_port,
  remote_host,
  remote_port,
});

describe("sameForwardTarget", () => {
  it("세 칸이 전부 같아야 같은 터널이다", () => {
    expect(sameForwardTarget(p(15432, "localhost", 5432), p(15432, "localhost", 5432))).toBe(true);
    expect(sameForwardTarget(p(15432, "localhost", 5432), p(15433, "localhost", 5432))).toBe(false);
    expect(sameForwardTarget(p(15432, "localhost", 5432), p(15432, "db", 5432))).toBe(false);
    expect(sameForwardTarget(p(15432, "localhost", 5432), p(15432, "localhost", 5433))).toBe(false);
  });

  it("원격 호스트는 대소문자·앞뒤 공백을 타지 않는다 (DNS 규칙)", () => {
    expect(sameForwardTarget(p(15432, "DB01", 5432), p(15432, " db01 ", 5432))).toBe(true);
  });

  it("살아 있는 포워드와도 같은 판정이다 (칸 이름이 같다)", () => {
    const live = forward({ local_port: 15432, remote_host: "LocalHost", remote_port: 5432 });
    expect(sameForwardTarget(live, p(15432, "localhost", 5432))).toBe(true);
  });

  it("종류가 다르면 포트가 같아도 다른 터널이다", () => {
    const local: ForwardPreset = { kind: "local", local_port: 1080, remote_host: "x", remote_port: 80 };
    const dyn: ForwardPreset = { kind: "dynamic", local_port: 1080, remote_host: "", remote_port: 0 };
    expect(sameForwardTarget(local, dyn)).toBe(false);
  });

  it("원격은 두 포트만, 동적은 로컬 포트만 본다", () => {
    const r = (l: number, rp: number): ForwardPreset => ({
      kind: "remote",
      local_port: l,
      remote_host: "",
      remote_port: rp,
    });
    expect(sameForwardTarget(r(8080, 18080), r(8080, 18080))).toBe(true);
    expect(sameForwardTarget(r(8080, 18080), r(8080, 18081))).toBe(false);
    const d = (l: number): ForwardPreset => ({
      kind: "dynamic",
      local_port: l,
      remote_host: "",
      remote_port: 0,
    });
    expect(sameForwardTarget(d(1080), d(1080))).toBe(true);
    // 종류를 적지 않은 옛 줄은 로컬 — 명시한 로컬과 같다
    expect(sameForwardTarget(p(15432, "db", 5432), { ...p(15432, "db", 5432), kind: "local" })).toBe(
      true,
    );
  });
});

describe("diffForwardPresets", () => {
  it("맞은편에 없는 줄만 지운 것·더한 것이다", () => {
    const before = [p(15432, "localhost", 5432), p(18080, "localhost", 8080)];
    const after = [p(18080, "localhost", 8080), p(16379, "localhost", 6379)];
    expect(diffForwardPresets(before, after)).toEqual({
      removed: [p(15432, "localhost", 5432)],
      added: [p(16379, "localhost", 6379)],
    });
  });

  it("줄 순서만 바꾼 저장은 차이가 없다 (멀쩡한 터널을 끊지 않는다)", () => {
    const a = p(15432, "localhost", 5432);
    const b = p(18080, "localhost", 8080);
    expect(diffForwardPresets([a, b], [b, a])).toEqual({ removed: [], added: [] });
  });

  it("원격 포트만 고친 줄은 지운 것 하나 + 더한 것 하나로 갈린다", () => {
    const before = [p(15432, "localhost", 5432)];
    const after = [p(15432, "localhost", 5433)];
    expect(diffForwardPresets(before, after)).toEqual({ removed: before, added: after });
  });

  it("전부 지우면 전부 removed, 없던 호스트에 처음 적으면 전부 added", () => {
    const list = [p(15432, "localhost", 5432)];
    expect(diffForwardPresets(list, [])).toEqual({ removed: list, added: [] });
    expect(diffForwardPresets([], list)).toEqual({ removed: [], added: list });
    expect(diffForwardPresets([], [])).toEqual({ removed: [], added: [] });
  });
});

describe("forwardKindFlag · relayingConns (머리줄 포워딩 칩의 카드·메뉴)", () => {
  it("종류마다 ssh 의 글자 — 적혀 있지 않으면 로컬", () => {
    expect(forwardKindFlag(forward({ kind: "local" }))).toBe("-L");
    expect(forwardKindFlag(forward({ kind: "remote" }))).toBe("-R");
    expect(forwardKindFlag(forward({ kind: "dynamic" }))).toBe("-D");
    expect(forwardKindFlag({})).toBe("-L");
  });

  it("지금 오가는 연결 수를 더한다 (누적 conns 는 보지 않는다)", () => {
    expect(relayingConns([])).toBe(0);
    expect(
      relayingConns([forward({ active_conns: 2, conns: 9 }), forward({ id: 2, active_conns: 0, conns: 4 })]),
    ).toBe(2);
  });
});

describe("userForwards — 앱이 건 포워드(에이전트 신호)는 화면에 보이지 않는다 (2026-10-27)", () => {
  const signal = forward({ id: 9, kind: "remote", remote_host: "", remote_port: 41234, local_port: 53812, purpose: "agent-signal" });

  it("isAppForward 는 purpose 칸이 있는 것만 가른다", () => {
    expect(isAppForward(signal)).toBe(true);
    expect(isAppForward(forward({ kind: "remote" }))).toBe(false);
  });

  it("사람이 건 포워드만 남는다", () => {
    const a = forward({ id: 1 });
    const b = forward({ id: 2, kind: "dynamic", remote_host: "", remote_port: 0, local_port: 1080 });
    expect(userForwards([a, signal, b])).toEqual([a, b]);
  });

  it("에이전트 신호만 있으면 빈 배열 — 칩도 타이머도 서지 않는다", () => {
    expect(userForwards([signal])).toEqual([]);
    expect(userForwards([])).toEqual([]);
  });

  it("순서를 지키고 원본을 바꾸지 않는다", () => {
    const list = [forward({ id: 3 }), signal, forward({ id: 1 }), forward({ id: 2 })];
    expect(userForwards(list).map((f) => f.id)).toEqual([3, 1, 2]);
    expect(list).toHaveLength(4);
  });
});
