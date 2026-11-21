// 설정 › 스니펫 추가 · 편집 폼 — 순수 함수만.
// 자리표시자 문법은 새로 구현하지 않는다 — 삽입 경로와 같은 `$lib/snippets` 함수를 불러야 넣을 때 묻는 칸 · 나가는 글자와 어긋나지 않는다.
import {
  MAX_SNIPPET_COMMAND,
  MAX_SNIPPET_DESCRIPTION,
  MAX_SNIPPET_NAME,
  defaultValuesOf,
  placeholdersOf,
  renderSnippet,
  type Snippet,
  type SnippetPlaceholder,
  type SnippetScope,
} from "$lib/snippets";

export interface SnippetForm {
  name: string;
  command: string;
  description: string;
  /** `""` = 모든 호스트 */
  alias: string;
  enter: boolean;
}

export interface SnippetFields {
  name: string;
  command: string;
  description: string;
  scope: SnippetScope;
  enter: boolean;
}

export function emptySnippetForm(): SnippetForm {
  return { name: "", command: "", description: "", alias: "", enter: true };
}

export function snippetToForm(s: Snippet): SnippetForm {
  return {
    name: s.name,
    command: s.command,
    description: s.description ?? "",
    alias: s.scope.kind === "host" ? s.scope.alias : "",
    enter: s.enter,
  };
}

export function scopeOfAlias(alias: string): SnippetScope {
  const a = alias.trim();
  return a === "" ? { kind: "all" } : { kind: "host", alias: a.slice(0, MAX_SNIPPET_NAME) };
}

/** 저장 쪽과 같은 다듬기다(앞뒤 공백 · `MAX_SNIPPET_*` 자르기). */
export function formToSnippet(form: SnippetForm): SnippetFields {
  return {
    name: form.name.trim().slice(0, MAX_SNIPPET_NAME),
    command: form.command.trim().slice(0, MAX_SNIPPET_COMMAND),
    description: form.description.trim().slice(0, MAX_SNIPPET_DESCRIPTION),
    scope: scopeOfAlias(form.alias),
    enter: form.enter,
  };
}

/** 저장 쪽(`addSnippet` · `updateSnippet`)이 거절하는 것은 이 둘뿐이다. */
export type SnippetFormProblem = "name-empty" | "command-empty";

export function snippetFormProblems(form: SnippetForm): SnippetFormProblem[] {
  const out: SnippetFormProblem[] = [];
  if (form.name.trim() === "") out.push("name-empty");
  if (form.command.trim() === "") out.push("command-empty");
  return out;
}

export function canSaveSnippetForm(form: SnippetForm): boolean {
  return snippetFormProblems(form).length === 0;
}

/**
 * 편집 중인 스니펫이 지금 목록에 없는 별칭을 가리킬 수 있다 — 그 값을 후보에 얹지 않으면 화면을 여는 것만으로
 * 범위가 "모든 호스트" 로 조용히 바뀐다.
 */
export function scopeAliasOptions(hostNames: readonly string[], current: string): string[] {
  const names = new Set(hostNames.filter((n) => n !== ""));
  if (current !== "") names.add(current);
  return [...names].sort((a, b) => a.localeCompare(b));
}

export interface SnippetPreviewResult {
  fields: SnippetPlaceholder[];
  /** 하나라도 기본값 · 설명을 달고 있을 때만 문법 한 줄을 덧붙인다 */
  annotated: boolean;
  /** 시험 삼아 적은 값이 기본값을 이긴다 */
  values: Record<string, string>;
  /** Enter 는 빼고 */
  text: string;
}

export function previewSnippet(
  command: string,
  typed: Readonly<Record<string, string>> = {},
): SnippetPreviewResult {
  const fields = placeholdersOf(command);
  const values = defaultValuesOf(fields);
  for (const f of fields) if (Object.prototype.hasOwnProperty.call(typed, f.name)) values[f.name] = typed[f.name];
  return {
    fields,
    annotated: fields.some((f) => f.default !== undefined || f.description !== undefined),
    values,
    text: renderSnippet(command, values),
  };
}
