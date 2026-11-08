// 설정 › 지침의 폼 변환·검증·파일 변경 묶기 — 순수 함수만.
// Rust agent_instructions::name_ok 와 같은 ASCII 이름 규칙. 본문은 손대지 않는다.
import type { FileChange, ImportCandidate, Instruction } from "$lib/context";

export interface InstructionForm {
  name: string;
  description: string;
  agents: string[];
  enabled: boolean;
  scope: Instruction["scope"];
  projects: string[];
  subpath: string;
  body: string;
}

export function emptyInstructionForm(): InstructionForm {
  return { name: "", description: "", agents: ["claude", "codex"], enabled: true, scope: "global", projects: [], subpath: "", body: "" };
}

export function instructionToForm(item: Instruction): InstructionForm {
  return {
    name: item.name,
    description: item.description ?? "",
    agents: item.targets.includes("*") ? ["claude", "codex"] : [...item.targets],
    enabled: item.enabled,
    scope: item.scope,
    projects: [...item.projects],
    subpath: item.subpath ?? "",
    body: item.body,
  };
}

export function instructionNameOk(name: string): boolean {
  return name.length >= 1 && name.length <= 48 && !/[^a-z0-9_-]/.test(name);
}

/** Rust normalize_subpath와 같은 판정. null은 루트, undefined는 잘못된 경로다. */
export function normalizeInstructionSubpath(value: string): string | null | undefined {
  if (value === "") return null;
  const path = value.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (path.includes(":") || /\p{Cc}/u.test(path) || [...path].length > 200) return undefined;
  if (!path) return null;
  if (path.split("/").some((part) => !part || part === "." || part === "..")) return undefined;
  return path;
}

export type InstructionFormProblem = "name" | "agents" | "projects" | "subpath";
export const instructionProblemKeys = {
  name: "settings.instructions.error.name",
  agents: "settings.instructions.error.agents",
  projects: "settings.instructions.error.projects",
  subpath: "settings.instructions.error.subpath",
} as const;

export function instructionFormProblems(form: InstructionForm): InstructionFormProblem[] {
  const problems: InstructionFormProblem[] = [];
  if (!instructionNameOk(form.name.trim())) problems.push("name");
  if (form.scope === "global" && !form.agents.some((id) => id === "claude" || id === "codex")) problems.push("agents");
  if (form.scope === "project" && form.projects.length === 0) problems.push("projects");
  // 전역에서는 하위 폴더 칸이 숨겨진다 — 남아 있던 값은 검사하지 않고 버린다(아래 formToInstruction).
  if (form.scope === "project" && normalizeInstructionSubpath(form.subpath) === undefined) problems.push("subpath");
  return problems;
}

/** 검증 실패는 null — 화면은 문제 키를 t() 로 설명하고 초안을 유지한다. */
export function formToInstruction(form: InstructionForm): Instruction | null {
  if (instructionFormProblems(form).length > 0) return null;
  const agents = ["claude", "codex"].filter((id) => form.agents.includes(id));
  return {
    name: form.name.trim(),
    description: form.description.trim() || null,
    targets: form.scope === "project" || agents.length === 2 ? ["*"] : agents,
    enabled: form.enabled,
    scope: form.scope,
    projects: form.scope === "project" ? [...new Set(form.projects)] : [],
    subpath: form.scope === "project" ? normalizeInstructionSubpath(form.subpath) ?? null : null,
    body: form.body,
  };
}

export interface InstructionImportSelection {
  candidate: ImportCandidate;
  name: string;
  selected: boolean;
}

/** 고른 정상 후보만 복사한다. 이름 외의 출처 메타와 본문은 가져온 그대로 보존한다. */
export function importSelectionToInstruction(selection: InstructionImportSelection): Instruction | null {
  const { candidate, selected } = selection;
  const name = selection.name.trim();
  if (!selected || candidate.skipped !== null || !instructionNameOk(name)) return null;
  return {
    name, description: candidate.description, targets: [...candidate.targets], enabled: true,
    scope: candidate.scope, projects: [...candidate.projects], subpath: candidate.subpath, body: candidate.body,
  };
}

/** 저장 순서는 화면 순서다. 선택 안 한 줄과 건너뛴 줄은 저장 대상에서 뺀다. */
export function selectedImportInstructions(selections: readonly InstructionImportSelection[]): Instruction[] {
  return selections.flatMap((selection) => {
    const item = importSelectionToInstruction(selection);
    return item ? [item] : [];
  });
}

export function canApplyInstructions(changes: readonly FileChange[]): boolean {
  return changes.some((change) => ["create", "update", "delete"].includes(change.action));
}

function normalizeInstructionPath(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\/\/\?\/UNC\//i, "//").replace(/^\/\/\?\//, "");
  return normalized.startsWith("//")
    ? "//" + normalized.replace(/^\/+/, "").replace(/\/+/g, "/")
    : normalized.replace(/\/+/g, "/");
}

/** 미리 보기는 프로젝트 부모 폴더 기준으로, 원본 경로는 손대지 않는다. */
export function displayInstructionPath(path: string, base: string | null): string {
  const normalized = normalizeInstructionPath(path);
  if (base === null) return normalized;
  const normalizedBase = normalizeInstructionPath(base).replace(/\/+$/, "");
  const lastSlash = normalizedBase.lastIndexOf("/");
  if (lastSlash < 0) return normalized;
  const parent = normalizedBase.slice(0, lastSlash + 1);
  const windows = /^[a-z]:\//i.test(normalizedBase);
  const comparablePath = windows ? normalized.toLowerCase() : normalized;
  const comparableParent = windows ? parent.toLowerCase() : parent;
  return comparablePath.startsWith(comparableParent) && normalized.length > parent.length
    ? normalized.slice(parent.length)
    : normalized;
}

export interface InstructionChangeGroup {
  id: string;
  host: string | null;
  scope: FileChange["scope"];
  projectId: string | null;
  changes: FileChange[];
  unchanged: FileChange[];
  unchangedCount: number;
}

/** 전역 → 프로젝트별. 각 묶음에서 실제 변경 먼저, 변경 없음은 별도 접힌 목록으로. */
export function groupInstructionChanges(changes: readonly FileChange[]): InstructionChangeGroup[] {
  const groups = new Map<string, InstructionChangeGroup>();
  for (const change of changes) {
    const directory = change.path.replace(/\\/g, "/").replace(/\/[^/]*$/, "");
    const id = change.scope === "global" ? "global" : "project:" + (change.projectId ?? directory);
    let group = groups.get(id);
    if (!group) {
      group = { id, host: change.host, scope: change.scope, projectId: change.projectId, changes: [], unchanged: [], unchangedCount: 0 };
      groups.set(id, group);
    }
    if (change.action === "unchanged") {
      group.unchanged.push(change);
      group.unchangedCount++;
    } else group.changes.push(change);
  }
  const order = (a: FileChange, b: FileChange) =>
    Number(canApplyInstructions([b])) - Number(canApplyInstructions([a])) || a.path.localeCompare(b.path);
  for (const group of groups.values()) {
    group.changes.sort(order);
    group.unchanged.sort((a, b) => a.path.localeCompare(b.path));
  }
  return [...groups.values()].sort((a, b) =>
    Number(b.scope === "global") - Number(a.scope === "global") ||
    Number(canApplyInstructions(b.changes)) - Number(canApplyInstructions(a.changes)) || a.id.localeCompare(b.id),
  );
}
