/**
 * **명령이 끝났다고 말하는 규칙** — 순수 모듈 (docs/log/2026-09-16-finish-notify-block-marks-bell.md).
 *
 * 끝난 명령 하나를 사람에게 알리는 표면이 둘이다. 둘 다 **같은 사실**(얼마나 걸렸나 ·
 * 어떻게 끝났나)을 말하므로 문구를 만드는 자리도 하나여야 한다 — 갈라 두면 토스트는
 * `12.4초` 라 하는데 거터 표식은 `12s` 라고 적는 식으로 조용히 어긋난다.
 *
 * | 표면 | 언제 | 무엇이 정하나 |
 * | --- | --- | --- |
 * | 알림 (토스트 · OS 알림) | 임계 시간을 넘긴 명령이 **안 보이는 자리**에서 끝났을 때 | [`shouldNotifyFinish`] |
 * | 거터 표식 (`3.5초`) | **오래 걸린** 블록만 (`mark_after_secs` 이상) | [`blockOutcomeLabel`] |
 *
 * 문구를 만드는 자리는 **[`blockOutcomeLabel`] 하나**다 — 표식도 알림도 말풍선도 거기서
 * 나온 토막을 쓴다.
 *
 * 룬도 DOM 도 Tauri 도 없다 — 값을 받아 값을 준다. 실제로 토스트를 띄우고 OS 알림 권한을
 * 묻는 쪽은 `app/finish-notify.ts` 이고, 데코레이션을 그리는 쪽은 `shell-integration.ts` 다.
 * 그래서 이 파일은 vitest 로 그대로 돈다 (`finish-notify.test.ts`).
 *
 * **블록을 통째로 받지 않는 이유**: `CommandBlock` 을 인자 타입으로 쓰면 이 모듈이
 * `block-history` 를 알게 되고, 그쪽이 표식 문구를 쓰고 싶어지면 곧바로 순환이다. 필요한
 * 것은 숫자 몇 개뿐이라 **필드로 받는다**.
 *
 * ## 문구는 `tr` 로 들어온다
 *
 * 같은 이유로 **사전도 들여오지 않는다** — `i18n.svelte.ts` 는 룬 모듈이라 vitest 가 이
 * 파일을 그대로 돌릴 수 없게 만든다. 그래서 문구를 내는 함수를 **인자로 받는다**: 화면
 * 쪽은 `t` 를 그대로 넘기고, 테스트는 `dict.ts` 의 `translate` 로 만든 한 줄을 넘긴다.
 */

import type { Key } from "$lib/i18n/keys";

/** 문구 하나를 내는 함수 — 화면 쪽은 `t` 를 그대로 넘긴다 (`i18n/ko/pane.ts` 머리말) */
export type Tr = (key: Key, params?: Record<string, string | number>) => string;

// ---------------------------------------------------------------------------
// 얼마나 걸렸나 — 사람이 읽는 한 토막
// ---------------------------------------------------------------------------

/** 두 자리로 맞춘다 (`3분 05초` 의 `05`) — 자릿수가 흔들리면 목록에서 눈이 튄다 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * 걸린 시간 → 한 토막 — **자릿수는 언제나 셋 이하**다 (`0.8초` · `12.4초` · `3분 05초` ·
 * `1시간 02분`).
 *
 * 단위가 올라갈수록 아래 자리를 버리는 것이 요점이다: 1분이 넘는 명령에서 0.1초는 아무도
 * 읽지 않고, 1시간이 넘으면 초는 잡음이다. 경계는 **정확히 한 번만** 판정한다 —
 * `59.96초` 를 `60.0초` 로 적었다가 다음 프레임에 `1분 00초` 가 되는 식의 어긋남이 없게,
 * 반올림한 값으로 경계를 본다.
 *
 * 음수(시계가 뒤로 갔다)는 0 으로 읽는다 — 없는 정보를 지어내지 않되 화면이 `-3.2초` 로
 * 깨지지도 않게.
 */
export function formatDuration(ms: number, tr: Tr): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;

  // ① 1분 미만 — 0.1초 단위. 반올림 결과가 60.0초면 그건 이미 분이다.
  const tenths = Math.round(safe / 100);
  // 0.05초 미만은 `0.0초` 가 아니라 `0.1초 미만` — 걸린 것을 "안 걸렸다" 로 적지 않는다
  // (25ms 짜리 SSH 실행이 `0.0초` 로 찍혔다 · 2026-09-28 실기).
  if (tenths === 0) return tr("pane.block.duration.under");
  if (tenths < 600) {
    return tr("pane.block.duration.seconds", { n: `${Math.floor(tenths / 10)}.${tenths % 10}` });
  }

  // ② 1시간 미만 — 초 단위.
  const secs = Math.round(safe / 1000);
  if (secs < 3600) {
    return tr("pane.block.duration.minutes", { m: Math.floor(secs / 60), s: pad2(secs % 60) });
  }

  // ③ 그 이상 — 분 단위 (초는 잡음이다).
  const mins = Math.round(safe / 60_000);
  return tr("pane.block.duration.hours", { h: Math.floor(mins / 60), m: pad2(mins % 60) });
}

// ---------------------------------------------------------------------------
// 알릴 것인가, 무엇으로 알릴 것인가
// ---------------------------------------------------------------------------

/**
 * 알림의 **결말** 세 갈래.
 *
 * - `"none"` — 알리지 않는다. 짧은 명령이거나, **화면이 이미 그 사실을 말하고 있다**.
 * - `"toast"` — 창 안 토스트. 사용자는 이 창을 보고 있지만 그 타일은 다른 탭에 있다.
 * - `"os"` — OS 알림. 창이 포커스를 잃었거나 최소화됐다 — 앱 안에 띄워 봐야 아무도 못 본다.
 */
export type FinishNotify = "none" | "toast" | "os";

/** [`shouldNotifyFinish`] 가 보는 네 가지 */
export interface FinishNotifyInput {
  /** 명령이 걸린 시간(ms) — `endedAt - startedAt` */
  durationMs: number;
  /** `[terminal] notify_after_secs`. `0` 이하 = **끔** */
  thresholdSecs: number;
  /** 이 창이 지금 포커스를 쥐고 있는가 (최소화는 `false`) */
  windowFocused: boolean;
  /** 그 타일이 **지금 보이는 탭**에 있는가 */
  tileVisible: boolean;
}

/**
 * 끝난 명령 하나를 무엇으로 알릴 것인가 — **표 하나가 전부**다.
 *
 * | 창 포커스 | 타일이 보이나 | 결과 | 왜 |
 * | --- | --- | --- | --- |
 * | 있다 | 보인다 | `none` | **화면이 이미 말했다.** 눈앞에서 끝난 것을 다시 알리면 잡음이다 |
 * | 있다 | 안 보인다 (다른 탭) | `toast` | 이 창을 보고 있으니 창 안에서 말하면 읽힌다 |
 * | 없다 | (무관) | `os` | 앱 안에 띄워 봐야 아무도 못 본다 |
 *
 * 창이 포커스를 잃었으면 타일이 보이든 말든 `os` 다 — "보인다" 는 **그리고 있다**는 뜻이지
 * 사람이 보고 있다는 뜻이 아니다 (다른 창에 가려져 있을 수도, 최소화됐을 수도 있다).
 *
 * 임계 시간은 **넘거나 같으면** 친다(`>=`) — 10초로 맞춰 둔 사람에게 정확히 10.0초짜리
 * 명령이 조용한 것은 설명하기 어렵다.
 */
export function shouldNotifyFinish(input: FinishNotifyInput): FinishNotify {
  const { durationMs, thresholdSecs, windowFocused, tileVisible } = input;
  if (!Number.isFinite(thresholdSecs) || thresholdSecs <= 0) return "none"; // 끔
  if (!Number.isFinite(durationMs) || durationMs < thresholdSecs * 1000) return "none";
  if (!windowFocused) return "os";
  return tileVisible ? "none" : "toast";
}

// ---------------------------------------------------------------------------
// 문구 — 알림 한 줄과 거터 표식 한 토막
// ---------------------------------------------------------------------------

/** 알림에 싣는 명령문의 최대 글자 수. 넘으면 뒤를 `…` 로 접는다 */
export const FINISH_COMMAND_CHARS = 40;

/**
 * 명령문을 알림 한 줄에 들어갈 크기로 접는다 — **줄바꿈은 공백으로** 편다.
 *
 * 여러 줄 명령(히어독·붙여넣기)이 그대로 들어오면 토스트 한 칸이 문단이 된다. 정확한
 * 명령은 타일 안에 그대로 있으므로 여기서는 "무엇이 끝났는지 알아볼 만큼"이면 된다.
 */
export function shortCommand(commandLine: string, max = FINISH_COMMAND_CHARS): string {
  const flat = commandLine.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

// ---------------------------------------------------------------------------
// 끝난 블록 하나의 문구 — **여기 하나**에서 나온다
// ---------------------------------------------------------------------------

/** [`blockOutcomeLabel`] 이 보는 것 — 숫자 셋이 전부다 */
export interface BlockOutcome {
  /** 걸린 시간(ms). `null` = 아직 안 끝났다 → 표식 없음 */
  durationMs: number | null;
  /** 종료 코드. `null` = 못 읽었다 (성공으로 읽되 코드를 말하지 않는다) */
  exit: number | null;
  /**
   * 표식을 다는 하한(초) — `[terminal] mark_after_secs`. `0` 이하 = **끔**.
   *
   * 없으면 `0`(끔)으로 읽는다. 표식이 필요 없는 부름
   * ([`finishMessage`]·[`blockMarkTitle`] 은 `toast`·`tooltipHead` 만 쓴다)이 임계를
   * 몰라도 되도록 **선택 인자**로 둔다 — 그쪽에서 임의의 기본값을 지어내면 이 모듈에
   * 임계가 두 벌 생긴다.
   */
  markAfterSecs?: number;
}

/** [`blockOutcomeLabel`] 이 주는 세 토막 */
export interface BlockOutcomeLabel {
  /** 거터 표식. 붙일 것이 없으면 `null` (임계 미만 · 임계 끔 · 아직 안 끝남) */
  mark: string | null;
  /** 알림 본문의 **뒤 토막** — 앞에 `"명령문"` 을 붙이면 한 줄이 된다 ([`finishMessage`]) */
  toast: string;
  /** 말풍선 **첫 줄**(종료 코드를 풀어 적는다). 코드를 못 읽었으면 빈 문자열 = 줄 없음 */
  tooltipHead: string;
}

/**
 * 끝난 블록 하나를 사람의 말로 — **세 표면이 같은 사실을 같은 낱말로** 말하게 하는 자리.
 *
 * ## `exit` 라는 낱말을 화면에서 뺀다 (2026-09-16)
 *
 * 처음 판은 `12.4초 · exit 0` 을 그대로 적었다. 그런데 **종료 코드가 무엇인지 아는 사람이
 * 적다** — `exit 0` 은 성공인데 `0` 이라는 숫자는 사람에게 "없음" 으로 읽히고, `exit 1`
 * 옆에 아무 낱말이 없으면 그게 나쁜 소식인지조차 알 수 없다. 그래서 화면에는 **성패를
 * 낱말로만** 적고, 숫자는 **말풍선 안으로** 옮겼다(`종료 코드 3 — 0 이면 성공, 아니면 실패`).
 *
 * ## 표식은 **시간 하나뿐**이다 (같은 날 다시 고침)
 *
 * 그러고도 `실패` 라는 낱말이 남아 있었다. 그런데 실패한 명령의 줄에는 **이미 붉은 띠**가
 * 서 있어서(거터 세로선 + 줄 배경), 그 옆에 `실패` 를 또 적는 것은 같은 사실의 세 번째
 * 반복이다. 그래서 표식이 적는 것은 **걸린 시간 한 토막**이고, 성패는 **색**이 말한다
 * (실패는 붉은 시간, 성공은 흐린 시간). 낱말이 사라진 자리를 색이 이미 채우고 있었다.
 *
 * 하한도 함께 올라간다. `1초` 는 `npm run …` 이 흔히 넘는 시간이라 화면 오른쪽에 숫자가
 * 줄줄이 섰다 — 이제 **사람이 정하고**(`mark_after_secs`, 기본 3초) 그 미만은 성패와
 * 무관하게 **아무것도 안 붙는다**. 짧게 죽은 명령도 붉은 띠가 이미 말하고 있다.
 *
 * | 걸린 시간 | 종료 코드 | 표식 (`mark`) |
 * | --- | --- | --- |
 * | 임계 이상 | 0 (또는 못 읽음) | `3.5초` (흐리게) |
 * | 임계 이상 | 0 아님 | `3.5초` (실패색) |
 * | 임계 미만 | (무관) | *(없음)* — 붉은 띠가 말한다 |
 * | 임계가 `0`(끔) · 아직 안 끝남 | — | *(없음)* |
 *
 * 알림(`toast`)은 표식보다 한 마디 더 쓴다 — 화면에서 떨어져 나와 혼자 서는 글이라
 * "끝났다" 를 말해 줘야 하고(`끝남 · 2.0초`), 성패를 말할 색도 띠도 없어 **낱말로**
 * 말해야 하며(`실패`), 되짚을 단서인 코드는 괄호로 싣는다(`실패 · 2.0초 (코드 3)`).
 * 표식과 갈리는 것이 아니라 **말풍선이 없는 표면이라 더 적는 것**이다.
 */
export function blockOutcomeLabel(input: BlockOutcome, tr: Tr): BlockOutcomeLabel {
  const { durationMs, exit, markAfterSecs = 0 } = input;
  const ms = durationMs !== null && Number.isFinite(durationMs) ? durationMs : null;
  const failed = exit !== null && exit !== 0;
  const took = formatDuration(ms ?? 0, tr);
  // 임계는 **넘거나 같으면** 친다(`>=`) — `shouldNotifyFinish` 와 같은 규칙이다.
  const long =
    ms !== null &&
    Number.isFinite(markAfterSecs) &&
    markAfterSecs > 0 &&
    ms >= markAfterSecs * 1000;

  const mark = long ? took : null;
  const toast = failed
    ? tr("pane.block.toast.fail", { took, exit: exit ?? 0 })
    : tr("pane.block.toast.ok", { took });
  const tooltipHead =
    exit === null
      ? ""
      : exit === 0
        ? tr("pane.block.exit.ok")
        : tr("pane.block.exit.fail", { exit });

  return { mark, toast, tooltipHead };
}

/** [`finishMessage`] 가 보는 것 */
export interface FinishMessageInput {
  commandLine: string;
  durationMs: number;
  /** 종료 코드. `null` = 못 읽었다 (그때는 코드 토막을 아예 붙이지 않는다) */
  exit: number | null;
}

/**
 * 알림 본문 한 줄 — `"npm run build" 끝남 · 1분 12초` · `"make" 실패 · 3분 05초 (코드 1)`.
 *
 * 실패는 **낱말로** 먼저 말한다(`끝남` → `실패`). 숫자만으로 성패를 읽게 하면 `1` 과 `0`
 * 이 한 글자 차이라 OS 알림의 작은 글씨에서 놓친다 — 그래서 코드는 **뒤에 괄호로** 따라온다.
 */
export function finishMessage(input: FinishMessageInput, tr: Tr): string {
  const { commandLine, durationMs, exit } = input;
  const { toast } = blockOutcomeLabel({ durationMs, exit }, tr);
  return tr("pane.block.notify", { command: shortCommand(commandLine), outcome: toast });
}

/** [`blockMarkTitle`] 이 보는 것 */
export interface BlockMarkTitleInput {
  commandLine: string;
  /** `C` 를 본 시각 (epoch ms) */
  startedAt: number;
  /** `D` 를 본 시각 (epoch ms). `null` = 아직 실행 중 */
  endedAt: number | null;
  /** `D;n` 의 종료 코드. `null` = 못 읽었다 → 코드 줄을 안 적는다 */
  exit: number | null;
}

/**
 * 끝난 블록의 말풍선 — **종료 코드**(풀어 적은 한 줄) · 시작·끝 **로컬 시각** ·
 * **명령문 전문**.
 *
 * 화면에 선 것은 색과 시간뿐이라 "왜 그렇게 끝났나" · "언제" · "무엇을" 이 빠져 있다.
 * 스크롤백을 훑다 붉은 줄을 보고 그 자리에서 알아야 할 것이 그 셋이다.
 * **숫자로 된 종료 코드가 사는 유일한 자리**가 여기다 (`blockOutcomeLabel` 의 주석 참고).
 *
 * 거는 자리는 **둘**이다: 실패의 **붉은 띠**와 (있다면) 시간 표식. 띠 쪽이 본체다 —
 * 짧게 죽은 명령에는 표식이 아예 없으므로, 말풍선이 표식에만 붙어 있으면 **종료 코드를
 * 볼 길이 사라진다**. 둘 다 같은 문자열을 쓴다(한 사실을 두 자리에서 다르게 적지 않는다).
 *
 * `title` 속성으로 나가므로 줄바꿈은 `\n` 이다. 이 말풍선만은 **네이티브**로 남는다 —
 * 앱 툴팁 층은 `.xterm` 안쪽을 일부러 건드리지 않는다
 * (docs/log/2026-09-16-themed-tooltips.md 의 "빠져나가는 문").
 */
export function blockMarkTitle(input: BlockMarkTitleInput, tr: Tr): string {
  const { commandLine, startedAt, endedAt, exit } = input;
  const at = (ms: number) => new Date(ms).toLocaleTimeString();
  const when =
    endedAt === null
      ? tr("pane.block.when.started", { at: at(startedAt) })
      : tr("pane.block.when.range", { from: at(startedAt), to: at(endedAt) });
  const { tooltipHead } = blockOutcomeLabel(
    { durationMs: endedAt === null ? null : endedAt - startedAt, exit },
    tr,
  );
  return [tooltipHead, when, commandLine.trim()].filter((line) => line !== "").join("\n");
}
