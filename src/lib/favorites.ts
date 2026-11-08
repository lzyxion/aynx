import type { HostEntry } from "$lib/hosts";
import type { Project } from "$lib/projects";
import type { DbDockConn } from "$lib/db-dock";

/**
 * **즐겨찾기 칸** — 규칙만 담은 순수 모듈 (docs/log/2026-09-15-start-page-favorites.md — 처음에는 시작 화면의 줄이었고,
 * 2026-10-23 부터 그리는 곳은 하단 가운데 독 하나다 · `DockFavorites.svelte`).
 *
 * 사용자가 손으로 고정해 둔 칸들이다. 브라우저 새 탭의 바로가기와 같은 물건이고, 담기는
 * 것은 세 가지다 — **호스트**(별칭 하나) · **프로젝트**(id 하나) · **DB 연결**(`db-connections.json` 의 연결 id 하나 —
 * 2026-10-23). DB 칸에는 id 말고는 아무것도 담지 않는다(주소 · 사용자 · 비밀번호 · 경유 호스트 모두 — 그릴 때 지금 목록에서 찾는다).
 *
 * ## 왜 "무엇" 이 아니라 "가리키는 말" 만 담나
 *
 * 아이콘·그룹·이름·트리를 여기 베껴 두면 사용자가 그것을 고친 뒤 이 줄만 옛 값을 보여 준다
 * (드래그 앤 드랍이 별칭만 실어 나르는 것과 **같은 규칙**). 그릴 때 [`resolveFavorites`]
 * 가 지금 목록에서 다시 찾고, **못 찾은 것은 그 자리에서 빠진다** — 저장소는 건드리지
 * 않는다: `~/.ssh/config` 에서 잠시 주석 처리한 호스트가 돌아오면 칸도 그대로 살아나는 편이
 * 낫고, 열 칸짜리 목록에 죽은 줄 하나가 남아 있는 비용은 없다.
 *
 * ## 왜 순수 모듈인가
 *
 * 이 저장소의 vitest 는 `environment: "node"` 라 `.svelte`·`.svelte.ts` 를 들여올 수 없다
 * (docs/log/2026-09-05-vitest.md). 그래서 **규칙**(이 파일)과 **상태·저장**
 * (`favorites.svelte.ts`) 과 **그리기**(`DockFavorites.svelte`)를 나눈다. 타입만 가져오는
 * `import type`은 컴파일에서 지워지므로 순수 규칙의 런타임 그래프에 상태 모듈이 남지 않는다.
 */

/**
 * 칸의 최대 개수 — 크롬의 새 탭 바로가기와 같은 **10**.
 *
 * 상한이 있는 이유는 이 줄이 한 줄에서 두 줄로 접히는 순간 "빠른 자리" 가 아니라 "또 하나의
 * 목록" 이 되기 때문이다. 넘치면 [`withFavorite`] 가 **더하지 않는다** — 가장 오래된 것을
 * 조용히 밀어내면 사용자가 손으로 고정해 둔 칸이 소리 없이 사라진다 — 자동으로 쌓이는
 * 목록이라면 밀어내는 것이 맞지만, 이 칸들은 사람이 하나씩 정해 둔 것이다.
 */
export const MAX_FAVORITES = 10;

/** 호스트 · 프로젝트 · DB 연결 참조만 남긴다. 구형 layout 항목은 parseFavorites에서 제외한다. */
export type Favorite =
  | { kind: "host"; alias: string }
  | { kind: "project"; id: string }
  | { kind: "db"; id: string };

/**
 * 목록 안에서 한 칸을 가리키는 글자 (`host:web-01` · `project:P3f2…` · `db:<연결 id>`).
 *
 * `{#each}` 의 키이자 중복 판정의 기준이다 — 종류를 접두사로 붙이지 않으면 별칭이 `L3f2`
 * 인 호스트와 그 id 의 프로젝트가 같은 칸으로 읽힌다.
 */
export function favoriteKey(fav: Favorite): string {
  if (fav.kind === "host") return `host:${fav.alias}`;
  if (fav.kind === "db") return `db:${fav.id}`;
  return `project:${fav.id}`;
}

/** 같은 칸인가 */
export function sameFavorite(a: Favorite, b: Favorite): boolean {
  return favoriteKey(a) === favoriteKey(b);
}

/** 이미 고정된 칸인가 (고르개가 줄을 비활성으로 그리는 판정) */
export function hasFavorite(list: readonly Favorite[], fav: Favorite): boolean {
  const key = favoriteKey(fav);
  return list.some((f) => favoriteKey(f) === key);
}

/**
 * 칸 하나를 **`beforeKey` 칸 바로 앞에** 끼운 새 목록. `beforeKey` 가 없거나(`null`) 목록에 없는 키면 **맨 뒤**다.
 *
 * 자리를 고르는 길은 하단 독으로 끌어다 놓기다(2026-10-23 부터 놓은 자리에 들어간다). 자리를 말하지 않으면 뒤인
 * 이유는 크롬과 같다 — 앞에 끼워 넣으면 이미 외운 칸들의 자리가 통째로 한 칸씩 밀린다. 계약은 [`reorderFavorites`] 와 같다
 * (키 = 그 칸 앞 · `null` = 맨 뒤).
 * 이미 있는 칸이거나 [`MAX_FAVORITES`] 를 채웠으면 **같은 배열을 그대로** 돌려준다
 * (호출부가 `=== ` 로 "바뀐 게 없다" 를 알 수 있고, 새 배열을 만들면 이 목록을 읽는 화면이
 * 공연히 다시 그려진다 — 이 저장소의 목록 함수들이 공유하는 규칙이다).
 */
export function withFavorite(
  list: readonly Favorite[],
  fav: Favorite,
  beforeKey: string | null = null,
): readonly Favorite[] {
  if (!validFavorite(fav)) return list;
  if (hasFavorite(list, fav)) return list;
  if (list.length >= MAX_FAVORITES) return list;
  const at = beforeKey === null ? -1 : list.findIndex((f) => favoriteKey(f) === beforeKey);
  if (at < 0) return [...list, fav];
  return [...list.slice(0, at), fav, ...list.slice(at)];
}

/** [`withFavorites`] 의 결과 — 새 목록과, 짐의 칸들이 저마다 어떻게 되었는가 */
export interface AddFavoritesResult {
  /** 새 목록 — 더한 것이 없으면 들어온 배열 그대로 */
  list: readonly Favorite[];
  /** 실제로 더한 칸(짐의 순서) */
  added: Favorite[];
  /** 이미 있어 조용히 넘긴 칸 */
  existing: Favorite[];
  /** 열 칸이 차서 멈췄는가 — 호출부가 한 줄로 알린다 */
  full: boolean;
}

/**
 * 짐 하나(호스트 여러 개를 함께 끈 것 등)를 **`beforeKey` 앞에 짐의 순서대로** 더한다. 이미 있는 칸은 조용히 넘기고(`existing`),
 * 열 칸이 차면 거기서 멈춘다(`full` — 옛 시작 화면 줄의 `addAll` 규칙 그대로). 빈 별칭 · 빈 id 는 아무 데도 세지 않는다.
 */
export function withFavorites(
  list: readonly Favorite[],
  items: readonly Favorite[],
  beforeKey: string | null = null,
): AddFavoritesResult {
  let next = list;
  const added: Favorite[] = [];
  const existing: Favorite[] = [];
  let full = false;
  for (const fav of items) {
    if (!validFavorite(fav)) continue;
    if (hasFavorite(next, fav)) {
      existing.push(fav);
      continue;
    }
    if (next.length >= MAX_FAVORITES) {
      full = true;
      break;
    }
    next = withFavorite(next, fav, beforeKey);
    added.push(fav);
  }
  return { list: next, added, existing, full };
}

/**
 * 호스트 별칭 하나가 **이름이 바뀌었을 때** 따라가는 새 목록 (바뀔 것이 없으면 같은 배열).
 *
 * 이 칸들은 별칭 **글자**를 담고 있고([`Favorite`]), [`resolveFavorites`] 는 그 글자로 지금
 * 목록에서 호스트를 찾는다. 그래서 `~/.ssh/config` 의 이름이 바뀌면 칸은 가리키는 것을 잃고
 * 독에서 **말없이 사라진다** (지우지는 않으니 이름을 되돌리면 돌아오지만, 사용자에게는
 * 그냥 없어진 것이다). 이름 변경 경로가 이 함수를 지나면 그 자리가 메워진다
 * (docs/log/2026-09-17-host-rename-fanout.md).
 *
 * 규칙 셋:
 *  · **찾는 것은 대소문자를 무시한다** — 별칭 비교의 기준이 저장소 전체에서 그렇다
 *    (`nextCopyAlias`·`layoutNamed`·이름 변경 판정). 새로 적히는 글자는 사람이 친 그대로다.
 *  · **중복을 만들지 않는다** — `to` 칸이 이미 있으면 옛 칸은 새 칸이 되지 못하고 **빠진다**
 *    (먼저 있던 칸이 자리를 지킨다 — [`parseFavorites`] 의 "중복은 앞의 것이 이긴다" 와 같다).
 *  · **순서는 그대로**다. 이름이 바뀌었다고 사람이 정해 둔 자리가 움직일 이유가 없다.
 */
export function withRenamedHost(
  list: readonly Favorite[],
  from: string,
  to: string,
): readonly Favorite[] {
  const oldKey = from.trim().toLowerCase();
  const alias = to.trim();
  if (oldKey === "" || alias === "") return list;
  const isOld = (fav: Favorite) => fav.kind === "host" && fav.alias.trim().toLowerCase() === oldKey;
  if (!list.some(isOld)) return list;

  const renamed: Favorite = { kind: "host", alias };
  const out: Favorite[] = [];
  const seen = new Set<string>();
  for (const fav of list) {
    const next = isOld(fav) ? renamed : fav;
    const key = favoriteKey(next);
    if (seen.has(key)) continue; // 이름 변경이 만든 중복 — 앞의 칸이 이긴다
    seen.add(key);
    out.push(next);
  }
  return out;
}

/** 칸 하나를 뺀 새 목록 (없으면 같은 배열 그대로) */
export function withoutFavorite(list: readonly Favorite[], fav: Favorite): readonly Favorite[] {
  const key = favoriteKey(fav);
  const next = list.filter((f) => favoriteKey(f) !== key);
  return next.length === list.length ? list : next;
}

/**
 * `fromKey` 칸을 **`toKey` 칸 바로 앞으로** 옮긴 새 목록. `toKey` 가 `null` 이면 맨 뒤로.
 *
 * 상태바 선두단(`status-items.ts` 의 [`reorder`])·탭 스트립(`Tabs.svelte` 의
 * `dropBefore`/`dropEnd`)과 **같은 계약**이다 — 세 줄이 같은 몸짓을 쓰므로 규칙이 갈리면
 * 안 된다. 다루는 값이 id 가 아니라 [`favoriteKey`] 인 것만 다르다 (칸의 신원이 종류 +
 * 가리키는 말이라 키 하나로 합쳐 두었다).
 *
 * 아무것도 달라지지 않는 경우(같은 칸으로 놓기·모르는 키·이미 그 자리)에는 **같은 배열을
 * 그대로** 돌려준다 — 호출부가 `===` 로 "바뀐 게 없다" 를 알 수 있고, 새 배열을 만들면 이
 * 목록을 읽는 화면이 공연히 다시 그려진다 ([`withFavorite`] 과 같은 규칙).
 */
export function reorderFavorites(
  list: readonly Favorite[],
  fromKey: string,
  toKey: string | null,
): readonly Favorite[] {
  if (fromKey === toKey) return list;
  const from = list.findIndex((f) => favoriteKey(f) === fromKey);
  if (from < 0) return list;
  if (toKey !== null && !list.some((f) => favoriteKey(f) === toKey)) return list;
  const rest = list.filter((f) => favoriteKey(f) !== fromKey);
  const at = toKey === null ? rest.length : rest.findIndex((f) => favoriteKey(f) === toKey);
  const next = [...rest.slice(0, at), list[from], ...rest.slice(at)];
  const same = next.every((fav, i) => favoriteKey(fav) === favoriteKey(list[i]));
  return same ? list : next;
}

/** 모양이 성한 칸인가 — 빈 별칭·빈 id 는 가리키는 것이 없다 */
function validFavorite(fav: Favorite): boolean {
  return fav.kind === "host" ? fav.alias.trim() !== "" : fav.id.trim() !== "";
}

/**
 * 저장된 원시 값 → 믿을 수 있는 목록. **절대 throw 하지 않는다** — 모양이 어긋난 항목은
 * 조용히 버리고, 파일 전체를 버리지는 않는다 (`parseLayoutFile` 과 같은 판정: 칸들은 서로
 * 독립이라 하나가 깨졌다고 나머지 아홉을 함께 잃을 이유가 없다).
 */
export function parseFavorites(raw: string | null | undefined): Favorite[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: Favorite[] = [];
  const seen = new Set<string>();
  for (const item of data) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    let fav: Favorite | null = null;
    if (o.kind === "host" && typeof o.alias === "string" && o.alias.trim() !== "") {
      fav = { kind: "host", alias: o.alias.trim() };
    } else if (o.kind === "project" && typeof o.id === "string" && o.id.trim() !== "") {
      fav = { kind: "project", id: o.id.trim() };
    } else if (o.kind === "db" && typeof o.id === "string" && o.id.trim() !== "") {
      fav = { kind: "db", id: o.id.trim() };
    }
    if (!fav) continue;
    const key = favoriteKey(fav);
    if (seen.has(key)) continue; // 중복은 앞의 것이 이긴다 (순서가 곧 자리다)
    seen.add(key);
    out.push(fav);
    if (out.length >= MAX_FAVORITES) break;
  }
  return out;
}

/**
 * 목록 → 저장 문자열 — **순수 함수**. 같은 목록이면 같은 글자가 나와야 하므로 (저장 전
 * 비교가 이 결과를 쓴다) 키 순서를 고정하고 종류마다 필요한 칸만 담는다.
 */
export function serializeFavorites(list: readonly Favorite[]): string {
  return JSON.stringify(
    list.map((f) => (f.kind === "host" ? { kind: "host", alias: f.alias } : { kind: f.kind, id: f.id })),
  );
}

/** 그릴 준비가 된 칸 하나 — 가리키는 말이 아니라 **지금 목록에서 찾은 실물**이 들어 있다 */
export type ResolvedFavorite =
  | { key: string; fav: Favorite; kind: "host"; host: HostEntry }
  | { key: string; fav: Favorite; kind: "project"; project: Project }
  | { key: string; fav: Favorite; kind: "db"; conn: DbDockConn };

/** 칸의 이름 — 호스트 별칭 · 프로젝트 이름 · DB 연결 이름. 하단 독 칸의 메뉴 이름표가 쓴다 */
export function favoriteName(fav: ResolvedFavorite): string {
  if (fav.kind === "host") return fav.host.name;
  if (fav.kind === "db") return fav.conn.name;
  return fav.project.name;
}

/**
 * 칸의 말풍선 — 프로젝트는 어디의 것인지(`로컬` · 호스트 별칭)를 덧붙이고, DB 연결은 쿼리 타일 머리줄과 같은 이름
 * (`이름 · 경유 호스트` — `DbDockConn.tabName`)이다. 하단 독 칸의 말풍선이다
 * (문구 함수는 받아 쓴다 — 이 모듈은 순수하다).
 */
export function favoriteTitle(
  fav: ResolvedFavorite,
  tr: (key: "app.projects.start.fav.title" | "app.projects.badge.local", params?: Record<string, string>) => string,
): string {
  if (fav.kind === "host") return fav.host.name;
  if (fav.kind === "db") return fav.conn.tabName;
  const host = fav.project.host?.trim() ?? "";
  return tr("app.projects.start.fav.title", {
    name: fav.project.name,
    where: host !== "" ? host : tr("app.projects.badge.local"),
  });
}

/**
 * 저장된 칸들 → 지금 그릴 수 있는 칸들. **순서는 그대로**이고, 가리키는 것이 사라진 칸은
 * 결과에서 빠진다 (지우지는 않는다 — 이 파일 머리 주석). DB 연결은 독 DB 칸의 줄(`DbDockConn` — 부르는 쪽이
 * `dbDockConn` 으로 지어 넘긴다)에서 id 로 찾는다.
 */
export function resolveFavorites(
  favs: readonly Favorite[],
  hosts: readonly HostEntry[],
  projects: readonly Project[] = [],
  dbs: readonly DbDockConn[] = [],
): ResolvedFavorite[] {
  const byAlias = new Map(hosts.map((h) => [h.name, h]));
  const byProject = new Map(projects.map((p) => [p.id, p]));
  const byDb = new Map(dbs.map((c) => [c.id, c]));
  const out: ResolvedFavorite[] = [];
  for (const fav of favs) {
    const key = favoriteKey(fav);
    if (fav.kind === "host") {
      const host = byAlias.get(fav.alias);
      if (host) out.push({ key, fav, kind: "host", host });
    } else if (fav.kind === "db") {
      // DB 연결 — 지운 연결의 칸도 같은 규칙으로 그리지 않는다(삭제 흐름은 저장에서도 뺀다 — `app/db-conns` 의 `forgetDbFavorites`)
      const conn = byDb.get(fav.id);
      if (conn) out.push({ key, fav, kind: "db", conn });
    } else {
      // 프로젝트 — 지운 프로젝트의 칸은 호스트·레이아웃과 같은 규칙으로 **그리지 않는다**(지우지 않는다)
      const project = byProject.get(fav.id);
      if (project) out.push({ key, fav, kind: "project", project });
    }
  }
  return out;
}
