/**
 * 앨범 표지의 얼굴 — 앨범 머리와 재생 막대가 같이 쓴다. 참여 아티스트(앨범 구성 · 없으면 Run 에 나온 CLI), 아무도 없으면 프로듀서 · 둘까지.
 */
import { albumArtists, type RunDetail } from "../model";
import { artistOf } from "../artists";

export interface AlbumMember<P> {
  id: string;
  cli: string;
  name: string;
  judge: boolean;
  profile: P | undefined;
}

/** 이 앨범의 아티스트 줄 — 프로필이 지워졌으면 앨범에 남은 이름 · 역할의 CLI 로 */
export function albumMembers<P extends { id: string; cli: string; name: string; kind: string }>(
  detail: RunDetail,
  profiles: readonly P[],
): AlbumMember<P>[] {
  if (detail.album) {
    return detail.album.members.map((m) => {
      const profile = profiles.find((a) => a.id === m.artist);
      return {
        id: m.artist,
        cli: profile?.cli ?? detail.roles?.find((r) => r.id === m.artist)?.cli ?? "",
        name: profile?.name ?? m.name,
        judge: profile?.kind === "judge",
        profile,
      };
    });
  }
  return albumArtists(detail).map((a) => ({ id: a.cli, cli: a.cli, name: artistOf(a.cli).name, judge: false, profile: undefined }));
}

/** 표지 얼굴 둘까지 — 왼쪽 위 큰 얼굴 · 오른쪽 아래 작은 얼굴 */
export function albumFaces<P>(members: readonly AlbumMember<P>[], producerCli: string | null): AlbumMember<P>[] {
  const list = [...members];
  if (list.length === 0 && producerCli) {
    list.push({ id: producerCli, cli: producerCli, name: artistOf(producerCli).name, judge: false, profile: undefined });
  }
  return list.slice(0, 2);
}
