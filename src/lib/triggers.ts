/**
 * 표시 트리거 — 긴 로그에서 패턴을 찾아 **하이라이트·링크·툴팁**을 붙인다.
 * (스키마·저장은 `src-tauri/src/settings.rs` · docs/log/2026-09-04-trigger-links-tooltips.md)
 *
 * ## 종류 셋 — 한 트리거에 조합할 수 있다
 *
 * | 종류 | 켜지는 조건 | 무엇을 쓰나 |
 * | --- | --- | --- |
 * | 하이라이트 | `fg` 또는 `bg` | 마커 + 데코레이션 (확정된 줄만, 소급 없음) |
 * | 링크 | `url` | xterm `registerLinkProvider` — Ctrl+클릭에 `openUrl` |
 * | 툴팁 | `tooltip` | 같은 링크 프로바이더의 `hover`/`leave` + DOM 팝오버 |
 *
 * 하이라이트는 **출력이 도착할 때** 훑고(아래 "줄이 확정된 뒤에"), 링크·툴팁은 **마우스가
 * 올라간 줄 하나만** 훑는다 — xterm 이 커서 밑의 줄 번호로 `provideLinks` 를 부르기
 * 때문이다. 즉 링크·툴팁 쪽은 화면에 보이는 줄조차 다 보지 않고 **한 줄만** 본다.
 *
 * ## 표시 계열만 — 입력·실행 계열은 영구 보류
 *
 * 매치했을 때 하는 일은 **보여주는 것과, 사람이 누른 링크를 브라우저에 넘기는 것**뿐이다.
 * 다른 터미널의 "trigger" 가 흔히 제공하는 "매치하면 이 문자열을 보내라 / 이 명령을
 * 실행하라" 는 만들지 않는다. 그 순간 **원격 출력이 로컬에서 코드를 실행시킬 수 있게 되고**,
 * 공격자는 화면에 한 줄 흘리기만 하면 된다 (`echo` 가 곧 코드 실행이다).
 *
 * 링크도 그 경계 안에 있다 — 세 겹으로 막는다.
 *
 * 1. **사람이 Ctrl+클릭해야** 열린다. 출력이 도착하는 것만으로는 아무 일도 일어나지 않는다.
 * 2. 캡처는 `encodeURIComponent` 로 **인코딩되어** 템플릿 안에 들어간다. 스킴·호스트는
 *    사용자가 적은 템플릿의 리터럴 부분이 정하고, 원격이 고를 수 있는 것은 값뿐이다.
 * 3. 그러고도 [`SAFE_PROTOCOLS`] 밖의 스킴이면 열지 않는다.
 *
 * ## 줄이 확정된 뒤에 매치한다
 *
 * 원격 출력은 임의의 경계에서 쪼개져 도착한다 — `ERR` 과 `OR` 가 다른 청크로 오는 것이
 * 정상이다 (docs/verification/xterm.md §3). 그래서 매치는 **커서가 지나간 줄**에만 한다:
 * 커서가 있는 줄은 아직 쓰이는 중이라 건너뛰고, 커서가 다음 줄로 내려간 뒤에 검사한다.
 * `onWriteParsed` 시점(= 파서가 그 청크를 다 먹은 뒤)에 도는 것도 같은 이유다.
 *
 * ## 소급 적용은 하지 않는다 (하이라이트만)
 *
 * 이미 스크롤백에 쌓인 줄은 **칠하지** 않는다. 트리거를 켜거나 고치면 그 순간부터 나오는
 * 출력에만 붙는다 (설정을 바꾸면 화면의 기존 하이라이트도 함께 사라진다). 스크롤백
 * 전체를 다시 훑는 것은 수만 줄 × 패턴 수의 작업이라 설정 화면에서 한 글자 칠 때마다
 * 돌릴 수 있는 비용이 아니다.
 *
 * **링크·툴팁에는 이 제약이 없다.** 마우스가 올라간 순간 그 줄만 다시 훑으므로 지나간
 * 줄에도, 대체 화면(`vim`·`less`)에도 그대로 붙는다 — "확정된 줄" 이라는 개념도 마커도
 * 필요 없기 때문이다.
 */

import { openUrl } from "@tauri-apps/plugin-opener";
import type { IBufferLine, IDecoration, ILink, IMarker, Terminal } from "@xterm/xterm";
// **타입만** 빌린다 — 이 파일은 vitest 가 node 에서 그대로 돌리는 모듈이라 룬 모듈을
// 값으로 들이면 안 된다 (문구는 `attachTriggers` 가 인자로 받는다).
import type { Tr } from "$lib/session";

/** Rust `Trigger` 와 1:1 (snake_case 없음 — 전부 한 단어다) */
export interface Trigger {
  /** 정규식 문자열 (JS `RegExp` 문법) */
  pattern: string;
  /** 매치 구간의 글자색. 없으면 원래 색 그대로 */
  fg?: string | null;
  /** 매치 구간의 배경색. 없으면 배경을 칠하지 않는다 */
  bg?: string | null;
  /**
   * Ctrl+클릭했을 때 열 URL **템플릿**. `$0`(매치 전체)·`$1`… 이 캡처로 치환된다
   * (치환값은 `encodeURIComponent`). 없거나 비면 이 트리거는 링크가 아니다.
   */
  url?: string | null;
  /**
   * 마우스를 올렸을 때 뜨는 설명 **템플릿**. 치환 규칙은 `url` 과 같되 인코딩은 하지
   * 않는다 (사람이 읽는 글이다). 없거나 비면 툴팁이 없다.
   */
  tooltip?: string | null;
  enabled: boolean;
}

/** 컴파일에 성공한 트리거 하나 */
export interface CompiledTrigger {
  /** 원본 패턴 (오류 표시·디버깅용) */
  source: string;
  /** `g` 플래그가 붙은 정규식. `lastIndex` 는 쓰는 쪽이 매번 되돌린다 */
  re: RegExp;
  fg: string | null;
  bg: string | null;
  /** URL 템플릿 (치환 전). `null` = 링크 아님 */
  url: string | null;
  /** 툴팁 템플릿 (치환 전). `null` = 툴팁 없음 */
  tooltip: string | null;
}

/** 컴파일에 실패한 트리거 — 설정 화면이 그 줄에 빨간 한 줄로 보여준다 */
export interface TriggerError {
  /** 원본 목록에서의 위치 (설정 화면의 행 번호) */
  index: number;
  pattern: string;
  message: string;
}

/** 매치 한 건. 좌표는 **문자열 인덱스**다 (셀 좌표 변환은 아래 부착부가 한다) */
export interface TriggerMatch {
  start: number;
  /** 끝 **다음** 인덱스 (반열린 구간) */
  end: number;
  fg: string | null;
  bg: string | null;
  url: string | null;
  tooltip: string | null;
  /**
   * `$0`(매치 전체)·`$1`… 치환에 쓸 캡처들. **템플릿이 있는 트리거에서만 채운다** —
   * 하이라이트 경로는 줄마다 수십 번 도는 자리라 쓰지도 않을 배열을 만들지 않는다.
   */
  groups?: string[];
}

/**
 * 한 줄에서 만들 수 있는 최대 매치 수.
 *
 * `.` 같은 패턴 하나면 줄마다 수백 개의 데코레이션이 생긴다 — 데코레이션 하나가 DOM
 * 원소 하나라 그대로 두면 대량 출력에서 프레임이 죽는다. 넘치는 매치는 조용히 버린다
 * (그런 패턴은 하이라이트로 쓸모가 없으므로 잘려도 잃는 정보가 없다).
 */
const MAX_MATCHES_PER_LINE = 32;

// ---------------------------------------------------------------------------
// 순수 부분 — 컴파일과 매칭 (xterm 을 모른다)
// ---------------------------------------------------------------------------

/** 빈 문자열·공백만 있는 값은 "안 정함" (백엔드 `fold_empty` 와 같은 규칙) */
function color(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

/**
 * 템플릿의 `$0`·`$1`… 을 캡처로 치환한다 — **순수 함수**.
 *
 * - `$0` 은 매치 전체, `$1`… 은 괄호 캡처다 (JS `RegExp` 의 결과 배열과 같은 번호).
 * - 두 자리까지 읽는다 (`$12`). 그 자리에 캡처가 없으면 **빈 문자열**로 지운다 —
 *   `$9` 를 오타로 남겨 두었을 때 URL 에 `$9` 라는 글자가 그대로 실려 나가는 편이 더 나쁘다.
 * - `$$` 는 리터럴 `$` 다 (달러가 필요한 URL·문구를 적을 길이 있어야 한다).
 *
 * `encode` 는 URL 템플릿에서만 켠다. **이 인코딩이 링크의 안전선이다**: 캡처는 원격이
 * 보낸 바이트라 무엇이든 들어올 수 있는데, 인코딩을 거치면 `:`·`/`·`?` 가 전부
 * `%3A`·`%2F`·`%3F` 가 되어 스킴이나 호스트를 갈아치울 수 없다. 사람이 읽는 툴팁 쪽은
 * 인코딩하지 않는다 (`textContent` 로만 넣으므로 HTML 로 해석될 길이 없다).
 */
export function expandTemplate(
  template: string,
  groups: readonly (string | undefined)[],
  encode: boolean,
): string {
  return template.replace(/\$(\$|\d{1,2})/g, (_, tail: string) => {
    if (tail === "$") return "$";
    const v = groups[Number(tail)];
    if (v === undefined) return "";
    return encode ? encodeURIComponent(v) : v;
  });
}

/**
 * 링크로 열어 줄 스킴. 템플릿을 적는 것은 사용자지만, 오타나 붙여넣기 사고로 `file:` ·
 * 앱 커스텀 스킴이 들어가면 클릭 한 번이 로컬 프로그램을 띄우는 일이 된다 — 브라우저에
 * 넘기는 값은 브라우저가 다루는 것으로 좁혀 둔다.
 */
const SAFE_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

/**
 * 치환이 끝난 URL 을 열어도 되는가 — **순수 함수** (`URL` 파싱만 한다).
 * 파싱에 실패하거나(상대 경로·`$1` 만 적은 템플릿) 스킴이 낯설면 `null` 을 준다.
 */
export function safeUrl(raw: string): string | null {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  return SAFE_PROTOCOLS.has(u.protocol) ? u.href : null;
}

/**
 * 트리거 목록을 **한 번** 컴파일한다 — 줄마다 `new RegExp` 을 만들면 대량 출력에서
 * 그 자체가 비용이다.
 *
 * 꺼져 있거나 패턴이 빈 항목은 조용히 건너뛰고, 문법이 잘못된 항목은 `errors` 로 나간다.
 * **잘못된 정규식이 하나 있다고 나머지가 죽지 않는다** — 설정 파일을 손으로 고치다
 * 오타를 낸 것이 화면 전체의 하이라이트를 끄는 결과가 되면 안 된다.
 */
export function compileTriggers(list: readonly Trigger[] | null | undefined): {
  compiled: CompiledTrigger[];
  errors: TriggerError[];
} {
  const compiled: CompiledTrigger[] = [];
  const errors: TriggerError[] = [];
  if (!Array.isArray(list)) return { compiled, errors };

  list.forEach((t, index) => {
    const pattern = typeof t?.pattern === "string" ? t.pattern.trim() : "";
    if (pattern === "") return;
    let re: RegExp;
    try {
      // `g` 는 필수다 — 아래 `exec` 루프가 `lastIndex` 로 줄을 훑는다.
      re = new RegExp(pattern, "g");
    } catch (e) {
      errors.push({
        index,
        pattern,
        message: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    // 오류 목록에는 꺼진 항목도 넣는다 (고치기 전에는 켜도 안 먹는다는 것을 알려야 한다).
    if (!t.enabled) return;
    compiled.push({
      source: pattern,
      re,
      fg: color(t.fg),
      bg: color(t.bg),
      // 빈 템플릿은 "칸만 열어 두고 아직 안 적었다" 는 뜻이라 없는 것과 같다.
      url: color(t.url),
      tooltip: color(t.tooltip),
    });
  });

  return { compiled, errors };
}

/**
 * 배경만 칠하는 데코레이션의 불투명도.
 *
 * 데코레이션 DOM 은 **캔버스 위**에 있다 — `layer: "bottom"` 은 DOM 렌더러에서만 글자
 * 아래로 가고, WebGL/캔버스 렌더러에서는 글자가 캔버스 안에 그려지므로 어떤 층이든 DOM 이
 * 위다. 그래서 불투명 배경을 깔면 **글자가 통째로 사라진다** (실기 피드백: 하이라이트된
 * 줄만 빈칸이 됐다). 반투명이면 두 렌더러 모두에서 글자가 비쳐 보인다.
 *
 * 0.45 는 "구간이 눈에 띄되 글자가 읽히는" 자리다 — 더 올리면 글자가 흐려지고,
 * 더 내리면 하이라이트가 배경색에 묻힌다.
 */
const BG_ALPHA = 0.45;

/**
 * hex 색을 반투명 `rgba()` 로 바꾼다 — **순수 함수**.
 *
 * **hex 만 손댄다.** 사용자가 `rgba(...)`·`hsl(...)`·이름 색을 직접 적었다면 그 값에는
 * 이미 자기 의도(알파 포함)가 들어 있으므로 그대로 둔다 — 앱이 남의 알파를 덮어쓰면
 * "왜 내가 적은 색이 안 나오나" 가 된다. 8자리 hex(`#rrggbbaa`)도 알파가 명시된 값이라
 * 건드리지 않는다.
 *
 * 설정 화면의 색 선택기가 내놓는 값이 `#rrggbb` 라, 실제로는 이 경로가 기본이다.
 */
export function translucent(color: string | null, alpha = BG_ALPHA): string {
  if (color === null) return "";
  const hex = color.trim();
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const body = m[1];
  const [r, g, b] =
    body.length === 3
      ? [...body].map((c) => Number.parseInt(c + c, 16))
      : [0, 2, 4].map((i) => Number.parseInt(body.slice(i, i + 2), 16));
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** `[start, end)` 가 이미 잡힌 구간과 겹치는가 */
function overlaps(taken: readonly TriggerMatch[], start: number, end: number): boolean {
  return taken.some((m) => start < m.end && m.start < end);
}

/**
 * 한 줄에서 매치를 모은다 — **순수 함수**.
 *
 * 구간이 겹치면 **목록에서 먼저 나온 트리거가 이긴다**. 겹친 채로 둘 다 그리면 어느 색이
 * 위인지가 렌더 순서에 좌우돼 같은 줄이 매번 다르게 보인다. 순서로 정하면 사용자가
 * 목록을 위아래로 옮겨 우선순위를 조절할 수 있다.
 *
 * **부르는 쪽이 목록을 미리 걸러 넘긴다** — 하이라이트는 색이 있는 것만, 링크·툴팁은
 * 템플릿이 있는 것만 넘긴다. 그래서 겹침 판정도 같은 계열 안에서만 일어난다: 색만 있는
 * 트리거와 링크만 있는 트리거가 같은 글자를 덮어도 서로를 밀어내지 않는다 (둘은 화면에서
 * 다투는 자원이 아니다).
 *
 * 반환은 `start` 오름차순이다.
 */
export function matchLine(
  text: string,
  compiled: readonly CompiledTrigger[],
  limit = MAX_MATCHES_PER_LINE,
): TriggerMatch[] {
  const out: TriggerMatch[] = [];
  if (text === "" || compiled.length === 0) return out;

  for (const t of compiled) {
    t.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = t.re.exec(text)) !== null) {
      const start = m.index;
      const end = start + m[0].length;
      if (end === start) {
        // 길이 0 매치(`a*`·`\b` 등)는 `lastIndex` 를 움직이지 않아 무한 루프가 된다.
        // 칠할 것도 없으므로 한 칸 밀고 넘어간다.
        t.re.lastIndex = start + 1;
        continue;
      }
      if (!overlaps(out, start, end)) {
        out.push({
          start,
          end,
          fg: t.fg,
          bg: t.bg,
          url: t.url,
          tooltip: t.tooltip,
          // 캡처 배열은 템플릿이 있을 때만 뜬다 (`TriggerMatch.groups` 주석).
          groups: t.url !== null || t.tooltip !== null ? [...m] : undefined,
        });
        if (out.length >= limit) {
          out.sort((a, b) => a.start - b.start);
          return out;
        }
      }
    }
  }

  out.sort((a, b) => a.start - b.start);
  return out;
}

// ---------------------------------------------------------------------------
// 부착 — xterm 마커·데코레이션
// ---------------------------------------------------------------------------

/**
 * 한 번(=한 tick)에 검사할 최대 줄 수.
 *
 * `cat 거대파일` 처럼 한 번에 수천 줄이 쏟아지면 그 전부를 `onWriteParsed` 안에서 훑는
 * 순간 프레임이 통째로 멈춘다. 여기서 끊고 나머지는 다음 rAF 로 넘긴다 — 출력이 계속
 * 밀려들면 프런티어 마커가 스크롤백 밖으로 밀려 사라지고, 그때는 따라잡기를 포기하고
 * 현재 위치에서 다시 시작한다 (**하이라이트를 놓치는 것이 프레임을 놓치는 것보다 낫다**).
 */
const MAX_LINES_PER_TICK = 200;

/**
 * 살려 둘 최대 데코레이션 수. 스크롤백 밖으로 밀린 것은 xterm 이 마커째 정리해 주지만,
 * 스크롤백이 아주 큰 호스트에서는 그전에 DOM 원소가 수만 개가 될 수 있다.
 */
const MAX_DECORATIONS = 800;

/** 한 줄에 붙인 마커와 그 줄의 데코레이션들 (함께 나고 함께 죽는다) */
export interface DecoratedLine {
  marker: Pick<IMarker, "line" | "isDisposed" | "dispose">;
  decorations: Pick<IDecoration, "dispose">[];
}

/**
 * `CSI J`(ED) 하나가 하이라이트에 뜻하는 것 — **순수 함수**
 * (docs/log/2026-10-05-trigger-highlight-clear.md).
 *
 * 데코는 마커에 걸리고 마커는 줄이 **빈 칸이 되어도** 산다 — 그래서 `clear` 뒤 빈 줄에
 * 하이라이트가 남았다. 셸 통합의 같은 문제(`shell-integration/erase.ts`,
 * docs/log/2026-09-27-clear-highlights.md)와 판정을 맞춘다.
 *
 * - `ED 2` — 뷰포트 줄 (`scrollOnEraseInDisplay` 면 글자가 스크롤백으로 올라가 살아 있으니 없음).
 * - `ED 3` — 스크롤백 줄. 그리고 `checkBlank`: Windows ConPTY 의 `clear`/`cls` 는 `ED 2` 없이
 *   `ED 3` 뒤 `CSI K` 로 화면 줄을 하나씩 지운다 — 그 지우기가 끝난 **다음 쓰기 처리 뒤**
 *   뷰포트의 **빈 줄**에 걸린 것을 걷는다 (빈 줄 조건이 있어 `ED 3` 단독이면 화면은 그대로).
 * - `ED 0`·`ED 1` 은 보지 않는다 — 진행 막대·TUI 의 흔한 모양이다.
 */
export function eraseEffect(
  mode: number | undefined,
  baseY: number,
  rows: number,
  scrollOnErase: boolean,
): { hit: ((line: number) => boolean) | null; checkBlank: boolean } {
  if (mode === 2 && !scrollOnErase) {
    return { hit: (line) => line >= baseY && line < baseY + rows, checkBlank: false };
  }
  if (mode === 3) return { hit: (line) => line < baseY, checkBlank: true };
  return { hit: null, checkBlank: false };
}

/**
 * `hit(줄)` 이 참이거나 이미 죽은 마커의 줄을 `live` 에서 빼고 데코·마커를 버린다 — 참조가
 * 남지 않게 배열에서도 뺀다. 뺀 개수를 돌려준다.
 */
export function dropLines(live: DecoratedLine[], hit: (line: number) => boolean): number {
  let n = 0;
  for (let i = live.length - 1; i >= 0; i--) {
    const item = live[i];
    if (!item.marker.isDisposed && !hit(item.marker.line)) continue;
    for (const d of item.decorations) d.dispose();
    item.marker.dispose();
    live.splice(i, 1);
    n++;
  }
  return n;
}

export interface TriggerHighlighter {
  /**
   * 트리거 목록을 갈아 끼운다. **화면의 기존 하이라이트는 전부 사라지고** 이 시점 이후의
   * 출력부터 새 목록이 적용된다 (소급 적용 없음 — 위 모듈 주석 참고).
   * 링크·툴팁은 다음 마우스 이동부터 곧바로 새 목록으로 답한다.
   */
  setTriggers(list: readonly Trigger[] | null | undefined): void;
  dispose(): void;
}

/**
 * 툴팁이 뜨기까지 마우스가 머물러야 하는 시간(ms).
 *
 * 터미널 위에서 마우스는 스치듯 지나간다 — 지연이 없으면 화면을 가로지르는 동안 팝오버가
 * 연달아 깜빡인다. 300ms 는 브라우저 기본 툴팁보다 빠르면서 "잠깐 멈췄다" 로 읽히는 자리다.
 */
const TOOLTIP_DELAY_MS = 300;

/** 팝오버가 커서에서 떨어져 있는 거리(px) — 커서 그림자에 글자가 가리지 않을 만큼만 */
const TOOLTIP_GAP = 10;

/**
 * 팝오버에 보여줄 최대 글자 수.
 *
 * 치환된 내용에는 **원격이 보낸 글자**가 섞인다 (`$0` 은 매치 전체다). 폭이 넓은 창에서
 * 한 줄이 수백 칸이면 팝오버가 화면을 절반 넘게 덮는데, 그건 툴팁이 아니라 방해다.
 * 자를 뿐 여는 URL 은 온전한 값을 쓴다 — 잘린 것은 **보이는 글자**뿐이다.
 */
const TOOLTIP_MAX_CHARS = 300;

/** 너무 길면 뒤를 자르고 줄임표를 붙인다 — **순수 함수** */
function clip(s: string): string {
  return s.length <= TOOLTIP_MAX_CHARS ? s : `${s.slice(0, TOOLTIP_MAX_CHARS)}…`;
}

/**
 * 문자열 인덱스 → 셀 x 좌표 표를 만든다.
 *
 * `translateToString` 이 만든 문자열의 인덱스는 **셀 좌표가 아니다**: 한글 같은 넓은
 * 글자는 문자 하나로 두 칸을 쓰고(뒷칸은 폭 0이라 문자열에 나타나지 않는다), 결합 문자·
 * 이모지는 한 칸에 여러 문자가 들어간다. 데코레이션은 셀 좌표를 요구하므로 여기서 옮긴다.
 *
 * 반환 배열의 길이는 `문자열 길이 + 1` 이고, 마지막 원소는 줄 끝 경계다
 * (반열린 구간 `[start, end)` 의 `end` 를 그대로 넣을 수 있게).
 *
 * 셀을 한 번 훑는 비용이 있으므로 **매치가 하나라도 있는 줄에서만** 부른다.
 * 터미널 경로 링크(`term-path-links.ts`)도 같은 옮김을 쓴다.
 */
export function cellColumns(line: IBufferLine): number[] {
  const map: number[] = [];
  const cell = line.getCell(0);
  if (!cell) return [0];
  for (let x = 0; x < line.length; x++) {
    if (!line.getCell(x, cell)) continue;
    // 폭 0 = 넓은 글자의 뒷칸. `translateToString` 이 건너뛰므로 여기서도 건너뛴다.
    if (cell.getWidth() === 0) continue;
    const chars = cell.getChars();
    // 빈 셀은 공백 한 글자로 나온다.
    const len = chars.length === 0 ? 1 : chars.length;
    for (let i = 0; i < len; i++) map.push(x);
  }
  map.push(line.length);
  return map;
}

/**
 * 마우스가 트리거 **링크** 위에 올라갔다/떠났다는 알림
 * (docs/log/2026-09-05-terminal-context-menu.md).
 *
 * 터미널 우클릭 메뉴가 "이 자리에 링크가 있는가" 를 알아야 하는데, 그 판정은 이미 링크
 * 프로바이더가 하고 있다 — 같은 정규식·같은 템플릿 치환을 우클릭 때 한 번 더 돌릴 이유가
 * 없다. 그래서 **호버 상태를 그대로 밖으로 흘려보낸다**: 우클릭한 그 순간의 커서는 링크
 * 위에 있으므로 `leave` 가 아직 오지 않았고, 마지막으로 받은 값이 곧 답이다.
 *
 * `url` 이 `null` 인 매치(툴팁만 있는 트리거)는 **알리지 않는다** — 열 것도 복사할 주소도
 * 없어 메뉴에 세울 것이 없다.
 */
export type TriggerLinkHover = (url: string | null) => void;

/**
 * 터미널 하나에 트리거 하이라이트를 건다. `t.open()` **뒤에** 부를 것 —
 * 데코레이션은 렌더러가 서 있어야 그려진다 (OSC 133 실패 표시와 같은 제약).
 *
 * `onlinkhover` 는 링크 위로 마우스가 들고 날 때마다 불린다 (없으면 안 부른다).
 *
 * `tr` 는 툴팁 둘째 줄("Ctrl+클릭 → …") 한 줄에만 쓴다 — 이 모듈은 순수라 사전을 직접
 * 들이지 않고 `Terminal.svelte` 가 `t` 를 그대로 넘긴다.
 */
export function attachTriggers(
  term: Terminal,
  tr: Tr,
  onlinkhover?: TriggerLinkHover,
): TriggerHighlighter {
  /** 색이 있는 트리거만 — 아래 [`scan`] 이 쓴다 */
  let compiled: CompiledTrigger[] = [];
  /** 템플릿(URL·툴팁)이 있는 트리거만 — 링크 프로바이더가 쓴다 */
  let interactive: CompiledTrigger[] = [];
  /** 마지막으로 검사를 마친 줄. 마커라서 버퍼가 스크롤해도 그 줄을 따라간다 */
  let frontier: IMarker | null = null;
  /** `onWriteParsed` 구독. 트리거가 하나도 없으면 **아예 걸지 않는다** */
  let writes: { dispose(): void } | null = null;
  /** 따라잡기 예약 (rAF) */
  let raf = 0;
  const live: DecoratedLine[] = [];
  let disposed = false;
  /** `ED 3` 뒤 다음 쓰기 처리에서 뷰포트의 빈 줄을 볼 차례인가 ([`eraseEffect`]) */
  let blankCheckPending = false;

  // 화면 지우기(`clear`)로 글자가 사라진 줄의 하이라이트를 걷는다 — 기본 처리 **앞에서**
  // 엿보고(`false`) 지우기는 그대로 돌린다. 대체 화면의 지우기는 일반 화면 마커와 무관하다.
  const erase = term.parser.registerCsiHandler({ final: "J" }, (params) => {
    if (live.length === 0 || term.buffer.active.type !== "normal") return false;
    const p = params[0];
    const fx = eraseEffect(
      typeof p === "number" ? p : undefined,
      term.buffer.active.baseY,
      term.rows,
      !!term.options.scrollOnEraseInDisplay,
    );
    if (fx.hit) dropLines(live, fx.hit);
    if (fx.checkBlank) blankCheckPending = true;
    return false;
  });

  function dropBlankViewportLines() {
    blankCheckPending = false;
    const buf = term.buffer.active;
    if (live.length === 0 || buf.type !== "normal") return;
    const top = buf.baseY;
    dropLines(
      live,
      (line) =>
        line >= top &&
        line < top + term.rows &&
        (buf.getLine(line)?.translateToString(true) ?? "") === "",
    );
  }

  function clearDecorations() {
    for (const item of live) {
      for (const d of item.decorations) d.dispose();
      item.marker.dispose();
    }
    live.length = 0;
  }

  /** 스크롤백 밖으로 밀려 죽은 것을 걷어 내고, 상한을 넘으면 오래된 것부터 버린다 */
  function prune() {
    while (live.length > 0 && live[0].marker.isDisposed) {
      const dead = live.shift();
      for (const d of dead?.decorations ?? []) d.dispose();
    }
    while (live.length > MAX_DECORATIONS) {
      const dead = live.shift();
      for (const d of dead?.decorations ?? []) d.dispose();
      dead?.marker.dispose();
    }
  }

  /**
   * "여기까지는 검사한 것으로 친다" — 소급 적용을 하지 않는다는 뜻이다.
   * 대체 화면 위에서는 마커를 걸지 않고 비워 둔다 (그 버퍼의 마커는 우리에게 의미가 없다).
   * 비어 있어도 [`scan`] 이 다음 기회에 다시 세운다.
   */
  function resetFrontier() {
    frontier?.dispose();
    frontier =
      disposed || term.buffer.active.type !== "normal" ? null : (term.registerMarker(0) ?? null);
  }

  /** 줄 하나를 검사하고 매치 구간에 데코레이션을 붙인다 */
  function decorateLine(y: number, cursorAbs: number) {
    const line = term.buffer.active.getLine(y);
    if (!line) return;
    // `false` = 오른쪽 공백을 남긴다. 줄 전체가 있어야 `\b` 가 줄 끝에서도 성립한다.
    const text = line.translateToString(false);
    const matches = matchLine(text, compiled);
    if (matches.length === 0) return;

    const columns = cellColumns(line);
    const marker = term.registerMarker(y - cursorAbs);
    if (!marker) return;

    const decorations: IDecoration[] = [];
    for (const m of matches) {
      const x = columns[m.start];
      const endX = columns[m.end];
      if (x === undefined || endX === undefined || endX <= x || x >= term.cols) continue;
      const width = Math.min(endX - x, term.cols - x);

      if (m.fg === null) {
        // 배경만 — `bottom` 층에 **반투명**으로 깐다.
        //
        // 층만으로는 부족하다: `bottom` 이 글자 아래로 가는 것은 DOM 렌더러에서뿐이고,
        // WebGL/캔버스에서는 글자가 캔버스 안에 있어 데코레이션 DOM 이 언제나 위다.
        // 불투명하면 그 줄이 통째로 빈칸이 된다 (실기). 반투명이면 두 경우 모두 읽힌다 —
        // DOM 렌더러에서는 여전히 아래에 깔리므로 손해도 없다 (`BG_ALPHA`).
        const d = term.registerDecoration({ marker, x, width, layer: "bottom" });
        if (!d) continue;
        d.onRender((el) => {
          el.classList.add("aynx-trigger-bg");
          el.style.backgroundColor = translucent(m.bg);
        });
        decorations.push(d);
        continue;
      }

      // 글자색을 바꾸려면 위에 덮어 다시 그리는 수밖에 없다 — 데코레이션은 셀의 색을
      // 바꾸지 못하고 그 위에 놓이는 별개의 원소이기 때문이다. 그래서 배경을 **불투명하게**
      // 깔아 원래 글자를 가리고(지정이 없으면 터미널 배경색) 같은 글자를 새 색으로 찍는다.
      const matched = text.slice(m.start, m.end);
      const d = term.registerDecoration({ marker, x, width, layer: "top" });
      if (!d) continue;
      d.onRender((el) => {
        el.classList.add("aynx-trigger-text");
        el.textContent = matched;
        el.style.color = m.fg ?? "";
        el.style.backgroundColor = m.bg ?? "var(--term-bg)";
        // 글꼴은 xterm 옵션에서 직접 가져온다 (상속에 기대면 렌더러에 따라 어긋난다).
        el.style.fontFamily = term.options.fontFamily ?? "";
        el.style.fontSize = `${term.options.fontSize ?? 14}px`;
      });
      decorations.push(d);
    }

    if (decorations.length === 0) {
      marker.dispose();
      return;
    }
    live.push({ marker, decorations });
  }

  function schedule() {
    if (raf !== 0 || disposed) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      scan();
    });
  }

  function scan() {
    if (disposed || compiled.length === 0) return;
    const buf = term.buffer.active;
    // 대체 화면(vim·top·less)은 건드리지 않는다 — 전체 화면을 매 프레임 다시 그리는
    // 통에 "확정된 줄" 이라는 개념이 없고, 마커도 그 버퍼에서는 의미가 없다.
    if (buf.type !== "normal") return;

    const cursorAbs = buf.baseY + buf.cursorY;
    const alive = frontier !== null && !frontier.isDisposed;
    // 프런티어를 잃었거나(스크롤백 밖으로 밀림) 커서보다 앞에 있으면(화면 지움) 되감지
    // 않고 **현재 위치**에서 다시 시작한다.
    const from = alive ? Math.min(frontier!.line + 1, cursorAbs) : cursorAbs;

    const to = Math.min(cursorAbs, from + MAX_LINES_PER_TICK);
    for (let y = from; y < to; y++) decorateLine(y, cursorAbs);

    // 프런티어는 **한 줄도 못 읽었어도** 다시 세운다 — 마커를 잃은 채로 두면 `from` 이
    // 영원히 커서에 붙어 스캔이 통째로 멈춘다.
    if (to > from || !alive) {
      frontier?.dispose();
      frontier = term.registerMarker(Math.max(0, to - 1) - cursorAbs) ?? null;
    }
    if (to > from) prune();
    // 아직 남았으면 다음 프레임에 이어서 (한 프레임을 다 먹지 않는다).
    if (to < cursorAbs) schedule();
  }

  // -------------------------------------------------------------------------
  // 툴팁 팝오버 — 링크 프로바이더의 hover/leave 에 매달린 DOM 하나
  //
  // 데코레이션을 쓰지 않는 것이 중요하다: 데코레이션은 **줄이 확정될 때** 붙는 물건이라
  // 지나간 줄·대체 화면에는 없고, 화면에 보이는 줄마다 하나씩 만들어 두면 그것대로 DOM 이
  // 불어난다. hover 콜백은 마우스가 올라간 **그 순간 그 줄 하나만** 훑으므로 훨씬 싸다.
  //
  // 원소는 `term.element` 안에 살고 `xterm-hover` 클래스를 단다 — xterm 이 그 클래스를 보고
  // "이 위의 마우스 이벤트는 링크 판정에서 빠져나가지 않는다" 로 다룬다 (공식 규약).
  // -------------------------------------------------------------------------

  let tip: HTMLDivElement | null = null;
  let tipText: HTMLDivElement | null = null;
  let tipUrl: HTMLDivElement | null = null;
  let tipTimer = 0;
  /** 터미널 밖으로 마우스가 나갈 때·스크롤할 때 팝오버를 거두는 구독들 */
  const tipOff: { dispose(): void }[] = [];

  function ensureTip(): HTMLDivElement | null {
    if (tip) return tip;
    const host = term.element;
    if (!host) return null;
    tip = document.createElement("div");
    // `xterm-hover` 는 xterm 과의 약속이고, 뒤 클래스가 우리 테마다 (CSS 는 Terminal.svelte).
    tip.className = "xterm-hover aynx-trigger-tip";
    tip.setAttribute("role", "tooltip");
    tip.style.display = "none";
    tipText = document.createElement("div");
    tipText.className = "aynx-tip-text";
    tipUrl = document.createElement("div");
    tipUrl.className = "aynx-tip-url";
    tip.append(tipText, tipUrl);
    host.appendChild(tip);
    return tip;
  }

  function hideTip() {
    clearTimeout(tipTimer);
    tipTimer = 0;
    if (tip) tip.style.display = "none";
  }

  /** 커서 위(자리가 없으면 아래)에 띄우고 좌우로는 터미널 안에 가둔다 */
  function placeTip(el: HTMLDivElement, x: number, y: number) {
    const host = term.element;
    if (!host) return;
    const box = host.getBoundingClientRect();
    // 크기를 재려면 먼저 보여야 한다 (그 사이 한 프레임도 지나지 않으므로 깜빡이지 않는다).
    el.style.display = "block";
    el.style.left = "0px";
    el.style.top = "0px";
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const px = x - box.left;
    const py = y - box.top;
    const left = Math.max(4, Math.min(px - w / 2, Math.max(4, box.width - w - 4)));
    // 위쪽이 모자라면 커서 아래로 뒤집는다 (첫 줄에서 잘리지 않게).
    const above = py - TOOLTIP_GAP - h;
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(above >= 4 ? above : py + TOOLTIP_GAP * 2)}px`;
  }

  /** `hover` 에서 부른다 — 300ms 를 버틴 뒤에야 실제로 뜬다 */
  function scheduleTip(ev: MouseEvent, note: string | null, href: string | null) {
    hideTip();
    if (note === null && href === null) return;
    const x = ev.clientX;
    const y = ev.clientY;
    tipTimer = window.setTimeout(() => {
      tipTimer = 0;
      const el = ensureTip();
      if (!el || !tipText || !tipUrl || disposed) return;
      // **`textContent` 만 쓴다.** 내용에 원격이 보낸 캡처가 섞여 들어오므로 HTML 로
      // 해석될 길을 아예 두지 않는다.
      tipText.textContent = note === null ? "" : clip(note);
      tipText.hidden = note === null;
      tipUrl.textContent = href === null ? "" : tr("pane.term.link.hint", { url: clip(href) });
      tipUrl.hidden = href === null;
      placeTip(el, x, y);
    }, TOOLTIP_DELAY_MS);
  }

  // -------------------------------------------------------------------------
  // 링크 프로바이더 — 링크와 툴팁을 한 벌로 낸다
  //
  // xterm 은 마우스가 올라간 **줄 번호 하나**로 이걸 부르고(1부터·스크롤백 포함 절대 좌표),
  // 같은 줄에 머무는 동안의 답은 캐시한다. 그래서 여기서 하는 일은 "그 줄 한 개 훑기" 다.
  //
  // **프로바이더 순서가 곧 우선순위다** — 먼저 등록된 쪽에 링크가 있으면 뒤는 안 본다.
  // 그래서 `Terminal.svelte` 는 이것을 web-links 애드온보다 **먼저** 건다: 사용자가 적은
  // 규칙이 기본 URL 자동 링크를 이긴다.
  // -------------------------------------------------------------------------

  const links = term.registerLinkProvider({
    provideLinks(bufferLine, callback) {
      if (disposed || interactive.length === 0) {
        callback(undefined);
        return;
      }
      const line = term.buffer.active.getLine(bufferLine - 1);
      if (!line) {
        callback(undefined);
        return;
      }
      const text = line.translateToString(false);
      const matches = matchLine(text, interactive);
      if (matches.length === 0) {
        callback(undefined);
        return;
      }

      const columns = cellColumns(line);
      const out: ILink[] = [];
      for (const m of matches) {
        const x = columns[m.start];
        const endX = columns[m.end];
        if (x === undefined || endX === undefined || endX <= x) continue;
        const matched = text.slice(m.start, m.end);
        const groups = m.groups ?? [matched];
        // 템플릿 치환은 **여기서 한 번**이다 (클릭·호버마다 다시 하지 않는다).
        const href = m.url === null ? null : safeUrl(expandTemplate(m.url, groups, true));
        const note = m.tooltip === null ? null : expandTemplate(m.tooltip, groups, false);
        if (href === null && note === null) continue;

        out.push({
          // xterm 의 범위는 1부터이고 `end.x` 는 **포함**이다 (`columns[end]` 가 0부터
          // 세는 열린 끝이라 그대로 1부터의 닫힌 끝이 된다).
          range: { start: { x: x + 1, y: bufferLine }, end: { x: endX, y: bufferLine } },
          text: matched,
          // 링크가 아닌(툴팁만인) 매치는 밑줄도 손가락 커서도 주지 않는다 — 누를 것이 없는데
          // 누를 수 있게 보이면 안 된다.
          decorations: { pointerCursor: href !== null, underline: href !== null },
          activate(ev) {
            if (href === null) return;
            // **Ctrl(맥은 ⌘)+클릭에서만 연다.** 터미널에서 맨 클릭은 선택·포커스이고,
            // 원격이 흘린 글자가 맨 클릭 한 번에 브라우저를 여는 것도 바라지 않는다.
            if (!ev.ctrlKey && !ev.metaKey) return;
            hideTip();
            void openUrl(href).catch((e: unknown) => {
              console.error(`[aynx] 트리거 링크를 열지 못했습니다: ${href}`, e);
            });
          },
          hover(ev) {
            scheduleTip(ev, note, href);
            // 우클릭 메뉴가 읽을 "지금 커서 밑의 링크". 툴팁 지연(300ms)과 달리 **즉시**
            // 알린다 — 마우스를 올리자마자 우클릭하는 것이 이 메뉴의 평범한 사용이다.
            if (href !== null) onlinkhover?.(href);
          },
          leave() {
            hideTip();
            if (href !== null) onlinkhover?.(null);
          },
        });
      }
      callback(out.length > 0 ? out : undefined);
    },
  });

  // 스크롤하면 팝오버가 가리키던 글자가 다른 자리로 가 버린다 — 따라다니게 만들 것이 아니라
  // 거둔다 (마우스를 다시 올리면 300ms 뒤에 새로 뜬다). 터미널 밖으로 나갈 때도 같다.
  tipOff.push(term.onScroll(() => hideTip()));
  {
    const host = term.element;
    if (host) {
      const onLeave = () => {
        hideTip();
        // 커서가 터미널 밖으로 나가면 `leave` 가 안 올 수도 있다 (빠르게 스쳐 나간 경우).
        // 남아 있는 링크 상태로 우클릭 메뉴가 "링크 열기" 를 세우면 그건 거짓말이다.
        onlinkhover?.(null);
      };
      host.addEventListener("mouseleave", onLeave);
      tipOff.push({ dispose: () => host.removeEventListener("mouseleave", onLeave) });
    }
  }

  return {
    setTriggers(list) {
      if (disposed) return;
      const all = compileTriggers(list).compiled;
      // 계열별로 나눠 둔다 — 줄마다 도는 비용이 곧 목록 길이라, 색만 있는 트리거를
      // 링크 판정에 끼워 넣거나 그 반대를 하면 양쪽 다 손해다.
      compiled = all.filter((t) => t.fg !== null || t.bg !== null);
      interactive = all.filter((t) => t.url !== null || t.tooltip !== null);
      // 목록이 바뀌면 화면을 백지에서 다시 시작한다 — 지금 켜진 하이라이트가 옛 규칙으로
      // 남아 있으면 "왜 이 줄만 빨간가" 를 설명할 수 없다.
      clearDecorations();
      resetFrontier();
      // 링크·툴팁은 다음 마우스 이동에 새 목록으로 답한다. 지금 떠 있는 팝오버만 거둔다.
      hideTip();
      if (compiled.length === 0) {
        // 칠할 트리거가 하나도 없으면 스캔 자체를 하지 않는다 (구독을 떼는 것이 확실하다).
        writes?.dispose();
        writes = null;
        return;
      }
      writes ??= term.onWriteParsed(() => {
        if (blankCheckPending) dropBlankViewportLines();
        scan();
      });
    },

    dispose() {
      disposed = true;
      onlinkhover?.(null); // 떠나는 알림 없이 사라질 수 있다 — 마지막 상태를 비워 둔다
      if (raf !== 0) cancelAnimationFrame(raf);
      raf = 0;
      writes?.dispose();
      writes = null;
      erase.dispose();
      links.dispose();
      for (const off of tipOff) off.dispose();
      tipOff.length = 0;
      hideTip();
      tip?.remove();
      tip = null;
      tipText = null;
      tipUrl = null;
      clearDecorations();
      frontier?.dispose();
      frontier = null;
      compiled = [];
      interactive = [];
    },
  };
}
