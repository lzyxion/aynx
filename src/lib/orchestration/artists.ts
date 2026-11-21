/**
 * 아티스트(CLI) → 캐릭터 그림 · 이름의 단 하나의 매핑. 프로필 `icon` 은 Rust `orchestration/artists.rs` 의 `icon_ok` 규칙을 따르고,
 * 지운 그림 · 모르는 값 · 프로필 없음이면 그 CLI 의 아바타로 접힌다(AI 아이콘 모양 설정과 상관없이 늘 그림).
 */

import { BUILTIN_AVATARS, avatarLibrary, avatarSrc, cliAvatarSrc } from "$lib/avatars.svelte.js";
import type { ArtistProfile } from "./artist-form";

/** 순서 = 칩 순서. `codex` 는 옛 프로필 값이라 gpt 그림의 별칭으로 남긴다 */
export const ARTIST_ICONS = ["claude", "codex", "gpt", "gemini", "grok"] as const;

export function artistIconChoices(): string[] {
  return [...ARTIST_ICONS, ...avatarLibrary.list.map((a) => `user:${a.id.slice("user-".length)}`)];
}

export interface Artist {
  cli: string;
  name: string;
  /** 없으면 `null`(첫 글자 동그라미) */
  icon: string | null;
}

/** `big` 이면 256px 원본 */
export function artistOf(cli: string | null | undefined, profile?: Pick<ArtistProfile, "name" | "icon"> | null, big = false): Artist {
  if (profile) return { cli: cli ?? "", name: profile.name, icon: avatarSrc(profile.icon, big) ?? cliAvatarSrc(cli, big) };
  switch (cli) {
    case "claude":
      return { cli, name: "Claude", icon: cliAvatarSrc(cli, big) };
    case "codex":
      return { cli, name: "Codex", icon: cliAvatarSrc(cli, big) };
    default:
      return { cli: cli ?? "", name: cli && cli.trim() ? cli : "?", icon: null };
  }
}

export function isBuiltinArtistIcon(icon: string): boolean {
  return (ARTIST_ICONS as readonly string[]).includes(icon) || (BUILTIN_AVATARS as readonly string[]).includes(icon);
}
