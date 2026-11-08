// **사이드 채팅 v2 의 지금 턴 접기**(4단계 — docs/log/2026-10-23-side-chat-v2-design.md 1 · 5절) — 서버 사건(`SideChatEv`)을 화면의
// 꼬리 항목으로 접는 **순수** 층. 상태는 `app/side-chat-live.svelte.ts`, 그림은 `SideChatFace.svelte`(기록 = `TranscriptBody` + 이 꼬리).
//
// - 지난 턴은 기록 파일이 그린다(`agent_conversation_transcript`) — 여기 꼬리는 **지금 턴**과 그 턴이 남긴 알림(끊김 · 오류 · 종료)뿐이다.
// - 턴이 끝나면(`turnEnded`) `ended` 가 하나 늘고 그 순간의 `endedAt` 을 적는다 — 화면이 기록의 최신 쪽을 한 번 받은 **뒤에**
//   [`clearEnded`] 로 그 앞의 본문 항목을 걷는다(받기 전에 걷으면 한 박자 비고, 걷지 않으면 겹친다).
// - 알림 항목(끊김 · 오류 · 알림 · 종료)은 걷기에서 남고 다음 턴이 서면 걷힌다.
// - 키는 항목마다 늘어나는 번호(`n`) — 화면의 `{#each}` 열쇠 · 걷기의 경계.
// 아무것도 부르지 않는다(타입만).

import type { TranscriptItem, TranscriptLink } from "$lib/context";
import type {
  Decision,
  ExitReason,
  PermKind,
  ResolvedBy,
  SideChatEv,
  SideChatSnapshot,
  SideChatStatus,
} from "$lib/side-chat-api";

/** 꼬리 항목 하나 — 본문(`user` · `text` · `tool`) · 권한 카드 · 알림(`outcome` · `notice` · `exited`) */
export type LiveEntry =
  | {
      n: number;
      kind: "user";
      text: string;
      clientId: string | null;
      accepted: boolean;
      failed: boolean;
      /** 서버가 이 글 앞에 붙인 연결 머리글(`side_chat_send` 의 답 — 기록 보기와 같은 칩) · 없으면 `null` */
      link?: TranscriptLink | null;
      /** 함께 보낸 그림의 이름(입력 칸 칩 — 기록에 들면 기록이 그림을 그린다) */
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
      /** 흘러 온 출력(`toolOutput`) — 끝나면 `toolFinished.output` 이 있으면 그것으로 */
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
  /** 다음 항목 번호 */
  next: number;
  /** 끝난 턴 수 — 늘면 화면이 기록의 최신 쪽을 한 번 받는다 */
  ended: number;
  /** 마지막으로 끝난 턴의 경계 — 이 번호 **앞**의 본문 항목은 기록이 그린다([`clearEnded`]) */
  endedAt: number;
  /** 악수가 알린 것(지금 프로세스) — 칩의 모델 목록 · 모델별 추론 강도 · 버전 */
  ready: { version: string | null; models: string[]; efforts: Record<string, string[]> } | null;
  /** 확인하지 않은 CLI 버전(`notice{untested-version}`) — 칩이 경고만 한다 */
  untested: string | null;
  /** 지금 모델(준비 · 바뀜 알림 · 스냅숏) — 빈 값 = CLI 기본 */
  model: string;
  /** 지금 추론 강도(바뀜 알림 · 스냅숏) — `null` = CLI 기본 */
  effort: string | null;
  /** 지금 대화 id(준비 · `conversation-changed` · 스냅숏) */
  conversationId: string | null;
  /** 지금 프로세스에 실린 외부 MCP 서버 이름(`mcpServers` 사건 · 스냅숏 — 머리줄 칩) */
  mcp: string[];
}

/** 알림 항목인가 — 걷기에서 남고 다음 턴이 걷는다 */
function isNote(e: LiveEntry): boolean {
  return e.kind === "outcome" || e.kind === "notice" || e.kind === "exited";
}

export function emptyLive(status: SideChatStatus = "stopped", model = "", conversationId: string | null = null): LiveState {
  return { status, entries: [], next: 1, ended: 0, endedAt: 0, ready: null, untested: null, model, effort: null, conversationId, mcp: [] };
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

/** 같은 도구 item 의 항목 */
function toolAt(s: LiveState, item: string): number {
  return lastIndex(s.entries, (e) => e.kind === "tool" && e.item === item);
}

/** 도구 입력(아무 JSON) → 펼침 칸의 글 — 문자열은 그대로, 나머지는 들여 쓴 JSON(못 쓰면 없음) */
function inputText(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input, null, 2);
  } catch {
    return null;
  }
}

/**
 * **사건 하나를 접는다** — 새 상태(받은 것은 건드리지 않는다). 순서는 서버가 낸 그대로다(`seq` 판정은 부르는 쪽 — `seqStep`).
 */
export function foldLive(s: LiveState, ev: SideChatEv): LiveState {
  switch (ev.t) {
    case "ready": {
      // 새 프로세스 — 지난 종료 알림은 걷는다(다시 섰다)
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
      // 새 턴 — 지난 턴의 알림 · 끝난 권한 카드는 걷는다(본문은 기록이 받을 때까지 둔다 — 겹침은 `clearEnded` 가)
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
        // 다른 창(주 창 · 원격 창)이 보낸 글 — 서버가 얹은 본문으로 곧바로 그린다(2026-11-01). 본문이 없으면(옛 꼴 · 프로듀서) 그대로.
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
      // 한 덩어리가 끝났다 — 그 item 의 모으던 조각을 이것으로 갈음한다(없으면 새로)
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
    case "permissionResolved": {
      const i = lastIndex(s.entries, (e) => e.kind === "permission" && e.requestId === ev.requestId);
      const e = i >= 0 ? s.entries[i] : null;
      if (!e || e.kind !== "permission") return s;
      return replaceAt(s, i, { ...e, resolved: { decision: ev.decision, by: ev.by } });
    }
    case "turnEnded": {
      // 끝나지 않은 도구는 끝난 것으로(끊긴 턴의 도구가 영영 돌지 않게)
      const entries = s.entries.map((e) => (e.kind === "tool" && !e.finished ? { ...e, finished: true } : e));
      let next: LiveState = {
        ...s,
        entries,
        status: s.status === "running" ? "ready" : s.status,
        ended: s.ended + 1,
        endedAt: s.next,
      };
      // 끊김은 실패가 아니다("중단함") · 오류만 오류 — 잘 끝난 턴은 알림이 없다
      if (ev.outcome !== "ok") next = push(next, { kind: "outcome", outcome: ev.outcome, message: ev.message });
      return next;
    }
    case "modelChanged":
      return { ...s, model: ev.model };
    case "effortChanged":
      return { ...s, effort: ev.effort };
    case "mcpServers":
      return { ...s, mcp: ev.names };
    case "notice": {
      if (ev.code === "untested-version") return { ...s, untested: ev.detail ?? "?" };
      if (ev.code === "conversation-changed") return { ...s, conversationId: ev.detail ?? s.conversationId };
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
        { ...done, entries: done.entries.map((e) => (e.kind === "tool" && !e.finished ? { ...e, finished: true } : e)) },
        { kind: "exited", code: ev.code, reason: ev.reason },
      );
    }
  }
}

/** 사건 여럿 */
export function foldAll(s: LiveState, evs: readonly SideChatEv[]): LiveState {
  return evs.reduce(foldLive, s);
}

/**
 * **스냅숏으로 다시 세운다**(처음 붙기 · F5 · 빈틈 뒤 다시 attach). 지금 턴 꼬리(`liveTurn`)를 접고 기다리는 권한을 더한다.
 * `prev` 가 있으면(같은 페이지 — 빈틈 · `stale-chat`) 알던 것을 잇는다: 악수 정보 · 버전 경고 · 지금 턴의 내 말(턴이 돌면 그 턴의 마지막 내
 * 말 · 아니면 아직 받지 않은 것). `prev` 에 끝나지 않은 본문이 있었는데 이제 턴이 돌지 않으면 그 사이 턴이 끝났다 — `ended` 를 늘린다.
 */
export function seedLive(snap: SideChatSnapshot, prev: LiveState | null = null): LiveState {
  let s: LiveState = {
    ...emptyLive(snap.status === "running" ? "running" : "stopped", snap.model, snap.conversationId),
    effort: snap.effort ?? null,
    mcp: snap.mcpServers ?? prev?.mcp ?? [],
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

/** 내가 보낸 글 — 받을 때까지(`userAccepted`) 흐린 말풍선 · `files` = 함께 보낸 그림 이름 */
export function addSent(s: LiveState, text: string, clientId: string, files: readonly string[] = []): LiveState {
  return push(s, { kind: "user", text, clientId, accepted: false, failed: false, ...(files.length > 0 ? { files } : {}) });
}

/** 서버가 그 글 앞에 붙인 연결 머리글(`side_chat_send` 의 답 `link`) — 말풍선 위 칩(기록 쪽과 같은 그림). 없으면 그대로 */
export function setSentLink(s: LiveState, clientId: string, link: TranscriptLink | null | undefined): LiveState {
  if (!link) return s;
  const i = lastIndex(s.entries, (e) => e.kind === "user" && e.clientId === clientId);
  const e = i >= 0 ? s.entries[i] : null;
  if (!e || e.kind !== "user") return s;
  return replaceAt(s, i, { ...e, link });
}

/** 보내기가 실패했다 — 그 말풍선에 표시 */
export function markSendFailed(s: LiveState, clientId: string): LiveState {
  const i = lastIndex(s.entries, (e) => e.kind === "user" && e.clientId === clientId);
  const e = i >= 0 ? s.entries[i] : null;
  if (!e || e.kind !== "user") return s;
  return replaceAt(s, i, { ...e, failed: true });
}

/**
 * 기록의 최신 쪽을 받았다 — 끝난 턴(`endedAt` 앞)의 본문 · 권한 카드를 걷는다. 알림 · 그 뒤에 선 항목(받는 사이 보낸 다음 말)은 남는다.
 * 단 그 턴의 **"중단함"** 은 걷는다 — 기록이 끊김 표식으로 같은 줄을 그린다(Claude `[Request interrupted…]` · Codex `turn_aborted` —
 * 겹치지 않게). 오류 · 알림 · 종료는 기록에 없으므로 남는다.
 */
export function clearEnded(s: LiveState): LiveState {
  const recorded = (e: LiveEntry) => e.kind === "outcome" && e.outcome === "interrupted" && e.n <= s.endedAt;
  const entries = s.entries.filter((e) => !recorded(e) && (isNote(e) || e.n >= s.endedAt));
  return entries.length === s.entries.length ? s : { ...s, entries };
}

/** 지금 [중단] 할 것이 있나 — 턴이 돈다 */
export function liveBusy(s: LiveState): boolean {
  return s.status === "running";
}

/** 기다리는 권한 요청 */
export function pendingPermissions(s: LiveState): Extract<LiveEntry, { kind: "permission" }>[] {
  return s.entries.filter((e): e is Extract<LiveEntry, { kind: "permission" }> => e.kind === "permission" && e.resolved === null);
}

/** 꼬리 본문을 기록 항목 꼴로 — 사람 말 · 모델 글 · 도구(끝나지 않은 도구는 `output: null` = 도는 중) */
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
 * 기록을 받는 순간 꼬리와 겹칠 몫 — 턴이 도는 동안 받은 쪽(첫 열기 · F5 · 첫 턴에 대화 id 가 막 섰다)에는 이미 이 턴의 앞부분이 있다.
 * 돌지 않으면 `null`(자르지 않는다). 돌면 `{ userText }` — 꼬리에 내 말이 있으면 그 글(기록의 마지막 사람 말이 그것이면 거기서부터
 * 자른다), 없으면 `null`(F5 — 기록의 마지막 사람 말 **뒤**부터 자른다). 판정은 `$lib/transcript` 의 `liveCut`.
 */
export function historyHold(s: LiveState): { userText: string | null } | null {
  if (s.status !== "running") return null;
  const i = lastIndex(s.entries, (e) => e.kind === "user" && e.n >= s.endedAt);
  const user = i >= 0 ? s.entries[i] : null;
  return { userText: user && user.kind === "user" ? user.text : null };
}

