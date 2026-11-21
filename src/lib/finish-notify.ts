/**
 * 끝난 명령의 문구 · 알림 규칙 — 순수 모듈. 문구를 만드는 자리는 `blockOutcomeLabel` 하나다(표식 · 알림 · 말풍선이 갈라지지 않게).
 * 사전을 들여오지 않는다 — `i18n.svelte.ts` 는 룬 모듈이라 vitest 가 이 파일을 못 돌린다. 문구는 `tr` 인자로 받는다.
 */

import type { Key } from "$lib/i18n/keys";

export type Tr = (key: Key, params?: Record<string, string | number>) => string;

// ── 걸린 시간 ──

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/** 경계는 반올림한 값으로 본다 — `59.96초` 가 `60.0초` 로 적히지 않게 */
export function formatDuration(ms: number, tr: Tr): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;

  const tenths = Math.round(safe / 100);
  if (tenths === 0) return tr("pane.block.duration.under");
  if (tenths < 600) {
    return tr("pane.block.duration.seconds", { n: `${Math.floor(tenths / 10)}.${tenths % 10}` });
  }

  const secs = Math.round(safe / 1000);
  if (secs < 3600) {
    return tr("pane.block.duration.minutes", { m: Math.floor(secs / 60), s: pad2(secs % 60) });
  }

  const mins = Math.round(safe / 60_000);
  return tr("pane.block.duration.hours", { h: Math.floor(mins / 60), m: pad2(mins % 60) });
}

// ── 알릴 것인가 ──

export type FinishNotify = "none" | "toast" | "os";

export interface FinishNotifyInput {
  durationMs: number;
  /** `[terminal] notify_after_secs`. `0` 이하 = 끔 */
  thresholdSecs: number;
  /** 최소화는 `false` */
  windowFocused: boolean;
  tileVisible: boolean;
}

/** 창 포커스가 없으면 타일이 보여도 `os` 다 — "보인다" 는 그리고 있다는 뜻일 뿐이다 */
export function shouldNotifyFinish(input: FinishNotifyInput): FinishNotify {
  const { durationMs, thresholdSecs, windowFocused, tileVisible } = input;
  if (!Number.isFinite(thresholdSecs) || thresholdSecs <= 0) return "none"; // 끔
  if (!Number.isFinite(durationMs) || durationMs < thresholdSecs * 1000) return "none";
  if (!windowFocused) return "os";
  return tileVisible ? "none" : "toast";
}

// ── 문구 ──

export const FINISH_COMMAND_CHARS = 40;

export function shortCommand(commandLine: string, max = FINISH_COMMAND_CHARS): string {
  const flat = commandLine.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

export interface BlockOutcome {
  /** `null` = 아직 안 끝났다 → 표식 없음 */
  durationMs: number | null;
  /** `null` = 못 읽었다 (성공으로 읽되 코드를 말하지 않는다) */
  exit: number | null;
  /** `[terminal] mark_after_secs`. 없거나 `0` 이하 = 끔 — 부르는 쪽이 기본값을 지어내면 임계가 두 벌 생긴다 */
  markAfterSecs?: number;
}

export interface BlockOutcomeLabel {
  mark: string | null;
  toast: string;
  /** 코드를 못 읽었으면 빈 문자열 = 줄 없음 */
  tooltipHead: string;
}

/** 표식은 걸린 시간 하나뿐이다 — 성패는 붉은 띠 · 색이 말한다. 숫자 종료 코드는 말풍선(`blockMarkTitle`)에만 */
export function blockOutcomeLabel(input: BlockOutcome, tr: Tr): BlockOutcomeLabel {
  const { durationMs, exit, markAfterSecs = 0 } = input;
  const ms = durationMs !== null && Number.isFinite(durationMs) ? durationMs : null;
  const failed = exit !== null && exit !== 0;
  const took = formatDuration(ms ?? 0, tr);
  // `>=` — `shouldNotifyFinish` 와 같은 규칙이다
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

export interface FinishMessageInput {
  commandLine: string;
  durationMs: number;
  /** `null` = 못 읽었다 (코드 토막을 붙이지 않는다) */
  exit: number | null;
}

export function finishMessage(input: FinishMessageInput, tr: Tr): string {
  const { commandLine, durationMs, exit } = input;
  const { toast } = blockOutcomeLabel({ durationMs, exit }, tr);
  return tr("pane.block.notify", { command: shortCommand(commandLine), outcome: toast });
}

export interface BlockMarkTitleInput {
  commandLine: string;
  /** `C` 를 본 시각 (epoch ms) */
  startedAt: number;
  /** `D` 를 본 시각 (epoch ms). `null` = 아직 실행 중 */
  endedAt: number | null;
  /** `D;n` 의 종료 코드. `null` = 못 읽었다 */
  exit: number | null;
}

/**
 * 붉은 띠와 시간 표식이 같은 문자열을 쓴다 — 짧게 죽은 명령엔 표식이 없어 띠가 본체다.
 * `title` 속성(네이티브)으로 나간다 — 앱 툴팁 층은 `.xterm` 안쪽을 건드리지 않는다.
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
