// 세션을 실제로 여는 곳(invoke) — kind 별 백엔드 명령 이름(`BACKEND`)은 여기 한 곳에서만 정의한다.

import { Channel, invoke, listen, type UnlistenFn } from "../ipc";
import {
  parseExitReason,
  type ConfirmHostKey,
  type OpenOptions,
  type PromptPassphrase,
  type PromptPassword,
  type SessionExitReason,
  type SessionHandle,
  type SessionLease,
  type SshExitPayload,
} from "./contract";
import { SessionOpenError, parseSessionError } from "./errors";
import { mergeSource, type InputSource } from "$lib/term/input-source";
import { runSshGates } from "./ssh-gates";
import { koTr } from "./ko-tr";
import { paneName } from "./names";
import { hasSession, type AdhocTarget, type PaneSpec, type SessionKind } from "./spec";

interface KindBackend {
  write: string;
  resize: string;
  close: string;
  /** 지금은 없다 — 파이프 너머의 pause/resume 은 순서 없이 늦게 닿을 수 있어 단조 오프셋 `ack` 이 대신한다(`server::credit`) */
  pause: string | null;
  resume: string | null;
  ack: string | null;
  /** payload 는 [`SshExitPayload`] */
  exitEvent: string | null;
}

const BACKEND: Record<SessionKind, KindBackend> = {
  local: {
    write: "write_session",
    resize: "resize_session",
    close: "close_session",
    pause: null,
    resume: null,
    ack: "ack_local_output",
    // `reason` 은 언제나 `"exit"` 다(자동 재연결의 `"error"` 는 SSH 에만). Rust 는 파이프 EOF 가 아니라 자식 종료를 본다 —
    // ConPTY 는 EOF 가 늦거나 오지 않을 수 있다(pty.rs 의 `spawn_exit_watch`).
    exitEvent: "local-exit",
  },
  ssh: {
    write: "write_session",
    resize: "resize_session",
    close: "close_session",
    pause: null,
    resume: null,
    ack: "ack_local_output",
    exitEvent: "ssh-exit",
  },
};

// ── 세션 코어 임대 ──

/**
 * 손잡이 밖에서 세션을 부르는 자리가 손잡이와 같은 열쇠를 싣게 한다. 열쇠에 종류가 붙는 이유: 로컬과 SSH 의 백엔드 id
 * 카운터는 따로 돈다(로컬 3번과 SSH 3번이 다른 세션이다).
 */
const leases = new Map<string, SessionLease>();
const leaseKey = (kind: SessionKind, id: number) => `${kind}:${id}`;

export function leaseOf(kind: SessionKind, id: number): SessionLease | null {
  return leases.get(leaseKey(kind, id)) ?? null;
}

/** 임대가 없으면 `id` 만 간다 — Rust 가 거부한다(일어나면 안 되는 길이라 조용히 실패) */
export function sessionKeyArgs(
  _kind: SessionKind,
  id: number,
  lease: SessionLease | null | undefined,
): Record<string, unknown> {
  if (lease) {
    return { stream: lease.stream, sessionEpoch: lease.sessionEpoch, leaseEpoch: lease.leaseEpoch };
  }
  return { id };
}

/** 시도마다 새 Channel 을 만든다 — 거부된 invoke 에 실렸던 채널을 재시도에 쓰면 데이터가 허공으로 가 화면이 검게 남는다 */
function openArgs(opts: OpenOptions) {
  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = opts.onData;
  return { onData, cols: opts.cols, rows: opts.rows };
}

/** Rust `SshOpenResult` */
export interface SshOpened {
  id: number;
  tmux: string | null;
  lease: SessionLease;
}

/** `tmuxName` 은 재접속 힌트다 — 백엔드는 있으면 그 이름으로 `-A -D`, 없으면 비어 있는 다음 번호로 `-A` 를 쓴다 */
export async function openSshInteractive(
  alias: string,
  opts: OpenOptions,
  confirm?: ConfirmHostKey,
  promptPassword?: PromptPassword,
  tmuxName?: string,
  adhoc?: AdhocTarget,
  promptPassphrase?: PromptPassphrase,
  noTmux?: boolean,
  forceTmux?: boolean,
  streamId?: string,
): Promise<SshOpened> {
  return runSshGates(alias, { confirm, promptPassword, promptPassphrase }, (c) =>
    invoke<SshOpened>("open_ssh_session", {
      alias,
      hostKeyDecision: c.hostKeyDecision,
      password: c.password,
      passphrase: c.passphrase,
      passphraseFor: c.passphraseFor,
      declinedKeys: c.declinedKeys,
      tmuxName: tmuxName ?? null,
      adhoc: adhoc ?? null,
      start: opts.start ?? null,
      noTmux: noTmux ?? false,
      forceTmux: forceTmux ?? false,
      // 에이전트 신호를 세울지는 싣지 않는다 — 세션 서버가 정한다(Rust `ssh::open::signal_stream` 한 곳).
      streamId: streamId ?? null,
      ...openArgs(opts),
    }),
  );
}

/** Rust `pty::LocalSession` */
interface LocalOpened {
  id: number;
  shell: string;
  lease: SessionLease;
}

async function openLocal(
  opts: OpenOptions,
  shell?: string,
  injectMcpToken?: boolean,
  cwd?: string,
  streamId?: string,
  codexTile?: boolean,
): Promise<LocalOpened> {
  try {
    // MCP 토큰을 어느 타일에 심을지(AI 타일 · 감싸개가 있는 로컬 셸 타일)는 Rust `agent_tile.rs` 가 정한다 — 프런트가 판정하지 않는다.
    return await invoke<LocalOpened>("open_local_session", {
      shell: shell ?? null,
      injectMcpToken: injectMcpToken ?? false,
      cwd: cwd ?? null,
      streamId: streamId ?? null,
      // Rust 가 그 타일 셸의 PATH 를 거른다(스토어 pwsh 를 빼 Codex 샌드박스가 셸을 띄우게 — `codex_launch` 머리말). 셸 줄로 바꾸지 않는다.
      codexTile: codexTile ?? false,
      ...openArgs(opts),
    });
  } catch (e) {
    throw new SessionOpenError(parseSessionError(e, koTr));
  }
}

/** 이벤트는 모든 창에 방송되므로 다른 창 · 타일의 종료도 섞인다 — 가둔다 */
const EARLY_EXIT_CAP = 32;

/**
 * 열기 invoke 전에 건다 — 즉시 끝나는 셸은 `open_*` 가 돌아오기 전에 종료를 쏘므로, 뒤에 걸면 '종료됨' 없는 죽은 타일이 된다.
 * 버퍼에서 찾은 종료는 다음 매크로태스크에 넘긴다 — 부른 쪽이 손잡이를 쥔 뒤여야 `handleExit` 가 닫을 것이 있다.
 */
interface ExitWatch {
  ready: Promise<void>;
  bind(id: number, deliver: (payload: SshExitPayload) => void): void;
  stop(): Promise<void>;
}

function watchExit(kind: SessionKind): ExitWatch | null {
  const event = BACKEND[kind].exitEvent;
  if (!event) return null;
  let bound: { id: number; deliver: (payload: SshExitPayload) => void } | null = null;
  let early: SshExitPayload[] = [];
  const unlisten: Promise<UnlistenFn> = listen<SshExitPayload>(event, (ev) => {
    const payload = ev.payload;
    if (!payload) return;
    if (!bound) {
      early.push(payload);
      if (early.length > EARLY_EXIT_CAP) early.shift();
      return;
    }
    if (payload.id === bound.id) bound.deliver(payload);
  }).catch(() => () => {});
  return {
    ready: unlisten.then(() => {}),
    bind(id, deliver) {
      bound = { id, deliver };
      const hit = early.find((p) => p.id === id);
      early = [];
      if (hit) setTimeout(() => deliver(hit), 0);
    },
    async stop() {
      try {
        (await unlisten)();
      } catch {
        /* 무시 */
      }
    },
  };
}

async function openWatched<T>(
  kind: SessionKind,
  onExit: ((reason: SessionExitReason) => void) | undefined,
  open: () => Promise<T>,
): Promise<{ opened: T; watch: ExitWatch | null }> {
  const watch = onExit ? watchExit(kind) : null;
  if (watch) await watch.ready;
  try {
    return { opened: await open(), watch };
  } catch (e) {
    await watch?.stop();
    throw e;
  }
}

function makeHandle(
  kind: SessionKind,
  id: number,
  onExit?: (reason: SessionExitReason) => void,
  resolvedShell?: string,
  tmuxName?: string,
  early?: ExitWatch | null,
  lease?: SessionLease,
  // 붙기에서만 — Rust 가 이미 이 크기로 맞춰 두었다. 같은 크기를 다시 보내면 ConPTY 가 화면을 다시 그려 줄을 한 벌 더 얹는다.
  initialSize?: { cols: number; rows: number },
  // 있으면 임대 표(`leases`)에 오르지 않고(창의 닫기 · 떠나기 · 체크포인트가 시청자 열쇠로 나가지 않게) 닫기 · 놓기가 시청 끝이다 —
  // 세션은 닫지 않는다.
  viewer?: ViewerHooks,
): SessionHandle {
  const be = BACKEND[kind];
  const key = sessionKeyArgs(kind, id, lease);
  if (lease && !viewer) leases.set(leaseKey(kind, id), lease);
  let dead = false;
  let sentCols = initialSize?.cols ?? -1;
  let sentRows = initialSize?.rows ?? -1;
  /** 같은 id 에 새 손잡이가 섰으면 그쪽 임대는 건드리지 않는다 */
  const forget = () => {
    if (lease && leases.get(leaseKey(kind, id)) === lease) leases.delete(leaseKey(kind, id));
  };

  // ── 입력 레인 ──
  // invoke 는 호출 순서대로 Rust 에서 실행된다는 보장이 없다(async 명령) — 그대로 쏘면 빠른 키 입력 둘이 뒤바뀔 수 있어
  // 한 번에 하나만 날리고 그동안 온 입력은 이어 붙였다가 한 덩어리로 보낸다.
  let writing: Promise<void> | null = null;
  let pendingInput = "";
  /** 묶음의 출처(`mergeSource`) — 서버가 크기 주인 판정에 쓴다 */
  let pendingSource: InputSource | null = null;
  let draining = false;

  // ── 크기 레인 ── 날아가는 중이면 가장 최근 요청만 남긴다(입력과 상대 순서는 맞추지 않는다).
  let resizing = false;
  let wantCols = -1;
  let wantRows = -1;

  const watch = early ?? (onExit ? watchExit(kind) : null);
  if (onExit) {
    watch?.bind(id, (payload) => {
      if (dead) return;
      dead = true;
      onExit(parseExitReason(payload));
    });
  }

  const viewerEnded: Promise<UnlistenFn> | null =
    viewer && lease
      ? listen<ViewerEndedPayload>(VIEWER_ENDED_EVENT, (ev) => {
          const p = ev.payload;
          if (!p || p.stream !== lease.stream || p.sessionEpoch !== lease.sessionEpoch || p.leaseEpoch !== lease.leaseEpoch) return;
          if (p.reason === "detached") return; // 제 손으로 뗐다
          const wasDead = dead;
          dead = true;
          liveViewers.delete(handle);
          if (!wasDead) viewer.onEnded?.(p.reason);
        }).catch(() => () => {})
      : null;
  const leaveViewer = async () => {
    liveViewers.delete(handle);
    if (!lease) return;
    try {
      await invoke("detach_session_viewer", {
        stream: lease.stream,
        sessionEpoch: lease.sessionEpoch,
        leaseEpoch: lease.leaseEpoch,
      });
    } catch {
      /* 서버가 이미 뗐다 */
    }
  };

  const handle: SessionHandle = {
    id,
    kind,
    resolvedShell,
    tmuxName,
    lease,
    viewer: viewer ? true : undefined,
    write(data, source = "keyboard") {
      if (dead || draining || !data) return;
      pendingInput += data;
      pendingSource = mergeSource(pendingSource, source);
      pumpWrite();
    },
    // 같은 크기는 다시 보내지 않는다 — ConPTY 는 같은 크기에도 화면을 자기 버퍼로 다시 그려 xterm 이 혼자 그린 인라인 그림을 지운다
    // (docs/log/2026-09-26-osc-notify-inline-images.md). 기준은 성공한 크기다.
    resize(cols, rows) {
      if (dead) return;
      wantCols = cols;
      wantRows = rows;
      pumpResize();
    },
    async claimSize(cols, rows) {
      if (dead || !lease) return false;
      try {
        const owner = await invoke<boolean>("claim_session_size", { ...key, cols, rows });
        // 서버가 이 크기를 걸었다 — 같은 크기를 resize 로 다시 보내지 않는다.
        if (owner) {
          sentCols = cols;
          sentRows = rows;
          wantCols = cols;
          wantRows = rows;
        }
        return owner === true;
      } catch {
        return false;
      }
    },
    pause() {
      if (!dead && be.pause) void invoke(be.pause, key).catch(() => {});
    },
    resume() {
      if (!dead && be.resume) void invoke(be.resume, key).catch(() => {});
    },
    ack: be.ack
      ? (consumed: number) => {
          if (!dead && be.ack) void invoke(be.ack, { ...key, consumed }).catch(() => {});
        }
      : undefined,
    async close() {
      dead = true;
      pendingInput = "";
      await drop();
      // 시청자 열쇠의 `close` 는 서버가 거절한다 — 세션을 닫는 것은 주의 일이다.
      if (viewer) return leaveViewer();
      try {
        await invoke(be.close, key);
      } catch {
        /* 이미 끝난 세션이면 실패해도 상관없다 */
      } finally {
        forget();
      }
    },
    // 남은 입력을 먼저 비운다 — 창 이관 직전에 친 글자가 사라지지 않게.
    async detach() {
      draining = true;
      while (writing) await writing;
      dead = true;
      await drop();
      if (viewer) await leaveViewer();
    },
  };
  if (viewer) liveViewers.add(handle);
  return handle;

  function pumpWrite() {
    if (dead || writing || !pendingInput) return;
    const data = pendingInput;
    const source = pendingSource ?? "keyboard";
    pendingInput = "";
    pendingSource = null;
    writing = invoke(be.write, { ...key, data, source })
      .then(
        () => {},
        () => {},
      )
      .finally(() => {
        writing = null;
        if (dead) pendingInput = "";
        else pumpWrite();
      });
  }

  function pumpResize() {
    if (dead || resizing || (wantCols === sentCols && wantRows === sentRows)) return;
    const cols = wantCols;
    const rows = wantRows;
    resizing = true;
    void invoke(be.resize, { ...key, cols, rows })
      .then(
        () => {
          sentCols = cols;
          sentRows = rows;
        },
        () => {
          // 실패한 요청은 잊는다 — 그대로 두면 같은 크기를 무한히 다시 쏜다(그 사이 온 새 크기는 남긴다).
          if (wantCols === cols && wantRows === rows) {
            wantCols = sentCols;
            wantRows = sentRows;
          }
        },
      )
      .finally(() => {
        resizing = false;
        pumpResize();
      });
  }

  async function drop() {
    await watch?.stop();
    if (viewerEnded) {
      try {
        (await viewerEnded)();
      } catch {
        /* 무시 */
      }
    }
    // detach(이관)는 받는 창이 새 임대를 받는다 — 이 창의 열쇠는 곧 낡는다.
    if (dead) forget();
  }
}

/** 실패하면 항상 `SessionOpenError` 를 던진다 */
export async function openSession(pane: PaneSpec, opts: OpenOptions): Promise<SessionHandle> {
  if (!hasSession(pane.kind)) {
    throw new SessionOpenError({
      kind: "other",
      message: koTr("pane.error.no_session", { name: paneName(pane, koTr) }),
    });
  }
  if (pane.kind === "ssh") {
    const { opened, watch } = await openWatched(pane.kind, opts.onExit, () =>
      openSshInteractive(
        pane.alias ?? "",
        opts,
        opts.confirmHostKey,
        opts.promptPassword,
        pane.tmux,
        pane.adhoc,
        opts.promptPassphrase,
        pane.noTmux,
        pane.forceTmux,
        sessionStreamOf(pane),
      ),
    );
    return makeHandle(
      pane.kind,
      opened.id,
      opts.onExit,
      undefined,
      opened.tmux ?? undefined,
      watch,
      opened.lease ?? undefined,
    );
  }
  const {
    opened: { id, shell, lease },
    watch,
  } = await openWatched(pane.kind, opts.onExit, () =>
    openLocal(
      opts,
      pane.shell,
      pane.injectMcpToken,
      opts.localCwd ?? pane.cwd,
      sessionStreamOf(pane),
      pane.injectMcpToken === true && isCodexLine(pane.autorun),
    ),
  );
  return makeHandle(pane.kind, id, opts.onExit, shell, undefined, watch, lease);
}

/** Rust `codex_launch::is_codex` 와 같은 판정 */
export function isCodexLine(line: string | undefined): boolean {
  const first = (line ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return first === "codex" || first === "codex.exe" || first === "codex.cmd";
}

/** 세션 코어 표 · 체크포인트 · 로컬 `AYNX_STREAM` · 원격 신호 스트림 · MCP 거울이 모두 이 값이다 */
export function sessionStreamOf(pane: Pick<PaneSpec, "id" | "historyStreamId">): string {
  return pane.historyStreamId ?? pane.id;
}

/** Rust `session_core::Probe` */
export interface SessionProbe {
  state: "none" | "opening" | "attached" | "detached" | "exited" | "disconnected";
  kind?: SessionKind | null;
  sessionEpoch: number | null;
  checkpoint: SessionCheckpoint | null;
  /** 옛 서버에는 없다 */
  aiRead?: boolean;
}

export function setSessionAiRead(stream: string, on: boolean): void {
  invoke("set_session_ai_read", { stream, on }).catch(() => {});
}

/** Rust `session_core::Checkpoint` */
export interface SessionCheckpoint {
  buffer: string;
  cols: number;
  rows: number;
  consumed: number;
  sessionEpoch: number;
}

/** 닫기가 아직 도착하지 않았거나 다른 열기가 진행 중일 때다 — 부른 쪽은 잠시 뒤 다시 본다 */
export function isLiveSessionConflict(e: unknown): boolean {
  const text =
    e instanceof SessionOpenError && "message" in e.detail
      ? String(e.detail.message)
      : e instanceof Error
        ? e.message
        : String(e);
  return text.includes("[session-alive]") || text.includes("[session-busy]");
}

/** 명령이 실패하면 `null`(= 새로 연다) */
export async function probeSession(stream: string, kind?: SessionKind): Promise<SessionProbe | null> {
  try {
    // 종류를 실으면 SSH 타일은 세션 서버(로컬)에 묻지 않는다 — 부팅 직후 서버가 붙기 전에 기다리지 않게.
    return await invoke<SessionProbe>("probe_session", { stream, kind: kind ?? null });
  } catch {
    return null;
  }
}

export function planAttach(
  probe: SessionProbe | null,
  kind?: SessionKind,
):
  | { mode: "open" }
  | { mode: "attach"; sessionEpoch: number; checkpoint: SessionCheckpoint | null; consumed: number; aiRead: boolean } {
  if (!probe || probe.state !== "detached" || probe.sessionEpoch === null) return { mode: "open" };
  if (kind && probe.kind && probe.kind !== kind) return { mode: "open" };
  const cp = probe.checkpoint && probe.checkpoint.sessionEpoch === probe.sessionEpoch ? probe.checkpoint : null;
  return {
    mode: "attach",
    sessionEpoch: probe.sessionEpoch,
    checkpoint: cp,
    consumed: cp ? cp.consumed : 0,
    aiRead: probe.aiRead === true,
  };
}

/** Rust `session_core::commands::Attached` */
interface Attached {
  id: number;
  kind: SessionKind;
  lease: SessionLease;
  start: number;
  end: number;
  replayed: boolean;
  overrunBytes: number;
  /** 붙기 전 PTY 크기(로컬만 — 재생분이 쓰인 화면 크기) */
  ptyCols?: number | null;
  ptyRows?: number | null;
  shell: string | null;
  /** 옛 서버는 없다 */
  sizeOwner?: boolean;
}

/** SSH 는 새 접속이 아니다 — 원격 autorun · 셸 통합 스니펫 · 훅 설치를 다시 보내지 않는다 */
export async function attachSession(
  pane: PaneSpec,
  opts: OpenOptions,
  // `sized` 가 거짓이면(숨은 탭) 크기를 싣지 않는다 — 타일이 보일 때 첫 resize 가 맞춘다.
  plan: { sessionEpoch: number; consumed: number; sized: boolean },
): Promise<SessionHandle> {
  if (!hasSession(pane.kind)) {
    throw new SessionOpenError({
      kind: "other",
      message: koTr("pane.error.no_session", { name: paneName(pane, koTr) }),
    });
  }
  const kind: SessionKind = pane.kind;
  const stream = sessionStreamOf(pane);
  // 종료 구독은 타일 종류의 이벤트로 — `done.kind` 는 붙은 뒤에야 오고, 종류가 다른 세션에는 붙지 않는다(`planAttach`).
  const watch = opts.onExit ? watchExit(kind) : null;
  if (watch) await watch.ready;
  let done: Attached;
  try {
    done = await invoke<Attached>("attach_session", {
      stream,
      expectedSessionEpoch: plan.sessionEpoch,
      consumed: plan.consumed,
      take: false,
      ...openArgs(opts),
      ...(plan.sized ? {} : { cols: null, rows: null }),
    });
  } catch (e) {
    await watch?.stop();
    throw new SessionOpenError(parseSessionError(e, koTr));
  }
  const handle = makeHandle(
    done.kind ?? kind,
    done.id,
    opts.onExit,
    done.shell ?? undefined,
    undefined,
    watch,
    done.lease,
    plan.sized ? { cols: opts.cols, rows: opts.rows } : undefined,
  );
  return Object.assign(handle, {
    outputStart: done.start,
    replayEnd: done.end,
    overrunBytes: done.overrunBytes,
    // 옛 서버는 칸이 없다(주인으로 본다).
    sizeOwner: done.sizeOwner !== false,
    replaySize:
      typeof done.ptyCols === "number" && typeof done.ptyRows === "number" && done.ptyCols > 0 && done.ptyRows > 0
        ? { cols: done.ptyCols, rows: done.ptyRows }
        : undefined,
  });
}

/** 세션은 살려 둔 채 임대만 푼다 — 언로드 중이라 닿는다는 보장이 없다(Rust 의 페이지 로드 그물이 같은 떨어뜨리기를 한다) */
export function detachSession(
  kind: SessionKind,
  id: number,
  checkpoint: Omit<SessionCheckpoint, "sessionEpoch"> | null,
  /** 사람이 타일을 닫아 놓는다 — 서버가 작업자 스트림만 떨어진 세션 목록에 곧바로 보이게 표시한다 */
  release = false,
): Promise<void> {
  const lease = leases.get(leaseKey(kind, id));
  if (!lease) return Promise.resolve();
  // 앱 종료(quitAll)는 이 약속이 끝나기를 기다린 뒤 끊는다.
  return invoke("detach_session", {
    stream: lease.stream,
    sessionEpoch: lease.sessionEpoch,
    leaseEpoch: lease.leaseEpoch,
    checkpoint: checkpoint ? { ...checkpoint, sessionEpoch: lease.sessionEpoch } : null,
    release,
  }).then(
    () => {},
    () => {},
  );
}

export function stashCheckpoint(
  kind: SessionKind,
  id: number,
  checkpoint: Omit<SessionCheckpoint, "sessionEpoch">,
): void {
  const lease = leases.get(leaseKey(kind, id));
  if (!lease) return;
  void invoke("stash_checkpoint", {
    stream: lease.stream,
    sessionEpoch: lease.sessionEpoch,
    leaseEpoch: lease.leaseEpoch,
    checkpoint: { ...checkpoint, sessionEpoch: lease.sessionEpoch },
  }).catch(() => {});
}

/** 아무 타일도 데려가지 않은 세션은 닫지 않고 "떨어진 세션" 으로 남는다 — Rust 가 닫는 것은 끝난 잔해뿐이다 */
export async function restoreDoneSessions(keep: readonly string[]): Promise<{ closed: number; unclaimed: number } | null> {
  try {
    return await invoke<{ closed: number; unclaimed: number }>("restore_done_sessions", { keep: [...keep] });
  } catch (e) {
    console.error("[aynx] 복원이 끝났음을 세션 서버에 알리지 못했습니다:", e);
    return null;
  }
}

/** 창 이관 — 세션 id 는 그대로이고(재연결과 다르다) 출력 방향만 이 창으로 돌린다 */
export async function reattachSession(
  pane: PaneSpec,
  sessionId: number,
  opts: OpenOptions,
  // 있으면 Rust 가 그 뒤 꼬리(이관 틈에 옛 채널로 가 사라진 출력)를 새 채널에 먼저 흘린다.
  consumed?: number,
): Promise<SessionHandle> {
  if (!hasSession(pane.kind)) {
    throw new SessionOpenError({
      kind: "other",
      message: koTr("pane.error.no_session", { name: paneName(pane, koTr) }),
    });
  }
  let done: ReattachResult | undefined;
  try {
    done = await invoke<ReattachResult>("reattach_output", {
      kind: pane.kind,
      id: sessionId,
      ...openArgs(opts),
      consumed: consumed ?? null,
    });
  } catch (e) {
    throw new SessionOpenError(parseSessionError(e, koTr));
  }
  const handle = makeHandle(pane.kind, sessionId, opts.onExit, undefined, undefined, undefined, done?.lease ?? undefined);
  return typeof done?.start === "number" ? Object.assign(handle, { outputStart: done.start }) : handle;
}

// ── 시청자 ──

export const VIEWER_ENDED_EVENT = "session-viewer-ended";
export const SIZE_OWNER_EVENT = "session-size-owner";

/** `reason`: `overflow`(다시 붙어 재동기화) · `ended`(세션 끝) · `window` · `conn` · `detached` */
export interface ViewerEndedPayload {
  stream: string;
  sessionEpoch: number;
  leaseEpoch: number;
  id: number;
  kind: SessionKind;
  reason: string;
}

/** 제 손으로 뗀 것은 오지 않는다 */
interface ViewerHooks {
  onEnded?: (reason: string) => void;
}

const liveViewers = new Set<SessionHandle>();

/** 안 닿아도 원격 창이 사라지면 GUI 가 그 창의 시청자를 뗀다 — 떠난 페이지의 시청자가 크기 주인으로 남는 틈을 줄이는 빠른 길이다 */
export function leaveViewers(): void {
  for (const h of [...liveViewers]) void h.close();
}

interface ViewerAttached extends Attached {
  viewer: true;
  ownerCols?: number | null;
  ownerRows?: number | null;
  /** 옛 서버는 없다 */
  ownerPrimary?: boolean;
}

/**
 * 주 임대를 빼앗지 않고 같은 세션을 함께 본다 — 닫기 · 놓기는 시청 끝이다(세션은 그대로).
 * `plan.sessionEpoch` 가 있으면 그 회차에만 붙는다 — 재동기화가 새 회차에 이어 붙지 않게.
 */
export async function attachSessionViewer(
  pane: PaneSpec,
  opts: OpenOptions & { onViewerEnded?: (reason: string) => void },
  plan: { sessionEpoch: number | null; consumed: number; sized: boolean; eligible?: boolean },
): Promise<SessionHandle> {
  if (!hasSession(pane.kind)) {
    throw new SessionOpenError({
      kind: "other",
      message: koTr("pane.error.no_session", { name: paneName(pane, koTr) }),
    });
  }
  const kind: SessionKind = pane.kind;
  const watch = opts.onExit ? watchExit(kind) : null;
  if (watch) await watch.ready;
  let done: ViewerAttached;
  try {
    done = await invoke<ViewerAttached>("attach_session_viewer", {
      stream: sessionStreamOf(pane),
      expectedSessionEpoch: plan.sessionEpoch,
      consumed: plan.consumed,
      sizeOwnerEligible: plan.eligible ?? true,
      ...openArgs(opts),
      ...(plan.sized ? {} : { cols: null, rows: null }),
    });
  } catch (e) {
    await watch?.stop();
    throw new SessionOpenError(parseSessionError(e, koTr));
  }
  const handle = makeHandle(
    done.kind ?? kind,
    done.id,
    opts.onExit,
    done.shell ?? undefined,
    undefined,
    watch,
    done.lease,
    plan.sized ? { cols: opts.cols, rows: opts.rows } : undefined,
    { onEnded: opts.onViewerEnded },
  );
  return Object.assign(handle, {
    outputStart: done.start,
    replayEnd: done.end,
    overrunBytes: done.overrunBytes,
    sizeOwner: done.sizeOwner === true,
    ownerPrimary: typeof done.ownerPrimary === "boolean" ? done.ownerPrimary : undefined,
    ownerSize:
      typeof done.ownerCols === "number" && typeof done.ownerRows === "number" && done.ownerCols > 0 && done.ownerRows > 0
        ? { cols: done.ownerCols, rows: done.ownerRows }
        : undefined,
    replaySize:
      typeof done.ptyCols === "number" && typeof done.ptyRows === "number" && done.ptyCols > 0 && done.ptyRows > 0
        ? { cols: done.ptyCols, rows: done.ptyRows }
        : undefined,
  });
}

/** Rust `output::Reattached` */
interface ReattachResult {
  start: number;
  replayed: boolean;
  reason: string | null;
  /** 이미 끝난 세션이면 없다 */
  lease?: SessionLease | null;
}

/** Rust `pty::SessionStats` — 진단 전용이다(이 값으로 아무 동작도 바꾸지 않는다) */
export interface SessionStats {
  sent_chunks: number;
  sent_bytes: number;
  send_failures: number;
  last_error: string | null;
}

/** 실패하면 `null` — 진단 한 줄을 못 찍는다고 회복이 막히면 안 된다(docs/log/2026-09-05-silent-session-selfheal.md) */
export async function sessionStats(kind: SessionKind, id: number): Promise<SessionStats | null> {
  try {
    return await invoke<SessionStats>("session_stats", { kind, id });
  } catch {
    return null;
  }
}

/** 창이 닫힐 때 쓴다 — 웹뷰가 통째로 사라져 `SessionHandle.close` 를 부를 자리가 없는 경로가 있다 */
export async function closeSessionById(kind: SessionKind, id: number): Promise<void> {
  // 임대가 없으면(손잡이가 이미 놓였다) 창 파괴 거둠(Rust)이 닫는다.
  const lease = leases.get(leaseKey(kind, id));
  if (!lease) return;
  try {
    await invoke(BACKEND[kind].close, sessionKeyArgs(kind, id, lease));
  } catch {
    /* 이미 끝난 세션 */
  }
}

export async function writeSessionById(kind: SessionKind, id: number, data: string): Promise<void> {
  const lease = leases.get(leaseKey(kind, id));
  if (!lease) throw new Error("no such session");
  await invoke(BACKEND[kind].write, { ...sessionKeyArgs(kind, id, lease), data });
}

/**
 * 부팅의 첫 줄 — 반드시 `await` 한다: 이 호출이 돌아온 뒤에 새 세션이 열려야 방금 연 세션이 정리에 휩쓸리지 않는다
 * (docs/log/2026-09-05-session-leak-on-reload.md).
 */
export async function reapWindowSessions(): Promise<void> {
  try {
    await invoke("reap_window_sessions");
  } catch (e) {
    console.error("[aynx] 이전 페이지가 남긴 세션을 정리하지 못했습니다:", e);
  }
}
