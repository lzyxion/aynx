import { describe, expect, it } from "vitest";
import type { FileChange, ImportCandidate, Instruction } from "$lib/context";
import {
  canApplyInstructions, displayInstructionPath, emptyInstructionForm, formToInstruction, groupInstructionChanges,
  instructionFormProblems, instructionNameOk, instructionProblemKeys, instructionToForm, normalizeInstructionSubpath,
  importSelectionToInstruction, selectedImportInstructions, type InstructionForm,
} from "./instruction-form";

const form = (patch: Partial<InstructionForm> = {}): InstructionForm => ({
  ...emptyInstructionForm(), name: "response-rules", ...patch,
});
const change = (patch: Partial<FileChange> = {}): FileChange => ({
  path: "/home/user/.claude/CLAUDE.md", scope: "global", projectId: null, host: null, agent: "claude",
  action: "update", reason: null, block: "## Response\nBe concise.\n", ...patch,
});

describe("지침 폼", () => {
  it("기본값은 전역 · 두 에이전트 · 켬이다", () => {
    expect(emptyInstructionForm()).toEqual({
      name: "", description: "", agents: ["claude", "codex"], enabled: true, scope: "global", projects: [], subpath: "", body: "",
    });
  });
  it("앞뒤 공백을 다듬고 빈 설명은 null, 본문은 원문을 보존한다", () => {
    expect(formToInstruction(form({ name: "  rule_1-2  ", description: " \n ", body: "  # body\r\n\n", projects: ["unused"] })))
      .toEqual({ name: "rule_1-2", description: null, targets: ["*"], enabled: true, scope: "global", projects: [], subpath: null, body: "  # body\r\n\n" });
    expect(formToInstruction(form({ description: "  응답 규칙  " }))?.description).toBe("응답 규칙");
  });
  it("두 에이전트는 *, 하나는 해당 id, 하나도 없으면 저장을 거절한다", () => {
    expect(formToInstruction(form({ agents: ["codex", "claude", "claude"] }))?.targets).toEqual(["*"]);
    for (const id of ["claude", "codex"]) expect(formToInstruction(form({ agents: [id] }))?.targets).toEqual([id]);
    expect(formToInstruction(form({ agents: [] }))).toBeNull();
    expect(instructionFormProblems(form({ agents: [] }))).toEqual(["agents"]);
    expect(instructionProblemKeys.agents).toBe("settings.instructions.error.agents");
    expect(formToInstruction(form({ agents: ["unknown"] }))).toBeNull();
  });
  it("프로젝트가 없으면 거절하고, 프로젝트 지침은 에이전트를 나누지 않는다", () => {
    expect(formToInstruction(form({ scope: "project" }))).toBeNull();
    expect(instructionFormProblems(form({ scope: "project" }))).toEqual(["projects"]);
    expect(formToInstruction(form({ scope: "project", projects: ["p1", "p1", "p2"], agents: [] })))
      .toMatchObject({ targets: ["*"], projects: ["p1", "p2"] });
  });
  it("항목을 열고 저장해도 이름·본문·범위·대상이 유지되며 배열을 공유하지 않는다", () => {
    const item: Instruction = {
      name: "rule", description: "설명", targets: ["codex"], enabled: false, scope: "project", projects: ["p1"], subpath: null, body: "text\r\n",
    };
    const draft = instructionToForm(item);
    expect(formToInstruction(draft)).toEqual({ ...item, targets: ["*"] });
    draft.projects.push("p2");
    draft.agents.push("claude");
    expect(item.projects).toEqual(["p1"]);
    expect(item.targets).toEqual(["codex"]);
    const global = { ...item, scope: "global" as const, projects: [] };
    expect(formToInstruction(instructionToForm(global))).toEqual(global);
    expect(instructionToForm({ ...global, targets: ["*"], description: null }))
      .toMatchObject({ agents: ["claude", "codex"], description: "" });
  });
});

describe("백엔드와 같은 이름 판정", () => {
  it("ASCII 소문자·숫자·_·-의 1~48자만 허용한다", () => {
    for (const name of ["a", "0", "_", "-", "rules_2-local", "a".repeat(48)]) expect(instructionNameOk(name), name).toBe(true);
    for (const name of ["", "a".repeat(49), "A", "한글", "a b", "../a", "a.md", "a/b", "a\\b", "a\n", "a\r", "a\0", "ａ"])
      expect(instructionNameOk(name), name).toBe(false);
  });
  it("변환은 trim한 이름을 검증하며 잘못된 이름을 자르거나 고쳐 저장하지 않는다", () => {
    expect(formToInstruction(form({ name: "  a  " }))?.name).toBe("a");
    for (const name of ["  ", "Bad", "a".repeat(49)]) {
      expect(formToInstruction(form({ name }))).toBeNull();
      expect(instructionFormProblems(form({ name }))).toContain("name");
    }
  });
});

describe("미리 보기 경로 표시", () => {
  it("섞인 구분자와 중복 구분자를 / 하나로 정리한다", () => {
    expect(displayInstructionPath(String.raw`C:/Users//me/e2e\\repo-a\AGENTS.md`, null))
      .toBe("C:/Users/me/e2e/repo-a/AGENTS.md");
  });
  it("verbatim 접두를 걷고 base도 같은 방식으로 정규화한다", () => {
    expect(displayInstructionPath(String.raw`\\?\C:\Users\me\e2e\repo-a\AGENTS.md`, null))
      .toBe("C:/Users/me/e2e/repo-a/AGENTS.md");
    expect(displayInstructionPath("C:/Users/me/e2e/repo-a/AGENTS.md", String.raw`\\?\C:\Users\me\e2e\repo-a`))
      .toBe("repo-a/AGENTS.md");
  });
  it("본 저장소와 옆 워크트리는 base 부모 기준 상대 경로로 표시한다", () => {
    const base = String.raw`C:\Users\me\e2e\\repo-a/`;
    expect(displayInstructionPath(String.raw`C:/Users/me/e2e/repo-a\AGENTS.md`, base)).toBe("repo-a/AGENTS.md");
    expect(displayInstructionPath(String.raw`C:/Users/me/e2e/repo-a-wt1\AGENTS.md`, base)).toBe("repo-a-wt1/AGENTS.md");
    expect(displayInstructionPath("/home/me/e2e/repo-a/AGENTS.md", "/home/me/e2e/repo-a"))
      .toBe("repo-a/AGENTS.md");
  });
  it("Windows 드라이브 경로는 대소문자를 무시해 비교하고 표시 문자는 유지한다", () => {
    expect(displayInstructionPath(String.raw`c:\USERS\ME\E2E\Repo-A-WT1\AGENTS.md`, "C:/Users/me/e2e/repo-a"))
      .toBe("Repo-A-WT1/AGENTS.md");
  });
  it("base 부모 밖이나 이름 접두만 같은 폴더는 정규화한 전체 경로로 표시한다", () => {
    const base = "C:/Users/me/e2e/repo-a";
    expect(displayInstructionPath(String.raw`C:\Users\me\other\AGENTS.md`, base)).toBe("C:/Users/me/other/AGENTS.md");
    expect(displayInstructionPath(String.raw`C:\Users\me\e2e-other\AGENTS.md`, base)).toBe("C:/Users/me/e2e-other/AGENTS.md");
    expect(displayInstructionPath(String.raw`D:\Users\me\e2e\repo-a\AGENTS.md`, base))
      .toBe("D:/Users/me/e2e/repo-a/AGENTS.md");
  });
  it("Windows 드라이브가 아닌 경로는 대소문자를 구분한다", () => {
    expect(displayInstructionPath("/home/ME/e2e/repo-a/AGENTS.md", "/home/me/e2e/repo-a"))
      .toBe("/home/ME/e2e/repo-a/AGENTS.md");
  });
  it("전역 경로는 전체 경로를 정규화해서 표시한다", () => {
    expect(displayInstructionPath(String.raw`C:\Users\me\.claude/CLAUDE.md`, null)).toBe("C:/Users/me/.claude/CLAUDE.md");
    expect(displayInstructionPath("/home//me/.claude/CLAUDE.md", null)).toBe("/home/me/.claude/CLAUDE.md");
  });
  it("UNC 앞 //는 유지하고 내부 중복 구분자는 정리한다", () => {
    expect(displayInstructionPath(String.raw`\\server\share//e2e\repo-a\AGENTS.md`, null))
      .toBe("//server/share/e2e/repo-a/AGENTS.md");
    expect(displayInstructionPath("//server//share/e2e/repo-a-wt1/AGENTS.md", String.raw`\\server\share\e2e\repo-a`))
      .toBe("repo-a-wt1/AGENTS.md");
  });
  it("verbatim UNC 접두를 일반 UNC 경로로 정리한다", () => {
    expect(displayInstructionPath(String.raw`\\?\UNC\server\share\e2e\repo-a\AGENTS.md`, null))
      .toBe("//server/share/e2e/repo-a/AGENTS.md");
    expect(displayInstructionPath(String.raw`\\?\UNC\server\share\e2e\repo-a-wt1\AGENTS.md`, String.raw`\\?\UNC\server\share\e2e\repo-a`))
      .toBe("repo-a-wt1/AGENTS.md");
  });
});

describe("미리 보기 · 반영 목록", () => {
  it("만듦·고침·지움만 반영 가능한 변경이다", () => {
    expect(canApplyInstructions([])).toBe(false);
    for (const action of ["unchanged", "skipped", "error"] as const)
      expect(canApplyInstructions([change({ action })])).toBe(false);
    for (const action of ["create", "update", "delete"] as const)
      expect(canApplyInstructions([change({ action: "error" }), change({ action })])).toBe(true);
  });
  it("전역 / 프로젝트별로 묶고 변경을 먼저, 변경 없음은 세어서 따로 둔다", () => {
    const rows = [
      change({ scope: "project", projectId: "p2", path: "/p2/AGENTS.md", action: "unchanged" }),
      change({ scope: "project", projectId: "p1", path: "/p1/AGENTS.md", action: "update" }),
      change({ scope: "project", projectId: "p1", path: "/wt/AGENTS.md", action: "delete" }),
      change({ action: "error", path: "/home/a", reason: "permission" }),
      change({ action: "create", path: "/home/z" }),
      change({ action: "unchanged" }),
      change({ scope: "project", projectId: "p1", path: "/p1/CLAUDE.md", action: "skipped", reason: "remote" }),
      change({ scope: "project", projectId: "p1", path: "/wt/CLAUDE.md", action: "unchanged" }),
    ];
    const before = structuredClone(rows);
    const groups = groupInstructionChanges(rows);
    expect(groups.map((group) => group.id)).toEqual(["global", "project:p1", "project:p2"]);
    expect(groups[0].changes.map((row) => row.action)).toEqual(["create", "error"]);
    expect(groups[1].changes.map((row) => row.action)).toEqual(["update", "delete", "skipped"]);
    expect(groups.map((group) => group.unchangedCount)).toEqual([1, 1, 1]);
    expect(groups[0].changes[1].reason).toBe("permission");
    expect(groups[0].changes[0].block).toBe(rows[4].block);
    expect(rows).toEqual(before);
  });
  it("프로젝트 id가 없는 결과는 경로의 폴더로 묶는다 (Windows 경로도)", () => {
    const groups = groupInstructionChanges([
      change({ scope: "project", path: "C:\\repo\\AGENTS.md" }),
      change({ scope: "project", path: "C:\\repo\\CLAUDE.md" }),
      change({ scope: "project", path: "/other/AGENTS.md" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups.find((group) => group.id === "project:C:/repo")?.changes).toHaveLength(2);
  });
});

const candidate = (patch: Partial<ImportCandidate> = {}): ImportCandidate => ({
  source: "/repo/AGENTS.md", label: "AGENTS.md", suggestedName: "repo-agents", description: null,
  targets: ["*"], scope: "project", projects: ["p1"], subpath: null, body: "# Original\nBody", skipped: null, ...patch,
});

describe("가져오기 후보 복사", () => {
  it("편집한 이름을 검증하고 후보의 본문과 메타를 보존하며 배열은 복사한다", () => {
    const source = candidate({ description: "규칙", targets: ["codex"], scope: "global", projects: [] });
    const item = importSelectionToInstruction({ candidate: source, name: "  copied-rule  ", selected: true });
    expect(item).toEqual({ name: "copied-rule", description: "규칙", targets: ["codex"], enabled: true,
      scope: "global", projects: [], subpath: null, body: source.body });
    item?.targets.push("claude");
    item?.projects.push("p2");
    expect(source.targets).toEqual(["codex"]);
    expect(source.projects).toEqual([]);
    for (const name of ["", "Bad", "a".repeat(49)])
      expect(importSelectionToInstruction({ candidate: source, name, selected: true })).toBeNull();
  });
  it("선택한 정상 후보만 화면 순서대로 변환하며 원본을 바꾸지 않는다", () => {
    const rows = [
      { candidate: candidate(), name: "second", selected: true },
      { candidate: candidate(), name: "off", selected: false },
      { candidate: candidate({ skipped: "깨진 표시" }), name: "broken", selected: true },
      { candidate: candidate(), name: "Bad", selected: true },
      { candidate: candidate({ targets: ["claude"], projects: ["p2"] }), name: "first", selected: true },
    ];
    const before = structuredClone(rows);
    expect(selectedImportInstructions(rows).map((item) => item.name)).toEqual(["second", "first"]);
    expect(selectedImportInstructions(rows)[1]).toMatchObject({ targets: ["claude"], projects: ["p2"] });
    expect(rows).toEqual(before);
  });
});


describe("원격 지침 표시", () => {
  it("프로젝트 묶음에 호스트를 보존하고 홈 경로를 짧게 표시한다", () => {
    const rows = [change({ path: "~/projects/api/AGENTS.md", scope: "project", projectId: "p", host: "dev-01", agent: null })];
    const groups = groupInstructionChanges(rows);
    expect(groups[0].host).toBe("dev-01");
    expect(groups[0].projectId).toBe("p");
    expect(displayInstructionPath(rows[0].path, "~/projects/api")).toBe("api/AGENTS.md");
  });
});

describe("하위 폴더 경로", () => {
  it("구분자와 끝 /를 정규화하고 빈 칸은 루트로 저장한다", () => {
    expect(normalizeInstructionSubpath("")).toBeNull();
    expect(normalizeInstructionSubpath("/pkg/api/")).toBe("pkg/api");
    expect(normalizeInstructionSubpath("/")).toBeNull();
    expect(normalizeInstructionSubpath(String.raw`pkg\api/`)).toBe("pkg/api");
    expect(normalizeInstructionSubpath("/" + "a".repeat(200) + "//")).toBe("a".repeat(200));
    expect(normalizeInstructionSubpath("가".repeat(200))).toBe("가".repeat(200));
    expect(normalizeInstructionSubpath("😀".repeat(200))).toBe("😀".repeat(200));
    expect(formToInstruction(form({ scope: "project", projects: ["p"], subpath: "pkg/api/" }))?.subpath).toBe("pkg/api");
  });
  it("잘못된 상대 경로는 저장하지 않는다", () => {
    for (const path of ["pkg//api", "pkg/./api", "..", "pkg/../api", "C:/api", "C:api", "a:b", "a\n", "a\r", "a\0", "a\u0085", "a".repeat(201)]) {
      expect(normalizeInstructionSubpath(path), path).toBeUndefined();
      expect(formToInstruction(form({ scope: "project", projects: ["p"], subpath: path })), path).toBeNull();
    }
  });
  it("전역에서는 숨겨진 하위 폴더 칸의 남은 값을 무시한다", () => {
    // 프로젝트에서 적어 두고 전역으로 바꾼 경우 — 칸이 안 보이므로 거절하지 않고 버린다.
    expect(instructionFormProblems(form({ subpath: "pkg/api" }))).toEqual([]);
    expect(instructionFormProblems(form({ subpath: "../bad" }))).toEqual([]);
    expect(formToInstruction(form({ subpath: "pkg/api" }))?.subpath).toBeNull();
  });
  it("편집과 가져오기가 subpath를 보존한다", () => {
    const item = formToInstruction(form({ scope: "project", projects: ["p"], subpath: "pkg/api" }))!;
    expect(formToInstruction(instructionToForm(item))).toEqual(item);
    const source: ImportCandidate = { source: "rule.md", label: "rule", suggestedName: "rule", description: null,
      targets: ["*"], scope: "project", projects: ["p"], subpath: "pkg/api", body: "body", skipped: null };
    expect(importSelectionToInstruction({ candidate: source, name: "rule", selected: true })?.subpath).toBe("pkg/api");
  });
});
