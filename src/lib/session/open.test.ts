import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { openSession, reattachSession } from "./open";
import type { PaneSpec } from "./spec";

// 손잡이의 입력·크기 레인 — invoke 를 손으로 끝내는 가짜로 바꿔 순서·합치기·실패 뒤 동작을 본다.

interface Call {
  cmd: string;
  args: Record<string, unknown>;
  resolve: () => void;
  reject: (e: unknown) => void;
}

let calls: Call[] = [];

beforeEach(() => {
  calls = [];
  vi.mocked(invoke).mockImplementation((cmd: string, args?: unknown) => {
    if (cmd === "reattach_output") return Promise.resolve(undefined);
    return new Promise((resolve, reject) => {
      calls.push({
        cmd,
        args: args as Record<string, unknown>,
        resolve: () => resolve(undefined),
        reject,
      });
    });
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

async function handle() {
  const pane = { id: "p1", kind: "local" } as PaneSpec;
  return reattachSession(pane, 7, { onData: () => {}, cols: 80, rows: 24 });
}

const writes = () => calls.filter((c) => c.cmd === "write_session").map((c) => c.args.data);
const resizes = () =>
  calls.filter((c) => c.cmd === "resize_session").map((c) => [c.args.cols, c.args.rows]);

describe("입력 레인", () => {
  it("날아가는 중에 들어온 입력은 하나로 합쳐 순서대로 다음에 보낸다", async () => {
    const s = await handle();
    s.write("a");
    s.write("b");
    s.write("c");
    s.write("d");
    expect(writes()).toEqual(["a"]);
    calls[0].resolve();
    await flush();
    expect(writes()).toEqual(["a", "bcd"]);
  });

  it("첫 쓰기가 실패해도 쌓인 입력은 나간다", async () => {
    const s = await handle();
    s.write("x");
    s.write("y");
    calls[0].reject(new Error("boom"));
    await flush();
    expect(writes()).toEqual(["x", "y"]);
  });

  it("죽은 뒤의 입력은 보내지 않고, 쌓인 것도 버린다", async () => {
    const s = await handle();
    s.write("x");
    s.write("y");
    const closing = s.close();
    s.write("z");
    calls[0].resolve();
    await flush();
    calls.find((c) => c.cmd === "close_session")?.resolve();
    await closing;
    expect(writes()).toEqual(["x"]);
  });

  it("detach 는 쌓인 입력을 다 보낸 뒤에 끝난다", async () => {
    const s = await handle();
    s.write("x");
    s.write("y");
    let done = false;
    const detaching = s.detach().then(() => (done = true));
    s.write("z"); // detach 뒤 입력은 받지 않는다
    calls[0].resolve();
    await flush();
    expect(writes()).toEqual(["x", "y"]);
    expect(done).toBe(false);
    calls[1].resolve();
    await detaching;
    expect(done).toBe(true);
    s.write("w");
    expect(writes()).toEqual(["x", "y"]);
  });
});

describe("재부착 — 이관 출력 재생 (R02)", () => {
  it("consumed 를 reattach_output 에 넘기고, 돌려받은 start 를 outputStart 로 싣는다", async () => {
    let sent: Record<string, unknown> | undefined;
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "reattach_output") {
        sent = args;
        return Promise.resolve({ start: 40, replayed: true, reason: null });
      }
      return Promise.resolve(undefined);
    }) as typeof invoke);
    const pane = { id: "p1", kind: "ssh" } as PaneSpec;
    const s = await reattachSession(pane, 7, { onData: () => {}, cols: 80, rows: 24 }, 40);
    expect(sent).toMatchObject({ kind: "ssh", id: 7, cols: 80, rows: 24, consumed: 40 });
    expect(s.outputStart).toBe(40);
  });

  it("consumed 가 없으면 null 로 보내고(재생 없음), 결과가 없으면 outputStart 도 없다", async () => {
    let sent: Record<string, unknown> | undefined;
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: Record<string, unknown>) => {
      if (cmd === "reattach_output") sent = args;
      return Promise.resolve(undefined);
    }) as typeof invoke);
    const s = await handle();
    expect(sent?.consumed).toBeNull();
    expect(s.outputStart).toBeUndefined();
  });
});

describe("크기 레인", () => {
  it("연타하면 마지막 크기만 두 번째로 나간다", async () => {
    const s = await handle();
    s.resize(100, 30);
    s.resize(101, 31);
    s.resize(102, 32);
    expect(resizes()).toEqual([[100, 30]]);
    calls[0].resolve();
    await flush();
    expect(resizes()).toEqual([
      [100, 30],
      [102, 32],
    ]);
  });

  it("성공한 크기는 다시 보내지 않는다", async () => {
    const s = await handle();
    s.resize(100, 30);
    calls[0].resolve();
    await flush();
    s.resize(100, 30);
    expect(resizes()).toEqual([[100, 30]]);
  });

  it("실패한 크기는 기억하지 않아 같은 크기를 다시 보낼 수 있다 (저절로 되풀이하지는 않는다)", async () => {
    const s = await handle();
    s.resize(100, 30);
    calls[0].reject(new Error("boom"));
    await flush();
    expect(resizes()).toEqual([[100, 30]]);
    s.resize(100, 30);
    expect(resizes()).toEqual([
      [100, 30],
      [100, 30],
    ]);
  });
});

describe("종료 구독 — 열기 전에 건다", () => {
  type ExitHandler = (ev: { payload: { id: number; reason: string; message: string | null } }) => void;
  let handler: ExitHandler | null;
  let order: string[];
  const unlisten = vi.fn();

  beforeEach(() => {
    handler = null;
    order = [];
    unlisten.mockClear();
    vi.mocked(listen).mockImplementation((async (event: string, h: ExitHandler) => {
      order.push(`listen:${event}`);
      handler = h;
      return unlisten;
    }) as unknown as typeof listen);
  });

  /** 열기 invoke 가 돌아오기 **전에** `before` 를 쏘고 `result` 로 끝나는 가짜 */
  function openWith(before: number[], result: () => Promise<unknown>) {
    vi.mocked(invoke).mockImplementation(((cmd: string) => {
      order.push(cmd);
      if (cmd !== "open_local_session") return Promise.resolve(undefined);
      for (const id of before) handler?.({ payload: { id, reason: "exit", message: null } });
      return result();
    }) as typeof invoke);
  }

  const pane = { id: "p1", kind: "local" } as PaneSpec;

  it("open 이 돌아오기 전에 온 제 id 의 종료를 한 번 넘기고, 다른 id 는 무시한다", async () => {
    openWith([9, 5], () => Promise.resolve({ id: 5, shell: "pwsh" }));
    const onExit = vi.fn();
    const s = await openSession(pane, { onData: () => {}, cols: 80, rows: 24, onExit });
    expect(order.slice(0, 2)).toEqual(["listen:local-exit", "open_local_session"]);
    // 손잡이를 건넨 **뒤**(다음 매크로태스크)에 넘긴다.
    expect(onExit).not.toHaveBeenCalled();
    await flush();
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(onExit).toHaveBeenCalledWith({ kind: "exit", message: null });
    // 같은 id 가 또 와도(혹은 다른 id 가 와도) 다시 부르지 않는다.
    handler?.({ payload: { id: 5, reason: "exit", message: null } });
    handler?.({ payload: { id: 9, reason: "exit", message: null } });
    expect(onExit).toHaveBeenCalledTimes(1);
    expect(s.id).toBe(5);
  });

  it("다른 id 의 종료만 왔으면 부르지 않고, 열린 뒤 제 id 는 받는다", async () => {
    openWith([9], () => Promise.resolve({ id: 5, shell: "pwsh" }));
    const onExit = vi.fn();
    await openSession(pane, { onData: () => {}, cols: 80, rows: 24, onExit });
    await flush();
    expect(onExit).not.toHaveBeenCalled();
    handler?.({ payload: { id: 9, reason: "exit", message: null } });
    expect(onExit).not.toHaveBeenCalled();
    handler?.({ payload: { id: 5, reason: "exit", message: "종료 코드 1" } });
    expect(onExit).toHaveBeenCalledWith({ kind: "exit", message: "종료 코드 1" });
  });

  it("열기가 실패하면 구독을 푼다", async () => {
    openWith([], () => Promise.reject("셸을 찾을 수 없습니다"));
    await expect(
      openSession(pane, { onData: () => {}, cols: 80, rows: 24, onExit: vi.fn() }),
    ).rejects.toBeTruthy();
    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("close 는 열기 전에 건 그 구독을 푼다", async () => {
    openWith([], () => Promise.resolve({ id: 5, shell: "pwsh" }));
    const s = await openSession(pane, { onData: () => {}, cols: 80, rows: 24, onExit: vi.fn() });
    await s.close();
    expect(unlisten).toHaveBeenCalledTimes(1);
    expect(vi.mocked(listen)).toHaveBeenCalledTimes(1);
  });
});

describe("원격 신호 — 프런트는 정하지 않는다 (2026-10-27)", () => {
  const sshPane = { id: "p1", kind: "ssh", alias: "web", historyStreamId: "h-1" } as PaneSpec;
  const start = (command: string | null) => ({ cwd: "~/app", command });

  async function openArgsOf(pane: PaneSpec, opts: Partial<Parameters<typeof openSession>[1]> = {}) {
    let sent: Record<string, unknown> | null = null;
    vi.mocked(invoke).mockImplementation(((cmd: string, args?: unknown) => {
      if (cmd !== "open_ssh_session") return Promise.resolve(undefined);
      sent = args as Record<string, unknown>;
      return Promise.resolve({ id: 3, tmux: null, lease: { stream: "h-1", sessionEpoch: 1, leaseEpoch: 1 } });
    }) as typeof invoke);
    await openSession(pane, { onData: () => {}, cols: 80, rows: 24, ...opts });
    return sent as unknown as Record<string, unknown>;
  }

  it("열기 인자에 신호 칸(agentStream)이 없다 — 스트림 · 시작 명령만 싣고 판정은 세션 서버(Rust `signal_stream`)", async () => {
    for (const s of [start("claude"), start("htop"), start(null), undefined]) {
      const args = await openArgsOf(sshPane, { start: s });
      expect(args).not.toHaveProperty("agentStream");
      expect(args).not.toHaveProperty("aiReadable");
      expect(args.streamId).toBe("h-1");
      expect(args.start).toEqual(s ?? null);
    }
  });

  it("스트림 id 가 없으면 타일 id · 빠른 접속도 같은 모양", async () => {
    const plain = await openArgsOf({ id: "p9", kind: "ssh", alias: "web" } as PaneSpec);
    expect(plain.streamId).toBe("p9");
    const adhoc = await openArgsOf({ ...sshPane, adhoc: { host: "10.0.0.5" } } as unknown as PaneSpec, {
      start: start("claude"),
    });
    expect(adhoc).not.toHaveProperty("agentStream");
    expect(adhoc.adhoc).toEqual({ host: "10.0.0.5" });
  });
});
