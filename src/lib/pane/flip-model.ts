// AI 타일 대화 면의 모델 키워드 — 표시 글자와, 메뉴에서 고른 것을 그 타일 터미널에 보낼 고정 줄.
// 한계: 기록에는 실제로 쓴 값만 있어 사람이 고정한 값인지 모델 기본값인지 가를 수 없다 — 메뉴의 Default 줄 · 고리는 기록으로 고르지 않는다.
// 불변식 4(AI 문자열→PTY 길은 없다): 보내는 줄은 이 파일의 고정 허용 목록 낱말로만 짓는다 — Codex slug 는 그 PC 의 모델 목록 원소,
// 단계는 상수로 바꿔 싣는다. 기록에서 읽은 모델 이름 · AI 출력은 표시와 비교에만 쓴다.
// Claude 의 `/model` · `/effort` 는 새 세션의 기본값도 바꾼다. Codex 는 모델만 보내면 강도가 들쭉날쭉이라 늘 `--reasoning=` 을 붙인다.
import { modelLabel, orderModels } from "$lib/model-order";

export const CLAUDE_MODEL_ALIASES: readonly string[] = orderModels(["fable", "opus", "sonnet", "haiku"]);

/** 대소문자 구분 — `Default` 는 거절된다 */
export const CLAUDE_MODEL_DEFAULT = "default";

export const CLAUDE_EFFORT_LEVELS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/** `/effort default` 는 거절된다 */
export const CLAUDE_EFFORT_AUTO = "auto";

export const CODEX_LEVELS: readonly string[] = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** 모델 목록을 모를 때(원격 Codex 타일 · 캐시 없음) — 지금 목록의 모든 모델이 받는 단계 */
export const CODEX_FALLBACK_LEVELS: readonly string[] = ["low", "medium", "high", "xhigh"];

export interface LastModel {
  model: string;
  effort?: string | null;
}

export interface CodexModelList {
  models: readonly string[];
  levels?: Readonly<Record<string, { levels: readonly string[]; default: string | null }>>;
}

function claudeParts(model: string): string[] {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[.*$/, "")
    .replace(/^claude-/, "")
    .split(/[-_]/)
    .filter((p) => p !== "");
}

export function claudeTierOf(model: string): string | null {
  return claudeParts(model).find((p) => CLAUDE_MODEL_ALIASES.includes(p)) ?? null;
}

/** 셸 줄에 실릴 값이라 좁게 */
export function codexSlugOk(slug: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,63}$/.test(slug);
}

export function codexMenuModels(list: CodexModelList | null): string[] {
  return orderModels((list?.models ?? []).filter(codexSlugOk));
}

export function codexLevelsFor(list: CodexModelList | null, model: string | null): readonly string[] {
  const info = model ? list?.levels?.[model] : undefined;
  if (!info || info.levels.length === 0) return CODEX_FALLBACK_LEVELS;
  return CODEX_LEVELS.filter((l) => info.levels.includes(l));
}

export function flipEffortLevels(cli: string, codex: CodexModelList | null = null, model: string | null = null): readonly string[] {
  return cli === "claude" ? CLAUDE_EFFORT_LEVELS : cli === "codex" ? codexLevelsFor(codex, model) : [];
}

export function slashModelLine(alias: string): string | null {
  return alias === CLAUDE_MODEL_DEFAULT || CLAUDE_MODEL_ALIASES.includes(alias) ? `/model ${alias}` : null;
}

/** 빈 글(게이지의 Default 고리) = `auto` */
export function slashEffortLine(level: string): string | null {
  if (level === "" || level === CLAUDE_EFFORT_AUTO) return `/effort ${CLAUDE_EFFORT_AUTO}`;
  return CLAUDE_EFFORT_LEVELS.includes(level) ? `/effort ${level}` : null;
}

/** 기록에서 읽은 글자를 그대로 싣지 않고 목록의 상수를 돌려준다 */
function codexLevelConst(level: string | null | undefined): string | null {
  return CODEX_LEVELS.find((l) => l === level) ?? null;
}

export function codexReasoningFor(list: CodexModelList | null, slug: string, current: string | null | undefined): string {
  const info = list?.levels?.[slug];
  const accepts = (l: string | null) => l !== null && (!info || info.levels.length === 0 || info.levels.includes(l));
  const cur = codexLevelConst(current);
  if (accepts(cur)) return cur as string;
  const def = codexLevelConst(info?.default);
  if (def !== null && accepts(def)) return def;
  return "medium";
}

/** slug 는 넘어온 글자가 아니라 목록의 원소를 싣는다 */
export function codexModelLine(list: CodexModelList | null, slug: string, current: string | null | undefined): string | null {
  const own = codexMenuModels(list).find((m) => m === slug);
  if (own === undefined) return null;
  return `/model ${own} --reasoning=${codexReasoningFor(list, own, current)}`;
}

export function codexEffortLine(level: string): string | null {
  const l = codexLevelConst(level);
  return l === null ? null : `/model --reasoning=${l}`;
}

/** 잠기면 `/model` 이 턴 가운데 끼지 않는다 */
export function flipModelLocked(s: { status: string | null; cards: number; tuiAsking: boolean }): boolean {
  return s.status === "running" || s.status === "permission" || s.cards > 0 || s.tuiAsking;
}

export interface InputRun {
  text: string;
  dim: boolean;
}

const PROMPT_GLYPH: Readonly<Record<string, string>> = { claude: "❯", codex: "›" };

/**
 * TUI 입력 줄에 사람이 치다 만 글이 남았나 — 그 뒤에 `/model …` 을 치면 명령이 아니라 말이 된다.
 * 두 CLI 는 빈 입력 줄의 안내 글을 흐리게(SGR 2) 그린다. 입력 줄을 못 찾으면 `null`(부르는 쪽은 막지 않는다).
 */
export function tuiInputLeftover(cli: string, lines: readonly (readonly InputRun[])[]): boolean | null {
  const glyph = PROMPT_GLYPH[cli];
  if (!glyph) return null;
  for (let i = lines.length - 1; i >= 0; i--) {
    const runs = lines[i];
    const text = runs.map((r) => r.text).join("");
    if (!text.trimStart().startsWith(glyph)) continue;
    let seen = false;
    for (const r of runs) {
      let t = r.text;
      if (!seen) {
        const at = t.indexOf(glyph);
        if (at < 0) continue;
        seen = true;
        t = t.slice(at + glyph.length);
      }
      if (!r.dim && t.replace(/[\s ]/g, "") !== "") return true;
    }
    return false;
  }
  return null;
}

function plainText(runs: readonly InputRun[]): string {
  return runs.filter((r) => !r.dim).map((r) => r.text).join("");
}

/**
 * 보낸 줄이 입력 줄에 그대로 남았나 — 새로 뜬 Codex 는 첫 입력 묶음 뒤의 Enter 를 삼킨다. 참이면 부르는 쪽이 Enter 를 하나 더 보낸다.
 * 같을 때만 참이다 — 확실할 때만 더 보낸다.
 */
export function tuiInputHolds(cli: string, lines: readonly (readonly InputRun[])[], sent: string): boolean {
  const glyph = PROMPT_GLYPH[cli];
  const want = sent.replace(/[\s ]+/g, "");
  if (!glyph || want === "") return false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const row = lines[i].map((r) => r.text).join("");
    const at = row.indexOf(glyph);
    if (at < 0 || row.slice(0, at).trim() !== "") continue;
    let got = "";
    let seen = 0;
    for (const r of lines[i]) {
      const end = seen + r.text.length;
      const piece = end <= at + glyph.length ? "" : r.text.slice(Math.max(0, at + glyph.length - seen));
      seen = end;
      if (!r.dim) got += piece;
    }
    got = got.replace(/[\s ]+/g, "");
    for (let j = i + 1; j < lines.length && got.length < want.length; j++) got += plainText(lines[j]).replace(/[\s ]+/g, "");
    return got === want;
  }
  return false;
}
