/**
 * 프로듀서 채팅의 순수 층 — 도구 알약은 `spawn_worker` 입력의 `role` 칸 말고는 입력 글을 싣지 않는다.
 * 이어진 같은 이름 · 같은 결과만 `×n` 으로 묶는다 — 사이에 다른 도구가 끼면 묶지 않는다(순서가 정보다).
 */

import type { ProducerAlbum, ProducerLife, ProducerQueueView, QueueState } from "../producer-api";
import type { RunAdoptable } from "./types";

/** 서버 `TILE_TOOLS` + 조정자 도구 — 알약 툴팁의 화면 문구 열쇠가 있는 것 */
export const COORD_TOOLS = [
  "adopt_run",
  "get_run",
  "create_task",
  "update_task",
  "wait_run",
  "spawn_worker",
  "stop_worker",
  "send_prompt",
  "read_worker",
  "get_diff",
  "complete_run",
] as const;
export type CoordTool = (typeof COORD_TOOLS)[number];

/** Claude `mcp__<서버>__<도구>` · Codex `<서버>.<도구>`(또는 `/` · `:`) */
export function toolBaseName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  const claude = /^mcp__.+?__([A-Za-z0-9_-]+)$/.exec(n);
  if (claude) return claude[1];
  const codex = /^[A-Za-z0-9_-]+[./:]([a-z][a-z0-9_]*)$/.exec(n);
  if (codex) return codex[1];
  return n;
}

export function isCoordTool(base: string): base is CoordTool {
  return (COORD_TOOLS as readonly string[]).includes(base);
}

const ROLE_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** `role` 칸만 읽는다 — 다른 칸은 읽지 않는다 */
function roleOf(input: string | null | undefined): string | null {
  if (!input) return null;
  try {
    const v: unknown = JSON.parse(input);
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const r = (v as Record<string, unknown>).role;
      if (typeof r === "string" && ROLE_RE.test(r)) return r;
    }
  } catch {
    /* 입력이 JSON 이 아니다 — 역할 없음 */
  }
  return null;
}

const CODE_TOOL_RE = /\btools\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

/**
 * Codex code mode 에서는 MCP 호출이 `exec`(JS) 안에서 나 기록의 도구 이름이 `exec` 하나뿐이다 — 그 안의 `tools.X(` 를 읽는다.
 * 표시만이다 — 실행 · 판정과 무관하다.
 */
export function codeModeTools(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const m of input.matchAll(CODE_TOOL_RE)) {
    const name = toolBaseName(m[1]);
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

const CODE_PILL_MAX = 3;

export function toolPillLabel(
  tool: { name: string | null; input: string | null },
  roleName?: (id: string) => string | null | undefined,
): string {
  const base = toolBaseName(tool.name);
  if (base === "spawn_worker") {
    const role = roleOf(tool.input);
    if (role) return `${base} role=${roleName?.(role)?.trim() || role}`;
  }
  if (base === "exec") {
    const inner = codeModeTools(tool.input);
    if (inner.length > 0) {
      const shown = inner.slice(0, CODE_PILL_MAX).join(" · ");
      return inner.length > CODE_PILL_MAX ? `${shown} …` : shown;
    }
  }
  return base;
}

/** 서버 `open` 도 같은 판정으로 `readOnly` 를 세운다 — 둘을 맞춘다 */
export function goneReadOnly(album: Pick<ProducerAlbum, "state" | "adoptable"> | null | undefined): boolean {
  return !!album && album.state === "orphaned" && !album.adoptable.restore;
}

export type PillState = "ok" | "err" | "running";

export interface ToolPill {
  label: string;
  base: string;
  state: PillState;
  count: number;
  indexes: number[];
}

export function groupToolPills(tools: readonly { label: string; state: PillState }[]): ToolPill[] {
  const out: ToolPill[] = [];
  tools.forEach((x, i) => {
    const last = out[out.length - 1];
    if (last && last.label === x.label && last.state === x.state && x.state !== "running") {
      last.count += 1;
      last.indexes.push(i);
      return;
    }
    out.push({ label: x.label, base: x.label.split(" ")[0], state: x.state, count: 1, indexes: [i] });
  });
  return out;
}

export interface QueueRow {
  clientId: string;
  state: QueueState;
  /** 다른 창이 보냈거나 새로 고침 앞이면 `null` */
  text: string | null;
  cancellable: boolean;
}

export function queueRows(view: ProducerQueueView | null | undefined, texts: Readonly<Record<string, string>>): QueueRow[] {
  if (!view) return [];
  return view.items
    .filter((q) => q.state === "queued" || q.state === "failed")
    .map((q) => ({ clientId: q.clientId, state: q.state, text: texts[q.clientId] ?? null, cancellable: q.state === "queued" }));
}

export function queueSummary(rows: readonly QueueRow[], held: boolean): { count: number; held: boolean; failed: number } {
  return { count: rows.length, held: held && rows.length > 0, failed: rows.filter((r) => r.state === "failed").length };
}

export function producerPhase(spec: { opened?: boolean } | null | undefined): "draft" | "chat" {
  return spec?.opened === true ? "chat" : "draft";
}

/** 잎을 떠나도 앨범 채팅은 산다 */
export function leafGoneAction(s: { remote: boolean; handoff: boolean; stillHere: boolean }): "keep" | "leave" {
  return s.stillHere ? "keep" : "leave";
}

export function producerOpenMode(tg: {
  conv: string | null;
  adoptRun?: string;
}): { kind: "resume"; conv: string } | { kind: "adopt"; run: string } {
  if (tg.conv) return { kind: "resume", conv: tg.conv };
  if (tg.adoptRun) return { kind: "adopt", run: tg.adoptRun };
  throw new Error("귀속된 앨범 또는 대화가 필요합니다");
}

export type ProducerActivity = "starting" | "responding" | "permission" | "waiting" | "rest" | "idle" | "ended" | "readOnly";

/**
 * 앨범이 돌아도 도는 아티스트 · 판정 · 통합이 없으면 기다릴 것이 없다(`rest`).
 * `album.busy` 가 없으면(목록 요약을 읽기 전) 기다리는 중으로 본다.
 */
export function producerActivity(s: {
  readOnly: boolean;
  life: ProducerLife | null;
  gone: boolean;
  status: string | null;
  sending: boolean;
  pending: number;
  album: (Pick<ProducerAlbum, "state"> & { busy?: boolean }) | null;
}): ProducerActivity {
  if (s.readOnly) return "readOnly";
  if (s.gone || s.life === "ended" || s.life === "exiting") return "ended";
  if (s.pending > 0) return "permission";
  if (s.status === "running") return "responding";
  if (s.sending || s.status === "starting") return "starting";
  if (s.album && s.album.state === "running") return s.album.busy === false ? "rest" : "waiting";
  return "idle";
}

export function albumBusy(r: { running: { write: number; judge: number }; taskStates?: Partial<Record<string, number>> | null }): boolean {
  return r.running.write + r.running.judge > 0 || (r.taskStates?.integrating ?? 0) > 0;
}

export function adoptKeepsPause(album: Pick<ProducerAlbum, "adoptable"> | null | undefined): boolean {
  return !!album && album.adoptable.restore && !album.adoptable.autoResume;
}

/** 서버 이어받기 판정과 같은 함수의 답이다 — 끝난 앨범의 채팅은 "기록만" 이다(이어받을 앨범이 없다) */
export function albumEnded(album: { adoptable: Pick<RunAdoptable, "why"> } | null | undefined): boolean {
  return album?.adoptable?.why === "ended";
}

/** 줄 수는 카드가 CSS 로 자른다. 글이 없으면 `null` — 카드를 숨긴다 */
export function finalePreview(
  items: readonly { role: string; text: string | null; at: number | null }[],
  max = 600,
): { text: string; at: number | null } | null {
  for (let i = items.length - 1; i >= 0; i -= 1) {
    const it = items[i];
    if (it.role !== "assistant" || !it.text) continue;
    const text = it.text
      .replace(/```[^\n]*\n?/g, "")
      .replace(/^\s{0,3}(?:#{1,6}\s+|>\s?|[-*+]\s+|\d+[.)]\s+)/gm, "")
      .replace(/(\*\*|__|`)/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    return { text: [...text].length > max ? `${[...text].slice(0, max).join("")}…` : text, at: it.at };
  }
  return null;
}

export const FINALE_REREAD_MS = 3000;

/**
 * 프로듀서는 `complete_run` 뒤에 최종 요약을 쓰므로 채팅이 열려 있는 동안 다시 읽는다 — 서버가 앨범 끝 채팅을 닫으면 저절로 끝난다.
 * 닫힘을 먼저 보고 읽는다 — 닫힌 뒤의 읽기가 마지막 말을 받는다.
 */
export function followFinale<T>(o: {
  isOpen: () => Promise<boolean>;
  read: () => Promise<T | null>;
  show: (value: T) => void;
  everyMs?: number;
}): () => void {
  let alive = true;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const step = async (): Promise<void> => {
    const open = await o.isOpen().catch(() => false);
    if (!alive) return;
    const value = await o.read().catch(() => null);
    if (!alive) return;
    if (value !== null) o.show(value);
    if (open) timer = setTimeout(() => void step(), o.everyMs ?? FINALE_REREAD_MS);
  };
  void step();
  return () => {
    alive = false;
    if (timer !== null) clearTimeout(timer);
  };
}

/** 사람이 끝냈으면 프로듀서의 마지막 말은 끝나기 전의 말이라 "프로듀서 마무리" 로 부르면 앞뒤가 어긋난다 */
export function endedByHuman(log: readonly { actor: string; action: string }[] | null | undefined): boolean {
  for (let i = (log?.length ?? 0) - 1; i >= 0; i -= 1) {
    const e = log![i];
    if (e.action === "run_done") return e.actor === "human";
    if (e.action === "human_stopped") return true;
  }
  return false;
}

export function restartableWhy(why: string | null | undefined): boolean {
  return why !== "closed" && why !== "close-all";
}

/** 서버 거절은 그대로다 — 화면이 먼저 까닭을 말할 뿐이다 */
export function producerSendClosed(s: { albumEnded: boolean; exitWhy: string | null; gone: string | null }): "albumEnded" | "closed" | null {
  if (s.albumEnded || s.exitWhy === "album-ended" || s.gone === "album-ended") return "albumEnded";
  if (s.gone !== null && !restartableWhy(s.gone)) return "closed";
  return null;
}

/**
 * 앨범 시작 직후 CLI 가 대화 파일을 아직 쓰지 않았을 수 있다 — Claude 는 대화 id 를 미리 받아 뜨므로 첫 턴 전에도 이 읽기가 돈다.
 * 턴이 끝난 뒤 · 닫힌 채팅의 실패는 그대로 보인다.
 */
export function historyNotYet(s: { status: string; ended: number } | null | undefined): boolean {
  return !!s && s.status !== "stopped" && s.ended === 0;
}

// ── 앱이 깨움 ──

/** 접기의 알림 항목 낱말(`detail` = wakeId) */
export const WAKE_NOTE = "app-woken";

export interface WakeChip {
  no: string;
  what: string;
}

function shortId(id: string): string {
  const hex = id.split("-")[1] ?? id;
  return hex.slice(0, 8);
}

/** 서버 문장은 쓰지 않는다 — 그것은 모델에게 간 영어 고정 글이고 화면은 같은 재료로 따로 짓는다 */
export function wakeChips(
  items: readonly { what: string; taskId: string | null; attemptId: string | null }[],
  d: { tasks: readonly { id: string }[]; attempts?: readonly { id: string; taskId: string }[] | null } | null,
): WakeChip[] {
  return items.map((it) => {
    const task = it.taskId ?? d?.attempts?.find((a) => a.id === it.attemptId)?.taskId ?? null;
    const idx = task && d ? d.tasks.findIndex((x) => x.id === task) : -1;
    const no = idx >= 0 ? `#${idx + 1}` : task ? shortId(task) : it.attemptId ? shortId(it.attemptId) : "";
    return { no, what: it.what };
  });
}

export type WakeMark = { kind: "wake"; record: { wakeId: string; fromSeq: number; toSeq: number } } | { kind: "unrecorded" } | null;

/** 예약은 쓰기 직전이다 */
const WAKE_AT_SLACK = 5_000;

/**
 * 예약 기록 한 줄은 한 번만 쓴다 — 사람이 깨움 문장을 그대로 쳐도 그 기록은 앞의 진짜 깨움이 가져가 "앱 기록 없음" 이 된다.
 * 표시용일 뿐이다 — 권한 · 커서 · 셈과 무관하다.
 */
export function wakeMarks(
  items: readonly { role: string; at: number | null; wake?: { sha: string } | null }[],
  records: readonly { wakeId: string; chat: string; sha: string; fromSeq: number; toSeq: number; at: number }[],
  chat: string,
): WakeMark[] {
  const used = new Set<number>();
  return items.map((it) => {
    if (it.role !== "user" || !it.wake) return null;
    const i = records.findIndex(
      (r, k) => !used.has(k) && r.chat === chat && r.sha === it.wake?.sha && (it.at === null || it.at >= r.at - WAKE_AT_SLACK),
    );
    if (i < 0) return { kind: "unrecorded" };
    used.add(i);
    const r = records[i];
    return { kind: "wake", record: { wakeId: r.wakeId, fromSeq: r.fromSeq, toSeq: r.toSeq } };
  });
}

export function wakeBanner(
  w: { off: string | null; segment: number; cap: number; total: number; max: number } | null | undefined,
  state: string | null | undefined,
): { why: string; segment: number; cap: number; total: number; max: number } | null {
  if (!w || w.off === null || state !== "running") return null;
  return { why: w.off, segment: w.segment, cap: w.cap, total: w.total, max: w.max };
}

/** 서버 `orchestration::wake::WakeKind` 의 낱말 */
export const WAKE_WHATS = [
  "reported-success",
  "reported-failure",
  "blocked",
  "idle-no-report",
  "spawn-failed",
  "turn-timeout",
  "review-pass",
  "review-changes",
  "review-ended",
  "integrated",
  "conflict",
  "verify-failed",
  "person-accepted",
  "person-rejected",
  "person-updated-task",
  "person-overrode-verify",
  "person-resumed",
  "person-released-hold",
  "person-reconciled",
  "album-changed",
] as const;
export type WakeWhat = (typeof WAKE_WHATS)[number];

export function isWakeWhat(w: string): w is WakeWhat {
  return (WAKE_WHATS as readonly string[]).includes(w);
}
