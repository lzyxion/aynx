// 사이드 채팅의 지금 턴 접기 — 서버 사건(`SideChatEv`)을 화면 꼬리 항목으로 접는 순수 층 (docs/log/2026-10-23-side-chat-v2-design.md).
// 지난 턴은 기록 파일이 그린다 — 꼬리는 지금 턴과 그 턴이 남긴 알림(끊김 · 오류 · 종료)뿐이다.
// 걷기(`clearEnded`)는 화면이 기록의 최신 쪽을 받은 뒤에 — 받기 전에 걷으면 한 박자 비고, 걷지 않으면 겹친다.

import type { TranscriptItem, TranscriptLink } from "$lib/context";
import type {
  Decision,
  ExitReason,
  PermKind,
  PermMode,
  ResolvedBy,
  SideChatEv,
  SideChatSnapshot,
  SideChatStatus,
} from "$lib/side-chat-api";

/** `n` = 항목마다 늘어나는 번호 — `{#each}` 열쇠이자 걷기의 경계 */
export type LiveEntry =
  | {
      n: number;
      kind: "user";
      text: string;
      clientId: string | null;
      accepted: boolean;
      failed: boolean;
      link?: TranscriptLink | null;
      files?: readonly string[];
    }
  | { n: number; kind: "text"; item: string | null; text: string; done: boolean }
  | {
      n: number;
      kind: "tool";
      item: string;
      name: string;
      summary: string;
      input: string | null;
      output: string;
      finished: boolean;
      ok: boolean | null;
    }
  | {
      n: number;
      kind: "permission";
      requestId: string;
      permKind: PermKind;
      title: string;
      detail: string;
      toolName: string;
      resolved: { decision: Decision | null; by: ResolvedBy } | null;
    }
  | { n: number; kind: "outcome"; outcome: "interrupted" | "error"; message: string | null }
  | { n: number; kind: "notice"; code: string; detail: string | null }
  | { n: number; kind: "exited"; code: number | null; reason: ExitReason };

export interface LiveState {
  status: SideChatStatus;
  entries: LiveEntry[];
  next: number;
  /** 늘면 화면이 기록의 최신 쪽을 한 번 받는다 */
  ended: number;
  /** 이 번호 앞의 본문 항목은 기록이 그린다 */
  endedAt: number;
  ready: { version: string | null; models: string[]; efforts: Record<string, string[]> } | null;
  untested: string | null;
  /** 빈 값 = CLI 기본 */
  model: string;
  effort: string | null;
  conversationId: string | null;
  mcp: string[];
  perm: { mode: PermMode; allow: string[] };
}

export function policyResolved(by: ResolvedBy | null | undefined): boolean {
  return by === "auto" || by === "remembered";
}

/** 알림 항목은 걷기에서 남고 다음 턴이 걷는다 */
function isNote(e: LiveEntry): boolean {
  return e.kind === "outcome" || e.kind === "notice" || e.kind === "exited";
}

export function emptyLive(status: SideChatStatus = "stopped", model = "", conversationId: string | null = null): LiveState {
  return {
    status,
    entries: [],
    next: 1,
    ended: 0,
    endedAt: 0,
    ready: null,
    untested: null,
    model,
    effort: null,
    conversationId,
    mcp: [],
    perm: { mode: "manual", allow: [] },
  };
}

function push(s: LiveState, e: DistributiveOmit<LiveEntry, "n">): LiveState {
  return { ...s, entries: [...s.entries, { ...e, n: s.next } as LiveEntry], next: s.next + 1 };
}

type DistributiveOmit<T, K extends keyof never> = T extends unknown ? Omit<T, K> : never;

function replaceAt(s: LiveState, i: number, e: LiveEntry): LiveState {
  const entries = s.entries.slice();
  entries[i] = e;
  return { ...s, entries };
}

function lastIndex(entries: readonly LiveEntry[], pred: (e: LiveEntry) => boolean): number {
  for (let i = entries.length - 1; i >= 0; i--) if (pred(entries[i])) return i;
  return -1;
}

function toolAt(s: LiveState, item: string): number {
  return lastIndex(s.entries, (e) => e.kind === "tool" && e.item === item);
}

function inputText(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return null;
  }
}

/** `seq` 판정은 부르는 쪽(`seqStep`) */
export function foldLive(s: LiveState, ev: SideChatEv): LiveState {
  switch (ev.t) {
    case "ready": {
      const entries = s.entries.filter((e) => e.kind !== "exited");
      return {
        ...s,
        entries,
        status: s.status === "running" ? "running" : "ready",
        ready: { version: ev.version, models: ev.models, efforts: ev.efforts ?? {} },
        model: ev.model ?? s.model,
        conversationId: ev.conversationId ?? s.conversationId,
      };
    }
    case "turnStarted": {
      // 본문은 기록이 받을 때까지 둔다 — 겹침은 `clearEnded` 가
      const entries = s.entries.filter((e) => !isNote(e) && !(e.kind === "permission" && e.resolved !== null));
      return { ...s, entries, status: "running" };
    }
    case "userAccepted": {
      const i =
        ev.clientId !== null
          ? lastIndex(s.entries, (e) => e.kind === "user" && e.clientId === ev.clientId)
          : s.entries.findIndex((e) => e.kind === "user" && !e.accepted && !e.failed);
      const e = i >= 0 ? s.entries[i] : null;
      if (!e || e.kind !== "user") {
        // 다른 창이 보낸 글 — 본문이 없으면(옛 꼴 · 프로듀서) 그대로.
        if (typeof ev.text !== "string") return s;
        const files = Array.isArray(ev.files) ? ev.files.filter((f): f is string => typeof f === "string") : [];
        return push(s, { kind: "user", text: ev.text, clientId: ev.clientId, accepted: true, failed: false, ...(files.length > 0 ? { files } : {}) });
      }
      return replaceAt(s, i, { ...e, accepted: true });
    }
    case "textDelta": {
      const last = s.entries[s.entries.length - 1];
      if (last && last.kind === "text" && !last.done && last.item === ev.item) {
        return replaceAt(s, s.entries.length - 1, { ...last, text: last.text + ev.text });
      }
      return push(s, { kind: "text", item: ev.item, text: ev.text, done: false });
    }
    case "text": {
      const i = lastIndex(s.entries, (e) => e.kind === "text" && !e.done && e.item === ev.item);
      if (i >= 0) {
        const e = s.entries[i];
        if (e.kind === "text") return replaceAt(s, i, { ...e, text: ev.text, done: true });
      }
      return push(s, { kind: "text", item: ev.item, text: ev.text, done: true });
    }
    case "toolStarted": {
      const i = toolAt(s, ev.item);
      const input = inputText(ev.input);
      if (i >= 0) {
        const e = s.entries[i];
        if (e.kind === "tool") return replaceAt(s, i, { ...e, name: ev.name, summary: ev.summary, input: input ?? e.input });
      }
      return push(s, {
        kind: "tool",
        item: ev.item,
        name: ev.name,
        summary: ev.summary,
        input,
        output: "",
        finished: false,
        ok: null,
      });
    }
    case "toolOutput": {
      const i = toolAt(s, ev.item);
      const e = i >= 0 ? s.entries[i] : null;
      if (!e || e.kind !== "tool") return s;
      return replaceAt(s, i, { ...e, output: e.output + ev.text });
    }
    case "toolFinished": {
      const i = toolAt(s, ev.item);
      const e = i >= 0 ? s.entries[i] : null;
      if (!e || e.kind !== "tool") {
        // 시작을 못 본 결과(꼬리 상한에서 잘렸다) — 이름 없는 한 줄로
        return push(s, {
          kind: "tool",
          item: ev.item,
          name: "",
          summary: "",
          input: null,
          output: ev.output ?? "",
          finished: true,
          ok: ev.ok,
        });
      }
      return replaceAt(s, i, { ...e, output: ev.output ?? e.output, finished: true, ok: ev.ok });
    }
    case "permission": {
      if (s.entries.some((e) => e.kind === "permission" && e.requestId === ev.requestId)) return s;
      return push(s, {
        kind: "permission",
        requestId: ev.requestId,
        permKind: ev.kind,
        title: ev.title,
        detail: ev.detail,
        toolName: ev.toolName,
        resolved: null,
      });
    }
    case "permissionAuto": {
      if (s.entries.some((e) => e.kind === "permission" && e.requestId === ev.requestId)) return s;
      return push(s, {
        kind: "permission",
        requestId: ev.requestId,
        permKind: ev.kind,
        title: ev.title,
        detail: "",
        toolName: ev.toolName,
        resolved: { decision: "allow", by: ev.by },
      });
    }
    case "permPolicy":
      return { ...s, perm: { mode: ev.mode === "auto" ? "auto" : "manual", allow: Array.isArray(ev.allow) ? ev.allow.filter((k) => typeof k === "string") : [] } };
    case "permissionResolved": {
      const i = lastIndex(s.entries, (e) => e.kind === "permission" && e.requestId === ev.requestId);
      const e = i >= 0 ? s.entries[i] : null;
      if (!e || e.kind !== "permission") return s;
      return replaceAt(s, i, { ...e, resolved: { decision: ev.decision, by: ev.by } });
    }
    case "turnEnded": {
      // 끊긴 턴의 도구가 영영 돌지 않게
      // 흐르던 글도 닫는다 — 다음 턴의 item 없는 조각(Claude)이 거기 붙지 않게
      const entries = s.entries.map((e) =>
        e.kind === "tool" && !e.finished ? { ...e, finished: true } : e.kind === "text" && !e.done ? { ...e, done: true } : e,
      );
      let next: LiveState = {
        ...s,
        entries,
        status: s.status === "running" ? "ready" : s.status,
        ended: s.ended + 1,
        endedAt: s.next,
      };
      if (ev.outcome !== "ok") next = push(next, { kind: "outcome", outcome: ev.outcome, message: ev.message });
      return next;
    }
    case "modelChanged":
      return { ...s, model: ev.model };
    case "effortChanged":
      return { ...s, effort: ev.effort };
    case "mcpServers":
      return { ...s, mcp: ev.names };
    case "cliMode":
    case "commands":
    case "contextUsage":
    case "rewindCaps":
    case "rewind":
    case "mcpStatus":
    case "goal":
    case "serviceTiers":
      return s;
    case "review": {
      if (ev.phase === "started") return push(s, { kind: "notice", code: "reviewing", detail: ev.label });
      // 끝 표지는 결과 글 뒤 — "검토하는 중" 줄을 걷고 꼬리 끝에 세운다
      const i = lastIndex(s.entries, (e) => e.kind === "notice" && e.code === "reviewing" && e.n >= s.endedAt);
      const base = i >= 0 ? { ...s, entries: s.entries.filter((_, k) => k !== i) } : s;
      const withText = typeof ev.text === "string" && ev.text.trim() !== "" ? push(base, { kind: "text", item: `review:${base.next}`, text: ev.text, done: true }) : base;
      return push(withText, { kind: "notice", code: ev.phase === "stopped" ? "review-stopped" : "reviewed", detail: ev.label });
    }
    case "compaction": {
      if (ev.phase === "started") return push(s, { kind: "notice", code: "compacting", detail: ev.trigger });
      const done = { kind: "notice" as const, code: "compacted", detail: compactNoticeDetail(ev.preTokens, ev.postTokens) };
      const i = lastIndex(s.entries, (e) => e.kind === "notice" && e.code === "compacting" && e.n >= s.endedAt);
      return i >= 0 ? replaceAt(s, i, { ...done, n: s.entries[i].n }) : push(s, done);
    }
    case "notice": {
      if (ev.code === "untested-version") return { ...s, untested: ev.detail ?? "?" };
      if (ev.code === "conversation-changed") return { ...s, conversationId: ev.detail ?? s.conversationId };
      // 채팅 타일 — 압축 실패 · 멈춤은 이 턴의 "압축하는 중" 줄을 갈음한다(돌던 표지가 남지 않게)
      if (ev.code === "compact-failed" || ev.code === "compact-canceled") {
        const i = lastIndex(s.entries, (e) => e.kind === "notice" && e.code === "compacting" && e.n >= s.endedAt);
        if (i >= 0) return replaceAt(s, i, { kind: "notice", code: ev.code, detail: ev.detail, n: s.entries[i].n });
      }
      return push(s, { kind: "notice", code: ev.code, detail: ev.detail });
    }
    case "exited": {
      // 기다리던 권한은 서버가 `by: closed` 로 먼저 낸다 — 혹시 남았으면 여기서 닫는다
      const entries = s.entries.map((e) =>
        e.kind === "permission" && e.resolved === null ? { ...e, resolved: { decision: null, by: "closed" as const } } : e,
      );
      const closed = { ...s, entries, status: "stopped" as const, ready: null };
      const done = s.status === "running" ? { ...closed, ended: s.ended + 1, endedAt: s.next } : closed;
      return push(
        {
          ...done,
          entries: done.entries.map((e) =>
            e.kind === "tool" && !e.finished ? { ...e, finished: true } : e.kind === "text" && !e.done ? { ...e, done: true } : e,
          ),
        },
        { kind: "exited", code: ev.code, reason: ev.reason },
      );
    }
  }
}

/** `"36241>8335"` · 모르는 쪽은 빈 글(`">8335"` · `""`) — 알림 `detail` 은 글 하나라서 */
export function compactNoticeDetail(pre: number | null, post: number | null): string {
  const n = (v: number | null) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? String(Math.round(v)) : "");
  const a = n(pre);
  const b = n(post);
  return a === "" && b === "" ? "" : `${a}>${b}`;
}

export function parseCompactNotice(detail: string | null): { pre: number | null; post: number | null } {
  const m = /^(\d*)>(\d*)$/.exec(detail ?? "");
  if (!m) return { pre: null, post: null };
  return { pre: m[1] === "" ? null : Number(m[1]), post: m[2] === "" ? null : Number(m[2]) };
}

export function foldAll(s: LiveState, evs: readonly SideChatEv[]): LiveState {
  return evs.reduce(foldLive, s);
}

/** `prev` 에 끝나지 않은 본문이 있었는데 이제 턴이 돌지 않으면 그 사이 턴이 끝났다 — `ended` 를 늘린다. */
export function seedLive(snap: SideChatSnapshot, prev: LiveState | null = null): LiveState {
  let s: LiveState = {
    ...emptyLive(snap.status === "running" ? "running" : "stopped", snap.model, snap.conversationId),
    effort: snap.effort ?? null,
    mcp: snap.mcpServers ?? prev?.mcp ?? [],
    perm: { mode: snap.permMode === "auto" ? "auto" : "manual", allow: Array.isArray(snap.permAllow) ? snap.permAllow : [] },
  };
  if (prev) {
    s = { ...s, next: prev.next, ended: prev.ended, endedAt: prev.endedAt, ready: prev.ready, untested: prev.untested };
    const mine = prev.entries.filter((e) => e.kind === "user" && e.n >= prev.endedAt);
    const keep = snap.status === "running" ? mine.slice(-1) : mine.filter((e) => e.kind === "user" && !e.accepted && !e.failed);
    s = { ...s, entries: keep };
    const hadBody = prev.entries.some((e) => (e.kind === "text" || e.kind === "tool") && e.n >= prev.endedAt);
    if (hadBody && snap.status !== "running") s = { ...s, ended: s.ended + 1, endedAt: s.next };
  }
  // 꼬리의 첫 `turnStarted` 가 상태를 다시 세운다 — 그 전 값은 스냅숏의 것
  s = foldAll(s, snap.liveTurn);
  s = { ...s, status: snap.status };
  for (const p of snap.pending) s = foldLive(s, p);
  return s;
}

export function addSent(s: LiveState, text: string, clientId: string, files: readonly string[] = []): LiveState {
  return push(s, { kind: "user", text, clientId, accepted: false, failed: false, ...(files.length > 0 ? { files } : {}) });
}

export function setSentLink(s: LiveState, clientId: string, link: TranscriptLink | null | undefined): LiveState {
  if (!link) return s;
  const i = lastIndex(s.entries, (e) => e.kind === "user" && e.clientId === clientId);
  const e = i >= 0 ? s.entries[i] : null;
  if (!e || e.kind !== "user") return s;
  return replaceAt(s, i, { ...e, link });
}

export function markSendFailed(s: LiveState, clientId: string): LiveState {
  const i = lastIndex(s.entries, (e) => e.kind === "user" && e.clientId === clientId);
  const e = i >= 0 ? s.entries[i] : null;
  if (!e || e.kind !== "user") return s;
  return replaceAt(s, i, { ...e, failed: true });
}

/**
 * 끝난 턴의 본문 · 권한 카드를 걷는다. 그 턴의 "중단함" 도 걷는다 — 기록이 끊김 표식으로 같은 줄을 그린다
 * (Claude `[Request interrupted…]` · Codex `turn_aborted`). 오류 · 알림 · 종료는 기록에 없으므로 남는다.
 */
export function clearEnded(s: LiveState): LiveState {
  const recorded = (e: LiveEntry) => e.kind === "outcome" && e.outcome === "interrupted" && e.n <= s.endedAt;
  const entries = s.entries.filter((e) => !recorded(e) && (isNote(e) || e.n >= s.endedAt));
  return entries.length === s.entries.length ? s : { ...s, entries };
}

export function liveBusy(s: LiveState): boolean {
  return s.status === "running";
}

export function pendingPermissions(s: LiveState): Extract<LiveEntry, { kind: "permission" }>[] {
  return s.entries.filter((e): e is Extract<LiveEntry, { kind: "permission" }> => e.kind === "permission" && e.resolved === null);
}

/** 끝나지 않은 도구는 `output: null` = 도는 중 */
export function entryItem(e: LiveEntry): TranscriptItem | null {
  if (e.kind === "user") return { role: "user", text: e.text, truncated: false, images: 0, tool: null, at: null, link: e.link ?? null };
  if (e.kind === "text") return { role: "assistant", text: e.text, truncated: false, images: 0, tool: null, at: null };
  if (e.kind === "tool") {
    return {
      role: "tool",
      text: null,
      truncated: false,
      images: 0,
      at: null,
      tool: {
        name: e.name,
        summary: e.summary,
        input: e.input,
        inputTruncated: false,
        output: e.finished ? e.output : null,
        outputTruncated: false,
        error: e.finished && e.ok === false,
      },
    };
  }
  return null;
}

/**
 * 턴이 도는 동안 받은 기록에는 이미 이 턴의 앞부분이 있다 — 꼬리와 겹칠 몫. 돌지 않으면 `null`(자르지 않는다).
 * `userText` 가 `null` 이면(F5) 기록의 마지막 사람 말 뒤부터 자른다 — 판정은 `$lib/transcript` 의 `liveCut`.
 */
export function historyHold(s: LiveState): { userText: string | null } | null {
  if (s.status !== "running") return null;
  const i = lastIndex(s.entries, (e) => e.kind === "user" && e.n >= s.endedAt);
  const user = i >= 0 ? s.entries[i] : null;
  return { userText: user && user.kind === "user" ? user.text : null };
}

