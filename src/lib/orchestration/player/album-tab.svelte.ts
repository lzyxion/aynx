// 앨범 화면 트랙 표 아래의 고른 탭(타임라인 · 한도 — 목업 V3FoldA · 트랙 표는 탭 밖 위에 늘 보인다). **창 메모리**만 — 화면을 떠났다 돌아와도(트랙 → ← · 다른 앨범 → 이 앨범)
// 그 앨범에서 고른 탭이 남는다. 창을 다시 띄우면(F5 포함) 타임라인으로 돌아간다(저장하지 않는다 — 보기 취향일 뿐이다).
export type AlbumTab = "timeline" | "limits";

const tabs = $state<Record<string, AlbumTab>>({});

export function albumTabOf(runId: string | null | undefined): AlbumTab {
  return (runId && tabs[runId]) || "timeline";
}

export function setAlbumTab(runId: string | null | undefined, tab: AlbumTab): void {
  if (runId) tabs[runId] = tab;
}
