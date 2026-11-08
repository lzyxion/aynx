// 원격 거울의 탭 명세는 쓰지 않는다. 초안 경로와 시작 직후 채팅은 이 창에서만 보여 준다.
import type { OrchMark, TabSpec } from "$lib/session";
import type { AlbumFork } from "$lib/orchestration/album-draft";
import type { ProducerTarget } from "./producer-chat.svelte.js";
import { orchPath } from "$lib/orchestration/orch-tab";

// homeDraft와 같은 상수 프록시다. 바인딩 재할당 없이 탭별 속성만 쓰고 지운다.
export const albumScreens = $state<Record<string, { path?: OrchMark; draftId?: string; repo?: string; repoLocked?: boolean; fork?: AlbumFork; producer?: ProducerTarget }>>({});
export function orchScreenPath(tab: TabSpec): OrchMark { return albumScreens[tab.id]?.path ?? orchPath(tab); }
