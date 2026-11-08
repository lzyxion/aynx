// 설정 › 트리거의 **추가 · 편집 하위 화면** 폼 ↔ 트리거 변환 · 입력 검증 · 시험 칸 결과 — 순수 함수만
// (docs/log/2026-10-05-trigger-examples.md "하위 화면으로"). 화면은 `settings/TriggerEditor.svelte` · `TriggerTester.svelte`.
//
// **매치는 새로 구현하지 않는다** — 시험 칸은 터미널과 같은 엔진(`$lib/triggers` 의 `compileTriggers` · `matchLine` ·
// `expandTemplate` · `safeUrl` · `translucent`)을 그대로 불러, 실제 터미널에서 걸리는 모양과 어긋날 틈을 두지 않는다.
import {
  compileTriggers,
  expandTemplate,
  matchLine,
  safeUrl,
  translucent,
  type Trigger,
} from "$lib/triggers";
import { exampleTrigger, type TriggerExample } from "./example-triggers";
import { DEFAULT_TRIGGER_BG } from "./options";

/**
 * 폼의 칸들. **종류(하이라이트 · 링크 · 툴팁)는 따로 두지 않는다** — 저장 규칙과 같이 칸에 값이 있으면 켜진 것이다
 * (색 둘 다 없음 = 하이라이트 없음, 링크 · 툴팁 칸이 비면 그 종류 없음).
 */
export interface TriggerForm {
  pattern: string;
  /** 글자색 — `null` = 안 씀(원래 색 그대로) */
  fg: string | null;
  /** 배경색 — `null` = 안 씀 */
  bg: string | null;
  /** 링크 URL 템플릿 — 빈칸 = 링크 아님 */
  url: string;
  /** 툴팁 문구 템플릿 — 빈칸 = 툴팁 없음 */
  tooltip: string;
}

/** 빈 트리거 — 배경 하나로 시작한다(배경만 칠하는 쪽이 글자를 덮어 그리지 않아 늘 더 정확하다). */
export function emptyTriggerForm(): TriggerForm {
  return { pattern: "", fg: null, bg: DEFAULT_TRIGGER_BG, url: "", tooltip: "" };
}

/** 저장된 트리거 → 폼 */
export function triggerToForm(t: Trigger): TriggerForm {
  return {
    pattern: t.pattern,
    fg: nonEmpty(t.fg),
    bg: nonEmpty(t.bg),
    url: t.url ?? "",
    tooltip: t.tooltip ?? "",
  };
}

/** 예시 → 폼 (예시 카드를 고르면 규칙 칸이 이것으로 채워진다) */
export function exampleToForm(ex: TriggerExample): TriggerForm {
  return triggerToForm(exampleTrigger(ex));
}

/**
 * 폼 → 저장할 트리거. 패턴 · 링크는 앞뒤 공백을 떼고, 빈 칸은 키째 뺀다(파일에는 "값이 있으면 켬" 만 남는다).
 * 툴팁은 사람이 읽는 글이라 공백만 있을 때만 뺀다(가운데 공백은 그대로).
 */
export function formToTrigger(form: TriggerForm, enabled: boolean): Trigger {
  const t: Trigger = { pattern: form.pattern.trim(), enabled };
  const fg = nonEmpty(form.fg);
  const bg = nonEmpty(form.bg);
  if (fg) t.fg = fg;
  if (bg) t.bg = bg;
  const url = form.url.trim();
  if (url !== "") t.url = url;
  if (form.tooltip.trim() !== "") t.tooltip = form.tooltip;
  return t;
}

/** 패턴 칸의 문제 — 빈칸이거나, 엔진이 컴파일하지 못한다(`message` 는 정규식 엔진이 준 글자 그대로). */
export type PatternError = { code: "empty" } | { code: "regex"; message: string };

/** 링크 칸의 경고 — 저장은 막지 않는다(눌러 봐야 열리지 않는다는 것만 미리 말한다). */
export type UrlWarning = { code: "invalid" } | { code: "scheme"; scheme: string };

/** 패턴 검증 — 터미널과 같은 컴파일(`compileTriggers`)에 맡긴다. 문제가 없으면 `null`. */
export function patternError(pattern: string): PatternError | null {
  const p = pattern.trim();
  if (p === "") return { code: "empty" };
  const { errors } = compileTriggers([{ pattern: p, enabled: true }]);
  return errors.length > 0 ? { code: "regex", message: errors[0].message } : null;
}

/**
 * URL 템플릿이 **열릴 수 있는 모양인가** — 캡처는 실행 시점에 정해지므로 `$1` 자리를 아무 글자로 메워 보고, 엔진의
 * 안전 검사(`safeUrl`)를 그대로 통과하는지 본다. 빈칸은 경고가 아니다(아직 안 적음 = 링크 아님).
 */
export function urlWarning(template: string): UrlWarning | null {
  const filled = template.trim().replace(/\$(\$|\d{1,2})/g, "x");
  if (filled === "") return null;
  if (safeUrl(filled) !== null) return null;
  try {
    return { code: "scheme", scheme: new URL(filled).protocol };
  } catch {
    return { code: "invalid" };
  }
}

/** 폼이 아무 종류도 켜지 않았는가 — 오류는 아니지만 "아무 일도 하지 않는다" 를 알린다. */
export function isInert(form: TriggerForm): boolean {
  return !nonEmpty(form.fg) && !nonEmpty(form.bg) && form.url.trim() === "" && form.tooltip.trim() === "";
}

/** 지금 폼을 저장할 수 있는가 — 패턴만 본다(링크 경고 · 종류 없음은 막지 않는다). */
export function canSaveForm(form: TriggerForm): boolean {
  return patternError(form.pattern) === null;
}

// ---------------------------------------------------------------------------
// 시험 칸
// ---------------------------------------------------------------------------

/** 시험 칸의 한 조각 — 맞지 않은 글자는 `hit` 없이, 맞은 구간은 터미널이 보여 줄 모양과 함께 */
export interface TestPiece {
  text: string;
  hit?: {
    /** 글자색 (터미널처럼 불투명) */
    fg: string | null;
    /** 배경 — 터미널처럼 반투명(`translucent`)으로 바꾼 값. 없으면 빈 글자 */
    bg: string;
    /** 치환 + 인코딩 + 안전 검사를 거친 링크 — 터미널의 Ctrl+클릭이 실제로 여는 주소. 못 열면 `null` */
    url: string | null;
    /** 링크 템플릿은 있는데 안전 검사에 걸렸다(`url` 이 `null` 인 이유) */
    urlBlocked: boolean;
    /** 치환한 툴팁 문구 (없으면 `null`) */
    tooltip: string | null;
  };
}

export interface TestResult {
  /** 줄마다 조각들 — 줄 순서 그대로 */
  lines: TestPiece[][];
  /** 맞은 구간 수 (모든 줄 합) */
  hits: number;
  /** 줄이 너무 많아 뒤를 잘랐는가 */
  truncated: boolean;
}

/** 시험 칸이 보는 최대 줄 수 — 붙여 넣은 로그가 길어도 설정 화면이 무거워지지 않게 */
export const TEST_MAX_LINES = 50;

/**
 * 시험 칸 결과 — 폼이 뜻하는 트리거 **하나만**(켠 채로) 컴파일해 줄마다 `matchLine` 을 돌리고, 링크 · 툴팁은
 * 터미널의 링크 프로바이더와 같은 순서(치환 + 인코딩 → `safeUrl`)로 만든다. 패턴이 틀렸으면 맞은 곳 없이 글자만.
 */
export function testTrigger(form: TriggerForm, text: string): TestResult {
  const all = text.replace(/\r\n?/g, "\n").split("\n");
  const truncated = all.length > TEST_MAX_LINES;
  const rows = truncated ? all.slice(0, TEST_MAX_LINES) : all;
  const { compiled } = canSaveForm(form)
    ? compileTriggers([formToTrigger(form, true)])
    : { compiled: [] };

  let hits = 0;
  const lines = rows.map((line) => {
    const out: TestPiece[] = [];
    let at = 0;
    for (const m of matchLine(line, compiled)) {
      if (m.start > at) out.push({ text: line.slice(at, m.start) });
      const rawUrl = m.url && m.groups ? expandTemplate(m.url, m.groups, true) : null;
      const url = rawUrl === null ? null : safeUrl(rawUrl);
      out.push({
        text: line.slice(m.start, m.end),
        hit: {
          fg: m.fg,
          bg: translucent(m.bg),
          url,
          urlBlocked: rawUrl !== null && url === null,
          tooltip: m.tooltip && m.groups ? expandTemplate(m.tooltip, m.groups, false) : null,
        },
      });
      at = m.end;
      hits++;
    }
    if (at < line.length) out.push({ text: line.slice(at) });
    return out;
  });
  return { lines, hits, truncated };
}

function nonEmpty(v: string | null | undefined): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
