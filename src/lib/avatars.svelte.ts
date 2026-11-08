// **아바타 풀기 한 곳** — 아바타 id → 그림 URL (docs/log/2026-10-31-avatars.md).
//
// 아바타 라이브러리 = 앱 아이콘의 후보 그대로다 — 내장 넷(`claude` · `gemini` · `gpt` · `grok` — 번들 자산)과 사용자 그림
// (`user-<12hex>` — Rust `app_icon.rs` · `app_icon/user.rs` 가 `<설정 루트>/app-icons/` 에 두는 파일). 같은 id 를 앱 아이콘
// (`[app] app_icon`) · AI CLI 별 아바타(`[ai] avatar_claude` · `avatar_codex`) · 오케스트레이션 아티스트(`icon = "user:<12hex>"` — 쌍점
// 표기는 Rust `artists.rs` 의 규칙이라 여기서 같은 그림으로 푼다)가 함께 쓴다.
//
// 불변식:
// - 그림을 웹뷰에 주는 길은 data URL 뿐이다 — 96px 썸네일 목록(`app_icon_list`, 부팅 때 한 번 · 설정 화면이 붙을 때 · 다른 창의 설정
//   저장 때 다시 읽는다)과 256px 원본 한 장(`app_icon_image`, 크게 그리는 자리가 처음 부를 때 한 번 읽어 이 창에 든다). asset 프로토콜
//   범위는 넓히지 않는다. 원격 웹 클라이언트도 둘 다 읽는다(`remote/deny.rs` 의 허용 표 — 넣기 · 지우기는 미지원).
// - **모르는 id · 지운 그림은 기본으로 접는다** — 목록에 없는 사용자 id 는 `null`(부르는 쪽이 기본 그림이나 로고로 떨어진다). 설정 값은
//   그대로 둔다(되살릴 일은 없지만 고치는 것은 사람의 [저장] 이다 — 앱 아이콘과 같은 규칙).
// - "AI 아이콘 모양"(`[ai] icon_style` — 로고 / 아바타)은 전역 한 칸이다. 그 값을 읽어 로고와 아바타 중 하나를 고르는 자리는
//   [`aiAvatarSrc`] 하나이고, 그리는 컴포넌트는 `AiGlyph.svelte` 하나다(탭 · 머리줄 · 독/런처 · 채팅 독 · 앱 안 알림이 지난다 —
//   AI 로딩 덮개 `term/AiVeil.svelte` 는 큰 그림이라 같은 함수를 `big` 으로 부른다).
import { invoke } from "$lib/ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { settings } from "$lib/settings/model/store.svelte.js";
import { DEFAULT_AI_AVATARS, isUserAppIconId } from "$lib/settings/model/options";
import claudeThumb from "$lib/assets/app-icons/claude.png";
import geminiThumb from "$lib/assets/app-icons/gemini.png";
import gptThumb from "$lib/assets/app-icons/gpt.png";
import grokThumb from "$lib/assets/app-icons/grok.png";
import claudeFull from "../../src-tauri/icons/characters/claude.png";
import geminiFull from "../../src-tauri/icons/characters/gemini.png";
import gptFull from "../../src-tauri/icons/characters/gpt.png";
import grokFull from "../../src-tauri/icons/characters/grok.png";

/** Rust `app_icon_list` · `app_icon_add` 의 한 줄 — id · 96px 썸네일 data URL · 사람이 붙인 이름(없으면 `null` — 화면은 "사용자 N") ·
 *  넣은 때(유닉스 밀리초 · 모르면 `null`). 이름은 `<설정 루트>/app-icons/names.json`(Rust `app_icon/user.rs`) */
export interface UserAvatar {
  id: string;
  src: string;
  name?: string | null;
  added?: number | null;
}

/** 내장 아바타 — 순서 = 고르기 칩 순서(앱 아이콘의 기본 `gpt` 가 앞 — `APP_ICONS` 와 같은 순서) */
export const BUILTIN_AVATARS = ["gpt", "claude", "gemini", "grok"] as const;
export type BuiltinAvatar = (typeof BUILTIN_AVATARS)[number];

const THUMB: Record<BuiltinAvatar, string> = { claude: claudeThumb, gemini: geminiThumb, gpt: gptThumb, grok: grokThumb };
const FULL: Record<BuiltinAvatar, string> = { claude: claudeFull, gemini: geminiFull, gpt: gptFull, grok: grokFull };

/** 내장 아바타 하나의 96px 썸네일 — 고르기 칩이 그린다 */
export function builtinAvatarThumb(id: BuiltinAvatar): string {
  return THUMB[id];
}

/** 이 창이 아는 사용자 아바타 — 넣은 순서. `loaded` 는 한 번이라도 읽었는가(읽기 전에는 사용자 id 가 잠시 기본으로 보인다) */
export const avatarLibrary = $state({
  list: [] as UserAvatar[],
  loaded: false,
});

/** 사용자 아바타의 256px 원본(id → data URL) — 크게 그리는 자리가 처음 부를 때 채운다 */
const fullSrc = $state<Record<string, string>>({});
const fullAsked = new Set<string>();

/** 목록을 다시 읽는다. 실패는 던진다(설정 화면이 한 줄로 알린다 — 부팅 · 동기화는 삼킨다) */
export async function loadAvatars(): Promise<void> {
  avatarLibrary.list = await invoke<UserAvatar[]>("app_icon_list");
  avatarLibrary.loaded = true;
  // 지운 그림의 큰 사본은 버린다(같은 id 를 다시 넣으면 같은 그림이라 남겨도 되지만 기억을 줄인다)
  for (const id of Object.keys(fullSrc)) {
    if (!avatarLibrary.list.some((a) => a.id === id)) {
      delete fullSrc[id];
      fullAsked.delete(id);
    }
  }
}

/** 부팅 · 다른 창의 설정 저장 — 실패를 삼킨다(그동안 사용자 아바타는 기본으로 접혀 보인다) */
export async function refreshAvatars(): Promise<void> {
  try {
    await loadAvatars();
  } catch (e) {
    console.warn("[aynx] 아바타 목록을 읽지 못했습니다 (무시):", e);
  }
}

/**
 * 받은 값을 **라이브러리 id** 로 — 내장 키 · `user-<12hex>` 는 그대로, 아티스트의 `user:<12hex>` 는 `user-` 로, 아티스트 낱말
 * `codex` 는 그 그림(`gpt`)으로. 그 밖은 `null`.
 */
export function avatarId(raw: string | null | undefined): string | null {
  const s = raw?.trim() ?? "";
  if ((BUILTIN_AVATARS as readonly string[]).includes(s)) return s;
  if (s === "codex") return "gpt";
  if (s.startsWith("user:")) {
    const id = `user-${s.slice("user:".length)}`;
    return isUserAppIconId(id) ? id : null;
  }
  return isUserAppIconId(s) ? s : null;
}

/**
 * 아바타 id → 그림 URL. `big` 이면 256px 원본(사용자 그림은 처음 한 번 읽는 동안 썸네일). **목록에 없는 사용자 id · 모르는 값은
 * `null`** — 부르는 쪽이 기본으로 떨어진다.
 */
export function avatarSrc(raw: string | null | undefined, big = false): string | null {
  const id = avatarId(raw);
  if (id === null) return null;
  if (!isUserAppIconId(id)) return (big ? FULL : THUMB)[id as BuiltinAvatar];
  const entry = avatarLibrary.list.find((a) => a.id === id);
  if (!entry) return null;
  if (!big) return entry.src;
  const full = fullSrc[id];
  if (full) return full;
  if (!fullAsked.has(id)) {
    fullAsked.add(id);
    void invoke<string | null>("app_icon_image", { id })
      .then((url) => {
        if (url) fullSrc[id] = url;
      })
      .catch(() => {
        fullAsked.delete(id); // 다음에 다시 묻는다 — 그동안은 썸네일
      });
  }
  return entry.src;
}

/**
 * 라이브러리 그림의 **화면 이름** — 내장은 옵션 이름(`settings.option.app_icon.*`), 사용자 그림은 붙인 이름, 없으면 "사용자 N"(N = 넣은
 * 순서의 자리). 목록에 없는 id 는 `null`. 설정 › 테마 › 아바타 · 아티스트 아이콘 팝오버가 같은 이름을 쓴다.
 */
export function avatarLabel(raw: string | null | undefined): string | null {
  const id = avatarId(raw);
  if (id === null) return null;
  if (!isUserAppIconId(id)) return t(`settings.option.app_icon.${id as BuiltinAvatar}`).replace(/\s*\(.*\)$/, "");
  const i = avatarLibrary.list.findIndex((a) => a.id === id);
  if (i < 0) return null;
  return avatarLibrary.list[i].name || t("settings.avatars.user", { n: String(i + 1) });
}

/** 아바타 매핑이 있는 AI CLI — 로고 이름(`aiIconName`)과 같은 낱말 */
export type AvatarCli = keyof typeof DEFAULT_AI_AVATARS;

function isAvatarCli(v: string): v is AvatarCli {
  return Object.hasOwn(DEFAULT_AI_AVATARS, v);
}

/** 그 CLI 에 매핑된 아바타 id — 고른 것이 없거나 지워졌으면 기본(claude → `claude` · codex → `gpt`) */
export function cliAvatarId(cli: AvatarCli): string {
  const picked = cli === "claude" ? settings.aiAvatarClaude : settings.aiAvatarCodex;
  return avatarSrc(picked) !== null ? (avatarId(picked) ?? DEFAULT_AI_AVATARS[cli]) : DEFAULT_AI_AVATARS[cli];
}

/** 그 CLI 의 아바타 그림 — 모양 칸과 상관없이(아티스트 · 프로듀서처럼 늘 얼굴을 그리는 자리). 모르는 CLI 면 `null` */
export function cliAvatarSrc(cli: string | null | undefined, big = false): string | null {
  return cli && isAvatarCli(cli) ? avatarSrc(cliAvatarId(cli), big) : null;
}

/**
 * **AI 아이콘 모양을 따르는 자리의 그림** — 모양이 `avatar` 이고 아는 CLI(로고 이름 `claude` · `codex`)면 그 아바타 URL, 아니면
 * `null`(= 그 자리가 원래 그리던 브랜드 로고). 탭 · 머리줄 · 독/런처 · 채팅 독 · 앱 안 알림 · 로딩 덮개가 이 하나를 지난다.
 */
export function aiAvatarSrc(logoName: string | null | undefined, big = false): string | null {
  if (settings.aiIconStyle !== "avatar") return null;
  return cliAvatarSrc(logoName, big);
}
