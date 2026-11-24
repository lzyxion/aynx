// 이름 규칙은 Rust `agent_instructions::name_ok` 와 같다. 본문은 손대지 않는다.
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

/** 이름 외의 출처 메타와 본문은 가져온 그대로 보존한다 */
export function importSelectionToInstruction(selection: InstructionImportSelection): Instruction | null {
  const { candidate, selected } = selection;
  const name = selection.name.trim();
  if (!selected || candidate.skipped !== null || !instructionNameOk(name)) return null;
  return {
    name, description: candidate.description, targets: [...candidate.targets], enabled: true,
    scope: candidate.scope, projects: [...candidate.projects], subpath: candidate.subpath, body: candidate.body,
  };
}

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

type PendingAction = "create" | "update" | "delete";
const isPending = (change: FileChange): change is FileChange & { action: PendingAction } =>
  change.action === "create" || change.action === "update" || change.action === "delete";

export function pendingInstructionCount(changes: readonly FileChange[]): number {
  return changes.filter(isPending).length;
}

/** 블록도 없고 바꿀 것도 없는 줄은 앱이 건드리지 않는 파일이라 요약에서 숨긴다 */
export function instructionFileVisible(change: FileChange): boolean {
  return change.block !== null || change.action !== "unchanged";
}

export type InstructionFileStatus =
  | { kind: "error" }
  | { kind: "pending"; action: PendingAction | null; count: number }
  | { kind: "skipped" }
  | { kind: "same" };

export function instructionFileStatus(changes: readonly FileChange[]): InstructionFileStatus {
  if (changes.some((change) => change.action === "error")) return { kind: "error" };
  const pending = changes.filter(isPending);
  if (pending.length > 0) return { kind: "pending", action: pending.length === 1 ? pending[0].action : null, count: pending.length };
  if (changes.length > 0 && changes.every((change) => change.action === "skipped")) return { kind: "skipped" };
  return { kind: "same" };
}

export interface InstructionFileRow {
  key: string;
  /** 워크트리 안 상대 경로(프로젝트에서 접은 줄). null 이면 `changes[0].path` 를 그대로 보인다 */
  relative: string | null;
  changes: FileChange[];
  agent: string | null;
  instructions: string[];
  duplicates: string[];
  /** 접은 줄 가운데 첫 오류 · 건너뜀 사유 */
  reason: string | null;
  status: InstructionFileStatus;
}

export interface InstructionFileGroup {
  id: string;
  scope: FileChange["scope"];
  host: string | null;
  projectId: string | null;
  firstPath: string;
  rows: InstructionFileRow[];
}

const union = (lists: string[][]): string[] => [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));

/** 요약의 "지침 파일" — 프로젝트는 워크트리마다 같은 (하위 폴더, 파일 이름) 줄을 하나로 접는다. 폴더 경로뿐인 줄(건너뜀 등)은 접지 않는다. */
export function instructionFileGroups(changes: readonly FileChange[]): InstructionFileGroup[] {
  return groupInstructionChanges(changes.filter(instructionFileVisible)).map((group) => {
    const all = [...group.changes, ...group.unchanged];
    const folded = new Map<string, { relative: string | null; changes: FileChange[] }>();
    for (const change of all) {
      const name = change.path.replace(/\\/g, "/").replace(/\/+$/, "").split("/").pop() ?? "";
      const file = group.scope === "project" && /\.md$/i.test(name);
      const relative = file ? (change.subpath ? change.subpath + "/" : "") + name : null;
      const key = relative !== null ? "rel:" + relative : "path:" + change.path;
      const entry = folded.get(key);
      if (entry) entry.changes.push(change);
      else folded.set(key, { relative, changes: [change] });
    }
    const rows = [...folded].map(([key, entry]): InstructionFileRow => ({
      key,
      relative: entry.relative,
      changes: entry.changes,
      agent: entry.changes[0].agent,
      instructions: union(entry.changes.map((change) => change.instructions)),
      duplicates: union(entry.changes.map((change) => change.duplicates)),
      reason: entry.changes.find((change) => change.reason && (change.action === "error" || change.action === "skipped"))?.reason ?? null,
      status: instructionFileStatus(entry.changes),
    })).sort((a, b) => (a.relative ?? a.changes[0].path).localeCompare(b.relative ?? b.changes[0].path));
    return { id: group.id, scope: group.scope, host: group.host, projectId: group.projectId, firstPath: all[0].path, rows };
  });
}

/** 지침 하나가 들어가는 파일 — 첫 경로와 나머지 수. 표시 경로가 같은 줄은 하나로 센다. */
export function instructionTargetSummary(
  name: string, changes: readonly FileChange[], display: (change: FileChange) => string,
): { first: string; more: number } | null {
  const paths = [...new Set(changes.filter((change) => change.instructions.includes(name)).map(display))];
  return paths.length > 0 ? { first: paths[0], more: paths.length - 1 } : null;
}
