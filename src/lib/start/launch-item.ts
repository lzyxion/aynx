import type { HostEntry } from "$lib/hosts";
import type { LauncherProjectRow } from "$lib/recent-worktrees";
import type { ShellInfo } from "$lib/session";

/**
 * 시작 화면 위젯의 **줄 하나** (docs/log/2026-10-28-start-widgets.md) — 타입만 있는 잎 모듈.
 *
 * 줄은 `key` 글자로 고른다(자리 번호가 아니다 — 이력이 갱신되거나 에이전트 점이 바뀌어 순서가 달라져도 고른 것이 남는다).
 * 여는 함수는 `StartPage` 가 쥔다(전부 **이미 있는 여는 함수** — 호스트 독의 접속 · 독의 프로젝트 열기 · `>_` 메뉴의 셸).
 */
export type LaunchItem =
  | { key: string; kind: "host"; host: HostEntry }
  | { key: string; kind: "project"; row: LauncherProjectRow }
  | { key: string; kind: "shell"; shell: ShellInfo | null; isDefault: boolean };

/** 위젯이 줄을 그릴 때 받는 손잡이 — 셋 다 `StartPage` 의 선택 하나를 지난다 */
export interface LaunchRowHandlers {
  /** 고른 줄의 키(`aria-activedescendant` 와 판 칠) */
  selectedKey: string | null;
  /** 줄의 DOM id — 이 위젯의 몇째 줄인지로 짓는다 */
  optId: (index: number) => string;
  onselect: (key: string) => void;
  onactivate: (item: LaunchItem) => void;
}
