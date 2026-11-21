/**
 * 스니펫 — 저장해 둔 명령 한 줄. 포커스된 터미널의 PTY 에 사람이 친 것과 같은 길(`write_session`)로 써 넣는다 —
 * 보내는 문자열은 사용자가 적어 둔 것이라 AI 문자열이 들어올 자리가 없다(원시 `send_command` 금지와 어긋나지 않는 이유).
 * 이 파일은 순수다 — 룬 · DOM · Tauri 없이 vitest 로 돈다.
 */

/** 모르는 버전은 통째로 무시한다 */
export const SNIPPET_FILE_VERSION = 1;

export const MAX_SNIPPET_NAME = 60;

export const MAX_SNIPPET_DESCRIPTION = 200;

export const MAX_SNIPPET_COMMAND = 4000;

export const MAX_SNIPPETS = 200;

export const SNIPPET_PREVIEW_CHARS = 60;

export const SNIPPET_NAME_CUT = 30;

/** 태그 유니온 — "모든 호스트" 를 `alias: null` 로 적으면 그 `null` 이 파일에 남아 범위 종류를 늘릴 자리가 없어진다 */
export type SnippetScope = { kind: "all" } | { kind: "host"; alias: string };

export interface Snippet {
  /** 이름을 바꿔도 그대로다 */
  id: string;
  name: string;
  command: string;
  description?: string;
  scope: SnippetScope;
  /** 뒤에 `\r` 을 붙이는가 — 기본은 참 */
  enter: boolean;
}

export interface SnippetFile {
  version: number;
  snippets: Snippet[];
}

// ── 자리표시자 ──

/** 안쪽에 `{`·`}` 를 허용하지 않는다 — `${{a}}` 같은 셸 문법이 토큰처럼 보인다. 앞뒤 공백은 이름에서 뗀다(같은 칸) */
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/** `default`·`description` 은 빈 문자열이면 없는 것이다 */
export interface SnippetPlaceholder {
  /** 치환의 열쇠 — `renderSnippet` 이 보는 유일한 값 */
  name: string;
  default?: string;
  description?: string;
}

/** 첫 `=` 와 첫 `|` 에서만 끊고 이스케이프는 없다 — 기본값에 `|` 는 못 넣는다(인용 규칙을 들여 작은 언어로 만들지 않는다) */
function splitToken(raw: string): SnippetPlaceholder | null {
  const cut = ((): number => {
    const eq = raw.indexOf("=");
    const bar = raw.indexOf("|");
    if (eq < 0) return bar;
    if (bar < 0) return eq;
    return Math.min(eq, bar);
  })();

  const name = (cut < 0 ? raw : raw.slice(0, cut)).trim();
  if (name === "") return null;

  const out: SnippetPlaceholder = { name };
  if (cut < 0) return out;

  let rest = raw.slice(cut);
  if (rest.startsWith("=")) {
    rest = rest.slice(1);
    const bar = rest.indexOf("|");
    const def = (bar < 0 ? rest : rest.slice(0, bar)).trim();
    if (def !== "") out.default = def;
    rest = bar < 0 ? "" : rest.slice(bar);
  }
  if (rest.startsWith("|")) {
    const desc = rest.slice(1).trim();
    if (desc !== "") out.description = desc;
  }
  return out;
}

export function placeholdersOf(command: string | null | undefined): SnippetPlaceholder[] {
  if (typeof command !== "string" || command === "") return [];
  const out: SnippetPlaceholder[] = [];
  const seen = new Set<string>();
  for (const m of command.matchAll(TOKEN)) {
    const field = splitToken(m[1] ?? "");
    if (!field || seen.has(field.name)) continue;
    seen.add(field.name);
    out.push(field);
  }
  return out;
}

/**
 * 값이 없는 칸은 빈 문자열 — 토큰 글자가 셸로 나가지 않게. 치환은 한 판뿐이다(넣은 값 안의 `{{…}}` 는 다시 풀리지 않는다).
 * 기본값은 여기서 보지 않는다 — 사람이 지운 칸은 지운 대로 나간다.
 */
export function renderSnippet(
  command: string | null | undefined,
  values: Readonly<Record<string, string>>,
): string {
  if (typeof command !== "string" || command === "") return "";
  return command.replace(TOKEN, (_all, raw: string) => {
    const field = splitToken(raw);
    if (!field) return "";
    return values[field.name] ?? "";
  });
}

export function defaultValuesOf(
  fields: readonly SnippetPlaceholder[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) if (f.default !== undefined) out[f.name] = f.default;
  return out;
}

// ── 검증 ── 절대 throw 하지 않는다.

function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/** 모양을 못 알아보면 "모든 호스트" 로 떨어뜨린다 — 버리면 사용자가 적어 둔 명령을 잃는다 */
function parseScope(raw: unknown): SnippetScope {
  if (!raw || typeof raw !== "object") return { kind: "all" };
  const o = raw as Record<string, unknown>;
  if (o.kind !== "host") return { kind: "all" };
  const alias = text(o.alias, MAX_SNIPPET_NAME);
  return alias === "" ? { kind: "all" } : { kind: "host", alias };
}

/** 깨진 줄만 버린다 — 스니펫은 서로 독립이다 */
export function parseSnippets(json: string | null | undefined): SnippetFile | null {
  if (typeof json !== "string" || json.trim() === "") return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  if (o.version !== SNIPPET_FILE_VERSION) return null;
  if (!Array.isArray(o.snippets)) return null;

  const snippets: Snippet[] = [];
  const seen = new Set<string>();
  for (const item of o.snippets) {
    if (!item || typeof item !== "object") continue;
    const s = item as Record<string, unknown>;
    const id = text(s.id, MAX_SNIPPET_NAME);
    const name = text(s.name, MAX_SNIPPET_NAME);
    // 안쪽 줄바꿈은 그대로 둔다 — 여러 줄 명령을 적어 둘 수 있어야 한다
    const command = text(s.command, MAX_SNIPPET_COMMAND);
    if (id === "" || name === "" || command === "" || seen.has(id)) continue;
    const description = text(s.description, MAX_SNIPPET_DESCRIPTION);
    seen.add(id);
    snippets.push({
      id,
      name,
      command,
      ...(description === "" ? {} : { description }),
      scope: parseScope(s.scope),
      enter: s.enter !== false,
    });
    if (snippets.length >= MAX_SNIPPETS) break;
  }
  return { version: SNIPPET_FILE_VERSION, snippets };
}

/** 같은 목록이면 같은 문자열이어야 한다 — 저장 쪽이 직전 JSON 과 비교한다(키 순서 고정 · 빈 설명은 키를 안 만든다) */
export function serializeSnippets(list: readonly Snippet[]): SnippetFile {
  return {
    version: SNIPPET_FILE_VERSION,
    snippets: list.map((s) => ({
      id: s.id,
      name: s.name,
      command: s.command,
      ...(s.description === undefined || s.description === "" ? {} : { description: s.description }),
      scope: s.scope.kind === "host" ? { kind: "host" as const, alias: s.scope.alias } : { kind: "all" as const },
      enter: s.enter,
    })),
  };
}

// ── 목록 조작 ──

export function withSnippet(list: readonly Snippet[], snippet: Snippet): Snippet[] {
  return [snippet, ...list.filter((s) => s.id !== snippet.id)].slice(0, MAX_SNIPPETS);
}

export function withoutSnippet(list: readonly Snippet[], id: string): Snippet[] {
  return list.filter((s) => s.id !== id);
}

/** 별칭 비교는 대소문자를 무시한다. 이름 변경을 따라가지 않으면 그 스니펫은 어디서도 걸리지 않는 줄이 된다 */
export function withRenamedHostScope(
  list: readonly Snippet[],
  from: string,
  to: string,
): Snippet[] | null {
  const oldKey = from.trim().toLowerCase();
  const alias = to.trim().slice(0, MAX_SNIPPET_NAME);
  if (oldKey === "" || alias === "") return null;
  const isOld = (s: Snippet) => s.scope.kind === "host" && s.scope.alias.trim().toLowerCase() === oldKey;
  if (!list.some(isOld)) return null;
  return list.map((s) => (isOld(s) ? { ...s, scope: { kind: "host" as const, alias } } : s));
}

export type SnippetPatch = Partial<Omit<Snippet, "id">>;

/** 제자리에서 고친다 — 이름 한 글자 고친 줄이 맨 앞으로 튀면 무엇을 고쳤는지 눈으로 좇지 못한다(`withSnippet` 과 나눈 이유) */
export function updateSnippet(
  list: readonly Snippet[],
  id: string,
  patch: SnippetPatch,
): Snippet[] | null {
  const i = list.findIndex((s) => s.id === id);
  if (i === -1) return null;
  const before = list[i];
  const next: Snippet = {
    ...before,
    ...patch,
    name: text(patch.name ?? before.name, MAX_SNIPPET_NAME),
    command: text(patch.command ?? before.command, MAX_SNIPPET_COMMAND),
  };
  const description = text(patch.description ?? before.description ?? "", MAX_SNIPPET_DESCRIPTION);
  if (description === "") delete next.description;
  else next.description = description;
  if (next.name === "" || next.command === "") return null;
  const out = list.slice();
  out[i] = next;
  return out;
}

/** `focusedAlias` 가 `null`(로컬 셸 · 파일 타일)이면 호스트 스니펫은 하나도 걸리지 않는다 */
export function snippetsForScope(
  list: readonly Snippet[],
  focusedAlias: string | null,
): Snippet[] {
  const alias = focusedAlias?.trim() ?? "";
  return list.filter(
    (s) => s.scope.kind === "all" || (alias !== "" && s.scope.alias === alias),
  );
}

// ── 이미 친 명령 → 스니펫 ──

function flatten(command: string | null | undefined): string {
  return typeof command === "string" ? command.replace(/\s+/g, " ").trim() : "";
}

/** 글자는 손대지 않는다(`sudo` 떼기 · 경로 줄이기 없음) — 지어낸 이름은 사람이 고치기 전의 초안이다 */
export function defaultSnippetName(
  command: string | null | undefined,
  max = SNIPPET_NAME_CUT,
): string {
  const flat = flatten(command);
  if (max <= 0) return "";
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const cut = head.lastIndexOf(" ");
  return (cut > 0 ? head.slice(0, cut) : head).trimEnd();
}

/** 이름 쪽에는 `…` 를 넣지 않는다 — 파일에 남아 이름의 일부로 굳는다 */
export function snippetSaveLabel(
  command: string | null | undefined,
  max = SNIPPET_NAME_CUT,
): string {
  const flat = flatten(command);
  const name = defaultSnippetName(command, max);
  return name === flat ? name : `${name}…`;
}

/** "맞는 스니펫이 없을 때만" 으로 좁히지 않는다 — 걸린 줄이 원하는 것이 아니면 방금 친 글자를 잃는다 */
export function shouldOfferSave(
  query: string | null | undefined,
  commands: readonly string[],
): boolean {
  const q = typeof query === "string" ? query.trim() : "";
  if (q.length < 3) return false;
  return !commands.some((c) => c.trim() === q);
}

// ── 입력 중 제안 ──

export const SNIPPET_SUGGEST_MIN_CHARS = 2;

export const SNIPPET_SUGGEST_LIMIT = 6;

export const SNIPPET_SUGGEST_PREVIEW_CHARS = 50;

export interface SnippetSuggestion {
  id: string;
  name: string;
  preview: string;
  /** 명령 원문 — 잘린 `preview` 로는 똑같은 명령인가를 비교할 수 없다 */
  command: string;
}

/**
 * `hosts.ts` 의 `fuzzyMatch` 와 같은 규칙 — 임포트하지 않는다: `hosts.ts` 는 Tauri `invoke` 를 들고 있어 이 순수 모듈의 계약이 깨진다.
 * 부르는 쪽이 이미 소문자로 접어 넘긴다.
 */
function subsequence(lowerQuery: string, lowerText: string): boolean {
  if (lowerQuery === "") return true;
  let i = 0;
  for (let j = 0; j < lowerText.length && i < lowerQuery.length; j++) {
    if (lowerText[j] === lowerQuery[i]) i += 1;
  }
  return i === lowerQuery.length;
}

/**
 * 범위를 지난다(`snippetsForScope`) — 로컬 셸에 서버 전용 명령이 뜨면 고르는 순간 엉뚱한 서버의 명령이 나간다.
 * `focusedAlias` 는 그 타일의 SSH 별칭이다(창 전체의 포커스가 아니다).
 */
export function suggestSnippets(
  typed: string | null | undefined,
  list: readonly Snippet[],
  focusedAlias: string | null,
  limit = SNIPPET_SUGGEST_LIMIT,
): SnippetSuggestion[] {
  const q = typeof typed === "string" ? typed.trim() : "";
  if (q.length < SNIPPET_SUGGEST_MIN_CHARS || limit <= 0) return [];
  const lower = q.toLowerCase();

  const starts: Snippet[] = [];
  const fuzzy: Snippet[] = [];
  for (const s of snippetsForScope(list, focusedAlias)) {
    if (s.command.trim() === q) continue;
    const name = s.name.toLowerCase();
    const command = s.command.toLowerCase();
    if (name.startsWith(lower) || command.startsWith(lower)) starts.push(s);
    else if (subsequence(lower, name) || subsequence(lower, command)) fuzzy.push(s);
  }

  return [...starts, ...fuzzy].slice(0, limit).map((s) => ({
    id: s.id,
    name: s.name,
    preview: snippetPreview(s.command, SNIPPET_SUGGEST_PREVIEW_CHARS),
    command: s.command,
  }));
}

// ── 명령 팔레트가 받는 모양 ──

/** 팔레트는 스니펫의 구조를 모른다 — 스니펫에 칸이 늘어도 팔레트를 고칠 일이 없게 */
export interface SnippetPaletteEntry {
  id: string;
  /** 붙는 말("스니펫: ")은 팔레트가 사전에서 꺼내 붙인다 — 이 모듈은 화면 언어를 모른다 */
  name: string;
  detail: string;
  keywords: string;
  /** 그리는 데 쓰지 않는다 — 저장 줄 판정(`shouldOfferSave`)의 똑같은 명령 비교용이다(잘린 미리보기로는 못 한다) */
  command: string;
}

/** 자른 표시(`…`)까지 합쳐 정확히 상한 글자다 */
export function snippetPreview(command: string, max = SNIPPET_PREVIEW_CHARS): string {
  const flat = flatten(command);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
}

/** 단축키 `Ctrl+Shift+;` 와 같은 글자 — 거르는 팔레트와 미리 채우는 `openSnippetPalette` 가 이 값 하나를 본다 */
export const SNIPPET_QUERY_PREFIX = ";";

export function snippetPaletteEntries(
  list: readonly Snippet[],
  focusedAlias: string | null,
): SnippetPaletteEntry[] {
  return snippetsForScope(list, focusedAlias).map((s) => {
    const detail = snippetPreview(s.command);
    return {
      id: s.id,
      name: s.name,
      detail,
      command: s.command,
      // 묶음 이름("스니펫")은 화면 언어를 타므로 넣지 않는다 — 팔레트가 훑기 직전에 얹는다.
      keywords: [s.name, detail, s.description ?? "", s.scope.kind === "host" ? s.scope.alias : ""]
        .filter((p) => p !== "")
        .join(" "),
    };
  });
}
