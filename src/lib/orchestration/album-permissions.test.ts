import { describe, expect, it } from "vitest";
import { orch as ko } from "$lib/i18n/ko/orch";
import { orch as en } from "$lib/i18n/en/orch";
import { albumChangeBody, albumPermissionFailureKey, albumPermissionRisk, albumPermissions, albumPermissionsValid, albumWidens, ALBUM_PERMISSION_FAILURES, type AlbumConfigView } from "./album-permissions";

const base = (): AlbumConfigView => ({
  rev: 7, changedAt: 999, riskConfirmedAt: 100,
  members: [{ artist: "a-write", name: "구현", joinedRev: 1, grade: "edit", allowedCommands: ["cargo test"] }, { artist: "a-judge", name: "검토", joinedRev: 2, grade: "read", allowedCommands: [] }],
  accept: { require: [{ role: "a-judge", passes: 2 }], maxRework: 3 }, verifyAuto: false, planTools: false, wakeMax: 30,
});

describe("권한 패널 ↔ 서버 구성", () => {
  it("다섯 칸만 복사하고 서버 메타데이터·고정 칸을 몸에서 뺀다", () => {
    const server = { ...base(), name: "앨범", limits: { turnMinutes: 10 }, verify: { command: "npm test" } };
    const draft = albumPermissions(server);
    const body = albumChangeBody("run-1", server, draft, false, true);
    expect(body).toEqual({ runId: "run-1", expectRev: 7, next: {
      members: [{ artist: "a-write", grade: "edit", allowedCommands: ["cargo test"] }, { artist: "a-judge", grade: "read", allowedCommands: [] }],
      accept: { require: [{ role: "a-judge", passes: 2 }], maxRework: 3 }, verifyAuto: false, planTools: false, wakeMax: 30,
    } });
    for (const forbidden of ["rev", "changedAt", "riskConfirmedAt", "name", "joinedRev", "limits", "verify"]) expect(JSON.stringify(body.next)).not.toContain(`"${forbidden}"`);
    draft.members[0].allowedCommands.push("cargo check"); draft.accept.require[0].passes = 1;
    expect(server.members[0].allowedCommands).toEqual(["cargo test"]); expect(server.accept.require[0].passes).toBe(2);
    expect(albumChangeBody("run-1", server, draft, true, true).riskConfirmed).toBe(true);
  });

  // S2 tests_album.rs::album_widen_table와 노트 2-3의 모든 행·개별 변경을 같은 기대값으로 고정한다.
  const cases: [string, boolean, (a: AlbumConfigView) => void][] = [
    ["등급 올림", true, a => { a.members[0].grade = "full"; }],
    ["작업형 편집 들이기", true, a => { a.members.push({ artist: "new", name: "새 작업", joinedRev: 8, grade: "edit", allowedCommands: [] }); }],
    ["자동 검증", true, a => { a.verifyAuto = true; }],
    ["명령 추가", true, a => { a.members[0].allowedCommands.push("cargo check"); }],
    ["작업안 도구", true, a => { a.planTools = true; }],
    ["깨움 올림", true, a => { a.wakeMax++; }],
    ["필수 판정 빼기", true, a => { a.accept.require = []; }],
    ["pass 내림", true, a => { a.accept.require[0].passes = 1; }],
    ["되돌림 올림", true, a => { a.accept.maxRework++; }],
    ["등급 내림", false, a => { a.members[0].grade = "read"; }],
    ["멤버 빼기", false, a => { a.members.shift(); }],
    ["명령 지우기", false, a => { a.members[0].allowedCommands = []; }],
    ["깨움 내림", false, a => { a.wakeMax--; }],
    ["수락 강화", false, a => { a.accept.require[0].passes = 3; }],
    ["되돌림 내림", false, a => { a.accept.maxRework--; }],
    ["판정형 들이기", false, a => { a.members.push({ artist: "judge2", name: "새 검토", joinedRev: 8, grade: "read", allowedCommands: [] }); }],
    ["작업형 읽기 들이기", false, a => { a.members.push({ artist: "write2", name: "읽기", joinedRev: 8, grade: "read", allowedCommands: [] }); }],
    ["판 메타데이터", false, a => { a.rev++; a.changedAt++; }],
  ];
  it.each(cases)("넓힘 거울: %s → %s", (_, want, change) => {
    const old = base(); const next = base(); change(next);
    expect(albumWidens(old, next)).toBe(want);
  });
  it("자동 검증·작업안 끔은 좁힘, 명령 순서는 관계없다", () => {
    const old = base(); old.verifyAuto = old.planTools = true;
    expect(albumWidens(old, { ...old, verifyAuto: false })).toBe(false);
    expect(albumWidens(old, { ...old, planTools: false })).toBe(false);
    old.members[0].allowedCommands.push("cargo check"); const next = structuredClone(old); next.members[0].allowedCommands.reverse();
    expect(albumWidens(old, next)).toBe(false);
  });
  it("새 위험 세 종류만 다시 확인하고 기존 확인을 유지한 좁힘은 통과한다", () => {
    const old = base();
    for (const change of [(a: AlbumConfigView) => { a.members[0].grade = "full"; }, (a: AlbumConfigView) => { a.verifyAuto = true; }, (a: AlbumConfigView) => { a.planTools = true; }]) {
      const next = base(); change(next); expect(albumPermissionRisk(old, next)).toBe(true);
      expect(albumPermissionRisk(next, { ...next, wakeMax: 0 })).toBe(false);
      next.riskConfirmedAt = null; expect(albumPermissionRisk(next, next)).toBe(true);
    }
    expect(albumPermissionRisk(old, { ...old, wakeMax: 40 })).toBe(false);
  });
  it("권한은 전원 읽기로 좁힐 수 있고 숫자·명령 오류를 막는다", () => {
    const next = albumPermissions(base()); next.members[0].grade = "read";
    expect(albumPermissionsValid(next)).toBe(true);
    expect(albumPermissionsValid({ ...next, members: [], accept: { require: [], maxRework: 3 } })).toBe(true);
    next.wakeMax = 201; expect(albumPermissionsValid(next)).toBe(false);
    next.wakeMax = 0; next.members[0].allowedCommands.push("npm *"); expect(albumPermissionsValid(next)).toBe(false);
  });
  it("알려진 오류 낱말과 알 수 없는 오류를 ko·en 문구로 바꾼다", () => {
    for (const word of [...ALBUM_PERMISSION_FAILURES, "unknown"]) {
      const key = albumPermissionFailureKey(new Error(`[${word}] 서버 내부 상세`));
      expect(key).toBe(`orch.perm.failure.${word}`);
      const name = key.slice(5) as keyof typeof ko;
      expect(ko[name]).toBeTruthy(); expect(en[name]).toBeTruthy();
      expect(ko[name]).not.toContain("서버 내부 상세");
    }
  });
});
