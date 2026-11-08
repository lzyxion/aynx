<script lang="ts">
  /**
   * **프로듀서 채팅 면**(오케스트레이션 2단계 단계 3 — aynx-notes docs/log/2026-10-30-orchestration-structured-producer.md 4-2 · 4-3 · 5-2 · 확정 목업
   * `CoordChat`). 프로듀서 잎(`ProducerLeaf`)이 채팅을 연 뒤 그린다. 터미널 · PTY 가 없다 — 속은 세션 서버의 프로듀서 채팅 프로세스이고 상태는
   * `app/producer-chat.svelte.ts` 가 쥔다(이 면이 다시 마운트돼도 남는다).
   *
   * - **머리**: 프로듀서 캐릭터(응답 중이면 강조색 고리) · "프로듀서 · Claude" · 모델 · 강도(악수가 알린 것 · 이제 앱이 안다) · 상태 칩(응답 중
   *   이퀄라이저 · 작업자 기다리는 중 · 쉼 · 끝남 · 기록만) · ✕ 응답 끊기(= interrupt `deliverQueued: false` — 재생 막대 ✕ 와 같다).
   * - **기록 + 꼬리**: 사이드 채팅과 같은 `TranscriptBody`(지난 턴 = 기록 파일 · 지금 턴 = 사건 꼬리) + **에이전트 머리**(캐릭터 · 이름 줄 —
   *   사람 말은 오른쪽 말풍선) + **도구 알약**(서버 접두를 뗀 이름 · `spawn_worker role=…` · 같은 것 `×n` · 누르면 도구 줄 · 툴팁 = 화면 문구).
   * - **권한 카드**: 서버가 카드로 세운 요청만 온다(스튜디오 밖 Read · AYNX DB 읽기 — 그 밖은 서버가 카드 없이 거절하고 `denied-by-policy` 한 줄).
   * - **대기열 줄**: "대기열 n — 턴이 끝나면 전달" · 항목 [취소] · 보류([보내기]) · 보내지 못함([다시 보내기]) · [끊고 전달](`deliverQueued: true`).
   * - **사람 필요 카드**: 앨범 상세의 `needsHuman(detail)`(보류 · 프로듀서 없음 · 트랙별 막힘 · 충돌 · 검증 — 첫 항목 + "외 n건") · 상세가 아직이면 목록 요약
 *   → [앨범 판 보기].
 * - **앱이 깨움**(단계 4): 꼬리의 표지(사건 `woken`) · 기록의 사람 말이 깨움 꼴이고 앨범의 예약 기록(`wakes` SHA)과 한 번씩 맞으면 말풍선 대신 가운데 점선
 *   알약 "앱이 깨움 · #1 보고 · #4 통합"(id → 트랙 번호는 여기서 짓는다 · 서버 문장은 쓰지 않는다) · 꼴만 맞으면 말풍선 + "앱 기록 없음" · 깨움이 꺼지면
 *   띠("사람 말 사이 깨움 n/30 — 다음 말을 기다립니다" 류).
 * - **턴 끝 경계**: 기록 · 꼬리의 에이전트 줄 뒤 사람 말(알약 포함) 앞에 가는 선 "턴 끝 · 프로듀서 쉼 (12:04)".
 * - **대화 중 모델 · 강도 칩**: 머리의 모델 · 강도를 누르면 칩 줄(사람 제어 프레임 `producer_chat_set_model` · `_set_effort` — 다음 턴부터).
   * - **끝**: 끝 사건 `exited{why, restartable}` · 서버 표에 없음(`status` 의 `gone`) → 이유 한 줄 + [다시 띄우기](띄우지는 않는다 — 다음 말이 띄운다).
   *   귀속 앨범이 orphaned 이고 되찾을 수 없으면 처음부터 **기록만**(입력 칸 없음 · [다시 띄우기] 없음 — 실기 a FAIL 2).
   * - **띄우기 전 칩**: 이어받기 · 다시 붙이기로 막 세운 채팅(세대 0 · 대화 없음 · 말 없음)은 CLI · 모델 · 강도를 바꿀 수 있다(`respec` — 잎이
   *   주소에 적고 서버에 다시 연다 · 기본 = 그 앨범의 직전 프로듀서 값).
   * 사람이 보낸 글만 서버로 간다(이 면이 짓는 글 없음 — 이어받기 문장은 칸에 **채우기만**).
   */
  import { untrack, type Snippet } from "svelte";
  import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
  import TranscriptBody from "$lib/TranscriptBody.svelte";
  import FlipComposer from "$lib/pane/FlipComposer.svelte";
  import UiIcon from "$lib/UiIcon.svelte";
  import { agentConversationTranscript, type TranscriptItem, type TranscriptPage } from "$lib/context";
  import { entryItem, historyHold, pendingPermissions, type LiveEntry } from "$lib/side-chat-live";
  import type { LiveRow } from "$lib/transcript";
  import type { ComposerGate } from "$lib/pane/ai-flip.svelte.js";
  import { t, type Key } from "$lib/i18n/i18n.svelte.js";
  import { stripReason } from "$lib/error-reason";
  import {
    cancelQueued,
    closeProducerLive,
    clearEndedProducer,
    decideProducer,
    dismissProducerDenied,
    dismissProducerError,
    interruptProducer,
    producerFillOf,
    producerLiveOf,
    restartProducer,
    retuneProducer,
    sendProducer,
    takeProducerFill,
    type ProducerTarget,
  } from "$lib/app/producer-chat.svelte.js";
  import { runSummaryOf } from "$lib/app/orch-pulse.svelte.js";
  import { listen, type UnlistenFn } from "$lib/ipc";
  import { RUN_CHANGED_EVENT, runDetail } from "../api";
  import { needsHuman, type RunDetail } from "../model";
  import {
    WAKE_NOTE,
    albumBusy,
    albumEnded,
    isWakeWhat,
    wakeBanner,
    wakeChips,
    wakeMarks,
    groupToolPills,
    historyNotYet,
    isCoordTool,
    producerSendClosed,
    producerActivity,
    producerOpenMode,
    queueRows,
    queueSummary,
    restartableWhy,
    toolPillLabel,
  } from "../model/producer";
  import { artistOf } from "../artists";
  import { EFFORTS, MODEL_SUGGESTIONS, type RoleCli } from "../config";
  import { producerClis, rememberProducer } from "$lib/app/orch-start.svelte.js";
  import ArtistAvatar from "./ArtistAvatar.svelte";
  import EqBars from "../EqBars.svelte";

  let {
    target,
    runId = null,
    onalbum,
    respec,
    onretune,
    onclose,
    inputEl = $bindable(null),
  }: {
    target: ProducerTarget;
    /** 이 탭이 보여 주는 앨범(사람 필요 카드 · 상태 칩의 재료) */
    runId?: string | null;
    /** [앨범 판 보기] — 플레이어 잎으로 */
    onalbum?: () => void;
    /** 띄우기 전(이어받기 · 다시 붙이기로 막 세운 채팅)의 CLI · 모델 · 강도 바꾸기 — 잎이 주소에 적고 서버에 다시 연다(띄우지 않는다) */
    respec?: (p: { cli: RoleCli; model: string; effort: string }) => void;
    /** 대화 중 모델 · 강도를 바꿨다 — 잎이 주소에 적는다(다음 띄우기도 그 값) */
    onretune?: (p: { model?: string; effort?: string }) => void;
    /** 끝난 앨범의 [프로듀서 대화 기록](읽기만) — 머리에 ✕(잎을 걷는다 · 채팅은 닫지 않는다). 없으면 보통 채팅 머리 */
    onclose?: () => void;
    inputEl?: HTMLTextAreaElement | null;
  } = $props();

  const PAGE = 40;

  const live = $derived(producerLiveOf(target.chat));
  const st = $derived(live?.state ?? null);
  const art = $derived(artistOf(target.cli));
  const conv = $derived(live?.historyConv ?? null);
  const convKey = $derived(conv ? `${target.cli}:${conv}` : null);
  const summary = $derived(runSummaryOf(runId));

  async function fetchPage(before: number | null): Promise<TranscriptPage> {
    const c = conv;
    if (!c) throw new Error("no-conversation");
    try {
      return await agentConversationTranscript(target.cli, c, before, PAGE);
    } catch (e) {
      // 첫 턴이 도는 동안의 실패 = 아직 기록 없음(CLI 가 대화 파일을 쓰기 전 — 실기 18) · 턴 끝의 다시 읽기가 받는다
      if (before === null && historyNotYet(st)) return { items: [], cursor: null };
      throw e;
    }
  }

  function failureOf(e: unknown): string {
    return t("board.viewer.error", { e: stripReason(e instanceof Error ? e.message : String(e)) });
  }

  // ── 상태 ──────────────────────────────────────────────────────────────────

  const pendingN = $derived(st ? pendingPermissions(st).length : 0);
  const activity = $derived(
    producerActivity({
      readOnly: live?.readOnly ?? false,
      life: live?.life ?? null,
      gone: (live?.gone ?? null) !== null,
      status: st?.status ?? null,
      sending: live?.sending ?? false,
      pending: pendingN,
      album: summary ? { state: summary.state, busy: albumBusy(summary) } : (live?.album ?? null),
    }),
  );
  const responding = $derived(st?.status === "running");
  const ACT_KEY: Record<string, Key> = {
    starting: "orch.producer.act.starting",
    responding: "orch.producer.act.responding",
    permission: "orch.producer.act.permission",
    waiting: "orch.producer.act.waiting",
    idle: "orch.producer.act.idle",
    ended: "orch.producer.act.ended",
    readOnly: "orch.producer.act.readOnly",
    rest: "orch.producer.act.rest",
  };

  const modelText = $derived(st?.model || st?.ready?.models?.[0] || target.model || t("orch.producer.model.default"));
  const effortText = $derived(st?.effort || target.effort || t("orch.producer.effort.default"));

  // ── 꼬리 → 줄 ────────────────────────────────────────────────────────────

  const keyOf = (e: LiveEntry) => `e${e.n}`;
  const rows = $derived.by<LiveRow[]>(() => {
    if (!st) return [];
    return st.entries.map((e) => {
      const item = entryItem(e);
      if (!item) return { key: keyOf(e), item: null };
      if (e.kind === "user") {
        const note = e.failed ? t("app.chatDock.send.failed") : e.accepted ? null : t("pane.flip.sending");
        return { key: keyOf(e), item, dim: !e.accepted, note };
      }
      return {
        key: keyOf(e),
        item,
        spinning: e.kind === "tool" && !e.finished,
        streaming: e.kind === "text" && !e.done && st.status === "running",
      };
    });
  });
  const byKey = $derived(new Map((st?.entries ?? []).map((e) => [keyOf(e), e] as const)));
  const bodyActivity = $derived.by((): "running" | "permission" | "idle" => {
    if (pendingN > 0) return "permission";
    return responding ? "running" : "idle";
  });


  const pills = {
    group: (tools: readonly { name: string | null; input: string | null; state: "ok" | "err" | "running" }[]) =>
      groupToolPills(tools.map((x) => ({ label: toolPillLabel(x, (id) => roles.get(id)), state: x.state }))),
    title: (base: string) => (isCoordTool(base) ? t(`orch.producer.tool.${base}` as Key) : null),
  };

  // 앨범에 묶인 프로듀서의 값을 기억한다(라이브러리 이어받기 칩의 기본값 — 이 브라우저의 편의)
  $effect(() => {
    const r = runId;
    const tg = target;
    // 채팅 · 자기 대화 id 도(끝난 앨범의 [프로듀서 대화 기록] · 마무리 카드가 읽는다 — 갈라 온 원본 대화는 적지 않는다)
    if (!r) return;
    untrack(() => rememberProducer(r, { cli: tg.cli, model: tg.model, effort: tg.effort, chat: tg.chat, ...(tg.conv ? { conv: tg.conv } : {}) }));
  });

  // ── 띄우기 전 칩(이어받기 · 다시 붙이기로 막 세운 채팅) ─────────────────────────

  /**
   * 아직 띄우지 않았고 아무 말도 없다 — CLI · 모델 · 강도를 바꿀 수 있다(바꾸면 서버에 다시 연다 · 띄우지 않는다). 갈라 온 채팅(단계 5)은 CLI 가 원본
   * 대화의 것으로 정해져 있어 이 칩 줄이 없다(모델 · 강도는 머리의 칩이 바꾼다).
   */
  const prelaunch = $derived(
    !!respec &&
      !target.forkFrom &&
      !!live &&
      live.attached &&
      live.epoch === 0 &&
      !target.conv &&
      !live.sending &&
      !live.readOnly &&
      live.gone === null &&
      (st?.entries.length ?? 0) === 0,
  );
  let preClis = $state<{ id: string; name: string }[]>([]);
  $effect(() => {
    if (!prelaunch) return;
    untrack(() => {
      void producerClis().then((all) => (preClis = all.filter((c) => c.id === "claude" || c.id === "codex")));
    });
  });
  const preCli = $derived((target.cli === "codex" ? "codex" : "claude") as RoleCli);
  // 직전 프로듀서가 제안 밖 모델(Codex 의 계정 모델 등)이었으면 그 칩도 보인다
  const preModels = $derived([...new Set(["", ...MODEL_SUGGESTIONS[preCli], target.model])]);
  const preEfforts = $derived(EFFORTS[preCli]);

  function pickPre(p: Partial<{ cli: RoleCli; model: string; effort: string }>): void {
    if (!respec) return;
    const cli = p.cli ?? preCli;
    // CLI 를 바꾸면 모델은 기본 · 그 CLI 에 없는 강도도 기본으로
    const model = p.model ?? (cli === preCli ? target.model : "");
    const effort = p.effort ?? (EFFORTS[cli].includes(target.effort) ? target.effort : "");
    if (cli === preCli && model === target.model && effort === target.effort) return;
    respec({ cli, model, effort });
  }

  // ── 대기열 ────────────────────────────────────────────────────────────────

  const qrows = $derived(queueRows(live?.queue, live?.texts ?? {}));
  const qsum = $derived(queueSummary(qrows, live?.queue.held ?? false));

  // ── 보내기 ────────────────────────────────────────────────────────────────

  /** 기록만 · 첫 띄우기 동안은 막는다(턴 중에는 막지 않는다 — 대기열) */
  const gate = $derived.by((): ComposerGate | null => {
    if (live?.readOnly) return { text: t("orch.producer.gate.readOnly") };
    if (live?.sending && !responding && (live.epoch === 0 || live.life !== "live" || st?.status === "stopped")) {
      return { text: t("orch.producer.gate.starting", { cli: art.name }) };
    }
    return null;
  });

  function send(text: string): boolean {
    return sendProducer(target, text);
  }

  // ── 권한 · 끝 ────────────────────────────────────────────────────────────

  let deciding = $state<Record<string, true>>({});
  async function decide(requestId: string, decision: "allow" | "deny"): Promise<void> {
    if (deciding[requestId]) return;
    deciding[requestId] = true;
    try {
      await decideProducer(target.chat, requestId, decision);
    } finally {
      delete deciding[requestId];
    }
    inputEl?.focus({ preventScroll: true });
  }

  function resolvedText(e: Extract<LiveEntry, { kind: "permission" }>): string {
    const r = e.resolved;
    if (!r) return "";
    if (r.by === "human") return r.decision === "allow" ? t("app.chatDock.perm.allowed") : t("app.chatDock.perm.denied");
    if (r.by === "cli") return t("app.chatDock.perm.byCli");
    return t("app.chatDock.perm.closed");
  }

  const WHY_KEY: Record<string, Key> = {
    exited: "orch.producer.exit.why.exited",
    crashed: "orch.producer.exit.why.crashed",
    "album-ended": "orch.producer.exit.why.albumEnded",
    "start-failed": "orch.producer.exit.why.startFailed",
    "server-restarted": "orch.producer.exit.why.serverRestarted",
    closed: "orch.producer.exit.why.closed",
    "close-all": "orch.producer.exit.why.closed",
  };
  function whyText(why: string | null | undefined): string {
    return t(WHY_KEY[why ?? ""] ?? "orch.producer.exit.why.exited");
  }

  /** 이 채팅의 앨범이 끝났나(서버 이어받기 판정 `why: ended` — 실기 b 고침 E: 끝난 앨범에 "다시 띄워 이어받으라" 를 말했다) */
  const ended = $derived(!!runId && albumEnded(summary ?? live?.album ?? null));
  /** 입력 칸을 끄는 까닭(앨범 끝 · 사람이 프로듀서를 끝냄 — 실기 34) · 기록만은 따로(위 띠) */
  const sendClosed = $derived(live && !live.readOnly ? producerSendClosed({ albumEnded: ended, exitWhy: live.ended, gone: live.gone }) : null);
  /** 다시 띄우면 어떻게 여나 — 갈라 온 채팅이 첫 말 전(자기 대화 없음)이면 원본 대화에서 **다시 갈라 온다**(실기 c — "같은 대화로" 는 틀린 말).
   *  [다시 띄우기]와 같은 판정(`producerOpenMode` — 자기 대화 id 는 턴이 설 때 잎 주소에 적힌다) */
  const restartTip: Key = "orch.producer.exit.tip";

  /** 끝난 채팅의 한 줄(서버 표에 없음 · 끝 사건) — 꼬리의 `exited` 카드가 없을 때 위에 */
  const endNote = $derived.by((): { why: string; restartable: boolean } | null => {
    if (!live || live.readOnly || onclose) return null;
    if (live.gone) return { why: live.gone, restartable: !ended && restartableWhy(live.gone) };
    return null;
  });

  // ── 앨범 상세(사람 필요 · 트랙 번호 · 깨움 기록) — 보일 때 읽고 그 앨범의 변화 이벤트에 다시 ─────────

  let detail = $state<RunDetail | null>(null);
  // 도구 알약은 이 앨범의 아티스트 이름을 쓴다. 프로필·권한의 원천은 서버다.
  const roles = $derived(new Map((detail?.roles ?? []).map((r) => [r.id, r.name] as const)));
  $effect(() => {
    const id = runId;
    if (id === null) {
      detail = null;
      return;
    }
    if (untrack(() => detail)?.runId !== id) detail = null;
    let alive = true;
    const load = () =>
      runDetail(id).then(
        (d) => alive && (detail = d),
        () => {},
      );
    void load();
    let un: UnlistenFn | null = null;
    void listen<{ runId?: string }>(RUN_CHANGED_EVENT, (ev) => {
      if (ev.payload?.runId === id) void load();
    })
      .then((f) => {
        if (alive) un = f;
        else f();
      })
      .catch(() => {});
    return () => {
      alive = false;
      un?.();
    };
  });

  // ── 앱이 깨움 ────────────────────────────────────────────────────────────

  function whatText(w: string): string {
    return isWakeWhat(w) ? t(`orch.producer.wake.what.${w}` as Key) : w;
  }

  /** 깨움 알약 글 — "앱이 깨움 · #1 보고 · #4 통합 (seq 41 뒤)" · 같은 범위의 재시도는 "앱이 깨움 · 다시 알림 · …"(실기 b 고침 C — 원래 알약과 글이 같아 중복처럼 보였다) */
  function wakePill(w: { items?: readonly { what: string; taskId?: string | null; attemptId?: string | null }[]; more?: number; resync?: boolean; retry?: boolean; fromSeq: number }): string {
    const head = w.retry ? `${t("orch.producer.wake.title")} · ${t("orch.producer.wake.retry")}` : t("orch.producer.wake.title");
    if (w.resync) return `${head} · ${t("orch.producer.wake.resync")}`;
    const chips = wakeChips(
      (w.items ?? []).map((i) => ({ what: i.what, taskId: i.taskId ?? null, attemptId: i.attemptId ?? null })),
      detail,
    ).map((c) => (c.no ? `${c.no} ${whatText(c.what)}` : whatText(c.what)));
    if ((w.more ?? 0) > 0) chips.push(t("orch.producer.wake.more", { n: w.more ?? 0 }));
    return `${head} · ${chips.join(" · ")} (${t("orch.producer.wake.seq", { n: w.fromSeq })})`;
  }

  /** 꼬리에 표지가 선 깨움(도는 깨움 턴) — 기록이 같은 깨움 말을 이미 받았으면 기록 쪽은 그리지 않는다(실기 b 고침 H: F5 직후 기록 알약 + 꼬리 알약 둘) */
  const tailWakes = $derived(new Set((st?.entries ?? []).flatMap((e) => (e.kind === "notice" && e.code === WAKE_NOTE && e.detail ? [e.detail] : []))));

  /** 기록의 사람 말 표지 — 앨범의 예약 기록과 한 번씩 맞춘다(표시용) · 꼬리가 같은 깨움을 그리고 있으면 숨김 */
  function userMark(items: readonly TranscriptItem[]): readonly ({ pill: string } | { note: string } | { hide: true } | null)[] {
    const recs = detail?.wakes ?? [];
    return wakeMarks(items, recs, target.chat).map((m) => {
      if (!m) return null;
      if (m.kind === "unrecorded") return { note: t("orch.producer.wake.unrecorded") };
      if (tailWakes.has(m.record.wakeId)) return { hide: true };
      const rec = recs.find((r) => r.wakeId === m.record.wakeId);
      return { pill: wakePill(rec ?? { fromSeq: m.record.fromSeq }) };
    });
  }

  const wakeOff = $derived(wakeBanner(summary?.wake ?? null, summary?.state ?? null));

  function clockOf(at: number | null): string {
    if (at === null) return "";
    const d = new Date(at);
    return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  }

  function turnBreak(at: number | null): string {
    return at === null ? t("orch.producer.turnEnd") : t("orch.producer.turnEnd.at", { time: clockOf(at) });
  }

  // ── 대화 중 모델 · 강도 칩 ─────────────────────────────────────────────────

  let retuneOpen = $state<"model" | "effort" | null>(null);
  const tuneCli = $derived((target.cli === "codex" ? "codex" : "claude") as RoleCli);
  const tuneModels = $derived([...new Set(["", ...MODEL_SUGGESTIONS[tuneCli], ...(st?.ready?.models ?? []), st?.model ?? ""])]);
  const tuneEfforts = $derived(EFFORTS[tuneCli]);
  const canRetune = $derived(!!live && !live.readOnly && live.gone === null && !prelaunch);

  async function retune(p: { model?: string; effort?: string }): Promise<void> {
    retuneOpen = null;
    if (await retuneProducer(target.chat, p)) onretune?.(p);
  }

  // ── 사람 필요 카드 ────────────────────────────────────────────────────────

  const NEED_KEY: Record<string, Key> = {
    "no-producer": "orch.producer.human.need.no-producer",
    orphaned: "orch.producer.human.need.orphaned",
    blocked: "orch.producer.human.need.blocked",
    conflict: "orch.producer.human.need.conflict",
    "verify-failed": "orch.producer.human.need.verify-failed",
    stuck: "orch.producer.human.need.stuck",
    verify: "orch.producer.human.need.verify",
  };

  const human = $derived.by((): { text: string } | null => {
    if (detail && detail.runId === runId) {
      // 상세 재료(`needsHuman`) — 첫 항목 + 외 n건
      const needs = needsHuman(detail);
      const first = needs[0];
      if (first) {
        const idx = first.taskId ? detail.tasks.findIndex((x) => x.id === first.taskId) : -1;
        const no = idx >= 0 ? `#${idx + 1}` : "";
        const body = first.kind === "hold" ? t("orch.producer.human.hold") : t(NEED_KEY[first.kind] ?? "orch.producer.human.limit", { no });
        return { text: needs.length > 1 ? `${body} · ${t("orch.producer.human.more", { n: needs.length - 1 })}` : body };
      }
    }
    // 상세가 아직이거나 상세에 사람 필요 항목이 없다 — 목록 요약(조율 한도 · 사람 멈춤 · 상세보다 먼저 온 막힘)
    const r = summary;
    if (!r) return null;
    if (r.hold) return { text: t("orch.producer.human.hold") };
    if ((r.blocked ?? 0) > 0) return { text: t("orch.producer.human.blocked", { n: r.blocked ?? 0 }) };
    if (r.state === "paused" && /limit/.test(r.pauseReason ?? "")) return { text: t("orch.producer.human.limit") };
    if (r.state === "paused" && r.pauseReason === "human") return { text: t("orch.producer.human.paused") };
    return null;
  });

  const lastTurnEnded = $derived((st?.ended ?? 0) > 0 && !responding && pendingN === 0 && activity !== "ended" && activity !== "readOnly");
  let ending = $state(false);
  let endError = $state<string | null>(null);
  async function endProducer() {
    if (ending) return;
    const chat = target.chat;
    ending = true; endError = null;
    try {
      if (await askConfirm(t("orch.producer.end.body"), { title: t("orch.producer.end"), kind: "warning", okLabel: t("orch.producer.end") })) await closeProducerLive(chat);
    } catch { endError = t("orch.producer.end.error"); }
    finally { ending = false; }
  }
</script>

{#snippet head(isLive: boolean)}
  <div class="agent-line" data-producer-head={isLive ? "live" : ""}>
    <span class="avatar-wrap" class:live={isLive}><ArtistAvatar cli={target.cli} size={30} /></span>
    <b>{art.name}</b>
    {#if isLive}
      <span class="dimtext">· {t("orch.producer.act.responding")}</span>
      <EqBars size={11} />
    {/if}
  </div>
{/snippet}

{#snippet card(key: string)}
  {@const e = byKey.get(key)}
  {#if e && e.kind === "permission"}
    <div class="perm" class:done={e.resolved !== null} data-producer-perm={e.requestId} role="group" aria-label={t("app.chatDock.perm.aria")}>
      <div class="perm-head">
        <UiIcon name="shield-check" size={16} />
        <span class="perm-title">{e.title || t("app.chatDock.perm.title")}</span>
      </div>
      {#if e.toolName}<div class="perm-tool">{e.toolName}</div>{/if}
      {#if e.detail}<pre class="perm-detail">{e.detail}</pre>{/if}
      {#if e.resolved === null}
        <div class="perm-actions">
          <button type="button" class="btn btn-primary btn-sm" data-producer-allow disabled={!!deciding[e.requestId]}
            onclick={() => void decide(e.requestId, "allow")}>{t("app.chatDock.perm.allow")}</button>
          <button type="button" class="btn btn-secondary btn-sm" data-producer-deny disabled={!!deciding[e.requestId]}
            onclick={() => void decide(e.requestId, "deny")}>{t("app.chatDock.perm.deny")}</button>
        </div>
      {:else}
        <div class="perm-result">{resolvedText(e)}</div>
      {/if}
    </div>
  {:else if e && e.kind === "outcome"}
    <div class="note" class:err={e.outcome === "error"} data-producer-outcome={e.outcome}>
      {e.outcome === "interrupted"
        ? t("app.chatDock.outcome.interrupted")
        : e.message
          ? t("app.chatDock.outcome.error.detail", { e: e.message })
          : t("app.chatDock.outcome.error")}
    </div>
  {:else if e && e.kind === "notice" && e.code === WAKE_NOTE}
    {@const w = live?.wakes[e.detail ?? ""]}
    <div class="wake" data-producer-wake={e.detail ?? ""}>
      <span class="wake-in"><UiIcon name="bell" size={13} /><span>{w ? wakePill(w) : t("orch.producer.wake.title")}</span></span>
    </div>
  {:else if e && e.kind === "notice" && e.code === "denied-by-policy"}
    <div class="note policy" data-producer-denied={e.detail ?? ""}>
      <UiIcon name="shield-check" size={13} />{t("orch.producer.denied")}
    </div>
  {:else if e && e.kind === "notice"}
    <div class="note" data-producer-notice={e.code}>{e.detail ? `${e.code}: ${e.detail}` : e.code}</div>
  {:else if e && e.kind === "exited"}
    {@const why = live?.ended ?? null}
    <div class="exited" data-producer-exited={why ?? e.reason}>
      <div class="exited-text"><b>{t("orch.producer.exit.title")}</b> — {whyText(why)}</div>
      {#if ended}
        <div class="exited-tip" data-producer-album-ended>{t("orch.producer.exit.tipEnded")}</div>
      {:else}
        <div class="exited-tip">{runId ? t("orch.producer.exit.tipAlbum") : t(restartTip)}</div>
        <button type="button" class="btn btn-secondary btn-sm" data-producer-restart onclick={() => void restartProducer(target)}
          >{t("orch.producer.restart")}</button>
      {/if}
    </div>
  {/if}
{/snippet}

<!-- [끊고 전달] — 알약 칸 안 보내기 원 왼쪽(목업 `CoordChat` · 10-30 실기: 칸 아래 줄에 따로 서 왼쪽 가장자리가 어긋났다) -->
{#snippet deliver()}
  {#if responding}
    <button type="button" class="ghost-pill" title={t("orch.producer.deliver.title")} data-producer-deliver
      onclick={() => void interruptProducer(target.chat, true)}>{t("orch.producer.deliver")}</button>
  {/if}
{/snippet}

<div class="face" role="region" aria-label={t("orch.producer.aria")} data-producer-face={target.chat}>
  <header class="head">
    <span class="avatar-wrap" class:live={responding}><ArtistAvatar cli={target.cli} size={30} /></span>
    <span class="who">
      <b class="title">{onclose ? t("orch.album.log.title") : t("orch.producer.head", { cli: art.name })}</b>
      {#if onclose}
        <span class="sub" data-producer-model>{art.name} · {modelText} · {t("orch.album.log.sub")}</span>
      {:else if canRetune}
        <span class="sub tune" data-producer-model>
          <button type="button" class="tune-chip" aria-expanded={retuneOpen === "model"} title={t("orch.producer.chip.model")}
            data-producer-tune="model" onclick={() => (retuneOpen = retuneOpen === "model" ? null : "model")}>{modelText}</button>
          ·
          <button type="button" class="tune-chip" aria-expanded={retuneOpen === "effort"} title={t("orch.producer.chip.effort")}
            data-producer-tune="effort" onclick={() => (retuneOpen = retuneOpen === "effort" ? null : "effort")}>{effortText}</button>
          {#if runId}· {t("orch.producer.albumOnly")}{/if}
        </span>
      {:else}
        <span class="sub" data-producer-model>{modelText} · {effortText}{#if runId}{` · ${t("orch.producer.albumOnly")}`}{/if}</span>
      {/if}
    </span>
    {#if !onclose}
      <span class="state" data-producer-state={activity}>
        {#if activity === "responding"}<EqBars size={11} />{:else}<span class="dot" aria-hidden="true"></span>{/if}
        {t(ACT_KEY[activity])}
      </span>
    {/if}
    <span class="grow"></span>
    {#if activity !== "ended" && activity !== "readOnly"}<button type="button" class="end-pill" data-producer-end disabled={ending} title={t("orch.producer.end.title")} onclick={() => void endProducer()}>{t("orch.producer.end")}</button>{/if}
    {#if responding}
      <button type="button" class="icon-btn" title={t("orch.producer.interrupt")} aria-label={t("orch.producer.interrupt")}
        data-producer-interrupt onclick={() => void interruptProducer(target.chat, false)}>
        <UiIcon name="close" size={14} />
      </button>
    {/if}
    {#if onclose}
      <button type="button" class="icon-btn" title={t("orch.album.log.close")} aria-label={t("orch.album.log.close")} data-producer-log-close onclick={onclose}>
        <UiIcon name="close" size={14} />
      </button>
    {/if}
  </header>

  {#if endError}<p class="note err" role="alert" data-producer-end-error>{endError}</p>{/if}

  {#if retuneOpen && canRetune}
    <div class="prelaunch tune-row" data-producer-tune-row={retuneOpen}>
      {#if retuneOpen === "model"}
        <div class="pre-row" role="radiogroup" aria-label={t("orch.producer.chip.model")}>
          {#each tuneModels as m (m)}
            <button type="button" class="pre-chip" role="radio" aria-checked={(st?.model ?? target.model) === m} data-producer-tune-model={m}
              onclick={() => void retune({ model: m })}>{m || t("orch.producer.model.default")}</button>
          {/each}
        </div>
      {:else}
        <div class="pre-row" role="radiogroup" aria-label={t("orch.producer.chip.effort")}>
          {#each tuneEfforts as ef (ef)}
            <button type="button" class="pre-chip" role="radio" aria-checked={(st?.effort ?? target.effort ?? "") === ef} data-producer-tune-effort={ef}
              onclick={() => void retune({ effort: ef })}>{ef || t("orch.producer.effort.default")}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  {#if live?.error}
    <div class="banner err" role="alert" data-producer-error>
      <span class="grow">{live.error}</span>
      <button type="button" class="icon-btn" aria-label={t("app.actions.close")} onclick={() => dismissProducerError(target.chat)}>
        <UiIcon name="close" size={12} />
      </button>
    </div>
  {/if}
  {#if live?.readOnly}
    <div class="banner" data-producer-readonly>{t("orch.producer.readOnly")}</div>
  {/if}
  {#if wakeOff}
    <div class="banner wakeoff" data-producer-wake-off={wakeOff.why}>
      <UiIcon name="bell-off" size={13} />
      <span class="grow">{t(`orch.producer.wake.off.${wakeOff.why}` as Key, { segment: wakeOff.segment, cap: wakeOff.cap, total: wakeOff.total, max: wakeOff.max })}</span>
    </div>
  {/if}
  {#if target.forkFrom && !target.conv && !live?.readOnly && (live?.epoch ?? 0) === 0}
    <!-- (단계 5) 갈라 온 채팅 — 첫 말 전에는 원본 타일 대화의 기록을 보인다. 원래 타일은 그대로다 -->
    <div class="banner" data-producer-forked>{t("orch.producer.forked")}</div>
  {/if}
  {#if (live?.denied ?? 0) > 0}
    <div class="banner policy" data-producer-denied-line>
      <UiIcon name="shield-check" size={13} />
      <span class="grow">{t("orch.producer.denied")}</span>
      <button type="button" class="icon-btn" aria-label={t("app.actions.close")} onclick={() => dismissProducerDenied(target.chat)}>
        <UiIcon name="close" size={12} />
      </button>
    </div>
  {/if}
  {#if prelaunch}
    <div class="prelaunch" data-producer-prelaunch>
      <span class="pre-note">{t("orch.producer.prelaunch")}</span>
      {#if preClis.length > 1}
        <div class="pre-row" role="radiogroup" aria-label={t("orch.producer.prelaunch.cli")}>
          <span class="pre-label">{t("orch.producer.prelaunch.cli")}</span>
          {#each preClis as c (c.id)}
            <button type="button" class="pre-chip" role="radio" aria-checked={preCli === c.id} data-producer-pre-cli={c.id}
              onclick={() => pickPre({ cli: c.id === "codex" ? "codex" : "claude" })}>{artistOf(c.id).name}</button>
          {/each}
        </div>
      {/if}
      <div class="pre-row" role="radiogroup" aria-label={t("orch.producer.draft.model")}>
        <span class="pre-label">{t("orch.producer.draft.model")}</span>
        {#each preModels as m (m)}
          <button type="button" class="pre-chip" role="radio" aria-checked={target.model === m} data-producer-pre-model={m}
            onclick={() => pickPre({ model: m })}>{m || t("orch.producer.model.default")}</button>
        {/each}
      </div>
      {#if preEfforts.length > 1}
        <div class="pre-row" role="radiogroup" aria-label={t("orch.producer.draft.effort")}>
          <span class="pre-label">{t("orch.producer.draft.effort")}</span>
          {#each preEfforts as e (e)}
            <button type="button" class="pre-chip" role="radio" aria-checked={target.effort === e} data-producer-pre-effort={e}
              onclick={() => pickPre({ effort: e })}>{e || t("orch.producer.effort.default")}</button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
  {#if endNote}
    <div class="banner" data-producer-gone={endNote.why}>
      <span class="grow"><b>{t("orch.producer.exit.title")}</b> — {whyText(endNote.why)}{#if endNote.restartable}{" · "}{t(restartTip)}{:else if ended}{" · "}{t("orch.producer.exit.tipEnded")}{/if}</span>
      {#if endNote.restartable}
        <button type="button" class="ghost-pill" data-producer-restart onclick={() => void restartProducer(target)}>{t("orch.producer.restart")}</button>
      {/if}
    </div>
  {/if}

  <TranscriptBody
    {convKey}
    {fetchPage}
    {failureOf}
    column
    chat
    diagrams
    activity={bodyActivity}
    live={rows}
    liveCard={card}
    agentHead={head as Snippet<[boolean]>}
    toolPills={pills}
    {userMark}
    {turnBreak}
    hold={st ? historyHold(st) : null}
    refresh={st?.ended ?? 0}
    onrefreshed={(ok) => ok && clearEndedProducer(target.chat)}
    onloaded={(ok) => ok && clearEndedProducer(target.chat)}
    emptyText={t(live?.readOnly || sendClosed ? "orch.producer.emptyClosed" : "orch.producer.empty")}
  />

  <div class="foot">
    {#if runId && !live?.readOnly && activity !== "ended"}
      <div class="lifetime" data-producer-lifetime>
        <UiIcon name="info" size={16} />
        <span>{t("orch.producer.lifetime.a")}<b>{t("orch.producer.lifetime.b")}</b>{t("orch.producer.lifetime.c")}</span>
      </div>
    {/if}
    {#if human}
      <div class="human" role="status" data-producer-human>
        <div class="human-head"><UiIcon name="warning" size={15} />{t("orch.producer.human.title")}</div>
        <div class="human-text">{human.text}</div>
        {#if onalbum}
          <div><button type="button" class="human-btn" data-producer-human-open onclick={onalbum}>{t("orch.producer.human.open")}</button></div>
        {/if}
      </div>
    {/if}
    {#if lastTurnEnded && qsum.count === 0}
      <div class="turn-end" data-producer-turn-end><span class="rule"></span>{t("orch.producer.turnEnd")}<span class="rule"></span></div>
    {/if}
    {#if qsum.count > 0}
      <div class="queue" data-producer-queue={qsum.count} data-held={qsum.held ? "1" : "0"}>
        <div class="queue-head">
          <span class="qchip">{t("orch.producer.queue", { n: qsum.count })}</span>
          <span class="grow">{qsum.held ? t("orch.producer.queue.held") : t("orch.producer.queue.running")}</span>
          {#if qsum.held && !responding}
            <button type="button" class="ghost-pill" data-producer-queue-send onclick={() => void interruptProducer(target.chat, true)}
              >{qsum.failed > 0 ? t("orch.producer.queue.retry") : t("orch.producer.queue.send")}</button>
          {/if}
        </div>
        <ul class="qlist">
          {#each qrows as q (q.clientId)}
            <li class="qrow" class:failed={q.state === "failed"} data-producer-queue-item={q.clientId}>
              <span class="qtext">{q.text ?? t("orch.producer.queue.other")}</span>
              {#if q.state === "failed"}<span class="qflag">{t("orch.producer.queue.failed")}</span>{/if}
              {#if q.cancellable}
                <button type="button" class="btn btn-sm btn-ghost qcancel" data-producer-queue-cancel onclick={() => void cancelQueued(target.chat, q.clientId)}
                  >{t("orch.producer.queue.cancel")}</button>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </div>

  {#if live?.readOnly}
    <!-- 기록만 — 입력 칸을 두지 않는다(실기 a FAIL 2 · 위 띠가 까닭을 말한다) -->
    <div class="readonly-foot" data-producer-readonly-foot>{t("orch.producer.gate.readOnly")}</div>
  {:else if sendClosed}
    <!-- 앨범이 끝났거나 사람이 프로듀서를 끝냈다 — 보낼 곳이 없다(서버도 거절한다 · 실기 34) -->
    <div class="readonly-foot" data-producer-closed-foot={sendClosed}>{t(sendClosed === "albumEnded" ? "orch.producer.gate.albumEnded" : "orch.producer.gate.closed")}</div>
  {:else}
    <FlipComposer
      prefill={producerFillOf(target.chat)}
      onprefilled={(n) => takeProducerFill(target.chat, n)}
      onsend={send}
      onterminal={() => {}}
      inField={deliver}
      {gate}
      placeholder={t("orch.producer.placeholder")}
      bind:inputEl
    />
  {/if}
</div>

<style>
  .face {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    font-family: var(--font-ui);
    color: var(--fg-1);
  }

  .head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-3) var(--space-4);
    border-bottom: 1px solid var(--line);
    min-width: 0;
  }

  .who {
    display: flex;
    flex-direction: column;
    min-width: 0;
  }

  .title {
    font-size: var(--t-sm);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .sub,
  .dimtext {
    font-size: var(--t-xs);
    color: var(--fg-3);
    white-space: nowrap;
  }

  /* 부제가 길어도 머리 폭을 밀지 않는다 — 넘치면 말줄임(좁은 잎에서 ✕ 가 다음 줄로 밀리던 원인) */
  .sub {
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .state {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 10px;
    font-size: var(--t-xs);
    color: var(--m3-on-primary-container, var(--fg-1));
    background: var(--m3-primary-container, color-mix(in srgb, var(--accent) 22%, var(--surface-raised-solid)));
    border-radius: 999px;
    white-space: nowrap;
  }

  .state[data-producer-state="ended"],
  .state[data-producer-state="readOnly"],
  .state[data-producer-state="idle"] {
    background: var(--surface-hover);
    color: var(--fg-2);
  }

  .state[data-producer-state="permission"] {
    background: color-mix(in srgb, var(--warn) 22%, var(--surface-raised-solid));
  }

  .state .dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.7;
  }

  /* 응답 중 고리 — 캐릭터 둘레의 강조색 선(움직임 없음) */
  .avatar-wrap {
    display: inline-flex;
    border-radius: 50%;
  }

  .avatar-wrap.live {
    box-shadow: 0 0 0 2px var(--accent);
  }

  .agent-line {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .agent-line b {
    color: var(--fg-1);
  }

  .grow {
    flex: 1 1 auto;
    min-width: 0;
  }

  .icon-btn {
    flex: 0 0 auto;
    width: 26px;
    height: 26px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    color: var(--fg-2);
    background: transparent;
    border: none;
    border-radius: 50%;
    cursor: pointer;
  }

  .icon-btn:hover {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
  }

  .banner {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-2) var(--space-3) 0;
    padding: var(--space-1) var(--space-2) var(--space-1) var(--space-3);
    font-size: var(--t-xs);
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
    overflow-wrap: anywhere;
  }

  .banner.err {
    background: color-mix(in srgb, var(--err) 12%, var(--surface-field));
    border-color: color-mix(in srgb, var(--err) 40%, var(--line-strong));
  }

  .banner.policy {
    background: color-mix(in srgb, var(--warn) 10%, var(--surface-field));
    border-color: color-mix(in srgb, var(--warn) 35%, var(--line-strong));
  }

  .ghost-pill {
    flex: 0 0 auto;
    padding: 5px 12px;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-1);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 999px;
    cursor: pointer;
    white-space: nowrap;
  }

  .ghost-pill:hover {
    background: var(--control-ghost-hover);
  }

  /* 꼬리(사람 필요 · 턴 끝 · 대기열) — 좌우 여백 = 아래 입력 칸(`FlipComposer` 의 좁은 여백 12px)과 같게: 대기열 칩 · 항목 글 · 알약 칸의 왼쪽 가장자리가
     한 줄에 서고, 항목 [취소] 는 알약 칸의 오른쪽 가장자리에 선다(10-30 실기) */
  .foot {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-3);
  }

  .foot:empty {
    display: none;
  }

  .human {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: var(--space-3);
    font-size: var(--t-sm);
    background: color-mix(in srgb, var(--warn) 12%, var(--surface-field));
    border: 1px solid color-mix(in srgb, var(--warn) 45%, var(--line-strong));
    border-radius: 12px;
  }

  .human-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-semibold);
    color: var(--warn);
  }

  .human-btn {
    padding: 5px 12px;
    font: inherit;
    font-size: var(--t-xs);
    font-weight: var(--fw-semibold);
    color: var(--surface-raised-solid);
    background: var(--warn);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  .turn-end {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .turn-end .rule {
    flex: 1;
    height: 1px;
    background: var(--line);
  }

  .queue {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .queue-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-height: 24px;
  }

  .queue-head .grow {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .qchip {
    padding: 3px 10px;
    color: var(--fg-1);
    background: var(--surface-hover);
    border-radius: 999px;
    white-space: nowrap;
  }

  /* 항목 줄 — 글은 대기열 칩 안 글자와 같은 들여쓰기(칩 안쪽 여백 10px) · [취소] 는 오른쪽 끝 */
  .qlist {
    list-style: none;
    margin: 0;
    padding: 0 0 0 10px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .qrow {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    min-height: 24px;
  }

  .qcancel {
    flex: 0 0 auto;
    margin-right: -4px;
  }

  .qtext {
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    color: var(--fg-1);
  }

  .qrow.failed .qtext {
    color: var(--err);
  }

  .qflag {
    color: var(--err);
  }

  .perm {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    background: var(--surface-field);
    border: 1px solid color-mix(in srgb, var(--warn) 55%, var(--line-strong));
    border-radius: 10px;
  }

  .perm.done {
    border-color: var(--line-strong);
    opacity: 0.85;
  }

  .perm-head {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    font-weight: var(--fw-semibold);
  }

  .perm-title {
    flex: 1 1 auto;
    min-width: 0;
    overflow-wrap: anywhere;
  }

  .perm-tool {
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    color: var(--fg-2);
  }

  .perm-detail {
    margin: 0;
    max-height: 200px;
    overflow: auto;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: var(--t-xs);
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    background: var(--surface-raised-solid);
    border: 1px solid var(--line);
    border-radius: var(--radius-sm);
  }

  .perm-actions {
    display: flex;
    gap: var(--space-2);
  }

  .perm-actions .btn {
    flex: 1;
    justify-content: center;
  }

  .perm-result,
  .exited-tip {
    font-size: var(--t-xs);
    color: var(--fg-3);
  }

  .note {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: var(--t-xs);
    color: var(--fg-3);
    overflow-wrap: anywhere;
  }

  /* 수명 안내 — 입력 칸 위 둥근 상자(목업 V3AlbumClosed) */
  .lifetime {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    font-size: var(--t-xs);
    line-height: 1.55;
    color: var(--fg-2);
    background: var(--m3-surface-container-high, var(--surface-field));
    border-radius: 12px;
  }

  .lifetime > :global(svg) {
    flex: 0 0 auto;
    margin-top: 1px;
    color: var(--accent);
  }

  .lifetime b {
    color: var(--fg-1);
  }

  /* [프로듀서 끝내기] — 빨간 글자 · 테두리 알약(목업) */
  .end-pill {
    flex: 0 0 auto;
    font: inherit;
    font-size: var(--t-xs);
    color: var(--err);
    background: transparent;
    border: 1px solid var(--line-strong, var(--line));
    border-radius: 999px;
    padding: 5px 12px;
    cursor: pointer;
    white-space: nowrap;
  }

  .end-pill:hover:not(:disabled) {
    background: color-mix(in srgb, var(--err) 10%, transparent);
  }

  .end-pill:disabled {
    opacity: 0.5;
    cursor: default;
  }

  .end-pill:focus-visible {
    outline: 2px solid var(--focus-ring, var(--accent));
    outline-offset: 2px;
  }

  .note.err {
    color: var(--err);
  }

  .note.policy {
    color: var(--warn);
  }

  .exited {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    font-size: var(--t-sm);
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
  }

  .exited .btn {
    align-self: flex-start;
  }

  .readonly-foot {
    margin: var(--space-2) var(--space-4) var(--space-3);
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    color: var(--fg-3);
    text-align: center;
    border: 1px dashed var(--line-strong);
    border-radius: 22px;
  }

  /* 앱이 깨움 — 꼬리의 표지(기록의 알약과 같은 가운데 점선 모양 — TranscriptBody `.wake-in`) */
  .wake {
    display: flex;
    justify-content: center;
  }

  .wake-in {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    max-width: 100%;
    padding: 6px 12px;
    font-size: var(--t-xs);
    color: var(--fg-2);
    border: 1px dashed var(--line-strong);
    border-radius: 999px;
    overflow-wrap: anywhere;
  }

  .wake-in :global(svg) {
    flex: 0 0 auto;
    color: var(--accent);
  }

  .banner.wakeoff {
    color: var(--fg-2);
    border-style: dashed;
  }

  /* 대화 중 모델 · 강도 칩 — 머리 아래 글자가 눌린다 */
  .sub.tune {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .tune-chip {
    padding: 0 6px;
    font: inherit;
    color: var(--fg-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: 999px;
    cursor: pointer;
  }

  .tune-chip:hover,
  .tune-chip[aria-expanded="true"] {
    color: var(--fg-1);
    background: var(--control-ghost-hover);
    border-color: var(--line-strong);
  }

  /* 띄우기 전 칩 — "새 앨범" 칸의 칩과 같은 모양(작게) */
  .prelaunch {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: var(--space-2) var(--space-3) 0;
    padding: var(--space-2) var(--space-3);
    font-size: var(--t-xs);
    background: var(--surface-field);
    border: 1px solid var(--line-strong);
    border-radius: 10px;
  }

  .pre-note {
    color: var(--fg-3);
  }

  .pre-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
  }

  .pre-label {
    min-width: 3.5em;
    color: var(--fg-3);
  }

  .pre-chip {
    font: inherit;
    font-size: var(--t-xs);
    color: var(--fg-2);
    background: var(--control-bg, var(--surface-hover));
    border: 0;
    border-radius: 999px;
    padding: 4px 10px;
    cursor: pointer;
    white-space: nowrap;
  }

  .pre-chip[aria-checked="true"] {
    background: var(--control-sel-bg, var(--m3-secondary-container, var(--accent-soft)));
    color: var(--control-sel-fg, var(--fg-1));
  }

  /* 수명 안내는 아주 좁은 잎(창 620 근처 · 약 215)에서만 걷는다 — 1400 창의 표준 채팅 폭(약 360 · `orch-tab.ts` 의 `PRODUCER_SHARE` · `PRODUCER_PX`)에서는 보인다 */
  @container (max-width: 300px) {
    .lifetime { display: none; }
  }

  /* 좁은 잎(실기 a 31 — 창 620px 근처면 잎이 200px 안팎 · 1400 창의 표준 폭 약 360 도) — 머리를 두 줄로: 제목 줄 · 상태 칩 줄. 잎(`ProducerLeaf .leaf`)이 크기 컨테이너 */
  @container (max-width: 420px) {
    .head [data-producer-end] { order: 4; margin-left: auto; }
    .head {
      flex-wrap: wrap;
      row-gap: 6px;
      padding: var(--space-2) var(--space-3);
    }

    .who {
      flex: 1 1 calc(100% - 40px);
    }

    /* 닫기 · 끊기 원형 단추는 첫 줄(제목 옆)에 남긴다 — 제목 칸이 그 몫(단추 28 + 사이)까지 비워 둔다 */
    .head:has(.icon-btn) .who {
      flex-basis: calc(100% - 82px);
    }

    .head .icon-btn {
      order: 2;
    }

    .state {
      order: 3;
    }

    .head .grow {
      display: none;
    }

    .foot {
      padding: 0 var(--space-3);
    }
  }
</style>
