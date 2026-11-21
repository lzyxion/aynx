// 사용자 아바타 — 원본 파일은 이 창의 object URL 로만 그린다: 경로를 Rust 에 넘기지 않고 asset 프로토콜 범위도 넓히지 않는다
// (PNG 바이트만 넘기고 Rust 가 다시 디코드 · 검증한다).
// 넣기 · 지우기 · 이름 바꾸기는 곧바로 파일 작업이고, 지정(앱 아이콘 · AI CLI)만 미저장 변경이다(설정 [저장] · [취소]).
import { invoke } from "../ipc";
import { t } from "$lib/i18n/i18n.svelte.js";
import { stripReason } from "$lib/error-reason";
import { askConfirm } from "$lib/app/confirm-dialog.svelte.js";
import { DEFAULT_APP_ICON, setAiAvatar, setAppIcon, settings } from "$lib/settings.svelte.js";
import { DEFAULT_AI_AVATARS } from "$lib/settings/model/options";
import {
  avatarId,
  avatarLabel,
  avatarLibrary,
  avatarSrc,
  cliAvatarId,
  loadAvatars,
  type UserAvatar,
} from "$lib/avatars.svelte.js";
import { rememberSplashUserIcon } from "$lib/splash-memo";
import { profilesUsingIcon } from "$lib/theme-profiles.svelte.js";
import { artistList, artistSet } from "$lib/orchestration/api";
import type { ArtistProfile } from "$lib/orchestration/artist-form";
import { outputSide, type Crop } from "$lib/app-icon-crop";

export type UserAppIcon = UserAvatar;

/** Rust `app_icon/user.rs` 의 `MAX_ICONS` 와 같다 */
export const MAX_USER_APP_ICONS = 24;
/** Rust `app_icon/user.rs` 의 `NAME_MAX` 와 같다 */
export const AVATAR_NAME_MAX = 32;
/** 디코드는 이 창(웹뷰 메모리)에서 한다 */
const MAX_SOURCE_BYTES = 50 * 1024 * 1024;

export type AvatarSlot = "app" | keyof typeof DEFAULT_AI_AVATARS;

export const userAppIcons = $state({
  error: null as string | null,
});

export async function loadUserAppIcons(): Promise<void> {
  try {
    await loadAvatars();
  } catch (e) {
    userAppIcons.error = t("settings.theme.app_icon.error.list", { error: stripReason(String(e)) });
  }
}

export function pickUserAppIcon(icon: UserAppIcon): void {
  rememberSplashUserIcon(icon.id, icon.src);
  setAppIcon(icon.id);
}

/** 지운 그림 · 모르는 값은 기본으로 접는다 */
export function slotAvatarId(slot: AvatarSlot): string {
  if (slot !== "app") return cliAvatarId(slot);
  return avatarSrc(settings.appIcon) !== null ? (avatarId(settings.appIcon) ?? DEFAULT_APP_ICON) : DEFAULT_APP_ICON;
}

export function assignAvatar(slot: AvatarSlot, id: string): void {
  if (slot !== "app") {
    setAiAvatar(slot, id);
    return;
  }
  const user = avatarLibrary.list.find((a) => a.id === id);
  if (user) pickUserAppIcon(user);
  else setAppIcon(id);
}

function artistUses(a: Pick<ArtistProfile, "icon">, id: string): boolean {
  return avatarId(a.icon) === id;
}

export interface AvatarUsage {
  app: boolean;
  claude: boolean;
  codex: boolean;
  artists: string[];
  profiles: number;
}

export async function avatarUsages(id: string): Promise<AvatarUsage> {
  const [artists, profiles] = await Promise.all([
    artistList().catch(() => [] as ArtistProfile[]),
    profilesUsingIcon(id).catch(() => 0),
  ]);
  return {
    app: settings.appIcon === id,
    claude: settings.current.ai.avatar_claude === id,
    codex: settings.current.ai.avatar_codex === id,
    artists: artists.filter((a) => artistUses(a, id)).map((a) => a.name),
    profiles,
  };
}

function usagePoints(u: AvatarUsage): string[] {
  const point = (where: string, to: string) => t("settings.avatars.remove.point", { where, to });
  const out: string[] = [];
  if (u.app) out.push(point(t("settings.avatars.slot.app"), t("settings.avatars.remove.toDefaultApp")));
  if (u.claude) out.push(point(t("settings.avatars.slot.claude"), t("settings.avatars.remove.toDefault")));
  if (u.codex) out.push(point(t("settings.avatars.slot.codex"), t("settings.avatars.remove.toDefault")));
  for (const name of u.artists) out.push(point(t("settings.avatars.remove.artist", { name }), t("settings.avatars.remove.toCli")));
  if (u.profiles > 0) {
    out.push(point(t("settings.avatars.remove.profiles", { n: String(u.profiles) }), t("settings.avatars.remove.toDefaultApp")));
  }
  return out;
}

/** 아티스트 · 테마 프로필은 값을 두고 그릴 때 기본으로 접힌다 */
export async function removeUserAppIcon(id: string): Promise<void> {
  const name = avatarLabel(id) ?? id;
  const points = usagePoints(await avatarUsages(id));
  const ok = await askConfirm(t(points.length > 0 ? "settings.avatars.remove.body" : "settings.avatars.remove.bodyUnused"), {
    title: t("settings.avatars.remove.title", { name }),
    kind: "warning",
    okLabel: t("settings.avatars.remove.ok"),
    danger: true,
    points,
  });
  if (!ok) return;
  try {
    await invoke("app_icon_remove", { id });
  } catch (e) {
    userAppIcons.error = t("settings.theme.app_icon.error.remove", { error: stripReason(String(e)) });
    return;
  }
  userAppIcons.error = null;
  avatarLibrary.list = avatarLibrary.list.filter((i) => i.id !== id);
  // [취소] 로 남은 없는 id 는 Rust 가 기본 그림으로 접는다(`app_icon::resolve`) — 그대로 둬도 안전하다
  if (settings.appIcon === id) setAppIcon(DEFAULT_APP_ICON);
  if (settings.current.ai.avatar_claude === id) setAiAvatar("claude", "");
  if (settings.current.ai.avatar_codex === id) setAiAvatar("codex", "");
}

/** 빈 글자 = 이름 걷기 → "사용자 N" */
export async function renameUserAvatar(id: string, name: string): Promise<void> {
  const entry = avatarLibrary.list.find((a) => a.id === id);
  if (!entry || (entry.name ?? "") === name.trim()) return;
  try {
    const saved = await invoke<string | null>("app_icon_rename", { id, name });
    avatarLibrary.list = avatarLibrary.list.map((a) => (a.id === id ? { ...a, name: saved } : a));
    userAppIcons.error = null;
  } catch (e) {
    userAppIcons.error = t("settings.avatars.error.rename", { error: stripReason(String(e)) });
  }
}

// ── 자르기 모달 ─────────────────────────────────────────────────────────────

export const appIconCrop = $state({
  open: false,
  /** object URL(닫을 때 걷는다) 또는 data URL(다시 자르기) */
  url: null as string | null,
  width: 0,
  height: 0,
  busy: false,
  error: null as string | null,
  name: "",
  /** 다시 자르기면 바꿀 옛 그림 id */
  replace: null as string | null,
  assignTo: null as AvatarSlot | null,
});

export function appIconCropVisible(): boolean {
  return appIconCrop.open;
}

async function openCrop(url: string, opts: { name: string; replace: string | null; assignTo: AvatarSlot | null }): Promise<void> {
  const img = new Image();
  try {
    img.src = url;
    await img.decode();
  } catch {
    if (url.startsWith("blob:")) URL.revokeObjectURL(url);
    userAppIcons.error = t("settings.theme.app_icon.error.decode");
    return;
  }
  closeAppIconCrop();
  Object.assign(appIconCrop, { open: true, url, width: img.naturalWidth, height: img.naturalHeight, busy: false, error: null, ...opts });
}

export async function startAppIconCrop(file: File, assignTo: AvatarSlot | null = null): Promise<void> {
  userAppIcons.error = null;
  if (file.size > MAX_SOURCE_BYTES) {
    userAppIcons.error = t("settings.theme.app_icon.error.tooBig", { mb: String(MAX_SOURCE_BYTES / (1024 * 1024)) });
    return;
  }
  await openCrop(URL.createObjectURL(file), { name: "", replace: null, assignTo });
}

/** 원본이 없으므로 지금 그림(256px)을 다시 잘라 새 그림으로 바꾼다 */
export async function startRecrop(id: string): Promise<void> {
  userAppIcons.error = null;
  const entry = avatarLibrary.list.find((a) => a.id === id);
  if (!entry) return;
  let url: string | null;
  try {
    url = await invoke<string | null>("app_icon_image", { id });
  } catch (e) {
    userAppIcons.error = t("settings.avatars.error.recrop", { error: stripReason(String(e)) });
    return;
  }
  if (!url) {
    userAppIcons.error = t("settings.avatars.error.recrop", { error: id });
    return;
  }
  await openCrop(url, { name: entry.name ?? "", replace: id, assignTo: null });
}

export function closeAppIconCrop(): void {
  if (appIconCrop.busy) return;
  if (appIconCrop.url?.startsWith("blob:")) URL.revokeObjectURL(appIconCrop.url);
  Object.assign(appIconCrop, { open: false, url: null, width: 0, height: 0, error: null, name: "", replace: null, assignTo: null });
}

/** 테마 프로필의 값은 옮기지 않는다(지우기와 같다) */
async function replaceAvatar(oldId: string, next: UserAppIcon): Promise<void> {
  if (settings.appIcon === oldId) pickUserAppIcon(next);
  if (settings.current.ai.avatar_claude === oldId) setAiAvatar("claude", next.id);
  if (settings.current.ai.avatar_codex === oldId) setAiAvatar("codex", next.id);
  const artists = await artistList().catch(() => [] as ArtistProfile[]);
  const icon = `user:${next.id.slice("user-".length)}`;
  for (const a of artists.filter((x) => artistUses(x, oldId))) {
    try {
      await artistSet({ ...a, icon });
    } catch (e) {
      userAppIcons.error = t("settings.avatars.error.artist", { name: a.name, error: stripReason(String(e)) });
    }
  }
  await invoke("app_icon_remove", { id: oldId });
}

export async function submitAppIconCrop(img: HTMLImageElement, crop: Crop): Promise<void> {
  if (appIconCrop.busy) return;
  appIconCrop.busy = true;
  appIconCrop.error = null;
  const { replace, assignTo } = appIconCrop;
  const name = appIconCrop.name.trim();
  try {
    const side = outputSide(crop);
    const canvas = document.createElement("canvas");
    canvas.width = side;
    canvas.height = side;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas");
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("toBlob");
    let icon = await invoke<UserAppIcon>("app_icon_add", new Uint8Array(await blob.arrayBuffer()));
    if (name !== (icon.name ?? "")) icon = { ...icon, name: await invoke<string | null>("app_icon_rename", { id: icon.id, name }) };
    userAppIcons.error = null;
    if (replace && replace !== icon.id) await replaceAvatar(replace, icon);
    if (replace) await loadAvatars();
    else if (!avatarLibrary.list.some((i) => i.id === icon.id)) avatarLibrary.list = [...avatarLibrary.list, icon];
    else avatarLibrary.list = avatarLibrary.list.map((a) => (a.id === icon.id ? icon : a));
    if (assignTo) assignAvatar(assignTo, icon.id);
    appIconCrop.busy = false;
    closeAppIconCrop();
  } catch (e) {
    appIconCrop.busy = false;
    appIconCrop.error = t("settings.theme.app_icon.error.add", { error: stripReason(String(e)) });
  }
}
