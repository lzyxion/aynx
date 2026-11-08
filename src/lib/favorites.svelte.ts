import {
  parseFavorites,
  reorderFavorites,
  serializeFavorites,
  withFavorites,
  withRenamedHost,
  withoutFavorite,
  type AddFavoritesResult,
  type Favorite,
} from "$lib/favorites";

/**
 * **즐겨찾기 목록의 상태와 저장** (docs/log/2026-09-15-start-page-favorites.md).
 *
 * 규칙(중복·상한·검증·해석)은 전부 순수 모듈 `favorites.ts` 에 있고, 여기 남은 것은 둘뿐이다
 * — **창에 하나뿐인 반응형 목록**과 **localStorage 왕복**.
 *
 * ## 왜 localStorage 인가
 *
 * 이 값은 **이 컴퓨터에서 이 사람이 무엇을 고정해 두었는가** 라는 화면 편의값이라
 * `~/.ssh/` 아래 파일에 끼워 넣을 것도, 다른 도구와 나눌 것도 아니다. 배치 파일(`workspaces.json`)에 넣기에는 수명이 다르고 (탭을 다 닫아도
 * 즐겨찾기는 남아야 한다), 그렇다고 백엔드 명령을 새로 파면 마이그레이션이 따라온다.
 * 웹뷰의 localStorage 는 **창이 아니라 앱(오리진) 단위**라 창을 새로 띄워도 같은 칸이 뜬다.
 *
 * 읽기·쓰기를 **전부 try/catch 로 감싼다** — 프라이빗 모드·할당량 초과·정책으로 막힌
 * 환경에서는 접근 자체가 throw 한다. 없어도 되는 편의값이므로 조용히 포기한다.
 *
 * ## 끌어서 자리 바꾸기 ([`moveFavorite`])
 *
 * 처음 판에는 없었다("빼고 다시 더하기" 로 낼 수 있는 순서라 미뤘다). 지금은 있다 —
 * 더하는 길이 **끌어다 놓기** 가 되면서(독에서 칸으로) 같은 줄에서 끌어 옮기는 몸짓을
 * 기대하지 않을 도리가 없어졌다. 규칙은 상태바 선두단과 같은 순수 함수
 * ([`reorderFavorites`])에 있고, 짐의 종류(mime)로 "더하는 드래그" 와 갈린다.
 */

/** localStorage 키 — 앱 접두사를 붙여 다른 저장값과 섞이지 않게 한다 (`aynx:status-order` 와 같은 꼴) */
const STORAGE_KEY = "aynx:favorites";

function load(): Favorite[] {
  try {
    if (typeof localStorage === "undefined") return [];
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = parseFavorites(raw);
    // 이관된 레이아웃 즐겨찾기는 백업하고 정리한다. 깨진 localStorage는 조용히 건너뛴다.
    if (raw && Array.isArray(JSON.parse(raw)) && JSON.parse(raw).some((f: { kind?: string } | null) => f?.kind === "layout")) {
      try {
        if (localStorage.getItem("aynx:favorites-before-workspaces") === null)
          localStorage.setItem("aynx:favorites-before-workspaces", raw);
        localStorage.setItem(STORAGE_KEY, serializeFavorites(parsed));
      } catch { /* 저장을 못 해도 이번 창은 정리된 메모리 목록을 쓴다 */ }
    }
    return parsed;
  } catch {
    return [];
  }
}

function persist(list: readonly Favorite[]): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY, serializeFavorites(list));
  } catch {
    /* 쓰기 실패는 무시한다 — 이번 실행 동안의 메모리 값은 그대로 쓴다 */
  }
}

/**
 * 고정된 순서 그대로의 목록. **모듈 하나에 하나**다 — 창 안에서 이 목록을 읽는 곳(하단 독 · 팬아웃)은 모두 같은 값을
 * 본다 (`status-order.svelte.ts` 와 같은 모양의 모듈 상태).
 */
let list = $state<Favorite[]>(load());

/** 지금 목록 (고정한 순서). 읽기는 반응형이라 더하고 빼는 즉시 화면이 따라온다 */
export function favorites(): readonly Favorite[] {
  return list;
}

/**
 * 짐의 칸들을 **`beforeKey` 칸 앞에**(`null` = 맨 뒤) 더하고, 무엇이 더해졌는지 돌려준다([`withFavorites`] — 중복은 넘기고 열 칸에서
 * 멈춘다). 더한 것이 없으면 저장도 하지 않는다. 부르는 자리는 끌어다 놓기 하나다(`app/favorite-drop.ts` — 하단 독).
 */
export function addFavorites(items: readonly Favorite[], beforeKey: string | null = null): AddFavoritesResult {
  const result = withFavorites(list, items, beforeKey);
  if (result.list !== list) {
    list = [...result.list];
    persist(list);
  }
  return result;
}

/** 칸 하나를 뺀다 — 호스트·레이아웃 자체는 그대로다 (가리키는 말만 지운다) */
export function removeFavorite(fav: Favorite): void {
  const next = withoutFavorite(list, fav);
  if (next === list) return;
  list = [...next];
  persist(list);
}

/**
 * 호스트 별칭이 바뀌었다 — 그 별칭을 가리키던 칸을 새 이름으로 고친다.
 * 바뀐 것이 없으면 저장도 하지 않는다 ([`withRenamedHost`] 가 같은 배열을 돌려준다).
 *
 * 부르는 자리는 이름 변경 팬아웃 하나다 (`app/host-rename.svelte.ts`) — 규칙은 순수 층에
 * 있고 여기서 하는 일은 목록 교체와 저장뿐이다.
 */
export function renameFavoriteHost(from: string, to: string): boolean {
  const next = withRenamedHost(list, from, to);
  if (next === list) return false;
  list = [...next];
  persist(list);
  return true;
}

/**
 * 칸 하나를 **다른 칸 앞으로** 옮긴다 (`toKey` 가 `null` 이면 맨 뒤로).
 *
 * 인자가 [`favoriteKey`] 문자열인 이유는 드래그가 실어 나르는 것이 그 키이기 때문이다 —
 * 짐에 칸 전체를 담으면 놓는 순간의 목록과 어긋날 수 있다. 달라지는 것이 없으면
 * ([`reorderFavorites`] 가 같은 배열을 돌려주면) 저장도 하지 않는다.
 */
export function moveFavorite(fromKey: string, toKey: string | null): void {
  const next = reorderFavorites(list, fromKey, toKey);
  if (next === list) return;
  list = [...next];
  persist(list);
}
