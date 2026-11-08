/**
 * **터미널 검색의 질의 문법** — 한 줄짜리 입력을 범위·옵션·검색어로 가르는 순수 파서.
 *
 * 여기서 말하는 검색은 **텍스트 찾기**다 — 지금 화면과 스크롤백에서 글자를 찾는 일.
 * 앱 기능을 찾는 명령 팔레트와는 다른 물건이고, 서로 문법을 나눠 쓰지 않는다.
 *
 * ## 왜 순수(pure)인가
 *
 * 이 파일에는 Svelte 임포트가 없고 xterm 도 모른다 — 문자열을 받아 값 하나를 내놓을 뿐이다.
 * 그래야 오버레이(입력 칸·`@` 자동완성 드롭다운)와 실제 매칭이 **같은 규칙**을 공유하면서도
 * 서로를 끌어들이지 않는다 (`keybindings.ts` 와 같은 이유).
 *
 * ## 문법 (앞 토큰만 특별하다)
 *
 * 질의의 **맨 앞 토큰들**만 해석하고, 토큰이 아닌 것이 나오는 순간 **나머지 전부**가 검색어다.
 *
 *   `@web1 error`        — `web1` 타일에서만 `error` 를 찾는다
 *   `@"my term" /case E`  — 이름에 공백이 있으면 따옴표로 감싼다
 *   `/re /word ^a.*z$`   — 옵션 셋만 앞에 오고 나머지가 검색어
 *   `#build`             — 명령 블록 검색 (모든 타일의 `build` 명령)
 *   `@web1 #build`       — **둘은 다른 축이다** — web1 타일의 build 블록
 *
 * - `@이름` — 범위: 그 터미널만. 이름은 공백 전까지. **이름이 비어 있어도 유효하다**(`@` 하나) —
 *   오버레이의 `@` 자동완성 드롭다운이 바로 그 상태를 보고 뜬다. 이름에 `/2` 같은 충돌 구분
 *   번호가 붙어 올 수 있는데(`search-registry.ts` 의 [`disambiguateNames`]) 파서는 그냥
 *   문자열로 둔다 — 이름을 실제 타일에 맞추는 일은 레지스트리 쪽 몫이다.
 * - `#명령` — **찾는 대상을 바꾼다**: 화면 텍스트가 아니라 **명령 블록**(`block-history.ts`)을
 *   훑어 `commandLine`(과 부차적으로 `cwd`)에서 찾는다. 비어 있어도 유효하다(`#` 하나 =
 *   그 범위의 블록 전부).
 * - `/re` · `/case` · `/word` — 옵션(정규식 · 대소문자 구분 · 단어 단위). **이 셋뿐이다.**
 *   옵션은 `#` 의 항에도 **똑같이** 걸린다 (같은 [`buildMatcher`] 규칙을 탄다).
 *
 * ### `/` 를 범위 기호로 쓰지 않는 이유 (알려지지 않은 `/…` 는 검색어다)
 *
 * 이 앱에서 찾는 글자의 상당수가 **경로**다 — `/usr/bin`, `/etc/nginx`, `/var/log/...`.
 * `/` 로 시작하는 토큰을 전부 문법으로 삼으면 그 경로들이 죄다 "모르는 옵션" 이 되어 조용히
 * 사라지거나 오류가 된다. 그래서 규칙을 뒤집었다: **아는 셋(`re`·`case`·`word`)만 옵션**이고
 * 그 밖의 `/…` 는 옵션이 아니라 **검색어의 시작**이다. `/usr/bin` 은 아무 장식 없이 그대로
 * 친다. 범위 기호를 `@`·`#` 로 고른 것도 같은 이유다 — 경로에 안 나오는 글자여야 한다.
 *
 * ## 이스케이프 (검색어가 `@`·`#`·`/` 로 시작해야 할 때)
 *
 * 두 가지가 있고 **한 번에 하나만** 쓴다:
 *
 * 1. **앞 공백** — 질의가 공백으로 시작하면 그 공백들을 버리고 **나머지 전부**를 문자 그대로
 *    본다. 토큰도 따옴표도 해석하지 않는다. 입력 칸에서 스페이스 한 번이면 되니 제일 싸다.
 * 2. **따옴표** — 질의(또는 토큰들을 먹고 남은 나머지)가 `"…"` 로 감싸여 있으면 바깥
 *    따옴표만 벗기고 안쪽을 문자 그대로 쓴다. `@web1 "/re"` 처럼 범위와 같이 쓸 수 있다.
 *
 * ## `@` 와 `#` 는 **직교하는 두 축**이다 (서로를 덮지 않는다)
 *
 * `@` 는 **어디서** 찾는가(타일), `#` 는 **무엇을** 찾는가(화면 텍스트 → 명령 블록)를 정한다.
 * 둘이 한 자리를 다투던 옛 규칙(last-wins)에서는 `@web1 #build` 가 "web1" 을 조용히 버렸는데,
 * 그건 사용자가 적은 말의 절반을 소리 없이 무시하는 것이었다. 지금은 각자의 칸이 있고
 * **순서도 가리지 않는다** — `@web1 #build` 와 `#build @web1` 은 같은 질의다.
 *
 * 같은 축이 둘 이상이면 여전히 **나중 것이 이긴다**(`@a @b` = `@b`, `#a #b` = `#b`).
 * 사용자가 범위를 **고쳐 치는** 몸짓이 압도적으로 흔하기 때문이다 — 이미 친 `@a` 를 지우지
 * 않고 뒤에 `@b` 를 덧붙이거나, 자동완성이 이름을 뒤에 붙인다. 앞 것이 이기면 그 몸짓이
 * "아무 일도 안 일어남" 으로 보이고, 오류를 띄우면 아직 다 치지도 않은 질의에 대고 잔소리를
 * 하게 된다.
 */

/** 검색 옵션 셋 — 이 셋이 전부다 (`/re` · `/case` · `/word`) */
export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

/**
 * 검색 범위(`@`). `null`(= 범위 없음)은 "열려 있는 터미널 전부" 다.
 *
 * 한때 `{ kind: "block" }` 갈래가 여기 있었다 — `#` 를 같은 축으로 보던 시절이다. 지금 `#` 는
 * [`SearchQuery.block`] 이라는 **다른 칸**에 살아 이 합집합은 갈래가 하나뿐이다. `kind` 를
 * 남겨 둔 것은 부르는 쪽의 판별(`scope?.kind === "terminal"`)을 그대로 두기 위해서다.
 */
export type SearchScope = { kind: "terminal"; name: string };

export interface SearchQuery {
  scope: SearchScope | null;
  /**
   * `#` 의 항 — **찾을 명령 블록**. `null` 이면 `#` 가 없다(= 화면 텍스트를 찾는다).
   *
   * `""`(= `#` 하나만 쳤다)도 `null` 과 **다른 값**이다: "그 범위의 블록 전부" 라는 뜻이라
   * 목록이 뜬다. 두 상태를 한 값으로 접으면 `#` 를 치는 도중에 화면이 텍스트 검색으로
   * 되돌아간다.
   */
  block: string | null;
  options: SearchOptions;
  /**
   * 찾을 글자. 비어 있으면 [`buildMatcher`] 가 `null` 을 준다 (아무것도 강조하지 않는다).
   *
   * `#` 와 함께 오면 뜻이 한 겹 바뀐다 — 블록을 **고르는** 것은 `#` 의 항이고, 이 글자는
   * 고른 블록들의 **출력 발췌**를 거르는 데 쓰인다 (`#build 실패`).
   */
  text: string;
}

const NO_OPTIONS: SearchOptions = { regex: false, caseSensitive: false, wholeWord: false };

/** 아는 옵션 셋 — 여기 없는 `/…` 는 옵션이 아니라 검색어다 (머리말의 `/usr/bin` 참고) */
const OPTION_KEYS: Record<string, keyof SearchOptions> = {
  re: "regex",
  case: "caseSensitive",
  word: "wholeWord",
};

/**
 * 범위 이름 하나를 읽는다 — `@`·`#` 바로 뒤에서 시작한다.
 *
 * 따옴표로 열렸으면 닫는 따옴표까지(공백 포함), 아니면 첫 공백 전까지다. 닫는 따옴표가
 * 없으면 **줄 끝까지**를 이름으로 본다 — 사용자가 아직 치는 중인 상태(`@"my te`)에서
 * 자동완성이 그 조각으로 후보를 좁힐 수 있어야 하기 때문이다.
 */
function readName(s: string, i: number): { name: string; next: number } {
  if (s[i] === '"') {
    const close = s.indexOf('"', i + 1);
    if (close === -1) return { name: s.slice(i + 1), next: s.length };
    return { name: s.slice(i + 1, close), next: close + 1 };
  }
  let j = i;
  while (j < s.length && !/\s/.test(s[j])) j++;
  return { name: s.slice(i, j), next: j };
}

/** 바깥 따옴표 한 겹만 벗긴다 (`"…"` — 안쪽은 손대지 않는다) */
function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/**
 * 질의 한 줄을 범위·옵션·검색어로 가른다. **절대 던지지 않는다** — 반쯤 친 질의도 값이 된다
 * (오버레이가 매 키 입력마다 부른다).
 */
export function parseSearchQuery(raw: string): SearchQuery {
  // 이스케이프 1: 앞 공백 — 나머지 전부가 문자 그대로다 (따옴표도 글자로 남는다).
  // 두 이스케이프를 겹쳐 적용하면 "문자 그대로" 라는 말이 거짓이 되므로 여기서 바로 끝낸다.
  if (/^\s/.test(raw)) {
    return { scope: null, block: null, options: { ...NO_OPTIONS }, text: raw.replace(/^\s+/, "") };
  }

  const options: SearchOptions = { ...NO_OPTIONS };
  let scope: SearchScope | null = null;
  let block: string | null = null;
  let i = 0;

  for (;;) {
    // 토큰 사이 공백을 먹는다. 토큰이 없으면 아무것도 안 먹은 것과 같다 (i 를 되돌린다).
    let j = i;
    while (j < raw.length && /\s/.test(raw[j])) j++;
    const c = raw[j];

    if (c === "@" || c === "#") {
      const { name, next } = readName(raw, j + 1);
      // **각자의 칸**이다 — last-wins 는 같은 축 안에서만 돈다 (`@a @b` = `@b`).
      if (c === "@") scope = { kind: "terminal", name };
      else block = name;
      i = next;
      continue;
    }

    if (c === "/") {
      let k = j + 1;
      while (k < raw.length && !/\s/.test(raw[k])) k++;
      const key = OPTION_KEYS[raw.slice(j + 1, k)];
      if (key === undefined) {
        i = j; // 모르는 `/…` — 여기부터 검색어다 (`/usr/bin`). 앞의 구분자 공백은 버린다
        break;
      }
      options[key] = true;
      i = k;
      continue;
    }

    // 토큰이 아니다 — 공백을 먹은 자리까지만 버리고(구분자였다) 나머지가 검색어다.
    i = j;
    break;
  }

  // 이스케이프 2: 남은 것이 통째로 따옴표에 싸여 있으면 벗긴다 (`@web1 "/re"`)
  return { scope, block, options, text: unquote(raw.slice(i)) };
}

/** 정규식 메타문자를 문자 그대로 만든다 (`/re` 가 아닐 때의 검색어) */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * 질의를 실제 매칭용 `RegExp` 로. 검색어가 비었거나 `/re` 정규식이 잘못되면 `null`.
 *
 * `null` 은 오류가 아니라 **"아직 찾을 것이 없다"** 는 뜻이다 — 호출부는 강조를 지우기만
 * 한다. 반쯤 친 정규식(`(foo`)이 매 키 입력마다 예외를 던지게 두지 않으려고 여기서 삼킨다.
 *
 * `wholeWord` 는 `/re` 모드에서도 감싼다. 그냥 `\b…\b` 로 이으면 `foo|bar` 가
 * `\bfoo|bar\b` 로 갈라져 뜻이 바뀌므로 **non-capturing group** 으로 묶는다 — 캡처
 * 그룹으로 묶으면 사용자가 정규식에 쓴 `\1` 같은 뒤참조의 번호가 밀린다.
 *
 * 플래그는 언제나 `g` 다 ([`matchesInLine`] 이 한 줄에서 여러 번 찾는다).
 */
export function buildMatcher(q: SearchQuery): RegExp | null {
  return matcherFor(q.text, q.options);
}

/**
 * `#` 의 항을 매칭용 `RegExp` 로 — [`buildMatcher`] 와 **같은 규칙**(옵션 셋이 그대로 걸린다).
 *
 * `null` 이 두 가지를 뜻한다: `#` 가 없거나(`block === null`), `#` 하나만 쳤거나
 * (`block === ""` — "블록 전부"), 또는 `/re` 정규식이 깨졌거나. 부르는 쪽은 셋을 가릴 수
 * 있어야 하므로 [`SearchQuery.block`] 값 자체를 함께 본다 (오버레이의 `blockRegexBroken`).
 */
export function buildBlockMatcher(q: SearchQuery): RegExp | null {
  return q.block === null ? null : matcherFor(q.block, q.options);
}

/** 두 빌더의 공통 알맹이 — 옵션이 한 곳에서만 정규식으로 녹는다 */
function matcherFor(text: string, options: SearchOptions): RegExp | null {
  if (text === "") return null;
  const src = options.regex ? text : escapeRegExp(text);
  const body = options.wholeWord ? `\\b(?:${src})\\b` : src;
  try {
    return new RegExp(body, options.caseSensitive ? "g" : "gi");
  } catch {
    return null; // 반쯤 친 정규식 — 조용히 "찾을 것 없음" 으로 떨어뜨린다
  }
}

/**
 * 한 줄에서 매치 위치들 (`col` = 0-기반 문자 인덱스, `len` = 매치 길이).
 *
 * 두 가지를 방어한다:
 *
 * - **빈 매치 무한루프.** `x*` 나 `^` 처럼 길이 0 으로 맞는 정규식은 `exec` 뒤에도
 *   `lastIndex` 가 제자리라 그대로 두면 영원히 돈다 — 안 나갔으면 한 칸 밀어 준다.
 * - **`g` 없는 정규식.** 남이 만든 `RegExp` 가 들어오면 `lastIndex` 자체가 움직이지 않아
 *   같은 자리를 무한히 다시 문다. 그런 정규식은 **첫 매치 하나**만 돌려준다.
 *
 * 들어올 때와 나갈 때 `lastIndex` 를 0 으로 되돌린다 — 같은 `RegExp` 를 수천 줄에 재사용
 * 하는 것이 이 함수의 정상 사용법이라(줄마다 새로 만들면 스크롤백 훑기가 느려진다) 상태가
 * 새면 두 번째 줄부터 매치가 통째로 사라진다.
 */
export function matchesInLine(line: string, re: RegExp): { col: number; len: number }[] {
  const out: { col: number; len: number }[] = [];
  re.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    out.push({ col: m.index, len: m[0].length });
    if (!re.global) break;
    if (re.lastIndex <= m.index) re.lastIndex = m.index + 1;
  }
  re.lastIndex = 0;
  return out;
}
