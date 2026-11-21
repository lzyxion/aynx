/**
 * 검색 칩의 상태 전이. 칩은 표현 계층이다 — 문법을 다시 해석하지 않고 [`composeQuery`] 로 한 줄을 합쳐
 * `search-query.ts` 파서에게 넘긴다. 그래서 오버레이가 세는 매치와 타일이 칠하는 매치가 갈리지 않는다.
 */

/**
 * - `scopeChip` · `blockChip` 에는 `@` · `#` · 따옴표가 들어 있지 않다 — 장식은 [`composeQuery`] 가 붙인다.
 * - `text` 에는 아직 칩이 되지 않은 옵션 토큰(`/re`)도 산다.
 */
export interface ChipState {
  scopeChip: string | null;
  blockChip: string | null;
  text: string;
}

export type ChipKind = "scope" | "block";

/** `search-query.ts` 의 `readName` 과 같은 규칙 — 다만 닫는 따옴표가 없으면 실패다(반쯤 친 따옴표를 칩으로 세우지 않는다) */
function readName(s: string, i: number): { name: string; next: number } | null {
  if (s[i] === '"') {
    const close = s.indexOf('"', i + 1);
    if (close === -1) return null; // 아직 닫히지 않았다 — 치는 중이다
    return { name: s.slice(i + 1, close), next: close + 1 };
  }
  let j = i;
  while (j < s.length && !/\s/.test(s[j])) j++;
  return { name: s.slice(i, j), next: j };
}

/**
 * 맨 앞만 본다 — 파서도 토큰은 앞에서만 알아본다. 빈 `#` 은 "블록 전부" 라는 유효한 질의라 글자로 남긴다.
 * `rest` 의 앞 공백을 전부 걷어야 다시 합친 한 줄이 원래 글자와 같은 파스를 낸다.
 */
export function tokenizeOnSpace(text: string): { kind: ChipKind; chip: string; rest: string } | null {
  const sigil = text[0];
  if (sigil !== "@" && sigil !== "#") return null;
  const read = readName(text, 1);
  if (!read) return null;
  if (read.name === "") return null;
  // 이름 뒤에 공백이 없으면 아직 치는 중이다 (줄 끝도 마찬가지다)
  if (!/\s/.test(text[read.next] ?? "")) return null;
  return {
    kind: sigil === "@" ? "scope" : "block",
    chip: read.name,
    rest: text.slice(read.next).replace(/^\s+/, ""),
  };
}

/**
 * 질의의 진실은 이 문자열 하나다. 칩이 없으면 trim 도 하지 않는다 — 맨 앞 공백 이스케이프(` @foo`)가 살아야 한다.
 * 순서는 언제나 `@` 다음 `#` — 사용자가 읽은 것과 붙여넣은 것이 같아지게.
 */
export function composeQuery(state: ChipState): string {
  const head =
    (state.scopeChip === null ? "" : token("@", state.scopeChip)) +
    (state.blockChip === null ? "" : token("#", state.blockChip));
  return head + state.text;
}

function token(sigil: string, name: string): string {
  return /\s/.test(name) ? `${sigil}"${name}" ` : `${sigil}${name} `;
}

/** 캐럿에 가까운 `#` 부터 하나만 지우고 글자는 둔다. "캐럿이 맨 앞인가" 는 컴포넌트가 판정한다 */
export function backspaceAtStart(state: ChipState): ChipState {
  if (state.blockChip !== null) return { ...state, blockChip: null };
  if (state.scopeChip !== null) return { ...state, scopeChip: null };
  return state;
}

export function dropChip(state: ChipState, kind: ChipKind): ChipState {
  return kind === "scope" ? { ...state, scopeChip: null } : { ...state, blockChip: null };
}

/** 치던 `@조각` 만 글자에서 걷는다 — 앞의 옵션 토큰과 뒤 공백은 남겨 곧바로 검색어를 이어 칠 수 있게 */
export function applyAutocomplete(state: ChipState, label: string): ChipState {
  const cut = fragmentStart(state.text);
  return {
    ...state,
    scopeChip: label,
    text: cut === null ? state.text : state.text.slice(0, cut),
  };
}

/** 조각 앞에는 파서가 토큰으로 읽는 것(`/…` · `#…`)만 올 수 있다 — 그 밖의 글자가 앞이면 파서도 `@` 를 범위로 보지 않는다 */
function fragmentStart(text: string): number | null {
  if (/^\s/.test(text)) return null;
  const at = text.lastIndexOf("@");
  if (at === -1) return null;
  if (tokenizeOnSpace(text.slice(at)) !== null) return null; // 완성된 토큰 — 치는 중이 아니다
  return /^(?:\s*[/#]\S*)*\s*$/.test(text.slice(0, at)) ? at : null;
}
