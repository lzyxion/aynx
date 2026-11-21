// 설정 › 트리거 추가 · 편집 폼 · 시험 칸 — 순수 함수만.
// 매치는 새로 구현하지 않는다 — 터미널과 같은 엔진(`$lib/triggers`)을 불러야 실제 터미널에서 걸리는 모양과 어긋나지 않는다.
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

/** 종류(하이라이트 · 링크 · 툴팁)는 따로 두지 않는다 — 저장 규칙과 같이 칸에 값이 있으면 켜진 것이다. */
export interface TriggerForm {
  pattern: string;
  fg: string | null;
  bg: string | null;
  url: string;
  tooltip: string;
}

/** 배경 하나로 시작한다 — 배경만 칠하는 쪽이 글자를 덮어 그리지 않아 늘 더 정확하다. */
export function emptyTriggerForm(): TriggerForm {
  return { pattern: "", fg: null, bg: DEFAULT_TRIGGER_BG, url: "", tooltip: "" };
}

export function triggerToForm(t: Trigger): TriggerForm {
  return {
    pattern: t.pattern,
    fg: nonEmpty(t.fg),
    bg: nonEmpty(t.bg),
    url: t.url ?? "",
    tooltip: t.tooltip ?? "",
  };
}

export function exampleToForm(ex: TriggerExample): TriggerForm {
  return triggerToForm(exampleTrigger(ex));
}

/** 빈 칸은 키째 뺀다(파일에는 "값이 있으면 켬" 만 남는다). 툴팁은 공백만 있을 때만 뺀다(가운데 공백은 그대로). */
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

export type PatternError = { code: "empty" } | { code: "regex"; message: string };

/** 저장은 막지 않는다 — 눌러 봐야 열리지 않는다는 것만 미리 말한다. */
export type UrlWarning = { code: "invalid" } | { code: "scheme"; scheme: string };

export function patternError(pattern: string): PatternError | null {
  const p = pattern.trim();
  if (p === "") return { code: "empty" };
  const { errors } = compileTriggers([{ pattern: p, enabled: true }]);
  return errors.length > 0 ? { code: "regex", message: errors[0].message } : null;
}

/** 캡처는 실행 시점에 정해지므로 `$1` 자리를 아무 글자로 메워 엔진의 안전 검사(`safeUrl`)를 통과하는지 본다. */
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

export function isInert(form: TriggerForm): boolean {
  return !nonEmpty(form.fg) && !nonEmpty(form.bg) && form.url.trim() === "" && form.tooltip.trim() === "";
}

export function canSaveForm(form: TriggerForm): boolean {
  return patternError(form.pattern) === null;
}

// ── 시험 칸 ──

export interface TestPiece {
  text: string;
  hit?: {
    fg: string | null;
    /** 터미널처럼 반투명(`translucent`)으로 바꾼 값 */
    bg: string;
    /** 터미널의 Ctrl+클릭이 실제로 여는 주소 — 못 열면 `null` */
    url: string | null;
    urlBlocked: boolean;
    tooltip: string | null;
  };
}

export interface TestResult {
  lines: TestPiece[][];
  hits: number;
  truncated: boolean;
}

export const TEST_MAX_LINES = 50;

/** 링크 · 툴팁은 터미널의 링크 프로바이더와 같은 순서(치환 + 인코딩 → `safeUrl`)로 만든다. */
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
