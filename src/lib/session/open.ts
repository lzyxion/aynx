// 세션을 **실제로 여는** 곳(invoke) — 로컬/SSH 열기·재부착·손잡이(`SessionHandle`) 조립·통계·닫기·창 세션 거두기.
// kind 별 백엔드 명령 이름(`BACKEND`)은 여기 한 곳에서만 정의한다.

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

/**
 * kind 별 백엔드 명령 이름을 **여기 한 곳에서만** 정의한다.
 * Terminal.svelte 는 kind 분기 없이 `SessionHandle` 만 쓴다.
 */
interface KindBackend {
  /** invoke(write, { id, data }) */
  write: string;
  /** invoke(resize, { id, cols, rows }) */
  resize: string;
  /** invoke(close, { id }) */
  close: string;
  /** invoke(pause, { id }) — 출력 수문을 닫는다 (역압). 지금은 없다(로컬·SSH 모두 세션 서버 — ACK 크레딧 `ack` 이 대신한다) */
  pause: string | null;
  /** invoke(resume, { id }) — 출력 수문을 연다 */
  resume: string | null;
  /**
   * invoke(ack, { ...lease, consumed }) — 화면에 반영한 출력 오프셋(세션 서버의 ACK 크레딧 — ③-2 로컬 · ③-3b2 SSH).
   * 파이프 너머의 pause/resume 은 순서 없이 늦게 닿을 수 있어 단조 값 하나로 바꿨다(`server::credit`).
   */
  ack: string | null;
  /** 세션 종료 이벤트 이름 (payload === [`SshExitPayload`]). 없으면 null */
  exitEvent: string | null;
}

const BACKEND: Record<SessionKind, KindBackend> = {
  local: {
    write: "write_session",
    resize: "resize_session",
    close: "close_session",
    // 로컬 세션은 세션 서버에 산다(③-2) — 역압은 ACK 크레딧 하나다.
    pause: null,
    resume: null,
    ack: "ack_local_output",
    // 로컬 셸도 끝났을 때 알려 준다 (`local-exit`) — 페이로드 모양은 `ssh-exit` 과 같고
    // `reason` 은 언제나 `"exit"` 다 (자동 재연결을 도는 `"error"` 는 SSH 에만 있다).
    // Rust 는 출력 파이프의 EOF 가 아니라 **자식 프로세스 종료**를 본다: Windows ConPTY 는
    // 의사 콘솔이 닫힐 때까지 파이프를 살려 둘 수 있어 EOF 가 늦거나 오지 않는다
    // (pty.rs 의 `spawn_exit_watch`). 이 이벤트 덕에 `exit` 를 친 로컬 셸도 SSH 와 같은
    // **종료됨 배너**로 넘어간다 (Enter = 새 셸 · Ctrl+D = 타일 닫기).
    exitEvent: "local-exit",
  },
  // SSH 타일도 세션 서버에 산다(③-3b2) — 쓰기·크기·닫기·ACK 는 로컬과 같은 kind 무관 명령이다(서버가 스트림으로 종류를 안다).
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

// ---------------------------------------------------------------------------
// 세션 코어 임대 (docs/internal/session-server-design-2026-10-08.md 4.3 · Rust `session_core`)
// ---------------------------------------------------------------------------

/**
 * **살아 있는 손잡이의 임대** — `kind:id` → 열쇠 셋(로컬·SSH — ②-2). 손잡이 밖에서 세션을 부르는 자리(창 닫기의
 * [`closeSessionById`] · 블록/스니펫/tmux 보내기의 [`writeSessionById`] · 페이지가 떠날 때의 [`detachSession`])가
 * 손잡이와 **같은 열쇠**를 싣게 한다. 손잡이가 닫히거나 놓이면(close·detach·종료) 지운다. 열쇠에 종류가 붙는
 * 이유: 로컬과 SSH 의 백엔드 id 카운터는 따로 돈다(로컬 3번과 SSH 3번이 다른 세션이다).
 */
const leases = new Map<string, SessionLease>();
const leaseKey = (kind: SessionKind, id: number) => `${kind}:${id}`;

/** 이 세션의 지금 임대 (없으면 이 창이 쥔 손잡이가 없다) */
export function leaseOf(kind: SessionKind, id: number): SessionLease | null {
  return leases.get(leaseKey(kind, id)) ?? null;
}

/**
 * be 호출의 세션 열쇠 — **순수 함수**. 임대 셋(`stream`·`sessionEpoch`·`leaseEpoch` — Rust 세션 코어가 검사)을 싣는다
 * (로컬·SSH 모두 — ②-2). 임대가 없으면 `id` 만 간다(Rust 가 거부한다 — 일어나면 안 되는 길이라 조용히 실패).
 */
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

function openArgs(opts: OpenOptions) {
  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = opts.onData;
  return { onData, cols: opts.cols, rows: opts.rows };
}

/**
 * SSH 세션을 연다. 백엔드가 "끊고 재시도" 를 요구하는 관문들(호스트 키 · 키 암호구 · 비밀번호)은
 * [`runSshGates`](`./ssh-gates`)가 대신 돌린다 — 쿼리 타일의 SSH 경유 `db_open` 도 같은 고리를 쓴다.
 * 고리의 규칙(호스트 키는 한 번 · 암호구는 키 파일마다 · 비밀번호 3회 · 값은 그 시도 한 번)은 그 파일 머리말에 있다.
 */
/**
 * `open_ssh_session` 의 성공 반환 (Rust `SshOpenResult`) — `open_local_session` 의
 * `{ id, shell }` 과 같은 모양이다. `tmux` 는 tmux 호스트에서만 채워진다
 * ([`PaneSpec.tmux`] · docs/log/2026-09-16-tmux-toggle.md).
 */
export interface SshOpened {
  id: number;
  tmux: string | null;
  /** 세션 코어 임대 — 이 뒤의 모든 be 호출에 실린다(②-2) */
  lease: SessionLease;
}

/**
 * `tmuxName` 은 **재접속 힌트**다 — 이 타일이 직전에 붙어 있던 tmux 세션 이름
 * ([`PaneSpec.tmux`]). 백엔드는 있으면 그 이름으로 `-A -D`, 없으면 비어 있는 다음 번호로
 * `-A` 를 쓴다. tmux 호스트가 아니면 무시된다.
 */
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
  // 이 타일의 스트림 열쇠(`historyStreamId ?? id`) — 세션 코어의 예약·회차·임대가 이 값이다(모든 타일이 싣는다).
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
      // 빠른 접속 타일만 값이 있다 — 있으면 백엔드가 `~/.ssh/config` 를 보지 않는다.
      adhoc: adhoc ?? null,
      // 원격 프로젝트 타일의 첫 접속에만 값이 있다 (재연결은 `null` — 1회용).
      start: opts.start ?? null,
      noTmux: noTmux ?? false,
      forceTmux: forceTmux ?? false,
      // 에이전트 신호(신호 전용 토큰 · `-R` · 신호 파일)를 세울지는 싣지 않는다 — 세션 서버가 이 스트림 · 시작 명령 ·
      // 호스트의 에이전트 활성화로 정한다(Rust `ssh::open::signal_stream` 한 곳 — 2026-10-27).
      streamId: streamId ?? null,
      ...openArgs(opts),
    }),
  );
}

/** Rust `pty::LocalSession` — 새 세션 id · 해석된 셸 id · 세션 코어 임대 */
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
    // shell 이 없으면 null — Rust 의 Option<String> 이 기본 동작(pwsh → powershell)을 탄다.
    // injectMcpToken 은 AI 타일만 true(AI 타일 표식). MCP 토큰은 Rust 가 AI 타일과 감싸개가 있는 로컬 셸 타일(PowerShell · Git Bash ·
    // 셸 통합 켬 — 2026-10-26 `agent_tile.rs`)에 심는다 — 그 판정은 프런트가 하지 않는다.
    // cwd 도 없으면 null — Rust 가 홈에서 띄운다 (`spawn_cwd`; 없는 폴더도 조용히 홈이다).
    // 반환은 `{ id, shell }` — shell 은 **해석된** 셸 id 라 헤더가 진짜 이름을 띄운다.
    return await invoke<LocalOpened>("open_local_session", {
      shell: shell ?? null,
      injectMcpToken: injectMcpToken ?? false,
      cwd: cwd ?? null,
      // AI 타일이면 Rust 가 이 값을 `AYNX_STREAM` 으로 심는다 — Claude Code 훅 신호가 이 타일을
      // 가리키는 이름이다(docs/log/2026-09-24-agent-hook-signals.md). AI 타일이 아니면 무시된다.
      streamId: streamId ?? null,
      // Codex 전용으로 여는 AI 타일이면 Rust 가 그 타일 셸의 PATH 를 거른다(스토어 pwsh 를 빼 Codex 샌드박스가 셸을 띄우게 —
      // `codex_launch` 머리말 · 2026-10-15). 셸 줄로 바꾸지 않는다.
      codexTile: codexTile ?? false,
      ...openArgs(opts),
    });
  } catch (e) {
    throw new SessionOpenError(parseSessionError(e, koTr));
  }
}

/** id 를 모르는 동안 모아 두는 종료 이벤트의 상한 — 다른 창·타일의 종료도 섞이므로(전역 방송) 가둔다. */
const EARLY_EXIT_CAP = 32;

/**
 * 종료 이벤트 구독 하나 — **열기 invoke 전에** 건다([`openSession`]).
 *
 * 즉시 끝나는 셸(잘못된 셸 경로, 곧바로 `exit` 하는 rc 등)은 `open_*` 가 돌아오기 전에 종료 이벤트를
 * 쏜다. 예전처럼 id 를 받은 뒤에 `listen` 하면 그 이벤트가 이미 지나가 '종료됨' 표시 없는 죽은 타일로
 * 남았다. 그래서 먼저 구독하고, id 를 모르는 동안 온 이벤트는 작은 버퍼에 모았다가 [`bind`] 에서
 * 같은 id 가 있으면 넘긴다. 이 뒤로는 예전처럼 id 로 거른다(이벤트는 모든 창에 방송된다 — 재연결로
 * 같은 패널이 여러 세션을 거치므로 죽은 세션의 늦은 이벤트가 새 손잡이를 건드리면 안 된다).
 *
 * 버퍼에서 찾은 종료는 **다음 매크로태스크**에 넘긴다 — `openSession` 이 부른 쪽에 손잡이를 건넨
 * 뒤여야 한다(`Terminal` 의 `handleExit` 는 자기가 쥔 손잡이를 닫는다 — 쥐기 전이면 닫을 것이 없다).
 */
interface ExitWatch {
  /** 구독이 섰다 — 이 뒤에 열어야 첫 이벤트를 놓치지 않는다 */
  ready: Promise<void>;
  /** 이 구독이 받을 세션 id 와 받는 손을 정한다 (한 번) */
  bind(id: number, deliver: (payload: SshExitPayload) => void): void;
  /** 구독 해제 (멱등) */
  stop(): Promise<void>;
}

function watchExit(kind: SessionKind): ExitWatch | null {
  const event = BACKEND[kind].exitEvent;
  if (!event) return null;
  let bound: { id: number; deliver: (payload: SshExitPayload) => void } | null = null;
  let early: SshExitPayload[] = [];
  // listen 자체가 실패해도(이벤트 미지원 등) 세션은 그대로 쓴다.
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

/** 열기 invoke 를 종료 구독 **뒤에** 부른다 — 열기가 실패하면 구독을 푼다. */
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
  // 로컬 새 열림에서만 넘어온다 — 그 외에는 `undefined` 라 헤더가 폴백을 쓴다.
  resolvedShell?: string,
  // tmux 호스트의 SSH 새 열림에서만 넘어온다 (`resolvedShell` 과 같은 자리).
  tmuxName?: string,
  // 새 열림은 열기 **전에** 건 구독을 넘긴다([`openWatched`]). 없으면(재부착) 여기서 건다.
  early?: ExitWatch | null,
  // 세션 코어 임대(로컬·SSH). 모든 be 호출에 실린다([`sessionKeyArgs`]).
  lease?: SessionLease,
  // 붙기(attach)에서만 — Rust 가 이미 이 크기로 맞춰 두었다. 같은 크기를 다시 보내지 않게 "보낸 크기" 로 둔다
  // (ConPTY 는 같은 크기 resize 에도 화면을 다시 그려 이어진 출력 뒤에 줄을 한 벌 더 얹는다).
  initialSize?: { cols: number; rows: number },
  // **시청자 손잡이**(원격 웹 R2-B — [`attachSessionViewer`]). 있으면 이 손잡이는 임대 표(`leases`)에 오르지 않고(창의 닫기 · 떠나기 ·
  // 체크포인트가 시청자 열쇠로 나가지 않게) 닫기 · 놓기가 **시청 끝**(`detach_session_viewer`)이다 — 세션은 닫지 않는다.
  viewer?: ViewerHooks,
): SessionHandle {
  const be = BACKEND[kind];
  const key = sessionKeyArgs(kind, id, lease);
  if (lease && !viewer) leases.set(leaseKey(kind, id), lease);
  let dead = false;
  /** 이 세션에 마지막으로 알린 크기 (아래 `resize`). 핸들이 세션마다 새로 나므로 재연결은 늘 새로 보낸다. */
  let sentCols = initialSize?.cols ?? -1;
  let sentRows = initialSize?.rows ?? -1;
  /** 이 손잡이가 놓였다 — 임대 표에서 뺀다(같은 id 에 새 손잡이가 섰으면 그쪽 것은 건드리지 않는다). */
  const forget = () => {
    if (lease && leases.get(leaseKey(kind, id)) === lease) leases.delete(leaseKey(kind, id));
  };

  // ── 입력 레인 ──
  // invoke 는 호출 순서대로 Rust 에서 실행된다는 보장이 없다 (async 명령 = 호출마다 런타임 태스크,
  // docs/log/2026-09-05-async-commands.md) — 그대로 쏘면 빠른 키 입력 둘이 셸에서 뒤바뀔 수 있다.
  // 그래서 핸들마다 **한 번에 하나만** 날리고, 그동안 들어온 입력은 `pendingInput` 에 이어 붙였다가
  // 끝나면(성공·실패 무관) 한 덩어리로 보낸다. 지연은 invoke 한 번을 넘지 않고, 폭주 때는 덩어리가 커진다.
  /** 날아가는 중인 쓰기 — 없으면 null */
  let writing: Promise<void> | null = null;
  let pendingInput = "";
  /** 모인 입력의 출처 — 하나라도 사람 것이면 사람(`mergeSource`). 서버가 오케스트레이션 작업자의 개입 잠금에 쓴다 */
  let pendingSource: InputSource | null = null;
  /** `detach` 가 시작됐다 — 새 입력은 받지 않고 남은 것만 비운다 */
  let draining = false;

  // ── 크기 레인 ── (입력과 상대 순서는 맞추지 않는다: 셸은 크기와 바이트를 따로 받고, 둘 사이
  // 순서에 기대는 입력은 없다.) 날아가는 중이면 **가장 최근 요청만** 남겼다가 끝나면 보낸다.
  let resizing = false;
  let wantCols = -1;
  let wantRows = -1;

  // 종료 이벤트 구독 — 손잡이마다 따로 있고 close·detach 에서 푼다([`watchExit`]).
  const watch = early ?? (onExit ? watchExit(kind) : null);
  if (onExit) {
    watch?.bind(id, (payload) => {
      if (dead) return;
      dead = true;
      onExit(parseExitReason(payload));
    });
  }

  // 시청자: 서버가 이 시청을 끝냈다(`session-viewer-ended` — 예산 초과 · 세션 끝 · 창 · 연결). 제 열쇠의 것만.
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
  /** 시청 끝을 서버에 — 이미 떨어졌으면(예산 초과 · 세션 끝) 서버가 `false` 로 답한다(멱등). */
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
    // **같은 크기는 다시 보내지 않는다** (docs/log/2026-09-26-osc-notify-inline-images.md ③).
    // 타일의 refit 은 탭이 보일 때마다 돌고 크기가 그대로여도 여기까지 온다. 그런데 Windows
    // ConPTY 는 크기가 같아도 `ResizePseudoConsole` 마다 **화면 전체를 자기 버퍼로 다시
    // 그린다** — 그 버퍼에는 xterm 이 혼자 그린 것(인라인 그림과 그 자리 줄)이 없어서, 탭을
    // 한 번 다녀오면 그림이 줄째 지워졌다. SSH 쪽은 같은 크기면 원래 아무 일도 없어 잃는 게 없다.
    // "같은 크기" 의 기준은 **성공한** 크기다 — 실패한 크기는 다음 refit 이 다시 보낸다.
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
        // 서버가 이 크기를 걸었다 — 같은 크기를 resize 로 다시 보내지 않는다(ConPTY 는 같은 크기에도 다시 그린다).
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
      pendingInput = ""; // 닫는 세션에 남은 입력은 버린다
      await drop();
      // 시청자의 닫기는 시청 끝이다 — 세션을 닫는 것은 주의 일(시청자 열쇠의 `close` 는 서버가 거절한다).
      if (viewer) return leaveViewer();
      try {
        // 끝난 세션의 닫기도 같은 열쇠로 간다 — Rust 는 "이미 닫힘" 에 멱등이다(종료 마감 뒤에 와도 된다).
        await invoke(be.close, key);
      } catch {
        /* 이미 끝난 세션이면 실패해도 상관없다 */
      } finally {
        forget();
      }
    },
    // 남은 입력을 **먼저 비운다** — 창 이관 직전에 친 글자가 사라지지 않게 (세션 id 는 그대로라
    // 백엔드 쓰기는 창과 무관하게 닿는다). 종료 이벤트로 그 사이 죽으면 펌프가 알아서 멈춘다.
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
        () => {}, // 이미 끝난 세션 등 — 예전처럼 삼킨다
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
          // 실패한 요청은 잊는다 — 그대로 두면 곧바로 같은 크기를 무한히 다시 쏜다.
          // 그 사이 새 크기가 왔으면 그것은 남긴다.
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

  /** 구독 해제 — `close` 와 `detach` 가 공유하는 부분 (차이는 close invoke 뿐이다) */
  async function drop() {
    await watch?.stop();
    if (viewerEnded) {
      try {
        (await viewerEnded)();
      } catch {
        /* 무시 */
      }
    }
    // detach(이관)는 받는 창이 새 임대를 받는다 — 이 창의 열쇠는 곧 낡으니 표에서 뺀다(close 도 여기를 지난다).
    if (dead) forget();
  }
}

/**
 * 패널 명세대로 세션을 열고 손잡이를 돌려준다.
 * 실패하면 항상 `SessionOpenError` 를 던진다 (호출부는 `describeOpenError` 로 문구화).
 */
export async function openSession(pane: PaneSpec, opts: OpenOptions): Promise<SessionHandle> {
  // 설정·호스트 패널은 세션이 없다 — PaneHost 가 Terminal 을 마운트하지 않으므로 실제로는
  // 여기 오지 않지만, kind 가 넓어졌으니 타입·런타임 모두에서 막는다 (뒤로는 SessionKind).
  if (!hasSession(pane.kind)) {
    throw new SessionOpenError({
      kind: "other",
      message: koTr("pane.error.no_session", { name: paneName(pane, koTr) }),
    });
  }
  if (pane.kind === "ssh") {
    // `pane.tmux` 는 이 타일이 직전에 붙어 있던 tmux 세션 이름이다 — 재접속이면 그 자리로
    // 돌아가고(`-A -D`), 새 타일이면 값이 없어 백엔드가 비어 있는 번호를 고른다.
    // 종료 구독을 **먼저** 건다 — 접속 직후 끊기는 세션의 `ssh-exit` 도 받는다([`watchExit`]).
    const { opened, watch } = await openWatched(pane.kind, opts.onExit, () =>
      openSshInteractive(
        pane.alias ?? "",
        opts,
        opts.confirmHostKey,
        opts.promptPassword,
        pane.tmux,
        // 빠른 접속 타일이면 대상이 타일에 실려 있다 — 재연결·복원도 같은 값으로 붙는다.
        pane.adhoc,
        opts.promptPassphrase,
        // 원격 프로젝트가 "tmux 안 씀" 이면 매 접속마다 — 재연결도 같은 모양이어야 한다.
        pane.noTmux,
        // 원격 프로젝트가 "tmux 켬" 이면 호스트 설정과 무관하게 tmux (재연결도 같은 모양).
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
  // 로컬 — 백엔드가 해석한 셸 id 를 손잡이에 실어 준다 (헤더가 진짜 셸 이름을 띄운다).
  // 종료 구독은 **먼저** — 곧바로 끝나는 셸(잘못된 셸 경로 등)의 `local-exit` 도 받는다.
  const {
    opened: { id, shell, lease },
    watch,
  } = await openWatched(pane.kind, opts.onExit, () =>
    openLocal(
      opts,
      pane.shell,
      pane.injectMcpToken,
      pane.cwd,
      sessionStreamOf(pane),
      pane.injectMcpToken === true && isCodexLine(pane.autorun),
    ),
  );
  return makeHandle(pane.kind, id, opts.onExit, shell, undefined, watch, lease);
}

/** 자동 실행 줄이 codex 인가(첫 낱말 `codex` · `codex.exe` · `codex.cmd`, 대소문자 무관 — Rust `codex_launch::is_codex` 와 같은 판정) */
export function isCodexLine(line: string | undefined): boolean {
  const first = (line ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  return first === "codex" || first === "codex.exe" || first === "codex.cmd";
}

/**
 * 타일의 스트림 열쇠(로컬·SSH) — 세션 코어 표 · 체크포인트 · 로컬 `AYNX_STREAM` · 원격 신호 스트림 · MCP 거울이 모두
 * 이 값이다.
 */
export function sessionStreamOf(pane: Pick<PaneSpec, "id" | "historyStreamId">): string {
  return pane.historyStreamId ?? pane.id;
}

/** Rust `session_core::Probe` — 새 페이지의 타일이 "붙을까 열까" 를 고르는 물음의 답 */
export interface SessionProbe {
  state: "none" | "opening" | "attached" | "detached" | "exited" | "disconnected";
  /** 세션 종류 — 타일 종류와 다르면 붙지 않는다(없으면 `null`) */
  kind?: SessionKind | null;
  sessionEpoch: number | null;
  checkpoint: SessionCheckpoint | null;
  /**
   * 로컬 타일의 "AI 읽기 허용" 이 켜져 있던 세션인가(③-4 — 세션 서버의 세션 메타에 산다, `set_session_ai_read`). 다시 붙는
   * 타일이 이 값으로 토글을 되살린다 — 예전에는 창 메모리라 GUI 를 다시 켜면 꺼졌다. 옛 서버에는 없다.
   */
  aiRead?: boolean;
}

/**
 * 로컬 타일의 "AI 읽기 허용" 을 세션 서버의 세션 메타에 남긴다(③-4) — GUI 를 다시 켜도 다시 붙는 타일이 되살린다.
 * 실패는 삼킨다(서버가 아직 안 붙었으면 다음 변화가 다시 보낸다).
 */
export function setSessionAiRead(stream: string, on: boolean): void {
  invoke("set_session_ai_read", { stream, on }).catch(() => {});
}

/** Rust `session_core::Checkpoint` — 창이 맡겨 두는 화면 한 장 */
export interface SessionCheckpoint {
  buffer: string;
  cols: number;
  rows: number;
  /** 그 화면에 반영돼 있던 출력 오프셋(꼬리 링 축) */
  consumed: number;
  sessionEpoch: number;
}

/**
 * 열기가 **같은 스트림의 살아 있는 세션** 때문에 거절됐나(`[session-alive]` · `[session-busy]` — Rust 세션 코어의
 * 스트림별 예약). 닫기가 아직 도착하지 않았거나(언마운트의 fire-and-forget 닫기) 다른 열기가 진행 중일 때다 —
 * 부른 쪽은 잠시 뒤 다시 본다(붙을 수 있으면 붙는다).
 */
export function isLiveSessionConflict(e: unknown): boolean {
  const text =
    e instanceof SessionOpenError && "message" in e.detail
      ? String(e.detail.message)
      : e instanceof Error
        ? e.message
        : String(e);
  return text.includes("[session-alive]") || text.includes("[session-busy]");
}

/** 이 스트림에 살아 있는 세션이 있나(로컬·SSH) · 맡겨 둔 화면이 있나. 명령이 실패하면 `null`(= 새로 연다) */
export async function probeSession(stream: string, kind?: SessionKind): Promise<SessionProbe | null> {
  try {
    // 종류를 실으면 SSH 타일은 세션 서버(로컬)에 묻지 않는다 — 부팅 직후 서버가 붙기 전에 기다리지 않게.
    return await invoke<SessionProbe>("probe_session", { stream, kind: kind ?? null });
  } catch {
    return null;
  }
}

/**
 * **부팅 복원의 붙기 계획** — 순수 함수(시험 대상, 로컬·SSH 공용). 떨어진 세션이면 붙고, 맡겨 둔 화면이 같은 회차면 그
 * 화면을 먼저 그린 뒤 그 화면의 오프셋부터 재생한다(체크포인트 → 링[소비..끝) → 실시간). 화면이 없으면 링 전체(오프셋
 * 0 → Rust 가 남은 링 전부를 보내고, 넘쳤으면 유실 바이트를 센다). 그 밖(없음·여는 중·붙어 있음·끝남·끊김 — SSH 끊김은
 * 재접속 = 새 회차)과 **종류가 다른 세션**(`kind` 를 주면)은 새로 연다.
 */
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
  /** 붙기 전 PTY 크기(로컬만 — 재생분이 쓰인 화면 크기, 10-15) */
  ptyCols?: number | null;
  ptyRows?: number | null;
  /** 해석된 셸 id (헤더 이름) */
  shell: string | null;
  /** 이 쪽이 크기 주인인가(R2-A — 옛 서버는 없다) */
  sizeOwner?: boolean;
}

/**
 * **떨어진 세션에 이 창이 붙는다** (페이지 리로드·웹뷰 크래시 뒤 — Rust `attach_session`, 로컬·SSH 공용).
 *
 * 새 임대를 받고, 채널 첫 메시지로 링의 `[consumed, end)`(넘쳤으면 남은 링 전부)가 오고 그 뒤로 실시간이 온다.
 * 손잡이의 `outputStart`·`replayEnd`·`overrunBytes` 로 터미널이 재생 구간과 유실을 안다. 실패는 `SessionOpenError`
 * (대개 그 사이 세션이 끝났다 → 부른 쪽이 새로 연다). SSH 는 새 접속이 아니다 — 원격 autorun·셸 통합 스니펫·훅
 * 설치를 다시 보내지 않는다.
 */
export async function attachSession(
  pane: PaneSpec,
  opts: OpenOptions,
  // `sized` 가 거짓이면(숨은 탭 — 아직 크기를 잴 수 없다) 크기를 싣지 않는다: Rust 는 PTY 크기를 그대로 두고,
  // 타일이 보일 때 손잡이의 첫 resize 가 맞춘다.
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
  // 종료 구독은 타일 종류의 이벤트로 — Rust 의 답(`done.kind`)은 붙은 뒤에야 오고, 종류가 다른 세션에는 애초에
  // 붙지 않는다(`planAttach`).
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
    // 주는 붙으며 크기 주인이 된다(R2-A) — 옛 서버는 칸이 없다(주인으로 본다).
    sizeOwner: done.sizeOwner !== false,
    replaySize:
      typeof done.ptyCols === "number" && typeof done.ptyRows === "number" && done.ptyCols > 0 && done.ptyRows > 0
        ? { cols: done.ptyCols, rows: done.ptyRows }
        : undefined,
  });
}

/**
 * **이 창이 손을 놓는다** — 세션(로컬·SSH)은 살려 둔 채 임대만 푼다(페이지가 떠나는 `pagehide`). 화면 체크포인트를
 * 함께 맡기면 새 페이지의 타일이 그 화면부터 그린다. fire-and-forget 이다 — 언로드 중이라 닿는다는 보장이
 * 없고(그래도 Rust 의 페이지 로드 그물이 같은 떨어뜨리기를 한다), 체크포인트만 못 갈 수 있다.
 */
export function detachSession(
  kind: SessionKind,
  id: number,
  checkpoint: Omit<SessionCheckpoint, "sessionEpoch"> | null,
  /** 사람이 타일을 닫아 놓는다(10-15) — 서버가 **작업자 스트림만** 떨어진 세션 목록에 곧바로 보이게 표시한다 */
  release = false,
): Promise<void> {
  const lease = leases.get(leaseKey(kind, id));
  if (!lease) return Promise.resolve();
  // 언로드 중(`pagehide`)에는 기다릴 수 없어 버려지지만, 앱 종료(quitAll)는 이 약속이 끝나기를 기다린 뒤 끊는다.
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

/** 붙어 있는 동안 화면을 맡긴다(30초마다·창이 가려질 때). 실패는 삼킨다 — 다음 기회에 다시 맡긴다 */
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

/**
 * **복원이 끝났다** — 이 창이 다시 그린 타일들(로컬·SSH)의 스트림을 알린다. 이 창이 책임지던 떨어진 세션 중 아무 타일도
 * 데려가지 않은 것은 **닫지 않고** "떨어진 세션" 으로 표시만 한다(③-4 — 목록에서 사람이 붙이거나 닫는다 · `app/detached`).
 * 끝난 잔해(창 없이 끝나 닫기를 못 받은 항목)만 Rust 가 닫는다. 서버에 닿지 못하면 `null`.
 */
export async function restoreDoneSessions(keep: readonly string[]): Promise<{ closed: number; unclaimed: number } | null> {
  try {
    return await invoke<{ closed: number; unclaimed: number }>("restore_done_sessions", { keep: [...keep] });
  } catch (e) {
    console.error("[aynx] 복원이 끝났음을 세션 서버에 알리지 못했습니다:", e);
    return null;
  }
}

/**
 * **이미 살아 있는** 세션을 이 창에 다시 붙인다 (창 이관 — docs/log/2026-09-02-tear-out.md).
 *
 * [`openSession`] 과 대칭이다: 저쪽은 세션을 만들고 이쪽은 남의 창이 만들어 둔 세션의
 * 출력 방향만 이리로 돌린다. 세션 id 는 **그대로**이고 (재연결과 다르다) 백엔드에서는
 * 출력 슬롯 교체 + 수문 열기 + resize 가 일어난다 (`reattach_output`).
 *
 * 실패는 언제나 `SessionOpenError` 다 — 대개 "그 사이 세션이 닫혔다" 이며, 호출부는
 * 버퍼만 남은 화면에 안내 한 줄을 찍는다.
 */
export async function reattachSession(
  pane: PaneSpec,
  sessionId: number,
  opts: OpenOptions,
  // 짐을 뜬 순간 소스 화면에 반영돼 있던 출력 오프셋 (`TearPane.consumed`). 있으면 Rust 가 그 뒤
  // 꼬리(이관 틈에 옛 채널로 가 사라진 출력)를 새 채널에 먼저 흘린다. 없으면(옛 짐) 재생 없음.
  consumed?: number,
): Promise<SessionHandle> {
  // 설정·호스트 패널은 붙일 세션이 없다 — 이관돼도 새 창이 새로 그리므로 재부착 경로에
  // 오지 않지만 (restore 없이 옮긴다, `adoptTab` 참고) kind 가 넓어졌으니 방어한다.
  if (!hasSession(pane.kind)) {
    throw new SessionOpenError({
      kind: "other",
      message: koTr("pane.error.no_session", { name: paneName(pane, koTr) }),
    });
  }
  let done: ReattachResult | undefined;
  try {
    // 채널은 이 호출 전용으로 새로 만든다 (openArgs 와 같은 이유 — 재사용 금지).
    done = await invoke<ReattachResult>("reattach_output", {
      kind: pane.kind,
      id: sessionId,
      ...openArgs(opts),
      consumed: consumed ?? null,
    });
  } catch (e) {
    throw new SessionOpenError(parseSessionError(e, koTr));
  }
  // 이 창이 새 임대를 받았다(Rust 가 빼앗기로 옮긴다 — 로컬·SSH) — 이 손잡이의 be 호출은 그 열쇠를 싣는다.
  const handle = makeHandle(pane.kind, sessionId, opts.onExit, undefined, undefined, undefined, done?.lease ?? undefined);
  return typeof done?.start === "number" ? Object.assign(handle, { outputStart: done.start }) : handle;
}

// ---------------------------------------------------------------------------
// 시청자 (원격 웹 R2-A 서버 · R2-B 프런트 — Rust `session_core::viewers`)
// ---------------------------------------------------------------------------

/** 서버 이벤트 — 시청자 하나가 떨어졌다 */
export const VIEWER_ENDED_EVENT = "session-viewer-ended";
/** 서버 이벤트 — 크기 주인이 바뀌었거나 주인이 크기를 바꿨다(`$lib/term/size-owner`) */
export const SIZE_OWNER_EVENT = "session-size-owner";

/** `session-viewer-ended` 몸 — `reason`: `overflow`(다시 붙어 재동기화) · `ended`(세션 끝) · `window` · `conn` · `detached` */
export interface ViewerEndedPayload {
  stream: string;
  sessionEpoch: number;
  leaseEpoch: number;
  id: number;
  kind: SessionKind;
  reason: string;
}

/** 시청자 손잡이의 훅 — 서버가 이 시청을 끝냈다(제 손으로 뗀 것은 오지 않는다) */
interface ViewerHooks {
  onEnded?: (reason: string) => void;
}

/** 이 창이 쥔 시청자 손잡이 — 페이지가 떠날 때 시청을 끝낸다([`leaveViewers`]) */
const liveViewers = new Set<SessionHandle>();

/**
 * **이 창의 시청을 모두 끝낸다**(원격 창의 `pagehide` — fire-and-forget). 안 닿아도 원격 창이 사라지면 GUI 가 그 창의 시청자를 뗀다 —
 * 이것은 떠난 페이지의 시청자가 크기 주인으로 남아 질의가 허공으로 가는 틈을 줄이는 빠른 길이다.
 */
export function leaveViewers(): void {
  for (const h of [...liveViewers]) void h.close();
}

/** Rust `attach_viewer` 답 — [`Attached`] + `viewer` · 크기 주인 · 주인의 크기 */
interface ViewerAttached extends Attached {
  viewer: true;
  ownerCols?: number | null;
  ownerRows?: number | null;
  /** 주인이 주(집 PC 창)인가 — 이벤트의 `primary` 와 같다(옛 서버는 없다) */
  ownerPrimary?: boolean;
}

/**
 * **이 창이 시청자로 붙는다**(원격 창의 터미널 타일 — R2-B). 주 임대를 빼앗지 않고 같은 세션을 함께 본다: 같은 출력 · 입력(출처를 싣는다) ·
 * 크기는 마지막으로 사람이 친 쪽. 닫기 · 놓기는 시청 끝이다(세션은 그대로 — 손잡이 `close`). 서버가 시청을 끝내면(`onViewerEnded`)
 * 예산 초과면 같은 `consumed` 로 다시 붙어 재동기화하고, 세션 끝이면 끝 화면이다(부르는 쪽 — `Terminal`).
 *
 * `plan.sessionEpoch` 가 있으면 그 회차에만(재동기화가 새 회차에 이어 붙지 않게), `consumed` 부터 재생한다(처음이면 체크포인트의 것 · 없으면
 * 0 = 링 전부). 실패는 `SessionOpenError`(대개 아직 열린 세션이 없다).
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

/** Rust `output::Reattached` — 재부착 결과 */
interface ReattachResult {
  /** 새 채널의 첫 바이트 오프셋 (재생했으면 `consumed`, 아니면 교체 순간의 끝) */
  start: number;
  /** 이관 틈의 꼬리를 재생했는가 */
  replayed: boolean;
  /** 재생하지 않은 이유 (진단) */
  reason: string | null;
  /** 이 창이 받은 새 임대(로컬·SSH — 이미 끝난 세션이면 없다) */
  lease?: SessionLease | null;
}

/**
 * Rust 가 이 세션에 대해 **웹뷰로 내보낸 양** (Rust `pty::SessionStats`).
 * 진단 전용이다 — 이 값으로 아무 동작도 바꾸지 않고 콘솔 한 줄만 찍는다.
 */
export interface SessionStats {
  /** 배처가 채널로 내보낸 배치 수 (실패한 것도 시도로 센다) */
  sent_chunks: number;
  /** 그 배치들의 총 바이트 */
  sent_bytes: number;
  /** `Channel::send` 가 오류를 낸 횟수 — 0 이 아니면 그 세션은 이미 침묵이다 */
  send_failures: number;
  /** 마지막 전송 실패의 사유 */
  last_error: string | null;
}

/**
 * 세션의 출력 계수기를 읽는다 (docs/log/2026-09-05-silent-session-selfheal.md).
 *
 * "타일이 검다" 의 원인 둘을 가르는 유일한 값이다 — **Rust 가 안 보냈나**
 * (`sent_chunks === 0`) vs **보냈는데 JS 가 못 받았나**(`sent_chunks > 0` 인데 프런트의
 * 받은 수가 0). 명령이 없거나 세션이 이미 닫혔으면 `null` 을 돌려준다: 진단 한 줄을
 * 못 찍는다고 회복 자체가 막히면 안 된다.
 */
export async function sessionStats(kind: SessionKind, id: number): Promise<SessionStats | null> {
  try {
    return await invoke<SessionStats>("session_stats", { kind, id });
  } catch {
    return null;
  }
}

/**
 * 손잡이 없이 세션 하나를 끝낸다 (id 와 종류만으로).
 *
 * 창이 닫힐 때 쓴다 — 그 순간 컴포넌트 정리가 돌지 않는 경로가 있어서(웹뷰가 통째로
 * 사라진다) `SessionHandle.close` 를 부를 자리가 없다. 세션은 Rust **전역**이라 창이
 * 없어져도 살아남으므로, 아무도 안 치우면 셸 프로세스가 그대로 남는다.
 * 실패는 무시한다 (이미 끝난 세션이면 실패가 정상이다).
 */
export async function closeSessionById(kind: SessionKind, id: number): Promise<void> {
  // 이 창이 쥔 임대로만 닫는다 — 임대가 없으면(손잡이가 이미 놓였다) 창 파괴 거둠(Rust)이 닫는다.
  const lease = leases.get(leaseKey(kind, id));
  if (!lease) return;
  try {
    await invoke(BACKEND[kind].close, sessionKeyArgs(kind, id, lease));
  } catch {
    /* 이미 끝난 세션 */
  }
}

/**
 * 손잡이 밖에서 세션에 글자를 보낸다(블록 다시 실행·스니펫 보내기·tmux 세션 바꾸기). 이 창의 임대를 싣는다 — 없으면
 * 연결되지 않은 것으로 던진다. 실패는 그대로 던진다(부른 쪽이 안내를 띄운다).
 */
export async function writeSessionById(kind: SessionKind, id: number, data: string): Promise<void> {
  const lease = leases.get(leaseKey(kind, id));
  if (!lease) throw new Error("no such session");
  await invoke(BACKEND[kind].write, { ...sessionKeyArgs(kind, id, lease), data });
}

/**
 * **이 창이 예전 페이지에서 남긴 세션을 백엔드에 거둬 달라고 한다** — 부팅의 첫 줄이다
 * (docs/log/2026-09-05-session-leak-on-reload.md · Rust `reap.rs`).
 *
 * 페이지가 통째로 다시 로드되면(F5·Ctrl+R·개발 서버의 전체 리로드) 프런트의 정리 경로가
 * **하나도 돌지 않는다**: 문서가 사라지므로 `Terminal` 의 언마운트도, 창 닫힘 훅도 없다.
 * 그런데 새로 뜬 페이지는 타일을 전부 다시 마운트해 [`openSession`] 을 새로 부르므로,
 * 리로드 한 번마다 셸 프로세스와 SSH 연결이 한 벌씩 쌓였다 (실측: pwsh 24개).
 *
 * 백엔드는 세션마다 **소유 창 라벨**을 적어 두고 이 창의 것만 거둔다 — 다른 창의 탭도,
 * 지금 이관 중인 세션도 건드리지 않는다. **반드시 `await` 해야 한다**: 이 호출이 돌아온
 * 뒤에야 타일이 뜨고 새 세션이 열려야, 방금 연 세션이 정리에 휩쓸리지 않는다.
 *
 * 실패는 삼킨다 — 정리를 못 했다고 앱이 뜨지 않을 이유가 없다 (백엔드의 페이지 로드 그물이
 * 같은 일을 한 번 더 한다).
 */
export async function reapWindowSessions(): Promise<void> {
  try {
    await invoke("reap_window_sessions");
  } catch (e) {
    console.error("[aynx] 이전 페이지가 남긴 세션을 정리하지 못했습니다:", e);
  }
}
