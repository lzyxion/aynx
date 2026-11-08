/**
 * **검색 칩의 상태 전이** — 검색 오버레이가 `@이름`·`#명령` 을 글자가 아니라 **칩**으로
 * 보여 주기 위해 필요한 순수 규칙 넷.
 *
 * ## 파서를 건드리지 않는다 — 칩은 표현 계층이다
 *
 * 질의 문법의 진실은 `search-query.ts` 하나뿐이다. 칩은 그 문법을 **다시 해석하지 않고**,
 * 화면에 보이는 두 칸(칩 + 검색어)을 [`composeQuery`] 로 다시 한 줄로 합쳐 그 파서에게
 * 넘긴다. 그래서 오버레이가 세는 매치와 타일이 실제로 칠하는 매치가 갈릴 자리가 없다
 * (`buildMatcher` 가 옵션을 정규식 하나에 녹이는 것과 같은 논지 —
 * docs/log/2026-09-08-terminal-search.md).
 *
 * 뒤집어 말하면 **이 파일은 문법의 부분집합만 안다**: "맨 앞에 완성된 `@이름`·`#명령` 토큰이
 * 있는가" 하나다. 그 밖의 모든 판단(옵션·이스케이프·last-wins)은 합성한 한 줄을 받은 파서
 * 몫이다.
 *
 * ## 임포트가 하나도 없다
 *
 * `search-registry.ts` 와 같은 이유다 — 타입까지 여기서 정의한다. 오버레이(컴포넌트)와
 * `overlays.svelte.ts`(모듈 상태)가 둘 다 이 파일을 보므로, 여기서 무언가를 임포트하는
 * 순간 순환이 생길 자리가 열린다. 커밋 게이트의 `npm run check:cycles` 가 그것을 막는다.
 */

/**
 * 화면에 보이는 세 칸.
 *
 * - `scopeChip` — 칩으로 서 있는 범위 이름 (`null` = 범위 없음 = 전체 검색).
 *   `@` 도 따옴표도 **들어 있지 않다** — 그 장식은 [`composeQuery`] 가 붙인다.
 * - `blockChip` — 칩으로 서 있는 `#` 의 항 (`null` = `#` 없음 = 화면 텍스트 검색).
 *   `@` 와 **다른 축**이라 둘은 동시에 설 수 있다 (`search-query.ts` 의 "직교하는 두 축").
 * - `text` — 입력칸에 실제로 남아 있는 글자. 검색어뿐 아니라 아직 칩이 되지 않은
 *   옵션 토큰(`/re`)도 여기 그대로 산다.
 *
 * 옵션(`/re` `/case` `/word`)도 언젠가 칩이 될 자리가 있다 — 그때는 이 인터페이스에
 * `optionChips: string[]` 한 칸이 늘고 [`composeQuery`] 가 그것도 앞에 붙이면 된다.
 * **지금 미리 만들어 두지는 않는다** (필요를 실제로 보기 전에 자리를 늘리지 않는다는
 * 이 저장소의 규칙 — CLAUDE.md).
 */
export interface ChipState {
  scopeChip: string | null;
  blockChip: string | null;
  text: string;
}

/** 칩 두 종류 — 화면에서는 색만 다르고 몸짓(클릭·Backspace)은 같다 */
export type ChipKind = "scope" | "block";

/**
 * 토큰 이름 하나를 읽는다 — `search-query.ts` 의 `readName` 과 **같은 규칙**이다.
 *
 * 다른 점은 하나: 닫는 따옴표가 없으면 여기서는 실패(`null`)다. 저쪽은 "아직 치는 중" 을
 * 값으로 만들어야 해서 줄 끝까지를 이름으로 보지만, 칩은 **완성된 토큰만** 떼어내므로
 * 반쯤 친 따옴표를 칩으로 세워서는 안 된다.
 */
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
 * 입력칸의 글자가 `@이름 `·`#명령 ` 으로 **시작하면** 그 토큰을 떼어낸다. 아니면 `null`.
 *
 * 사용자가 공백을 치는 순간 칩이 서게 하는 규칙이라 조건이 빡빡하다:
 *
 * - **맨 앞이 `@`·`#` 일 때만** 본다. `foo @bar ` 의 `@bar` 는 파서에게도 범위가 아니라 글자다
 *   (`search-query.ts` — 토큰은 앞에서만 알아본다). 여기서 칩으로 세우면 표현과 실제 매칭이
 *   갈린다.
 * - **이름 뒤에 공백이 실제로 있어야** 한다. 없으면 아직 치는 중이고, 그 상태는 `@` 자동완성
 *   드롭다운이 쓴다.
 * - **빈 이름(`@ `·`# `)은 칩이 아니다.** `@` 쪽은 자동완성이 보는 상태이고, `#` 쪽은 "블록
 *   전부" 라는 **유효한 질의**라 글자로 남겨 둔다 — 빈 라벨의 칩을 세우면 화면에 `#` 만 떠
 *   있는, 지울 수는 있지만 고칠 수는 없는 조각이 된다.
 *
 * `rest` 에서 앞 공백을 **전부** 걷는 것이 중요하다. 파서도 토큰 뒤의 공백을 구분자로 먹으므로
 * (`@a   foo` 의 검색어는 `foo`), 그렇게 해야 [`composeQuery`] 로 다시 합친 한 줄이 원래 글자와
 * **같은 파스**를 낸다.
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
 * 칩들 + 검색어 → **기존 파서가 그대로 먹는 한 줄**. 이 앱에서 질의의 진실은 이 문자열 하나다.
 *
 * 칩이 하나도 없으면 글자를 손대지 않는다 — 맨 앞 공백 이스케이프(` @foo` = 문자 그대로)가
 * 살아 있어야 하므로 trim 도 하지 않는다.
 *
 * 이름에 공백이 있으면 `@"…" ` 로 감싼다. 이 규칙이 예전에는 `SearchOverlay.scopeToken` 과
 * `keys.svelte.ts` 두 곳에 똑같이 적혀 있었다 — 문법을 아는 자리가 늘어날수록 파서와 갈릴
 * 확률만 늘어서 여기 하나로 모았다.
 *
 * 순서는 **언제나 `@` 다음 `#`** 다. 파서는 순서를 가리지 않지만(직교하는 두 축), 화면과
 * 합성 문자열이 늘 같은 순서라야 사용자가 읽은 것과 붙여넣은 것이 같아진다.
 */
export function composeQuery(state: ChipState): string {
  const head =
    (state.scopeChip === null ? "" : token("@", state.scopeChip)) +
    (state.blockChip === null ? "" : token("#", state.blockChip));
  return head + state.text;
}

/** 칩 하나를 문법 조각으로 (공백이 든 이름은 따옴표로) */
function token(sigil: string, name: string): string {
  return /\s/.test(name) ? `${sigil}"${name}" ` : `${sigil}${name} `;
}

/**
 * 캐럿이 입력칸 **맨 앞**일 때의 Backspace — 칩 **하나만** 떨어뜨리고 글자는 그대로 둔다
 * (치던 검색어까지 날리면 다시 쳐야 한다).
 *
 * 둘 다 서 있으면 **캐럿에 가까운 것**(= `#`)부터 지운다. 화면에서 `[@web1][#build]|` 로 서
 * 있으므로 "바로 앞의 것" 이 `#` 이고, 그게 브라우저 검색창·메일 수신인 칸의 몸짓이다.
 *
 * "캐럿이 맨 앞인가" 는 **컴포넌트가** 판정한다 — 그건 DOM 을 아는 쪽만 아는 사실이고, 이
 * 함수는 상태 전이만 안다. 칩이 없으면 아무 일도 아니다(호출부가 그때는 브라우저의 기본
 * 지우기를 그대로 두면 된다).
 */
export function backspaceAtStart(state: ChipState): ChipState {
  if (state.blockChip !== null) return { ...state, blockChip: null };
  if (state.scopeChip !== null) return { ...state, scopeChip: null };
  return state;
}

/** 칩 하나를 뗀다 (× 버튼 · 칩 위의 Backspace) — 어느 것인지 부르는 쪽이 안다 */
export function dropChip(state: ChipState, kind: ChipKind): ChipState {
  return kind === "scope" ? { ...state, scopeChip: null } : { ...state, blockChip: null };
}

/**
 * 자동완성에서 라벨 하나를 골랐다 — 칩을 세우고, **치던 `@조각`은 글자에서 걷는다**.
 *
 * "치던 조각" 은 글자의 앞쪽에서 시작해 **끝까지 이어지는** 미완성 `@…` 다. 완성 여부의
 * 판정은 [`tokenizeOnSpace`] 를 그대로 되쓴다(`null` = 아직 미완성) — 같은 규칙을 두 번 적지
 * 않으려는 것이다.
 *
 * 앞에 이미 친 옵션 토큰(`/re`)은 **남긴다**. 뒤의 공백까지 그대로 두는 것도 일부러다 —
 * 사용자가 곧바로 검색어를 이어 치면 `/re err` 이 되어야 한다.
 *
 * 걷을 조각이 없으면 글자는 그대로다. 칩을 눌러 드롭다운을 연 경우(치던 것이 없다)가 그
 * 길이고, 그때 이 함수는 **칩만 갈아 끼운다**.
 */
export function applyAutocomplete(state: ChipState, label: string): ChipState {
  const cut = fragmentStart(state.text);
  return {
    ...state,
    scopeChip: label,
    text: cut === null ? state.text : state.text.slice(0, cut),
  };
}

/**
 * 치던 `@조각` 이 시작하는 자리 (없으면 `null`).
 *
 * 앞 공백으로 시작하는 글자는 통째로 문자 그대로라(이스케이프 1) 조각이 없고, 조각 앞에는
 * **파서가 토큰으로 읽는 것들만**(`/…` 옵션 · `#…` 블록) 올 수 있다. 그 밖의 글자가 앞에
 * 있으면 그건 이미 검색어라 파서도 뒤의 `@` 를 범위로 보지 않는다.
 */
function fragmentStart(text: string): number | null {
  if (/^\s/.test(text)) return null;
  const at = text.lastIndexOf("@");
  if (at === -1) return null;
  if (tokenizeOnSpace(text.slice(at)) !== null) return null; // 완성된 토큰 — 치는 중이 아니다
  return /^(?:\s*[/#]\S*)*\s*$/.test(text.slice(0, at)) ? at : null;
}
