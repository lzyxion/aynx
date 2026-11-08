import { describe, expect, it } from "vitest";
import { fileProjectsFor, hostOfPane, isTerminalPane, sourceAlive, tileHeaded } from "./tile-presentation";
import type { HostBox } from "./boxes";
import type { PaneSpec } from "$lib/session";
import type { Project } from "$lib/projects";

const box = (pane: Partial<PaneSpec>, paneCount = 1): HostBox =>
  ({ pane: { id: "p", kind: "local", ...pane }, paneCount }) as unknown as HostBox;

describe("tileHeaded", () => {
  it("시작 타일 · 폰 배치는 어느 값에서도 머리줄이 없다", () => {
    expect(tileHeaded(box({ kind: "start" }), false, "always")).toBe(false);
    expect(tileHeaded(box({}), true, "always")).toBe(false);
  });
  it("always · multi · never", () => {
    expect(tileHeaded(box({}), false, "always")).toBe(true);
    expect(tileHeaded(box({}), false, "never")).toBe(false);
    expect(tileHeaded(box({}, 1), false, "multi")).toBe(false);
    expect(tileHeaded(box({}, 2), false, "multi")).toBe(true);
  });
});

describe("hostOfPane · sourceAlive · isTerminalPane", () => {
  it("SSH 타일만 별칭으로 호스트를 찾는다", () => {
    const m = new Map([["web", 1]]);
    expect(hostOfPane({ id: "a", kind: "ssh", alias: "web" } as PaneSpec, m)).toBe(1);
    expect(hostOfPane({ id: "a", kind: "ssh", alias: "db" } as PaneSpec, m)).toBe(null);
    expect(hostOfPane({ id: "a", kind: "doc", alias: "web" } as PaneSpec, m)).toBe(null);
  });
  it("원본 타일이 표에 있을 때만 살아 있다", () => {
    const k = new Map([["src", "ssh"]]);
    expect(sourceAlive({ id: "a", kind: "sftp", sourcePaneId: "src" } as PaneSpec, k)).toBe(true);
    expect(sourceAlive({ id: "a", kind: "sftp", sourcePaneId: "gone" } as PaneSpec, k)).toBe(false);
    expect(sourceAlive({ id: "a", kind: "sftp" } as PaneSpec, k)).toBe(false);
  });
  it("세션 있는 종류만 터미널", () => {
    expect(isTerminalPane({ id: "a", kind: "local" } as PaneSpec)).toBe(true);
    expect(isTerminalPane({ id: "a", kind: "doc" } as PaneSpec)).toBe(false);
  });
});

describe("fileProjectsFor", () => {
  const list = [
    { id: "1", name: "l", host: null, path: "C:/l" },
    { id: "2", name: "r", host: "web", path: "~/r" },
  ] as Project[];
  it("로컬 파일 타일은 호스트 없는 것 · 원격은 같은 별칭", () => {
    expect(fileProjectsFor({ id: "a", kind: "localfs" } as PaneSpec, list)).toEqual([{ id: "1", name: "l", path: "C:/l" }]);
    expect(fileProjectsFor({ id: "a", kind: "sftp", alias: "web" } as PaneSpec, list)).toEqual([
      { id: "2", name: "r", path: "~/r" },
    ]);
  });
});
