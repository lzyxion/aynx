/**
 * **지난 대화** — 에이전트 CLI(Claude Code · Codex)가 남긴 대화 목록의 순수 층
 * (docs/log/2026-09-26-agent-sessions.md).
 *
 * 화면 단어는 **대화**다(대시보드의 "세션" 칸은 터미널 세션이다). 파일을 읽고 묶는 일은 Rust
 * `agent_sessions.rs` 가 하고(`agent_sessions_list` — 등록 경로별 묶음 + "기타"), 여기는 그 답을
 * **대시보드의 두 칸**(왼쪽 범위 목록 · 오른쪽 줄)으로 접는다: 범위 줄 만들기 · 기타를 폴더로 가르기 ·
 * 거르기 · 날짜 머리 · 기본 선택. 저장소·명령은 `app/agent-sessions.svelte.ts`.
 *
 * 제목은 사용자 글자일 수 있어(첫 프롬프트) **화면에만** 쓴다 — 로그·설정·MCP 로 보내지 않는다.
 */
import type { Project, WorktreeInfo } from "$lib/projects";

/** 제목의 출처 — Rust `TitleSource` (소문자) */
export type TitleSource = "custom" | "ai" | "prompt" | "fallback";

/** 대화 하나 — Rust `AgentSession` (camelCase) */
export interface AgentConversation {
  /** `"claude"` · `"codex"` — `pane-icons.ts` 의 로고 이름과 같은 글자 */
  agent: string;
  id: string;
  /** 기록된 시작 폴더 — 재개는 이 폴더에서 띄운다 */
  cwd: string;
  branch: string | null;
  title: string;
  titleSource: TitleSource;
  startedAt: number | null;
  /** 마지막 활동(epoch ms) */
  updatedAt: number;
  model: string | null;
  forkedFrom: string | null;
  /** 그 폴더가 지금 있는가 — 없으면 재개·계속을 막는다 */
  cwdExists: boolean;
}

/** 등록 경로 하나의 묶음 — Rust `CwdSessions` */
export interface CwdConversations {
  /** 요청에 보낸 글자 그대로 */
  cwd: string;
  /** 그 폴더가 지금 있는가(사라진 워크트리 줄을 흐리게 긋는다) */
  exists: boolean;
  sessions: AgentConversation[];
  more: boolean;
}

/** 목록 한 벌 — Rust `AgentSessionList` */
export interface ConversationList {
  groups: CwdConversations[];
  others: AgentConversation[];
  othersMore: boolean;
}

/** "기타" 의 폴더 줄 상한 — 넘는 폴더(오래된 쪽)는 기타 전체 줄에서만 보인다 */
export const OTHER_DIRS_MAX = 20;
/** 오른쪽 목록이 처음 보이는 줄 수 — 나머지는 "N개 더 보기" */
export const ROWS_INITIAL = 8;

/**
 * **밖에서 열림**으로 보는 창 — 대화 파일(`updatedAt` = 파일 mtime)이 이만큼 안에 고쳐졌는데 이 창의 어느 타일에도
 * 연결되어 있지 않으면(aynx 밖의 터미널 · 다른 창) 그 대화는 aynx 밖에서 열려 있다고 본다 — 지금 누가 쓰고 있을 수 있다
 * (docs/log/2026-09-26-project-start-screen.md 실기 ②). 같은 대화를 두 곳에서 동시에 재개하면 기록이 뒤섞인다.
 * 에이전트는 턴마다 파일에 줄을 붙이므로 도는 동안 mtime 이 계속 새롭다 — 2분이면 생각하는 틈을 덮고, 방금
 * 끝낸 대화를 오래 막지도 않는다. 새 대화로 계속(포크)은 원본을 건드리지 않아 이 판정과 무관하다.
 */
export const OPEN_ELSEWHERE_WINDOW_MS = 2 * 60_000;

/**
 * 놓인 뒤 이만큼 안의 쓰기는 **놓기의 꼬리**로 본다 — 타일을 닫으면 CLI 가 끝나며 마지막 줄을 조금 늦게 덧붙일 수 있다(Rust
 * `agent_state::convo::RELEASE_GRACE_MS` 와 같은 5초 — 까닭은 그쪽 주석).
 */
export const RELEASE_GRACE_MS = 5_000;

/**
 * 이 대화가 **밖에서 열림**인가(화면 "열림" 의 짝 — 그쪽은 aynx 타일에 열려 있다) — Aynx 의 어느 타일에도 연결되지 않았고 파일이
 * [`OPEN_ELSEWHERE_WINDOW_MS`] 안에 고쳐졌는데, 그 쓰기가 **마지막으로 놓인 뒤**(`releasedAt` — 세션 서버 장부 · 타일 닫기 · CLI 끝 ·
 * 대화 바꾸기) [`RELEASE_GRACE_MS`] 보다 늦다. 놓인 기록이 없으면(`null` — 장부를 못 읽음 · Aynx 에서 연 적 없음) 예전 규칙 그대로.
 * Rust `agent_state::convo::busy` 와 같은 규칙이다(docs/log/2026-10-24-convo-rename.md "열림 판정 — 세션 서버 장부").
 */
export function openElsewhere(
  s: Pick<AgentConversation, "updatedAt">,
  now: number,
  linked: boolean,
  releasedAt: number | null = null,
): boolean {
  if (linked || now - s.updatedAt >= OPEN_ELSEWHERE_WINDOW_MS) return false;
  return !(releasedAt !== null && s.updatedAt <= releasedAt + RELEASE_GRACE_MS);
}

/** 세션 서버의 대화 ↔ 스트림 장부 한 줄(서버 op `agent_conversation_links` — id 뿐) */
export interface ConversationLinkRow {
  agent: string;
  /** 소문자 */
  id: string;
  /** 지금 그 대화를 쥔 스트림(창 무관) — 비면 놓였다 */
  streams: string[];
  /** 마지막으로 놓인 시각(epoch ms) — 놓인 적 없으면 `null` */
  releasedAt: number | null;
}

/** 장부 줄의 열쇠 — `agent:id`(소문자) */
export const conversationLinkKey = (agent: string, id: string): string => `${agent}:${id.toLowerCase()}`;

/** 서버 답 → 열쇠별 줄. 모양이 틀린 줄은 버린다(답이 배열이 아니면 빈 표) */
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

/**
 * 장부가 이 대화를 **다른 창의 스트림**이 쥐었다고 하나 — 이 창의 스트림(`mine`)은 빼고 본다(이 창의 타일은 창의 연결 표가 더 잘 안다 —
 * 재개로 막 연 타일 · Codex 의 `/new`). 그런 스트림 하나를 돌려준다(없으면 `null`).
 */
export function otherWindowStream(row: ConversationLinkRow | undefined, mine: (stream: string) => boolean): string | null {
  return row?.streams.find((st) => !mine(st)) ?? null;
}

// ---------------------------------------------------------------------------
// 이름 바꾸기 (docs/log/2026-10-24-convo-rename.md) — 적는 일은 Rust `agent_session_rename`(그 CLI 의 기록에)
// ---------------------------------------------------------------------------

/** 이름 최대 글자 수 — Rust `TITLE_MAX_CHARS` 와 같다 */
export const RENAME_MAX_CHARS = 80;

/**
 * 고친 이름 → 보낼 이름(Rust `clean_name` 과 같은 다듬기 — 공백류를 한 칸으로 접고 앞뒤를 뗀다). 보낼 것이 없으면 `kind` 로 까닭:
 * `same`(그대로 — 아무 일도 하지 않고 닫는다) · `empty` · `tooLong`(자르지 않는다). 제어 문자 거절은 Rust 가 맡는다.
 */
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

/**
 * 이 줄에서 이름을 바꿀 수 없는 까닭 — `remote`(원격 대화 · 단추 없음) · `open`(이 창의 타일에 열림 — 도는 CLI 가 제 이름을 다시 적는다) ·
 * `elsewhere`(밖에서 열림 — Rust 도 2분 창으로 다시 막는다). 바꿀 수 있으면 `null`.
 */
export function renameBlock(o: { remote: boolean; open: boolean; elsewhere: boolean }): "remote" | "open" | "elsewhere" | null {
  if (o.remote) return "remote";
  if (o.open) return "open";
  if (o.elsewhere) return "elsewhere";
  return null;
}

// ---------------------------------------------------------------------------
// 지우기 (docs/log/2026-10-24-convo-rename.md "지우기") — 지우는 일은 Rust `agent_session_delete`(그 CLI 의 기록에서 영구히)
// ---------------------------------------------------------------------------

/**
 * 목록에서 이 대화로부터 **갈라 나간** 대화의 수(같은 에이전트 · `forkedFrom` 이 이 id). Codex 는 갈라 나간 대화가 있는 동안 부모를
 * 지우지 않는다(포크가 부모 줄을 복사하지 않고 가리킨다 — 10-24 실측). Claude 의 포크는 목록이 부모를 모른다(`forkedFrom` 없음 — 0).
 * 목록은 상한에서 잘리므로 이 수는 **아는 만큼**이다 — 나머지는 Rust 가 Codex 의 거절 문구로 알린다.
 */
export function forkCountOf(all: readonly AgentConversation[], s: Pick<AgentConversation, "agent" | "id">): number {
  const id = s.id.toLowerCase();
  return all.filter((c) => c.agent === s.agent && c.forkedFrom?.toLowerCase() === id && c.id.toLowerCase() !== id).length;
}

/**
 * 이 줄에서 지울 수 없는 까닭 — `open`(이 창의 타일에 열림 — 도는 CLI 가 그 파일에 쓴다) · `side-chat`(사이드 채팅이 쥔 대화 — 지우면
 * 그 채팅이 지운 대화를 이어 가려다 깨진다. 채팅 독의 채팅 지우기가 그 대화까지 지운다) · `elsewhere`(밖에서 열림 — Rust 도 2분 창으로
 * 다시 막는다) · `forks`(갈라 나간 대화가 있다 — [`forkCountOf`]). 원격 대화는 항목이 없다(부르는 쪽이 넘기지 않는다). 지울 수 있으면 `null`.
 */
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
// 타일 ↔ 대화 연결의 재료 (docs/log/2026-09-26-agent-sessions.md "연결의 수명 = 세션")
// ---------------------------------------------------------------------------

/** 타일 ↔ 대화 연결 한 벌 — `agent` 는 로고 이름(`"claude"`), `id` 는 소문자 UUID */
export interface AgentLink {
  agent: string;
  id: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const AGENT_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** `8-4-4-4-12` 16진수인가 — Rust `agent_sessions::uuid_shape` 와 같은 모양 */
export function uuidShaped(s: string): boolean {
  return UUID_RE.test(s);
}

/** 셸이 따로 읽는 글자 — 이것이 든 낱말이 있으면 한 명령이라고 믿지 않는다 */
const SHELL_META_RE = /[;&|<>`$]/;
/** 재개 줄의 추가 인자로 받지 않는 Claude 옵션 — 다른 대화를 고르거나 갈라지게 한다 */
const CLAUDE_NOT_EXTRA = new Set(["--resume", "-r", "--continue", "-c", "--fork-session", "--session-id"]);
/** 재개 줄의 추가 인자로 받지 않는 Codex 낱말 — 다른 대화를 고르거나 다른 서버에 붙는다 */
const CODEX_NOT_EXTRA = new Set(["--last", "--all", "--no-daemon", "resume", "fork"]);

/** 추가 인자로 받을 만한 낱말들인가 — 셸 글자가 없고 막은 낱말(`=값` 꼴 포함)이 아니다 */
function extrasOk(tokens: readonly string[], banned: ReadonlySet<string>): boolean {
  return tokens.every((t) => !SHELL_META_RE.test(t) && !banned.has(t.split("=")[0]) && !t.startsWith("--remote"));
}

/**
 * 이 autorun 이 **대화 재개**(Rust `agent_session_launch_spec` 이 지은 한 줄)인가 — 그렇다면 그 autorun 이 도는
 * 세션에서는 그 대화가 이 타일에 열려 있다, 첫 프롬프트(훅 신호) 전에도.
 *
 * | 한 줄 | 연결 |
 * | --- | --- |
 * | `claude --resume <id> [추가…]` | Claude — `--fork-session` 이 붙으면(새 id 로 갈라진다) 아니다 |
 * | `codex resume [--no-daemon] [추가…] <id>` · `codex --no-daemon resume [추가…] <id>` | Codex — `fork` 는 아니다 |
 *
 * 앞머리는 **정확히 그 낱말들**이고 id 는 UUID 모양이어야 한다(Codex 의 UUIDv7 도 같은 모양 · 엄격). `--no-daemon` 과
 * 설정의 추가 인자(`[ai.args]`)는 Rust 가 자동 실행 직전에 놓는 것이라(`codex_launch.rs` · `agent_args.rs`) 보통 여기
 * 오는 줄에는 없지만, 놓인 줄도 받는다 — 단 추가 인자 자리의 낱말은 셸 글자가 없고 다른 대화를 고르거나 갈라지게 하는
 * 옵션(`--fork-session` · `--last` · `--remote` …)이 아니어야 하고, Codex 는 그 자리의 첫 낱말이 옵션(`-`)이어야 한다
 * (옵션이 아닌 낱말이 id 앞에 서면 그것이 대화 id 자리를 차지한다).
 * 대화가 안에서 바뀌면(`/clear` · `/new`) Claude 는 `SessionStart`(`session`) 가, Codex 는 다음 `start` 신호가 고쳐 적는다(Codex 도
 * `--no-daemon` 으로 훅이 제 타일에 온다 — docs/log/2026-09-26-codex-hooks.md "다시 켬" · 대화 면의 입력 칸으로 보낸 것은 [`switchesConversation`]).
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

/**
 * 창 이관 짐에서 온 연결 — **모양이 맞을 때만**(에이전트는 로고 이름 모양 · id 는 UUID). 짐은 JSON 이라 옛 앱이
 * 내놓은 것(필드 없음)이나 망가진 것이 올 수 있다. 아니면 `null`(연결 없이 연다 — 다음 훅 신호가 다시 적는다).
 */
export function sanitizeAgentLink(raw: unknown): AgentLink | null {
  if (!raw || typeof raw !== "object") return null;
  const { agent, id } = raw as Partial<AgentLink>;
  if (typeof agent !== "string" || !AGENT_RE.test(agent) || typeof id !== "string" || !uuidShaped(id)) return null;
  return { agent, id: id.toLowerCase() };
}

/**
 * 그 AI 타일에서 셸이 **새 명령을 시작했다**(OSC 133 `C` — 링 재생이 아닌 실시간)는 사건 뒤에 연결이 남는가(2026-10-20).
 *
 * 셸이 명령을 시작했다는 것은 앞의 CLI 가 끝나고 **새 CLI** 가 떴다는 뜻이다 — 그 CLI 의 대화는 앞의 대화가 아니다. Claude 는
 * `SessionStart`(훅 10판 `session`)가 곧바로 새 id 로 고쳐 적지만, Codex 는 그 훅을 걸지 않아(입력 모양 미확인 · 기동 멈춤 실측 —
 * Rust `agent_hooks::CLAUDE_EVENTS` 머리말) **첫 질문**(`start`)까지 연결이 그대로라 대화 면이 앞의 대화를 그렸다. 셸 복귀(`A`) ·
 * `SessionEnd` 가 보통 먼저 지우지만, 손으로 친 CLI 는 `A` 때 이미 AI 타일이 아니라(도는 명령이 걷혔다) 그 길을 못 탄다.
 *
 * | 연결 | 답 |
 * | --- | --- |
 * | 없음 | 남는다(지울 것이 없다) |
 * | **띄우며 적은 것**(`launch` — 재개로 연 타일 · 재개 autorun) | 남는다 — 그 `C` 가 바로 그 재개 명령이다(원격 첫 입력의 준비 명령이 먼저 `C` 를 내도 된다) |
 * | 훅 신호 · 명세 사본(F5 · 재시작)으로 선 것 | **버린다** — 대화 면은 "연결 전" 빈 면, 새 CLI 의 첫 신호가 다시 잇는다 |
 */
export function linkSurvivesCliStart(link: { launch: boolean } | null | undefined): boolean {
  return !link || link.launch;
}

/** Codex 안에서 **대화를 바꾸는** 빗금 명령 — 새 대화(`/new` · `/clear`) · 다른 대화 고르기(`/resume`) · 갈라 계속(`/fork`) */
const CODEX_SWITCH_COMMANDS = new Set(["/new", "/clear", "/resume", "/fork"]);

/**
 * 대화 면의 입력 칸이 보낸 글이 **대화를 바꾸는** CLI 명령인가(2026-10-20) — 그렇다면 보낸 순간 연결을 버린다(빈 면 → 새 대화의 첫
 * 신호가 다시 잇는다). Codex 만: 그 대화가 섰다는 신호가 첫 질문(`UserPromptSubmit`) 전에는 오지 않는다. Claude 는 `SessionStart`
 * 가 곧바로 고쳐 적으므로 건드리지 않는다. 한 줄 · 그 낱말 하나(뒤의 인자는 받는다 — `/resume <id>` 꼴). 터미널에 손으로 친 명령은
 * 이 길을 지나지 않는다(키 하나하나라 줄을 모른다) — 그쪽은 첫 질문에서 고쳐진다.
 */
export function switchesConversation(agent: string, text: string): boolean {
  if (agent !== "codex") return false;
  const line = text.trim();
  if (line.includes("\n")) return false;
  return CODEX_SWITCH_COMMANDS.has(line.split(/\s+/)[0].toLowerCase());
}

/**
 * 경로 글자를 **비교용으로** 편다 — Rust `worktree::comparable` 과 같은 규칙: 구분자를 `/` 로,
 * 끝 구분자를 떼고, Windows 꼴(드라이브 글자 · `\`)이면 소문자로.
 */
export function pathKey(path: string): string {
  const p = path.trim();
  const windowsish = p.includes("\\") || p[1] === ":";
  let s = p.replaceAll("\\", "/");
  while (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return windowsish ? s.toLowerCase() : s;
}

/** `child` 가 `parent` 와 같거나 그 아래인가 (둘 다 [`pathKey`] 로 편 것) */
export function within(child: string, parent: string): boolean {
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
}

/** 원격이 아닌 프로젝트만 — 대화 파일은 이 PC 에 있다(원격은 후속) */
export function localProjects(projects: readonly Project[]): Project[] {
  return projects.filter((p) => !(p.host !== null && p.host.trim() !== ""));
}

/** 백엔드에 보낼 등록 경로 — 로컬 프로젝트 폴더와 그 워크트리들(겹침 없음) */
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

/** 경로의 마지막 조각 */
function tail(path: string): string {
  const t = path.trim().replace(/[\\/]+$/, "");
  const i = Math.max(t.lastIndexOf("/"), t.lastIndexOf("\\"));
  return i >= 0 ? t.slice(i + 1) : t;
}

/** 집 폴더를 `~` 로 — 모르면 그대로 */
export function shortenHome(path: string, home: string | null): string {
  if (!home) return path;
  const h = pathKey(home);
  const k = pathKey(path);
  if (h === "" || !within(k, h)) return path;
  const rest = path.trim().slice(home.trim().replace(/[\\/]+$/, "").length);
  return `~${rest.replaceAll("\\", "/")}`;
}

/** 왼쪽 범위 목록의 한 줄 */
export interface ScopeRow {
  /** 선택 키 — `p:<프로젝트 id>` · `w:<프로젝트 id>:<경로 키>` · `o` · `o:<경로 키>` */
  key: string;
  kind: "project" | "worktree" | "others" | "otherDir";
  /** 화면 글자 — 프로젝트 이름 · 워크트리 이름(브랜치 또는 폴더) · 기타 폴더(`~` 줄인 경로). 기타 전체는 빈 글자(화면이 번역한다) */
  label: string;
  /** 그 범위의 대표 경로(머리줄에 보인다) — 기타 전체는 `null` */
  path: string | null;
  count: number;
  /** 폴더가 사라진 워크트리 — 줄을 긋는다 */
  missing: boolean;
  /** 들여쓰기 — 워크트리·기타 폴더 줄 */
  depth: 0 | 1;
}

/** 범위 목록과 범위별 대화 — 대화는 최신순 */
export interface Scopes {
  rows: ScopeRow[];
  conversations: Map<string, AgentConversation[]>;
}

const byRecent = (a: AgentConversation, b: AgentConversation) => b.updatedAt - a.updatedAt;

/** 같은 대화(에이전트·id)는 한 번만 — 먼저 본 것(최신순이면 가장 최근)이 남는다 */
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

/**
 * 답 → 범위 목록. 프로젝트 줄 = 그 프로젝트의 모든 워크트리를 합친 것, 그 아래 워크트리 줄(워크트리가
 * 둘 이상일 때만 — 주 폴더 하나뿐이면 프로젝트 줄과 같은 것이다), 마지막에 **기타**(등록 경로 밖의
 * 대화) 와 그 폴더 줄(최신 폴더부터 [`OTHER_DIRS_MAX`] 개).
 */
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
    // 프로젝트 줄 = 그 워크트리들의 **서로 다른** 대화 수. 워크트리 줄도 같은 `uniq` 를 지나므로 자식 수가
    // 부모보다 클 수 없다(같은 대화가 파일 둘에 적힌 일이 실측으로 있었다 — Rust 도 거르지만 한 번 더).
    const all = uniq(paths.flatMap((path) => groupOf.get(pathKey(path))?.sessions ?? []).sort(byRecent));
    const key = `p:${p.id}`;
    conversations.set(key, all);
    rows.push({ key, kind: "project", label: p.name, path: p.path, count: all.length, missing: false, depth: 0 });
    if (trees.length === 0) continue;
    // 워크트리가 있으면 주 폴더도 한 줄 — 그래야 주 폴더만의 대화를 따로 볼 수 있다.
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
    // 대화가 이미 최신순이라 폴더도 처음 본 순서가 곧 최신순이다.
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

/** 목록 전체(묶음 + 기타)를 한 줄로 — 같은 대화가 두 번 서지 않는다. 최신순 */
export function flatConversations(list: ConversationList | null): AgentConversation[] {
  return uniq([...(list?.groups ?? []).flatMap((g) => g.sessions), ...(list?.others ?? [])].sort(byRecent));
}

/**
 * 대화가 든 범위 이름 — 팔레트 줄의 오른쪽 글자. 워크트리 > 프로젝트 > 기타 폴더(`~` 줄인 경로).
 */
export function scopeLabelOf(s: AgentConversation, rows: readonly ScopeRow[]): string {
  const k = pathKey(s.cwd);
  return (
    scopeLabelForPath(s.cwd, rows) ??
    rows.find((r) => r.kind === "otherDir" && r.path !== null && pathKey(r.path) === k)?.label ??
    tail(s.cwd)
  );
}

/**
 * 폴더 하나가 든 **가장 깊은 등록 범위**의 이름 — `<프로젝트> · <워크트리>`(워크트리 이름이 프로젝트 이름과 같으면
 * 하나) · 프로젝트. 등록된 프로젝트·워크트리 안이 아니면 `null`. [`scopeLabelOf`] 의 몸통이고, 메신저 알림의 이름
 * (`app/agent-notify.ts`)도 이것을 쓴다.
 */
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
// 팔레트 — `대화 <찾을 글자>` (docs/log/2026-09-26-agent-sessions.md)
// ---------------------------------------------------------------------------

/**
 * 팔레트를 지난 대화로 좁히는 **낱말 접두사** — 뒤에 빈칸(또는 그 낱말뿐). 두 언어의 낱말을 언제나 둘 다
 * 받는다(화면 언어와 손에 익은 낱말이 다를 수 있다). 글자 하나 접두사(`>`·`@`·`!` …)가 아닌 이유:
 * 남은 기호가 마땅치 않고, 대화는 이름으로 찾는 목록이라 낱말이 곧 뜻이다.
 */
export const CONVERSATION_QUERY_WORDS = ["대화", "conv"] as const;

/** 질의가 대화 접두사로 시작하면 그 뒤 글자(빈 글자일 수 있다), 아니면 `null` */
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

/** 팔레트 한 줄의 재료 — 이미 접어 둔 것(팔레트는 아무것도 읽지 않는다) */
export interface ConversationPaletteEntry {
  key: string;
  agent: string;
  id: string;
  title: string;
  /** 합성 제목 — 흐리게 기울여 그린다 */
  fallback: boolean;
  /** 오른쪽 글자 — 워크트리·프로젝트 이름 또는 줄인 폴더 */
  scope: string;
  updatedAt: number;
  /**
   * `open` = Aynx 타일에 열려 있다(Enter = 그 타일로 — 다른 창이면 그 창으로) · `missing` = 폴더가 없다(누를 수 없다) ·
   * `elsewhere` = aynx 밖에서 열려 있다([`openElsewhere`] — Enter 는 재개 대신 대시보드의 그 줄로 데려간다)
   */
  state: "ok" | "open" | "missing" | "elsewhere";
}

/** 목록 → 팔레트 줄들(최신순) */
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

/**
 * 팔레트의 대화 찾기 — 빈칸으로 가른 낱말이 **모두** 제목이나 범위 이름에 부분 글자로 들어 있어야 한다
 * (대소문자 무관). 팔레트의 다른 묶음은 부분수열(`fuzzyMatch`)로 거르지만, 대화 제목은 긴 문장이라
 * `resume` 여섯 글자가 흩어져 든 제목이 거의 다 걸린다(실기 발견) — 그래서 여기는 대시보드의 "제목 찾기"
 * 와 같은 부분 글자 규칙이다. 빈 질의는 다 통과(최신순 그대로).
 */
export function conversationMatches(query: string, e: { title: string; scope: string }): boolean {
  const words = query.trim().toLowerCase().split(/\s+/).filter((w) => w !== "");
  if (words.length === 0) return true;
  const hay = `${e.title} ${e.scope}`.toLowerCase();
  return words.every((w) => hay.includes(w));
}
