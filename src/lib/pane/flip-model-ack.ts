// 대화 면 모델 키워드의 "CLI 가 받았다" 확인 — `/model` · `/effort` 를 보낸 뒤 터미널 화면의 확인 문구를 읽는다.
// 불변식 4: 화면에서 읽은 글자는 키워드 표시에만 쓴다 — 터미널로 보내는 줄은 늘 `flip-model.ts` 의 고정 허용 목록 낱말로만 짓는다.
// 한계: 영어 고정 문구에 기댄다 — CLI 가 문구를 바꾸면 확인을 못 찾고(시간 초과) 키워드는 다음 답에서 바뀐다(거짓으로 바뀌지는 않는다).
import { CLAUDE_EFFORT_LEVELS, CODEX_LEVELS, codexSlugOk, type LastModel } from "$lib/pane/flip-model";

export interface ModelAck {
  /** `any` = 무엇에 대한 거절인지 모름 */
  kind: "model" | "effort" | "any";
  ok: boolean;
  /** Claude 는 `claude-<등급>-<버전>` 꼴(키워드 · ✓ 판정과 같은 모양), Codex 는 slug */
  model?: string;
  /** `null` = auto */
  effort?: string | null;
}

const NAME_MAX = 40;

function claudeModelId(name: string): string | null {
  const n = name.trim();
  if (n === "" || n.length > NAME_MAX || !/^[A-Za-z][A-Za-z0-9 .]*$/.test(n)) return null;
  return `claude-${n.toLowerCase().replace(/[ .]+/g, "-")}`;
}

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

export type SentKind = "model" | "effort";

/**
 * Codex 는 칸이 좁으면 낱말 사이에서 스스로 줄을 바꾼다 — xterm `isWrapped` 는 믿을 수 없어 이 머리 줄만 이어 본다.
 * 화면 행 전체를 잇지는 않는다(`term/screen-rows.ts` — Claude 판정이 깨진다).
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

const CLAUDE_ECHO = /^❯\s+(\/\S.*?)\s*$/;
const CODEX_SENT = /^\/model(?: (\S+))? --reasoning=(\S+)$/;

/**
 * 화면 맨 아래의 확인이 보낸 것의 답인가로 판정한다 — 확인 줄 수를 세면 대체 화면이 차서 위 줄이 밀려 나갈 때 놓친다.
 * Claude 는 되울림(`❯ /…`) 바로 아래 `⎿` 짝, Codex 는 되울림이 없어 확인 줄의 값으로 맞춘다. `line` 이 `null` 이면 값을 맞추지 않는다.
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
 * 덮어 둔 값은 기록의 `last` 가 덮은 뒤에 생긴 줄(값을 실은 줄)에서 올 때만 걷는다 —
 * 새 턴의 사람 말 · 도구 항목으로 걷으면 답이 나오는 동안 옛 Effort 가 돌아온다.
 */
export interface ModelOverride {
  model?: string;
  /** `undefined` = 기록을 따른다 · `null` = auto */
  effort?: string | null;
  /** `null` = 기록에 아직 값이 없었다 · `undefined` = 쪽을 아직 못 받았다(처음 받은 것을 그 자리로) */
  lastAt: number | null | undefined;
}

export function overrideOf(prev: ModelOverride | null, a: ModelAck, lastAt: number | null | undefined): ModelOverride {
  const base: ModelOverride = prev && prev.lastAt === lastAt ? { ...prev } : { lastAt };
  if (a.model !== undefined) base.model = a.model;
  if (a.effort !== undefined) base.effort = a.effort;
  base.lastAt = lastAt;
  return base;
}

export function settleOverride(ov: ModelOverride | null, pageLastAt: number | null | undefined): ModelOverride | null {
  if (!ov) return null;
  if (ov.lastAt === undefined) return { ...ov, lastAt: pageLastAt ?? null };
  if (pageLastAt === undefined) return ov;
  return pageLastAt === ov.lastAt ? ov : null;
}

export function shownModel(rec: LastModel | null, ov: ModelOverride | null): LastModel | null {
  if (!ov) return rec;
  const model = ov.model ?? rec?.model;
  if (model === undefined) return null;
  const effort = ov.effort !== undefined ? ov.effort : (rec?.effort ?? null);
  return { model, effort };
}


// ── Claude 의 모델 · Effort 전환 확인 화면 ──

/**
 * 대화가 지금 모델로 캐시돼 있으면 Claude 는 `/model` · `/effort` 에 `1. Yes, switch to …` / `2. No, go back` 확인을 띄운다 —
 * 그동안 다음 명령의 Enter 가 1번을 고른다. 두 줄이 줄 전체로 맞아야 한다(대화 본문의 인용과 가른다).
 * 한계: 영어 고정 문구 · 약 40열 아래에서 줄이 접히거나 번호를 숨긴 판이면 알아보지 못한다 — 그때는 TUI 에서 답한다.
 */
const SWITCH_HEAD: readonly [RegExp, "model" | "effort"][] = [
  [/^Switch model\?$/, "model"],
  [/^Change effort level\?$/, "effort"],
];
const SWITCH_YES = /^(?:[❯›>]\s*)?1\.\s+Yes, switch to (.+)$/;
const SWITCH_NO = /^(?:[❯›>]\s*)?2\.\s+No, go back$/;
const SWITCH_SPAN = 10;

/** 보내는 키는 고정 상수다 — 화면 글자가 아니다(불변식 4) */
export const SWITCH_YES_KEY = "1";
export const SWITCH_NO_KEY = "2";

/** `name` 은 표시용 — 모르면 빈 글 */
export interface SwitchAsk {
  kind: "model" | "effort";
  name: string;
}

function switchName(kind: "model" | "effort", raw: string): string {
  const n = raw.trim();
  if (kind === "effort") return CLAUDE_EFFORT_LEVELS.includes(n) || n === "auto" ? n : "";
  return n.length <= NAME_MAX && /^[A-Za-z0-9 .\-]+$/.test(n) ? n : "";
}

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
