// 아바타 id → 그림 URL. 같은 id 를 앱 아이콘 · AI CLI 별 아바타 · 오케스트레이션 아티스트(`user:<12hex>` — Rust `artists.rs` 의 표기)가 함께 쓴다.
//
// 불변식:
// - 그림을 웹뷰에 주는 길은 data URL 뿐이다(`app_icon_list` 썸네일 · `app_icon_image` 원본). asset 프로토콜 범위는 넓히지 않는다.
// - 모르는 id · 지운 그림은 `null` 로 접는다(부르는 쪽이 기본으로 떨어진다). 설정 값은 그대로 둔다 — 고치는 것은 사람의 [저장] 이다.
// - AI 아이콘 모양(`[ai] icon_style`)을 읽어 로고와 아바타 중 하나를 고르는 자리는 [`aiAvatarSrc`] 하나다.
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

/** Rust `app_icon_list` · `app_icon_add` 의 한 줄 */
export interface UserAvatar {
  id: string;
  src: string;
  name?: string | null;
  added?: number | null;
}

/** 순서 = 고르기 칩 순서(`APP_ICONS` 와 같은 순서) */
export const BUILTIN_AVATARS = ["gpt", "claude", "gemini", "grok"] as const;
export type BuiltinAvatar = (typeof BUILTIN_AVATARS)[number];

const THUMB: Record<BuiltinAvatar, string> = { claude: claudeThumb, gemini: geminiThumb, gpt: gptThumb, grok: grokThumb };
const FULL: Record<BuiltinAvatar, string> = { claude: claudeFull, gemini: geminiFull, gpt: gptFull, grok: grokFull };

export function builtinAvatarThumb(id: BuiltinAvatar): string {
  return THUMB[id];
}

export const avatarLibrary = $state({
  list: [] as UserAvatar[],
  loaded: false,
});

const fullSrc = $state<Record<string, string>>({});
const fullAsked = new Set<string>();

/** 실패는 던진다 — 부팅 · 동기화는 [`refreshAvatars`] 로 삼킨다. */
export async function loadAvatars(): Promise<void> {
  avatarLibrary.list = await invoke<UserAvatar[]>("app_icon_list");
  avatarLibrary.loaded = true;
  for (const id of Object.keys(fullSrc)) {
    if (!avatarLibrary.list.some((a) => a.id === id)) {
      delete fullSrc[id];
      fullAsked.delete(id);
    }
  }
}

export async function refreshAvatars(): Promise<void> {
  try {
    await loadAvatars();
  } catch (e) {
    console.warn("[aynx] 아바타 목록을 읽지 못했습니다 (무시):", e);
  }
}

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
        fullAsked.delete(id);
      });
  }
  return entry.src;
}

export function avatarLabel(raw: string | null | undefined): string | null {
  const id = avatarId(raw);
  if (id === null) return null;
  if (!isUserAppIconId(id)) return t(`settings.option.app_icon.${id as BuiltinAvatar}`).replace(/\s*\(.*\)$/, "");
  const i = avatarLibrary.list.findIndex((a) => a.id === id);
  if (i < 0) return null;
  return avatarLibrary.list[i].name || t("settings.avatars.user", { n: String(i + 1) });
}

export type AvatarCli = keyof typeof DEFAULT_AI_AVATARS;

function isAvatarCli(v: string): v is AvatarCli {
  return Object.hasOwn(DEFAULT_AI_AVATARS, v);
}

export function cliAvatarId(cli: AvatarCli): string {
  const picked = cli === "claude" ? settings.aiAvatarClaude : settings.aiAvatarCodex;
  return avatarSrc(picked) !== null ? (avatarId(picked) ?? DEFAULT_AI_AVATARS[cli]) : DEFAULT_AI_AVATARS[cli];
}

/** 모양 칸과 상관없이 늘 얼굴을 그리는 자리(아티스트 · 프로듀서) */
export function cliAvatarSrc(cli: string | null | undefined, big = false): string | null {
  return cli && isAvatarCli(cli) ? avatarSrc(cliAvatarId(cli), big) : null;
}

/** `null` = 그 자리가 원래 그리던 브랜드 로고 */
export function aiAvatarSrc(logoName: string | null | undefined, big = false): string | null {
  if (settings.aiIconStyle !== "avatar") return null;
  return cliAvatarSrc(logoName, big);
}
