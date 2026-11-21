import type { HostEntry } from "$lib/hosts";
import type { LauncherProjectRow } from "$lib/recent-worktrees";
import type { ShellInfo } from "$lib/session";

/** 줄은 `key` 글자로 고른다 — 자리 번호면 이력 · 에이전트 점이 바뀌어 순서가 달라질 때 고른 것이 옮겨 간다 */
export type LaunchItem =
  | { key: string; kind: "host"; host: HostEntry }
  | { key: string; kind: "project"; row: LauncherProjectRow }
  | { key: string; kind: "shell"; shell: ShellInfo | null; isDefault: boolean };

export interface LaunchRowHandlers {
  selectedKey: string | null;
  optId: (index: number) => string;
  onselect: (key: string) => void;
  onactivate: (item: LaunchItem) => void;
}
