import { describe, expect, it } from "vitest";
import {
  aiHostAlias,
  anyGrant,
  noGrants,
  sameGrants,
  stageAtLeast,
  stageNeedsConfirm,
  stageOf,
  withDependencies,
  withStage,
  type DelegationGrants,
} from "$lib/delegation";

/** 읽기 쉬운 줄 하나 — 빠진 칸은 꺼짐 */
function g(on: Partial<DelegationGrants>): DelegationGrants {
  return { ...noGrants(), ...on };
}

describe("stageOf — 누적 규칙의 가장 높은 단계", () => {
  it("위임이 없으면 off", () => {
    expect(stageOf(null)).toBe("off");
    expect(stageOf(undefined)).toBe("off");
    expect(stageOf(noGrants())).toBe("off");
  });

  it("read · read+propose · read+propose+auto", () => {
    expect(stageOf(g({ read: true }))).toBe("read");
    expect(stageOf(g({ read: true, propose: true }))).toBe("approve");
    expect(stageOf(g({ read: true, propose: true, auto_execute: true }))).toBe("auto");
  });

  it("옛 비누적 조합은 누적으로 읽힌다 — 실제보다 넓게 말하지 않는다", () => {
    // read 없이 propose·auto → off (Rust 판정도 read 가 없으면 아무것도 안 된다)
    expect(stageOf(g({ connect: true, propose: true, auto_execute: true }))).toBe("off");
    // propose 없이 auto → read
    expect(stageOf(g({ read: true, auto_execute: true }))).toBe("read");
    // 헤드리스 묶음은 단계에 들지 않는다
    expect(stageOf(g({ connect: true, vault_passphrase: true }))).toBe("off");
  });
});

describe("stageAtLeast", () => {
  it("순서 off < read < approve < auto", () => {
    expect(stageAtLeast("read", "read")).toBe(true);
    expect(stageAtLeast("approve", "read")).toBe(true);
    expect(stageAtLeast("read", "approve")).toBe(false);
    expect(stageAtLeast("off", "read")).toBe(false);
    expect(stageAtLeast("auto", "approve")).toBe(true);
  });
});

describe("withDependencies — 의존 접기", () => {
  it("propose 는 read 없이, auto 는 propose 없이 켜지지 않는다", () => {
    expect(withDependencies(g({ propose: true, auto_execute: true }))).toEqual(noGrants());
    expect(withDependencies(g({ read: true, auto_execute: true }))).toEqual(g({ read: true }));
  });

  it("connect 는 단계 ≥ approve 일 때만, vault 는 connect 위에서만", () => {
    expect(withDependencies(g({ read: true, connect: true, vault_passphrase: true }))).toEqual(
      g({ read: true }),
    );
    const full = g({ read: true, propose: true, connect: true, vault_passphrase: true });
    expect(withDependencies(full)).toEqual(full);
    expect(withDependencies(g({ read: true, propose: true, vault_passphrase: true }))).toEqual(
      g({ read: true, propose: true }),
    );
  });
});

describe("withStage — 단계 → 권한 다섯", () => {
  it("단계 셋은 단계에서 온다", () => {
    expect(withStage(null, "off")).toEqual(noGrants());
    expect(withStage(null, "read")).toEqual(g({ read: true }));
    expect(withStage(null, "approve")).toEqual(g({ read: true, propose: true }));
    expect(withStage(null, "auto")).toEqual(g({ read: true, propose: true, auto_execute: true }));
  });

  it("헤드리스 묶음은 지키되 approve 아래로 내리면 함께 꺼진다", () => {
    const before = g({ read: true, propose: true, connect: true, vault_passphrase: true });
    expect(withStage(before, "auto")).toEqual({ ...before, auto_execute: true });
    expect(withStage(before, "approve")).toEqual(before);
    expect(withStage(before, "read")).toEqual(g({ read: true }));
    expect(withStage(before, "off")).toEqual(noGrants());
  });

  it("올리기만으로는 헤드리스 접속이 켜지지 않는다", () => {
    expect(withStage(g({ read: true }), "auto").connect).toBe(false);
  });
});

describe("모두 승인(10-23) — 자동 승인 실행 위의 다섯째 단계", () => {
  it("stageOf · withStage 가 approve_all 을 누적으로 읽고 쓴다", () => {
    const all = g({ read: true, propose: true, auto_execute: true, approve_all: true });
    expect(stageOf(all)).toBe("all");
    expect(stageOf(g({ read: true, propose: true, approve_all: true }))).toBe("approve");
    expect(withStage(null, "all")).toEqual(all);
    expect(withStage(all, "auto")).toEqual({ ...all, approve_all: false });
    expect(withStage(all, "read")).toEqual(g({ read: true }));
    expect(stageAtLeast("all", "auto")).toBe(true);
  });

  it("withDependencies — 자동 실행 없이는 켜지지 않는다", () => {
    expect(withDependencies(g({ read: true, propose: true, approve_all: true }))).toEqual(g({ read: true, propose: true }));
    expect(anyGrant(g({ approve_all: true }))).toBe(true);
    expect(sameGrants(g({ read: true }), { ...g({ read: true }), approve_all: undefined })).toBe(true);
  });

  it("모두 승인으로 새로 올릴 때만 확인 상자", () => {
    expect(stageNeedsConfirm("auto", "all")).toBe(true);
    expect(stageNeedsConfirm("off", "all")).toBe(true);
    expect(stageNeedsConfirm("all", "all")).toBe(false);
    expect(stageNeedsConfirm("all", "auto")).toBe(false);
    expect(stageNeedsConfirm("approve", "auto")).toBe(false);
  });
});

describe("aiHostAlias — 권한을 받을 수 있는 원격 타일", () => {
  it("설정의 별칭을 가진 SSH 타일만", () => {
    expect(aiHostAlias({ kind: "ssh", alias: "dev-01" })).toBe("dev-01");
    expect(aiHostAlias({ kind: "ssh", alias: "  dev-01 " })).toBe("dev-01");
  });

  it("빠른 접속 · 별칭 없음 · 로컬은 null", () => {
    expect(aiHostAlias({ kind: "ssh", alias: "me@1.2.3.4:22", adhoc: { host: "1.2.3.4" } })).toBeNull();
    expect(aiHostAlias({ kind: "ssh", alias: "" })).toBeNull();
    expect(aiHostAlias({ kind: "ssh" })).toBeNull();
    expect(aiHostAlias({ kind: "local", alias: "dev-01" })).toBeNull();
  });
});
