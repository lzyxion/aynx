// 라이브러리의 [정리]만 앨범 판에 요청한다. 트랙 진입은 경로 이동을 쓴다.
export interface AlbumCleanupRequest { runId: string; n: number; }
let request = $state<AlbumCleanupRequest | null>(null);
let sequence = 0;
export function requestAlbumCleanup(runId: string): void { request = { runId, n: ++sequence }; }
export function albumCleanupRequest(): AlbumCleanupRequest | null { return request; }
