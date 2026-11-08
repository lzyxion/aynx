import {
  fuzzyMatch,
  hostMeta,
  hostSearchText,
  hostsInGroup,
  type GroupMeta,
  type HostEntry,
  type HostsDrag,
} from "$lib/hosts";
import type { Key } from "$lib/i18n/keys";
import { compareNames } from "$lib/list-order";

/**
 * **호스트 독의 폴더 모델** — 그룹을 펼치고 접는 **트리**의 규칙 (docs/log/2026-09-25-hosts-tree.md).
 *
 * 처음(2026-09-03)에는 `cwd` 하나로 한 층씩 들어가 보는 **파일 탐색기**였다
 * (docs/log/2026-09-03-hosts-folder-browser.md). 써 본 사용자의 말이 "생각보다 불편하다" 였고,
 * 프로젝트 칸처럼 **아래로 펼치는 트리**가 됐다 — 한 층을 만드는 규칙([`folderRows`])은 그대로
 * 두고, 그 위에 펼친 폴더를 재귀로 이어 붙이는 [`hostTreeRows`] 가 섰다.
 *
 * 그룹은 `"prod/web"` 같은 **경로 문자열**로만 존재한다 (백엔드에 폴더라는 실체가 없다).
 * 그래서 화면은 매번 호스트들의 그룹 경로에서 "지금 층" 을 다시 **유도**한다:
 *
 *   "prod" 한 층
 *     · 하위 폴더 = 그룹이 `prod/…` 인 호스트들의 **바로 다음 세그먼트** 모음 (`web`, `db`)
 *     · 직속 호스트 = 그룹이 **정확히** `"prod"` 인 호스트들
 *   ""(최상위) 한 층
 *     · 하위 폴더 = 최상위 세그먼트 모음, 직속 호스트 = **그룹 없는** 호스트들
 *
 * 이 파일에는 DOM 도 룬도 없다 — 전부 `(목록, 경로, 메타) → 값` 이라 표로 굳혀 둘 수 있고,
 * 그래서 `Sidebar.svelte` 밖으로 나왔다. 예전에는 이 규칙들이 컴포넌트 안에 있어서 "지금 층에
 * 무엇이 보이는가" 를 확인할 방법이 화면을 띄워 보는 것뿐이었다.
 */

/** 그룹 경로를 세그먼트로 쪼갠다 — 빈 세그먼트(`"prod//web"`·`"/prod"`·공백)는 버린다 */
export function segmentsOf(raw: string | null | undefined): string[] {
  const s = raw?.trim();
  return s
    ? s
        .split("/")
        .map((x) => x.trim())
        .filter((x) => x !== "")
    : [];
}

/** 정규화된 그룹 경로 (`" /prod// web "` → `"prod/web"`) */
export function normalizeGroupPath(raw: string | null | undefined): string {
  return segmentsOf(raw).join("/");
}

/** 호스트가 실제로 놓인 폴더 경로 (그룹이 없으면 `""` = 홈) */
export function groupPathOf(host: HostEntry): string {
  return normalizeGroupPath(hostMeta(host).group);
}

/** 마지막 세그먼트만 (`"prod/web"` → `"web"`) */
export function lastSegment(p: string): string {
  return p.slice(p.lastIndexOf("/") + 1);
}

/** 부모 경로 (`"prod/web"` → `"prod"`, 최상위면 `""`) */
export function parentPath(p: string): string {
  const i = p.lastIndexOf("/");
  return i < 0 ? "" : p.slice(0, i);
}

/**
 * 한 층의 한 줄 — **폴더**(하위 그룹)이거나 **호스트**다. 들여쓰기·펼침은 트리 줄
 * ([`HostTreeRow`])이 덧붙인다. 폴더와 호스트는 **한 줄기로** 이어 붙어 한 배열에 산다 —
 * 그래서 ↑↓ 가 둘을 구분 없이 훑고 선택도 둘을 가리지 않는다.
 */
export type HostRow =
  | {
      kind: "folder";
      /** `"prod/web"` 같은 전체 경로 — 들어갈 목적지이자 드롭·메뉴의 대상 */
      fullPath: string;
      /** 마지막 세그먼트만 (`"web"`) */
      label: string;
      /** 이 폴더 아래(하위 폴더 포함) **전체** 호스트 수 */
      count: number;
    }
  | {
      kind: "host";
      host: HostEntry;
    };

/**
 * 열린 우클릭 메뉴가 가리키는 것 — 폴더 · 호스트 · **빈 배경**이 같은 메뉴 상자를
 * 공유하므로 `kind` 로 대상을 가른다 (`x`/`y` 는 커서 위치).
 *
 * - 폴더: `path` 는 전체 경로 (이름 변경·아이콘·해제·하위 폴더 추가).
 * - 호스트: `host` 는 대상 항목 (대부분 상위 콜백에 위임하고 제거만 확인을 거친다).
 * - 배경: 대상이 없다 — 최상위에 대한 조작(폴더/호스트 추가·붙여넣기·새로고침)이다.
 */
export type HostMenuTarget =
  | { kind: "group"; path: string; x: number; y: number }
  | { kind: "host"; host: HostEntry; x: number; y: number }
  | { kind: "bg"; x: number; y: number };

/**
 * 줄 하나의 선택 id — 폴더는 `g:<전체 경로>`, 호스트는 `h:<별칭>`.
 *
 * 접두사가 있어야 `prod` 라는 이름의 폴더와 `prod` 라는 별칭의 호스트가 섞이지 않는다.
 * **같은 별칭 블록이 여러 번 나오면 두 줄이 같은 id 를 갖는다** — 함께 골라지고 함께
 * 움직이는데, 이 앱의 모든 조작이 별칭 하나를 대상으로 삼으므로(remove_host·set_host_meta)
 * 그게 오히려 어긋나지 않는 동작이다.
 */
export function rowId(row: HostRow): string {
  return row.kind === "folder" ? `g:${row.fullPath}` : `h:${row.host.name}`;
}

/**
 * `dir` 폴더의 내용을 한 층만 만든다 — 하위 폴더 먼저, 그다음 직속 호스트. **둘 다 이름순**
 * (`compareNames` — 프로젝트 · DB 칸과 같은 비교, 탐색기처럼 폴더가 위). 2026-10-20 까지는 폴더는 처음 등장한 순서 ·
 * 호스트는 설정 파일 순서였다 — 정렬 단추가 "이름순" 인데 글자순으로 서지 않았다(사용자 보고). "최근" 정렬은 그 위에서
 * 호스트 자리만 다시 고른다(`sortRowsByRecent` — 폴더는 이름순 그대로). 끌어서 순서를 바꾸는 기능은 없다(끌기는 폴더로 옮기기뿐).
 *
 * 개수는 `hostsInGroup` 을 그대로 써서
 * 하위 폴더까지 합쳐 센다 — 그룹 머리글의 개수 배지가 쓰던 규칙과 같으므로 "폴더를 끌면
 * 안의 것이 딸려 온다"(전체 열기·드래그)와 숫자가 어긋나지 않는다.
 *
 * **폴더의 출처는 두 곳이고 합집합으로 본다**:
 *  1. 호스트들의 그룹 경로 — 원래부터의 유일한 출처.
 *  2. 그룹 메타(`meta`)의 키 — "폴더 추가" 로 만든 **빈 폴더**가 사는 곳이다.
 *
 * 2번이 없으면 호스트가 하나도 없는 폴더는 만들자마자 사라진다 (폴더라는 실체가 백엔드에
 * 없고 경로에서 유도될 뿐이라서). 두 출처 모두 **조상 경로까지** 이 층에 걸린다 —
 * `[groups."a/b/c"]` 하나만 있어도 홈에서 `a` 가, `a` 안에서 `b` 가 보여야 한다.
 * 개수는 어느 쪽에서 왔든 `hostsInGroup` 이라 빈 폴더는 자연히 `0` 이다.
 */
export function folderRows(
  list: HostEntry[],
  dir: string,
  meta: Record<string, GroupMeta>,
): HostRow[] {
  const prefix = dir === "" ? "" : dir + "/";
  const folders: { fullPath: string; label: string }[] = [];
  const seen = new Set<string>();
  const direct: HostEntry[] = [];

  /** 경로 하나에서 **이 층의 자식 세그먼트**를 뽑아 (처음 보는 것이면) 담는다 */
  function offerFolder(path: string) {
    if (!path.startsWith(prefix)) return; // 다른 가지 — 이 층과 무관하다
    const child = path.slice(prefix.length).split("/")[0];
    if (child === "" || seen.has(child)) return; // 이 폴더 자신이거나 이미 담았다
    seen.add(child);
    folders.push({ fullPath: prefix + child, label: child });
  }

  for (const host of list) {
    const path = groupPathOf(host);
    if (path === dir) {
      direct.push(host); // 이 폴더의 직속 (홈이면 그룹 없는 호스트)
      continue;
    }
    offerFolder(path);
  }
  // 호스트가 없어 1번에서 안 나온 폴더들(빈 폴더) — 아래에서 이름순으로 함께 선다
  for (const path of Object.keys(meta)) offerFolder(normalizeGroupPath(path));
  folders.sort((a, b) => compareNames(a.label, b.label));
  direct.sort((a, b) => compareNames(a.name, b.name));

  const rows: HostRow[] = [];
  for (const f of folders) {
    rows.push({
      kind: "folder",
      fullPath: f.fullPath,
      label: f.label,
      count: hostsInGroup(list, f.fullPath).length,
    });
  }
  for (const host of direct) rows.push({ kind: "host", host });
  return rows;
}

/**
 * 트리의 한 줄 — 한 층의 줄([`HostRow`])에 **깊이**(들여쓰기 단수)를 붙이고, 폴더면 펼침 상태를
 * 더한다. `auto` 는 검색이 **저절로** 펼친 폴더다 — 사용자가 접어 둔 상태는 건드리지 않았으므로
 * ← 로 접을 것이 없다(프로젝트 트리의 `auto` 와 같은 뜻 — `projectTreeRows`).
 *
 * 호스트 줄의 `lastOkAt` 은 접속 이력의 **마지막 성공** 시각(Unix ms · 없으면 `null`)이다 — 줄의
 * 뒷글자("2분 전")가 이 값에서 나온다(docs/log/2026-09-25-hosts-tree.md 덧붙임). 시각 그대로 들고
 * "몇 분 전" 으로 바꾸는 것은 화면의 몫이다 — 그래야 이 모형이 "지금" 을 몰라도 된다.
 */
export type HostTreeRow =
  | (Extract<HostRow, { kind: "folder" }> & { depth: number; expanded: boolean; auto: boolean })
  | (Extract<HostRow, { kind: "host" }> & { depth: number; lastOkAt: number | null });

/** [`hostTreeRows`] 의 곁가지 — 둘 다 없어도 된다 */
export interface HostTreeOptions {
  /**
   * **한 층의 줄**을 다시 세우는 자리 — 없으면 한 층 모델의 이름순 그대로다. "최근" 정렬(`sortRowsByRecent`)이
   * 호스트 자리만 갈아 끼우므로 폴더 먼저·호스트 뒤(폴더는 이름순)는 층마다 그대로다.
   */
  sortLevel?: (rows: HostRow[]) => HostRow[];
  /**
   * 별칭 → 마지막 **성공** 접속 시각(없으면 `null`). 이력 표를 직접 받지 않고 함수로 받는 까닭:
   * `host-history.ts` 가 이 파일의 `HostRow` 를 들이므로, 거꾸로 들이면 타입 그래프에 고리가
   * 생긴다(`check:cycles --with-types`). 부르는 쪽이 `historyOf(…)?.last_ok_at` 을 넘긴다.
   */
  lastOkOf?: (alias: string) => number | null;
}

/**
 * **독 트리의 줄들** — 최상위부터 한 층씩([`folderRows`]) 만들고, 펼친 폴더 아래에 그 폴더의 층을
 * 재귀로 이어 붙인다. 층마다 폴더 먼저·호스트 뒤라는 규칙은 한 층 모델 그대로다.
 *
 * - 검색어가 없으면: 저장된 펼침(`expanded` — 폴더의 전체 경로)만 펼친다. 그룹 메타에만 있는 **빈
 *   폴더**도 선다(개수 0 · 펼쳐도 아이가 없다).
 * - 검색어가 있으면: 걸린 **호스트**만 남기고, 그 호스트를 품은 폴더(조상 전부)를 **저절로 펼친다**
 *   (`auto: true` — 저장하지 않는다). 폴더의 개수는 그 안에서 걸린 수다. 폴더 이름으로 찾는 것도
 *   이 길로 된다 — 검색 글자(`hostSearchText`)가 그룹 경로를 품으므로 `prod` 를 치면 그 폴더의
 *   호스트가 전부 걸려 폴더째 펼쳐진다. 빈 폴더는 걸릴 호스트가 없어 검색에서는 서지 않는다.
 *
 * 곁가지(`opts`)는 [`HostTreeOptions`] — 층마다의 정렬과 호스트 줄의 마지막 접속 시각.
 */
export function hostTreeRows(
  list: HostEntry[],
  meta: Record<string, GroupMeta>,
  expanded: ReadonlySet<string>,
  query: string,
  opts: HostTreeOptions = {},
): HostTreeRow[] {
  const sortLevel = opts.sortLevel ?? ((rows: HostRow[]) => rows);
  const lastOkOf = opts.lastOkOf ?? (() => null);
  const q = query.trim();
  const searching = q !== "";
  const src = searching ? list.filter((h) => fuzzyMatch(q, hostSearchText(h))) : list;
  // 검색 중에는 메타의 빈 폴더를 세우지 않는다 — 걸린 것이 없는 폴더다.
  const levelMeta = searching ? {} : meta;
  const out: HostTreeRow[] = [];
  const walk = (dir: string, depth: number) => {
    for (const r of sortLevel(folderRows(src, dir, levelMeta))) {
      if (r.kind === "folder") {
        const open = searching || expanded.has(r.fullPath);
        out.push({ ...r, depth, expanded: open, auto: searching });
        if (open) walk(r.fullPath, depth + 1);
      } else {
        out.push({ ...r, depth, lastOkAt: lastOkOf(r.host.name) });
      }
    }
  };
  walk("", 0);
  return out;
}

/**
 * 트리 줄이 **어느 폴더의 아이**인가 — 폴더 줄은 제 부모 경로, 호스트 줄은 제 그룹 경로.
 * `""` 는 최상위(부모 줄이 없다). ← 가 부모 줄로 올라가는 길이다.
 */
export function parentOfRow(row: HostRow): string {
  return row.kind === "folder" ? parentPath(row.fullPath) : groupPathOf(row.host);
}

/**
 * **이 줄이 가리키는 폴더** — 폴더 줄이면 그 폴더, 호스트 줄이면 그 호스트가 든 폴더, 없으면
 * 최상위(`""`). 트리에는 "지금 들어가 있는 폴더"(`cwd`)가 없으므로, 호스트 추가(`+`)·붙여넣기가
 * "어디에" 를 이 값으로 정한다 — 고른 줄의 자리다.
 */
export function folderOfRow(row: HostRow | undefined): string {
  if (!row) return "";
  return row.kind === "folder" ? row.fullPath : groupPathOf(row.host);
}

/** 저장된 펼침 목록(`localStorage` 의 JSON) → 폴더 경로 집합. 모양이 어긋나면 빈 집합 */
export function parseExpandedGroups(raw: string | null): Set<string> {
  if (raw === null) return new Set();
  try {
    const v: unknown = JSON.parse(raw);
    return new Set(Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

/**
 * 폴더 이름 변경·이동(`from` → `to`) 뒤의 펼침 — `from` 과 그 아래 경로를 `to` 아래로 옮겨 적는다.
 * `to === ""`(해제)면 그 가지의 펼침을 버린다. 바뀐 것이 없으면 **같은 집합**을 돌려준다(저장을
 * 건너뛸 수 있게). 펼쳐 둔 폴더를 끌어 옮겼는데 옮긴 자리에서 접혀 있으면 "어디 갔지" 가 된다.
 */
export function rebaseExpanded(set: ReadonlySet<string>, from: string, to: string): ReadonlySet<string> {
  let changed = false;
  const next = new Set<string>();
  for (const p of set) {
    if (p === from || p.startsWith(`${from}/`)) {
      changed = true;
      if (to !== "") next.add(to + p.slice(from.length));
    } else next.add(p);
  }
  return changed ? next : set;
}

/**
 * 그 층에 이미 있는 폴더 이름들 — "폴더 추가" 의 중복 검사에 쓴다.
 * 목록을 그리는 것과 **똑같은 규칙**([`folderRows`])을 재사용하므로, 화면에 보이는 폴더와
 * "이미 있습니다" 의 기준이 갈리지 않는다.
 */
export function childFolderNames(
  list: HostEntry[],
  parent: string,
  meta: Record<string, GroupMeta>,
): Set<string> {
  const out = new Set<string>();
  for (const row of folderRows(list, parent, meta)) {
    if (row.kind === "folder") out.add(row.label);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 옮길 수 있는가 — 그룹 조작은 전부 "경로 접두사 다시 쓰기" 라 이 몇 줄이면 충분하다.
// ---------------------------------------------------------------------------

/**
 * `dragged` 그룹을 `target` 그룹 **안으로 중첩**해도 되는가.
 *
 * - 자기 자신·자손으로는 넣을 수 없다 (순환 — 트리를 제 안에 담는 꼴). 백엔드도 거부하지만
 *   `dragover` 강조와 드롭을 프런트에서 미리 막아 명백히 잘못된 호출을 아예 안 보낸다.
 * - 이미 그 그룹의 **직속 자식**이면 옮길 것이 없다 (no-op).
 */
export function canNestInto(dragged: string | null, target: string): boolean {
  if (!dragged) return false;
  if (target === dragged) return false; // 자기 자신
  if (target.startsWith(dragged + "/")) return false; // 자손 → 순환
  if (parentPath(dragged) === target) return false; // 이미 직속 자식
  return true;
}

/** 끌고 있는 폴더를 `path`(빈 문자열이면 최상위)로 옮겨도 뜻이 있는가 */
export function canDropGroupInto(dragged: string | null, path: string): boolean {
  if (!dragged) return false;
  if (path === "") return parentPath(dragged) !== ""; // 이미 최상위면 옮길 것이 없다
  return canNestInto(dragged, path);
}

/**
 * 이 짐을 `path` 로 옮기는 데 **뜻이 있는가** — 호스트가 하나라도 있으면 언제나 뜻이 있고
 * (같은 폴더로 다시 지정해도 무해하다), 폴더만 있으면 그중 하나라도 옮길 수 있어야 한다.
 * 짐을 못 보는 경우(다른 창에서 온 드래그)는 받아 두고 놓는 순간에 판정한다.
 */
export function canDropInto(payload: HostsDrag | null, path: string): boolean {
  if (!payload) return true;
  if (payload.hosts.length > 0) return true;
  return payload.groups.some((g) => canDropGroupInto(g, path));
}

/**
 * 짐을 `path` 폴더로 옮기는 **계획** — 드롭과 잘라내기 붙여넣기가 같은 값을 만든다.
 *
 * **폴더를 먼저 옮긴다.** 폴더 이동은 경로 접두사 다시 쓰기라 그 아래 호스트들의 `group`
 * 값을 함께 끌고 가는데, 그다음에 같은 호스트를 낱개로 또 옮기면 방금 만들어진 하위 구조가
 * 납작해진다. 그래서 **끌린 폴더 아래에 있던 호스트는 낱개 이동에서 뺀다** — 폴더와 그 안의
 * 호스트를 함께 골라 끄는 것은 흔한 일이고, 그때 기대는 "폴더째 옮겨진다" 이다.
 */
export function planMoveInto(
  payload: HostsDrag,
  path: string,
  list: HostEntry[],
): { renames: { from: string; to: string }[]; names: string[] } {
  const movable = payload.groups.filter((g) => canDropGroupInto(g, path));
  // 폴더 아래에 있던 호스트는 폴더와 함께 간다 (지금 목록 기준으로 미리 걸러 둔다)
  const carried = new Set<string>();
  for (const g of payload.groups) for (const h of hostsInGroup(list, g)) carried.add(h.name);
  const names = payload.hosts.filter((n) => !carried.has(n));
  // 중첩은 대상 경로 아래에 마지막 세그먼트를 붙이고(`a` → `target/a`), 홈이면 부모를
  // 통째로 떼어 최상위로 올린다 (`a/b/c` → `c`). 둘 다 접두사 다시 쓰기 한 번이다.
  const renames = movable.map((g) => ({
    from: g,
    to: path === "" ? lastSegment(g) : `${path}/${lastSegment(g)}`,
  }));
  return { renames, names };
}

/** `base` 가 `taken` 에 없으면 그대로, 있으면 `-copy` → `-copy-2` … (호스트 복제와 같은 규칙) */
export function uniqueFolderName(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let name = `${base}-copy`;
  for (let n = 2; taken.has(name); n++) name = `${base}-copy-${n}`;
  return name;
}

/** [`planPasteCopy`] 의 결과 — 무엇을 복제하고 어떤 그룹 메타를 적을지 */
export interface PasteCopyPlan {
  /** 상위(`onduplicatehosts`)에 넘길 복제 목록 — 항목마다 새 그룹 경로가 따로다 */
  items: { name: string; group: string | null }[];
  /** `set_group_meta` 로 적을 것들 (빈 폴더의 존재 증거이기도 하다) */
  metaWrites: { path: string; icon: string | null; color: string | null }[];
  /**
   * 거절한 것에 대한 안내 (자기 안으로 복사) — **문구가 아니라 문구 키**다.
   * 이 파일은 순수 모듈이라 사전을 들이지 않고, `Sidebar.svelte` 가 `t()` 로 글자를 만든다.
   */
  notices: { key: Key; params: Record<string, string> }[];
}

/**
 * **복사 붙여넣기 계획** — 호스트는 복제하고, 폴더는 그 아래를 통째로 복제한다.
 *
 * 폴더 복사는 세 가지를 함께 옮겨야 폴더답다: ①하위 호스트 전부 ②그 하위 구조
 * (`prod/web` 안의 것은 새 폴더 안에서도 `web` 아래에 있어야 한다) ③그룹 메타(아이콘·색) —
 * 아이콘까지 따라가야 눈으로 "그 폴더의 복사본" 으로 읽히고, 무엇보다 **호스트가 없는
 * 폴더는 그룹 메타 항목이 유일한 존재 증거**라 그것을 안 적으면 빈 하위 폴더가 사라진다.
 *
 * 폴더를 **자기 자신이나 자기 안으로** 복사하는 것은 막는다 — 지금 목록 스냅숏을 보고
 * 계획을 짜므로 무한히 늘어나지는 않지만, 결과가 사용자의 기대와 맞지 않는다.
 */
export function planPasteCopy(
  payload: HostsDrag,
  dest: string,
  list: HostEntry[],
  meta: Record<string, GroupMeta>,
  defaultFolderIcon: string,
): PasteCopyPlan {
  const items: PasteCopyPlan["items"] = [];
  const metaWrites: PasteCopyPlan["metaWrites"] = [];
  const notices: PasteCopyPlan["notices"] = [];
  const seen = new Set<string>();
  // 이 층에 이미 있는 폴더 이름들 — 목록을 그리는 것과 **같은 규칙**으로 센다
  const taken = childFolderNames(list, dest, meta);

  for (const g of payload.groups) {
    if (dest === g || dest.startsWith(`${g}/`)) {
      notices.push({ key: "app.hosts.paste.selfcopy", params: { name: lastSegment(g) } });
      continue;
    }
    const name = uniqueFolderName(lastSegment(g), taken);
    taken.add(name);
    const newRoot = dest === "" ? name : `${dest}/${name}`;
    for (const h of hostsInGroup(list, g)) {
      if (seen.has(h.name)) continue;
      seen.add(h.name);
      const rest = groupPathOf(h).slice(g.length).replace(/^\//, "");
      items.push({ name: h.name, group: rest ? `${newRoot}/${rest}` : newRoot });
    }
    let rooted = false;
    for (const [raw, m] of Object.entries(meta)) {
      const path = normalizeGroupPath(raw);
      if (path !== g && !path.startsWith(`${g}/`)) continue;
      const icon = m.icon?.trim() || null;
      const color = m.color?.trim() || null;
      if (!icon && !color) continue;
      const to = newRoot + path.slice(g.length);
      if (to === newRoot) rooted = true;
      metaWrites.push({ path: to, icon, color });
    }
    // 뿌리 폴더에 아이콘이 없었어도 **폴더 자체는 생겨야 한다** (빈 폴더의 존재 증거)
    if (!rooted) metaWrites.push({ path: newRoot, icon: defaultFolderIcon, color: null });
  }

  for (const n of payload.hosts) {
    if (seen.has(n)) continue; // 폴더에 딸려 이미 복제 목록에 들어갔다
    seen.add(n);
    items.push({ name: n, group: dest === "" ? null : dest });
  }

  return { items, metaWrites, notices };
}

/** 짐이 실제로 건드리는 호스트 별칭들 (폴더는 그 아래를 펼친다) */
export function affectedHosts(payload: HostsDrag, list: HostEntry[]): string[] {
  const names = new Set(payload.hosts);
  for (const g of payload.groups) for (const h of hostsInGroup(list, g)) names.add(h.name);
  return [...names];
}

/**
 * 이 폴더(와 그 하위)에 걸린 그룹 메타 경로들 — 제거할 때 치울 목록이다.
 * (아이콘을 비우면 그 항목 자체가 지워진다.)
 */
export function groupMetaPathsUnder(groups: string[], meta: Record<string, GroupMeta>): string[] {
  const out: string[] = [];
  for (const g of groups) {
    for (const raw of Object.keys(meta)) {
      const path = normalizeGroupPath(raw);
      if (path !== g && !path.startsWith(`${g}/`)) continue;
      out.push(path);
    }
  }
  return out;
}

/**
 * id 집합을 **드래그·클립보드와 같은 모양의 짐**으로 편다.
 *
 * 순서는 `order`(보이는 순서)를 훑어 만든다 — `Set` 의 순회 순서(고른 순서)를 그대로 쓰면
 * 여러 개를 열었을 때 타일이 클릭한 차례대로 놓여, 같은 것을 골라도 매번 다른 배치가 된다.
 */
export function payloadOfIds(order: readonly string[], ids: ReadonlySet<string>): HostsDrag {
  const hosts: string[] = [];
  const groups: string[] = [];
  for (const id of order) {
    if (!ids.has(id)) continue;
    if (id.startsWith("g:")) groups.push(id.slice(2));
    else hosts.push(id.slice(2));
  }
  return { hosts, groups };
}
