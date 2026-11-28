/** 지난 대화 목록의 순수 층 — 제목은 사용자 글자일 수 있어 화면에만 쓴다 · 로그·설정·MCP 로 보내지 않는다 */
import type { Key } from "$lib/i18n/keys";
import type { Project, WorktreeInfo } from "$lib/projects";

/** Rust `TitleSource` (소문자) */
export type TitleSource = "custom" | "ai" | "prompt" | "fallback";

/** Rust `AgentSession` (camelCase) */
export interface AgentConversation {
  /** `pane-icons.ts` 의 로고 이름과 같은 글자 */
  agent: string;
  id: string;
  cwd: string;
  branch: string | null;
  title: string;
  titleSource: TitleSource;
  startedAt: number | null;
  updatedAt: number;
  model: string | null;
  forkedFrom: string | null;
  cwdExists: boolean;
}

/** Rust `CwdSessions` */
export interface CwdConversations {
  /** 요청에 보낸 글자 그대로 */
  cwd: string;
  exists: boolean;
  sessions: AgentConversation[];
  more: boolean;
}

/** Rust `AgentSessionList` */
export interface ConversationList {
  groups: CwdConversations[];
  others: AgentConversation[];
  othersMore: boolean;
}

export const OTHER_DIRS_MAX = 20;
export const ROWS_INITIAL = 8;

/** 같은 대화를 두 곳에서 동시에 재개하면 기록이 뒤섞인다 — 에이전트가 턴마다 파일에 붙이므로 2분이면 생각하는 틈을 덮는다 */
export const OPEN_ELSEWHERE_WINDOW_MS = 2 * 60_000;

/** Rust `agent_state::convo::RELEASE_GRACE_MS` 와 같은 값 — 닫힌 CLI 가 마지막 줄을 늦게 붙인다 */
export const RELEASE_GRACE_MS = 5_000;

/** Rust `agent_state::convo::busy` 와 같은 규칙 */
export function openElsewhere(
  s: Pick<AgentConversation, "updatedAt">,
  now: number,
  linked: boolean,
  releasedAt: number | null = null,
): boolean {
  if (linked || now - s.updatedAt >= OPEN_ELSEWHERE_WINDOW_MS) return false;
  return !(releasedAt !== null && s.updatedAt <= releasedAt + RELEASE_GRACE_MS);
}

/** 서버 op `agent_conversation_links` 한 줄 — id 뿐 */
export interface ConversationLinkRow {
  agent: string;
  /** 소문자 */
  id: string;
  streams: string[];
  releasedAt: number | null;
}

export const conversationLinkKey = (agent: string, id: string): string => `${agent}:${id.toLowerCase()}`;

export function parseConversationLinks(v: unknown): Map<string, ConversationLinkRow> {
  const out = new Map<string, ConversationLinkRow>();
  if (!Array.isArray(v)) return out;
  for (const r of v) {
    if (typeof r !== "object" || r === null) continue;
    const o = r as Record<string, unknown>;
    if (typeof o.agent !== "string" || typeof o.id !== "string" || !Array.isArray(o.streams)) continue;
    const streams = o.streams.filter((x): x is string => typeof x === "string");
    const releasedAt = typeof o.releasedAt === "number" && Number.isFinite(o.releasedAt) ? o.releasedAt : null;
    out.set(conversationLinkKey(o.agent, o.id), { agent: o.agent, id: o.id.toLowerCase(), streams, releasedAt });
  }
  return out;
}

/** 이 창의 스트림은 뺀다 — 이 창의 타일은 창의 연결 표가 더 잘 안다(재개로 막 연 타일 · Codex `/new`) */
export function otherWindowStream(row: ConversationLinkRow | undefined, mine: (stream: string) => boolean): string | null {
  return row?.streams.find((st) => !mine(st)) ?? null;
}

// ---------------------------------------------------------------------------
// 이름 바꾸기
// ---------------------------------------------------------------------------

/** Rust `TITLE_MAX_CHARS` 와 같다 */
export const RENAME_MAX_CHARS = 80;

/** Rust `clean_name` 과 같은 다듬기 · 제어 문자 거절은 Rust 가 맡는다 */
export function renameDraft(
  raw: string,
  current: string,
): { kind: "ok"; name: string } | { kind: "same" | "empty" | "tooLong" } {
  const name = raw.split(/\s+/u).filter((w) => w !== "").join(" ");
  if (name === "") return { kind: "empty" };
  if (name === current) return { kind: "same" };
  if ([...name].length > RENAME_MAX_CHARS) return { kind: "tooLong" };
  return { kind: "ok", name };
}

/** `open` 을 막는 까닭 — 도는 CLI 가 제 이름을 다시 적는다 */
export function renameBlock(o: { remote: boolean; open: boolean; elsewhere: boolean }): "remote" | "open" | "elsewhere" | null {
  if (o.remote) return "remote";
  if (o.open) return "open";
  if (o.elsewhere) return "elsewhere";
  return null;
}

// ---------------------------------------------------------------------------
// 지우기
// ---------------------------------------------------------------------------

/**
 * Codex 는 갈라 나간 대화가 있는 동안 부모를 지우지 않는다(포크가 부모 줄을 가리킨다). 목록이 상한에서 잘려 이 수는 아는 만큼이다 —
 * 나머지는 Rust 가 Codex 의 거절 문구로 알린다.
 */
export function forkCountOf(all: readonly AgentConversation[], s: Pick<AgentConversation, "agent" | "id">): number {
  const id = s.id.toLowerCase();
  return all.filter((c) => c.agent === s.agent && c.forkedFrom?.toLowerCase() === id && c.id.toLowerCase() !== id).length;
}

/** `side-chat` — 지우면 그 채팅이 지운 대화를 이어 가려다 깨진다(채팅 독의 채팅 지우기가 그 대화까지 지운다) */
export function deleteBlock(o: {
  open: boolean;
  sideChat: boolean;
  elsewhere: boolean;
  forks: number;
}): "open" | "side-chat" | "elsewhere" | "forks" | null {
  if (o.open) return "open";
  if (o.sideChat) return "side-chat";
  if (o.elsewhere) return "elsewhere";
  if (o.forks > 0) return "forks";
  return null;
}

// ---------------------------------------------------------------------------
// 타일 ↔ 대화 연결의 재료
// ---------------------------------------------------------------------------

/** `id` 는 소문자 UUID */
export interface AgentLink {
  agent: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** Rust `agent_sessions::uuid_shape` 와 같은 모양 */
export function uuidShaped(s: string): boolean {
  return UUID_RE.test(s);
}

const SHELL_META_RE = /[;&|<>`$]/;
/** 다른 대화를 고르거나 갈라지게 하는 옵션 — 재개 줄의 추가 인자로 받지 않는다 */
const CLAUDE_NOT_EXTRA = new Set(["--resume", "-r", "--continue", "-c", "--fork-session", "--session-id"]);
const CODEX_NOT_EXTRA = new Set(["--last", "--all", "--no-daemon", "resume", "fork"]);

function extrasOk(tokens: readonly string[], banned: ReadonlySet<string>): boolean {
  return tokens.every((t) => !SHELL_META_RE.test(t) && !banned.has(t.split("=")[0]) && !t.startsWith("--remote"));
}

/**
 * Rust `agent_session_launch_spec` 이 지은 재개 한 줄인가 — 포크(`--fork-session` · `codex fork`)는 아니다.
 * Codex 추가 인자의 첫 낱말은 옵션이어야 한다 — 옵션이 아닌 낱말이 id 앞에 서면 대화 id 자리를 차지한다.
 */
export function resumedConversationOf(autorun: string | null | undefined): AgentLink | null {
  if (!autorun) return null;
  const argv = autorun.trim().split(/\s+/);
  if (argv[0] === "claude" && argv[1] === "--resume" && argv.length >= 3 && uuidShaped(argv[2])) {
    return extrasOk(argv.slice(3), CLAUDE_NOT_EXTRA) ? { agent: "claude", id: argv[2].toLowerCase() } : null;
  }
  if (argv[0] !== "codex") return null;
  let i = 1;
  const daemonFirst = argv[i] === "--no-daemon";
  if (daemonFirst) i++;
  if (argv[i] !== "resume") return null;
  i++;
  if (!daemonFirst && argv[i] === "--no-daemon") i++;
  const id = argv[argv.length - 1];
  if (argv.length - 1 < i || !uuidShaped(id)) return null;
  const extras = argv.slice(i, -1);
  if (extras.length > 0 && !extras[0].startsWith("-")) return null;
  return extrasOk(extras, CODEX_NOT_EXTRA) ? { agent: "codex", id: id.toLowerCase() } : null;
}

function launchParts(autorun: string): { agent: "claude" | "codex"; extras: string[] } | null {
  const argv = autorun.trim().split(/\s+/);
  if (argv[0] === "claude") {
    const resumed = argv[1] === "--resume" && argv.length >= 3 && uuidShaped(argv[2]);
    const extras = resumed ? argv.slice(3).filter((t) => t !== "--fork-session") : argv.slice(1);
    return extrasOk(extras, CLAUDE_NOT_EXTRA) ? { agent: "claude", extras } : null;
  }
  if (argv[0] === "codex") {
    const resumed = (argv[1] === "resume" || argv[1] === "fork") && argv.length >= 3 && uuidShaped(argv[argv.length - 1]);
    const extras = resumed ? argv.slice(2, -1) : argv.slice(1);
    return extrasOk(extras, CODEX_NOT_EXTRA) ? { agent: "codex", extras } : null;
  }
  return null;
}

/** 탭 템플릿은 대화 id · 재개 정보를 담지 않는다 — 열 때마다 새 대화다 */
export function freshAgentAutorun(autorun: string): string {
  const parts = launchParts(autorun);
  if (parts) return [parts.agent, ...parts.extras].join(" ");
  const link = resumedConversationOf(autorun);
  return link ? link.agent : autorun;
}

/**
 * AI 문자열 → PTY 길을 만들지 않는다(→ docs/invariants.md 전문 4) — 이 줄은 나중에 셸에 쳐지므로 재료는 고정 낱말 · UUID 모양을 지난 id ·
 * 그 autorun 에 이미 있던 사람의 추가 인자뿐이다. 신호의 다른 글자는 싣지 않는다.
 */
export function resumeAutorunFor(autorun: string | null | undefined, agent: string, id: string): string | null {
  if (!autorun || !uuidShaped(id)) return null;
  const parts = launchParts(autorun);
  if (!parts || parts.agent !== agent) return null;
  const want = id.toLowerCase();
  const argv = parts.agent === "claude" ? ["claude", "--resume", want, ...parts.extras] : ["codex", "resume", ...parts.extras, want];
  const line = argv.join(" ");
  const back = resumedConversationOf(line);
  if (!back || back.agent !== parts.agent || back.id !== want) return null;
  return line === autorun.trim() ? null : line;
}

/** 분할 복제가 물려받을 autorun — 같은 대화를 두 타일이 쥐지 않게 재개 줄을 새 대화 줄로 되돌린다 */
export function freshLaunchOf(autorun: string): string {
  if (!resumedConversationOf(autorun)) return autorun;
  const parts = launchParts(autorun);
  return parts ? [parts.agent, ...parts.extras].join(" ") : autorun;
}

/** 창 이관 짐은 JSON 이라 옛 앱 것 · 망가진 것이 온다 — 모양이 틀리면 연결 없이 연다 */
export function sanitizeAgentLink(raw: unknown): AgentLink | null {
  if (!raw || typeof raw !== "object") return null;
  const { agent, id } = raw as Partial<AgentLink>;
  if (typeof agent !== "string" || !AGENT_RE.test(agent) || typeof id !== "string" || !uuidShaped(id)) return null;
  return { agent, id: id.toLowerCase() };
}

/**
 * 셸이 새 명령을 시작했다(OSC 133 `C`)는 것은 새 CLI 가 떴다는 뜻이다 — Codex 는 `SessionStart` 훅이 없어 첫 질문까지 앞의 대화가 남는다.
 * 띄우며 적은 연결(`launch`)만 남는다 — 그 `C` 가 바로 그 재개 명령이다.
 */
export function linkSurvivesCliStart(link: { launch: boolean } | null | undefined): boolean {
  return !link || link.launch;
}

const CODEX_SWITCH_COMMANDS = new Set(["/new", "/clear", "/resume", "/fork"]);

/** Codex 만 — 새 대화가 섰다는 신호가 첫 질문 전에는 오지 않는다(Claude 는 `SessionStart` 가 곧바로 고쳐 적는다) */
export function switchesConversation(agent: string, text: string): boolean {
  if (agent !== "codex") return false;
  const line = text.trim();
  if (line.includes("\n")) return false;
  return CODEX_SWITCH_COMMANDS.has(line.split(/\s+/)[0].toLowerCase());
}

/** Rust `worktree::comparable` 과 같은 규칙 */
export function pathKey(path: string): string {
  const p = path.trim();
  const windowsish = p.includes("\\") || p[1] === ":";
  let s = p.replaceAll("\\", "/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return windowsish ? s.toLowerCase() : s;
}

/** 둘 다 [`pathKey`] 로 편 것 */
export function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

export function localProjects(projects: readonly Project[]): Project[] {
  return projects.filter((p) => !(p.host !== null && p.host.trim() !== ""));
}

export function registeredCwds(
  projects: readonly Project[],
  worktreesOf: (projectId: string) => readonly WorktreeInfo[] | null,
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (p: string) => {
    const k = pathKey(p);
    if (k === "" || seen.has(k)) return;
    seen.add(k);
    out.push(p);
  };
  for (const p of localProjects(projects)) {
    add(p.path);
    for (const w of worktreesOf(p.id) ?? []) add(w.path);
  }
  return out;
}

function tail(path: string): string {
  const t = path.trim().replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  return i >= 0 ? t.slice(i + 1) : t;
}

export function shortenHome(path: string, home: string | null): string {
  if (!home) return path;
  const h = pathKey(home);
  const k = pathKey(path);
  if (h === "" || !within(k, h)) return path;
  const rest = path.trim().slice(home.trim().replace(/[\\/]+$/, "").length);
  return `~${rest.replaceAll("\\", "/")}`;
}

export interface ScopeRow {
  /** `p:<프로젝트 id>` · `w:<프로젝트 id>:<경로 키>` · `o` · `o:<경로 키>` */
  key: string;
  kind: "project" | "worktree" | "others" | "otherDir";
  /** 기타 전체는 빈 글자(화면이 번역한다) */
  label: string;
  path: string | null;
  count: number;
  missing: boolean;
  depth: 0 | 1;
}

export interface Scopes {
  rows: ScopeRow[];
  conversations: Map<string, AgentConversation[]>;
}

const byRecent = (a: AgentConversation, b: AgentConversation) => b.updatedAt - a.updatedAt;

function uniq(list: Iterable<AgentConversation>): AgentConversation[] {
  const seen = new Set<string>();
  const out: AgentConversation[] = [];
  for (const s of list) {
    const k = `${s.agent}:${s.id}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(s);
  }
  return out;
}

export function buildScopes(
  projects: readonly Project[],
  worktreesOf: (projectId: string) => readonly WorktreeInfo[] | null,
  list: ConversationList | null,
  home: string | null,
): Scopes {
  const rows: ScopeRow[] = [];
  const conversations = new Map<string, AgentConversation[]>();
  const groupOf = new Map<string, CwdConversations>();
  for (const g of list?.groups ?? []) groupOf.set(pathKey(g.cwd), g);

  for (const p of localProjects(projects)) {
    const trees = (worktreesOf(p.id) ?? []).filter((w) => pathKey(w.path) !== pathKey(p.path));
    const paths = [p.path, ...trees.map((w) => w.path)];
    // 같은 대화가 파일 둘에 적힌 일이 있다 — 거르지 않으면 워크트리 줄 수가 프로젝트 줄보다 커진다
    const all = uniq(paths.flatMap((path) => groupOf.get(pathKey(path))?.sessions ?? []).sort(byRecent));
    const key = `p:${p.id}`;
    conversations.set(key, all);
    rows.push({ key, kind: "project", label: p.name, path: p.path, count: all.length, missing: false, depth: 0 });
    if (trees.length === 0) continue;
    const mainBranch = (worktreesOf(p.id) ?? []).find((w) => pathKey(w.path) === pathKey(p.path))?.branch ?? null;
    for (const [path, name] of [
      [p.path, mainBranch ?? tail(p.path)] as const,
      ...trees.map((w) => [w.path, w.branch ?? tail(w.path)] as const),
    ]) {
      const g = groupOf.get(pathKey(path));
      const own = uniq([...(g?.sessions ?? [])].sort(byRecent));
      const wkey = `w:${p.id}:${pathKey(path)}`;
      conversations.set(wkey, own);
      rows.push({
        key: wkey,
        kind: "worktree",
        label: name,
        path,
        count: own.length,
        missing: g ? !g.exists : false,
        depth: 1,
      });
    }
  }

  const others = uniq([...(list?.others ?? [])].sort(byRecent));
  if (others.length > 0) {
    conversations.set("o", others);
    rows.push({ key: "o", kind: "others", label: "", path: null, count: others.length, missing: false, depth: 0 });
    const dirs = new Map<string, { path: string; items: AgentConversation[] }>();
    for (const s of others) {
      const k = pathKey(s.cwd);
      const d = dirs.get(k);
      if (d) d.items.push(s);
      else dirs.set(k, { path: s.cwd, items: [s] });
    }
    for (const [k, d] of [...dirs].slice(0, OTHER_DIRS_MAX)) {
      const okey = `o:${k}`;
      conversations.set(okey, d.items);
      rows.push({
        key: okey,
        kind: "otherDir",
        label: shortenHome(d.path, home),
        path: d.path,
        count: d.items.length,
        missing: d.items.every((s) => !s.cwdExists),
        depth: 1,
      });
    }
  }
  return { rows, conversations };
}

export function flatConversations(list: ConversationList | null): AgentConversation[] {
  return uniq([...(list?.groups ?? []).flatMap((g) => g.sessions), ...(list?.others ?? [])].sort(byRecent));
}

export function scopeLabelOf(s: AgentConversation, rows: readonly ScopeRow[]): string {
  const k = pathKey(s.cwd);
  return (
    scopeLabelForPath(s.cwd, rows) ??
    rows.find((r) => r.kind === "otherDir" && r.path !== null && pathKey(r.path) === k)?.label ??
    tail(s.cwd)
  );
}

export function scopeLabelForPath(path: string, rows: readonly ScopeRow[]): string | null {
  const k = pathKey(path);
  let best: ScopeRow | null = null;
  for (const r of rows) {
    if (r.path === null || r.kind === "otherDir") continue;
    const rk = pathKey(r.path);
    if (within(k, rk) && (!best || rk.length > pathKey(best.path ?? "").length || (rk.length === pathKey(best.path ?? "").length && r.kind === "project"))) {
      best = r;
    }
  }
  if (best) {
    if (best.kind === "worktree") {
      const proj = rows.find((r) => r.kind === "project" && best && r.key === `p:${best.key.split(":")[1]}`);
      return proj && proj.label !== best.label ? `${proj.label} · ${best.label}` : best.label;
    }
    return best.label;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 팔레트
// ---------------------------------------------------------------------------

/** 화면 언어와 상관없이 두 낱말을 다 받는다 · 글자 하나 접두사는 쓰지 않는다 — 남은 기호가 마땅치 않다 */
export const CONVERSATION_QUERY_WORDS = ["대화", "conv"] as const;

export function conversationQuery(raw: string): string | null {
  const s = raw.trimStart();
  for (const w of CONVERSATION_QUERY_WORDS) {
    const head = s.slice(0, w.length);
    if (head.toLowerCase() !== w) continue;
    const rest = s.slice(w.length);
    if (rest === "" || /^\s/.test(rest)) return rest.trim();
  }
  return null;
}

export interface ConversationPaletteEntry {
  key: string;
  agent: string;
  id: string;
  title: string;
  /** 합성 제목 */
  fallback: boolean;
  scope: string;
  updatedAt: number;
  state: "ok" | "open" | "missing" | "elsewhere";
}

export function conversationPaletteEntries(
  list: ConversationList | null,
  rows: readonly ScopeRow[],
  isOpen: (agent: string, id: string) => boolean,
  now: number = Date.now(),
  releasedAt: (agent: string, id: string) => number | null = () => null,
): ConversationPaletteEntry[] {
  return flatConversations(list).map((s) => {
    const open = isOpen(s.agent, s.id);
    return {
      key: `${s.agent}:${s.id}`,
      agent: s.agent,
      id: s.id,
      title: s.title,
      fallback: s.titleSource === "fallback",
      scope: scopeLabelOf(s, rows),
      updatedAt: s.updatedAt,
      state: open ? "open" : !s.cwdExists ? "missing" : openElsewhere(s, now, false, releasedAt(s.agent, s.id)) ? "elsewhere" : "ok",
    };
  });
}

// ---------------------------------------------------------------------------
// 채팅으로 열기
// ---------------------------------------------------------------------------

/** 지난 대화 줄의 [채팅으로 열기] — `hidden` 이면 단추를 그리지 않는다(오늘 UI 그대로) */
export type ChatOpenState = "hidden" | "ok" | "missing" | "elsewhere" | "sideChat";

/** 순서가 판정이다 — 열림이 경로 없음보다, 경로 없음이 사이드 채팅보다, 사이드 채팅이 밖에서 열림보다 먼저 */
export function chatOpenState(
  s: Pick<AgentConversation, "agent" | "cwdExists">,
  o: { chatTile: boolean; remote: boolean; open: boolean; elsewhere: boolean; sideChat: boolean },
): ChatOpenState {
  if (!o.chatTile || o.remote || o.open || (s.agent !== "claude" && s.agent !== "codex")) return "hidden";
  if (!s.cwdExists) return "missing";
  if (o.sideChat) return "sideChat";
  if (o.elsewhere) return "elsewhere";
  return "ok";
}

/** 흐린 단추의 툴팁 — ok · hidden 이면 null */
export function chatOpenBlockKey(st: ChatOpenState): Key | null {
  switch (st) {
    case "missing":
      return "board.convo.missing.title";
    case "sideChat":
      return "board.convo.openChat.sideChat";
    case "elsewhere":
      return "board.convo.openChat.elsewhere";
    default:
      return null;
  }
}

/** 부분수열(`fuzzyMatch`)은 쓰지 않는다 — 제목이 긴 문장이라 거의 다 걸린다 */
export function conversationMatches(query: string, e: { title: string; scope: string }): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  const hay = `${e.title} ${e.scope}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
