// ---------------------------------------------------------------------------
// **AI 타일 대화 면의 모델 키워드**(2026-11-13 — 목업 E2 · E3 · E4 · 2026-11-14 메뉴 넓힘) — 순수 층. 입력 칸 오른쪽
// `[CLI 로고] 모델 [Effort 막대] ⌄` 의 글자와, 메뉴에서 고른 것을 그 타일 터미널에 보낼 **고정 줄**을 만든다.
//
// - **표시**: 값은 그 대화 기록의 마지막 답(`TranscriptPage.last` — Claude 답 줄의 `message.model` · `effort`, Codex `turn_context`).
//   Claude 의 전체 이름은 짧게(`claude-opus-5-5` → `Opus 5.5` — `claude-` 떼기 · 등급 첫 글자 대문자 · 버전 하이픈 → 점 · 날짜 꼬리 버림),
//   Codex 는 목록 줄과 같은 `modelLabel`. 메뉴로 바꾼 값은 **CLI 가 화면에 받았다고 알린 뒤에만** 곧바로 보인다(`flip-model-ack.ts` — 거절 · 시간 초과면 다음 답까지 기록 값).
//   **한계**: 기록에는 "실제로 쓴 값" 만 있다 — 사람이 고정한 값인지 모델 기본값인지(Claude `/effort auto` · `/model default` 뒤)는 기록만으로
//   가를 수 없다. 그래서 메뉴의 Default 줄 · 고리는 기록으로 고르지 않는다(Effort 를 아예 모를 때만 고리).
// - **보내기(불변식 4 "AI 문자열→PTY 길은 없다")**: 터미널로 가는 글은 **이 파일의 고정 허용 목록 낱말로만** 짓는다.
//   Claude = `/model <별칭|default>` · `/effort <단계|auto>`, Codex = `/model <slug> --reasoning=<단계>` · `/model --reasoning=<단계>`.
//   Codex slug 는 **그 PC 의 Codex 모델 목록(`codex_models` — Codex 가 받아 둔 캐시 파일)에 있는 값**이고 모양 검사도 거친다. 단계는 늘 아래
//   목록의 **상수**로 바꿔 싣는다(기록에서 읽은 강도 글자를 그대로 싣지 않는다). 기록에서 읽은 모델 이름(`last.model`)이나 AI 출력은 표시와
//   "목록의 어느 줄인가" 비교에만 쓴다 — 목록 밖의 값이면 줄이 `null` 이다. 보내는 문은 사람 입력 문(`TermActions.submitText` — 대화 면
//   보내기와 같은 길)이고, 그 누름은 사람이 메뉴에서 한 것이다.
// - 실측(Claude Code 2.1.323 · Codex 0.168.0, 따로 띄운 PTY): Claude 의 `/model sonnet` · `/effort high` · `/model default` · `/effort auto` 는
//   확인 화면 없이 곧바로 바뀌고 **새 세션의 기본값도 바꾼다**(`default` · `auto` 는 그 고정을 지운다 — `Default` · `/effort default` 는 거절).
//   Codex 의 `/model <slug> --reasoning=<단계>` 는 그 세션에만 곧바로(설정 파일은 그대로), `/model --reasoning=<단계>` 는 강도만. 모델만 보내면
//   강도가 들쭉날쭉이라 늘 `--reasoning=` 을 붙인다. 위치 인자(`/model x high`) · `/reasoning` · `/effort` 는 Codex 가 받지 않는다.
// - **TUI 입력 줄의 남은 글**: 대화 면 입력 칸의 글은 보낼 때 곧바로 친 글자 + Enter 로 나가 TUI 입력 줄에 남지 않는다. 사람이 터미널 면에서
//   치다 만 글은 남을 수 있다 — 그 뒤에 `/model …` 을 이어 치면 명령이 아니라 말이 된다. 두 CLI 는 빈 입력 줄의 안내 글을 흐리게(SGR 2)
//   그리고 친 글은 흐리지 않게 그린다(실측) — [`tuiInputLeftover`] 가 화면 아래쪽의 입력 줄에서 흐리지 않은 글을 찾는다.
// ---------------------------------------------------------------------------
import { modelLabel, orderModels } from "$lib/model-order";

/** Claude 의 모델 별칭(보내는 줄의 허용 목록) — 메뉴 순서는 `orderModels`(등급 순) */
export const CLAUDE_MODEL_ALIASES: readonly string[] = orderModels(["fable", "opus", "sonnet", "haiku"]);

/** Claude 의 "기본으로" 모델 낱말(`/model default` — 대소문자 구분 · 실측) */
export const CLAUDE_MODEL_DEFAULT = "default";

/** Claude 의 Effort 단계(`claude --help` 의 `--effort` 값 — 낮은 것부터 · 보내는 줄의 허용 목록) */
export const CLAUDE_EFFORT_LEVELS: readonly string[] = ["low", "medium", "high", "xhigh", "max"];

/** Claude 의 "기본으로" 강도 낱말(`/effort auto` — `/effort default` 는 거절 · 실측) */
export const CLAUDE_EFFORT_AUTO = "auto";

/** Codex 의 추론 단계(보내는 줄의 허용 목록 — 낮은 것부터). 모델마다 받는 것은 그 모델 목록이 다시 좁힌다 */
export const CODEX_LEVELS: readonly string[] = ["minimal", "low", "medium", "high", "xhigh", "max", "ultra"];

/** 모델 목록을 모를 때(원격 Codex 타일 · 캐시 없음) 게이지 칸 — 지금 목록의 모든 모델이 받는 단계 */
export const CODEX_FALLBACK_LEVELS: readonly string[] = ["low", "medium", "high", "xhigh"];

/** 마지막 답의 모델 · 강도(`TranscriptPage.last`) */
export interface LastModel {
  model: string;
  effort?: string | null;
}

/** Codex 모델 목록(`codex_models` — 그 PC 의 Codex 캐시) */
export interface CodexModelList {
  models: readonly string[];
  levels?: Readonly<Record<string, { levels: readonly string[]; default: string | null }>>;
}

/** 날짜 꼬리(`20250514`)부터는 버전이 아니다 */
const DATE_DIGITS = 8;

/** Claude 전체 이름의 조각 — `[1m]` 같은 꼬리 괄호 · `claude-` 머리는 뗀다 */
function claudeParts(model: string): string[] {
  return model
    .trim()
    .toLowerCase()
    .replace(/\[.*$/, "")
    .replace(/^claude-/, "")
    .split(/[-_]/)
    .filter((p) => p !== "");
}

/** Claude 모델의 등급 별칭(`claude-opus-5-5` → `opus`) — 허용 목록 밖이면 `null`. 메뉴의 ✓ 자리 */
export function claudeTierOf(model: string): string | null {
  return claudeParts(model).find((p) => CLAUDE_MODEL_ALIASES.includes(p)) ?? null;
}

/**
 * 키워드의 모델 글자. Claude: `claude-opus-5-5` → `Opus 5.5` · `claude-sonnet-4-5-20250929` → `Sonnet 4.5` · `opus` → `Opus`
 * (등급 낱말을 못 찾으면 `modelLabel`). Codex: `modelLabel`(`gpt-6-astra` → `GPT-6-astra`).
 */
export function flipModelLabel(cli: string, model: string): string {
  const m = model.trim();
  if (cli !== "claude" && !/^claude-/i.test(m)) return modelLabel(m);
  const parts = claudeParts(m);
  const tier = parts.find((p) => /^[a-z]+$/.test(p));
  if (!tier) return modelLabel(m);
  const version = parts.filter((p) => /^\d+$/.test(p) && p.length < DATE_DIGITS);
  const name = tier.charAt(0).toUpperCase() + tier.slice(1);
  return version.length > 0 ? `${name} ${version.join(".")}` : name;
}

/** Codex slug 모양 — 소문자 · 숫자 · `.` · `-` 만(셸 줄에 실릴 값이라 좁게 · 64자) */
export function codexSlugOk(slug: string): boolean {
  return /^[a-z0-9][a-z0-9.-]{0,63}$/.test(slug);
}

/** Codex 메뉴의 모델 줄 — 목록 중 모양이 맞는 것만 · `orderModels` 고정 순서 */
export function codexMenuModels(list: CodexModelList | null): string[] {
  return orderModels((list?.models ?? []).filter(codexSlugOk));
}

/** 그 Codex 모델이 받는 단계(허용 목록 안 · 낮은 것부터). 모르는 모델이면 대체 칸 */
export function codexLevelsFor(list: CodexModelList | null, model: string | null): readonly string[] {
  const info = model ? list?.levels?.[model] : undefined;
  if (!info || info.levels.length === 0) return CODEX_FALLBACK_LEVELS;
  return CODEX_LEVELS.filter((l) => info.levels.includes(l));
}

/** 키워드 막대의 칸(낮은 것부터) — CLI 마다. 모르는 CLI 는 없음 */
export function flipEffortLevels(cli: string, codex: CodexModelList | null = null, model: string | null = null): readonly string[] {
  return cli === "claude" ? CLAUDE_EFFORT_LEVELS : cli === "codex" ? codexLevelsFor(codex, model) : [];
}

/** 고른 Claude 모델 → 보낼 줄. **허용 목록 낱말만**(별칭 · `default` — 머리말 · 불변식 4) · 밖이면 `null` */
export function slashModelLine(alias: string): string | null {
  return alias === CLAUDE_MODEL_DEFAULT || CLAUDE_MODEL_ALIASES.includes(alias) ? `/model ${alias}` : null;
}

/** 고른 Claude 강도 → 보낼 줄. 빈 글(게이지의 Default 고리) = `auto`. **허용 목록 낱말만** · 밖이면 `null` */
export function slashEffortLine(level: string): string | null {
  if (level === "" || level === CLAUDE_EFFORT_AUTO) return `/effort ${CLAUDE_EFFORT_AUTO}`;
  return CLAUDE_EFFORT_LEVELS.includes(level) ? `/effort ${level}` : null;
}

/** 단계 글자 → 허용 목록의 **상수**(같은 글자면) — 기록에서 읽은 글자를 그대로 싣지 않는다 */
function codexLevelConst(level: string | null | undefined): string | null {
  return CODEX_LEVELS.find((l) => l === level) ?? null;
}

/**
 * Codex 모델을 고를 때 함께 보낼 단계 — 지금 강도(기록)가 그 모델이 받는 단계면 그것, 아니면 그 모델의 기본, 그것도 없으면 `medium`.
 * 돌려주는 것은 늘 [`CODEX_LEVELS`] 의 상수다.
 */
export function codexReasoningFor(list: CodexModelList | null, slug: string, current: string | null | undefined): string {
  const info = list?.levels?.[slug];
  const accepts = (l: string | null) => l !== null && (!info || info.levels.length === 0 || info.levels.includes(l));
  const cur = codexLevelConst(current);
  if (accepts(cur)) return cur as string;
  const def = codexLevelConst(info?.default);
  if (def !== null && accepts(def)) return def;
  return "medium";
}

/**
 * 고른 Codex 모델 → 보낼 줄(`/model <slug> --reasoning=<단계>`). slug 는 **그 모델 목록에 있는 값 · 모양이 맞는 값**만, 단계는 허용 목록의
 * 상수만 — 아니면 `null`(머리말 · 불변식 4). slug 는 목록의 원소를 싣는다(넘어온 글자가 아니라).
 */
export function codexModelLine(list: CodexModelList | null, slug: string, current: string | null | undefined): string | null {
  const own = codexMenuModels(list).find((m) => m === slug);
  if (own === undefined) return null;
  return `/model ${own} --reasoning=${codexReasoningFor(list, own, current)}`;
}

/** 고른 Codex 단계 → 보낼 줄(`/model --reasoning=<단계>` — 강도만). 허용 목록 밖이면 `null` */
export function codexEffortLine(level: string): string | null {
  const l = codexLevelConst(level);
  return l === null ? null : `/model --reasoning=${l}`;
}

/**
 * 키워드가 잠기는가 — 에이전트가 일하는 중 · 권한을 묻는 중(대화 면 [중지] · "터미널에서 답하기" 와 같은 출처: 훅 상태 · 권한 카드 ·
 * TUI 질문). 잠기면 흐리고 ⌄ 가 없다 — `/model` 이 턴 가운데 끼지 않게(목업 E4).
 */
export function flipModelLocked(s: { status: string | null; cards: number; tuiAsking: boolean }): boolean {
  return s.status === "running" || s.status === "permission" || s.cards > 0 || s.tuiAsking;
}

/** 화면 줄 하나의 토막(`screen-thumb` 의 `ThumbRun` 중 쓰는 것) */
export interface InputRun {
  text: string;
  dim: boolean;
}

/** 입력 줄의 머리 글리프 — Claude `❯` · Codex `›`(실측) */
const PROMPT_GLYPH: Readonly<Record<string, string>> = { claude: "❯", codex: "›" };

/**
 * TUI 입력 줄에 사람이 치다 만 글이 남았나 — 화면 줄들(위 → 아래)의 **맨 아래쪽 입력 줄**(그 CLI 의 글리프로 시작하는 마지막 줄)에서
 * 글리프 뒤에 **흐리지 않은** 글이 있으면 참. 빈 입력 줄의 안내 글은 두 CLI 모두 흐리게 그린다(실측 — SGR 2). 입력 줄을 못 찾으면 `null`
 * (모른다 — 부르는 쪽은 막지 않는다). 고르기 화면(Codex `› 2. …`)처럼 글리프 뒤에 흐리지 않은 글이 있는 화면도 참이다(그때 보내면 안 된다).
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

/** 줄 하나의 흐리지 않은 글 */
function plainText(runs: readonly InputRun[]): string {
  return runs.filter((r) => !r.dim).map((r) => r.text).join("");
}

/**
 * 보낸 한 줄이 **입력 줄에 그대로 남았나**(Enter 가 먹지 않았다) — 2026-11-14 실측(Codex 0.168 · 따로 띄운 PTY): 새로 뜬 Codex 는 **첫 입력 묶음**
 * 뒤의 Enter 를 삼킨다(글 뒤 200 · 400ms 모두 — 1초면 먹는다 · 사람이 먼저 한 번 쳤거나 둘째 묶음부터는 200ms 로 먹는다). 그러면 글이 입력 줄에
 * 남고, 다음 메뉴 누름은 "치다 만 글" 로 막혔다(판정은 맞다 — 글이 정말 남아 있었다). 부르는 쪽은 이것이 참이면 Enter 하나를 더 보낸다(고정 키 —
 * 화면 글자는 비교에만).
 *
 * 맨 아래쪽 입력 줄(그 CLI 의 글리프로 시작하는 마지막 줄)의 흐리지 않은 글이 보낸 글과 **같아야** 참이다(공백 무시 — 칸이 좁아 접힌 줄은 다음 줄들을
 * 보낸 글 길이만큼 이어 붙여 본다). 입력 줄을 못 찾거나 다르면 거짓 — 확실할 때만 더 보낸다.
 */
export function tuiInputHolds(cli: string, lines: readonly (readonly InputRun[])[], sent: string): boolean {
  const glyph = PROMPT_GLYPH[cli];
  const want = sent.replace(/[\s ]+/g, "");
  if (!glyph || want === "") return false;
  for (let i = lines.length - 1; i >= 0; i--) {
    const row = lines[i].map((r) => r.text).join("");
    const at = row.indexOf(glyph);
    if (at < 0 || row.slice(0, at).trim() !== "") continue;
    // 글리프 줄의 글리프 뒤 흐리지 않은 글 + (접혔으면) 다음 줄들
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
