import { describe, expect, it } from "vitest";
import {
  dbAiNeedsCleanup,
  filterDbAiTargets,
  filterDelegationTargets,
  filterVaultItems,
  groupVaultItems,
  isOrphanHost,
  matchesQuery,
  vaultKindCounts,
  vaultStateView,
  VAULT_KINDS,
  VAULT_KIND_LABEL,
} from "$lib/settings/credentials-view";
import type { VaultItem } from "$lib/vault";
import type { DelegationTargetView } from "$lib/delegation";
import type { DbAiView } from "$lib/db-ai";

const items: VaultItem[] = [
  { kind: "mcp_env", target: "github/TOKEN" },
  { kind: "host_password", target: "web-01" },
  { kind: "key_passphrase", target: "C:\\Users\\me\\.ssh\\id_ed25519" },
  { kind: "host_password", target: "DB-Bastion" },
  { kind: "db_password", target: "conn-7f3a" },
];

/** 화면의 대상 표기 흉내 — DB 는 "경유 · 이름", 키는 `~/.ssh/…` */
const display = (i: VaultItem): string =>
  i.kind === "db_password" ? "bastion · orders" : i.kind === "key_passphrase" ? "~/.ssh/id_ed25519" : i.target;

function host(alias: string, known?: boolean): DelegationTargetView {
  return {
    alias,
    client: "",
    connect: false,
    read: true,
    propose: false,
    auto_execute: false,
    vault_passphrase: false,
    ...(known === undefined ? {} : { alias_known: known }),
  } as DelegationTargetView;
}

function db(id: string, name: string | undefined, connKnown: boolean, identityOk: boolean): DbAiView {
  return { id, name, level: "read", connKnown, identityOk };
}

describe("저장된 항목", () => {
  it("종류 순서 · 이름 키가 넷 다 있다", () => {
    expect(VAULT_KINDS).toEqual(["host_password", "key_passphrase", "db_password", "mcp_env"]);
    for (const k of VAULT_KINDS) expect(VAULT_KIND_LABEL[k]).toMatch(/^settings\.credentials\./);
  });

  it("개수는 있는 종류만, 종류 순서로", () => {
    expect(vaultKindCounts(items)).toEqual([
      { kind: "host_password", n: 2 },
      { kind: "key_passphrase", n: 1 },
      { kind: "db_password", n: 1 },
      { kind: "mcp_env", n: 1 },
    ]);
    expect(vaultKindCounts(items.filter((i) => i.kind === "mcp_env"))).toEqual([{ kind: "mcp_env", n: 1 }]);
    expect(vaultKindCounts([])).toEqual([]);
  });

  it("검색은 대소문자를 무시하고 표기 · 원래 대상 모두에 부분 일치", () => {
    expect(filterVaultItems(items, "BASTION", "all", display).map((i) => i.target)).toEqual(["DB-Bastion", "conn-7f3a"]);
    // 표기(~/.ssh/…)로도, 원래 경로(C:\Users…)로도 찾는다
    expect(filterVaultItems(items, "~/.ssh", "all", display)).toHaveLength(1);
    expect(filterVaultItems(items, "users\\me", "all", display)).toHaveLength(1);
    // DB 는 연결 이름으로
    expect(filterVaultItems(items, "orders", "all", display).map((i) => i.kind)).toEqual(["db_password"]);
    expect(filterVaultItems(items, "  ", "all", display)).toHaveLength(items.length);
    expect(filterVaultItems(items, "없는것", "all", display)).toEqual([]);
  });

  it("종류 칩과 검색이 함께 건다", () => {
    expect(filterVaultItems(items, "", "host_password", display).map((i) => i.target)).toEqual(["web-01", "DB-Bastion"]);
    expect(filterVaultItems(items, "web", "host_password", display)).toHaveLength(1);
    expect(filterVaultItems(items, "web", "mcp_env", display)).toEqual([]);
  });

  it("묶기 — 빈 묶음 없이 종류 순서, 안은 받은 순서", () => {
    const g = groupVaultItems(items);
    expect(g.map((x) => x.kind)).toEqual(["host_password", "key_passphrase", "db_password", "mcp_env"]);
    expect(g[0].items.map((i) => i.target)).toEqual(["web-01", "DB-Bastion"]);
    expect(groupVaultItems(items.filter((i) => i.kind === "db_password")).map((x) => x.kind)).toEqual(["db_password"]);
  });

  it("matchesQuery 는 빈 조각을 건너뛴다", () => {
    expect(matchesQuery("a", undefined, null, "")).toBe(false);
    expect(matchesQuery("", undefined)).toBe(true);
  });
});

describe("AI 권한 호스트", () => {
  const list = [host("web-01", true), host("old-host", false), host("legacy")];

  it("고아는 alias_known === false 뿐 (옛 백엔드의 빈 칸은 고아가 아니다)", () => {
    expect(list.map(isOrphanHost)).toEqual([false, true, false]);
  });

  it("별칭 검색 · 정리 필요 거르기", () => {
    expect(filterDelegationTargets(list, "WEB", false).map((v) => v.alias)).toEqual(["web-01"]);
    expect(filterDelegationTargets(list, "", true).map((v) => v.alias)).toEqual(["old-host"]);
    expect(filterDelegationTargets(list, "web", true)).toEqual([]);
    expect(filterDelegationTargets(list, "", false)).toHaveLength(3);
  });
});

describe("AI 권한 DB 연결", () => {
  const list = [db("a1", "orders", true, true), db("b2", undefined, false, true), db("c3", "Billing", true, false)];

  it("정리 필요 = 고아 또는 대상 바뀜", () => {
    expect(list.map(dbAiNeedsCleanup)).toEqual([false, true, true]);
  });

  it("이름(없으면 id) 검색 · 정리 필요 거르기", () => {
    expect(filterDbAiTargets(list, "billing", false).map((v) => v.id)).toEqual(["c3"]);
    expect(filterDbAiTargets(list, "B2", false).map((v) => v.id)).toEqual(["b2"]);
    expect(filterDbAiTargets(list, "", true).map((v) => v.id)).toEqual(["b2", "c3"]);
    expect(filterDbAiTargets(list, "orders", true)).toEqual([]);
  });
});

describe("상태 줄 (목업 안 A)", () => {
  const ids = (v: ReturnType<typeof vaultStateView>) => v.chips.map((c) => `${c.id}:${c.look}`);

  it("열림 + 마스터 — 성공 톤 · 열린 자물쇠 · 항목 · 보호(강조) · 자동 잠금", () => {
    const v = vaultStateView({ state: "unlocked", hasMaster: true, entryCount: 7 }, 5);
    expect([v.tone, v.icon, v.title, v.note]).toEqual([
      "ok",
      "lock-open",
      "settings.credentials.state.open",
      "settings.credentials.state.open.master",
    ]);
    expect(ids(v)).toEqual(["items:plain", "master:accent", "idle:plain"]);
    expect(v.chips[0].params).toEqual({ n: 7 });
    expect(v.chips[2].params).toEqual({ n: 5 });
  });

  it("열림 + 마스터 없음 — 경고 톤 · 위협 모델 문장 · '마스터 암호 없음' 경고 칩", () => {
    const v = vaultStateView({ state: "unlocked", hasMaster: false, entryCount: 0 }, 5);
    expect(v.tone).toBe("warn");
    expect(v.note).toBe("settings.credentials.state.note.nomaster");
    expect(ids(v)).toEqual(["items:plain", "nomaster:warn", "idle:plain"]);
    expect(v.chips[1].title).toBe("settings.credentials.state.note.nomaster");
  });

  it("자동 잠금이 꺼져 있으면 그 사실을 경고 칩으로", () => {
    const v = vaultStateView({ state: "unlocked", hasMaster: true, entryCount: 1 }, 0);
    expect(ids(v).at(-1)).toBe("idleoff:warn");
  });

  it("볼트 없음 — 중립 · 닫힌 자물쇠 · 칩 없음", () => {
    const v = vaultStateView({ state: "absent", hasMaster: false, entryCount: 0 }, 5);
    expect([v.tone, v.icon, v.title, v.note, v.chips.length]).toEqual([
      "neutral",
      "lock",
      "settings.credentials.state.absent",
      "settings.credentials.state.note.absent",
      0,
    ]);
  });

  it("잠김 — 중립 · 마스터 유무 칩만(관문 찰나에도 깨지지 않게)", () => {
    expect(ids(vaultStateView({ state: "locked", hasMaster: true, entryCount: 0 }, 5))).toEqual(["master:accent"]);
    const v = vaultStateView({ state: "locked", hasMaster: false, entryCount: 0 }, 5);
    expect([v.tone, v.note]).toEqual(["neutral", "settings.credentials.state.note.nomaster"]);
  });

  it("톤마다 그림 · 문구도 다르다(색만으로 가르지 않는다)", () => {
    const ok = vaultStateView({ state: "unlocked", hasMaster: true, entryCount: 1 }, 5);
    const warn = vaultStateView({ state: "unlocked", hasMaster: false, entryCount: 1 }, 5);
    const none = vaultStateView({ state: "absent", hasMaster: false, entryCount: 0 }, 5);
    expect(new Set([ok.note, warn.note, none.note]).size).toBe(3);
    expect(ok.icon).not.toBe(none.icon);
  });
});
