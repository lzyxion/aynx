// ---------------------------------------------------------------------------
// **대화 면 모델 키워드의 "CLI 가 받았다" 확인**(2026-11-14 — 순수 층). 메뉴에서 `/model` · `/effort` 를 보낸 뒤 그 타일 터미널 화면을 짧게
// 읽어 CLI 의 확인 문구가 **새로** 뜨면 키워드를 곧바로 그 값으로 덮어 둔다(다음 답이 기록에 남으면 다시 기록을 따른다 — `AiFlip`).
//
// **불변식 4**: 여기서 화면에서 읽은 글자(모델 이름 · 단계)는 **키워드 표시에만** 쓴다. 터미널로 보내는 줄은 늘 `flip-model.ts` 의 고정 허용 목록
// 낱말로만 짓고, 이 파일의 어떤 값도 그 줄에 실리지 않는다.
//
// 실측 문구(Claude Code 2.1.323 · Codex 0.168.0, 따로 띄운 PTY — 2026-11-13~14):
// - Claude(줄 머리 `⎿`): `Set model to Opus 5.5 and saved as your default for new sessions` · `Set model to Sonnet 5.5 (default) and saved …` ·
//   `Set effort level to high (saved as your default …): …` · `Effort level set to auto` · 거절 `Model 'Default' not found` ·
//   `Invalid argument: default. Valid options are: …` · 확인 화면에서 물러남 `Kept model as Opus 5.5`.
// - Codex(줄 머리 `•` · 거절은 `■`): `Model changed to gpt-6-astra xhigh for this session only` · `■ Reasoning level 'bogus' is unavailable …` ·
//   `■ Model 'x' is unavailable. …` · `■ Unexpected argument 'high'. …`.
// - Claude 는 그 대화가 **지금 모델로 캐시돼 있으면**(그 프로세스에서 답을 한 번 받은 뒤 — 재개 직후 · 바꾼 직후에는 안 뜬다) 다른 모델로의
//   `/model` 에 확인 화면을 띄운다([`claudeSwitchAsk`]). 그동안은 확인이 아니다 — 확인 기다리기는 멈춘다.
//
// **판정은 "화면 맨 아래의 확인이 보낸 것과 맞나"**(2026-11-14 실기 뒤 — [`latestAck`]): 처음에는 보내기 전 · 뒤 확인 줄 수를 비교했는데, 화면이
// 확인 줄로 차면(두 CLI 모두 대체 화면이라 스크롤백이 없다) 새 줄이 들어오는 만큼 위 줄이 밀려 나가 수가 그대로였다 — CLI 에는 첫 번에 적용됐는데
// 키워드만 놓쳐 사람이 한 번 더 눌렀다(첫 구현부터 있던 일 — 화면이 비어 있을 때만 맞았다).
//
// **한계**: 영어 고정 문구에 기댄다 — CLI 가 문구를 바꾸면 확인을 못 찾고(시간 초과) 키워드는 예전처럼 다음 답에서 바뀐다(거짓으로 바뀌지는 않는다).
// ---------------------------------------------------------------------------
import { CLAUDE_EFFORT_LEVELS, CODEX_LEVELS, codexSlugOk, type LastModel } from "$lib/pane/flip-model";

/** 화면에서 찾은 확인 · 거절 줄 하나 */
export interface ModelAck {
  /** `model` = 모델(+ Codex 는 단계도), `effort` = 강도만, `any` = 무엇에 대한 거절인지 모름 */
  kind: "model" | "effort" | "any";
  ok: boolean;
  /** 표시용 모델 — Claude 는 화면 이름을 `claude-<등급>-<버전>` 꼴로(키워드 · ✓ 판정과 같은 모양), Codex 는 slug */
  model?: string;
  /** 표시용 강도 — `null` = auto(모델 기본 — 모른다) */
  effort?: string | null;
}

/** 표시 이름 상한 */
const NAME_MAX = 40;

/** `Opus 5.5` → `claude-opus-5-5`(글자 · 숫자 · 공백 · 점만 — 아니면 `null`) */
function claudeModelId(name: string): string | null {
  const n = name.trim();
  if (n === "" || n.length > NAME_MAX || !/^[A-Za-z][A-Za-z0-9 .]*$/.test(n)) return null;
  return `claude-${n.toLowerCase().replace(/[ .]+/g, "-")}`;
}

/** 줄 머리 기호를 떼고 다듬은 글 — 기호가 없으면 `null` */
function after(line: string, head: string): string | null {
  const t = line.trim();
  return t.startsWith(head) ? t.slice(head.length).trim() : null;
}

function claudeAck(line: string): ModelAck | null {
  const s = after(line, "⎿");
  if (s === null) return null;
  let m = /^Set model to (.+?)(?: \(default\))?(?: and saved\b.*)?$/.exec(s);
  if (m) {
    const id = claudeModelId(m[1]);
    return id === null ? { kind: "model", ok: false } : { kind: "model", ok: true, model: id };
  }
  m = /^Set effort level to ([a-z]+)\b/.exec(s);
  if (m) return CLAUDE_EFFORT_LEVELS.includes(m[1]) ? { kind: "effort", ok: true, effort: m[1] } : { kind: "effort", ok: false };
  if (/^Effort level set to auto\b/.test(s)) return { kind: "effort", ok: true, effort: null };
  if (/^Kept model as\b/.test(s) || /^Model '.*' not found/.test(s)) return { kind: "model", ok: false };
  if (/^Invalid argument\b/.test(s) || /\bis unavailable\b/.test(s) || /\bnot found\b/.test(s)) return { kind: "any", ok: false };
  return null;
}

function codexAck(line: string): ModelAck | null {
  const ok = after(line, "•");
  if (ok !== null) {
    const m = /^Model changed to (\S+) (\S+) for this session only\b/.exec(ok);
    if (!m) return null;
    return codexSlugOk(m[1]) && CODEX_LEVELS.includes(m[2]) ? { kind: "model", ok: true, model: m[1], effort: m[2] } : { kind: "any", ok: false };
  }
  const bad = after(line, "■");
  if (bad !== null && /\b(unavailable|Unexpected argument|Invalid|not found)\b/.test(bad)) return { kind: "any", ok: false };
  return null;
}

/** 화면 줄들(위 → 아래)의 확인 · 거절 줄 — 화면 순서 그대로. 모르는 CLI 면 빈 목록 */
export function modelAcks(cli: string, lines: readonly string[]): ModelAck[] {
  const one = cli === "claude" ? claudeAck : cli === "codex" ? codexAck : null;
  if (!one) return [];
  const out: ModelAck[] = [];
  for (const l of lines) {
    const a = one(l);
    if (a) out.push(a);
  }
  return out;
}

/** 보낸 것의 갈래 — 메뉴의 모델 줄 / 강도 줄 */
export type SentKind = "model" | "effort";

/**
 * Codex 의 `•` · `■` 줄 + 칸이 좁아 접힌 이어짐(다음 행들 — 빈 행 · 다른 머리 기호 전까지, 둘까지)을 한 줄로. 실측(Codex 0.169 · 44열 · 앱과 같은
 * ConPTY 길): Codex 는 낱말 사이에서 스스로 줄을 바꾼다(`• Model changed to gpt-6-astra medium for` / `this session only`) — xterm 의
 * `isWrapped` 는 설 때도 안 설 때도 있어 기대지 않고, 화면 행을 잇지도 않는다(`term/screen-rows.ts` — Claude 판정이 깨진다). 이 머리 줄만 이어 본다.
 */
function codexLine(lines: readonly string[], i: number): string {
  const head = lines[i].trim();
  if (!head.startsWith("•") && !head.startsWith("■")) return lines[i];
  let out = head;
  for (let j = i + 1; j < lines.length && j <= i + 2; j++) {
    const next = lines[j].trim();
    if (next === "" || /^[•■›─]/.test(next)) break;
    out += ` ${next}`;
  }
  return out;
}

/** Claude 의 명령 되울림 줄(`❯ /effort high`) — 명령 글 */
const CLAUDE_ECHO = /^❯\s+(\/\S.*?)\s*$/;
/** Codex 로 보낸 고정 줄(`/model [<slug>] --reasoning=<단계>`)의 값 */
const CODEX_SENT = /^\/model(?: (\S+))? --reasoning=(\S+)$/;

/**
 * 보낸 뒤 화면 한 장의 판정 — **화면 맨 아래의 확인이 보낸 것의 답인가**. 줄 수를 세지 않으니 같은 문구가 여러 번 쌓여도, 위 줄이 밀려 나가도 맞는다.
 * - Claude: 맨 아래쪽 **되울림 + 확인** 짝(`❯ /effort high` 바로 아래 `⎿ …` — 아래가 `⎿` 가 아닌 되울림은 아직 처리 전인 입력 줄이라 건너뛴다).
 *   그 되울림이 보낸 줄과 같고 확인이 보낸 갈래의 받아들임이면 받는다. 되울림이 다르면(아직 그 앞 명령까지만 처리됐다) 기다린다.
 * - Codex: 되울림이 없다 — 맨 아래쪽 확인 줄(`• Model changed to <slug> <단계>` · `■ …`)이 보낸 값(단계 · 모델을 보냈으면 slug 도)과 같으면 받는다.
 * - `line` 이 `null`(확인 카드의 [전환] — 명령은 사람이 쳤을 수도 있다)이면 되울림 · 값을 맞추지 않고 맨 아래 짝의 받아들임이면 받는다.
 * 같은 값을 두 번 보내면 맨 아래의 옛 짝이 곧바로 맞는다 — 그 값이 이미 CLI 의 지금 값이라 맞다. 거절 · 물러남 · 아직은 모두 `wait`(시간 초과 = 바꾸지 않음).
 * 빠르게 연속으로 바꾸면 부르는 쪽이 앞의 기다림을 걷어 마지막 것만 기다린다. Claude 의 확인 화면은 부르는 쪽이 [`claudeSwitchAsk`] 로 먼저 본다.
 */
export function latestAck(
  cli: string,
  sent: { kind: SentKind; line: string | null },
  lines: readonly string[],
): "wait" | { ack: ModelAck } {
  if (cli === "claude") {
    for (let i = lines.length - 1; i >= 0; i--) {
      const m = CLAUDE_ECHO.exec(lines[i].trim());
      if (!m) continue;
      let j = i + 1;
      while (j < lines.length && j <= i + 2 && lines[j].trim() === "") j++;
      if (j >= lines.length || !lines[j].trim().startsWith("⎿")) continue;
      if (sent.line !== null && m[1] !== sent.line.trim()) return "wait";
      const a = claudeAck(lines[j]);
      return a && a.ok && a.kind === sent.kind ? { ack: a } : "wait";
    }
    return "wait";
  }
  if (cli === "codex") {
    const want = sent.line === null ? null : CODEX_SENT.exec(sent.line.trim());
    if (sent.line !== null && !want) return "wait";
    for (let i = lines.length - 1; i >= 0; i--) {
      const a = codexAck(codexLine(lines, i));
      if (!a) continue;
      if (!a.ok) return "wait";
      if (want && (a.effort !== want[2] || (want[1] !== undefined && a.model !== want[1]))) return "wait";
      return { ack: a };
    }
  }
  return "wait";
}

/**
 * 덮어 둔 값 — 기록의 `last` 가 **덮은 뒤에 생긴 줄**(값을 실은 줄 — Claude 답 줄 · Codex `turn_context`)에서 오면 걷는다. 새 턴의 사람 말 ·
 * 도구 · 시스템 항목이 붙는 것으로는 걷지 않는다(2026-11-14 실기 — 끝 항목 열쇠로 걷었더니 답이 나오는 동안 옛 Effort 가 돌아왔다).
 */
export interface ModelOverride {
  model?: string;
  /** `undefined` = 강도는 기록을 따른다 · `null` = auto(모름) */
  effort?: string | null;
  /** 덮을 때 기록의 `last` 가 실린 줄 자리(`null` = 기록에 아직 값이 없었다 · `undefined` = 쪽을 아직 못 받았다 — 처음 받은 것을 그 자리로) */
  lastAt: number | null | undefined;
}

/** 받은 확인 → 덮을 값(앞서 덮어 둔 것 위에 — 강도만 바꾸면 모델은 앞의 덮은 값 그대로) */
export function overrideOf(prev: ModelOverride | null, a: ModelAck, lastAt: number | null | undefined): ModelOverride {
  const base: ModelOverride = prev && prev.lastAt === lastAt ? { ...prev } : { lastAt };
  if (a.model !== undefined) base.model = a.model;
  if (a.effort !== undefined) base.effort = a.effort;
  base.lastAt = lastAt;
  return base;
}

/**
 * 최신 쪽을 받았을 때 덮은 값을 어떻게 할까 — `pageLastAt` = 그 쪽의 `last` 가 실린 줄 자리(`last` 가 없으면 `undefined` — 이 쪽 밖이라 모른다).
 * 값을 실은 줄이 덮을 때와 다르면 그 뒤의 새 답이다 → 걷는다(`null`). 쪽을 몰랐을 때 덮었으면 처음 받은 자리를 그 자리로 삼는다.
 */
export function settleOverride(ov: ModelOverride | null, pageLastAt: number | null | undefined): ModelOverride | null {
  if (!ov) return null;
  if (ov.lastAt === undefined) return { ...ov, lastAt: pageLastAt ?? null };
  if (pageLastAt === undefined) return ov;
  return pageLastAt === ov.lastAt ? ov : null;
}

/** 키워드가 그릴 값 — 덮은 값 위에 기록. 모델을 끝내 모르면 `null` */
export function shownModel(rec: LastModel | null, ov: ModelOverride | null): LastModel | null {
  if (!ov) return rec;
  const model = ov.model ?? rec?.model;
  if (model === undefined) return null;
  const effort = ov.effort !== undefined ? ov.effort : (rec?.effort ?? null);
  return { model, effort };
}


// ── Claude 의 모델 · Effort 전환 확인 화면 ──────────────────────────────────────────

/**
 * 실측(Claude Code 2.1.323 · 120열 — 대화를 그 모델로 한 번 답받은 뒤 다른 모델로 `/model`):
 *
 * ```text
 * ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔
 *    Switch model?
 *    Your next response will be slower and use more tokens
 *
 *    This conversation is cached for the current model. Switching to Haiku 5.5 means the full history gets re-read.
 *
 *    ❯ 1. Yes, switch to Haiku 5.5
 *      2. No, go back
 * ```
 *
 * `/effort` 도 같은 부품으로 묻는다(2026-11-14 — Claude Code 2.1.325 바이너리의 확인 부품 `kind:"model"|"effort"`: 머리 `Change effort level?` ·
 * 본문 "…cached for the current effort level. Switching to <단계> …" · `1. Yes, switch to <단계>`(단계 글자 그대로 — 없으면 `auto`) · `2. No, go back`).
 * 사용자 실기("Effort 를 두 번 눌러야 바뀐다")가 이것이었다 — 첫 누름의 확인이 터미널 면에 떠 있는 동안 둘째 누름의 Enter 가 그 1번을 골랐다.
 * 대화를 새로 묻지 않고는 이 화면을 띄울 수 없어(캐시가 데워져야 뜬다) 실측 화면은 없다 — 문구는 바이너리의 부품 정의에서 읽었다.
 *
 * 머리 줄 아래 몇 줄 안에 `1. Yes, switch to <대상>` 과 바로 다음(빈 줄 빼고) `2. No, go back` 이 **줄 전체로** 맞아야 한다 —
 * 대화 본문이 이 글을 인용해도 줄 전체가 되지 않는다. 고른 표시(`❯`)는 어느 줄에든 올 수 있다. `1` = 전환 · `2` = 물러남(`Kept model as …`) ·
 * Esc 도 물러남(실측). 돌려주는 이름은 **표시용**이다(카드 제목 — 보내는 키는 고정 상수 [`SWITCH_YES_KEY`] · [`SWITCH_NO_KEY`]).
 *
 * **한계**: 영어 고정 문구다 — CLI 가 문구를 바꾸거나 칸이 아주 좁아 `1. Yes, switch to …` 줄이 접히면(약 40열 아래) 알아보지 못한다. 번호를 숨긴
 * 판(Effort 고르기 화면 안의 확인 — `hideIndexes`)도 `1.` 이 없어 보지 않는다. 그때는 카드 없이 예전처럼 TUI 에서 답한다.
 */
const SWITCH_HEAD: readonly [RegExp, "model" | "effort"][] = [
  [/^Switch model\?$/, "model"],
  [/^Change effort level\?$/, "effort"],
];
const SWITCH_YES = /^(?:[❯›>]\s*)?1\.\s+Yes, switch to (.+)$/;
const SWITCH_NO = /^(?:[❯›>]\s*)?2\.\s+No, go back$/;
/** 머리에서 고르기 줄까지 볼 줄 수(설명이 접혀도) */
const SWITCH_SPAN = 10;

/** [전환] = 1번 고르기 · [취소] = 2번 고르기 — **고정 상수**(화면 글자가 아니다 — 불변식 4) */
export const SWITCH_YES_KEY = "1";
export const SWITCH_NO_KEY = "2";

/** Claude 의 전환 확인 — 무엇을(모델 · Effort) 무엇으로(표시용 이름 — 모르면 빈 글) */
export interface SwitchAsk {
  kind: "model" | "effort";
  name: string;
}

/** 표시용 이름 — 모델은 글자 · 숫자 · 공백 · 점 · 하이픈, Effort 는 단계 목록 · `auto` 만. 아니면 빈 글 */
function switchName(kind: "model" | "effort", raw: string): string {
  const n = raw.trim();
  if (kind === "effort") return CLAUDE_EFFORT_LEVELS.includes(n) || n === "auto" ? n : "";
  return n.length <= NAME_MAX && /^[A-Za-z0-9 .\-]+$/.test(n) ? n : "";
}

/** 지금 화면이 Claude 의 모델 · Effort 전환 확인인가 — 아니면 `null` */
export function claudeSwitchAsk(lines: readonly string[]): SwitchAsk | null {
  const rows = lines.map((l) => l.trim()).filter((l) => l !== "");
  for (let i = 0; i < rows.length; i++) {
    const head = SWITCH_HEAD.find(([re]) => re.test(rows[i]));
    if (!head) continue;
    for (let j = i + 1; j + 1 < rows.length && j <= i + SWITCH_SPAN; j++) {
      const m = SWITCH_YES.exec(rows[j]);
      if (m && SWITCH_NO.test(rows[j + 1])) return { kind: head[1], name: switchName(head[1], m[1]) };
    }
  }
  return null;
}
