// 전체 창 큐 flush/pause → FILE_LOCK 아래 전 파일 변경 → 메모리 ACK → resume.
import { invoke } from "../ipc";
import { requestWindow } from "$lib/workspaces/window-events";
let running: Promise<void> = Promise.resolve();

export function rewriteWorkspaceHosts(aliases: readonly string[], to?: string): Promise<void> {
  const run = async () => {
    const labels = await invoke<string[]>("workspace_windows");
    const paused: string[] = [];
    let committed = false;
    let acknowledged = false;
    try {
      for (const label of labels) {
        if (await requestWindow(label, { kind: "pause" }) !== true) throw new Error("workspacePauseFailed");
        paused.push(label);
      }
      await invoke("workspaces_apply", { mutation: { op: "rewriteHostAliases", aliases: [...aliases], to } });
      committed = true;
      for (const label of labels) {
        if (await requestWindow(label, { kind: "hostAliases", aliases: [...aliases], to }) !== true) throw new Error("workspaceHostAckFailed");
      }
      acknowledged = true;
    } finally {
      // commit 이후 ACK를 잃으면 옛 화면이 파일을 되돌리지 않게 큐를 멈춰 둔다.
      if (!committed || acknowledged) for (const label of paused) await requestWindow(label, { kind: "resume" });
    }
  };
  const result = running.then(run);
  running = result.catch(() => {});
  return result;
}
