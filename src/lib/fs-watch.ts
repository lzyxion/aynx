// 로컬 파일 감시 구독 하나 — Rust `local_watch.rs` 의 `local_watch_start/set/stop` 손잡이(docs/log/2026-10-21-file-tile-auto-refresh.md).
// 로컬 백엔드(`fs-backend` 의 `LOCAL.watch`)만 만든다 — 원격 파일 타일은 감시가 없다(⟳ 로만 읽는다).
import { Channel, invoke } from "./ipc";

/** 타일 하나의 감시 — 볼 경로를 갈아 끼우고(`set`) 걷는다(`dispose`). 실패는 삼킨다(감시 없이 ⟳ 로 남는다) */
export interface FsWatch {
  set(paths: readonly string[]): void;
  dispose(): void;
}

/**
 * 감시 하나를 연다 — 바뀐 감시 폴더들이 `onChange` 로 온다(Rust 가 이미 모아 내보낸 것 — 300ms · 2초).
 *
 * **호출을 한 줄로 세운다**(`#chain`): async 명령은 tokio 에서 돌아 도착 순서가 보장되지 않는다 — 빠르게 두 번 고친
 * 경로가 거꾸로 앉으면 옛 폴더를 본다. 시작이 끝나기 전에 걷히면(타일이 곧바로 사라졌다) 받은 id 로 곧바로 걷는다.
 * 빈 목록이면 구독을 세우지 않는다(이미 섰으면 빈 목록으로 고친다 — OS 감시만 걷힌다).
 */
export function localWatch(onChange: (dirs: string[]) => void): FsWatch {
  let id: number | null = null;
  let disposed = false;
  /** 마지막으로 Rust 에 보낸(보낼) 목록 — 같으면 다시 보내지 않는다 */
  let sent: readonly string[] | null = null;
  let chain: Promise<unknown> = Promise.resolve();
  const channel = new Channel<{ dirs: string[] }>();
  channel.onmessage = (m) => {
    if (!disposed) onChange(m.dirs);
  };
  const queue = (work: () => Promise<unknown>) => {
    chain = chain.then(work).catch((e) => console.warn("[aynx] 파일 감시 (무시):", e));
  };
  return {
    set(paths) {
      if (disposed) return;
      if (sent !== null && sent.length === paths.length && sent.every((p, i) => p === paths[i])) return;
      if (sent === null && paths.length === 0) return;
      const snapshot = [...paths];
      sent = snapshot;
      queue(async () => {
        if (disposed) return;
        if (id === null) id = await invoke<number>("local_watch_start", { paths: snapshot, onChange: channel });
        else await invoke("local_watch_set", { id, paths: snapshot });
      });
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      queue(async () => {
        if (id !== null) await invoke("local_watch_stop", { id });
        id = null;
      });
    },
  };
}
