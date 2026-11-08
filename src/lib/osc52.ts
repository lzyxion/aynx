/**
 * **OSC 52 — 원격이 이 PC 의 클립보드에 쓴다** · 순수 파서
 * (docs/log/2026-09-23-osc52-osc8.md).
 *
 * 원격의 vim 이 `"+y` 하거나 tmux 가 복사 모드에서 집은 글자는, 그 서버 안에서는 어디에도
 * 갈 곳이 없다. OSC 52 는 그것을 **터미널에게 건네는** 시퀀스이고, 받는 쪽(우리)이 OS
 * 클립보드에 적어야 비로소 로컬 편집기에 붙는다. SSH 도구에서 가장 크게 비는 자리였다.
 *
 * ```
 * OSC 52 ; Pc ; Pd  ST
 *          │    └── base64(UTF-8 바이트)  또는  `?` = **읽기 요청**
 *          └── 선택 목록 — `c`(클립보드) `p`(primary) `q` `s` `0`–`7`(컷 버퍼).
 *              비어 있으면 규약상 `s0` 이다.
 * ```
 *
 * ## 이 모듈이 하지 않는 것
 *
 * 클립보드를 만지지 않는다 — 문자열을 받아 값을 준다. 실제로 쓰는 쪽은
 * `term/osc-handlers.ts` 의 `attachOsc52` 이고, 거기서 설정(`[terminal] osc52_clipboard`)·
 * 토스트·속도 제한을 정한다. 그래서 이 파일은 vitest 로 그대로 돈다 (`osc52.test.ts`).
 *
 * ## 읽기 요청(`?`)에는 **절대 답하지 않는다**
 *
 * `OSC 52 ; c ; ? ST` 는 "지금 클립보드에 뭐가 들었는지 돌려 달라" 는 뜻이다. 답하면
 * 원격에서 도는 아무 프로그램이나 이 PC 의 클립보드를 읽어 간다 — 방금 복사해 둔 비밀번호·
 * 토큰이 그대로 서버로 새는 **유출 통로**다. 그래서 파서는 그것을 `{ query: true }` 로
 * **알아보기만** 하고, 핸들러는 아무 응답도 보내지 않고 조용히 버린다 (알아보는 이유는
 * 하나다 — 쓰기와 갈라서 "잘못된 base64" 로 헷갈리지 않게).
 *
 * ## 크기 상한
 *
 * 풀어 낸 바이트가 [`OSC52_MAX_BYTES`] 를 넘으면 `null` 이다 — **반만 붙여넣지 않는다.**
 * 잘라서 넘기면 사용자는 "복사됐다" 는 토스트를 보고 잘린 글자를 붙인다(그게 명령문이면
 * 나쁘게 끝난다). 상한 자체는 폭주한 출력이 통째로 클립보드에 들어오는 것을 막는다.
 */

/**
 * 한 번에 받아 주는 **풀어 낸** 최대 바이트 (1 MiB).
 *
 * 넘으면 [`parseOsc52`] 가 `null` 을 준다 — 자르지 않는다 (위 머리말).
 */
export const OSC52_MAX_BYTES = 1024 * 1024;

/** 선택 목록에 들어올 수 있는 글자 — 규약의 것 전부 (`c p q s 0-7`) */
const SELECTIONS = /^[cpqs0-7]*$/;

/** base64 알파벳 + 끝의 패딩. 공백은 부르는 쪽에서 이미 떼고 온다 */
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * [`parseOsc52`] 의 답.
 *
 * - `{ selection, text }` — 클립보드에 **쓰라**는 뜻. `selection` 은 원문의 `Pc` 그대로
 *   (빈 문자열은 규약의 기본값 `s0` 으로 채워져 온다).
 * - `{ query: true }` — **읽기 요청**. 답하지 않는다 (머리말).
 */
export type Osc52 = { selection: string; text: string } | { query: true };

/**
 * `OSC 52` 의 본문(`52;` 를 뗀 나머지)을 푼다. 우리가 다룰 수 없는 모양이면 `null`.
 *
 * `null` 은 "무시한다" 는 뜻이지 "우리 것이 아니다" 는 뜻이 아니다 — OSC 52 는 이 뜻
 * 하나뿐이라 핸들러는 어느 답에도 `true`(삼켰다)를 돌려준다.
 */
export function parseOsc52(data: string): Osc52 | null {
  const sep = data.indexOf(";");
  if (sep < 0) return null; // `Pc ; Pd` 의 세미콜론이 없으면 우리가 읽을 수 있는 모양이 아니다
  const pc = data.slice(0, sep);
  const pd = data.slice(sep + 1);
  if (!SELECTIONS.test(pc)) return null;
  // 읽기 요청은 **여기서 끝난다** — 값을 만들지 않고 종류만 알려 준다.
  if (pd === "?") return { query: true };
  const text = decodeBase64Utf8(pd);
  if (text === null) return null;
  // 빈 `Pc` 는 규약상 `s0` 이다. 우리에게 클립보드는 하나뿐이라 동작은 같지만, 기록에
  // 남는 값이 원문 그대로 비어 있으면 "선택을 안 적었다" 와 구별이 안 된다.
  return { selection: pc === "" ? "s0" : pc, text };
}

/**
 * 원격 복사(OSC 52) 쓰기 뒤 타일이 띄울 토스트 — 없으면 `null` (속도 제한은 부르는 쪽).
 *
 * **AI 타일에서는 성공을 말하지 않는다** — Claude Code · Codex 는 드래그 선택을 스스로 OSC 52 로 복사하고
 * "copied" 를 제 화면에 띄우므로, 앱의 한 줄은 같은 일을 두 번 말해 겹친다
 * (docs/log/2026-10-05-ai-tile-copy-note.md). 실패는 원래부터 말하지 않는다(쓰기 실패는 앱 밖에서 볼 길이
 * 없어 예전 그대로 둔다 — 같은 기록).
 */
export function osc52Note(ok: boolean, aiTile: boolean): "copied" | null {
  if (!ok || aiTile) return null;
  return "copied";
}

/**
 * base64 → UTF-8 문자열. 알파벳 밖의 글자·풀리지 않는 길이·상한 초과는 전부 `null`.
 *
 * **공백은 떼고 본다** — 아주 긴 payload 를 줄 바꿔 보내는 구현이 있고, 그것 때문에
 * 멀쩡한 복사가 통째로 버려지는 것은 아깝다. 디코딩 자체는 `fatal` 없이 한다: 잘못된
 * UTF-8 바이트는 대체 문자로 떨어지고 나머지 글자는 산다(latin-1 로 집어 보내는 오래된
 * 도구가 있다 — 그 한 글자 때문에 복사 전체를 버릴 이유는 없다).
 */
function decodeBase64Utf8(raw: string): string | null {
  const b64 = raw.replace(/\s+/g, "");
  if (!BASE64.test(b64)) return null;
  // atob 앞의 **싼 상한** — 폭주한 payload 를 문자열로 한 번 더 부풀리기 전에 자른다.
  // 여기서는 **넉넉하게** 자르고(상한만큼의 바이트가 될 수 있는 최대 길이 + 패딩),
  // 정확한 판정은 아래 `bin.length` 가 한다. 반대로 하면 딱 상한만큼인 payload 가
  // 반올림 한 칸 때문에 거부된다.
  if (b64.length > Math.ceil(OSC52_MAX_BYTES / 3) * 4 + 4) return null;
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    // 풀 수 없는 길이(4로 나눈 나머지가 1) 등. **패딩(`=`)을 뗀 payload 는 여기서 안 걸린다**
    // — `atob` 이 알아서 채워 읽고, 그렇게 보내는 도구가 흔해 굳이 막지 않는다.
    return null;
  }
  if (bin.length > OSC52_MAX_BYTES) return null;
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
