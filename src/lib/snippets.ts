/**
 * **스니펫 — 저장해 둔 명령 한 줄** (docs/log/2026-09-16-snippets.md).
 *
 * 자주 치는 명령(`systemctl status nginx` · `tail -f /var/log/…`)을 이름 붙여 남겨 두었다가
 * **포커스된 터미널 타일의 PTY 에 그대로 써 넣는다.** 앱이 새 실행 통로를 여는 것이 아니다 —
 * 사람이 키보드로 친 것과 **완전히 같은 길**(`write_session` — 로컬·SSH 공용)로 나가고, 보내는
 * 문자열은 사용자가 스스로 적어 둔 것이다 (CLAUDE.md 의 "원시 `send_command` 는 만들지
 * 않는다" 와 어긋나지 않는 이유: 여기에는 AI 가 만든 문자열이 들어올 자리가 없다).
 *
 * ## 이 파일은 **순수**다
 *
 * 룬도 DOM 도 Tauri 도 없다 — `theme-profiles.ts` 와 같은 분담이다. 목록을 창에 하나
 * 들고 있는 일과 파일 왕복은 `snippets.svelte.ts`, 터미널에 써 넣는 일은
 * `app/snippets.svelte.ts` 가 맡는다. 그래서 여기 있는 것은 전부 vitest 로 그대로 돈다
 * (`vitest.config.ts` 의 "`.svelte.ts` 는 대상이 아니다").
 *
 * ## 자리표시자 `{{이름=기본값|설명}}`
 *
 * 명령 안의 `{{호스트}}` 같은 토큰은 **삽입하는 순간** 사람에게 값을 묻는다. 저장해 두는
 * 것은 틀이고 그때그때 다른 것은 한두 조각뿐이라, 조각마다 스니펫을 하나씩 만들면 목록이
 * 금세 못 읽을 것이 된다.
 *
 * 이름 뒤에 **기본값**(`=`)과 **설명**(`|`)을 달 수 있다 — 둘 다 선택이고 순서는 고정이다
 * (`{{경로=/var|어느 경로를 볼지}}`). 묻는 화면은 기본값을 미리 채워 두고 설명을 칸 아래
 * 도움말로 편다. 대개 묻는 칸은 "거의 늘 같은 값" 이라, 빈 칸을 내밀면 사람이 매번 같은
 * 글자를 다시 친다.
 *
 * **문법은 일부러 얕다** — 끊는 자리는 **첫 `=`** 와 **첫 `|`** 뿐이고 이스케이프가 없다.
 * 그래서 기본값 안에 `|` 를 넣을 수 없고(그 뒤는 설명이 된다), 설명 안의 `=` 는 그냥 글자다.
 * 인용·이스케이프 규칙을 들이면 이 짧은 토큰이 또 하나의 작은 언어가 되는데, 여기서 얻는
 * 것(파이프가 든 기본값)보다 잃는 것(사람이 외워야 할 규칙)이 크다.
 *
 * 치환은 **한 번만** 돈다 (넣은 값 안의 `{{…}}` 는 다시 치환되지 않는다) — 값이 스스로를
 * 부풀리는 길을 남기지 않기 위해서다. 치환이 보는 것은 **이름뿐**이다: 기본값은 묻는 화면의
 * 초기값이지 "값이 없을 때 대신 들어가는 것" 이 아니다 (사람이 지운 칸은 지운 대로 나간다).
 *
 * ## 범위(scope)
 *
 * `{kind:"all"}` 은 어디서나, `{kind:"host",alias}` 는 **그 별칭의 SSH 타일이 포커스일
 * 때만** 보인다. 서버마다 명령이 다른 것이 보통이고(패키지 관리자·서비스 이름), 목록에
 * 전부 섞여 있으면 고를 때마다 "이건 어디 것이었지" 를 사람이 기억해야 한다. 로컬 셸에는
 * 별칭이 없으므로 호스트 스니펫이 **절대** 걸리지 않는다.
 */

/** 파일 형식 버전. 모르는 버전은 **통째로 무시**한다 ([`parseSnippets`]) */
export const SNIPPET_FILE_VERSION = 1;

/** 이름 길이 상한 — `MAX_LAYOUT_NAME` 과 같은 이유·같은 값 (목록 한 줄에 들어가야 한다) */
export const MAX_SNIPPET_NAME = 60;

/** 설명 길이 상한 — 목록 둘째 줄에 들어갈 만큼만 */
export const MAX_SNIPPET_DESCRIPTION = 200;

/**
 * 명령 길이 상한.
 *
 * 스니펫은 "한두 줄짜리 명령" 이고 스크립트 파일이 아니다. 상한이 있는 이유는 붙여넣기
 * 사고(로그 한 뭉치를 명령 칸에 떨어뜨림) 하나뿐이라 넉넉하게 잡는다 — 셸의 한 줄 한계보다
 * 크고, 사람이 손으로 적는 어떤 명령보다도 크다.
 */
export const MAX_SNIPPET_COMMAND = 4000;

/**
 * 보관하는 최대 개수. 넘치면 **가장 오래된 것**부터 밀려난다 (레이아웃·테마 프로필과 같은
 * 규칙). 레이아웃(40)보다 훨씬 큰 것은 성격이 다르기 때문이다 — 스니펫은 하나가 한 줄짜리
 * 값이라 수십 개가 쌓이는 것이 정상이다.
 */
export const MAX_SNIPPETS = 200;

/** 팔레트 · 목록에 보여 줄 명령 미리보기의 최대 글자 수 */
export const SNIPPET_PREVIEW_CHARS = 60;

/**
 * 명령에서 **이름을 지어낼 때** 쓰는 글자 수 ([`defaultSnippetName`]).
 *
 * [`MAX_SNIPPET_NAME`](60)보다 훨씬 짧다 — 저쪽은 "여기까지는 담아 둔다" 는 상한이고
 * 이쪽은 "사람이 안 적었을 때 대신 적어 주는 길이" 라 목적이 다르다. 30자면 메뉴 한 줄과
 * 목록 한 줄에 그대로 들어가고, 명령의 앞머리(프로그램 이름 + 첫 인자 한둘)를 담기에 넉넉하다.
 */
export const SNIPPET_NAME_CUT = 30;

/**
 * 이 스니펫이 **어디서 보이는가**.
 *
 * 태그 유니온인 이유는 "모든 호스트" 를 `alias: null` 로 적으면 그 `null` 이 파일에도
 * 남아, 나중에 범위 종류가 하나 더 늘 때(그룹·로컬 전용) 뜻을 이어 붙일 자리가 없어지기
 * 때문이다.
 */
export type SnippetScope = { kind: "all" } | { kind: "host"; alias: string };

/** 스니펫 하나 */
export interface Snippet {
  /** 이 목록 안에서만 뜻이 있는 안정적인 키 (이름을 바꿔도 그대로다) */
  id: string;
  /** 사용자가 붙인 이름 — 목록·팔레트에서 이것으로 찾는다 */
  name: string;
  /** 터미널에 써 넣을 문자열. `{{이름}}` 토큰이 들어갈 수 있다 */
  command: string;
  /** 한 줄 설명 (없을 수 있다) */
  description?: string;
  /** 어디서 보이는가 (위 [`SnippetScope`]) */
  scope: SnippetScope;
  /** 뒤에 `\r` 을 붙이는가 — **기본은 참**(대개 곧바로 실행하려고 저장한다) */
  enter: boolean;
}

/** `snippets.json` 한 장 */
export interface SnippetFile {
  version: number;
  snippets: Snippet[];
}

// ---------------------------------------------------------------------------
// 자리표시자
// ---------------------------------------------------------------------------

/**
 * `{{이름}}` 토큰 하나 (`{{이름=기본값|설명}}` 까지).
 *
 * 안쪽에 `{`·`}` 를 허용하지 않는 것이 요점이다 — 그러지 않으면 `${{a}}` 같은 셸 문법이
 * 토큰처럼 보이는 자리가 생긴다. 앞뒤 공백은 허용하되 이름에서 떼어 낸다
 * (`{{ 호스트 }}` 와 `{{호스트}}` 는 **같은 칸**이어야 한다 — 다르게 보면 사람에게 같은
 * 것을 두 번 묻게 된다).
 *
 * 안쪽을 더 잘게 쪼개는 일은 정규식이 아니라 [`splitToken`] 이 한다 — 기본값에는 무엇이든
 * 들어갈 수 있어서(경로·따옴표·공백) 정규식으로 그리면 읽을 수 없는 한 줄이 된다.
 */
const TOKEN = /\{\{\s*([^{}]*?)\s*\}\}/g;

/**
 * 묻는 칸 하나의 **틀** — 이름과, 선택적인 기본값·설명.
 *
 * `default`·`description` 은 **빈 문자열이면 없는 것**이다 (`{{a=}}` 는 기본값 없음과 같다 —
 * 빈 칸을 미리 채우는 것은 아무것도 채우지 않는 것과 구별되지 않는다).
 */
export interface SnippetPlaceholder {
  /** 치환의 열쇠 — `renderSnippet` 이 보는 유일한 값 */
  name: string;
  /** 묻는 칸에 **미리 채워 둘** 값 */
  default?: string;
  /** 칸 아래에 뜨는 도움말 한 줄 */
  description?: string;
}

/**
 * 토큰 안쪽 한 덩어리를 `이름` · `기본값` · `설명` 셋으로 — **첫 `=` 와 첫 `|` 에서만** 끊는다.
 *
 * 순서는 `이름 [= 기본값] [| 설명]` 고정이고 이스케이프는 없다. 따라서:
 *
 * - `{{경로=/var|어느 경로}}` → 이름 `경로` · 기본값 `/var` · 설명 `어느 경로`
 * - `{{경로|어느 경로=무엇}}` → 이름 `경로` · 설명 `어느 경로=무엇` (설명 속 `=` 는 글자다)
 * - `{{경로=a|b}}` → 기본값 `a` · 설명 `b` — **기본값에 `|` 는 못 넣는다** (문법의 대가다)
 *
 * 세 조각 모두 앞뒤 공백을 떼어 낸다 (`{{ 경로 = /var }}` 도 같은 칸·같은 기본값이다).
 */
function splitToken(raw: string): SnippetPlaceholder | null {
  const cut = ((): number => {
    const eq = raw.indexOf("=");
    const bar = raw.indexOf("|");
    if (eq < 0) return bar;
    if (bar < 0) return eq;
    return Math.min(eq, bar);
  })();

  const name = (cut < 0 ? raw : raw.slice(0, cut)).trim();
  if (name === "") return null; // 이름 없는 칸은 자리표시자가 아니다

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

/**
 * 명령에 든 자리표시자들 — **나온 순서대로, 이름 중복 없이**.
 *
 * 순서를 지키는 이유는 묻는 화면이 이 배열을 그대로 칸으로 펴기 때문이다: 명령에 적힌
 * 순서와 묻는 순서가 다르면 사람이 어느 칸이 어디에 들어가는지 짚지 못한다.
 *
 * 같은 이름이 여러 번 나오면 **처음 것의 기본값·설명이 이긴다** — 나중 것을 이기게 하면
 * 사람이 명령을 눈으로 좇으며 읽은 첫 번째 설명과 화면이 어긋난다. (뒤에 붙은 것은 그냥
 * 무시된다: `{{호스트=web-01}} … {{호스트}}` 는 한 칸이고 기본값은 `web-01` 이다.)
 *
 * 빈 이름(`{{}}` · `{{ = }}`)은 **자리표시자가 아니다** — 물어볼 것이 없고, 목록에 이름
 * 없는 칸을 세우면 그 칸이 무엇인지 설명할 길이 없다.
 */
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
 * 자리표시자를 값으로 바꾼 문자열 — **순수**.
 *
 * 값이 없는 칸은 **빈 문자열**이 된다. 토큰을 그대로 남기지 않는 이유는 그러면
 * `{{호스트}}` 라는 글자가 셸에 그대로 나가기 때문이다 — 사람이 취소한 것도 아닌데
 * 뜻 없는 인자가 실행되는 쪽이 훨씬 나쁘다 (취소는 삽입 자체를 중단하는 별개의 길이다).
 *
 * **기본값은 여기서 보지 않는다.** 기본값은 묻는 화면이 칸을 미리 채우는 값이고, 그 칸을
 * 사람이 지웠다면 지운 대로 나가야 한다 — 여기서 되살리면 "지웠는데 다시 들어왔다" 가 된다.
 *
 * **치환은 한 번뿐이다** (`replace` 한 판) — 넣은 값 안의 `{{…}}` 는 다시 풀리지 않는다.
 */
export function renderSnippet(
  command: string | null | undefined,
  values: Readonly<Record<string, string>>,
): string {
  if (typeof command !== "string" || command === "") return "";
  return command.replace(TOKEN, (_all, raw: string) => {
    const field = splitToken(raw);
    if (!field) return ""; // 이름 없는 토큰은 자리표시자가 아니다 — 그냥 지운다
    return values[field.name] ?? "";
  });
}

/**
 * 묻기 전의 **초기값 표** — 기본값이 적힌 칸만 채워 둔다.
 *
 * 묻는 화면(`app/snippets.svelte.ts`)이 여는 순간 부른다. 여기 두는 이유는 "기본값이
 * 무엇이었나" 가 문법의 일부라 순수 층에 있어야 하기 때문이다.
 */
export function defaultValuesOf(
  fields: readonly SnippetPlaceholder[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) if (f.default !== undefined) out[f.name] = f.default;
  return out;
}

// ---------------------------------------------------------------------------
// 검증 — 파일 → 믿을 수 있는 목록 (순수, 절대 throw 하지 않는다)
// ---------------------------------------------------------------------------

/** 문자열 칸 하나를 다듬는다 (문자열이 아니면 빈 문자열) */
function text(v: unknown, max: number): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * 파일에서 온 범위 한 칸. 모양을 못 알아보면 **"모든 호스트"** 로 떨어뜨린다.
 *
 * 왜 버리지 않고 떨어뜨리나: 범위가 깨진 스니펫을 통째로 지우면 사용자는 자기가 적어 둔
 * 명령을 잃는다. "어디서나 보인다" 는 **더 넓은** 쪽이라 잃는 것이 없고, 화면에서 곧바로
 * 눈에 띄어 고칠 수 있다.
 */
function parseScope(raw: unknown): SnippetScope {
  if (!raw || typeof raw !== "object") return { kind: "all" };
  const o = raw as Record<string, unknown>;
  if (o.kind !== "host") return { kind: "all" };
  const alias = text(o.alias, MAX_SNIPPET_NAME);
  return alias === "" ? { kind: "all" } : { kind: "host", alias };
}

/**
 * 원시 JSON 문자열 → 검증된 파일 한 장. 파싱 실패·모르는 버전이면 `null`.
 *
 * **깨진 줄만 버린다** (`parseLayoutFile`·`parseProfiles` 와 같은 판정): 스니펫은 서로
 * 독립이라 한 줄이 이상하다고 나머지를 함께 버리면 잃는 것이 훨씬 크다. 이름이나 명령이
 * 빈 줄, id 가 없거나 겹치는 줄만 빠진다.
 */
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
    // 명령은 `trim` 하되 **안쪽 줄바꿈은 그대로 둔다** — 여러 줄 명령을 그대로 적어 둘 수
    // 있어야 한다 (셸이 줄마다 하나씩 받는다).
    const command = text(s.command, MAX_SNIPPET_COMMAND);
    if (id === "" || name === "" || command === "" || seen.has(id)) continue;
    const description = text(s.description, MAX_SNIPPET_DESCRIPTION);
    seen.add(id);
    snippets.push({
      id,
      name,
      command,
      // 빈 설명은 **키 자체를 만들지 않는다** — "안 적었다" 와 "빈 글자를 적었다" 를 파일에서
      // 구분할 이유가 없고, 키가 없어야 직렬화 결과가 짧고 안정적이다.
      ...(description === "" ? {} : { description }),
      scope: parseScope(s.scope),
      // 모르는 값은 **참**으로 떨어뜨린다 (기본이 "보내고 실행" 이다 — 아래 `enter` 주석).
      enter: s.enter !== false,
    });
    if (snippets.length >= MAX_SNIPPETS) break;
  }
  return { version: SNIPPET_FILE_VERSION, snippets };
}

/**
 * 목록 → 파일 모양 — **순수 함수**.
 *
 * 저장 쪽이 이 결과를 `JSON.stringify` 해 직전 값과 비교하므로(`layouts.svelte.ts` 와 같은
 * 규칙) **같은 목록이면 같은 문자열**이 나와야 한다. 그래서 키 순서를 고정하고, 없는
 * 설명은 키를 만들지 않는다.
 */
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

// ---------------------------------------------------------------------------
// 목록 조작 — 전부 **새 배열**을 돌려준다 (모듈 상태는 `snippets.svelte.ts`)
// ---------------------------------------------------------------------------

/**
 * 스니펫 하나를 목록에 넣는다 — **같은 id 가 있으면 그 자리 값을 갈아 끼우고**(맨 앞으로
 * 올린다), 없으면 앞에 붙인다. 넘치면 가장 오래된 것부터 밀려난다
 * (`withProfile` 과 같은 규칙).
 */
export function withSnippet(list: readonly Snippet[], snippet: Snippet): Snippet[] {
  return [snippet, ...list.filter((s) => s.id !== snippet.id)].slice(0, MAX_SNIPPETS);
}

/** 스니펫 하나를 뺀다 (없는 id 면 같은 내용의 새 배열) */
export function withoutSnippet(list: readonly Snippet[], id: string): Snippet[] {
  return list.filter((s) => s.id !== id);
}

/**
 * 호스트 별칭 하나가 **이름이 바뀌었을 때** 따라가는 새 목록 — 바꿀 줄이 없으면 `null`.
 *
 * 호스트 범위(`{kind:"host", alias}`)는 별칭 **글자**를 담고 있고, [`snippetsForScope`] 가
 * 그 글자와 포커스된 타일의 별칭을 맞대어 본다. 그래서 `~/.ssh/config` 의 이름이 바뀌면 그
 * 스니펫들은 **어디서도 걸리지 않는 줄**이 된다 — 목록에는 남아 있으니 지워진 것도 아니고,
 * 왜 안 뜨는지 화면에 흔적도 없다 (docs/log/2026-09-17-host-rename-fanout.md).
 *
 * `null` 로 "할 일 없음" 을 말하는 것은 [`updateSnippet`] 과 같은 계약이다 — 부르는 쪽이
 * 그때 파일 쓰기를 통째로 건너뛴다. 별칭 비교는 **대소문자를 무시한다**(별칭 비교의 기준이
 * 저장소 전체에서 그렇다). `{kind:"all"}` 은 손대지 않는다.
 */
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

/** [`updateSnippet`] 이 받는 **고칠 칸만** 담은 조각 */
export type SnippetPatch = Partial<Omit<Snippet, "id">>;

/**
 * 한 줄을 **제자리에서** 고친 새 목록. 없는 id 거나 결과가 말이 안 되면 `null`.
 *
 * [`withSnippet`] 과 나눠 두는 이유는 **자리**다: 저쪽은 "새로 저장했다" 라 맨 앞으로
 * 올리지만, 이름 한 글자를 고친 것뿐인데 목록에서 줄이 튀어 오르면 사용자는 방금 무엇을
 * 고쳤는지 눈으로 좇지 못한다.
 *
 * 말이 안 되는 것은 둘뿐이다 — 빈 이름, 빈 명령. 그 둘이 비면 목록에 **누를 수는 있는데
 * 아무 일도 안 하는 줄**이 남는다.
 */
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

/**
 * **지금 자리에서 뜻이 있는 스니펫들** — 순서는 목록 그대로다.
 *
 * `focusedAlias` 는 포커스된 타일의 SSH 별칭이고, 로컬 셸·파일 타일이면 `null` 이다.
 * `null` 이면 호스트 스니펫은 **하나도** 걸리지 않는다 (별칭이 없는 자리에 서버 전용 명령을
 * 내보일 이유가 없다).
 */
export function snippetsForScope(
  list: readonly Snippet[],
  focusedAlias: string | null,
): Snippet[] {
  const alias = focusedAlias?.trim() ?? "";
  return list.filter(
    (s) => s.scope.kind === "all" || (alias !== "" && s.scope.alias === alias),
  );
}

// ---------------------------------------------------------------------------
// 이미 친 명령 → 스니펫 (docs/log/2026-09-16-snippets.md 의 "만드는 입구 둘")
//
// 스니펫이 생기는 자리를 설정 화면 하나로 두면 **쓸 만한 명령을 방금 친 그 순간**에 남길
// 길이 없다. 그래서 입구를 둘 더 냈고(터미널 우클릭 · 팔레트), 둘 다 "이름을 뭐라고 할까"
// 를 사람에게 떠넘기지 않으려면 **명령에서 이름을 지어내는 규칙 하나**가 있어야 한다.
// 그 규칙이 여기 산다 — 두 입구가 같은 이름을 미리 채우고, 메뉴 라벨도 같은 글자를 보인다.
// ---------------------------------------------------------------------------

/** 여러 줄·연속 공백을 한 칸으로 접은 한 줄 (미리보기·이름 짓기가 함께 쓴다) */
function flatten(command: string | null | undefined): string {
  return typeof command === "string" ? command.replace(/\s+/g, " ").trim() : "";
}

/**
 * 명령 하나에서 **미리 채울 이름** — 앞 [`SNIPPET_NAME_CUT`] 글자를 **낱말 경계에서** 끊는다.
 *
 * 낱말 경계로 끊는 이유는 한가운데서 잘린 이름이 목록에서 읽히지 않기 때문이다
 * (`docker compose -f prod.yml u` 보다 `docker compose -f prod.yml` 이 낫다). 경계가 없으면
 * (첫 낱말이 이미 상한보다 길다) 그냥 그 자리에서 자른다 — 빈 이름보다는 잘린 이름이 낫다.
 *
 * **글자는 손대지 않는다.** `sudo` 를 떼거나 경로를 줄이지 않는다: 지어낸 이름은 어디까지나
 * 사람이 고치기 전의 **초안**이고, 몰래 바꾼 글자는 그 자리에서 눈치채기 어렵다. 하는 일은
 * 여러 줄을 한 줄로 접고([`flatten`]) 길이를 맞추는 것뿐이다.
 *
 * 돌려주는 값은 **절대 상한을 넘지 않는다** — 그대로 이름 칸의 초깃값이 된다.
 */
export function defaultSnippetName(
  command: string | null | undefined,
  max = SNIPPET_NAME_CUT,
): string {
  const flat = flatten(command);
  if (max <= 0) return "";
  if (flat.length <= max) return flat;
  const head = flat.slice(0, max);
  const cut = head.lastIndexOf(" ");
  // 경계가 맨 앞이면(`cut <= 0`) 낱말 하나도 못 담은 것이라 그냥 상한에서 끊는다.
  return (cut > 0 ? head.slice(0, cut) : head).trimEnd();
}

/**
 * 메뉴·목록에 그리는 **"이 명령을 저장한다"** 한 토막 — [`defaultSnippetName`] 과 같은 글자에
 * 잘렸다는 표시(`…`)만 더한다.
 *
 * 이름 쪽에 `…` 를 넣지 않는 이유: 그 값은 파일에 남아 목록의 이름이 되는데, 사람이 고치지
 * 않으면 말줄임표가 이름의 일부로 굳는다. 반대로 메뉴 라벨은 **읽고 마는 글자**라 잘렸다는
 * 사실이 보이는 편이 낫다.
 */
export function snippetSaveLabel(
  command: string | null | undefined,
  max = SNIPPET_NAME_CUT,
): string {
  const flat = flatten(command);
  const name = defaultSnippetName(command, max);
  return name === flat ? name : `${name}…`;
}

/**
 * 팔레트의 `;` 목록 맨 끝에 **"이 글자를 스니펫으로 저장" 줄을 세우는가** — 순수 규칙.
 *
 * 규칙은 둘뿐이다(일부러 단순하다).
 *
 * 1. 질의가 **세 글자 이상**이다. 한두 글자는 대개 목록을 좁히려고 친 것이지 명령이 아니고,
 *    그때마다 저장 줄이 서면 `;` 를 친 사람이 매 글자마다 흔들리는 목록을 본다.
 * 2. **같은 명령의 스니펫이 아직 없다.** 이미 있는 것을 또 만들면 목록에 구분되지 않는 줄이
 *    둘 선다 (이름은 유일할 필요가 없지만 — `addSnippet` 주석 — 같은 **명령**을 둘 두는 것은
 *    사람이 뜻해서 하는 일이 아니다).
 *
 * "맞는 스니펫이 하나도 없을 때만" 이 아닌 이유: 검색에 걸린 줄이 있어도 **그 줄들이 원하는
 * 것이 아니라서** 명령을 통째로 친 경우가 있고, 그때 저장 줄이 사라지면 방금 친 글자를 다시
 * 어딘가에 옮겨 적어야 한다. 줄은 언제나 묶음의 **맨 끝**에 서므로 위의 결과를 밀어내지 않는다.
 *
 * `commands` 는 지금 목록의 명령들이다 (팔레트는 `Snippet` 구조를 모르므로 문자열만 받는다).
 */
export function shouldOfferSave(
  query: string | null | undefined,
  commands: readonly string[],
): boolean {
  const q = typeof query === "string" ? query.trim() : "";
  if (q.length < 3) return false;
  return !commands.some((c) => c.trim() === q);
}

// ---------------------------------------------------------------------------
// 입력 중 제안 (docs/log/2026-09-16-snippets.md 의 "입력 중 제안")
//
// 프롬프트에 두 글자 이상 치면 맞는 스니펫이 커서 옆에 뜬다. "지금 무엇을 치고 있는가" 를
// 아는 일은 `snippet-input.ts`(규칙)와 `Terminal.svelte`(버퍼)가 하고, 여기 있는 것은
// **그 글자로 어느 줄이 서는가** 하나다 — 팔레트의 거르기와 같은 결이고, 그래서 같은 층에 산다.
// ---------------------------------------------------------------------------

/**
 * 제안이 서기 시작하는 **최소 글자 수**.
 *
 * 한 글자로도 목록을 만들 수는 있지만 그때 걸리는 것은 거의 전부라, 명령을 치기 시작한
 * 첫 키마다 커서 옆에 상자가 떴다 사라진다. 두 글자는 `ls`·`cd` 같은 가장 짧은 명령이
 * 이미 다 들어오는 길이이기도 하다.
 */
export const SNIPPET_SUGGEST_MIN_CHARS = 2;

/** 한 번에 보여 줄 최대 줄 수 — 커서 옆의 작은 상자라 화면을 가리면 안 된다 */
export const SNIPPET_SUGGEST_LIMIT = 6;

/**
 * 제안 줄의 명령 미리보기 길이 — 팔레트([`SNIPPET_PREVIEW_CHARS`], 60)보다 짧다.
 * 저쪽은 화면 가운데의 넓은 목록이고 이쪽은 커서 옆에 뜨는 좁은 상자다.
 */
export const SNIPPET_SUGGEST_PREVIEW_CHARS = 50;

/** 제안 한 줄 — 화면이 그리는 것과 넣을 때 쓸 `id` 뿐이다 */
export interface SnippetSuggestion {
  /** 고르면 그대로 넣기 경로로 간다 */
  id: string;
  /** 굵게 그리는 이름 */
  name: string;
  /** 흐리게 따라붙는 명령 미리보기 (≤ [`SNIPPET_SUGGEST_PREVIEW_CHARS`]) */
  preview: string;
  /** 명령 **원문** — `detail` 로는 못 하는 비교(똑같은 명령인가)를 위해 싣는다 */
  command: string;
}

/**
 * 부분수열 매칭 — `hosts.ts` 의 `fuzzyMatch` 와 **같은 규칙**이다 (대소문자 무시 · 질의의
 * 공백 무시 · 빈 질의는 참).
 *
 * 그 함수를 임포트하지 않는 이유는 하나뿐이다: `hosts.ts` 는 Tauri `invoke` 를 들고 있고,
 * 이 파일의 계약은 **룬도 DOM 도 Tauri 도 없다**(머리말)는 것이다. 열 줄짜리 문자열 규칙
 * 하나를 위해 그 계약을 깨면 이 모듈의 테스트가 곧 앱의 배선을 태우기 시작한다.
 * 부르는 쪽은 이미 소문자로 접어 넘긴다 (한 질의에 여러 번 도는 자리라).
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
 * **지금 친 글자에 맞는 스니펫들** — 순서는 접두사 일치가 먼저, 그다음이 부분수열이다.
 *
 * 규칙 넷 (전부 "조용한 편이 낫다" 쪽으로 기울어 있다).
 *
 * 1. **두 글자 미만이면 아무것도 없다** ([`SNIPPET_SUGGEST_MIN_CHARS`]).
 * 2. **범위를 지난다** ([`snippetsForScope`]) — 팔레트와 같은 함수다. 로컬 셸에서 db-01 용
 *    명령이 커서 옆에 뜨면 그것을 고르는 순간 엉뚱한 서버의 명령이 나간다.
 * 3. **명령이 이미 똑같으면 뺀다.** 치다 만 글자가 어떤 스니펫의 명령과 글자 하나까지
 *    같아졌다면 넣어 줄 것이 없다 — 그 줄은 "Tab 을 눌러도 화면이 그대로인 줄" 이다.
 * 4. **이름과 명령을 함께 본다.** 사람이 기억하는 조각이 둘 중 어느 것이어도 걸려야 한다
 *    (`재시작` 으로도, `systemctl` 로도 찾는다). 접두사를 위에 놓는 것은 친 조각이 이름·명령의
 *    머리인 경우가 압도적으로 흔하기 때문이다 (`@` 자동완성과 같은 정렬).
 *
 * `focusedAlias` 는 **그 타일의** SSH 별칭이다 (창 전체의 포커스가 아니다) — 제안은 타일
 * 안에서 벌어지는 일이라 그 타일이 곧 대상이다.
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
    if (s.command.trim() === q) continue; // 넣어 줄 것이 없다 (규칙 3)
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

// ---------------------------------------------------------------------------
// 명령 팔레트가 받는 모양
// ---------------------------------------------------------------------------

/**
 * 팔레트 한 줄 — **팔레트는 스니펫의 구조를 모른다**.
 *
 * 저쪽이 아는 것은 `id` 를 되돌려 주면 된다는 것뿐이고(→ `insertSnippet(id)`), 나머지 셋은
 * 그리는 글자와 찾는 글자다. 이 경계가 있어야 스니펫에 칸이 하나 늘어도 팔레트를 고칠
 * 일이 없다 (레이아웃·테마 프로필이 각자 `SavedLayout`·`ThemeProfile` 을 통째로 넘기는 것과
 * 다른 판단: 저 둘은 팔레트가 이미 타입을 들고 있지만, 스니펫은 **접두사 붙은 한 줄**로
 * 끝나므로 구조를 건네줄 이유가 없다).
 */
export interface SnippetPaletteEntry {
  /** 실행할 때 되돌려 줄 값 — 그대로 `insertSnippet(id)` 에 넣는다 */
  id: string;
  /**
   * 왼쪽에 그릴 **스니펫 이름**. 붙는 말("스니펫: ")은 여기 없다 — 이 모듈은 순수해서
   * 화면 언어를 모르고, 그 한 낱말은 팔레트가 사전에서 꺼내 앞에 붙인다
   * (`commands.palette.snippet.row` · docs/log/2026-09-17-i18n.md).
   */
  name: string;
  /** 오른쪽(또는 아래)의 부연 — 명령 미리보기 (최대 [`SNIPPET_PREVIEW_CHARS`] 글자) */
  detail: string;
  /** 퍼지 검색이 훑을 **한 덩어리 문자열** (`fuzzyMatch` 가 그대로 받는다) */
  keywords: string;
  /**
   * 이 스니펫의 **명령 원문** — 그리는 데 쓰지 않는다 ([`detail`] 이 그 일을 한다).
   *
   * 있는 이유는 하나뿐이다: 팔레트가 "지금 친 글자와 **똑같은** 스니펫이 이미 있는가" 를
   * 물어야 저장 줄을 세울지 정할 수 있고([`shouldOfferSave`]), 잘린 미리보기로는 그 비교를
   * 할 수 없다. 여전히 팔레트는 `Snippet` 구조를 모른다 — 문자열 한 칸이 늘었을 뿐이다.
   */
  command: string;
}

/**
 * 명령 한 줄을 목록에 실을 **미리보기**로 — 줄바꿈·연속 공백을 하나로 접고 길면 자른다.
 *
 * 접는 이유는 여러 줄 명령이 목록 한 줄의 높이를 무너뜨리기 때문이고, 자르는 이유는 긴
 * 명령 하나가 나머지 줄을 화면 밖으로 밀어내기 때문이다. 자른 표시(`…`)까지 합쳐
 * **정확히 상한 글자**다 — 그래야 어느 줄도 남보다 길어 보이지 않는다.
 */
export function snippetPreview(command: string, max = SNIPPET_PREVIEW_CHARS): string {
  const flat = flatten(command);
  if (flat.length <= max) return flat;
  return `${flat.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * 팔레트에서 **스니펫만 보는** 질의 접두사 (`>` 명령 · `@` 탭 · `#` 그룹 옆의 넷째).
 *
 * `;` 인 이유는 단축키와 **같은 글자**이기 때문이다 — `Ctrl+Shift+;` 가 팔레트를 이 접두사가
 * 찍힌 채로 열므로(`app/overlays.svelte.ts` 의 `openSnippetPalette`), 키로 연 화면과 손으로
 * 친 질의가 글자 하나로 이어진다. 남은 기호 중에 이 앱의 다른 접두사·가속키와 겹치지 않는
 * 것이기도 하다.
 *
 * 값이 여기 사는 이유는 **두 곳이 같은 글자를 알아야** 하기 때문이다: 거르는 쪽(팔레트)과
 * 미리 채우는 쪽(액션). 한쪽에 문자열 리터럴로 적으면 다른 쪽이 조용히 어긋난다.
 */
export const SNIPPET_QUERY_PREFIX = ";";

/**
 * **팔레트에 실을 줄들** — 지금 포커스에서 뜻이 있는 스니펫만
 * ([`snippetsForScope`] 를 그대로 지난다).
 *
 * 걸러 내는 일을 팔레트가 아니라 여기서 하는 이유: "어느 별칭이 포커스인가" 는 앱 상태이고,
 * "그래서 어느 줄이 보이는가" 는 **규칙**이다. 규칙이 순수 층에 있어야 테스트가 그것을 볼
 * 수 있다.
 */
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
      // 이름·명령·설명·별칭을 한 덩어리로 — 사람이 기억하는 조각이 넷 중 어느 것이어도
      // 목록이 좁혀져야 한다 ("nginx" 로도, "web-01" 로도 찾는다). 묶음 이름("스니펫")은
      // 화면 언어를 타므로 여기 넣지 않는다 — 팔레트가 훑기 직전에 앞에 얹는다.
      keywords: [s.name, detail, s.description ?? "", s.scope.kind === "host" ? s.scope.alias : ""]
        .filter((p) => p !== "")
        .join(" "),
    };
  });
}
