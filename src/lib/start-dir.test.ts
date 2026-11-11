import { describe, expect, it } from "vitest";
import {
  adoptTab,
  leafOf,
  newLocalFsPane,
  newLocalPane,
  newProjectStartPane,
  newSftpPane,
  newSshPane,
  newStartPane,
  splitPane,
  type PaneSpec,
  type TabSpec,
} from "$lib/session";
import { startDirFor, tabProjectFolder, type StartDirInput } from "$lib/start-dir";
import { deserialize, parseTabFile, serialize } from "$lib/tabs";

const PROJECT = "C:\\src\\aynx";

function tab(focused: PaneSpec, projectFolder?: string): TabSpec {
  return { id: "t", title: "탭 1", root: leafOf(focused), ...(projectFolder ? { projectFolder } : {}) };
}

function run(
  focused: PaneSpec | null,
  opts: Partial<Omit<StartDirInput, "focused">> & { projectFolder?: string } = {},
): string | undefined {
  const { projectFolder, ...rest } = opts;
  return startDirFor({
    focused,
    tab: focused ? tab(focused, projectFolder) : null,
    purpose: "shell",
    ...rest,
  });
}

describe("startDirFor — 새 셸·AI 타일이 뜰 폴더 (규칙 하나)", () => {
  it("빈 탭(시작 화면) — 셸은 홈, AI 는 설정 폴더", () => {
    const start = newStartPane();
    expect(run(start)).toBeUndefined();
    expect(run(start, { purpose: "ai", aiStartDir: "D:\\ai" })).toBe("D:\\ai");
    expect(run(start, { purpose: "ai" })).toBeUndefined();
  });

  it("탭이 없어도(창이 막 뜨는 중) 셸은 홈이다", () => {
    expect(startDirFor({ focused: null, tab: null, purpose: "shell" })).toBeUndefined();
  });

  it("포커스된 로컬 셸이 알려 준 폴더", () => {
    expect(run(newLocalPane("pwsh"), { focusedCwd: "C:\\work\\x" })).toBe("C:\\work\\x");
    expect(run(newLocalPane("pwsh"), { focusedCwd: "C:\\work\\x", purpose: "ai", aiStartDir: "D:\\ai" })).toBe(
      "C:\\work\\x",
    );
  });

  it("폴더를 알려 주지 않는 셸(cmd 등)은 모름 — 셸은 홈, AI 는 설정 폴더", () => {
    expect(run(newLocalPane("cmd"))).toBeUndefined();
    expect(run(newLocalPane("cmd"), { focusedCwd: "  " })).toBeUndefined();
    expect(run(newLocalPane("cmd"), { purpose: "ai", aiStartDir: "D:\\ai" })).toBe("D:\\ai");
  });

  it("로컬 파일 타일 — 보고 있는 폴더", () => {
    expect(run(newLocalFsPane("C:\\docs"))).toBe("C:\\docs");
    expect(run(newLocalFsPane())).toBeUndefined();
  });

  it("SSH·SFTP 타일 — 원격 경로는 쓰지 않는다(focusedCwd 가 와도)", () => {
    expect(run(newSshPane("web-01"), { focusedCwd: "/srv/app" })).toBeUndefined();
    expect(run(newSftpPane("p-1", "web-01", "/srv/app"))).toBeUndefined();
    expect(run(newSshPane("web-01"), { purpose: "ai", aiStartDir: "D:\\ai" })).toBe("D:\\ai");
  });

  it("프로젝트 탭 — 포커스 폴더가 그 안이면 그 폴더(구분자·대소문자 무시)", () => {
    expect(run(newLocalPane(), { projectFolder: PROJECT, focusedCwd: "c:/SRC/aynx/src/lib" })).toBe(
      "c:/SRC/aynx/src/lib",
    );
    expect(run(newLocalPane(), { projectFolder: PROJECT, focusedCwd: "C:\\src\\aynx\\" })).toBe("C:\\src\\aynx\\");
    expect(run(newLocalFsPane("C:\\src\\aynx\\docs"), { projectFolder: PROJECT })).toBe("C:\\src\\aynx\\docs");
  });

  it("프로젝트 탭 — 밖으로 cd 했으면 프로젝트 폴더(이름이 겹치는 형제 폴더도 밖이다)", () => {
    expect(run(newLocalPane(), { projectFolder: PROJECT, focusedCwd: "C:\\Users\\me" })).toBe(PROJECT);
    expect(run(newLocalPane(), { projectFolder: PROJECT, focusedCwd: "C:\\src\\aynx-wt\\a" })).toBe(PROJECT);
    expect(run(newLocalFsPane("D:\\"), { projectFolder: PROJECT })).toBe(PROJECT);
  });

  it("프로젝트 탭 — 폴더를 모르는 셸·SSH 포커스면 프로젝트 폴더(AI 도 설정 폴더보다 앞)", () => {
    expect(run(newLocalPane("cmd"), { projectFolder: PROJECT })).toBe(PROJECT);
    expect(run(newSshPane("web-01"), { projectFolder: PROJECT, focusedCwd: "/srv" })).toBe(PROJECT);
    expect(run(newSshPane("web-01"), { projectFolder: PROJECT, purpose: "ai", aiStartDir: "D:\\ai" })).toBe(
      PROJECT,
    );
  });

  it("WSL 셸의 값(여는 자리가 Windows 경로로 옮긴 것)도 같은 비교를 탄다", () => {
    const wslProject = "\\\\wsl.localhost\\Ubuntu\\home\\me\\api";
    expect(
      run(newLocalPane("wsl:Ubuntu"), {
        projectFolder: wslProject,
        focusedCwd: "\\\\wsl.localhost\\Ubuntu\\home\\me\\api\\src",
      }),
    ).toBe("\\\\wsl.localhost\\Ubuntu\\home\\me\\api\\src");
    expect(
      run(newLocalPane("wsl:Ubuntu"), { projectFolder: wslProject, focusedCwd: "\\\\wsl.localhost\\Ubuntu\\tmp" }),
    ).toBe(wslProject);
  });
});

describe("tabProjectFolder — 적힌 값, 없으면 떠 있는 프로젝트 시작 화면", () => {
  it("적힌 값이 먼저다", () => {
    expect(tabProjectFolder(tab(newLocalPane(), " C:\\src\\aynx "))).toBe("C:\\src\\aynx");
  });

  it("적힌 값이 없으면 시작 화면의 폴더, 그것도 없으면 평범한 탭", () => {
    const shell = newLocalPane();
    const root = splitPane(leafOf(shell), shell.id, "row", newProjectStartPane("p1", "C:\\src\\wt\\a"));
    expect(tabProjectFolder({ root })).toBe("C:\\src\\wt\\a");
    expect(tabProjectFolder({ root: leafOf(newStartPane()) })).toBeNull();
    expect(tabProjectFolder(null)).toBeNull();
  });

  it("시작 화면만 떠 있는 탭에서 셸을 열면 그 폴더다", () => {
    const start = newProjectStartPane("p1", "C:\\src\\wt\\a");
    expect(run(start)).toBe("C:\\src\\wt\\a");
  });
});

describe("projectFolder — 저장·복원·창 이관", () => {
  it("배치 파일 왕복에 실리고, 없는 탭(옛 파일)에는 키가 없다", () => {
    const plain: TabSpec = { id: "t1", title: "탭 1", root: leafOf(newLocalPane()) };
    const proj: TabSpec = {
      id: "t2",
      title: "Aynx",
      pinnedTitle: "Aynx",
      projectFolder: PROJECT,
      root: leafOf(newLocalPane()),
    };
    const file = parseTabFile(JSON.stringify(serialize([plain, proj], "t1")));
    if (!file) throw new Error("parse failed");
    expect(file.workspaces[1].projectFolder).toBe(PROJECT);
    expect("projectFolder" in file.workspaces[0]).toBe(false);
    const { tabs } = deserialize(file);
    expect(tabs[1].projectFolder).toBe(PROJECT);
    expect("projectFolder" in tabs[0]).toBe(false);
  });

  it("창 이관이 들고 간다", () => {
    const proj: TabSpec = { id: "t", title: "Aynx", projectFolder: PROJECT, root: leafOf(newLocalPane()) };
    expect(adoptTab(proj, () => undefined).projectFolder).toBe(PROJECT);
    const plain: TabSpec = { id: "t", title: "탭 1", root: leafOf(newLocalPane()) };
    expect("projectFolder" in adoptTab(plain, () => undefined)).toBe(false);
  });
});
