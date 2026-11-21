/**
 * 터미널 검색(텍스트 찾기)의 질의 문법 — 명령 팔레트와 문법을 나눠 쓰지 않는다.
 *
 * 문법: 맨 앞 토큰들만 해석하고, 토큰이 아닌 것이 나오는 순간 나머지 전부가 검색어다.
 * - `@이름` 은 어디서(타일), `#명령` 은 무엇을(화면 텍스트 → 명령 블록) — 직교하는 두 축이라 순서를 가리지 않는다. 둘 다 빈 이름도 유효하다.
 * - 옵션은 `/re` · `/case` · `/word` 셋뿐이고 `#` 의 항에도 똑같이 걸린다.
 * - 같은 축이 둘이면 나중 것이 이긴다 — 범위를 고쳐 치는 몸짓(뒤에 덧붙이기 · 자동완성)이 흔하다.
 * - 이스케이프는 한 번에 하나: 앞 공백(나머지 전부가 문자 그대로) · 바깥 따옴표 한 겹.
 *
 * `/` 를 범위 기호로 쓰지 않는다 — 찾는 글자의 상당수가 경로(`/usr/bin`)라 모르는 `/…` 는 검색어다.
 */

export interface SearchOptions {
  regex: boolean;
  caseSensitive: boolean;
  wholeWord: boolean;
}

/** `null` 은 열려 있는 터미널 전부. 갈래가 하나뿐이어도 `kind` 는 부르는 쪽의 판별(`scope?.kind === "terminal"`)을 위해 둔다 */
export type SearchScope = { kind: "terminal"; name: string };

export interface SearchQuery {
  scope: SearchScope | null;
  /** `null` = `#` 없음(화면 텍스트) · `""` = 그 범위의 블록 전부 — 한 값으로 접으면 `#` 를 치는 도중에 텍스트 검색으로 되돌아간다 */
  block: string | null;
  options: SearchOptions;
  /** `#` 와 함께 오면 고른 블록들의 출력 발췌를 거른다 */
  text: string;
}

const NO_OPTIONS: SearchOptions = { regex: false, caseSensitive: false, wholeWord: false };

const OPTION_KEYS: Record<string, keyof SearchOptions> = {
  re: "regex",
  case: "caseSensitive",
  word: "wholeWord",
};

/** 닫는 따옴표가 없으면 줄 끝까지 — 치는 중인 조각(`@"my te`)으로 자동완성이 후보를 좁힌다 */
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

function unquote(s: string): string {
  return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** 절대 던지지 않는다 — 오버레이가 매 키 입력마다 부른다 */
export function parseSearchQuery(raw: string): SearchQuery {
  // 이스케이프 1: 앞 공백 — 두 이스케이프를 겹치면 "문자 그대로" 가 거짓이 되므로 여기서 끝낸다.
  if (/^\s/.test(raw)) {
    return { scope: null, block: null, options: { ...NO_OPTIONS }, text: raw.replace(/^\s+/, "") };
  }

  const options: SearchOptions = { ...NO_OPTIONS };
  let scope: SearchScope | null = null;
  let block: string | null = null;
  let i = 0;

  for (;;) {
    let j = i;
    while (j < raw.length && /\s/.test(raw[j])) j++;
    const c = raw[j];

    if (c === "@" || c === "#") {
      const { name, next } = readName(raw, j + 1);
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

    i = j;
    break;
  }

  // 이스케이프 2: 남은 것이 통째로 따옴표에 싸여 있으면 벗긴다 (`@web1 "/re"`)
  return { scope, block, options, text: unquote(raw.slice(i)) };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * `null` 은 오류가 아니라 "아직 찾을 것이 없다" — 반쯤 친 정규식이 매 키 입력마다 던지지 않게 삼킨다.
 * `wholeWord` 는 non-capturing group 으로 묶는다 — `…` 를 그냥 이으면 `foo|bar` 의 뜻이 바뀌고, 캡처 그룹이면 뒤참조 번호가 밀린다.
 */
export function buildMatcher(q: SearchQuery): RegExp | null {
  return matcherFor(q.text, q.options);
}

/** `null` 은 `#` 없음 · 빈 `#` · 깨진 정규식 셋 다다 — 부르는 쪽은 `SearchQuery.block` 값을 함께 본다 */
export function buildBlockMatcher(q: SearchQuery): RegExp | null {
  return q.block === null ? null : matcherFor(q.block, q.options);
}

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
 * 길이 0 매치는 한 칸 밀어 무한루프를 막고, `g` 없는 정규식은 첫 매치 하나만 준다.
 * 드나들 때 `lastIndex` 를 0 으로 — 같은 `RegExp` 를 수천 줄에 재사용하므로 상태가 새면 둘째 줄부터 매치가 사라진다.
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
