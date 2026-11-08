/**
 * **아티스트(CLI) → 캐릭터 그림 · 이름**(2026-10-29 오케스트레이션 탭 — 노트 5-1 · 사용자 결정 P4).
 *
 * 앨범 판(커버 · 참여 아티스트 · 트랙 줄)과 재생 막대가 쓰는 **단 하나의 매핑**이다 — 부르는 쪽은 `artistOf(cli)` 만 안다. 그림은
 * 아바타 라이브러리(`$lib/avatars.svelte` — 2026-10-31, docs/log/2026-10-31-avatars.md)에서 푼다:
 *
 * - 프로필의 `icon` — 내장 낱말(`claude` · `codex`(= gpt 그림) · `gpt` · `gemini` · `grok`) 또는 사용자 아바타 `user:<12hex>`(Rust
 *   `orchestration/artists.rs` 의 `icon_ok` 규칙 그대로). 지운 그림 · 모르는 값이면 그 CLI 의 얼굴로 접힌다.
 * - 프로필이 없으면(프로듀서 · 옛 Run) 그 CLI 의 얼굴 = 설정 › 테마 › 아바타의 CLI 별 아바타(기본 claude → claude · codex → gpt).
 *   이 얼굴은 "AI 아이콘 모양"(로고 / 아바타)과 상관없이 늘 그림이다(플레이어 화면은 캐릭터가 주인공이다).
 *
 * 모르는 CLI 는 그림 없이(`icon: null`) 이름 첫 글자로 그린다.
 */

import { BUILTIN_AVATARS, avatarLibrary, avatarSrc, cliAvatarSrc } from "$lib/avatars.svelte.js";
import type { ArtistProfile } from "./artist-form";

/** 아티스트 아이콘 팝오버의 내장 낱말 — 순서 = 칩 순서(`codex` 는 gpt 그림의 별칭으로 남긴다 — 옛 프로필 값) */
export const ARTIST_ICONS = ["claude", "codex", "gpt", "gemini", "grok"] as const;

/** 아이콘 팝오버에 늘어놓을 값 — 내장 낱말 뒤에 사용자 아바타(`user:<12hex>` — 넣은 순서) */
export function artistIconChoices(): string[] {
  return [...ARTIST_ICONS, ...avatarLibrary.list.map((a) => `user:${a.id.slice("user-".length)}`)];
}

export interface Artist {
  /** CLI 낱말 그대로(`claude` · `codex` · 모르는 값) */
  cli: string;
  /** 화면 이름 */
  name: string;
  /** 캐릭터 그림 URL — 없으면 `null`(첫 글자 동그라미) */
  icon: string | null;
}

/** CLI → 아티스트(캐릭터 · 이름). `big` 이면 256px 원본(큰 얼굴 자리) */
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

/** 내장 아바타 낱말인가(아티스트 아이콘 팝오버의 이름표) */
export function isBuiltinArtistIcon(icon: string): boolean {
  return (ARTIST_ICONS as readonly string[]).includes(icon) || (BUILTIN_AVATARS as readonly string[]).includes(icon);
}
