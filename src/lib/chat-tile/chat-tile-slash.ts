// 채팅 모양 AI 타일의 `/` 메뉴 — 내장 명령 갈래 표 · 메뉴 거르기 · 보내기 직전 판정의 순수 층. 값 import 없음.
// 갈래 표는 이 파일의 고정 상수다 — 사용자 설정 · 서버에서 받지 않는다. 메뉴는 입력 칸에 글을 넣을 뿐 스스로 보내지 않는다.
// (c) terminal 은 보내기 전에 막고 · `/model` · `/effort` 는 인자가 있어도 보내지 않는다(CLI 가 조용히 모델을 바꿔 칩과 어긋난다).
// (b) 의 MCP 상태 · Codex 검토 · 목표 · 속도는 Aynx 화면을 연다 — Claude `/mcp <하위 명령>`(설정 파일을 쓴다)만 (c) 로 간다(`argsTerminal`).
// Claude `/goal` · `/code-review` · `/security-review` 는 (a) 그대로 보낸다(`/code-review ultra` · `/ultrareview` 는 과금 클라우드라 (c)).
// 정확히 친 이름은 늘 그 줄이 고른 줄이다 — 흐린 줄을 건너뛰어 다른 명령(`/doctor` → `/skill-doctor`)이 들어가면 안 된다.
// 그대로 보내는 명령을 인자 없이 정확히 친 Enter 는 넣지 않고 보낸다(`slashEnterSends`).

import type { ChatTileCommands } from "./chat-tile-api";

export type SlashClass = "pass" | "aynx" | "terminal" | "hidden";
export type AynxAction =
  | "model"
  | "mode"
  | "newChat"
  | "conversations"
  | "usage"
  | "context"
  | "compact"
  | "copyHint"
  | "diffHint"
  | "rewind"
  | "mcpStatus"
  | "review"
  | "goal"
  | "fast";
export type SlashGroup = "aynx" | "builtin" | "skill" | "command" | "terminal";

export interface SlashEntry {
  name: string;
  /** 고르면 넣을 글 — "/name " · Codex 스킬 "$name " · aynx · terminal 은 "" */
  insert: string;
  description: string;
  hint: string;
  aliases: string[];
  group: SlashGroup;
  cls: SlashClass;
  action: AynxAction | null;
  /** Codex 스킬 — 보낼 때 `skills` 에 싣는다 */
  skill: boolean;
  /** 설명 대신 보일 Aynx 문구 낱말 — aynx 줄 · 목록 전 고정 줄. aynx 줄은 CLI 의 설명을 쓰지 않는다(하는 일이 다르다) */
  word: string | null;
  /** 친 글이 있을 때만 보이는 줄 — CLI 목록에 없는 고정 터미널 전용 이름(보내면 막히니 "글로 갑니다" 라고 하지 않게) */
  typed: boolean;
}

export type SlashIntent =
  | { kind: "send" }
  /** `args` = 이름 뒤 글(다듬은 것) — 카드 미리 채우기 */
  | { kind: "aynx"; action: AynxAction; name: string; args: string }
  | { kind: "terminal"; name: string }
  /** Codex 의 친 `/compact` */
  | { kind: "compact" };

interface AynxRow {
  readonly name: string;
  readonly aliases: readonly string[];
  readonly action: AynxAction;
  /** 같은 동작이라도 이름마다 맞는 설명 */
  readonly word: string;
}

interface NamedRow {
  readonly name: string;
  readonly aliases: readonly string[];
}

export interface SlashTable {
  readonly aynx: readonly AynxRow[];
  /** CLI 가 알린 터미널 전용 이름과 합쳐 막는다 */
  readonly terminal: readonly NamedRow[];
  /** 목록 없이도 늘 보이는 (a) 줄 — Claude 목록이 오기 전 */
  readonly fixedPass: readonly string[];
  readonly hiddenPrefix: string | null;
  readonly hidden: readonly string[];
  /** 인자가 있으면 (c) 로 가는 aynx 이름 */
  readonly argsTerminal: readonly string[];
}

const row = (name: string, ...aliases: string[]): NamedRow => Object.freeze({ name, aliases: Object.freeze(aliases) });
const act = (name: string, action: AynxAction, ...aliases: string[]): AynxRow => Object.freeze({ name, action, word: action, aliases: Object.freeze(aliases) });
const actAs = (word: string, r: AynxRow): AynxRow => Object.freeze({ ...r, word });

export const CLAUDE_SLASH: SlashTable = Object.freeze({
  aynx: Object.freeze([
    act("model", "model"),
    actAs("effort", act("effort", "model")),
    act("clear", "newChat", "reset", "new"),
    act("resume", "conversations"),
    actAs("rename", act("rename", "conversations", "name")),
    act("usage", "usage", "cost", "stats"),
    act("copy", "copyHint"),
    act("export", "copyHint"),
    // 인자(`/rewind 3`)는 버린다 — 늘 고르기 메뉴를 연다
    act("rewind", "rewind", "checkpoint"),
    act("mcp", "mcpStatus"),
  ]),
  terminal: Object.freeze([
    row("config", "settings"),
    row("autocompact"),
    row("output-style"),
    row("permissions"),
    row("agents"),
    row("auto-mode-setup"),
    row("import"),
    row("usage-credits"),
    row("extra-usage"),
    row("design"),
    row("design-consent"),
    row("design-revoke"),
    row("fast"),
    row("loop", "proactive"),
    row("advisor"),
    row("list-agents", "peers"),
    row("heapdump"),
    row("ultrareview"),
    row("hooks"),
    row("memory"),
    row("add-dir"),
    row("login"),
    row("logout"),
    row("exit"),
    row("quit"),
    row("vim"),
    row("theme"),
    row("statusline"),
    row("terminal-setup"),
    row("ide"),
  ]),
  fixedPass: Object.freeze(["compact", "context"]),
  hiddenPrefix: "__",
  hidden: Object.freeze(["workflow-launch-exec"]),
  argsTerminal: Object.freeze(["mcp"]),
});

export const CODEX_SLASH: SlashTable = Object.freeze({
  aynx: Object.freeze([
    act("model", "model"),
    act("approvals", "mode"),
    act("permissions", "mode"),
    act("new", "newChat"),
    act("resume", "conversations"),
    act("status", "context"),
    act("compact", "compact"),
    act("diff", "diffHint"),
    act("review", "review"),
    act("goal", "goal"),
    act("mcp", "mcpStatus"),
    act("fast", "fast"),
  ]),
  terminal: Object.freeze([
    row("init"),
    row("mention"),
    row("quit"),
    row("exit"),
    row("logout"),
    row("feedback"),
  ]),
  fixedPass: Object.freeze([]),
  hiddenPrefix: null,
  hidden: Object.freeze([]),
  argsTerminal: Object.freeze([]),
});

const GROUP_ORDER: readonly SlashGroup[] = ["aynx", "builtin", "skill", "command", "terminal"];
const NAME_RE = /^[A-Za-z0-9._:-]{1,96}$/;

function tableOf(cli: "claude" | "codex"): SlashTable {
  return cli === "codex" ? CODEX_SLASH : CLAUDE_SLASH;
}

const low = (s: string) => s.toLowerCase();

function namesOf(r: { name: string; aliases: readonly string[] }): string[] {
  return [low(r.name), ...r.aliases.map(low)];
}

function isHidden(t: SlashTable, name: string): boolean {
  const n = low(name);
  return (t.hiddenPrefix !== null && n.startsWith(t.hiddenPrefix)) || t.hidden.includes(n);
}

function aynxRow(t: SlashTable, name: string): AynxRow | null {
  const n = low(name);
  return t.aynx.find((r) => namesOf(r).includes(n)) ?? null;
}

function fixedTerminal(t: SlashTable, name: string): boolean {
  const n = low(name);
  return t.terminal.some((r) => namesOf(r).includes(n));
}

/** Claude `/code-review ultra` 는 과금되는 클라우드 리뷰다(`/ultrareview` 와 같은 길) — 터미널의 확인 없이 채팅 타일에서 시작되지 않게 막는다 */
const CLAUDE_BILLED_REVIEW = Object.freeze({ name: "code-review", aliases: Object.freeze(["review"]), arg: "ultra" });

function billedReview(typed: string, rest: string, entries: readonly SlashEntry[]): boolean {
  const n = low(typed);
  const reported = entries.find((x) => low(x.name) === CLAUDE_BILLED_REVIEW.name)?.aliases.map(low) ?? [];
  if (n !== CLAUDE_BILLED_REVIEW.name && !CLAUDE_BILLED_REVIEW.aliases.includes(n) && !reported.includes(n)) return false;
  return low(rest.trimStart().split(/\s/, 1)[0]) === CLAUDE_BILLED_REVIEW.arg;
}

function cleanAliases(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((a): a is string => typeof a === "string" && NAME_RE.test(a)) : [];
}

const blank = { insert: "", description: "", hint: "", action: null, skill: false, word: null, typed: false } as const;

/** (b) 줄은 CLI 목록에 없어도 늘 · (c) 는 CLI 목록에 있으면 늘, 목록에 없는 고정 이름은 `typed` · 숨김은 빼고 · Claude 목록이 없으면 고정 (a) 줄 */
export function slashEntries(cli: "claude" | "codex", cmds: ChatTileCommands | null): SlashEntry[] {
  const t = tableOf(cli);
  const list = Array.isArray(cmds?.commands) ? cmds.commands.filter((c) => c && typeof c.name === "string" && NAME_RE.test(c.name)) : [];
  const out: SlashEntry[] = t.aynx.map((r) => ({ ...blank, name: r.name, aliases: [...r.aliases], group: "aynx", cls: "aynx", action: r.action, word: r.word }));
  const seen = new Set<string>(t.aynx.flatMap(namesOf));
  const terminalRow = (name: string, aliases: string[], typed: boolean): SlashEntry => ({ ...blank, name, aliases, group: "terminal", cls: "terminal", typed });
  const fixedRows = () => {
    for (const r of t.terminal) {
      if (namesOf(r).some((n) => seen.has(n))) continue;
      for (const n of namesOf(r)) seen.add(n);
      out.push(terminalRow(r.name, [...r.aliases], true));
    }
  };
  if (cli === "codex") {
    for (const c of list) {
      if (seen.has(low(c.name))) continue;
      seen.add(low(c.name));
      out.push({
        ...blank,
        name: c.name,
        insert: `$${c.name} `,
        description: typeof c.description === "string" ? c.description : "",
        aliases: [],
        group: "skill",
        cls: "pass",
        skill: true,
      });
    }
    fixedRows();
    return out;
  }
  const reported = new Set((Array.isArray(cmds?.terminal) ? cmds.terminal : []).filter((n) => typeof n === "string").map(low));
  const terminalName = (names: string[]) => names.some((n) => reported.has(n) || fixedTerminal(t, n));
  for (const c of list) {
    const aliases = cleanAliases(c.aliases);
    const names = [low(c.name), ...aliases.map(low)];
    if (isHidden(t, c.name) || names.some((n) => seen.has(n))) continue;
    for (const n of names) seen.add(n);
    const terminal = terminalName(names);
    const group: SlashGroup = terminal ? "terminal" : c.kind === "builtin" || c.kind === "skill" ? c.kind : "command";
    out.push({
      ...blank,
      name: c.name,
      insert: terminal ? "" : `/${c.name} `,
      description: typeof c.description === "string" ? c.description : "",
      hint: typeof c.hint === "string" ? c.hint : "",
      aliases,
      group,
      cls: terminal ? "terminal" : "pass",
    });
  }
  // CLI 가 터미널 전용이라 알렸는데 명령 목록에는 없는 이름
  for (const n of reported) {
    if (seen.has(n) || !NAME_RE.test(n) || isHidden(t, n)) continue;
    seen.add(n);
    out.push(terminalRow(n, [], false));
  }
  if (cmds === null) {
    for (const n of t.fixedPass) {
      if (seen.has(n)) continue;
      seen.add(n);
      out.push({ ...blank, name: n, insert: `/${n} `, aliases: [], group: "builtin", cls: "pass", word: n });
    }
  }
  fixedRows();
  return out;
}

/** 아직 CLI 목록을 받지 못했다 — 메뉴 바닥에 흐린 안내 줄 */
export function slashPending(cmds: ChatTileCommands | null): boolean {
  return cmds === null;
}

/** 메뉴를 열 조건 — 글 전체가 `/` + 빈칸 없는 글이고 커서가 끝. 돌려주는 값은 `/` 뒤 글 · 아니면 null */
export function slashTrigger(value: string, caret: number): string | null {
  if (caret !== value.length || !/^\/\S*$/.test(value)) return null;
  return value.slice(1);
}

function rankOf(e: SlashEntry, q: string): number {
  const name = low(e.name);
  if (name.startsWith(q)) return 0;
  if (e.aliases.some((a) => low(a).startsWith(q))) return 1;
  if (name.includes(q)) return 2;
  if (q.length >= 2 && low(e.description).includes(q)) return 3;
  return -1;
}

/** 이름 · 별칭이 친 글과 정확히 같다(대소문자 무시 — `slashIntent` 와 같은 규칙) */
function exactOf(e: SlashEntry, q: string): boolean {
  return q !== "" && namesOf(e).includes(q);
}

/**
 * 맞는 줄 전부 — 무리는 늘 붙어 있다(group 순) · 무리 안은 이름 앞 일치 → 별칭 앞 일치 → 이름 안 일치 → (두 글자 이상) 설명 안 일치 → 이름.
 * 정확히 같은 이름의 줄은 맨 위다(그 무리째 앞으로 — 흐린 줄이어도). `typed` 줄은 친 글이 있을 때만.
 */
export function slashMatches(entries: readonly SlashEntry[], query: string): SlashEntry[] {
  const q = low(query);
  const ranked: { e: SlashEntry; r: number; x: boolean }[] = [];
  for (const e of entries) {
    if (e.typed && q === "") continue;
    const r = rankOf(e, q);
    if (r >= 0) ranked.push({ e, r, x: exactOf(e, q) });
  }
  const top = ranked.find((v) => v.x)?.e.group ?? null;
  const gi = (g: SlashGroup) => (g === top ? -1 : GROUP_ORDER.indexOf(g));
  ranked.sort(
    (a, b) =>
      gi(a.e.group) - gi(b.e.group) ||
      Number(b.x) - Number(a.x) ||
      a.r - b.r ||
      (low(a.e.name) < low(b.e.name) ? -1 : low(a.e.name) > low(b.e.name) ? 1 : 0),
  );
  return ranked.map((v) => v.e);
}

/** 메뉴에 보일 줄 — `slashMatches` 의 앞 `max` 개 */
export function filterSlash(entries: readonly SlashEntry[], query: string, max = 50): SlashEntry[] {
  return slashMatches(entries, query).slice(0, Math.max(0, max));
}

/** 정확히 같은 이름의 줄 자리 — 흐린 줄이어도 그 줄이 고른 줄이다. 없으면 -1 */
export function exactSlash(rows: readonly SlashEntry[], query: string): number {
  const q = low(query);
  return rows.findIndex((e) => exactOf(e, q));
}

/**
 * 메뉴가 열린 채 Enter — 고른 줄이 인자 없이 정확히 친 그대로 보내는 명령(Codex 스킬 · Aynx 동작 · 터미널 전용 밖)이면 참:
 * 그때는 `/이름 ` 을 넣지 않고 보내기 길로 흘린다(두 번 누르지 않게 · Tab 은 그대로 넣기).
 */
export function slashEnterSends(rows: readonly SlashEntry[], at: number, query: string): boolean {
  const e = rows[at];
  return !!e && e.cls === "pass" && !e.skill && exactSlash(rows, query) === at;
}

/**
 * 보내기 직전 — 첫 낱말 전체가 `/이름`(`[A-Za-z0-9._:-]`)일 때만 보고, 정확히 같은 이름(별칭 포함 · 대소문자 무시)만 가른다.
 * 경로 같은 `/etc/hosts` · 목록에 없는 `/x` 는 "send". 고정 표가 `entries` 보다 먼저다.
 */
export function slashIntent(cli: "claude" | "codex", text: string, entries: readonly SlashEntry[]): SlashIntent {
  // 앞 빈칸을 CLI 가 걷어 명령으로 받을 수 있다 — 막는 쪽으로 본다
  const m = /^\/([A-Za-z0-9._:-]+)(?=\s|$)/.exec(text.trimStart());
  if (!m) return { kind: "send" };
  const typed = m[1];
  const t = tableOf(cli);
  if (isHidden(t, typed)) return { kind: "send" };
  const args = text.trimStart().slice(m[0].length).trim();
  const a = aynxRow(t, typed);
  if (a) {
    if (cli === "codex" && a.action === "compact") return { kind: "compact" };
    if (args !== "" && t.argsTerminal.includes(low(a.name))) return { kind: "terminal", name: typed };
    return { kind: "aynx", action: a.action, name: a.name, args };
  }
  if (fixedTerminal(t, typed)) return { kind: "terminal", name: typed };
  if (cli === "claude" && billedReview(typed, text.trimStart().slice(m[0].length), entries)) {
    return { kind: "terminal", name: `${CLAUDE_BILLED_REVIEW.name} ${CLAUDE_BILLED_REVIEW.arg}` };
  }
  const n = low(typed);
  const e = entries.find((x) => low(x.name) === n || x.aliases.some((al) => low(al) === n));
  if (e?.cls === "terminal") return { kind: "terminal", name: typed };
  if (e?.cls === "aynx" && e.action) return { kind: "aynx", action: e.action, name: e.name, args };
  return { kind: "send" };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 고른 스킬 가운데 글에 `$name` 낱말이 아직 남은 것만(Codex) — 고른 순서 · 겹침 없음 */
export function skillsInText(text: string, picked: readonly string[]): string[] {
  const out: string[] = [];
  for (const name of picked) {
    if (!NAME_RE.test(name) || out.includes(name)) continue;
    if (new RegExp(`(^|\\s)\\$${escapeRe(name)}(?![A-Za-z0-9._:-])`).test(text)) out.push(name);
  }
  return out;
}
