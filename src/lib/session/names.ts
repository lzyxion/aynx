// 패널 이름·탭 제목 합성 — 패널 헤더와 탭 바가 같은 이름을 쓰게 하는 한 곳(순수 함수, 문구는 `tr` 인자).

import type { Key } from "$lib/i18n/keys";
import { aiDisplayName } from "$lib/pane-icons";
import { defaultTabNumber, localFsName, tabTitleLabel } from "./factory";
import { isFileLeafKind, type PaneNode, type PaneSpec, type TabSpec, type Tr } from "./spec";
import { listPanes } from "./tree";

/** Rust `list_shells` 의 라벨(src-tauri/src/pty.rs)을 옮겨 적은 표 — 모르는 id 는 그대로 보여준다 */
const SHELL_NAMES: Record<string, string> = {
  pwsh: "PowerShell 7",
  powershell: "Windows PowerShell",
  gitbash: "Git Bash",
};

/** 옮길 말이 있는 셸은 문구 키를 든다 — [`SHELL_NAMES`] 는 고유명이라 두 언어가 같다 */
const SHELL_KEYS: Record<string, Key> = {
  cmd: "pane.shell.cmd",
};

/**
 * Rust 의 `label` 은 목록을 만든 순간의 언어로 구워진 글자라, 캐시한 목록을 그대로 그리면 언어를 바꿔도 옛 이름이 남는다 —
 * 아는 id 는 그릴 때 지금 언어로 고르고, 모르는 새 셸만 백엔드 글자로 떨어진다.
 */
export function shellInfoLabel(shell: { id: string; label?: string } | null | undefined, tr: Tr): string {
  if (!shell) return shellLabel(undefined, tr);
  const id = shell.id;
  const known = id.startsWith("wsl:") || Object.hasOwn(SHELL_KEYS, id) || Object.hasOwn(SHELL_NAMES, id);
  if (known) return shellLabel(id, tr);
  return shell.label?.trim() || id;
}

export function shellLabel(shell: string | undefined, tr: Tr): string {
  // id 가 안 실린 타일 — 백엔드가 그때그때 고르므로 이름을 특정할 수 없다.
  if (!shell) return tr("pane.name.local");
  if (shell.startsWith("wsl:")) return `WSL: ${shell.slice(4)}`;
  const key = SHELL_KEYS[shell];
  return key ? tr(key) : (SHELL_NAMES[shell] ?? shell);
}

/** 파일 브라우저는 위치만 이름이다 — 종류는 앞자리 아이콘(`PaneIcon`)이 말한다 */
export function paneName(pane: PaneSpec, tr: Tr): string {
  if (pane.kind === "start") return tr("pane.name.start");
  if (pane.kind === "sftp") {
    return pane.alias?.trim() || tr("pane.name.files.remote");
  }
  if (pane.kind === "localfs") return localFsName(pane.path, tr);
  if (isFileLeafKind(pane.kind)) return docName(pane, tr);
  if (pane.kind === "branches") {
    const name = pane.branchGraph?.name?.trim();
    return name ? tr("pane.name.branches.project", { name }) : tr("pane.name.branches");
  }
  if (pane.kind === "diff") {
    const name = pane.diff?.branch?.trim() || pane.diff?.name?.trim();
    return name ? tr("pane.name.diff.named", { name }) : tr("pane.name.diff");
  }
  if (pane.kind === "run") {
    const name = pane.run?.name?.trim();
    return name ? tr("pane.name.run.named", { name }) : tr("pane.name.run");
  }
  if (pane.kind === "producer") return tr("pane.name.producer");
  if (pane.kind === "chat") {
    const cli = pane.chat?.cli ?? "";
    return tr("pane.name.chatTile", { agent: aiDisplayName(cli) ?? cli });
  }
  if (pane.kind === "query") return pane.query?.name?.trim() || pane.query?.connId || tr("pane.name.query");
  if (pane.kind === "ssh") return pane.alias?.trim() || tr("pane.name.ssh");
  return shellLabel(pane.shell, tr);
}

/**
 * 빈 탭을 대신한 타일이 탭에 줄 자동 제목 — 주소가 곧 이름인 타일만. 세션 타일은 `null`(지금까지의 탭 제목 규칙).
 * 적어 둔 제목은 그 뒤 타일이 바뀌어도 남는다.
 */
export function loneTileTitle(pane: PaneSpec, tr: Tr): string | null {
  return ["branches", "diff", "localfs", "sftp", "doc", "image", "query", "run"].includes(pane.kind) ? paneName(pane, tr) : null;
}

/** 원격은 별칭을 붙인다 — 같은 `README.md` 를 로컬과 서버에서 나란히 열어 두는 일이 흔하다 */
function docName(pane: PaneSpec, tr: Tr): string {
  const trimmed = (pane.path ?? "").replace(/[\\/]+$/, "");
  const file = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
  const name = file || tr(pane.kind === "image" ? "pane.name.image" : "pane.name.doc");
  const alias = pane.alias?.trim();
  return alias ? tr("pane.name.doc.remote", { file: name, alias }) : name;
}

export function paneNames(node: PaneNode, tr: Tr): string[] {
  return listPanes(node).map((pane) => paneName(pane, tr));
}

export const TITLE_HEADS = 2;

/** 글자 수로 자르지 않는다 — 별칭이 중간에서 잘려 못 알아본다(폭은 탭의 `.title` ellipsis 가 맡는다) */
export function composeTitle(names: readonly string[], max: number = TITLE_HEADS): string {
  if (names.length === 0) return "";
  const head = names.slice(0, max).join(" · ");
  const rest = names.length - Math.min(max, names.length);
  return rest > 0 ? `${head} +${rest}` : head;
}

/** [`tabDisplayTitle`] 과 `app/titles.svelte.ts` 의 `displayTabTitle` 이 함께 쓰는 순서 한 곳이다 */
export function tabFixedTitle(tab: Pick<TabSpec, "name" | "pinnedTitle">): string | null {
  return tab.name?.trim() || tab.pinnedTitle?.trim() || null;
}

/** 사용자 이름 · 고정 제목은 타일 수에 흔들리지 않는다 — 타일을 하나 더 열었다고 바뀌면 이름을 붙인 뜻이 사라진다 */
export function tabDisplayTitle(tab: TabSpec, tr: Tr): string {
  return composeTabTitle(tab, (pane) => paneName(pane, tr), tr);
}

/** 순서는 이 한 곳 — 순수 쪽은 [`paneName`], 표시용은 런타임 신호를 얹은 `displayName` 을 `nameOf` 로 넘긴다 */
export function composeTabTitle(tab: TabSpec, nameOf: (pane: PaneSpec) => string, tr: Tr): string {
  const fixed = tabFixedTitle(tab);
  if (fixed) return fixed;
  const panes = listPanes(tab.root);
  if (panes.length > 1) return composeTitle(panes.map(nameOf));
  const lone = panes[0];
  if (lone && lone.kind !== "start" && defaultTabNumber(tab.title) !== null) return nameOf(lone);
  return tabTitleLabel(tab.title, tr);
}
