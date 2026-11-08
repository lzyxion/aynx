// 즐겨찾기 칸 **하나를 연다** — 하단 독의 즐겨찾기 칸(`DockFavorites.svelte`)이 지나는 길(2026-10-13 · 시작 화면 줄은 2026-10-23 에 걷었다).
//
// 목록과 저장은 `favorites.svelte.ts`(창에 하나뿐인 모듈 상태 · localStorage), 규칙은 순수 `favorites.ts` 다. 여기는 여는
// 일 하나 — 호스트는 호스트 독의 "접속"(`hostActions().onconnect` — 컨텍스트라 부르는 컴포넌트가 꺼내 넘긴다), 프로젝트는
// 독의 열기(`openProject` — 여기 열려 있으면 그 탭 · 타일로, 아니면 새 탭), DB 연결은 독 DB 줄의 더블 클릭 · Enter 와 같은
// `openDbConn`(지금 워크스페이스에 그 연결의 쿼리 타일이 있으면 그리로, 없으면 지금 탭에 새로). 독 줄과 따로 적으면 "어디서 연
// 것" 에 따라 규칙이 갈린다. `favorites.svelte.ts` 에 두지 않는 까닭: 그 모듈은 호스트 제거 팬아웃(`app/host-remove.ts`) ·
// DB 연결 삭제(`app/db-conns`)가 부르는데 `openProject` · `openDbConn` 쪽이 그 층들을 되불러 순환이 생긴다.
import { openProject } from "$lib/app/projects.svelte.js";
import { openDbConn } from "$lib/app/db-dock.svelte.js";
import type { ResolvedFavorite } from "$lib/favorites";
import type { HostEntry } from "$lib/hosts";

export function openFavorite(fav: ResolvedFavorite, connect: (host: HostEntry) => void): void {
  if (fav.kind === "host") connect(fav.host);
  else if (fav.kind === "db") void openDbConn(fav.conn);
  else void openProject(fav.project);
}
