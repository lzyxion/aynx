import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachSession,
  closeSessionById,
  detachSession,
  isLiveSessionConflict,
  leaseOf,
  openSession,
  planAttach,
  sessionKeyArgs,
  writeSessionById,
  type SessionProbe,
} from "./open";
import { SessionOpenError } from "./errors";
import type { PaneSpec } from "./spec";

// 세션 코어 ② — 프런트 몫: 손잡이가 임대 열쇠를 모든 be 호출에 싣는가 · pagehide 의 detach · 부팅 복원의 붙기 계획
// (②-1 로컬 · ②-2 SSH).
// (docs/internal/session-server-design-2026-10-08.md 4.3)

interface Sent {
  cmd: string;
  args: Record<string, unknown>;
}
let sent: Sent[] = [];
let order: string[] = [];

const LEASE = { stream: "h-1", sessionEpoch: 3, leaseEpoch: 2 };
const pane = { id: "p1", kind: "local", historyStreamId: "h-1" } as PaneSpec;
const SSH_LEASE = { stream: "r-1", sessionEpoch: 2, leaseEpoch: 1 };
const sshPane = { id: "p2", kind: "ssh", alias: "dev-01", historyStreamId: "r-1" } as PaneSpec;

beforeEach(() => {
  sent = [];
  order = [];
  vi.mocked(listen).mockImplementation((async (event: string) => {
    order.push(`listen:${event}`);
    return () => {};
  }) as unknown as typeof listen);
  vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
    sent.push({ cmd, args: args ?? {} });
    order.push(cmd);
    if (cmd === "open_local_session") return Promise.resolve({ id: 11, shell: "pwsh", lease: LEASE });
    if (cmd === "open_ssh_session") return Promise.resolve({ id: 11, tmux: null, lease: SSH_LEASE });
    if (cmd === "attach_session" && args?.stream === "r-1")
      return Promise.resolve({
        id: 21,
        kind: "ssh",
        lease: { ...SSH_LEASE, leaseEpoch: 4 },
        start: 500,
        end: 900,
        replayed: false,
        overrunBytes: 1200,
        shell: null,
      });
    if (cmd === "attach_session")
      return Promise.resolve({
        id: 12,
        kind: "local",
        lease: { ...LEASE, leaseEpoch: 5 },
        start: 100,
        end: 160,
        replayed: true,
        overrunBytes: 0,
        shell: "pwsh",
      });
    return Promise.resolve(undefined);
  }) as typeof invoke);
});

const flush = () => new Promise((r) => setTimeout(r, 0));
const args = (cmd: string) => sent.filter((s) => s.cmd === cmd).map((s) => s.args);

describe("임대 열쇠 — 손잡이가 모든 be 호출에 싣는다", () => {
  it("열기 결과의 임대가 write·resize·ack·close 에 실린다 (id 가 아니라) — 로컬은 pause/resume 대신 ACK(③-2)", async () => {
    const s = await openSession(pane, { onData: () => {}, cols: 80, rows: 24 });
    expect(args("open_local_session")[0]).toMatchObject({ streamId: "h-1" });
    expect(s.lease).toEqual(LEASE);
    expect(leaseOf("local", 11)).toEqual(LEASE);
    s.write("ls\r");
    s.resize(100, 30);
    s.pause();
    s.resume();
    s.ack?.(65536);
    await flush();
    const key = { stream: "h-1", sessionEpoch: 3, leaseEpoch: 2 };
    expect(args("write_session")[0]).toEqual({ ...key, data: "ls\r", source: "keyboard" });
    expect(args("resize_session")[0]).toEqual({ ...key, cols: 100, rows: 30 });
    // 로컬 세션은 세션 서버에 산다 — 역압은 소비 오프셋 하나(ACK 크레딧), pause/resume 은 보내지 않는다.
    expect(args("pause_local_output")).toEqual([]);
    expect(args("resume_local_output")).toEqual([]);
    expect(args("ack_local_output")[0]).toEqual({ ...key, consumed: 65536 });
    await s.close();
    expect(args("close_session")[0]).toEqual(key);
    expect(leaseOf("local", 11)).toBeNull();
  });

  it("sessionKeyArgs — 로컬·SSH 모두 임대 셋(②-2), 임대가 없으면 id", () => {
    expect(sessionKeyArgs("local", 4, LEASE)).toEqual(LEASE);
    expect(sessionKeyArgs("ssh", 4, SSH_LEASE)).toEqual(SSH_LEASE);
    expect(sessionKeyArgs("local", 4, null)).toEqual({ id: 4 });
  });

  it("SSH 열기 — 스트림을 싣고, 결과의 임대가 write·resize·ack·close 에 실린다(③-3b2 — 로컬과 같은 명령)", async () => {
    const s = await openSession(sshPane, { onData: () => {}, cols: 80, rows: 24 });
    expect(args("open_ssh_session")[0]).toMatchObject({ alias: "dev-01", streamId: "r-1" });
    expect(s.lease).toEqual(SSH_LEASE);
    expect(leaseOf("ssh", 11)).toEqual(SSH_LEASE);
    // 로컬 11 번과 SSH 11 번은 다른 세션이다 — 임대 표가 섞이지 않는다.
    expect(leaseOf("local", 11)).toBeNull();
    s.write("uptime\r");
    s.resize(100, 30);
    s.pause();
    s.resume();
    s.ack?.(4096);
    await flush();
    expect(args("write_session")[0]).toEqual({ ...SSH_LEASE, data: "uptime\r", source: "keyboard" });
    expect(args("resize_session")[0]).toEqual({ ...SSH_LEASE, cols: 100, rows: 30 });
    // pause/resume 은 없다 — 역압은 ACK 크레딧 하나(세션 서버).
    expect(args("pause_ssh_output")).toEqual([]);
    expect(args("ack_local_output")[0]).toEqual({ ...SSH_LEASE, consumed: 4096 });
    await writeSessionById("ssh", 11, "tmux\r");
    expect(args("write_session")[1]).toEqual({ ...SSH_LEASE, data: "tmux\r" });
    await s.close();
    expect(args("close_session")[0]).toEqual(SSH_LEASE);
    expect(leaseOf("ssh", 11)).toBeNull();
  });

  it("손잡이 밖의 닫기·쓰기도 이 창의 임대로 — 임대가 없으면 로컬은 부르지 않는다", async () => {
    const s = await openSession(pane, { onData: () => {}, cols: 80, rows: 24 });
    await writeSessionById("local", s.id, "echo hi\r");
    expect(args("write_session")[0]).toEqual({ ...LEASE, data: "echo hi\r" });
    await closeSessionById("local", s.id);
    expect(args("close_session")[0]).toEqual(LEASE);
    sent = [];
    await closeSessionById("local", 999);
    expect(sent).toEqual([]);
    await expect(writeSessionById("local", 999, "x")).rejects.toBeTruthy();
    // SSH 도 임대가 없으면 부르지 않는다(창 파괴 거둠이 닫는다).
    await closeSessionById("ssh", 7);
    expect(args("close_session")).toEqual([]);
    await expect(writeSessionById("ssh", 7, "x")).rejects.toBeTruthy();
  });
});

describe("pagehide — 닫지 않고 손을 놓는다", () => {
  it("detach 에 임대와 체크포인트(같은 회차)를 싣는다", async () => {
    const s = await openSession(pane, { onData: () => {}, cols: 80, rows: 24 });
    detachSession("local", s.id, { buffer: "screen", cols: 80, rows: 24, consumed: 42 });
    expect(args("detach_session")[0]).toEqual({
      ...LEASE,
      checkpoint: { buffer: "screen", cols: 80, rows: 24, consumed: 42, sessionEpoch: 3 },
      release: false,
    });
    expect(args("close_session")).toEqual([]);
    detachSession("local", s.id, null);
    expect(args("detach_session")[1]).toMatchObject({ checkpoint: null, release: false });
    // 사람이 작업자 타일을 닫아 놓는다(10-15) — `release` 를 싣는다(서버가 작업자 스트림만 표시).
    detachSession("local", s.id, null, true);
    expect(args("detach_session")[2]).toMatchObject({ checkpoint: null, release: true });
  });

  it("SSH 도 같다(②-2) — SSH 임대로 detach 하고 닫지 않는다", async () => {
    const s = await openSession(sshPane, { onData: () => {}, cols: 80, rows: 24 });
    detachSession("ssh", s.id, { buffer: "remote", cols: 80, rows: 24, consumed: 9 });
    expect(args("detach_session")[0]).toEqual({
      ...SSH_LEASE,
      checkpoint: { buffer: "remote", cols: 80, rows: 24, consumed: 9, sessionEpoch: 2 },
      release: false,
    });
    expect(args("close_session")).toEqual([]);
    // 이 창이 쥐지 않은 손잡이는 놓을 것도 없다.
    sent = [];
    detachSession("ssh", 404, null);
    expect(sent).toEqual([]);
  });
});

describe("부팅 복원 — 붙기 계획", () => {
  const probe = (p: Partial<SessionProbe>): SessionProbe => ({
    state: "detached",
    sessionEpoch: 3,
    checkpoint: null,
    ...p,
  });
  const cp = (sessionEpoch: number) => ({ buffer: "b", cols: 80, rows: 24, consumed: 77, sessionEpoch });

  it("떨어진 세션 + 같은 회차의 화면 → 그 화면의 오프셋부터", () => {
    expect(planAttach(probe({ checkpoint: cp(3) }))).toEqual({
      mode: "attach",
      sessionEpoch: 3,
      checkpoint: cp(3),
      consumed: 77,
      aiRead: false,
    });
  });

  it("세션 메타의 AI 읽기 허용을 실어 준다(③-4 — 다시 붙는 로컬 타일이 토글을 되살린다)", () => {
    expect(planAttach(probe({ aiRead: true }))).toMatchObject({ mode: "attach", aiRead: true });
    expect(planAttach(probe({}))).toMatchObject({ aiRead: false });
  });

  it("화면이 없거나 다른 회차면 링 전체(오프셋 0)", () => {
    expect(planAttach(probe({}))).toMatchObject({ mode: "attach", checkpoint: null, consumed: 0 });
    expect(planAttach(probe({ checkpoint: cp(2) }))).toMatchObject({ checkpoint: null, consumed: 0 });
  });

  it("없음·여는 중·붙어 있음·끝남·끊김·물음 실패면 새로 연다", () => {
    for (const state of ["none", "opening", "attached", "exited", "disconnected"] as const) {
      expect(planAttach(probe({ state }))).toEqual({ mode: "open" });
    }
    expect(planAttach(null)).toEqual({ mode: "open" });
  });

  it("종류가 다른 세션에는 붙지 않는다(SSH 타일 ↔ 로컬 세션)", () => {
    expect(planAttach(probe({ kind: "local" }), "ssh")).toEqual({ mode: "open" });
    expect(planAttach(probe({ kind: "ssh" }), "ssh")).toMatchObject({ mode: "attach" });
    expect(planAttach(probe({ kind: null }), "ssh")).toMatchObject({ mode: "attach" });
  });

  it("붙기: 종료 구독이 먼저, 결과의 시작·재생 끝·임대가 손잡이에, 같은 크기는 다시 보내지 않는다", async () => {
    const s = await attachSession(
      pane,
      { onData: () => {}, cols: 120, rows: 40, onExit: vi.fn() },
      { sessionEpoch: 3, consumed: 77, sized: true },
    );
    expect(order.slice(0, 2)).toEqual(["listen:local-exit", "attach_session"]);
    expect(args("attach_session")[0]).toMatchObject({
      stream: "h-1",
      expectedSessionEpoch: 3,
      consumed: 77,
      take: false,
      cols: 120,
      rows: 40,
    });
    expect(s.outputStart).toBe(100);
    expect(s.replayEnd).toBe(160);
    expect(s.overrunBytes).toBe(0);
    expect(s.lease).toEqual({ ...LEASE, leaseEpoch: 5 });
    expect(s.resolvedShell).toBe("pwsh");
    s.resize(120, 40);
    expect(args("resize_session")).toEqual([]);
    s.resize(121, 40);
    expect(args("resize_session")[0]).toEqual({ ...LEASE, leaseEpoch: 5, cols: 121, rows: 40 });
  });

  it("숨은 탭(크기를 못 잼)은 크기를 싣지 않고, 첫 resize 를 보낸다", async () => {
    const s = await attachSession(
      pane,
      { onData: () => {}, cols: 80, rows: 24 },
      { sessionEpoch: 3, consumed: 0, sized: false },
    );
    expect(args("attach_session")[0]).toMatchObject({ cols: null, rows: null });
    s.resize(80, 24);
    expect(args("resize_session")).toHaveLength(1);
  });

  it("SSH 붙기 — ssh-exit 구독이 먼저, 새 임대·재생 구간·유실이 손잡이에, be 호출은 SSH 명령으로", async () => {
    const onExit = vi.fn();
    const s = await attachSession(
      sshPane,
      { onData: () => {}, cols: 120, rows: 40, onExit },
      { sessionEpoch: 2, consumed: 300, sized: true },
    );
    expect(order.slice(0, 2)).toEqual(["listen:ssh-exit", "attach_session"]);
    expect(args("attach_session")[0]).toMatchObject({ stream: "r-1", expectedSessionEpoch: 2, consumed: 300 });
    expect(args("open_ssh_session")).toEqual([]);
    expect(s.kind).toBe("ssh");
    expect(s.lease).toEqual({ ...SSH_LEASE, leaseEpoch: 4 });
    expect([s.outputStart, s.replayEnd, s.overrunBytes]).toEqual([500, 900, 1200]);
    s.write("x");
    await flush();
    expect(args("write_session")[0]).toEqual({ ...SSH_LEASE, leaseEpoch: 4, data: "x", source: "keyboard" });
    expect(leaseOf("ssh", 21)).toEqual({ ...SSH_LEASE, leaseEpoch: 4 });
  });

  it("살아 있는 같은 스트림의 거절은 다시 볼 거리다", () => {
    const err = (message: string) => new SessionOpenError({ kind: "other", message });
    expect(isLiveSessionConflict(err("[session-alive] 아직 살아 있습니다"))).toBe(true);
    expect(isLiveSessionConflict(err("[session-busy] 여는 중"))).toBe(true);
    expect(isLiveSessionConflict(err("셸을 찾을 수 없습니다"))).toBe(false);
    expect(isLiveSessionConflict(null)).toBe(false);
  });
});

describe("로컬 종료 사유는 코드다 (세션 서버 ③-2 — 문구는 프런트 i18n)", () => {
  it("exit + exitCode · server-stopped · wait-failed(detail) · 코드 없는 SSH 는 message 그대로", async () => {
    const { parseExitReason } = await import("./contract");
    expect(parseExitReason({ id: 1, reason: "exit", code: "exit", exitCode: 3 })).toEqual({
      kind: "exit",
      message: null,
      code: "exit",
      exitCode: 3,
    });
    expect(parseExitReason({ id: 1, reason: "exit", code: "server-stopped" })).toMatchObject({ code: "server-stopped" });
    expect(parseExitReason({ id: 1, reason: "exit", code: "wait-failed", detail: "os error 6" })).toMatchObject({
      code: "wait-failed",
      message: "os error 6",
    });
    expect(parseExitReason({ id: 1, reason: "error", message: "연결이 끊겼습니다" })).toEqual({
      kind: "error",
      message: "연결이 끊겼습니다",
    });
  });
});
