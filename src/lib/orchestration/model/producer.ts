/**
 * **프로듀서 채팅의 순수 층**(오케스트레이션 2단계 "구조화 프로듀서" 단계 3 — aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md
 * 4-2 · 5-1 · 5-2 · 확정 목업 `CoordChat`).
 *
 * 상태 · 문구 · 호출이 없다(시험 `producer.test.ts`). 상태는 `app/producer-chat.svelte.ts`, 그림은 `player/ProducerChat.svelte`.
 *
 * - **도구 알약**([`toolPillLabel`] · [`groupToolPills`]) — 도구 줄을 알약으로: 서버 접두(`mcp__<서버>__` · Codex 의 `<서버>.`)를 떼고,
 *   `spawn_worker` 는 입력의 `role` 칸만 붙인다(역할 이름으로 — 다른 입력 글은 싣지 않는다). Codex code mode 의 `exec` 는 안에서 부른 도구
 *   이름([`codeModeTools`]). 이어진 같은 이름 · 같은 결과만 하나로 묶어 `×n` — 사이에 다른 도구가 끼면 묶지 않는다(순서가 정보다).
 * - **기록만 판정**([`goneReadOnly`]) — 서버 표에 없는 채팅의 귀속 앨범이 orphaned 이고 되찾을 수 없으면 처음부터 기록만.
 * - **대기열 줄**([`queueRows`]) — 서버 대기열 보기(글 없음)에 이 창이 보낸 글을 맞춘다(다른 창이 보낸 글은 `null`).
 * - **잎의 갈래**([`producerPhase`]) — 아직 안 연 프로듀서 잎은 "새 앨범" 칸(초안), 연 뒤는 채팅.
 * - **머리 상태 낱말**([`producerActivity`]) — 응답 중 · 권한 대기 · 시작 중 · 작업자 기다리는 중(앨범에 묶였고 쉰다) · 쉼 · 끝남 · 기록만.
 */

import type { ProducerAlbum, ProducerLife, ProducerQueueView, QueueState } from "../producer-api";
import type { RunAdoptable } from "./types";

/** 조율 도구(서버 `TILE_TOOLS` + 조정자 도구) — 알약 툴팁의 화면 문구 열쇠가 있는 것 */
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

/** 서버 접두를 뗀 도구 이름 — Claude `mcp__<서버>__<도구>` · Codex `<서버>.<도구>`(또는 `/` · `:`). 그 밖은 그대로 */
export function toolBaseName(name: string | null | undefined): string {
  const n = (name ?? "").trim();
  const claude = /^mcp__.+?__([A-Za-z0-9_-]+)$/.exec(n);
  if (claude) return claude[1];
  const codex = /^[A-Za-z0-9_-]+[./:]([a-z][a-z0-9_]*)$/.exec(n);
  if (codex) return codex[1];
  return n;
}

/** 조율 도구인가(서버 접두를 뗀 이름) */
export function isCoordTool(base: string): base is CoordTool {
  return (COORD_TOOLS as readonly string[]).includes(base);
}

/** 역할 id 모양(서버 역할 표 id — 영숫자 · `-` · `_`) */
const ROLE_RE = /^[A-Za-z0-9_-]{1,40}$/;

/** 입력 JSON 의 `role` 칸만 — 모양이 아니면 `null`(다른 칸은 읽지 않는다) */
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

/** Codex code mode 의 JS 안에서 부른 도구 — `tools.<이름>(` (`tools.mcp__<서버>__<도구>(` · `tools.exec_command(`) */
const CODE_TOOL_RE = /\btools\.([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;

/**
 * **Codex code mode 의 `exec` 한 번이 부른 도구들**(실기 a FAIL 1 — 10-30: Codex 0.165 의 모델은 모두 `tool_mode: code_mode_only` 라 MCP 호출이
 * `exec`(JS) 안에서 난다 · 기록에는 도구 이름이 `exec` 하나뿐). 펼친 JS 의 `tools.X(` 를 차례대로(같은 이름은 한 번) 서버 접두를 떼어 돌려준다.
 * **표시만** — 실행 · 판정과 무관하다(입력 글은 알약 이름 말고는 싣지 않는다). 못 찾으면 빈 목록.
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

/** code mode `exec` 알약에 보일 이름 수(넘으면 `…`) */
const CODE_PILL_MAX = 3;

/**
 * 알약 글자 — `start_run` · `spawn_worker role=구현`(역할은 `roleName` 이 스튜디오 역할 표에서 이름을 찾으면 이름 · 없으면 id) ·
 * Codex code mode 의 `exec` 는 그 안에서 부른 도구 이름(`list_db_connections · db_query` — 없으면 `exec`).
 */
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

/**
 * **서버 표에 없는 채팅이 기록만인가**(실기 a FAIL 2 — 10-30) — 귀속 앨범이 orphaned(서버 재시작)이고 서버 판정이 귀속을 되찾을 수 없다고
 * 하면(`adoptable.restore: false`) 처음부터 "기록만"(입력 끔 · [다시 띄우기] 없음). 서버 `open` 도 같은 판정으로 `readOnly` 를 세운다.
 */
export function goneReadOnly(album: Pick<ProducerAlbum, "state" | "adoptable"> | null | undefined): boolean {
  return !!album && album.state === "orphaned" && !album.adoptable.restore;
}

export type PillState = "ok" | "err" | "running";

/** 알약 하나 — 이어진 같은 글자 · 같은 결과 묶음(`indexes` = 그 묶음의 도구 줄 차례) */
export interface ToolPill {
  label: string;
  base: string;
  state: PillState;
  count: number;
  indexes: number[];
}

/** 이어진 도구 줄 → 알약(같은 글자 · 같은 결과가 이어지면 `×n` 으로 묶는다 · 도는 것은 묶지 않는다) */
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

/** 대기열 줄 하나 */
export interface QueueRow {
  clientId: string;
  state: QueueState;
  /** 이 창이 보낸 글(다른 창 · 새로 고침 앞이면 `null`) */
  text: string | null;
  /** [취소] 할 수 있나(아직 보내지 않은 것만 — 보낸 것은 서버가 `[already-sent]`) */
  cancellable: boolean;
}

/** 서버 대기열 보기 + 이 창이 쥔 글 → 줄(보냈거나 취소한 것은 뺀다) */
export function queueRows(view: ProducerQueueView | null | undefined, texts: Readonly<Record<string, string>>): QueueRow[] {
  if (!view) return [];
  return view.items
    .filter((q) => q.state === "queued" || q.state === "failed")
    .map((q) => ({ clientId: q.clientId, state: q.state, text: texts[q.clientId] ?? null, cancellable: q.state === "queued" }));
}

/** 대기열 줄의 머리 모양 — 수 · 보류(✕ · 오류 · 프로세스 끝 — [보내기]) · 보내지 못한 것([다시 보내기]) */
export function queueSummary(rows: readonly QueueRow[], held: boolean): { count: number; held: boolean; failed: number } {
  return { count: rows.length, held: held && rows.length > 0, failed: rows.filter((r) => r.state === "failed").length };
}

/** 프로듀서 잎의 갈래 — 아직 안 열었으면 "새 앨범" 칸(초안), 열었으면 채팅 */
export function producerPhase(spec: { opened?: boolean } | null | undefined): "draft" | "chat" {
  return spec?.opened === true ? "chat" : "draft";
}

/** 잎을 떠나도 앨범 채팅은 산다. 이 창에 남은 잎이면 구독을 유지한다. */
export function leafGoneAction(s: { remote: boolean; handoff: boolean; stillHere: boolean }): "keep" | "leave" {
  return s.stillHere ? "keep" : "leave";
}

/** 앨범 대화 재부착·이어받기만 연다. */
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
 * **머리 상태 낱말**(목업 `CoordChat` 의 머리 칩) — 기록만(orphaned) > 끝남 > 권한 대기 > 응답 중 > 시작 중 > 작업자 기다리는 중(묶인 앨범이
 * 돌고 프로듀서는 쉰다) > 쉼. 앨범이 돌아도 **도는 아티스트 · 판정 · 통합이 없으면** 기다릴 것이 없다 — "쉼 — 말하면 이어 갑니다"(`rest` · 실기 b 고침 G:
 * 깨움 턴을 ✕ 로 끊은 뒤 "작업자 기다리는 중" 으로 남았다). `album.busy` 가 없으면(목록 요약을 읽기 전 — 서버 스냅숏의 앨범) 기다리는 중으로 본다.
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

/** 앨범에서 프로듀서가 기다릴 일이 도나(목록 요약 — 턴이 살 수 있는 아티스트 · 판정 Attempt · 통합 중 트랙) */
export function albumBusy(r: { running: { write: number; judge: number }; taskStates?: Partial<Record<string, number>> | null }): boolean {
  return r.running.write + r.running.judge > 0 || (r.taskStates?.integrating ?? 0) > 0;
}

/** 이어받기 채우기 글이 "멈춤은 그대로" 를 말해야 하나(서버 판정 `adoptable.autoResume` 이 거짓 — 사람이 멈춤 · 거두기) */
export function adoptKeepsPause(album: Pick<ProducerAlbum, "adoptable"> | null | undefined): boolean {
  return !!album && album.adoptable.restore && !album.adoptable.autoResume;
}

/**
 * 그 채팅의 앨범이 끝났나(실기 b 고침 E) — 서버 이어받기 판정 `adoptable.why === "ended"`(`adopt_verdict` · `adopt_run` 과 같은 함수 — 중단 중 · 중단 ·
 * 완료). 끝난 앨범의 채팅은 "다시 띄워 이어받으라" 가 아니라 "기록만" 이다(이어받을 앨범이 없다).
 */
export function albumEnded(album: { adoptable: Pick<RunAdoptable, "why"> } | null | undefined): boolean {
  return album?.adoptable?.why === "ended";
}

/**
 * **프로듀서 마무리 카드의 글**(10-31 — 목업 V3AlbumDone) — 기록 한 쪽(옛것 → 새것)에서 마지막 어시스턴트 말 하나. 마크다운 표시(굵게 · 코드 ·
 * 머리 · 인용 · 목록 머리)를 걷고 공백을 한 칸으로 접어 `max` 자에서 자른다(줄 수는 카드가 CSS 로 자른다). 글이 없으면 `null` — 카드를 숨긴다.
 */
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

/** 마무리 카드가 프로듀서의 마지막 말을 다시 읽는 틈 */
export const FINALE_REREAD_MS = 3000;

/**
 * **마무리 카드의 글 따라가기**(2026-11-07) — 앨범은 `complete_run` 순간에 끝나고 프로듀서는 **그 뒤에** 최종 요약을 쓴다. 끝난 순간 한 번만 읽으면
 * 중간 말이 남으므로, 채팅이 열려 있는 동안 다시 읽는다. 서버가 앨범 끝 채팅을 쉬는 순간(늦어도 `ALBUM_END_GRACE` 뒤) 닫으니 이 고리는 저절로 끝난다.
 * 닫힘을 **먼저** 보고 읽는다 — 닫힌 뒤의 읽기가 마지막 말을 받는다. 읽기 실패 · 글 없음은 보이던 글을 지우지 않는다. 돌려주는 함수로 멈춘다.
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

/**
 * 앨범을 **사람이 끝냈나**(2026-11-05) — 장부에서 끝 기록을 최신 쪽부터 찾는다: 완료(`run_done`)는 그 주체 · 중단(`human_stopped`)은 늘 사람.
 * 그때 프로듀서의 마지막 말은 끝나기 **전**의 말이라 "프로듀서 마무리" 로 부르면 앞뒤가 어긋난다. 끝 기록을 못 찾으면 `false`.
 */
export function endedByHuman(log: readonly { actor: string; action: string }[] | null | undefined): boolean {
  for (let i = (log?.length ?? 0) - 1; i >= 0; i -= 1) {
    const e = log![i];
    if (e.action === "run_done") return e.actor === "human";
    if (e.action === "human_stopped") return true;
  }
  return false;
}

/** 끝난 이유 → 다시 말하면 이어 가나(닫기 · 모두 닫기 · 기록만 빼고) */
export function restartableWhy(why: string | null | undefined): boolean {
  return why !== "closed" && why !== "close-all";
}

/**
 * 입력 칸을 끄나 — 앨범이 끝났거나(서버 판정 `adoptable.why` · 끝 사건 · 표에 없는 이유가 `album-ended`) 사람이 프로듀서를 끝냈다(다시 띄우지
 * 않는 이유). 실기 34: 끝난 앨범에도 칸이 켜져 보낸 말이 "보내지 못했습니다" 로 남았다. 서버 거절은 그대로 — 화면이 먼저 까닭을 말한다.
 */
export function producerSendClosed(s: { albumEnded: boolean; exitWhy: string | null; gone: string | null }): "albumEnded" | "closed" | null {
  if (s.albumEnded || s.exitWhy === "album-ended" || s.gone === "album-ended") return "albumEnded";
  if (s.gone !== null && !restartableWhy(s.gone)) return "closed";
  return null;
}

/**
 * 기록 읽기 실패를 "아직 기록 없음" 으로 보나 — 이 페이지에서 끝난 턴이 없고 프로세스가 살아 있다(앨범 시작 직후 CLI 가 대화 파일을 아직 쓰지 않았다 —
 * 실기 18). Claude 는 대화 id 를 미리 받아 뜨므로 첫 턴이 서기 전(`starting` · `ready`)에도 이 읽기가 돈다(2026-11-07 — README GIF 에 찍힌 오류).
 * 턴이 끝나면 화면이 기록을 다시 읽고, 그때의 실패는 그대로 보인다. 닫힌 채팅(`stopped`)의 실패도 그대로 보인다.
 */
export function historyNotYet(s: { status: string; ended: number } | null | undefined): boolean {
  return !!s && s.status !== "stopped" && s.ended === 0;
}

// ---------------------------------------------------------------------------
// 앱이 깨움(2단계 단계 4 — 노트 3-6 · 5-2)
// ---------------------------------------------------------------------------

/** 꼬리의 깨움 표지 — 접기의 알림 항목 낱말(`detail` = wakeId · 사건 `woken` 이 세운다) */
export const WAKE_NOTE = "app-woken";

/** 깨움 항목 한 칩 — `no` = 트랙 번호(`#n`) · 못 찾으면 짧은 id · 앨범 단위면 빈 글자, `what` = 서버 열거 낱말 */
export interface WakeChip {
  no: string;
  what: string;
}

/** id 의 짧은 꼴(`task-1a2b3c4d…` → `1a2b3c4d`) */
function shortId(id: string): string {
  const hex = id.split("-")[1] ?? id;
  return hex.slice(0, 8);
}

/**
 * **깨움 항목 → 사람이 읽을 칩**(목업 `CoordChat` "앱이 깨움 · #1 보고 · #4 수락") — id 를 그 앨범의 트랙 번호로(Task 순서 · Attempt 는 그 Task) 프런트가
 * 짓는다. 서버 문장은 쓰지 않는다(문장은 모델에게 간 영어 고정 글 — 화면은 같은 재료로 따로 짓는다). 상세를 못 읽었으면 짧은 id.
 */
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

/** 기록의 깨움 판정 — 기록이 맞는 깨움 · 꼴만 맞고 앱 기록 없음 · 깨움 아님 */
export type WakeMark = { kind: "wake"; record: { wakeId: string; fromSeq: number; toSeq: number } } | { kind: "unrecorded" } | null;

/** 기록 시각과 예약 시각의 허용 차(ms) — 예약은 쓰기 직전이다 */
const WAKE_AT_SLACK = 5_000;

/**
 * **기록 출처 대조**(노트 3-6 · M21) — 기록의 사람 말이 깨움 꼴(`wake` 칸 — Rust `parse_wake_note`)이고 **그 채팅의** 예약 기록(`Run.wakes`)에 같은
 * SHA 가 있을 때만 깨움으로 — **기록 한 줄에 한 번**(시간 순 · 예약 시각 뒤의 첫 말). 사람이 깨움 문장을 그대로 쳐도 그 기록은 이미 앞의 진짜 깨움이
 * 가져갔다 → "앱 기록 없음"(사람 말풍선 + 흐린 표지). **표시용일 뿐** — 권한 · 커서 · 셈과 무관하다.
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

/** 깨움 꺼짐 띠 — 도는 앨범에서 깨움이 꺼졌을 때만(켜져 있거나 앨범이 돌지 않으면 `null`) */
export function wakeBanner(
  w: { off: string | null; segment: number; cap: number; total: number; max: number } | null | undefined,
  state: string | null | undefined,
): { why: string; segment: number; cap: number; total: number; max: number } | null {
  if (!w || w.off === null || state !== "running") return null;
  return { why: w.off, segment: w.segment, cap: w.cap, total: w.total, max: w.max };
}

/** 서버 열거 낱말(`orchestration::wake::WakeKind::word`) — 화면 문구 열쇠가 있는 것 */
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
