// 채팅 모양 AI 타일의 문구 · 권한 카드 본문 — 서버 글(`[이유] …`)과 사건 낱말을 화면 말로 바꾼다.

import { t } from "$lib/i18n/i18n.svelte.js";
import type { Key } from "$lib/i18n/keys";
import { REASONS, hasReason, stripReason, type ErrorReason } from "$lib/error-reason";
import { lineDiff, patchFiles, patchRows, type DiffRow } from "$lib/tile-permission";
import type { PermKind, RewindScope, SessionAllowView } from "$lib/side-chat-api";
import { parseCompactNotice } from "$lib/side-chat-live";
import { formatTokens } from "./chat-tile-context";
import { scopeHasFiles, type ChatTileRewindAsk, type ChatTileRewindTrace } from "./chat-tile-rewind";

const ERROR_KEY: readonly [ErrorReason, Key][] = [
  ["conversation-busy", "pane.chatTile.err.busy"],
  ["chat-tile-off", "pane.chatTile.err.off"],
  ["bad-cwd", "pane.chatTile.err.cwd"],
  ["cli-not-found", "pane.chatTile.err.notFound"],
  ["start-timeout", "pane.chatTile.err.timeout"],
  ["server-outdated", "pane.chatTile.err.outdated"],
  ["conversation-in-side-chat", "pane.chatTile.err.inSideChat"],
  ["conversation-not-found", "pane.chatTile.err.convNotFound"],
  ["conversation-folder-missing", "pane.chatTile.err.folderMissing"],
  ["bad-mode", "pane.chatTile.err.mode"],
  ["bad-answer", "pane.chatTile.err.answer"],
  ["no-session-allow", "pane.chatTile.err.noSessionAllow"],
  ["unsupported", "pane.chatTile.err.unsupported"],
  ["turn-running", "pane.chatTile.err.turnRunning"],
  ["not-started", "pane.chatTile.err.notStarted"],
  ["nothing-to-compact", "pane.chatTile.err.nothingToCompact"],
  ["bad-skill", "pane.chatTile.err.skill"],
  ["bad-instructions", "pane.chatTile.err.instructions"],
  ["bad-anchor", "pane.chatTile.rewind.err.bad"],
  ["bad-scope", "pane.chatTile.rewind.err.bad"],
  ["nothing-to-rewind", "pane.chatTile.rewind.err.nothing"],
  ["preview-first", "pane.chatTile.rewind.err.previewFirst"],
  ["rewind-running", "pane.chatTile.rewind.err.running"],
  ["rewind-timeout", "pane.chatTile.rewind.err.timeout"],
  ["rewind-failed", "pane.chatTile.rewind.err.failed"],
  ["bad-review-target", "pane.chatTile.review.err.target"],
  ["bad-objective", "pane.chatTile.goal.err.goal"],
  ["bad-goal", "pane.chatTile.goal.err.goal"],
  ["bad-budget", "pane.chatTile.goal.err.budget"],
  ["no-goal", "pane.chatTile.goal.err.none"],
  ["bad-tier", "pane.chatTile.tier.err"],
  ["mcp-status-busy", "pane.chatTile.mcp.busy"],
  // 첨부 판정 낱말은 서버 `side_chat` 과 같다
  ["too-many-attachments", "app.chatDock.err.tooMany"],
  ["too-many-images", "app.chatDock.err.tooMany"],
  ["file-too-big", "app.chatDock.err.tooBig"],
  ["image-too-big", "app.chatDock.err.tooBig"],
  ["file-outside", "app.chatDock.err.attachment"],
  ["file-missing", "app.chatDock.err.attachment"],
  ["file-not-file", "app.chatDock.err.attachment"],
  ["image-outside", "app.chatDock.err.attachment"],
  ["image-missing", "app.chatDock.err.attachment"],
  ["image-not-file", "app.chatDock.err.attachment"],
  ["image-type", "app.chatDock.err.attachment"],
];

/** 이유 코드 → 문구 · 모르는 이유는 표지만 떼고 서버 글 그대로 */
export function chatTileErrorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  for (const [reason, key] of ERROR_KEY) if (hasReason(msg, reason)) return t(key);
  return stripReason(msg);
}

/** `null` = 그리지 않는다(화면이 따로 알 일 없는 낱말) */
export function chatTileNoticeText(code: string, detail: string | null): string | null {
  const d = detail ?? "";
  switch (code) {
    case "needs-terminal":
      return t("pane.chatTile.notice.needsTerminal", { detail: d });
    case "untested-version":
      return t("pane.chatTile.notice.untested", { detail: d });
    case "handshake-failed":
      return t("pane.chatTile.notice.handshake");
    case "mcp-locked":
      return t("pane.chatTile.notice.mcpLocked", { detail: d });
    case "mcp-failed":
      return t("pane.chatTile.notice.mcpFailed", { detail: d });
    case "stderr":
      return t("app.chatDock.notice.stderr", { d });
    case "interrupt-failed":
      return t("app.chatDock.notice.interruptFailed");
    case "set-model-failed":
      return t("app.chatDock.notice.setModelFailed");
    case "set-effort-failed":
      return t("app.chatDock.notice.setEffortFailed");
    case "set-mode-failed":
      return t("pane.chatTile.notice.modeFailed", { detail: d });
    case "cli-retrying":
      return t("app.chatDock.notice.retrying");
    case "unsupported-request":
      return t("app.chatDock.notice.unsupported", { d });
    case "compacting":
      return t("pane.chatTile.compact.running");
    case "compacted": {
      // 압축 뒤 수는 CLI 마다 미터와 기준이 달라(시스템 지침 · 도구 빠짐 · 오히려 늘기도) 보이지 않는다
      const { pre } = parseCompactNotice(detail);
      return pre !== null ? t("pane.chatTile.compact.doneTokens", { pre: formatTokens(pre) }) : t("pane.chatTile.compact.done");
    }
    case "compact-failed":
      return t("pane.chatTile.compact.failed", { detail: d });
    case "compact-canceled":
      return t("pane.chatTile.compact.canceled");
    case "reviewing":
      return t("pane.chatTile.review.running", { label: d });
    case "reviewed":
      return t("pane.chatTile.review.done", { label: d });
    case "review-stopped":
      return t("pane.chatTile.review.stopped", { label: d });
    case "review-failed":
      return t("pane.chatTile.review.failed", { detail: d });
    case "goal-failed":
      return t("pane.chatTile.goal.failed", { detail: d });
    case "goal-feedback":
      return t("pane.chatTile.goal.feedback", { detail: d });
    // 화면이 남기는 안내 — Claude 에 `/goal <조건>` 을 보낸 뒤(`chat-tile-goal` 의 `claudeGoalSet`)
    case "goal-claude":
      return t("pane.chatTile.goal.claudeNote");
    case "mcp-status-failed":
      return t("pane.chatTile.mcp.failed");
    case "conversation-changed":
      return null;
    default:
      return d ? `${code}: ${d}` : code;
  }
}

// ── 권한 카드 본문 ──

export type ChatPermKind = "command" | "edit" | "write" | "notebook" | "patch" | "fetch" | "search" | "read" | "mcp" | "other";

// 카드는 사람이 허용하는 **것 자체**(명령 전체 · 도구 · 인자 · 내용)를 보인다 — 모델이 쓴 설명은 따로 · 흐리게.
export interface ChatPermView {
  kind: ChatPermKind;
  /** 경로 · 주소 — 모르면 `null`(명령은 `command`) */
  target: string | null;
  /** 실행할 명령 전체 — `truncated` = 너무 길어 앞부분만 왔다 */
  command: { text: string; cwd: string | null; truncated: boolean } | null;
  /** 에이전트가 밝힌 이유(모델이 쓴 글) */
  reason: string | null;
  mcp: { server: string; tool: string; args: string | null } | null;
  /** 입력에서 지은 줄 diff — 입력이 없거나(16 KiB 넘음 · Codex 파일) 고치기가 아니면 `null` */
  diff: DiffRow[] | null;
  /** Codex 패치(명령 감싸개 · 파일 승인) — 명령 카드에서도 `command` 는 그대로 채운다(카드가 실제 명령을 밑에 보인다) */
  patch: { rows: DiffRow[]; files: string[]; truncated: boolean } | null;
  /** 위 칸으로 못 그리면 서버의 `detail` 글 */
  text: string | null;
}

export interface ChatPermSource {
  permKind: PermKind;
  toolName: string;
  title: string;
  detail: string;
}

const ARGS_MAX = 4000;

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function str(v: unknown, key: string): string | null {
  return isObj(v) && typeof v[key] === "string" ? (v[key] as string) : null;
}

const READ_TOOLS = new Set(["Read", "Glob", "Grep", "LS"]);

function claudeKind(tool: string): ChatPermKind {
  if (tool === "Bash") return "command";
  if (tool === "Edit" || tool === "MultiEdit") return "edit";
  if (tool === "Write") return "write";
  if (tool === "NotebookEdit") return "notebook";
  if (tool === "WebFetch") return "fetch";
  if (tool === "WebSearch") return "search";
  if (READ_TOOLS.has(tool)) return "read";
  if (tool.startsWith("mcp__")) return "mcp";
  return "other";
}

/** 빈 객체 = 인자 없음(`null`) · 길면 자른다 */
export function mcpArgsText(args: unknown): string | null {
  if (args === undefined || args === null) return null;
  if (isObj(args) && Object.keys(args).length === 0) return null;
  let text: string;
  try {
    text = typeof args === "string" ? args : JSON.stringify(args, null, 2);
  } catch {
    return null;
  }
  return text.length > ARGS_MAX ? `${text.slice(0, ARGS_MAX)}\n…` : text;
}

/** 어댑터 제목 `서버 · 도구`, 없으면 `mcp__서버__도구` */
function mcpName(perm: ChatPermSource): { server: string; tool: string } {
  const sep = perm.title.indexOf(" · ");
  if (sep > 0) return { server: perm.title.slice(0, sep), tool: perm.title.slice(sep + 3) };
  const rest = perm.toolName.startsWith("mcp__") ? perm.toolName.slice(5) : perm.toolName;
  const at = rest.indexOf("__");
  return at > 0 ? { server: rest.slice(0, at), tool: rest.slice(at + 2) } : { server: rest, tool: "" };
}

/** 같은 경로를 두 번 보이지 않는다 — Claude 의 설명 글은 대상 그대로이거나 홈을 `~` 로 줄인 꼴이다(실측 Read) */
function samePlace(detail: string, target: string): boolean {
  const norm = (x: string) => x.trim().replace(/\\/g, "/").toLowerCase();
  const d = norm(detail);
  const t = norm(target);
  return d === t || (d.startsWith("~/") && t.endsWith(d.slice(1)));
}

function placed(base: ChatPermView, target: string | null): ChatPermView {
  return { ...base, target, text: target !== null && base.text !== null && samePlace(base.text, target) ? null : base.text };
}

/** 머리(`---` · `+++`)는 첫 `@@` 앞에서만 — 지운 줄 `-- x` 가 `--- x` 로 보이는 것과 가른다 */
export function unifiedRows(text: string): DiffRow[] {
  const rows: DiffRow[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  let inHunk = false;
  for (const l of lines) {
    if (l.startsWith("\\ ")) continue;
    if (l.startsWith("@@")) {
      inHunk = true;
      rows.push({ op: "hunk", text: l });
    } else if (l.startsWith("diff --git ")) {
      inHunk = false;
      rows.push({ op: "hunk", text: l });
    } else if (!inHunk && (l.startsWith("--- ") || l.startsWith("+++ ") || l.startsWith("index "))) rows.push({ op: "hunk", text: l });
    else if (l.startsWith("+")) rows.push({ op: "+", text: l.slice(1) });
    else if (l.startsWith("-")) rows.push({ op: "-", text: l.slice(1) });
    else rows.push({ op: " ", text: l.startsWith(" ") ? l.slice(1) : l });
  }
  return rows;
}

/** 어댑터가 지은 `{patch, patchKind, patchTruncated?, files?}` — 모르는 `patchKind` 는 그리지 않는다 */
function patchOf(input: unknown): ChatPermView["patch"] {
  const patch = str(input, "patch");
  if (patch === null || !isObj(input)) return null;
  const kind = input.patchKind;
  const rows = kind === "applyPatch" ? patchRows(patch) : kind === "unified" ? unifiedRows(patch) : null;
  if (rows === null) return null;
  const listed = Array.isArray(input.files) ? input.files.filter((f): f is string => typeof f === "string" && f !== "") : null;
  return { rows, files: listed ?? patchFiles(patch), truncated: input.patchTruncated === true };
}

/** 긴 규칙 · 경로를 보일 만큼만 — 긴 16진 이름을 줄이고, 넘치면 가운데를 줄여 끝(의미 있는 쪽)을 더 남긴다. 실제 값은 툴팁에 */
export function shortDetail(s: string, max = 56): string {
  const x = s.replace(/[0-9a-f]{16,}/gi, (h) => `${h.slice(0, 8)}…`);
  if (x.length <= max) return x;
  const head = Math.max(6, Math.floor(max * 0.3));
  const tail = max - head - 1;
  return `${x.slice(0, head)}…${x.slice(x.length - tail)}`;
}

/** [이 대화에서 늘 허용] 단추 글 — 누르면 실제로 무엇이 되는지를 말한다. 긴 규칙은 줄여 보이고 `full` 이면 그대로(툴팁) */
export function sessionAllowLabel(s: SessionAllowView, full = false): string {
  switch (s.kind) {
    case "mode":
      return t("pane.chatTile.perm.session.mode");
    case "rules":
      return t("pane.chatTile.perm.session.rules", { detail: full ? s.detail : shortDetail(s.detail) });
    case "dirs":
      return t("pane.chatTile.perm.session.dirs", { detail: full ? s.detail : shortDetail(s.detail) });
    case "command":
      return t("pane.chatTile.perm.session.command");
  }
}

/**
 * Claude 의 입력은 도구 입력 그대로, Codex 는 채팅 타일 어댑터가 지은 꼴 — 명령 `{command, cwd, reason, commandTruncated?}` ·
 * MCP `{server, tool, arguments?}` · 패치(명령 · 파일 승인) `{patch, patchKind, patchTruncated?, files?}`. 입력이 없으면(상한 넘음) 어댑터의 제목 · 설명 글로 그린다.
 */
export function chatPermView(perm: ChatPermSource, input: unknown): ChatPermView {
  const kind: ChatPermKind =
    perm.permKind === "fileChange" ? "patch" : perm.permKind === "mcpTool" ? "mcp" : perm.permKind === "command" ? "command" : claudeKind(perm.toolName);
  const detail = perm.detail.trim() === "" ? null : perm.detail;
  const base: ChatPermView = { kind, target: null, command: null, reason: null, mcp: null, diff: null, patch: null, text: detail };
  if (kind === "mcp") {
    // Codex 꼴은 `server` 열쇠가 있다 — Claude 의 도구 인자와 가른다(Codex 의 도구 이름은 그 열쇠에서)
    const shaped = perm.toolName === `mcp__${str(input, "server") ?? "\0"}__${str(input, "tool") ?? ""}`;
    const name = shaped ? { server: str(input, "server") ?? "", tool: str(input, "tool") ?? "" } : mcpName(perm);
    const raw = shaped ? (input as Record<string, unknown>).arguments : input;
    const args = raw !== undefined ? mcpArgsText(raw) : detail;
    return { ...base, mcp: { ...name, args }, text: null };
  }
  if (kind === "command") {
    const text = str(input, "command");
    if (text === null) {
      // 입력 없음 — Codex 제목은 명령의 한 줄 요약이라 잘렸다고 본다
      return perm.permKind === "command" && perm.title.trim() !== "" ? { ...base, command: { text: perm.title, cwd: null, truncated: true } } : base;
    }
    const reason = (str(input, "reason") ?? str(input, "description"))?.trim() || null;
    const truncated = isObj(input) && input.commandTruncated === true;
    return { ...base, command: { text, cwd: str(input, "cwd"), truncated }, reason, patch: patchOf(input), text: null };
  }
  if (!isObj(input)) return base;
  switch (kind) {
    case "patch": {
      const patch = patchOf(input);
      return patch ? { ...base, patch, reason: str(input, "reason")?.trim() || null, text: null } : base;
    }
    case "edit": {
      const edits = Array.isArray(input.edits) ? input.edits : [input];
      const rows: DiffRow[] = [];
      edits.forEach((e, k) => {
        if (k > 0) rows.push({ op: "gap", text: "" });
        rows.push(...lineDiff(str(e, "old_string") ?? "", str(e, "new_string") ?? ""));
      });
      return { ...base, target: str(input, "file_path"), diff: rows, text: null };
    }
    case "write":
      return { ...base, target: str(input, "file_path"), diff: lineDiff("", str(input, "content") ?? ""), text: null };
    case "notebook":
      return { ...base, target: str(input, "notebook_path"), diff: lineDiff("", str(input, "new_source") ?? ""), text: null };
    case "read":
      return placed(base, str(input, "file_path") ?? str(input, "path") ?? str(input, "pattern"));
    case "fetch":
      return placed(base, str(input, "url"));
    case "search":
      return placed(base, str(input, "query"));
    default:
      return base;
  }
}

/** 카드의 "무엇을" 줄 — AI 타일 권한 카드와 같은 낱말 */
export function chatPermKindText(v: Pick<ChatPermView, "kind">, tool: string): string {
  if (v.kind === "other") return t("pane.perm.title.other", { tool: tool || "?" });
  return t(`pane.perm.title.${v.kind}` as Key);
}

// ── 되감기 카드 · 흔적 ──

export interface RewindLine {
  key: Key;
  vars?: Record<string, string | number>;
}

const SCOPE_KEY: Record<RewindScope, Key> = {
  both: "pane.chatTile.rewind.scope.both",
  conversation: "pane.chatTile.rewind.scope.conversation",
  files: "pane.chatTile.rewind.scope.files",
};

const CONFIRM_KEY: Record<RewindScope, Key> = {
  both: "pane.chatTile.rewind.both.confirm",
  conversation: "pane.chatTile.rewind.convo.confirm",
  files: "pane.chatTile.rewind.files.confirm",
};

/** 범위 고르기 칸의 글 */
export function rewindScopeKey(scope: RewindScope): Key {
  return SCOPE_KEY[scope];
}

/** [실행] 단추 글 — 미리 본 범위의 것 */
export function rewindConfirmKey(scope: RewindScope): Key {
  return CONFIRM_KEY[scope];
}

/** 기록 줄 단추의 title — 기본 범위(`rewindScopes` 의 앞)를 말한다 */
export function rewindActionKey(scopes: readonly RewindScope[]): Key {
  const first = scopes[0];
  return first === "both" ? "pane.chatTile.rewind.action.both" : first === "files" ? "pane.chatTile.rewind.action.files" : "pane.chatTile.rewind.action.convo";
}

/** 카드 머리 — 범위를 고를 수 있으면 하나로 · 아니면 그 범위의 것 */
export function rewindTitleKey(scopes: readonly RewindScope[]): Key {
  if (scopes.length > 1) return "pane.chatTile.rewind.title";
  return scopes[0] === "files" ? "pane.chatTile.rewind.files.title" : "pane.chatTile.rewind.convo.title";
}

const NO_CHECKPOINT = ["file rewinding is not enabled", "no file checkpoint found"];

function isNoCheckpoint(error: string): boolean {
  const e = error.trim().toLowerCase();
  return NO_CHECKPOINT.some((x) => e.startsWith(x));
}

/**
 * CLI 가 준 되감기 거절 글 → 문구 줄. 기준점 거절(`stale_target` · `target_not_found`)은 압축을 알 때만 "압축 전 메시지" 로 읽고, 아니면 일반 실패.
 * 모르는 글은 `cliSaid` 로 그대로.
 */
export function rewindCliLine(error: string, compacted: boolean): RewindLine {
  const e = error.trim();
  const low = e.toLowerCase();
  if (isNoCheckpoint(e)) return { key: "pane.chatTile.rewind.files.noCheckpoint" };
  if (low === "before_compact") return { key: "pane.chatTile.rewind.err.beforeCompact" };
  if (low === "stale_target" || low === "target_not_found") return { key: compacted ? "pane.chatTile.rewind.err.beforeCompact" : "pane.chatTile.rewind.err.failed" };
  if (low === "turn_running") return { key: "pane.chatTile.err.turnRunning" };
  if (low === "unsupported") return { key: "pane.chatTile.rewind.err.terminal" };
  if (low.includes("only supports paginated threads")) return { key: "pane.chatTile.rewind.err.legacy" };
  if (low.startsWith("turn not found")) return { key: "pane.chatTile.rewind.err.turnNotFound" };
  return { key: "pane.chatTile.rewind.cliSaid", vars: { detail: e } };
}

function lineText(l: RewindLine): string {
  return t(l.key, l.vars);
}

/** 카드의 오류 줄 — 서버 글(`[이유] …`) · CLI 거절 글 · 압축 · `both` 의 반쪽 실패. 없으면 null */
export function rewindErrorText(ask: Pick<ChatTileRewindAsk, "error" | "filesDone" | "compacted" | "scope">): string | null {
  const err = ask.error;
  if (err === null || err.trim() === "") return null;
  let body: string;
  if (hasReason(err, "unsupported")) body = t("pane.chatTile.rewind.err.terminal");
  else if (hasReason(err, "exited")) body = t("pane.chatTile.rewind.err.exited");
  else if (REASONS.some((r) => hasReason(err, r))) body = chatTileErrorText(err);
  else {
    const line = rewindCliLine(err, ask.compacted);
    body = lineText(line);
    // 일반 실패 문구만으로는 까닭을 모른다 — CLI 의 낱말을 곁에
    if (line.key === "pane.chatTile.rewind.err.failed") body += ` (${t("pane.chatTile.rewind.cliSaid", { detail: err.trim() })})`;
    if (line.key === "pane.chatTile.rewind.files.noCheckpoint" && ask.scope === "both" && !ask.filesDone) body += ` ${t("pane.chatTile.rewind.both.convoOnly")}`;
  }
  return ask.filesDone ? `${t("pane.chatTile.rewind.partial")} — ${body}` : body;
}

/**
 * [다시 시도]가 뜻이 있나 — 압축 전 기준점 · 이 CLI 가 못 하는 되감기 · 없는 기준점 · 파일 기록 없음은 다시 해도 같다.
 * 서버 글(`[이유] …`)은 `[unsupported]` 만 막는다.
 */
export function rewindRetryable(error: string | null): boolean {
  if (error === null || error.trim() === "") return false;
  if (hasReason(error, "unsupported")) return false;
  if (error.trim().startsWith("[")) return true;
  const low = error.trim().toLowerCase();
  if (isNoCheckpoint(low)) return false;
  if (low === "before_compact" || low === "unsupported" || low === "target_not_found") return false;
  return !(low.startsWith("turn not found") || low.includes("only supports paginated threads"));
}

function loadingLine(ask: ChatTileRewindAsk): RewindLine {
  return { key: scopeHasFiles(ask.scope) ? "pane.chatTile.rewind.files.loading" : "pane.chatTile.rewind.convo.loading" };
}

/** 카드 본문 줄들 — 키와 값만(파일 목록은 화면이 그린다). 미리 보기가 없으면(오류 뒤) 빈 목록 */
export function rewindCardLines(ask: ChatTileRewindAsk, cli: "claude" | "codex"): RewindLine[] {
  if (ask.phase === "loading") return [loadingLine(ask)];
  const p = ask.preview;
  if (!p) return [];
  const reason = p.error && p.error.trim() !== "" ? rewindCliLine(p.error, ask.compacted) : null;
  if (!p.can) {
    if (cli === "claude" && scopeHasFiles(ask.scope)) {
      const out: RewindLine[] = [{ key: "pane.chatTile.rewind.files.noCheckpoint" }];
      if (reason && reason.key !== "pane.chatTile.rewind.files.noCheckpoint") out.push(reason);
      if (ask.scope === "both") out.push({ key: "pane.chatTile.rewind.both.convoOnly" });
      return out;
    }
    return reason ? [{ key: "pane.chatTile.rewind.convo.cannot" }, reason] : [{ key: "pane.chatTile.rewind.convo.cannot" }];
  }
  if (cli === "codex") {
    const n = p.turns ?? ask.localTurns;
    const out: RewindLine[] = [
      n !== null ? { key: "pane.chatTile.rewind.convo.count", vars: { n } } : { key: "pane.chatTile.rewind.convo.countUnknown" },
      { key: "pane.chatTile.rewind.convo.forget" },
      { key: "pane.chatTile.rewind.convo.filesStay" },
    ];
    if (ask.localFiles && ask.localFiles.length > 0) out.push({ key: "pane.chatTile.rewind.convo.filesHint" });
    out.push({ key: "pane.chatTile.rewind.convo.codexFiles" });
    return out;
  }
  if (ask.scope === "conversation") return [{ key: "pane.chatTile.rewind.convo.claude" }, { key: "pane.chatTile.rewind.convo.claudeFilesStay" }];
  const n = p.files.length + p.moreFiles;
  const out: RewindLine[] = [];
  if (n > 0) {
    out.push(
      p.insertions !== null && p.deletions !== null
        ? { key: "pane.chatTile.rewind.files.count", vars: { n, ins: p.insertions, del: p.deletions } }
        : { key: "pane.chatTile.rewind.files.countNoLines", vars: { n } },
    );
    if (ask.scope === "files") out.push({ key: "pane.chatTile.rewind.files.keepConvo" });
    out.push({ key: "pane.chatTile.rewind.files.onlyTracked" });
  } else {
    out.push({ key: "pane.chatTile.rewind.files.none" });
    if (ask.scope === "files") out.push({ key: "pane.chatTile.rewind.files.keepConvo" });
  }
  if (ask.scope === "both") out.push({ key: "pane.chatTile.rewind.convo.claude" });
  return out;
}

/** 되돌릴 수 없는 쪽이 앞 — 파일(누가 고쳤든 사라진다) → 대화(CLI 가 잊는다) */
const PIN_ORDER: Key[] = ["pane.chatTile.rewind.files.onlyTracked", "pane.chatTile.rewind.convo.claude", "pane.chatTile.rewind.convo.forget"];

/** 낮은 카드에서 [실행] 곁에 붙여 둘 경고 줄 하나 — 본문의 줄 가운데 가장 무거운 것. 없으면 null */
export function rewindPinnedKey(lines: readonly RewindLine[]): Key | null {
  return PIN_ORDER.find((k) => lines.some((l) => l.key === k)) ?? null;
}

/** 흔적 한 줄 — 다른 창이 한 것은 인용이 없다 */
export function rewindTraceText(x: ChatTileRewindTrace): string {
  const links = x.skippedLinks !== null && x.skippedLinks > 0 ? ` ${t("pane.chatTile.rewind.trace.links", { n: x.skippedLinks })}` : "";
  if (x.scope === "conversation") return x.quote ? t("pane.chatTile.rewind.trace.convo", { quote: x.quote }) : t("pane.chatTile.rewind.trace.convoOther");
  if (x.scope === "both") return (x.quote ? t("pane.chatTile.rewind.trace.both", { quote: x.quote }) : t("pane.chatTile.rewind.trace.bothOther")) + links;
  const head = x.files !== null && x.quote ? t("pane.chatTile.rewind.trace.files", { n: x.files, quote: x.quote }) : t("pane.chatTile.rewind.trace.filesNoCount");
  return head + links;
}
