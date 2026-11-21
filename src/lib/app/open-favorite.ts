// `favorites.svelte.ts` 에 두지 않는다 — 그 모듈을 부르는 층을 `openProject` · `openDbConn` 이 되불러 순환이 생긴다.
import { openProject } from "$lib/app/projects.svelte.js";
import { openDbConn } from "$lib/app/db-dock.svelte.js";
import type { ResolvedFavorite } from "$lib/favorites";
import type { HostEntry } from "$lib/hosts";

export function openFavorite(fav: ResolvedFavorite, connect: (host: HostEntry) => void): void {
  if (fav.kind === "host") connect(fav.host);
  else if (fav.kind === "db") void openDbConn(fav.conn);
  else void openProject(fav.project);
}
