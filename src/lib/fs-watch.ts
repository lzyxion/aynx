// 로컬 파일 감시 구독 하나 — Rust `local_watch.rs` 의 `local_watch_start/set/stop` 손잡이.
import { Channel, invoke } from "./ipc";

/** 실패는 삼킨다(감시 없이 ⟳ 로 남는다) */
export interface FsWatch {
  set(paths: readonly string[]): void;
  dispose(): void;
}

/**
 * 호출을 한 줄로 세운다(`chain`) — async 명령은 도착 순서가 보장되지 않아, 빠르게 두 번 고친 경로가 거꾸로 앉으면 옛 폴더를 본다.
 * 시작이 끝나기 전에 걷히면 받은 id 로 곧바로 걷는다.
 */
export function localWatch(onChange: (dirs: string[]) => void): FsWatch {
  let id: number | null = null;
  let disposed = false;
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
