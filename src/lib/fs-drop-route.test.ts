import { describe, expect, it } from "vitest";
import { fsDropAction, fsDropRoute, hostIdentity, sessionOfFsKey, type FsDropTarget } from "$lib/fs-drop-route";

const hosts: Record<number, string | null> = { 3: "alias:web", 4: "alias:web", 5: "alias:db", 6: null };
const hostOf = (s: number) => hosts[s] ?? null;
const local: FsDropTarget = { kind: "local", session: 1, host: null };
const web = (session: number | null): FsDropTarget => ({ kind: "ssh", session, host: "alias:web" });

describe("fsDropRoute — 같은 곳 판정", () => {
  it("로컬 파일 → 로컬 타일은 같은 곳, 원격 타일은 올리기", () => {
    expect(fsDropRoute("local", true, local, hostOf)).toBe("same");
    expect(fsDropRoute("local", false, local, hostOf)).toBe("same"); // 로컬 키는 창을 넘어도 같은 뜻
    expect(fsDropRoute("local", true, web(4), hostOf)).toBe("upload");
  });

  it("같은 세션이면 같은 곳", () => {
    expect(fsDropRoute("ssh:4", true, web(4), hostOf)).toBe("same");
  });

  it("세션이 달라도 같은 호스트면 같은 곳", () => {
    expect(fsDropRoute("ssh:3", true, web(4), hostOf)).toBe("same");
  });

  it("다른 호스트면 다른 곳", () => {
    expect(fsDropRoute("ssh:5", true, web(4), hostOf)).toBe("foreign");
  });

  it("모르면 다른 곳 — 호스트를 모르는 세션 · 대상 세션 없음 · 남의 창 · 모르는 키", () => {
    expect(fsDropRoute("ssh:6", true, web(4), hostOf)).toBe("foreign");
    expect(fsDropRoute("ssh:99", true, web(4), hostOf)).toBe("foreign");
    expect(fsDropRoute("ssh:3", true, { kind: "ssh", session: 4, host: null }, hostOf)).toBe("foreign");
    expect(fsDropRoute("ssh:4", false, web(4), hostOf)).toBe("foreign");
    expect(fsDropRoute("ssh:none", true, web(4), hostOf)).toBe("foreign");
    expect(fsDropRoute("", true, local, hostOf)).toBe("foreign");
  });

  it("원격 파일 → 로컬 타일은 내려받기 (남의 창이면 모름)", () => {
    expect(fsDropRoute("ssh:3", true, local, hostOf)).toBe("download");
    expect(fsDropRoute("ssh:3", false, local, hostOf)).toBe("foreign");
  });
});

describe("hostIdentity", () => {
  it("별칭은 대소문자·공백을 접고, 빠른 접속은 대상으로 비교한다", () => {
    expect(hostIdentity({ kind: "ssh", alias: " Web " })).toBe("alias:web");
    expect(hostIdentity({ kind: "ssh", alias: "me@web:22", adhoc: { host: "WEB", user: "me" } })).toBe("adhoc:me@web:22");
    expect(hostIdentity({ kind: "ssh", alias: "web", adhoc: { host: "web" } })).not.toBe("alias:web");
  });

  it("로컬·별칭 없음은 모른다", () => {
    expect(hostIdentity({ kind: "local" })).toBeNull();
    expect(hostIdentity({ kind: "ssh" })).toBeNull();
    expect(hostIdentity({ kind: "ssh", alias: "  " })).toBeNull();
  });
});

describe("sessionOfFsKey", () => {
  it("원격 키에서만 번호를 꺼낸다", () => {
    expect(sessionOfFsKey("ssh:12")).toBe(12);
    expect(sessionOfFsKey("local")).toBeNull();
    expect(sessionOfFsKey("ssh:none")).toBeNull();
  });
});

describe("fsDropAction — 분기 표", () => {
  it("일반 셸: 같은 곳이면 경로 입력, 그 밖은 안내만", () => {
    expect(fsDropAction("same", false, "ssh")).toEqual({ kind: "broadcast" });
    for (const route of ["upload", "download", "foreign"] as const) {
      expect(fsDropAction(route, false, "local")).toEqual({ kind: "notice", key: "pane.drop.fs.elsewhere" });
    }
  });

  it("AI 타일: 같은 곳은 붙여넣기, 로컬↔원격은 사본, 서버끼리는 안내", () => {
    expect(fsDropAction("same", true, "local")).toEqual({ kind: "paste" });
    expect(fsDropAction("upload", true, "ssh")).toEqual({ kind: "upload" });
    expect(fsDropAction("download", true, "local")).toEqual({ kind: "download" });
    expect(fsDropAction("foreign", true, "ssh")).toEqual({ kind: "notice", key: "pane.drop.fs.otherserver" });
    expect(fsDropAction("foreign", true, "local")).toEqual({ kind: "notice", key: "pane.drop.fs.elsewhere" });
  });
});
