// 설정 › 스니펫의 **추가 · 편집 하위 화면** 폼 ↔ 스니펫 변환 · 입력 검증 · 미리보기 — 순수 함수만
// (docs/log/2026-10-05-snippets-subview.md). 화면은 `settings/SnippetEditor.svelte` · `SnippetPreview.svelte`.
//
// **자리표시자 문법은 새로 구현하지 않는다** — 미리보기는 삽입 경로와 같은 `placeholdersOf` · `defaultValuesOf` ·
// `renderSnippet`(`$lib/snippets`)을 그대로 불러, 실제로 넣을 때 묻는 칸 · 나가는 글자와 어긋날 틈을 두지 않는다.
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

/** 폼의 칸들 — 범위는 select 값 그대로 들고 있다(`""` = 모든 호스트, 나머지는 호스트 별칭). */
export interface SnippetForm {
  name: string;
  command: string;
  description: string;
  /** 범위 select 의 값 — `""` 이 "모든 호스트" */
  alias: string;
  /** 넣은 뒤 Enter(`\r`)를 붙이는가 */
  enter: boolean;
}

/** 폼이 저장할 값 — `addSnippet` 의 `NewSnippet` · `editSnippet` 의 패치와 같은 모양(id 는 저장 쪽이 붙인다). */
export interface SnippetFields {
  name: string;
  command: string;
  description: string;
  scope: SnippetScope;
  enter: boolean;
}

/** 빈 스니펫 — "넣고 바로 실행" 은 켜진 채로 시작한다(스니펫의 기본값과 같다). */
export function emptySnippetForm(): SnippetForm {
  return { name: "", command: "", description: "", alias: "", enter: true };
}

/** 저장된 스니펫 → 폼 */
export function snippetToForm(s: Snippet): SnippetForm {
  return {
    name: s.name,
    command: s.command,
    description: s.description ?? "",
    alias: s.scope.kind === "host" ? s.scope.alias : "",
    enter: s.enter,
  };
}

/** select 값 → 범위 */
export function scopeOfAlias(alias: string): SnippetScope {
  const a = alias.trim();
  return a === "" ? { kind: "all" } : { kind: "host", alias: a.slice(0, MAX_SNIPPET_NAME) };
}

/** 폼 → 저장할 값. 앞뒤 공백을 떼고 상한(`MAX_SNIPPET_*`)에서 자른다 — 저장 쪽과 같은 다듬기다. */
export function formToSnippet(form: SnippetForm): SnippetFields {
  return {
    name: form.name.trim().slice(0, MAX_SNIPPET_NAME),
    command: form.command.trim().slice(0, MAX_SNIPPET_COMMAND),
    description: form.description.trim().slice(0, MAX_SNIPPET_DESCRIPTION),
    scope: scopeOfAlias(form.alias),
    enter: form.enter,
  };
}

/** 폼의 문제 — 저장 쪽(`addSnippet` · `updateSnippet`)이 거절하는 것은 이 둘뿐이다. */
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
 * 범위 select 의 후보 — 호스트 별칭들(가나다순, 중복 없음).
 *
 * 편집 중인 스니펫이 **지금 목록에 없는 별칭**을 가리킬 수 있다(호스트를 지웠거나 아직 안 읽었다). 그 값을 후보에
 * 얹지 않으면 화면을 여는 것만으로 범위가 "모든 호스트" 로 조용히 바뀐다 — 사용자가 누른 적 없는 변경이다.
 */
export function scopeAliasOptions(hostNames: readonly string[], current: string): string[] {
  const names = new Set(hostNames.filter((n) => n !== ""));
  if (current !== "") names.add(current);
  return [...names].sort((a, b) => a.localeCompare(b));
}

/** 미리보기 한 판 */
export interface SnippetPreviewResult {
  /** 넣을 때 물어볼 칸 — 나온 순서대로, 이름 중복 없이 */
  fields: SnippetPlaceholder[];
  /** 그중 하나라도 기본값 · 설명을 달고 있는가 — 그럴 때만 문법 한 줄을 덧붙인다 */
  annotated: boolean;
  /** 칸마다 지금 들어갈 값 — 시험 삼아 적은 값이 기본값을 이긴다 */
  values: Record<string, string>;
  /** 터미널에 나갈 글자(Enter 는 빼고) */
  text: string;
}

/**
 * 지금 명령이 넣을 때 어떻게 채워지는가 — 묻는 칸을 여는 순간과 같이 기본값으로 시작하고(`defaultValuesOf`), 시험
 * 삼아 적은 값(`typed`)이 그 위에 선다. 치환은 삽입 경로와 같은 `renderSnippet` — 값이 없는 칸은 빈 글자가 된다.
 * 지금 명령에 없는 칸 이름의 값은 버린다.
 */
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
