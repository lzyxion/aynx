// 패널 이름·탭 제목 합성 — 패널 헤더와 탭 바가 **같은 이름**을 쓰게 하는 한 곳(순수 함수, 문구는 `tr` 인자).

import type { Key } from "$lib/i18n/keys";
import { defaultTabNumber, localFsName, tabTitleLabel } from "./factory";
import type { PaneNode, PaneSpec, TabSpec, Tr } from "./spec";
import { listPanes } from "./tree";

// ---------------------------------------------------------------------------
// 패널의 이름 · 탭 제목 합성 (docs/log/2026-09-02-pane-identity.md)
//
// 병합된 탭에서 "이 패널이 어느 서버인가 / 이 탭에 뭐가 들었는가" 를 말해 주는 문자열은
// 전부 여기서 나온다 — 패널 헤더(`PaneHost`)와 탭 제목(`Tabs`)이 **같은 이름**을 써야
// 둘을 눈으로 짝지을 수 있기 때문이다. 전부 순수 함수다.
// ---------------------------------------------------------------------------

/**
 * 로컬 셸 id → 표시 이름. Rust `list_shells` 의 라벨을 **그대로 옮겨 적은 표**다
 * (src-tauri/src/pty.rs). 패널에는 id 만 실려 있고 라벨은 실려 있지 않아서
 * (`PaneSpec.shell`), 드롭다운을 다시 열지 않고도 이름을 낼 수 있어야 한다.
 *
 * 모르는 id 는 **그대로 보여준다** — 백엔드에 셸이 새로 늘어도 빈 이름이 되지 않는다.
 */
const SHELL_NAMES: Record<string, string> = {
  pwsh: "PowerShell 7",
  powershell: "Windows PowerShell",
  gitbash: "Git Bash",
};

/**
 * 옥길 말이 있는 쉘은 **문구 키**를 든다 (후보 표가 키를 드는 것과 같은 규칙 —
 * docs/log/2026-09-17-i18n.md). 위의 [`SHELL_NAMES`] 는 고유명이라 두 언어가 같다.
 */
const SHELL_KEYS: Record<string, Key> = {
  cmd: "pane.shell.cmd",
};

/**
 * 감지된 셸 한 줄(`list_shells` 의 항목)의 **표시 이름** — 화면이 셸 이름을 그리는 자리는 전부 이것을
 * 거친다(설정 › 기본 셸 · 상태바 `>_` 메뉴 · 시작 화면 · 프로젝트 화면·폼).
 *
 * Rust 가 실어 보내는 `label` 은 **목록을 만든 순간의 언어**로 구워진 글자다. 목록은 한 번 받아 캐시하므로
 * 그 글자를 그대로 그리면 언어를 바꿔도 옛 이름("명령 프롬프트")이 남는다. 그래서 아는 id 는 **그릴 때**
 * [`shellLabel`] 로 지금 언어의 문구를 고르고, 프런트가 모르는 새 셸만 백엔드 글자(없으면 id)로 떨어진다.
 */
export function shellInfoLabel(shell: { id: string; label?: string } | null | undefined, tr: Tr): string {
  if (!shell) return shellLabel(undefined, tr);
  const id = shell.id;
  const known = id.startsWith("wsl:") || Object.hasOwn(SHELL_KEYS, id) || Object.hasOwn(SHELL_NAMES, id);
  if (known) return shellLabel(id, tr);
  return shell.label?.trim() || id;
}

export function shellLabel(shell: string | undefined, tr: Tr): string {
  // id 가 안 실린 타일 — 셸을 지정하지 않고 연 세션(옛 타일·감지 실패 폴백)이다.
  // 백엔드가 그때그때 고르므로 이름을 특정할 수 없다 ([`paneName`] 이 이 값을 쓴다).
  if (!shell) return tr("pane.name.local");
  if (shell.startsWith("wsl:")) return `WSL: ${shell.slice(4)}`;
  const key = SHELL_KEYS[shell];
  return key ? tr(key) : (SHELL_NAMES[shell] ?? shell);
}

/**
 * 패널 하나의 표시 이름 — ssh 면 별칭, local 이면 셸 라벨, 그 밖은 종류마다의 주소(아래).
 *
 * 파일 브라우저 둘은 **위치만** 이름이다(`"web-01"`·`"내 PC"`·폴더 이름 — [`localFsName`]). 예전에는
 * `파일 · ` 접두사를 붙여 같은 서버의 터미널과 글자로 갈랐지만, 탭·헤더·상태바가 이름 **앞자리 아이콘**
 * (`PaneIcon` — 폴더)으로 종류를 이미 말해 군더더기였다(2026-10-11 사용자 요청으로 걷음).
 */
export function paneName(pane: PaneSpec, tr: Tr): string {
  if (pane.kind === "start") return tr("pane.name.start");
  if (pane.kind === "sftp") {
    return pane.alias?.trim() || tr("pane.name.files.remote");
  }
  if (pane.kind === "localfs") return localFsName(pane.path, tr);
  if (pane.kind === "doc") return docName(pane, tr);
  if (pane.kind === "branches") {
    const name = pane.branchGraph?.name?.trim();
    return name ? tr("pane.name.branches.project", { name }) : tr("pane.name.branches");
  }
  if (pane.kind === "diff") {
    // "변경 · feat-retry" — 브랜치(분리 HEAD 면 화면용 사본 · 워크트리 이름)
    const name = pane.diff?.branch?.trim() || pane.diff?.name?.trim();
    return name ? tr("pane.name.diff.named", { name }) : tr("pane.name.diff");
  }
  // 오케스트레이션 보드(2b) — Run 이름(화면용 사본)이 있으면 "Run · 이름"
  if (pane.kind === "run") {
    const name = pane.run?.name?.trim();
    return name ? tr("pane.name.run.named", { name }) : tr("pane.name.run");
  }
  // 프로듀서 채팅 잎(2단계 단계 3) — "프로듀서"
  if (pane.kind === "producer") return tr("pane.name.producer");
  // 쿼리 타일 — 화면용 사본(프리셋 이름 · 경유 호스트 — 타일이 뜰 때 채운다)이 없으면 연결 id
  if (pane.kind === "query") return pane.query?.name?.trim() || pane.query?.connId || tr("pane.name.query");
  if (pane.kind === "ssh") return pane.alias?.trim() || tr("pane.name.ssh");
  return shellLabel(pane.shell, tr);
}

/**
 * 빈 탭(시작 타일 하나)을 **대신한** 타일이 탭에 줄 자동 제목 — 주소가 곧 이름인 타일(브랜치 그래프 · diff · 파일 ·
 * 문서)만 [`paneName`] 을, 세션 타일(셸 · SSH · AI)은 `null`(그쪽은 지금까지의 탭 제목 규칙 — 프로젝트 탭 제목 · `탭 N`).
 *
 * 탭에 타일이 하나뿐이면 탭 바는 자동 제목 꼴이 아닌 저장된 제목을 그대로 찍는다([`tabDisplayTitle`]) — 처음 이것을 단 까닭은
 * "브랜치 · df-lab" 타일 하나뿐인 탭이 "새 탭" 으로 남던 것(2026-10-05 실기)이고, 지금은 자동 제목이어도 타일 이름이 서지만
 * 적어 둔 제목은 그 뒤 타일이 바뀌어도 남는다. 사용자 이름(`TabSpec.name`)은 늘 이것보다 앞선다.
 */
export function loneTileTitle(pane: PaneSpec, tr: Tr): string | null {
  return ["branches", "diff", "localfs", "sftp", "doc", "query", "run"].includes(pane.kind) ? paneName(pane, tr) : null;
}

/**
 * 문서 타일의 표시 이름 — 파일 이름, 원격이면 `README.md · web-01` (docs/log/2026-09-27-doc-tile.md).
 *
 * 경로 전체가 아니라 **마지막 조각**인 이유는 [`localFsName`] 과 같다(좁아지면 앞부터 잘려 가장 중요한 것이
 * 먼저 사라진다). 원격은 별칭을 붙인다 — 같은 `README.md` 를 로컬과 서버에서 나란히 열어 두는 일이 흔하다.
 */
function docName(pane: PaneSpec, tr: Tr): string {
  const trimmed = (pane.path ?? "").replace(/[\\/]+$/, "");
  const file = trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
  const name = file || tr("pane.name.doc");
  const alias = pane.alias?.trim();
  return alias ? tr("pane.name.doc.remote", { file: name, alias }) : name;
}

/** 트리의 패널 이름들 (왼쪽·위 우선 = 화면에서 읽는 순서) */
export function paneNames(node: PaneNode, tr: Tr): string[] {
  return listPanes(node).map((pane) => paneName(pane, tr));
}

/** 합성 제목에 이름을 몇 개까지 적는가 (넘치면 `+N`) */
export const TITLE_HEADS = 2;

/**
 * 이름 목록 → 탭 한 칸에 들어갈 한 줄 — **순수 함수**.
 *
 * `["web-01","db-01","web-02","db-02"]` → `"web-01 · db-01 +2"`.
 * 앞 [`TITLE_HEADS`] 개만 `·` 로 잇고 나머지는 개수로 접는다. 폭 제한은 여기서 하지 않는다 —
 * 탭의 `.title` 이 이미 ellipsis 를 걸고 있고, 글자 수로 자르면 별칭이 중간에서 잘려
 * 오히려 못 알아본다 (`web-0…` vs `web-01 · db-01 +2`).
 */
export function composeTitle(names: readonly string[], max: number = TITLE_HEADS): string {
  if (names.length === 0) return "";
  const head = names.slice(0, max).join(" · ");
  const rest = names.length - Math.min(max, names.length);
  return rest > 0 ? `${head} +${rest}` : head;
}

/**
 * 타일 구성과 **상관없이 서는** 탭 제목 — 사용자 이름([`TabSpec.name`]), 없으면 프로젝트 탭의 고정 제목
 * ([`TabSpec.pinnedTitle`]). 둘 다 없으면 `null`(그때는 합성·자동 제목). 공백만 든 값은 없는 것으로 본다.
 * [`tabDisplayTitle`] 과 `app/titles.svelte.ts` 의 `displayTabTitle` 이 함께 쓰는 순서 한 곳이다.
 */
export function tabFixedTitle(tab: Pick<TabSpec, "name" | "pinnedTitle">): string | null {
  return tab.name?.trim() || tab.pinnedTitle?.trim() || null;
}

/**
 * 탭 바에 찍을 **탭 이름**.
 *
 * 우선순위가 넷이다:
 *  1. 사용자가 붙인 이름([`TabSpec.name`]) — 있으면 **무조건 이것**이다. 그 이름을 붙인
 *     이유가 "안에 뭐가 들었든 이 칸은 늘 '배포' 라고 부르겠다" 이므로, 타일을 하나 더
 *     열었다고 제목이 바뀌면 이름을 붙인 뜻이 사라진다.
 *  1½. 프로젝트 탭의 고정 제목([`TabSpec.pinnedTitle`]) — 같은 이유로 타일 수에 흔들리지 않는다
 *     (1 과 함께 [`tabFixedTitle`]).
 *  2. 패널이 2개 이상 → 패널 이름들의 합성 (`web-01 · db-01 +2`).
 *  3. 패널이 하나 →
 *     a. 저장된 제목이 자동 제목 꼴(`탭 3` — [`defaultTabNumber`])이 **아니면** 그 글자 — 빈 탭을 대신할 때
 *        [`loneTileTitle`] · 지난 대화 재개 · 프로젝트가 일부러 적은 제목이다.
 *     b. 자동 제목 꼴이고 그 타일이 시작 타일이 아니면 **그 타일의 이름**(셸 · SSH · AI 타일 하나뿐인 탭이
 *        "새 탭" 으로 남지 않게 — 2026-10-24 사용자 요청).
 *     c. 시작 타일 하나(빈 탭)면 자동 제목을 [`tabTitleLabel`] 이 지금 언어로 옮긴다("새 탭").
 *
 * 공백만 넣은 이름은 이름이 없는 것으로 본다 (탭 칸이 빈칸으로 보이는 것을 막는다).
 * 이 순서는 [`composeTabTitle`] 한 곳이고, 표시용 `app/titles.svelte.ts` 의 `displayTabTitle` 은 이름 함수만 바꿔 같은 것을 부른다.
 */
export function tabDisplayTitle(tab: TabSpec, tr: Tr): string {
  return composeTabTitle(tab, (pane) => paneName(pane, tr), tr);
}

/**
 * [`tabDisplayTitle`] 의 순서 그대로, 타일 이름만 `nameOf` 로 뽑는다 — 순수 쪽은 [`paneName`],
 * 표시용은 런타임 신호를 얹은 `displayName`.
 */
export function composeTabTitle(tab: TabSpec, nameOf: (pane: PaneSpec) => string, tr: Tr): string {
  const fixed = tabFixedTitle(tab);
  if (fixed) return fixed;
  const panes = listPanes(tab.root);
  if (panes.length > 1) return composeTitle(panes.map(nameOf));
  const lone = panes[0];
  if (lone && lone.kind !== "start" && defaultTabNumber(tab.title) !== null) return nameOf(lone);
  return tabTitleLabel(tab.title, tr);
}

/**
 * 새 패널이 대상 패널의 **어느 쪽**에 들어가는가.
 *
 * `dir` 과 짝을 이뤄 네 방향을 만든다: `row`+`before` = 왼쪽, `row`+`after` = 오른쪽,
 * `col`+`before` = 위, `col`+`after` = 아래. 드래그 앤 드랍의 4분면이 그대로 이 두 값이다.
 */
