/**
 * **프롬프트에서 지금 치고 있는 글자** — OSC 133 의 `B`~`C` 사이를 규칙으로 적은 순수 모듈
 * (docs/log/2026-09-16-snippets.md 의 "입력 중 제안").
 *
 * 인라인 스니펫 제안이 물어야 하는 것은 하나다: **"사람이 프롬프트에 무엇을 치고 있는가."**
 * 셸이 알려 주는 경계는 A·B·C·D 뿐이고, 그중 "프롬프트가 끝났다"(= 여기부터 사람이 친
 * 글자다)를 말하는 것이 `B`, "그 글자가 실행됐다"를 말하는 것이 `C` 다. 그래서 입력 모드는
 * **`B` 뒤 `C` 앞**이고, 나머지 둘(`A`·`D`)은 그 구간을 끝내기만 한다.
 *
 * ## 이 파일은 순수다
 *
 * 마커도 버퍼도 xterm 도 여기 없다 — 들어오는 것은 **좌표 두 개와 글자 한 줄**이고 나오는
 * 것은 "읽을 구간" 또는 `null` 이다. 실제로 마커를 쥐고 줄을 읽는 일은
 * `shell-integration.ts`(모드·앵커)와 `Terminal.svelte`(버퍼 읽기·화면)가 나눠 한다.
 * 규칙이 순수 층에 있어야 테스트가 그것을 본다 (`snippetsForScope` 와 같은 분담).
 *
 * ## 왜 여러 줄이면 포기하는가
 *
 * 명령이 줄을 넘기면(따옴표를 열어 둔 채 Enter · `\` 이어쓰기 · 프롬프트가 두 줄) 앵커 줄과
 * 커서 줄이 갈린다. 그 사이의 줄들을 이어 붙이면 "사람이 친 글자" 처럼 보이지만 실제로는
 * 셸의 이어쓰기 프롬프트(`> `)가 섞인 값이고, 그 값으로 제안을 띄우면 **지우는 길이(DEL 개수)
 * 도 틀린다** — 그때 하는 일은 조용히 숨는 것뿐이다.
 */

/** 명령문이 시작하는 자리 — `B` 시점의 줄(절대 버퍼 줄)과 열 */
export interface InputAnchor {
  /** 절대 버퍼 줄 번호 (마커가 스크롤을 따라가므로 읽을 때마다 다시 묻는다) */
  line: number;
  /** 그 줄에서 명령문이 시작하는 열 (`B` 시점의 `cursorX`) */
  col: number;
}

/** 지금 커서 자리 — [`InputAnchor`] 와 같은 좌표계(절대 줄 + 열) */
export interface CursorAt {
  line: number;
  col: number;
}

/**
 * 버퍼에서 **읽을 구간** — `translateToString(true, startCol, endCol)` 에 그대로 넘긴다.
 *
 * 열을 문자열 인덱스가 아니라 **열 그대로** 넘기는 것이 요점이다: 한글·CJK 는 두 칸을
 * 차지하므로 줄 전체를 문자열로 바꾼 뒤 `slice(col, cursorX)` 하면 한 글자씩 어긋난다
 * (xterm 의 `translateToString` 은 열을 받아 스스로 옮긴다).
 */
export interface InputRange {
  line: number;
  startCol: number;
  endCol: number;
}

/**
 * OSC 133 한 조각이 **입력 모드를 어떻게 바꾸는가** — `B` 만 켜고 `A`·`C`·`D` 는 끈다.
 *
 * `A`(프롬프트 시작)가 끄는 이유는 **아직 `B` 가 오지 않았기 때문**이다: 프롬프트 문자열을
 * 그리는 동안의 커서는 명령문의 시작이 아니다. `A` 바로 뒤에 `B` 가 따라오는 것이 보통이라
 * 이 한 줄은 대개 다음 줄에 곧바로 덮이지만, `B` 를 안 보내는 훅(A/C/D 만 내는 것들)에서는
 * 이 규칙 덕에 **제안이 아예 뜨지 않는다** — 그쪽에서는 명령문의 시작을 알 길이 없으므로
 * 그것이 맞는 답이다.
 *
 * 모르는 조각(확장 `E`·`P` …)은 **상태를 건드리지 않는다**: 아는 넷만 뜻이 있고, 나머지에
 * 반응하면 우리가 모르는 확장 하나가 입력 모드를 조용히 꺼 버린다.
 */
export function inputModeAfter(active: boolean, kind: string): boolean {
  if (kind === "B") return true;
  if (kind === "A" || kind === "C" || kind === "D") return false;
  return active;
}

/**
 * 앵커와 커서로 **읽을 구간**을 정한다. 읽을 것이 없으면 `null`.
 *
 * `null` 이 되는 경우는 셋이고 전부 "지금은 제안할 때가 아니다" 라는 뜻이다.
 *
 * - **앵커가 없다** — 입력 모드가 아니다 (셸 통합이 없는 타일도 여기로 온다).
 * - **줄이 다르다** — 여러 줄 입력 (머리말의 이유).
 * - **커서가 앵커보다 앞이다** — 사람이 `Ctrl+A`·`Home` 으로 명령문 앞(프롬프트 쪽)까지
 *   갔거나 화면이 우리가 모르는 상태다. 지어내지 않는다.
 *
 * 커서가 앵커와 **같은 열**이면 빈 구간을 돌려준다 (아직 아무것도 안 쳤다) — 부르는 쪽이
 * 빈 글자를 보고 알아서 접는다(두 글자 미만은 제안하지 않는다).
 */
export function inputRange(
  anchor: InputAnchor | null | undefined,
  cursor: CursorAt,
): InputRange | null {
  if (!anchor) return null;
  if (cursor.line !== anchor.line) return null;
  if (cursor.col < anchor.col) return null;
  return { line: anchor.line, startCol: anchor.col, endCol: cursor.col };
}

/**
 * 지운 뒤 다시 쓸 때 보낼 **백스페이스 개수**.
 *
 * 열이 아니라 **글자 수**다 — 셸의 줄 편집기는 칸이 아니라 문자를 지우므로, 두 칸짜리 한글
 * 한 글자에는 `\x7f` 가 하나만 필요하다. 서러게이트 쌍(이모지)도 한 글자로 센다
 * (`Array.from` — `String.length` 는 둘로 센다).
 */
export function eraseCount(typed: string | null | undefined): number {
  return typeof typed === "string" ? Array.from(typed).length : 0;
}
